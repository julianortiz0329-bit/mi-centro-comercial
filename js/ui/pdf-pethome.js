// Cuenta de cobro y recibo de pago de Alegría Pet Home (PDF en el celular).
import { formatDate } from '../core/dates.js';
import { formatCOP } from '../core/money.js';
import { dataUrlToBytes, PdfDoc, wrapText } from '../core/pdf.js';
import { amountInWords, PH_METHODS, saleTotals } from '../domain/pethome.js';
import { ensure, table } from './pdf-docs.js';

const W = 595.28;
const H = 841.89;
const M = 40;
const INK = '#1f2433';
const MUTED = '#667085';
const BAND = '#26324a'; // azul noche
const ACCENT = '#f2a65a'; // naranja suave (alegría)
const LIGHT = '#fdf3e7';
const SOFT = '#f6f1ea';
const money = formatCOP;
const num = (v) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(v);
const longDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });

function header(pdf, pf, title, right) {
  const bandH = 104;
  pdf.rect(0, 0, W, bandH, { fill: BAND });
  pdf.rect(0, bandH, W, 4, { fill: ACCENT });
  let x = M;
  if (pf.logo?.dataUrl) {
    const r = Math.min(110 / pf.logo.w, 62 / pf.logo.h);
    const lw = pf.logo.w * r;
    const lh = pf.logo.h * r;
    pdf.rect(M - 6, 20, lw + 12, lh + 12, { fill: '#ffffff' });
    pdf.image(dataUrlToBytes(pf.logo.dataUrl), pf.logo.w, pf.logo.h, M, 26, lw, lh);
    x = M + lw + 20;
  }
  pdf.text(pf.brand || 'Alegría Pet Home', x, 46, { size: 17, bold: true, color: '#ffffff' });
  [[pf.web, pf.email].filter(Boolean).join(' · '), [pf.phone, pf.city].filter(Boolean).join(' · ')].filter(Boolean).forEach((t, i) => pdf.text(t, x, 62 + i * 12, { size: 8.5, color: '#cfd6e4' }));
  pdf.text(title, W - M, 46, { size: 15, bold: true, color: ACCENT, align: 'right' });
  right.forEach((t, i) => pdf.text(t, W - M, 62 + i * 12, { size: 8.5, color: '#cfd6e4', align: 'right' }));
  return bandH + 28;
}

function footer(pdf, pf, label) {
  const n = pdf.pages.length;
  pdf.pages.forEach((_, i) => {
    pdf.page = pdf.pages[i];
    pdf.line(M, H - 34, W - M, H - 34, { color: ACCENT, width: 0.8 });
    pdf.text(`${pf.brand || 'Alegría Pet Home'} · ${label}`, M, H - 22, { size: 8, color: MUTED });
    pdf.text(`Página ${i + 1} de ${n}`, W - M, H - 22, { size: 8, color: MUTED, align: 'right' });
  });
}

function paragraph(pdf, y, text, { size = 10, bold = false, color = INK, width = W - 2 * M } = {}) {
  for (const t of wrapText(text, width, size, bold)) {
    y = ensure(pdf, y, size + 4);
    pdf.text(t, M, y, { size, bold, color });
    y += size + 4;
  }
  return y;
}

function signature(pdf, y, pf) {
  y = ensure(pdf, y, 80);
  y += 46;
  pdf.line(M, y, M + 220, y, { color: INK, width: 0.8 });
  pdf.text(pf.issuerName || 'Nombre del titular', M, y + 14, { size: 10, bold: true, color: INK });
  if (pf.issuerId) pdf.text(`C.C. / NIT ${pf.issuerId}`, M, y + 27, { size: 9, color: MUTED });
  pdf.text(pf.brand || 'Alegría Pet Home', M, y + (pf.issuerId ? 40 : 27), { size: 9, color: MUTED });
  return y + 50;
}

