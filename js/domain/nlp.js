// Lectura simple de notas dictadas o escritas: detecta un valor en pesos, una
// fecha ("el viernes", "mañana", "15 de octubre", "en 3 días") y la intención
// (promesa de pago, pedido, no contestó…). No envía nada a internet.
import { addDays, isValidDate } from '../core/dates.js';

const DAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WORDNUM = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, cien: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900 };

const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function parseAmount(text) {
  const t = norm(text);
  if (/medio millon/.test(t)) return 500000;
  let m = t.match(/(\d+(?:[.,]\d+)?)\s*(millones|millon|mill?ones?)\b/);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1e6);
  m = t.match(/\b(un|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+millon(?:es)?\b/);
  if (m) return WORDNUM[m[1]] * 1e6;
  m = t.match(/(\d+(?:[.,]\d+)?)\s*(mil|k)\b/);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1000);
  m = t.match(/\b(cien|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|cincuenta|veinte|treinta|cuarenta|diez|quince)\s+mil\b/);
  if (m) return WORDNUM[m[1]] * 1000;
  // Número con puntos de miles ("500.000", "$ 1.250.000") o sin ellos (6+ dígitos).
  m = t.match(/\$?\s*(\d{1,3}(?:\.\d{3})+)(?!\d)/);
  if (m) return Number(m[1].replace(/\./g, ''));
  m = t.match(/\$?\s*(\d{4,})(?!\d)/);
  if (m) return Number(m[1]);
  return null;
}

export function parseDate(text, today) {
  const t = norm(text);
  if (/pasado manana/.test(t)) return addDays(today, 2);
  if (/\bmanana\b/.test(t)) return addDays(today, 1);
  if (/\bhoy\b/.test(t)) return today;
  let m = t.match(/en\s+(\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince)\s+dias?/);
  if (m) return addDays(today, /\d/.test(m[1]) ? Number(m[1]) : WORDNUM[m[1]]);
  if (/(proxima|siguiente) semana/.test(t)) return addDays(today, 7);
  m = t.match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/);
  if (m) return nextDate(today, Number(m[1]), MONTHS.indexOf(m[2]) + 1);
  m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) return nextDate(today, Number(m[1]), Number(m[2]), m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : null);
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${DAYS[i]}\\b`).test(t)) {
      const cur = new Date(`${today}T12:00:00`).getDay();
      let delta = (i - cur + 7) % 7;
      if (delta === 0) delta = 7; // "el viernes" dicho un viernes = el próximo
      return addDays(today, delta);
    }
  }
  m = t.match(/\b(?:el|dia)\s+(\d{1,2})\b(?!\s*(?:mil|millon|\.|\d))/);
  if (m) {
    const day = Number(m[1]);
    const mo = Number(today.slice(5, 7));
    return nextDate(today, day, mo, null, true);
  }
  return null;
}

function nextDate(today, day, month, year = null, rollMonth = false) {
  const [ty] = today.split('-').map(Number);
  let y = year || ty;
  let d = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!isValidDate(d)) return null;
  if (!year && d < today) {
    if (rollMonth) {
      const nm = month === 12 ? 1 : month + 1;
      y = month === 12 ? y + 1 : y;
      d = `${y}-${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    } else d = `${y + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!isValidDate(d)) return null;
  }
  return d;
}

export function parseIntent(text) {
  const t = norm(text);
  if (/no (contesto|contesta|respondio|responde)|no me contest|buzon|apagado/.test(t)) return 'no_contesto';
  if (/me pago|pago hoy|ya pago|consigno|transfirio|abono hoy|recibi (el )?pago/.test(t)) return 'pago';
  if (/promet|va a pagar|pagara|paga el|queda de pagar|se comprometio|compromiso de pago|abona el/.test(t)) return 'promesa';
  if (/hizo (un )?pedido|pidio|compro|me compro|encargo|pedido de/.test(t)) return 'compro';
  if (/no (compro|pidio|necesita)|no quiere|tiene inventario|sin pedido/.test(t)) return 'no_compro';
  return null;
}

export function parseNote(text, today) {
  return { amount: parseAmount(text), date: parseDate(text, today), intent: parseIntent(text) };
}
