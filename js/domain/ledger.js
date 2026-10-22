// Libro de socios de Alegría Pet Home: gastos, aportes, retiros, cuentas
// (caja y bancos), traslados, estado de resultados del mes y reparto de la
// utilidad entre los socios. Montos en pesos enteros. Nada se borra: los
// movimientos se anulan con motivo.
import { newId } from '../core/ids.js';
import { addDays, diffDays, isValidDate, localDate, periodOf } from '../core/dates.js';
import { parsePesos } from '../core/money.js';
import { assert, audit, cleanText, getOrFail, nowOf } from './common.js';
import { purchaseTotals, saleTotals } from './pethome.js';

export const EXPENSE_CATEGORIES = {
  publicidad: 'Publicidad y redes',
  envios: 'Envíos y domicilios',
  empaques: 'Empaques y etiquetas',
  pasarelas: 'Comisiones (Shopify, pasarelas, bancos)',
  tienda: 'Tienda en línea y dominio',
  transporte: 'Transporte',
  ferias: 'Ferias y eventos',
  fotos: 'Fotos y contenido',
  papeleria: 'Papelería',
  servicios: 'Servicios (internet, teléfono)',
  impuestos: 'Impuestos y trámites',
  otros: 'Otros gastos',
};
export const ACCOUNT_KINDS = { efectivo: 'Efectivo', banco: 'Cuenta de banco', billetera: 'Nequi / Daviplata' };
export const CONTRIBUTION_KINDS = { capital: 'Aporte de capital', prestamo: 'Préstamo al negocio' };
export const WITHDRAWAL_KINDS = { utilidad: 'Retiro de utilidades', reembolso: 'Reembolso de gastos', devolucion: 'Devolución de aporte o préstamo' };

export function emptyLedger() {
  return { accounts: [], expenses: [], contributions: [], withdrawals: [], transfers: [] };
}

const L = (s) => {
  if (!s.ledger) s.ledger = emptyLedger();
  return s.ledger;
};
const peso = (v, label) => {
  const n = typeof v === 'number' ? v : parsePesos(v);
  assert(Number.isSafeInteger(n) && n > 0, `${label} debe ser un valor en pesos mayor que cero.`, 'money');
  return n;
};
const dateOf = (d) => {
  const v = d || localDate();
  assert(isValidDate(v), 'La fecha no es válida.', 'date');
  return v;
};
const by = (ctx) => cleanText(ctx?.user, 60) || null;
const nextNum = (list, prefix) => `${prefix}-${String(list.reduce((m, x) => Math.max(m, Number(String(x.number || '').split('-')[1]) || 0), 0) + 1).padStart(4, '0')}`;
const active = (x) => x.status !== 'anulado';
const socioOf = (s, id) => {
  const so = (s.socios || []).find((x) => x.id === id);
  assert(so, 'Escoge el socio.', 'socio');
  return so;
};

/* ---------------- Cuentas ---------------- */
export const DEFAULT_ACCOUNTS = [
  { name: 'Efectivo', kind: 'efectivo', method: 'efectivo' },
  { name: 'Nequi', kind: 'billetera', method: 'nequi' },
  { name: 'Bancolombia', kind: 'banco', method: 'bancolombia' },
];

export function ensureAccounts(s, _input, ctx) {
  const l = L(s);
  if (l.accounts.length) return 0;
  for (const a of DEFAULT_ACCOUNTS) l.accounts.push({ id: newId('acc'), ...a, initial: 0, active: true, createdAt: nowOf(ctx) });
  return l.accounts.length;
}

export function saveAccount(s, input, ctx) {
  const l = L(s);
  const name = cleanText(input.name, 60);
  assert(name, 'Escribe el nombre de la cuenta.', 'name');
  const initial = input.initial === '' || input.initial === undefined || input.initial === null ? 0 : typeof input.initial === 'number' ? input.initial : parsePesos(input.initial);
  assert(Number.isSafeInteger(initial), 'El saldo inicial debe ser un valor en pesos.', 'money');
  const data = { name, kind: ACCOUNT_KINDS[input.kind] ? input.kind : 'banco', method: cleanText(input.method, 30) || null, initial, active: input.active !== false };
  if (input.id) {
    const a = getOrFail(l.accounts, input.id, 'la cuenta');
    Object.assign(a, data, { updatedAt: nowOf(ctx) });
    return a;
  }
  const a = { id: newId('acc'), ...data, createdAt: nowOf(ctx) };
  l.accounts.push(a);
  audit(s, ctx, 'crear', 'cuenta', a.id, name);
  return a;
}

