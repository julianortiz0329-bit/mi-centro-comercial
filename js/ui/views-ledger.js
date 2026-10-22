// Pantallas del libro de socios: resumen del mes con el reparto, libro de
// movimientos, caja y bancos, cuenta de cada socio y "Más".
import { addDays, formatDate, formatDateTime, localDate, periodLabel, previousPeriod } from '../core/dates.js';
import { ACCOUNT_KINDS, accountBalances, CONTRIBUTION_KINDS, EXPENSE_CATEGORIES, ivaReport, journal, monthResult, partnerBalances, payablesSummary, WITHDRAWAL_KINDS } from '../domain/ledger.js';
import { PH_CHANNELS, phMonthSummary } from '../domain/pethome.js';
import { getState, sync } from '../store/store.js';
import { empty, esc, money, pill, stat } from './dom.js';
import { icon } from './icons.js';
import { heroDeco } from './motion.js';
import { ui } from './state.js';
import { phLogo } from './views-pethome.js';

const S = () => getState();
const L = () => S().ledger;
const socioName = (id) => S().socios.find((x) => x.id === id)?.nombre || 'Socio';
const accName = (id) => L().accounts.find((a) => a.id === id)?.name || 'Cuenta';
const payerName = (p) => (String(p).startsWith('socio:') ? `${socioName(p.slice(6))} (de su bolsillo)` : accName(p));
const signed = (v) => `<b class="${v < 0 ? 'danger' : ''}">${money(v)}</b>`;
const mon = (p) => periodLabel(p).split(' ')[0];

function head(eyebrow, title, action = '') {
  return `<div class="page-head ph-head"><div class="ph-title">${phLogo(46)}<div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1></div></div>${action}</div>`;
}

function monthNav(route, period) {
  const today = localDate().slice(0, 7);
  const prev = previousPeriod(period, 1);
  const next = previousPeriod(period, -1);
  return `<div class="month-nav"><a class="btn btn-plain btn-small" href="#/${route}?p=${prev}">‹ ${esc(periodLabel(prev))}</a>${period < today ? `<a class="btn btn-plain btn-small" href="#/${route}?p=${next}">${esc(periodLabel(next))} ›</a>` : ''}</div>`;
}

export function syncBadge() {
  const n = sync.pending;
  if (!sync.online) return `<span class="sync-badge off" title="${esc(sync.error)}">${icon('alert', { size: 14 })} Sin internet${n ? ` · ${n} por subir` : ''}</span>`;
  if (sync.error) return `<span class="sync-badge warn" title="${esc(sync.error)}">${icon('alert', { size: 14 })} No se pudo sincronizar</span>`;
  if (n) return `<span class="sync-badge">${icon('refresh', { size: 14 })} Subiendo ${n}…</span>`;
  return `<span class="sync-badge ok">${icon('check', { size: 14 })} Al día${sync.lastOk ? ` · ${new Date(sync.lastOk).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}` : ''}</span>`;
}

