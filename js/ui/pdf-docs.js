// Documentos PDF: cotización / pedido / venta con logo, e informe mensual de
// comisiones. Se generan en el teléfono y se comparten con la hoja nativa
// (WhatsApp, correo, Drive…) o se descargan.
import { formatDate, formatDateTime, periodLabel, periodOf } from '../core/dates.js';
import { formatCOP, formatPct } from '../core/money.js';
import { dataUrlToBytes, PdfDoc, wrapText } from '../core/pdf.js';
import { commissionSummary, thresholdStatus } from '../domain/commissions.js';
import { computeLine } from '../domain/documents.js';
import { periodMetrics } from '../domain/metrics.js';
import { COMMISSION_STATUSES } from '../domain/schema.js';

const W = 595.28;
const H = 841.89;
const M = 40;
const INK = '#1e293b';
const MUTED = '#64748b';
const BRAND = '#1f4d3e';
const GOLD = '#b8893b';
const IVORY = '#f6efdd';
const LINE = '#e2d9c5';
const SOFT = '#f4efe3';
const money = formatCOP;
const num = (v) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(v);

function header(pdf, s, companyId, title, rightLines) {
  const pf = s.settings.companyProfiles?.[companyId] || {};
  const co = s.companies[companyId];
  const bandH = 104;
  // Franja de marca: verde bosque con filete dorado.
  pdf.rect(0, 0, W, bandH, { fill: BRAND });
  pdf.rect(0, bandH, W, 3, { fill: GOLD });
  let x = M;
  if (pf.logo?.dataUrl) {
    const maxH = 58;
    const maxW = 110;
    const r = Math.min(maxW / pf.logo.w, maxH / pf.logo.h);
    const lw = pf.logo.w * r;
    const lh = pf.logo.h * r;
    pdf.rect(M - 6, 22, lw + 12, lh + 12, { fill: '#ffffff' });
    pdf.image(dataUrlToBytes(pf.logo.dataUrl), pf.logo.w, pf.logo.h, M, 28, lw, lh);
    x = M + lw + 20;
  }
  pdf.text(pf.legalName || co.name, x, 44, { size: 16, bold: true, color: IVORY });
  const info = [pf.nit ? `NIT ${pf.nit}` : '', [pf.address, pf.city].filter(Boolean).join(' · '), [pf.phone, pf.email].filter(Boolean).join(' · ')].filter(Boolean);
  info.forEach((t, i) => pdf.text(t, x, 60 + i * 12, { size: 8.5, color: '#d9d2bf' }));
  pdf.text(title, W - M, 44, { size: 15, bold: true, color: '#e3c27a', align: 'right' });
  rightLines.forEach((t, i) => pdf.text(t, W - M, 60 + i * 12, { size: 8.5, color: '#d9d2bf', align: 'right' }));
  return bandH + 24;
}

function footers(pdf, s, companyId, label) {
  const n = pdf.pages.length;
  pdf.pages.forEach((_, i) => {
    pdf.page = pdf.pages[i];
    pdf.line(M, H - 34, W - M, H - 34, { color: GOLD, width: 0.8 });
    pdf.text(`${s.companies[companyId].name} · ${label}`, M, H - 22, { size: 8, color: MUTED });
    pdf.text(`Página ${i + 1} de ${n}`, W - M, H - 22, { size: 8, color: MUTED, align: 'right' });
  });
}

/** Tabla genérica con salto de página y encabezado repetido. */
export function table(pdf, y, cols, rows, { onNewPage } = {}) {
  const drawHead = () => {
    pdf.rect(M, y, W - 2 * M, 18, { fill: SOFT });
    let x = M;
    for (const c of cols) {
      pdf.text(c.label, c.align === 'right' ? x + c.w - 4 : x + 4, y + 12, { size: 8, bold: true, color: MUTED, align: c.align === 'right' ? 'right' : 'left' });
      x += c.w;
    }
    y += 22;
  };
  drawHead();
  for (const r of rows) {
    const cells = cols.map((c, i) => {
      const v = r[i];
      const main = typeof v === 'object' && v !== null ? v.text : String(v ?? '');
      const sub = typeof v === 'object' && v !== null ? v.sub : '';
      return { main: wrapText(main, c.w - 8, 9, c.bold), sub: sub ? wrapText(sub, c.w - 8, 7.5) : [] };
    });
    const h = Math.max(...cells.map((c) => c.main.length * 11 + c.sub.length * 9)) + 6;
    if (y + h > H - 60) {
      pdf.addPage();
      y = onNewPage ? onNewPage() : M;
      drawHead();
    }
    let x = M;
    cells.forEach((cell, i) => {
      const c = cols[i];
      const ax = c.align === 'right' ? x + c.w - 4 : x + 4;
      cell.main.forEach((t, k) => pdf.text(t, ax, y + 9 + k * 11, { size: 9, color: INK, bold: c.bold, align: c.align === 'right' ? 'right' : 'left' }));
      cell.sub.forEach((t, k) => pdf.text(t, ax, y + 9 + cell.main.length * 11 + k * 9, { size: 7.5, color: MUTED, align: c.align === 'right' ? 'right' : 'left' }));
      x += c.w;
    });
    y += h;
    pdf.line(M, y - 2, W - M, y - 2, { color: LINE, width: 0.4 });
  }
  return y + 6;
}

