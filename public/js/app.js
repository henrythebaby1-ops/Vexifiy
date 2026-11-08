import { $, $$, esc, api, store, compareVersions, linkRules, renderAnswer } from './util.js';
import { initTimers, timersShown, timersHidden } from './timers.js';
import { initInterview, renderInterview, interviewHidden } from './interview.js';
import { initCode, showCode } from './code.js';

const state = {
  status: null, rules: [], notes: [], knownRules: new Set(),
  ruleTab: 'All', ruleQuery: '', ruleSel: null, smart: null,
  chat: [], level: store.get('level', 'standard'), busy: null,
};

const QUESTIONS = [
  'What is the driver switch window?',
  'How do we use the Load Zone legally?',
  'What counts as Plowing?',
  'Which Bean Bags can score on L4?',
  'How is Robot Skills different from Teamwork?',
  'How big can our Robot get during a Match?',
];

const TABS = [
  ['All', null], ['Scoring', 'SC'], ['Game', 'SG'], ['Safety', 'S'], ['General', 'G'],
  ['Match', 'GG'], ['Skills', 'RSC'], ['Robot', 'R'], ['Tournament', 'T'],
];

const manualHealth = () => {
  const { docs = [], latest } = state.status || {};
  const on = docs.filter((d) => d.enabled);
  const newest = on.map((d) => d.version).sort(compareVersions).pop();
  const full = on.some((d) => d.isFull && compareVersions(d.version, latest?.version) >= 0);
  return { on, newest, current: full, none: !on.length };
};

const dateText = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

// ---------- Home ----------
function renderHome() {
  const { status } = state;
  const health = manualHealth();
  const ladder = [['L4 (yellow)', 16], ['L3', 12], ['L2', 6], ['L1', 3], ['Floor', 1]];
  const next = status?.latest?.next;
  const daysToNext = next ? Math.ceil((new Date(`${next.released}T12:00:00`) - Date.now()) / 864e5) : null;
  $('#view-home').innerHTML = `<div class="page">
    ${manualBanner()}
    <div class="hero">
      <div class="card">
        <h1>Level Up, explained.</h1>
        <p class="muted">Your 2026-27 VIQRC season hub. Ask about the rules with AI running on this Mac, run practice timers, and explore the field in 3D.</p>
        <div class="chips" style="margin-top:14px">
          ${QUESTIONS.slice(0, 4).map((q) => `<button class="q-chip" data-ask="${esc(q)}">${esc(q)}</button>`).join('')}
        </div>
      </div>
      <div class="card">
        <h2 style="margin-bottom:8px">Points per Bean Bag</h2>
        <div class="point-ladder">
          ${ladder.map(([k, v]) => `<div class="rung"><span>${k}</span><i style="width:${(v / 16) * 100}%"></i><b>${v}</b></div>`).join('')}
        </div>
        <p class="small muted" style="margin-top:9px">Red and blue score in their own color. Yellow scores anywhere, and only yellow scores on L4.</p>
      </div>
    </div>
    <div class="tiles">
      <a class="card tile" href="#/ask"><h2>Ask the manual</h2><p class="muted small">Plain-language answers from local AI, with the rule behind each one.</p></a>
      <a class="card tile" href="#/interview"><h2>Interview practice</h2><p class="muted small">Answer a judge's questions and get a score and tips for each one.</p></a>
      <a class="card tile" href="#/code"><h2>Block code</h2><p class="muted small">Snap VEX IQ blocks together or describe it to the AI, then export Python.</p></a>
      <a class="card tile" href="#/timers"><h2>Match timers</h2><p class="muted small">Match and Skills presets with switch cues, or build your own drills.</p></a>
      <a class="card tile" href="#/field"><h2>3D field</h2><p class="muted small">Orbit the real layout, drag Bean Bags into Goals, and see the score.</p></a>
    </div>
    <div class="facts">
      <div class="card fact"><b>1:00</b><span class="small muted">Match length</span></div>
      <div class="card fact"><b>0:35-0:25</b><span class="small muted">Driver switch window</span></div>
      <div class="card fact"><b>38</b><span class="small muted">Bean Bags on a full Field</span></div>
      <div class="card fact"><b>${daysToNext != null && daysToNext > 0 ? `${daysToNext}d` : 'Check'}</b><span class="small muted">${next ? `To scheduled manual v${next.version}, ${dateText(next.released)}` : 'Next manual update'}</span></div>
    </div>
    <p class="small muted" style="margin-top:14px">
      <span class="dot ${status?.ollama ? 'on' : 'off'}"></span>${status?.ollama ? `Ollama connected, ${status.chatModels.length} models` : 'Ollama is not running'}
      · Manual ${health.newest ? `v${esc(health.newest)}` : 'not loaded'}
    </p>
  </div>`;
}

