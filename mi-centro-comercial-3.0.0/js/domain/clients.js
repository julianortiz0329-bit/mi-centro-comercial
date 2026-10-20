// Clientes (CRM). Un cliente puede comprar en las dos empresas; sus ventas,
// deudas, pagos y comisiones siempre llevan companyId y nunca se mezclan.
import { newId } from '../core/ids.js';
import { diffDays, isValidDate, localDate } from '../core/dates.js';
import { sum } from '../core/money.js';
import { assert, audit, cleanText, DomainError, getOrFail, nowOf } from './common.js';
import { allocationsFor, isActiveSale, saleBalance } from './ledger.js';
import { ACTIVE_COMPANY_IDS, CLIENT_STATUSES } from './schema.js';

export function normalizeDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

function normTaxId(v) {
  return String(v || '').toUpperCase().replace(/[^0-9K]/g, '').replace(/^(\d{6,})(\d)$/, '$1$2');
}

const FIELDS = ['tradeName', 'legalName', 'taxId', 'contactName', 'phone', 'whatsapp', 'email', 'department', 'city', 'address', 'directions', 'category', 'notes'];

function clientCode(s) {
  s.counters.client = (s.counters.client || 0) + 1;
  return `CL-${String(s.counters.client).padStart(5, '0')}`;
}

/** Posibles duplicados por NIT, teléfono o nombre exacto. */
export function findDuplicates(s, data, exceptId = null) {
  const tax = normTaxId(data.taxId);
  const phone = normalizeDigits(data.phone).slice(-10);
  const name = cleanText(data.tradeName).toLowerCase();
  return s.clients.filter((c) => {
    if (c.id === exceptId) return false;
    if (tax && tax.length >= 5 && normTaxId(c.taxId) === tax) return true;
    if (phone && phone.length >= 7 && normalizeDigits(c.phone).slice(-10) === phone) return true;
    return name && c.tradeName.toLowerCase() === name;
  });
}

function readTerms(input) {
  const terms = {};
  for (const co of ACTIVE_COMPANY_IDS) {
    const t = input.terms?.[co];
    if (!t) continue;
    const termDays = t.termDays === '' || t.termDays == null ? null : Number(t.termDays);
    const creditLimit = t.creditLimit === '' || t.creditLimit == null ? 0 : Number(t.creditLimit);
    assert(termDays === null || (Number.isInteger(termDays) && termDays >= 0 && termDays <= 365), 'El plazo de pago debe estar entre 0 y 365 días.', 'term');
    assert(Number.isSafeInteger(creditLimit) && creditLimit >= 0, 'El cupo de crédito debe ser un valor en pesos.', 'credit');
    terms[co] = { termDays, creditLimit };
  }
  return terms;
}

export function createClient(s, input, ctx) {
  if (input.requestId) {
    const dup = s.clients.find((c) => c.requestId === input.requestId);
    if (dup) return dup;
  }
  assert(cleanText(input.tradeName), 'Escribe el nombre comercial del cliente.', 'name');
  const companyIds = (input.companyIds || []).filter((c) => ACTIVE_COMPANY_IDS.includes(c));
  assert(companyIds.length > 0, 'Indica al menos una empresa relacionada.', 'company');
  const status = input.status || 'activo';
  assert(status in CLIENT_STATUSES, 'Estado comercial no válido.', 'status');
  if (input.nextVisit) assert(isValidDate(input.nextVisit), 'La fecha de próxima visita no es válida.', 'date');
  if (input.email) assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email), 'El correo electrónico no es válido.', 'email');
  if (!input.allowDuplicate) {
    const dups = findDuplicates(s, input);
    if (dups.length) throw new DomainError(`Ya existe un cliente parecido: ${dups.map((d) => d.tradeName).join(', ')}. Ábrelo y agrégale la empresa si es el mismo.`, 'duplicate', { ids: dups.map((d) => d.id) });
  }
  const now = nowOf(ctx);
  const c = {
    id: newId('cli'),
    code: clientCode(s),
    ...Object.fromEntries(FIELDS.map((f) => [f, cleanText(input[f], f === 'notes' ? 4000 : 200)])),
    companyIds,
    status,
    tags: (input.tags || []).map((t) => cleanText(t, 40)).filter(Boolean),
    terms: readTerms(input),
    nextVisit: input.nextVisit || null,
    lastPurchase: input.lastPurchase || null,
    lastContact: null,
    requestId: input.requestId || null,
    createdAt: now,
    updatedAt: now,
  };
  s.clients.push(c);
  audit(s, ctx, 'crear', 'cliente', c.id, c.tradeName);
  return c;
}

