import { formatDate, formatDateTime, localDate, periodLabel, previousPeriod } from '../core/dates.js';
import { formatPct } from '../core/money.js';
import { counts } from '../domain/backup.js';
import { goalFor, monthlySeries, periodMetrics } from '../domain/metrics.js';
import { commissionSummary } from '../domain/commissions.js';
import { receivables } from '../domain/ledger.js';
import { ACTIVE_COMPANY_IDS, APP_VERSION } from '../domain/schema.js';
import { missingCatalogItems, pricePerContent, withIva } from '../domain/products.js';
import { lostProductBuyers, productSales } from '../domain/analytics.js';
import { listSnapshots, storageEstimate, storageMode } from '../store/persistence.js';
import { getState } from '../store/store.js';
import { empty, esc, money, pill, progress, stat } from './dom.js';
import { ui } from './state.js';

const S = () => getState();

export function renderMore() {
  const items = [
    ['#/personalizar', '🎨', 'Personalizar', 'Colores, modo oscuro, tu foto, inicio y bloqueo con PIN'],
    ['#/agenda', '🗓️', 'Agenda', 'Tareas, cobros, promesas, despachos y visitas'],
    ['#/productos', '📦', 'Productos y precios', 'Catálogo independiente por empresa'],
    ['#/metas', '🎯', 'Metas', 'Metas mensuales de ventas y recaudo'],
    ['#/reportes', '📊', 'Reportes y exportación', 'Resultados por mes y CSV para Excel'],
    ['#/datos', '💾', 'Datos y copias de seguridad', 'Respaldar, restaurar, importar'],
    ['#/config', '⚙️', 'Configuración', 'Reglas, plazos, rangos de cartera, plantillas'],
    ['#/auditoria', '🧾', 'Registro de auditoría', 'Quién cambió qué y cuándo'],
    ['#/pethome', '🐾', 'Alegría Pet Home (archivo)', 'Datos conservados de la versión 1'],
    ['#/ayuda', '❓', 'Ayuda y acerca de', 'Cómo funciona y límites de esta versión'],
  ];
  return `<div class="page-head"><div><h1>Más</h1><p class="muted small">Versión ${APP_VERSION}</p></div></div><div class="menu-grid">${items.map(([h, i, t, d]) => `<a class="menu-tile" href="${h}"><span aria-hidden="true">${i}</span><div><b>${t}</b><small>${d}</small></div></a>`).join('')}</div>`;
}

