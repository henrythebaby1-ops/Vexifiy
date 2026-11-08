import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { $, esc } from './util.js';
import {
  FIELD, BAG, START_ZONES, FIELD_BAGS, LOAD_BAGS, POINTS, INFO, locate, scoreBag, tally,
} from './field-data.js';
import {
  buildFieldModels, makeBagGeometry, makeBagMaterials, makeRobot, robotPlateColor,
} from './field-models.js';

const CENTER = new THREE.Vector3(FIELD.x / 2, 0, FIELD.z / 2);

let ctx = null;
let onAsk = () => {};

export function show(opts) {
  onAsk = opts.onAsk;
  if (!ctx) build();
  ctx.visible = true;
  resize();
  invalidate(true);
  loop();
}

export function hide() {
  if (ctx) ctx.visible = false;
}

// ---------- Scene ----------
function build() {
  const host = $('#view-field');
  host.innerHTML = `<div class="field-layout">
    <div class="canvas-wrap" id="canvas-wrap">
      <canvas id="field-canvas" aria-label="Interactive 3D Level Up field. Drag to orbit, drag a Bean Bag to move it."></canvas>
      <div class="field-toolbar">
        <div class="seg" role="group" aria-label="Camera">
          <button data-cam="overview">Overview</button><button data-cam="top">Top</button>
          <button data-cam="red">Red end</button><button data-cam="blue">Blue end</button>
          <button data-cam="pyramid">Pyramid</button><button data-cam="l4">L4</button><button data-cam="robot">Robot</button>
        </div>
        <div class="seg" role="group" aria-label="Match type">
          <button data-mode="teamwork" aria-pressed="true">Teamwork</button><button data-mode="skills" aria-pressed="false">Skills</button>
        </div>
      </div>
      <div class="drop-hint hidden" id="drop-hint" role="status"></div>
    </div>
    <aside class="field-side">
      <div>
        <p class="side-title">Score test</p>
        <div class="score-num" id="score-total">0</div>
        <div class="score-rows" id="score-rows"></div>
        <button class="btn" id="field-reset" style="margin-top:10px;width:100%">Reset field</button>
        <p class="small muted" style="margin-top:7px">Drag Bean Bags onto Goals. The score follows the color and level rules.</p>
      </div>
      <div>
        <p class="side-title">Show</p>
        <label class="toggle"><input type="checkbox" data-layer="labels" checked> Labels</label>
        <label class="toggle"><input type="checkbox" data-layer="robots" checked> Robots at start</label>
        <label class="toggle"><input type="checkbox" data-layer="robotMax"> Robot max size (24")</label>
        <label class="toggle"><input type="checkbox" data-layer="startZones" checked> Start positions</label>
      </div>
      <div class="info-card" id="info-card"></div>
      <p class="small muted" style="margin-top:auto">Modeled from the manual's Appendix A drawings for planning and learning. Use the official Field specs for building.</p>
    </aside>
  </div>`;

  const canvas = $('#field-canvas');
  const wrap = $('#canvas-wrap');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch {
    wrap.innerHTML = '<p class="muted" style="padding:30px">3D needs WebGL, which is not available in this browser.</p>';
    ctx = { visible: false, failed: true };
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // Redrawn only when something moves.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  const labelRenderer = new CSS2DRenderer();
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  wrap.append(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1013);
  const camera = new THREE.PerspectiveCamera(42, 1.6, 1, 1400);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.minDistance = 18;
  controls.maxDistance = 420;

  ctx = {
    visible: true, renderer, labelRenderer, scene, camera, controls, wrap, canvas,
    bags: [], layers: { labels: [], robots: [], robotMax: [], startZones: [] }, pickables: [], surfaces: [],
    mode: 'teamwork', drag: null, tween: null, hover: null, raf: 0,
    ray: new THREE.Raycaster(), pointer: new THREE.Vector2(), floor: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  };

  // Soft studio reflections, generated in code.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();
  const sun = new THREE.DirectionalLight(0xfff4e6, 2.5);
  sun.position.set(CENTER.x - 42, 125, CENTER.z - 48);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  Object.assign(sun.shadow.camera, { left: -78, right: 78, top: 66, bottom: -66, near: 30, far: 260 });
  sun.target.position.copy(CENTER);
  const fill = new THREE.DirectionalLight(0xbcd2ff, 0.55);
  fill.position.set(CENTER.x + 70, 50, CENTER.z + 70);
  scene.add(sun, sun.target, fill);

  // Labels crowd a phone screen, so they start off there.
  if (innerWidth < 860) $('[data-layer=labels]').checked = false;
  buildFieldModels({
    scene,
    pickable: (mesh, info) => { mesh.userData.info = info; ctx.pickables.push(mesh); },
    surface: (mesh) => ctx.surfaces.push(mesh),
    label,
    layer: (name, obj) => ctx.layers[name].push(obj),
  });
  buildRobots();
  resetBags();
  setCamera('overview', true);
  applyLayers();
  showInfo(null);
  bindEvents();
  controls.addEventListener('change', invalidate);
  new ResizeObserver(resize).observe(wrap);
  invalidate(true);
}

// Draws only when the view changes, which keeps the Mac cool. Pass true if shadows changed too.
function invalidate(shadows = false) {
  if (!ctx || ctx.failed) return;
  ctx.dirty = true;
  if (shadows === true) ctx.renderer.shadowMap.needsUpdate = true;
}

function label(text, x, y, z, layer = 'labels') {
  const el = document.createElement('div');
  el.className = 'map-label';
  el.textContent = text;
  const obj = new CSS2DObject(el);
  obj.position.set(x, y, z);
  ctx.scene.add(obj);
  ctx.layers[layer].push(obj);
  return obj;
}

function buildRobots() {
  ctx.robots = START_ZONES.map((s) => {
    const cx = (s.x[0] + s.x[1]) / 2;
    const atFarWall = s.z[0] < 1;
    const zStart = atFarWall ? s.z[0] + 0.5 : s.z[1] - 20.5;
    const { group, proxy, preloadAnchor } = makeRobot(robotPlateColor(s));
    group.position.set(cx, 0, zStart + 10);
    if (!atFarWall) group.rotation.y = Math.PI;
    ctx.scene.add(group);
    proxy.userData.info = 'robot';
    ctx.pickables.push(proxy);
    ctx.layers.robots.push(group, proxy);

    const maxLen = 24;
    const zMax = atFarWall ? s.z[0] + 0.5 : s.z[1] - 24.5;
    const geo = new THREE.BoxGeometry(11, 15, maxLen);
    const ghost = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xf5c518, transparent: true, opacity: 0.08, depthWrite: false }));
    ghost.position.set(cx, 7.55, zMax + maxLen / 2);
    ghost.userData.info = 'robot';
    ghost.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xf5c518 })));
    ctx.scene.add(ghost);
    ctx.pickables.push(ghost);
    ctx.layers.robotMax.push(ghost);
    return { group, proxy, preloadAnchor, zone: s };
  });
}

