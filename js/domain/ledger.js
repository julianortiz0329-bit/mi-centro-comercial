// Cartera: saldos calculados SIEMPRE desde las ventas y las asignaciones de
// pagos activos. No existe un campo "saldo" editable.
import { diffDays, localDate } from '../core/dates.js';
import { sum } from '../core/money.js';

export function isActiveSale(d) {
  return d.kind === 'venta' && d.status === 'emitida';
}

/** Asignaciones activas (de pagos no reversados) sobre un documento. */
export function allocationsFor(s, documentId) {
  const out = [];
  for (const p of s.payments) {
    if (p.status !== 'activo') continue;
    for (const a of p.allocations) if (a.documentId === documentId) out.push({ ...a, payment: p });
  }
  return out;
}

export function paidAmount(s, documentId) {
  return sum(allocationsFor(s, documentId), (a) => a.amount);
}

export function saleBalance(s, doc) {
  if (!isActiveSale(doc)) return 0;
  return doc.totals.total - paidAmount(s, doc.id);
}

export function clientCompanyBalance(s, clientId, companyId) {
  return sum(
    s.documents.filter((d) => isActiveSale(d) && d.clientId === clientId && d.companyId === companyId),
    (d) => saleBalance(s, d),
  );
}

/** Saldo de un pago aún no aplicado a ninguna cuenta. */
export function unappliedAmount(p) {
  if (p.status !== 'activo') return 0;
  return p.amount - sum(p.allocations, (a) => a.amount);
}

/** Clasificación por edades según los rangos configurados. */
export function agingBucket(daysLate, buckets = [30, 60, 90]) {
  if (daysLate <= 0) return { key: 'por_vencer', label: 'Por vencer' };
  let prev = 0;
  for (const b of buckets) {
    if (daysLate <= b) return { key: `d${prev + 1}_${b}`, label: `Vencida ${prev + 1} a ${b} días` };
    prev = b;
  }
  return { key: `d${prev}_mas`, label: `Vencida más de ${prev} días` };
}

export function agingKeys(buckets = [30, 60, 90]) {
  const out = [{ key: 'por_vencer', label: 'Por vencer' }];
  let prev = 0;
  for (const b of buckets) {
    out.push({ key: `d${prev + 1}_${b}`, label: `${prev + 1}–${b} días` });
    prev = b;
  }
  out.push({ key: `d${prev}_mas`, label: `+${prev} días` });
  return out;
}

/** Última gestión y promesa por documento. */
function collectionInfo(s, docId) {
  const acts = s.activities.filter((a) => a.documentId === docId).sort((a, b) => b.at.localeCompare(a.at));
  const lastContact = acts.find((a) => ['llamada', 'visita', 'whatsapp', 'no_contactado', 'promesa', 'seguimiento'].includes(a.type));
  const lastPromise = acts.find((a) => a.type === 'promesa');
  const next = acts.find((a) => a.nextAction?.date);
  return { lastContact, lastPromise, nextAction: next?.nextAction || null };
}

/** Cuentas por cobrar enriquecidas para la vista de cartera. */
export function receivables(s, { companyId = null, includePaid = false, today = localDate() } = {}) {
  const buckets = s.settings.agingBuckets;
  const out = [];
  for (const d of s.documents) {
    if (!isActiveSale(d)) continue;
    if (companyId && d.companyId !== companyId) continue;
    const paid = paidAmount(s, d.id);
    const balance = d.totals.total - paid;
    if (!includePaid && balance <= 0) continue;
    const daysLate = d.dueDate ? diffDays(d.dueDate, today) : 0;
    const info = collectionInfo(s, d.id);
    const promise = info.lastPromise?.promise;
    const brokenPromise = promise && promise.status === 'pendiente' && promise.date < today;
    const bucket = balance <= 0 ? { key: 'pagada', label: 'Pagada' } : d.dispute?.active ? { key: 'disputa', label: 'En disputa' } : agingBucket(daysLate, buckets);
    // Prioridad: mora, promesa incumplida, monto y próxima acción vencida.
    const priority = balance <= 0 ? -1 : Math.max(0, daysLate) * 2 + (brokenPromise ? 60 : 0) + Math.min(50, Math.floor(balance / 500000)) + (info.nextAction && info.nextAction.date <= today ? 15 : 0) + (daysLate === 0 ? 5 : 0);
    out.push({ doc: d, paid, balance, daysLate, bucket, lastContact: info.lastContact || null, lastPromise: info.lastPromise || null, brokenPromise: !!brokenPromise, nextAction: info.nextAction, priority });
  }
  return out.sort((a, b) => b.priority - a.priority || a.doc.dueDate.localeCompare(b.doc.dueDate));
}