export function renderProducts(params) {
  const s = S();
  const co = params.get('co') || (ui.scope !== 'todas' ? ui.scope : 'nogal');
  const cat = params.get('cat') || '';
  const all = s.products.filter((p) => p.companyId === co);
  const cats = [...new Set(all.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const missing = co === 'nogal' ? missingCatalogItems(s, 'nogal').length : 0;
  const card = (p) => {
    const per = pricePerContent(p);
    const u = p.contentUnit === 'und' ? 'und' : 'kg';
    return `<article class="card product-card ${p.active ? '' : 'inactive'}" data-prod-card data-search="${esc(`${p.name} ${p.code} ${p.category} ${p.presentation}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))}">
      <div class="card-title">${esc(p.name)} ${p.active ? '' : pill('Inactivo')} ${p.note ? '<span class="pill warn" title="Tiene una nota">⚠ Revisar</span>' : ''}</div>
      <div class="card-sub">${esc([p.presentation, p.code, p.category].filter(Boolean).join(' · '))}</div>
      <div class="price-row"><div><small>Antes de IVA</small><b>${money(p.price)}</b></div><div><small>Con IVA (${p.ivaPct} %)</small><b>${money(withIva(p.price, p.ivaPct))}</b></div>${per ? `<div><small>Por ${u}</small><b>${money(per)}</b></div>` : ''}</div>
      ${p.note ? `<p class="small muted note">${esc(p.note)}</p>` : ''}
      <div class="card-actions"><button class="btn btn-plain btn-xs" data-act="edit-product" data-id="${p.id}">Editar precio o datos</button></div>
    </article>`;
  };
  const list = all.filter((p) => !cat || p.category === cat).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return `<div class="page-head"><div><p class="eyebrow"><a href="#/mas">Más</a></p><h1>Productos y precios</h1><p class="muted small">Precios de lista de referencia. En cada cotización o venta los puedes negociar.</p></div><button class="btn btn-primary" data-act="new-product" data-co="${co}">＋ Producto</button></div>
  <div class="tabs">${ACTIVE_COMPANY_IDS.map((c) => `<a href="#/productos?co=${c}" class="${c === co ? 'active' : ''}">${s.companies[c].icon} ${esc(s.companies[c].name)} <span class="badge soft">${s.products.filter((p) => p.companyId === c).length}</span></a>`).join('')}</div>
  ${missing ? `<section class="panel highlight"><h2>🌰 Lista de precios de Frutos del Nogal</h2><p class="muted">Carga de una vez ${missing === 66 ? 'los 66 productos' : `los ${missing} productos que faltan`} de tu lista (presentación, kilos, precio antes de IVA e IVA). Después los puedes editar uno por uno. No duplica ni cambia los que ya existan.</p><button class="btn btn-primary" data-act="load-catalog">Cargar ${missing} producto(s)</button></section>` : ''}
  <div class="toolbar"><div class="search"><input type="search" id="prod-q" placeholder="Buscar producto, código o categoría" aria-label="Buscar productos"></div>
    <button class="btn btn-plain btn-small" data-act="share-prices" data-co="${co}">Enviar lista por WhatsApp</button>
    <button class="btn btn-plain btn-small" data-act="export" data-what="productos" data-co="${co}">Exportar CSV</button>
    <button class="btn btn-plain btn-small file-btn">Importar CSV<input type="file" accept=".csv,text/csv" data-import="products" data-co="${co}" aria-label="Importar productos"></button></div>
  ${cats.length > 1 ? `<div class="chips"><a class="chip ${cat ? '' : 'active'}" href="#/productos?co=${co}">Todas <span>${all.length}</span></a>${cats.map((c) => `<a class="chip ${cat === c ? 'active' : ''}" href="#/productos?co=${co}&cat=${encodeURIComponent(c)}">${esc(c)} <span>${all.filter((p) => p.category === c).length}</span></a>`).join('')}</div>` : ''}
  ${list.length ? `<div class="cards" id="prod-results">${list.map(card).join('')}</div><p class="muted small" id="prod-empty" hidden>Sin coincidencias.</p>` : empty('📦', 'Sin productos', co === 'nogal' ? 'Carga tu lista de precios con el botón de arriba o agrega productos uno por uno.' : 'Agrega productos para cargarlos rápido en cotizaciones, pedidos y ventas.')}`;
}

export function renderGoals() {
  const s = S();
  const period = localDate().slice(0, 7);
  return `<div class="page-head"><div><p class="eyebrow"><a href="#/mas">Más</a></p><h1>Metas</h1></div><button class="btn btn-primary" data-act="edit-goals">Configurar metas</button></div>
  <div class="goal-grid">${ACTIVE_COMPANY_IDS.map((co) => {
    const m = periodMetrics(s, co, period);
    const g = goalFor(s, co, period);
    const series = monthlySeries(s, co, 6);
    const max = Math.max(1, ...series.map((x) => Math.max(x.sales, x.collected)));
    return `<section class="panel"><h2>${s.companies[co].icon} ${esc(s.companies[co].name)}</h2>
      <div class="goal-line"><span>Ventas ${periodLabel(period)} (antes de IVA)</span><b>${money(m.salesNet)}</b></div>${g.sales ? progress((m.salesNet / g.sales) * 100, m.salesNet >= g.sales ? 'ok' : '') + `<small class="muted">Meta ${money(g.sales)} · faltan ${money(Math.max(0, g.sales - m.salesNet))}</small>` : '<small class="muted">Sin meta de ventas</small>'}
      <div class="goal-line"><span>Recaudo</span><b>${money(m.collected)}</b></div>${g.collection ? progress((m.collected / g.collection) * 100, m.collected >= g.collection ? 'ok' : '') + `<small class="muted">Meta ${money(g.collection)}</small>` : '<small class="muted">Sin meta de recaudo</small>'}
      <h3>Últimos 6 meses</h3><div class="mini-chart" role="img" aria-label="Ventas y recaudo de los últimos 6 meses">${series.map((x) => `<div class="mc-col"><div class="mc-bars"><span class="mc-s" style="height:${(x.sales / max) * 100}%" title="Ventas ${money(x.sales)}"></span><span class="mc-c" style="height:${(x.collected / max) * 100}%" title="Recaudo ${money(x.collected)}"></span></div><small>${x.period.slice(5)}</small></div>`).join('')}</div>
      <p class="muted small"><span class="key mc-s"></span> Ventas <span class="key mc-c"></span> Recaudo</p>
      ${co === 'nogal' ? '<p class="muted small">Las metas son independientes del umbral de comisiones ($70 M), que se controla en Comisiones.</p>' : ''}</section>`;
  }).join('')}</div>`;
}

export function renderReports(params) {
  const s = S();
  const period = params.get('p') || localDate().slice(0, 7);
  const periods = Array.from({ length: 18 }, (_, i) => previousPeriod(localDate().slice(0, 7), i));
  const cos = ui.scope === 'todas' ? ACTIVE_COMPANY_IDS : [ui.scope];
  const row = (co) => {
    const m = periodMetrics(s, co, period);
    const rec = receivables(s, { companyId: co });
    const cs = commissionSummary(s, { companyId: co, period });
    return { co, m, rec: rec.reduce((a, r) => a + r.balance, 0), overdue: rec.filter((r) => r.daysLate > 0).reduce((a, r) => a + r.balance, 0), cs };
  };
  const rows = cos.map(row);
  const tot = (f) => rows.reduce((a, r) => a + f(r), 0);
  return `<div class="page-head"><div><p class="eyebrow"><a href="#/mas">Más</a></p><h1>Reportes</h1></div></div>
  <div class="toolbar"><select data-nav aria-label="Periodo">${periods.map((p) => `<option value="#/reportes?p=${p}" ${p === period ? 'selected' : ''}>${periodLabel(p)}</option>`).join('')}</select><span class="muted small">Alcance: ${ui.scope === 'todas' ? 'consolidado (cada fila identifica su empresa)' : esc(s.companies[ui.scope].name)}</span></div>
  <section class="panel"><h2>Resultados de ${periodLabel(period)}</h2><div class="table-wrap"><table><thead><tr><th>Empresa</th><th>Ventas (total)</th><th>Ventas antes de IVA</th><th># ventas</th><th>Recaudado</th><th>Cartera actual</th><th>Vencida actual</th><th>Comisión generada</th><th>Comisión pagada</th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td>${s.companies[r.co].icon} ${esc(s.companies[r.co].name)}</td><td>${money(r.m.salesTotal)}</td><td>${money(r.m.salesNet)}</td><td>${r.m.salesCount}</td><td>${money(r.m.collected)}</td><td>${money(r.rec)}</td><td>${money(r.overdue)}</td><td>${money(r.cs.generated)}</td><td>${money(r.cs.paid)}</td></tr>`).join('')}
  </tbody>${rows.length > 1 ? `<tfoot><tr><td>Consolidado</td><td>${money(tot((r) => r.m.salesTotal))}</td><td>${money(tot((r) => r.m.salesNet))}</td><td>${tot((r) => r.m.salesCount)}</td><td>${money(tot((r) => r.m.collected))}</td><td>${money(tot((r) => r.rec))}</td><td>${money(tot((r) => r.overdue))}</td><td>${money(tot((r) => r.cs.generated))}</td><td>${money(tot((r) => r.cs.paid))}</td></tr></tfoot>` : ''}</table></div></section>
  ${cos.map((co) => productsReport(s, co, period)).join('')}
  <section class="panel"><h2>Exportar a Excel (CSV)</h2><p class="muted">Archivos separados por punto y coma, listos para abrir en Excel. Los montos van como números enteros en pesos.</p><div class="export-grid">
    ${[['ventas', 'Ventas, pedidos y cotizaciones del mes'], ['pagos', 'Recaudos del mes'], ['comisiones', 'Comisiones del mes']].map(([w, l]) => `<button class="btn btn-plain" data-act="export" data-what="${w}" data-period="${period}">${l}</button>`).join('')}
    ${[['cartera', 'Cartera actual por edades'], ['clientes', 'Clientes con indicadores'], ['productos', 'Productos y precios']].map(([w, l]) => `<button class="btn btn-plain" data-act="export" data-what="${w}">${l}</button>`).join('')}
  </div></section>`;
}

function productsReport(s, co, period) {
  const ps = productSales(s, { companyId: co, period });
  const lost = lostProductBuyers(s, { companyId: co, today: localDate(), silenceDays: s.settings.inactivity.noPurchaseDays });
  const name = (id) => s.clients.find((c) => c.id === id)?.tradeName || 'Cliente';
  const unit = (r) => (r.presentation || '').split(' x ')[0].toLowerCase() || 'und';
  const top = ps.rows.slice(0, 10);
  const low = ps.rows.length > 10 ? ps.rows.slice(-5).reverse() : [];
  return `<section class="panel"><h2>${s.companies[co].icon} Productos · ${esc(s.companies[co].name)} · ${periodLabel(period)}</h2>
    ${ps.rows.length ? `<h3>Más vendidos</h3><div class="table-wrap"><table><thead><tr><th>#</th><th>Producto</th><th>Cantidad</th><th>Kilos</th><th>Antes de IVA</th><th>% del mes</th><th>Clientes</th></tr></thead><tbody>${top.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.qty} ${esc(unit(r))}${r.qty === 1 ? '' : 's'}</td><td>${r.content ? `${r.content} ${r.contentUnit === 'und' ? 'und' : 'kg'}` : '—'}</td><td>${money(r.net)}</td><td>${ps.totalNet ? ((r.net / ps.totalNet) * 100).toFixed(1) : 0} %</td><td>${r.clients}</td></tr>`).join('')}</tbody></table></div>
    ${low.length ? `<h3>Menos vendidos (con alguna venta)</h3><ul class="simple">${low.map((r) => `<li>${esc(r.name)} · ${r.qty} ${esc(unit(r))}${r.qty === 1 ? '' : 's'} · ${money(r.net)}</li>`).join('')}</ul>` : ''}` : '<p class="muted">Sin ventas registradas en este mes.</p>'}
    ${ps.notSold.length ? `<details><summary>${ps.notSold.length} producto(s) del catálogo sin ventas este mes</summary><p class="small muted">${ps.notSold.map((p) => esc(p.name)).join(' · ')}</p></details>` : ''}
    <h3>Clientes que dejaron de comprar un producto</h3><p class="muted small">Lo compraron al menos 2 veces en el último año y no lo compran hace ${s.settings.inactivity.noPurchaseDays} días o más.</p>
    ${lost.length ? `<div class="cards">${lost.slice(0, 30).map((r) => `<article class="card"><div class="card-title"><a href="#/cliente/${r.clientId}">${esc(name(r.clientId))}</a></div><div class="card-sub">${esc(r.name)} · lo compró ${r.times} veces (prom. ${r.avgQty} por compra)</div><div class="card-meta"><span>Última compra ${formatDate(r.last)} · hace ${r.daysSince} días</span></div><div class="card-actions"><button class="btn btn-wa btn-xs" data-act="wa" data-client="${r.clientId}" data-tpl="recuperacion">WhatsApp</button><button class="btn btn-plain btn-xs" data-act="new-doc" data-kind="cotizacion" data-client="${r.clientId}">Cotizarle</button></div></article>`).join('')}</div>` : '<p class="muted">Ninguno por ahora.</p>'}
  </section>`;
}

