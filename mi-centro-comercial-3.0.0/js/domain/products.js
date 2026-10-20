// Catálogo y lista de precios POR EMPRESA.
// Cada producto se vende en su presentación mínima (caja, bulto, saco…) con un
// contenido en kg o unidades. `price` es el valor de la presentación completa
// ANTES de IVA; el precio por kilo/unidad y el neto con IVA se calculan.
// Los precios del catálogo son una referencia: en cada cotización, pedido o
// venta el precio de la línea se puede negociar libremente.
import { newId } from '../core/ids.js';
import { mulDiv, parseDecimal } from '../core/money.js';
import { assert, assertActiveCompany, audit, cleanText, getOrFail, nowOf } from './common.js';
import { NOGAL_CATALOG } from './catalog-nogal.js';

export const SALE_UNITS = ['caja', 'bulto', 'saco', 'unidad', 'paquete', 'kilo'];

/** Valor con IVA (neto) a partir del valor antes de IVA. */
export function withIva(price, ivaPct) {
  return price + mulDiv(price, Math.round((ivaPct || 0) * 100), 10000);
}

/** Valor antes de IVA a partir del neto con IVA (redondeado a peso). */
export function withoutIva(neto, ivaPct) {
  return mulDiv(neto, 10000, 10000 + Math.round((ivaPct || 0) * 100));
}

/** Precio por kilo (o por unidad) antes de IVA. */
export function pricePerContent(p) {
  return p.contentQty > 0 ? Math.round(p.price / p.contentQty) : null;
}

export function presentationLabel(p) {
  if (!p.saleUnit || !p.contentQty) return p.presentation || '';
  const qty = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(p.contentQty);
  return `${p.saleUnit.charAt(0).toUpperCase()}${p.saleUnit.slice(1)} x ${qty} ${p.contentUnit === 'und' ? 'und' : 'kg'}`;
}

function validate(input) {
  assertActiveCompany(input.companyId);
  assert(cleanText(input.name), 'Escribe el nombre del producto.', 'name');
  const price = Number(input.price);
  assert(Number.isSafeInteger(price) && price >= 0, 'El precio debe ser un valor en pesos.', 'price');
  const iva = Number(input.ivaPct ?? 0);
  assert(Number.isFinite(iva) && iva >= 0 && iva <= 100, 'El IVA debe estar entre 0 y 100 %.', 'iva');
  const contentQty = input.contentQty === '' || input.contentQty == null ? null : typeof input.contentQty === 'number' ? input.contentQty : parseDecimal(input.contentQty);
  assert(contentQty === null || (Number.isFinite(contentQty) && contentQty > 0), 'El contenido debe ser un número mayor que cero (p. ej. 22,68).', 'content');
  return { price, iva, contentQty };
}

function fields(input, v) {
  return {
    code: cleanText(input.code, 60),
    name: cleanText(input.name, 200),
    category: cleanText(input.category, 80),
    saleUnit: SALE_UNITS.includes(input.saleUnit) ? input.saleUnit : input.saleUnit ? cleanText(input.saleUnit, 30) : 'caja',
    contentQty: v.contentQty,
    contentUnit: input.contentUnit === 'und' ? 'und' : 'kg',
    presentation: cleanText(input.presentation, 120),
    price: v.price,
    ivaPct: v.iva,
    note: cleanText(input.note, 400),
  };
}

export function saveProduct(s, input, ctx) {
  const v = validate(input);
  if (input.id) {
    const p = getOrFail(s.products, input.id, 'el producto');
    assert(p.companyId === input.companyId, 'Un producto no puede cambiar de empresa.', 'company');
    const prevPrice = p.price;
    Object.assign(p, fields(input, v), { active: input.active !== false, updatedAt: nowOf(ctx) });
    if (!p.presentation || input.autoPresentation) p.presentation = presentationLabel(p);
    if (prevPrice !== v.price) p.priceHistory = [...(p.priceHistory || []), { at: nowOf(ctx), from: prevPrice, to: v.price }];
    audit(s, ctx, 'editar', 'producto', p.id, p.name);
    return p;
  }
  const p = { id: newId('prd'), companyId: input.companyId, ...fields(input, v), active: true, priceHistory: [], createdAt: nowOf(ctx), updatedAt: nowOf(ctx) };
  if (!p.presentation) p.presentation = presentationLabel(p);
  s.products.push(p);
  audit(s, ctx, 'crear', 'producto', p.id, p.name);
  return p;
}

const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** Productos del catálogo inicial que aún no existen (por código o nombre). */
export function missingCatalogItems(s, companyId = 'nogal') {
  const have = s.products.filter((p) => p.companyId === companyId);
  return NOGAL_CATALOG.filter(([code, name]) => !have.some((p) => (p.code && p.code === code) || norm(p.name) === norm(name)));
}

/** Carga el catálogo inicial sin duplicar ni sobrescribir productos existentes. */
export function loadNogalCatalog(s, _input, ctx) {
  const missing = missingCatalogItems(s, 'nogal');
  for (const [code, name, category, saleUnit, contentQty, contentUnit, price, ivaPct, note] of missing) {
    saveProduct(s, { companyId: 'nogal', code, name, category, saleUnit, contentQty, contentUnit, price, ivaPct, note }, ctx);
  }
  audit(s, ctx, 'cargar_catalogo', 'producto', 'nogal', `${missing.length} producto(s)`);
  return missing.length;
}
