import { diffDays, formatDate, formatDateTime, periodLabel, periodOf } from '../core/dates.js';
import { buildAgenda } from '../domain/agenda.js';
import { completeTask, dismissAgendaItem, resolvePromise } from '../domain/activities.js';
import { dashboard, scopeCompanies, topClients } from '../domain/metrics.js';
import { thresholdProjection } from '../domain/commissions.js';
import { localDate } from '../core/dates.js';
import { icon } from './icons.js';
import { inactiveClients } from '../domain/clients.js';
import { getState } from '../store/store.js';
import { confirmDialog, empty, esc, exec, money, pill, progress, stat } from './dom.js';
import { HOME_SECTIONS, ui } from './state.js';
import { alegriaCard } from './alegria-link.js';
import { isActiveSale } from '../domain/ledger.js';
import { lastOrderFor } from '../domain/pricing.js';
import { userAvatar } from './personalize.js';
import { heroDeco } from './motion.js';

const S = () => getState();
const coName = (id) => (id ? S().companies[id]?.name : 'General');

function projectionBlock(t) {
  const p = thresholdProjection(getState(), 'nogal', t.period, localDate());
  if (!p?.current) return '';
  if (p.unlocked) return `<div class="proj ok">🚀 Umbral superado. Todo lo que vendas este mes comisiona.</div>`;
  if (!p.cumulative) return `<div class="proj">📈 Aún no hay ventas este mes. Para llegar a ${money(p.threshold)} necesitas en promedio <b>${money(Math.ceil(p.threshold / p.daysInMonth))}</b> por día.</div>`;
  return `<div class="proj ${p.reachDate ? 'ok' : 'warn'}">📈 Ritmo actual: <b>${money(p.pace)}</b> por día (día ${p.day} de ${p.daysInMonth}).<br>${p.reachDate ? `A este ritmo llegas a los $70 M el <b>${formatDate(p.reachDate)}</b>.` : `A este ritmo cierras el mes en <b>${money(p.projected)}</b>: no alcanzarías.`}${p.neededPerDay ? ` Para llegar necesitas <b>${money(p.neededPerDay)}</b> por día en los ${p.remainingDays} días que quedan.` : ''}</div>`;
}

export function thresholdCard(t, { compact = false } = {}) {
  if (!t) return '';
  return `<section class="panel threshold ${t.unlocked ? 'unlocked' : 'locked'}">
    <div class="panel-head"><div><h2>🌰 Umbral mensual · Frutos del Nogal</h2><p class="muted">${periodLabel(t.period)} · base: ${t.thresholdBase === 'total' ? 'total con IVA' : 'ventas antes de IVA'}</p></div>${pill(t.unlocked ? 'Desbloqueado' : 'Bloqueado', t.unlocked ? 'ok' : 'warn')}</div>
    <div class="th-row"><div><small>Ventas acumuladas</small><b>${money(t.cumulative)}</b></div><div><small>Umbral</small><b>${money(t.threshold)}</b></div><div><small>Falta</small><b>${money(t.missing)}</b></div><div><small>Avance</small><b>${t.pct.toFixed(1)} %</b></div></div>
    ${progress(t.pct, t.unlocked ? 'ok' : '')}
    ${t.unlocked ? `<p class="muted small">Desbloqueado el ${formatDateTime(t.unlock.unlockedAt)} con ${esc(t.unlock.triggerNumber)} (de esa venta solo comisiona lo que supera el umbral).</p>` : '<p class="muted small">Las comisiones del mes están bloqueadas hasta alcanzar el umbral. No se calculan comisiones retroactivas.</p>'}
    ${paceChart(t)}
    ${projectionBlock(t)}
    ${t.belowAfterVoids ? '<div class="notice warn">Tras anulaciones el acumulado quedó por debajo del umbral. El desbloqueo registrado se mantiene; revisa antes de liquidar.</div>' : ''}
    ${compact ? '' : `<div class="th-row"><div><small>Ventas elegibles</small><b>${money(t.eligibleSalesNet)}</b><small>${t.eligibleSalesCount} venta(s)</small></div><div><small>Comisión por venta</small><b>${money(t.saleCommission)}</b></div><div><small>Comisión por cobro</small><b>${money(t.collectionCommission)}</b></div><div><small>Bloqueadas (informativo)</small><b>${money(t.blocked)}</b></div></div>
    <div class="th-row"><div><small>Pendientes</small><b>${money(t.pending)}</b></div><div><small>Liquidadas</small><b>${money(t.settled)}</b></div><div><small>Pagadas</small><b>${money(t.paid)}</b></div><div><small>Reversadas</small><b>${money(t.reversed)}</b></div></div>
    <p class="muted small">Por modalidad: mayorista ${money(t.byMode.mayorista || 0)} · normal ${money(t.byMode.normal || 0)}</p>`}
  </section>`;
}

