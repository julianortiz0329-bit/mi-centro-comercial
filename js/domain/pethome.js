// Alegría Pet Home: negocio propio (no comisiones). Productos con costo y
// margen, proveedores con términos comerciales y bitácora, ventas con abonos
// (cuentas de cobro y recibos), compras a proveedores y resumen del mes.
// Montos en pesos enteros. Nada se borra: ventas y abonos se anulan con motivo.
import { newId } from '../core/ids.js';
import { isValidDate, localDate, periodOf } from '../core/dates.js';
import { parseDecimal, parsePesos } from '../core/money.js';
import { assert, audit, cleanText, DomainError, getOrFail, nowOf } from './common.js';
import { parseCSV } from './csv.js';
import { PETHOME_CATALOG, PETHOME_HANDLES, PETHOME_LOGO_URL } from './catalog-pethome.js';

export const PH_CHANNELS = { directa: 'Venta directa', whatsapp: 'WhatsApp', instagram: 'Instagram', shopify: 'Tienda Shopify', feria: 'Feria o evento', otro: 'Otro' };
export const PH_METHODS = { efectivo: 'Efectivo', transferencia: 'Transferencia', nequi: 'Nequi', daviplata: 'Daviplata', bancolombia: 'Bancolombia', tarjeta: 'Tarjeta', otro: 'Otro' };
export const PH_NOTE_CHANNELS = { whatsapp: 'WhatsApp', llamada: 'Llamada', correo: 'Correo', visita: 'Visita', feria: 'Feria' };

export function emptyPetHome() {
  return {
    profile: {
      brand: 'Alegría Pet Home',
      issuerName: '', // titular del RUT con que se cobra (socio)
      issuerId: '', // cédula o NIT del titular
      phone: '',
      email: 'alegriapethome@gmail.com',
      city: 'Medellín',
      address: '',
      web: 'alegriapethome.com',
      payInfo: '', // p. ej. "Nequi 300 000 0000 a nombre de …"
      taxNote: 'No se cobra IVA en este documento.',
      ivaResponsable: false, // ¿Alegría cobra IVA en sus ventas?
      ivaPeriod: 'cuatrimestral', // bimestral | cuatrimestral (declaración de IVA)
      logo: null, // { dataUrl (JPEG), w, h }
      logoUrl: PETHOME_LOGO_URL,
    },
    settings: { minMarginPct: 35 },
    products: [],
    suppliers: [],
    notes: [], // bitácora con proveedores
    sales: [],
    purchases: [],
    counters: { sale: 0, purchase: 0, receipt: 0 },
    catalogLoadedAt: null,
  };
}

const fold = (v) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const ph = (s) => {
  if (!s.pethome) s.pethome = emptyPetHome();
  return s.pethome;
};
const peso = (v, label) => {
  const n = typeof v === 'number' ? v : parsePesos(v);
  assert(Number.isSafeInteger(n) && n >= 0, `${label} debe ser un valor en pesos.`, 'money');
  return n;
};
const optPeso = (v, label) => (v === null || v === undefined || v === '' ? null : peso(v, label));
const qtyOf = (v) => {
  const q = typeof v === 'number' ? v : parseDecimal(v);
  assert(Number.isFinite(q) && q > 0, 'La cantidad debe ser mayor que cero.', 'qty');
  return Math.round(q * 1000) / 1000;
};
/** El medio de pago puede ser una cuenta del libro (acc_…) o un método. */
const payVia = (s, method) => {
  const acc = s.ledger?.accounts?.find((a) => a.id === method);
  if (acc) return { method: PH_METHODS[acc.method] ? acc.method : 'otro', accountId: acc.id };
  return { method: PH_METHODS[method] ? method : 'otro', accountId: null };
};
/** Tarifa de IVA válida en Colombia para estos productos: 0, 5 o 19 %. */
export const IVA_RATES = [0, 5, 19];
export const ivaOf = (v) => {
  const n = Number(String(v ?? 0).replace('%', '').replace(',', '.'));
  assert(IVA_RATES.includes(n), 'El IVA debe ser 0, 5 o 19 %.', 'iva');
  return n;
};
const dateOf = (d) => {
  const v = d || localDate();
  assert(isValidDate(v), 'La fecha no es válida.', 'date');
  return v;
};

/* ---------------- Perfil del emisor ---------------- */
export function updatePhProfile(s, patch, ctx) {
  const p = ph(s).profile;
  for (const k of ['brand', 'issuerName', 'issuerId', 'phone', 'email', 'city', 'address', 'web', 'payInfo', 'taxNote']) if (patch[k] !== undefined) p[k] = cleanText(patch[k], k === 'payInfo' || k === 'taxNote' ? 400 : 120);
  if (patch.logo !== undefined) {
    assert(patch.logo === null || (typeof patch.logo.dataUrl === 'string' && patch.logo.dataUrl.startsWith('data:image/jpeg') && patch.logo.dataUrl.length < 400000), 'El logo no es válido o es muy pesado.', 'logo');
    p.logo = patch.logo;
  }
  if (patch.ivaResponsable !== undefined) {
    const on = patch.ivaResponsable === true || patch.ivaResponsable === 'on' || patch.ivaResponsable === 'true';
    if (on && !p.ivaResponsable && (!patch.taxNote || p.taxNote === 'No se cobra IVA en este documento.')) p.taxNote = 'Los precios incluyen IVA.';
    if (!on && p.ivaResponsable && p.taxNote === 'Los precios incluyen IVA.') p.taxNote = 'No se cobra IVA en este documento.';
    p.ivaResponsable = on;
  }
  if (patch.ivaPeriod !== undefined) p.ivaPeriod = patch.ivaPeriod === 'bimestral' ? 'bimestral' : 'cuatrimestral';
  if (patch.minMarginPct !== undefined) {
    const m = Number(patch.minMarginPct);
    assert(Number.isFinite(m) && m >= 0 && m < 100, 'El margen mínimo debe estar entre 0 y 99 %.', 'margin');
    ph(s).settings.minMarginPct = m;
  }
  audit(s, ctx, 'configuracion', 'pethome', 'perfil', Object.keys(patch).join(','));
}

