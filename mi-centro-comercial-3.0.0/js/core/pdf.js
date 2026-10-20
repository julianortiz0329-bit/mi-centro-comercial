// Generador de PDF mínimo, sin dependencias: texto (Helvetica estándar, con
// tildes y ñ vía WinAnsi), líneas, rectángulos e imágenes JPEG. Coordenadas en
// puntos con origen ARRIBA a la izquierda (se convierten internamente).
import { HELVETICA_WIDTHS } from './pdf-metrics.js';

const CP1252 = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };

/** Convierte texto a códigos WinAnsi (0–255). Lo no representable → '?'. */
export function toWinAnsi(str) {
  const out = [];
  for (const ch of String(str ?? '')) {
    const c = ch.codePointAt(0);
    if (c === 0x202f || c === 0x2009 || c === 0x2007) out.push(0x20);
    else if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) out.push(c);
    else if (CP1252[ch]) out.push(CP1252[ch]);
    else if (c === 0x0a || c === 0x09) out.push(0x20);
    else if (c === 0x2212) out.push(0x2d); // signo menos → guion
    else if (c === 0x2264 || c === 0x2265) out.push(c === 0x2264 ? 0x3c : 0x3e);
    else out.push(0x3f);
  }
  return out;
}

export function textWidth(str, size, bold = false) {
  const w = HELVETICA_WIDTHS[bold ? 'bold' : 'regular'];
  let t = 0;
  for (const c of toWinAnsi(str)) t += w[c] || 556;
  return (t * size) / 1000;
}

/** Parte un texto en líneas que caben en maxWidth. */
export function wrapText(str, maxWidth, size, bold = false) {
  const lines = [];
  for (const para of String(str ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (textWidth(tryLine, size, bold) <= maxWidth || !line) {
        // Palabra más ancha que la columna: se corta por caracteres.
        if (!line && textWidth(word, size, bold) > maxWidth) {
          let chunk = '';
          for (const ch of word) {
            if (textWidth(chunk + ch, size, bold) > maxWidth && chunk) {
              lines.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else line = tryLine;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => v.toFixed(3)).join(' ');
}

const esc = (codes) => codes.map((c) => (c === 0x28 || c === 0x29 || c === 0x5c ? `\\${String.fromCharCode(c)}` : c < 0x20 || c > 0x7e ? `\\${c.toString(8).padStart(3, '0')}` : String.fromCharCode(c))).join('');
const f = (n) => (Math.round(n * 100) / 100).toString();

export class PdfDoc {
  constructor({ width = 595.28, height = 841.89 } = {}) {
    this.width = width;
    this.height = height;
    this.pages = [];
    this.images = [];
    this.addPage();
  }

  addPage() {
    this.page = [];
    this.pages.push(this.page);
    return this;
  }

  text(str, x, y, { size = 10, bold = false, color = '#111111', align = 'left' } = {}) {
    const codes = toWinAnsi(str);
    const w = textWidth(str, size, bold);
    const tx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.page.push(`BT /${bold ? 'F2' : 'F1'} ${f(size)} Tf ${hexToRgb(color)} rg ${f(tx)} ${f(this.height - y)} Td (${esc(codes)}) Tj ET`);
    return w;
  }

  rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 0.6 } = {}) {
    const ops = [];
    if (fill) ops.push(`${hexToRgb(fill)} rg`);
    if (stroke) ops.push(`${hexToRgb(stroke)} RG ${f(lineWidth)} w`);
    ops.push(`${f(x)} ${f(this.height - y - h)} ${f(w)} ${f(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    this.page.push(ops.join(' '));
  }

  line(x1, y1, x2, y2, { color = '#cccccc', width = 0.6 } = {}) {
    this.page.push(`${hexToRgb(color)} RG ${f(width)} w ${f(x1)} ${f(this.height - y1)} m ${f(x2)} ${f(this.height - y2)} l S`);
  }

  /** Registra una imagen JPEG (bytes) y la dibuja. */
  image(jpegBytes, pxW, pxH, x, y, w, h) {
    let img = this.images.find((i) => i.bytes === jpegBytes);
    if (!img) {
      img = { name: `Im${this.images.length + 1}`, bytes: jpegBytes, pxW, pxH };
      this.images.push(img);
    }
    this.page.push(`q ${f(w)} 0 0 ${f(h)} ${f(x)} ${f(this.height - y - h)} cm /${img.name} Do Q`);
  }

  /** Devuelve el PDF como Uint8Array. */
  output({ title = '' } = {}) {
    const parts = [];
    const offsets = [];
    let len = 0;
    const enc = (s) => {
      const b = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
      return b;
    };
    const push = (bytes) => {
      parts.push(bytes);
      len += bytes.length;
    };
    const obj = (n, body) => {
      offsets[n] = len;
      if (body instanceof Uint8Array) push(body);
      else push(enc(`${n} 0 obj\n${body}\nendobj\n`));
    };
    push(enc('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'));
    const nPages = this.pages.length;
    // 1 catálogo, 2 páginas, 3–4 fuentes, 5 info, luego imágenes, luego páginas+contenidos.
    const imgBase = 6;
    const pageBase = imgBase + this.images.length;
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${this.pages.map((_, i) => `${pageBase + i * 2} 0 R`).join(' ')}] /Count ${nPages} >>`);
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    obj(5, `<< /Title (${esc(toWinAnsi(title))}) /Producer (Mi Centro Comercial) >>`);
    this.images.forEach((img, i) => {
      const n = imgBase + i;
      offsets[n] = len;
      push(enc(`${n} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.pxW} /Height ${img.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`));
      push(img.bytes);
      push(enc('\nendstream\nendobj\n'));
    });
    const xobj = this.images.length ? ` /XObject << ${this.images.map((im, i) => `/${im.name} ${imgBase + i} 0 R`).join(' ')} >>` : '';
    this.pages.forEach((ops, i) => {
      const pn = pageBase + i * 2;
      const content = ops.join('\n');
      obj(pn, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(this.width)} ${f(this.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobj} >> /Contents ${pn + 1} 0 R >>`);
      offsets[pn + 1] = len;
      push(enc(`${pn + 1} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`));
    });
    const total = pageBase + nPages * 2;
    const xrefAt = len;
    let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let n = 1; n < total; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    push(enc(`${xref}trailer\n<< /Size ${total} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`));
    const out = new Uint8Array(len);
    let p = 0;
    for (const b of parts) {
      out.set(b, p);
      p += b.length;
    }
    return out;
  }
}

/** dataURL base64 → bytes. */
export function dataUrlToBytes(dataUrl) {
  const b64 = String(dataUrl).split(',')[1] || '';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
