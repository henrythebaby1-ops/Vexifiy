// Block coding for VEX IQ. Programs are plain JSON "steps", so blocks, Python and the AI
// all share one format that can be checked and tested without a browser.
//
// A program is an array of steps, e.g.
//   [{ op: 'drive_for', dir: 'forward', dist: 300, unit: 'mm' },
//    { op: 'repeat', times: 3, do: [{ op: 'turn_for', dir: 'right', deg: 90 }] }]
// Conditions are objects like { type: 'distance', op: '<', mm: 100 }.

export const MOTORS = ['intake', 'lift'];
export const DIRS = ['forward', 'reverse'];
export const TURNS = ['left', 'right'];
export const COLORS = ['red', 'green', 'blue', 'yellow', 'orange', 'purple', 'white'];
export const BUTTONS = ['EUp', 'EDown', 'FUp', 'FDown', 'LUp', 'LDown', 'RUp', 'RDown', 'L3', 'R3'];
export const COMPARE = ['<', '>'];

const num = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
};
const pick = (v, list, fallback) => {
  const s = String(v ?? '').toLowerCase();
  return list.find((x) => x.toLowerCase() === s) ?? fallback;
};
const text = (v, max = 60) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, max);

const MAX_STEPS = 200;
const MAX_DEPTH = 6;

// ---------- Checking ----------
// Models sometimes write {"drive_for": {...}} or {"comment": "text"} instead of {"op": "drive_for", ...}.
const TEXT_OPS = new Set(['comment', 'print']);
function unwrap(item, key, known) {
  if (!item || typeof item !== 'object' || item[key]) return item;
  const keys = Object.keys(item);
  const name = keys.find((k) => known.includes(k));
  if (!name || keys.length > 2) return item;
  const v = item[name];
  if (v && typeof v === 'object' && !Array.isArray(v)) return { ...v, [key]: name };
  if (TEXT_OPS.has(name)) return { [key]: name, text: v };
  return { [key]: name };
}
const COND_TYPES = ['bumper', 'distance', 'color', 'button', 'timer', 'heading', 'and', 'or', 'not'];

export function normalizeCondition(c, warn, depth = 0) {
  c = unwrap(c, 'type', COND_TYPES);
  if (!c || typeof c !== 'object' || depth > MAX_DEPTH) { warn('A condition was missing, so it was set to "bumper pressed".'); return { type: 'bumper' }; }
  switch (c.type) {
    case 'bumper': return { type: 'bumper' };
    case 'distance': return { type: 'distance', op: pick(c.op, COMPARE, '<'), mm: num(c.mm, 0, 2000, 100) };
    case 'color': return { type: 'color', color: pick(c.color, COLORS, 'red') };
    case 'button': return { type: 'button', button: pick(c.button, BUTTONS, 'EUp') };
    case 'timer': return { type: 'timer', op: pick(c.op, COMPARE, '>'), sec: num(c.sec, 0, 600, 1) };
    case 'heading': return { type: 'heading', op: pick(c.op, COMPARE, '>'), deg: num(c.deg, 0, 359.99, 90) };
    case 'and': case 'or':
      return { type: c.type, a: normalizeCondition(c.a, warn, depth + 1), b: normalizeCondition(c.b, warn, depth + 1) };
    case 'not': return { type: 'not', a: normalizeCondition(c.a, warn, depth + 1) };
    default:
      warn(`Unknown condition "${text(c.type, 20)}" was replaced with "bumper pressed".`);
      return { type: 'bumper' };
  }
}

