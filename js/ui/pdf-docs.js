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
// Colores del diseño Tinta (3.7) con el verde del logo Crecimiento (3.9).
const INK = '#111111';
const MUTED = '#575757';
const BRAND = '#111111';
const ACCENT = '#10b981';
const MINT = '#6ee7b7';
const GREEN = '#047857';
const IVORY = '#ffffff';
const LINE = '#e4e4e1';
const SOFT = '#f2f2ef';
const BAND_TXT = '#c9c9c4';
const money = formatCOP;
const num = (v) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(v);

function header(pdf, s, companyId, title, rightLines) {
  const pf = s.settings.companyProfiles?.[companyId] || {};
  const co = s.companies[companyId];
  const bandH = 104;
  // Franja de marca: tinta con filete verde.
  pdf.rect(0, 0, W, bandH, { fill: BRAND });
  pdf.rect(0, bandH, W, 3, { fill: ACCENT });
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
  info.forEach((t, i) => pdf.text(t, x, 60 + i * 12, { size: 8.5, color: BAND_TXT }));
  pdf.text(title, W - M, 44, { size: 15, bold: true, color: MINT, align: 'right' });
  rightLines.forEach((t, i) => pdf.text(t, W - M, 60 + i * 12, { size: 8.5, color: BAND_TXT, align: 'right' }));
  return bandH + 24;
}

function footers(pdf, s, companyId, label) {
  const n = pdf.pages.length;
  pdf.pages.forEach((_, i) => {
    pdf.page = pdf.pages[i];
    pdf.line(M, H - 34, W - M, H - 34, { color: ACCENT, width: 0.8 });
    pdf.text(`${s.companies[companyId].name} · ${label}`, M, H - 22, { size: 8, color: MUTED });
    pdf.text(`Página ${i + 1} de ${n}`, W - M, H - 22, { size: 8, color: MUTED, align: 'right' });
  });
}

