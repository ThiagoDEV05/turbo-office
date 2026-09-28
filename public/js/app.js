// Controlador principal: sessão, dados, navegação, salas de voz e ações.
import { getSupabase, getConfig } from './supa.js';
import { state, on, emit, myProfile, myRank, rank, displayName, membersIn, dmKey, ROLES } from './state.js';
import { startNet, setMeta, getMeta, sendTo, stopNet } from './net.js';
import * as rtc from './rtc.js';
import * as ui from './ui.js';
import * as chat from './chat.js';

const { $ } = ui;
let sb = null;

// ------------------------------------------------------------------ Render agendado
let renderQueued = false;
function renderAll() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    ui.renderChannels(chat.unreadOf);
    ui.renderMembers();
    ui.renderHeader();
    ui.renderUserPanel();
    ui.renderControls();
    ui.renderVoiceView();
    $('#adminBtn').hidden = myRank() < 2;
  });
}

// ------------------------------------------------------------------ Dados
async function loadRooms() {
  const [cats, rooms] = await Promise.all([
    sb.from('categories').select('id, name, position, min_role'),
    sb.from('rooms').select('id, name, kind, category_id, min_role, write_role, position'),
  ]);
  const error = cats.error || rooms.error;
  if (error) { ui.toast({ title: 'Erro ao carregar salas', body: error.message }); return; }
  state.categories = new Map(cats.data.map((c) => [c.id, c]));
  state.rooms = new Map(rooms.data.map((r) => [r.id, r]));
  // Sala atual/visão podem ter sumido (excluída ou sem permissão)
  if (state.voiceRoom && !state.rooms.has(state.voiceRoom)) leaveVoice();
  if (state.view && state.view.type !== 'dm' && !state.rooms.has(state.view.id)) selectView(defaultView());
  renderAll();
}

function defaultView() {
  const text = [...state.rooms.values()].filter((r) => r.kind === 'text').sort((a, b) => a.position - b.position);
  return text[0] ? { type: 'text', id: text[0].id } : null;
}

// ------------------------------------------------------------------ Navegação
function selectView(view) {
  state.view = view;
  if (view) localStorage.setItem('to.view', JSON.stringify(view));
  const isVoice = view?.type === 'voice';
  $('#textView').hidden = !view || isVoice;
  $('#voiceView').hidden = !isVoice;
  $('#layout').classList.remove('nav-open');
  if (view && !isVoice) {
    chat.openChannel(chat.currentKey());
    chat.renderComposer();
    chat.renderMessages(true);
    if (innerWidth > 720) setTimeout(() => $('#msgInput').focus(), 0);
  }
  renderAll();
}

// ------------------------------------------------------------------ Voz
async function joinVoice(roomId) {
  if (!state.rooms.has(roomId)) return;
  if (state.voiceRoom === roomId) { selectView({ type: 'voice', id: roomId }); return; }
  if (state.voiceRoom) leaveVoice(true);
  rtc.ensureAudioContext();
  state.voiceRoom = roomId;
  state.modMuted = false;
  prevRoomMembers = new Set();
  setMeta({ room: roomId });
  selectView({ type: 'voice', id: roomId });
  if (rtc.local.micOn && !(await rtc.startMic())) {
    ui.toast({ title: 'Microfone bloqueado', body: 'Você entrou só ouvindo. Libere o microfone no navegador para falar.' });
  }
  rtc.publishMedia();
  ui.sounds.join();
  rtc.updatePeers();
}

function leaveVoice(silent = false) {
  if (!state.voiceRoom) return;
  rtc.closeAll();
  rtc.stopAllMedia();
  state.voiceRoom = null;
  state.modMuted = false;
  setMeta({ room: null });
  rtc.publishMedia();
  if (!silent) ui.sounds.leave();
  renderAll();
}

// Sons de entrada/saída de outras pessoas na minha sala
let prevRoomMembers = new Set();
function checkRoomSounds() {
  if (!state.voiceRoom) { prevRoomMembers = new Set(); return; }
  const cur = new Set(membersIn(state.voiceRoom).filter((id) => id !== state.me));
  if (prevRoomMembers.size || cur.size) {
    if ([...cur].some((id) => !prevRoomMembers.has(id))) ui.sounds.join();
    else if ([...prevRoomMembers].some((id) => !cur.has(id))) ui.sounds.leave();
  }
  prevRoomMembers = cur;
}

// ------------------------------------------------------------------ Ações (usadas pela UI)
const errMsg = (error) => {
  if (!error) return null;
  if (/row-level security|violates/i.test(error.message)) return 'Você não tem permissão para isso.';
  return error.message;
};

