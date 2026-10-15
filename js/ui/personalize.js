// Personalización por dispositivo: tema, paleta, tamaño de letra, animaciones,
// vibración, foto de perfil, orden del inicio y bloqueo con PIN o huella.
import { getState } from '../store/store.js';
import { $, esc, haptic, toast } from './dom.js';
import { icon } from './icons.js';
import { biometricAvailable, disableBiometric, enableBiometric, removePin, setupPin } from './lock.js';
import { DEFAULT_HOME, HOME_SECTIONS, PALETTES, savePrefs, ui } from './state.js';
import { APP_VERSION } from '../domain/schema.js';

/** Aplica tema, paleta, letra y animaciones al documento. */
export function applyAppearance() {
  const r = document.documentElement;
  if (ui.theme === 'auto') delete r.dataset.theme;
  else r.dataset.theme = ui.theme;
  r.dataset.palette = ui.palette;
  r.dataset.text = ui.text;
  r.dataset.motion = ui.motion ? 'on' : 'off';
  // Color de la barra del sistema igual al fondo de la app.
  requestAnimationFrame(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
  });
}

export function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '') + (w.length > 1 ? w[w.length - 1][0] : w[0]?.[1] || '')).toUpperCase() || '·';
}

/** Avatar del usuario: foto o iniciales sobre degradado. */
export function userAvatar(size = 44) {
  const name = getState().settings.sellerName;
  return ui.photo
    ? `<img class="me-avatar" src="${ui.photo}" width="${size}" height="${size}" alt="" style="width:${size}px;height:${size}px">`
    : `<span class="me-avatar initials" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px" aria-hidden="true">${esc(initials(name || 'Mi Centro'))}</span>`;
}

const seg = (act, value, options) => `<div class="segm" role="radiogroup">${options.map(([v, l, ic]) => `<button type="button" role="radio" aria-checked="${v === value}" data-act="${act}" data-v="${v}">${ic ? icon(ic, { size: 16 }) : ''}${l}</button>`).join('')}</div>`;
const sw = (act, on, label, help = '') => `<label class="switch-row"><span><b>${label}</b>${help ? `<small>${help}</small>` : ''}</span><input type="checkbox" class="switch" data-toggle="${act}" ${on ? 'checked' : ''}></label>`;

