// Desenho do mapa, avatares e minimapa — tudo procedural (sem imagens externas).
import { MAP, TILE, W, H, F, O, LABELS, AREAS } from './map.js';

const hash = (x, y) => {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

const FLOOR_COLORS = {
  [F.WOOD]: ['#d3b08a', '#cba781'],
  [F.DOOR]: ['#d3b08a', '#cba781'],
  [F.CARPET]: ['#4f6396', '#4a5d8f'],
  [F.CARPET2]: ['#3f7d74', '#3b766d'],
  [F.CARPET3]: ['#7a5a92', '#735489'],
  [F.EXEC]: ['#2f3d5c', '#2b3855'],
  [F.STAGE]: ['#6e4a33', '#684530'],
  [F.LOBBY]: ['#e3ded4', '#d9d3c6'],
  [F.KITCHEN]: ['#eceae4', '#d8d4ca'],
  [F.RUG]: ['#9c4f5a', '#944a55'],
};

function drawFloor(ctx, t, x, y) {
  const px = x * TILE, py = y * TILE;
  if (t === F.WALL) {
    ctx.fillStyle = '#26304a';
    ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = '#34405f';
    ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 10);
    ctx.fillStyle = '#1b2236';
    ctx.fillRect(px, py + TILE - 6, TILE, 6);
    return;
  }
  const [a, b] = FLOOR_COLORS[t] || FLOOR_COLORS[F.WOOD];
  if (t === F.KITCHEN || t === F.LOBBY) {
    ctx.fillStyle = (x + y) % 2 ? a : b;
    ctx.fillRect(px, py, TILE, TILE);
    return;
  }
  ctx.fillStyle = a;
  ctx.fillRect(px, py, TILE, TILE);
  if (t === F.WOOD || t === F.DOOR || t === F.STAGE) {
    // tábuas horizontais com emendas alternadas
    ctx.fillStyle = b;
    for (let i = 0; i < 4; i++) if (hash(x, y * 4 + i) > 0.5) ctx.fillRect(px, py + i * 8, TILE, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.07)';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(px, py + i * 8 + 7, TILE, 1);
      ctx.fillRect(px + Math.floor(hash(y * 4 + i, x) * 28), py + i * 8, 1, 8);
    }
  } else {
    ctx.fillStyle = b;
    for (let i = 0; i < 6; i++) ctx.fillRect(px + hash(x + i, y) * 30, py + hash(x, y + i) * 30, 2, 2);
  }
}

