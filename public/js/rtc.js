// Áudio/vídeo/tela via WebRTC em malha (P2P) entre quem está na mesma sala de voz.
// Cada conexão tem 3 transceivers fixos (áudio, câmera, tela): ligar/desligar usa
// replaceTrack, sem renegociação. A oferta/resposta vai completa (ICE não-incremental)
// para gastar poucas mensagens de sinalização.
import { state, emit, on, displayName, colorOf, initials, membersIn } from './state.js';
import { sendTo, setMeta } from './net.js';

const SLOTS = ['audio', 'cam', 'screen'];
const KINDS = ['audio', 'video', 'video'];

export const local = {
  mic: null,
  cam: null,
  screen: null,
  micOn: localStorage.getItem('to.micOn') !== '0',
  micDeviceId: localStorage.getItem('to.mic') || undefined,
  camDeviceId: localStorage.getItem('to.cam') || undefined,
};

let iceServers = [];
const peers = new Map(); // id -> peer
const userVolume = new Map(); // id -> 0..1 (ajuste local)
let audioCtx = null;

export function setIceServers(s) { iceServers = s; }
const localTrack = (slot) => (slot === 0 ? local.mic : slot === 1 ? local.cam : local.screen);
const micLive = () => !!(local.mic && local.micOn && !state.modMuted && !state.deafened);

// ------------------------------------------------------------------ Mídia local
export async function startMic() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: local.micDeviceId ? { exact: local.micDeviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
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

export async function startCam() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: local.camDeviceId ? { exact: local.camDeviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } },
    });
    local.cam?.stop();
    local.cam = s.getVideoTracks()[0];
    replaceAll(1, local.cam);
    return true;
  } catch (e) {
    console.warn('Câmera indisponível', e);
    local.cam = null;
    return false;
  }
}

export function stopCam() {
  local.cam?.stop();
  local.cam = null;
  replaceAll(1, null);
}

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

function applyDeaf() { for (const p of peers.values()) p.audioEl.muted = state.deafened; }

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

export async function toggleScreen() {
  if (local.screen) { stopScreen(); return false; }
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
    local.screen = s.getVideoTracks()[0];
    local.screen.contentHint = 'detail';
    local.screen.onended = stopScreen;
    replaceAll(2, local.screen);
    publishMedia();
    return true;
  } catch { return false; }
}

function stopScreen() {
  local.screen?.stop();
  local.screen = null;
  replaceAll(2, null);
  publishMedia();
}

export function stopAllMedia() {
  local.mic?.stop(); local.mic = null;
  local.cam?.stop(); local.cam = null;
  local.screen?.stop(); local.screen = null;
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

export function setUserVolume(id, v) {
  userVolume.set(id, v);
  const p = peers.get(id);
  if (p) p.audioEl.volume = v;
}
export const getUserVolume = (id) => userVolume.get(id) ?? 1;

function replaceAll(slot, track) {
  for (const peer of peers.values()) peer.pc.getTransceivers()[slot]?.sender.replaceTrack(track).catch(() => {});
}

// ------------------------------------------------------------------ Conexões
function createPeer(id, initiator) {
  const pc = new RTCPeerConnection({ iceServers });
  const audioEl = new Audio();
  audioEl.autoplay = true;
  audioEl.muted = state.deafened;
  audioEl.volume = getUserVolume(id);
  const peer = { id, pc, initiator, streams: {}, audioEl, createdAt: Date.now(), staleSince: null };
  peers.set(id, peer);

  pc.ontrack = (e) => {
    const key = SLOTS[pc.getTransceivers().indexOf(e.transceiver)];
    if (!key) return;
    peer.streams[key] = new MediaStream([e.track]);
    if (key === 'audio') {
      audioEl.srcObject = peer.streams.audio;
      audioEl.play().catch(() => {});
      watchSpeaking(id, peer.streams.audio);
    }
    emit('tiles');
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') closePeer(id, true);
    emit('tiles');
  };
  return peer;
}

// Espera o ICE terminar de coletar candidatos (ou 2,5 s) para mandar tudo numa mensagem só.
function iceGathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); clearTimeout(timer); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const timer = setTimeout(done, 2500);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

async function connect(id) {
  const peer = createPeer(id, true);
  const { pc } = peer;
  for (let i = 0; i < 3; i++) {
    const t = pc.addTransceiver(KINDS[i], { direction: 'sendrecv' });
    const track = localTrack(i);
    if (track) await t.sender.replaceTrack(track);
  }
  await pc.setLocalDescription(await pc.createOffer());
  await iceGathered(pc);
  if (peers.get(id) !== peer) return;
  sendTo(id, 'signal', { room: state.voiceRoom, data: { type: 'offer', sdp: pc.localDescription.toJSON() } });
}

export function closePeer(id, notify) {
  const peer = peers.get(id);
  if (!peer) return;
  peers.delete(id);
  try { peer.pc.close(); } catch {}
  peer.audioEl.srcObject = null;
  stopWatching(id);
  if (notify) sendTo(id, 'signal', { data: { type: 'bye' } });
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
      await pc.setRemoteDescription(data.sdp);
      const ts = pc.getTransceivers();
      for (let i = 0; i < ts.length && i < 3; i++) {
        ts[i].direction = 'sendrecv';
        const track = localTrack(i);
        if (track) await ts[i].sender.replaceTrack(track);
      }
      await pc.setLocalDescription(await pc.createAnswer());
      await iceGathered(pc);
      if (peers.get(from) !== peer) return;
      sendTo(from, 'signal', { data: { type: 'answer', sdp: pc.localDescription.toJSON() } });
    } else if (data.type === 'answer') {
      const peer = peers.get(from);
      if (peer && peer.pc.signalingState === 'have-local-offer') await peer.pc.setRemoteDescription(data.sdp);
    } else if (data.type === 'bye') {
      closePeer(from, false);
    }
  } catch (e) {
    console.warn('Erro de sinalização', e);
  }
});

