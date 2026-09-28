// Mapa do escritório. Compartilhado entre servidor (validação) e cliente (render/colisão).
// Duas camadas: `floor` (piso/parede) e `obj` (móveis). Coordenadas em tiles.

export const TILE = 32;
export const W = 56;
export const H = 36;

export const F = { WOOD: 1, WALL: 2, CARPET: 3, STAGE: 4, KITCHEN: 5, RUG: 6, DOOR: 7, LOBBY: 8, CARPET2: 9, CARPET3: 10, EXEC: 11 };
export const O = {
  NONE: 0, DESK: 1, CHAIR: 2, PLANT: 3, TABLE: 4, SOFA: 5, COUNTER: 6, SHELF: 7,
  BOARD: 8, TV: 9, FRIDGE: 10, COFFEE: 11, RECEPTION: 12, SCREEN: 13, BEANBAG: 14,
};

// Objetos que bloqueiam passagem. Cadeiras, sofás e pufes são "sentáveis" (andáveis).
const BLOCKING = new Set([O.DESK, O.PLANT, O.TABLE, O.COUNTER, O.SHELF, O.BOARD, O.TV, O.FRIDGE, O.COFFEE, O.RECEPTION, O.SCREEN]);

const floor = Array.from({ length: H }, () => Array(W).fill(F.WOOD));
const obj = Array.from({ length: H }, () => Array(W).fill(O.NONE));

const rect = (layer, x1, y1, x2, y2, v) => { for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) layer[y][x] = v; };
const hline = (layer, x1, x2, y, v) => rect(layer, x1, y, x2, y, v);
const vline = (layer, x, y1, y2, v) => rect(layer, x, y1, x, y2, v);
const set = (layer, pts, v) => pts.forEach(([x, y]) => (layer[y][x] = v));

// ---------- Pisos ----------
rect(floor, 1, 1, 10, 7, F.CARPET);
rect(floor, 12, 1, 21, 7, F.CARPET2);
rect(floor, 23, 1, 32, 7, F.CARPET3);
rect(floor, 34, 1, 43, 7, F.EXEC);
rect(floor, 45, 1, 54, 17, F.CARPET);
rect(floor, 45, 1, 54, 4, F.STAGE);
rect(floor, 1, 26, 20, 34, F.LOBBY);
rect(floor, 38, 26, 54, 34, F.KITCHEN);
rect(floor, 24, 28, 34, 34, F.RUG);

// ---------- Paredes ----------
hline(floor, 0, W - 1, 0, F.WALL);
hline(floor, 0, W - 1, H - 1, F.WALL);
vline(floor, 0, 0, H - 1, F.WALL);
vline(floor, W - 1, 0, H - 1, F.WALL);
// Salas de cima
hline(floor, 0, 44, 8, F.WALL);
[11, 22, 33, 44].forEach((x) => vline(floor, x, 0, 8, F.WALL));
set(floor, [[5, 8], [6, 8], [16, 8], [17, 8], [27, 8], [28, 8], [38, 8], [39, 8]], F.DOOR);
// Auditório
vline(floor, 44, 0, 18, F.WALL);
hline(floor, 44, W - 1, 18, F.WALL);
set(floor, [[44, 12], [44, 13], [49, 18], [50, 18]], F.DOOR);
// Andar de baixo
hline(floor, 0, W - 1, 25, F.WALL);
set(floor, [[9, 25], [10, 25], [23, 25], [24, 25], [47, 25], [48, 25]], F.DOOR);
vline(floor, 21, 25, H - 1, F.WALL);
vline(floor, 37, 25, H - 1, F.WALL);
set(floor, [[21, 30], [21, 31], [37, 30], [37, 31]], F.DOOR);

// ---------- Salas de reunião ----------
function meetingRoom(x0) {
  hline(obj, x0 + 3, x0 + 6, 1, O.BOARD);
  set(obj, [[x0, 1], [x0 + 9, 1], [x0, 7], [x0 + 9, 7]], O.PLANT);
  rect(obj, x0 + 3, 3, x0 + 6, 5, O.TABLE);
  hline(obj, x0 + 3, x0 + 6, 2, O.CHAIR);
  hline(obj, x0 + 3, x0 + 6, 6, O.CHAIR);
  set(obj, [[x0 + 2, 3], [x0 + 2, 5], [x0 + 7, 3], [x0 + 7, 5]], O.CHAIR);
}
[1, 12, 23].forEach(meetingRoom);

// Diretoria
hline(obj, 34, 36, 1, O.SHELF);
set(obj, [[43, 1], [34, 7], [43, 7]], O.PLANT);
hline(obj, 38, 41, 3, O.DESK);
set(obj, [[39, 2], [40, 2], [39, 4], [40, 4]], O.CHAIR);
hline(obj, 36, 39, 6, O.SOFA);
set(obj, [[41, 6]], O.BEANBAG);

// Auditório
hline(obj, 47, 52, 1, O.SCREEN);
set(obj, [[45, 6], [54, 6], [45, 17], [54, 17]], O.PLANT);
[7, 9, 11, 13, 15].forEach((y) => { for (let x = 46; x <= 53; x++) if (x !== 49 && x !== 50) obj[y][x] = O.CHAIR; });

