// WebSniper 클라이언트 (1인칭): three.js 렌더링 · 입력 · HUD
import * as THREE from '/vendor/three.module.js';

const P = DEFS.PLAYER;
const hud = document.getElementById('game');
const ctx = hud.getContext('2d');
const glCanvas = document.getElementById('gl');
let W = 0, H = 0, DPR = 1;

const INTERP = 0.1;
const ITEM_COLORS = { rifle: 0xffb347, scope: 0x5ad1ff, vest: 0x7bde7b, helmet: 0xc8a2ff, consumable: 0xff6b8a };
const ITEM_ICONS = { rifle: '🔫', scope: '🔭', vest: '🦺', helmet: '🪖' };

const S = {
  ws: null, id: null, map: null, snaps: [], me: null, joined: false, timeOffset: null,
  yaw: 0, pitch: 0, pos: { x: 0, y: 0, z: 0 }, eyeH: P.eye, zoomHeld: false, fireHeld: false, keys: {}, sens: 1,
  invOpen: false, locked: false, hitMarker: 0, hitHead: false, swayT: 0, sway: { y: 0, p: 0 }, recoil: 0,
  killedBy: '', invKey: '', bots: 6, noise: null, scoreOpen: false, flashUntil: 0, thermal: false, initPos: false, wasDead: false,
  fx: [], tracers: [], playerObjs: new Map(), shots: [], resScale: 1, fpsAcc: 0, fpsN: 0, fpsTimer: 0, workMs: 0, gpu: '', software: false, capped: false,
};

// ---------- 유틸 ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => performance.now() / 1000;
function lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }
function toast(text) { const el = document.createElement('div'); el.textContent = text; document.getElementById('toast').appendChild(el); setTimeout(() => el.remove(), 2600); }
function killfeed(html, cls) { const el = document.createElement('div'); el.innerHTML = html; el.className = cls || ''; const box = document.getElementById('killfeed'); box.prepend(el); while (box.children.length > 6) box.lastChild.remove(); setTimeout(() => el.remove(), 7000); }
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- 오디오 ----------
let ac = null;
function audio() { try { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; } catch { return null; } }
function sfxShot(dist, heavy) {
  const a = audio(); if (!a) return;
  const dur = heavy ? 0.5 : 0.3;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, heavy ? 2.2 : 3.5);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = clamp(4500 - dist * 14, 250, 4500);
  const g = a.createGain(); g.gain.value = clamp(1 - dist / 320, 0.03, 1) * (heavy ? 0.7 : 0.5);
  src.connect(f); f.connect(g); g.connect(a.destination); src.start();
}
function sfxTone(freq, dur, vol, type) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq;
  const g = a.createGain(); g.gain.setValueAtTime(vol, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + dur);
}

// ---------- three.js 씬 ----------
let renderer = null;
let HQ = false; // 고화질: 픽셀 비율 최대 2배 + 안티앨리어싱
function initRenderer(hq) {
  HQ = hq;
  renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: hq, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  resize();
  // 진단용 GPU 이름 (SwiftShader면 하드웨어 가속이 꺼진 상태)
  try {
    const gl = renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info');
    S.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch { S.gpu = '?'; }
  S.software = /swiftshader|software|llvmpipe|basic render/i.test(S.gpu || '');
  if (S.software) toast('경고: 브라우저 하드웨어 가속이 꺼져 있어 CPU로 렌더링 중입니다 (chrome://settings → 시스템 → 하드웨어 가속 사용)');
}
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(DEFS.FOV, 1, 0.1, 1600);
camera.rotation.order = 'YXZ';
scene.add(camera);
const PAL = {
  normal: { sky: ['#1c2350', '#4a3a6a', '#9a5a68', '#dd8f5f', '#f4b676'], fog: 0xd39a70, fogNear: 140, fogFar: 950, world: 0x6a6f80, ground: 0x4c4e58, grid: 0x52545e, decor: 0x3f7a3a, player: 0x1c1c22, playerEmissive: 0x0c0c10, gear: 0x4a4a56, edge: 0x14141a },
  thermal: { sky: ['#02050b', '#04101e', '#071628', '#0a1a2c', '#0c1e34'], fog: 0x0a1a2c, fogNear: 60, fogFar: 700, world: 0x0d1a2e, ground: 0x061021, grid: 0x0e1d33, decor: 0x081222, player: 0xfff4d6, gear: 0xffe0a0, edge: 0x14283f },
};
const MATS = { normal: {}, thermal: {} };
for (const m of ['normal', 'thermal']) {
  const c = PAL[m];
  const std = (p) => m === 'thermal' ? new THREE.MeshLambertMaterial(p) : new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0 }, p));
  MATS[m].world = std({ color: c.world });
  MATS[m].ground = std({ color: c.ground });
  MATS[m].decor = std({ color: c.decor });
  // 캐릭터는 검은 건물과 구분되도록 회색 + 약한 자체 발광(안개 속에서도 형체 유지)
  MATS[m].player = m === 'thermal' ? new THREE.MeshBasicMaterial({ color: c.player }) : new THREE.MeshStandardMaterial({ color: c.player, emissive: c.playerEmissive, roughness: 0.8, metalness: 0 });
  MATS[m].gear = m === 'thermal' ? new THREE.MeshBasicMaterial({ color: c.gear }) : new THREE.MeshStandardMaterial({ color: c.gear, roughness: 0.6, metalness: 0.2 });
  MATS[m].edge = new THREE.LineBasicMaterial({ color: c.edge });
  MATS[m].lamp = new THREE.MeshBasicMaterial({ color: m === 'thermal' ? 0x1e2f4a : 0xffe2a8 });
  for (const [t, col] of Object.entries(ITEM_COLORS)) MATS[m]['item:' + t] = new THREE.MeshBasicMaterial({ color: m === 'thermal' ? 0x1e2f4a : col });
}
// 색상별 재질 캐시: 일반 모드는 지정 색, 열감지 모드는 어두운 파랑(world/decor)으로 통일
function colorMat(hex, opts = {}) {
  const key = (opts.kind || 'w') + ':' + hex.toString(16) + (opts.windows ? ':win' : '') + (opts.metal ? ':m' : '');
  if (!MATS.normal[key]) {
    const params = { color: hex, roughness: opts.metal ? 0.45 : 0.9, metalness: opts.metal ? 0.7 : 0 };
    if (opts.windows) { params.map = TEX.facade; params.emissiveMap = TEX.lit; params.emissive = 0xffc98a; params.emissiveIntensity = 1.2; }
    MATS.normal[key] = new THREE.MeshStandardMaterial(params);
    MATS.thermal[key] = opts.kind === 'd' ? MATS.thermal.decor : MATS.thermal.world;
  }
  return { mat: MATS.normal[key], key };
}
// 건물 외벽 텍스처: 밝은 바탕(재질 색으로 틴트) + 어두운 창문, 발광 맵은 일부 창만 불 켜짐
function facadeTextures() {
  const N = 4, size = 128, cell = size / N;
  const c1 = document.createElement('canvas'); c1.width = c1.height = size; const g1 = c1.getContext('2d');
  const c2 = document.createElement('canvas'); c2.width = c2.height = size; const g2 = c2.getContext('2d');
  g1.fillStyle = '#ffffff'; g1.fillRect(0, 0, size, size);
  g2.fillStyle = '#000000'; g2.fillRect(0, 0, size, size);
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const wx = x * cell + cell * 0.28, wy = y * cell + cell * 0.22, ww = cell * 0.44, wh = cell * 0.5;
    const lit = rnd() < 0.22;
    g1.fillStyle = lit ? '#ffe9c0' : '#3a3f4a'; g1.fillRect(wx, wy, ww, wh);
    if (lit) { g2.fillStyle = '#ffffff'; g2.fillRect(wx, wy, ww, wh); }
  }
  const mk = (c) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t; };
  return { facade: mk(c1), lit: mk(c2) };
}
// 박스 면별 UV를 실제 크기(m)에 맞춰 반복시켜 창문이 일정 간격으로 나오게 함. 윗면/아랫면은 창문 없음
function tileBoxUV(geo, w, h, d, cellW = 3.2, cellH = 3.0) {
  const uv = geo.attributes.uv; const faces = [[d, h], [d, h], null, null, [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v; const s = faces[f];
    if (!s) { uv.setXY(i, 0.02, 0.02); continue; }
    uv.setXY(i, uv.getX(i) * s[0] / cellW, uv.getY(i) * s[1] / cellH);
  }
  uv.needsUpdate = true;
}
const BUILDING_COLORS = [0x6b7a99, 0x8a6a62, 0x7d8a76, 0x9a8b74, 0x687b88, 0x8a7690, 0x7f8794, 0xa08c78];
const CAR_COLORS = [0xb84a4a, 0x4a6ab8, 0xd8d8dc, 0x3a3a42, 0xc9a23a, 0x5a8a5a];
const KIND_COLORS = { step: 0x777a84, parapet: 0x8a8d96, vent: 0x9a9da6, wall: 0x9c9c9c, crate: 0xa5763f, sandbag: 0xa39560, barrel: 0xc0602c, skyline: 0x46507a };
function solidColor(s, i) {
  if (s.kind === 'building') return BUILDING_COLORS[i % BUILDING_COLORS.length];
  if (s.kind === 'car') return CAR_COLORS[i % CAR_COLORS.length];
  return KIND_COLORS[s.kind] || 0x808088;
}
function gradientTexture(stops) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 512; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512);
  // 위(하늘 꼭대기) -> 아래(지평선)
  stops.forEach((s, i) => gr.addColorStop(i / (stops.length - 1), s));
  g.fillStyle = gr; g.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const SKY_TEX = { normal: gradientTexture([...PAL.normal.sky, '#0b0b0e', '#0b0b0e']), thermal: gradientTexture([...PAL.thermal.sky, '#04080f', '#04080f']) };
