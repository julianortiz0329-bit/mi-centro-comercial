// Formularios de captura. Todos llaman a comandos de dominio a través de exec().
import { localDate, localTime, formatDate } from '../core/dates.js';
import { parseDecimal, parsePesos } from '../core/money.js';
import { addActivity, addTask, confirmWhatsApp } from '../domain/activities.js';
import { createClient, searchClients, updateClient } from '../domain/clients.js';
import { fromPickedContact, parseContactText } from '../domain/contact-parse.js';
import { rutSummary } from '../domain/rut-parse.js';
import { readRutPdf } from './rut-reader.js';
import { cobroDone, markPaid, skeleton } from './motion.js';
import { createSaleWithPayment } from '../domain/commands.js';
import { changeStatus, computeLine, computeTotals, convertDocument, pendingDispatch, registerDispatch, updateDraftDocument, voidSale } from '../domain/documents.js';
import { saleBalance, isActiveSale } from '../domain/ledger.js';
import { registerPayment, allocatePayment, reversePayment, suggestAllocation } from '../domain/payments.js';
import { pricePerContent, saveProduct, SALE_UNITS, withIva, withoutIva } from '../domain/products.js';
import { lastPriceFor } from '../domain/pricing.js';
import { simulateSaleCommission } from '../domain/commissions.js';
import { ACTIVE_COMPANY_IDS, ACTIVITY_TYPES, CLIENT_STATUSES, DOC_KINDS, PAYMENT_METHODS } from '../domain/schema.js';
import { fillTemplate, normalizePhone, smsLink, telLink, templateVars, waLink } from '../domain/whatsapp.js';
import { getState, run } from '../store/store.js';
import { $, $$, bindMoneyPreviews, confirmDialog, errorMessage, esc, exec, field, haptic, money, openModal, readMoney, requestId, toast } from './dom.js';
import { navigate, ui } from './state.js';

const S = () => getState();
const coOptions = (withEmpty = false) => [...(withEmpty ? [{ value: '', label: 'Selecciona…' }] : []), ...ACTIVE_COMPANY_IDS.map((id) => ({ value: id, label: S().companies[id].name }))];
const defaultCompany = () => (['puntazo', 'nogal'].includes(ui.scope) ? ui.scope : '');
const UNDO_REASON = 'Deshecho justo después de registrarlo (botón Deshacer)';

/** Aviso con "Deshacer". Nada se borra: se reversa o anula con su motivo. */
function offerUndo(message, undo, done = 'Listo, se deshizo') {
  haptic(12);
  toast(message, 'ok', {
    action: {
      label: 'Deshacer',
      onClick: async () => {
        try {
          await undo();
          toast(done);
        } catch (e) {
          toast(errorMessage(e), 'error');
        }
      },
    },
  });
}

async function undoDocument(docId) {
  const s = S();
  const doc = s.documents.find((d) => d.id === docId);
  if (!doc) return;
  if (doc.kind === 'venta') {
    for (const p of s.payments.filter((x) => x.status === 'activo' && x.allocations.some((a) => a.documentId === doc.id))) await run(reversePayment, { paymentId: p.id, reason: UNDO_REASON });
    await run(voidSale, { documentId: doc.id, reason: UNDO_REASON });
  } else await run(changeStatus, { documentId: doc.id, status: 'cancelado', reason: UNDO_REASON });
}

/* ---------- Selector de cliente con búsqueda ---------- */
export function clientPicker({ selectedId = '', label = 'Cliente', locked = false, required = true }) {
  const s = S();
  const c = s.clients.find((x) => x.id === selectedId);
  if (locked && c) return `<div class="field full"><label>${label}</label><input type="text" value="${esc(c.tradeName)} · ${esc(c.code)}" readonly><input type="hidden" name="clientId" value="${c.id}"></div>`;
  const id = `cl_${Math.random().toString(36).slice(2, 7)}`;
  return `<div class="field full picker" data-picker><label for="${id}">${label}${required ? ' <span class="req">*</span>' : ''}</label>
    <input id="${id}" type="search" data-client-search autocomplete="off" role="combobox" aria-expanded="false" aria-controls="${id}_l" placeholder="Toca para ver la lista o escribe nombre, NIT, ciudad…" value="${c ? esc(`${c.tradeName} · ${c.code}`) : ''}">
    <div class="picker-list" id="${id}_l" role="listbox" hidden></div>
    <input type="hidden" name="clientId" value="${esc(selectedId)}"><small data-client-hint></small></div>`;
}

/** Lista desplegable propia (el <datalist> nativo no abre bien en Android). */
export function bindClientPicker(form, onChange) {
  const input = $('[data-client-search]', form);
  if (!input) return;
  const box = input.closest('[data-picker]');
  const list = $('.picker-list', box);
  const hidden = $('input[name=clientId]', box);
  const hint = $('[data-client-hint]', box);
  const company = () => (form.querySelector('[name=companyId]:checked') || form.querySelector('select[name=companyId], input[type=hidden][name=companyId]'))?.value || '';
  const choose = (c) => {
    hidden.value = c ? c.id : '';
    input.value = c ? `${c.tradeName} · ${c.code}` : '';
    hint.textContent = '';
    close();
    onChange?.(c || null);
  };
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  };
  const open = () => {
    const q = input.value.includes(' · ') ? '' : input.value.trim();
    const co = company();
    const all = searchClients(S(), { q }).filter((c) => c.status !== 'bloqueado');
    // Primero los clientes de la empresa elegida.
    all.sort((a, b) => (co ? Number(b.companyIds.includes(co)) - Number(a.companyIds.includes(co)) : 0) || a.tradeName.localeCompare(b.tradeName, 'es'));
    const items = all.slice(0, 30);
    list.innerHTML = `${items.map((c) => `<button type="button" role="option" class="picker-item" data-pick="${c.id}"><b>${esc(c.tradeName)}</b><small>${esc([c.code, c.city, c.taxId].filter(Boolean).join(' · '))}${co && !c.companyIds.includes(co) ? ' · aún no compra en esta empresa' : ''}</small></button>`).join('')}
      ${!items.length ? `<p class="muted small picker-empty">${S().clients.length ? 'Sin coincidencias.' : 'Todavía no tienes clientes registrados.'}</p>` : ''}
      <button type="button" class="picker-item picker-new" data-pick-new>＋ Crear cliente nuevo${q ? ` «${esc(q)}»` : ''}</button>`;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  input.addEventListener('focus', open);
  input.addEventListener('click', open);
  input.addEventListener('input', () => {
    hidden.value = '';
    open();
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) return choose(S().clients.find((c) => c.id === pick.dataset.pick));
    if (e.target.closest('[data-pick-new]')) {
      close();
      quickClientForm({ name: input.value.includes(' · ') ? '' : input.value.trim(), companyId: company(), onCreated: choose });
    }
  });
  input.addEventListener('blur', () =>
    setTimeout(() => {
      close();
      if (input.value && !hidden.value) hint.textContent = 'Elige un cliente de la lista o crea uno nuevo.';
    }, 150),
  );
}

/** Alta rápida de cliente sin salir del formulario de venta, pedido o pago. */
function quickClientForm({ name = '', companyId = '', onCreated }) {
  const rid = requestId();
  openModal({
    title: 'Cliente nuevo',
    subtitle: 'Datos básicos. Puedes completar la ficha después en Clientes.',
    body: `<div class="grid2">${field({ name: 'tradeName', label: 'Nombre comercial', value: name, required: true })}${field({ name: 'phone', label: 'Teléfono / WhatsApp', type: 'tel' })}${field({ name: 'city', label: 'Ciudad' })}${field({ name: 'taxId', label: 'NIT o cédula' })}
      <div class="field full"><label>Empresas</label><div class="checks">${ACTIVE_COMPANY_IDS.map((co) => `<label class="check"><input type="checkbox" name="co_${co}" ${!companyId || co === companyId ? 'checked' : ''}> ${S().companies[co].name}</label>`).join('')}</div></div></div>`,
    submitText: 'Crear y usar',
    onSubmit: async (fd) => {
      const data = { tradeName: fd.get('tradeName'), phone: fd.get('phone'), city: fd.get('city'), taxId: fd.get('taxId'), companyIds: ACTIVE_COMPANY_IDS.filter((co) => fd.get(`co_${co}`)), requestId: rid };
      let c;
      try {
        c = await exec(createClient, data, { success: 'Cliente creado' });
      } catch (e) {
        if (e.code === 'duplicate' && (await confirmDialog({ title: 'Posible cliente repetido', message: `${e.message} ¿Es un cliente distinto y quieres crearlo de todas formas?`, confirmText: 'Crear de todas formas' }))) c = await exec(createClient, { ...data, allowDuplicate: true }, { success: 'Cliente creado' });
        else return false;
      }
      if (!c) return false;
      onCreated(c);
    },
  });
}

function needClient(fd) {
  const id = fd.get('clientId');
  if (!id) {
    toast('Selecciona un cliente de la lista o crea uno nuevo.', 'error');
    return null;
  }
  return id;
}