// ---------- Open office: ilhas dos times ----------
export const TEAMS = [
  { name: 'Tráfego', x: 3, y: 11 }, { name: 'Criativo', x: 13, y: 11 },
  { name: 'CS', x: 23, y: 11 }, { name: 'Comercial', x: 33, y: 11 },
  { name: 'Growth', x: 3, y: 18 }, { name: 'Tech', x: 13, y: 18 },
  { name: 'Operações', x: 23, y: 18 }, { name: 'Financeiro', x: 33, y: 18 },
];
for (const t of TEAMS) {
  rect(obj, t.x, t.y, t.x + 5, t.y + 1, O.DESK);
  hline(obj, t.x, t.x + 5, t.y - 1, O.CHAIR);
  hline(obj, t.x, t.x + 5, t.y + 2, O.CHAIR);
}
set(obj, [[1, 9], [43, 9], [1, 24], [43, 24], [11, 15], [21, 15], [31, 15], [11, 22], [21, 22], [31, 22]], O.PLANT);
// Canto do café (direita)
set(obj, [[53, 19], [54, 19]], O.COFFEE);
set(obj, [[45, 24], [54, 24], [45, 19]], O.PLANT);
set(obj, [[48, 21], [51, 21], [48, 23], [51, 23]], O.BEANBAG);

// ---------- Recepção ----------
hline(obj, 6, 13, 28, O.RECEPTION);
set(obj, [[1, 26], [20, 26], [1, 34], [20, 34]], O.PLANT);
hline(obj, 3, 6, 33, O.SOFA);
hline(obj, 15, 18, 33, O.SOFA);

// ---------- Lounge ----------
hline(obj, 27, 31, 26, O.TV);
hline(obj, 26, 32, 30, O.SOFA);
set(obj, [[25, 32], [33, 32], [27, 33], [31, 33]], O.BEANBAG);
hline(obj, 34, 36, 26, O.SHELF);
set(obj, [[22, 26], [36, 34], [22, 34]], O.PLANT);

// ---------- Cozinha ----------
set(obj, [[38, 26]], O.FRIDGE);
hline(obj, 39, 44, 26, O.COUNTER);
set(obj, [[45, 26]], O.COFFEE);
set(obj, [[54, 26], [54, 34]], O.PLANT);
for (const [tx, ty] of [[40, 29], [49, 29]]) {
  rect(obj, tx, ty, tx + 2, ty + 1, O.TABLE);
  hline(obj, tx, tx + 2, ty - 1, O.CHAIR);
  hline(obj, tx, tx + 2, ty + 2, O.CHAIR);
}
hline(obj, 42, 49, 33, O.TABLE);
hline(obj, 42, 49, 34, O.CHAIR);
hline(obj, 42, 49, 32, O.CHAIR);

// ---------- Áreas ----------
// Áreas privadas: todos dentro se ouvem, independentemente da distância; quem está fora não ouve.
export const AREAS = [
  { id: 'sala1', name: 'Sala de Reunião 1', x1: 1, y1: 1, x2: 10, y2: 7, private: true },
  { id: 'sala2', name: 'Sala de Reunião 2', x1: 12, y1: 1, x2: 21, y2: 7, private: true },
  { id: 'sala3', name: 'Sala de Reunião 3', x1: 23, y1: 1, x2: 32, y2: 7, private: true },
  { id: 'diretoria', name: 'Diretoria', x1: 34, y1: 1, x2: 43, y2: 7, private: true },
  { id: 'auditorio', name: 'Auditório', x1: 45, y1: 1, x2: 54, y2: 17, private: true },
  { id: 'recepcao', name: 'Recepção', x1: 1, y1: 26, x2: 20, y2: 34, private: false },
  { id: 'lounge', name: 'Lounge', x1: 22, y1: 26, x2: 36, y2: 34, private: false },
  { id: 'cozinha', name: 'Cozinha', x1: 38, y1: 26, x2: 54, y2: 34, private: false },
  { id: 'escritorio', name: 'Escritório', x1: 1, y1: 9, x2: 54, y2: 24, private: false },
];

export const LABELS = [
  ...AREAS.filter((a) => a.id !== 'escritorio').map((a) => ({ text: a.name, x: (a.x1 + a.x2 + 1) / 2, y: a.id === 'auditorio' ? 5.6 : a.y2 + 0.55, size: 11 })),
  ...TEAMS.map((t) => ({ text: t.name, x: t.x + 3, y: t.y < 15 ? t.y + 3.7 : t.y + 4.2, size: 12 })),
  { text: 'Café', x: 50, y: 20.5, size: 11 },
];

export const SPAWN = { x: 10, y: 31 };

export const MAP = { floor, obj };

export function inBounds(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }

export function isWalkable(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inBounds(x, y)) return false;
  return floor[y][x] !== F.WALL && !BLOCKING.has(obj[y][x]);
}

export function areaAt(x, y) {
  x = Math.round(x); y = Math.round(y);
  return AREAS.find((a) => x >= a.x1 && x <= a.x2 && y >= a.y1 && y <= a.y2) || null;
}

export function privateAreaAt(x, y) {
  const a = areaAt(x, y);
  return a && a.private ? a : null;
}
