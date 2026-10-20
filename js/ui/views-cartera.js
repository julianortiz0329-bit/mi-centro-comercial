import { formatDate } from '../core/dates.js';
import { agingKeys, receivables, unappliedAmount } from '../domain/ledger.js';
import { PAYMENT_METHODS } from '../domain/schema.js';
import { getState } from '../store/store.js';
import { empty, esc, money, pill } from './dom.js';
import { ui } from './state.js';

const S = () => getState();
export let carteraQuery = { q: '', bucket: '', city: '', minDays: '', minValue: '' };

export function carteraResults() {
  const s = S();
  const all = receivables(s, { companyId: ui.scope === 'todas' ? null : ui.scope });
  const q = carteraQuery.q.toLowerCase();
  const list = all.filter((r) => {
    const c = s.clients.find((x) => x.id === r.doc.clientId);
    if (carteraQuery.bucket && r.bucket.key !== carteraQuery.bucket) return false;
    if (carteraQuery.city && (c?.city || '').toLowerCase() !== carteraQuery.city.toLowerCase()) return false;
    if (carteraQuery.minDays && r.daysLate < Number(carteraQuery.minDays)) return false;
    if (carteraQuery.minValue && r.balance < Number(carteraQuery.minValue)) return false;
    return !q || `${c?.tradeName} ${r.doc.number} ${r.doc.externalRef}`.toLowerCase().includes(q);
  });
  if (!list.length) return empty('✅', 'Sin cuentas en esta vista', 'No hay saldos pendientes con estos filtros. ¡Vas al día!', '<button class="btn btn-plain" data-act="new-doc" data-kind="venta">＋ Registrar una venta</button>');
  return `<p class="muted small">${list.length} cuenta(s) · ${money(list.reduce((a, r) => a + r.balance, 0))} · ordenadas por prioridad</p><div class="cards">${list.map((r) => {
    const c = s.clients.find((x) => x.id === r.doc.clientId);
    return `<article class="card rec ${r.daysLate > 0 ? 'late' : ''}">
      <a class="card-main" href="#/doc/${r.doc.id}"><div class="card-title">${esc(c?.tradeName)} ${pill(r.bucket.label, r.daysLate > 0 ? 'danger' : r.bucket.key === 'disputa' ? 'warn' : 'info')}${r.brokenPromise ? pill('Promesa incumplida', 'warn') : ''}</div>
      <div class="card-sub"><span class="co-chip co-${r.doc.companyId}">${esc(s.companies[r.doc.companyId].short)}</span> ${esc(r.doc.number)}${r.doc.externalRef ? ` · ${esc(r.doc.externalRef)}` : ''} · venta ${formatDate(r.doc.date)} · vence ${formatDate(r.doc.dueDate)}${r.daysLate > 0 ? ` · <b>${r.daysLate} días de mora</b>` : ''}</div>
      <div class="card-meta"><span>Original ${money(r.doc.totals.total)}</span><span>Abonado ${money(r.paid)}</span><span>Saldo <b>${money(r.balance)}</b></span></div>
      <div class="card-meta small">${r.lastContact ? `<span>Últ. gestión ${formatDate(r.lastContact.at)}: ${esc(r.lastContact.result || r.lastContact.title)}</span>` : '<span>Sin gestiones de cobro</span>'}${r.lastPromise ? `<span>Promesa ${money(r.lastPromise.promise.amount)} · ${formatDate(r.lastPromise.promise.date)} (${esc(r.lastPromise.promise.status)})</span>` : ''}${r.nextAction ? `<span>Próxima: ${esc(r.nextAction.text)} ${formatDate(r.nextAction.date)}</span>` : ''}</div></a>
      <div class="card-actions"><button class="btn btn-primary btn-xs" data-act="pay" data-doc="${r.doc.id}">Cobrar</button><button class="btn btn-plain btn-xs" data-act="activity" data-client="${r.doc.clientId}" data-doc="${r.doc.id}">Gestión</button><button class="btn btn-plain btn-xs" data-act="activity" data-client="${r.doc.clientId}" data-doc="${r.doc.id}" data-type="promesa">Promesa</button><button class="btn btn-wa btn-xs" data-act="wa" data-client="${r.doc.clientId}" data-doc="${r.doc.id}" data-tpl="recordatorio">WhatsApp</button></div>
    </article>`;
  }).join('')}</div>`;
}

