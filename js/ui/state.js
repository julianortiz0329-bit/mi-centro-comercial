// Preferencias de este celular (no se comparten con el otro socio).
const PREF = 'alegria_ui_prefs';

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREF) || '{}');
  } catch {
    return {};
  }
}
const p0 = readPrefs();

export const ui = {
  scope: 'pethome', // dibujos y decoraciones de Alegría
  privacy: !!p0.privacy,
  theme: ['auto', 'light', 'dark'].includes(p0.theme) ? p0.theme : 'auto',
  motion: p0.motion !== false,
  haptics: p0.haptics !== false,
  sound: p0.sound === true,
};

export function savePrefs() {
  try {
    const { privacy, theme, motion, haptics, sound } = ui;
    localStorage.setItem(PREF, JSON.stringify({ privacy, theme, motion, haptics, sound }));
  } catch {
    /* opcional */
  }
}

export function navigate(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

export function route() {
  const h = location.hash.replace(/^#\/?/, '') || 'ph';
  const [name, id] = h.split('/');
  const [path, query] = (id || '').split('?');
  return { name: name.split('?')[0], id: path || null, params: new URLSearchParams(query || h.split('?')[1] || '') };
}
