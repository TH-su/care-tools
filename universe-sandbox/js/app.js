import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SUN, PLANETS, MOONS } from './data.js';
import { Simulation, G } from './physics.js';

const EARTH_MASS = 3.0035e-6;          // solar masses
const KM_PER_AU = 1.495978707e8;
const SEC_PER_DAY = 86400;
const DEG = Math.PI / 180;
const SIZE_BOOST = 2.5;                // rendered radius = true radius * this (still << orbital distances)
const MIN_ANG = 0.0022;               // minimum apparent size: bodies never shrink below ~this * camera distance

const kmToR = (km) => (km / KM_PER_AU) * SIZE_BOOST;   // physical radius (km) -> rendered radius (AU)

// New-body presets for placement mode (realistic-scale radii in AU).
const PRESETS = {
  asteroid: { key: 'asteroid', label: '小惑星', massSun: 1e-10,     displayR: kmToR(500),    color: 0x9a9387, isStar: false },
  planet:   { key: 'planet',   label: '惑星',   massSun: EARTH_MASS, displayR: kmToR(6371),   color: 0x66c2ff, isStar: false },
  star:     { key: 'star',     label: '恒星',   massSun: 0.4,        displayR: kmToR(350000), color: 0xff9a3c, isStar: true },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  playing: true,
  timeScale: 20,        // simulated days per real second
  sizeExaggeration: 1,  // visual radius multiplier (physics unaffected)
  showTrails: true,
  showLabels: true,
  showOrbits: true,
  predictSelected: false,
  collisionMode: 'merge', // 'merge' | 'fragment'
  mode: 'view',         // 'view' | 'add'
  preset: 'planet',
  simDays: 0,
  selected: -1,
};

const TRAIL_MAX = 1200;
const trailSampleAU = 0.02;
const PRED_MAX = 500;                 // points in an orbit-prediction line
const VEL_K = 0.01;                   // drag (AU) -> velocity (AU/day)
const COLLIDE_FRAC = 0.5;             // collision radius = base displayR * this (size-slider independent)
const STAR_THRESHOLD = 0.08;          // merged mass (Msun) at/above which a body ignites into a star

let sim;                              // physics Simulation
let meta = [];                        // per-body render metadata, mirrors sim indices
let addCounter = 0;
const meshes = [];
const labels = [];
const trails = [];
const orbitGuides = [];               // static reference ellipses for the planet orbits

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060d);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.001, 8000);
camera.position.set(0, 24, 40);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.10;
controls.rotateSpeed = 0.7;
controls.zoomSpeed = 2.0;            // bigger, snappier pinch / wheel zoom
controls.zoomToCursor = true;
controls.minDistance = 1.5e-4;       // close enough to inspect a moon system
controls.maxDistance = 4000;
controls.target.set(0, 0, 0);
// Pinch (two-finger) = dolly so zooming feels like the wheel, not panning.
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

const sunLight = new THREE.PointLight(0xffffff, 2.6, 0, 0);
scene.add(sunLight);
scene.add(new THREE.AmbientLight(0x404a66, 0.35));
scene.add(makeStarfield(3000, 900));

// Orbit-prediction line (one shared line, reused for placement + selection).
let predLine;
function ensurePredLine() {
  if (predLine) return;
  const positions = new Float32Array(PRED_MAX * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setDrawRange(0, 0);
  predLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x9fd2ff, transparent: true, opacity: 0.8 }));
  predLine.frustumCulled = false;
  predLine.visible = false;
  scene.add(predLine);
}

// Velocity-aim arrow shown while dragging a new body.
let velArrow;
function ensureVelArrow() {
  if (velArrow) return;
  velArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xffe066, 0.5, 0.28);
  velArrow.visible = false;
  scene.add(velArrow);
}

// ---------------------------------------------------------------------------
// Build / rebuild scene
// ---------------------------------------------------------------------------
// Convert classical orbital elements to a state vector (position + velocity)
// in Three.js coords: the ecliptic is the x-z plane, +y is the ecliptic north.
function stateVector(GM, a, e, incDeg, OmegaDeg, omegaDeg, nuDeg) {
  const i = incDeg * DEG, O = OmegaDeg * DEG, w = omegaDeg * DEG, nu = nuDeg * DEG;
  const p = a * (1 - e * e);
  const r = p / (1 + e * Math.cos(nu));
  const xp = r * Math.cos(nu), yp = r * Math.sin(nu);             // perifocal position
  const vf = Math.sqrt(GM / p);
  const vxp = -vf * Math.sin(nu), vyp = vf * (e + Math.cos(nu));  // perifocal velocity
  const cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i), cw = Math.cos(w), sw = Math.sin(w);
  const R11 = cO * cw - sO * sw * ci, R12 = -cO * sw - sO * cw * ci;
  const R21 = sO * cw + cO * sw * ci, R22 = -sO * sw + cO * cw * ci;
  const R31 = sw * si,                R32 = cw * si;
  const X = R11 * xp + R12 * yp, Y = R21 * xp + R22 * yp, Z = R31 * xp + R32 * yp;       // ecliptic I,J,K
  const VX = R11 * vxp + R12 * vyp, VY = R21 * vxp + R22 * vyp, VZ = R31 * vxp + R32 * vyp;
  // map ecliptic (I,J in-plane, K up) -> three.js (x,z in-plane, y up)
  return { pos: [X, Z, Y], vel: [VX, VZ, VY] };
}