/* ---------- Clientes ---------- */
const CONTACT_FIELDS = ['tradeName', 'legalName', 'contactName', 'phone', 'whatsapp', 'email', 'taxId', 'department', 'city', 'address'];
const canPickContacts = () => 'contacts' in navigator && 'select' in navigator.contacts;
async function contactProps() {
  const want = ['name', 'tel', 'email', 'address'];
  try {
    const ok = await navigator.contacts.getProperties();
    return want.filter((p) => ok.includes(p));
  } catch {
    return ['name', 'tel'];
  }
}

/** Llena el formulario de cliente con lo detectado; no pisa lo que ya escribiste. */
function fillClientForm(form, data, { overwrite = false } = {}) {
  const filled = [];
  for (const k of CONTACT_FIELDS) {
    const v = data[k];
    const input = form.elements[k];
    if (!v || !input) continue;
    if (input.value.trim() && !overwrite) {
      if (k === 'phone' && !form.elements.whatsapp.value.trim() && normalizePhone(input.value) !== normalizePhone(v)) {
        form.elements.whatsapp.value = v;
        filled.push(form.elements.whatsapp);
      }
      continue;
    }
    input.value = v;
    filled.push(input);
  }
  for (const el of filled) {
    el.classList.remove('just-filled');
    void el.offsetWidth;
    el.classList.add('just-filled');
  }
  checkDuplicatePhone(form);
  if (filled.length) haptic(10);
  return filled.length;
}

/** Lee un RUT en PDF y llena la ficha (revisión antes de guardar). */
async function applyRut(form, file) {
  const box = $('.import-bar', form);
  const note = document.createElement('div');
  note.className = 'notice info full';
  note.innerHTML = `Leyendo el RUT…${skeleton(3)}`;
  box?.insertAdjacentElement('afterend', note);
  try {
    const r = await readRutPdf(file);
    const n = fillClientForm(form, r.client, { overwrite: true });
    const extra = rutSummary(r.client.rut);
    const notes = form.elements.notes;
    if (extra && notes && !notes.value.includes('Responsabilidades RUT')) notes.value = [notes.value.trim(), extra].filter(Boolean).join('\n');
    const tax = r.client.rut?.responsibilities || [];
    note.className = `notice ${n ? 'ok' : 'warn'} full`;
    note.innerHTML = r.empty ? 'Ese PDF es una imagen escaneada: no tiene texto para leer. Pide al cliente el RUT descargado de la DIAN (PDF original) o escribe los datos.' : n ? `RUT leído: ${n} dato(s) completados${tax.includes('48') ? ' · <b>Responsable de IVA</b>' : tax.includes('49') ? ' · <b>No responsable de IVA</b>' : ''}. Revisa antes de guardar.` : `${r.isRut ? 'No pude ubicar los datos en este RUT.' : 'Ese PDF no parece un RUT de la DIAN.'} Escribe los datos a mano.`;
  } catch (e) {
    note.className = 'notice warn full';
    note.textContent = `No se pudo leer el PDF (${e?.message || e}). Si tiene contraseña, pide el RUT sin protección.`;
  }
}

/** Aviso temprano si el número ya pertenece a otro cliente. */
function checkDuplicatePhone(form, ignoreId = null) {
  const box = $('[data-dup]', form);
  if (!box) return;
  const nums = ['phone', 'whatsapp'].map((k) => normalizePhone(form.elements[k]?.value)).filter(Boolean);
  const dup = nums.length ? S().clients.find((c) => c.id !== ignoreId && [c.phone, c.whatsapp].some((x) => nums.includes(normalizePhone(x)))) : null;
  box.hidden = !dup;
  if (dup) box.innerHTML = `Ese número ya es de <b>${esc(dup.tradeName)}</b>. <a href="#/cliente/${dup.id}" data-dup-open>Abrir ese cliente</a>`;
}

export function clientForm(existing = null, opts = {}) {
  const s = S();
  const pre = opts.prefill || {};
  const startCo = opts.companyId || defaultCompany();
  const c = existing || { companyIds: startCo ? [startCo] : [], status: 'activo', terms: {}, tags: [], ...pre };
  const categories = [...new Set(s.clients.map((x) => x.category).filter(Boolean))];
  const termsFor = (co) => {
    const t = c.terms?.[co] || {};
    return `<fieldset class="sub full"><legend>${s.companies[co].icon} ${s.companies[co].name}</legend><div class="grid2">
      ${field({ name: `term_${co}`, label: 'Condición de pago general', type: 'select', value: t.termDays ?? '', options: [{ value: '', label: `General (${s.settings.defaultTermDays} días)` }, { value: '0', label: 'Contado' }, { value: '7', label: '7 días' }, { value: '15', label: '15 días' }, { value: '30', label: '30 días' }, { value: '45', label: '45 días' }, { value: '60', label: '60 días' }, ...(t.termDays != null && ![0, 7, 15, 30, 45, 60].includes(t.termDays) ? [{ value: String(t.termDays), label: `${t.termDays} días` }] : [])] })}
      ${field({ name: `limit_${co}`, label: 'Cupo de crédito (opcional)', type: 'money', value: t.creditLimit || '', help: '0 o vacío = sin cupo definido.' })}</div></fieldset>`;
  };
  const importer = existing ? '' : `<div class="import-bar full">
      <div class="ib-row"><label class="btn btn-secondary btn-small">📄 Leer RUT (PDF)<input type="file" accept="application/pdf,.pdf" data-rut hidden></label><button type="button" class="btn btn-secondary btn-small" data-paste>${'📋'} Pegar datos</button>${canPickContacts() ? '<button type="button" class="btn btn-plain btn-small" data-pick-contact>👤 Desde mis contactos</button>' : ''}</div>
      <small class="muted">Sube el <b>RUT en PDF</b> que te mandó el cliente, o copia en WhatsApp su número o mensaje y toca <b>Pegar datos</b>. También puedes compartir el RUT, un mensaje o un contacto de WhatsApp directo a esta app.</small>
      <div class="ib-paste" hidden><textarea name="pasteText" rows="4" placeholder="Pega aquí el mensaje, el número o los datos del cliente"></textarea><button type="button" class="btn btn-primary btn-small" data-apply-paste>Usar estos datos</button></div>
      ${opts.sourceText ? `<details class="ib-source" open><summary>Datos recibidos de WhatsApp</summary><p class="pre">${esc(opts.sourceText.slice(0, 600))}</p></details>` : ''}
    </div>`;
  const body = `<div class="grid2">
    ${importer}
    <div class="notice warn full" data-dup hidden></div>
    ${field({ name: 'tradeName', label: 'Nombre comercial', value: c.tradeName, required: true, placeholder: 'Ej. Distribuciones La 80' })}
    ${field({ name: 'legalName', label: 'Razón social', value: c.legalName })}
    ${field({ name: 'taxId', label: 'NIT o identificación', value: c.taxId })}
    ${field({ name: 'contactName', label: 'Contacto principal', value: c.contactName })}
    ${field({ name: 'phone', label: 'Teléfono', type: 'tel', value: c.phone, placeholder: '300 123 4567' })}
    ${field({ name: 'whatsapp', label: 'WhatsApp (si es otro número)', type: 'tel', value: c.whatsapp })}
    ${field({ name: 'email', label: 'Correo electrónico', type: 'email', value: c.email })}
    ${field({ name: 'department', label: 'Departamento', value: c.department })}
    ${field({ name: 'city', label: 'Ciudad', value: c.city })}
    ${field({ name: 'address', label: 'Dirección', value: c.address })}
    ${field({ name: 'directions', label: 'Ubicación o indicaciones de visita', value: c.directions, full: true })}
    <div class="field full"><label>Empresas relacionadas <span class="req">*</span></label><div class="checks">${ACTIVE_COMPANY_IDS.map((co) => `<label class="check"><input type="checkbox" name="co_${co}" ${c.companyIds.includes(co) ? 'checked' : ''}> ${s.companies[co].icon} ${s.companies[co].name}</label>`).join('')}</div></div>
    <div class="field"><label>Categoría</label><input name="category" list="catlist" value="${esc(c.category)}" placeholder="Ej. Mayorista, tienda, revendedor"><datalist id="catlist">${categories.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
    ${field({ name: 'status', label: 'Estado comercial', type: 'select', value: c.status, options: Object.entries(CLIENT_STATUSES).map(([value, label]) => ({ value, label })) })}
    ${field({ name: 'nextVisit', label: 'Próxima visita', type: 'date', value: c.nextVisit || '' })}
    ${field({ name: 'tags', label: 'Etiquetas (separadas por coma)', value: (c.tags || []).join(', ') })}
    ${ACTIVE_COMPANY_IDS.map(termsFor).join('')}
    ${field({ name: 'notes', label: 'Observaciones', type: 'textarea', value: c.notes, full: true })}
  </div>`;
  const rid = requestId();
  openModal({
    title: existing ? 'Editar cliente' : 'Nuevo cliente',
    subtitle: existing ? `${esc(existing.code)}` : 'Los datos marcados con * son obligatorios.',
    body,
    wide: true,
    onOpen: (form, close) => {
      bindMoneyPreviews(form);
      $('[data-dup]', form).addEventListener('click', (e) => {
        if (e.target.closest('[data-dup-open]')) close();
      });
      const paneBox = $('.ib-paste', form);
      const apply = (text) => {
        const data = parseContactText(text);
        const n = fillClientForm(form, data);
        if (n) toast(`Listo: ${n} dato(s) completados. Revisa y agrega lo que falte.`);
        else toast('No encontré nombre ni número en ese texto. Revisa lo que pegaste.', 'error');
        return n;
      };
      $('[data-paste]', form)?.addEventListener('click', async () => {
        // Se abre el cuadro de una vez; si el celular deja leer el portapapeles, se llena solo.
        paneBox.hidden = false;
        const ta = $('[name=pasteText]', form);
        ta.focus();
        try {
          const text = await Promise.race([navigator.clipboard.readText(), new Promise((_, rej) => setTimeout(() => rej(new Error('tiempo')), 5000))]);
          if (text && text.trim() && !ta.value.trim() && apply(text)) paneBox.hidden = true;
        } catch {
          /* sin permiso: se pega a mano en el cuadro */
        }
      });
      $('[data-rut]', form)?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) await applyRut(form, file);
      });
      $('[data-apply-paste]', form)?.addEventListener('click', () => {
        const ta = $('[name=pasteText]', form);
        if (apply(ta.value)) {
          ta.value = '';
          paneBox.hidden = true;
        }
      });
      $('[data-pick-contact]', form)?.addEventListener('click', async () => {
        try {
          const [picked] = await navigator.contacts.select(await contactProps(), { multiple: false });
          if (!picked) return;
          const n = fillClientForm(form, fromPickedContact(picked));
          toast(n ? 'Contacto cargado. Agrega la dirección y lo demás.' : 'Ese contacto no tiene nombre ni teléfono.', n ? 'ok' : 'error');
        } catch (e) {
          if (e?.name !== 'AbortError') toast('No se pudo abrir la agenda de contactos en este celular.', 'error');
        }
      });
      form.addEventListener('input', (e) => {
        if (['phone', 'whatsapp'].includes(e.target.name)) checkDuplicatePhone(form, existing?.id);
      });
      if (opts.rutFile) applyRut(form, opts.rutFile);
      if (!existing && Object.keys(pre).length) {
        for (const k of CONTACT_FIELDS) if (pre[k] && form.elements[k]) form.elements[k].classList.add('just-filled');
        checkDuplicatePhone(form);
      }
    },
    onSubmit: async (fd) => {
      const companyIds = ACTIVE_COMPANY_IDS.filter((co) => fd.get(`co_${co}`));
      const terms = {};
      for (const co of ACTIVE_COMPANY_IDS) {
        const t = fd.get(`term_${co}`);
        terms[co] = { termDays: t === '' ? null : Number(t), creditLimit: readMoney(fd, `limit_${co}`, { required: false, label: 'El cupo' }) };
      }
      const data = { tradeName: fd.get('tradeName'), legalName: fd.get('legalName'), taxId: fd.get('taxId'), contactName: fd.get('contactName'), phone: fd.get('phone'), whatsapp: fd.get('whatsapp'), email: fd.get('email'), department: fd.get('department'), city: fd.get('city'), address: fd.get('address'), directions: fd.get('directions'), category: fd.get('category'), status: fd.get('status'), nextVisit: fd.get('nextVisit') || null, tags: String(fd.get('tags') || '').split(',').map((x) => x.trim()).filter(Boolean), notes: fd.get('notes'), companyIds, terms };
      if (existing) {
        await exec(updateClient, { id: existing.id, ...data }, { success: 'Cliente actualizado' });
      } else {
        try {
          const c2 = await exec(createClient, { ...data, requestId: rid }, { success: 'Cliente creado' });
          if (c2) navigate(`#/cliente/${c2.id}`);
        } catch (e) {
          if (e.code === 'duplicate' && (await confirmDialog({ title: 'Posible cliente repetido', message: `${e.message} ¿Es un cliente distinto y quieres crearlo de todas formas?`, confirmText: 'Crear de todas formas' }))) {
            const c3 = await exec(createClient, { ...data, requestId: rid, allowDuplicate: true }, { success: 'Cliente creado' });
            if (c3) navigate(`#/cliente/${c3.id}`);
          } else return false;
        }
      }
    },
  });
}

