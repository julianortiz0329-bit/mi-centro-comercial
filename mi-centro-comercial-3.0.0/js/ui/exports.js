// Exportaciones CSV (Excel en español). Siempre incluyen la empresa.
import { localDate, periodOf } from '../core/dates.js';
import { toCSV } from '../domain/csv.js';
import { clientKpis } from '../domain/clients.js';
import { allocationsFor, receivables } from '../domain/ledger.js';
import { scopeCompanies } from '../domain/metrics.js';
import { CLIENT_STATUSES, COMMISSION_STATUSES, PAYMENT_METHODS } from '../domain/schema.js';
import { getState } from '../store/store.js';
import { download, toast } from './dom.js';
import { statusLabel } from './views-sales.js';

export function exportData(what, { scope, period = null, companyId = null } = {}) {
  const s = getState();
  const cos = companyId ? [companyId] : scopeCompanies(scope);
  const co = (id) => s.companies[id]?.name || id;
  const cl = (id) => s.clients.find((c) => c.id === id);
  const inP = (date) => !period || periodOf(date) === period;
  let headers;
  let rows;
  if (what === 'clientes') {
    headers = ['codigo', 'nombre_comercial', 'razon_social', 'nit', 'contacto', 'telefono', 'whatsapp', 'correo', 'departamento', 'ciudad', 'direccion', 'empresas', 'categoria', 'estado', 'etiquetas', 'total_vendido', 'saldo', 'vencido', 'ultima_compra', 'observaciones'];
    rows = s.clients.filter((c) => c.companyIds.some((x) => cos.includes(x))).map((c) => {
      const k = clientKpis(s, c.id, cos.length === 1 ? cos[0] : null);
      return [c.code, c.tradeName, c.legalName, c.taxId, c.contactName, c.phone, c.whatsapp, c.email, c.department, c.city, c.address, c.companyIds.map(co).join(' / '), c.category, CLIENT_STATUSES[c.status], (c.tags || []).join(', '), k.totalSold, k.balance, k.overdue, k.lastPurchase || '', c.notes];
    });
  } else if (what === 'ventas') {
    headers = ['empresa', 'tipo', 'numero', 'referencia', 'fecha', 'cliente', 'nit', 'modalidad', 'condicion_dias', 'vencimiento', 'subtotal', 'descuento', 'antes_de_iva', 'iva', 'total', 'abonado', 'saldo', 'estado'];
    rows = s.documents.filter((d) => cos.includes(d.companyId) && inP(d.date)).map((d) => {
      const paid = allocationsFor(s, d.id).reduce((a, x) => a + x.amount, 0);
      return [co(d.companyId), d.kind, d.number, d.externalRef, d.date, cl(d.clientId)?.tradeName, cl(d.clientId)?.taxId, d.saleMode || '', d.term?.days ?? '', d.dueDate || '', d.totals.gross, d.totals.discount, d.totals.net, d.totals.iva, d.totals.total, d.kind === 'venta' ? paid : '', d.kind === 'venta' && d.status === 'emitida' ? d.totals.total - paid : '', statusLabel(d)];
    });
  } else if (what === 'cartera') {
    headers = ['empresa', 'cliente', 'ciudad', 'documento', 'fecha_venta', 'vencimiento', 'valor_original', 'abonado', 'saldo', 'dias_mora', 'rango', 'ultima_gestion', 'ultima_promesa', 'proxima_accion'];
    rows = receivables(s, {}).filter((r) => cos.includes(r.doc.companyId)).map((r) => [co(r.doc.companyId), cl(r.doc.clientId)?.tradeName, cl(r.doc.clientId)?.city, r.doc.number, r.doc.date, r.doc.dueDate, r.doc.totals.total, r.paid, r.balance, Math.max(0, r.daysLate), r.bucket.label, r.lastContact?.at?.slice(0, 10) || '', r.lastPromise ? `${r.lastPromise.promise.amount} ${r.lastPromise.promise.date} ${r.lastPromise.promise.status}` : '', r.nextAction ? `${r.nextAction.date} ${r.nextAction.text}` : '']);
  } else if (what === 'pagos') {
    headers = ['empresa', 'numero', 'fecha', 'cliente', 'metodo', 'referencia', 'valor', 'aplicado', 'sin_aplicar', 'documentos', 'estado', 'motivo_reversion'];
    rows = s.payments.filter((p) => cos.includes(p.companyId) && inP(p.date)).map((p) => {
      const ap = p.allocations.reduce((a, x) => a + x.amount, 0);
      return [co(p.companyId), p.number, p.date, cl(p.clientId)?.tradeName, PAYMENT_METHODS[p.method] || p.method, p.reference, p.amount, ap, p.status === 'activo' ? p.amount - ap : 0, p.allocations.map((a) => `${s.documents.find((d) => d.id === a.documentId)?.number}:${a.amount}`).join(' | '), p.status, p.reversal?.reason || ''];
    });
  } else if (what === 'comisiones') {
    headers = ['empresa', 'tipo', 'periodo', 'fecha_operacion', 'documento', 'cliente', 'modalidad', 'base', 'tratamiento_iva', 'porcentaje', 'comision', 'estado', 'motivo', 'liquidacion', 'fecha_pago', 'generada'];
    rows = s.commissions.filter((c) => cos.includes(c.companyId) && (!period || c.period === period)).map((c) => [co(c.companyId), c.type, c.period, c.operationAt.slice(0, 10), s.documents.find((d) => d.id === c.documentId)?.number, cl(c.clientId)?.tradeName, c.mode || '', c.base, c.ivaTreatment, (c.rateBps / 100).toString().replace('.', ','), c.amount, COMMISSION_STATUSES[c.status], c.blockedReason || c.reversal?.reason || c.adjustmentReason || '', s.settlements.find((x) => x.id === c.settlementId)?.number || '', c.paidAt || '', c.createdAt]);
  } else if (what === 'productos') {
    headers = ['empresa', 'codigo', 'nombre', 'presentacion', 'categoria', 'precio', 'iva', 'activo'];
    rows = s.products.filter((p) => cos.includes(p.companyId)).map((p) => [co(p.companyId), p.code, p.name, p.presentation, p.category, p.price, p.ivaPct, p.active ? 'si' : 'no']);
  } else return;
  download(`mcc-${what}-${cos.length === 1 ? cos[0] : 'consolidado'}${period ? '-' + period : ''}-${localDate()}.csv`, toCSV(headers, rows), 'text/csv;charset=utf-8');
  toast(`Exportado: ${rows.length} fila(s)`);
}
