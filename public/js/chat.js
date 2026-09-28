// Chat: canais de texto e mensagens diretas, persistidos na tabela `messages` do Supabase.
import { state, emit, on, rank, myRank, displayName, dmKey, dmOther, ROLES } from './state.js';
import { $, h, avatar, toast, sounds, nameColor } from './ui.js';


let sb = null;
const channels = new Map(); // key -> { messages, loaded, unread, last }

const chan = (key) => {
  if (!channels.has(key)) channels.set(key, { messages: [], loaded: false, unread: 0, last: 0 });
  return channels.get(key);
};
const norm = (r) => ({ id: r.id, channel: r.channel, from: r.from_id, text: r.text, ts: Date.parse(r.created_at) });

export function currentKey() {
  const v = state.view;
  if (v?.type === 'text') return `room:${v.id}`;
  if (v?.type === 'dm') return dmKey(state.me, v.id);
  return null;
}
export const unreadOf = (key) => channels.get(key)?.unread || 0;
export const dmChannels = () => [...channels.keys()].filter((k) => k.startsWith('dm:')).sort((a, b) => chan(b).last - chan(a).last);

export async function initChat(client) {
  sb = client;
  // Conversas diretas existentes (RLS só devolve as minhas)
  const { data } = await sb.from('messages').select('channel, created_at').like('channel', 'dm:%').order('id', { ascending: false }).limit(500);
  for (const r of data || []) { const c = chan(r.channel); c.last = Math.max(c.last, Date.parse(r.created_at)); }
}

export async function openChannel(key) {
  const c = chan(key);
  c.unread = 0;
  emit('unread');
  if (!c.loaded) {
    c.loaded = true;
    renderMessages();
    const { data, error } = await sb.from('messages').select('id, channel, from_id, text, created_at').eq('channel', key).order('id', { ascending: false }).limit(150);
    if (error) { toast({ title: 'Erro ao carregar mensagens', body: error.message }); c.loaded = false; return; }
    const older = data.reverse().map(norm);
    c.messages = [...older, ...c.messages.filter((m) => !older.some((o) => o.id === m.id))];
  }
  if (currentKey() === key) { renderMessages(true); renderComposer(); }
}

on('db:messages', (p) => {
  if (p.eventType === 'INSERT') {
    const m = norm(p.new);
    const c = chan(m.channel);
    if (c.messages.some((x) => x.id === m.id)) return;
    if (c.loaded) c.messages.push(m);
    c.last = m.ts;
    const visible = currentKey() === m.channel && document.visibilityState === 'visible';
    if (!visible && m.from !== state.me) {
      c.unread++;
      if (m.channel.startsWith('dm:')) {
        sounds.message();
        toast({ title: displayName(m.from), body: m.text, actions: [{ label: 'Responder', primary: true, onClick: () => emit('open-view', { type: 'dm', id: m.from }) }] });
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(`${displayName(m.from)} · Turbo Office`, { body: m.text.slice(0, 120) });
      }
    }
    emit('unread');
    if (currentKey() === m.channel) renderMessages();
  } else if (p.eventType === 'DELETE') {
    const id = p.old?.id;
    for (const c of channels.values()) c.messages = c.messages.filter((m) => m.id !== id);
    renderMessages();
  }
});

// ------------------------------------------------------------------ Render
const URL_RE = /(https?:\/\/[^\s<]+)/g;
function linkify(text) {
  const frag = document.createDocumentFragment();
  text.split(URL_RE).forEach((part, i) => {
    if (i % 2) frag.append(h('a', { href: part, target: '_blank', rel: 'noopener noreferrer' }, part));
    else if (part) frag.append(part);
  });
  return frag;
}
const fmtTime = (ts) => {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export function renderMessages(forceBottom = false) {
  const key = currentKey();
  if (!key) return;
  const box = $('#messages');
  const c = chan(key);
  const atBottom = forceBottom || box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = '';
  if (!c.loaded || !c.messages.length) {
    const title = key.startsWith('dm:') ? `Conversa com ${displayName(dmOther(key))}` : `Bem-vindo a #${state.rooms.get(key.slice(5))?.name || ''}`;
    box.append(h('div', { class: 'chat-empty' }, h('div', { class: 'big' }, key.startsWith('dm:') ? '💬' : '#'), h('h3', {}, title), c.loaded ? 'Nenhuma mensagem ainda. Diga oi! 👋' : 'Carregando…'));
    return;
  }
  let prev = null;
  for (const m of c.messages) {
    const cont = prev && prev.from === m.from && m.ts - prev.ts < 5 * 60e3;
    const canDelete = m.from === state.me || (myRank() >= 2 && key.startsWith('room:'));
    box.append(h('div', { class: `msg${cont ? ' cont' : ''}` },
      avatar(m.from),
      h('div', { style: 'min-width:0' },
        cont ? null : h('div', { class: 'head' }, h('span', { style: nameColor(state.profiles.get(m.from)) ? `color:${nameColor(state.profiles.get(m.from))}` : '' }, displayName(m.from)), h('time', {}, fmtTime(m.ts))),
        h('div', { class: 'body' }, linkify(m.text))),
      canDelete ? h('button', { class: 'icon-btn del', title: 'Apagar mensagem', onclick: () => deleteMessage(m.id) }, '🗑') : h('span')));
    prev = m;
  }
  if (atBottom || prev?.from === state.me) box.scrollTop = box.scrollHeight;
}

export function renderComposer() {
  const key = currentKey();
  const input = $('#msgInput');
  let can = true;
  let placeholder = '';
  if (key?.startsWith('room:')) {
    const r = state.rooms.get(key.slice(5));
    can = !!r && myRank() >= rank(r.write_role);
    placeholder = can ? `Mensagem em #${r?.name}` : `Só ${ROLES[r?.write_role]?.plural || ''} ou acima podem escrever aqui`;
  } else if (key) placeholder = `Mensagem para ${displayName(dmOther(key))}`;
  input.disabled = !can;
  input.placeholder = placeholder;
  $('#composer button').disabled = !can;
}

export async function sendMessage() {
  const key = currentKey();
  const input = $('#msgInput');
  const text = input.value.trim();
  if (!key || !text) return;
  input.value = '';
  const { error } = await sb.from('messages').insert({ channel: key, text });
  if (error) { input.value = text; toast({ title: 'Mensagem não enviada', body: error.message }); }
}

async function deleteMessage(id) {
  const { error } = await sb.from('messages').delete().eq('id', id);
  if (error) toast({ title: 'Não foi possível apagar', body: error.message });
}
