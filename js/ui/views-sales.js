import { formatDate, formatDateTime } from '../core/dates.js';
import { formatPct } from '../core/money.js';
import { allowedTransitions, computeLine, pendingDispatch } from '../domain/documents.js';
import { allocationsFor, saleBalance } from '../domain/ledger.js';
import { COMMISSION_STATUSES, DOC_KINDS, ORDER_STATUSES, PAYMENT_METHODS, QUOTE_STATUSES, SALE_STATUSES } from '../domain/schema.js';
import { getState } from '../store/store.js';
import { paidStamp } from './motion.js';
import { empty, esc, money, pill } from './dom.js';
import { ui } from './state.js';

const S = () => getState();
export const statusLabel = (d) => ({ cotizacion: QUOTE_STATUSES, pedido: ORDER_STATUSES, venta: SALE_STATUSES })[d.kind]?.[d.status] || d.status;
const tone = (d) => (['cancelado', 'anulada', 'rechazada'].includes(d.status) ? 'danger' : ['entregado', 'aceptada', 'despachado'].includes(d.status) ? 'ok' : ['despacho_parcial', 'pendiente_confirmacion'].includes(d.status) ? 'warn' : 'info');
const clientName = (id) => S().clients.find((c) => c.id === id)?.tradeName || 'Cliente';

export let salesQuery = { q: '', status: '' };

export function salesResults(kind) {
  const s = S();
  const q = salesQuery.q.toLowerCase();
  const list = s.documents
    .filter((d) => d.kind === kind && (ui.scope === 'todas' || d.companyId === ui.scope) && (!salesQuery.status || d.status === salesQuery.status || (salesQuery.status === 'con_saldo' && saleBalance(s, d) > 0)))
    .filter((d) => !q || `${d.number} ${d.externalRef} ${clientName(d.clientId)}`.toLowerCase().includes(q))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt));
  if (!list.length) return q || salesQuery.status ? empty('🧾', 'Sin coincidencias', 'Prueba con otro número, cliente o filtro.') : empty('🧾', `Aún no tienes ${DOC_KINDS[kind].toLowerCase()}s aquí`, kind === 'venta' ? 'Cada venta crea la cuenta por cobrar y suma a tu meta.' : 'Regístralo en un minuto desde aquí.', `<button class="btn btn-primary" data-act="new-doc" data-kind="${kind}">＋ ${kind === 'venta' ? 'Registrar la primera venta' : kind === 'pedido' ? 'Registrar el primer pedido' : 'Hacer la primera cotización'}</button>`);
  return `<p class="muted small">${list.length} documento(s)</p><div class="cards">${list.slice(0, 300).map((d) => {
    const bal = d.kind === 'venta' ? saleBalance(s, d) : null;
    return `<a class="card card-main" href="#/doc/${d.id}"><div class="card-title">${esc(d.number)} · ${esc(clientName(d.clientId))} ${pill(statusLabel(d), tone(d))}</div>
      <div class="card-sub"><span class="co-chip co-${d.companyId}">${esc(s.companies[d.companyId].short)}</span> ${formatDate(d.date)}${d.externalRef ? ` · Ref. ${esc(d.externalRef)}` : ''}${d.saleMode ? ` · ${d.saleMode === 'mayorista' ? 'Mayorista' : 'Normal'}` : ''}${d.legacy ? ' · migrado v1' : ''}</div>
      <div class="card-meta"><span>Total <b>${money(d.totals.total)}</b></span>${bal !== null && d.status === 'emitida' ? `<span>${bal > 0 ? `Saldo <b>${money(bal)}</b> · vence ${formatDate(d.dueDate)}` : '✔ Pagada'}</span>` : ''}</div></a>`;
  }).join('')}</div>`;
}

