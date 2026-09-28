// Renderização da interface: canais, membros, cabeçalho, popovers, modais e notificações.
import {
  state, ROLES, rank, myProfile, myRank, canManageRooms, canModerate, STATUS_LABEL, COLORS,
  displayName, colorOf, initials, membersIn, dmOther,
} from './state.js';
import { local, switchDevice, getUserVolume, setUserVolume } from './rtc.js';

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
  people: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>'),
};

let A = {}; // ações registradas pelo app.js
export function setActions(actions) { A = actions; }

// ------------------------------------------------------------------ Avatar
export function avatar(id, size = '', withStatus = false) {
  const p = state.profiles.get(id);
  const el = h('span', { class: `avatar ${size}${state.speaking.has(id) ? ' speaking' : ''}`, style: `background:${colorOf(id)}` }, initials(p?.name));
  if (withStatus) {
    const pr = state.presence.get(id);
    el.append(h('span', { class: `st ${pr ? pr.status : 'offline'}` }));
  }
  return el;
}

// ------------------------------------------------------------------ Lista de canais
const roomsOf = (kind) => [...state.rooms.values()].filter((r) => r.kind === kind).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
const isActive = (type, id) => state.view?.type === type && state.view.id === id;

export function renderChannels(unreadOf) {
  const nav = $('#channelList');
  const scroll = nav.scrollTop;
  nav.innerHTML = '';
  const manage = canManageRooms();
  const lockIcon = (r) => (r.min_role !== 'membro' ? h('span', { class: 'lock', title: `Só ${ROLES[r.min_role].label}+` }, '🔒') : null);
  const editBtn = (r) => (manage && myRank() >= rank(r.min_role)
    ? h('span', { class: 'edit', title: 'Editar sala', onclick: (e) => { e.stopPropagation(); openRoomModal(r); } }, '⚙')
    : null);

  nav.append(h('div', { class: 'sec-head' }, 'Canais de texto', manage ? h('button', { class: 'icon-btn', title: 'Criar canal', onclick: () => openRoomModal(null, 'text') }, '+') : null));
  for (const r of roomsOf('text')) {
    const unread = unreadOf(`room:${r.id}`);
    nav.append(h('button', { class: `chan${isActive('text', r.id) ? ' active' : ''}${unread ? ' unread' : ''}`, onclick: () => A.selectView({ type: 'text', id: r.id }) },
      h('span', { class: 'ico' }, '#'), h('span', { class: 'nm' }, r.name), lockIcon(r),
      unread ? h('span', { class: 'badge' }, unread > 99 ? '99+' : String(unread)) : null, editBtn(r)));
  }

  nav.append(h('div', { class: 'sec-head' }, 'Salas de voz', manage ? h('button', { class: 'icon-btn', title: 'Criar sala', onclick: () => openRoomModal(null, 'voice') }, '+') : null));
  for (const r of roomsOf('voice')) {
    const inside = membersIn(r.id);
    nav.append(h('button', {
      class: `chan${isActive('voice', r.id) ? ' active' : ''}`,
      onclick: () => A.joinVoice(r.id),
      title: state.voiceRoom === r.id ? 'Você está nesta sala' : 'Entrar na sala',
    }, h('span', { class: 'ico' }, state.voiceRoom === r.id ? '🔊' : '🔈'), h('span', { class: 'nm' }, r.name), lockIcon(r),
    inside.length ? h('span', { class: 'muted small' }, String(inside.length)) : null, editBtn(r)));
    if (inside.length) {
      const list = h('div', { class: 'voice-members' });
      for (const id of inside.sort((a, b) => displayName(a).localeCompare(displayName(b)))) {
        const p = state.presence.get(id);
        const flags = `${p.media.screen ? '🖥️' : ''}${p.media.cam ? '📷' : ''}${p.media.mic ? '' : '🔇'}${p.deaf ? '🎧' : ''}`;
        list.append(h('div', { class: 'vm', onclick: (e) => openMemberPopover(id, e.currentTarget) }, avatar(id, 'xs'), h('span', { class: 'nm' }, displayName(id)), h('span', { class: 'flags' }, flags)));
      }
      nav.append(list);
    }
  }

  const dms = [...new Set([...(A.dmChannels?.() || [])])];
  if (dms.length) {
    nav.append(h('div', { class: 'sec-head' }, 'Mensagens diretas'));
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
    list.append(h('div', { class: 'sec-head' }, `${ROLES[role].label}s — ${group.length}`));
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
    if (canModerate(id) && pr?.room) {
      el.append(h('div', { class: 'menu-sep' }), h('div', { class: 'menu-label' }, 'Moderação'),
        h('button', { class: 'menu-item', onclick: () => { closePopover(); A.moderate(id, 'mute'); } }, '🔇 Mutar na sala'),
        h('button', { class: 'menu-item', onclick: () => { closePopover(); A.moderate(id, 'unmute'); } }, '🎙️ Desmutar'),
        h('button', { class: 'menu-item danger', onclick: () => { closePopover(); A.moderate(id, 'kick'); } }, '⏏ Remover da sala'));
    }
    if (myRank() === 3) {
      const sel = h('select', { class: 'input' }, ['membro', 'gestor', 'admin'].map((r) => h('option', { value: r, selected: p.role === r }, ROLES[r].label)));
      sel.onchange = () => A.setRole(id, sel.value);
      el.append(h('div', { class: 'menu-sep' }), h('div', { class: 'menu-label' }, 'Cargo'), h('div', { class: 'pop-row' }, sel));
    }
  });
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

