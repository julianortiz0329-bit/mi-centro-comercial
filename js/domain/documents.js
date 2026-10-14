// Cotizaciones, pedidos, ventas y despachos.
// - Cotización: propuesta; no mueve cartera ni comisiones.
// - Pedido: compromiso del cliente; se prepara y despacha; no es cartera.
// - Venta: documento comercial (factura/remisión) que crea la cuenta por cobrar
//   y, según la empresa, la comisión por venta.
import { newId } from '../core/ids.js';
import { addDays, isValidDate, localDate, localTime, toInstant } from '../core/dates.js';
import { mulDiv, parseDecimal, sum } from '../core/money.js';
import { assert, assertActiveCompany, audit, ConfirmRequired, cleanText, DomainError, getOrFail, nextNumber, nowOf } from './common.js';
import { onSaleRegistered, onSaleVoided } from './commissions.js';
import { clientCompanyBalance } from './ledger.js';

/** Cantidades con hasta 3 decimales (kg, unidades) se manejan en milésimas. */
function qtyMilli(q) {
  return Math.round(Number(q) * 1000);
}

/** Calcula una línea: bruto, descuento, neto antes de IVA, IVA y total. */
export function computeLine(line) {
  const qm = qtyMilli(line.qty);
  const gross = mulDiv(qm, line.unitPrice, 1000);
  const discount = mulDiv(gross, Math.round((line.discountPct || 0) * 100), 10000);
  const net = gross - discount;
  const iva = mulDiv(net, Math.round((line.ivaPct || 0) * 100), 10000);
  return { gross, discount, net, iva, total: net + iva };
}

export function computeTotals(lines) {
  const parts = lines.map(computeLine);
  return {
    gross: sum(parts, (p) => p.gross),
    discount: sum(parts, (p) => p.discount),
    net: sum(parts, (p) => p.net), // base antes de IVA, después de descuentos
    iva: sum(parts, (p) => p.iva),
    total: sum(parts, (p) => p.total),
  };
}

function normalizeLines(rawLines) {
  assert(Array.isArray(rawLines) && rawLines.length > 0, 'Agrega al menos un producto o concepto.', 'lines');
  return rawLines.map((l, i) => {
    const qty = typeof l.qty === 'number' ? l.qty : parseDecimal(l.qty);
    const unitPrice = Number(l.unitPrice);
    const discountPct = l.discountPct === '' || l.discountPct == null ? 0 : typeof l.discountPct === 'number' ? l.discountPct : parseDecimal(l.discountPct);
    const ivaPct = l.ivaPct === '' || l.ivaPct == null ? 0 : typeof l.ivaPct === 'number' ? l.ivaPct : parseDecimal(l.ivaPct);
    const n = i + 1;
    assert(cleanText(l.description), `Línea ${n}: escribe la descripción del producto.`, 'lines');
    assert(Number.isFinite(qty) && qty > 0, `Línea ${n}: la cantidad debe ser mayor que cero.`, 'lines');
    assert(Number.isSafeInteger(unitPrice) && unitPrice >= 0, `Línea ${n}: el precio unitario debe ser un valor en pesos.`, 'lines');
    assert(Number.isFinite(discountPct) && discountPct >= 0 && discountPct <= 100, `Línea ${n}: el descuento debe estar entre 0 y 100 %.`, 'lines');
    assert(Number.isFinite(ivaPct) && ivaPct >= 0 && ivaPct <= 100, `Línea ${n}: el IVA debe estar entre 0 y 100 %.`, 'lines');
    return {
      id: l.id || newId('ln'),
      productId: l.productId || null,
      description: cleanText(l.description, 300),
      presentation: cleanText(l.presentation, 120),
      qty: Math.round(qty * 1000) / 1000,
      unitPrice,
      discountPct,
      ivaPct,
      // Contenido de la presentación (p. ej. caja x 22,68 kg) para mostrar precio por kilo.
      contentQty: Number(l.contentQty) > 0 ? Number(l.contentQty) : null,
      contentUnit: l.contentUnit === 'und' ? 'und' : l.contentQty ? 'kg' : null,
    };
  });
}

