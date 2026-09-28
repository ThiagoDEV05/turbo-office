// Turbo Music — bot de música das salas de voz (comandos no estilo Jockie: m!play, m!skip…).
// Cada pessoa da sala toca a música no próprio navegador pelo player oficial do YouTube,
// sincronizada pelo relógio do servidor. O estado (fila, música atual) fica em room_music.
import { state, emit, on, displayName } from './state.js';
import { $, h, toast, openPopoverAt, closePopover } from './ui.js';
import { postBot, BOT_NAME } from './chat.js';

let sb = null;
let clockOffset = 0;            // hora do servidor - hora local (ms)
let player = null;
let playerReady = false;
let ytLoading = null;
let loadedUid = null;
let personalVol = Number(localStorage.getItem('to.musicVol') ?? 1);
const serverNow = () => Date.now() + clockOffset;
const row = () => (state.voiceRoom ? state.music.get(state.voiceRoom) : null);

// ------------------------------------------------------------------ Início
export async function initMusic(client) {
  sb = client;
  await syncClock();
  setInterval(syncClock, 10 * 60e3);
  const { data } = await sb.from('room_music').select('*');
  for (const r of data || []) state.music.set(r.room_id, r);
  on('db:room_music', (p) => {
    if (p.eventType === 'DELETE') state.music.delete(p.old?.room_id);
    else if (p.new?.room_id) state.music.set(p.new.room_id, p.new);
    if (!p.new || p.new.room_id === state.voiceRoom) apply();
    emit('music');
  });
  setInterval(tick, 1000);
  bindBar();
}

async function syncClock() {
  try {
    const t0 = Date.now();
    const { data } = await sb.rpc('server_now_ms');
    const t1 = Date.now();
    if (Number.isFinite(Number(data))) clockOffset = Number(data) - (t0 + t1) / 2;
  } catch {}
}

// Entrou/saiu de sala: toca ou para
export function onRoomChange() {
  loadedUid = null;
  apply();
}

// ------------------------------------------------------------------ Player do YouTube
function loadYT() {
  if (window.YT?.Player) return Promise.resolve();
  ytLoading ||= new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.append(s);
  });
  return ytLoading;
}

async function ensurePlayer() {
  await loadYT();
  if (player) return;
  await new Promise((resolve) => {
    player = new YT.Player('musicPlayer', {
      width: 128, height: 72,
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
      events: {
        onReady: () => { playerReady = true; resolve(); },
        onStateChange: onPlayerState,
        onError: onPlayerError,
      },
    });
  });
}

const expectedPos = (cur) => (cur.paused_at != null ? Number(cur.paused_at) : Math.max(0, (serverNow() - Number(cur.started_at)) / 1000));

async function apply() {
  renderBar();
  const cur = row()?.current;
  if (!cur) {
    if (playerReady) player.stopVideo();
    loadedUid = null;
    return;
  }
  await ensurePlayer();
  const pos = expectedPos(cur);
  if (loadedUid !== cur.uid) {
    loadedUid = cur.uid;
    player.loadVideoById({ videoId: cur.videoId, startSeconds: pos });
    if (cur.paused_at != null) setTimeout(() => player.pauseVideo(), 800);
  } else {
    const st = player.getPlayerState();
    const drift = Math.abs(player.getCurrentTime() - pos);
    if (cur.paused_at != null) {
      if (st === 1) player.pauseVideo();
      if (drift > 1.5) player.seekTo(pos, true);
    } else {
      if (st === 2 || st === 5) player.playVideo();
      if (st === 1 && drift > 2) player.seekTo(pos, true); // corrige atraso (sincronia)
    }
  }
  applyVolume();
}

export function applyVolume() {
  if (!playerReady) return;
  const v = Math.round((row()?.volume ?? 70) * personalVol);
  if (state.deafened) player.mute();
  else { player.unMute(); player.setVolume(v); }
}

function onPlayerState(e) {
  if (e.data === 0) advance(false); // acabou
  renderBar();
}

async function onPlayerError(e) {
  const cur = row()?.current;
  if (!cur) return;
  const r = await advance(true);
  if (r?.changed) {
    const why = [101, 150].includes(e.data) ? 'o dono não permite tocar fora do YouTube' : 'vídeo indisponível';
    postBot(`room:${state.voiceRoom}`, `⚠️ Não deu para tocar "${cur.title}" (${why}). Pulando…`);
  }
}

