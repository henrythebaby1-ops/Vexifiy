import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkManual, preferNewest, detectVersion, versionFromName, dropStale, ruleRefs, buildBm25, bm25Rank, fuse, buildMessages } from '../lib/manual.js';
import { compile, stateAt, eventsBetween, formatTime, parseTime, skillsStopTime, validateTimer, PRESETS } from '../public/js/timer-core.js';
import { locate, scoreBag, tally, FIELD_BAGS, LOAD_BAGS, ZONES, mirror } from '../public/js/field-data.js';

const preset = (id) => PRESETS.find((p) => p.id === id);

test('rules become whole chunks and quick-reference stubs do not win', () => {
  const pages = [
    { page: 5, text: '<SG6>\nPossession is limited to one\n<SG7>\nUsing the Load Zone' },
    { page: 20, text: 'Version 2.1 - Released October 8, 2026\n<SG6> Possession is limited to one (1) Bean Bag.\na. Details about plowing here.\n<SG7> Using the Load Zone. Load one at a time.\nSection 3 - Robot Skills\nMore intro text that should not join the previous rule, long enough to count as content.' },
  ];
  const chunks = chunkManual(pages, { source: 't', version: '2.1', docId: 'd' });
  const sg6 = chunks.find((c) => c.rule === 'SG6');
  assert.equal(sg6.page, 20);
  assert.match(sg6.text, /plowing/);
  assert.doesNotMatch(chunks.find((c) => c.rule === 'SG7').text, /Robot Skills/);
});

test('inline rule mentions do not start a new rule', () => {
  const chunks = chunkManual([{ page: 1, text: '<SC1> Scores are checked after the Match, see rule <GG12> for details.' }], { source: 't', version: '2.1', docId: 'd' });
  assert.deepEqual(chunks.filter((c) => c.rule).map((c) => c.rule), ['SC1']);
});

test('a newer source wins rule by rule', () => {
  const kept = preferNewest([
    { rule: 'SC4', version: '0.1', text: 'old' },
    { rule: 'SC4', version: '2.1', text: 'new' },
    { rule: 'SC5', version: '0.1', text: 'only' },
    { rule: null, version: '0.1', text: 'loose' },
  ]);
  assert.deepEqual(kept.map((c) => c.text), ['new', 'only', 'loose']);
});

test('version 2.10 sorts after 2.9', () => {
  const kept = preferNewest([{ rule: 'A1', version: '2.9', text: 'a' }, { rule: 'A1', version: '2.10', text: 'b' }]);
  assert.equal(kept[0].text, 'b');
});

test('version and rule references are detected', () => {
  assert.equal(detectVersion('foo Version 0.1 - Released'), '0.1');
  assert.equal(versionFromName('IQ Full Manual v2.1.pdf'), '2.1');
  assert.equal(versionFromName('VIQRC-level-up-0.1-manual.pdf'), '0.1');
  assert.equal(versionFromName('manual.pdf'), null);
  assert.deepEqual(ruleRefs('is <sg7> or GG11 relevant to T5?'), ['SG7', 'GG11', 'T5']);
  assert.deepEqual(ruleRefs('Bean Bags at level 4'), []);
});

test('naming a rule puts it first and keyword search finds content', () => {
  const chunks = [
    { rule: 'SG7', title: 'Using the Load Zone', text: 'Loaded one at a time' },
    { rule: 'SC5', title: 'L4', text: 'yellow bean bag on the top' },
  ];
  const q1 = 'what does SC5 mean';
  assert.equal(fuse(chunks, { bm25: bm25Rank(buildBm25(chunks), q1), query: q1 })[0].rule, 'SC5');
  const q2 = 'loading bags in the load zone';
  assert.equal(fuse(chunks, { bm25: bm25Rank(buildBm25(chunks), q2), query: q2 })[0].rule, 'SG7');
});

test('the best verified note always reaches the model', () => {
  const chunks = [
    ...Array.from({ length: 8 }, (_, i) => ({ rule: `T${i + 1}`, title: 'skills', text: 'robot skills skills skills' })),
    { isNote: true, rule: null, title: 'Robot Skills setup', text: 'robot skills are driver or autonomous' },
  ];
  const q = 'robot skills';
  const out = fuse(chunks, { bm25: bm25Rank(buildBm25(chunks), q), query: q, limit: 3 });
  assert.equal(out[0].isNote, true);
  assert.equal(out.length, 4);
});

test('stale text is replaced by the verified note that covers it', () => {
  const note = { id: 'n', isNote: true, rules: ['GG11'], text: 'yes since v1.1' };
  const stale = { id: 'a', rule: 'GG11', version: '0.1', text: 'cannot' };
  const uncovered = { id: 'b', rule: 'GG12', version: '0.1', text: 'old but no note' };
  const fine = { id: 'c', rule: 'T1', version: '0.1', text: 'unchanged' };
  const isChanged = (s) => s.rule === 'GG11' || s.rule === 'GG12';
  assert.deepEqual(dropStale([stale, uncovered, fine], [note], isChanged).map((s) => s.id), ['n', 'b', 'c']);
  // The note is not duplicated when already present, and current text is untouched.
  assert.deepEqual(dropStale([note, stale], [note], isChanged).map((s) => s.id), ['n']);
  assert.deepEqual(dropStale([fine], [note], isChanged).map((s) => s.id), ['c']);
});