function manualBanner() {
  const { status } = state;
  if (!status) return '';
  const h = manualHealth();
  const { latest } = status;
  if (!status.ollama) {
    return `<div class="banner bad"><span>Ollama isn't reaching Vexifiy. Timers, rules and the 3D field still work. Start Ollama to use Ask AI.</span><button class="btn" data-retry>Check again</button></div>`;
  }
  if (h.current) return '';
  const what = h.none
    ? 'No manual is loaded yet.'
    : `Full manual text is v${esc(h.newest)}, but the current official version is v${esc(latest.version)}. Vexifiy corrects known changes with its v${esc(latest.version)} notes, but some rule text may be out of date.`;
  return `<div class="banner"><span>${what}</span><button class="btn" data-import>Load v${esc(latest.version)}</button></div>`;
}

// ---------- Ask ----------
function renderAsk() {
  const models = state.status?.chatModels || [];
  const picked = pickModel(models);
  $('#view-ask').innerHTML = `<div class="ask">
    <div class="ask-head">
      <h1>Ask the manual</h1>
      <div class="ask-controls">
        <div class="seg" role="group" aria-label="Explanation level">
          ${[['simple', 'Simple'], ['standard', 'Standard'], ['referee', 'Referee']].map(([k, l]) => `<button data-level="${k}" aria-pressed="${state.level === k}">${l}</button>`).join('')}
        </div>
        <select id="model" aria-label="AI model">
          ${modelOptions(models, picked)}
        </select>
      </div>
    </div>
    ${manualBanner()}
    <div class="log" id="log" aria-live="polite"></div>
    <form class="composer" id="composer">
      <textarea id="question" rows="1" placeholder="Ask about any rule, like “Can a Driver also be the Loader?”" aria-label="Your question"></textarea>
      <button class="btn primary" id="send" type="submit">Ask</button>
    </form>
    <p class="small muted" style="padding-top:6px">AI can be wrong. Open the cited rule to confirm. The Head Referee has final say at events.</p>
  </div>`;
  renderLog();
}

function modelOptions(models, picked) {
  if (!models.length) return '<option>No models found</option>';
  const option = (m, text = m) => `<option value="${esc(m)}" ${m === picked ? 'selected' : ''}>${esc(text)}</option>`;
  const ranked = state.status?.modelScores?.ranked || [];
  const tested = ranked.filter((r) => models.includes(r.model));
  const others = models.filter((m) => !tested.some((r) => r.model === m));
  if (!tested.length) return models.map((m) => option(m)).join('');
  return `<optgroup label="Ranked on Level Up questions">${tested.map((r, i) => option(r.model, `${i ? '' : '★ '}${r.model} · ${Math.round(r.factual * 100)}% correct · ${Math.round(r.avgSeconds)}s`)).join('')}</optgroup>
    <optgroup label="Not ranked">${others.map((m) => option(m)).join('')}</optgroup>`;
}

function pickModel(models) {
  const saved = store.get('model');
  if (models.includes(saved)) return saved;
  const best = state.status?.modelScores?.ranked?.find((r) => models.includes(r.model));
  if (best) return best.model;
  return ['gemma4:latest', 'llama3.2:latest', 'gemma3:latest'].find((m) => models.includes(m)) || models[0];
}

function renderLog() {
  const log = $('#log');
  if (!log) return;
  if (!state.chat.length) {
    log.innerHTML = `<div class="empty-state">
      <p class="muted">Answers come only from the manual and run privately on this Mac.</p>
      <div class="chips">${QUESTIONS.map((q) => `<button class="q-chip" data-ask="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    </div>`;
    return;
  }
  log.innerHTML = state.chat.map(renderMessage).join('');
  log.scrollTop = log.scrollHeight;
}

