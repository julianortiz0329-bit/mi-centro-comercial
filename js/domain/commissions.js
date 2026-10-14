// Motor ÚNICO de comisiones. Ninguna pantalla calcula comisiones: todas leen
// las líneas guardadas en `state.commissions`, que se generan aquí en el momento
// de cada operación con una copia de las reglas aplicadas (rulesSnapshot).
//
// POLÍTICA (documentada en docs/POLITICA-COMISIONES.md y probada en tests/):
//
// El Puntazo
//  · Venta: 0 %. Nunca se genera línea de comisión por venta.
//  · Cobro: 6 % de cada peso efectivamente aplicado a una venta, sin importar
//    la fecha de la venta. Abonos parciales comisionan proporcionalmente.
//
// Frutos del Nogal (umbral mensual)
//  · El umbral se evalúa por periodo mensual de la FECHA DE LA VENTA, sumando
//    las ventas vigentes (no anuladas) del periodo sobre la base configurada
//    (por defecto: neto antes de IVA, después de descuentos).
//  · El desbloqueo se registra una sola vez, en el instante en que se registra
//    la venta que hace que el acumulado llegue al umbral. Queda guardado y no
//    se mueve después (ni por ventas registradas con fecha anterior ni por
//    anulaciones; si una anulación deja el acumulado por debajo, se avisa).
//  · Comisión por venta: solo lo vendido DESPUÉS de llegar al umbral. La venta
//    que produce el cruce comisiona únicamente el excedente sobre el umbral
//    (de $69 M a $71 M → comisiona $1 M). No hay comisiones retroactivas.
//  · Comisión por cobro: solo si (a) la venta original fue elegible y (b) el
//    recaudo se aplica después del desbloqueo del periodo de la FECHA DEL
//    RECAUDO. Base: recaudo × (base elegible antes de IVA / total), sin
//    superar el saldo y sin duplicar pagos.
//  · Tarifa según la modalidad guardada en la venta: mayorista 0,4 % / 0,4 %;
//    normal 0,75 % / 0,75 %.
//  · Las líneas no elegibles se guardan como "bloqueada" con el motivo, para
//    que todo sea auditable; nunca suman a lo pendiente ni a lo pagado.
//
// Correcciones: una línea pendiente se marca "reversada" (con motivo y fecha);
// una línea ya liquidada o pagada no se toca: se crea un AJUSTE negativo.
import { newId } from '../core/ids.js';
import { periodOf } from '../core/dates.js';
import { applyBps, mulDiv, sum } from '../core/money.js';
import { assert, audit, cleanText, DomainError, getOrFail, nextNumber, nowOf } from './common.js';
import { isActiveSale } from './ledger.js';

function snapshotRules(s, companyId) {
  return structuredClone(s.rules[companyId]);
}

function unlockKey(companyId, period) {
  return `${companyId}:${period}`;
}

/** Valor de una venta que suma al umbral. */
function thresholdValue(rules, doc) {
  return rules.thresholdBase === 'total' ? doc.totals.total : doc.totals.net;
}

export function periodSalesCumulative(s, companyId, period) {
  const rules = s.rules[companyId];
  return sum(
    s.documents.filter((d) => isActiveSale(d) && d.companyId === companyId && periodOf(d.date) === period),
    (d) => thresholdValue(rules, d),
  );
}

/** Registra el desbloqueo del periodo si el acumulado llegó al umbral. */
function evaluateUnlock(s, companyId, period, triggerDoc, ctx) {
  const key = unlockKey(companyId, period);
  if (s.unlocks[key]) return s.unlocks[key];
  const rules = s.rules[companyId];
  const cumulative = periodSalesCumulative(s, companyId, period);
  if (cumulative < rules.thresholdPesos) return null;
  const rec = {
    companyId,
    period,
    unlockedAt: nowOf(ctx),
    triggerDocumentId: triggerDoc.id,
    triggerNumber: triggerDoc.number,
    cumulativeAtUnlock: cumulative,
    thresholdPesos: rules.thresholdPesos,
    thresholdBase: rules.thresholdBase,
  };
  s.unlocks[key] = rec;
  audit(s, ctx, 'desbloqueo_umbral', 'periodo', key, `Acumulado ${cumulative} ≥ ${rules.thresholdPesos} con ${triggerDoc.number}`);
  return rec;
}

