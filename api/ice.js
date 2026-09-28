// Servidores ICE com TURN (retransmissão de áudio/vídeo quando a rede bloqueia a conexão direta).
// Só entrega as credenciais do TURN para quem está logado (token do Supabase válido).
//   TURN_URL        ex.: turn:relay1.expressturn.com:3478,turn:relay1.expressturn.com:443?transport=tcp
//   TURN_USERNAME / TURN_CREDENTIAL
// (Opcional) Cloudflare: CF_TURN_KEY_ID + CF_TURN_API_TOKEN
const STUN = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] };

let cfCache = { at: 0, servers: null };
async function cloudflareTurn(env) {
  if (!env.CF_TURN_KEY_ID || !env.CF_TURN_API_TOKEN) return [];
  if (cfCache.servers && Date.now() - cfCache.at < 6 * 3600e3) return cfCache.servers;
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.CF_TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return cfCache.servers || [];
    const data = await r.json();
    const list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
    const servers = list.map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) })).filter((s) => s.urls.length);
    cfCache = { at: Date.now(), servers };
    return servers;
  } catch {
    return cfCache.servers || [];
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const env = process.env;
  const base = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ') || !base || !key) return res.status(200).json({ iceServers: [STUN], turn: false });

  // Confere o login da pessoa no Supabase
  try {
    const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: auth }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) return res.status(200).json({ iceServers: [STUN], turn: false });
  } catch {
    return res.status(200).json({ iceServers: [STUN], turn: false });
  }

  const iceServers = [STUN];
  const cf = await cloudflareTurn(env);
  if (cf.length) iceServers.push(...cf);
  if (env.TURN_URL && env.TURN_USERNAME && env.TURN_CREDENTIAL) {
    iceServers.push({ urls: env.TURN_URL.split(',').map((u) => u.trim()).filter(Boolean), username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
  }
  res.status(200).json({ iceServers, turn: iceServers.length > 1 });
}
