// Formularios de Alegría Pet Home.
import { addDays, localDate } from '../core/dates.js';
import { parseDecimal, parsePesos } from '../core/money.js';
import { addPhPayment, addPurchasePayment, addSupplierNote, createPhSale, createPurchase, setPurchaseDueDate, PH_CHANNELS, PH_METHODS, PH_NOTE_CHANNELS, IVA_RATES, productMargin, purchaseTotals, saleTotals, savePhProduct, saveSupplier, voidPhSale } from '../domain/pethome.js';
import { getState, run } from '../store/store.js';
import { supplierTermDays } from '../domain/ledger.js';
import { $, $$, bindMoneyPreviews, errorMessage, esc, exec, field, haptic, money, openModal, readMoney, requestId, toast } from './dom.js';
import { navigate } from './state.js';
import { cobroDone, markPaid } from './motion.js';

const P = () => getState().pethome;
// Medio de pago = cuenta del libro (así el dinero cae en la caja correcta).
const accountOptions = () => {
  const accs = (getState().ledger?.accounts || []).filter((a) => a.active);
  return accs.length ? accs.map((a) => ({ value: a.id, label: a.name })) : Object.entries(PH_METHODS).map(([value, label]) => ({ value, label }));
};
const defAccount = (pref) => {
  const accs = (getState().ledger?.accounts || []).filter((a) => a.active);
  return (accs.find((a) => a.method === pref) || accs[0])?.id || pref;
};
const pct = (v) => (v === null ? '—' : `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(v)} %`);

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Productos que coinciden con lo escrito; sin texto, primero los más vendidos. */
function findProducts(q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  const sold = new Map();
  for (const s of P().sales) if (s.status === 'activa') for (const l of s.lines || []) if (l.productId) sold.set(l.productId, (sold.get(l.productId) || 0) + (Number(l.qty) || 1));
  return P().products
    .filter((p) => p.active && words.every((w) => fold(`${p.name} ${p.category} ${p.pet} ${(p.variants || []).join(' ')}`).includes(w)))
    .sort((a, b) => (words.length ? fold(a.name).indexOf(words[0]) - fold(b.name).indexOf(words[0]) : 0) || (sold.get(b.id) || 0) - (sold.get(a.id) || 0) || a.name.localeCompare(b.name, 'es'))
    .slice(0, 40)
    .map((p) => ({ p, sold: sold.get(p.id) || 0 }));
}

const ivaSelect = (v) => `<div class="field ph-l-iva"><label>IVA</label><select name="iva">${IVA_RATES.map((r) => `<option value="${r}" ${Number(v) === r ? 'selected' : ''}>${r} %</option>`).join('')}</select></div>`;
const withIva = (kind) => kind === 'purchase' || !!P().profile.ivaResponsable;

function lineRow(kind, l = {}) {
  const priceName = kind === 'sale' ? 'price' : 'cost';
  const priceLabel = kind === 'sale' ? (P().profile.ivaResponsable ? 'Precio c/u (con IVA)' : 'Precio c/u') : 'Costo c/u (antes de IVA)';
  const val = kind === 'sale' ? l.unitPrice : l.unitCost;
  const prod = l.productId ? P().products.find((x) => x.id === l.productId) : null;
  const iva = l.ivaPct ?? prod?.ivaPct ?? 19;
  return `<div class="ph-line${withIva(kind) ? ' has-iva' : ''}" data-line>
    <div class="field ph-l-prod picker"><label>Producto</label><input type="search" name="desc" autocomplete="off" enterkeyhint="search" placeholder="Escribe el nombre: pato, rascador, pelota…" value="${esc(prod ? prod.name : l.description || '')}"><input type="hidden" name="product" value="${prod ? prod.id : ''}"><div class="picker-list" role="listbox" hidden></div></div>
    <div class="field ph-l-qty"><label>Cant.</label><input name="qty" inputmode="decimal" value="${esc(l.qty ?? 1)}"></div>
    <div class="field ph-l-price"><label>${priceLabel}</label><input name="${priceName}" inputmode="numeric" value="${val ?? ''}"></div>
    ${withIva(kind) ? ivaSelect(iva) : ''}
    <button type="button" class="icon-btn ph-l-del" data-del aria-label="Quitar">✕</button>
    <small class="ph-l-info" data-info></small>
  </div>`;
}

