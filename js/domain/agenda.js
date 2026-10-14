// Agenda del día: une tareas manuales con recordatorios derivados de la
// cartera, las promesas de pago, los pedidos y los seguimientos de clientes.
import { diffDays, localDate } from '../core/dates.js';
import { receivables } from './ledger.js';
import { scopeCompanies } from './metrics.js';

export function buildAgenda(s, scope, { today = localDate(), horizonDays = 7 } = {}) {
  const cos = scopeCompanies(scope);
  const done = s.settings.agendaDone || {};
  const items = [];
  const push = (it) => {
    if (it.key && done[it.key]) return;
    it.days = diffDays(today, it.date);
    if (it.days > horizonDays) return;
    items.push(it);
  };
  const clientOk = (c) => c.companyIds.some((x) => cos.includes(x));
  const name = (id) => s.clients.find((c) => c.id === id)?.tradeName || 'Cliente';

  for (const r of receivables(s, { today })) {
    if (!cos.includes(r.doc.companyId)) continue;
    push({ key: `cobro:${r.doc.id}:${r.doc.dueDate}`, type: 'cobro', icon: '💳', date: r.doc.dueDate, title: `Cobrar ${r.doc.number} a ${name(r.doc.clientId)}`, companyId: r.doc.companyId, clientId: r.doc.clientId, documentId: r.doc.id, amount: r.balance });
  }
  for (const a of s.activities) {
    if (a.companyId && !cos.includes(a.companyId)) continue;
    if (a.type === 'promesa' && a.promise?.status === 'pendiente') push({ key: null, type: 'promesa', icon: '🤝', date: a.promise.date, title: `Promesa de pago de ${name(a.clientId)}`, companyId: a.companyId, clientId: a.clientId, documentId: a.documentId, amount: a.promise.amount, activityId: a.id });
    if (a.nextAction?.date && !a.nextAction.done) push({ key: null, type: 'seguimiento', icon: '📞', date: a.nextAction.date, title: `${a.nextAction.text} · ${name(a.clientId)}`, companyId: a.companyId, clientId: a.clientId, documentId: a.documentId, activityId: a.id, nextAction: true });
  }
  for (const d of s.documents) {
    if (!cos.includes(d.companyId)) continue;
    if (d.kind === 'pedido' && ['confirmado', 'en_preparacion', 'despacho_parcial'].includes(d.status)) push({ key: `despacho:${d.id}:${d.status}`, type: 'despacho', icon: '📦', date: d.date, title: `${d.status === 'despacho_parcial' ? 'Completar despacho' : 'Despachar'} ${d.number} · ${name(d.clientId)}`, companyId: d.companyId, clientId: d.clientId, documentId: d.id });
    if (d.kind === 'pedido' && d.status === 'pendiente_confirmacion') push({ key: `confirmar:${d.id}`, type: 'pedido', icon: '📝', date: d.date, title: `Confirmar ${d.number} · ${name(d.clientId)}`, companyId: d.companyId, clientId: d.clientId, documentId: d.id });
    if (d.kind === 'cotizacion' && d.status === 'cotizado') push({ key: `cotizacion:${d.id}`, type: 'cotizacion', icon: '🧾', date: d.validUntil || d.date, title: `Seguir cotización ${d.number} · ${name(d.clientId)}`, companyId: d.companyId, clientId: d.clientId, documentId: d.id });
  }
  for (const c of s.clients) {
    if (!clientOk(c) || !c.nextVisit) continue;
    push({ key: `visita:${c.id}:${c.nextVisit}`, type: 'visita', icon: '🚗', date: c.nextVisit, title: `Visitar a ${c.tradeName}`, clientId: c.id, detail: [c.city, c.address].filter(Boolean).join(' · ') });
  }
  for (const t of s.tasks) {
    if (t.done) continue;
    if (t.companyId && !cos.includes(t.companyId)) continue;
    push({ key: null, type: t.type, icon: { visita: '🚗', llamada: '📞', cobro: '💵', despacho: '📦', recuperacion: '🔁' }[t.type] || '📌', date: t.date, title: t.title, companyId: t.companyId, clientId: t.clientId, documentId: t.documentId, taskId: t.id, detail: t.notes });
  }
  const rank = (it) => (it.days < 0 ? 0 : it.days === 0 ? 1 : 2);
  return items.sort((a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date) || (b.amount || 0) - (a.amount || 0));
}
