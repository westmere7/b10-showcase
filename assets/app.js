// B10 Showcase: RMIT Vietnam Experience Day 2026
// Static three.js viewer. Models + manifest are produced by _tools/export_web.py.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const EYE = 1.7;                                   // walk-mode eye height (m)
const WALK_SPEED = 1.6, RUN_SPEED = 4.0;
const SOLID_GREY = new THREE.Color('#b9bcc6');
const USER_LAYERS = new Set(['sset', 'scd', 'tbs', 'guides']);   // the only layers visitors can toggle
const ROOF = 'roof';                               // shown in walk mode only
const icon = (id) => `<svg><use href="#i-${id}"/></svg>`;

// ------------------------------------------------------------------ renderer / scene
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;   // rolls off the many pure-white SketchUp surfaces
renderer.toneMappingExposure = 0.82;
stage.appendChild(renderer.domElement);
const canvas = renderer.domElement;
canvas.tabIndex = 0;

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'labels';
stage.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9aa1b0');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const ENV = { material: 0.32, solid: 0.22 };
scene.environmentIntensity = ENV.material;
scene.add(new THREE.HemisphereLight(0xf2f4ff, 0x4a4f63, 0.35));
const sun = new THREE.DirectionalLight(0xfff6ea, 1.6);   // key light: gives vertical faces distinct shades
sun.position.set(-22, 38, 28);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xdfe6ff, 0.35);
fill.position.set(25, 18, -30);
scene.add(fill);

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 800);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.maxPolarAngle = Math.PI * 0.495;
// left = rotate, middle or right = drag the view (pan); the wheel is handled separately (fly along view)
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
canvas.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });   // no autoscroll cursor
controls.minDistance = 1.5;
controls.maxDistance = 160;

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

// ------------------------------------------------------------------ state
const state = {
  shading: 'material',
  tint: { on: false, strength: 0.6, colours: {} },
  walking: false,
  tour: null,
  fly: null,
};
const layers = {};          // id -> { entry, group, meshes[] }
const userVisible = {};     // id -> visitor's choice for toggleable layers
const zones = {};           // id -> zone from manifest + derived boxes
let man, floorY = 0, hallBox, walkBox, camBox;

// ------------------------------------------------------------------ loading
const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
const loader = new GLTFLoader().setDRACOLoader(draco);

async function boot() {
  try {
    man = await (await fetch('models/manifest.json', { cache: 'no-cache' })).json();
  } catch (e) {
    return fail('Could not load models/manifest.json. Run _tools/publish.bat first.');
  }
  floorY = man.floorY ?? 0;
  $('#updated').textContent = `Plan updated ${man.generated}`;
  const toV = (a) => V3(a[0], a[1], a[2]);
  hallBox = new THREE.Box3(toV(man.hall.min), toV(man.hall.max));
  for (const z of man.zones) {
    const box = new THREE.Box3(toV(z.min), toV(z.max));
    zones[z.id] = { ...z, box, centre: box.getCenter(V3()).setY(toV(z.centre).y) };   // true middle of the zone
    state.tint.colours[z.id] = z.colour;
  }
  // walkable floor = union of the zone footprints, slightly padded (covers the hall floor)
  walkBox = new THREE.Box3();
  Object.values(zones).forEach((z) => walkBox.union(z.box));
  walkBox.expandByVector(V3(0.6, 0, 0.6));
  setCameraLimits();

  for (const l of man.layers) userVisible[l.id] = l.visible !== false;

  const total = man.layers.reduce((s, l) => s + l.bytes, 0);
  const done = {};
  const progress = () => {
    const got = Object.values(done).reduce((a, b) => a + b, 0);
    $('#load-progress').style.width = `${Math.min(100, (got / total) * 100).toFixed(1)}%`;
  };

  buildUI();
  goTo(poses.overview(), 0);

  await Promise.all(man.layers.map((entry) => new Promise((resolve) => {
    loader.load(`${entry.file}?v=${man.version}`, (gltf) => {
      done[entry.id] = entry.bytes; progress();
      addLayer(entry, gltf.scene);
      $('#load-detail').textContent = `Loaded ${entry.label}`;
      resolve();
    }, (e) => { if (e.total) { done[entry.id] = (e.loaded / e.total) * entry.bytes; progress(); } },
    (err) => { console.error(entry.file, err); $('#load-detail').textContent = `Could not load ${entry.label}`; resolve(); });
  })));

  refreshMaterials();
  applyVisibility();
  $('#loading').classList.add('done');
  if (location.hash) applyHash();
  try { if (!localStorage.getItem('b10-help-seen')) { $('#help').showModal(); localStorage.setItem('b10-help-seen', '1'); } } catch { /* storage blocked */ }
}

function fail(msg) {
  $('#loading').classList.add('error');
  $('.loading-title').textContent = 'Something went wrong';
  $('#load-detail').textContent = msg;
}

// Merge each layer's meshes by material: thousands of SketchUp parts become a few hundred draw calls.
function addLayer(entry, root) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material.side = THREE.DoubleSide;   // SketchUp-style models have inward-facing faces; show both sides
    const g = o.geometry;
    const sig = Object.keys(g.attributes).sort()
      .map((k) => `${k}:${g.attributes[k].itemSize}:${g.attributes[k].normalized}:${g.attributes[k].array.constructor.name}`)
      .join('|') + (g.index ? '#i' : '#n');
    const key = `${o.material.uuid}|${sig}`;
    if (!buckets.has(key)) buckets.set(key, { material: o.material, parts: [] });
    buckets.get(key).parts.push(o);
  });
  const group = new THREE.Group();
  group.name = entry.id;
  const meshes = [];
  // School layers: remember which "block" (stand / exhibit) each part belongs to, so a click on
  // the merged mesh can still be traced back to one stand. A block is the largest group of
  // parts in the file's hierarchy that still fits within BLOCK_MAX metres.
  const blocks = [];
  const blockOf = entry.zone ? makeBlockFinder(root, blocks) : null;
  for (const { material, parts } of buckets.values()) {
    const geos = parts.map((o) => {
      const g = o.geometry.clone();
      g.morphAttributes = {};
      g.applyMatrix4(o.matrixWorld);
      if (o.matrixWorld.determinant() < 0) flipWinding(g);
      return g;
    });
    const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    const merged = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
    const pieces = merged ? [{ g: merged, from: 0, to: parts.length }] : geos.map((g, i) => ({ g, from: i, to: i + 1 }));
    for (const { g, from, to } of pieces) {
      const mesh = new THREE.Mesh(g, material);
      mesh.userData.orig = material;
      mesh.matrixAutoUpdate = false;
      if (blockOf) {                                  // triangle range -> block, in merge order
        const ranges = []; let start = 0;
        for (let i = from; i < to; i++) { const n = tris(geos[i]); ranges.push([start, start + n, blockOf(parts[i])]); start += n; }
        mesh.userData.ranges = ranges;
      }
      group.add(mesh);
      meshes.push(mesh);
    }
    if (merged && geos.length > 1) geos.forEach((g) => g.dispose());
  }
  scene.add(group);
  layers[entry.id] = { entry, group, meshes, blocks };
  if (entry.zone) placeLabel(entry.zone);
  if (entry.id === 'guides') {
    // tag each guide mesh with its school (materials are named ZoneFill_<SHORT> / ZoneBorder_<SHORT>)
    for (const m of meshes) {
      const z = man.zones.find((x) => (m.material.name || '').endsWith(`_${x.short}`));
      if (z) { m.userData.zoneId = z.id; m.userData.fill = /Fill/.test(m.material.name); m.userData.baseOpacity = m.material.opacity; }
    }
  }
  applyVisibility();
}

