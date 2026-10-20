// Pantallas de Alegría Pet Home: resumen del mes, ventas y cuentas de cobro,
// proveedores (términos y bitácora), productos y márgenes, y datos del emisor.
import { addDays, formatDate, formatDateTime, localDate, periodLabel, previousPeriod } from '../core/dates.js';
import { PH_CHANNELS, PH_METHODS, PH_NOTE_CHANNELS, phMonthSummary, productMargin, purchaseTotals, saleTotals } from '../domain/pethome.js';
import { normalizePhone, telLink } from '../domain/whatsapp.js';
import { getState } from '../store/store.js';
import { empty, esc, money, pill, stat } from './dom.js';
import { icon } from './icons.js';

const S = () => getState();
const P = () => S().pethome;
const pct = (v) => (v === null || v === undefined ? '—' : `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(v)} %`);
const supplierName = (id) => P().suppliers.find((x) => x.id === id)?.name || '';

export function phLogo(size = 44) {
  const lg = P().profile.logo;
  return lg?.dataUrl ? `<img class="ph-logo" src="${lg.dataUrl}" width="${size}" height="${size}" alt="Alegría Pet Home" style="width:${size}px;height:${size}px">` : `<span class="ph-logo ph-logo-empty" style="width:${size}px;height:${size}px" aria-hidden="true">🐾</span>`;
}

function head(eyebrow, title, action = '') {
  return `<div class="page-head ph-head"><div class="ph-title">${phLogo(46)}<div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1></div></div>${action}</div>`;
}

function marginPill(p, min) {
  const m = productMargin(p);
  if (m.pct === null) return '<span class="pill warn">Sin costo</span>';
  return `<span class="pill ${m.pct < min ? 'danger' : m.pct < min + 10 ? 'warn' : 'ok'}">${pct(m.pct)}</span>`;
}

function saleCard(x) {
  const t = saleTotals(x);
  const st = x.status === 'anulada' ? pill('Anulada', 'danger') : t.balance === 0 ? pill('Pagada', 'ok') : t.paid ? pill('Abonada', 'warn') : pill('Debe', 'danger');
  return `<article class="card ph-sale"><a class="card-main" href="#/ph-venta/${x.id}"><div class="card-title">${esc(x.customerName)} ${st}</div>
    <div class="card-sub">${esc(x.number)} · ${formatDate(x.date)} · ${esc(PH_CHANNELS[x.channel] || '')}${x.externalRef ? ` · ${esc(x.externalRef)}` : ''}</div>
    <div class="card-meta"><span>Total <b>${money(t.total)}</b></span>${t.balance && x.status === 'activa' ? `<span class="danger">Saldo <b>${money(t.balance)}</b></span>` : ''}<span>Ganancia <b>${t.knownCost ? money(t.profit) : '—'}</b></span></div></a>
    ${x.status === 'activa' && t.balance ? `<div class="card-actions"><button class="btn btn-primary btn-xs" data-act="ph-pay" data-id="${x.id}">Registrar abono</button><button class="btn btn-plain btn-xs" data-act="ph-charge-pdf" data-id="${x.id}">Cuenta de cobro</button>${normalizePhone(x.customerPhone) ? `<button class="btn btn-wa btn-xs" data-act="ph-wa" data-id="${x.id}">WhatsApp</button>` : ''}</div>` : ''}
  </article>`;
}