/* ---------------- Gastos ---------------- */
/** IVA incluido en un gasto (el valor registrado es lo que se pagó, con IVA). */
export function expenseIva(e) {
  const p = Number(e.ivaPct) || 0;
  return p ? Math.round((e.amount * p) / (100 + p)) : 0;
}
/** Lo que el gasto le cuesta al negocio: sin IVA si Alegría lo puede descontar. */
export function expenseCost(e, ivaResponsable) {
  return ivaResponsable ? e.amount - expenseIva(e) : e.amount;
}

/** payer: id de una cuenta del negocio, o "socio:<id>" si lo pagó un socio de su bolsillo. */
export function addExpense(s, input, ctx) {
  const l = L(s);
  if (input.requestId) {
    const dup = l.expenses.find((x) => x.requestId === input.requestId);
    if (dup) return dup;
  }
  const description = cleanText(input.description, 160);
  assert(description, 'Escribe en qué se gastó.', 'description');
  const payer = String(input.payer || '');
  if (payer.startsWith('socio:')) socioOf(s, payer.slice(6));
  else getOrFail(l.accounts, payer, 'la cuenta con que se pagó');
  const e = {
    id: newId('gas'),
    number: nextNum(l.expenses, 'GA'),
    date: dateOf(input.date),
    category: EXPENSE_CATEGORIES[input.category] ? input.category : 'otros',
    description,
    amount: peso(input.amount, 'El valor'),
    payer,
    ivaPct: [0, 5, 19].includes(Number(input.ivaPct)) ? Number(input.ivaPct) : 0,
    receiptId: input.receiptId || null,
    notes: cleanText(input.notes, 600),
    status: 'activo',
    requestId: input.requestId || null,
    createdBy: by(ctx),
    createdAt: nowOf(ctx),
  };
  l.expenses.push(e);
  audit(s, ctx, 'crear', 'gasto', e.id, `${e.number} · ${e.amount}`);
  return e;
}

/* ---------------- Aportes y retiros de socios ---------------- */
export function addContribution(s, input, ctx) {
  const l = L(s);
  if (input.requestId) {
    const dup = l.contributions.find((x) => x.requestId === input.requestId);
    if (dup) return dup;
  }
  const so = socioOf(s, input.socioId);
  getOrFail(l.accounts, input.accountId, 'la cuenta donde entró el dinero');
  const c = { id: newId('apo'), number: nextNum(l.contributions, 'AP'), date: dateOf(input.date), socioId: so.id, amount: peso(input.amount, 'El aporte'), accountId: input.accountId, kind: CONTRIBUTION_KINDS[input.kind] ? input.kind : 'capital', notes: cleanText(input.notes, 600), status: 'activo', requestId: input.requestId || null, createdBy: by(ctx), createdAt: nowOf(ctx) };
  l.contributions.push(c);
  audit(s, ctx, 'crear', 'aporte', c.id, `${so.nombre} · ${c.amount}`);
  return c;
}

export function addWithdrawal(s, input, ctx) {
  const l = L(s);
  if (input.requestId) {
    const dup = l.withdrawals.find((x) => x.requestId === input.requestId);
    if (dup) return dup;
  }
  const so = socioOf(s, input.socioId);
  getOrFail(l.accounts, input.accountId, 'la cuenta de donde salió el dinero');
  const w = { id: newId('ret'), number: nextNum(l.withdrawals, 'RT'), date: dateOf(input.date), socioId: so.id, amount: peso(input.amount, 'El retiro'), accountId: input.accountId, kind: WITHDRAWAL_KINDS[input.kind] ? input.kind : 'utilidad', notes: cleanText(input.notes, 600), status: 'activo', requestId: input.requestId || null, createdBy: by(ctx), createdAt: nowOf(ctx) };
  l.withdrawals.push(w);
  audit(s, ctx, 'crear', 'retiro', w.id, `${so.nombre} · ${w.amount}`);
  return w;
}

