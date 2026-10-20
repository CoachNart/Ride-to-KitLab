import * as THREE from 'three';
import './style.css';

(function(){
'use strict';
// Browser-local persistence fallback for production. Shared multiplayer requires a remote host storage provider.
if (!window.storage) {
  const prefix = 'ride-to-kitlab:';
  window.storage = {
    __rideKitlabLocal: true,
    async get(key) { const value = localStorage.getItem(prefix + key); return value === null ? null : { value }; },
    async set(key, value) { localStorage.setItem(prefix + key, value); return { value }; },
    async list(prefixKey) { const keys=[]; for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key&&key.startsWith(prefix+prefixKey))keys.push(key.slice(prefix.length));} return { keys }; },
    async delete(key) { localStorage.removeItem(prefix + key); return true; }
  };
}


/* ============================================================
   CONFIG
   ============================================================ */
// Put your live Kitlab link here to enable the "Open Kitlab" buttons.
const KITLAB_URL = '';

const IS_TOUCH = (window.matchMedia && matchMedia('(pointer:coarse)').matches) || ('ontouchstart' in window);
const SEED = 7731, HALF = 1350, N = 320, CELL = (HALF * 2) / N, WATER = -5.5, PS = 1100;
const SHARD_T = [0.12, 0.29, 0.46, 0.63, 0.80];
const SHARD_COL = ['#19d3ea', '#ffc14d', '#ff5a67', '#4fdc86', '#8fe9f7'];
const RIDER_PAL = ['#ff5a67', '#19d3ea', '#ffc14d', '#4fdc86', '#8fe9f7', '#ffd95e', '#ff8a5e', '#9be564'];
const JERSEY_PAL = ['#0b3a47', '#103a5e', '#16505a', '#5a2030', '#12404a', '#5a4a1a', '#1d3a2a', '#2a3550'];

const LESSONS = [
  { title: 'Wallets',
    body: "A crypto wallet doesn't hold coins the way a purse holds cash. Your assets live on the blockchain. The wallet holds the keys that let you move them.",
    q: 'What does a wallet actually store?',
    opts: ['The coins themselves', 'The keys that sign your transactions', 'A full copy of the blockchain'], ans: 1,
    why: 'Keys prove ownership and authorize transfers. The assets stay on-chain.' },
  { title: 'Keys and seed phrases',
    body: 'Your seed phrase, usually 12 or 24 words, can rebuild every key in your wallet. Whoever holds it controls your funds.',
    q: 'Who should ever see your seed phrase?',
    opts: ['Support staff who ask for it', 'Nobody but you', 'Any app that asks to connect'], ans: 1,
    why: 'No real support team or app needs it. Anyone asking for it is trying to drain your wallet.' },
  { title: 'Blocks and chains',
    body: 'Transactions are bundled into blocks. Each block includes the hash of the block before it, so rewriting old history would break every block after it.',
    q: 'What links one block to the next?',
    opts: ["The previous block's hash", 'A shared password', "The miner's name"], ans: 0,
    why: 'A hash is a fingerprint of the data. Change the data and the fingerprint changes.' },
  { title: 'Smart contracts',
    body: 'A smart contract is a program stored on a blockchain. Once deployed, it runs exactly as written whenever someone calls it.',
    q: "Can a deployed contract's author usually edit its code?",
    opts: ['Yes, at any time', 'Not unless it was built to be upgradeable', 'Only when fees are low'], ans: 1,
    why: 'Immutable is the default. Upgradeable designs add trust assumptions, so read up before using one.' },
  { title: 'Gas',
    body: "Every action on the network uses computation and storage. Gas is the fee you pay the network's validators for that work. It rises when the network is busy.",
    q: 'What is gas?',
    opts: ['A fee for computation on the network', 'A reward for holding tokens', 'A kind of wallet'], ans: 0,
    why: 'Gas pays for the work validators do, and busy blocks cost more.' }
];

/* ============================================================
   HELPERS
   ============================================================ */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function fmtTime(s) { s = Math.max(0, s); const m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + (r < 10 ? '0' : '') + r; }

const perm = (function () { const r = mulberry32(SEED), p = []; for (let i = 0; i < 256; i++) p.push(i); for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; } return p.concat(p); })();
function hash2(ix, iz) { return perm[perm[ix & 255] + (iz & 255)] / 255; }
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return lerp(lerp(hash2(ix, iz), hash2(ix + 1, iz), u), lerp(hash2(ix, iz + 1), hash2(ix + 1, iz + 1), u), v);
}
function fbm(x, z, o) { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, z * f); n += a; a *= 0.5; f *= 2.03; } return s / n; }

/* ============================================================
   RENDERER / SCENE
   ============================================================ */
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_TOUCH, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.6 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const FOG_WORLD = new THREE.Color(0xeeb98f), FOG_HUB = new THREE.Color(0x2b1b5e);
scene.fog = new THREE.Fog(FOG_WORLD.getHex(), 70, 640);
scene.background = FOG_WORLD.clone();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2400);

const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x6a7a44, 0.78);
const sun = new THREE.DirectionalLight(0xffd7a8, 0.95);
const SUN_DIR = new THREE.Vector3(-0.5, 0.42, -0.75).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
{ const sc = sun.shadow.camera; sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 1; sc.far = 320; }
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.06;
scene.add(hemi, sun, sun.target);

const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  uniforms: {
    top: { value: new THREE.Color(0x3a6ec0) }, mid: { value: new THREE.Color(0xeeb98f) }, bot: { value: new THREE.Color(0xe8b080) },
    sunDir: { value: SUN_DIR.clone() }, sunCol: { value: new THREE.Color(0xfff0c8) }, stars: { value: 0 }
  },
  vertexShader: 'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: [
    'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 sunCol; uniform vec3 sunDir; uniform float stars; varying vec3 vP;',
    'float h(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}',
    'void main(){',
    ' float y=vP.y;',
    ' vec3 c = y>0.0 ? mix(mid,top,pow(clamp(y,0.0,1.0),0.55)) : mix(mid,bot,clamp(-y*4.0,0.0,1.0));',
    ' float s=max(dot(normalize(vP),normalize(sunDir)),0.0);',
    ' c+=sunCol*(pow(s,900.0)*3.0+pow(s,14.0)*0.32);',
    ' vec3 g=floor(vP*260.0);',
    ' float st=step(0.9975,h(g))*stars*smoothstep(0.02,0.35,y);',
    ' c+=vec3(st);',
    ' gl_FragColor=vec4(c,1.0);',
    '}'
  ].join('\n')
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 24, 16), skyMat);
sky.frustumCulled = false; sky.renderOrder = -10;
scene.add(sky);

const worldGroup = new THREE.Group(); scene.add(worldGroup);
const hubGroup = new THREE.Group(); hubGroup.visible = false; scene.add(hubGroup);

/* ============================================================
   WORLD: path, heightfield, terrain
   ============================================================ */
const CTRL = [[0, 300], [50, 255], [135, 215], [175, 140], [120, 60], [10, 25], [-110, -10], [-185, -85], [-160, -175], [-70, -225], [40, -250], [120, -295], [200, -335], [285, -365], [350, -315], [385, -225], [330, -145], [245, -105], [180, -35]];
const curve = new THREE.CatmullRomCurve3(CTRL.map(p => new THREE.Vector3(p[0] * 1.7, 0, p[1] * 1.7)), false, 'centripetal');
const PATH_LEN = curve.getLength();
const pp = curve.getSpacedPoints(PS);
const px = new Float32Array(PS + 1), pz = new Float32Array(PS + 1), tx = new Float32Array(PS + 1), tz = new Float32Array(PS + 1), pathY = new Float32Array(PS + 1);
for (let i = 0; i <= PS; i++) { px[i] = pp[i].x; pz[i] = pp[i].z; }
for (let i = 0; i <= PS; i++) {
  const a = Math.max(i - 1, 0), b = Math.min(i + 1, PS);
  let dx = px[b] - px[a], dz = pz[b] - pz[a]; const l = Math.hypot(dx, dz) || 1;
  tx[i] = dx / l; tz[i] = dz / l;
}

function baseH(x, z) {
  const a = (fbm(x * 0.003 + 11.3, z * 0.003 + 7.1, 4) - 0.5) * 62;
  const b = (fbm(x * 0.0095 + 3.7, z * 0.0095 + 19.2, 3) - 0.5) * 20;
  const c = (fbm(x * 0.03 + 8.1, z * 0.03 + 2.4, 2) - 0.5) * 3;
  const r = Math.max(Math.abs(x), Math.abs(z)) / HALF;
  const e = smooth(0.64, 0.97, r);
  return a + b + c + e * (60 + 55 * fbm(x * 0.008 + 40, z * 0.008 + 9, 3));
}

let H, D;
function terrainH(x, z) {
  let gx = (x + HALF) / CELL, gz = (z + HALF) / CELL;
  gx = clamp(gx, 0, N - 0.001); gz = clamp(gz, 0, N - 0.001);
  const ix = gx | 0, iz = gz | 0, fx = gx - ix, fz = gz - iz, i = iz * (N + 1) + ix;
  const h00 = H[i], h10 = H[i + 1], h01 = H[i + N + 1], h11 = H[i + N + 2];
  return (fx + fz <= 1) ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h10 * (1 - fz) + h01 * (1 - fx) + h11 * (fx + fz - 1);
}
function distGrid(x, z) {
  const ix = clamp(Math.round((x + HALF) / CELL), 0, N), iz = clamp(Math.round((z + HALF) / CELL), 0, N);
  return D[iz * (N + 1) + ix];
}

const HUB = { x: 4000, y: 40, z: 4000, R: 46 };
function groundAt(zn, x, z) { return zn === 1 ? HUB.y : terrainH(x, z); }

function nearestPath(x, z, hint) {
  let bi = hint, bd = 1e12;
  const lo = Math.max(0, hint - 20), hi = Math.min(PS, hint + 20);
  for (let k = lo; k <= hi; k++) { const dx = x - px[k], dz = z - pz[k], dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; bi = k; } }
  if (bd > 3600) { bd = 1e12; for (let k = 0; k <= PS; k++) { const dx = x - px[k], dz = z - pz[k], dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; bi = k; } } }
  return { i: bi, d: Math.sqrt(bd) };
}

/* obstacle hash */
const OB = new Map(), OBC = 16;
function obKey(cx, cz) { return (cx + 500) * 1000 + (cz + 500); }
function addOb(x, z, r) { const k = obKey(Math.floor(x / OBC), Math.floor(z / OBC)); let l = OB.get(k); if (!l) { l = []; OB.set(k, l); } l.push({ x, z, r }); }

