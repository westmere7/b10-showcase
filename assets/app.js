// B10 Showcase: RMIT Vietnam Experience Day 2026
// Static three.js viewer. Models + manifest are produced by _tools/export_web.py.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const EYE = 1.7;                                   // walk-mode eye height (m)
const WALK_SPEED = 1.6, RUN_SPEED = 4.0;
const SOLID_GREY = new THREE.Color('#b9bcc6');
const FLOOR_MAT = 'MainZoneAfterOffset', FLOOR_COLOUR = '#8f9097';   // the showcase floor: a little darker than the file's, so white stands read clearly
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
labelRenderer.domElement.className = 'labels hide-labels';   // school labels start hidden (Show / hide menu)
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

// Sun shadows (toggle with the sun button). The plan never moves, so the shadow map is drawn once and redrawn
// only when a layer is shown or hidden: each frame just reads it back, which costs very little.
const SUN_DIR = V3(-22, 46, 28).normalize();     // same side as before, a bit higher (~52°) for shorter shadows
const SHADOW_STRENGTH = 0.8;                       // 1 = sun fully blocked; lower keeps shadowed sides readable
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
sun.castShadow = true;
sun.shadow.intensity = SHADOW_STRENGTH;
sun.shadow.mapSize.setScalar(!matchMedia('(pointer: coarse)').matches && renderer.capabilities.maxTextureSize >= 8192 ? 4096 : 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.03;
scene.add(sun.target);
const redrawShadows = () => { renderer.shadowMap.needsUpdate = true; };

// aim the sun at the hall and fit its shadow camera tightly around it (sharper shadows)
function fitShadow() {
  const c = hallBox.getCenter(V3());
  sun.target.position.copy(c);
  sun.position.copy(c).addScaledVector(SUN_DIR, 60);
  const cam = sun.shadow.camera;
  cam.position.copy(sun.position);
  cam.lookAt(c);
  cam.updateMatrixWorld();
  const toLight = cam.matrixWorld.clone().invert(), b = new THREE.Box3(), p = V3();
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? hallBox.max.x : hallBox.min.x, i & 2 ? hallBox.max.y : hallBox.min.y, i & 4 ? hallBox.max.z : hallBox.min.z);
    b.expandByPoint(p.applyMatrix4(toLight));
  }
  Object.assign(cam, { left: b.min.x, right: b.max.x, bottom: b.min.y, top: b.max.y, near: -b.max.z - 1, far: -b.min.z + 1 });
  cam.updateProjectionMatrix();
  redrawShadows();
}

const ORBIT_FOV = 50;                              // degrees (vertical)
const WALK_FOV = { min: 30, max: 100, start: 60 }; // walk mode: a bit wider than orbit; the mouse wheel zooms
let walkFov = WALK_FOV.start;                      // kept between walks
const camera = new THREE.PerspectiveCamera(ORBIT_FOV, 1, 0.05, 800);
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

// video capture state (see "video capture"): resize() frames the view to the video's shape
const VIDEO = { shape: '16:9', size: 1080, fps: 30, speed: 'normal' };
const VIDEO_SHAPES = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 };
const video = { on: false, phase: 'edit', keys: [], play: null, path: null, saved: null, cancel: false, muxer: null };
function resize() {
  let w = stage.clientWidth, h = stage.clientHeight;
  labelRenderer.setSize(w, h);
  const a = video.on ? VIDEO_SHAPES[VIDEO.shape] || 16 / 9 : 0;   // video mode: frame to the video's shape
  if (a) {
    if (w / h > a) w = Math.max(1, Math.round(h * a)); else h = Math.max(1, Math.round(w / a));
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  } else canvas.style.width = canvas.style.height = '';
  stage.classList.toggle('framed', !!a);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

// ------------------------------------------------------------------ state
const state = {
  shading: 'material',
  tint: { on: false, strength: 0.6, colours: {} },
  shadows: (() => { try { return localStorage.getItem('b10-shadows') !== '0'; } catch { return true; } })(),
  walking: false,
  loading: true,     // no rendering until the models are in and their shaders are built
  exporting: false,  // a photo is being rendered (the render loop pauses)
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
  fitShadow();

  for (const l of man.layers) userVisible[l.id] = l.visible !== false;

  buildUI();
  goTo(poses.overview(), 0);

  // Download every part one after another (so the label can say what is coming in), and build
  // each one's shaders and textures while the next downloads. The loading screen stays up
  // until all of it is ready, so the hall opens complete and without stutters.
  const list = [...man.layers].sort((a, b) => a.bytes - b.bytes);
  const total = list.reduce((s, l) => s + l.bytes, 0);
  let doneBytes = 0;
  const bar = (f, entry) => {
    const pct = Math.min(100, ((doneBytes + f * entry.bytes) / total) * 100);
    $('#load-progress').style.width = `${pct.toFixed(1)}%`;
    $('#load-pct').textContent = `${Math.floor(pct)}%`;
  };
  const preparing = [];
  for (const entry of list) {
    $('#load-detail').textContent = `Loading ${entry.label}`;
    const ok = await loadLayer(entry, (f) => bar(f, entry));
    doneBytes += entry.bytes;
    if (ok) preparing.push(prepareLayer(layers[entry.id]));
  }
  $('#load-detail').textContent = 'Almost ready';
  await Promise.all(preparing);
  addEntranceArrow();
  addGround();

  fitCutaway();
  refreshMaterials();
  applyVisibility();
  updateCutaway(1);
  renderer.render(scene, camera);   // first frame (incl. the shadow map) while the loading screen is still up
  state.loading = false;
  $('#loading').classList.add('done');
  setTimeout(() => { $('#loading').hidden = true; }, 1200);   // stop its animations once it's gone
  if (location.hash) applyHash();
  try { if (!localStorage.getItem('b10-help-seen')) { $('#help').showModal(); localStorage.setItem('b10-help-seen', '1'); } } catch { /* storage blocked */ }
}

// An endless grid ground for the hall to stand on: 1 m lines near the hall, 5 m lines further
// out, fading into the background colour towards the horizon.
function addGround() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      base: { value: new THREE.Color('#8b92a1') }, minor: { value: new THREE.Color('#7f8696') },
      major: { value: new THREE.Color('#6f7687') }, bg: { value: scene.background },
      centre: { value: hallBox.getCenter(V3()) },
    },
    vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `
      uniform vec3 base, minor, major, bg, centre; varying vec3 vW;
      float grid(vec2 p, float s) {            // anti-aliased lines, 1 pixel wide at any distance
        vec2 q = p / s; vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main() {
        float d = distance(vW.xz, centre.xz);
        vec3 c = base;
        c = mix(c, minor, grid(vW.xz, 1.0) * (1.0 - smoothstep(25.0, 90.0, d)));
        c = mix(c, major, grid(vW.xz, 5.0) * (1.0 - smoothstep(120.0, 260.0, d)));
        c = mix(c, bg, smoothstep(70.0, 380.0, d));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2), mat);
  ground.name = 'Ground';
  ground.position.set(hallBox.getCenter(V3()).x, hallBox.min.y - 0.03, hallBox.getCenter(V3()).z);
  ground.renderOrder = -1;
  scene.add(ground);
}

// Red arrow painted on the floor at the entrance (the +Z side, where the Entrance view starts),
// pointing into the hall. Part of the zone guides, so it shows and hides with them.
function addEntranceArrow() {
  const L = 3.4, shaft = 0.5, head = 1.3, headLen = 1.1;   // metres
  const s = new THREE.Shape();
  s.moveTo(-shaft / 2, 0); s.lineTo(shaft / 2, 0); s.lineTo(shaft / 2, L - headLen); s.lineTo(head / 2, L - headLen);
  s.lineTo(0, L); s.lineTo(-head / 2, L - headLen); s.lineTo(-shaft / 2, L - headLen); s.closePath();
  const geo = new THREE.ShapeGeometry(s);
  geo.rotateX(-Math.PI / 2);                                // lie flat; the tip points to -Z (into the hall)
  const mat = new THREE.MeshBasicMaterial({
    color: '#E60028', side: THREE.DoubleSide, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,   // sit cleanly on the floor / guides
  });
  const arrow = new THREE.Mesh(geo, mat);
  arrow.name = 'EntranceArrow';
  arrow.position.set((walkBox.min.x + walkBox.max.x) / 2, floorY + 0.02, walkBox.max.z + 0.4);
  (layers.guides?.group ?? scene).add(arrow);
}

function loadLayer(entry, onProgress) {
  return new Promise((resolve) => {
    loader.load(`${entry.file}?v=${man.version}`, (gltf) => {
      onProgress?.(1);
      addLayer(entry, gltf.scene);
      resolve(true);
    }, (e) => onProgress?.(Math.min(0.99, e.loaded / entry.bytes)),
    (err) => { console.error(entry.file, err); resolve(false); });
  });
}

// Get a layer ready to draw: build its shaders and upload its textures, then show it.
// Left to the first render, the shaders compile one after another and freeze the page for
// several seconds; compileAsync lets the browser compile them in parallel in the background.
// Hidden layers (the roof) are included so entering walk mode doesn't stall either.
const offscreenRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
async function prepareLayer(l) {
  const g = l.group;
  g.visible = true;
  const myGhosts = ghosts.filter((m) => m.parent === g);
  myGhosts.forEach((m) => { m.visible = true; });   // build the cutaway's see-through shaders too
  const compiled = [renderer.compileAsync(g, camera, scene)];
  // glass ("transmission") materials make three.js also draw the scene into an offscreen
  // buffer, which uses its own shader variants: build those now too
  renderer.setRenderTarget(offscreenRT);
  compiled.push(renderer.compileAsync(g, camera, scene));
  // ...where two-sided glass is first drawn back faces only
  const glass = [];
  g.traverse((o) => { if (o.material?.transmission > 0 && o.material.side === THREE.DoubleSide) glass.push(o.material); });
  if (glass.length) {
    glass.forEach((m) => { m.side = THREE.BackSide; m.needsUpdate = true; });
    compiled.push(renderer.compileAsync(g, camera, scene));
    glass.forEach((m) => { m.side = THREE.DoubleSide; m.needsUpdate = true; });
  }
  renderer.setRenderTarget(null);
  g.visible = false;                // compileAsync has already collected the objects
  myGhosts.forEach((m) => { m.visible = false; });
  const textures = new Set();
  g.traverse((o) => {
    for (const m of [].concat(o.material || [])) for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
  });
  let slice = performance.now();
  for (const t of textures) {
    renderer.initTexture(t);
    if (performance.now() - slice > 50) { await new Promise((r) => setTimeout(r)); slice = performance.now(); }
  }
  await Promise.all(compiled.map((p) => p.catch((e) => console.warn('shader precompile', e))));
  l.ready = true;
  if (state.shading === 'solid') refreshMaterials();
  applyVisibility();
  if (l.entry.zone) { placeLabel(l.entry.zone); warmUpBlocks([l]); }
}

function fail(msg) {
  $('#loading').classList.add('error');
  $('#load-pct').textContent = '';
  $('#load-detail').textContent = `Something went wrong: ${msg}`;
}

// ------------------------------------------------------------------ cutaway
// In orbit views, any part of the hall structure (walls, columns, beams) or grandstands that sits between the camera and
// the exhibition area fades out, so it never hides the stands. It is worked out per pixel in the shaders:
// a surface fades when the line from the camera through it goes on into the exhibits' box. Each hall
// mesh is drawn twice: solid (skipping faded pixels) and as a see-through "ghost" (only faded pixels).
const CUT_LAYERS = new Set(['building', 'seating']);   // hall structure and grandstands
const CUT_ALPHA = 0.14;                          // how much of a faded wall is left
const cut = {
  on: { value: 0 },                              // 0 = off (walk mode), 1 = on; eased in the render loop
  min: { value: V3() }, max: { value: V3() },     // the exhibits' box (set once everything has loaded)
  alpha: { value: CUT_ALPHA },
};
const ghosts = [];
const CUT_GLSL = /* glsl */`
  uniform float uCutOn; uniform vec3 uCutMin; uniform vec3 uCutMax; uniform float uCutAlpha;
  varying vec3 vCutPos;
  float cutAmount(vec3 p) {
    if (uCutOn <= 0.0) return 0.0;
    vec3 d = p - cameraPosition;
    float tp = length(d);
    d /= tp;
    vec3 inv = 1.0 / mix(vec3(1e-5), d, step(1e-5, abs(d)));
    vec3 t0 = (uCutMin - cameraPosition) * inv, t1 = (uCutMax - cameraPosition) * inv;
    vec3 a = min(t0, t1), b = max(t0, t1);
    float tn = max(max(a.x, a.y), a.z), tf = min(min(b.x, b.y), b.z);
    if (tf <= tn || tn <= tp) return 0.0;          // the view through this point misses the exhibits, or it is behind them
    // soft edges: rays that only clip a corner of the box, or surfaces right at its boundary, fade less
    return uCutOn * smoothstep(0.0, 2.5, tf - tn) * smoothstep(0.0, 0.4, tn - tp);
  }