const BLOCK_MAX = 8;   // metres: anything bigger is a whole zone / row, not one stand
function makeBlockFinder(root, blocks) {
  const boxCache = new Map(), idOf = new Map();
  const boxOf = (n) => {
    if (!boxCache.has(n)) boxCache.set(n, new THREE.Box3().setFromObject(n));
    return boxCache.get(n);
  };
  const fits = (n) => { const s = boxOf(n).getSize(V3()); return Math.max(s.x, s.y, s.z) <= BLOCK_MAX; };
  return (part) => {
    let node = part;
    while (node.parent && node.parent !== root && fits(node.parent)) node = node.parent;
    if (!idOf.has(node)) { idOf.set(node, blocks.length); blocks.push({ box: boxOf(node).clone(), name: node.name || '' }); }
    return idOf.get(node);
  };
}

function flipWinding(g) {
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    g.index.needsUpdate = true;
  } else {
    for (const attr of Object.values(g.attributes)) {
      const s = attr.itemSize, arr = attr.array;
      for (let v = 0; v < attr.count; v += 3) {
        for (let k = 0; k < s; k++) {
          const i1 = (v + 1) * s + k, i2 = (v + 2) * s + k;
          const t = arr[i1]; arr[i1] = arr[i2]; arr[i2] = t;
        }
      }
      attr.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------ visibility
// Hall structure + seating: always on. Roof: on only while walking (so it never blocks the
// overview). Schools + zone guides: visitor's choice.
function applyVisibility() {
  for (const [id, l] of Object.entries(layers)) {
    if (id === ROOF) l.group.visible = state.walking;
    else if (USER_LAYERS.has(id)) l.group.visible = userVisible[id] !== false;
    else l.group.visible = true;
  }
  for (const [zid, obj] of Object.entries(labelObjs)) {
    const l = man.layers.find((x) => String(x.zone) === String(zid));
    obj.visible = !l || userVisible[l.id] !== false;
  }
}

// ------------------------------------------------------------------ materials: solid / tint
// Tint applies in Solid mode only, and only to school models (never the zone guides).
const matCache = new Map();
function clearMatCache() { for (const m of matCache.values()) m.dispose(); matCache.clear(); }

function tintFor(layerId) {
  const z = layers[layerId]?.entry.zone;
  return state.tint.on && state.shading === 'solid' && z ? new THREE.Color(state.tint.colours[z]) : null;
}

function solidMaterial(orig, tint) {
  const key = `solid|${orig.uuid}|${tint ? tint.getHexString() : '-'}|${state.tint.strength}`;
  if (!matCache.has(key)) {
    const colour = tint ? SOLID_GREY.clone().lerp(tint, state.tint.strength) : SOLID_GREY.clone();
    let m;
    if (orig.alphaTest > 0 && orig.map) {           // keep cut-outs (e.g. perforated plating)
      m = orig.clone(); m.color.copy(colour); m.metalness = 0; m.roughness = 0.85;
      m.normalMap = null; m.roughnessMap = null; m.metalnessMap = null; m.emissiveMap = null;
    } else {
      m = new THREE.MeshStandardMaterial({
        color: colour, roughness: 0.85, metalness: 0, side: orig.side,
        transparent: orig.transparent, opacity: orig.transparent ? Math.max(orig.opacity, 0.25) : 1,
      });
    }
    matCache.set(key, m);
  }
  return matCache.get(key);
}

function refreshMaterials() {
  clearMatCache();
  for (const { entry, meshes } of Object.values(layers)) {
    const tint = tintFor(entry.id);
    for (const mesh of meshes) {
      const orig = mesh.userData.orig;
      if (entry.id === 'guides') { mesh.material = orig; continue; }
      mesh.material = state.shading === 'solid' ? solidMaterial(orig, tint) : orig;
    }
  }
  scene.environmentIntensity = state.shading === 'solid' ? ENV.solid : ENV.material;
}

function setShading(mode) {
  state.shading = mode;
  $$('[data-shading]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.shading === mode)));
  syncTintUI();
  refreshMaterials();
}

// ------------------------------------------------------------------ labels
// Labels float above the middle of each school, clear of its tallest exhibit.
const LABEL_CLEARANCE = 1.6;   // metres above the zone's highest object
const labelObjs = {};
function placeLabel(zid) {
  const z = zones[zid], obj = labelObjs[zid];
  if (!z || !obj) return;
  const l = man.layers.find((x) => String(x.zone) === String(zid));
  let top = floorY + 2.5;
  if (l && layers[l.id]) top = Math.max(top, new THREE.Box3().setFromObject(layers[l.id].group).max.y);
  obj.position.set(z.centre.x, top + LABEL_CLEARANCE, z.centre.z);
}
function buildLabels() {
  for (const z of Object.values(zones)) {
    const el = document.createElement('div');
    el.className = 'zone-label';
    el.style.setProperty('--zc', z.colour);
    el.innerHTML = `<span class="num">${z.id}</span><span>${z.short}</span>`;
    el.title = `${z.short}: click to view`;
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => { e.stopPropagation(); go(`zone${z.id}`); });
    const obj = new CSS2DObject(el);
    scene.add(obj);
    labelObjs[z.id] = obj;
    placeLabel(z.id);
  }
}

// ------------------------------------------------------------------ camera poses
function fitDistance(size) {
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  return (size / 2) / Math.tan(Math.min(vfov, hfov) / 2);
}
function orbitPose(target, size, elevationDeg, azimuthDeg = 0) {
  const d = Math.min(fitDistance(size), controls.maxDistance);
  const el = THREE.MathUtils.degToRad(elevationDeg), az = THREE.MathUtils.degToRad(azimuthDeg);
  // azimuth 0 = looking from the entrance side (+Z) toward the stage side (-Z)
  const pos = target.clone().add(V3(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d));
  return { pos, target: target.clone() };
}
const floorCentre = () => walkBox.getCenter(V3()).setY(floorY);
const poses = {
  overview: () => orbitPose(floorCentre(), Math.max(walkBox.max.x - walkBox.min.x, walkBox.max.z - walkBox.min.z) * 1.05, 42),
  top: () => {
    const c = floorCentre();
    const size = Math.max(walkBox.max.x - walkBox.min.x, (walkBox.max.z - walkBox.min.z) * camera.aspect) * 1.02;
    return { pos: c.clone().add(V3(0, Math.min(fitDistance(size), camBox.max.y - floorY - 1), 0.01)), target: c };
  },
  entrance: () => ({
    pos: V3((walkBox.min.x + walkBox.max.x) / 2, floorY + EYE, walkBox.max.z - 0.8),
    target: V3((walkBox.min.x + walkBox.max.x) / 2, floorY + EYE, walkBox.max.z - 10),
    walk: true,
  }),
};
function zonePose(id) {
  const z = zones[id];
  const size = Math.max(z.box.max.x - z.box.min.x, z.box.max.z - z.box.min.z);
  const c = z.centre.clone().setY(floorY);
  // side zones are viewed from the central aisle, not from behind the hall wall
  const dx = z.centre.x - floorCentre().x;
  const az = Math.abs(dx) > 3 ? -Math.sign(dx) * 35 : 0;
  return orbitPose(c, size * 0.95, 40, az);
}

// ------------------------------------------------------------------ fly / go
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function goTo(pose, dur = 1.3, after) {
  if (state.walking && !pose.walk) exitWalk(false);
  if (dur <= 0) {
    camera.position.copy(pose.pos); controls.target.copy(pose.target); camera.lookAt(pose.target);
    controls.update(); after?.(); return;
  }
  state.fly = { from: camera.position.clone(), fromT: controls.target.clone(), to: pose.pos, toT: pose.target, t: 0, dur, after };
}
function go(name) {
  stopTour();
  closePopovers();
  setActivePreset(name);
  if (name === 'entrance') { requestLook(); goTo(poses.entrance(), 1.3, () => enterWalk()); return; }
  const pose = name.startsWith('zone') ? zonePose(Number(name.slice(4))) : poses[name]();
  goTo(pose);
  history.replaceState(null, '', `#${name}`);
}
function applyHash() {
  const h = location.hash.slice(1);
  if (h === 'walk') return go('entrance');
  if (h.startsWith('tour-') && tours[h.slice(5)]) return startTour(h.slice(5));
  if (poses[h] || /^zone[123]$/.test(h)) go(h);
}

// ------------------------------------------------------------------ walk mode
const walk = { yaw: 0, pitch: 0, keys: new Set(), target: null, drag: null, pad: { move: 0, turn: 0 } };
const marker = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.32, 40), new THREE.MeshBasicMaterial({ color: 0xE60028, transparent: true, opacity: 0.9, depthTest: false }));
marker.rotation.x = -Math.PI / 2; marker.visible = false; marker.renderOrder = 10; scene.add(marker);