export function unlockFor(s, companyId, period) {
  return s.unlocks[unlockKey(companyId, period)] || null;
}

function pushLine(s, line, ctx) {
  const c = {
    id: newId('com'),
    status: 'generada',
    settlementId: null,
    paidAt: null,
    reversal: null,
    createdAt: nowOf(ctx),
    ...line,
  };
  s.commissions.push(c);
  return c;
}

/** Se llama al registrar una venta (documents.createDocument). */
export function onSaleRegistered(s, doc, ctx) {
  const rules = s.rules[doc.companyId];
  const period = periodOf(doc.date);
  if (rules.kind === 'recaudo') {
    doc.commission = { saleEligible: rules.saleBps > 0, collectionEligible: true, period, reason: 'El Puntazo comisiona solo por recaudo.' };
    if (rules.saleBps > 0) {
      pushLine(s, { companyId: doc.companyId, type: 'venta', documentId: doc.id, clientId: doc.clientId, paymentId: null, allocationId: null, operationAt: doc.occurredAt, period, mode: null, base: doc.totals.net, ivaTreatment: 'antes_iva', rateBps: rules.saleBps, amount: applyBps(doc.totals.net, rules.saleBps), rulesSnapshot: snapshotRules(s, doc.companyId) }, ctx);
    }
    return;
  }
  // Umbral mensual (Frutos del Nogal)
  const unlock = evaluateUnlock(s, doc.companyId, period, doc, ctx);
  const registeredAt = doc.createdAt;
  const net = doc.totals.net;
  let eligibleBase = 0;
  let reason;
  if (doc.legacy) reason = 'Venta migrada de la versión 1: sin evidencia de elegibilidad.';
  else if (!unlock) reason = `Periodo ${period} bloqueado: el acumulado no alcanza el umbral.`;
  else if (unlock.triggerDocumentId === doc.id) {
    // Venta del cruce: comisiona SOLO lo que supera el umbral ("de los 70 en adelante").
    const excess = Math.max(0, unlock.cumulativeAtUnlock - unlock.thresholdPesos);
    eligibleBase = Math.min(net, rules.thresholdBase === 'total' ? mulDiv(excess, net, doc.totals.total) : excess);
    reason = eligibleBase > 0 ? `Venta del cruce: comisiona solo el excedente sobre el umbral (${eligibleBase} de ${net} antes de IVA).` : 'La venta alcanzó exactamente el umbral: no hay excedente que comisione.';
  } else if (registeredAt <= unlock.unlockedAt) reason = 'Registrada antes del desbloqueo del periodo (sin retroactividad).';
  else {
    eligibleBase = net;
    reason = `Registrada después del desbloqueo (${unlock.unlockedAt}).`;
  }
  const eligible = eligibleBase > 0;
  const mode = rules.modes[doc.saleMode];
  assert(mode, 'Modalidad comercial no configurada.', 'mode');
  doc.commission = { saleEligible: eligible, eligibleBase, period, unlockAt: unlock?.unlockedAt || null, reason, evaluatedAt: nowOf(ctx) };
  const line = (base, status, why) =>
    pushLine(s, { companyId: doc.companyId, type: 'venta', documentId: doc.id, clientId: doc.clientId, paymentId: null, allocationId: null, operationAt: doc.occurredAt, period, mode: doc.saleMode, base, ivaTreatment: 'antes_iva', rateBps: mode.saleBps, amount: applyBps(base, mode.saleBps), status, blockedReason: why, rulesSnapshot: snapshotRules(s, doc.companyId) }, ctx);
  if (eligible) line(eligibleBase, 'generada', null);
  // La parte no elegible queda registrada como bloqueada (informativa).
  if (net - eligibleBase > 0) line(net - eligibleBase, 'bloqueada', eligible ? 'Parte de la venta del cruce que completa el umbral (hasta $70 M): no comisiona.' : reason);
}

/** Suma aplicada a la venta ANTES de esta asignación (para redondeo acumulado). */
function priorApplied(s, documentId, allocationId) {
  let t = 0;
  for (const p of s.payments) {
    if (p.status !== 'activo') continue;
    for (const a of p.allocations) {
      if (a.documentId === documentId && a.id !== allocationId && a.commissioned) t += a.amount;
    }
  }
  return t;
}