`;
function cutPatch(mat, ghost) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uCutOn = cut.on; sh.uniforms.uCutMin = cut.min; sh.uniforms.uCutMax = cut.max; sh.uniforms.uCutAlpha = cut.alpha;
    sh.vertexShader = 'varying vec3 vCutPos;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n  vCutPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = CUT_GLSL + sh.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  float cutF = cutAmount(vCutPos);
  if (${ghost ? 'cutF <= 0.002' : 'cutF > 0.002'}) discard;`)
      .replace('#include <opaque_fragment>', ghost
        ? '#include <opaque_fragment>\n  gl_FragColor.a *= mix(1.0, uCutAlpha, cutF);'
        : '#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => (ghost ? 'cut-ghost' : 'cut-solid');
  mat.userData.cut = true;
  mat.needsUpdate = true;
  return mat;
}
const cuttable = (mat) => !(mat.transmission > 0);   // glass is see-through already
// Ghosts are drawn in two steps so that only the nearest faded surface shows at each pixel (rows of seats
// or layered wall panels would otherwise stack into a milky haze): first depth only, then colour.
const ghostCache = new Map();
function ghostOf(mat, depthOnly) {
  const key = `${mat.uuid}|${depthOnly ? 'd' : 'c'}`;
  if (!ghostCache.has(key)) {
    const g = cutPatch(mat.clone(), true);
    g.transparent = true;
    g.depthWrite = depthOnly;
    g.colorWrite = !depthOnly;
    ghostCache.set(key, g);
  }
  return ghostCache.get(key);
}
function disposeGhosts(mat) {
  for (const k of ['d', 'c']) { ghostCache.get(`${mat.uuid}|${k}`)?.dispose(); ghostCache.delete(`${mat.uuid}|${k}`); }
}
// cutaway meshes: the solid version skips faded pixels; ghost twins draw them see-through
function setHallMaterial(mesh, mat) {
  const ok = cuttable(mat);
  if (ok && !mat.userData.cut) cutPatch(mat, false);
  mesh.material = mat;
  for (const [ghost, depthOnly] of [[mesh.userData.ghostDepth, true], [mesh.userData.ghost, false]]) {
    if (!ghost) continue;
    ghost.material = ok ? ghostOf(mat, depthOnly) : mat;
    ghost.userData.off = !ok;
  }
}
// the exhibits' box: the three school zones, from just above the floor to the top of the tallest stand
function fitCutaway() {
  const box = new THREE.Box3();
  for (const z of Object.values(zones)) box.union(z.box);
  let top = floorY + 2.5;
  for (const l of Object.values(layers)) if (l.entry.zone) top = Math.max(top, new THREE.Box3().setFromObject(l.group).max.y);
  box.min.y = floorY + 0.05;
  box.max.y = Math.min(top, hallBox.max.y - 0.3);
  cut.min.value.copy(box.min); cut.max.value.copy(box.max);
}
function updateCutaway(dt) {
  const target = state.walking ? 0 : 1;
  const v = cut.on.value + (target - cut.on.value) * Math.min(1, dt * 6);
  cut.on.value = Math.abs(v - target) < 0.002 ? target : v;
  for (const g of ghosts) g.visible = cut.on.value > 0 && !g.userData.off;
}