function renderMessage(m, i) {
  if (m.role === 'user') return `<div class="msg user">${esc(m.content)}</div>`;
  const cited = new Set((m.sources || []).flatMap((s) => (s.rule ? [s.rule] : s.rules || [])));
  const known = { all: state.knownRules, cited };
  // Small models sometimes say "Excerpt 3" despite instructions. Show the real source name.
  const readable = (m.content || '').replace(/<?\b[Ee]xcerpts? (\d+)\b>?/g, (found, n) => {
    const s = m.sources?.[Number(n) - 1];
    if (!s) return found;
    return s.rule ? `<${s.rule}>` : `the note “${s.title}”`;
  });
  const body = readable ? renderAnswer(readable, known) : (m.error ? '' : '<p class="typing">Reading the manual…</p>');
  const old = (m.sources || []).some((s) => s.outdated);
  return `<div class="msg ai" data-i="${i}">
    <div class="body">${body}</div>
    ${m.error ? `<p class="msg-error">${esc(m.error)}</p>` : ''}
    ${m.sources?.length ? `<details class="sources"><summary>Based on ${m.sources.length} excerpts${old ? ' · <span class="old-tag">includes text changed since v0.1</span>' : ''}</summary>
      ${m.sources.map(sourceCard).join('')}</details>` : ''}
  </div>`;
}

const sourceCard = (s) => `<div class="source ${s.isNote ? 'note' : ''}">
  <header>
    ${(s.rule ? [s.rule] : s.rules || []).map((r) => linkRules(`&lt;${r}&gt;`)).join(' ')}
    ${s.rule ? '' : `<strong>${esc(s.title)}</strong>`}
    <span>${s.isNote ? 'Checked against manual v2.1' : `Manual v${esc(s.version ?? '?')}${s.page ? `, PDF p.${s.page}` : ''}`}</span>
    ${s.outdated ? '<span class="old-tag">Changed in a later version</span>' : ''}
  </header>
  <p>${esc(s.text)}</p>
</div>`;

async function ask(question) {
  question = question.trim();
  if (!question || state.busy) return;
  const model = $('#model')?.value || pickModel(state.status?.chatModels || []);
  const history = state.chat.filter((m) => m.content).map(({ role, content }) => ({ role, content }));
  const answer = { role: 'assistant', content: '', sources: [] };
  state.chat.push({ role: 'user', content: question }, answer);
  const controller = new AbortController();
  state.busy = controller;
  setBusy(true);
  renderLog();
  let paint = 0;
  const repaint = () => {
    const el = $(`.msg.ai[data-i="${state.chat.length - 1}"]`);
    if (!el) return;
    el.outerHTML = renderMessage(answer, state.chat.length - 1);
    const log = $('#log');
    if (log) log.scrollTop = log.scrollHeight;
  };
  try {
    if (!state.status?.ollama) throw new Error('Ollama is not running, so the AI cannot answer. Rules search still works.');
    const res = await fetch('/api/chat', {
      method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, history, model, level: state.level }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'The request failed.');
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let tail = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      tail += value;
      const lines = tail.split('\n');
      tail = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.type === 'sources') answer.sources = msg.sources;
        if (msg.type === 'token') answer.content += msg.text;
        if (msg.type === 'error') answer.error = `Ollama error: ${msg.message}`;
      }
      if (Date.now() - paint > 60) { paint = Date.now(); repaint(); }
    }
  } catch (err) {
    if (err.name !== 'AbortError') answer.error = err.message;
    else if (!answer.content) answer.error = 'Stopped.';
  } finally {
    state.busy = null;
    setBusy(false);
    repaint();
  }
}

function setBusy(on) {
  const send = $('#send');
  if (!send) return;
  send.textContent = on ? 'Stop' : 'Ask';
  send.classList.toggle('primary', !on);
}

function askFromAnywhere(question) {
  location.hash = '#/ask';
  // The view renders on hash change, so wait a tick before sending.
  setTimeout(() => ask(question), 30);
}

