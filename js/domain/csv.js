// CSV compatible con Excel en español (separador ';' al exportar, detecta ','
// o ';' al importar). Los montos se exportan como enteros sin formato.
import { parsePesos } from '../core/money.js';

export function csvEscape(v) {
  const s = String(v ?? '');
  // Evita inyección de fórmulas al abrir en Excel.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s;
  return /[";\n\r,]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCSV(headers, rows) {
  return [headers.map(csvEscape).join(';'), ...rows.map((r) => r.map(csvEscape).join(';'))].join('\r\n');
}

export function parseCSV(text) {
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/).find((x) => x.trim()) || '';
  const delimiter = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quote && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quote = !quote;
    } else if (ch === delimiter && !quote) {
      row.push(cell.trim());
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quote) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell.trim());
    if (row.some((x) => x !== '')) rows.push(row);
  }
  return rows;
}

export function keyify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

export function headerIndex(headers, aliases) {
  const keys = headers.map(keyify);
  for (const a of aliases) {
    const i = keys.indexOf(a);
    if (i >= 0) return i;
  }
  return -1;
}

export const CLIENT_COLUMNS = {
  tradeName: ['nombrecomercial', 'nombre', 'cliente', 'nombrecliente'],
  legalName: ['razonsocial'],
  taxId: ['nit', 'identificacion', 'cedula', 'documento'],
  contactName: ['contacto', 'contactoprincipal'],
  phone: ['telefono', 'celular', 'phone'],
  whatsapp: ['whatsapp'],
  email: ['correo', 'email', 'correoelectronico'],
  department: ['departamento'],
  city: ['ciudad', 'municipio'],
  address: ['direccion'],
  category: ['categoria', 'actividad', 'tipo'],
  empresa: ['empresa', 'negocio'],
  notes: ['observaciones', 'notas'],
  termDays: ['plazo', 'plazodias', 'condicionpago'],
};

/** Convierte filas CSV en datos de cliente listos para createClient. */
export function rowsToClients(rows, defaultCompany) {
  const [headers, ...data] = rows;
  const ix = Object.fromEntries(Object.entries(CLIENT_COLUMNS).map(([k, a]) => [k, headerIndex(headers, a)]));
  if (ix.tradeName < 0) throw new Error('No se encontró la columna "nombre" o "cliente".');
  return data.map((r, n) => {
    const v = (k) => (ix[k] >= 0 ? String(r[ix[k]] ?? '').trim() : '');
    const emp = keyify(v('empresa'));
    const companyIds = [];
    if (emp.includes('puntazo')) companyIds.push('puntazo');
    if (emp.includes('nogal')) companyIds.push('nogal');
    if (!companyIds.length) companyIds.push(defaultCompany);
    const term = v('termDays') ? (keyify(v('termDays')).includes('contado') ? 0 : parseInt(v('termDays'), 10)) : null;
    const terms = {};
    if (Number.isInteger(term)) for (const co of companyIds) terms[co] = { termDays: term, creditLimit: 0 };
    return { row: n + 2, data: { tradeName: v('tradeName'), legalName: v('legalName'), taxId: v('taxId'), contactName: v('contactName'), phone: v('phone'), whatsapp: v('whatsapp'), email: v('email'), department: v('department'), city: v('city'), address: v('address'), category: v('category'), notes: v('notes'), companyIds, terms } };
  });
}

export const PRODUCT_COLUMNS = { code: ['codigo', 'referencia', 'sku'], name: ['nombre', 'producto', 'descripcion'], presentation: ['presentacion'], category: ['categoria'], price: ['precio', 'precioantesdeiva', 'valor'], ivaPct: ['iva', 'ivapct', 'tarifaiva'] };

export function rowsToProducts(rows, companyId) {
  const [headers, ...data] = rows;
  const ix = Object.fromEntries(Object.entries(PRODUCT_COLUMNS).map(([k, a]) => [k, headerIndex(headers, a)]));
  if (ix.name < 0 || ix.price < 0) throw new Error('Se requieren las columnas "nombre" y "precio".');
  return data.map((r, n) => {
    const v = (k) => (ix[k] >= 0 ? String(r[ix[k]] ?? '').trim() : '');
    return { row: n + 2, data: { companyId, code: v('code'), name: v('name'), presentation: v('presentation'), category: v('category'), price: parsePesos(v('price')), ivaPct: v('ivaPct') ? Number(v('ivaPct').replace('%', '').replace(',', '.')) : 0 } };
  });
}
