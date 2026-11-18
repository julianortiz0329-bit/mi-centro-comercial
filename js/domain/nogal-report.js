// Informe de comisiones de Frutos del Nogal (PDF del sistema de la empresa).
// De ese informe solo se toman las FACTURAS (ventas antes de IVA), las
// DEVOLUCIONES (notas 060) y los RECAUDOS. Los porcentajes y comisiones que
// trae no se usan: la empresa no distingue bien mayorista (0,4 %) de normal
// (0,75 %), así que la modalidad la escoge el usuario y la app calcula.
import { diffDays, isValidDate } from '../core/dates.js';
import { createClient, normalizeDigits } from './clients.js';
import { createDocument, voidSale } from './documents.js';
import { registerPayment, reversePayment } from './payments.js';
import { saleBalance } from './ledger.js';
import { assert, audit, nowOf } from './common.js';

const num = (s) => Number(String(s).replace(/,/g, ''));
const DATE = /^\d\d-\d\d-\d\d$/;
const toDate = (s) => `20${s}`;

/** ¿El texto parece el informe de comisiones de Nogal? */
export function looksLikeNogalReport(text) {
  return /FRUTOS DEL NOGAL/i.test(text) && /COMISIONES/i.test(text) && /PERIODO\s+\d{1,2}\s+DE\s+\d{4}/i.test(text);
}

/**
 * Lee el texto del informe (una línea por renglón, como lo entrega pdf.js).
 * Devuelve { period, from, to, clients: [{ taxId, name, rows }], invoices, returns, payments, totals }.
 */
export function parseNogalReport(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const per = lines.join('\n').match(/PERIODO\s+(\d{1,2})\s+DE\s+(\d{4})\s+ENTRE\s+(\d{4}-\d\d-\d\d)\s+Y\s+(\d{4}-\d\d-\d\d)/i);
  assert(per, 'Este PDF no parece el informe de comisiones de Frutos del Nogal.', 'report');
  const period = `${per[2]}-${String(per[1]).padStart(2, '0')}`;
  const clients = [];
  let cur = null;
  let totals = null;
  for (const l of lines) {
    const tot = l.match(/^TOTALES\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)$/);
    if (tot) {
      totals = { recaudo: num(tot[1]), baseRecaudo: num(tot[2]), ventas: num(tot[4]) };
      continue;
    }
    // Encabezado de cliente: NIT/CC, nombre y 5 cifras (recaudo, base, comisión, ventas, comisión).
    const head = l.match(/^(\d{5,12})\s+([^\d].*?)\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)$/);
    if (head) {
      cur = { taxId: head[1], name: head[2].trim(), rows: [] };
      clients.push(cur);
      continue;
    }
    const row = l.match(/^(0[46]0)\s+(\d+)\s+(.*)$/);
    if (!row || !cur) continue;
    const tokens = row[3].replace(/(-?[\d.]+)\s*%/g, '$1%').split(' ');
    const dates = [];
    while (tokens.length && DATE.test(tokens[0])) dates.push(toDate(tokens.shift()));
    // Desde el final: recaudo, base, %, comisión, ventas, %, comisión.
    const tail = tokens.slice(-7);
    if (tail.length < 7 || !tail[2].endsWith('%') || !tail[5].endsWith('%')) continue;
    cur.rows.push({
      tr: row[1],
      doc: row[2],
      date: dates[0] || null,
      paidOn: dates[1] || null,
      recaudo: num(tail[0]),
      base: num(tail[1]),
      ventas: num(tail[4]),
    });
  }
  assert(clients.length, 'No encontré clientes en el informe. ¿Es el PDF correcto?', 'report');
  const invoices = [];
  const returns = [];
  const payments = [];
  for (const c of clients) {
    for (const r of c.rows) {
      if (r.tr === '040' && r.ventas > 0) invoices.push({ number: r.doc, taxId: c.taxId, name: c.name, date: r.date, net: r.ventas });
      if (r.tr === '060' && r.ventas < 0) returns.push({ number: r.doc, taxId: c.taxId, name: c.name, date: r.date, net: -r.ventas });
      if (r.recaudo > 0) payments.push({ invoice: r.doc, taxId: c.taxId, name: c.name, invoiceDate: r.date, date: r.paidOn || r.date, amount: r.recaudo, base: r.base });
    }
  }
  const sum = (a, k) => a.reduce((x, y) => x + y[k], 0);
  return {
    period,
    from: per[3],
    to: per[4],
    clients,
    invoices,
    returns,
    payments,
    totals: totals || { ventas: sum(invoices, 'net') - sum(returns, 'net'), recaudo: sum(payments, 'amount') },
  };
}

