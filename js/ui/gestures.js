// Gestos con el dedo (3.2): deslizar tarjetas de cliente, mantener presionado,
// jalar para refrescar, cambiar de sección deslizando y esconder el menú al bajar.
import { telLink, normalizePhone } from '../domain/whatsapp.js';
import { getState } from '../store/store.js';
import { $, esc, haptic, HAPTIC } from './dom.js';
import { icon } from './icons.js';
import { clientAvatar } from './views-clients.js';
import { navigate } from './state.js';

const GO = 88; // px para disparar la acción al deslizar
let suppressClick = false;

/** Evita el clic que el navegador manda después de un gesto. */
function eatNextClick() {
  suppressClick = true;
  setTimeout(() => (suppressClick = false), 400);
}

/* ---------------- Tarjeta de cliente: deslizar y mantener presionado ---------------- */
function bindClientCards(fire) {
  let g = null;
  const reset = (card, under) => {
    card.style.transform = '';
    card.classList.remove('swiping', 'pressing');
    if (under) {
      under.style.opacity = '';
      under.className = 'swipe-under';
    }
  };
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const host = e.target.closest('.swipe-host');
    if (!host || e.target.closest('.card-actions')) return;
    const card = $('.client-card', host);
    g = { host, card, under: $('.swipe-under', host), id: host.dataset.swipeClient, x: e.clientX, y: e.clientY, dx: 0, mode: null, go: false };
    g.timer = setTimeout(() => {
      if (!g || g.mode) return;
      g.mode = 'press';
      card.classList.add('pressing');
      haptic(HAPTIC.press);
      eatNextClick();
      setTimeout(() => {
        reset(card, g?.under);
        openPressMenu(g.id);
        g = null;
      }, 160);
    }, 480);
  });
  document.addEventListener('pointermove', (e) => {
    if (!g || g.mode === 'press') return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.mode) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return cancel();
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        clearTimeout(g.timer);
        g.mode = 'swipe';
        g.card.classList.add('swiping');
      } else return;
    }
    // Hacia la derecha solo si el cliente tiene WhatsApp.
    let x = dx;
    if (x > 0 && !g.host.dataset.hasWa) x = Math.min(x, 24);
    x = Math.sign(x) * Math.min(Math.abs(x), 150) * (Math.abs(x) > GO ? 0.92 : 1);
    g.dx = x;
    g.card.style.transform = `translateX(${x}px)`;
    g.under.style.opacity = String(Math.min(1, Math.abs(x) / 40));
    const go = Math.abs(x) >= GO;
    g.under.className = `swipe-under ${x > 0 ? 'right' : 'left'}${go ? ' go' : ''}`;
    if (go !== g.go) {
      g.go = go;
      if (go) haptic(HAPTIC.tap);
    }
  });
  const end = () => {
    if (!g) return;
    clearTimeout(g.timer);
    const { mode, go, dx, id, card, under } = g;
    g = null;
    if (mode !== 'swipe') return;
    eatNextClick();
    reset(card, under);
    if (go) fire(dx > 0 ? 'wa' : 'pay', id);
  };
  const cancel = () => {
    if (!g) return;
    clearTimeout(g.timer);
    reset(g.card, g.under);
    g = null;
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', () => (g?.mode === 'swipe' ? end() : cancel()));
  document.addEventListener('contextmenu', (e) => e.target.closest('.swipe-host') && e.preventDefault());
  document.addEventListener('dragstart', (e) => e.target.closest?.('.swipe-host') && e.preventDefault());
  document.addEventListener('click', (e) => {
    if (suppressClick && e.target.closest('.swipe-host')) {
      e.preventDefault();
      e.stopPropagation();
      suppressClick = false;
    }
  }, true);
}

function openPressMenu(clientId) {
  const c = getState().clients.find((x) => x.id === clientId);
  if (!c) return;
  const phone = normalizePhone(c.whatsapp || c.phone);
  const el = document.createElement('div');
  el.className = 'press-menu';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `Acciones para ${c.tradeName}`);
  el.innerHTML = `<div class="pm-card">
    <div class="pm-head">${clientAvatar(c, 40)}<div><b>${esc(c.tradeName)}</b><small>${esc([c.city, c.phone || c.whatsapp].filter(Boolean).join(' · '))}</small></div></div>
    ${phone ? `<a href="${telLink(c.phone || c.whatsapp)}">${icon('phone')}Llamar</a><button type="button" data-act="wa" data-client="${c.id}">${icon('message')}WhatsApp</button>` : ''}
    <button type="button" data-act="pay" data-client="${c.id}">${icon('cash')}Registrar cobro</button>
    <button type="button" data-act="new-doc" data-kind="venta" data-client="${c.id}">${icon('receipt')}Nueva venta</button>
    <button type="button" data-act="new-doc" data-kind="pedido" data-client="${c.id}">${icon('clipboard')}Nuevo pedido</button>
    <a href="#/cliente/${c.id}">${icon('users')}Ver ficha</a>
  </div>`;
  const close = () => {
    el.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  // El clic llega primero al menú (cierra) y luego sube al manejador global de data-act.
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('button, a')) setTimeout(close, 0);
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(el);
  el.querySelector('button, a')?.focus({ preventScroll: true });
}