/* ---------------- Productos ---------------- */
/** Margen sobre el precio sin IVA (si el precio lo incluye: ivaPct > 0). */
export function productMargin(p, price = p.price, cost = p.cost, ivaPct = 0) {
  if (!Number.isSafeInteger(cost) || !price) return { profit: null, pct: null };
  const net = ivaPct ? Math.round((price * 100) / (100 + ivaPct)) : price;
  return { profit: net - cost, pct: Math.round(((net - cost) / net) * 1000) / 10 };
}
/** IVA incluido en el precio de venta de un producto (0 si Alegría no cobra IVA). */
export function saleIvaOf(st, p) {
  return st.profile?.ivaResponsable ? Number(p?.ivaPct ?? 19) : 0;
}

export function savePhProduct(s, input, ctx) {
  const st = ph(s);
  const name = cleanText(input.name, 120);
  assert(name, 'Escribe el nombre del producto.', 'name');
  const data = {
    name,
    category: cleanText(input.category, 60),
    pet: cleanText(input.pet, 30),
    price: peso(input.price ?? 0, 'El precio de venta'),
    cost: optPeso(input.cost, 'El costo'),
    supplierId: input.supplierId || null,
    variants: Array.isArray(input.variants) ? input.variants.map((v) => cleanText(v, 40)).filter(Boolean) : String(input.variants || '').split(',').map((v) => cleanText(v, 40)).filter(Boolean),
    note: cleanText(input.note, 300),
    ivaPct: ivaOf(input.ivaPct ?? 19),
    active: input.active !== false,
  };
  if (data.supplierId) getOrFail(st.suppliers, data.supplierId, 'el proveedor');
  let p;
  if (input.id) {
    p = getOrFail(st.products, input.id, 'el producto');
    if (p.cost !== data.cost) p.costHistory = [...(p.costHistory || []), { at: nowOf(ctx), from: p.cost, to: data.cost, source: 'manual' }].slice(-20);
    Object.assign(p, data, { updatedAt: nowOf(ctx) });
  } else {
    assert(!st.products.some((x) => fold(x.name) === fold(name)), `Ya existe el producto "${name}".`, 'duplicate');
    p = { id: newId('php'), shopifyId: input.shopifyId || null, ...data, costHistory: [], createdAt: nowOf(ctx), updatedAt: nowOf(ctx) };
    st.products.push(p);
  }
  audit(s, ctx, input.id ? 'editar' : 'crear', 'producto_ph', p.id, name);
  return p;
}

/** Cambio rápido de costo (y opcionalmente precio) desde la tabla de márgenes. */
export function setPhCost(s, { productId, cost, price }, ctx) {
  const p = getOrFail(ph(s).products, productId, 'el producto');
  const c = optPeso(cost, 'El costo');
  if (c !== p.cost) p.costHistory = [...(p.costHistory || []), { at: nowOf(ctx), from: p.cost, to: c, source: 'manual' }].slice(-20);
  p.cost = c;
  if (price !== undefined && price !== '') p.price = peso(price, 'El precio');
  p.updatedAt = nowOf(ctx);
  audit(s, ctx, 'costo', 'producto_ph', p.id, `${c}`);
  return p;
}

/** Carga los productos de la tienda Shopify (no duplica) y rescata costos y
 *  proveedores de la versión 1 cuando el nombre coincide. */
export function loadPetHomeCatalog(s, _input, ctx) {
  const st = ph(s);
  let added = 0;
  for (const [shopifyId, name, category, pet, price, variants] of PETHOME_CATALOG) {
    if (st.products.some((p) => p.shopifyId === shopifyId || (p.handle && p.handle === PETHOME_HANDLES[shopifyId]) || fold(p.name) === fold(name))) continue;
    st.products.push({ id: newId('php'), shopifyId, handle: PETHOME_HANDLES[shopifyId] || null, name, category, pet, price, cost: null, ivaPct: 19, supplierId: null, variants: variants || [], note: '', active: true, costHistory: [], createdAt: nowOf(ctx), updatedAt: nowOf(ctx) });
    added++;
  }
  const legacy = importLegacyPetHome(s, ctx);
  st.catalogLoadedAt = nowOf(ctx);
  audit(s, ctx, 'catalogo', 'pethome', 'shopify', `${added} productos`);
  return { added, ...legacy };
}