/* ---------- Documentos: cotización, pedido, venta ---------- */
function lineRow(l) {
  const id = l.id || Math.random().toString(36).slice(2, 8);
  const iva = l.ivaPct ?? 0;
  const neto = Number.isSafeInteger(l.unitPrice) ? withIva(l.unitPrice, iva) : '';
  return `<div class="line-row" data-line="${id}">
    <div class="field lr-desc picker"><label>Producto o concepto</label><input name="desc" autocomplete="off" value="${esc(l.description || '')}" placeholder="Toca para ver el catálogo o escribe" required><div class="picker-list" hidden></div></div>
    <div class="field lr-qty"><label data-qty-label>Cantidad</label><div class="stepper"><button type="button" class="step" data-step="-1" aria-label="Menos">−</button><input name="qty" inputmode="decimal" value="${esc(l.qty ?? 1)}" required><button type="button" class="step" data-step="1" aria-label="Más">+</button></div></div>
    <div class="field lr-price"><label>Precio unit. antes de IVA</label><input name="price" inputmode="numeric" value="${l.unitPrice ?? ''}" required></div>
    <div class="field lr-neto"><label>Precio unit. con IVA</label><input name="neto" inputmode="numeric" value="${neto}"></div>
    <div class="field lr-iva"><label>IVA %</label><select name="iva">${[0, 5, 19].concat([0, 5, 19].includes(Number(iva)) ? [] : [Number(iva)]).map((v) => `<option value="${v}" ${Number(iva) === v ? 'selected' : ''}>${v} %</option>`).join('')}</select></div>
    <div class="field lr-disc"><label>Desc. %</label><input name="disc" inputmode="decimal" value="${esc(l.discountPct ?? 0)}"></div>
    <input type="hidden" name="productId" value="${esc(l.productId || '')}"><input type="hidden" name="presentation" value="${esc(l.presentation || '')}"><input type="hidden" name="contentQty" value="${esc(l.contentQty ?? '')}"><input type="hidden" name="contentUnit" value="${esc(l.contentUnit ?? '')}"><input type="hidden" name="listPrice" value="">
    <p class="lr-note" data-price-note hidden></p>
    <p class="lr-info" data-line-info></p>
    <button type="button" class="icon-btn lr-del" data-del-line aria-label="Quitar línea">🗑</button>
  </div>`;
}

function readLines(form) {
  return $$('.line-row', form).map((r) => ({
    id: r.dataset.line,
    productId: $('[name=productId]', r).value || null,
    presentation: $('[name=presentation]', r).value,
    description: $('[name=desc]', r).value,
    qty: parseDecimal($('[name=qty]', r).value),
    unitPrice: parsePesos($('[name=price]', r).value),
    discountPct: $('[name=disc]', r).value.trim() ? parseDecimal($('[name=disc]', r).value) : 0,
    ivaPct: $('[name=iva]', r).value.trim() ? parseDecimal($('[name=iva]', r).value) : 0,
    contentQty: Number($('[name=contentQty]', r).value) || null,
    contentUnit: $('[name=contentUnit]', r).value || null,
  }));
}

/**
 * kind: cotizacion|pedido|venta. opts: { clientId, companyId, convertFrom (doc), edit (doc) }
 */
