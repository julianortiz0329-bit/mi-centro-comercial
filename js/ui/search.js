// Buscador único: clientes, ventas/pedidos/cotizaciones, pagos y productos.
import { formatDate } from '../core/dates.js';
import { getState } from '../store/store.js';
import { $, esc, money, openModal } from './dom.js';
import { icon } from './icons.js';
import { clientAvatar } from './views-clients.js';
import { navigate } from './state.js';

const norm = (v) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const KIND = { cotizacion: 'Cotización', pedido: 'Pedido', venta: 'Venta' };
const RECENT = 'mcc_recent_search';

function readRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT) || '[]').slice(0, 6);
  } catch {
    return [];
  }
}
function remember(q) {
  try {
    const r = [q, ...readRecent().filter((x) => x !== q)].slice(0, 6);
    localStorage.setItem(RECENT, JSON.stringify(r));
  } catch {
    /* opcional */
  }
}

export function searchAll(s, q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const hit = (text) => {
    const t = norm(text);
    return words.every((w) => t.includes(w));
  };
  const clientName = (id) => s.clients.find((c) => c.id === id)?.tradeName || '';
  const clients = s.clients.filter((c) => hit([c.tradeName, c.legalName, c.code, c.city, c.phone, c.whatsapp, c.taxId, c.contactName, c.category].join(' '))).slice(0, 8);
  const docs = s.documents
    .filter((d) => hit([d.number, d.externalRef, KIND[d.kind], clientName(d.clientId)].join(' ')))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);
  const pays = s.payments.filter((p) => hit([p.number, p.reference, 'pago abono', clientName(p.clientId)].join(' '))).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 5);
  const prods = s.products.filter((p) => hit([p.name, p.code, p.category, p.presentation].join(' '))).slice(0, 8);
  return { clients, docs, pays, prods, clientName };
}

function results(q) {
  const s = getState();
  const r = searchAll(s, q);
  if (!r) {
    const rec = readRecent();
    return `<p class="muted small">Busca clientes, facturas, pagos, productos, ciudad, NIT o teléfono.</p>${rec.length ? `<div class="sr-recent"><small>Recientes</small>${rec.map((x) => `<button type="button" class="chip" data-sr-recent="${esc(x)}">${icon('search', { size: 13 })} ${esc(x)}</button>`).join('')}</div>` : ''}`;
  }
  const { clients, docs, pays, prods, clientName } = r;
  if (!clients.length && !docs.length && !pays.length && !prods.length) return `<div class="sr-empty">${icon('search', { size: 28 })}<b>Sin resultados para "${esc(q)}"</b><small>Prueba con menos letras o con otra palabra.</small></div>`;
  const group = (title, items) => (items.length ? `<div class="sr-group"><h3>${title}</h3>${items.join('')}</div>` : '');
  return group('Clientes', clients.map((c) => `<a class="sr-item" href="#/cliente/${c.id}">${clientAvatar(c, 36)}<span><b>${esc(c.tradeName)}</b><small>${esc([c.city, c.phone || c.whatsapp, c.code].filter(Boolean).join(' · '))}</small></span>${icon('arrowRight', { size: 16 })}</a>`))
    + group('Ventas, pedidos y cotizaciones', docs.map((d) => `<a class="sr-item" href="#/doc/${d.id}"><span class="sr-ico">${icon(d.kind === 'venta' ? 'receipt' : d.kind === 'pedido' ? 'clipboard' : 'quote', { size: 18 })}</span><span><b>${KIND[d.kind]} ${esc(d.number)}</b><small>${esc(clientName(d.clientId))} · ${formatDate(d.date)} · ${money(d.totals.total)}</small></span>${icon('arrowRight', { size: 16 })}</a>`))
    + group('Pagos', pays.map((p) => `<a class="sr-item" href="#/cliente/${p.clientId}"><span class="sr-ico">${icon('cash', { size: 18 })}</span><span><b>Pago ${esc(p.number)}${p.status === 'reversado' ? ' (reversado)' : ''}</b><small>${esc(clientName(p.clientId))} · ${formatDate(p.receivedAt)} · ${money(p.amount)}${p.reference ? ` · ref. ${esc(p.reference)}` : ''}</small></span>${icon('arrowRight', { size: 16 })}</a>`))
    + group('Productos', prods.map((p) => `<button type="button" class="sr-item" data-act="edit-product" data-id="${p.id}"><span class="sr-ico">${icon('package', { size: 18 })}</span><span><b>${esc(p.name)}</b><small>${esc([p.presentation, s.companies[p.companyId]?.short].filter(Boolean).join(' · '))} · ${money(p.price)} antes de IVA</small></span>${icon('arrowRight', { size: 16 })}</button>`));
}

export function openSearch() {
  const { form, close } = openModal({
    title: 'Buscar',
    body: `<div class="sr-box">${icon('search', { size: 20 })}<input type="search" name="q" placeholder="Cliente, factura, producto…" autocomplete="off" enterkeyhint="search" aria-label="Buscar en toda la app"></div><div class="sr-results" data-sr>${results('')}</div>`,
    noFooter: true,
    onOpen: (f) => {
      f.classList.add('search-form');
      const input = $('[name=q]', f);
      const out = $('[data-sr]', f);
      let t = null;
      input.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => (out.innerHTML = results(input.value)), 90);
      });
      out.addEventListener('click', (e) => {
        const rec = e.target.closest('[data-sr-recent]');
        if (rec) {
          input.value = rec.dataset.srRecent;
          out.innerHTML = results(input.value);
          return;
        }
        const item = e.target.closest('.sr-item');
        if (!item) return;
        if (input.value.trim()) remember(input.value.trim());
        if (item.tagName === 'A') {
          e.preventDefault();
          close();
          navigate(item.getAttribute('href'));
        } else close();
      });
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        $('.sr-item', out)?.click();
      });
    },
  });
  return form;
}