export function agendaList(items, limit = 50) {
  if (!items.length) return empty('🌿', 'Nada pendiente en esta vista', 'Programa tareas o fechas de seguimiento y aquí verás cobros, promesas, despachos y visitas.', '<button class="btn btn-primary" data-act="new-task">＋ Programar tarea</button>');
  const label = (it) => (it.days < 0 ? `Vencido hace ${-it.days} día(s)` : it.days === 0 ? 'Hoy' : it.days === 1 ? 'Mañana' : `En ${it.days} días`);
  return `<ul class="agenda">${items.slice(0, limit).map((it) => `<li class="agenda-item ${it.days < 0 ? 'late' : it.days === 0 ? 'today' : ''}">
    <span class="ag-icon" aria-hidden="true">${it.icon}</span>
    <div class="ag-main"><a href="${it.documentId ? `#/doc/${it.documentId}` : it.clientId ? `#/cliente/${it.clientId}` : '#/agenda'}" class="ag-title">${esc(it.title)}</a>
      <div class="ag-meta">${esc(label(it))} · ${formatDate(it.date)}${it.companyId ? ` · ${esc(coName(it.companyId))}` : ''}${it.amount ? ` · <b>${money(it.amount)}</b>` : ''}</div>
      ${it.detail ? `<div class="ag-meta">${esc(it.detail)}</div>` : ''}
      <div class="ag-actions">
        ${it.type === 'cobro' ? `<button class="btn btn-primary btn-xs" data-act="pay" data-doc="${it.documentId}">Registrar cobro</button><button class="btn btn-plain btn-xs" data-act="activity" data-client="${it.clientId}" data-doc="${it.documentId}">Gestión</button><button class="btn btn-wa btn-xs" data-act="wa" data-client="${it.clientId}" data-doc="${it.documentId}" data-tpl="recordatorio">WhatsApp</button>` : ''}
        ${it.type === 'promesa' ? `<button class="btn btn-primary btn-xs" data-act="pay" data-doc="${it.documentId || ''}" data-client="${it.clientId}">Registrar pago</button><button class="btn btn-plain btn-xs" data-act="promise-broken" data-id="${it.activityId}">Incumplida</button><button class="btn btn-wa btn-xs" data-act="wa" data-client="${it.clientId}" data-doc="${it.documentId || ''}" data-tpl="promesa" data-activity="${it.activityId}">WhatsApp</button>` : ''}
        ${it.type === 'despacho' ? `<button class="btn btn-primary btn-xs" data-act="dispatch" data-doc="${it.documentId}">Registrar despacho</button>` : ''}
        ${it.nextAction ? `<button class="btn btn-plain btn-xs" data-act="activity" data-client="${it.clientId}" data-doc="${it.documentId || ''}">Registrar resultado</button>` : ''}
        ${it.taskId ? `<button class="btn btn-plain btn-xs" data-act="task-done" data-id="${it.taskId}">Hecha</button>` : ''}
        ${it.key ? `<button class="btn btn-plain btn-xs" data-act="dismiss" data-key="${esc(it.key)}" title="Ocultar este recordatorio">Atendido</button>` : ''}
        ${it.clientId && it.type !== 'cobro' && it.type !== 'promesa' ? `<button class="btn btn-wa btn-xs" data-act="wa" data-client="${it.clientId}" data-doc="${it.documentId || ''}">WhatsApp</button>` : ''}
      </div></div></li>`).join('')}</ul>${items.length > limit ? `<p class="muted small">Mostrando ${limit} de ${items.length}. <a href="#/agenda">Ver agenda completa</a></p>` : ''}`;
}

