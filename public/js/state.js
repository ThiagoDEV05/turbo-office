// Estado compartilhado entre os módulos do cliente.

export const state = {
  cfg: null,
  me: null,               // uuid do usuário local
  profiles: new Map(),    // id -> { id, email, name, color, role }
  categories: new Map(),  // id -> { id, name, position, min_role }
  rooms: new Map(),       // id -> { id, name, kind, category_id, min_role, write_role, position }
  bans: new Map(),        // user_id -> { until, reason, by_id } (só Gestor+ carrega)
  presence: new Map(),    // id -> { room, media: {mic,cam,screen}, deaf, status, statusText }
  voiceRoom: null,        // id da sala de voz em que estou
  view: null,             // { type: 'text'|'voice'|'dm', id }
  speaking: new Set(),    // ids falando agora (inclui o local)
  deafened: false,
  modMuted: false,        // mutado por Gestor/Admin
  connected: false,
  calendar: null,         // { connected, error?, events: [{start,end}] } — só horários
  music: new Map(),       // room_id -> estado do bot de música (fila, música atual)
};

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));

export const ROLES = {
  admin: { label: 'Admin', plural: 'Admins', rank: 3, color: '#f43f5e' },
  gestor: { label: 'Gestor', plural: 'Gestores', rank: 2, color: '#f59e0b' },
  membro: { label: 'Membro', plural: 'Membros', rank: 1, color: '#94a3b8' },
};
export const rank = (role) => ROLES[role]?.rank || 0;
export const myProfile = () => state.profiles.get(state.me);
export const myRank = () => rank(myProfile()?.role);
export const canManageRooms = () => myRank() >= 2;
// Gestor/Admin só moderam quem tem cargo abaixo do seu.
export const canModerate = (id) => id !== state.me && myRank() >= 2 && myRank() > rank(state.profiles.get(id)?.role);

export const STATUS_LABEL = { available: 'Disponível', busy: 'Ocupado', away: 'Ausente' };
const hhmm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
// Texto de status: o que a pessoa escreveu > "Em reunião até…" (agenda) > Disponível/Ocupado/Ausente
export function statusLine(pr) {
  if (!pr) return 'Offline';
  if (pr.statusText) return pr.statusText;
  if (pr.meeting?.until && Date.parse(pr.meeting.until) > Date.now()) return `📅 Em reunião até ${hhmm(pr.meeting.until)}`;
  return STATUS_LABEL[pr.status] || 'Disponível';
}

export const COLORS = ['#22d3ee', '#0ea5e9', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e', '#f97316', '#f59e0b', '#10b981', '#14b8a6', '#64748b'];

export const dmKey = (a, b) => (a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`);
export const dmOther = (key) => { const [, a, b] = key.split(':'); return a === state.me ? b : a; };
export const roomKey = (roomId) => `room:${roomId}`;

export function displayName(id) { return state.profiles.get(id)?.name || 'Alguém'; }
export function colorOf(id) {
  const c = state.profiles.get(id)?.color;
  return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#64748b';
}
// URL da foto (validada no banco: só https, sem aspas/parênteses)
export function photoOf(id) {
  const u = state.profiles.get(id)?.avatar_url;
  return typeof u === 'string' && /^https:\/\/[^\s"')]+$/.test(u) ? u : null;
}
export function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('') || '?';
}
export const membersIn = (roomId) => [...state.presence.entries()].filter(([, p]) => p.room === roomId).map(([id]) => id);
