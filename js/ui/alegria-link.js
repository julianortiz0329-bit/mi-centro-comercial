// Alegría Pet Home ahora vive en su propia app (el libro de socios, en la
// nube). Aquí solo queda: tu parte de la utilidad de cada mes (un cuadrito en
// Hoy) y el envío, una sola vez, de lo que tenías de Alegría en este celular.
import { periodLabel } from '../core/dates.js';
import { esc, money } from './dom.js';
import { icon } from './icons.js';

const CLOUD = { url: 'https://zqjdqrcvnkripgbkagcu.supabase.co', key: 'sb_publishable_TzeQkZxUk39BJDEBZRHWsg_HILlKlEc' };
const CFG = 'mcc_alegria';
export const DEFAULT_LIBRO_URL = 'https://julianortiz0329-bit.github.io/alegria-libro/';

export function alegriaConfig() {
  try {
    return { url: DEFAULT_LIBRO_URL, ...JSON.parse(localStorage.getItem(CFG) || '{}') };
  } catch {
    return { url: DEFAULT_LIBRO_URL };
  }
}
function saveConfig(patch) {
  const c = { ...alegriaConfig(), ...patch };
  try {
    localStorage.setItem(CFG, JSON.stringify(c));
  } catch {
    /* opcional */
  }
  return c;
}