/** Condición de pago: la del documento prevalece sobre la general del cliente. */
export function resolveTerm(s, clientId, companyId, termDays) {
  if (termDays !== undefined && termDays !== null && termDays !== '') {
    const d = Number(termDays);
    assert(Number.isInteger(d) && d >= 0 && d <= 365, 'El plazo debe ser un número de días entre 0 y 365.', 'term');
    return { days: d, source: 'documento' };
  }
  const c = s.clients.find((x) => x.id === clientId);
  const t = c?.terms?.[companyId]?.termDays;
  if (Number.isInteger(t)) return { days: t, source: 'cliente' };
  return { days: s.settings.defaultTermDays ?? 30, source: 'general' };
}

/**
 * Crea una cotización, un pedido o una venta.
 * input: { companyId, clientId, kind, date, time, lines, termDays, saleMode, notes,
 *          externalRef, requestId, sourceId, confirm: { creditLimit } }
 */
export function createDocument(s, input, ctx) {
  const now = nowOf(ctx);
  assertActiveCompany(input.companyId);
  assert(['cotizacion', 'pedido', 'venta'].includes(input.kind), 'Tipo de documento no válido.', 'kind');
  if (input.requestId) {
    const dup = s.documents.find((d) => d.requestId === input.requestId);
    if (dup) return dup; // reintento o doble clic: se devuelve el mismo documento
  }
  const client = getOrFail(s.clients, input.clientId, 'el cliente');
  assert(client.status !== 'bloqueado' || input.kind === 'cotizacion', 'El cliente está bloqueado. Cambia su estado antes de registrar pedidos o ventas.', 'client_blocked');
  const date = input.date || localDate(new Date(now));
  assert(isValidDate(date), 'La fecha del documento no es válida.', 'date');
  const time = input.time || localTime(new Date(now));
  const lines = normalizeLines(input.lines);
  const totals = computeTotals(lines);
  const term = resolveTerm(s, client.id, input.companyId, input.termDays);
  let saleMode = null;
  if (input.companyId === 'nogal') {
    assert(['mayorista', 'normal'].includes(input.saleMode), 'Frutos del Nogal: indica si la operación es mayorista o normal.', 'mode');
    saleMode = input.saleMode;
  }

  if (input.kind === 'venta' && term.days > 0) {
    const limit = client.terms?.[input.companyId]?.creditLimit || 0;
    if (limit > 0) {
      const current = clientCompanyBalance(s, client.id, input.companyId);
      if (current + totals.total > limit) {
        const msg = `Con esta venta el saldo del cliente (${current + totals.total} COP) supera su cupo de crédito (${limit} COP).`;
        if (s.settings.creditLimitBlocks?.[input.companyId]) throw new DomainError(msg + ' La empresa tiene activo el bloqueo por cupo.', 'credit_limit');
        if (!input.confirm?.creditLimit) throw new ConfirmRequired(msg + ' ¿Registrar de todas formas?', 'creditLimit');
      }
    }
  }

  const doc = {
    id: newId('doc'),
    number: nextNumber(s, input.companyId, input.kind),
    externalRef: cleanText(input.externalRef, 60),
    companyId: input.companyId,
    clientId: client.id,
    kind: input.kind,
    status: input.kind === 'venta' ? 'emitida' : input.status || (input.kind === 'cotizacion' ? 'cotizado' : 'confirmado'),
    date,
    time,
    occurredAt: toInstant(date, time),
    lines,
    totals,
    saleMode,
    term: { days: term.days, source: term.source },
    dueDate: input.kind === 'cotizacion' ? null : addDays(date, term.days),
    validUntil: input.kind === 'cotizacion' && input.validUntil ? input.validUntil : null,
    notes: cleanText(input.notes),
    sourceId: input.sourceId || null,
    requestId: input.requestId || null,
    commission: null,
    voided: null,
    history: [{ at: now, action: 'creado', detail: '' }],
    createdAt: now,
    updatedAt: now,
  };
  s.documents.push(doc);
  if (input.kind === 'venta') {
    client.lastPurchase = !client.lastPurchase || client.lastPurchase < date ? date : client.lastPurchase;
    if (client.status === 'prospecto') client.status = 'activo';
    if (!client.companyIds.includes(input.companyId)) client.companyIds.push(input.companyId);
    onSaleRegistered(s, doc, ctx);
  }
  audit(s, ctx, 'crear', doc.kind, doc.id, `${doc.number} · ${totals.total}`);
  return doc;
}

