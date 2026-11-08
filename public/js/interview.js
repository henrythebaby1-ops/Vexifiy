// Judges' interview practice page.
import { $, esc, api, store } from './util.js';
import {
  CATEGORIES, MAX_SCORE, MAX_ANSWER, categoryById, planInterview, summarize, levelOf, wordCount,
} from './interview-core.js';

const iv = { phase: 'setup', plan: [], step: 0, results: [], grading: false, error: '', started: 0, timer: null };
let root = null;
let helpers = null;

const history = () => store.get('interview.history', []);
const catName = (id) => categoryById(id)?.name || id;
const scoreBar = (score) => `<span class="iv-bar" aria-hidden="true">${Array.from({ length: MAX_SCORE }, (_, i) => `<i class="${i < score ? 'on' : ''}"></i>`).join('')}</span>`;
const clock = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function initInterview(container, h) {
  root = container;
  helpers = h;
  root.addEventListener('click', onClick);
  root.addEventListener('input', (e) => { if (e.target.id === 'iv-answer') updateCount(); });
  root.addEventListener('keydown', (e) => {
    if (e.target.id === 'iv-answer' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  });
  root.addEventListener('change', (e) => { if (e.target.id === 'iv-model') store.set('model', e.target.value); });
}

export function renderInterview() {
  if (!root) return;
  if (iv.phase === 'setup') renderSetup();
  else if (iv.phase === 'question') renderQuestion();
  else renderResults();
}

export function interviewHidden() { stopTimer(); }

function modelPicker() {
  const models = helpers.models();
  return `<select id="iv-model" aria-label="AI judge model">${helpers.modelOptions(models, helpers.pickModel(models))}</select>`;
}

function renderSetup() {
  stopTimer();
  const past = history();
  const ollama = helpers.ollama();
  root.innerHTML = `<div class="page iv">
    <div class="page-head">
      <div><h1>Interview practice</h1><p class="muted">Practice your judges' team interview. An AI judge asks questions, then scores each answer and gives tips.</p></div>
    </div>
    ${ollama ? '' : '<div class="banner bad"><span>Ollama isn\'t running, so the AI judge can\'t score answers. Start Ollama, then reload.</span></div>'}
    <div class="iv-setup">
      <div class="card">
        <h2>Start an interview</h2>
        <div class="iv-options">
          <button class="card iv-option" data-iv-start="quick"><b>Quick</b><span class="small muted">5 questions · about 5 minutes</span></button>
          <button class="card iv-option" data-iv-start="full"><b>Full interview</b><span class="small muted">${CATEGORIES.length} questions, one per area · about 10 minutes</span></button>
        </div>
        <label class="field-label" style="margin-top:12px">AI judge${modelPicker()}</label>
        <p class="small muted" style="margin-top:12px">Tips: answer like you're talking to a real judge. Use your own words, give real examples, and say what you tested and changed. Every teammate should take turns answering.</p>
      </div>
      <div class="card">
        <h2>What judges ask about</h2>
        <ul class="iv-areas">${CATEGORIES.map((c) => `<li><b>${esc(c.name)}</b><span class="small muted">${esc(c.looksFor)}</span></li>`).join('')}</ul>
      </div>
    </div>
    ${past.length ? `<div class="card" style="margin-top:14px"><h2>Past practice</h2>
      <div class="iv-history">${past.slice(0, 8).map((p) => `<div class="iv-hist-row"><span>${esc(new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span><span>${p.count} questions</span><b>${p.percent}%</b><span class="muted">${esc(p.level)}</span></div>`).join('')}</div>
    </div>` : ''}
    <p class="small muted" style="margin-top:14px">Practice only. These areas are modeled on what VIQRC judges look for, not the official rubric. The REC Foundation's Guide to Judging has the real one. Answers stay on this computer.</p>
  </div>`;
}

function start(opts) {
  const recent = store.get('interview.recent', []);
  iv.plan = planInterview({ ...opts, avoid: recent });
  store.set('interview.recent', [...iv.plan.map((p) => p.question), ...recent].slice(0, 60));
  iv.step = 0;
  iv.results = [];
  iv.error = '';
  iv.phase = 'question';
  renderQuestion();
}

function renderQuestion() {
  const item = iv.plan[iv.step];
  const result = iv.results[iv.step];
  const cat = categoryById(item.category);
  root.innerHTML = `<div class="page iv">
    <div class="iv-top">
      <span class="small muted">Question ${iv.step + 1} of ${iv.plan.length} · ${esc(cat.name)}</span>
      <button class="btn ghost" data-iv-quit>End interview</button>
    </div>
    <div class="iv-progress"><i style="width:${(iv.step / iv.plan.length) * 100}%"></i></div>
    <div class="card iv-question">
      <span class="iv-judge" aria-hidden="true">J</span>
      <p>${esc(item.question)}</p>
    </div>
    ${result ? renderFeedback(result) : `
      <textarea id="iv-answer" rows="7" maxlength="${MAX_ANSWER}" placeholder="Type your answer the way you'd say it out loud." aria-label="Your answer" ${iv.grading ? 'disabled' : ''}>${esc(iv.draft || '')}</textarea>
      <div class="iv-actions">
        <span class="small muted"><span id="iv-clock">0:00</span> · <span id="iv-count">0 words</span></span>
        <span>
          <button class="btn ghost" data-iv-skip ${iv.grading ? 'disabled' : ''}>Skip</button>
          <button class="btn primary" data-iv-submit ${iv.grading ? 'disabled' : ''}>${iv.grading ? 'The judge is thinking…' : 'Submit answer'}</button>
        </span>
      </div>
      ${iv.error ? `<p class="msg-error">${esc(iv.error)}</p>` : ''}`}
  </div>`;
  if (!result) {
    updateCount();
    if (!iv.grading) { $('#iv-answer', root).focus(); startTimer(); }
  } else stopTimer();
}

function renderFeedback(r) {
  const last = iv.step === iv.plan.length - 1;
  if (r.score == null) {
    return `<div class="card iv-feedback"><p class="muted">Skipped. Judges will ask about this area, so try it next time.</p>
      <div class="iv-actions"><span></span><button class="btn primary" data-iv-next>${last ? 'See results' : 'Next question'}</button></div></div>`;
  }
  return `<div class="card iv-feedback">
    <div class="iv-score"><b>${r.score}/${MAX_SCORE}</b>${scoreBar(r.score)}<span class="iv-level ${levelOf(r.score).toLowerCase()}">${levelOf(r.score)}</span><span class="small muted">${clock(r.ms)} · ${wordCount(r.answer)} words</span></div>
    <details class="iv-yours"><summary class="small muted">Your answer</summary><p>${esc(r.answer)}</p></details>
    <p><b>Good:</b> ${esc(r.strengths)}</p>
    <p><b>Try next time:</b> ${esc(r.improve)}</p>
    ${r.capped ? '<p class="small muted">Short answers can only score so high. Add an example or a detail about what you tested.</p>' : ''}
    ${r.followUp ? `<p class="iv-follow"><span class="small muted">A judge might follow up with</span><br>“${esc(r.followUp)}”</p>` : ''}
    <div class="iv-actions"><button class="btn ghost" data-iv-retry>Answer again</button><button class="btn primary" data-iv-next>${last ? 'See results' : 'Next question'}</button></div>
  </div>`;
}

function updateCount() {
  const text = $('#iv-answer', root)?.value || '';
  iv.draft = text;
  const n = wordCount(text);
  const el = $('#iv-count', root);
  if (el) el.textContent = `${n} word${n === 1 ? '' : 's'}`;
}

function startTimer() {
  stopTimer();
  iv.started ||= Date.now();
  const tick = () => { const el = $('#iv-clock', root); if (el) el.textContent = clock(Date.now() - iv.started); };
  tick();
  iv.timer = setInterval(tick, 1000);
}
function stopTimer() { clearInterval(iv.timer); iv.timer = null; }

async function submit() {
  if (iv.grading) return;
  const answer = ($('#iv-answer', root)?.value || '').trim();
  if (!answer) { iv.error = 'Type an answer first, or press Skip.'; renderQuestion(); return; }
  const item = iv.plan[iv.step];
  const ms = Date.now() - iv.started;
  const model = $('#iv-model') ? $('#iv-model').value : helpers.pickModel(helpers.models());
  iv.grading = true; iv.error = ''; stopTimer();
  renderQuestion();
  try {
    const grade = await api('/api/interview/grade', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...item, answer, model }),
    });
    iv.results[iv.step] = { ...item, ...grade, answer, ms };
    iv.draft = '';
  } catch (err) {
    iv.error = err.message;
  } finally {
    iv.grading = false;
    if (iv.phase === 'question') renderQuestion();
  }
}