function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function buildTerrain() {
  // smooth path heights
  const raw = new Float32Array(PS + 1);
  for (let i = 0; i <= PS; i++) raw[i] = baseH(px[i], pz[i]);
  for (let i = 0; i <= PS; i++) {
    let s = 0, c = 0;
    for (let k = -16; k <= 16; k++) { const j = i + k; if (j >= 0 && j <= PS) { s += raw[j]; c++; } }
    pathY[i] = Math.max(-2.5, s / c);
  }
  const V = (N + 1) * (N + 1);
  H = new Float32Array(V); D = new Float32Array(V);
  const bmap = new Map();
  for (let k = 0; k <= PS; k++) { const key = (Math.floor(px[k] / 40) + 100) * 1000 + (Math.floor(pz[k] / 40) + 100); let l = bmap.get(key); if (!l) { l = []; bmap.set(key, l); } l.push(k); }
  for (let iz = 0; iz <= N; iz++) {
    for (let ix = 0; ix <= N; ix++) {
      const x = -HALF + ix * CELL, z = -HALF + iz * CELL;
      const bh = baseH(x, z);
      let bd = 1e12, bk = 0;
      const bcx = Math.floor(x / 40), bcz = Math.floor(z / 40);
      for (let ax = -1; ax <= 1; ax++) for (let az = -1; az <= 1; az++) {
        const l = bmap.get((bcx + ax + 100) * 1000 + (bcz + az + 100)); if (!l) continue;
        for (let q = 0; q < l.length; q++) { const k = l[q], dx = x - px[k], dz = z - pz[k], dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; bk = k; } }
      }
      const far = bd > 1e11, d = far ? 90 : Math.sqrt(bd), w = far ? 0 : 1 - smooth(4.5, 28, d), i = iz * (N + 1) + ix;
      H[i] = lerp(bh, pathY[bk], w); D[i] = d;
    }
  }
  // vertex data
  const pos = new Float32Array(V * 3), col = new Float32Array(V * 3), uv = new Float32Array(V * 2);
  const cG1 = new THREE.Color(0x5e9a38), cG2 = new THREE.Color(0x88b24c), cDry = new THREE.Color(0xb7b05a), cDirt = new THREE.Color(0x9c7c52),
    cRock = new THREE.Color(0x8c8984), cSand = new THREE.Color(0xdac790), cSnow = new THREE.Color(0xf2f4f7), c = new THREE.Color();
  for (let iz = 0; iz <= N; iz++) {
    for (let ix = 0; ix <= N; ix++) {
      const i = iz * (N + 1) + ix, x = -HALF + ix * CELL, z = -HALF + iz * CELL, h = H[i];
      pos[i * 3] = x; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z; uv[i * 2] = x / 9; uv[i * 2 + 1] = z / 9;
      const hl = H[iz * (N + 1) + Math.max(ix - 1, 0)], hr = H[iz * (N + 1) + Math.min(ix + 1, N)];
      const hu = H[Math.max(iz - 1, 0) * (N + 1) + ix], hd = H[Math.min(iz + 1, N) * (N + 1) + ix];
      const slope = Math.hypot(hr - hl, hd - hu) / (2 * CELL);
      c.copy(cG1).lerp(cG2, fbm(x * 0.02 + 3, z * 0.02, 2));
      c.lerp(cDry, smooth(0.52, 0.78, fbm(x * 0.007 + 90, z * 0.007, 3)) * 0.6);
      c.lerp(cSand, smooth(WATER + 1.6, WATER + 0.1, h));
      c.lerp(cRock, smooth(0.34, 0.7, slope));
      c.lerp(cRock, smooth(36, 52, h));
      c.lerp(cSnow, smooth(66, 84, h));
      c.lerp(cDirt, (1 - smooth(3.5, 10, D[i])) * 0.55);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
  }
  const idx = new Uint32Array(N * N * 6); let q = 0;
  for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
    const i00 = iz * (N + 1) + ix, i10 = i00 + 1, i01 = i00 + N + 1, i11 = i01 + 1;
    idx[q++] = i00; idx[q++] = i01; idx[q++] = i10; idx[q++] = i10; idx[q++] = i01; idx[q++] = i11;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  // detail texture
  const tc = mkCanvas(128, 128), tcx = tc.getContext('2d');
  tcx.fillStyle = '#d8d8d8'; tcx.fillRect(0, 0, 128, 128);
  const rr = mulberry32(5);
  for (let i = 0; i < 2600; i++) { const v = 150 + Math.floor(rr() * 105); tcx.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.25 + rr() * 0.35) + ')'; tcx.fillRect(rr() * 128, rr() * 128, 1 + rr() * 2, 1 + rr() * 3); }
  const detail = new THREE.CanvasTexture(tc); detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 1, metalness: 0 }));
  mesh.receiveShadow = true; mesh.frustumCulled = false;
  worldGroup.add(mesh);

  // water
  const water = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2.4, HALF * 2.4), new THREE.MeshStandardMaterial({ color: 0x3b92c4, transparent: true, opacity: 0.8, roughness: 0.12, metalness: 0.1 }));
  water.rotation.x = -Math.PI / 2; water.position.y = WATER; water.receiveShadow = true;
  worldGroup.add(water);

  // road ribbon
  const rc = mkCanvas(128, 256), rx = rc.getContext('2d');
  rx.fillStyle = '#b48e5c'; rx.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 1800; i++) { const v = 120 + Math.floor(rr() * 90); rx.fillStyle = 'rgba(' + v + ',' + (v - 28) + ',' + (v - 60) + ',0.35)'; rx.fillRect(rr() * 128, rr() * 256, 1 + rr() * 3, 1 + rr() * 4); }
  rx.fillStyle = 'rgba(70,45,20,0.28)'; rx.fillRect(34, 0, 12, 256); rx.fillRect(82, 0, 12, 256);
  rx.fillStyle = 'rgba(120,150,70,0.35)'; rx.fillRect(60, 0, 8, 256);
  rx.globalCompositeOperation = 'destination-in';
  const gr = rx.createLinearGradient(0, 0, 128, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.14, 'rgba(0,0,0,1)'); gr.addColorStop(0.86, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  rx.fillStyle = gr; rx.fillRect(0, 0, 128, 256);
  const roadTex = new THREE.CanvasTexture(rc); roadTex.wrapT = THREE.RepeatWrapping;
  const RW = 3.4, rpos = new Float32Array((PS + 1) * 6), ruv = new Float32Array((PS + 1) * 4), ridx = [];
  let acc = 0;
  for (let i = 0; i <= PS; i++) {
    if (i > 0) acc += Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
    const nx = -tz[i], nz = tx[i];
    const lx = px[i] + nx * RW, lz = pz[i] + nz * RW, rx2 = px[i] - nx * RW, rz = pz[i] - nz * RW;
    rpos.set([lx, terrainH(lx, lz) + 0.07, lz, rx2, terrainH(rx2, rz) + 0.07, rz], i * 6);
    ruv.set([0, acc / 5, 1, acc / 5], i * 4);
    if (i < PS) { const a = i * 2; ridx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
  rg.setAttribute('uv', new THREE.BufferAttribute(ruv, 2));
  rg.setIndex(ridx); rg.computeVertexNormals();
  const road = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ map: roadTex, transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  road.receiveShadow = true; road.frustumCulled = false;
  worldGroup.add(road);
}

/* merged coloured low-poly geometry */
function mergeColored(parts) {
  const pos = [], col = [];
  for (const p of parts) {
    const g = p.geo.toNonIndexed(); g.translate(p.x || 0, p.y || 0, p.z || 0);
    const a = g.attributes.position.array, c = new THREE.Color(p.color);
    for (let i = 0; i < a.length; i++) pos.push(a[i]);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}

function buildScenery() {
  const rnd = mulberry32(99), dummy = new THREE.Object3D(), tmpC = new THREE.Color();
  const pineGeo = mergeColored([
    { geo: new THREE.CylinderGeometry(0.22, 0.3, 1.6, 6), color: 0x5b3d24, y: 0.8 },
    { geo: new THREE.ConeGeometry(2.0, 3.2, 7), color: 0x2f6b3a, y: 2.9 },
    { geo: new THREE.ConeGeometry(1.6, 2.8, 7), color: 0x37793f, y: 4.4 },
    { geo: new THREE.ConeGeometry(1.1, 2.4, 7), color: 0x428a47, y: 5.8 }
  ]);
  const oakGeo = mergeColored([
    { geo: new THREE.CylinderGeometry(0.25, 0.38, 2.2, 6), color: 0x6a4a2c, y: 1.1 },
    { geo: new THREE.IcosahedronGeometry(1.9, 0), color: 0x5c9a3a, y: 3.5 },
    { geo: new THREE.IcosahedronGeometry(1.3, 0), color: 0x6fae45, y: 4.7, x: 0.7 }
  ]);
  const NP = 1700, NO = 700, NR = 380, NF = 2600;
  const pines = new THREE.InstancedMesh(pineGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), NP);
  const oaks = new THREE.InstancedMesh(oakGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), NO);
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), NR);
  const flowers = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.14, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), NF);
  [pines, oaks, rocks, flowers].forEach(m => { m.frustumCulled = false; worldGroup.add(m); });
  pines.castShadow = oaks.castShadow = rocks.castShadow = true;

  function place(mesh, count, kind) {
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 30) {
      tries++;
      let x, z;
      if (rnd() < 0.4) { const i = Math.floor(rnd() * (PS + 1)), side = rnd() < 0.5 ? -1 : 1, off = 7 + rnd() * 34; x = px[i] - tz[i] * off * side; z = pz[i] + tx[i] * off * side; }
      else { x = (rnd() * 2 - 1) * HALF * 0.82; z = (rnd() * 2 - 1) * HALF * 0.82; }
      const d = distGrid(x, z); if (d < 7.5) continue;
      const h = terrainH(x, z); if (h < WATER + 1.2 || h > 40) continue;
      const sl = Math.abs(terrainH(x + 2, z) - h) + Math.abs(terrainH(x, z + 2) - h); if (sl > 1.6) continue;
      if (kind !== 'rock') { const dens = smooth(0.32, 0.62, fbm(x * 0.011 + 50, z * 0.011 + 5, 3)); if (rnd() > dens) continue; }
      const s = kind === 'rock' ? 0.7 + rnd() * 1.8 : 0.8 + rnd() * 0.9;
      dummy.position.set(x, h - (kind === 'rock' ? s * 0.25 : 0), z);
      dummy.rotation.set(kind === 'rock' ? rnd() * 3 : 0, rnd() * 6.28, kind === 'rock' ? rnd() * 3 : 0);
      if (kind === 'rock') dummy.scale.set(s, s * (0.6 + rnd() * 0.5), s * (0.8 + rnd() * 0.5)); else dummy.scale.set(s, s * (0.9 + rnd() * 0.4), s);
      dummy.updateMatrix(); mesh.setMatrixAt(placed, dummy.matrix);
      if (kind === 'rock') { const g = 0.55 + rnd() * 0.3; tmpC.setRGB(g, g * 0.97, g * 0.93); mesh.setColorAt(placed, tmpC); }
      else { const v = 0.8 + rnd() * 0.35; tmpC.setRGB(v, v, v * (0.9 + rnd() * 0.2)); mesh.setColorAt(placed, tmpC); }
      addOb(x, z, kind === 'rock' ? s * 0.95 : 0.42 * s);
      placed++;
    }
    mesh.count = placed; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  place(pines, NP, 'pine'); place(oaks, NO, 'oak'); place(rocks, NR, 'rock');

  // flowers along the road
  const fc = ['#ffffff', '#ffe27a', '#ff8fb1', '#b79bff', '#ff9a5a'];
  let n = 0;
  for (let t = 0; t < NF * 3 && n < NF; t++) {
    const i = Math.floor(rnd() * (PS + 1)), side = rnd() < 0.5 ? -1 : 1, off = 3.4 + rnd() * 16;
    const x = px[i] - tz[i] * off * side + (rnd() - 0.5) * 4, z = pz[i] + tx[i] * off * side + (rnd() - 0.5) * 4;
    const h = terrainH(x, z); if (h < WATER + 1) continue;
    dummy.position.set(x, h + 0.16, z); dummy.rotation.set(0, rnd() * 6, 0); dummy.scale.setScalar(0.7 + rnd() * 0.9); dummy.updateMatrix();
    flowers.setMatrixAt(n, dummy.matrix); tmpC.set(fc[Math.floor(rnd() * fc.length)]); flowers.setColorAt(n, tmpC); n++;
  }
  flowers.count = n; flowers.instanceMatrix.needsUpdate = true; if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;

  // clouds
  const cc = mkCanvas(128, 128), cx = cc.getContext('2d'), cg = cx.createRadialGradient(64, 64, 4, 64, 64, 62);
  cg.addColorStop(0, 'rgba(255,255,255,0.95)'); cg.addColorStop(0.6, 'rgba(255,240,225,0.5)'); cg.addColorStop(1, 'rgba(255,240,225,0)');
  cx.fillStyle = cg; cx.fillRect(0, 0, 128, 128);
  const ctex = new THREE.CanvasTexture(cc);
  cloudGroup = new THREE.Group();
  for (let i = 0; i < 22; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex, transparent: true, opacity: 0.55 + rnd() * 0.25, depthWrite: false, fog: false, color: 0xffeedd }));
    const a = rnd() * 6.283, r = 450 + rnd() * 700;
    s.position.set(Math.cos(a) * r, 150 + rnd() * 120, Math.sin(a) * r); s.scale.set(220 + rnd() * 260, 90 + rnd() * 80, 1);
    cloudGroup.add(s);
  }
  scene.add(cloudGroup);
}
let cloudGroup = null;

/* ============================================================
   LABEL SPRITES
   ============================================================ */
function labelCanvas(text, opts) {
  const o = opts || {}, w = o.w || 256, h = o.h || 64, c = mkCanvas(w, h), x = c.getContext('2d');
  x.font = '800 ' + (o.px || 30) + 'px "Avenir Next","Trebuchet MS",system-ui,sans-serif';
  const tw = Math.min(w - 16, x.measureText(text).width + 28);
  const bx = (w - tw) / 2, by = 6, bh = h - 12, r = bh / 2;
  x.fillStyle = o.bg || 'rgba(4,31,41,0.84)';
  x.beginPath(); x.moveTo(bx + r, by); x.arcTo(bx + tw, by, bx + tw, by + bh, r); x.arcTo(bx + tw, by + bh, bx, by + bh, r); x.arcTo(bx, by + bh, bx, by, r); x.arcTo(bx, by, bx + tw, by, r); x.fill();
  x.fillStyle = o.fg || '#f1fbfd'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, w / 2, h / 2 + 2, w - 40);
  return c;
}
function makeLabel(text, opts) {
  const tex = new THREE.CanvasTexture(labelCanvas(text, opts));
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(2.4, 0.6, 1); return sp;
}

/* ============================================================
   BICYCLE
   ============================================================ */
const WR = 0.345;
const AXIS = new THREE.Vector3(0, 0.14, -0.04).normalize();
const _up = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _g = new THREE.Vector3(), _h = new THREE.Vector3();
const cylCache = {};
function CYL(r, seg) { const k = r + '_' + seg; return cylCache[k] || (cylCache[k] = new THREE.CylinderGeometry(r, r, 1, seg || 8)); }
function limb(m, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz) || 1e-4;
  m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  _v.set(dx / len, dy / len, dz / len); m.quaternion.setFromUnitVectors(_up, _v); m.scale.set(1, len, 1);
}
const IKR = { kx: 0, ky: 0, kz: 0, ex: 0, ey: 0, ez: 0 };
function ik2(ax, ay, az, tx_, ty, tz_, l1, l2, px_, py, pz_) {
  let dx = tx_ - ax, dy = ty - ay, dz = tz_ - az, d = Math.hypot(dx, dy, dz) || 1e-4;
  const maxd = l1 + l2 - 0.002;
  if (d > maxd) { const s = maxd / d; dx *= s; dy *= s; dz *= s; d = maxd; }
  const ux = dx / d, uy = dy / d, uz = dz / d;
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  const dp = px_ * ux + py * uy + pz_ * uz;
  let qx = px_ - ux * dp, qy = py - uy * dp, qz = pz_ - uz * dp; const ql = Math.hypot(qx, qy, qz) || 1; qx /= ql; qy /= ql; qz /= ql;
  IKR.kx = ax + ux * a + qx * h; IKR.ky = ay + uy * a + qy * h; IKR.kz = az + uz * a + qz * h;
  IKR.ex = ax + dx; IKR.ey = ay + dy; IKR.ez = az + dz;
  return IKR;
}

/* ---------- realistic rider + adventure bicycle ---------- */
const SKIN_PAL = ['#f0c3a0', '#e0a97c', '#c68863', '#a46a46', '#7a4a30'];
const HAIR_PAL = ['#2a1b12', '#4a2f1d', '#1a1a1d', '#8a5a2b', '#b8862f'];
const geoCache = {};
function G(kind) {
  const a = Array.prototype.slice.call(arguments, 1), key = kind + ':' + a.join(',');
  if (!geoCache[key]) { const C = THREE[kind]; geoCache[key] = new C(...a); }
  return geoCache[key];
}
let SHM = null;
function shm() {
  if (SHM) return SHM;
  const M = (c, r, m) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m || 0 });
  SHM = {
    tire: M(0x151517, 0.95), rim: M(0xc9d0da, 0.3, 0.85), hub: M(0x8d949e, 0.35, 0.8), chrome: M(0xd7dde6, 0.2, 0.9),
    dark: M(0x1d1d26, 0.65, 0.3), rubber: M(0x111114, 0.9), glass: M(0x10161c, 0.12, 0.6), sole: M(0x1b1b1f, 0.9),
    shoe: M(0xf1fbfd, 0.7), pants: M(0x1d2733, 0.85), bag: M(0x1e3a44, 0.85), bottle: M(0x19d3ea, 0.4, 0.1), accent: M(0x19d3ea, 0.4, 0.3),
    glow: new THREE.MeshBasicMaterial({ color: 0xfff1b0 }), tail: new THREE.MeshBasicMaterial({ color: 0xff3b4a })
  };
  return SHM;
}

function makeWheel(rear) {
  const S = shm(), g = new THREE.Group();
  const tire = new THREE.Mesh(G('TorusGeometry', WR - 0.045, 0.045, 10, 44), S.tire); tire.rotation.y = Math.PI / 2; tire.castShadow = true; g.add(tire);
  const rim = new THREE.Mesh(G('TorusGeometry', WR - 0.095, 0.013, 8, 44), S.rim); rim.rotation.y = Math.PI / 2; g.add(rim);
  const hub = new THREE.Mesh(G('CylinderGeometry', 0.022, 0.022, 1, 10), S.hub); hub.rotation.z = Math.PI / 2; hub.scale.set(1, 0.11, 1); g.add(hub);
  for (const s of [-1, 1]) { const fl = new THREE.Mesh(G('CylinderGeometry', 0.04, 0.04, 1, 12), S.hub); fl.rotation.z = Math.PI / 2; fl.scale.set(1, 0.006, 1); fl.position.x = s * 0.035; g.add(fl); }
  const sg = G('CylinderGeometry', 0.0028, 0.0028, (WR - 0.095) * 2, 4);
  for (let i = 0; i < 10; i++) { const s = new THREE.Mesh(sg, S.rim); s.rotation.x = i * Math.PI / 10; g.add(s); }
  const rotor = new THREE.Mesh(G('CylinderGeometry', 0.085, 0.085, 1, 20), S.rim); rotor.rotation.z = Math.PI / 2; rotor.scale.set(1, 0.004, 1); rotor.position.x = 0.042; g.add(rotor);
  if (rear) {
    for (let k = 0; k < 5; k++) { const c = new THREE.Mesh(G('CylinderGeometry', 0.052 - k * 0.006, 0.052 - k * 0.006, 1, 14), S.hub); c.rotation.z = Math.PI / 2; c.scale.set(1, 0.008, 1); c.position.x = -0.045 - k * 0.008; g.add(c); }
  }
  return g;
}

