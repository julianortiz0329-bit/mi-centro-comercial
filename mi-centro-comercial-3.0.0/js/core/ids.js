// Identificadores únicos (no secuenciales) para todas las entidades.
export function newId(prefix = '') {
  let rnd;
  if (globalThis.crypto?.randomUUID) rnd = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  else rnd = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  return prefix ? `${prefix}_${rnd}` : rnd;
}
