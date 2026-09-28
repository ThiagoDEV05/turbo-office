// Ponto de entrada do cliente: conexão, loop do jogo, movimento e entrada do usuário.
import { TILE, W, H, isWalkable, privateAreaAt, areaAt } from './map.js';
import { state, on, emit, me, RANGE_IN, displayName } from './state.js';
import { renderMapCanvas, drawAvatar, drawNameTag, drawMinimap } from './render.js';
import * as rtc from './rtc.js';
import * as ui from './ui.js';

const STEP_MS = 150;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };

const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');
const minimap = document.getElementById('minimap');
let mapCanvas = null;
let profile = null;           // perfil vindo de /api/me
let pendingProfile = null;    // alterações feitas antes de entrar
let heldDirs = [];
let path = [];
let marker = null;
let cam = { x: 0, y: 0 };

// ------------------------------------------------------------------ Jogadores
function addPlayer(p) {
  const existing = state.players.get(p.id);
  const np = { ...p, rx: p.x, ry: p.y, fx: p.x, fy: p.y, t0: 0, dur: STEP_MS, steps: 0, emote: null, emoteAt: 0 };
  if (existing) { np.rx = existing.rx; np.ry = existing.ry; }
  state.players.set(p.id, np);
  state.users.set(p.id, { id: p.id, name: p.name, avatar: p.avatar });
}

function startMove(p, x, y) {
  p.fx = p.rx; p.fy = p.ry;
  p.x = x; p.y = y;
  p.t0 = performance.now();
  p.dur = STEP_MS;
  p.steps++;
}

function updatePositions(now) {
  for (const p of state.players.values()) {
    const t = Math.min(1, (now - p.t0) / p.dur);
    p.rx = p.fx + (p.x - p.fx) * t;
    p.ry = p.fy + (p.y - p.fy) * t;
  }
}

// ------------------------------------------------------------------ Movimento local
function step(dir) {
  const p = me();
  const [dx, dy] = DIRS[dir];
  const nx = p.x + dx, ny = p.y + dy;
  p.dir = dir;
  if (isWalkable(nx, ny)) startMove(p, nx, ny);
  else p.t0 = performance.now() - STEP_MS + 60; // só vira
  state.socket.emit('move', { x: p.x, y: p.y, dir });
}

function handleInput(now) {
  const p = me();
  if (!p || now - p.t0 < p.dur) return;
  const dir = heldDirs.at(-1);
  if (dir) { path = []; step(dir); return; }
  if (path.length) {
    const [nx, ny] = path.shift();
    const dx = nx - p.x, dy = ny - p.y;
    const d = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
    if (Math.abs(dx) + Math.abs(dy) !== 1 || !isWalkable(nx, ny)) { path = []; return; }
    step(d);
    if (!path.length) marker = null;
  }
}

function findPath(sx, sy, isGoal, limit = 4000) {
  const key = (x, y) => y * W + x;
  const prev = new Map([[key(sx, sy), null]]);
  const queue = [[sx, sy]];
  while (queue.length && prev.size < limit) {
    const [x, y] = queue.shift();
    if (isGoal(x, y) && !(x === sx && y === sy)) {
      const out = [];
      for (let k = key(x, y); k !== key(sx, sy); k = prev.get(k)) out.unshift([k % W, Math.floor(k / W)]);
      return out;
    }
    for (const [dx, dy] of Object.values(DIRS)) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (!prev.has(k) && isWalkable(nx, ny)) { prev.set(k, key(x, y)); queue.push([nx, ny]); }
    }
  }
  return null;
}

function walkTo(tx, ty) {
  const p = me();
  const goal = isWalkable(tx, ty)
    ? (x, y) => x === tx && y === ty
    : (x, y) => Math.abs(x - tx) <= 1 && Math.abs(y - ty) <= 1;
  const found = findPath(p.x, p.y, goal);
  if (found) { path = found; marker = { x: tx, y: ty, t: performance.now() }; }
}

function gotoPlayer(id) {
  const t = state.players.get(id);
  const p = me();
  if (!t || !p) return;
  if (Math.abs(t.x - p.x) <= 1 && Math.abs(t.y - p.y) <= 1) return;
  const found = findPath(p.x, p.y, (x, y) => Math.abs(x - t.x) <= 1 && Math.abs(y - t.y) <= 1 && !(x === t.x && y === t.y));
  if (found) { path = found; marker = { x: t.x, y: t.y, t: performance.now() }; }
  else ui.toast({ title: 'Não achei um caminho', body: `Não dá para chegar até ${t.name} agora.` });
}

// ------------------------------------------------------------------ Render
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(innerWidth * dpr), hgt = Math.floor(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; }
}

