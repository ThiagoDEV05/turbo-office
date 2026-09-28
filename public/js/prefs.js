// Aparência: temas, cor de destaque e tamanho do texto. Tudo liberado para todo mundo.
// Salvo no navegador (carrega na hora) e no perfil (sincroniza entre dispositivos).

const DARK_GLASS = {
  '--bg': 'rgba(0,0,0,.30)', '--bg-2': 'rgba(0,0,0,.36)', '--panel': 'rgba(0,0,0,.22)', '--panel-2': 'rgba(255,255,255,.09)',
  '--hover': 'rgba(255,255,255,.10)', '--line': 'rgba(255,255,255,.12)', '--text': '#ffffff', '--muted': 'rgba(255,255,255,.72)',
  '--deep': 'rgba(0,0,0,.42)', '--stage': 'rgba(0,0,0,.40)', '--solid': '#17171f', '--tile': 'rgba(0,0,0,.35)',
};
const LIGHT_GLASS = {
  '--bg': 'rgba(255,255,255,.40)', '--bg-2': 'rgba(255,255,255,.48)', '--panel': 'rgba(255,255,255,.58)', '--panel-2': 'rgba(255,255,255,.75)',
  '--hover': 'rgba(0,0,0,.06)', '--line': 'rgba(0,0,0,.10)', '--text': '#1f2937', '--muted': '#4b5563',
  '--deep': 'rgba(255,255,255,.62)', '--stage': 'rgba(255,255,255,.30)', '--solid': '#fbfbfd', '--tile': 'rgba(255,255,255,.55)',
};

export const THEMES = {
  turbo: { name: 'Turbo', swatch: '#0b1426', vars: {
    '--bg': '#0b1426', '--bg-2': '#0e182d', '--panel': '#111c33', '--panel-2': '#17243f', '--hover': '#1d2c4c', '--line': '#22304d',
    '--text': '#e6edf7', '--muted': '#8a9bb8', '--deep': '#0a1222', '--stage': '#070d1a', '--solid': '#111c33', '--tile': '#111a2e' } },
  escuro: { name: 'Escuro', swatch: '#313338', vars: {
    '--bg': '#1e1f22', '--bg-2': '#2b2d31', '--panel': '#313338', '--panel-2': '#383a40', '--hover': '#404249', '--line': '#3f4147',
    '--text': '#f2f3f5', '--muted': '#b5bac1', '--deep': '#232428', '--stage': '#111214', '--solid': '#313338', '--tile': '#232428' } },
  preto: { name: 'Preto', swatch: '#000000', vars: {
    '--bg': '#000000', '--bg-2': '#070707', '--panel': '#0c0c0d', '--panel-2': '#18181b', '--hover': '#1f1f23', '--line': '#232327',
    '--text': '#f5f5f5', '--muted': '#a1a1aa', '--deep': '#000000', '--stage': '#000000', '--solid': '#111113', '--tile': '#101012' } },
  claro: { name: 'Claro', swatch: '#ffffff', light: true, vars: {
    '--bg': '#e3e5e8', '--bg-2': '#f2f3f5', '--panel': '#ffffff', '--panel-2': '#ebedef', '--hover': '#e3e5e8', '--line': '#d7d9dd',
    '--text': '#111827', '--muted': '#5c6370', '--deep': '#ebedef', '--stage': '#dfe3e8', '--solid': '#ffffff', '--tile': '#cfd5dd' } },
};