function readLines(form, kind) {
  return $$('[data-line]', form).map((row) => {
    const pid = $('[name=product]', row).value;
    const desc = $('[name=desc]', row).value.trim();
    const qty = parseDecimal($('[name=qty]', row).value || '1');
    const raw = $(`[name=${kind === 'sale' ? 'price' : 'cost'}]`, row).value;
    const v = raw.trim() === '' ? null : parsePesos(raw);
    if (!pid && !desc) return null;
    const ivaSel = $('[name=iva]', row);
    const base = { productId: pid || null, description: pid ? '' : desc, qty, ...(ivaSel ? { ivaPct: Number(ivaSel.value) } : {}) };
    return kind === 'sale' ? { ...base, unitPrice: v ?? 0 } : { ...base, unitCost: v ?? 0 };
  }).filter(Boolean);
}

function bindLines(form, kind, onChange) {
  const box = $('[data-lines]', form);
  const info = (row) => {
    const pid = $('[name=product]', row).value;
    const p = P().products.find((x) => x.id === pid);
    const out = $('[data-info]', row);
    if (!p) return (out.textContent = '');
    if (kind === 'sale') {
      const price = parsePesos($('[name=price]', row).value);
      const m = Number.isSafeInteger(price) ? productMargin(p, price, p.cost, Number($('[name=iva]', row)?.value || 0)) : { pct: null };
      out.innerHTML = Number.isSafeInteger(p.cost) ? `Costo ${money(p.cost)} · margen <b>${pct(m.pct)}</b>` : 'Sin costo registrado: la ganancia quedará incompleta';
    } else out.innerHTML = Number.isSafeInteger(p.cost) ? `Costo actual ${money(p.cost)} · precio ${money(p.price)}` : `Precio de venta ${money(p.price)}`;
  };
  const showList = (inp) => {
    const list = inp.parentElement.querySelector('.picker-list');
    const q = inp.value.trim();
    const items = findProducts(q);
    list.innerHTML = items.length
      ? items.map(({ p, sold }) => `<button type="button" class="picker-item" data-pick="${p.id}"><b>${esc(p.name)}</b><small>${money(p.price)}${Number.isSafeInteger(p.cost) ? ` · costo ${money(p.cost)}` : ''} · ${esc(p.category || 'Otros')}${sold ? ` · ${sold} vendido${sold === 1 ? '' : 's'}` : ''}</small></button>`).join('')
      : `<p class="picker-empty">Ningún producto se llama así. Se guardará como “${esc(q)}”.</p>`;
    list.hidden = !q && !items.length;
  };
  const choose = (row, p) => {
    $('[name=desc]', row).value = p.name;
    $('[name=product]', row).value = p.id;
    const tgt = $(`[name=${kind === 'sale' ? 'price' : 'cost'}]`, row);
    tgt.value = kind === 'sale' ? p.price : p.cost ?? '';
    const ivaSel = $('[name=iva]', row);
    if (ivaSel) ivaSel.value = String(p.ivaPct ?? 19);
    $('.picker-list', row).hidden = true;
    info(row);
    onChange();
    haptic(8);
    $('[name=qty]', row).select?.();
  };
  box.addEventListener('focusin', (e) => e.target.name === 'desc' && showList(e.target));
  box.addEventListener('focusout', (e) => e.target.name === 'desc' && setTimeout(() => {
    const l = e.target.parentElement?.querySelector('.picker-list');
    if (l) l.hidden = true;
  }, 180));
  box.addEventListener('mousedown', (e) => e.target.closest('[data-pick]') && e.preventDefault());
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (b) choose(b.closest('[data-line]'), P().products.find((x) => x.id === b.dataset.pick));
  });
  box.addEventListener('keydown', (e) => {
    if (e.target.name !== 'desc' || e.key !== 'Enter') return;
    const first = e.target.parentElement.querySelector('[data-pick]');
    if (first && !e.target.parentElement.querySelector('.picker-list').hidden) {
      e.preventDefault();
      first.click();
    }
  });
  box.addEventListener('change', () => onChange());
  box.addEventListener('input', (e) => {
    const row = e.target.closest('[data-line]');
    if (row && e.target.name === 'desc') {
      // Escribir otra cosa suelta el producto elegido (queda como descripción libre).
      const pid = $('[name=product]', row);
      const p = P().products.find((x) => x.id === pid.value);
      if (p && p.name !== e.target.value) pid.value = '';
      showList(e.target);
    }
    if (row) info(row);
    onChange();
  });
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-add-line]')) {
      box.insertAdjacentHTML('beforeend', lineRow(kind));
      $('[data-line]:last-child [name=desc]', box)?.focus();
      onChange();
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      if ($$('[data-line]', form).length > 1) del.closest('[data-line]').remove();
      onChange();
    }
  });
  $$('[data-line]', form).forEach(info);
}