export function normalizeProgram(raw, depth = 0, state = { count: 0, warnings: [] }) {
  const warn = (m) => { if (!state.warnings.includes(m)) state.warnings.push(m); };
  const steps = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const s = unwrap(item, 'op', STEP_OPS);
    if (state.count >= MAX_STEPS) { warn(`Programs are limited to ${MAX_STEPS} blocks.`); break; }
    if (!s || typeof s !== 'object') continue;
    const body = (key) => (depth >= MAX_DEPTH ? (warn('Blocks were nested too deeply, so the innermost were dropped.'), []) : normalizeProgram(s[key], depth + 1, state).program);
    let out = null;
    switch (s.op) {
      case 'drive_for': out = { op: s.op, dir: pick(s.dir, DIRS, 'forward'), dist: num(s.dist, 0, 5000, 200), unit: pick(s.unit, ['mm', 'inches'], 'mm') }; break;
      case 'turn_for': out = { op: s.op, dir: pick(s.dir, TURNS, 'right'), deg: num(s.deg, 0, 3600, 90) }; break;
      case 'turn_to_heading': out = { op: s.op, deg: num(s.deg, 0, 359.99, 0) }; break;
      case 'drive': out = { op: s.op, dir: pick(s.dir, DIRS, 'forward') }; break;
      case 'stop_driving': out = { op: s.op }; break;
      case 'set_drive_velocity': case 'set_turn_velocity': out = { op: s.op, pct: num(s.pct, 0, 100, 50) }; break;
      case 'spin_for': out = { op: s.op, motor: pick(s.motor, MOTORS, 'intake'), dir: pick(s.dir, DIRS, 'forward'), amount: num(s.amount, 0, 36000, 360), unit: pick(s.unit, ['degrees', 'turns'], 'degrees') }; break;
      case 'spin': out = { op: s.op, motor: pick(s.motor, MOTORS, 'intake'), dir: pick(s.dir, DIRS, 'forward') }; break;
      case 'stop_motor': out = { op: s.op, motor: pick(s.motor, MOTORS, 'intake') }; break;
      case 'set_motor_velocity': out = { op: s.op, motor: pick(s.motor, MOTORS, 'intake'), pct: num(s.pct, 0, 100, 50) }; break;
      case 'spin_to_position': out = { op: s.op, motor: pick(s.motor, MOTORS, 'lift'), deg: num(s.deg, -36000, 36000, 0) }; break;
      case 'wait': out = { op: s.op, sec: num(s.sec, 0, 600, 1) }; break;
      case 'wait_until': out = { op: s.op, cond: normalizeCondition(s.cond, warn) }; break;
      case 'repeat': out = { op: s.op, times: Math.round(num(s.times, 0, 1000, 2)), do: body('do') }; break;
      case 'forever': out = { op: s.op, do: body('do') }; break;
      case 'repeat_until': out = { op: s.op, cond: normalizeCondition(s.cond, warn), do: body('do') }; break;
      case 'if': out = { op: s.op, cond: normalizeCondition(s.cond, warn), do: body('do') }; break;
      case 'if_else': out = { op: s.op, cond: normalizeCondition(s.cond, warn), do: body('do'), else: body('else') }; break;
      case 'print': out = { op: s.op, text: text(s.text) }; break;
      case 'clear_screen': out = { op: s.op }; break;
      case 'led': out = { op: s.op, color: pick(s.color, [...COLORS, 'off'], 'green') }; break;
      case 'reset_timer': out = { op: s.op }; break;
      case 'comment': out = { op: s.op, text: text(s.text, 120) }; break;
      default: warn(`Skipped an unknown block "${text(s.op, 24)}".`);
    }
    if (out) { state.count += 1; steps.push(out); }
  }
  return { program: steps, warnings: state.warnings };
}

// ---------- Python (VEX IQ 2nd gen) ----------
const UP = (s) => s.toUpperCase();
const pyString = (s) => JSON.stringify(String(s));

function pyCondition(c) {
  switch (c.type) {
    case 'bumper': return 'bumper_1.pressing()';
    case 'distance': return `distance_1.object_distance(MM) ${c.op} ${c.mm}`;
    case 'color': return `optical_1.color() == Color.${UP(c.color)}`;
    case 'button': return `controller.button${c.button}.pressing()`;
    case 'timer': return `brain.timer.time(SECONDS) ${c.op} ${c.sec}`;
    case 'heading': return `drivetrain.heading(DEGREES) ${c.op} ${c.deg}`;
    case 'and': return `(${pyCondition(c.a)}) and (${pyCondition(c.b)})`;
    case 'or': return `(${pyCondition(c.a)}) or (${pyCondition(c.b)})`;
    case 'not': return `not (${pyCondition(c.a)})`;
    default: return 'False';
  }
}