// ---------- Rules ----------
function renderRules() {
  $('#view-rules').innerHTML = `<div class="page">
    <div class="page-head">
      <div><h1>Rulebook</h1><p class="muted small" id="manual-line"></p></div>
      <button class="btn" data-import>Manual sources</button>
    </div>
    ${manualBanner()}
    <form id="rule-search" class="row" role="search">
      <input type="search" id="rule-q" placeholder="Filter rules, like “preload” or “GG11”" value="${esc(state.ruleQuery)}" style="flex:1;min-width:200px" aria-label="Filter rules">
      <button class="btn" type="submit" title="Search by meaning using your local embedding model">Smart search</button>
    </form>
    <div class="rule-tabs seg" role="group" aria-label="Rule category" style="display:flex;flex-wrap:wrap;width:fit-content">
      ${TABS.map(([name]) => `<button data-tab="${name}" aria-pressed="${state.ruleTab === name}">${name}</button>`).join('')}
    </div>
    <div class="rule-layout">
      <div class="card rule-list" id="rule-list"></div>
      <div class="card" id="rule-detail"></div>
    </div>
  </div>`;
  const h = manualHealth();
  $('#manual-line').textContent = state.rules.length
    ? `${state.rules.length} rules, newest source v${h.newest ?? '?'}`
    : 'Load a manual to browse the rules.';
  renderRuleList();
  renderRuleDetail();
}

function filteredRules() {
  if (state.smart) return state.smart;
  const q = state.ruleQuery.trim().toLowerCase();
  const prefix = TABS.find(([n]) => n === state.ruleTab)?.[1];
  return state.rules.filter((r) => {
    if (prefix && r.rule.replace(/\d+$/, '') !== prefix) return false;
    if (!q) return true;
    return r.rule.toLowerCase() === q || `${r.rule} ${r.title} ${r.text}`.toLowerCase().includes(q);
  });
}

function renderRuleList() {
  const list = $('#rule-list');
  if (!list) return;
  const rows = filteredRules();
  list.innerHTML = rows.length
    ? rows.map((r) => `<button class="rule-row" data-rule="${r.rule}" aria-current="${state.ruleSel === r.rule}"><b>${r.rule}</b><span>${esc(r.title)}</span></button>`).join('')
    : '<p class="muted small" style="padding:10px">No rules match.</p>';
}

const formatRule = (text) => text
  .replace(/^<[A-Z]+\d+>\s*/, '')
  .replace(/\s([a-h])\.\s/g, '\n\n$1. ')
  .replace(/\s(i{1,3}|iv)\.\s/g, '\n    $1. ');

function renderRuleDetail() {
  const el = $('#rule-detail');
  if (!el) return;
  const rule = state.rules.find((r) => r.rule === state.ruleSel);
  if (!rule) {
    el.innerHTML = '<p class="muted">Pick a rule to read it, or have the AI explain it.</p>';
    return;
  }
  const notes = state.notes.filter((n) => n.rules?.includes(rule.rule));
  const known = { all: state.knownRules };
  el.innerHTML = `
    <h2 style="font-size:1.15rem"><span class="chip" style="font-size:.85rem;cursor:default">${rule.rule}</span> ${esc(rule.title)}</h2>
    <p class="small muted" style="margin-top:4px">From manual v${esc(rule.version ?? '?')}${rule.page ? `, PDF page ${rule.page}` : ''}</p>
    ${rule.outdated ? `<div class="banner" style="margin:10px 0 0">This rule changed after v${esc(rule.version)}. Read the current wording on the official manual site.</div>` : ''}
    <div class="rule-text">${linkRules(esc(formatRule(rule.text)), known)}</div>
    ${notes.map((n) => `<div class="rule-note"><strong>${esc(n.title)} (v2.1):</strong> ${linkRules(esc(n.text), known)}</div>`).join('')}
    <div class="rule-actions">
      <button class="btn primary" data-explain="${rule.rule}" data-lvl="simple">Explain simply</button>
      <button class="btn" data-explain="${rule.rule}" data-lvl="referee">Referee details</button>
      <a class="btn ghost" target="_blank" rel="noopener" href="https://link.vex.com/docs/26-27/viqrc/game-manual">Official manual ↗</a>
    </div>`;
}