export async function handleAgendaAction(act, el) {
  if (act === 'task-done') {
    const result = await confirmDialog({ title: 'Completar tarea', message: '¿Cuál fue el resultado?', reason: true, reasonLabel: 'Resultado', confirmText: 'Marcar hecha' });
    if (result) await exec(completeTask, { taskId: el.dataset.id, result }, { success: 'Tarea completada' });
    return true;
  }
  if (act === 'dismiss') {
    await exec(dismissAgendaItem, { key: el.dataset.key }, { success: 'Recordatorio atendido' });
    return true;
  }
  if (act === 'promise-broken') {
    const reason = await confirmDialog({ title: 'Promesa incumplida', message: 'Registra el motivo del incumplimiento. Luego puedes acordar una nueva fecha con "Gestión".', reason: true, reasonLabel: 'Motivo', confirmText: 'Registrar' });
    if (reason) await exec(resolvePromise, { activityId: el.dataset.id, status: 'incumplida', reason }, { success: 'Promesa marcada como incumplida' });
    return true;
  }
  return false;
}

/** Gráfica del mes: ventas acumuladas día a día contra el ritmo necesario. */
export function paceChart(t) {
  const s = S();
  const today = localDate();
  if (!t || t.period !== today.slice(0, 7)) return '';
  const rules = s.rules.nogal;
  const [y, m] = t.period.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const day = Number(today.slice(8, 10));
  const byDay = new Array(days + 1).fill(0);
  for (const d of s.documents) {
    if (!isActiveSale(d) || d.companyId !== 'nogal' || periodOf(d.date) !== t.period) continue;
    byDay[Number(d.date.slice(8, 10))] += rules.thresholdBase === 'total' ? d.totals.total : d.totals.net;
  }
  const pts = [[0, 0]];
  let acc = 0;
  for (let i = 1; i <= day; i++) pts.push([i, (acc += byDay[i])]);
  const W = 320;
  const H = 132;
  const pad = { l: 6, r: 8, t: 14, b: 18 };
  const maxY = Math.max(t.threshold * 1.08, acc * 1.05);
  const X = (dd) => pad.l + (dd / days) * (W - pad.l - pad.r);
  const Yc = (v) => H - pad.b - (v / maxY) * (H - pad.t - pad.b);
  const line = pts.map(([a, b]) => `${X(a).toFixed(1)},${Yc(b).toFixed(1)}`).join(' ');
  const area = `${X(0)},${Yc(0)} ${line} ${X(day).toFixed(1)},${Yc(0)}`;
  const ideal = (t.threshold * day) / days;
  const ahead = acc >= ideal;
  const diffPct = ideal ? Math.round(((acc - ideal) / ideal) * 100) : 0;
  const tone = t.unlocked || ahead ? 'ok' : 'warn';
  const ticks = [1, 8, 15, 22, days].map((dd) => `<text x="${X(dd).toFixed(1)}" y="${H - 4}" text-anchor="middle">${dd}</text>`).join('');
  return `<figure class="pace ${tone}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ventas acumuladas del mes frente al ritmo necesario para llegar al umbral">
      <line class="p-goal" x1="${X(0)}" y1="${Yc(t.threshold).toFixed(1)}" x2="${X(days)}" y2="${Yc(t.threshold).toFixed(1)}"/>
      <text class="p-goal-l" x="${X(days) - 2}" y="${(Yc(t.threshold) - 4).toFixed(1)}" text-anchor="end">Umbral ${money(t.threshold).replace(/\s/g, ' ')}</text>
      <line class="p-ideal" x1="${X(0)}" y1="${Yc(0)}" x2="${X(days)}" y2="${Yc(t.threshold).toFixed(1)}"/>
      <polygon class="p-area" points="${area}"/>
      <polyline class="p-line" pathLength="1" points="${line}"/>
      <circle class="p-dot" cx="${X(day).toFixed(1)}" cy="${Yc(acc).toFixed(1)}" r="4.5"/>
      <g class="p-ticks">${ticks}</g>
    </svg>
    <figcaption><span class="lg"><i class="lg-real"></i>Tus ventas</span><span class="lg"><i class="lg-ideal"></i>Ritmo para llegar</span><b>${t.unlocked ? 'Umbral superado' : ahead ? `Vas ${diffPct} % por encima del ritmo` : `Vas ${Math.abs(diffPct)} % por debajo del ritmo`}</b></figcaption>
  </figure>`;
}

