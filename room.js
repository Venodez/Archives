/* Aphrite: the back room in 3D. The boss sits behind the table and deals you one card per page. */
import * as THREE from 'three';

const root = document.documentElement;
const coverEl = document.getElementById('cover');
const sceneEl = document.getElementById('scene');
const sayEl = document.getElementById('say');
const buttons = [...document.querySelectorAll('#deck .pc')];
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE = matchMedia('(hover: hover) and (pointer: fine)').matches;

/* ---------- helpers ---------- */
const PI = Math.PI;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeInOut = t => { t = clamp(t, 0, 1); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
let seed = 7;
const rnd = (a = 0, b = 1) => { seed = (seed * 16807) % 2147483647; return a + (b - a) * ((seed - 1) / 2147483646); };

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, { srgb = true, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function roundRectPath(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function noise(ctx, w, h, n, light, dark, a) {
  for (let i = 0; i < n; i++) { ctx.fillStyle = rnd() < .5 ? light : dark; ctx.globalAlpha = a * rnd(.3, 1); ctx.fillRect(rnd(0, w), rnd(0, h), rnd(1, 2.4), rnd(1, 2.4)); }
  ctx.globalAlpha = 1;
}

/* rounded box (same idea as three's RoundedBoxGeometry, kept here so the page needs one file less) */
class RoundedBox extends THREE.BoxGeometry {
  constructor(width = 1, height = 1, depth = 1, segments = 3, radius = .1) {
    const total = segments * 2 + 1;
    radius = Math.min(width / 2, height / 2, depth / 2, radius);
    super(1, 1, 1, total, total, total);
    const g2 = this.toNonIndexed();
    this.index = null;
    this.attributes.position = g2.attributes.position;
    this.attributes.normal = g2.attributes.normal;
    this.attributes.uv = g2.attributes.uv;
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    const box = new THREE.Vector3(width, height, depth).divideScalar(2).subScalar(radius);
    const pos = this.attributes.position.array, nor = this.attributes.normal.array;
    const half = .5 / total;
    for (let i = 0; i < pos.length; i += 3) {
      p.fromArray(pos, i); n.copy(p);
      n.x -= Math.sign(n.x) * half; n.y -= Math.sign(n.y) * half; n.z -= Math.sign(n.z) * half; n.normalize();
      pos[i] = box.x * Math.sign(p.x) + n.x * radius;
      pos[i + 1] = box.y * Math.sign(p.y) + n.y * radius;
      pos[i + 2] = box.z * Math.sign(p.z) + n.z * radius;
      nor[i] = n.x; nor[i + 1] = n.y; nor[i + 2] = n.z;
    }
  }
}
function tableShape(hw, hd, r) {
  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hd); s.lineTo(hw - r, -hd); s.absarc(hw - r, -hd + r, r, -PI / 2, 0, false);
  s.lineTo(hw, hd - r); s.absarc(hw - r, hd - r, r, 0, PI / 2, false);
  s.lineTo(-hw + r, hd); s.absarc(-hw + r, hd - r, r, PI / 2, PI, false);
  s.lineTo(-hw, -hd + r); s.absarc(-hw + r, -hd + r, r, PI, PI * 1.5, false);
  return s;
}
function tablePath(hw, hd, r) { const s = tableShape(hw, hd, r); const p = new THREE.Path(); p.curves = s.curves; p.currentPoint = s.currentPoint; return p; }
function cardShape(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function fitUV(geo, w, h) { const uv = geo.attributes.uv, p = geo.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, (p.getY(i) + h / 2) / h); uv.needsUpdate = true; }
function lathe(points, seg = 48, phiStart = 0) { return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), seg, phiStart); }

/* ---------- renderer ---------- */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  if (window.no3d) window.no3d(); else root.classList.remove('try3d');
  throw e;
}
const MOBILE = !FINE || Math.min(screen.width, screen.height) < 700;
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MOBILE ? 1.6 : 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const canvas = renderer.domElement;
canvas.id = 'room';
canvas.setAttribute('aria-hidden', 'true');
const box = document.createElement('div');
box.className = 'room-box';
box.appendChild(canvas);
sceneEl.insertBefore(box, sceneEl.firstChild);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090706);
scene.fog = new THREE.Fog(0x0a0806, 9, 19);
const camera = new THREE.PerspectiveCamera(32, 1.6, .1, 60);

/* ---------- environment for reflections: warm lamp above, cool window, dark room ---------- */
{
  const env = new THREE.Scene();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ float h = vP.y*.5+.5; vec3 c = mix(vec3(.010,.007,.005), vec3(.07,.045,.025), smoothstep(.35,1.,h)); gl_FragColor = vec4(c,1.); }'
  });
  env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMat));
  const glow = (c, i, w, h, x, y, z, ry = 0, rx = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i), side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); env.add(m); };
  glow(0xffd28a, 3, 3, 3, 0, 6, 0, 0, PI / 2);
  glow(0x7f9fff, 1.6, 3.5, 3, 6, 2.5, -5, -PI / 4);
  glow(0xff9a4a, .12, 8, 2, 0, 1, 8, PI);
  glow(0xe8432f, 1.2, 1.2, .5, 7, 1.2, -3, -PI / 2);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, .02).texture;
  pm.dispose();
}

/* ---------- textures ---------- */
const T = {};
{
  // felt
  let [c, x] = makeCanvas(512, 512); x.fillStyle = '#0c3123'; x.fillRect(0, 0, 512, 512); noise(x, 512, 512, 26000, '#245a40', '#04130c', .22);
  T.felt = tex(c, { repeat: [.42, .42] });
  // wood panels
  [c, x] = makeCanvas(512, 512);
  for (let i = 0; i < 4; i++) {
    const base = ['#2a190d', '#30200f', '#261609', '#2d1b0c'][i];
    x.fillStyle = base; x.fillRect(i * 128, 0, 128, 512);
    for (let k = 0; k < 40; k++) { x.strokeStyle = rnd() < .5 ? 'rgba(0,0,0,.28)' : 'rgba(255,214,150,.05)'; x.lineWidth = rnd(.6, 1.8); x.beginPath(); const gx = i * 128 + rnd(4, 124); x.moveTo(gx, 0); x.bezierCurveTo(gx + rnd(-6, 6), 170, gx + rnd(-6, 6), 340, gx + rnd(-4, 4), 512); x.stroke(); }
    x.fillStyle = 'rgba(0,0,0,.6)'; x.fillRect(i * 128, 0, 3, 512); x.fillStyle = 'rgba(255,220,160,.07)'; x.fillRect(i * 128 + 3, 0, 2, 512);
  }
  T.wood = tex(c, { repeat: [5, 2] });
  [c, x] = makeCanvas(256, 256); x.fillStyle = '#3b2312'; x.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 60; k++) { x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = rnd(.5, 1.5); x.beginPath(); const gy = rnd(0, 256); x.moveTo(0, gy); x.bezierCurveTo(80, gy + rnd(-5, 5), 170, gy + rnd(-5, 5), 256, gy + rnd(-3, 3)); x.stroke(); }
  T.woodH = tex(c, { repeat: [3, 1] });
  // plain black suit, a fine weave
  [c, x] = makeCanvas(256, 256); x.fillStyle = '#0d0d10'; x.fillRect(0, 0, 256, 256); noise(x, 256, 256, 5000, '#1c1c22', '#050506', .25);
  T.suit = tex(c, { repeat: [2, 2] });
  // hat band: black silk, a thin sheen at the edges
  [c, x] = makeCanvas(512, 64); x.fillStyle = '#060607'; x.fillRect(0, 0, 512, 64); x.fillStyle = 'rgba(255,255,255,.08)'; x.fillRect(0, 4, 512, 2); x.fillRect(0, 58, 512, 2);
  T.band = tex(c);
  // banknote
  [c, x] = makeCanvas(512, 236); const bg = x.createLinearGradient(0, 0, 512, 236); bg.addColorStop(0, '#cfd7b0'); bg.addColorStop(1, '#a5b182'); x.fillStyle = bg; x.fillRect(0, 0, 512, 236);
  noise(x, 512, 236, 3000, '#e8eccf', '#6d7a50', .15);
  x.strokeStyle = '#4c5a34'; x.lineWidth = 4; x.strokeRect(12, 12, 488, 212); x.lineWidth = 1.5; x.strokeRect(22, 22, 468, 192);
  x.fillStyle = 'rgba(76,90,52,.35)'; x.beginPath(); x.ellipse(256, 118, 58, 72, 0, 0, PI * 2); x.fill(); x.strokeStyle = '#4c5a34'; x.lineWidth = 3; x.stroke();
  x.fillStyle = '#4c5a34'; x.font = '700 40px "Barlow Condensed", Arial, sans-serif'; x.fillText('100', 34, 64); x.textAlign = 'right'; x.fillText('100', 478, 206);
  x.font = '600 18px "Barlow Condensed", Arial, sans-serif'; x.textAlign = 'center'; x.fillText('ONE HUNDRED', 256, 214);
  T.bill = tex(c);
  [c, x] = makeCanvas(256, 64); for (let y = 0; y < 64; y += 2) { x.fillStyle = y % 4 ? '#c8cfae' : '#8d9a6c'; x.fillRect(0, y, 256, 2); }
  T.billEdge = tex(c);
  // bottle label
  [c, x] = makeCanvas(512, 256); x.fillStyle = '#ede2c8'; x.fillRect(0, 0, 512, 256); noise(x, 512, 256, 2000, '#fff', '#b9a780', .2);
  x.strokeStyle = '#a77a26'; x.lineWidth = 6; x.strokeRect(150, 22, 212, 212); x.lineWidth = 2; x.strokeRect(162, 34, 188, 188);
  x.fillStyle = '#2a1a0c'; x.textAlign = 'center'; x.font = '400 96px Limelight, Georgia, serif'; x.fillText('XO', 256, 150);
  x.font = '700 26px "Barlow Condensed", Arial, sans-serif'; x.fillStyle = '#6b4a1a'; x.fillText('R E S E R V E', 256, 196);
  T.label = tex(c);
  // smoke and dust
  [c, x] = makeCanvas(128, 128); let g = x.createRadialGradient(64, 64, 4, 64, 64, 62); g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(.5, 'rgba(255,255,255,.2)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  T.smoke = tex(c, { srgb: false });
  [c, x] = makeCanvas(32, 32); g = x.createRadialGradient(16, 16, 0, 16, 16, 15); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32);
  T.dot = tex(c, { srgb: false });
}
function chipTextures(color, edge) {
  let [c, x] = makeCanvas(512, 32); x.fillStyle = color; x.fillRect(0, 0, 512, 32);
  x.fillStyle = edge; for (let i = 0; i < 8; i++) x.fillRect(i * 64 + 18, 0, 28, 32);
  x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(0, 0, 512, 3); x.fillRect(0, 29, 512, 3);
  const side = tex(c);
  [c, x] = makeCanvas(256, 256); x.fillStyle = color; x.beginPath(); x.arc(128, 128, 128, 0, PI * 2); x.fill();
  x.fillStyle = edge; for (let i = 0; i < 8; i++) { x.save(); x.translate(128, 128); x.rotate(i * PI / 4); x.fillRect(-14, -128, 28, 26); x.restore(); }
  x.strokeStyle = edge; x.lineWidth = 5; x.setLineDash([16, 10]); x.beginPath(); x.arc(128, 128, 84, 0, PI * 2); x.stroke(); x.setLineDash([]);
  x.fillStyle = 'rgba(255,255,255,.1)'; x.beginPath(); x.arc(128, 128, 70, 0, PI * 2); x.fill();
  x.fillStyle = edge; x.font = '400 92px Limelight, Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('A', 128, 134);
  const top = tex(c);
  return [side, top];
}
function cityTexture() {
  const [c, x] = makeCanvas(1024, 1024);
  let g = x.createLinearGradient(0, 0, 0, 1024); g.addColorStop(0, '#1d2638'); g.addColorStop(.62, '#111725'); g.addColorStop(1, '#3a2418'); x.fillStyle = g; x.fillRect(0, 0, 1024, 1024);
  g = x.createRadialGradient(790, 170, 10, 790, 170, 200); g.addColorStop(0, 'rgba(170,190,230,.35)'); g.addColorStop(1, 'rgba(170,190,230,0)'); x.fillStyle = g; x.fillRect(0, 0, 1024, 1024);
  const blds = []; let bx = -20;
  while (bx < 1040) { const w = rnd(60, 140), h = rnd(260, 620); blds.push([bx, 1024 - h, w, h]); bx += w + rnd(-10, 12); }
  const es = 560;
  blds.push([es - 70, 330, 140, 700], [es - 46, 230, 92, 110], [es - 26, 160, 52, 80], [es - 10, 100, 20, 70]);
  x.fillStyle = '#05070b'; blds.forEach(([a, b, w, h]) => x.fillRect(a, b, w, h));
  x.fillRect(es - 3, 40, 6, 64);
  blds.forEach(([a, b, w, h]) => { for (let yy = b + 14; yy < 1010; yy += 22) for (let xx = a + 8; xx < a + w - 10; xx += 16) if (rnd() < .23) { x.fillStyle = `rgba(255,${rnd(190, 225) | 0},${rnd(110, 160) | 0},${rnd(.45, .95).toFixed(2)})`; x.fillRect(xx, yy, 7, 10); } });
  x.fillStyle = 'rgba(255,230,180,.85)'; for (let yy = 345; yy < 1000; yy += 26) x.fillRect(es - 2, yy, 4, 12);
  g = x.createRadialGradient(es, 40, 2, es, 40, 26); g.addColorStop(0, 'rgba(255,80,60,1)'); g.addColorStop(1, 'rgba(255,80,60,0)'); x.fillStyle = g; x.fillRect(es - 30, 10, 60, 60);
  x.save(); x.translate(860, 700); x.font = '400 96px Limelight, Georgia, serif'; x.textAlign = 'center';
  x.shadowColor = 'rgba(255,60,40,1)'; x.shadowBlur = 40; x.fillStyle = '#ff6a52'; x.fillText('BAR', 0, 0); x.shadowBlur = 12; x.fillStyle = '#ffd2c8'; x.fillText('BAR', 0, 0); x.restore();
  return tex(c);
}

/* ---------- card faces (drawn from the page's own card buttons) ---------- */
const SUITS = {
  s: 'M12 1.5C9.3 5.6 3 9.2 3 14.1a4.6 4.6 0 0 0 7.9 3.2c-.3 2-1.1 3.6-2.4 5.2h7c-1.3-1.6-2.1-3.2-2.4-5.2A4.6 4.6 0 0 0 21 14.1C21 9.2 14.7 5.6 12 1.5z',
  h: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  d: 'M12 1.5 20 12l-8 10.5L4 12z',
  c: 'M7.4 6.6a4.6 4.6 0 1 0 9.2 0a4.6 4.6 0 1 0-9.2 0zM2 13.6a4.6 4.6 0 1 0 9.2 0a4.6 4.6 0 1 0-9.2 0zM12.8 13.6a4.6 4.6 0 1 0 9.2 0a4.6 4.6 0 1 0-9.2 0zM11 12h2c0 4.3.9 7.4 2.8 10.5H8.2C10.1 19.4 11 16.3 11 12z',
  k: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
};
const CARDS = buttons.map((b, i) => {
  const use = b.querySelector('use'), href = (use && (use.getAttribute('href') || use.getAttribute('xlink:href'))) || '#su-s';
  return {
    i, btn: b, go: b.dataset.go, say: b.dataset.say || '',
    en: (b.querySelector('.en') || {}).textContent || '', it: (b.querySelector('.itl') || {}).textContent || '',
    rank: ((b.querySelector('.ix b') || {}).textContent || '').trim(), suit: href.replace('#su-', ''),
    red: b.classList.contains('red'), joker: b.classList.contains('jk'), ace: b.classList.contains('ace'),
    order: parseInt(getComputedStyle(b).getPropertyValue('--o')) || i + 1
  };
});
const CW = 512, CH = 716;
function drawSuit(x, key, cx, cy, size, color) { x.save(); x.translate(cx - size / 2, cy - size / 2); x.scale(size / 24, size / 24); x.fillStyle = color; x.fill(new Path2D(SUITS[key] || SUITS.s)); x.restore(); }
function drawFace(x, d) {
  const col = d.joker ? '#a8741c' : d.red ? '#a3221a' : '#17110b';
  x.clearRect(0, 0, CW, CH);
  const g = x.createRadialGradient(CW * .3, CH * .16, 10, CW * .5, CH * .5, CH * .78);
  g.addColorStop(0, '#fdf7e8'); g.addColorStop(.55, '#f1e6cb'); g.addColorStop(1, '#dfcca2');
  x.fillStyle = g; x.fillRect(0, 0, CW, CH);
  noise(x, CW, CH, 2600, '#fffaf0', '#b8a27a', .12);
  x.strokeStyle = 'rgba(160,112,32,.6)'; x.lineWidth = 4; roundRectPath(x, 24, 24, CW - 48, CH - 48, 22); x.stroke();
  const corner = () => {
    x.fillStyle = col; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    if (d.joker) { x.font = '700 40px "Barlow Condensed", Arial, sans-serif'; 'JOKER'.split('').forEach((ch, k) => x.fillText(ch, 66, 128 + k * 40)); drawSuit(x, 'k', 66, 72, 46, col); }
    else { x.font = '400 82px Limelight, Georgia, serif'; x.fillText(d.rank, 66, 122); drawSuit(x, d.suit, 66, 162, 50, col); }
  };
  corner(); x.save(); x.translate(CW, CH); x.rotate(PI); corner(); x.restore();
  const big = d.ace ? 250 : 196;
  drawSuit(x, d.suit, CW / 2, d.ace ? 260 : 250, big, col);
  x.fillStyle = '#17110b'; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  let fs = 74; x.font = `400 ${fs}px Limelight, Georgia, serif`;
  while (x.measureText(d.en).width > CW - 120 && fs > 40) { fs -= 2; x.font = `400 ${fs}px Limelight, Georgia, serif`; }
  x.fillText(d.en, CW / 2, 494);
  x.fillStyle = '#7a5f36'; x.font = 'italic 500 42px Barlow, Arial, sans-serif'; x.fillText(d.it, CW / 2, 556);
}
function drawBack(x) {
  x.fillStyle = '#efe3c6'; x.fillRect(0, 0, CW, CH);
  roundRectPath(x, 22, 22, CW - 44, CH - 44, 20); x.save(); x.clip();
  const g = x.createRadialGradient(CW / 2, CH / 2, 20, CW / 2, CH / 2, CH * .6); g.addColorStop(0, '#6c1b16'); g.addColorStop(1, '#330b09'); x.fillStyle = g; x.fillRect(0, 0, CW, CH);
  x.strokeStyle = 'rgba(241,212,140,.22)'; x.lineWidth = 2;
  for (let i = -CH; i < CW + CH; i += 26) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + CH, CH); x.stroke(); x.beginPath(); x.moveTo(i, CH); x.lineTo(i + CH, 0); x.stroke(); }
  x.restore();
  x.fillStyle = '#330b09'; x.beginPath(); x.arc(CW / 2, CH / 2, 96, 0, PI * 2); x.fill();
  x.strokeStyle = '#d4a64c'; x.lineWidth = 8; x.beginPath(); x.arc(CW / 2, CH / 2, 84, 0, PI * 2); x.stroke();
  x.fillStyle = '#f1d48c'; x.font = '400 104px Limelight, Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('A', CW / 2, CH / 2 + 8);
}
const cardCanvases = CARDS.map(() => makeCanvas(CW, CH));
const backCanvas = makeCanvas(CW, CH);
function paintCards() { CARDS.forEach((d, k) => drawFace(cardCanvases[k][1], d)); drawBack(backCanvas[1]); }
paintCards();
const faceTex = cardCanvases.map(([c]) => tex(c, { aniso: 16 }));
const backTex = tex(backCanvas[0], { aniso: 16 });

