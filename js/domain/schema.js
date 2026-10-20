// Estructura de datos v2 de Mi Centro Comercial. Fuente única de verdad: todo
// saldo, total y comisión se calcula en los módulos de dominio a partir de
// estas colecciones; las pantallas nunca calculan por su cuenta.

import { emptyPetHome } from './pethome.js';

export const SCHEMA_VERSION = 2;
export const APP_VERSION = '3.2.0';

/** Reglas comerciales vigentes. Cada comisión guarda una copia de las reglas
 *  aplicadas (rulesSnapshot), así un cambio futuro no altera el historial. */
export const DEFAULT_RULES = {
  puntazo: {
    kind: 'recaudo',
    saleBps: 0, // 0 % por venta
    collectionBps: 600, // 6 % por cobro
    collectionBase: 'recaudado', // sobre el dinero efectivamente recibido
  },
  nogal: {
    kind: 'umbral',
    thresholdPesos: 70_000_000,
    thresholdBase: 'neto_antes_iva', // ventas antes de IVA, después de descuentos
    crossingRule: 'excedente', // la venta del cruce comisiona solo lo que supera el umbral
    collectionBase: 'proporcional_antes_iva', // recaudo × (neto / total)
    modes: {
      mayorista: { label: 'Mayorista', saleBps: 40, collectionBps: 40 },
      normal: { label: 'Normal', saleBps: 75, collectionBps: 75 },
    },
  },
};

export const COMPANIES = {
  puntazo: { id: 'puntazo', name: 'El Puntazo', short: 'PZ', icon: '🎉', desc: 'Piñatería', active: true },
  nogal: { id: 'nogal', name: 'Frutos del Nogal', short: 'NG', icon: '🌰', desc: 'Frutos secos y deshidratados', active: true },
  // Negocio de la versión 1. Sus datos se conservan; no participa del CRM.
  pethome: { id: 'pethome', name: 'Alegría Pet Home', short: 'PH', icon: '🐾', desc: 'Datos conservados de la versión 1', active: false, legacy: true },
};

export const ACTIVE_COMPANY_IDS = ['puntazo', 'nogal'];

export const DOC_KINDS = { cotizacion: 'Cotización', pedido: 'Pedido', venta: 'Venta' };

export const ORDER_STATUSES = {
  borrador: 'Borrador',
  cotizado: 'Cotizado',
  pendiente_confirmacion: 'Pendiente de confirmación',
  confirmado: 'Confirmado',
  en_preparacion: 'En preparación',
  despacho_parcial: 'Despacho parcial',
  despachado: 'Despachado',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

export const QUOTE_STATUSES = { borrador: 'Borrador', cotizado: 'Enviada', aceptada: 'Aceptada', rechazada: 'Rechazada', cancelado: 'Cancelada' };
export const SALE_STATUSES = { emitida: 'Emitida', anulada: 'Anulada' };

export const CLIENT_STATUSES = { prospecto: 'Prospecto', activo: 'Activo', inactivo: 'Inactivo', bloqueado: 'Bloqueado' };

export const COMMISSION_STATUSES = {
  bloqueada: 'Bloqueada',
  generada: 'Pendiente de liquidar',
  liquidada: 'Liquidada',
  pagada: 'Pagada',
  reversada: 'Reversada',
};

export const PAYMENT_METHODS = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  consignacion: 'Consignación',
  nequi: 'Nequi',
  daviplata: 'Daviplata',
  cheque: 'Cheque',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};

export const ACTIVITY_TYPES = {
  llamada: 'Llamada',
  no_contactado: 'Cliente no contactado',
  visita: 'Visita',
  whatsapp: 'WhatsApp',
  nota: 'Nota comercial',
  seguimiento: 'Seguimiento',
  promesa: 'Promesa de pago',
  recuperacion: 'Intento de recuperación',
};

export const PAYMENT_TERMS = [
  { days: 0, label: 'Contado' },
  { days: 7, label: '7 días' },
  { days: 15, label: '15 días' },
  { days: 30, label: '30 días' },
];

export const DEFAULT_WA_TEMPLATES = {
  presentacion: { label: 'Presentación comercial', text: 'Hola {contacto}, le saluda {vendedor} de {empresa}. Me gustaría contarle sobre nuestros productos y condiciones. ¿Le puedo enviar el catálogo?' },
  cotizacion: { label: 'Seguimiento de cotización', text: 'Hola {contacto}, le escribo de {empresa} sobre la cotización {documento} por {total}. ¿Pudo revisarla? Quedo atento a sus comentarios.' },
  pedido: { label: 'Confirmación de pedido', text: 'Hola {contacto}, confirmamos su pedido {documento} con {empresa} por {total}. Le avisaremos cuando sea despachado.' },
  despacho: { label: 'Información de despacho', text: 'Hola {contacto}, su pedido {documento} de {empresa} fue despachado. Transportadora/guía: {guia}.' },
  recordatorio: { label: 'Recordatorio de pago', text: 'Hola {contacto}, le recordamos que el documento {documento} de {empresa} tiene un saldo de {saldo} con vencimiento el {vencimiento}. Quedamos atentos.' },
  abono: { label: 'Confirmación de abono', text: 'Hola {contacto}, confirmamos la recepción de su pago por {valor_pago} a {empresa}. Saldo pendiente: {saldo}. ¡Gracias!' },
  promesa: { label: 'Seguimiento de promesa de pago', text: 'Hola {contacto}, según lo conversado, quedó el compromiso de pago por {valor_promesa} para el {fecha_promesa}. ¿Nos confirma por favor? Saldo actual con {empresa}: {saldo}.' },
  recuperacion: { label: 'Recuperación de cliente', text: 'Hola {contacto}, hace un tiempo no hablamos. En {empresa} tenemos novedades que le pueden interesar. ¿Le parece si le comparto la lista de precios?' },
};

