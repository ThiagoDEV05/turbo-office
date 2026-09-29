// Controlador principal: sessão, dados, navegação, salas de voz e ações.
import { getSupabase, getConfig } from './supa.js';
import { state, on, emit, myProfile, myRank, rank, displayName, membersIn, dmKey, ROLES } from './state.js';
import { startNet, setMeta, getMeta, sendTo, stopNet } from './net.js';
import * as net from './net.js';
import * as rtc from './rtc.js';
import * as ui from './ui.js';
import * as chat from './chat.js';
import * as music from './music.js';
import { applyPrefs, loadLocalPrefs, getPrefs } from './prefs.js';

// Aplica o tema salvo no navegador antes de qualquer coisa (sem piscar)
applyPrefs(loadLocalPrefs());

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
    const vKey = state.view?.type === 'voice' ? `room:${state.view.id}` : null;
    $('#voiceChat').hidden = !chat.voiceChatKey();
    $('#cChat').classList.toggle('on', !!chat.voiceChatKey());
    const vUnread = vKey && !chat.voiceChatKey() ? chat.unreadOf(vKey) : 0;
    $('#cChatBadge').hidden = !vUnread;
    $('#cChatBadge').textContent = vUnread > 99 ? '99+' : String(vUnread);
    $('#adminBtn').hidden = myRank() < 2;
    ui.renderServerSettings();
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

// Alguém entrou online mas o perfil ainda não está carregado (ex.: acabou de se cadastrar)
let fetchingProfiles = false;
async function fetchUnknownProfiles() {
  const missing = [...state.presence.keys()].filter((id) => !state.profiles.has(id));
  if (!missing.length || fetchingProfiles) return;
  fetchingProfiles = true;
  const { data } = await sb.from('profiles').select('id, email, name, color, role, avatar_url, bio, pronouns, banner_color, banner_color2, banner_url, name_color, decoration, created_at').in('id', missing);
  fetchingProfiles = false;
  for (const p of data || []) state.profiles.set(p.id, p);
  if (data?.length) { renderAll(); emit('tiles'); }
}

// Banimentos ativos (Gestor+ vê todos; RLS garante)
const activeBan = (b) => !b.until || Date.parse(b.until) > Date.now();
async function loadBans() {
  if (myRank() < 2) { state.bans = new Map(); return; }
  const { data } = await sb.from('bans').select('user_id, until, reason, by_id');
  state.bans = new Map((data || []).filter(activeBan).map((b) => [b.user_id, b]));
  ui.renderServerSettings();
}

let banned = false;
async function showBanned(ban) {
  if (banned) return;
  banned = true;
  $('#layout').hidden = true;
  document.querySelectorAll('.modal, #popover').forEach((m) => (m.hidden = true));
  try { leaveVoice(true); } catch {}
  stopNet().catch(() => {});
  fail(`⛔ Você foi banido ${ban.until ? `até ${ui.fmtDate(ban.until)}` : 'permanentemente'}${ban.reason ? ` — motivo: ${ban.reason}` : ''}. Fale com um Admin se achar que foi engano.`);
}

async function checkMyBan() {
  if (banned || !sb) return;
  const { data } = await sb.from('bans').select('user_id, until, reason').eq('user_id', state.me).maybeSingle();
  if (data && activeBan(data)) showBanned(data);
}

// ------------------------------------------------------------------ Servidores de rede (STUN + TURN)
// O TURN retransmite áudio/vídeo quando duas redes não conseguem se ligar direto (CGNAT etc.).
// As credenciais só vêm para quem está logado.
async function loadIceServers() {
  try {
    const { data } = await sb.auth.getSession();
    if (!data.session) return;
    const r = await fetch('/api/ice', { headers: { Authorization: `Bearer ${data.session.access_token}` } });
    const j = await r.json();
    if (Array.isArray(j.iceServers) && j.iceServers.length) rtc.setIceServers(j.iceServers);
  } catch (e) { console.warn('ICE', e); }
}