// Merge each layer's meshes by material: thousands of SketchUp parts become a few hundred draw calls.
function addLayer(entry, root) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    // SketchUp-style models have inward-facing faces: show both sides. Except materials tagged
    // "[1-sided]": SketchUp faces painted differently on each side arrive as two overlapping
    // one-sided copies, which would flicker against each other if both were drawn two-sided.
    o.material.side = o.material.name?.includes('[1-sided]') ? THREE.FrontSide : THREE.DoubleSide;
    if (o.material.name === FLOOR_MAT && !o.material.userData.keepColour) {   // showcase floor
      o.material.color.set(FLOOR_COLOUR);
      o.material.roughness = 0.75; o.material.metalness = 0;
      o.material.userData.keepColour = true;        // same in Solid mode
    }
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
      // exhibits and seating cast shadows; the hall shell only receives them (its tall walls
      // would otherwise throw half the floor into shade) and the roof does neither
      mesh.castShadow = Boolean(entry.zone) || entry.id === 'seating';
      mesh.receiveShadow = entry.id !== ROOF;
      if (blockOf) {                                  // which triangles of this mesh belong to which block
        let start = 0;
        for (let i = from; i < to; i++) {
          const n = tris(geos[i]), id = blockOf(parts[i]);
          (blocks[id].pieces ||= []).push({ mesh, start, end: start + n });
          start += n;
        }
      }
      group.add(mesh);
      meshes.push(mesh);
      if (CUT_LAYERS.has(entry.id)) {                 // see "cutaway"
        for (const [key, order] of [['ghostDepth', 2], ['ghost', 3]]) {   // drawn after the other see-through things
          const ghost = new THREE.Mesh(g, material);
          ghost.matrixAutoUpdate = false;
          ghost.receiveShadow = true;
          ghost.renderOrder = order;
          ghost.visible = false;
          mesh.userData[key] = ghost;
          group.add(ghost);
          ghosts.push(ghost);
        }
        setHallMaterial(mesh, material);
      }
    }
    if (merged && geos.length > 1) geos.forEach((g) => g.dispose());
  }
  if (blockOf) mergeSmallBlocks(blocks);
  scene.add(group);
  layers[entry.id] = { entry, group, meshes, blocks };
  if (entry.zone) placeLabel(entry.zone);
  if (entry.id === 'guides') {
    // tag each guide mesh with its school (materials are named ZoneFill_<SHORT> / ZoneBorder_<SHORT>)
    for (const m of meshes) {
      const z = man.zones.find((x) => (m.material.name || '').endsWith(`_${x.short}`));
      if (!z) continue;
      m.userData.zoneId = z.id; m.userData.fill = /Fill/.test(m.material.name);
      // vivid school colours on the darker floor
      if (m.userData.fill) { m.material.color.set(z.colour).offsetHSL(0, 0.25, 0.02); m.material.opacity = 0.3; }
      else m.material.color.set(z.colour).offsetHSL(0, 0.25, 0.08);
      m.userData.baseOpacity = m.material.opacity;
    }
  }
  applyVisibility();
}

const BLOCK_MAX = 8;   // metres: anything bigger is a whole zone / row, not one stand
// Click-to-focus is for installations, not their components: a block smaller than SMALL_BLOCK
// (a phone, laptop or screen on a table, a stool beside a counter, a light on a wall) joins the
// bigger block it touches or nearly touches, as long as the result still fits within BLOCK_MAX -
// or barely grows the bigger block (lights on a 9.6 m back wall). Smallest first, so chains collapse.
const SMALL_BLOCK = 1.2, BLOCK_TOUCH = 0.3;   // metres: small pieces within 30 cm of a bigger block join it
function mergeSmallBlocks(blocks) {
  const sizeOf = (b) => { const s = b.box.getSize(V3()); return Math.max(s.x, s.y, s.z); };
  const alive = new Set(blocks.keys());
  const order = [...blocks.keys()].sort((a, c) => sizeOf(blocks[a]) - sizeOf(blocks[c]));
  for (const i of order) {
    const s = blocks[i];
    if (!alive.has(i) || !s.pieces || sizeOf(s) >= SMALL_BLOCK) continue;
    const grown = s.box.clone().expandByScalar(BLOCK_TOUCH);
    let best = -1, bestScore = -1;
    for (const j of alive) {
      const t = blocks[j];
      if (j === i || !t.pieces || sizeOf(t) <= sizeOf(s) || !grown.intersectsBox(t.box)) continue;
      const u = t.box.clone().union(s.box).getSize(V3()), us = Math.max(u.x, u.y, u.z);
      if (us > BLOCK_MAX && us > sizeOf(t) * 1.02) continue;
      const o = grown.clone().intersect(t.box).getSize(V3());
      const score = o.x * o.y * o.z + sizeOf(t) * 1e-6;          // most contact; ties: the bigger block
      if (score > bestScore) { best = j; bestScore = score; }
    }
    if (best < 0) continue;
    const t = blocks[best];
    t.pieces.push(...s.pieces);
    t.box.union(s.box);
    alive.delete(i);
  }
  const keep = blocks.filter((_, i) => alive.has(i));
  blocks.length = 0; blocks.push(...keep);
}
function makeBlockFinder(root, blocks) {
  const boxCache = new Map(), idOf = new Map();
  const boxOf = (n) => {
    if (!boxCache.has(n)) boxCache.set(n, new THREE.Box3().setFromObject(n));
    return boxCache.get(n);
  };
  const fits = (n) => { const s = boxOf(n).getSize(V3()); return Math.max(s.x, s.y, s.z) <= BLOCK_MAX; };
  return (part) => {
    // the build marks hand-made blocks ("SCD_block_003", "TBS_block_02_005"): use those as they are
    let node = part;
    for (let n = part; n && n !== root; n = n.parent) if (/_block_\d+/.test(n.name)) { node = n; break; }
    if (node === part) while (node.parent && node.parent !== root && fits(node.parent)) node = node.parent;
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
    if (!l.ready) l.group.visible = false;          // still being prepared
    else if (id === ROOF) l.group.visible = state.walking;
    else if (USER_LAYERS.has(id)) l.group.visible = userVisible[id] !== false;
    else l.group.visible = true;
  }
  for (const [zid, obj] of Object.entries(labelObjs)) {
    const l = man.layers.find((x) => String(x.zone) === String(zid));
    obj.visible = !l || userVisible[l.id] !== false;
  }
  redrawShadows();
}

// ------------------------------------------------------------------ materials: solid / tint
// Tint applies in Solid mode only, and only to school models (never the zone guides).
const matCache = new Map();
function clearMatCache() {
  for (const m of matCache.values()) { m.dispose(); disposeGhosts(m); }
  matCache.clear();
}

function tintFor(layerId) {
  const z = layers[layerId]?.entry.zone;
  return state.tint.on && state.shading === 'solid' && z ? new THREE.Color(state.tint.colours[z]) : null;
}

function solidMaterial(orig, tint) {
  const key = `solid|${orig.uuid}|${tint ? tint.getHexString() : '-'}|${state.tint.strength}`;
  if (!matCache.has(key)) {
    const colour = orig.userData.keepColour ? orig.color.clone()
      : tint ? SOLID_GREY.clone().lerp(tint, state.tint.strength) : SOLID_GREY.clone();
    let m;
    if (orig.alphaTest > 0 && orig.map) {           // keep cut-outs (e.g. perforated plating)
      m = orig.clone(); m.color.copy(colour); m.metalness = 0; m.roughness = 0.85;
      delete m.userData.cut;                        // the copy needs its own cutaway shader (it isn't copied)
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
      const mat = state.shading === 'solid' ? solidMaterial(orig, tint) : orig;
      if (mesh.userData.ghost) setHallMaterial(mesh, mat);
      else mesh.material = mat;
    }
  }
  scene.environmentIntensity = state.shading === 'solid' ? ENV.solid : ENV.material;
  applyShadows();
}