export function defaultSettings() {
  return {
    sellerName: '',
    agingBuckets: [30, 60, 90],
    inactivity: { noPurchaseDays: 60, noContactDays: 30 },
    defaultTermDays: 30,
    creditLimitBlocks: { puntazo: false, nogal: false },
    waTemplates: structuredClone(DEFAULT_WA_TEMPLATES),
    goals: { puntazo: { sales: 0, collection: 0, byPeriod: {} }, nogal: { sales: 0, collection: 0, byPeriod: {} } },
    // Política confirmada por el usuario el 2026-10-13 (umbral antes de IVA,
    // excedente de la venta del cruce, cobro solo de ventas elegibles y sujeto
    // al umbral del mes del recaudo, base antes de IVA).
    policy: { nogal: { confirmed: true, confirmedAt: '2026-10-13T12:00:00.000Z', by: 'usuario' } },
    agendaDone: {},
    // Datos de cada empresa para cotizaciones e informes en PDF.
    companyProfiles: {
      puntazo: { legalName: 'El Puntazo', nit: '', phone: '', email: '', address: '', city: 'Medellín', logo: null, quoteTerms: '' },
      nogal: { legalName: 'Frutos del Nogal', nit: '', phone: '', email: '', address: '', city: 'Medellín', logo: null, quoteTerms: 'Empresa importadora. Venta por presentación completa (caja, bulto o saco). Precios sujetos a disponibilidad de inventario.' },
    },
    notifications: false,
    lastBackupAt: null,
  };
}

export function emptyState() {
  return {
    schema: SCHEMA_VERSION,
    rev: 0,
    meta: { createdAt: new Date().toISOString(), migratedFrom: null, migratedAt: null, migrationReport: null },
    companies: structuredClone(COMPANIES),
    rules: structuredClone(DEFAULT_RULES),
    settings: defaultSettings(),
    counters: {},
    clients: [],
    products: [],
    documents: [],
    dispatches: [],
    payments: [],
    commissions: [],
    settlements: [],
    unlocks: {}, // 'nogal:AAAA-MM' -> registro inmutable del desbloqueo
    activities: [],
    tasks: [],
    audit: [],
    legacy: { petHome: { products: [], suppliers: [] } },
    pethome: emptyPetHome(),
  };
}

/** Rellena campos que falten (estados guardados por versiones previas de v2). */
export function normalizeState(s) {
  const base = emptyState();
  const out = { ...base, ...s };
  out.settings = { ...base.settings, ...(s.settings || {}) };
  out.settings.inactivity = { ...base.settings.inactivity, ...(s.settings?.inactivity || {}) };
  out.settings.creditLimitBlocks = { ...base.settings.creditLimitBlocks, ...(s.settings?.creditLimitBlocks || {}) };
  out.settings.waTemplates = { ...base.settings.waTemplates, ...(s.settings?.waTemplates || {}) };
  out.settings.goals = { ...base.settings.goals, ...(s.settings?.goals || {}) };
  out.settings.policy = { ...base.settings.policy, ...(s.settings?.policy || {}) };
  out.settings.companyProfiles = { puntazo: { ...base.settings.companyProfiles.puntazo, ...(s.settings?.companyProfiles?.puntazo || {}) }, nogal: { ...base.settings.companyProfiles.nogal, ...(s.settings?.companyProfiles?.nogal || {}) } };
  out.companies = { ...base.companies, ...(s.companies || {}) };
  out.rules = { ...base.rules, ...(s.rules || {}) };
  for (const k of ['clients', 'products', 'documents', 'dispatches', 'payments', 'commissions', 'settlements', 'activities', 'tasks', 'audit']) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  if (!out.unlocks || typeof out.unlocks !== 'object') out.unlocks = {};
  if (!out.counters || typeof out.counters !== 'object') out.counters = {};
  if (!out.legacy) out.legacy = base.legacy;
  const ph = s.pethome || {};
  out.pethome = { ...base.pethome, ...ph, profile: { ...base.pethome.profile, ...(ph.profile || {}) }, settings: { ...base.pethome.settings, ...(ph.settings || {}) }, counters: { ...base.pethome.counters, ...(ph.counters || {}) } };
  for (const k of ['products', 'suppliers', 'notes', 'sales', 'purchases']) if (!Array.isArray(out.pethome[k])) out.pethome[k] = [];
  return out;
}
