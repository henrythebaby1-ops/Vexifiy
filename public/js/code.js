// VEX IQ block code editor with an AI helper.
import { $, esc, api, store, renderAnswer } from './util.js';
import {
  toBlockly, fromBlockly, toPython, EXAMPLES, MOTORS, COLORS, BUTTONS,
} from './code-core.js';

let Blockly = null;
let ws = null;
let root = null;
let helpers = null;
let saveTimer = null;
let undoState = null;
const ui = { tab: 'ai', busy: false, aiNote: '', aiWarn: [], explain: '', error: '' };

const loadScript = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Could not load ${src}`));
  document.head.appendChild(s);
});

const opts = (list, label = (x) => x) => list.map((x) => [label(x), x]);
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const DIR = opts(['forward', 'reverse']);
const MOTOR = opts(MOTORS);
const CMP = [['<', '<'], ['>', '>']];
const num = (name, value, min, max, precision = 0.01) => ({ type: 'field_number', name, value, min, max, precision });
const dd = (name, options) => ({ type: 'field_dropdown', name, options });

const C = { drive: '#3d7be0', motor: '#8a5cdb', control: '#d18b1f', sense: '#1f9fb3', looks: '#c4487f', note: '#5b6470', start: '#d8a40a' };

function defineBlocks() {
  const stmt = (type, message0, args0, colour, tooltip, extra = {}) => ({
    type, message0, args0, colour, tooltip, previousStatement: null, nextStatement: null, ...extra,
  });
  const cond = (type, message0, args0, tooltip, extra = {}) => ({
    type, message0, args0, colour: C.sense, tooltip, output: 'Boolean', ...extra,
  });
  Blockly.common.defineBlocksWithJsonArray([
    { type: 'vex_start', message0: 'when started', colour: C.start, nextStatement: null, tooltip: 'Your program starts here.', hat: 'cap' },
    stmt('vex_drive_for', 'drive %1 for %2 %3', [dd('DIR', DIR), num('DIST', 200, 0, 5000), dd('UNIT', [['mm', 'mm'], ['inches', 'inches']])], C.drive, 'Drive a set distance, then go on.'),
    stmt('vex_turn_for', 'turn %1 for %2 degrees', [dd('DIR', opts(['right', 'left'])), num('DEG', 90, 0, 3600)], C.drive, 'Turn in place.'),
    stmt('vex_turn_to_heading', 'turn to heading %1 degrees', [num('DEG', 90, 0, 359.99)], C.drive, 'Turn to face a direction, using the inertial sensor.'),
    stmt('vex_drive', 'drive %1', [dd('DIR', DIR)], C.drive, 'Start driving and keep going until "stop driving".'),
    stmt('vex_stop_driving', 'stop driving', [], C.drive, 'Stop the drivetrain.'),
    stmt('vex_set_drive_velocity', 'set drive velocity to %1 %%', [num('PCT', 50, 0, 100, 1)], C.drive, 'How fast to drive.'),
    stmt('vex_set_turn_velocity', 'set turn velocity to %1 %%', [num('PCT', 50, 0, 100, 1)], C.drive, 'How fast to turn.'),
    stmt('vex_spin_for', 'spin %1 %2 for %3 %4', [dd('MOTOR', MOTOR), dd('DIR', DIR), num('AMOUNT', 360, 0, 36000), dd('UNIT', [['degrees', 'degrees'], ['turns', 'turns']])], C.motor, 'Spin a motor a set amount.'),
    stmt('vex_spin', 'spin %1 %2', [dd('MOTOR', MOTOR), dd('DIR', DIR)], C.motor, 'Start a motor and keep it spinning.'),
    stmt('vex_stop_motor', 'stop %1', [dd('MOTOR', MOTOR)], C.motor, 'Stop a motor.'),
    stmt('vex_set_motor_velocity', 'set %1 velocity to %2 %%', [dd('MOTOR', MOTOR), num('PCT', 50, 0, 100, 1)], C.motor, 'How fast a motor spins.'),
    stmt('vex_spin_to_position', 'spin %1 to position %2 degrees', [dd('MOTOR', opts([...MOTORS].reverse())), num('DEG', 90, -36000, 36000)], C.motor, 'Move a motor to an exact position, like a lift height.'),
    stmt('vex_wait', 'wait %1 seconds', [num('SEC', 1, 0, 600)], C.control, 'Pause.'),
    stmt('vex_wait_until', 'wait until %1', [{ type: 'input_value', name: 'COND', check: 'Boolean' }], C.control, 'Pause until something is true.'),
    stmt('vex_repeat', 'repeat %1 %2 %3', [num('TIMES', 4, 0, 1000, 1), { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], C.control, 'Do the blocks inside a set number of times.'),
    stmt('vex_forever', 'forever %1 %2', [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], C.control, 'Do the blocks inside over and over.', { nextStatement: undefined }),
    stmt('vex_repeat_until', 'repeat until %1 %2', [{ type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_statement', name: 'DO' }], C.control, 'Keep doing the blocks inside until something is true.'),
    stmt('vex_if', 'if %1 then %2', [{ type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_statement', name: 'DO' }], C.control, 'Only do the blocks inside when something is true.'),
    {
      type: 'vex_if_else', message0: 'if %1 then %2', args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_statement', name: 'DO' }],
      message1: 'else %1', args1: [{ type: 'input_statement', name: 'ELSE' }],
      colour: C.control, previousStatement: null, nextStatement: null, tooltip: 'Do one thing or the other.',
    },
    stmt('vex_reset_timer', 'reset timer', [], C.control, 'Set the Brain timer back to 0.'),
    stmt('vex_print', 'print %1 on Brain', [{ type: 'field_input', name: 'TEXT', text: 'Hello' }], C.looks, 'Show text on the Brain screen.'),
    stmt('vex_clear_screen', 'clear Brain screen', [], C.looks, 'Clear the Brain screen.'),
    stmt('vex_led', 'set Touch LED to %1', [dd('COLOR', opts([...COLORS, 'off'], cap))], C.looks, 'Light up the Touch LED.'),
    stmt('vex_comment', 'note: %1', [{ type: 'field_input', name: 'TEXT', text: 'what this part does' }], C.note, 'A note for people. The robot ignores it.'),
    cond('vex_bumper', 'bumper pressed?', [], 'True while the bumper switch is pressed.'),
    cond('vex_distance', 'distance %1 %2 mm?', [dd('OP', CMP), num('MM', 100, 0, 2000)], 'Compares what the distance sensor sees.'),
    cond('vex_color', 'optical sees %1?', [dd('COLOR', opts(COLORS, cap))], 'True when the optical sensor sees this color.'),
    cond('vex_button', 'controller %1 pressed?', [dd('BUTTON', opts(BUTTONS))], 'True while a controller button is held.'),
    cond('vex_timer', 'timer %1 %2 seconds?', [dd('OP', [['>', '>'], ['<', '<']]), num('SEC', 5, 0, 600)], 'Compares the Brain timer.'),
    cond('vex_heading', 'heading %1 %2 degrees?', [dd('OP', [['>', '>'], ['<', '<']]), num('DEG', 90, 0, 359.99)], 'Compares which way the robot faces.'),
    cond('vex_and', '%1 and %2', [{ type: 'input_value', name: 'A', check: 'Boolean' }, { type: 'input_value', name: 'B', check: 'Boolean' }], 'True when both are true.', { inputsInline: true }),
    cond('vex_or', '%1 or %2', [{ type: 'input_value', name: 'A', check: 'Boolean' }, { type: 'input_value', name: 'B', check: 'Boolean' }], 'True when either is true.', { inputsInline: true }),
    cond('vex_not', 'not %1', [{ type: 'input_value', name: 'A', check: 'Boolean' }], 'Flips true and false.'),
  ]);
}

const TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    { kind: 'category', name: 'Drivetrain', colour: C.drive, contents: ['drive_for', 'turn_for', 'turn_to_heading', 'drive', 'stop_driving', 'set_drive_velocity', 'set_turn_velocity'].map((t) => ({ kind: 'block', type: `vex_${t}` })) },
    { kind: 'category', name: 'Motors', colour: C.motor, contents: ['spin_for', 'spin', 'stop_motor', 'set_motor_velocity', 'spin_to_position'].map((t) => ({ kind: 'block', type: `vex_${t}` })) },
    { kind: 'category', name: 'Control', colour: C.control, contents: ['wait', 'wait_until', 'repeat', 'forever', 'repeat_until', 'if', 'if_else', 'reset_timer'].map((t) => ({ kind: 'block', type: `vex_${t}` })) },
    { kind: 'category', name: 'Sensing', colour: C.sense, contents: ['bumper', 'distance', 'color', 'button', 'timer', 'heading', 'and', 'or', 'not'].map((t) => ({ kind: 'block', type: `vex_${t}` })) },
    { kind: 'category', name: 'Looks', colour: C.looks, contents: ['print', 'clear_screen', 'led', 'comment'].map((t) => ({ kind: 'block', type: `vex_${t}` })) },
  ],
};

async function loadBlockly() {
  if (Blockly) return;
  await loadScript('/vendor/blockly/blockly_compressed.js');
  await loadScript('/vendor/blockly/msg/en.js');
  Blockly = window.Blockly;
  defineBlocks();
}

function theme() {
  return Blockly.Theme.defineTheme('vexifiy', {
    name: 'vexifiy',
    base: Blockly.Themes.Classic,
    componentStyles: {
      workspaceBackgroundColour: '#0e1013', toolboxBackgroundColour: '#16191e', toolboxForegroundColour: '#eceef1',
      flyoutBackgroundColour: '#1d2127', flyoutForegroundColour: '#c9ced6', flyoutOpacity: 0.97,
      scrollbarColour: '#3a414b', scrollbarOpacity: 0.8, insertionMarkerColour: '#ffffff', insertionMarkerOpacity: 0.3,
      cursorColour: '#f5c518',
    },
    fontStyle: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', size: 11 },
  });
}

export function initCode(container, h) {
  root = container;
  helpers = h;
  root.addEventListener('click', onClick);
  root.addEventListener('change', (e) => {
    if (e.target.id === 'code-model') { store.set('code.model', e.target.value); renderPanel(); }
    if (e.target.id === 'code-example' && e.target.value) {
      const ex = EXAMPLES.find((x) => x.name === e.target.value);
      e.target.value = '';
      if (ex) { remember(); load(toBlockly(ex.program)); }
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.target.id === 'ai-request' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); build(); }
  });
}

export async function showCode() {
  if (!root.dataset.ready) {
    root.dataset.ready = '1';
    root.innerHTML = `<div class="code">
      <div class="code-head">
        <h1>Block code</h1>
        <div class="code-tools">
          <select id="code-example" aria-label="Load an example"><option value="">Examples…</option>${EXAMPLES.map((x) => `<option>${esc(x.name)}</option>`).join('')}</select>
          <button class="btn" data-code-undo hidden>Undo AI change</button>
          <button class="btn" data-code-clear>Clear</button>
          <button class="btn" data-code-copy>Copy Python</button>
          <button class="btn primary" data-code-download>Download .py</button>
        </div>
      </div>
      <div class="code-main">
        <div id="blockly" class="code-ws" aria-label="Block workspace"><p class="muted" style="padding:16px">Loading blocks…</p></div>
        <aside class="code-side">
          <div class="seg" role="group" aria-label="Panel">
            <button data-code-tab="ai" aria-pressed="true">AI helper</button>
            <button data-code-tab="py" aria-pressed="false">Python</button>
          </div>
          <div id="code-panel"></div>
        </aside>
      </div>
      <p class="small muted code-status" id="code-status"></p>
    </div>`;
    try {
      await loadBlockly();
      $('#blockly', root).innerHTML = '';
      ws = Blockly.inject($('#blockly', root), {
        toolbox: TOOLBOX, theme: theme(), renderer: 'zelos', trashcan: true, sounds: false,
        zoom: { controls: true, wheel: true, startScale: 0.8, maxScale: 2, minScale: 0.4 },
        grid: { spacing: 24, length: 2, colour: '#20252c', snap: true },
        move: { scrollbars: true, drag: true, wheel: false },
      });
      const saved = store.get('code.workspace');
      load(saved?.blocks ? saved : toBlockly(EXAMPLES[0].program));
      ws.addChangeListener((e) => { if (!e.isUiEvent) changed(); });
    } catch (err) {
      $('#blockly', root).innerHTML = `<p class="msg-error" style="padding:16px">${esc(err.message)}</p>`;
    }
  }
  renderPanel();
  if (ws) { Blockly.svgResize(ws); changed(); }
}

function load(state) {
  ws.clear();
  Blockly.serialization.workspaces.load(state, ws);
  if (!ws.getBlocksByType('vex_start').length) {
    const start = ws.newBlock('vex_start');
    start.initSvg(); start.render(); start.moveBy(30, 30);
    start.setDeletable(false);
  }
  ws.getBlocksByType('vex_start').forEach((b) => b.setDeletable(false));
  changed();
}

const current = () => fromBlockly(Blockly.serialization.workspaces.save(ws));

function changed() {
  if (!ws) return;
  const { program, loose, warnings } = current();
  const py = toPython(program);
  ui.python = py;
  ui.program = program;
  const pre = $('#py-out', root);
  if (pre) pre.textContent = py;
  const notes = [...warnings];
  if (loose) notes.push(`${loose} block group${loose === 1 ? ' is' : 's are'} not attached to “when started”, so ${loose === 1 ? 'it' : 'they'} won't run.`);
  $('#code-status', root).textContent = notes.join(' ');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set('code.workspace', Blockly.serialization.workspaces.save(ws)), 300);
}