/** IVA de una factura según su recaudo (total / base), si es una tarifa normal. */
function ivaFrom(total, base) {
  if (!total || !base) return null;
  const pct = Math.round((total / base - 1) * 100);
  return [0, 5, 19].includes(pct) && Math.round(base * (1 + pct / 100)) === total ? pct : null;
}

/**
 * Líneas para una factura de la que solo se sabe la base (y quizá el total).
 * Si el total no corresponde a una sola tarifa, se reparte en una parte con IVA
 * y otra sin IVA para que el total cuadre exacto.
 */
export function linesFor(base, total, ivaPct, label) {
  const line = (unitPrice, iva, extra = '') => ({ description: `${label}${extra}`, qty: 1, unitPrice, discountPct: 0, ivaPct: iva });
  if (!total || ivaFrom(total, base) !== null || total === base) return [line(base, total ? (ivaFrom(total, base) ?? 0) : ivaPct)];
  for (const rate of [19, 5]) {
    const taxed = Math.round(((total - base) * 100) / rate);
    if (taxed > 0 && taxed <= base && Math.round((taxed * rate) / 100) === total - base) {
      return [line(taxed, rate, ` (con IVA ${rate} %)`), ...(base - taxed ? [line(base - taxed, 0, ' (sin IVA)')] : [])];
    }
  }
  return [line(base, ivaPct)];
}

const digits = (v) => normalizeDigits(v).replace(/^0+/, '');
/** El NIT del informe viene sin dígito de verificación; el de la app a veces lo trae. */
export function sameTaxId(a, b) {
  const x = digits(a);
  const y = digits(b);
  if (!x || !y || x.length < 5) return false;
  return x === y || (y.length === x.length + 1 && y.startsWith(x)) || (x.length === y.length + 1 && x.startsWith(y));
}

const isRef = (d, n) => String(d.externalRef || '').trim() === n;
const hasInvoiceRef = (d) => /^\d{4,}$/.test(String(d.externalRef || '').trim());

/**
 * Compara el informe con la app. No cambia nada: devuelve el plan para que el
 * usuario lo revise, escoja la modalidad (mayorista 0,4 % o normal 0,75 %) de
 * cada factura que se agrega y desmarque lo que no quiera.
 */