/** Tarjetas de acción: lo que conviene hacer hoy, con botones directos. */
function actionCards(s, agenda, d, cos) {
  const cards = [];
  const name = (id) => s.clients.find((c) => c.id === id)?.tradeName || 'Cliente';
  const today = localDate();
  const late = agenda.filter((x) => x.type === 'cobro' && x.days < 0).sort((a, b) => b.amount - a.amount);
  for (const x of late.slice(0, 3)) cards.push({ tone: 'red', ic: 'wallet', kicker: 'Cobro vencido', title: `Cóbrale a ${name(x.clientId)}`, text: `<b>${money(x.amount)}</b> · vencida hace ${-x.days} día${-x.days === 1 ? '' : 's'}`, actions: `<button class="btn btn-wa btn-xs" data-act="wa" data-client="${x.clientId}" data-doc="${x.documentId}" data-tpl="recordatorio">WhatsApp</button><button class="btn btn-primary btn-xs" data-act="pay" data-doc="${x.documentId}">Registrar cobro</button>` });
  if (late.length > 3) cards.push({ tone: 'red', ic: 'alert', kicker: 'Cartera', title: `${late.length - 3} cobro(s) vencido(s) más`, text: `Total vencido: <b>${money(d.total.overdue)}</b>`, actions: '<a class="btn btn-plain btn-xs" href="#/cartera">Ver cartera</a>' });
  for (const x of agenda.filter((a) => a.type === 'promesa' && a.days <= 0).slice(0, 2)) cards.push({ tone: 'amber', ic: 'calendar', kicker: x.days < 0 ? 'Promesa incumplida' : 'Promesa para hoy', title: `${name(x.clientId)} prometió pagar`, text: `<b>${money(x.amount)}</b> · ${x.days < 0 ? `debía pagar hace ${-x.days} día(s)` : 'hoy'}`, actions: `<button class="btn btn-primary btn-xs" data-act="pay" data-client="${x.clientId}" data-doc="${x.documentId || ''}">Registrar pago</button><button class="btn btn-wa btn-xs" data-act="wa" data-client="${x.clientId}" data-doc="${x.documentId || ''}" data-tpl="promesa" data-activity="${x.activityId}">WhatsApp</button>` });
  if (cos.includes('nogal')) {
    const p = thresholdProjection(s, 'nogal', today.slice(0, 7), today);
    if (p?.current && p.unlocked) cards.push({ tone: 'gold', ic: 'sparkles', kicker: 'Frutos del Nogal', title: 'Umbral superado', text: 'Desde ya, todo lo que vendas este mes comisiona. ¡A cerrar pedidos!', actions: '<button class="btn btn-gold btn-xs" data-act="new-doc" data-kind="cotizacion">Cotizar</button><button class="btn btn-plain btn-xs" data-act="new-doc" data-kind="pedido">Nuevo pedido</button>' });
    else if (p?.current) cards.push({ tone: p.reachDate ? 'green' : 'amber', ic: 'trend', kicker: 'Frutos del Nogal', title: `Te faltan ${money(p.missing)} para los $70 M`, text: p.cumulative ? `Vas a <b>${money(p.pace)}</b>/día${p.neededPerDay ? `; necesitas <b>${money(p.neededPerDay)}</b>/día` : ''}.` : `Necesitas en promedio <b>${money(Math.ceil(p.threshold / p.daysInMonth))}</b> por día.`, actions: '<button class="btn btn-primary btn-xs" data-act="new-doc" data-kind="cotizacion">Cotizar</button><a class="btn btn-plain btn-xs" href="#/comisiones?co=nogal">Ver detalle</a>' });
  }
  for (const x of agenda.filter((a) => a.type === 'despacho' && a.days <= 0).slice(0, 2)) cards.push({ tone: 'blue', ic: 'package', kicker: 'Despacho', title: x.title, text: x.days < 0 ? `Pendiente hace ${-x.days} día(s)` : 'Para hoy', actions: `<button class="btn btn-primary btn-xs" data-act="dispatch" data-doc="${x.documentId}">Registrar despacho</button>` });
  const inact = inactiveClients(s, { companyId: ui.scope === 'todas' ? null : ui.scope }).filter((x) => x.daysNoPurchase !== null).slice(0, 2);
  for (const x of inact) {
    const lo = cos.map((co) => lastOrderFor(s, { clientId: x.client.id, companyId: co })).filter(Boolean)[0];
    cards.push({ tone: 'violet', ic: 'repeat', kicker: 'Recuperar cliente', title: `${x.client.tradeName} no te compra`, text: `Hace <b>${x.daysNoPurchase} días</b>${lo ? ` · último pedido ${money(lo.totals.total)}` : ''}`, actions: `${lo ? `<button class="btn btn-primary btn-xs" data-act="repeat" data-doc="${lo.id}">Repetir pedido</button>` : ''}<button class="btn btn-wa btn-xs" data-act="wa" data-client="${x.client.id}" data-tpl="recuperacion">WhatsApp</button>` });
  }
  const lastB = s.settings.lastBackupAt;
  if ((s.clients.length || s.documents.length) && (!lastB || diffDays(lastB.slice(0, 10), today) > 7)) cards.push({ tone: 'gray', ic: 'lock', kicker: 'Tus datos', title: 'Haz tu copia de seguridad', text: lastB ? `La última fue hace ${diffDays(lastB.slice(0, 10), today)} días.` : 'Aún no tienes ninguna. Toma 5 segundos.', actions: '<button class="btn btn-plain btn-xs" data-act="backup">Descargar copia</button>' });
  if (!cards.length) cards.push({ tone: 'green', ic: 'check', kicker: 'Todo en orden', title: 'Estás al día', text: 'No hay cobros vencidos ni pendientes urgentes. Buen momento para visitar o cotizar.', actions: '<button class="btn btn-primary btn-xs" data-act="new-doc" data-kind="cotizacion">Cotizar</button>' });
  return `<section class="actions-today" aria-label="Lo importante hoy"><div class="at-head"><h2>Lo importante hoy</h2><span class="at-count">${cards.length}</span></div>
    <div class="acards">${cards.map((c) => `<article class="acard t-${c.tone}"><div class="ac-top"><span class="ac-ico">${icon(c.ic, { size: 18 })}</span><small>${esc(c.kicker)}</small></div><h3>${esc(c.title)}</h3><p>${c.text}</p><div class="ac-actions">${c.actions}</div></article>`).join('')}</div></section>`;
}