let beepCtx;
export function beep(freqs = [880], dur = 0.1) {
  try {
    beepCtx ??= new AudioContext();
    freqs.forEach((f, i) => {
      const o = beepCtx.createOscillator(), g = beepCtx.createGain();
      const t = beepCtx.currentTime + i * (dur + 0.04);
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(beepCtx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    });
  } catch {}
}
export const sounds = {
  join: () => beep([660, 880]),
  leave: () => beep([880, 560]),
  message: () => beep([740], 0.08),
  ring: () => beep([880, 1100, 880, 1100], 0.14),
};

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
    select.append(h('option', { value: r, selected: r === current }, r === 'membro' ? 'Todos' : `${ROLES[r].label}s ou acima`));
  }
}

export function openRoomModal(room, kind = 'voice') {
  const modal = $('#roomModal');
  const f = $('#roomForm');
  $('#roomModalTitle').textContent = room ? `Editar ${room.kind === 'text' ? 'canal' : 'sala'}` : 'Criar sala';
  f.kind.value = room?.kind || kind;
  f.kind.disabled = !!room;
  f.name.value = room?.name || '';
  roleOptions(f.min_role, room?.min_role || 'membro');
  roleOptions(f.write_role, room?.write_role || 'membro');
  const syncKind = () => ($('#writeRoleField').hidden = f.kind.value !== 'text');
  f.kind.onchange = syncKind; syncKind();
  $('#roomError').textContent = '';
  $('#roomDelete').hidden = !room;
  $('#roomDelete').onclick = async () => {
    if (!confirm(`Excluir "${room.name}"? ${room.kind === 'text' ? 'As mensagens deixam de aparecer.' : ''}`)) return;
    const err = await A.deleteRoom(room.id);
    if (err) $('#roomError').textContent = err; else modal.hidden = true;
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const data = { name: f.name.value.trim(), min_role: f.min_role.value, write_role: f.kind.value === 'text' ? f.write_role.value : 'membro' };
    if (!data.name) return;
    const err = room ? await A.updateRoom(room.id, data) : await A.createRoom({ ...data, kind: f.kind.value });
    if (err) $('#roomError').textContent = err; else modal.hidden = true;
  };
  modal.hidden = false;
  f.name.focus();
}

