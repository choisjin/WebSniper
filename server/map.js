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
  const decor = [], ladders = [], buildings = [];
  const surfaces = [{ x1: -HALF + 4, x2: HALF - 4, z1: -HALF + 4, z2: HALF - 4, y: 0, kind: 'ground' }];
  const boxes = [], placed = [];
  const hits = (b, m, list) => list.some(s => s.x < b.x + b.w + m && s.x + s.w > b.x - m && s.z < b.z + b.d + m && s.z + s.d > b.z - m);

  // 건물: 속이 빈 구조. 출입구 → 층마다 꺾이는 계단실 → 옥상 해치. 층고 3m, 벽 두께 0.4m
  const F = 3, T = 0.4;
  for (let i = 0; i < 90; i++) {
    const w = R(9, 30), d = R(9, 30);
    const nF = rnd() < 0.45 ? RI(1, 3) : RI(4, 13);
    const h = nF * F;
    const b = { x: R(-HALF + 10, HALF - 10 - w), y: 0, z: R(-HALF + 10, HALF - 10 - d), w, h, d, nF, win: rnd() < 0.8, bi: buildings.length };
    if (hits(b, 6, boxes)) continue;
    boxes.push(b);
    const bi = b.bi;
    const push = (x, y, z, bw, bh, bd, kind) => solids.push({ x, y, z, w: bw, h: bh, d: bd, kind, bi });
    // 출입구: 벽 한쪽 중앙, 폭 1.4 높이 2.3. 계단실은 (x0,z0) 모서리이므로 출입구는 +z 또는 +x 벽
    const doorSide = rnd() < 0.5 ? 1 : 3; // 1: +z 벽, 3: +x 벽
    b.door = doorSide;
    const DW = 1.4, DH = 2.3;
    // 벽 4개 (출입구 벽은 좌/우/상인방 3개로 분할)
    if (doorSide === 1) { const cx = b.x + b.w / 2; push(b.x, 0, b.z + b.d - T, cx - DW / 2 - b.x, h, T, 'bwall'); push(cx + DW / 2, 0, b.z + b.d - T, b.x + b.w - cx - DW / 2, h, T, 'bwall'); push(cx - DW / 2, DH, b.z + b.d - T, DW, h - DH, T, 'bwall'); }
    else push(b.x, 0, b.z + b.d - T, b.w, h, T, 'bwall');
    push(b.x, 0, b.z, b.w, h, T, 'bwall');
    push(b.x, 0, b.z, T, h, b.d, 'bwall');
    if (doorSide === 3) { const cz = b.z + b.d / 2; push(b.x + b.w - T, 0, b.z, T, h, cz - DW / 2 - b.z, 'bwall'); push(b.x + b.w - T, 0, cz + DW / 2, T, h, b.z + b.d - cz - DW / 2, 'bwall'); push(b.x + b.w - T, DH, cz - DW / 2, T, h - DH, DW, 'bwall'); }
    else push(b.x + b.w - T, 0, b.z, T, h, b.d, 'bwall');
    // 계단실: 모서리 (x0,z0)에서 x방향 4.0m(입구 띠 1.0 + 계단 1.8 + 착지 1.2), z방향 2.6m(1.2 레인 + 0.2 + 1.2 레인)
    const x0 = b.x + T, z0 = b.z + T, L0 = 1.0, SX = L0 + 1.8 + 1.2, SZ = 2.6;
    const ix1 = b.x + T, ix2 = b.x + b.w - T, iz1 = b.z + T, iz2 = b.z + b.d - T; // 실내 범위
    b.stair = { x: x0, z: z0, w: SX, d: SZ };
    // 층 바닥(k=1..nF-1)과 옥상 슬래브(k=nF): 계단실 위(x0+L0~x0+SX)는 뚫림, 입구 띠(x0~x0+L0)는 막힘
    for (let k = 1; k <= nF; k++) {
      const y = k * F - 0.25, kind = k === nF ? 'broof' : 'bfloor';
      push(ix1, y, iz1, L0, 0.25, SZ, kind);                        // 입구 띠
      push(x0 + SX, y, iz1, ix2 - (x0 + SX), 0.25, SZ, kind);        // 계단실 오른쪽
      push(ix1, y, z0 + SZ, ix2 - ix1, 0.25, iz2 - (z0 + SZ), kind); // 나머지 실내
      if (k < nF) surfaces.push({ x1: ix1 + 0.5, x2: ix2 - 0.5, z1: z0 + SZ + 0.5, z2: iz2 - 0.5, y: k * F, kind: 'floor' });
    }
    // 계단: 층마다 A런(레인1, +x, 0.5/1.0/1.5) → 착지(1.5) → B런(레인2, -x, 2.0/2.5/3.0) → 입구 띠(다음 층 바닥)
    // 디딤판은 두께 0.25의 얇은 판(기둥이 아님): 위층 계단이 머리 위 3.75m 이상에 오도록 헤드룸 확보
    const TR = 0.25;
    for (let k = 0; k < nF; k++) {
      const y = k * F;
      for (let s = 0; s < 3; s++) push(x0 + L0 + s * 0.6, y + 0.5 * (s + 1) - TR, z0, 0.6, TR, 1.2, 'bstep');
      push(x0 + L0 + 1.8, y + 1.5 - TR, z0, 1.2, TR, SZ, 'bstep');
      for (let s = 0; s < 3; s++) push(x0 + L0 + 1.2 - s * 0.6, y + 2.0 + 0.5 * s - TR, z0 + 1.4, 0.6, TR, 1.2, 'bstep');
    }
    surfaces.push({ x1: b.x + 0.8, x2: b.x + b.w - 0.8, z1: z0 + SZ + 0.5, z2: b.z + b.d - 0.8, y: h, kind: 'roof' });
    surfaces.push({ x1: ix1 + 0.5, x2: ix2 - 0.5, z1: z0 + SZ + 0.5, z2: iz2 - 0.5, y: 0, kind: 'floor' });
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
  return { SIZE, HALF, solids, decor, ladders, buildings, surfaces, seed };
}

module.exports = { genMap, mulberry32 };