/* ---------------- Traslados entre cuentas ---------------- */
export function addTransfer(s, input, ctx) {
  const l = L(s);
  getOrFail(l.accounts, input.from, 'la cuenta de origen');
  getOrFail(l.accounts, input.to, 'la cuenta de destino');
  assert(input.from !== input.to, 'Escoge dos cuentas distintas.', 'account');
  const t = { id: newId('tra'), number: nextNum(l.transfers, 'TR'), date: dateOf(input.date), from: input.from, to: input.to, amount: peso(input.amount, 'El valor'), notes: cleanText(input.notes, 300), status: 'activo', createdBy: by(ctx), createdAt: nowOf(ctx) };
  l.transfers.push(t);
  audit(s, ctx, 'crear', 'traslado', t.id, `${t.amount}`);
  return t;
}

const COLLECTION = { gasto: 'expenses', aporte: 'contributions', retiro: 'withdrawals', traslado: 'transfers' };
export function voidMovement(s, { kind, id, reason }, ctx) {
  const list = L(s)[COLLECTION[kind]];
  assert(list, 'Movimiento no válido.', 'kind');
  const x = getOrFail(list, id, 'el movimiento');
  assert(x.status === 'activo', 'Ese movimiento ya está anulado.', 'status');
  assert(cleanText(reason), 'Indica el motivo.', 'reason');
  x.status = 'anulado';
  x.voided = { at: nowOf(ctx), by: by(ctx), reason: cleanText(reason, 300) };
  audit(s, ctx, 'anular', kind, id, cleanText(reason));
  return x;
}

/* ---------------- Cálculos ---------------- */
/** Costo de una línea vendida: el de la venta, o el costo actual del producto si faltó. */
function lineCost(st, l) {
  if (Number.isSafeInteger(l.unitCost)) return { cost: Math.round(l.unitCost * l.qty), estimated: false, missing: false };
  const p = l.productId && st.products.find((x) => x.id === l.productId);
  if (p && Number.isSafeInteger(p.cost)) return { cost: Math.round(p.cost * l.qty), estimated: true, missing: false };
  return { cost: 0, estimated: false, missing: true };
}

/** Estado de resultados del mes y la parte de cada socio. */
export function monthResult(s, period = localDate().slice(0, 7)) {
  const st = s.pethome;
  const l = L(s);
  const sales = st.sales.filter((x) => x.status === 'activa' && periodOf(x.date) === period);
  let revenue = 0;
  let ivaSales = 0;
  let cogs = 0;
  let shippingCost = 0;
  let estimated = 0;
  let missing = 0;
  for (const x of sales) {
    const t = saleTotals(x);
    revenue += t.total - t.iva; // la venta sin IVA: el IVA es de la DIAN
    ivaSales += t.iva;
    shippingCost += x.shippingCost || 0;
    for (const ln of x.lines) {
      const c = lineCost(st, ln);
      cogs += c.cost;
      if (c.estimated) estimated++;
      if (c.missing) missing++;
    }
  }
  const expenses = l.expenses.filter((x) => active(x) && periodOf(x.date) === period);
  const byCategory = {};
  const resp = !!st.profile?.ivaResponsable;
  for (const e of expenses) byCategory[e.category] = (byCategory[e.category] || 0) + expenseCost(e, resp);
  const expenseTotal = expenses.reduce((a, e) => a + expenseCost(e, resp), 0);
  const gross = revenue - cogs - shippingCost;
  const profit = gross - expenseTotal;
  const shares = splitProfit(s.socios || [], profit);
  return { period, salesCount: sales.length, revenue, ivaSales, cogs, shippingCost, gross, expenses: expenseTotal, byCategory, profit, shares, estimatedLines: estimated, missingCostLines: missing };
}

