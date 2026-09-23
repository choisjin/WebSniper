// 건물 구조 생성 (서버/클라이언트 공용). 건물 파라미터 {x,z,w,d,nF,door,bi} → 충돌 박스 + 시각 전용 박스
// 비례: 층고 3.6m, 벽 두께 0.4m, 계단 한 단 높이 0.2m·깊이 0.3m, 한 층 = 9단 + 착지 + 9단(꺾임), 난간 높이 1.0m
(function (root) {
  const F = 3.6, T = 0.4, L0 = 1.2, RISE = 0.2, TREAD = 0.3, NS = 9, LAND = 1.4, LANE = 1.3, GAP = 0.2, SLAB = 0.25;
  const SX = L0 + NS * TREAD + LAND, SZ = LANE * 2 + GAP;
  const DW = 1.6, DH = 2.4, RAIL = 1.0;
  const B = { F, T, SX, SZ, DW, DH };

  // 반환: { solids: 충돌+시각, visual: 시각 전용(난간, 실내 창문 패널) }
  B.parts = function (b) {
    const s = [], v = [];
    const push = (arr, x, y, z, w, h, d, kind) => arr.push({ x, y, z, w, h, d, kind, bi: b.bi });
    const h = b.nF * F;
    const ix1 = b.x + T, ix2 = b.x + b.w - T, iz1 = b.z + T, iz2 = b.z + b.d - T; // 실내 범위
    // 벽 4개 (출입구 벽은 좌/우/상인방으로 분할). door 1: +z 벽, door 3: +x 벽
    if (b.door === 1) { const cx = b.x + b.w / 2; push(s, b.x, 0, iz2, cx - DW / 2 - b.x, h, T, 'bwall'); push(s, cx + DW / 2, 0, iz2, b.x + b.w - cx - DW / 2, h, T, 'bwall'); push(s, cx - DW / 2, DH, iz2, DW, h - DH, T, 'bwall'); }
    else push(s, b.x, 0, iz2, b.w, h, T, 'bwall');
    push(s, b.x, 0, b.z, b.w, h, T, 'bwall');
    push(s, b.x, 0, b.z, T, h, b.d, 'bwall');
    if (b.door === 3) { const cz = b.z + b.d / 2; push(s, ix2, 0, b.z, T, h, cz - DW / 2 - b.z, 'bwall'); push(s, ix2, 0, cz + DW / 2, T, h, b.z + b.d - cz - DW / 2, 'bwall'); push(s, ix2, DH, cz - DW / 2, T, h - DH, DW, 'bwall'); }
    else push(s, ix2, 0, b.z, T, h, b.d, 'bwall');
    // 실내 창문 패널(시각 전용): 벽 안쪽 면에 얇은 판, 출입구 자리는 비움
    const P = 0.03;
    if (b.door === 1) { const cx = b.x + b.w / 2; push(v, ix1, 0, iz2 - P, cx - DW / 2 - ix1, h, P, 'bwin'); push(v, cx + DW / 2, 0, iz2 - P, ix2 - cx - DW / 2, h, P, 'bwin'); push(v, cx - DW / 2, DH, iz2 - P, DW, h - DH, P, 'bwin'); }
    else push(v, ix1, 0, iz2 - P, ix2 - ix1, h, P, 'bwin');
    push(v, ix1, 0, iz1, ix2 - ix1, h, P, 'bwin');
    push(v, ix1, 0, iz1, P, h, iz2 - iz1, 'bwin');
    if (b.door === 3) { const cz = b.z + b.d / 2; push(v, ix2 - P, 0, iz1, P, h, cz - DW / 2 - iz1, 'bwin'); push(v, ix2 - P, 0, cz + DW / 2, P, h, iz2 - cz - DW / 2, 'bwin'); push(v, ix2 - P, DH, cz - DW / 2, P, h - DH, DW, 'bwin'); }
    else push(v, ix2 - P, 0, iz1, P, h, iz2 - iz1, 'bwin');
    // 계단실: 모서리 (x0,z0). x방향 SX = 입구띠 L0 + 9단×0.3 + 착지 1.4, z방향 SZ = 레인 1.3 + 0.2 + 레인 1.3
    const x0 = ix1, z0 = iz1;
    // 층 슬래브(k=1..nF-1)와 옥상(k=nF): 계단실 위(x0+L0~x0+SX)는 뚫림. 구멍 둘레 난간(충돌 있음)
    for (let k = 1; k <= b.nF; k++) {
      const y = k * F - SLAB, kind = k === b.nF ? 'broof' : 'bfloor';
      push(s, ix1, y, iz1, L0, SLAB, SZ, kind);                        // 입구 띠 (계단 도착 → 층 진입)
      push(s, x0 + SX, y, iz1, ix2 - (x0 + SX), SLAB, SZ, kind);        // 계단실 오른쪽
      push(s, ix1, y, z0 + SZ, ix2 - ix1, SLAB, iz2 - (z0 + SZ), kind); // 나머지 실내
      push(s, x0 + L0, k * F, z0 + SZ - 0.06, SX - L0, RAIL, 0.06, 'brail');
      push(s, x0 + SX - 0.06, k * F, z0, 0.06, RAIL, SZ, 'brail');
      // 옥상에서는 다음 층 계단이 없으므로 1번 레인 시작 자리도 막음(해치 구멍으로 추락 방지)
      if (k === b.nF) push(s, x0 + L0, k * F, z0, 0.06, RAIL, LANE, 'brail');
    }
    // 계단 (k=0..nF-1): A런(레인1, +x, 0.2씩 9단) → 착지(1.8) → B런(레인2, -x, 2.0~3.6) → 입구 띠
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
