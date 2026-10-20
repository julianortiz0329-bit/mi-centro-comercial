// Lector del RUT de la DIAN (Formulario 001, "Hoja principal") a partir del
// texto con posiciones que extrae pdf.js. Cada casilla del formulario tiene
// un rótulo numerado ("5. Número de Identificación Tributaria (NIT)") y su
// valor queda debajo, dentro del ancho de la casilla. Si el PDF no trae esa
// estructura (p. ej. una foto escaneada), se intenta con el texto plano.
import { normalizePhone } from './whatsapp.js';
import { prettyPhone } from './contact-parse.js';

export const RUT_RESPONSIBILITIES = {
  '05': 'Impuesto de renta (régimen ordinario)',
  '07': 'Retención en la fuente a título de renta',
  '09': 'Retención en la fuente en el impuesto sobre las ventas',
  '10': 'Obligado aduanero',
  '13': 'Gran contribuyente',
  '14': 'Informante de exógena',
  '15': 'Autorretenedor',
  '42': 'Obligado a llevar contabilidad',
  '47': 'Régimen simple de tributación',
  '48': 'Responsable de IVA',
  '49': 'No responsable de IVA',
  '52': 'Facturador electrónico',
  '53': 'Persona jurídica no responsable de IVA',
};

const LABEL = /^\s*(\d{1,3})\s*\.\s*(\S.*)?$/;
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Une tokens: si son caracteres sueltos (una casilla por dígito), sin espacios. */
function joinTokens(tokens) {
  const parts = tokens.map((t) => t.str.trim()).filter(Boolean);
  if (!parts.length) return '';
  if (parts.every((p) => p.length === 1)) return parts.join('');
  const out = [];
  let run = '';
  for (const p of parts) {
    if (p.length === 1 && /[\dA-Za-z]/.test(p)) run += p;
    else {
      if (run) out.push(run);
      run = '';
      out.push(p);
    }
  }
  if (run) out.push(run);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * items: [{ str, x, y, w, h }] con y medida desde arriba de la página.
 * Devuelve el valor de cada casilla numerada encontrada.
 */
export function rutFields(items) {
  const clean = items.filter((i) => String(i.str || '').trim());
  const labels = clean.map((i) => ({ i, m: String(i.str).match(LABEL) })).filter(({ m, i }) => m && Number(m[1]) <= 240 && (m[2] ? /\p{L}/u.test(m[2]) : i.str.trim().endsWith('.')));
  const labelSet = new Set(labels.map((l) => l.i));
  const byNum = {};
  for (const { i, m } of labels) {
    const n = Number(m[1]);
    if (!byNum[n]) byNum[n] = i; // primera aparición (hoja principal)
  }
  const fields = {};
  for (const [n, lab] of Object.entries(byNum)) {
    const rowH = Math.max(lab.h || 6, 6);
    // Límite derecho: el siguiente rótulo en la misma fila.
    const right = Math.min(...labels.filter(({ i }) => i !== lab && Math.abs(i.y - lab.y) < rowH * 0.8 && i.x > lab.x + 4).map(({ i }) => i.x), Infinity);
    // Valor: debajo del rótulo y antes del siguiente rótulo hacia abajo.
    const below = labels.filter(({ i }) => i.y > lab.y + rowH * 0.8 && i.x < (Number.isFinite(right) ? right : 1e9) && i.x + (i.w || 0) > lab.x - 4).map(({ i }) => i.y);
    const bottom = Math.min(lab.y + rowH * 5 + 14, ...below.map((y) => y - 1));
    const toks = clean.filter((t) => !labelSet.has(t) && t.y > lab.y + rowH * 0.3 && t.y <= bottom && t.x >= lab.x - 6 && t.x < right - 2).sort((a, b) => a.y - b.y || a.x - b.x);
    if (!toks.length) continue;
    // Toma la primera línea de valores (y otras muy cercanas, p. ej. dirección larga).
    const firstY = toks[0].y;
    const line = toks.filter((t) => t.y - firstY < rowH * 1.6).sort((a, b) => a.x - b.x);
    fields[n] = joinTokens(line);
  }
  return fields;
}

const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s.-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/(?<=\s)(De|Del|La|Las|Los|Y|E)(?=\s)/g, (w) => w.toLowerCase()).replace(/\bS\.?a\.?s\.?$/i, 'S.A.S.').replace(/\bLtda\.?$/i, 'Ltda.');
const stripCodes = (s) => String(s || '').replace(/\s*\d[\d\s]*$/, '').replace(/^\s*\d+\s+/, '').trim();

