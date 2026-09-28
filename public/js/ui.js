// Interface: barra lateral (pessoas/chat), popovers, notificações e modal de configuração.
import { state, on, me, displayName, initials } from './state.js';
import { areaAt } from './map.js';
import { avatarPreview, AVATAR_OPTIONS } from './render.js';
import { local, startMic, startCam, stopCam, publishMedia, switchDevice } from './rtc.js';

const $ = (s) => document.querySelector(s);
const h = (tag, props = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
};

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const icons = {
  mic: svg('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/>'),
  micOff: svg('<path d="M15 9.3V5a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 5.1 2.1M19 10a7 7 0 0 1-1.1 3.8M5 10a7 7 0 0 0 11.2 5.6M12 17v5M3 3l18 18"/>'),
  cam: svg('<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/>'),
  camOff: svg('<path d="M16 16v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1M9.7 5H14a2 2 0 0 1 2 2v3.3l1 1L22 7v10M3 3l18 18"/>'),
  screen: svg('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4M9 10l3-3 3 3M12 7v6"/>'),
  people: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>'),
  chat: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
};

export const STATUS_LABEL = { available: 'Disponível', busy: 'Ocupado', away: 'Ausente' };
export const EMOTES = ['👋', '👍', '❤️', '😂', '🎉', '✋', '👏', '🤔'];
const HAIR_NAMES = ['Curto', 'Espetado', 'Longo', 'Coque', 'Careca'];

let actions = {};

