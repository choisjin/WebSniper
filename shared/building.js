// 건물 구조 생성 (서버/클라이언트 공용). 건물 파라미터 {x,z,w,d,nF,door,bi} → 충돌 박스 + 시각 전용 박스
// 비례: 층고 7.2m, 벽 두께 0.4m, 층마다 벽에 실제로 뚫린 창(폭 1.8m·높이 2.4m, 3.6m 간격),
//       계단 한 단 높이 0.2m·깊이 0.3m, 한 층 = 18단 + 착지 + 18단(꺾임), 난간 높이 1.0m
(function (root) {
  const F = 7.2, T = 0.4, L0 = 1.2, RISE = 0.2, TREAD = 0.3, NS = 18, LAND = 1.4, LANE = 1.3, GAP = 0.2, SLAB = 0.25;
  const SX = L0 + NS * TREAD + LAND, SZ = LANE * 2 + GAP;
  const DW = 1.6, DH = 2.4, RAIL = 1.0;
  const WIN_W = 1.8, WIN_CELL = 3.6, WIN_Y1 = 1.0, WIN_Y2 = 3.4;
  const B = { F, T, SX, SZ, DW, DH, WIN_W, WIN_CELL, WIN_Y1, WIN_Y2 };

  // 벽 하나를 창/출입구 개구부를 뺀 사각형들로 분할. side 0:-z 벽, 1:+z 벽, 2:-x 벽, 3:+x 벽
  function wallBoxes(out, b, side) {
    const L = side <= 1 ? b.w : b.d, isDoor = b.door === side, H = b.nF * F;
    const opens = [];
    const n = Math.max(0, Math.floor((L - 1.2) / WIN_CELL)), off = (L - n * WIN_CELL) / 2;
    for (let k = 0; k < b.nF; k++) {
      for (let i = 0; i < n; i++) {
        const a = off + i * WIN_CELL + (WIN_CELL - WIN_W) / 2;
        if (isDoor && k === 0 && a + WIN_W > L / 2 - DW / 2 - 0.4 && a < L / 2 + DW / 2 + 0.4) continue; // 출입구와 겹치는 창은 생략
        opens.push({ a, b: a + WIN_W, y1: k * F + WIN_Y1, y2: k * F + WIN_Y2 });
      }
    }
    if (isDoor) opens.push({ a: L / 2 - DW / 2, b: L / 2 + DW / 2, y1: 0, y2: DH });
    const ys = new Set([0, H]); for (const o of opens) { ys.add(o.y1); ys.add(o.y2); }
    const yl = [...ys].sort((p, q) => p - q);
    for (let j = 0; j < yl.length - 1; j++) {
      const ya = yl[j], yb = yl[j + 1]; if (yb - ya < 1e-6) continue;
      const act = opens.filter(o => o.y1 <= ya + 1e-6 && o.y2 >= yb - 1e-6).sort((p, q) => p.a - q.a);
      let cur = 0; const segs = [];
      for (const o of act) { if (o.a > cur + 1e-6) segs.push([cur, o.a]); cur = Math.max(cur, o.b); }
      if (cur < L - 1e-6) segs.push([cur, L]);
      for (const [a, c] of segs) {
        if (side === 0) out.push({ x: b.x + a, y: ya, z: b.z, w: c - a, h: yb - ya, d: T, kind: 'bwall', bi: b.bi });
        else if (side === 1) out.push({ x: b.x + a, y: ya, z: b.z + b.d - T, w: c - a, h: yb - ya, d: T, kind: 'bwall', bi: b.bi });
        else if (side === 2) out.push({ x: b.x, y: ya, z: b.z + a, w: T, h: yb - ya, d: c - a, kind: 'bwall', bi: b.bi });
        else out.push({ x: b.x + b.w - T, y: ya, z: b.z + a, w: T, h: yb - ya, d: c - a, kind: 'bwall', bi: b.bi });
      }
    }
  }

  // 반환: { solids: 충돌+시각, visual: 시각 전용(계단 난간) }
  B.parts = function (b) {
    const s = [], v = [];
    const push = (arr, x, y, z, w, h, d, kind) => arr.push({ x, y, z, w, h, d, kind, bi: b.bi });
    const ix1 = b.x + T, ix2 = b.x + b.w - T, iz1 = b.z + T, iz2 = b.z + b.d - T; // 실내 범위
    for (let side = 0; side < 4; side++) wallBoxes(s, b, side);
    // 계단실: 모서리 (x0,z0). x방향 SX = 입구띠 L0 + 18단×0.3 + 착지 1.4, z방향 SZ = 레인 1.3 + 0.2 + 레인 1.3
    const x0 = ix1, z0 = iz1;
    // 층 슬래브(k=1..nF-1)와 옥상(k=nF): 계단실 위(x0+L0~x0+SX)는 뚫림. 구멍 둘레 난간(충돌 있음)
    for (let k = 1; k <= b.nF; k++) {
      const y = k * F - SLAB, kind = k === b.nF ? 'broof' : 'bfloor';
      push(s, ix1, y, iz1, L0, SLAB, SZ, kind);                        // 입구 띠 (계단 도착 → 층 진입)
      push(s, x0 + SX, y, iz1, ix2 - (x0 + SX), SLAB, SZ, kind);        // 계단실 오른쪽
      push(s, ix1, y, z0 + SZ, ix2 - ix1, SLAB, iz2 - (z0 + SZ), kind); // 나머지 실내
      push(s, x0 + L0, k * F, z0 + SZ - 0.06, SX - L0, RAIL, 0.06, 'brail');
      push(s, x0 + SX - 0.06, k * F, z0, 0.06, RAIL, SZ, 'brail');
      if (k === b.nF) push(s, x0 + L0, k * F, z0, 0.06, RAIL, LANE, 'brail'); // 옥상 해치 앞
    }
    // 계단 (k=0..nF-1): A런(레인1, +x, 0.2씩 18단) → 착지(3.6) → B런(레인2, -x, 3.8~7.2) → 입구 띠
    const z1 = z0, z2 = z0 + LANE + GAP;
    for (let k = 0; k < b.nF; k++) {
      const y0 = k * F;
      for (let i = 0; i < NS; i++) {
        const top = y0 + RISE * (i + 1), x = x0 + L0 + i * TREAD;
        push(s, x, top - RISE, z1, TREAD, RISE, LANE, 'bstep');
        push(v, x + TREAD / 2 - 0.025, top, z1 + LANE - 0.05, 0.05, RAIL - 0.1, 0.05, 'brail');
        push(v, x, top + RAIL - 0.1, z1 + LANE - 0.05, TREAD, 0.06, 0.05, 'brail');
      }
      const lt = y0 + RISE * NS, lx = x0 + L0 + NS * TREAD;
      push(s, lx, lt - SLAB, z0, LAND, SLAB, SZ, 'bstep');
      push(v, lx + LAND - 0.06, lt, z0, 0.06, RAIL, SZ, 'brail');
      push(v, lx, lt, z0 + SZ - 0.06, LAND, RAIL, 0.06, 'brail');
      for (let i = 0; i < NS; i++) {
        const top = y0 + RISE * (NS + 1 + i), x = x0 + L0 + (NS - 1 - i) * TREAD;
        push(s, x, top - RISE, z2, TREAD, RISE, LANE, 'bstep');
        push(v, x + TREAD / 2 - 0.025, top, z2, 0.05, RAIL - 0.1, 0.05, 'brail');
        push(v, x, top + RAIL - 0.1, z2, TREAD, 0.06, 0.05, 'brail');
      }
    }
    return { solids: s, visual: v, stair: { x: x0, z: z0, w: SX, d: SZ }, interior: { x1: ix1, x2: ix2, z1: z0 + SZ, z2: iz2 } };
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = B; else root.BUILDING = B;
})(typeof self !== 'undefined' ? self : this);