/* ---------------- Resumen ---------------- */
export function renderPhHome(params) {
  const st = P();
  const today = localDate();
  const period = params.get('p') || today.slice(0, 7);
  const m = phMonthSummary(S(), period);
  if (!st.products.length && !st.sales.length) {
    return `${head('Tu emprendimiento', 'Alegría Pet Home')}
    <section class="panel ph-welcome"><h2>Bienvenido a tu espacio de Alegría</h2><p>Aquí llevas tus ventas, lo que te deben, tus proveedores y el margen de cada producto. Está separado de El Puntazo y Frutos del Nogal.</p>
    <ol class="ph-steps"><li><b>Carga tus productos</b>: traigo los 69 productos de tu tienda Shopify con su precio. Si tenías costos o proveedores en la versión anterior, también los rescato.</li><li><b>Pon los costos</b> en Productos para ver tu margen real.</li><li><b>Completa tus datos</b> (titular del RUT, Nequi o cuenta) para las cuentas de cobro.</li></ol>
    <div class="row-gap"><button class="btn btn-primary" data-act="ph-load-catalog">${icon('package', { size: 18 })} Cargar mis productos de Shopify</button><a class="btn btn-plain" href="#/ph-perfil">Mis datos para cobrar</a></div></section>`;
  }
  const prev = previousPeriod(period, 1);
  const next = previousPeriod(period, -1);
  const follow = st.notes.filter((n) => n.followUp && !n.done && n.followUp <= addDays(today, 7)).sort((a, b) => a.followUp.localeCompare(b.followUp)).slice(0, 5);
  return `${head(periodLabel(period), 'Alegría Pet Home', '<button class="btn btn-primary" data-act="ph-new-sale">＋ Venta</button>')}
  <div class="month-nav"><a class="btn btn-plain btn-small" href="#/ph?p=${prev}">‹ ${esc(periodLabel(prev))}</a>${period < today.slice(0, 7) ? `<a class="btn btn-plain btn-small" href="#/ph?p=${next}">${esc(periodLabel(next))} ›</a>` : ''}</div>
  <section class="hero ph-hero"><div class="hero-top"><div><div class="hero-label">Ganancia de ${esc(periodLabel(period).split(' ')[0])}</div><div class="hero-amount" ${m.profitSales ? `data-count="${m.profit}"` : ''}>${m.profitSales ? money(m.profit) : '—'}</div>
    <div class="hero-sub">Vendiste <b>${money(m.revenue)}</b> en ${m.count} venta(s)${m.marginPct !== null ? ` · margen <b>${pct(m.marginPct)}</b>` : ''}</div></div></div>
    ${m.unknownSales ? `<div class="hero-foot"><a class="hero-chip" href="#/ph-productos?f=sincosto">${icon('alert', { size: 14 })} ${m.unknownSales} venta(s) con productos sin costo no se cuentan en la ganancia</a></div>` : ''}</section>
  <div class="stats">
    ${stat('Vendido', money(m.revenue), `${m.count} venta(s)`)}
    ${stat('Costo de lo vendido', money(m.cogs), m.missingCostLines ? 'Faltan costos' : 'Productos')}
    ${stat('Cobrado en el mes', money(m.collected), 'Pagos recibidos')}
    ${stat('Te deben', money(m.receivable), `${m.debtors.length} persona(s)`, m.receivable ? 'warn' : '')}
    ${stat('Debes a proveedores', money(m.payable), `${m.payables.length} compra(s)`)}
    ${stat('Compraste en el mes', money(m.purchased), 'A proveedores')}
  </div>
  ${m.debtors.length ? `<section class="panel"><div class="panel-head"><h2>Te deben</h2><a class="btn btn-plain btn-small" href="#/ph-ventas?f=debe">Ver todas</a></div><div class="cards">${m.debtors.slice(0, 6).map((r) => saleCard(r.x)).join('')}</div></section>` : ''}
  ${(m.noCost || m.lowMargin.length) ? `<section class="panel"><h2>Revisa tus márgenes</h2>${m.noCost ? `<div class="notice warn">${m.noCost} producto(s) no tienen costo. <a href="#/ph-productos?f=sincosto">Ponerles costo</a></div>` : ''}${m.lowMargin.length ? `<p class="muted small">Por debajo de tu margen mínimo (${pct(st.settings.minMarginPct)}):</p><ul class="simple">${m.lowMargin.slice(0, 6).map((p) => `<li><button class="link" data-act="ph-edit-product" data-id="${p.id}">${esc(p.name)}</button> ${marginPill(p, st.settings.minMarginPct)}</li>`).join('')}</ul>` : ''}</section>` : ''}
  <div class="two-col">
    <section class="panel"><h2>Lo más vendido del mes</h2>${m.products.length ? `<ol class="rank">${m.products.slice(0, 8).map((x) => `<li><span>${esc(x.name)} <small class="muted">× ${x.qty}</small></span><b>${money(x.revenue)}</b></li>`).join('')}</ol>` : '<p class="muted">Aún no hay ventas este mes.</p>'}</section>
    <section class="panel"><h2>Por canal</h2>${Object.keys(m.byChannel).length ? `<ul class="simple kv">${Object.entries(m.byChannel).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<li><span>${esc(PH_CHANNELS[k] || k)}</span><b>${money(v)}</b></li>`).join('')}</ul>` : '<p class="muted">Sin ventas.</p>'}
      <h3>Seguimientos con proveedores</h3>${follow.length ? `<ul class="simple">${follow.map((n) => `<li><a href="#/ph-proveedor/${n.supplierId}">${esc(supplierName(n.supplierId))}</a><small>${formatDate(n.followUp)} · ${esc(n.summary.slice(0, 80))}</small></li>`).join('')}</ul>` : '<p class="muted small">Nada pendiente.</p>'}</section>
  </div>`;
}

/* ---------------- Ventas ---------------- */
export function renderPhSales(params) {
  const st = P();
  const f = params.get('f') || 'todas';
  const q = (params.get('q') || '').toLowerCase();
  let list = [...st.sales].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  if (f === 'debe') list = list.filter((x) => x.status === 'activa' && saleTotals(x).balance > 0);
  if (f === 'pagadas') list = list.filter((x) => x.status === 'activa' && saleTotals(x).balance === 0);
  if (f === 'shopify') list = list.filter((x) => x.channel === 'shopify');
  if (q) list = list.filter((x) => `${x.customerName} ${x.number} ${x.externalRef}`.toLowerCase().includes(q));
  const tabs = { todas: 'Todas', debe: 'Me deben', pagadas: 'Pagadas', shopify: 'Shopify' };
  return `${head('Alegría Pet Home', 'Ventas y cobros', '<button class="btn btn-primary" data-act="ph-new-sale">＋ Venta</button>')}
  <div class="chips">${Object.entries(tabs).map(([k, l]) => `<a class="chip ${f === k ? 'active' : ''}" href="#/ph-ventas?f=${k}">${l}</a>`).join('')}</div>
  <section class="panel ph-import"><div><b>${icon('file', { size: 16 })} Cuadrar con Shopify</b><p class="muted small">En Shopify: Pedidos → Exportar → "Todos los pedidos" en CSV. Sube aquí ese archivo: la app crea las ventas que falten (sin duplicar), con su costo y ganancia.</p></div><label class="btn btn-plain btn-small">Subir pedidos de Shopify (CSV)<input type="file" accept=".csv,text/csv" data-ph-import hidden></label></section>
  ${list.length ? `<div class="cards">${list.slice(0, 300).map(saleCard).join('')}</div>` : empty('🐾', f === 'todas' ? 'Aún no hay ventas de Alegría' : 'Nada en este filtro', 'Registra la venta a un amigo o importa tus pedidos de Shopify.', '<button class="btn btn-primary" data-act="ph-new-sale">＋ Registrar venta</button>')}`;
}

export function renderPhSale(id) {
  const x = P().sales.find((v) => v.id === id);
  if (!x) return empty('🔍', 'Venta no encontrada', '', '<a class="btn btn-primary" href="#/ph-ventas">Volver</a>');
  const t = saleTotals(x);
  const active = x.status === 'activa';
  return `${head(`<a href="#/ph-ventas">Ventas</a> · ${esc(x.number)}`, esc(x.customerName))}
  ${x.status === 'anulada' ? `<div class="notice warn">Venta anulada: ${esc(x.voided?.reason || '')}</div>` : ''}
  <div class="action-bar">
    ${active && t.balance ? `<button class="btn btn-primary" data-act="ph-pay" data-id="${x.id}">Registrar abono</button>` : ''}
    <button class="btn btn-secondary" data-act="ph-charge-pdf" data-id="${x.id}">📄 Cuenta de cobro</button>
    ${x.payments.some((p) => p.status === 'activo') ? `<button class="btn btn-secondary" data-act="ph-receipt-pdf" data-id="${x.id}">🧾 Recibo de pago</button>` : ''}
    ${normalizePhone(x.customerPhone) ? `<button class="btn btn-wa" data-act="ph-wa" data-id="${x.id}">WhatsApp</button>` : ''}
    <button class="btn btn-plain" data-act="ph-repeat" data-id="${x.id}">Repetir venta</button>
    ${active ? `<button class="btn btn-plain" data-act="ph-void-sale" data-id="${x.id}">Anular</button>` : ''}
  </div>
  <div class="stats">${stat('Total', money(t.total), `${formatDate(x.date)} · ${esc(PH_CHANNELS[x.channel])}`)}${stat('Pagado', money(t.paid))}${stat('Saldo', money(t.balance), x.dueDate ? `Pagar antes del ${formatDate(x.dueDate)}` : '', t.balance ? 'warn' : '')}${stat('Ganancia', t.knownCost ? money(t.profit) : '—', t.knownCost ? `Margen ${pct(t.marginPct)}` : 'Falta el costo de algún producto')}</div>
  <section class="panel"><h2>Detalle</h2><div class="table-wrap"><table><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Costo</th><th>Subtotal</th><th>Ganancia</th></tr></thead><tbody>
    ${x.lines.map((l) => `<tr><td>${esc(l.description)}</td><td>${l.qty}</td><td>${money(l.unitPrice)}</td><td>${Number.isSafeInteger(l.unitCost) ? money(l.unitCost) : '<span class="pill warn">sin costo</span>'}</td><td>${money(Math.round(l.unitPrice * l.qty))}</td><td>${Number.isSafeInteger(l.unitCost) ? money(Math.round((l.unitPrice - l.unitCost) * l.qty)) : '—'}</td></tr>`).join('')}
  </tbody><tfoot>${x.discount ? `<tr><td colspan="4">Descuento</td><td>− ${money(x.discount)}</td><td></td></tr>` : ''}${x.shipping || x.shippingCost ? `<tr><td colspan="4">Domicilio (cobrado ${money(x.shipping)} · pagado ${money(x.shippingCost)})</td><td>${money(x.shipping)}</td><td>${money(x.shipping - x.shippingCost)}</td></tr>` : ''}<tr><td colspan="4"><b>Total</b></td><td><b>${money(t.total)}</b></td><td><b>${t.knownCost ? money(t.profit) : '—'}</b></td></tr></tfoot></table></div>
  ${x.notes ? `<p class="pre muted">${esc(x.notes)}</p>` : ''}</section>
  <section class="panel"><h2>Abonos</h2>${x.payments.length ? `<ul class="simple">${x.payments.map((p) => `<li><span><b>${money(p.amount)}</b> · ${formatDate(p.date)} · ${esc(PH_METHODS[p.method] || p.method)} · ${esc(p.number)}${p.note ? ` · ${esc(p.note)}` : ''}${p.status === 'anulado' ? ` ${pill('Anulado', 'danger')}` : ''}</span>${p.status === 'activo' ? `<span class="row-gap" style="margin:0"><button class="btn btn-plain btn-xs" data-act="ph-receipt-pdf" data-id="${x.id}" data-pay="${p.id}">Recibo</button><button class="btn btn-plain btn-xs" data-act="ph-void-pay" data-id="${x.id}" data-pay="${p.id}">Anular</button></span>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Sin abonos todavía.</p>'}</section>
  <p class="muted small">Contacto: ${esc([x.customerPhone, x.customerId ? `C.C./NIT ${x.customerId}` : ''].filter(Boolean).join(' · ') || '—')} · Registrada ${formatDateTime(x.createdAt)}</p>`;
}

/* ---------------- Proveedores ---------------- */
export function renderPhSuppliers() {
  const st = P();
  const list = [...st.suppliers].sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name, 'es') : a.status === 'activo' ? -1 : 1));
  return `${head('Alegría Pet Home', 'Proveedores', '<button class="btn btn-primary" data-act="ph-new-supplier">＋ Proveedor</button>')}
  ${list.length ? `<div class="cards">${list.map((x) => {
    const owed = st.purchases.filter((p) => p.supplierId === x.id && p.status === 'activa').reduce((a, p) => a + purchaseTotals(p).balance, 0);
    const last = st.notes.filter((n) => n.supplierId === x.id).sort((a, b) => b.at.localeCompare(a.at))[0];
    const nProd = st.products.filter((p) => p.supplierId === x.id).length;
    return `<article class="card"><a class="card-main" href="#/ph-proveedor/${x.id}"><div class="card-title">${esc(x.name)} ${x.status === 'inactivo' ? pill('Inactivo') : ''}${x.discountPct ? pill(`${x.discountPct} % dto.`, 'ok') : ''}</div>
      <div class="card-sub">${esc([x.contactName, x.city, x.sells].filter(Boolean).join(' · ')) || '&nbsp;'}</div>
      <div class="card-meta">${x.terms.paymentTerm ? `<span>Pago: ${esc(x.terms.paymentTerm)}</span>` : ''}${nProd ? `<span>${nProd} producto(s)</span>` : ''}${owed ? `<span class="danger">Le debes <b>${money(owed)}</b></span>` : ''}${last ? `<span>Últ. contacto ${formatDate(last.at.slice(0, 10))}</span>` : ''}${x.rating ? `<span>${'★'.repeat(x.rating)}</span>` : ''}</div></a>
      <div class="card-actions">${normalizePhone(x.phone) ? `<a class="btn btn-wa btn-xs" href="https://wa.me/${normalizePhone(x.phone)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}<button class="btn btn-plain btn-xs" data-act="ph-note" data-id="${x.id}">Anotar conversación</button><button class="btn btn-plain btn-xs" data-act="ph-new-purchase" data-id="${x.id}">Compra</button></div></article>`;
  }).join('')}</div>` : empty('🤝', 'Aún no tienes proveedores', 'Guarda quién te vende, sus descuentos, plazos y lo que hablan.', '<button class="btn btn-primary" data-act="ph-new-supplier">＋ Agregar proveedor</button>')}`;
}