export async function renderData() {
  const s = S();
  const snaps = await listSnapshots();
  const est = await storageEstimate();
  const c = counts(s);
  const rep = s.meta.migrationReport;
  return `<div class="page-head"><div><p class="eyebrow"><a href="#/mas">Más</a></p><h1>Datos y copias de seguridad</h1></div></div>
  <div class="notice warn">Tus datos se guardan <b>solo en este dispositivo</b> (${storageMode() === 'indexeddb' ? 'IndexedDB' : 'almacenamiento local'}). No hay sincronización en la nube en esta versión. Si borras los datos del navegador o cambias de teléfono sin una copia, la información se pierde.</div>
  <div class="stats">${stat('Clientes', c.clientes)}${stat('Documentos', c.documentos)}${stat('Pagos', c.pagos)}${stat('Comisiones', c.comisiones)}${stat('Última copia', s.settings.lastBackupAt ? formatDate(s.settings.lastBackupAt) : 'Nunca', '', s.settings.lastBackupAt ? '' : 'warn')}${stat('Espacio usado', est?.usage ? `${(est.usage / 1048576).toFixed(1)} MB` : '—', est?.quota ? `de ${(est.quota / 1048576).toFixed(0)} MB disponibles` : '')}</div>
  <section class="panel"><h2>Copia de seguridad</h2><p class="muted">Descarga un archivo con todos tus datos (incluye verificación de integridad). Guárdalo en Drive, correo o tu computador.</p><div class="toolbar"><button class="btn btn-primary" data-act="backup">Descargar copia completa</button><button class="btn btn-plain file-btn">Restaurar desde archivo<input type="file" accept=".json,application/json" data-import="backup" aria-label="Restaurar copia"></button></div><p class="muted small">Restaurar reemplaza los datos actuales; antes se guarda automáticamente una instantánea interna para poder deshacerlo. También acepta copias JSON de la versión 1.</p></section>
  <section class="panel"><h2>Instantáneas internas</h2><p class="muted small">Se crean al abrir la app (una por día), antes de restaurar y antes de borrar. Se conservan las 10 más recientes y la copia original de la versión 1.</p>${snaps.length ? `<ul class="simple">${snaps.map((x) => `<li>${formatDateTime(x.at)} · ${esc(x.reason)} · ${(x.size / 1024).toFixed(0)} KB <button class="btn btn-plain btn-xs" data-act="snap-restore" data-id="${x.id}">Restaurar</button> <button class="btn btn-plain btn-xs" data-act="snap-download" data-id="${x.id}">Descargar</button></li>`).join('')}</ul>` : '<p class="muted">Aún no hay instantáneas.</p>'}</section>
  <section class="panel"><h2>Importar</h2><p class="muted">Clientes desde CSV (Excel → Guardar como CSV UTF-8). Columnas reconocidas: nombre, razon_social, nit, contacto, telefono, whatsapp, correo, departamento, ciudad, direccion, categoria, empresa, plazo, observaciones. Los clientes que ya existen (mismo NIT, teléfono o nombre) se omiten: nunca se sobrescriben.</p><div class="toolbar"><select id="import-co" aria-label="Empresa por defecto">${ACTIVE_COMPANY_IDS.map((co) => `<option value="${co}" ${ui.scope === co ? 'selected' : ''}>Empresa por defecto: ${esc(s.companies[co].name)}</option>`).join('')}</select><button class="btn btn-plain file-btn">Importar clientes CSV<input type="file" accept=".csv,text/csv" data-import="clients" aria-label="Importar clientes"></button><button class="btn btn-plain" data-act="template" data-what="clientes">Plantilla de clientes</button></div></section>
  ${rep ? `<section class="panel"><h2>Informe de migración desde la versión 1</h2><p class="muted small">Migrado el ${formatDateTime(s.meta.migratedAt)}. Los datos originales siguen guardados sin cambios en este navegador (clave <code>miCentroComercial_v1</code>) y en las instantáneas.</p><ul class="simple"><li>Clientes: ${rep.clients}${rep.mergedClients.length ? ` (unidos por estar en dos negocios con el mismo nombre y teléfono: ${esc(rep.mergedClients.join(', '))})` : ''}</li><li>Pedidos convertidos en ventas con su saldo: ${rep.orders}</li><li>Abonos: ${rep.payments}</li><li>Despachos: ${rep.dispatches}</li><li>Tareas y seguimientos: ${rep.tasks}</li>${rep.clientsCreatedFromOrders.length ? `<li>Clientes creados desde pedidos (no estaban en la lista): ${esc(rep.clientsCreatedFromOrders.join(', '))}</li>` : ''}${rep.paymentGaps.length ? `<li>Abonos sin detalle (el total cobrado de v1 era mayor que los abonos listados): ${esc(rep.paymentGaps.join(' · '))}</li>` : ''}<li>Pet Home: ${rep.petHomeProducts} productos y ${rep.petHomeSuppliers} proveedores conservados en el archivo.</li><li>La versión 1 mostraba comisiones <b>estimadas</b> de ${money(rep.v1CommissionEstimate.nogal)} (Nogal) y ${money(rep.v1CommissionEstimate.puntazo)} (El Puntazo). No se convirtieron en comisiones porque se calculaban sin umbral ni base antes de IVA. Los cobros nuevos sí generan comisión con las reglas correctas.</li>${rep.warnings.map((w) => `<li class="danger">${esc(w)}</li>`).join('')}</ul>${s.settings.migrationSeen ? '' : '<button class="btn btn-plain btn-small" data-act="migration-seen">Entendido, ocultar aviso</button>'} <button class="btn btn-plain btn-small" data-act="download-v1">Descargar datos originales v1</button></section>` : ''}
  <section class="panel danger-zone"><h2>Zona delicada</h2><p class="muted">Borra todos los datos de este dispositivo. Se guarda una instantánea antes, pero descarga una copia primero.</p><button class="btn btn-danger" data-act="clear-all">Borrar todos los datos</button></section>`;
}

