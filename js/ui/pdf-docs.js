// Utilidades de PDF compartidas: tablas con salto de página y compartir.
import { wrapText } from '../core/pdf.js';

const W = 595.28;
const H = 841.89;
const M = 40;
const INK = '#1e293b';
const MUTED = '#64748b';
const LINE = '#e2d9c5';
const SOFT = '#f4efe3';

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