/* ---------------- Venta ---------------- */
export function phSaleForm(prefill = null) {
  const names = [...new Map(P().sales.map((x) => [x.customerName.toLowerCase(), x])).values()].slice(-200);
  const lines = prefill?.lines?.length ? prefill.lines : [{}];
  const rid = requestId();
  openModal({
    title: prefill ? 'Repetir venta' : 'Nueva venta · Alegría',
    subtitle: P().profile.ivaResponsable ? 'Precios con IVA incluido, como en la tienda. Puedes dejar un saldo pendiente y cobrarlo con una cuenta de cobro.' : 'Alegría no cobra IVA (puedes cambiarlo en Datos para cobrar). Puedes dejar un saldo pendiente y cobrarlo con una cuenta de cobro.',
    wide: true,
    submitText: 'Registrar venta',
    body: `<div class="grid2">
      <div class="field"><label for="phc_name">¿A quién le vendiste? <span class="req">*</span></label><input id="phc_name" name="customerName" list="ph-customers" required value="${esc(prefill?.customerName || '')}" placeholder="Nombre del amigo o cliente" autocomplete="off"><datalist id="ph-customers">${names.map((x) => `<option value="${esc(x.customerName)}">`).join('')}</datalist></div>
      ${field({ name: 'customerPhone', label: 'Teléfono (para WhatsApp)', type: 'tel', value: prefill?.customerPhone || '' })}
      ${field({ name: 'date', label: 'Fecha', type: 'date', value: localDate(), required: true })}
      ${field({ name: 'channel', label: 'Canal', type: 'select', value: prefill?.channel || 'directa', options: Object.entries(PH_CHANNELS).map(([value, label]) => ({ value, label })) })}
    </div>
    <h3 class="form-section">Productos</h3>
    <div data-lines>${lines.map((l) => lineRow('sale', l)).join('')}</div>
    <button type="button" class="btn btn-plain btn-small" data-add-line>＋ Agregar producto</button>
    <div class="grid2" style="margin-top:12px">
      ${field({ name: 'discount', label: 'Descuento (en pesos)', type: 'money', value: '' })}
      ${field({ name: 'shipping', label: 'Domicilio que cobras', type: 'money', value: '' })}
      ${field({ name: 'shippingCost', label: 'Domicilio que pagas tú', type: 'money', value: '', help: 'Se descuenta de tu ganancia.' })}
      ${field({ name: 'customerId', label: 'Cédula o NIT del comprador (opcional)', value: prefill?.customerId || '' })}
    </div>
    <div class="ph-totals" data-totals></div>
    <h3 class="form-section">¿Cómo pagó?</h3>
    <div class="segm ph-paid" role="radiogroup"><button type="button" role="radio" data-paid="todo" aria-checked="true">Pagó todo</button><button type="button" role="radio" data-paid="abono" aria-checked="false">Abonó</button><button type="button" role="radio" data-paid="nada" aria-checked="false">Me debe todo</button></div>
    <input type="hidden" name="paidMode" value="todo">
    <div class="grid2" style="margin-top:10px">
      <div data-paid-amount hidden>${field({ name: 'paidAmount', label: 'Valor del abono', type: 'money', value: '' })}</div>
      <div data-paid-method>${field({ name: 'method', label: '¿A qué cuenta entró?', type: 'select', value: defAccount('nequi'), options: accountOptions() })}</div>
      <div data-due hidden>${field({ name: 'dueDate', label: 'Fecha para pagar el saldo', type: 'date', value: addDays(localDate(), 15) })}</div>
    </div>
    ${field({ name: 'notes', label: 'Notas', type: 'textarea', full: true })}`,
    onOpen: (form) => {
      bindMoneyPreviews(form);
      const recompute = () => {
        const ls = readLines(form, 'sale').filter((l) => Number.isFinite(l.qty) && Number.isSafeInteger(l.unitPrice));
        const num = (n) => parsePesos($(`[name=${n}]`, form).value || '0') || 0;
        let unknown = false;
        const lines = ls.map((l) => {
          const p = P().products.find((x) => x.id === l.productId);
          if (!p || !Number.isSafeInteger(p.cost)) unknown = true;
          return { ...l, ivaPct: P().profile.ivaResponsable ? l.ivaPct ?? 19 : 0, unitCost: p?.cost ?? 0 };
        });
        const t = saleTotals({ lines, discount: num('discount'), shipping: num('shipping'), shippingCost: num('shippingCost'), payments: [] });
        $('[data-totals]', form).innerHTML = `<div><span>Total</span><b>${money(t.total)}</b></div>${t.iva ? `<div><span>IVA incluido</span><b>${money(t.iva)}</b></div>` : ''}<div><span>Tu ganancia</span><b>${unknown ? '—' : money(t.profit)}</b></div><div><span>Margen</span><b>${!unknown && t.marginPct !== null ? pct(t.marginPct) : '—'}</b></div>${unknown && ls.length ? '<small class="muted">Algún producto no tiene costo: ponlo en Productos para ver tu ganancia.</small>' : ''}`;
      };
      bindLines(form, 'sale', recompute);
      form.addEventListener('input', (e) => {
        if (['discount', 'shipping', 'shippingCost'].includes(e.target.name)) recompute();
      });
      form.addEventListener('click', (e) => {
        const b = e.target.closest('[data-paid]');
        if (!b) return;
        $$('[data-paid]', form).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        $('[name=paidMode]', form).value = b.dataset.paid;
        $('[data-paid-amount]', form).hidden = b.dataset.paid !== 'abono';
        $('[data-paid-method]', form).hidden = b.dataset.paid === 'nada';
        $('[data-due]', form).hidden = b.dataset.paid === 'todo';
        haptic(6);
      });
      recompute();
    },
    onSubmit: async (fd, form) => {
      const lines = readLines(form, 'sale');
      if (!lines.length) return toast('Agrega al menos un producto.', 'error'), false;
      const mode = fd.get('paidMode');
      const paid = mode === 'todo' ? { amount: 'total', method: fd.get('method') } : mode === 'abono' ? { amount: readMoney(fd, 'paidAmount', { label: 'El abono' }), method: fd.get('method') } : null;
      const sale = await exec(createPhSale, { customerName: fd.get('customerName'), customerPhone: fd.get('customerPhone'), customerId: fd.get('customerId'), date: fd.get('date'), channel: fd.get('channel'), lines, discount: readMoney(fd, 'discount', { required: false, label: 'El descuento' }), shipping: readMoney(fd, 'shipping', { required: false, label: 'El domicilio' }), shippingCost: readMoney(fd, 'shippingCost', { required: false, label: 'El domicilio' }), dueDate: mode === 'todo' ? null : fd.get('dueDate'), notes: fd.get('notes'), paid, requestId: rid });
      if (!sale) return false;
      const t = saleTotals(getState().pethome.sales.find((x) => x.id === sale.id));
      haptic(12);
      toast(t.balance ? `Venta ${sale.number} registrada · queda debiendo ${money(t.balance)}` : `Venta ${sale.number} registrada y pagada`, 'ok', {
        action: { label: 'Deshacer', onClick: async () => {
          try {
            await run(voidPhSale, { saleId: sale.id, reason: 'Deshecho justo después de registrarla' });
            toast('Venta anulada (queda en el historial)');
          } catch (e) {
            toast(errorMessage(e), 'error');
          }
        } },
      });
      navigate(`#/ph-venta/${sale.id}`);
    },
  });
}

