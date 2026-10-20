// Memoria de precios por cliente: el último precio negociado con un cliente
// para cada producto (en cotizaciones, pedidos o ventas vigentes).
const VALID = (d) => !['cancelado', 'anulada', 'rechazada'].includes(d.status);

const keyOf = (l) => l.productId || `txt:${String(l.description || '').toLowerCase().trim()}`;

/** Último precio que se le dio a este cliente para este producto. */
export function lastPriceFor(s, { clientId, companyId, productId, description = '' }) {
  const key = productId || `txt:${description.toLowerCase().trim()}`;
  let best = null;
  for (const d of s.documents) {
    if (d.clientId !== clientId || d.companyId !== companyId || !VALID(d)) continue;
    for (const l of d.lines) {
      if (keyOf(l) !== key) continue;
      const at = d.occurredAt || d.createdAt;
      if (!best || at > best.at || (at === best.at && d.createdAt > best.doc.createdAt)) best = { at, doc: d, line: l };
    }
  }
  if (!best) return null;
  return { unitPrice: best.line.unitPrice, discountPct: best.line.discountPct || 0, ivaPct: best.line.ivaPct, date: best.doc.date, number: best.doc.number, kind: best.doc.kind };
}

/** Lista de últimos precios por producto para la ficha del cliente. */
export function clientPriceList(s, { clientId, companyId }) {
  const map = new Map();
  for (const d of s.documents) {
    if (d.clientId !== clientId || d.companyId !== companyId || !VALID(d)) continue;
    for (const l of d.lines) {
      const k = keyOf(l);
      const at = d.occurredAt || d.createdAt;
      const prev = map.get(k);
      if (!prev || at > prev.at) map.set(k, { at, description: l.description, presentation: l.presentation, productId: l.productId, unitPrice: l.unitPrice, discountPct: l.discountPct || 0, ivaPct: l.ivaPct, date: d.date, number: d.number, documentId: d.id, listPrice: s.products.find((p) => p.id === l.productId)?.price ?? null });
    }
  }
  return [...map.values()].sort((a, b) => a.description.localeCompare(b.description, 'es'));
}

/** Último pedido o venta vigente del cliente en la empresa (para repetirlo). */
export function lastOrderFor(s, { clientId, companyId }) {
  return s.documents
    .filter((d) => d.clientId === clientId && d.companyId === companyId && (d.kind === 'pedido' || d.kind === 'venta') && VALID(d))
    .sort((a, b) => (b.occurredAt || '').localeCompare(a.occurredAt || '') || b.createdAt.localeCompare(a.createdAt))[0] || null;
}
