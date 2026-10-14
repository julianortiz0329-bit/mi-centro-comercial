// Migración de la versión 1 (localStorage 'miCentroComercial_v1') a la v2.
// Reglas: no se pierde ningún registro, no se inventan datos y no se generan
// comisiones retroactivas. La clave v1 se deja intacta como respaldo.
import { newId } from '../core/ids.js';
import { diffDays, isValidDate, localDate, toInstant } from '../core/dates.js';
import { parsePesos, sum } from '../core/money.js';
import { nextNumber } from './common.js';
import { emptyState } from './schema.js';

export const V1_KEY = 'miCentroComercial_v1';

const BIZ = ['nogal', 'puntazo', 'pethome'];
const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const normPhone = (s) => String(s || '').replace(/\D/g, '').slice(-10);
const money = (v) => {
  const n = parsePesos(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const dateOr = (v, fallback) => (isValidDate(String(v || '').slice(0, 10)) ? String(v).slice(0, 10) : fallback);

/** Estimación que mostraba la v1 (solo para el informe; no se usa en cálculos). */
function v1Estimate(o) {
  const amount = money(o.amount);
  const paid = Math.min(amount, money(o.paid));
  if (o.business === 'nogal') {
    const r = o.saleType === 'mayorista' ? 0.004 : 0.0075;
    return Math.round(amount * r + paid * r);
  }
  if (o.business === 'puntazo') return Math.round(paid * 0.06);
  return 0;
}

export function migrateV1(raw, { now = new Date().toISOString() } = {}) {
  const v1 = raw && typeof raw === 'object' ? raw : {};
  const s = emptyState();
  const today = localDate(new Date(now));
  const report = { clients: 0, mergedClients: [], clientsCreatedFromOrders: [], orders: 0, payments: 0, paymentGaps: [], dispatches: 0, tasks: 0, petHomeProducts: 0, petHomeSuppliers: 0, v1CommissionEstimate: { nogal: 0, puntazo: 0 }, warnings: [] };
  const index = new Map(); // `${normName}|${normPhone}` -> client (para unir el mismo cliente en dos negocios)
  const byBizName = new Map(); // `${biz}|${normName}` -> client

  const addClient = (data, biz) => {
    const key = `${normName(data.name)}|${normPhone(data.phone)}`;
    let c = normPhone(data.phone).length >= 7 ? index.get(key) : null;
    if (c) {
      if (!c.companyIds.includes(biz)) {
        c.companyIds.push(biz);
        report.mergedClients.push(c.tradeName);
      }
      if (data.notes && !c.notes.includes(data.notes)) c.notes = [c.notes, data.notes].filter(Boolean).join('\n');
    } else {
      s.counters.client = (s.counters.client || 0) + 1;
      c = {
        id: newId('cli'),
        code: `CL-${String(s.counters.client).padStart(5, '0')}`,
        tradeName: String(data.name || 'Cliente sin nombre').trim().slice(0, 200),
        legalName: '', taxId: '', contactName: '', phone: String(data.phone || '').trim(), whatsapp: '', email: '', department: '',
        city: String(data.city || '').trim(), address: '', directions: '', category: String(data.activity || '').trim(),
        notes: String(data.notes || '').trim(), companyIds: [biz], status: 'activo', tags: ['migrado-v1'], terms: {},
        nextVisit: null, lastPurchase: dateOr(data.lastOrder, null), lastContact: null,
        legacy: { v1Id: data.id || null, lastOrderValue: money(data.orderValue) || null },
        createdAt: data.createdAt || now, updatedAt: now,
      };
      if (c.legacy.lastOrderValue) c.notes = [c.notes, `Valor del último pedido según la versión 1: ${c.legacy.lastOrderValue} COP.`].filter(Boolean).join('\n');
      s.clients.push(c);
      if (normPhone(data.phone).length >= 7) index.set(key, c);
      report.clients++;
    }
    byBizName.set(`${biz}|${normName(c.tradeName)}`, c);
    return c;
  };

  for (const c of Array.isArray(v1.clients) ? v1.clients : []) {
    const biz = BIZ.includes(c.business) ? c.business : 'nogal';
    const cl = addClient(c, biz);
    if (c.followUp && isValidDate(c.followUp)) {
      s.tasks.push({ id: newId('tsk'), title: `Seguimiento a ${cl.tradeName} (migrado)`, type: 'llamada', date: c.followUp, time: '', companyId: biz, clientId: cl.id, documentId: null, notes: '', done: false, doneAt: null, result: '', createdAt: now });
      report.tasks++;
    }
  }

  for (const o of Array.isArray(v1.orders) ? v1.orders : []) {
    const biz = BIZ.includes(o.business) ? o.business : 'nogal';
    let client = byBizName.get(`${biz}|${normName(o.customer)}`);
    if (!client) {
      client = addClient({ name: o.customer || 'Cliente sin nombre', phone: o.phone, notes: '' }, biz);
      report.clientsCreatedFromOrders.push(client.tradeName);
    } else if (!client.phone && o.phone) client.phone = String(o.phone);
    const amount = money(o.amount);
    const date = dateOr(o.orderDate, dateOr(o.createdAt, today));
    const due = dateOr(o.dueDate, date);
    const lineId = newId('ln');
    const doc = {
      id: newId('doc'),
      number: nextNumber(s, biz, 'venta'),
      externalRef: String(o.orderNo || '').slice(0, 60),
      companyId: biz,
      clientId: client.id,
      kind: 'venta',
      status: 'emitida',
      date,
      time: '12:00',
      occurredAt: toInstant(date, '12:00'),
      lines: [{ id: lineId, productId: null, description: `Pedido migrado de la versión 1${o.orderNo ? ' · ' + o.orderNo : ''}`, presentation: '', qty: 1, unitPrice: amount, discountPct: 0, ivaPct: 0 }],
      totals: { gross: amount, discount: 0, net: amount, iva: 0, total: amount },
      saleMode: biz === 'nogal' ? (o.saleType === 'normal' ? 'normal' : 'mayorista') : null,
      term: { days: Math.max(0, diffDays(date, due)), source: 'migrado' },
      dueDate: due,
      notes: String(o.notes || ''),
      sourceId: null,
      requestId: null,
      legacy: { v1Id: o.id || null, ivaUnknown: true, v1Paid: money(o.paid) },
      commission: { saleEligible: false, period: date.slice(0, 7), reason: 'Venta migrada de la versión 1: sin evidencia de elegibilidad ni desglose de IVA.' },
      voided: null,
      history: [{ at: now, action: 'migrado', detail: 'Importado desde la versión 1' }],
      createdAt: o.createdAt || now,
      updatedAt: now,
    };
    if (amount <= 0) report.warnings.push(`Pedido ${o.orderNo || o.id || ''} de ${client.tradeName} con valor 0.`);
    s.documents.push(doc);
    report.orders++;
    if (biz in report.v1CommissionEstimate) report.v1CommissionEstimate[biz] += v1Estimate(o);
    if (!client.lastPurchase || client.lastPurchase < date) client.lastPurchase = date;

    if (o.dispatchDate && isValidDate(o.dispatchDate)) {
      s.dispatches.push({ id: newId('dsp'), companyId: biz, documentId: doc.id, date: o.dispatchDate, lines: [{ lineId, qty: 1 }], carrier: '', guide: String(o.dispatchRef || ''), notes: 'Migrado de la versión 1', requestId: null, createdAt: now, voided: null });
      doc.dispatchStatus = 'completo';
      report.dispatches++;
    }

    // Pagos: se respeta el "total cobrado" que mostraba la v1.
    const paidTarget = Math.min(amount, money(o.paid));
    let left = paidTarget;
    const list = (Array.isArray(o.payments) ? o.payments : []).map((p) => ({ amount: money(p.amount), date: dateOr(p.date, date), notes: String(p.notes || '') }));
    const makePayment = (amt, pdate, notes) => {
      s.payments.push({
        id: newId('pay'), number: nextNumber(s, biz, 'pago'), companyId: biz, clientId: client.id, receivedAt: toInstant(pdate, '12:00'), date: pdate, amount: amt, method: 'otro', reference: '', notes,
        allocations: [{ id: newId('alc'), documentId: doc.id, amount: amt, at: now, commissioned: false }],
        status: 'activo', reversal: null, requestId: null, legacy: true, createdAt: now,
      });
      report.payments++;
    };
    for (const p of list) {
      if (left <= 0 || p.amount <= 0) continue;
      const amt = Math.min(p.amount, left);
      makePayment(amt, p.date, ['Migrado de la versión 1', p.notes].filter(Boolean).join(' · '));
      left -= amt;
    }
    if (left > 0) {
      makePayment(left, dateOr(o.lastPaymentDate, date), 'Cobrado según la versión 1 (sin detalle de abonos)');
      report.paymentGaps.push(`${doc.number}: ${left} COP registrados en v1 sin detalle de abono.`);
    }
    const listed = sum(list, (p) => p.amount);
    if (listed > paidTarget) report.warnings.push(`${doc.number}: los abonos listados (${listed}) superaban el total cobrado (${paidTarget}); se respetó el total cobrado.`);
  }

  const st = v1.settings || {};
  for (const t of Array.isArray(st.agendaTasks) ? st.agendaTasks : []) {
    if (!t?.title || !isValidDate(t.date)) continue;
    s.tasks.push({ id: newId('tsk'), title: String(t.title), type: t.type || 'otro', date: t.date, time: '', companyId: BIZ.includes(t.business) ? t.business : null, clientId: null, documentId: null, notes: String(t.notes || ''), done: !!t.done, doneAt: t.done ? now : null, result: '', createdAt: t.createdAt || now });
    report.tasks++;
  }
  const goals = st.salesGoals || {};
  for (const co of ['nogal', 'puntazo']) if (money(goals[co])) s.settings.goals[co].sales = money(goals[co]);
  s.settings.notifications = !!st.agendaNotifications;

  s.legacy.petHome = {
    products: Array.isArray(v1.products) ? v1.products : [],
    suppliers: Array.isArray(v1.suppliers) ? v1.suppliers : [],
    salesGoal: money(goals.pethome) || 0,
  };
  report.petHomeProducts = s.legacy.petHome.products.length;
  report.petHomeSuppliers = s.legacy.petHome.suppliers.length;

  s.meta.migratedFrom = 'v1';
  s.meta.migratedAt = now;
  s.meta.migrationReport = report;
  s.audit.push({ id: newId('aud'), at: now, user: 'sistema', action: 'migracion', entity: 'datos', entityId: 'v1', detail: JSON.stringify({ clientes: report.clients, pedidos: report.orders, pagos: report.payments }) });
  return { state: s, report };
}
