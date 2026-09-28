// Estado compartilhado entre os módulos do cliente.
import { privateAreaAt } from './map.js';

export const state = {
  me: null,               // id do usuário local
  players: new Map(),     // id -> jogador online
  users: new Map(),       // id -> { id, name, avatar } (todos cadastrados)
  socket: null,
  zoom: 1.5,
  inRange: new Set(),     // ids com quem estou em conversa (proximidade/sala)
  speaking: new Set(),    // ids falando agora (inclui o local)
  joined: false,
};

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));

export const me = () => state.players.get(state.me);

// Regras de proximidade — idênticas em todos os clientes para que ambos os lados concordem.
export const RANGE_IN = 3.2;   // conecta a esta distância (tiles)
export const RANGE_OUT = 4.6;  // desconecta além desta (histerese)

export function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

export function shouldTalk(a, b, connected) {
  if (!a || !b || a.id === b.id) return false;
  if (a.status === 'busy' || b.status === 'busy') return false;
  const A = privateAreaAt(a.x, a.y);
  const B = privateAreaAt(b.x, b.y);
  if (A || B) return !!(A && B && A.id === B.id);
  return distance(a, b) <= (connected ? RANGE_OUT : RANGE_IN);
}

// Volume de 0..1 conforme a distância (salas privadas = volume cheio).
export function volumeFor(a, b) {
  if (privateAreaAt(a.x, a.y)) return 1;
  const d = distance(a, b);
  if (d <= 1.5) return 1;
  return Math.max(0.15, 1 - (d - 1.5) / (RANGE_OUT - 1.5) * 0.85);
}

export function displayName(id) {
  return state.players.get(id)?.name || state.users.get(id)?.name || 'Alguém';
}

export function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('') || '?';
}