const ORDER_FLOW = {
  borrador: ['pendiente_confirmacion', 'confirmado', 'cancelado'],
  cotizado: ['pendiente_confirmacion', 'confirmado', 'cancelado'],
  pendiente_confirmacion: ['confirmado', 'cancelado'],
  confirmado: ['en_preparacion', 'cancelado'],
  en_preparacion: ['confirmado', 'cancelado'],
  despacho_parcial: [],
  despachado: [],
  entregado: [],
  cancelado: [],
};
const QUOTE_FLOW = { borrador: ['cotizado', 'cancelado'], cotizado: ['rechazada', 'cancelado'], aceptada: [], rechazada: [], cancelado: [] };

export function allowedTransitions(doc) {
  if (doc.kind === 'pedido') return ORDER_FLOW[doc.status] || [];
  if (doc.kind === 'cotizacion') return QUOTE_FLOW[doc.status] || [];
  return [];
}

/** Cambios de estado manuales. Despachos y entregas tienen sus propios comandos. */
export function changeStatus(s, { documentId, status, reason }, ctx) {
  const doc = getOrFail(s.documents, documentId, 'el documento');
  assert(allowedTransitions(doc).includes(status), 'Ese cambio de estado no está permitido desde el estado actual.', 'status');
  if (status === 'cancelado') assert(cleanText(reason), 'Indica el motivo de la cancelación.', 'reason');
  const prev = doc.status;
  doc.status = status;
  doc.updatedAt = nowOf(ctx);
  doc.history.push({ at: nowOf(ctx), action: 'estado', detail: `${prev} → ${status}${reason ? ' · ' + cleanText(reason) : ''}` });
  audit(s, ctx, 'estado', doc.kind, doc.id, `${prev} → ${status}`);
  return doc;
}

/** Cotización → pedido, o pedido → venta. Copia las líneas (editables antes). */
export function convertDocument(s, { documentId, toKind, lines, date, time, termDays, notes, externalRef, requestId, confirm }, ctx) {
  const src = getOrFail(s.documents, documentId, 'el documento');
  if (toKind === 'pedido') assert(src.kind === 'cotizacion' && ['borrador', 'cotizado'].includes(src.status), 'Solo una cotización vigente puede convertirse en pedido.', 'convert');
  else if (toKind === 'venta') {
    assert(src.kind === 'pedido' && src.status !== 'cancelado', 'Solo un pedido no cancelado puede registrarse como venta.', 'convert');
    assert(!s.documents.some((d) => d.sourceId === src.id && d.kind === 'venta' && d.status !== 'anulada'), 'Este pedido ya tiene una venta registrada.', 'convert');
  } else throw new DomainError('Conversión no válida.', 'convert');
  const doc = createDocument(
    s,
    {
      companyId: src.companyId,
      clientId: src.clientId,
      kind: toKind,
      date,
      time,
      lines: lines || src.lines.map((l) => ({ ...l, id: undefined })),
      termDays: termDays ?? src.term?.days,
      saleMode: src.saleMode,
      notes: notes ?? src.notes,
      externalRef,
      requestId,
      sourceId: src.id,
      confirm,
    },
    ctx,
  );
  if (toKind === 'pedido') {
    src.status = 'aceptada';
    src.history.push({ at: nowOf(ctx), action: 'convertido', detail: `Pedido ${doc.number}` });
  } else {
    src.history.push({ at: nowOf(ctx), action: 'facturado', detail: `Venta ${doc.number}` });
  }
  src.updatedAt = nowOf(ctx);
  return doc;
}

