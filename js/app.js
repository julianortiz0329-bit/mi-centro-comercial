// Alegría Pet Home · Libro de socios. App aparte de Mi Centro Comercial: solo
// guarda lo de Alegría y lo comparte en la nube entre los socios.
import { localDate, periodLabel } from './core/dates.js';
import { parsePesos } from './core/money.js';
import { accountBalances, ensureAccounts, EXPENSE_CATEGORIES, ivaReport, journal, monthResult, partnerBalances, voidMovement } from './domain/ledger.js';
import { completeSupplierFollowUp, importShopifyOrders, importShopifyProducts, loadPetHomeCatalog, saleTotals, setPhCost, updatePhProfile, voidPhPayment, voidPhSale, voidPurchase, voidPurchasePayment } from './domain/pethome.js';
import { normalizePhone } from './domain/whatsapp.js';
import { getState, login, logout, openCached, renameMe, startAutoSync, subscribe, sync, syncNow } from './store/store.js';
import { $, $$, confirmDialog, download, esc, exec, haptic, money, openModal, toast } from './ui/dom.js';
import { accountForm, contributionForm, expenseForm, showReceipt, transferForm, withdrawalForm } from './ui/forms-ledger.js';
import { phNoteForm, phPaymentForm, phProductForm, phPurchaseDueForm, phPurchaseForm, phPurchasePayForm, phSaleForm, phSupplierForm } from './ui/forms-pethome.js';
import { renderCompra, renderPagar } from './ui/views-payables.js';
import { icon } from './ui/icons.js';
import { bindRipple, bindTilt, bounce, odometer, paintGrain, setSections, swapScreen, syncNavPill } from './ui/motion.js';
import { chargeAccountPdf, monthReportPdf, paymentReceiptPdf } from './ui/pdf-pethome.js';
import { sharePdf } from './ui/pdf-docs.js';
import { navigate, route, savePrefs, ui } from './ui/state.js';
import { renderCaja, renderLibro, renderMas, renderResumen, renderSocios, syncBadge } from './ui/views-ledger.js';
import { phLogo, phProductQuery, phProductRows, renderPhProducts, renderPhProfile, renderPhSale, renderPhSales, renderPhSupplier, renderPhSuppliers } from './ui/views-pethome.js';

export const VERSION = '1.2.0';
globalThis.ALEGRIA_VERSION = VERSION;
const S = () => getState();
const PH = () => S().pethome;

const NAV = [
  ['ph', 'home', 'Resumen'],
  ['ph-ventas', 'receipt', 'Ventas'],
  ['libro', 'book', 'Libro'],
  ['caja', 'bank', 'Caja'],
  ['socios', 'handshake', 'Socios'],
  ['mas', 'grid', 'Más'],
];
const FAB = [
  ['ph-new-sale', 'receipt', 'Venta'],
  ['new-expense', 'cash', 'Gasto'],
  ['ph-new-purchase', 'package', 'Compra a proveedor'],
  ['go-pagar', 'calendar', 'Abonar a una factura'],
  ['new-contribution', 'plus', 'Aporte de socio'],
  ['new-withdrawal', 'wallet', 'Retiro de socio'],
  ['new-transfer', 'refresh', 'Traslado entre cuentas'],
  ['ph-note', 'message', 'Conversación con proveedor'],
];
const NAV_ORDER = NAV.map((x) => x[0]);
const SECTION = { pagar: 'caja', compra: 'caja', 'ph-venta': 'ph-ventas', 'ph-proveedores': 'mas', 'ph-proveedor': 'mas', 'ph-productos': 'mas', 'ph-perfil': 'mas' };