const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 20, 14), new THREE.MeshBasicMaterial({ map: SKY_TEX.normal, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
sky.renderOrder = -10; scene.add(sky);
scene.fog = new THREE.Fog(PAL.normal.fog, PAL.normal.fogNear, PAL.normal.fogFar);
function radialSprite(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const TEX = { glow: radialSprite('rgba(255,255,255,1)', 'rgba(255,255,255,0)') };
Object.assign(TEX, facadeTextures());
const sunDir = new THREE.Vector3(0.55, 0.3, -0.8).normalize();
const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0xffd9a8, transparent: true, opacity: 0.9, fog: false, depthWrite: false, toneMapped: false }));
sun.position.copy(sunDir).multiplyScalar(1300); sun.scale.set(260, 260, 1); scene.add(sun);
// 조명: 하늘/땅 반구광 + 그림자를 드리우는 태양광 + 푸른 보조광
scene.add(new THREE.HemisphereLight(0xb9c3ff, 0x5a4636, 1.1));
const dirLight = new THREE.DirectionalLight(0xffd2a0, 2.2);
dirLight.position.copy(sunDir).multiplyScalar(500); dirLight.castShadow = true;
dirLight.shadow.mapSize.set(4096, 4096);
Object.assign(dirLight.shadow.camera, { left: -330, right: 330, top: 330, bottom: -330, near: 1, far: 1400 });
dirLight.shadow.bias = -0.0004; dirLight.shadow.normalBias = 0.8;
scene.add(dirLight); scene.add(dirLight.target);
const fillLight = new THREE.DirectionalLight(0x8090c0, 0.5); fillLight.position.set(-0.5, 0.4, 0.7); scene.add(fillLight);
// 바닥 아스팔트 노이즈 텍스처
(function () {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const im = g.createImageData(256, 256);
  for (let i = 0; i < im.data.length; i += 4) { const v = 215 + Math.random() * 40; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(300, 300); t.colorSpace = THREE.SRGBColorSpace;
  TEX.asphalt = t; MATS.normal.ground.map = t; MATS.normal.ground.needsUpdate = true;
})();

const world = new THREE.Group(); scene.add(world);
// ---------- 미니맵 (전체 맵을 오프스크린 캔버스에 한 번 그려두고 매 프레임 내 주변만 회전해서 표시) ----------
const MM = { scale: 2, canvas: null, size: 0, R: 78, viewM: 110 }; // scale: 오프스크린 px/m, R: 화면 반지름 px, viewM: 표시 반경(m)
function buildMinimap(map) {
  const s = MM.scale, half = map.HALF; MM.size = map.SIZE * s; MM.half = half;
  const c = document.createElement('canvas'); c.width = c.height = MM.size; const g = c.getContext('2d');
  g.fillStyle = '#3a3d48'; g.fillRect(0, 0, MM.size, MM.size);
  const rect = (b, col) => { g.fillStyle = col; g.fillRect((b.x + half) * s, (b.z + half) * s, b.w * s, b.d * s); };
  for (const b of map.solids) {
    if (b.kind === 'ground' || b.kind === 'skyline') continue;
    if (b.kind === 'building') rect(b, '#8e93a6');
    else if (b.kind === 'wall' && b.w > 100) rect(b, '#c0c4d0');
    else if (b.kind === 'step' || b.kind === 'parapet' || b.kind === 'vent') rect(b, '#7a7e90');
    else rect(b, '#b39a6a');
  }
  for (const d of map.decor) {
    if (d.kind === 'pole') continue;
    g.fillStyle = d.kind === 'tree' ? '#4f8a45' : '#5f9a4f'; g.beginPath(); g.arc((d.x + half) * s, (d.z + half) * s, (d.r || 1) * s, 0, Math.PI * 2); g.fill();
  }
  // 사다리와 계단은 노란색으로 표시해 올라갈 곳을 찾기 쉽게
  g.fillStyle = '#ffd86a';
  for (const l of (map.ladders || [])) g.fillRect((l.x + half) * s - 1, (l.z + half) * s - 1, l.w * s + 2, l.d * s + 2);
  for (const b of map.solids) if (b.kind === 'step' && b.h < 0.6) g.fillRect((b.x + half) * s, (b.z + half) * s, b.w * s, b.d * s);
  MM.canvas = c;
}
function drawMinimap(players, items) {
  if (!MM.canvas) return;
  const R = MM.R, cx = W - 16 - R, cy = 16 + R, k = R / MM.viewM; // 화면 px / m
  const me = S.pos, yaw = S.yaw;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = 'rgba(20,22,30,0.85)'; ctx.fill(); ctx.clip();
  ctx.translate(cx, cy); ctx.rotate(yaw);
  // 지도
  const sc = k / MM.scale;
  ctx.scale(sc, sc);
  ctx.drawImage(MM.canvas, -(me.x + MM.half) * MM.scale, -(me.z + MM.half) * MM.scale);
  ctx.scale(1 / sc, 1 / sc);
  // 아이템
  for (const it of items) {
    const dx = it.x - me.x, dz = it.z - me.z; if (dx * dx + dz * dz > MM.viewM * MM.viewM) continue;
    ctx.fillStyle = '#' + ITEM_COLORS[it.t].toString(16).padStart(6, '0'); ctx.beginPath(); ctx.arc(dx * k, dz * k, 2, 0, Math.PI * 2); ctx.fill();
  }
  // 최근 사격한 적 (3초간 표시, 점점 흐려짐)
  const t = now();
  for (const sh of S.shots) {
    const a = 1 - (t - sh.t) / 3; if (a <= 0) continue;
    const dx = sh.x - me.x, dz = sh.z - me.z;
    ctx.fillStyle = `rgba(255,70,60,${a})`; ctx.beginPath(); ctx.arc(dx * k, dz * k, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  // 아군/시체는 표시하지 않음. 내 위치 화살표
  ctx.rotate(-yaw);
  ctx.fillStyle = '#ff7a3d'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
  ctx.restore();
  // 테두리와 북쪽 표시
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  const nx = cx + Math.sin(yaw) * (R - 9), ny = cy - Math.cos(yaw) * (R - 9);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', nx, ny);
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px sans-serif'; ctx.fillText(`${MM.viewM}m`, cx, cy + R + 10);
}
// 같은 재질의 지오메트리를 하나로 합쳐 드로우콜을 줄임 (월드 전체가 재질 수만큼의 메시가 됨)
function mergeGeos(list) {
  let vc = 0, ic = 0;
  for (const g of list) { vc += g.attributes.position.count; ic += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2);
  const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0, io = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) { const gi = g.index.array; for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo; io += gi.length; }
    else { for (let i = 0; i < n; i++) idx[io + i] = i + vo; io += n; }
    vo += n; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
function mergeLines(list) {
  let vc = 0; for (const g of list) vc += g.attributes.position.count;
  const pos = new Float32Array(vc * 3); let vo = 0;
  for (const g of list) { pos.set(g.attributes.position.array, vo * 3); vo += g.attributes.position.count; g.dispose(); }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); return out;
}
function buildWorld(map) {
  world.clear();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), MATS.normal.ground);
  ground.rotation.x = -Math.PI / 2; ground.userData.mk = 'ground'; ground.receiveShadow = true; world.add(ground);
  buildMinimap(map);
  const buckets = new Map(); // key -> { mat, geos: [] }
  const edgeGeos = [];
  const push = (cm, geo) => { let b = buckets.get(cm.key); if (!b) { b = { mat: cm.mat, geos: [] }; buckets.set(cm.key, b); } b.geos.push(geo); };
  map.solids.forEach((s, i) => {
    if (s.kind === 'ground') return;
    const geo = new THREE.BoxGeometry(s.w, s.h, s.d);
    const windows = (s.kind === 'building' && s.win) || s.kind === 'skyline';
    if (windows) tileBoxUV(geo, s.w, s.h, s.d);
    geo.translate(s.x + s.w / 2, s.y + s.h / 2, s.z + s.d / 2);
    if (s.kind === 'building' || s.kind === 'car' || s.kind === 'wall' || s.kind === 'crate' || s.kind === 'barrel') edgeGeos.push(new THREE.EdgesGeometry(geo));
    push(colorMat(solidColor(s, i), { windows }), geo);
  });
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.28, 1, 6), sphereGeo = new THREE.SphereGeometry(1, 8, 6), poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 1, 5);
  const trunk = colorMat(0x5a3f2a, { kind: 'd' }), pole = colorMat(0x8a8d96, { kind: 'd' }), lamp = { mat: MATS.normal.lamp, key: 'lamp' };
  const leafColors = [0x3f7a3a, 0x4d8a3f, 0x6a8f3a, 0x8a7a30];
  const addD = (base, cm, x, y, z, sx, sy, sz) => { push(cm, base.clone().scale(sx, sy, sz).translate(x, y, z)); };
  map.decor.forEach((d, i) => {
    const leaf = colorMat(leafColors[i % leafColors.length], { kind: 'd' });
    if (d.kind === 'tree') {
      addD(trunkGeo, trunk, d.x, d.h / 2, d.z, 1, d.h, 1);
      addD(sphereGeo, leaf, d.x, d.h + d.r * 0.6, d.z, d.r, d.r * 1.1, d.r);
      addD(sphereGeo, leaf, d.x + d.r * 0.5, d.h + d.r * 0.2, d.z - d.r * 0.3, d.r * 0.7, d.r * 0.7, d.r * 0.7);
    } else if (d.kind === 'bush') {
      addD(sphereGeo, leaf, d.x, d.r * 0.3, d.z, d.r, d.r * 0.7, d.r);
    } else {
      addD(poleGeo, pole, d.x, d.h / 2, d.z, 1, d.h, 1);
      addD(new THREE.BoxGeometry(1.2, 0.15, 0.3), pole, d.x + 0.5, d.h, d.z, 1, 1, 1);
      addD(new THREE.BoxGeometry(0.4, 0.12, 0.25), lamp, d.x + 0.9, d.h - 0.1, d.z, 1, 1, 1);
    }
  });
  // 사다리: 레일 2개 + 가로대
  const metal = colorMat(0xd0d4dc, { metal: true });
  for (const l of (map.ladders || [])) {
    const top = l.top + 1.0, horiz = l.side <= 1; // side 0/1: 벽이 z축과 평행, 레일이 x방향으로 나란히
    const wz = l.side === 0 ? l.z + l.d - 0.15 : l.side === 1 ? l.z + 0.15 : 0;
    const wx = l.side === 2 ? l.x + l.w - 0.15 : l.side === 3 ? l.x + 0.15 : 0;
    const cx = l.x + l.w / 2, cz = l.z + l.d / 2;
    for (const off of [-0.3, 0.3]) {
      const rail = new THREE.BoxGeometry(0.06, top, 0.06);
      if (horiz) rail.translate(cx + off, top / 2, wz); else rail.translate(wx, top / 2, cz + off);
      push(metal, rail);
    }
    for (let y = 0.3; y < top - 0.1; y += 0.3) {
      const rung = horiz ? new THREE.BoxGeometry(0.66, 0.04, 0.05).translate(cx, y, wz) : new THREE.BoxGeometry(0.05, 0.04, 0.66).translate(wx, y, cz);
      push(metal, rung);
    }
  }
  for (const [key, b] of buckets) { const m = new THREE.Mesh(mergeGeos(b.geos), b.mat); m.userData.mk = key; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; world.add(m); }
  const edges = new THREE.LineSegments(mergeLines(edgeGeos), MATS.normal.edge); edges.userData.mk = 'edge'; edges.frustumCulled = false; world.add(edges);
}
// 1인칭 무기 모델
const viewModel = new THREE.Group();
const vmRifle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 1.0), new THREE.MeshLambertMaterial({ color: 0x2a2a32 }));
vmRifle.position.set(0, 0, -0.35); viewModel.add(vmRifle);
const vmScope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 8), new THREE.MeshLambertMaterial({ color: 0x0c0c10 }));
vmScope.rotation.x = Math.PI / 2; vmScope.position.set(0, 0.06, -0.15); viewModel.add(vmScope);
const vmArm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.45), new THREE.MeshLambertMaterial({ color: 0x0c0c10 }));
vmArm.position.set(0.02, -0.08, 0.05); vmArm.rotation.x = 0.35; viewModel.add(vmArm);
viewModel.position.set(0.32, -0.28, -0.55); viewModel.rotation.set(0.05, 0.12, 0.05);
camera.add(viewModel);
// 나이프 모델
const knifeModel = new THREE.Group();
const kBlade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.32), new THREE.MeshLambertMaterial({ color: 0x1a1a22 }));
kBlade.position.set(0, 0, -0.22); knifeModel.add(kBlade);
const kHandle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.14), new THREE.MeshLambertMaterial({ color: 0x0c0c10 }));
knifeModel.add(kHandle);
const kArm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.4), new THREE.MeshLambertMaterial({ color: 0x0c0c10 }));
kArm.position.set(0.02, -0.06, 0.25); kArm.rotation.x = 0.3; knifeModel.add(kArm);
knifeModel.position.set(0.3, -0.3, -0.5); knifeModel.rotation.set(0.1, 0.3, 0.1);
camera.add(knifeModel);

