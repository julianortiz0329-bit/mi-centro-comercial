// Indicadores del tablero, metas y reportes. Todo sale del libro único.
import { localDate, periodOf } from '../core/dates.js';
import { sum } from '../core/money.js';
import { commissionSummary, thresholdStatus } from './commissions.js';
import { isActiveSale, receivables, unappliedAmount } from './ledger.js';
import { ACTIVE_COMPANY_IDS } from './schema.js';

export function scopeCompanies(scope) {
  return scope && scope !== 'todas' ? [scope] : ACTIVE_COMPANY_IDS;
}

export function goalFor(s, companyId, period) {
  const g = s.settings.goals?.[companyId] || {};
  const p = g.byPeriod?.[period] || {};
  return { sales: p.sales ?? g.sales ?? 0, collection: p.collection ?? g.collection ?? 0 };
}

export function periodMetrics(s, companyId, period) {
  const sales = s.documents.filter((d) => isActiveSale(d) && d.companyId === companyId && periodOf(d.date) === period);
  const payments = s.payments.filter((p) => p.status === 'activo' && p.companyId === companyId && periodOf(p.date) === period);
  const collectedApplied = sum(payments, (p) => sum(p.allocations, (a) => a.amount));
  return {
    salesTotal: sum(sales, (d) => d.totals.total),
    salesNet: sum(sales, (d) => d.totals.net),
    salesCount: sales.length,
    collected: sum(payments, (p) => p.amount),
    collectedApplied,
    goal: goalFor(s, companyId, period),
  };
}

export function dashboard(s, scope, today = localDate()) {
  const period = today.slice(0, 7);
  const cos = scopeCompanies(scope);
  const per = {};
  for (const co of cos) {
    const rec = receivables(s, { companyId: co, today });
    const pm = periodMetrics(s, co, period);
    const openOrders = s.documents.filter((d) => d.kind === 'pedido' && d.companyId === co && ['pendiente_confirmacion', 'confirmado', 'en_preparacion', 'despacho_parcial'].includes(d.status));
    per[co] = {
      ...pm,
      receivable: sum(rec, (r) => r.balance),
      overdue: sum(rec.filter((r) => r.daysLate > 0), (r) => r.balance),
      overdueClients: new Set(rec.filter((r) => r.daysLate > 0).map((r) => r.doc.clientId)).size,
      receivableCount: rec.length,
      pendingOrders: openOrders.filter((d) => d.status !== 'despacho_parcial').length,
      pendingDispatch: openOrders.filter((d) => ['confirmado', 'en_preparacion', 'despacho_parcial'].includes(d.status)).length,
      unapplied: sum(s.payments.filter((p) => p.companyId === co), unappliedAmount),
      commissions: commissionSummary(s, { companyId: co }),
      commissionsPeriod: commissionSummary(s, { companyId: co, period }),
      threshold: thresholdStatus(s, co, period),
    };
  }
  const total = (k) => sum(cos, (co) => per[co][k]);
  return {
    period,
    per,
    total: {
      salesTotal: total('salesTotal'),
      salesNet: total('salesNet'),
      collected: total('collected'),
      receivable: total('receivable'),
      overdue: total('overdue'),
      overdueClients: total('overdueClients'),
      pendingOrders: total('pendingOrders'),
      pendingDispatch: total('pendingDispatch'),
      unapplied: total('unapplied'),
      commissionPending: sum(cos, (co) => per[co].commissions.pending),
      commissionSettled: sum(cos, (co) => per[co].commissions.settled),
      commissionPaid: sum(cos, (co) => per[co].commissions.paid),
      commissionPeriod: sum(cos, (co) => per[co].commissionsPeriod.generated),
    },
  };
}

/** Clientes más importantes por ventas en los últimos 12 meses (por empresa). */
export function topClients(s, scope, limit = 5, today = localDate()) {
  const cos = scopeCompanies(scope);
  const from = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const map = new Map();
  for (const d of s.documents) {
    if (!isActiveSale(d) || !cos.includes(d.companyId) || d.date < from) continue;
    map.set(d.clientId, (map.get(d.clientId) || 0) + d.totals.total);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([clientId, total]) => ({ clientId, total }));
}

/** Serie de los últimos n meses (ventas y recaudo) por empresa. */
export function monthlySeries(s, companyId, months = 6, today = localDate()) {
  const out = [];
  const [y, m] = today.slice(0, 7).split('-').map(Number);
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const pm = periodMetrics(s, companyId, period);
    out.push({ period, sales: pm.salesNet, collected: pm.collected });
  }
  return out;
}
