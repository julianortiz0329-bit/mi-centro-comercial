// Formularios del libro: gasto (con foto del soporte), aporte, retiro,
// traslado entre cuentas y cuenta.
import { localDate } from '../core/dates.js';
import { newId } from '../core/ids.js';
import { ACCOUNT_KINDS, addContribution, addExpense, addTransfer, addWithdrawal, CONTRIBUTION_KINDS, EXPENSE_CATEGORIES, saveAccount, WITHDRAWAL_KINDS } from '../domain/ledger.js';
import { PH_METHODS } from '../domain/pethome.js';
import { getState, readAttachment, saveAttachment } from '../store/store.js';
import { $, bindMoneyPreviews, esc, exec, field, money, openModal, readMoney, requestId, toast } from './dom.js';

const S = () => getState();
const accounts = () => S().ledger.accounts.filter((a) => a.active);
const accOptions = () => accounts().map((a) => ({ value: a.id, label: a.name }));
const socioOptions = () => S().socios.map((x) => ({ value: x.id, label: x.nombre }));
const opts = (o) => Object.entries(o).map(([value, label]) => ({ value, label }));

function needAccounts() {
  if (accounts().length) return true;
  toast('Primero crea una cuenta en Caja (Efectivo, Nequi o banco).', 'error');
  return false;
}

/** Reduce una foto a JPEG liviano para guardarla como soporte. */
function photoToJpeg(file, maxSide = 1280, quality = 0.62) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r);
      c.height = Math.round(img.height * r);
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });
}