function seedBodies() {
  const bodies = [{ massSun: SUN.mass_Msun, pos: [0, 0, 0], vel: [0, 0, 0] }];
  const pstate = {};                                    // english name -> heliocentric state
  PLANETS.forEach((b, p) => {
    const s = stateVector(G * SUN.mass_Msun, b.a_AU, b.e, b.inc_deg, p * 73, p * 129, p * 137.5);
    pstate[b.en] = s;
    bodies.push({ massSun: b.mass_Msun, pos: s.pos.slice(), vel: s.vel.slice() });
  });
  MOONS.forEach((m, k) => {
    const parent = pstate[m.parent];
    const pm = PLANETS.find((pl) => pl.en === m.parent);
    const rel = stateVector(G * (pm.mass_Msun + m.mass_Msun), m.a_AU, m.e, m.inc_deg, k * 97, k * 57, k * 137.5 + 40);
    bodies.push({
      massSun: m.mass_Msun,
      pos: [parent.pos[0] + rel.pos[0], parent.pos[1] + rel.pos[1], parent.pos[2] + rel.pos[2]],
      vel: [parent.vel[0] + rel.vel[0], parent.vel[1] + rel.vel[1], parent.vel[2] + rel.vel[2]],
    });
  });
  // Give the Sun the velocity that zeroes total momentum (barycentre stays put).
  let px = 0, py = 0, pz = 0;
  for (let i = 1; i < bodies.length; i++) {
    const m = bodies[i].massSun;
    px += m * bodies[i].vel[0]; py += m * bodies[i].vel[1]; pz += m * bodies[i].vel[2];
  }
  bodies[0].vel = [-px / SUN.mass_Msun, -py / SUN.mass_Msun, -pz / SUN.mass_Msun];
  return bodies;
}

// Static reference ellipse for each planet orbit, sampled from its elements
// (same Omega/omega/inc as the seed) so the real eccentric, inclined orbits are
// visible immediately — the Sun sits at a focus, not the centre.
function makeOrbitGuides() {
  orbitGuides.forEach((l) => { scene.remove(l); l.geometry.dispose(); });
  orbitGuides.length = 0;
  const N = 200;
  PLANETS.forEach((b, p) => {
    const pos = new Float32Array((N + 1) * 3);
    for (let s = 0; s <= N; s++) {
      const st = stateVector(G * SUN.mass_Msun, b.a_AU, b.e, b.inc_deg, p * 73, p * 129, (s / N) * 360);
      pos[3 * s] = st.pos[0]; pos[3 * s + 1] = st.pos[1]; pos[3 * s + 2] = st.pos[2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const col = new THREE.Color(b.color).lerp(new THREE.Color(0xffffff), 0.15);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.28 }));
    line.frustumCulled = false;
    line.visible = state.showOrbits;
    scene.add(line);
    orbitGuides.push(line);
  });
}

function buildScene() {
  meshes.forEach((m) => scene.remove(m));
  trails.forEach((t) => scene.remove(t.line));
  labels.forEach((l) => l.el.remove());
  meshes.length = 0; trails.length = 0; labels.length = 0;
  document.getElementById('bodyList').innerHTML = '';
  addCounter = 0;

  // Build metadata in sim order: Sun, planets, moons.
  meta = [{ name: SUN.name, en: 'Sun', color: SUN.color, isStar: true, ring: false, mass_Msun: SUN.mass_Msun, radius_km: SUN.radius_km, displayR: kmToR(SUN.radius_km), parentIndex: -1, moonMaxA: 0 }];
  PLANETS.forEach((b) => meta.push({ name: b.name, en: b.en, color: b.color, isStar: false, ring: !!b.ring, mass_Msun: b.mass_Msun, radius_km: b.radius_km, displayR: kmToR(b.radius_km), parentIndex: -1, moonMaxA: 0 }));
  MOONS.forEach((m) => meta.push({ name: m.name, en: m.en, color: m.color, isStar: false, ring: false, mass_Msun: m.mass_Msun, radius_km: m.radius_km, displayR: kmToR(m.radius_km), parentIndex: -1, moonMaxA: 0, parentEn: m.parent, a_AU: m.a_AU }));
  meta.forEach((b) => {
    if (!b.parentEn) return;
    const pi = meta.findIndex((x) => x.en === b.parentEn);
    b.parentIndex = pi;
    if (pi >= 0) meta[pi].moonMaxA = Math.max(meta[pi].moonMaxA, b.a_AU);
  });

  sim = new Simulation(seedBodies(), 1e-5);              // small softening: moons orbit at ~0.0026 AU
  state.simDays = 0;

  meta.forEach((b, i) => createBodyVisual(b, i));
  applySizes();
  makeOrbitGuides();
  ensurePredLine();
  ensureVelArrow();
}