export function updateClient(s, { id, ...input }, ctx) {
  const c = getOrFail(s.clients, id, 'el cliente');
  assert(cleanText(input.tradeName ?? c.tradeName), 'Escribe el nombre comercial del cliente.', 'name');
  if (input.email) assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email), 'El correo electrónico no es válido.', 'email');
  if (input.nextVisit) assert(isValidDate(input.nextVisit), 'La fecha de próxima visita no es válida.', 'date');
  if (input.companyIds) {
    const ids = input.companyIds.filter((x) => ACTIVE_COMPANY_IDS.includes(x));
    // No se puede quitar una empresa con la que el cliente ya tiene movimientos.
    for (const co of c.companyIds) {
      if (!ids.includes(co) && s.documents.some((d) => d.clientId === c.id && d.companyId === co)) throw new DomainError('No puedes quitar una empresa con la que el cliente ya tiene documentos.', 'company');
    }
    assert(ids.length > 0 || c.companyIds.includes('pethome'), 'Indica al menos una empresa relacionada.', 'company');
    c.companyIds = [...new Set([...ids, ...c.companyIds.filter((x) => !ACTIVE_COMPANY_IDS.includes(x))])];
  }
  for (const f of FIELDS) if (input[f] !== undefined) c[f] = cleanText(input[f], f === 'notes' ? 4000 : 200);
  if (input.status) {
    assert(input.status in CLIENT_STATUSES, 'Estado comercial no válido.', 'status');
    c.status = input.status;
  }
  if (input.tags) c.tags = input.tags.map((t) => cleanText(t, 40)).filter(Boolean);
  if (input.terms) {
    const prevTerms = JSON.stringify(c.terms);
    c.terms = { ...c.terms, ...readTerms(input) };
    // Las ventas existentes conservan su condición; esto aplica a las nuevas.
    if (prevTerms !== JSON.stringify(c.terms)) audit(s, ctx, 'condiciones', 'cliente', c.id, `${prevTerms} → ${JSON.stringify(c.terms)}`);
  }
  if (input.nextVisit !== undefined) c.nextVisit = input.nextVisit || null;
  c.updatedAt = nowOf(ctx);
  audit(s, ctx, 'editar', 'cliente', c.id, c.tradeName);
  return c;
}

/** Desactivar no borra: el historial financiero se conserva. */
export function setClientStatus(s, { id, status, reason }, ctx) {
  const c = getOrFail(s.clients, id, 'el cliente');
  assert(status in CLIENT_STATUSES, 'Estado no válido.', 'status');
  const prev = c.status;
  c.status = status;
  c.updatedAt = nowOf(ctx);
  audit(s, ctx, 'estado', 'cliente', c.id, `${prev} → ${status} ${cleanText(reason)}`);
  return c;
}

export function clientName(s, id) {
  return s.clients.find((c) => c.id === id)?.tradeName || 'Cliente';
}

/** Indicadores del cliente, opcionalmente filtrados por empresa. */
export function clientKpis(s, clientId, companyId = null, today = localDate()) {
  const sales = s.documents.filter((d) => isActiveSale(d) && d.clientId === clientId && (!companyId || d.companyId === companyId));
  const totalSold = sum(sales, (d) => d.totals.total);
  const collected = sum(sales, (d) => sum(allocationsFor(s, d.id), (a) => a.amount));
  const balance = sum(sales, (d) => saleBalance(s, d));
  const overdue = sum(sales.filter((d) => d.dueDate < today), (d) => saleBalance(s, d));
  const dates = [...new Set(sales.map((d) => d.date))].sort();
  let frequencyDays = null;
  if (dates.length >= 2) frequencyDays = Math.round(diffDays(dates[0], dates[dates.length - 1]) / (dates.length - 1));
  const unapplied = sum(s.payments.filter((p) => p.status === 'activo' && p.clientId === clientId && (!companyId || p.companyId === companyId)), (p) => p.amount - sum(p.allocations, (a) => a.amount));
  return { totalSold, collected, balance, overdue, salesCount: sales.length, lastPurchase: dates[dates.length - 1] || null, frequencyDays, unapplied, nextAction: nextActionFor(s, clientId) };
}

