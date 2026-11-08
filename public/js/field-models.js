// Procedural 3D models for the Level Up field. Everything is generated in code,
// so no model files are needed. All units are inches.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  FIELD, BAG, LEVELS, L4_HEIGHT, L4_POSTS, SHORT_POSTS, RAILS, BARRIERS, ZONES, START_ZONES, POINTS,
} from './field-data.js';

const COLOR = {
  red: 0xc8202c, blue: 0x1f5fd0, yellow: 0xf2c014, pipe: 0xeabb12, plate: 0x34383e,
  charcoal: 0x1c1f23, gray: 0x8d939b, wall: 0xd0d3d7, corner: 0x43484f,
};

const std = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.02, ...opts });
const plastic = (color, opts = {}) => std(color, { roughness: 0.42, ...opts });

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function texOf(canvas, { srgb = true, repeat } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

// Small seeded generator, so textures look the same on every load.
function rng(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function speckle(g, w, h, count, seed, colors) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

// ---------- Field floor ----------
function floorTextures() {
  const px = 22;
  const W = FIELD.x * px; const H = FIELD.z * px;
  const [c, g] = canvasOf(W, H);
  const [b, gb] = canvasOf(W, H);
  g.fillStyle = '#c9ccd0';
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 90000, 11, ['#bcc0c5', '#d6d8db', '#b2b6bb', '#dfe1e3']);
  gb.fillStyle = '#909090';
  gb.fillRect(0, 0, W, H);
  speckle(gb, W, H, 70000, 23, ['#868686', '#9a9a9a', '#7c7c7c']);

  // Peg holes across each tile.
  for (let x = 0.5 + 1.5; x < FIELD.x; x += 1.5) {
    for (let z = 0.5 + 1.5; z < FIELD.z; z += 1.5) {
      g.fillStyle = 'rgba(70,74,80,.34)';
      g.beginPath(); g.arc(x * px, z * px, 0.13 * px, 0, 7); g.fill();
      gb.fillStyle = '#505050';
      gb.beginPath(); gb.arc(x * px, z * px, 0.13 * px, 0, 7); gb.fill();
    }
  }
  // Interlocking tile seams, with small puzzle tabs.
  const seam = (ctx, color, width) => {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath();
    for (let x = 0.5; x < FIELD.x; x += FIELD.tile) {
      for (let z = 0.5; z < FIELD.z - 1; z += 3) {
        ctx.moveTo(x * px, z * px);
        ctx.lineTo(x * px, (z + 1.1) * px);
        ctx.lineTo((x + 0.32) * px, (z + 1.1) * px);
        ctx.lineTo((x + 0.32) * px, (z + 1.9) * px);
        ctx.lineTo(x * px, (z + 1.9) * px);
        ctx.lineTo(x * px, (z + 3) * px);
      }
    }
    for (let z = 0.5; z < FIELD.z; z += FIELD.tile) {
      for (let x = 0.5; x < FIELD.x - 1; x += 3) {
        ctx.moveTo(x * px, z * px);
        ctx.lineTo((x + 1.1) * px, z * px);
        ctx.lineTo((x + 1.1) * px, (z + 0.32) * px);
        ctx.lineTo((x + 1.9) * px, (z + 0.32) * px);
        ctx.lineTo((x + 1.9) * px, z * px);
        ctx.lineTo((x + 3) * px, z * px);
      }
    }
    ctx.stroke();
  };
  seam(g, 'rgba(95,99,105,.55)', 1.4);
  seam(gb, '#303030', 2);

  // Dark grid lines shown on the official field drawings.
  g.fillStyle = '#17191c';
  for (let x = FIELD.gridStart; x < FIELD.x; x += FIELD.tile) {
    for (let z = 0; z < FIELD.z; z += 1.5) g.fillRect((x - 0.22) * px, z * px, 0.44 * px, 1.22 * px);
  }
  for (let z = FIELD.gridStart; z < FIELD.z; z += FIELD.tile) {
    for (let x = 0; x < FIELD.x; x += 1.5) g.fillRect(x * px, (z - 0.22) * px, 1.22 * px, 0.44 * px);
  }
  return { map: texOf(c), bumpMap: texOf(b, { srgb: false }) };
}

function holeTexture(color, w, h, pitch = 1) {
  const [c, g] = canvasOf(64, 64);
  g.fillStyle = `#${new THREE.Color(color).getHexString()}`;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(0,0,0,.52)';
  g.beginPath(); g.arc(32, 32, 12, 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 2;
  g.beginPath(); g.arc(32, 32, 15, 0, 7); g.stroke();
  return texOf(c, { repeat: [w / pitch, h / pitch] });
}

// ---------- Painted goal plates ----------
function hazard(g, x, y, w, h, k) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = '#25282c'; g.fillRect(x, y, w, h);
  g.strokeStyle = '#d7d9dc'; g.lineWidth = 0.28 * k;
  const span = w + h;
  for (let i = -h; i < span; i += 0.62 * k) {
    g.beginPath(); g.moveTo(x + i, y + h); g.lineTo(x + i + h, y); g.stroke();
  }
  g.restore();
}

function plateText(g, text, x, y, size, rotate = 0) {
  g.save();
  g.translate(x, y); g.rotate(rotate);
  g.fillStyle = '#f1f2f3';
  g.font = `700 ${size}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 0, 0);
  g.restore();
}

function octagonPath(g, cx, cy, r) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
}

function plateTexture(level, nextSize, flip) {
  const S = 1024;
  const size = level.size - 0.5;
  const k = S / size;
  const [c, g] = canvasOf(S, S);
  if (flip) { g.translate(S, S); g.rotate(Math.PI); }
  g.fillStyle = '#35393f';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 9000, 37 + level.size * 10, ['#3f4349', '#2e3237', '#44484e']);

  const next = Math.max(0, nextSize - 0.5);
  // Peg holes around the edge of the exposed surface.
  g.fillStyle = 'rgba(0,0,0,.5)';
  for (let t = 0.5; t < size; t += 1) {
    for (const [px, pz] of [[size - 0.3, t], [t, size - 0.3]]) {
      g.beginPath(); g.arc(px * k, pz * k, 0.1 * k, 0, 7); g.fill();
    }
  }
  if (next) {
    const arm = size - next;
    // Lanes along the two exposed arms of the step.
    const textSize = Math.min(arm * 0.62, 3) * k;
    plateText(g, level.id, next * 0.24 * k, (next + arm / 2) * k, textSize);
    plateText(g, level.id, (next + arm / 2) * k, next * 0.24 * k, textSize, Math.PI / 2);
    const stripe = arm * 0.32;
    hazard(g, next * 0.52 * k, (next + arm / 2 - stripe / 2) * k, (size - next * 0.52 - arm * 0.12) * k, stripe * k, k);
    hazard(g, (next + arm / 2 - stripe / 2) * k, next * 0.52 * k, stripe * k, (size - next * 0.52 - arm * 0.12) * k, k);
    g.strokeStyle = '#d9ae12'; g.lineWidth = 0.1 * k;
    g.beginPath();
    g.moveTo(0, (next + 0.32) * k);
    g.lineTo((next + 0.32) * k, (next + 0.32) * k);
    g.lineTo((next + 0.32) * k, 0);
    g.moveTo(0, (size - 0.55) * k);
    g.lineTo((size - 0.55) * k, (size - 0.55) * k);
    g.lineTo((size - 0.55) * k, 0);
    g.stroke();
  } else {
    // Top step: a yellow target and its level name.
    const cx = size * 0.34; const cy = size * 0.4;
    octagonPath(g, cx * k, cy * k, 1.9 * k);
    g.fillStyle = '#f0bf14'; g.fill();
    g.strokeStyle = '#25282c'; g.lineWidth = 0.14 * k;
    octagonPath(g, cx * k, cy * k, 1.25 * k); g.stroke();
    plateText(g, level.id, size * 0.32 * k, size * 0.82 * k, 1.75 * k);
    plateText(g, level.id, size * 0.83 * k, size * 0.36 * k, 1.75 * k, Math.PI / 2);
  }
  return texOf(c);
}

function l4Texture() {
  const S = 1024;
  const [c, g] = canvasOf(S, S);
  const m = S / 2;
  g.fillStyle = '#2d3035';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 6000, 91, ['#383b40', '#25282c']);
  // Striped wedges around the rim.
  for (let i = 0; i < 4; i++) {
    g.save();
    g.translate(m, m); g.rotate((i * Math.PI) / 2 + Math.PI / 4);
    g.strokeStyle = '#d7d9dc'; g.lineWidth = 15;
    for (let x = -95; x <= 95; x += 38) {
      g.beginPath(); g.moveTo(x, -m * 0.92); g.lineTo(x + 26, -m * 0.72); g.stroke();
    }
    g.restore();
  }
  g.strokeStyle = '#e4b312'; g.lineWidth = 11;
  octagonPath(g, m, m, m * 0.62); g.stroke();
  octagonPath(g, m, m, m * 0.42); g.stroke();
  plateText(g, 'L4', m * 0.26, m, 104, -Math.PI / 2);
  plateText(g, 'L4', m * 1.74, m, 104, Math.PI / 2);
  return texOf(c);
}

// ---------- Bean Bags ----------
function fabricTexture() {
  const [c, g] = canvasOf(256, 256);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 4) {
    g.fillStyle = i % 8 ? 'rgba(0,0,0,.05)' : 'rgba(0,0,0,.09)';
    g.fillRect(i, 0, 2, 256);
    g.fillRect(0, i, 256, 2);
  }
  return c;
}

// A soft, pillowy rounded bag, puffy in the middle and pinched toward its seam.
export function makeBagGeometry() {
  const raw = new THREE.BoxGeometry(1, 1, 1, 22, 6, 18);
  raw.deleteAttribute('uv'); raw.deleteAttribute('normal');
  const geo = mergeVertices(raw, 1e-4);
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = p.getX(i) * 2; const ny = p.getY(i) * 2; const nz = p.getZ(i) * 2;
    // Soft rectangle: only the corners get rounded.
    const hx = BAG.x / 2; const hz = BAG.z / 2; const corner = 0.62;
    let px = nx * hx; let pz = nz * hz;
    const dx = Math.abs(px) - (hx - corner); const dz = Math.abs(pz) - (hz - corner);
    if (dx > 0 && dz > 0) {
      const len = Math.max(dx, dz) / Math.hypot(dx, dz);
      px = Math.sign(px) * (hx - corner + dx * len);
      pz = Math.sign(pz) * (hz - corner + dz * len);
    }
    // Puffy in the middle, pinching down to a flat sewn edge.
    const edge = Math.min(1 - Math.abs(nx), 1 - Math.abs(nz));
    const puff = 0.14 + 0.86 * Math.sqrt(1 - (1 - Math.min(edge * 3.4, 1)) ** 2);
    const wobble = Math.sin(nx * 5.1 + nz * 3.3) * 0.02 + Math.cos(nz * 6.7 - nx * 2.1) * 0.016;
    p.setXYZ(i, px, (ny * BAG.y) / 2 * puff + wobble * BAG.y * puff, pz);
    uv[i * 2] = nx * 0.5 + 0.5;
    uv[i * 2 + 1] = nz * 0.5 + 0.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

export function makeBagMaterials() {
  const canvas = fabricTexture();
  const map = texOf(canvas);
  const bump = texOf(canvas, { srgb: false });
  const make = (color) => new THREE.MeshPhysicalMaterial({
    color, map, bumpMap: bump, bumpScale: 0.4, roughness: 0.92, sheen: 0.8, sheenRoughness: 0.55, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35),
  });
  return { red: make(0xdd2a35), blue: make(0x2472ea), yellow: make(0xf6c70f) };
}

// ---------- Field and goals ----------
export function buildFieldModels(api) {
  const { scene, pickable, surface, label, layer } = api;
  const add = (mesh, info, shadow = true) => {
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (info) pickable(mesh, info);
    return mesh;
  };
  const box = (xr, yr, zr, material, info, radius = 0) => {
    const w = xr[1] - xr[0]; const h = yr[1] - yr[0]; const d = zr[1] - zr[0];
    const geo = radius ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, h / 2.01, w / 2.01, d / 2.01)) : new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, material);
    m.position.set((xr[0] + xr[1]) / 2, (yr[0] + yr[1]) / 2, (zr[0] + zr[1]) / 2);
    return add(m, info);
  };
  const tube = (a, b, r, material, info, radial = 20) => {
    const from = new THREE.Vector3(...a); const to = new THREE.Vector3(...b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, from.distanceTo(to), radial), material);
    m.position.copy(from).lerp(to, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    return add(m, info);
  };
  const cylinder = (x, y, z, rTop, rBottom, h, material, info, radial = 36) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, radial), material);
    m.position.set(x, y + h / 2, z);
    return add(m, info);
  };

  // Round room floor that fades into the background.
  const [gc, gg] = canvasOf(1024, 1024);
  const grad = gg.createRadialGradient(512, 512, 120, 512, 512, 512);
  grad.addColorStop(0, '#20242a'); grad.addColorStop(0.45, '#14171b'); grad.addColorStop(1, '#0e1013');
  gg.fillStyle = grad; gg.fillRect(0, 0, 1024, 1024);
  const room = new THREE.Mesh(new THREE.CircleGeometry(460, 64), new THREE.MeshBasicMaterial({ map: texOf(gc), toneMapped: false }));
  room.rotation.x = -Math.PI / 2;
  room.position.set(FIELD.x / 2, -0.1, FIELD.z / 2);
  scene.add(room);

  // Driver Station mats on each side.
  const mat = (x0, x1, color) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, FIELD.z), std(color, { roughness: 0.92 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, -0.04, FIELD.z / 2);
    m.receiveShadow = true;
    scene.add(m);
  };
  mat(-16, -1.5, 0x241c20);
  mat(FIELD.x + 1.5, FIELD.x + 16, 0x1d212c);
  mat(-16, -15.8, COLOR.blue);
  mat(FIELD.x + 15.8, FIELD.x + 16, COLOR.red);
  label('Blue Driver Station', -8.5, 0.5, 22);
  label('Red Driver Station', FIELD.x + 8.5, 0.5, FIELD.z - 22);

  // Tiles.
  const tex = floorTextures();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.x, FIELD.z), std(0xffffff, { ...tex, bumpScale: 0.6, roughness: 0.86 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(FIELD.x / 2, 0, FIELD.z / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  buildPerimeter(box);
  buildZones(api, box);
  for (const s of START_ZONES) {
    const area = new THREE.Mesh(
      new THREE.PlaneGeometry(s.x[1] - s.x[0], s.z[1] - s.z[0]),
      new THREE.MeshBasicMaterial({ color: COLOR.yellow, transparent: true, opacity: 0.2, depthWrite: false }),
    );
    area.rotation.x = -Math.PI / 2;
    area.position.set((s.x[0] + s.x[1]) / 2, 0.03, (s.z[0] + s.z[1]) / 2);
    scene.add(area);
    pickable(area, 'start');
    layer('startZones', area);
  }

  buildPyramid(api, box, tube, COLOR.red, false);
  buildPyramid(api, box, tube, COLOR.blue, true);
  buildPosts({ box, tube, cylinder, surface, pickable, add, label });
}

function buildPerimeter(box) {
  const { x, z, wall, wallHeight } = FIELD;
  const section = plastic(COLOR.wall);
  const corner = plastic(COLOR.corner);
  const lip = plastic(0xb8bcc2);
  const c = 2.2;
  const run = (from, to, place) => {
    const count = Math.round((to - from) / 12);
    const step = (to - from) / count;
    for (let i = 0; i < count; i++) place(from + i * step + 0.04, from + (i + 1) * step - 0.04);
  };
  run(c, x - c, (a, b) => {
    for (const zr of [[0, wall], [z - wall, z]]) {
      box([a, b], [0, wallHeight - 0.15], zr, section, null, 0.08);
      box([a, b], [wallHeight - 0.15, wallHeight], [zr[0] - 0.06, zr[1] + 0.06], lip, null, 0.06);
    }
  });
  run(c, z - c, (a, b) => {
    for (const xr of [[0, wall], [x - wall, x]]) {
      box(xr, [0, wallHeight - 0.15], [a, b], section, null, 0.08);
      box([xr[0] - 0.06, xr[1] + 0.06], [wallHeight - 0.15, wallHeight], [a, b], lip, null, 0.06);
    }
  });
  for (const [xr, zr] of [[[0, c], [0, c]], [[x - c, x], [0, c]], [[0, c], [z - c, z]], [[x - c, x], [z - c, z]]]) {
    const inX = xr[0] === 0 ? [0, wall] : [x - wall, x];
    const inZ = zr[0] === 0 ? [0, wall] : [z - wall, z];
    box(xr, [0, wallHeight + 0.08], inZ, corner, null, 0.1);
    box(inX, [0, wallHeight + 0.08], zr, corner, null, 0.1);
  }
}

function buildZones({ scene, pickable, label }, box) {
  const beamFor = (length, color, alongZ) => {
    const texture = holeTexture(color, alongZ ? 1 : length, alongZ ? length : 1, 0.5);
    return plastic(0xffffff, { map: texture });
  };
  const zones = [
    [ZONES.floorRed, COLOR.red, 'floor'], [ZONES.floorBlue, COLOR.blue, 'floor'],
    [ZONES.loadBlue, COLOR.blue, 'load'], [ZONES.loadRed, COLOR.red, 'load'],
  ];
  for (const [r, color, info] of zones) {
    const x = r.x[0] < 10 ? [r.x[1] - 0.5, r.x[1]] : [r.x[0], r.x[0] + 0.5];
    const length = r.z[1] - r.z[0];
    const m = box(x, [0, 0.5], r.z, beamFor(length, color, true), info);
    m.material.map.repeat.set(1, length / 0.5);
    const tint = new THREE.Mesh(
      new THREE.PlaneGeometry(r.x[1] - r.x[0], length),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: info === 'floor' ? 0.2 : 0.08, depthWrite: false }),
    );
    tint.rotation.x = -Math.PI / 2;
    tint.position.set((r.x[0] + r.x[1]) / 2, 0.02, (r.z[0] + r.z[1]) / 2);
    scene.add(tint);
    pickable(tint, info);
    label(info === 'floor' ? 'Floor Goal · 1' : 'Load Zone', (r.x[0] + r.x[1]) / 2, 2, (r.z[0] + r.z[1]) / 2);
  }
  const grayBeam = () => plastic(0xffffff, { map: holeTexture(COLOR.gray, 6.5, 1, 0.5) });
  box(ZONES.floorRed.x, [0, 0.5], [54.25, 54.75], grayBeam());
  box(ZONES.floorBlue.x, [0, 0.5], [18.25, 18.75], grayBeam());
}

function buildPyramid({ scene, surface, pickable, label }, box, tube, color, flip) {
  const fx = (a, b) => (flip ? [FIELD.x - b, FIELD.x - a] : [a, b]);
  const fz = (a, b) => (flip ? [FIELD.z - b, FIELD.z - a] : [a, b]);
  const inward = flip ? -1 : 1;
  const trim = plastic(COLOR.charcoal);
  const steel = std(0xa9adb3, { metalness: 0.6, roughness: 0.38 });

  LEVELS.forEach((lvl, i) => {
    const prev = i ? LEVELS[i - 1].height : 0;
    const h = lvl.height - prev - 0.1;
    const span = lvl.size - 0.5;
    const body = box(fx(0.5, lvl.size), [prev, prev + h], fz(0.5, lvl.size), std(color, { roughness: 0.48 }), 'pyramid');
    body.userData.pyramid = true;

    // Colored side panels with their rows of holes, on the two faces toward the field.
    const panelMat = plastic(0xffffff, { map: holeTexture(color, span, h, 1) });
    const faceX = new THREE.Mesh(new THREE.PlaneGeometry(span, h), panelMat);
    const edgeX = flip ? FIELD.x - lvl.size - 0.01 : lvl.size + 0.01;
    const midZ = (fz(0.5, lvl.size)[0] + fz(0.5, lvl.size)[1]) / 2;
    faceX.position.set(edgeX, prev + h / 2, midZ);
    faceX.rotation.y = (inward * Math.PI) / 2;
    const faceZ = new THREE.Mesh(new THREE.PlaneGeometry(span, h), panelMat);
    const edgeZ = flip ? FIELD.z - lvl.size - 0.01 : lvl.size + 0.01;
    const midX = (fx(0.5, lvl.size)[0] + fx(0.5, lvl.size)[1]) / 2;
    faceZ.position.set(midX, prev + h / 2, edgeZ);
    faceZ.rotation.y = flip ? Math.PI : 0;
    for (const f of [faceX, faceZ]) { f.receiveShadow = true; scene.add(f); pickable(f, 'pyramid'); }

    // Printed top sheet. Only its top face carries the artwork.
    const next = LEVELS[i + 1]?.size ?? 0;
    const sheetSide = std(COLOR.plate);
    const sheetTop = std(0xffffff, { map: plateTexture(lvl, next, flip), roughness: 0.58 });
    const sheet = box(fx(0.5, lvl.size), [lvl.height - 0.1, lvl.height], fz(0.5, lvl.size),
      [sheetSide, sheetSide, sheetTop, sheetSide, sheetSide, sheetSide], 'pyramid');
    surface(sheet);

    // Dark edge trim and steel corner standoff.
    const t = 0.24;
    box(flip ? [FIELD.x - lvl.size - t / 2, FIELD.x - lvl.size + t / 2] : [lvl.size - t / 2, lvl.size + t / 2], [lvl.height - 0.3, lvl.height + 0.03], fz(0.5, lvl.size), trim, 'pyramid');
    box(fx(0.5, lvl.size), [lvl.height - 0.3, lvl.height + 0.03], flip ? [FIELD.z - lvl.size - t / 2, FIELD.z - lvl.size + t / 2] : [lvl.size - t / 2, lvl.size + t / 2], trim, 'pyramid');
    const cx = flip ? FIELD.x - lvl.size + 0.16 : lvl.size - 0.16;
    const cz = flip ? FIELD.z - lvl.size + 0.16 : lvl.size - 0.16;
    tube([cx, prev, cz], [cx, lvl.height + 0.05, cz], 0.2, steel, 'pyramid', 12);

    const c = (lvl.size + next) / 2;
    label(`${lvl.id} · ${POINTS[lvl.id]}`, flip ? FIELD.x - c : c, lvl.height + 1.3, flip ? FIELD.z - c : c);
  });

  // L3 backstop, aligned with the long side of the Field.
  const speckled = plastic(0xffffff, { map: holeTexture(0x1f2226, 5.75, 2, 0.5) });
  box(fx(0.5, 6.25), [8, 10], fz(0.5, 1), speckled, 'pyramid', 0.05);
  box(fx(0.5, 6.25), [9.9, 10.05], fz(0.42, 1.08), trim, 'pyramid');
}

function buildPosts({ box, tube, cylinder, surface, pickable, add, label }) {
  const pipe = new THREE.MeshPhysicalMaterial({ color: COLOR.pipe, roughness: 0.34, clearcoat: 0.5, clearcoatRoughness: 0.35 });
  const coupler = plastic(0xd9aa0d);
  const dark = plastic(COLOR.charcoal);
  const darker = std(0x121417, { roughness: 0.75 });
  const steel = std(0xb4b8bd, { metalness: 0.75, roughness: 0.32 });

  const footing = (x, z, info) => {
    cylinder(x, 0, z, 3.0, 3.3, 0.45, dark, info);
    cylinder(x, 0.45, z, 1.75, 2.2, 0.5, darker, info);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 + Math.PI / 8;
      cylinder(x + Math.cos(a) * 2.55, 0.45, z + Math.sin(a) * 2.55, 0.14, 0.14, 0.08, steel, null, 8);
    }
    cylinder(x, 0.95, z, 1.0, 1.0, 1.1, coupler, info, 24);
  };

  const topMaterial = std(0xffffff, { map: l4Texture(), roughness: 0.55 });
  const topSide = plastic(COLOR.charcoal);
  for (const p of L4_POSTS) {
    footing(p.x, p.z, 'l4');
    tube([p.x, 0.9, p.z], [p.x, L4_HEIGHT - 0.95, p.z], 0.75, pipe, 'l4', 24);
    cylinder(p.x, 11.2, p.z, 0.92, 0.92, 1.3, coupler, 'l4', 24);
    cylinder(p.x, L4_HEIGHT - 1.75, p.z, 0.98, 0.98, 1.0, coupler, 'l4', 24);

    // Hub and gussets under the octagon.
    cylinder(p.x, L4_HEIGHT - 1.05, p.z, 2.1, 1.05, 0.62, dark, 'l4', 24);
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.34, 0.2), dark);
      rib.position.set(p.x, L4_HEIGHT - 0.46, p.z);
      rib.rotation.y = (i * Math.PI) / 4;
      add(rib, 'l4');
    }
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(3.79, 3.79, 0.26, 8),
      [topSide, topMaterial, topSide],
    );
    plate.rotation.y = Math.PI / 8;
    plate.position.set(p.x, L4_HEIGHT - 0.13, p.z);
    add(plate, 'l4');
    surface(plate);
    label('L4 · 16 (yellow only)', p.x, L4_HEIGHT + 2.2, p.z);
  }

  for (const p of SHORT_POSTS) {
    footing(p.x, p.z, 'wall');
    tube([p.x, 0.9, p.z], [p.x, 7.1, p.z], 0.75, pipe, 'wall', 24);
    cylinder(p.x, 7.1, p.z, 0.82, 0.92, 0.3, dark, 'wall', 24);
  }

  for (const r of RAILS) {
    tube([r.x, 5.83, r.z[0] + 0.1], [r.x, 5.83, r.z[1]], 0.42, pipe, 'wall', 18);
    // Collars where the rail meets each post.
    for (const post of [...L4_POSTS, ...SHORT_POSTS].filter((q) => q.x === r.x)) {
      tube([r.x, 5.83, post.z - 1.15], [r.x, 5.83, post.z + 1.15], 0.92, coupler, 'wall', 22);
    }
    // A-frame bracket holding the rail at the field wall, per the wall section drawing.
    const atWall = r.z[0] < 1 ? r.z[0] + 0.7 : r.z[1] - 0.7;
    for (const side of [-1, 1]) tube([r.x + side * 1.45, 0.05, atWall], [r.x, 5.7, atWall], 0.19, dark, 'wall', 10);
    tube([r.x - 0.75, 2.6, atWall], [r.x + 0.75, 2.6, atWall], 0.14, dark, 'wall', 10);
    box([r.x - 1.7, r.x + 1.7], [0, 0.2], [atWall - 0.5, atWall + 0.5], dark, 'wall', 0.04);
  }

  // Floor barriers: a low wedge with its slope facing away from the rail side, about 16.5 degrees.
  const profile = new THREE.Shape();
  profile.moveTo(0, 0); profile.lineTo(3, 0); profile.lineTo(3, 0.15); profile.lineTo(1, 0.75); profile.lineTo(0, 0.75); profile.closePath();
  BARRIERS.forEach((b, i) => {
    const len = b.z[1] - b.z[0];
    const geo = new THREE.ExtrudeGeometry(profile, { depth: len, bevelEnabled: false });
    const m = new THREE.Mesh(geo, plastic(COLOR.yellow));
    if (i === 0) m.position.set(b.x[0], 0, b.z[0]);
    else { m.rotation.y = Math.PI; m.position.set(b.x[1], 0, b.z[1]); }
    add(m, 'barrier');
  });

  label('Wall structure', RAILS[0].x, 8, 7);
  label('Wall structure', RAILS[1].x, 8, FIELD.z - 7);
  void pickable;
}

// ---------- Robot ----------
// A generic demo robot built to fit the 11 x 20 x 15 inch starting size. Front is +z.
export function makeRobot(plateColor) {
  const group = new THREE.Group();
  const add = (mesh, parent = group) => { mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };
  const beamMat = (len) => plastic(0xffffff, { map: holeTexture(0x4d545c, 1, len, 0.5) });
  const part = (w, h, d, x, y, z, material, r = 0.06, parent = group) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.01, h / 2.01, d / 2.01)), material);
    m.position.set(x, y, z);
    return add(m, parent);
  };
  const dark = plastic(COLOR.charcoal);
  const motorMat = plastic(0x2a2d32);
  const white = plastic(0xe5e7ea);
  const rubber = std(0x15171a, { roughness: 0.88 });
  const hubMat = plastic(0xf2c014);
  const steel = std(0xb4b8bd, { metalness: 0.8, roughness: 0.3 });

  // Drive wheels with hubs and tread grooves.
  for (const sx of [-1, 1]) {
    for (const z of [-6.4, 0, 6.4]) {
      const wheel = new THREE.Group();
      wheel.position.set(sx * 4.75, 1.25, z);
      wheel.rotation.z = Math.PI / 2;
      add(new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.95, 28), rubber), wheel);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 1.0, 16), hubMat), wheel);
      for (const offset of [-0.26, 0, 0.26]) {
        const groove = new THREE.Mesh(new THREE.TorusGeometry(1.24, 0.045, 6, 30), std(0x0a0b0c));
        groove.rotation.x = Math.PI / 2;
        groove.position.y = offset;
        wheel.add(groove);
      }
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 8), steel), wheel);
      group.add(wheel);
    }
    // Twin chassis rails.
    part(0.5, 1, 17.5, sx * 3.85, 1.45, 0, beamMat(17.5));
    part(0.5, 0.5, 17.5, sx * 3.85, 3.0, 0, beamMat(17.5));
    for (const z of [-6.4, 0, 6.4]) part(0.5, 2, 0.5, sx * 3.85, 2.2, z, beamMat(2));
    // Motor pods.
    part(1.5, 1.5, 2.2, sx * 2.65, 1.75, -3.3, motorMat, 0.14);
    part(1.5, 1.5, 2.2, sx * 2.65, 1.75, 3.3, motorMat, 0.14);
    // Lift tower with a rear brace.
    part(0.5, 7.2, 1, sx * 3.25, 6.5, -2.2, beamMat(7.2));
    const brace = part(0.5, 8.2, 0.5, sx * 3.25, 6.3, -4.8, beamMat(8.2));
    brace.rotation.x = -0.62;
  }
  for (const z of [-8.2, -2.2, 7.8]) part(7.2, 0.5, 0.5, 0, 3.0, z, beamMat(7.2));

  // Brain with its screen, on the back of the chassis.
  part(3.3, 1.15, 4.9, 0, 3.85, -5.2, white, 0.2);
  const [sc, sg] = canvasOf(256, 128);
  sg.fillStyle = '#0d2233'; sg.fillRect(0, 0, 256, 128);
  sg.fillStyle = '#6fd6ff'; sg.font = '700 40px -apple-system, Arial, sans-serif';
  sg.textAlign = 'center'; sg.fillText('VEXIFIY', 128, 58);
  sg.font = '26px -apple-system, Arial, sans-serif'; sg.fillStyle = '#ffffff'; sg.fillText('Ready', 128, 100);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.45), new THREE.MeshStandardMaterial({ map: texOf(sc), emissive: 0xffffff, emissiveMap: texOf(sc), emissiveIntensity: 0.7 }));
  screen.rotation.x = -Math.PI / 2;
  screen.rotation.z = Math.PI;
  screen.position.set(0, 4.44, -4.5);
  group.add(screen);
  for (const x of [-0.65, 0, 0.65]) part(0.42, 0.1, 0.42, x, 4.45, -6.75, dark, 0.04);
  part(2.8, 1, 3.6, 0, 2.05, -5.8, plastic(0x3a3f46), 0.12);

  // Lift arm, pivoting on the tower, with a large drive gear.
  const pivot = new THREE.Group();
  pivot.position.set(0, 9.9, -2.2);
  group.add(pivot);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 7.4, 10), steel);
  axle.rotation.z = Math.PI / 2;
  add(axle, pivot);
  const gearMat = plastic(0xe6e7e9);
  const gearShape = new THREE.Shape();
  const teeth = 24;
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i * Math.PI) / teeth;
    const r = i % 2 ? 1.5 : 1.72;
    gearShape[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  gearShape.closePath();
  const gearGeo = new THREE.ExtrudeGeometry(gearShape, { depth: 0.24, bevelEnabled: false });
  gearGeo.rotateY(Math.PI / 2);
  for (const sx of [-1, 1]) {
    const gear = new THREE.Mesh(gearGeo, gearMat);
    gear.position.x = sx * 2.5 - 0.12;
    add(gear, pivot);
  }
  part(1.5, 1.5, 2, 0, 6.4, -2.2, motorMat, 0.14);

  const armLength = 10.4;
  const arm = new THREE.Group();
  arm.rotation.x = 0.36; // Tips the arm down toward the front.
  pivot.add(arm);
  for (const sx of [-1, 1]) {
    part(0.5, 1, armLength, sx * 2.75, 0, armLength / 2 - 0.4, beamMat(armLength), 0.06, arm);
    part(0.5, 0.5, armLength * 0.86, sx * 2.75, 1.25, armLength * 0.4, beamMat(armLength), 0.06, arm);
    part(0.5, 1.75, 0.5, sx * 2.75, 0.6, armLength * 0.68, beamMat(2), 0.06, arm);
  }
  part(5.8, 0.5, 0.5, 0, 0, armLength * 0.54, beamMat(5.8), 0.06, arm);

  // Tray at the end of the arm, sized for one Bean Bag.
  const trayMount = new THREE.Group();
  trayMount.position.set(0, 0, armLength - 0.4);
  trayMount.rotation.x = -0.36; // Keeps the tray level.
  arm.add(trayMount);
  part(5.2, 0.24, 3.7, 0, -0.75, 0.1, dark, 0.06, trayMount);
  for (const sx of [-1, 1]) part(0.26, 1.1, 3.7, sx * 2.74, -0.28, 0.1, plastic(0xf2c014), 0.05, trayMount);
  part(5.2, 0.9, 0.26, 0, -0.32, -1.72, plastic(0xf2c014), 0.05, trayMount);

  // Marker for where a Preload sits, read after the robot is placed.
  const preloadAnchor = new THREE.Object3D();
  preloadAnchor.position.set(0, -0.08, 0.1);
  trayMount.add(preloadAnchor);

  // License plates in the alliance color.
  const [pc, pg] = canvasOf(256, 96);
  pg.fillStyle = `#${new THREE.Color(plateColor).getHexString()}`; pg.fillRect(0, 0, 256, 96);
  pg.fillStyle = '#fff'; pg.font = '700 62px -apple-system, Arial, sans-serif';
  pg.textAlign = 'center'; pg.textBaseline = 'middle';
  pg.fillText('999V', 128, 52);
  const plateTex = texOf(pc);
  const plateFor = (x, y, z, rotY) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.12), new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5 }));
    p.position.set(x, y, z);
    p.rotation.y = rotY;
    group.add(p);
  };
  plateFor(-4.14, 2.65, -3, -Math.PI / 2);
  plateFor(4.14, 2.65, -3, Math.PI / 2);

  // Faint outline of the starting size limit.
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(11, 15, 20)),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2 }),
  );
  outline.position.y = 7.55;
  group.add(outline);

  // Invisible click target covering the whole robot.
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(11, 15, 20), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  proxy.position.y = 7.5;
  group.add(proxy);

  return { group, proxy, preloadAnchor };
}

export const robotPlateColor = (zone) => (zone.wall === 'blue' ? COLOR.red : COLOR.blue);
