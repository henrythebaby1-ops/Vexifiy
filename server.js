import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  chunkManual, detectVersion, versionFromName, dropStale, preferNewest, buildBm25, bm25Rank, cosine, fuse, buildMessages,
  compareVersions,
} from './lib/manual.js';
import { SEASON_NOTES, KNOWN_LATEST, CHANGED_SINCE_V01 } from './lib/season-notes.js';
import {
  categoryById, buildGradeMessages, parseGrade, GRADE_SCHEMA, MAX_ANSWER,
} from './public/js/interview-core.js';
import { buildCodeMessages, parseCodeReply, buildExplainMessages, normalizeProgram } from './public/js/code-core.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
const BLOCKLY_DIR = path.join(ROOT, 'node_modules', 'blockly');
const DATA = path.join(ROOT, 'data');
const LIBRARY = path.join(DATA, 'library.json');
const PORT = Number(process.env.PORT || 4477);
const OLLAMA = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MAX_UPLOAD = 64 * 1024 * 1024;
const EMBED_TRUNCATE = 1800;

mkdirSync(DATA, { recursive: true });

// ---------- Library ----------
const lib = existsSync(LIBRARY)
  ? JSON.parse(readFileSync(LIBRARY, 'utf8'))
  : { docs: [], chunks: [], embeddings: {}, embedModel: null };
let active = [];
let bm25 = buildBm25([]);
const embedState = { running: false, done: 0, total: 0, model: null, error: null };

const save = () => writeFileSync(LIBRARY, JSON.stringify(lib));

function refreshIndex() {
  const on = new Set(lib.docs.filter((d) => d.enabled).map((d) => d.id));
  active = [...SEASON_NOTES, ...preferNewest(lib.chunks.filter((c) => on.has(c.docId)))];
  bm25 = buildBm25(active);
}

async function extractPdf(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false, verbosity: 0,
  }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    let out = ''; let lastY = null;
    for (const it of items) {
      const y = it.transform?.[5];
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) out += '\n';
      out += it.str;
      if (it.hasEOL) out += '\n';
      if (y !== undefined) lastY = y;
    }
    pages.push({ page: n, text: out });
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}

function addDocument({ name, pages, kind }) {
  const all = pages.map((p) => p.text).join('\n');
  const version = (kind === 'pdf' && versionFromName(name)) || detectVersion(all);
  const id = crypto.createHash('sha1').update(all).digest('hex').slice(0, 10);
  if (lib.docs.some((d) => d.id === id)) {
    const existing = lib.docs.find((d) => d.id === id);
    existing.enabled = true;
    return { doc: existing, duplicate: true };
  }
  const chunks = chunkManual(pages, { source: name, version, docId: id });
  if (!chunks.length) throw new Error('No readable text was found in that document.');
  const isFull = chunks.filter((c) => c.rule).length >= 40;
  const doc = {
    id, name, version, kind, enabled: true, isFull, pages: pages.length,
    rules: chunks.filter((c) => c.rule).length, chunks: chunks.length, added: new Date().toISOString(),
  };
  // A complete newer manual replaces older ones. Partial pastes sit alongside and win rule by rule.
  if (isFull) {
    for (const d of lib.docs) if (d.isFull && compareVersions(d.version, version) < 0) d.enabled = false;
  }
  lib.docs.push(doc);
  lib.chunks.push(...chunks);
  save();
  refreshIndex();
  return { doc };
}