function greeting(s, agenda) {
  const h = new Date().getHours();
  const hello = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const first = (s.settings.sellerName || '').trim().split(/\s+/)[0];
  const today = agenda.filter((x) => x.days <= 0);
  const n = (t) => today.filter((x) => x.type === t).length;
  const parts = [];
  if (n('cobro')) parts.push(`${n('cobro')} cobro${n('cobro') > 1 ? 's' : ''}`);
  if (n('promesa')) parts.push(`${n('promesa')} promesa${n('promesa') > 1 ? 's' : ''} de pago`);
  if (n('visita')) parts.push(`${n('visita')} visita${n('visita') > 1 ? 's' : ''}`);
  const rest = today.length - n('cobro') - n('promesa') - n('visita');
  if (rest > 0) parts.push(`${rest} pendiente${rest > 1 ? 's' : ''} más`);
  const line = parts.length ? `Hoy tienes ${parts.length > 1 ? parts.slice(0, -1).join(', ') + ' y ' + parts.at(-1) : parts[0]}.` : 'Tu agenda de hoy está al día. Buen momento para vender.';
  return `<div class="page-head greet"><a class="greet-avatar" href="#/personalizar" aria-label="Personalizar">${userAvatar(52)}</a><div class="greet-txt"><p class="eyebrow">${esc(periodLabel(localDate().slice(0, 7)))} · ${ui.scope === 'todas' ? 'Consolidado' : esc(s.companies[ui.scope].name)}</p><h1>${hello}${first ? `, ${esc(first)}` : ''}</h1><p>${line}${first ? '' : ' <button class="name-link" data-act="set-name">¿Cómo te llamas?</button>'}</p></div></div>`;
}