export function renderPersonalize() {
  const s = getState();
  const order = ui.homeOrder;
  const bio = ui.lock?.credId;
  return `<div class="page-head"><div><p class="eyebrow"><a href="#/mas">Más</a> · Tu estilo</p><h1>Personalizar</h1><p class="muted">Se guarda en este dispositivo. No cambia tus datos ni tus cálculos.</p></div></div>
  <section class="panel profile-card">
    <div class="profile-row">
      <label class="avatar-edit" title="Cambiar foto">${userAvatar(72)}<span class="avatar-cam">${icon('camera', { size: 16 })}</span><input type="file" accept="image/*" data-photo hidden></label>
      <div class="profile-txt"><b class="profile-name">${esc(s.settings.sellerName || 'Tu nombre')}</b><small>Tu foto y tu nombre aparecen en el saludo de inicio.</small>
        <div class="row-gap"><button class="btn btn-plain btn-small" data-act="set-name">Cambiar nombre</button>${ui.photo ? '<button class="btn btn-plain btn-small" data-act="photo-remove">Quitar foto</button>' : ''}</div></div>
    </div>
  </section>
  <section class="panel"><h2>${icon('palette', { size: 18 })} Apariencia</h2>
    <div class="pz-label">Modo</div>
    ${seg('set-theme', ui.theme, [['auto', 'Automático', 'sparkles'], ['light', 'Claro', 'sun'], ['dark', 'Oscuro', 'moon']])}
    <div class="pz-label">Colección de color</div>
    <div class="palettes">${Object.entries(PALETTES).map(([k, p]) => `<button type="button" class="palette ${ui.palette === k ? 'on' : ''}" data-act="set-palette" data-v="${k}" aria-pressed="${ui.palette === k}"><span class="pal-swatch" style="--a:${p.swatch[0]};--b:${p.swatch[1]}"><i></i></span><b>${p.label}</b><small>${p.hint}</small>${ui.palette === k ? `<span class="pal-check">${icon('check', { size: 14 })}</span>` : ''}</button>`).join('')}</div>
    <div class="pz-label">Tamaño de letra</div>
    ${seg('set-text', ui.text, [['normal', 'Normal'], ['grande', 'Grande']])}
    <div class="switches">${sw('motion', ui.motion, 'Animaciones', 'Transiciones suaves, números que cuentan y celebraciones.')}${sw('haptics', ui.haptics, 'Vibración', 'Una vibración corta al guardar.')}</div>
  </section>
  <section class="panel"><div class="panel-head"><div><h2>${icon('home', { size: 18 })} Pantalla de inicio</h2><p class="muted small">Ordena las secciones con las flechas y oculta las que no uses.</p></div><button class="btn btn-plain btn-small" data-act="home-reset">Restablecer</button></div>
    <ol class="home-order">${order.map((k, i) => `<li class="${ui.homeHidden.includes(k) ? 'off' : ''}"><label class="ho-check"><input type="checkbox" data-home-toggle="${k}" ${ui.homeHidden.includes(k) ? '' : 'checked'}><span>${HOME_SECTIONS[k]}</span></label><span class="ho-move"><button type="button" class="icon-btn" data-act="home-move" data-k="${k}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir ${HOME_SECTIONS[k]}">${icon('up', { size: 18 })}</button><button type="button" class="icon-btn" data-act="home-move" data-k="${k}" data-dir="1" ${i === order.length - 1 ? 'disabled' : ''} aria-label="Bajar ${HOME_SECTIONS[k]}">${icon('down', { size: 18 })}</button></span></li>`).join('')}</ol>
  </section>
  <section class="panel"><h2>${icon('lock', { size: 18 })} Seguridad</h2>
    <p class="muted small">Bloquea la app con un PIN cuando la abras o vuelvas a ella. Protege tus comisiones y los datos de tus clientes si alguien toma tu celular. Es un bloqueo de privacidad: tus datos siguen guardados en este dispositivo.</p>
    ${ui.lock
      ? `<div class="lock-on">${icon('check', { size: 16 })} Bloqueo activado${bio ? ' · con huella' : ''}</div>
        <div class="field"><label for="lock-min">Pedir el PIN</label><select id="lock-min" data-lock-minutes>${[[0, 'Siempre que vuelva a la app'], [1, 'Después de 1 minuto'], [5, 'Después de 5 minutos'], [15, 'Después de 15 minutos'], [60, 'Después de 1 hora']].map(([v, l]) => `<option value="${v}" ${Number(ui.lock.minutes) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="row-gap"><button class="btn btn-plain btn-small" data-act="pin-setup">Cambiar PIN</button><span data-bio-slot>${bio ? '<button class="btn btn-plain btn-small" data-act="bio-off">Dejar de usar huella</button>' : ''}</span><button class="btn btn-plain btn-small" data-act="pin-remove">Quitar bloqueo</button></div>`
      : '<button class="btn btn-primary" data-act="pin-setup">Activar bloqueo con PIN</button>'}
  </section>
  <p class="muted small center">Mi Centro Comercial · versión ${APP_VERSION}</p>`;
}

/** Tras pintar la pantalla: ofrece huella si el equipo la soporta. */
export async function afterPersonalize() {
  const slot = $('[data-bio-slot]');
  if (!slot || !ui.lock || ui.lock.credId) return;
  if (await biometricAvailable()) slot.innerHTML = `<button class="btn btn-secondary btn-small" data-act="bio-on">${icon('fingerprint', { size: 16 })} Usar huella o rostro</button>`;
}

function photoToDataUrl(file, side = 192) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = side;
      c.height = side;
      const k = Math.max(side / img.width, side / img.height); // recorte cuadrado centrado
      const w = img.width * k;
      const h = img.height * k;
      c.getContext('2d').drawImage(img, (side - w) / 2, (side - h) / 2, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('formato no reconocido'));
    };
    img.src = url;
  });
}

/** Acciones de la pantalla Personalizar. `rerender` vuelve a pintar la app. */
export function personalizeHandlers(rerender) {
  const commit = (msg) => {
    if (!savePrefs()) toast('No se pudo guardar la preferencia en este dispositivo.', 'error');
    applyAppearance();
    rerender();
    haptic(8);
    if (msg) toast(msg);
  };
  return {
    'set-theme': (el) => ((ui.theme = el.dataset.v), commit()),
    'set-palette': (el) => ((ui.palette = el.dataset.v), commit(`Colección ${PALETTES[el.dataset.v].label} aplicada`)),
    'set-text': (el) => ((ui.text = el.dataset.v), commit()),
    'home-move': (el) => {
      const o = ui.homeOrder;
      const i = o.indexOf(el.dataset.k);
      const j = i + Number(el.dataset.dir);
      if (i < 0 || j < 0 || j >= o.length) return;
      [o[i], o[j]] = [o[j], o[i]];
      commit();
    },
    'home-reset': () => ((ui.homeOrder = [...DEFAULT_HOME]), (ui.homeHidden = []), commit('Inicio restablecido')),
    'photo-remove': () => ((ui.photo = null), commit('Foto quitada')),
    'pin-setup': () => setupPin(() => commit()),
    'pin-remove': () => removePin(() => commit('Bloqueo quitado')),
    'bio-on': async () => {
      if (await enableBiometric()) commit('Huella activada para desbloquear');
    },
    'bio-off': () => (disableBiometric(), commit('Huella desactivada')),
    async photo(input) {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        ui.photo = await photoToDataUrl(file);
        commit('Foto actualizada');
      } catch (e) {
        toast(`No se pudo usar esa imagen: ${e.message}`, 'error');
      }
    },
    toggle(input) {
      const k = input.dataset.toggle;
      if (k === 'motion') ui.motion = input.checked;
      if (k === 'haptics') ui.haptics = input.checked;
      commit();
    },
    homeToggle(input) {
      const k = input.dataset.homeToggle;
      ui.homeHidden = input.checked ? ui.homeHidden.filter((x) => x !== k) : [...new Set([...ui.homeHidden, k])];
      commit();
    },
    lockMinutes(select) {
      if (!ui.lock) return;
      ui.lock.minutes = Number(select.value);
      commit('Listo');
    },
  };
}