/* ---------------- Resumen ---------------- */
export function renderResumen(params) {
  const st = S().pethome;
  const today = localDate();
  const period = params.get('p') || today.slice(0, 7);
  if (!st.products.length && !st.sales.length && !L().expenses.length) {
    return `${head('Libro de socios', 'Alegría Pet Home')}
    <section class="panel ph-welcome"><h2>¡Bienvenido, ${esc(S().me.nombre)}!</h2><p>Este es el libro de Alegría que comparten los socios: lo que uno registra, el otro lo ve.</p>
    <ol class="ph-steps"><li><b>Carga los productos</b> de la tienda Shopify (77 productos con su precio).</li><li><b>Revisa las cuentas</b> (Efectivo, Nequi, Bancolombia) en Caja y pon su saldo inicial.</li><li><b>Registra</b> ventas, gastos y aportes con el botón <b>+</b>.</li></ol>
    <div class="row-gap"><button class="btn btn-primary" data-act="ph-load-catalog">${icon('package', { size: 18 })} Cargar productos de Shopify</button><a class="btn btn-plain" href="#/caja">Ver cuentas</a></div></section>`;
  }
  const r = monthResult(S(), period);
  const m = phMonthSummary(S(), period);
  const cash = accountBalances(S());
  const bal = partnerBalances(S());
  const follow = st.notes.filter((n) => n.followUp && !n.done && n.followUp <= addDays(today, 7)).sort((a, b) => a.followUp.localeCompare(b.followUp)).slice(0, 4);
  const pay = payablesSummary(S());
  const payAlert = pay.overdueCount || pay.soonCount ? `<a class="pay-alert ${pay.overdueCount ? 'late' : ''}" href="#/pagar">${icon('calendar', { size: 18 })}<span><b>${pay.overdueCount ? `${pay.overdueCount} factura(s) vencida(s) · ${money(pay.overdue)}` : `${pay.soonCount} factura(s) vencen esta semana · ${money(pay.week)}`}</b><small>Toca para ver las facturas por pagar y abonar</small></span>${icon('arrowRight', { size: 16 })}</a>` : '';
  const shares = S().socios.map((so) => `<span class="share-chip${so.id === S().me.id ? ' me' : ''}">${esc(so.nombre)} <b>${money(r.shares[so.id] || 0)}</b></span>`).join('');
  const cats = Object.entries(r.byCategory).sort((a, b) => b[1] - a[1]);
  return `${head(periodLabel(period), 'Alegría Pet Home', syncBadge())}
  ${monthNav('ph', period)}
  ${payAlert}
  <section class="hero ph-hero">${heroDeco()}<div class="hero-top"><div><div class="hero-label">${r.profit < 0 ? 'Pérdida' : 'Utilidad'} de ${esc(mon(period))}</div><div class="hero-amount" data-count="${r.profit}">${money(r.profit)}</div>
    <div class="hero-sub">Vendieron <b>${money(r.revenue)}</b> en ${r.salesCount} venta(s) · gastos <b>${money(r.expenses)}</b></div></div></div>
    <div class="hero-foot shares">${shares}</div>
    ${r.missingCostLines ? `<div class="hero-foot"><a class="hero-chip" href="#/ph-productos?f=sincosto">${icon('alert', { size: 14 })} ${r.missingCostLines} producto(s) vendido(s) sin costo: la utilidad sale más alta de lo real</a></div>` : ''}</section>
  <section class="panel pnl"><div class="panel-head"><h2>Estado de resultados</h2><button class="btn btn-plain btn-small" data-act="month-pdf" data-p="${period}">${icon('file', { size: 16 })} PDF del mes</button></div>
    <ul class="pnl-rows">
      <li><span>Ventas${st.profile.ivaResponsable ? ' sin IVA' : ''}${r.ivaSales ? ` <small class="muted">(IVA cobrado ${money(r.ivaSales)}, es de la DIAN)</small>` : ''}</span><b>${money(r.revenue)}</b></li>
      <li class="minus"><span>Costo de los productos vendidos${r.estimatedLines ? ` <small class="muted">(${r.estimatedLines} con costo actual)</small>` : ''}</span><b>− ${money(r.cogs)}</b></li>
      ${r.shippingCost ? `<li class="minus"><span>Domicilios pagados</span><b>− ${money(r.shippingCost)}</b></li>` : ''}
      <li class="sub"><span>Utilidad bruta</span>${signed(r.gross)}</li>
      ${cats.map(([k, v]) => `<li class="minus"><span>${esc(EXPENSE_CATEGORIES[k] || k)}</span><b>− ${money(v)}</b></li>`).join('') || '<li class="minus"><span>Gastos</span><b>− $ 0</b></li>'}
      <li class="total"><span>${r.profit < 0 ? 'Pérdida' : 'Utilidad'} del mes</span>${signed(r.profit)}</li>
      ${S().socios.map((so) => `<li class="share"><span>Le toca a ${esc(so.nombre)} (${Number(so.porcentaje)} %)</span>${signed(r.shares[so.id] || 0)}</li>`).join('')}
    </ul></section>
  ${st.profile.ivaResponsable ? ivaCard(period) : ''}
  <div class="stats">
    ${stat('Dinero en cuentas', money(cash.cash), `${L().accounts.length} cuenta(s)`)}
    ${stat('Les deben', money(cash.receivable), `${m.debtors.length} persona(s)`, cash.receivable ? 'warn' : '')}
    ${stat('Deben a proveedores', money(cash.payable), `<a href="#/pagar">${pay.count} factura(s)${pay.overdueCount ? ` · ${pay.overdueCount} vencida(s)` : ''}</a>`, pay.overdue ? 'warn' : '')}
    ${stat('Cobrado en el mes', money(m.collected), 'Pagos recibidos')}
  </div>
  <section class="panel"><div class="panel-head"><h2>Cuenta de los socios</h2><a class="btn btn-plain btn-small" href="#/socios">Ver detalle</a></div>
    <ul class="simple kv">${Object.values(bal).map((b) => `<li><span>${esc(b.socio.nombre)} <small class="muted">${b.balance >= 0 ? 'el negocio le debe' : 'debe al negocio'}</small></span>${signed(Math.abs(b.balance))}</li>`).join('')}</ul></section>
  <div class="two-col">
    <section class="panel"><h2>Lo más vendido del mes</h2>${m.products.length ? `<ol class="rank">${m.products.slice(0, 6).map((x) => `<li><span>${esc(x.name)} <small class="muted">× ${x.qty}</small></span><b>${money(x.revenue)}</b></li>`).join('')}</ol>` : '<p class="muted">Aún no hay ventas este mes.</p>'}
      ${Object.keys(m.byChannel).length ? `<h3>Por canal</h3><ul class="simple kv">${Object.entries(m.byChannel).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<li><span>${esc(PH_CHANNELS[k] || k)}</span><b>${money(v)}</b></li>`).join('')}</ul>` : ''}</section>
    <section class="panel"><h2>Últimos movimientos</h2>${journalRows(journal(S()).slice(0, 5)) || '<p class="muted small">Aún no hay gastos, aportes ni retiros.</p>'}
      <h3>Seguimientos con proveedores</h3>${follow.length ? `<ul class="simple">${follow.map((n) => `<li><a href="#/ph-proveedor/${n.supplierId}">${esc(st.suppliers.find((x) => x.id === n.supplierId)?.name || '')}</a><small>${formatDate(n.followUp)} · ${esc(n.summary.slice(0, 80))}</small></li>`).join('')}</ul>` : '<p class="muted small">Nada pendiente.</p>'}</section>
  </div>`;
}

/* ---------------- IVA ---------------- */
function ivaCard(period) {
  const v = ivaReport(S(), `${period}-15`);
  const label = `${v.kind === 'bimestral' ? 'Bimestre' : 'Cuatrimestre'} ${periodLabel(v.from.slice(0, 7)).split(' ')[0]} – ${periodLabel(v.to.slice(0, 7))}`;
  return `<section class="panel iva-card"><div class="panel-head"><h2>IVA del periodo</h2><small class="muted">${esc(label)}</small></div>
    <ul class="pnl-rows">
      <li><span>IVA cobrado en ventas${Object.keys(v.genByRate).length ? ` <small class="muted">(${Object.entries(v.genByRate).map(([r, x]) => `${r} %: ${money(x)}`).join(' · ')})</small>` : ''}</span><b>${money(v.generated)}</b></li>
      <li class="minus"><span>IVA pagado en compras a proveedores</span><b>− ${money(v.fromPurchases)}</b></li>
      <li class="minus"><span>IVA pagado en gastos</span><b>− ${money(v.fromExpenses)}</b></li>
      <li class="total"><span>${v.balance >= 0 ? 'IVA a pagar a la DIAN (estimado)' : 'Saldo a favor (estimado)'}</span><b class="iva-due">${money(Math.abs(v.balance))}</b></li>
    </ul>
    <small class="muted">Es un estimado con lo registrado en el libro; la declaración la hace el contador con las facturas.</small></section>`;
}

/* ---------------- Libro ---------------- */
const KIND_LABEL = { gasto: 'Gasto', aporte: 'Aporte', retiro: 'Retiro', traslado: 'Traslado' };
const KIND_ICON = { gasto: 'receipt', aporte: 'plus', retiro: 'cash', traslado: 'refresh' };

function journalRows(rows, { actions = false } = {}) {
  if (!rows.length) return '';
  return `<ul class="journal">${rows.map(({ kind, x }) => {
    const off = x.status === 'anulado';
    let title = '';
    let sub = '';
    let sign = -1;
    if (kind === 'gasto') {
      title = x.description;
      sub = `${EXPENSE_CATEGORIES[x.category] || ''} · pagó ${payerName(x.payer)}${x.ivaPct ? ` · incluye IVA ${x.ivaPct} %` : ''}`;
    } else if (kind === 'aporte') {
      title = `${CONTRIBUTION_KINDS[x.kind]} de ${socioName(x.socioId)}`;
      sub = `Entró a ${accName(x.accountId)}`;
      sign = 1;
    } else if (kind === 'retiro') {
      title = `${WITHDRAWAL_KINDS[x.kind]} · ${socioName(x.socioId)}`;
      sub = `Salió de ${accName(x.accountId)}`;
    } else {
      title = `De ${accName(x.from)} a ${accName(x.to)}`;
      sub = 'Traslado entre cuentas';
      sign = 0;
    }
    return `<li class="jr k-${kind}${off ? ' off' : ''}"><span class="jr-ico">${icon(KIND_ICON[kind], { size: 18 })}</span><span class="jr-main"><b>${esc(title)}</b><small>${esc(x.number)} · ${formatDate(x.date)} · ${esc(sub)}${x.createdBy ? ` · por ${esc(x.createdBy)}` : ''}${x.notes ? ` · ${esc(x.notes)}` : ''}</small>${off ? `<small class="danger">Anulado: ${esc(x.voided?.reason || '')}</small>` : ''}</span>
      <span class="jr-amt ${sign > 0 ? 'in' : sign < 0 ? 'out' : ''}">${sign > 0 ? '+' : sign < 0 ? '−' : ''} ${money(x.amount)}</span>
      ${actions && !off ? `<span class="jr-act">${x.receiptId ? `<button class="btn btn-plain btn-xs" data-act="see-receipt" data-id="${x.receiptId}">Soporte</button>` : ''}<button class="btn btn-plain btn-xs" data-act="void-move" data-kind="${kind}" data-id="${x.id}">Anular</button></span>` : ''}</li>`;
  }).join('')}</ul>`;
}

export function renderLibro(params) {
  const period = params.get('p') || localDate().slice(0, 7);
  const f = params.get('f') || 'todo';
  let rows = journal(S(), period);
  if (f !== 'todo') rows = rows.filter((r) => r.kind === f);
  const tabs = { todo: 'Todo', gasto: 'Gastos', aporte: 'Aportes', retiro: 'Retiros', traslado: 'Traslados' };
  const sum = (k) => journal(S(), period).filter((r) => r.kind === k && r.x.status !== 'anulado').reduce((a, r) => a + r.x.amount, 0);
  return `${head(periodLabel(period), 'Libro', '<button class="btn btn-primary" data-act="new-expense">＋ Gasto</button>')}
  ${monthNav('libro', period)}
  <div class="stats">${stat('Gastos', money(sum('gasto')))}${stat('Aportes', money(sum('aporte')))}${stat('Retiros', money(sum('retiro')))}</div>
  <div class="chips">${Object.entries(tabs).map(([k, l]) => `<a class="chip ${f === k ? 'active' : ''}" href="#/libro?p=${period}&f=${k}">${l}</a>`).join('')}</div>
  <div class="row-gap"><button class="btn btn-plain btn-small" data-act="new-contribution">＋ Aporte</button><button class="btn btn-plain btn-small" data-act="new-withdrawal">＋ Retiro</button><button class="btn btn-plain btn-small" data-act="new-transfer">＋ Traslado</button><button class="btn btn-plain btn-small" data-act="export-csv" data-p="${period}">${icon('download', { size: 16 })} Excel (CSV)</button></div>
  ${journalRows(rows, { actions: true }) || empty('🐾', 'Nada registrado en este mes', 'Los gastos, aportes y retiros aparecen aquí. Las ventas y compras están en Ventas y Proveedores.', '<button class="btn btn-primary" data-act="new-expense">＋ Registrar un gasto</button>')}`;
}

/* ---------------- Caja ---------------- */
const MOVE_LABEL = { cobro: 'Cobro', pago_compra: 'Pago a proveedor', gasto: 'Gasto', aporte: 'Aporte', retiro: 'Retiro', traslado: 'Traslado' };
export function renderCaja() {
  const c = accountBalances(S());
  const box = (v, name, extra = '') => `<details class="panel acc"><summary><span><b>${esc(name)}</b><small class="muted">${extra}</small></span>${signed(v.balance)}</summary>
    ${v.moves.length ? `<ul class="simple kv">${v.moves.slice(0, 40).map((m) => `<li><span>${m.ref ? `<a href="${m.ref}">${esc(m.text)}</a>` : esc(m.text)}<small>${formatDate(m.date)} · ${MOVE_LABEL[m.kind]}</small></span><b class="${m.amount < 0 ? 'danger' : 'ok-text'}">${m.amount < 0 ? '−' : '+'} ${money(Math.abs(m.amount))}</b></li>`).join('')}</ul>` : '<p class="muted small">Sin movimientos.</p>'}</details>`;
  return `${head('Caja y bancos', 'Caja', '<button class="btn btn-primary" data-act="new-transfer">＋ Traslado</button>')}
  <section class="hero ph-hero">${heroDeco()}<div class="hero-top"><div><div class="hero-label">Dinero del negocio hoy</div><div class="hero-amount" data-count="${c.cash}">${money(c.cash)}</div><div class="hero-sub">Les deben <b>${money(c.receivable)}</b> · deben a proveedores <b>${money(c.payable)}</b></div></div></div></section>
  <a class="pay-alert" href="#/pagar">${icon('calendar', { size: 18 })}<span><b>Facturas por pagar</b><small>Compras a crédito, vencimientos y abonos a proveedores</small></span>${icon('arrowRight', { size: 16 })}</a>
  <p class="muted small">Compara cada saldo con tu extracto de Nequi o del banco. Si no cuadra, revisa los movimientos o ajusta el saldo inicial de la cuenta.</p>
  ${Object.values(c.accounts).map((v) => box(v, v.account.name, `${ACCOUNT_KINDS[v.account.kind] || ''}${v.account.initial ? ` · saldo inicial ${money(v.account.initial)}` : ''} · <button class="link" data-act="edit-account" data-id="${v.account.id}">Editar</button>`)).join('')}
  ${c.unassigned.moves.length ? box(c.unassigned, 'Sin cuenta asignada', 'Pagos registrados con un medio que no corresponde a ninguna cuenta') : ''}
  <div class="row-gap"><button class="btn btn-plain" data-act="new-account">＋ Nueva cuenta</button></div>`;
}

/* ---------------- Socios ---------------- */
export function renderSocios() {
  const bal = partnerBalances(S());
  const months = [];
  for (let i = 0; i < 6; i++) months.push(previousPeriod(localDate().slice(0, 7), i));
  const res = months.map((p) => ({ p, r: monthResult(S(), p) }));
  return `${head('Libro de socios', 'Socios', '<button class="btn btn-primary" data-act="new-withdrawal">＋ Retiro</button>')}
  <p class="muted small">Cada socio tiene una cuenta: suma lo que aportó, lo que pagó de su bolsillo y su parte de la utilidad; resta lo que ha retirado. El saldo es lo que el negocio le debe.</p>
  <div class="cards socios">${Object.values(bal).map((b) => `<article class="card socio-card${b.socio.id === S().me.id ? ' me' : ''}">
    <div class="card-title">${esc(b.socio.nombre)} ${pill(`${Number(b.socio.porcentaje)} %`, 'info')}${b.socio.id === S().me.id ? ' <small class="muted">(tú)</small>' : ''}</div>
    <ul class="simple kv">
      <li><span>Aportes de capital</span><b>${money(b.contributed)}</b></li>
      ${b.loans ? `<li><span>Préstamos al negocio</span><b>${money(b.loans)}</b></li>` : ''}
      <li><span>Gastos que pagó de su bolsillo</span><b>${money(b.paidExpenses)}</b></li>
      <li><span>Su parte de la utilidad (acumulada)</span>${signed(b.profit)}</li>
      <li><span>Retirado</span><b>− ${money(b.withdrawn)}</b></li>
      <li class="total"><span>${b.balance >= 0 ? 'El negocio le debe' : 'Le debe al negocio'}</span>${signed(Math.abs(b.balance))}</li>
    </ul>
    <div class="card-actions"><button class="btn btn-plain btn-xs" data-act="new-contribution" data-socio="${b.socio.id}">Aporte</button><button class="btn btn-plain btn-xs" data-act="new-withdrawal" data-socio="${b.socio.id}" data-amount="${Math.max(0, b.balance)}">Retiro</button></div>
  </article>`).join('')}</div>
  <section class="panel"><h2>Reparto por mes</h2><div class="table-wrap"><table><thead><tr><th>Mes</th><th>Ventas</th><th>Utilidad</th>${S().socios.map((so) => `<th>${esc(so.nombre)}</th>`).join('')}</tr></thead><tbody>
    ${res.map(({ p, r }) => `<tr><td><a href="#/ph?p=${p}">${esc(periodLabel(p))}</a></td><td>${money(r.revenue)}</td><td>${signed(r.profit)}</td>${S().socios.map((so) => `<td>${signed(r.shares[so.id] || 0)}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div></section>`;
}

/* ---------------- Más ---------------- */
export function renderMas() {
  const me = S().me;
  const tile = (href, ic, label, sub) => `<a class="quick-tile wide" href="${href}">${icon(ic, { size: 22 })}<span><b>${label}</b><small>${sub}</small></span></a>`;
  return `${head('Alegría Pet Home', 'Más')}
  <div class="tiles">
    ${tile('#/ph-productos', 'package', 'Productos y márgenes', 'Costos, precios y margen')}
    ${tile('#/pagar', 'calendar', 'Facturas por pagar', 'Compras a crédito, vencimientos y abonos')}
    ${tile('#/ph-proveedores', 'users', 'Proveedores', 'Términos, compras y conversaciones')}
    ${tile('#/ph-perfil', 'file', 'Datos para cobrar', 'Logo, titular del RUT y cómo les pagan')}
  </div>
  <section class="panel"><h2>Tu sesión</h2><p>Entraste como <b>${esc(me.nombre)}</b>. ${syncBadge()}</p>
    <form class="row-gap" data-form="rename"><input name="nombre" value="${esc(me.nombre)}" aria-label="Tu nombre" maxlength="60"><button class="btn btn-plain btn-small" type="submit">Cambiar mi nombre</button></form>
    <div class="row-gap"><button class="btn btn-plain btn-small" data-act="sync-now">${icon('refresh', { size: 16 })} Sincronizar ahora</button><button class="btn btn-plain btn-small" data-act="logout">Cerrar sesión en este celular</button></div>
    <p class="muted small">Tu clave es personal: no la compartas. Si se pierde o alguien más la tiene, pide que la cambien.</p></section>
  <section class="panel"><h2>Apariencia</h2><div class="segm" role="group" aria-label="Tema">${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) => `<button type="button" role="radio" data-act="set-theme" data-v="${v}" aria-checked="${ui.theme === v}">${l}</button>`).join('')}</div>
    <label class="switch-row"><input type="checkbox" data-pref="privacy" ${ui.privacy ? 'checked' : ''}> Ocultar montos (modo discreto)</label>
    <label class="switch-row"><input type="checkbox" data-pref="haptics" ${ui.haptics ? 'checked' : ''}> Vibrar al guardar</label>
    <label class="switch-row"><input type="checkbox" data-pref="sound" ${ui.sound ? 'checked' : ''}> Sonidos</label></section>
  <p class="muted small center">Libro de Alegría · versión ${esc(globalThis.ALEGRIA_VERSION || '')}${S().pethome.catalogLoadedAt ? ` · catálogo cargado ${formatDateTime(S().pethome.catalogLoadedAt)}` : ''}</p>`;
}