// ---------- Import dialog ----------
function openImport() {
  let dlg = $('#import-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'import-dialog';
    document.body.append(dlg);
    dlg.addEventListener('click', onImportClick);
    dlg.addEventListener('change', (e) => {
      if (e.target.id === 'pdf-file' && e.target.files[0]) uploadPdf(e.target.files[0]);
      if (e.target.dataset.toggle) toggleDoc(e.target.dataset.toggle, e.target.checked);
    });
    dlg.addEventListener('dragover', (e) => { e.preventDefault(); $('.drop', dlg)?.classList.add('over'); });
    dlg.addEventListener('dragleave', () => $('.drop', dlg)?.classList.remove('over'));
    dlg.addEventListener('drop', (e) => {
      e.preventDefault();
      $('.drop', dlg)?.classList.remove('over');
      const file = e.dataTransfer.files[0];
      if (file) uploadPdf(file);
    });
  }
  renderImport(dlg);
  if (!dlg.open) dlg.showModal();
}

function renderImport(dlg, message = '') {
  const { docs = [], latest, embed, embedModel } = state.status || {};
  dlg.innerHTML = `<div class="dialog-head"><h2 style="font-size:1.15rem">Manual sources</h2><button class="btn ghost" data-close aria-label="Close">✕</button></div>
    <div class="stack">
      <div>
        ${docs.length ? docs.map((d) => `<div class="doc-row">
          <label class="toggle"><input type="checkbox" data-toggle="${d.id}" ${d.enabled ? 'checked' : ''}>
            <span>${esc(d.name)}<br><span class="small muted">v${esc(d.version ?? '?')} · ${d.rules} rules${d.isFull ? '' : ' · partial'}</span></span></label>
          <button class="btn ghost danger" data-remove="${d.id}">Remove</button></div>`).join('') : '<p class="muted small">No sources yet.</p>'}
      </div>
      <div class="card" style="background:var(--bg)">
        <h2>Load the latest manual (v${esc(latest?.version)})</h2>
        <ol class="steps small">
          <li><a href="${esc(latest?.fullManualUrl || latest?.url)}" target="_blank" rel="noopener">Open the full official manual ↗</a></li>
          <li>In the print window that appears, choose <strong>Save as PDF</strong>.</li>
          <li>Drop that PDF below. It replaces older versions automatically.</li>
        </ol>
        <label class="drop" for="pdf-file"><strong>Choose or drop a PDF</strong><br><span class="small muted">Stays on this Mac</span></label>
        <input id="pdf-file" type="file" accept="application/pdf,.pdf" class="hidden">
        <div class="stack" style="margin-top:10px">
          <textarea id="paste-text" rows="4" placeholder="Or paste text from a manual section here" aria-label="Manual text"></textarea>
          <div class="row">
            <label class="field-label" style="flex:1">Section name<input type="text" id="paste-name" value="Pasted section"></label>
            <label class="field-label" style="width:90px">Version<input type="text" id="paste-version" value="${esc(latest?.version)}"></label>
            <button class="btn primary" data-paste>Add text</button>
          </div>
        </div>
      </div>
      <p class="small muted" id="import-msg" role="status">${esc(message)}</p>
      <p class="small muted">Meaning search: ${embedModel ? `${esc(embedModel)}${embed?.running ? ` (indexing ${embed.done} of ${embed.total})` : ' (ready)'}` : 'install an embedding model in Ollama for smarter matching; keyword search works without it'}.</p>
    </div>`;
}

