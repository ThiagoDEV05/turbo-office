// Áudio/vídeo/tela via WebRTC em malha (P2P), conectando só com quem está por perto
// ou na mesma sala privada. Cada conexão tem 3 transceivers fixos (áudio, câmera, tela):
// ligar/desligar mídia usa replaceTrack, sem renegociação.
import { state, emit, on, me, shouldTalk, volumeFor, displayName, initials } from './state.js';

const SLOTS = ['audio', 'cam', 'screen'];
const KINDS = ['audio', 'video', 'video'];

export const local = {
  mic: null,      // MediaStreamTrack
  cam: null,
  screen: null,
  micOn: true,
  camOn: true,
  micDeviceId: localStorage.getItem('to.mic') || undefined,
  camDeviceId: localStorage.getItem('to.cam') || undefined,
};

let iceServers = [];
const peers = new Map(); // id -> peer
let audioCtx = null;

export function setIceServers(s) { iceServers = s; }
const send = (to, data) => state.socket.emit('signal', { to, data });
const localTrack = (slot) => (slot === 0 ? local.mic : slot === 1 ? local.cam : local.screen);

// ------------------------------------------------------------------ Mídia local
export async function startMic() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: local.micDeviceId ? { exact: local.micDeviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    local.mic?.stop();
    local.mic = s.getAudioTracks()[0];
    local.mic.enabled = local.micOn;
    replaceAll(0, local.mic);
    watchLocal();
    return true;
  } catch (e) {
    console.warn('Microfone indisponível', e);
    local.mic = null; local.micOn = false;
    return false;
  }
}

export async function startCam() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: local.camDeviceId ? { exact: local.camDeviceId } : undefined, width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } },
    });
    local.cam?.stop();
    local.cam = s.getVideoTracks()[0];
    local.camOn = true;
    replaceAll(1, local.cam);
    return true;
  } catch (e) {
    console.warn('Câmera indisponível', e);
    local.cam = null; local.camOn = false;
    return false;
  }
}

export function stopCam() {
  local.cam?.stop();
  local.cam = null;
  local.camOn = false;
  replaceAll(1, null);
}

export async function toggleMic() {
  if (!local.mic) { local.micOn = true; if (!(await startMic())) return false; }
  else { local.micOn = !local.micOn; local.mic.enabled = local.micOn; }
  publishMedia();
  return local.micOn;
}