/** Cuenta de cobro de una venta: detalle, abonos y saldo pendiente. */
export function chargeAccountPdf(s, sale) {
  const pf = s.pethome.profile;
  const t = saleTotals(sale);
  const pdf = new PdfDoc();
  let y = header(pdf, pf, 'CUENTA DE COBRO', [`N.º ${sale.number}`, `Fecha: ${formatDate(sale.date)}`, sale.dueDate ? `Pagar antes del: ${formatDate(sale.dueDate)}` : ''].filter(Boolean));
  pdf.text(`${pf.city || 'Medellín'}, ${longDate(sale.date)}`, M, y, { size: 10, color: MUTED });
  y += 24;
  // Cliente
  pdf.rect(M, y - 4, W - 2 * M, sale.customerId || sale.customerPhone ? 46 : 32, { fill: SOFT });
  pdf.text(sale.customerName, M + 12, y + 12, { size: 12, bold: true, color: INK });
  const cinfo = [sale.customerId ? `C.C. / NIT ${sale.customerId}` : '', sale.customerPhone ? `Tel. ${sale.customerPhone}` : ''].filter(Boolean).join(' · ');
  if (cinfo) pdf.text(cinfo, M + 12, y + 28, { size: 9, color: MUTED });
  y += (cinfo ? 46 : 32) + 18;
  pdf.text('DEBE A:', M, y, { size: 9, bold: true, color: MUTED });
  y += 15;
  pdf.text(pf.issuerName || pf.brand || 'Alegría Pet Home', M, y, { size: 12, bold: true, color: INK });
  if (pf.issuerId) pdf.text(`C.C. / NIT ${pf.issuerId}`, M + 260, y, { size: 10, color: INK });
  y += 22;
  pdf.text('LA SUMA DE:', M, y, { size: 9, bold: true, color: MUTED });
  y += 15;
  y = paragraph(pdf, y, `${amountInWords(t.balance)} (${money(t.balance)})`, { size: 11, bold: true });
  y += 4;
  y = paragraph(pdf, y, `Por concepto de: compra de productos de ${pf.brand || 'Alegría Pet Home'} según el siguiente detalle.`, { size: 9.5, color: MUTED });
  y += 8;

  const cols = [
    { label: 'Producto', w: 265, bold: true },
    { label: 'Cant.', w: 50, align: 'right' },
    { label: 'Precio unit.', w: 90, align: 'right' },
    { label: 'Subtotal', w: 110, align: 'right' },
  ];
  y = table(pdf, y, cols, sale.lines.map((l) => [l.description, num(l.qty), money(l.unitPrice), money(Math.round(l.unitPrice * l.qty))]));

  y = ensure(pdf, y, 140);
  const tx = W - M - 230;
  const rows = [['Subtotal', t.subtotal], sale.discount ? ['Descuento', -sale.discount] : null, sale.shipping ? ['Domicilio', sale.shipping] : null, ['Total de la compra', t.total]].filter(Boolean);
  const pays = sale.payments.filter((p) => p.status === 'activo');
  for (const p of pays) rows.push([`Abono ${formatDate(p.date)} (${PH_METHODS[p.method] || p.method})`, -p.amount]);
  rows.forEach(([k, v], i) => {
    pdf.text(k, tx, y + 10 + i * 14, { size: 9.5, color: MUTED });
    pdf.text(v < 0 ? `− ${money(-v)}` : money(v), W - M, y + 10 + i * 14, { size: 9.5, color: INK, align: 'right' });
  });
  y += rows.length * 14 + 8;
  pdf.rect(tx - 10, y, W - M - tx + 10, 28, { fill: BAND });
  pdf.rect(tx - 10, y + 28, W - M - tx + 10, 2, { fill: ACCENT });
  pdf.text('SALDO A PAGAR', tx, y + 18, { size: 10.5, bold: true, color: ACCENT });
  pdf.text(money(t.balance), W - M - 6, y + 19, { size: 13, bold: true, color: '#ffffff', align: 'right' });
  y += 46;

  if (pf.payInfo) {
    y = ensure(pdf, y, 50);
    pdf.rect(M, y, W - 2 * M, 24 + wrapText(pf.payInfo, W - 2 * M - 24, 9.5).length * 13, { fill: LIGHT });
    pdf.text('Puedes pagar a:', M + 12, y + 14, { size: 9, bold: true, color: INK });
    wrapText(pf.payInfo, W - 2 * M - 24, 9.5).forEach((l, i) => pdf.text(l, M + 12, y + 28 + i * 13, { size: 9.5, color: INK }));
    y += 36 + wrapText(pf.payInfo, W - 2 * M - 24, 9.5).length * 13;
  }
  if (sale.notes) y = paragraph(pdf, y + 4, `Observaciones: ${sale.notes}`, { size: 9, color: MUTED });
  if (pf.taxNote) y = paragraph(pdf, y + 4, pf.taxNote, { size: 8.5, color: MUTED });
  signature(pdf, y, pf);
  footer(pdf, pf, `Cuenta de cobro ${sale.number}`);
  return pdf.output({ title: `Cuenta de cobro ${sale.number}` });
}