function makeBike(frameHex, jerseyHex, helmetHex) {
  const hs = hashStr(String(frameHex) + String(jerseyHex)), S = shm();
  const M = (c, r, m) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m || 0 });
  const mFrame = M(frameHex, 0.35, 0.5), mJersey = M(jerseyHex, 0.8), mHelmet = M(helmetHex, 0.4, 0.1),
    mSkin = M(SKIN_PAL[hs % SKIN_PAL.length], 0.75), mHair = M(HAIR_PAL[(hs >> 3) % HAIR_PAL.length], 0.9), mPack = M(0xd9692e, 0.8);
  const root = new THREE.Group(); root.rotation.order = 'YXZ';
  const body = new THREE.Group(); root.add(body);
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  function mesh(geo, mat, parent, cast) { const m = new THREE.Mesh(geo, mat); if (cast) m.castShadow = true; (parent || body).add(m); return m; }
  function tube(a, b, rb, rt, mat, parent) { const t = mesh(G('CylinderGeometry', rt, rb, 1, 10), mat, parent, true); limb(t, a, b); return t; }
  function ball(p, r, mat, parent, sx, sy, sz, cast) { const m = mesh(G('SphereGeometry', r, 12, 9), mat, parent, cast !== false); m.position.copy(p); if (sx) m.scale.set(sx, sy, sz); return m; }
  function box(w, h, d, mat, x, y, z, parent, cast) { const m = mesh(G('BoxGeometry', w, h, d), mat, parent, !!cast); m.position.set(x, y, z); return m; }

  /* ---- frame ---- */
  const R = V3(0, WR, -0.54), F = V3(0, WR, 0.56), BB = V3(0, 0.30, -0.12), ST = V3(0, 0.83, -0.28), HB = V3(0, 0.70, 0.42), HT = V3(0, 0.84, 0.38);
  tube(BB, ST, 0.021, 0.019, mFrame); tube(ST, HT, 0.02, 0.019, mFrame); tube(BB, HB, 0.034, 0.028, mFrame); tube(HB, HT, 0.031, 0.031, S.accent);
  ball(BB, 0.036, mFrame); ball(ST, 0.024, mFrame); ball(HB, 0.034, mFrame); ball(HT, 0.03, mFrame);
  for (const s of [-1, 1]) {
    tube(V3(s * 0.04, 0.30, -0.12), V3(s * 0.05, WR, R.z), 0.016, 0.01, mFrame);
    tube(V3(s * 0.03, 0.80, -0.285), V3(s * 0.05, WR, R.z), 0.012, 0.009, mFrame);
    box(0.012, 0.05, 0.04, S.dark, s * 0.055, WR, R.z);
  }
  // seatpost, saddle
  tube(ST, V3(0, 0.86, -0.31), 0.014, 0.014, S.chrome);
  ball(V3(0, 0.875, -0.31), 0.07, S.dark, body, 1.05, 0.38, 1.9, false);
  ball(V3(0, 0.875, -0.17), 0.05, S.dark, body, 0.75, 0.34, 1.7, false);
  // water bottle on the down tube
  { const a = BB.clone().lerp(HB, 0.3), b = BB.clone().lerp(HB, 0.72); a.y += 0.06; b.y += 0.06; tube(a, b, 0.033, 0.033, S.bottle); const cap = a.clone().lerp(b, 1.0); ball(cap, 0.026, S.dark, body, 1, 0.6, 1, false); }
  // frame bag
  box(0.075, 0.2, 0.3, S.bag, 0, 0.64, 0.12, body, true);
  box(0.078, 0.03, 0.3, S.accent, 0, 0.745, 0.12);
  // rear rack, bag, light
  for (const s of [-1, 1]) tube(V3(s * 0.06, 0.64, -0.40), V3(s * 0.06, 0.60, -0.74), 0.007, 0.007, S.chrome);
  box(0.15, 0.012, 0.36, S.chrome, 0, 0.60, -0.57);
  box(0.22, 0.2, 0.3, S.bag, 0, 0.71, -0.56, body, true);
  box(0.224, 0.03, 0.3, S.accent, 0, 0.8, -0.56);
  box(0.045, 0.03, 0.02, S.tail, 0, 0.66, -0.735);

  /* ---- wheels, drivetrain ---- */
  const rw = makeWheel(true); rw.position.copy(R); body.add(rw);
  box(0.025, 0.085, 0.045, S.dark, -0.055, WR - 0.065, R.z + 0.02);
  ball(V3(-0.055, WR - 0.095, R.z + 0.035), 0.018, S.hub, body, 0.5, 1, 1, false);
  const chainring = mesh(G('CylinderGeometry', 0.095, 0.095, 1, 24), S.hub, body, false); chainring.rotation.z = Math.PI / 2; chainring.scale.set(1, 0.007, 1); chainring.position.set(-0.07, BB.y, BB.z);
  const axleBB = mesh(G('CylinderGeometry', 0.018, 0.018, 1, 8), S.chrome, body, false); axleBB.rotation.z = Math.PI / 2; axleBB.scale.set(1, 0.2, 1); axleBB.position.copy(BB);
  tube(V3(-0.065, BB.y + 0.092, BB.z), V3(-0.058, WR + 0.052, R.z), 0.004, 0.004, S.rubber);
  tube(V3(-0.065, BB.y - 0.092, BB.z), V3(-0.058, WR - 0.052, R.z), 0.004, 0.004, S.rubber);

  /* ---- steering assembly ---- */
  const steerG = new THREE.Group(); steerG.position.copy(HB); body.add(steerG);
  const fy = F.y - HB.y, fz = F.z - HB.z;
  box(0.13, 0.035, 0.055, S.dark, 0, -0.03, 0.0, steerG);
  for (const s of [-1, 1]) {
    const top = V3(s * 0.05, -0.035, 0.005), axle = V3(s * 0.05, fy, fz), mid = top.clone().lerp(axle, 0.48);
    tube(top, mid, 0.015, 0.015, S.chrome, steerG); tube(mid, axle, 0.02, 0.019, S.dark, steerG);
    const cap = mesh(G('CylinderGeometry', 0.014, 0.014, 1, 8), S.hub, steerG, false); cap.rotation.z = Math.PI / 2; cap.scale.set(1, 0.05, 1); cap.position.set(s * 0.07, fy, fz);
  }
  box(0.03, 0.06, 0.03, S.dark, 0.075, fy + 0.04, fz - 0.045, steerG);
  const fw = makeWheel(false); fw.position.set(0, fy, fz); steerG.add(fw);
  const htRel = HT.clone().sub(HB);
  tube(V3(0, -0.03, 0), htRel.clone().add(AXIS.clone().multiplyScalar(0.05)), 0.016, 0.016, S.chrome, steerG);
  const stemTop = htRel.clone().add(AXIS.clone().multiplyScalar(0.11)); stemTop.z += 0.03;
  tube(htRel.clone().add(AXIS.clone().multiplyScalar(0.05)), stemTop, 0.02, 0.02, S.dark, steerG);
  box(0.07, 0.04, 0.045, S.dark, 0, stemTop.y, stemTop.z, steerG);
  const by = stemTop.y, bz = stemTop.z;
  for (const s of [-1, 1]) {
    const a = V3(s * 0.04, by, bz), b = V3(s * 0.31, by + 0.025, bz - 0.045);
    tube(a, b, 0.0115, 0.0115, S.dark, steerG);
    tube(a.clone().lerp(b, 0.62), b, 0.018, 0.018, S.rubber, steerG);
    ball(b, 0.016, S.accent, steerG, 1, 1, 1, false);
    tube(a.clone().lerp(b, 0.7), V3(s * 0.24, by - 0.015, bz + 0.065), 0.006, 0.006, S.chrome, steerG);
  }
  ball(V3(-0.11, by + 0.034, bz - 0.005), 0.026, S.chrome, steerG, 1, 0.7, 1, false);
  box(0.05, 0.05, 0.05, S.dark, 0, by - 0.035, bz + 0.07, steerG);
  { const l = mesh(G('CylinderGeometry', 0.026, 0.026, 1, 12), S.glow, steerG, false); l.rotation.x = Math.PI / 2; l.scale.set(1, 0.02, 1); l.position.set(0, by - 0.035, bz + 0.098); }
  const GRIP = V3(0.256, by + 0.021, bz - 0.037);

  /* ---- rider ---- */
  const rider = new THREE.Group(); body.add(rider);
  const hip = V3(0, 0.95, -0.33), sh = V3(0, 1.38, 0.04), tdir = sh.clone().sub(hip), tlen = tdir.length(), alpha = Math.atan2(tdir.z, tdir.y);
  const pivot = new THREE.Group(); pivot.position.copy(hip); rider.add(pivot);
  const torso = new THREE.Group(); torso.quaternion.setFromUnitVectors(_up, tdir.clone().normalize()); pivot.add(torso);
  ball(V3(0, 0.02, 0), 0.14, S.pants, torso, 1.15, 0.8, 0.95);
  { const ab = mesh(G('CylinderGeometry', 0.125, 0.115, 1, 14), mJersey, torso, true); ab.scale.set(1, 0.32, 0.85); ab.position.y = 0.18; }
  ball(V3(0, 0.40, 0), 0.17, mJersey, torso, 1.12, 0.95, 0.74);
  { const st = mesh(G('CylinderGeometry', 0.132, 0.124, 1, 14), S.accent, torso, false); st.scale.set(1, 0.035, 0.85); st.position.y = 0.25; }
  ball(V3(0.2, tlen - 0.01, 0), 0.07, mJersey, torso); ball(V3(-0.2, tlen - 0.01, 0), 0.07, mJersey, torso);
  { const nk = mesh(G('CylinderGeometry', 0.05, 0.056, 1, 10), mSkin, torso, false); nk.scale.set(1, 0.12, 1); nk.position.set(0, tlen + 0.03, 0.02); }
  ball(V3(0, 0.36, -0.17), 0.17, mPack, torso, 0.95, 1.25, 0.62);
  box(0.035, 0.32, 0.012, S.accent, 0, 0.36, -0.265, torso);
  box(0.03, 0.34, 0.012, S.dark, 0.1, 0.40, 0.125, torso); box(0.03, 0.34, 0.012, S.dark, -0.1, 0.40, 0.125, torso);
  const headG = new THREE.Group(); headG.position.set(0, tlen + 0.06, 0.03); headG.rotation.x = -alpha * 0.8; torso.add(headG);
  ball(V3(0, 0.11, 0.02), 0.1, mSkin, headG, 0.92, 1.08, 1.0);
  ball(V3(0, 0.075, 0.113), 0.02, mSkin, headG, 1, 1, 1.1, false);
  ball(V3(0.095, 0.10, 0.0), 0.026, mSkin, headG, 0.6, 1, 1, false); ball(V3(-0.095, 0.10, 0.0), 0.026, mSkin, headG, 0.6, 1, 1, false);
  box(0.17, 0.04, 0.045, S.glass, 0, 0.115, 0.104, headG);
  ball(V3(0, 0.105, -0.035), 0.098, mHair, headG, 1, 0.9, 0.9, false);
  { const hm = new THREE.Mesh(G('SphereGeometry', 0.124, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56), mHelmet); hm.material.side = THREE.DoubleSide; hm.scale.set(1, 0.92, 1.16); hm.position.set(0, 0.125, 0.0); hm.castShadow = true; headG.add(hm); }
  { const vz = box(0.17, 0.012, 0.08, mHelmet, 0, 0.15, 0.125, headG); vz.rotation.x = 0.2; }
  box(0.036, 0.008, 0.2, S.accent, 0, 0.243, 0.0, headG);

  const legs = [], arms = [];
  for (let k = 0; k < 2; k++) {
    const foot = new THREE.Group(); rider.add(foot);
    box(0.095, 0.025, 0.27, S.sole, 0, -0.03, 0.02, foot); box(0.088, 0.05, 0.2, S.shoe, 0, 0.0, 0.0, foot, true); ball(V3(0, -0.005, 0.115), 0.046, S.shoe, foot, 1, 0.75, 1.2, false);
    const th = mesh(G('CylinderGeometry', 0.058, 0.082, 1, 12), S.pants, rider, true), sn = mesh(G('CylinderGeometry', 0.034, 0.05, 1, 10), mSkin, rider, true), sk = mesh(G('CylinderGeometry', 0.04, 0.043, 1, 10), S.shoe, rider, false);
    legs.push({
      crank: mesh(G('CylinderGeometry', 0.014, 0.014, 1, 6), S.dark, rider, false), pedal: box(0.095, 0.02, 0.1, S.dark, 0, 0, 0, rider),
      foot: foot, thigh: th, shin: sn, sock: sk, knee: ball(V3(0, 0, 0), 0.062, S.pants, rider)
    });
    arms.push({
      up: mesh(G('CylinderGeometry', 0.036, 0.05, 1, 10), mJersey, rider, true), lo: mesh(G('CylinderGeometry', 0.03, 0.037, 1, 10), mSkin, rider, true),
      elbow: ball(V3(0, 0, 0), 0.04, mSkin, rider, 1, 1, 1, false), hand: ball(V3(0, 0, 0), 0.048, S.rubber, rider, 1, 0.85, 1.15, false)
    });
  }
  const obj = { root, body, rider, crank: 0, steerG, fw, rw, bubble: null, bubbleT: 0, tag: null };
  obj.pose = function (dt, v, steer, crankRate) {
    obj.crank += crankRate * dt;
    const w = v / WR * dt; rw.rotation.x += w; fw.rotation.x += w;
    steerG.quaternion.setFromAxisAngle(AXIS, steer); steerG.updateMatrix();
    chainring.rotation.x = obj.crank;
    pivot.rotation.z = Math.sin(obj.crank) * 0.03 * clamp(v / 6, 0, 1);
    headG.rotation.y = clamp(steer * 1.6, -0.5, 0.5);
    for (let k = 0; k < 2; k++) {
      const s = k ? 1 : -1, a = obj.crank + (s > 0 ? Math.PI : 0);
      const py = BB.y + Math.sin(a) * 0.17, pz_ = BB.z + Math.cos(a) * 0.17, L = legs[k];
      _a.set(s * 0.085, BB.y, BB.z); _b.set(s * 0.115, py, pz_); limb(L.crank, _a, _b);
      L.pedal.position.set(s * 0.12, py, pz_);
      L.foot.position.set(s * 0.115, py + 0.06, pz_ + 0.015);
      const r = ik2(s * 0.09, 0.95, -0.33, s * 0.115, py + 0.11, pz_ - 0.015, 0.44, 0.45, s * 0.3, 0.25, 1);
      _a.set(s * 0.09, 0.95, -0.33); _b.set(r.kx, r.ky, r.kz); _c.set(r.ex, r.ey, r.ez);
      limb(L.thigh, _a, _b); limb(L.shin, _b, _c); L.knee.position.copy(_b);
      _h.copy(_c).lerp(_b, 0.28); limb(L.sock, _h, _c);
      const A = arms[k];
      _g.set(s * GRIP.x, GRIP.y, GRIP.z).applyMatrix4(steerG.matrix);
      const r2 = ik2(s * 0.2, 1.38, 0.04, _g.x, _g.y, _g.z, 0.29, 0.31, s * 1, -0.6, -0.25);
      _a.set(s * 0.2, 1.38, 0.04); _b.set(r2.kx, r2.ky, r2.kz); _c.set(r2.ex, r2.ey, r2.ez);
      limb(A.up, _a, _b); limb(A.lo, _b, _c); A.elbow.position.copy(_b); A.hand.position.copy(_c);
    }
  };
  obj.pose(0, 0, 0, 0);
  obj.setName = function (name) { if (obj.tag) root.remove(obj.tag); const t = makeLabel(name); t.position.y = 2.35; root.add(t); obj.tag = t; };
  obj.say = function (text) {
    if (obj.bubble) root.remove(obj.bubble);
    const b = makeLabel(text, { w: 384, h: 72, px: 30, bg: 'rgba(241,251,253,0.96)', fg: '#041f29' });
    b.scale.set(3.4, 0.64, 1); b.position.y = 2.95; root.add(b); obj.bubble = b; obj.bubbleT = 4;
  };
  return obj;
}

/* ============================================================
   QUEST OBJECTS: shards, gate
   ============================================================ */
const shards = [];
const GATE = { x: 0, z: 0, y: 0, tx: 0, tz: 1, open: false };
let portalMat, gateGroup, gateRing, gateBeam;

