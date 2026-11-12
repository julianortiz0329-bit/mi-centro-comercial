// Nota: los reemplazos usan funciones para que '$$' o "$'" del código no se
// interpreten como patrones de String.replace.
// Genera una versión de UN SOLO ARCHIVO HTML (CSS y JS incluidos) que se abre
// con doble clic, sin servidor. Uso: node tools/build-single-file.mjs salida.html
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const out = process.argv[2] || join(root, 'mi-centro-comercial.html');
const mods = new Map();
const order = [];

function load(file) {
  if (mods.has(file)) return;
  mods.set(file, null);
  const src = readFileSync(file, 'utf8');
  const imports = [];
  const body = src.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';\s*$/gm, (_, names, spec) => {
    const dep = resolve(dirname(file), spec);
    imports.push({ names: names.split(',').map((n) => n.trim()).filter(Boolean), dep });
    return '';
  });
  if (/^\s*import\s/m.test(body) || /import\(/.test(body)) throw new Error(`Import no soportado en ${file}`);
  for (const i of imports) load(i.dep);
  const exports = [];
  const code = body.replace(/^export\s+(async\s+function|function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm, (_, kw, name) => {
    exports.push(name);
    return `${kw} ${name}`;
  });
  if (/^export\s/m.test(code)) throw new Error(`Export no soportado en ${file}`);
  mods.set(file, { imports, exports, code });
  order.push(file);
}

const entry = join(root, 'js/app.js');
load(entry);
const id = (f) => `__m_${relative(root, f).replace(/[^\w]/g, '_')}`;
const js = order
  .map((f) => {
    const m = mods.get(f);
    const head = m.imports.map((i) => `const { ${i.names.join(', ')} } = ${id(i.dep)};`).join('\n');
    return `// ${relative(root, f)}\nconst ${id(f)} = (() => {\n${head}\n${m.code}\nreturn { ${m.exports.join(', ')} };\n})();`;
  })
  .join('\n\n');

const css = readFileSync(join(root, 'css/app.css'), 'utf8');
const icon = `data:image/svg+xml,${encodeURIComponent(readFileSync(join(root, 'icons/icon.svg'), 'utf8'))}`;
let html = readFileSync(join(root, 'index.html'), 'utf8');
html = html
  .replace('<link rel="manifest" href="manifest.webmanifest">\n', '')
  .replace('<link rel="apple-touch-icon" href="icons/icon-192.png">\n', '')
  .replace('href="icons/icon.svg"', () => `href="${icon}"`)
  .replace('<link rel="stylesheet" href="css/app.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="js/app.js"></script>', '')
  .replace('</body>', () => `<script type="module">\n${js.replace(/<\/script/g, '<\\/script')}\n</script>\n</body>`);
writeFileSync(out, html);
console.log(`Listo: ${out} (${(html.length / 1024).toFixed(0)} KB, ${order.length} módulos)`);
