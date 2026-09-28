// Renderização da interface: canais, membros, cabeçalho, popovers, modais e notificações.
import {
  state, on, ROLES, rank, myProfile, myRank, canManageRooms, canModerate, STATUS_LABEL, COLORS,
  displayName, colorOf, initials, membersIn, dmOther, photoOf,
} from './state.js';
import { local, switchDevice, getUserVolume, setUserVolume, setSpeaker, canPickSpeaker } from './rtc.js';

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
export function avatar(id, size = '', withStatus = false) {
  const p = state.profiles.get(id);
  const photo = photoOf(id);
  const el = photo
    ? h('span', { class: `avatar photo ${size}${state.speaking.has(id) ? ' speaking' : ''}`, style: `background-image:url("${photo}")` })
    : h('span', { class: `avatar ${size}${state.speaking.has(id) ? ' speaking' : ''}`, style: `background:${colorOf(id)}` }, initials(p?.name));
  if (withStatus) {
    const pr = state.presence.get(id);
    el.append(h('span', { class: `st ${pr ? pr.status : 'offline'}` }));
  }
  return el;
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
    h('div', { class: 'info' }, h('div', { class: 'name', style: `color:${p.role === 'membro' ? 'inherit' : ROLES[p.role].color}` }, p.name), sub ? h('div', { class: 'sub' }, sub) : null));
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
    el.append(h('div', { class: 'pop-head' }, avatar(id, 'lg', true), h('div', {},
      h('div', { class: 'name' }, p.name),
      h('span', { class: 'role-badge', style: `color:${ROLES[p.role].color}` }, ROLES[p.role].label),
      h('div', { class: 'muted small', style: 'margin-top:4px' }, p.email))));
    el.append(h('div', { class: 'pop-row muted' }, pr ? `${pr.statusText || STATUS_LABEL[pr.status]}${room ? ` · 🔊 ${room.name}` : ''}` : 'Offline'));
    el.append(h('div', { class: 'menu-sep' }));
    if (isMe) {
      el.append(h('button', { class: 'menu-item', onclick: () => { closePopover(); openSettings(); } }, '⚙️ Editar perfil'));
      return;
    }
    el.append(h('button', { class: 'menu-item', onclick: () => { closePopover(); A.selectView({ type: 'dm', id }); } }, '💬 Mensagem'));
    if (pr && state.voiceRoom && pr.room !== state.voiceRoom) el.append(h('button', { class: 'menu-item', onclick: () => { closePopover(); A.ring(id); } }, '🔔 Chamar para minha sala'));
    if (pr?.room && pr.room !== state.voiceRoom && state.rooms.has(pr.room)) el.append(h('button', { class: 'menu-item', onclick: () => { closePopover(); A.joinVoice(pr.room); } }, `🔊 Entrar em ${room.name}`));
    if (state.voiceRoom && pr?.room === state.voiceRoom) {
      const range = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: getUserVolume(id) });
      range.oninput = () => setUserVolume(id, Number(range.value));
      el.append(h('div', { class: 'menu-label' }, 'Volume para você'), h('div', { class: 'pop-row' }, range));
    }
    if (canModerate(id)) {
      el.append(h('div', { class: 'menu-sep' }), h('div', { class: 'menu-label' }, 'Moderação'));
      if (pr?.room) {
        el.append(
          h('button', { class: 'menu-item', onclick: () => { closePopover(); A.moderate(id, 'mute'); } }, '🔇 Mutar na sala'),
          h('button', { class: 'menu-item', onclick: () => { closePopover(); A.moderate(id, 'unmute'); } }, '🎙️ Desmutar'),
          h('button', { class: 'menu-item', onclick: () => { closePopover(); A.moderate(id, 'kick'); } }, '⏏ Remover da sala'));
      }
      if (pr) el.append(h('button', { class: 'menu-item', onclick: () => openMoveMenu(id, anchor) }, '↪️ Mover para outra sala…'));
      const ban = state.bans.get(id);
      if (ban) el.append(h('button', { class: 'menu-item', onclick: () => { closePopover(); A.unban(id); } }, `✅ Desbanir (${banLabel(ban)})`));
      else el.append(h('button', { class: 'menu-item danger', onclick: () => openBanMenu(id, anchor) }, '⛔ Banir…'));
    }
    if (myRank() === 3) {
      const sel = h('select', { class: 'input' }, ['membro', 'gestor', 'admin'].map((r) => h('option', { value: r, selected: p.role === r }, ROLES[r].label)));
      sel.onchange = () => A.setRole(id, sel.value);
      el.append(h('div', { class: 'menu-sep' }), h('div', { class: 'menu-label' }, 'Cargo'), h('div', { class: 'pop-row' }, sel));
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
    el.append(h('div', { class: 'menu-sep' }), h('button', { class: 'menu-item', onclick: () => { closePopover(); openSettings(); } }, '⚙️ Configurações de voz, vídeo e perfil'));
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
// Recorta a imagem em quadrado e reduz para 256px (arquivo pequeno, carrega rápido)
async function squareImage(file, size = 256) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((resolve) => c.toBlob(resolve, 'image/webp', 0.88));
}