function remember() {
  undoState = Blockly.serialization.workspaces.save(ws);
  const b = $('[data-code-undo]', root);
  if (b) b.hidden = false;
}

// In testing, phi4:14b wrote correct block programs most often, so it is the default here.
const CODE_MODEL = 'phi4:14b';
function codeModel() {
  const models = helpers.models();
  const saved = store.get('code.model');
  if (models.includes(saved)) return saved;
  return models.includes(CODE_MODEL) ? CODE_MODEL : helpers.pickModel(models);
}

function modelPicker() {
  const models = helpers.models();
  const picked = codeModel();
  const hint = picked === CODE_MODEL
    ? 'phi4 wrote the most correct programs in testing, but takes 1-2 minutes. gemma4 is about 4x faster and makes more mistakes.'
    : models.includes(CODE_MODEL) ? 'Tip: phi4:14b wrote the most correct programs in testing (slower).' : '';
  return `<select id="code-model" aria-label="AI model">${helpers.modelOptions(models, picked)}</select>${hint ? `<span class="small muted">${hint}</span>` : ''}`;
}

function renderPanel() {
  const panel = $('#code-panel', root);
  if (!panel) return;
  root.querySelectorAll('[data-code-tab]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.codeTab === ui.tab));
  if (ui.tab === 'py') {
    panel.innerHTML = `<pre class="py" id="py-out">${esc(ui.python || '')}</pre>
      <p class="small muted">Written for VEX IQ (2nd gen) Python in VEXcode IQ. Check it on your robot before a Match.</p>`;
    return;
  }
  const hasProgram = (ui.program || []).length > 0;
  clearInterval(ui.tick);
  if (ui.busy) {
    const t0 = ui.since;
    ui.tick = setInterval(() => { const el = root.querySelector('[data-elapsed]'); if (el) el.textContent = `${Math.round((Date.now() - t0) / 1000)}s`; }, 1000);
  }
  panel.innerHTML = `<div class="ai-box">
    <label class="field-label">Tell the AI what your robot should do
      <textarea id="ai-request" rows="4" placeholder="e.g. Drive forward 600 mm, turn left, then spin the intake until the bumper is pressed" ${ui.busy ? 'disabled' : ''}>${esc(ui.draft || '')}</textarea>
    </label>
    <label class="check small"><input type="checkbox" id="ai-modify" ${hasProgram ? 'checked' : ''}> Change my current program (instead of starting over)</label>
    <div class="ai-actions">
      <button class="btn primary" data-code-build ${ui.busy ? 'disabled' : ''}>${ui.busy === 'build' ? 'Building… <span data-elapsed></span>' : 'Build blocks'}</button>
      <button class="btn" data-code-explain ${ui.busy ? 'disabled' : ''}>${ui.busy === 'explain' ? 'Reading… <span data-elapsed></span>' : 'Explain my program'}</button>
    </div>
    <label class="field-label">AI model${modelPicker()}</label>
    ${ui.error ? `<p class="msg-error">${esc(ui.error)}</p>` : ''}
    ${ui.aiNote ? `<div class="ai-note"><b>AI:</b> ${esc(ui.aiNote)}${ui.aiWarn.length ? `<p class="small muted">${ui.aiWarn.map(esc).join(' ')}</p>` : ''}</div>` : ''}
    ${ui.explain ? `<div class="ai-note explain">${renderAnswer(ui.explain)}</div>` : ''}
    <p class="small muted">AI can make mistakes. Read the blocks and test slowly on a real robot.</p>
  </div>`;
}

const model = () => $('#code-model', root)?.value || codeModel();

async function build() {
  const request = ($('#ai-request', root)?.value || '').trim();
  if (!request || ui.busy || !ws) return;
  const modify = $('#ai-modify', root)?.checked;
  ui.draft = request; ui.busy = 'build'; ui.since = Date.now(); ui.error = ''; ui.explain = '';
  const m = model();
  renderPanel();
  try {
    const r = await api('/api/code/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request, program: modify ? ui.program : [], model: m }),
    });
    remember();
    load(toBlockly(r.program));
    ui.aiNote = r.summary || `Built ${r.program.length} blocks.`;
    ui.aiWarn = r.warnings || [];
    ui.draft = '';
  } catch (err) {
    ui.error = err.message;
  } finally {
    ui.busy = false;
    renderPanel();
  }
}