/** Convierte las casillas en datos de cliente. */
export function rutToClient(fields, plainText = '') {
  const out = {};
  const nit = String(fields[5] || '').replace(/\D/g, '');
  const dv = String(fields[6] || '').replace(/\D/g, '').slice(0, 1);
  if (nit.length >= 6) out.taxId = dv ? `${nit}-${dv}` : nit;
  const razon = String(fields[35] || '').trim();
  const person = [fields[33], fields[34], fields[31], fields[32]].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
  const comercial = String(fields[36] || '').trim();
  const legal = razon || person;
  if (legal) out.legalName = razon ? razon.replace(/\s+/g, ' ') : titleCase(person);
  if (comercial || legal) out.tradeName = comercial ? titleCase(comercial) : razon ? titleCase(razon) : titleCase(person);
  if (!razon && person) out.contactName = titleCase(person);
  const dep = stripCodes(fields[39]);
  const city = stripCodes(fields[40]);
  if (dep) out.department = titleCase(dep);
  if (city) out.city = titleCase(city);
  if (fields[41]) out.address = String(fields[41]).replace(/\s+/g, ' ').trim();
  const email = String(fields[42] || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (email) out.email = email[0].toLowerCase();
  const phones = [fields[44], fields[45]].map((x) => normalizePhone(String(x || '').replace(/\D/g, ''))).filter(Boolean);
  if (phones[0]) out.phone = prettyPhone(`+${phones[0]}`);
  if (phones[1] && phones[1] !== phones[0]) out.whatsapp = prettyPhone(`+${phones[1]}`);
  const activity = String(fields[46] || '').replace(/\D/g, '').slice(0, 4);
  // Responsabilidades: casilla 53 trae códigos de 2 dígitos ("05 07 48 52").
  const resp = [...new Set((String(fields[53] || '').replace(/\s+/g, '').match(/\d{2}/g) || []).filter((c) => RUT_RESPONSIBILITIES[c]))];
  out.rut = { activity: activity || null, responsibilities: resp };
  if (!out.taxId || !out.tradeName) Object.assign(out, fallbackFromText(plainText, out));
  return out;
}

/** Último recurso: buscar en el texto plano (PDF sin estructura de casillas). */
export function fallbackFromText(text, have = {}) {
  const t = String(text || '');
  const out = {};
  if (!have.taxId) {
    const m = t.match(/(?:NIT|Identificaci[oó]n Tributaria)[^\d]{0,80}((?:\d\s?){8,10})(?:\D{0,30}DV\D{0,10}(\d))?/i) || t.match(/\b(\d{3}\.?\d{3}\.?\d{3})\s*-\s*(\d)\b/);
    if (m) out.taxId = `${m[1].replace(/\D/g, '')}${m[2] ? `-${m[2]}` : ''}`;
  }
  if (!have.tradeName) {
    const m = t.match(/Raz[oó]n social\s*\n?\s*([A-ZÁÉÍÓÚÑ0-9][^\n]{2,80})/);
    if (m && !/^\d+\./.test(m[1])) out.tradeName = titleCase(m[1].trim());
  }
  if (!have.email) {
    const m = t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (m) out.email = m[0].toLowerCase();
  }
  return out;
}

/** Texto legible de responsabilidades para las observaciones del cliente. */
export function rutSummary(rut) {
  if (!rut) return '';
  const parts = [];
  if (rut.responsibilities?.length) parts.push(`Responsabilidades RUT: ${rut.responsibilities.map((c) => `${c} ${RUT_RESPONSIBILITIES[c]}`).join('; ')}.`);
  if (rut.activity) parts.push(`Actividad económica principal (CIIU): ${rut.activity}.`);
  return parts.join(' ');
}

export function looksLikeRut(text) {
  const f = fold(text);
  return /registro unico tributario|formulario del registro|identificacion tributaria/.test(f);
}