/* ---------- materials ---------- */
const M = {
  gold: new THREE.MeshStandardMaterial({ color: 0xf0bf4a, metalness: .88, roughness: .3 }),
  head: new THREE.MeshStandardMaterial({ color: 0xf5cd30, metalness: 0, roughness: .48, envMapIntensity: .5 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x0c0c0f, roughness: .45, metalness: .05, envMapIntensity: .8 }),
  suit: new THREE.MeshStandardMaterial({ color: 0xffffff, map: T.suit, roughness: .58, metalness: 0, envMapIntensity: .7 }),
  satin: new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: .3, metalness: .1, envMapIntensity: .8 }),
  shirt: new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: .6, envMapIntensity: .4 }),
  tie: new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: .28, metalness: .15, envMapIntensity: .9 }),
  hat: new THREE.MeshPhysicalMaterial({ color: 0x0b0b0d, roughness: .3, clearcoat: .9, clearcoatRoughness: .25, envMapIntensity: 1 }),
  band: new THREE.MeshStandardMaterial({ map: T.band, roughness: .55 }),
  felt: new THREE.MeshStandardMaterial({ map: T.felt, roughness: .95, envMapIntensity: .2 }),
  leather: new THREE.MeshPhysicalMaterial({ color: 0x2b160b, roughness: .42, clearcoat: .5, clearcoatRoughness: .35, envMapIntensity: .7 }),
  apron: new THREE.MeshStandardMaterial({ color: 0xffffff, map: T.woodH, roughness: .55, envMapIntensity: .5 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xffffff, map: T.wood, roughness: .75, envMapIntensity: .15 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x2a170b, roughness: .5, envMapIntensity: .3 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: .9, roughness: .3 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x3a3f4a, metalness: .9, roughness: .26, envMapIntensity: 1.8 }),
  steelDark: new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: .85, roughness: .38 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x5c2c12, roughness: .45, metalness: .05 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xd8e4dc, metalness: 0, roughness: .05, transparent: true, opacity: .32, clearcoat: 1, specularIntensity: 1, envMapIntensity: 2.2, depthWrite: false }),
  whisky: new THREE.MeshPhysicalMaterial({ color: 0xc0651c, roughness: .1, transparent: true, opacity: .88, emissive: 0x3a1402, envMapIntensity: 1 }),
  ice: new THREE.MeshPhysicalMaterial({ color: 0xdcecf5, roughness: .15, transparent: true, opacity: .45, envMapIntensity: 1.2, depthWrite: false }),
  label: new THREE.MeshStandardMaterial({ map: T.label, roughness: .6 }),
  bill: new THREE.MeshStandardMaterial({ map: T.bill, roughness: .75, side: THREE.DoubleSide, envMapIntensity: .3 }),
  billEdge: new THREE.MeshStandardMaterial({ map: T.billEdge, roughness: .8, envMapIntensity: .3 }),
  paperBand: new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: .7, envMapIntensity: .3 }),
  cigar: new THREE.MeshStandardMaterial({ color: 0x3a200f, roughness: .78 }),
  ash: new THREE.MeshStandardMaterial({ color: 0x8d8780, roughness: .95 }),
  ember: new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff5a14, emissiveIntensity: 3 }),
  white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .3 }),
  black: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: .3 }),
  shade: new THREE.MeshStandardMaterial({ color: 0x1b4a33, metalness: .15, roughness: .45, envMapIntensity: .22 }),
  shadeIn: new THREE.MeshStandardMaterial({ color: 0xf3e6c4, emissive: 0xffd99a, emissiveIntensity: .6, side: THREE.BackSide, roughness: .6 }),
  bulb: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff1c8).multiplyScalar(4) }),
  shadow: new THREE.MeshStandardMaterial({ color: 0x050403, roughness: .9 }),
  back: new THREE.MeshStandardMaterial({ map: backTex, roughness: .7, envMapIntensity: .2 })
};
M.card = faceTex.map(t => new THREE.MeshStandardMaterial({ map: t, roughness: .88, metalness: 0, envMapIntensity: .12 }));

const shadowy = o => { o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };
function mesh(geo, mat, x = 0, y = 0, z = 0, parent = scene) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; }

/* ---------- the room ---------- */
const WALL_Z = -4.6;
{
  // the wall has a real opening behind the window, so the camera can go out into the city
  const wsh = new THREE.Shape(); wsh.moveTo(-13, -6); wsh.lineTo(13, -6); wsh.lineTo(13, 6); wsh.lineTo(-13, 6); wsh.closePath();
  const hole = new THREE.Path(); hole.moveTo(3.5 - 1.56, .15 - 1.46); hole.lineTo(3.5 + 1.56, .15 - 1.46); hole.lineTo(3.5 + 1.56, .15 + 1.46); hole.lineTo(3.5 - 1.56, .15 + 1.46); hole.closePath(); wsh.holes.push(hole);
  const wg = new THREE.ShapeGeometry(wsh); { const p = wg.attributes.position, uv = wg.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 13) / 26, (p.getY(i) + 6) / 12); }
  const wall = mesh(wg, M.wall, 0, 3, WALL_Z); wall.receiveShadow = true; wall.name = 'wall';
  mesh(new THREE.BoxGeometry(26, .12, .14), M.trim, 0, 1.35, WALL_Z + .07).receiveShadow = true;
  mesh(new THREE.BoxGeometry(26, .05, .1), M.trim, 0, 1.48, WALL_Z + .05);
  // window with the city and half-open blinds
  const W = new THREE.Group(); W.position.set(3.5, 3.15, WALL_Z + .02); W.name = 'window'; scene.add(W);
  const ww = 3.1, wh = 2.9;
  const city = mesh(new THREE.PlaneGeometry(ww, wh), new THREE.MeshBasicMaterial({ map: cityTexture(), color: new THREE.Color(.62, .62, .66), fog: false }), 0, 0, .005, W); city.name = 'cityPlane';
  const frameMat = M.trim;
  [[0, wh / 2 + .07, ww + .3, .16], [0, -wh / 2 - .07, ww + .3, .16]].forEach(([x, y, w, h]) => mesh(new THREE.BoxGeometry(w, h, .22), frameMat, x, y, .1, W));
  [[-ww / 2 - .07, 0], [ww / 2 + .07, 0], [0, 0]].forEach(([x, y], k) => mesh(new THREE.BoxGeometry(k === 2 ? .06 : .16, wh, k === 2 ? .1 : .22), frameMat, x, y, .1, W));
  mesh(new THREE.BoxGeometry(ww + .6, .1, .4), frameMat, 0, -wh / 2 - .2, .2, W);
  const slat = new THREE.BoxGeometry(ww, .1, .015), slatMat = new THREE.MeshStandardMaterial({ color: 0x24170c, roughness: .8 });
  { const ys = []; for (let y = wh / 2 - .08; y > -wh / 2; y -= .17) ys.push(y);
    const im = new THREE.InstancedMesh(slat, slatMat, ys.length), m4 = new THREE.Matrix4(), e = new THREE.Euler(1.05, 0, 0);
    ys.forEach((y, k) => { m4.makeRotationFromEuler(e); m4.setPosition(0, y, .09); im.setMatrixAt(k, m4); }); im.name = 'blinds'; im.userData.ys = ys; W.add(im); }
  // the two men in the dark by the window
  const shade = M.shadow;
  const hatGeo = lathe([[0, 0], [.42, .0], [.46, .03], [.43, .04], [.25, .05], [.24, .3], [.12, .36], [0, .34]], 24);
  [[2.6, -3.85, .95, true], [4.3, -3.65, .9, false]].forEach(([x, z, s, cig]) => {
    const g = new THREE.Group(); g.position.set(x, -.4, z); g.scale.setScalar(s); g.name = 'man'; scene.add(g);
    mesh(new THREE.CapsuleGeometry(.55, 1.1, 6, 16), shade, 0, 1.1, 0, g).scale.set(1.25, 1, .8);
    mesh(new THREE.SphereGeometry(.3, 16, 12), shade, 0, 2.25, 0, g);
    mesh(hatGeo, shade, 0, 2.4, 0, g);
    if (cig) { const e = mesh(new THREE.SphereGeometry(.035, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a2a).multiplyScalar(3) }), .36, 2.1, .3, g); e.name = 'ember2'; }
  });
  mesh(new THREE.CylinderGeometry(.9, .9, .08, 24), shade, 3.4, .55, -3.6).name = 'sideTable';
}

/* ---------- the table ---------- */
const FELT = { hw: 3.8, hd: 1.6, r: 1.3 }, RAIL = .44;
{
  const felt = mesh(new THREE.ShapeGeometry(tableShape(FELT.hw + .1, FELT.hd + .1, FELT.r + .1), 24), M.felt);
  felt.rotation.x = -PI / 2; felt.receiveShadow = true;
  const line = tableShape(FELT.hw - .38, FELT.hd - .38, FELT.r - .38); line.holes.push(tablePath(FELT.hw - .41, FELT.hd - .41, FELT.r - .41));
  const ln = mesh(new THREE.ShapeGeometry(line, 24), new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: .6, roughness: .5 }), 0, .002, 0); ln.rotation.x = -PI / 2; ln.receiveShadow = true;
  const ring = tableShape(FELT.hw + RAIL, FELT.hd + RAIL, FELT.r + RAIL); ring.holes.push(tablePath(FELT.hw, FELT.hd, FELT.r));
  const rail = mesh(new THREE.ExtrudeGeometry(ring, { depth: .12, bevelEnabled: true, bevelThickness: .09, bevelSize: .1, bevelSegments: 5, curveSegments: 32 }), M.leather);
  rail.rotation.x = -PI / 2; rail.position.y = .03; rail.castShadow = rail.receiveShadow = true;
  const apron = mesh(new THREE.ExtrudeGeometry(tableShape(FELT.hw + RAIL - .02, FELT.hd + RAIL - .02, FELT.r + RAIL - .02), { depth: .75, bevelEnabled: false, curveSegments: 32 }), M.apron);
  apron.rotation.x = -PI / 2; apron.position.y = -.8; apron.receiveShadow = true;
}

/* ---------- the boss ---------- */
const boss = new THREE.Group(); boss.position.set(0, 0, -2.62); scene.add(boss);
const body = new THREE.Group(); boss.add(body);
const headPivot = new THREE.Group(); headPivot.position.set(0, 1.86, 0); body.add(headPivot);
const cigarTip = new THREE.Object3D();
let cigarG;
const cigRestP = new THREE.Vector3(.17, .36, .6), cigRestQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(.18, .55, 0));
const ARMS = {};
{
  mesh(new RoundedBox(2, 2, 1, 4, .07), M.suit, 0, .82, 0, body);
  // shirt, lapels, tie, pocket square
  const F = .505;
  const shirt = new THREE.Shape(); shirt.moveTo(-.34, 1.82); shirt.lineTo(.34, 1.82); shirt.lineTo(0, .9); shirt.closePath();
  mesh(new THREE.ShapeGeometry(shirt), M.shirt, 0, 0, F, body);
  const lapel = side => { const s = new THREE.Shape(); s.moveTo(side * .34, 1.83); s.lineTo(side * .74, 1.8); s.lineTo(side * .5, 1.18); s.lineTo(side * .64, 1.06); s.lineTo(side * .05, .5); s.lineTo(0, .78); s.lineTo(side * .03, .9); s.closePath(); return s; };
  [-1, 1].forEach(sd => { const l = mesh(new THREE.ExtrudeGeometry(lapel(sd), { depth: .03, bevelEnabled: true, bevelThickness: .012, bevelSize: .012, bevelSegments: 2 }), M.satin, 0, 0, F - .005, body); l.castShadow = true; });
  const tie = new THREE.Shape(); tie.moveTo(-.075, 1.76); tie.lineTo(.075, 1.76); tie.lineTo(.06, 1.62); tie.lineTo(.13, .92); tie.lineTo(0, .78); tie.lineTo(-.13, .92); tie.lineTo(-.06, 1.62); tie.closePath();
  mesh(new THREE.ExtrudeGeometry(tie, { depth: .03, bevelEnabled: true, bevelThickness: .015, bevelSize: .015, bevelSegments: 2 }), M.tie, 0, 0, F + .005, body).castShadow = true;
  const sq = new THREE.Shape(); sq.moveTo(.42, 1.32); sq.lineTo(.62, 1.32); sq.lineTo(.6, 1.42); sq.lineTo(.55, 1.36); sq.lineTo(.5, 1.44); sq.lineTo(.46, 1.36); sq.closePath();
  [.62, .32].forEach(y => mesh(new THREE.CylinderGeometry(.035, .035, .02, 16), M.satin, .08, y, F + .012, body).rotation.x = PI / 2);
  // classic head, no face: the hat keeps him a mystery
  const prof = []; const r = .62, h = 1.2, b = .16;
  prof.push([0, 0]);
  for (let k = 0; k <= 6; k++) { const a = -PI / 2 + k / 6 * PI / 2; prof.push([r - b + Math.cos(a) * b, b + Math.sin(a) * b]); }
  for (let k = 0; k <= 6; k++) { const a = k / 6 * PI / 2; prof.push([r - b + Math.cos(a) * b, h - b + Math.sin(a) * b]); }
  prof.push([0, h]);
  const hg = lathe(prof, 64, PI);
  { const uv = hg.attributes.uv, p = hg.attributes.position; for (let i = 0; i < uv.count; i++) uv.setY(i, p.getY(i) / h); }
  mesh(hg, M.head, 0, 0, 0, headPivot);
  // fedora
  const hat = new THREE.Group(); hat.position.set(0, .9, .02); hat.rotation.set(.24, .14, -.11); headPivot.add(hat);
  const crown = lathe([[.67, 0], [.662, .16], [.64, .33], [.6, .45], [.5, .53], [.32, .565], [.14, .53], [.04, .47], [0, .46]], 48);
  { const p = crown.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i), z = p.getZ(i); const k = clamp((y - .22) / .34, 0, 1); if (z > 0) p.setX(i, p.getX(i) * (1 - .26 * k * k * (z / .67))); p.setZ(i, z * (1 - .05 * k)); } crown.computeVertexNormals(); }
  mesh(crown, M.hat, 0, 0, 0, hat);
  const brim = lathe([[.64, -.012], [.96, -.012], [1.18, .004], [1.255, .042], [1.27, .075], [1.2, .04], [.98, .016], [.64, .03]], 72);
  { const p = brim.attributes.position; for (let i = 0; i < p.count; i++) { const z = p.getZ(i); p.setY(i, p.getY(i) - Math.max(0, z - .62) * .2 + Math.max(0, -z - .7) * .14); } brim.computeVertexNormals(); }
  const bm = mesh(brim, M.hat, 0, 0, 0, hat); bm.scale.set(1, 1, .92);
  const band = mesh(new THREE.CylinderGeometry(.668, .684, .16, 48, 1, true), M.band, 0, .085, 0, hat);
  // cigar from the right side of the mouth, with ash, ember and its own warm light
  const cg = cigarG = new THREE.Group(); cg.position.copy(cigRestP); cg.quaternion.copy(cigRestQ); headPivot.add(cg);
  mesh(new THREE.CylinderGeometry(.065, .075, .78, 16), M.cigar, 0, 0, .39, cg).rotation.x = PI / 2;
  mesh(new THREE.CylinderGeometry(.079, .079, .09, 16), M.brass, 0, 0, .14, cg).rotation.x = PI / 2;
  mesh(new THREE.CylinderGeometry(.06, .066, .07, 16), M.ash, 0, 0, .8, cg).rotation.x = PI / 2;
  const em = mesh(new THREE.CircleGeometry(.055, 16), M.ember, 0, 0, .837, cg);
  cigarTip.position.set(0, 0, .86); cg.add(cigarTip);
  // arms in suit sleeves, resting on the rail
  const sleeveGeo = new RoundedBox(1.02, 1.62, 1.02, 3, .08), cuffGeo = new RoundedBox(.97, .1, .97, 2, .03), handGeo = new RoundedBox(.93, .4, .93, 3, .1);
  [-1, 1].forEach(sd => {
    const pv = new THREE.Group(); pv.position.set(sd * 1.5, 1.32, 0); pv.rotation.set(-.905, 0, sd * -.04); body.add(pv);
    mesh(sleeveGeo, M.suit, 0, -.31, 0, pv); mesh(cuffGeo, M.satin, 0, -1.14, 0, pv); mesh(handGeo, M.glove, 0, -1.3, 0, pv);
    ARMS[sd < 0 ? 'R' : 'L'] = { pv, rest: pv.quaternion.clone() };
  });
}
shadowy(boss);
const DOWN = new THREE.Vector3(0, -1, 0);
Object.values(ARMS).forEach(a => { a.base = a.pv.position.clone(); const d = DOWN.clone().applyQuaternion(a.rest); a.rest.setFromUnitVectors(DOWN, d); a.pv.quaternion.copy(a.rest); a.restEnd = d.multiplyScalar(1.5).add(a.base); });