/* ---------------- Pintar ---------------- */
let lastKey = '';
let lastRoute = '';
async function render() {
  if (!S()) return;
  const main = $('#main');
  const r = route();
  const sec = SECTION[r.name] || r.name;
  $$('[data-nav-item]').forEach((a) => a.classList.toggle('active', a.dataset.navItem === sec));
  $$('[data-sync-btn]').forEach((b) => {
    b.innerHTML = icon(sync.online && !sync.error ? (sync.pending ? 'refresh' : 'check') : 'alert');
    b.classList.toggle('warn', !sync.online || !!sync.error);
    b.title = sync.online ? (sync.pending ? `Subiendo ${sync.pending}…` : 'Al día con la nube') : 'Sin internet';
  });
  $$('[data-brand]').forEach((b) => (b.innerHTML = `${phLogo(34)}<div class="greet"><b>Alegría Pet Home</b><small>${esc(S().me.nombre)} · libro de socios</small></div>`));
  const focusKey = document.activeElement?.dataset?.phCost ? `[data-ph-cost="${document.activeElement.dataset.phCost}"]` : document.activeElement?.dataset?.phPrice ? `[data-ph-price="${document.activeElement.dataset.phPrice}"]` : null;
  if (r.name !== lastRoute && document.activeElement?.closest?.('#main')) document.activeElement.blur();
  let html;
  try {
    switch (r.name) {
      case 'ph-ventas': html = renderPhSales(r.params); break;
      case 'ph-venta': html = renderPhSale(r.id); break;
      case 'ph-proveedores': html = renderPhSuppliers(); break;
      case 'ph-proveedor': html = renderPhSupplier(r.id); break;
      case 'ph-productos': html = renderPhProducts(r.params); break;
      case 'ph-perfil': html = renderPhProfile(); break;
      case 'libro': html = renderLibro(r.params); break;
      case 'caja': html = renderCaja(); break;
      case 'pagar': html = renderPagar(r.params); break;
      case 'compra': html = renderCompra(r.id); break;
      case 'socios': html = renderSocios(); break;
      case 'mas': html = renderMas(); break;
      default: html = renderResumen(r.params);
    }
  } catch (e) {
    console.error(e);
    html = `<div class="notice warn">No se pudo mostrar esta pantalla: ${esc(e.message)}. Los datos no se modificaron.</div>`;
  }
  // Mientras se escribe un costo o precio en la lista, no se repinta encima.
  if (focusKey && r.name === lastRoute && `${r.name}/${r.id}` === lastKey) {
    const list = $('#ph-prod-list');
    if (list) {
      list.innerHTML = phProductRows();
      $(focusKey)?.focus({ preventScroll: true });
      return;
    }
  }
  const y = r.name === lastRoute ? window.scrollY : 0;
  const changed = `${r.name}/${r.id}` !== lastKey;
  const fromName = lastRoute;
  const prev = $('.hero-amount[data-count]', main)?.dataset.count;
  const apply = () => {
    main.innerHTML = html;
    if (changed) {
      main.classList.remove('enter');
      void main.offsetWidth;
      main.classList.add('enter');
    }
    for (const el of $$('.hero-amount[data-count]', main)) odometer(el, Number(el.dataset.count) || 0, changed ? {} : { from: Number(prev ?? el.dataset.count) });
    bindTilt(main);
    window.scrollTo(0, y);
  };
  if (changed && lastKey) await swapScreen(fromName, r.name, NAV_ORDER, apply);
  else apply();
  lastKey = `${r.name}/${r.id}`;
  lastRoute = r.name;
  syncNavPill(true);
}

function shell() {
  const items = NAV.map(([k, i, l]) => `<a href="#/${k}" data-nav-item="${k}">${icon(i)}<span>${l}</span></a>`);
  $('#nav-main').innerHTML = items.join('');
  const half = Math.floor(items.length / 2);
  $('#nav-top').innerHTML = `<div class="tb-half">${items.slice(0, half).join('')}</div><span class="tb-gap" aria-hidden="true"></span><div class="tb-half">${items.slice(half).join('')}</div>`;
  $('#fab-menu').innerHTML = FAB.map(([act, ic, label]) => `<button type="button" data-act="${act}">${icon(ic)}${label}</button>`).join('');
  $('[data-fab]').innerHTML = icon('plus', { size: 26 });
  syncDiscreet();
}

