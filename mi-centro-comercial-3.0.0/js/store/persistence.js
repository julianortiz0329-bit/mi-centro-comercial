// Persistencia local: IndexedDB (principal) con respaldo en localStorage si el
// navegador no lo permite. Escritura con verificación de versión (rev) para
// no sobrescribir en silencio cambios hechos en otra pestaña.
import { localDate } from '../core/dates.js';
import { migrateV1, V1_KEY } from '../domain/migrate.js';
import { emptyState, normalizeState } from '../domain/schema.js';

const DB_NAME = 'mi-centro-comercial';
const STORE = 'kv';
const FALLBACK_KEY = 'mcc_v2_state';
const FALLBACK_SNAP = 'mcc_v2_snapshots';
const MAX_SNAPSHOTS = 10;

export class ConflictError extends Error {
  constructor() {
    super('Los datos cambiaron en otra pestaña o ventana. Recarga la app para ver la versión más reciente.');
    this.name = 'ConflictError';
  }
}

let dbPromise = null;
let mode = 'indexeddb';

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB no disponible'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Base de datos bloqueada por otra pestaña'));
  });
  return dbPromise;
}

function idbGet(key) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

/** Escritura atómica con comparación de versión dentro de la transacción. */
function idbCompareAndSet(key, value, expectedRev) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    let conflict = false;
    const g = os.get(key);
    g.onsuccess = () => {
      const cur = g.result;
      if (cur && expectedRev !== null && cur.rev !== expectedRev) {
        conflict = true;
        tx.abort();
        return;
      }
      os.put(value, key);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(conflict ? new ConflictError() : tx.error || new Error('No se pudo guardar'));
    tx.onerror = () => {};
  }));
}

function idbPut(key, value) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('No se pudo guardar'));
  }));
}

function lsGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function lsSet(key, v) {
  localStorage.setItem(key, JSON.stringify(v));
}

export function storageMode() {
  return mode;
}

/** Carga el estado; en el primer arranque migra los datos de la versión 1. */
export async function loadState() {
  let stored;
  try {
    stored = await idbGet('state');
  } catch {
    mode = 'localstorage';
    stored = lsGet(FALLBACK_KEY);
  }
  if (stored) return { state: normalizeState(stored), source: 'stored' };

  let v1raw = null;
  try {
    v1raw = localStorage.getItem(V1_KEY);
  } catch {
    v1raw = null;
  }
  if (v1raw) {
    let parsed;
    try {
      parsed = JSON.parse(v1raw);
    } catch {
      parsed = null;
    }
    if (parsed) {
      const { state } = migrateV1(parsed);
      // Copia literal de la v1 dentro de las instantáneas, además de la clave
      // original que NO se borra.
      await addSnapshot('Datos originales de la versión 1 (antes de migrar)', null, v1raw);
      await saveState(state, null);
      return { state, source: 'migrated' };
    }
  }
  const s = emptyState();
  await saveState(s, null);
  return { state: s, source: 'new' };
}

export async function saveState(state, expectedRev) {
  if (mode === 'indexeddb') {
    try {
      await idbCompareAndSet('state', state, expectedRev);
      return;
    } catch (e) {
      if (e instanceof ConflictError) throw e;
      if (String(e?.message || '').includes('IndexedDB no disponible')) mode = 'localstorage';
      else throw new Error(`No se pudo guardar en el dispositivo: ${e?.message || e}`);
    }
  }
  const cur = lsGet(FALLBACK_KEY);
  if (cur && expectedRev !== null && cur.rev !== expectedRev) throw new ConflictError();
  try {
    lsSet(FALLBACK_KEY, state);
  } catch {
    throw new Error('El almacenamiento del navegador está lleno. Descarga una copia de seguridad y libera espacio.');
  }
}

export async function readStoredState() {
  const s = mode === 'indexeddb' ? await idbGet('state') : lsGet(FALLBACK_KEY);
  return s ? normalizeState(s) : null;
}

export async function listSnapshots() {
  const list = mode === 'indexeddb' ? await idbGet('snapshots').catch(() => []) : lsGet(FALLBACK_SNAP);
  return Array.isArray(list) ? list : [];
}

/** Guarda una instantánea interna (las 10 más recientes). `raw` permite
 *  guardar texto literal (p. ej. los datos v1). */
export async function addSnapshot(reason, state, raw = null) {
  const list = await listSnapshots();
  const data = raw ?? JSON.stringify(state);
  list.unshift({ id: `snp_${Date.now()}`, at: new Date().toISOString(), reason, size: data.length, data, kind: raw ? 'v1' : 'v2' });
  // La copia original de la v1 se conserva siempre.
  const keep = list.filter((x) => x.kind === 'v1').slice(0, 1);
  const rest = list.filter((x) => x.kind !== 'v1').slice(0, MAX_SNAPSHOTS);
  const out = [...rest, ...keep];
  try {
    if (mode === 'indexeddb') await idbPut('snapshots', out);
    else lsSet(FALLBACK_SNAP, out);
  } catch {
    // Sin espacio para instantáneas: no se bloquea la operación principal.
  }
}

/** Instantánea automática diaria al abrir la app. */
export async function dailySnapshot(state) {
  const list = await listSnapshots();
  const today = localDate();
  if (list.some((x) => x.kind === 'v2' && x.reason.startsWith('Automática') && x.at.slice(0, 10) === today)) return;
  if (!state.clients.length && !state.documents.length) return;
  await addSnapshot(`Automática del ${today}`, state);
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return navigator.storage?.persist ? await navigator.storage.persist() : false;
  } catch {
    return false;
  }
}

export async function storageEstimate() {
  try {
    return navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  } catch {
    return null;
  }
}