/**
 * Se llama cada vez que una parte de un pago se aplica a una venta.
 * Redondeo acumulado: la base y la comisión de cada abono se calculan como la
 * diferencia entre el acumulado después y antes del abono; así la suma de
 * abonos parciales coincide con el cálculo sobre el total cobrado.
 */
export function onAllocation(s, payment, allocation, doc, ctx) {
  const rules = s.rules[doc.companyId];
  const prior = priorApplied(s, doc.id, allocation.id);
  const after = prior + allocation.amount;
  const period = periodOf(payment.receivedAt);
  allocation.commissioned = true;
  if (rules.kind === 'recaudo') {
    if (rules.collectionBps <= 0) return;
    pushLine(s, {
      companyId: doc.companyId,
      type: 'cobro',
      documentId: doc.id,
      clientId: doc.clientId,
      paymentId: payment.id,
      allocationId: allocation.id,
      operationAt: payment.receivedAt,
      period,
      mode: null,
      base: allocation.amount,
      ivaTreatment: 'recaudo_total',
      rateBps: rules.collectionBps,
      amount: applyBps(after, rules.collectionBps) - applyBps(prior, rules.collectionBps),
      rulesSnapshot: snapshotRules(s, doc.companyId),
    }, ctx);
    return;
  }
  const mode = rules.modes[doc.saleMode];
  // Base del cobro: recaudo × (base elegible antes de IVA ÷ total de la venta).
  const net = doc.commission?.saleEligible ? (doc.commission.eligibleBase ?? doc.totals.net) : doc.totals.net;
  const total = doc.totals.total;
  const baseBefore = mulDiv(prior, net, total);
  const baseAfter = mulDiv(after, net, total);
  const base = baseAfter - baseBefore;
  const unlock = unlockFor(s, doc.companyId, period);
  let eligible = false;
  let reason;
  if (!doc.commission?.saleEligible) reason = 'La venta original no fue elegible (antes de llegar a $70 M en su mes, o migrada).';
  else if (!unlock) reason = `El periodo del recaudo (${period}) no ha alcanzado el umbral.`;
  else if (allocation.at <= unlock.unlockedAt) reason = `Recaudo aplicado antes del desbloqueo del periodo ${period}.`;
  else eligible = true;
  pushLine(s, {
    companyId: doc.companyId,
    type: 'cobro',
    documentId: doc.id,
    clientId: doc.clientId,
    paymentId: payment.id,
    allocationId: allocation.id,
    operationAt: payment.receivedAt,
    period,
    mode: doc.saleMode,
    base,
    ivaTreatment: 'proporcional_antes_iva',
    rateBps: mode.collectionBps,
    amount: applyBps(baseAfter, mode.collectionBps) - applyBps(baseBefore, mode.collectionBps),
    status: eligible ? 'generada' : 'bloqueada',
    blockedReason: eligible ? null : reason,
    rulesSnapshot: snapshotRules(s, doc.companyId),
  }, ctx);
}

/** Revierte una línea: si no se ha liquidado se marca reversada; si ya se
 *  liquidó o pagó, se crea un ajuste negativo pendiente de descontar. */
function reverseLine(s, c, reason, ctx) {
  if (c.status === 'reversada' || c.reversedBy) return null;
  if (c.status === 'bloqueada' || c.status === 'generada') {
    c.status = 'reversada';
    c.reversal = { at: nowOf(ctx), reason, user: ctx?.user || 'usuario' };
    return c;
  }
  const adj = pushLine(s, {
    companyId: c.companyId,
    type: 'ajuste',
    documentId: c.documentId,
    clientId: c.clientId,
    paymentId: c.paymentId,
    allocationId: c.allocationId,
    operationAt: nowOf(ctx),
    period: periodOf(nowOf(ctx)),
    mode: c.mode,
    base: -c.base,
    ivaTreatment: c.ivaTreatment,
    rateBps: c.rateBps,
    amount: -c.amount,
    reversalOf: c.id,
    adjustmentReason: reason,
    rulesSnapshot: c.rulesSnapshot,
  }, ctx);
  c.reversedBy = adj.id;
  return adj;
}