// Chamado periodicamente: conecta com quem está na minha sala de voz. Só o lado com id
// menor inicia/encerra (evita ofertas cruzadas); o outro lado apenas responde.
export function updatePeers() {
  const room = state.voiceRoom;
  const wanted = new Set(room ? membersIn(room).filter((id) => id !== state.me) : []);
  for (const id of wanted) {
    const peer = peers.get(id);
    if (!peer && state.me < id) connect(id).catch((e) => console.warn(e));
    // conexão iniciada mas que nunca conectou: tenta de novo
    if (peer?.initiator && peer.pc.connectionState !== 'connected' && Date.now() - peer.createdAt > 15000) closePeer(id, false);
  }
  for (const [id, peer] of peers) {
    if (wanted.has(id)) { peer.staleSince = null; continue; }
    // dá uma folga para a presença atualizar antes de derrubar
    peer.staleSince ??= Date.now();
    if (Date.now() - peer.staleSince > 3000) closePeer(id, true);
  }
}

export function closeAll() { for (const id of [...peers.keys()]) closePeer(id, true); }
export const peerState = (id) => peers.get(id)?.pc.connectionState || null;

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
let stage, onSpotlight;

export function initStage(el, spotlightFn) {
  stage = el;
  onSpotlight = spotlightFn;
  on('tiles', renderStage);
  on('presence', renderStage);
  on('speaking', () => {
    for (const [key, t] of tiles) t.classList.toggle('speaking', key.startsWith('cam:') && state.speaking.has(key.slice(4)));
  });
}

function makeTile(key) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.innerHTML = '<video autoplay playsinline muted></video><div class="placeholder"><span></span></div><div class="tile-label"><span class="tile-icons"></span><span class="tile-name"></span></div><div class="tile-state"></div>';
  el.addEventListener('click', () => {
    const v = el.querySelector('video');
    if (v.srcObject && !el.classList.contains('novideo')) onSpotlight?.(v.srcObject, el.querySelector('.tile-name').textContent);
  });
  tiles.set(key, el);
  return el;
}

function setTile(el, { stream, id, name, icons, isScreen, mirror, connecting }) {
  const v = el.querySelector('video');
  if (v.srcObject !== (stream || null)) v.srcObject = stream || null;
  if (stream) v.play().catch(() => {});
  el.classList.toggle('novideo', !stream);
  el.classList.toggle('screen', !!isScreen);
  el.classList.toggle('mirror', !!mirror);
  el.querySelector('.tile-name').textContent = name;
  el.querySelector('.tile-icons').textContent = icons || '';
  el.querySelector('.tile-state').textContent = connecting ? 'Conectando…' : '';
  const ph = el.querySelector('.placeholder span');
  ph.style.background = colorOf(id);
  ph.textContent = initials(displayName(id));
}

const sameTrack = (el, track) => el?.querySelector('video').srcObject?.getVideoTracks()[0] === track;

function renderStage() {
  if (!stage) return;
  const room = state.voiceRoom;
  const wanted = [];
  if (room) {
    const icon = (p) => `${p?.media?.mic ? '' : '🔇'}${p?.deaf ? '🎧' : ''}`;
    for (const id of membersIn(room)) {
      const p = state.presence.get(id);
      if (id === state.me) {
        const camKey = `cam:${id}`;
        wanted.push([camKey, { id, name: `${displayName(id)} (você)`, icons: icon(p), mirror: true, stream: local.cam ? (sameTrack(tiles.get(camKey), local.cam) ? tiles.get(camKey).querySelector('video').srcObject : new MediaStream([local.cam])) : null }]);
        if (local.screen) {
          const k = `screen:${id}`;
          wanted.push([k, { id, name: 'Sua tela', isScreen: true, stream: sameTrack(tiles.get(k), local.screen) ? tiles.get(k).querySelector('video').srcObject : new MediaStream([local.screen]) }]);
        }
        continue;
      }
      const peer = peers.get(id);
      const connecting = !peer || peer.pc.connectionState !== 'connected';
      wanted.push([`cam:${id}`, { id, name: displayName(id), icons: icon(p), connecting, stream: p?.media?.cam && peer?.streams.cam ? peer.streams.cam : null }]);
      if (p?.media?.screen && peer?.streams.screen) wanted.push([`screen:${id}`, { id, name: `Tela de ${displayName(id)}`, isScreen: true, stream: peer.streams.screen }]);
    }
  }
  // telas compartilhadas primeiro
  wanted.sort((a, b) => (b[0].startsWith('screen:') ? 1 : 0) - (a[0].startsWith('screen:') ? 1 : 0));
  const keys = new Set(wanted.map(([k]) => k));
  for (const [k, el] of tiles) if (!keys.has(k)) { el.querySelector('video').srcObject = null; el.remove(); tiles.delete(k); }
  for (const [k, opts] of wanted) {
    const el = tiles.get(k) || makeTile(k);
    setTile(el, opts);
    stage.appendChild(el);
  }
  stage.dataset.count = String(Math.min(wanted.length, 9));
  stage.classList.toggle('has-screen', wanted.some(([k]) => k.startsWith('screen:')));
}