// 플레이어(스틱맨) 모델
const G = { head: new THREE.SphereGeometry(0.14, 10, 8), torso: new THREE.CylinderGeometry(0.11, 0.13, 0.65, 8), leg: new THREE.CylinderGeometry(0.06, 0.06, 0.85, 6), rifle: new THREE.BoxGeometry(0.06, 0.07, 1.1), arms: new THREE.BoxGeometry(0.34, 0.08, 0.42), helmet: new THREE.SphereGeometry(0.17, 10, 8), vest: new THREE.BoxGeometry(0.34, 0.42, 0.26), item: new THREE.OctahedronGeometry(0.25), knife: new THREE.BoxGeometry(0.04, 0.08, 0.4) };
// 몸통(머리+상체+다리)과 총(총+팔)은 각각 하나의 지오메트리로 합쳐 플레이어 1명당 드로우콜을 줄임
let BODY_GEO = null, GUN_GEO = null;
function makePlayerObj() {
  if (!BODY_GEO) {
    BODY_GEO = mergeGeos([G.head.clone().translate(0, 1.66, 0), G.torso.clone().translate(0, 1.2, 0), G.leg.clone().translate(-0.1, 0.425, 0), G.leg.clone().translate(0.1, 0.425, 0)]);
    GUN_GEO = mergeGeos([G.rifle.clone().translate(0.08, 0.02, -0.45), G.arms.clone().translate(0.05, -0.05, -0.2)]);
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(BODY_GEO, MATS.normal.player); body.userData.mk = 'player'; body.castShadow = true; g.add(body);
  const gun = new THREE.Group(); gun.position.set(0, 1.42, 0); g.add(gun);
  const r = new THREE.Mesh(GUN_GEO, MATS.normal.player); r.userData.mk = 'player'; r.castShadow = true; gun.add(r);
  const knife = new THREE.Mesh(G.knife, MATS.normal.player); knife.position.set(0.18, -0.05, -0.35); knife.userData.mk = 'player'; knife.visible = false; gun.add(knife); gun.userData.knife = knife;
  const helmet = new THREE.Mesh(G.helmet, MATS.normal.gear); helmet.position.set(0, 1.7, 0); helmet.scale.set(1, 0.75, 1); helmet.userData.mk = 'gear'; g.add(helmet);
  const vest = new THREE.Mesh(G.vest, MATS.normal.gear); vest.position.set(0, 1.22, 0); vest.userData.mk = 'gear'; g.add(vest);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0xffb060, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.position.set(0, 1.0, 0); glow.scale.set(2.4, 3.2, 1); glow.visible = false; g.add(glow);
  g.userData = { gun, helmet, vest, glow, r };
  scene.add(g);
  return g;
}
// 아이템: 카테고리별 형태의 인스턴스 메시(총·스코프·방탄복·방탄모·소모품) + 글로우 포인트 1개
const ITEM_MAX = 256;
const ITEM_GEOS = {
  rifle: mergeGeos([new THREE.BoxGeometry(0.95, 0.07, 0.09), new THREE.BoxGeometry(0.3, 0.16, 0.06).translate(-0.42, -0.06, 0), new THREE.BoxGeometry(0.06, 0.13, 0.05).translate(-0.08, -0.09, 0), new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8).rotateZ(Math.PI / 2).translate(-0.05, 0.08, 0), new THREE.BoxGeometry(0.1, 0.1, 0.05).translate(-0.18, -0.1, 0)]),
  scope: mergeGeos([new THREE.CylinderGeometry(0.06, 0.06, 0.42, 12).rotateZ(Math.PI / 2), new THREE.CylinderGeometry(0.08, 0.08, 0.08, 12).rotateZ(Math.PI / 2).translate(0.18, 0, 0), new THREE.CylinderGeometry(0.07, 0.07, 0.06, 12).rotateZ(Math.PI / 2).translate(-0.19, 0, 0)]),
  vest: mergeGeos([new THREE.BoxGeometry(0.5, 0.56, 0.16), new THREE.BoxGeometry(0.54, 0.12, 0.2).translate(0, 0.28, 0), new THREE.BoxGeometry(0.2, 0.14, 0.18).translate(0, -0.05, 0)]),
  helmet: new THREE.SphereGeometry(0.25, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, -0.1, 0),
  consumable: mergeGeos([new THREE.BoxGeometry(0.26, 0.32, 0.14), new THREE.BoxGeometry(0.16, 0.06, 0.16).translate(0, 0.19, 0), new THREE.BoxGeometry(0.28, 0.06, 0.02).translate(0, 0, 0.075)]),
};
const ITEM_MESHES = {};
for (const t of Object.keys(ITEM_GEOS)) {
  const im = new THREE.InstancedMesh(ITEM_GEOS[t], new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.25, emissive: 0x2a2a2a }), ITEM_MAX);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; im.count = 0; im.castShadow = true;
  im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ITEM_MAX * 3), 3);
  scene.add(im); ITEM_MESHES[t] = im;
}
const glowGeo = new THREE.BufferGeometry();
glowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ITEM_MAX * 3), 3));
glowGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(ITEM_MAX * 3), 3));
const glowPts = new THREE.Points(glowGeo, new THREE.PointsMaterial({ size: 1.3, map: TEX.glow, vertexColors: true, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
glowPts.frustumCulled = false; scene.add(glowPts);
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();
function setThermal(on) {
  if (S.thermal === on) return; S.thermal = on;
  const mode = on ? 'thermal' : 'normal', c = PAL[mode];
  sky.material.map = SKY_TEX[mode]; sky.material.needsUpdate = true;
  scene.fog.color.setHex(c.fog); scene.fog.near = c.fogNear; scene.fog.far = c.fogFar;
  sun.visible = !on;
  scene.traverse(o => { if (o.userData && o.userData.mk && MATS[mode][o.userData.mk]) o.material = MATS[mode][o.userData.mk]; });
  for (const g of S.playerObjs.values()) g.userData.glow.visible = on;
  for (const k in ITEM_MESHES) { ITEM_MESHES[k].material.color.setHex(on ? 0x2a3c5c : 0xffffff); ITEM_MESHES[k].material.emissive.setHex(on ? 0x000000 : 0x2a2a2a); }
  glowPts.visible = !on;
}
// 이펙트 스프라이트
function spawnFx(x, y, z, color, size, life, additive = true) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color, transparent: true, opacity: 1, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false }));
  sp.position.set(x, y, z); sp.scale.set(size, size, 1); scene.add(sp);
  S.fx.push({ sp, t: life, max: life });
}
function spawnTracer(a, b) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.9 }));
  scene.add(line); S.tracers.push({ line, t: 0.1, max: 0.1 }); // 짧게 남겨 궤적 전체가 띠로 보이지 않게
}

