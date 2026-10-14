import { formatDate, formatDateTime, localDate, periodLabel, previousPeriod } from '../core/dates.js';
import { formatPct } from '../core/money.js';
import { commissionSummary, thresholdStatus } from '../domain/commissions.js';
import { COMMISSION_STATUSES } from '../domain/schema.js';
import { getState } from '../store/store.js';
import { empty, esc, money, pill, stat } from './dom.js';
import { thresholdCard } from './views-home.js';
import { ui } from './state.js';

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
        <li>Los primeros $70 M antes de IVA del mes no comisionan; desde ahí, todo lo que se vende sí.</li>
        <li>La venta que cruza el umbral comisiona solo el excedente (p. ej. de $69 M a $71 M → comisiona $1 M).</li>
        <li>El desbloqueo queda registrado con fecha y hora; no hay comisión retroactiva sobre lo vendido antes.</li>
        <li>Un cobro comisiona solo si la venta fue elegible (en la venta del cruce, solo su parte excedente) <b>y</b> el mes del recaudo también llegó a $70 M.</li>
        <li>Lo no elegible queda como "bloqueada" con su motivo (informativo, nunca se liquida).</li>
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
    ${lines.slice(0, 500).map((c) => `<tr class="${c.status}"><td>${c.status === 'generada' ? `<input type="checkbox" data-comm="${c.id}" aria-label="Seleccionar">` : ''}</td><td>${formatDate(c.operationAt)}</td><td>${typeLabel[c.type]}</td><td><a href="#/doc/${c.documentId}">${esc(docNum(c.documentId))}</a></td><td>${esc(client(c.clientId))}</td><td>${c.mode ? esc(c.mode) : '—'}</td><td>${money(c.base)}</td><td>${formatPct(c.rateBps)}</td><td><b>${money(c.amount)}</b></td><td>${pill(COMMISSION_STATUSES[c.status], { generada: 'info', liquidada: 'warn', pagada: 'ok', reversada: 'danger', bloqueada: '' }[c.status])}${c.blockedReason ? `<small class="block">${esc(c.blockedReason)}</small>` : ''}${c.reversal ? `<small class="block">${esc(c.reversal.reason)}</small>` : ''}${c.adjustmentReason ? `<small class="block">${esc(c.adjustmentReason)}</small>` : ''}</td></tr>`).join('')}
    </tbody></table></div><p class="muted small" data-selected-sum></p>` : empty('💰', 'Sin movimientos con estos filtros', co === 'puntazo' ? 'Las comisiones de El Puntazo se generan al registrar cobros.' : 'Las comisiones de Frutos del Nogal se generan con ventas y cobros elegibles.')}
  </section>
  <section class="panel"><h2>Liquidaciones</h2><p class="muted small">Liquidar agrupa comisiones pendientes para cobrarlas a la empresa. Solo cuando registres que te pagaron quedan como "pagadas".</p>
  ${settlements.length ? `<div class="table-wrap"><table><thead><tr><th>N.º</th><th>Fecha</th><th>Líneas</th><th>Total</th><th>Estado</th><th></th></tr></thead><tbody>${settlements.map((x) => `<tr><td>${esc(x.number)}</td><td>${formatDate(x.createdAt)}</td><td>${x.commissionIds.length}</td><td>${money(x.total)}</td><td>${pill({ liquidada: 'Liquidada · por pagar', pagada: `Pagada ${formatDate(x.paidAt)}`, anulada: 'Anulada' }[x.status], { liquidada: 'warn', pagada: 'ok', anulada: 'danger' }[x.status])}</td><td>${x.status === 'liquidada' ? `<button class="btn btn-primary btn-xs" data-act="settle-paid" data-id="${x.id}">Registrar pago recibido</button> <button class="btn btn-plain btn-xs" data-act="settle-cancel" data-id="${x.id}">Anular</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Aún no hay liquidaciones.</p>'}</section>`;
}
