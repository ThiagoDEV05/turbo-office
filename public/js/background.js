// Fundo virtual da câmera (desfoque ou imagem), como no Discord/Meet.
// Recorta a pessoa com o MediaPipe (modelo "selfie segmenter", roda no navegador, nada sai do
// computador) e monta: fundo + pessoa. Os outros recebem o vídeo já processado.
const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

// ------------------------------------------------------------------ Fundos prontos
const LOGO = 'M0 346 L346 0 L592 0 L930 336 L805 460 L469 124 L124 469 Z M193 540 L356 376 L573 376 L735 540 L627 648 L464 485 L301 648 Z';
const W = 1280, H = 720;
function gradient(ctx, stops, angle = 135) {
  const a = (angle * Math.PI) / 180;
  const g = ctx.createLinearGradient(W / 2 - Math.cos(a) * W, H / 2 - Math.sin(a) * H, W / 2 + Math.cos(a) * W, H / 2 + Math.sin(a) * H);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function seeded(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
function bokeh(ctx, colors, n, seed) {
  const rnd = seeded(seed);
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = rnd() * H, r = 20 + rnd() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = colors[Math.floor(rnd() * colors.length)];
    g.addColorStop(0, `${c}aa`); g.addColorStop(0.6, `${c}33`); g.addColorStop(1, `${c}00`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
}
function vignette(ctx, strength = 0.55) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

export const PRESETS = {
  turbo: { name: 'Turbo', draw(ctx) {
    gradient(ctx, ['#041026', '#0b1f45', '#0e3a5c']);
    bokeh(ctx, ['#22d3ee', '#3b82f6'], 18, 7);
    ctx.save(); ctx.globalAlpha = 0.16; ctx.translate(W * 0.62, H * 0.18); ctx.scale(0.55, 0.55); ctx.fillStyle = '#ffffff'; ctx.fill(new Path2D(LOGO)); ctx.restore();
    vignette(ctx, 0.5);
  } },
  studio: { name: 'Estúdio', draw(ctx) {
    const g = ctx.createRadialGradient(W / 2, H * 0.45, 40, W / 2, H * 0.5, W * 0.7);
    g.addColorStop(0, '#4b5563'); g.addColorStop(0.55, '#1f2937'); g.addColorStop(1, '#030712');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } },
  bokeh: { name: 'Luzes', draw(ctx) { gradient(ctx, ['#0f0c29', '#1f1b4d', '#24243e']); bokeh(ctx, ['#fbbf24', '#f472b6', '#60a5fa', '#fde68a'], 45, 21); vignette(ctx, 0.45); } },
  aurora: { name: 'Aurora', draw(ctx) { gradient(ctx, ['#0f2027', '#203a43', '#2c5364']); bokeh(ctx, ['#34d399', '#22d3ee'], 10, 3); } },
  sunset: { name: 'Pôr do sol', draw(ctx) { gradient(ctx, ['#6a0572', '#ab2346', '#f7971e'], 100); } },
  ocean: { name: 'Oceano', draw(ctx) { gradient(ctx, ['#0f2b46', '#16697a', '#1b998b'], 110); bokeh(ctx, ['#a5f3fc'], 12, 11); } },
  forest: { name: 'Floresta', draw(ctx) { gradient(ctx, ['#0b2e1f', '#1e5631', '#2d6a4f']); bokeh(ctx, ['#bbf7d0', '#fef08a'], 16, 5); vignette(ctx, 0.4); } },
  lavender: { name: 'Lavanda', draw(ctx) { gradient(ctx, ['#c3cfe2', '#a1c4fd', '#c2e9fb']); } },
};

const presetCache = new Map();
export function presetCanvas(key) {
  if (presetCache.has(key)) return presetCache.get(key);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  PRESETS[key].draw(c.getContext('2d'));
  presetCache.set(key, c);
  return c;
}

// Imagem enviada pela pessoa (guardada só no navegador dela)
export function customImageUrl() { try { return localStorage.getItem('to.camBgCustom') || ''; } catch { return ''; } }
export async function saveCustomImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / bmp.width, 720 / bmp.height) || 1;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.85);
  localStorage.setItem('to.camBgCustom', url);
  customImg = null;
  return url;
}
let customImg = null;
function customImage() {
  if (customImg) return customImg;
  const url = customImageUrl();
  if (!url) return null;
  customImg = new Image();
  customImg.src = url;
  return customImg;
}

// Preferência: 'none' | 'blur-light' | 'blur-strong' | 'preset:<nome>' | 'custom'
export const getBackground = () => { try { return localStorage.getItem('to.camBg') || 'none'; } catch { return 'none'; } };
export const setBackgroundPref = (bg) => { try { localStorage.setItem('to.camBg', bg); } catch {} };