/* ---------------- Jalar para refrescar (Hoy y Resumen de Alegría) ---------------- */
function bindPullToRefresh(canPull, onRefresh) {
  const ptr = document.createElement('div');
  ptr.className = 'ptr';
  ptr.setAttribute('aria-hidden', 'true');
  ptr.innerHTML = icon('arrowRight', { size: 20 }).replace('<svg', '<svg style="rotate:90deg"');
  document.body.appendChild(ptr);
  let p = null;
  window.addEventListener('touchstart', (e) => {
    if (window.scrollY > 0 || !canPull() || document.body.classList.contains('modal-open') || e.touches.length > 1) return;
    p = { y: e.touches[0].clientY, x: e.touches[0].clientX, d: 0 };
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (!p) return;
    const d = e.touches[0].clientY - p.y;
    if (d < 0 || Math.abs(e.touches[0].clientX - p.x) > Math.abs(d)) {
      p = null;
      ptr.style.cssText = '';
      return;
    }
    p.d = Math.min(d * 0.5, 110);
    ptr.style.transition = 'none';
    ptr.style.opacity = String(Math.min(1, p.d / 50));
    ptr.style.translate = `0 ${p.d - 30}px`;
    const ready = p.d >= 70;
    if (ready !== ptr.classList.contains('ready')) {
      ptr.classList.toggle('ready', ready);
      if (ready) haptic(HAPTIC.tap);
    }
  }, { passive: true });
  window.addEventListener('touchend', async () => {
    if (!p) return;
    const ready = p.d >= 70;
    p = null;
    ptr.style.transition = 'translate .3s, opacity .3s';
    if (!ready) return (ptr.style.cssText = 'transition: translate .3s, opacity .3s');
    ptr.classList.remove('ready');
    ptr.classList.add('spin');
    ptr.style.translate = '0 calc(56px + env(safe-area-inset-top))';
    await onRefresh();
    setTimeout(() => {
      ptr.classList.remove('spin');
      ptr.style.cssText = 'transition: translate .3s, opacity .3s';
    }, 450);
  });
}

/* ---------------- Deslizar para cambiar de sección ---------------- */
function scrollsSideways(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 4 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
  }
  return false;
}
function bindSectionSwipe(sections) {
  let s = null;
  const main = $('#main');
  main.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (e.touches.length > 1 || t.clientX < 28 || t.clientX > window.innerWidth - 28) return (s = null);
    if (e.target.closest('.swipe-host, input, textarea, select, .hero, .ring, [data-no-swipe]') || scrollsSideways(e.target)) return (s = null);
    s = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, { passive: true });
  main.addEventListener('touchend', (e) => {
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    const fast = Date.now() - s.t < 600;
    s = null;
    if (!fast || Math.abs(dx) < 80 || Math.abs(dy) > 45 || document.body.classList.contains('modal-open')) return;
    const { list, current } = sections();
    const i = list.indexOf(current);
    if (i < 0) return;
    const to = list[i + (dx < 0 ? 1 : -1)];
    if (!to) return;
    haptic(HAPTIC.tap);
    navigate(`#/${to}`);
  }, { passive: true });
}

/* ---------------- Esconder el menú de abajo al bajar ---------------- */
function bindHideOnScroll() {
  let last = window.scrollY;
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      const d = y - last;
      const atEnd = window.innerHeight + y >= document.documentElement.scrollHeight - 8;
      if (y < 60 || d < -8 || atEnd) document.body.classList.remove('nav-away');
      else if (d > 8) document.body.classList.add('nav-away');
      if (Math.abs(d) > 8 || y < 60) last = y;
      ticking = false;
    });
  }, { passive: true });
  window.addEventListener('hashchange', () => document.body.classList.remove('nav-away'));
}

export function bindGestures({ fire, sections, canPull, onRefresh }) {
  bindClientCards(fire);
  bindPullToRefresh(canPull, onRefresh);
  bindSectionSwipe(sections);
  bindHideOnScroll();
}