function enterWalk() {
  stopTour();
  state.walking = true;
  controls.enabled = false;
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  walk.yaw = Math.atan2(-dir.x, -dir.z);
  walk.pitch = 0;
  camera.position.y = floorY + EYE;
  clampWalk(camera.position);
  stage.classList.add('walking');
  $('#btn-walk').classList.add('active');
  applyVisibility();            // roof on
  updateWalkHint();
  buildNavpad();
  history.replaceState(null, '', '#walk');
}
function exitWalk(reframe = true) {
  if (!state.walking) return;
  state.walking = false;
  walk.target = null; marker.visible = false; walk.keys.clear();
  if (isLocked()) document.exitPointerLock();
  stage.classList.remove('walking');
  $('#btn-walk').classList.remove('active');
  applyVisibility();            // roof off
  updateWalkHint();
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  controls.target.copy(camera.position).addScaledVector(dir, 6);
  controls.enabled = true;
  if (reframe) {
    // lift out to a comfortable orbit around where the visitor was looking
    const t = controls.target.clone().setY(floorY);
    clampWalk(t); t.y = floorY;
    goTo(orbitPose(t, 18, 38, THREE.MathUtils.radToDeg(walk.yaw)));
  }
  buildNavpad();
}
function clampWalk(p) {
  p.x = THREE.MathUtils.clamp(p.x, walkBox.min.x, walkBox.max.x);
  p.z = THREE.MathUtils.clamp(p.z, walkBox.min.z, walkBox.max.z);
  p.y = floorY + EYE;
}
const floorPlane = new THREE.Plane(V3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();
function floorPointAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  floorPlane.constant = -floorY;
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(floorPlane, hit) ? hit : null;
}

