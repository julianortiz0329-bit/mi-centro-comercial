// Movimiento y efectos de la interfaz: transiciones entre pantallas, pastilla
// del menú, onda al tocar, odómetro, confirmaciones (cobro, sello PAGADO,
// destellos), tarjeta holográfica y sonidos opcionales. Todo respeta la
// opción "Animaciones" y la preferencia del sistema de reducir movimiento.
import { $, $$, money } from './dom.js';
import { ui } from './state.js';

export const motionOff = () => !ui.motion || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ---------------- Transiciones entre pantallas ---------------- */
const DETAIL = new Set(['cliente', 'doc', 'ph-venta', 'ph-proveedor', 'ph-perfil']);
const depth = (name) => (DETAIL.has(name) ? 2 : 1);

/**
 * Cambia el contenido de la pantalla con una transición de app nativa.
 * Hacia el detalle entra por la derecha; al volver, por la izquierda. Entre
 * pestañas, según el orden del menú.
 */
export function swapScreen(fromName, toName, navOrder, apply) {
  if (motionOff() || !fromName || fromName === toName) return apply();
  let back = depth(toName) < depth(fromName);
  if (depth(toName) === depth(fromName)) {
    const a = navOrder.indexOf(sectionOf(fromName));
    const b = navOrder.indexOf(sectionOf(toName));
    back = a >= 0 && b >= 0 && b < a;
  }
  const root = document.documentElement;
  root.classList.toggle('vt-back', back);
  if (document.startViewTransition) {
    try {
      const t = document.startViewTransition(apply);
      t.finished.finally(() => clearMorph());
      return t.updateCallbackDone;
    } catch {
      /* sigue con el respaldo */
    }
  }
  apply();
  const main = $('#main');
  main.classList.remove('slide-in', 'slide-back');
  void main.offsetWidth;
  main.classList.add(back ? 'slide-back' : 'slide-in');
  return null;
}
let sections = {};
export function setSections(map) {
  sections = map;
}
const sectionOf = (n) => sections[n] || n;

/** Marca la tarjeta tocada para que se "convierta" en la ficha. */
export function markMorph(cardEl) {
  if (motionOff() || !cardEl) return;
  clearMorph();
  cardEl.style.viewTransitionName = 'morph-card';
  const av = cardEl.querySelector('.c-avatar');
  if (av) av.style.viewTransitionName = 'morph-avatar';
}
function clearMorph() {
  $$('[style*="view-transition-name"]').forEach((el) => {
    if (el.id !== 'main') el.style.viewTransitionName = '';
  });
}

/* ---------------- Pastilla del menú ---------------- */
export function syncNavPill(animate = true) {
  const nav = $('#nav-top');
  if (!nav) return;
  let pill = $('.nav-pill', nav);
  if (!pill) {
    pill = document.createElement('span');
    pill.className = 'nav-pill';
    pill.setAttribute('aria-hidden', 'true');
    nav.prepend(pill);
  }
  const active = $('a.active', nav);
  if (!active) return (pill.style.opacity = '0');
  pill.style.transition = animate && !motionOff() ? '' : 'none';
  pill.style.opacity = '1';
  pill.style.width = `${active.offsetWidth}px`;
  pill.style.transform = `translateX(${active.offsetLeft}px)`;
}

export function bounce(el) {
  if (motionOff() || !el) return;
  el.classList.remove('bounce');
  void el.offsetWidth;
  el.classList.add('bounce');
}

