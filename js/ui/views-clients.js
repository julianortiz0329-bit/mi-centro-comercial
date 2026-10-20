import { formatDate, formatDateTime, localDate } from '../core/dates.js';
import { clientKpis, clientTimeline, inactiveClients, searchClients } from '../domain/clients.js';
import { CLIENT_STATUSES, ACTIVE_COMPANY_IDS, ACTIVITY_TYPES } from '../domain/schema.js';
import { normalizePhone, telLink } from '../domain/whatsapp.js';
import { clientPriceList, lastOrderFor } from '../domain/pricing.js';
import { getState } from '../store/store.js';
import { empty, esc, money, pill, stat } from './dom.js';
import { icon } from './icons.js';
import { initials } from './personalize.js';
import { ui } from './state.js';

const S = () => getState();
/** Monto corto para espacios pequeños: $ 1,2 M · $ 450.000. */
const short = (v) => (Math.abs(v) >= 1e6 ? `$ ${(v / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M` : money(v));
const statusTone = { activo: 'ok', prospecto: 'info', inactivo: '', bloqueado: 'danger' };
const coChips = (c) => c.companyIds.map((co) => `<span class="co-chip co-${co}">${S().companies[co]?.icon || ''} ${esc(S().companies[co]?.short || co)}</span>`).join('');

export let clientQuery = { q: '', status: '', category: '' };

/** Semáforo de cartera: rojo = vencido, ámbar = saldo por vencer, verde = al día. */
export function clientTone(k, c) {
  if (c && (c.status === 'inactivo' || c.status === 'bloqueado')) return { key: 'off', label: c.status === 'bloqueado' ? 'Bloqueado' : 'Inactivo' };
  if (k.overdue > 0) return { key: 'red', label: 'Con saldo vencido' };
  if (k.balance > 0) return { key: 'amber', label: 'Saldo por vencer' };
  return { key: 'green', label: 'Al día' };
}