export async function toggleCam() {
  if (local.camOn) stopCam(); else await startCam();
  publishMedia();
  return local.camOn;
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

export async function switchDevice(kind, deviceId) {
  if (kind === 'mic') { local.micDeviceId = deviceId; localStorage.setItem('to.mic', deviceId); if (local.mic) await startMic(); }
  else { local.camDeviceId = deviceId; localStorage.setItem('to.cam', deviceId); if (local.camOn) await startCam(); }
  emit('tiles');
}

export function publishMedia() {
  const m = { mic: !!(local.mic && local.micOn), cam: !!local.cam, screen: !!local.screen };
  const p = me();
  if (p) p.media = m;
  state.socket?.emit('media', m);
  emit('media-local', m);
  emit('tiles');
}

function replaceAll(slot, track) {
  for (const peer of peers.values()) {
    const t = peer.pc.getTransceivers()[slot];
    t?.sender.replaceTrack(track).catch(() => {});
  }
}

// ------------------------------------------------------------------ Conexões
function createPeer(id, initiator) {
  const pc = new RTCPeerConnection({ iceServers });
  const audioEl = new Audio();
  audioEl.autoplay = true;
  const peer = { id, pc, initiator, pendingIce: [], streams: {}, audioEl, createdAt: Date.now() };
  peers.set(id, peer);

  pc.onicecandidate = (e) => { if (e.candidate) send(id, { type: 'ice', candidate: e.candidate }); };
  pc.ontrack = (e) => {
    const slot = pc.getTransceivers().indexOf(e.transceiver);
    const key = SLOTS[slot];
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

async function connect(id) {
  const peer = createPeer(id, true);
  const { pc } = peer;
  for (let i = 0; i < 3; i++) {
    const t = pc.addTransceiver(KINDS[i], { direction: 'sendrecv' });
    const track = localTrack(i);
    if (track) await t.sender.replaceTrack(track);
  }
  await pc.setLocalDescription(await pc.createOffer());
  send(id, { type: 'offer', sdp: pc.localDescription });
}

export function closePeer(id, notify) {
  const peer = peers.get(id);
  if (!peer) return;
  peers.delete(id);
  try { peer.pc.close(); } catch {}
  peer.audioEl.srcObject = null;
  stopWatching(id);
  if (notify) send(id, { type: 'bye' });
  emit('tiles');
}

export async function onSignal({ from, data }) {
  try {
    if (data.type === 'offer') {
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
      send(from, { type: 'answer', sdp: pc.localDescription });
      flushIce(peer);
    } else if (data.type === 'answer') {
      const peer = peers.get(from);
      if (!peer || peer.pc.signalingState !== 'have-local-offer') return;
      await peer.pc.setRemoteDescription(data.sdp);
      flushIce(peer);
    } else if (data.type === 'ice') {
      const peer = peers.get(from);
      if (!peer) return;
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
      else peer.pendingIce.push(data.candidate);
    } else if (data.type === 'bye') {
      closePeer(from, false);
    }
  } catch (e) {
    console.warn('Erro de sinalização', e);
  }
}

function flushIce(peer) {
  for (const c of peer.pendingIce) peer.pc.addIceCandidate(c).catch(() => {});
  peer.pendingIce = [];
}

// Chamado periodicamente: decide com quem conversar. Só o lado com id menor inicia/encerra,
// o que evita ofertas cruzadas; o outro lado apenas responde.
export function updatePeers() {
  const self = me();
  if (!self || !state.joined) return;
  const inRange = new Set();
  for (const p of state.players.values()) {
    if (p.id === state.me) continue;
    const connected = peers.has(p.id);
    if (shouldTalk(self, p, connected)) inRange.add(p.id);
    if (state.me < p.id) {
      if (shouldTalk(self, p, connected) && !connected) connect(p.id).catch((e) => console.warn(e));
      else if (!shouldTalk(self, p, connected) && connected) closePeer(p.id, true);
    }
  }
  for (const [id, peer] of peers) {
    if (!state.players.has(id)) closePeer(id, false);
    // lado passivo: se o outro sumiu do alcance há muito tempo e não encerrou, encerra
    else if (!peer.initiator && !inRange.has(id) && Date.now() - peer.createdAt > 8000 && !shouldTalk(self, state.players.get(id), true)) {
      peer.staleSince ??= Date.now();
      if (Date.now() - peer.staleSince > 5000) closePeer(id, true);
    } else peer.staleSince = null;
    const other = state.players.get(id);
    if (other) peer.audioEl.volume = volumeFor(self, other);
  }
  const changed = inRange.size !== state.inRange.size || [...inRange].some((id) => !state.inRange.has(id));
  state.inRange = inRange;
  if (changed) emit('range', inRange);
}

export function watchLocal() {
  if (local.mic && state.me != null) watchSpeaking(state.me, new MediaStream([local.mic]));
}

export function closeAll() { for (const id of [...peers.keys()]) closePeer(id, true); }

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
  state.speaking.delete(id);
}

setInterval(() => {
  let changed = false;
  const now = performance.now();
  for (const [id, a] of analysers) {
    const isLocal = id === state.me;
    const pid = id;
    a.an.getByteTimeDomainData(a.buf);
    let sum = 0;
    for (const v of a.buf) { const x = (v - 128) / 128; sum += x * x; }
    const rms = Math.sqrt(sum / a.buf.length);
    const muted = isLocal ? !local.micOn : !state.players.get(id)?.media?.mic;
    if (rms > 0.035 && !muted) a.last = now;
    const speaking = now - a.last < 350;
    if (speaking !== state.speaking.has(pid)) {
      speaking ? state.speaking.add(pid) : state.speaking.delete(pid);
      changed = true;
    }
  }
  if (changed) emit('speaking');
}, 100);

// ------------------------------------------------------------------ Tiles de vídeo
const tiles = new Map(); // chave -> elemento
let container, onSpotlight;

export function initTiles(el, spotlightFn) {
  container = el;
  onSpotlight = spotlightFn;
  on('tiles', renderTiles);
  on('speaking', () => {
    for (const [key, el] of tiles) el.classList.toggle('speaking', state.speaking.has(Number(key.split(':')[1])));
  });
  on('range', renderTiles);
}

function makeTile(key) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.innerHTML = `<video autoplay playsinline muted></video><div class="placeholder"><span></span></div><div class="tile-label"><span class="mic-off" hidden>🔇</span><span class="tile-name"></span></div>`;
  el.addEventListener('click', () => {
    const v = el.querySelector('video');
    if (v.srcObject && !el.classList.contains('novideo')) onSpotlight?.(v.srcObject, el.querySelector('.tile-name').textContent);
  });
  tiles.set(key, el);
  return el;
}

function setTile(el, { stream, name, avatarColor, micOff, isScreen, mirror }) {
  const v = el.querySelector('video');
  if (v.srcObject !== (stream || null)) v.srcObject = stream || null;
  if (stream) v.play().catch(() => {});
  el.classList.toggle('novideo', !stream);
  el.classList.toggle('screen', !!isScreen);
  el.classList.toggle('mirror', !!mirror);
  el.querySelector('.tile-name').textContent = name;
  el.querySelector('.mic-off').hidden = !micOff;
  const ph = el.querySelector('.placeholder');
  ph.style.background = avatarColor || '#1e293b';
  ph.querySelector('span').textContent = initials(name);
}

function renderTiles() {
  if (!container) return;
  const self = me();
  const wanted = [];
  const connectedPeers = [...peers.values()].filter((p) => state.players.has(p.id));
  const showSelf = connectedPeers.length > 0 || local.cam || local.screen;
  if (self && showSelf) {
    wanted.push([`cam:${state.me}`, { stream: local.cam ? new MediaStream([local.cam]) : null, name: 'Você', avatarColor: self.avatar?.shirt, micOff: !local.micOn || !local.mic, mirror: true }]);
    if (local.screen) wanted.push([`screen:${state.me}`, { stream: new MediaStream([local.screen]), name: 'Sua tela', isScreen: true }]);
  }
  for (const peer of connectedPeers) {
    const p = state.players.get(peer.id);
    wanted.push([`cam:${p.id}`, { stream: p.media?.cam ? peer.streams.cam : null, name: p.name, avatarColor: p.avatar?.shirt, micOff: !p.media?.mic }]);
    if (p.media?.screen && peer.streams.screen) wanted.push([`screen:${p.id}`, { stream: peer.streams.screen, name: `Tela de ${displayName(p.id)}`, isScreen: true }]);
  }
  const keys = new Set(wanted.map(([k]) => k));
  for (const [k, el] of tiles) if (!keys.has(k)) { el.querySelector('video').srcObject = null; el.remove(); tiles.delete(k); }
  for (const [k, opts] of wanted) {
    const el = tiles.get(k) || makeTile(k);
    // Evita recriar o MediaStream local a cada render (causaria piscar)
    if (k === `cam:${state.me}` && local.cam && el.querySelector('video').srcObject?.getVideoTracks()[0] === local.cam) opts.stream = el.querySelector('video').srcObject;
    if (k === `screen:${state.me}` && el.querySelector('video').srcObject?.getVideoTracks()[0] === local.screen) opts.stream = el.querySelector('video').srcObject;
    setTile(el, opts);
    container.appendChild(el); // mantém a ordem
  }
  container.classList.toggle('empty', wanted.length === 0);
  emit('tiles-rendered', { screenKeys: wanted.filter(([k]) => k.startsWith('screen:') && !k.endsWith(`:${state.me}`)).map(([k]) => k) });
}

export function connectedCount() { return peers.size; }