function buildQuest() {
  for (let i = 0; i < 5; i++) {
    const idx = Math.round(SHARD_T[i] * PS), off = (i % 2 ? 1 : -1) * 1.3;
    const x = px[idx] - tz[idx] * off, z = pz[idx] + tx[idx] * off, gy = terrainH(x, z);
    const col = new THREE.Color(SHARD_COL[i]), g = new THREE.Group(); g.position.set(x, gy, z);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.62, 0), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.85, roughness: 0.25, flatShading: true }));
    gem.position.y = 1.6; gem.castShadow = true; g.add(gem);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.045, 8, 40), new THREE.MeshBasicMaterial({ color: col })); ring.rotation.x = Math.PI / 2; ring.position.y = 1.6; g.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 70, 16, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beam.position.y = 35; g.add(beam);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(2.2, 28), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    pad.rotation.x = -Math.PI / 2; pad.position.y = 0.14; g.add(pad);
    g.visible = false;
    shards.push({ g, gem, ring, beam, pad, x, z, armed: false, phase: i * 1.3 });
  }
  // gate
  const e = PS, gx = px[e], gz = pz[e], gy = terrainH(gx, gz);
  GATE.x = gx; GATE.z = gz; GATE.y = gy; GATE.tx = tx[e]; GATE.tz = tz[e]; GATE.open = true;
  const g = new THREE.Group(); g.position.set(gx, gy, gz); g.rotation.y = Math.atan2(tx[e], tz[e]); worldGroup.add(g); gateGroup = g;
  const stone = new THREE.MeshStandardMaterial({ color: 0x3d3672, roughness: 0.85 });
  const trim = new THREE.MeshBasicMaterial({ color: 0x5ef0d0 });
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.9, 13, 1.9), stone); p.position.set(s * 5.6, 6.5, 0); p.castShadow = true; g.add(p);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.25, 12, 0.25), trim); t.position.set(s * 4.6, 6.5, -0.98); g.add(t);
    const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), trim); cap.position.set(s * 5.6, 14, 0); g.add(cap);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(13.2, 1.6, 1.9), stone); lintel.position.set(0, 13, 0); lintel.castShadow = true; g.add(lintel);
  gateRing = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.32, 14, 64), new THREE.MeshStandardMaterial({ color: 0xff6f6f, emissive: 0xff4a4a, emissiveIntensity: 0.9, roughness: 0.4 }));
  gateRing.position.y = 5.2; g.add(gateRing);
  portalMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, c1: { value: new THREE.Color(0x5ef0d0) }, c2: { value: new THREE.Color(0x9b7bff) }, open: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: [
      'varying vec2 vUv; uniform float time; uniform vec3 c1; uniform vec3 c2; uniform float open;',
      'void main(){ vec2 p=vUv-0.5; float r=length(p)*2.0; float a=atan(p.y,p.x);',
      ' float s=sin(a*6.0+time*2.0-r*10.0)*0.5+0.5; float s2=sin(a*3.0-time*1.5+r*14.0)*0.5+0.5;',
      ' vec3 col=mix(c1,c2,s*s2); float alpha=smoothstep(1.0,0.85,r)*(0.35+0.5*(1.0-r))*mix(0.3,1.0,open);',
      ' gl_FragColor=vec4(col*(0.6+0.8*(1.0-r)),alpha); }'
    ].join('\n')
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(4.5, 48), portalMat); disc.position.y = 5.2; g.add(disc);
  gateBeam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 140, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xff6f6f, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  gateBeam.position.y = 70; g.add(gateBeam);
  // sign
  const sc = mkCanvas(1024, 256), sx = sc.getContext('2d');
  const sg = sx.createLinearGradient(0, 0, 1024, 0); sg.addColorStop(0, '#06303d'); sg.addColorStop(1, '#0b4a5c');
  sx.fillStyle = sg; sx.fillRect(0, 0, 1024, 256);
  sx.strokeStyle = '#19d3ea'; sx.lineWidth = 8; sx.strokeRect(10, 10, 1004, 236);
  sx.fillStyle = '#f1fbfd'; sx.textAlign = 'center'; sx.textBaseline = 'middle';
  sx.font = '900 128px "Avenir Next","Trebuchet MS",system-ui,sans-serif'; sx.fillText('KITLAB', 512, 105);
  sx.fillStyle = '#19d3ea'; sx.font = '700 40px "Avenir Next","Trebuchet MS",system-ui,sans-serif'; sx.fillText('a web3 learning world, built by T3kit', 512, 196);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(12.6, 3.15), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc) }));
  sign.position.set(0, 16.3, 0); sign.rotation.y = Math.PI; g.add(sign);
}

function setGateOpen(open) {
  GATE.open = open;
  portalMat.uniforms.open.value = open ? 1 : 0;
  const c = open ? 0x5ef0d0 : 0xff6f6f;
  gateRing.material.color.setHex(c); gateRing.material.emissive.setHex(open ? 0x2ad8b4 : 0xff4a4a);
  gateBeam.material.color.setHex(c); gateBeam.material.opacity = open ? 0.28 : 0.14;
}

/* ============================================================
   TRACK: hazards, boost pads, tokens, dust, score
   ============================================================ */
const hazards = [], pads = [], coins = [], dustPool = [];
let coinMesh = null, padMat = null, dustI = 0;
let score = 0, combo = 1, coinsGot = 0, countdown = 0;
const _dm = new THREE.Object3D();
const CRASH_MSG = ['Crash!', 'Ouch!', 'Wipeout!', 'Rough one!'];

function pop(text, color) {
  const el = $('pop'); el.textContent = text; el.style.color = color || '#f6f1e7';
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
}
function hitFlash() { const h = $('hit'); h.classList.add('on'); setTimeout(() => h.classList.remove('on'), 140); }
function setCoin(k, alive) {
  const c = coins[k];
  _dm.position.set(c.x, c.y, c.z); _dm.rotation.set(0, 0, 0); _dm.scale.set(alive ? 1 : 0, alive ? 1.5 : 0, alive ? 1 : 0);
  _dm.updateMatrix(); coinMesh.setMatrixAt(k, _dm.matrix);
}

function buildTrack() {
  const rnd = mulberry32(4242), evIdx = [], signs = [];
  const nearShard = i => { for (let k = 0; k < SHARD_T.length; k++) if (Math.abs(i - Math.round(SHARD_T[k] * PS)) < 16) return true; return false; };
  const M = (c, r, m) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m || 0, flatShading: true });
  const mRock = M(0x8d8a84, 1), mLog = M(0x6b4a2b, 1), mCrate = M(0xb07a3e, 0.9), mCrate2 = M(0x8a5a2a, 0.9), mBarrel = M(0xc4552d, 0.7), mBand = M(0x2a2a30, 0.6, 0.4), mBoulder = M(0x7a6f66, 1);
  const mPud = new THREE.MeshStandardMaterial({ color: 0x2d4a63, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const logGeo = new THREE.CylinderGeometry(0.36, 0.36, 4.4, 10); logGeo.rotateZ(Math.PI / 2);
  const boxGeo = new THREE.BoxGeometry(1.3, 1.3, 1.3), boxGeo2 = new THREE.BoxGeometry(1.15, 1.15, 1.15);
  const barGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.0, 12), bandGeo = new THREE.TorusGeometry(0.46, 0.035, 6, 16);
  const pudGeo = new THREE.CircleGeometry(2.2, 28), bouGeo = new THREE.IcosahedronGeometry(0.75, 1);
  const at = (i, off) => ({ x: px[i] - tz[i] * off, z: pz[i] + tx[i] * off, yaw: Math.atan2(tx[i], tz[i]), i: i });

  function reg(mesh, x, z, dy, o) {
    mesh.position.set(x, terrainH(x, z) + dy, z); worldGroup.add(mesh);
    const h = Object.assign({ x: x, z: z, mesh: mesh, broken: false, near: false, over: false, crashed: false, skipNear: false }, o);
    hazards.push(h); return h;
  }
  function mkRock(p) { const s = 0.8 + rnd() * 0.45, m = new THREE.Mesh(rockGeo, mRock); m.scale.set(s, s * 0.8, s); m.rotation.set(rnd() * 3, rnd() * 6, rnd() * 3); m.castShadow = true; reg(m, p.x, p.z, s * 0.22, { type: 'rock', r: s * 0.95, h: s * 0.7 }); }
  function mkLog(p) { const m = new THREE.Mesh(logGeo, mLog), a = p.yaw + (rnd() - 0.5) * 0.7; m.rotation.y = a; m.castShadow = true; reg(m, p.x, p.z, 0.36, { type: 'log', ang: a, half: 2.2, r: 2.2, h: 0.72 }); }
  function mkCrate(p) {
    const g = new THREE.Group(), st = rnd() < 0.4, b = new THREE.Mesh(boxGeo, mCrate); b.castShadow = true; g.add(b);
    if (st) { const b2 = new THREE.Mesh(boxGeo2, mCrate2); b2.position.y = 1.22; b2.rotation.y = 0.4; b2.castShadow = true; g.add(b2); }
    g.rotation.y = rnd() * 3; reg(g, p.x, p.z, 0.65, { type: 'crate', r: 0.95, h: st ? 2.4 : 1.3, breakable: true });
  }
  function mkBarrel(p) {
    const g = new THREE.Group(), b = new THREE.Mesh(barGeo, mBarrel); b.castShadow = true; g.add(b);
    for (const y of [-0.25, 0.25]) { const t = new THREE.Mesh(bandGeo, mBand); t.rotation.x = Math.PI / 2; t.position.y = y; g.add(t); }
    reg(g, p.x, p.z, 0.5, { type: 'barrel', r: 0.55, h: 1.0, breakable: true });
  }
  function mkPuddle(p) { const m = new THREE.Mesh(pudGeo, mPud); m.rotation.x = -Math.PI / 2; reg(m, p.x, p.z, 0.1, { type: 'puddle', r: 2.2, h: 0.3 }); }
  function mkRoller(p) {
    const m = new THREE.Mesh(bouGeo, mBoulder); m.castShadow = true;
    const h = reg(m, p.x, p.z, 0.7, { type: 'roller', r: 0.85, h: 1.3 });
    h.cx = p.x; h.cz = p.z; h.nx = -tz[p.i]; h.nz = tx[p.i]; h.amp = 3.1; h.f = 0.9 + rnd() * 0.8; h.ph = rnd() * 6.28;
  }
  const coinAdd = (i, off, hgt) => { const ii = clamp(Math.round(i), 1, PS - 1), p = at(ii, off); coins.push({ x: p.x, z: p.z, y: terrainH(p.x, p.z) + hgt, alive: true }); };

  // obstacle events along the road
  let i = 60;
  while (i < PS - 55) {
    if (!nearShard(i)) {
      evIdx.push(i);
      const roll = rnd(), side = rnd() < 0.5 ? -1 : 1; let lane = -side * 1.9;
      if (roll < 0.24) { const n = 1 + Math.floor(rnd() * 2); for (let k = 0; k < n; k++) mkRock(at(i + k * 3, side * (0.3 + rnd() * 1.5))); }
      else if (roll < 0.44) {
        const off = side * (0.5 + rnd() * 0.8); mkLog(at(i, off)); lane = -side * 2.5;
        const hs = [1.3, 1.9, 2.3, 1.9, 1.3]; for (let k = -2; k <= 2; k++) coinAdd(i + k, off, hs[k + 2]);
      }
      else if (roll < 0.64) { const n = 1 + Math.floor(rnd() * 2); for (let k = 0; k < n; k++) mkCrate(at(i + k * 2, side * (0.4 + rnd() * 1.4))); }
      else if (roll < 0.80) { for (let k = 0; k < 3; k++) mkBarrel(at(i + (k % 2), side * (0.8 + k * 0.9))); }
      else if (roll < 0.90) mkPuddle(at(i, (rnd() - 0.5) * 1.2));
      else mkRoller(at(i, 0));
      signs.push(at(i - 9, (rnd() < 0.5 ? -1 : 1) * 3.9));
      for (let k = 0; k < 8; k++) coinAdd(i - 12 + k * 2, roll >= 0.90 ? 0 : lane, 1.1);
    }
    i += 17 + Math.floor(rnd() * 22);
  }
  // weaving token trails
  for (let j = 140; j < PS - 70; j += 85) {
    if (nearShard(j) || evIdx.some(e => Math.abs(e - j) < 14)) continue;
    for (let k = 0; k < 10; k++) coinAdd(j + k * 2, Math.sin(k * 0.8) * 2, 1.1);
  }
  // boost pads
  const pc = mkCanvas(128, 256), pq = pc.getContext('2d');
  pq.lineCap = 'round'; pq.lineJoin = 'round'; pq.strokeStyle = '#5ef0d0'; pq.lineWidth = 20;
  for (let k = 0; k < 3; k++) { const y = 30 + k * 66; pq.globalAlpha = 0.5 + k * 0.25; pq.beginPath(); pq.moveTo(18, y); pq.lineTo(64, y + 46); pq.lineTo(110, y); pq.stroke(); }
  padMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(pc), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  for (let j = 90; j < PS - 60; j += 48 + Math.floor(rnd() * 36)) {
    if (nearShard(j) || evIdx.some(e => Math.abs(e - j) < 8)) continue;
    const p = at(j, (rnd() - 0.5) * 3.0);
    const pitch = Math.atan2(terrainH(p.x + tx[j] * 2, p.z + tz[j] * 2) - terrainH(p.x - tx[j] * 2, p.z - tz[j] * 2), 4);
    const g = new THREE.Group(); g.rotation.order = 'YXZ'; g.rotation.y = p.yaw; g.rotation.x = -pitch; g.position.set(p.x, terrainH(p.x, p.z) + 0.16, p.z);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 4.4), padMat); m.rotation.x = -Math.PI / 2; g.add(m); worldGroup.add(g);
    pads.push({ x: p.x, z: p.z, cool: 0 });
  }
  // tokens
  coinMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.36, 0), new THREE.MeshBasicMaterial({ color: 0xffd35e }), Math.max(coins.length, 1));
  coinMesh.frustumCulled = false; coins.forEach((c, k) => setCoin(k, true)); coinMesh.instanceMatrix.needsUpdate = true; worldGroup.add(coinMesh);
  // warning signs
  const tri = new THREE.CylinderGeometry(0.62, 0.62, 0.07, 3); tri.rotateX(-Math.PI / 2);
  const tri2 = new THREE.CylinderGeometry(0.3, 0.3, 0.09, 3); tri2.rotateX(-Math.PI / 2);
  const sg = mergeColored([{ geo: new THREE.CylinderGeometry(0.05, 0.05, 2.3, 6), color: 0x555560, y: 1.15 }, { geo: tri, color: 0xffb454, y: 2.5 }, { geo: tri2, color: 0x2a1a00, y: 2.45 }]);
  const sm = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, emissive: 0x2a1a00 }), Math.max(signs.length, 1));
  signs.forEach((p, k) => { _dm.position.set(p.x, terrainH(p.x, p.z), p.z); _dm.rotation.set(0, p.yaw, 0); _dm.scale.setScalar(1); _dm.updateMatrix(); sm.setMatrixAt(k, _dm.matrix); });
  sm.count = signs.length; sm.frustumCulled = false; worldGroup.add(sm);
}

function buildDust() {
  const c = mkCanvas(64, 64), x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  for (let i = 0; i < 44; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, color: 0xcdb48a }));
    s.visible = false; scene.add(s); dustPool.push({ s: s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 1 });
  }
}
function puff(x, y, z, vx, vy, vz, life, size, color) {
  const d = dustPool[dustI++ % dustPool.length]; if (!d) return;
  d.life = life; d.max = life; d.vx = vx; d.vy = vy; d.vz = vz; d.size = size; d.s.position.set(x, y, z); d.s.material.color.setHex(color); d.s.visible = true;
}
function updateDust(dt) {
  for (let i = 0; i < dustPool.length; i++) {
    const d = dustPool[i]; if (d.life <= 0) continue;
    d.life -= dt; if (d.life <= 0) { d.s.visible = false; continue; }
    const k = 1 - d.life / d.max, p = d.s.position;
    p.x += d.vx * dt; p.y += d.vy * dt; p.z += d.vz * dt; d.vy *= 0.96;
    d.s.scale.setScalar(d.size * (0.6 + k * 1.6)); d.s.material.opacity = 0.55 * (1 - k);
  }
}

function wipeout(reason) {
  if (wipeoutPending || !started) return;
  wipeoutPending = true; combo = 1; shake = 0.85; hitFlash();
  const lines = ['Oof! Back to the start 😵', 'The road won that round 😂', 'That was a committed tumble.', 'Resetting. We go again!'];
  autoBubble(lines[Math.floor(Math.random() * lines.length)]);
  crashSound(); toast((reason || 'Wipeout') + ' — starting over!', 1800);
  flash(() => {});
  setTimeout(() => {
    if (!started) { wipeoutPending = false; return; }
    $('modal').classList.add('hide'); $('arrive').classList.add('hide'); modalOpen = false;
    resetRun(); P.stamina = 1; P.stuck = 0; wipeoutPending = false;
    toast('Back at the start. One more try!', 2200);
  }, 750);
}
function crash(h, dx, dz) {
  if (wipeoutPending) return;
  h.crashed = true; hitFlash(); pop(CRASH_MSG[Math.floor(Math.random() * CRASH_MSG.length)], '#ff6b78');
  if (h.breakable) {
    h.broken = true; h.mesh.visible = false;
    for (let i = 0; i < 8; i++) puff(h.x, P.y + 0.6, h.z, (Math.random() - 0.5) * 7, 2 + Math.random() * 3, (Math.random() - 0.5) * 7, 0.9, 0.9, h.type === 'crate' ? 0xb07a3e : 0xc4552d);
  }
  wipeout('Obstacle collision');
}
function treeCrash() { if (wipeoutPending) return; hitFlash(); pop('Tree!', '#ff6b78'); wipeout('Tree collision'); }
function closeCall() { combo = Math.min(8, combo + 1); const pts = 20 * combo; score += pts; pop('Close call +' + pts, '#ffc14d'); whoosh(); }
function cleanJump() { combo = Math.min(8, combo + 1); const pts = 30 * combo; score += pts; pop('Clean jump +' + pts, '#6be59a'); chime(); }

