// Entrega ao navegador a configuração pública (URL e chave anon do Supabase, servidores ICE).
// A chave "anon" é pública por design; a segurança fica nas regras (RLS) do banco.
export default function handler(req, res) {
  const env = process.env;
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (env.TURN_URL) iceServers.push({ urls: env.TURN_URL.split(','), username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    supabaseUrl: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '',
    supabaseAnonKey: env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
    allowedDomains: (env.ALLOWED_EMAIL_DOMAINS || 'turbopartners.com.br,turbopartners.com').split(',').map((d) => d.trim()).filter(Boolean),
    iceServers,
  });
}