/** Cantidades despachadas por línea (pedido o venta). */
export function dispatchedQty(s, documentId) {
  const out = {};
  for (const d of s.dispatches) {
    if (d.documentId !== documentId || d.voided) continue;
    for (const l of d.lines) out[l.lineId] = Math.round(((out[l.lineId] || 0) + l.qty) * 1000) / 1000;
  }
  return out;
}

export function pendingDispatch(s, doc) {
  const done = dispatchedQty(s, doc.id);
  return doc.lines.map((l) => ({ line: l, dispatched: done[l.id] || 0, pending: Math.max(0, Math.round((l.qty - (done[l.id] || 0)) * 1000) / 1000) }));
}

/** Registra un despacho (total o parcial). Requiere cantidades reales por línea. */
export function registerDispatch(s, { documentId, date, lines, carrier, guide, notes, requestId }, ctx) {
  const doc = getOrFail(s.documents, documentId, 'el documento');
  assert(doc.kind === 'pedido' || doc.kind === 'venta', 'Solo se despachan pedidos o ventas.', 'dispatch');
  assert(!['cancelado', 'anulada', 'entregado'].includes(doc.status), 'Este documento no admite despachos.', 'dispatch');
  if (doc.kind === 'pedido') assert(['confirmado', 'en_preparacion', 'despacho_parcial'].includes(doc.status), 'Confirma el pedido antes de despacharlo.', 'dispatch');
  if (requestId && s.dispatches.some((d) => d.requestId === requestId)) return s.dispatches.find((d) => d.requestId === requestId);
  assert(isValidDate(date), 'La fecha de despacho no es válida.', 'date');
  const pend = Object.fromEntries(pendingDispatch(s, doc).map((p) => [p.line.id, p.pending]));
  const clean = (lines || [])
    .map((l) => ({ lineId: l.lineId, qty: Math.round(Number(typeof l.qty === 'number' ? l.qty : parseDecimal(l.qty)) * 1000) / 1000 }))
    .filter((l) => l.qty > 0);
  assert(clean.length > 0, 'Indica al menos una cantidad despachada.', 'dispatch');
  for (const l of clean) {
    assert(l.lineId in pend, 'Línea de despacho no válida.', 'dispatch');
    assert(l.qty <= pend[l.lineId] + 1e-9, 'No puedes despachar más de lo pendiente en una línea.', 'dispatch');
  }
  const d = { id: newId('dsp'), companyId: doc.companyId, documentId: doc.id, date, lines: clean, carrier: cleanText(carrier, 120), guide: cleanText(guide, 120), notes: cleanText(notes), requestId: requestId || null, createdAt: nowOf(ctx), voided: null };
  s.dispatches.push(d);
  const after = pendingDispatch(s, doc);
  const complete = after.every((p) => p.pending <= 0);
  if (doc.kind === 'pedido') doc.status = complete ? 'despachado' : 'despacho_parcial';
  doc.dispatchStatus = complete ? 'completo' : 'parcial';
  doc.history.push({ at: nowOf(ctx), action: 'despacho', detail: `${complete ? 'Completo' : 'Parcial'} · ${d.carrier} ${d.guide}`.trim() });
  doc.updatedAt = nowOf(ctx);
  audit(s, ctx, 'despacho', doc.kind, doc.id, complete ? 'completo' : 'parcial');
  return d;
}

/** Entrega confirmada: solo si todo fue despachado. */
export function confirmDelivery(s, { documentId, date, notes }, ctx) {
  const doc = getOrFail(s.documents, documentId, 'el documento');
  assert(doc.kind === 'pedido', 'Solo los pedidos registran entrega.', 'deliver');
  assert(doc.status === 'despachado', 'Solo se confirma la entrega de un pedido despachado por completo.', 'deliver');
  assert(isValidDate(date), 'La fecha de entrega no es válida.', 'date');
  doc.status = 'entregado';
  doc.deliveredAt = date;
  doc.history.push({ at: nowOf(ctx), action: 'entregado', detail: cleanText(notes) });
  audit(s, ctx, 'entrega', 'pedido', doc.id, date);
  return doc;
}