/* ---------------- Abono ---------------- */
export function phPaymentForm(saleId, onSaved) {
  const sale = P().sales.find((x) => x.id === saleId);
  const t = saleTotals(sale);
  openModal({
    title: `Abono de ${esc(sale.customerName)}`,
    subtitle: `${esc(sale.number)} · debe ${money(t.balance)}`,
    submitText: 'Registrar abono',
    body: `<div class="grid2">${field({ name: 'amount', label: 'Valor recibido', type: 'money', value: t.balance, required: true })}${field({ name: 'date', label: 'Fecha', type: 'date', value: localDate(), required: true })}${field({ name: 'method', label: '¿A qué cuenta entró?', type: 'select', value: defAccount('nequi'), options: accountOptions() })}${field({ name: 'note', label: 'Referencia (opcional)' })}</div>`,
    onOpen: (form) => bindMoneyPreviews(form),
    onSubmit: async (fd) => {
      const p = await exec(addPhPayment, { saleId, amount: readMoney(fd, 'amount', { label: 'El abono' }), date: fd.get('date'), method: fd.get('method'), note: fd.get('note') }, { success: 'Abono registrado' });
      if (!p) return false;
      const sale = P().sales.find((x) => x.id === saleId);
      if (saleTotals(sale).balance === 0) markPaid(saleId);
      cobroDone(p.amount, sale.customerName);
      onSaved?.(p);
    },
  });
}