async function rpc(fn, args) {
  let res;
  try {
    res = await fetch(`${CLOUD.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: CLOUD.key, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  } catch {
    throw new Error('Sin conexión a internet.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.code === '28000' ? 'La clave de socio no es válida.' : body?.message || `Error ${res.status}`);
  return body;
}

/** Guarda la clave tras comprobarla y trae tu parte. */
export async function connectAlegria(clave) {
  const k = String(clave || '').trim();
  const r = await rpc('alegria_mi_parte', { p_clave: k });
  saveConfig({ clave: k, cache: r, at: Date.now() });
  return r;
}
export function disconnectAlegria() {
  const { url } = alegriaConfig();
  try {
    localStorage.setItem(CFG, JSON.stringify({ url }));
  } catch {
    /* nada */
  }
}

let refreshing = null;
/** Refresca tu parte si la copia tiene más de 10 minutos. Devuelve true si cambió. */
export function refreshAlegria(force = false) {
  const c = alegriaConfig();
  if (!c.clave || refreshing || (!force && c.at && Date.now() - c.at < 600000)) return Promise.resolve(false);
  refreshing = rpc('alegria_mi_parte', { p_clave: c.clave })
    .then((r) => {
      const changed = JSON.stringify(r.meses) !== JSON.stringify(c.cache?.meses) || r.saldo !== c.cache?.saldo;
      saveConfig({ cache: r, at: Date.now(), error: '' });
      return changed;
    })
    .catch((e) => {
      saveConfig({ error: e.message, at: Date.now() });
      return false;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

/** Cuadrito de Hoy: tu parte del mes, el anterior y lo que el negocio te debe. */
export function alegriaCard() {
  const c = alegriaConfig();
  if (!c.clave) {
    return `<a class="ale-card ale-off" href="#/alegria">${icon('star', { size: 18 })}<span><b>Alegría Pet Home</b><small>Conecta tu clave de socio para ver aquí tu parte de cada mes.</small></span>${icon('arrowRight', { size: 16 })}</a>`;
  }
  const meses = c.cache?.meses || [];
  const cur = meses.find((m) => m.mes === thisMonth());
  const prev = meses.find((m) => m.mes < thisMonth());
  const v = cur?.parte ?? 0;
  return `<a class="ale-card" href="#/alegria"><span class="ale-paw" aria-hidden="true">🐾</span><span class="ale-main"><small>Alegría · tu parte de ${esc(periodLabel(thisMonth()).split(' ')[0])}</small><b class="${v < 0 ? 'danger' : ''}">${v < 0 ? 'Pérdida ' : ''}${money(Math.abs(v))}</b>
    <small>${cur ? `Utilidad del negocio ${money(cur.utilidad)}` : 'Aún sin ventas este mes'}${prev ? ` · ${esc(periodLabel(prev.mes).split(' ')[0])}: ${money(prev.parte)}` : ''}</small></span>
    ${typeof c.cache?.saldo === 'number' ? `<span class="ale-side"><small>${c.cache.saldo >= 0 ? 'Te deben' : 'Debes'}</small><b>${money(Math.abs(c.cache.saldo))}</b></span>` : ''}</a>
    ${c.error ? `<p class="muted small">No se pudo actualizar (${esc(c.error)}). Se muestra lo último que llegó.</p>` : ''}`;
}

/** Pantalla Alegría: conexión, tu parte por mes y enlace al libro. */
export function renderAlegria(s) {
  const c = alegriaConfig();
  const local = s.pethome || { sales: [], products: [], suppliers: [], purchases: [], notes: [] };
  const hasLocal = local.sales.length || local.purchases.length || local.suppliers.length || local.products.some((p) => Number.isSafeInteger(p.cost));
  const meses = c.cache?.meses || [];
  return `<div class="page-head"><div><p class="eyebrow">Tu emprendimiento</p><h1>Alegría Pet Home</h1></div><a class="btn btn-primary" href="${esc(c.url)}" target="_blank" rel="noopener">${icon('arrowRight', { size: 18 })} Abrir el libro</a></div>
  <div class="notice info">Alegría ahora tiene su propia app, el <b>libro de socios</b>, que comparten tú y tu socio. Aquí solo ves <b>tu parte</b>: tus clientes de El Puntazo y Frutos del Nogal no se comparten con nadie.</div>
  ${c.clave ? `<section class="panel"><div class="panel-head"><h2>Tu parte por mes</h2><button class="btn btn-plain btn-small" data-act="alegria-refresh">${icon('repeat', { size: 16 })} Actualizar</button></div>
      ${typeof c.cache?.saldo === 'number' ? `<p>${c.cache.saldo >= 0 ? 'El negocio te debe' : 'Le debes al negocio'} <b>${money(Math.abs(c.cache.saldo))}</b> <small class="muted">(aportes + gastos que pagaste + tu utilidad − retiros)</small></p>` : ''}
      ${meses.length ? `<div class="table-wrap"><table><thead><tr><th>Mes</th><th>Ventas</th><th>Utilidad</th><th>Tu parte (${Number(c.cache.porcentaje)} %)</th></tr></thead><tbody>${meses.map((m) => `<tr><td>${esc(periodLabel(m.mes))}</td><td>${money(m.ventas)}</td><td>${money(m.utilidad)}</td><td><b class="${m.parte < 0 ? 'danger' : ''}">${money(m.parte)}</b></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Todavía no hay meses con movimientos en el libro.</p>'}
      <p class="muted small">Conectado como <b>${esc(c.cache?.socio || '')}</b>${c.at ? ` · actualizado ${new Date(c.at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}` : ''}. <button class="link" data-act="alegria-disconnect">Desconectar</button></p></section>`
    : `<form class="panel" data-form="alegria-connect"><h2>Conecta tu clave de socio</h2><p class="muted small">Es la misma clave con la que entras al libro. Solo se usa para leer tu parte.</p>
      <div class="row-gap"><input name="clave" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ALEGRIA-XXXXX-XXXXX-XXXXX-XXXXX" class="mono-input"><button class="btn btn-primary" type="submit">Conectar</button></div></form>`}
  ${hasLocal ? `<section class="panel"><h2>Tus datos anteriores de Alegría</h2><p class="muted small">En este celular quedaron ${local.sales.length} venta(s), ${local.purchases.length} compra(s), ${local.suppliers.length} proveedor(es) y los costos de tus productos. ${c.migratedAt ? `<b>Ya se enviaron al libro</b> el ${new Date(c.migratedAt).toLocaleDateString('es-CO')}.` : 'Envíalos al libro una sola vez para que tu socio también los vea (no se duplican).'}</p>
      ${c.clave ? `<button class="btn ${c.migratedAt ? 'btn-plain' : 'btn-primary'}" data-act="alegria-migrate">${c.migratedAt ? 'Volver a enviar (no duplica)' : 'Enviar mis datos al libro'}</button>` : '<p class="muted small">Primero conecta tu clave.</p>'}</section>` : ''}
  <form class="panel" data-form="alegria-url"><h2>Dirección del libro</h2><div class="row-gap"><input name="url" value="${esc(c.url)}" class="mono-input" inputmode="url"><button class="btn btn-plain btn-small" type="submit">Guardar</button></div><small class="muted">Donde publicaste la app del libro (GitHub Pages).</small></form>`;
}

export function saveLibroUrl(url) {
  const u = String(url || '').trim();
  if (!/^https:\/\//.test(u)) throw new Error('Escribe una dirección que empiece por https://');
  saveConfig({ url: u.endsWith('/') ? u : `${u}/` });
}

const fold = (v) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Envía al libro lo que había de Alegría en este celular, sin duplicar: los
 * productos y proveedores que ya existan allá (mismo id de Shopify o nombre)
 * se reutilizan y solo se completa lo que falte (p. ej. el costo).
 */
export async function migrateToLibro(s) {
  const { clave } = alegriaConfig();
  if (!clave) throw new Error('Primero conecta tu clave de socio.');
  const ph = s.pethome;
  const remote = await rpc('alegria_leer', { p_clave: clave, p_desde: null });
  const live = (remote.registros || []).filter((r) => !r.borrado);
  const byTipo = (t) => live.filter((r) => r.tipo === t);
  const ids = new Set(live.map((r) => r.id));
  const changes = [];
  const prodMap = {};
  for (const p of ph.products) {
    const hit = byTipo('producto').find((r) => (p.shopifyId && r.datos.shopifyId === p.shopifyId) || fold(r.datos.name) === fold(p.name));
    if (hit) {
      prodMap[p.id] = hit.id;
      if (Number.isSafeInteger(p.cost) && !Number.isSafeInteger(hit.datos.cost)) changes.push({ id: hit.id, tipo: 'producto', datos: { ...hit.datos, cost: p.cost, costHistory: p.costHistory || [], supplierId: hit.datos.supplierId || p.supplierId || null } });
    } else changes.push({ id: p.id, tipo: 'producto', datos: p });
  }
  const supMap = {};
  for (const x of ph.suppliers) {
    const hit = byTipo('proveedor').find((r) => fold(r.datos.name) === fold(x.name));
    if (hit) supMap[x.id] = hit.id;
    else changes.push({ id: x.id, tipo: 'proveedor', datos: x });
  }
  const mapLines = (lines) => lines.map((l) => ({ ...l, productId: l.productId ? prodMap[l.productId] || l.productId : null }));
  for (const c of changes) if (c.tipo === 'producto' && c.datos.supplierId) c.datos = { ...c.datos, supplierId: supMap[c.datos.supplierId] || c.datos.supplierId };
  for (const x of ph.sales) if (!ids.has(x.id)) changes.push({ id: x.id, tipo: 'venta', datos: { ...x, lines: mapLines(x.lines) } });
  for (const x of ph.purchases) if (!ids.has(x.id)) changes.push({ id: x.id, tipo: 'compra', datos: { ...x, supplierId: supMap[x.supplierId] || x.supplierId, lines: mapLines(x.lines) } });
  for (const x of ph.notes) if (!ids.has(x.id)) changes.push({ id: x.id, tipo: 'nota', datos: { ...x, supplierId: supMap[x.supplierId] || x.supplierId } });
  // Perfil: se completan los campos vacíos del libro con los de aquí.
  const rp = live.find((r) => r.id === 'perfil')?.datos || {};
  const merged = { ...ph.profile };
  for (const [k, v] of Object.entries(rp)) if (v !== '' && v !== null && v !== undefined) merged[k] = v;
  if (JSON.stringify(merged) !== JSON.stringify(rp)) changes.push({ id: 'perfil', tipo: 'perfil', datos: merged });
  if (!live.some((r) => r.id === 'ajustes')) changes.push({ id: 'ajustes', tipo: 'ajustes', datos: { settings: ph.settings, catalogLoadedAt: ph.catalogLoadedAt || null } });
  for (let i = 0; i < changes.length; i += 200) await rpc('alegria_guardar', { p_clave: clave, p_cambios: changes.slice(i, i + 200) });
  saveConfig({ migratedAt: Date.now() });
  return { sent: changes.length, sales: changes.filter((c) => c.tipo === 'venta').length, products: changes.filter((c) => c.tipo === 'producto').length };
}