const TERM_LABELS = { discounts: 'Descuentos', paymentTerm: 'Plazo de pago', minOrder: 'Pedido mínimo', shipping: 'Envío / flete', leadTime: 'Tiempo de entrega', credit: 'Crédito', returns: 'Devoluciones y garantía', other: 'Otros acuerdos' };

export function renderPhSupplier(id) {
  const st = P();
  const x = st.suppliers.find((v) => v.id === id);
  if (!x) return empty('🔍', 'Proveedor no encontrado', '', '<a class="btn btn-primary" href="#/ph-proveedores">Volver</a>');
  const notes = st.notes.filter((n) => n.supplierId === id).sort((a, b) => b.at.localeCompare(a.at));
  const purchases = st.purchases.filter((p) => p.supplierId === id).sort((a, b) => b.date.localeCompare(a.date));
  const prods = st.products.filter((p) => p.supplierId === id);
  const owed = purchases.filter((p) => p.status === 'activa').reduce((a, p) => a + purchaseTotals(p).balance, 0);
  const bought = purchases.filter((p) => p.status === 'activa').reduce((a, p) => a + purchaseTotals(p).total, 0);
  const terms = Object.entries(TERM_LABELS).filter(([k]) => x.terms[k]);
  return `${head(`<a href="#/ph-proveedores">Proveedores</a>`, esc(x.name), `<button class="btn btn-plain" data-act="ph-edit-supplier" data-id="${x.id}">Editar</button>`)}
  <div class="action-bar">
    ${normalizePhone(x.phone) ? `<a class="btn btn-wa" href="https://wa.me/${normalizePhone(x.phone)}" target="_blank" rel="noopener">WhatsApp</a><a class="btn btn-plain" href="${telLink(x.phone)}">Llamar</a>` : ''}
    <button class="btn btn-primary" data-act="ph-note" data-id="${x.id}">Anotar conversación</button>
    <button class="btn btn-secondary" data-act="ph-new-purchase" data-id="${x.id}">Registrar compra</button>
  </div>
  <div class="stats">${stat('Le has comprado', money(bought), `${purchases.length} compra(s)`)}${stat('Le debes', money(owed), '', owed ? 'warn' : '')}${stat('Descuento base', x.discountPct ? `${x.discountPct} %` : '—')}${stat('Productos', String(prods.length), 'De este proveedor')}</div>
  <div class="two-col">
    <section class="panel"><h2>Términos comerciales</h2>${terms.length ? `<dl class="infolist">${terms.map(([k, l]) => `<dt>${l}</dt><dd>${esc(x.terms[k])}</dd>`).join('')}</dl>` : '<p class="muted">Aún no has anotado sus condiciones. <button class="link" data-act="ph-edit-supplier" data-id="' + x.id + '">Agregarlas</button></p>'}
      <dl class="infolist">${[['Contacto', x.contactName], ['Teléfono', x.phone], ['Correo', x.email], ['Ciudad', x.city], ['Qué vende', x.sells], ['Web / catálogo', x.web]].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${x.notes ? `<p class="pre muted">${esc(x.notes)}</p>` : ''}</section>
    <section class="panel"><div class="panel-head"><h2>Bitácora</h2><button class="btn btn-plain btn-small" data-act="ph-note" data-id="${x.id}">＋ Nota</button></div>${notes.length ? `<ul class="timeline">${notes.map((n) => `<li><span class="tl-icon" aria-hidden="true">💬</span><div><div class="tl-title">${esc(PH_NOTE_CHANNELS[n.channel] || n.channel)} · ${formatDateTime(n.at)}</div><div class="tl-meta">${esc(n.summary)}${n.offer ? `<br><b>Oferta:</b> ${esc(n.offer)}` : ''}${n.followUp ? `<br>Seguimiento: ${formatDate(n.followUp)} ${n.done ? pill('Hecho', 'ok') : `<button class="btn btn-plain btn-xs" data-act="ph-note-done" data-id="${n.id}">Marcar hecho</button>`}` : ''}</div></div></li>`).join('')}</ul>` : '<p class="muted">Anota aquí con quién hablaste, qué te ofrecieron y cuándo volver a escribir.</p>'}</section>
  </div>
  <section class="panel"><h2>Compras</h2>${purchases.length ? `<div class="table-wrap"><table><thead><tr><th>N.º</th><th>Fecha</th><th>Total</th><th>Pagado</th><th>Saldo</th><th></th></tr></thead><tbody>${purchases.map((p) => { const t = purchaseTotals(p); return `<tr><td>${esc(p.number)}${p.invoiceRef ? `<small class="block">${esc(p.invoiceRef)}</small>` : ''}</td><td>${formatDate(p.date)}</td><td>${money(t.total)}</td><td>${money(t.paid)}</td><td>${p.status === 'anulada' ? pill('Anulada', 'danger') : money(t.balance)}</td><td>${p.status === 'activa' && t.balance ? `<button class="btn btn-primary btn-xs" data-act="ph-purchase-pay" data-id="${p.id}">Pagar</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted">Sin compras registradas.</p>'}</section>
  ${prods.length ? `<section class="panel"><h2>Productos que te vende</h2><ul class="simple">${prods.map((p) => `<li><button class="link" data-act="ph-edit-product" data-id="${p.id}">${esc(p.name)}</button><span>${Number.isSafeInteger(p.cost) ? `costo ${money(p.cost)}` : 'sin costo'} · ${marginPill(p, st.settings.minMarginPct)}</span></li>`).join('')}</ul></section>` : ''}`;
}

/* ---------------- Productos y márgenes ---------------- */
export const phProductQuery = { q: '', f: 'todos', sim: 0 };

export function phProductRows() {
  const st = P();
  const { q, f, sim } = phProductQuery;
  const words = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
  let list = st.products.filter((p) => p.active || f === 'inactivos');
  if (f === 'sincosto') list = list.filter((p) => !Number.isSafeInteger(p.cost));
  if (f === 'bajo') list = list.filter((p) => Number.isSafeInteger(p.cost) && productMargin(p).pct < st.settings.minMarginPct);
  if (f === 'inactivos') list = st.products.filter((p) => !p.active);
  if (words.length) list = list.filter((p) => { const h = `${p.name} ${p.category} ${p.pet}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); return words.every((w) => h.includes(w)); });
  list.sort((a, b) => (a.category || '').localeCompare(b.category || '', 'es') || a.name.localeCompare(b.name, 'es'));
  if (!list.length) return '<p class="muted">No hay productos en este filtro.</p>';
  let cat = null;
  return list.map((p) => {
    const simCost = sim && Number.isSafeInteger(p.cost) ? Math.round(p.cost * (1 - sim / 100)) : null;
    const simM = simCost !== null ? productMargin(p, p.price, simCost) : null;
    const h = p.category !== cat ? `<h3 class="ph-cat">${esc(p.category || 'Sin categoría')}</h3>` : '';
    cat = p.category;
    return `${h}<div class="ph-prod" data-row="${p.id}"><button class="ph-prod-name link" data-act="ph-edit-product" data-id="${p.id}"><b>${esc(p.name)}</b><small>${esc([p.pet, supplierName(p.supplierId), p.variants?.length ? p.variants.join(' / ') : ''].filter(Boolean).join(' · '))}</small></button>
      <label class="ph-in"><small>Costo</small><input inputmode="numeric" data-ph-cost="${p.id}" value="${Number.isSafeInteger(p.cost) ? p.cost : ''}" placeholder="—" aria-label="Costo de ${esc(p.name)}"></label>
      <label class="ph-in"><small>Precio</small><input inputmode="numeric" data-ph-price="${p.id}" value="${p.price}" aria-label="Precio de ${esc(p.name)}"></label>
      <div class="ph-m"><small>Margen</small><span data-m="${p.id}">${marginPill(p, st.settings.minMarginPct)}</span>${simM ? `<small class="ph-sim">con ${sim} %: <b>${pct(simM.pct)}</b></small>` : ''}</div></div>`;
  }).join('');
}

