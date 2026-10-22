// Traduce el estado de la app a "registros" que se guardan en la nube (uno por
// venta, gasto, producto…) y de vuelta. Así cada socio sube solo lo que cambió
// y dos personas pueden registrar a la vez sin pisarse.
import { emptyPetHome } from './pethome.js';
import { emptyLedger, summaryRecords } from './ledger.js';

const COLLECTIONS = [
  ['producto', 'pethome', 'products'],
  ['proveedor', 'pethome', 'suppliers'],
  ['nota', 'pethome', 'notes'],
  ['venta', 'pethome', 'sales'],
  ['compra', 'pethome', 'purchases'],
  ['cuenta', 'ledger', 'accounts'],
  ['gasto', 'ledger', 'expenses'],
  ['aporte', 'ledger', 'contributions'],
  ['retiro', 'ledger', 'withdrawals'],
  ['traslado', 'ledger', 'transfers'],
];

/** Estado → { id: { tipo, datos } } (incluye los resúmenes para Mi Centro Comercial). */
export function toRecordMap(s, { summaries = true } = {}) {
  const out = {};
  const ph = s.pethome || emptyPetHome();
  out.perfil = { tipo: 'perfil', datos: ph.profile };
  out.ajustes = { tipo: 'ajustes', datos: { settings: ph.settings, catalogLoadedAt: ph.catalogLoadedAt || null } };
  for (const [tipo, root, key] of COLLECTIONS) for (const x of (s[root] || {})[key] || []) out[x.id] = { tipo, datos: x };
  if (summaries && s.socios?.length) for (const r of summaryRecords(s)) out[r.id] = { tipo: r.tipo, datos: r.datos };
  return out;
}

const order = (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id));
const maxNum = (list, prefix) => list.reduce((m, x) => (String(x.number || '').startsWith(`${prefix}-`) ? Math.max(m, Number(x.number.split('-')[1]) || 0) : m), 0);

/** { id: { tipo, datos, borrado } } → estado. Los contadores salen del número más alto. */
export function fromRecordMap(recs, base = {}) {
  const pethome = emptyPetHome();
  const ledger = emptyLedger();
  if (recs.perfil && !recs.perfil.borrado) pethome.profile = { ...pethome.profile, ...recs.perfil.datos };
  if (recs.ajustes && !recs.ajustes.borrado) {
    pethome.settings = { ...pethome.settings, ...(recs.ajustes.datos.settings || {}) };
    pethome.catalogLoadedAt = recs.ajustes.datos.catalogLoadedAt || null;
  }
  const buckets = Object.fromEntries(COLLECTIONS.map(([tipo]) => [tipo, []]));
  for (const [id, r] of Object.entries(recs)) if (!r.borrado && buckets[r.tipo]) buckets[r.tipo].push({ ...r.datos, id });
  for (const [tipo, root, key] of COLLECTIONS) (root === 'pethome' ? pethome : ledger)[key] = buckets[tipo].sort(order);
  pethome.counters = {
    sale: maxNum(pethome.sales, 'AP'),
    purchase: maxNum(pethome.purchases, 'CP'),
    receipt: pethome.sales.reduce((m, x) => Math.max(m, maxNum(x.payments || [], 'RC')), 0),
  };
  return { ...base, pethome, ledger };
}

/** JSON con las llaves ordenadas: la nube (jsonb) reordena las llaves. */
export function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** Cambios entre dos mapas de registros: lo nuevo o distinto, y lo que desapareció. */
export function diffRecords(before, after) {
  const changes = [];
  for (const [id, r] of Object.entries(after)) {
    const prev = before[id];
    if (!prev || prev.borrado || stable(prev.datos) !== stable(r.datos)) changes.push({ id, tipo: r.tipo, datos: r.datos, borrado: false });
  }
  for (const [id, r] of Object.entries(before)) if (!after[id] && !r.borrado) changes.push({ id, tipo: r.tipo, datos: r.datos, borrado: true });
  return changes;
}