function resize() {
  DPR = HQ ? Math.min(2, window.devicePixelRatio || 1) : 1;
  W = window.innerWidth; H = window.innerHeight;
  hud.width = Math.floor(W * DPR); hud.height = Math.floor(H * DPR);
  if (renderer) { renderer.setPixelRatio(DPR * S.resScale); renderer.setSize(W, H, false); }
  camera.aspect = W / H; camera.updateProjectionMatrix();
  S.vignette = null;
}
// 동적 해상도: 평균 fps가 낮으면 3D 렌더 해상도를 단계적으로 낮춤(최소 50%), 여유가 생기면 되돌림
function adaptResolution(dt) {
  S.fpsTimer += dt; S.fpsAcc += 1 / Math.max(dt, 1e-3); S.fpsN++;
  if (S.fpsTimer < 1.5) return;
  const avg = S.fpsAcc / S.fpsN; S.fpsTimer = 0; S.fpsAcc = 0; S.fpsN = 0;
  let next = S.resScale;
  if (avg < 52 && S.resScale > 0.5) {
    // 해상도를 낮췄는데도 fps가 안 오르면 외부 제한(원격 데스크톱, 주사율, 절전)이므로 원래 해상도로 되돌리고 중단
    if (S.lastAvg !== undefined && S.resScale < 1 && avg < S.lastAvg * 1.1) { next = 1; S.adaptOff = true; }
    else if (!S.adaptOff) next = Math.max(0.5, S.resScale - 0.1);
  } else if (avg > 58.5 && S.resScale < 1) next = Math.min(1, S.resScale + 0.05);
  S.lastAvg = avg;
  if (next !== S.resScale) { S.resScale = next; renderer.setPixelRatio(DPR * S.resScale); renderer.setSize(W, H, false); }
}
window.addEventListener('resize', resize); resize();

// ---------- 네트워크 ----------
function connect(name, bots) {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const ws = new WebSocket(proto + location.host);
  S.ws = ws;
  ws.onopen = () => { ws.send(JSON.stringify({ t: 'join', name })); ws.send(JSON.stringify({ t: 'bots', n: bots })); ws.send(JSON.stringify({ t: 'mode', real: document.getElementById('real').checked })); };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'welcome') { S.id = m.id; S.map = m.map; buildWorld(m.map); S.joined = true; document.getElementById('start').classList.add('hidden'); return; }
    if (m.t === 's') onSnapshot(m);
  };
  ws.onclose = () => { S.joined = false; toast('서버 연결이 끊겼습니다'); document.getElementById('start').classList.remove('hidden'); };
}
function send(o) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); }