export function renderConfig() {
  const s = S();
  const st = s.settings;
  const p = s.rules.puntazo;
  const n = s.rules.nogal;
  return `<div class="page-head"><div><p class="eyebrow"><a href="#/mas">Más</a></p><h1>Configuración</h1></div></div>
  <form class="panel" data-form="general"><h2>General</h2><div class="grid2">
    <div class="field"><label for="cf-seller">Tu nombre (para los mensajes)</label><input id="cf-seller" name="sellerName" value="${esc(st.sellerName)}"></div>
    <div class="field"><label for="cf-term">Plazo general por defecto (días)</label><input id="cf-term" name="defaultTermDays" type="number" min="0" max="365" value="${st.defaultTermDays}"><small>Referencia configurable; cada cliente o documento puede tener su propia condición.</small></div>
    <div class="field"><label for="cf-ag">Rangos de cartera (días, separados por coma)</label><input id="cf-ag" name="agingBuckets" value="${st.agingBuckets.join(', ')}"><small>Ej. 30, 60, 90 → por vencer, 1–30, 31–60, 61–90, +90.</small></div>
    <div class="field"><label for="cf-np">Cliente inactivo: días sin comprar</label><input id="cf-np" name="noPurchaseDays" type="number" min="1" value="${st.inactivity.noPurchaseDays}"></div>
    <div class="field"><label for="cf-nc">Cliente inactivo: días sin contacto</label><input id="cf-nc" name="noContactDays" type="number" min="1" value="${st.inactivity.noContactDays}"></div>
    ${ACTIVE_COMPANY_IDS.map((co) => `<div class="field"><label class="check"><input type="checkbox" name="block_${co}" ${st.creditLimitBlocks?.[co] ? 'checked' : ''}> Bloquear ventas que excedan el cupo · ${esc(s.companies[co].name)}<small>Si está apagado, solo se muestra una advertencia.</small></label></div>`).join('')}
  </div><button class="btn btn-primary" type="submit">Guardar</button></form>
  ${ACTIVE_COMPANY_IDS.map((co) => { const pf = st.companyProfiles?.[co] || {}; return `<form class="panel" data-form="profile" data-co="${co}"><h2>${s.companies[co].icon} Datos de ${esc(s.companies[co].name)} para PDF</h2><p class="muted small">Aparecen en las cotizaciones e informes en PDF.</p>
    <div class="logo-row">${pf.logo?.dataUrl ? `<img src="${pf.logo.dataUrl}" alt="Logo de ${esc(s.companies[co].name)}" class="logo-preview">` : '<div class="logo-preview empty">Sin logo</div>'}<div class="toolbar"><button type="button" class="btn btn-plain btn-small file-btn">${pf.logo ? 'Cambiar logo' : 'Subir logo'}<input type="file" accept="image/*" data-logo="${co}" aria-label="Subir logo"></button>${pf.logo ? `<button type="button" class="btn btn-plain btn-small" data-act="remove-logo" data-co="${co}">Quitar</button>` : ''}</div></div>
    <div class="grid2"><div class="field"><label>Razón social</label><input name="legalName" value="${esc(pf.legalName || '')}"></div><div class="field"><label>NIT</label><input name="nit" value="${esc(pf.nit || '')}"></div><div class="field"><label>Teléfono / WhatsApp</label><input name="phone" value="${esc(pf.phone || '')}"></div><div class="field"><label>Correo</label><input name="email" value="${esc(pf.email || '')}"></div><div class="field"><label>Dirección</label><input name="address" value="${esc(pf.address || '')}"></div><div class="field"><label>Ciudad</label><input name="city" value="${esc(pf.city || '')}"></div><div class="field full"><label>Condiciones que salen en las cotizaciones</label><textarea name="quoteTerms" rows="3">${esc(pf.quoteTerms || '')}</textarea></div></div>
    <button class="btn btn-primary" type="submit">Guardar datos</button></form>`; }).join('')}
  <section class="panel"><h2>Reglas de comisión</h2><p class="muted">Cambiarlas exige un motivo, queda en auditoría y <b>no</b> recalcula comisiones ya generadas.</p>
    <div class="table-wrap"><table><tbody>
    <tr><th>El Puntazo</th><td>Venta ${formatPct(p.saleBps)} · Cobro ${formatPct(p.collectionBps)} sobre lo recaudado</td><td><button class="btn btn-plain btn-xs" data-act="edit-rules" data-co="puntazo">Cambiar</button></td></tr>
    <tr><th>Frutos del Nogal</th><td>Umbral ${money(n.thresholdPesos)} (${n.thresholdBase === 'total' ? 'con IVA' : 'antes de IVA'}) · Mayorista ${formatPct(n.modes.mayorista.saleBps)}/${formatPct(n.modes.mayorista.collectionBps)} · Normal ${formatPct(n.modes.normal.saleBps)}/${formatPct(n.modes.normal.collectionBps)}</td><td><button class="btn btn-plain btn-xs" data-act="edit-rules" data-co="nogal">Cambiar</button></td></tr>
    </tbody></table></div></section>
  <form class="panel" data-form="templates"><h2>Plantillas de WhatsApp</h2><p class="muted small">Variables: {contacto} {cliente} {empresa} {vendedor} {documento} {total} {saldo} {vencimiento} {valor_pago} {valor_promesa} {fecha_promesa} {guia}. El mensaje siempre se puede editar antes de enviarlo.</p>
    ${Object.entries(st.waTemplates).map(([k, t]) => `<div class="field full"><label for="wt-${k}">${esc(t.label)}</label><textarea id="wt-${k}" name="tpl_${k}" rows="3">${esc(t.text)}</textarea></div>`).join('')}
    <button class="btn btn-primary" type="submit">Guardar plantillas</button></form>`;
}

