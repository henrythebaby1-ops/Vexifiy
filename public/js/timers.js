import { $, $$, esc, store } from './util.js';
import {
  PRESETS, blankTimer, compile, stateAt, eventsBetween, formatTime, parseTime, skillsStopTime, validateTimer,
} from './timer-core.js';
import {
  SOUND_EVENTS, STYLES, loadSoundFiles, soundFile, setSoundFile, clearSoundFile, playSound,
} from './timer-sounds.js';

const COLORS = { yellow: 'var(--yellow)', red: 'var(--red)', blue: 'var(--blue)', green: 'var(--green)', muted: 'var(--muted)' };

let root;
let custom = store.get('timers', []);
let selectedId = store.get('timer', 'teamwork');
const prefs = { sound: store.get('sound', true), voice: store.get('voice', true), style: store.get('soundStyle', 'tournament') };
const run = { def: null, timeline: null, status: 'idle', startedAt: 0, elapsed: 0, lastMs: -1, raf: 0, stop: null, callout: '', calloutUntil: 0 };
let audio = null;
let wakeLock = null;

const all = () => [...PRESETS, ...custom];
const selected = () => all().find((t) => t.id === selectedId) || PRESETS[0];

export function initTimers(el) {
  root = el;
  root.innerHTML = `<div class="timer-layout">
    <aside class="timer-side" id="timer-side"></aside>
    <div class="stage" id="stage">
      <p class="stage-title stage-hide" id="st-title"></p>
      <p class="stage-label" id="st-label"></p>
      <div class="digits" id="st-digits" role="timer" aria-live="off">1:00</div>
      <div class="bar" aria-hidden="true"><i id="st-bar" style="width:0"></i></div>
      <p class="callout" id="st-callout" role="status"></p>
      <div class="stage-controls">
        <button class="btn primary big" id="st-go">Start</button>
        <button class="btn big" id="st-reset">Reset</button>
        <button class="btn big hidden" id="st-stoptime">Record stop time</button>
      </div>
      <div class="stage-controls stage-hide">
        <button class="btn ghost" id="st-sound"></button>
        <button class="btn ghost" id="st-sounds">Sounds…</button>
        <button class="btn ghost" id="st-voice"></button>
        <button class="btn ghost" id="st-full">Fullscreen</button>
        <button class="btn ghost hidden" id="st-edit">Edit</button>
      </div>
      <p class="stage-sub stage-hide" id="st-sub"></p>
    </div>
  </div>`;
  $('#st-go', root).onclick = toggle;
  $('#st-reset', root).onclick = reset;
  $('#st-stoptime', root).onclick = recordStop;
  $('#st-full', root).onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('#stage', root).requestFullscreen?.();
  };
  $('#st-sound', root).onclick = () => { prefs.sound = !prefs.sound; store.set('sound', prefs.sound); paintPrefs(); };
  $('#st-sounds', root).onclick = openSounds;
  loadSoundFiles();
  $('#st-voice', root).onclick = () => { prefs.voice = !prefs.voice; store.set('voice', prefs.voice); paintPrefs(); };
  $('#st-edit', root).onclick = () => openEditor(selected());
  $('#timer-side', root).addEventListener('click', (e) => {
    const pick = e.target.closest('[data-timer]');
    if (pick) select(pick.dataset.timer);
    if (e.target.closest('[data-new]')) openEditor(blankTimer(), true);
  });
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && run.status === 'running') acquireWake(); });
  paintSide(); paintPrefs(); load(selected());
}

export function timersShown() { paint(); }
export function timersHidden() { /* A running timer keeps time and sound while you check a rule. */ }

function onKey(e) {
  if (!root.classList.contains('active') || e.target.matches('input,textarea,select,button') || $('dialog[open]')) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  if (e.key === 'r') reset();
  if (e.key === 'f') $('#st-full', root).click();
}

function paintPrefs() {
  $('#st-sound', root).textContent = `Sound ${prefs.sound ? 'on' : 'off'}`;
  $('#st-voice', root).textContent = `Voice ${prefs.voice ? 'on' : 'off'}`;
}

function paintSide() {
  const row = (t) => `<button class="timer-pick" data-timer="${t.id}" aria-current="${t.id === selectedId}">${esc(t.name)}<span>${esc(t.note || summary(t))}</span></button>`;
  $('#timer-side', root).innerHTML = `<h2>Official and practice</h2>${PRESETS.map(row).join('')}
    <h2>Your timers</h2>${custom.map(row).join('')}
    <button class="btn" data-new style="margin-top:6px">+ New timer</button>`;
}

const summary = (t) => {
  const total = t.segments.reduce((s, x) => s + x.seconds, 0);
  return `${t.rounds > 1 ? `${t.rounds} × ` : ''}${formatTime(total * 1000)}${t.segments.length > 1 ? `, ${t.segments.length} segments` : ''}`;
};