function pyLines(steps, indent) {
  const pad = '    '.repeat(indent);
  const block = (inner) => (inner.length ? pyLines(inner, indent + 1) : [`${pad}    pass`]);
  const out = [];
  for (const s of steps) {
    switch (s.op) {
      case 'drive_for': out.push(`${pad}drivetrain.drive_for(${UP(s.dir)}, ${s.dist}, ${s.unit === 'mm' ? 'MM' : 'INCHES'})`); break;
      case 'turn_for': out.push(`${pad}drivetrain.turn_for(${UP(s.dir)}, ${s.deg}, DEGREES)`); break;
      case 'turn_to_heading': out.push(`${pad}drivetrain.turn_to_heading(${s.deg}, DEGREES)`); break;
      case 'drive': out.push(`${pad}drivetrain.drive(${UP(s.dir)})`); break;
      case 'stop_driving': out.push(`${pad}drivetrain.stop()`); break;
      case 'set_drive_velocity': out.push(`${pad}drivetrain.set_drive_velocity(${s.pct}, PERCENT)`); break;
      case 'set_turn_velocity': out.push(`${pad}drivetrain.set_turn_velocity(${s.pct}, PERCENT)`); break;
      case 'spin_for': out.push(`${pad}${s.motor}.spin_for(${UP(s.dir)}, ${s.amount}, ${UP(s.unit)})`); break;
      case 'spin': out.push(`${pad}${s.motor}.spin(${UP(s.dir)})`); break;
      case 'stop_motor': out.push(`${pad}${s.motor}.stop()`); break;
      case 'set_motor_velocity': out.push(`${pad}${s.motor}.set_velocity(${s.pct}, PERCENT)`); break;
      case 'spin_to_position': out.push(`${pad}${s.motor}.spin_to_position(${s.deg}, DEGREES)`); break;
      case 'wait': out.push(`${pad}wait(${s.sec}, SECONDS)`); break;
      case 'wait_until': out.push(`${pad}while not (${pyCondition(s.cond)}):`, `${pad}    wait(5, MSEC)`); break;
      case 'repeat': out.push(`${pad}for _ in range(${s.times}):`, ...block(s.do)); break;
      case 'forever': out.push(`${pad}while True:`, ...(s.do.length ? pyLines(s.do, indent + 1) : []), `${pad}    wait(5, MSEC)`); break;
      case 'repeat_until': out.push(`${pad}while not (${pyCondition(s.cond)}):`, ...(s.do.length ? pyLines(s.do, indent + 1) : []), `${pad}    wait(5, MSEC)`); break;
      case 'if': out.push(`${pad}if ${pyCondition(s.cond)}:`, ...block(s.do)); break;
      case 'if_else': out.push(`${pad}if ${pyCondition(s.cond)}:`, ...block(s.do), `${pad}else:`, ...block(s.else)); break;
      case 'print': out.push(`${pad}brain.screen.print(${pyString(s.text)})`, `${pad}brain.screen.next_row()`); break;
      case 'clear_screen': out.push(`${pad}brain.screen.clear_screen()`, `${pad}brain.screen.set_cursor(1, 1)`); break;
      case 'led': out.push(s.color === 'off' ? `${pad}touchled_1.off()` : `${pad}touchled_1.set_color(Color.${UP(s.color)})`); break;
      case 'reset_timer': out.push(`${pad}brain.timer.clear()`); break;
      case 'comment': out.push(`${pad}# ${s.text}`); break;
      default: break;
    }
  }
  return out;
}

// Devices a program needs, so the header can say what to add in VEXcode.
export function devicesUsed(steps) {
  const found = new Set();
  const SENSOR = { bumper: 'bumper_1', distance: 'distance_1', color: 'optical_1', button: 'controller', heading: 'drivetrain' };
  const cond = (c) => {
    if (!c) return;
    if (SENSOR[c.type]) found.add(SENSOR[c.type]);
    cond(c.a); cond(c.b);
  };
  const walk = (list) => list.forEach((s) => {
    if (/drive|turn/.test(s.op)) found.add('drivetrain');
    if (s.motor) found.add(s.motor);
    if (s.op === 'led') found.add('touchled_1');
    cond(s.cond);
    walk(s.do || []); walk(s.else || []);
  });
  walk(steps);
  const order = ['drivetrain', ...MOTORS, 'distance_1', 'optical_1', 'bumper_1', 'touchled_1', 'controller'];
  return order.filter((d) => found.has(d));
}

