// Punto de entrada: arranque, navegación y manejo de acciones.
import { localDate, formatDateTime } from './core/dates.js';
import { parsePesos, pctToBps, bpsToPct } from './core/money.js';
import { normalizePhone } from './domain/whatsapp.js';
import { makeBackup, readBackup } from './domain/backup.js';
import { createClient, setClientStatus } from './domain/clients.js';
import { cancelSettlement, confirmPolicy, createSettlement, markSettlementPaid, updateRules } from './domain/commissions.js';
import { changeDueDate, changeStatus, confirmDelivery, voidSale } from './domain/documents.js';
import { parseCSV, rowsToClients, rowsToProducts, toCSV } from './domain/csv.js';
import { V1_KEY } from './domain/migrate.js';
import { reversePayment, unapplyAllocation } from './domain/payments.js';
import { loadNogalCatalog, saveProduct } from './domain/products.js';
import { priceListText, quoteText } from './ui/quote.js';
import { commissionReportPdf, documentPdf, sharePdf } from './ui/pdf-docs.js';
import { quickLogForm } from './ui/quicklog.js';
import { CLIENT_STATUSES, emptyState, ACTIVE_COMPANY_IDS } from './domain/schema.js';
import { setGoals, updateSettings } from './domain/settings.js';
import { buildAgenda } from './domain/agenda.js';
import { dailySnapshot, listSnapshots, requestPersistentStorage } from './store/persistence.js';
import { getState, initStore, replaceState, run, subscribe } from './store/store.js';
import { $, $$, bindMoneyPreviews, confirmDialog, download, errorMessage, esc, exec, field, haptic, HAPTIC, money, openModal, readMoney, requestId, toast } from './ui/dom.js';
import { exportData } from './ui/exports.js';
import { activityForm, clientForm, dispatchForm, documentForm, paymentForm, productForm, taskForm, whatsappComposer } from './ui/forms.js';
import { navigate, route, savePrefs, setScope, ui } from './ui/state.js';
import { icon, monogram } from './ui/icons.js';
import { periodMetrics } from './domain/metrics.js';
import { carteraQuery, carteraResults, renderCartera } from './ui/views-cartera.js';
import { clientQuery, clientResults, renderClient, renderClients } from './ui/views-clients.js';
import { explainCommission, renderCommissions } from './ui/views-commissions.js';
import { afterPersonalize, applyAppearance, personalizeHandlers, renderPersonalize, userAvatar } from './ui/personalize.js';
import { showLock, watchLock, whenUnlocked } from './ui/lock.js';
import { openSearch } from './ui/search.js';
import { bindGestures } from './ui/gestures.js';
import { bindRipple, bindTilt, bounce, markMorph, odometer, paintGrain, setSections, sparkle, swapScreen, syncNavPill } from './ui/motion.js';
import { phLogo, phProductQuery, phProductRows, renderPhHome, renderPhProducts, renderPhProfile, renderPhSale, renderPhSales, renderPhSupplier, renderPhSuppliers } from './ui/views-pethome.js';
import { phNoteForm, phPaymentForm, phProductForm, phPurchaseForm, phPurchasePayForm, phSaleForm, phSupplierForm } from './ui/forms-pethome.js';
import { chargeAccountPdf, paymentReceiptPdf } from './ui/pdf-pethome.js';
import { completeSupplierFollowUp, importShopifyOrders, loadPetHomeCatalog, saleTotals, setPhCost, updatePhProfile, voidPhPayment, voidPhSale } from './domain/pethome.js';
import { parseContactText } from './domain/contact-parse.js';
import { handleAgendaAction, renderAgenda, renderHome } from './ui/views-home.js';
import { renderAudit, renderConfig, renderData, renderGoals, renderHelp, renderMore, renderPetHome, renderProducts, renderReports } from './ui/views-more.js';
import { renderDocument, renderSales, salesQuery, salesResults } from './ui/views-sales.js';

const S = () => getState();
const NAV = [
  ['hoy', 'home', 'Hoy'],
  ['clientes', 'users', 'Clientes'],
  ['ventas', 'receipt', 'Ventas'],
  ['cartera', 'wallet', 'Cartera'],
  ['comisiones', 'coins', 'Comisiones', 'Comisión'],
  ['mas', 'grid', 'Más'],
];
const FAB_ITEMS = [
  ['quick-log', 'zap', 'Registro rápido'],
  ['new-doc', 'receipt', 'Nueva venta', 'venta'],
  ['pay', 'cash', 'Registrar pago'],
  ['new-doc', 'clipboard', 'Nuevo pedido', 'pedido'],
  ['new-doc', 'quote', 'Nueva cotización', 'cotizacion'],
  ['new-client', 'userPlus', 'Nuevo cliente'],
  ['new-task', 'calendar', 'Programar tarea'],
];
const PH_NAV = [
  ['ph', 'home', 'Resumen'],
  ['ph-ventas', 'receipt', 'Ventas'],
  ['ph-proveedores', 'users', 'Proveedores', 'Proveed.'],
  ['ph-productos', 'package', 'Productos', 'Catálogo'],
  ['mas', 'grid', 'Más'],
];
const PH_FAB = [
  ['ph-new-sale', 'receipt', 'Venta Alegría'],
  ['ph-new-purchase', 'package', 'Compra a proveedor'],
  ['ph-note', 'message', 'Anotar conversación con proveedor'],
  ['ph-new-supplier', 'userPlus', 'Nuevo proveedor'],
  ['ph-new-product', 'plus', 'Nuevo producto'],
];
const NAV_ORDER = ['hoy', 'clientes', 'ventas', 'cartera', 'comisiones', 'ph', 'ph-ventas', 'ph-proveedores', 'ph-productos', 'mas'];
const GENERIC_ROUTES = ['mas', 'personalizar', 'datos', 'config', 'ayuda', 'auditoria', 'pethome'];
const isPhRoute = (n) => n === 'ph' || n.startsWith('ph-');
const SECTION = { 'ph-venta': 'ph-ventas', 'ph-proveedor': 'ph-proveedores', 'ph-perfil': 'ph', personalizar: 'mas', cliente: 'clientes', doc: 'ventas', agenda: 'mas', productos: 'mas', metas: 'mas', reportes: 'mas', datos: 'mas', config: 'mas', auditoria: 'mas', pethome: 'mas', ayuda: 'mas' };