export function renderPhProducts(params) {
  const st = P();
  phProductQuery.f = params.get('f') || phProductQuery.f || 'todos';
  const counts = { todos: st.products.filter((p) => p.active).length, sincosto: st.products.filter((p) => p.active && !Number.isSafeInteger(p.cost)).length, bajo: st.products.filter((p) => p.active && Number.isSafeInteger(p.cost) && productMargin(p).pct < st.settings.minMarginPct).length, inactivos: st.products.filter((p) => !p.active).length };
  const labels = { todos: 'Todos', sincosto: 'Sin costo', bajo: 'Margen bajo', inactivos: 'Inactivos' };
  return `${head('Alegría Pet Home', 'Productos y márgenes', '<button class="btn btn-primary" data-act="ph-new-product">＋ Producto</button>')}
  ${!st.products.length ? '<div class="notice info">Aún no tienes productos. <button class="btn btn-primary btn-small" data-act="ph-load-catalog">Cargar mis productos de Shopify</button></div>' : ''}
  <div class="chips">${Object.entries(labels).map(([k, l]) => `<a class="chip ${phProductQuery.f === k ? 'active' : ''}" href="#/ph-productos?f=${k}">${l} <span>${counts[k]}</span></a>`).join('')}</div>
  <div class="toolbar"><div class="search"><input type="search" id="ph-prod-q" placeholder="Buscar producto o categoría" value="${esc(phProductQuery.q)}"></div>
    <label class="ph-simbox">Si el proveedor me da <input id="ph-sim" inputmode="decimal" value="${phProductQuery.sim || ''}" placeholder="0" aria-label="Descuento simulado"> % de descuento</label></div>
  <p class="muted small">Escribe el costo y el precio directo en la lista: se guarda al salir del campo. Margen mínimo deseado: <b>${pct(st.settings.minMarginPct)}</b> (cámbialo en <a href="#/ph-perfil">Mis datos</a>).</p>
  <section class="panel ph-prods" id="ph-prod-list">${phProductRows()}</section>
  ${st.products.length ? '<p class="muted small">¿Agregaste productos nuevos en Shopify? <button class="link" data-act="ph-load-catalog">Volver a cargar el catálogo</button> (no duplica).</p>' : ''}`;
}