/** Reparte en pesos enteros según el porcentaje de cada socio (el residuo va al primero). */
export function splitProfit(socios, profit) {
  const out = {};
  if (!socios.length) return out;
  const total = socios.reduce((a, x) => a + Number(x.porcentaje || 0), 0) || 100;
  let given = 0;
  socios.forEach((x, i) => {
    if (i === 0) return;
    out[x.id] = Math.round((profit * Number(x.porcentaje || 0)) / total);
    given += out[x.id];
  });
  out[socios[0].id] = profit - given;
  return out;
}

/** Meses con algún movimiento, del más antiguo al más reciente, hasta hoy. */
export function activeMonths(s, until = localDate().slice(0, 7)) {
  const st = s.pethome;
  const l = L(s);
  const set = new Set();
  for (const x of st.sales) if (x.status === 'activa') set.add(periodOf(x.date));
  for (const x of l.expenses) if (active(x)) set.add(periodOf(x.date));
  return [...set].filter((p) => p <= until).sort();
}

/** Cuenta corriente de cada socio: lo que el negocio le debe (o él al negocio). */
export function partnerBalances(s, until = localDate()) {
  const l = L(s);
  const out = {};
  for (const so of s.socios || []) out[so.id] = { socio: so, contributed: 0, loans: 0, paidExpenses: 0, profit: 0, withdrawn: 0, balance: 0 };
  for (const p of activeMonths(s, until.slice(0, 7))) {
    const r = monthResult(s, p);
    for (const [id, v] of Object.entries(r.shares)) if (out[id]) out[id].profit += v;
  }
  for (const c of l.contributions.filter((x) => active(x) && x.date <= until)) if (out[c.socioId]) out[c.socioId][c.kind === 'prestamo' ? 'loans' : 'contributed'] += c.amount;
  for (const e of l.expenses.filter((x) => active(x) && x.payer.startsWith('socio:') && x.date <= until)) {
    const id = e.payer.slice(6);
    if (out[id]) out[id].paidExpenses += e.amount;
  }
  for (const w of l.withdrawals.filter((x) => active(x) && x.date <= until)) if (out[w.socioId]) out[w.socioId].withdrawn += w.amount;
  for (const v of Object.values(out)) v.balance = v.contributed + v.loans + v.paidExpenses + v.profit - v.withdrawn;
  return out;
}

/** Saldo de cada cuenta con sus movimientos. */
export function accountBalances(s, until = localDate()) {
  const st = s.pethome;
  const l = L(s);
  const accs = l.accounts;
  const byMethod = (m) => accs.find((a) => a.method === m) || (m === 'transferencia' ? accs.find((a) => a.kind === 'banco') : null);
  const resolve = (p) => (p.accountId && accs.find((a) => a.id === p.accountId)) || byMethod(p.method) || null;
  const out = {};
  for (const a of accs) out[a.id] = { account: a, balance: a.initial || 0, moves: [] };
  const unassigned = { balance: 0, moves: [] };
  const add = (acc, amount, move) => {
    const box = acc ? out[acc.id] : unassigned;
    box.balance += amount;
    box.moves.push({ ...move, amount });
  };
  for (const x of st.sales) for (const p of x.payments || []) if (p.status === 'activo' && p.date <= until) add(resolve(p), p.amount, { date: p.date, kind: 'cobro', text: `${p.number} · ${x.customerName}`, ref: `#/ph-venta/${x.id}` });
  for (const x of st.purchases) for (const p of x.payments || []) if (p.status === 'activo' && p.date <= until) add(resolve(p), -p.amount, { date: p.date, kind: 'pago_compra', text: `Pago compra ${x.number}`, ref: '' });
  for (const e of l.expenses) if (active(e) && !e.payer.startsWith('socio:') && e.date <= until) add(accs.find((a) => a.id === e.payer), -e.amount, { date: e.date, kind: 'gasto', text: `${e.number} · ${e.description}` });
  for (const c of l.contributions) if (active(c) && c.date <= until) add(accs.find((a) => a.id === c.accountId), c.amount, { date: c.date, kind: 'aporte', text: `Aporte ${c.number}` });
  for (const w of l.withdrawals) if (active(w) && w.date <= until) add(accs.find((a) => a.id === w.accountId), -w.amount, { date: w.date, kind: 'retiro', text: `Retiro ${w.number}` });
  for (const t of l.transfers) {
    if (!active(t) || t.date > until) continue;
    add(accs.find((a) => a.id === t.from), -t.amount, { date: t.date, kind: 'traslado', text: `Traslado ${t.number}` });
    add(accs.find((a) => a.id === t.to), t.amount, { date: t.date, kind: 'traslado', text: `Traslado ${t.number}` });
  }
  for (const v of [...Object.values(out), unassigned]) v.moves.sort((a, b) => b.date.localeCompare(a.date));
  const receivable = st.sales.filter((x) => x.status === 'activa').reduce((a, x) => a + saleTotals(x).balance, 0);
  const payable = st.purchases.filter((x) => x.status === 'activa').reduce((a, x) => a + purchaseTotals(x).balance, 0);
  const cash = Object.values(out).reduce((a, v) => a + v.balance, 0) + unassigned.balance;
  return { accounts: out, unassigned, cash, receivable, payable };
}

