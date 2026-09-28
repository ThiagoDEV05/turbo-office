// Entrega ao navegador a configuração pública (URL e chave anon do Supabase, servidores ICE).
// A chave "anon" é pública por design; a segurança fica nas regras (RLS) do banco.

// Servidor TURN: retransmite áudio/vídeo quando a rede bloqueia a conexão direta (CGNAT, Wi-Fi
// corporativo). Opção 1: Cloudflare (CF_TURN_KEY_ID + CF_TURN_API_TOKEN) — gera credenciais
// temporárias. Opção 2: qualquer TURN fixo (TURN_URL, TURN_USERNAME, TURN_CREDENTIAL).
let cfCache = { at: 0, servers: null };
async function cloudflareTurn(env) {
  if (!env.CF_TURN_KEY_ID || !env.CF_TURN_API_TOKEN) return null;
  if (cfCache.servers && Date.now() - cfCache.at < 6 * 3600e3) return cfCache.servers;
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.CF_TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return cfCache.servers;
    const data = await r.json();
    const list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
    // Remove a porta 53 (bloqueada em alguns navegadores/redes)
    const servers = list.map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) })).filter((s) => s.urls.length);
    cfCache = { at: Date.now(), servers };
    return servers;
  } catch {
    return cfCache.servers;
  }
}

export default async function handler(req, res) {
  const env = process.env;
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  const cf = await cloudflareTurn(env);
  if (cf?.length) iceServers.push(...cf);
  if (env.TURN_URL) iceServers.push({ urls: env.TURN_URL.split(','), username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    supabaseUrl: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '',
    supabaseAnonKey: env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
    serverName: env.SERVER_NAME || 'Performance Turbo',
    allowedDomains: (env.ALLOWED_EMAIL_DOMAINS || 'turbopartners.com.br,turbopartners.com').split(',').map((d) => d.trim()).filter(Boolean),
    iceServers,
    turn: iceServers.some((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u))),
  });
}