export function initUI(a) {
  actions = a;
  $('#peopleBtn').insertAdjacentHTML('afterbegin', icons.people);
  $('#chatBtn').insertAdjacentHTML('afterbegin', icons.chat);
  $('#settingsBtn').innerHTML = icons.gear;
  $('#screenBtn').innerHTML = icons.screen;

  $('#peopleBtn').onclick = () => toggleSidebar('people');
  $('#chatBtn').onclick = () => toggleSidebar('chat');
  $('#closeSide').onclick = () => toggleSidebar(null);
  document.querySelectorAll('.side-tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  $('#peopleSearch').oninput = () => { peopleSig = ''; refreshPeople(); };
  $('#settingsBtn').onclick = () => openSetup('settings');
  $('#meBtn').onclick = (e) => { e.stopPropagation(); openStatusMenu(); };
  $('#emoteBtn').onclick = (e) => { e.stopPropagation(); openEmotePicker(); };
  $('#chatForm').onsubmit = (e) => { e.preventDefault(); sendChat(); };
  $('#spotClose').onclick = closeSpotlight;
  $('#spotlight').onclick = (e) => { if (e.target.id === 'spotlight') closeSpotlight(); };

  document.addEventListener('pointerdown', (e) => {
    for (const id of ['#emotePicker', '#statusMenu', '#playerCard']) {
      const el = $(id);
      if (!el.hidden && !el.contains(e.target)) el.hidden = true;
    }
  });

  on('range', () => { renderChannels(); peopleSig = ''; refreshPeople(); });
  setInterval(refreshPeople, 700);
}

// ------------------------------------------------------------------ Barra inferior
export function renderMeBar() {
  const p = me();
  if (!p) return;
  avatarPreview($('#meAvatar'), p.avatar, 2);
  $('.me-name').textContent = p.name;
  const st = $('.me-status');
  st.innerHTML = '';
  st.append(h('span', { class: `dot ${p.status}` }), p.statusText || STATUS_LABEL[p.status]);
}

export function renderMediaButtons() {
  const micOn = !!(local.mic && local.micOn);
  for (const [sel, on_, onIcon, offIcon] of [['#micBtn', micOn, icons.mic, icons.micOff], ['#camBtn', !!local.cam, icons.cam, icons.camOff], ['#pvMic', micOn, icons.mic, icons.micOff], ['#pvCam', !!local.cam, icons.cam, icons.camOff]]) {
    const b = $(sel);
    b.innerHTML = on_ ? onIcon : offIcon;
    b.classList.toggle('off', !on_);
  }
  $('#screenBtn').classList.toggle('on', !!local.screen);
  $('#screenBtn').title = local.screen ? 'Parar de compartilhar' : 'Compartilhar tela';
}

// ------------------------------------------------------------------ Sidebar
function toggleSidebar(tab) {
  const sb = $('#sidebar');
  const current = sb.hidden ? null : document.querySelector('.side-tabs .active')?.dataset.tab;
  if (!tab || current === tab) { sb.hidden = true; document.body.classList.remove('side-open'); return; }
  sb.hidden = false;
  document.body.classList.add('side-open');
  showTab(tab);
}
function showTab(tab) {
  document.querySelectorAll('.side-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#peoplePanel').hidden = tab !== 'people';
  $('#chatPanel').hidden = tab !== 'chat';
  if (tab === 'chat') { markRead(activeChannel); renderMessages(); setTimeout(() => $('#chatInput').focus(), 0); }
  else { peopleSig = ''; refreshPeople(); }
}
export function openChat(channel) {
  const sb = $('#sidebar');
  sb.hidden = false;
  document.body.classList.add('side-open');
  if (channel) selectChannel(channel);
  showTab('chat');
}
const chatVisible = () => !$('#sidebar').hidden && !$('#chatPanel').hidden;

// ------------------------------------------------------------------ Pessoas
let peopleSig = '';
export function refreshPeople() {
  $('#onlineCount').textContent = state.players.size;
  if ($('#sidebar').hidden || $('#peoplePanel').hidden) return;
  const term = $('#peopleSearch').value.trim().toLowerCase();
  const match = (n) => !term || n.toLowerCase().includes(term);
  const online = [...state.players.values()].filter((p) => match(p.name)).sort((a, b) => (a.id === state.me ? -1 : b.id === state.me ? 1 : a.name.localeCompare(b.name)));
  const offline = [...state.users.values()].filter((u) => !state.players.has(u.id) && match(u.name)).sort((a, b) => a.name.localeCompare(b.name));
  const sig = JSON.stringify([online.map((p) => [p.id, p.name, p.status, p.statusText, areaAt(p.x, p.y)?.id, state.inRange.has(p.id), p.avatar]), offline.map((u) => [u.id, u.name])]);
  if (sig === peopleSig) return;
  peopleSig = sig;

  const list = $('#peopleList');
  const scroll = list.scrollTop;
  list.innerHTML = '';
  list.append(h('div', { class: 'group-title' }, `Online — ${online.length}`));
  for (const p of online) list.append(personRow(p, true));
  if (offline.length) {
    list.append(h('div', { class: 'group-title' }, `Offline — ${offline.length}`));
    for (const u of offline) list.append(personRow(u, false));
  }
  list.scrollTop = scroll;
}

function personRow(p, isOnline) {
  const cv = h('canvas', { width: 72, height: 72 });
  avatarPreview(cv, p.avatar, 2);
  const isMe = p.id === state.me;
  const sub = h('div', { class: 'sub' });
  if (isOnline) {
    sub.append(h('span', { class: `dot ${p.status}` }));
    if (state.inRange.has(p.id)) sub.append(h('span', { class: 'near-tag' }, 'Conversando · '));
    sub.append(p.statusText || areaAt(p.x, p.y)?.name || STATUS_LABEL[p.status]);
  } else sub.append(h('span', { class: 'dot offline' }), 'Offline');

  const acts = h('div', { class: 'acts' });
  if (!isMe) {
    if (isOnline) acts.append(h('button', { title: 'Ir até', onclick: () => actions.gotoPlayer(p.id) }, '🚶'));
    acts.append(h('button', { title: 'Mensagem', onclick: () => openChat(dmKey(p.id)) }, '💬'));
    if (isOnline) acts.append(h('button', { title: 'Chamar', onclick: () => actions.ring(p.id) }, '🔔'));
  }
  return h('div', { class: `person${isOnline ? '' : ' offline'}` }, cv,
    h('div', { class: 'info' }, h('div', { class: 'name' }, p.name + (isMe ? ' (você)' : '')), sub), acts);
}

// ------------------------------------------------------------------ Chat
const channels = new Map(); // key -> { messages, unread, loaded, last }
let activeChannel = 'global';
export const dmKey = (other) => `dm:${Math.min(state.me, other)}:${Math.max(state.me, other)}`;
const dmOther = (key) => { const [, a, b] = key.split(':').map(Number); return a === state.me ? b : a; };
const channel = (key) => { if (!channels.has(key)) channels.set(key, { messages: [], unread: 0, loaded: key === 'nearby', last: 0 }); return channels.get(key); };

export function initChat(history, dmChannels) {
  channels.clear();
  const g = channel('global');
  g.messages = history; g.loaded = true; g.last = history.at(-1)?.ts || 0;
  channel('nearby');
  for (const k of dmChannels) channel(k);
  renderChannels(); renderMessages(); updateBadge();
}

function channelName(key) {
  if (key === 'global') return '# Todos';
  if (key === 'nearby') return `📍 Por perto${state.inRange.size ? ` (${state.inRange.size})` : ''}`;
  return displayName(dmOther(key));
}

function renderChannels() {
  const wrap = $('#chatChannels');
  wrap.innerHTML = '';
  const keys = ['global', 'nearby', ...[...channels.keys()].filter((k) => k.startsWith('dm:')).sort((a, b) => channel(b).last - channel(a).last)];
  for (const k of keys) {
    const c = channel(k);
    wrap.append(h('button', { class: `chan${k === activeChannel ? ' active' : ''}`, onclick: () => selectChannel(k) },
      channelName(k), c.unread ? h('span', { class: 'unread' }, String(c.unread)) : null));
  }
  $('#chatInput').placeholder = activeChannel === 'global' ? 'Mensagem para Todos' : activeChannel === 'nearby' ? 'Mensagem para quem está perto' : `Mensagem para ${channelName(activeChannel)}`;
}

function selectChannel(key) {
  activeChannel = key;
  const c = channel(key);
  if (!c.loaded) {
    c.loaded = true;
    state.socket.emit('history', key, (msgs) => { c.messages = [...msgs, ...c.messages.filter((m) => !msgs.some((x) => x.id === m.id))]; renderMessages(); });
  }
  markRead(key);
  renderChannels(); renderMessages();
}

function markRead(key) { channel(key).unread = 0; updateBadge(); renderChannels(); }
function updateBadge() {
  const n = [...channels.values()].reduce((s, c) => s + c.unread, 0);
  const b = $('#chatBadge');
  b.hidden = !n;
  b.textContent = n > 99 ? '99+' : String(n);
}

const URL_RE = /(https?:\/\/[^\s<]+)/g;
function linkify(text) {
  const frag = document.createDocumentFragment();
  text.split(URL_RE).forEach((part, i) => {
    if (i % 2) frag.append(h('a', { href: part, target: '_blank', rel: 'noopener noreferrer' }, part));
    else if (part) frag.append(part);
  });
  return frag;
}
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function renderMessages() {
  const box = $('#chatMessages');
  const msgs = channel(activeChannel).messages;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.innerHTML = '';
  if (!msgs.length) {
    box.append(h('div', { class: 'chat-empty' }, activeChannel === 'nearby' ? 'Mensagens aqui vão só para quem está conversando com você agora.' : 'Nenhuma mensagem ainda. Diga oi! 👋'));
    return;
  }
  let prev = null;
  for (const m of msgs) {
    const cont = prev && prev.from === m.from && m.ts - prev.ts < 5 * 60e3;
    const color = (state.players.get(m.from) || state.users.get(m.from))?.avatar?.shirt || '#64748b';
    box.append(h('div', { class: `msg${cont ? ' cont' : ''}` },
      h('div', { class: 'av', style: `background:${color}` }, initials(displayName(m.from))),
      h('div', {}, cont ? null : h('div', { class: 'head' }, displayName(m.from), h('time', {}, fmtTime(m.ts))), h('div', { class: 'body' }, linkify(m.text)))));
    prev = m;
  }
  if (atBottom || prev?.from === state.me) box.scrollTop = box.scrollHeight;
}

export function onChatMessage(m) {
  const c = channel(m.channel);
  if (c.messages.some((x) => x.id === m.id)) return;
  c.messages.push(m);
  if (c.messages.length > 300) c.messages.shift();
  c.last = m.ts;
  const visible = chatVisible() && activeChannel === m.channel;
  if (!visible && m.from !== state.me) {
    c.unread++;
    if (m.channel !== 'global') {
      toast({
        title: m.channel === 'nearby' ? `${displayName(m.from)} (por perto)` : displayName(m.from),
        body: m.text,
        actions: [{ label: 'Responder', primary: true, onClick: () => openChat(m.channel) }],
      });
      beep(660);
    }
  }
  updateBadge(); renderChannels();
  if (activeChannel === m.channel) renderMessages();
}

function sendChat() {
  const input = $('#chatInput');
  const text = input.value.trim();
  if (!text) return;
  if (activeChannel === 'global') state.socket.emit('chat', { channel: 'global', text });
  else if (activeChannel === 'nearby') {
    if (!state.inRange.size) { toast({ title: 'Ninguém por perto', body: 'Chegue perto de alguém para usar este canal.' }); return; }
    state.socket.emit('chat', { channel: 'nearby', to: [...state.inRange], text });
  } else state.socket.emit('chat', { to: dmOther(activeChannel), text });
  input.value = '';
}

export function focusChat() { openChat(); }

// ------------------------------------------------------------------ Popovers
function placeNear(el, x, y) {
  el.hidden = false;
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, x))}px`;
  el.style.top = `${Math.max(8, Math.min(window.innerHeight - r.height - 8, y))}px`;
}
function placeAbove(el, anchor) {
  el.hidden = false;
  const a = anchor.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  placeNear(el, a.left + a.width / 2 - r.width / 2, a.top - r.height - 10);
}

function openEmotePicker() {
  const el = $('#emotePicker');
  if (!el.hidden) { el.hidden = true; return; }
  el.innerHTML = '';
  EMOTES.forEach((e, i) => el.append(h('button', { onclick: () => { actions.emote(e); el.hidden = true; } }, e, h('kbd', {}, String(i + 1)))));
  placeAbove(el, $('#emoteBtn'));
}

function openStatusMenu() {
  const el = $('#statusMenu');
  if (!el.hidden) { el.hidden = true; return; }
  const p = me();
  el.innerHTML = '';
  for (const s of ['available', 'busy', 'away']) {
    el.append(h('button', { class: `menu-item${p.status === s ? ' active' : ''}`, onclick: () => { actions.setStatus(s, p.statusText); el.hidden = true; } },
      h('span', { class: `dot ${s}` }), s === 'busy' ? 'Ocupado — não perturbe' : STATUS_LABEL[s]));
  }
  const txt = h('input', { class: 'input', maxlength: 60, placeholder: 'Mensagem de status (ex.: Em call com cliente)', value: p.statusText || '' });
  txt.addEventListener('keydown', (e) => { if (e.key === 'Enter') { actions.setStatus(p.status, txt.value); el.hidden = true; } e.stopPropagation(); });
  el.append(h('div', { class: 'menu-sep' }), txt,
    h('div', { class: 'menu-sep' }),
    h('button', { class: 'menu-item', onclick: () => { el.hidden = true; openSetup('settings'); } }, '🎨 Editar avatar e dispositivos'),
    h('button', { class: 'menu-item', onclick: () => actions.logout() }, '🚪 Sair'));
  placeAbove(el, $('#meBtn'));
}

export function openPlayerCard(id, x, y) {
  const p = state.players.get(id);
  if (!p) return;
  const el = $('#playerCard');
  el.innerHTML = '';
  const cv = h('canvas', { width: 96, height: 96 });
  avatarPreview(cv, p.avatar, 2.6);
  const isMe = id === state.me;
  el.append(h('div', { class: 'card-head' }, cv, h('div', {},
    h('div', { class: 'name' }, p.name + (isMe ? ' (você)' : '')),
    h('div', { class: 'muted small' }, h('span', { class: `dot ${p.status}` }), ' ', p.statusText || STATUS_LABEL[p.status]),
    h('div', { class: 'muted small' }, areaAt(p.x, p.y)?.name || ''))));
  const acts = h('div', { class: 'card-acts' });
  const close = () => (el.hidden = true);
  if (isMe) acts.append(h('button', { class: 'btn', onclick: () => { close(); openSetup('settings'); } }, 'Editar avatar'));
  else acts.append(
    h('button', { class: 'btn primary', onclick: () => { close(); actions.gotoPlayer(id); } }, '🚶 Ir até'),
    h('button', { class: 'btn', onclick: () => { close(); openChat(dmKey(id)); } }, '💬 Mensagem'),
    h('button', { class: 'btn', onclick: () => { close(); actions.ring(id); } }, '🔔 Chamar'));
  el.append(acts);
  placeNear(el, x + 12, y - 40);
}

// ------------------------------------------------------------------ Toasts / som
export function toast({ title, body, actions: acts = [], timeout = 7000 }) {
  const el = h('div', { class: 'toast' }, h('div', { class: 't-title' }, title), body ? h('div', { class: 't-body' }, body) : null);
  const close = () => el.remove();
  if (acts.length) el.append(h('div', { class: 't-acts' }, acts.map((a) => h('button', { class: `btn${a.primary ? ' primary' : ''}`, onclick: () => { close(); a.onClick?.(); } }, a.label))));
  $('#toasts').append(el);
  while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
  if (timeout) setTimeout(close, timeout);
}

let beepCtx;
export function beep(freq = 880, dur = 0.12, times = 1) {
  try {
    beepCtx ??= new AudioContext();
    for (let i = 0; i < times; i++) {
      const o = beepCtx.createOscillator(), g = beepCtx.createGain();
      const t = beepCtx.currentTime + i * (dur + 0.08);
      o.frequency.value = freq; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.15, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(beepCtx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    }
  } catch {}
}

// ------------------------------------------------------------------ Spotlight
export function openSpotlight(stream, title) {
  const v = $('#spotlight video');
  v.srcObject = stream;
  v.play().catch(() => {});
  $('#spotTitle').textContent = title;
  $('#spotlight').hidden = false;
}
export function closeSpotlight() { $('#spotlight').hidden = true; $('#spotlight video').srcObject = null; }

// ------------------------------------------------------------------ Modal de configuração
let draft = null;
export function openSetup(mode) {
  const modal = $('#setupModal');
  const p = me();
  const settings = mode === 'settings';
  draft = { name: settings ? p.name : actions.profile().name, avatar: { ...(settings ? p.avatar : actions.profile().avatar) } };
  $('#setupTitle').textContent = settings ? 'Configurações' : 'Bem-vindo ao Turbo Office';
  $('#setupSub').textContent = settings ? 'Altere seu avatar, nome e dispositivos.' : 'Monte seu avatar e confira câmera e microfone antes de entrar.';
  $('#setupGo').textContent = settings ? 'Salvar' : 'Entrar no escritório';
  $('#setupCancel').hidden = !settings;
  $('#nameInput').value = draft.name;
  modal.hidden = false;
  renderSwatches(); updatePreview(); fillDevices();

  return new Promise((resolve) => {
    $('#pvMic').onclick = async () => {
      if (!local.mic) { local.micOn = true; await startMic(); } else { local.micOn = !local.micOn; local.mic.enabled = local.micOn; }
      if (settings) publishMedia();
      renderMediaButtons(); fillDevices();
    };
    $('#pvCam').onclick = async () => {
      if (local.cam) stopCam(); else await startCam();
      if (settings) publishMedia();
      renderMediaButtons(); updatePreview(); fillDevices();
    };
    $('#micSelect').onchange = (e) => switchDevice('mic', e.target.value);
    $('#camSelect').onchange = async (e) => { await switchDevice('cam', e.target.value); updatePreview(); };
    $('#nameInput').oninput = (e) => (draft.name = e.target.value);
    $('#nameInput').onkeydown = (e) => e.stopPropagation();
    $('#setupCancel').onclick = () => { modal.hidden = true; $('#previewVideo').srcObject = null; resolve(null); };
    $('#setupGo').onclick = () => {
      const name = draft.name.trim();
      if (!name) { $('#nameInput').focus(); return; }
      modal.hidden = true;
      $('#previewVideo').srcObject = null;
      if (settings) actions.saveProfile(name, draft.avatar);
      resolve({ name, avatar: draft.avatar });
    };
  });
}

export function refreshSetup() { updatePreview(); fillDevices(); }

function updatePreview() {
  const v = $('#previewVideo');
  if (local.cam) { if (v.srcObject?.getVideoTracks()[0] !== local.cam) v.srcObject = new MediaStream([local.cam]); }
  else v.srcObject = null;
  $('.preview').classList.toggle('off', !local.cam);
  renderMediaButtons();
}

function renderSwatches() {
  const wrap = $('#swatches');
  wrap.innerHTML = '';
  const rows = [['skin', 'Pele'], ['hairStyle', 'Cabelo'], ['hair', 'Cor do cabelo'], ['shirt', 'Camiseta'], ['pants', 'Calça']];
  for (const [key, label] of rows) {
    const row = h('div', { class: 'sw-row' }, h('span', { class: 'lbl' }, label));
    for (const v of AVATAR_OPTIONS[key]) {
      const sel = draft.avatar[key] === v;
      const b = key === 'hairStyle'
        ? h('button', { class: `sw style${sel ? ' sel' : ''}`, type: 'button' }, HAIR_NAMES[v])
        : h('button', { class: `sw${sel ? ' sel' : ''}`, type: 'button', style: `background:${v}`, title: v });
      b.onclick = () => { draft.avatar[key] = v; renderSwatches(); };
      row.append(b);
    }
    wrap.append(row);
  }
  avatarPreview($('#avatarCanvas'), draft.avatar, 3.4);
}

async function fillDevices() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    for (const [sel, kind, current] of [['#micSelect', 'audioinput', local.mic?.getSettings().deviceId], ['#camSelect', 'videoinput', local.cam?.getSettings().deviceId || local.camDeviceId]]) {
      const el = $(sel);
      const list = devs.filter((d) => d.kind === kind);
      el.innerHTML = '';
      if (!list.length || !list[0].label) { el.append(h('option', {}, list.length ? 'Permita o acesso para listar' : 'Nenhum dispositivo')); continue; }
      list.forEach((d, i) => el.append(h('option', { value: d.deviceId }, d.label || `Dispositivo ${i + 1}`)));
      if (current) el.value = current;
    }
  } catch {}
}