export function expenseForm() {
  if (!needAccounts()) return;
  const payers = [...accOptions(), ...S().socios.map((x) => ({ value: `socio:${x.id}`, label: `${x.nombre} lo pagó de su bolsillo` }))];
  const rid = requestId();
  let photo = null;
  openModal({
    title: 'Registrar gasto',
    subtitle: 'Publicidad, envíos, empaques, comisiones… Las compras de mercancía a proveedores van en "Compra a proveedor".',
    body: `<div class="grid2">
      ${field({ name: 'description', label: '¿En qué se gastó?', required: true, placeholder: 'Ej. Pauta Instagram semana 2' })}
      ${field({ name: 'amount', label: 'Valor', type: 'money', required: true })}
      ${field({ name: 'category', label: 'Categoría', type: 'select', value: 'publicidad', options: opts(EXPENSE_CATEGORIES) })}
      ${field({ name: 'date', label: 'Fecha', type: 'date', value: localDate(), required: true })}
      ${field({ name: 'payer', label: '¿Con qué se pagó?', type: 'select', value: payers[0]?.value, options: payers, help: 'Si un socio lo pagó con su plata, queda a su favor en su cuenta de socio.' })}
      ${field({ name: 'ivaPct', label: 'IVA incluido en el valor', type: 'select', value: '0', options: [{ value: '0', label: 'Sin IVA' }, { value: '5', label: '5 %' }, { value: '19', label: '19 %' }], help: S().pethome.profile.ivaResponsable ? 'Si la factura trae IVA, queda como IVA descontable.' : 'Como Alegría no cobra IVA, el gasto cuenta completo.' })}
      ${field({ name: 'notes', label: 'Nota (opcional)' })}
      <div class="field full"><label>Soporte (foto del recibo o factura)</label><label class="btn btn-plain btn-small file-btn">📷 Tomar o subir foto<input type="file" accept="image/*" data-receipt hidden></label><small data-receipt-info class="muted">Opcional.</small></div>
    </div>`,
    submitText: 'Guardar gasto',
    onOpen: (form) => {
      bindMoneyPreviews(form);
      $('[data-receipt]', form).addEventListener('change', async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        try {
          photo = await photoToJpeg(f);
          $('[data-receipt-info]', form).innerHTML = `<img src="${photo}" alt="Soporte" class="receipt-thumb"> Foto lista (${Math.round(photo.length / 1365)} KB)`;
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    },
    onSubmit: async (fd) => {
      let receiptId = null;
      if (photo) {
        receiptId = newId('sop');
        try {
          await saveAttachment(receiptId, photo);
        } catch (e) {
          toast(`No se pudo subir la foto (${e.message}). Guarda el gasto sin foto o intenta con internet.`, 'error');
          return false;
        }
      }
      const r = await exec(addExpense, { description: fd.get('description'), amount: readMoney(fd, 'amount', { label: 'El valor' }), category: fd.get('category'), date: fd.get('date'), payer: fd.get('payer'), ivaPct: fd.get('ivaPct'), notes: fd.get('notes'), receiptId, requestId: rid }, { success: 'Gasto registrado' });
      return r ? undefined : false;
    },
  });
}

export function contributionForm(socioId = null) {
  if (!needAccounts()) return;
  const rid = requestId();
  openModal({
    title: 'Registrar aporte de socio',
    subtitle: 'Dinero que un socio mete al negocio. Queda a su favor en su cuenta de socio.',
    body: `<div class="grid2">
      ${field({ name: 'socioId', label: 'Socio', type: 'select', value: socioId || S().me.id, options: socioOptions() })}
      ${field({ name: 'amount', label: 'Valor', type: 'money', required: true })}
      ${field({ name: 'kind', label: 'Tipo', type: 'select', value: 'capital', options: opts(CONTRIBUTION_KINDS), help: 'Préstamo: el negocio debe devolverlo antes de repartir utilidades.' })}
      ${field({ name: 'accountId', label: '¿A qué cuenta entró?', type: 'select', value: accOptions()[0]?.value, options: accOptions() })}
      ${field({ name: 'date', label: 'Fecha', type: 'date', value: localDate(), required: true })}
      ${field({ name: 'notes', label: 'Nota (opcional)' })}
    </div>`,
    submitText: 'Guardar aporte',
    onOpen: (form) => bindMoneyPreviews(form),
    onSubmit: async (fd) => ((await exec(addContribution, { socioId: fd.get('socioId'), amount: readMoney(fd, 'amount', { label: 'El aporte' }), kind: fd.get('kind'), accountId: fd.get('accountId'), date: fd.get('date'), notes: fd.get('notes'), requestId: rid }, { success: 'Aporte registrado' })) ? undefined : false),
  });
}

export function withdrawalForm(socioId = null, amount = '') {
  if (!needAccounts()) return;
  const rid = requestId();
  openModal({
    title: 'Registrar retiro de socio',
    subtitle: 'Dinero que sale del negocio para un socio: su parte de la utilidad, un reembolso o la devolución de un aporte.',
    body: `<div class="grid2">
      ${field({ name: 'socioId', label: 'Socio', type: 'select', value: socioId || S().me.id, options: socioOptions() })}
      ${field({ name: 'amount', label: 'Valor', type: 'money', required: true, value: amount && Number(amount) > 0 ? amount : '' })}
      ${field({ name: 'kind', label: 'Tipo', type: 'select', value: 'utilidad', options: opts(WITHDRAWAL_KINDS) })}
      ${field({ name: 'accountId', label: '¿De qué cuenta salió?', type: 'select', value: accOptions()[0]?.value, options: accOptions() })}
      ${field({ name: 'date', label: 'Fecha', type: 'date', value: localDate(), required: true })}
      ${field({ name: 'notes', label: 'Nota (opcional)' })}
    </div>`,
    submitText: 'Guardar retiro',
    onOpen: (form) => bindMoneyPreviews(form),
    onSubmit: async (fd) => ((await exec(addWithdrawal, { socioId: fd.get('socioId'), amount: readMoney(fd, 'amount', { label: 'El retiro' }), kind: fd.get('kind'), accountId: fd.get('accountId'), date: fd.get('date'), notes: fd.get('notes'), requestId: rid }, { success: 'Retiro registrado' })) ? undefined : false),
  });
}

export function transferForm() {
  if (accounts().length < 2) return toast('Necesitas al menos dos cuentas en Caja.', 'error');
  const o = accOptions();
  openModal({
    title: 'Traslado entre cuentas',
    subtitle: 'Por ejemplo, pasar el efectivo de una feria a Bancolombia. No cambia la utilidad.',
    body: `<div class="grid2">
      ${field({ name: 'from', label: 'Sale de', type: 'select', value: o[0].value, options: o })}
      ${field({ name: 'to', label: 'Entra a', type: 'select', value: o[1].value, options: o })}
      ${field({ name: 'amount', label: 'Valor', type: 'money', required: true })}
      ${field({ name: 'date', label: 'Fecha', type: 'date', value: localDate(), required: true })}
      ${field({ name: 'notes', label: 'Nota (opcional)', full: true })}
    </div>`,
    submitText: 'Guardar traslado',
    onOpen: (form) => bindMoneyPreviews(form),
    onSubmit: async (fd) => ((await exec(addTransfer, { from: fd.get('from'), to: fd.get('to'), amount: readMoney(fd, 'amount', { label: 'El valor' }), date: fd.get('date'), notes: fd.get('notes') }, { success: 'Traslado registrado' })) ? undefined : false),
  });
}

export function accountForm(existing = null) {
  const x = existing || { name: '', kind: 'banco', method: '', initial: 0, active: true };
  openModal({
    title: existing ? esc(existing.name) : 'Nueva cuenta',
    subtitle: 'El saldo inicial es lo que tenía la cuenta cuando empezaron a usar el libro.',
    body: `<div class="grid2">
      ${field({ name: 'name', label: 'Nombre', value: x.name, required: true, placeholder: 'Ej. Daviplata Julián' })}
      ${field({ name: 'kind', label: 'Tipo', type: 'select', value: x.kind, options: opts(ACCOUNT_KINDS) })}
      ${field({ name: 'method', label: 'Medio de pago que entra aquí', type: 'select', value: x.method || '', options: [{ value: '', label: 'Ninguno en particular' }, ...opts(PH_METHODS)] })}
      ${field({ name: 'initial', label: 'Saldo inicial', type: 'money', value: x.initial || '' })}
      ${field({ name: 'active', label: 'Cuenta activa', type: 'checkbox', value: x.active !== false })}
    </div>`,
    submitText: 'Guardar cuenta',
    onOpen: (form) => bindMoneyPreviews(form),
    onSubmit: async (fd) => ((await exec(saveAccount, { id: existing?.id, name: fd.get('name'), kind: fd.get('kind'), method: fd.get('method'), initial: readMoney(fd, 'initial', { required: false, label: 'El saldo inicial' }) ?? 0, active: !!fd.get('active') }, { success: 'Cuenta guardada' })) ? undefined : false),
  });
}

export async function showReceipt(id) {
  const { close } = openModal({ title: 'Soporte del gasto', body: '<p class="muted" data-rc>Cargando foto…</p>', noFooter: true });
  try {
    const d = await readAttachment(id);
    const box = document.querySelector('[data-rc]');
    if (box) box.outerHTML = d ? `<img src="${d}" alt="Soporte" class="receipt-full">` : '<p class="muted">No se encontró la foto.</p>';
  } catch (e) {
    toast(e.message, 'error');
    close();
  }
}

export const moneyText = money;
