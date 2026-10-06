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
  // pinstripe suit
  [c, x] = makeCanvas(256, 256); x.fillStyle = '#16161b'; x.fillRect(0, 0, 256, 256); noise(x, 256, 256, 5000, '#2a2a33', '#08080a', .3);
  x.fillStyle = 'rgba(150,150,170,.22)'; for (let i = 0; i < 256; i += 32) x.fillRect(i, 0, 1.4, 256);
  T.suit = tex(c, { repeat: [2, 2] });
  // hat band: plain cream
  [c, x] = makeCanvas(512, 64); x.fillStyle = '#e6e0d2'; x.fillRect(0, 0, 512, 64); x.fillStyle = 'rgba(0,0,0,.12)'; x.fillRect(0, 0, 512, 3); x.fillRect(0, 61, 512, 3);
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
  head: new THREE.MeshStandardMaterial({ color: 0xf2c24e, metalness: .55, roughness: .34 }),
  suit: new THREE.MeshStandardMaterial({ color: 0xffffff, map: T.suit, roughness: .78, metalness: 0, envMapIntensity: .4 }),
  satin: new THREE.MeshStandardMaterial({ color: 0x1b1b21, roughness: .38, metalness: .1, envMapIntensity: .6 }),
  shirt: new THREE.MeshStandardMaterial({ color: 0xe7e1d3, roughness: .6, envMapIntensity: .4 }),
  tie: new THREE.MeshStandardMaterial({ color: 0x7c1616, roughness: .32, metalness: .15 }),
  hat: new THREE.MeshStandardMaterial({ color: 0x141417, roughness: .82, envMapIntensity: .5 }),
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
  const wall = mesh(new THREE.PlaneGeometry(26, 12), M.wall, 0, 3, WALL_Z); wall.receiveShadow = true;
  mesh(new THREE.BoxGeometry(26, .12, .14), M.trim, 0, 1.35, WALL_Z + .07).receiveShadow = true;
  mesh(new THREE.BoxGeometry(26, .05, .1), M.trim, 0, 1.48, WALL_Z + .05);
  // window with the city and half-open blinds
  const W = new THREE.Group(); W.position.set(3.5, 3.15, WALL_Z + .02); scene.add(W);
  const ww = 3.1, wh = 2.9;
  const city = mesh(new THREE.PlaneGeometry(ww, wh), new THREE.MeshBasicMaterial({ map: cityTexture(), color: new THREE.Color(.62, .62, .66), fog: false }), 0, 0, .005, W);
  const frameMat = M.trim;
  [[0, wh / 2 + .07, ww + .3, .16], [0, -wh / 2 - .07, ww + .3, .16]].forEach(([x, y, w, h]) => mesh(new THREE.BoxGeometry(w, h, .22), frameMat, x, y, .1, W));
  [[-ww / 2 - .07, 0], [ww / 2 + .07, 0], [0, 0]].forEach(([x, y], k) => mesh(new THREE.BoxGeometry(k === 2 ? .06 : .16, wh, k === 2 ? .1 : .22), frameMat, x, y, .1, W));
  mesh(new THREE.BoxGeometry(ww + .6, .1, .4), frameMat, 0, -wh / 2 - .2, .2, W);
  const slat = new THREE.BoxGeometry(ww, .1, .015), slatMat = new THREE.MeshStandardMaterial({ color: 0x24170c, roughness: .8 });
  { const ys = []; for (let y = wh / 2 - .08; y > -wh / 2; y -= .17) ys.push(y);
    const im = new THREE.InstancedMesh(slat, slatMat, ys.length), m4 = new THREE.Matrix4(), e = new THREE.Euler(1.05, 0, 0);
    ys.forEach((y, k) => { m4.makeRotationFromEuler(e); m4.setPosition(0, y, .09); im.setMatrixAt(k, m4); }); W.add(im); }
  // the two men in the dark by the window
  const shade = M.shadow;
  const hatGeo = lathe([[0, 0], [.42, .0], [.46, .03], [.43, .04], [.25, .05], [.24, .3], [.12, .36], [0, .34]], 24);
  [[2.6, -3.85, .95, true], [4.3, -3.65, .9, false]].forEach(([x, z, s, cig]) => {
    const g = new THREE.Group(); g.position.set(x, -.4, z); g.scale.setScalar(s); scene.add(g);
    mesh(new THREE.CapsuleGeometry(.55, 1.1, 6, 16), shade, 0, 1.1, 0, g).scale.set(1.25, 1, .8);
    mesh(new THREE.SphereGeometry(.3, 16, 12), shade, 0, 2.25, 0, g);
    mesh(hatGeo, shade, 0, 2.4, 0, g);
    if (cig) { const e = mesh(new THREE.SphereGeometry(.035, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a2a).multiplyScalar(3) }), .36, 2.1, .3, g); e.name = 'ember2'; }
  });
  mesh(new THREE.CylinderGeometry(.9, .9, .08, 24), shade, 3.4, .55, -3.6);
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
  mesh(new THREE.ShapeGeometry(sq), M.shirt, 0, 0, F + .04, body);
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
  const cg = new THREE.Group(); cg.position.set(.17, .36, .6); cg.rotation.set(.18, .55, 0); headPivot.add(cg);
  mesh(new THREE.CylinderGeometry(.065, .075, .78, 16), M.cigar, 0, 0, .39, cg).rotation.x = PI / 2;
  mesh(new THREE.CylinderGeometry(.079, .079, .09, 16), M.brass, 0, 0, .14, cg).rotation.x = PI / 2;
  mesh(new THREE.CylinderGeometry(.06, .066, .07, 16), M.ash, 0, 0, .8, cg).rotation.x = PI / 2;
  const em = mesh(new THREE.CircleGeometry(.055, 16), M.ember, 0, 0, .837, cg);
  cigarTip.position.set(0, 0, .86); cg.add(cigarTip);
  // arms in suit sleeves, resting on the rail
  const sleeveGeo = new RoundedBox(1.02, 1.62, 1.02, 3, .08), cuffGeo = new RoundedBox(.97, .1, .97, 2, .03), handGeo = new RoundedBox(.93, .4, .93, 3, .1);
  [-1, 1].forEach(sd => {
    const pv = new THREE.Group(); pv.position.set(sd * 1.5, 1.32, 0); pv.rotation.set(-.905, 0, sd * -.04); body.add(pv);
    mesh(sleeveGeo, M.suit, 0, -.31, 0, pv); mesh(cuffGeo, M.shirt, 0, -1.14, 0, pv); mesh(handGeo, M.gold, 0, -1.3, 0, pv);
    ARMS[sd < 0 ? 'R' : 'L'] = { pv, rest: pv.quaternion.clone() };
  });
}
shadowy(boss);

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
/* ---------- what he holds: a glass of whisky (right hand) and a lighter (left hand) ---------- */
const glassG = tumbler(); body.add(glassG); shadowy(glassG);
const whiskyMesh = glassG.children[1];
let whiskyLevel = 1;
const _hand = new THREE.Vector3(), _rel = new THREE.Quaternion(), _off = new THREE.Vector3(), _qi = new THREE.Quaternion();
const handEnd = (arm, out) => out.set(0, -1.5, 0).applyQuaternion(arm.pv.quaternion).add(arm.pv.position);
const GLASS_OFF = (() => { handEnd(ARMS.R, _hand); return new THREE.Vector3(0, -_hand.y, .3); })();
const glassTilt = new THREE.Quaternion();
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
const DUST = 140;
const dustGeo = new THREE.BufferGeometry();
{ const a = new Float32Array(DUST * 3); for (let i = 0; i < DUST; i++) { const t = Math.random(), ang = Math.random() * PI * 2, rr = Math.sqrt(Math.random()) * 2.6 * (1 - t * .8); a[i * 3] = Math.cos(ang) * rr; a[i * 3 + 1] = .3 + t * 3.2; a[i * 3 + 2] = -.9 + Math.sin(ang) * rr; } dustGeo.setAttribute('position', new THREE.BufferAttribute(a, 3)); }
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: T.dot, color: 0xffe2a8, size: .03, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending }));
scene.add(dust);