/* ---------- things on the table ---------- */
const props = new THREE.Group(); scene.add(props);
const deckPos = new THREE.Vector3(0, .07, -.98);
// chips
const chipGeo = new THREE.CylinderGeometry(.2, .2, .062, 40);
const CHIP = { red: chipTextures('#a3221a', '#efe6d0'), blue: chipTextures('#1d4fb3', '#efe6d0'), black: chipTextures('#151515', '#d4a64c') };
const chipMats = Object.fromEntries(Object.entries(CHIP).map(([k, [side, top]]) => [k, [new THREE.MeshStandardMaterial({ map: side, roughness: .45 }), new THREE.MeshStandardMaterial({ map: top, roughness: .45 }), new THREE.MeshStandardMaterial({ map: top, roughness: .45 })]]));
const chipSets = new Map(), _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _p4 = new THREE.Vector3(), _s4 = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
function chipStack(x, z, n, kind, group = props) {
  const key = group.uuid + kind;
  let im = chipSets.get(key);
  if (!im) { im = new THREE.InstancedMesh(chipGeo, chipMats[kind], 24); im.count = 0; group.add(im); chipSets.set(key, im); }
  for (let i = 0; i < n; i++) { _p4.set(x + rnd(-.015, .015), .031 + i * .063, z + rnd(-.015, .015)); _q4.setFromAxisAngle(_up, rnd(0, PI * 2)); _m4.compose(_p4, _q4, _s4); im.setMatrixAt(im.count++, _m4); }
  im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
}
// cash
const stackGeo = new THREE.BoxGeometry(.96, .17, .44);
const stackMats = [M.billEdge, M.billEdge, M.bill, M.billEdge, M.billEdge, M.billEdge];
function cash(x, z, ry, y = 0, group = props) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; group.add(g);
  mesh(stackGeo, stackMats, 0, .085, 0, g);
  mesh(new THREE.BoxGeometry(.16, .176, .446), M.paperBand, -.05, .085, 0, g);
  return g;
}
function bill(x, z, ry, y = .004, group = props) { const m = mesh(new THREE.PlaneGeometry(.96, .44), M.bill, x, y, z, group); m.rotation.set(-PI / 2, 0, ry); return m; }
// revolver lying on its side
function revolver() {
  const g = new THREE.Group();
  const frame = new THREE.Shape();
  frame.moveTo(-.02, .16); frame.lineTo(.05, .16); frame.lineTo(.05, .02); frame.lineTo(-.36, .0); frame.lineTo(-.4, -.06);
  frame.lineTo(-.47, -.08); frame.lineTo(-.46, .1); frame.lineTo(-.53, .21); frame.lineTo(-.47, .22); frame.lineTo(-.38, .17); frame.closePath();
  const ex = (s, d) => new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: .015, bevelSize: .015, bevelSegments: 2 });
  const fr = mesh(ex(frame, .1), M.steel, 0, 0, -.05, g);
  const gr = new THREE.Shape(); gr.moveTo(-.47, -.08); gr.bezierCurveTo(-.5, -.2, -.6, -.42, -.66, -.5); gr.bezierCurveTo(-.72, -.58, -.86, -.55, -.85, -.46); gr.bezierCurveTo(-.82, -.3, -.66, -.06, -.47, .1); gr.closePath();
  mesh(ex(gr, .14), M.grip, 0, 0, -.07, g);
  const drum = mesh(new THREE.CylinderGeometry(.13, .13, .27, 24), M.steelDark, -.2, .085, 0, g); drum.rotation.z = PI / 2;
  const barrel = mesh(new THREE.CylinderGeometry(.045, .05, .82, 18), M.steel, .45, .115, 0, g); barrel.rotation.z = PI / 2;
  mesh(new THREE.BoxGeometry(.8, .035, .03), M.steel, .45, .17, 0, g);
  mesh(new THREE.BoxGeometry(.03, .05, .02), M.steel, .84, .19, 0, g);
  const guard = mesh(new THREE.TorusGeometry(.09, .016, 8, 20, PI), M.steel, -.3, -.02, 0, g); guard.rotation.z = PI;
  mesh(new THREE.BoxGeometry(.02, .08, .03), M.steel, -.31, -.04, 0, g).rotation.z = .3;
  mesh(new THREE.CylinderGeometry(.018, .018, .02, 10), M.brass, -.7, -.35, .085, g).rotation.x = PI / 2;
  g.rotation.x = -PI / 2;
  const holder = new THREE.Group(); holder.add(g); g.position.y = .09;
  return holder;
}
// bottle and glass
function bottle() {
  const g = new THREE.Group();
  const outer = [[0, 0], [.27, 0], [.3, .03], [.3, .8], [.27, .9], [.13, 1.0], [.1, 1.06], [.1, 1.24], [.11, 1.26], [0, 1.26]];
  mesh(lathe(outer, 40), M.glass, 0, 0, 0, g).renderOrder = 3;
  mesh(lathe([[0, .03], [.27, .03], [.27, .62], [0, .62]], 40), M.whisky, 0, 0, 0, g).renderOrder = 1;
  const lab = mesh(new THREE.CylinderGeometry(.305, .305, .34, 40, 1, true, -.95, 1.9), M.label, 0, .42, 0, g);
  mesh(new THREE.CylinderGeometry(.115, .115, .13, 24), M.brass, 0, 1.25, 0, g);
  return g;
}
function tumbler() {
  const g = new THREE.Group();
  mesh(lathe([[0, 0], [.26, 0], [.275, .4], [.25, .4], [.235, .07], [0, .07]], 36), M.glass, 0, 0, 0, g).renderOrder = 3;
  mesh(new THREE.CylinderGeometry(.232, .228, .16, 32), M.whisky, 0, .15, 0, g).renderOrder = 1;
  [[-.07, .2, .03, .4], [.08, .23, -.05, -.5], [0, .27, .08, .9]].forEach(([x, y, z, r]) => { const c = mesh(new RoundedBox(.13, .12, .13, 2, .03), M.ice, x, y, z, g); c.rotation.set(r, r * .7, r * .3); c.renderOrder = 2; });
  return g;
}
const P = {};
{
  P.chips = new THREE.Group(); props.add(P.chips);
  chipStack(0, 0, 7, 'red', P.chips); chipStack(-.42, .3, 4, 'blue', P.chips); chipStack(.4, -.22, 3, 'black', P.chips); chipStack(-.1, .52, 2, 'red', P.chips); chipStack(.36, .38, 1, 'black', P.chips);
  P.cash = new THREE.Group(); props.add(P.cash);
  cash(0, 0, .12, 0, P.cash); cash(.12, .03, -.05, .175, P.cash); cash(.78, .32, -.35, 0, P.cash); bill(-.35, .6, .25, .004, P.cash); bill(.55, .78, -.4, .006, P.cash);
  P.gun = revolver(); props.add(P.gun);
  P.bottle = bottle(); props.add(P.bottle);
}
const SPOTS = {
  wide: { chips: [-2.95, -1.05, 0], cash: [2.5, -.82, 0], gun: [-3.05, .3, 1.0], bottle: [3.3, .2, 0], deck: [0, -.98, .06] },
  narrow: { chips: [-1.95, -1.38, .3], cash: [1.62, -1.32, -.2], gun: [1.52, .95, -.85], bottle: [-1.88, -.42, 0], deck: null }
};
function arrangeProps(narrow) {
  const S = SPOTS[narrow ? 'narrow' : 'wide'];
  ['chips', 'cash', 'gun', 'bottle'].forEach(k => { const [x, z, r] = S[k]; P[k].position.set(x, 0, z); P[k].rotation.y = r; });
  deckGroup.visible = !!S.deck;
  if (S.deck) { deckGroup.position.set(S.deck[0], 0, S.deck[1]); deckGroup.rotation.y = S.deck[2]; deckPos.set(S.deck[0], .07, S.deck[1]); }
  else deckPos.set(0, .45, -1.25);
}
shadowy(props);
// the rest of the deck, between his hands
const deckGroup = new THREE.Group(); scene.add(deckGroup);
const CARD_W = .9, CARD_H = 1.26;
let LEAN = .42;
const cardGeo = new THREE.ShapeGeometry(cardShape(CARD_W, CARD_H, .075), 6); fitUV(cardGeo, CARD_W, CARD_H);
{ const im = new THREE.InstancedMesh(cardGeo, M.back, 7), m4 = new THREE.Matrix4(), e = new THREE.Euler();
  for (let i = 0; i < 7; i++) { e.set(-PI / 2, 0, PI + rnd(-.05, .05)); m4.makeRotationFromEuler(e); m4.setPosition(rnd(-.01, .01), .006 + i * .007, rnd(-.01, .01)); im.setMatrixAt(i, m4); }
  im.castShadow = im.receiveShadow = true; deckGroup.add(im); }

/* ---------- the lamp ---------- */
const lampPivot = new THREE.Group(); lampPivot.position.set(0, 9, .05); scene.add(lampPivot);
const lamp = new THREE.Group(); lamp.position.set(0, -5.22, 0); lampPivot.add(lamp);
const LAMP_Y = 9 - 5.22;
let LAMP_K = 1;
const spot = new THREE.SpotLight(0xffd7a0, 110, 14, .7, .6, 2);
const coneMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uH: { value: 4 }, uI: { value: .09 }, uC: { value: new THREE.Color(0xffe2a8) } },
  vertexShader: 'varying float vH; varying vec3 vN; varying vec3 vV; void main(){ vH = position.y; vec4 mv = modelViewMatrix*vec4(position,1.); vV = normalize(-mv.xyz); vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*mv; }',
  fragmentShader: 'uniform float uH; uniform float uI; uniform vec3 uC; varying float vH; varying vec3 vN; varying vec3 vV; void main(){ float t = clamp(-vH/uH,0.,1.); float f = pow(1.-t,1.7)*smoothstep(0.,.06,t); float rim = pow(abs(dot(normalize(vN),normalize(vV))),1.8); gl_FragColor = vec4(uC*uI*f*rim,1.); }'
});
{
  mesh(new THREE.CylinderGeometry(.014, .014, 5.2, 6), M.black, 0, 2.6, 0, lamp);
  const sh = lathe([[.56, -.06], [.53, .02], [.48, .16], [.4, .33], [.29, .47], [.15, .54], [.05, .56]], 48);
  mesh(sh, M.shade, 0, 0, 0, lamp).castShadow = false;
  mesh(sh, M.shadeIn, 0, 0, 0, lamp);
  const rim = mesh(new THREE.TorusGeometry(.56, .02, 8, 48), M.brass, 0, -.06, 0, lamp); rim.rotation.x = PI / 2;
  mesh(new THREE.CylinderGeometry(.09, .07, .16, 16), M.brass, 0, .6, 0, lamp);
  mesh(new THREE.SphereGeometry(.12, 20, 16), M.bulb, 0, .1, 0, lamp);
  spot.position.set(0, -.02, 0); lamp.add(spot);
  const tgt = new THREE.Object3D(); tgt.position.set(0, -3.8, -.3); lamp.add(tgt); spot.target = tgt;
  spot.castShadow = true;
  spot.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
  spot.shadow.bias = -.0004; spot.shadow.normalBias = .025; spot.shadow.radius = 4;
  spot.shadow.camera.near = .5; spot.shadow.camera.far = 9;
  const inner = new THREE.PointLight(0xffd59a, 1.6, 2.2, 2); inner.position.set(0, .1, 0); lamp.add(inner);
  const coneH = LAMP_Y - .02;
  const cg = new THREE.ConeGeometry(2.9, coneH, 56, 1, true); cg.translate(0, -coneH / 2, 0);
  coneMat.uniforms.uH.value = coneH;
  const cone = new THREE.Mesh(cg, coneMat); cone.position.y = -.02; cone.renderOrder = 5; lamp.add(cone);
}
/* soft glows */
const glowTex = (() => { const [c, x] = makeCanvas(128, 128); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return tex(c, { srgb: false }); })();
function glowSprite(color, size, op) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: op })); s.scale.set(size, size, 1); return s; }
const bulbGlow = glowSprite(0xffd9a0, 1.6, .55); bulbGlow.position.set(0, -.05, 0); lamp.add(bulbGlow);
const emberGlow = glowSprite(0xff6a1a, .32, .8); scene.add(emberGlow);
/* ---------- what he holds: a glass of whisky (right hand), the cigar (mouth or left hand), a lighter ---------- */
renderer.localClippingEnabled = true;
const glassG = tumbler(); body.add(glassG); shadowy(glassG);
// the whisky is a full cylinder cut flat at the liquid line, so it stays level when he tips the glass
const liquidPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
{
  glassG.remove(glassG.children[1]);
  const lg = new THREE.CylinderGeometry(.246, .233, .318, 32); lg.translate(0, .231, 0);
  const side = new THREE.MeshPhysicalMaterial({ color: 0xc0651c, roughness: .1, transparent: true, opacity: .88, emissive: 0x3a1402, envMapIntensity: 1, clippingPlanes: [liquidPlane] });
  const top = new THREE.MeshStandardMaterial({ color: 0xc9772a, emissive: 0x3d1704, roughness: .15, side: THREE.BackSide, clippingPlanes: [liquidPlane] });
  const a = new THREE.Mesh(lg, side), b = new THREE.Mesh(lg, top); a.renderOrder = b.renderOrder = 1; glassG.add(a, b);
}
let whiskyFill = .5;
const handEnd = (arm, out) => out.set(0, -1.5, 0).applyQuaternion(arm.pv.quaternion).add(arm.pv.position);
M.chrome = new THREE.MeshStandardMaterial({ color: 0xcfcfd6, metalness: .95, roughness: .22 });
M.flame = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, .72, .32).multiplyScalar(4), transparent: true, opacity: .95, depthWrite: false });
const lighter = new THREE.Group(); lighter.visible = false; ARMS.L.pv.add(lighter);
mesh(new RoundedBox(.17, .25, .085, 2, .02), M.chrome, 0, .125, 0, lighter);
const lid = mesh(new RoundedBox(.17, .085, .085, 2, .02), M.chrome, 0, 0, 0, lighter); lid.geometry.translate(.085, .0425, 0); lid.position.set(-.085, .25, 0); lid.rotation.z = 1.9;
const flame = new THREE.Group(); flame.position.set(.02, .29, 0); lighter.add(flame);
const flameCore = mesh(new THREE.ConeGeometry(.05, .22, 12), M.flame, 0, .11, 0, flame);
const flameGlow = glowSprite(0xffa040, .9, 1); flameGlow.position.y = .1; flame.add(flameGlow);
const flameLight = new THREE.PointLight(0xffa24a, 0, 2.6, 2); flameLight.position.y = .08; flame.add(flameLight);
/* other lights */
const hemi = new THREE.HemisphereLight(0x5a4632, 0x070504, .5); scene.add(hemi);
const rim = new THREE.SpotLight(0x86a8ff, 70, 16, .42, .7, 2); rim.position.set(4.2, 4.2, -4.25); rim.target.position.set(-.2, 2.2, -2.6); scene.add(rim, rim.target);
const bounce = new THREE.PointLight(0xffc89a, 1.6, 3.5, 2); bounce.position.set(0, 1.0, -1.25); scene.add(bounce);
const front = new THREE.PointLight(0xffd2a0, 2.5, 12, 2); front.position.set(-1.5, 2.8, 4.5); scene.add(front);
const key = new THREE.SpotLight(0xffe0b8, 95, 12, .26, .9, 2); key.position.set(-2.4, 3.9, 3.2); key.target.position.set(0, 2.35, -2.62); scene.add(key, key.target);
const wash = new THREE.SpotLight(0xffc98a, 30, 9, .75, .9, 2); wash.position.set(0, 4.6, -3.25); wash.target.position.set(0, 2.0, -4.6); scene.add(wash, wash.target);
const emberLight = new THREE.PointLight(0xff6a1a, .6, 1.3, 2); scene.add(emberLight);
const neon = new THREE.PointLight(0xff4030, 1.2, 3.5, 2); neon.position.set(4.4, 2.3, -4.0); scene.add(neon);

/* ---------- smoke and dust ---------- */
const smoke = [];
const smokeMat = new THREE.SpriteMaterial({ map: T.smoke, color: 0xd4ccc0, transparent: true, depthWrite: false, opacity: 0 });
for (let i = 0; i < 34; i++) { const s = new THREE.Sprite(smokeMat.clone()); s.visible = false; s.userData = { life: 0, max: 1, vx: 0, vz: 0, rot: 0 }; scene.add(s); smoke.push(s); }
let smokeClock = 0;
const tipW = new THREE.Vector3();
function puff() {
  const s = smoke.find(p => !p.visible); if (!s) return;
  cigarTip.getWorldPosition(tipW); s.position.copy(tipW);
  s.userData.life = 0; s.userData.max = 3.6 + Math.random() * 1.6; s.userData.vx = (Math.random() - .3) * .1; s.userData.vz = (Math.random() - .5) * .06; s.material.rotation = Math.random() * PI * 2; s.userData.rot = (Math.random() - .5) * .4;
  s.visible = true;
}
const _mw = new THREE.Vector3();
function exhale() {
  _mw.set(-.04, .36, .7).applyMatrix4(headPivot.matrixWorld);
  for (let i = 0; i < 6; i++) { const s = smoke.find(p => !p.visible); if (!s) return;
    s.position.copy(_mw); const u = s.userData; u.life = -i * .08; u.max = 2.2 + Math.random() * .8; u.vx = (Math.random() - .5) * .16; u.vz = .3 + Math.random() * .22; u.rot = (Math.random() - .5) * .5;
    s.material.rotation = Math.random() * PI * 2; s.material.opacity = 0; s.scale.set(.1, .1, 1); s.visible = true; }
}
const DUST = 140;
const dustGeo = new THREE.BufferGeometry();
{ const a = new Float32Array(DUST * 3); for (let i = 0; i < DUST; i++) { const t = Math.random(), ang = Math.random() * PI * 2, rr = Math.sqrt(Math.random()) * 2.6 * (1 - t * .8); a[i * 3] = Math.cos(ang) * rr; a[i * 3 + 1] = .3 + t * 3.2; a[i * 3 + 2] = -.9 + Math.sin(ang) * rr; } dustGeo.setAttribute('position', new THREE.BufferAttribute(a, 3)); }
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: T.dot, color: 0xffe2a8, size: .03, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending }));
scene.add(dust);

/* ---------- the contract: drawn in the shape of your screen, it comes folded from under the table ---------- */
const conCanvas = makeCanvas(2048, 1280);
const conTex = tex(conCanvas[0], { aniso: 16 });
const conBackCanvas = makeCanvas(512, 512), conBack = tex(conBackCanvas[0]);
function drawSealBack() {   // the outside of the folded sheet: plain paper and a wax seal keeping it shut
  const [c, x] = conBackCanvas; const g = x.createRadialGradient(256, 256, 40, 256, 256, 380); g.addColorStop(0, '#f8f1e2'); g.addColorStop(1, '#e2d3b0'); x.fillStyle = g; x.fillRect(0, 0, 512, 512); noise(x, 512, 512, 5000, '#fffaf0', '#a58c5c', .1);
  x.strokeStyle = 'rgba(60,40,20,.25)'; x.lineWidth = 3; x.strokeRect(24, 24, 464, 464); x.lineWidth = 1; x.strokeRect(34, 34, 444, 444);
  waxSeal(x, 256, 236, 62, .62); conBack.needsUpdate = true;
}
const M_paper = new THREE.MeshStandardMaterial({ map: conTex, roughness: .85, envMapIntensity: .15 });
const M_paperBack = new THREE.MeshStandardMaterial({ map: conBack, roughness: .9, envMapIntensity: .15 });
const M_paperFlat = new THREE.MeshBasicMaterial({ map: conTex, toneMapped: false, fog: false, transparent: true, opacity: 0, depthWrite: false });
const paper = new THREE.Group(); paper.visible = false; scene.add(paper);
const paperBase = new THREE.Group(), flapPivot = new THREE.Group(), paperFlap = new THREE.Group();
paper.add(paperBase, flapPivot); flapPivot.add(paperFlap); flapPivot.position.y = .003;
function paperSide(group) {   // printed side up, blank side down
  const f = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), M_paper); f.rotation.x = -PI / 2;
  const b = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), M_paperBack); b.rotation.x = PI / 2; b.position.y = -.0012;
  f.castShadow = b.castShadow = f.receiveShadow = b.receiveShadow = true; group.add(f, b); return [f, b];
}
const sideA = paperSide(paperBase), sideB = paperSide(paperFlap);
const paperFlat = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), M_paperFlat); paperFlat.rotation.x = -PI / 2; paperFlat.position.y = .006; paperFlat.renderOrder = 6; paperFlat.visible = false; paper.add(paperFlat);
const PAPER = { a: 1.6, w: 2, h: 1.25, land: true, sig: null, sigPts: [], packet: new THREE.Vector3() };
function mapUV(m, u0, u1, v0, v1) { const uv = m.geometry.attributes.uv, p = m.geometry.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (p.getX(i) + .5) * (u1 - u0), v0 + (p.getY(i) + .5) * (v1 - v0)); uv.needsUpdate = true; }
function shapePaper() {   // the sheet has the shape of your screen and folds across its long side
  const a = PAPER.a, land = PAPER.land = a >= 1, hp = Math.min(2.3, 1.05 / a);
  const w = PAPER.w = land ? 2 : hp * a, h = PAPER.h = land ? 2 / a : hp;
  const [fa, ba] = sideA, [fb, bb] = sideB;
  if (land) {   // like a book: the right half closes over the left
    paperBase.position.set(-w / 4, 0, 0); paperFlap.position.set(w / 4, 0, 0);
    [fa, ba, fb, bb].forEach(m => m.scale.set(w / 2, h, 1)); mapUV(fa, 0, .5, 0, 1); mapUV(fb, .5, 1, 0, 1);
    PAPER.packet.set(-w / 4, 0, 0);
  } else {      // the bottom half closes over the top
    paperBase.position.set(0, 0, -h / 4); paperFlap.position.set(0, 0, h / 4);
    [fa, ba, fb, bb].forEach(m => m.scale.set(w, h / 2, 1)); mapUV(fa, 0, 1, .5, 1); mapUV(fb, 0, 1, 0, .5);
    PAPER.packet.set(0, 0, -h / 4);
  }
  paperFlat.scale.set(w, h, 1);
}
function setFold(k) { if (PAPER.land) flapPivot.rotation.set(0, 0, PI * k); else flapPivot.rotation.set(-PI * k, 0, 0); }   // 1 folded, 0 open
// an engraver's few tools
function spacedText(x, str, cx, y, sp) { const ch = [...str], ws = ch.map(c => x.measureText(c).width), tw = ws.reduce((a, b) => a + b, 0) + sp * (ch.length - 1); let px = cx - tw / 2; const al = x.textAlign; x.textAlign = 'left'; ch.forEach((c, i) => { x.fillText(c, px, y); px += ws[i] + sp; }); x.textAlign = al; return tw; }
function fitFont(x, str, style, size, maxW) { let f = size; x.font = style.replace('#', f.toFixed(1)); while (x.measureText(str).width > maxW && f > size * .4) { f *= .95; x.font = style.replace('#', f.toFixed(1)); } return f; }
function guilloche(x, x0, y0, w, h, bw, U) {   // the engraved rope border of an old bond
  const sides = [[x0, y0, w, 0], [x0 + w, y0, 0, h], [x0 + w, y0 + h, -w, 0], [x0, y0 + h, 0, -h]], per = 15 * U, A = bw * .42;
  x.lineWidth = Math.max(.8, .95 * U);
  for (let j = 0; j < 4; j++) {
    x.strokeStyle = j % 2 ? 'rgba(78,96,70,.62)' : 'rgba(124,88,42,.62)';
    sides.forEach(([sx, sy, dx, dy]) => { const len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len, nx = -uy, ny = ux; x.beginPath();
      for (let q = bw; q <= len - bw; q += 2) { const o = bw / 2 + A * Math.sin(q / per * PI * 2 + j * PI / 2) * (.75 + .25 * Math.cos(q / (per * 3.1) + j)); const px = sx + ux * q + nx * o, py = sy + uy * q + ny * o; q === bw ? x.moveTo(px, py) : x.lineTo(px, py); }
      x.stroke(); });
  }
}
function rosette(x, cx, cy, r, U) { x.save(); x.translate(cx, cy); x.strokeStyle = 'rgba(78,56,28,.85)'; x.lineWidth = Math.max(.8, 1.1 * U); for (let i = 0; i < 12; i++) { x.rotate(PI / 6); x.beginPath(); x.ellipse(r * .5, 0, r * .5, r * .17, 0, 0, PI * 2); x.stroke(); } x.beginPath(); x.arc(0, 0, r, 0, PI * 2); x.stroke(); x.fillStyle = '#7a5a2c'; x.beginPath(); x.arc(0, 0, r * .2, 0, PI * 2); x.fill(); x.restore(); }
function flourish(x, cx, y, w, U) { x.save(); x.strokeStyle = 'rgba(60,40,18,.7)'; x.lineWidth = 1.6 * U; x.beginPath(); x.moveTo(cx - w / 2, y); x.bezierCurveTo(cx - w / 4, y - 10 * U, cx - w / 8, y + 10 * U, cx, y); x.bezierCurveTo(cx + w / 8, y - 10 * U, cx + w / 4, y + 10 * U, cx + w / 2, y); x.stroke(); x.restore(); }
function ornament(x, cx, y, w, U) { x.save(); x.strokeStyle = 'rgba(59,42,23,.8)'; x.fillStyle = '#3b2a17'; x.lineWidth = 1.4 * U; x.beginPath(); x.moveTo(cx - w / 2, y); x.lineTo(cx - 16 * U, y); x.moveTo(cx + 16 * U, y); x.lineTo(cx + w / 2, y); x.stroke();
  x.beginPath(); x.moveTo(cx, y - 9 * U); x.lineTo(cx + 9 * U, y); x.lineTo(cx, y + 9 * U); x.lineTo(cx - 9 * U, y); x.closePath(); x.fill(); [-1, 1].forEach(q => { x.beginPath(); x.arc(cx + q * (w / 2 + 7 * U), y, 3 * U, 0, PI * 2); x.fill(); }); x.restore(); }