export function onPaymentReversed(s, payment, reason, ctx) {
  for (const c of s.commissions.filter((x) => x.paymentId === payment.id && x.type === 'cobro')) reverseLine(s, c, reason, ctx);
}

export function onAllocationRemoved(s, allocationId, reason, ctx) {
  for (const c of s.commissions.filter((x) => x.allocationId === allocationId && x.type === 'cobro')) reverseLine(s, c, reason, ctx);
}

export function onSaleVoided(s, doc, ctx) {
  for (const c of s.commissions.filter((x) => x.documentId === doc.id && x.type === 'venta')) reverseLine(s, c, `Venta anulada: ${doc.voided?.reason || ''}`, ctx);
}

/** Estado del umbral mensual (panel de control de Frutos del Nogal). */
export function thresholdStatus(s, companyId, period) {
  const rules = s.rules[companyId];
  if (rules.kind !== 'umbral') return null;
  const cumulative = periodSalesCumulative(s, companyId, period);
  const unlock = unlockFor(s, companyId, period);
  const lines = s.commissions.filter((c) => c.companyId === companyId && c.period === period);
  const live = (t) => lines.filter((c) => c.type === t && c.status !== 'reversada' && c.status !== 'bloqueada');
  const eligibleSales = s.documents.filter((d) => isActiveSale(d) && d.companyId === companyId && periodOf(d.date) === period && d.commission?.saleEligible);
  const eligibleBaseOf = (d) => d.commission.eligibleBase ?? d.totals.net;
  return {
    period,
    threshold: rules.thresholdPesos,
    thresholdBase: rules.thresholdBase,
    cumulative,
    missing: Math.max(0, rules.thresholdPesos - cumulative),
    pct: Math.min(100, (cumulative / rules.thresholdPesos) * 100),
    unlocked: !!unlock,
    unlock,
    belowAfterVoids: !!unlock && cumulative < rules.thresholdPesos,
    eligibleSalesNet: sum(eligibleSales, eligibleBaseOf),
    eligibleSalesCount: eligibleSales.length,
    saleCommission: sum(live('venta'), (c) => c.amount),
    collectionCommission: sum(live('cobro'), (c) => c.amount),
    blocked: sum(lines.filter((c) => c.status === 'bloqueada'), (c) => c.amount),
    pending: sum(lines.filter((c) => c.status === 'generada'), (c) => c.amount),
    settled: sum(lines.filter((c) => c.status === 'liquidada'), (c) => c.amount),
    paid: sum(lines.filter((c) => c.status === 'pagada'), (c) => c.amount),
    reversed: sum(lines.filter((c) => c.status === 'reversada'), (c) => c.amount),
    byMode: Object.fromEntries(Object.keys(rules.modes).map((m) => [m, sum(lines.filter((c) => c.mode === m && ['generada', 'liquidada', 'pagada'].includes(c.status)), (c) => c.amount)])),
  };
}

/** Totales por estado para una empresa (o todas) y un periodo opcional. */
export function commissionSummary(s, { companyId = null, period = null } = {}) {
  const lines = s.commissions.filter((c) => (!companyId || c.companyId === companyId) && (!period || c.period === period));
  const by = (st) => sum(lines.filter((c) => c.status === st), (c) => c.amount);
  return {
    blocked: by('bloqueada'),
    pending: by('generada'),
    settled: by('liquidada'),
    paid: by('pagada'),
    reversed: by('reversada'),
    generated: sum(lines.filter((c) => ['generada', 'liquidada', 'pagada'].includes(c.status)), (c) => c.amount),
    sale: sum(lines.filter((c) => c.type === 'venta' && ['generada', 'liquidada', 'pagada'].includes(c.status)), (c) => c.amount),
    collection: sum(lines.filter((c) => c.type === 'cobro' && ['generada', 'liquidada', 'pagada'].includes(c.status)), (c) => c.amount),
    adjustments: sum(lines.filter((c) => c.type === 'ajuste' && ['generada', 'liquidada', 'pagada'].includes(c.status)), (c) => c.amount),
    count: lines.length,
  };
}

/** Confirma la política de Frutos del Nogal antes de liquidar comisiones. */
export function confirmPolicy(s, { companyId }, ctx) {
  s.settings.policy[companyId] = { confirmed: true, confirmedAt: nowOf(ctx), rulesSnapshot: snapshotRules(s, companyId) };
  audit(s, ctx, 'confirmar_politica', 'comisiones', companyId, '');
}