function updateWalk(dt) {
  const fwd = V3(-Math.sin(walk.yaw), 0, -Math.cos(walk.yaw));
  const right = V3(-fwd.z, 0, fwd.x);
  const move = V3();
  const k = walk.keys;
  if (k.has('KeyW') || k.has('ArrowUp')) move.add(fwd);
  if (k.has('KeyS') || k.has('ArrowDown')) move.sub(fwd);
  if (k.has('KeyD')) move.add(right);
  if (k.has('KeyA')) move.sub(right);
  if (k.has('ArrowLeft')) walk.yaw += 1.6 * dt;
  if (k.has('ArrowRight')) walk.yaw -= 1.6 * dt;
  if (walk.pad.move) move.addScaledVector(fwd, walk.pad.move);
  if (walk.pad.turn) walk.yaw -= walk.pad.turn * 1.4 * dt;
  const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
  if (move.lengthSq() > 0) {
    walk.target = null; marker.visible = false;
    camera.position.addScaledVector(move.normalize(), speed * dt);
  } else if (walk.target) {
    const to = walk.target.clone().setY(camera.position.y).sub(camera.position);
    const dist = to.length();
    if (dist < 0.08) { walk.target = null; marker.visible = false; }
    else {
      camera.position.addScaledVector(to.normalize(), Math.min(dist, Math.max(WALK_SPEED * 1.4, dist * 1.5) * dt));
      if (!isLocked()) {         // on touch, gently turn toward the destination
        const want = Math.atan2(-to.x, -to.z);
        let d = want - walk.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        walk.yaw += d * Math.min(1, dt * 2.5);
      }
    }
  }
  clampWalk(camera.position);
  camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
}

// ---- walk-mode input
// Mouse: FPS style. One click captures the mouse (Pointer Lock); moving it looks around,
// clicking walks to the floor under the crosshair, Esc frees the mouse (Esc again exits).
// Touch: drag to look, tap the floor to walk there.
const isTouch = window.matchMedia('(pointer: coarse)').matches;
const isLocked = () => document.pointerLockElement === canvas;
let lastUnlock = 0;
function requestLook() {
  if (isTouch || !canvas.requestPointerLock || isLocked()) return;
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* not allowed right now */ }
}
function setWalkTarget(p) {
  if (!p) return;
  clampWalk(p);
  walk.target = p;
  marker.position.set(p.x, floorY + 0.02, p.z);
  marker.visible = true;
}
function updateWalkHint() {
  const hint = $('#walkhint');
  if (!state.walking) { hint.hidden = true; $('#crosshair').hidden = true; return; }
  hint.hidden = !!state.tour;
  $('#crosshair').hidden = !isLocked();
  if (isTouch) hint.innerHTML = '<strong>Walk mode</strong> · Tap the floor to walk there · Drag to look around';
  else if (isLocked()) hint.innerHTML = '<strong>Walk mode</strong> · Move the mouse to look · Click to walk to the crosshair · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to move · <kbd>Esc</kbd> frees the mouse';
  else hint.innerHTML = '<strong>Walk mode</strong> · <b>Click the view</b> to look around with the mouse · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to move · <kbd>Esc</kbd> to exit';
}
document.addEventListener('pointerlockchange', () => {
  if (!isLocked()) lastUnlock = performance.now();
  updateWalkHint();
});
document.addEventListener('mousemove', (e) => {
  if (!state.walking || !isLocked()) return;
  walk.yaw -= e.movementX * 0.0022;
  walk.pitch = THREE.MathUtils.clamp(walk.pitch - e.movementY * 0.0022, -1.3, 1.3);
});
canvas.addEventListener('pointerdown', (e) => {
  stopTour();
  closePopovers();
  if (!state.walking) return;
  if (e.pointerType === 'mouse') {
    if (!isLocked()) { requestLook(); return; }
    const r = canvas.getBoundingClientRect();
    setWalkTarget(floorPointAt(r.left + r.width / 2, r.top + r.height / 2));
    return;
  }
  walk.drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!state.walking || !walk.drag) return;
  const dx = e.clientX - walk.drag.x, dy = e.clientY - walk.drag.y;
  walk.drag.x = e.clientX; walk.drag.y = e.clientY;
  walk.yaw += dx * 0.0035;                         // touch: drag the view like a photo sphere
  walk.pitch = THREE.MathUtils.clamp(walk.pitch + dy * 0.0035, -1.3, 1.3);
});
canvas.addEventListener('pointerup', (e) => {
  if (!state.walking || !walk.drag) return;
  const moved = Math.hypot(e.clientX - walk.drag.sx, e.clientY - walk.drag.sy);
  const quick = performance.now() - walk.drag.t < 350;
  walk.drag = null;
  if (moved < 6 && quick) setWalkTarget(floorPointAt(e.clientX, e.clientY));
});
// ---- clickable school blocks (orbit views): hovering a school's zone highlights it, clicking
// flies to that school. Only the flat zone guides are ray-tested, so it is instant, and a click
// on top of a stand still counts (the ray reaches the guide underneath).
let hoverZone = null, downAt = null, hoverPending = false;
function zoneAt(clientX, clientY) {
  const g = layers.guides;
  if (!g) return null;
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
  for (const h of raycaster.intersectObjects(g.meshes.filter((m) => m.userData.zoneId), false)) {
    const id = h.object.userData.zoneId;
    const l = man.layers.find((x) => x.zone === id);
    if (l && userVisible[l.id] === false) continue;         // school hidden: not clickable
    const z = zones[id];
    const size = Math.max(z.box.max.x - z.box.min.x, z.box.max.z - z.box.min.z);
    if (camera.position.distanceTo(z.centre) < size * 1.1) return null;   // already zoomed in on it
    return id;
  }
  return null;
}
function setHoverZone(id) {
  if (id === hoverZone) return;
  hoverZone = id;
  stage.classList.toggle('zone-hover', !!id);
  for (const m of layers.guides?.meshes ?? []) {
    if (m.userData.fill) m.material.opacity = m.userData.zoneId === id ? Math.min(0.65, m.userData.baseOpacity * 2.2) : m.userData.baseOpacity;
  }
  for (const [zid, obj] of Object.entries(labelObjs)) obj.element.classList.toggle('hot', String(zid) === String(id));
}
canvas.addEventListener('pointerdown', (e) => {
  if (!state.walking && e.button === 0) downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener('pointermove', (e) => {
  if (state.walking || state.tour || state.fly || e.buttons) { setHoverZone(null); return; }
  if (e.pointerType !== 'mouse' || hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(() => { hoverPending = false; setHoverZone(zoneAt(e.clientX, e.clientY)); });
});
canvas.addEventListener('pointerleave', () => setHoverZone(null));
canvas.addEventListener('pointerup', (e) => {
  if (state.walking || !downAt) return;
  const d = downAt; downAt = null;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || performance.now() - d.t > 450) return;   // was a drag
  // from afar, a click picks the school; once you're looking at a school, it picks one stand
  const id = zoneAt(e.clientX, e.clientY);
  if (id) { setHoverZone(null); go(`zone${id}`); return; }
  const blk = blockAt(e.clientX, e.clientY);
  if (blk) focusBlock(blk);
});
canvas.addEventListener('dblclick', (e) => {        // double-click: straight to that stand, from any view
  if (state.walking || state.tour) return;
  const blk = blockAt(e.clientX, e.clientY);
  if (blk) focusBlock(blk);
});

// ---- per-block click-to-focus
function blockAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
  const targets = Object.values(layers).filter((l) => l.entry.zone && l.group.visible).flatMap((l) => l.meshes);
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit || hit.faceIndex == null) return null;
  const ranges = hit.object.userData.ranges;
  if (!ranges) return null;
  let lo = 0, hi = ranges.length - 1;                  // binary search the triangle -> block table
  while (lo < hi) { const mid = (lo + hi) >> 1; if (hit.faceIndex >= ranges[mid][1]) lo = mid + 1; else hi = mid; }
  const layer = Object.values(layers).find((l) => l.meshes.includes(hit.object));
  const block = layer.blocks[ranges[lo][2]];
  return block ? { ...block, zone: layer.entry.zone } : null;
}
let focusFlash = null;
function focusBlock(blk) {
  stopTour();
  closePopovers();
  setActivePreset(null);
  const centre = blk.box.getCenter(V3());
  const size = blk.box.getSize(V3());
  const span = Math.max(size.x, size.z, size.y * 1.4, 1.2);
  // keep looking from the current side, a little above the stand
  const off = camera.position.clone().sub(centre);
  const az = THREE.MathUtils.radToDeg(Math.atan2(off.x, off.z));
  const target = centre.clone().setY(Math.max(floorY + 0.6, centre.y));
  goTo(orbitPose(target, span * 1.6, 32, az));
  // flash an outline in the school's colour
  if (focusFlash) { scene.remove(focusFlash.helper); focusFlash.helper.geometry.dispose(); }
  const helper = new THREE.Box3Helper(blk.box.clone().expandByScalar(0.08), new THREE.Color(zones[blk.zone]?.colour || '#E60028'));
  helper.material.transparent = true; helper.material.depthTest = false; helper.renderOrder = 20;
  scene.add(helper);
  focusFlash = { helper, t: 0 };
}
function updateFocusFlash(dt) {
  if (!focusFlash) return;
  focusFlash.t += dt;
  const k = focusFlash.t / 2.6;                          // visible ~2.6 s, fading out over the last second
  focusFlash.helper.material.opacity = k < 0.6 ? 1 : Math.max(0, 1 - (k - 0.6) / 0.4);
  if (k >= 1) { scene.remove(focusFlash.helper); focusFlash.helper.geometry.dispose(); focusFlash = null; }
}