function clauseRows(x, x0, x1, y, gap, U, rows, fs) {   // the terms, with dotted leaders
  rows.forEach(([l, r]) => {
    x.fillStyle = '#24170b'; x.textAlign = 'left';
    const f = fitFont(x, l, '600 #px "Barlow Condensed", Arial, sans-serif', fs, (x1 - x0) * (r ? .64 : 1)); x.fillText(l, x0, y);
    const lw = x.measureText(l).width; let rw = 0;
    if (r) { x.textAlign = 'right'; x.font = `600 ${f.toFixed(1)}px "Barlow Condensed", Arial, sans-serif`; x.fillText(r, x1, y); rw = x.measureText(r).width; }
    x.fillStyle = 'rgba(36,23,11,.42)'; for (let px = x0 + lw + 14 * U; px < x1 - rw - 12 * U; px += 11 * U) { x.beginPath(); x.arc(px, y - 6 * U, 1.7 * U, 0, PI * 2); x.fill(); }
    y += gap;
  });
  x.textAlign = 'left'; return y;
}
function sigLine(x, x0, x1, y, label, U) { x.strokeStyle = '#2a1a0c'; x.lineWidth = 2 * U; x.beginPath(); x.moveTo(x0, y); x.lineTo(x1, y); x.stroke(); x.fillStyle = '#6b4a1a'; x.font = `700 ${19 * U}px "Barlow Condensed", Arial, sans-serif`; spacedText(x, label, (x0 + x1) / 2, y + 34 * U, 4 * U); }
function sigPath(x0, x1, y, hh, v = 0) {   // a quick cursive name: a tall first letter, a run of loops, a last stroke
  const P = [], w = x1 - x0, n = v ? 4 : 6, lh = v ? .5 : .4, cap = v ? .7 : .55, sl = v ? .035 : .022;
  for (let i = 0; i <= 34; i++) { const t = i / 34, a = PI * .5 + t * PI * (v ? 2.4 : 2.1); P.push([x0 + w * (v ? .05 : .07) + Math.cos(a) * w * (v ? .04 : .05), y - hh * cap - Math.sin(a) * hh * cap + t * hh * (v ? .7 : .5)]); }
  for (let i = 1; i <= n * 14; i++) { const t = i / (n * 14), a = t * n * PI * 2; P.push([x0 + w * (.1 + (v ? .55 : .64) * t) + Math.sin(a) * w * sl, y - hh * (.06 + lh * (.5 - .5 * Math.cos(a)) * (1 - .4 * t))]); }
  if (v) for (let i = 1; i <= 22; i++) { const t = i / 22; P.push([x0 + w * (.65 + .3 * t), y - hh * (.1 + .5 * t * t) + hh * .15 * Math.sin(t * PI)]); }
  else for (let i = 1; i <= 24; i++) { const t = i / 24; P.push([x0 + w * (.74 + .1 * Math.sin(t * PI) - .7 * t * t), y + hh * (.04 + .14 * Math.sin(t * PI * .9))]); }
  return P;
}
function inkPath(x, pts, lw) { x.save(); x.strokeStyle = '#1b1209'; x.lineCap = x.lineJoin = 'round'; for (let i = 1; i < pts.length; i++) { x.lineWidth = lw * (.75 + .45 * Math.abs(Math.sin(i * .21))); x.beginPath(); x.moveTo(pts[i - 1][0], pts[i - 1][1]); x.lineTo(pts[i][0], pts[i][1]); x.stroke(); } x.restore(); }
function waxSeal(x, cx, cy, r, U) {
  x.save(); x.translate(cx, cy);
  [[-1, .4], [1, -.3]].forEach(([q, tw]) => { x.save(); x.rotate(q * .4 + tw * .1); const g = x.createLinearGradient(-r * .3, 0, r * .3, 0); g.addColorStop(0, '#5a0e0b'); g.addColorStop(.5, '#a1281f'); g.addColorStop(1, '#5a0e0b'); x.fillStyle = g;
    x.beginPath(); x.moveTo(-r * .27, 0); x.lineTo(r * .27, 0); x.lineTo(r * .29, r * 1.85); x.lineTo(0, r * 1.6); x.lineTo(-r * .29, r * 1.85); x.closePath(); x.fill(); x.restore(); });
  const pts = []; for (let i = 0; i < 44; i++) { const a = i / 44 * PI * 2, rr = r * (1 + .05 * Math.sin(a * 5 + 1) + .035 * Math.sin(a * 9 + 2) + rnd(-.02, .02)); pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
  x.shadowColor = 'rgba(40,10,5,.45)'; x.shadowBlur = 10 * U; x.shadowOffsetY = 4 * U;
  let g = x.createRadialGradient(-r * .35, -r * .4, r * .1, 0, 0, r * 1.05); g.addColorStop(0, '#d9473a'); g.addColorStop(.55, '#a3221b'); g.addColorStop(1, '#650d0a');
  x.fillStyle = g; x.beginPath(); pts.forEach(([px, py], i) => i ? x.lineTo(px, py) : x.moveTo(px, py)); x.closePath(); x.fill(); x.shadowColor = 'transparent';
  x.lineWidth = 5 * U; x.strokeStyle = 'rgba(60,8,6,.55)'; x.beginPath(); x.arc(0, 0, r * .7, 0, PI * 2); x.stroke();
  x.lineWidth = 2 * U; x.strokeStyle = 'rgba(255,170,150,.35)'; x.beginPath(); x.arc(0, 1.5 * U, r * .7 + 2.5 * U, PI * .1, PI * .9); x.stroke();
  x.font = `400 ${(r * .92).toFixed(1)}px Limelight, Georgia, serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = 'rgba(255,190,170,.45)'; x.fillText('A', -1.5 * U, r * .06 - 1.5 * U); x.fillStyle = 'rgba(70,6,4,.7)'; x.fillText('A', 2 * U, r * .06 + 2 * U); x.fillStyle = '#a3221b'; x.fillText('A', 0, r * .06);
  g = x.createRadialGradient(-r * .45, -r * .5, 0, -r * .45, -r * .5, r * .55); g.addColorStop(0, 'rgba(255,225,205,.45)'); g.addColorStop(1, 'rgba(255,225,205,0)'); x.fillStyle = g; x.beginPath(); x.arc(-r * .45, -r * .5, r * .55, 0, PI * 2); x.fill();
  x.restore(); x.textBaseline = 'alphabetic';
}
function stamp(x, cx, cy, U, text) { x.save(); x.translate(cx, cy); x.rotate(-.14); x.globalAlpha = .5; x.strokeStyle = '#9c1f18'; x.lineWidth = 5 * U; const w = 290 * U, h = 80 * U; x.strokeRect(-w / 2, -h / 2, w, h); x.lineWidth = 1.6 * U; x.strokeRect(-w / 2 + 8 * U, -h / 2 + 8 * U, w - 16 * U, h - 16 * U);
  x.fillStyle = '#9c1f18'; x.font = `700 ${44 * U}px "Barlow Condensed", Arial, sans-serif`; x.textBaseline = 'middle'; spacedText(x, text, 0, 2 * U, 6 * U); x.restore(); x.textBaseline = 'alphabetic'; }
function titleBlock(x, cx, y, maxW, U, d, no) {
  x.textAlign = 'center'; x.fillStyle = '#6b4a1a'; x.font = `700 ${22 * U}px "Barlow Condensed", Arial, sans-serif`; spacedText(x, 'LA FAMIGLIA APHRITE', cx, y, 7 * U);
  y += 28 * U; flourish(x, cx, y, Math.min(maxW * .7, 300 * U), U);
  y += 132 * U; x.fillStyle = '#22160b'; fitFont(x, 'Contratto', '400 #px Limelight, Georgia, serif', 134 * U, maxW); x.fillText('Contratto', cx, y);
  y += 52 * U; x.fillStyle = '#6b4a1a'; x.font = `700 ${20 * U}px "Barlow Condensed", Arial, sans-serif`; spacedText(x, `N° ${no}  ·  ANNO MMXXVI`, cx, y, 5 * U);
  y += 42 * U; ornament(x, cx, y, Math.min(maxW * .8, 420 * U), U);
  y += 112 * U; x.fillStyle = '#22160b'; fitFont(x, d.en, '400 #px Limelight, Georgia, serif', 86 * U, maxW); x.fillText(d.en, cx, y);
  y += 54 * U; x.fillStyle = '#6b4a1a'; x.font = `italic 500 ${36 * U}px Barlow, Arial, sans-serif`; x.fillText(d.it, cx, y);
  return y;
}
function drawContract(d) {
  const a = PAPER.a = clamp(innerWidth / Math.max(1, innerHeight), .42, 2.4), land = a >= 1;
  const LS = 2048, cw = land ? LS : Math.round(LS * a), ch = land ? Math.round(LS / a) : LS;
  const [c, x] = conCanvas; c.width = cw; c.height = ch;
  const U = land ? Math.min(ch / 1000, cw / 1600) : Math.min(cw / 1000, ch / 1800);
  seed = 101 + (d.order || 1) * 7;
  // the sheet: warm ivory, darker at the edges, fibres, a coffee ring, the fold
  let g = x.createRadialGradient(cw * .5, ch * .46, Math.min(cw, ch) * .2, cw * .5, ch * .5, Math.hypot(cw, ch) * .6);
  g.addColorStop(0, '#f7efdc'); g.addColorStop(.62, '#eee1c4'); g.addColorStop(1, '#d2bd91'); x.fillStyle = g; x.fillRect(0, 0, cw, ch);
  noise(x, cw, ch, Math.round(cw * ch / 170), '#fffaf0', '#9c8456', .09);
  x.lineWidth = 1; for (let i = 0; i < 320; i++) { x.strokeStyle = `rgba(120,92,52,${rnd(.04, .1).toFixed(3)})`; const fx = rnd(0, cw), fy = rnd(0, ch), l = rnd(6, 24) * U; x.beginPath(); x.moveTo(fx, fy); x.quadraticCurveTo(fx + rnd(-l, l), fy + rnd(-l, l), fx + rnd(-l, l), fy + rnd(-l, l)); x.stroke(); }
  x.strokeStyle = 'rgba(128,88,40,.07)'; x.lineWidth = 9 * U; x.beginPath(); x.arc(cw * (land ? .9 : .82), ch * (land ? .17 : .08), 64 * U, .4, 5.3); x.stroke();
  g = land ? x.createLinearGradient(cw / 2 - 16 * U, 0, cw / 2 + 16 * U, 0) : x.createLinearGradient(0, ch / 2 - 16 * U, 0, ch / 2 + 16 * U);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.46, 'rgba(96,66,26,.13)'); g.addColorStop(.52, 'rgba(255,252,240,.4)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g;
  if (land) x.fillRect(cw / 2 - 16 * U, 0, 32 * U, ch); else x.fillRect(0, ch / 2 - 16 * U, cw, 32 * U);
  // engraved border with rosettes in the corners
  const m = 30 * U, bw = 30 * U, b0 = m + 14 * U, b1 = b0 + bw + 4 * U;
  x.strokeStyle = '#3b2a17'; x.lineWidth = 4 * U; x.strokeRect(m, m, cw - 2 * m, ch - 2 * m); x.lineWidth = 1.3 * U; x.strokeRect(m + 8 * U, m + 8 * U, cw - 2 * m - 16 * U, ch - 2 * m - 16 * U);
  guilloche(x, b0, b0, cw - 2 * b0, ch - 2 * b0, bw, U);
  x.strokeStyle = '#3b2a17'; x.lineWidth = 1.3 * U; x.strokeRect(b1, b1, cw - 2 * b1, ch - 2 * b1);
  [[b0 + bw / 2, b0 + bw / 2], [cw - b0 - bw / 2, b0 + bw / 2], [b0 + bw / 2, ch - b0 - bw / 2], [cw - b0 - bw / 2, ch - b0 - bw / 2]].forEach(([px, py]) => { x.fillStyle = '#efe3c6'; x.beginPath(); x.arc(px, py, bw * .95, 0, PI * 2); x.fill(); rosette(x, px, py, bw * .85, U); });
  // the family's mark pressed faintly into the paper
  x.save(); x.globalAlpha = .055; x.strokeStyle = '#24170b'; x.lineWidth = 10 * U; x.beginPath(); x.arc(cw / 2, ch / 2, Math.min(cw, ch) * .26, 0, PI * 2); x.stroke();
  x.fillStyle = '#24170b'; x.font = `400 ${(Math.min(cw, ch) * .36).toFixed(1)}px Limelight, Georgia, serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('A', cw / 2, ch / 2 + Math.min(cw, ch) * .02); x.restore();
  x.textBaseline = 'alphabetic';
  const X0 = b1 + 46 * U, X1 = cw - X0, Y0 = X0, Y1 = ch - X0, no = String(d.order || 1).padStart(3, '0'), rows = contractLines(d.go).slice(0, 6);
  let sig;
  if (land) {
    const xm = X0 + (X1 - X0) * .4, lc = (X0 + xm) / 2;
    const y = titleBlock(x, lc, Y0 + 40 * U, xm - X0, U, d, no);
    x.fillStyle = '#5a3f1c'; x.textAlign = 'center'; fitFont(x, 'Chi siede a questo tavolo', 'italic 500 #px Barlow, Arial, sans-serif', 26 * U, xm - X0);
    x.fillText('Chi siede a questo tavolo', lc, y + 92 * U); x.fillText('mantiene la parola.', lc, y + 128 * U);
    const dx = xm + 42 * U, dy0 = Y0 + 10 * U, dy1 = Y1 - 236 * U;
    x.strokeStyle = 'rgba(59,42,23,.7)'; x.lineWidth = 1.3 * U; [-4, 4].forEach(o => { x.beginPath(); x.moveTo(dx + o * U, dy0); x.lineTo(dx + o * U, dy1); x.stroke(); });
    x.fillStyle = '#efe3c6'; x.fillRect(dx - 12 * U, (dy0 + dy1) / 2 - 14 * U, 24 * U, 28 * U); x.fillStyle = '#3b2a17'; x.beginPath(); x.moveTo(dx, (dy0 + dy1) / 2 - 11 * U); x.lineTo(dx + 9 * U, (dy0 + dy1) / 2); x.lineTo(dx, (dy0 + dy1) / 2 + 11 * U); x.lineTo(dx - 9 * U, (dy0 + dy1) / 2); x.closePath(); x.fill();
    const rx0 = xm + 92 * U, rx1 = X1, rc = (rx0 + rx1) / 2;
    x.fillStyle = '#6b4a1a'; x.textAlign = 'center'; x.font = `700 ${22 * U}px "Barlow Condensed", Arial, sans-serif`; spacedText(x, `ARTICOLO I  ·  ${d.en.toUpperCase()}`, rc, Y0 + 40 * U, 6 * U);
    ornament(x, rc, Y0 + 74 * U, (rx1 - rx0) * .6, U);
    const top = Y0 + 160 * U, gap = clamp((dy1 - 40 * U - top) / Math.max(1, rows.length - .3), 56 * U, 80 * U);
    clauseRows(x, rx0, rx1, top, gap, U, rows, 38 * U);
    const yl = Y1 - 48 * U, sw = Math.min(430 * U, (X1 - X0) * .3);
    sigLine(x, X0, X0 + sw, yl, 'FIRMA  ·  IL CAPO', U); inkPath(x, sigPath(X0 + 24 * U, X0 + sw - 34 * U, yl - 12 * U, 74 * U), 3.2 * U);
    stamp(x, X1 - sw * .5, yl - 132 * U, U, 'APPROVATO');
    sigLine(x, X1 - sw, X1, yl, "FIRMA  ·  L'AMICO", U);
    sig = [X1 - sw + 28 * U, X1 - 36 * U, yl - 12 * U, 74 * U];
    waxSeal(x, cw / 2, yl - 96 * U, 74 * U, U);
  } else {
    const cx = cw / 2, wd = X1 - X0;
    let y = titleBlock(x, cx, Y0 + 50 * U, wd, U, d, no);
    x.fillStyle = '#6b4a1a'; x.textAlign = 'center'; x.font = `700 ${22 * U}px "Barlow Condensed", Arial, sans-serif`; spacedText(x, 'ARTICOLO I', cx, y + 92 * U, 6 * U);
    ornament(x, cx, y + 124 * U, wd * .5, U);
    const yl = Y1 - 50 * U, ys = yl - 250 * U, top = y + 210 * U, gap = clamp((ys - 190 * U - top) / Math.max(1, rows.length), 62 * U, 104 * U);
    y = clauseRows(x, X0, X1, top, gap, U, rows, 40 * U);
    x.fillStyle = '#5a3f1c'; x.textAlign = 'center'; fitFont(x, 'Chi siede a questo tavolo mantiene la parola.', 'italic 500 #px Barlow, Arial, sans-serif', 28 * U, wd);
    x.fillText('Chi siede a questo tavolo mantiene la parola.', cx, Math.min(ys - 110 * U, y + 40 * U));
    const sw = (wd - 70 * U) / 2;
    waxSeal(x, cx, ys, 82 * U, U);
    sigLine(x, X0, X0 + sw, yl, 'IL CAPO', U); inkPath(x, sigPath(X0 + 14 * U, X0 + sw - 22 * U, yl - 12 * U, 70 * U), 3 * U);
    stamp(x, X0 + sw * .42, yl - 104 * U, U * .8, 'APPROVATO');
    sigLine(x, X1 - sw, X1, yl, "L'AMICO", U);
    sig = [X1 - sw + 18 * U, X1 - 22 * U, yl - 12 * U, 70 * U];
  }
  PAPER.sigPts = sigPath(sig[0], sig[1], sig[2], sig[3], 1).map(([px, py]) => [px / cw, py / ch]);
  PAPER.sigW = 3.2 * U / cw;
  conTex.dispose(); conTex.needsUpdate = true; drawSealBack();
  shapePaper();
}
const safe = (n, d = '') => { try { return n(); } catch (e) { return d; } };
function contractLines(go) {
  const L = safe(() => LIST, []), Ms = safe(() => MATCHES, []), Ts = safe(() => tourResults(), []), F = n => safe(() => fmt(n), String(n));
  if (go === 'rank') return L.slice(0, 6).map((p, i) => [`${i + 1}.  ${p.name}`, `${F(p.elo)} pts`]);
  if (go === 'matches') return Ms.slice(-6).reverse().map(m => [`${m.win}  def.  ${m.lose}`, m.score || '']);
  if (go === 'champs') { const t = Ts.filter(t => t.win).slice(0, 6); return t.length ? t.map(t => [t.name, `♛ ${t.win}`]) : [['No champion yet.', '']]; }
  if (go === 'duel') { const a = L[0], b = L[1]; return [['Two names. One table.', ''], a && b ? [`${a.name}  vs  ${b.name}`, `${F(a.elo)} – ${F(b.elo)}`] : ['', ''], ['Head to head, points, form,', ''], ['and who walks away.', '']]; }
  return [['Points are won in tournaments.', ''], ['Go further, earn more.', ''], ['A title is worth the most.', ''], ['Boss, Underboss, Capo, Soldier.', ''], ['The table keeps quiet.', '']];
}
/* ---------- the dealt cards ---------- */
const cards = CARDS.map((d, k) => {
  const g = new THREE.Group();
  const f = new THREE.Mesh(cardGeo, M.card[k]); f.position.z = .003; f.castShadow = true;
  const b = new THREE.Mesh(cardGeo, M.back); b.rotation.y = PI; b.position.z = -.003; b.castShadow = true;
  g.add(f, b); scene.add(g);
  const hit = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W * 1.06, CARD_H * 1.06), new THREE.MeshBasicMaterial()); hit.visible = false; scene.add(hit);
  f.userData.card = b.userData.card = hit.userData.card = k;
  return { d, g, f, b, hit, rest: new THREE.Vector3(), yaw: 0, hover: 0, pick: 0, picked: false, scale: 1 };
});

