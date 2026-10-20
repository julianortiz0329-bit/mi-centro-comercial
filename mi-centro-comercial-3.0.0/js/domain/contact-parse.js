// Extrae datos de un cliente (nombre, teléfono, dirección, ciudad, NIT, correo)
// de un texto pegado o compartido desde WhatsApp, o de un contacto (.vcf).
// Todo ocurre en el dispositivo; nunca se envía a ningún servidor.
import { normalizePhone } from './whatsapp.js';

const CITIES = {
  'Medellín': 'Antioquia', 'Envigado': 'Antioquia', 'Itagüí': 'Antioquia', 'Bello': 'Antioquia', 'Sabaneta': 'Antioquia', 'La Estrella': 'Antioquia', 'Caldas': 'Antioquia', 'Copacabana': 'Antioquia', 'Girardota': 'Antioquia', 'Barbosa': 'Antioquia', 'Rionegro': 'Antioquia', 'Marinilla': 'Antioquia', 'La Ceja': 'Antioquia', 'El Retiro': 'Antioquia', 'Guarne': 'Antioquia', 'El Carmen de Viboral': 'Antioquia', 'Santa Fe de Antioquia': 'Antioquia', 'Apartadó': 'Antioquia', 'Turbo': 'Antioquia', 'Caucasia': 'Antioquia', 'Yarumal': 'Antioquia', 'Andes': 'Antioquia', 'Sonsón': 'Antioquia',
  'Bogotá': 'Cundinamarca', 'Soacha': 'Cundinamarca', 'Chía': 'Cundinamarca', 'Zipaquirá': 'Cundinamarca', 'Facatativá': 'Cundinamarca', 'Fusagasugá': 'Cundinamarca', 'Girardot': 'Cundinamarca',
  'Cali': 'Valle del Cauca', 'Palmira': 'Valle del Cauca', 'Buenaventura': 'Valle del Cauca', 'Tuluá': 'Valle del Cauca', 'Cartago': 'Valle del Cauca', 'Buga': 'Valle del Cauca', 'Jamundí': 'Valle del Cauca',
  'Barranquilla': 'Atlántico', 'Soledad': 'Atlántico', 'Cartagena': 'Bolívar', 'Santa Marta': 'Magdalena', 'Montería': 'Córdoba', 'Sincelejo': 'Sucre', 'Valledupar': 'Cesar', 'Riohacha': 'La Guajira',
  'Bucaramanga': 'Santander', 'Floridablanca': 'Santander', 'Girón': 'Santander', 'Piedecuesta': 'Santander', 'Barrancabermeja': 'Santander', 'Cúcuta': 'Norte de Santander',
  'Pereira': 'Risaralda', 'Dosquebradas': 'Risaralda', 'Manizales': 'Caldas', 'Armenia': 'Quindío', 'Ibagué': 'Tolima', 'Neiva': 'Huila', 'Villavicencio': 'Meta', 'Tunja': 'Boyacá', 'Duitama': 'Boyacá', 'Sogamoso': 'Boyacá', 'Popayán': 'Cauca', 'Pasto': 'Nariño', 'Quibdó': 'Chocó', 'Yopal': 'Casanare', 'Florencia': 'Caquetá',
};
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const CITY_KEYS = Object.keys(CITIES).sort((a, b) => b.length - a.length).map((c) => [c, fold(c)]);
const GREETING = /^(hola|buen[oa]s?|buenas (tardes|noches|dias)|gracias|ok|listo|dale|si|no|claro|perfecto|saludos|como (esta|estas)|que mas)\b/;
const ADDRESS = /\b(calle|cll?|cl|carrera|cra|crr|cr|kr|kra|avenida|av|avda|diagonal|dg|diag|transversal|tv|trans|circular|circ|autopista|km|kilometro|manzana|mz|vereda|barrio)\.?\s*\d/i;
const BIZ = /\b(pi[nñ]ateria|variedades|distribuidora|distribuciones|miscelanea|almacen|tienda|papeleria|piqueteria|cacharreria|deposito|supermercado|minimercado|autoservicio|fiestas|eventos|decoraciones|detalles|panaderia|reposteria|granero|comercializadora|s\.?a\.?s\.?|ltda)\b/;