function next() {
  iv.started = 0; iv.draft = ''; iv.error = '';
  if (iv.step < iv.plan.length - 1) { iv.step += 1; renderQuestion(); return; }
  finish();
}

function finish() {
  stopTimer();
  iv.phase = 'results';
  const done = iv.results.filter(Boolean);
  if (done.length) {
    const s = summarize(done);
    store.set('interview.history', [{ date: Date.now(), count: done.length, percent: s.percent, level: s.level }, ...history()].slice(0, 20));
  }
  renderResults();
}

function renderResults() {
  const done = iv.results.filter(Boolean);
  if (!done.length) { iv.phase = 'setup'; renderSetup(); return; }
  const s = summarize(done);
  root.innerHTML = `<div class="page iv">
    <div class="page-head"><div><h1>Interview results</h1><p class="muted">${done.length} question${done.length === 1 ? '' : 's'}${s.skipped ? `, ${s.skipped} skipped` : ''}</p></div></div>
    <div class="iv-summary">
      <div class="card iv-total"><b>${s.percent}%</b><span>${s.total} of ${s.max} points</span><span class="iv-level ${s.level.toLowerCase()}">${s.level}</span></div>
      <div class="card">
        ${s.strongest ? `<p><b>Strongest area:</b> ${esc(catName(s.strongest))}</p>` : ''}
        ${s.practice.length ? `<p><b>Practice next:</b> ${s.practice.map((c) => esc(catName(c))).join(', ')}</p>` : '<p>Every area scored 3 or higher. Nice work. Try the full interview again with a teammate answering.</p>'}
        <div class="iv-actions" style="justify-content:flex-start">
          ${s.practice.length ? `<button class="btn primary" data-iv-weak="${esc(s.practice.join(','))}">Practice those areas</button>` : ''}
          <button class="btn" data-iv-again>New interview</button>
        </div>
      </div>
    </div>
    <div class="iv-rows">${done.map((r) => `<details class="card iv-row">
      <summary><span class="iv-row-name">${esc(catName(r.category))}</span>${r.score == null ? '<span class="muted small">Skipped</span>' : `${scoreBar(r.score)}<b>${r.score}/${MAX_SCORE}</b>`}</summary>
      <p class="small muted">${esc(r.question)}</p>
      ${r.score == null ? '' : `<p class="iv-yours-text">${esc(r.answer)}</p><p><b>Good:</b> ${esc(r.strengths)}</p><p><b>Try next time:</b> ${esc(r.improve)}</p>`}
    </details>`).join('')}</div>
  </div>`;
}

function onClick(e) {
  const t = e.target.closest('[data-iv-start],[data-iv-submit],[data-iv-skip],[data-iv-next],[data-iv-retry],[data-iv-quit],[data-iv-again],[data-iv-weak]');
  if (!t) return;
  const d = t.dataset;
  if (d.ivStart) start({ count: d.ivStart === 'quick' ? 5 : CATEGORIES.length });
  if (d.ivSubmit !== undefined) submit();
  if (d.ivSkip !== undefined) { iv.results[iv.step] = { ...iv.plan[iv.step], score: null, ms: 0 }; renderQuestion(); }
  if (d.ivNext !== undefined) next();
  if (d.ivRetry !== undefined) { iv.draft = iv.results[iv.step]?.answer || ''; iv.results[iv.step] = undefined; iv.started = 0; renderQuestion(); }
  if (d.ivQuit !== undefined) { iv.results = iv.results.slice(0, iv.step + 1); finish(); }
  if (d.ivAgain !== undefined) { iv.phase = 'setup'; renderSetup(); }
  if (d.ivWeak) start({ only: d.ivWeak.split(',') });
}