function updateHazards(dt) {
  const now = Date.now() / 1000, air = P.y - groundAt(0, P.x, P.z);
  for (let k = 0; k < hazards.length; k++) {
    const h = hazards[k];
    if (h.type === 'roller') {
      const off = Math.sin(now * h.f + h.ph) * h.amp; h.x = h.cx + h.nx * off; h.z = h.cz + h.nz * off;
      h.mesh.position.set(h.x, terrainH(h.x, h.z) + 0.7, h.z); h.mesh.rotation.z += dt * 5 * Math.cos(now * h.f + h.ph);
    }
    if (h.broken) continue;
    const dx = P.x - h.x, dz = P.z - h.z;
    if (dx * dx + dz * dz > 900) { h.near = false; continue; }
    let gap;
    if (h.type === 'log') {
      const a = h.ang, ax = Math.cos(a), az = -Math.sin(a), qx = Math.sin(a), qz = Math.cos(a);
      const s = dx * ax + dz * az, q = dx * qx + dz * qz;
      gap = Math.max(Math.abs(s) - (h.half + 0.35), Math.abs(q) - 0.8); h._q = q; h._qx = qx; h._qz = qz;
    } else gap = Math.sqrt(dx * dx + dz * dz) - (h.r + 0.42);
    if (h.type === 'puddle') {
      if (gap < 0 && air < 0.35) { if (P.mud <= 0) { toast('Mud! Steering gets slippery.', 1400); puff(P.x, P.y + 0.3, P.z, 0, 2, 0, 0.7, 0.8, 0x4a6a80); } P.mud = 0.5; }
      continue;
    }
    if (gap < 0) {
      if (air > h.h) { if (!h.over) { h.over = true; h.skipNear = true; cleanJump(); } }
      else if (P.inv <= 0) crash(h, dx, dz);
    } else {
      if (gap < 1.6) h.near = true;
      else if (gap > 3) {
        if (h.near && !h.crashed && !h.skipNear && P.v > 10) closeCall();
        h.near = false; h.skipNear = false; h.over = false;
      }
    }
  }
}

function updatePickups(dt) {
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i]; if (p.cool > 0) { p.cool -= dt; continue; }
    const dx = P.x - p.x, dz = P.z - p.z;
    if (dx * dx + dz * dz < 5 && P.grounded) { p.cool = 2.5; P.v = Math.min(46, P.v + 9); P.padT = 1.6; P.stun = 0; pop('Boost!', '#19d3ea'); whoosh(); }
  }
  let changed = false;
  for (let i = 0; i < coins.length; i++) {
    const c = coins[i]; if (!c.alive) continue;
    const dx = P.x - c.x, dz = P.z - c.z;
    if (dx * dx + dz * dz < 6.5 && Math.abs(P.y + 0.9 - c.y) < 2.2) { c.alive = false; setCoin(i, false); changed = true; coinsGot++; score += 5 * combo; coinSound(); }
  }
  if (changed) coinMesh.instanceMatrix.needsUpdate = true;
}
function resetTrack() {
  hazards.forEach(h => { h.broken = false; h.near = false; h.over = false; h.crashed = false; h.skipNear = false; h.mesh.visible = true; });
  coins.forEach((c, k) => { c.alive = true; setCoin(k, true); }); if (coinMesh) coinMesh.instanceMatrix.needsUpdate = true;
  pads.forEach(p => { p.cool = 0; });
}

/* ============================================================
   KITLAB HUB (destination)
   ============================================================ */
const hubObs = [];
const pedestals = [];
let hubMotes, hubKnot, hubLights = [];
function buildHub() {
  const gc = mkCanvas(256, 256), gx = gc.getContext('2d');
  gx.fillStyle = '#1a1540'; gx.fillRect(0, 0, 256, 256);
  gx.strokeStyle = 'rgba(94,240,208,0.55)'; gx.lineWidth = 2;
  for (let i = 0; i <= 256; i += 32) { gx.beginPath(); gx.moveTo(i, 0); gx.lineTo(i, 256); gx.stroke(); gx.beginPath(); gx.moveTo(0, i); gx.lineTo(256, i); gx.stroke(); }
  const gt = new THREE.CanvasTexture(gc); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(8, 8);
  const sideM = new THREE.MeshStandardMaterial({ color: 0x241c58, roughness: 0.7 });
  const topM = new THREE.MeshStandardMaterial({ map: gt, roughness: 0.6, metalness: 0.2 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(HUB.R, HUB.R * 0.9, 2, 64), [sideM, topM, sideM]);
  disc.position.set(HUB.x, HUB.y - 1, HUB.z); disc.receiveShadow = true; hubGroup.add(disc);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(HUB.R - 0.3, 0.2, 8, 96), new THREE.MeshBasicMaterial({ color: 0x5ef0d0 }));
  edge.rotation.x = Math.PI / 2; edge.position.set(HUB.x, HUB.y + 0.1, HUB.z); hubGroup.add(edge);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2, py = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 14, 6), sideM);
    py.position.set(HUB.x + Math.cos(a) * (HUB.R - 1.5), HUB.y + 7, HUB.z + Math.sin(a) * (HUB.R - 1.5)); py.castShadow = true; hubGroup.add(py);
    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(SHARD_COL[i % 5]) }));
    tip.position.set(py.position.x, HUB.y + 14.8, py.position.z); hubGroup.add(tip);
  }
  // monument
  hubKnot = new THREE.Mesh(new THREE.TorusKnotGeometry(3.2, 0.75, 120, 14, 2, 3), new THREE.MeshStandardMaterial({ color: 0x9b7bff, emissive: 0x6a4cff, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.4 }));
  hubKnot.position.set(HUB.x, HUB.y + 8, HUB.z); hubGroup.add(hubKnot);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.6, 1.2, 8), sideM); base.position.set(HUB.x, HUB.y + 0.6, HUB.z); base.castShadow = true; hubGroup.add(base);
  hubObs.push({ x: HUB.x, z: HUB.z, r: 3.6 });
  const sc = mkCanvas(1024, 256), sx = sc.getContext('2d');
  sx.textAlign = 'center'; sx.textBaseline = 'middle'; sx.fillStyle = '#f1fbfd'; sx.font = '900 150px "Avenir Next","Trebuchet MS",system-ui,sans-serif'; sx.fillText('KITLAB', 512, 105);
  sx.fillStyle = '#19d3ea'; sx.font = '700 44px "Avenir Next","Trebuchet MS",system-ui,sans-serif'; sx.fillText('a web3 learning world, built by T3kit', 512, 205);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
  sp.scale.set(22, 5.5, 1); sp.position.set(HUB.x, HUB.y + 19, HUB.z); hubGroup.add(sp);
  // pedestals
  const shapes = [() => new THREE.BoxGeometry(1.6, 1.1, 0.4), () => new THREE.TorusKnotGeometry(0.7, 0.22, 60, 8), () => new THREE.TorusGeometry(0.8, 0.25, 8, 20), () => new THREE.DodecahedronGeometry(0.95, 0), () => new THREE.ConeGeometry(0.8, 1.7, 7)];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * 0.62 + Math.PI, r = 27;
    const x = HUB.x + Math.cos(a) * r, z = HUB.z + Math.sin(a) * r, col = new THREE.Color(SHARD_COL[i]);
    const pb = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.9, 1.2, 10), sideM); pb.position.set(x, HUB.y + 0.6, z); pb.castShadow = true; hubGroup.add(pb);
    const pr = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.08, 6, 30), new THREE.MeshBasicMaterial({ color: col })); pr.rotation.x = Math.PI / 2; pr.position.set(x, HUB.y + 1.25, z); hubGroup.add(pr);
    const holo = new THREE.Mesh(shapes[i](), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.8, roughness: 0.3, flatShading: true }));
    holo.position.set(x, HUB.y + 3.4, z); holo.castShadow = true; hubGroup.add(holo);
    const lab = makeLabel(LESSONS[i].title, { w: 384, h: 72, px: 32 }); lab.scale.set(4.2, 0.8, 1); lab.position.set(x, HUB.y + 5.6, z); hubGroup.add(lab);
    hubObs.push({ x, z, r: 1.9 });
    pedestals.push({ x, z, holo, cool: 0 });
  }
  // motes
  const mp = new Float32Array(300 * 3), rr = mulberry32(21);
  for (let i = 0; i < 300; i++) { const a = rr() * 6.283, r = Math.sqrt(rr()) * HUB.R; mp[i * 3] = HUB.x + Math.cos(a) * r; mp[i * 3 + 1] = HUB.y + 1 + rr() * 22; mp[i * 3 + 2] = HUB.z + Math.sin(a) * r; }
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  hubMotes = new THREE.Points(mg, new THREE.PointsMaterial({ color: 0x9ff7e4, size: 0.35, transparent: true, opacity: 0.8, depthWrite: false })); hubGroup.add(hubMotes);
  const l1 = new THREE.PointLight(0x5ef0d0, 1.1, 90); l1.position.set(HUB.x, HUB.y + 12, HUB.z); hubGroup.add(l1);
  const l2 = new THREE.PointLight(0x9b7bff, 1.0, 90); l2.position.set(HUB.x + 10, HUB.y + 5, HUB.z - 10); hubGroup.add(l2);
}

/* ============================================================
   STATE
   ============================================================ */
let ready = false, started = false, modalOpen = false, modalIdx = -1, modalMode = 'quiz';
let zone = 0, finished = false, finishTime = 0, runTime = 0;
const collected = [false, false, false, false, false]; let collectedCount = 0;
const P = { x: 0, z: 0, y: 0, yaw: 0, v: 0, steerAng: 0, lean: 0, vy: 0, grounded: true, pitch: 0, stamina: 1, pathIdx: 0, lastGy: 0, stun: 0, inv: 0, padT: 0, mud: 0, jumpCd: 0, stuck: 0 };
let camYaw = 0, camMode = 0, shake = 0, menuAng = 0, myName = 'Rider', myColor = 0, myId = '', myRoom = 'kitlab', usedKeyboard = false, lastGateMsg = 0, wipeoutPending = false, lastSocialAt = 0;
let me = null;
const keys = {}, touch = { steer: 0, brake: false, boost: false, jump: false };

function placeAtPath(i, back) {
  P.pathIdx = i; P.x = px[i] - tx[i] * (back || 0); P.z = pz[i] - tz[i] * (back || 0);
  P.yaw = Math.atan2(tx[i], tz[i]); camYaw = P.yaw; P.v = 0; P.vy = 0; P.steerAng = 0; P.lean = 0; P.stun = 0; P.inv = 0; P.padT = 0; P.mud = 0;
  P.y = terrainH(P.x, P.z); P.lastGy = P.y; P.grounded = true;
}

/* ============================================================
   AUDIO
   ============================================================ */
let AC = null, masterBus = null, sfxBus = null, muted = false;
function audioInit() {
  try {
    if (!AC || AC.state === 'closed') {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      masterBus = AC.createGain(); masterBus.gain.value = 0.58; masterBus.connect(AC.destination);
      sfxBus = AC.createGain(); sfxBus.gain.value = 0.62; sfxBus.connect(masterBus);
      Music.playing = false;
    }
    if (AC.state === 'suspended') AC.resume().catch(() => {});
    return AC;
  } catch (e) { return null; }
}
function tone(freq, t0, dur, vol, type) {
  if (!AC || muted) return;
  const t = AC.currentTime + t0, osc = AC.createOscillator(), gain = AC.createGain();
  osc.type = type || 'sine'; osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t); gain.gain.linearRampToValueAtTime(Math.max(0.0002, vol), t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain); gain.connect(sfxBus || masterBus); osc.start(t); osc.stop(t + dur + 0.025);
}
function bellSound() {
  if (!AC || muted) return;
  const t = AC.currentTime + 0.005;
  // A tiny mechanical strike plus inharmonic metal resonances for a bicycle bell.
  const clickLen = Math.max(1, Math.floor(AC.sampleRate * 0.012));
  const clickBuffer = AC.createBuffer(1, clickLen, AC.sampleRate), data = clickBuffer.getChannelData(0);
  for (let i = 0; i < clickLen; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / clickLen, 2);
  const click = AC.createBufferSource(), clickFilter = AC.createBiquadFilter(), clickGain = AC.createGain();
  click.buffer = clickBuffer; clickFilter.type = 'highpass'; clickFilter.frequency.value = 2100;
  clickGain.gain.setValueAtTime(0.0001, t); clickGain.gain.linearRampToValueAtTime(0.055, t + 0.0015);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
  click.connect(clickFilter); clickFilter.connect(clickGain); clickGain.connect(sfxBus || masterBus); click.start(t);
  [[2210, 0.11, 1.15], [2785, 0.16, 1.45], [3510, 0.075, 1.0], [4270, 0.035, 0.72]].forEach(([hz, level, decay]) => {
    const osc = AC.createOscillator(), gain = AC.createGain(), filter = AC.createBiquadFilter();
    osc.type = 'sine'; osc.frequency.setValueAtTime(hz, t); osc.frequency.exponentialRampToValueAtTime(hz * 0.998, t + decay);
    filter.type = 'lowpass'; filter.frequency.value = 5200;
    gain.gain.setValueAtTime(0.0001, t); gain.gain.linearRampToValueAtTime(level, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(filter); filter.connect(gain); gain.connect(sfxBus || masterBus); osc.start(t); osc.stop(t + decay + 0.035);
  });
}
function chime() { if (!AC || muted) return; [523.25, 659.25, 783.99].forEach((f, i) => tone(f, i * 0.075, 0.28, 0.045, 'sine')); }
function thump() { if (!AC || muted) return; tone(78, 0, 0.11, 0.065, 'sine'); }
function coinSound() { if (!AC || muted) return; tone(1046, 0, 0.09, 0.035, 'sine'); tone(1568, 0.045, 0.14, 0.025, 'sine'); }
function crashSound() { if (!AC || muted) return; tone(92, 0, 0.16, 0.08, 'triangle'); tone(58, 0.025, 0.22, 0.055, 'sine'); }
function whoosh() { if (!AC || muted) return; tone(330, 0, 0.12, 0.018, 'triangle'); }

/* ---------- fresh, gentle generative lofi ---------- */
const Music = { on: true, playing: false, mg: null, lp: null, bpm: 72, next: 0, step: 0, bar: 0, timer: null, mood: 0 };
const LOFI_CHORDS = [[48,55,60,64,67],[45,52,57,60,64],[41,48,53,57,60],[43,50,55,59,62]];
const midiHz = n => 440 * Math.pow(2, (n - 69) / 12);
Music.init = function () {
  if (!AC || this.mg) return;
  this.lp = AC.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 1850; this.lp.Q.value = 0.45;
  this.mg = AC.createGain(); this.mg.gain.value = this.on ? 0.23 : 0;
  this.lp.connect(this.mg); this.mg.connect(masterBus || AC.destination);
};
Music.note = function (midi, t, dur, level, kind) {
  if (!AC || !this.lp) return;
  const osc = AC.createOscillator(), gain = AC.createGain();
  osc.type = kind || 'triangle'; osc.frequency.value = midiHz(midi) * (1 + (Math.random() - 0.5) * 0.0015);
  gain.gain.setValueAtTime(0.0001, t); gain.gain.linearRampToValueAtTime(level, t + 0.025);
  gain.gain.setTargetAtTime(level * 0.45, t + 0.03, 0.22);
  gain.gain.setTargetAtTime(0.0001, t + Math.max(0.08, dur - 0.18), 0.12);
  osc.connect(gain); gain.connect(this.lp); osc.start(t); osc.stop(t + dur + 0.12);
};
Music.kick = function (t) {
  const o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine';
  o.frequency.setValueAtTime(105, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.055, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  o.connect(g); g.connect(this.lp); o.start(t); o.stop(t + 0.2);
};
Music.tick = function () {
  if (!AC || !this.lp || !this.on) return;
  const beat = 60 / this.bpm;
  while (this.next < AC.currentTime + 0.12) {
    const t = this.next, step = this.step, chord = LOFI_CHORDS[this.bar % LOFI_CHORDS.length];
    if (step === 0) chord.forEach((n, i) => this.note(n, t + i * 0.012, beat * 3.7, i === 0 ? 0.018 : 0.012, 'sine'));
    if (step === 0 || step === 8) this.note(chord[0] - 12, t, beat * 1.2, 0.038, 'sine');
    if (step === 4 || step === 12) this.kick(t);
    if (step === 12) this.note(chord[2] + 12, t, beat * 0.7, 0.012, 'triangle');
    if (step === 6 || step === 14) this.note(chord[step === 6 ? 2 : 3] + 12, t, beat * 0.45, 0.012, 'sine');
    this.step++; this.next += beat / 4;
    if (this.step >= 16) { this.step = 0; this.bar++; }
  }
};
Music.start = function () {
  if (!audioInit()) return;
  this.init();
  if (AC.state === 'suspended') AC.resume().catch(() => {});
  if (this.playing) { this.next = AC.currentTime + 0.08; return; }
  this.playing = true; this.next = AC.currentTime + 0.12;
  if (this.timer) clearInterval(this.timer);
  this.timer = setInterval(() => {
    if (!AC || AC.state !== 'running') return;
    if (this.next < AC.currentTime - 0.12) this.next = AC.currentTime + 0.04;
    this.tick();
  }, 40);
};
Music.setOn = function (on) {
  this.on = !!on;
  if (AC) this.next = AC.currentTime + 0.08;
  if (this.mg && AC) this.mg.gain.setTargetAtTime(this.on ? 0.23 : 0, AC.currentTime, 0.08);
};

/* ============================================================
   UI HELPERS
   ============================================================ */
let toastTimer = 0;
function toast(msg, ms) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms || 2600);
}
function buildPips() { const p = $('pips'); if (p) p.innerHTML = ''; }
function updatePips() {}
function objective() { if (zone === 1) return { txt: 'Explore the hub', x: HUB.x, z: HUB.z }; return { txt: 'Ride to the Kitlab gate', x: GATE.x, z: GATE.z }; }

