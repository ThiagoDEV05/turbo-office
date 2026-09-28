// Áudio/vídeo/tela via WebRTC em malha (P2P) entre quem está na mesma sala de voz.
// Cada conexão tem 3 transceivers fixos (áudio, câmera, tela): ligar/desligar usa
// replaceTrack, sem renegociação. A oferta/resposta vai completa (ICE não-incremental)
// para gastar poucas mensagens de sinalização.
import { state, emit, on, displayName, colorOf, initials, membersIn, photoOf } from './state.js';
import { sendTo, setMeta } from './net.js';
import { BackgroundProcessor, getBackground, setBackgroundPref } from './background.js';

// 4 canais fixos por conexão: voz, câmera, tela e som da tela
const SLOTS = ['audio', 'cam', 'screen', 'screenAudio'];
const KINDS = ['audio', 'video', 'video', 'audio'];
const NSLOTS = SLOTS.length;

// ---------------------------------------------------------------- Qualidade (tudo liberado)
export const SCREEN_PRESETS = {
  '720': { label: '720p', w: 1280, h: 720, bitrate: 2_500_000 },
  '1080': { label: '1080p', w: 1920, h: 1080, bitrate: 6_000_000 },
  '1440': { label: '1440p', w: 2560, h: 1440, bitrate: 10_000_000 },
  '4k': { label: '4K', w: 3840, h: 2160, bitrate: 18_000_000 },
};
const readJSON = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return { ...d }; } };
// Padrão para todo mundo: 4K a 60 fps com som (cada um pode baixar se a rede não aguentar)
export const getScreenQuality = () => readJSON('to.screenq2', { res: '4k', fps: 60, audio: true });
export const setScreenQuality = (patch) => localStorage.setItem('to.screenq2', JSON.stringify({ ...getScreenQuality(), ...patch }));
export const getAudioProcessing = () => readJSON('to.audio', { noiseSuppression: true, echoCancellation: true, autoGainControl: true });
export async function setAudioProcessing(patch) {
  localStorage.setItem('to.audio', JSON.stringify({ ...getAudioProcessing(), ...patch }));
  if (local.mic) await startMic();
  emit('audio-processing');
}