// Temas coloridos em gradiente (como os do Nitro)
export const GRADIENTS = {
  menta: { name: 'Menta', light: true, bg: 'linear-gradient(135deg,#a8e6cf,#dcedc1)' },
  pessego: { name: 'Pêssego', light: true, bg: 'linear-gradient(135deg,#ffe0b2,#ffab91)' },
  lavanda: { name: 'Lavanda', light: true, bg: 'linear-gradient(135deg,#c3cfe2,#a1c4fd)' },
  algodao: { name: 'Algodão-doce', light: true, bg: 'linear-gradient(135deg,#fbc2eb,#a6c1ee)' },
  areia: { name: 'Areia', light: true, bg: 'linear-gradient(135deg,#f5efe0,#e2d4b7)' },
  ceu: { name: 'Céu', light: true, bg: 'linear-gradient(135deg,#e0f7fa,#bbdefb)' },
  aurora: { name: 'Aurora', bg: 'linear-gradient(135deg,#0f2027,#203a43,#2c5364)' },
  meianoite: { name: 'Meia-noite', bg: 'linear-gradient(135deg,#0f0c29,#302b63,#24243e)' },
  crepusculo: { name: 'Crepúsculo', bg: 'linear-gradient(135deg,#2b1055,#7597de)' },
  vinho: { name: 'Vinho', bg: 'linear-gradient(135deg,#1a0000,#6d0019)' },
  floresta: { name: 'Floresta', bg: 'linear-gradient(135deg,#0b2e1f,#1e5631,#2d6a4f)' },
  oceano: { name: 'Oceano', bg: 'linear-gradient(135deg,#0f2b46,#16697a,#1b998b)' },
  neon: { name: 'Neon', bg: 'linear-gradient(135deg,#12c2e9,#c471ed,#f64f59)' },
  pordosol: { name: 'Pôr do sol', bg: 'linear-gradient(135deg,#6a0572,#ab2346,#f7971e)' },
  cobre: { name: 'Cobre', bg: 'linear-gradient(135deg,#2b1b17,#6d4c41,#a1887f)' },
  galaxia: { name: 'Galáxia', bg: 'linear-gradient(135deg,#1a1a40,#7a0bc0,#fa58b6)' },
  turbo: { name: 'Turbo Neon', bg: 'linear-gradient(135deg,#041026,#0b3d5c,#0e7490)' },
  cyber: { name: 'Cyber', bg: 'linear-gradient(135deg,#0f0f0f,#1f4037,#99f2c8)' },
};

export const ACCENTS = ['#22d3ee', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6'];
const DARK_INK = new Set(['#22d3ee', '#eab308', '#22c55e', '#14b8a6', '#f97316']);

export const DEFAULT_PREFS = { theme: 'turbo', gradient: null, accent: '#22d3ee', fontScale: 1 };

export function loadLocalPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem('to.prefs') || '{}') }; } catch { return { ...DEFAULT_PREFS }; }
}

let current = loadLocalPrefs();
export const getPrefs = () => current;

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches;

export function applyPrefs(prefs) {
  current = { ...DEFAULT_PREFS, ...prefs };
  try { localStorage.setItem('to.prefs', JSON.stringify(current)); } catch {}
  const root = document.documentElement;
  const g = current.gradient && GRADIENTS[current.gradient];
  let vars, light;
  if (g) { vars = g.light ? LIGHT_GLASS : DARK_GLASS; light = !!g.light; }
  else {
    const key = current.theme === 'sistema' ? (systemDark() ? 'turbo' : 'claro') : (THEMES[current.theme] ? current.theme : 'turbo');
    vars = THEMES[key].vars; light = !!THEMES[key].light;
  }
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  const accent = ACCENTS.includes(current.accent) ? current.accent : DEFAULT_PREFS.accent;
  root.style.setProperty('--accent', light && accent === '#22d3ee' ? '#0891b2' : accent);
  root.style.setProperty('--accent-ink', DARK_INK.has(accent) && !(light && accent === '#22d3ee') ? '#042f3a' : '#ffffff');
  root.style.setProperty('--app-bg', g ? g.bg : 'var(--bg)');
  root.dataset.glass = g ? 'on' : '';
  root.style.colorScheme = light ? 'light' : 'dark';
  const scale = Math.min(1.3, Math.max(0.85, Number(current.fontScale) || 1));
  document.body && (document.body.style.zoom = scale === 1 ? '' : String(scale));
}

window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (current.theme === 'sistema') applyPrefs(current); });