/** Agrupa líneas pendientes en una liquidación (no significa que se pagó). */
export function createSettlement(s, { companyId, commissionIds, notes, requestId }, ctx) {
  if (requestId) {
    const dup = s.settlements.find((x) => x.requestId === requestId);
    if (dup) return dup;
  }
  assert(Array.isArray(commissionIds) && commissionIds.length > 0, 'Selecciona al menos una comisión pendiente.', 'settle');
  if (s.rules[companyId]?.kind === 'umbral' && !s.settings.policy?.[companyId]?.confirmed) {
    throw new DomainError('Antes de liquidar comisiones de Frutos del Nogal confirma la política de cálculo (Comisiones → Política).', 'policy');
  }
  const lines = commissionIds.map((id) => getOrFail(s.commissions, id, 'la comisión'));
  for (const c of lines) {
    assert(c.companyId === companyId, 'Todas las comisiones deben ser de la misma empresa.', 'settle');
    assert(c.status === 'generada', 'Solo se liquidan comisiones pendientes de liquidar.', 'settle');
  }
  const total = sum(lines, (c) => c.amount);
  const st = { id: newId('liq'), number: nextNumber(s, companyId, 'liquidacion'), companyId, commissionIds: lines.map((c) => c.id), total, status: 'liquidada', notes: cleanText(notes), createdAt: nowOf(ctx), paidAt: null, payment: null, requestId: requestId || null };
  s.settlements.push(st);
  for (const c of lines) {
    c.status = 'liquidada';
    c.settlementId = st.id;
  }
  audit(s, ctx, 'liquidar', 'liquidacion', st.id, `${st.number} · ${total}`);
  return st;
}

/** Marca una liquidación como pagada: requiere fecha y referencia del pago recibido. */
export function markSettlementPaid(s, { settlementId, date, reference }, ctx) {
  const st = getOrFail(s.settlements, settlementId, 'la liquidación');
  assert(st.status === 'liquidada', 'Esta liquidación ya está pagada o anulada.', 'settle');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date || ''), 'Indica la fecha en que recibiste el pago de la comisión.', 'date');
  st.status = 'pagada';
  st.paidAt = date;
  st.payment = { reference: cleanText(reference, 120), registeredAt: nowOf(ctx) };
  for (const id of st.commissionIds) {
    const c = getOrFail(s.commissions, id, 'la comisión');
    c.status = 'pagada';
    c.paidAt = date;
  }
  audit(s, ctx, 'pagar_liquidacion', 'liquidacion', st.id, date);
  return st;
}

/** Anula una liquidación no pagada: sus líneas vuelven a pendientes. */
export function cancelSettlement(s, { settlementId, reason }, ctx) {
  const st = getOrFail(s.settlements, settlementId, 'la liquidación');
  assert(st.status === 'liquidada', 'Solo se anula una liquidación que aún no se ha pagado.', 'settle');
  assert(cleanText(reason), 'Indica el motivo.', 'reason');
  st.status = 'anulada';
  st.cancel = { at: nowOf(ctx), reason: cleanText(reason) };
  for (const id of st.commissionIds) {
    const c = getOrFail(s.commissions, id, 'la comisión');
    if (c.status === 'liquidada') {
      c.status = 'generada';
      c.settlementId = null;
    }
  }
  audit(s, ctx, 'anular_liquidacion', 'liquidacion', st.id, cleanText(reason));
  return st;
}