/** Tarjeta destacada: comisión del mes y avance (umbral o meta). */
function hero(s, d, cos) {
  const generated = d.total.commissionPeriod;
  const pending = d.total.commissionPending;
  let pct = null;
  let ringTop = '';
  let ringBottom = '';
  let chip = '';
  const nogal = cos.includes('nogal') ? d.per.nogal.threshold : null;
  if (nogal) {
    pct = nogal.pct;
    ringTop = `${Math.floor(pct)}%`;
    ringBottom = 'de $70 M';
    chip = nogal.unlocked ? `${icon('sparkles', { size: 14 })} Umbral superado` : `${icon('trend', { size: 14 })} Faltan ${money(nogal.missing)}`;
  } else {
    const co = cos[0];
    const g = d.per[co].goal.sales;
    if (g) {
      pct = Math.min(100, (d.per[co].salesNet / g) * 100);
      ringTop = `${Math.floor(pct)}%`;
      ringBottom = 'de la meta';
      chip = pct >= 100 ? `${icon('sparkles', { size: 14 })} Meta cumplida` : `${icon('trend', { size: 14 })} Faltan ${money(Math.max(0, g - d.per[co].salesNet))}`;
    }
  }
  const R = 46;
  const L = Math.round(2 * Math.PI * R * 100) / 100;
  const ring = pct === null ? '' : `<div class="ring" aria-label="Avance ${Math.floor(pct)} %"><svg width="108" height="108" viewBox="0 0 108 108"><defs><linearGradient id="ringGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--hero-accent-2)"/><stop offset="1" style="stop-color:var(--hero-accent)"/></linearGradient></defs><circle class="track" cx="54" cy="54" r="${R}" fill="none" stroke-width="9"/><circle class="bar" cx="54" cy="54" r="${R}" fill="none" stroke-width="9" stroke-linecap="round" stroke-dasharray="${L}" style="stroke-dashoffset:${L}" data-ring="${pct}"/></svg><div class="ring-txt"><div><b>${ringTop}</b><small>${ringBottom}</small></div></div></div>`;
  return `<section class="hero" aria-label="Resumen de comisiones">${heroDeco()}<div class="hero-top"><div><div class="hero-label">Comisión de ${esc(periodLabel(d.period).split(' ')[0])}</div><div class="hero-amount" data-count="${generated}">${money(generated)}</div><div class="hero-sub">Pendiente de liquidar <b>${money(pending)}</b> · Vendido antes de IVA <b>${money(d.total.salesNet)}</b></div></div>${ring}</div>${chip ? `<div class="hero-foot"><span class="hero-chip">${chip}</span></div>` : ''}</section>`;
}