/* ---------------- Proveedor ---------------- */
const TERMS = [['discounts', 'Descuentos', 'Ej. 5 % desde 50 unidades · 3 % pago de contado'], ['paymentTerm', 'Plazo de pago', 'Ej. Contado, 30 días, 50 % anticipo'], ['minOrder', 'Pedido mínimo', 'Ej. $ 500.000 o 12 unidades por referencia'], ['shipping', 'Envío / flete', 'Ej. Gratis desde $ 1.000.000; si no, lo paga Alegría'], ['leadTime', 'Tiempo de entrega', 'Ej. 3 a 5 días hábiles'], ['credit', 'Crédito', 'Ej. Cupo de $ 2.000.000 después de 3 compras'], ['returns', 'Devoluciones y garantía', 'Ej. Cambio por defecto de fábrica en 15 días'], ['other', 'Otros acuerdos', '']];

export function phSupplierForm(existing = null) {
  const x = existing || { terms: {} };
  openModal({
    title: existing ? 'Editar proveedor' : 'Nuevo proveedor',
    wide: true,
    body: `<div class="grid2">
      ${field({ name: 'name', label: 'Nombre o empresa', value: x.name, required: true })}
      ${field({ name: 'contactName', label: 'Persona de contacto', value: x.contactName })}
      ${field({ name: 'phone', label: 'Teléfono / WhatsApp', type: 'tel', value: x.phone })}
      ${field({ name: 'email', label: 'Correo', type: 'email', value: x.email })}
      ${field({ name: 'city', label: 'Ciudad', value: x.city })}
      ${field({ name: 'sells', label: 'Qué te vende', value: x.sells, placeholder: 'Ej. Juguetes resistentes, rascadores' })}
      ${field({ name: 'web', label: 'Web o catálogo', value: x.web })}
      ${field({ name: 'discountPct', label: 'Descuento habitual (%)', value: x.discountPct ?? '', attrs: 'inputmode="decimal"' })}
      ${field({ name: 'rating', label: 'Calificación', type: 'select', value: x.rating || 0, options: [{ value: 0, label: 'Sin calificar' }, ...[1, 2, 3, 4, 5].map((n) => ({ value: n, label: '★'.repeat(n) }))] })}
      ${field({ name: 'status', label: 'Estado', type: 'select', value: x.status || 'activo', options: [{ value: 'activo', label: 'Activo' }, { value: 'inactivo', label: 'Inactivo' }] })}
    </div>
    <h3 class="form-section">Términos comerciales</h3>
    <div class="grid2">${TERMS.map(([k, l, ph]) => field({ name: `t_${k}`, label: l, type: 'textarea', value: x.terms?.[k] || '', placeholder: ph, attrs: 'rows="2"' })).join('')}</div>
    ${field({ name: 'notes', label: 'Notas generales', type: 'textarea', value: x.notes, full: true })}`,
    onSubmit: async (fd) => {
      const terms = Object.fromEntries(TERMS.map(([k]) => [k, fd.get(`t_${k}`)]));
      const r = await exec(saveSupplier, { id: existing?.id, name: fd.get('name'), contactName: fd.get('contactName'), phone: fd.get('phone'), email: fd.get('email'), city: fd.get('city'), sells: fd.get('sells'), web: fd.get('web'), discountPct: fd.get('discountPct'), rating: fd.get('rating'), status: fd.get('status'), notes: fd.get('notes'), terms }, { success: existing ? 'Proveedor actualizado' : 'Proveedor creado' });
      if (!r) return false;
      if (!existing) navigate(`#/ph-proveedor/${r.id}`);
    },
  });
}

export function phNoteForm(supplierId) {
  const sup = P().suppliers.find((x) => x.id === supplierId);
  openModal({
    title: `Conversación con ${esc(sup.name)}`,
    subtitle: 'Queda en la bitácora del proveedor. Si pones fecha de seguimiento, te la recuerdo en el resumen.',
    body: `${field({ name: 'channel', label: 'Por dónde', type: 'select', value: 'whatsapp', options: Object.entries(PH_NOTE_CHANNELS).map(([value, label]) => ({ value, label })) })}
      ${field({ name: 'summary', label: '¿Qué hablaron?', type: 'textarea', required: true, attrs: 'rows="3"', placeholder: 'Ej. Pregunté precio por 50 unidades del rascador zanahoria' })}
      ${field({ name: 'offer', label: 'Oferta o precio que te dieron (opcional)', placeholder: 'Ej. $ 95.000 c/u, 8 % si pago de contado' })}
      ${field({ name: 'followUp', label: 'Volver a escribir el (opcional)', type: 'date', value: '' })}`,
    onSubmit: async (fd) => ((await exec(addSupplierNote, { supplierId, channel: fd.get('channel'), summary: fd.get('summary'), offer: fd.get('offer'), followUp: fd.get('followUp') || null }, { success: 'Nota guardada' })) ? undefined : false),
  });
}