/** Avatar con iniciales y color estable por cliente; el anillo marca el semáforo. */
export function clientAvatar(c, size = 40, tone = null) {
  let h = 0;
  for (const ch of String(c.id || c.tradeName)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  return `<span class="c-avatar${tone ? ` t-${tone.key}` : ''}" style="--h:${hue};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px"${tone ? ` title="${esc(tone.label)}"` : ''} aria-hidden="true">${esc(initials(c.tradeName))}</span>`;
}

export function clientCard(c) {
  const k = clientKpis(S(), c.id, ui.scope === 'todas' ? null : ui.scope);
  const tone = clientTone(k, c);
  const wa = normalizePhone(c.whatsapp || c.phone) ? '1' : '';
  return `<div class="swipe-host" data-swipe-client="${c.id}" data-has-wa="${wa}"><div class="swipe-under" aria-hidden="true"><span class="su-wa">${icon('message', { size: 20 })} WhatsApp</span><span class="su-pay">Registrar cobro ${icon('cash', { size: 20 })}</span></div><article class="card client-card tone-${tone.key}">
    <a class="card-main cc-main" href="#/cliente/${c.id}">${clientAvatar(c, 44, tone)}<div class="cc-body"><div class="card-title">${esc(c.tradeName)} ${c.status !== 'activo' ? pill(CLIENT_STATUSES[c.status], statusTone[c.status]) : ''}</div>
    <div class="card-sub">${esc([c.city, c.category].filter(Boolean).join(' · ')) || '&nbsp;'}</div>
    <div class="card-meta">${coChips(c)}${k.overdue ? `<span class="danger">Vencido <b>${money(k.overdue)}</b></span>` : k.balance ? `<span>Saldo <b>${money(k.balance)}</b></span>` : '<span class="ok-text">Al día</span>'}${k.lastPurchase ? `<span>Últ. compra ${formatDate(k.lastPurchase)}</span>` : ''}</div></div></a>
    <div class="card-actions">${normalizePhone(c.whatsapp || c.phone) ? `<button class="btn btn-wa btn-xs" data-act="wa" data-client="${c.id}">WhatsApp</button><a class="btn btn-plain btn-xs" href="${telLink(c.phone || c.whatsapp)}">Llamar</a>` : ''}<button class="btn btn-plain btn-xs" data-act="activity" data-client="${c.id}">Gestión</button></div>
  </article></div>`;
}

export function clientResults() {
  const s = S();
  const list = searchClients(s, { ...clientQuery, companyId: ui.scope === 'todas' ? null : ui.scope }).sort((a, b) => a.tradeName.localeCompare(b.tradeName, 'es'));
  if (!list.length) return empty('👥', clientQuery.q ? 'Sin coincidencias' : 'Aún no tienes clientes aquí', clientQuery.q ? 'Prueba con otro nombre, teléfono, ciudad, NIT o código.' : 'Agrega tu primer cliente o impórtalos desde un CSV en Datos.', '<button class="btn btn-primary" data-act="new-client">＋ Nuevo cliente</button>');
  return `<div class="legend-row"><span class="muted small">${list.length} cliente(s)</span><span class="legend"><i class="t-green"></i>Al día<i class="t-amber"></i>Por vencer<i class="t-red"></i>Vencido</span></div><p class="swipe-hint">${icon('arrowRight', { size: 14 })} Desliza un cliente: a la derecha WhatsApp, a la izquierda cobro. Mantén presionado para más.</p><div class="cards">${list.slice(0, 300).map(clientCard).join('')}</div>${list.length > 300 ? '<p class="muted">Mostrando 300. Usa la búsqueda para acotar.</p>' : ''}`;
}

export function renderClients(params) {
  const s = S();
  const tab = params.get('tab') || 'todos';
  const cats = [...new Set(s.clients.map((c) => c.category).filter(Boolean))].sort();
  const head = `<div class="page-head"><div><p class="eyebrow">CRM</p><h1>Clientes</h1></div><button class="btn btn-primary" data-act="new-client">＋ Cliente</button></div>
  <div class="tabs"><a href="#/clientes" class="${tab === 'todos' ? 'active' : ''}">Todos</a><a href="#/clientes?tab=oportunidades" class="${tab === 'oportunidades' ? 'active' : ''}">Oportunidades / inactivos</a></div>`;
  if (tab === 'oportunidades') {
    const inact = inactiveClients(s, { companyId: ui.scope === 'todas' ? null : ui.scope });
    const { noPurchaseDays, noContactDays } = s.settings.inactivity;
    return `${head}<div class="notice info">Criterio: sin compras en ${noPurchaseDays} días o sin contacto en ${noContactDays} días (configurable en Más → Configuración). No se cambia el estado del cliente automáticamente.</div>
    ${inact.length ? `<div class="cards">${inact.map((x) => `<article class="card"><a class="card-main" href="#/cliente/${x.client.id}"><div class="card-title">${esc(x.client.tradeName)}</div><div class="card-sub">${esc(x.reasons.join(' · '))}</div><div class="card-meta">${coChips(x.client)}</div></a><div class="card-actions"><button class="btn btn-wa btn-xs" data-act="wa" data-client="${x.client.id}" data-tpl="recuperacion">WhatsApp</button><button class="btn btn-plain btn-xs" data-act="recovery" data-client="${x.client.id}">Programar recuperación</button><button class="btn btn-plain btn-xs" data-act="activity" data-client="${x.client.id}" data-type="recuperacion">Registrar intento</button></div></article>`).join('')}</div>` : empty('🌱', 'Sin clientes inactivos', 'Todos tienen compras o contactos recientes.')}`;
  }
  return `${head}
  <div class="toolbar"><div class="search"><input type="search" id="client-q" placeholder="Buscar por nombre, teléfono, ciudad, NIT o código" value="${esc(clientQuery.q)}" aria-label="Buscar clientes"></div>
    <select id="client-status" aria-label="Estado"><option value="">Todos los estados</option>${Object.entries(CLIENT_STATUSES).map(([k, l]) => `<option value="${k}" ${clientQuery.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <select id="client-cat" aria-label="Categoría"><option value="">Todas las categorías</option>${cats.map((c) => `<option ${clientQuery.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
  <div id="client-results">${clientResults()}</div>`;
}

export function renderClient(id) {
  const s = S();
  const c = s.clients.find((x) => x.id === id);
  if (!c) return empty('🔍', 'Cliente no encontrado', 'Puede que se haya restaurado una copia diferente.', '<a class="btn btn-primary" href="#/clientes">Volver a clientes</a>');
  const coFilter = ui.scope !== 'todas' ? ui.scope : null;
  const perCo = ACTIVE_COMPANY_IDS.filter((co) => c.companyIds.includes(co) && (!coFilter || co === coFilter));
  const kAll = clientKpis(s, c.id, coFilter);
  const timeline = clientTimeline(s, c.id, coFilter).slice(0, 80);
  const phoneOk = normalizePhone(c.whatsapp || c.phone);
  const tlIcon = { cotizacion: '🧾', pedido: '📝', venta: '🧾', pago: '💵', despacho: '📦', llamada: '📞', no_contactado: '📵', visita: '🚗', whatsapp: '💬', nota: '🗒️', seguimiento: '🔁', promesa: '🤝', recuperacion: '🔁' };
  const tlLine = (t) => {
    const r = t.ref;
    let detail = '';
    if (t.kind === 'pago') detail = `${money(r.amount)}${r.status === 'reversado' ? ` · reversado: ${esc(r.reversal?.reason)}` : ''}${r.reference ? ` · ref. ${esc(r.reference)}` : ''}`;
    else if (['cotizacion', 'pedido', 'venta'].includes(t.kind)) detail = `${money(r.totals.total)} · ${esc(r.status)}`;
    else if (t.kind === 'despacho') detail = esc([r.carrier, r.guide].filter(Boolean).join(' ')) || 'Despacho registrado';
    else detail = esc([r.result, r.promise ? `Promesa ${money(r.promise.amount)} para ${formatDate(r.promise.date)} (${r.promise.status})` : '', r.notes].filter(Boolean).join(' · '));
    const href = ['cotizacion', 'pedido', 'venta'].includes(t.kind) ? `#/doc/${r.id}` : t.kind === 'despacho' ? `#/doc/${r.documentId}` : r.documentId ? `#/doc/${r.documentId}` : '';
    return `<li><span class="tl-icon" aria-hidden="true">${tlIcon[t.kind] || '•'}</span><div><div class="tl-title">${href ? `<a href="${href}">${esc(t.title)}</a>` : esc(t.title)} ${t.companyId ? `<span class="co-chip co-${t.companyId}">${esc(s.companies[t.companyId]?.short)}</span>` : ''}</div><div class="tl-meta">${formatDateTime(t.at)} · ${detail}</div>${r.type === 'promesa' && r.promise?.status === 'pendiente' ? `<div class="ag-actions"><button class="btn btn-plain btn-xs" data-act="promise-broken" data-id="${r.id}">Marcar incumplida</button></div>` : ''}</div></li>`;
  };
  const info = [['Razón social', c.legalName], ['NIT / identificación', c.taxId], ['Contacto', c.contactName], ['Teléfono', c.phone], ['WhatsApp', c.whatsapp], ['Correo', c.email], ['Departamento', c.department], ['Ciudad', c.city], ['Dirección', c.address], ['Indicaciones', c.directions], ['Categoría', c.category], ['Etiquetas', (c.tags || []).join(', ')], ['Próxima visita', c.nextVisit ? formatDate(c.nextVisit) : ''], ['Último contacto', c.lastContact ? formatDate(c.lastContact) : ''], ['Creado', formatDate(c.createdAt)]].filter(([, v]) => v);
  const tone = clientTone(kAll, c);
  const fav = favoriteProduct(s, c.id, coFilter);
  const year = localDate().slice(0, 4);
  const soldYear = s.documents.filter((d) => d.kind === 'venta' && d.status === 'emitida' && d.clientId === c.id && (!coFilter || d.companyId === coFilter) && d.date.startsWith(year)).reduce((a, d) => a + d.totals.net, 0);
  const daysSince = kAll.lastPurchase ? Math.round((Date.parse(localDate()) - Date.parse(kAll.lastPurchase)) / 86400000) : null;
  const lastOrders = perCo.map((co) => ({ co, lo: lastOrderFor(s, { clientId: c.id, companyId: co }) })).filter((x) => x.lo);
  return `<section class="client-hero tone-${tone.key}">
    <div class="ch-top"><a class="ch-back" href="#/clientes" aria-label="Volver a clientes">${icon('arrowRight', { size: 18 })}</a><button class="ch-edit" data-act="edit-client" data-client="${c.id}">Editar</button></div>
    <div class="ch-id">${clientAvatar(c, 64, tone)}<div><h1>${esc(c.tradeName)}</h1><p>${esc([c.code, c.city].filter(Boolean).join(' · '))}</p><div class="card-meta">${coChips(c)}<span class="ch-tone"><i></i>${tone.label}</span></div></div></div>
    <div class="ch-kpis"><div><small>Compró en ${year}</small><b>${short(soldYear)}</b><em>antes de IVA</em></div><div><small>Saldo</small><b>${short(kAll.balance)}</b>${kAll.overdue ? `<em class="hot">${short(kAll.overdue)} vencido</em>` : '<em>al día</em>'}</div><div><small>Última compra</small><b>${daysSince === null ? '—' : daysSince === 0 ? 'Hoy' : `${daysSince} días`}</b><em>${kAll.frequencyDays ? `compra cada ~${kAll.frequencyDays} d` : '&nbsp;'}</em></div></div>
    ${fav ? `<p class="ch-fav">${icon('star', { size: 14 })} Su producto favorito: <b>${esc(fav)}</b></p>` : ''}
    <div class="ch-actions">
      <button data-act="new-doc" data-kind="pedido" data-client="${c.id}">${icon('clipboard')}<span>Pedido</span></button>
      <button data-act="pay" data-client="${c.id}">${icon('cash')}<span>Cobro</span></button>
      ${phoneOk ? `<button data-act="wa" data-client="${c.id}">${icon('message')}<span>WhatsApp</span></button><a href="${telLink(c.phone || c.whatsapp)}">${icon('phone')}<span>Llamar</span></a>` : `<button data-act="edit-client" data-client="${c.id}">${icon('phone')}<span>Añadir tel.</span></button>`}
      ${lastOrders.length ? `<button data-act="repeat" data-doc="${lastOrders[0].lo.id}">${icon('repeat')}<span>Repetir</span></button>` : `<button data-act="quick-log" data-client="${c.id}">${icon('zap')}<span>Registro</span></button>`}
    </div>
  </section>
  <div class="action-bar">
    <button class="btn btn-primary" data-act="quick-log" data-client="${c.id}">⚡ Registro rápido</button>
    ${lastOrders.map(({ co, lo }) => `<button class="btn btn-secondary" data-act="repeat" data-doc="${lo.id}">🔁 Repetir último pedido${perCo.length > 1 ? ` (${esc(s.companies[co].short)})` : ''}</button>`).join('')}
    <button class="btn btn-secondary" data-act="new-doc" data-kind="venta" data-client="${c.id}">＋ Venta</button>
    <button class="btn btn-secondary" data-act="new-doc" data-kind="cotizacion" data-client="${c.id}">＋ Cotización</button>
    <button class="btn btn-plain" data-act="activity" data-client="${c.id}">Gestión</button>
    <button class="btn btn-plain" data-act="new-task" data-client="${c.id}">Tarea</button>
    <button class="btn btn-plain" data-act="client-status" data-client="${c.id}">Cambiar estado</button>
  </div>
  <div class="stats">${stat('Total vendido', money(kAll.totalSold), `${kAll.salesCount} venta(s)`)}${stat('Total recaudado', money(kAll.collected))}${stat('Saldo pendiente', money(kAll.balance))}${stat('Cartera vencida', money(kAll.overdue), '', kAll.overdue ? 'warn' : '')}${stat('Última compra', kAll.lastPurchase ? formatDate(kAll.lastPurchase) : '—', kAll.frequencyDays ? `Compra cada ~${kAll.frequencyDays} días` : '')}${stat('Próxima acción', kAll.nextAction ? formatDate(kAll.nextAction.date) : '—', kAll.nextAction ? esc(kAll.nextAction.text) : '')}</div>
  ${kAll.unapplied ? `<div class="notice info">Este cliente tiene ${money(kAll.unapplied)} en pagos sin aplicar. <a href="#/cartera?tab=sinaplicar">Aplicar</a></div>` : ''}
  ${!coFilter && perCo.length > 1 ? `<section class="panel"><h2>Por empresa</h2><div class="table-wrap"><table><thead><tr><th>Empresa</th><th>Vendido</th><th>Recaudado</th><th>Saldo</th><th>Vencido</th><th>Condición</th><th>Cupo</th></tr></thead><tbody>${perCo.map((co) => { const k = clientKpis(s, c.id, co); const t = c.terms?.[co] || {}; return `<tr><td>${s.companies[co].icon} ${esc(s.companies[co].name)}</td><td>${money(k.totalSold)}</td><td>${money(k.collected)}</td><td>${money(k.balance)}</td><td>${money(k.overdue)}</td><td>${t.termDays == null ? 'General' : t.termDays === 0 ? 'Contado' : `${t.termDays} días`}</td><td>${t.creditLimit ? money(t.creditLimit) : '—'}</td></tr>`; }).join('')}</tbody></table></div></section>` : ''}
  ${perCo.map((co) => { const pl = clientPriceList(s, { clientId: c.id, companyId: co }); return pl.length ? `<section class="panel"><h2>⭐ Precios negociados · ${esc(s.companies[co].name)}</h2><p class="muted small">Último precio que le diste en cotizaciones, pedidos o ventas. Se propone automáticamente al cotizarle.</p><div class="table-wrap"><table><thead><tr><th>Producto</th><th>Último precio</th><th>Lista</th><th>Diferencia</th><th>Fecha</th></tr></thead><tbody>${pl.map((r) => `<tr><td>${esc(r.description)}</td><td>${money(r.unitPrice)}${r.discountPct ? ` <small>(−${r.discountPct} %)</small>` : ''}</td><td>${r.listPrice != null ? money(r.listPrice) : '—'}</td><td>${r.listPrice != null ? `${r.unitPrice < r.listPrice ? '−' : r.unitPrice > r.listPrice ? '+' : ''}${money(Math.abs(r.unitPrice - r.listPrice))}` : '—'}</td><td><a href="#/doc/${r.documentId}">${formatDate(r.date)}</a></td></tr>`).join('')}</tbody></table></div></section>` : ''; }).join('')}
  <div class="two-col">
    <section class="panel"><h2>Línea de tiempo</h2>${timeline.length ? `<ul class="timeline">${timeline.map(tlLine).join('')}</ul>` : '<p class="muted">Sin movimientos todavía.</p>'}</section>
    <section class="panel"><h2>Ficha</h2><dl class="infolist">${info.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${c.notes ? `<h3>Observaciones</h3><p class="pre">${esc(c.notes)}</p>` : ''}<p class="muted small">Tipos de gestión disponibles: ${Object.values(ACTIVITY_TYPES).join(', ')}.</p></section>
  </div>`;
}

/** Producto que más veces ha comprado (por número de pedidos/ventas). */
function favoriteProduct(s, clientId, companyId) {
  const count = new Map();
  for (const d of s.documents) {
    if (d.clientId !== clientId || (companyId && d.companyId !== companyId) || !['venta', 'pedido'].includes(d.kind) || ['anulada', 'cancelado'].includes(d.status)) continue;
    for (const l of d.lines || []) {
      const k = String(l.description || '').split(' · ')[0].trim();
      if (k) count.set(k, (count.get(k) || 0) + 1);
    }
  }
  let best = null;
  for (const [k, n] of count) if (!best || n > best[1]) best = [k, n];
  return best && best[1] >= 2 ? best[0] : null;
}