async function render() {
  const main = $('#main');
  const r = route();
  // Las rutas deciden el modo: Alegría (ph-*) o el CRM de las empresas.
  if (isPhRoute(r.name) && ui.scope !== 'pethome') setScope('pethome');
  else if (!isPhRoute(r.name) && !GENERIC_ROUTES.includes(r.name) && ui.scope === 'pethome') setScope(ui.lastCrmScope || 'todas');
  renderChrome();
  renderGreeting();
  const sec = SECTION[r.name] || r.name;
  const focusKey = document.activeElement?.dataset?.phCost ? `[data-ph-cost="${document.activeElement.dataset.phCost}"]` : document.activeElement?.dataset?.phPrice ? `[data-ph-price="${document.activeElement.dataset.phPrice}"]` : null;
  $$('[data-nav-item]').forEach((a) => a.classList.toggle('active', a.dataset.navItem === sec));
  $$('button[data-scope]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scope === ui.scope)));
  document.body.dataset.activeScope = ui.scope;
  let html;
  try {
    switch (r.name) {
      case 'hoy': html = renderHome(); break;
      case 'agenda': html = renderAgenda(r.params); break;
      case 'clientes': html = renderClients(r.params); break;
      case 'cliente': html = renderClient(r.id); break;
      case 'ventas': html = renderSales(r.params); break;
      case 'doc': html = renderDocument(r.id); break;
      case 'cartera': html = renderCartera(r.params); break;
      case 'comisiones': html = renderCommissions(r.params); break;
      case 'mas': html = renderMore(); break;
      case 'productos': html = renderProducts(r.params); break;
      case 'metas': html = renderGoals(); break;
      case 'reportes': html = renderReports(r.params); break;
      case 'datos': html = await renderData(); break;
      case 'config': html = renderConfig(); break;
      case 'personalizar': html = renderPersonalize(); break;
      case 'ph': html = renderPhHome(r.params); break;
      case 'ph-ventas': html = renderPhSales(r.params); break;
      case 'ph-venta': html = renderPhSale(r.id); break;
      case 'ph-proveedores': html = renderPhSuppliers(); break;
      case 'ph-proveedor': html = renderPhSupplier(r.id); break;
      case 'ph-productos': html = renderPhProducts(r.params); break;
      case 'ph-perfil': html = renderPhProfile(); break;
      case 'pethome': html = renderPetHome(); break;
      case 'auditoria': html = renderAudit(); break;
      case 'ayuda': html = renderHelp(); break;
      default: html = renderHome();
    }
  } catch (e) {
    console.error(e);
    html = `<div class="notice warn">No se pudo mostrar esta pantalla: ${esc(e.message)}. Tus datos no se modificaron.</div>`;
  }
  const y = r.name === lastRoute ? window.scrollY : 0;
  const changed = `${r.name}/${r.id}` !== lastKey;
  const fromName = lastRoute;
  const fromId = lastKey.split('/')[1];
  const prevCount = $('.hero-amount[data-count]', main)?.dataset.count;
  const apply = () => {
    main.innerHTML = html;
    // Al volver de una ficha, la tarjeta del cliente recibe la ficha que se encoge.
    if (r.name === 'clientes' && fromName === 'cliente') markMorph($(`.client-card a[href="#/cliente/${fromId}"]`)?.closest('.client-card'));
    if (changed) {
      main.classList.remove('enter');
      void main.offsetWidth;
      main.classList.add('enter');
      animateCounts(main);
      animateRings(main);
    } else {
      for (const el of $$('[data-count]', main)) odometer(el, Number(el.dataset.count), { from: Number(prevCount ?? el.dataset.count) });
      animateRings(main, true);
    }
    bindTilt(main);
    window.scrollTo(0, y);
  };
  if (changed && lastKey) await swapScreen(fromName, r.name, NAV_ORDER, apply);
  else apply();
  lastKey = `${r.name}/${r.id}`;
  if (r.name !== lastRoute) main.focus({ preventScroll: true });
  lastRoute = r.name;
  syncNavPill(true);
  if (r.name === 'personalizar') afterPersonalize();
  if (focusKey) $(focusKey)?.focus({ preventScroll: true });
}

let chromeKey = '';
function renderChrome() {
  const ph = ui.scope === 'pethome';
  document.body.dataset.mode = ph ? 'pethome' : 'crm';
  if (chromeKey === (ph ? 'ph' : 'crm')) return;
  chromeKey = ph ? 'ph' : 'crm';
  const list = ph ? PH_NAV : NAV;
  $('#nav-main').innerHTML = list.map(([k, i, l]) => `<a href="#/${k}" data-nav-item="${k}">${icon(i)}<span>${l}</span></a>`).join('');
  const items = list.map(([k, i, l, sh]) => `<a href="#/${k}" data-nav-item="${k}" aria-label="${l}">${icon(i)}<span>${sh || l}</span></a>`);
  // Barra de abajo: mitad de secciones a cada lado del botón + central.
  const half = Math.floor(items.length / 2);
  $('#nav-top').innerHTML = `<div class="tb-half">${items.slice(0, half).join('')}</div><span class="tb-gap" aria-hidden="true"></span><div class="tb-half">${items.slice(half).join('')}</div>`;
  $('#fab-menu').innerHTML = (ph ? PH_FAB : FAB_ITEMS).map(([act, ic, label, kind]) => `<button type="button" data-act="${act}"${kind ? ` data-kind="${kind}"` : ''}>${icon(ic)}${label}</button>`).join('');
  greetKey = '';
}

/** Saludo con el resumen del día y el contador de vencidos en Cartera. */
let greetKey = '';
function renderGreeting() {
  const ph = ui.scope === 'pethome';
  const h = new Date().getHours();
  const hello = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const name = (S().settings.sellerName || '').trim().split(/\s+/)[0];
  const ag = ph ? [] : buildAgenda(S(), 'todas').filter((x) => x.type === 'cobro');
  const today = ag.filter((x) => x.days <= 0).length;
  const late = ag.filter((x) => x.days < 0).length;
  const sub = ph ? 'Alegría Pet Home' : today ? `${today} cobro${today === 1 ? '' : 's'} para hoy` : 'Sin cobros pendientes hoy';
  // En Hoy y en el Resumen la pantalla ya saluda: arriba va el nombre de la app.
  const home = ['hoy', 'ph'].includes(route().name);
  const key = `${ph}|${hello}|${name}|${sub}|${late}|${home}`;
  if (key === greetKey) return;
  greetKey = key;
  const brand = $('.brand.mobile-only');
  const title = home ? (ph ? 'Alegría Pet Home' : 'Mi Centro Comercial') : `${hello}${name ? `, ${name}` : ''}`;
  const line = home && ph ? 'Tu tienda de mascotas' : sub;
  if (brand) brand.innerHTML = `${ph ? phLogo(34) : monogram(34)}<div class="greet"><b>${esc(title)}</b><small>${esc(line)}</small></div>`;
  for (const a of $$('[data-nav-item="cartera"]')) {
    a.querySelector('.nav-badge')?.remove();
    if (late) a.insertAdjacentHTML('beforeend', `<i class="nav-badge" aria-label="${late} vencidos">${late > 99 ? '99+' : late}</i>`);
  }
}
let lastRoute = '';
let lastKey = '';

const reduceMotion = () => !ui.motion || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function animateCounts(root) {
  for (const el of $$('[data-count]', root)) {
    if (el.classList.contains('hero-amount')) {
      odometer(el, Number(el.dataset.count) || 0);
      continue;
    }
    const to = Number(el.dataset.count) || 0;
    if (reduceMotion() || !to) {
      el.textContent = money(to);
      continue;
    }
    const t0 = performance.now();
    const dur = 900;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = money(Math.round(to * e));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

function animateRings(root, instant = false) {
  for (const c of $$('[data-ring]', root)) {
    const pct = Math.max(0, Math.min(100, Number(c.dataset.ring) || 0));
    const len = Number(c.getAttribute('stroke-dasharray'));
    const target = len * (1 - pct / 100);
    if (instant || reduceMotion()) c.style.strokeDashoffset = target;
    else requestAnimationFrame(() => requestAnimationFrame(() => (c.style.strokeDashoffset = target)));
  }
}

/** Celebración dorada (umbral superado, meta cumplida). */
function celebrate(title, text) {
  sparkle(title, text);
}

/** Detecta logros nuevos tras cada cambio (umbral superado, meta del mes). */
let achievements = null;
function achievementSnapshot(st) {
  const period = localDate().slice(0, 7);
  const out = { unlocks: new Set(Object.keys(st.unlocks || {})), goals: new Set() };
  for (const co of ACTIVE_COMPANY_IDS) {
    const g = st.settings.goals?.[co]?.sales || 0;
    if (g && periodMetrics(st, co, period).salesTotal >= g) out.goals.add(co);
  }
  return out;
}
function checkAchievements(reason) {
  const now = achievementSnapshot(S());
  if (achievements && reason === 'commit') {
    for (const k of now.unlocks) if (!achievements.unlocks.has(k) && k.startsWith('nogal:')) celebrate('¡Umbral superado!', 'Frutos del Nogal pasó los $70 M este mes. Desde aquí, todo lo que vendas comisiona.');
    for (const co of now.goals) if (!achievements.goals.has(co)) celebrate('¡Meta cumplida!', `Alcanzaste la meta de ventas del mes en ${S().companies[co].name}.`);
  }
  achievements = now;
}

/* ---------- Acciones (delegación de eventos) ---------- */
const handlers = {
  search: () => openSearch(),
  async shared() {
    let payload = null;
    try {
      const cache = await caches.open('share-inbox');
      const res = await cache.match(new URL('__compartido', document.baseURI).href);
      if (res) payload = await res.json();
      await cache.delete(new URL('__compartido', document.baseURI).href);
    } catch {
      /* sin caché disponible */
    }
    if (!payload) return toast('No llegó nada para crear el cliente. Intenta compartir de nuevo.', 'error');
    if (payload.pdf) {
      let file = null;
      try {
        const cache = await caches.open('share-inbox');
        const key = new URL('__compartido_pdf', document.baseURI).href;
        const res = await cache.match(key);
        if (res) file = await res.blob();
        await cache.delete(key);
      } catch {
        /* sin caché */
      }
      if (file) return clientForm(null, { rutFile: file, sourceText: 'RUT recibido por WhatsApp (PDF)', companyId: ui.scope !== 'todas' && ui.scope !== 'pethome' ? ui.scope : 'puntazo' });
    }
    const vcf = payload.files.find((f) => /vcard|directory/i.test(f.type) || /\.vcf$/i.test(f.name) || /BEGIN:VCARD/i.test(f.text));
    const raw = vcf ? vcf.text : [payload.title, payload.text, payload.url, ...payload.files.map((f) => f.text)].filter(Boolean).join('\n');
    const prefill = parseContactText(raw);
    const source = vcf ? `Contacto compartido${prefill.tradeName ? `: ${prefill.tradeName}` : ''}` : [payload.title, payload.text].filter(Boolean).join('\n');
    clientForm(null, { prefill, sourceText: source, companyId: ui.scope !== 'todas' && ui.scope !== 'pethome' ? ui.scope : 'puntazo' });
    if (!prefill.phone && !prefill.tradeName) toast('No encontré nombre ni número en lo compartido. Completa los datos a mano.', 'error');
  },
  'why-comm': (el) => {
    const x = explainCommission(S(), el.dataset.id);
    if (x) openModal({ title: x.title, subtitle: 'Así se calculó, paso a paso.', body: x.body, cancelText: 'Cerrar' });
  },
  'new-client': () => clientForm(),
  'edit-client': (el) => clientForm(S().clients.find((c) => c.id === el.dataset.client)),
  'new-doc': (el) => documentForm(el.dataset.kind, { clientId: el.dataset.client }),
  'edit-doc': (el) => {
    const d = S().documents.find((x) => x.id === el.dataset.doc);
    documentForm(d.kind, { edit: d });
  },
  convert: (el) => documentForm(el.dataset.to, { convertFrom: S().documents.find((x) => x.id === el.dataset.doc) }),
  pay: (el) => paymentForm({ documentId: el.dataset.doc || null, clientId: el.dataset.client || null }),
  apply: (el) => paymentForm({ paymentId: el.dataset.id }),
  dispatch: (el) => dispatchForm(S().documents.find((x) => x.id === el.dataset.doc)),
  activity: (el) => activityForm({ clientId: el.dataset.client, documentId: el.dataset.doc || null, type: el.dataset.type || (el.dataset.doc ? 'llamada' : 'llamada'), companyId: ui.scope !== 'todas' ? ui.scope : null }),
  wa: (el) => whatsappComposer({ clientId: el.dataset.client, documentId: el.dataset.doc || null, template: el.dataset.tpl || null, activityId: el.dataset.activity || null, companyId: ui.scope !== 'todas' ? ui.scope : null }),
  'new-task': (el) => taskForm({ clientId: el.dataset.client || null }),
  recovery: (el) => {
    const c = S().clients.find((x) => x.id === el.dataset.client);
    taskForm({ clientId: c.id, type: 'recuperacion', title: `Recuperar a ${c.tradeName}` });
  },
  'new-product': (el) => productForm(null, el.dataset.co),
  async 'load-catalog'() {
    const n = await exec(loadNogalCatalog, {});
    if (n !== null) toast(`${n} producto(s) cargados en Frutos del Nogal`);
  },
  'share-prices': (el) => sharePriceList(el.dataset.co),
  'share-quote': (el) => whatsappComposer({ clientId: S().documents.find((d) => d.id === el.dataset.doc).clientId, documentId: el.dataset.doc, presetText: quoteText(S(), S().documents.find((d) => d.id === el.dataset.doc)) }),
  print: () => window.print(),
  'set-name': () =>
    openModal({
      title: '¿Cómo te llamas?',
      subtitle: 'Para saludarte y firmar tus cotizaciones y mensajes.',
      body: field({ name: 'name', label: 'Tu nombre', value: S().settings.sellerName, required: true, placeholder: 'Ej. Julián Ortiz' }),
      onSubmit: async (fd) => ((await exec(updateSettings, { sellerName: fd.get('name') }, { success: 'Listo' })) === null ? false : undefined),
    }),
  'quick-log': (el) => quickLogForm({ clientId: el.dataset.client || '' }),
  repeat: (el) => {
    const d = S().documents.find((x) => x.id === el.dataset.doc);
    documentForm('pedido', { prefill: d });
  },
  async 'doc-pdf'(el) {
    const d = S().documents.find((x) => x.id === el.dataset.doc);
    try {
      const bytes = documentPdf(S(), d);
      const client = S().clients.find((c) => c.id === d.clientId);
      const r = await sharePdf(bytes, `${d.number} ${client?.tradeName || ''}.pdf`.replace(/[\\/:*?"<>|]/g, ''), `${{ cotizacion: 'Cotización', pedido: 'Pedido', venta: 'Venta' }[d.kind]} ${d.number}`);
      if (r === 'downloaded') toast('PDF descargado. Búscalo en Descargas para enviarlo.');
    } catch (e) {
      toast(`No se pudo crear el PDF: ${e.message}`, 'error');
    }
  },
  async 'commission-pdf'(el) {
    try {
      const co = el.dataset.co;
      const bytes = commissionReportPdf(S(), co, el.dataset.period);
      const r = await sharePdf(bytes, `Comisiones ${S().companies[co].name} ${el.dataset.period}.pdf`, `Informe de comisiones ${el.dataset.period}`);
      if (r === 'downloaded') toast('Informe descargado.');
    } catch (e) {
      toast(`No se pudo crear el informe: ${e.message}`, 'error');
    }
  },
  async 'remove-logo'(el) {
    if (await confirmDialog({ title: 'Quitar logo', message: '¿Quitar el logo de los PDF de esta empresa?', confirmText: 'Quitar' })) await exec(updateSettings, { companyProfile: { companyId: el.dataset.co, logo: null } }, { success: 'Logo quitado' });
  },
  'edit-product': (el) => productForm(S().products.find((p) => p.id === el.dataset.id)),
  async status(el) {
    const st = el.dataset.status;
    if (st === 'cancelado') {
      const reason = await confirmDialog({ title: 'Cancelar documento', message: 'El documento quedará cancelado (no se borra).', reason: true, confirmText: 'Cancelar documento', danger: true });
      if (reason) await exec(changeStatus, { documentId: el.dataset.doc, status: st, reason }, { success: 'Documento cancelado' });
    } else await exec(changeStatus, { documentId: el.dataset.doc, status: st }, { success: 'Estado actualizado' });
  },
  async deliver(el) {
    openModal({ title: 'Confirmar entrega', body: field({ name: 'date', label: 'Fecha de entrega', type: 'date', value: localDate(), required: true }) + field({ name: 'notes', label: 'Quién recibió / notas', type: 'textarea' }), submitText: 'Confirmar entrega', onSubmit: async (fd) => ((await exec(confirmDelivery, { documentId: el.dataset.doc, date: fd.get('date'), notes: fd.get('notes') }, { success: 'Entrega confirmada' })) ? undefined : false) });
  },
  async due(el) {
    const d = S().documents.find((x) => x.id === el.dataset.doc);
    openModal({ title: `Cambiar vencimiento · ${esc(d.number)}`, subtitle: `Vencimiento actual: ${d.dueDate}`, body: field({ name: 'dueDate', label: 'Nueva fecha de vencimiento', type: 'date', value: d.dueDate, required: true }) + field({ name: 'reason', label: 'Motivo del cambio', type: 'textarea', required: true }), onSubmit: async (fd) => ((await exec(changeDueDate, { documentId: d.id, dueDate: fd.get('dueDate'), reason: fd.get('reason') }, { success: 'Vencimiento actualizado' })) ? undefined : false) });
  },
  async void(el) {
    const reason = await confirmDialog({ title: 'Anular venta', message: 'La venta quedará anulada con su motivo (no se borra), saldrá de la cartera y su comisión se reversará. Si tiene pagos aplicados, primero reversa o libera esos pagos.', reason: true, confirmText: 'Anular venta', danger: true });
    if (reason) await exec(voidSale, { documentId: el.dataset.doc, reason }, { success: 'Venta anulada' });
  },
  async reverse(el) {
    const p = S().payments.find((x) => x.id === el.dataset.id);
    const reason = await confirmDialog({ title: `Reversar pago ${p.number}`, message: `Se reversará el pago de ${money(p.amount)}: el saldo de las ventas vuelve a quedar pendiente y las comisiones asociadas se reversan (o se ajustan si ya se pagaron). El registro se conserva.`, reason: true, confirmText: 'Reversar pago', danger: true });
    if (reason) await exec(reversePayment, { paymentId: p.id, reason }, { success: 'Pago reversado' });
  },
  async unapply(el) {
    const reason = await confirmDialog({ title: 'Liberar asignación', message: 'El valor vuelve a "sin aplicar" en el mismo pago y la comisión asociada se reversa. Úsalo para corregir a qué venta se aplicó.', reason: true, confirmText: 'Liberar' });
    if (reason) await exec(unapplyAllocation, { paymentId: el.dataset.id, allocationId: el.dataset.alloc, reason }, { success: 'Asignación liberada' });
  },
  async 'client-status'(el) {
    const c = S().clients.find((x) => x.id === el.dataset.client);
    openModal({ title: 'Cambiar estado del cliente', subtitle: 'Desactivar no borra el historial.', body: field({ name: 'status', label: 'Estado', type: 'select', value: c.status, options: Object.entries(CLIENT_STATUSES).map(([value, label]) => ({ value, label })) }) + field({ name: 'reason', label: 'Motivo (opcional)' }), onSubmit: async (fd) => ((await exec(setClientStatus, { id: c.id, status: fd.get('status'), reason: fd.get('reason') }, { success: 'Estado actualizado' })) ? undefined : false) });
  },
  async 'confirm-policy'(el) {
    const ok = await confirmDialog({ title: 'Confirmar política de comisiones', message: 'Confirmo que la política mostrada (umbral de $70 M antes de IVA, la venta del cruce comisiona solo el excedente, sin retroactividad, cobro solo de ventas elegibles y sujeto al umbral del mes del recaudo, base antes de IVA) coincide con lo acordado con Frutos del Nogal.', confirmText: 'Confirmo' });
    if (ok) await exec(confirmPolicy, { companyId: el.dataset.co }, { success: 'Política confirmada' });
  },
  async settle(el) {
    const ids = $$('[data-comm]:checked').map((i) => i.dataset.comm);
    if (!ids.length) return toast('Selecciona comisiones pendientes en la tabla.', 'error');
    const total = S().commissions.filter((c) => ids.includes(c.id)).reduce((a, c) => a + c.amount, 0);
    const ok = await confirmDialog({ title: 'Crear liquidación', message: `Se liquidarán ${ids.length} comisión(es) por ${money(total)}. Quedarán "liquidadas" hasta que registres que te las pagaron.`, confirmText: 'Liquidar' });
    if (ok) await exec(createSettlement, { companyId: el.dataset.co, commissionIds: ids, requestId: requestId() }, { success: 'Liquidación creada' });
  },
  'settle-paid': (el) => openModal({ title: 'Registrar pago de la liquidación', body: field({ name: 'date', label: 'Fecha en que te pagaron', type: 'date', value: localDate(), required: true }) + field({ name: 'reference', label: 'Referencia (nómina, transferencia…)' }), onSubmit: async (fd) => ((await exec(markSettlementPaid, { settlementId: el.dataset.id, date: fd.get('date'), reference: fd.get('reference') }, { success: 'Liquidación pagada' })) ? undefined : false) }),
  async 'settle-cancel'(el) {
    const reason = await confirmDialog({ title: 'Anular liquidación', message: 'Las comisiones vuelven a "pendiente de liquidar".', reason: true, confirmText: 'Anular', danger: true });
    if (reason) await exec(cancelSettlement, { settlementId: el.dataset.id, reason }, { success: 'Liquidación anulada' });
  },
  'edit-rules': (el) => rulesForm(el.dataset.co),
  'edit-goals': () => goalsForm(),
  export: (el) => exportData(el.dataset.what, { scope: ui.scope, period: el.dataset.period || null, companyId: el.dataset.co || null }),
  template: (el) => {
    if (el.dataset.what === 'clientes') download('plantilla-clientes.csv', toCSV(['nombre', 'razon_social', 'nit', 'contacto', 'telefono', 'whatsapp', 'correo', 'departamento', 'ciudad', 'direccion', 'categoria', 'empresa', 'plazo', 'observaciones'], [['Piñatería Ejemplo', 'Ejemplo SAS', '900123456-7', 'Ana Pérez', '3001234567', '', 'ana@ejemplo.com', 'Antioquia', 'Medellín', 'Cra 50 # 10-20', 'Mayorista', 'El Puntazo', '30', '']]), 'text/csv;charset=utf-8');
    else download('plantilla-productos.csv', toCSV(['codigo', 'nombre', 'presentacion', 'categoria', 'precio', 'iva'], [['ALM-500', 'Almendra entera', 'Bolsa 500 g', 'Frutos secos', '18500', '5']]), 'text/csv;charset=utf-8');
  },
  async backup() {
    const now = new Date().toISOString();
    download(`mi-centro-comercial-copia-${localDate()}.json`, makeBackup(S(), now), 'application/json');
    await run(updateSettings, { lastBackupAt: now });
    toast('Copia descargada. Guárdala en un lugar seguro.');
  },
  'migration-seen': () => exec(updateSettings, { migrationSeen: true }),
  'download-v1': () => {
    const raw = localStorage.getItem(V1_KEY);
    if (!raw) return toast('No se encontraron datos de la versión 1 en este navegador (revisa las instantáneas).', 'error');
    download(`mi-centro-comercial-v1-original-${localDate()}.json`, raw, 'application/json');
  },
  async 'snap-restore'(el) {
    const snap = (await listSnapshots()).find((x) => x.id === el.dataset.id);
    if (!snap) return;
    const ok = await confirmDialog({ title: 'Restaurar instantánea', message: `Se reemplazarán los datos actuales por la instantánea del ${formatDateTime(snap.at)} (${snap.reason}). Antes se guarda una instantánea del estado actual.`, confirmText: 'Restaurar', danger: true });
    if (!ok) return;
    try {
      const r = readBackup(snap.kind === 'v1' ? snap.data : makeBackup(JSON.parse(snap.data)));
      await replaceState(r.state, `restaurar instantánea ${snap.at}`);
      toast('Instantánea restaurada');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  },
  async 'snap-download'(el) {
    const snap = (await listSnapshots()).find((x) => x.id === el.dataset.id);
    if (snap) download(`instantanea-${snap.at.slice(0, 10)}.json`, snap.kind === 'v1' ? snap.data : makeBackup(JSON.parse(snap.data)), 'application/json');
  },
  async 'clear-all'() {
    const ok = await confirmDialog({ title: 'Borrar todos los datos', message: 'Se borrarán clientes, ventas, pagos y comisiones de este dispositivo. Se guardará una instantánea interna antes.', confirmText: 'Borrar todo', danger: true, typeToConfirm: 'BORRAR' });
    if (!ok) return;
    await replaceState(emptyState(), 'borrar todos los datos');
    toast('Datos borrados. Puedes recuperarlos desde Instantáneas.');
  },
  async notifications() {
    if (!('Notification' in window)) return toast('Este navegador no admite avisos.', 'error');
    const p = await Notification.requestPermission();
    if (p === 'granted') {
      await exec(updateSettings, { notifications: true }, { success: 'Avisos activados (con la app abierta)' });
      notifyIfNeeded(true);
    } else toast('No se concedió el permiso de avisos.', 'error');
  },
};

const PH = () => S().pethome;
const phSale = (id) => PH().sales.find((x) => x.id === id);
async function sharePhPdf(bytes, name, title) {
  const r = await sharePdf(bytes, name.replace(/[\\/:*?"<>|]/g, ''), title);
  if (r === 'downloaded') toast('PDF descargado. Búscalo en Descargas para enviarlo.');
}
function phWhatsApp(sale) {
  const pf = PH().profile;
  const t = saleTotals(sale);
  const first = sale.customerName.split(/\s+/)[0];
  const text = t.balance
    ? `Hola ${first}, te comparto la cuenta de cobro ${sale.number} de ${pf.brand}. Total ${money(t.total)}${t.paid ? `, abonado ${money(t.paid)}` : ''}. Saldo pendiente: ${money(t.balance)}.${pf.payInfo ? `\nPuedes pagar a: ${pf.payInfo}` : ''}\n¡Gracias por tu compra! 🐾`
    : `Hola ${first}, confirmamos el pago total de tu compra ${sale.number} en ${pf.brand} por ${money(t.total)}. ¡Gracias! 🐾`;
  const phone = normalizePhone(sale.customerPhone);
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}
/** Trae el logo publicado en la tienda Shopify (si el CDN lo permite). */
async function logoFromShopify() {
  const url = PH().profile.logoUrl;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const logo = await imageToJpeg(await res.blob(), 480);
    await exec(updatePhProfile, { logo }, { success: 'Logo de Alegría guardado' });
  } catch {
    toast('No pude traer el logo desde Shopify en este momento. Descárgalo de tu tienda y súbelo con "Subir imagen".', 'error');
  }
}
Object.assign(handlers, {
  async 'ph-load-catalog'() {
    const r = await exec(loadPetHomeCatalog, {});
    if (r) toast(`${r.added} producto(s) cargados${r.costs ? ` · ${r.costs} costo(s) recuperados` : ''}${r.suppliers ? ` · ${r.suppliers} proveedor(es) de la versión anterior` : ''}`);
    if (r && !PH().profile.logo) logoFromShopify();
  },
  'ph-new-sale': () => {
    if (!PH().products.length) toast('Tip: carga primero tus productos de Shopify desde el Resumen.', 'ok');
    phSaleForm();
  },
  'ph-repeat': (el) => phSaleForm(phSale(el.dataset.id)),
  'ph-pay': (el) => phPaymentForm(el.dataset.id, async (p) => {
    const sale = phSale(el.dataset.id);
    toast(`Abono de ${money(p.amount)} registrado`, 'ok', { action: { label: 'Recibo PDF', icon: 'file', onClick: () => sharePhPdf(paymentReceiptPdf(S(), phSale(sale.id), phSale(sale.id).payments.find((x) => x.id === p.id)), `Recibo ${p.number} ${sale.customerName}.pdf`, `Recibo ${p.number}`) } });
  }),
  async 'ph-charge-pdf'(el) {
    const sale = phSale(el.dataset.id);
    if (!PH().profile.issuerName) toast('Completa en "Mis datos para cobrar" el titular del RUT para que salga en la cuenta.', 'error');
    try {
      await sharePhPdf(chargeAccountPdf(S(), sale), `Cuenta de cobro ${sale.number} ${sale.customerName}.pdf`, `Cuenta de cobro ${sale.number}`);
    } catch (e) {
      toast(`No se pudo crear el PDF: ${e.message}`, 'error');
    }
  },
  async 'ph-receipt-pdf'(el) {
    const sale = phSale(el.dataset.id);
    const pays = sale.payments.filter((p) => p.status === 'activo');
    const p = el.dataset.pay ? sale.payments.find((x) => x.id === el.dataset.pay) : pays[pays.length - 1];
    if (!p) return toast('Esta venta no tiene abonos.', 'error');
    try {
      await sharePhPdf(paymentReceiptPdf(S(), sale, p), `Recibo ${p.number} ${sale.customerName}.pdf`, `Recibo ${p.number}`);
    } catch (e) {
      toast(`No se pudo crear el PDF: ${e.message}`, 'error');
    }
  },
  'ph-wa': (el) => phWhatsApp(phSale(el.dataset.id)),
  async 'ph-void-sale'(el) {
    const reason = await confirmDialog({ title: 'Anular venta', message: 'La venta queda anulada con su motivo (no se borra) y sus abonos también.', reason: true, confirmText: 'Anular', danger: true });
    if (reason) await exec(voidPhSale, { saleId: el.dataset.id, reason }, { success: 'Venta anulada' });
  },
  async 'ph-void-pay'(el) {
    const reason = await confirmDialog({ title: 'Anular abono', message: 'El abono queda anulado (no se borra) y el saldo vuelve a quedar pendiente.', reason: true, confirmText: 'Anular abono', danger: true });
    if (reason) await exec(voidPhPayment, { saleId: el.dataset.id, paymentId: el.dataset.pay, reason }, { success: 'Abono anulado' });
  },
  'ph-new-supplier': () => phSupplierForm(),
  'ph-edit-supplier': (el) => phSupplierForm(PH().suppliers.find((x) => x.id === el.dataset.id)),
  'ph-note': (el) => {
    const id = el.dataset.id || (route().name === 'ph-proveedor' ? route().id : null) || PH().suppliers[0]?.id;
    if (!id) return toast('Primero crea un proveedor.', 'error');
    phNoteForm(id);
  },
  'ph-note-done': (el) => exec(completeSupplierFollowUp, { noteId: el.dataset.id }, { success: 'Seguimiento hecho' }),
  'ph-new-purchase': (el) => phPurchaseForm(el.dataset.id || (route().name === 'ph-proveedor' ? route().id : null)),
  'ph-purchase-pay': (el) => phPurchasePayForm(el.dataset.id),
  'ph-new-product': () => phProductForm(),
  'ph-edit-product': (el) => phProductForm(PH().products.find((x) => x.id === el.dataset.id)),
  'ph-logo-shopify': () => logoFromShopify(),
  'ph-logo-remove': () => exec(updatePhProfile, { logo: null }, { success: 'Logo quitado' }),
});

const pz = personalizeHandlers(() => render());
for (const k of ['set-theme', 'set-palette', 'set-text', 'home-move', 'home-reset', 'photo-remove', 'pin-setup', 'pin-remove', 'bio-on', 'bio-off']) handlers[k] = pz[k];

/** Reduce una imagen a JPEG (fondo blanco) para el logo de los PDF. */
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
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
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

function sharePriceList(co) {
  const items = S().products.filter((p) => p.companyId === co && p.active).sort((a, b) => (a.category || '').localeCompare(b.category || '', 'es') || a.name.localeCompare(b.name, 'es'));
  if (!items.length) return toast('No hay productos activos para enviar.', 'error');
  const text = priceListText(S(), co, items);
  openModal({
    title: 'Lista de precios',
    subtitle: 'Edítala antes de enviarla. Puedes copiarla o abrir WhatsApp sin elegir contacto.',
    body: field({ name: 'text', label: 'Mensaje', type: 'textarea', value: text, full: true, attrs: 'rows="14"' }) + '<div class="wa-actions"><a class="btn btn-wa" data-wa-free target="_blank" rel="noopener">Abrir WhatsApp</a><button type="button" class="btn btn-plain" data-copy-text>Copiar</button></div>',
    cancelText: 'Cerrar',
    onOpen: (f) => {
      const ta = $('[name=text]', f);
      const a = $('[data-wa-free]', f);
      const upd = () => (a.href = `https://wa.me/?text=${encodeURIComponent(ta.value)}`);
      ta.addEventListener('input', upd);
      upd();
      $('[data-copy-text]', f).addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(ta.value);
          toast('Lista copiada');
        } catch {
          ta.select();
        }
      });
    },
  });
}

function rulesForm(co) {
  const r = S().rules[co];
  const body = r.kind === 'recaudo'
    ? `<div class="grid2">${field({ name: 'saleBps', label: 'Comisión por venta (%)', value: bpsToPct(r.saleBps) })}${field({ name: 'collectionBps', label: 'Comisión por cobro (%)', value: bpsToPct(r.collectionBps) })}</div>`
    : `<div class="grid2">${field({ name: 'threshold', label: 'Umbral mensual (COP)', type: 'money', value: r.thresholdPesos })}${field({ name: 'thresholdBase', label: 'Base del umbral', type: 'select', value: r.thresholdBase, options: [{ value: 'neto_antes_iva', label: 'Ventas antes de IVA' }, { value: 'total', label: 'Ventas con IVA' }] })}${field({ name: 'm_sale', label: 'Mayorista: venta (%)', value: bpsToPct(r.modes.mayorista.saleBps) })}${field({ name: 'm_col', label: 'Mayorista: cobro (%)', value: bpsToPct(r.modes.mayorista.collectionBps) })}${field({ name: 'n_sale', label: 'Normal: venta (%)', value: bpsToPct(r.modes.normal.saleBps) })}${field({ name: 'n_col', label: 'Normal: cobro (%)', value: bpsToPct(r.modes.normal.collectionBps) })}</div><div class="notice warn">Cambiar las reglas de Frutos del Nogal exige volver a confirmar la política antes de liquidar.</div>`;
  openModal({
    title: `Reglas de comisión · ${S().companies[co].name}`,
    subtitle: 'Solo afecta operaciones futuras.',
    body: body + field({ name: 'reason', label: 'Motivo del cambio', type: 'textarea', required: true, full: true }),
    wide: true,
    onOpen: (f) => bindMoneyPreviews(f),
    onSubmit: async (fd) => {
      const bp = (k) => {
        const v = pctToBps(fd.get(k));
        if (!Number.isFinite(v) || v < 0 || v > 10000) {
          toast('Revisa los porcentajes.', 'error');
          throw new Error('pct');
        }
        return v;
      };
      const patch = r.kind === 'recaudo' ? { saleBps: bp('saleBps'), collectionBps: bp('collectionBps') } : { thresholdPesos: readMoney(fd, 'threshold', { label: 'El umbral' }), thresholdBase: fd.get('thresholdBase'), modes: { mayorista: { saleBps: bp('m_sale'), collectionBps: bp('m_col') }, normal: { saleBps: bp('n_sale'), collectionBps: bp('n_col') } } };
      return (await exec(updateRules, { companyId: co, patch, reason: fd.get('reason') }, { success: 'Reglas actualizadas' })) === null ? false : undefined;
    },
  });
}

function goalsForm() {
  const g = S().settings.goals;
  openModal({
    title: 'Metas mensuales',
    subtitle: 'Se aplican a cada mes. No alteran ventas ni comisiones.',
    wide: true,
    body: `<div class="grid2">${ACTIVE_COMPANY_IDS.map((co) => field({ name: `s_${co}`, label: `${S().companies[co].name}: meta de ventas`, type: 'money', value: g[co]?.sales || '' }) + field({ name: `c_${co}`, label: `${S().companies[co].name}: meta de recaudo`, type: 'money', value: g[co]?.collection || '' })).join('')}</div>`,
    onOpen: (f) => bindMoneyPreviews(f),
    onSubmit: async (fd) => {
      const goals = Object.fromEntries(ACTIVE_COMPANY_IDS.map((co) => [co, { sales: readMoney(fd, `s_${co}`, { required: false, label: 'La meta' }), collection: readMoney(fd, `c_${co}`, { required: false, label: 'La meta' }) }]));
      return (await exec(setGoals, { goals }, { success: 'Metas guardadas' })) === null ? false : undefined;
    },
  });
}

function toggleFab(force) {
  const menu = $('#fab-menu');
  const open = force ?? !menu.classList.contains('open');
  menu.classList.toggle('open', open);
  menu.hidden = false;
  menu.setAttribute('aria-hidden', String(!open));
  menu.inert = !open;
  $('[data-fab]').setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('fab-open', open);
}

document.addEventListener('click', async (e) => {
  const navA = e.target.closest('#nav-top a, #nav-main a');
  if (navA) bounce(navA);
  const card = e.target.closest('.client-card a.cc-main');
  if (card) markMorph(card.closest('.client-card'));
  if (e.target.closest('.fab-scrim')) return toggleFab(false);
  const scopeBtn = e.target.closest('button[data-scope]');
  if (scopeBtn) {
    const to = scopeBtn.dataset.scope;
    const r = route();
    setScope(to);
    if (to === 'pethome') navigate(isPhRoute(r.name) ? location.hash : '#/ph');
    else if (isPhRoute(r.name)) navigate('#/hoy');
    else render();
    return;
  }
  if (e.target.closest('[data-search]')) return openSearch();
  if (e.target.closest('[data-discreet]')) {
    ui.privacy = !ui.privacy;
    savePrefs();
    syncDiscreet();
    toast(ui.privacy ? 'Montos ocultos' : 'Montos visibles');
    return;
  }
  const fab = e.target.closest('[data-fab]');
  if (fab) {
    toggleFab();
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el) {
    if (!e.target.closest('#fab-menu')) toggleFab(false);
    return;
  }
  toggleFab(false);
  const act = el.dataset.act;
  try {
    if (await handleAgendaAction(act, el)) return;
    await handlers[act]?.(el);
  } catch (err) {
    if (err?.message !== 'pct') console.warn(err);
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.matches('[data-nav]')) return navigate(t.value);
  if (t.matches('[data-photo]')) return pz.photo(t);
  if (t.matches('[data-ph-cost],[data-ph-price]')) {
    const id = t.dataset.phCost || t.dataset.phPrice;
    const p = S().pethome.products.find((x) => x.id === id);
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
    } catch (e) {
      toast(`No se pudo usar esa imagen: ${e.message}`, 'error');
    }
    return;
  }
  if (t.matches('[data-ph-import]') && t.files?.[0]) {
    const file = t.files[0];
    t.value = '';
    try {
      const r = await exec(importShopifyOrders, { text: await file.text() });
      if (r) openModal({ title: 'Pedidos de Shopify', body: `<p><b>${r.added}</b> pedido(s) nuevos por ${money(r.total)}.</p>${r.skipped.length ? `<p class="muted small">${r.skipped.length} omitido(s): ${esc(r.skipped.slice(0, 20).join(' · '))}</p>` : ''}${r.unmatched.length ? `<div class="notice warn">Estos productos no están en tu lista (quedaron sin costo): ${esc(r.unmatched.join(', '))}</div>` : ''}`, cancelText: 'Cerrar' });
    } catch {
      /* exec ya mostró el error */
    }
    return;
  }
  if (t.matches('[data-toggle]')) return pz.toggle(t);
  if (t.matches('[data-home-toggle]')) return pz.homeToggle(t);
  if (t.matches('[data-lock-minutes]')) return pz.lockMinutes(t);
  if (t.matches('[data-check-all]')) {
    $$('[data-comm]').forEach((c) => (c.checked = t.checked));
    updateSelectedSum();
    return;
  }
  if (t.matches('[data-comm]')) return updateSelectedSum();
  if (t.id === 'client-status') {
    clientQuery.status = t.value;
    $('#client-results').innerHTML = clientResults();
  }
  if (t.id === 'client-cat') {
    clientQuery.category = t.value;
    $('#client-results').innerHTML = clientResults();
  }
  if (t.id === 'sales-status') {
    salesQuery.status = t.value;
    $('#sales-results').innerHTML = salesResults(t.dataset.kind);
  }
  if (t.id === 'cart-city') {
    carteraQuery.city = t.value;
    $('#cartera-results').innerHTML = carteraResults();
  }
  if (t.matches('[data-logo]') && t.files?.[0]) {
    const file = t.files[0];
    t.value = '';
    try {
      const logo = await imageToJpeg(file, 480);
      await exec(updateSettings, { companyProfile: { companyId: t.dataset.logo, logo } }, { success: 'Logo guardado' });
    } catch (e) {
      toast(`No se pudo usar esa imagen: ${e.message}`, 'error');
    }
    return;
  }
  if (t.matches('[data-import]') && t.files?.[0]) {
    const file = t.files[0];
    t.value = '';
    await handleImport(t.dataset.import, file, t.dataset.co);
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'client-q') {
    clientQuery.q = t.value;
    $('#client-results').innerHTML = clientResults();
  } else if (t.id === 'sales-q') {
    salesQuery.q = t.value;
    $('#sales-results').innerHTML = salesResults(t.dataset.kind);
  } else if (t.id === 'ph-prod-q' || t.id === 'ph-sim') {
    phProductQuery.q = $('#ph-prod-q').value;
    phProductQuery.sim = Math.max(0, Math.min(90, Number(String($('#ph-sim').value).replace(',', '.')) || 0));
    $('#ph-prod-list').innerHTML = phProductRows();
  } else if (t.id === 'prod-q') {
    const q = t.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    let shown = 0;
    $$('[data-prod-card]').forEach((c) => {
      const ok = !q || q.split(/\s+/).every((w) => c.dataset.search.includes(w));
      c.hidden = !ok;
      shown += ok ? 1 : 0;
    });
    const em = $('#prod-empty');
    if (em) em.hidden = shown > 0;
  } else if (t.id === 'cart-q' || t.id === 'cart-days' || t.id === 'cart-min') {
    carteraQuery.q = $('#cart-q').value;
    carteraQuery.minDays = $('#cart-days').value;
    carteraQuery.minValue = $('#cart-min').value;
    $('#cartera-results').innerHTML = carteraResults();
  }
});

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  const fd = new FormData(f);
  if (f.dataset.form === 'general') {
    await exec(updateSettings, {
      sellerName: fd.get('sellerName'),
      defaultTermDays: Number(fd.get('defaultTermDays')),
      agingBuckets: String(fd.get('agingBuckets')).split(',').map((x) => x.trim()).filter(Boolean),
      inactivity: { noPurchaseDays: Number(fd.get('noPurchaseDays')), noContactDays: Number(fd.get('noContactDays')) },
      creditLimitBlocks: Object.fromEntries(ACTIVE_COMPANY_IDS.map((co) => [co, !!fd.get(`block_${co}`)])),
    }, { success: 'Configuración guardada' }).catch(() => {});
  } else if (f.dataset.form === 'profile') {
    const pf = Object.fromEntries(['legalName', 'nit', 'phone', 'email', 'address', 'city', 'quoteTerms'].map((k) => [k, fd.get(k)]));
    await exec(updateSettings, { companyProfile: { companyId: f.dataset.co, ...pf } }, { success: 'Datos guardados' }).catch(() => {});
  } else if (f.dataset.form === 'ph-profile') {
    await exec(updatePhProfile, Object.fromEntries(['brand', 'issuerName', 'issuerId', 'phone', 'email', 'city', 'web', 'payInfo', 'taxNote', 'minMarginPct'].map((k) => [k, fd.get(k)])), { success: 'Datos guardados' }).catch(() => {});
  } else if (f.dataset.form === 'templates') {
    const waTemplates = {};
    for (const [k, v] of fd.entries()) if (k.startsWith('tpl_')) waTemplates[k.slice(4)] = v;
    await exec(updateSettings, { waTemplates }, { success: 'Plantillas guardadas' }).catch(() => {});
  }
});

function updateSelectedSum() {
  const ids = $$('[data-comm]:checked').map((i) => i.dataset.comm);
  const total = S().commissions.filter((c) => ids.includes(c.id)).reduce((a, c) => a + c.amount, 0);
  const el = $('[data-selected-sum]');
  if (el) el.textContent = ids.length ? `${ids.length} seleccionada(s) · ${money(total)}` : '';
}

async function handleImport(kind, file, co) {
  try {
    const text = await file.text();
    if (kind === 'backup') {
      const r = readBackup(text);
      const c = r.state;
      const ok = await confirmDialog({ title: 'Restaurar copia', message: `${r.kind === 'v1' ? 'Copia de la versión 1 (se migrará). ' : ''}La copia${r.exportedAt ? ` del ${formatDateTime(r.exportedAt)}` : ''} contiene ${c.clients.length} clientes, ${c.documents.length} documentos y ${c.payments.length} pagos. Reemplazará los datos actuales (se guarda una instantánea antes).`, confirmText: 'Restaurar', danger: true });
      if (!ok) return;
      await replaceState(c, 'restaurar copia de archivo');
      toast('Copia restaurada correctamente');
      return;
    }
    const rows = parseCSV(text);
    if (rows.length < 2) return toast('El archivo no tiene filas de datos.', 'error');
    if (kind === 'clients') {
      const items = rowsToClients(rows, $('#import-co')?.value || 'puntazo');
      let added = 0;
      const skipped = [];
      for (const it of items) {
        if (!it.data.tradeName) {
          skipped.push(`fila ${it.row}: sin nombre`);
          continue;
        }
        try {
          await run(createClient, it.data);
          added++;
        } catch (e) {
          skipped.push(`fila ${it.row}: ${e.message}`);
        }
      }
      showImportReport(added, skipped);
    } else if (kind === 'products') {
      const items = rowsToProducts(rows, co);
      let added = 0;
      const skipped = [];
      for (const it of items) {
        if (!Number.isSafeInteger(it.data.price)) {
          skipped.push(`fila ${it.row}: precio no válido`);
          continue;
        }
        if (S().products.some((p) => p.companyId === co && ((it.data.code && p.code === it.data.code) || p.name.toLowerCase() === it.data.name.toLowerCase()))) {
          skipped.push(`fila ${it.row}: ya existe "${it.data.name}"`);
          continue;
        }
        try {
          await run(saveProduct, it.data);
          added++;
        } catch (e) {
          skipped.push(`fila ${it.row}: ${e.message}`);
        }
      }
      showImportReport(added, skipped);
    }
  } catch (e) {
    toast(errorMessage(e), 'error');
  }
}

function showImportReport(added, skipped) {
  openModal({ title: 'Resultado de la importación', body: `<p><b>${added}</b> registro(s) agregados.</p>${skipped.length ? `<p>${skipped.length} omitido(s):</p><ul class="simple small">${skipped.slice(0, 100).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`, cancelText: 'Cerrar' });
}

function notifyIfNeeded(force = false) {
  try {
    if (!S().settings.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
    const key = 'mcc_last_notice';
    if (!force && localStorage.getItem(key) === localDate()) return;
    const urgent = buildAgenda(S(), 'todas').filter((x) => x.days <= 0);
    if (!urgent.length) return;
    new Notification('Mi Centro Comercial', { body: `Tienes ${urgent.length} pendiente(s) vencido(s) o para hoy.`, icon: 'icons/icon-192.png' });
    localStorage.setItem(key, localDate());
  } catch {
    /* avisos opcionales */
  }
}

function shell() {
  $('[data-fab]').innerHTML = icon('plus', { size: 26 });
  $$('[data-search]').forEach((b) => (b.innerHTML = b.classList.contains('side-search') ? `${icon('search', { size: 18 })}<span>Buscar</span><kbd>/</kbd>` : icon('search')));
  $$('[data-monogram]').forEach((el) => (el.outerHTML = monogram(Number(el.dataset.monogram))));
  renderChrome();
  syncDiscreet();
}

function syncDiscreet() {
  document.body.classList.toggle('discreet', ui.privacy);
  const b = $('[data-discreet]');
  if (b) {
    b.setAttribute('aria-pressed', String(ui.privacy));
    b.innerHTML = icon(ui.privacy ? 'eyeOff' : 'eye');
    b.title = ui.privacy ? 'Mostrar montos' : 'Ocultar montos';
    b.setAttribute('aria-label', b.title);
  }
}

const bootStart = performance.now();
const SHORTCUTS = { compartido: ['shared'], venta: ['new-doc', 'venta'], pedido: ['new-doc', 'pedido'], cotizacion: ['new-doc', 'cotizacion'], cobro: ['pay'], registro: ['quick-log'], buscar: ['search'], alegria: ['ph-new-sale'] };
/** Atajos del ícono de la app (mantener presionado): #/hoy?do=venta, etc. */
async function runShortcut() {
  const r = route();
  const sc = SHORTCUTS[r.params.get('do')];
  if (!sc) return;
  history.replaceState(null, '', sc[0] === 'ph-new-sale' ? '#/ph' : '#/hoy');
  if (sc[0] === 'ph-new-sale') render();
  await whenUnlocked();
  const el = document.createElement('button');
  if (sc[1]) el.dataset.kind = sc[1];
  handlers[sc[0]]?.(el);
}

const lockProfile = () => ({ name: (S().settings.sellerName || '').trim().split(/\s+/)[0], avatar: userAvatar(72) });

async function boot() {
  applyAppearance();
  paintGrain();
  bindRipple();
  setSections(SECTION);
  window.addEventListener('resize', () => syncNavPill(false));
  shell();
  try {
    const r = await initStore();
    if (r.source === 'migrated') toast('Tus datos de la versión anterior se migraron. Revisa el informe en Datos.');
    await dailySnapshot(S());
    requestPersistentStorage();
  } catch (e) {
    $('#main').innerHTML = `<div class="notice warn"><b>No se pudieron cargar los datos.</b> ${esc(e.message)}. No se ha modificado nada. Cierra otras pestañas de la app y vuelve a intentar.</div>`;
    return;
  }
  subscribe((_s, reason) => {
    render();
    checkAchievements(reason);
  });
  window.addEventListener('hashchange', () => {
    if (route().params.get('do')) runShortcut();
    render();
  });
  if (ui.lock) showLock(lockProfile());
  watchLock(lockProfile);
  await render();
  bindGestures({
    fire: (act, clientId) => {
      const el = document.createElement('button');
      el.dataset.client = clientId;
      handlers[act]?.(el);
    },
    sections: () => ({ list: (ui.scope === 'pethome' ? PH_NAV : NAV).map((x) => x[0]), current: route().name }),
    canPull: () => ['hoy', 'ph'].includes(route().name),
    onRefresh: async () => {
      lastKey = '';
      await render();
      haptic(HAPTIC.ok);
    },
  });
  checkAchievements('init');
  runShortcut();
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest('input,textarea,select,[contenteditable]') && !document.body.classList.contains('modal-open')) {
      e.preventDefault();
      openSearch();
    }
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyAppearance);
  const splash = $('#splash');
  setTimeout(() => {
    splash?.classList.add('hide');
    setTimeout(() => splash?.remove(), 600);
  }, Math.max(0, 650 - (performance.now() - bootStart)));
  notifyIfNeeded();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && notifyIfNeeded());
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

boot();
