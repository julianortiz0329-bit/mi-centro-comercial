// Registro rápido al salir de una visita o llamada: un toque para el
// resultado y, si se quiere, dictado por voz. La nota dictada se lee para
// proponer el valor y la fecha de una promesa de pago (siempre editables).
import { localDate, localTime, formatDate } from '../core/dates.js';
import { addActivity } from '../domain/activities.js';
import { parseNote } from '../domain/nlp.js';
import { ACTIVE_COMPANY_IDS } from '../domain/schema.js';
import { getState } from '../store/store.js';
import { $, bindMoneyPreviews, esc, exec, field, money, openModal, readMoney, requestId, toast } from './dom.js';
import { bindClientPicker, clientPicker, documentForm, paymentForm } from './forms.js';
import { ui } from './state.js';

const OUTCOMES = [
  { key: 'compro', icon: '🛒', label: 'Visité · hizo pedido', type: 'visita', result: 'Hizo pedido' },
  { key: 'no_compro', icon: '🚪', label: 'Visité · no compró', type: 'visita', result: 'No compró' },
  { key: 'llamada', icon: '📞', label: 'Llamé · contestó', type: 'llamada', result: 'Contestó' },
  { key: 'no_contesto', icon: '📵', label: 'No contestó', type: 'no_contactado', result: 'No contestó' },
  { key: 'promesa', icon: '🤝', label: 'Prometió pagar', type: 'promesa', result: 'Promesa de pago' },
  { key: 'pago', icon: '💵', label: 'Me pagó', type: 'visita', result: 'Recibí pago' },
];

const Speech = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

export function quickLogForm({ clientId = '' } = {}) {
  const s = getState();
  const co = ui.scope !== 'todas' ? ui.scope : '';
  const body = `${clientPicker({ selectedId: clientId, label: '¿Con quién?' })}
    <div class="field full"><label>Empresa</label><div class="seg">${ACTIVE_COMPANY_IDS.map((c) => `<label><input type="radio" name="companyId" value="${c}" ${c === (co || 'nogal') ? 'checked' : ''}><span>${s.companies[c].icon} ${esc(s.companies[c].name)}</span></label>`).join('')}</div></div>
    <div class="field full"><label>¿Qué pasó?</label><div class="outcomes">${OUTCOMES.map((o) => `<label class="outcome"><input type="radio" name="outcome" value="${o.key}"><span><b aria-hidden="true">${o.icon}</b>${o.label}</span></label>`).join('')}</div></div>
    <div class="field full"><label for="ql-notes">Nota</label><div class="dictate"><textarea id="ql-notes" name="notes" rows="3" placeholder="Ej. prometió pagar el viernes 500 mil"></textarea>${Speech ? '<button type="button" class="btn btn-secondary mic" data-mic aria-label="Dictar nota">🎤 Dictar</button>' : ''}</div><small data-parse-hint></small></div>
    <div class="grid2" data-promise hidden>${field({ name: 'promiseAmount', label: 'Valor que prometió', type: 'money' })}${field({ name: 'promiseDate', label: 'Fecha en que pagará', type: 'date' })}</div>
    <div class="grid2">${field({ name: 'nextDate', label: 'Próxima acción (opcional)', type: 'date' })}${field({ name: 'nextText', label: '¿Qué hacer?', placeholder: 'Ej. volver a llamar' })}</div>`;
  const rid = requestId();
  let recog = null;
  openModal({
    title: '⚡ Registro rápido',
    subtitle: 'Un toque para el resultado. Puedes dictar la nota.',
    body,
    wide: true,
    submitText: 'Guardar',
    onOpen: (form) => {
      bindMoneyPreviews(form);
      bindClientPicker(form);
      const notes = $('[name=notes]', form);
      const hint = $('[data-parse-hint]', form);
      const promise = $('[data-promise]', form);
      const sync = () => {
        promise.hidden = $('[name=outcome]:checked', form)?.value !== 'promesa';
      };
      const setMoney = (name, v) => {
        const el = $(`[name=${name}]`, form);
        el.value = v;
        el.dispatchEvent(new Event('input'));
      };
      // Lee la nota: propone resultado, valor y fecha (el usuario confirma).
      const readNote = () => {
        const p = parseNote(notes.value, localDate());
        const found = [];
        if (p.intent && !$('[name=outcome]:checked', form)) {
          const map = { promesa: 'promesa', no_contesto: 'no_contesto', compro: 'compro', no_compro: 'no_compro', pago: 'pago' };
          const r = $(`[name=outcome][value=${map[p.intent]}]`, form);
          if (r) {
            r.checked = true;
            found.push(r.parentElement.textContent.trim());
          }
        }
        sync();
        if (p.amount && !$('[name=promiseAmount]', form).value) {
          setMoney('promiseAmount', p.amount);
          found.push(money(p.amount));
        }
        if (p.date && !$('[name=promiseDate]', form).value) {
          $('[name=promiseDate]', form).value = p.date;
          found.push(formatDate(p.date));
        }
        if (found.length) hint.textContent = `Detecté: ${found.join(' · ')}. Revísalo antes de guardar.`;
      };
      notes.addEventListener('blur', readNote);
      form.addEventListener('change', (e) => e.target.name === 'outcome' && sync());
      $('[data-mic]', form)?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        if (recog) {
          recog.stop();
          return;
        }
        try {
          recog = new Speech();
          recog.lang = 'es-CO';
          recog.interimResults = false;
          recog.maxAlternatives = 1;
          recog.onresult = (ev) => {
            const t = [...ev.results].map((r) => r[0].transcript).join(' ');
            notes.value = `${notes.value ? notes.value + ' ' : ''}${t}`.trim();
            readNote();
          };
          recog.onerror = (ev) => toast(ev.error === 'not-allowed' ? 'Permite el micrófono para dictar.' : 'No se pudo usar el dictado. Escribe la nota.', 'error');
          recog.onend = () => {
            recog = null;
            btn.textContent = '🎤 Dictar';
            btn.classList.remove('recording');
          };
          recog.start();
          btn.textContent = '⏹ Detener';
          btn.classList.add('recording');
        } catch {
          toast('El dictado no está disponible en este navegador.', 'error');
        }
      });
    },
    onSubmit: async (fd) => {
      recog?.stop();
      const cid = fd.get('clientId');
      if (!cid) {
        toast('Elige el cliente.', 'error');
        return false;
      }
      const o = OUTCOMES.find((x) => x.key === fd.get('outcome'));
      if (!o) {
        toast('Toca qué pasó (visita, llamada, promesa…).', 'error');
        return false;
      }
      const companyId = fd.get('companyId');
      const input = { clientId: cid, companyId, type: o.type, date: localDate(), time: localTime(), result: o.result, notes: fd.get('notes'), nextAction: fd.get('nextDate') ? { date: fd.get('nextDate'), text: fd.get('nextText') } : null, requestId: rid };
      if (o.type === 'promesa') {
        const amount = readMoney(fd, 'promiseAmount', { label: 'El valor prometido' });
        if (!fd.get('promiseDate')) {
          toast('Indica la fecha en que pagará.', 'error');
          return false;
        }
        input.promise = { date: fd.get('promiseDate'), amount };
      }
      const a = await exec(addActivity, input, { success: 'Registrado' });
      if (!a) return false;
      // Siguiente paso natural según el resultado.
      setTimeout(() => {
        if (o.key === 'compro') documentForm('pedido', { clientId: cid, companyId });
        if (o.key === 'pago') paymentForm({ clientId: cid, companyId });
      }, 50);
    },
  });
}
