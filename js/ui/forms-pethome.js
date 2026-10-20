// Formularios de Alegría Pet Home.
import { addDays, localDate } from '../core/dates.js';
import { parseDecimal, parsePesos } from '../core/money.js';
import { addPhPayment, addPurchasePayment, addSupplierNote, createPhSale, createPurchase, PH_CHANNELS, PH_METHODS, PH_NOTE_CHANNELS, productMargin, purchaseTotals, saleTotals, savePhProduct, saveSupplier, voidPhSale } from '../domain/pethome.js';
import { getState, run } from '../store/store.js';
import { $, $$, bindMoneyPreviews, errorMessage, esc, exec, field, haptic, money, openModal, readMoney, requestId, toast } from './dom.js';
import { navigate } from './state.js';
import { cobroDone, markPaid } from './motion.js';

const P = () => getState().pethome;
const methodOptions = Object.entries(PH_METHODS).map(([value, label]) => ({ value, label }));
const pct = (v) => (v === null ? '—' : `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(v)} %`);

function productOptions(selected = '') {
  const byCat = new Map();
  for (const p of P().products.filter((x) => x.active).sort((a, b) => a.name.localeCompare(b.name, 'es'))) {
    const k = p.category || 'Otros';
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push(p);
  }
  return `<option value="">Escoge un producto…</option>${[...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([cat, items]) => `<optgroup label="${esc(cat)}">${items.map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)} · ${money(p.price)}</option>`).join('')}</optgroup>`).join('')}<option value="__otro">Otro (escribir)…</option>`;
}

function lineRow(kind, l = {}) {
  const priceName = kind === 'sale' ? 'price' : 'cost';
  const priceLabel = kind === 'sale' ? 'Precio c/u' : 'Costo c/u';
  const val = kind === 'sale' ? l.unitPrice : l.unitCost;
  return `<div class="ph-line" data-line>
    <div class="field ph-l-prod"><label>Producto</label><select name="product">${productOptions(l.productId || '')}</select><input name="desc" placeholder="Descripción del producto" value="${esc(l.productId ? '' : l.description || '')}" ${l.productId || !l.description ? 'hidden' : ''}></div>
    <div class="field ph-l-qty"><label>Cant.</label><input name="qty" inputmode="decimal" value="${esc(l.qty ?? 1)}"></div>
    <div class="field ph-l-price"><label>${priceLabel}</label><input name="${priceName}" inputmode="numeric" value="${val ?? ''}"></div>
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
    const base = { productId: pid && pid !== '__otro' ? pid : null, description: pid && pid !== '__otro' ? '' : desc, qty };
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
      const m = Number.isSafeInteger(price) ? productMargin(p, price) : { pct: null };
      out.innerHTML = Number.isSafeInteger(p.cost) ? `Costo ${money(p.cost)} · margen <b>${pct(m.pct)}</b>` : 'Sin costo registrado: la ganancia quedará incompleta';
    } else out.innerHTML = Number.isSafeInteger(p.cost) ? `Costo actual ${money(p.cost)} · precio ${money(p.price)}` : `Precio de venta ${money(p.price)}`;
  };
  box.addEventListener('change', (e) => {
    const row = e.target.closest('[data-line]');
    if (e.target.name === 'product') {
      const desc = $('[name=desc]', row);
      desc.hidden = e.target.value !== '__otro';
      if (!desc.hidden) desc.focus();
      const p = P().products.find((x) => x.id === e.target.value);
      if (p) {
        const tgt = $(`[name=${kind === 'sale' ? 'price' : 'cost'}]`, row);
        tgt.value = kind === 'sale' ? p.price : p.cost ?? '';
      }
    }
    info(row);
    onChange();
  });
  box.addEventListener('input', (e) => {
    const row = e.target.closest('[data-line]');
    if (row) info(row);
    onChange();
  });
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-add-line]')) {
      box.insertAdjacentHTML('beforeend', lineRow(kind));
      $('[data-line]:last-child select', box)?.focus();
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
    subtitle: 'Precios sin IVA. Puedes dejar un saldo pendiente y cobrarlo con una cuenta de cobro.',
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
      <div data-paid-method>${field({ name: 'method', label: 'Medio de pago', type: 'select', value: 'nequi', options: methodOptions })}</div>
      <div data-due hidden>${field({ name: 'dueDate', label: 'Fecha para pagar el saldo', type: 'date', value: addDays(localDate(), 15) })}</div>
    </div>
    ${field({ name: 'notes', label: 'Notas', type: 'textarea', full: true })}`,
    onOpen: (form) => {
      bindMoneyPreviews(form);
      const recompute = () => {
        const ls = readLines(form, 'sale');
        const sub = ls.reduce((a, l) => a + Math.round((l.unitPrice || 0) * (Number.isFinite(l.qty) ? l.qty : 0)), 0);
        const disc = parsePesos($('[name=discount]', form).value || '0') || 0;
        const ship = parsePesos($('[name=shipping]', form).value || '0') || 0;
        const shipCost = parsePesos($('[name=shippingCost]', form).value || '0') || 0;
        const total = sub - disc + ship;
        let cogs = 0;
        let unknown = false;
        for (const l of ls) {
          const p = P().products.find((x) => x.id === l.productId);
          if (p && Number.isSafeInteger(p.cost)) cogs += Math.round(p.cost * l.qty);
          else unknown = true;
        }
        const profit = sub - disc - cogs + ship - shipCost;
        $('[data-totals]', form).innerHTML = `<div><span>Total</span><b>${money(total)}</b></div><div><span>Tu ganancia</span><b>${unknown ? '—' : money(profit)}</b></div><div><span>Margen</span><b>${!unknown && total ? pct(Math.round((profit / total) * 1000) / 10) : '—'}</b></div>${unknown && ls.length ? '<small class="muted">Algún producto no tiene costo: ponlo en Productos para ver tu ganancia.</small>' : ''}`;
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
    body: `<div class="grid2">${field({ name: 'amount', label: 'Valor recibido', type: 'money', value: t.balance, required: true })}${field({ name: 'date', label: 'Fecha', type: 'date', value: localDate(), required: true })}${field({ name: 'method', label: 'Medio de pago', type: 'select', value: 'nequi', options: methodOptions })}${field({ name: 'note', label: 'Referencia (opcional)' })}</div>`,
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
      ${field({ name: 'dueDate', label: 'Fecha para pagarle (si queda debiendo)', type: 'date', value: '' })}
    </div>
    <h3 class="form-section">Productos</h3>
    <div data-lines>${lineRow('purchase')}</div>
    <button type="button" class="btn btn-plain btn-small" data-add-line>＋ Agregar producto</button>
    <div class="grid2" style="margin-top:12px">
      ${field({ name: 'discount', label: 'Descuento del proveedor (en pesos)', type: 'money', value: '' })}
      ${field({ name: 'shipping', label: 'Flete o envío', type: 'money', value: '' })}
      ${field({ name: 'paidAmount', label: 'Cuánto le pagaste ya', type: 'money', value: '', help: 'Vacío = le debes todo.' })}
      ${field({ name: 'method', label: 'Medio de pago', type: 'select', value: 'transferencia', options: methodOptions })}
    </div>
    ${field({ name: 'updateCosts', label: 'Actualizar el costo de estos productos con esta compra', type: 'checkbox', value: true, full: true })}
    <div class="ph-totals" data-totals></div>
    ${field({ name: 'notes', label: 'Notas', type: 'textarea', full: true })}`,
    onOpen: (form) => {
      bindMoneyPreviews(form);
      const recompute = () => {
        const ls = readLines(form, 'purchase');
        const sub = ls.reduce((a, l) => a + Math.round((l.unitCost || 0) * (Number.isFinite(l.qty) ? l.qty : 0)), 0);
        const disc = parsePesos($('[name=discount]', form).value || '0') || 0;
        const ship = parsePesos($('[name=shipping]', form).value || '0') || 0;
        $('[data-totals]', form).innerHTML = `<div><span>Total compra</span><b>${money(sub - disc + ship)}</b></div>${sub ? `<div><span>Factor de costo puesto</span><b>× ${((sub - disc + ship) / sub).toFixed(3)}</b></div>` : ''}`;
      };
      bindLines(form, 'purchase', recompute);
      form.addEventListener('input', (e) => ['discount', 'shipping'].includes(e.target.name) && recompute());
      recompute();
    },
    onSubmit: async (fd, form) => {
      const lines = readLines(form, 'purchase');
      if (!lines.length) return toast('Agrega al menos un producto.', 'error'), false;
      const paidAmount = readMoney(fd, 'paidAmount', { required: false, label: 'El pago' });
      const pu = await exec(createPurchase, { supplierId: fd.get('supplierId'), date: fd.get('date'), invoiceRef: fd.get('invoiceRef'), dueDate: fd.get('dueDate') || null, lines, discount: readMoney(fd, 'discount', { required: false, label: 'El descuento' }), shipping: readMoney(fd, 'shipping', { required: false, label: 'El flete' }), paid: paidAmount ? { amount: paidAmount, method: fd.get('method') } : null, updateCosts: !!fd.get('updateCosts'), notes: fd.get('notes'), requestId: rid }, { success: 'Compra registrada' });
      if (!pu) return false;
    },
  });
}