// Create the mesh, trail, label and list entry for body `i` (meta[i]).
function createBodyVisual(b, i) {
  const geo = new THREE.SphereGeometry(1, b.isStar ? 32 : 24, b.isStar ? 32 : 24);
  const mat = b.isStar
    ? new THREE.MeshBasicMaterial({ color: b.color })
    : new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.85, metalness: 0.0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.index = i;
  scene.add(mesh);
  meshes[i] = mesh;

  if (b.isStar) {
    mesh.add(makeGlowSprite(b.color));
    if (i !== 0) {                          // added stars light their surroundings
      const pl = new THREE.PointLight(0xffffff, 1.6, 0, 0);
      mesh.add(pl);
    }
  }
  if (b.ring) mesh.add(makeRing());

  const positions = new Float32Array(TRAIL_MAX * 3);
  const tgeo = new THREE.BufferGeometry();
  tgeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  tgeo.setDrawRange(0, 0);
  const tcol = new THREE.Color(b.color).lerp(new THREE.Color(0xffffff), 0.25);
  const line = new THREE.Line(tgeo, new THREE.LineBasicMaterial({ color: tcol, transparent: true, opacity: 0.55 }));
  line.frustumCulled = false;
  line.visible = state.showTrails;
  scene.add(line);
  trails[i] = { line, positions, count: 0, last: new THREE.Vector3(Infinity, Infinity, Infinity) };

  const el = document.createElement('div');
  el.className = 'label';
  el.textContent = b.name;
  document.getElementById('labels').appendChild(el);
  labels[i] = { el, index: i };

  const li = document.createElement('li');
  li.innerHTML = `<span class="dot" style="background:#${b.color.toString(16).padStart(6, '0')}"></span>${b.name}`;
  li.addEventListener('click', () => { selectBody(i); focusBody(i); });
  document.getElementById('bodyList').appendChild(li);
}

// ---------------------------------------------------------------------------
// Visual helpers
// ---------------------------------------------------------------------------
function makeStarfield(count, radius) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    pos[3 * i] = radius * r * Math.cos(t);
    pos[3 * i + 1] = radius * u;
    pos[3 * i + 2] = radius * r * Math.sin(t);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: false }));
  pts.frustumCulled = false;
  return pts;
}

let glowTexture;
function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,230,160,0.7)');
  g.addColorStop(1, 'rgba(255,200,80,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

function makeGlowSprite(color) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getGlowTexture(), color, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.setScalar(2.0);
  s.userData.glow = true;
  return s;
}

function makeRing() {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.4, 2.2, 48),
    new THREE.MeshBasicMaterial({ color: 0xcdb98a, side: THREE.DoubleSide, transparent: true, opacity: 0.6 }),
  );
  ring.rotation.x = -Math.PI / 2 + 0.45;
  return ring;
}

// Body size is applied per-frame in syncMeshes (with a min apparent size); here
// we only keep the star glow a fixed proportion of its body.
function applySizes() {
  meshes.forEach((m) => {
    m.children.forEach((ch) => { if (ch.userData.glow) ch.scale.setScalar(3.0); });
  });
}

// ---------------------------------------------------------------------------
// Per-frame update
// ---------------------------------------------------------------------------
function syncMeshes() {
  const p = sim.pos;
  const exag = state.sizeExaggeration;
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    m.position.set(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
    // To-scale radius, but never smaller than a few pixels: keeps tiny bodies
    // visible when zoomed out, yet shows true proportions (and moons) up close.
    const camDist = camera.position.distanceTo(m.position);
    m.scale.setScalar(Math.max(meta[i].displayR * exag, camDist * MIN_ANG));
  }
  sunLight.position.copy(meshes[0].position);
}

function updateTrails() {
  if (!state.showTrails) return;
  for (let i = 0; i < trails.length; i++) {
    const t = trails[i];
    const m = meshes[i];
    if (t.last.distanceTo(m.position) < trailSampleAU) continue;
    if (t.count >= TRAIL_MAX) { t.positions.copyWithin(0, 3, TRAIL_MAX * 3); t.count = TRAIL_MAX - 1; }
    const o = t.count * 3;
    t.positions[o] = m.position.x; t.positions[o + 1] = m.position.y; t.positions[o + 2] = m.position.z;
    t.count++;
    t.last.copy(m.position);
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.geometry.setDrawRange(0, t.count);
  }
}

function clearTrails() {
  trails.forEach((t) => { t.count = 0; t.last.set(Infinity, Infinity, Infinity); t.line.geometry.setDrawRange(0, 0); });
}

