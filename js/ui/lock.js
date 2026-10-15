// Bloqueo de privacidad con PIN (y huella o rostro si el celular lo permite).
// El PIN nunca se guarda: solo un resumen SHA-256 con sal aleatoria. Es un
// bloqueo de la interfaz; los datos siguen en este dispositivo.
import { confirmDialog, field, haptic, openModal, toast } from './dom.js';
import { icon, monogram } from './icons.js';
import { savePrefs, ui } from './state.js';

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function digest(salt, pin) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`)));
}

const canHash = () => !!globalThis.crypto?.subtle;

export function setupPin(done) {
  if (!canHash()) return toast('Este navegador no permite crear un PIN seguro (abre la app desde su enlace https).', 'error');
  openModal({
    title: ui.lock ? 'Cambiar PIN' : 'Crear PIN',
    subtitle: 'Usa 4 a 6 números que recuerdes. Si lo olvidas, podrás quitar el bloqueo sin perder datos.',
    body: `<div class="grid2">${field({ name: 'pin', label: 'PIN nuevo', type: 'password', required: true, attrs: 'inputmode="numeric" autocomplete="new-password" maxlength="6" pattern="[0-9]{4,6}"' })}${field({ name: 'pin2', label: 'Repite el PIN', type: 'password', required: true, attrs: 'inputmode="numeric" autocomplete="new-password" maxlength="6" pattern="[0-9]{4,6}"' })}</div>`,
    submitText: 'Guardar PIN',
    onSubmit: async (fd) => {
      const pin = String(fd.get('pin'));
      if (!/^\d{4,6}$/.test(pin)) return toast('El PIN debe tener de 4 a 6 números.', 'error'), false;
      if (pin !== String(fd.get('pin2'))) return toast('Los PIN no coinciden.', 'error'), false;
      const salt = hex(rand(16));
      ui.lock = { salt, hash: await digest(salt, pin), len: pin.length, minutes: ui.lock?.minutes ?? 1, credId: ui.lock?.credId || null };
      done();
      toast('PIN guardado. La app se bloqueará al volver a abrirla.');
    },
  });
}

export async function removePin(done) {
  const ok = await confirmDialog({ title: 'Quitar bloqueo', message: 'La app ya no pedirá PIN ni huella al abrirla.', confirmText: 'Quitar bloqueo' });
  if (!ok) return;
  ui.lock = null;
  done();
}

export async function biometricAvailable() {
  try {
    return !!(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()));
  } catch {
    return false;
  }
}

/** Registra la huella/rostro del celular como llave local de desbloqueo. */
export async function enableBiometric() {
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: rand(32),
        rp: { name: 'Mi Centro Comercial' },
        user: { id: rand(16), name: 'mi-centro-comercial', displayName: 'Mi Centro Comercial' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        timeout: 60000,
      },
    });
    if (!cred) return false;
    ui.lock.credId = b64u(new Uint8Array(cred.rawId));
    return true;
  } catch (e) {
    toast(e?.name === 'NotAllowedError' ? 'Se canceló el registro de la huella.' : 'Este celular no permitió usar la huella aquí.', 'error');
    return false;
  }
}

export function disableBiometric() {
  if (ui.lock) ui.lock.credId = null;
}

async function biometricUnlock() {
  if (!ui.lock?.credId) return false;
  try {
    const r = await navigator.credentials.get({ publicKey: { challenge: rand(32), allowCredentials: [{ type: 'public-key', id: fromB64u(ui.lock.credId) }], userVerification: 'required', timeout: 60000 } });
    return !!r;
  } catch {
    return false;
  }
}

/* ---------- Pantalla de bloqueo ---------- */
let locked = false;
let hiddenAt = null;
const waiters = [];

export const isLocked = () => locked;
/** Resuelve cuando la app está desbloqueada (o si no hay bloqueo). */
export const whenUnlocked = () => (locked ? new Promise((r) => waiters.push(r)) : Promise.resolve());

export function showLock({ name = '', avatar = '' } = {}) {
  if (!ui.lock || locked) return;
  locked = true;
  document.body.classList.add('is-locked');
  let pin = '';
  let fails = 0;
  let waitUntil = 0;
  const el = document.createElement('div');
  el.id = 'lock';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'App bloqueada');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ui.lock.credId ? 'bio' : '', '0', 'del'];
  el.innerHTML = `<div class="lk">
    <div class="lk-top">${avatar || monogram(64)}<b>${name ? `Hola, ${name}` : 'Mi Centro Comercial'}</b><small>Escribe tu PIN</small></div>
    <div class="lk-dots" aria-live="polite">${'<i></i>'.repeat(ui.lock.len || 4)}</div>
    <p class="lk-msg" role="alert"></p>
    <div class="lk-pad">${keys.map((k) => (k === '' ? '<span></span>' : k === 'del' ? `<button type="button" data-k="del" aria-label="Borrar">⌫</button>` : k === 'bio' ? `<button type="button" data-k="bio" aria-label="Usar huella">${icon('fingerprint', { size: 26 })}</button>` : `<button type="button" data-k="${k}">${k}</button>`)).join('')}</div>
    <button type="button" class="lk-forgot" data-k="forgot">¿Olvidaste el PIN?</button>
  </div>`;
  document.body.appendChild(el);
  document.getElementById('splash')?.remove();
  const dots = [...el.querySelectorAll('.lk-dots i')];
  const msg = el.querySelector('.lk-msg');
  const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));
  const unlock = () => {
    locked = false;
    hiddenAt = null;
    el.classList.add('bye');
    document.body.classList.remove('is-locked');
    document.documentElement.classList.remove('pre-lock');
    haptic([8, 40, 8]);
    setTimeout(() => el.remove(), 260);
    while (waiters.length) waiters.shift()();
  };
  const len = ui.lock.len || 4;
  const tryPin = async () => {
    if ((await digest(ui.lock.salt, pin)) === ui.lock.hash) unlock();
    else fail();
  };
  const fail = () => {
    fails++;
    pin = '';
    paint();
    el.querySelector('.lk-dots').classList.remove('shake');
    void el.offsetWidth;
    el.querySelector('.lk-dots').classList.add('shake');
    haptic([30, 40, 30]);
    if (fails >= 5) {
      waitUntil = Date.now() + 30000;
      msg.textContent = 'Demasiados intentos. Espera 30 segundos.';
    } else msg.textContent = 'PIN incorrecto';
  };
  const press = async (k) => {
    if (k === 'forgot') return forgot();
    if (k === 'bio') {
      if (await biometricUnlock()) unlock();
      else msg.textContent = 'No se pudo verificar la huella. Usa tu PIN.';
      return;
    }
    if (Date.now() < waitUntil) return;
    msg.textContent = '';
    if (k === 'del') pin = pin.slice(0, -1);
    else if (pin.length < len) pin += k;
    paint();
    haptic(5);
    if (pin.length === len) await tryPin();
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (b) press(b.dataset.k);
  });
  const onKey = (e) => {
    if (!locked) return document.removeEventListener('keydown', onKey);
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
  };
  document.addEventListener('keydown', onKey);
  const forgot = () => {
    msg.innerHTML = 'Puedes quitar el bloqueo sin perder datos: mantén presionado este mensaje 5 segundos.';
    let t = null;
    const start = () => (t = setTimeout(() => {
      ui.lock = null;
      savePrefs();
      toast('Bloqueo quitado. Crea un PIN nuevo en Más → Personalizar.');
      unlock();
    }, 5000));
    const stop = () => clearTimeout(t);
    msg.onpointerdown = start;
    msg.onpointerup = stop;
    msg.onpointerleave = stop;
  };
  // La huella se ofrece sola al abrir.
  if (ui.lock.credId) setTimeout(() => press('bio'), 350);
}

/** Bloquea al volver a la app tras el tiempo configurado. */
export function watchLock(getProfile) {
  document.addEventListener('visibilitychange', () => {
    if (!ui.lock) return;
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt >= (Number(ui.lock.minutes) || 0) * 60000) showLock(getProfile());
  });
}