// Opus em alta: estéreo, até 510 kbps, correção de perda de pacote (FEC), sem DTX
function tuneOpus(sdp) {
  const m = /a=rtpmap:(\d+) opus\/48000\/2/i.exec(sdp);
  if (!m) return sdp;
  const pt = m[1];
  const extra = { stereo: '1', 'sprop-stereo': '1', maxaveragebitrate: '510000', useinbandfec: '1', usedtx: '0' };
  const re = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`, 'g');
  if (sdp.includes(`a=fmtp:${pt} `)) {
    return sdp.replace(re, (line, params) => {
      const kv = Object.fromEntries(params.split(';').filter(Boolean).map((x) => x.trim().split('=')));
      return `a=fmtp:${pt} ${Object.entries({ ...kv, ...extra }).map(([k, v]) => `${k}=${v}`).join(';')}`;
    });
  }
  return sdp.split(m[0]).join(`${m[0]}\r\na=fmtp:${pt} ${Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(';')}`);
}

// VP9 primeiro para a tela (texto nítido com menos banda); os demais codecs continuam como reserva
function preferScreenCodec(transceiver) {
  try {
    const caps = RTCRtpReceiver.getCapabilities?.('video')?.codecs;
    if (!caps || !transceiver.setCodecPreferences) return;
    const rank = (c) => (/vp9/i.test(c.mimeType) ? 0 : /av1/i.test(c.mimeType) ? 1 : /h264/i.test(c.mimeType) ? 2 : 3);
    transceiver.setCodecPreferences([...caps].sort((a, b) => rank(a) - rank(b)));
  } catch {}
}

async function setEncoding(sender, enc, extra = {}) {
  try {
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    Object.assign(params.encodings[0], enc);
    Object.assign(params, extra);
    await sender.setParameters(params);
  } catch {}
}

// Aplica taxas de bits e prioridades em todos os envios de uma conexão
function tunePeer(peer) {
  const ts = peer.pc.getTransceivers();
  const q = getScreenQuality();
  const preset = SCREEN_PRESETS[q.res] || SCREEN_PRESETS['1080'];
  const fpsBoost = q.fps >= 60 ? 1.6 : q.fps <= 15 ? 0.7 : 1;
  // Conexão passando pelo servidor TURN (retransmitida): usa menos dados para a cota grátis durar.
  // Voz continua igual; câmera 1 Mbps; tela até ~1080p (4 Mbps) a no máximo 30 fps.
  const relayed = !!peer.relayed;
  if (ts[0]) setEncoding(ts[0].sender, { maxBitrate: 128_000, priority: 'high', networkPriority: 'high' });
  if (ts[1]) setEncoding(ts[1].sender, { maxBitrate: relayed ? 1_000_000 : 2_500_000, maxFramerate: 30 });
  // Banda total de upload para a tela (~40 Mbps) dividida entre quem está assistindo, mínimo 4 Mbps cada
  const viewers = Math.max(1, peers.size);
  let screenBitrate = Math.min(preset.bitrate * fpsBoost, Math.max(4_000_000, 40_000_000 / viewers));
  if (relayed) screenBitrate = Math.min(screenBitrate, 4_000_000);
  const fps = relayed ? Math.min(q.fps, 30) : q.fps;
  if (ts[2]) setEncoding(ts[2].sender, { maxBitrate: Math.round(screenBitrate), maxFramerate: fps, priority: 'high' },
    { degradationPreference: fps >= 60 ? 'maintain-framerate' : 'maintain-resolution' });
  if (ts[3]) setEncoding(ts[3].sender, { maxBitrate: 256_000 });
}

export const local = {
  mic: null,
  cam: null,
  screen: null,
  screenAudio: null,
  micOn: localStorage.getItem('to.micOn') !== '0',
  micDeviceId: localStorage.getItem('to.mic') || undefined,
  camDeviceId: localStorage.getItem('to.cam') || undefined,
  speakerDeviceId: localStorage.getItem('to.speaker') || '',
};

// Escolher a saída de áudio só funciona em navegadores com setSinkId (Chrome, Edge).
export const canPickSpeaker = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

export async function setSpeaker(deviceId) {
  local.speakerDeviceId = deviceId;
  localStorage.setItem('to.speaker', deviceId);
  for (const p of peers.values()) for (const el of [p.audioEl, p.screenAudioEl]) el.setSinkId?.(deviceId).catch(() => {});
  emit('speaker', deviceId);
}

let iceServers = [];
const peers = new Map(); // id -> peer
const userVolume = new Map(); // id -> 0..1 (ajuste local)
let audioCtx = null;

export function setIceServers(s) { iceServers = s; }
const localTrack = (slot) => [local.mic, local.cam, local.screen, local.screenAudio][slot] || null;
const micLive = () => !!(local.mic && local.micOn && !state.modMuted && !state.deafened);

// ------------------------------------------------------------------ Mídia local
export async function startMic() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: local.micDeviceId ? { exact: local.micDeviceId } : undefined, ...getAudioProcessing(), sampleRate: 48000, channelCount: 1 },
    });
    local.mic?.stop();
    local.mic = s.getAudioTracks()[0];
    local.mic.enabled = micLive();
    replaceAll(0, local.mic);
    watchSpeaking(state.me, new MediaStream([local.mic]));
    return true;
  } catch (e) {
    console.warn('Microfone indisponível', e);
    local.mic = null;
    return false;
  }
}

// Câmera: local.camRaw é a câmera de verdade; local.cam é o que vai para os outros
// (a própria câmera, ou o vídeo com fundo virtual aplicado).
let bgProcessor = null;
const hasEffect = (bg) => bg && bg !== 'none';

async function applyBackground() {
  const bg = getBackground();
  if (!local.camRaw) return;
  if (!hasEffect(bg)) {
    bgProcessor?.stop(); bgProcessor = null;
    local.cam = local.camRaw;
  } else if (bgProcessor) {
    bgProcessor.setBackground(bg); // troca de fundo sem reiniciar
    return;
  } else {
    try {
      bgProcessor = new BackgroundProcessor();
      local.cam = await bgProcessor.start(local.camRaw, bg);
    } catch (e) {
      console.warn('Fundo virtual indisponível', e);
      bgProcessor = null;
      local.cam = local.camRaw;
      emit('bg-error', e);
    }
  }
  replaceAll(1, local.cam);
  emit('tiles');
}

export async function startCam() {
  try {
    const effect = hasEffect(getBackground());
    // Com fundo virtual, 720p deixa o recorte leve e fluido
    const s = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: local.camDeviceId ? { exact: local.camDeviceId } : undefined, width: { ideal: effect ? 1280 : 1920 }, height: { ideal: effect ? 720 : 1080 }, frameRate: { ideal: 30 } },
    });
    stopCamTracks();
    local.camRaw = s.getVideoTracks()[0];
    local.cam = local.camRaw;
    if (effect) await applyBackground();
    else replaceAll(1, local.cam);
    return true;
  } catch (e) {
    console.warn('Câmera indisponível', e);
    local.cam = null;
    return false;
  }
}

function stopCamTracks() {
  bgProcessor?.stop(); bgProcessor = null;
  local.camRaw?.stop();
  if (local.cam && local.cam !== local.camRaw) local.cam.stop();
  local.camRaw = null;
  local.cam = null;
}

export function stopCam() {
  stopCamTracks();
  replaceAll(1, null);
}

// Troca o fundo (salva a escolha; aplica na hora se a câmera estiver ligada)
export async function setCameraBackground(bg) {
  const hadEffect = hasEffect(getBackground());
  setBackgroundPref(bg);
  if (!local.camRaw) return;
  // Sair do "sem efeito" para um efeito: reabre a câmera em 720p para ficar leve
  if (!hadEffect && hasEffect(bg) && (local.camRaw.getSettings().width || 0) > 1280) { await startCam(); emit('tiles'); return; }
  await applyBackground();
}
export { getBackground };

function applyMic() { if (local.mic) local.mic.enabled = micLive(); }

export async function toggleMic() {
  if (state.modMuted) return false;
  if (state.deafened) { state.deafened = false; applyDeaf(); local.micOn = true; }
  else local.micOn = !local.micOn;
  localStorage.setItem('to.micOn', local.micOn ? '1' : '0');
  if (local.micOn && !local.mic && state.voiceRoom) await startMic();
  applyMic();
  publishMedia();
  return local.micOn;
}

export function toggleDeaf() {
  state.deafened = !state.deafened;
  applyDeaf();
  applyMic();
  publishMedia();
}

// Voz: silenciada se eu estiver ensurdecido ou tiver silenciado a pessoa.
// Transmissão: silenciada se eu estiver ensurdecido ou tiver silenciado a transmissão dela.
function applyDeaf() {
  for (const p of peers.values()) {
    p.audioEl.muted = state.deafened || localMuted.has(p.id);
    p.screenAudioEl.muted = state.deafened || streamMuted.has(p.id);
  }
}

export function forceMute(muted) {
  state.modMuted = muted;
  applyMic();
  publishMedia();
}

export async function toggleCam() {
  if (local.cam) stopCam(); else await startCam();
  publishMedia();
  return !!local.cam;
}

export async function toggleScreen(opts) {
  if (local.screen) { stopScreen(); return false; }
  const q = { ...getScreenQuality(), ...(opts || {}) };
  const preset = SCREEN_PRESETS[q.res] || SCREEN_PRESETS['1080'];
  // Continua no Turbo Office ao escolher uma aba/janela (o Chrome pularia para ela por padrão)
  let controller = null;
  try {
    controller = typeof CaptureController !== 'undefined' ? new CaptureController() : null;
    controller?.setFocusBehavior?.('no-focus-change');
  } catch {}
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: preset.w }, height: { ideal: preset.h }, frameRate: { ideal: q.fps, max: q.fps } },
      audio: q.audio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48000, channelCount: 2 } : false,
      systemAudio: 'include', surfaceSwitching: 'include', selfBrowserSurface: 'exclude',
      ...(controller ? { controller } : {}),
    });
    // Navegadores mais antigos só aceitam a escolha logo depois da captura começar
    try { controller?.setFocusBehavior?.('no-focus-change'); } catch {}
    local.screen = s.getVideoTracks()[0];
    local.screen.contentHint = q.fps >= 60 ? 'motion' : 'detail';
    local.screen.onended = stopScreen;
    local.screenAudio = s.getAudioTracks()[0] || null;
    if (local.screenAudio) local.screenAudio.contentHint = 'music';
    replaceAll(2, local.screen);
    replaceAll(3, local.screenAudio);
    for (const p of peers.values()) tunePeer(p);
    publishMedia();
    return true;
  } catch { return false; }
}

function stopScreen() {
  local.screen?.stop();
  local.screenAudio?.stop();
  local.screen = null;
  local.screenAudio = null;
  replaceAll(2, null);
  replaceAll(3, null);
  publishMedia();
}

export function stopAllMedia() {
  local.mic?.stop(); local.mic = null;
  stopCamTracks();
  local.screen?.stop(); local.screen = null;
  local.screenAudio?.stop(); local.screenAudio = null;
  stopWatching(state.me);
}

export async function switchDevice(kind, deviceId) {
  if (kind === 'mic') { local.micDeviceId = deviceId; localStorage.setItem('to.mic', deviceId); if (local.mic) await startMic(); }
  else { local.camDeviceId = deviceId; localStorage.setItem('to.cam', deviceId); if (local.cam) await startCam(); }
  emit('tiles');
}

export function publishMedia() {
  const inRoom = !!state.voiceRoom;
  setMeta({ media: { mic: inRoom && micLive(), cam: inRoom && !!local.cam, screen: inRoom && !!local.screen }, deaf: state.deafened });
  emit('media-local');
  emit('tiles');
}

// "Silenciar para mim": só eu deixo de ouvir a pessoa (os outros continuam ouvindo)
const localMuted = new Set((() => { try { return JSON.parse(localStorage.getItem('to.localMuted') || '[]'); } catch { return []; } })());
export const isLocalMuted = (id) => localMuted.has(id);
export function setLocalMute(id, muted) {
  muted ? localMuted.add(id) : localMuted.delete(id);
  localStorage.setItem('to.localMuted', JSON.stringify([...localMuted]));
  applyDeaf();
  emit('tiles');
}

// Volumes por pessoa, separados como no Discord: voz e transmissão (som da tela). Ficam salvos.
const loadMap = (k) => { try { return new Map(Object.entries(JSON.parse(localStorage.getItem(k) || '{}'))); } catch { return new Map(); } };
const saveMap = (k, m) => { try { localStorage.setItem(k, JSON.stringify(Object.fromEntries(m))); } catch {} };
for (const [id, v] of loadMap('to.userVol')) userVolume.set(id, v);
const streamVolume = loadMap('to.streamVol');
const streamMuted = new Set((() => { try { return JSON.parse(localStorage.getItem('to.streamMuted') || '[]'); } catch { return []; } })());

export function setUserVolume(id, v) {
  userVolume.set(id, v);
  saveMap('to.userVol', userVolume);
  const p = peers.get(id);
  if (p) p.audioEl.volume = v;
}
export const getUserVolume = (id) => userVolume.get(id) ?? 1;

export function setStreamVolume(id, v) {
  streamVolume.set(id, v);
  saveMap('to.streamVol', streamVolume);
  const p = peers.get(id);
  if (p) p.screenAudioEl.volume = v;
  emit('stream-volume', id);
}
export const getStreamVolume = (id) => streamVolume.get(id) ?? 1;
export const isStreamMuted = (id) => streamMuted.has(id);
export function setStreamMuted(id, muted) {
  muted ? streamMuted.add(id) : streamMuted.delete(id);
  try { localStorage.setItem('to.streamMuted', JSON.stringify([...streamMuted])); } catch {}
  applyDeaf();
  emit('stream-volume', id);
}

function replaceAll(slot, track) {
  for (const peer of peers.values()) peer.pc.getTransceivers()[slot]?.sender.replaceTrack(track).catch(() => {});
}

// ------------------------------------------------------------------ Conexões
function createPeer(id, initiator) {
  const pc = new RTCPeerConnection({ iceServers });
  const audioEl = new Audio();
  audioEl.autoplay = true;
  audioEl.muted = state.deafened || localMuted.has(id);
  audioEl.volume = getUserVolume(id);
  const screenAudioEl = new Audio();
  screenAudioEl.autoplay = true;
  screenAudioEl.muted = state.deafened || streamMuted.has(id);
  screenAudioEl.volume = getStreamVolume(id);
  if (local.speakerDeviceId && canPickSpeaker) for (const el of [audioEl, screenAudioEl]) el.setSinkId(local.speakerDeviceId).catch(() => {});
  const peer = { id, pc, initiator, streams: {}, audioEl, screenAudioEl, createdAt: Date.now(), staleSince: null };
  peers.set(id, peer);

  pc.ontrack = (e) => {
    const key = SLOTS[pc.getTransceivers().indexOf(e.transceiver)];
    if (!key) return;
    peer.streams[key] = new MediaStream([e.track]);
    if (key === 'audio') {
      audioEl.srcObject = peer.streams.audio;
      audioEl.play().catch(() => {});
      watchSpeaking(id, peer.streams.audio);
    } else if (key === 'screenAudio') {
      screenAudioEl.srcObject = peer.streams.screenAudio;
      screenAudioEl.play().catch(() => {});
    }
    emit('tiles');
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') { failures.set(id, (failures.get(id) || 0) + 1); closePeer(id, true); }
    if (pc.connectionState === 'connected') { failures.delete(id); detectRelay(peer); }
    if (pc.connectionState === 'connected') for (const p of peers.values()) tunePeer(p);
    emit('tiles');
  };
  return peer;
}

// Espera as rotas de rede principais antes de mandar o convite: terminar a coleta, ou ~0,4 s
// depois da primeira rota pública (STUN/TURN), ou no máximo 3 s. O que chegar depois vai por "trickle".
function iceGathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let soon = null;
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); pc.removeEventListener('icecandidate', cand); clearTimeout(timer); clearTimeout(soon); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const cand = (e) => { if (e.candidate && /typ (srflx|relay)/.test(e.candidate.candidate) && !soon) soon = setTimeout(done, 400); };
    const timer = setTimeout(done, 3000);
    pc.addEventListener('icegatheringstatechange', check);
    pc.addEventListener('icecandidate', cand);
  });
}

// A conexão escolhida passa pelo TURN? (rota "relay" em algum dos lados)
async function detectRelay(peer) {
  try {
    const stats = await peer.pc.getStats();
    let pairId = null;
    stats.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId; });
    stats.forEach((r) => { if (!pairId && r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pairId = r.id; });
    const pair = pairId && stats.get(pairId);
    const relayed = !!pair && [stats.get(pair.localCandidateId), stats.get(pair.remoteCandidateId)].some((c) => c?.candidateType === 'relay');
    if (relayed !== !!peer.relayed) { peer.relayed = relayed; tunePeer(peer); emit('tiles'); }
  } catch {}
}

// Rotas que aparecem depois do convite já enviado: manda em lotes (trickle ICE)
function setupTrickle(peer) {
  peer.sentSdp = '';
  peer.iceQueue = [];
  peer.pc.addEventListener('icecandidate', (e) => {
    if (!e.candidate || !peer.sentSdp || peer.sentSdp.includes(e.candidate.candidate)) return;
    peer.iceQueue.push(e.candidate.toJSON());
    if (!peer.iceTimer) peer.iceTimer = setTimeout(() => {
      peer.iceTimer = null;
      const batch = peer.iceQueue.splice(0);
      if (batch.length && peers.get(peer.id) === peer) sendTo(peer.id, 'signal', { data: { type: 'ice', candidates: batch } });
    }, 250);
  });
}
function markSent(peer) { peer.sentSdp = peer.pc.localDescription?.sdp || ' '; }

// Rotas que chegaram antes do convite/resposta (as mensagens podem chegar fora de ordem)
const earlyIce = new Map(); // from -> candidates[]
async function flushIce(peer) {
  const list = [...(peer.pendingIce || []), ...(earlyIce.get(peer.id) || [])];
  peer.pendingIce = [];
  earlyIce.delete(peer.id);
  for (const c of list) await peer.pc.addIceCandidate(c).catch(() => {});
}

async function connect(id) {
  const peer = createPeer(id, true);
  const { pc } = peer;
  for (let i = 0; i < NSLOTS; i++) {
    const t = pc.addTransceiver(KINDS[i], { direction: 'sendrecv' });
    if (i === 2) preferScreenCodec(t);
    const track = localTrack(i);
    if (track) await t.sender.replaceTrack(track);
  }
  setupTrickle(peer);
  const offer = await pc.createOffer();
  await pc.setLocalDescription({ type: 'offer', sdp: tuneOpus(offer.sdp) });
  await iceGathered(pc);
  if (peers.get(id) !== peer) return;
  markSent(peer);
  sendTo(id, 'signal', { room: state.voiceRoom, data: { type: 'offer', sdp: pc.localDescription.toJSON() } });
}

export function closePeer(id, notify) {
  const peer = peers.get(id);
  if (!peer) return;
  peers.delete(id);
  try { peer.pc.close(); } catch {}
  peer.audioEl.srcObject = null;
  peer.screenAudioEl.srcObject = null;
  stopWatching(id);
  if (notify) sendTo(id, 'signal', { data: { type: 'bye' } });
  for (const p of peers.values()) if (p.pc.connectionState === 'connected') tunePeer(p);
  emit('tiles');
}

on('inbox:signal', async ({ from, room, data }) => {
  if (!from || !data) return;
  try {
    if (data.type === 'offer') {
      if (!state.voiceRoom || room !== state.voiceRoom) { sendTo(from, 'signal', { data: { type: 'bye' } }); return; }
      if (peers.has(from)) closePeer(from, false);
      const peer = createPeer(from, false);
      const { pc } = peer;
      setupTrickle(peer);
      await pc.setRemoteDescription(data.sdp);
      await flushIce(peer);
      const ts = pc.getTransceivers();
      for (let i = 0; i < ts.length && i < NSLOTS; i++) {
        ts[i].direction = 'sendrecv';
        if (i === 2) preferScreenCodec(ts[i]);
        const track = localTrack(i);
        if (track) await ts[i].sender.replaceTrack(track);
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription({ type: 'answer', sdp: tuneOpus(answer.sdp) });
      await iceGathered(pc);
      if (peers.get(from) !== peer) return;
      markSent(peer);
      sendTo(from, 'signal', { data: { type: 'answer', sdp: pc.localDescription.toJSON() } });
    } else if (data.type === 'answer') {
      const peer = peers.get(from);
      if (peer && peer.pc.signalingState === 'have-local-offer') { await peer.pc.setRemoteDescription(data.sdp); await flushIce(peer); }
    } else if (data.type === 'ice') {
      const list = Array.isArray(data.candidates) ? data.candidates.slice(0, 50) : [];
      const peer = peers.get(from);
      if (peer?.pc.remoteDescription) for (const c of list) await peer.pc.addIceCandidate(c).catch(() => {});
      else if (peer) (peer.pendingIce ||= []).push(...list);
      else earlyIce.set(from, [...(earlyIce.get(from) || []), ...list].slice(-50));
    } else if (data.type === 'bye') {
      closePeer(from, false);
    } else if (data.type === 'hello') {
      // O outro lado não recebeu o convite: manda de novo, na hora
      if (state.me < from && state.voiceRoom && room === state.voiceRoom && membersIn(state.voiceRoom).includes(from)) {
        closePeer(from, false);
        connect(from).catch((e) => console.warn(e));
      }
    }
  } catch (e) {
    console.warn('Erro de sinalização', e);
  }
});

// Chamado a cada 500 ms: conecta com quem está na minha sala de voz. O lado com id menor
// envia o convite (oferta); o outro responde. Se o convite não chegar, o outro lado pede
// um novo ("hello") — assim ninguém fica na sala sem áudio esperando recarregar.
const waitingSince = new Map();
const lastHello = new Map();
const BAD_AFTER = 20000; // tempo para rotas via NAT/TURN antes de recomeçar
const failures = new Map(); // id -> tentativas que falharam (rede bloqueando a conexão direta)
export const connectionHint = (id) => (failures.get(id) >= 2 ? 'Rede bloqueando a conexão direta — tentando de novo…' : 'Conectando…');

export function updatePeers() {
  const room = state.voiceRoom;
  const now = Date.now();
  const wanted = new Set(room ? membersIn(room).filter((id) => id !== state.me) : []);
  for (const id of wanted) {
    const peer = peers.get(id);
    if (peer) {
      if (peer.pc.connectionState === 'connected') peer.badSince = null;
      else peer.badSince ??= now;
    }
    const dead = peer && (peer.pc.connectionState === 'closed' || peer.pc.connectionState === 'failed');
    const stuck = peer && (dead || (peer.badSince && now - peer.badSince > BAD_AFTER));
    if (state.me < id) {
      if (!peer) connect(id).catch((e) => console.warn(e));
      else if (stuck) closePeer(id, false); // recria no próximo ciclo
    } else if (!peer || stuck) {
      if (!waitingSince.has(id)) waitingSince.set(id, now);
      if (now - waitingSince.get(id) > 4000 && now - (lastHello.get(id) || 0) > 12000) {
        lastHello.set(id, now);
        sendTo(id, 'signal', { room, data: { type: 'hello' } });
      }
    } else waitingSince.delete(id);
  }
  for (const id of waitingSince.keys()) if (!wanted.has(id)) waitingSince.delete(id);
  for (const [id, peer] of peers) {
    if (wanted.has(id)) { peer.staleSince = null; continue; }
    // dá uma folga para a presença atualizar antes de derrubar
    peer.staleSince ??= now;
    if (now - peer.staleSince > 3000) closePeer(id, true);
  }
}

export function closeAll() { for (const id of [...peers.keys()]) closePeer(id, true); }
export const peerState = (id) => peers.get(id)?.pc.connectionState || null;
// Diagnóstico (console): turbo.rtc.debugPeers()
export const debugPeers = () => [...peers.values()].map((p) => ({ id: p.id, state: p.pc.connectionState, relayed: !!p.relayed, pc: p.pc, voice: { volume: p.audioEl.volume, muted: p.audioEl.muted }, stream: { volume: p.screenAudioEl.volume, muted: p.screenAudioEl.muted } }));

// ------------------------------------------------------------------ Quem está falando
const analysers = new Map();
export function ensureAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function watchSpeaking(id, stream) {
  if (!audioCtx) return;
  stopWatching(id);
  try {
    const src = audioCtx.createMediaStreamSource(stream);
    const an = audioCtx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    analysers.set(id, { src, an, buf: new Uint8Array(an.fftSize), last: 0 });
  } catch (e) { console.warn(e); }
}
function stopWatching(id) {
  const a = analysers.get(id);
  if (a) { try { a.src.disconnect(); } catch {} analysers.delete(id); }
  if (state.speaking.delete(id)) emit('speaking');
}

setInterval(() => {
  let changed = false;
  const now = performance.now();
  for (const [id, a] of analysers) {
    a.an.getByteTimeDomainData(a.buf);
    let sum = 0;
    for (const v of a.buf) { const x = (v - 128) / 128; sum += x * x; }
    const rms = Math.sqrt(sum / a.buf.length);
    const muted = id === state.me ? !micLive() : !state.presence.get(id)?.media?.mic;
    if (rms > 0.035 && !muted) a.last = now;
    const speaking = now - a.last < 350;
    if (speaking !== state.speaking.has(id)) {
      speaking ? state.speaking.add(id) : state.speaking.delete(id);
      changed = true;
    }
  }
  if (changed) emit('speaking');
}, 100);

// ------------------------------------------------------------------ Palco (grade de vídeos)
const tiles = new Map(); // chave -> elemento
let stage, gridEl, focusEl, stripEl, stripBar;

// Destaque (como no Discord): uma transmissão/câmera grande e as demais numa faixa embaixo
let focusKey = null;       // tile em destaque
let userChoseFocus = false; // a pessoa escolheu/fechou o destaque manualmente
const seenScreens = new Set();
let stripHidden = localStorage.getItem('to.stripHidden') === '1';

export function initStage(el) {
  stage = el;
  stage.innerHTML = '';
  focusEl = document.createElement('div'); focusEl.className = 'stage-focus';
  stripBar = document.createElement('button'); stripBar.className = 'strip-toggle'; stripBar.type = 'button';
  stripBar.onclick = () => { stripHidden = !stripHidden; localStorage.setItem('to.stripHidden', stripHidden ? '1' : '0'); renderStage(); };
  stripEl = document.createElement('div'); stripEl.className = 'stage-strip';
  gridEl = document.createElement('div'); gridEl.className = 'stage-grid';
  stage.append(focusEl, stripBar, stripEl, gridEl);
  new ResizeObserver(() => layoutGrid()).observe(stage);
  on('tiles', renderStage);
  on('presence', renderStage);
  on('speaking', () => {
    for (const [key, t] of tiles) t.classList.toggle('speaking', key.startsWith('cam:') && state.speaking.has(key.slice(4)));
  });
  document.addEventListener('fullscreenchange', renderStage);
}

export function setFocus(key) {
  focusKey = key;
  userChoseFocus = true;
  renderStage();
}

// Modo cinema: esconde as barras laterais e o cabeçalho, sem ir para tela cheia
export function toggleTheater(force) {
  const on_ = force ?? !document.body.classList.contains('theater');
  document.body.classList.toggle('theater', on_);
  renderStage();
}

function tileButton(label, title, onclick) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'tile-btn'; b.title = title; b.textContent = label;
  b.addEventListener('click', (e) => { e.stopPropagation(); onclick(); });
  return b;
}

function makeTile(key) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.key = key;
  el.innerHTML = '<video autoplay playsinline muted></video><div class="placeholder"><span></span></div><div class="tile-label"><span class="tile-icons"></span><span class="tile-name"></span></div><div class="tile-state"></div><div class="live-badge">AO VIVO</div><div class="tile-actions"></div>';
  const actions = el.querySelector('.tile-actions');
  actions.append(
    tileButton('⤢', 'Modo cinema (esconde as barras)', () => { if (focusKey !== key) setFocus(key); toggleTheater(); }),
    tileButton('⛶', 'Tela cheia', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else el.requestFullscreen?.().catch(() => {});
    }),
    tileButton('✕', 'Sair do destaque', () => { focusKey = null; userChoseFocus = true; toggleTheater(false); if (document.fullscreenElement) document.exitFullscreen(); renderStage(); }),
  );
  // Volume da transmissão ao passar o mouse (só em telas de outras pessoas)
  if (key.startsWith('screen:')) {
    const uid = key.slice(7);
    const vol = document.createElement('div');
    vol.className = 'tile-vol';
    vol.innerHTML = '<button type="button" class="tile-vol-btn" title="Silenciar transmissão"></button><input type="range" min="0" max="1" step="0.05" title="Volume da transmissão"><span class="tile-vol-pct"></span>';
    const [btn, range, pct] = vol.children;
    const paint = () => {
      const muted = isStreamMuted(uid), v = getStreamVolume(uid);
      btn.textContent = muted || v === 0 ? '🔇' : v < 0.5 ? '🔉' : '🔊';
      btn.title = muted ? 'Voltar o som da transmissão' : 'Silenciar transmissão';
      range.value = muted ? 0 : v;
      pct.textContent = muted ? 'mudo' : `${Math.round(v * 100)}%`;
    };
    range.addEventListener('input', () => { if (isStreamMuted(uid)) setStreamMuted(uid, false); setStreamVolume(uid, Number(range.value)); });
    btn.addEventListener('click', () => setStreamMuted(uid, !isStreamMuted(uid)));
    for (const ev of ['click', 'dblclick', 'pointerdown']) vol.addEventListener(ev, (e) => e.stopPropagation());
    on('stream-volume', (id) => { if (id === uid) paint(); });
    paint();
    el.append(vol);
  }
  // Clique no quadradinho: coloca em destaque
  el.addEventListener('click', () => { if (focusKey !== key) setFocus(key); });
  el.addEventListener('dblclick', () => { if (el.classList.contains('focused')) el.requestFullscreen?.().catch(() => {}); });
  tiles.set(key, el);
  return el;
}

// Grade que cabe inteira no espaço (sem rolar), mantendo 16:9 — como numa call do Discord
function layoutGrid() {
  if (!gridEl || gridEl.hidden) return;
  const n = gridEl.children.length;
  if (!n) return;
  const W = gridEl.clientWidth - 8, H = gridEl.clientHeight - 8, gap = 12;
  let best = { cols: 1, w: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.min((W - gap * (cols - 1)) / cols, ((H - gap * (rows - 1)) / rows) * (16 / 9));
    if (w > best.w) best = { cols, w };
  }
  const w = Math.max(160, Math.floor(best.w));
  gridEl.style.setProperty('--tile-w', `${w}px`);
}

function setTile(el, { stream, id, name, icons, isScreen, mirror, connecting }) {
  el.dataset.uid = id;
  const v = el.querySelector('video');
  if (v.srcObject !== (stream || null)) v.srcObject = stream || null;
  if (stream) v.play().catch(() => {});
  el.classList.toggle('novideo', !stream);
  el.classList.toggle('screen', !!isScreen);
  el.classList.toggle('remote-screen', !!isScreen && id !== state.me);
  el.classList.toggle('mirror', !!mirror);
  el.querySelector('.tile-name').textContent = name;
  el.querySelector('.tile-icons').textContent = icons || '';
  el.querySelector('.tile-state').textContent = connecting ? connectionHint(id) : '';
  const ph = el.querySelector('.placeholder span');
  const photo = photoOf(id);
  ph.style.background = photo ? `center / cover no-repeat url("${photo}")` : colorOf(id);
  ph.textContent = photo ? '' : initials(displayName(id));
  const deco = state.profiles.get(id)?.decoration;
  if (deco) ph.dataset.deco = deco; else delete ph.dataset.deco;
}

const sameTrack = (el, track) => el?.querySelector('video').srcObject?.getVideoTracks()[0] === track;

function renderStage() {
  if (!stage) return;
  const room = state.voiceRoom;
  const wanted = [];
  if (room) {
    const icon = (p, id) => `${p?.media?.mic ? '' : '🔇'}${p?.deaf ? '🎧' : ''}${localMuted.has(id) ? '🔕' : ''}`;
    for (const id of membersIn(room)) {
      const p = state.presence.get(id);
      if (id === state.me) {
        const camKey = `cam:${id}`;
        wanted.push([camKey, { id, name: `${displayName(id)} (você)`, icons: icon(p, id), mirror: true, stream: local.cam ? (sameTrack(tiles.get(camKey), local.cam) ? tiles.get(camKey).querySelector('video').srcObject : new MediaStream([local.cam])) : null }]);
        if (local.screen) {
          const k = `screen:${id}`;
          wanted.push([k, { id, name: 'Sua tela', isScreen: true, stream: sameTrack(tiles.get(k), local.screen) ? tiles.get(k).querySelector('video').srcObject : new MediaStream([local.screen]) }]);
        }
        continue;
      }
      const peer = peers.get(id);
      const connecting = !peer || peer.pc.connectionState !== 'connected';
      wanted.push([`cam:${id}`, { id, name: displayName(id), icons: icon(p, id), connecting, stream: p?.media?.cam && peer?.streams.cam ? peer.streams.cam : null }]);
      if (p?.media?.screen && peer?.streams.screen) wanted.push([`screen:${id}`, { id, name: `Tela de ${displayName(id)}`, isScreen: true, stream: peer.streams.screen }]);
    }
  }
  // telas compartilhadas primeiro
  wanted.sort((a, b) => (b[0].startsWith('screen:') ? 1 : 0) - (a[0].startsWith('screen:') ? 1 : 0));
  const keys = new Set(wanted.map(([k]) => k));
  for (const [k, el] of tiles) if (!keys.has(k)) { el.querySelector('video').srcObject = null; el.remove(); tiles.delete(k); }

  // Nova transmissão de outra pessoa → vai para o destaque (se ninguém escolheu outra coisa)
  for (const [k] of wanted) {
    if (!k.startsWith('screen:') || seenScreens.has(k)) continue;
    seenScreens.add(k);
    if (!k.endsWith(`:${state.me}`) && (!userChoseFocus || !focusKey)) { focusKey = k; userChoseFocus = false; }
  }
  for (const k of [...seenScreens]) if (!keys.has(k)) seenScreens.delete(k);
  if (focusKey && !keys.has(focusKey)) {
    // o destaque sumiu: passa para outra transmissão, se houver
    focusKey = wanted.find(([k]) => k.startsWith('screen:') && !k.endsWith(`:${state.me}`))?.[0] || null;
    userChoseFocus = false;
  }
  if (!focusKey && document.body.classList.contains('theater')) document.body.classList.remove('theater');

  const focusMode = !!focusKey;
  stage.classList.toggle('focus-mode', focusMode);
  stage.classList.toggle('strip-hidden', focusMode && stripHidden);
  focusEl.hidden = !focusMode;
  stripBar.hidden = !focusMode || wanted.length < 2;
  stripEl.hidden = !focusMode || stripHidden || wanted.length < 2;
  gridEl.hidden = focusMode;
  stripBar.textContent = stripHidden ? `⌃ Mostrar participantes (${wanted.length - 1})` : '⌄ Ocultar participantes';

  for (const [k, opts] of wanted) {
    const el = tiles.get(k) || makeTile(k);
    setTile(el, opts);
    el.classList.toggle('focused', k === focusKey);
    const parent = !focusMode ? gridEl : k === focusKey ? focusEl : stripEl;
    // só move o elemento se mudou de lugar/ordem (evita o vídeo piscar)
    if (el.parentElement !== parent) parent.appendChild(el);
  }
  // mantém a ordem dentro de cada área
  for (const parent of [gridEl, stripEl]) {
    const order = wanted.map(([k]) => tiles.get(k)).filter((el) => el.parentElement === parent);
    order.forEach((el, i) => { if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] || null); });
  }
  const theater = document.body.classList.contains('theater');
  const fs = !!document.fullscreenElement;
  for (const [k, el] of tiles) {
    const [cinema, full, close] = el.querySelectorAll('.tile-btn');
    cinema.textContent = theater && k === focusKey ? '⤡' : '⤢';
    cinema.title = theater && k === focusKey ? 'Sair do modo cinema' : 'Modo cinema (esconde as barras)';
    full.title = fs ? 'Sair da tela cheia' : 'Tela cheia';
    close.hidden = k !== focusKey;
  }
  layoutGrid();
}
