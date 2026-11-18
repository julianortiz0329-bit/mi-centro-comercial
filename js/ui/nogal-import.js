// Importar el informe de Frutos del Nogal (3.11): se sube el PDF, la app lo
// compara con lo que tienes y muestra qué agregaría, qué corregiría y qué
// cobros faltan. Tú escoges la modalidad de cada factura (mayorista 0,4 % o
// normal 0,75 %); las comisiones del informe no se usan.
import { formatDate, periodLabel } from '../core/dates.js';
import { applyNogalImport, looksLikeNogalReport, parseNogalReport, planNogalImport, projectedNet } from '../domain/nogal-report.js';
import { getState } from '../store/store.js';
import { $, $$, esc, exec, money, openModal, toast } from './dom.js';
import { icon } from './icons.js';
import { pdfLines } from './rut-reader.js';

const S = () => getState();
const MODES = [['normal', 'Normal · 0,75 %'], ['mayorista', 'Mayorista · 0,4 %']];
const IVAS = [19, 5, 0];
const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(label)}</option>`;
const date = (d) => (d ? formatDate(d).replace(/ de \d{4}$/, '') : '—');

/** Abre el selector de archivo y, con el PDF, la revisión. */
export function pickNogalReport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf';
  input.addEventListener('change', () => input.files[0] && openNogalImport(input.files[0]));
  input.click();
}

export async function openNogalImport(file) {
  let report;
  try {
    toast('Leyendo el informe…');
    const text = await pdfLines(file);
    if (!looksLikeNogalReport(text)) return toast('Este PDF no parece el informe de comisiones de Frutos del Nogal.', 'error');
    report = parseNogalReport(text);
  } catch (e) {
    return toast(e?.message || 'No pude leer el PDF.', 'error');
  }
  const opts = { clientMap: {}, returnMap: {} };
  const choices = {}; // lo que el usuario cambió, por clave
  let plan = null;

  const replan = () => {
    plan = planNogalImport(S(), report, opts);
    for (const x of [...plan.items, ...plan.payments]) {
      Object.assign(x, choices[x.key] || {});
      if (x.action === 'aplicar' && !x.options?.some((o) => o.docId === x.docId)) x.docId = x.options?.[0]?.docId || null;
    }
    return plan;
  };
  // Guarda solo lo que el usuario cambió (lo demás sigue la sugerencia del plan).
  const record = (el) => {
    const c = (choices[el.dataset.k] ||= {});
    const f = el.dataset.f;
    if (f === 'apply') c.apply = el.checked;
    else if (f === 'replace') {
      const cur = plan.payments.find((x) => x.key === el.dataset.k)?.replaceIds || [];
      c.replaceIds = el.checked ? [...new Set([...cur, el.value])] : cur.filter((id) => id !== el.value);
    } else if (f === 'ivaPct') c.ivaPct = Number(el.value);
    else c[f] = el.value;
  };

  const body = () => {
    const p = replan();
    const nuevas = p.items.filter((i) => i.status === 'nueva');
    const distintas = p.items.filter((i) => i.status === 'distinta');
    const cuadran = p.items.filter((i) => i.status === 'cuadra');
    const devueltas = p.items.filter((i) => i.status === 'devuelta');
    const cobros = p.payments.filter((x) => x.status !== 'cuadra');
    const clients = [...S().clients].sort((a, b) => a.tradeName.localeCompare(b.tradeName, 'es'));
    const modeSel = (x) => `<label class="ni-sel"><span>Modalidad</span><select data-k="${x.key}" data-f="saleMode">${MODES.map(([v, l]) => opt(v, l, x.saleMode)).join('')}</select></label>`;
    const ivaSel = (x) => `<label class="ni-sel ni-iva"><span>IVA</span><select data-k="${x.key}" data-f="ivaPct">${IVAS.map((v) => opt(v, `${v} %`, x.ivaPct)).join('')}</select></label>`;
    const check = (x, label) => `<label class="ni-check"><input type="checkbox" data-k="${x.key}" data-f="apply" ${x.apply ? 'checked' : ''}><span>${label}</span></label>`;
    const who = (x) => `${esc(x.clientName || x.name)}${x.newClient ? ' <span class="pill info">cliente nuevo</span>' : ''}`;

    const sec = (title, sub, inner) => (inner ? `<section class="ni-sec"><h3>${title}</h3>${sub ? `<p class="muted small">${sub}</p>` : ''}${inner}</section>` : '');
    const after = projectedNet(p);
    return `
      <div class="ni-sum">
        <div><small>Ventas del informe</small><b>${money(p.totals.report.ventas)}</b></div>
        <div><small>En la app hoy</small><b>${money(p.totals.appNet)}</b></div>
        <div class="${after === p.totals.report.ventas ? 'ok' : ''}"><small>Si aplicas</small><b>${money(after)}</b></div>
      </div>
      <p class="muted small">${esc(periodLabel(p.period))} · Solo tomo facturas, devoluciones y recaudos. Los porcentajes y comisiones del informe <b>no se usan</b>: la app calcula con la modalidad que escojas.</p>
      ${sec('Clientes que no reconozco', 'Si ya lo tienes con otro nombre, escógelo; la app aprende su NIT para la próxima vez.', p.unknown.map((u) => `<label class="ni-row ni-client"><span><b>${esc(u.name)}</b><small>NIT/CC ${esc(u.taxId)}</small></span><select data-map="${esc(u.taxId)}">${opt('', 'Crear cliente nuevo', opts.clientMap[u.taxId] || '')}${clients.map((c) => opt(c.id, c.tradeName, opts.clientMap[u.taxId] || '')).join('')}</select></label>`).join(''))}
      ${sec(`Facturas para agregar (${nuevas.length})`, 'Escoge la modalidad de cada una.', nuevas.map((x) => `<div class="ni-card">${check(x, `<b>Factura ${esc(x.number)}</b> · ${date(x.date)} · ${who(x)}`)}<div class="ni-amt">${money(x.net)}</div><div class="ni-opts">${modeSel(x)}${ivaSel(x)}</div>${x.returnNumbers.length ? `<p class="muted small">Ya restada la devolución ${esc(x.returnNumbers.join(', '))}.</p>` : ''}</div>`).join(''))}
      ${sec(`Ventas que no cuadran (${distintas.length})`, 'Se anula la de la app (queda visible) y se registra como en el informe.', distintas.map((x) => `<div class="ni-card">${check(x, `Corregir <b>${esc(x.docNumber)}</b> · ${who(x)}`)}<div class="ni-diff"><span>App ${money(x.appNet)}</span>${icon('arrowRight', { size: 14 })}<b>Informe ${money(x.net)}</b><small>factura ${esc(x.number)} · ${date(x.date)}</small></div>${x.appPaid ? `<p class="muted small">Tiene pagos por ${money(x.appPaid)}: se reversan y se registra el cobro del informe.</p>` : ''}<div class="ni-opts">${modeSel(x)}${ivaSel(x)}</div></div>`).join(''))}
      ${sec(`Cobros por registrar (${cobros.length})`, '', cobros.map((x) => x.kind === 'periodo'
        ? `<div class="ni-card">${check(x, `<b>${money(x.amount)}</b> · ${date(x.date)} · ${who(x)}`)}<p class="muted small">Factura ${esc(x.invoice)}</p></div>`
        : `<div class="ni-card">${check(x, `<b>${money(x.amount)}</b> · ${date(x.date)} · ${who(x)}`)}<p class="muted small">Factura ${esc(x.invoice)} de ${date(x.invoiceDate)} (mes anterior), base ${money(x.base)}.</p>
            <label class="ni-sel ni-wide"><span>¿Qué es en la app?</span><select data-k="${x.key}" data-f="action" data-replan>
              ${opt('nueva', 'No está: registrar la factura y el cobro', x.action)}
              ${x.options.length ? opt('aplicar', 'Ya está: solo aplicar el cobro a una venta', x.action) : ''}
              ${x.options.length ? opt('corregir', 'Está con otro valor: reemplazar venta(s)', x.action) : ''}
            </select></label>
            ${x.action === 'aplicar' ? `<label class="ni-sel ni-wide"><span>Venta</span><select data-k="${x.key}" data-f="docId">${x.options.map((o) => opt(o.docId, `${o.number} · ${date(o.date)} · saldo ${money(o.balance)}`, x.docId)).join('')}</select></label>` : ''}
            ${x.action === 'corregir' ? `<div class="ni-replace"><small>Ventas que reemplaza:</small>${x.options.map((o) => `<label class="ni-check"><input type="checkbox" data-k="${x.key}" data-f="replace" value="${o.docId}" ${(x.replaceIds || []).includes(o.docId) ? 'checked' : ''}><span>${esc(o.number)} · ${date(o.date)} · ${money(o.net)}</span></label>`).join('')}</div>` : ''}
            ${x.action !== 'aplicar' ? `<div class="ni-opts">${modeSel(x)}${ivaSel(x)}</div>` : ''}</div>`).join(''))}
      ${sec('Devoluciones', '', p.returns.map((r) => `<label class="ni-row"><span><b>Nota ${esc(r.number)} · −${money(r.net)}</b><small>${esc(r.name)}</small></span>${r.options.length > 1 ? `<select data-ret="${esc(r.number)}">${r.options.map((n) => opt(n, `Se resta de la factura ${n}`, r.invoice)).join('')}</select>` : `<small>Se resta de la factura ${esc(r.invoice || '—')}</small>`}</label>`).join(''))}
      ${cuadran.length || devueltas.length ? `<details class="ni-sec"><summary>${cuadran.length} factura(s) ya cuadran${devueltas.length ? ` · ${devueltas.length} devuelta(s) completas` : ''}</summary><ul class="simple">${cuadran.map((x) => `<li>${esc(x.number)} · ${esc(x.clientName)}<small>${esc(x.docNumber)} · ${money(x.net)}</small></li>`).join('')}${devueltas.map((x) => `<li>${esc(x.number)} · ${esc(x.name)}<small>devuelta por completo</small></li>`).join('')}</ul></details>` : ''}
      ${p.extra.length ? sec('En la app pero no en el informe', 'No cambio nada; revisa si son de otro mes o si faltan en la empresa.', `<ul class="simple">${p.extra.map((x) => `<li>${esc(x.number)} · ${esc(x.clientName)}<small>${date(x.date)} · ${money(x.net)}</small></li>`).join('')}</ul>`) : ''}
      ${!nuevas.length && !distintas.length && !cobros.length ? '<div class="notice ok">Todo cuadra con el informe. No hay nada que cambiar. 🎉</div>' : ''}`;
  };

  openModal({
    title: 'Informe de Frutos del Nogal',
    subtitle: 'Revisa y aplica. Nada cambia hasta que toques “Aplicar”.',
    wide: true,
    body: '<div data-ni-body></div>',
    submitText: 'Aplicar',
    onOpen: (form) => {
      const box = $('[data-ni-body]', form);
      const paint = () => (box.innerHTML = body());
      paint();
      form.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.k) record(t);
        if (t.dataset.map !== undefined) {
          if (t.value) opts.clientMap[t.dataset.map] = t.value;
          else delete opts.clientMap[t.dataset.map];
        } else if (t.dataset.ret) opts.returnMap[t.dataset.ret] = t.value;
        // Recalcula lo que cambia la pantalla: emparejar, devoluciones, acción y marcar/desmarcar.
        if (t.dataset.map !== undefined || t.dataset.ret || t.dataset.replan !== undefined || ['apply', 'replace'].includes(t.dataset.f)) {
          const y = form.closest('.modal')?.scrollTop;
          paint();
          if (y != null) form.closest('.modal').scrollTop = y;
        }
      });
    },
    onSubmit: async () => {
      replan();
      const r = await exec(applyNogalImport, { plan });
      if (!r) return false;
      const parts = [r.sales && `${r.sales} venta(s)`, r.replaced && `${r.replaced} corregida(s)`, r.payments && `${r.payments} cobro(s)`, r.clients && `${r.clients} cliente(s) nuevo(s)`].filter(Boolean);
      toast(parts.length ? `Listo: ${parts.join(', ')}.` : 'Todo cuadraba; anoté los números de factura.');
      return undefined;
    },
  });
}