export function renderCartera(params) {
  const s = S();
  const tab = params.get('tab') || 'cartera';
  if (params.get('bucket') !== null) carteraQuery.bucket = params.get('bucket') || '';
  const all = receivables(s, { companyId: ui.scope === 'todas' ? null : ui.scope });
  const keys = [...agingKeys(s.settings.agingBuckets), { key: 'disputa', label: 'En disputa' }];
  const sumBy = (k) => all.filter((r) => r.bucket.key === k).reduce((a, r) => a + r.balance, 0);
  const cities = [...new Set(all.map((r) => s.clients.find((c) => c.id === r.doc.clientId)?.city).filter(Boolean))].sort();
  const pays = s.payments.filter((p) => ui.scope === 'todas' || p.companyId === ui.scope);
  const unapplied = pays.filter((p) => unappliedAmount(p) > 0);
  const head = `<div class="page-head"><div><p class="eyebrow">Cuentas por cobrar</p><h1>Cartera</h1></div><button class="btn btn-primary" data-act="pay">＋ Registrar pago</button></div>
  <div class="tabs"><a href="#/cartera" class="${tab === 'cartera' ? 'active' : ''}">Pendiente</a><a href="#/cartera?tab=sinaplicar" class="${tab === 'sinaplicar' ? 'active' : ''}">Pagos sin aplicar ${unapplied.length ? `<span class="badge">${unapplied.length}</span>` : ''}</a><a href="#/cartera?tab=pagos" class="${tab === 'pagos' ? 'active' : ''}">Recaudos</a><a href="#/cartera?tab=pagadas" class="${tab === 'pagadas' ? 'active' : ''}">Pagadas</a></div>`;
  if (tab === 'sinaplicar') {
    return `${head}<div class="notice info">Un pago sin aplicar no reduce la cartera ni genera comisión hasta que lo asignes a una venta de la misma empresa.</div>${unapplied.length ? `<div class="cards">${unapplied.map((p) => `<article class="card"><div class="card-main"><div class="card-title">${esc(p.number)} · ${esc(s.clients.find((c) => c.id === p.clientId)?.tradeName)}</div><div class="card-sub"><span class="co-chip co-${p.companyId}">${esc(s.companies[p.companyId].short)}</span> ${formatDate(p.date)} · ${esc(PAYMENT_METHODS[p.method])}${p.reference ? ` · ${esc(p.reference)}` : ''}</div><div class="card-meta"><span>Recibido ${money(p.amount)}</span><span>Sin aplicar <b>${money(unappliedAmount(p))}</b></span></div></div><div class="card-actions"><button class="btn btn-primary btn-xs" data-act="apply" data-id="${p.id}">Aplicar</button><button class="btn btn-plain btn-xs" data-act="reverse" data-id="${p.id}">Reversar</button></div></article>`).join('')}</div>` : empty('✅', 'Todo aplicado', 'No hay pagos pendientes de asignar.')}`;
  }
  if (tab === 'pagos') {
    const list = pays.slice().sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 300);
    return `${head}${list.length ? `<div class="table-wrap"><table><thead><tr><th>Pago</th><th>Fecha</th><th>Cliente</th><th>Método</th><th>Valor</th><th>Aplicado</th><th>Estado</th><th></th></tr></thead><tbody>${list.map((p) => `<tr><td>${esc(p.number)}${p.reference ? `<small> · ${esc(p.reference)}</small>` : ''}${p.legacy ? '<small> · v1</small>' : ''}</td><td>${formatDate(p.date)}</td><td><a href="#/cliente/${p.clientId}">${esc(s.clients.find((c) => c.id === p.clientId)?.tradeName)}</a></td><td>${esc(PAYMENT_METHODS[p.method] || p.method)}</td><td>${money(p.amount)}</td><td>${p.allocations.map((a) => `<a href="#/doc/${a.documentId}">${esc(s.documents.find((d) => d.id === a.documentId)?.number)}</a> ${money(a.amount)}`).join('<br>') || '—'}</td><td>${p.status === 'reversado' ? pill('Reversado', 'danger') + `<small class="block">${esc(p.reversal?.reason)}</small>` : pill('Activo', 'ok')}</td><td>${p.status === 'activo' ? `<button class="btn btn-plain btn-xs" data-act="reverse" data-id="${p.id}">Reversar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('💵', 'Sin recaudos', 'Registra el primer pago recibido.')}`;
  }
  if (tab === 'pagadas') {
    const paid = receivables(s, { companyId: ui.scope === 'todas' ? null : ui.scope, includePaid: true }).filter((r) => r.balance <= 0).slice(0, 300);
    return `${head}${paid.length ? `<div class="cards">${paid.map((r) => `<a class="card card-main" href="#/doc/${r.doc.id}"><div class="card-title">${esc(r.doc.number)} · ${esc(s.clients.find((c) => c.id === r.doc.clientId)?.tradeName)} ${pill('Pagada', 'ok')}</div><div class="card-sub">${formatDate(r.doc.date)} · ${money(r.doc.totals.total)}</div></a>`).join('')}</div>` : empty('📄', 'Sin cuentas pagadas aún', '')}`;
  }
  return `${head}
  <div class="aging">${keys.map((k) => `<a href="#/cartera?bucket=${carteraQuery.bucket === k.key ? '' : k.key}" class="age ${carteraQuery.bucket === k.key ? 'active' : ''} ${k.key === 'por_vencer' ? '' : 'late'}"><small>${esc(k.label)}</small><b>${money(sumBy(k.key))}</b></a>`).join('')}</div>
  <div class="toolbar"><div class="search"><input type="search" id="cart-q" placeholder="Cliente, número o referencia" value="${esc(carteraQuery.q)}" aria-label="Buscar en cartera"></div>
    <select id="cart-city" aria-label="Ciudad"><option value="">Todas las ciudades</option>${cities.map((c) => `<option ${carteraQuery.city === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <input id="cart-days" type="number" min="0" placeholder="Mora mínima (días)" value="${esc(carteraQuery.minDays)}" aria-label="Mora mínima">
    <input id="cart-min" type="number" min="0" placeholder="Saldo mínimo" value="${esc(carteraQuery.minValue)}" aria-label="Saldo mínimo"></div>
  <div id="cartera-results">${carteraResults()}</div>`;
}