/* ---------------- Compra ---------------- */
export function phPurchaseForm(supplierId) {
  const sups = P().suppliers.filter((x) => x.status === 'activo' || x.id === supplierId);
  if (!sups.length) return toast('Primero crea el proveedor.', 'error');
  const rid = requestId();
  openModal({
    title: 'Registrar compra a proveedor',
    subtitle: 'El costo de cada producto se actualiza con el "costo puesto" (con descuento y flete repartido).',
    wide: true,
    submitText: 'Registrar compra',
    body: `<div class="grid2">
      ${field({ name: 'supplierId', label: 'Proveedor', type: 'select', value: supplierId || sups[0].id, options: sups.map((x) => ({ value: x.id, label: x.name })), required: true })}
      ${field({ name: 'date', label: 'Fecha', type: 'date', value: localDate(), required: true })}
      ${field({ name: 'invoiceRef', label: 'Factura o remisión (opcional)' })}
      ${field({ name: 'plazo', label: 'Plazo para pagarle', type: 'select', value: '', options: [{ value: '', label: 'De contado (sin crédito)' }, ...[8, 15, 30, 45, 60, 90].map((d) => ({ value: String(d), label: `A ${d} días` })), { value: 'fecha', label: 'Otra fecha…' }] })}
      ${field({ name: 'dueDate', label: 'Vence (fecha para pagarle)', type: 'date', value: '', help: 'Se calcula con el plazo. Si negociaron otra fecha, cámbiala.' })}
    </div>
    <h3 class="form-section">Productos</h3>
    <div data-lines>${lineRow('purchase')}</div>
    <button type="button" class="btn btn-plain btn-small" data-add-line>＋ Agregar producto</button>
    <div class="grid2" style="margin-top:12px">
      ${field({ name: 'discount', label: 'Descuento del proveedor (en pesos)', type: 'money', value: '' })}
      ${field({ name: 'shipping', label: 'Flete o envío', type: 'money', value: '' })}
      ${field({ name: 'paidAmount', label: 'Cuánto le pagaste ya', type: 'money', value: '', help: 'Vacío = le debes todo.' })}
      ${field({ name: 'method', label: '¿De qué cuenta salió?', type: 'select', value: defAccount('bancolombia'), options: accountOptions() })}
    </div>
    ${field({ name: 'updateCosts', label: 'Actualizar el costo de estos productos con esta compra', type: 'checkbox', value: true, full: true })}
    <div class="ph-totals" data-totals></div>
    ${field({ name: 'notes', label: 'Notas', type: 'textarea', full: true })}`,
    onOpen: (form) => {
      bindMoneyPreviews(form);
      const recompute = () => {
        const ls = readLines(form, 'purchase').filter((l) => Number.isFinite(l.qty) && Number.isSafeInteger(l.unitCost));
        const disc = parsePesos($('[name=discount]', form).value || '0') || 0;
        const ship = parsePesos($('[name=shipping]', form).value || '0') || 0;
        const t = purchaseTotals({ lines: ls, discount: disc, shipping: ship, payments: [] });
        $('[data-totals]', form).innerHTML = `<div><span>Subtotal antes de IVA</span><b>${money(t.subtotal - disc)}</b></div>${Object.entries(t.ivaByRate).map(([r, v]) => `<div><span>IVA ${r} %</span><b>${money(v)}</b></div>`).join('')}${ship ? `<div><span>Flete</span><b>${money(ship)}</b></div>` : ''}<div><span>Total de la factura</span><b>${money(t.total)}</b></div>${t.iva ? `<small class="muted">${P().profile.ivaResponsable ? 'El IVA de la compra queda como IVA descontable (no suma al costo del producto).' : 'Como Alegría no cobra IVA, el IVA que les cobran se suma al costo de cada producto.'}</small>` : ''}`;
      };
      bindLines(form, 'purchase', recompute);
      form.addEventListener('input', (e) => ['discount', 'shipping'].includes(e.target.name) && recompute());
      recompute();
      // Plazo: por defecto el del proveedor ("30 días" en sus términos); la fecha se calcula sola.
      const due = () => {
        const v = $('[name=plazo]', form).value;
        const d = $('[name=dueDate]', form);
        d.closest('.field').hidden = !v;
        if (v && v !== 'fecha') d.value = addDays($('[name=date]', form).value || localDate(), Number(v));
      };
      const supTerm = () => {
        const sup = P().suppliers.find((x) => x.id === $('[name=supplierId]', form).value);
        const n = supplierTermDays(sup);
        const sel = $('[name=plazo]', form);
        if (n && ![...sel.options].some((o) => o.value === String(n))) sel.insertAdjacentHTML('beforeend', `<option value="${n}">A ${n} días</option>`);
        sel.value = n ? String(n) : '';
        due();
      };
      form.addEventListener('change', (e) => {
        if (e.target.name === 'supplierId') supTerm();
        if (e.target.name === 'plazo' || e.target.name === 'date') due();
      });
      supTerm();
    },
    onSubmit: async (fd, form) => {
      const lines = readLines(form, 'purchase');
      if (!lines.length) return toast('Agrega al menos un producto.', 'error'), false;
      const paidAmount = readMoney(fd, 'paidAmount', { required: false, label: 'El pago' });
      const pu = await exec(createPurchase, { supplierId: fd.get('supplierId'), date: fd.get('date'), invoiceRef: fd.get('invoiceRef'), dueDate: fd.get('plazo') ? fd.get('dueDate') || null : null, lines, discount: readMoney(fd, 'discount', { required: false, label: 'El descuento' }), shipping: readMoney(fd, 'shipping', { required: false, label: 'El flete' }), paid: paidAmount ? { amount: paidAmount, method: fd.get('method') } : null, updateCosts: !!fd.get('updateCosts'), notes: fd.get('notes'), requestId: rid }, { success: 'Compra registrada' });
      if (!pu) return false;
    },
  });
}