export function documentForm(kind, opts = {}) {
  const s = S();
  // src: documento de origen (convertir, editar o repetir un pedido anterior).
  const src = opts.convertFrom || opts.edit || opts.prefill || null;
  const companyId = src?.companyId || opts.companyId || defaultCompany();
  const clientId = src?.clientId || opts.clientId || '';
  const lines = src ? src.lines.map((l) => ({ ...l, id: opts.edit ? l.id : undefined })) : [{}];
  const termVal = src ? String(src.term?.days ?? '') : '';
  const isEdit = !!opts.edit;
  const title = isEdit ? `Editar ${DOC_KINDS[kind].toLowerCase()} ${src.number}` : opts.convertFrom ? `${kind === 'venta' ? 'Registrar venta' : 'Crear pedido'} desde ${src.number}` : opts.prefill ? `Repetir ${opts.prefill.number} como ${DOC_KINDS[kind].toLowerCase()}` : `Nueva ${kind === 'pedido' ? 'pedido' : DOC_KINDS[kind].toLowerCase()}`.replace('Nueva pedido', 'Nuevo pedido');
  const body = `<div class="grid2">
    ${src ? `<input type="hidden" name="companyId" value="${companyId}"><div class="field"><label>Empresa</label><input readonly value="${esc(s.companies[companyId].name)}"></div>` : field({ name: 'companyId', label: 'Empresa', type: 'select', value: companyId, options: coOptions(true), required: true })}
    ${clientPicker({ selectedId: clientId, locked: !!src })}
    ${field({ name: 'date', label: kind === 'venta' ? 'Fecha de la venta' : 'Fecha', type: 'date', value: isEdit ? src.date : localDate(), required: true })}
    ${field({ name: 'time', label: 'Hora', type: 'time', value: isEdit ? src.time : localTime() })}
    <div class="field" data-mode-wrap ${companyId === 'nogal' ? '' : 'hidden'}><label>Modalidad (Frutos del Nogal) <span class="req">*</span></label><select name="saleMode"><option value="">Selecciona…</option><option value="mayorista" ${src?.saleMode === 'mayorista' ? 'selected' : ''}>Mayorista (0,4 % venta / 0,4 % cobro)</option><option value="normal" ${src?.saleMode === 'normal' ? 'selected' : ''}>Normal (0,75 % venta / 0,75 % cobro)</option></select>${src && opts.convertFrom ? '<small>Se conserva la modalidad del documento de origen.</small>' : ''}</div>
    ${kind !== 'cotizacion' ? `<div class="field"><label>Condición de pago</label><select name="term"><option value="">Según el cliente / general</option><option value="0" ${termVal === '0' ? 'selected' : ''}>Contado</option><option value="7" ${termVal === '7' ? 'selected' : ''}>7 días</option><option value="15" ${termVal === '15' ? 'selected' : ''}>15 días</option><option value="30" ${termVal === '30' ? 'selected' : ''}>30 días</option><option value="custom" ${termVal && !['0', '7', '15', '30'].includes(termVal) ? 'selected' : ''}>Plazo personalizado</option></select><small data-term-hint></small></div>
    <div class="field" data-custom-term ${termVal && !['0', '7', '15', '30'].includes(termVal) ? '' : 'hidden'}><label>Días de plazo</label><input name="customDays" type="number" min="0" max="365" value="${esc(termVal)}"></div>` : field({ name: 'validUntil', label: 'Válida hasta', type: 'date', value: src?.validUntil || '' })}
    ${kind === 'venta' ? field({ name: 'externalRef', label: 'N.º de factura o remisión (opcional)', value: src?.externalRef || '' }) : ''}
  </div>
  <h3 class="form-section">Productos</h3>
  <div data-lines>${lines.map((l) => lineRow(l)).join('')}</div>
  <button type="button" class="btn btn-plain btn-small" data-add-line>＋ Agregar línea</button>
  <div class="totals" data-totals></div>
  <div class="sim" data-sim aria-live="polite"></div>
  ${kind === 'venta' ? `<div data-cash hidden class="notice">${field({ name: 'paidNow', label: 'Recibí el pago completo ahora', type: 'checkbox', value: true, help: 'Si no lo recibiste aún, desmárcalo: la venta quedará en cartera con vencimiento hoy.' })}<div class="grid2">${field({ name: 'method', label: 'Método de pago', type: 'select', value: 'efectivo', options: Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label })) })}${field({ name: 'reference', label: 'Referencia / comprobante' })}</div></div>` : ''}
  ${field({ name: 'notes', label: 'Observaciones', type: 'textarea', value: src?.notes || '', full: true })}`;

  const rid = requestId();
  openModal({
    title,
    subtitle: kind === 'venta' ? 'La venta crea la cuenta por cobrar. Los precios se escriben antes de IVA.' : kind === 'pedido' ? 'Un pedido no es cartera hasta que registres la venta.' : 'La cotización no afecta cartera ni comisiones.',
    body,
    wide: true,
    submitText: isEdit ? 'Guardar cambios' : kind === 'venta' ? 'Registrar venta' : 'Guardar',
    onOpen: (form) => {
      // Catálogo de la empresa en una lista propia (el <datalist> no abre bien en Android).
      const productLabel = (p) => `${p.name}${p.presentation ? ' · ' + p.presentation : ''}`;
      const showProducts = (inp) => {
        const co = $('[name=companyId]', form).value;
        const list = inp.parentElement.querySelector('.picker-list');
        const q = inp.value.trim().toLowerCase();
        const qn = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const items = s.products.filter((p) => p.active && p.companyId === co && (!qn || `${p.name} ${p.code} ${p.presentation} ${p.category}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(qn))).sort((a, b) => a.name.localeCompare(b.name, 'es')).slice(0, 40);
        if (!items.length) return (list.hidden = true);
        const cid = $('[name=clientId]', form).value;
        list.innerHTML = items.map((p) => {
          const lp = cid ? lastPriceFor(s, { clientId: cid, companyId: co, productId: p.id }) : null;
          return `<button type="button" class="picker-item" data-prod="${p.id}"><b>${esc(productLabel(p))}</b><small>${money(p.price)} + IVA ${p.ivaPct} % · neto ${money(withIva(p.price, p.ivaPct))}${pricePerContent(p) ? ` · ${money(pricePerContent(p))}/${p.contentUnit === 'und' ? 'und' : 'kg'}` : ''}</small>${lp ? `<small class="client-price">⭐ A este cliente: ${money(lp.unitPrice)} + IVA (${formatDate(lp.date)})</small>` : ''}</button>`;
        }).join('');
        list.hidden = false;
      };
      form.addEventListener('focusin', (e) => e.target.name === 'desc' && showProducts(e.target));
      form.addEventListener('input', (e) => e.target.name === 'desc' && showProducts(e.target));
      form.addEventListener('focusout', (e) => e.target.name === 'desc' && setTimeout(() => (e.target.parentElement.querySelector('.picker-list').hidden = true), 150));
      form.addEventListener('mousedown', (e) => e.target.closest('[data-prod]') && e.preventDefault());
      form.addEventListener('click', (e) => {
        const b = e.target.closest('[data-prod]');
        if (!b) return;
        const p = s.products.find((x) => x.id === b.dataset.prod);
        const row = b.closest('.line-row');
        $('[name=desc]', row).value = productLabel(p);
        $('[name=productId]', row).value = p.id;
        $('[name=presentation]', row).value = p.presentation;
        // Si ya se le vendió o cotizó a este cliente, se propone ese precio.
        const cid = $('[name=clientId]', form).value;
        const lp = cid ? lastPriceFor(s, { clientId: cid, companyId: p.companyId, productId: p.id }) : null;
        const price = lp ? lp.unitPrice : p.price;
        $('[name=price]', row).value = price;
        $('[name=listPrice]', row).value = p.price;
        $('[name=disc]', row).value = lp?.discountPct || 0;
        row.dataset.priceNote = lp ? `⭐ Precio que le diste a este cliente el ${formatDate(lp.date)} (${lp.number}). Lista: ${money(p.price)}.` : '';
        setIva(row, p.ivaPct);
        $('[name=neto]', row).value = withIva(price, p.ivaPct);
        $('[name=contentQty]', row).value = p.contentQty || '';
        $('[name=contentUnit]', row).value = p.contentQty ? p.contentUnit : '';
        b.closest('.picker-list').hidden = true;
        recompute();
      });
      const setIva = (row, v) => {
        const sel = $('[name=iva]', row);
        if (![...sel.options].some((o) => Number(o.value) === Number(v))) sel.insertAdjacentHTML('beforeend', `<option value="${v}">${v} %</option>`);
        sel.value = String(Number(v));
      };
      // Precio antes de IVA ⇄ precio con IVA: se puede escribir cualquiera de los dos.
      form.addEventListener('input', (e) => {
        const row = e.target.closest('.line-row');
        if (!row) return;
        const iva = parseDecimal($('[name=iva]', row).value) || 0;
        if (e.target.name === 'price') {
          const p = parsePesos(e.target.value);
          $('[name=neto]', row).value = Number.isSafeInteger(p) ? withIva(p, iva) : '';
        } else if (e.target.name === 'neto') {
          const n = parsePesos(e.target.value);
          $('[name=price]', row).value = Number.isSafeInteger(n) ? withoutIva(n, iva) : '';
        }
      });
      form.addEventListener('change', (e) => {
        const row = e.target.closest('.line-row');
        if (['saleMode', 'date', 'companyId'].includes(e.target.name)) recompute();
        if (row && e.target.name === 'iva') {
          const p = parsePesos($('[name=price]', row).value);
          $('[name=neto]', row).value = Number.isSafeInteger(p) ? withIva(p, parseDecimal(e.target.value) || 0) : '';
          recompute();
        }
      });
      form.addEventListener('click', (e) => {
        const ul = e.target.closest('[data-use-list]');
        if (ul) {
          const row = ul.closest('.line-row');
          const lp = parsePesos($('[name=listPrice]', row).value);
          if (Number.isSafeInteger(lp)) {
            $('[name=price]', row).value = lp;
            $('[name=neto]', row).value = withIva(lp, parseDecimal($('[name=iva]', row).value) || 0);
            $('[name=disc]', row).value = 0;
            row.dataset.priceNote = '';
            recompute();
          }
          return;
        }
        const st = e.target.closest('[data-step]');
        if (!st) return;
        const inp = st.parentElement.querySelector('[name=qty]');
        const v = parseDecimal(inp.value) || 0;
        inp.value = String(Math.max(1, Math.round((v + Number(st.dataset.step)) * 1000) / 1000));
        recompute();
      });
      const recompute = () => {
        for (const row of $$('.line-row', form)) {
          const qty = parseDecimal($('[name=qty]', row).value);
          const price = parsePesos($('[name=price]', row).value);
          const cq = Number($('[name=contentQty]', row).value);
          const cu = $('[name=contentUnit]', row).value === 'und' ? 'und' : 'kg';
          const pres = $('[name=presentation]', row).value;
          const info = $('[data-line-info]', row);
          const lbl = $('[data-qty-label]', row);
          const unitWord = (pres.split(' x ')[0] || '').toLowerCase();
          lbl.textContent = unitWord && cq ? `Cantidad (${unitWord}s)` : 'Cantidad';
          if (!Number.isFinite(qty) || !Number.isSafeInteger(price)) {
            info.textContent = '';
            continue;
          }
          const disc = parseDecimal($('[name=disc]', row).value) || 0;
          const iva = parseDecimal($('[name=iva]', row).value) || 0;
          const c = computeLine({ qty, unitPrice: price, discountPct: disc, ivaPct: iva });
          const parts = [];
          if (pres) parts.push(pres);
          if (cq > 0) parts.push(`${money(Math.round(price * (1 - disc / 100) / cq))}/${cu} antes de IVA`, `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(qty * cq)} ${cu} en total`);
          parts.push(`Línea: ${money(c.total)} con IVA`);
          info.textContent = parts.join(' · ');
          const pn = $('[data-price-note]', row);
          pn.hidden = !row.dataset.priceNote;
          pn.innerHTML = row.dataset.priceNote ? `${esc(row.dataset.priceNote)} <button type="button" class="linklike" data-use-list>Usar precio de lista</button>` : '';
        }
        const ls = readLines(form);
        const valid = ls.every((l) => Number.isFinite(l.qty) && l.qty > 0 && Number.isSafeInteger(l.unitPrice) && l.unitPrice >= 0 && Number.isFinite(l.discountPct) && Number.isFinite(l.ivaPct));
        const t = valid ? computeTotals(ls) : null;
        const simEl = $('[data-sim]', form);
        const co = $('[name=companyId]', form).value;
        if (t && co) {
          const sim = simulateSaleCommission(S(), { companyId: co, date: $('[name=date]', form).value || localDate(), net: t.net, total: t.total, saleMode: $('[name=saleMode]', form).value || src?.saleMode });
          if (!sim) simEl.innerHTML = '';
          else if (sim.missingMode) simEl.innerHTML = '<b>💰 Comisión estimada:</b> elige la modalidad (mayorista o normal) para calcularla.';
          else if (sim.kind === 'recaudo') simEl.innerHTML = `<b>💰 Comisión estimada:</b> ${money(sim.collection)} cuando cobres el total (6 % de ${money(sim.collectionBase)}). ${esc(sim.note)}`;
          else simEl.innerHTML = `<b>💰 Comisión estimada${kind === 'venta' ? '' : ' si se factura hoy'}:</b> venta ${money(sim.sale)} + cobro ${money(sim.collection)} = <b>${money(sim.sale + sim.collection)}</b>${sim.onHold ? ' <span class="pill warn">en espera</span>' : ''}<br><small>${esc(sim.note.replace(/(\d{4,})/g, (n) => money(Number(n))))} El cobro sigue al mes de la venta.</small>`;
        } else simEl.innerHTML = '';
        $('[data-totals]', form).innerHTML = t ? `<div><span>Subtotal</span><b>${money(t.gross)}</b></div><div><span>Descuentos</span><b>− ${money(t.discount)}</b></div><div><span>Valor antes de IVA</span><b>${money(t.net)}</b></div><div><span>IVA</span><b>${money(t.iva)}</b></div><div class="grand"><span>Total</span><b>${money(t.total)}</b></div>` : '<p class="muted">Completa cantidades y precios válidos para ver los totales.</p>';
      };
      const termUI = () => {
        const sel = $('[name=term]', form);
        if (!sel) return;
        $('[data-custom-term]', form).hidden = sel.value !== 'custom';
        const cash = $('[data-cash]', form);
        if (cash) cash.hidden = sel.value !== '0';
        const cid = $('[name=clientId]', form).value;
        const co = $('[name=companyId]', form).value;
        const c = s.clients.find((x) => x.id === cid);
        const t = c?.terms?.[co]?.termDays;
        $('[data-term-hint]', form).textContent = sel.value === '' ? `Se aplicará: ${Number.isInteger(t) ? (t === 0 ? 'contado (cliente)' : `${t} días (cliente)`) : `${s.settings.defaultTermDays} días (general)`}` : '';
      };
      $('[name=companyId]', form).addEventListener('change', () => {
        $('[data-mode-wrap]', form).hidden = $('[name=companyId]', form).value !== 'nogal';
        termUI();
      });
      $('[name=term]', form)?.addEventListener('change', termUI);
      bindClientPicker(form, termUI);
      form.addEventListener('input', recompute);
      form.addEventListener('change', (e) => {
        if (e.target.name === 'desc') {
          const row = e.target.closest('.line-row');
          const p = s.products.find((x) => x.id === $('[name=productId]', row).value);
          if (p && productLabel(p) !== e.target.value) $('[name=productId]', row).value = '';
        }
      });
      form.addEventListener('click', (e) => {
        if (e.target.closest('[data-add-line]')) {
          $('[data-lines]', form).insertAdjacentHTML('beforeend', lineRow({}));
          recompute();
        }
        const del = e.target.closest('[data-del-line]');
        if (del) {
          if ($$('.line-row', form).length > 1) del.closest('.line-row').remove();
          else toast('El documento necesita al menos una línea.', 'error');
          recompute();
        }
      });
      termUI();
      recompute();
    },
    onSubmit: async (fd, form) => {
      const cid = needClient(fd);
      if (!cid) return false;
      const ls = readLines(form);
      const term = fd.get('term');
      const termDays = term === 'custom' ? Number(fd.get('customDays')) : term === '' || term === null ? undefined : Number(term);
      const base = { companyId: fd.get('companyId'), clientId: cid, kind, date: fd.get('date'), time: fd.get('time'), lines: ls, termDays, saleMode: fd.get('saleMode') || src?.saleMode || null, notes: fd.get('notes'), externalRef: fd.get('externalRef') || '', validUntil: fd.get('validUntil') || null, requestId: rid };
      if (isEdit) {
        await exec(updateDraftDocument, { documentId: src.id, lines: ls, notes: base.notes, termDays, saleMode: base.saleMode, date: base.date, time: base.time, validUntil: base.validUntil }, { success: 'Documento actualizado' });
        return;
      }
      const payment = kind === 'venta' && term === '0' && fd.get('paidNow') ? { method: fd.get('method'), reference: fd.get('reference') } : null;
      let doc;
      if (opts.convertFrom) {
        if (kind === 'venta') doc = await exec(createSaleWithPayment, { ...base, convertFrom: src.id, payment }, { success: 'Venta registrada' });
        else {
          doc = await exec(convertDocument, { documentId: src.id, toKind: 'pedido', lines: ls, date: base.date, time: base.time, notes: base.notes, termDays, requestId: rid }, { success: 'Pedido creado' });
        }
      } else {
        doc = await exec(createSaleWithPayment, { ...base, payment });
        if (doc) offerUndo(`${DOC_KINDS[kind]} ${doc.number} registrad${kind === 'pedido' ? 'o' : 'a'}`, async () => {
          await undoDocument(doc.id);
          navigate('#/ventas');
        }, kind === 'venta' ? 'Venta anulada (queda en el historial)' : 'Documento cancelado (queda en el historial)');
      }
      if (doc) navigate(`#/doc/${doc.id}`);
      else return false;
    },
  });
}

/* ---------- Pagos ---------- */
export function paymentForm(opts = {}) {
  const s = S();
  const doc = opts.documentId ? s.documents.find((d) => d.id === opts.documentId) : null;
  const companyId = doc?.companyId || opts.companyId || defaultCompany();
  const clientId = doc?.clientId || opts.clientId || '';
  const existing = opts.paymentId ? s.payments.find((p) => p.id === opts.paymentId) : null; // aplicar saldo no aplicado
  const body = existing
    ? `<div class="notice">Pago ${esc(existing.number)} · disponible sin aplicar: <b>${money(existing.amount - existing.allocations.reduce((a, x) => a + x.amount, 0))}</b></div><input type="hidden" name="companyId" value="${existing.companyId}"><input type="hidden" name="clientId" value="${existing.clientId}"><div data-allocs></div>`
    : `<div class="grid2">
      ${doc ? `<input type="hidden" name="companyId" value="${companyId}"><div class="field"><label>Empresa</label><input readonly value="${esc(s.companies[companyId].name)}"></div>` : field({ name: 'companyId', label: 'Empresa', type: 'select', value: companyId, options: coOptions(true), required: true })}
      ${clientPicker({ selectedId: clientId, locked: !!doc || !!opts.clientId })}
      ${field({ name: 'date', label: 'Fecha del recaudo', type: 'date', value: localDate(), required: true, attrs: `max="${localDate()}"` })}
      ${field({ name: 'time', label: 'Hora', type: 'time', value: localTime() })}
      ${field({ name: 'amount', label: 'Valor recibido', type: 'money', required: true, value: doc ? saleBalance(s, doc) : '' })}
      ${field({ name: 'method', label: 'Método de pago', type: 'select', value: 'transferencia', options: Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label })), required: true })}
      ${field({ name: 'reference', label: 'Referencia o comprobante', placeholder: 'N.º de transferencia, recibo…' })}
      ${field({ name: 'notes', label: 'Observaciones' })}
    </div>
    <h3 class="form-section">¿A qué cuentas se aplica?</h3><div data-allocs></div>`;
  const rid = requestId();
  openModal({
    title: existing ? 'Aplicar pago a cartera' : 'Registrar pago recibido',
    subtitle: existing ? '' : 'Lo que no apliques queda como "pago sin aplicar": no reduce cartera ni genera comisión hasta que lo asignes.',
    body,
    wide: true,
    submitText: existing ? 'Aplicar' : 'Registrar pago',
    onOpen: (form) => {
      bindMoneyPreviews(form);
      const wrap = $('[data-allocs]', form);
      const render = () => {
        const co = $('[name=companyId]', form).value;
        const cid = $('[name=clientId]', form).value;
        if (!co || !cid) {
          wrap.innerHTML = '<p class="muted">Selecciona la empresa y el cliente para ver sus cuentas pendientes.</p>';
          return;
        }
        const open = s.documents.filter((d) => isActiveSale(d) && d.companyId === co && d.clientId === cid).map((d) => ({ d, bal: saleBalance(s, d) })).filter((x) => x.bal > 0).sort((a, b) => a.d.dueDate.localeCompare(b.d.dueDate));
        if (!open.length) {
          wrap.innerHTML = '<p class="muted">Este cliente no tiene saldos pendientes en esta empresa. El pago quedará sin aplicar.</p>';
          return;
        }
        const owed = open.reduce((a, x) => a + x.bal, 0);
        const overdue = open.filter((x) => x.d.dueDate < localDate()).reduce((a, x) => a + x.bal, 0);
        const chips = existing ? '' : `<div class="amt-chips" role="group" aria-label="Valores rápidos"><button type="button" data-fill="${owed}">Todo el saldo · ${money(owed)}</button>${overdue && overdue !== owed ? `<button type="button" data-fill="${overdue}">Solo lo vencido · ${money(overdue)}</button>` : ''}${owed >= 2000 ? `<button type="button" data-fill="${Math.round(owed / 2 / 100) * 100}">La mitad · ${money(Math.round(owed / 2 / 100) * 100)}</button>` : ''}</div>`;
        wrap.innerHTML = `${chips}<div class="alloc-head"><button type="button" class="btn btn-plain btn-small" data-auto>Distribuir automáticamente (más antiguas primero)</button></div>
          <div class="alloc-list">${open.map(({ d, bal }) => `<label class="alloc"><span><b>${esc(d.number)}</b>${d.externalRef ? ` · ${esc(d.externalRef)}` : ''}<small>Vence ${formatDate(d.dueDate)} · saldo ${money(bal)}</small></span><input inputmode="numeric" data-alloc="${d.id}" data-max="${bal}" placeholder="0" value="${doc && doc.id === d.id ? bal : ''}" aria-label="Valor aplicado a ${esc(d.number)}"></label>`).join('')}</div>
          <div class="alloc-sum" data-sum></div>`;
        sumUp();
      };
      const sumUp = () => {
        const amt = existing ? existing.amount - existing.allocations.reduce((a, x) => a + x.amount, 0) : parsePesos($('[name=amount]', form)?.value || '');
        const applied = $$('[data-alloc]', form).reduce((a, i) => a + (parsePesos(i.value) || 0), 0);
        const el = $('[data-sum]', form);
        if (!el) return;
        const left = (Number.isSafeInteger(amt) ? amt : 0) - applied;
        el.innerHTML = `Aplicado: <b>${money(applied)}</b> · ${left >= 0 ? `Sin aplicar: <b>${money(left)}</b>` : `<span class="danger">Excede el pago en ${money(-left)}</span>`}`;
      };
      form.addEventListener('input', (e) => {
        if (e.target.matches('[data-alloc],[name=amount]')) sumUp();
      });
      form.addEventListener('change', (e) => {
        if (e.target.name === 'companyId') render();
      });
      form.addEventListener('click', (e) => {
        const fill = e.target.closest('[data-fill]');
        if (fill) {
          const amt = $('[name=amount]', form);
          amt.value = new Intl.NumberFormat('es-CO').format(Number(fill.dataset.fill));
          amt.dispatchEvent(new Event('input', { bubbles: true }));
          $$('[data-fill]', form).forEach((b) => b.classList.toggle('on', b === fill));
          haptic(8);
          $('[data-auto]', form)?.click();
          return;
        }
        if (!e.target.closest('[data-auto]')) return;
        const amt = existing ? existing.amount - existing.allocations.reduce((a, x) => a + x.amount, 0) : parsePesos($('[name=amount]', form).value);
        if (!Number.isSafeInteger(amt) || amt <= 0) return toast('Escribe primero el valor recibido.', 'error');
        const sug = suggestAllocation(s, { companyId: $('[name=companyId]', form).value, clientId: $('[name=clientId]', form).value, amount: amt });
        for (const x of sug) {
          const i = $(`[data-alloc="${x.documentId}"]`, form);
          if (i) i.value = x.amount || '';
        }
        sumUp();
      });
      bindClientPicker(form, render);
      render();
    },
    onSubmit: async (fd, form) => {
      const allocations = $$('[data-alloc]', form).map((i) => ({ documentId: i.dataset.alloc, amount: i.value.trim() ? parsePesos(i.value) : 0 }));
      if (allocations.some((a) => !Number.isSafeInteger(a.amount) || a.amount < 0)) {
        toast('Revisa los valores aplicados: deben ser montos en pesos.', 'error');
        return false;
      }
      if (existing) {
        await exec(allocatePayment, { paymentId: existing.id, allocations }, { success: 'Pago aplicado' });
        return;
      }
      const cid = needClient(fd);
      if (!cid) return false;
      const p = await exec(registerPayment, { companyId: fd.get('companyId'), clientId: cid, date: fd.get('date'), time: fd.get('time'), amount: readMoney(fd, 'amount', { label: 'El valor recibido' }), method: fd.get('method'), reference: fd.get('reference'), notes: fd.get('notes'), allocations, requestId: rid });
      if (!p) return false;
      for (const a of p.allocations) {
        const d = S().documents.find((x) => x.id === a.documentId);
        if (d && saleBalance(S(), d) === 0) markPaid(d.id);
      }
      const confirmShown = cobroDone(p.amount, S().clients.find((c) => c.id === p.clientId)?.tradeName);
      offerUndo(`Pago de ${money(p.amount)} registrado`, () => run(reversePayment, { paymentId: p.id, reason: UNDO_REASON }), 'Pago reversado (queda en el historial)');
      const client = S().clients.find((c) => c.id === p.clientId);
      const firstDoc = S().documents.find((d) => d.id === p.allocations[0]?.documentId);
      await confirmShown;
      if (normalizePhone(client.whatsapp || client.phone) && (await confirmDialog({ title: 'Confirmación al cliente', message: `¿Le envías a ${client.tradeName} la confirmación del abono por WhatsApp?`, confirmText: 'Sí, preparar mensaje' }))) {
        whatsappComposer({ clientId: client.id, companyId: p.companyId, template: 'abono', documentId: firstDoc?.id, paymentId: p.id });
      }
    },
  });
}

/* ---------- Despachos ---------- */
export function dispatchForm(doc) {
  const s = S();
  const pend = pendingDispatch(s, doc);
  const body = `<div class="grid2">${field({ name: 'date', label: 'Fecha de despacho', type: 'date', value: localDate(), required: true })}${field({ name: 'carrier', label: 'Transportadora' })}${field({ name: 'guide', label: 'N.º de guía' })}</div>
  <h3 class="form-section">Cantidades despachadas</h3>
  <div class="alloc-list">${pend.map((p) => `<label class="alloc"><span><b>${esc(p.line.description)}</b><small>Pedido ${p.line.qty} · despachado ${p.dispatched} · pendiente ${p.pending}</small></span><input inputmode="decimal" data-dq="${p.line.id}" value="${p.pending || ''}" ${p.pending <= 0 ? 'disabled' : ''} aria-label="Cantidad a despachar"></label>`).join('')}</div>
  ${field({ name: 'notes', label: 'Notas del despacho', type: 'textarea', full: true })}`;
  const rid = requestId();
  openModal({
    title: `Registrar despacho · ${doc.number}`,
    subtitle: 'Si despachas menos de lo pedido, el pedido queda en "Despacho parcial".',
    body,
    wide: true,
    submitText: 'Registrar despacho',
    onSubmit: async (fd, form) => {
      const lines = $$('[data-dq]', form).filter((i) => !i.disabled).map((i) => ({ lineId: i.dataset.dq, qty: parseDecimal(i.value || '0') }));
      if (lines.some((l) => !Number.isFinite(l.qty) || l.qty < 0)) {
        toast('Revisa las cantidades.', 'error');
        return false;
      }
      const d = await exec(registerDispatch, { documentId: doc.id, date: fd.get('date'), carrier: fd.get('carrier'), guide: fd.get('guide'), notes: fd.get('notes'), lines, requestId: rid }, { success: 'Despacho registrado' });
      if (!d) return false;
      const client = S().clients.find((c) => c.id === doc.clientId);
      if (normalizePhone(client.whatsapp || client.phone) && (await confirmDialog({ title: 'Avisar al cliente', message: `¿Le avisas a ${client.tradeName} del despacho por WhatsApp?`, confirmText: 'Sí, preparar mensaje' }))) whatsappComposer({ clientId: client.id, companyId: doc.companyId, template: 'despacho', documentId: doc.id, dispatchId: d.id });
    },
  });
}

/* ---------- Gestiones (llamadas, visitas, promesas…) ---------- */
export function activityForm({ clientId, documentId = null, type = 'llamada', companyId = null }) {
  const s = S();
  const doc = documentId ? s.documents.find((d) => d.id === documentId) : null;
  const bal = doc ? saleBalance(s, doc) : 0;
  const body = `<div class="grid2">
    ${field({ name: 'type', label: 'Tipo de gestión', type: 'select', value: type, options: Object.entries(ACTIVITY_TYPES).filter(([k]) => k !== 'whatsapp').map(([value, label]) => ({ value, label })) })}
    ${field({ name: 'date', label: 'Fecha', type: 'date', value: localDate(), required: true })}
    ${field({ name: 'time', label: 'Hora', type: 'time', value: localTime() })}
    ${field({ name: 'result', label: 'Resultado', placeholder: 'Ej. contestó, pidió llamar luego…' })}
    <div class="sub full" data-promise ${type === 'promesa' ? '' : 'hidden'}><div class="grid2">${field({ name: 'promiseDate', label: 'Fecha comprometida', type: 'date' })}${field({ name: 'promiseAmount', label: 'Valor comprometido', type: 'money', value: bal || '' })}</div></div>
    ${field({ name: 'nextDate', label: 'Próxima acción (fecha)', type: 'date' })}
    ${field({ name: 'nextText', label: 'Próxima acción (qué hacer)', placeholder: 'Ej. volver a llamar' })}
    ${doc ? field({ name: 'dispute', label: 'Marcar esta cuenta "en disputa"', type: 'checkbox', value: !!doc.dispute?.active, full: true, help: 'Útil si el cliente objeta la factura. Desmarca para quitarla.' }) : ''}
    ${field({ name: 'notes', label: 'Notas', type: 'textarea', full: true })}
  </div>`;
  const rid = requestId();
  openModal({
    title: 'Registrar gestión',
    subtitle: doc ? `${esc(doc.number)} · saldo ${money(bal)}` : esc(s.clients.find((c) => c.id === clientId)?.tradeName || ''),
    body,
    wide: true,
    onOpen: (form) => {
      bindMoneyPreviews(form);
      $('[name=type]', form).addEventListener('change', (e) => ($('[data-promise]', form).hidden = e.target.value !== 'promesa'));
    },
    onSubmit: async (fd) => {
      const t = fd.get('type');
      const input = { clientId, documentId, companyId, type: t, date: fd.get('date'), time: fd.get('time'), result: fd.get('result'), notes: fd.get('notes'), nextAction: fd.get('nextDate') ? { date: fd.get('nextDate'), text: fd.get('nextText') } : null, requestId: rid };
      if (t === 'promesa') input.promise = { date: fd.get('promiseDate'), amount: readMoney(fd, 'promiseAmount', { label: 'El valor comprometido' }) };
      if (doc) input.dispute = !!fd.get('dispute');
      return (await exec(addActivity, input, { success: 'Gestión registrada' })) ? undefined : false;
    },
  });
}

/* ---------- WhatsApp ---------- */
export function whatsappComposer({ clientId, companyId = null, template = null, documentId = null, paymentId = null, activityId = null, dispatchId = null, presetText = null }) {
  const s = S();
  const client = s.clients.find((c) => c.id === clientId);
  const doc = documentId ? s.documents.find((d) => d.id === documentId) : null;
  const co = doc?.companyId || companyId || client.companyIds.find((x) => ACTIVE_COMPANY_IDS.includes(x)) || 'puntazo';
  const payment = paymentId ? s.payments.find((p) => p.id === paymentId) : null;
  const promAct = activityId ? s.activities.find((a) => a.id === activityId) : s.activities.filter((a) => a.type === 'promesa' && a.promise?.status === 'pendiente' && a.clientId === clientId && (!documentId || a.documentId === documentId)).pop();
  const dispatch = dispatchId ? s.dispatches.find((d) => d.id === dispatchId) : doc ? s.dispatches.filter((d) => d.documentId === doc.id).pop() : null;
  const balance = doc && doc.kind === 'venta' ? saleBalance(s, doc) : s.documents.filter((d) => isActiveSale(d) && d.clientId === clientId && d.companyId === co).reduce((a, d) => a + saleBalance(s, d), 0);
  const vars = templateVars(s, { client, companyId: co, doc, balance, payment, promise: promAct?.promise, dispatch });
  const tpls = s.settings.waTemplates;
  const tkey = template || (doc?.kind === 'cotizacion' ? 'cotizacion' : doc?.kind === 'pedido' ? 'pedido' : doc ? 'recordatorio' : 'presentacion');
  const phone = client.whatsapp || client.phone;
  const norm = normalizePhone(phone);
  const body = `${norm ? `<p class="muted">Se abrirá WhatsApp con el número <b>+${esc(norm)}</b>. Revisa y edita el mensaje antes de enviarlo.</p>` : `<div class="notice warn">El cliente no tiene un teléfono válido para WhatsApp. Puedes copiar el mensaje o actualizar su ficha.</div>`}
    ${field({ name: 'tpl', label: 'Plantilla', type: 'select', value: tkey, options: Object.entries(tpls).map(([value, t]) => ({ value, label: t.label })) })}
    ${field({ name: 'text', label: 'Mensaje', type: 'textarea', value: presetText ?? fillTemplate(tpls[tkey]?.text, vars), full: true, attrs: presetText ? 'rows="14"' : 'rows="6"' })}
    <p class="muted small" data-missing></p>
    <div class="wa-actions">
      ${norm ? '<a class="btn btn-wa" data-open-wa target="_blank" rel="noopener">Abrir WhatsApp</a>' : ''}
      <button type="button" class="btn btn-plain" data-copy>Copiar mensaje</button>
      ${norm ? `<a class="btn btn-plain" href="${telLink(phone)}">Llamar</a><a class="btn btn-plain" data-sms>SMS</a>` : ''}
    </div>
    <div data-confirm hidden class="notice">¿Enviaste el mensaje? La app no puede saberlo por sí sola.<div class="wa-actions"><button type="button" class="btn btn-primary btn-small" data-sent="enviado">Sí, lo envié</button><button type="button" class="btn btn-plain btn-small" data-sent="no_enviado">No se envió</button></div></div>`;
  let actId = null;
  openModal({
    title: `WhatsApp · ${esc(client.tradeName)}`,
    body,
    wide: true,
    cancelText: 'Cerrar',
    onOpen: (form, close) => {
      const ta = $('[name=text]', form);
      const upd = () => {
        const a = $('[data-open-wa]', form);
        if (a) a.href = waLink(phone, ta.value);
        const sms = $('[data-sms]', form);
        if (sms) sms.href = smsLink(phone, ta.value);
        const miss = ta.value.match(/\[(\w+)\]/g);
        $('[data-missing]', form).textContent = miss ? `Completa antes de enviar: ${miss.join(', ')}` : '';
      };
      $('[name=tpl]', form).addEventListener('change', (e) => {
        ta.value = fillTemplate(tpls[e.target.value]?.text, vars);
        upd();
      });
      ta.addEventListener('input', upd);
      upd();
      $('[data-open-wa]', form)?.addEventListener('click', async () => {
        // Solo se registra que se INICIÓ el contacto.
        const a = await exec(addActivity, { clientId, companyId: co, documentId: doc?.id || null, type: 'whatsapp', result: 'Contacto iniciado (sin confirmar envío)', notes: ta.value, title: `WhatsApp: ${tpls[$('[name=tpl]', form).value]?.label || 'mensaje'}` }).catch(() => null);
        actId = a?.id || null;
        $('[data-confirm]', form).hidden = false;
      });
      $('[data-copy]', form).addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(ta.value);
          toast('Mensaje copiado');
        } catch {
          ta.select();
          toast('Selecciona y copia el texto manualmente.', 'error');
        }
      });
      form.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-sent]');
        if (!b || !actId) return;
        await exec(confirmWhatsApp, { activityId: actId, outcome: b.dataset.sent }, { success: b.dataset.sent === 'enviado' ? 'Registrado como enviado' : 'Registrado como no enviado' });
        close();
      });
    },
  });
}

