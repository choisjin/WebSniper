'use strict';
const DEFS = require('../shared/defs');
const { genMap } = require('./map');

const P = DEFS.PLAYER;
const BOT_NAMES = ['까마귀', '독수리', '살쾡이', '늑대', '여우', '매', '올빼미', '표범', '코브라', '하이에나', '재칼', '팔콘', '고스트', '레이븐', '섀도우', '바이퍼'];

// 선분 vs AABB(3D slab). 진입 t(0~1) 반환, 없으면 null
function segBox(x1, y1, z1, x2, y2, z2, b) {
  let tmin = 0, tmax = 1;
  const axes = [[x1, x2 - x1, b.x, b.x + b.w], [y1, y2 - y1, b.y, b.y + b.h], [z1, z2 - z1, b.z, b.z + b.d]];
  for (const [o, dl, lo, hi] of axes) {
    if (Math.abs(dl) < 1e-9) { if (o < lo || o > hi) return null; continue; }
    let t1 = (lo - o) / dl, t2 = (hi - o) / dl;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
function overlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y && a.z < b.z + b.d && a.z + a.d > b.z; }
function randn() { let u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function pickWeighted(table) {
  const arr = Object.values(table); const sum = arr.reduce((s, d) => s + (d.rarity || 1), 0);
  let r = Math.random() * sum; for (const d of arr) { r -= (d.rarity || 1); if (r <= 0) return d; } return arr[arr.length - 1];
}
// yaw/pitch -> 방향 벡터 (three.js 관례: yaw 0 = -z 방향)
function dirOf(yaw, pitch) { const c = Math.cos(pitch); return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c }; }
function yawTo(dx, dz) { return Math.atan2(-dx, -dz); }

class Game {
  constructor(opts = {}) {
    this.map = genMap(opts.seed || ((Math.random() * 1e9) | 0));
    this.players = new Map();
    this.items = new Map();
    this.bullets = [];
    this.events = [];
    this.priv = new Map();
    this.time = 0;
    this.uid = 1;
    this.botCount = opts.bots ?? 6;
    this.bulletG = DEFS.BULLET_G; // 캐주얼 기본, 'mode' 메시지로 리얼 탄도 전환
    this.targetItems = opts.items ?? 90;
    this.itemTimer = 0;
    this.tickNo = 0;
    for (let i = 0; i < this.targetItems; i++) this.spawnRandomItem();
  }

  // ---------- 위치 샘플링 ----------
  pbox(p, h) { const hh = h !== undefined ? h : (p.crouch ? P.hc : P.h); return { x: p.x - P.w / 2, y: p.y, z: p.z - P.w / 2, w: P.w, h: hh, d: P.w }; }
  solidsNear(box, pad = 0.5) {
    const out = [];
    for (const s of this.map.solids) if (s.x < box.x + box.w + pad && s.x + s.w > box.x - pad && s.y < box.y + box.h + pad && s.y + s.h > box.y - pad && s.z < box.z + box.d + pad && s.z + s.d > box.z - pad) out.push(s);
    return out;
  }
  randomPoint() {
    const surfs = this.map.surfaces;
    for (let tries = 0; tries < 30; tries++) {
      const s = Math.random() < 0.6 ? surfs[0] : surfs[1 + ((Math.random() * (surfs.length - 1)) | 0)];
      const pt = { x: s.x1 + Math.random() * (s.x2 - s.x1), y: s.y + 0.01, z: s.z1 + Math.random() * (s.z2 - s.z1) };
      const box = { x: pt.x - 0.4, y: pt.y, z: pt.z - 0.4, w: 0.8, h: 1.9, d: 0.8 };
      if (!this.solidsNear(box, 0).some(o => overlap(box, o))) return pt;
    }
    return { x: 0, y: 0.01, z: 0 };
  }

  // ---------- 플레이어 ----------
  addPlayer(name, bot = false) {
    const id = this.uid++;
    const p = {
      id, name: (name || '').trim().slice(0, 12) || (bot ? '봇' : '플레이어' + id), bot,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, crouch: false, onGround: false, onLadder: false,
      hp: P.maxHp, stamina: P.maxStamina, boostEnd: 0, dead: false, respawnAt: 0, kills: 0, deaths: 0,
      rifle: null, scope: null, vest: null, helmet: null, bag: [], quick: new Array(DEFS.QUICK_SLOTS).fill(null),
      input: { f: 0, b: 0, l: 0, r: 0, sp: 0, c: 0, j: 0 }, zoomed: false, weapon: 'rifle',
      cooldown: 0, reloadEnd: 0, meleeAt: -10, using: null, lastX: 0, lastZ: 0,
      ai: bot ? { tx: 0, tz: 0, think: 0, reactAt: null, target: null, skill: 0.35 + Math.random() * 0.55, pause: 0, stuck: 0, wantItem: null } : null,
    };
    this.players.set(id, p);
    this.priv.set(id, []);
    this.spawn(p);
    return p;
  }
  removePlayer(id) { this.players.delete(id); this.priv.delete(id); }

  spawn(p) {
    const pt = this.randomPoint();
    p.x = pt.x; p.y = pt.y; p.z = pt.z; p.vx = p.vy = p.vz = 0;
    p.yaw = Math.random() * Math.PI * 2; p.pitch = 0;
    p.hp = P.maxHp; p.stamina = P.maxStamina; p.dead = false; p.crouch = false;
    p.using = null; p.reloadEnd = 0; p.cooldown = 0; p.zoomed = false; p.boostEnd = 0; p.weapon = 'rifle';
    p.rifle = this.makeItem('rifle', 'vss');
    p.scope = null; p.vest = null; p.helmet = null;
    p.bag = [this.makeItem('consumable', 'bandage')];
    p.quick = new Array(DEFS.QUICK_SLOTS).fill(null); p.quick[0] = p.bag[0].uid;
    if (p.bot) {
      if (Math.random() < 0.6) p.rifle = this.makeItem('rifle', pickWeighted(DEFS.RIFLES).id);
      if (Math.random() < 0.5) p.scope = this.makeItem('scope', pickWeighted(DEFS.SCOPES).id);
      if (Math.random() < 0.3) p.vest = this.makeItem('vest', 'v1');
      p.ai.target = null; p.ai.reactAt = null; p.ai.tx = p.x; p.ai.tz = p.z; p.ai.wantItem = null;
    }
  }

  makeItem(type, id) {
    const d = DEFS.def(type, id); if (!d) return null;
    const it = { uid: this.uid++, type, id };
    if (type === 'rifle') it.ammo = d.mag;
    if (type === 'scope') it.battery = d.battery || 0;
    if (type === 'vest' || type === 'helmet') it.dur = d.dur;
    return it;
  }
  spawnRandomItem() {
    const weights = {}; for (const [k, v] of Object.entries(DEFS.SPAWN_WEIGHTS)) weights[k] = { id: k, rarity: v };
    const t = pickWeighted(weights).id;
    const d = pickWeighted(DEFS.TABLE[t]);
    const it = this.makeItem(t, d.id);
    const pt = this.randomPoint();
    it.x = pt.x; it.y = pt.y; it.z = pt.z;
    this.items.set(it.uid, it);
  }
  dropItem(p, it, spread = 1.2) {
    if (!it) return;
    it.x = p.x + (Math.random() * 2 - 1) * spread; it.z = p.z + (Math.random() * 2 - 1) * spread; it.y = p.y;
    const H = this.map.HALF - 1;
    it.x = Math.max(-H, Math.min(H, it.x)); it.z = Math.max(-H, Math.min(H, it.z));
    this.items.set(it.uid, it);
  }

  msg(p, text) { if (!p.bot) { const q = this.priv.get(p.id); if (q) q.push({ e: 'msg', text }); } }
  weight(p) {
    let w = 0;
    for (const e of [p.rifle, p.scope, p.vest, p.helmet]) if (e) w += DEFS.def(e.type, e.id).weight;
    for (const e of p.bag) w += DEFS.def(e.type, e.id).weight;
    return w;
  }
  zoomOf(p) { return p.scope ? DEFS.SCOPES[p.scope.id].zoom : DEFS.BASE_ZOOM; }
  eyeY(p) { return p.y + (p.crouch ? P.eyeC : P.eye); }

  // ---------- 입력/행동 ----------
  setInput(id, m) {
    const p = this.players.get(id); if (!p) return;
    p.input = { f: m.f ? 1 : 0, b: m.b ? 1 : 0, l: m.l ? 1 : 0, r: m.r ? 1 : 0, sp: m.sp ? 1 : 0, c: m.c ? 1 : 0, j: m.j ? 1 : 0 };
    if (typeof m.yaw === 'number' && isFinite(m.yaw)) p.yaw = m.yaw;
    if (typeof m.pitch === 'number' && isFinite(m.pitch)) p.pitch = Math.max(-1.5, Math.min(1.5, m.pitch));
    p.zoomed = !!m.z && p.weapon === 'rifle';
  }
  action(id, m) {
    const p = this.players.get(id); if (!p || p.dead) return;
    switch (m.t) {
      case 'fire': if (p.weapon === 'knife') this.melee(p); else this.fire(p); break;
      case 'reload': this.reload(p); break;
      case 'melee': this.melee(p); break;
      case 'weapon': this.selectWeapon(p, m); break;
      case 'pickup': this.pickup(p); break;
      case 'use': this.useQuick(p, m.slot | 0); break;
      case 'inv': this.invOp(p, m); break;
    }
  }

  // 무기 전환: {w:'knife'} 또는 {w:'rifle', uid?} (uid가 가방의 총이면 장착 교체)
  selectWeapon(p, m) {
    if (m.w === 'knife') { p.weapon = 'knife'; p.zoomed = false; return; }
    if (m.uid != null && (!p.rifle || p.rifle.uid !== m.uid)) {
      const idx = p.bag.findIndex(b => b.uid === m.uid && b.type === 'rifle'); if (idx < 0) return;
      const it = p.bag.splice(idx, 1)[0];
      if (p.rifle) p.bag.push(p.rifle);
      p.rifle = it; p.reloadEnd = 0; p.cooldown = 0.4;
    }
    if (p.rifle) p.weapon = 'rifle';
  }
  fire(p, spreadDeg = null) {
    if (p.dead || !p.rifle || p.weapon !== 'rifle' || p.cooldown > 0 || p.reloadEnd > this.time || p.using) return false;
    if (p.rifle.ammo <= 0) { this.reload(p); return false; }
    const d = DEFS.RIFLES[p.rifle.id];
    p.rifle.ammo--; p.cooldown = d.interval;
    const spread = (spreadDeg !== null ? spreadDeg : (p.zoomed ? 0 : 3)) * Math.PI / 180;
    const dir = dirOf(p.yaw + (Math.random() * 2 - 1) * spread, p.pitch + (Math.random() * 2 - 1) * spread);
    const ey = this.eyeY(p);
    const mx = p.x + dir.x * 0.6, my = ey - 0.1 + dir.y * 0.6, mz = p.z + dir.z * 0.6;
    this.bullets.push({ uid: this.uid++, x: mx, y: my, z: mz, px: mx, py: my, pz: mz, vx: dir.x * d.vel, vy: dir.y * d.vel, vz: dir.z * d.vel, owner: p.id, dmg: d.dmg, rifle: p.rifle.id, life: 3 });
    this.events.push({ e: 'shot', x: +mx.toFixed(2), y: +my.toFixed(2), z: +mz.toFixed(2), by: p.id });
    return true;
  }
  reload(p) {
    if (!p.rifle || p.reloadEnd > this.time || p.using) return;
    const d = DEFS.RIFLES[p.rifle.id];
    if (p.rifle.ammo >= d.mag) return;
    p.reloadEnd = this.time + d.reload;
  }
  melee(p) {
    if (this.time - p.meleeAt < DEFS.MELEE.cooldown || p.using) return;
    p.meleeAt = this.time;
    this.events.push({ e: 'melee', id: p.id });
    const dir = dirOf(p.yaw, 0);
    for (const q of this.players.values()) {
      if (q === p || q.dead) continue;
      const dx = q.x - p.x, dz = q.z - p.z, dist = Math.hypot(dx, dz);
      if (dist <= DEFS.MELEE.range && Math.abs(q.y - p.y) < 1.5 && (dx * dir.x + dz * dir.z) / Math.max(0.01, dist) > 0.3) {
        this.damage(q, p, DEFS.MELEE.dmg, false, 'knife', q.x, q.y + 1.2, q.z);
      }
    }
  }
  nearestItem(p, range = DEFS.PICKUP_RANGE) {
    let best = null, bd = range;
    for (const it of this.items.values()) {
      const d = Math.hypot(it.x - p.x, it.y - p.y, it.z - p.z);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }
  pickup(p) {
    const it = this.nearestItem(p); if (!it) return false;
    const slotKey = { rifle: 'rifle', scope: 'scope', vest: 'vest', helmet: 'helmet' }[it.type];
    if (slotKey && !p[slotKey]) {
      this.items.delete(it.uid); delete it.x; delete it.y; delete it.z; p[slotKey] = it;
    } else {
      if (p.bag.length >= DEFS.BAG_SIZE) { this.msg(p, '가방이 가득 찼습니다'); return false; }
      this.items.delete(it.uid); delete it.x; delete it.y; delete it.z; p.bag.push(it);
      if (it.type === 'consumable') { const s = p.quick.indexOf(null); if (s >= 0) p.quick[s] = it.uid; }
    }
    const q = this.priv.get(p.id); if (q) q.push({ e: 'pickup', name: DEFS.def(it.type, it.id).name });
    return true;
  }
  useQuick(p, slot) {
    const uid = p.quick[slot]; if (!uid) return;
    const it = p.bag.find(b => b.uid === uid); if (!it) { p.quick[slot] = null; return; }
    this.useItem(p, it);
  }
  useItem(p, it) {
    if (p.using || p.reloadEnd > this.time) return;
    const d = DEFS.CONSUMABLES[it.id]; if (!d) return;
    if (d.heal && p.hp >= P.maxHp) { this.msg(p, '체력이 이미 최대입니다'); return; }
    if (d.battery && !(p.scope && DEFS.SCOPES[p.scope.id].thermal)) { this.msg(p, '열감지 스코프가 필요합니다'); return; }
    p.using = { uid: it.uid, name: d.name, end: this.time + d.time, start: this.time };
  }
  finishUse(p) {
    const u = p.using; p.using = null;
    const idx = p.bag.findIndex(b => b.uid === u.uid); if (idx < 0) return;
    const it = p.bag[idx]; const d = DEFS.CONSUMABLES[it.id];
    if (d.heal) p.hp = Math.min(P.maxHp, p.hp + d.heal);
    if (d.stamina) { p.stamina = P.maxStamina; p.boostEnd = this.time + d.boost; }
    if (d.battery && p.scope) p.scope.battery = Math.min((DEFS.SCOPES[p.scope.id].battery || 0) + 20, p.scope.battery + d.battery);
    p.bag.splice(idx, 1);
    p.quick = p.quick.map(q => q === it.uid ? null : q);
    const same = p.bag.find(b => b.type === 'consumable' && b.id === it.id && !p.quick.includes(b.uid));
    if (same) { const s = p.quick.indexOf(null); if (s >= 0) p.quick[s] = same.uid; }
  }
  invOp(p, m) {
    const kinds = ['rifle', 'scope', 'vest', 'helmet'];
    if (m.op === 'equip') {
      const idx = p.bag.findIndex(b => b.uid === m.uid); if (idx < 0) return;
      const it = p.bag[idx];
      if (it.type === 'consumable') { this.useItem(p, it); return; }
      const cur = p[it.type];
      p.bag.splice(idx, 1);
      if (cur) p.bag.push(cur);
      p[it.type] = it;
      if (it.type === 'rifle') { p.reloadEnd = 0; p.cooldown = 0.3; p.weapon = 'rifle'; }
    } else if (m.op === 'unequip') {
      if (!kinds.includes(m.kind) || !p[m.kind]) return;
      if (p.bag.length >= DEFS.BAG_SIZE) { this.msg(p, '가방이 가득 찼습니다'); return; }
      p.bag.push(p[m.kind]); p[m.kind] = null;
    } else if (m.op === 'drop') {
      if (m.kind && kinds.includes(m.kind)) { if (p[m.kind]) { this.dropItem(p, p[m.kind]); p[m.kind] = null; } return; }
      const idx = p.bag.findIndex(b => b.uid === m.uid); if (idx < 0) return;
      const it = p.bag.splice(idx, 1)[0];
      p.quick = p.quick.map(q => q === it.uid ? null : q);
      if (p.using && p.using.uid === it.uid) p.using = null;
      this.dropItem(p, it);
    } else if (m.op === 'quick') {
      const slot = m.slot | 0; if (slot < 0 || slot >= DEFS.QUICK_SLOTS) return;
      if (m.uid == null) { p.quick[slot] = null; return; }
      const it = p.bag.find(b => b.uid === m.uid); if (!it || it.type !== 'consumable') return;
      p.quick = p.quick.map(q => q === it.uid ? null : q);
      p.quick[slot] = it.uid;
    }
  }

  // ---------- 피해/사망 ----------
  damage(q, by, base, head, cause, hx, hy, hz, ignoreArmor = false) {
    let dmg = base * (head ? 2.2 : 1);
    const armor = ignoreArmor ? null : (head ? q.helmet : q.vest);
    if (armor) {
      const ad = DEFS.def(armor.type, armor.id);
      dmg *= (1 - ad.reduce);
      armor.dur -= base * 0.6;
      if (armor.dur <= 0) { if (head) q.helmet = null; else q.vest = null; this.msg(q, ad.name + ' 파손!'); }
    }
    q.hp -= dmg;
    this.events.push({ e: 'hit', x: +hx.toFixed(2), y: +hy.toFixed(2), z: +hz.toFixed(2), head: head ? 1 : 0, by: by ? by.id : 0, victim: q.id, dmg: Math.round(dmg) });
    if (q.hp <= 0) this.kill(q, by, cause, head);
  }
  kill(q, by, cause, head) {
    q.dead = true; q.hp = 0; q.respawnAt = this.time + DEFS.RESPAWN_TIME; q.deaths++;
    q.using = null; q.zoomed = false;
    if (by && by !== q) by.kills++;
    for (const k of ['rifle', 'scope', 'vest', 'helmet']) if (q[k]) { this.dropItem(q, q[k], 1.5); q[k] = null; }
    for (const it of q.bag) this.dropItem(q, it, 1.5);
    q.bag = []; q.quick.fill(null);
    if (q.ai) { q.ai.target = null; q.ai.reactAt = null; }
    this.events.push({ e: 'kill', killer: by ? by.id : 0, kn: by ? by.name : '', victim: q.id, vn: q.name, cause, head: head ? 1 : 0 });
  }

  // ---------- 물리 ----------
  moveAxis(p, axis, delta, h) {
    if (delta === 0) return;
    p[axis] += delta;
    let box = this.pbox(p, h);
    for (const s of this.solidsNear(box, 0)) {
      if (!overlap(box, s)) continue;
      if (axis === 'y') {
        if (delta < 0) {
          p.y = s.y + s.h; p.onGround = true;
          // 낙하 피해
          const over = -p.vy - DEFS.FALL.safe;
          if (over > 0) { const dmg = over * DEFS.FALL.perUnit * (p.bot ? 0.5 : 1); this.damage(p, null, dmg, false, 'fall', p.x, p.y + 0.5, p.z, true); }
        } else p.y = s.y - h - 0.001;
        p.vy = 0;
      } else {
        // 낮은 턱은 자동으로 올라섬
        const top = s.y + s.h;
        if (top - p.y > 0 && top - p.y <= P.step && p.vy <= 0.01) {
          const test = Object.assign({}, box, { y: top + 0.001, h });
          if (!this.solidsNear(test, 0).some(o => overlap(test, o))) { p.y = top + 0.001; box = test; p.onGround = true; continue; }
        }
        if (axis === 'x') p.x = delta > 0 ? s.x - P.w / 2 - 0.001 : s.x + s.w + P.w / 2 + 0.001;
        else p.z = delta > 0 ? s.z - P.w / 2 - 0.001 : s.z + s.d + P.w / 2 + 0.001;
      }
      box = this.pbox(p, h);
    }
  }
  movePlayer(p, dt) {
    const inp = p.input;
    const boost = p.boostEnd > this.time;
    if (inp.c) p.crouch = true;
    else if (p.crouch) { const r = this.pbox(p, P.h); if (!this.solidsNear(r, 0).some(s => overlap(r, s))) p.crouch = false; }
    const h = p.crouch ? P.hc : P.h;
    const wmul = Math.max(0.45, 1 - 0.028 * this.weight(p));
    let speed = P.speed * wmul;
    if (p.crouch) speed *= 0.5;
    if (p.zoomed) speed *= 0.5;
    if (p.using) speed *= 0.5;
    const fw = inp.f - inp.b, rt = inp.r - inp.l;
    const moving = fw !== 0 || rt !== 0;
    const sprinting = inp.sp && fw > 0 && !p.crouch && !p.zoomed && p.stamina > 0;
    if (sprinting) { speed *= 1.6; p.stamina = Math.max(0, p.stamina - 22 * dt); }
    else p.stamina = Math.min(P.maxStamina, p.stamina + (boost ? 28 : 10) * dt);
    let mx = 0, mz = 0;
    if (moving) {
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      mx = fx * fw + rx * rt; mz = fz * fw + rz * rt;
      const len = Math.hypot(mx, mz); mx /= len; mz /= len;
    }
    p.vx = mx * speed; p.vz = mz * speed;
    // 사다리: 구역 안에서 앞(W)=오르기, 뒤(S)=내리기, 손 떼면 매달림. 옥상 높이를 넘으면 앞으로 걸어 올라섬
    const box0 = this.pbox(p, h);
    const lad = this.map.ladders.find(l => overlap(box0, l));
    p.onLadder = !!lad && !inp.j;
    if (p.onLadder) {
      p.vy = fw * P.climb;
      const capY = lad.top + 0.4; // 발이 옥상보다 살짝 위까지 올라가야 앞으로 걸어 올라설 수 있음
      if (p.y + p.vy * dt > capY) p.vy = Math.max(0, (capY - p.y) / dt);
      // 앞/뒤 입력은 오르내리기에만 쓰고 수평 이동은 좌우(strafe)만 허용. 옥상 높이에 닿았을 때만 앞으로 걸어 올라섬
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      const fwdOK = fw > 0 && p.y >= lad.top - 0.05 ? fw : 0;
      p.vx = (rx * rt + fx * fwdOK) * speed * 0.6; p.vz = (rz * rt + fz * fwdOK) * speed * 0.6;
    } else {
      if (inp.j && (p.onGround || lad) && !p.crouch) { p.vy = P.jump; p.stamina = Math.max(0, p.stamina - 8); }
      p.vy -= P.gravity * dt;
    }
    p.onGround = false;
    this.moveAxis(p, 'x', p.vx * dt, h);
    this.moveAxis(p, 'z', p.vz * dt, h);
    this.moveAxis(p, 'y', p.vy * dt, h);
    const H = this.map.HALF - 0.5;
    p.x = Math.max(-H, Math.min(H, p.x)); p.z = Math.max(-H, Math.min(H, p.z));
    if (p.y < -3) { p.y = 0.01; p.vy = 0; }
  }

  stepBullets(dt) {
    const alive = [];
    for (const b of this.bullets) {
      b.px = b.x; b.py = b.y; b.pz = b.z;
      b.vy -= this.bulletG * dt;
      const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt, nz = b.z + b.vz * dt;
      let bt = 1, hitP = null, hitS = false;
      const seg = { x: Math.min(b.x, nx), y: Math.min(b.y, ny), z: Math.min(b.z, nz), w: Math.abs(nx - b.x), h: Math.abs(ny - b.y), d: Math.abs(nz - b.z) };
      for (const s of this.solidsNear(seg, 0.1)) { const t = segBox(b.x, b.y, b.z, nx, ny, nz, s); if (t !== null && t < bt) { bt = t; hitS = true; hitP = null; } }
      for (const q of this.players.values()) {
        if (q.dead || q.id === b.owner) continue;
        const t = segBox(b.x, b.y, b.z, nx, ny, nz, this.pbox(q));
        if (t !== null && t < bt) { bt = t; hitP = q; hitS = false; }
      }
      if (hitP || hitS) {
        const hx = b.x + (nx - b.x) * bt, hy = b.y + (ny - b.y) * bt, hz = b.z + (nz - b.z) * bt;
        if (hitP) {
          const h = hitP.crouch ? P.hc : P.h;
          const head = hy > hitP.y + h - P.headH;
          this.damage(hitP, this.players.get(b.owner), b.dmg, head, b.rifle, hx, hy, hz);
        } else this.events.push({ e: 'impact', x: +hx.toFixed(2), y: +hy.toFixed(2), z: +hz.toFixed(2) });
        this.events.push({ e: 'tracer', a: [+b.px.toFixed(2), +b.py.toFixed(2), +b.pz.toFixed(2)], b: [+hx.toFixed(2), +hy.toFixed(2), +hz.toFixed(2)] });
        continue;
      }
      b.x = nx; b.y = ny; b.z = nz; b.life -= dt;
      const L = this.map.HALF + 400;
      if (b.life > 0 && Math.abs(b.x) < L && Math.abs(b.z) < L && b.y > -5) alive.push(b);
    }
    this.bullets = alive;
  }

  // ---------- 봇 AI ----------
  hasLOS(x1, y1, z1, x2, y2, z2) {
    const seg = { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), d: Math.abs(z2 - z1) };
    for (const s of this.solidsNear(seg, 0)) if (segBox(x1, y1, z1, x2, y2, z2, s) !== null) return false;
    return true;
  }
  botThink(p, dt) {
    const ai = p.ai; const inp = { f: 0, b: 0, l: 0, r: 0, sp: 0, c: 0 };
    ai.think -= dt;
    const ey = this.eyeY(p);
    if (ai.think <= 0) {
      ai.think = 0.25;
      const range = 120 + this.zoomOf(p) * 18;
      let best = null, bd = range;
      for (const q of this.players.values()) {
        if (q === p || q.dead) continue;
        const qh = q.crouch ? P.hc : P.h;
        const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
        if (d < bd && this.hasLOS(p.x, ey, p.z, q.x, q.y + qh * 0.6, q.z)) { bd = d; best = q; }
      }
      if (best !== ai.target) { ai.target = best; ai.reactAt = best ? this.time + (1.3 - ai.skill * 0.9) + Math.random() * 0.3 : null; }
      const it = this.nearestItem(p, 2);
      if (it) this.botConsiderItem(p, it);
      if (!ai.target && !ai.wantItem && Math.random() < 0.3) {
        for (const cand of this.items.values()) {
          if (Math.hypot(cand.x - p.x, cand.z - p.z) < 25 && Math.abs(cand.y - p.y) < 1 && this.botWants(p, cand)) { ai.wantItem = cand.uid; ai.tx = cand.x; ai.tz = cand.z; break; }
        }
      }
      if (ai.wantItem && !this.items.has(ai.wantItem)) ai.wantItem = null;
      if (p.hp < 55 && !p.using && (!ai.target || Math.random() < 0.3)) {
        const heal = p.bag.find(b => b.type === 'consumable' && DEFS.CONSUMABLES[b.id].heal);
        if (heal) this.useItem(p, heal);
      }
      if (p.rifle && p.rifle.ammo === 0) this.reload(p);
    }
    const t = ai.target;
    if (t && !t.dead) {
      const th = t.crouch ? P.hc : P.h;
      const dx = t.x - p.x, dz = t.z - p.z, hd = Math.hypot(dx, dz);
      const dist = Math.hypot(hd, t.y + th * 0.6 - ey);
      p.zoomed = true;
      if (dist > 40 && p.onGround) inp.c = 1;
      const d = DEFS.RIFLES[p.rifle ? p.rifle.id : 'vss'];
      const tof = dist / d.vel;
      const drop = 0.5 * this.bulletG * tof * tof;
      const err = dist * (0.012 - 0.0095 * ai.skill);
      const lead = tof * (0.5 + ai.skill * 0.5);
      const ax = t.x + t.vx * lead + randn() * err, ay = t.y + th * 0.6 + drop + randn() * err, az = t.z + t.vz * lead + randn() * err;
      p.yaw = yawTo(ax - p.x, az - p.z);
      p.pitch = Math.atan2(ay - ey, Math.hypot(ax - p.x, az - p.z));
      if (this.time >= ai.reactAt && p.rifle && p.rifle.ammo > 0 && !p.using) {
        if (dist < 2.5 && Math.random() < 0.5) this.melee(p);
        else this.fire(p, 0);
      }
      if (dist < 4 && !p.using) inp.f = 1;
    } else {
      p.zoomed = false; p.pitch = 0;
      if (ai.pause > 0) ai.pause -= dt;
      else {
        const H = this.map.HALF - 5;
        const ddx = ai.tx - p.x, ddz = ai.tz - p.z, dd = Math.hypot(ddx, ddz);
        if (dd < 1.2) {
          if (ai.wantItem) { this.pickup(p); ai.wantItem = null; }
          if (Math.random() < 0.4) ai.pause = 1 + Math.random() * 3;
          ai.tx = Math.max(-H, Math.min(H, p.x + (Math.random() * 2 - 1) * 60));
          ai.tz = Math.max(-H, Math.min(H, p.z + (Math.random() * 2 - 1) * 60));
        } else {
          p.yaw = yawTo(ddx, ddz); inp.f = 1;
          if (Math.random() < 0.01) inp.sp = 1;
          if (Math.hypot(p.x - p.lastX, p.z - p.lastZ) < 0.01) ai.stuck += dt; else ai.stuck = 0;
          if (ai.stuck > 0.8) { ai.stuck = 0; ai.wantItem = null; ai.tx = p.x + (Math.random() * 2 - 1) * 30; ai.tz = p.z + (Math.random() * 2 - 1) * 30; }
        }
      }
    }
    p.lastX = p.x; p.lastZ = p.z;
    p.input = inp;
  }
  botWants(p, it) {
    const d = DEFS.def(it.type, it.id); const cur = p[it.type];
    if (it.type === 'rifle') return !cur || DEFS.RIFLES[cur.id].dmg < d.dmg;
    if (it.type === 'scope') return !cur || DEFS.SCOPES[cur.id].zoom < d.zoom;
    if (it.type === 'vest' || it.type === 'helmet') return !cur || DEFS.def(cur.type, cur.id).lvl < d.lvl;
    return p.bag.length < DEFS.BAG_SIZE && !!d.heal;
  }
  botConsiderItem(p, it) {
    if (!this.botWants(p, it)) return;
    const cur = p[it.type];
    if (it.type !== 'consumable' && cur) { this.dropItem(p, cur, 1); p[it.type] = null; }
    this.pickup(p);
  }

  // ---------- 틱 ----------
  tick(dt) {
    this.time += dt; this.tickNo++;
    const bots = [...this.players.values()].filter(p => p.bot);
    if (bots.length < this.botCount) this.addPlayer(BOT_NAMES[(Math.random() * BOT_NAMES.length) | 0] + '-' + ((Math.random() * 90 + 10) | 0), true);
    else if (bots.length > this.botCount) this.removePlayer(bots[bots.length - 1].id);

    for (const p of this.players.values()) {
      if (p.dead) { if (this.time >= p.respawnAt) this.spawn(p); continue; }
      if (p.bot) this.botThink(p, dt);
      if (p.cooldown > 0) p.cooldown -= dt;
      if (p.reloadEnd && this.time >= p.reloadEnd) { p.reloadEnd = 0; if (p.rifle) p.rifle.ammo = DEFS.RIFLES[p.rifle.id].mag; }
      if (p.using && this.time >= p.using.end) this.finishUse(p);
      if (p.zoomed && p.scope) { const sd = DEFS.SCOPES[p.scope.id]; if (sd.thermal && p.scope.battery > 0) p.scope.battery = Math.max(0, p.scope.battery - dt); }
      this.movePlayer(p, dt);
    }
    this.stepBullets(dt);
    this.itemTimer -= dt;
    if (this.itemTimer <= 0) { this.itemTimer = 2.5; if (this.items.size < this.targetItems) this.spawnRandomItem(); }
    if (this.items.size > this.targetItems + 60) { const k = this.items.keys().next().value; this.items.delete(k); }
  }

  // ---------- 스냅샷 ----------
  publicPlayer(p) {
    return {
      id: p.id, n: p.name, b: p.bot ? 1 : 0, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yw: +p.yaw.toFixed(3), pt: +p.pitch.toFixed(3),
      c: p.crouch ? 1 : 0, hp: Math.max(0, Math.round(p.hp)), d: p.dead ? 1 : 0, zm: p.zoomed ? 1 : 0, k: p.kills, dt: p.deaths,
      r: p.rifle ? p.rifle.id : null, v: p.vest ? DEFS.VESTS[p.vest.id].lvl : 0, hm: p.helmet ? DEFS.HELMETS[p.helmet.id].lvl : 0,
      m: +(this.time - p.meleeAt).toFixed(2), u: p.using ? 1 : 0, rl: p.reloadEnd > this.time ? 1 : 0, w: p.weapon === 'knife' ? 1 : 0, l: p.onLadder ? 1 : 0,
    };
  }
  privatePlayer(p) {
    const near = this.nearestItem(p);
    return {
      hp: p.hp, st: p.stamina, boost: p.boostEnd > this.time, dead: p.dead, respawnIn: p.dead ? Math.max(0, p.respawnAt - this.time) : 0,
      rifle: p.rifle, scope: p.scope, vest: p.vest, helmet: p.helmet, bag: p.bag, quick: p.quick,
      reload: p.reloadEnd > this.time ? p.reloadEnd - this.time : 0,
      using: p.using ? { name: p.using.name, left: p.using.end - this.time, total: p.using.end - p.using.start } : null,
      weight: +this.weight(p).toFixed(1), zoom: this.zoomOf(p), thermal: !!(p.scope && DEFS.SCOPES[p.scope.id].thermal && p.scope.battery > 0),
      kills: p.kills, deaths: p.deaths, crouch: p.crouch, weapon: p.weapon, near: near ? { uid: near.uid, type: near.type, id: near.id } : null,
    };
  }
  buildSnapshot() {
    return {
      t: 's', time: +this.time.toFixed(3), bots: this.botCount,
      players: [...this.players.values()].map(p => this.publicPlayer(p)),
      items: [...this.items.values()].map(it => ({ u: it.uid, t: it.type, d: it.id, x: +it.x.toFixed(2), y: +it.y.toFixed(2), z: +it.z.toFixed(2) })),
      bullets: this.bullets.map(b => ({ u: b.uid, a: [+b.px.toFixed(2), +b.py.toFixed(2), +b.pz.toFixed(2)], b: [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)] })),
      ev: this.events,
    };
  }
  flushEvents() { this.events = []; for (const k of this.priv.keys()) this.priv.set(k, []); }
}

module.exports = { Game, segBox };