async function onImportClick(e) {
  const dlg = e.currentTarget;
  const t = e.target;
  if (t.closest('[data-close]') || t === dlg) dlg.close();
  const removeId = t.dataset?.remove;
  if (removeId) {
    await api('/api/manual/remove', { method: 'POST', body: JSON.stringify({ id: removeId }) });
    await refresh(); renderImport(dlg, 'Removed.');
  }
  if (t.dataset?.paste !== undefined) {
    const text = $('#paste-text', dlg).value;
    if (text.trim().length < 40) { $('#import-msg', dlg).textContent = 'Paste some manual text first.'; return; }
    const qs = new URLSearchParams({ name: $('#paste-name', dlg).value || 'Pasted section', version: $('#paste-version', dlg).value });
    await runImport(dlg, `/api/manual/import?${qs}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: text });
  }
}

const uploadPdf = (file) => runImport($('#import-dialog'), `/api/manual/import?name=${encodeURIComponent(file.name)}`, {
  method: 'POST', headers: { 'content-type': 'application/pdf' }, body: file,
});

async function runImport(dlg, url, opts) {
  $('#import-msg', dlg).textContent = 'Reading the document…';
  try {
    const { doc, duplicate } = await api(url, opts);
    await refresh();
    renderImport(dlg, duplicate ? 'That source was already here.' : `Added ${doc.rules} rules from v${doc.version ?? '?'}.`);
  } catch (err) {
    $('#import-msg', dlg).textContent = `Could not import: ${err.message}`;
  }
}

async function toggleDoc(id, enabled) {
  await api('/api/manual/toggle', { method: 'POST', body: JSON.stringify({ id, enabled }) });
  await refresh();
}

// ---------- Router and events ----------
const ROUTES = { home: renderHome, ask: renderAsk, rules: renderRules, interview: () => renderInterview(), code: () => showCode(), timers: () => {}, field: () => {} };
let fieldModule = null;
let currentView = null;

async function route() {
  const [, view = 'home', arg] = location.hash.split('/');
  const name = ROUTES[view] ? view : 'home';
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === name));
  document.title = `${{ home: 'Vexifiy', ask: 'Ask AI', rules: 'Rulebook', interview: 'Interview', code: 'Block code', timers: 'Timers', field: '3D Field' }[name]}${name === 'home' ? '' : ' · Vexifiy'}`;
  if (currentView === 'field' && name !== 'field') fieldModule?.hide();
  if (currentView === 'timers' && name !== 'timers') timersHidden();
  if (currentView === 'interview' && name !== 'interview') interviewHidden();
  currentView = name;
  if (name === 'rules' && arg) state.ruleSel = decodeURIComponent(arg);
  if (name === 'rules' && arg) { state.smart = null; state.ruleTab = 'All'; }
  ROUTES[name]();
  if (name === 'rules') $('[aria-current=true].rule-row')?.scrollIntoView({ block: 'nearest' });
  if (name === 'timers') timersShown();
  if (name === 'field') {
    fieldModule ??= await import('./field.js');
    fieldModule.show({ onAsk: askFromAnywhere });
  }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-ask],[data-import],[data-retry],[data-level],[data-tab],[data-rule],[data-explain]');
  if (!t) return;
  const d = t.dataset;
  if (d.ask) askFromAnywhere(d.ask);
  if (d.import !== undefined) openImport();
  if (d.retry !== undefined) refresh().then(() => ROUTES[currentView]?.());
  if (d.level) {
    state.level = d.level; store.set('level', d.level);
    $$('[data-level]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.level === d.level));
  }
  if (d.tab) {
    state.ruleTab = d.tab; state.smart = null;
    $$('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tab === d.tab));
    renderRuleList();
  }
  if (d.rule) { history.replaceState(null, '', `#/rules/${d.rule}`); state.ruleSel = d.rule; renderRuleList(); renderRuleDetail(); }
  if (d.explain) {
    state.level = d.lvl; store.set('level', d.lvl);
    askFromAnywhere(`Explain rule <${d.explain}>.`);
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'rule-q') { state.ruleQuery = e.target.value; state.smart = null; renderRuleList(); }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'model') store.set('model', e.target.value);
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.id === 'composer') {
    if (state.busy) { state.busy.abort(); return; }
    const q = $('#question');
    const text = q.value;
    q.value = '';
    ask(text);
  }
  if (e.target.id === 'rule-search') {
    const q = state.ruleQuery.trim();
    if (!q) return;
    const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`);
    state.smart = results.filter((r) => r.rule);
    renderRuleList();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.id === 'question' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#composer').requestSubmit();
  }
});

async function refresh() {
  try {
    const [status, rules] = await Promise.all([api('/api/status'), api('/api/rules')]);
    state.status = status;
    state.rules = rules.rules;
    state.notes = rules.notes;
    state.knownRules = new Set(rules.rules.map((r) => r.rule));
  } catch {
    state.status = { ollama: false, chatModels: [], docs: [], latest: null };
  }
}

window.addEventListener('hashchange', route);
initTimers($('#view-timers'));
const aiHelpers = {
  models: () => state.status?.chatModels || [], modelOptions, pickModel, ollama: () => !!state.status?.ollama,
};
initInterview($('#view-interview'), aiHelpers);
initCode($('#view-code'), aiHelpers);
refresh().then(route);
route();