async function explain() {
  if (ui.busy || !ws) return;
  const question = ($('#ai-request', root)?.value || '').trim();
  ui.busy = 'explain'; ui.since = Date.now(); ui.error = ''; ui.draft = question;
  const m = model();
  renderPanel();
  try {
    const r = await api('/api/code/explain', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ program: ui.program || [], question, model: m }),
    });
    ui.explain = r.text;
  } catch (err) {
    ui.error = err.message;
  } finally {
    ui.busy = false;
    renderPanel();
  }
}

function onClick(e) {
  const t = e.target.closest('[data-code-tab],[data-code-build],[data-code-explain],[data-code-copy],[data-code-download],[data-code-clear],[data-code-undo]');
  if (!t) return;
  const d = t.dataset;
  if (d.codeTab) { ui.draft = $('#ai-request', root)?.value ?? ui.draft; ui.tab = d.codeTab; renderPanel(); }
  if (d.codeBuild !== undefined) build();
  if (d.codeExplain !== undefined) explain();
  if (d.codeCopy !== undefined) {
    navigator.clipboard?.writeText(ui.python || '').then(() => { t.textContent = 'Copied'; setTimeout(() => { t.textContent = 'Copy Python'; }, 1400); }, () => {});
  }
  if (d.codeDownload !== undefined) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ui.python || ''], { type: 'text/x-python' }));
    a.download = 'vexifiy_program.py';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  if (d.codeClear !== undefined && ws) { remember(); load(toBlockly([])); }
  if (d.codeUndo !== undefined && undoState && ws) { load(undoState); undoState = null; t.hidden = true; }
}