const _v = new THREE.Vector3();
const _placed = [];
function updateLabels() {
  const layer = document.getElementById('labels');
  if (!state.showLabels) { layer.style.display = 'none'; return; }
  layer.style.display = '';
  const w = window.innerWidth, h = window.innerHeight;
  _placed.length = 0;
  for (const { el, index } of labels) {
    _v.copy(meshes[index].position).project(camera);
    const x = (_v.x * 0.5 + 0.5) * w;
    const y = (-_v.y * 0.5 + 0.5) * h;
    const onScreen = _v.z < 1 && x > -40 && x < w + 40 && y > -20 && y < h + 20;
    let collide = false;
    if (index !== state.selected) {
      for (const p of _placed) { if (Math.abs(x - p.x) < 30 && Math.abs(y - p.y) < 14) { collide = true; break; } }
    }
    if (!onScreen || collide) { el.style.display = 'none'; continue; }
    el.style.display = '';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.classList.toggle('sel', index === state.selected);
    _placed.push({ x, y });
  }
}

// ---------------------------------------------------------------------------
// Orbit prediction: clone the system and integrate a throwaway future.
// ---------------------------------------------------------------------------
function computePrediction(index) {
  ensurePredLine();
  const c = sim.clone();
  const ix = 3 * index;
  // Estimate the orbital period about the DOMINANT attractor (the Sun for a
  // planet, the parent planet for a moon) so the horizon fits the real orbit.
  let domJ = -1, domAcc = 0, domR = 1;
  for (let j = 0; j < c.n; j++) {
    if (j === index) continue;
    const dx = c.pos[3 * j] - c.pos[ix], dy = c.pos[3 * j + 1] - c.pos[ix + 1], dz = c.pos[3 * j + 2] - c.pos[ix + 2];
    const r2 = dx * dx + dy * dy + dz * dz;
    const acc = G * c.mass[j] / Math.max(r2, 1e-12);
    if (acc > domAcc) { domAcc = acc; domJ = j; domR = Math.sqrt(r2); }
  }
  const M = domJ >= 0 ? Math.max(c.mass[domJ], 1e-9) : 1;
  const T = 2 * Math.PI * Math.sqrt((domR * domR * domR) / (G * M));
  const horizon = Math.min(Math.max(T * 1.35, 1), 6e5);
  const steps = PRED_MAX - 1;
  const h = horizon / steps;
  const arr = predLine.geometry.attributes.position.array;
  arr[0] = c.pos[ix]; arr[1] = c.pos[ix + 1]; arr[2] = c.pos[ix + 2];
  for (let s = 1; s < PRED_MAX; s++) {
    c.advance(h, Math.min(0.05, h), 200);
    arr[3 * s] = c.pos[ix]; arr[3 * s + 1] = c.pos[ix + 1]; arr[3 * s + 2] = c.pos[ix + 2];
  }
  predLine.geometry.attributes.position.needsUpdate = true;
  predLine.geometry.setDrawRange(0, PRED_MAX);
  predLine.visible = true;
}

function hidePrediction() { if (predLine) predLine.visible = false; }

// ---------------------------------------------------------------------------
// Collisions: detection + merge / fragment + impact burst
// ---------------------------------------------------------------------------
const _tmp = new THREE.Vector3();

// Collide at the rendered size, so cranking the size slider also makes bodies
// easier to smash together. At realistic sizes planets never spuriously merge.
function collisionRadius(i) { return meta[i].displayR * state.sizeExaggeration * COLLIDE_FRAC; }