// ---- wheel / trackpad (handled here instead of OrbitControls, which treats every
// two-finger swipe as zoom). Orbit: mouse wheel and pinch zoom, two-finger swipe moves around,
// Safari's twist gesture rotates. Walk: wheel / swipe walks forward-back and turns.
function isMouseWheel(e) {
  if (e.deltaMode !== 0) return true;                       // line/page units: a wheel (Firefox)
  if (e.deltaX !== 0) return false;                         // sideways component: trackpad
  if (typeof e.wheelDeltaY === 'number' && e.wheelDeltaY !== 0)
    return Math.abs(e.wheelDeltaY) >= 120 && e.wheelDeltaY % 120 === 0;   // wheel notches are multiples of 120
  return Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY);
}
function panBy(dxPx, dyPx) {
  const dist = camera.position.distanceTo(controls.target);
  const perPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / canvas.clientHeight;
  const fwd = controls.target.clone().sub(camera.position).setY(0);
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1).applyQuaternion(camera.quaternion).setY(0);   // looking straight down
  fwd.normalize();
  const right = V3(-fwd.z, 0, fwd.x);
  const move = right.multiplyScalar(dxPx * perPx).addScaledVector(fwd, -dyPx * perPx * 1.4);
  camera.position.add(move);
  controls.target.add(move);
  clampOrbit();                                    // stay around the hall straight away
}
stage.addEventListener('wheel', (e) => {     // on the parent, capture phase: runs before OrbitControls
  e.preventDefault();
  e.stopImmediatePropagation();                              // keep OrbitControls' own zoom out of it
  stopTour();
  if (state.fly) return;
  const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
  const dx = e.deltaX * px, dy = e.deltaY * px;
  if (state.walking) {
    const fwd = V3(-Math.sin(walk.yaw), 0, -Math.cos(walk.yaw));
    camera.position.addScaledVector(fwd, THREE.MathUtils.clamp(-dy * 0.01, -1, 1));
    walk.yaw -= dx * 0.003;
    walk.target = null; marker.visible = false;
    clampWalk(camera.position);
    return;
  }
  setActivePreset(null);
  if (e.ctrlKey) flyForward(-dy * 0.04);                    // trackpad pinch (Chrome / Edge / Firefox)
  else if (isMouseWheel(e)) flyForward(-dy / 100);          // mouse wheel: move along the view
  else panBy(dx, dy);                                        // two-finger swipe
}, { passive: false, capture: true });

// Safari reports trackpad pinch / twist as gesture events
let gesture = null;
stage.addEventListener('gesturestart', (e) => { e.preventDefault(); stopTour(); gesture = { scale: 1, rotation: 0 }; });
stage.addEventListener('gesturechange', (e) => {
  e.preventDefault();
  if (!gesture || state.walking) return;
  flyForward((e.scale - gesture.scale) * 6);
  rotateAround(THREE.MathUtils.degToRad(gesture.rotation - e.rotation));
  gesture.scale = e.scale; gesture.rotation = e.rotation;
});
stage.addEventListener('gestureend', (e) => { e.preventDefault(); gesture = null; });
// stop pinch-zoom of the page itself anywhere on the UI
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, dialog[open]')) return;
  if (e.code === 'Escape' && closePopovers()) return;
  if (state.tour) stopTour();
  if (state.walking) {
    // the first Esc only frees the mouse (handled by the browser); a second Esc exits walk mode
    if (e.code === 'Escape') { if (!isLocked() && performance.now() - lastUnlock > 400) exitWalk(); return; }
    walk.keys.add(e.code);
    if (e.code.startsWith('Arrow')) e.preventDefault();
  }
  const map = { Digit1: 'overview', Digit2: 'top', Digit3: 'zone1', Digit4: 'zone2', Digit5: 'zone3' };
  if (map[e.code]) go(map[e.code]);
  if (!state.walking && (e.key === '+' || e.key === '=')) flyForward(1);
  if (!state.walking && (e.key === '-' || e.key === '_')) flyForward(-1);
  if (e.code === 'KeyV') toggleWalk();
  if (e.code === 'KeyT' && !state.walking) startTour('hall');
});
window.addEventListener('keyup', (e) => walk.keys.delete(e.code));
window.addEventListener('blur', () => walk.keys.clear());