function onSnapshot(s) {
  const off = s.time - now();
  if (S.timeOffset === null) S.timeOffset = off;
  else S.timeOffset += (off - S.timeOffset) * (off > S.timeOffset ? 0.3 : 0.05);
  s.pmap = new Map(); for (const p of s.players) s.pmap.set(p.id, p);
  S.snaps.push(s); if (S.snaps.length > 40) S.snaps.shift();
  S.me = s.me; S.bots = s.bots;
  const mine = s.pmap.get(S.id);
  if (mine) {
    if (!S.initPos || (S.wasDead && !mine.d)) { S.pos = { x: mine.x, y: mine.y, z: mine.z }; S.yaw = mine.yw; S.pitch = 0; S.initPos = true; }
    S.wasDead = !!mine.d;
  }
  for (const b of s.bullets) spawnTracer(b.a, b.b);
  for (const e of s.ev) handleEvent(e, s);
  for (const e of s.pev) handleEvent(e, s);
  if (S.invOpen) renderInventory();
  if (S.scoreOpen) renderScoreboard();
}
function handleEvent(e, s) {
  const cp = camera.position;
  switch (e.e) {
    case 'shot': {
      const dist = Math.hypot(e.x - cp.x, e.y - cp.y, e.z - cp.z);
      const p = s.pmap.get(e.by);
      sfxShot(dist, p && (p.r === 'm82' || p.r === 'awm'));
      if (e.by === S.id) { const d = p && p.r ? DEFS.RIFLES[p.r] : DEFS.RIFLES.vss; S.recoil += 0.002 + d.dmg * 0.00006; S.flashUntil = now() + 0.06; }
      else { spawnFx(e.x, e.y, e.z, 0xffd070, 1.2, 0.08); S.shots.push({ x: e.x, z: e.z, t: now() }); if (S.shots.length > 40) S.shots.shift(); }
      break;
    }
    case 'hit':
      spawnFx(e.x, e.y, e.z, S.thermal ? 0xffffff : 0xb01020, 0.9, 0.5, false);
      if (e.by === S.id) { S.hitMarker = 0.35; S.hitHead = !!e.head; sfxTone(e.head ? 1500 : 1000, 0.06, 0.15, 'square'); }
      if (e.victim === S.id) { S.dmgFlash = 0.4; sfxTone(120, 0.15, 0.3); }
      break;
    case 'impact': spawnFx(e.x, e.y, e.z, 0xffc880, 0.5, 0.25); break;
    case 'tracer': spawnTracer(e.a, e.b); break;
    case 'kill': {
      const cause = e.cause === 'knife' ? '🔪' : e.cause === 'fall' ? '추락' : (DEFS.RIFLES[e.cause] ? DEFS.RIFLES[e.cause].name : '');
      const head = e.head ? ' <span style="color:#ff7a3d">헤드샷</span>' : '';
      const cls = e.killer === S.id ? 'me' : (e.victim === S.id ? 'victim' : '');
      killfeed(`<b>${esc(e.kn || '환경')}</b> ${esc(cause)}${head} ▸ ${esc(e.vn)}`, cls);
      if (e.victim === S.id) { S.killedBy = e.kn || '?'; sfxTone(80, 0.6, 0.4, 'sawtooth'); }
      if (e.killer === S.id && e.victim !== S.id) { toast((e.head ? '헤드샷! ' : '처치: ') + e.vn); sfxTone(700, 0.2, 0.2); }
      break;
    }
    case 'melee': if (e.id === S.id) { S.meleeAnim = 0.25; sfxTone(260, 0.08, 0.12, 'triangle'); } break;
    case 'msg': toast(e.text); break;
    case 'pickup': toast('획득: ' + e.name); sfxTone(900, 0.08, 0.1); break;
  }
}

// ---------- 보간 ----------
function interp() {
  const sn = S.snaps; if (!sn.length) return null;
  // 최신 스냅샷을 넘어서는 외삽은 하지 않음(네트워크 지터로 인한 튐 방지)
  const rt = Math.min(now() + S.timeOffset - INTERP, sn[sn.length - 1].time);
  let a = null, b = null;
  for (let i = sn.length - 1; i >= 0; i--) { if (sn[i].time <= rt) { a = sn[i]; b = sn[i + 1] || null; break; } }
  if (!a) a = sn[0];
  if (!b) return { players: a.players, snap: a };
  const t = clamp((rt - a.time) / Math.max(1e-6, b.time - a.time), 0, 1);
  const out = [];
  for (const pb of b.players) {
    const pa = a.pmap.get(pb.id);
    if (!pa || pa.d !== pb.d || Math.hypot(pa.x - pb.x, pa.z - pb.z) > 5) { out.push(pb); continue; }
    out.push(Object.assign({}, pb, { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t, z: pa.z + (pb.z - pa.z) * t, yw: lerpAngle(pa.yw, pb.yw, t), pt: pa.pt + (pb.pt - pa.pt) * t }));
  }
  return { players: out, snap: b };
}

// ---------- 입력 ----------
// 웅크리기: Ctrl 또는 C. Ctrl+W는 전체화면(키보드 잠금)에서만 브라우저 대신 게임이 받음
const KEYMAP = { KeyW: 'f', KeyS: 'b', KeyA: 'l', KeyD: 'r', ShiftLeft: 'sp', ShiftRight: 'sp', KeyC: 'c', ControlLeft: 'c', ControlRight: 'c', Space: 'j' };
function isZoomed() { return S.joined && S.locked && S.zoomHeld && !S.invOpen && S.me && !S.me.dead && !!S.me.rifle && S.me.weapon === 'rifle'; }
// 휠 무기 전환: [장착 총, 가방의 총들..., 나이프]
function weaponList() {
  const me = S.me; const list = [];
  if (me.rifle) list.push({ w: 'rifle', uid: me.rifle.uid });
  for (const b of me.bag) if (b.type === 'rifle') list.push({ w: 'rifle', uid: b.uid });
  list.push({ w: 'knife' });
  return list;
}
function cycleWeapon(dir) {
  const me = S.me; if (!me || me.dead) return;
  const list = weaponList();
  let cur = me.weapon === 'knife' ? list.length - 1 : 0;
  const next = list[(cur + dir + list.length) % list.length];
  send({ t: 'weapon', w: next.w, uid: next.uid });
  sfxTone(500, 0.05, 0.08, 'triangle');
}
window.addEventListener('wheel', (e) => { if (!S.joined || S.invOpen || !S.locked) return; cycleWeapon(e.deltaY > 0 ? 1 : -1); }, { passive: true });
function zoomMag() { return S.me ? S.me.zoom : DEFS.BASE_ZOOM; }
window.addEventListener('keydown', (e) => {
  if (!S.joined) return;
  if (e.code === 'Tab') { e.preventDefault(); if (!S.scoreOpen) { S.scoreOpen = true; renderScoreboard(); document.getElementById('scoreboard').classList.remove('hidden'); } return; }
  if (e.code === 'KeyQ') { toggleInventory(); return; }
  if (S.invOpen) return;
  if (KEYMAP[e.code]) { S.keys[KEYMAP[e.code]] = 1; if (e.code === 'Space' || e.ctrlKey) e.preventDefault(); }
  else if (e.ctrlKey && S.locked) e.preventDefault();
  if (e.code === 'KeyR') send({ t: 'reload' });
  if (e.code === 'KeyF') send({ t: 'pickup' });
  if (/^Digit[1-5]$/.test(e.code)) send({ t: 'use', slot: parseInt(e.code[5], 10) - 1 });
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Tab') { S.scoreOpen = false; document.getElementById('scoreboard').classList.add('hidden'); return; }
  if (KEYMAP[e.code]) S.keys[KEYMAP[e.code]] = 0;
});
window.addEventListener('blur', () => { S.keys = {}; S.fireHeld = false; S.zoomHeld = false; });
hud.addEventListener('contextmenu', (e) => e.preventDefault());
// 마우스 잠금: 원시 이동값(unadjustedMovement) 우선, 실패하면 일반 잠금으로 재시도
function lockPointer() {
  if (document.pointerLockElement === hud) return;
  let r = null;
  try { r = hud.requestPointerLock({ unadjustedMovement: true }); } catch { r = null; }
  if (r && typeof r.catch === 'function') r.catch(() => { try { hud.requestPointerLock(); } catch {} });
  else if (!r) { try { hud.requestPointerLock(); } catch {} }
}
document.addEventListener('pointerlockerror', () => { toast('마우스 잠금 실패 — 화면을 다시 클릭하세요'); });
// 전체화면 + (가능하면) 키보드 잠금: Ctrl+W 같은 브라우저 단축키를 게임이 가로챔
function enterFullscreen() {
  const el = document.documentElement;
  const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
  if (p && p.then) p.then(() => { if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock().catch(() => {}); }).catch(() => {});
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock(); });
hud.addEventListener('mousedown', (e) => {
  if (!S.joined || S.invOpen) return;
  audio();
  if (!S.locked) { lockPointer(); return; }
  if (e.button === 0) { S.fireHeld = true; send({ t: 'fire' }); }
  if (e.button === 2) S.zoomHeld = true;
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) S.fireHeld = false; if (e.button === 2) S.zoomHeld = false; });
window.addEventListener('mousemove', (e) => {
  if (!S.locked || !S.joined) return;
  // 포인터 잠금 직후 브라우저가 보내는 비정상적으로 큰 이동값은 무시
  if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
  const k = 0.0007 * S.sens / (isZoomed() ? zoomMag() * 0.7 : 1);
  S.yaw -= e.movementX * k; S.pitch = clamp(S.pitch - e.movementY * k, -1.5, 1.5);
});
document.addEventListener('pointerlockchange', () => {
  S.locked = document.pointerLockElement === hud;
  hud.classList.toggle('locked', S.locked);
  if (!S.locked) { S.zoomHeld = false; S.fireHeld = false; S.keys = {}; }
});

setInterval(() => {
  if (!S.joined || !S.me) return;
  const z = isZoomed();
  const k = S.invOpen ? {} : S.keys;
  send({ t: 'i', f: k.f, b: k.b, l: k.l, r: k.r, sp: k.sp, c: k.c, j: k.j, yaw: S.yaw + (z ? S.sway.y : 0), pitch: S.pitch + (z ? S.sway.p : 0), z: z ? 1 : 0 });
  if (S.fireHeld && !S.invOpen) send({ t: 'fire' });
}, 1000 / 30);