/* layout: five in a fan on wide screens, three and two on tall ones */
let mode = '';
function placeCards(narrow) {
  const order = narrow ? [...cards].sort((a, b) => a.d.order - b.d.order) : cards;
  order.forEach((c, j) => {
    let x, z, yaw;
    if (!narrow) { x = (j - 2) * 1.1; z = .6 + .055 * (j - 2) * (j - 2); yaw = Math.atan2(x, 6.5 - z) * .55; c.scale = 1; }
    else if (j < 3) { x = (j - 1) * .99; z = -.6; yaw = -x * .05; c.scale = 1; }
    else { x = (j - 3.5) * 1.04; z = .74; yaw = -x * .05; c.scale = 1; }
    c.rest.set(x, .012, z); c.yaw = yaw;
    c.hit.position.set(x, .02, z); c.hit.rotation.set(-PI / 2, 0, yaw); c.hit.scale.setScalar(c.scale);
  });
}

/* ---------- camera framing ---------- */
const view = { tx: 0, ty: 1.1, tz: -.7, el: .29, dist: 8, fov: 32, shift: 0 };
const camTarget = new THREE.Vector3();
let W = 1, H = 1;
const KEY = {
  wide: [[0, 4.2, .05], [-2.95, .45, -.95], [3.45, 1.3, -.1], [-2.6, 0, 1.62], [2.6, 0, 1.62], [0, 0, 1.6]],
  narrow: [[0, 3.66, -2.62], [-1.62, .1, -.5], [1.62, .1, -.5], [-1.5, .05, 1.38], [1.5, .05, 1.38], [-1.4, 2.3, -2.5]]
};
const _v = new THREE.Vector3();
function placeCamera(px = 0, py = 0) {
  camTarget.set(view.tx, view.ty, view.tz);
  camera.position.set(view.tx + px, view.ty + Math.sin(view.el) * view.dist + py, view.tz + Math.cos(view.el) * view.dist);
  camera.lookAt(camTarget);
}
function fit() {
  const narrow = mode === 'narrow';
  camera.fov = view.fov; camera.aspect = W / H; camera.clearViewOffset(); camera.updateProjectionMatrix();
  const pts = KEY[mode];
  const mx = narrow ? .93 : .96, my = narrow ? .92 : .95;
  let cx = 0, cy = 0;
  for (let it = 0; it < 10; it++) {
    placeCamera(); camera.updateMatrixWorld();
    let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
    pts.forEach(p => { _v.set(p[0], p[1], p[2]).project(camera); x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y); });
    const k = Math.max((x1 - x0) / (2 * mx), (y1 - y0) / (2 * my));
    view.dist *= 1 + (k - 1) * .85;
    cx = (x0 + x1) / 2; cy = (y0 + y1) / 2;
  }
  view.ox = cx * W / 2; view.oy = -cy * H / 2;
  camera.setViewOffset(W, H, view.ox, view.oy, W, H); camera.updateProjectionMatrix();
}
const proj = (x, y, z) => { _v.set(x, y, z).project(camera); return [(_v.x + 1) / 2 * W, (1 - _v.y) / 2 * H]; };

/* ---------- size and layout (called by the page) ---------- */
const copyEl = document.querySelector('.cv-copy');
let stacked = false;
function layout(st) {
  stacked = !!st;
  const r = box.getBoundingClientRect();
  W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
  renderer.setSize(W, H, false);
  const narrow = W / H < 1.05;
  const nm = narrow ? 'narrow' : 'wide';
  if (nm !== mode) { mode = nm; placeCards(narrow); arrangeProps(narrow); }
  if (narrow) Object.assign(view, { tx: 0, ty: 1.1, tz: -.45, el: .5, fov: 40, shift: 0 });
  else Object.assign(view, { tx: 0, ty: 1.45, tz: -.6, el: .2, fov: 40, shift: 0 });
  lamp.position.y = narrow ? -4.45 : -5.22; LAMP_K = narrow ? 1.5 : 1; LEAN = narrow ? .2 : .42;
  fit();
  if (!stacked && copyEl) {
    copyEl.style.transform = '';
    const left = copyEl.offsetLeft;
    const [armX] = proj(-2.05, 1.6, -2.62);
    const [, chipY] = proj(-2.95, .55, -1.05);
    const cw = Math.round(Math.max(250, Math.min(470, armX - 30 - left)));
    copyEl.style.setProperty('--cw', cw + 'px'); copyEl.classList.toggle('tight', cw < 360);
    const lim = chipY - 14, T0 = copyEl.offsetTop, hh = copyEl.offsetHeight;
    if (T0 + hh > lim) copyEl.style.transform = `scale(${Math.max(.6, (lim - T0) / hh).toFixed(3)})`;
  }
  render(0);
}

/* ---------- pointer ---------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let pointer = { x: 0, y: 0, in: false }, hovered = -1, focused = -1, dealt = false;
const hitList = cards.flatMap(c => [c.hit, c.f, c.b]);
function pick(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set((ev.clientX - r.left) / r.width * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(hitList, false)[0];
  return hit ? hit.object.userData.card : -1;
}
function setHover(k) {
  if (k === hovered) return;
  hovered = k; kick();
  canvas.style.cursor = k >= 0 ? 'pointer' : '';
  if (k >= 0) sfx('hover', k);
  if (typeof window.say === 'function' || typeof say === 'function') {
    if (k >= 0) { clearTimeout(setHover.t); say('', cards[k].d.say); }
    else { clearTimeout(setHover.t); setHover.t = setTimeout(() => { if (hovered < 0 && focused < 0) say(...SAY0); }, 260); }
  }
}
canvas.addEventListener('pointermove', ev => {
  const r = canvas.getBoundingClientRect();
  pointer.x = clamp((ev.clientX - r.left) / r.width * 2 - 1, -1, 1); pointer.y = clamp((ev.clientY - r.top) / r.height * 2 - 1, -1, 1); pointer.in = true;
  if (ev.pointerType === 'mouse' && dealt && !busy) setHover(pick(ev));
});
canvas.addEventListener('pointerleave', () => { pointer.in = false; setHover(-1); });
let busy = false, anim = null, cig = 1, nextDrink = 1e9, sayOff = .95, diveE = 0, gatherRank = [0, 1, 2, 3, 4];
canvas.addEventListener('click', ev => {
  if (anim && anim.kind === 'draw') return;
  if (anim && anim.kind === 'contract') { skipContract(anim); return; }
  if (busy || !dealt) return; const k = pick(ev); if (k >= 0) choose(k);
});
function choose(k) {
  if (busy || !cards[k]) return;
  const go = cards[k].d.go, plain = () => { busy = true; enter(go); setTimeout(resetRoom, 900); };
  if (REDUCE || !dealt || typeof openPage !== 'function') return plain();
  try { drawContract(cards[k].d); } catch (e) { return plain(); }
  busy = true; hovered = k; focused = -1; cards[k].picked = true; canvas.style.cursor = '';
  gatherRank = cards.map(c => cards.filter(o => o.rest.x < c.rest.x).length);
  if (typeof say === 'function') say('Bene.', 'Let me find the papers.');
  if (anim && anim.kind === 'drink') {   // he finishes his drink first, quickly
    const dr = anim; dr.rush = k;
    setTimeout(() => { if (anim === dr) { anim = null; startContract(k); } }, 4000 * (window.__conSlow || 1));
    return;
  }
  startContract(k);
}
function startContract(k) {
  const c = anim = { kind: 'contract', t0: now, card: k, go: cards[k].d.go, shown: false, from: snapPose() };
  sfx('cards');
  // if the room stops drawing (tab in the background, scrolled away, a very slow device) the page still opens
  setTimeout(() => { if (anim === c && !c.shown) endContract(c); }, 12000 * (window.__conSlow || 1));
}
// a second click: no need to sit through the scene
function skipContract(c) {
  if (c.done || c.shown) return;
  c.done = c.shown = c.open = true;
  enter(c.go); setTimeout(() => { if (anim === c) resetRoom(); }, 900);
}
// the one way out of a contract: the page is open, the sheet is gone, the room is back at rest
function endContract(c) {
  if (!c || c.done) return; c.done = c.shown = true;
  if (c.ov) { c.ov.remove(); c.ov = null; }
  if (!c.open) { c.open = true; try { openPage(c.go); } catch (e) { } }
  if (anim === c) resetRoom();
}
function resetRoom() {
  busy = false; anim = null; sayOff = .95; diveE = 0; lighter.visible = false; paper.visible = false; paperFlat.visible = false; M_paperFlat.opacity = 0;
  cards.forEach(c => { c.picked = false; c.pick = 0; c.hover = 0; }); hovered = -1; canvas.style.cursor = '';
  coverEl.classList.remove('dive'); camera.up.set(0, 1, 0); if (mode) fit();
  restPose(lastPose); applyPose(lastPose); placeHeld();
}

/* ---------- deal ---------- */
let now = 0, dealT0 = 1e9, dealWait = .6, lightT0 = 0;
function deal(waitMs = 650) {
  if (anim && anim.kind === 'burn') endBurn(anim);
  if (anim && anim.kind === 'draw') endDraw(anim, true);
  if (anim && anim.kind !== 'light') resetRoom();
  busy = false; dealt = false; dealT0 = now; dealWait = REDUCE ? 0 : waitMs / 1000;
  cards.forEach(c => { c.hover = 0; c.picked = false; c.pick = 0; });
  if (whiskyFill < .2) whiskyFill = .5;
  if (REDUCE) { dealt = true; if (typeof say === 'function') say(...SAY0, true); }
  else sfx('deal', dealWait);
}

/* ---------- per-frame ---------- */
const q = new THREE.Quaternion(), qy = new THREE.Quaternion(), qx = new THREE.Quaternion(), qf = new THREE.Quaternion(), qc = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);
const camFwd = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
let par = { x: 0, y: 0 };
function updateCards(dt) {
  const st = REDUCE ? 9 : now - dealT0 - dealWait;
  if (!dealt && st > cards.length * .14 + 1.0) { dealt = true; nextDrink = now + 7; if (typeof say === 'function') say(...SAY0); }
  cards.forEach((c, k) => {
    const want = (c.picked ? 1 : (k === hovered || k === focused) && dealt ? 1 : 0);
    c.hover = REDUCE ? want : damp(c.hover, want, 12, dt);
    const order = mode === 'narrow' ? c.d.order - 1 : k;
    const tFly = REDUCE ? 1 : clamp((st - order * .14) / .55, 0, 1);
    const tFlip = REDUCE ? 1 : clamp((st - order * .14 - .45) / .42, 0, 1);
    const e = easeInOut(tFly);
    // position: from the deck in an arc to the spot on the felt
    const p = tmp.copy(deckPos).lerp(c.rest, e);
    p.y += Math.sin(PI * e) * .55 + (1 - tFly > 0 && tFly === 0 ? (cards.length - order) * .007 : 0);
    const flipLift = Math.sin(PI * easeInOut(tFlip)) * .28;
    p.y += flipLift;
    const h = easeOut(c.hover);
    const lean = LEAN * easeInOut(tFlip) * (1 - h);
    p.y += Math.sin(lean) * CARD_H / 2 * c.scale + h * .42; p.z += h * .34;
    const s = c.scale * (1 + h * .1);
    // rotation: yaw, laid flat (tilted toward you when lifted), flipped face up
    const yaw = lerp(.06, c.yaw, e) * (1 - h * .6);
    qy.setFromAxisAngle(AY, yaw);
    qx.setFromAxisAngle(AX, -PI / 2 + lean + h * .95);
    qf.setFromAxisAngle(AY, (1 - easeInOut(tFlip)) * PI);
    q.copy(qy).multiply(qx).multiply(qf);
    // he calls them back: face down onto the pile, one after another
    const g0 = .12 + gatherRank[k] * .085, ga = anim && anim.kind === 'contract' ? seg(now - anim.t0, g0, g0 + .62) : 0;
    let sc = s;
    if (ga > 0) {
      const ge = easeInOut(ga), fe = easeInOut(clamp(ga * 1.5, 0, 1));
      tmp2.set(mode === 'narrow' ? 0 : deckPos.x, (mode === 'narrow' ? .012 : .062) + gatherRank[k] * .0085, mode === 'narrow' ? -1.05 : deckPos.z);
      p.lerp(tmp2, ge); p.y += Math.sin(PI * ge) * .3;
      qy.setFromAxisAngle(AY, lerp(yaw, (gatherRank[k] - 2) * .03, ge));
      qx.setFromAxisAngle(AX, -PI / 2 + (lean + h * .95) * (1 - fe));
      qf.setFromAxisAngle(AY, (1 - easeInOut(tFlip)) * PI + fe * PI);
      q.copy(qy).multiply(qx).multiply(qf); sc = lerp(s, c.scale, ge);
    }
    if (c.picked && !busy) {
      c.pick = Math.min(1, c.pick + dt / .38);
      const pk = easeInOut(c.pick);
      camera.getWorldDirection(camFwd);
      tmp2.copy(camera.position).addScaledVector(camFwd, 2.6);
      p.lerp(tmp2, pk);
      qc.copy(camera.quaternion);
      q.slerp(qc, pk);
    }
    c.g.position.copy(p); c.g.quaternion.copy(q); c.g.scale.setScalar(sc);
    const dim = (hovered >= 0 || focused >= 0) && k !== hovered && k !== focused && !c.picked ? .7 : 1;
    const mat = M.card[k]; const cur = mat.color.r; const nv = REDUCE ? dim : damp(cur, dim, 10, dt); mat.color.setScalar(nv);
    mat.emissive.setRGB(.06 * h, .045 * h, .02 * h); mat.emissiveIntensity = 1;
  });
}
/* ---------- his moves: lights the cigar, drinks (cigar out with one hand, glass up with the other), deals the contract ---------- */
const AZ = new THREE.Vector3(0, 0, 1), V = (x, y, z) => new THREE.Vector3(x, y, z), ZERO = new THREE.Vector3();
const _w2b = new THREE.Matrix4(), _qa = new THREE.Quaternion();
const toBody = v => { body.updateMatrixWorld(); _w2b.copy(body.matrixWorld).invert(); return v.applyMatrix4(_w2b); };
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const smooth = (t, a, b) => easeInOut(seg(t, a, b));
const bell = (t, a, b, c, d) => smooth(t, a, b) * (1 - smooth(t, c, d));
const smoother = t => t * t * t * (t * (t * 6 - 15) + 10);
const sfx = (n, ...x) => { if (window.aphSound) aphSound.fx(n, ...x); };
const cue = (a, n, t, at, ...x) => { if (a && !a['_' + n] && t >= at) { a['_' + n] = 1; sfx(n, ...x); } };
// a pose of the upper body: both arms (turn and shoulder shift), the cigar (1 in the mouth, 0 in the left hand), the glass
const SETTLE = .35;
const newPose = () => ({ R: { q: new THREE.Quaternion(), s: new THREE.Vector3() }, L: { q: new THREE.Quaternion(), s: new THREE.Vector3() }, cigIn: 1, held: 1, tilt: 0, yaw: null, pitch: null });
function restPose(p) { ['R', 'L'].forEach(k => { p[k].q.copy(ARMS[k].rest); p[k].s.set(0, 0, 0); }); p.cigIn = 1; p.held = 1; p.tilt = 0; p.yaw = p.pitch = null; return p; }
function copyPose(a, b) { ['R', 'L'].forEach(k => { a[k].q.copy(b[k].q); a[k].s.copy(b[k].s); }); a.cigIn = b.cigIn; a.held = b.held; a.tilt = b.tilt; a.yaw = b.yaw; a.pitch = b.pitch; return a; }
function mixPose(out, a, b, w) { ['R', 'L'].forEach(k => { out[k].q.slerpQuaternions(a[k].q, b[k].q, w); out[k].s.lerpVectors(a[k].s, b[k].s, w); }); out.cigIn = lerp(a.cigIn, b.cigIn, w); out.held = lerp(a.held, b.held, w); out.tilt = lerp(a.tilt, b.tilt, w); out.yaw = b.yaw; out.pitch = b.pitch; return out; }
const pose = restPose(newPose()), poseMix = newPose(), lastPose = restPose(newPose());
const snapPose = () => copyPose(newPose(), lastPose);
function applyPose(p) { ['R', 'L'].forEach(k => { const a = ARMS[k]; a.pv.quaternion.copy(p[k].q); a.pv.position.copy(a.base).add(p[k].s); }); }
// a smooth path through key points at set times; a point repeated is a pause
const _m0 = new THREE.Vector3(), _m1 = new THREE.Vector3();
function path(keys, t, out) {
  const n = keys.length;
  if (t <= keys[0][0]) return out.copy(keys[0][1]);
  if (t >= keys[n - 1][0]) return out.copy(keys[n - 1][1]);
  let i = 0; while (t > keys[i + 1][0]) i++;
  const [t0, p0] = keys[i], [t1, p1] = keys[i + 1], d = t1 - t0, u = (t - t0) / d;
  const still = j => (j > 0 && keys[j][1].distanceToSquared(keys[j - 1][1]) < 1e-8) || (j < n - 1 && keys[j][1].distanceToSquared(keys[j + 1][1]) < 1e-8);
  if (i > 0 && !still(i)) _m0.subVectors(p1, keys[i - 1][1]).divideScalar(t1 - keys[i - 1][0]); else _m0.set(0, 0, 0);
  if (i + 2 < n && !still(i + 1)) _m1.subVectors(keys[i + 2][1], p0).divideScalar(keys[i + 2][0] - t0); else _m1.set(0, 0, 0);
  const u2 = u * u, u3 = u2 * u;
  return out.copy(p0).multiplyScalar(2 * u3 - 3 * u2 + 1).addScaledVector(_m0, (u3 - 2 * u2 + u) * d).addScaledVector(p1, -2 * u3 + 3 * u2).addScaledVector(_m1, (u3 - u2) * d);
}
const _tp = new THREE.Vector3(), _ts = new THREE.Vector3(), _sh = new THREE.Vector3(), _ad = new THREE.Vector3();
function aimArm(p, side, target, shift) { const arm = ARMS[side], a = p[side]; a.s.copy(shift); _ad.copy(target).sub(_sh.copy(arm.base).add(shift)).normalize(); a.q.setFromUnitVectors(DOWN, _ad); }
function armPath(p, side, keys, shifts, t) { aimArm(p, side, path(keys, t, _tp), shifts ? path(shifts, t, _ts) : ZERO); }