/* ---------------- Onda dorada al tocar ---------------- */
const RIPPLE = '.btn, .quick-tile, .fab-menu button, .scope button, .ch-actions > *, .chip, .segm button, .palette, .acard .btn, .lk-pad button';
export function bindRipple() {
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest(RIPPLE);
    if (!b || motionOff() || b.disabled) return;
    const r = b.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.2;
    const w = document.createElement('span');
    w.className = 'ripple';
    w.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left}px;top:${e.clientY - r.top}px`;
    if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
    b.classList.add('has-ripple');
    b.appendChild(w);
    setTimeout(() => w.remove(), 700);
  }, { passive: true });
}

/* ---------------- Odómetro ---------------- */
export function odometer(el, value, { from = null } = {}) {
  const txt = money(value);
  el.setAttribute('aria-label', txt);
  if (motionOff()) {
    el.textContent = txt;
    return;
  }
  const build = (t) => [...t].map((ch) => (/\d/.test(ch) ? `<span class="od-d"><span class="od-col">${'0123456789'.split('').map((n) => `<span>${n}</span>`).join('')}</span></span>` : `<span class="od-s">${ch === ' ' || ch === ' ' ? '&nbsp;' : ch}</span>`)).join('');
  if (!el.classList.contains('odo') || el.dataset.len !== String(txt.length)) {
    el.classList.add('odo');
    el.innerHTML = build(txt);
    el.dataset.len = String(txt.length);
    const start = from === null ? 0 : from;
    const s = money(start).padStart(txt.length, ' ');
    let k = 0;
    [...txt].forEach((ch, i) => {
      if (!/\d/.test(ch)) return;
      const d = /\d/.test(s[i]) ? Number(s[i]) : 0;
      const col = $$('.od-col', el)[k++];
      col.style.transition = 'none';
      col.style.transform = `translateY(-${d}em)`;
    });
    void el.offsetWidth;
  }
  let k = 0;
  [...txt].forEach((ch) => {
    if (!/\d/.test(ch)) return;
    const col = $$('.od-col', el)[k++];
    col.style.transition = '';
    col.style.transitionDelay = `${k * 45}ms`;
    col.style.transform = `translateY(-${Number(ch)}em)`;
  });
}

/* ---------------- Sonidos (opcionales, sintetizados) ---------------- */
let actx = null;
function tone(seq) {
  if (!ui.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime;
    for (const [f, d, type = 'triangle', vol = 0.16, len = 0.35, to = null] of seq) {
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t + d);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + d + len * 0.6);
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(vol, t + d + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + len);
      o.connect(g).connect(actx.destination);
      o.start(t + d);
      o.stop(t + d + len + 0.05);
    }
  } catch {
    /* sin audio */
  }
}
export const sounds = {
  cash: () => tone([[1318, 0], [1760, 0.09], [2637, 0.18]]),
  stamp: () => tone([[180, 0, 'sine', 0.3, 0.2, 60]]),
  win: () => tone([[784, 0], [988, 0.1], [1175, 0.2], [1568, 0.32, 'triangle', 0.18, 0.5]]),
  tick: () => tone([[1200, 0, 'square', 0.03, 0.04]]),
};

/* ---------------- Confirmación de cobro: ✓ + moneda ---------------- */
/** Muestra la confirmación animada; la promesa se cumple al cerrarse. */
export function cobroDone(amount, who = '') {
  sounds.cash();
  navigator.vibrate?.(ui.haptics ? [12, 60, 18] : 0);
  if (motionOff()) return Promise.resolve();
  return new Promise((resolve) => {
  const el = document.createElement('div');
  el.className = 'cobro-ok';
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="co-box">
    <svg class="co-check" width="64" height="64" viewBox="0 0 64 64" fill="none" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="32" cy="32" r="25"/><path d="M21 33l8 8 15-17"/></svg>
    <div class="co-wallet" aria-hidden="true"><span class="co-coin">$</span><svg width="64" height="48" viewBox="0 0 24 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2 4h17a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/><path d="M2 4l14-3v3"/><path d="M21 9h-4a2 2 0 0 0 0 4h4"/></svg></div>
    <b>Cobro registrado</b><p></p></div>`;
  el.querySelector('p').textContent = `${money(amount)}${who ? ` de ${who}` : ''}`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('on'));
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    el.classList.remove('on');
    setTimeout(() => {
      el.remove();
      resolve();
    }, 260);
  };
  el.addEventListener('click', close);
  setTimeout(close, 2200);
  });
}

/* ---------------- Sello PAGADO ---------------- */
let justPaid = null;
/** Marca que la cuenta acaba de saldarse para estampar el sello al mostrarla. */
export function markPaid(id) {
  justPaid = { id, at: Date.now() };
}
export function paidStamp(id) {
  const fresh = justPaid && justPaid.id === id && Date.now() - justPaid.at < 8000;
  if (fresh) {
    justPaid = null;
    setTimeout(() => sounds.stamp(), 280);
  }
  return `<span class="paid-stamp ${fresh && !motionOff() ? 'fresh' : ''}" aria-label="Cuenta pagada">PAGADO</span>`;
}

/* ---------------- Destellos ---------------- */
export function sparkle(title, text) {
  sounds.win();
  navigator.vibrate?.(ui.haptics ? [20, 60, 30] : 0);
  const wrap = document.createElement('div');
  wrap.className = 'celebrate';
  const cols = ['var(--hero-accent)', 'var(--hero-accent-2)', 'var(--amb)', '#fff3c9', 'var(--primary)'];
  const bits = motionOff() ? '' : Array.from({ length: 46 }, (_, i) => `<i style="--c:${cols[i % cols.length]};--x:${Math.round(Math.cos(i * 1.3) * (70 + (i % 7) * 24))}px;--y:${Math.round(Math.sin(i * 2.1) * (100 + (i % 5) * 32) - 40)}px;--r:${i * 61}deg;animation-delay:${(i % 8) * 25}ms"></i>`).join('');
  wrap.innerHTML = `${bits}<div class="msg" role="status"><b></b><span></span></div>`;
  wrap.querySelector('b').textContent = title;
  wrap.querySelector('span').textContent = text;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', () => wrap.remove());
  setTimeout(() => wrap.remove(), 3800);
}

