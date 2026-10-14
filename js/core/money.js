// Dinero en pesos colombianos ENTEROS (sin centavos). Nunca se guardan montos
// como texto ni como decimales: toda la aritmética pasa por estas funciones.

/** Redondeo half-up para enteros no negativos y negativos (simétrico). */
function roundDiv(numerator, denominator) {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  const sign = (n < 0n) !== (d < 0n) ? -1n : 1n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return Number(sign * q);
}

/** a * b / c redondeado, sin pérdida de precisión (BigInt). */
export function mulDiv(a, b, c) {
  if (!c) return 0;
  return roundDiv(BigInt(Math.round(a)) * BigInt(Math.round(b)), BigInt(Math.round(c)));
}

/** Aplica un porcentaje expresado en puntos básicos (6 % = 600, 0,4 % = 40). */
export function applyBps(amount, bps) {
  return mulDiv(amount, bps, 10000);
}

/** Convierte un porcentaje (p. ej. 0.75 o "0,75") a puntos básicos enteros. */
export function pctToBps(pct) {
  const n = typeof pct === 'number' ? pct : parseDecimal(pct);
  return Math.round(n * 100);
}

export function bpsToPct(bps) {
  return bps / 100;
}

export function isPeso(v) {
  return Number.isSafeInteger(v);
}

/**
 * Lee un valor monetario escrito como en Colombia ("$ 1.250.000", "1250000",
 * "1.250.000,00") y devuelve pesos enteros. Devuelve NaN si no es válido.
 */
export function parsePesos(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input) : NaN;
  let s = String(input ?? '').trim().replace(/\s/g, '').replace(/\$/g, '').replace(/COP/gi, '');
  if (!s) return NaN;
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (!/^[\d.,]+$/.test(s)) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart = s;
  let frac = '';
  if (lastComma >= 0 && lastDot >= 0) {
    const decSep = lastComma > lastDot ? ',' : '.';
    const idx = s.lastIndexOf(decSep);
    intPart = s.slice(0, idx);
    frac = s.slice(idx + 1);
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length <= 2) { intPart = parts[0]; frac = parts[1]; }
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    if (parts.length === 2 && parts[1].length <= 2) { intPart = parts[0]; frac = parts[1]; }
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (!/^\d+$/.test(intPart) || (frac && !/^\d+$/.test(frac))) return NaN;
  let value = Number(intPart);
  if (frac && Number(frac[0]) >= 5) value += 1; // redondeo a peso
  if (!Number.isSafeInteger(value)) return NaN;
  return neg ? -value : value;
}

/** Decimal genérico (cantidades, porcentajes). Acepta coma o punto decimal. */
export function parseDecimal(input) {
  if (typeof input === 'number') return input;
  const s = String(input ?? '').trim().replace(/\s/g, '');
  if (!s) return NaN;
  if (/^-?\d+([.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  return NaN;
}

const fmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0, minimumFractionDigits: 0 });
export function formatCOP(v) {
  return fmt.format(Number(v) || 0);
}

export function formatPct(bps) {
  return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(bps / 100)} %`;
}

export function sum(list, pick = (x) => x) {
  let t = 0;
  for (const x of list) t += pick(x);
  return t;
}