export function phPurchasePayForm(purchaseId) {
  const pu = P().purchases.find((x) => x.id === purchaseId);
  const t = purchaseTotals(pu);
  const sup = P().suppliers.find((x) => x.id === pu.supplierId);
  const prev = pu.payments.filter((p) => p.status === 'activo');
  openModal({
    title: `Abonar a ${esc(sup?.name || 'proveedor')}`,
    subtitle: `${esc(pu.number)}${pu.invoiceRef ? ` · factura ${esc(pu.invoiceRef)}` : ''} · total ${money(t.total)} · abonado ${money(t.paid)} · <b>saldo ${money(t.balance)}</b>${pu.dueDate ? ` · vence ${esc(pu.dueDate.split('-').reverse().join('/'))}` : ''}`,
    body: `<div class="grid2">${field({ name: 'amount', label: 'Valor del abono', type: 'money', value: t.balance, required: true, help: 'Puedes abonar una parte: el resto queda pendiente.' })}${field({ name: 'date', label: 'Fecha', type: 'date', value: localDate() })}${field({ name: 'method', label: '¿De qué cuenta salió?', type: 'select', value: defAccount('bancolombia'), options: accountOptions() })}${field({ name: 'reference', label: 'Referencia (opcional)', placeholder: 'N.º de transferencia o comprobante' })}${field({ name: 'note', label: 'Nota (opcional)', full: true })}</div>
    ${prev.length ? `<p class="muted small">Abonos anteriores: ${prev.map((p) => `${money(p.amount)} el ${esc(p.date.split('-').reverse().join('/'))}`).join(' · ')}</p>` : ''}`,
    submitText: 'Registrar abono',
    onOpen: (form) => bindMoneyPreviews(form),
    onSubmit: async (fd) => {
      const r = await exec(addPurchasePayment, { purchaseId, amount: readMoney(fd, 'amount', { label: 'El abono' }), date: fd.get('date'), method: fd.get('method'), reference: fd.get('reference'), note: fd.get('note') });
      if (!r) return false;
      const left = purchaseTotals(P().purchases.find((x) => x.id === purchaseId)).balance;
      toast(left ? `Abono registrado · quedan ${money(left)} por pagar` : '¡Factura pagada completa!');
      if (!left) markPaid(purchaseId);
    },
  });
}

/** Cambiar la fecha de pago acordada con el proveedor. */
export function phPurchaseDueForm(purchaseId) {
  const pu = P().purchases.find((x) => x.id === purchaseId);
  openModal({
    title: 'Cambiar fecha de pago',
    subtitle: `${esc(pu.number)} · si el proveedor les dio más plazo o acordaron otra fecha.`,
    body: `<div class="grid2">${field({ name: 'dueDate', label: 'Nueva fecha', type: 'date', value: pu.dueDate || '' })}${field({ name: 'note', label: 'Motivo (opcional)', placeholder: 'Ej. nos dio 15 días más' })}</div>`,
    onSubmit: async (fd) => ((await exec(setPurchaseDueDate, { purchaseId, dueDate: fd.get('dueDate') || null, note: fd.get('note') }, { success: 'Fecha actualizada' })) ? undefined : false),
  });
}