// ------------------------------------------------------------------ Agenda (link iCal)
let calEvents = [];
async function loadCalendar() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return;
  try {
    const r = await fetch('/api/calendar', { headers: { Authorization: `Bearer ${data.session.access_token}` } });
    state.calendar = await r.json();
  } catch { state.calendar = { connected: false, error: 'Não foi possível consultar a agenda agora.', events: [] }; }
  calEvents = (state.calendar.events || []).map((e) => [Date.parse(e.start), Date.parse(e.end)]);
  tickMeeting();
  emit('calendar');
}
// Em reunião agora? Atualiza a presença ("📅 Em reunião até 15:30") para todo mundo ver
function tickMeeting() {
  const now = Date.now();
  const cur = calEvents.find(([s, e]) => s <= now && now < e);
  const until = cur ? new Date(cur[1]).toISOString() : null;
  if ((getMeta().meeting?.until || null) !== until) setMeta({ meeting: until ? { until } : null });
}

// Barra de membros: aparece nos canais de texto e fica escondida nas salas de voz (cada um guarda a sua preferência)
const membersKind = () => (state.view?.type === 'voice' ? 'voice' : 'text');
function applyMembersPref() {
  const pref = localStorage.getItem(`to.members.${membersKind()}`);
  const show = pref ? pref === '1' : membersKind() === 'text' && innerWidth >= 1100;
  $('#layout').classList.toggle('no-members', !show);
}

// ------------------------------------------------------------------ Navegação
function selectView(view) {
  state.view = view;
  if (view) localStorage.setItem('to.view', JSON.stringify(view));
  const isVoice = view?.type === 'voice';
  $('#textView').hidden = !view || isVoice;
  $('#voiceView').hidden = !isVoice;
  $('#layout').classList.remove('nav-open');
  applyMembersPref();
  if (isVoice && chat.voiceChatKey()) chat.openChannel(chat.voiceChatKey());
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
  ui.sounds.join();
  state.voiceRoom = roomId;
  state.modMuted = false;
  prevRoomMembers = new Set(membersIn(roomId).filter((id) => id !== state.me));
  setMeta({ room: roomId });
  selectView({ type: 'voice', id: roomId });
  if (rtc.local.micOn && !(await rtc.startMic())) {
    ui.toast({ title: 'Microfone bloqueado', body: 'Você entrou só ouvindo. Libere o microfone no navegador para falar.' });
  }
  rtc.publishMedia();
  rtc.updatePeers();
  music.onRoomChange();
}

function leaveVoice(silent = false) {
  if (!state.voiceRoom) return;
  rtc.toggleTheater(false);
  rtc.closeAll();
  rtc.stopAllMedia();
  state.voiceRoom = null;
  state.modMuted = false;
  setMeta({ room: null });
  rtc.publishMedia();
  music.onRoomChange();
  if (!silent) ui.sounds.leave();
  renderAll();
}