/** Proveedores y costos que estaban en la versión 1 (s.legacy.petHome). */
export function importLegacyPetHome(s, ctx) {
  const st = ph(s);
  const old = s.legacy?.petHome || { products: [], suppliers: [] };
  let suppliers = 0;
  let costs = 0;
  for (const x of old.suppliers || []) {
    const name = cleanText(x.name, 120);
    if (!name || st.suppliers.some((y) => fold(y.name) === fold(name))) continue;
    st.suppliers.push(newSupplier({ name, contactName: x.contact, phone: x.phone, email: x.email, notes: 'Traído de la versión 1.' }, ctx));
    suppliers++;
  }
  for (const x of old.products || []) {
    const cost = Math.round(Number(x.cost));
    if (!x.name || !Number.isSafeInteger(cost) || cost <= 0) continue;
    const f = fold(x.name);
    const p = st.products.find((y) => fold(y.name) === f) || st.products.find((y) => f.length > 5 && (fold(y.name).includes(f) || f.includes(fold(y.name))));
    if (p && p.cost == null) {
      p.cost = cost;
      p.costHistory = [...(p.costHistory || []), { at: nowOf(ctx), from: null, to: cost, source: 'versión 1' }];
      costs++;
    }
  }
  return { suppliers, costs };
}

/* ---------------- Proveedores ---------------- */
const TERM_KEYS = ['discounts', 'paymentTerm', 'minOrder', 'shipping', 'leadTime', 'credit', 'returns', 'other'];
function newSupplier(input, ctx) {
  return {
    id: newId('phs'),
    name: cleanText(input.name, 120),
    contactName: cleanText(input.contactName, 80),
    phone: cleanText(input.phone, 40),
    email: cleanText(input.email, 120),
    city: cleanText(input.city, 60),
    sells: cleanText(input.sells, 200),
    web: cleanText(input.web, 200),
    terms: Object.fromEntries(TERM_KEYS.map((k) => [k, cleanText(input.terms?.[k], 400)])),
    discountPct: input.discountPct === '' || input.discountPct == null ? null : Math.max(0, Math.min(90, Number(String(input.discountPct).replace(',', '.')) || 0)),
    rating: Math.max(0, Math.min(5, Number(input.rating) || 0)),
    status: input.status === 'inactivo' ? 'inactivo' : 'activo',
    notes: cleanText(input.notes, 1000),
    createdAt: nowOf(ctx),
    updatedAt: nowOf(ctx),
  };
}

export function saveSupplier(s, input, ctx) {
  const st = ph(s);
  assert(cleanText(input.name), 'Escribe el nombre del proveedor.', 'name');
  let x;
  if (input.id) {
    x = getOrFail(st.suppliers, input.id, 'el proveedor');
    const { id, createdAt } = x;
    Object.assign(x, newSupplier(input, ctx), { id, createdAt });
  } else {
    assert(!st.suppliers.some((y) => fold(y.name) === fold(input.name)), `Ya tienes un proveedor llamado "${cleanText(input.name)}".`, 'duplicate');
    x = newSupplier(input, ctx);
    st.suppliers.push(x);
  }
  audit(s, ctx, input.id ? 'editar' : 'crear', 'proveedor', x.id, x.name);
  return x;
}

export function addSupplierNote(s, { supplierId, channel = 'whatsapp', summary, offer = '', followUp = null }, ctx) {
  const st = ph(s);
  getOrFail(st.suppliers, supplierId, 'el proveedor');
  assert(cleanText(summary), 'Escribe qué hablaron.', 'summary');
  if (followUp) assert(isValidDate(followUp), 'La fecha de seguimiento no es válida.', 'date');
  const n = { id: newId('phn'), supplierId, at: nowOf(ctx), channel: PH_NOTE_CHANNELS[channel] ? channel : 'whatsapp', summary: cleanText(summary, 1500), offer: cleanText(offer, 500), followUp: followUp || null, done: false };
  st.notes.push(n);
  audit(s, ctx, 'nota', 'proveedor', supplierId, n.summary.slice(0, 80));
  return n;
}

export function completeSupplierFollowUp(s, { noteId }, ctx) {
  const n = getOrFail(ph(s).notes, noteId, 'la nota');
  n.done = true;
  n.doneAt = nowOf(ctx);
  return n;
}

/* ---------------- Ventas y abonos ---------------- */
function buildLines(st, lines, { costKey = 'unitCost' } = {}) {
  assert(Array.isArray(lines) && lines.length, 'Agrega al menos un producto.', 'lines');
  return lines.map((l) => {
    const prod = l.productId ? st.products.find((p) => p.id === l.productId) : null;
    const description = cleanText(l.description || prod?.name, 160);
    assert(description, 'Cada línea necesita un producto o concepto.', 'lines');
    const out = { id: newId('phl'), productId: prod?.id || null, description, qty: qtyOf(l.qty ?? 1), ivaPct: ivaOf(l.ivaPct ?? 0) };
    if (costKey === 'unitCost' && 'unitPrice' in l) out.unitPrice = peso(l.unitPrice ?? prod?.price ?? 0, 'El precio');
    const c = l[costKey] ?? (costKey === 'unitCost' ? prod?.cost : null);
    out[costKey] = c === null || c === undefined || c === '' ? null : peso(c, 'El costo');
    return out;
  });
}

/**
 * Totales de una venta. El precio de cada línea es el precio al público (con
 * IVA incluido si la línea tiene IVA). El descuento se reparte entre las
 * líneas para calcular el IVA. Ventas viejas sin IVA quedan igual.
 */
