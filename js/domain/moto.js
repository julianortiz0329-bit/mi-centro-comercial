// Uber Moto (3.8): lo que ganas cada día en la moto, lo que te cuesta y lo que
// te queda libre. Un registro por día (lo que dice la app de Uber, propinas,
// horas, viajes, km y la gasolina del día) más los gastos sueltos de la moto
// (mantenimiento, aceite, llantas, SOAT…). Todo en pesos enteros.
import { newId } from '../core/ids.js';
import { addDays, diffDays, isValidDate, localDate, periodOf } from '../core/dates.js';
import { assert, audit, cleanText, ConfirmRequired, getOrFail, nowOf } from './common.js';

export const MOTO_EXPENSES = {
  gasolina: 'Gasolina',
  mantenimiento: 'Mantenimiento',
  aceite: 'Aceite',
  llantas: 'Llantas',
  repuestos: 'Repuestos',
  soat: 'SOAT y papeles',
  lavado: 'Lavado',
  parqueadero: 'Parqueadero',
  celular: 'Plan del celular',
  otro: 'Otro',
};

export function emptyMoto() {
  return { days: [], expenses: [], goal: 0 };
}

const moto = (s) => {
  if (!s.moto) s.moto = emptyMoto();
  return s.moto;
};

const peso = (v, label) => {
  const n = v === '' || v == null ? 0 : Number(v);
  assert(Number.isSafeInteger(n) && n >= 0, `${label} no es un valor válido.`, 'amount');
  return n;
};
const decimal = (v, label, max) => {
  const n = v === '' || v == null ? 0 : Number(v);
  assert(Number.isFinite(n) && n >= 0 && n <= max, `${label} no es válido.`, 'number');
  return Math.round(n * 10) / 10;
};