function drawObj(ctx, t, x, y) {
  const px = x * TILE, py = y * TILE, S = TILE;
  const shadow = () => { ctx.fillStyle = 'rgba(0,0,0,0.18)'; rr(ctx, px + 3, py + 6, S - 4, S - 4, 5); ctx.fill(); };
  switch (t) {
    case O.DESK: {
      shadow();
      ctx.fillStyle = '#f2eee6'; rr(ctx, px + 1, py + 2, S - 2, S - 4, 3); ctx.fill();
      ctx.strokeStyle = '#c9c2b4'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#1f2937'; rr(ctx, px + 7, py + 8, 18, 11, 2); ctx.fill();
      ctx.fillStyle = hash(x, y) > 0.5 ? '#22d3ee' : '#60a5fa'; ctx.fillRect(px + 9, py + 10, 14, 7);
      ctx.fillStyle = '#9ca3af'; ctx.fillRect(px + 10, py + 22, 12, 3);
      break;
    }
    case O.CHAIR:
      ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.beginPath(); ctx.arc(px + 17, py + 18, 9, 0, 7); ctx.fill();
      ctx.fillStyle = '#374151'; ctx.beginPath(); ctx.arc(px + 16, py + 16, 9, 0, 7); ctx.fill();
      ctx.fillStyle = '#4b5563'; ctx.beginPath(); ctx.arc(px + 16, py + 15, 6, 0, 7); ctx.fill();
      break;
    case O.PLANT:
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(px + 17, py + 27, 10, 4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#9a5b3a'; rr(ctx, px + 9, py + 17, 14, 11, 3); ctx.fill();
      for (const [dx, dy, r, c] of [[16, 11, 9, '#2f855a'], [10, 14, 6, '#38a169'], [22, 14, 6, '#38a169'], [16, 7, 6, '#48bb78']]) {
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(px + dx, py + dy, r, 0, 7); ctx.fill();
      }
      break;
    case O.TABLE:
      ctx.fillStyle = '#7b5236'; ctx.fillRect(px, py, S, S);
      ctx.fillStyle = '#8a5d3e'; ctx.fillRect(px, py + 2, S, S - 6);
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(px, py + 4, S, 2);
      break;
    case O.SOFA:
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; rr(ctx, px + 1, py + 6, S, S - 6, 6); ctx.fill();
      ctx.fillStyle = '#5b4a9b'; rr(ctx, px, py + 3, S, S - 6, 6); ctx.fill();
      ctx.fillStyle = '#7163b5'; rr(ctx, px + 3, py + 9, S - 6, S - 15, 4); ctx.fill();
      break;
    case O.BEANBAG:
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(px + 17, py + 20, 12, 9, 0, 0, 7); ctx.fill();
      ctx.fillStyle = hash(x, y) > 0.5 ? '#f59e0b' : '#ef4444'; ctx.beginPath(); ctx.ellipse(px + 16, py + 17, 12, 10, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.ellipse(px + 13, py + 13, 5, 3, -0.5, 0, 7); ctx.fill();
      break;
    case O.COUNTER:
      ctx.fillStyle = '#9ca3af'; ctx.fillRect(px, py, S, S);
      ctx.fillStyle = '#d1d5db'; ctx.fillRect(px, py, S, S - 7);
      if (x % 3 === 1) { ctx.fillStyle = '#94a3b8'; rr(ctx, px + 6, py + 6, 20, 12, 3); ctx.fill(); }
      break;
    case O.FRIDGE:
      ctx.fillStyle = '#cbd5e1'; ctx.fillRect(px + 1, py, S - 2, S);
      ctx.fillStyle = '#e2e8f0'; ctx.fillRect(px + 3, py + 2, S - 6, S - 8);
      ctx.fillStyle = '#64748b'; ctx.fillRect(px + 24, py + 8, 2, 10);
      break;
    case O.COFFEE:
      ctx.fillStyle = '#9ca3af'; ctx.fillRect(px, py, S, S);
      ctx.fillStyle = '#d1d5db'; ctx.fillRect(px, py, S, S - 7);
      ctx.fillStyle = '#111827'; rr(ctx, px + 7, py + 3, 18, 18, 3); ctx.fill();
      ctx.fillStyle = '#ef4444'; ctx.fillRect(px + 11, py + 7, 3, 3);
      ctx.fillStyle = '#fff'; ctx.fillRect(px + 13, py + 15, 6, 5);
      break;
    case O.SHELF: {
      ctx.fillStyle = '#5b3a24'; ctx.fillRect(px, py, S, S);
      const colors = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#e5e7eb'];
      for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) {
        ctx.fillStyle = colors[Math.floor(hash(x * 7 + i, y + r) * colors.length)];
        ctx.fillRect(px + 2 + i * 5, py + 3 + r * 14, 4, 11);
      }
      break;
    }
    case O.BOARD:
      ctx.fillStyle = '#94a3b8'; ctx.fillRect(px, py + 2, S, 20);
      ctx.fillStyle = '#f8fafc'; ctx.fillRect(px + 1, py + 3, S - 2, 17);
      ctx.strokeStyle = hash(x, y) > 0.5 ? '#2563eb' : '#dc2626'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px + 4, py + 9 + hash(y, x) * 5); ctx.lineTo(px + 26, py + 8 + hash(x, x) * 6); ctx.stroke();
      break;
    case O.TV:
    case O.SCREEN:
      ctx.fillStyle = '#0f172a'; ctx.fillRect(px, py + 2, S, 18);
      ctx.fillStyle = t === O.SCREEN ? '#1e3a5f' : '#1e293b'; ctx.fillRect(px + 1, py + 3, S - 2, 15);
      ctx.fillStyle = 'rgba(34,211,238,0.25)'; ctx.fillRect(px + 1, py + 3, S - 2, 4);
      break;
    case O.RECEPTION:
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(px, py + 4, S, S - 2);
      ctx.fillStyle = '#0b1426'; ctx.fillRect(px, py + 2, S, S - 6);
      ctx.fillStyle = '#22d3ee'; ctx.fillRect(px, py + S - 8, S, 3);
      break;
  }
}

