// Chat: canais de texto, mensagens diretas e o chat de cada sala de voz (tabela `messages`).
// Mensagens começando com "m!" são comandos do bot de música (Turbo Music).
import { state, emit, on, rank, myRank, displayName, dmKey, dmOther, ROLES } from './state.js';
import { $, h, avatar, toast, sounds, nameColor } from './ui.js';

let sb = null;
const channels = new Map(); // key -> { messages, loaded, unread, last }
let voiceChatOpen = localStorage.getItem('to.voiceChat') === '1';
let commandHandler = null; // (texto, canal) => void — registrado pelo bot de música

const chan = (key) => {
  if (!channels.has(key)) channels.set(key, { messages: [], loaded: false, loading: false, unread: 0, last: 0 });
  return channels.get(key);
};
const norm = (r) => ({ id: r.id, channel: r.channel, from: r.from_id, text: r.text, bot: !!r.bot, ts: Date.parse(r.created_at) });
export const BOT_NAME = 'Turbo Music';

// Canal da área principal (canal de texto ou DM)
export function currentKey() {
  const v = state.view;
  if (v?.type === 'text') return `room:${v.id}`;
  if (v?.type === 'dm') return dmKey(state.me, v.id);
  return null;
}
// Canal do chat lateral da sala de voz (quando aberto)
export function voiceChatKey() {
  return state.view?.type === 'voice' && voiceChatOpen ? `room:${state.view.id}` : null;
}
const isVisible = (key) => document.visibilityState === 'visible' && (currentKey() === key || voiceChatKey() === key);

export const unreadOf = (key) => channels.get(key)?.unread || 0;
export const dmChannels = () => [...channels.keys()].filter((k) => k.startsWith('dm:')).sort((a, b) => chan(b).last - chan(a).last);
export const isVoiceChatOpen = () => voiceChatOpen;
export function setVoiceChatOpen(open) {
  voiceChatOpen = open;
  localStorage.setItem('to.voiceChat', open ? '1' : '0');
  const key = voiceChatKey();
  if (key) openChannel(key);
  emit('voice-chat');
}
export const setCommandHandler = (fn) => { commandHandler = fn; };

export async function initChat(client) {
  sb = client;
  // Conversas diretas existentes (RLS só devolve as minhas)
  const { data } = await sb.from('messages').select('channel, created_at').like('channel', 'dm:%').order('id', { ascending: false }).limit(500);
  for (const r of data || []) { const c = chan(r.channel); c.last = Math.max(c.last, Date.parse(r.created_at)); }
}

export async function openChannel(key) {
  if (!key) return;
  const c = chan(key);
  c.unread = 0;
  emit('unread');
  if (!c.loaded && !c.loading) {
    c.loading = true;
    renderMessages();
    const { data, error } = await sb.from('messages').select('id, channel, from_id, text, bot, created_at').eq('channel', key).order('id', { ascending: false }).limit(150);
    c.loading = false;
    if (error) { toast({ title: 'Erro ao carregar mensagens', body: error.message }); return; }
    c.loaded = true;
    const older = data.reverse().map(norm);
    c.messages = [...older, ...c.messages.filter((m) => !older.some((o) => o.id === m.id))];
  }
  renderMessages(true);
  renderComposer();
}