export function openSettings() {
  const modal = $('#settingsModal');
  const p = myProfile();
  const draft = { name: p.name, color: p.color, avatar_url: p.avatar_url || null };
  const nameInput = $('#setName');
  nameInput.value = draft.name;
  $('#setEmail').textContent = `${p.email} · ${ROLES[p.role].label}`;
  $('#setError').textContent = '';
  const paint = (el) => {
    if (draft.avatar_url) { el.className = `${el.className.replace(/\bphoto\b/g, '').trim()} photo`; el.style.background = ''; el.style.backgroundImage = `url("${draft.avatar_url}")`; el.textContent = ''; }
    else { el.classList.remove('photo'); el.style.backgroundImage = ''; el.style.background = draft.color; el.textContent = initials(draft.name); }
  };
  const refresh = () => {
    paint($('#setAvatar'));
    paint($('#setPhoto'));
    $('#photoRemove').hidden = !draft.avatar_url;
    $('#setPreviewName').textContent = draft.name || '—';
    const sw = $('#colorSwatches');
    sw.innerHTML = '';
    for (const c of COLORS) sw.append(h('button', { class: `sw${c === draft.color ? ' sel' : ''}`, type: 'button', style: `background:${c}`, onclick: () => { draft.color = c; refresh(); } }));
  };
  nameInput.oninput = () => { draft.name = nameInput.value; refresh(); };
  $('#photoInput').value = '';
  $('#photoInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $('#setError').textContent = '';
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { $('#setError').textContent = 'Use uma imagem JPG, PNG ou WebP.'; return; }
    const label = document.querySelector('label[for=photoInput]');
    label.textContent = 'Enviando…';
    try {
      const blob = await squareImage(file);
      const { url, error } = await A.uploadPhoto(blob);
      if (error) $('#setError').textContent = error; else { draft.avatar_url = url; refresh(); }
    } catch { $('#setError').textContent = 'Não foi possível ler essa imagem.'; }
    label.textContent = 'Enviar foto';
  };
  $('#photoRemove').onclick = () => { draft.avatar_url = null; refresh(); };
  refresh();

  const preview = $('#camPreview');
  const stopTest = () => { testStream?.getTracks().forEach((t) => t.stop()); testStream = null; preview.querySelector('video').srcObject = null; preview.classList.add('off'); $('#testCam').textContent = 'Testar câmera'; };
  $('#testCam').onclick = async () => {
    if (testStream) return stopTest();
    try {
      testStream = await navigator.mediaDevices.getUserMedia({ video: local.camDeviceId ? { deviceId: { exact: local.camDeviceId } } : true });
      preview.querySelector('video').srcObject = testStream;
      preview.classList.remove('off');
      $('#testCam').textContent = 'Parar teste';
      fillDevices();
    } catch { $('#setError').textContent = 'Não foi possível acessar a câmera.'; }
  };
  $('#micSelect').onchange = (e) => switchDevice('mic', e.target.value);
  $('#spkSelect').onchange = (e) => { setSpeaker(e.target.value); sounds.message(); };
  $('#camSelect').onchange = async (e) => { await switchDevice('cam', e.target.value); if (testStream) { stopTest(); $('#testCam').click(); } };
  const close = () => { stopTest(); modal.hidden = true; };
  modal.querySelector('[data-close]').onclick = close;
  $('#setSave').onclick = async () => {
    const name = draft.name.trim();
    if (!name) { $('#setError').textContent = 'Informe seu nome.'; return; }
    const err = await A.saveProfile({ name, color: draft.color, avatar_url: draft.avatar_url });
    if (err) $('#setError').textContent = err; else close();
  };
  fillDevices();
  modal.hidden = false;
}

async function fillDevices() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    $('#spkField').hidden = !canPickSpeaker;
    for (const [sel, kind, current] of [['#micSelect', 'audioinput', local.micDeviceId], ['#spkSelect', 'audiooutput', local.speakerDeviceId], ['#camSelect', 'videoinput', local.camDeviceId]]) {
      const el = $(sel);
      const list = devs.filter((d) => d.kind === kind);
      el.innerHTML = '';
      if (!list.length || !list[0].label) { el.append(h('option', { value: '' }, list.length ? 'Permita o acesso para listar' : 'Nenhum dispositivo')); continue; }
      list.forEach((d, i) => el.append(h('option', { value: d.deviceId }, d.label || `Dispositivo ${i + 1}`)));
      if (current && list.some((d) => d.deviceId === current)) el.value = current;
    }
  } catch {}
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
