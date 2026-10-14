// Estado de la interfaz (por dispositivo): empresa seleccionada y ruta.
const PREF = 'mcc_ui_prefs';

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREF) || '{}');
  } catch {
    return {};
  }
}

export const ui = {
  scope: ['puntazo', 'nogal', 'todas'].includes(readPrefs().scope) ? readPrefs().scope : 'todas',
  privacy: !!readPrefs().privacy,
};

export function setScope(scope) {
  ui.scope = scope;
  savePrefs();
}

export function savePrefs() {
  try {
    localStorage.setItem(PREF, JSON.stringify({ scope: ui.scope, privacy: ui.privacy }));
  } catch {
    /* preferencia opcional */
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