/** Cambio explícito de vencimiento, con motivo (no se alteran en silencio). */
export function changeDueDate(s, { documentId, dueDate, reason }, ctx) {
  const doc = getOrFail(s.documents, documentId, 'el documento');
  assert(doc.kind === 'venta' && doc.status === 'emitida', 'Solo se modifica el vencimiento de una venta vigente.', 'due');
  assert(isValidDate(dueDate), 'La nueva fecha de vencimiento no es válida.', 'date');
  assert(cleanText(reason), 'Indica el motivo del cambio de vencimiento.', 'reason');
  const prev = doc.dueDate;
  doc.dueDate = dueDate;
  doc.history.push({ at: nowOf(ctx), action: 'vencimiento', detail: `${prev} → ${dueDate} · ${cleanText(reason)}` });
  audit(s, ctx, 'vencimiento', 'venta', doc.id, `${prev} → ${dueDate}`);
  return doc;
}

/** Anula una venta. Exige que no tenga pagos aplicados (revertirlos antes). */
export function voidSale(s, { documentId, reason }, ctx) {
  const doc = getOrFail(s.documents, documentId, 'la venta');
  assert(doc.kind === 'venta' && doc.status === 'emitida', 'Solo se anula una venta vigente.', 'void');
  assert(cleanText(reason), 'Indica el motivo de la anulación.', 'reason');
  const applied = s.payments.some((p) => p.status === 'activo' && p.allocations.some((a) => a.documentId === doc.id));
  assert(!applied, 'La venta tiene pagos aplicados. Reversa o reasigna esos pagos antes de anularla.', 'void');
  doc.status = 'anulada';
  doc.voided = { at: nowOf(ctx), reason: cleanText(reason), user: ctx?.user || 'usuario' };
  doc.history.push({ at: nowOf(ctx), action: 'anulada', detail: cleanText(reason) });
  onSaleVoided(s, doc, ctx);
  audit(s, ctx, 'anular', 'venta', doc.id, cleanText(reason));
  return doc;
}

/** Edición de un documento sin efectos financieros (cotización o pedido no despachado). */
export function updateDraftDocument(s, { documentId, lines, notes, termDays, saleMode, date, time, validUntil }, ctx) {
  const doc = getOrFail(s.documents, documentId, 'el documento');
  const editable = (doc.kind === 'cotizacion' && ['borrador', 'cotizado'].includes(doc.status)) || (doc.kind === 'pedido' && ['borrador', 'pendiente_confirmacion', 'confirmado', 'en_preparacion'].includes(doc.status) && !s.dispatches.some((d) => d.documentId === doc.id));
  assert(editable, 'Este documento ya no se puede editar. Las ventas se corrigen con anulación.', 'edit');
  const before = doc.totals.total;
  if (lines) {
    doc.lines = normalizeLines(lines);
    doc.totals = computeTotals(doc.lines);
  }
  if (notes !== undefined) doc.notes = cleanText(notes);
  if (date) {
    assert(isValidDate(date), 'Fecha no válida.', 'date');
    doc.date = date;
    doc.time = time || doc.time;
    doc.occurredAt = toInstant(doc.date, doc.time);
  }
  if (termDays !== undefined && termDays !== '') {
    const t = resolveTerm(s, doc.clientId, doc.companyId, termDays);
    doc.term = { days: t.days, source: t.source };
  }
  if (doc.kind !== 'cotizacion') doc.dueDate = addDays(doc.date, doc.term.days);
  if (validUntil !== undefined) doc.validUntil = validUntil || null;
  if (doc.companyId === 'nogal' && saleMode) {
    assert(['mayorista', 'normal'].includes(saleMode), 'Modalidad no válida.', 'mode');
    doc.saleMode = saleMode;
  }
  doc.updatedAt = nowOf(ctx);
  doc.history.push({ at: nowOf(ctx), action: 'editado', detail: before !== doc.totals.total ? `Total ${before} → ${doc.totals.total}` : '' });
  audit(s, ctx, 'editar', doc.kind, doc.id, '');
  return doc;
}