// Shadows on/off (both shading modes). Fading the shadow out instead of switching shadow casting
// off avoids recompiling every material, so the toggle is instant.
function applyShadows() {
  sun.shadow.intensity = state.shadows ? SHADOW_STRENGTH : 0;
  const b = $('#btn-shadows');
  if (b) { b.classList.toggle('active', state.shadows); b.setAttribute('aria-pressed', String(state.shadows)); }
}
function setShadows(on) {
  state.shadows = on;
  try { localStorage.setItem('b10-shadows', on ? '1' : '0'); } catch { /* storage blocked */ }
  applyShadows();
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
// OrbitControls keeps easing out a recent drag (damping). It isn't updated during a flight, so that
// leftover motion would be applied in one go when the flight ends and nudge the camera off its pose.
function stopOrbitMomentum() {
  controls._sphericalDelta?.set(0, 0, 0);
  controls._panOffset?.set(0, 0, 0);
  if ('_scale' in controls) controls._scale = 1;
}
// Bring an orbit pose inside the limits clampOrbit() enforces every frame, so a flight ends exactly
// where the camera will stay (otherwise e.g. the Overview, framed from farther out than the camera
// box allows, snapped ~3 m closer on the first frame after landing). The camera is pulled in along
// its line of sight, so the view direction doesn't change.
function fitPoseToLimits(pose) {
  if (pose.walk || !walkBox || !camBox) return pose;
  const target = pose.target.clone();
  target.x = THREE.MathUtils.clamp(target.x, walkBox.min.x, walkBox.max.x);
  target.z = THREE.MathUtils.clamp(target.z, walkBox.min.z, walkBox.max.z);
  target.y = THREE.MathUtils.clamp(target.y, floorY - 0.5, floorY + 12);
  const pos = pose.pos.clone().add(target.clone().sub(pose.target));
  if (!camBox.containsPoint(pos)) {
    const off = pos.clone().sub(target);
    let lo = 0, hi = 1;                               // largest fraction of the offset that stays inside
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (camBox.containsPoint(target.clone().addScaledVector(off, mid))) lo = mid; else hi = mid;
    }
    pos.copy(target).addScaledVector(off, lo);
    if (!camBox.containsPoint(pos)) camBox.clampPoint(pos, pos);
  }
  return { ...pose, pos, target };
}
function goTo(pose, dur = 1.3, after) {
  if (state.walking && !pose.walk) exitWalk(false);
  stopOrbitMomentum();
  pose = fitPoseToLimits(pose);
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
  setFov(walkFov);
  camera.position.y = floorY + EYE;
  clampWalk(camera.position);
  stage.classList.add('walking');
  $('#btn-walk').classList.add('active');
  applyVisibility();            // roof on
  updateWalkHint();
  buildNavpad();
  history.replaceState(null, '', '#walk');
}
function setFov(deg) {
  camera.fov = deg;
  camera.updateProjectionMatrix();
}
// walk mode: zoom by narrowing / widening the field of view (wheel up = zoom in)
function zoomWalkFov(stepDeg) {
  walkFov = THREE.MathUtils.clamp(walkFov + stepDeg, WALK_FOV.min, WALK_FOV.max);
  setFov(walkFov);
}
function exitWalk(reframe = true) {
  if (!state.walking) return;
  if (video.on) endVideo();
  state.walking = false;
  walk.target = null; marker.visible = false; walk.keys.clear();
  if (isLocked()) document.exitPointerLock();
  setFov(ORBIT_FOV);                // before reframing: the orbit poses are fitted with this FOV
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
  if (k.has('KeyD') || k.has('ArrowRight')) move.add(right);   // arrows work exactly like WASD
  if (k.has('KeyA') || k.has('ArrowLeft')) move.sub(right);
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
  hint.hidden = !!state.tour || video.on;
  $('#crosshair').hidden = !isLocked();
  if (video.on) updateVideoHud();
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
  if (video.play || state.exporting) return;
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
    return id;                                               // always: even when already zoomed in on it
  }
  return null;
}
function setHoverZone(id) {
  if (id === hoverZone) return;
  hoverZone = id;
  stage.classList.toggle('zone-hover', !!(hoverZone || hoverBlock));
  for (const m of layers.guides?.meshes ?? []) {
    if (m.userData.fill) m.material.opacity = m.userData.zoneId === id ? Math.min(0.65, m.userData.baseOpacity * 2.2) : m.userData.baseOpacity;
  }
  for (const [zid, obj] of Object.entries(labelObjs)) obj.element.classList.toggle('hot', String(zid) === String(id));
}
canvas.addEventListener('pointerdown', (e) => {
  if (!state.walking && e.button === 0) downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener('pointermove', (e) => {
  if (state.walking || state.tour || state.fly || e.buttons) { setHoverZone(null); setHoverBlock(null); return; }
  if (e.pointerType !== 'mouse' || hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    const blk = blockAt(e.clientX, e.clientY, { readyOnly: true })?.block || null;
    setHoverBlock(blk);                                   // over a stand: outline the stand
    setHoverZone(blk ? null : zoneAt(e.clientX, e.clientY));   // over open floor: highlight the zone
  });
});
canvas.addEventListener('pointerleave', () => { setHoverZone(null); setHoverBlock(null); });
canvas.addEventListener('pointerup', (e) => {
  if (state.walking || !downAt) return;
  const d = downAt; downAt = null;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || performance.now() - d.t > 450) return;   // was a drag
  // a stand under the cursor wins; open zone floor takes you to that school
  const blk = blockAt(e.clientX, e.clientY);
  if (blk) { focusBlock(blk); return; }
  const id = zoneAt(e.clientX, e.clientY);
  if (id) { setHoverZone(null); go(`zone${id}`); }
});

