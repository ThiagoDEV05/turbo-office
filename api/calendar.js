// Lê a agenda (link iCal privado) da pessoa logada e devolve só os HORÁRIOS ocupados
// das próximas horas — nunca títulos ou detalhes das reuniões.
// O link fica na tabela calendar_links (RLS: só o dono lê); aqui ele é lido com o token da própria pessoa.
import ical from 'node-ical';

const ALLOWED = [
  /^https:\/\/calendar\.google\.com\/calendar\/ical\//,
  /^https:\/\/outlook\.(office365|live|office)\.com\/owa\/calendar\//,
  /^https:\/\/p\d+-caldav\.icloud\.com\//,
];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const env = process.env;
  const base = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth = req.headers.authorization || '';
  if (!base || !key) return res.status(500).json({ error: 'Supabase não configurado' });
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Faça login' });

  try {
    const r = await fetch(`${base}/rest/v1/calendar_links?select=ics_url`, { headers: { apikey: key, Authorization: auth } });
    if (!r.ok) return res.status(401).json({ error: 'Sessão inválida' });
    const rows = await r.json();
    if (!rows.length) return res.status(200).json({ connected: false, events: [] });

    const url = rows[0].ics_url.replace(/^webcal:\/\//i, 'https://');
    if (!ALLOWED.some((re) => re.test(url))) {
      return res.status(200).json({ connected: true, error: 'Link não reconhecido. Use o "Endereço secreto no formato iCal" do Google Agenda (ou o link ICS do Outlook/iCloud).', events: [] });
    }
    const resp = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(9000) });
    if (!resp.ok) return res.status(200).json({ connected: true, error: `A agenda respondeu ${resp.status}. Confira se o link está certo (e se o admin do Google Workspace permite o endereço secreto).`, events: [] });
    const text = await resp.text();
    if (!text.includes('BEGIN:VCALENDAR')) return res.status(200).json({ connected: true, error: 'O link não devolveu uma agenda iCal.', events: [] });

    const events = busyIntervals(ical.sync.parseICS(text), Date.now());
    return res.status(200).json({ connected: true, events });
  } catch (e) {
    return res.status(200).json({ connected: true, error: `Não foi possível ler a agenda (${e.name === 'TimeoutError' ? 'demorou demais' : e.message}).`, events: [] });
  }
}

// A recorrência é calculada no fuso do servidor. Em UTC (como na Vercel) as datas já saem certas,
// inclusive com horário de verão. Em outro fuso, corrige pela diferença da primeira ocorrência.
function occurrenceFixer(ev) {
  const first = ev.rrule.after(new Date(+ev.start - 2 * 86400e3), true);
  const shift = first ? +ev.start - +first : 0;
  return shift && Math.abs(shift) <= 14 * 3600e3 ? (d) => new Date(+d + shift) : (d) => d;
}

// Intervalos ocupados entre 12h atrás e 36h à frente (inclui reuniões recorrentes)
export function busyIntervals(data, now) {
  const from = now - 12 * 3600e3;
  const to = now + 36 * 3600e3;
  const out = [];
  const add = (start, end) => {
    const s = +start, e = +end;
    if (Number.isFinite(s) && Number.isFinite(e) && e > s && e > from && s < to) out.push([s, e]);
  };
  for (const ev of Object.values(data)) {
    if (!ev || ev.type !== 'VEVENT') continue;
    if (ev.datetype === 'date') continue;                 // dia inteiro não bloqueia
    if (ev.transparency === 'TRANSPARENT') continue;      // marcado como "disponível"
    if (ev.status === 'CANCELLED') continue;
    const dur = ev.end ? +ev.end - +ev.start : 30 * 60e3;
    if (ev.rrule) {
      const excluded = new Set(Object.values(ev.exdate || {}).map((d) => +d));
      const overridden = new Set(Object.values(ev.recurrences || {}).map((r) => +(r.recurrenceid || 0)));
      const fix = occurrenceFixer(ev);
      for (const raw of ev.rrule.between(new Date(from - dur - 14 * 3600e3), new Date(to + 14 * 3600e3), true)) {
        const d = fix(raw);
        if (excluded.has(+d) || overridden.has(+d)) continue;
        add(d, +d + dur);
      }
      for (const r of Object.values(ev.recurrences || {})) {
        if (r.status === 'CANCELLED' || r.transparency === 'TRANSPARENT') continue;
        add(r.start, r.end || +r.start + dur);
      }
    } else {
      add(ev.start, ev.end || +ev.start + dur);
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  // junta reuniões encostadas/sobrepostas
  const merged = [];
  for (const [s, e] of out) {
    const last = merged.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged.slice(0, 60).map(([s, e]) => ({ start: new Date(s).toISOString(), end: new Date(e).toISOString() }));
}
