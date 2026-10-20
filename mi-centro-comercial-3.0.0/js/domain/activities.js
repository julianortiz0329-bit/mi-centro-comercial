// Gestión comercial y de cobro: llamadas, visitas, notas, WhatsApp (solo
// "contacto iniciado"), promesas de pago, seguimientos y tareas de agenda.
import { newId } from '../core/ids.js';
import { isValidDate, localDate, toInstant } from '../core/dates.js';
import { assert, audit, cleanText, getOrFail, nowOf } from './common.js';
import { ACTIVITY_TYPES } from './schema.js';

/**
 * input: { clientId, companyId, documentId, type, date, time, result, notes,
 *          promise: {date, amount}, nextAction: {date, text}, dispute }
 */
export function addActivity(s, input, ctx) {
  if (input.requestId) {
    const dup = s.activities.find((a) => a.requestId === input.requestId);
    if (dup) return dup;
  }
  const client = getOrFail(s.clients, input.clientId, 'el cliente');
  assert(input.type in ACTIVITY_TYPES, 'Tipo de gestión no válido.', 'type');
  const date = input.date || localDate(new Date(nowOf(ctx)));
  assert(isValidDate(date), 'Fecha no válida.', 'date');
  if (input.documentId) {
    const doc = getOrFail(s.documents, input.documentId, 'el documento');
    assert(doc.clientId === client.id, 'El documento es de otro cliente.', 'document');
    input.companyId = doc.companyId;
  }
  const a = {
    id: newId('act'),
    clientId: client.id,
    companyId: input.companyId || null,
    documentId: input.documentId || null,
    type: input.type,
    title: cleanText(input.title, 160) || ACTIVITY_TYPES[input.type],
    at: input.at || toInstant(date, input.time || new Date(nowOf(ctx)).toTimeString().slice(0, 5)),
    result: cleanText(input.result, 200),
    notes: cleanText(input.notes),
    promise: null,
    nextAction: null,
    requestId: input.requestId || null,
    createdAt: nowOf(ctx),
  };
  if (input.type === 'promesa') {
    const amount = Number(input.promise?.amount);
    assert(isValidDate(input.promise?.date), 'Indica la fecha comprometida de pago.', 'promise');
    assert(Number.isSafeInteger(amount) && amount > 0, 'Indica el valor comprometido.', 'promise');
    a.promise = { date: input.promise.date, amount, status: 'pendiente', resolvedAt: null, reason: '' };
    // Una promesa nueva sobre el mismo documento reemplaza a la anterior pendiente.
    for (const prev of s.activities) {
      if (prev.type === 'promesa' && prev.promise?.status === 'pendiente' && prev.clientId === client.id && prev.documentId === a.documentId) {
        prev.promise.status = 'reprogramada';
        prev.promise.resolvedAt = nowOf(ctx);
        prev.promise.reason = `Nueva fecha acordada: ${input.promise.date}`;
      }
    }
  }
  if (input.nextAction?.date) {
    assert(isValidDate(input.nextAction.date), 'La fecha de la próxima acción no es válida.', 'date');
    a.nextAction = { date: input.nextAction.date, text: cleanText(input.nextAction.text, 200) || 'Seguimiento', done: false };
  }
  if (typeof input.dispute === 'boolean' && a.documentId) {
    const doc = s.documents.find((d) => d.id === a.documentId);
    doc.dispute = { active: input.dispute, at: nowOf(ctx), notes: a.notes };
  }
  s.activities.push(a);
  if (['llamada', 'visita', 'whatsapp', 'promesa', 'seguimiento', 'recuperacion'].includes(a.type)) {
    const d = a.at.slice(0, 10);
    if (!client.lastContact || client.lastContact < d) client.lastContact = d;
  }
  audit(s, ctx, 'gestion', a.type, a.id, a.title);
  return a;
}

/** WhatsApp: abrir el enlace NO prueba que el mensaje se envió. */
export function confirmWhatsApp(s, { activityId, outcome }, ctx) {
  const a = getOrFail(s.activities, activityId, 'la gestión');
  assert(a.type === 'whatsapp', 'No es un contacto por WhatsApp.', 'type');
  assert(['enviado', 'no_enviado'].includes(outcome), 'Resultado no válido.', 'outcome');
  a.result = outcome === 'enviado' ? 'Enviado (confirmado por el usuario)' : 'No enviado';
  a.confirmedAt = nowOf(ctx);
  return a;
}

export function resolvePromise(s, { activityId, status, reason }, ctx) {
  const a = getOrFail(s.activities, activityId, 'la promesa');
  assert(a.type === 'promesa' && a.promise?.status === 'pendiente', 'La promesa ya fue resuelta.', 'promise');
  assert(['cumplida', 'incumplida'].includes(status), 'Estado no válido.', 'promise');
  if (status === 'incumplida') assert(cleanText(reason), 'Indica el motivo del incumplimiento.', 'reason');
  a.promise.status = status;
  a.promise.resolvedAt = nowOf(ctx);
  a.promise.reason = cleanText(reason);
  audit(s, ctx, 'promesa', 'gestion', a.id, status);
  return a;
}

export function completeNextAction(s, { activityId }, ctx) {
  const a = getOrFail(s.activities, activityId, 'la gestión');
  if (a.nextAction) a.nextAction.done = true;
  a.nextAction && (a.nextAction.doneAt = nowOf(ctx));
  return a;
}

export function addTask(s, input, ctx) {
  if (input.requestId) {
    const dup = s.tasks.find((t) => t.requestId === input.requestId);
    if (dup) return dup;
  }
  assert(cleanText(input.title), 'Describe la tarea.', 'title');
  assert(isValidDate(input.date), 'Indica la fecha de la tarea.', 'date');
  const t = { id: newId('tsk'), title: cleanText(input.title, 200), type: input.type || 'otro', date: input.date, time: input.time || '', companyId: input.companyId || null, clientId: input.clientId || null, documentId: input.documentId || null, notes: cleanText(input.notes), done: false, doneAt: null, result: '', requestId: input.requestId || null, createdAt: nowOf(ctx) };
  s.tasks.push(t);
  return t;
}

export function completeTask(s, { taskId, result }, ctx) {
  const t = getOrFail(s.tasks, taskId, 'la tarea');
  t.done = true;
  t.doneAt = nowOf(ctx);
  t.result = cleanText(result, 300);
  return t;
}

export function deleteTask(s, { taskId }, ctx) {
  const t = getOrFail(s.tasks, taskId, 'la tarea');
  s.tasks = s.tasks.filter((x) => x.id !== t.id);
  audit(s, ctx, 'eliminar', 'tarea', t.id, t.title);
}

/** Marca como atendido un recordatorio derivado (cobro, seguimiento…). */
export function dismissAgendaItem(s, { key }, ctx) {
  s.settings.agendaDone[key] = nowOf(ctx);
}