// Rebuild only the body-list <li> entries (closures capture indices, so this
// must run after any removal that shifts indices).
function rebuildBodyList() {
  const ul = document.getElementById('bodyList');
  ul.innerHTML = '';
  meta.forEach((b, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="background:#${b.color.toString(16).padStart(6, '0')}"></span>${b.name}`;
    li.addEventListener('click', () => { selectBody(i); focusBody(i); });
    ul.appendChild(li);
  });
}

// Remove body idx from sim + scene, then reindex render arrays + selection.
function removeBodyAt(idx) {
  sim.removeBody(idx);
  scene.remove(meshes[idx]);
  meshes[idx].geometry.dispose();
  scene.remove(trails[idx].line);
  trails[idx].line.geometry.dispose();
  labels[idx].el.remove();
  meshes.splice(idx, 1); trails.splice(idx, 1); labels.splice(idx, 1); meta.splice(idx, 1);
  for (let k = 0; k < meshes.length; k++) { meshes[k].userData.index = k; labels[k].index = k; }
  rebuildBodyList();
  if (state.selected === idx) state.selected = -1;
  else if (state.selected > idx) state.selected--;
}

// Promote a body into a self-luminous star (used when a merge crosses the mass
// threshold for fusion).
function igniteStar(i) {
  meta[i].isStar = true;
  meta[i].color = 0xffcc66;
  const m = meshes[i];
  m.material.color.setHex(0xffcc66);
  if (m.material.emissive) { m.material.emissive.setHex(0xffcc66); m.material.emissiveIntensity = 1; }
  m.add(makeGlowSprite(0xffcc66));
  m.add(new THREE.PointLight(0xffffff, 1.6, 0, 0));
}

// Merge body b into body a (the more massive survives), conserving mass,
// momentum and volume. Returns the survivor's (possibly shifted) index.
function mergeBodies(a, b) {
  if (sim.mass[b] > sim.mass[a]) { const t = a; a = b; b = t; }
  const ma = sim.mass[a], mb = sim.mass[b], M = ma + mb;
  const ax = 3 * a, bx = 3 * b;
  _tmp.set(                                  // impact point (center of mass)
    (ma * sim.pos[ax] + mb * sim.pos[bx]) / M,
    (ma * sim.pos[ax + 1] + mb * sim.pos[bx + 1]) / M,
    (ma * sim.pos[ax + 2] + mb * sim.pos[bx + 2]) / M,
  );
  const relSpeed = Math.hypot(
    sim.vel[bx] - sim.vel[ax], sim.vel[bx + 1] - sim.vel[ax + 1], sim.vel[bx + 2] - sim.vel[ax + 2]);
  for (let k = 0; k < 3; k++) {
    sim.pos[ax + k] = (ma * sim.pos[ax + k] + mb * sim.pos[bx + k]) / M;
    sim.vel[ax + k] = (ma * sim.vel[ax + k] + mb * sim.vel[bx + k]) / M;  // momentum conserving
  }
  sim.mass[a] = M;
  const ra = meta[a].displayR, rb = meta[b].displayR;
  meta[a].displayR = Math.cbrt(ra * ra * ra + rb * rb * rb);              // volume conserving
  meta[a].physR = Math.cbrt(meta[a].physR ** 3 + meta[b].physR ** 3);
  spawnBurst(_tmp, relSpeed, meta[b].color);
  if (M >= STAR_THRESHOLD && !meta[a].isStar) igniteStar(a);
  applySizes();
  removeBodyAt(b);
  return a > b ? a - 1 : a;
}

// Fragment mode: replace both bodies with a compact core + debris shards,
// conserving total mass and momentum.
function fragmentBodies(a, b) {
  const ma = sim.mass[a], mb = sim.mass[b], M = ma + mb;
  const ax = 3 * a, bx = 3 * b;
  const cp = new THREE.Vector3(
    (ma * sim.pos[ax] + mb * sim.pos[bx]) / M,
    (ma * sim.pos[ax + 1] + mb * sim.pos[bx + 1]) / M,
    (ma * sim.pos[ax + 2] + mb * sim.pos[bx + 2]) / M);
  const cv = new THREE.Vector3(
    (ma * sim.vel[ax] + mb * sim.vel[bx]) / M,
    (ma * sim.vel[ax + 1] + mb * sim.vel[bx + 1]) / M,
    (ma * sim.vel[ax + 2] + mb * sim.vel[bx + 2]) / M);
  const relSpeed = Math.hypot(
    sim.vel[bx] - sim.vel[ax], sim.vel[bx + 1] - sim.vel[ax + 1], sim.vel[bx + 2] - sim.vel[ax + 2]);
  const color = sim.mass[a] >= sim.mass[b] ? meta[a].color : meta[b].color;
  const baseR = Math.cbrt(meta[a].displayR ** 3 + meta[b].displayR ** 3);

  // Low-energy or near-cap impacts just merge.
  if (relSpeed < 0.004 || sim.n > 60) { mergeBodies(a, b); return; }

  spawnBurst(cp, relSpeed * 1.6, color);
  removeBodyAt(Math.max(a, b));               // remove higher index first to keep the other valid
  removeBodyAt(Math.min(a, b));

  const N = 4;                                 // 1 core + 3 shards worth of fragments
  const spread = Math.min(0.006, relSpeed * 0.6);
  const debris = [];
  let px = 0, py = 0, pz = 0;
  for (let s = 0; s < N - 1; s++) {
    const ang = (s / (N - 1)) * Math.PI * 2;
    const vx = Math.cos(ang) * spread, vz = Math.sin(ang) * spread;
    debris.push({ mass: 0.06 * M, vx: cv.x + vx, vz: cv.z + vz });
    px += 0.06 * M * (cv.x + vx); py += 0.06 * M * cv.y; pz += 0.06 * M * (cv.z + vz);
  }
  const coreMass = M - debris.reduce((s, d) => s + d.mass, 0);
  // core velocity restores total momentum
  const coreV = new THREE.Vector3((M * cv.x - px) / coreMass, (M * cv.y - py) / coreMass, (M * cv.z - pz) / coreMass);

  spawnDynamicBody(cp.x, cp.y, cp.z, coreV.x, coreV.y, coreV.z, {
    label: '残骸核', massSun: coreMass, displayR: baseR * 0.85, color,
  });
  let ang0 = 0;
  for (const d of debris) {
    ang0 += (Math.PI * 2) / debris.length;
    const ox = Math.cos(ang0) * baseR * 1.2, oz = Math.sin(ang0) * baseR * 1.2;
    spawnDynamicBody(cp.x + ox, cp.y, cp.z + oz, d.vx, 0, d.vz, {
      label: '破片', massSun: d.mass, displayR: baseR * 0.45, color,
    });
  }
}

// Create a body at a world position/velocity with explicit metadata.
function spawnDynamicBody(x, y, z, vx, vy, vz, opts) {
  const i = sim.addBody({ massSun: opts.massSun, pos: [x, y, z], vel: [vx, vy, vz] });
  meta[i] = { name: `${opts.label}${++addCounter}`, massSun: opts.massSun, displayR: opts.displayR, physR: 1e-5, color: opts.color, isStar: !!opts.isStar, ring: false };
  createBodyVisual(meta[i], i);
  applySizes();
  syncMeshes();
  return i;
}

function handleCollision(i, j) {
  if (state.collisionMode === 'fragment') fragmentBodies(i, j);
  else mergeBodies(i, j);
}

// Resolve all overlapping pairs this frame (re-scan after each event since
// indices change). Capped to avoid pathological loops.
function resolveCollisions() {
  for (let iter = 0; iter < 60; iter++) {
    let fa = -1, fb = -1;
    const n = sim.n;
    for (let i = 0; i < n && fa < 0; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = sim.pos[3 * j] - sim.pos[3 * i];
        const dy = sim.pos[3 * j + 1] - sim.pos[3 * i + 1];
        const dz = sim.pos[3 * j + 2] - sim.pos[3 * i + 2];
        if (Math.hypot(dx, dy, dz) < collisionRadius(i) + collisionRadius(j)) { fa = i; fb = j; break; }
      }
    }
    if (fa < 0) break;
    handleCollision(fa, fb);
  }
}

// --- Impact particle bursts (real-time, independent of sim time scale) ------
const bursts = [];
function spawnBurst(pos, impact, colorHex) {
  const count = 36;
  const positions = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  // Modest spread so the flash stays near the impact point (AU per life-second).
  const speed = 0.25 + Math.min(0.8, impact * 25);
  for (let i = 0; i < count; i++) {
    positions[3 * i] = pos.x; positions[3 * i + 1] = pos.y; positions[3 * i + 2] = pos.z;
    const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    const s = speed * (0.3 + Math.random() * 0.7);
    vel[3 * i] = s * r * Math.cos(t); vel[3 * i + 1] = s * u; vel[3 * i + 2] = s * r * Math.sin(t);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const col = new THREE.Color(colorHex).lerp(new THREE.Color(0xffe7b0), 0.7);
  // Soft circular sprite texture (reuses the radial glow) so particles render
  // as fading sparks, not opaque squares.
  const mat = new THREE.PointsMaterial({
    color: col, size: 0.12, map: getGlowTexture(), transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  bursts.push({ pts, vel, life: 1.0 });
}

function updateBursts(dt) {
  for (let b = bursts.length - 1; b >= 0; b--) {
    const burst = bursts[b];
    burst.life -= dt * 1.8;                  // quick flash
    if (burst.life <= 0) {
      scene.remove(burst.pts); burst.pts.geometry.dispose(); burst.pts.material.dispose();
      bursts.splice(b, 1);
      continue;
    }
    const arr = burst.pts.geometry.attributes.position.array;
    for (let i = 0; i < arr.length; i++) arr[i] += burst.vel[i] * dt;
    burst.pts.geometry.attributes.position.needsUpdate = true;
    burst.pts.material.opacity = burst.life;
    burst.pts.material.size = 0.12 * (0.6 + burst.life);
  }
}

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
// Adapt near/far to the zoom distance so we keep depth precision from
// moon-scale close-ups (sub-0.001 AU) out to the whole system.
function updateCameraClip() {
  const dist = camera.position.distanceTo(controls.target);
  const near = Math.max(1e-5, dist * 0.02);
  const far = Math.max(2000, dist * 200);
  if (near !== camera.near || far !== camera.far) {
    camera.near = near; camera.far = far; camera.updateProjectionMatrix();
  }
}

const clock = new THREE.Clock();
let frame = 0;
function animate() {
  requestAnimationFrame(animate);
  let dt = clock.getDelta();
  if (dt > 0.05) dt = 0.05;

  if (state.playing && !placing) {
    const simDays = state.timeScale * dt;
    // h = 0.05 day keeps even the fastest moon (Io, ~1.77 d) well-resolved.
    sim.advance(simDays, 0.05, 4000);
    state.simDays += simDays;
    resolveCollisions();
  }

  updateBursts(dt);
  syncMeshes();
  updateTrails();
  controls.update();
  updateCameraClip();
  updateLabels();

  // Keep the selected body's prediction fresh while the system evolves.
  frame++;
  if (state.predictSelected && state.selected >= 0 && !placing && frame % 20 === 0) {
    computePrediction(state.selected);
  }

  if (frame % 6 === 0) updateHud();
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// HUD / info panel
// ---------------------------------------------------------------------------
function updateHud() {
  const years = state.simDays / 365.25;
  document.getElementById('clock').textContent =
    `経過 ${years.toFixed(2)} 年 ( ${Math.round(state.simDays).toLocaleString()} 日 )`;
  if (state.selected >= 0) refreshSelectedInfo();
}

function refreshSelectedInfo() {
  const i = state.selected;
  const box = document.getElementById('bodyInfo');
  if (i < 0) { box.innerHTML = '<p class="muted">天体をタップで選択</p>'; return; }
  const b = meta[i];
  const p = sim.pos, varr = sim.vel;
  const sunDist = Math.hypot(p[3 * i] - p[0], p[3 * i + 1] - p[1], p[3 * i + 2] - p[2]);
  const pa = b.parentIndex;
  let spd, spdLabel, parentRow = '';
  if (pa >= 0) {
    spd = Math.hypot(varr[3 * i] - varr[3 * pa], varr[3 * i + 1] - varr[3 * pa + 1], varr[3 * i + 2] - varr[3 * pa + 2]);
    spdLabel = `公転速度（対${meta[pa].name}）`;
    const pd = Math.hypot(p[3 * i] - p[3 * pa], p[3 * i + 1] - p[3 * pa + 1], p[3 * i + 2] - p[3 * pa + 2]) * KM_PER_AU;
    parentRow = `<div class="info-row"><span>${meta[pa].name}からの距離</span><b>${Math.round(pd).toLocaleString()} km</b></div>`;
  } else {
    spd = Math.hypot(varr[3 * i], varr[3 * i + 1], varr[3 * i + 2]);
    spdLabel = '速度';
  }
  const kms = spd * KM_PER_AU / SEC_PER_DAY;
  box.innerHTML = `
    <div class="info-name" style="color:#${b.color.toString(16).padStart(6, '0')}">${b.name}</div>
    <div class="info-row"><span>太陽からの距離</span><b>${sunDist.toFixed(3)} AU</b></div>
    ${parentRow}
    <div class="info-row"><span>${spdLabel}</span><b>${kms.toFixed(1)} km/s</b></div>
    <label class="info-edit">質量 (地球比)
      <input id="massEdit" type="number" step="0.1" min="0" value="${(sim.mass[i] / EARTH_MASS).toFixed(3)}">
    </label>
    <button id="focusBtn" class="btn small">この天体を中心に表示</button>
  `;
  box.querySelector('#massEdit').addEventListener('change', (e) => {
    const em = parseFloat(e.target.value);
    if (!isNaN(em) && em >= 0) sim.mass[i] = em * EARTH_MASS;
  });
  box.querySelector('#focusBtn').addEventListener('click', () => focusBody(i));
}

function selectBody(i) {
  state.selected = i;
  refreshSelectedInfo();
  if (state.predictSelected && i >= 0) computePrediction(i);
}

function focusBody(i) {
  const m = meshes[i], b = meta[i];
  let offset;
  if (b.moonMaxA > 0) offset = b.moonMaxA * 2.6;            // frame the whole moon system
  else if (b.isStar && i === 0) offset = 2.6;               // the Sun: see inner planets
  else if (b.parentIndex >= 0) offset = Math.max(b.displayR * 60, 4e-4); // a moon: close-up
  else offset = Math.max(b.displayR * 60, 0.01);            // moonless planet
  controls.target.copy(m.position);
  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-12) dir.set(0, 0.4, 1);
  dir.normalize();
  camera.position.copy(m.position).add(dir.multiplyScalar(offset));
}

// ---------------------------------------------------------------------------
// Pointer handling: tap-to-select (view) / place + aim (add)
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hit = new THREE.Vector3();
let downXY = null;
let placing = false;
let placeIndex = -1;
let wasPlaying = true;
const anchor = new THREE.Vector3();

function planePoint(cx, cy) {
  pointer.x = (cx / window.innerWidth) * 2 - 1;
  pointer.y = -(cy / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  if (raycaster.ray.intersectPlane(groundPlane, _hit)) return _hit.clone();
  // Tap above the horizon: fall back to a point on the ray at the
  // camera->target distance so placement still works.
  const d = camera.position.distanceTo(controls.target);
  return raycaster.ray.at(d, _hit).clone();
}

function addBodyAt(p) {
  const pr = PRESETS[state.preset];
  const i = sim.addBody({ massSun: pr.massSun, pos: [p.x, p.y, p.z], vel: [0, 0, 0] });
  meta[i] = { name: `${pr.label}${++addCounter}`, massSun: pr.massSun, displayR: pr.displayR, physR: 1e-5, color: pr.color, isStar: pr.isStar, ring: false };
  createBodyVisual(meta[i], i);
  applySizes();
  syncMeshes();
  return i;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (state.mode === 'add') {
    const p = planePoint(e.clientX, e.clientY);
    if (!p) return;
    wasPlaying = state.playing;
    placing = true;
    placeIndex = addBodyAt(p);
    selectBody(placeIndex);
    anchor.copy(p);
    ensureVelArrow();
    velArrow.visible = true;
    computePrediction(placeIndex);
    return;
  }
  downXY = [e.clientX, e.clientY];
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!placing) return;
  const p = planePoint(e.clientX, e.clientY);
  if (!p) return;
  const dv = p.clone().sub(anchor);          // drag vector in AU (plane)
  const vx = dv.x * VEL_K, vz = dv.z * VEL_K;
  const i = placeIndex;
  sim.vel[3 * i] = vx; sim.vel[3 * i + 1] = 0; sim.vel[3 * i + 2] = vz;
  const len = Math.hypot(dv.x, dv.z);
  velArrow.position.copy(meshes[i].position);
  if (len > 1e-6) {
    velArrow.setDirection(new THREE.Vector3(vx, 0, vz).normalize());
    velArrow.setLength(len, Math.min(0.6, len * 0.22), Math.min(0.35, len * 0.13));
  }
  computePrediction(i);
  refreshSelectedInfo();
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (placing) {
    placing = false;
    if (velArrow) velArrow.visible = false;
    state.playing = wasPlaying;
    clock.getDelta();                         // avoid a time jump on resume
    if (!state.predictSelected) hidePrediction();
    return;
  }
  if (!downXY) return;
  const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
  downXY = null;
  if (moved > 8) return;
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length) selectBody(hits[0].object.userData.index);
});

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
function setMode(mode) {
  state.mode = mode;
  const isAdd = mode === 'add';
  controls.enabled = !isAdd;
  document.getElementById('addBtn').classList.toggle('active', isAdd);
  document.getElementById('addBanner').style.display = isAdd ? 'flex' : 'none';
  if (!isAdd && placing) {                    // clean up an interrupted placement
    placing = false;
    if (velArrow) velArrow.visible = false;
    state.playing = wasPlaying;
  }
  if (!isAdd && !state.predictSelected) hidePrediction();
}

function wireUI() {
  const playBtn = document.getElementById('playBtn');
  playBtn.addEventListener('click', () => {
    state.playing = !state.playing;
    playBtn.textContent = state.playing ? '⏸' : '▶';
    playBtn.classList.toggle('paused', !state.playing);
    if (state.playing) clock.getDelta();
  });

  const speed = document.getElementById('speed');
  const speedLabel = document.getElementById('speedLabel');
  const setSpeed = () => {
    const t = speed.value / 100;
    state.timeScale = +(0.5 * Math.pow(800, t)).toFixed(1);
    speedLabel.textContent = `${state.timeScale} 日/秒`;
  };
  speed.addEventListener('input', setSpeed); setSpeed();

  const size = document.getElementById('size');
  const sizeLabel = document.getElementById('sizeLabel');
  const setSize = () => {
    state.sizeExaggeration = +(size.value / 100 * 3).toFixed(2) || 0.05;
    sizeLabel.textContent = `×${state.sizeExaggeration}`;
    applySizes();
  };
  size.addEventListener('input', setSize); setSize();

  document.getElementById('trailsChk').addEventListener('change', (e) => {
    state.showTrails = e.target.checked;
    trails.forEach((t) => (t.line.visible = state.showTrails));
    if (!state.showTrails) clearTrails();
  });
  document.getElementById('labelsChk').addEventListener('change', (e) => { state.showLabels = e.target.checked; });
  document.getElementById('orbitsChk').addEventListener('change', (e) => {
    state.showOrbits = e.target.checked;
    orbitGuides.forEach((l) => (l.visible = state.showOrbits));
  });
  document.getElementById('predChk').addEventListener('change', (e) => {
    state.predictSelected = e.target.checked;
    if (state.predictSelected && state.selected >= 0) computePrediction(state.selected);
    else if (!placing) hidePrediction();
  });

  document.querySelectorAll('#collideBtns button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.collisionMode = btn.dataset.mode;
      document.querySelectorAll('#collideBtns button').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  // Placement mode
  document.getElementById('addBtn').addEventListener('click', () => setMode(state.mode === 'add' ? 'view' : 'add'));
  document.getElementById('addDone').addEventListener('click', () => setMode('view'));
  document.querySelectorAll('#presetBtns button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.preset = btn.dataset.preset;
      document.querySelectorAll('#presetBtns button').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    setMode('view');
    buildScene();
    state.selected = -1;
    refreshSelectedInfo();
    hidePrediction();
    clock.getDelta();
  });

  document.getElementById('panelToggle').addEventListener('click', () => {
    document.getElementById('panel').classList.toggle('collapsed');
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

buildScene();
wireUI();
refreshSelectedInfo();
animate();
