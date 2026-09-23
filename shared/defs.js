// 서버/클라이언트 공용 아이템 정의 (단위: 미터, 초)
(function (root) {
  const DEFS = {
    // 저격총: dmg 위력, interval 발사 간격(초), mag 탄수, weight 무게(kg), vel 탄속(m/s), reload 재장전 시간
    RIFLES: {
      // recoil: 발사 시 시점이 위로 튀는 각도(라디안), bolt: 볼트액션(사격 후 볼트 조작 동안 조준경 해제)
      vss: { id: 'vss', name: 'VSS 빈토레즈', dmg: 34, interval: 0.45, mag: 10, weight: 2.6, vel: 560, reload: 2.2, rarity: 30, recoil: 0.03, desc: '반자동 · 저위력 · 빠른 연사' },
      svd: { id: 'svd', name: 'SVD 드라구노프', dmg: 52, interval: 0.75, mag: 10, weight: 4.3, vel: 830, reload: 2.8, rarity: 25, recoil: 0.045, desc: '반자동 · 밸런스' },
      m24: { id: 'm24', name: 'M24', dmg: 80, interval: 1.5, mag: 5, weight: 5.5, vel: 850, reload: 3.2, rarity: 20, recoil: 0.06, bolt: true, desc: '볼트액션' },
      awm: { id: 'awm', name: 'AWM', dmg: 112, interval: 1.8, mag: 5, weight: 6.5, vel: 920, reload: 3.6, rarity: 12, recoil: 0.07, bolt: true, desc: '볼트액션 · 고위력 · 고탄속' },
      m82: { id: 'm82', name: '바렛 M82', dmg: 140, interval: 1.2, mag: 10, weight: 14, vel: 860, reload: 4.5, rarity: 8, recoil: 0.09, desc: '반자동 대물저격 · 반동 큼 · 매우 무거움' },
    },
    BASE_ZOOM: 3, // 스코프 없을 때 조준경 배율
    SCOPES: {
      s4: { id: 's4', name: '4배율 스코프', zoom: 4, weight: 0.5, rarity: 30 },
      s8: { id: 's8', name: '8배율 스코프', zoom: 8, weight: 0.8, rarity: 25 },
      s12: { id: 's12', name: '12배율 스코프', zoom: 12, weight: 1.0, rarity: 15 },
      s16: { id: 's16', name: '16배율 스코프', zoom: 16, weight: 1.3, rarity: 8 },
      t6: { id: 't6', name: '열감지 6배율', zoom: 6, thermal: true, battery: 60, weight: 1.6, rarity: 14 },
      t10: { id: 't10', name: '열감지 10배율', zoom: 10, thermal: true, battery: 45, weight: 2.0, rarity: 8 },
    },
    VESTS: {
      v1: { id: 'v1', name: '방탄복 Lv1', lvl: 1, reduce: 0.25, dur: 60, weight: 2, rarity: 40 },
      v2: { id: 'v2', name: '방탄복 Lv2', lvl: 2, reduce: 0.40, dur: 100, weight: 4, rarity: 35 },
      v3: { id: 'v3', name: '방탄복 Lv3', lvl: 3, reduce: 0.55, dur: 150, weight: 7, rarity: 25 },
    },
    HELMETS: {
      h1: { id: 'h1', name: '방탄모 Lv1', lvl: 1, reduce: 0.30, dur: 40, weight: 1, rarity: 40 },
      h2: { id: 'h2', name: '방탄모 Lv2', lvl: 2, reduce: 0.45, dur: 70, weight: 1.5, rarity: 35 },
      h3: { id: 'h3', name: '방탄모 Lv3', lvl: 3, reduce: 0.60, dur: 100, weight: 2.5, rarity: 25 },
    },
    CONSUMABLES: {
      bandage: { id: 'bandage', name: '붕대', heal: 25, time: 2.0, weight: 0.2, rarity: 40, icon: '🩹' },
      medkit: { id: 'medkit', name: '구급상자', heal: 80, time: 5.0, weight: 1.0, rarity: 18, icon: '🧰' },
      drink: { id: 'drink', name: '스테미너 드링크', stamina: 100, boost: 30, time: 1.0, weight: 0.3, rarity: 27, icon: '🥤' },
      battery: { id: 'battery', name: '배터리', battery: 40, time: 1.5, weight: 0.3, rarity: 15, icon: '🔋' },
    },
    SPAWN_WEIGHTS: { rifle: 20, scope: 22, vest: 14, helmet: 14, consumable: 30 },
    BAG_SIZE: 8,
    QUICK_SLOTS: 5,
    // h 서있는 키, hc 웅크린 키, eye/eyeC 눈 높이, w 몸 폭, headH 머리 판정 높이, step 자동으로 올라설 수 있는 턱 높이
    PLAYER: { h: 1.8, hc: 1.1, eye: 1.65, eyeC: 0.95, w: 0.6, headH: 0.3, speed: 4.5, gravity: 20, jump: 6.6, step: 0.6, maxHp: 100, maxStamina: 100, climb: 3.2 },
    // 낙하 피해: 착지 속도가 safe(m/s)를 넘으면 초과분 1m/s당 perUnit 피해 (safe 12m/s ≈ 3.6m 낙하)
    FALL: { safe: 12, perUnit: 6 },
    BULLET_G: 2.5,      // 캐주얼 탄 낙차 (m/s²). 850m/s 총으로 300m 사격 시 약 0.15m — 거의 직선
    BULLET_G_REAL: 9.8, // 리얼 탄도 옵션 (300m에서 약 0.6m 낙차)
    MELEE: { dmg: 45, range: 2.2, cooldown: 0.7 },
    PICKUP_RANGE: 2.2,
    RESPAWN_TIME: 5,
    FOV: 75,
  };
  DEFS.TABLE = { rifle: DEFS.RIFLES, scope: DEFS.SCOPES, vest: DEFS.VESTS, helmet: DEFS.HELMETS, consumable: DEFS.CONSUMABLES };
  DEFS.def = function (type, id) { const t = DEFS.TABLE[type]; return t ? t[id] : null; };
  if (typeof module !== 'undefined' && module.exports) module.exports = DEFS; else root.DEFS = DEFS;
})(typeof self !== 'undefined' ? self : this);