// Desenha o mapa estático uma vez em um canvas offscreen.
export function renderMapCanvas() {
  const c = document.createElement('canvas');
  c.width = W * TILE; c.height = H * TILE;
  const ctx = c.getContext('2d');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) drawFloor(ctx, MAP.floor[y][x], x, y);
  // Sombra das paredes sobre o piso
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
    if (MAP.floor[y - 1][x] === F.WALL && MAP.floor[y][x] !== F.WALL) ctx.fillRect(x * TILE, y * TILE, TILE, 7);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (MAP.obj[y][x]) drawObj(ctx, MAP.obj[y][x], x, y);

  // Logo no piso da recepção
  ctx.save();
  ctx.font = '800 38px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(11,20,38,0.14)';
  ctx.fillText('TURBO', 10.5 * TILE, 31 * TILE);
  ctx.restore();

  for (const l of LABELS) {
    ctx.font = `600 ${l.size}px system-ui, sans-serif`;
    const w = ctx.measureText(l.text).width + 14;
    const x = l.x * TILE, y = l.y * TILE;
    ctx.fillStyle = 'rgba(11,20,38,0.72)';
    rr(ctx, x - w / 2, y - 9, w, 18, 9); ctx.fill();
    ctx.fillStyle = '#e2f7fb'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(l.text, x, y + 0.5);
  }
  return c;
}

// ---------------------------------------------------------------- Avatares
const HAIR_STYLES = 5;
export const AVATAR_OPTIONS = {
  skin: ['#f6d7b8', '#f1c7a1', '#d9a47a', '#b97d52', '#8d5a3b', '#5c3a26'],
  hair: ['#1b1b1b', '#3b2a20', '#6b4423', '#b5793d', '#e0c068', '#8a8a8a', '#d9485f', '#4f46e5'],
  hairStyle: [...Array(HAIR_STYLES).keys()],
  shirt: ['#22d3ee', '#0ea5e9', '#6366f1', '#8b5cf6', '#f43f5e', '#f59e0b', '#10b981', '#f8fafc', '#111827'],
  pants: ['#1f2a44', '#334155', '#3f3f46', '#1e3a5f', '#78350f', '#e5e7eb'],
};

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

