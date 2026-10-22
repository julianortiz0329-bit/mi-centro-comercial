// Almacén con sincronización: cada comando se ejecuta sobre una copia del
// estado; si valida, se calculan los registros que cambiaron, se guardan en el
// celular (para trabajar sin internet) y se suben a la nube. Cada pocos
// segundos se bajan los cambios del otro socio.
import { DomainError } from '../domain/common.js';
import { diffRecords, fromRecordMap, stable, toRecordMap } from '../domain/records.js';
import { RemoteError, rpc } from './remote.js';

const KEY = 'alegria_clave';
const DB = 'alegria-libro';
let state = null;
let recs = {};
let pending = {};
let lastPulled = null;
let clave = null;
let busy = false;
let syncing = null;
const listeners = new Set();
export const sync = { online: true, pending: 0, lastOk: null, error: '' };

export const getState = () => state;
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(reason) {
  sync.pending = Object.keys(pending).length;
  for (const fn of listeners) fn(state, reason);
}

/* ---------------- Copia local (IndexedDB) ---------------- */
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbGet(k) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const q = db.transaction('kv').objectStore('kv').get(k);
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}
async function idbSet(k, v) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(v, k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
const persist = () => idbSet('cache', { recs, pending, lastPulled, socios: state?.socios || [], me: state?.me || null });

/* ---------------- Sesión ---------------- */
export function savedKey() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Entra con la clave del socio. Devuelve el socio. */
export async function login(k) {
  const r = await rpc('alegria_entrar', { p_clave: k.trim() });
  clave = k.trim();
  try {
    localStorage.setItem(KEY, clave);
  } catch {
    /* sin almacenamiento: la sesión dura mientras la app esté abierta */
  }
  const cache = await idbGet('cache').catch(() => null);
  // Si la copia del celular es de otro socio, se empieza de cero.
  if (cache?.me?.id === r.socio.id) {
    ({ recs, pending, lastPulled } = cache);
  } else {
    recs = {};
    pending = {};
    lastPulled = null;
  }
  state = fromRecordMap(recs, { socios: r.socios, me: r.socio });
  return r.socio;
}

export async function logout() {
  clave = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nada */
  }
  await idbSet('cache', null).catch(() => {});
  state = null;
  recs = {};
  pending = {};
}

/** Abre con la copia del celular (sin esperar la nube). */
export async function openCached() {
  clave = savedKey();
  if (!clave) return false;
  const cache = await idbGet('cache').catch(() => null);
  if (!cache?.me) return false;
  ({ recs, pending, lastPulled } = cache);
  state = fromRecordMap(recs, { socios: cache.socios, me: cache.me });
  return true;
}

/* ---------------- Comandos ---------------- */
export async function run(command, input) {
  if (busy) throw new DomainError('Se está guardando la operación anterior. Espera un momento.', 'busy');
  busy = true;
  try {
    const draft = structuredClone(state);
    const ctx = { now: new Date().toISOString(), user: state.me?.nombre || 'socio' };
    const result = command(draft, input, ctx);
    const after = toRecordMap(draft);
    for (const c of diffRecords(recs, after)) {
      pending[c.id] = c;
      recs[c.id] = { tipo: c.tipo, datos: c.datos, borrado: c.borrado };
    }
    state = draft;
    await persist().catch(() => {});
    emit('commit');
    syncNow();
    return result;
  } finally {
    busy = false;
  }
}

/* ---------------- Sincronización ---------------- */
async function push() {
  const batch = Object.values(pending);
  if (!batch.length) return;
  for (let i = 0; i < batch.length; i += 200) {
    const part = batch.slice(i, i + 200);
    await rpc('alegria_guardar', { p_clave: clave, p_cambios: part.map(({ id, tipo, datos, borrado }) => ({ id, tipo, datos, borrado })) });
    // Solo se quita de pendientes si no cambió otra vez mientras subía.
    for (const c of part) if (pending[c.id] === c) delete pending[c.id];
  }
}

async function pull() {
  // Se pide con un margen hacia atrás: aplicar dos veces lo mismo no hace daño.
  const desde = lastPulled ? new Date(new Date(lastPulled).getTime() - 60000).toISOString() : null;
  const r = await rpc('alegria_leer', { p_clave: clave, p_desde: desde });
  let changed = false;
  for (const x of r.registros || []) {
    if (pending[x.id]) continue;
    const cur = recs[x.id];
    if (cur && cur.borrado === x.borrado && stable(cur.datos) === stable(x.datos)) continue;
    recs[x.id] = { tipo: x.tipo, datos: x.datos, borrado: x.borrado };
    changed = true;
  }
  lastPulled = r.ahora;
  const socios = r.socios || state.socios;
  const me = socios.find((x) => x.id === state.me.id) || state.me;
  if (changed || JSON.stringify(socios) !== JSON.stringify(state.socios) || me.nombre !== state.me.nombre) {
    state = { ...fromRecordMap(recs, { socios, me }), audit: state.audit };
    changed = true;
  }
  // Los resúmenes que lee Mi Centro Comercial se mantienen al día con lo que llegó.
  for (const c of diffRecords(recs, toRecordMap(state))) {
    if (c.tipo !== 'resumen') continue;
    pending[c.id] = c;
    recs[c.id] = { tipo: c.tipo, datos: c.datos, borrado: c.borrado };
  }
  return changed;
}

/** Sube lo pendiente y baja lo nuevo. Nunca lanza: deja el estado en `sync`. */
export function syncNow() {
  if (!clave || !state) return Promise.resolve(false);
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      await push();
      const changed = await pull();
      if (Object.keys(pending).length) await push();
      await persist().catch(() => {});
      Object.assign(sync, { online: true, lastOk: new Date().toISOString(), error: '' });
      emit(changed ? 'remote' : 'sync');
      return changed;
    } catch (e) {
      Object.assign(sync, { online: !(e instanceof RemoteError && e.offline), error: e.message });
      if (e instanceof RemoteError && e.auth) emit('auth');
      else emit('sync');
      return false;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

export function startAutoSync(ms = 20000) {
  setInterval(() => document.visibilityState === 'visible' && !busy && syncNow(), ms);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncNow());
  window.addEventListener('online', () => syncNow());
}

export async function renameMe(nombre) {
  const r = await rpc('alegria_mi_nombre', { p_clave: clave, p_nombre: nombre });
  state.me = { ...state.me, nombre: r.nombre };
  await syncNow();
  return r;
}

export async function saveAttachment(id, dataUrl) {
  return rpc('alegria_adjunto_guardar', { p_clave: clave, p_id: id, p_datos: dataUrl });
}
export async function readAttachment(id) {
  return rpc('alegria_adjunto_leer', { p_clave: clave, p_id: id });
}