export function renderPetHome() {
  const s = S();
  const ph = s.legacy.petHome || { products: [], suppliers: [] };
  return `<div class="page-head"><div><p class="eyebrow"><a href="#/mas">Más</a></p><h1>🐾 Alegría Pet Home (archivo)</h1></div></div>
  <div class="notice info">Este negocio estaba en la versión 1. El nuevo CRM está enfocado en El Puntazo y Frutos del Nogal, por eso Pet Home no aparece en el selector, pero <b>ningún dato se eliminó</b>: sus productos, proveedores${s.documents.some((d) => d.companyId === 'pethome') ? ', clientes y pedidos' : ''} están aquí y en las copias de seguridad. Si quieres reactivarlo como tercera empresa, se puede hacer en una próxima etapa.</div>
  <section class="panel"><h2>Productos (${ph.products.length})</h2>${ph.products.length ? `<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Categoría</th><th>Presentación</th><th>Costo</th><th>Margen</th><th>IVA venta</th></tr></thead><tbody>${ph.products.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td>${esc(p.presentation)}</td><td>${money(p.cost)}</td><td>${esc(p.margin)} %</td><td>${esc(p.saleIvaType || p.saleIvaRate)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin productos.</p>'}</section>
  <section class="panel"><h2>Proveedores (${ph.suppliers.length})</h2>${ph.suppliers.length ? `<ul class="simple">${ph.suppliers.map((x) => `<li><b>${esc(x.name)}</b> ${esc([x.contact, x.phone, x.email].filter(Boolean).join(' · '))}</li>`).join('')}</ul>` : '<p class="muted">Sin proveedores.</p>'}</section>
  ${s.documents.some((d) => d.companyId === 'pethome') ? `<section class="panel"><h2>Pedidos migrados</h2><ul class="simple">${s.documents.filter((d) => d.companyId === 'pethome').map((d) => `<li><a href="#/doc/${d.id}">${esc(d.number)}</a> · ${esc(s.clients.find((c) => c.id === d.clientId)?.tradeName)} · ${money(d.totals.total)}</li>`).join('')}</ul></section>` : ''}`;
}

export function renderAudit() {
  const s = S();
  const list = s.audit.slice(-300).reverse();
  return `<div class="page-head"><div><p class="eyebrow"><a href="#/mas">Más</a></p><h1>Registro de auditoría</h1></div></div><section class="panel">${list.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead><tbody>${list.map((a) => `<tr><td>${formatDateTime(a.at)}</td><td>${esc(a.action)}</td><td>${esc(a.entity)}</td><td class="small">${esc(a.detail).slice(0, 300)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin registros.</p>'}</section>`;
}

export function renderHelp() {
  return `<div class="page-head"><div><p class="eyebrow"><a href="#/mas">Más</a></p><h1>Ayuda</h1></div></div>
  <section class="panel prose"><h2>Conceptos</h2><ul>
  <li><b>Cotización</b>: propuesta. No afecta cartera ni comisiones.</li>
  <li><b>Pedido</b>: lo que el cliente confirmó. Se prepara y se despacha (total o parcial). No es cartera.</li>
  <li><b>Venta</b>: el documento comercial (factura/remisión). Crea la cuenta por cobrar y, en Frutos del Nogal, la comisión por venta si es elegible.</li>
  <li><b>Pago / recaudo</b>: dinero recibido. Se aplica a una o varias ventas de la misma empresa y cliente. Lo no aplicado queda "sin aplicar".</li>
  <li><b>Comisión</b>: se genera automáticamente. Pendiente → Liquidada (la agrupas para cobrarla) → Pagada (cuando registras que te la pagaron).</li></ul>
  <h2>Correcciones</h2><p>Nada financiero se borra: una venta se <b>anula</b> con motivo; un pago se <b>reversa</b> con motivo. Si la comisión ya se había pagado, se crea un ajuste negativo.</p>
  <h2>WhatsApp</h2><p>La app abre WhatsApp con el mensaje listo. No puede saber si lo enviaste: solo registra "contacto iniciado" y te pregunta el resultado.</p>
  <h2>Instalar en Android</h2><p>Abre la app en Chrome (desde una dirección https) → menú ⋮ → "Instalar app" o "Agregar a pantalla principal". Funciona sin conexión.</p>
  <h2>Límites de esta versión</h2><ul><li>Sin cuenta de usuario ni sincronización en la nube: un dispositivo = una base de datos. Usa copias de seguridad para pasar datos entre teléfono y computador.</li><li>No emite factura electrónica DIAN; registra la referencia de tu factura real.</li><li>Los avisos solo aparecen con la app abierta.</li></ul>
  <p class="muted small">Mi Centro Comercial ${APP_VERSION} · Herramienta de gestión comercial. No reemplaza asesoría contable o tributaria.</p></section>`;
}