// ---------- Bean Bags ----------
const bagGeo = makeBagGeometry();
const BAG_MATS = makeBagMaterials();
const tilt = (i) => Math.sin(i * 12.9898) * 0.07; // A little natural misalignment.

function addBag(color, x, z, y = BAG.y / 2 + 0.02, preload = false) {
  const m = new THREE.Mesh(bagGeo, BAG_MATS[color]);
  m.position.set(x, y, z);
  m.rotation.y = tilt(ctx.bags.length + 1);
  m.castShadow = true;
  m.receiveShadow = true;
  const bag = { mesh: m, color, spot: null, preload };
  m.userData.bag = bag;
  m.userData.info = 'bag';
  ctx.scene.add(m);
  ctx.pickables.push(m);
  ctx.bags.push(bag);
  return bag;
}

function resetBags() {
  for (const b of ctx.bags) {
    ctx.scene.remove(b.mesh);
    ctx.pickables.splice(ctx.pickables.indexOf(b.mesh), 1);
  }
  ctx.bags = [];
  FIELD_BAGS.forEach((b) => addBag(b.color, b.pos[0], b.pos[1]));
  LOAD_BAGS[ctx.mode].forEach((b) => addBag(b.color, b.pos[0], b.pos[1]));
  // Preloads ride in the Robots' trays: both in Teamwork, one in Skills.
  ctx.robots.forEach((r) => {
    if (ctx.mode === 'teamwork' || r.zone.wall === 'red') {
      r.group.updateWorldMatrix(true, true);
      const at = r.preloadAnchor.getWorldPosition(new THREE.Vector3());
      addBag('yellow', at.x, at.z, at.y + BAG.y / 2, true);
    }
  });
  applyLayers();
  updateScore();
  invalidate(true);
}

function restHeight(bag, spot, x, z) {
  const base = spot?.height ?? 0;
  const others = ctx.bags.filter((b) => b !== bag && !b.preload
    && Math.abs(b.mesh.position.x - x) < BAG.x * 0.8 && Math.abs(b.mesh.position.z - z) < BAG.z * 0.8
    && (b.spot?.goal ?? null) === (spot?.goal ?? null));
  return base + BAG.y / 2 + 0.02 + others.length * BAG.y;
}