export function saleTotals(sale) {
  const gross = sale.lines.map((l) => Math.round(l.unitPrice * l.qty));
  const subtotal = gross.reduce((a, v) => a + v, 0);
  const discount = sale.discount || 0;
  let iva = 0;
  sale.lines.forEach((l, i) => {
    const p = Number(l.ivaPct) || 0;
    if (!p || !subtotal) return;
    const after = gross[i] - Math.round((discount * gross[i]) / subtotal);
    iva += Math.round((after * p) / (100 + p));
  });
  const total = subtotal - discount + (sale.shipping || 0);
  const knownCost = sale.lines.every((l) => Number.isSafeInteger(l.unitCost));
  const cogs = sale.lines.reduce((a, l) => a + (Number.isSafeInteger(l.unitCost) ? Math.round(l.unitCost * l.qty) : 0), 0);
  const paid = (sale.payments || []).filter((p) => p.status !== 'anulado').reduce((a, p) => a + p.amount, 0);
  const net = subtotal - discount - iva; // ventas de productos sin IVA
  const profit = net - cogs + (sale.shipping || 0) - (sale.shippingCost || 0);
  const base = net + (sale.shipping || 0);
  return { subtotal, total, iva, net, cogs, knownCost, profit, marginPct: base > 0 ? Math.round((profit / base) * 1000) / 10 : null, paid, balance: Math.max(0, total - paid) };
}

function nextPh(st, key, prefix) {
  st.counters[key] = (st.counters[key] || 0) + 1;
  return `${prefix}-${String(st.counters[key]).padStart(4, '0')}`;
}

export function createPhSale(s, input, ctx) {
  const st = ph(s);
  if (input.requestId) {
    const dup = st.sales.find((x) => x.requestId === input.requestId);
    if (dup) return dup;
  }
  if (input.externalRef) {
    const dup = st.sales.find((x) => x.externalRef && x.externalRef === input.externalRef && x.status !== 'anulada');
    if (dup) throw new DomainError(`El pedido ${input.externalRef} ya está registrado (${dup.number}).`, 'duplicate');
  }
  const customerName = cleanText(input.customerName, 120);
  assert(customerName, 'Escribe a quién le vendiste.', 'customer');
  const sale = {
    id: newId('phv'),
    number: '',
    date: dateOf(input.date),
    customerName,
    customerPhone: cleanText(input.customerPhone, 40),
    customerId: cleanText(input.customerId, 40), // cédula/NIT del comprador (opcional)
    channel: PH_CHANNELS[input.channel] ? input.channel : 'directa',
    lines: buildLines(st, input.lines.map((l) => ({ ...l, unitPrice: l.unitPrice ?? undefined, ivaPct: st.profile.ivaResponsable ? (l.ivaPct ?? st.products.find((p) => p.id === l.productId)?.ivaPct ?? 19) : 0 }))),
    discount: peso(input.discount || 0, 'El descuento'),
    shipping: peso(input.shipping || 0, 'El domicilio cobrado'),
    shippingCost: peso(input.shippingCost || 0, 'El domicilio pagado'),
    dueDate: input.dueDate && isValidDate(input.dueDate) ? input.dueDate : null,
    externalRef: cleanText(input.externalRef, 40),
    notes: cleanText(input.notes, 1000),
    payments: [],
    status: 'activa',
    requestId: input.requestId || null,
    createdAt: nowOf(ctx),
  };
  for (const l of sale.lines) if (l.unitPrice === undefined) l.unitPrice = 0;
  const t = saleTotals(sale);
  assert(t.total >= 0, 'El descuento no puede ser mayor que la venta.', 'discount');
  sale.number = nextPh(st, 'sale', 'AP');
  st.sales.push(sale);
  if (input.paid) {
    const amount = input.paid.amount === 'total' ? t.total : peso(input.paid.amount, 'El valor pagado');
    if (amount > 0) addPhPayment(s, { saleId: sale.id, amount, date: input.paid.date || sale.date, method: input.paid.method, note: input.paid.note }, ctx);
  }
  audit(s, ctx, 'crear', 'venta_ph', sale.id, `${sale.number} · ${t.total}`);
  return sale;
}

export function addPhPayment(s, { saleId, amount, date, method = 'transferencia', note = '' }, ctx) {
  const st = ph(s);
  const sale = getOrFail(st.sales, saleId, 'la venta');
  assert(sale.status === 'activa', 'La venta está anulada.', 'status');
  const a = peso(amount, 'El abono');
  assert(a > 0, 'El abono debe ser mayor que cero.', 'amount');
  const { balance } = saleTotals(sale);
  assert(a <= balance, `El abono supera lo que se debe (${balance}).`, 'amount');
  const p = { id: newId('php_pay'), number: nextPh(st, 'receipt', 'RC'), date: dateOf(date), amount: a, ...payVia(s, method), note: cleanText(note, 300), status: 'activo', createdAt: nowOf(ctx) };
  sale.payments.push(p);
  audit(s, ctx, 'abono', 'venta_ph', sale.id, `${p.number} · ${a}`);
  return p;
}