/* ---------- Tareas ---------- */
export function taskForm(opts = {}) {
  const body = `<div class="grid2">
    ${field({ name: 'title', label: '¿Qué tienes que hacer?', required: true, value: opts.title || '', placeholder: 'Ej. Visitar cliente en Itagüí', full: true })}
    ${field({ name: 'type', label: 'Tipo', type: 'select', value: opts.type || 'visita', options: [{ value: 'visita', label: 'Visita' }, { value: 'llamada', label: 'Llamada' }, { value: 'cobro', label: 'Cobro' }, { value: 'despacho', label: 'Despacho' }, { value: 'recuperacion', label: 'Recuperación de cliente' }, { value: 'otro', label: 'Otra' }] })}
    ${field({ name: 'date', label: 'Fecha', type: 'date', value: opts.date || localDate(), required: true })}
    ${field({ name: 'time', label: 'Hora (opcional)', type: 'time' })}
    ${field({ name: 'companyId', label: 'Empresa', type: 'select', value: opts.companyId ?? defaultCompany(), options: [{ value: '', label: 'General' }, ...coOptions()] })}
    ${opts.clientId ? `<input type="hidden" name="clientId" value="${opts.clientId}">` : clientPicker({ label: 'Cliente (opcional)', required: false })}
    ${field({ name: 'notes', label: 'Notas', type: 'textarea', full: true })}
  </div>`;
  const rid = requestId();
  openModal({
    title: 'Programar tarea',
    body,
    wide: true,
    onOpen: (form) => bindClientPicker(form),
    onSubmit: async (fd) => (await exec(addTask, { title: fd.get('title'), type: fd.get('type'), date: fd.get('date'), time: fd.get('time'), companyId: fd.get('companyId') || null, clientId: fd.get('clientId') || null, documentId: opts.documentId || null, notes: fd.get('notes'), requestId: rid }, { success: 'Tarea programada' })) ? undefined : false,
  });
}