function syncDiscreet() {
  document.body.classList.toggle('discreet', ui.privacy);
  const b = $('[data-discreet]');
  if (!b) return;
  b.setAttribute('aria-pressed', String(ui.privacy));
  b.innerHTML = icon(ui.privacy ? 'eyeOff' : 'eye');
}

function applyTheme() {
  const r = document.documentElement;
  if (ui.theme === 'auto') delete r.dataset.theme;
  else r.dataset.theme = ui.theme;
  r.dataset.motion = ui.motion ? 'on' : 'off';
}

function toggleFab(force) {
  const menu = $('#fab-menu');
  const open = force ?? !menu.classList.contains('open');
  menu.classList.toggle('open', open);
  menu.setAttribute('aria-hidden', String(!open));
  menu.inert = !open;
  $('[data-fab]').setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('fab-open', open);
}

/* ---------------- Entrada con clave ---------------- */
function loginScreen(message = '') {
  $('#splash')?.remove();
  $('#lock')?.remove();
  const el = document.createElement('div');
  el.id = 'lock';
  el.innerHTML = `<form class="lk-card login" novalidate>
    <span class="sp-paw" aria-hidden="true">🐾</span>
    <h1>Alegría Pet Home</h1><p>Libro de socios</p>
    <label for="lk-key">Tu clave de socio</label>
    <input id="lk-key" name="clave" autocomplete="current-password" autocapitalize="characters" spellcheck="false" placeholder="ALEGRIA-XXXXX-XXXXX-XXXXX-XXXXX" required>
    ${message ? `<p class="lk-msg" role="alert">${esc(message)}</p>` : ''}
    <button class="btn btn-gold" type="submit">Entrar</button>
    <small>La clave es personal. Cada socio tiene la suya y lo que registra queda a su nombre.</small>
  </form>`;
  document.body.appendChild(el);
  const form = $('form', el);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', form);
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    try {
      const me = await login(form.clave.value);
      el.remove();
      await afterLogin(true);
      toast(`Hola, ${me.nombre}`);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Entrar';
      const msg = $('.lk-msg', form) || form.insertBefore(Object.assign(document.createElement('p'), { className: 'lk-msg' }), btn);
      msg.textContent = err.message;
      haptic([40, 60, 40]);
    }
  });
  setTimeout(() => $('#lk-key', el)?.focus(), 100);
}

let started = false;
async function afterLogin(fresh) {
  if (fresh) {
    $('#main').innerHTML = '<p class="loading">Bajando el libro de la nube…</p>';
    await syncNow();
  }
  if (!S().ledger.accounts.length && sync.online && !sync.error) await exec(ensureAccounts, {}).catch(() => {});
  if (!started) {
    started = true;
    subscribe((_s, reason) => {
      if (reason === 'auth') {
        logout().then(() => loginScreen('Tu clave ya no es válida. Pide una nueva a tu socio.'));
        return;
      }
      if (reason === 'commit' || reason === 'remote' || reason === 'sync') render();
    });
    startAutoSync();
    window.addEventListener('hashchange', render);
  }
  lastKey = '';
  await render();
}