// lighting the cigar, when the room opens
const tipBody = new THREE.Vector3();
function lightPose(t, p) {
  if (t < 0) { cig = 0; return; }
  const a = anim; cue(a, 'lid', t, .3); cue(a, 'light', t, .74); cue(a, 'lidClose', t, 1.85);
  cigarTip.getWorldPosition(tipBody); toBody(tipBody); tipBody.y -= .42; tipBody.x += .02; tipBody.z += .08;
  const k = smooth(t, 0, .75) * (1 - smooth(t, 1.85, 2.5));
  aimArm(p, 'L', tipBody, ZERO); _qa.copy(p.L.q); p.L.q.slerpQuaternions(ARMS.L.rest, _qa, k);
  lighter.visible = t > .25 && t < 2.35;
  const fire = t > .78 && t < 1.8 ? 1 : 0;
  flame.visible = !!fire; flameLight.intensity = fire * (4 + Math.sin(now * 31) * .6 + Math.sin(now * 17) * .5);
  flameCore.scale.set(1, 1 + Math.sin(now * 23) * .12, 1);
  cig = smooth(t, .95, 1.6);
  p.pitch = .1 * k; p.yaw = .12 * k;
  if (t > 2.6) anim = null;
}

// a drink: the left hand takes the cigar out, the right hand brings the glass up, a slow sip, everything back
const SIP_R = V(-.4, 2.04, 1.02), SIP_R2 = V(-.36, 2.08, .98);
const HOLD_L = V(1.8, 1.62, 1.22), HOLD_L2 = V(1.83, 1.55, 1.26);
const SH_GRIP = V(-.06, .07, .22), SH_HOLD = V(.02, .05, .1), SH_SIP = V(.05, .07, .16);
const _grip = new THREE.Vector3();
function cigarGrip(out) { headPivot.updateMatrix(); return out.set(0, 0, .45).applyQuaternion(cigRestQ).add(cigRestP).applyMatrix4(headPivot.matrix); }
// where his hand goes to take the cigar: the palm comes down flat on it, the cigar lies just under the hand, never inside
const _gAx = new THREE.Vector3(), _gDir = new THREE.Vector3(), _gq = new THREE.Quaternion(), SH_G = new THREE.Vector3();
function gripReach() {
  const grip = cigarGrip(_grip);
  _gAx.set(0, 0, 1).applyQuaternion(_gq.copy(headPivot.quaternion).multiply(cigRestQ));
  _gDir.copy(grip).sub(ARMS.L.base); _gDir.addScaledVector(_gAx, -_gDir.dot(_gAx)).normalize();
  SH_G.copy(grip).sub(ARMS.L.base).addScaledVector(_gDir, -(1.5 + CIG_GAP));
  SH_GB.copy(SH_G).addScaledVector(_gDir, -.32);   // the hand comes in (and goes away) along its own line, clear of the cigar
  return grip;
}
const CIG_GAP = .1, SH_GB = new THREE.Vector3();
function drinkPose(t, p, a, dt) {
  const grip = gripReach(), LE = ARMS.L.restEnd, RE = ARMS.R.restEnd;
  armPath(p, 'L', [[0, LE], [.5, grip], [.76, grip], [1.0, grip], [1.75, HOLD_L], [3.95, HOLD_L2], [4.55, grip], [4.95, grip], [5.2, grip], [5.75, LE]],
    [[0, ZERO], [.5, SH_GB], [.76, SH_G], [1.0, SH_G], [1.75, SH_HOLD], [3.95, SH_HOLD], [4.55, SH_G], [4.95, SH_G], [5.2, SH_GB], [5.75, ZERO]], t);
  armPath(p, 'R', [[0, RE], [.55, RE], [1.72, SIP_R], [3.05, SIP_R2], [4.3, RE]], [[0, ZERO], [.55, ZERO], [1.72, SH_SIP], [3.05, SH_SIP], [4.3, ZERO]], t);
  p.cigIn = 1 - smooth(t, .9, 1.3) + smooth(t, 4.5, 4.9);
  cigSide = smooth(t, 1.12, 2.0) * (1 - smooth(t, 3.35, 4.4));   // he turns it out to the side as his hand moves away, and back on the way to his mouth
  p.held = 1;
  p.tilt = .95 * bell(t, 1.45, 2.4, 2.75, 3.4);
  if (t > 2.05 && t < 2.75) whiskyFill = Math.max(.14, whiskyFill - dt * .11);
  p.yaw = .14 * bell(t, .3, .85, 1.0, 1.5) - .06 * bell(t, 1.5, 2.1, 2.9, 3.5) + .1 * bell(t, 4.1, 4.5, 4.8, 5.2);
  p.pitch = .06 * bell(t, .3, .85, 1.0, 1.5) - .2 * bell(t, 1.55, 2.25, 2.8, 3.45);
  if (!a.exh && t > 1.36) { a.exh = true; exhale(); sfx('exhale'); }
  cue(a, 'glassUp', t, .62); cue(a, 'glassDown', t, 4.22);
  if (t > 5.8) { anim = null; nextDrink = now + 16 + Math.random() * 9; }
}

// the contract: his right hand calls the cards back, his left hand finds the papers under the table and tosses them over
const T_REL = 1.6, T_LAND = 2.0, T_STOP = 2.45, T_DIVE = 2.5, T_DIVE1 = 3.6, T_HAND = 3.62;
const UNDER = V(1.3, -.6, .3), UNDER2 = V(1.27, -.64, .27);
function contractPose(t, p, c) {
  const RE = ARMS.R.restEnd, LE = ARMS.L.restEnd;
  armPath(p, 'R', [[0, RE], [.12, RE], [.5, V(-2.05, .65, 1.55)], [.92, V(-.85, .48, 1.6)], [1.02, V(-.8, .3, 1.62)], [1.12, V(-.85, .48, 1.6)], [1.6, RE]], null, t);
  armPath(p, 'L', [[0, LE], [.12, LE], [.55, UNDER], [.8, UNDER2], [1.18, V(1.22, 1.9, 1.05)], [1.42, V(1.36, 2.1, .88)], [1.6, V(.72, 1.0, 2.0)], [1.86, V(.58, .52, 1.95)], [2.55, LE]],
    [[0, ZERO], [.12, ZERO], [.55, V(0, -.08, -.06)], [.8, V(0, -.08, -.06)], [1.18, V(0, .06, .12)], [1.42, V(0, .06, .06)], [1.6, V(-.05, 0, .26)], [1.86, V(0, 0, .14)], [2.55, ZERO]], t);
  p.held = t < .12 ? 1 : 0; p.cigIn = 1; p.tilt = 0;
  p.yaw = t < .95 ? -.12 : t < 1.15 ? .16 : 0;
  p.pitch = t < .95 ? .16 : t < 1.15 ? .22 : t < 2.4 ? .12 : .04;
}
function updateMoves(dt) {
  if (!anim && dealt && !busy && hovered < 0 && focused < 0 && now > nextDrink && !REDUCE) anim = { kind: 'drink', t0: now, from: snapPose() };
  restPose(pose); lighter.visible = false; flameLight.intensity = 0; cigSide = 0;
  const a = anim;
  if (a) {
    if (a.rush !== undefined) a.t0 -= dt * 3;   // hurrying the rest of the drink
    const t = now - a.t0;
    if (a.kind === 'light') lightPose(t, pose);
    else if (a.kind === 'drink') drinkPose(t, pose, a, dt);
    else if (a.kind === 'contract') contractPose(t, pose, a);
    else if (a.kind === 'burn') burnPose(t, pose, a);
    else if (a.kind === 'draw') drawPose((drawClock() - a.d.at) / 1000, pose, a);
    if (a.from && anim === a && t < SETTLE) { mixPose(poseMix, a.from, pose, smooth(t, 0, SETTLE)); copyPose(pose, poseMix); }
    if (!anim && a.rush !== undefined) startContract(a.rush);
  }
  applyPose(pose); copyPose(lastPose, pose);
  if (lighter.visible) { lighter.position.set(0, -1.62, .04); lighter.quaternion.copy(ARMS.L.pv.quaternion).invert(); }
  return [pose.yaw, pose.pitch];
}

// what he holds: the glass stays against the palm of his right hand, the cigar is in his mouth or between his fingers
const GLASS_TABLE = new THREE.Vector3(), MOUTH_B = V(0, 2.2, .66);
const _hp = new THREE.Vector3(), _n = new THREE.Vector3(), _gu = new THREE.Vector3(), _gm = new THREE.Vector3(), _gax = new THREE.Vector3(), _gc = new THREE.Vector3(), _go = new THREE.Vector3(), _lv = new THREE.Vector3();
const _ax = new THREE.Vector3(), _gp = new THREE.Vector3(), _cph = new THREE.Vector3(), _cqh = new THREE.Quaternion(), _mp = new THREE.Vector3(), _mq = new THREE.Quaternion(), _hqi = new THREE.Quaternion();
let cigSide = 0;
const cigHold = { on: false, p: new THREE.Vector3(), q: new THREE.Quaternion(), d0: 0 }, _rp = new THREE.Vector3(), _rq = new THREE.Quaternion();
function glassFoot(out, tilt) {
  const arm = ARMS.R; handEnd(arm, _hp); _n.copy(DOWN).applyQuaternion(arm.pv.quaternion);
  _gu.set(0, 1, 0);
  if (tilt > .001) { _gm.subVectors(MOUTH_B, _hp); _gm.y = 0; if (_gm.lengthSq() > 1e-6) { _gm.normalize(); _gax.crossVectors(_gu, _gm).normalize(); _gu.applyAxisAngle(_gax, tilt); } }
  const nu = _n.dot(_gu), hs = Math.abs(nu) * .2 + .275 * Math.sqrt(Math.max(0, 1 - nu * nu));
  _gc.copy(_hp).addScaledVector(_n, hs);
  return out.copy(_gc).addScaledVector(_gu, -.2);
}
function placeHeld() {
  glassFoot(_go, lastPose.tilt); if (lastPose.tilt < .05 && _go.y < 0) _go.y = 0;
  _go.lerpVectors(GLASS_TABLE, _go, lastPose.held);
  glassG.position.copy(_go); glassG.quaternion.setFromUnitVectors(AY, _gu);
  glassG.updateMatrixWorld(true);
  _lv.set(0, .072 + whiskyFill * .318, 0).applyMatrix4(glassG.matrixWorld); liquidPlane.constant = _lv.y;
  const w = 1 - lastPose.cigIn;
  if (w < .001) { cigarG.position.copy(cigRestP); cigarG.quaternion.copy(cigRestQ); cigHold.on = false; return; }
  const arm = ARMS.L, hq = arm.pv.quaternion; handEnd(arm, _hp); _n.copy(DOWN).applyQuaternion(hq);
  headPivot.updateMatrix(); _mp.copy(cigRestP).applyMatrix4(headPivot.matrix); _mq.copy(headPivot.quaternion).multiply(cigRestQ);
  // the moment his fingers close on it, the cigar is fixed in the hand as it was in the mouth: no jump, no spin
  if (!cigHold.on) { cigHold.on = true; _hqi.copy(hq).invert(); cigHold.p.copy(_mp).sub(_hp).applyQuaternion(_hqi); cigHold.q.copy(_hqi).multiply(_mq); cigHold.d0 = _hp.distanceTo(cigarGrip(_grip)); }
  _rp.copy(cigHold.p).applyQuaternion(hq).add(_hp); _rq.copy(hq).multiply(cigHold.q);
  // away from the mouth he turns it out to the side, so you can see it
  _ax.set(1, 0, 0).applyQuaternion(hq).multiplyScalar(.9); _ax.y += .2; _ax.z += .35; _ax.addScaledVector(_n, -_ax.dot(_n)).normalize();   // flat under the palm   // out to the side, a little up and toward you
  _gp.copy(_hp).addScaledVector(_n, CIG_GAP).addScaledVector(_ax, .44);   // held at the edge of the hand, most of it sticking out
  _cqh.setFromUnitVectors(AZ, _ax); _cph.copy(_gp).addScaledVector(_ax, -.12);
  const away = cigSide;
  _rp.lerp(_cph, away); _rq.slerp(_cqh, away);
  _mp.lerp(_rp, w); _mq.slerp(_rq, w);
  _hqi.copy(headPivot.quaternion).invert();
  cigarG.position.copy(_mp).sub(headPivot.position).applyQuaternion(_hqi);
  cigarG.quaternion.copy(_hqi).multiply(_mq);
}
glassFoot(GLASS_TABLE, 0); GLASS_TABLE.y = Math.max(0, GLASS_TABLE.y);

// the papers: in his hand, through the air, onto the felt, open; then the camera leans in until the sheet is the screen
const _ph = new THREE.Vector3(), _pq = new THREE.Quaternion(), _pq2 = new THREE.Quaternion(), _pp = new THREE.Vector3(), _e2 = new THREE.Euler();
function contractScene(t, c) {
  if (!c.fin) { const fz = mode === 'narrow' ? .25 : .5; c.fin = V(0, .008, fz); c.land = V(.05, .008, fz - .38); c.relP = new THREE.Vector3(); c.relQ = new THREE.Quaternion(); }
  paper.visible = t > .7;
  if (t < T_REL) {
    handEnd(ARMS.L, _ph); _pp.copy(DOWN).applyQuaternion(ARMS.L.pv.quaternion); _ph.addScaledVector(_pp, .3); body.localToWorld(_ph);
    _pq.setFromEuler(_e2.set(-1.15, .3, 0)); _pp.copy(PAPER.packet).applyQuaternion(_pq);
    paper.quaternion.copy(_pq); paper.position.copy(_ph).sub(_pp); paper.position.y -= .04;
    setFold(1); c.relP.copy(paper.position); c.relQ.copy(paper.quaternion);
  } else if (t < T_LAND) {
    const u = seg(t, T_REL, T_LAND);
    paper.position.lerpVectors(c.relP, c.land, u); paper.position.y += Math.sin(PI * u) * .5 * (1 - u * .3);
    _pq2.setFromEuler(_e2.set(0, .35 + (1 - easeOut(u)) * .5, 0)); paper.quaternion.slerpQuaternions(c.relQ, _pq2, easeOut(u));
    setFold(1);
  } else {
    const v = easeOut(seg(t, T_LAND, T_STOP));
    paper.position.lerpVectors(c.land, c.fin, v); paper.quaternion.setFromEuler(_e2.set(0, .35 * (1 - v), 0));
    setFold(1 - easeInOut(seg(t, T_LAND + .04, T_STOP)));
  }
  paperFlat.visible = t > T_STOP; M_paperFlat.opacity = smooth(t, T_DIVE1 - .45, T_DIVE1);
  cue(c, 'toss', t, T_REL); cue(c, 'land', t, T_LAND); cue(c, 'unfold', t, T_LAND + .06);
  if (!c.said && t > T_LAND) { c.said = true; if (typeof say === 'function') say('Ecco.', 'Sign here.'); }
  if (!c.dove && t > T_DIVE + .2) { c.dove = true; coverEl.classList.add('dive'); }
  if (t >= T_HAND && !c.shown) { c.shown = true; presentContract(c); }
}
const _cp0 = new THREE.Vector3(), _ct0 = new THREE.Vector3(), _cu0 = new THREE.Vector3();
function diveCamera(c, e) {
  if (!c.cam) c.cam = { p: camera.position.clone(), t: camTarget.clone(), ox: view.ox || 0, oy: view.oy || 0 };
  const th = Math.tan(camera.fov * PI / 360), C = paper.position, hgt = Math.max(PAPER.h, PAPER.w / (W / H)) / (2 * th);
  _cp0.set(C.x, C.y + hgt, C.z);
  camera.position.lerpVectors(c.cam.p, _cp0, e); camera.position.y += Math.sin(PI * e) * .3;
  _ct0.lerpVectors(c.cam.t, C, easeOut(e));
  camera.up.set(0, 1, 0).lerp(_cu0.set(0, 0, -1), smooth(e, .45, 1)).normalize();
  camera.lookAt(_ct0);
  camera.setViewOffset(W, H, c.cam.ox * (1 - e), c.cam.oy * (1 - e), W, H); camera.updateProjectionMatrix();
}
// the sheet takes the whole screen, your name goes on the line, and the ink runs and opens the page
function blob(g, cx, cy, R, ph, wob) { g.beginPath(); for (let i = 0; i <= 96; i++) { const a = i / 96 * PI * 2, rr = R * (1 + wob * (.55 * Math.sin(5 * a + ph) + .3 * Math.sin(11 * a - ph * 1.7) + .15 * Math.sin(23 * a + ph * 2.3))); const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr; i ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); }
let conClock = () => performance.now();
function presentContract(c) {
  const SL = window.__conSlow || 1;
  try {
    camera.updateMatrixWorld(); paper.updateMatrixWorld(true);
    const r = canvas.getBoundingClientRect(), hw = PAPER.w / 2, hh = PAPER.h / 2;
    const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([a, b]) => { const v = new THREE.Vector3(a, .006, b).applyMatrix4(paper.matrixWorld); const [px, py] = proj(v.x, v.y, v.z); return [r.left + px, r.top + py]; });
    const L = Math.min(...pts.map(p => p[0])), R = Math.max(...pts.map(p => p[0])), T = Math.min(...pts.map(p => p[1])), B = Math.max(...pts.map(p => p[1]));
    const ov = c.ov = document.createElement('div'); ov.className = 'contract-ov'; ov.setAttribute('aria-hidden', 'true');
    const cv = document.createElement('canvas'), dpr = Math.min(devicePixelRatio || 1, 1.5), VW = innerWidth, VH = innerHeight;
    cv.width = Math.round(VW * dpr); cv.height = Math.round(VH * dpr); ov.appendChild(cv);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    document.body.appendChild(ov);
    const src = conCanvas[0], sig = PAPER.sigPts, n = sig.length, ink = '#0b0907';
    const TG = 380 * SL, TS = 560 * SL, TI = 900 * SL, t0 = conClock();
    setTimeout(() => { if (!c.done) sfx('sign', TS / 1000); }, TG); setTimeout(() => { if (!c.done) sfx('ink'); }, TG + TS);
    const drops = Array.from({ length: 18 }, (_, i) => [i / 18 * PI * 2 + Math.random() * .3, 1.03 + Math.random() * .14, .01 + Math.random() * .02]);
    const step = () => {
      if (c.done) return;
      const el = conClock() - t0, gk = easeInOut(Math.min(1, el / TG));
      const x0 = lerp(L, 0, gk), y0 = lerp(T, 0, gk), w = lerp(R - L, VW, gk), h = lerp(B - T, VH, gk);
      g.clearRect(0, 0, VW, VH); g.drawImage(src, x0, y0, w, h);
      const sk = clamp((el - TG) / TS, 0, 1);
      if (sk > 0 && n > 1) {   // your name on the line, as if the pen were moving
        const upto = easeInOut(sk) * (n - 1), lw = Math.max(1.2, PAPER.sigW * w);
        g.strokeStyle = '#1b1209'; g.lineCap = g.lineJoin = 'round';
        for (let i = 1; i <= Math.ceil(upto); i++) { const f = Math.min(1, upto - (i - 1)), [ax, ay] = sig[i - 1], [bx, by] = sig[i];
          g.lineWidth = lw * (.75 + .45 * Math.abs(Math.sin(i * .21))); g.beginPath(); g.moveTo(x0 + ax * w, y0 + ay * h); g.lineTo(x0 + (ax + (bx - ax) * f) * w, y0 + (ay + (by - ay) * f) * h); g.stroke(); }
      }
      const ik = clamp((el - TG - TS) / TI, 0, 1);
      if (ik > 0) {   // the ink spreads from the end of your name and the page shows through
        if (!c.open) { c.open = true; try { openPage(c.go); } catch (e) { } }
        const [lx, ly] = n ? sig[n - 1] : [.8, .85], cx = x0 + lx * w, cy = y0 + ly * h;
        const Rm = Math.hypot(Math.max(cx, VW - cx), Math.max(cy, VH - cy)), Rk = Rm * 1.32 * (.025 + .975 * Math.pow(ik, 1.7)), ph = el / 380;
        g.fillStyle = ink; g.globalAlpha = .32; blob(g, cx, cy, Rk * 1.06, ph, .09); g.fill();
        g.globalAlpha = .96; blob(g, cx, cy, Rk, ph, .07); g.fill();
        drops.forEach(([a, dd, sz]) => { g.beginPath(); g.arc(cx + Math.cos(a) * Rk * dd, cy + Math.sin(a) * Rk * dd, Rk * sz, 0, PI * 2); g.fill(); });
        g.globalAlpha = 1; g.globalCompositeOperation = 'destination-out'; blob(g, cx, cy, Rk * .88, ph + 1, .06); g.fill(); g.globalCompositeOperation = 'source-over';
      }
      if (ik >= 1) { endContract(c); return; }
      requestAnimationFrame(step);
    };
    step();
    setTimeout(() => endContract(c), TG + TS + TI + 1600 * SL);   // the sheet never stays over the page
  } catch (e) { endContract(c); }
}