// ---- per-stand picking, hover outline and click-to-focus
// Picking tests the ray against each stand's bounding box first (cheap), then only against the
// real triangles of the few stands the ray passes through, nearest first.
function blockGeometry(blk) {                          // a stand's own triangles, extracted on demand
  if (blk.geo) return blk.geo;
  let n = 0;
  for (const p of blk.pieces) n += (p.end - p.start) * 9;
  const out = new Float32Array(n); let o = 0;
  for (const { mesh, start, end } of blk.pieces) {
    const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index;
    for (let t = start; t < end; t++) {
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
        out[o++] = pos.getX(vi); out[o++] = pos.getY(vi); out[o++] = pos.getZ(vi);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.computeBoundingSphere();
  g.boundsTree = new MeshBVH(g);                       // spatial index: ray tests in well under 1 ms
  blk.geo = g;
  return g;
}
// prepare every stand's pick data (triangles + BVH) a few at a time after loading, so the
// first hover on a heavy stand doesn't stutter
function warmUpBlocks(list = Object.values(layers)) {
  const all = list.filter((l) => l.entry.zone).flatMap((l) => l.blocks.filter((b) => b.pieces));
  const queue = all.map((b) => () => blockGeometry(b));
  const step = (deadline) => {
    const until = performance.now() + 8;
    while (queue.length && (deadline?.timeRemaining ? deadline.timeRemaining() > 2 : performance.now() < until)) queue.shift()();
    if (queue.length) schedule();
  };
  const schedule = () => (window.requestIdleCallback ? requestIdleCallback(step, { timeout: 500 }) : setTimeout(step, 30));
  schedule();
}
const pickMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
pickMesh.updateMatrixWorld();
pickMesh.raycast = acceleratedRaycast;                 // uses each stand's BVH
raycaster.firstHitOnly = true;
const _hitPt = new THREE.Vector3();
function blockAt(clientX, clientY, { readyOnly = false } = {}) {   // readyOnly: hover never waits on prep
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
  const cands = [];
  for (const l of Object.values(layers)) {
    if (!l.entry.zone || !l.group.visible) continue;
    for (const b of l.blocks) {
      if (b.pieces && (!readyOnly || b.geo) && raycaster.ray.intersectBox(b.box, _hitPt)) cands.push({ b, zone: l.entry.zone, d: _hitPt.distanceTo(raycaster.ray.origin) });
    }
  }
  cands.sort((a, c) => a.d - c.d);
  let best = null;
  for (const c of cands) {
    if (best && c.d > best.dist) break;                // this box starts beyond the best hit: done
    pickMesh.geometry = blockGeometry(c.b);
    const h = raycaster.intersectObject(pickMesh, false)[0];
    if (h && (!best || h.distance < best.dist)) best = { block: c.b, zone: c.zone, dist: h.distance };
  }
  return best;
}

// hover: a subtle outline around the stand's silhouette - a thin white line with a faint dark
// edge outside it, so it reads on light and dark surfaces alike. Screen-space, like Blender's
// selection outline: draw the stand flat into a mask, then one full-screen pass paints the
// pixels just outside it. Cost doesn't depend on how detailed the stand is.
const OUTLINE_PX = 1.5;
const maskRT = new THREE.WebGLRenderTarget(1, 1);
const maskScene = new THREE.Scene();
const maskMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
maskMesh.frustumCulled = false;
maskScene.add(maskMesh);
const outlineQuad = new FullScreenQuad(new THREE.ShaderMaterial({
  uniforms: { tMask: { value: maskRT.texture }, texel: { value: new THREE.Vector2() }, radius: { value: 1.5 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tMask; uniform vec2 texel; uniform float radius; varying vec2 vUv;
    float ring(float r) {                       // is there mask within r pixels?
      float m = 0.0;
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 0.5235988;
        m = max(m, texture2D(tMask, vUv + vec2(cos(a), sin(a)) * texel * r).r);
      }
      return m;
    }
    void main() {
      float inside = texture2D(tMask, vUv).r;
      if (inside > 0.5) discard;
      float line = max(ring(radius), ring(radius * 0.5));   // thin line hugging the silhouette
      float halo = ring(radius * 2.2);                      // faint dark edge just outside it
      if (line > 0.02) gl_FragColor = vec4(1.0, 1.0, 1.0, 0.85 * line);
      else if (halo > 0.02) gl_FragColor = vec4(0.04, 0.04, 0.1, 0.22 * halo);
      else discard;
      #include <colorspace_fragment>
    }`,
  transparent: true, depthTest: false, depthWrite: false,
}));
function sizeOutline() {
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  maskRT.setSize(s.x, s.y);
  outlineQuad.material.uniforms.texel.value.set(1 / s.x, 1 / s.y);
  outlineQuad.material.uniforms.radius.value = OUTLINE_PX * renderer.getPixelRatio();
}
new ResizeObserver(sizeOutline).observe(stage);
sizeOutline();
function renderOutline() {
  if (!hoverBlock?.geo) return;
  maskMesh.geometry = hoverBlock.geo;
  const clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha(), auto = renderer.autoClear;
  renderer.setRenderTarget(maskRT);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(maskScene, camera);
  renderer.setRenderTarget(null);
  renderer.setClearColor(clear, alpha);
  renderer.autoClear = false;
  outlineQuad.render(renderer);
  renderer.autoClear = auto;
}
let hoverBlock = null;
function setHoverBlock(blk) {
  if (blk === hoverBlock) return;
  hoverBlock = blk;
  stage.classList.toggle('zone-hover', !!(hoverZone || hoverBlock));
}
function focusBlock(sel) {
  const blk = sel.block;
  stopTour();
  closePopovers();
  setActivePreset(null);
  setHoverBlock(null);
  const centre = blk.box.getCenter(V3());
  const size = blk.box.getSize(V3());
  const span = Math.max(size.x, size.z, size.y * 1.4, 1.2);
  // keep looking from the current side, a little above the stand
  const off = camera.position.clone().sub(centre);
  const az = THREE.MathUtils.radToDeg(Math.atan2(off.x, off.z));
  const target = centre.clone().setY(Math.max(floorY + 0.6, centre.y));
  goTo(orbitPose(target, span * 1.6, 32, az));
}

// ---- wheel / trackpad (handled here instead of OrbitControls, which treats every
// two-finger swipe as zoom). Orbit: mouse wheel and pinch zoom, two-finger swipe moves around,
// Safari's twist gesture rotates. Walk: the mouse wheel zooms (field of view); a trackpad swipe walks and turns.
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
  if (state.fly || video.play || state.exporting) return;
  const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
  const dx = e.deltaX * px, dy = e.deltaY * px;
  if (state.walking && isMouseWheel(e)) { zoomWalkFov(Math.sign(dy) * 5); return; }   // mouse wheel: field of view
  if (state.walking) {                                       // trackpad swipe: walk and turn
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
  if (state.exporting) return;
  if (video.on && video.phase === 'review') {          // playing the path back: Enter renders, Esc goes back
    if (e.code === 'Escape') { e.preventDefault(); editPath(); }
    else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.target.closest('button, input, select')) { e.preventDefault(); renderVideo(); }
    return;
  }
  if (e.target.closest('input, textarea, dialog[open]')) return;
  if (video.on && state.walking && !e.repeat) {          // recording a path
    if (e.code === 'KeyK') { addKeyframe(); return; }
    if (e.code === 'Backspace' || e.code === 'Delete') { e.preventDefault(); undoKeyframe(); return; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); finishPath(); return; }
  }
  if (e.code === 'Escape' && closePopovers()) return;
  if (state.tour) stopTour();
  if (state.walking) {
    // the first Esc only frees the mouse (handled by the browser); a second Esc exits walk mode
    if (e.code === 'Escape') { if (!isLocked() && performance.now() - lastUnlock > 400) exitWalk(); return; }
    walk.keys.add(e.code);
    if (e.code.startsWith('Arrow')) e.preventDefault();
  }
  const map = { Digit1: 'zone1', Digit2: 'zone2', Digit3: 'zone3', Numpad1: 'zone1', Numpad2: 'zone2', Numpad3: 'zone3' };   // SSET, SCD, TBS
  if (map[e.code]) go(map[e.code]);
  // outside walk mode: Esc goes back to the overview, Space to the top-down view
  if (!state.walking && e.code === 'Escape') go('overview');
  if (!state.walking && e.code === 'Space' && !e.target.closest('button, a, select')) { e.preventDefault(); go('top'); }
  if (e.key === '+' || e.key === '=') { if (state.walking) zoomWalkFov(-5); else flyForward(1); }
  if (e.key === '-' || e.key === '_') { if (state.walking) zoomWalkFov(5); else flyForward(-1); }
  if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) toggleWalk();
  if (e.code === 'KeyV' && !e.ctrlKey && !e.metaKey && !e.repeat) toggleVideo();
  if (e.code === 'KeyL') setShadows(!state.shadows);
  if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey && !e.altKey) openPhoto();
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
    { id: 'overview', label: 'Overview', ico: 'home', tip: 'Overview of the hall (Esc)' },
    { id: 'top', label: 'Top', ico: 'top', tip: 'Top-down floor plan (Space)' },
    ...man.zones.map((z, i) => ({ id: `zone${z.id}`, label: z.short, zone: z, tip: `${z.short} (${i + 1})` })),
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
    togglePopover(popovers[1]);
  });
  $('#tour-stop').addEventListener('click', () => { stopTour(); controls.update(); });

  // top-right actions
  $('#btn-layers').addEventListener('click', () => togglePopover(popovers[0]));
  $$('[data-close]').forEach((b) => b.addEventListener('click', closePopovers));
  $('#btn-help').addEventListener('click', () => { closePopovers(); $('#help').showModal(); });
  setupPhoto();
  setupVideo();
  $('#btn-shadows').addEventListener('click', () => setShadows(!state.shadows));
  applyShadows();
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
  $('#opt-labels').checked = false;                // browsers restore form state on reload; labels always start hidden
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

// ------------------------------------------------------------------ photo export
// Saves the current view (any mode, walk included) as an image up to 8x the on-screen size.
// Always at the highest quality: it is drawn through the same pipeline as the screen (tone
// mapping, shadows, glass, multisample anti-aliasing) at SSAA x the final resolution, in tiles,
// then scaled down. The screen canvas is used for the tiles (an offscreen target would skip the
// screen's tone mapping / colour conversion), hidden behind the dialog while it works.
// Labels, outlines and toolbars are HTML on top of the 3D view, so they are not in the photo.
const PHOTO = { scale: 2, format: 'png' };
const PHOTO_SSAA = 2;                       // supersampling: rendered at 2x, scaled down
const PHOTO_TILE = 2048;                    // tile size in device pixels
const PHOTO_MAX_SIDE = 16384, PHOTO_MAX_AREA = 120e6;   // what browsers can hold in one canvas
function photoSize(scale) {
  const w = stage.clientWidth * scale, h = stage.clientHeight * scale;
  const f = Math.min(1, PHOTO_MAX_SIDE / Math.max(w, h), Math.sqrt(PHOTO_MAX_AREA / (w * h)));
  return { w: Math.max(1, Math.floor(w * f)), h: Math.max(1, Math.floor(h * f)), capped: f < 1 };
}
function updatePhotoDialog() {
  for (const b of $$('#photo-scale button')) b.setAttribute('aria-checked', String(Number(b.dataset.scale) === PHOTO.scale));
  for (const b of $$('#photo-format button')) b.setAttribute('aria-checked', String(b.dataset.format === PHOTO.format));
  const { w, h, capped } = photoSize(PHOTO.scale);
  $('#photo-dims').textContent = `${w.toLocaleString()} × ${h.toLocaleString()} px` + (capped ? ' (the most this browser can save)' : '');
}
function openPhoto(tab = 'photo') {
  if (state.loading || state.exporting || $('#photo').open) return;
  if (isLocked()) document.exitPointerLock();
  walk.keys.clear();
  stopTour();
  closePopovers();
  updatePhotoDialog();
  setCaptureTab(tab);
  $('#photo-progress').hidden = true;
  $('#video-open-error').hidden = true;
  $('#photo').showModal();
}
function setCaptureTab(tab) {
  for (const b of $$('#cap-mode button')) b.setAttribute('aria-checked', String(b.dataset.mode === tab));
  $('#cap-photo').hidden = tab !== 'photo';
  $('#cap-video').hidden = tab !== 'video';
}
function setupPhoto() {
  try { const saved = JSON.parse(localStorage.getItem('b10-photo') || '{}'); Object.assign(PHOTO, saved); } catch { /* storage blocked */ }
  const remember = () => { try { localStorage.setItem('b10-photo', JSON.stringify(PHOTO)); } catch { /* ignore */ } };
  $('#btn-photo').addEventListener('click', () => openPhoto(video.on ? 'video' : 'photo'));
  for (const b of $$('#cap-mode button')) b.addEventListener('click', () => setCaptureTab(b.dataset.mode));
  for (const b of $$('#photo-scale button')) b.addEventListener('click', () => { PHOTO.scale = Number(b.dataset.scale); remember(); updatePhotoDialog(); });
  for (const b of $$('#photo-format button')) b.addEventListener('click', () => { PHOTO.format = b.dataset.format; remember(); updatePhotoDialog(); });
  $('#photo-cancel').addEventListener('click', () => { if (!state.exporting) $('#photo').close(); });
  $('#photo').addEventListener('cancel', (e) => { if (state.exporting) e.preventDefault(); });   // no Esc mid-render
  $('#photo-save').addEventListener('click', savePhoto);
}
const nextTask = () => new Promise((r) => setTimeout(r, 0));
async function savePhoto() {
  if (state.exporting) return;
  const dlg = $('#photo'), prog = $('#photo-progress');
  const { w, h } = photoSize(PHOTO.scale);
  const fullW = w * PHOTO_SSAA, fullH = h * PHOTO_SSAA, T = PHOTO_TILE;
  const cols = Math.ceil(fullW / T), rows = Math.ceil(fullH / T);
  state.exporting = true;
  dlg.classList.add('busy');
  prog.hidden = false;
  prog.textContent = 'Rendering…';
  await nextTask();
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const tile = document.createElement('canvas'); tile.width = T; tile.height = T;
  const tctx = tile.getContext('2d');
  const img = tctx.createImageData(T, T), buf = new Uint8Array(T * T * 4);
  const gl = renderer.getContext();
  const savedRatio = renderer.getPixelRatio(), savedAspect = camera.aspect;
  let error = null;
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(T, T, false);
    camera.aspect = fullW / fullH;
    let done = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        camera.setViewOffset(fullW, fullH, c * T, r * T, T, T);
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        gl.readPixels(0, 0, T, T, gl.RGBA, gl.UNSIGNED_BYTE, buf);    // same task as the draw: still there
        for (let y = 0; y < T; y++) img.data.set(buf.subarray((T - 1 - y) * T * 4, (T - y) * T * 4), y * T * 4);
        tctx.putImageData(img, 0, 0);
        ctx.drawImage(tile, (c * T) / PHOTO_SSAA, (r * T) / PHOTO_SSAA, T / PHOTO_SSAA, T / PHOTO_SSAA);
        done++;
        prog.textContent = `Rendering… ${Math.round((done / (rows * cols)) * 100)}%`;
        await nextTask();
      }
    }
  } catch (e) {
    error = e;
  } finally {
    camera.clearViewOffset();
    camera.aspect = savedAspect;
    renderer.setPixelRatio(savedRatio);
    resize();
    state.exporting = false;
  }
  if (!error) {
    prog.textContent = 'Saving…';
    await nextTask();
    const jpg = PHOTO.format === 'jpg';
    const blob = await new Promise((res) => out.toBlob(res, jpg ? 'image/jpeg' : 'image/png', jpg ? 0.95 : undefined));
    if (blob) {
      const view = (location.hash.slice(1) || 'view').replace(/[^\w-]+/g, '');
      const stamp = fileStamp();
      downloadBlob(blob, `B10-Showcase_${view}_${w}x${h}_${stamp}.${jpg ? 'jpg' : 'png'}`);
    } else error = new Error('the browser could not encode an image this large');
  }
  out.width = out.height = 0;                        // free the memory straight away
  dlg.classList.remove('busy');
  if (error) {
    console.error('photo export', error);
    prog.textContent = `Couldn't save the photo (${error.message || error}). Try a smaller size.`;
  } else {
    prog.hidden = true;
    dlg.close();
  }
}

function fileStamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// ------------------------------------------------------------------ video capture
// V: record a camera path in walk mode. Move to each view and press K to keyframe it (position,
// what's in the middle of the view, zoom). Enter saves the path as a .json file and plays it back
// smoothly; Render turns it into an MP4. The view is framed to the video's shape the whole time.
// Smoothing: positions and points of interest follow centripetal Catmull-Rom splines through the
// keyframes (no loops or overshoot), the zoom a Catmull-Rom curve; the camera always looks at the
// interpolated point of interest. Each stretch gets as long as its move, turn or zoom needs at the
// chosen speed, the pace inside it follows that effort evenly, and the pace between stretches
// blends smoothly (monotone cubic), easing in at the start and out at the end.
const MP4_MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs';
const VIDEO_SPEEDS = {                     // metres / second, degrees / second (turn and zoom)
  slow: { move: 0.8, turn: 16, zoom: 8 },
  normal: { move: 1.4, turn: 28, zoom: 14 },
  fast: { move: 2.6, turn: 46, zoom: 24 },
};
const PATH_HOLD = 0.6;                    // seconds held still on the first and last frame
const PATH_SAMPLES = 48;                  // effort samples per stretch
function videoAspect() { return video.on ? VIDEO_SHAPES[VIDEO.shape] || 16 / 9 : 0; }
function videoSize() {
  const a = VIDEO_SHAPES[VIDEO.shape] || 16 / 9, s = VIDEO.size;
  const even = (n) => Math.round(n / 2) * 2;
  return a >= 1 ? { w: even(s * a), h: s } : { w: s, h: even(s / a) };
}

function setupVideo() {
  try { Object.assign(VIDEO, JSON.parse(localStorage.getItem('b10-video') || '{}')); } catch { /* storage blocked */ }
  if (!VIDEO_SHAPES[VIDEO.shape]) VIDEO.shape = '16:9';
  const remember = () => { try { localStorage.setItem('b10-video', JSON.stringify(VIDEO)); } catch { /* ignore */ } };
  const groups = { shape: 'shape', size: 'size', fps: 'fps', speed: 'speed' };
  for (const [g, key] of Object.entries(groups)) {
    for (const b of $$(`[data-group=${g}] button`)) {
      b.addEventListener('click', () => {
        if (state.exporting) return;
        const v = b.dataset[key];
        VIDEO[key] = key === 'size' || key === 'fps' ? Number(v) : v;
        remember();
        if (key === 'shape') resize();
        if (key === 'speed' && video.play) replanPlayback();
        syncVideoUI();
      });
    }
  }
  $('#video-key').addEventListener('click', addKeyframe);
  $('#video-undo').addEventListener('click', undoKeyframe);
  $('#video-clear').addEventListener('click', () => { video.keys = []; updateTrail(); updateVideoHud(); });
  $('#video-done').addEventListener('click', finishPath);
  $('#video-exit').addEventListener('click', () => endVideo());
  $('#video-back').addEventListener('click', editPath);
  $('#video-render').addEventListener('click', renderVideo);
  $('#video-cancel').addEventListener('click', () => { video.cancel = true; });
  $('#video-start').addEventListener('click', () => { $('#photo').close(); startVideo(); });
  $('#video-open').addEventListener('click', () => $('#video-file').click());
  $('#video-file').addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    try {
      const keys = parsePath(JSON.parse(await f.text()));
      video.keys = keys;
      $('#photo').close();
      startVideo(true);
    } catch (err) {
      const el = $('#video-open-error'); el.hidden = false;
      el.textContent = `Couldn't open that file: ${err.message || err}`;
    }
  });
  syncVideoUI();
}
function syncVideoUI() {
  for (const b of $$('[data-group=shape] button')) b.setAttribute('aria-checked', String(b.dataset.shape === VIDEO.shape));
  for (const b of $$('[data-group=size] button')) b.setAttribute('aria-checked', String(Number(b.dataset.size) === VIDEO.size));
  for (const b of $$('[data-group=fps] button')) b.setAttribute('aria-checked', String(Number(b.dataset.fps) === VIDEO.fps));
  for (const b of $$('[data-group=speed] button')) b.setAttribute('aria-checked', String(b.dataset.speed === VIDEO.speed));
  const { w, h } = videoSize();
  $('#video-dims').textContent = `${w.toLocaleString()} × ${h.toLocaleString()} px · ${VIDEO.fps} fps · MP4`;
  if (video.path) $('#video-info').textContent = `${video.keys.length} keyframes · ${fmtTime(video.path.duration)}`;
}
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

// ---- recording
function toggleVideo() { if (video.on) endVideo(); else startVideo(); }
function startVideo(review = false) {
  if (state.loading || state.exporting) return;
  closePopovers(); stopTour();
  video.on = true; video.phase = 'edit';
  $('#videohud').hidden = false;
  document.body.classList.add('video-on');
  resize();
  updateTrail();
  updateVideoHud();
  updateWalkHint();
  const ready = () => { if (review && video.on) finishPath(false); };
  if (state.walking) ready();
  else {
    requestLook();
    setActivePreset(null);
    goTo(walkStartPose(), 1.0, () => { enterWalk(); ready(); });
  }
}
function endVideo() {
  if (!video.on || state.exporting) return;
  if (video.phase === 'review') editPath();
  video.on = false;
  $('#videohud').hidden = true;
  document.body.classList.remove('video-on');
  trail.visible = false;
  resize();
  updateWalkHint();
}
function updateVideoHud() {
  const n = video.keys.length;
  $('#video-count').textContent = n === 0
    ? (isTouch || isLocked() ? 'Move to the first view, press K' : 'Click the view to look around · K adds a keyframe')
    : `${n} keyframe${n === 1 ? '' : 's'}${n < 2 ? ' · add one more' : ' · Enter when done'}`;
  $('#video-undo').disabled = $('#video-clear').disabled = n === 0;
  $('#video-done').disabled = n < 2;
}
const _dir = new THREE.Vector3();
function addKeyframe() {
  if (!video.on || !state.walking || video.phase !== 'edit') return;
  camera.updateMatrixWorld();
  const dir = camera.getWorldDirection(V3());
  // the point of interest: whatever is in the middle of the view (a stand, else the floor)
  const r = canvas.getBoundingClientRect();
  let d = blockAt(r.left + r.width / 2, r.top + r.height / 2)?.dist;
  if (d == null) {
    floorPlane.constant = -floorY;
    const hit = new THREE.Ray(camera.position, dir).intersectPlane(floorPlane, V3());
    if (hit) d = hit.distanceTo(camera.position);
  }
  d = THREE.MathUtils.clamp(d ?? 10, 2, 40);
  const r3 = (v) => [v.x, v.y, v.z].map((x) => Math.round(x * 1000) / 1000);
  const key = { position: r3(camera.position), lookAt: r3(camera.position.clone().addScaledVector(dir, d)), fov: Math.round(camera.fov * 10) / 10 };
  const last = video.keys.at(-1);
  if (last) {                                       // the same view twice adds nothing
    const lp = V3(...last.position), ld = V3(...last.lookAt).sub(lp).normalize();
    if (lp.distanceTo(camera.position) < 0.05 && ld.angleTo(dir) < 0.02 && Math.abs(last.fov - key.fov) < 0.5) { flashHud(); return; }
  }
  video.keys.push(key);
  updateTrail();
  updateVideoHud();
  flashHud();
}
function flashHud() {
  const hud = $('#videohud');
  hud.classList.remove('flash'); void hud.offsetWidth; hud.classList.add('flash');
}
function undoKeyframe() {
  if (!video.on || video.phase !== 'edit' || !video.keys.length) return;
  video.keys.pop();
  updateTrail();
  updateVideoHud();
}
// the path so far, drawn on the floor (hidden while it plays back)
const trail = new THREE.Group();
trail.visible = false; trail.renderOrder = 12;
scene.add(trail);
const trailMat = new THREE.LineBasicMaterial({ color: 0xE60028, transparent: true, opacity: 0.95, depthTest: false });
const trailDot = new THREE.MeshBasicMaterial({ color: 0xE60028, depthTest: false, transparent: true });
const trailDotGeo = new THREE.CircleGeometry(0.16, 24).rotateX(-Math.PI / 2);
function updateTrail() {
  for (const c of [...trail.children]) { trail.remove(c); if (c.isLine) c.geometry.dispose(); }
  trail.visible = video.on && video.phase === 'edit';
  const keys = video.keys;
  if (!keys.length) return;
  const y = floorY + 0.03;
  for (const k of keys) {
    const dot = new THREE.Mesh(trailDotGeo, trailDot);
    dot.position.set(k.position[0], y, k.position[2]); dot.renderOrder = 12;
    trail.add(dot);
    const a = V3(k.position[0], y, k.position[2]), b = V3(k.lookAt[0], y, k.lookAt[2]).sub(a);
    if (b.lengthSq() > 1e-6) {                       // a short tick: which way that keyframe looks
      const tick = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, a.clone().addScaledVector(b.normalize(), 0.7)]), trailMat);
      tick.renderOrder = 12; trail.add(tick);
    }
  }
  if (keys.length > 1) {
    const path = buildPath(keys, VIDEO.speed), pts = [], pose = newPose();
    const n = Math.max(40, Math.ceil(path.duration * 8));
    for (let i = 0; i <= n; i++) { path.at((i / n) * path.duration, pose); pts.push(V3(pose.pos.x, y, pose.pos.z)); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), trailMat);
    line.renderOrder = 12; trail.add(line);
  }
}

