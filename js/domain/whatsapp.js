// WhatsApp y contacto directo. Solo se construyen enlaces wa.me con el texto
// editable: no hay envíos automáticos ni masivos.
import { formatDate } from '../core/dates.js';
import { formatCOP } from '../core/money.js';

/** Normaliza un teléfono colombiano a formato internacional sin '+'.
 *  Celular 3xx (10 dígitos) o fijo 60x (10 dígitos) → 57 + número.
 *  Si ya trae 57 (12 dígitos) no se duplica. Otros países: si se escribió con
 *  '+' o '00' se respeta el número tal cual. Devuelve '' si no es válido. */
export function normalizePhone(raw, defaultCountry = '57') {
  const str = String(raw || '').trim();
  if (!str) return '';
  const hasPlus = str.startsWith('+') || str.startsWith('00');
  let d = str.replace(/\D/g, '');
  if (str.startsWith('00')) d = d.slice(2);
  if (hasPlus) return d.length >= 8 && d.length <= 15 ? d : '';
  if (d.length === 12 && d.startsWith('57') && /^57[36]/.test(d)) return d;
  if (d.length === 10 && /^[36]/.test(d)) return defaultCountry + d;
  if (d.length === 7) return ''; // fijo antiguo sin indicativo: no es WhatsApp
  if (d.length >= 11 && d.length <= 15) return d;
  return '';
}

export function waLink(phone, text) {
  const p = normalizePhone(phone);
  if (!p) return '';
  return `https://wa.me/${p}?text=${encodeURIComponent(text || '')}`;
}

export function telLink(phone) {
  const p = normalizePhone(phone);
  return p ? `tel:+${p}` : '';
}

export function smsLink(phone, text) {
  const p = normalizePhone(phone);
  return p ? `sms:+${p}?body=${encodeURIComponent(text || '')}` : '';
}

/** Reemplaza {variables} con datos reales. Las que no tengan dato quedan
 *  marcadas como [variable] para que el usuario las complete antes de enviar. */
export function fillTemplate(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null || v === '' ? `[${k}]` : String(v);
  });
}

export function templateVars(s, { client, companyId, doc = null, balance = null, payment = null, promise = null, dispatch = null }) {
  return {
    contacto: client?.contactName || client?.tradeName || '',
    cliente: client?.tradeName || '',
    empresa: s.companies[companyId]?.name || '',
    vendedor: s.settings.sellerName || '',
    documento: doc?.number || '',
    total: doc ? formatCOP(doc.totals.total) : '',
    saldo: balance !== null ? formatCOP(balance) : '',
    vencimiento: doc?.dueDate ? formatDate(doc.dueDate) : '',
    valor_pago: payment ? formatCOP(payment.amount) : '',
    valor_promesa: promise ? formatCOP(promise.amount) : '',
    fecha_promesa: promise ? formatDate(promise.date) : '',
    guia: dispatch ? [dispatch.carrier, dispatch.guide].filter(Boolean).join(' ') : '',
  };
}