export function voidPhPayment(s, { saleId, paymentId, reason }, ctx) {
  const sale = getOrFail(ph(s).sales, saleId, 'la venta');
  const p = getOrFail(sale.payments, paymentId, 'el abono');
  assert(p.status === 'activo', 'Ese abono ya fue anulado.', 'status');
  assert(cleanText(reason), 'Indica el motivo.', 'reason');
  p.status = 'anulado';
  p.voided = { at: nowOf(ctx), reason: cleanText(reason, 300) };
  audit(s, ctx, 'anular', 'abono_ph', p.id, cleanText(reason));
  return p;
}

export function voidPhSale(s, { saleId, reason }, ctx) {
  const sale = getOrFail(ph(s).sales, saleId, 'la venta');
  assert(sale.status === 'activa', 'La venta ya está anulada.', 'status');
  assert(cleanText(reason), 'Indica el motivo de la anulación.', 'reason');
  for (const p of sale.payments) if (p.status === 'activo') Object.assign(p, { status: 'anulado', voided: { at: nowOf(ctx), reason: 'Venta anulada' } });
  sale.status = 'anulada';
  sale.voided = { at: nowOf(ctx), reason: cleanText(reason, 300) };
  audit(s, ctx, 'anular', 'venta_ph', sale.id, cleanText(reason));
  return sale;
}

/* ---------------- Compras a proveedores ---------------- */
/** Totales de una compra: costo antes de IVA − descuento + IVA + flete. */
export function purchaseTotals(pu) {
  const gross = pu.lines.map((l) => Math.round(l.unitCost * l.qty));
  const subtotal = gross.reduce((a, v) => a + v, 0);
  const discount = pu.discount || 0;
  let iva = 0;
  const ivaByRate = {};
  pu.lines.forEach((l, i) => {
    const p = Number(l.ivaPct) || 0;
    if (!p || !subtotal) return;
    const v = Math.round(((gross[i] - Math.round((discount * gross[i]) / subtotal)) * p) / 100);
    iva += v;
    ivaByRate[p] = (ivaByRate[p] || 0) + v;
  });
  const total = subtotal - discount + iva + (pu.shipping || 0);
  const paid = (pu.payments || []).filter((p) => p.status !== 'anulado').reduce((a, p) => a + p.amount, 0);
  return { subtotal, iva, ivaByRate, total, paid, balance: Math.max(0, total - paid) };
}

/**
 * Registra una compra. Si updateCosts, el costo de cada producto queda en el
 * "costo puesto": precio del proveedor menos descuento, más el flete
 * repartido en proporción al valor de cada línea.
 */
export function createPurchase(s, input, ctx) {
  const st = ph(s);
  if (input.requestId) {
    const dup = st.purchases.find((x) => x.requestId === input.requestId);
    if (dup) return dup;
  }
  const supplier = getOrFail(st.suppliers, input.supplierId, 'el proveedor');
  const lines = buildLines(st, input.lines.map((l) => ({ ...l, unitCost: l.unitCost ?? 0, ivaPct: l.ivaPct ?? 0 })), { costKey: 'unitCost' });
  for (const l of lines) assert(Number.isSafeInteger(l.unitCost), 'Cada línea necesita su costo.', 'cost');
  const pu = { id: newId('phc'), number: '', supplierId: supplier.id, date: dateOf(input.date), lines, discount: peso(input.discount || 0, 'El descuento'), shipping: peso(input.shipping || 0, 'El flete'), dueDate: input.dueDate && isValidDate(input.dueDate) ? input.dueDate : null, invoiceRef: cleanText(input.invoiceRef, 60), notes: cleanText(input.notes, 1000), payments: [], status: 'activa', requestId: input.requestId || null, createdAt: nowOf(ctx) };
  const t = purchaseTotals(pu);
  assert(t.total >= 0, 'El descuento no puede ser mayor que la compra.', 'discount');
  pu.number = nextPh(st, 'purchase', 'CP');
  st.purchases.push(pu);
  if (input.updateCosts) {
    // Costo puesto: con descuento y flete repartidos. Si Alegría no es
    // responsable de IVA, el IVA que cobra el proveedor también es costo.
    const factor = t.subtotal ? (t.subtotal - pu.discount + pu.shipping) / t.subtotal : 1;
    const discF = t.subtotal ? (t.subtotal - pu.discount) / t.subtotal : 1;
    const ivaIsCost = !st.profile.ivaResponsable;
    for (const l of lines) {
      const p = l.productId && st.products.find((x) => x.id === l.productId);
      if (!p) continue;
      const landed = Math.round(l.unitCost * factor + (ivaIsCost ? (l.unitCost * discF * (l.ivaPct || 0)) / 100 : 0));
      p.costHistory = [...(p.costHistory || []), { at: nowOf(ctx), from: p.cost, to: landed, source: pu.number }].slice(-20);
      p.cost = landed;
      if (!p.supplierId) p.supplierId = supplier.id;
      l.landedCost = landed;
    }
  }
  if (input.paid) {
    const amount = input.paid.amount === 'total' ? t.total : peso(input.paid.amount, 'El valor pagado');
    if (amount > 0) addPurchasePayment(s, { purchaseId: pu.id, amount, date: input.paid.date || pu.date, method: input.paid.method }, ctx);
  }
  audit(s, ctx, 'crear', 'compra_ph', pu.id, `${pu.number} · ${supplier.name} · ${t.total}`);
  return pu;
}