export function ensure(pdf, y, needed) {
  if (y + needed > H - 60) {
    pdf.addPage();
    return M;
  }
  return y;
}

export function documentPdf(s, doc) {
  const pdf = new PdfDoc();
  const client = s.clients.find((c) => c.id === doc.clientId) || {};
  const pf = s.settings.companyProfiles?.[doc.companyId] || {};
  const title = { cotizacion: 'COTIZACIÓN', pedido: 'PEDIDO', venta: 'VENTA' }[doc.kind];
  const right = [`N.º ${doc.number}${doc.externalRef ? ` · Ref. ${doc.externalRef}` : ''}`, `Fecha: ${formatDate(doc.date)}`];
  if (doc.kind === 'cotizacion' && doc.validUntil) right.push(`Válida hasta: ${formatDate(doc.validUntil)}`);
  if (doc.kind !== 'cotizacion' && doc.dueDate) right.push(`Vence: ${formatDate(doc.dueDate)}`);
  let y = header(pdf, s, doc.companyId, title, right);

  // Cliente
  const cl = [['Cliente', client.legalName || client.tradeName], ['NIT / CC', client.taxId], ['Contacto', client.contactName], ['Teléfono', client.phone || client.whatsapp], ['Ciudad', [client.city, client.address].filter(Boolean).join(' · ')]].filter(([, v]) => v);
  pdf.rect(M, y, W - 2 * M, 14 + cl.length * 13, { fill: SOFT });
  cl.forEach(([k, v], i) => {
    pdf.text(`${k}:`, M + 10, y + 16 + i * 13, { size: 9, bold: true, color: MUTED });
    pdf.text(v, M + 80, y + 16 + i * 13, { size: 9, color: INK });
  });
  y += 26 + cl.length * 13;

  const hasKg = doc.lines.some((l) => l.contentQty);
  const cols = [
    { label: 'Producto', w: hasKg ? 170 : 220, bold: true },
    { label: 'Cant.', w: 45, align: 'right' },
    { label: 'Precio unit.', w: 75, align: 'right' },
    ...(hasKg ? [{ label: 'Por kg / und', w: 60, align: 'right' }] : []),
    { label: 'Desc.', w: 35, align: 'right' },
    { label: 'IVA', w: 35, align: 'right' },
    { label: 'Subtotal', w: hasKg ? 95 : 105, align: 'right' },
  ];
  const rows = doc.lines.map((l) => {
    const c = computeLine(l);
    const unit = (l.presentation || '').split(' x ')[0].toLowerCase();
    const per = l.contentQty ? `${money(Math.round((l.unitPrice * (1 - (l.discountPct || 0) / 100)) / l.contentQty))}/${l.contentUnit === 'und' ? 'und' : 'kg'}` : '';
    return [
      { text: l.presentation ? l.description.replace(` · ${l.presentation}`, '') : l.description, sub: [l.presentation, l.contentQty ? `${num(l.qty * l.contentQty)} ${l.contentUnit === 'und' ? 'und' : 'kg'} en total` : ''].filter(Boolean).join(' · ') },
      { text: num(l.qty), sub: unit ? `${unit}${l.qty === 1 ? '' : 's'}` : '' },
      money(l.unitPrice),
      ...(hasKg ? [per] : []),
      l.discountPct ? `${num(l.discountPct)} %` : '—',
      `${num(l.ivaPct)} %`,
      money(c.net),
    ];
  });
  y = table(pdf, y, cols, rows);

  // Totales
  y = ensure(pdf, y, 100);
  const tx = W - M - 220;
  const tot = [['Subtotal', doc.totals.gross], ['Descuentos', -doc.totals.discount], ['Valor antes de IVA', doc.totals.net], ['IVA', doc.totals.iva]].filter(([k, v]) => k !== 'Descuentos' || v);
  tot.forEach(([k, v], i) => {
    pdf.text(k, tx, y + 10 + i * 14, { size: 9.5, color: MUTED });
    pdf.text(v < 0 ? `− ${money(-v)}` : money(v), W - M, y + 10 + i * 14, { size: 9.5, color: INK, align: 'right' });
  });
  y += tot.length * 14 + 6;
  pdf.rect(tx - 8, y, W - M - tx + 8, 26, { fill: BRAND });
  pdf.rect(tx - 8, y + 26, W - M - tx + 8, 2, { fill: GOLD });
  pdf.text('TOTAL', tx, y + 17, { size: 11, bold: true, color: '#e3c27a' });
  pdf.text(money(doc.totals.total), W - M - 6, y + 17, { size: 13, bold: true, color: IVORY, align: 'right' });
  y += 40;

  // Condiciones
  const cond = [];
  if (doc.kind !== 'cotizacion') cond.push(`Condición de pago: ${doc.term.days === 0 ? 'contado' : `${doc.term.days} días`}.`);
  if (doc.kind === 'cotizacion' && doc.validUntil) cond.push(`Cotización válida hasta el ${formatDate(doc.validUntil)}.`);
  cond.push('Precios en pesos colombianos (COP). El IVA se discrimina por producto.');
  if (pf.quoteTerms) cond.push(pf.quoteTerms);
  if (doc.notes) cond.push(`Observaciones: ${doc.notes}`);
  y = ensure(pdf, y, 40);
  pdf.text('Condiciones', M, y, { size: 10, bold: true, color: INK });
  y += 14;
  for (const c of cond) {
    for (const t of wrapText(c, W - 2 * M, 9)) {
      y = ensure(pdf, y, 12);
      pdf.text(t, M, y, { size: 9, color: MUTED });
      y += 12;
    }
    y += 2;
  }
  if (s.settings.sellerName) {
    y = ensure(pdf, y, 40);
    pdf.text(`Atentamente, ${s.settings.sellerName}`, M, y + 16, { size: 10, color: INK });
  }
  footers(pdf, s, doc.companyId, `${title.charAt(0)}${title.slice(1).toLowerCase()} ${doc.number}`);
  return pdf.output({ title: `${title} ${doc.number}` });
}

