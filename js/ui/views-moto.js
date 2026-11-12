// Uber Moto (3.8): pantalla del mes, tarjeta de Inicio y formularios.
import { addDays, formatDate, isValidDate, localDate, periodLabel, periodOf, previousPeriod } from '../core/dates.js';
import { dayIncome, dayNet, deleteMotoDay, deleteMotoExpense, MOTO_EXPENSES, motoDay, motoLastDays, motoPeriod, motoWeek, parseHours, saveMotoDay, saveMotoExpense, setMotoGoal } from '../domain/moto.js';
import { getState } from '../store/store.js';
import { bindMoneyPreviews, confirmDialog, esc, exec, field, money, openModal, progress, readMoney, toast } from './dom.js';
import { icon } from './icons.js';

const S = () => getState();
const month = (p) => periodLabel(p).split(' ')[0];
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const nextPeriod = (p) => previousPeriod(p, -1);
const fmtNum = (n) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(n);
const hrs = (h) => `${fmtNum(h)} h`;
/** Monto corto para las barras: 85 mil, 1,2 M. */
const short = (n) => (n >= 1e6 ? `${fmtNum(n / 1e6)} M` : n >= 1000 ? `${Math.round(n / 1000)} mil` : `$${n}`);
/** Número con coma o punto decimal; vacío = 0; NaN si no se entiende. */
const num = (v) => {
  const t = String(v ?? '').trim();
  if (!t) return 0;
  return /^\d+([.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : NaN;
};
const weekday = (date) => new Date(`${date}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'short' }).replace('.', '');
const dayLabel = (date, today) => (date === today ? 'Hoy' : date === addDays(today, -1) ? 'Ayer' : cap(new Date(`${date}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short' })));

/** Barras de los últimos 7 días: la altura es lo que quedó libre cada día. */
function weekBars(today) {
  const days = motoLastDays(S(), today, 7);
  const max = Math.max(1, ...days.map((d) => d.net));
  return `<div class="mo-bars" role="list">${days.map((d) => {
    const h = d.net > 0 ? Math.max(6, Math.round((d.net / max) * 100)) : 0;
    return `<button type="button" class="mo-bar ${d.date === today ? 'today' : ''} ${d.day ? '' : 'off'}" role="listitem" data-act="moto-day" ${d.day ? `data-id="${d.day.id}"` : `data-date="${d.date}"`} aria-label="${esc(dayLabel(d.date, today))}: ${d.day ? `te quedaron ${money(d.net)}` : 'sin anotar'}">
      <small class="mo-bar-v">${d.day ? short(d.net) : '—'}</small>
      <span class="mo-bar-track"><i style="height:${h}%"></i></span>
      <small>${esc(d.date === today ? 'hoy' : weekday(d.date))}</small></button>`;
  }).join('')}</div>`;
}

export function renderMoto(params) {
  const today = localDate();
  const cur = periodOf(today);
  const p = /^\d{4}-\d{2}$/.test(params.get('m') || '') ? params.get('m') : cur;
  const r = motoPeriod(S(), p);
  const wk = motoWeek(S(), today);
  const todayRec = motoDay(S(), today);
  const isCur = p === cur;

  const hero = `<section class="hero mo-hero" aria-label="Lo que te quedó en ${esc(month(p))}">
    <div class="hero-top"><span class="hero-label">Te quedó libre en ${esc(month(p))}</span>${r.goal ? `<span class="hero-chip">${r.goalPct >= 100 ? '¡Meta cumplida!' : `Meta ${fmtNum(Math.max(0, r.goalPct))} %`}</span>` : ''}</div>
    <div class="hero-amount ${r.net < 0 ? 'neg' : ''}">${r.net < 0 ? '−' : ''}${money(Math.abs(r.net))}</div>
    <div class="hero-sub">Ganaste <b>${money(r.income)}</b> · gastos <b>${money(r.costs)}</b>${r.tips ? ` · propinas <b>${money(r.tips)}</b>` : ''}</div>
    ${r.goal ? `<div class="mo-goal">${progress(r.goalPct)}<small>Meta del mes ${money(r.goal)}${r.net < r.goal ? ` · faltan ${money(r.goal - r.net)}` : ''}</small></div>` : ''}
    <div class="hero-foot">
      <span class="hero-chip">${r.perHour != null ? `${money(r.perHour)} por hora` : 'Sin horas anotadas'}</span>
      <span class="hero-chip">${r.daysWorked} día${r.daysWorked === 1 ? '' : 's'} trabajado${r.daysWorked === 1 ? '' : 's'}</span>
      ${r.perKm != null ? `<span class="hero-chip">${money(r.perKm)} por km</span>` : ''}
    </div></section>`;

  const todayCard = !isCur ? '' : todayRec
    ? `<button type="button" class="mo-today done" data-act="moto-day" data-id="${todayRec.id}">${icon('check', { size: 18 })}<span><b>Hoy ya está anotado</b><small>Te quedaron ${money(dayNet(todayRec))}${todayRec.hours ? ` en ${hrs(todayRec.hours)}` : ''}. Toca para corregir.</small></span>${icon('arrowRight', { size: 16 })}</button>`
    : `<button type="button" class="mo-today" data-act="moto-day" data-date="${today}">${icon('bike', { size: 20 })}<span><b>Anota lo de hoy</b><small>Lo que dice la app, propinas, horas y gasolina. Toma menos de un minuto.</small></span>${icon('plus', { size: 18 })}</button>`;

  const stats = `<div class="stats">
    <div class="stat"><div class="stat-label">Horas conectado</div><div class="stat-value">${hrs(r.hours)}</div><div class="stat-note">${r.perHour != null ? `${money(r.perHour)} libres por hora` : '—'}</div></div>
    <div class="stat"><div class="stat-label">Viajes</div><div class="stat-value">${fmtNum(r.trips)}</div><div class="stat-note">${r.perTrip != null ? `${money(r.perTrip)} libres por viaje` : '—'}</div></div>
    <div class="stat"><div class="stat-label">Kilómetros</div><div class="stat-value">${fmtNum(r.km)}</div><div class="stat-note">${r.perKm != null ? `${money(r.perKm)} libres por km` : '—'}</div></div>
    <div class="stat"><div class="stat-label">Promedio por día</div><div class="stat-value">${r.perDay != null ? money(r.perDay) : '—'}</div><div class="stat-note">${r.best ? `Mejor: ${esc(formatDate(r.best.date))} · ${money(dayNet(r.best))}` : 'Libre, después de gasolina'}</div></div>
    <div class="stat"><div class="stat-label">Gasolina</div><div class="stat-value">${money(r.fuel)}</div><div class="stat-note">${r.income ? `${fmtNum((r.fuel / r.income) * 100)} % de lo que ganaste` : '—'}</div></div>
    <div class="stat"><div class="stat-label">Otros gastos de la moto</div><div class="stat-value">${money(r.other - (r.byCategory.gasolina || 0))}</div><div class="stat-note">${Object.entries(r.byCategory).filter(([k]) => k !== 'gasolina').map(([k, v]) => `${esc(MOTO_EXPENSES[k])} ${money(v)}`).join(' · ') || 'Mantenimiento, aceite, llantas…'}</div></div>
  </div>`;

  const dayRows = r.days.length
    ? `<ul class="mo-list">${r.days.map((d) => `<li><button type="button" data-act="moto-day" data-id="${d.id}">
        <span class="mo-date"><b>${esc(dayLabel(d.date, today))}</b><small>${[d.hours ? hrs(d.hours) : '', d.trips ? `${d.trips} viaje${d.trips === 1 ? '' : 's'}` : '', d.fuel ? `gasolina ${money(d.fuel)}` : ''].filter(Boolean).join(' · ') || 'Sin horas ni viajes'}</small></span>
        <span class="mo-amt"><b class="${dayNet(d) < 0 ? 'danger' : ''}">${money(dayNet(d))}</b><small>ganó ${money(dayIncome(d))}</small></span></button></li>`).join('')}</ul>`
    : `<p class="muted">${isCur ? 'Aún no has anotado ningún día este mes.' : 'No hay días anotados en este mes.'}</p>`;

  const expRows = r.expenses.length
    ? `<ul class="mo-list">${r.expenses.map((e) => `<li><button type="button" data-act="moto-expense" data-id="${e.id}">
        <span class="mo-date"><b>${esc(MOTO_EXPENSES[e.category])}</b><small>${esc(formatDate(e.date))}${e.notes ? ` · ${esc(e.notes)}` : ''}</small></span>
        <span class="mo-amt"><b>${money(e.amount)}</b></span></button></li>`).join('')}</ul>`
    : '<p class="muted">Sin gastos sueltos este mes. Aquí van el mantenimiento, el aceite, las llantas o el SOAT; la gasolina de cada día va en el registro del día.</p>';

  return `<div class="page-head"><div><p class="eyebrow">Tu otro ingreso</p><h1>Uber Moto</h1></div><button class="btn btn-primary" data-act="moto-day" data-date="${today}">${icon('plus', { size: 16 })} Anotar día</button></div>
  <nav class="mo-month" aria-label="Cambiar de mes">
    <a class="icon-toggle" href="#/uber?m=${previousPeriod(p)}" aria-label="Mes anterior">${icon('arrowRight', { size: 16 }).replace('<svg', '<svg style="rotate:180deg"')}</a>
    <b>${esc(cap(periodLabel(p)))}</b>
    ${isCur ? '<span class="icon-toggle mo-dis" aria-hidden="true"></span>' : `<a class="icon-toggle" href="#/uber?m=${nextPeriod(p)}" aria-label="Mes siguiente">${icon('arrowRight', { size: 16 })}</a>`}
  </nav>
  ${todayCard}
  ${hero}
  ${isCur ? `<section class="panel"><div class="panel-head"><div><h2>Últimos 7 días</h2><p class="muted">Esta semana llevas <b>${money(wk.net)}</b> libres en ${wk.days} de ${wk.elapsed} día${wk.elapsed === 1 ? '' : 's'}.</p></div></div>${weekBars(today)}</section>` : ''}
  ${stats}
  <section class="panel"><div class="panel-head"><h2>Días de ${esc(month(p))}</h2><small class="muted">${r.days.length} anotado${r.days.length === 1 ? '' : 's'}</small></div>${dayRows}</section>
  <section class="panel"><div class="panel-head"><h2>Gastos de la moto</h2><button class="btn btn-plain btn-small" data-act="moto-expense">${icon('plus', { size: 14 })} Gasto</button></div>${expRows}</section>
  <p class="home-foot"><button type="button" class="btn btn-plain btn-small" data-act="moto-goal">${icon('target', { size: 15 })} ${r.goal ? `Meta del mes: ${money(r.goal)}` : 'Ponerte una meta del mes'}</button></p>`;
}

/** Cuadro de Inicio: lo que va del mes y si ya anotaste hoy. */
export function motoCard() {
  const s = S();
  const today = localDate();
  const r = motoPeriod(s, periodOf(today));
  const t = motoDay(s, today);
  if (!r.days.length && !r.expenses.length && !t) {
    return `<a class="mo-card mo-off" href="#/uber">${icon('bike', { size: 18 })}<span><b>Uber Moto</b><small>Anota cada día lo que ganas en la moto y mira cuánto te queda libre.</small></span>${icon('arrowRight', { size: 16 })}</a>`;
  }
  return `<a class="mo-card" href="#/uber"><span class="ale-paw mo-ico" aria-hidden="true">${icon('bike', { size: 20 })}</span><span class="ale-main"><small>Uber Moto · libre en ${esc(month(r.period))}</small><b class="${r.net < 0 ? 'danger' : ''}">${money(r.net)}</b>
    <small>${t ? `Hoy: ${money(dayNet(t))}` : 'Hoy sin anotar · toca para anotar'}${r.perHour != null ? ` · ${money(r.perHour)}/hora` : ''}</small></span>${icon('arrowRight', { size: 16 })}</a>`;
}

/** Formulario del día. `id` corrige uno anotado; `date` abre ese día (o el que ya exista). */
export function motoDayForm({ id = null, date = null } = {}) {
  const s = S();
  const today = localDate();
  const x = (id && s.moto.days.find((d) => d.id === id)) || (date && motoDay(s, date)) || null;
  const v = (k) => (x && x[k] ? x[k] : '');
  openModal({
    title: x ? `Uber · ${esc(dayLabel(x.date, today))}` : 'Anotar día de Uber',
    subtitle: x ? 'Corrige lo que necesites.' : 'Copia los valores de la app de Uber del día. Solo lo primero es obligatorio.',
    body: `<div class="grid2">
      ${field({ name: 'date', label: 'Día', type: 'date', value: x?.date || date || today, required: true, attrs: `max="${today}"` })}
      ${field({ name: 'earnings', label: 'Lo que ganaste según la app', type: 'money', value: v('earnings'), required: true, placeholder: 'Ej. 120.000', help: 'Lo que Uber dice que ganaste ese día (ya sin su comisión).' })}
      ${field({ name: 'tips', label: 'Propinas', type: 'money', value: v('tips'), placeholder: '0' })}
      ${field({ name: 'fuel', label: 'Gasolina del día', type: 'money', value: v('fuel'), placeholder: 'Ej. 18.000' })}
      ${field({ name: 'hours', label: 'Horas conectado', value: x?.hours ? String(x.hours).replace('.', ',') : '', placeholder: 'Ej. 6,5 o 6:30', attrs: 'inputmode="decimal" autocomplete="off"' })}
      ${field({ name: 'trips', label: 'Viajes', type: 'number', value: v('trips'), placeholder: 'Ej. 18', attrs: 'inputmode="numeric" min="0" max="500" step="1"' })}
      ${field({ name: 'km', label: 'Kilómetros', value: x?.km ? String(x.km).replace('.', ',') : '', placeholder: 'Ej. 95', attrs: 'inputmode="decimal" autocomplete="off"' })}
      ${field({ name: 'cash', label: 'Efectivo recibido (opcional)', type: 'money', value: v('cash'), placeholder: '0', help: 'Solo para que sepas cuánto te pagaron en mano.' })}
      ${field({ name: 'notes', label: 'Nota (opcional)', type: 'textarea', value: x?.notes || '', full: true, placeholder: 'Ej. Llovió, mucho tráfico, día de quincena…' })}
      ${x ? `<div class="field full"><button type="button" class="btn btn-plain btn-small danger" data-act="moto-day-delete" data-id="${x.id}">Borrar este día</button></div>` : ''}
    </div>`,
    submitText: x ? 'Guardar' : 'Anotar',
    onOpen: (form) => bindMoneyPreviews(form),
    onSubmit: async (fd) => {
      const hours = parseHours(fd.get('hours'));
      const km = num(fd.get('km'));
      if (Number.isNaN(hours)) return toast('Las horas no se entienden. Escribe por ejemplo 6,5 o 6:30.', 'error'), false;
      if (Number.isNaN(km)) return toast('Los kilómetros no se entienden. Escribe por ejemplo 95 o 95,5.', 'error'), false;
      const input = {
        id: x?.id || null,
        date: fd.get('date'),
        earnings: readMoney(fd, 'earnings', { label: 'Lo que ganaste' }),
        tips: readMoney(fd, 'tips', { required: false, label: 'Las propinas' }),
        fuel: readMoney(fd, 'fuel', { required: false, label: 'La gasolina' }),
        cash: readMoney(fd, 'cash', { required: false, label: 'El efectivo' }),
        hours,
        trips: fd.get('trips') ? Number(fd.get('trips')) : 0,
        km,
        notes: fd.get('notes'),
      };
      const saved = await exec(saveMotoDay, input, { success: x ? 'Día corregido' : `Anotado: te quedaron ${money(input.earnings + input.tips - input.fuel)}` });
      return saved ? undefined : false;
    },
  });
}

export function motoExpenseForm({ id = null } = {}) {
  const s = S();
  const x = (id && s.moto.expenses.find((e) => e.id === id)) || null;
  openModal({
    title: x ? 'Gasto de la moto' : 'Nuevo gasto de la moto',
    subtitle: 'Mantenimiento, aceite, llantas, SOAT… Se resta de lo que te queda libre en el mes.',
    body: `<div class="grid2">
      ${field({ name: 'category', label: '¿En qué fue?', type: 'select', value: x?.category || 'mantenimiento', options: Object.entries(MOTO_EXPENSES).map(([value, label]) => ({ value, label })) })}
      ${field({ name: 'amount', label: 'Valor', type: 'money', value: x?.amount || '', required: true })}
      ${field({ name: 'date', label: 'Fecha', type: 'date', value: x?.date || localDate(), required: true })}
      ${field({ name: 'notes', label: 'Detalle (opcional)', value: x?.notes || '', placeholder: 'Ej. Cambio de pastillas de freno' })}
      ${x ? `<div class="field full"><button type="button" class="btn btn-plain btn-small danger" data-act="moto-expense-delete" data-id="${x.id}">Borrar este gasto</button></div>` : ''}
    </div>`,
    submitText: x ? 'Guardar' : 'Agregar',
    onOpen: (form) => bindMoneyPreviews(form),
    onSubmit: async (fd) => {
      const saved = await exec(saveMotoExpense, { id: x?.id || null, category: fd.get('category'), amount: readMoney(fd, 'amount'), date: fd.get('date'), notes: fd.get('notes') }, { success: x ? 'Gasto actualizado' : 'Gasto agregado' });
      return saved ? undefined : false;
    },
  });
}

export function motoGoalForm() {
  const g = S().moto.goal || '';
  openModal({
    title: 'Meta del mes en Uber',
    subtitle: 'Cuánto quieres que te quede libre cada mes, después de gasolina y gastos. 0 o vacío la quita.',
    body: field({ name: 'goal', label: 'Meta mensual', type: 'money', value: g, placeholder: 'Ej. 2.000.000' }),
    onOpen: (form) => bindMoneyPreviews(form),
    onSubmit: async (fd) => ((await exec(setMotoGoal, { goal: readMoney(fd, 'goal', { required: false, label: 'La meta' }) }, { success: 'Meta guardada' })) !== null ? undefined : false),
  });
}

export const motoHandlers = {
  'moto-day': (el) => motoDayForm({ id: el.dataset.id || null, date: isValidDate(el.dataset.date) ? el.dataset.date : null }),
  'moto-expense': (el) => motoExpenseForm({ id: el.dataset.id || null }),
  'moto-goal': () => motoGoalForm(),
  'moto-day-delete': async (el) => {
    if (!(await confirmDialog({ title: '¿Borrar este día?', message: 'Se quita del resumen del mes. No se puede deshacer.', confirmText: 'Borrar', danger: true }))) return;
    if (await exec(deleteMotoDay, { id: el.dataset.id }, { success: 'Día borrado' })) document.querySelector('#modal-root [data-close]')?.click();
  },
  'moto-expense-delete': async (el) => {
    if (!(await confirmDialog({ title: '¿Borrar este gasto?', message: 'Se quita del resumen del mes.', confirmText: 'Borrar', danger: true }))) return;
    if (await exec(deleteMotoExpense, { id: el.dataset.id }, { success: 'Gasto borrado' })) document.querySelector('#modal-root [data-close]')?.click();
  },
};