/* ---------------- Datos del emisor ---------------- */
export function renderPhProfile() {
  const st = P();
  const pf = st.profile;
  const f = (name, label, value, attrs = '', help = '') => `<div class="field"><label for="php_${name}">${label}</label><input id="php_${name}" name="${name}" value="${esc(value)}" ${attrs}>${help ? `<small>${help}</small>` : ''}</div>`;
  return `${head('<a href="#/ph">Alegría</a> · Configuración', 'Mis datos para cobrar')}
  <section class="panel"><h2>Logo</h2><div class="profile-row">${phLogo(80)}<div><p class="muted small">Sale en las cuentas de cobro y recibos.</p><div class="row-gap"><button class="btn btn-secondary btn-small" data-act="ph-logo-shopify">Traer logo de mi Shopify</button><label class="btn btn-plain btn-small">Subir imagen<input type="file" accept="image/*" data-ph-logo hidden></label>${pf.logo ? '<button class="btn btn-plain btn-small" data-act="ph-logo-remove">Quitar</button>' : ''}</div></div></div></section>
  <form class="panel" data-form="ph-profile"><h2>Quién cobra</h2>
    <p class="muted small">Mientras Alegría se formaliza, las cuentas de cobro salen a nombre de quien tiene el RUT (tu socio). Cuando tengan empresa, cambias estos datos y listo.</p>
    <div class="grid2">
      ${f('brand', 'Nombre de la marca', pf.brand)}
      ${f('issuerName', 'Titular del RUT (quien cobra)', pf.issuerName, 'placeholder="Nombre completo de tu socio"')}
      ${f('issuerId', 'Cédula o NIT del titular', pf.issuerId, 'inputmode="numeric"')}
      ${f('phone', 'Teléfono / WhatsApp', pf.phone, 'type="tel"')}
      ${f('email', 'Correo', pf.email, 'type="email"')}
      ${f('city', 'Ciudad', pf.city)}
      ${f('web', 'Página web', pf.web)}
      ${f('minMarginPct', 'Margen mínimo deseado (%)', st.settings.minMarginPct, 'inputmode="decimal"', 'Los productos por debajo se marcan en rojo.')}
      <div class="field full"><label for="php_payInfo">Cómo te pagan</label><textarea id="php_payInfo" name="payInfo" rows="2" placeholder="Ej. Nequi 300 123 4567 · Bancolombia ahorros 123-456789-00 a nombre de …">${esc(pf.payInfo)}</textarea></div>
      <div class="field full"><label for="php_taxNote">Nota sobre impuestos</label><textarea id="php_taxNote" name="taxNote" rows="2">${esc(pf.taxNote)}</textarea><small>Hoy no cobran IVA. Cuando se formalicen y cobren IVA, actualiza esta nota.</small></div>
    </div>
    <footer class="row-gap"><button class="btn btn-primary" type="submit">Guardar</button></footer>
  </form>`;
}