/* ---------- the way back: the contract is on the table again, he puts his lighter to it, it burns, he deals again ---------- */
const BW = 1024, burnBase = makeCanvas(BW, 640), burnCv = makeCanvas(BW, 640), burnTex = tex(burnCv[0], { aniso: 8 });
const M_burnLit = new THREE.MeshStandardMaterial({ map: burnTex, roughness: .85, transparent: true, depthWrite: false, envMapIntensity: .15 });
const paperLit = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), M_burnLit); paperLit.rotation.x = -PI / 2; paperLit.position.y = .004; paperLit.renderOrder = 5; paperLit.visible = false; paperLit.receiveShadow = true; paper.add(paperLit);
const fires = Array.from({ length: 16 }, (_, i) => { const s = glowSprite(i % 3 ? 0xff8a2a : 0xffc860, .3, 0); s.visible = false; scene.add(s); return s; });
const fireLight = new THREE.PointLight(0xff7a26, 0, 4.5, 2); scene.add(fireLight);
const T_LIT = 1.95, T_BURN = 2.5, T_DEAL = 4.25, T_END = 5.3;
function burnEdge(r, t, ph) {   // a ragged, moving line, out from the corner nearest to him
  const [c] = burnCv, ox = c.width * .985, oy = c.height * .02, pts = [];
  for (let i = 0; i <= 120; i++) { const a = PI / 2 - .3 + i / 120 * (PI / 2 + .6),
    n = .14 * Math.sin(a * 7 + ph[0] + t * 2) + .07 * Math.sin(a * 13 + ph[1] - t * 3) + .035 * Math.sin(a * 29 + ph[2] + t * 5) + .05 * Math.sin(a * 3 + ph[3]);
    pts.push([ox + Math.cos(a) * r * (1 + n), oy + Math.sin(a) * r * (1 + n)]); }
  return pts;
}
function burnPaint(b, t, a) {
  const [c, x] = burnCv, w = c.width, h = c.height;
  x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, w, h); x.drawImage(burnBase[0], 0, 0, w, h);
  if (b > 0) {
    const r = Math.hypot(w, h) * 1.5 * Math.pow(b, 1.25), pts = a.pts = burnEdge(r, t, a.ph), ox = w * .985, oy = h * .02;
    const ring = grow => { x.beginPath(); x.moveTo(w + 60, -60); pts.forEach(([px, py]) => { const dx = px - ox, dy = py - oy, l = Math.hypot(dx, dy) || 1; x.lineTo(px + dx / l * grow, py + dy / l * grow); }); x.closePath(); };
    x.globalCompositeOperation = 'source-atop';
    ring(70); x.fillStyle = 'rgba(120,70,20,.22)'; x.fill();
    ring(30); x.fillStyle = 'rgba(70,34,10,.55)'; x.fill();
    ring(11); x.fillStyle = 'rgba(28,12,4,.92)'; x.fill();
    x.globalCompositeOperation = 'source-over'; x.save(); x.shadowColor = 'rgba(255,120,20,1)'; x.shadowBlur = 16;
    x.strokeStyle = 'rgba(255,160,50,1)'; x.lineWidth = 5; x.beginPath(); pts.forEach(([px, py], i) => i ? x.lineTo(px, py) : x.moveTo(px, py)); x.stroke();
    x.strokeStyle = 'rgba(255,240,180,1)'; x.lineWidth = 2; x.stroke(); x.restore();
    x.globalCompositeOperation = 'destination-out'; ring(-4); x.fill(); x.globalCompositeOperation = 'source-over';
  }
  burnTex.needsUpdate = true;
}
const _fw = new THREE.Vector3();
function burnToWorld(px, py, out) { const [c] = burnCv; return out.set((px / c.width - .5) * PAPER.w, .05, (py / c.height - .5) * PAPER.h).add(paper.position); }
function burnPose(t, p, a) {
  const LE = ARMS.L.restEnd;
  if (!a.hand) { const [c] = burnCv; burnToWorld(c.width * .985, c.height * .02, _fw); _fw.x += .12; _fw.y = -.05; _fw.z -= .02; a.hand = toBody(_fw.clone()); a.hand2 = a.hand.clone().add(V(.02, .03, .04)); }
  armPath(p, 'L', [[0, LE], [.95, LE], [1.6, a.hand], [2.7, a.hand2], [3.35, LE]], [[0, ZERO], [.95, ZERO], [1.6, V(-.06, -.3, .82)], [2.7, V(-.06, -.3, .82)], [3.35, ZERO]], t);
  lighter.visible = t > 1.05 && t < 3.25;
  const fire = t > 1.62 && t < 2.72 ? 1 : 0;
  flame.visible = !!fire; flameLight.intensity = fire * (4 + Math.sin(now * 31) * .6 + Math.sin(now * 17) * .5);
  flameCore.scale.set(1, 1 + Math.sin(now * 23) * .12, 1);
  const k = bell(t, .8, 1.4, 3.6, 4.3); p.pitch = .24 * k; p.yaw = .1 * k; p.held = 1; p.cigIn = 1; p.tilt = 0;
  cue(a, 'lid', t, 1.3); cue(a, 'light', t, 1.55); cue(a, 'lidClose', t, 2.85);
}
function burnScene(t, a) {
  paper.visible = true; paperBase.visible = flapPivot.visible = false; paperLit.visible = true; paperFlat.visible = t < 1.6;
  M_paperFlat.opacity = 1 - smooth(t, .35, 1.3); M_burnLit.opacity = 1;
  const b = seg(t, T_LIT, T_LIT + T_BURN);
  if (b > 0 && (b < 1 || !a.ash)) { burnPaint(b, now, a); if (b >= 1) a.ash = true; }
  if (b > 0 && b < 1 && !a._burn) { a._burn = 1; sfx('burn', T_BURN); }
  const heat = smooth(t, T_LIT, T_LIT + .35) * (1 - smooth(t, T_LIT + T_BURN - .5, T_LIT + T_BURN + .15));
  let cx = 0, cz = 0, n = 0;
  const on = a.pts ? a.pts.filter(([px, py]) => px > 4 && py > 4 && px < burnCv[0].width - 4 && py < burnCv[0].height - 4) : [];
  fires.forEach((f, i) => {
    if (!on.length || heat <= 0) { f.visible = false; return; }
    const [px, py] = on[Math.floor((i + .5) / fires.length * on.length)];
    burnToWorld(px, py, f.position); const fl = .7 + .3 * Math.sin(now * (9 + i) + i * 2.1) * Math.sin(now * 5.3 + i);
    f.position.y = .05 + fl * .08; f.scale.set(.28 + fl * .18, .38 + fl * .3, 1); f.material.opacity = heat * (.55 + .45 * fl); f.visible = true;
    cx += f.position.x; cz += f.position.z; n++;
  });
  if (n) fireLight.position.set(cx / n, .45, cz / n);
  fireLight.intensity = heat * (5 + Math.sin(now * 13) * 1.2 + Math.sin(now * 7.7) * .8);
  if (heat > .3 && on.length && Math.random() < .35) { const s = smoke.find(q => !q.visible); if (s) { const [px, py] = on[Math.random() * on.length | 0]; burnToWorld(px, py, s.position); const u = s.userData; u.life = 0; u.max = 1.8 + Math.random(); u.vx = (Math.random() - .5) * .1; u.vz = (Math.random() - .5) * .1; u.rot = (Math.random() - .5) * .6; s.material.rotation = Math.random() * PI * 2; s.visible = true; } }
  if (!a.said && t > T_LIT + .3) { a.said = true; if (typeof say === 'function') say('Allora.', 'Pick another one.'); }
  if (!a.dealt && t > T_DEAL) { a.dealt = true; dealT0 = now; dealWait = .05; sfx('deal', dealWait); }
  if (t > T_END) endBurn(a);
}
function endBurn(a) {
  if (!a || a.done) return; a.done = true;
  if (a.ov) { a.ov.remove(); a.ov = null; }
  fires.forEach(f => f.visible = false); fireLight.intensity = 0;
  paper.visible = false; paperBase.visible = flapPivot.visible = true; paperLit.visible = false; paperFlat.visible = false; M_paperFlat.opacity = 0;
  coverEl.classList.remove('dive'); camera.up.set(0, 1, 0); if (mode) fit();
  if (!a.dealt) { dealT0 = now; dealWait = .05; sfx('deal', dealWait); }
  if (anim === a) anim = null;
  busy = false; diveE = 0;
  if (a.done2) a.done2();
}
function back(go, swap, done) {
  const plain = () => { try { swap(); } catch (e) { } deal(380); if (done) done(); };
  if (REDUCE || frozen || typeof openPage !== 'function') return plain();
  try {
    const card = cards.find(c => c.d.go === go) || cards[0];
    drawContract(card.d);
    // the signed sheet, as it was when you entered
    const [bc, bx] = burnBase, [cc] = conCanvas; bc.width = BW; bc.height = Math.round(BW * cc.height / cc.width); burnCv[0].width = bc.width; burnCv[0].height = bc.height;
    bx.drawImage(cc, 0, 0, bc.width, bc.height);
    const sig = PAPER.sigPts; bx.strokeStyle = '#1b1209'; bx.lineCap = bx.lineJoin = 'round';
    for (let i = 1; i < sig.length; i++) { bx.lineWidth = Math.max(1.2, PAPER.sigW * bc.width) * (.75 + .45 * Math.abs(Math.sin(i * .21))); bx.beginPath(); bx.moveTo(sig[i - 1][0] * bc.width, sig[i - 1][1] * bc.height); bx.lineTo(sig[i][0] * bc.width, sig[i][1] * bc.height); bx.stroke(); }
    burnTex.dispose(); burnPaint(0, 0, {});
    M_paperFlat.map = burnTex; M_paperFlat.needsUpdate = true;
    // the page turns back into the sheet
    const ov = document.createElement('div'); ov.className = 'contract-ov'; ov.setAttribute('aria-hidden', 'true');
    const cv = document.createElement('canvas'), dpr = Math.min(devicePixelRatio || 1, 1.5), VW = innerWidth, VH = innerHeight;
    cv.width = Math.round(VW * dpr); cv.height = Math.round(VH * dpr); ov.appendChild(cv); document.body.appendChild(ov);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const draw = (x0, y0, w, h) => { g.clearRect(0, 0, VW, VH); g.drawImage(bc, x0, y0, w, h); };
    draw(0, 0, VW, VH);
    let a = null;
    const fin = () => { M_paperFlat.map = conTex; M_paperFlat.needsUpdate = true; if (done) done(); };
    let watchdog = 0;   // if the room stops drawing (tab in the background, a stalled device), the table still comes back
    const wd = () => { if (!a) { ov.remove(); fin(); plain(); return; } if (a.done) return; if (now === a.lastNow) { endBurn(a); return; } a.lastNow = now; watchdog = setTimeout(wd, 2500); };
    watchdog = setTimeout(wd, 4000);
    ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out', fill: 'forwards' }).finished.then(() => {
      swap();
      resetRoom(); cig = 1; busy = true; dealt = false; dealT0 = now; dealWait = 99; hovered = focused = -1;
      cards.forEach(c => { c.hover = 0; c.picked = false; c.pick = 0; });
      M_paperFlat.map = burnTex; M_paperFlat.needsUpdate = true;
      paper.position.set(0, .008, mode === 'narrow' ? .16 : .02); paper.quaternion.identity(); setFold(0); paperLit.scale.set(PAPER.w, PAPER.h, 1);
      a = anim = { kind: 'burn', t0: now + .38, from: snapPose(), ov, ph: [...Array(4)].map(() => Math.random() * 6.28), done2: () => { clearTimeout(watchdog); fin(); } };
      coverEl.classList.add('dive'); diveE = 1;
      render(0); onScreen = true; start();
      // the sheet on the screen shrinks onto the sheet on the table
      camera.updateMatrixWorld(); paper.updateMatrixWorld(true);
      const r = canvas.getBoundingClientRect(), hw = PAPER.w / 2, hh = PAPER.h / 2;
      const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => { const q = new THREE.Vector3(u, .006, v).applyMatrix4(paper.matrixWorld); const [px, py] = proj(q.x, q.y, q.z); return [r.left + px, r.top + py]; });
      const L = Math.min(...pts.map(q => q[0])), R = Math.max(...pts.map(q => q[0])), T = Math.min(...pts.map(q => q[1])), B = Math.max(...pts.map(q => q[1]));
      const t0 = performance.now(), D = 360;
      const step = () => { if (!a.ov) return; const k = easeInOut(Math.min(1, (performance.now() - t0) / D));
        draw(lerp(0, L, k), lerp(0, T, k), lerp(VW, R - L, k), lerp(VH, B - T, k));
        if (k < 1) requestAnimationFrame(step); else { a.ov.remove(); a.ov = null; } };
      requestAnimationFrame(step);
    });
  } catch (e) { plain(); }
}

/* ---------- film look for the draw: bloom, grain, vignette, colour grade, letterbox ---------- */
const FXP = { on: false, ok: true, rt: null, bright: null, mips: [], w: 0, h: 0, bars: 0, bloom: 1.1, time: 0 };
const fxCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), fxScene = new THREE.Scene();
const fxGeo = new THREE.BufferGeometry();
fxGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
fxGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const fxQuad = new THREE.Mesh(fxGeo); fxQuad.frustumCulled = false; fxScene.add(fxQuad);
const FX_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
const fxMat = (frag, uniforms, toneMapped = false) => new THREE.ShaderMaterial({ vertexShader: FX_VS, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped });
const brightMat = fxMat(`uniform sampler2D tex; uniform float thr; varying vec2 vUv; /* bright parts only */
  void main(){ vec3 c = texture2D(tex, vUv).rgb; float l = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c * smoothstep(thr, thr + .9, l), 1.); }`, { tex: { value: null }, thr: { value: .95 } });
const blurMat = fxMat(`uniform sampler2D tex; uniform vec2 dir; varying vec2 vUv;
  void main(){ vec3 c = texture2D(tex, vUv).rgb * .227;
    c += (texture2D(tex, vUv + dir * 1.385).rgb + texture2D(tex, vUv - dir * 1.385).rgb) * .316;
    c += (texture2D(tex, vUv + dir * 3.231).rgb + texture2D(tex, vUv - dir * 3.231).rgb) * .070;
    gl_FragColor = vec4(c, 1.); }`, { tex: { value: null }, dir: { value: new THREE.Vector2() } });
const finalMat = fxMat(`uniform sampler2D tex; uniform sampler2D b0; uniform sampler2D b1; uniform sampler2D b2; uniform float bloom; uniform float time; uniform float bars; uniform vec2 res; varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){
    vec2 uv = vUv, d = uv - .5; float r2 = dot(d, d);
    vec3 c = vec3(texture2D(tex, uv - d * .006).r, texture2D(tex, uv).g, texture2D(tex, uv + d * .006).b);   // a little lens fringe at the edges
    c += (texture2D(b0, uv).rgb * .5 + texture2D(b1, uv).rgb * .8 + texture2D(b2, uv).rgb * 1.1) * bloom;
    float l = dot(c, vec3(.2126, .7152, .0722));
    c = mix(c, c * vec3(.78, .9, 1.25), (1. - smoothstep(0., .35, l)) * .55);   // cold shadows
    c = mix(c, c * vec3(1.12, 1., .86), smoothstep(.5, 1.6, l) * .4);          // warm highlights
    c = mix(vec3(l), c, 1.08);
    c *= 1. - smoothstep(.12, .75, r2) * .75;                                    // vignette
    gl_FragColor = vec4(c, 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    float g = hash(uv * res + fract(time * 13.1) * 100.) - .5;
    gl_FragColor.rgb += g * .07;                                                 // film grain
    gl_FragColor.rgb *= .97 + .03 * sin(time * 47.);                             // a faint projector flicker
    if (abs(uv.y - .5) > .5 - bars) gl_FragColor = vec4(0., 0., 0., 1.);         // cinema bars
  }`, { tex: { value: null }, b0: { value: null }, b1: { value: null }, b2: { value: null }, bloom: { value: 1 }, time: { value: 0 }, bars: { value: 0 }, res: { value: new THREE.Vector2() } }, true);
function fxTargets() {
  const v = renderer.getDrawingBufferSize(new THREE.Vector2()), w = Math.max(2, v.x | 0), h = Math.max(2, v.y | 0);
  if (FXP.rt && FXP.w === w && FXP.h === h) return;
  [FXP.rt, FXP.bright, ...FXP.mips.flatMap(m => [m.a, m.b])].forEach(t => t && t.dispose());
  const mk = (a, b, samples = 0) => new THREE.WebGLRenderTarget(a, b, { type: THREE.HalfFloatType, samples, depthBuffer: !!samples });
  FXP.rt = mk(w, h, 4); FXP.rt.depthBuffer = true;
  FXP.bright = mk(w >> 1, h >> 1);
  FXP.mips = [2, 4, 8].map(k => ({ a: mk(Math.max(1, w / k / 2 | 0), Math.max(1, h / k / 2 | 0)), b: mk(Math.max(1, w / k / 2 | 0), Math.max(1, h / k / 2 | 0)) }));
  FXP.w = w; FXP.h = h;
}
function fxPass(mat, target) { fxQuad.material = mat; renderer.setRenderTarget(target); renderer.render(fxScene, fxCam); }
function fxRender() {
  fxTargets();
  renderer.setRenderTarget(FXP.rt); renderer.render(scene, camera);
  brightMat.uniforms.tex.value = FXP.rt.texture; fxPass(brightMat, FXP.bright);
  let src = FXP.bright;
  FXP.mips.forEach(m => {
    blurMat.uniforms.tex.value = src.texture; blurMat.uniforms.dir.value.set(1 / m.a.width, 0); fxPass(blurMat, m.b);
    blurMat.uniforms.tex.value = m.b.texture; blurMat.uniforms.dir.value.set(0, 1 / m.a.height); fxPass(blurMat, m.a);
    src = m.a;
  });
  const u = finalMat.uniforms; u.tex.value = FXP.rt.texture; u.b0.value = FXP.mips[0].a.texture; u.b1.value = FXP.mips[1].a.texture; u.b2.value = FXP.mips[2].a.texture;
  u.bloom.value = FXP.bloom; u.time.value = now; u.bars.value = FXP.bars; u.res.value.set(FXP.w, FXP.h);
  fxPass(finalMat, null);
}
function fxOn(on) { FXP.on = !!on && FXP.ok; if (!on) FXP.bars = 0; }
function renderFrame() {
  if (FXP.on) { try { fxRender(); return; } catch (e) { FXP.ok = FXP.on = false; renderer.setRenderTarget(null); } }
  renderer.render(scene, camera);
}