const actions = {
  selectView,
  joinVoice,
  leaveVoice: () => leaveVoice(),
  dmChannels: () => {
    const keys = chat.dmChannels();
    if (state.view?.type === 'dm') { const k = dmKey(state.me, state.view.id); if (!keys.includes(k)) keys.unshift(k); }
    return keys;
  },
  setStatus: (status, statusText = '') => setMeta({ status, statusText }),
  async moderate(id, action) {
    const { error } = await sb.from('mod_actions').insert({ target: id, action });
    if (error) return ui.toast({ title: 'Ação não permitida', body: errMsg(error) });
    const label = { mute: 'foi mutado(a)', unmute: 'foi desmutado(a)', kick: 'foi removido(a) da sala' }[action];
    ui.toast({ title: `${displayName(id)} ${label}`, timeout: 3000 });
  },
  async setRole(id, role) {
    const { error } = await sb.from('profiles').update({ role }).eq('id', id);
    if (error) { ui.toast({ title: 'Não foi possível mudar o cargo', body: errMsg(error) }); return errMsg(error); }
    return null;
  },
  async createRoom(data) {
    const siblings = [...state.rooms.values()].filter((r) => (r.category_id || null) === data.category_id);
    const position = Math.max(-1, ...siblings.map((r) => r.position)) + 1;
    const { data: row, error } = await sb.from('rooms').insert({ ...data, position, created_by: state.me }).select().single();
    if (error) return errMsg(error);
    await loadRooms();
    if (row.kind === 'text') selectView({ type: 'text', id: row.id });
    return null;
  },
  async updateRoom(id, data) {
    const { error } = await sb.from('rooms').update(data).eq('id', id);
    if (error) return errMsg(error);
    await loadRooms();
    return null;
  },
  async deleteRoom(id) {
    const { error } = await sb.from('rooms').delete().eq('id', id);
    if (error) return errMsg(error);
    await loadRooms();
    return null;
  },
  async createCategory(data) {
    const position = Math.max(-1, ...[...state.categories.values()].map((c) => c.position)) + 1;
    const { error } = await sb.from('categories').insert({ ...data, position });
    if (error) return errMsg(error);
    await loadRooms();
    return null;
  },
  async updateCategory(id, data) {
    const { error } = await sb.from('categories').update(data).eq('id', id);
    if (error) return errMsg(error);
    await loadRooms();
    return null;
  },
  async deleteCategory(id) {
    const { error } = await sb.from('categories').delete().eq('id', id);
    if (error) return errMsg(error);
    await loadRooms();
    return null;
  },
  async saveProfile({ name, color }) {
    const { error } = await sb.from('profiles').update({ name, color }).eq('id', state.me);
    if (error) return errMsg(error);
    state.profiles.set(state.me, { ...myProfile(), name, color });
    renderAll();
    return null;
  },
  ring(id) {
    sendTo(id, 'ring', { room: state.voiceRoom });
    ui.toast({ title: `Chamando ${displayName(id)}…`, timeout: 3000 });
  },
  async logout() {
    leaveVoice(true);
    await stopNet();
    await sb.auth.signOut();
    location.replace('/login');
  },
};

