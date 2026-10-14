// Análisis de productos: más y menos vendidos por mes, y clientes que dejaron
// de comprar un producto que solían llevar.
import { diffDays, periodOf } from '../core/dates.js';
import { computeLine } from './documents.js';
import { isActiveSale } from './ledger.js';

const keyOf = (l) => l.productId || `txt:${String(l.description || '').toLowerCase().trim()}`;

/** Ventas por producto en un periodo (solo ventas vigentes). */
export function productSales(s, { companyId, period }) {
  const map = new Map();
  for (const d of s.documents) {
    if (!isActiveSale(d) || d.companyId !== companyId || periodOf(d.date) !== period) continue;
    for (const l of d.lines) {
      const k = keyOf(l);
      const r = map.get(k) || { key: k, productId: l.productId, name: l.description, presentation: l.presentation || '', qty: 0, content: 0, contentUnit: l.contentUnit || null, net: 0, clients: new Set(), docs: 0 };
      r.qty = Math.round((r.qty + l.qty) * 1000) / 1000;
      if (l.contentQty) r.content = Math.round((r.content + l.qty * l.contentQty) * 100) / 100;
      r.net += computeLine(l).net;
      r.clients.add(d.clientId);
      r.docs += 1;
      map.set(k, r);
    }
  }
  const rows = [...map.values()].map((r) => ({ ...r, clients: r.clients.size })).sort((a, b) => b.net - a.net);
  const sold = new Set(rows.map((r) => r.productId).filter(Boolean));
  const notSold = s.products.filter((p) => p.companyId === companyId && p.active && !sold.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return { rows, notSold, totalNet: rows.reduce((a, r) => a + r.net, 0) };
}

/**
 * Clientes que compraban un producto con regularidad y dejaron de hacerlo:
 * al menos `minPurchases` compras en los últimos `lookbackDays` días y ninguna
 * en los últimos `silenceDays` días.
 */
export function lostProductBuyers(s, { companyId, today, lookbackDays = 365, silenceDays = 60, minPurchases = 2 }) {
  const map = new Map();
  for (const d of s.documents) {
    if (!isActiveSale(d) || d.companyId !== companyId) continue;
    const age = diffDays(d.date, today);
    if (age < 0 || age > lookbackDays) continue;
    for (const l of d.lines) {
      const k = `${d.clientId}|${keyOf(l)}`;
      const r = map.get(k) || { clientId: d.clientId, productId: l.productId, name: l.description, dates: new Set(), qty: 0, last: null };
      r.dates.add(d.date);
      r.qty += l.qty;
      if (!r.last || d.date > r.last) r.last = d.date;
      map.set(k, r);
    }
  }
  return [...map.values()]
    .filter((r) => r.dates.size >= minPurchases && diffDays(r.last, today) >= silenceDays)
    .map((r) => ({ clientId: r.clientId, productId: r.productId, name: r.name, times: r.dates.size, avgQty: Math.round((r.qty / r.dates.size) * 100) / 100, last: r.last, daysSince: diffDays(r.last, today) }))
    .sort((a, b) => b.times - a.times || b.daysSince - a.daysSince);
}