export function toPython(steps) {
  const devices = devicesUsed(steps);
  const head = [
    '# Made with Vexifiy blocks for VEX IQ (2nd gen) Python.',
    '# 1. In VEXcode IQ, start a new Python project.',
    devices.length
      ? `# 2. In the Devices menu, add: ${devices.join(', ')} (use these exact names; give the drivetrain an inertial sensor).`
      : '# 2. This program does not use any devices.',
    '# 3. Paste this below the "Robot Configuration" section.',
    '',
  ];
  const body = pyLines(steps, 0);
  return [...head, ...(body.length ? body : ['# Add blocks under "when started" to build your program.'])].join('\n');
}

// ---------- Blockly ----------
const condToBlock = (c) => {
  switch (c.type) {
    case 'bumper': return { type: 'vex_bumper' };
    case 'distance': return { type: 'vex_distance', fields: { OP: c.op, MM: c.mm } };
    case 'color': return { type: 'vex_color', fields: { COLOR: c.color } };
    case 'button': return { type: 'vex_button', fields: { BUTTON: c.button } };
    case 'timer': return { type: 'vex_timer', fields: { OP: c.op, SEC: c.sec } };
    case 'heading': return { type: 'vex_heading', fields: { OP: c.op, DEG: c.deg } };
    case 'and': case 'or': return { type: `vex_${c.type}`, inputs: { A: { block: condToBlock(c.a) }, B: { block: condToBlock(c.b) } } };
    case 'not': return { type: 'vex_not', inputs: { A: { block: condToBlock(c.a) } } };
    default: return { type: 'vex_bumper' };
  }
};

// Which step fields become which block fields.
const FIELD_MAP = {
  drive_for: { DIR: 'dir', DIST: 'dist', UNIT: 'unit' },
  turn_for: { DIR: 'dir', DEG: 'deg' },
  turn_to_heading: { DEG: 'deg' },
  drive: { DIR: 'dir' },
  stop_driving: {},
  set_drive_velocity: { PCT: 'pct' },
  set_turn_velocity: { PCT: 'pct' },
  spin_for: { MOTOR: 'motor', DIR: 'dir', AMOUNT: 'amount', UNIT: 'unit' },
  spin: { MOTOR: 'motor', DIR: 'dir' },
  stop_motor: { MOTOR: 'motor' },
  set_motor_velocity: { MOTOR: 'motor', PCT: 'pct' },
  spin_to_position: { MOTOR: 'motor', DEG: 'deg' },
  wait: { SEC: 'sec' },
  wait_until: {},
  repeat: { TIMES: 'times' },
  forever: {},
  repeat_until: {},
  if: {},
  if_else: {},
  print: { TEXT: 'text' },
  clear_screen: {},
  led: { COLOR: 'color' },
  reset_timer: {},
  comment: { TEXT: 'text' },
};
export const STEP_OPS = Object.keys(FIELD_MAP);

function stepsToChain(steps) {
  let first = null; let last = null;
  for (const s of steps) {
    const block = { type: `vex_${s.op}` };
    const fields = Object.fromEntries(Object.entries(FIELD_MAP[s.op]).map(([f, k]) => [f, s[k]]));
    if (Object.keys(fields).length) block.fields = fields;
    const inputs = {};
    if (s.cond) inputs.COND = { block: condToBlock(s.cond) };
    if (s.do?.length) inputs.DO = { block: stepsToChain(s.do) };
    if (s.else?.length) inputs.ELSE = { block: stepsToChain(s.else) };
    if (Object.keys(inputs).length) block.inputs = inputs;
    if (last) last.next = { block }; else first = block;
    last = block;
  }
  return first;
}

export function toBlockly(steps) {
  const start = { type: 'vex_start', x: 30, y: 30, deletable: false };
  const chain = stepsToChain(steps);
  if (chain) start.next = { block: chain };
  return { blocks: { languageVersion: 0, blocks: [start] } };
}

