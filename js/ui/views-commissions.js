import { formatDate, formatDateTime, localDate, periodLabel, previousPeriod } from '../core/dates.js';
import { formatPct } from '../core/money.js';
import { commissionSummary, thresholdStatus } from '../domain/commissions.js';
import { COMMISSION_STATUSES } from '../domain/schema.js';
import { getState } from '../store/store.js';
import { empty, esc, money, pill, stat } from './dom.js';
import { thresholdCard } from './views-home.js';
import { ui } from './state.js';
import { icon } from './icons.js';

const S = () => getState();
const typeLabel = { venta: 'Venta', cobro: 'Cobro', ajuste: 'Ajuste' };

export function renderCommissions(params) {
  const s = S();
  const co = params.get('co') || (ui.scope !== 'todas' ? ui.scope : 'puntazo');
  const period = params.get('p') || localDate().slice(0, 7);
  const status = params.get('st') || '';
  const type = params.get('t') || '';
  const periods = Array.from({ length: 12 }, (_, i) => previousPeriod(localDate().slice(0, 7), i));
  const rules = s.rules[co];
  const sumAll = commissionSummary(s, { companyId: co });
  const sumP = commissionSummary(s, { companyId: co, period });
  const lines = s.commissions.filter((c) => c.companyId === co && (period === 'todos' || c.period === period) && (!status || c.status === status) && (!type || c.type === type)).sort((a, b) => b.operationAt.localeCompare(a.operationAt));
  const docNum = (id) => s.documents.find((d) => d.id === id)?.number || '—';
  const client = (id) => s.clients.find((c) => c.id === id)?.tradeName || '';
  const settlements = s.settlements.filter((x) => x.companyId === co).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const policy = s.settings.policy?.[co];
  const q = (patch) => `#/comisiones?${new URLSearchParams({ co, p: period, st: status, t: type, ...patch })}`;
  const rulesBox = rules.kind === 'recaudo'
    ? `<p>Comisión por venta: <b>${formatPct(rules.saleBps)}</b> · Comisión por cobro: <b>${formatPct(rules.collectionBps)}</b> del valor efectivamente recaudado, sin importar la fecha de la venta. Los abonos parciales comisionan en proporción al dinero recibido.</p>`
    : `<p>Umbral mensual: <b>${money(rules.thresholdPesos)}</b> en ventas ${rules.thresholdBase === 'total' ? 'con IVA' : 'antes de IVA'}. Mayorista: <b>${formatPct(rules.modes.mayorista.saleBps)}</b> venta / <b>${formatPct(rules.modes.mayorista.collectionBps)}</b> cobro. Normal: <b>${formatPct(rules.modes.normal.saleBps)}</b> venta / <b>${formatPct(rules.modes.normal.collectionBps)}</b> cobro. Base: valor antes de IVA después de descuentos; en los cobros, recaudo × (antes de IVA ÷ total).</p>
      <details><summary>Política de elegibilidad aplicada</summary><ol class="policy">
        <li>Mientras el mes no llega a $70 M antes de IVA, la comisión de cada venta y cobro se va acumulando <b>en espera</b>.</li>
        <li>Al llegar a $70 M se desbloquea <b>toda</b> la comisión del mes, desde el primer peso, y lo que vendas después comisiona de una vez.</li>
        <li>Si el mes termina sin llegar a $70 M, esa comisión no se paga.</li>
        <li>El cobro sigue al mes de la venta: si ese mes llegó a $70 M, el cobro comisiona aunque te paguen después.</li>
        <li>Cada mes inicia un nuevo periodo; el historial anterior no cambia.</li>
      </ol></details>
      <div class="notice ${policy?.confirmed ? 'info' : 'warn'}">${policy?.confirmed ? `Política confirmada el ${formatDateTime(policy.confirmedAt)}. Ya puedes liquidar.` : 'Antes de liquidar comisiones definitivas, confirma que esta política coincide con lo acordado con Frutos del Nogal.'} ${policy?.confirmed ? '' : '<button class="btn btn-primary btn-small" data-act="confirm-policy" data-co="nogal">Confirmar política</button>'}</div>`;
  return `<div class="page-head"><div><p class="eyebrow">Motor de comisiones</p><h1>Comisiones</h1></div></div>
  <div class="tabs">${['puntazo', 'nogal'].map((c) => `<a href="#/comisiones?co=${c}&p=${period}" class="${co === c ? 'active' : ''}">${s.companies[c].icon} ${esc(s.companies[c].name)}</a>`).join('')}</div>
  <section class="panel"><h2>Reglas vigentes</h2>${rulesBox}<p class="muted small">Cada comisión guarda una copia de las reglas con que se calculó; un cambio de porcentaje no altera el historial.</p></section>
  ${co === 'nogal' && period !== 'todos' ? thresholdCard(thresholdStatus(s, 'nogal', period)) : ''}
  <div class="stats">${stat('Pendiente de liquidar', money(sumAll.pending), 'Todos los periodos')}${stat('Liquidada (por cobrar a la empresa)', money(sumAll.settled))}${stat('Pagada', money(sumAll.paid))}${stat(`Generada en ${period === 'todos' ? 'total' : periodLabel(period)}`, money(sumP.generated), `Venta ${money(sumP.sale)} · Cobro ${money(sumP.collection)}${sumP.adjustments ? ` · Ajustes ${money(sumP.adjustments)}` : ''}`)}${stat('Reversada', money(sumP.reversed), period === 'todos' ? '' : periodLabel(period))}${stat('Bloqueada (no se paga)', money(sumP.blocked), 'Informativo')}</div>
  <section class="panel"><div class="panel-head"><h2>Movimientos de comisión</h2><button class="btn btn-primary btn-small" data-act="settle" data-co="${co}">Liquidar seleccionadas</button></div>
    <div class="toolbar"><select data-nav aria-label="Periodo">${['todos', ...periods].map((p) => `<option value="${q({ p })}" ${p === period ? 'selected' : ''}>${p === 'todos' ? 'Todos los periodos' : periodLabel(p)}</option>`).join('')}</select>
      <select data-nav aria-label="Estado"><option value="${q({ st: '' })}">Todos los estados</option>${Object.entries(COMMISSION_STATUSES).map(([k, l]) => `<option value="${q({ st: k })}" ${status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select data-nav aria-label="Tipo"><option value="${q({ t: '' })}">Venta, cobro y ajustes</option>${Object.entries(typeLabel).map(([k, l]) => `<option value="${q({ t: k })}" ${type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn btn-plain btn-small" data-act="export" data-what="comisiones" data-co="${co}">Exportar CSV</button>
      ${period !== 'todos' ? `<button class="btn btn-primary btn-small" data-act="commission-pdf" data-co="${co}" data-period="${period}">📄 Informe PDF del mes</button>` : ''}</div>
    ${lines.length ? `<div class="table-wrap"><table class="comm"><thead><tr><th><input type="checkbox" data-check-all aria-label="Seleccionar pendientes"></th><th>Fecha op.</th><th>Tipo</th><th>Documento</th><th>Cliente</th><th>Modalidad</th><th>Base</th><th>%</th><th>Comisión</th><th>Estado</th></tr></thead><tbody>
    ${lines.slice(0, 500).map((c) => `<tr class="${c.status}"><td>${c.status === 'generada' ? `<input type="checkbox" data-comm="${c.id}" aria-label="Seleccionar">` : ''}</td><td>${formatDate(c.operationAt)}</td><td>${typeLabel[c.type]}</td><td><a href="#/doc/${c.documentId}">${esc(docNum(c.documentId))}</a></td><td>${esc(client(c.clientId))}</td><td>${c.mode ? esc(c.mode) : '—'}</td><td>${money(c.base)}</td><td>${formatPct(c.rateBps)}</td><td><button type="button" class="why" data-act="why-comm" data-id="${c.id}" title="¿Cómo se calculó?"><b>${money(c.amount)}</b>${icon('info', { size: 14 })}</button></td><td>${pill(c.pendingThreshold && c.status === 'bloqueada' ? 'En espera' : COMMISSION_STATUSES[c.status], { generada: 'info', liquidada: 'warn', pagada: 'ok', reversada: 'danger', bloqueada: '' }[c.status])}${c.blockedReason ? `<small class="block">${esc(c.blockedReason)}</small>` : ''}${c.reversal ? `<small class="block">${esc(c.reversal.reason)}</small>` : ''}${c.adjustmentReason ? `<small class="block">${esc(c.adjustmentReason)}</small>` : ''}</td></tr>`).join('')}
    </tbody></table></div><p class="muted small">Toca el valor de una comisión para ver cómo se calculó.</p><p class="muted small" data-selected-sum></p>` : empty('💰', 'Sin movimientos con estos filtros', co === 'puntazo' ? 'Las comisiones de El Puntazo se generan al registrar cobros.' : 'Las comisiones de Frutos del Nogal se generan con ventas y cobros elegibles.', '<button class="btn btn-primary" data-act="pay">＋ Registrar un cobro</button>')}
  </section>
  <section class="panel"><h2>Liquidaciones</h2><p class="muted small">Liquidar agrupa comisiones pendientes para cobrarlas a la empresa. Solo cuando registres que te pagaron quedan como "pagadas".</p>
  ${settlements.length ? `<div class="table-wrap"><table><thead><tr><th>N.º</th><th>Fecha</th><th>Líneas</th><th>Total</th><th>Estado</th><th></th></tr></thead><tbody>${settlements.map((x) => `<tr><td>${esc(x.number)}</td><td>${formatDate(x.createdAt)}</td><td>${x.commissionIds.length}</td><td>${money(x.total)}</td><td>${pill({ liquidada: 'Liquidada · por pagar', pagada: `Pagada ${formatDate(x.paidAt)}`, anulada: 'Anulada' }[x.status], { liquidada: 'warn', pagada: 'ok', anulada: 'danger' }[x.status])}</td><td>${x.status === 'liquidada' ? `<button class="btn btn-primary btn-xs" data-act="settle-paid" data-id="${x.id}">Registrar pago recibido</button> <button class="btn btn-plain btn-xs" data-act="settle-cancel" data-id="${x.id}">Anular</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Aún no hay liquidaciones.</p>'}</section>`;
}

/** Explicación paso a paso de una línea de comisión (para cuadrar números). */
export function explainCommission(s, id) {
  const c = s.commissions.find((x) => x.id === id);
  if (!c) return null;
  const doc = s.documents.find((d) => d.id === c.documentId);
  const client = s.clients.find((x) => x.id === c.clientId)?.tradeName || '';
  const co = s.companies[c.companyId]?.name;
  const pct = formatPct(c.rateBps);
  const steps = [];
  const exact = Math.round((c.base * c.rateBps) / 10000);
  const row = (k, v, strong = false) => `<div class="why-row${strong ? ' strong' : ''}"><span>${k}</span><b>${v}</b></div>`;
  if (c.type === 'venta') {
    steps.push(row(`Venta ${esc(doc?.number || '')} · ${esc(client)}`, ''));
    if (doc) steps.push(row('Valor antes de IVA (después de descuentos)', money(doc.totals.net)), row('IVA (no comisiona)', money(doc.totals.iva)));
    if (doc && c.base !== doc.totals.net) steps.push(row(c.status === 'bloqueada' ? 'Parte que no comisiona' : 'Parte que comisiona', money(c.base)));
    steps.push(row(`Tarifa${c.mode ? ` ${esc(c.mode)}` : ''}`, pct), row(`${money(c.base)} × ${pct}`, money(c.amount), true));
  } else if (c.type === 'cobro') {
    const pay = s.payments.find((p) => p.id === c.paymentId);
    const alloc = pay?.allocations.find((a) => a.id === c.allocationId);
    steps.push(row(`Abono ${esc(pay?.number || '')} aplicado a ${esc(doc?.number || '')}`, money(alloc?.amount ?? c.base)));
    if (c.ivaTreatment === 'recaudo_total') steps.push(row('Base: el dinero recibido (incluye IVA)', money(c.base)));
    else if (doc) {
      const eligible = doc.commission?.eligibleBase ?? doc.totals.net;
      steps.push(row('Total de la venta con IVA', money(doc.totals.total)), row(eligible !== doc.totals.net ? 'Parte elegible antes de IVA' : 'Valor antes de IVA', money(eligible)), row(`Base = abono × ${money(eligible)} ÷ ${money(doc.totals.total)}`, money(c.base)));
    }
    steps.push(row('Tarifa de cobro', pct), row(`${money(c.base)} × ${pct}`, money(c.amount), true));
  } else steps.push(row('Ajuste', money(c.amount), true));
  const notes = [];
  if (c.status === 'bloqueada') notes.push(c.pendingThreshold ? `<div class="notice info"><b>En espera.</b> ${esc(c.blockedReason || '')}</div>` : `<div class="notice warn"><b>No se paga.</b> ${esc(c.blockedReason || '')}</div>`);
  if (c.reversal) notes.push(`<div class="notice">Reversada: ${esc(c.reversal.reason)}</div>`);
  if (c.adjustmentReason) notes.push(`<div class="notice">${esc(c.adjustmentReason)}</div>`);
  if (c.type !== 'ajuste' && Math.abs(exact - c.amount) === 1) notes.push('<p class="muted small">Diferencia de $1 por redondeo: en abonos parciales el redondeo se hace sobre el acumulado de la venta, para que la suma de los abonos dé exacto.</p>');
  return { title: `${{ venta: 'Comisión por venta', cobro: 'Comisión por cobro', ajuste: 'Ajuste' }[c.type]} · ${esc(co)}`, body: `<div class="why-box">${steps.join('')}</div>${notes.join('')}<p class="muted small">Calculada el ${formatDate(c.operationAt)} con las reglas vigentes ese día (periodo ${periodLabel(c.period)}).</p>` };
}