/** Recibo de un abono (o del pago total). */
export function paymentReceiptPdf(s, sale, payment) {
  const pf = s.pethome.profile;
  const t = saleTotals(sale);
  const pdf = new PdfDoc();
  let y = header(pdf, pf, 'RECIBO DE PAGO', [`N.º ${payment.number}`, `Fecha: ${formatDate(payment.date)}`, `Cuenta ${sale.number}`]);
  pdf.text(`${pf.city || 'Medellín'}, ${longDate(payment.date)}`, M, y, { size: 10, color: MUTED });
  y += 28;
  y = paragraph(pdf, y, `Recibimos de ${sale.customerName}${sale.customerId ? `, C.C. / NIT ${sale.customerId},` : ''} la suma de ${amountInWords(payment.amount).replace(/^./, (c) => c.toLowerCase())} (${money(payment.amount)}), por concepto de ${t.balance === 0 ? 'pago total' : 'abono'} de la cuenta ${sale.number} por compra de productos de ${pf.brand || 'Alegría Pet Home'}.`, { size: 11 });
  y += 10;
  const rows = [['Medio de pago', PH_METHODS[payment.method] || payment.method], ['Total de la compra', money(t.total)], ['Total abonado a la fecha', money(t.paid)], ['Saldo pendiente', money(t.balance)]];
  if (payment.note) rows.splice(1, 0, ['Referencia', payment.note]);
  pdf.rect(M, y, W - 2 * M, 12 + rows.length * 18, { fill: SOFT });
  rows.forEach(([k, v], i) => {
    pdf.text(k, M + 12, y + 18 + i * 18, { size: 10, color: MUTED });
    pdf.text(v, W - M - 12, y + 18 + i * 18, { size: 10, bold: k === 'Saldo pendiente', color: INK, align: 'right' });
  });
  y += 24 + rows.length * 18;
  if (t.balance === 0) {
    pdf.rect(M, y, W - 2 * M, 30, { fill: '#e6f4ea' });
    pdf.text('Cuenta a paz y salvo. ¡Gracias por tu compra!', M + 12, y + 19, { size: 11, bold: true, color: '#2e7650' });
    y += 44;
  }
  y = table(pdf, y + 6, [{ label: 'Producto', w: 315, bold: true }, { label: 'Cant.', w: 60, align: 'right' }, { label: 'Subtotal', w: 140, align: 'right' }], sale.lines.map((l) => [l.description, num(l.qty), money(Math.round(l.unitPrice * l.qty))]));
  if (pf.taxNote) y = paragraph(pdf, y + 4, pf.taxNote, { size: 8.5, color: MUTED });
  signature(pdf, y, pf);
  footer(pdf, pf, `Recibo ${payment.number}`);
  return pdf.output({ title: `Recibo ${payment.number}` });
}