function blockToCond(b) {
  if (!b) return null;
  const f = b.fields || {};
  switch (b.type) {
    case 'vex_bumper': return { type: 'bumper' };
    case 'vex_distance': return { type: 'distance', op: f.OP, mm: f.MM };
    case 'vex_color': return { type: 'color', color: f.COLOR };
    case 'vex_button': return { type: 'button', button: f.BUTTON };
    case 'vex_timer': return { type: 'timer', op: f.OP, sec: f.SEC };
    case 'vex_heading': return { type: 'heading', op: f.OP, deg: f.DEG };
    case 'vex_and': case 'vex_or': return { type: b.type.slice(4), a: blockToCond(b.inputs?.A?.block), b: blockToCond(b.inputs?.B?.block) };
    case 'vex_not': return { type: 'not', a: blockToCond(b.inputs?.A?.block) };
    default: return null;
  }
}

function chainToSteps(block) {
  const steps = [];
  for (let b = block; b; b = b.next?.block) {
    const op = b.type.replace(/^vex_/, '');
    if (!FIELD_MAP[op]) continue;
    const step = { op };
    for (const [f, k] of Object.entries(FIELD_MAP[op])) step[k] = b.fields?.[f];
    if (['wait_until', 'repeat_until', 'if', 'if_else'].includes(op)) step.cond = blockToCond(b.inputs?.COND?.block);
    if (['repeat', 'forever', 'repeat_until', 'if', 'if_else'].includes(op)) step.do = chainToSteps(b.inputs?.DO?.block);
    if (op === 'if_else') step.else = chainToSteps(b.inputs?.ELSE?.block);
    steps.push(step);
  }
  return steps;
}

// Reads the program under "when started". Loose blocks elsewhere are not run, like in VEXcode.
export function fromBlockly(state) {
  const top = state?.blocks?.blocks || [];
  const start = top.find((b) => b.type === 'vex_start');
  const loose = top.filter((b) => b.type !== 'vex_start').length;
  const { program, warnings } = normalizeProgram(chainToSteps(start?.next?.block));
  // Empty condition slots get a default, but say so plainly.
  const msg = warnings.map((w) => (w.startsWith('A condition was missing') ? 'An empty condition slot is treated as "bumper pressed". Drop a sensing block in it.' : w));
  return { program, loose, warnings: msg };
}

// ---------- AI ----------
export const AI_FORMAT = `Steps (JSON objects with "op"):
drive_for {dir:"forward"|"reverse", dist:number, unit:"mm"|"inches"}
turn_for {dir:"left"|"right", deg:number}
turn_to_heading {deg:0-359}
drive {dir} (keeps driving until stop_driving)
stop_driving {}
set_drive_velocity {pct:0-100}
set_turn_velocity {pct:0-100}
spin_for {motor:"intake"|"lift", dir:"forward"|"reverse", amount:number, unit:"degrees"|"turns"}
spin {motor, dir} (keeps spinning until stop_motor)
stop_motor {motor}
set_motor_velocity {motor, pct:0-100}
spin_to_position {motor, deg:number}
wait {sec:number}
wait_until {cond}
repeat {times:number, do:[steps]}
forever {do:[steps]}
repeat_until {cond, do:[steps]}
if {cond, do:[steps]}
if_else {cond, do:[steps], else:[steps]}
print {text} (on the Brain screen)
clear_screen {}
led {color:"red"|"green"|"blue"|"yellow"|"orange"|"purple"|"white"|"off"} (Touch LED)
reset_timer {}
comment {text}
Conditions (JSON objects with "type"):
bumper {} (bumper switch pressed)
distance {op:"<"|">", mm:number}
color {color} (optical sensor sees a color)
button {button:"EUp"|"EDown"|"FUp"|"FDown"|"LUp"|"LDown"|"RUp"|"RDown"|"L3"|"R3"} (controller button pressed)
timer {op:"<"|">", sec:number}
heading {op:"<"|">", deg:number}
and {a:cond, b:cond}, or {a:cond, b:cond}, not {a:cond}`;

