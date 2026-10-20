// Fechas locales del dispositivo. Las fechas de negocio se guardan como
// 'AAAA-MM-DD' y los instantes como ISO-8601 con zona (toISOString).

const pad = (n) => String(n).padStart(2, '0');

export function localDate(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export function localTime(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return `${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

/** Instante ISO a partir de fecha y hora locales. */
export function toInstant(date, time = '12:00') {
  return new Date(`${date}T${time || '12:00'}:00`).toISOString();
}

export function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const d = new Date(`${s}T12:00:00`);
  return !Number.isNaN(d.getTime()) && localDate(d) === s;
}

export function addDays(date, days) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  return localDate(d);
}

/** Días de `from` a `to` (positivo si `to` es posterior). */
export function diffDays(from, to) {
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  return Math.round((b - a) / 86400000);
}

/** Periodo mensual 'AAAA-MM' de una fecha o instante. */
export function periodOf(dateOrInstant) {
  const s = String(dateOrInstant || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);
  return localDate(new Date(s)).slice(0, 7);
}

export function periodLabel(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
}

export function previousPeriod(period, n = 1) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 - n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function formatDate(s) {
  if (!s) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
