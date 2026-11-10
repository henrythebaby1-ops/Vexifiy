// Timer sounds: a built-in "tournament" set made in code, the classic beeps, or the user's own files.
// Your own files are kept in this browser (IndexedDB) and never leave this computer.

// `file` is the name Vexifiy looks for in the project's sounds/ folder.
export const SOUND_EVENTS = [
  { id: 'start', name: 'Match start', file: 'match-start-cue.mp3' },
  { id: 'switch', name: 'Driver switch', file: 'driver-switch-cue.mp3' },
  { id: 'tick', name: 'Countdown tick', file: 'countdown-tick-cue.mp3' },
  { id: 'end', name: 'End buzzer', file: 'end-buzzer-cue.mp3' },
];
export const MAX_FILE = 5 * 1024 * 1024;

const DB = 'vexifiy-sounds';
const files = {}; // sounds picked in the browser: id -> { name, blob, buffer }
const folder = {}; // sounds found in the sounds/ folder: id -> { name, buffer }
let decoder = null;
const decode = async (blob) => {
  decoder ||= new OfflineAudioContext(1, 1, 44100);
  return decoder.decodeAudioData(await blob.arrayBuffer());
};

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('files', mode);
    const out = fn(t.objectStore('files'));
    t.oncomplete = () => resolve(out?.result);
    t.onerror = () => reject(t.error);
  });
};

export async function loadSoundFiles() {
  let present = [];
  try { present = (await (await fetch('/api/sounds')).json()).files || []; } catch { /* offline */ }
  await Promise.all(SOUND_EVENTS.filter((e) => present.includes(e.file)).map(async ({ id, file }) => {
    try {
      const res = await fetch(`/sounds/${file}`);
      if (res.ok) folder[id] = { name: file, buffer: await decode(await res.blob()) };
    } catch { /* no file, or not a sound: use the built-in one */ }
  }));
  try {
    for (const { id } of SOUND_EVENTS) {
      const rec = await tx('readonly', (s) => s.get(id));
      if (rec?.blob) files[id] = { name: rec.name, blob: rec.blob, buffer: await decode(rec.blob).catch(() => null) };
    }
  } catch { /* storage blocked: built-in sounds still work */ }
}

// Where a sound comes from: 'browser', 'folder' or null for built-in.
export const soundSource = (id) => (files[id] ? { from: 'browser', name: files[id].name } : folder[id] ? { from: 'folder', name: folder[id].name } : null);
export const soundFile = (id) => soundSource(id)?.name || null;


export async function setSoundFile(id, file) {
  if (file.size > MAX_FILE) throw new Error('Please pick a sound under 5 MB.');
  if (!/^audio\//.test(file.type) && !/\.(mp3|wav|m4a|ogg|aac|flac)$/i.test(file.name)) throw new Error('That does not look like a sound file.');
  const rec = { name: file.name, blob: file };
  let buffer;
  try { buffer = await decode(file); } catch { throw new Error('That sound file could not be played. Try an MP3 or WAV.'); }
  files[id] = { ...rec, buffer };
  try { await tx('readwrite', (s) => s.put(rec, id)); } catch { /* keeps working for this visit */ }
}

export async function clearSoundFile(id) {
  delete files[id];
  try { await tx('readwrite', (s) => s.delete(id)); } catch { /* ignore */ }
}

async function playFile(ctx, id, volume) {
  const f = files[id]?.buffer ? files[id] : folder[id];
  if (!f?.buffer) return false;
  try {
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.buffer = f.buffer;
    src.connect(gain).connect(ctx.destination);
    src.start();
    return true;
  } catch {
    return false; // unreadable file: fall back to a built-in sound
  }
}

// ---------- Built-in sounds ----------
function tone(ctx, { type = 'sine', freqs, start = 0, dur, peak = 0.2, attack = 0.01, release = 0.12, filter = null, out }) {
  const t = ctx.currentTime + start;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.gain.setValueAtTime(peak, t + Math.max(attack, dur - release));
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = gain;
  if (filter) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = filter; lp.Q.value = 0.8;
    gain.connect(lp); node = lp;
  }
  node.connect(out);
  for (const f of freqs) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f;
    osc.connect(gain);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
}

const TOURNAMENT = {
  // Air-horn style blast: a detuned brass chord.
  start: (ctx, out) => tone(ctx, { type: 'sawtooth', freqs: [233, 235.5, 294, 349], dur: 1.1, peak: 0.13, attack: 0.03, release: 0.18, filter: 2200, out }),
  // Two-tone chime for the driver switch.
  switch: (ctx, out) => {
    tone(ctx, { type: 'triangle', freqs: [988, 1976], dur: 0.55, peak: 0.22, release: 0.45, out });
    tone(ctx, { type: 'triangle', freqs: [740, 1480], start: 0.28, dur: 0.8, peak: 0.22, release: 0.7, out });
  },
  tick: (ctx, out) => tone(ctx, { type: 'triangle', freqs: [1320], dur: 0.09, peak: 0.25, attack: 0.003, release: 0.08, out }),
  // Low, buzzy end-of-match buzzer.
  end: (ctx, out) => tone(ctx, { type: 'square', freqs: [98, 103.5, 196], dur: 1.4, peak: 0.12, attack: 0.02, release: 0.2, filter: 1400, out }),
};

const CLASSIC = {
  start: (ctx, out) => tone(ctx, { type: 'square', freqs: [1040], dur: 0.42, peak: 0.25, attack: 0.003, release: 0.4, out }),
  switch: (ctx, out) => {
    tone(ctx, { type: 'square', freqs: [880], dur: 0.18, peak: 0.25, attack: 0.003, release: 0.17, out });
    tone(ctx, { type: 'square', freqs: [1100], start: 0.2, dur: 0.24, peak: 0.25, attack: 0.003, release: 0.23, out });
  },
  tick: (ctx, out) => tone(ctx, { type: 'square', freqs: [880], dur: 0.11, peak: 0.25, attack: 0.003, release: 0.1, out }),
  end: (ctx, out) => tone(ctx, { type: 'square', freqs: [320], dur: 0.9, peak: 0.35, attack: 0.003, release: 0.88, out }),
};

export const STYLES = [['tournament', 'Tournament (horn and buzzer)'], ['classic', 'Classic beeps']];

export async function playSound(ctx, id, style = 'tournament', volume = 1) {
  if (!ctx) return;
  if (await playFile(ctx, id, volume)) return;
  const out = ctx.createGain();
  out.gain.value = volume;
  out.connect(ctx.destination);
  (style === 'classic' ? CLASSIC : TOURNAMENT)[id]?.(ctx, out);
}