/* ---------- the map draw: he flips a gold coin, slaps it on his hand, and the map is on it ---------- */
let drawClock = () => Date.now();
const DRAW_T = { coin: 4.7 };   // when the coin is uncovered, seconds after the draw time
const COIN_LAND = 2.4;            // when it lands on the back of his hand
// the coin: the map engraved on one face, a star on the other
function coinFace(name, star) {
  const [c, x] = makeCanvas(512, 512), cx = 256;
  let g = x.createRadialGradient(190, 170, 20, cx, cx, 270); g.addColorStop(0, '#d9ad52'); g.addColorStop(.5, '#a8772a'); g.addColorStop(1, '#5c3a0c');
  x.fillStyle = g; x.beginPath(); x.arc(cx, cx, 256, 0, PI * 2); x.fill();
  x.strokeStyle = 'rgba(110,64,8,.8)'; x.lineWidth = 10; x.beginPath(); x.arc(cx, cx, 226, 0, PI * 2); x.stroke();
  for (let i = 0; i < 72; i++) { x.save(); x.translate(cx, cx); x.rotate(i * PI / 36); x.fillStyle = 'rgba(120,72,10,.55)'; x.fillRect(-3, -252, 6, 18); x.restore(); }
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const engrave = (txt, y, font) => { x.font = font; x.fillStyle = 'rgba(255,236,170,.9)'; x.fillText(txt, cx + 3, y + 4); x.fillStyle = '#241302'; x.fillText(txt, cx, y); };
  if (star) {
    x.save(); x.translate(cx, cx); x.fillStyle = '#7a4a0c'; x.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 50 : 120, a = -PI / 2 + i * PI / 5; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.closePath(); x.fill(); x.restore();
    engrave('APHRITE', 410, '400 46px Limelight, serif');
  } else {
    const t = String(name).toUpperCase(); fitFont(x, t, '400 #px Limelight, serif', 118, 370); const f = x.font;
    engrave(t, cx + 6, f);
    engrave('★  APHRITE  ★', 120, '700 34px "Barlow Condensed", Arial, sans-serif');
    engrave('THE DRAW', 396, '700 30px "Barlow Condensed", Arial, sans-serif');
  }
  return tex(c, { aniso: 16 });
}
function buildCoin(name) {
  const R = .4, TH = .07, g = new THREE.Group();
  const edge = new THREE.MeshStandardMaterial({ color: 0xd9a63a, metalness: 1, roughness: .28, envMapIntensity: 1.4 });
  const top = new THREE.MeshStandardMaterial({ map: coinFace(name, false), metalness: .45, roughness: .55, envMapIntensity: .8, emissive: 0x3a2200, emissiveIntensity: .15 });
  const bot = new THREE.MeshStandardMaterial({ map: coinFace(name, true), metalness: .5, roughness: .5, envMapIntensity: .9, emissive: 0x3a2200, emissiveIntensity: .5 });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(R, R, TH, 64, 1, true), edge); m.castShadow = true; g.add(m);
  const f1 = new THREE.Mesh(new THREE.CircleGeometry(R, 64), top); f1.rotation.x = -PI / 2; f1.position.y = TH / 2; g.add(f1);
  const f2 = new THREE.Mesh(new THREE.CircleGeometry(R, 64), bot); f2.rotation.x = PI / 2; f2.position.y = -TH / 2; g.add(f2);
  const glint = glowSprite(0xffe2a0, 1.1, 0); g.add(glint);
  const light = new THREE.PointLight(0xffcf70, 0, 3, 2); light.position.y = .4; g.add(light);
  g.visible = false; scene.add(g);
  return { g, m, glint, light, TH, top };
}

// lying on the back of his hand, the top of the text towards him so it reads upright for us
function coinRest(up) {
  const Y = up.clone().normalize(), Zt = V(0, 0, -1); Zt.addScaledVector(Y, -Zt.dot(Y)).normalize();   // towards the boss
  const Z = Zt.clone().negate(), X = new THREE.Vector3().crossVectors(Y, Z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
}
const _dcp = new THREE.Vector3(), _dct = new THREE.Vector3();
function drawCamera(a, e, pos, tgt) {   // eases the camera from where it is to the shot
  if (!a.cam) a.cam = { p: camera.position.clone(), t: camTarget.clone(), ox: view.ox || 0, oy: view.oy || 0 };
  _dcp.lerpVectors(a.cam.p, pos, e); _dct.lerpVectors(a.cam.t, tgt, e);
  camera.position.copy(_dcp); camera.up.set(0, 1, 0); camera.lookAt(_dct);
  camera.setViewOffset(W, H, a.cam.ox * (1 - e), a.cam.oy * (1 - e), W, H); camera.updateProjectionMatrix();
}
function drawScene(d, style, onReveal) {
  if (frozen || REDUCE) return false;
  if (anim && anim.kind === 'contract') endContract(anim);
  if (anim && anim.kind === 'burn') endBurn(anim);
  endDraw(drawA, true);
  resetRoom(); busy = true; dealt = false; dealT0 = now; dealWait = 999; hovered = focused = -1; cig = 1;
  cards.forEach(c => { c.hover = 0; c.picked = false; c.pick = 0; c.g.visible = false; }); deckGroup.visible = false;
  const a = drawA = anim = { kind: 'draw', style: 'coin', d, from: snapPose(), onReveal, narrow: mode === 'narrow' };
  a.coin = buildCoin(d.map);
  try {
    a.coin.g.visible = true; a.coin.g.position.set(0, -50, 0); renderer.compile(scene, camera);
    a.coin.g.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.map && renderer.initTexture(m.map)); });
    fxTargets(); [brightMat, blurMat, finalMat].forEach(m => { fxQuad.material = m; renderer.compile(fxScene, fxCam); });
    a.coin.g.visible = false;
  } catch (e) {}
  if (typeof say === 'function') { const R = { qf: 'Quarter-final', sf: 'Semi-final', f: 'The final', b: 'Third place' }[d.round] || (d.roundRaw || 'The draw'); say(R + '.', `${d.a} against ${d.b}.`); }
  onScreen = true; start(); return true;
}
let drawA = null;
function endDraw(a, quiet) {
  if (!a || a.done) return; a.done = true;
  if (a.coin) { scene.remove(a.coin.g); }
  fxOn(false);
  cards.forEach(c => c.g.visible = true); deckGroup.visible = !!SPOTS[mode === 'narrow' ? 'narrow' : 'wide'].deck; coverEl.classList.remove('dive');
  camera.up.set(0, 1, 0); if (mode) fit();
  if (anim === a) anim = null;
  busy = false; lighter.visible = false;
  if (!quiet) { dealT0 = now; dealWait = .2; sfx('deal', dealWait); }
}
// keys in world space; the shoulder moves so the hand lands right on the point
const _rk = new THREE.Vector3(), _rs = new THREE.Vector3();
function reach(p, side, keys, t) {
  path(keys, t, _rk); toBody(_rk);
  const arm = ARMS[side]; _rs.copy(_rk).sub(arm.base); const L = _rs.length();
  _rs.multiplyScalar(L > 1e-4 ? clamp(L - 1.5, -.5, .95) / L : 0);
  aimArm(p, side, _rk, _rs);
}
// the back of a hand: centre of the glove and the way its top faces
function handTop(side, out, up) {
  const pv = ARMS[side].pv; pv.updateMatrixWorld(true);
  out.copy(pv.localToWorld(V(0, -1.3, 0)));
  up.set(0, 0, 1).applyQuaternion(pv.getWorldQuaternion(new THREE.Quaternion())).normalize();
  return out;
}
const restW = side => body.localToWorld(ARMS[side].restEnd.clone());
// where his hands go (tips of the arms, in the room)
const FLICK = V(-.35, 1.35, -1.3), SHOW = V(.35, .95, -1.05);
function drawPose(t, p, a) {
  p.held = 0; p.cigIn = 1; p.tilt = 0;
  const RR = restW('R'), RL = restW('L');
  // left hand comes out flat, back up, and waits
  reach(p, 'L', [[-.6, RL], [1.2, SHOW], [DRAW_T.coin + 2.4, SHOW], [DRAW_T.coin + 3.2, RL]], t);
  // right hand: up with the coin, a dip, the flick, then over the left hand, the slap, the reveal
  const slap = (a.slap || SHOW.clone().add(V(-.1, .55, -.1))), over = slap.clone().add(V(0, .7, .15));
  reach(p, 'R', [[-2.2, RR], [-1.1, FLICK], [-.45, FLICK], [-.08, FLICK.clone().add(V(0, -.16, 0))], [.12, FLICK.clone().add(V(0, .3, .05))], [.8, FLICK],
    [1.7, over], [COIN_LAND - .1, over], [COIN_LAND, slap], [3.75, slap], [4.35, slap.clone().add(V(-.5, .95, .3))], [5.4, RR]], t);
  // eyes on the coin: up with it, down to the hand
  const up = bell(t, .1, .7, 1.6, 2.3);
  p.yaw = 0; p.pitch = lerp(.2, -.35, up);
}
function drawSceneUpdate(dt) {
  const a = anim, d = a.d, t = (drawClock() - d.at) / 1000, T = DRAW_T.coin, c = a.coin, n = a.narrow;
  fxOn(t > -2.4 && t < T + 3.2); FXP.bloom = .55;
  FXP.bars = (n ? .03 : .07) * smooth(t, -2.4, -1.4) * (1 - smooth(t, T + 2.4, T + 3.2));
  const hR = handTop('R', V(), V()), upR = new THREE.Vector3(); handTop('R', hR, upR);
  const hL = V(), upL = V(); handTop('L', hL, upL);
  if (!a.slap) { const s0 = hL.clone().addScaledVector(upL, .95); a.slapTmp = s0; }
  // where the right hand must go so its palm covers the coin: the arm tip a little past the glove's centre
  if (t > 1 && !a.slap) { const sh = ARMS.R.pv.getWorldPosition(V()), ctr = hL.clone().addScaledVector(upL, .47 + c.TH + .46); a.slap = ctr.clone().add(ctr.clone().sub(sh).normalize().multiplyScalar(.2)); }
  // the coin
  const onR = hR.clone().addScaledVector(upR, .47 + c.TH / 2), onL = hL.clone().addScaledVector(upL, .47 + c.TH / 2);
  c.g.visible = t > -1.4;
  const qFlat = (up) => new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), up);
  if (t < 0) { c.g.position.copy(onR); c.g.quaternion.copy(qFlat(upR)); a.from0 = onR.clone(); }
  else if (t < COIN_LAND) {
    const u = t / COIN_LAND, s = u + .8 * Math.sin(2 * PI * u) / (2 * PI);   // fast up, slow at the top, fast down
    const p0 = a.from0 || onR, p1 = onL, apex = Math.max(p0.y, p1.y) + 3.3;
    const pos = V().lerpVectors(p0, p1, s); pos.y = (1 - s) * (1 - s) * p0.y + 2 * (1 - s) * s * (2 * apex - (p0.y + p1.y) / 2) + s * s * p1.y;
    c.g.position.copy(pos);
    const q = qFlat(V(0, 1, 0).lerp(upL, s).normalize()); q.multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), 14 * PI * s)); c.g.quaternion.copy(q);
    c.glint.material.opacity = Math.max(0, Math.cos(14 * PI * s)) ** 8 * .5;
    if (!a._fl) { a._fl = 1; sfx('coin'); }
  } else { c.g.position.copy(onL); c.g.quaternion.copy(coinRest(upL)); c.glint.material.opacity = 0; }
  if (!a._sl && t > COIN_LAND) { a._sl = 1; sfx('land'); sfx('clap'); }
  // uncovered: it shines
  const shine = smooth(t, 3.9, T); c.light.intensity = 0; c.top.emissiveIntensity = .15;
  if (!a._hit && t > T - .1) { a._hit = 1; sfx('hit'); }
  // camera: on him, up with the coin, down onto the hands, then right over the coin
  const look = c.g.position.clone(), head = V(0, 2.6, -2.2);
  let cp = n ? V(0, 3.3, 3.6) : V(0, 2.7, 2.4), ct = n ? V(0, 1.6, -1.6) : V(0, 1.7, -1.7);
  const fly = bell(t, .1, .9, 1.5, 2.2); ct.lerp(look.clone().add(V(0, -.6, 0)), fly * .45); cp.y += fly * .5;
  const close = smooth(t, COIN_LAND - .15, COIN_LAND + .5);
  cp.lerp(onL.clone().add(n ? V(.4, 2.6, 3.0) : V(.6, 1.9, 2.4)), close); ct.lerp(onL.clone().add(V(-.05, .25, 0)), close);
  const top = smoother(smooth(t, 3.8, T + .2));
  cp.lerp(onL.clone().add(n ? V(0, 1.9, 1.45) : V(0, 1.35, 1.0)), top); ct.lerp(onL, top);
  if (t < COIN_LAND + .1 && t > COIN_LAND - .02) { cp.x += (Math.random() - .5) * .06; cp.y += (Math.random() - .5) * .06; }   // the slap shakes the shot
  const e = smoother(smooth(t, -2.4, -1.2)) * (1 - smooth(t, T + 2.4, T + 3.4));
  if (e > 0) { drawCamera(a, e, cp, ct); camera.rotateX(.003 * Math.sin(now * 1.7)); camera.rotateY(.0025 * Math.sin(now * 1.3 + 1)); }
  coverEl.classList.toggle('dive', t > -2.4 && t < T + 3.2);
  if (!a.revealed && t >= T) { a.revealed = true; if (typeof a.onReveal === 'function') setTimeout(() => a.onReveal(), 1800); }
  if (t > T + 3.6) endDraw(a);
}

let last = performance.now(), running = false, frames = 0, slow = 0;
const EMBER2 = scene.getObjectByName('ember2');
function frame(t) {
  if (!running) return;
  requestAnimationFrame(frame);
  const dt = Math.min(.05, (t - last) / 1000); last = t;
  render(dt);
  if (++frames < 90 && dt > .045) { slow++; if (slow > 25 && renderer.getPixelRatio() > 1) { renderer.setPixelRatio(1); renderer.setSize(W, H, false); } }
}
function render(dt) { update(dt); renderFrame(); placeSay(dt); }
function update(dt) {
  now += dt;
  const t = now;
  // lamp: comes on with a flicker, then sways a little
  const on = REDUCE ? 1 : (() => { const u = now - lightT0; if (u > 1.4) return 1; const f = [0, .9, .15, .85, .3, 1, .6, 1]; const i = Math.min(f.length - 1, Math.floor(u / .18)); return f[i]; })();
  spot.intensity = 110 * LAMP_K * on; M.bulb.color.setRGB(4 * on + .2, 3.7 * on + .15, 3 * on + .1); coneMat.uniforms.uI.value = .09 * on * (1 - diveE); M.shadeIn.emissiveIntensity = .6 * on; bulbGlow.material.opacity = .55 * on;
  if (!REDUCE) { lampPivot.rotation.z = Math.sin(t * .55) * .016; lampPivot.rotation.x = Math.sin(t * .41 + 1) * .01; }
  const [mYaw, mPitch] = updateMoves(dt);
  // breathing, head follows the card you point at or your pointer
  if (!REDUCE) body.position.y = Math.sin(t * 1.3) * .012;
  const focus = hovered >= 0 ? hovered : focused;
  let yawT = 0, pitchT = 0;
  if (mYaw !== null) { yawT = mYaw; pitchT = mPitch; }
  else if (focus >= 0) { const c = cards[focus]; yawT = clamp(Math.atan2(c.rest.x, c.rest.z + 2.62) * .8, -.45, .45); pitchT = .16; }
  else if (pointer.in && FINE) { yawT = pointer.x * .22; pitchT = pointer.y * .06; }
  headPivot.rotation.y = damp(headPivot.rotation.y, yawT, 4, dt);
  headPivot.rotation.x = damp(headPivot.rotation.x, pitchT, 4, dt);
  placeHeld();
  // cigar ember
  const fl = (.78 + .22 * Math.sin(t * 7.3) * Math.sin(t * 2.9 + 1.3)) * cig;
  M.ember.emissiveIntensity = .05 + 3 * fl; cigarTip.getWorldPosition(emberLight.position); emberLight.intensity = .6 * fl; emberGlow.position.copy(emberLight.position); emberGlow.material.opacity = (.55 + .35 * fl) * cig;
  // smoke
  if (!REDUCE) {
    smokeClock += dt; while (smokeClock > .13) { smokeClock -= .13; if (cig > .6) puff(); }
    smoke.forEach(s => { if (!s.visible) return; const u = s.userData; u.life += dt; if (u.life < 0) return; const k = u.life / u.max; if (k >= 1) { s.visible = false; s.material.opacity = 0; return; }
      s.position.x += (u.vx + Math.sin(u.life * 1.7 + s.id) * .05) * dt; s.position.y += (.32 + k * .1) * dt; s.position.z += u.vz * dt;
      const sc = .1 + k * .95; s.scale.set(sc, sc, 1); s.material.rotation += u.rot * dt; s.material.opacity = Math.min(1, k * 6) * (1 - k) * .3; });
    const a = dustGeo.attributes.position; for (let i = 0; i < DUST; i++) { let y = a.getY(i) + dt * .03 * (1 + (i % 3)); if (y > 3.6) y = .3; a.setY(i, y); a.setX(i, a.getX(i) + Math.sin(t * .3 + i) * .0006); } a.needsUpdate = true;
  }
  if (EMBER2) EMBER2.material.color.setRGB(3 * (.6 + .4 * Math.sin(t * 2.1)), .9 * (.6 + .4 * Math.sin(t * 2.1)), .2);
  // camera drifts with your pointer
  const still = REDUCE || (anim && (anim.kind === 'contract' || anim.kind === 'burn' || anim.kind === 'draw'));
  const tx = still ? par.x : (pointer.in && FINE ? pointer.x * .32 : Math.sin(t * .23) * .12), ty = still ? par.y : (pointer.in && FINE ? -pointer.y * .14 : Math.sin(t * .31) * .05);
  par.x = damp(par.x, tx, 2.5, dt); par.y = damp(par.y, ty, 2.5, dt);
  placeCamera(par.x, par.y);
  if (anim && anim.kind === 'contract') {
    const ct = now - anim.t0; diveE = smoother(seg(ct, T_DIVE, T_DIVE1));
    if (diveE > 0) diveCamera(anim, diveE);
    body.updateMatrixWorld(); contractScene(ct, anim);
  } else if (anim && anim.kind === 'draw') {
    body.updateMatrixWorld(); drawSceneUpdate(dt);
  } else if (anim && anim.kind === 'burn') {
    const bt = now - anim.t0; diveE = 1 - smoother(seg(bt, .2, 1.5));
    if (diveE > 0) diveCamera(anim, diveE); else if (!anim.up) { anim.up = true; camera.up.set(0, 1, 0); if (mode) fit(); placeCamera(par.x, par.y); }
    if (diveE < .5) coverEl.classList.remove('dive');
    body.updateMatrixWorld(); burnScene(bt, anim);
  }
  updateCards(dt);
}
const HP = new THREE.Vector3();
function placeSay(dt) {
  if (!sayEl || stacked) { if (sayEl) sayEl.style.removeProperty('--sx'); return; }
  const want = .95;
  sayOff = dt ? damp(sayOff, want, 7, dt) : want;
  const hp = headPivot.getWorldPosition(HP);
  const [x, y] = proj(hp.x + sayOff, hp.y + .78, hp.z + .2);
  sayEl.style.setProperty('--sx', Math.round(x) + 'px'); sayEl.style.setProperty('--sy', Math.round(y) + 'px');
}

/* ---------- start, pause when the welcome screen is hidden ---------- */
let frozen = false;
let onScreen = true;
function start() {
  if (frozen || running || coverEl.hidden || !onScreen) return;
  if (REDUCE) { kick(); return; }
  running = true; last = performance.now(); requestAnimationFrame(frame);
}
let kicked = false;
function kick() { if (!REDUCE || kicked) return; kicked = true; requestAnimationFrame(() => { kicked = false; render(0); }); }
function stop() { running = false; }
new MutationObserver(() => { if (coverEl.hidden) stop(); else start(); }).observe(coverEl, { attributes: true, attributeFilter: ['hidden'] });
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (anim && anim.kind === 'contract') endContract(anim); } else start(); });
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); stop(); frozen = true; coverEl.classList.remove('r3d'); root.classList.remove('try3d'); if (typeof layoutScene === 'function') layoutScene(); if (typeof dealCards === 'function') dealCards(200); });
if ('IntersectionObserver' in window) new IntersectionObserver(es => { onScreen = es[es.length - 1].isIntersecting; if (onScreen) start(); else stop(); }).observe(canvas);

window.room3d = {
  layout, deal, start, back, drawScene, drawTime: s => DRAW_T.coin, clock: f => { drawClock = f; },
  focus(k) { if (busy) return; focused = k; if (k >= 0) hovered = -1; kick(); },
  pick(k) { if (anim && anim.kind === 'contract') skipContract(anim); else choose(k); }
};

async function boot() {
  try { await Promise.race([Promise.all(['400 80px Limelight', 'italic 500 40px Barlow', '700 40px "Barlow Condensed"'].map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 2500))]); } catch (e) { }
  paintCards(); faceTex.forEach(t => t.needsUpdate = true); backTex.needsUpdate = true;
  coverEl.classList.add('r3d');
  if (typeof layoutScene === 'function') layoutScene(); else layout(false);
  lightT0 = now; deal(REDUCE ? 0 : 2900);
  if (!REDUCE) { cig = 0; anim = { kind: 'light', t0: now + .6, from: snapPose() }; }
  start();
  if (document.fonts) document.fonts.ready.then(() => { paintCards(); faceTex.forEach(t => t.needsUpdate = true); });
}
boot();