function toggleWalk() {
  closePopovers();
  if (state.walking) { exitWalk(); return; }
  requestLook();                                   // pointer lock needs this click/key press
  setActivePreset(null);
  goTo(walkStartPose(), 1.0, () => enterWalk());
}
function walkStartPose() {
  // drop to eye level right below where the orbit camera is looking
  const t = controls.target.clone();
  clampWalk(t);
  const dir = t.clone().sub(camera.position).setY(0);
  if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
  dir.normalize();
  const pos = t.clone().addScaledVector(dir, -2.5); clampWalk(pos);
  return { pos, target: pos.clone().addScaledVector(dir, 8), walk: true };
}

// ------------------------------------------------------------------ tours
function orbitSeg(centre, radius, height, a0, sweep, dur, title, sub) {
  return { type: 'orbit', centre, radius, height, a0, sweep, dur, title, sub };
}
function orbitStart(seg) {
  const a = seg.a0;
  return { pos: seg.centre.clone().add(V3(Math.sin(a) * seg.radius, seg.height, Math.cos(a) * seg.radius)), target: seg.centre.clone() };
}
function schoolSegments(id, sweep, dur) {
  const z = zones[id];
  const size = Math.max(z.box.max.x - z.box.min.x, z.box.max.z - z.box.min.z);
  const c = z.centre.clone().setY(floorY + 0.8);
  const seg = orbitSeg(c, Math.max(9, size * 0.62), Math.max(6, size * 0.38), 0, sweep, dur, `${z.id} · ${z.short}`, 'School tour');
  return [{ type: 'fly', to: orbitStart(seg), dur: 2.0, title: seg.title, sub: seg.sub }, seg];
}
const tours = {
  hall: () => {
    const c = floorCentre().setY(floorY + 1);
    const size = Math.max(walkBox.max.x - walkBox.min.x, walkBox.max.z - walkBox.min.z);
    const seg = orbitSeg(c, size * 0.85, size * 0.45, 0, Math.PI * 2, 60, 'B10 hall tour', 'A full orbit around the showcase');
    return [{ type: 'fly', to: orbitStart(seg), dur: 2.2, title: seg.title, sub: seg.sub }, seg];
  },
  zone1: () => schoolSegments(1, Math.PI * 2, 40),
  zone2: () => schoolSegments(2, Math.PI * 2, 40),
  zone3: () => schoolSegments(3, Math.PI * 2, 40),
  schools: () => [...schoolSegments(1, Math.PI, 18), ...schoolSegments(2, Math.PI, 18), ...schoolSegments(3, Math.PI, 18),
    { type: 'fly', to: poses.overview(), dur: 2.4, title: 'B10 Showcase', sub: 'Overview' }],
};

function startTour(name) {
  closePopovers();
  if (state.walking) exitWalk(false);
  state.fly = null;
  const segs = tours[name]();
  state.tour = { segs, i: 0, t: 0, total: segs.reduce((s, x) => s + x.dur, 0), elapsed: 0 };
  controls.enabled = false;
  $('#tourhud').hidden = false;
  $('#btn-tour').classList.add('active');
  setActivePreset(null);
  history.replaceState(null, '', `#tour-${name}`);
  beginSeg();
}
function beginSeg() {
  const seg = state.tour.segs[state.tour.i];
  if (seg.type === 'fly') { seg.from = camera.position.clone(); seg.fromT = controls.target.clone(); }
  $('#tour-title').textContent = seg.title || '';
  $('#tour-sub').textContent = seg.sub || '';
}
function stopTour() {
  if (!state.tour) return;
  state.tour = null;
  $('#tourhud').hidden = true;
  $('#btn-tour').classList.remove('active');
  controls.enabled = !state.walking;
}
function updateTour(dt) {
  const tr = state.tour;
  const seg = tr.segs[tr.i];
  tr.t += dt; tr.elapsed += dt;
  const k = Math.min(1, tr.t / seg.dur);
  if (seg.type === 'fly') {
    const e = ease(k);
    camera.position.lerpVectors(seg.from, seg.to.pos, e);
    controls.target.lerpVectors(seg.fromT, seg.to.target, e);
  } else {
    const a = seg.a0 + seg.sweep * k;
    camera.position.copy(seg.centre).add(V3(Math.sin(a) * seg.radius, seg.height, Math.cos(a) * seg.radius));
    controls.target.copy(seg.centre);
  }
  camera.lookAt(controls.target);
  $('#tour-progress').style.width = `${Math.min(100, (tr.elapsed / tr.total) * 100)}%`;
  if (k >= 1) {
    tr.i++; tr.t = 0;
    if (tr.i >= tr.segs.length) { stopTour(); controls.update(); }
    else beginSeg();
  }
}