/** Tabla genérica con salto de página y encabezado repetido. */
export function table(pdf, y, cols, rows, { onNewPage, left = M, right = W - M } = {}) {
  const drawHead = () => {
    pdf.rect(left, y, right - left, 18, { fill: SOFT });
    let x = left;
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
    let x = left;
    cells.forEach((cell, i) => {
      const c = cols[i];
      const ax = c.align === 'right' ? x + c.w - 4 : x + 4;
      cell.main.forEach((t, k) => pdf.text(t, ax, y + 9 + k * 11, { size: 9, color: INK, bold: c.bold, align: c.align === 'right' ? 'right' : 'left' }));
      cell.sub.forEach((t, k) => pdf.text(t, ax, y + 9 + cell.main.length * 11 + k * 9, { size: 7.5, color: MUTED, align: c.align === 'right' ? 'right' : 'left' }));
      x += c.w;
    });
    y += h;
    pdf.line(left, y - 2, right, y - 2, { color: LINE, width: 0.4 });
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

// Cotización / pedido / venta, estilo "Banda lateral" (3.10): una banda en
// tinta a la izquierda con la empresa, el cliente y las fechas; a la derecha
// el título, los productos y el total en una pastilla verde.
const BAND = 168;
const CX = BAND + 30; // borde izquierdo del contenido
const CR = W - 34; // borde derecho del contenido
const BX = 24; // margen interno de la banda
const BW = BAND - 2 * BX;

/** Dibuja la banda en la página actual. En la primera lleva todo; en las demás, solo la marca. */
function sideBand(pdf, s, doc, client, { full }) {
  const pf = s.settings.companyProfiles?.[doc.companyId] || {};
  const co = s.companies[doc.companyId];
  pdf.rect(0, 0, BAND, H, { fill: BRAND });
  let y = 44;
  if (pf.logo?.dataUrl) {
    const r = Math.min(BW / pf.logo.w, 56 / pf.logo.h);
    const lw = pf.logo.w * r;
    const lh = pf.logo.h * r;
    pdf.roundRect(BX - 6, y - 6, lw + 12, lh + 12, 8, { fill: '#ffffff' });
    pdf.image(dataUrlToBytes(pf.logo.dataUrl), pf.logo.w, pf.logo.h, BX, y, lw, lh);
    y += lh + 26;
  }
  for (const t of wrapText(pf.legalName || co.name, BW, 12.5, true)) {
    pdf.text(t, BX, y, { size: 12.5, bold: true, color: IVORY });
    y += 15;
  }
  if (!full) return;
  const info = [pf.nit ? `NIT ${pf.nit}` : '', pf.address, pf.city, pf.phone, pf.email].filter(Boolean);
  for (const line of info) for (const t of wrapText(line, BW, 8)) {
    pdf.text(t, BX, y + 1, { size: 8, color: BAND_TXT });
    y += 11;
  }
  const block = (label, lines, { strong = false } = {}) => {
    y += 16;
    pdf.text(label, BX, y, { size: 7, bold: true, color: MINT });
    y += 13;
    lines.filter(Boolean).forEach((line, i) => {
      const bold = strong && i === 0;
      for (const t of wrapText(line, BW, bold ? 10 : 8.5, bold)) {
        pdf.text(t, BX, y, { size: bold ? 10 : 8.5, bold, color: bold ? IVORY : BAND_TXT });
        y += bold ? 13 : 11;
      }
    });
  };
  y += 8;
  pdf.line(BX, y, BAND - BX, y, { color: '#2e2e2c', width: 0.6 });
  block('CLIENTE', [client.legalName || client.tradeName, client.taxId ? `NIT / CC ${client.taxId}` : '', client.contactName, client.phone || client.whatsapp, [client.city, client.address].filter(Boolean).join(' · ')], { strong: true });
  block('FECHA', [formatDate(doc.date)]);
  if (doc.kind === 'cotizacion' && doc.validUntil) block('VÁLIDA HASTA', [formatDate(doc.validUntil)]);
  if (doc.kind !== 'cotizacion' && doc.dueDate) block('VENCE', [formatDate(doc.dueDate)]);
  if (doc.kind !== 'cotizacion') block('PAGO', [doc.term?.days === 0 ? 'De contado' : `${doc.term?.days} días`]);
  if (s.settings.sellerName) block('ASESOR', [s.settings.sellerName]);
}

export function documentPdf(s, doc) {
  const pdf = new PdfDoc();
  const client = s.clients.find((c) => c.id === doc.clientId) || {};
  const pf = s.settings.companyProfiles?.[doc.companyId] || {};
  const name = { cotizacion: 'Cotización', pedido: 'Pedido', venta: 'Venta' }[doc.kind];
  const number = `${doc.number}${doc.externalRef ? ` · Ref. ${doc.externalRef}` : ''}`;
  sideBand(pdf, s, doc, client, { full: true });

  // Título y número
  pdf.text(name, CX, 66, { size: 28, bold: true, color: INK });
  pdf.text(doc.number, CR, 66, { size: 9.5, color: MUTED, align: 'right' });
  if (doc.externalRef) pdf.text(`Ref. ${doc.externalRef}`, CR, 78, { size: 8.5, color: MUTED, align: 'right' });
  let y = 104;

  // Productos: el descuento va en la línea de detalle para dejar espacio a lo importante.
  const hasKg = doc.lines.some((l) => l.contentQty);
  const cw = CR - CX;
  const cols = hasKg
    ? [{ label: 'Producto', w: cw - 244, bold: true }, { label: 'Cant.', w: 38, align: 'right' }, { label: 'Precio', w: 60, align: 'right' }, { label: 'Por kg/und', w: 52, align: 'right' }, { label: 'IVA', w: 28, align: 'right' }, { label: 'Subtotal', w: 66, align: 'right' }]
    : [{ label: 'Producto', w: cw - 214, bold: true }, { label: 'Cant.', w: 44, align: 'right' }, { label: 'Precio', w: 70, align: 'right' }, { label: 'IVA', w: 30, align: 'right' }, { label: 'Subtotal', w: 70, align: 'right' }];
  const rows = doc.lines.map((l) => {
    const c = computeLine(l);
    const unit = (l.presentation || '').split(' x ')[0].toLowerCase();
    const per = l.contentQty ? `${money(Math.round((l.unitPrice * (1 - (l.discountPct || 0) / 100)) / l.contentQty))}` : '';
    const detail = [l.presentation, l.contentQty ? `${num(l.qty * l.contentQty)} ${l.contentUnit === 'und' ? 'und' : 'kg'} en total` : '', l.discountPct ? `desc. ${num(l.discountPct)} %` : ''].filter(Boolean).join(' · ');
    return [
      { text: l.presentation ? l.description.replace(` · ${l.presentation}`, '') : l.description, sub: detail },
      { text: num(l.qty), sub: unit ? `${unit}${l.qty === 1 ? '' : 's'}` : '' },
      money(l.unitPrice),
      ...(hasKg ? [per] : []),
      `${num(l.ivaPct)} %`,
      money(c.net),
    ];
  });
  const newPage = () => {
    sideBand(pdf, s, doc, client, { full: false });
    pdf.text(`${name} ${doc.number} (continuación)`, CX, 52, { size: 10, bold: true, color: INK });
    return 70;
  };
  y = table(pdf, y, cols, rows, { left: CX, right: CR, onNewPage: newPage });

  // Totales
  if (y + 120 > H - 60) {
    pdf.addPage();
    y = newPage();
  }
  const tw = 200;
  const tx = CR - tw;
  const tot = [['Subtotal', doc.totals.gross], ['Descuentos', -doc.totals.discount], ['Antes de IVA', doc.totals.net], ['IVA', doc.totals.iva]].filter(([k, v]) => k !== 'Descuentos' || v);
  y += 6;
  tot.forEach(([k, v], i) => {
    pdf.text(k, tx, y + 10 + i * 15, { size: 9.5, color: MUTED });
    pdf.text(v < 0 ? `− ${money(-v)}` : money(v), CR, y + 10 + i * 15, { size: 9.5, color: INK, align: 'right' });
  });
  y += tot.length * 15 + 8;
  pdf.roundRect(tx - 10, y, tw + 10, 36, 9, { fill: GREEN });
  pdf.text('Total', tx + 2, y + 23, { size: 12, bold: true, color: IVORY });
  pdf.text(money(doc.totals.total), CR - 12, y + 23, { size: 14, bold: true, color: IVORY, align: 'right' });
  y += 62;

  // Condiciones
  const cond = [];
  if (doc.kind === 'cotizacion' && doc.validUntil) cond.push(`Cotización válida hasta el ${formatDate(doc.validUntil)}.`);
  if (doc.kind !== 'cotizacion') cond.push(`Condición de pago: ${doc.term.days === 0 ? 'contado' : `${doc.term.days} días`}.`);
  cond.push('Precios en pesos colombianos (COP). El IVA se discrimina por producto.');
  if (pf.quoteTerms) cond.push(pf.quoteTerms);
  if (doc.notes) cond.push(`Observaciones: ${doc.notes}`);
  const ensureC = (need) => {
    if (y + need > H - 60) {
      pdf.addPage();
      y = newPage();
    }
  };
  ensureC(40);
  pdf.text('Condiciones', CX, y, { size: 10, bold: true, color: INK });
  y += 15;
  for (const c of cond) {
    for (const t of wrapText(c, cw, 8.8)) {
      ensureC(12);
      pdf.text(t, CX, y, { size: 8.8, color: MUTED });
      y += 12;
    }
    y += 3;
  }
  if (s.settings.sellerName) {
    ensureC(40);
    pdf.text(`Atentamente, ${s.settings.sellerName}`, CX, y + 18, { size: 10, color: INK });
  }

  // Pie de página dentro del área de contenido
  const n = pdf.pages.length;
  pdf.pages.forEach((_, i) => {
    pdf.page = pdf.pages[i];
    pdf.line(CX, H - 34, CR, H - 34, { color: LINE, width: 0.6 });
    pdf.text(`${name} ${number}`, CX, H - 22, { size: 8, color: MUTED });
    pdf.text(`Página ${i + 1} de ${n}`, CR, H - 22, { size: 8, color: MUTED, align: 'right' });
  });
  return pdf.output({ title: `${name.toUpperCase()} ${doc.number}` });
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