function updateScore() {
  const scored = ctx.bags.filter((b) => b.spot);
  const { total, counts } = tally(scored);
  $('#score-total').textContent = total;
  const rows = [['L4', 'L4'], ['L3', 'L3'], ['L2', 'L2'], ['L1', 'L1'], ['Floor', 'floor']];
  $('#score-rows').innerHTML = rows.map(([name, k]) => `<span>${name}</span><span class="muted">${counts[k]} × ${POINTS[k]}</span><span>${counts[k] * POINTS[k]}</span>`).join('');
}

// ---------- Info panel ----------
function showInfo(key) {
  const card = $('#info-card');
  if (!card) return;
  const info = INFO[key];
  if (!info) {
    card.innerHTML = '<p class="side-title">Explore</p><p class="small muted">Click anything on the field to see its rules and dimensions. Drag empty space to orbit, scroll to zoom.</p>';
    return;
  }
  card.innerHTML = `<p class="side-title">Selected</p>
    <h2>${esc(info.title)}</h2>
    <ul>${info.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
    <div class="chips" style="margin-bottom:10px">${info.rules.map((r) => `<a class="chip" href="#/rules/${r}">${r}</a>`).join('')}</div>
    <button class="btn" id="info-ask" style="width:100%">Ask AI about this</button>`;
  $('#info-ask').onclick = () => onAsk(info.ask);
}

// ---------- Camera ----------
const VIEWS = {
  overview: { pos: [CENTER.x, 62, CENTER.z + 80], target: [CENTER.x, 0, CENTER.z - 5] },
  top: { pos: [CENTER.x, 118, CENTER.z + 0.1], target: [CENTER.x, 0, CENTER.z] },
  red: { pos: [-54, 42, CENTER.z], target: [CENTER.x - 12, 2, CENTER.z] },
  blue: { pos: [FIELD.x + 54, 42, CENTER.z], target: [CENTER.x + 12, 2, CENTER.z] },
  pyramid: { pos: [29, 21, 30], target: [7, 3, 7], fit: false },
  l4: { pos: [20, 30, 66], target: [36.5, 14, 42.5], fit: false },
  robot: { pos: [62, 17, 44], target: [48.5, 5.5, 60], fit: false },
};

function setCamera(name, instant = false) {
  const v = VIEWS[name];
  document.querySelectorAll('[data-cam]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.cam === name));
  ctx.view = name;
  const target = new THREE.Vector3(...v.target);
  // Back the camera away in narrow windows so the whole Field stays in frame.
  const aspect = ctx.camera.aspect || 1.6;
  const fit = v.fit === false ? 1 : Math.max(1, 1.7 / aspect);
  const pos = new THREE.Vector3(...v.pos).sub(target).multiplyScalar(fit).add(target);
  if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    ctx.camera.position.copy(pos);
    ctx.controls.target.copy(target);
    ctx.tween = null;
    return;
  }
  ctx.tween = { start: performance.now(), fromPos: ctx.camera.position.clone(), fromTarget: ctx.controls.target.clone(), pos, target };
}

// ---------- Interaction ----------
function setPointer(e) {
  const r = ctx.canvas.getBoundingClientRect();
  ctx.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ctx.ray.setFromCamera(ctx.pointer, ctx.camera);
}

const pick = () => {
  const hits = ctx.ray.intersectObjects(ctx.pickables.filter((m) => m.visible), false);
  if (!hits.length) return null;
  // The Robot's click box surrounds its Preload, so reach through it to a Bean Bag.
  if (hits[0].object.userData.info === 'robot') {
    const bag = hits.find((h) => h.object.userData.bag && h.distance - hits[0].distance < 24);
    if (bag) return bag;
  }
  return hits[0];
};

function dragTarget() {
  const hit = ctx.ray.intersectObjects(ctx.surfaces, false)[0];
  if (hit) return { x: hit.point.x, z: hit.point.z };
  const p = new THREE.Vector3();
  return ctx.ray.ray.intersectPlane(ctx.floor, p) ? { x: p.x, z: p.z } : null;
}

const describeSpot = (bag, spot) => {
  if (!spot) return 'Open floor';
  const r = scoreBag(bag.color, spot);
  return r.points ? `+${r.points}: ${r.reason}` : `0: ${r.reason}`;
};

