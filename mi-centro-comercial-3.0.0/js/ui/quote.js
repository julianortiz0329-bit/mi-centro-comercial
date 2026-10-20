// Textos para compartir por WhatsApp: cotización detallada y lista de precios.
import { formatDate } from '../core/dates.js';
import { formatCOP } from '../core/money.js';
import { computeLine } from '../domain/documents.js';
import { pricePerContent, withIva } from '../domain/products.js';

const num = (v) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(v);

export function quoteText(s, doc) {
  const co = s.companies[doc.companyId];
  const client = s.clients.find((c) => c.id === doc.clientId);
  const kind = { cotizacion: 'Cotización', pedido: 'Pedido', venta: 'Venta' }[doc.kind];
  const out = [`*${co.name}*`, `${kind} ${doc.number} · ${formatDate(doc.date)}`, `Cliente: ${client?.tradeName || ''}`, ''];
  for (const l of doc.lines) {
    const c = computeLine(l);
    const unit = (l.presentation || '').split(' x ')[0].toLowerCase();
    const per = l.contentQty ? ` (${formatCOP(Math.round((l.unitPrice * (1 - (l.discountPct || 0) / 100)) / l.contentQty))}/${l.contentUnit === 'und' ? 'und' : 'kg'} + IVA)` : '';
    out.push(`• *${l.presentation ? l.description.replace(` · ${l.presentation}`, '') : l.description}*${l.presentation ? ` (${l.presentation})` : ''}`);
    out.push(`  ${num(l.qty)} ${unit ? unit + (l.qty === 1 ? '' : 's') : 'und'} x ${formatCOP(l.unitPrice)} + IVA ${l.ivaPct} %${per}${l.discountPct ? ` · desc. ${num(l.discountPct)} %` : ''}`);
    out.push(`  Subtotal: ${formatCOP(c.net)} · con IVA ${formatCOP(c.total)}`);
  }
  out.push('', `Valor antes de IVA: ${formatCOP(doc.totals.net)}`, `IVA: ${formatCOP(doc.totals.iva)}`, `*Total: ${formatCOP(doc.totals.total)}*`);
  if (doc.kind !== 'cotizacion') out.push(`Condición de pago: ${doc.term.days === 0 ? 'contado' : `${doc.term.days} días`}`);
  if (doc.validUntil) out.push(`Válida hasta: ${formatDate(doc.validUntil)}`);
  if (doc.notes) out.push('', doc.notes);
  if (s.settings.sellerName) out.push('', `Atentamente, ${s.settings.sellerName}`);
  return out.join('\n');
}

export function priceListText(s, companyId, items) {
  const out = [`*Lista de precios · ${s.companies[companyId].name}*`, `Actualizada: ${formatDate(new Date().toISOString())}`, 'Precios antes de IVA, por presentación completa.', ''];
  let cat = null;
  for (const p of items) {
    if (p.category !== cat) {
      cat = p.category;
      out.push('', `*${cat || 'Otros'}*`);
    }
    const per = pricePerContent(p);
    out.push(`• ${p.name} — ${p.presentation}: ${formatCOP(p.price)} + IVA ${p.ivaPct} % (neto ${formatCOP(withIva(p.price, p.ivaPct))})${per ? ` · ${formatCOP(per)}/${p.contentUnit === 'und' ? 'und' : 'kg'}` : ''}`);
  }
  return out.join('\n');
}