// ---- the smoothed path
const newPose = () => ({ pos: V3(), poi: V3(), fov: 50 });
function parsePath(json) {
  const list = Array.isArray(json) ? json : json?.keyframes;
  if (!Array.isArray(list)) throw new Error('no keyframes in it');
  const ok3 = (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
  const keys = list.filter((k) => ok3(k?.position) && ok3(k?.lookAt)).map((k) => ({
    position: k.position, lookAt: k.lookAt,
    fov: THREE.MathUtils.clamp(Number.isFinite(k.fov) ? k.fov : WALK_FOV.start, WALK_FOV.min, WALK_FOV.max),
  }));
  if (keys.length < 2) throw new Error('a path needs at least 2 keyframes');
  const st = json?.settings || {};
  if (VIDEO_SHAPES[st.shape]) VIDEO.shape = st.shape;
  if ([720, 1080, 2160].includes(st.size)) VIDEO.size = st.size;
  if ([30, 60].includes(st.fps)) VIDEO.fps = st.fps;
  if (VIDEO_SPEEDS[st.speed]) VIDEO.speed = st.speed;
  return keys;
}
function buildPath(keys, speedName) {
  const sp = VIDEO_SPEEDS[speedName] || VIDEO_SPEEDS.normal;
  const n = keys.length, S = PATH_SAMPLES;
  const P = new THREE.CatmullRomCurve3(keys.map((k) => V3(...k.position)), false, 'centripetal');
  const Q = new THREE.CatmullRomCurve3(keys.map((k) => V3(...k.lookAt)), false, 'centripetal');
  const F = new THREE.CatmullRomCurve3(keys.map((k) => V3(k.fov, 0, 0)), false, 'catmullrom', 0.5);
  const tmp = V3();
  const atU = (u, out) => {                          // u: 0 at the first keyframe, 1 at the second, ...
    const t = THREE.MathUtils.clamp(u / (n - 1), 0, 1);
    P.getPoint(t, out.pos); Q.getPoint(t, out.poi); out.fov = F.getPoint(t, tmp).x;
    return out;
  };
  const dirOf = (pose, out, prev) => {
    out.subVectors(pose.poi, pose.pos);
    return out.lengthSq() > 1e-6 ? out.normalize() : out.copy(prev);
  };
  // effort of each stretch (seconds at this speed): the slowest of moving, turning and zooming
  const segs = [];
  const a = newPose(), b = newPose(), da = V3(0, 0, -1), db = V3();
  for (let i = 0; i < n - 1; i++) {
    const cum = new Float64Array(S + 1);
    atU(i, a); dirOf(a, da, da);
    for (let k = 1; k <= S; k++) {
      atU(i + k / S, b); dirOf(b, db, da);
      const e = Math.max(a.pos.distanceTo(b.pos) / sp.move, THREE.MathUtils.radToDeg(da.angleTo(db)) / sp.turn, Math.abs(b.fov - a.fov) / sp.zoom);
      cum[k] = cum[k - 1] + e;
      a.pos.copy(b.pos); a.poi.copy(b.poi); a.fov = b.fov; da.copy(db);
    }
    segs.push({ cum, total: cum[S], D: Math.max(cum[S], 0.8) });
  }
  // ease in / out: the first and last stretch start / end at rest, so give them a little longer
  if (segs.length === 1) segs[0].D *= 1.5;
  else { segs[0].D *= 1.3; segs.at(-1).D *= 1.3; }
  const T = [0];
  for (const sg of segs) T.push(T.at(-1) + sg.D);
  // pace (keyframes per second) at each keyframe: monotone cubic (Fritsch-Butland), 0 at both ends
  const m = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const h0 = segs[i - 1].D, h1 = segs[i].D, w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
    m[i] = (w1 + w2) / (w1 * h0 + w2 * h1);
  }
  const end = T.at(-1);
  const duration = end + PATH_HOLD * 2;
  const at = (time, out) => {
    const t = THREE.MathUtils.clamp(time - PATH_HOLD, 0, end);
    let i = 0;
    while (i < segs.length - 1 && t > T[i + 1]) i++;
    const sg = segs[i], s = THREE.MathUtils.clamp((t - T[i]) / sg.D, 0, 1);
    const s2 = s * s, s3 = s2 * s;
    let sigma = (s3 - 2 * s2 + s) * sg.D * m[i] + (-2 * s3 + 3 * s2) + (s3 - s2) * sg.D * m[i + 1];
    sigma = THREE.MathUtils.clamp(sigma, 0, 1);
    let u;
    if (sg.total < 1e-6) u = i + sigma;
    else {                                           // effort -> spline parameter
      const target = sigma * sg.total, c = sg.cum;
      let lo = 0, hi = S;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] <= target) lo = mid; else hi = mid; }
      const span = c[hi] - c[lo];
      u = i + (lo + (span > 1e-9 ? (target - c[lo]) / span : 0)) / S;
    }
    return atU(u, out);
  };
  return { at, duration };
}
const _look = V3();
function applyPose(pose) {
  camera.position.copy(pose.pos);
  camera.up.set(0, 1, 0);
  if (_look.subVectors(pose.poi, pose.pos).lengthSq() > 1e-4) camera.lookAt(pose.poi);
  camera.fov = pose.fov;
  camera.updateProjectionMatrix();
}