// ------------------------------------------------------------------ Eventos
function bindEvents() {
  on('presence', () => { checkRoomSounds(); renderAll(); });
  on('unread', renderAll);
  on('speaking', renderAll);
  on('media-local', () => ui.renderControls());
  on('connection', renderAll);
  on('open-view', selectView);

  on('db:rooms', () => loadRooms());
  on('db:categories', () => loadRooms());
  on('db:profiles', (p) => {
    const row = p.new;
    if (!row?.id) return;
    const old = state.profiles.get(row.id);
    state.profiles.set(row.id, { id: row.id, email: row.email, name: row.name, color: row.color, role: row.role });
    if (row.id === state.me && old && old.role !== row.role) {
      ui.toast({ title: `Seu cargo agora é ${ROLES[row.role].label}` });
      loadRooms();
    }
    renderAll();
    emit('tiles');
  });
  on('db:mod', (m) => {
    const by = displayName(m.by_id);
    if (m.action === 'mute') { rtc.forceMute(true); ui.toast({ title: 'Você foi mutado', body: `Por ${by}.` }); }
    else if (m.action === 'unmute') { rtc.forceMute(false); ui.toast({ title: 'Você pode falar de novo', body: `Desmutado por ${by}.` }); }
    else if (m.action === 'kick' && state.voiceRoom) { leaveVoice(); ui.toast({ title: 'Você foi removido da sala', body: `Por ${by}.` }); }
    renderAll();
  });
  on('inbox:ring', ({ from, room }) => {
    const r = room && state.rooms.get(room);
    const busy = state.presence.get(state.me)?.status === 'busy';
    if (!busy) ui.sounds.ring();
    ui.toast({
      title: `🔔 ${displayName(from)} está te chamando`,
      body: r ? `Para a sala 🔊 ${r.name}` : 'Quer falar com você.',
      timeout: 25000,
      actions: [
        r ? { label: 'Entrar', primary: true, onClick: () => joinVoice(r.id) } : null,
        { label: 'Mensagem', onClick: () => selectView({ type: 'dm', id: from }) },
      ].filter(Boolean),
    });
    if (document.hidden && !busy && 'Notification' in window && Notification.permission === 'granted') new Notification(`${displayName(from)} está te chamando no Turbo Office`);
  });
  on('kicked', () => { leaveVoice(true); stopNet(); $('#kicked').hidden = false; });

  // Botões
  const toggleMic = async () => { await rtc.toggleMic(); ui.renderControls(); };
  const toggleDeaf = () => { rtc.toggleDeaf(); ui.renderControls(); };
  const toggleCam = async () => { if (state.voiceRoom) { await rtc.toggleCam(); ui.renderControls(); } };
  $('#micBtn').onclick = $('#cMic').onclick = toggleMic;
  $('#deafBtn').onclick = $('#cDeaf').onclick = toggleDeaf;
  $('#cCam').onclick = toggleCam;
  $('#cScreen').onclick = async () => { await rtc.toggleScreen(); ui.renderControls(); };
  $('#cLeave').onclick = $('#vpLeave').onclick = () => leaveVoice();
  $('#lobbyJoin').onclick = () => state.view?.type === 'voice' && joinVoice(state.view.id);
  $('#settingsBtn').onclick = () => ui.openSettings();
  $('#meBtn').onclick = (e) => { e.stopPropagation(); ui.openStatusMenu(e.currentTarget); };
  $('#adminBtn').onclick = () => ui.openAdmin();
  $('#composer').onsubmit = (e) => { e.preventDefault(); chat.sendMessage(); };
  $('#spotClose').onclick = ui.closeSpotlight;
  $('#navToggle').onclick = () => $('#layout').classList.toggle('nav-open');
  $('#membersToggle').onclick = () => {
    const hidden = $('#layout').classList.toggle('no-members');
    localStorage.setItem('to.members', hidden ? '0' : '1');
  };

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { ui.closeSpotlight(); ui.closePopover(); return; }
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
    if (e.code === 'KeyA') { e.preventDefault(); toggleMic(); }
    else if (e.code === 'KeyD') { e.preventDefault(); toggleDeaf(); }
    else if (e.code === 'KeyV') { e.preventDefault(); toggleCam(); }
  });

  // Ausente automático após 10 min com a aba escondida
  let awayTimer = null, autoAway = false;
  document.addEventListener('visibilitychange', () => {
    const m = getMeta();
    if (document.hidden) {
      awayTimer = setTimeout(() => { if (m.status === 'available') { autoAway = true; setMeta({ status: 'away' }); } }, 10 * 60e3);
    } else {
      clearTimeout(awayTimer);
      if (autoAway && getMeta().status === 'away') setMeta({ status: 'available' });
      autoAway = false;
      const key = chat.currentKey();
      if (key && chat.unreadOf(key)) chat.openChannel(key);
    }
  });
}

// ------------------------------------------------------------------ Boot
function fail(msg) {
  $('#loadingText').textContent = msg;
  $('#loading').hidden = false;
}

async function boot() {
  try {
    sb = await getSupabase();
    state.cfg = await getConfig();
  } catch (e) { return fail(e.message); }

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return location.replace('/login');
  state.me = session.user.id;
  $('#serverName').textContent = state.cfg.serverName || 'Turbo Office';
  document.title = state.cfg.serverName ? `${state.cfg.serverName} · Turbo Office` : 'Turbo Office';
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.replace('/login'); });

  const { data: profiles, error } = await sb.from('profiles').select('id, email, name, color, role');
  if (error) return fail(`Banco não configurado (${error.message}). Rode supabase/schema.sql no Supabase.`);
  state.profiles = new Map(profiles.map((p) => [p.id, p]));
  if (!state.profiles.has(state.me)) {
    return fail('Seu perfil não foi encontrado. Se a conta foi criada antes do schema.sql, apague o usuário no Supabase (Authentication → Users) e cadastre de novo.');
  }
  await loadRooms();
  await chat.initChat(sb);
  rtc.setIceServers(state.cfg.iceServers || []);
  ui.setActions(actions);
  rtc.initStage($('#stage'), ui.openSpotlight);
  bindEvents();
  await startNet(sb);

  if (localStorage.getItem('to.members') === '0' || (innerWidth < 1100 && localStorage.getItem('to.members') !== '1')) $('#layout').classList.add('no-members');
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('to.view') || 'null'); } catch {}
  const valid = saved && (saved.type === 'dm' ? state.profiles.has(saved.id) : state.rooms.get(saved.id)?.kind === (saved.type === 'voice' ? 'voice' : 'text'));
  // Não reentra em sala de voz sozinho ao recarregar: mostra a sala, a pessoa clica em Entrar
  $('#loading').hidden = true;
  $('#layout').hidden = false;
  selectView(valid ? saved : defaultView());

  if ('Notification' in window && Notification.permission === 'default') {
    document.addEventListener('click', () => Notification.requestPermission().catch(() => {}), { once: true });
  }
  setInterval(rtc.updatePeers, 500);
}

boot();

// Exposto para testes/depuração no console
window.turbo = { state, rank };
