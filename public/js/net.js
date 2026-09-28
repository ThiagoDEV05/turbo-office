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
let stopping = false;
const outboxes = new Map();
let meta = { room: null, media: { mic: false, cam: false, screen: false }, deaf: false, status: 'available', statusText: '' };

// ---------------------------------------------------------------- Canais que se recuperam sozinhos
// Se um canal cair (token renovado, notebook dormiu, rede oscilou), ele é recriado automaticamente.
// Sem isso a pessoa continuava "na sala" mas os convites de conexão não chegavam até recarregar.
const makers = {};
const current = {};
const retryTimer = {};
const retryCount = {};
const joiningSince = {};

function watch(name, ch, onJoined) {
  current[name] = ch;
  joiningSince[name] = Date.now();
  ch.subscribe(async (status, err) => {
    if (current[name] !== ch) return; // canal antigo, já substituído
    if (status === 'SUBSCRIBED') {
      retryCount[name] = 0;
      joiningSince[name] = 0;
      await onJoined?.();
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      if (err) console.warn(`Realtime (${name}):`, status, err.message || err);
      if (name === 'lobby') { state.connected = false; emit('connection', false); }
      rejoin(name);
    }
  });
  return ch;
}

function rejoin(name, delay) {
  if (stopping || retryTimer[name]) return;
  const n = (retryCount[name] = (retryCount[name] || 0) + 1);
  const wait = delay ?? Math.min(15000, 500 * 2 ** Math.min(n, 5)); // 1s, 2s, 4s… até 15s
  retryTimer[name] = setTimeout(async () => {
    retryTimer[name] = null;
    const old = current[name];
    current[name] = null;
    if (old) await sb.removeChannel(old).catch(() => {});
    await sb.realtime.setAuth().catch(() => {});
    makers[name]();
  }, wait);
}

// Checagem periódica: canal fechado, com erro ou "entrando" há muito tempo → recria
export function healthCheck() {
  if (stopping || !sb) return;
  for (const name of Object.keys(makers)) {
    const ch = current[name];
    const st = ch?.state;
    if (!ch || st === 'closed' || st === 'errored') rejoin(name, 0);
    else if (st !== 'joined' && joiningSince[name] && Date.now() - joiningSince[name] > 15000) rejoin(name, 0);
  }
}

export async function startNet(client) {
  sb = client;
  stopping = false;
  await sb.realtime.setAuth();
  // Token de login renovado → renova também o do tempo real
  sb.auth.onAuthStateChange((event) => { if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') sb.realtime.setAuth().catch(() => {}); });

  makers.lobby = () => {
    lobby = sb.channel('turbo:lobby', { config: { private: true, presence: { key: state.me } } });
    lobby.on('presence', { event: 'sync' }, syncPresence);
    return watch('lobby', lobby, async () => {
      state.connected = true;
      await lobby.track({ ...meta, sid, t: Date.now() });
      emit('connection', true);
    });
  };

  makers.inbox = () => {
    inbox = sb.channel(`turbo:user:${state.me}`, { config: { private: true } });
    for (const ev of ['signal', 'ring']) inbox.on('broadcast', { event: ev }, ({ payload }) => emit(`inbox:${ev}`, payload));
    inbox.on('broadcast', { event: 'kick' }, ({ payload }) => { if (payload.sid !== sid) emit('kicked'); });
    let announced = false;
    return watch('inbox', inbox, () => {
      if (!announced) { announced = true; inbox.httpSend('kick', { sid }).catch(() => {}); }
      emit('inbox-ready');
    });
  };

  makers.db = () => {
    dbch = sb.channel('turbo:db', { config: { private: true } });
    for (const table of ['messages', 'categories', 'rooms', 'profiles', 'bans']) {
      dbch.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => emit(`db:${table}`, p));
    }
    dbch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mod_actions', filter: `target=eq.${state.me}` }, (p) => emit('db:mod', p.new));
    return watch('db', dbch);
  };

  makers.lobby(); makers.inbox(); makers.db();
  setInterval(healthCheck, 20000);
  addEventListener('online', () => healthCheck());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) healthCheck(); });
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
  if (state.connected && lobby?.state === 'joined') lobby.track({ ...meta, sid, t: Date.now() }).catch((e) => console.warn('track', e));
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

// Diagnóstico (console): turbo.net.channels()
export const channels = () => ({ ...current });

export async function stopNet() {
  stopping = true;
  Object.values(retryTimer).forEach(clearTimeout);
  try { await lobby?.untrack(); } catch {}
  await sb?.removeAllChannels();
}