// ------------------------------------------------------------------ popovers
const popovers = [
  { btn: '#btn-layers', pop: '#pop-layers' },
  { btn: '#btn-tint', pop: '#pop-tint' },
  { btn: '#btn-tour', pop: '#tour-menu', side: 'right' },
];
function closePopovers() {
  let closed = false;
  for (const p of popovers) {
    const pop = $(p.pop);
    if (!pop.hidden) { pop.hidden = true; closed = true; }
    $(p.btn).setAttribute('aria-expanded', 'false');
  }
  return closed;
}
function togglePopover(p) {
  const pop = $(p.pop), btn = $(p.btn);
  const wasOpen = !pop.hidden;
  closePopovers();
  if (wasOpen) return;
  pop.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const narrow = window.innerWidth <= 760;
  if (p.side === 'right' && !narrow) {              // flyout beside the left rail
    pop.style.left = `${r.right + 10}px`;
    pop.style.top = `${Math.max(12, Math.min(window.innerHeight - ph - 12, r.top + r.height / 2 - ph / 2))}px`;
  } else if (p.side === 'right') {                  // rail sits at the bottom on phones: open upward
    pop.style.left = `${Math.max(12, Math.min(window.innerWidth - pw - 12, r.left + r.width / 2 - pw / 2))}px`;
    pop.style.top = `${r.top - ph - 10}px`;
  } else {                                           // under the top-right action pill
    pop.style.left = `${Math.max(12, Math.min(window.innerWidth - pw - 12, r.right - pw))}px`;
    pop.style.top = `${r.bottom + 10}px`;
  }
}
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.pop, .actions, #btn-tour')) return;
  closePopovers();
});

// ------------------------------------------------------------------ UI
function buildUI() {
  // left rail: views
  const presets = [
    { id: 'overview', label: 'Overview', ico: 'home', tip: 'Overview of the hall (1)' },
    { id: 'top', label: 'Top', ico: 'top', tip: 'Top-down floor plan (2)' },
    ...man.zones.map((z, i) => ({ id: `zone${z.id}`, label: z.short, zone: z, tip: `${z.short} (${i + 3})` })),
    { id: 'entrance', label: 'Entrance', ico: 'door', tip: 'Stand at the entrance in walk mode' },
  ];
  const box = $('#presets');
  for (const p of presets) {
    const b = document.createElement('button');
    b.className = 'tool'; b.dataset.preset = p.id; b.dataset.tip = p.tip; b.setAttribute('aria-label', p.tip);
    b.innerHTML = p.zone
      ? `<span class="zone-dot" style="--zc:${p.zone.colour}">${p.zone.id}</span><span class="tool-label">${p.label}</span>`
      : `${icon(p.ico)}<span class="tool-label">${p.label}</span>`;
    b.addEventListener('click', () => go(p.id));
    box.appendChild(b);
  }

  $('#btn-walk').addEventListener('click', toggleWalk);

  // tours flyout
  const menu = $('#tour-menu');
  const items = [
    { id: 'hall', label: 'Full hall orbit', sub: 'One slow lap around the whole showcase', colour: 'var(--rmit-red)' },
    { id: 'schools', label: 'All schools', sub: 'SSET → SCD → TBS', colour: 'var(--rmit-navy)' },
    ...man.zones.map((z) => ({ id: `zone${z.id}`, label: `${z.short} tour`, sub: 'One lap around the zone', colour: z.colour })),
  ];
  for (const it of items) {
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    b.innerHTML = `<span class="swatch" style="background:${it.colour}"></span><span>${it.label}<small>${it.sub}</small></span>`;
    b.addEventListener('click', () => startTour(it.id));
    menu.appendChild(b);
  }
  $('#btn-tour').addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.tour) { stopTour(); controls.update(); return; }
    togglePopover(popovers[2]);
  });
  $('#tour-stop').addEventListener('click', () => { stopTour(); controls.update(); });

  // top-right actions
  $('#btn-layers').addEventListener('click', () => togglePopover(popovers[0]));
  $('#btn-tint').addEventListener('click', () => togglePopover(popovers[1]));
  $$('[data-close]').forEach((b) => b.addEventListener('click', closePopovers));
  $('#btn-help').addEventListener('click', () => { closePopovers(); $('#help').showModal(); });
  $$('[data-shading]').forEach((b) => b.addEventListener('click', () => setShading(b.dataset.shading)));

  // show / hide: schools + guides only (structure is managed automatically)
  const list = $('#layer-list');
  const add = (title, entries) => {
    if (!entries.length) return;
    const h = document.createElement('h3'); h.textContent = title; list.appendChild(h);
    for (const l of entries) {
      const z = l.zone ? man.zones.find((x) => x.id === l.zone) : null;
      const row = document.createElement('label');
      row.className = 'row';
      row.innerHTML = `<span>${z ? `<span class="swatch" style="background:${z.colour}"></span><b>${z.short}</b>` : l.label}</span>`
        + `<input type="checkbox" class="switch" data-layer="${l.id}" ${userVisible[l.id] !== false ? 'checked' : ''}>`;
      row.querySelector('input').addEventListener('change', (e) => { userVisible[l.id] = e.target.checked; applyVisibility(); });
      list.appendChild(row);
    }
  };
  add('Schools', man.layers.filter((l) => l.zone));
  add('Guides', man.layers.filter((l) => l.id === 'guides'));
  $('#opt-labels').addEventListener('change', (e) => labelRenderer.domElement.classList.toggle('hide-labels', !e.target.checked));

  // tint by school (Solid mode only)
  const tintList = $('#tint-colours');
  for (const z of man.zones) {
    const row = document.createElement('label');
    row.className = 'row';
    row.innerHTML = `<span><span class="swatch" style="background:${z.colour}"></span><b>${z.short}</b></span><input type="color" value="${z.colour}" aria-label="${z.short} tint colour">`;
    row.querySelector('input').addEventListener('input', (e) => {
      state.tint.colours[z.id] = e.target.value;
      row.querySelector('.swatch').style.background = e.target.value;
      if (state.tint.on) refreshMaterials();
    });
    tintList.appendChild(row);
  }
  $('#opt-tint').addEventListener('change', (e) => {
    state.tint.on = e.target.checked;
    if (state.tint.on && state.shading !== 'solid') setShading('solid');   // tint only shows in Solid
    else { syncTintUI(); refreshMaterials(); }
  });
  $('#opt-tint-strength').addEventListener('input', (e) => { state.tint.strength = Number(e.target.value); if (state.tint.on) refreshMaterials(); });
  syncTintUI();

  buildLabels();
  buildNavpad();
}

function syncTintUI() {
  const off = !state.tint.on;
  $('#tint-colours').classList.toggle('disabled', off);
  $('#opt-tint-strength').closest('.row').classList.toggle('disabled', off);
  $('#tint-note').hidden = state.shading === 'solid' && state.tint.on;
  $('#btn-tint').classList.toggle('active', state.tint.on && state.shading === 'solid');
}

function setActivePreset(name) {
  $$('#presets .tool').forEach((b) => b.classList.toggle('active', b.dataset.preset === name));
}