export function nextActionFor(s, clientId) {
  const c = s.clients.find((x) => x.id === clientId);
  const cands = [];
  if (c?.nextVisit) cands.push({ date: c.nextVisit, text: 'Visita programada' });
  for (const a of s.activities) {
    if (a.clientId !== clientId) continue;
    if (a.nextAction?.date && !a.nextAction.done) cands.push({ date: a.nextAction.date, text: a.nextAction.text || 'Seguimiento' });
    if (a.type === 'promesa' && a.promise?.status === 'pendiente') cands.push({ date: a.promise.date, text: `Promesa de pago ${a.promise.amount}` });
  }
  for (const t of s.tasks) if (t.clientId === clientId && !t.done) cands.push({ date: t.date, text: t.title });
  cands.sort((a, b) => a.date.localeCompare(b.date));
  return cands[0] || null;
}

/** Búsqueda rápida: nombre, razón social, teléfono, ciudad, NIT o código. */
export function searchClients(s, { q = '', companyId = null, status = '', category = '', tag = '' } = {}) {
  const terms = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
  const digits = normalizeDigits(q);
  return s.clients.filter((c) => {
    if (companyId && !c.companyIds.includes(companyId)) return false;
    if (status && c.status !== status) return false;
    if (category && c.category !== category) return false;
    if (tag && !c.tags.includes(tag)) return false;
    if (!terms.length) return true;
    const hay = `${c.tradeName} ${c.legalName} ${c.city} ${c.department} ${c.code} ${c.taxId} ${c.contactName} ${c.tags.join(' ')}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (terms.every((t) => hay.includes(t))) return true;
    return digits.length >= 4 && (normalizeDigits(c.phone).includes(digits) || normalizeDigits(c.whatsapp).includes(digits) || normalizeDigits(c.taxId).includes(digits));
  });
}

/** Clientes sin compra o sin contacto durante los días configurados. No se
 *  cambia su estado automáticamente: solo se listan con el criterio visible. */
export function inactiveClients(s, { companyId = null, today = localDate() } = {}) {
  const { noPurchaseDays, noContactDays } = s.settings.inactivity;
  const out = [];
  for (const c of s.clients) {
    if (companyId && !c.companyIds.includes(companyId)) continue;
    if (c.status === 'bloqueado' || c.status === 'inactivo') continue;
    const lastSale = s.documents.filter((d) => isActiveSale(d) && d.clientId === c.id && (!companyId || d.companyId === companyId)).map((d) => d.date).sort().pop() || c.lastPurchase;
    const lastContact = s.activities.filter((a) => a.clientId === c.id && a.type !== 'nota').map((a) => a.at.slice(0, 10)).sort().pop() || c.lastContact;
    const daysNoPurchase = lastSale ? diffDays(lastSale, today) : null;
    const daysNoContact = lastContact ? diffDays(lastContact, today) : null;
    const reasons = [];
    if (c.status !== 'prospecto' && (daysNoPurchase === null || daysNoPurchase >= noPurchaseDays)) reasons.push(daysNoPurchase === null ? 'Sin compras registradas' : `${daysNoPurchase} días sin comprar`);
    if (daysNoContact === null || daysNoContact >= noContactDays) reasons.push(daysNoContact === null ? 'Sin contactos registrados' : `${daysNoContact} días sin contacto`);
    if (reasons.length) out.push({ client: c, reasons, daysNoPurchase, daysNoContact });
  }
  return out.sort((a, b) => (b.daysNoPurchase ?? 9999) - (a.daysNoPurchase ?? 9999));
}

/** Línea de tiempo del cliente con todos sus movimientos. */
export function clientTimeline(s, clientId, companyId = null) {
  const items = [];
  const inCo = (x) => !companyId || x.companyId === companyId;
  for (const d of s.documents) if (d.clientId === clientId && inCo(d)) items.push({ at: d.createdAt, kind: d.kind, ref: d, title: `${{ cotizacion: 'Cotización', pedido: 'Pedido', venta: 'Venta' }[d.kind]} ${d.number}`, amount: d.totals.total, companyId: d.companyId, status: d.status });
  for (const p of s.payments) if (p.clientId === clientId && inCo(p)) items.push({ at: p.receivedAt, kind: 'pago', ref: p, title: `${p.status === 'reversado' ? 'Pago reversado' : 'Pago recibido'} ${p.number}`, amount: p.amount, companyId: p.companyId });
  for (const ds of s.dispatches) {
    const doc = s.documents.find((d) => d.id === ds.documentId);
    if (doc?.clientId === clientId && inCo(ds)) items.push({ at: `${ds.date}T12:00:00`, kind: 'despacho', ref: ds, title: `Despacho de ${doc.number}`, companyId: ds.companyId });
  }
  for (const a of s.activities) if (a.clientId === clientId && (!companyId || !a.companyId || a.companyId === companyId)) items.push({ at: a.at, kind: a.type, ref: a, title: a.title || a.type, companyId: a.companyId });
  return items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
