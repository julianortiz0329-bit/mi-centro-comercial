import { newId } from '../core/ids.js';
import { ACTIVE_COMPANY_IDS } from './schema.js';

export class DomainError extends Error {
  constructor(message, code = 'invalid', details = null) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

/** Advertencia que el usuario puede aceptar explícitamente (p. ej. posible
 *  pago duplicado o cupo excedido). El comando se repite con `confirm`. */
export class ConfirmRequired extends DomainError {
  constructor(message, key) {
    super(message, 'confirm_required', { key });
    this.name = 'ConfirmRequired';
    this.key = key;
  }
}

export function assert(cond, message, code) {
  if (!cond) throw new DomainError(message, code);
}

export function nowOf(ctx) {
  return ctx?.now || new Date().toISOString();
}

export function audit(s, ctx, action, entity, entityId, detail = '') {
  s.audit.push({ id: newId('aud'), at: nowOf(ctx), user: ctx?.user || 'usuario', action, entity, entityId, detail });
}

export function assertActiveCompany(companyId) {
  assert(ACTIVE_COMPANY_IDS.includes(companyId), 'Selecciona El Puntazo o Frutos del Nogal.', 'company');
}

export function nextNumber(s, companyId, kind) {
  const prefix = { cotizacion: 'COT', pedido: 'PED', venta: 'VEN', pago: 'REC', liquidacion: 'LIQ' }[kind] || kind.toUpperCase();
  const key = `${companyId}:${kind}`;
  s.counters[key] = (s.counters[key] || 0) + 1;
  const short = s.companies[companyId]?.short || companyId.slice(0, 2).toUpperCase();
  return `${short}-${prefix}-${String(s.counters[key]).padStart(4, '0')}`;
}

export function byId(list, id) {
  return list.find((x) => x.id === id) || null;
}

export function getOrFail(list, id, what) {
  const x = byId(list, id);
  if (!x) throw new DomainError(`No se encontró ${what}.`, 'not_found');
  return x;
}

export function cleanText(v, max = 2000) {
  return String(v ?? '').trim().slice(0, max);
}
