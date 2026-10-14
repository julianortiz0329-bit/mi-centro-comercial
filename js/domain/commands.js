// Comandos compuestos que deben ser atómicos (todo o nada).
import { createDocument, convertDocument } from './documents.js';
import { registerPayment } from './payments.js';

/** Venta de contado con el pago recibido en el mismo momento. */
export function createSaleWithPayment(s, input, ctx) {
  const { payment, ...docInput } = input;
  const doc = input.convertFrom
    ? convertDocument(s, { ...docInput, documentId: input.convertFrom, toKind: 'venta' }, ctx)
    : createDocument(s, docInput, ctx);
  if (payment) {
    registerPayment(s, {
      companyId: doc.companyId,
      clientId: doc.clientId,
      date: doc.date,
      time: doc.time,
      amount: doc.totals.total,
      method: payment.method,
      reference: payment.reference,
      notes: `Pago de contado de ${doc.number}`,
      allocations: [{ documentId: doc.id, amount: doc.totals.total }],
      requestId: input.requestId ? `${input.requestId}:pago` : null,
      confirm: input.confirm,
    }, ctx);
  }
  return doc;
}