// bottom-right bar: orbit (rotate / zoom / fit) or walk (move / turn / exit)
function buildNavpad() {
  const pad = $('#navpad');
  pad.innerHTML = '';
  const btn = (ico, tip, onHold, cls = 'tool', text = '') => {
    const b = document.createElement('button');
    b.className = cls; b.dataset.tip = tip; b.dataset.tipPos = 'left'; b.setAttribute('aria-label', tip);
    b.innerHTML = ico ? icon(ico) : text;
    let timer = null;
    const start = (e) => { e.preventDefault(); stopTour(); onHold(true); timer = setInterval(() => onHold(false), 16); };
    const end = () => { if (timer) { clearInterval(timer); timer = null; onHold(null); } };
    b.addEventListener('pointerdown', start);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, end));
    pad.appendChild(b);
  };
  if (state.walking) {
    btn('rotl', 'Turn left', (s) => { walk.pad.turn = s === null ? 0 : -1; });
    btn('up', 'Walk forward', (s) => { walk.pad.move = s === null ? 0 : 1; });
    btn('down', 'Walk back', (s) => { walk.pad.move = s === null ? 0 : -1; });
    btn('rotr', 'Turn right', (s) => { walk.pad.turn = s === null ? 0 : 1; });
    const sep = document.createElement('span'); sep.className = 'sep'; pad.appendChild(sep);
    btn(null, 'Leave walk mode (Esc)', (s) => { if (s === true) exitWalk(); }, 'tool exit', 'Exit walk');
  } else {
    btn('rotl', 'Rotate left', (s) => { if (s !== null) rotateAround(-0.025); });
    btn('minus', 'Move back', (s) => { if (s !== null) flyForward(-0.12); });
    btn('fit', 'Fit the whole hall', (s) => { if (s === true) go('overview'); });
    btn('plus', 'Move forward', (s) => { if (s !== null) flyForward(0.12); });
    btn('rotr', 'Rotate right', (s) => { if (s !== null) rotateAround(0.025); });
  }
}
// Move the camera along the viewing direction (wheel / pinch / +/-): unlike an orbit zoom it
// never "runs out" near the pivot. The pivot is re-aimed at the floor point under the view
// centre, so rotating afterwards turns around what you're looking at.
const _floor = new THREE.Plane(V3(0, 1, 0), 0);
function flyForward(notches) {
  const dir = camera.getWorldDirection(V3());
  const height = camera.position.y - floorY;
  const step = notches * THREE.MathUtils.clamp(height * 0.12, 0.35, 5);
  const minY = floorY + 1.2;
  const pos = camera.position.clone().addScaledVector(dir, step);
  if (pos.y < minY) {                               // would dive into the floor: glide level instead
    const flat = dir.clone().setY(0);
    if (flat.lengthSq() > 1e-6) {
      pos.copy(camera.position).addScaledVector(flat.normalize(), Math.abs(step) * Math.sign(step));
    }
    pos.y = Math.max(minY, Math.min(camera.position.y, pos.y));
  }
  if (camBox) camBox.clampPoint(pos, pos);
  camera.position.copy(pos);
  _floor.constant = -floorY;
  const hit = new THREE.Ray(camera.position, dir).intersectPlane(_floor, V3());
  const t = hit && hit.distanceTo(camera.position) < 120 ? hit : camera.position.clone().addScaledVector(dir, 8);
  t.x = THREE.MathUtils.clamp(t.x, walkBox.min.x, walkBox.max.x);
  t.z = THREE.MathUtils.clamp(t.z, walkBox.min.z, walkBox.max.z);
  t.y = THREE.MathUtils.clamp(t.y, floorY - 0.5, floorY + 12);
  controls.target.copy(t);
  camera.lookAt(t);
}
function rotateAround(a) {
  const off = camera.position.clone().sub(controls.target);
  off.applyAxisAngle(V3(0, 1, 0), a);
  camera.position.copy(controls.target).add(off);
}
function dolly(f) {
  const off = camera.position.clone().sub(controls.target).multiplyScalar(f);
  const len = THREE.MathUtils.clamp(off.length(), controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).add(off.setLength(len));
}

// ------------------------------------------------------------------ camera limits
// The orbit pivot stays on the showcase floor; the camera stays inside a box a little larger
// than the hall and never goes under the floor. Walk mode is clamped to the floor separately.
function setCameraLimits() {
  const size = hallBox.getSize(V3());
  camBox = new THREE.Box3(
    V3(hallBox.min.x - 15, floorY + 0.4, hallBox.min.z - 15),
    V3(hallBox.max.x + 15, floorY + 95, hallBox.max.z + 15));
  // distance limits are loose: the camera box below is what keeps visitors around the hall,
  // and a tight minimum distance is what used to make scrolling "stop"
  controls.maxDistance = Math.max(size.x, size.z) * 2;
  controls.minDistance = 0.3;
}
function clampOrbit() {
  if (!walkBox) return;
  const t = controls.target;
  const before = t.clone();
  t.x = THREE.MathUtils.clamp(t.x, walkBox.min.x, walkBox.max.x);
  t.z = THREE.MathUtils.clamp(t.z, walkBox.min.z, walkBox.max.z);
  t.y = THREE.MathUtils.clamp(t.y, floorY - 0.5, floorY + 12);
  camera.position.add(t.clone().sub(before));
  if (camBox) camBox.clampPoint(camera.position, camera.position);
}

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  updateFocusFlash(dt);
  if (state.tour) updateTour(dt);
  else if (state.fly) {
    const f = state.fly;
    f.t += dt;
    const e = ease(Math.min(1, f.t / f.dur));
    camera.position.lerpVectors(f.from, f.to, e);
    controls.target.lerpVectors(f.fromT, f.toT, e);
    camera.lookAt(controls.target);
    if (f.t >= f.dur) { state.fly = null; controls.update(); f.after?.(); }
  } else if (state.walking) updateWalk(dt);
  else { controls.update(); clampOrbit(); }
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});
controls.addEventListener('start', () => { stopTour(); state.fly = null; setActivePreset(null); closePopovers(); });

if (new URLSearchParams(location.search).has('debug')) window.b10 = { camera, controls, layers, zones, labelObjs, state, blockAt, focusBlock, go };
boot();