// ---------- Ollama ----------
const ollamaJson = async (p, body, timeout = 8000) => {
  const res = await fetch(`${OLLAMA}${p}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`Ollama ${p} returned ${res.status}`);
  return res.json();
};

const capabilityCache = new Map();
async function modelInfo() {
  const { models = [] } = await ollamaJson('/api/tags');
  return Promise.all(models.map(async (m) => {
    let caps = m.capabilities || capabilityCache.get(m.name);
    if (!caps) {
      try { caps = (await ollamaJson('/api/show', { model: m.name })).capabilities || []; } catch { caps = []; }
      capabilityCache.set(m.name, caps);
    }
    return { name: m.name, size: m.size, caps };
  }));
}

// Benchmark results, if scripts/benchmark-models.js has been run on this computer.
function modelScores(installed) {
  try {
    const { tested, stage, ranked } = JSON.parse(readFileSync(path.join(DATA, 'model-scores.json'), 'utf8'));
    return {
      tested, stage,
      ranked: ranked.filter((r) => installed.includes(r.model)).map(({ model, asked, factual, goodCites, wrongCites, avgSeconds }) => ({
        model, asked, factual, goodCites, wrongCites, avgSeconds,
      })),
    };
  } catch {
    return null;
  }
}

const isChat = (m) => m.caps.includes('completion') || !m.caps.includes('embedding');
const isEmbed = (m) => m.caps.includes('embedding');

async function embedAll() {
  if (embedState.running) return;
  let model;
  try { model = (await modelInfo()).find(isEmbed)?.name; } catch { return; }
  if (!model) { embedState.model = null; return; }
  if (lib.embedModel !== model) { lib.embeddings = {}; lib.embedModel = model; }
  embedState.model = model;
  const todo = active.filter((c) => !lib.embeddings[c.id]);
  if (!todo.length) { embedState.done = embedState.total = active.length; return; }
  Object.assign(embedState, { running: true, done: active.length - todo.length, total: active.length, error: null });
  try {
    for (let i = 0; i < todo.length; i += 8) {
      const batch = todo.slice(i, i + 8);
      const { embeddings } = await ollamaJson('/api/embed', {
        model, input: batch.map((c) => `${c.title}\n${c.text}`.slice(0, EMBED_TRUNCATE)),
      }, 180000);
      batch.forEach((c, j) => { lib.embeddings[c.id] = embeddings[j]; });
      embedState.done += batch.length;
      if ((i / 8) % 5 === 4) save(); // keep progress if the app is closed mid-index
    }
    save();
  } catch (err) {
    embedState.error = err.message;
    save();
  } finally {
    embedState.running = false;
  }
}

async function retrieve(query, limit = 5) {
  const keyword = bm25Rank(bm25, query);
  let vector = [];
  if (lib.embedModel && !embedState.running && Object.keys(lib.embeddings).length) {
    try {
      const { embeddings } = await ollamaJson('/api/embed', { model: lib.embedModel, input: query }, 30000);
      vector = active
        .map((c, i) => ({ i, score: lib.embeddings[c.id] ? cosine(embeddings[0], lib.embeddings[c.id]) : -1 }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score);
    } catch { /* keyword search still works */ }
  }
  return fuse(active, { bm25: keyword, vector, query, limit });
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve, reject) => {
  const parts = []; let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_UPLOAD) { reject(Object.assign(new Error('That file is over 64 MB.'), { status: 413 })); req.destroy(); return; }
    parts.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(parts)));
  req.on('error', reject);
});

async function serveFile(res, base, rel) {
  const full = path.join(base, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    const data = await fs.readFile(full);
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}

const isOutdated = (c) => !c.isNote && !!c.rule && compareVersions(c.version, KNOWN_LATEST.version) < 0 && CHANGED_SINCE_V01.has(c.rule) && compareVersions(c.version, '1.0') < 0;

const publicChunk = (c) => ({
  id: c.id, rule: c.rule, title: c.title, page: c.page, version: c.version, source: c.source,
  text: c.text, isNote: !!c.isNote, rules: c.rules,
  outdated: isOutdated(c),
  isOld: !c.isNote && compareVersions(c.version, '1.0') < 0,
});

const routes = {
  'GET /api/status': async (_req, res) => {
    let models = []; let ollama = true;
    try { models = await modelInfo(); } catch { ollama = false; }
    send(res, 200, {
      ollama, ollamaUrl: OLLAMA, chatModels: models.filter(isChat).map((m) => m.name),
      modelScores: modelScores(models.map((m) => m.name)),
      embedModel: lib.embedModel, embed: embedState, latest: KNOWN_LATEST,
      docs: lib.docs, today: new Date().toISOString().slice(0, 10),
    });
  },
  'GET /api/rules': async (_req, res) => {
    const rules = active.filter((c) => c.rule && !c.id.includes('#')).map(publicChunk);
    send(res, 200, { rules, notes: SEASON_NOTES.map(publicChunk) });
  },
  'GET /api/search': async (req, res, url) => {
    const q = url.searchParams.get('q') || '';
    send(res, 200, { results: q.trim() ? (await retrieve(q, 12)).map(publicChunk) : [] });
  },
  'POST /api/manual/import': async (req, res, url) => {
    const name = (url.searchParams.get('name') || 'Imported manual').slice(0, 120);
    const buf = await readBody(req);
    const type = req.headers['content-type'] || '';
    let pages; let kind;
    if (type.includes('pdf') || buf.subarray(0, 5).toString() === '%PDF-') {
      pages = await extractPdf(buf); kind = 'pdf';
    } else {
      const raw = buf.toString('utf8');
      const version = url.searchParams.get('version');
      pages = [{ page: null, text: version ? `Version ${version}\n${raw}` : raw }];
      kind = 'text';
    }
    const result = addDocument({ name, pages, kind });
    embedAll();
    send(res, 200, result);
  },
  'POST /api/manual/toggle': async (req, res) => {
    const { id, enabled } = JSON.parse((await readBody(req)).toString());
    const doc = lib.docs.find((d) => d.id === id);
    if (!doc) return send(res, 404, { error: 'Not found' });
    doc.enabled = !!enabled;
    save(); refreshIndex(); embedAll();
    return send(res, 200, { doc });
  },
  'POST /api/manual/remove': async (req, res) => {
    const { id } = JSON.parse((await readBody(req)).toString());
    lib.docs = lib.docs.filter((d) => d.id !== id);
    lib.chunks = lib.chunks.filter((c) => {
      if (c.docId !== id) return true;
      delete lib.embeddings[c.id];
      return false;
    });
    // Removing the newest manual falls back to the best one left.
    if (!lib.docs.some((d) => d.enabled && d.isFull)) {
      const best = lib.docs.filter((d) => d.isFull).sort((a, b) => compareVersions(b.version, a.version))[0];
      if (best) best.enabled = true;
    }
    save(); refreshIndex(); embedAll();
    send(res, 200, { ok: true });
  },
  'POST /api/chat': async (req, res) => {
    const { question, history, model, level } = JSON.parse((await readBody(req)).toString());
    if (!question?.trim()) return send(res, 400, { error: 'Ask a question first.' });
    const sources = dropStale(await retrieve(question), SEASON_NOTES, isOutdated);
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' });
    res.write(`${JSON.stringify({ type: 'sources', sources: sources.map(publicChunk) })}\n`);
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    try {
      const upstream = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        signal: abort.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model, stream: true, think: false,
          messages: buildMessages({ question, history, sources: sources.map(publicChunk), level }),
          options: { temperature: 0.1, num_ctx: 8192 },
        }),
      });
      if (!upstream.ok) {
        const detail = await upstream.text();
        throw new Error(detail.slice(0, 200) || `Ollama returned ${upstream.status}`);
      }
      const decoder = new TextDecoder();
      let tail = '';
      for await (const part of upstream.body) {
        tail += decoder.decode(part, { stream: true });
        const lines = tail.split('\n');
        tail = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.error) throw new Error(msg.error);
          if (msg.message?.content) res.write(`${JSON.stringify({ type: 'token', text: msg.message.content })}\n`);
        }
      }
      res.write(`${JSON.stringify({ type: 'done' })}\n`);
    } catch (err) {
      if (!abort.signal.aborted) res.write(`${JSON.stringify({ type: 'error', message: err.message === 'fetch failed' ? 'Could not reach Ollama. Is it running?' : err.message })}\n`);
    }
    return res.end();
  },
  'POST /api/code/generate': async (req, res) => {
    const { request, program, model } = JSON.parse((await readBody(req)).toString());
    if (typeof request !== 'string' || !request.trim() || !model) return send(res, 400, { error: 'Describe what the robot should do first.' });
    try {
      const reply = await ollamaJson('/api/chat', {
        model, stream: false, think: false, format: 'json',
        messages: buildCodeMessages({ request, program: normalizeProgram(program).program }),
        options: { temperature: 0.2, num_ctx: 8192 },
      }, 240000);
      return send(res, 200, parseCodeReply(reply.message?.content));
    } catch (err) {
      return send(res, 502, { error: err.message === 'fetch failed' ? 'Could not reach Ollama. Is it running?' : err.message });
    }
  },
  'POST /api/code/explain': async (req, res) => {
    const { program, question, model } = JSON.parse((await readBody(req)).toString());
    if (!Array.isArray(program) || !model) return send(res, 400, { error: 'Nothing to explain yet.' });
    try {
      const reply = await ollamaJson('/api/chat', {
        model, stream: false, think: false,
        messages: buildExplainMessages({ program: normalizeProgram(program).program, question: typeof question === 'string' ? question : '' }),
        options: { temperature: 0.3, num_ctx: 8192 },
      }, 240000);
      return send(res, 200, { text: reply.message?.content || '' });
    } catch (err) {
      return send(res, 502, { error: err.message === 'fetch failed' ? 'Could not reach Ollama. Is it running?' : err.message });
    }
  },
  'POST /api/interview/grade': async (req, res) => {
    const { category, question, answer, model } = JSON.parse((await readBody(req)).toString());
    if (!categoryById(category) || typeof question !== 'string' || typeof answer !== 'string' || !model) {
      return send(res, 400, { error: 'Missing interview details.' });
    }
    if (answer.length > MAX_ANSWER) return send(res, 400, { error: 'That answer is too long. Keep it under a few minutes of talking.' });
    try {
      const reply = await ollamaJson('/api/chat', {
        model, stream: false, think: false, format: GRADE_SCHEMA,
        messages: buildGradeMessages({ category, question: question.slice(0, 300), answer }),
        options: { temperature: 0.2, num_ctx: 4096 },
      }, 180000);
      return send(res, 200, parseGrade(reply.message?.content, answer));
    } catch (err) {
      const message = err.message === 'fetch failed' ? 'Could not reach Ollama. Is it running?' : err.message;
      return send(res, 502, { error: message });
    }
  },
};

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const server = http.createServer(async (req, res) => {
  // Only this computer's pages may talk to the app (blocks DNS rebinding and cross-site posts).
  if (!LOCAL_HOST.test(req.headers.host || '')) { res.writeHead(403); res.end(); return; }
  const origin = req.headers.origin;
  if (origin && !LOCAL_HOST.test(origin.replace(/^https?:\/\//, ''))) { res.writeHead(403); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = routes[`${req.method} ${url.pathname}`];
  try {
    if (route) return await route(req, res, url);
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    if (url.pathname.startsWith('/vendor/blockly/')) {
      return await serveFile(res, BLOCKLY_DIR, decodeURIComponent(url.pathname.slice('/vendor/blockly/'.length)));
    }
    if (url.pathname.startsWith('/vendor/three/')) {
      return await serveFile(res, THREE_DIR, decodeURIComponent(url.pathname.slice('/vendor/three/'.length)));
    }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    return await serveFile(res, PUBLIC, rel);
  } catch (err) {
    if (res.headersSent) return res.end();
    return send(res, err.status || 500, { error: err.message });
  }
});

// First run: pick up any Level Up manual PDF sitting next to the project folder.
async function firstRun() {
  refreshIndex();
  if (lib.docs.length) { embedAll(); return; }
  const parent = path.dirname(ROOT);
  const found = readdirSync(parent).filter((f) => /level-?up.*\.pdf$/i.test(f));
  for (const f of found) {
    try {
      const pages = await extractPdf(await fs.readFile(path.join(parent, f)));
      const { doc } = addDocument({ name: f, pages, kind: 'pdf' });
      console.log(`Imported ${f}: version ${doc.version}, ${doc.rules} rules`);
    } catch (err) { console.warn(`Could not import ${f}: ${err.message}`); }
  }
  embedAll();
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Vexifiy is running at http://localhost:${PORT}`);
  firstRun();
});
