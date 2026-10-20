// Recaudos. Un pago pertenece a UNA empresa y UN cliente; puede aplicarse a una
// o varias ventas de esa misma empresa y cliente, o quedar (en parte) sin
// aplicar. Lo no aplicado no reduce cartera ni genera comisión.
import { newId } from '../core/ids.js';
import { isValidDate, localDate, toInstant } from '../core/dates.js';
import { sum } from '../core/money.js';
import { assert, assertActiveCompany, audit, ConfirmRequired, cleanText, getOrFail, nextNumber, nowOf } from './common.js';
import { onAllocation, onAllocationRemoved, onPaymentReversed } from './commissions.js';
import { isActiveSale, saleBalance, unappliedAmount } from './ledger.js';
import { PAYMENT_METHODS } from './schema.js';

function normRef(r) {
  return String(r || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function validateAllocations(s, payment, allocations, available) {
  const seen = new Set();
  let total = 0;
  for (const a of allocations) {
    const amt = Number(a.amount);
    if (!amt) continue;
    assert(Number.isSafeInteger(amt) && amt > 0, 'Cada valor aplicado debe ser un monto positivo en pesos.', 'allocation');
    assert(!seen.has(a.documentId), 'Una misma venta aparece dos veces en la distribución.', 'allocation');
    seen.add(a.documentId);
    const doc = getOrFail(s.documents, a.documentId, 'la venta');
    assert(isActiveSale(doc), `La venta ${doc.number} no está vigente.`, 'allocation');
    assert(doc.companyId === payment.companyId, 'No se puede aplicar un pago de una empresa a una deuda de la otra.', 'cross_company');
    assert(doc.clientId === payment.clientId, `La venta ${doc.number} es de otro cliente.`, 'allocation');
    const bal = saleBalance(s, doc);
    assert(amt <= bal, `El valor aplicado a ${doc.number} supera su saldo pendiente.`, 'allocation');
    total += amt;
  }
  assert(total <= available, 'La suma aplicada supera el valor disponible del pago.', 'allocation');
  return allocations.filter((a) => Number(a.amount) > 0).map((a) => ({ documentId: a.documentId, amount: Number(a.amount) }));
}

/**
 * Registra un pago recibido.
 * input: { companyId, clientId, date, time, amount, method, reference, notes,
 *          allocations: [{documentId, amount}], requestId,
 *          confirm: { duplicateRef, similar } }
 */
export function registerPayment(s, input, ctx) {
  const now = nowOf(ctx);
  assertActiveCompany(input.companyId);
  if (input.requestId) {
    const dup = s.payments.find((p) => p.requestId === input.requestId);
    if (dup) return dup; // doble clic o reintento: no se registra dos veces
  }
  const client = getOrFail(s.clients, input.clientId, 'el cliente');
  const amount = Number(input.amount);
  assert(Number.isSafeInteger(amount) && amount > 0, 'El valor recibido debe ser mayor que cero.', 'amount');
  const date = input.date || localDate(new Date(now));
  assert(isValidDate(date), 'La fecha del recaudo no es válida.', 'date');
  assert(date <= localDate(new Date(now)), 'La fecha del recaudo no puede ser futura.', 'date');
  assert(input.method in PAYMENT_METHODS, 'Selecciona el método de pago.', 'method');
  const reference = cleanText(input.reference, 120);

  // Controles de duplicado: misma referencia = misma transacción (advertencia
  // fuerte); mismo valor/cliente/día = posible duplicado (advertencia).
  const nref = normRef(reference);
  if (nref && !input.confirm?.duplicateRef) {
    const same = s.payments.find((p) => p.status === 'activo' && p.companyId === input.companyId && normRef(p.reference) === nref);
    if (same) throw new ConfirmRequired(`Ya existe el pago ${same.number} con la referencia "${same.reference}" por ${same.amount} COP. ¿Es un pago distinto?`, 'duplicateRef');
  }
  if (!input.confirm?.similar) {
    const similar = s.payments.find((p) => p.status === 'activo' && p.companyId === input.companyId && p.clientId === client.id && p.amount === amount && p.receivedAt.slice(0, 10) === toInstant(date, input.time).slice(0, 10));
    if (similar) throw new ConfirmRequired(`Ya registraste hoy un pago de ${amount} COP de este cliente (${similar.number}). ¿Registrar otro pago legítimo por el mismo valor?`, 'similar');
  }

  const payment = {
    id: newId('pay'),
    number: nextNumber(s, input.companyId, 'pago'),
    companyId: input.companyId,
    clientId: client.id,
    receivedAt: toInstant(date, input.time || '12:00'),
    date,
    amount,
    method: input.method,
    reference,
    notes: cleanText(input.notes),
    allocations: [],
    status: 'activo',
    reversal: null,
    requestId: input.requestId || null,
    createdAt: now,
  };
  const allocs = validateAllocations(s, payment, input.allocations || [], amount);
  s.payments.push(payment);
  for (const a of allocs) applyAllocation(s, payment, a, ctx);
  client.lastContact = date > (client.lastContact || '') ? date : client.lastContact;
  audit(s, ctx, 'registrar_pago', 'pago', payment.id, `${payment.number} · ${amount} · aplicado ${sum(payment.allocations, (x) => x.amount)}`);
  return payment;
}

function applyAllocation(s, payment, a, ctx) {
  const doc = getOrFail(s.documents, a.documentId, 'la venta');
  const alloc = { id: newId('alc'), documentId: doc.id, amount: a.amount, at: nowOf(ctx), commissioned: false };
  payment.allocations.push(alloc);
  onAllocation(s, payment, alloc, doc, ctx);
  doc.history.push({ at: nowOf(ctx), action: 'abono', detail: `${payment.number} · ${a.amount}` });
  return alloc;
}

/** Aplica el saldo no aplicado de un pago a una o varias ventas. */
export function allocatePayment(s, { paymentId, allocations }, ctx) {
  const p = getOrFail(s.payments, paymentId, 'el pago');
  assert(p.status === 'activo', 'El pago fue reversado.', 'payment');
  const existing = new Set(p.allocations.map((a) => a.documentId));
  for (const a of allocations) assert(!existing.has(a.documentId) || !Number(a.amount), 'Ese pago ya está aplicado a esa venta; reversa y vuelve a registrar si necesitas corregirlo.', 'allocation');
  const allocs = validateAllocations(s, p, allocations, unappliedAmount(p));
  assert(allocs.length > 0, 'Indica cuánto aplicar.', 'allocation');
  for (const a of allocs) applyAllocation(s, p, a, ctx);
  audit(s, ctx, 'aplicar_pago', 'pago', p.id, allocs.map((a) => `${a.documentId}:${a.amount}`).join(','));
  return p;
}

/** Reversa un pago completo (rebote, error de registro). No se borra: queda
 *  con estado "reversado", motivo y fecha; la cartera y las comisiones se
 *  recalculan de forma coherente. */
export function reversePayment(s, { paymentId, reason }, ctx) {
  const p = getOrFail(s.payments, paymentId, 'el pago');
  assert(p.status === 'activo', 'Este pago ya fue reversado.', 'payment');
  assert(cleanText(reason), 'Indica el motivo de la reversión.', 'reason');
  p.status = 'reversado';
  p.reversal = { at: nowOf(ctx), reason: cleanText(reason), user: ctx?.user || 'usuario' };
  for (const a of p.allocations) {
    const doc = s.documents.find((d) => d.id === a.documentId);
    doc?.history.push({ at: nowOf(ctx), action: 'reversion_abono', detail: `${p.number} · ${a.amount} · ${cleanText(reason)}` });
  }
  onPaymentReversed(s, p, `Pago ${p.number} reversado: ${cleanText(reason)}`, ctx);
  audit(s, ctx, 'reversar_pago', 'pago', p.id, cleanText(reason));
  return p;
}

/** Libera una asignación (el dinero vuelve a "sin aplicar" del mismo pago). */
export function unapplyAllocation(s, { paymentId, allocationId, reason }, ctx) {
  const p = getOrFail(s.payments, paymentId, 'el pago');
  assert(p.status === 'activo', 'El pago fue reversado.', 'payment');
  assert(cleanText(reason), 'Indica el motivo.', 'reason');
  const idx = p.allocations.findIndex((a) => a.id === allocationId);
  assert(idx >= 0, 'Asignación no encontrada.', 'allocation');
  const [a] = p.allocations.splice(idx, 1);
  p.releasedAllocations = [...(p.releasedAllocations || []), { ...a, releasedAt: nowOf(ctx), reason: cleanText(reason) }];
  onAllocationRemoved(s, a.id, `Asignación liberada: ${cleanText(reason)}`, ctx);
  const doc = s.documents.find((d) => d.id === a.documentId);
  doc?.history.push({ at: nowOf(ctx), action: 'liberar_abono', detail: `${p.number} · ${a.amount} · ${cleanText(reason)}` });
  audit(s, ctx, 'liberar_asignacion', 'pago', p.id, cleanText(reason));
  return p;
}

/** Sugerencia de distribución: primero las ventas más antiguas por vencimiento. */
export function suggestAllocation(s, { companyId, clientId, amount }) {
  let left = amount;
  const out = [];
  const docs = s.documents
    .filter((d) => isActiveSale(d) && d.companyId === companyId && d.clientId === clientId)
    .map((d) => ({ d, bal: saleBalance(s, d) }))
    .filter((x) => x.bal > 0)
    .sort((a, b) => a.d.dueDate.localeCompare(b.d.dueDate));
  for (const { d, bal } of docs) {
    const take = Math.min(bal, left);
    out.push({ documentId: d.id, amount: take > 0 ? take : 0, balance: bal, doc: d });
    left -= Math.max(0, take);
  }
  return out;
}