/* ---------------- Tarjeta holográfica ---------------- */
let tiltEl = null;
function applyTilt(x, y) {
  if (!tiltEl || !tiltEl.isConnected) return;
  tiltEl.style.setProperty('--mx', `${x * 100}%`);
  tiltEl.style.setProperty('--my', `${y * 100}%`);
  tiltEl.style.setProperty('--ry', `${(x - 0.5) * 12}deg`);
  tiltEl.style.setProperty('--rx', `${(0.5 - y) * 10}deg`);
}
let orientationBound = false;
/** Activa la inclinación de la tarjeta principal (giroscopio o dedo). */
export function bindTilt(root) {
  tiltEl = $('.hero', root);
  if (!tiltEl || motionOff()) return;
  tiltEl.classList.add('tilt');
  const move = (e) => {
    const r = tiltEl.getBoundingClientRect();
    tiltEl.classList.add('live');
    applyTilt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
  const leave = () => {
    tiltEl.classList.remove('live');
    applyTilt(0.5, 0.3);
  };
  tiltEl.addEventListener('pointermove', move);
  tiltEl.addEventListener('pointerleave', leave);
  tiltEl.addEventListener('pointerup', leave);
  if (!orientationBound && 'DeviceOrientationEvent' in window && typeof DeviceOrientationEvent.requestPermission !== 'function') {
    orientationBound = true;
    let raf = 0;
    window.addEventListener('deviceorientation', (e) => {
      if (motionOff() || e.gamma == null || !tiltEl?.isConnected || tiltEl.classList.contains('live')) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // Inclinación normal del celular en la mano: unos 45° hacia atrás.
        const x = Math.max(0, Math.min(1, 0.5 + e.gamma / 50));
        const y = Math.max(0, Math.min(1, 0.5 + (e.beta - 45) / 50));
        applyTilt(x, y);
      });
    }, { passive: true });
  }
}

/* ---------------- Ambiente: grano generado ---------------- */
export function paintGrain() {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 140;
    const g = c.getContext('2d');
    const img = g.createImageData(140, 140);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 110 + Math.random() * 145;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 22;
    }
    g.putImageData(img, 0, 0);
    document.documentElement.style.setProperty('--grain', `url(${c.toDataURL()})`);
  } catch {
    /* sin textura */
  }
}

/** Brillo de carga (esqueleto) mientras algo se procesa. */
export const skeleton = (lines = 3) => `<div class="sk-wrap" aria-hidden="true">${Array.from({ length: lines }, (_, i) => `<span class="sk" style="width:${[92, 70, 84, 60][i % 4]}%"></span>`).join('')}</div>`;

/** Adornos de la tarjeta principal según la empresa activa (se muestran por CSS). */
export function heroDeco() {
  const paw = '<g><ellipse cx="0" cy="8" rx="9" ry="7"/><circle cx="-8" cy="-4" r="3.5"/><circle cx="-2" cy="-8" r="3.5"/><circle cx="5" cy="-7" r="3.5"/><circle cx="10" cy="-1" r="3.5"/></g>';
  return `<span class="sheen" aria-hidden="true"></span>
  <svg class="deco deco-nogal" viewBox="0 0 360 180" aria-hidden="true"><g fill="none" stroke="rgb(255 255 255 / .1)" stroke-width="1.4"><path d="M300 20c30 10 40 45 25 70-25-5-40-35-25-70z"/><path d="M300 20c5 25 15 45 25 70"/><path d="M250 120c20-5 40 10 40 30-20 5-38-8-40-30z"/><ellipse cx="335" cy="150" rx="16" ry="12"/></g></svg>
  <svg class="deco deco-puntazo" viewBox="0 0 360 180" aria-hidden="true"><g opacity=".55"><rect x="250" y="20" width="6" height="10" rx="1" fill="#ffd166" transform="rotate(20 253 25)"/><rect x="300" y="50" width="6" height="10" rx="1" fill="#ffc2a1" transform="rotate(-30 303 55)"/><rect x="330" y="20" width="6" height="10" rx="1" fill="#9ee6c9" transform="rotate(45 333 25)"/><circle cx="280" cy="120" r="4" fill="#ffd166"/><circle cx="340" cy="100" r="3" fill="#fff"/><rect x="230" y="150" width="6" height="10" rx="1" fill="#9ec5ff" transform="rotate(-15 233 155)"/><circle cx="320" cy="160" r="4" fill="#ffc2a1"/></g></svg>
  <svg class="deco deco-pethome" viewBox="0 0 360 180" aria-hidden="true"><g fill="rgb(255 255 255 / .1)"><g transform="translate(290 30) rotate(20)">${paw}</g><g transform="translate(325 95) rotate(35) scale(.8)">${paw}</g><g transform="translate(270 145) rotate(5) scale(.7)">${paw}</g></g></svg>`;
}