// ------------------------------------------------------------------ Segmentação (MediaPipe)
let segmenterPromise = null;
function getSegmenter() {
  segmenterPromise ||= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import(`${VISION}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
    const make = (delegate) => ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true,
    });
    try { return await make('GPU'); } catch { return await make('CPU'); }
  })();
  segmenterPromise.catch(() => { segmenterPromise = null; });
  return segmenterPromise;
}

function drawCover(ctx, img, w, h) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) return false;
  const s = Math.max(w / iw, h / ih);
  const dw = iw * s, dh = ih * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return true;
}

// ------------------------------------------------------------------ Processador
// Recebe a trilha da câmera e devolve uma trilha nova com o fundo aplicado.
// Chrome/Edge: processa quadro a quadro (continua fluido mesmo com a aba em segundo plano).
// Outros navegadores: canvas + captureStream.
export class BackgroundProcessor {
  constructor() {
    this.bg = 'none';
    this.running = false;
    this.lastTs = 0;
  }

  setBackground(bg) { this.bg = bg; }

  async start(track, bg) {
    this.bg = bg;
    this.segmenter = await getSegmenter();
    this.running = true;
    const s = track.getSettings();
    this.w = s.width || 1280; this.h = s.height || 720;
    const mk = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
    this.out = mk(this.w, this.h); this.octx = this.out.getContext('2d');
    this.person = mk(this.w, this.h); this.pctx = this.person.getContext('2d');
    this.mask = null; this.mctx = null;

    if ('MediaStreamTrackProcessor' in window && 'MediaStreamTrackGenerator' in window) {
      const processor = new MediaStreamTrackProcessor({ track });
      const generator = new MediaStreamTrackGenerator({ kind: 'video' });
      const reader = processor.readable.getReader();
      const writer = generator.writable.getWriter();
      this.stopFn = () => { reader.cancel().catch(() => {}); writer.close().catch(() => {}); };
      (async () => {
        while (this.running) {
          const { value: frame, done } = await reader.read().catch(() => ({ done: true }));
          if (done) break;
          let out = null;
          try {
            this.render(frame, frame.displayWidth, frame.displayHeight, frame.timestamp);
            out = new VideoFrame(this.out, { timestamp: frame.timestamp });
          } catch (e) { console.warn('fundo', e); }
          frame.close();
          if (out) await writer.write(out).catch(() => {});
        }
      })();
      this.track = generator;
      return generator;
    }

    // Alternativa: <video> + canvas
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    await video.play();
    const canvas = document.createElement('canvas');
    canvas.width = this.w; canvas.height = this.h;
    const cctx = canvas.getContext('2d');
    const loop = () => {
      if (!this.running) return;
      try { this.render(video, video.videoWidth, video.videoHeight, performance.now() * 1000); cctx.drawImage(this.out, 0, 0); } catch {}
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(loop); else setTimeout(loop, 33);
    };
    loop();
    const outTrack = canvas.captureStream(30).getVideoTracks()[0];
    this.stopFn = () => { video.srcObject = null; outTrack.stop(); };
    this.track = outTrack;
    return outTrack;
  }

  render(src, w, h, tsMicros) {
    if (!w || !h) return;
    if (this.out.width !== w || this.out.height !== h) { this.out.width = this.person.width = w; this.out.height = this.person.height = h; }
    const ctx = this.octx, p = this.pctx;
    // 1) máscara da pessoa
    let ts = tsMicros / 1000;
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    this.segmenter.segmentForVideo(src, ts, (result) => {
      const m = result.confidenceMasks?.[0];
      if (!m) return;
      const mw = m.width, mh = m.height;
      if (!this.mask || this.mask.width !== mw || this.mask.height !== mh) {
        this.mask = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(mw, mh) : Object.assign(document.createElement('canvas'), { width: mw, height: mh });
        this.mctx = this.mask.getContext('2d');
        this.maskData = this.mctx.createImageData(mw, mh);
      }
      const conf = m.getAsFloat32Array();
      const d = this.maskData.data;
      for (let i = 0; i < conf.length; i++) {
        // bordas mais firmes: 0,25→0 e 0,65→1
        const a = Math.min(1, Math.max(0, (conf[i] - 0.25) / 0.4));
        d[i * 4 + 3] = a * 255;
      }
      this.mctx.putImageData(this.maskData, 0, 0);
      m.close?.();
    });
    // 2) fundo
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    const bg = this.bg;
    if (bg.startsWith('blur')) {
      ctx.filter = `blur(${bg === 'blur-strong' ? 22 : 10}px)`;
      ctx.drawImage(src, -30, -30, w + 60, h + 60);
      ctx.filter = 'none';
    } else if (bg.startsWith('preset:') && PRESETS[bg.slice(7)]) {
      drawCover(ctx, presetCanvas(bg.slice(7)), w, h);
    } else if (bg === 'custom' && customImage()?.complete) {
      if (!drawCover(ctx, customImage(), w, h)) ctx.drawImage(src, 0, 0, w, h);
    } else {
      ctx.drawImage(src, 0, 0, w, h);
      return; // sem efeito
    }
    // 3) pessoa recortada por cima
    if (!this.mask) { ctx.drawImage(src, 0, 0, w, h); return; }
    p.globalCompositeOperation = 'source-over';
    p.clearRect(0, 0, w, h);
    p.filter = 'blur(3px)';
    p.drawImage(this.mask, 0, 0, w, h);
    p.filter = 'none';
    p.globalCompositeOperation = 'source-in';
    p.drawImage(src, 0, 0, w, h);
    ctx.drawImage(this.person, 0, 0);
  }

  stop() {
    this.running = false;
    this.stopFn?.();
    this.track?.stop?.();
  }
}

// Pré-carrega o modelo (chamado quando a pessoa abre o menu de fundos)
export const preload = () => getSegmenter().catch(() => {});