// ---------- 시작 화면 ----------
document.getElementById('join').addEventListener('click', () => {
  const name = document.getElementById('name').value.trim() || '스나이퍼';
  const bots = clamp(parseInt(document.getElementById('bots').value, 10) || 0, 0, 20);
  S.sens = parseFloat(document.getElementById('sens').value) || 1;
  try { localStorage.setItem('ws_name', name); } catch {}
  audio();
  if (!renderer) initRenderer(document.getElementById('hq').checked);
  connect(name, bots);
  if (document.getElementById('fullscreen').checked) enterFullscreen();
  lockPointer();
});
try { const n = localStorage.getItem('ws_name'); if (n) document.getElementById('name').value = n; } catch {}
document.getElementById('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('join').click(); });

// ---------- 인벤토리 UI ----------
function toggleInventory() {
  S.invOpen = !S.invOpen;
  document.getElementById('inv').classList.toggle('hidden', !S.invOpen);
  if (S.invOpen) { document.exitPointerLock(); S.invKey = ''; renderInventory(); }
  else lockPointer();
}
document.getElementById('inv-close').addEventListener('click', toggleInventory);
function statText(it) {
  const d = DEFS.def(it.type, it.id);
  if (it.type === 'rifle') return `위력 ${d.dmg} · ${Math.round(60 / d.interval)}RPM · 탄수 ${d.mag} · ${d.weight}kg · 탄속 ${d.vel}m/s · 장전 ${it.ammo}/${d.mag}`;
  if (it.type === 'scope') return `${d.zoom}배율${d.thermal ? ` · 열감지 배터리 ${Math.ceil(it.battery)}s` : ''} · ${d.weight}kg`;
  if (it.type === 'vest' || it.type === 'helmet') return `피해 -${Math.round(d.reduce * 100)}% · 내구 ${Math.ceil(it.dur)}/${d.dur} · ${d.weight}kg`;
  const eff = d.heal ? `체력 +${d.heal}` : d.stamina ? `스테미너 회복 · 재생 ${d.boost}s 강화` : `스코프 배터리 +${d.battery}s`;
  return `${eff} · 사용 ${d.time}s · ${d.weight}kg`;
}
function itemRow(it, buttons) {
  const d = DEFS.def(it.type, it.id);
  const icon = it.type === 'consumable' ? d.icon : ITEM_ICONS[it.type];
  return `<div class="item"><span class="ic">${icon}</span><span class="nm">${esc(d.name)}<small>${esc(statText(it))}</small></span>${buttons}</div>`;
}
function renderInventory() {
  const me = S.me; if (!me) return;
  const key = JSON.stringify([me.rifle, me.scope, me.vest, me.helmet, me.bag, me.quick, me.weight]);
  if (key === S.invKey) return; S.invKey = key;
  document.getElementById('inv-weight').textContent = `총 무게 ${me.weight}kg (이동속도 ${Math.round(Math.max(0.45, 1 - 0.028 * me.weight) * 100)}%)`;
  const kinds = [['rifle', '저격총'], ['scope', '스코프'], ['vest', '방탄복'], ['helmet', '방탄모']];
  document.getElementById('equip-list').innerHTML = kinds.map(([k, label]) => {
    const it = me[k];
    if (!it) return `<div class="item empty">${label} 없음</div>`;
    return itemRow(it, `<button data-op="unequip" data-kind="${k}">해제</button><button class="warn" data-op="drop" data-kind="${k}">버리기</button>`);
  }).join('');
  document.getElementById('bag-count').textContent = `${me.bag.length}/${DEFS.BAG_SIZE}`;
  document.getElementById('bag-list').innerHTML = me.bag.length ? me.bag.map(it => {
    let btn = it.type === 'consumable' ? `<button data-op="equip" data-uid="${it.uid}">사용</button>` : `<button data-op="equip" data-uid="${it.uid}">장착</button>`;
    if (it.type === 'consumable') {
      const cur = me.quick.indexOf(it.uid);
      btn += `<select data-quick="${it.uid}"><option value="">퀵슬롯</option>${[0, 1, 2, 3, 4].map(i => `<option value="${i}" ${cur === i ? 'selected' : ''}>${i + 1}번</option>`).join('')}</select>`;
    }
    btn += `<button class="warn" data-op="drop" data-uid="${it.uid}">버리기</button>`;
    return itemRow(it, btn);
  }).join('') : '<div class="item empty">비어 있음</div>';
  document.getElementById('quick-list').innerHTML = me.quick.map((uid, i) => {
    const it = uid ? me.bag.find(b => b.uid === uid) : null;
    const d = it ? DEFS.CONSUMABLES[it.id] : null;
    return `<div class="qslot"><b>${i + 1}</b>${d ? d.icon + ' ' + esc(d.name) : '<span style="color:#4b5566">비어 있음</span>'}</div>`;
  }).join('');
}
document.getElementById('inv').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-op]'); if (!b) return;
  const m = { t: 'inv', op: b.dataset.op };
  if (b.dataset.uid) m.uid = parseInt(b.dataset.uid, 10);
  if (b.dataset.kind) m.kind = b.dataset.kind;
  send(m);
});
document.getElementById('inv').addEventListener('change', (e) => {
  const s = e.target.closest('select[data-quick]'); if (!s) return;
  const uid = parseInt(s.dataset.quick, 10);
  if (s.value === '') { const cur = S.me.quick.indexOf(uid); if (cur >= 0) send({ t: 'inv', op: 'quick', slot: cur, uid: null }); }
  else send({ t: 'inv', op: 'quick', slot: parseInt(s.value, 10), uid });
});
function renderScoreboard() {
  const sn = S.snaps[S.snaps.length - 1]; if (!sn) return;
  const rows = [...sn.players].sort((a, b) => b.k - a.k || a.dt - b.dt);
  document.getElementById('scoreboard').innerHTML = `<table><tr><th>#</th><th>이름</th><th>킬</th><th>데스</th></tr>` +
    rows.map((p, i) => `<tr class="${p.id === S.id ? 'me' : ''}"><td>${i + 1}</td><td class="${p.b ? 'bot' : ''}">${esc(p.n)}${p.b ? ' (NPC)' : ''}</td><td>${p.k}</td><td>${p.dt}</td></tr>`).join('') + '</table>';
}

// ---------- 씬 갱신 ----------
function updatePlayers(players, dt) {
  const seen = new Set();
  for (const p of players) {
    if (p.id === S.id) continue;
    seen.add(p.id);
    let g = S.playerObjs.get(p.id);
    if (!g) { g = makePlayerObj(); S.playerObjs.set(p.id, g); g.userData.glow.visible = S.thermal; }
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.yw;
    if (p.d) { g.rotation.z = Math.PI / 2; g.position.y = p.y + 0.15; g.scale.y = 1; g.userData.gun.visible = false; }
    else {
      g.rotation.z = 0;
      const target = p.c ? P.hc / P.h : 1;
      g.scale.y += (target - g.scale.y) * Math.min(1, dt * 10);
      g.userData.gun.visible = !p.l; g.userData.gun.rotation.x = p.pt;
      const knife = !!p.w;
      g.userData.r.visible = !knife; g.userData.gun.userData.knife.visible = knife;
      if (p.m < 0.25) g.userData.gun.rotation.x = p.pt - Math.sin(p.m / 0.25 * Math.PI) * 0.8; // 근접 휘두르기
    }
    g.userData.helmet.visible = p.hm > 0; g.userData.vest.visible = p.v > 0;
  }
  for (const [id, g] of S.playerObjs) if (!seen.has(id)) { scene.remove(g); S.playerObjs.delete(id); }
}
function updateItems(items, t) {
  const counts = {}; for (const k in ITEM_MESHES) counts[k] = 0;
  let m = 0;
  const gp = glowGeo.attributes.position.array, gc = glowGeo.attributes.color.array;
  for (const it of items) {
    const im = ITEM_MESHES[it.t]; if (!im) continue;
    const n = counts[it.t]; if (n >= ITEM_MAX) continue;
    const dc = Math.hypot(it.x - camera.position.x, it.z - camera.position.z);
    if (dc > 220) continue; // 멀리 있는 아이템은 어차피 안 보임
    _v.set(it.x, it.y + 0.4 + Math.sin(t * 2 + it.u) * 0.06, it.z);
    _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t * 0.8 + it.u);
    _m4.compose(_v, _q, _s); im.setMatrixAt(n, _m4);
    _c.setHex(ITEM_COLORS[it.t]); im.setColorAt(n, _c);
    counts[it.t]++;
    if (dc < 120 && dc > 2.5) { gp[m * 3] = it.x; gp[m * 3 + 1] = it.y + 0.4; gp[m * 3 + 2] = it.z; gc[m * 3] = _c.r; gc[m * 3 + 1] = _c.g; gc[m * 3 + 2] = _c.b; m++; }
  }
  for (const k in ITEM_MESHES) { const im = ITEM_MESHES[k]; im.count = counts[k]; im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; }
  glowGeo.setDrawRange(0, m); glowGeo.attributes.position.needsUpdate = true; glowGeo.attributes.color.needsUpdate = true;
}

