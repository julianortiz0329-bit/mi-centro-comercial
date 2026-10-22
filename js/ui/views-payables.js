// Facturas por pagar: compras a crédito con su vencimiento, cuántos días
// faltan, abonos hechos y saldo. Y el detalle de cada factura.
import { formatDate, formatDateTime, localDate } from '../core/dates.js';
import { payablesSummary } from '../domain/ledger.js';
import { PH_METHODS, purchaseTotals } from '../domain/pethome.js';
import { normalizePhone } from '../domain/whatsapp.js';
import { getState } from '../store/store.js';
import { empty, esc, money, pill, progress, stat } from './dom.js';
import { icon } from './icons.js';
import { phLogo } from './views-pethome.js';

const S = () => getState();
const accName = (id) => S().ledger.accounts.find((a) => a.id === id)?.name || null;
const payVia = (p) => accName(p.accountId) || PH_METHODS[p.method] || p.method || '';

function head(eyebrow, title, action = '') {
  return `<div class="page-head ph-head"><div class="ph-title">${phLogo(46)}<div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1></div></div>${action}</div>`;
}

/** "Vence en 5 días", "Vence hoy", "Vencida hace 3 días". */
export function dueLabel(days) {
  if (days === null || days === undefined) return 'Sin fecha de pago';
  if (days < 0) return `Vencida hace ${-days} día${days === -1 ? '' : 's'}`;
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Vence mañana';
  return `Vence en ${days} días`;
}
const TONE = { vencida: 'danger', hoy: 'danger', pronto: 'warn', al_dia: 'ok', sin_fecha: '' };

