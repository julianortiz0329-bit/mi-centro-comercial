// Copias de seguridad: archivo JSON con verificación de integridad.
import { normalizeState, SCHEMA_VERSION } from './schema.js';
import { migrateV1 } from './migrate.js';

/** Hash FNV-1a de 32 bits (detecta archivos truncados o editados por error). */
export function checksum(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function makeBackup(state, now = new Date().toISOString()) {
  const data = JSON.stringify(state);
  return JSON.stringify({ app: 'Mi Centro Comercial', format: 'mcc-backup', schema: SCHEMA_VERSION, exportedAt: now, checksum: checksum(data), counts: counts(state), data: state });
}

export function counts(s) {
  return { clientes: s.clients?.length || 0, documentos: s.documents?.length || 0, pagos: s.payments?.length || 0, comisiones: s.commissions?.length || 0, productos: s.products?.length || 0 };
}

/** Lee una copia (v2 o la copia JSON de la versión 1) y devuelve un estado v2. */
export function readBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  if (parsed?.format === 'mcc-backup') {
    if (parsed.schema > SCHEMA_VERSION) throw new Error('La copia es de una versión más nueva de la app. Actualiza la app antes de restaurarla.');
    const data = JSON.stringify(parsed.data);
    if (checksum(data) !== parsed.checksum) throw new Error('La copia está dañada o fue modificada (la verificación de integridad no coincide).');
    const s = normalizeState(parsed.data);
    for (const k of ['clients', 'documents', 'payments', 'commissions']) if (!Array.isArray(s[k])) throw new Error('Estructura de la copia no reconocida.');
    return { state: s, kind: 'v2', exportedAt: parsed.exportedAt };
  }
  if (parsed?.app === 'Mi Centro Comercial' || (Array.isArray(parsed?.clients) && Array.isArray(parsed?.products))) {
    const { state, report } = migrateV1(parsed);
    return { state, kind: 'v1', report, exportedAt: parsed.exportedAt || null };
  }
  throw new Error('No es una copia de Mi Centro Comercial.');
}