export function renderHome() {
  const s = S();
  const d = dashboard(s, ui.scope);
  const cos = scopeCompanies(ui.scope);
  const agenda = buildAgenda(s, ui.scope);
  const urgent = agenda.filter((x) => x.days <= 0);
  const alerts = [];
  if (s.meta.migratedFrom === 'v1' && !s.settings.migrationSeen) alerts.push(`<div class="notice info">📦 Tus datos de la versión anterior se migraron (${s.meta.migrationReport?.clients || 0} clientes, ${s.meta.migrationReport?.orders || 0} pedidos, ${s.meta.migrationReport?.payments || 0} abonos). <a href="#/datos">Ver informe de migración</a></div>`);
  if (cos.includes('nogal') && !s.settings.policy?.nogal?.confirmed && s.commissions.some((c) => c.companyId === 'nogal' && c.status === 'generada')) alerts.push('<div class="notice warn">⚖️ Hay comisiones de Frutos del Nogal pendientes. Confirma la política de cálculo antes de liquidarlas. <a href="#/comisiones?co=nogal">Revisar</a></div>');
  if (d.total.unapplied > 0) alerts.push(`<div class="notice info">💵 Tienes ${money(d.total.unapplied)} en pagos sin aplicar a ninguna cuenta. <a href="#/cartera?tab=sinaplicar">Aplicarlos</a></div>`);

  const goalCards = cos.map((co) => {
    const p = d.per[co];
    const g = p.goal;
    const pctS = g.sales ? (p.salesNet / g.sales) * 100 : 0;
    const pctC = g.collection ? (p.collected / g.collection) * 100 : 0;
    return `<article class="goal-card"><h3>${s.companies[co].icon} ${esc(s.companies[co].name)}</h3>
      <div class="goal-line"><span>Ventas del mes (antes de IVA)</span><b>${money(p.salesNet)}</b></div>${g.sales ? `${progress(pctS, pctS >= 100 ? 'ok' : '')}<small class="muted">Meta ${money(g.sales)} · ${pctS.toFixed(0)} %</small>` : '<small class="muted">Sin meta de ventas · <a href="#/metas">definir</a></small>'}
      <div class="goal-line"><span>Recaudado del mes</span><b>${money(p.collected)}</b></div>${g.collection ? `${progress(pctC, pctC >= 100 ? 'ok' : '')}<small class="muted">Meta ${money(g.collection)} · ${pctC.toFixed(0)} %</small>` : '<small class="muted">Sin meta de recaudo</small>'}
    </article>`;
  }).join('');

  const tops = topClients(s, ui.scope, 5);
  const inact = inactiveClients(s, { companyId: ui.scope === 'todas' ? null : ui.scope }).slice(0, 5);
  const sections = {
    acciones: () => actionCards(s, agenda, d, cos),
    hero: () => hero(s, d, cos),
    alegria: () => alegriaCard(),
    accesos: () => `<div class="quick-tiles"><button class="quick-tile" data-act="quick-log">${icon('zap')}Registro rápido</button><button class="quick-tile" data-act="new-doc" data-kind="pedido">${icon('clipboard')}Pedido</button><button class="quick-tile" data-act="pay">${icon('cash')}Cobro</button><button class="quick-tile" data-act="search">${icon('search')}Buscar</button></div>`,
    indicadores: () => `<div class="stats">
    ${stat('Vendido este mes (antes de IVA)', money(d.total.salesNet), `Con IVA: ${money(d.total.salesTotal)}`)}
    ${stat('Recaudado este mes', money(d.total.collected), 'Pagos recibidos')}
    ${stat('Cartera por cobrar', money(d.total.receivable), `<a href="#/cartera">Ver cartera</a>`)}
    ${stat('Cartera vencida', money(d.total.overdue), `${d.total.overdueClients} cliente(s) atrasado(s)`, d.total.overdue ? 'warn' : '')}
    ${stat('Pedidos pendientes', String(d.total.pendingOrders), `${d.total.pendingDispatch} por despachar`)}
    ${stat('Comisiones pendientes', money(d.total.commissionPending), `Pagadas: ${money(d.total.commissionPaid)}`)}
  </div>`,
    umbral: () => (cos.includes('nogal') ? thresholdCard(d.per.nogal.threshold, { compact: true }) : ''),
    agenda: () => `<section class="panel"><div class="panel-head"><div><h2>Agenda de hoy</h2><p class="muted">${urgent.length} vencida(s) o para hoy · ${agenda.length} en los próximos 7 días</p></div><a class="btn btn-plain btn-small" href="#/agenda">Ver todo</a></div>${agendaList(agenda, 8)}</section>`,
    metas: () => `<section class="panel"><div class="panel-head"><h2>Metas del mes</h2><a class="btn btn-plain btn-small" href="#/metas">Configurar</a></div><div class="goal-grid">${goalCards}</div></section>`,
    clientes: () => `<div class="two-col">
    <section class="panel"><div class="panel-head"><h2>Clientes más importantes</h2><small class="muted">Ventas últimos 12 meses</small></div>${tops.length ? `<ol class="rank">${tops.map((t) => `<li><a href="#/cliente/${t.clientId}">${esc(s.clients.find((c) => c.id === t.clientId)?.tradeName)}</a><b>${money(t.total)}</b></li>`).join('')}</ol>` : '<p class="muted">Aún no hay ventas registradas.</p>'}</section>
    <section class="panel"><div class="panel-head"><h2>Necesitan seguimiento</h2><a class="btn btn-plain btn-small" href="#/clientes?tab=oportunidades">Ver todos</a></div>${inact.length ? `<ul class="simple">${inact.map((x) => `<li><a href="#/cliente/${x.client.id}">${esc(x.client.tradeName)}</a><small>${esc(x.reasons.join(' · '))}</small></li>`).join('')}</ul>` : '<p class="muted">Todos tus clientes tienen actividad reciente.</p>'}</section>
  </div>`,
  };
  const body = ui.homeOrder.filter((k) => HOME_SECTIONS[k] && !ui.homeHidden.includes(k)).map((k) => sections[k]()).join('');
  return `${greeting(s, agenda)}${alerts.join('')}${body}<p class="home-foot"><a href="#/personalizar">${icon('palette', { size: 15 })} Personalizar inicio</a></p>`;
}

