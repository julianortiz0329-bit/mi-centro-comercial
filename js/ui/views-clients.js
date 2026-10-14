import { formatDate, formatDateTime } from '../core/dates.js';
import { clientKpis, clientTimeline, inactiveClients, searchClients } from '../domain/clients.js';
import { CLIENT_STATUSES, ACTIVE_COMPANY_IDS, ACTIVITY_TYPES } from '../domain/schema.js';
import { normalizePhone, telLink } from '../domain/whatsapp.js';
import { clientPriceList, lastOrderFor } from '../domain/pricing.js';
import { getState } from '../store/store.js';
import { empty, esc, money, pill, stat } from './dom.js';
import { ui } from './state.js';

const S = () => getState();
const statusTone = { activo: 'ok', prospecto: 'info', inactivo: '', bloqueado: 'danger' };
const coChips = (c) => c.companyIds.map((co) => `<span class="co-chip co-${co}">${S().companies[co]?.icon || ''} ${esc(S().companies[co]?.short || co)}</span>`).join('');

export let clientQuery = { q: '', status: '', category: '' };

export function clientCard(c) {
  const k = clientKpis(S(), c.id, ui.scope === 'todas' ? null : ui.scope);
  return `<article class="card client-card">
    <a class="card-main" href="#/cliente/${c.id}"><div class="card-title">${esc(c.tradeName)} ${pill(CLIENT_STATUSES[c.status], statusTone[c.status])}</div>
    <div class="card-sub">${esc([c.code, c.city, c.category].filter(Boolean).join(' · '))}</div>
    <div class="card-meta">${coChips(c)}${k.balance ? `<span>Saldo <b>${money(k.balance)}</b></span>` : ''}${k.overdue ? `<span class="danger">Vencido ${money(k.overdue)}</span>` : ''}${k.lastPurchase ? `<span>Últ. compra ${formatDate(k.lastPurchase)}</span>` : ''}</div></a>
    <div class="card-actions">${normalizePhone(c.whatsapp || c.phone) ? `<button class="btn btn-wa btn-xs" data-act="wa" data-client="${c.id}">WhatsApp</button><a class="btn btn-plain btn-xs" href="${telLink(c.phone || c.whatsapp)}">Llamar</a>` : ''}<button class="btn btn-plain btn-xs" data-act="activity" data-client="${c.id}">Gestión</button></div>
  </article>`;
}

export function clientResults() {
  const s = S();
  const list = searchClients(s, { ...clientQuery, companyId: ui.scope === 'todas' ? null : ui.scope }).sort((a, b) => a.tradeName.localeCompare(b.tradeName, 'es'));
  if (!list.length) return empty('👥', clientQuery.q ? 'Sin coincidencias' : 'Aún no tienes clientes aquí', clientQuery.q ? 'Prueba con otro nombre, teléfono, ciudad, NIT o código.' : 'Agrega tu primer cliente o impórtalos desde un CSV en Datos.', '<button class="btn btn-primary" data-act="new-client">＋ Nuevo cliente</button>');
  return `<p class="muted small">${list.length} cliente(s)</p><div class="cards">${list.slice(0, 300).map(clientCard).join('')}</div>${list.length > 300 ? '<p class="muted">Mostrando 300. Usa la búsqueda para acotar.</p>' : ''}`;
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
  return `<div class="page-head"><div><p class="eyebrow"><a href="#/clientes">Clientes</a> · ${esc(c.code)}</p><h1>${esc(c.tradeName)}</h1><div class="card-meta">${pill(CLIENT_STATUSES[c.status], statusTone[c.status])} ${coChips(c)}</div></div><button class="btn btn-plain" data-act="edit-client" data-client="${c.id}">Editar</button></div>
  <div class="action-bar">
    ${phoneOk ? `<button class="btn btn-wa" data-act="wa" data-client="${c.id}">WhatsApp</button><a class="btn btn-plain" href="${telLink(c.phone || c.whatsapp)}">Llamar</a>` : '<span class="muted small">Sin teléfono válido para WhatsApp</span>'}
    <button class="btn btn-primary" data-act="quick-log" data-client="${c.id}">⚡ Registro rápido</button>
    ${perCo.map((co) => { const lo = lastOrderFor(s, { clientId: c.id, companyId: co }); return lo ? `<button class="btn btn-secondary" data-act="repeat" data-doc="${lo.id}">🔁 Repetir último pedido${perCo.length > 1 ? ` (${esc(s.companies[co].short)})` : ''}</button>` : ''; }).join('')}
    <button class="btn btn-primary" data-act="new-doc" data-kind="venta" data-client="${c.id}">＋ Venta</button>
    <button class="btn btn-secondary" data-act="new-doc" data-kind="pedido" data-client="${c.id}">＋ Pedido</button>
    <button class="btn btn-secondary" data-act="new-doc" data-kind="cotizacion" data-client="${c.id}">＋ Cotización</button>
    <button class="btn btn-secondary" data-act="pay" data-client="${c.id}">Registrar pago</button>
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