function billCard(x) {
  const paidPct = x.total ? (x.paid / x.total) * 100 : 0;
  const phone = normalizePhone(x.supplier?.phone);
  return `<article class="card bill s-${x.state}">
    <a class="card-main" href="#/compra/${x.pu.id}">
      <div class="bill-top"><span class="card-title">${esc(x.supplier?.name || 'Proveedor')}</span>${pill(dueLabel(x.days), TONE[x.state])}</div>
      <div class="card-sub">${esc(x.pu.number)}${x.pu.invoiceRef ? ` · factura ${esc(x.pu.invoiceRef)}` : ''} · comprada el ${formatDate(x.pu.date)}${x.pu.dueDate ? ` · pagar antes del <b>${formatDate(x.pu.dueDate)}</b>` : ''}</div>
      <div class="bill-nums"><span><small>Total</small><b>${money(x.total)}</b></span><span><small>Abonado</small><b>${money(x.paid)}</b></span><span class="due"><small>Saldo</small><b>${money(x.balance)}</b></span></div>
      ${progress(paidPct, paidPct >= 100 ? 'ok' : '')}
      ${x.pays.length ? `<small class="muted">${x.pays.length} abono(s) · el último ${formatDate(x.pays[x.pays.length - 1].date)}</small>` : '<small class="muted">Sin abonos todavía</small>'}
    </a>
    <div class="card-actions"><button class="btn btn-primary btn-xs" data-act="ph-purchase-pay" data-id="${x.pu.id}">Abonar</button><button class="btn btn-plain btn-xs" data-act="purchase-due" data-id="${x.pu.id}">Cambiar fecha</button>${phone ? `<a class="btn btn-wa btn-xs" href="https://wa.me/${phone}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>
  </article>`;
}

export function renderPagar(params) {
  const f = params.get('f') || 'todas';
  const sum = payablesSummary(S());
  const groups = [
    ['vencida', 'Vencidas', (x) => x.state === 'vencida'],
    ['semana', 'Vencen esta semana', (x) => x.state === 'hoy' || x.state === 'pronto'],
    ['despues', 'Más adelante', (x) => x.state === 'al_dia'],
    ['sinfecha', 'Sin fecha de pago', (x) => x.state === 'sin_fecha'],
  ];
  const tabs = { todas: 'Todas', vencida: `Vencidas${sum.overdueCount ? ` (${sum.overdueCount})` : ''}`, semana: 'Esta semana', proveedor: 'Por proveedor', abonos: 'Abonos hechos' };
  let body;
  if (f === 'proveedor') {
    body = sum.bySupplier.length ? `<div class="table-wrap"><table><thead><tr><th>Proveedor</th><th>Facturas</th><th>Saldo</th><th>Vencido</th><th>Próximo pago</th></tr></thead><tbody>${sum.bySupplier.map((r) => `<tr><td>${r.supplier ? `<a href="#/ph-proveedor/${r.supplier.id}">${esc(r.supplier.name)}</a>` : '—'}</td><td>${r.count}</td><td><b>${money(r.balance)}</b></td><td>${r.overdue ? `<b class="danger">${money(r.overdue)}</b>` : '—'}</td><td>${r.next ? formatDate(r.next) : '—'}</td></tr>`).join('')}</tbody></table></div>` : '';
  } else if (f === 'abonos') {
    body = sum.recent.length ? `<ul class="journal">${sum.recent.map(({ pu, p, supplier }) => `<li class="jr k-retiro${p.status === 'anulado' ? ' off' : ''}"><span class="jr-ico">${icon('cash', { size: 18 })}</span><span class="jr-main"><b>${esc(supplier?.name || 'Proveedor')} · ${esc(pu.number)}</b><small>${formatDate(p.date)} · desde ${esc(payVia(p))}${p.reference ? ` · ref. ${esc(p.reference)}` : ''}${p.by ? ` · por ${esc(p.by)}` : ''}${p.note ? ` · ${esc(p.note)}` : ''}</small>${p.status === 'anulado' ? `<small class="danger">Anulado: ${esc(p.voided?.reason || '')}</small>` : ''}</span><span class="jr-amt out">− ${money(p.amount)}</span></li>`).join('')}</ul>` : '';
  } else {
    const shown = groups.filter(([k]) => f === 'todas' || f === k);
    body = shown.map(([k, label, fn]) => {
      const items = sum.list.filter(fn);
      return items.length ? `<section class="bill-group g-${k}"><h2>${label} <small class="muted">${items.length} · ${money(items.reduce((a, x) => a + x.balance, 0))}</small></h2><div class="cards">${items.map(billCard).join('')}</div></section>` : '';
    }).join('');
  }
  return `${head('Compras a crédito', 'Facturas por pagar', '<button class="btn btn-primary" data-act="ph-new-purchase">＋ Compra</button>')}
  <div class="stats">
    ${stat('Debemos en total', money(sum.total), `${sum.count} factura(s)`, sum.total ? 'warn' : '')}
    ${stat('Vencido', money(sum.overdue), `${sum.overdueCount} factura(s)`, sum.overdue ? 'danger' : '')}
    ${stat('Vence en 7 días', money(sum.week), `${sum.soonCount} factura(s)`)}
  </div>
  <div class="chips">${Object.entries(tabs).map(([k, l]) => `<a class="chip ${f === k ? 'active' : ''}" href="#/pagar?f=${k}">${l}</a>`).join('')}</div>
  ${body || empty('🐾', f === 'abonos' ? 'Sin abonos en los últimos 60 días' : 'No hay facturas pendientes', f === 'abonos' ? 'Aquí aparecen los pagos que le hacen a los proveedores.' : 'Cuando registren una compra a crédito (sin pagarla toda), aparece aquí con su fecha de vencimiento.', '<button class="btn btn-primary" data-act="ph-new-purchase">＋ Registrar compra</button>')}`;
}

/* ---------------- Detalle de una compra ---------------- */
export function renderCompra(id) {
  const st = S().pethome;
  const pu = st.purchases.find((x) => x.id === id);
  if (!pu) return empty('🔍', 'Compra no encontrada', '', '<a class="btn btn-primary" href="#/pagar">Volver</a>');
  const sup = st.suppliers.find((x) => x.id === pu.supplierId);
  const t = purchaseTotals(pu);
  const active = pu.status === 'activa';
  const days = pu.dueDate && t.balance > 0 ? Math.round((new Date(`${pu.dueDate}T12:00:00`) - new Date(`${localDate()}T12:00:00`)) / 86400000) : null;
  const state = !active ? 'anulada' : t.balance === 0 ? 'pagada' : days === null ? 'sin_fecha' : days < 0 ? 'vencida' : days <= 7 ? 'pronto' : 'al_dia';
  const prodName = (l) => l.description || st.products.find((p) => p.id === l.productId)?.name || 'Producto';
  return `${head(`<a href="#/pagar">Facturas por pagar</a> · ${esc(pu.number)}`, esc(sup?.name || 'Proveedor'), active && t.balance ? `<button class="btn btn-primary" data-act="ph-purchase-pay" data-id="${pu.id}">Abonar</button>` : '')}
  <div class="bill-status s-${state}">${state === 'anulada' ? pill('Anulada', 'danger') : state === 'pagada' ? pill('Pagada', 'ok') : pill(dueLabel(days), TONE[state])}${pu.dueDate ? `<span>Pagar antes del <b>${formatDate(pu.dueDate)}</b></span>` : '<span>Sin fecha de pago acordada</span>'}${active && t.balance ? '<button class="link" data-act="purchase-due" data-id="' + pu.id + '">Cambiar fecha</button>' : ''}</div>
  <div class="stats stamp-host">${stat('Total de la factura', money(t.total), `Comprada el ${formatDate(pu.date)}`)}${stat('Abonado', money(t.paid), `${pu.payments.filter((p) => p.status === 'activo').length} abono(s)`)}${stat('Saldo', money(t.balance), '', t.balance && active ? 'warn' : '')}</div>
  ${progress(t.total ? (t.paid / t.total) * 100 : 0, t.balance === 0 ? 'ok' : '')}
  <section class="panel"><h2>Abonos</h2>${pu.payments.length ? `<ul class="simple">${pu.payments.map((p) => `<li><span><b>${money(p.amount)}</b> · ${formatDate(p.date)} · desde ${esc(payVia(p))}${p.reference ? ` · ref. ${esc(p.reference)}` : ''}${p.by ? ` · por ${esc(p.by)}` : ''}${p.note ? ` · ${esc(p.note)}` : ''}${p.status === 'anulado' ? ` ${pill('Anulado', 'danger')}<small class="block">${esc(p.voided?.reason || '')}</small>` : ''}</span>${p.status === 'activo' && active ? `<button class="btn btn-plain btn-xs" data-act="void-purchase-pay" data-id="${pu.id}" data-pay="${p.id}">Anular</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Todavía no le han abonado a esta factura.</p>'}</section>
  <section class="panel"><h2>Detalle</h2>
    <ul class="simple kv">
      ${pu.invoiceRef ? `<li><span>Factura o remisión del proveedor</span><b>${esc(pu.invoiceRef)}</b></li>` : ''}
      ${pu.lines.map((l) => `<li><span>${esc(prodName(l))} <small class="muted">× ${l.qty} a ${money(l.unitCost)}${l.ivaPct ? ` + IVA ${l.ivaPct} %` : ''}</small></span><b>${money(Math.round(l.unitCost * l.qty))}</b></li>`).join('')}
      ${pu.discount ? `<li><span>Descuento</span><b>− ${money(pu.discount)}</b></li>` : ''}
      ${Object.entries(t.ivaByRate || {}).map(([r, v]) => `<li><span>IVA ${r} %</span><b>${money(v)}</b></li>`).join('')}
      ${pu.shipping ? `<li><span>Flete</span><b>${money(pu.shipping)}</b></li>` : ''}
      <li class="total"><span>Total</span><b>${money(t.total)}</b></li>
    </ul>
    ${pu.notes ? `<p class="muted">${esc(pu.notes)}</p>` : ''}
    ${(pu.dueHistory || []).length ? `<h3>Cambios de fecha</h3><ul class="simple">${pu.dueHistory.map((h) => `<li><span>${h.from ? formatDate(h.from) : 'sin fecha'} → <b>${h.to ? formatDate(h.to) : 'sin fecha'}</b>${h.note ? ` · ${esc(h.note)}` : ''}</span><small>${formatDateTime(h.at)}${h.by ? ` · ${esc(h.by)}` : ''}</small></li>`).join('')}</ul>` : ''}
    ${sup ? `<p><a href="#/ph-proveedor/${sup.id}">Ver proveedor y sus términos</a>${sup.terms?.paymentTerm ? ` · plazo acordado: <b>${esc(sup.terms.paymentTerm)}</b>` : ''}</p>` : ''}
    ${active && !t.paid ? `<p><button class="link danger" data-act="void-purchase" data-id="${pu.id}">Anular esta compra</button></p>` : ''}
  </section>`;
}
