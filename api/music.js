// Resolve o que foi pedido no m!play em músicas do YouTube (tocadas pelo player oficial do YouTube).
//   GET /api/music?q=<link ou nome>   (Authorization: Bearer <token do Supabase>)
// Links de vídeo do YouTube funcionam sem configuração (oEmbed). Busca por nome, playlists e
// Spotify usam a YouTube Data API (variável YOUTUBE_API_KEY, grátis no Google Cloud).

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const KEY = () => process.env.YOUTUBE_API_KEY || '';

function parseYouTube(q) {
  let u;
  try { u = new URL(q); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1, 12);
  else if (/(^|\.)youtube\.com$/.test(host) || host === 'music.youtube.com') {
    id = u.searchParams.get('v') || (/^\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/.exec(u.pathname)?.[2] ?? null);
  } else return null;
  const list = u.searchParams.get('list');
  return { id: id && YT_ID.test(id) ? id : null, list: list && /^[A-Za-z0-9_-]{10,64}$/.test(list) ? list : null };
}

const isoToSeconds = (iso) => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
};

async function getJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Título/autor/capa de vídeos (com a chave: também a duração; sem a chave: oEmbed)
async function describe(ids) {
  if (!ids.length) return [];
  if (KEY()) {
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const d = await getJSON(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${ids.slice(i, i + 50).join(',')}&key=${KEY()}`);
      for (const v of d.items || []) {
        if (v.status?.embeddable === false) continue; // não pode tocar fora do YouTube
        out.push({ videoId: v.id, title: v.snippet.title, author: v.snippet.channelTitle, thumb: v.snippet.thumbnails?.medium?.url || '', duration: isoToSeconds(v.contentDetails?.duration) });
      }
    }
    return ids.map((id) => out.find((t) => t.videoId === id)).filter(Boolean);
  }
  const d = await getJSON(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ids[0]}`)}`);
  return [{ videoId: ids[0], title: d.title, author: d.author_name, thumb: `https://i.ytimg.com/vi/${ids[0]}/mqdefault.jpg`, duration: 0 }];
}

async function search(text) {
  const d = await getJSON(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=1&q=${encodeURIComponent(text)}&key=${KEY()}`);
  const id = d.items?.[0]?.id?.videoId;
  return id ? describe([id]) : [];
}

async function playlist(listId) {
  const ids = [];
  let page = '';
  for (let i = 0; i < 4 && ids.length < 200; i++) {
    const d = await getJSON(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${listId}&key=${KEY()}${page ? `&pageToken=${page}` : ''}`);
    for (const it of d.items || []) if (YT_ID.test(it.contentDetails?.videoId || '')) ids.push(it.contentDetails.videoId);
    if (!d.nextPageToken) break;
    page = d.nextPageToken;
  }
  return describe(ids);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const env = process.env;
  const base = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Faça login' });
  try {
    const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: anon, Authorization: auth }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) return res.status(401).json({ error: 'Sessão inválida' });
  } catch { return res.status(401).json({ error: 'Sessão inválida' }); }

  const q = String(new URL(req.url, 'http://x').searchParams.get('q') || '').trim().slice(0, 300);
  if (!q) return res.status(200).json({ error: 'Diga o que tocar: m!play <link ou nome da música>' });
  const needKey = 'A busca por nome, playlists e Spotify precisam da chave da API do YouTube (YOUTUBE_API_KEY). Por enquanto, use um link do YouTube.';

  try {
    const yt = parseYouTube(q);
    if (yt) {
      if (yt.list && KEY() && (!yt.id || /[?&]list=/.test(q))) {
        const tracks = await playlist(yt.list);
        if (tracks.length) return res.status(200).json({ kind: 'playlist', tracks });
      }
      if (yt.id) return res.status(200).json({ kind: 'video', tracks: await describe([yt.id]) });
      return res.status(200).json({ error: yt.list ? needKey : 'Não reconheci esse link do YouTube.' });
    }
    if (/^https?:\/\/open\.spotify\.com\/(intl-[a-z]+\/)?track\//i.test(q)) {
      if (!KEY()) return res.status(200).json({ error: needKey });
      const o = await getJSON(`https://open.spotify.com/oembed?url=${encodeURIComponent(q)}`);
      const tracks = await search(o.title);
      return res.status(200).json(tracks.length ? { kind: 'spotify', tracks } : { error: `Não achei "${o.title}" no YouTube.` });
    }
    if (/^https?:\/\//i.test(q)) return res.status(200).json({ error: 'Link não suportado. Use YouTube, YouTube Music ou música do Spotify — ou escreva o nome da música.' });
    if (!KEY()) return res.status(200).json({ error: needKey });
    const tracks = await search(q);
    return res.status(200).json(tracks.length ? { kind: 'search', tracks } : { error: `Não achei nada para "${q}".` });
  } catch (e) {
    return res.status(200).json({ error: `Não consegui buscar a música (${e.message}).` });
  }
}
