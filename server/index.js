'use strict';
// WebSniper 서버: 정적 파일 + WebSocket 게임 서버
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Game } = require('./game');

const PORT = parseInt(process.env.PORT || '3000', 10);
const BOTS = parseInt(process.env.BOTS || '6', 10);
const SEED = process.env.SEED ? parseInt(process.env.SEED, 10) : undefined;

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  if (url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  let file;
  if (url.startsWith('/shared/')) file = path.join(ROOT, url);
  else if (url === '/vendor/three.module.js' || url === '/vendor/three.core.js') file = path.join(ROOT, 'node_modules', 'three', 'build', path.basename(url));
  else file = path.join(ROOT, 'public', url);
  if (!file.startsWith(ROOT) || file.includes('..')) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const game = new Game({ bots: BOTS, seed: SEED });
const wss = new WebSocketServer({ server });
const clients = new Map(); // ws -> playerId

wss.on('connection', (ws) => {
  let pid = null;
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join' && pid === null) {
      const p = game.addPlayer(String(m.name || ''), false);
      pid = p.id; clients.set(ws, pid);
      ws.send(JSON.stringify({ t: 'welcome', id: pid, map: game.map, bots: game.botCount }));
      return;
    }
    if (pid === null) return;
    if (m.t === 'i') game.setInput(pid, m);
    else if (m.t === 'bots') { game.botCount = Math.max(0, Math.min(20, m.n | 0)); }
    else game.action(pid, m);
  });
  ws.on('close', () => { if (pid !== null) { game.removePlayer(pid); clients.delete(ws); } });
  ws.on('error', () => {});
});

// 60Hz 물리, 30Hz 전송
const DT = 1 / 60;
let acc = 0, last = process.hrtime.bigint(), sendTick = 0;
setInterval(() => {
  const now = process.hrtime.bigint();
  acc += Number(now - last) / 1e9; last = now;
  if (acc > 0.25) acc = 0.25;
  while (acc >= DT) {
    game.tick(DT); acc -= DT; sendTick++;
    if (sendTick % 2 === 0) broadcast();
  }
}, 8);

function broadcast() {
  if (clients.size === 0) { game.flushEvents(); return; }
  const snap = game.buildSnapshot();
  const base = JSON.stringify(snap).slice(0, -1); // 마지막 '}' 제거 후 개인 데이터 이어붙임
  for (const [ws, pid] of clients) {
    if (ws.readyState !== ws.OPEN) continue;
    const p = game.players.get(pid); if (!p) continue;
    const me = game.privatePlayer(p);
    const pev = game.priv.get(pid) || [];
    ws.send(base + ',"me":' + JSON.stringify(me) + ',"pev":' + JSON.stringify(pev) + '}');
  }
  game.flushEvents();
}

server.listen(PORT, () => {
  console.log(`WebSniper 서버 실행: http://localhost:${PORT}  (봇 ${BOTS}명, 시드 ${game.map.seed})`);
});