export function planNogalImport(s, report, { clientMap = {}, returnMap = {} } = {}) {
  const sales = s.documents.filter((d) => d.companyId === 'nogal' && d.kind === 'venta' && d.status === 'emitida');
  const active = s.payments.filter((p) => p.status === 'activo' && p.companyId === 'nogal');
  const used = new Set();
  // clientMap: NIT del informe → cliente de la app que el usuario escogió (nombres distintos).
  const clientFor = (taxId) => (clientMap[taxId] && s.clients.find((c) => c.id === clientMap[taxId])) || s.clients.find((c) => sameTaxId(taxId, c.taxId)) || null;
  const name = (id) => s.clients.find((c) => c.id === id)?.tradeName || '';
  const lastMode = (clientId) => sales.filter((d) => d.clientId === clientId).sort((a, b) => b.date.localeCompare(a.date))[0]?.saleMode || 'normal';
  const paidTo = (docId) => active.reduce((a, p) => a + p.allocations.filter((x) => x.documentId === docId).reduce((b, x) => b + x.amount, 0), 0);
  const near = (a, b, days = 7) => !a || !b || Math.abs(diffDays(a, b)) <= days;

  // Devoluciones (060): se restan de la factura del mismo cliente con el mismo
  // valor; si no, de la que quede en un valor redondo (la más reciente); si no, de la más reciente.
  const invoices = report.invoices.map((inv) => ({ ...inv, gross: inv.net, returned: 0, returnNumbers: [] }));
  const returns = report.returns.map((r) => {
    const own = invoices.filter((i) => i.taxId === r.taxId && i.gross - i.returned >= r.net && (!r.date || !i.date || i.date <= r.date));
    // La más reciente primero; gana la de igual valor, luego la que queda en un valor redondo.
    const recent = [...own].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const target = recent.find((i) => i.number === returnMap[r.number])
      || recent.find((i) => i.gross - i.returned === r.net)
      || recent.find((i) => (i.gross - i.returned - r.net) % 10000 === 0)
      || recent[0]
      || null;
    if (target) {
      target.returned += r.net;
      target.returnNumbers.push(r.number);
    }
    return { key: `ret:${r.number}`, ...r, invoice: target?.number || null, options: own.map((i) => i.number) };
  });

  const items = invoices.map((inv) => {
    const net = inv.gross - inv.returned;
    const pay = report.payments.find((p) => p.invoice === inv.number);
    const base = { key: `inv:${inv.number}`, number: inv.number, taxId: inv.taxId, name: inv.name, date: inv.date, gross: inv.gross, net, returnNumbers: inv.returnNumbers };
    if (net <= 0) return { ...base, status: 'devuelta', apply: false };
    const client = clientFor(inv.taxId);
    // Busca la venta en la app: por número de factura; por cliente y valor;
    // por valor en cualquier cliente (si es la única); por cliente con otro valor.
    const free = sales.filter((d) => !used.has(d.id));
    let how = 'factura';
    let match = free.find((d) => isRef(d, inv.number));
    if (!match && client) [match, how] = [free.find((d) => d.clientId === client.id && d.totals.net === net && near(d.date, inv.date)), 'cliente'];
    if (!match) {
      const same = free.filter((d) => d.totals.net === net && near(d.date, inv.date) && !hasInvoiceRef(d));
      [match, how] = [same.length === 1 ? same[0] : null, 'valor'];
    }
    if (!match && client) [match, how] = [free.find((d) => d.clientId === client.id && near(d.date, inv.date) && !hasInvoiceRef(d)), 'cliente'];
    if (match) used.add(match.id);
    const status = !match ? 'nueva' : match.totals.net === net ? 'cuadra' : 'distinta';
    const clientId = match?.clientId || client?.id || null;
    return {
      ...base,
      status,
      how: match ? how : null,
      docId: match?.id || null,
      docNumber: match?.number || null,
      appNet: match?.totals.net ?? null,
      appPaid: match ? paidTo(match.id) : 0,
      clientId,
      clientName: clientId ? name(clientId) : inv.name,
      newClient: !clientId,
      saleMode: match?.saleMode || (clientId ? lastMode(clientId) : 'normal'),
      total: pay && !inv.returned ? pay.amount : null,
      ivaPct: (pay && !inv.returned ? ivaFrom(pay.amount, pay.base) : null) ?? (match ? Math.round((match.totals.iva / Math.max(1, match.totals.net)) * 100) : 19),
      apply: status !== 'cuadra',
    };
  });

  const payments = report.payments.map((p) => {
    const it = items.find((i) => i.number === p.invoice && i.status !== 'devuelta');
    const out = { key: `pay:${p.invoice}:${p.date}:${p.amount}`, ...p };
    if (it) {
      // Factura del periodo: si se corrige, el pago se registra de nuevo sobre la venta corregida.
      const clientPaid = it.clientId && active.some((x) => x.clientId === it.clientId && x.amount === p.amount && near(x.date, p.date));
      const ok = it.status === 'cuadra' && (paidTo(it.docId) >= p.amount || clientPaid);
      return { ...out, kind: 'periodo', clientId: it.clientId, clientName: it.clientName, status: ok ? 'cuadra' : 'nueva', action: 'factura', apply: !ok };
    }
    // Factura de un mes anterior: ¿ya está en la app?
    const client = clientFor(p.taxId);
    const doc = sales.find((d) => !used.has(d.id) && isRef(d, p.invoice)) || null;
    const clientId = doc?.clientId || client?.id || null;
    const open = clientId ? sales.filter((d) => d.clientId === clientId && !used.has(d.id) && d.date <= p.date && d.totals.total - paidTo(d.id) > 0) : [];
    const already = (doc && paidTo(doc.id) >= p.amount) || (clientId && active.some((x) => x.clientId === clientId && x.amount === p.amount && near(x.date, p.date)));
    let action = 'nueva';
    let docId = null;
    if (doc) [action, docId] = ['aplicar', doc.id];
    else {
      const exact = open.find((d) => d.totals.total - paidTo(d.id) === p.amount);
      const close = open.find((d) => near(d.date, p.invoiceDate));
      if (exact) [action, docId] = ['aplicar', exact.id];
      else if (close) [action, docId] = ['corregir', close.id];
    }
    if (docId) used.add(docId);
    return {
      ...out,
      kind: 'anterior',
      clientId,
      clientName: clientId ? name(clientId) : p.name,
      newClient: !clientId,
      status: already ? 'cuadra' : 'nueva',
      action,
      docId: action === 'aplicar' ? docId : null,
      replaceIds: action === 'corregir' && docId ? [docId] : [],
      options: open.map((d) => ({ docId: d.id, number: d.number, date: d.date, net: d.totals.net, total: d.totals.total, balance: d.totals.total - paidTo(d.id) })),
      saleMode: clientId ? lastMode(clientId) : 'normal',
      ivaPct: ivaFrom(p.amount, p.base) ?? 19,
      apply: !already,
    };
  });

  const matched = new Set(items.map((i) => i.docId).filter(Boolean));
  const inPeriod = (d) => d.date >= report.from && d.date <= report.to;
  const extra = sales.filter((d) => inPeriod(d) && !matched.has(d.id)).map((d) => ({ docId: d.id, number: d.number, net: d.totals.net, date: d.date, clientName: name(d.clientId) }));
  const appNet = sales.filter(inPeriod).reduce((a, d) => a + d.totals.net, 0);
  // NIT del informe que no se reconocen: el usuario puede decir a qué cliente corresponden.
  const unknown = [...new Map([...items.filter((i) => i.status !== 'devuelta' && i.newClient), ...payments.filter((p) => p.newClient)].map((x) => [x.taxId, { taxId: x.taxId, name: x.name }])).values()];
  return { period: report.period, from: report.from, to: report.to, items, returns, payments, extra, unknown, clientMap, returnMap, totals: { report: report.totals, appNet } };
}