/** Movimientos del libro (gastos, aportes, retiros y traslados) en orden. */
export function journal(s, period = null) {
  const l = L(s);
  const rows = [
    ...l.expenses.map((x) => ({ kind: 'gasto', x })),
    ...l.contributions.map((x) => ({ kind: 'aporte', x })),
    ...l.withdrawals.map((x) => ({ kind: 'retiro', x })),
    ...l.transfers.map((x) => ({ kind: 'traslado', x })),
  ];
  return rows.filter((r) => !period || periodOf(r.x.date) === period).sort((a, b) => b.x.date.localeCompare(a.x.date) || String(b.x.createdAt).localeCompare(String(a.x.createdAt)));
}

/** Resúmenes que lee Mi Centro Comercial (solo la parte de cada socio). */
export function summaryRecords(s) {
  const recs = [];
  for (const p of activeMonths(s)) {
    const r = monthResult(s, p);
    recs.push({ id: `resumen:${p}`, tipo: 'resumen', datos: { mes: p, ventas: r.revenue, utilidad: r.profit, partes: r.shares } });
  }
  const bal = partnerBalances(s);
  recs.push({ id: 'resumen:saldos', tipo: 'resumen', datos: { saldos: Object.fromEntries(Object.entries(bal).map(([id, v]) => [id, v.balance])) } });
  return recs;
}

/* ---------------- Facturas por pagar (compras a crédito) ---------------- */
const termDays = (txt) => {
  const m = String(txt || '').match(/(\d{1,3})\s*d[ií]as?/i);
  return m ? Number(m[1]) : null;
};
/** Plazo de pago del proveedor en días, leído de sus términos ("30 días"). */
export function supplierTermDays(supplier) {
  return termDays(supplier?.terms?.paymentTerm) ?? termDays(supplier?.terms?.credit);
}

/**
 * Compras con saldo pendiente: cuánto falta, cuándo vence y cuántos días
 * quedan (negativo = vencida). Ordenadas: vencidas primero, luego por fecha.
 */
export function payables(s, today = localDate()) {
  const st = s.pethome;
  const out = [];
  for (const pu of st.purchases) {
    if (pu.status !== 'activa') continue;
    const t = purchaseTotals(pu);
    if (t.balance <= 0) continue;
    const days = pu.dueDate ? diffDays(today, pu.dueDate) : null;
    const state = days === null ? 'sin_fecha' : days < 0 ? 'vencida' : days === 0 ? 'hoy' : days <= 7 ? 'pronto' : 'al_dia';
    out.push({ pu, supplier: st.suppliers.find((x) => x.id === pu.supplierId) || null, ...t, days, state, pays: (pu.payments || []).filter((p) => p.status === 'activo') });
  }
  const rank = { vencida: 0, hoy: 1, pronto: 2, al_dia: 3, sin_fecha: 4 };
  return out.sort((a, b) => rank[a.state] - rank[b.state] || (a.days ?? 9999) - (b.days ?? 9999) || a.pu.date.localeCompare(b.pu.date));
}