function select(id) {
  if (run.status === 'running' && !confirm('Stop the running timer and switch?')) return;
  selectedId = id;
  store.set('timer', id);
  paintSide();
  load(selected());
}

function load(def) {
  cancelAnimationFrame(run.raf);
  clearTimeout(run.timeout);
  releaseWake();
  Object.assign(run, { def, timeline: compile(def), status: 'idle', elapsed: 0, lastMs: -1, stop: null, callout: '', calloutUntil: 0 });
  $('#st-edit', root).classList.toggle('hidden', !!def.preset);
  paintWindowMarker();
  paint();
}

// Show cue windows on the progress bar for single-segment timers.
function paintWindowMarker() {
  const bar = $('.bar', root);
  $$('u', bar).forEach((u) => u.remove());
  const seg = run.def.segments;
  if (seg.length !== 1) return;
  for (const c of run.def.cues || []) {
    if (c.until == null) continue;
    const u = document.createElement('u');
    u.style.left = `${(1 - c.at / seg[0].seconds) * 100}%`;
    u.style.width = `${((c.at - c.until) / seg[0].seconds) * 100}%`;
    bar.append(u);
  }
}

function toggle() {
  unlockAudio();
  if (run.status === 'running') {
    run.elapsed = performance.now() - run.startedAt;
    run.status = 'paused';
    cancelAnimationFrame(run.raf);
    clearTimeout(run.timeout);
    releaseWake();
    window.speechSynthesis?.cancel();
    paint();
    return;
  }
  if (run.status === 'done') reset();
  run.status = 'running';
  run.startedAt = performance.now() - run.elapsed;
  acquireWake();
  tick();
}

function reset() {
  window.speechSynthesis?.cancel();
  load(run.def);
}

function recordStop() {
  if (run.status !== 'running') return;
  const s = stateAt(run.timeline, performance.now() - run.startedAt);
  if (s.step.kind !== 'work') return;
  run.elapsed = performance.now() - run.startedAt;
  run.stop = skillsStopTime(s.remainingMs);
  run.status = 'done-stop';
  cancelAnimationFrame(run.raf);
  clearTimeout(run.timeout);
  releaseWake();
  fire({ type: 'end', label: 'Stop' });
  paint();
}

function tick() {
  if (run.status !== 'running') return;
  const now = performance.now() - run.startedAt;
  for (const ev of eventsBetween(run.timeline, run.lastMs, now)) fire(ev);
  run.lastMs = now;
  run.elapsed = now;
  if (now >= run.timeline.totalMs) { run.status = 'done'; releaseWake(); }
  if (!document.hidden && root.classList.contains('active')) paint();
  if (run.status === 'running') {
    // Animation frames stop in a hidden tab, so fall back to a timer to keep cues firing.
    if (document.hidden) run.timeout = setTimeout(tick, 200);
    else run.raf = requestAnimationFrame(tick);
  } else paint();
}

function paint() {
  if (!run.timeline) return;
  const s = stateAt(run.timeline, run.elapsed);
  const stage = $('#stage', root);
  const finished = run.status === 'done';
  const stopped = run.status === 'done-stop';
  const idle = run.status === 'idle';
  stage.style.setProperty('--accent', COLORS[s.step.color] || COLORS.yellow);
  stage.classList.toggle('window', !!s.activeWindow && !finished);
  stage.classList.toggle('done', finished);
  $('#st-title', root).textContent = run.def.name;

  const firstWork = run.timeline.steps.find((x) => x.kind === 'work');
  const showIdle = idle ? firstWork : s.step;
  $('#st-label', root).textContent = finished ? 'Time' : stopped ? 'Stopped' : idle ? 'Ready' : `${s.step.label}${run.timeline.rounds > 1 ? ` · ${s.step.round} of ${run.timeline.rounds}` : ''}`;
  const digits = idle ? formatTime(showIdle.ms) : stopped ? formatTime(run.stop * 1000) : formatTime(s.remainingMs);
  const el = $('#st-digits', root);
  if (el.textContent !== digits) el.textContent = digits;
  $('#st-bar', root).style.width = `${idle ? 0 : s.progress * 100}%`;

  const windowText = s.activeWindow ? s.activeWindow.label : '';
  const flash = performance.now() < run.calloutUntil ? run.callout : '';
  const callout = stopped ? `Skills Stop Time: ${run.stop}s` : (windowText || flash);
  const co = $('#st-callout', root);
  if (co.textContent !== callout) co.textContent = callout;

  const go = $('#st-go', root);
  const goText = run.status === 'running' ? 'Pause' : run.status === 'paused' ? 'Resume' : (finished || stopped) ? 'Run again' : 'Start';
  if (go.textContent !== goText) go.textContent = goText;
  $('#st-stoptime', root).classList.toggle('hidden', !(run.def.stopTime && run.status === 'running' && s.step.kind === 'work'));
  $('#st-sub', root).textContent = run.def.preset && run.def.id === 'teamwork'
    ? 'Space start/pause · R reset · F fullscreen. Practice tool, not an official Match timer.'
    : 'Space start/pause · R reset · F fullscreen';
}