// Avança a fila. Várias pessoas podem chamar ao mesmo tempo: só a primeira muda (uid esperado).
async function advance(skip) {
  const room = state.voiceRoom;
  const cur = row()?.current;
  if (!room || !cur) return null;
  const { data } = await sb.rpc('music_next', { p_room: room, p_expected: cur.uid, p_skip: skip });
  return data;
}

// Sincronia contínua + fim de música sem evento (ex.: player atrasado)
function tick() {
  const cur = row()?.current;
  if (!cur) return;
  renderProgress();
  if (!playerReady) return;
  const pos = expectedPos(cur);
  if (cur.paused_at == null && cur.duration > 0 && pos > cur.duration + 4) advance(false);
  if (Math.floor(Date.now() / 1000) % 4 === 0) apply();
}

// ------------------------------------------------------------------ Barra "tocando agora"
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60; return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`; };
const durationOf = (cur) => cur.duration || (playerReady && player.getVideoData?.().video_id === cur.videoId ? player.getDuration() : 0);

function renderBar() {
  const bar = $('#musicBar');
  if (!bar) return;
  const r = row();
  const cur = r?.current;
  const visible = !!cur && state.view?.type === 'voice' && state.view.id === state.voiceRoom;
  bar.hidden = !visible;
  if (!cur) return;
  $('#mbTitle').textContent = cur.title;
  const loopTxt = { track: ' · 🔂 repetindo a música', queue: ' · 🔁 repetindo a fila' }[r.repeat_mode] || '';
  $('#mbSub').textContent = `pedido por ${displayName(cur.by)}${cur.author ? ` · ${cur.author}` : ''}${loopTxt}`;
  $('#mbPause').textContent = cur.paused_at != null ? '▶️' : '⏸';
  $('#mbPause').title = cur.paused_at != null ? 'Continuar' : 'Pausar';
  $('#mbLoop').classList.toggle('on', r.repeat_mode !== 'off');
  $('#mbLoop').textContent = r.repeat_mode === 'track' ? '🔂' : '🔁';
  $('#mbQueueN').textContent = r.queue?.length ? String(r.queue.length) : '';
  $('#mbVol').value = personalVol;
  renderProgress();
}

function renderProgress() {
  const cur = row()?.current;
  if (!cur || $('#musicBar').hidden) return;
  const pos = expectedPos(cur), dur = durationOf(cur);
  $('#mbTime').textContent = fmt(pos);
  $('#mbDur').textContent = dur ? fmt(dur) : '–:––';
  $('#mbFill').style.width = dur ? `${Math.min(100, (pos / dur) * 100)}%` : '0';
}

function bindBar() {
  const key = () => `room:${state.voiceRoom}`;
  $('#mbPause').onclick = () => handleCommand(row()?.current?.paused_at != null ? 'm!resume' : 'm!pause', key(), { silent: true });
  $('#mbSkip').onclick = () => handleCommand('m!skip', key());
  $('#mbStop').onclick = () => handleCommand('m!stop', key());
  $('#mbLoop').onclick = () => handleCommand('m!loop', key());
  $('#mbVol').oninput = (e) => { personalVol = Number(e.target.value); localStorage.setItem('to.musicVol', String(personalVol)); applyVolume(); };
  $('#mbQueue').onclick = (e) => { e.stopPropagation(); openQueue(e.currentTarget); };
  on('voice-chat', renderBar);
}

function openQueue(anchor) {
  const r = row();
  openPopoverAt(anchor, (el) => {
    el.append(h('div', { class: 'menu-label' }, `Fila (${r?.queue?.length || 0})`));
    if (r?.current) el.append(h('div', { class: 'pop-row' }, h('b', {}, '▶️ '), r.current.title));
    if (!r?.queue?.length) el.append(h('div', { class: 'pop-row muted' }, 'Nada na fila. Use m!play <música>.'));
    (r?.queue || []).slice(0, 25).forEach((t, i) => el.append(h('div', { class: 'pop-row queue-row' },
      h('span', { class: 'muted' }, `${i + 1}.`), h('span', { class: 'q-title' }, t.title),
      h('button', { class: 'icon-btn', title: 'Remover', onclick: () => { closePopover(); handleCommand(`m!remove ${i + 1}`, `room:${state.voiceRoom}`); } }, '✕'))));
    if ((r?.queue?.length || 0) > 25) el.append(h('div', { class: 'pop-row muted' }, `…e mais ${r.queue.length - 25}`));
  }, 'above');
}

// ------------------------------------------------------------------ Comandos (m!…)
const HELP = [
  `🎵 ${BOT_NAME} — comandos`,
  'm!play <link ou nome> — toca ou põe na fila (YouTube, YouTube Music, Spotify)',
  'm!playnext <link ou nome> — põe como a próxima',
  'm!skip — pula · m!pause — pausa · m!resume — continua',
  'm!stop — para e limpa a fila · m!clear — limpa a fila',
  'm!queue — mostra a fila · m!np — o que está tocando',
  'm!volume <0-100> — volume para todos da sala',
  'm!loop [off | track | queue] — repetir · m!shuffle — embaralha',
  'm!remove <nº> — tira da fila · m!seek <1:30> — pula para um ponto',
  'Dica: cada um ajusta o próprio volume na barra da música.',
].join('\n');

async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, ''));
  return data;
}

async function resolve(q) {
  const { data } = await sb.auth.getSession();
  const r = await fetch(`/api/music?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${data.session?.access_token || ''}` } });
  return r.json();
}

const parseTime = (t) => { const p = String(t || '').split(':').map(Number); if (p.some((n) => !Number.isFinite(n))) return null; return p.reduce((a, n) => a * 60 + n, 0); };
const bar = (pos, dur) => { const n = 14, k = dur ? Math.min(n - 1, Math.floor((pos / dur) * n)) : 0; return `${'▬'.repeat(k)}🔘${'▬'.repeat(n - 1 - k)}`; };

export async function handleCommand(text, key, { silent = false } = {}) {
  const [c0, ...rest] = text.trim().slice(2).trim().split(/\s+/);
  const cmd = (c0 || '').toLowerCase();
  const arg = rest.join(' ').trim();
  const reply = (t) => (silent ? null : postBot(key, t));
  const room = state.voiceRoom;
  const me = displayName(state.me);
  if (['help', 'h', 'ajuda', ''].includes(cmd)) return reply(HELP);
  if (!room) return reply('🔈 Entre numa sala de voz primeiro — eu toco a música para quem estiver na sua sala.');
  // Comando no chat de OUTRA sala de voz: toca onde a pessoa está? Não — pede para entrar na sala do chat.
  const chatRoom = key?.startsWith('room:') ? state.rooms.get(key.slice(5)) : null;
  if (chatRoom?.kind === 'voice' && chatRoom.id !== room) {
    return reply(`🔈 Você não está em 🔊 ${chatRoom.name}. Entre nessa sala para tocar música aqui (ou use o chat da sala em que você está).`);
  }
  const r = row();
  const cur = r?.current;
  try {
    switch (cmd) {
      case 'play': case 'p': case 'tocar': case 'playnext': case 'pn': case 'playtop': {
        if (!arg) {
          if (cur?.paused_at != null) { await rpc('music_control', { p_room: room, p_action: 'resume' }); return reply('▶️ Continuando.'); }
          return reply('Use: m!play <link do YouTube ou nome da música>');
        }
        const res = await resolve(arg);
        if (res.error) return reply(`⚠️ ${res.error}`);
        const next = ['playnext', 'pn', 'playtop'].includes(cmd);
        const out = await rpc('music_enqueue', { p_room: room, p_tracks: res.tracks, p_next: next });
        const t = res.tracks[0];
        const dur = t.duration ? ` (${fmt(t.duration)})` : '';
        if (res.kind === 'playlist') {
          return reply(`📃 Playlist: ${out.added} músicas adicionadas à fila por ${me}.${out.position === -1 ? `\n▶️ Tocando agora: ${out.current.title}` : ''}`);
        }
        if (out.position === -1) return reply(`▶️ Tocando agora: ${t.title}${dur} — pedido por ${me}`);
        return reply(`➕ Na fila${next ? ' (próxima)' : ` (#${out.position + 1})`}: ${t.title}${dur}`);
      }
      case 'skip': case 's': case 'next': case 'pular': {
        if (!cur) return reply('Nada tocando agora.');
        const out = await rpc('music_next', { p_room: room, p_expected: cur.uid, p_skip: true });
        return reply(`⏭️ Pulei: ${cur.title}${out.current ? `\n▶️ Agora: ${out.current.title}` : '\n⏹️ A fila acabou.'}`);
      }
      case 'stop': case 'leave': case 'dc': case 'disconnect': case 'parar':
        await rpc('music_control', { p_room: room, p_action: 'stop' });
        return reply('⏹️ Parei a música e limpei a fila.');
      case 'pause': case 'pausar':
        if (!cur) return reply('Nada tocando agora.');
        await rpc('music_control', { p_room: room, p_action: 'pause' });
        return reply('⏸️ Pausado. Use m!resume para continuar.');
      case 'resume': case 'r': case 'unpause': case 'continuar':
        if (!cur) return reply('Nada tocando agora.');
        await rpc('music_control', { p_room: room, p_action: 'resume' });
        return reply('▶️ Continuando.');
      case 'queue': case 'q': case 'fila': {
        if (!cur && !r?.queue?.length) return reply('A fila está vazia. Use m!play <música>.');
        const lines = [`▶️ Tocando: ${cur ? cur.title : '—'}`];
        (r.queue || []).slice(0, 10).forEach((t, i) => lines.push(`${i + 1}. ${t.title}${t.duration ? ` (${fmt(t.duration)})` : ''}`));
        if ((r.queue?.length || 0) > 10) lines.push(`…e mais ${r.queue.length - 10}`);
        return reply(lines.join('\n'));
      }
      case 'np': case 'nowplaying': case 'tocando': {
        if (!cur) return reply('Nada tocando agora.');
        const pos = expectedPos(cur), dur = durationOf(cur);
        return reply(`🎶 ${cur.title}\n${bar(pos, dur)} ${fmt(pos)} / ${dur ? fmt(dur) : '–:––'}\npedido por ${displayName(cur.by)}`);
      }
      case 'volume': case 'vol': case 'v': {
        if (!arg) return reply(`🔊 Volume da sala: ${r?.volume ?? 70}%`);
        const n = Math.round(Number(arg.replace('%', '')));
        const out = await rpc('music_control', { p_room: room, p_action: 'volume', p_arg: String(n) });
        return reply(`🔊 Volume da sala: ${out.volume}%`);
      }
      case 'loop': case 'repeat': case 'repetir': {
        const map = { off: 'off', desligar: 'off', track: 'track', song: 'track', musica: 'track', 'música': 'track', queue: 'queue', fila: 'queue', all: 'queue' };
        const cycle = { off: 'track', track: 'queue', queue: 'off' };
        const mode = arg ? map[arg.toLowerCase()] : cycle[r?.repeat_mode || 'off'];
        if (!mode) return reply('Use: m!loop off | track | queue');
        await rpc('music_control', { p_room: room, p_action: 'loop', p_arg: mode });
        return reply({ off: '➡️ Repetição desligada.', track: '🔂 Repetindo esta música.', queue: '🔁 Repetindo a fila.' }[mode]);
      }
      case 'shuffle': case 'embaralhar':
        await rpc('music_control', { p_room: room, p_action: 'shuffle' });
        return reply('🔀 Fila embaralhada.');
      case 'remove': case 'rm': case 'remover': {
        const out = await rpc('music_control', { p_room: room, p_action: 'remove', p_arg: String(parseInt(arg, 10)) });
        return reply(`🗑️ Removida da fila: ${out.removed?.title || ''}`);
      }
      case 'clear': case 'limpar':
        await rpc('music_control', { p_room: room, p_action: 'clear' });
        return reply('🧹 Fila limpa (a música atual continua).');
      case 'seek': {
        const s = parseTime(arg);
        if (s === null || !cur) return reply('Use: m!seek 1:30');
        await rpc('music_control', { p_room: room, p_action: 'seek', p_arg: String(s) });
        return reply(`⏩ Pulei para ${fmt(s)}.`);
      }
      default:
        return reply('❓ Não conheço esse comando. Veja a lista com m!help.');
    }
  } catch (e) {
    if (silent) toast({ title: BOT_NAME, body: e.message });
    return reply(`⚠️ ${e.message}`);
  }
}