export function renderAgenda(params) {
  const s = S();
  const f = params.get('f') || 'todo';
  const all = buildAgenda(s, ui.scope, { horizonDays: 30 });
  const filters = { todo: 'Todo', vencidos: 'Vencidos', hoy: 'Hoy', proximos: 'Próximos', cobro: 'Cobros', promesa: 'Promesas', despacho: 'Despachos', visita: 'Visitas', seguimiento: 'Seguimientos' };
  const shown = all.filter((x) => f === 'todo' || (f === 'vencidos' && x.days < 0) || (f === 'hoy' && x.days === 0) || (f === 'proximos' && x.days > 0) || x.type === f);
  return `<div class="page-head"><div><p class="eyebrow">Próximos 30 días</p><h1>Agenda</h1></div><button class="btn btn-primary" data-act="new-task">＋ Tarea</button></div>
  <div class="chips" role="tablist">${Object.entries(filters).map(([k, l]) => `<a role="tab" class="chip ${f === k ? 'active' : ''}" href="#/agenda?f=${k}">${l} <span>${k === 'todo' ? all.length : all.filter((x) => (k === 'vencidos' ? x.days < 0 : k === 'hoy' ? x.days === 0 : k === 'proximos' ? x.days > 0 : x.type === k)).length}</span></a>`).join('')}</div>
  <section class="panel">${agendaList(shown, 200)}</section>
  ${notificationsPanel()}`;
}

function notificationsPanel() {
  const s = S();
  const supported = 'Notification' in globalThis;
  return `<section class="panel"><h2>Avisos</h2><p class="muted">${supported ? 'Los avisos del navegador se muestran al abrir la app si hay tareas vencidas o para hoy. No hay notificaciones en segundo plano garantizadas en esta versión web.' : 'Este navegador no admite avisos.'}</p>${supported ? `<button class="btn btn-plain btn-small" data-act="notifications">${s.settings.notifications ? '🔔 Avisos activados' : '🔔 Activar avisos'}</button>` : ''}</section>`;
}