// ---------- Sound ----------
function unlockAudio() {
  if (!audio) { try { audio = new AudioContext(); } catch { /* no audio available */ } }
  audio?.resume?.();
}

function sound(id) {
  if (prefs.sound) playSound(audio, id, prefs.style);
}

function say(text) {
  if (!prefs.voice || !text || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.1;
  speechSynthesis.speak(u);
}

function fire(ev) {
  if (ev.type === 'tick') sound('tick');
  if (ev.type === 'start') { sound(ev.step?.kind === 'work' ? 'start' : 'tick'); if (ev.step?.kind !== 'work' || run.timeline.rounds > 1) say(ev.label); }
  if (ev.type === 'cue') {
    sound('switch');
    say(ev.label);
    run.callout = ev.label; run.calloutUntil = performance.now() + 3500;
  }
  if (ev.type === 'end') sound('end');
}

async function acquireWake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
}
function releaseWake() { wakeLock?.release?.().catch(() => {}); wakeLock = null; }

// ---------- Editor ----------
function openEditor(source, isNew = false) {
  const draft = structuredClone(source);
  let dlg = $('#timer-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'timer-dialog';
    document.body.append(dlg);
  }
  const mmss = (s) => (s == null ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

  const render = (errors = []) => {
    dlg.innerHTML = `<form method="dialog" class="stack" id="timer-form" novalidate>
      <div class="dialog-head" style="margin:0"><h2 style="font-size:1.15rem">${isNew ? 'New timer' : 'Edit timer'}</h2><button type="button" class="btn ghost" data-x="close" aria-label="Close">✕</button></div>
      <label class="field-label">Name<input type="text" id="te-name" value="${esc(draft.name)}" maxlength="60"></label>
      <fieldset><legend>Segments, in order</legend>
        ${draft.segments.map((s, i) => `<div class="editor-row seg-row">
          <label class="field-label">Name<input type="text" data-seg="${i}" data-f="label" value="${esc(s.label)}"></label>
          <label class="field-label">Time<input type="text" data-seg="${i}" data-f="seconds" value="${mmss(s.seconds)}" placeholder="1:00" inputmode="numeric"></label>
          <label class="field-label">Color<select data-seg="${i}" data-f="color">${['yellow', 'red', 'blue', 'green'].map((c) => `<option ${s.color === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <button type="button" class="btn ghost icon-btn" data-x="del-seg" data-i="${i}" aria-label="Remove segment" ${draft.segments.length < 2 ? 'disabled' : ''}>✕</button>
        </div>`).join('')}
        <button type="button" class="btn" data-x="add-seg">+ Segment</button>
      </fieldset>
      <fieldset><legend>Cues, by time left in the last segment</legend>
        ${(draft.cues || []).map((c, i) => `<div class="editor-row cue-row">
          <label class="field-label">Say<input type="text" data-cue="${i}" data-f="label" value="${esc(c.label)}"></label>
          <label class="field-label">At<input type="text" data-cue="${i}" data-f="at" value="${mmss(c.at)}" placeholder="0:30"></label>
          <label class="field-label">Until<input type="text" data-cue="${i}" data-f="until" value="${mmss(c.until)}" placeholder="opt."></label>
          <button type="button" class="btn ghost icon-btn" data-x="del-cue" data-i="${i}" aria-label="Remove cue">✕</button>
        </div>`).join('')}
        <button type="button" class="btn" data-x="add-cue">+ Cue</button>
        <p class="small muted" style="margin-top:6px">Set “Until” to highlight a window, like a driver switch.</p>
      </fieldset>
      <div class="grid-3">
        <label class="field-label">Rounds<input type="number" id="te-rounds" min="1" max="99" value="${draft.rounds}"></label>
        <label class="field-label">Rest (sec)<input type="number" id="te-rest" min="0" value="${draft.rest}"></label>
        <label class="field-label">Lead-in (sec)<input type="number" id="te-lead" min="0" max="30" value="${draft.leadIn}"></label>
      </div>
      <label class="toggle"><input type="checkbox" id="te-stop" ${draft.stopTime ? 'checked' : ''}> Show “Record stop time” button</label>
      ${errors.length ? `<ul class="errors" role="alert">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
      <div class="row" style="justify-content:space-between">
        ${isNew ? '<span></span>' : '<button type="button" class="btn ghost danger" data-x="delete">Delete timer</button>'}
        <div class="row"><button type="button" class="btn" data-x="close">Cancel</button><button type="button" class="btn primary" data-x="save">Save</button></div>
      </div>
    </form>`;
  };

  const readForm = () => {
    draft.name = $('#te-name', dlg).value;
    draft.rounds = Number($('#te-rounds', dlg).value);
    draft.rest = Number($('#te-rest', dlg).value);
    draft.leadIn = Number($('#te-lead', dlg).value);
    draft.stopTime = $('#te-stop', dlg).checked;
    $$('[data-seg]', dlg).forEach((el) => {
      const seg = draft.segments[el.dataset.seg];
      seg[el.dataset.f] = el.dataset.f === 'seconds' ? parseTime(el.value) : el.value;
    });
    $$('[data-cue]', dlg).forEach((el) => {
      const cue = draft.cues[el.dataset.cue];
      if (el.dataset.f === 'label') cue.label = el.value;
      else cue[el.dataset.f] = el.value.trim() ? (parseTime(el.value) ?? -1) : null;
    });
  };

  dlg.onclick = (e) => {
    if (e.target === dlg) { dlg.close(); return; }
    const x = e.target.closest('[data-x]');
    if (!x) return;
    const action = x.dataset.x;
    if (action === 'close') { dlg.close(); return; }
    readForm();
    if (action === 'add-seg') draft.segments.push({ label: 'Segment', seconds: 30, color: 'yellow' });
    if (action === 'del-seg') draft.segments.splice(Number(x.dataset.i), 1);
    if (action === 'add-cue') (draft.cues ||= []).push({ label: 'Cue', at: 10, until: null });
    if (action === 'del-cue') draft.cues.splice(Number(x.dataset.i), 1);
    if (action === 'delete') {
      if (!confirm(`Delete “${draft.name}”?`)) return;
      custom = custom.filter((t) => t.id !== draft.id);
      store.set('timers', custom);
      dlg.close();
      selectedId = 'teamwork';
      paintSide(); load(selected());
      return;
    }
    if (action === 'save') {
      draft.cues = (draft.cues || []).map((c) => ({ ...c, until: c.until ?? undefined }));
      const errors = validateTimer(draft);
      if (errors.length) { render(errors); return; }
      const i = custom.findIndex((t) => t.id === draft.id);
      if (i >= 0) custom[i] = draft; else custom.push(draft);
      store.set('timers', custom);
      dlg.close();
      selectedId = draft.id;
      store.set('timer', draft.id);
      paintSide(); load(draft);
      return;
    }
    render();
  };

  render();
  dlg.showModal();
}

// ---------- Sounds dialog ----------
function openSounds() {
  unlockAudio();
  let dlg = $('#sounds-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'sounds-dialog';
    document.body.append(dlg);
    dlg.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-s]');
      if (!t) return;
      if (t.dataset.s === 'close') dlg.close();
      if (t.dataset.s === 'test') playSound(audio, t.dataset.id, prefs.style);
      if (t.dataset.s === 'clear') { await clearSoundFile(t.dataset.id); paintSounds(dlg); }
    });
    dlg.addEventListener('change', async (e) => {
      if (e.target.id === 'sound-style') { prefs.style = e.target.value; store.set('soundStyle', prefs.style); }
      if (e.target.dataset.file && e.target.files[0]) {
        try { await setSoundFile(e.target.dataset.file, e.target.files[0]); paintSounds(dlg); playSound(audio, e.target.dataset.file, prefs.style); }
        catch (err) { paintSounds(dlg, err.message); }
      }
    });
  }
  paintSounds(dlg);
  if (!dlg.open) dlg.showModal();
}