function bindEvents() {
  const { canvas } = ctx;
  canvas.addEventListener('pointerdown', (e) => {
    setPointer(e);
    const hit = pick();
    ctx.down = { x: e.clientX, y: e.clientY, key: hit?.object.userData.info };
    const bag = hit?.object.userData.bag;
    if (bag) {
      ctx.drag = { bag, moved: false };
      ctx.controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
      showInfo('bag');
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    setPointer(e);
    if (ctx.drag) {
      const t = dragTarget();
      if (!t) return;
      const moved = Math.hypot(e.clientX - ctx.down.x, e.clientY - ctx.down.y) > 3;
      if (!moved && !ctx.drag.moved) return;
      ctx.drag.moved = true;
      const { bag } = ctx.drag;
      const x = THREE.MathUtils.clamp(t.x, -16, FIELD.x + 16);
      const z = THREE.MathUtils.clamp(t.z, -16, FIELD.z + 16);
      const spot = locate(x, z);
      bag.spot = spot;
      bag.preload = false;
      bag.mesh.position.set(x, restHeight(bag, spot, x, z) + 0.6, z);
      invalidate(true);
      const hint = $('#drop-hint');
      hint.textContent = describeSpot(bag, spot);
      hint.classList.remove('hidden');
      return;
    }
    if (e.buttons) return;
    const hit = pick();
    canvas.style.cursor = hit?.object.userData.bag ? 'grab' : hit ? 'pointer' : 'default';
  });
  const end = (e) => {
    if (ctx.drag) {
      const { bag, moved } = ctx.drag;
      if (moved) {
        const { x, z } = bag.mesh.position;
        bag.mesh.position.y = restHeight(bag, bag.spot, x, z);
        updateScore();
        invalidate(true);
      }
      ctx.drag = null;
      ctx.controls.enabled = true;
      canvas.style.cursor = 'default';
      $('#drop-hint').classList.add('hidden');
    } else if (e.type === 'pointerup' && ctx.down && Math.hypot(e.clientX - ctx.down.x, e.clientY - ctx.down.y) < 4) {
      showInfo(ctx.down.key);
    }
    ctx.down = null;
  };
  ctx.controls.addEventListener('start', () => { ctx.userMoved = true; });
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const host = $('#view-field');
  host.addEventListener('click', (e) => {
    const cam = e.target.closest('[data-cam]');
    if (cam) { ctx.userMoved = false; setCamera(cam.dataset.cam); }
    const mode = e.target.closest('[data-mode]');
    if (mode) {
      ctx.mode = mode.dataset.mode;
      host.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b === mode));
      resetBags();
    }
    if (e.target.id === 'field-reset') resetBags();
  });
  host.addEventListener('change', (e) => { if (e.target.dataset.layer) applyLayers(); });
}

function applyLayers() {
  document.querySelectorAll('[data-layer]').forEach((input) => {
    ctx.layers[input.dataset.layer].forEach((o) => { o.visible = input.checked; });
  });
  const showRobots = document.querySelector('[data-layer=robots]').checked;
  ctx.robots.forEach((r) => {
    const on = showRobots && (ctx.mode === 'teamwork' || r.zone.wall === 'red');
    r.group.visible = on;
    r.proxy.visible = on;
  });
  invalidate(true);
}

function resize() {
  if (!ctx || ctx.failed) return;
  const { clientWidth: w, clientHeight: h } = ctx.wrap;
  if (!w || !h) return;
  ctx.renderer.setSize(w, h, false);
  ctx.labelRenderer.setSize(w, h);
  ctx.camera.aspect = w / h;
  ctx.camera.updateProjectionMatrix();
  if (!ctx.userMoved && ctx.view) setCamera(ctx.view, true);
  invalidate();
}

function loop() {
  if (!ctx || ctx.failed) return;
  cancelAnimationFrame(ctx.raf);
  const frame = () => {
    if (!ctx.visible) return;
    if (ctx.tween) {
      const tw = ctx.tween;
      const t = Math.min(1, (performance.now() - tw.start) / 750);
      const k = 1 - (1 - t) ** 3;
      ctx.camera.position.lerpVectors(tw.fromPos, tw.pos, k);
      ctx.controls.target.lerpVectors(tw.fromTarget, tw.target, k);
      if (t >= 1) { ctx.tween = null; ctx.dirty = true; }
    }
    ctx.controls.update();
    if (ctx.tween) ctx.dirty = true;
    if (ctx.dirty) {
      ctx.dirty = false;
      ctx.renderer.render(ctx.scene, ctx.camera);
      ctx.labelRenderer.render(ctx.scene, ctx.camera);
    }
    ctx.raf = requestAnimationFrame(frame);
  };
  frame();
}

// Read-only hook for browser tests.
export const inspect = () => ctx;