export function renderSales(params) {
  const kind = ['cotizacion', 'pedido', 'venta'].includes(params.get('k')) ? params.get('k') : 'venta';
  const statuses = { cotizacion: QUOTE_STATUSES, pedido: ORDER_STATUSES, venta: { ...SALE_STATUSES, con_saldo: 'Con saldo' } }[kind];
  return `<div class="page-head"><div><p class="eyebrow">Ventas, pedidos y cotizaciones</p><h1>${{ venta: 'Ventas', pedido: 'Pedidos', cotizacion: 'Cotizaciones' }[kind]}</h1></div><button class="btn btn-primary" data-act="new-doc" data-kind="${kind}">＋ ${kind === 'venta' ? 'Venta' : kind === 'pedido' ? 'Pedido' : 'Cotización'}</button></div>
  <div class="tabs"><a href="#/ventas?k=venta" class="${kind === 'venta' ? 'active' : ''}">Ventas</a><a href="#/ventas?k=pedido" class="${kind === 'pedido' ? 'active' : ''}">Pedidos</a><a href="#/ventas?k=cotizacion" class="${kind === 'cotizacion' ? 'active' : ''}">Cotizaciones</a></div>
  <div class="toolbar"><div class="search"><input type="search" id="sales-q" data-kind="${kind}" placeholder="Buscar número, referencia o cliente" value="${esc(salesQuery.q)}" aria-label="Buscar documentos"></div><select id="sales-status" data-kind="${kind}" aria-label="Estado"><option value="">Todos los estados</option>${Object.entries(statuses).map(([k, l]) => `<option value="${k}" ${salesQuery.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
  <div id="sales-results">${salesResults(kind)}</div>`;
}

export function renderDocument(id) {
  const s = S();
  const d = s.documents.find((x) => x.id === id);
  if (!d) return empty('🔍', 'Documento no encontrado', '', '<a class="btn btn-primary" href="#/ventas">Volver</a>');
  const client = s.clients.find((c) => c.id === d.clientId);
  const co = s.companies[d.companyId];
  const isSale = d.kind === 'venta';
  const bal = isSale ? saleBalance(s, d) : 0;
  const allocs = isSale ? allocationsFor(s, d.id) : [];
  const allPays = s.payments.filter((p) => p.allocations.some((a) => a.documentId === d.id) || (p.releasedAllocations || []).some((a) => a.documentId === d.id));
  const pend = d.kind !== 'cotizacion' ? pendingDispatch(s, d) : [];
  const dispatches = s.dispatches.filter((x) => x.documentId === d.id || (d.sourceId && x.documentId === d.sourceId));
  const comms = s.commissions.filter((c) => c.documentId === d.id);
  const derived = s.documents.filter((x) => x.sourceId === d.id);
  const source = d.sourceId ? s.documents.find((x) => x.id === d.sourceId) : null;
  const trans = allowedTransitions(d);
  const transLabel = { pendiente_confirmacion: 'Marcar pendiente de confirmación', confirmado: 'Confirmar pedido', en_preparacion: 'Marcar en preparación', cancelado: 'Cancelar', cotizado: 'Marcar como enviada', rechazada: 'Marcar rechazada' };
  const canEdit = (d.kind === 'cotizacion' && ['borrador', 'cotizado'].includes(d.status)) || (d.kind === 'pedido' && ['borrador', 'pendiente_confirmacion', 'confirmado', 'en_preparacion'].includes(d.status) && !s.dispatches.some((x) => x.documentId === d.id));
  const hasSale = derived.some((x) => x.kind === 'venta' && x.status !== 'anulada');
  const actions = [
    isSale && d.status === 'emitida' && bal > 0 ? `<button class="btn btn-primary" data-act="pay" data-doc="${d.id}">Registrar cobro</button>` : '',
    d.kind === 'cotizacion' && ['borrador', 'cotizado'].includes(d.status) ? `<button class="btn btn-primary" data-act="convert" data-doc="${d.id}" data-to="pedido">Convertir en pedido</button>` : '',
    d.kind === 'pedido' && d.status !== 'cancelado' && !hasSale ? `<button class="btn btn-primary" data-act="convert" data-doc="${d.id}" data-to="venta">Registrar venta / factura</button>` : '',
    (d.kind === 'pedido' && ['confirmado', 'en_preparacion', 'despacho_parcial'].includes(d.status)) || (isSale && d.status === 'emitida' && !d.sourceId && pend.some((p) => p.pending > 0)) ? `<button class="btn btn-secondary" data-act="dispatch" data-doc="${d.id}">Registrar despacho</button>` : '',
    d.kind === 'pedido' && d.status === 'despachado' ? `<button class="btn btn-secondary" data-act="deliver" data-doc="${d.id}">Confirmar entrega</button>` : '',
    ...trans.map((t) => `<button class="btn ${t === 'cancelado' ? 'btn-danger' : 'btn-plain'}" data-act="status" data-doc="${d.id}" data-status="${t}">${transLabel[t] || t}</button>`),
    canEdit ? `<button class="btn btn-plain" data-act="edit-doc" data-doc="${d.id}">Editar</button>` : '',
    isSale && d.status === 'emitida' ? `<button class="btn btn-plain" data-act="due" data-doc="${d.id}">Cambiar vencimiento</button>` : '',
    isSale && d.status === 'emitida' ? `<button class="btn btn-plain" data-act="activity" data-client="${d.clientId}" data-doc="${d.id}">Gestión de cobro</button>` : '',
    `<button class="btn btn-primary" data-act="doc-pdf" data-doc="${d.id}">📄 PDF para enviar</button>`,
    d.kind !== 'cotizacion' && !['cancelado', 'anulada'].includes(d.status) ? `<button class="btn btn-secondary" data-act="repeat" data-doc="${d.id}">🔁 Repetir pedido</button>` : '',
    `<button class="btn btn-wa" data-act="share-quote" data-doc="${d.id}">Enviar ${d.kind === 'cotizacion' ? 'cotización' : 'detalle'} por WhatsApp</button>`,
    `<button class="btn btn-plain" data-act="wa" data-client="${d.clientId}" data-doc="${d.id}">Otro mensaje</button>`,
    `<button class="btn btn-plain" data-act="print">Imprimir / PDF</button>`,
    isSale && d.status === 'emitida' ? `<button class="btn btn-danger" data-act="void" data-doc="${d.id}">Anular venta</button>` : '',
  ].filter(Boolean).join('');
  return `<div class="print-only print-head"><b>${esc(co.name)}</b><span>${esc(DOC_KINDS[d.kind])} ${esc(d.number)} · ${formatDate(d.date)}</span><span>Cliente: ${esc(client?.tradeName)}${client?.taxId ? ` · NIT ${esc(client.taxId)}` : ''}</span></div>
  <div class="page-head"><div><p class="eyebrow"><a href="#/ventas?k=${d.kind}">${DOC_KINDS[d.kind]}s</a> · ${co.icon} ${esc(co.name)}</p><h1>${esc(d.number)} ${pill(statusLabel(d), tone(d))}</h1><p class="muted"><a href="#/cliente/${client?.id}">${esc(client?.tradeName)}</a> · ${formatDate(d.date)} ${esc(d.time)}${d.externalRef ? ` · Ref. ${esc(d.externalRef)}` : ''}</p></div></div>
  <div class="action-bar">${actions}</div>
  ${d.legacy ? '<div class="notice info">Documento migrado de la versión 1: el valor no tiene desglose de IVA y no genera comisión por venta.</div>' : ''}
  ${d.voided ? `<div class="notice warn">Anulada el ${formatDateTime(d.voided.at)}: ${esc(d.voided.reason)}</div>` : ''}
  ${d.dispute?.active ? '<div class="notice warn">Cuenta marcada en disputa.</div>' : ''}
  <div class="stats stamp-host">${isSale && d.status === 'emitida' && bal === 0 ? paidStamp(d.id) : ''}
    ${'<div class="stat"><div class="stat-label">Total</div><div class="stat-value">' + money(d.totals.total) + '</div><div class="stat-note">Antes de IVA ' + money(d.totals.net) + ' · IVA ' + money(d.totals.iva) + '</div></div>'}
    ${isSale ? `<div class="stat"><div class="stat-label">Abonado</div><div class="stat-value">${money(d.totals.total - bal)}</div></div><div class="stat ${bal > 0 && d.dueDate < new Date().toISOString().slice(0, 10) ? 'warn' : ''}"><div class="stat-label">Saldo</div><div class="stat-value">${money(bal)}</div><div class="stat-note">Vence ${formatDate(d.dueDate)}</div></div>` : ''}
    <div class="stat"><div class="stat-label">Condición</div><div class="stat-value small">${d.kind === 'cotizacion' ? (d.validUntil ? `Válida hasta ${formatDate(d.validUntil)}` : '—') : d.term.days === 0 ? 'Contado' : `${d.term.days} días`}</div><div class="stat-note">${d.kind === 'cotizacion' ? '' : `Origen: ${esc({ documento: 'este documento', cliente: 'condición del cliente', general: 'configuración general', migrado: 'versión 1' }[d.term.source] || d.term.source)}`}</div></div>
    ${d.saleMode ? `<div class="stat"><div class="stat-label">Modalidad</div><div class="stat-value small">${d.saleMode === 'mayorista' ? 'Mayorista' : 'Normal'}</div></div>` : ''}
  </div>
  <section class="panel"><h2>Productos</h2><div class="table-wrap"><table><thead><tr><th>Descripción</th><th>Cant.</th><th>Precio unit.</th><th>Por kg/und</th><th>Desc.</th><th>Antes de IVA</th><th>IVA</th><th>Total</th>${pend.length ? '<th>Despachado</th>' : ''}</tr></thead><tbody>
  ${d.lines.map((l) => { const c = computeLine(l); const p = pend.find((x) => x.line.id === l.id); return `<tr><td>${esc(l.description)}${l.presentation ? `<small> · ${esc(l.presentation)}</small>` : ''}</td><td>${l.qty}</td><td>${money(l.unitPrice)}</td><td>${l.contentQty ? `${money(Math.round((l.unitPrice * (1 - (l.discountPct || 0) / 100)) / l.contentQty))}/${l.contentUnit === 'und' ? 'und' : 'kg'}` : '—'}</td><td>${l.discountPct ? l.discountPct + ' %' : '—'}</td><td>${money(c.net)}</td><td>${l.ivaPct} % · ${money(c.iva)}</td><td>${money(c.total)}</td>${p ? `<td>${p.dispatched} / ${l.qty}</td>` : ''}</tr>`; }).join('')}
  </tbody><tfoot><tr><td colspan="5">Totales</td><td>${money(d.totals.net)}</td><td>${money(d.totals.iva)}</td><td><b>${money(d.totals.total)}</b></td>${pend.length ? '<td></td>' : ''}</tr></tfoot></table></div>${d.notes ? `<p class="pre">${esc(d.notes)}</p>` : ''}</section>
  ${source || derived.length ? `<section class="panel"><h2>Documentos relacionados</h2><ul class="simple">${source ? `<li>Origen: <a href="#/doc/${source.id}">${esc(DOC_KINDS[source.kind])} ${esc(source.number)}</a></li>` : ''}${derived.map((x) => `<li>Generado: <a href="#/doc/${x.id}">${esc(DOC_KINDS[x.kind])} ${esc(x.number)}</a> · ${esc(statusLabel(x))}</li>`).join('')}</ul></section>` : ''}
  ${isSale ? `<section class="panel"><h2>Abonos y recaudos</h2>${allPays.length ? `<div class="table-wrap"><table><thead><tr><th>Pago</th><th>Fecha</th><th>Método</th><th>Aplicado aquí</th><th>Estado</th><th></th></tr></thead><tbody>${allPays.map((p) => { const a = p.allocations.find((x) => x.documentId === d.id); const rel = (p.releasedAllocations || []).find((x) => x.documentId === d.id); return `<tr><td>${esc(p.number)}${p.reference ? `<small> · ${esc(p.reference)}</small>` : ''}</td><td>${formatDate(p.date)}</td><td>${esc(PAYMENT_METHODS[p.method] || p.method)}</td><td>${money(a?.amount || rel?.amount || 0)}</td><td>${p.status === 'reversado' ? pill('Reversado', 'danger') : a ? pill('Aplicado', 'ok') : pill('Liberado', '')}</td><td>${p.status === 'activo' ? `<button class="btn btn-plain btn-xs" data-act="reverse" data-id="${p.id}">Reversar</button>${a ? ` <button class="btn btn-plain btn-xs" data-act="unapply" data-id="${p.id}" data-alloc="${a.id}">Liberar</button>` : ''}` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted">Sin abonos registrados.</p>'}<p class="muted small">Aplicado vigente: ${money(allocs.reduce((a, x) => a + x.amount, 0))}</p></section>` : ''}
  ${dispatches.length ? `<section class="panel"><h2>Despachos</h2><ul class="simple">${dispatches.map((x) => `<li>${formatDate(x.date)} · ${x.lines.map((l) => `${l.qty} × ${esc(([...d.lines, ...(source?.lines || [])].find((y) => y.id === l.lineId)?.description) || 'línea')}`).join(', ')}${x.carrier || x.guide ? ` · ${esc([x.carrier, x.guide].filter(Boolean).join(' '))}` : ''}</li>`).join('')}</ul></section>` : ''}
  ${comms.length ? `<section class="panel"><h2>Comisiones de este documento</h2><div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Periodo</th><th>Base</th><th>%</th><th>Comisión</th><th>Estado</th></tr></thead><tbody>${comms.map((c) => `<tr><td>${esc(c.type)}</td><td>${esc(c.period)}</td><td>${money(c.base)}</td><td>${formatPct(c.rateBps)}</td><td>${money(c.amount)}</td><td>${pill(c.pendingThreshold && c.status === 'bloqueada' ? 'En espera' : COMMISSION_STATUSES[c.status], c.status === 'bloqueada' || c.status === 'reversada' ? '' : 'ok')}${c.blockedReason ? `<small class="block">${esc(c.blockedReason)}</small>` : ''}</td></tr>`).join('')}</tbody></table></div></section>` : isSale && d.companyId === 'puntazo' ? '<p class="muted small panel">El Puntazo no genera comisión por venta; la comisión del 6 % se genera con cada cobro.</p>' : ''}
  <section class="panel"><h2>Historial</h2><ul class="simple">${d.history.slice().reverse().map((h) => `<li>${formatDateTime(h.at)} · <b>${esc(h.action)}</b> ${esc(h.detail || '')}</li>`).join('')}</ul></section>`;
}