/** Cambio de reglas: no recalcula el historial (cada línea guarda su copia). */
export function updateRules(s, { companyId, patch, reason }, ctx) {
  assert(cleanText(reason), 'Indica el motivo del cambio de reglas.', 'reason');
  const r = s.rules[companyId];
  assert(r, 'Empresa no válida.', 'company');
  const before = JSON.stringify(r);
  if (r.kind === 'recaudo') {
    if (patch.collectionBps !== undefined) r.collectionBps = Math.max(0, Math.round(patch.collectionBps));
    if (patch.saleBps !== undefined) r.saleBps = Math.max(0, Math.round(patch.saleBps));
  } else {
    if (patch.thresholdPesos !== undefined) {
      assert(Number.isSafeInteger(patch.thresholdPesos) && patch.thresholdPesos > 0, 'El umbral debe ser un valor en pesos.', 'rules');
      r.thresholdPesos = patch.thresholdPesos;
    }
    if (patch.thresholdBase) r.thresholdBase = patch.thresholdBase === 'total' ? 'total' : 'neto_antes_iva';
    for (const m of Object.keys(r.modes)) {
      if (patch.modes?.[m]?.saleBps !== undefined) r.modes[m].saleBps = Math.max(0, Math.round(patch.modes[m].saleBps));
      if (patch.modes?.[m]?.collectionBps !== undefined) r.modes[m].collectionBps = Math.max(0, Math.round(patch.modes[m].collectionBps));
    }
    s.settings.policy[companyId] = { confirmed: false, confirmedAt: null };
  }
  audit(s, ctx, 'cambiar_reglas', 'reglas', companyId, `${before} → ${JSON.stringify(r)} · ${cleanText(reason)}`);
}

/**
 * Proyección del umbral mensual: ritmo diario de ventas y día estimado en que
 * se alcanzaría. Solo tiene sentido para el mes en curso.
 */
export function thresholdProjection(s, companyId, period, today) {
  const st = thresholdStatus(s, companyId, period);
  if (!st) return null;
  const [y, m] = period.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const current = today.slice(0, 7) === period;
  if (!current) return { ...st, current: false };
  const day = Number(today.slice(8, 10));
  const remainingDays = daysInMonth - day;
  const pace = st.cumulative / day; // pesos por día (antes de IVA)
  const projected = Math.round(pace * daysInMonth);
  let reachDay = null;
  if (!st.unlocked && pace > 0) {
    const d = Math.ceil(st.threshold / pace);
    if (d <= daysInMonth) reachDay = Math.max(d, day);
  }
  return {
    ...st,
    current: true,
    day,
    daysInMonth,
    remainingDays,
    pace: Math.round(pace),
    projected,
    reachDay,
    reachDate: reachDay ? `${period}-${String(reachDay).padStart(2, '0')}` : null,
    neededPerDay: !st.unlocked && remainingDays > 0 ? Math.ceil(st.missing / remainingDays) : null,
  };
}

/**
 * Simulador: cuánta comisión generaría una venta si se registrara AHORA con
 * este valor antes de IVA. Usa exactamente las mismas reglas del motor.
 */
export function simulateSaleCommission(s, { companyId, date, net, total = null, saleMode }) {
  const rules = s.rules[companyId];
  if (!rules || !Number.isSafeInteger(net) || net < 0) return null;
  if (rules.kind === 'recaudo') {
    const base = total ?? net;
    return { kind: 'recaudo', sale: 0, collection: applyBps(base, rules.collectionBps), collectionBase: base, rateBps: rules.collectionBps, note: `0 % por venta. Al cobrar el total generas ${rules.collectionBps / 100} % de lo recaudado.` };
  }
  const mode = rules.modes[saleMode];
  if (!mode) return { kind: 'umbral', missingMode: true };
  const period = periodOf(date);
  const unlock = unlockFor(s, companyId, period);
  const cumulative = periodSalesCumulative(s, companyId, period);
  let eligible;
  let note;
  if (unlock) {
    eligible = net;
    note = 'El mes ya pasó los $70 M: toda la venta comisiona.';
  } else if (cumulative + net >= rules.thresholdPesos) {
    eligible = cumulative + net - rules.thresholdPesos;
    note = eligible > 0 ? `Con esta venta cruzas el umbral: comisiona solo lo que pasa de ${rules.thresholdPesos / 1e6} M.` : 'Con esta venta llegas exactamente al umbral: aún no hay excedente que comisione.';
  } else {
    eligible = 0;
    note = `Mes bloqueado: faltarían ${rules.thresholdPesos - cumulative - net} antes de IVA para llegar al umbral.`;
  }
  return {
    kind: 'umbral',
    eligibleBase: eligible,
    sale: applyBps(eligible, mode.saleBps),
    collection: applyBps(eligible, mode.collectionBps),
    saleBps: mode.saleBps,
    collectionBps: mode.collectionBps,
    cumulativeBefore: cumulative,
    missingAfter: Math.max(0, rules.thresholdPesos - cumulative - net),
    note,
  };
}
