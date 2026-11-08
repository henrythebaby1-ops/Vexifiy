import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProgram, toPython, toBlockly, fromBlockly, parseCodeReply, devicesUsed, buildCodeMessages, EXAMPLES, STEP_OPS } from '../public/js/code-core.js';

test('every example survives blocks and back unchanged', () => {
  for (const ex of EXAMPLES) {
    const clean = normalizeProgram(ex.program).program;
    assert.deepEqual(fromBlockly(toBlockly(clean)).program, clean, ex.name);
  }
});

test('python for a square drive is correct and indented', () => {
  const py = toPython(normalizeProgram(EXAMPLES[0].program).program);
  assert.match(py, /# Drive in a square\nfor _ in range\(4\):\n {4}drivetrain\.drive_for\(FORWARD, 300, MM\)\n {4}drivetrain\.turn_for\(RIGHT, 90, DEGREES\)$/);
  assert.match(py, /add: drivetrain \(use/);
});

test('loops and conditions turn into python', () => {
  const { program } = normalizeProgram([
    { op: 'wait_until', cond: { type: 'and', a: { type: 'distance', op: '<', mm: 80 }, b: { type: 'not', a: { type: 'bumper' } } } },
    { op: 'forever', do: [] },
    { op: 'if_else', cond: { type: 'color', color: 'RED' }, do: [{ op: 'led', color: 'red' }], else: [] },
    { op: 'print', text: 'Say "hi"' },
  ]);
  const py = toPython(program);
  assert.match(py, /while not \(\(distance_1\.object_distance\(MM\) < 80\) and \(not \(bumper_1\.pressing\(\)\)\)\):\n {4}wait\(5, MSEC\)/);
  assert.match(py, /while True:\n {4}wait\(5, MSEC\)/);
  assert.match(py, /if optical_1\.color\(\) == Color\.RED:\n {4}touchled_1\.set_color\(Color\.RED\)\nelse:\n {4}pass/);
  assert.match(py, /brain\.screen\.print\("Say \\"hi\\""\)/);
  assert.deepEqual(devicesUsed(program), ['distance_1', 'optical_1', 'bumper_1', 'touchled_1']);
});

test('bad AI output is cleaned up instead of trusted', () => {
  const { program, warnings } = normalizeProgram([
    { op: 'drive_for', dir: 'sideways', dist: 99999, unit: 'feet' },
    { op: 'launch_rocket' },
    { op: 'spin', motor: 'shooter', dir: 'reverse' },
    { op: 'print', text: 'line1\nimport os' },
    { op: 'repeat', times: 'lots', do: 'nope' },
  ]);
  assert.deepEqual(program[0], { op: 'drive_for', dir: 'forward', dist: 5000, unit: 'mm' });
  assert.equal(program[1].motor, 'intake');
  assert.equal(program[2].text, 'line1 import os');
  assert.deepEqual(program[3], { op: 'repeat', times: 2, do: [] });
  assert.ok(warnings.some((w) => /launch_rocket/.test(w)));
});

test('AI replies are parsed from JSON, even with extra words', () => {
  const r = parseCodeReply('Here you go: {"program":[{"op":"wait","sec":2}],"summary":"Waits."}');
  assert.deepEqual(r.program, [{ op: 'wait', sec: 2 }]);
  assert.equal(r.summary, 'Waits.');
  assert.throws(() => parseCodeReply('no program'), /could read/);
  const [sys, user] = buildCodeMessages({ request: 'go', program: [] });
  for (const op of STEP_OPS) assert.ok(sys.content.includes(`\n${op} `), op);
  assert.match(user.content, /Current program:\n\[\]/);
});

test('loose blocks are counted but not run', () => {
  const state = toBlockly([{ op: 'wait', sec: 1 }]);
  state.blocks.blocks.push({ type: 'vex_wait', fields: { SEC: 3 } });
  const r = fromBlockly(state);
  assert.equal(r.loose, 1);
  assert.deepEqual(r.program, [{ op: 'wait', sec: 1 }]);
});

test('the shorthand some models write is understood', () => {
  const { program } = normalizeProgram([
    { comment: 'Go' }, { drive_for: { dir: 'forward', dist: 600, unit: 'mm' } },
    { wait_until: { cond: { bumper: {} } } }, { if: { cond: { distance: { op: '<', mm: 50 } }, do: [{ stop_driving: {} }] } },
  ]);
  assert.deepEqual(program, [
    { op: 'comment', text: 'Go' }, { op: 'drive_for', dir: 'forward', dist: 600, unit: 'mm' },
    { op: 'wait_until', cond: { type: 'bumper' } },
    { op: 'if', cond: { type: 'distance', op: '<', mm: 50 }, do: [{ op: 'stop_driving' }] },
  ]);
});