/* ---------- the contract: a sheet he slides across, which opens into the page ---------- */
const CON_W = 1.12, CON_H = 1.5;
const conCanvas = makeCanvas(1024, 1372);
const conTex = tex(conCanvas[0], { aniso: 16 });
const conGeo = new THREE.PlaneGeometry(CON_W, CON_H, 1, 12);
{ const p = conGeo.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i) / CON_H; p.setZ(i, Math.sin((y + .5) * PI) * .018 - Math.abs(y) * .01); } conGeo.computeVertexNormals(); }
const contract = new THREE.Mesh(conGeo, new THREE.MeshStandardMaterial({ map: conTex, roughness: .86, envMapIntensity: .15 }));
const conBack = new THREE.Mesh(conGeo, new THREE.MeshStandardMaterial({ color: 0xd8caa6, roughness: .9 })); conBack.rotation.y = PI; contract.add(conBack);
contract.visible = false; contract.castShadow = conBack.castShadow = true; scene.add(contract);
const safe = (n, d = '') => { try { return n(); } catch (e) { return d; } };
function drawContract(d) {
  const [c, x] = conCanvas, w = c.width, h = c.height;
  let gr = x.createRadialGradient(w * .5, h * .45, h * .1, w * .5, h * .5, h * .75);
  gr.addColorStop(0, '#f3ead3'); gr.addColorStop(.7, '#e8dbb8'); gr.addColorStop(1, '#cdb88c');
  x.fillStyle = gr; x.fillRect(0, 0, w, h);
  noise(x, w, h, 9000, '#fffaf0', '#9c8456', .14);
  x.strokeStyle = 'rgba(120,90,40,.18)'; x.lineWidth = 6; x.beginPath(); x.arc(w * .78, h * .3, 70, .3, 5.6); x.stroke();
  gr = x.createLinearGradient(0, h * .5 - 14, 0, h * .5 + 14); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(.5, 'rgba(90,60,20,.22)'); gr.addColorStop(.52, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr; x.fillRect(0, h * .5 - 14, w, 28);
  x.strokeStyle = 'rgba(42,26,12,.75)'; x.lineWidth = 3; x.strokeRect(46, 46, w - 92, h - 92); x.lineWidth = 1.2; x.strokeRect(58, 58, w - 116, h - 116);
  x.fillStyle = '#2a1a0c'; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  x.font = '400 104px Limelight, Georgia, serif'; x.fillText('CONTRATTO', w / 2, 190);
  x.font = '700 30px "Barlow Condensed", Arial, sans-serif'; x.fillStyle = '#6b4a1a';
  const no = String(d.order || 1).padStart(3, '0');
  x.fillText(`LA FAMIGLIA APHRITE  ·  N° ${no}`, w / 2, 240);
  x.fillStyle = '#2a1a0c'; x.fillRect(w / 2 - 260, 268, 520, 3);
  x.font = '400 78px Limelight, Georgia, serif'; x.fillText(d.en, w / 2, 372);
  x.font = 'italic 500 38px Barlow, Arial, sans-serif'; x.fillStyle = '#6b4a1a'; x.fillText(d.it, w / 2, 424);
  const lines = contractLines(d.go);
  x.textAlign = 'left'; x.fillStyle = '#2a1a0c';
  let y = 520;
  lines.forEach(([a, b]) => {
    x.font = '600 40px "Barlow Condensed", Arial, sans-serif'; x.fillText(a, 130, y);
    if (b) { x.textAlign = 'right'; x.fillText(b, w - 130, y); x.textAlign = 'left'; }
    x.strokeStyle = 'rgba(42,26,12,.25)'; x.lineWidth = 1.5; x.setLineDash([3, 7]); x.beginPath(); x.moveTo(130, y + 16); x.lineTo(w - 130, y + 16); x.stroke(); x.setLineDash([]);
    y += 72;
  });
  // signature, wax seal and the stamp
  x.strokeStyle = '#2a1a0c'; x.lineWidth = 2; x.beginPath(); x.moveTo(130, h - 200); x.lineTo(560, h - 200); x.stroke();
  x.font = '600 28px "Barlow Condensed", Arial, sans-serif'; x.fillStyle = '#6b4a1a'; x.fillText('FIRMA  ·  IL CAPO', 130, h - 164);
  x.strokeStyle = '#1d1208'; x.lineWidth = 4; x.lineCap = 'round'; x.beginPath(); x.moveTo(150, h - 214);
  x.bezierCurveTo(200, h - 300, 250, h - 160, 300, h - 236); x.bezierCurveTo(330, h - 280, 360, h - 190, 410, h - 230); x.bezierCurveTo(440, h - 250, 480, h - 215, 540, h - 240); x.stroke();
  x.save(); x.translate(w - 230, h - 230);
  gr = x.createRadialGradient(-20, -20, 10, 0, 0, 92); gr.addColorStop(0, '#c4302a'); gr.addColorStop(1, '#6e0f0c');
  x.fillStyle = gr; x.beginPath(); for (let i = 0; i < 28; i++) { const a = i / 28 * PI * 2, r = 86 + (i % 2 ? 6 : -4) + Math.sin(i * 1.7) * 4; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.closePath(); x.fill();
  x.strokeStyle = 'rgba(40,0,0,.5)'; x.lineWidth = 4; x.beginPath(); x.arc(0, 0, 58, 0, PI * 2); x.stroke();
  x.fillStyle = '#f1c9b4'; x.globalAlpha = .9; x.font = '400 76px Limelight, Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('A', 0, 6); x.globalAlpha = 1;
  x.restore();
  x.save(); x.translate(w / 2 + 10, h - 236); x.rotate(-.16); x.globalAlpha = .5; x.strokeStyle = '#9c1f18'; x.lineWidth = 6; x.strokeRect(-150, -42, 300, 84);
  x.fillStyle = '#9c1f18'; x.font = '700 52px "Barlow Condensed", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('APPROVATO', 0, 4); x.restore();
  x.textBaseline = 'alphabetic'; x.textAlign = 'left'; x.lineCap = 'butt';
}
function contractLines(go) {
  const L = safe(() => LIST, []), Ms = safe(() => MATCHES, []), Ts = safe(() => tourResults(), []), F = n => safe(() => fmt(n), String(n));
  if (go === 'rank') return L.slice(0, 6).map((p, i) => [`${i + 1}.  ${p.name}`, `${F(p.elo)} ELO`]);
  if (go === 'matches') return Ms.slice(-6).reverse().map(m => [`${m.win}  def.  ${m.lose}`, m.score || '']);
  if (go === 'champs') { const t = Ts.filter(t => t.win).slice(0, 6); return t.length ? t.map(t => [t.name, `♛ ${t.win}`]) : [['No champion yet.', '']]; }
  if (go === 'duel') { const a = L[0], b = L[1]; return [['Two names. One table.', ''], a && b ? [`${a.name}  vs  ${b.name}`, `${F(a.elo)} – ${F(b.elo)}`] : ['', ''], ['Head to head, odds, form,', ''], ['and who walks away.', '']]; }
  return [['Everyone starts at 1000 ELO.', ''], ['Beat someone above you, climb more.', ''], ['Lose, and you drop.', ''], ['Boss, Underboss, Capo, Soldier.', ''], ['The table keeps quiet.', '']];
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
let busy = false, anim = null, cig = 1, nextDrink = 1e9, sayOff = .95;
canvas.addEventListener('click', ev => { if (busy || !dealt) return; const k = pick(ev); if (k >= 0) choose(k); });
function choose(k) {
  if (busy || !cards[k]) return;
  const go = cards[k].d.go, plain = () => { busy = true; enter(go); setTimeout(resetRoom, 900); };
  if (REDUCE || !dealt || typeof openPage !== 'function') return plain();
  try { drawContract(cards[k].d); conTex.needsUpdate = true; } catch (e) { return plain(); }
  busy = true; hovered = k; cards[k].picked = true;
  if (typeof say === 'function') say('Ecco.', 'Your contract.');
  const c = anim = { kind: 'contract', t0: now, card: k, go, shown: false };
  // if the room stops drawing (tab in the background, scrolled away, a very slow device) the page still opens
  setTimeout(() => { if (anim === c && !c.shown) endContract(c); }, 5000 * (window.__conSlow || 1));
}
// the one way out of a contract: the page is open, the sheet is gone, the room is back at rest
function endContract(c) {
  if (!c || c.done) return; c.done = c.shown = true;
  if (c.ov) { c.ov.remove(); c.ov = null; }
  if (!c.open) { c.open = true; try { openPage(c.go); } catch (e) { } }
  if (anim === c) resetRoom();
}
function resetRoom() {
  busy = false; anim = null; sayOff = .95; contract.visible = false; contract.scale.setScalar(1); lighter.visible = false;
  cards.forEach(c => { c.picked = false; c.pick = 0; c.hover = 0; }); hovered = -1; canvas.style.cursor = '';
  Object.values(ARMS).forEach(a => a.pv.quaternion.copy(a.rest));
}

/* ---------- deal ---------- */
let now = 0, dealT0 = 1e9, dealWait = .6, lightT0 = 0;
function deal(waitMs = 650) {
  if (anim && anim.kind !== 'light') resetRoom();
  busy = false; dealt = false; dealT0 = now; dealWait = REDUCE ? 0 : waitMs / 1000;
  cards.forEach(c => { c.hover = 0; c.picked = false; c.pick = 0; });
  if (whiskyLevel < .4) whiskyLevel = 1;
  if (REDUCE) { dealt = true; if (typeof say === 'function') say(...SAY0, true); }
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
    if (c.picked && (!anim || anim.kind !== 'contract')) {
      c.pick = Math.min(1, c.pick + dt / .38);
      const pk = easeInOut(c.pick);
      camera.getWorldDirection(camFwd);
      tmp2.copy(camera.position).addScaledVector(camFwd, 2.6);
      p.lerp(tmp2, pk);
      qc.copy(camera.quaternion);
      q.slerp(qc, pk);
    }
    c.g.position.copy(p); c.g.quaternion.copy(q); c.g.scale.setScalar(s);
    const dim = (hovered >= 0 || focused >= 0) && k !== hovered && k !== focused && !c.picked ? .7 : 1;
    const mat = M.card[k]; const cur = mat.color.r; const nv = REDUCE ? dim : damp(cur, dim, 10, dt); mat.color.setScalar(nv);
    mat.emissive.setRGB(.06 * h, .045 * h, .02 * h); mat.emissiveIntensity = 1;
  });
}
/* ---------- his moves: light the cigar, take a drink, slide the contract ---------- */
const AZ = new THREE.Vector3(0, 0, 1), DOWN = new THREE.Vector3(0, -1, 0), _aim = new THREE.Vector3(), _qa = new THREE.Quaternion(), _bt = new THREE.Vector3();
const _w2b = new THREE.Matrix4(), _cp = new THREE.Vector3(), _cq = new THREE.Quaternion(), _cq2 = new THREE.Quaternion(), _e = new THREE.Euler();
function aimArm(arm, target, k) {
  _aim.copy(target).sub(arm.pv.position).normalize();
  _qa.setFromUnitVectors(DOWN, _aim);
  arm.pv.quaternion.slerpQuaternions(arm.rest, _qa, clamp(k, 0, 1));
}
const toBody = v => { body.updateMatrixWorld(); _w2b.copy(body.matrixWorld).invert(); return v.applyMatrix4(_w2b); };
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const tipBody = new THREE.Vector3();
const MOUTH = new THREE.Vector3(-.12, 2.24, .86);
function updateMoves(dt) {
  ARMS.R.pv.quaternion.copy(ARMS.R.rest); ARMS.L.pv.quaternion.copy(ARMS.L.rest);
  glassTilt.identity(); lighter.visible = false; flameLight.intensity = 0;
  let headYaw = null, headPitch = null;
  if (!anim && dealt && !busy && hovered < 0 && focused < 0 && now > nextDrink && !REDUCE) anim = { kind: 'drink', t0: now };
  if (anim) {
    const t = now - anim.t0;
    if (anim.kind === 'light') {
      if (t < 0) { cig = 0; }
      else {
        cigarTip.getWorldPosition(tipBody); toBody(tipBody); tipBody.y -= .42; tipBody.x += .02; tipBody.z += .08;
        const k = easeInOut(seg(t, 0, .75)) * (1 - easeInOut(seg(t, 1.85, 2.5)));
        aimArm(ARMS.L, tipBody, k);
        lighter.visible = t > .25 && t < 2.35;
        const fire = t > .78 && t < 1.8 ? 1 : 0;
        flame.visible = !!fire; flameLight.intensity = fire * (4 + Math.sin(now * 31) * .6 + Math.sin(now * 17) * .5);
        flameCore.scale.set(1, 1 + Math.sin(now * 23) * .12, 1);
        cig = easeInOut(seg(t, .95, 1.6));
        headPitch = .1 * k; headYaw = .12 * k;
        if (t > 2.6) anim = null;
      }
    } else if (anim.kind === 'drink') {
      const up = easeInOut(seg(t, 0, .9)) * (1 - easeInOut(seg(t, 2.05, 2.9)));
      aimArm(ARMS.R, MOUTH, up);
      const sip = easeInOut(seg(t, .85, 1.35)) * (1 - easeInOut(seg(t, 1.75, 2.15)));
      glassTilt.setFromAxisAngle(AX, -.95 * sip);
      if (t > 1.3 && t < 1.8) whiskyLevel = Math.max(.25, whiskyLevel - dt * .22);
      headPitch = -.2 * sip; headYaw = -.08 * up;
      if (t > 3.1) { anim = null; nextDrink = now + 18 + Math.random() * 9; }
    } else if (anim.kind === 'contract') {
      const up = easeInOut(seg(t, 0, .55)) * (1 - easeInOut(seg(t, 1.05, 1.6)));
      _bt.set(.78, 2.1, 1.6); aimArm(ARMS.L, _bt, up);
      headPitch = .05; headYaw = -.08;
      contract.visible = t > .1;
      handEnd(ARMS.L, _cp); body.localToWorld(_cp);
      _cp.y += CON_H * .44; _cp.z += .14; _cp.x -= .12;
      _cq.copy(camera.quaternion).multiply(_cq2.setFromAxisAngle(AZ, -.1));
      const show = easeOut(seg(t, .1, .5)); contract.scale.setScalar(.3 + .7 * show);
      const fly = easeInOut(seg(t, .9, 1.45));
      if (fly > 0) { if (!anim.pose) anim.pose = presentPose(); _cp.lerp(anim.pose.p, fly); _cq.slerp(anim.pose.q, fly); }
      contract.position.copy(_cp); contract.quaternion.copy(_cq);
      if (t > 1.47 && !anim.shown) { anim.shown = true; contract.scale.setScalar(1); presentContract(anim); }
    }
  }
  // glass follows the right hand
  handEnd(ARMS.R, _hand); _rel.copy(ARMS.R.pv.quaternion).multiply(_qi.copy(ARMS.R.rest).invert());
  _off.copy(GLASS_OFF).applyQuaternion(_rel);
  glassG.position.copy(_hand).add(_off); glassG.quaternion.copy(glassTilt);
  whiskyMesh.scale.y = whiskyLevel; whiskyMesh.position.y = .07 + .08 * whiskyLevel;
  // lighter stands upright in the left hand
  if (lighter.visible) { lighter.position.set(0, -1.62, .04); lighter.quaternion.copy(ARMS.L.pv.quaternion).invert(); }
  return [headYaw, headPitch];
}
function presentPose() {
  camera.updateMatrixWorld();
  const c = new THREE.Vector3(0, 0, .5).unproject(camera), dir = c.sub(camera.position).normalize();
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  const th = Math.tan(camera.fov * PI / 360);
  const d = Math.max(CON_H / (.78 * 2 * th), CON_W / (.86 * 2 * th * (W / H)));
  return { p: camera.position.clone().addScaledVector(dir, d / dir.dot(fwd)), q: camera.quaternion.clone() };
}
function presentContract(c) {
  const E = 'cubic-bezier(.55,0,.35,1)', SL = window.__conSlow || 1;
  let bg, top, bot;
  try {
    contract.updateMatrixWorld();
    const r = canvas.getBoundingClientRect(), pts = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([a, b]) => { const v = new THREE.Vector3(a * CON_W / 2, b * CON_H / 2, 0).applyMatrix4(contract.matrixWorld); const [x, y] = proj(v.x, v.y, v.z); return [r.left + x, r.top + y]; });
    const L = Math.min(...pts.map(p => p[0])), R = Math.max(...pts.map(p => p[0])), T = Math.min(...pts.map(p => p[1])), B = Math.max(...pts.map(p => p[1]));
    const ov = c.ov = document.createElement('div'); ov.className = 'contract-ov'; ov.setAttribute('aria-hidden', 'true');
    ov.innerHTML = '<div class="c-bg"></div><div class="c-paper"><canvas class="c-top"></canvas><canvas class="c-bot"></canvas></div>';
    const paper = ov.querySelector('.c-paper'); Object.assign(paper.style, { left: L + 'px', top: T + 'px', width: (R - L) + 'px', height: (B - T) + 'px' });
    const [src] = conCanvas, hw = src.width, hh = src.height / 2;
    ov.querySelectorAll('canvas').forEach((cv, i) => { cv.width = hw; cv.height = hh; cv.getContext('2d').drawImage(src, 0, i * hh, hw, hh, 0, 0, hw, hh); });
    document.body.appendChild(ov);
    [bg, top, bot] = ['.c-bg', '.c-top', '.c-bot'].map(q => ov.querySelector(q));
    bg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240 * SL, fill: 'forwards' });
  } catch (e) { endContract(c); return; }
  setTimeout(() => {
    if (c.done) return;
    c.open = true; try { openPage(c.go); } catch (e) { }
    try {
      top.animate([{ transform: 'rotateX(0deg)', opacity: 1 }, { opacity: 1, offset: .55 }, { transform: 'rotateX(-104deg)', opacity: 0 }], { duration: 760 * SL, easing: E, fill: 'forwards' });
      bot.animate([{ transform: 'rotateX(0deg)', opacity: 1 }, { opacity: 1, offset: .55 }, { transform: 'rotateX(104deg)', opacity: 0 }], { duration: 760 * SL, easing: E, fill: 'forwards' });
      bg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 640 * SL, delay: 160 * SL, easing: 'ease-out', fill: 'forwards' }).finished.then(() => endContract(c), () => endContract(c));
    } catch (e) { endContract(c); }
    // the sheet never stays over the page, even when the browser holds the animation back
    setTimeout(() => endContract(c), 1000 * SL);
  }, 560 * SL);
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
function render(dt) { update(dt); renderer.render(scene, camera); placeSay(dt); }
function update(dt) {
  now += dt;
  const t = now;
  // lamp: comes on with a flicker, then sways a little
  const on = REDUCE ? 1 : (() => { const u = now - lightT0; if (u > 1.4) return 1; const f = [0, .9, .15, .85, .3, 1, .6, 1]; const i = Math.min(f.length - 1, Math.floor(u / .18)); return f[i]; })();
  spot.intensity = 110 * LAMP_K * on; M.bulb.color.setRGB(4 * on + .2, 3.7 * on + .15, 3 * on + .1); coneMat.uniforms.uI.value = .09 * on; M.shadeIn.emissiveIntensity = .6 * on; bulbGlow.material.opacity = .55 * on;
  if (!REDUCE) { lampPivot.rotation.z = Math.sin(t * .55) * .016; lampPivot.rotation.x = Math.sin(t * .41 + 1) * .01; }
  // cigar ember
  const [mYaw, mPitch] = updateMoves(dt);
  const fl = (.78 + .22 * Math.sin(t * 7.3) * Math.sin(t * 2.9 + 1.3)) * cig;
  M.ember.emissiveIntensity = .05 + 3 * fl; cigarTip.getWorldPosition(emberLight.position); emberLight.intensity = .6 * fl; emberGlow.position.copy(emberLight.position); emberGlow.material.opacity = (.55 + .35 * fl) * cig;
  // breathing, head follows the card you point at or your pointer
  if (!REDUCE) body.position.y = Math.sin(t * 1.3) * .012;
  const focus = hovered >= 0 ? hovered : focused;
  let yawT = 0, pitchT = 0;
  if (mYaw !== null) { yawT = mYaw; pitchT = mPitch; }
  else if (focus >= 0) { const c = cards[focus]; yawT = clamp(Math.atan2(c.rest.x, c.rest.z + 2.62) * .8, -.45, .45); pitchT = .16; }
  else if (pointer.in && FINE) { yawT = pointer.x * .22; pitchT = pointer.y * .06; }
  headPivot.rotation.y = damp(headPivot.rotation.y, yawT, 4, dt);
  headPivot.rotation.x = damp(headPivot.rotation.x, pitchT, 4, dt);
  // smoke
  if (!REDUCE) {
    smokeClock += dt; while (smokeClock > .13) { smokeClock -= .13; if (cig > .6) puff(); }
    smoke.forEach(s => { if (!s.visible) return; const u = s.userData; u.life += dt; const k = u.life / u.max; if (k >= 1) { s.visible = false; s.material.opacity = 0; return; }
      s.position.x += (u.vx + Math.sin(u.life * 1.7 + s.id) * .05) * dt; s.position.y += (.32 + k * .1) * dt; s.position.z += u.vz * dt;
      const sc = .1 + k * .95; s.scale.set(sc, sc, 1); s.material.rotation += u.rot * dt; s.material.opacity = Math.min(1, k * 6) * (1 - k) * .3; });
    const a = dustGeo.attributes.position; for (let i = 0; i < DUST; i++) { let y = a.getY(i) + dt * .03 * (1 + (i % 3)); if (y > 3.6) y = .3; a.setY(i, y); a.setX(i, a.getX(i) + Math.sin(t * .3 + i) * .0006); } a.needsUpdate = true;
  }
  if (EMBER2) EMBER2.material.color.setRGB(3 * (.6 + .4 * Math.sin(t * 2.1)), .9 * (.6 + .4 * Math.sin(t * 2.1)), .2);
  // camera drifts with your pointer
  const still = REDUCE || (anim && anim.kind === 'contract');
  const tx = still ? par.x : (pointer.in && FINE ? pointer.x * .32 : Math.sin(t * .23) * .12), ty = still ? par.y : (pointer.in && FINE ? -pointer.y * .14 : Math.sin(t * .31) * .05);
  par.x = damp(par.x, tx, 2.5, dt); par.y = damp(par.y, ty, 2.5, dt);
  placeCamera(par.x, par.y);
  updateCards(dt);
}
const HP = new THREE.Vector3();
function placeSay(dt) {
  if (!sayEl || stacked) { if (sayEl) sayEl.style.removeProperty('--sx'); return; }
  const want = anim && anim.kind === 'contract' ? 1.8 : .95;
  sayOff = dt ? damp(sayOff, want, 7, dt) : want;
  const hp = headPivot.getWorldPosition(HP);
  const [x, y] = proj(hp.x + sayOff, hp.y + .78, hp.z + .2);
  sayEl.style.setProperty('--sx', Math.round(x) + 'px'); sayEl.style.setProperty('--sy', Math.round(y) + 'px');
}

