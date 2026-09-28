// Entrega ao navegador a configuração pública (URL e chave anon do Supabase, STUN).
// A chave "anon" é pública por design; a segurança fica nas regras (RLS) do banco.
// As credenciais do servidor TURN ficam em /api/ice, só para quem está logado.
export default function handler(req, res) {
  const env = process.env;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    supabaseUrl: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '',
    supabaseAnonKey: env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
    serverName: env.SERVER_NAME || 'Performance Turbo',
    allowedDomains: (env.ALLOWED_EMAIL_DOMAINS || 'turbopartners.com.br,turbopartners.com').split(',').map((d) => d.trim()).filter(Boolean),
    iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }],
  });
}