// ---- playback (preview) and the video panel
function finishPath(save = true) {
  if (!video.on || !state.walking || video.keys.length < 2) return;
  if (isLocked()) document.exitPointerLock();
  walk.keys.clear(); walk.target = null; marker.visible = false;
  if (save) savePathFile();
  video.phase = 'review';
  video.saved = { pos: camera.position.clone(), fov: camera.fov };
  trail.visible = false;
  document.body.classList.add('video-review');
  video.path = buildPath(video.keys, VIDEO.speed);
  video.play = { t: 0 };
  syncVideoUI();
  $('#video-progress').hidden = true; $('#video-bar').hidden = true;
  $('#video').show();
  $('#video-render').focus();
  loadMuxer().catch(() => {});                      // fetch the MP4 writer early
}
function replanPlayback() {
  const f = video.play && video.path ? video.play.t / video.path.duration : 0;
  video.path = buildPath(video.keys, VIDEO.speed);
  if (video.play) video.play.t = f * video.path.duration;
}
const _pose = newPose();
function updateVideoPlay(dt) {
  const p = video.play, path = video.path;
  p.t += dt;
  if (p.t > path.duration + 0.8) p.t = 0;           // loop, with a short pause on the last frame
  applyPose(path.at(Math.min(p.t, path.duration), _pose));
}
function editPath() {
  if (state.exporting) return;
  video.play = null;
  video.phase = 'edit';
  document.body.classList.remove('video-review');
  $('#video').close();
  if (video.saved) { camera.position.copy(video.saved.pos); setFov(walkFov); }
  camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
  updateTrail();
  updateVideoHud();
}
function savePathFile() {
  const data = {
    app: 'B10 Showcase', kind: 'camera-path', version: 1, saved: new Date().toISOString(),
    settings: { shape: VIDEO.shape, size: VIDEO.size, fps: VIDEO.fps, speed: VIDEO.speed },
    keyframes: video.keys,
  };
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `B10-Showcase_path_${fileStamp()}.json`);
}
function loadMuxer() { return (video.muxer ||= import(MP4_MUXER).catch((e) => { video.muxer = null; throw e; })); }