function frame(now) {
  requestAnimationFrame(frame);
  const self = me();
  if (!self || !mapCanvas) return;
  handleInput(now);
  updatePositions(now);
  resize();

  const dpr = window.devicePixelRatio || 1;
  const z = state.zoom;
  cam.x = (self.rx + 0.5) * TILE;
  cam.y = (self.ry + 0.5) * TILE;
  const ox = Math.round((innerWidth / 2 - cam.x * z) * dpr);
  const oy = Math.round((innerHeight / 2 - cam.y * z) * dpr);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#070d1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(z * dpr, 0, 0, z * dpr, ox, oy);
  ctx.imageSmoothingEnabled = z < 1;
  ctx.drawImage(mapCanvas, 0, 0);

  const area = privateAreaAt(self.x, self.y);

  // Raio de conversa (em área aberta)
  if (!area && self.status !== 'busy') {
    ctx.save();
    ctx.strokeStyle = 'rgba(34,211,238,0.28)';
    ctx.fillStyle = 'rgba(34,211,238,0.05)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cam.x, cam.y, (RANGE_IN + 0.3) * TILE, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // Marcador de destino
  if (marker) {
    const a = 1 - Math.min(1, (now - marker.t) / 1500);
    ctx.strokeStyle = `rgba(251,191,36,${0.4 + a * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc((marker.x + 0.5) * TILE, (marker.y + 0.5) * TILE, 8 + a * 4, 0, Math.PI * 2); ctx.stroke();
  }

  const sorted = [...state.players.values()].sort((a, b) => a.ry - b.ry);
  for (const p of sorted) {
    const cx = (p.rx + 0.5) * TILE, cy = (p.ry + 0.5) * TILE - 4;
    const moving = now - p.t0 < p.dur && (p.fx !== p.x || p.fy !== p.y);
    const phase = moving ? ((p.steps % 2) * 0.5 + ((now - p.t0) / p.dur) * 0.5) % 1 : -1;
    if (state.speaking.has(p.id)) {
      ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(cx, cy + 17, 12, 5, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (state.inRange.has(p.id)) {
      ctx.strokeStyle = 'rgba(34,211,238,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(cx, cy + 17, 11, 4.5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = p.status === 'away' ? 0.55 : 1;
    drawAvatar(ctx, cx, cy, p.avatar, p.dir, phase);
    ctx.globalAlpha = 1;
  }
  for (const p of sorted) {
    const cx = (p.rx + 0.5) * TILE, cy = (p.ry + 0.5) * TILE - 4;
    drawNameTag(ctx, cx, cy, p.name, p.status, { isMe: p.id === state.me, micOff: !p.media?.mic });
    if (p.emote && now - p.emoteAt < 4000) {
      const t = (now - p.emoteAt) / 4000;
      const y = cy - 52 - t * 10;
      ctx.globalAlpha = t > 0.8 ? (1 - t) * 5 : 1;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.roundRect(cx - 14, y - 14, 28, 26, 9); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx - 4, y + 11); ctx.lineTo(cx, y + 16); ctx.lineTo(cx + 4, y + 11); ctx.fill();
      ctx.font = '16px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.emote, cx, y);
      ctx.globalAlpha = 1;
    }
  }

  // Escurece tudo fora da sala privada
  if (area) {
    ctx.fillStyle = 'rgba(3,7,18,0.6)';
    ctx.beginPath();
    ctx.rect(-2000, -2000, W * TILE + 4000, H * TILE + 4000);
    ctx.rect(area.x1 * TILE, area.y1 * TILE, (area.x2 - area.x1 + 1) * TILE, (area.y2 - area.y1 + 1) * TILE);
    ctx.fill('evenodd');
  }
}

function screenToTile(sx, sy) {
  const z = state.zoom;
  const wx = (sx - innerWidth / 2) / z + cam.x;
  const wy = (sy - innerHeight / 2) / z + cam.y;
  return { wx, wy, tx: Math.floor(wx / TILE), ty: Math.floor(wy / TILE) };
}

function playerAt(sx, sy) {
  const { wx, wy } = screenToTile(sx, sy);
  let hit = null;
  for (const p of state.players.values()) {
    const cx = (p.rx + 0.5) * TILE, cy = (p.ry + 0.5) * TILE - 4;
    if (Math.abs(wx - cx) < 12 && wy > cy - 22 && wy < cy + 16) if (!hit || p.ry > hit.ry) hit = p;
  }
  return hit;
}

// ------------------------------------------------------------------ Status do local
let lastPill = '';
function updatePill() {
  const self = me();
  if (!self) return;
  const area = areaAt(self.x, self.y);
  const n = state.inRange.size;
  let html;
  if (!state.socket?.connected) html = '⏳ Reconectando…';
  else if (area?.private) html = `🔒 <span class="priv">${area.name}</span> · ${n ? `${n + 1} pessoas` : 'só você'}`;
  else html = `📍 ${area?.name || 'Escritório'}${n ? ` · conversando com ${n}` : ''}`;
  if (self.status === 'busy') html += ' · 🔕 não perturbe';
  if (html !== lastPill) { document.getElementById('locationPill').innerHTML = html; lastPill = html; }
}

// ------------------------------------------------------------------ Socket
function connect() {
  const socket = io({ transports: ['websocket', 'polling'] });
  state.socket = socket;

  socket.on('connect_error', (err) => { if (err.message === 'unauthorized') location.href = '/login'; });
  socket.on('disconnect', () => { rtc.closeAll(); updatePill(); });

  socket.on('world', (w) => {
    state.me = w.me;
    state.players.clear();
    state.users.clear();
    for (const u of w.users) state.users.set(u.id, u);
    for (const p of w.players) addPlayer(p);
    rtc.setIceServers(w.iceServers);
    ui.initChat(w.history, w.dmChannels);
    state.joined = true;
    rtc.watchLocal();
    rtc.publishMedia();
    if (pendingProfile) { socket.emit('profile', pendingProfile); pendingProfile = null; }
    ui.renderMeBar();
    ui.refreshPeople();
  });

  socket.on('joined', (p) => { rtc.closePeer(p.id, false); addPlayer(p); ui.refreshPeople(); });
  socket.on('left', (id) => { state.players.delete(id); rtc.closePeer(id, false); ui.refreshPeople(); });
  socket.on('user:new', (u) => state.users.set(u.id, u));

  socket.on('moved', ({ id, x, y, dir }) => {
    const p = state.players.get(id);
    if (!p) return;
    p.dir = dir;
    if (p.x === x && p.y === y) return;
    if (Math.hypot(p.rx - x, p.ry - y) > 3) { p.rx = p.fx = p.x = x; p.ry = p.fy = p.y = y; }
    else startMove(p, x, y);
  });

  socket.on('media', ({ id, media }) => {
    const p = state.players.get(id);
    if (!p) return;
    const startedScreen = media.screen && !p.media?.screen;
    p.media = media;
    emit('tiles');
    if (startedScreen && state.inRange.has(id)) ui.toast({ title: `${p.name} está compartilhando a tela`, body: 'Clique no vídeo da tela para ampliar.' });
  });

  socket.on('status', ({ id, status, statusText }) => {
    const p = state.players.get(id);
    if (!p) return;
    p.status = status; p.statusText = statusText;
    if (id === state.me) ui.renderMeBar();
  });

  socket.on('profile', ({ id, name, avatar }) => {
    const p = state.players.get(id);
    if (p) { p.name = name; p.avatar = avatar; }
    state.users.set(id, { id, name, avatar });
    if (id === state.me) ui.renderMeBar();
    emit('tiles');
  });

  socket.on('emote', ({ id, emote }) => {
    const p = state.players.get(id);
    if (p) { p.emote = emote; p.emoteAt = performance.now(); }
  });

  socket.on('chat', ui.onChatMessage);
  socket.on('signal', rtc.onSignal);

  socket.on('ring', ({ from }) => {
    ui.beep(880, 0.15, 3);
    ui.toast({
      title: `🔔 ${displayName(from)} está te chamando`,
      body: 'Quer conversar com você.',
      timeout: 20000,
      actions: [{ label: 'Ir até', primary: true, onClick: () => gotoPlayer(from) }, { label: 'Mensagem', onClick: () => ui.openChat(ui.dmKey(from)) }],
    });
    if (document.hidden && Notification?.permission === 'granted') new Notification(`${displayName(from)} está te chamando no Turbo Office`);
  });

  socket.on('kicked', () => {
    rtc.closeAll();
    document.getElementById('kicked').hidden = false;
  });
}

// ------------------------------------------------------------------ Entrada
function isTyping(e) {
  const t = e.target;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t?.isContentEditable;
}

async function toggleMic() { await rtc.toggleMic(); ui.renderMediaButtons(); }
async function toggleCam() { await rtc.toggleCam(); ui.renderMediaButtons(); }
async function toggleScreen() { await rtc.toggleScreen(); ui.renderMediaButtons(); }

function bindInput() {
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ui.closeSpotlight();
      document.querySelectorAll('.popover').forEach((el) => (el.hidden = true));
      if (isTyping(e)) e.target.blur();
      return;
    }
    if (!state.joined || !document.getElementById('setupModal').hidden) return;
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyA') { e.preventDefault(); toggleMic(); return; }
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') { e.preventDefault(); toggleCam(); return; }
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const dir = KEYMAP[e.code];
    if (dir) {
      e.preventDefault();
      if (!heldDirs.includes(dir)) heldDirs.push(dir);
      path = []; marker = null;
      return;
    }
    if (/^Digit[1-8]$/.test(e.code)) { state.socket.emit('emote', ui.EMOTES[Number(e.code.slice(5)) - 1]); return; }
    if (e.key === 'Enter') { e.preventDefault(); ui.focusChat(); }
  });
  addEventListener('keyup', (e) => { const dir = KEYMAP[e.code]; if (dir) heldDirs = heldDirs.filter((d) => d !== dir); });
  addEventListener('blur', () => (heldDirs = []));

  canvas.addEventListener('click', (e) => {
    if (!state.joined) return;
    const hit = playerAt(e.clientX, e.clientY);
    if (hit) { ui.openPlayerCard(hit.id, e.clientX, e.clientY); return; }
    const { tx, ty } = screenToTile(e.clientX, e.clientY);
    if (tx >= 0 && ty >= 0 && tx < W && ty < H) walkTo(tx, ty);
  });
  canvas.addEventListener('mousemove', (e) => { canvas.style.cursor = playerAt(e.clientX, e.clientY) ? 'pointer' : 'default'; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(state.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }, { passive: false });
  document.querySelectorAll('#zoomCtl button').forEach((b) => (b.onclick = () => setZoom(state.zoom * (b.dataset.z === '1' ? 1.2 : 1 / 1.2))));
  minimap.addEventListener('click', (e) => {
    const r = minimap.getBoundingClientRect();
    walkTo(Math.floor(((e.clientX - r.left) / r.width) * W), Math.floor(((e.clientY - r.top) / r.height) * H));
  });

  document.getElementById('micBtn').onclick = toggleMic;
  document.getElementById('camBtn').onclick = toggleCam;
  document.getElementById('screenBtn').onclick = toggleScreen;

  // Ausente automático após 10 min com a aba escondida
  let awayTimer = null, autoAway = false;
  document.addEventListener('visibilitychange', () => {
    const p = me();
    if (!p) return;
    if (document.hidden) {
      awayTimer = setTimeout(() => { if (p.status === 'available') { autoAway = true; state.socket.emit('status', { status: 'away', text: p.statusText }); } }, 10 * 60e3);
    } else {
      clearTimeout(awayTimer);
      if (autoAway && p.status === 'away') state.socket.emit('status', { status: 'available', text: p.statusText });
      autoAway = false;
    }
  });
}

function setZoom(z) {
  state.zoom = Math.max(0.6, Math.min(3, z));
  localStorage.setItem('to.zoom', state.zoom);
}

// ------------------------------------------------------------------ Boot
async function boot() {
  const res = await fetch('/api/me');
  if (res.status === 401) { location.href = '/login'; return; }
  profile = await res.json();
  state.zoom = Number(localStorage.getItem('to.zoom')) || 1.5;

  mapCanvas = renderMapCanvas();
  ui.initUI({
    gotoPlayer,
    ring: (id) => { state.socket.emit('ring', id); ui.toast({ title: `Chamando ${displayName(id)}…`, timeout: 3000 }); },
    emote: (e) => state.socket.emit('emote', e),
    setStatus: (status, text) => state.socket.emit('status', { status, text }),
    saveProfile: (name, avatar) => state.socket.emit('profile', { name, avatar }),
    logout: async () => { await fetch('/api/logout', { method: 'POST' }); rtc.closeAll(); location.href = '/login'; },
    profile: () => profile,
  });
  rtc.initTiles(document.getElementById('videos'), ui.openSpotlight);
  on('media-local', () => ui.renderMediaButtons());
  bindInput();

  // Pede câmera e microfone já na tela de entrada (prévia)
  const setup = ui.openSetup('join');
  await rtc.startMic();
  await rtc.startCam();
  ui.renderMediaButtons();
  ui.refreshSetup();

  const chosen = await setup;
  rtc.ensureAudioContext();
  if (chosen.name !== profile.name || JSON.stringify(chosen.avatar) !== JSON.stringify(profile.avatar)) pendingProfile = chosen;
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});

  connect();
  requestAnimationFrame(frame);
  setInterval(rtc.updatePeers, 300);
  setInterval(updatePill, 300);
  setInterval(() => drawMinimap(minimap, state.players, state.me), 250);
}

boot();
