// Punto de entrada: arranque, navegación y manejo de acciones.
import { localDate, formatDateTime } from './core/dates.js';
import { pctToBps, bpsToPct } from './core/money.js';
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
import { $, $$, bindMoneyPreviews, confirmDialog, download, errorMessage, esc, exec, field, money, openModal, readMoney, requestId, toast } from './ui/dom.js';
import { exportData } from './ui/exports.js';
import { activityForm, clientForm, dispatchForm, documentForm, paymentForm, productForm, taskForm, whatsappComposer } from './ui/forms.js';
import { navigate, route, savePrefs, setScope, ui } from './ui/state.js';
import { icon, monogram } from './ui/icons.js';
import { periodMetrics } from './domain/metrics.js';
import { carteraQuery, carteraResults, renderCartera } from './ui/views-cartera.js';
import { clientQuery, clientResults, renderClient, renderClients } from './ui/views-clients.js';
import { renderCommissions } from './ui/views-commissions.js';
import { handleAgendaAction, renderAgenda, renderHome } from './ui/views-home.js';
import { renderAudit, renderConfig, renderData, renderGoals, renderHelp, renderMore, renderPetHome, renderProducts, renderReports } from './ui/views-more.js';
import { renderDocument, renderSales, salesQuery, salesResults } from './ui/views-sales.js';

const S = () => getState();
const NAV = [
  ['hoy', 'home', 'Hoy'],
  ['clientes', 'users', 'Clientes'],
  ['ventas', 'receipt', 'Ventas'],
  ['cartera', 'wallet', 'Cartera'],
  ['comisiones', 'coins', 'Comisiones'],
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
const SECTION = { cliente: 'clientes', doc: 'ventas', agenda: 'mas', productos: 'mas', metas: 'mas', reportes: 'mas', datos: 'mas', config: 'mas', auditoria: 'mas', pethome: 'mas', ayuda: 'mas' };

async function render() {
  const main = $('#main');
  const r = route();
  const sec = SECTION[r.name] || r.name;
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
  main.innerHTML = html;
  // Entrada suave y números que "cuentan" solo al cambiar de pantalla.
  if (changed) {
    main.classList.remove('enter');
    void main.offsetWidth;
    main.classList.add('enter');
    animateCounts(main);
    animateRings(main);
  } else {
    for (const el of $$('[data-count]', main)) el.textContent = money(Number(el.dataset.count));
    animateRings(main, true);
  }
  lastKey = `${r.name}/${r.id}`;
  if (r.name !== lastRoute) main.focus({ preventScroll: true });
  window.scrollTo(0, y);
  lastRoute = r.name;
}
let lastRoute = '';
let lastKey = '';

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function animateCounts(root) {
  for (const el of $$('[data-count]', root)) {
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
  const wrap = document.createElement('div');
  wrap.className = 'celebrate';
  const bits = reduceMotion() ? '' : Array.from({ length: 26 }, (_, i) => `<i style="--x:${Math.round(Math.cos(i) * (90 + (i % 5) * 30))}px;--y:${Math.round(Math.sin(i * 1.7) * (110 + (i % 4) * 35))}px;--r:${i * 47}deg;animation-delay:${(i % 6) * 0.04}s;${i % 3 ? '' : 'background:#f6efdd;'}"></i>`).join('');
  wrap.innerHTML = `${bits}<div class="msg" role="status"><b>${esc(title)}</b>${esc(text)}</div>`;
  document.body.appendChild(wrap);
  navigator.vibrate?.([20, 60, 30]);
  wrap.addEventListener('click', () => wrap.remove());
  setTimeout(() => wrap.remove(), 3600);
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

document.addEventListener('click', async (e) => {
  const scopeBtn = e.target.closest('button[data-scope]');
  if (scopeBtn) {
    setScope(scopeBtn.dataset.scope);
    render();
    return;
  }
  if (e.target.closest('[data-discreet]')) {
    ui.privacy = !ui.privacy;
    savePrefs();
    syncDiscreet();
    toast(ui.privacy ? 'Montos ocultos' : 'Montos visibles');
    return;
  }
  const fab = e.target.closest('[data-fab]');
  if (fab) {
    $('#fab-menu').hidden = !$('#fab-menu').hidden;
    fab.setAttribute('aria-expanded', String(!$('#fab-menu').hidden));
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el) {
    if (!e.target.closest('#fab-menu')) $('#fab-menu').hidden = true;
    return;
  }
  $('#fab-menu').hidden = true;
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

// Algunos hostings gratuitos (p. ej. "Powered by Netlify") ponen un botón fijo
// abajo. Se detecta y se mide para dejarle espacio a las barras y botones.
const APP_NODES = new Set(['modal-root', 'toast-root']);
function measureHostOverlay() {
  let offset = 0;
  for (const el of document.body.children) {
    if (el.classList.contains('app') || APP_NODES.has(el.id) || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK'].includes(el.tagName) || el.classList.contains('skip')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    const fixedLike = cs.position === 'fixed' || cs.position === 'sticky';
    if (fixedLike && r.height > 0 && r.height < 200 && r.bottom > window.innerHeight - 120) offset = Math.max(offset, Math.ceil(window.innerHeight - r.top + 6));
  }
  if (!offset && /\.netlify\.app$/.test(location.hostname)) offset = 64;
  document.body.style.setProperty('--host-badge', `${Math.min(offset, 140)}px`);
}
function watchHostOverlays() {
  measureHostOverlay();
  new MutationObserver(measureHostOverlay).observe(document.body, { childList: true });
  [500, 1500, 4000, 8000].forEach((t) => setTimeout(measureHostOverlay, t));
  window.addEventListener('resize', measureHostOverlay);
}

function shell() {
  const nav = NAV.map(([k, i, l]) => `<a href="#/${k}" data-nav-item="${k}">${icon(i)}<span>${l}</span></a>`).join('');
  $('#nav-main').innerHTML = nav;
  $('#nav-top').innerHTML = nav;
  $('#fab-menu').innerHTML = FAB_ITEMS.map(([act, ic, label, kind]) => `<button type="button" data-act="${act}"${kind ? ` data-kind="${kind}"` : ''}>${icon(ic)}${label}</button>`).join('');
  $('[data-fab]').innerHTML = icon('plus', { size: 26 });
  $$('[data-monogram]').forEach((el) => (el.outerHTML = monogram(Number(el.dataset.monogram))));
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
async function boot() {
  shell();
  watchHostOverlays();
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
  window.addEventListener('hashchange', render);
  await render();
  checkAchievements('init');
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