/** Cuánto quedarían las ventas del periodo si se aplica el plan tal como está marcado. */
export function projectedNet(plan) {
  let net = plan.totals.appNet;
  for (const it of plan.items) {
    if (!it.apply) continue;
    if (it.status === 'nueva') net += it.net;
    if (it.status === 'distinta') net += it.net - it.appNet;
  }
  return net;
}

/**
 * Aplica lo que el usuario dejó marcado en el plan (con la modalidad y el IVA
 * escogidos). Las ventas que no cuadran se anulan (quedan visibles, con el
 * motivo) y se registran de nuevo como en el informe; si tenían pagos, esos
 * pagos se reversan y se registra el recaudo del informe.
 */
export function applyNogalImport(s, { plan }, ctx) {
  assert(plan && Array.isArray(plan.items), 'No hay nada para aplicar.', 'plan');
  const out = { clients: 0, sales: 0, replaced: 0, payments: 0, reversed: 0, refs: 0 };
  const note = (n) => `Informe Nogal ${plan.period} · factura ${n}`;
  const mode = (m) => (m === 'mayorista' ? 'mayorista' : 'normal');
  const iva = (v) => ([0, 5, 19].includes(Number(v)) ? Number(v) : 19);
  const createdClients = {};
  const ensureClient = (x) => {
    if (x.clientId) return x.clientId;
    if (createdClients[x.taxId]) return createdClients[x.taxId];
    const c = createClient(s, { tradeName: titleCase(x.name), legalName: titleCase(x.name), taxId: x.taxId, companyIds: ['nogal'], notes: `Creado desde el informe de Frutos del Nogal (${plan.period}).`, allowDuplicate: true }, ctx);
    out.clients++;
    createdClients[x.taxId] = c.id;
    return c.id;
  };
  const newSale = (x, number, date, base, total) => {
    const d = createDocument(s, {
      companyId: 'nogal', clientId: ensureClient(x), kind: 'venta', date, time: '12:00', saleMode: mode(x.saleMode), externalRef: number,
      lines: linesFor(base, total, iva(x.ivaPct), `Venta según informe (factura ${number})`),
      notes: `${note(number)}${x.returnNumbers?.length ? ` · con devolución ${x.returnNumbers.join(', ')}` : ''}`,
      confirm: { creditLimit: true },
    }, ctx);
    out.sales++;
    return d;
  };
  const replace = (docId, number) => {
    for (const p of s.payments.filter((x) => x.status === 'activo' && x.allocations.some((a) => a.documentId === docId))) {
      reversePayment(s, { paymentId: p.id, reason: `Corregido según el informe de Frutos del Nogal (factura ${number})` }, ctx);
      out.reversed++;
    }
    voidSale(s, { documentId: docId, reason: `Corregida según el informe de Frutos del Nogal (factura ${number})` }, ctx);
    out.replaced++;
  };
  // Lo que el usuario emparejó a mano queda aprendido: el NIT se guarda en ese cliente.
  for (const [taxId, clientId] of Object.entries(plan.clientMap || {})) {
    const c = s.clients.find((x) => x.id === clientId);
    if (c && !c.taxId) {
      c.taxId = taxId;
      audit(s, ctx, 'editar', 'cliente', c.id, `NIT ${taxId} según informe de Nogal`);
    }
  }
  const docOf = {};
  for (const it of plan.items) {
    if (it.status === 'devuelta') continue;
    if (it.status === 'cuadra' || !it.apply) {
      const d = it.docId && s.documents.find((x) => x.id === it.docId);
      if (d && it.status === 'cuadra' && !hasInvoiceRef(d)) {
        d.externalRef = it.number;
        d.history.push({ at: nowOf(ctx), action: 'referencia', detail: `Factura ${it.number} según informe` });
        out.refs++;
      }
      if (d) docOf[it.number] = d.id;
      continue;
    }
    assert(isValidDate(it.date), `La factura ${it.number} no tiene una fecha válida.`, 'date');
    if (it.status === 'distinta' && it.docId) replace(it.docId, it.number);
    docOf[it.number] = newSale(it, it.number, it.date, it.net, it.total).id;
  }
  for (const p of plan.payments) {
    if (!p.apply || p.status === 'cuadra') continue;
    let docId = docOf[p.invoice] || null;
    if (p.kind === 'anterior') {
      if (p.action === 'aplicar' && p.docId) docId = p.docId;
      else {
        if (p.action === 'corregir') for (const id of p.replaceIds || []) replace(id, p.invoice);
        docId = newSale(p, p.invoice, isValidDate(p.invoiceDate) ? p.invoiceDate : p.date, p.base, p.amount).id;
      }
    }
    if (!docId) continue;
    const doc = s.documents.find((d) => d.id === docId);
    const balance = saleBalance(s, doc);
    registerPayment(s, {
      companyId: 'nogal', clientId: doc.clientId, date: p.date, time: '12:00', amount: p.amount, method: 'transferencia',
      reference: `Recaudo fact. ${p.invoice} (${p.date})`, notes: note(p.invoice),
      allocations: balance > 0 ? [{ documentId: doc.id, amount: Math.min(p.amount, balance) }] : [],
      confirm: { similar: true, duplicateRef: true },
    }, ctx);
    out.payments++;
  }
  audit(s, ctx, 'importar', 'informe_nogal', plan.period, `${out.sales} ventas, ${out.replaced} corregidas, ${out.payments} pagos, ${out.clients} clientes`);
  return out;
}

function titleCase(t) {
  return String(t || '').toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(Sas|S\.a\.s\.?)(?=\s|$)/g, 'SAS');
}