/** Teléfono en formato legible: +57 300 123 4567. */
export function prettyPhone(raw) {
  const d = normalizePhone(raw);
  if (!d) return '';
  if (d.length === 12 && d.startsWith('57')) return `+57 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return `+${d}`;
}

function findPhones(text) {
  const out = [];
  const push = (raw) => {
    const n = normalizePhone(raw);
    if (n && !out.includes(n)) out.push(n);
  };
  for (const m of text.matchAll(/wa\.me\/(\d{8,15})/gi)) push(`+${m[1]}`);
  for (const m of text.matchAll(/waid=(\d{8,15})/gi)) push(`+${m[1]}`);
  for (const m of text.matchAll(/(\+?\d[\d\s().-]{6,18}\d)/g)) {
    const raw = m[1];
    const digits = raw.replace(/\D/g, '');
    // Evita confundir NIT, fechas o valores con teléfonos.
    if (digits.length < 10 || digits.length > 13) continue;
    if (/^\d{1,3}(\.\d{3})+$/.test(raw.trim())) continue;
    push(raw);
  }
  return out;
}

const labelled = (lines, re) => {
  for (const l of lines) {
    const m = l.match(re);
    if (m && m[1].trim()) return m[1].trim();
  }
  return '';
};

// Ciudades que también son nombres o palabras comunes: solo cuentan en la dirección o con "Ciudad:".
const AMBIGUOUS = new Set(['Soledad', 'Florencia', 'Caldas', 'Andes', 'Turbo', 'Armenia', 'Barbosa', 'Girón', 'Buga', 'Chía']);
function cityIn(text, strict = false) {
  const f = fold(text);
  for (const [c, k] of CITY_KEYS) if ((!strict || !AMBIGUOUS.has(c)) && new RegExp(`(^|[^a-z])${k}([^a-z]|$)`).test(f)) return c;
  return '';
}

const cleanName = (s) => String(s || '').replace(/^[~\s*_-]+|[\s*_:.,-]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
const titleCase = (s) => (s === s.toUpperCase() || s === s.toLowerCase() ? s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : s);

/**
 * Lee un texto libre: un mensaje de WhatsApp, varios mensajes copiados
 * ("[16/10/26, 9:12 a. m.] Juan Pérez: …"), un contacto pegado o una ficha.
 */
export function parseContactText(input) {
  const text = String(input || '').replace(/\r/g, '').trim();
  if (!text) return {};
  if (/BEGIN:VCARD/i.test(text)) return parseVCard(text);
  const out = {};
  // Mensajes copiados de WhatsApp: "[fecha, hora] Nombre: mensaje" o "fecha, hora - Nombre: mensaje".
  const senders = [];
  const body = [];
  for (const raw of text.split('\n')) {
    const m = raw.match(/^\[?\d{1,2}\/\d{1,2}\/\d{2,4},?\s+[\d:]+\s*(?:[ap]\.?\s?m\.?)?\]?\s*-?\s*([^:]{2,60}):\s*(.*)$/i);
    if (m) {
      senders.push(cleanName(m[1]));
      body.push(m[2]);
    } else body.push(raw);
  }
  const lines = body.map((l) => l.replace(/^[\s•*·>-]+/, '').trim()).filter(Boolean);
  const all = lines.join('\n');

  const phones = findPhones(all + '\n' + senders.join('\n'));
  if (phones[0]) out.phone = prettyPhone(`+${phones[0]}`);
  if (phones[1]) out.whatsapp = prettyPhone(`+${phones[1]}`);
  const email = all.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (email) out.email = email[0].toLowerCase();
  const nit = all.match(/\b(?:nit|c\.?\s?c\.?|c[eé]dula|documento|identificaci[oó]n)\s*(?:n[o°º.]*)?\s*[:#.]?\s*([\d][\d.\s-]{4,16}\d)/i);
  if (nit) out.taxId = nit[1].replace(/\s/g, '');

  const addrLabel = labelled(lines, /^(?:direcci[oó]n|dir|domicilio|entrega(?:r)? en|enviar a)\s*[:.-]\s*(.+)$/i);
  const addrLine = addrLabel || lines.find((l) => ADDRESS.test(l)) || '';
  if (addrLine) out.address = addrLine.replace(/^(?:direcci[oó]n|dir)\s*[:.-]\s*/i, '').slice(0, 160);

  const cityLabel = labelled(lines, /^(?:ciudad|municipio)\s*[:.-]\s*(.+)$/i);
  out.city = cityLabel ? titleCase(cleanName(cityLabel.split(/[,-]/)[0])) : cityIn(addrLine) || cityIn(all, true);
  if (out.city && CITIES[out.city]) out.department = CITIES[out.city];
  else {
    const dep = labelled(lines, /^(?:departamento|depto)\s*[:.-]\s*(.+)$/i);
    if (dep) out.department = titleCase(cleanName(dep));
  }
  const barrio = labelled(lines, /^barrio\s*[:.-]?\s*(.+)$/i);
  if (barrio && out.address && !fold(out.address).includes(fold(barrio))) out.address += ` · Barrio ${barrio}`;
  if (!out.city) delete out.city;

  const bizLabel = labelled(lines, /^(?:negocio|tienda|almac[eé]n|local|empresa|raz[oó]n social|establecimiento)\s*[:.-]\s*(.+)$/i);
  let person = cleanName(labelled(lines, /^(?:nombre(?: completo)?|cliente|contacto|se[nñ]or(?:a)?|sr\.?|sra\.?)\s*[:.-]\s*(.+)$/i));
  if (!person) person = senders.find((s) => !/^\+?[\d\s()-]+$/.test(s)) || '';
  if (!person) {
    // Primera línea que parezca un nombre (no saludo, no número, no dirección).
    const cand = lines.find((l) => {
      const f = fold(l);
      return /\p{L}{2}/u.test(l) && l.length <= 50 && !GREETING.test(f) && !ADDRESS.test(l) && !/\d{4,}/.test(l) && !/@/.test(l) && !/[?¿!¡]/.test(l) && !/^(direcci|ciudad|nit|correo|tel|cel|whats|barrio|departamento)/.test(f) && l.split(/\s+/).length <= 6;
    });
    if (cand) person = cleanName(cand.replace(/^(soy|me llamo|mi nombre es)\s+/i, ''));
  } else person = person.replace(/^(soy|me llamo|mi nombre es)\s+/i, '');
  const bizLine = bizLabel || lines.find((l) => BIZ.test(fold(l)) && l.length <= 60 && !ADDRESS.test(l)) || '';
  const biz = cleanName(bizLine.replace(/^(?:negocio|tienda|local|empresa)\s*[:.-]\s*/i, ''));
  if (biz && fold(biz) !== fold(person)) {
    out.tradeName = titleCase(biz);
    if (person) out.contactName = titleCase(person);
  } else if (person) out.tradeName = titleCase(person);
  return out;
}

/** Contacto compartido como archivo .vcf (WhatsApp, Contactos de Android). */
export function parseVCard(input) {
  const text = String(input || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); // líneas plegadas
  const card = text.split(/END:VCARD/i)[0];
  const out = {};
  const get = (key) => card.split('\n').filter((l) => new RegExp(`^(?:item\\d+\\.)?${key}[;:]`, 'i').test(l)).map((l) => ({ params: l.slice(0, l.indexOf(':')), value: decodeV(l.slice(l.indexOf(':') + 1), l) }));
  const fn = get('FN')[0]?.value;
  const n = get('N')[0]?.value;
  const name = cleanName(fn || (n ? n.split(';').slice(0, 2).reverse().join(' ') : ''));
  const org = cleanName(get('ORG')[0]?.value.split(';')[0]);
  if (org && fold(org) !== fold(name)) {
    out.tradeName = org;
    if (name) out.contactName = name;
  } else if (name) out.tradeName = name;
  const tels = get('TEL').map((t) => {
    const wa = t.params.match(/waid=(\d+)/i);
    return { n: normalizePhone(wa ? `+${wa[1]}` : t.value), cell: /cell|mobile|waid/i.test(t.params) };
  }).filter((t) => t.n);
  tels.sort((a, b) => Number(b.cell) - Number(a.cell));
  const uniq = [...new Set(tels.map((t) => t.n))];
  if (uniq[0]) out.phone = prettyPhone(`+${uniq[0]}`);
  if (uniq[1]) out.whatsapp = prettyPhone(`+${uniq[1]}`);
  const email = get('EMAIL')[0]?.value;
  if (email) out.email = email.trim().toLowerCase();
  const adr = get('ADR')[0]?.value;
  if (adr) {
    const [, , street, city, region] = adr.split(';');
    if (street) out.address = street.replace(/\\n/g, ' ').trim();
    if (city) out.city = city.trim();
    if (region) out.department = region.trim();
    if (out.city && !out.department && CITIES[out.city]) out.department = CITIES[out.city];
  }
  const note = get('NOTE')[0]?.value;
  if (note) {
    const extra = parseContactText(note);
    for (const k of ['taxId', 'address', 'city', 'department']) if (!out[k] && extra[k]) out[k] = extra[k];
  }
  return out;
}

function decodeV(value, line) {
  let v = value;
  if (/ENCODING=QUOTED-PRINTABLE/i.test(line)) {
    try {
      const bytes = [];
      v = v.replace(/=\n/g, '');
      for (let i = 0; i < v.length; i++) {
        if (v[i] === '=' && /^[0-9A-F]{2}$/i.test(v.slice(i + 1, i + 3))) {
          bytes.push(parseInt(v.slice(i + 1, i + 3), 16));
          i += 2;
        } else bytes.push(v.charCodeAt(i));
      }
      v = new TextDecoder().decode(new Uint8Array(bytes));
    } catch {
      /* se deja tal cual */
    }
  }
  return v.replace(/\\,/g, ',').replace(/\\;/g, ';').trim();
}

/** Contacto elegido con el selector de contactos de Android (Contact Picker API). */
export function fromPickedContact(c) {
  const out = {};
  const name = cleanName(c?.name?.[0]);
  if (name) out.tradeName = name;
  const tels = [...new Set((c?.tel || []).map((t) => normalizePhone(t)).filter(Boolean))];
  if (tels[0]) out.phone = prettyPhone(`+${tels[0]}`);
  if (tels[1]) out.whatsapp = prettyPhone(`+${tels[1]}`);
  if (c?.email?.[0]) out.email = String(c.email[0]).toLowerCase();
  const a = c?.address?.[0];
  if (a) {
    const street = (a.addressLine || []).join(' ').trim();
    if (street) out.address = street;
    if (a.city) out.city = a.city;
    if (a.region) out.department = a.region;
  }
  return out;
}