export function addPurchasePayment(s, { purchaseId, amount, date, method = 'transferencia', note = '', reference = '' }, ctx) {
  const pu = getOrFail(ph(s).purchases, purchaseId, 'la compra');
  assert(pu.status === 'activa', 'La compra está anulada.', 'status');
  const a = peso(amount, 'El pago');
  assert(a > 0 && a <= purchaseTotals(pu).balance, 'El pago debe ser mayor que cero y no superar el saldo.', 'amount');
  const p = { id: newId('phcp'), date: dateOf(date), amount: a, ...payVia(s, method), note: cleanText(note, 300), reference: cleanText(reference, 80), status: 'activo', by: ctx?.user || null, createdAt: nowOf(ctx) };
  pu.payments.push(p);
  audit(s, ctx, 'pago', 'compra_ph', pu.id, `${a}`);
  return p;
}

/** Anula un abono a una compra (queda con su motivo; el saldo vuelve a quedar pendiente). */
export function voidPurchasePayment(s, { purchaseId, paymentId, reason }, ctx) {
  const pu = getOrFail(ph(s).purchases, purchaseId, 'la compra');
  const p = getOrFail(pu.payments, paymentId, 'el pago');
  assert(p.status === 'activo', 'Ese pago ya fue anulado.', 'status');
  assert(cleanText(reason), 'Indica el motivo.', 'reason');
  p.status = 'anulado';
  p.voided = { at: nowOf(ctx), by: ctx?.user || null, reason: cleanText(reason, 300) };
  audit(s, ctx, 'anular', 'pago_compra_ph', p.id, cleanText(reason));
  return p;
}

/** Cambia la fecha en que hay que pagarle al proveedor (p. ej. si se acordó más plazo). */
export function setPurchaseDueDate(s, { purchaseId, dueDate, note = '' }, ctx) {
  const pu = getOrFail(ph(s).purchases, purchaseId, 'la compra');
  assert(pu.status === 'activa', 'La compra está anulada.', 'status');
  assert(!dueDate || isValidDate(dueDate), 'La fecha no es válida.', 'date');
  pu.dueHistory = [...(pu.dueHistory || []), { at: nowOf(ctx), by: ctx?.user || null, from: pu.dueDate || null, to: dueDate || null, note: cleanText(note, 200) }].slice(-20);
  pu.dueDate = dueDate || null;
  audit(s, ctx, 'plazo', 'compra_ph', pu.id, `${dueDate || 'sin fecha'}`);
  return pu;
}

export function voidPurchase(s, { purchaseId, reason }, ctx) {
  const pu = getOrFail(ph(s).purchases, purchaseId, 'la compra');
  assert(pu.status === 'activa', 'La compra ya está anulada.', 'status');
  assert(cleanText(reason), 'Indica el motivo.', 'reason');
  pu.status = 'anulada';
  pu.voided = { at: nowOf(ctx), reason: cleanText(reason, 300) };
  audit(s, ctx, 'anular', 'compra_ph', pu.id, cleanText(reason));
  return pu;
}

/* ---------------- Resumen ---------------- */
export function phMonthSummary(s, period = localDate().slice(0, 7)) {
  const st = ph(s);
  const sales = st.sales.filter((x) => x.status === 'activa' && periodOf(x.date) === period);
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const tots = sales.map((x) => ({ x, t: saleTotals(x) }));
  const revenue = sum(tots, (r) => r.t.total);
  const cogs = sum(tots, (r) => r.t.cogs);
  // La ganancia solo cuenta ventas con todos sus costos: así nunca se infla.
  const known = tots.filter((r) => r.t.knownCost);
  const profit = sum(known, (r) => r.t.profit);
  const revenueKnown = sum(known, (r) => r.t.total);
  const byChannel = {};
  for (const r of tots) byChannel[r.x.channel] = (byChannel[r.x.channel] || 0) + r.t.total;
  const prod = new Map();
  for (const x of sales) {
    for (const l of x.lines) {
      const k = l.productId || `txt:${fold(l.description)}`;
      const cur = prod.get(k) || { name: l.description, productId: l.productId, qty: 0, revenue: 0, profit: 0, unknownCost: false };
      const rev = Math.round(l.unitPrice * l.qty);
      cur.qty += l.qty;
      cur.revenue += rev;
      if (Number.isSafeInteger(l.unitCost)) cur.profit += rev - Math.round(l.unitCost * l.qty);
      else cur.unknownCost = true;
      prod.set(k, cur);
    }
  }
  const missingCostLines = sales.reduce((a, x) => a + x.lines.filter((l) => !Number.isSafeInteger(l.unitCost)).length, 0);
  const open = st.sales.filter((x) => x.status === 'activa').map((x) => ({ x, t: saleTotals(x) })).filter((r) => r.t.balance > 0);
  const payables = st.purchases.filter((x) => x.status === 'activa').map((x) => ({ x, t: purchaseTotals(x) })).filter((r) => r.t.balance > 0);
  const purchases = st.purchases.filter((x) => x.status === 'activa' && periodOf(x.date) === period);
  const collected = st.sales.reduce((a, x) => a + x.payments.filter((p) => p.status === 'activo' && periodOf(p.date) === period).reduce((b, p) => b + p.amount, 0), 0);
  return {
    period,
    count: sales.length,
    revenue,
    cogs,
    profit,
    marginPct: revenueKnown ? Math.round((profit / revenueKnown) * 1000) / 10 : null,
    profitSales: known.length,
    unknownSales: tots.length - known.length,
    collected,
    byChannel,
    products: [...prod.values()].sort((a, b) => b.revenue - a.revenue),
    missingCostLines,
    receivable: open.reduce((a, r) => a + r.t.balance, 0),
    debtors: open.sort((a, b) => b.t.balance - a.t.balance),
    payable: payables.reduce((a, r) => a + r.t.balance, 0),
    payables,
    purchased: purchases.reduce((a, x) => a + purchaseTotals(x).total, 0),
    lowMargin: st.products.filter((p) => p.active && Number.isSafeInteger(p.cost) && productMargin(p, p.price, p.cost, saleIvaOf(st, p)).pct < st.settings.minMarginPct),
    noCost: st.products.filter((p) => p.active && !Number.isSafeInteger(p.cost)).length,
  };
}

