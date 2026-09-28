// Tempo real via Supabase Realtime (canais privados):
//   turbo:lobby        presença de todos (quem está online, em qual sala, mídia, status)
//   turbo:user:<id>    caixa de entrada de cada pessoa (sinalização WebRTC, chamadas)
//   turbo:db           mudanças no banco (mensagens, salas, perfis, moderação)
import { state, emit } from './state.js';

const sid = crypto.randomUUID(); // identifica esta aba (para derrubar abas duplicadas)
let sb = null;
let lobby = null;
let inbox = null;
let dbch = null;
const outboxes = new Map();
let meta = { room: null, media: { mic: false, cam: false, screen: false }, deaf: false, status: 'available', statusText: '' };

export async function startNet(client) {
  sb = client;
  await sb.realtime.setAuth();

  lobby = sb.channel('turbo:lobby', { config: { private: true, presence: { key: state.me } } });
  lobby.on('presence', { event: 'sync' }, syncPresence);
  lobby.subscribe(async (status, err) => {
    if (status === 'SUBSCRIBED') {
      state.connected = true;
      await lobby.track({ ...meta, sid, t: Date.now() });
      emit('connection', true);
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      state.connected = false;
      emit('connection', false);
      if (err) console.warn('Realtime (lobby):', status, err.message || err);
    }
  });

  inbox = sb.channel(`turbo:user:${state.me}`, { config: { private: true } });
  for (const ev of ['signal', 'ring']) inbox.on('broadcast', { event: ev }, ({ payload }) => emit(`inbox:${ev}`, payload));
  inbox.on('broadcast', { event: 'kick' }, ({ payload }) => { if (payload.sid !== sid) emit('kicked'); });
  inbox.subscribe((status) => { if (status === 'SUBSCRIBED') inbox.httpSend('kick', { sid }).catch(() => {}); });

  dbch = sb.channel('turbo:db', { config: { private: true } });
  for (const table of ['messages', 'categories', 'rooms', 'profiles', 'bans']) {
    dbch.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => emit(`db:${table}`, p));
  }
  dbch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mod_actions', filter: `target=eq.${state.me}` }, (p) => emit('db:mod', p.new));
  dbch.subscribe((status, err) => { if (err) console.warn('Realtime (db):', status, err.message || err); });
}

function syncPresence() {
  const next = new Map();
  for (const [id, metas] of Object.entries(lobby.presenceState())) {
    const m = metas.reduce((a, b) => ((b.t || 0) > (a.t || 0) ? b : a));
    next.set(id, {
      room: m.room || null,
      media: { mic: !!m.media?.mic, cam: !!m.media?.cam, screen: !!m.media?.screen },
      deaf: !!m.deaf,
      status: m.status || 'available',
      statusText: typeof m.statusText === 'string' ? m.statusText.slice(0, 60) : '',
    });
  }
  // O próprio estado local é a fonte da verdade para mim (evita "piscar" até o eco chegar)
  if (state.me) next.set(state.me, { ...meta });
  state.presence = next;
  emit('presence');
}

// Atualiza meu estado de presença (sala, mídia, status).
export function setMeta(patch) {
  meta = { ...meta, ...patch };
  state.presence.set(state.me, { ...meta });
  emit('presence');
  if (state.connected) lobby.track({ ...meta, sid, t: Date.now() }).catch((e) => console.warn('track', e));
}
export const getMeta = () => meta;

// Envia um evento direto para a caixa de entrada de alguém (REST, sem precisar assinar o canal).
export function sendTo(uid, event, payload) {
  let ch = uid === state.me ? inbox : outboxes.get(uid);
  if (!ch) {
    ch = sb.channel(`turbo:user:${uid}`, { config: { private: true } });
    outboxes.set(uid, ch);
  }
  return ch.httpSend(event, { ...payload, from: state.me }).catch((e) => console.warn(`sendTo(${event})`, e.message || e));
}

export async function stopNet() {
  try { await lobby?.untrack(); } catch {}
  await sb?.removeAllChannels();
}