export function phPurchasePayForm(purchaseId) {
  const pu = P().purchases.find((x) => x.id === purchaseId);
  const t = purchaseTotals(pu);
  openModal({
    title: `Pagar compra ${esc(pu.number)}`,
    subtitle: `Saldo ${money(t.balance)}`,
    body: `<div class="grid2">${field({ name: 'amount', label: 'Valor pagado', type: 'money', value: t.balance, required: true })}${field({ name: 'date', label: 'Fecha', type: 'date', value: localDate() })}${field({ name: 'method', label: 'Medio', type: 'select', value: 'transferencia', options: methodOptions })}</div>`,
    onOpen: (form) => bindMoneyPreviews(form),
    onSubmit: async (fd) => ((await exec(addPurchasePayment, { purchaseId, amount: readMoney(fd, 'amount', { label: 'El pago' }), date: fd.get('date'), method: fd.get('method') }, { success: 'Pago registrado' })) ? undefined : false),
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
      ${field({ name: 'cost', label: 'Costo (lo que te cuesta)', type: 'money', value: x.cost ?? '' })}
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
        const m = Number.isSafeInteger(price) && Number.isSafeInteger(cost) ? productMargin({ price, cost }) : null;
        $('[data-margin]', form).innerHTML = m ? `<div><span>Ganancia por unidad</span><b>${money(m.profit)}</b></div><div><span>Margen</span><b>${pct(m.pct)}</b></div><div><span>Precio para ${P().settings.minMarginPct} %</span><b>${money(Math.ceil(cost / (1 - P().settings.minMarginPct / 100) / 100) * 100)}</b></div>` : '<small class="muted">Escribe el costo para ver el margen.</small>';
      };
      form.addEventListener('input', upd);
      upd();
    },
    onSubmit: async (fd) => {
      const cost = String(fd.get('cost') || '').trim();
      return (await exec(savePhProduct, { id: existing?.id, shopifyId: existing?.shopifyId, name: fd.get('name'), category: fd.get('category'), price: readMoney(fd, 'price', { label: 'El precio' }), cost: cost ? readMoney(fd, 'cost', { label: 'El costo' }) : null, supplierId: fd.get('supplierId') || null, pet: fd.get('pet'), variants: fd.get('variants'), note: fd.get('note'), active: existing ? !!fd.get('active') : true }, { success: 'Producto guardado' })) ? undefined : false;
    },
  });
}