on('db:messages', (p) => {
  if (p.eventType === 'INSERT') {
    const m = norm(p.new);
    const c = chan(m.channel);
    if (c.messages.some((x) => x.id === m.id)) return;
    if (c.loaded) c.messages.push(m);
    c.last = m.ts;
    if (!isVisible(m.channel) && m.from !== state.me) {
      c.unread++;
      if (m.channel.startsWith('dm:')) {
        sounds.message();
        toast({ title: displayName(m.from), body: m.text, actions: [{ label: 'Responder', primary: true, onClick: () => emit('open-view', { type: 'dm', id: m.from }) }] });
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(`${displayName(m.from)} · TurboFlow`, { body: m.text.slice(0, 120) });
      }
    }
    emit('unread');
    if (currentKey() === m.channel || voiceChatKey() === m.channel) renderMessages();
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
const isCommand = (t) => /^m!/i.test(t.trim());

function renderInto(key, box, forceBottom) {
  if (!key || !box) return;
  const c = chan(key);
  const atBottom = forceBottom || box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = '';
  if (!c.loaded || !c.messages.length) {
    const room = key.startsWith('room:') && state.rooms.get(key.slice(5));
    const title = key.startsWith('dm:') ? `Conversa com ${displayName(dmOther(key))}` : room?.kind === 'voice' ? `Chat de 🔊 ${room.name}` : `Bem-vindo a #${room?.name || ''}`;
    const hint = room?.kind === 'voice' ? 'Converse com quem está na sala. Para tocar música: m!play <link do YouTube ou nome>. Veja tudo com m!help.' : 'Nenhuma mensagem ainda. Diga oi! 👋';
    box.append(h('div', { class: 'chat-empty' }, h('div', { class: 'big' }, key.startsWith('dm:') ? '💬' : room?.kind === 'voice' ? '🎵' : '#'), h('h3', {}, title), c.loaded ? hint : 'Carregando…'));
    return;
  }
  let prev = null;
  for (const m of c.messages) {
    const cont = prev && prev.from === m.from && prev.bot === m.bot && m.ts - prev.ts < 5 * 60e3;
    const canDelete = m.from === state.me || (myRank() >= 2 && key.startsWith('room:'));
    const who = m.bot
      ? h('span', {}, BOT_NAME, h('span', { class: 'bot-tag' }, 'BOT'))
      : h('span', { style: nameColor(state.profiles.get(m.from)) ? `color:${nameColor(state.profiles.get(m.from))}` : '' }, displayName(m.from));
    box.append(h('div', { class: `msg${cont ? ' cont' : ''}${m.bot ? ' bot' : ''}${!m.bot && isCommand(m.text) ? ' cmd' : ''}`, 'data-uid': m.bot ? null : m.from },
      m.bot ? h('span', { class: 'avatar bot' }, '🎵') : avatar(m.from),
      h('div', { style: 'min-width:0' },
        cont ? null : h('div', { class: 'head' }, who, h('time', {}, fmtTime(m.ts))),
        h('div', { class: 'body' }, linkify(m.text))),
      canDelete ? h('button', { class: 'icon-btn del', title: 'Apagar mensagem', onclick: () => deleteMessage(m.id) }, '🗑') : h('span')));
    prev = m;
  }
  if (atBottom || prev?.from === state.me) box.scrollTop = box.scrollHeight;
}

export function renderMessages(forceBottom = false) {
  renderInto(currentKey(), $('#messages'), forceBottom);
  renderInto(voiceChatKey(), $('#vcMessages'), forceBottom);
}

function composerState(key) {
  if (key?.startsWith('room:')) {
    const r = state.rooms.get(key.slice(5));
    const can = !!r && myRank() >= rank(r.write_role);
    if (r?.kind === 'voice') return { can, placeholder: `Mensagem em 🔊 ${r.name} · m!play <música>` };
    return { can, placeholder: can ? `Mensagem em #${r?.name}` : `Só ${ROLES[r?.write_role]?.plural || ''} ou acima podem escrever aqui` };
  }
  return { can: true, placeholder: key ? `Mensagem para ${displayName(dmOther(key))}` : '' };
}

export function renderComposer() {
  const main = composerState(currentKey());
  $('#msgInput').disabled = !main.can;
  $('#msgInput').placeholder = main.placeholder;
  $('#composer button').disabled = !main.can;
  const vk = voiceChatKey();
  if (vk) {
    const v = composerState(vk);
    $('#vcInput').disabled = !v.can;
    $('#vcInput').placeholder = v.placeholder;
  }
}

async function send(key, input) {
  const text = input.value.trim();
  if (!key || !text) return;
  input.value = '';
  const { error } = await sb.from('messages').insert({ channel: key, text });
  if (error) { input.value = text; toast({ title: 'Mensagem não enviada', body: error.message }); return; }
  if (isCommand(text)) commandHandler?.(text, key);
}
export const sendMessage = () => send(currentKey(), $('#msgInput'));
export const sendVoiceMessage = () => send(voiceChatKey(), $('#vcInput'));

// Resposta do bot no chat (enviada pelo navegador de quem deu o comando)
export async function postBot(key, text) {
  if (!key) return;
  const { error } = await sb.from('messages').insert({ channel: key, text: text.slice(0, 2000), bot: true });
  if (error) toast({ title: BOT_NAME, body: text });
}

async function deleteMessage(id) {
  const { error } = await sb.from('messages').delete().eq('id', id);
  if (error) toast({ title: 'Não foi possível apagar', body: error.message });
}