export function payablesSummary(s, today = localDate()) {
  const list = payables(s, today);
  const sumOf = (f) => list.filter(f).reduce((a, x) => a + x.balance, 0);
  const bySupplier = new Map();
  for (const x of list) {
    const k = x.pu.supplierId;
    const cur = bySupplier.get(k) || { supplier: x.supplier, balance: 0, count: 0, overdue: 0, next: null };
    cur.balance += x.balance;
    cur.count++;
    if (x.state === 'vencida') cur.overdue += x.balance;
    if (x.pu.dueDate && (!cur.next || x.pu.dueDate < cur.next)) cur.next = x.pu.dueDate;
    bySupplier.set(k, cur);
  }
  // Abonos a proveedores hechos en los últimos 60 días.
  const since = addDays(today, -60);
  const recent = [];
  for (const pu of s.pethome.purchases) for (const p of pu.payments || []) if (p.date >= since) recent.push({ pu, p, supplier: s.pethome.suppliers.find((x) => x.id === pu.supplierId) });
  recent.sort((a, b) => b.p.date.localeCompare(a.p.date) || String(b.p.createdAt).localeCompare(String(a.p.createdAt)));
  return {
    list,
    total: sumOf(() => true),
    overdue: sumOf((x) => x.state === 'vencida'),
    week: sumOf((x) => x.state === 'hoy' || x.state === 'pronto'),
    count: list.length,
    overdueCount: list.filter((x) => x.state === 'vencida').length,
    soonCount: list.filter((x) => x.state === 'hoy' || x.state === 'pronto').length,
    bySupplier: [...bySupplier.values()].sort((a, b) => b.balance - a.balance),
    recent,
  };
}

/* ---------------- IVA ---------------- */
/** Periodos de declaración: bimestres (ene-feb…) o cuatrimestres (ene-abr, may-ago, sep-dic). */
export function ivaPeriodOf(date, kind = 'cuatrimestral') {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  const size = kind === 'bimestral' ? 2 : 4;
  const n = Math.floor((m - 1) / size);
  const first = n * size + 1;
  return { key: `${y}-${kind === 'bimestral' ? 'B' : 'C'}${n + 1}`, from: `${y}-${String(first).padStart(2, '0')}-01`, to: `${y}-${String(first + size - 1).padStart(2, '0')}-31`, months: Array.from({ length: size }, (_, i) => first + i) };
}

/**
 * IVA del periodo: el que se cobró en ventas (generado) menos el que se pagó
 * en compras y gastos (descontable) = lo que habría que pagarle a la DIAN.
 * Solo aplica si Alegría es responsable de IVA.
 */
export function ivaReport(s, date = localDate()) {
  const st = s.pethome;
  const l = L(s);
  const per = ivaPeriodOf(date, st.profile?.ivaPeriod);
  const inP = (d) => d >= per.from && d <= per.to;
  let generated = 0;
  const genByRate = {};
  for (const x of st.sales) {
    if (x.status !== 'activa' || !inP(x.date)) continue;
    const t = saleTotals(x);
    generated += t.iva;
    const sub = t.subtotal || 1;
    for (const ln of x.lines) {
      const p = Number(ln.ivaPct) || 0;
      if (!p) continue;
      const g = Math.round(ln.unitPrice * ln.qty);
      const after = g - Math.round(((x.discount || 0) * g) / sub);
      genByRate[p] = (genByRate[p] || 0) + Math.round((after * p) / (100 + p));
    }
  }
  let fromPurchases = 0;
  for (const pu of st.purchases) if (pu.status === 'activa' && inP(pu.date)) fromPurchases += purchaseTotals(pu).iva;
  let fromExpenses = 0;
  for (const e of l.expenses) if (active(e) && inP(e.date)) fromExpenses += expenseIva(e);
  const deductible = fromPurchases + fromExpenses;
  return { ...per, kind: st.profile?.ivaPeriod || 'cuatrimestral', generated, genByRate, fromPurchases, fromExpenses, deductible, balance: generated - deductible };
}