/* ---- lesson modal ---- */
function openLesson(i, mode) {
  modalOpen = true; modalIdx = i; modalMode = mode;
  const L = LESSONS[i];
  $('mGem').style.background = SHARD_COL[i];
  $('mTitle').textContent = L.title;
  $('mStep').textContent = 'Lesson recap';
  $('mBody').textContent = L.body;
  $('mFb').textContent = ''; $('mFb').style.color = '';
  const opts = $('mOpts'); opts.innerHTML = '';
  if (mode === 'quiz') {
    $('mQ').textContent = L.q; $('mQ').classList.remove('hide');
    L.opts.forEach((o, k) => {
      const b = document.createElement('button'); b.className = 'opt'; b.textContent = o;
      b.addEventListener('click', () => answer(i, k, b));
      opts.appendChild(b);
    });
    $('mTake').classList.add('hide'); $('mLater').textContent = 'Not now';
  } else {
    $('mQ').classList.add('hide'); $('mTake').classList.add('hide'); $('mLater').textContent = 'Close lesson';
    $('mFb').textContent = L.why;
  }
  $('modal').classList.remove('hide');
}
function answer(i, k, btn) {
  const L = LESSONS[i];
  if (k === L.ans) {
    btn.classList.add('good');
    Array.prototype.forEach.call($('mOpts').children, b => { b.disabled = true; });
    $('mFb').textContent = 'Right. ' + L.why; $('mFb').style.color = '#7df0a6';
    $('mTake').classList.remove('hide'); $('mLater').classList.add('hide'); chime();
  } else {
    btn.classList.add('bad'); btn.disabled = true;
    $('mFb').textContent = 'Not quite. Read the lesson again and try another answer.'; $('mFb').style.color = '#ff9aa5';
  }
}
function closeModal(takeIt) {
  const i = modalIdx;
  $('modal').classList.add('hide'); $('mLater').classList.remove('hide'); modalOpen = false;
  if (modalMode === 'quiz') {
    if (takeIt) collectShard(i); else shards[i].armed = false;
  } else if (pedestals[i]) pedestals[i].cool = 10;
  modalIdx = -1;
}
function collectShard(i) {
  if (collected[i]) return;
  collected[i] = true; collectedCount++;
  const s = shards[i]; s.gem.scale.setScalar(0.45); s.gem.material.emissiveIntensity = 0.15; s.gem.material.color.setHex(0x777788); s.gem.material.emissive.setHex(0x222233);
  s.beam.visible = false; s.pad.visible = false; s.ring.visible = false;
  updatePips(); chime();
  if (collectedCount === 5) setGateOpen(true);
}

/* ---- automatic rider chatter ---- */
const emote = { text: '', t: 0 };
const socialSeen = new Map();
function autoBubble(text) {
  if (!started || !me) return;
  emote.text = text; emote.t = Date.now(); me.say(text); netSendNow();
}
function ringBell() { bellSound(); }

/* ============================================================
   MULTIPLAYER (shared artifact storage, polled)
   ============================================================ */
const Net = { stale: new Map(), mode: 'init', myKey: '', boardKey: '', pre: '', last: 0, lastPoll: 0, busy: false, fails: 0, sending: false };
const remotes = new Map();
function storageOK() { return !!(window.storage && !window.storage.__rideKitlabLocal && typeof window.storage.set === 'function'); }

function myState() {
  return { n: myName, c: myColor, x: +P.x.toFixed(2), z: +P.z.toFixed(2), y: +P.y.toFixed(2), w: +P.yaw.toFixed(3), v: +P.v.toFixed(2), s: +P.steerAng.toFixed(3), l: +P.lean.toFixed(3), zn: zone, t: Date.now(), e: emote.text, et: emote.t, sh: collectedCount, f: finishTime ? +finishTime.toFixed(1) : 0 };
}
async function netInit() {
  Net.pre = myRoom + ':p:'; Net.myKey = Net.pre + myId; Net.boardKey = myRoom + ':b:' + myId;
  try {
    if (!storageOK()) throw new Error('no storage');
    const r = await window.storage.set(Net.myKey, JSON.stringify(myState()), true);
    if (!r) throw new Error('set failed');
    Net.mode = 'live';
  } catch (e) { Net.mode = 'solo'; spawnGhosts(); }
  updateStatus();
}
async function netSendNow() {
  if (Net.mode !== 'live' || Net.sending) return;
  Net.sending = true;
  try { await window.storage.set(Net.myKey, JSON.stringify(myState()), true); Net.fails = 0; }
  catch (e) { Net.fails++; if (Net.fails > 6) { Net.mode = 'solo'; spawnGhosts(); updateStatus(); } }
  Net.sending = false;
}
function ensureRemote(id, s) {
  let r = remotes.get(id);
  if (!r) {
    const c = (s.c | 0) % RIDER_PAL.length;
    const bike = makeBike(RIDER_PAL[c], JERSEY_PAL[(c + 3) % JERSEY_PAL.length], RIDER_PAL[(c + 4) % RIDER_PAL.length]);
    bike.setName(String(s.n || 'Rider').slice(0, 14)); scene.add(bike.root); bike.root.visible = false;
    r = { id, bike, state: s, recv: performance.now(), lastT: 0, seen: performance.now(), live: false, init: false, x: s.x, z: s.z, yaw: s.w, lastE: s.et || 0, ghost: false, color: RIDER_PAL[c] };
    remotes.set(id, r);
  }
  return r;
}
function dropRemote(id) { const r = remotes.get(id); if (!r) return; scene.remove(r.bike.root); remotes.delete(id); }

async function netPoll() {
  if (Net.busy || Net.mode !== 'live') return;
  Net.busy = true;
  try {
    const res = await window.storage.list(Net.pre, true);
    const keysL = ((res && res.keys) || []).filter(k => k !== Net.myKey).slice(0, 16);
    const vals = await Promise.all(keysL.map(k => window.storage.get(k, true).then(r => (r ? { k, v: JSON.parse(r.value) } : null)).catch(() => null)));
    const now = performance.now(), present = new Set();
    for (const it of vals) {
      if (!it || !it.v) continue;
      const id = it.k.slice(Net.pre.length), s = it.v; present.add(id);
      const r = ensureRemote(id, s);
      if (s.t !== r.lastT) {
        if (r.lastT !== 0) r.live = true;
        r.lastT = s.t; r.seen = now; r.state = s; r.recv = now;
        if (s.et && s.et !== r.lastE && s.e) { r.lastE = s.et; if (r.live) r.bike.say(String(s.e).slice(0, 24)); }
      }
      let st = Net.stale.get(id);
      if (!st || st.t !== s.t) Net.stale.set(id, { t: s.t, since: now });
      else if (now - st.since > 25000) { try { window.storage.delete(it.k, true); } catch (e) { } Net.stale.delete(id); }
    }
    remotes.forEach((r, id) => { if (r.ghost) return; if (!present.has(id) || performance.now() - r.seen > 9000) { if (!present.has(id) || r.live) { dropRemote(id); } } });
    Net.fails = 0;
  } catch (e) { Net.fails++; if (Net.fails > 6) { Net.mode = 'solo'; spawnGhosts(); } }
  Net.busy = false;
  updateStatus();
}

/* ghost riders when storage is unavailable */
const GHOSTS = ['Mira', 'Tobi', 'Juno', 'Axel'];
let ghostsOn = false;
function spawnGhosts() {
  if (ghostsOn) return; ghostsOn = true;
  GHOSTS.forEach((n, i) => {
    const r = ensureRemote('ghost' + i, { n, c: i * 2 + 1, x: 0, z: 0, y: 0, w: 0, v: 7, s: 0, l: 0, zn: 0, t: 1, e: '', et: 0, sh: 0, f: 0 });
    r.ghost = true; r.live = true; r.gs = (i * 0.07 + 0.02) * PATH_LEN; r.gsp = 14 + i * 2.4; r.goff = (i % 2 ? 1 : -1) * (0.9 + i * 0.3);
  });
}
function updateGhosts(dt) {
  remotes.forEach(r => {
    if (!r.ghost) return;
    r.gs += r.gsp * dt; if (r.gs > PATH_LEN * 0.985) r.gs = 0;
    const f = clamp(r.gs / PATH_LEN * PS, 0, PS - 1.001), i = Math.floor(f), k = f - i;
    const x = lerp(px[i], px[i + 1], k) - tz[i] * r.goff, z = lerp(pz[i], pz[i + 1], k) + tx[i] * r.goff;
    const w = Math.atan2(tx[i], tz[i]);
    r.state = { n: r.state.n, c: r.state.c, x, z, y: 0, w, v: r.gsp, s: 0, l: 0, zn: 0, e: '', et: 0, sh: Math.min(5, Math.floor(r.gs / PATH_LEN * 6)), f: 0 };
    r.recv = performance.now();
  });
}

function updateRemotes(dt) {
  const now = performance.now();
  remotes.forEach(r => {
    if (!r.live) { r.bike.root.visible = false; return; }
    const s = r.state, age = Math.min((now - r.recv) / 1000, 1.5);
    const tx_ = s.x + Math.sin(s.w) * s.v * age, tz_ = s.z + Math.cos(s.w) * s.v * age, k = 1 - Math.exp(-dt * 5);
    if (!r.init) { r.x = tx_; r.z = tz_; r.yaw = s.w; r.init = true; }
    else { r.x += (tx_ - r.x) * k; r.z += (tz_ - r.z) * k; r.yaw += angDiff(s.w, r.yaw) * k; }
    const vis = (s.zn | 0) === zone && started;
    r.bike.root.visible = vis;
    if (!vis) return;
    const zn = s.zn | 0, f = Math.sin(r.yaw), g = Math.cos(r.yaw);
    const gy = groundAt(zn, r.x, r.z), gF = groundAt(zn, r.x + f * 0.55, r.z + g * 0.55), gR = groundAt(zn, r.x - f * 0.55, r.z - g * 0.55);
    const root = r.bike.root; root.position.set(r.x, gy, r.z);
    root.rotation.y = r.yaw; root.rotation.x = -Math.atan2(gF - gR, 1.1); root.rotation.z = -(s.l || 0);
    r.bike.pose(dt, s.v, s.s || 0, s.v > 0.3 ? s.v * 1.32 : 0);
    if (r.bike.bubbleT > 0) { r.bike.bubbleT -= dt; if (r.bike.bubbleT <= 0 && r.bike.bubble) { root.remove(r.bike.bubble); r.bike.bubble = null; } }
    if (vis) {
      const near = Math.hypot(P.x - r.x, P.z - r.z), last = socialSeen.get(r.id) || 0;
      if (near < 7.5 && now - last > 12000 && now - lastSocialAt > 5000) {
        socialSeen.set(r.id, now); lastSocialAt = now;
        const greetings = ['Yo, nice wheels! 👋', 'On your left! 😎', 'Clean ride!', 'Race you to KitLab 😂', 'Hey rider! Keep rolling ✨', 'Bro, save some road for us 😂'];
        autoBubble(greetings[Math.floor(Math.random() * greetings.length)]);
      }
    }
  });
}