test('the prompt carries excerpts and trims history', () => {
  const msgs = buildMessages({
    question: 'q', sources: [{ rule: 'SC5', version: '0.1', page: 22, text: 'yellow only', title: '' }],
    history: Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` })),
    level: 'simple',
  });
  assert.match(msgs[0].content, /<SC5>/);
  assert.match(msgs[0].content, /10-year-old/);
  assert.equal(msgs.length, 8);
});

test('teamwork timer opens and closes the driver switch window at 0:35 and 0:25', () => {
  const t = compile(preset('teamwork'));
  const start = 3000;
  assert.equal(t.totalMs, 63000);
  assert.equal(stateAt(t, 1000).step.kind, 'leadin');
  assert.equal(stateAt(t, start + 24000).activeWindow, null);
  assert.equal(stateAt(t, start + 26000).activeWindow.label, 'Switch drivers');
  assert.equal(formatTime(stateAt(t, start + 26000).remainingMs), '0:34');
  assert.equal(stateAt(t, start + 36000).activeWindow, null);
  assert.equal(stateAt(t, 64000).done, true);
});

test('each event fires exactly once however frames are sliced', () => {
  const t = compile(preset('teamwork'));
  const collect = (stepMs) => {
    const out = [];
    for (let now = 0, prev = -1; prev < t.totalMs; prev = now, now += stepMs) {
      out.push(...eventsBetween(t, prev, now));
    }
    return out.map((e) => `${e.type}:${e.label}`);
  };
  const fine = collect(16);
  assert.deepEqual(fine, collect(250));
  assert.equal(fine.filter((e) => e === 'cue:Switch drivers').length, 1);
  assert.equal(fine.filter((e) => e === 'start:Driver control').length, 1);
  assert.equal(fine.filter((e) => e === 'end:Time').length, 1);
});

test('a timer with no lead-in still announces its start', () => {
  const t = compile({ leadIn: 0, rounds: 1, rest: 0, segments: [{ label: 'Go', seconds: 5 }], cues: [] });
  assert.ok(eventsBetween(t, -1, 16).some((e) => e.type === 'start'));
});

test('rounds insert rests between them but not after the last', () => {
  const t = compile(preset('drill'));
  assert.equal(t.steps.filter((s) => s.kind === 'work').length, 5);
  assert.equal(t.steps.filter((s) => s.kind === 'rest').length, 4);
  assert.equal(t.steps.at(-1).kind, 'work');
});

test('time parsing, formatting and stop time rounding', () => {
  assert.equal(parseTime('1:30'), 90);
  assert.equal(parseTime('45'), 45);
  assert.equal(parseTime('1:75'), null);
  assert.equal(parseTime('abc'), null);
  assert.equal(formatTime(59001), '1:00');
  assert.equal(formatTime(0), '0:00');
  assert.equal(skillsStopTime(25200), 26);
});

test('timer validation catches impossible cues', () => {
  assert.deepEqual(validateTimer(preset('teamwork')), []);
  const bad = { name: '', rounds: 1, rest: 0, leadIn: 0, segments: [{ label: 'x', seconds: 10 }], cues: [{ at: 20, label: 'late' }, { at: 5, until: 8, label: 'backwards' }] };
  assert.equal(validateTimer(bad).length, 3);
});

test('the field has the 32 + 4 starting bags from the manual and is symmetric', () => {
  assert.equal(FIELD_BAGS.filter((b) => b.color === 'red').length, 8);
  assert.equal(FIELD_BAGS.filter((b) => b.color === 'blue').length, 8);
  assert.equal(FIELD_BAGS.filter((b) => b.color === 'yellow').length, 4);
  assert.equal(LOAD_BAGS.teamwork.length, 16);
  assert.equal(LOAD_BAGS.skills.filter((b) => b.color === 'red').length, 4);
  assert.deepEqual(mirror([30.5, 6.5]), [66.5, 66.5]);
  assert.deepEqual(mirror([ZONES.floorRed.x[0], ZONES.floorRed.z[1]]), [ZONES.floorBlue.x[1], ZONES.floorBlue.z[0]]);
});

test('starting bags are not sitting in a goal', () => {
  for (const b of FIELD_BAGS) assert.equal(locate(...b.pos), null, `${b.color} at ${b.pos}`);
});

test('goals are located correctly at both ends', () => {
  assert.equal(locate(4, 4).goal, 'L3');
  assert.equal(locate(12, 4).goal, 'L2');
  assert.equal(locate(18, 18).goal, 'L1');
  assert.equal(locate(4, 4).color, 'red');
  assert.equal(locate(93, 69).goal, 'L3');
  assert.equal(locate(93, 69).color, 'blue');
  assert.equal(locate(36.5, 42.5).goal, 'L4');
  assert.equal(locate(3.5, 30).color, 'red');
  assert.equal(locate(3.5, 60), null);
});

test('a bag must be entirely inside a Floor Goal', () => {
  assert.equal(locate(5, 30)?.goal, 'floor');
  assert.equal(locate(5.5, 30), null);
});

test('scoring matches SC3-SC5', () => {
  const l4 = { goal: 'L4', color: null };
  const redL3 = { goal: 'L3', color: 'red' };
  const blueFloor = { goal: 'floor', color: 'blue' };
  assert.equal(scoreBag('yellow', l4).points, 16);
  assert.equal(scoreBag('red', l4).points, 0);
  assert.equal(scoreBag('red', redL3).points, 12);
  assert.equal(scoreBag('blue', redL3).points, 0);
  assert.equal(scoreBag('yellow', redL3).points, 12);
  assert.equal(scoreBag('blue', blueFloor).points, 1);
  assert.equal(scoreBag('red', null).points, 0);
  const t = tally([{ color: 'yellow', spot: l4 }, { color: 'red', spot: redL3 }, { color: 'blue', spot: redL3 }]);
  assert.equal(t.total, 28);
  assert.equal(t.counts.L3, 1);
});