/* ---------- start, pause when the welcome screen is hidden ---------- */
let frozen = false;
let onScreen = true;
function start() {
  if (frozen || running || coverEl.hidden || document.hidden || !onScreen) return;
  if (REDUCE) { kick(); return; }
  running = true; last = performance.now(); requestAnimationFrame(frame);
}
let kicked = false;
function kick() { if (!REDUCE || kicked) return; kicked = true; requestAnimationFrame(() => { kicked = false; render(0); }); }
function stop() { running = false; }
new MutationObserver(() => { if (coverEl.hidden) stop(); else start(); }).observe(coverEl, { attributes: true, attributeFilter: ['hidden'] });
document.addEventListener('visibilitychange', () => { if (document.hidden) { stop(); if (anim && anim.kind === 'contract') endContract(anim); } else start(); });
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); stop(); frozen = true; coverEl.classList.remove('r3d'); root.classList.remove('try3d'); if (typeof layoutScene === 'function') layoutScene(); if (typeof dealCards === 'function') dealCards(200); });
if ('IntersectionObserver' in window) new IntersectionObserver(es => { onScreen = es[es.length - 1].isIntersecting; if (onScreen) start(); else stop(); }).observe(canvas);

window.room3d = {
  layout, deal, start,
  focus(k) { if (busy) return; focused = k; if (k >= 0) hovered = -1; kick(); },
  pick(k) { choose(k); }
};
async function boot() {
  try { await Promise.race([Promise.all(['400 80px Limelight', 'italic 500 40px Barlow', '700 40px "Barlow Condensed"'].map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 2500))]); } catch (e) { }
  paintCards(); faceTex.forEach(t => t.needsUpdate = true); backTex.needsUpdate = true;
  coverEl.classList.add('r3d');
  if (typeof layoutScene === 'function') layoutScene(); else layout(false);
  lightT0 = now; deal(REDUCE ? 0 : 2900);
  if (!REDUCE) { cig = 0; anim = { kind: 'light', t0: now + .6 }; }
  start();
  if (document.fonts) document.fonts.ready.then(() => { paintCards(); faceTex.forEach(t => t.needsUpdate = true); });
}
boot();