/* ---------------- Producto ---------------- */
export function phProductForm(existing = null) {
  const x = existing || {};
  const cats = [...new Set(P().products.map((p) => p.category).filter(Boolean))].sort();
  openModal({
    title: existing ? esc(existing.name) : 'Nuevo producto',
    subtitle: existing?.shopifyId ? 'Producto de tu tienda Shopify' : '',
    wide: true,
    body: `<div class="grid2">
      ${field({ name: 'name', label: 'Nombre', value: x.name, required: true })}
      <div class="field"><label>Categoría</label><input name="category" list="ph-cats" value="${esc(x.category || '')}"><datalist id="ph-cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
      ${field({ name: 'price', label: 'Precio de venta', type: 'money', value: x.price ?? '', required: true })}
      ${field({ name: 'cost', label: P().profile.ivaResponsable ? 'Costo sin IVA (lo que te cuesta)' : 'Costo (lo que te cuesta, con IVA si te lo cobran)', type: 'money', value: x.cost ?? '' })}
      ${field({ name: 'ivaPct', label: 'IVA del producto', type: 'select', value: String(x.ivaPct ?? 19), options: IVA_RATES.map((r) => ({ value: String(r), label: `${r} %` })), help: P().profile.ivaResponsable ? 'Se cobra incluido en el precio de venta.' : 'Hoy Alegría no cobra IVA; se usa como IVA sugerido en las compras.' })}
      ${field({ name: 'supplierId', label: 'Proveedor', type: 'select', value: x.supplierId || '', options: [{ value: '', label: 'Sin proveedor' }, ...P().suppliers.map((s) => ({ value: s.id, label: s.name }))] })}
      ${field({ name: 'pet', label: 'Para', type: 'select', value: x.pet || 'perros', options: ['perros', 'gatos', 'perros y gatos'].map((v) => ({ value: v, label: v })) })}
      ${field({ name: 'variants', label: 'Variantes (separadas por coma)', value: (x.variants || []).join(', ') })}
      ${field({ name: 'note', label: 'Nota', value: x.note })}
      ${existing ? field({ name: 'active', label: 'Activo (se vende)', type: 'checkbox', value: x.active !== false }) : ''}
    </div>
    <div class="ph-totals" data-margin></div>
    ${existing?.costHistory?.length ? `<details><summary>Historial de costo</summary><ul class="simple small">${existing.costHistory.slice().reverse().map((h) => `<li>${h.at.slice(0, 10)} · ${h.from == null ? '—' : money(h.from)} → <b>${h.to == null ? '—' : money(h.to)}</b> · ${esc(h.source)}</li>`).join('')}</ul></details>` : ''}`,
    onOpen: (form) => {
      bindMoneyPreviews(form);
      const upd = () => {
        const price = parsePesos($('[name=price]', form).value);
        const cost = parsePesos($('[name=cost]', form).value);
        const iva = P().profile.ivaResponsable ? Number($('[name=ivaPct]', form).value) : 0;
        const m = Number.isSafeInteger(price) && Number.isSafeInteger(cost) ? productMargin({ price, cost }, price, cost, iva) : null;
        $('[data-margin]', form).innerHTML = m ? `<div><span>Ganancia por unidad</span><b>${money(m.profit)}</b></div><div><span>Margen</span><b>${pct(m.pct)}</b></div><div><span>Precio para ${P().settings.minMarginPct} %</span><b>${money(Math.ceil(((cost / (1 - P().settings.minMarginPct / 100)) * (1 + iva / 100)) / 100) * 100)}</b>${iva ? '<small class="muted">con IVA incluido</small>' : ''}</div>` : '<small class="muted">Escribe el costo para ver el margen.</small>';
      };
      form.addEventListener('input', upd);
      upd();
    },
    onSubmit: async (fd) => {
      const cost = String(fd.get('cost') || '').trim();
      return (await exec(savePhProduct, { id: existing?.id, shopifyId: existing?.shopifyId, name: fd.get('name'), category: fd.get('category'), price: readMoney(fd, 'price', { label: 'El precio' }), cost: cost ? readMoney(fd, 'cost', { label: 'El costo' }) : null, supplierId: fd.get('supplierId') || null, pet: fd.get('pet'), variants: fd.get('variants'), note: fd.get('note'), ivaPct: fd.get('ivaPct'), active: existing ? !!fd.get('active') : true }, { success: 'Producto guardado' })) ? undefined : false;
    },
  });
}
