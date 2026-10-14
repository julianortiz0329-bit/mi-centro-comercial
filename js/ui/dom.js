// Utilidades de interfaz: escape de HTML, modales, confirmaciones y avisos.
import { formatCOP, parsePesos } from '../core/money.js';
import { ConfirmRequired, DomainError } from '../domain/common.js';
import { run } from '../store/store.js';
import { illustration } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const money = formatCOP;

export function toast(msg, kind = 'ok') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = msg;
  root.appendChild(el);
  while (root.children.length > 3) root.firstElementChild.remove();
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3200);
}

export function errorMessage(e) {
  if (e instanceof DomainError) return e.message;
  if (e?.name === 'ConflictError') return e.message;
  console.error(e);
  return `Ocurrió un error inesperado: ${e?.message || e}. No se guardó el cambio.`;
}

/**
 * Ejecuta un comando; si el dominio pide confirmación (posible duplicado,
 * cupo excedido…), pregunta al usuario y reintenta con la confirmación.
 */
export async function exec(command, input, { success } = {}) {
  let attempt = { ...input, confirm: { ...(input.confirm || {}) } };
  for (let i = 0; i < 4; i++) {
    try {
      const r = await run(command, attempt);
      if (success) {
        toast(success);
        navigator.vibrate?.(12); // confirmación táctil al guardar
      }
      return r;
    } catch (e) {
      if (e instanceof ConfirmRequired) {
        const ok = await confirmDialog({ title: 'Confirma para continuar', message: e.message, confirmText: 'Sí, continuar', danger: true });
        if (!ok) return null;
        attempt = { ...attempt, confirm: { ...attempt.confirm, [e.key]: true } };
        continue;
      }
      toast(errorMessage(e), 'error');
      throw e;
    }
  }
  return null;
}

let modalStack = 0;

/**
 * Abre un modal con formulario. onSubmit(formData, form) puede ser async; el
 * botón se deshabilita mientras se procesa (evita doble envío). Si onSubmit
 * devuelve false, el modal sigue abierto.
 */
