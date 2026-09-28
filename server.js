import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Server } from 'socket.io';
import { isWalkable, SPAWN } from './public/js/map.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || 'turbopartners.com.br,turbopartners.com')
  .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
const SESSION_DAYS = 30;
const COOKIE = 'to_session';

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, '.secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();

// ---------------------------------------------------------------- Banco
const db = new DatabaseSync(path.join(DATA_DIR, 'turbo-office.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    pass TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT '{}',
    x INTEGER, y INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    from_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel, id);
`);

const q = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  allUsers: db.prepare('SELECT id, name, avatar FROM users ORDER BY name'),
  insertUser: db.prepare('INSERT INTO users (email, name, pass, avatar, created_at) VALUES (?, ?, ?, ?, ?)'),
  updateProfile: db.prepare('UPDATE users SET name = ?, avatar = ? WHERE id = ?'),
  savePos: db.prepare('UPDATE users SET x = ?, y = ? WHERE id = ?'),
  insertMsg: db.prepare('INSERT INTO messages (channel, from_id, text, created_at) VALUES (?, ?, ?, ?)'),
  history: db.prepare('SELECT id, channel, from_id AS "from", text, created_at AS ts FROM messages WHERE channel = ? ORDER BY id DESC LIMIT 100'),
  dmChannels: db.prepare(`SELECT DISTINCT channel FROM messages WHERE channel LIKE 'dm:%' AND (channel LIKE ? OR channel LIKE ?)`),
};

// ---------------------------------------------------------------- Helpers
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}
function signSession(uid) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}
function verifySession(token) {
  if (!token) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data.uid : null;
  } catch { return null; }
}
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function sessionUser(cookieHeader) {
  const uid = verifySession(parseCookies(cookieHeader)[COOKIE]);
  return uid ? q.userById.get(uid) : null;
}
function setSessionCookie(req, res, uid) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${signSession(uid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}
function emailAllowed(email) {
  const domain = email.split('@')[1] || '';
  return ALLOWED_DOMAINS.includes(domain);
}

const HEX = /^#[0-9a-f]{6}$/i;
const AVATAR_DEFAULT = { skin: '#f1c7a1', hair: '#3b2a20', hairStyle: 0, shirt: '#22d3ee', pants: '#1f2a44' };
function cleanAvatar(a = {}) {
  const out = { ...AVATAR_DEFAULT };
  for (const k of ['skin', 'hair', 'shirt', 'pants']) if (typeof a[k] === 'string' && HEX.test(a[k])) out[k] = a[k];
  if (Number.isInteger(a.hairStyle) && a.hairStyle >= 0 && a.hairStyle <= 4) out.hairStyle = a.hairStyle;
  return out;
}
function cleanName(n) {
  return typeof n === 'string' ? n.replace(/\s+/g, ' ').trim().slice(0, 32) : '';
}
function randomAvatar() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  return {
    skin: pick(['#f6d7b8', '#f1c7a1', '#d9a47a', '#b97d52', '#8d5a3b', '#5c3a26']),
    hair: pick(['#1b1b1b', '#3b2a20', '#6b4423', '#b5793d', '#e0c068', '#8a8a8a']),
    hairStyle: Math.floor(Math.random() * 5),
    shirt: pick(['#22d3ee', '#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#8b5cf6', '#0ea5e9']),
    pants: pick(['#1f2a44', '#334155', '#3f3f46', '#1e3a5f']),
  };
}
const publicUser = (u) => ({ id: u.id, name: u.name, avatar: JSON.parse(u.avatar) });

// ---------------------------------------------------------------- HTTP
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));

app.get('/', (req, res) => {
  if (!sessionUser(req.headers.cookie)) return res.redirect('/login');
  res.sendFile(path.join(PUBLIC, 'app.html'));
});
app.get('/login', (req, res) => {
  if (sessionUser(req.headers.cookie)) return res.redirect('/');
  res.sendFile(path.join(PUBLIC, 'login.html'));
});
app.use(express.static(PUBLIC, { index: false }));

// Proteção simples contra força bruta no login.
const attempts = new Map();
function rateLimited(key) {
  const now = Date.now();
  const a = (attempts.get(key) || []).filter((t) => now - t < 10 * 60e3);
  a.push(now);
  attempts.set(key, a);
  return a.length > 20;
}

app.post('/api/register', (req, res) => {
  const name = cleanName(req.body?.name);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (rateLimited(`reg:${req.ip}`)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  if (!name) return res.status(400).json({ error: 'Informe seu nome.' });
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido.' });
  if (!emailAllowed(email)) return res.status(403).json({ error: `Apenas e-mails ${ALLOWED_DOMAINS.map((d) => '@' + d).join(' ou ')} podem entrar.` });
  if (password.length < 8) return res.status(400).json({ error: 'A senha precisa ter pelo menos 8 caracteres.' });
  if (q.userByEmail.get(email)) return res.status(409).json({ error: 'Esse e-mail já tem conta. Faça login.' });
  const info = q.insertUser.run(email, name, hashPassword(password), JSON.stringify(randomAvatar()), Date.now());
  const uid = Number(info.lastInsertRowid);
  setSessionCookie(req, res, uid);
  io.emit('user:new', publicUser(q.userById.get(uid)));
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (rateLimited(`login:${req.ip}`)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  const u = q.userByEmail.get(email);
  if (!u || !checkPassword(password, u.pass)) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  if (!emailAllowed(email)) return res.status(403).json({ error: 'Domínio de e-mail não autorizado.' });
  setSessionCookie(req, res, u.id);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const u = sessionUser(req.headers.cookie);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  res.json({ ...publicUser(u), email: u.email });
});

// ---------------------------------------------------------------- Tempo real
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 64 * 1024 });

const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
if (process.env.TURN_URL) {
  ICE_SERVERS.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
}

const online = new Map(); // userId -> player
const STATUSES = new Set(['available', 'busy', 'away']);
const EMOTES = new Set(['👋', '👍', '❤️', '😂', '🎉', '✋', '👏', '🤔']);

// Nasce num tile livre perto da recepção, para ninguém ficar empilhado.
function spawnPoint() {
  const taken = new Set([...online.values()].map((p) => `${p.x},${p.y}`));
  for (let r = 0; r <= 6; r++) {
    const free = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = SPAWN.x + dx, y = SPAWN.y + dy;
      if (isWalkable(x, y) && !taken.has(`${x},${y}`)) free.push({ x, y });
    }
    if (free.length) return free[Math.floor(Math.random() * free.length)];
  }
  return SPAWN;
}

const pub = (p) => ({ id: p.id, name: p.name, avatar: p.avatar, x: p.x, y: p.y, dir: p.dir, status: p.status, statusText: p.statusText, media: p.media });
const dmKey = (a, b) => `dm:${Math.min(a, b)}:${Math.max(a, b)}`;

io.use((socket, next) => {
  const u = sessionUser(socket.handshake.headers.cookie);
  if (!u) return next(new Error('unauthorized'));
  socket.data.uid = u.id;
  next();
});

io.on('connection', (socket) => {
  const u = q.userById.get(socket.data.uid);
  if (!u) return socket.disconnect(true);

  const prev = online.get(u.id);
  if (prev) { prev.socket.emit('kicked'); prev.socket.disconnect(true); }

  const spawn = u.x != null && isWalkable(u.x, u.y) ? { x: u.x, y: u.y } : spawnPoint();
  const p = {
    id: u.id, name: u.name, avatar: JSON.parse(u.avatar),
    x: spawn.x, y: spawn.y, dir: 'down',
    status: 'available', statusText: '', media: { mic: false, cam: false, screen: false }, socket,
  };
  online.set(u.id, p);
  socket.join(`u:${u.id}`);

  const dmChannels = q.dmChannels.all(`dm:${u.id}:%`, `dm:%:${u.id}`).map((r) => r.channel);
  socket.emit('world', {
    me: u.id,
    players: [...online.values()].map(pub),
    users: q.allUsers.all().map(publicUser),
    iceServers: ICE_SERVERS,
    history: q.history.all('global').reverse(),
    dmChannels,
  });
  socket.broadcast.emit('joined', pub(p));

  socket.on('move', (d) => {
    if (!d || !isWalkable(d.x, d.y)) return;
    p.x = d.x; p.y = d.y;
    p.dir = ['up', 'down', 'left', 'right'].includes(d.dir) ? d.dir : p.dir;
    socket.broadcast.emit('moved', { id: p.id, x: p.x, y: p.y, dir: p.dir });
  });

  socket.on('media', (m) => {
    p.media = { mic: !!m?.mic, cam: !!m?.cam, screen: !!m?.screen };
    socket.broadcast.emit('media', { id: p.id, media: p.media });
  });

  socket.on('status', (s) => {
    if (!STATUSES.has(s?.status)) return;
    p.status = s.status;
    p.statusText = typeof s.text === 'string' ? s.text.trim().slice(0, 60) : '';
    io.emit('status', { id: p.id, status: p.status, statusText: p.statusText });
  });

  socket.on('profile', (d) => {
    const name = cleanName(d?.name) || p.name;
    const avatar = cleanAvatar(d?.avatar);
    q.updateProfile.run(name, JSON.stringify(avatar), p.id);
    p.name = name; p.avatar = avatar;
    io.emit('profile', { id: p.id, name, avatar });
  });

  socket.on('emote', (e) => { if (EMOTES.has(e)) io.emit('emote', { id: p.id, emote: e }); });

  socket.on('chat', (d) => {
    const text = typeof d?.text === 'string' ? d.text.trim().slice(0, 2000) : '';
    if (!text) return;
    const ts = Date.now();
    if (d.channel === 'global') {
      const info = q.insertMsg.run('global', p.id, text, ts);
      io.emit('chat', { id: Number(info.lastInsertRowid), channel: 'global', from: p.id, text, ts });
    } else if (d.channel === 'nearby' && Array.isArray(d.to)) {
      const msg = { id: `n${ts}${p.id}`, channel: 'nearby', from: p.id, text, ts };
      const targets = new Set(d.to.filter((id) => Number.isInteger(id) && online.has(id)).slice(0, 100));
      targets.add(p.id);
      for (const id of targets) io.to(`u:${id}`).emit('chat', msg);
    } else if (Number.isInteger(d.to) && q.userById.get(d.to)) {
      const channel = dmKey(p.id, d.to);
      const info = q.insertMsg.run(channel, p.id, text, ts);
      const msg = { id: Number(info.lastInsertRowid), channel, from: p.id, text, ts };
      io.to(`u:${p.id}`).to(`u:${d.to}`).emit('chat', msg);
    }
  });

  socket.on('history', (channel, ack) => {
    if (typeof ack !== 'function' || typeof channel !== 'string') return;
    if (channel !== 'global') {
      const m = /^dm:(\d+):(\d+)$/.exec(channel);
      if (!m || (Number(m[1]) !== p.id && Number(m[2]) !== p.id)) return ack([]);
    }
    ack(q.history.all(channel).reverse());
  });

  // Sinalização WebRTC ponto-a-ponto
  socket.on('signal', (d) => {
    if (!d || !online.has(d.to)) return;
    io.to(`u:${d.to}`).emit('signal', { from: p.id, data: d.data });
  });

  socket.on('ring', (to) => { if (online.has(to)) io.to(`u:${to}`).emit('ring', { from: p.id }); });

  socket.on('disconnect', () => {
    if (online.get(p.id) !== p) return;
    online.delete(p.id);
    q.savePos.run(p.x, p.y, p.id);
    io.emit('left', p.id);
  });
});

server.listen(PORT, () => {
  console.log(`Turbo Office rodando em http://localhost:${PORT}`);
  console.log(`Domínios permitidos: ${ALLOWED_DOMAINS.join(', ')}`);
});