/* ---------------- Importar pedidos exportados de Shopify (CSV) ---------------- */
const pick = (row, header, ...names) => {
  for (const n of names) {
    const i = header.indexOf(n.toLowerCase());
    if (i >= 0 && row[i] !== undefined && String(row[i]).trim() !== '') return String(row[i]).trim();
  }
  return '';
};
const shopMoney = (v) => {
  const s = String(v || '').replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  // Shopify exporta con punto decimal ("51900.00").
  const n = Number(s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** Lee el CSV "Exportar pedidos" de Shopify. Agrupa líneas por pedido. */
export function parseShopifyOrders(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  assert(header.includes('name') && header.some((h) => h.startsWith('lineitem')), 'Ese archivo no parece la exportación de pedidos de Shopify (faltan las columnas "Name" y "Lineitem").', 'format');
  const orders = new Map();
  for (const row of rows.slice(1)) {
    const name = pick(row, header, 'Name');
    if (!name) continue;
    let o = orders.get(name);
    if (!o) {
      const created = pick(row, header, 'Created at', 'Paid at');
      o = {
        ref: name,
        date: (created.match(/\d{4}-\d{2}-\d{2}/) || [localDate()])[0],
        financial: pick(row, header, 'Financial Status').toLowerCase(),
        cancelled: !!pick(row, header, 'Cancelled at'),
        customer: pick(row, header, 'Billing Name', 'Shipping Name') || pick(row, header, 'Email') || 'Cliente Shopify',
        phone: pick(row, header, 'Billing Phone', 'Shipping Phone', 'Phone'),
        discount: shopMoney(pick(row, header, 'Discount Amount')),
        shipping: shopMoney(pick(row, header, 'Shipping')),
        total: shopMoney(pick(row, header, 'Total')),
        refunded: shopMoney(pick(row, header, 'Refunded Amount')),
        method: pick(row, header, 'Payment Method'),
        lines: [],
      };
      orders.set(name, o);
    }
    const desc = pick(row, header, 'Lineitem name');
    if (desc) o.lines.push({ description: desc, qty: Number(pick(row, header, 'Lineitem quantity')) || 1, unitPrice: shopMoney(pick(row, header, 'Lineitem price')), sku: pick(row, header, 'Lineitem sku') });
  }
  return [...orders.values()];
}

function matchProduct(st, description) {
  const f = fold(description);
  const base = fold(description.split(' - ')[0]);
  return st.products.find((p) => fold(p.name) === f || fold(p.name) === base) || st.products.find((p) => base.length > 5 && (fold(p.name).includes(base) || base.includes(fold(p.name)))) || null;
}

export function importShopifyOrders(s, { text }, ctx) {
  const st = ph(s);
  const orders = parseShopifyOrders(text);
  const report = { added: 0, skipped: [], unmatched: new Set(), total: 0 };
  for (const o of orders) {
    if (o.cancelled || ['voided', 'refunded'].includes(o.financial)) {
      report.skipped.push(`${o.ref}: cancelado o reembolsado`);
      continue;
    }
    if (st.sales.some((x) => x.externalRef === o.ref && x.status === 'activa')) {
      report.skipped.push(`${o.ref}: ya estaba registrado`);
      continue;
    }
    if (!o.lines.length) {
      report.skipped.push(`${o.ref}: sin productos`);
      continue;
    }
    const lines = o.lines.map((l) => {
      const p = matchProduct(st, l.description);
      if (!p) report.unmatched.add(l.description);
      return { productId: p?.id || null, description: l.description, qty: l.qty, unitPrice: l.unitPrice, unitCost: p?.cost ?? null };
    });
    const paid = ['paid', 'partially_refunded'].includes(o.financial) ? { amount: 'total', method: /nequi/i.test(o.method) ? 'nequi' : /bancolombia/i.test(o.method) ? 'bancolombia' : 'transferencia', note: `Shopify ${o.method || ''}`.trim() } : null;
    const sale = createPhSale(s, { date: o.date, customerName: o.customer, customerPhone: o.phone, channel: 'shopify', lines, discount: o.discount, shipping: o.shipping, externalRef: o.ref, notes: `Importado de Shopify (${o.financial || 'sin estado'}).`, paid }, ctx);
    report.added++;
    report.total += saleTotals(sale).total;
  }
  report.unmatched = [...report.unmatched];
  audit(s, ctx, 'importar', 'pethome', 'shopify', `${report.added} pedidos`);
  return report;
}

/* ---------------- Valor en letras (cuentas de cobro) ---------------- */
const U = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiún', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const D = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const C = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
function under1000(n) {
  if (n === 0) return '';
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 30 ? U[r] : `${D[Math.floor(r / 10)]}${r % 10 ? ` y ${U[r % 10]}` : ''}`;
  return [C[c], rest].filter(Boolean).join(' ');
}
export function amountInWords(value) {
  let n = Math.round(Math.abs(value));
  if (n === 0) return 'Cero pesos M/CTE';
  const parts = [];
  const millions = Math.floor(n / 1e6);
  n %= 1e6;
  const thousands = Math.floor(n / 1000);
  const units = n % 1000;
  if (millions) parts.push(millions === 1 ? 'un millón' : `${millionsWords(millions)} millones`);
  if (thousands) parts.push(thousands === 1 ? 'mil' : `${under1000(thousands)} mil`);
  if (units) parts.push(under1000(units));
  const words = parts.join(' ').replace(/\s+/g, ' ');
  const de = !thousands && !units && millions ? ' de' : '';
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}${de} pesos M/CTE`;
}
function millionsWords(m) {
  const th = Math.floor(m / 1000);
  const u = m % 1000;
  return [th ? (th === 1 ? 'mil' : `${under1000(th)} mil`) : '', under1000(u)].filter(Boolean).join(' ');
}

/* ---------------- Productos desde Shopify (exportación CSV de productos) ---------------- */
const niceName = (s) => {
  const v = cleanText(s, 120);
  return v === v.toUpperCase() ? v.charAt(0) + v.slice(1).toLowerCase() : v;
};

/** Lee el CSV de "Productos → Exportar" de Shopify: un producto por "Handle" (las variantes van en filas extra). */
export function parseShopifyProducts(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  assert(header.includes('handle') && header.includes('title') && header.includes('variant price'), 'Ese archivo no parece la exportación de productos de Shopify (faltan "Handle", "Title" o "Variant Price").', 'format');
  const out = new Map();
  for (const row of rows.slice(1)) {
    const handle = pick(row, header, 'Handle');
    if (!handle) continue;
    let p = out.get(handle);
    if (!p) {
      p = { handle, title: '', type: '', tags: '', status: '', price: null, cost: null, variants: [] };
      out.set(handle, p);
    }
    p.title ||= pick(row, header, 'Title');
    p.type ||= pick(row, header, 'Type') || pick(row, header, 'Product Category').split('>').pop().trim();
    p.tags ||= pick(row, header, 'Tags');
    p.status ||= pick(row, header, 'Status').toLowerCase();
    const price = shopMoney(pick(row, header, 'Variant Price'));
    if (price > 0 && (p.price === null || price < p.price)) p.price = price;
    const cost = shopMoney(pick(row, header, 'Cost per item'));
    if (cost > 0 && p.cost === null) p.cost = cost;
    const v = pick(row, header, 'Option1 Value');
    if (v && v !== 'Default Title' && !p.variants.includes(v)) p.variants.push(v);
  }
  return [...out.values()].filter((p) => p.title && p.price !== null);
}

/**
 * Agrega los productos nuevos de la tienda y, si se pide, actualiza el precio
 * de los que ya están. Reconoce cada producto por su "handle" de Shopify o
 * por el nombre. Nunca borra productos ni toca los costos ya escritos.
 */
export function importShopifyProducts(s, { text, updatePrices = true }, ctx) {
  const st = ph(s);
  const items = parseShopifyProducts(text);
  assert(items.length, 'El archivo no trae productos.', 'empty');
  const handleOf = (p) => p.handle || (p.shopifyId ? PETHOME_HANDLES[p.shopifyId] : null);
  const res = { added: [], priced: [], same: 0, archived: 0 };
  for (const it of items) {
    if (it.status && it.status !== 'active') {
      res.archived++;
      continue;
    }
    const pet = /gato/i.test(it.tags) && /perro/i.test(it.tags) ? 'perros y gatos' : /gato/i.test(it.tags) ? 'gatos' : 'perros';
    const found = st.products.find((p) => handleOf(p) === it.handle) || st.products.find((p) => fold(p.name) === fold(it.title));
    if (found) {
      if (!found.handle) found.handle = it.handle;
      if (updatePrices && found.price !== it.price) {
        res.priced.push(`${found.name}: ${found.price} → ${it.price}`);
        found.price = it.price;
        found.updatedAt = nowOf(ctx);
      } else res.same++;
      if (!Number.isSafeInteger(found.cost) && Number.isSafeInteger(it.cost)) found.cost = it.cost;
      continue;
    }
    st.products.push({ id: newId('php'), shopifyId: null, handle: it.handle, name: niceName(it.title), category: cleanText(it.type, 60) || 'Sin categoría', pet, price: it.price, cost: Number.isSafeInteger(it.cost) ? it.cost : null, ivaPct: 19, supplierId: null, variants: it.variants, note: '', active: true, costHistory: [], createdAt: nowOf(ctx), updatedAt: nowOf(ctx) });
    res.added.push(niceName(it.title));
  }
  st.catalogLoadedAt = nowOf(ctx);
  audit(s, ctx, 'catalogo_csv', 'pethome', 'shopify', `${res.added.length} nuevos, ${res.priced.length} precios`);
  return res;
}
