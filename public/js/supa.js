// Cliente Supabase compartilhado (carregado do CDN, sem build).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';

let configPromise = null;
let client = null;

export function getConfig() {
  configPromise ??= fetch('/api/config').then((r) => {
    if (!r.ok) throw new Error('Falha ao carregar /api/config');
    return r.json();
  });
  return configPromise;
}

export async function getSupabase() {
  if (client) return client;
  const cfg = await getConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    throw new Error('Supabase não configurado: defina SUPABASE_URL e SUPABASE_ANON_KEY nas variáveis de ambiente.');
  }
  client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}