export function buildCodeMessages({ request, program }) {
  const system = `You write VEX IQ robot programs for students, using ONLY the step format below. The robot has a drivetrain, two motors named "intake" and "lift", a distance sensor, an optical sensor, a bumper switch, a Touch LED and a controller.

Game context (VIQRC Level Up 2026-27): the Field is 73 x 97 inches (about 1850 x 2460 mm). Robots score Bean Bags in Floor Goals and on a Pyramid Goal with levels L1-L4. A Match is 60 seconds; Autonomous Coding Skills is 60 seconds with no driver.

${AI_FORMAT}

Example. Request: "drive forward 300 mm, then spin the intake until the bumper is pressed". Reply:
{"program":[{"op":"comment","text":"Drive to the Bean Bag"},{"op":"drive_for","dir":"forward","dist":300,"unit":"mm"},{"op":"comment","text":"Pull it in"},{"op":"spin","motor":"intake","dir":"forward"},{"op":"wait_until","cond":{"type":"bumper"}},{"op":"stop_motor","motor":"intake"}],"summary":"Drives 300 mm, then runs the intake until the bumper is pressed. Measure the distance on your field."}

Rules:
- Every step is an object with an "op" key; every condition is an object with a "type" key, exactly like the example.
- Anything that keeps running (drive, spin) needs a matching stop step later. drive_for, turn_for and spin_for stop on their own, so do not add stop steps or a spin before them.
- wait_until and repeat_until wait until the condition becomes TRUE. "Stop when closer than 50 mm" is {"type":"distance","op":"<","mm":50}.
- When the student says to do something a number of times, put those steps ONCE inside a single repeat step. Do not copy steps.
- Use only the ops and condition types listed. Use millimeters unless the student says inches.
- If the student asks to change their current program, return the WHOLE updated program.
- Keep it simple and readable. Add a "comment" step before each main part.
- Reply with JSON only: {"program":[steps], "summary":"one or two short sentences for the student about what the program does and anything they should measure or adjust"}`;
  const user = `Current program:\n${JSON.stringify(program)}\n\nStudent's request:\n${String(request).slice(0, 1500)}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function parseCodeReply(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]); } catch { data = null; }
  }
  if (Array.isArray(data)) data = { program: data };
  if (!data || !Array.isArray(data.program)) throw new Error('The AI did not send back a program Vexifiy could read. Try again or rephrase.');
  const { program, warnings } = normalizeProgram(data.program);
  return { program, warnings, summary: text(data.summary, 400) };
}

// The program as the blocks read, which small models follow better than Python.
function condText(c) {
  switch (c.type) {
    case 'bumper': return 'bumper pressed';
    case 'distance': return `distance sensor reads ${c.op === '<' ? 'less' : 'more'} than ${c.mm} mm`;
    case 'color': return `optical sensor sees ${c.color}`;
    case 'button': return `controller button ${c.button} pressed`;
    case 'timer': return `timer ${c.op === '<' ? 'less' : 'more'} than ${c.sec} seconds`;
    case 'heading': return `heading ${c.op === '<' ? 'less' : 'more'} than ${c.deg} degrees`;
    case 'and': return `(${condText(c.a)}) and (${condText(c.b)})`;
    case 'or': return `(${condText(c.a)}) or (${condText(c.b)})`;
    case 'not': return `not (${condText(c.a)})`;
    default: return '?';
  }
}
export function toBlockText(steps, indent = 0) {
  const pad = '  '.repeat(indent);
  const lines = [];
  const inner = (list) => (list.length ? toBlockText(list, indent + 1) : `${pad}  (nothing)`);
  for (const s of steps) {
    const line = {
      drive_for: () => `drive ${s.dir} ${s.dist} ${s.unit}`,
      turn_for: () => `turn ${s.dir} ${s.deg} degrees`,
      turn_to_heading: () => `turn to heading ${s.deg} degrees`,
      drive: () => `start driving ${s.dir} (keeps going)`,
      stop_driving: () => 'stop driving',
      set_drive_velocity: () => `set drive speed to ${s.pct}%`,
      set_turn_velocity: () => `set turn speed to ${s.pct}%`,
      spin_for: () => `spin ${s.motor} ${s.dir} ${s.amount} ${s.unit}`,
      spin: () => `start spinning ${s.motor} ${s.dir} (keeps going)`,
      stop_motor: () => `stop ${s.motor}`,
      set_motor_velocity: () => `set ${s.motor} speed to ${s.pct}%`,
      spin_to_position: () => `move ${s.motor} to ${s.deg} degrees`,
      wait: () => `wait ${s.sec} seconds`,
      wait_until: () => `wait until ${condText(s.cond)}`,
      repeat: () => `repeat ${s.times} times:`,
      forever: () => 'forever:',
      repeat_until: () => `repeat until ${condText(s.cond)}:`,
      if: () => `if ${condText(s.cond)}:`,
      if_else: () => `if ${condText(s.cond)}:`,
      print: () => `print "${s.text}" on the Brain`,
      clear_screen: () => 'clear the Brain screen',
      led: () => `set Touch LED to ${s.color}`,
      reset_timer: () => 'reset the timer',
      comment: () => `note: ${s.text}`,
    }[s.op]?.();
    if (!line) continue;
    lines.push(pad + line);
    if (s.do) lines.push(inner(s.do));
    if (s.op === 'if_else') lines.push(`${pad}else:`, inner(s.else));
  }
  return lines.join('\n');
}

export function buildExplainMessages({ program, question }) {
  return [
    { role: 'system', content: `You are a patient VEX IQ coach for students aged 8-14. The student's block program is below, one block per line; indented lines are inside the block above them. Explain it in simple words, step by step, in at most 8 short bullet points.

Then add a "Watch out" line ONLY for a real problem you can point to in the blocks, such as: something that "keeps going" and is never stopped, a forever loop with nothing after it that the student expects to run, a wait-until condition that looks backwards (for example waiting until the distance is MORE than a small number when driving toward something), or distances that do not fit a 73 x 97 inch (about 1850 x 2460 mm) field. "wait until" checks the sensor continuously, so it is fine. If there is no real problem, say "Looks good" instead. Do not rewrite the program.` },
    { role: 'user', content: `${question ? `Question: ${String(question).slice(0, 500)}\n\n` : ''}Program:\nwhen started\n${toBlockText(program, 1) || '  (no blocks yet)'}` },
  ];
}

// ---------- Examples ----------
export const EXAMPLES = [
  {
    name: 'Square drive',
    program: [
      { op: 'comment', text: 'Drive in a square' },
      { op: 'repeat', times: 4, do: [{ op: 'drive_for', dir: 'forward', dist: 300, unit: 'mm' }, { op: 'turn_for', dir: 'right', deg: 90 }] },
    ],
  },
  {
    name: 'Grab a Bean Bag',
    program: [
      { op: 'comment', text: 'Drive up to a Bean Bag and pull it in' },
      { op: 'set_drive_velocity', pct: 60 },
      { op: 'spin', motor: 'intake', dir: 'forward' },
      { op: 'drive', dir: 'forward' },
      { op: 'wait_until', cond: { type: 'distance', op: '<', mm: 60 } },
      { op: 'stop_driving' },
      { op: 'wait', sec: 0.5 },
      { op: 'stop_motor', motor: 'intake' },
      { op: 'led', color: 'green' },
    ],
  },
  {
    name: 'Driver lift control',
    program: [
      { op: 'comment', text: 'E buttons move the lift, F buttons run the intake' },
      { op: 'forever', do: [
        { op: 'if_else', cond: { type: 'button', button: 'EUp' }, do: [{ op: 'spin', motor: 'lift', dir: 'forward' }], else: [
          { op: 'if_else', cond: { type: 'button', button: 'EDown' }, do: [{ op: 'spin', motor: 'lift', dir: 'reverse' }], else: [{ op: 'stop_motor', motor: 'lift' }] },
        ] },
        { op: 'if_else', cond: { type: 'button', button: 'FUp' }, do: [{ op: 'spin', motor: 'intake', dir: 'forward' }], else: [{ op: 'stop_motor', motor: 'intake' }] },
      ] },
    ],
  },
];