/** "6,5", "6.5" o "6:30" → 6.5 horas. Vacío → 0. NaN si no se entiende. */
export function parseHours(input) {
  const t = String(input ?? '').trim();
  if (!t) return 0;
  const hm = t.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return +hm[1] + +hm[2] / 60;
  if (/^\d+([.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'));
  return NaN;
}

/** Anota (o corrige) un día. Si ese día ya tenía registro, pide confirmar para reemplazarlo. */
export function saveMotoDay(s, input, ctx) {
  const m = moto(s);
  assert(isValidDate(input.date), 'La fecha no es válida.', 'date');
  assert(input.date <= localDate(new Date(nowOf(ctx))), 'No puedes anotar un día que todavía no ha pasado.', 'date');
  const data = {
    date: input.date,
    earnings: peso(input.earnings, 'Lo que ganaste en la app'),
    tips: peso(input.tips, 'Las propinas'),
    cash: peso(input.cash, 'El efectivo recibido'),
    fuel: peso(input.fuel, 'La gasolina'),
    hours: decimal(input.hours, 'Las horas', 24),
    trips: Math.round(decimal(input.trips, 'Los viajes', 500)),
    km: decimal(input.km, 'Los kilómetros', 2000),
    notes: cleanText(input.notes, 500),
  };
  assert(data.earnings + data.tips + data.fuel > 0 || data.hours > 0, 'Anota al menos lo que ganaste o las horas que trabajaste.', 'empty');
  const clash = m.days.find((d) => d.date === data.date && d.id !== input.id);
  if (clash) {
    if (!input.confirm?.moto_replace) throw new ConfirmRequired('Ya tienes anotado ese día. ¿Quieres reemplazarlo con estos valores?', 'moto_replace');
    m.days.splice(m.days.indexOf(clash), 1);
  }
  if (input.id) {
    const d = getOrFail(m.days, input.id, 'el día');
    Object.assign(d, data, { updatedAt: nowOf(ctx) });
    audit(s, ctx, 'editar', 'uber_dia', d.id, data.date);
    return d;
  }
  const d = { id: newId('uber'), ...data, createdAt: nowOf(ctx), updatedAt: nowOf(ctx) };
  m.days.push(d);
  audit(s, ctx, 'crear', 'uber_dia', d.id, data.date);
  return d;
}

export function deleteMotoDay(s, { id }, ctx) {
  const m = moto(s);
  const d = getOrFail(m.days, id, 'el día');
  m.days.splice(m.days.indexOf(d), 1);
  audit(s, ctx, 'borrar', 'uber_dia', d.id, d.date);
  return d;
}

export function saveMotoExpense(s, input, ctx) {
  const m = moto(s);
  assert(isValidDate(input.date), 'La fecha no es válida.', 'date');
  assert(MOTO_EXPENSES[input.category], 'Escoge en qué fue el gasto.', 'category');
  const data = { date: input.date, category: input.category, amount: peso(input.amount, 'El valor'), notes: cleanText(input.notes, 300) };
  assert(data.amount > 0, 'Escribe cuánto costó.', 'amount');
  if (input.id) {
    const e = getOrFail(m.expenses, input.id, 'el gasto');
    Object.assign(e, data, { updatedAt: nowOf(ctx) });
    audit(s, ctx, 'editar', 'uber_gasto', e.id, MOTO_EXPENSES[data.category]);
    return e;
  }
  const e = { id: newId('ugas'), ...data, createdAt: nowOf(ctx) };
  m.expenses.push(e);
  audit(s, ctx, 'crear', 'uber_gasto', e.id, MOTO_EXPENSES[data.category]);
  return e;
}

export function deleteMotoExpense(s, { id }, ctx) {
  const m = moto(s);
  const e = getOrFail(m.expenses, id, 'el gasto');
  m.expenses.splice(m.expenses.indexOf(e), 1);
  audit(s, ctx, 'borrar', 'uber_gasto', e.id, MOTO_EXPENSES[e.category]);
  return e;
}

export function setMotoGoal(s, { goal }, ctx) {
  moto(s).goal = peso(goal, 'La meta');
  audit(s, ctx, 'editar', 'uber_meta', '', String(goal));
  return moto(s).goal;
}

/** Lo que entró ese día (app + propinas) y lo que quedó después de la gasolina. */
export const dayIncome = (d) => d.earnings + d.tips;
export const dayNet = (d) => dayIncome(d) - d.fuel;

const perUnit = (amount, units) => (units > 0 ? Math.round(amount / units) : null);

/** Resumen de un mes (AAAA-MM). */
export function motoPeriod(s, period) {
  const m = s.moto || emptyMoto();
  const days = m.days.filter((d) => periodOf(d.date) === period).sort((a, b) => b.date.localeCompare(a.date));
  const expenses = m.expenses.filter((e) => periodOf(e.date) === period).sort((a, b) => b.date.localeCompare(a.date));
  const tot = (k) => days.reduce((a, d) => a + d[k], 0);
  const income = tot('earnings') + tot('tips');
  const fuelDays = tot('fuel');
  const byCategory = {};
  for (const e of expenses) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  const other = expenses.reduce((a, e) => a + e.amount, 0);
  const fuel = fuelDays + (byCategory.gasolina || 0);
  const costs = fuelDays + other;
  const net = income - costs;
  const hours = Math.round(tot('hours') * 10) / 10;
  const km = Math.round(tot('km') * 10) / 10;
  const worked = days.filter((d) => dayIncome(d) > 0 || d.hours > 0);
  const best = worked.reduce((b, d) => (!b || dayNet(d) > dayNet(b) ? d : b), null);
  return {
    period, days, expenses, income, tips: tot('tips'), cash: tot('cash'), fuel, other, costs, net,
    hours, trips: tot('trips'), km, daysWorked: worked.length,
    perHour: perUnit(net, hours), perKm: perUnit(net, km), perTrip: perUnit(net, tot('trips')), perDay: perUnit(net, worked.length),
    best, byCategory, goal: m.goal || 0, goalPct: m.goal ? Math.round((net / m.goal) * 1000) / 10 : null,
  };
}

/** Los últimos `n` días hasta `today`, con lo que quedó libre cada uno (0 si no trabajó). */
export function motoLastDays(s, today = localDate(), n = 7) {
  const byDate = new Map((s.moto?.days || []).map((d) => [d.date, d]));
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(today, i - n + 1);
    const d = byDate.get(date) || null;
    return { date, day: d, net: d ? dayNet(d) : 0 };
  });
}

/** Semana actual (lunes a hoy). */
export function motoWeek(s, today = localDate()) {
  const dow = (new Date(`${today}T12:00:00`).getDay() + 6) % 7; // lunes = 0
  const from = addDays(today, -dow);
  const days = (s.moto?.days || []).filter((d) => d.date >= from && d.date <= today);
  const exp = (s.moto?.expenses || []).filter((e) => e.date >= from && e.date <= today).reduce((a, e) => a + e.amount, 0);
  const net = days.reduce((a, d) => a + dayNet(d), 0) - exp;
  return { from, to: today, net, days: days.length, elapsed: diffDays(from, today) + 1 };
}

export const motoDay = (s, date) => (s.moto?.days || []).find((d) => d.date === date) || null;
