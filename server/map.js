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

function genMap(seed) {
  const rnd = mulberry32(seed);
  const R = (a, b) => a + rnd() * (b - a);
  const RI = (a, b) => Math.floor(R(a, b + 1));
  const SIZE = 400, HALF = 200;
  const solids = [{ x: -HALF - 400, y: -5, z: -HALF - 400, w: SIZE + 800, h: 5, d: SIZE + 800, kind: 'ground' }];
  // 경계 벽
  solids.push({ x: -HALF - 2, y: 0, z: -HALF - 2, w: SIZE + 4, h: 8, d: 2, kind: 'wall' });
  solids.push({ x: -HALF - 2, y: 0, z: HALF, w: SIZE + 4, h: 8, d: 2, kind: 'wall' });
  solids.push({ x: -HALF - 2, y: 0, z: -HALF - 2, w: 2, h: 8, d: SIZE + 4, kind: 'wall' });
  solids.push({ x: HALF, y: 0, z: -HALF - 2, w: 2, h: 8, d: SIZE + 4, kind: 'wall' });
  const decor = [], ladders = [];
  const surfaces = [{ x1: -HALF + 4, x2: HALF - 4, z1: -HALF + 4, z2: HALF - 4, y: 0, kind: 'ground' }];
  const boxes = [], placed = [];
  const hits = (b, m, list) => list.some(s => s.x < b.x + b.w + m && s.x + s.w > b.x - m && s.z < b.z + b.d + m && s.z + s.d > b.z - m);
  const inBounds = (b, m) => b.x >= -HALF + m && b.x + b.w <= HALF - m && b.z >= -HALF + m && b.z + b.d <= HALF - m;

  // 건물
  for (let i = 0; i < 90; i++) {
    const w = R(8, 30), d = R(8, 30);
    const low = rnd() < 0.45;
    const h = low ? R(3, 9) : R(10, 40);
    const b = { x: R(-HALF + 10, HALF - 10 - w), y: 0, z: R(-HALF + 10, HALF - 10 - d), w, h, d, kind: 'building', win: rnd() < 0.75 };
    if (hits(b, 6, boxes)) continue;
    boxes.push(b); solids.push(b);
    surfaces.push({ x1: b.x + 0.8, x2: b.x + b.w - 0.8, z1: b.z + 0.8, z2: b.z + b.d - 0.8, y: h, kind: 'roof' });
    // 낮은 건물엔 외부 계단(자동 스텝업으로 오름)
    let stairSide = -1;
    if (low) {
      const n = Math.ceil(h / 0.55), side = RI(0, 3), steps = [];
      for (let k = 1; k <= n; k++) {
        const sh = Math.min(0.55 * k, h), off = (n - k) * 0.6;
        let s;
        if (side === 0) s = { x: b.x + b.w / 2 - 1, z: b.z - off - 0.6, w: 2, d: 0.6 };
        else if (side === 1) s = { x: b.x + b.w / 2 - 1, z: b.z + b.d + off, w: 2, d: 0.6 };
        else if (side === 2) s = { x: b.x - off - 0.6, z: b.z + b.d / 2 - 1, w: 0.6, d: 2 };
        else s = { x: b.x + b.w + off, z: b.z + b.d / 2 - 1, w: 0.6, d: 2 };
        s.y = 0; s.h = sh; s.kind = 'step'; steps.push(s);
      }
      if (!steps.some(s => hits(s, 0.5, boxes) || !inBounds(s, 3))) { for (const s of steps) { solids.push(s); boxes.push(s); } stairSide = side; }
    }
    // 계단이 없는 건물엔 사다리 (벽에 붙은 0.8m 두께의 등반 구역, 옥상보다 1.2m 위까지)
    if (stairSide < 0) {
      const side = RI(0, 3); let l;
      if (side === 0) l = { x: b.x + b.w / 2 - 0.5, z: b.z - 0.8, w: 1, d: 0.8 };
      else if (side === 1) l = { x: b.x + b.w / 2 - 0.5, z: b.z + b.d, w: 1, d: 0.8 };
      else if (side === 2) l = { x: b.x - 0.8, z: b.z + b.d / 2 - 0.5, w: 0.8, d: 1 };
      else l = { x: b.x + b.w, z: b.z + b.d / 2 - 0.5, w: 0.8, d: 1 };
      l.y = 0; l.h = h + 1.2; l.side = side; l.top = h;
      if (inBounds(l, 2)) { ladders.push(l); stairSide = side; }
    }
    // 옥상 난간(1m: 웅크리면 숨고, 서면 머리가 보임)
    if (rnd() < 0.8) {
      const ph = 1.0, pt = 0.3;
      if (stairSide !== 0) solids.push({ x: b.x, y: h, z: b.z, w: b.w, h: ph, d: pt, kind: 'parapet' });
      if (stairSide !== 1) solids.push({ x: b.x, y: h, z: b.z + b.d - pt, w: b.w, h: ph, d: pt, kind: 'parapet' });
      if (stairSide !== 2) solids.push({ x: b.x, y: h, z: b.z, w: pt, h: ph, d: b.d, kind: 'parapet' });
      if (stairSide !== 3) solids.push({ x: b.x + b.w - pt, y: h, z: b.z, w: pt, h: ph, d: b.d, kind: 'parapet' });
    }
    if (w > 10 && d > 10 && rnd() < 0.6) solids.push({ x: R(b.x + 2, b.x + w - 4.5), y: h, z: R(b.z + 2, b.z + d - 4.5), w: R(1, 2.5), h: R(0.8, 2.2), d: R(1, 2.5), kind: 'vent' });
  }
  // 지상 엄폐물
  for (let i = 0; i < 220; i++) {
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
  for (let i = 0; i < 110; i++) {
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
  for (let i = 0; i < 90; i++) {
    const ang = rnd() * Math.PI * 2, dist = R(HALF + 50, HALF + 320), w = R(15, 70);
    solids.push({ x: Math.cos(ang) * dist - w / 2, y: 0, z: Math.sin(ang) * dist - w / 2, w, h: R(20, 130), d: w, kind: 'skyline' });
  }
  return { SIZE, HALF, solids, decor, ladders, surfaces, seed };
}

module.exports = { genMap, mulberry32 };