// (cx, cy) = centro do tile em que o avatar está. walk = fase da animação (0..1) ou -1 parado.
export function drawAvatar(ctx, cx, cy, avatar, dir = 'down', walk = -1) {
  const a = avatar || {};
  const skin = a.skin || '#f1c7a1', hair = a.hair || '#3b2a20', shirt = a.shirt || '#22d3ee', pants = a.pants || '#1f2a44';
  const style = a.hairStyle ?? 0;
  const bob = walk >= 0 ? Math.abs(Math.sin(walk * Math.PI * 2)) * 1.5 : 0;
  const step = walk >= 0 ? Math.sin(walk * Math.PI * 2) * 2.5 : 0;
  const y0 = cy - bob;

  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(cx, cy + 13, 9, 3.5, 0, 0, 7); ctx.fill();

  // pernas
  ctx.fillStyle = pants;
  ctx.fillRect(cx - 5, y0 + 5, 4, 8 + step * 0.4);
  ctx.fillRect(cx + 1, y0 + 5, 4, 8 - step * 0.4);
  ctx.fillStyle = '#111827';
  ctx.fillRect(cx - 5, y0 + 12 + step * 0.4, 4, 2);
  ctx.fillRect(cx + 1, y0 + 12 - step * 0.4, 4, 2);

  // corpo
  ctx.fillStyle = shirt;
  rr(ctx, cx - 7, y0 - 4, 14, 11, 4); ctx.fill();
  ctx.fillStyle = shade(shirt, -30);
  ctx.fillRect(cx - 7, y0 + 4, 14, 2);
  // braços
  ctx.fillStyle = shirt;
  rr(ctx, cx - 10, y0 - 3 - step * 0.3, 3.5, 8, 2); ctx.fill();
  rr(ctx, cx + 6.5, y0 - 3 + step * 0.3, 3.5, 8, 2); ctx.fill();
  ctx.fillStyle = skin;
  ctx.fillRect(cx - 10, y0 + 4 - step * 0.3, 3.5, 2.5);
  ctx.fillRect(cx + 6.5, y0 + 4 + step * 0.3, 3.5, 2.5);

  // cabeça
  const hy = y0 - 11;
  if (style === 2 && dir !== 'up') { ctx.fillStyle = hair; rr(ctx, cx - 8.5, hy - 3, 17, 16, 6); ctx.fill(); } // cabelo longo atrás
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(cx, hy, 7.5, 0, 7); ctx.fill();

  ctx.fillStyle = hair;
  if (dir === 'up') {
    if (style !== 4) { ctx.beginPath(); ctx.arc(cx, hy - 0.5, 7.8, 0, 7); ctx.fill(); }
    if (style === 3) { ctx.beginPath(); ctx.arc(cx, hy - 7, 3.5, 0, 7); ctx.fill(); }
  } else {
    if (style === 0 || style === 2 || style === 3) {
      ctx.beginPath(); ctx.arc(cx, hy - 1, 7.8, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
      ctx.fillRect(cx - 7.8, hy - 2, 15.6, 2.5);
    } else if (style === 1) { // espetado
      ctx.beginPath();
      ctx.moveTo(cx - 8, hy - 1);
      for (let i = 0; i <= 6; i++) ctx.lineTo(cx - 8 + i * (16 / 6), hy - (i % 2 ? 11 : 6));
      ctx.lineTo(cx + 8, hy - 1); ctx.closePath(); ctx.fill();
    }
    if (style === 3) { ctx.beginPath(); ctx.arc(cx, hy - 8.5, 3.5, 0, 7); ctx.fill(); }
    // olhos
    ctx.fillStyle = '#111827';
    const ex = dir === 'left' ? -2.5 : dir === 'right' ? 2.5 : 0;
    if (dir === 'down') {
      ctx.fillRect(cx - 3.5, hy + 1, 2, 2.5); ctx.fillRect(cx + 1.5, hy + 1, 2, 2.5);
      ctx.fillStyle = 'rgba(220,80,80,0.25)';
      ctx.fillRect(cx - 5.5, hy + 3.5, 2, 1.5); ctx.fillRect(cx + 3.5, hy + 3.5, 2, 1.5);
    } else {
      ctx.fillRect(cx + ex - 1 + (dir === 'left' ? -1 : 1), hy + 1, 2, 2.5);
    }
  }
}

export function drawNameTag(ctx, cx, cy, name, status, opts = {}) {
  ctx.font = '600 10px system-ui, sans-serif';
  const w = ctx.measureText(name).width + 18;
  const x = cx - w / 2, y = cy - 36;
  ctx.fillStyle = opts.isMe ? 'rgba(8,145,178,0.92)' : 'rgba(11,20,38,0.82)';
  rr(ctx, x, y, w, 14, 7); ctx.fill();
  ctx.fillStyle = status === 'busy' ? '#ef4444' : status === 'away' ? '#f59e0b' : '#22c55e';
  ctx.beginPath(); ctx.arc(x + 7, y + 7, 3, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(name, x + 13, y + 7.5);
  if (opts.micOff) {
    ctx.fillStyle = '#ef4444';
    rr(ctx, x + w + 2, y, 14, 14, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x + w + 5, y + 3); ctx.lineTo(x + w + 13, y + 11); ctx.stroke();
  }
}

// Renderiza um avatar estático num canvas (prévias, lista de pessoas).
export function avatarPreview(canvas, avatar, scale = 3) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawAvatar(ctx, canvas.width / scale / 2, canvas.height / scale / 2 + 4, avatar, 'down');
}

// ---------------------------------------------------------------- Minimapa
let miniBase = null;
export function drawMinimap(canvas, players, meId) {
  const ctx = canvas.getContext('2d');
  const sx = canvas.width / W, sy = canvas.height / H;
  if (!miniBase) {
    miniBase = document.createElement('canvas');
    miniBase.width = canvas.width; miniBase.height = canvas.height;
    const m = miniBase.getContext('2d');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const f = MAP.floor[y][x];
      m.fillStyle = f === F.WALL ? '#0b1426' : MAP.obj[y][x] && ![O.CHAIR, O.SOFA, O.BEANBAG].includes(MAP.obj[y][x]) ? '#64748b' : (FLOOR_COLORS[f] || FLOOR_COLORS[F.WOOD])[0];
      m.fillRect(x * sx, y * sy, Math.ceil(sx), Math.ceil(sy));
    }
    m.strokeStyle = 'rgba(34,211,238,0.6)'; m.lineWidth = 1;
    for (const a of AREAS) if (a.private) m.strokeRect(a.x1 * sx + 0.5, a.y1 * sy + 0.5, (a.x2 - a.x1 + 1) * sx - 1, (a.y2 - a.y1 + 1) * sy - 1);
  }
  ctx.drawImage(miniBase, 0, 0);
  for (const p of players.values()) {
    const isMe = p.id === meId;
    ctx.fillStyle = isMe ? '#fbbf24' : '#22d3ee';
    ctx.beginPath(); ctx.arc((p.rx + 0.5) * sx, (p.ry + 0.5) * sy, isMe ? 3.2 : 2.4, 0, 7); ctx.fill();
    if (isMe) { ctx.strokeStyle = '#0b1426'; ctx.lineWidth = 1; ctx.stroke(); }
  }
}
