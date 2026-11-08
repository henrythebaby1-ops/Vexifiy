// Timer logic with no browser dependencies, so it can be unit tested.
// Time is always derived from elapsed milliseconds, so a busy tab never drifts.

export const PRESETS = [
  {
    id: 'teamwork', name: 'Teamwork Match', note: '1:00 with driver switch window (GG11)', preset: true, leadIn: 3, rounds: 1, rest: 0,
    segments: [{ label: 'Driver control', seconds: 60, color: 'yellow' }],
    cues: [
      { at: 35, until: 25, label: 'Switch drivers' },
      { at: 25, label: 'Switch window closed' },
    ],
  },
  {
    id: 'driving', name: 'Driving Skills', note: '1:00 driver control', preset: true, leadIn: 3, rounds: 1, rest: 0, stopTime: true,
    segments: [{ label: 'Driving Skills', seconds: 60, color: 'blue' }], cues: [],
  },
  {
    id: 'auto', name: 'Autonomous Coding Skills', note: '1:00 autonomous', preset: true, leadIn: 3, rounds: 1, rest: 0, stopTime: true,
    segments: [{ label: 'Autonomous', seconds: 60, color: 'green' }], cues: [],
  },
  {
    id: 'drill', name: 'Back-to-back match drill', note: '5 matches with 45s resets', preset: true, leadIn: 3, rounds: 5, rest: 45,
    segments: [{ label: 'Match', seconds: 60, color: 'yellow' }],
    cues: [{ at: 35, until: 25, label: 'Switch drivers' }],
  },
  {
    id: 'relay', name: 'Load Zone relay', note: '6 × 15s load-and-score sprints', preset: true, leadIn: 3, rounds: 6, rest: 10,
    segments: [{ label: 'Sprint', seconds: 15, color: 'red' }], cues: [],
  },
];

export const blankTimer = () => ({
  id: `t${Date.now().toString(36)}`, name: 'My timer', note: '', leadIn: 3, rounds: 1, rest: 0, stopTime: false,
  segments: [{ label: 'Go', seconds: 60, color: 'yellow' }], cues: [],
});

export const formatTime = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const parseTime = (text) => {
  const t = String(text).trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,3})(?::([0-5]?\d))?$/);
  if (!m) return null;
  return m[2] === undefined ? Number(m[1]) : Number(m[1]) * 60 + Number(m[2]);
};

// Flatten a timer definition into a list of steps.
export function compile(def) {
  const steps = [];
  let start = 0;
  const push = (step) => { steps.push({ ...step, startMs: start, ms: step.seconds * 1000 }); start += step.seconds * 1000; };
  if (def.leadIn > 0) push({ label: 'Get ready', seconds: def.leadIn, color: 'muted', kind: 'leadin', round: 1, cues: [] });
  const rounds = Math.max(1, def.rounds || 1);
  for (let r = 1; r <= rounds; r++) {
    def.segments.forEach((seg, i) => push({
      ...seg, kind: 'work', round: r, cues: i === def.segments.length - 1 ? (def.cues || []) : [],
    }));
    if (def.rest > 0 && r < rounds) push({ label: 'Reset', seconds: def.rest, color: 'muted', kind: 'rest', round: r, cues: [] });
  }
  return { steps, totalMs: start, rounds };
}

export function stateAt(timeline, elapsedMs) {
  const { steps, totalMs } = timeline;
  if (elapsedMs >= totalMs) {
    const last = steps[steps.length - 1];
    return { done: true, step: last, stepIndex: steps.length - 1, remainingMs: 0, totalRemainingMs: 0, progress: 1, activeWindow: null };
  }
  const t = Math.max(0, elapsedMs);
  const stepIndex = steps.findIndex((s) => t < s.startMs + s.ms);
  const step = steps[stepIndex];
  const remainingMs = step.startMs + step.ms - t;
  const activeWindow = step.cues.find((c) => c.until != null && remainingMs <= c.at * 1000 && remainingMs > c.until * 1000) || null;
  return {
    done: false, step, stepIndex, remainingMs, totalRemainingMs: totalMs - t,
    progress: 1 - remainingMs / step.ms, activeWindow,
  };
}

// Everything that should make a sound between two moments. Half-open: (from, to].
export function eventsBetween(timeline, fromMs, toMs) {
  const events = [];
  const crossed = (ms) => ms > fromMs && ms <= toMs;
  for (const step of timeline.steps) {
    const end = step.startMs + step.ms;
    if (step.kind !== 'leadin' && (crossed(step.startMs) || (fromMs < 0 && step.startMs === 0 && toMs >= 0))) {
      events.push({ type: 'start', label: step.label, step });
    }
    for (const cue of step.cues) {
      if (crossed(end - cue.at * 1000)) events.push({ type: 'cue', label: cue.label, step });
      if (cue.until != null && crossed(end - cue.until * 1000)) events.push({ type: 'tick', label: '', step });
    }
    for (let s = 1; s <= 3; s++) {
      if (crossed(end - s * 1000) && step.seconds >= s) events.push({ type: 'tick', label: String(s), step });
    }
  }
  if (crossed(timeline.totalMs)) events.push({ type: 'end', label: 'Time' });
  return events;
}

// Skills Stop Time is read in whole seconds, rounded up from a manual timer (RSC8).
export const skillsStopTime = (remainingMs) => Math.max(0, Math.ceil(remainingMs / 1000));

export function validateTimer(def) {
  const errors = [];
  if (!def.name?.trim()) errors.push('Give the timer a name.');
  if (!def.segments?.length) errors.push('Add at least one segment.');
  def.segments?.forEach((s, i) => {
    if (!(s.seconds > 0)) errors.push(`Segment ${i + 1} needs a time like 1:00 or 45.`);
    if (!s.label?.trim()) errors.push(`Segment ${i + 1} needs a name.`);
  });
  const last = def.segments?.[def.segments.length - 1];
  def.cues?.forEach((c, i) => {
    if (c.at == null || c.at < 0) errors.push(`Cue ${i + 1} needs a time.`);
    else if (last && c.at >= last.seconds) errors.push(`Cue ${i + 1} must be under the last segment's length.`);
    if (c.until != null && c.until >= c.at) errors.push(`Cue ${i + 1}'s window must end after it starts (a smaller time left).`);
    if (!c.label?.trim()) errors.push(`Cue ${i + 1} needs a label.`);
  });
  if (!(def.rounds >= 1)) errors.push('Rounds must be 1 or more.');
  if (def.rest < 0 || def.leadIn < 0) errors.push('Lead-in and rest cannot be negative.');
  return errors;
}