export function commissionReportPdf(s, companyId, period) {
  const pdf = new PdfDoc();
  const co = s.companies[companyId];
  let y = header(pdf, s, companyId, 'INFORME DE COMISIONES', [periodLabel(period).replace(/^./, (c) => c.toUpperCase()), `Generado: ${formatDateTime(new Date().toISOString())}`, s.settings.sellerName ? `Vendedor: ${s.settings.sellerName}` : ''].filter(Boolean));
  const m = periodMetrics(s, companyId, period);
  const sum = commissionSummary(s, { companyId, period });
  const block = (title, rows) => {
    y = ensure(pdf, y, 20 + rows.length * 14);
    pdf.text(title, M, y, { size: 11, bold: true, color: BRAND });
    y += 8;
    rows.forEach(([k, v, bold], i) => {
      if (i % 2 === 0) pdf.rect(M, y + i * 14, W - 2 * M, 14, { fill: SOFT });
      pdf.text(k, M + 8, y + 10 + i * 14, { size: 9.5, color: INK, bold });
      pdf.text(v, W - M - 8, y + 10 + i * 14, { size: 9.5, color: INK, bold, align: 'right' });
    });
    y += rows.length * 14 + 18;
  };
  block('Resultados del mes', [
    ['Ventas (total con IVA)', money(m.salesTotal)],
    ['Ventas antes de IVA', money(m.salesNet)],
    ['Número de ventas', String(m.salesCount)],
    ['Recaudado en el mes', money(m.collected)],
  ]);
  const th = thresholdStatus(s, companyId, period);
  if (th) {
    block('Umbral mensual', [
      ['Umbral', `${money(th.threshold)} (${th.thresholdBase === 'total' ? 'con IVA' : 'antes de IVA'})`],
      ['Ventas acumuladas', money(th.cumulative)],
      ['Estado', th.unlocked ? `Desbloqueado el ${formatDateTime(th.unlock.unlockedAt)} (${th.unlock.triggerNumber})` : `Bloqueado · faltan ${money(th.missing)}`],
      ['Ventas elegibles (base)', money(th.eligibleSalesNet)],
    ]);
  }
  block('Comisiones del mes', [
    ['Comisión por venta', money(sum.sale)],
    ['Comisión por cobro', money(sum.collection)],
    ...(sum.adjustments ? [['Ajustes', money(sum.adjustments)]] : []),
    ['Total generado', money(sum.generated), true],
    ['Pendiente de liquidar', money(sum.pending)],
    ['Liquidado (por pagar)', money(sum.settled)],
    ['Pagado', money(sum.paid)],
    ['Bloqueado (no se paga, informativo)', money(sum.blocked)],
    ['Reversado', money(sum.reversed)],
  ]);
  const lines = s.commissions.filter((c) => c.companyId === companyId && c.period === period).sort((a, b) => a.operationAt.localeCompare(b.operationAt));
  y = ensure(pdf, y, 60);
  pdf.text('Detalle de movimientos', M, y, { size: 11, bold: true, color: BRAND });
  y += 10;
  const cols = [
    { label: 'Fecha', w: 52 },
    { label: 'Tipo', w: 40 },
    { label: 'Documento', w: 70 },
    { label: 'Cliente', w: 113 },
    { label: 'Base', w: 72, align: 'right' },
    { label: '%', w: 38, align: 'right' },
    { label: 'Comisión', w: 65, align: 'right', bold: true },
    { label: 'Estado', w: 65 },
  ];
  const rows = lines.map((c) => [
    formatDate(c.operationAt).replace(/ de \d{4}$/, ''),
    { venta: 'Venta', cobro: 'Cobro', ajuste: 'Ajuste' }[c.type],
    s.documents.find((d) => d.id === c.documentId)?.number || '',
    s.clients.find((x) => x.id === c.clientId)?.tradeName || '',
    money(c.base),
    formatPct(c.rateBps),
    money(c.amount),
    { text: c.pendingThreshold && c.status === 'bloqueada' ? 'En espera' : COMMISSION_STATUSES[c.status], sub: c.status === 'bloqueada' ? (c.pendingThreshold ? 'se paga si llega a $70 M' : 'informativa') : '' },
  ]);
  y = rows.length ? table(pdf, y, cols, rows) : (pdf.text('Sin movimientos en el periodo.', M, y + 12, { size: 9, color: MUTED }), y + 24);
  const sts = s.settlements.filter((x) => x.companyId === companyId && periodOf(x.createdAt) === period);
  if (sts.length) {
    y = ensure(pdf, y, 40);
    pdf.text('Liquidaciones del mes', M, y + 6, { size: 11, bold: true, color: BRAND });
    y = table(pdf, y + 14, [{ label: 'N.º', w: 100 }, { label: 'Fecha', w: 100 }, { label: 'Líneas', w: 60, align: 'right' }, { label: 'Total', w: 120, align: 'right', bold: true }, { label: 'Estado', w: 135 }], sts.map((x) => [x.number, formatDate(x.createdAt), String(x.commissionIds.length), money(x.total), x.status === 'pagada' ? `Pagada ${formatDate(x.paidAt)}` : x.status === 'anulada' ? 'Anulada' : 'Liquidada · por pagar']));
  }
  y = ensure(pdf, y, 30);
  for (const t of wrapText(companyId === 'nogal' ? 'Política: todo o nada por mes. Si el mes llega a $70 M antes de IVA, comisiona todo lo vendido en el mes desde el primer peso; si no llega, no se paga. El cobro sigue al mes de la venta.' : 'Política: 0 % por venta; 6 % sobre lo efectivamente recaudado.', W - 2 * M, 8)) {
    pdf.text(t, M, y + 8, { size: 8, color: MUTED });
    y += 10;
  }
  footers(pdf, s, companyId, `Informe de comisiones ${period}`);
  return pdf.output({ title: `Comisiones ${co.name} ${period}` });
}

/** Comparte el PDF (WhatsApp, correo…) o lo descarga si no se puede. */
export async function sharePdf(bytes, filename, text = '') {
  const file = new File([bytes], filename, { type: 'application/pdf' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename, text });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
