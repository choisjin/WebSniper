'use strict';
// 시드 기반 3D 랜덤 맵: 검은 박스 건물/엄폐물, 비충돌 장식물(나무·덤불·기둥)
// 좌표계: x,z 지면, y 위쪽. 박스 = {x,y,z,w,h,d} (x~x+w, y~y+h, z~z+d)
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BUILDING = require('../shared/building');

function genMap(seed) {
  const rnd = mulberry32(seed);
  const R = (a, b) => a + rnd() * (b - a);
  const RI = (a, b) => Math.floor(R(a, b + 1));
  const SIZE = 600, HALF = 300;
  const solids = [{ x: -HALF - 400, y: -5, z: -HALF - 400, w: SIZE + 800, h: 5, d: SIZE + 800, kind: 'ground' }];
  // 경계 벽
  solids.push({ x: -HALF - 2, y: 0, z: -HALF - 2, w: SIZE + 4, h: 8, d: 2, kind: 'wall' });
  solids.push({ x: -HALF - 2, y: 0, z: HALF, w: SIZE + 4, h: 8, d: 2, kind: 'wall' });
  solids.push({ x: -HALF - 2, y: 0, z: -HALF - 2, w: 2, h: 8, d: SIZE + 4, kind: 'wall' });
  solids.push({ x: HALF, y: 0, z: -HALF - 2, w: 2, h: 8, d: SIZE + 4, kind: 'wall' });
  const decor = [], ladders = [], buildings = [];
  const surfaces = [{ x1: -HALF + 4, x2: HALF - 4, z1: -HALF + 4, z2: HALF - 4, y: 0, kind: 'ground' }];
  const boxes = [], placed = [];
  const hits = (b, m, list) => list.some(s => s.x < b.x + b.w + m && s.x + s.w > b.x - m && s.z < b.z + b.d + m && s.z + s.d > b.z - m);

  // 건물: 속이 빈 구조(shared/building.js). 출입구 → 층마다 꺾이는 계단실 → 옥상 해치
  const F = BUILDING.F;
  for (let i = 0; i < 220; i++) {
    const w = R(12, 30), d = R(12, 30);
    const nF = rnd() < 0.5 ? RI(1, 2) : RI(3, 6);
    const h = nF * F;
    const b = { x: R(-HALF + 10, HALF - 10 - w), y: 0, z: R(-HALF + 10, HALF - 10 - d), w, h, d, nF, win: rnd() < 0.8, bi: buildings.length, door: rnd() < 0.5 ? 1 : 3 };
    if (hits(b, 6, boxes)) continue;
    boxes.push(b);
    const parts = BUILDING.parts(b);
    for (const s of parts.solids) solids.push(s);
    b.stair = parts.stair;
    const it = parts.interior;
    for (let k = 0; k < nF; k++) surfaces.push({ x1: it.x1 + 0.5, x2: it.x2 - 0.5, z1: it.z1 + 0.5, z2: it.z2 - 0.5, y: k * F, kind: 'floor' });
    surfaces.push({ x1: b.x + 0.8, x2: b.x + b.w - 0.8, z1: it.z1 + 0.5, z2: b.z + b.d - 0.8, y: h, kind: 'roof' });
    // 난간/환기구는 bi 없이 넣어 클라이언트에 그대로 전송됨(건물 본체는 클라이언트가 재생성)
    const push = (x, y, z, bw, bh, bd, kind) => solids.push({ x, y, z, w: bw, h: bh, d: bd, kind });
    // 옥상 난간(1m: 웅크리면 숨고, 서면 머리가 보임)
    if (rnd() < 0.8) {
      const ph = 1.0, pt = 0.3;
      push(b.x, h, b.z, b.w, ph, pt, 'parapet'); push(b.x, h, b.z + b.d - pt, b.w, ph, pt, 'parapet');
      push(b.x, h, b.z, pt, ph, b.d, 'parapet'); push(b.x + b.w - pt, h, b.z, pt, ph, b.d, 'parapet');
    }
    if (w > 12 && d > 12 && rnd() < 0.6) push(R(b.x + 6, b.x + w - 4.5), h, R(b.z + 5, b.z + d - 4.5), R(1, 2.5), R(0.8, 2.2), R(1, 2.5), 'vent');
    buildings.push(b);
  }
  // 지상 엄폐물
  for (let i = 0; i < 420; i++) {
    const k = rnd(); let c;
    if (k < 0.3) c = { w: 1, h: 1, d: 1, kind: 'crate' };
    else if (k < 0.5) c = rnd() < 0.5 ? { w: 3, h: 0.6, d: 0.6, kind: 'sandbag' } : { w: 0.6, h: 0.6, d: 3, kind: 'sandbag' };
    else if (k < 0.7) c = rnd() < 0.5 ? { w: 4.2, h: 1.4, d: 1.9, kind: 'car' } : { w: 1.9, h: 1.4, d: 4.2, kind: 'car' };
    else if (k < 0.88) c = rnd() < 0.5 ? { w: 3, h: 1.3, d: 0.3, kind: 'wall' } : { w: 0.3, h: 1.3, d: 3, kind: 'wall' };
    else c = { w: 0.6, h: 0.9, d: 0.6, kind: 'barrel' };
    c.x = R(-HALF + 3, HALF - 3 - c.w); c.z = R(-HALF + 3, HALF - 3 - c.d); c.y = 0;
    if (hits(c, 1.5, boxes) || hits(c, 0.8, placed)) continue;
    solids.push(c); placed.push(c);
    if (c.kind === 'crate' && rnd() < 0.3) solids.push(Object.assign({}, c, { y: 1 }));
  }
  // 장식물(비충돌: 시야만 가림, 총알 통과)
  for (let i = 0; i < 220; i++) {
    const k = rnd(); let dd;
    if (k < 0.55) dd = { kind: 'tree', r: R(1.8, 3.5), h: R(3.5, 6.5), tr: 0.22 };
    else if (k < 0.8) dd = { kind: 'bush', r: R(0.8, 1.6) };
    else dd = { kind: 'pole', h: R(5, 8) };
    dd.x = R(-HALF + 3, HALF - 3); dd.z = R(-HALF + 3, HALF - 3); dd.y = 0;
    const probe = { x: dd.x - 0.5, z: dd.z - 0.5, w: 1, d: 1 };
    if (hits(probe, 1.5, boxes) || hits(probe, 0.8, placed)) continue;
    decor.push(dd);
  }
  // 경계 밖 원경 스카이라인
  // 층고 7.2m 배수 높이로 맞춰 창문 줄이 실제 건물과 같은 비례로 보이게
  for (let i = 0; i < 120; i++) {
    const ang = rnd() * Math.PI * 2, dist = R(HALF + 50, HALF + 360), w = R(15, 70);
    solids.push({ x: Math.cos(ang) * dist - w / 2, y: 0, z: Math.sin(ang) * dist - w / 2, w, h: RI(3, 18) * F, d: w, kind: 'skyline' });
  }
  return { SIZE, HALF, solids, decor, ladders, buildings, surfaces, seed };
}

module.exports = { genMap, mulberry32 };