async function postScore() {
  if (Net.mode !== 'live') return;
  try { await window.storage.set(Net.boardKey, JSON.stringify({ n: myName, t: +finishTime.toFixed(1), s: Math.floor(score) }), true); } catch (e) { }
}
async function loadBoard() {
  const rows = [];
  if (Net.mode === 'live') {
    try {
      const res = await window.storage.list(myRoom + ':b:', true);
      const ks = ((res && res.keys) || []).slice(0, 30);
      const vals = await Promise.all(ks.map(k => window.storage.get(k, true).then(r => (r ? JSON.parse(r.value) : null)).catch(() => null)));
      vals.forEach(v => { if (v && typeof v.t === 'number') rows.push(v); });
    } catch (e) { }
  }
  if (finished && !rows.some(r => r.n === myName && Math.abs(r.t - finishTime) < 0.2)) rows.push({ n: myName, t: finishTime, s: Math.floor(score) });
  rows.sort((a, b) => a.t - b.t);
  return rows.slice(0, 8);
}
function renderBoard(el, rows) {
  if (!rows.length) { el.innerHTML = '<div class="brow"><b>No finishers yet. Be the first through the gate.</b></div>'; return; }
  el.innerHTML = rows.map((r, i) => '<div class="brow"><span>' + (i + 1) + '</span><b>' + esc(r.n) + '</b><span>' + fmtTime(r.t) + '</span><span>' + (r.s || 0) + ' pts</span></div>').join('');
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function updateStatus() {
  const dot = $('sdot'), txt = $('sTxt');
  if (Net.mode === 'live') {
    let n = 1; remotes.forEach(r => { if (!r.ghost && r.live) n++; });
    dot.className = 'dot live'; txt.textContent = n > 1 ? 'Live: ' + n + ' riders' : 'Live: just you';
  } else if (Net.mode === 'solo') { dot.className = 'dot solo'; txt.textContent = 'Offline: ghost riders'; }
  else if (window.storage && window.storage.__rideKitlabLocal) { dot.className = 'dot solo'; txt.textContent = 'Solo mode'; }
  else { dot.className = 'dot'; txt.textContent = 'Connecting'; }
}
function updateRoster() {
  const rows = [{ n: myName + ' (you)', sh: collectedCount, f: finishTime, col: RIDER_PAL[myColor], zn: zone }];
  remotes.forEach(r => { if (r.live) rows.push({ n: r.state.n, sh: r.state.sh | 0, f: r.state.f, col: r.color, zn: r.state.zn | 0 }); });
  rows.sort((a, b) => ((b.f ? 100 : 0) + b.sh) - ((a.f ? 100 : 0) + a.sh));
  $('roster').innerHTML = rows.map(r => '<div class="rw"><i class="sw" style="background:' + r.col + '"></i><span class="nm">' + esc(r.n) + '</span><span class="pr">' + (r.zn === 1 ? 'In Kitlab' : r.sh + '/5') + '</span></div>').join('');
}

/* ============================================================
   MINIMAP
   ============================================================ */
let miniBase = null, miniT = null;
function buildMini() {
  const W = 168, Hh = 236; let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i <= PS; i++) { minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]); minZ = Math.min(minZ, pz[i]); maxZ = Math.max(maxZ, pz[i]); }
  minX -= 30; maxX += 30; minZ -= 30; maxZ += 30;
  const s = Math.min(W / (maxX - minX), Hh / (maxZ - minZ)), ox = (W - (maxX - minX) * s) / 2, oy = (Hh - (maxZ - minZ) * s) / 2;
  miniT = { s, ox, oy, minX, minZ };
  miniBase = mkCanvas(W, Hh); const x = miniBase.getContext('2d');
  x.fillStyle = 'rgba(4,31,41,0.78)'; x.fillRect(0, 0, W, Hh);
  x.strokeStyle = '#ffd27a'; x.lineWidth = 4; x.lineJoin = 'round'; x.beginPath();
  for (let i = 0; i <= PS; i += 4) { const X = (px[i] - minX) * s + ox, Y = (pz[i] - minZ) * s + oy; if (i === 0) x.moveTo(X, Y); else x.lineTo(X, Y); }
  x.stroke();
}
function mm(wx, wz) { return [(wx - miniT.minX) * miniT.s + miniT.ox, (wz - miniT.minZ) * miniT.s + miniT.oy]; }
function drawMini() {
  const c = $('mini'), x = c.getContext('2d'), W = c.width, Hh = c.height;
  x.clearRect(0, 0, W, Hh);
  if (zone === 0) {
    x.drawImage(miniBase, 0, 0);
    
    hazards.forEach(h => { if (h.broken) return; const p = mm(h.x, h.z); x.fillStyle = '#ff5a67'; x.fillRect(p[0] - 2, p[1] - 2, 4, 4); });
    const g = mm(GATE.x, GATE.z); x.strokeStyle = GATE.open ? '#19d3ea' : '#ff5a67'; x.lineWidth = 4; x.beginPath(); x.arc(g[0], g[1], 9, 0, 6.283); x.stroke();
    remotes.forEach(r => { if (!r.live || (r.state.zn | 0) !== 0) return; const p = mm(r.x, r.z); x.fillStyle = r.color; x.beginPath(); x.arc(p[0], p[1], 4.5, 0, 6.283); x.fill(); });
    const p = mm(P.x, P.z); x.save(); x.translate(p[0], p[1]); x.rotate(-P.yaw + Math.PI);
    x.fillStyle = '#fff'; x.beginPath(); x.moveTo(0, 9); x.lineTo(6.5, -7); x.lineTo(0, -3); x.lineTo(-6.5, -7); x.closePath(); x.fill(); x.restore();
  } else {
    x.fillStyle = 'rgba(4,31,41,0.8)'; x.fillRect(0, 0, W, Hh);
    const cx = W / 2, cy = Hh / 2, sc = (W / 2 - 8) / HUB.R;
    x.strokeStyle = '#19d3ea'; x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, HUB.R * sc, 0, 6.283); x.stroke();
    pedestals.forEach((pd, i) => { x.fillStyle = SHARD_COL[i]; x.beginPath(); x.arc(cx + (pd.x - HUB.x) * sc, cy + (pd.z - HUB.z) * sc, 5, 0, 6.283); x.fill(); });
    remotes.forEach(r => { if (!r.live || (r.state.zn | 0) !== 1) return; x.fillStyle = r.color; x.beginPath(); x.arc(cx + (r.x - HUB.x) * sc, cy + (r.z - HUB.z) * sc, 4.5, 0, 6.283); x.fill(); });
    x.save(); x.translate(cx + (P.x - HUB.x) * sc, cy + (P.z - HUB.z) * sc); x.rotate(-P.yaw + Math.PI);
    x.fillStyle = '#fff'; x.beginPath(); x.moveTo(0, 9); x.lineTo(6.5, -7); x.lineTo(0, -3); x.lineTo(-6.5, -7); x.closePath(); x.fill(); x.restore();
  }
}

/* ============================================================
   INPUT
   ============================================================ */
window.addEventListener('keydown', e => {
  keys[e.code] = true; usedKeyboard = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0 && started) e.preventDefault();
  if (!started || e.repeat) return;
  if (e.code === 'KeyB') ringBell();
  if (e.code === 'KeyC') toggleCam();
  if (e.code === 'KeyR') backToRoad();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
document.addEventListener('gesturestart', e => e.preventDefault());

function controls() {
  const L = keys.KeyA || keys.ArrowLeft, Rr = keys.KeyD || keys.ArrowRight;
  const steer = clamp((L ? 1 : 0) - (Rr ? 1 : 0) + touch.steer, -1, 1);
  const thr = true; // the rider pedals automatically
  const brake = !!(keys.KeyS || keys.ArrowDown || touch.brake);
  const boost = !!(keys.ShiftLeft || keys.ShiftRight || touch.boost);
  const jump = !!(keys.Space || touch.jump);
  return { steer, thr: thr && !brake, brake, boost, jump };
}
(function bindTouch() {
  const zonePad = $('padZone'), knob = $('knob'); let id = null, x0 = 0;
  zonePad.addEventListener('pointerdown', e => { id = e.pointerId; x0 = e.clientX; try { zonePad.setPointerCapture(id); } catch (er) { } });
  zonePad.addEventListener('pointermove', e => { if (e.pointerId !== id) return; const dx = e.clientX - x0; touch.steer = clamp(-dx / 55, -1, 1); knob.style.transform = 'translateX(' + clamp(dx, -52, 52) + 'px)'; });
  const end = e => { if (e.pointerId !== id) return; id = null; touch.steer = 0; knob.style.transform = ''; };
  zonePad.addEventListener('pointerup', end); zonePad.addEventListener('pointercancel', end);
  function hold(el, key) {
    el.addEventListener('pointerdown', e => { touch[key] = true; el.classList.add('down'); try { el.setPointerCapture(e.pointerId); } catch (er) { } });
    const up = () => { touch[key] = false; el.classList.remove('down'); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
  }
  hold($('tBrake'), 'brake'); hold($('tBoost'), 'boost'); hold($('tJump'), 'jump');
  $('tBell').addEventListener('pointerdown', () => ringBell());
})();
if (IS_TOUCH) document.body.classList.add('touch');

function toggleCam() { camMode ^= 1; me.rider.visible = camMode === 0; }
function backToRoad() {
  if (!started) return;
  if (zone === 1) { P.x = HUB.x; P.z = HUB.z + 30; P.yaw = Math.PI; P.v = 0; P.y = HUB.y; P.lastGy = HUB.y; return; }
  const np = nearestPath(P.x, P.z, P.pathIdx); placeAtPath(np.i); toast('Back on the road');
}

/* ============================================================
   GAME FLOW
   ============================================================ */
function setZone(z) {
  zone = z;
  const hub = z === 1;
  worldGroup.visible = !hub; hubGroup.visible = hub; if (cloudGroup) cloudGroup.visible = !hub;
  const u = skyMat.uniforms;
  if (hub) {
    u.top.value.setHex(0x07061c); u.mid.value.setHex(0x2b1b5e); u.bot.value.setHex(0x120c30); u.stars.value = 1; u.sunCol.value.setHex(0x8f7bff);
    scene.fog.color.copy(FOG_HUB); scene.fog.near = 40; scene.fog.far = 420; scene.background.copy(FOG_HUB);
    hemi.color.setHex(0x8f86ff); hemi.groundColor.setHex(0x1c1442); hemi.intensity = 0.95; sun.color.setHex(0xb9a6ff); sun.intensity = 0.55;
  } else {
    u.top.value.setHex(0x3a6ec0); u.mid.value.setHex(0xeeb98f); u.bot.value.setHex(0xe8b080); u.stars.value = 0; u.sunCol.value.setHex(0xfff0c8);
    scene.fog.color.copy(FOG_WORLD); scene.fog.near = 70; scene.fog.far = 640; scene.background.copy(FOG_WORLD);
    hemi.color.setHex(0xcfe0ff); hemi.groundColor.setHex(0x6a7a44); hemi.intensity = 0.78; sun.color.setHex(0xffd7a8); sun.intensity = 0.95;
  }
}
function flash(cb) {
  const f = $('flash'); f.classList.add('on');
  setTimeout(() => { cb(); f.classList.remove('on'); }, 260);
}
function enterHub() {
  if (zone === 1 || finished) return;
  finished = true; finishTime = runTime;
  flash(() => {
    setZone(1); P.x = HUB.x; P.z = HUB.z + 32; P.y = HUB.y; P.lastGy = HUB.y; P.yaw = Math.PI; camYaw = Math.PI; P.v = 4; P.vy = 0;
    postScore(); netSendNow(); showArrival();
  });
}
async function showArrival() {
  $('aSum').textContent = 'Ride completed in ' + fmtTime(finishTime) + ', score ' + Math.floor(score).toLocaleString() + ', ' + coinsGot + ' tokens. Ride around the hub and stop at a pedestal to revisit its lesson.';
  $('aOpen').classList.toggle('hide', !KITLAB_URL);
  $('aBoard').innerHTML = ''; $('arrive').classList.remove('hide'); modalOpen = true;
  renderBoard($('aBoard'), await loadBoard());
}
function resetRun() {
  wipeoutPending = false; $('modal').classList.add('hide'); $('arrive').classList.add('hide'); modalOpen = false;
  for (let i = 0; i < 5; i++) {
    collected[i] = false; const s = shards[i]; s.armed = true; s.gem.scale.setScalar(1); s.gem.material.color.set(SHARD_COL[i]); s.gem.material.emissive.set(SHARD_COL[i]); s.gem.material.emissiveIntensity = 0.85;
    s.beam.visible = true; s.pad.visible = true; s.ring.visible = true;
  }
  collectedCount = 0; finished = false; finishTime = 0; runTime = 0; setGateOpen(true); updatePips();
  resetTrack(); score = 0; combo = 1; coinsGot = 0; countdown = 3.2;
  setZone(0); placeAtPath(0, 0); netSendNow();
}

function startRide() {
  try { audioInit(); Music.start(); } catch (e) { }
  myName = ($('inName').value || 'Rider').replace(/[^\w \-.]/g, '').trim().slice(0, 14) || 'Rider';
  myRoom = ($('inRoom').value || 'kitlab').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 16) || 'kitlab';
  try { window.storage.set('profile', JSON.stringify({ id: myId, name: myName }), false).catch(() => { }); } catch (e) { }
  myColor = hashStr(myId) % RIDER_PAL.length;
  scene.remove(me.root);
  me = makeBike(RIDER_PAL[myColor], JERSEY_PAL[(myColor + 3) % JERSEY_PAL.length], RIDER_PAL[(myColor + 4) % RIDER_PAL.length]);
  me.setName(myName); scene.add(me.root);
  $('menu').classList.add('hide'); $('hud').classList.remove('hide');
  started = true; placeAtPath(0, 0); buildPips(); updatePips(); score = 0; combo = 1; coinsGot = 0; countdown = 3.2;
  toast('Follow the extended dirt road to Kitlab. Stop at a hub pedestal to revisit a lesson.', 4200);
  netInit();
}

/* ============================================================
   PHYSICS
   ============================================================ */
function stepPlayer(dt) {
  const c = controls(), frozen = modalOpen, locked = countdown > 0;
  P.stun = Math.max(0, P.stun - dt); P.inv = Math.max(0, P.inv - dt); P.padT = Math.max(0, P.padT - dt); P.mud = Math.max(0, P.mud - dt); P.jumpCd = Math.max(0, P.jumpCd - dt);
  let f = Math.sin(P.yaw), g = Math.cos(P.yaw), onRoad = true;
  if (zone === 0) { const np = nearestPath(P.x, P.z, P.pathIdx); P.pathIdx = np.i; onRoad = np.d < 3.6; }
  const gF = groundAt(zone, P.x + f * 0.55, P.z + g * 0.55), gR = groundAt(zone, P.x - f * 0.55, P.z - g * 0.55);
  const slope = (gF - gR) / 1.1;
  const canDrive = !frozen && !locked && P.stun <= 0;
  const padOn = P.padT > 0;
  const boosting = c.boost && c.thr && P.stamina > 0.03 && canDrive;
  const vmax = padOn ? 46 : (boosting ? 36 : 24);
  let acc = 0;
  if (c.thr && canDrive) acc = 7 * Math.max(0, 1 - P.v / vmax) * (boosting ? 1.8 : 1);
  if (padOn && canDrive) acc += 6 * Math.max(0, 1 - P.v / 46);
  P.stamina = boosting ? Math.max(0, P.stamina - 0.22 * dt) : Math.min(1, P.stamina + 0.08 * dt);
  let res = onRoad ? 0.18 : 1.5 + 0.35 * P.v;
  if (zone === 0 && terrainH(P.x, P.z) < WATER) res = 14 + 0.5 * P.v;
  if (P.mud > 0) res += 6;
  res += 0.0015 * P.v * P.v;
  const ag = -9.8 * slope / Math.sqrt(1 + slope * slope) * 0.9;
  P.v += (acc + ag - (P.v > 0 ? res : 0)) * dt;
  if (frozen || locked) P.v -= 45 * dt; else if (c.brake) P.v -= 14 * dt;
  if (P.v < 0) P.v = 0;
  // steering
  const auth = P.mud > 0 ? 0.5 : (P.stun > 0 ? 0.3 : 1);
  const vEff = (canDrive && Math.abs(c.steer) > 0.05) ? Math.max(P.v, 2.2) : P.v;
  const maxSteer = 0.7 / (1 + vEff * 0.7);
  P.steerAng += (c.steer * maxSteer * auth - P.steerAng) * Math.min(1, dt * 9);
  const yawRate = vEff * Math.tan(P.steerAng) / 1.1;
  P.yaw += yawRate * dt;
  const leanT = clamp(Math.atan(P.v * yawRate / 9.8), -0.6, 0.6);
  P.lean += (leanT - P.lean) * Math.min(1, dt * 6);
  // jump
  if (c.jump && P.grounded && canDrive && P.jumpCd <= 0) { P.vy = 7.2; P.grounded = false; P.jumpCd = 0.4; P.y += 0.03; }
  f = Math.sin(P.yaw); g = Math.cos(P.yaw);
  P.x += f * P.v * dt; P.z += g * P.v * dt;
  if (c.brake && P.v < 0.3 && canDrive) { P.x -= f * 2.5 * dt; P.z -= g * 2.5 * dt; }
  const nearSealedGate = zone === 0 && !GATE.open && Math.hypot(P.x - GATE.x, P.z - GATE.z) < 75;
  if (zone === 0 && canDrive && P.v < 0.6 && !c.brake && !nearSealedGate) P.stuck += dt; else P.stuck = 0;
  if (P.stuck > 3.5) { P.stuck = 0; toast('Stuck, so back on the road you go'); backToRoad(); return; }
  if (zone === 0 && canDrive && P.v > 1) score += P.v * dt * 0.25 * combo;

  if (zone === 0) {
    // trees and rocks in the scenery
    const cx = Math.floor(P.x / OBC), cz = Math.floor(P.z / OBC);
    for (let ax = -1; ax <= 1; ax++) for (let az = -1; az <= 1; az++) {
      const l = OB.get(obKey(cx + ax, cz + az)); if (!l) continue;
      for (let k = 0; k < l.length; k++) {
        const o = l[k], dx = P.x - o.x, dz = P.z - o.z, rr = o.r + 0.5, d2 = dx * dx + dz * dz;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 0.01; P.x = o.x + dx / d * rr; P.z = o.z + dz / d * rr;
          if (P.v > 6 && P.inv <= 0) treeCrash(); else P.v *= 0.5;
        }
      }
    }
    const lim = HALF * 0.86;
    if (Math.abs(P.x) > lim) { P.x = clamp(P.x, -lim, lim); P.v *= 0.5; }
    if (Math.abs(P.z) > lim) { P.z = clamp(P.z, -lim, lim); P.v *= 0.5; }
    // gate
    const gx = P.x - GATE.x, gz = P.z - GATE.z, du = gx * GATE.tx + gz * GATE.tz, lat = Math.abs(-gx * GATE.tz + gz * GATE.tx);
    if (!GATE.open) {
      if (Math.hypot(gx, gz) < 70 && du > -0.8) {
        P.x += GATE.tx * (-0.8 - du); P.z += GATE.tz * (-0.8 - du); P.v *= 0.3;
        const now = performance.now(); if (now - lastGateMsg > 3500) { lastGateMsg = now; toast('The gate is sealed. ' + (5 - collectedCount) + ' shard' + (5 - collectedCount === 1 ? '' : 's') + ' to find.'); }
      }
    } else if (du > -0.3 && du < 3 && lat < 4.8 && P.y < GATE.y + 12) enterHub();
    updateHazards(dt); if (wipeoutPending) return; updatePickups(dt);
  } else {
    const dx = P.x - HUB.x, dz = P.z - HUB.z, d = Math.hypot(dx, dz), lim = HUB.R - 2;
    if (d > lim) { P.x = HUB.x + dx / d * lim; P.z = HUB.z + dz / d * lim; P.v *= 0.6; }
    for (let k = 0; k < hubObs.length; k++) {
      const o = hubObs[k], ox = P.x - o.x, oz = P.z - o.z, rr = o.r + 0.5, d2 = ox * ox + oz * oz;
      if (d2 < rr * rr) { const dd = Math.sqrt(d2) || 0.01; P.x = o.x + ox / dd * rr; P.z = o.z + oz / dd * rr; P.v *= 0.5; }
    }
  }

  // vertical
  const gy = groundAt(zone, P.x, P.z);
  P.vy -= 22 * dt; P.y += P.vy * dt;
  if (P.y <= gy) {
    if (!P.grounded && P.vy < -9) { shake = Math.min(0.5, -P.vy * 0.035); P.v *= 0.92; thump(); }
    P.vy = clamp((gy - P.lastGy) / Math.max(dt, 0.001), -12, 9); P.y = gy; P.grounded = true;
  } else P.grounded = false;
  P.lastGy = gy;
  if (P.y < -80 && zone === 0) { wipeout('Fell off the road'); return; }

  // Lessons are available at hub pedestals; no shard pickups interrupt the road ride.
  if (zone === 1 && !modalOpen) {
    for (let i = 0; i < pedestals.length; i++) {
      const pd = pedestals[i]; if (pd.cool > 0) { pd.cool -= dt; continue; }
      const d2 = (P.x - pd.x) * (P.x - pd.x) + (P.z - pd.z) * (P.z - pd.z);
      if (d2 < 30 && P.v < 1.6) { openLesson(i, 'recap'); break; }
    }
  }

  // dust
  if (zone === 0 && P.grounded && P.v > 4 && Math.random() < dt * P.v * 0.9) {
    puff(P.x - f * 0.6 + (Math.random() - 0.5) * 0.4, P.y + 0.1, P.z - g * 0.6, -f * P.v * 0.15 + (Math.random() - 0.5), 0.6 + Math.random() * 0.8, -g * P.v * 0.15 + (Math.random() - 0.5), 0.7, 0.55 + Math.random() * 0.4, onRoad ? 0xcdb48a : 0x8fae5c);
  }

  // bike transform
  const tp = P.grounded ? Math.atan2(gF - gR, 1.1) : Math.atan2(P.vy, Math.max(P.v, 2));
  P.pitch += (tp - P.pitch) * Math.min(1, dt * 8);
  me.root.position.set(P.x, P.y, P.z);
  me.root.rotation.set(-P.pitch, P.yaw, -P.lean);
  const thrNow = c.thr && canDrive;
  me.pose(dt, P.v, P.steerAng, thrNow ? Math.max(P.v * 1.32, 2.5) : 0);
  $('vig').style.opacity = (boosting || padOn) ? 1 : clamp((P.v - 20) / 40, 0, 0.5);
}