/* ---------------- Acciones ---------------- */
const sale = (id) => PH().sales.find((x) => x.id === id);
async function sharePhPdf(bytes, name, title) {
  const r = await sharePdf(bytes, name.replace(/[\\/:*?"<>|]/g, ''), title);
  if (r === 'downloaded') toast('PDF descargado. Búscalo en Descargas para enviarlo.');
}
function phWhatsApp(x) {
  const pf = PH().profile;
  const t = saleTotals(x);
  const first = x.customerName.split(/\s+/)[0];
  const text = t.balance
    ? `Hola ${first}, te comparto la cuenta de cobro ${x.number} de ${pf.brand}. Total ${money(t.total)}${t.paid ? `, abonado ${money(t.paid)}` : ''}. Saldo pendiente: ${money(t.balance)}.${pf.payInfo ? `\nPuedes pagar a: ${pf.payInfo}` : ''}\n¡Gracias por tu compra! 🐾`
    : `Hola ${first}, confirmamos el pago total de tu compra ${x.number} en ${pf.brand} por ${money(t.total)}. ¡Gracias! 🐾`;
  window.open(`https://wa.me/${normalizePhone(x.customerPhone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}
function imageToJpeg(file, maxSide) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * r));
      const h = Math.max(1, Math.round(img.height * r));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve({ dataUrl: c.toDataURL('image/jpeg', 0.88), w, h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('formato no reconocido'));
    };
    img.src = url;
  });
}
async function logoFromShopify() {
  try {
    const res = await fetch(PH().profile.logoUrl, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await exec(updatePhProfile, { logo: await imageToJpeg(await res.blob(), 480) }, { success: 'Logo guardado' });
  } catch {
    toast('No pude traer el logo desde Shopify ahora. Descárgalo de la tienda y súbelo con "Subir imagen".', 'error');
  }
}
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

const handlers = {
  'new-expense': () => expenseForm(),
  'new-contribution': (el) => contributionForm(el.dataset.socio || null),
  'new-withdrawal': (el) => withdrawalForm(el.dataset.socio || null, el.dataset.amount || ''),
  'new-transfer': () => transferForm(),
  'new-account': () => accountForm(),
  'edit-account': (el) => accountForm(S().ledger.accounts.find((a) => a.id === el.dataset.id)),
  'see-receipt': (el) => showReceipt(el.dataset.id),
  async 'void-move'(el) {
    const reason = await confirmDialog({ title: 'Anular movimiento', message: 'Queda anulado con su motivo (no se borra) y deja de contar en la caja y en las cuentas de los socios.', reason: true, confirmText: 'Anular', danger: true });
    if (reason) await exec(voidMovement, { kind: el.dataset.kind, id: el.dataset.id, reason }, { success: 'Movimiento anulado' }).catch(() => {});
  },
  async 'month-pdf'(el) {
    const p = el.dataset.p || localDate().slice(0, 7);
    try {
      await sharePhPdf(monthReportPdf(S(), p, { monthResult, partnerBalances, accountBalances, journal, EXPENSE_CATEGORIES, periodLabel, ivaReport }), `Alegría ${periodLabel(p)}.pdf`, `Informe ${periodLabel(p)}`);
    } catch (e) {
      toast(`No se pudo crear el PDF: ${e.message}`, 'error');
    }
  },
  'export-csv'(el) {
    const p = el.dataset.p;
    const name = (id) => S().socios.find((x) => x.id === id)?.nombre || '';
    const acc = (id) => S().ledger.accounts.find((a) => a.id === id)?.name || '';
    const rows = [['Fecha', 'Número', 'Tipo', 'Detalle', 'Categoría', 'Cuenta o socio', 'Valor', 'Estado', 'Registró']];
    for (const { kind, x } of journal(S(), p).reverse()) {
      const detail = kind === 'gasto' ? x.description : kind === 'traslado' ? `${acc(x.from)} → ${acc(x.to)}` : name(x.socioId);
      const where = kind === 'gasto' ? (x.payer.startsWith('socio:') ? `${name(x.payer.slice(6))} (bolsillo)` : acc(x.payer)) : kind === 'traslado' ? '' : acc(x.accountId);
      rows.push([x.date, x.number, kind, detail, kind === 'gasto' ? EXPENSE_CATEGORIES[x.category] : '', where, x.amount, x.status, x.createdBy || '']);
    }
    for (const x of PH().sales.filter((v) => v.date.startsWith(p))) rows.push([x.date, x.number, 'venta', x.customerName, '', '', saleTotals(x).total, x.status, '']);
    download(`Alegria libro ${p}.csv`, rows.map((r) => r.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  },
  'sync-now': async () => {
    const changed = await syncNow();
    toast(sync.error ? sync.error : changed ? 'Llegaron cambios de tu socio' : 'Todo al día', sync.error ? 'error' : 'ok');
  },
  async logout() {
    if (sync.pending && !(await confirmDialog({ title: 'Hay cambios sin subir', message: `${sync.pending} cambio(s) no han llegado a la nube. Si cierras sesión se pierden.`, confirmText: 'Cerrar sesión igual', danger: true }))) return;
    await logout();
    location.hash = '#/ph';
    loginScreen();
  },
  'set-theme'(el) {
    ui.theme = el.dataset.v;
    savePrefs();
    applyTheme();
    render();
  },
  async 'ph-load-catalog'() {
    const r = await exec(loadPetHomeCatalog, {}).catch(() => null);
    if (r) toast(`${r.added} producto(s) cargados`);
    if (r && !PH().profile.logo) logoFromShopify();
  },
  'ph-new-sale': () => phSaleForm(),
  'ph-repeat': (el) => phSaleForm(sale(el.dataset.id)),
  'ph-pay': (el) => phPaymentForm(el.dataset.id, async (p) => {
    const x = sale(el.dataset.id);
    toast(`Abono de ${money(p.amount)} registrado`, 'ok', { action: { label: 'Recibo PDF', icon: 'file', onClick: () => sharePhPdf(paymentReceiptPdf(S(), sale(x.id), sale(x.id).payments.find((y) => y.id === p.id)), `Recibo ${p.number} ${x.customerName}.pdf`, `Recibo ${p.number}`) } });
  }),
  async 'ph-charge-pdf'(el) {
    const x = sale(el.dataset.id);
    if (!PH().profile.issuerName) toast('Completa en "Datos para cobrar" el titular del RUT para que salga en la cuenta.', 'error');
    try {
      await sharePhPdf(chargeAccountPdf(S(), x), `Cuenta de cobro ${x.number} ${x.customerName}.pdf`, `Cuenta de cobro ${x.number}`);
    } catch (e) {
      toast(`No se pudo crear el PDF: ${e.message}`, 'error');
    }
  },
  async 'ph-receipt-pdf'(el) {
    const x = sale(el.dataset.id);
    const pays = x.payments.filter((p) => p.status === 'activo');
    const p = el.dataset.pay ? x.payments.find((y) => y.id === el.dataset.pay) : pays[pays.length - 1];
    if (!p) return toast('Esta venta no tiene abonos.', 'error');
    await sharePhPdf(paymentReceiptPdf(S(), x, p), `Recibo ${p.number} ${x.customerName}.pdf`, `Recibo ${p.number}`);
  },
  'ph-wa': (el) => phWhatsApp(sale(el.dataset.id)),
  async 'ph-void-sale'(el) {
    const reason = await confirmDialog({ title: 'Anular venta', message: 'La venta queda anulada con su motivo (no se borra) y sus abonos también.', reason: true, confirmText: 'Anular', danger: true });
    if (reason) await exec(voidPhSale, { saleId: el.dataset.id, reason }, { success: 'Venta anulada' }).catch(() => {});
  },
  async 'ph-void-pay'(el) {
    const reason = await confirmDialog({ title: 'Anular abono', message: 'El abono queda anulado (no se borra) y el saldo vuelve a quedar pendiente.', reason: true, confirmText: 'Anular abono', danger: true });
    if (reason) await exec(voidPhPayment, { saleId: el.dataset.id, paymentId: el.dataset.pay, reason }, { success: 'Abono anulado' }).catch(() => {});
  },
  'ph-new-supplier': () => phSupplierForm(),
  'ph-edit-supplier': (el) => phSupplierForm(PH().suppliers.find((x) => x.id === el.dataset.id)),
  'ph-note': (el) => {
    const id = el.dataset.id || (route().name === 'ph-proveedor' ? route().id : null) || PH().suppliers[0]?.id;
    if (!id) return toast('Primero crea un proveedor (Más → Proveedores).', 'error');
    phNoteForm(id);
  },
  'ph-note-done': (el) => exec(completeSupplierFollowUp, { noteId: el.dataset.id }, { success: 'Seguimiento hecho' }).catch(() => {}),
  'ph-new-purchase': (el) => {
    if (!PH().suppliers.length) return toast('Primero crea un proveedor (Más → Proveedores).', 'error');
    phPurchaseForm(el.dataset.id || (route().name === 'ph-proveedor' ? route().id : null));
  },
  'ph-purchase-pay': (el) => phPurchasePayForm(el.dataset.id),
  'go-pagar': () => navigate('#/pagar'),
  'purchase-due': (el) => phPurchaseDueForm(el.dataset.id),
  async 'void-purchase-pay'(el) {
    const reason = await confirmDialog({ title: 'Anular abono', message: 'El abono queda anulado con su motivo (no se borra), el saldo vuelve a quedar pendiente y la plata regresa a la cuenta.', reason: true, confirmText: 'Anular abono', danger: true });
    if (reason) await exec(voidPurchasePayment, { purchaseId: el.dataset.id, paymentId: el.dataset.pay, reason }, { success: 'Abono anulado' }).catch(() => {});
  },
  async 'void-purchase'(el) {
    const reason = await confirmDialog({ title: 'Anular compra', message: 'La compra queda anulada con su motivo y deja de aparecer en las facturas por pagar.', reason: true, confirmText: 'Anular compra', danger: true });
    if (reason) await exec(voidPurchase, { purchaseId: el.dataset.id, reason }, { success: 'Compra anulada' }).catch(() => {});
  },
  'ph-new-product': () => phProductForm(),
  'ph-edit-product': (el) => phProductForm(PH().products.find((x) => x.id === el.dataset.id)),
  'ph-logo-shopify': () => logoFromShopify(),
  'ph-logo-remove': () => exec(updatePhProfile, { logo: null }, { success: 'Logo quitado' }).catch(() => {}),
};

document.addEventListener('click', async (e) => {
  const navA = e.target.closest('#nav-top a, #nav-main a');
  if (navA) bounce(navA);
  if (e.target.closest('.fab-scrim')) return toggleFab(false);
  if (e.target.closest('[data-fab]')) return toggleFab();
  if (e.target.closest('[data-discreet]')) {
    ui.privacy = !ui.privacy;
    savePrefs();
    syncDiscreet();
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el || !handlers[el.dataset.act]) return;
  if (el.closest('#fab-menu')) toggleFab(false);
  e.preventDefault();
  try {
    await handlers[el.dataset.act](el);
  } catch (err) {
    console.error(err);
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.matches('[data-pref]')) {
    ui[t.dataset.pref] = t.checked;
    savePrefs();
    if (t.dataset.pref === 'privacy') syncDiscreet();
    return;
  }
  if (t.matches('[data-ph-cost],[data-ph-price]')) {
    const id = t.dataset.phCost || t.dataset.phPrice;
    const p = PH().products.find((x) => x.id === id);
    const raw = t.value.trim();
    const v = raw === '' ? null : parsePesos(raw);
    if (raw !== '' && !Number.isSafeInteger(v)) return toast('Escribe el valor en pesos, sin letras.', 'error');
    if (t.dataset.phCost && v === p.cost) return;
    if (t.dataset.phPrice && (v === p.price || v === null)) return;
    await exec(setPhCost, t.dataset.phCost ? { productId: id, cost: v } : { productId: id, cost: p.cost, price: v }).catch(() => {});
    return;
  }
  if (t.matches('[data-ph-logo]') && t.files?.[0]) {
    const file = t.files[0];
    t.value = '';
    try {
      await exec(updatePhProfile, { logo: await imageToJpeg(file, 480) }, { success: 'Logo guardado' });
    } catch (err) {
      toast(`No se pudo usar esa imagen: ${err.message}`, 'error');
    }
    return;
  }
  if (t.matches('[data-ph-products-csv]') && t.files?.[0]) {
    const file = t.files[0];
    t.value = '';
    try {
      const r = await exec(importShopifyProducts, { text: await file.text(), updatePrices: !!$('#ph-csv-prices')?.checked });
      if (r) openModal({ title: 'Productos de Shopify', body: `<p><b>${r.added.length}</b> producto(s) nuevo(s)${r.priced.length ? ` · <b>${r.priced.length}</b> precio(s) actualizado(s)` : ''} · ${r.same} sin cambios${r.archived ? ` · ${r.archived} archivado(s) en Shopify (no se cargan)` : ''}.</p>${r.added.length ? `<p class="small">Nuevos: ${esc(r.added.join(', '))}</p><div class="notice info">Ponles el costo en Productos → Sin costo para ver su margen.</div>` : ''}${r.priced.length ? `<details><summary>Precios que cambiaron</summary><p class="small">${esc(r.priced.join(' · '))}</p></details>` : ''}`, cancelText: 'Cerrar' });
    } catch {
      /* exec ya mostró el error */
    }
    return;
  }
  if (t.matches('[data-ph-import]') && t.files?.[0]) {
    const file = t.files[0];
    t.value = '';
    try {
      const r = await exec(importShopifyOrders, { text: await file.text() });
      if (r) openModal({ title: 'Pedidos de Shopify', body: `<p><b>${r.added}</b> pedido(s) nuevos por ${money(r.total)}.</p>${r.skipped.length ? `<p class="muted small">${r.skipped.length} omitido(s): ${esc(r.skipped.slice(0, 20).join(' · '))}</p>` : ''}${r.unmatched.length ? `<div class="notice warn">Estos productos no están en la lista (quedaron sin costo): ${esc(r.unmatched.join(', '))}</div>` : ''}`, cancelText: 'Cerrar' });
    } catch {
      /* exec ya mostró el error */
    }
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'ph-prod-q' || t.id === 'ph-sim') {
    phProductQuery.q = $('#ph-prod-q').value;
    phProductQuery.sim = Math.max(0, Math.min(90, Number(String($('#ph-sim').value).replace(',', '.')) || 0));
    $('#ph-prod-list').innerHTML = phProductRows();
  }
});

document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (!f.dataset.form) return;
  e.preventDefault();
  const fd = new FormData(f);
  if (f.dataset.form === 'ph-profile') {
    await exec(updatePhProfile, { ...Object.fromEntries(['brand', 'issuerName', 'issuerId', 'phone', 'email', 'city', 'web', 'payInfo', 'taxNote', 'minMarginPct', 'ivaPeriod'].map((k) => [k, fd.get(k)])), ivaResponsable: !!fd.get('ivaResponsable') }, { success: 'Datos guardados' }).catch(() => {});
  } else if (f.dataset.form === 'rename') {
    try {
      await renameMe(fd.get('nombre'));
      toast('Nombre actualizado');
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
});

/* Esconder el menú de abajo al bajar por una lista; vuelve al subir. */
function bindHideOnScroll() {
  let last = window.scrollY;
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const yy = window.scrollY;
      const d = yy - last;
      const atEnd = window.innerHeight + yy >= document.documentElement.scrollHeight - 8;
      if (yy < 60 || d < -8 || atEnd) document.body.classList.remove('nav-away');
      else if (d > 8) document.body.classList.add('nav-away');
      if (Math.abs(d) > 8 || yy < 60) last = yy;
      ticking = false;
    });
  }, { passive: true });
  window.addEventListener('hashchange', () => document.body.classList.remove('nav-away'));
}

async function boot() {
  applyTheme();
  paintGrain();
  bindRipple();
  setSections(SECTION);
  bindHideOnScroll();
  window.addEventListener('resize', () => syncNavPill(false));
  shell();
  const splash = $('#splash');
  const hideSplash = () => {
    splash?.classList.add('hide');
    setTimeout(() => splash?.remove(), 600);
  };
  if (await openCached()) {
    hideSplash();
    await afterLogin(false);
    syncNow();
  } else {
    hideSplash();
    loginScreen();
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

boot();
