// Estado de la interfaz (por dispositivo): empresa seleccionada, ruta y
// personalización (tema, paleta, letra, foto, orden del inicio, bloqueo).
const PREF = 'mcc_ui_prefs';

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREF) || '{}');
  } catch {
    return {};
  }
}

export const HOME_SECTIONS = {
  acciones: 'Lo importante hoy',
  hero: 'Tarjeta de comisión',
  accesos: 'Accesos rápidos',
  indicadores: 'Indicadores del mes',
  umbral: 'Umbral y ritmo de Nogal',
  agenda: 'Agenda de hoy',
  metas: 'Metas del mes',
  clientes: 'Clientes importantes y seguimiento',
};
export const DEFAULT_HOME = Object.keys(HOME_SECTIONS);
export const PALETTES = {
  nogal: { label: 'Nogal', hint: 'Verde bosque y oro', swatch: ['#1f4d3e', '#b8893b'] },
  zafiro: { label: 'Zafiro', hint: 'Azul noche y champaña', swatch: ['#1d3a5f', '#c9a96e'] },
  ciruela: { label: 'Ciruela', hint: 'Berenjena y oro rosa', swatch: ['#5b2a4e', '#c8906b'] },
  terracota: { label: 'Terracota', hint: 'Arcilla y miel', swatch: ['#9c3f2a', '#c58b3f'] },
  grafito: { label: 'Grafito', hint: 'Negro y dorado', swatch: ['#26292e', '#b8893b'] },
};

const p0 = readPrefs();
const cleanOrder = (o) => {
  const valid = Array.isArray(o) ? o.filter((k) => HOME_SECTIONS[k]) : [];
  return [...new Set([...valid, ...DEFAULT_HOME])];
};

export const ui = {
  scope: ['puntazo', 'nogal', 'todas', 'pethome'].includes(p0.scope) ? p0.scope : 'todas',
  lastCrmScope: ['puntazo', 'nogal', 'todas'].includes(p0.lastCrmScope) ? p0.lastCrmScope : 'todas',
  privacy: !!p0.privacy,
  theme: ['auto', 'light', 'dark'].includes(p0.theme) ? p0.theme : 'auto',
  palette: PALETTES[p0.palette] ? p0.palette : 'nogal',
  text: ['normal', 'grande'].includes(p0.text) ? p0.text : 'normal',
  motion: p0.motion !== false,
  haptics: p0.haptics !== false,
  photo: typeof p0.photo === 'string' && p0.photo.startsWith('data:image/') ? p0.photo : null,
  homeOrder: cleanOrder(p0.homeOrder),
  homeHidden: Array.isArray(p0.homeHidden) ? p0.homeHidden.filter((k) => HOME_SECTIONS[k]) : [],
  lock: p0.lock && typeof p0.lock.hash === 'string' ? p0.lock : null, // { salt, hash, minutes, credId? }
};

export function setScope(scope) {
  if (scope !== 'pethome') ui.lastCrmScope = scope;
  ui.scope = scope;
  savePrefs();
}

export function savePrefs() {
  try {
    const { scope, lastCrmScope, privacy, theme, palette, text, motion, haptics, photo, homeOrder, homeHidden, lock } = ui;
    localStorage.setItem(PREF, JSON.stringify({ scope, lastCrmScope, privacy, theme, palette, text, motion, haptics, photo, homeOrder, homeHidden, lock }));
    return true;
  } catch {
    return false; // preferencia opcional (p. ej. almacenamiento lleno)
  }
}

export function navigate(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

export function route() {
  const h = location.hash.replace(/^#\/?/, '') || 'hoy';
  const [name, id] = h.split('/');
  const [path, query] = (id || '').split('?');
  return { name: name.split('?')[0], id: path || null, params: new URLSearchParams(query || h.split('?')[1] || '') };
}