function paintSounds(dlg, error = '') {
  dlg.innerHTML = `<div class="dialog-head"><h2 style="font-size:1.15rem">Timer sounds</h2><button class="btn ghost" data-s="close" aria-label="Close">✕</button></div>
    <label class="field-label">Built-in style<select id="sound-style">${STYLES.map(([v, l]) => `<option value="${v}" ${v === prefs.style ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <p class="small muted" style="margin:12px 0 6px">Have recordings of the sounds your events use? Add them here. Files stay in this browser on this computer.</p>
    <div class="sound-rows">${SOUND_EVENTS.map((ev) => {
      const name = soundFile(ev.id);
      return `<div class="sound-row">
        <span><b>${ev.name}</b><br><span class="small muted">${name ? esc(name) : 'Built-in'}</span></span>
        <span class="sound-actions">
          <button class="btn" data-s="test" data-id="${ev.id}">Play</button>
          <label class="btn">Choose file<input type="file" accept="audio/*" data-file="${ev.id}" hidden></label>
          ${name ? `<button class="btn ghost" data-s="clear" data-id="${ev.id}">Use built-in</button>` : ''}
        </span>
      </div>`;
    }).join('')}</div>
    ${error ? `<p class="msg-error" style="margin-top:8px">${esc(error)}</p>` : ''}`;
}