export function openModal({ title, subtitle = '', body, submitText = 'Guardar', onSubmit, wide = false, onOpen, cancelText = 'Cancelar', noFooter = false }) {
  const root = $('#modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="mt${modalStack}">
    <span class="grabber" aria-hidden="true"></span>
    <header class="modal-head"><div><h2 id="mt${modalStack}">${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div><button type="button" class="icon-btn" data-close aria-label="Cerrar">✕</button></header>
    <form novalidate>${body}${noFooter ? '' : `<footer class="modal-foot"><button type="button" class="btn btn-plain" data-close>${cancelText}</button>${onSubmit ? `<button type="submit" class="btn btn-primary">${submitText}</button>` : ''}</footer>`}</form></section>`;
  modalStack++;
  root.appendChild(wrap);
  document.body.classList.add('modal-open');
  const form = $('form', wrap);
  const close = () => {
    wrap.remove();
    modalStack--;
    if (!root.children.length) document.body.classList.remove('modal-open');
  };
  $$('[data-close]', wrap).forEach((b) => b.addEventListener('click', close));
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  let sending = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit || sending) return;
    if (!form.reportValidity()) return;
    sending = true;
    const btn = $('button[type=submit]', form);
    const label = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Guardando…';
    }
    try {
      const keep = await onSubmit(new FormData(form), form);
      if (keep !== false) close();
    } catch (err) {
      if (!(err instanceof DomainError) && err?.name !== 'ConflictError') console.error(err);
    } finally {
      sending = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = label;
      }
    }
  });
  // En el celular la ventana se cierra deslizándola hacia abajo desde arriba.
  const sheet = $('.modal', wrap);
  let startY = null;
  let dy = 0;
  const startDrag = (e) => {
    if (sheet.scrollTop > 0 || e.target.closest('input,select,textarea,button,a')) return;
    startY = e.touches[0].clientY;
    dy = 0;
    sheet.style.transition = 'none';
  };
  const moveDrag = (e) => {
    if (startY === null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const endDrag = () => {
    if (startY === null) return;
    startY = null;
    sheet.style.transition = 'transform .2s ease';
    if (dy > 110) {
      sheet.style.transform = 'translateY(100%)';
      setTimeout(close, 180);
    } else sheet.style.transform = '';
  };
  for (const el of [$('.grabber', wrap), $('.modal-head', wrap)]) {
    el.addEventListener('touchstart', startDrag, { passive: true });
    el.addEventListener('touchmove', moveDrag, { passive: true });
    el.addEventListener('touchend', endDrag);
  }
  onOpen?.(form, close);
  setTimeout(() => $('input:not([type=hidden]):not([readonly]),select,textarea', form)?.focus(), 60);
  return { form, close };
}

export function confirmDialog({ title, message, confirmText = 'Confirmar', danger = false, reason = false, reasonLabel = 'Motivo', typeToConfirm = '' }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const body = `<p class="confirm-msg">${esc(message)}</p>${reason ? field({ name: 'reason', label: reasonLabel, type: 'textarea', required: true }) : ''}${typeToConfirm ? field({ name: 'typed', label: `Escribe ${typeToConfirm} para confirmar`, required: true }) : ''}`;
    const m = openModal({
      title,
      body,
      submitText: confirmText,
      onSubmit: (fd) => {
        if (typeToConfirm && String(fd.get('typed')).trim().toUpperCase() !== typeToConfirm) {
          toast(`Escribe ${typeToConfirm} exactamente.`, 'error');
          return false;
        }
        finish(reason ? String(fd.get('reason') || '').trim() || false : true);
      },
    });
    if (danger) $('button[type=submit]', m.form).classList.replace('btn-primary', 'btn-danger');
    const obs = new MutationObserver(() => {
      if (!m.form.isConnected) {
        obs.disconnect();
        finish(false);
      }
    });
    obs.observe($('#modal-root'), { childList: true });
  });
}

/** Campo de formulario accesible. type: text|number|date|time|tel|email|select|textarea|checkbox|money */
export function field({ name, label, type = 'text', value = '', required = false, options = [], help = '', full = false, placeholder = '', attrs = '' }) {
  const id = `f_${name}_${Math.random().toString(36).slice(2, 7)}`;
  const req = required ? 'required' : '';
  const v = esc(value ?? '');
  let input;
  if (type === 'select') input = `<select id="${id}" name="${name}" ${req} ${attrs}>${options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  else if (type === 'textarea') input = `<textarea id="${id}" name="${name}" ${req} placeholder="${esc(placeholder)}" ${attrs}>${v}</textarea>`;
  else if (type === 'checkbox') return `<div class="field ${full ? 'full' : ''}"><label class="check"><input type="checkbox" name="${name}" ${value ? 'checked' : ''} ${attrs}> <span>${label}${help ? `<small>${help}</small>` : ''}</span></label></div>`;
  else if (type === 'money') input = `<input id="${id}" name="${name}" type="text" inputmode="numeric" autocomplete="off" data-money ${req} value="${value === '' || value == null ? '' : esc(value)}" placeholder="${esc(placeholder || '0')}" ${attrs}>`;
  else input = `<input id="${id}" name="${name}" type="${type}" ${req} value="${v}" placeholder="${esc(placeholder)}" ${attrs}>`;
  return `<div class="field ${full ? 'full' : ''}"><label for="${id}">${label}${required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>${input}${type === 'money' ? '<small class="money-preview" aria-live="polite"></small>' : ''}${help ? `<small>${help}</small>` : ''}</div>`;
}

/** Lee un campo de dinero; lanza un error claro si no es válido. */
export function readMoney(fd, name, { required = true, label = 'El valor' } = {}) {
  const raw = String(fd.get(name) ?? '').trim();
  if (!raw && !required) return 0;
  const v = parsePesos(raw);
  if (!Number.isSafeInteger(v) || v < 0) {
    toast(`${label} no es un monto válido en pesos.`, 'error');
    throw new DomainError(`${label} no es válido.`);
  }
  return v;
}

/** Vista previa en vivo de campos de dinero ("$ 1.250.000"). */
export function bindMoneyPreviews(root) {
  for (const input of $$('[data-money]', root)) {
    const out = input.parentElement.querySelector('.money-preview');
    const upd = () => {
      const v = parsePesos(input.value);
      out.textContent = input.value.trim() ? (Number.isSafeInteger(v) ? money(v) : 'Monto no válido') : '';
    };
    input.addEventListener('input', upd);
    upd();
  }
}

export function download(name, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob(type.startsWith('text/csv') ? ['﻿', content] : [content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function requestId() {
  return globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export function empty(_icon, title, text, action = '') {
  return `<div class="empty">${illustration()}<strong>${title}</strong><p>${text}</p>${action}</div>`;
}

export function stat(label, value, note = '', tone = '') {
  return `<div class="stat ${tone}"><div class="stat-label">${label}</div><div class="stat-value">${value}</div>${note ? `<div class="stat-note">${note}</div>` : ''}</div>`;
}

export function pill(text, tone = '') {
  return `<span class="pill ${tone}">${esc(text)}</span>`;
}

export function progress(pct, tone = '') {
  const p = Math.max(0, Math.min(100, pct || 0));
  return `<div class="bar ${tone}" role="progressbar" aria-valuenow="${Math.round(p)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p}%"></span></div>`;
}