// ---- rendering: every frame drawn at full quality (2x supersampled up to 1080p), encoded with
// the browser's own video encoder (WebCodecs) and packed into an MP4
async function pickCodec(w, h, fps) {
  const bitrate = Math.round(THREE.MathUtils.clamp(w * h * fps * 0.24, 8e6, 80e6));
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16), rate = mbs * fps;
  const levels = [[0x1F, 3600, 108000], [0x20, 5120, 216000], [0x28, 8192, 245760], [0x2A, 8704, 522240],
    [0x32, 22080, 589824], [0x33, 36864, 983040], [0x34, 36864, 2073600], [0x3C, 139264, 4177920]];
  const avc = levels.filter(([, f, r]) => mbs <= f && rate <= r).slice(0, 2)
    .map(([l]) => [`avc1.6400${l.toString(16).toUpperCase().padStart(2, '0')}`, 'avc']);
  const candidates = [...avc, ['vp09.00.51.08', 'vp9'], ['av01.0.12M.08', 'av1']];
  for (const [codec, mux] of candidates) {
    const config = { codec, width: w, height: h, bitrate, framerate: fps, latencyMode: 'quality', ...(mux === 'avc' ? { avc: { format: 'avc' } } : {}) };
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return { config, mux }; } catch { /* try the next */ }
  }
  return null;
}
async function renderVideo() {
  if (state.exporting || !video.on || video.phase !== 'review' || video.keys.length < 2) return;
  const dlg = $('#video'), prog = $('#video-progress'), bar = $('#video-bar'), barFill = bar.firstElementChild;
  const say = (t) => { prog.hidden = false; prog.textContent = t; };
  if (!('VideoEncoder' in window) || !('VideoFrame' in window)) {
    say('This browser can’t make videos. Please use a recent Chrome, Edge or Safari.');
    return;
  }
  const { w, h } = videoSize(), fps = VIDEO.fps;
  say('Preparing…');
  let Mp4;
  try { Mp4 = await loadMuxer(); } catch { say('Couldn’t load the video writer. Check the internet connection and try again.'); return; }
  const codec = await pickCodec(w, h, fps);
  if (!codec) { say(`This browser can’t encode ${w} × ${h} video. Try a smaller size.`); return; }

  const gl = renderer.getContext();
  const maxSide = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0], 4096);
  const ss = Math.max(w, h) * 2 <= maxSide ? 2 : 1;  // supersample when it fits
  const path = buildPath(video.keys, VIDEO.speed);
  const frames = Math.max(2, Math.round(path.duration * fps));
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const ctx = out.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

  const muxer = new Mp4.Muxer({ target: new Mp4.ArrayBufferTarget(), video: { codec: codec.mux, width: w, height: h, frameRate: fps }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  let encErr = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
  encoder.configure(codec.config);

  state.exporting = true; video.cancel = false;
  const playing = video.play; video.play = null;
  dlg.classList.add('busy');
  $('#video-render').disabled = $('#video-back').disabled = true;
  $('#video-cancel').hidden = false;
  bar.hidden = false; barFill.style.width = '0';
  const savedRatio = renderer.getPixelRatio();
  let error = null, done = 0;
  const t0 = performance.now();
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(w * ss, h * ss, false);         // the on-screen canvas keeps its size: it shows the frames
    camera.aspect = w / h;
    for (let f = 0; f < frames; f++) {
      if (video.cancel) break;
      if (encErr) throw encErr;
      applyPose(path.at(f / fps, _pose));
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      ctx.drawImage(canvas, 0, 0, w * ss, h * ss, 0, 0, w, h);    // same task as the draw: still there
      const frame = new VideoFrame(out, { timestamp: Math.round((f * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: f % (fps * 2) === 0 });
      frame.close();
      done = f + 1;
      while (encoder.encodeQueueSize > 4 && !encErr) await new Promise((r) => setTimeout(r, 2));
      if (f % 3 === 0 || f === frames - 1) {
        const pct = done / frames, left = ((performance.now() - t0) / done) * (frames - done) / 1000;
        barFill.style.width = `${(pct * 100).toFixed(1)}%`;
        prog.hidden = false;
        prog.textContent = `Rendering… frame ${done} of ${frames}` + (done > 10 ? ` · about ${fmtTime(Math.max(1, left))} left` : '');
        await nextTask();
      }
    }
    if (!video.cancel) {
      prog.textContent = 'Finishing…';
      await encoder.flush();
      if (encErr) throw encErr;
      muxer.finalize();
    }
  } catch (e) {
    error = e;
  } finally {
    try { if (encoder.state !== 'closed') encoder.close(); } catch { /* already closed */ }
    renderer.setPixelRatio(savedRatio);
    resize();
    state.exporting = false;
    video.play = playing || { t: 0 };
    dlg.classList.remove('busy');
    $('#video-render').disabled = $('#video-back').disabled = false;
    $('#video-cancel').hidden = true;
    bar.hidden = true;
    out.width = out.height = 0;
  }
  if (error) { console.error('video export', error); say(`Couldn’t make the video (${error.message || error}). Try a smaller size.`); return; }
  if (video.cancel) { say('Stopped. Nothing was saved.'); return; }
  const name = `B10-Showcase_video_${w}x${h}_${fps}fps_${fileStamp()}.mp4`;
  downloadBlob(new Blob([muxer.target.buffer], { type: 'video/mp4' }), name);
  say(`Saved ${name}`);
}

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (state.loading || state.exporting) return;
  if (video.play) updateVideoPlay(dt);
  else if (state.tour) updateTour(dt);
  else if (state.fly) {
    const f = state.fly;
    f.t += dt;
    const e = ease(Math.min(1, f.t / f.dur));
    camera.position.lerpVectors(f.from, f.to, e);
    controls.target.lerpVectors(f.fromT, f.toT, e);
    camera.lookAt(controls.target);
    if (f.t >= f.dur) { state.fly = null; stopOrbitMomentum(); controls.update(); f.after?.(); }
  } else if (state.walking) updateWalk(dt);
  else { controls.update(); clampOrbit(); }
  updateCutaway(dt);
  renderer.render(scene, camera);
  renderOutline();
  labelRenderer.render(scene, camera);
});
controls.addEventListener('start', () => { stopTour(); state.fly = null; setActivePreset(null); closePopovers(); });

if (new URLSearchParams(location.search).has('debug')) window.b10 = { camera, controls, layers, zones, labelObjs, state, cut, walk, enterWalk, exitWalk, poses, zonePose, fitPoseToLimits, clampOrbit, blockAt, focusBlock, go, setHoverBlock, scene, renderer, renderOutline, video, VIDEO, buildPath, startVideo, addKeyframe, finishPath, renderVideo, editPath, endVideo };
boot();
