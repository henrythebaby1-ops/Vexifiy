// Ranks local Ollama chat models on Level Up questions with known answers.
// Needs Vexifiy running. Usage: node scripts/benchmark-models.js model-a model-b ...
// Results go to data/model-scores.json, and the app uses them to recommend a model.
import fs from 'node:fs';

const BASE = process.env.VEXIFIY_URL || 'http://localhost:4477';
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OUT = new URL('../data/model-scores.json', import.meta.url);
const TIME_LIMIT = 120000;
const FINALISTS = 5;

// must: every pattern has to match. not: none may match. cite: tags that are correct to cite.
const QUESTIONS = [
  { quick: true, q: 'Can a Driver also be the Loader on a two person team?', must: [/\byes\b|\bmay\b|\bcan\b/i, /not (actively )?(operating|driving)|isn.t (operating|driving)/i], not: [/cannot also be/i], cite: ['GG11'] },
  { quick: true, q: 'If a bean bag counts on both L1 and L2, how many points does it get?', must: [/\b6\b|six|higher/i], not: [/\blower\b/i, /\b9\b/], cite: ['SC4'] },
  { quick: true, q: 'How is Robot Skills different from Teamwork?', must: [/one robot|single robot|solo|alone|one team/i, /autonom/i, /driv/i], not: [/skills[^.]*(only|entirely|all) autonom/i], cite: ['RSC1', 'RSC2', 'RSC3', 'RSC4'] },
  { quick: true, q: 'What are the rules for the Hang bonus at the end of the match?', must: [/(don.t|do not|doesn.t|does not) (cover|mention)|no (rule|mention)|official q&a/i], not: [/hang[^.]*\d+ points/i], cite: [] },
  { quick: true, q: 'Our team only has one person at the match. Can they drive and load?', must: [/35/, /stop|cease|must end/i], not: [/cannot also be/i], cite: ['GG11'] },
  { quick: true, q: 'What size must our robot fit in at the start of a match?', must: [/\b11\b/, /\b20\b/, /\b15\b/], not: [], cite: ['SG1', 'R3'] },
  { q: 'Can our robot hold two bean bags at once?', must: [/\bno\b|cannot|can.t|only one|one bean bag/i], not: [/\byes\b/i], cite: ['SG6'] },
  { q: 'What is the driver switch window?', must: [/0?:?35/, /0?:?25/], not: [], cite: ['GG11'] },
  { q: 'Which bean bags can score on L4?', must: [/yellow/i], not: [/\b(red|blue)[^.]*(can|may) score/i], cite: ['SC5'] },
  { q: 'How many motors can we use on the robot?', must: [/\bsix\b|\b6\b/i], not: [], cite: ['R9'] },
  { q: 'How far can a robot push a bean bag before it counts as Plowing?', must: [/tile/i], not: [], cite: ['SG6'] },
  { q: 'What is the capital of France?', must: [/(don.t|do not|doesn.t|does not) cover|official q&a/i], not: [/paris/i], cite: [] },
];

async function ask(model, q) {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: q, model }), signal: AbortSignal.timeout(TIME_LIMIT),
  });
  let answer = ''; let error = null;
  const text = await res.text();
  for (const line of text.split('\n')) {
    if (!line) continue;
    const m = JSON.parse(line);
    if (m.type === 'token') answer += m.text;
    if (m.type === 'error') error = m.message;
  }
  return { answer, error, seconds: (Date.now() - started) / 1000 };
}

const ollama = (path, body, ms = 240000) => fetch(`${OLLAMA}${path}`, {
  method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(ms),
}).then((r) => r.text());

function grade(item, answer) {
  const factual = item.must.every((re) => re.test(answer)) && !item.not.some((re) => re.test(answer));
  const tags = [...answer.matchAll(/<?\b(RSC|SC|SG|GG|S|G|R|T)(\d{1,2})\b>?/g)].map((m) => m[1] + m[2]);
  const wrongCite = item.cite.length ? tags.some((t) => !item.cite.includes(t)) : tags.length > 0;
  const goodCite = item.cite.length ? tags.some((t) => item.cite.includes(t)) : !tags.length;
  return { factual, wrongCite, goodCite };
}

async function runModel(model, items) {
  // Load first, so load time does not count against the first question.
  try { await ollama('/api/generate', { model, prompt: 'ok', stream: false, options: { num_predict: 1 } }); } catch { /* graded below */ }
  const results = [];
  for (const item of items) {
    let r;
    try { r = await ask(model, item.q); } catch (err) { r = { answer: '', error: err.message, seconds: TIME_LIMIT / 1000 }; }
    results.push({ q: item.q, answer: r.answer, error: r.error, seconds: r.seconds, ...grade(item, r.answer) });
  }
  await ollama('/api/generate', { model, keep_alive: 0 }, 20000).catch(() => {});
  const n = results.length;
  const summary = {
    model, asked: n,
    factual: results.filter((r) => r.factual).length / n,
    goodCites: results.filter((r) => r.goodCite).length / n,
    wrongCites: results.filter((r) => r.wrongCite).length / n,
    avgSeconds: results.reduce((s, r) => s + r.seconds, 0) / n,
    errors: results.filter((r) => r.error).length,
    results,
  };
  console.log(`${model}: facts ${Math.round(summary.factual * 100)}%, cited ${Math.round(summary.goodCites * 100)}%, wrong tags ${Math.round(summary.wrongCites * 100)}%, ${summary.avgSeconds.toFixed(1)}s avg`);
  return summary;
}

// Facts first, then citation quality. Speed only breaks ties, and over 45s per answer costs points.
const score = (s) => s.factual * 100 + s.goodCites * 20 - s.wrongCites * 25 - Math.max(0, s.avgSeconds - 45) * 0.5 - s.avgSeconds * 0.05;

function save(summaries, stage) {
  const ranked = [...summaries].sort((a, b) => score(b) - score(a));
  fs.writeFileSync(OUT, JSON.stringify({ tested: new Date().toISOString(), stage, ranked: ranked.map((s) => ({ ...s, score: score(s) })) }, null, 1));
  return ranked;
}

const models = process.argv.slice(2);
if (!models.length) { console.error('List the models to test.'); process.exit(1); }

const quick = QUESTIONS.filter((x) => x.quick);
const round1 = [];
for (const m of models) {
  round1.push(await runModel(m, quick));
  save(round1, 'quick');
}
const finalists = save(round1, 'quick').slice(0, FINALISTS).map((s) => s.model);
console.log(`\nFinalists: ${finalists.join(', ')}\n`);
const round2 = [];
for (const m of finalists) {
  round2.push(await runModel(m, QUESTIONS));
  save(round2, 'full');
}
console.log('\nFinal ranking:');
save(round2, 'full').forEach((s, i) => console.log(`${i + 1}. ${s.model} (score ${score(s).toFixed(1)})`));
