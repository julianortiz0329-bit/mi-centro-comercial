// Almacén transaccional: cada comando se ejecuta sobre una copia del estado;
// solo si el comando valida y el guardado termina bien, la copia reemplaza al
// estado. Si algo falla, no queda ningún cambio a medias.
import { DomainError } from '../domain/common.js';
import { addSnapshot, ConflictError, loadState, readStoredState, saveState } from './persistence.js';

let state = null;
let busy = false;
const listeners = new Set();
const channel = 'BroadcastChannel' in globalThis ? new BroadcastChannel('mi-centro-comercial') : null;

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(reason) {
  for (const fn of listeners) fn(state, reason);
}

export async function initStore() {
  const r = await loadState();
  state = r.state;
  channel?.addEventListener('message', async (ev) => {
    if (ev.data?.type === 'changed' && ev.data.rev > state.rev) {
      const fresh = await readStoredState();
      if (fresh) {
        state = fresh;
        emit('external');
      }
    }
  });
  return r;
}

export function isBusy() {
  return busy;
}

/** Ejecuta un comando de dominio de forma atómica. */
export async function run(command, input) {
  if (busy) throw new DomainError('Se está guardando la operación anterior. Espera un momento.', 'busy');
  busy = true;
  try {
    const draft = structuredClone(state);
    const ctx = { now: new Date().toISOString(), user: 'usuario' };
    const result = command(draft, input, ctx);
    draft.rev = (state.rev || 0) + 1;
    try {
      await saveState(draft, state.rev);
    } catch (e) {
      if (e instanceof ConflictError) {
        const fresh = await readStoredState();
        if (fresh) {
          state = fresh;
          emit('external');
        }
      }
      throw e;
    }
    state = draft;
    channel?.postMessage({ type: 'changed', rev: state.rev });
    emit('commit');
    return result;
  } finally {
    busy = false;
  }
}

/** Reemplaza todo el estado (restauración), con instantánea previa. */
export async function replaceState(next, reason) {
  await addSnapshot(`Antes de: ${reason}`, state);
  next.rev = (state.rev || 0) + 1;
  await saveState(next, state.rev);
  state = next;
  channel?.postMessage({ type: 'changed', rev: state.rev });
  emit('replace');
}