/* ============================================================
   CAMERA / FRAME
   ============================================================ */
let lastT = 0, hudAcc = 0, rosterAcc = 0, todP = 0;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), desired = new THREE.Vector3();
let camInit = false;

const TOD = [
  { top: 0x3a6ec0, mid: 0xeeb98f, bot: 0xe8b080, glow: 0xfff0c8, sun: 0xffd7a8, elev: 0.42, int: 0.95, hemi: 0.78, stars: 0 },
  { top: 0x4a4fb0, mid: 0xf08a6a, bot: 0xd9795e, glow: 0xffb070, sun: 0xff9a66, elev: 0.22, int: 0.85, hemi: 0.66, stars: 0 },
  { top: 0x1f1a5e, mid: 0xb85a86, bot: 0x7a3a70, glow: 0xff8aa8, sun: 0xff6f91, elev: 0.15, int: 0.62, hemi: 0.55, stars: 0.45 }
];
const _tc = new THREE.Color();
function lerpCol(target, a, b, t) { target.set(a); target.lerp(_tc.set(b), t); }
function applyTime(p) {
  p = clamp(p, 0, 1);
  const k = p < 0.5 ? 0 : 1, a = TOD[k], b = TOD[k + 1], t = (p - k * 0.5) / 0.5, u = skyMat.uniforms;
  lerpCol(u.top.value, a.top, b.top, t); lerpCol(u.mid.value, a.mid, b.mid, t); lerpCol(u.bot.value, a.bot, b.bot, t); lerpCol(u.sunCol.value, a.glow, b.glow, t);
  u.stars.value = lerp(a.stars, b.stars, t);
  scene.fog.color.copy(u.mid.value); scene.background.copy(u.mid.value);
  SUN_DIR.set(-0.5, lerp(a.elev, b.elev, t) * 1.2, -0.75).normalize(); u.sunDir.value.copy(SUN_DIR);
  lerpCol(sun.color, a.sun, b.sun, t); sun.intensity = lerp(a.int, b.int, t); hemi.intensity = lerp(a.hemi, b.hemi, t);
}

function updateCamera(dt) {
  if (!started) {
    menuAng += dt * 0.22;
    camera.position.set(P.x + Math.sin(menuAng) * 5.5, P.y + 2.1, P.z + Math.cos(menuAng) * 5.5);
    camera.lookAt(P.x, P.y + 0.9, P.z); camera.fov = 52; camera.updateProjectionMatrix(); return;
  }
  camYaw += angDiff(P.yaw, camYaw) * Math.min(1, dt * 5);
  const fov = 62 + clamp(P.v, 0, 46) * 0.55;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
  shake = Math.max(0, shake - dt * 1.6);
  const sh = shake + clamp(P.v - 18, 0, 30) * 0.0016;
  const sx = (Math.random() - 0.5) * sh, sy = (Math.random() - 0.5) * sh;
  if (camMode === 0) {
    const dist = 4.7 + clamp(P.v, 0, 40) * 0.04, f = Math.sin(camYaw), g = Math.cos(camYaw);
    desired.set(P.x - f * dist, P.y + 2.0, P.z - g * dist);
    const gh = groundAt(zone, desired.x, desired.z) + 0.9; if (desired.y < gh) desired.y = gh;
    if (!camInit) { camPos.copy(desired); camInit = true; }
    camPos.lerp(desired, 1 - Math.exp(-dt * 10));
    camera.position.set(camPos.x + sx, camPos.y + sy, camPos.z);
    camLook.set(P.x + f * 4 + f * P.v * 0.1, P.y + 1.25, P.z + g * 4 + g * P.v * 0.1); camera.lookAt(camLook);
  } else {
    const f = Math.sin(P.yaw), g = Math.cos(P.yaw);
    camera.position.set(P.x + f * 0.28 + sx, P.y + 1.55 + sy, P.z + g * 0.28);
    camera.lookAt(P.x + f * 10, P.y + 1.45 + Math.sin(P.pitch) * 6, P.z + g * 10);
    camInit = false;
  }
}

function updateHud() {
  $('spdTxt').textContent = Math.round(P.v * 3.6) + ' km/h';
  $('stamI').style.transform = 'scaleX(' + P.stamina.toFixed(2) + ')';
  $('qtime').textContent = fmtTime(finished ? finishTime : runTime);
  const o = objective(), dx = o.x - P.x, dz = o.z - P.z, d = Math.hypot(dx, dz);
  $('qtxt').textContent = o.txt + ' \u00b7 ' + Math.round(d) + ' m';
  const ang = angDiff(Math.atan2(dx, dz), camYaw);
  $('qarrow').style.transform = 'rotate(' + (-ang * 180 / Math.PI).toFixed(0) + 'deg)';
  $('qsc').textContent = Math.floor(score).toLocaleString();
  $('qcombo').textContent = combo > 1 ? '\u00d7' + combo : '';
  $('qcoin').textContent = coinsGot + ' tokens';
  Music.mood = zone;
  if (Music.lp && AC) Music.lp.frequency.setTargetAtTime(modalOpen ? 1050 : 1850 + clamp(P.v, 0, 40) * 8, AC.currentTime, 0.25);
  drawMini();
}

function tick(dt, tms) {
  const t = tms / 1000;
  if (portalMat) portalMat.uniforms.time.value = t;
  if (padMat) padMat.opacity = 0.7 + Math.sin(t * 6) * 0.3;
  if (started) {
    if (countdown > 0) {
      countdown -= dt;
      const cn = $('count'); cn.classList.remove('hide'); cn.textContent = countdown > 0.25 ? String(Math.ceil(countdown - 0.25)) : 'GO!';
      if (countdown <= 0) { countdown = 0; setTimeout(() => $('count').classList.add('hide'), 700); }
    }
    if (!modalOpen && countdown <= 0 && !finished) runTime += dt;
    stepPlayer(dt);
  } else if (me) {
    me.root.position.set(P.x, P.y, P.z); me.root.rotation.set(0, P.yaw, 0); me.pose(dt, 0, 0, 0);
  }
  if (zone === 0) {
    const target = started ? clamp(P.pathIdx / PS, 0, 1) : 0;
    todP += (target - todP) * Math.min(1, dt * 0.6); applyTime(todP);
  }
  updateDust(dt);
  for (let i = 0; i < shards.length; i++) {
    const s = shards[i]; if (collected[i]) continue;
    s.gem.rotation.y = t * 1.4 + s.phase; s.gem.position.y = 1.6 + Math.sin(t * 2 + s.phase) * 0.18; s.ring.rotation.z = t * 0.8; s.ring.scale.setScalar(1 + Math.sin(t * 3 + s.phase) * 0.06);
  }
  if (gateRing) gateRing.rotation.z = t * 0.3;
  if (zone === 1) {
    if (hubKnot) { hubKnot.rotation.y = t * 0.6; hubKnot.rotation.x = t * 0.25; }
    pedestals.forEach((p, i) => { p.holo.rotation.y = t * 1.1 + i; p.holo.position.y = HUB.y + 3.4 + Math.sin(t * 1.6 + i) * 0.25; });
    if (hubMotes) hubMotes.rotation.y = t * 0.03;
  }
  if (Net.mode === 'solo') updateGhosts(dt);
  updateRemotes(dt);
  if (me && me.bubbleT > 0) { me.bubbleT -= dt; if (me.bubbleT <= 0 && me.bubble) { me.root.remove(me.bubble); me.bubble = null; } }
  updateCamera(dt);
  sun.position.set(P.x + SUN_DIR.x * 130, P.y + SUN_DIR.y * 130, P.z + SUN_DIR.z * 130); sun.target.position.set(P.x, P.y, P.z); sun.target.updateMatrixWorld();
  sky.position.copy(camera.position);
  if (cloudGroup) { cloudGroup.position.set(camera.position.x, 0, camera.position.z); cloudGroup.rotation.y += dt * 0.0025; }
  if (started) {
    const now = performance.now();
    if (Net.mode === 'live') {
      if (now - Net.last > 800) { Net.last = now; netSendNow(); }
      if (now - Net.lastPoll > 1300) { Net.lastPoll = now; netPoll(); }
    }
    hudAcc += dt; if (hudAcc > 0.1) { hudAcc = 0; updateHud(); }
    rosterAcc += dt; if (rosterAcc > 1) { rosterAcc = 0; if (!$('roster').classList.contains('hide')) updateRoster(); }
  }
}

function loop(ms) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (ms - lastT) / 1000 || 0.016); lastT = ms;
  if (ready) { tick(dt, ms); renderer.render(scene, camera); }
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

/* ============================================================
   UI WIRING
   ============================================================ */
$('go').addEventListener('click', () => { audioInit(); if (ready) startRide(); });
// Mobile browsers can suspend Web Audio when switching apps, locking the screen, or after inactivity.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && AC && AC.state === 'suspended') {
    AC.resume().then(() => { if (Music.playing) Music.next = AC.currentTime + 0.08; }).catch(() => {});
  }
});
window.addEventListener('pageshow', () => {
  if (AC && AC.state === 'suspended') AC.resume().then(() => { if (Music.playing) Music.next = AC.currentTime + 0.08; }).catch(() => {});
});
$('mLater').addEventListener('click', () => closeModal(false));
$('mTake').addEventListener('click', () => closeModal(true));
$('bCam').addEventListener('click', toggleCam);
$('bBack').addEventListener('click', backToRoad);
$('bSnd').addEventListener('click', () => { muted = !muted; $('bSnd').textContent = muted ? 'Sound off' : 'Sound on'; if (sfxBus && AC) sfxBus.gain.setTargetAtTime(muted ? 0 : 0.62, AC.currentTime, 0.04); });
$('bMus').addEventListener('click', () => { Music.setOn(!Music.on); $('bMus').textContent = Music.on ? 'Music on' : 'Music off'; });
$('status').addEventListener('click', () => { const r = $('roster'); r.classList.toggle('hide'); if (!r.classList.contains('hide')) updateRoster(); });
$('bBoard').addEventListener('click', async () => {
  $('aSum').textContent = finished ? 'Your time: ' + fmtTime(finishTime) + '.' : 'Finish the quest to post a time. Fastest riders in room "' + myRoom + '":';
  $('aBoard').innerHTML = ''; $('aOpen').classList.toggle('hide', !KITLAB_URL);
  $('aExplore').textContent = 'Close'; $('arrive').classList.remove('hide'); modalOpen = true;
  renderBoard($('aBoard'), await loadBoard());
});
$('aExplore').addEventListener('click', () => { $('arrive').classList.add('hide'); modalOpen = false; $('aExplore').textContent = 'Explore the hub'; });
$('aOpen').addEventListener('click', () => { if (KITLAB_URL) window.open(KITLAB_URL, '_blank', 'noopener'); });
$('aAgain').addEventListener('click', () => { $('arrive').classList.add('hide'); modalOpen = false; $('aExplore').textContent = 'Explore the hub'; resetRun(); });
window.addEventListener('pagehide', () => { try { if (Net.mode === 'live') window.storage.delete(Net.myKey, true); } catch (e) { } });

$('help').textContent = IS_TOUCH
  ? 'Slide your left thumb to steer. Jump over logs, dodge the rest, hold Boost to sprint. Your rider pedals on their own.'
  : 'Your rider pedals automatically. A/D steers, Space jumps, S brakes (hold it to reverse), Shift boosts. B rings the bell, C changes view, R returns you to the road.';

/* ============================================================
   BOOT
   ============================================================ */
(async function boot() {
  let prof = null;
  try { const r = await window.storage.get('profile', false); if (r && r.value) prof = JSON.parse(r.value); } catch (e) { }
  myId = (prof && prof.id) || Math.random().toString(36).slice(2, 8);
  $('inName').value = (prof && prof.name) || ('Rider' + (100 + Math.floor(Math.random() * 900)));
  setTimeout(function () {
    buildTerrain(); buildScenery(); buildQuest(); buildTrack(); buildDust(); buildHub(); buildMini();
    setGateOpen(true);
    myColor = hashStr(myId) % RIDER_PAL.length;
    me = makeBike(RIDER_PAL[myColor], JERSEY_PAL[(myColor + 3) % JERSEY_PAL.length], RIDER_PAL[(myColor + 4) % RIDER_PAL.length]);
    scene.add(me.root);
    placeAtPath(0, 0);
    ready = true;
    $('go').disabled = false; $('go').textContent = 'Start riding';
  }, 40);
  requestAnimationFrame(loop);
})();

})();