/* ---------- Productos ---------- */
export function productForm(existing = null, companyId = null) {
  const p = existing || { companyId: companyId || defaultCompany() || 'nogal', ivaPct: 19, saleUnit: 'caja', contentUnit: 'kg' };
  const cats = [...new Set(S().products.map((x) => x.category).filter(Boolean))].sort();
  const body = `<div class="grid2">
    ${existing ? `<input type="hidden" name="companyId" value="${p.companyId}">` : field({ name: 'companyId', label: 'Empresa', type: 'select', value: p.companyId, options: coOptions(true), required: true })}
    ${field({ name: 'name', label: 'Nombre', value: p.name, required: true, placeholder: 'Ej. Almendra Nonpareil 32-34' })}
    ${field({ name: 'code', label: 'Código / referencia', value: p.code })}
    <div class="field"><label>Categoría</label><input name="category" list="catp" value="${esc(p.category || '')}"><datalist id="catp">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
    ${field({ name: 'saleUnit', label: 'Se vende por', type: 'select', value: p.saleUnit || 'caja', options: SALE_UNITS.map((u) => ({ value: u, label: u.charAt(0).toUpperCase() + u.slice(1) })) })}
    <div class="field"><label>Contenido de la presentación</label><div class="inline2"><input name="contentQty" inputmode="decimal" value="${esc(p.contentQty ?? '')}" placeholder="Ej. 22,68"><select name="contentUnit"><option value="kg" ${p.contentUnit !== 'und' ? 'selected' : ''}>kg</option><option value="und" ${p.contentUnit === 'und' ? 'selected' : ''}>unidades</option></select></div></div>
    ${field({ name: 'ivaPct', label: 'IVA', type: 'select', value: String(p.ivaPct ?? 19), options: [{ value: '0', label: '0 % (sin IVA / excluido)' }, { value: '5', label: '5 %' }, { value: '19', label: '19 %' }] })}
    ${field({ name: 'price', label: 'Precio de la presentación ANTES de IVA', type: 'money', value: p.price ?? '', required: true })}
    ${field({ name: 'neto', label: 'Precio de la presentación CON IVA (neto)', type: 'money', value: p.price != null ? withIva(p.price, p.ivaPct) : '', help: 'Escribe el que conozcas; el otro se calcula.' })}
    ${field({ name: 'perKg', label: 'Precio por kilo / unidad antes de IVA', type: 'money', value: pricePerContent(p) ?? '', help: 'Si lo escribes, se multiplica por el contenido.' })}
    ${field({ name: 'note', label: 'Nota (opcional)', type: 'textarea', value: p.note || '', full: true })}
    ${existing ? field({ name: 'active', label: 'Producto activo', type: 'checkbox', value: p.active !== false }) : ''}
  </div><p class="notice info" data-prod-preview></p>`;
  openModal({
    title: existing ? 'Editar producto' : 'Nuevo producto',
    subtitle: 'Precio de lista de referencia: en cada cotización o venta lo puedes negociar.',
    body,
    wide: true,
    onOpen: (f) => {
      bindMoneyPreviews(f);
      const g = (n) => $(`[name=${n}]`, f);
      const iva = () => Number(g('ivaPct').value) || 0;
      const qty = () => parseDecimal(g('contentQty').value);
      const set = (n, v) => {
        g(n).value = Number.isSafeInteger(v) ? v : '';
        g(n).dispatchEvent(new Event('input'));
      };
      const preview = () => {
        const price = parsePesos(g('price').value);
        const q = qty();
        const unit = g('contentUnit').value === 'und' ? 'und' : 'kg';
        $('[data-prod-preview]', f).textContent = Number.isSafeInteger(price) ? `${g('saleUnit').value} ${q ? `x ${q} ${unit}` : ''}: ${money(price)} + IVA ${iva()} % = ${money(withIva(price, iva()))}${q ? ` · ${money(Math.round(price / q))}/${unit} antes de IVA · ${money(Math.round(withIva(price, iva()) / q))}/${unit} con IVA` : ''}` : 'Escribe el precio para ver el resumen.';
      };
      let lock = false;
      f.addEventListener('input', (e) => {
        if (lock) return;
        lock = true;
        const n = e.target.name;
        if (n === 'price') {
          const v = parsePesos(g('price').value);
          set('neto', Number.isSafeInteger(v) ? withIva(v, iva()) : NaN);
          set('perKg', Number.isSafeInteger(v) && qty() > 0 ? Math.round(v / qty()) : NaN);
        } else if (n === 'neto') {
          const v = parsePesos(g('neto').value);
          const pr = Number.isSafeInteger(v) ? withoutIva(v, iva()) : NaN;
          set('price', pr);
          set('perKg', Number.isSafeInteger(pr) && qty() > 0 ? Math.round(pr / qty()) : NaN);
        } else if (n === 'perKg' && qty() > 0) {
          const v = parsePesos(g('perKg').value);
          const pr = Number.isSafeInteger(v) ? Math.round(v * qty()) : NaN;
          set('price', pr);
          set('neto', Number.isSafeInteger(pr) ? withIva(pr, iva()) : NaN);
        }
        lock = false;
        preview();
      });
      f.addEventListener('change', (e) => {
        if (['ivaPct', 'contentQty', 'contentUnit', 'saleUnit'].includes(e.target.name)) {
          const v = parsePesos(g('price').value);
          lock = true;
          set('neto', Number.isSafeInteger(v) ? withIva(v, iva()) : NaN);
          set('perKg', Number.isSafeInteger(v) && qty() > 0 ? Math.round(v / qty()) : NaN);
          lock = false;
          preview();
        }
      });
      preview();
    },
    onSubmit: async (fd) =>
      (await exec(saveProduct, { id: existing?.id, companyId: fd.get('companyId'), code: fd.get('code'), name: fd.get('name'), category: fd.get('category'), saleUnit: fd.get('saleUnit'), contentQty: fd.get('contentQty'), contentUnit: fd.get('contentUnit'), autoPresentation: true, price: readMoney(fd, 'price', { label: 'El precio' }), ivaPct: Number(fd.get('ivaPct')), note: fd.get('note'), active: existing ? !!fd.get('active') : true }, { success: 'Producto guardado' })) ? undefined : false,
  });
}