// ------------------------------------------------------------------ Modal: configurações
let testStream = null;
export function openSettings() {
  const modal = $('#settingsModal');
  const p = myProfile();
  const draft = { name: p.name, color: p.color };
  const nameInput = $('#setName');
  nameInput.value = draft.name;
  $('#setEmail').textContent = `${p.email} · ${ROLES[p.role].label}`;
  $('#setError').textContent = '';
  const refresh = () => {
    const av = $('#setAvatar');
    av.style.background = draft.color;
    av.textContent = initials(draft.name);
    $('#setPreviewName').textContent = draft.name || '—';
    const sw = $('#colorSwatches');
    sw.innerHTML = '';
    for (const c of COLORS) sw.append(h('button', { class: `sw${c === draft.color ? ' sel' : ''}`, type: 'button', style: `background:${c}`, onclick: () => { draft.color = c; refresh(); } }));
  };
  nameInput.oninput = () => { draft.name = nameInput.value; refresh(); };
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
  $('#camSelect').onchange = async (e) => { await switchDevice('cam', e.target.value); if (testStream) { stopTest(); $('#testCam').click(); } };
  const close = () => { stopTest(); modal.hidden = true; };
  modal.querySelector('[data-close]').onclick = close;
  $('#setSave').onclick = async () => {
    const name = draft.name.trim();
    if (!name) { $('#setError').textContent = 'Informe seu nome.'; return; }
    const err = await A.saveProfile({ name, color: draft.color });
    if (err) $('#setError').textContent = err; else close();
  };
  fillDevices();
  modal.hidden = false;
}

async function fillDevices() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    for (const [sel, kind, current] of [['#micSelect', 'audioinput', local.micDeviceId], ['#camSelect', 'videoinput', local.camDeviceId]]) {
      const el = $(sel);
      const list = devs.filter((d) => d.kind === kind);
      el.innerHTML = '';
      if (!list.length || !list[0].label) { el.append(h('option', { value: '' }, list.length ? 'Permita o acesso para listar' : 'Nenhum dispositivo')); continue; }
      list.forEach((d, i) => el.append(h('option', { value: d.deviceId }, d.label || `Dispositivo ${i + 1}`)));
      if (current && list.some((d) => d.deviceId === current)) el.value = current;
    }
  } catch {}
}

// ------------------------------------------------------------------ Modal: admin (membros e cargos)
export function openAdmin() {
  const modal = $('#adminModal');
  const search = $('#adminSearch');
  const render = () => {
    const term = search.value.trim().toLowerCase();
    const list = $('#adminList');
    list.innerHTML = '';
    const people = [...state.profiles.values()]
      .filter((p) => !term || p.name.toLowerCase().includes(term) || p.email.includes(term))
      .sort((a, b) => rank(b.role) - rank(a.role) || a.name.localeCompare(b.name));
    for (const p of people) {
      const sel = h('select', { class: 'input', disabled: p.id === state.me || myRank() < 3 }, ['membro', 'gestor', 'admin'].map((r) => h('option', { value: r, selected: p.role === r }, ROLES[r].label)));
      sel.onchange = async () => { const err = await A.setRole(p.id, sel.value); if (err) { toast({ title: 'Não foi possível mudar o cargo', body: err }); sel.value = p.role; } };
      list.append(h('div', { class: 'admin-row' }, avatar(p.id, 'sm', true), h('div', { style: 'min-width:0' }, h('div', { class: 'nm' }, p.name + (p.id === state.me ? ' (você)' : '')), h('div', { class: 'em' }, p.email)), sel));
    }
  };
  search.oninput = render;
  modal.querySelector('[data-close]').onclick = () => (modal.hidden = true);
  render();
  modal.hidden = false;
}

// Fecha popovers/modais ao clicar fora
document.addEventListener('pointerdown', (e) => {
  const pop = $('#popover');
  if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true;
});
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('pointerdown', (e) => {
  if (e.target === m && m.id !== 'kicked') { if (m.id === 'settingsModal') m.querySelector('[data-close]').click(); else m.hidden = true; }
}));
document.querySelectorAll('#roomModal [data-close]').forEach((b) => (b.onclick = () => ($('#roomModal').hidden = true)));
