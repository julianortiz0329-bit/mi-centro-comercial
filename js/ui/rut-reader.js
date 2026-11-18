// Lee el RUT (PDF de la DIAN) en el celular con pdf.js y devuelve los datos del
// cliente. La librería se carga solo la primera vez que se usa.
import { looksLikeRut, rutFields, rutToClient } from '../domain/rut-parse.js';

let lib = null;
async function pdfjs() {
  if (!lib) {
    lib = await import('../../vendor/pdfjs/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return lib;
}

/** Devuelve { client, fields, isRut, text } a partir de un archivo PDF. */
export async function readRutPdf(file) {
  const { getDocument } = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await getDocument({ data, isEvalSupported: false }).promise;
  try {
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items
      .filter((it) => typeof it.str === 'string')
      .map((it) => {
        const [, , c, d, e, f] = it.transform;
        const h = it.height || Math.hypot(c, d) || 6;
        return { str: it.str, x: e, y: vp.height - f - h, w: it.width, h };
      });
    // Texto plano por líneas (para el respaldo y para reconocer el formulario).
    const lines = [];
    for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) < 3) last.parts.push(it.str);
      else lines.push({ y: it.y, parts: [it.str] });
    }
    const text = lines.map((l) => l.parts.join(' ')).join('\n');
    const fields = rutFields(items);
    return { client: rutToClient(fields, text), fields, isRut: looksLikeRut(text), text, empty: !items.length };
  } finally {
    doc.destroy();
  }
}

/** Texto de todas las páginas de un PDF, una línea por renglón (para el informe de Nogal). */
export async function pdfLines(file) {
  const { getDocument } = await pdfjs();
  const doc = await getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = tc.items.filter((it) => typeof it.str === 'string' && it.str.trim()).map((it) => ({ str: it.str.trim(), x: it.transform[4], y: vp.height - it.transform[5] }));
      const lines = [];
      for (const it of items.sort((a, b) => a.y - b.y || a.x - b.x)) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.y - it.y) < 3) last.parts.push(it);
        else lines.push({ y: it.y, parts: [it] });
      }
      for (const l of lines) out.push(l.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(' '));
    }
    return out.join('\n');
  } finally {
    doc.destroy();
  }
}