// Sons de entrada/saída de outras pessoas na minha sala
let prevRoomMembers = new Set();
let savePrefsTimer = null;
function checkRoomSounds() {
  if (!state.voiceRoom) { prevRoomMembers = new Set(); return; }
  const cur = new Set(membersIn(state.voiceRoom).filter((id) => id !== state.me));
  if ([...cur].some((id) => !prevRoomMembers.has(id))) ui.sounds.peerJoin();
  else if ([...prevRoomMembers].some((id) => !cur.has(id))) ui.sounds.peerLeave();
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
  // Abre o chat de uma sala de voz sem entrar na chamada (como no Discord)
  openRoomChat(roomId) {
    if (!state.rooms.has(roomId)) return;
    if (!chat.isVoiceChatOpen()) chat.setVoiceChatOpen(true);
    selectView({ type: 'voice', id: roomId });
    setTimeout(() => $('#vcInput')?.focus(), 50);
  },
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
  async uploadPhoto(blob) {
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : 'webp';
    const path = `${state.me}/${Date.now()}.${ext}`;
    const { error } = await sb.storage.from('avatars').upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
    if (error) return { error: errMsg(error) };
    return { url: sb.storage.from('avatars').getPublicUrl(path).data.publicUrl };
  },
  async saveProfile(fields) {
    const allowed = ['name', 'color', 'avatar_url', 'banner_url', 'banner_color', 'banner_color2', 'name_color', 'pronouns', 'bio', 'decoration'];
    const patch = Object.fromEntries(allowed.filter((k) => k in fields).map((k) => [k, fields[k] === '' ? null : fields[k]]));
    const { error } = await sb.from('profiles').update(patch).eq('id', state.me);
    if (error) return /check constraint/i.test(error.message) ? 'Algum campo ficou fora do formato (bio até 190 caracteres, pronomes até 40).' : errMsg(error);
    const me = { ...myProfile(), ...patch };
    state.profiles.set(state.me, me);
    renderAll();
    emit('tiles');
    chat.renderMessages();
    // Apaga imagens antigas (mantém só a foto e a faixa atuais)
    const keep = new Set([me.avatar_url, me.banner_url].filter(Boolean).map((u) => u.split('/').pop()));
    const { data: files } = await sb.storage.from('avatars').list(state.me);
    const old = (files || []).map((f) => f.name).filter((n) => !keep.has(n)).map((n) => `${state.me}/${n}`);
    if (old.length) sb.storage.from('avatars').remove(old);
    return null;
  },
  savePrefs(prefs) {
    clearTimeout(savePrefsTimer);
    savePrefsTimer = setTimeout(() => sb.from('profiles').update({ prefs }).eq('id', state.me).then(() => {}), 600);
  },
  async startScreen(q) {
    if (!state.voiceRoom) return ui.toast({ title: 'Entre numa sala primeiro', body: 'A transmissão vai para quem está na sua sala de voz.' });
    const ok = await rtc.toggleScreen(q);
    if (ok) ui.toast({ title: '🖥️ Transmitindo sua tela', body: `${rtc.SCREEN_PRESETS[q.res]?.label || ''} · ${q.fps} fps${rtc.local.screenAudio ? ' · com som' : ''}`, timeout: 3000 });
    ui.renderControls();
  },
  async moveTo(id, roomId) {
    const { error } = await sb.from('mod_actions').insert({ target: id, action: 'move', room_id: roomId });
    if (error) return ui.toast({ title: 'Não foi possível mover', body: errMsg(error) });
    ui.toast({ title: `${displayName(id)} foi movido(a)`, body: `Para 🔊 ${state.rooms.get(roomId)?.name || 'outra sala'}`, timeout: 3000 });
  },
  async ban(id, ms, reason) {
    const until = ms ? new Date(Date.now() + ms).toISOString() : null;
    const { error } = await sb.from('bans').upsert({ user_id: id, until, reason: reason || null, by_id: state.me });
    if (error) return ui.toast({ title: 'Não foi possível banir', body: errMsg(error) });
    ui.toast({ title: `⛔ ${displayName(id)} foi banido(a)`, body: until ? `Até ${ui.fmtDate(until)}` : 'Permanente', timeout: 4000 });
    await loadBans(); renderAll();
  },
  async unban(id) {
    const { error } = await sb.from('bans').delete().eq('user_id', id);
    if (error) return ui.toast({ title: 'Não foi possível desbanir', body: errMsg(error) });
    ui.toast({ title: `✅ ${displayName(id)} foi desbanido(a)`, timeout: 3000 });
    await loadBans(); renderAll();
  },
  async getCalendarLink() {
    const { data } = await sb.from('calendar_links').select('ics_url').eq('user_id', state.me).maybeSingle();
    return data?.ics_url || '';
  },
  async saveCalendarLink(url) {
    const clean = url.trim().replace(/^webcal:\/\//i, 'https://');
    const invalid = ui.checkCalendarLink(clean);
    if (invalid) return { error: invalid, local: true };
    const { error } = await sb.from('calendar_links').upsert({ user_id: state.me, ics_url: clean, updated_at: new Date().toISOString() });
    if (error) return { error: errMsg(error), local: true };
    await loadCalendar();
    return state.calendar?.error ? { error: state.calendar.error } : null;
  },
  async removeCalendarLink() {
    await sb.from('calendar_links').delete().eq('user_id', state.me);
    state.calendar = { connected: false, events: [] };
    calEvents = [];
    tickMeeting();
    emit('calendar');
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
  on('presence', () => { checkRoomSounds(); fetchUnknownProfiles(); renderAll(); });
  on('unread', renderAll);
  // Quem está falando: só acende/apaga o anel verde (redesenhar a lista toda a cada fala fazia piscar)
  on('speaking', () => {
    for (const el of document.querySelectorAll('#channelList [data-uid], #memberList [data-uid], .msg[data-uid]')) {
      el.querySelector('.avatar')?.classList.toggle('speaking', state.speaking.has(el.dataset.uid));
    }
    const me = $('#meAvatar'); if (me) me.classList.toggle('speaking', state.speaking.has(state.me));
  });
  on('media-local', () => ui.renderControls());
  on('connection', (ok) => { if (!ok) checkMyBan(); renderAll(); });
  on('calendar', renderAll);
  on('open-view', selectView);

  on('db:rooms', () => loadRooms());
  on('db:bans', (p) => {
    const row = p.new?.user_id ? p.new : null;
    if (row?.user_id === state.me && activeBan(row)) { showBanned(row); return; }
    loadBans().then(renderAll);
  });
  on('db:categories', () => loadRooms());
  on('db:profiles', (p) => {
    const row = p.new;
    if (!row?.id) return;
    const old = state.profiles.get(row.id);
    const { prefs, ...pub } = row;
    state.profiles.set(row.id, pub);
    // Tema alterado em outro dispositivo: sincroniza
    if (row.id === state.me && prefs && Object.keys(prefs).length && JSON.stringify(prefs) !== JSON.stringify(getPrefs())) applyPrefs(prefs);
    if (row.id === state.me && old && old.role !== row.role) {
      ui.toast({ title: `Seu cargo agora é ${ROLES[row.role].label}` });
      loadRooms();
      loadBans();
    }
    renderAll();
    emit('tiles');
    chat.renderMessages();
  });
  on('db:mod', (m) => {
    const by = displayName(m.by_id);
    if (m.action === 'mute') { rtc.forceMute(true); ui.toast({ title: 'Você foi mutado', body: `Por ${by}.` }); }
    else if (m.action === 'unmute') { rtc.forceMute(false); ui.toast({ title: 'Você pode falar de novo', body: `Desmutado por ${by}.` }); }
    else if (m.action === 'kick' && state.voiceRoom) { leaveVoice(); ui.toast({ title: 'Você foi removido da sala', body: `Por ${by}.` }); }
    else if (m.action === 'move' && state.rooms.has(m.room_id)) { joinVoice(m.room_id); ui.toast({ title: `${by} te moveu de sala`, body: `Agora você está em 🔊 ${state.rooms.get(m.room_id).name}.` }); }
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
    if (document.hidden && !busy && 'Notification' in window && Notification.permission === 'granted') new Notification(`${displayName(from)} está te chamando no TurboFlow`);
  });
  on('kicked', () => { leaveVoice(true); stopNet(); $('#kicked').hidden = false; });

  // Botões
  const toggleMic = async () => {
    if (state.modMuted) return;
    const on = await rtc.toggleMic();
    on ? ui.sounds.unmute() : ui.sounds.mute();
    ui.renderControls();
  };
  const toggleDeaf = () => {
    rtc.toggleDeaf();
    state.deafened ? ui.sounds.mute() : ui.sounds.unmute();
    music.applyVolume();
    ui.renderControls();
  };
  const toggleCam = async () => { if (state.voiceRoom) { await rtc.toggleCam(); ui.renderControls(); } };
  $('#micBtn').onclick = $('#cMic').onclick = toggleMic;
  $('#deafBtn').onclick = $('#cDeaf').onclick = toggleDeaf;
  $('#cCam').onclick = toggleCam;
  // Transmite direto com a qualidade padrão (4K 60fps com som); ajuste só em Configurações → Voz e vídeo
  $('#cScreen').onclick = async () => {
    if (rtc.local.screen) { await rtc.toggleScreen(); ui.renderControls(); return; }
    actions.startScreen(rtc.getScreenQuality());
  };
  $('#cLeave').onclick = $('#vpLeave').onclick = () => leaveVoice();
  $('#lobbyJoin').onclick = () => state.view?.type === 'voice' && joinVoice(state.view.id);
  $('#settingsBtn').onclick = () => ui.openSettings();
  $('#micMenu').onclick = (e) => { e.stopPropagation(); ui.openDeviceMenu('mic', e.currentTarget); };
  $('#spkMenu').onclick = (e) => { e.stopPropagation(); ui.openDeviceMenu('spk', e.currentTarget); };
  $('#meBtn').onclick = (e) => { e.stopPropagation(); ui.openStatusMenu(e.currentTarget); };
  $('#adminBtn').onclick = () => ui.openServerSettings();
  $('#serverName').onclick = () => { if (myRank() >= 2) ui.openServerSettings(); };
  $('#composer').onsubmit = (e) => { e.preventDefault(); chat.sendMessage(); };
  on('mic-fallback', () => ui.toast({ title: '🎙️ Microfone trocado para o padrão', body: 'O microfone que você tinha escolhido não foi encontrado (fone desconectado?). Troque na setinha ao lado do microfone se quiser.' }));
  on('mic-error', (e) => {
    if (!state.voiceRoom) return;
    const blocked = e?.name === 'NotAllowedError';
    ui.toast({ title: '🎙️ Seu microfone não abriu', body: blocked ? 'O navegador bloqueou o microfone. Clique no cadeado ao lado do endereço do site e permita o microfone.' : 'Nenhum microfone encontrado ou ele está em uso por outro app. Clique no botão do microfone para tentar de novo.', timeout: 10000 });
    ui.renderControls();
  });
  $('#cCamBg').onclick = (e) => { e.stopPropagation(); ui.openBackgroundMenu(e.currentTarget); };
  on('bg-error', () => ui.toast({ title: 'Fundo virtual indisponível', body: 'Não consegui carregar o recorte de fundo neste navegador. A câmera continua normal. Use o Chrome ou o Edge atualizados.' }));
  $('#vcComposer').onsubmit = (e) => { e.preventDefault(); chat.sendVoiceMessage(); };
  $('#cChat').onclick = () => { chat.setVoiceChatOpen(!chat.isVoiceChatOpen()); renderAll(); if (chat.voiceChatKey()) setTimeout(() => $('#vcInput').focus(), 0); };
  $('#vcClose').onclick = () => { chat.setVoiceChatOpen(false); renderAll(); };
  on('voice-chat', renderAll);
  on('music', renderAll);
  $('#spotClose').onclick = ui.closeSpotlight;
  $('#navToggle').onclick = () => $('#layout').classList.toggle('nav-open');
  $('#membersToggle').onclick = () => {
    const hidden = $('#layout').classList.toggle('no-members');
    localStorage.setItem(`to.members.${membersKind()}`, hidden ? '0' : '1');
  };

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { ui.closeSpotlight(); ui.closePopover(); if (!document.fullscreenElement) rtc.toggleTheater(false); return; }
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
  $('#serverName').textContent = state.cfg.serverName || 'TurboFlow';
  document.title = state.cfg.serverName ? `${state.cfg.serverName} · TurboFlow` : 'TurboFlow';
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.replace('/login'); });

  const { data: profiles, error } = await sb.from('profiles').select('id, email, name, color, role, avatar_url, bio, pronouns, banner_color, banner_color2, banner_url, name_color, decoration, created_at');
  if (error) return fail(`Banco não configurado (${error.message}). Rode supabase/schema.sql no Supabase.`);
  state.profiles = new Map(profiles.map((p) => [p.id, p]));
  const { data: mine } = await sb.from('profiles').select('prefs').eq('id', state.me).maybeSingle();
  if (mine?.prefs && Object.keys(mine.prefs).length) applyPrefs(mine.prefs);
  else actions.savePrefs(getPrefs());
  if (!state.profiles.has(state.me)) {
    return fail('Seu perfil não foi encontrado. Se a conta foi criada antes do schema.sql, apague o usuário no Supabase (Authentication → Users) e cadastre de novo.');
  }
  const { data: myBan } = await sb.from('bans').select('user_id, until, reason').eq('user_id', state.me).maybeSingle();
  if (myBan && activeBan(myBan)) { $('#loading').hidden = false; return showBanned(myBan); }
  await loadRooms();
  await loadBans();
  await chat.initChat(sb);
  chat.setCommandHandler((text, key) => music.handleCommand(text, key));
  await music.initMusic(sb);
  rtc.setIceServers(state.cfg.iceServers || []);
  loadIceServers();
  setInterval(loadIceServers, 3 * 3600e3);
  ui.setActions(actions);
  rtc.initStage($('#stage'));
  bindEvents();
  await startNet(sb);

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
  setInterval(checkMyBan, 60e3);
  loadCalendar();
  setInterval(loadCalendar, 5 * 60e3);
  setInterval(tickMeeting, 20e3);
}

boot();

// Exposto para testes/depuração no console
window.turbo = { state, rank, rtc, net };