// ---------- HUD ----------
function bar(x, y, w, h, v, col, bg) { ctx.fillStyle = bg || 'rgba(0,0,0,0.55)'; ctx.fillRect(x, y, w, h); ctx.fillStyle = col; ctx.fillRect(x + 1, y + 1, (w - 2) * clamp(v, 0, 1), h - 2); }
function drawScope(thermal) {
  const R = Math.min(W, H) * 0.47, cx = W / 2, cy = H / 2;
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(cx, cy, R, 0, Math.PI * 2, true); ctx.fillStyle = '#000'; ctx.fill(); ctx.restore();
  if (!S.vignette) { const vg = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.7)'); S.vignette = vg; }
  ctx.fillStyle = S.vignette; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 14; ctx.beginPath(); ctx.arc(cx, cy, R + 6, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = thermal ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.9)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx - 14, cy); ctx.moveTo(cx + 14, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy - 14); ctx.moveTo(cx, cy + 14); ctx.lineTo(cx, cy + R); ctx.stroke();
  ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx - R * 0.55, cy); ctx.moveTo(cx + R * 0.55, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy + R * 0.55); ctx.lineTo(cx, cy + R); ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle;
  for (let i = 1; i <= 6; i++) { ctx.beginPath(); ctx.arc(cx, cy + i * R * 0.08, 1.8, 0, Math.PI * 2); ctx.fill(); }
  for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(cx - i * R * 0.1, cy, 1.5, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(cx + i * R * 0.1, cy, 1.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.beginPath(); ctx.arc(cx, cy, 1.5, 0, Math.PI * 2); ctx.fill();
  if (thermal) {
    if (!S.noise) { const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d'); const im = g.createImageData(256, 256); for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 30; } g.putImageData(im, 0, 0); S.noise = ctx.createPattern(c, 'repeat'); }
    const ox = (Math.random() * 256) | 0, oy = (Math.random() * 256) | 0;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip(); ctx.translate(ox, oy); ctx.fillStyle = S.noise; ctx.fillRect(cx - R - ox, cy - R - oy, R * 2, R * 2); ctx.restore();
  }
}
function drawHUD(zoomed, thermal, players) {
  const me = S.me; if (!me) return;
  ctx.font = '13px "Segoe UI", "Malgun Gothic", sans-serif'; ctx.textBaseline = 'middle';
  const bx = 16, by = H - 58;
  bar(bx, by, 220, 16, me.hp / P.maxHp, me.hp > 30 ? '#e5453c' : '#ff2a1a');
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(`HP ${Math.ceil(me.hp)}`, bx + 6, by + 8);
  bar(bx, by + 20, 220, 10, me.st / P.maxStamina, me.boost ? '#7be0ff' : '#f2c14e');
  ctx.fillStyle = '#ddd'; ctx.font = '11px sans-serif';
  const armor = [me.vest ? `방탄복 Lv${DEFS.VESTS[me.vest.id].lvl} (${Math.ceil(me.vest.dur)})` : '', me.helmet ? `방탄모 Lv${DEFS.HELMETS[me.helmet.id].lvl} (${Math.ceil(me.helmet.dur)})` : ''].filter(Boolean).join('  ·  ');
  ctx.fillText((armor || '방어구 없음') + (me.crouch ? '  ·  웅크림' : ''), bx, by + 40);
  ctx.textAlign = 'right'; ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = '#fff';
  const rd = me.rifle ? DEFS.RIFLES[me.rifle.id] : null;
  const knifeOut = me.weapon === 'knife';
  ctx.fillText(knifeOut ? '🔪 나이프' : (rd ? rd.name : '무기 없음'), W - 16, H - 66);
  ctx.font = 'bold 30px monospace'; ctx.fillStyle = !knifeOut && me.rifle && me.rifle.ammo === 0 ? '#ff5a4a' : '#fff';
  ctx.fillText(knifeOut ? '근접' : (rd ? `${me.rifle.ammo} / ${rd.mag}` : '-'), W - 16, H - 38);
  // 무기 목록(휠 전환)
  const wl = weaponList(); const curIdx = knifeOut ? wl.length - 1 : 0;
  ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
  wl.forEach((w, i) => {
    const name = w.w === 'knife' ? '나이프' : DEFS.RIFLES[(me.rifle && me.rifle.uid === w.uid ? me.rifle : me.bag.find(b => b.uid === w.uid)).id].name;
    ctx.fillStyle = i === curIdx ? '#ff7a3d' : 'rgba(255,255,255,0.45)';
    ctx.fillText((i === curIdx ? '▶ ' : '') + name, W - 16, H - 96 - (wl.length - 1 - i) * 15);
  });
  ctx.font = '12px sans-serif'; ctx.fillStyle = '#cfd6e3';
  const sd = me.scope ? DEFS.SCOPES[me.scope.id] : null;
  ctx.fillText(sd ? `${sd.name}${sd.thermal ? `  🔋 ${Math.ceil(me.scope.battery)}s` : ''}` : `기본 조준경 ${DEFS.BASE_ZOOM}x`, W - 16, H - 16);
  if (me.reload > 0 && rd) { ctx.textAlign = 'center'; ctx.fillStyle = '#ffd9c4'; ctx.font = 'bold 14px sans-serif'; ctx.fillText(`재장전 중... ${me.reload.toFixed(1)}s`, W / 2, H / 2 + 60); bar(W / 2 - 60, H / 2 + 72, 120, 6, 1 - me.reload / rd.reload, '#ffd9c4'); }
  if (me.using) { ctx.textAlign = 'center'; ctx.fillStyle = '#b8f0c0'; ctx.font = 'bold 14px sans-serif'; ctx.fillText(`${me.using.name} 사용 중`, W / 2, H / 2 + 90); bar(W / 2 - 60, H / 2 + 102, 120, 6, 1 - me.using.left / me.using.total, '#7bde7b'); }
  const qw = 58, qx0 = W / 2 - (qw * 5 + 8 * 4) / 2, qy = H - 70;
  for (let i = 0; i < 5; i++) {
    const x = qx0 + i * (qw + 8);
    const uid = me.quick[i]; const it = uid ? me.bag.find(b => b.uid === uid) : null; const d = it ? DEFS.CONSUMABLES[it.id] : null;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x, qy, qw, 54); ctx.strokeStyle = d ? '#ff7a3d' : '#3a4150'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, qy + 0.5, qw - 1, 53);
    ctx.fillStyle = '#ff7a3d'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(String(i + 1), x + 5, qy + 9);
    if (d) {
      ctx.textAlign = 'center'; ctx.font = '18px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(d.icon, x + qw / 2, qy + 26);
      ctx.font = '10px sans-serif'; ctx.fillStyle = '#ddd'; ctx.fillText(d.name.length > 6 ? d.name.slice(0, 6) : d.name, x + qw / 2, qy + 44);
      const cnt = me.bag.filter(b => b.type === 'consumable' && b.id === it.id).length;
      if (cnt > 1) { ctx.textAlign = 'right'; ctx.fillStyle = '#ffd9c4'; ctx.font = 'bold 11px sans-serif'; ctx.fillText('x' + cnt, x + qw - 4, qy + 9); }
    }
  }
  ctx.textAlign = 'left'; ctx.font = '13px sans-serif'; ctx.fillStyle = '#fff';
  const alive = players.filter(p => !p.d).length;
  ctx.fillText(`킬 ${me.kills}  ·  데스 ${me.deaths}  ·  생존 ${alive}/${players.length}  ·  무게 ${me.weight}kg`, 16, 20);
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '11px monospace';
  ctx.fillText(`${S.fps | 0} fps · ${renderer.info.render.calls} draw · 해상도 ${Math.round(S.resScale * 100)}% · 작업 ${S.workMs.toFixed(1)}ms/프레임 ${(1000 / Math.max(1, S.fps)).toFixed(1)}ms`, 16, 38);
  ctx.fillText(`GPU: ${(S.gpu || '?').slice(0, 70)}${S.software ? '  ⚠ 소프트웨어 렌더링' : ''}`, 16, 52);
  if (S.capped) { ctx.fillStyle = '#ffb060'; ctx.fillText('⚠ 프레임이 외부에서 제한되는 중: 작업 시간은 짧은데 프레임 간격이 깁니다 → 배터리/절전 모드, 브라우저 절전, 모니터 주사율 확인', 16, 66); }
  // 나침반
  const deg = ((-S.yaw * 180 / Math.PI) % 360 + 360) % 360;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '12px monospace';
  ctx.fillText(`${dirs[Math.round(deg / 45) % 8]} ${Math.round(deg)}°`, W / 2, 20);
  if (zoomed) { ctx.textAlign = 'right'; ctx.fillStyle = thermal ? '#fff' : '#ddd'; ctx.font = '13px sans-serif'; ctx.fillText(`${zoomMag()}x${thermal ? ' 열감지' : ''}`, W - 16, 20); }
  if (me.near && !me.dead) { const d = DEFS.def(me.near.type, me.near.id); ctx.textAlign = 'center'; ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(`[F] 줍기 : ${d.name}`, W / 2, H / 2 + 40); }
  const mineP = players.find(p => p.id === S.id);
  if (mineP && mineP.l) { ctx.textAlign = 'center'; ctx.font = '13px sans-serif'; ctx.fillStyle = '#cfe0ff'; ctx.fillText('사다리  ·  W 오르기  S 내리기  Space 뛰어내리기', W / 2, H / 2 + 24); }
  if (S.hitMarker > 0) {
    ctx.strokeStyle = S.hitHead ? 'rgba(255,80,60,0.95)' : 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; const s = 6 + (0.35 - S.hitMarker) * 20;
    ctx.beginPath(); for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.moveTo(W / 2 + dx * 4, H / 2 + dy * 4); ctx.lineTo(W / 2 + dx * s, H / 2 + dy * s); } ctx.stroke();
  }
  if (S.dmgFlash > 0) { const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7); g.addColorStop(0, 'rgba(255,0,0,0)'); g.addColorStop(1, `rgba(255,0,0,${S.dmgFlash / 0.4 * 0.6})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  if (!zoomed && !me.dead) {
    const sx = W / 2, sy = H / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx - 14, sy); ctx.lineTo(sx - 5, sy); ctx.moveTo(sx + 5, sy); ctx.lineTo(sx + 14, sy); ctx.moveTo(sx, sy - 14); ctx.lineTo(sx, sy - 5); ctx.moveTo(sx, sy + 5); ctx.lineTo(sx, sy + 14); ctx.stroke();
  }
  if (!S.locked && !S.invOpen) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('화면을 클릭하면 마우스가 잠기고 조준이 시작됩니다', W / 2, H * 0.3);
    ctx.font = '14px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillText('Esc 로 잠금 해제 · 인벤토리(Q)를 닫으면 자동으로 다시 잠깁니다', W / 2, H * 0.3 + 30);
  }
  if (me.dead) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.fillStyle = '#ff5a4a'; ctx.font = 'bold 42px sans-serif'; ctx.fillText('사망', W / 2, H / 2 - 30);
    ctx.fillStyle = '#eee'; ctx.font = '16px sans-serif'; ctx.fillText(`${S.killedBy} 에게 사살됨  ·  ${Math.ceil(me.respawnIn)}초 후 리스폰`, W / 2, H / 2 + 12);
  }
}

// ---------- 메인 루프 ----------
let lastFrame = now();
function frame() {
  requestAnimationFrame(frame);
  const t = now(); const dt = Math.min(0.1, t - lastFrame); lastFrame = t;
  S.fps = (S.fps || 60) * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  const workStart = performance.now();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!S.joined || !S.map || !S.snaps.length || !renderer) return;
  adaptResolution(dt);
  // 프레임 간격은 긴데(≥28ms) 실제 작업은 짧으면(≤10ms) 외부 프레임 제한으로 판단
  S.capped = S.fps < 36 && S.workMs < 10;
  const res = interp(); const players = res.players, snap = res.snap;
  const me = S.me;
  // 이펙트 수명
  for (const f of S.fx) { f.t -= dt; f.sp.material.opacity = f.t / f.max; if (f.t <= 0) scene.remove(f.sp); }
  S.fx = S.fx.filter(f => f.t > 0);
  for (const tr of S.tracers) { tr.t -= dt; tr.line.material.opacity = tr.t / tr.max; if (tr.t <= 0) { scene.remove(tr.line); tr.line.geometry.dispose(); } }
  S.tracers = S.tracers.filter(tr => tr.t > 0);
  if (S.hitMarker > 0) S.hitMarker -= dt;
  if (S.dmgFlash > 0) S.dmgFlash -= dt;
  // 반동 회복
  if (S.recoil > 0) { const k = Math.min(S.recoil, dt * 0.05); S.pitch += k; S.recoil -= k; }
  // 내 위치: 다른 플레이어와 같은 보간 버퍼를 사용해 30Hz 스냅샷 사이를 부드럽게 채움
  const mine = players.find(p => p.id === S.id) || snap.pmap.get(S.id);
  if (mine) {
    const k = 1 - Math.exp(-dt * 40);
    S.pos.x += (mine.x - S.pos.x) * k; S.pos.y += (mine.y - S.pos.y) * k; S.pos.z += (mine.z - S.pos.z) * k;
    const eyeT = mine.c ? P.eyeC : P.eye; S.eyeH += (eyeT - S.eyeH) * Math.min(1, dt * 10);
  }
  // 스웨이
  const zoomed = isZoomed();
  S.swayT += dt;
  if (zoomed && me) {
    const rw = me.rifle ? DEFS.RIFLES[me.rifle.id].weight : 3;
    const moving = S.keys.f || S.keys.b || S.keys.l || S.keys.r;
    const A = 0.0022 * (rw / 4) * (me.crouch ? 0.4 : 1) * (moving ? 2.4 : 1) * (me.st < 25 ? 2 : 1) * (me.boost ? 0.7 : 1);
    S.sway.y = A * (Math.sin(S.swayT * 1.7) + 0.5 * Math.sin(S.swayT * 3.3));
    S.sway.p = A * (Math.cos(S.swayT * 1.2) + 0.5 * Math.sin(S.swayT * 2.6));
  } else { S.sway.y = S.sway.p = 0; }
  const thermal = zoomed && !!me.thermal;
  setThermal(thermal);
  // 카메라
  camera.position.set(S.pos.x, S.pos.y + S.eyeH, S.pos.z);
  camera.rotation.set(S.pitch + S.sway.p, S.yaw + S.sway.y, 0);
  const fov = zoomed ? DEFS.FOV / zoomMag() : DEFS.FOV;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  const knifeOut = me.weapon === 'knife';
  viewModel.visible = !zoomed && !me.dead && !!me.rifle && !knifeOut;
  knifeModel.visible = !me.dead && knifeOut;
  const bob = (S.keys.f || S.keys.b || S.keys.l || S.keys.r) ? Math.sin(t * 9) * 0.012 : 0;
  if (viewModel.visible) viewModel.position.set(0.32, -0.28 + bob, -0.55 + (me.reload > 0 ? 0.15 : 0));
  if (S.meleeAnim > 0) S.meleeAnim -= dt;
  if (knifeModel.visible) { const sw = S.meleeAnim > 0 ? Math.sin((0.25 - S.meleeAnim) / 0.25 * Math.PI) : 0; knifeModel.position.set(0.3 - sw * 0.25, -0.3 + bob + sw * 0.05, -0.5 - sw * 0.25); knifeModel.rotation.set(0.1 - sw * 0.9, 0.3 + sw * 0.6, 0.1); }
  sky.position.copy(camera.position);
  updatePlayers(players, dt);
  updateItems(snap.items, t);
  renderer.render(scene, camera);
  // HUD
  if (zoomed) { drawScope(thermal); if (S.flashUntil > t) { ctx.fillStyle = 'rgba(255,240,200,0.25)'; ctx.fillRect(0, 0, W, H); } }
  drawHUD(zoomed, thermal, players);
  if (!zoomed && !me.dead) drawMinimap(players, snap.items);
  const work = performance.now() - workStart;
  S.workMs = (S.workMs || 0) * 0.9 + work * 0.1;
}
requestAnimationFrame(frame);
window.WS = S; window.WS.scene = scene; window.WS.camera = camera; // 디버그용
