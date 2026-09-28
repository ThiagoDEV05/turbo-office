// Renderização da interface: canais, membros, cabeçalho, popovers, modais e notificações.
import {
  state, on, ROLES, rank, myProfile, myRank, canManageRooms, canModerate, STATUS_LABEL, COLORS,
  displayName, colorOf, initials, membersIn, dmOther, photoOf,
} from './state.js';
import {
  local, switchDevice, getUserVolume, setUserVolume, setSpeaker, canPickSpeaker,
  getAudioProcessing, setAudioProcessing, getScreenQuality, setScreenQuality, SCREEN_PRESETS,
} from './rtc.js';
import { THEMES, GRADIENTS, ACCENTS, getPrefs, applyPrefs } from './prefs.js';

export const $ = (s) => document.querySelector(s);
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const icons = {
  mic: svg('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/>'),
  micOff: svg('<path d="M15 9.3V5a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 5.1 2.1M19 10a7 7 0 0 1-1.1 3.8M5 10a7 7 0 0 0 11.2 5.6M12 17v5M3 3l18 18"/>'),
  cam: svg('<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/>'),
  camOff: svg('<path d="M16 16v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1M9.7 5H14a2 2 0 0 1 2 2v3.3l1 1L22 7v10M3 3l18 18"/>'),
  screen: svg('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4M9 10l3-3 3 3M12 7v6"/>'),
  head: svg('<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="2" y="14" width="5" height="7" rx="2"/><rect x="17" y="14" width="5" height="7" rx="2"/>'),
  headOff: svg('<path d="M3 14v-2a9 9 0 0 1 14.5-7.1M21 12v2"/><rect x="2" y="14" width="5" height="7" rx="2"/><rect x="17" y="14" width="5" height="7" rx="2"/><path d="M3 3l18 18"/>'),
  leave: svg('<path d="M10.7 13.3a13 13 0 0 1-2.4-3.3l1.5-1.5a1 1 0 0 0 .2-1.1L8.6 4.6A1 1 0 0 0 7.5 4H4a1 1 0 0 0-1 1 17 17 0 0 0 4.9 11.1M13.3 10.7M22 2L2 22M17.1 16.1l1.3-1.3a1 1 0 0 1 1.1-.2l2.8 1.3a1 1 0 0 1 .6 1V20a1 1 0 0 1-1 1 17 17 0 0 1-8.4-2.3"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  speaker: svg('<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>'),
  people: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>'),
};

let A = {}; // ações registradas pelo app.js
export function setActions(actions) { A = actions; }

// ------------------------------------------------------------------ Avatar
const SAFE_URL = /^https:\/\/[^\s"')]+$/;
const HEX = /^#[0-9a-f]{6}$/i;
export const DECORATIONS = { '': 'Nenhuma', neon: 'Neon', fogo: 'Fogo', ouro: 'Ouro', 'arco-iris': 'Arco-íris', gelo: 'Gelo', turbo: 'Turbo' };

// Avatar a partir de um perfil (serve também para prévias com rascunho)
export function avatarOf(p, size = '', status = null, speaking = false) {
  const photo = SAFE_URL.test(p?.avatar_url || '') ? p.avatar_url : null;
  const color = HEX.test(p?.color || '') ? p.color : '#64748b';
  const cls = `avatar ${size}${photo ? ' photo' : ''}${speaking ? ' speaking' : ''}`;
  const el = photo ? h('span', { class: cls, style: `background-image:url("${photo}")` }) : h('span', { class: cls, style: `background:${color}` }, initials(p?.name));
  if (p?.decoration && DECORATIONS[p.decoration]) el.dataset.deco = p.decoration;
  if (status) el.append(h('span', { class: `st ${status}` }));
  return el;
}

export function avatar(id, size = '', withStatus = false) {
  const pr = state.presence.get(id);
  return avatarOf(state.profiles.get(id), size, withStatus ? (pr ? pr.status : 'offline') : null, state.speaking.has(id));
}

// Cor do nome: a escolhida pela pessoa, senão a do cargo
export function nameColor(p) {
  if (HEX.test(p?.name_color || '')) return p.name_color;
  return p && p.role !== 'membro' ? ROLES[p.role]?.color : '';
}

function bannerStyle(p) {
  if (SAFE_URL.test(p?.banner_url || '')) return `background-image:url("${p.banner_url}")`;
  const c1 = HEX.test(p?.banner_color || '') ? p.banner_color : (HEX.test(p?.color || '') ? p.color : '#22d3ee');
  const c2 = HEX.test(p?.banner_color2 || '') ? p.banner_color2 : null;
  return c2 ? `background:linear-gradient(135deg, ${c1}, ${c2})` : `background:${c1}`;
}

const memberSince = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

// Cartão de perfil estilo Discord (faixa, avatar com moldura, status, bio, membro desde)
export function profileCard(p, pr) {
  const room = pr?.room && state.rooms.get(pr.room);
  const handle = (p?.email || '').split('@')[0];
  return h('div', { class: 'pcard' },
    h('div', { class: 'pc-banner', style: bannerStyle(p) }),
    h('div', { class: 'pc-head' }, avatarOf(p, 'xl', pr ? pr.status : 'offline'),
      pr?.statusText ? h('div', { class: 'pc-bubble' }, pr.statusText) : null),
    h('div', { class: 'pc-body' },
      h('div', { class: 'pc-name', style: nameColor(p) ? `color:${nameColor(p)}` : '' }, p?.name || ''),
      h('div', { class: 'pc-sub' }, [handle, p?.pronouns].filter(Boolean).join(' • ')),
      h('div', { class: 'pc-badges' },
        h('span', { class: 'role-badge', style: `color:${ROLES[p?.role]?.color || 'inherit'}` }, ROLES[p?.role]?.label || ''),
        h('span', { class: 'role-badge' }, pr ? (room ? `🔊 ${room.name}` : STATUS_LABEL[pr.status]) : 'Offline')),
      p?.bio ? h('div', { class: 'pc-sec' }, h('h4', {}, 'Sobre mim'), h('p', {}, p.bio)) : null,
      h('div', { class: 'pc-sec' }, h('h4', {}, 'Membro desde'), h('p', {}, memberSince(p?.created_at)))));
}

// ------------------------------------------------------------------ Lista de canais
// Dentro de cada categoria: canais de texto primeiro, depois salas de voz (como no Discord).
const byPos = (a, b) => (a.kind === b.kind ? 0 : a.kind === 'text' ? -1 : 1) || a.position - b.position || a.name.localeCompare(b.name);
const isActive = (type, id) => state.view?.type === type && state.view.id === id;
const viewType = (r) => (r.kind === 'text' ? 'text' : 'voice');

let collapsed = new Set();
try { collapsed = new Set(JSON.parse(localStorage.getItem('to.collapsed') || '[]')); } catch {}
let lastUnreadOf = () => 0;
function toggleCollapsed(id) {
  collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
  try { localStorage.setItem('to.collapsed', JSON.stringify([...collapsed])); } catch {}
  renderChannels(lastUnreadOf);
}

function roomEntry(r, unreadOf) {
  const manage = canManageRooms() && myRank() >= rank(r.min_role);
  const lock = r.min_role !== 'membro' ? h('span', { class: 'lock', title: `Só ${ROLES[r.min_role].label}+` }, '🔒') : null;
  const edit = manage ? h('span', { class: 'edit', title: 'Editar', onclick: (e) => { e.stopPropagation(); openRoomModal(r); } }, '⚙') : null;
  if (r.kind === 'text') {
    const unread = unreadOf(`room:${r.id}`);
    return [h('button', { class: `chan${isActive('text', r.id) ? ' active' : ''}${unread ? ' unread' : ''}`, onclick: () => A.selectView({ type: 'text', id: r.id }) },
      h('span', { class: 'ico hash' }, '#'), h('span', { class: 'nm' }, r.name), lock,
      unread ? h('span', { class: 'badge' }, unread > 99 ? '99+' : String(unread)) : null, edit)];
  }
  const inside = membersIn(r.id);
  const here = state.voiceRoom === r.id;
  const btn = h('button', { class: `chan voice${isActive('voice', r.id) ? ' active' : ''}${here ? ' here' : ''}`, onclick: () => A.joinVoice(r.id), title: here ? 'Você está nesta sala' : 'Entrar na sala' },
    h('span', { class: 'ico' }), h('span', { class: 'nm' }, r.name), lock, edit);
  btn.querySelector('.ico').innerHTML = icons.speaker;
  const out = [btn];
  if (inside.length) {
    const list = h('div', { class: 'voice-members' });
    for (const id of inside.sort((a, b) => displayName(a).localeCompare(displayName(b)))) {
      const p = state.presence.get(id);
      const flags = `${p.media.screen ? '🖥️' : ''}${p.media.cam ? '📷' : ''}${p.media.mic ? '' : '🔇'}${p.deaf ? '🎧' : ''}`;
      list.append(h('div', { class: 'vm', onclick: (e) => openMemberPopover(id, e.currentTarget) }, avatar(id, 'xs'), h('span', { class: 'nm' }, displayName(id)), h('span', { class: 'flags' }, flags)));
    }
    out.push(list);
  }
  return out;
}

export function renderChannels(unreadOf) {
  lastUnreadOf = unreadOf;
  const nav = $('#channelList');
  const scroll = nav.scrollTop;
  nav.innerHTML = '';
  const manage = canManageRooms();
  const rooms = [...state.rooms.values()];
  const cats = [...state.categories.values()].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

  for (const r of rooms.filter((r) => !r.category_id || !state.categories.has(r.category_id)).sort(byPos)) nav.append(...roomEntry(r, unreadOf));

  for (const c of cats) {
    const list = rooms.filter((r) => r.category_id === c.id).sort(byPos);
    const isCollapsed = collapsed.has(c.id);
    const unreadInside = list.some((r) => r.kind === 'text' && unreadOf(`room:${r.id}`));
    nav.append(h('div', { class: `cat${isCollapsed ? ' collapsed' : ''}` },
      h('button', { class: 'cat-toggle', onclick: () => toggleCollapsed(c.id), title: isCollapsed ? 'Expandir' : 'Recolher' },
        h('span', { class: 'cat-name' }, c.name), h('span', { class: 'chev' }, '›'), isCollapsed && unreadInside ? h('span', { class: 'cat-dot' }) : null),
      manage && myRank() >= rank(c.min_role) ? h('button', { class: 'icon-btn cat-edit', title: 'Editar categoria', onclick: () => openCategoryModal(c) }, '⚙') : null,
      manage && myRank() >= rank(c.min_role) ? h('button', { class: 'icon-btn cat-add', title: 'Criar sala nesta categoria', onclick: () => openRoomModal(null, 'voice', c.id) }, '+') : null));
    // Recolhida: continua mostrando a sala aberta, a sala onde estou e salas com gente
    const visible = isCollapsed
      ? list.filter((r) => isActive(viewType(r), r.id) || state.voiceRoom === r.id || membersIn(r.id).length)
      : list;
    for (const r of visible) nav.append(...roomEntry(r, unreadOf));
  }
  if (manage) nav.append(h('button', { class: 'add-cat', onclick: () => openCategoryModal(null) }, '+ Criar categoria'));

  const dms = A.dmChannels?.() || [];
  if (dms.length) {
    nav.append(h('div', { class: 'cat static' }, h('span', { class: 'cat-name' }, 'Mensagens diretas')));
    for (const key of dms) {
      const other = dmOther(key);
      if (!state.profiles.has(other)) continue;
      const unread = unreadOf(key);
      nav.append(h('button', { class: `chan${isActive('dm', other) ? ' active' : ''}${unread ? ' unread' : ''}`, onclick: () => A.selectView({ type: 'dm', id: other }) },
        avatar(other, 'xs', true), h('span', { class: 'nm' }, displayName(other)),
        unread ? h('span', { class: 'badge' }, String(unread)) : null));
    }
  }
  nav.scrollTop = scroll;
}

// ------------------------------------------------------------------ Membros (coluna direita)
export function renderMembers() {
  const list = $('#memberList');
  const scroll = list.scrollTop;
  list.innerHTML = '';
  const all = [...state.profiles.values()].sort((a, b) => a.name.localeCompare(b.name));
  const online = all.filter((p) => state.presence.has(p.id));
  const offline = all.filter((p) => !state.presence.has(p.id));
  for (const role of ['admin', 'gestor', 'membro']) {
    const group = online.filter((p) => p.role === role);
    if (!group.length) continue;
    list.append(h('div', { class: 'sec-head' }, `${ROLES[role].plural} — ${group.length}`));
    for (const p of group) list.append(memberRow(p, true));
  }
  if (offline.length) {
    list.append(h('div', { class: 'sec-head' }, `Offline — ${offline.length}`));
    for (const p of offline) list.append(memberRow(p, false));
  }
  list.scrollTop = scroll;
}

function memberRow(p, isOnline) {
  const pr = state.presence.get(p.id);
  let sub = '';
  if (isOnline) {
    const room = pr.room && state.rooms.get(pr.room);
    sub = pr.statusText || (room ? `🔊 ${room.name}` : pr.room ? '🔊 Em uma sala' : STATUS_LABEL[pr.status]);
  }
  return h('div', { class: `member${isOnline ? '' : ' offline'}`, onclick: (e) => openMemberPopover(p.id, e.currentTarget) },
    avatar(p.id, 'sm', true),
    h('div', { class: 'info' }, h('div', { class: 'name', style: nameColor(p) ? `color:${nameColor(p)}` : '' }, p.name), sub ? h('div', { class: 'sub' }, sub) : null));
}

// ------------------------------------------------------------------ Cabeçalho, painel do usuário e controles
export function renderHeader() {
  const v = state.view;
  let icon = '', title = '', sub = '';
  if (v?.type === 'text') {
    const r = state.rooms.get(v.id);
    icon = '#'; title = r?.name || '';
    sub = r?.write_role !== 'membro' ? `Só ${ROLES[r.write_role].label}+ podem escrever` : '';
  } else if (v?.type === 'voice') {
    const r = state.rooms.get(v.id);
    icon = '🔊'; title = r?.name || '';
    const n = membersIn(v.id).length;
    sub = n ? `${n} ${n === 1 ? 'pessoa' : 'pessoas'}` : 'Vazia';
  } else if (v?.type === 'dm') {
    icon = '@'; title = displayName(v.id);
    const pr = state.presence.get(v.id);
    sub = pr ? (pr.statusText || STATUS_LABEL[pr.status]) : 'Offline';
  }
  $('#mainIcon').textContent = icon;
  $('#mainTitle').textContent = title;
  $('#mainSub').textContent = sub;
}

export function renderUserPanel() {
  const p = myProfile();
  const pr = state.presence.get(state.me);
  if (!p) return;
  const av = $('#meAvatar');
  av.replaceWith(Object.assign(avatar(state.me, 'sm', true), { id: 'meAvatar' }));
  $('#meName').textContent = p.name;
  $('#meStatus').textContent = pr?.statusText || `${STATUS_LABEL[pr?.status || 'available']} · ${ROLES[p.role].label}`;
}

export function renderControls() {
  const inRoom = !!state.voiceRoom;
  const micOn = !!(local.micOn && !state.modMuted && !state.deafened);
  const set = (sel, on_, onIcon, offIcon, title) => {
    const b = $(sel);
    b.innerHTML = on_ ? onIcon : offIcon;
    b.classList.toggle('off', !on_);
    if (title) b.title = title;
  };
  set('#micBtn', micOn, icons.mic, icons.micOff, state.modMuted ? 'Mutado por um Gestor/Admin' : 'Microfone (Ctrl+Shift+A)');
  set('#cMic', micOn, icons.mic, icons.micOff, state.modMuted ? 'Mutado por um Gestor/Admin' : 'Microfone (Ctrl+Shift+A)');
  $('#micBtn').disabled = $('#cMic').disabled = state.modMuted;
  set('#deafBtn', !state.deafened, icons.head, icons.headOff);
  set('#cDeaf', !state.deafened, icons.head, icons.headOff);
  const cam = $('#cCam');
  cam.innerHTML = local.cam ? icons.cam : icons.camOff;
  cam.classList.toggle('on', !!local.cam);
  const scr = $('#cScreen');
  scr.innerHTML = icons.screen;
  scr.classList.toggle('on', !!local.screen);
  scr.title = local.screen ? 'Parar de compartilhar' : 'Compartilhar tela';
  $('#cLeave').innerHTML = icons.leave;
  $('#settingsBtn').innerHTML = icons.gear;
  $('#membersToggle').innerHTML = icons.people;

  $('#voicePanel').hidden = !inRoom;
  if (inRoom) {
    $('#vpRoom').textContent = state.rooms.get(state.voiceRoom)?.name || '';
    $('#vpStatus').textContent = state.connected ? 'Voz conectada' : 'Reconectando…';
    $('#vpStatus').classList.toggle('warn', !state.connected);
  }
}

export function renderVoiceView() {
  const v = state.view;
  if (v?.type !== 'voice') return;
  const inThis = state.voiceRoom === v.id;
  $('#voiceLobby').hidden = inThis;
  $('#stage').hidden = !inThis;
  $('#callBar').hidden = !inThis;
  if (!inThis) {
    const r = state.rooms.get(v.id);
    $('#lobbyTitle').textContent = r?.name || '';
    const people = $('#lobbyPeople');
    people.innerHTML = '';
    const inside = membersIn(v.id);
    if (!inside.length) people.append('Ninguém na sala ainda.');
    for (const id of inside) people.append(h('span', { class: 'lobby-chip' }, avatar(id, 'xs'), displayName(id)));
  }
}

// ------------------------------------------------------------------ Popovers
export function closePopover() { $('#popover').hidden = true; }
function showPopover(anchor, build, side = 'auto') {
  const el = $('#popover');
  el.innerHTML = '';
  el.className = 'popover';
  build(el);
  el.hidden = false;
  const a = anchor.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  let x, y;
  if (side === 'above') { x = a.left; y = a.top - r.height - 8; }
  else if (a.left > innerWidth / 2) { x = a.left - r.width - 10; y = a.top; }
  else { x = a.right + 10; y = a.top; }
  el.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, x))}px`;
  el.style.top = `${Math.max(8, Math.min(innerHeight - r.height - 8, y))}px`;
}

export function openMemberPopover(id, anchor) {
  const p = state.profiles.get(id);
  if (!p) return;
  showPopover(anchor, (el) => {
    const pr = state.presence.get(id);
    const isMe = id === state.me;
    const room = pr?.room && state.rooms.get(pr.room);
    el.classList.add('profile');
    el.append(profileCard(p, pr));
    const box = h('div', { class: 'pc-acts' });
    el.append(box);
    if (isMe) {
      box.append(h('button', { class: 'menu-item', onclick: () => { closePopover(); openSettings('profile'); } }, '✏️ Editar perfil'));
      return;
    }
    box.append(h('button', { class: 'menu-item', onclick: () => { closePopover(); A.selectView({ type: 'dm', id }); } }, '💬 Mensagem'));
    if (pr && state.voiceRoom && pr.room !== state.voiceRoom) box.append(h('button', { class: 'menu-item', onclick: () => { closePopover(); A.ring(id); } }, '🔔 Chamar para minha sala'));
    if (pr?.room && pr.room !== state.voiceRoom && state.rooms.has(pr.room)) box.append(h('button', { class: 'menu-item', onclick: () => { closePopover(); A.joinVoice(pr.room); } }, `🔊 Entrar em ${room.name}`));
    if (state.voiceRoom && pr?.room === state.voiceRoom) {
      const range = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: getUserVolume(id) });
      range.oninput = () => setUserVolume(id, Number(range.value));
      box.append(h('div', { class: 'menu-label' }, 'Volume para você'), h('div', { class: 'pop-row' }, range));
    }
    if (canModerate(id)) {
      box.append(h('div', { class: 'menu-sep' }), h('div', { class: 'menu-label' }, 'Moderação'));
      if (pr?.room) {
        box.append(
          h('button', { class: 'menu-item', onclick: () => { closePopover(); A.moderate(id, 'mute'); } }, '🔇 Mutar na sala'),
          h('button', { class: 'menu-item', onclick: () => { closePopover(); A.moderate(id, 'unmute'); } }, '🎙️ Desmutar'),
          h('button', { class: 'menu-item', onclick: () => { closePopover(); A.moderate(id, 'kick'); } }, '⏏ Remover da sala'));
      }
      if (pr) box.append(h('button', { class: 'menu-item', onclick: () => openMoveMenu(id, anchor) }, '↪️ Mover para outra sala…'));
      const ban = state.bans.get(id);
      if (ban) box.append(h('button', { class: 'menu-item', onclick: () => { closePopover(); A.unban(id); } }, `✅ Desbanir (${banLabel(ban)})`));
      else box.append(h('button', { class: 'menu-item danger', onclick: () => openBanMenu(id, anchor) }, '⛔ Banir…'));
    }
    if (myRank() === 3) {
      const sel = h('select', { class: 'input' }, ['membro', 'gestor', 'admin'].map((r) => h('option', { value: r, selected: p.role === r }, ROLES[r].label)));
      sel.onchange = () => A.setRole(id, sel.value);
      box.append(h('div', { class: 'menu-sep' }), h('div', { class: 'menu-label' }, 'Cargo'), h('div', { class: 'pop-row' }, sel));
    }
  });
}

async function audioDevices(kind) {
  const want = kind === 'mic' ? 'audioinput' : 'audiooutput';
  let list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === want);
  if (list.length && !list.some((d) => d.label)) {
    // Sem permissão ainda o navegador esconde os nomes: pede o microfone rapidinho
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === want);
    } catch {}
  }
  return list;
}

export async function openDeviceMenu(kind, anchor) {
  const list = await audioDevices(kind);
  showPopover(anchor, (el) => {
    el.append(h('div', { class: 'menu-label' }, kind === 'mic' ? 'Microfone (entrada)' : 'Fone / alto-falante (saída)'));
    if (kind === 'spk' && !canPickSpeaker) {
      el.append(h('div', { class: 'pop-row muted' }, 'Este navegador não deixa escolher a saída de áudio. Use o Chrome ou o Edge, ou troque a saída nas configurações de som do computador.'));
      return;
    }
    if (!list.length) el.append(h('div', { class: 'pop-row muted' }, 'Nenhum dispositivo encontrado.'));
    const current = (kind === 'mic' ? local.micDeviceId : local.speakerDeviceId) || 'default';
    const hasCurrent = list.some((d) => d.deviceId === current);
    list.forEach((d, i) => {
      const sel = d.deviceId === current || (!hasCurrent && i === 0);
      el.append(h('button', {
        class: `dev-item${sel ? ' sel' : ''}`,
        onclick: async () => {
          closePopover();
          if (kind === 'mic') await switchDevice('mic', d.deviceId); else await setSpeaker(d.deviceId);
          toast({ title: kind === 'mic' ? '🎙️ Microfone alterado' : '🎧 Saída de áudio alterada', body: d.label || 'Dispositivo', timeout: 2500 });
          if (kind === 'spk') sounds.message();
        },
      }, h('span', { class: 'radio' }), h('span', { class: 'lbl' }, d.label || `Dispositivo ${i + 1}`)));
    });
    el.append(h('div', { class: 'menu-sep' }), h('button', { class: 'menu-item', onclick: () => { closePopover(); openSettings('voice'); } }, '⚙️ Configurações de voz e vídeo'));
  }, 'above');
}

export function openStatusMenu(anchor) {
  showPopover(anchor, (el) => {
    const pr = state.presence.get(state.me) || {};
    for (const s of ['available', 'busy', 'away']) {
      el.append(h('button', { class: `menu-item${pr.status === s ? ' active' : ''}`, onclick: () => { A.setStatus(s, pr.statusText); closePopover(); } },
        h('span', { class: `dot ${s}` }), s === 'busy' ? 'Ocupado — não perturbe' : STATUS_LABEL[s]));
    }
    const txt = h('input', { class: 'input', maxlength: 60, placeholder: 'Mensagem de status (Enter para salvar)', value: pr.statusText || '' });
    txt.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { A.setStatus(pr.status || 'available', txt.value.trim()); closePopover(); } });
    el.append(h('div', { class: 'menu-sep' }), h('div', { class: 'pop-row' }, txt), h('div', { class: 'menu-sep' }),
      h('button', { class: 'menu-item', onclick: () => { closePopover(); openSettings(); } }, '⚙️ Configurações'),
      h('button', { class: 'menu-item danger', onclick: () => A.logout() }, '🚪 Sair'));
  }, 'above');
}

// ------------------------------------------------------------------ Toasts / som
export function toast({ title, body, actions = [], timeout = 7000 }) {
  const el = h('div', { class: 'toast' }, h('div', { class: 't-title' }, title), body ? h('div', { class: 't-body' }, body) : null);
  const close = () => el.remove();
  if (actions.length) el.append(h('div', { class: 't-acts' }, actions.map((a) => h('button', { class: `btn${a.primary ? ' primary' : ''}`, onclick: () => { close(); a.onClick?.(); } }, a.label))));
  $('#toasts').append(el);
  while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
  if (timeout) setTimeout(close, timeout);
}

// Sons curtos sintetizados (sem arquivos). Um AudioContext só, liberado no primeiro clique.
let sfx = null;
function sfxCtx() {
  if (!sfx) {
    sfx = new (window.AudioContext || window.webkitAudioContext)();
    if (local.speakerDeviceId && sfx.setSinkId) sfx.setSinkId(local.speakerDeviceId).catch(() => {});
  }
  if (sfx.state === 'suspended') sfx.resume();
  return sfx;
}
document.addEventListener('pointerdown', () => { try { sfxCtx(); } catch {} }, { once: true, capture: true });
on('speaker', (id) => sfx?.setSinkId?.(id).catch(() => {}));

// notes: [frequência, início (s), duração (s)]
function play(notes, { type = 'sine', volume = 0.22 } = {}) {
  try {
    const ctx = sfxCtx();
    const master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    for (const [f, start, dur] of notes) {
      const t = ctx.currentTime + 0.01 + start;
      for (const [mult, amp, wave] of [[1, 1, type], [2, 0.18, 'sine']]) { // fundamental + harmônico suave
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = wave; o.frequency.setValueAtTime(f * mult, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(amp, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(master);
        o.start(t); o.stop(t + dur + 0.05);
      }
    }
  } catch {}
}
export const sounds = {
  // eu entro / saio da sala
  join: () => play([[523.25, 0, 0.16], [659.25, 0.09, 0.16], [783.99, 0.18, 0.32]], { type: 'triangle', volume: 0.3 }),
  leave: () => play([[783.99, 0, 0.16], [659.25, 0.09, 0.16], [440, 0.18, 0.32]], { type: 'triangle', volume: 0.3 }),
  // outra pessoa entra / sai da minha sala
  peerJoin: () => play([[659.25, 0, 0.14], [987.77, 0.08, 0.26]], { type: 'triangle', volume: 0.22 }),
  peerLeave: () => play([[987.77, 0, 0.14], [587.33, 0.08, 0.26]], { type: 'triangle', volume: 0.22 }),
  mute: () => play([[880, 0, 0.07], [587.33, 0.06, 0.12]], { volume: 0.18 }),
  unmute: () => play([[587.33, 0, 0.07], [880, 0.06, 0.12]], { volume: 0.18 }),
  message: () => play([[1046.5, 0, 0.1], [1318.5, 0.07, 0.18]], { volume: 0.16 }),
  ring: () => play([0, 0.5, 1.0].flatMap((s0) => [[880, s0, 0.18], [1174.66, s0 + 0.16, 0.26]]), { type: 'triangle', volume: 0.3 }),
};
export const beep = () => sounds.message();

// ------------------------------------------------------------------ Spotlight
export function openSpotlight(stream, title) {
  const v = $('#spotlight video');
  v.srcObject = stream;
  v.play().catch(() => {});
  $('#spotTitle').textContent = title;
  $('#spotlight').hidden = false;
}
export function closeSpotlight() { $('#spotlight').hidden = true; $('#spotlight video').srcObject = null; }

// ------------------------------------------------------------------ Modal: sala
function roleOptions(select, current) {
  select.innerHTML = '';
  for (const r of ['membro', 'gestor', 'admin']) {
    if (rank(r) > myRank()) continue;
    select.append(h('option', { value: r, selected: r === current }, r === 'membro' ? 'Todos' : `${ROLES[r].plural} ou acima`));
  }
}

export function openRoomModal(room, kind = 'voice', categoryId = null) {
  const modal = $('#roomModal');
  const f = $('#roomForm');
  $('#roomModalTitle').textContent = room ? `Editar ${room.kind === 'text' ? 'canal' : 'sala'}` : 'Criar sala';
  f.kind.value = room?.kind || kind;
  f.kind.disabled = !!room;
  f.name.value = room?.name || '';
  const cat = f.category_id;
  cat.innerHTML = '';
  cat.append(h('option', { value: '' }, 'Sem categoria'));
  for (const c of [...state.categories.values()].sort((a, b) => a.position - b.position)) {
    if (myRank() >= rank(c.min_role)) cat.append(h('option', { value: c.id }, c.name));
  }
  cat.value = room ? room.category_id || '' : categoryId || '';
  const catRole = () => state.categories.get(cat.value)?.min_role || 'membro';
  roleOptions(f.min_role, room?.min_role || catRole());
  roleOptions(f.write_role, room?.write_role || 'membro');
  cat.onchange = () => { if (!room) roleOptions(f.min_role, catRole()); };
  const syncKind = () => ($('#writeRoleField').hidden = f.kind.value !== 'text');
  f.kind.onchange = syncKind; syncKind();
  $('#roomError').textContent = '';
  $('#roomDelete').hidden = !room;
  $('#roomDelete').onclick = async () => {
    if (!confirm(`Excluir "${room.name}"?${room.kind === 'text' ? ' As mensagens deixam de aparecer.' : ''}`)) return;
    const err = await A.deleteRoom(room.id);
    if (err) $('#roomError').textContent = err; else modal.hidden = true;
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const data = {
      name: f.name.value.trim(),
      category_id: cat.value || null,
      min_role: f.min_role.value,
      write_role: f.kind.value === 'text' ? f.write_role.value : 'membro',
    };
    if (!data.name) return;
    const err = room ? await A.updateRoom(room.id, data) : await A.createRoom({ ...data, kind: f.kind.value });
    if (err) $('#roomError').textContent = err; else modal.hidden = true;
  };
  modal.hidden = false;
  f.name.focus();
}

// ------------------------------------------------------------------ Modal: categoria
export function openCategoryModal(cat) {
  const modal = $('#catModal');
  const f = $('#catForm');
  $('#catModalTitle').textContent = cat ? 'Editar categoria' : 'Criar categoria';
  f.name.value = cat?.name || '';
  roleOptions(f.min_role, cat?.min_role || 'membro');
  $('#catError').textContent = '';
  $('#catDelete').hidden = !cat;
  $('#catDelete').onclick = async () => {
    if (!confirm(`Excluir a categoria "${cat.name}"? As salas dela ficam sem categoria (não são apagadas).`)) return;
    const err = await A.deleteCategory(cat.id);
    if (err) $('#catError').textContent = err; else modal.hidden = true;
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const data = { name: f.name.value.trim(), min_role: f.min_role.value };
    if (!data.name) return;
    const err = cat ? await A.updateCategory(cat.id, data) : await A.createCategory(data);
    if (err) $('#catError').textContent = err; else modal.hidden = true;
  };
  modal.hidden = false;
  f.name.focus();
}

// ------------------------------------------------------------------ Modal: configurações
let testStream = null;
let meterStream = null;
let meterTimer = null;

// Recorta a imagem no formato pedido (avatar 256x256, faixa 960x384) e comprime
async function cropImage(file, w, hgt) {
  const bmp = await createImageBitmap(file);
  const ratio = w / hgt;
  let sw = bmp.width, sh = bmp.width / ratio;
  if (sh > bmp.height) { sh = bmp.height; sw = sh * ratio; }
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  c.getContext('2d').drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, w, hgt);
  return new Promise((resolve) => c.toBlob(resolve, 'image/webp', 0.88));
}

const switchRow = (title, desc, checked, onchange) => {
  const input = h('input', { type: 'checkbox', checked });
  input.onchange = () => onchange(input.checked);
  return h('div', { class: 'switch-row' }, h('div', {}, h('div', { class: 't' }, title), desc ? h('div', { class: 'd' }, desc) : null), h('label', { class: 'switch' }, input, h('span')));
};

let setTab = 'profile';
let draft = null;

export function openSettings(tab = 'profile') {
  const modal = $('#settingsModal');
  const p = myProfile();
  draft = {
    name: p.name, color: p.color, avatar_url: p.avatar_url || null, banner_url: p.banner_url || null,
    banner_color: p.banner_color || null, banner_color2: p.banner_color2 || null, name_color: p.name_color || null,
    pronouns: p.pronouns || '', bio: p.bio || '', decoration: p.decoration || '',
  };
  modal.querySelector('[data-close]').onclick = closeSettings;
  modal.querySelectorAll('.set-nav .srv-tab').forEach((b) => (b.onclick = () => (b.dataset.tab === 'logout' ? A.logout() : showSetTab(b.dataset.tab))));
  modal.hidden = false;
  showSetTab(tab);
}

function closeSettings() {
  testStream?.getTracks().forEach((t) => t.stop()); testStream = null;
  stopMeter();
  $('#settingsModal').hidden = true;
}

function showSetTab(tab) {
  setTab = tab;
  stopMeter();
  testStream?.getTracks().forEach((t) => t.stop()); testStream = null;
  $('#settingsModal').querySelectorAll('.set-nav .srv-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#setHeading').textContent = { profile: 'Meu perfil', appearance: 'Aparência', voice: 'Voz e vídeo' }[tab];
  $('#setError').textContent = '';
  const box = $('#setContent');
  box.innerHTML = '';
  if (tab === 'profile') renderProfileTab(box);
  else if (tab === 'appearance') renderAppearanceTab(box);
  else renderVoiceTab(box);
}

// ---------------------------------------------------------------- Aba: Meu perfil
function renderProfileTab(box) {
  const me = myProfile();
  const previewWrap = h('div', { class: 'set-preview-card' });
  const refreshPreview = () => {
    previewWrap.innerHTML = '';
    previewWrap.append(profileCard({ ...me, ...draft, pronouns: draft.pronouns.trim(), bio: draft.bio.trim() }, state.presence.get(state.me)));
  };

  const upload = (label, w, hgt, key) => {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
    const btn = h('button', { class: 'btn', type: 'button', onclick: () => input.click() }, label);
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { $('#setError').textContent = 'Use uma imagem JPG, PNG ou WebP.'; return; }
      btn.textContent = 'Enviando…'; btn.disabled = true;
      try {
        const blob = await cropImage(file, w, hgt);
        const { url, error } = await A.uploadPhoto(blob);
        if (error) $('#setError').textContent = error; else { draft[key] = url; renderAll(); }
      } catch { $('#setError').textContent = 'Não foi possível ler essa imagem.'; }
      btn.textContent = label; btn.disabled = false;
    };
    return [btn, input];
  };

  const swatches = (key, list, { allowNone = false, noneLabel = 'Padrão' } = {}) => {
    const row = h('div', { class: 'swatches' });
    if (allowNone) row.append(h('button', { class: `btn${!draft[key] ? ' sel' : ''}`, type: 'button', style: 'padding:3px 10px;font-size:12px', onclick: () => { draft[key] = null; renderAll(); } }, noneLabel));
    for (const c of list) row.append(h('button', { class: `sw${draft[key] === c ? ' sel' : ''}`, type: 'button', style: `background:${c}`, onclick: () => { draft[key] = c; renderAll(); } }));
    const picker = h('input', { type: 'color', value: draft[key] || list[0], title: 'Outra cor', style: 'width:30px;height:26px;border:0;background:none;padding:0;cursor:pointer' });
    picker.oninput = () => { draft[key] = picker.value; refreshPreview(); };
    picker.onchange = () => renderAll();
    row.append(picker);
    return row;
  };

  const form = h('div', {});
  const renderAll = () => {
    form.innerHTML = '';
    const [photoBtn, photoInput] = upload('Trocar avatar', 256, 256, 'avatar_url');
    const [bannerBtn, bannerInput] = upload('Enviar imagem da faixa', 960, 384, 'banner_url');
    const nameInput = h('input', { class: 'input', maxlength: 32, value: draft.name });
    nameInput.oninput = () => { draft.name = nameInput.value; refreshPreview(); };
    const pron = h('input', { class: 'input', maxlength: 40, value: draft.pronouns, placeholder: 'ele/dele, ela/dela…' });
    pron.oninput = () => { draft.pronouns = pron.value; refreshPreview(); };
    const bio = h('textarea', { class: 'input', maxlength: 190, placeholder: 'Conte um pouco sobre você (ex.: ⚙️ Fazendo a operação girar)' });
    bio.value = draft.bio;
    const counter = h('div', { class: 'counter' }, `${draft.bio.length}/190`);
    bio.oninput = () => { draft.bio = bio.value; counter.textContent = `${bio.value.length}/190`; refreshPreview(); };
    [nameInput, pron, bio].forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
    const decos = h('div', { class: 'deco-tiles' });
    for (const [key, label] of Object.entries(DECORATIONS)) {
      decos.append(h('button', { class: `deco-tile${draft.decoration === key ? ' sel' : ''}`, type: 'button', onclick: () => { draft.decoration = key; renderAll(); } },
        avatarOf({ ...me, ...draft, decoration: key || null }, 'lg'), label));
    }
    form.append(
      h('div', { class: 'set-sec' }, h('span', { class: 'lbl' }, 'Nome exibido'), nameInput),
      h('div', { class: 'set-sec' }, h('span', { class: 'lbl' }, 'Cor do nome'), swatches('name_color', ['#f43f5e', '#f97316', '#fbbf24', '#22c55e', '#22d3ee', '#3b82f6', '#a855f7', '#ec4899', '#ffffff'], { allowNone: true, noneLabel: 'Cor do cargo' })),
      h('div', { class: 'set-sec' }, h('span', { class: 'lbl' }, 'Pronomes'), pron),
      h('div', { class: 'set-sec' }, h('span', { class: 'lbl' }, 'Avatar'), h('div', { class: 'row-gap' }, photoBtn, photoInput,
        draft.avatar_url ? h('button', { class: 'btn danger-outline', type: 'button', onclick: () => { draft.avatar_url = null; renderAll(); } }, 'Remover foto') : null)),
      h('div', { class: 'set-sec' }, h('span', { class: 'lbl' }, 'Cor do avatar (sem foto)'), swatches('color', COLORS)),
      h('div', { class: 'set-sec' }, h('span', { class: 'lbl' }, 'Moldura do avatar'), decos),
      h('div', { class: 'set-sec' }, h('span', { class: 'lbl' }, 'Faixa do perfil'),
        h('div', { class: 'row-gap' }, bannerBtn, bannerInput,
          draft.banner_url ? h('button', { class: 'btn danger-outline', type: 'button', onclick: () => { draft.banner_url = null; renderAll(); } }, 'Remover imagem') : null),
        h('div', { class: 'muted small', style: 'margin:10px 0 6px' }, 'Ou uma cor / gradiente:'),
        swatches('banner_color', ['#b91c1c', '#c2410c', '#a16207', '#15803d', '#0e7490', '#1d4ed8', '#6d28d9', '#be185d', '#0b1426'], { allowNone: true, noneLabel: 'Cor do avatar' }),
        h('div', { class: 'muted small', style: 'margin:10px 0 6px' }, 'Segunda cor (gradiente):'),
        swatches('banner_color2', ['#f97316', '#facc15', '#22d3ee', '#a855f7', '#ec4899', '#22c55e', '#000000', '#ffffff'], { allowNone: true, noneLabel: 'Sem gradiente' })),
      h('div', { class: 'set-sec' }, h('span', { class: 'lbl' }, 'Sobre mim'), bio, counter),
      h('div', { class: 'row-gap', style: 'justify-content:flex-end' },
        h('button', { class: 'btn', type: 'button', onclick: closeSettings }, 'Cancelar'),
        h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Salvar alterações')));
    refreshPreview();
  };
  const save = async () => {
    const name = draft.name.trim();
    if (!name) { $('#setError').textContent = 'Informe seu nome.'; return; }
    const err = await A.saveProfile({ ...draft, name, pronouns: draft.pronouns.trim() || null, bio: draft.bio.trim() || null, decoration: draft.decoration || null });
    if (err) $('#setError').textContent = err;
    else { toast({ title: '✅ Perfil salvo', timeout: 2500 }); closeSettings(); }
  };
  renderAll();
  box.append(h('div', { class: 'set-grid' }, form, h('div', {}, h('div', { class: 'muted small', style: 'margin-bottom:8px' }, 'PRÉVIA'), previewWrap)));
}

// ---------------------------------------------------------------- Aba: Aparência
function renderAppearanceTab(box) {
  const render = () => {
    const prefs = getPrefs();
    box.innerHTML = '';
    const set = (patch) => { const next = { ...getPrefs(), ...patch }; applyPrefs(next); A.savePrefs(next); render(); };
    const std = h('div', { class: 'theme-tiles labeled' });
    for (const [key, t] of [...Object.entries(THEMES), ['sistema', { name: 'Sistema', swatch: 'linear-gradient(135deg,#ffffff 50%,#0b1426 50%)' }]]) {
      std.append(h('button', { class: `theme-tile${!prefs.gradient && prefs.theme === key ? ' sel' : ''}`, style: `background:${t.swatch}`, title: t.name, onclick: () => set({ theme: key, gradient: null }) }, h('span', { class: 'tl' }, t.name)));
    }
    const grads = h('div', { class: 'theme-tiles labeled' });
    for (const [key, g] of Object.entries(GRADIENTS)) {
      grads.append(h('button', { class: `theme-tile${prefs.gradient === key ? ' sel' : ''}`, style: `background:${g.bg}`, title: g.name, onclick: () => set({ gradient: key }) }, h('span', { class: 'tl' }, g.name)));
    }
    const acc = h('div', { class: 'swatches' });
    for (const c of ACCENTS) acc.append(h('button', { class: `sw${prefs.accent === c ? ' sel' : ''}`, style: `background:${c}`, onclick: () => set({ accent: c }) }));
    const scale = h('input', { type: 'range', min: 0.85, max: 1.3, step: 0.05, value: prefs.fontScale, style: 'width:100%;accent-color:var(--accent)' });
    const scaleLbl = h('span', { class: 'muted small' }, `${Math.round(prefs.fontScale * 100)}%`);
    scale.oninput = () => { scaleLbl.textContent = `${Math.round(scale.value * 100)}%`; };
    scale.onchange = () => set({ fontScale: Number(scale.value) });
    box.append(
      h('div', { class: 'set-sec' }, h('span', { class: 'lbl' }, 'Temas padrão'), std),
      h('div', { class: 'set-sec' }, h('span', { class: 'lbl' }, 'Temas coloridos ✨ liberados'), grads),
      h('div', { class: 'set-sec' }, h('span', { class: 'lbl' }, 'Cor de destaque'), acc),
      h('div', { class: 'set-sec' }, h('span', { class: 'lbl' }, 'Tamanho do texto e da interface'), h('div', { class: 'row-gap' }, scale, scaleLbl)),
      h('p', { class: 'muted small' }, 'O tema fica salvo na sua conta e aparece igual em qualquer computador.'));
  };
  render();
}

// ---------------------------------------------------------------- Aba: Voz e vídeo
function stopMeter() {
  clearInterval(meterTimer); meterTimer = null;
  meterStream?.getTracks().forEach((t) => t.stop()); meterStream = null;
}

async function renderVoiceTab(box) {
  const micSel = h('select', { class: 'input' });
  const spkSel = h('select', { class: 'input' });
  const camSel = h('select', { class: 'input' });
  const meter = h('div', { class: 'meter' }, h('i'));
  const preview = h('div', { class: 'preview off' }, h('video', { autoplay: true, playsinline: true, muted: true }), h('div', { class: 'preview-off' }, 'Câmera desligada'));
  preview.querySelector('video').muted = true;
  const camBtn = h('button', { class: 'btn block', type: 'button' }, 'Testar câmera');
  const audio = getAudioProcessing();
  const q = getScreenQuality();

  const qRes = h('div', { class: 'quality-grid' });
  const qFps = h('div', { class: 'fps-grid' });
  const paintQ = () => {
    const cur = getScreenQuality();
    qRes.innerHTML = ''; qFps.innerHTML = '';
    for (const [k, v] of Object.entries(SCREEN_PRESETS)) qRes.append(h('button', { class: `btn${cur.res === k ? ' sel' : ''}`, type: 'button', onclick: () => { setScreenQuality({ res: k }); paintQ(); } }, v.label));
    for (const f of [15, 30, 60]) qFps.append(h('button', { class: `btn${cur.fps === f ? ' sel' : ''}`, type: 'button', onclick: () => { setScreenQuality({ fps: f }); paintQ(); } }, `${f} fps`));
  };
  paintQ();

  box.append(h('div', { class: 'set-grid' },
    h('div', {},
      h('div', { class: 'set-sec' }, h('span', { class: 'lbl' }, 'Microfone'), micSel, meter, h('div', { class: 'muted small', style: 'margin-top:6px' }, 'Fale algo: a barra verde mostra o volume que chega no microfone.')),
      h('div', { class: 'set-sec', hidden: !canPickSpeaker }, h('span', { class: 'lbl' }, 'Saída de áudio (fone / alto-falante)'), spkSel,
        h('button', { class: 'btn', type: 'button', style: 'margin-top:8px', onclick: () => sounds.join() }, '🔊 Tocar som de teste')),
      h('div', { class: 'set-sec' }, h('span', { class: 'lbl' }, 'Processamento de voz'),
        switchRow('Supressão de ruído', 'Corta barulho de fundo (teclado, ventilador, rua).', audio.noiseSuppression, (v) => setAudioProcessing({ noiseSuppression: v })),
        switchRow('Cancelamento de eco', 'Evita que o som das caixas volte pelo microfone.', audio.echoCancellation, (v) => setAudioProcessing({ echoCancellation: v })),
        switchRow('Ganho automático', 'Ajusta o volume da sua voz sozinho.', audio.autoGainControl, (v) => setAudioProcessing({ autoGainControl: v }))),
      h('div', { class: 'set-sec' }, h('span', { class: 'lbl' }, 'Qualidade padrão ao transmitir a tela'), qRes, h('div', { style: 'height:8px' }), qFps,
        switchRow('Transmitir o som junto', 'Manda o som da aba ou do sistema junto com a tela.', q.audio !== false, (v) => setScreenQuality({ audio: v })),
        h('div', { class: 'muted small', style: 'margin-top:6px' }, 'Padrão: 4K a 60 fps com som. O botão de transmitir já usa essa qualidade direto. Se a sua internet não aguentar, baixe aqui.'))),
    h('div', {},
      h('div', { class: 'set-sec' }, h('span', { class: 'lbl' }, 'Câmera'), camSel, h('div', { style: 'height:8px' }), preview, camBtn))));

  // listas de dispositivos
  const fill = async () => {
    const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    for (const [sel, kind, current] of [[micSel, 'audioinput', local.micDeviceId], [spkSel, 'audiooutput', local.speakerDeviceId], [camSel, 'videoinput', local.camDeviceId]]) {
      const list = devs.filter((d) => d.kind === kind);
      sel.innerHTML = '';
      if (!list.length) { sel.append(h('option', { value: '' }, 'Nenhum dispositivo')); continue; }
      list.forEach((d, i) => sel.append(h('option', { value: d.deviceId }, d.label || `Dispositivo ${i + 1}`)));
      if (current && list.some((d) => d.deviceId === current)) sel.value = current;
    }
  };
  const startMeter = async () => {
    stopMeter();
    try {
      meterStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: local.micDeviceId ? { exact: local.micDeviceId } : undefined, ...getAudioProcessing() } });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser(); an.fftSize = 512;
      ctx.createMediaStreamSource(meterStream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      meterTimer = setInterval(() => {
        if (!meterStream) { ctx.close(); return; }
        an.getByteTimeDomainData(buf);
        let sum = 0; for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
        meter.firstChild.style.width = `${Math.min(100, Math.sqrt(sum / buf.length) * 400)}%`;
      }, 60);
    } catch { meter.firstChild.style.width = '0'; }
    fill();
  };
  micSel.onchange = async () => { await switchDevice('mic', micSel.value); startMeter(); };
  spkSel.onchange = () => { setSpeaker(spkSel.value); sounds.message(); };
  camSel.onchange = async () => { await switchDevice('cam', camSel.value); if (testStream) { camBtn.click(); camBtn.click(); } };
  camBtn.onclick = async () => {
    if (testStream) { testStream.getTracks().forEach((t) => t.stop()); testStream = null; preview.querySelector('video').srcObject = null; preview.classList.add('off'); camBtn.textContent = 'Testar câmera'; return; }
    try {
      testStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: local.camDeviceId ? { exact: local.camDeviceId } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 } } });
      preview.querySelector('video').srcObject = testStream;
      preview.classList.remove('off');
      camBtn.textContent = 'Parar teste';
      fill();
    } catch { $('#setError').textContent = 'Não foi possível acessar a câmera.'; }
  };
  on('audio-processing', () => { if (setTab === 'voice' && meterStream) startMeter(); });
  await fill();
  startMeter();
}

// ------------------------------------------------------------------ Mover / banir
export const fmtDate = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export const banLabel = (ban) => (ban.until ? `até ${fmtDate(ban.until)}` : 'permanente');

function openMoveMenu(id, anchor) {
  showPopover(anchor, (el) => {
    el.append(h('div', { class: 'menu-label' }, `Mover ${displayName(id)} para…`));
    const current = state.presence.get(id)?.room;
    const cats = [...state.categories.values()].sort((a, b) => a.position - b.position);
    const voice = [...state.rooms.values()].filter((r) => r.kind === 'voice' && r.id !== current);
    const groups = [...cats.map((c) => [c.name, voice.filter((r) => r.category_id === c.id)]), ['Sem categoria', voice.filter((r) => !r.category_id || !state.categories.has(r.category_id))]];
    const sel = h('select', { class: 'input' });
    for (const [name, rooms] of groups) {
      if (!rooms.length) continue;
      const og = h('optgroup', { label: name });
      rooms.sort((a, b) => a.position - b.position).forEach((r) => og.append(h('option', { value: r.id }, r.name)));
      sel.append(og);
    }
    el.append(h('div', { class: 'pop-row' }, sel),
      h('div', { class: 'pop-row' }, h('button', { class: 'btn primary block', onclick: () => { closePopover(); A.moveTo(id, sel.value); } }, 'Mover')));
  });
}

function openBanMenu(id, anchor) {
  showPopover(anchor, (el) => {
    el.append(h('div', { class: 'menu-label' }, `Banir ${displayName(id)}`));
    const reason = h('input', { class: 'input', maxlength: 200, placeholder: 'Motivo (opcional)' });
    reason.addEventListener('keydown', (e) => e.stopPropagation());
    el.append(h('div', { class: 'pop-row' }, reason));
    const opts = [['1 hora', 3600e3], ['1 dia', 86400e3], ['7 dias', 7 * 86400e3], ['30 dias', 30 * 86400e3], ['Permanente', null]];
    const grid = h('div', { class: 'ban-grid' });
    for (const [label, ms] of opts) {
      grid.append(h('button', { class: `btn${ms === null ? ' danger-outline' : ''}`, onclick: async () => {
        if (!confirm(`Banir ${displayName(id)} (${label})? A pessoa perde o acesso na hora.`)) return;
        closePopover();
        await A.ban(id, ms, reason.value.trim());
      } }, label));
    }
    el.append(grid, h('div', { class: 'pop-row muted small' }, 'A pessoa sai da sala e não consegue entrar até o banimento acabar. Dá para desbanir a qualquer momento.'));
  });
}

// ------------------------------------------------------------------ Configurações do servidor
let srvTab = 'members';
export function openServerSettings(tab = srvTab) {
  const modal = $('#serverModal');
  srvTab = tab;
  $('#srvTitle').textContent = state.cfg?.serverName || 'Turbo Office';
  const headings = { members: 'Membros', bans: 'Banimentos', roles: 'Cargos e permissões' };
  modal.querySelectorAll('.srv-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.onclick = () => openServerSettings(b.dataset.tab);
  });
  $('#srvHeading').textContent = headings[tab];
  $('#srvMembers').hidden = tab !== 'members';
  $('#srvBans').hidden = tab !== 'bans';
  $('#srvRoles').hidden = tab !== 'roles';
  const nBans = state.bans.size;
  $('#bansCount').hidden = !nBans;
  $('#bansCount').textContent = String(nBans);
  modal.querySelector('[data-close]').onclick = () => (modal.hidden = true);
  $('#adminSearch').oninput = renderServerSettings;
  modal.hidden = false;
  renderServerSettings();
}

export function renderServerSettings() {
  const modal = $('#serverModal');
  if (modal.hidden) return;
  // Não redesenha enquanto a pessoa está usando um seletor/campo da lista
  if (modal.querySelector('#adminList, #bansList')?.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
  if (srvTab === 'members') {
    const term = $('#adminSearch').value.trim().toLowerCase();
    const list = $('#adminList');
    const scroll = list.scrollTop;
    list.innerHTML = '';
    const people = [...state.profiles.values()]
      .filter((p) => !term || p.name.toLowerCase().includes(term) || p.email.includes(term))
      .sort((a, b) => rank(b.role) - rank(a.role) || a.name.localeCompare(b.name));
    list.append(h('div', { class: 'muted small', style: 'padding:0 6px 6px' }, `${people.length} ${people.length === 1 ? 'pessoa' : 'pessoas'} · ${[...state.presence.keys()].length} online`));
    for (const p of people) {
      const pr = state.presence.get(p.id);
      const ban = state.bans.get(p.id);
      const room = pr?.room && state.rooms.get(pr.room);
      const sel = h('select', { class: 'input', disabled: p.id === state.me || myRank() < 3, title: myRank() < 3 ? 'Só Admin muda cargos' : '' },
        ['membro', 'gestor', 'admin'].map((r) => h('option', { value: r, selected: p.role === r }, ROLES[r].label)));
      sel.onchange = async () => { const err = await A.setRole(p.id, sel.value); if (err) sel.value = p.role; };
      const more = h('button', { class: 'icon-btn', title: 'Ações', onclick: (e) => openMemberPopover(p.id, e.currentTarget) }, '⋯');
      list.append(h('div', { class: 'admin-row' }, avatar(p.id, 'sm', true),
        h('div', { style: 'min-width:0' },
          h('div', { class: 'nm' }, p.name + (p.id === state.me ? ' (você)' : ''), ban ? h('span', { class: 'ban-tag' }, `  ⛔ banido ${banLabel(ban)}`) : null),
          h('div', { class: 'em' }, `${p.email}${pr ? ` · ${room ? `🔊 ${room.name}` : 'online'}` : ''}`)),
        sel, p.id === state.me ? h('span') : more));
    }
    list.scrollTop = scroll;
  } else if (srvTab === 'bans') {
    const list = $('#bansList');
    list.innerHTML = '';
    if (!state.bans.size) { list.append(h('div', { class: 'chat-empty' }, 'Ninguém banido. 🎉')); return; }
    for (const [uid, ban] of state.bans) {
      list.append(h('div', { class: 'ban-row' }, avatar(uid, 'sm'),
        h('div', { style: 'min-width:0' },
          h('div', { class: 'strong' }, displayName(uid)),
          h('div', { class: 'muted small' }, `${ban.until ? `Até ${fmtDate(ban.until)}` : 'Permanente'} · por ${displayName(ban.by_id)}${ban.reason ? ` · “${ban.reason}”` : ''}`)),
        h('button', { class: 'btn', onclick: () => A.unban(uid) }, 'Desbanir')));
    }
  }
}

// Fecha popovers/modais ao clicar fora
document.addEventListener('pointerdown', (e) => {
  const pop = $('#popover');
  if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true;
});
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('pointerdown', (e) => {
  if (e.target === m && m.id !== 'kicked') { if (m.id === 'settingsModal') m.querySelector('[data-close]').click(); else m.hidden = true; }
}));
document.querySelectorAll('#roomModal [data-close], #catModal [data-close]').forEach((b) => (b.onclick = () => (b.closest('.modal').hidden = true)));
