// Configuración general (no financiera) y metas.
import { assert, audit, cleanText } from './common.js';
import { ACTIVE_COMPANY_IDS } from './schema.js';

export function updateSettings(s, patch, ctx) {
  const st = s.settings;
  if (patch.sellerName !== undefined) st.sellerName = cleanText(patch.sellerName, 80);
  if (patch.defaultTermDays !== undefined) {
    const d = Number(patch.defaultTermDays);
    assert(Number.isInteger(d) && d >= 0 && d <= 365, 'El plazo general debe estar entre 0 y 365 días.', 'term');
    st.defaultTermDays = d;
  }
  if (patch.agingBuckets) {
    const b = patch.agingBuckets.map(Number);
    assert(b.length >= 1 && b.length <= 6 && b.every((x, i) => Number.isInteger(x) && x > 0 && (i === 0 || x > b[i - 1])), 'Los rangos deben ser días crecientes, p. ej. 30, 60, 90.', 'aging');
    st.agingBuckets = b;
  }
  if (patch.inactivity) {
    const { noPurchaseDays, noContactDays } = patch.inactivity;
    assert(Number.isInteger(noPurchaseDays) && noPurchaseDays > 0 && Number.isInteger(noContactDays) && noContactDays > 0, 'Los días de inactividad deben ser números positivos.', 'inactivity');
    st.inactivity = { noPurchaseDays, noContactDays };
  }
  if (patch.creditLimitBlocks) for (const co of ACTIVE_COMPANY_IDS) st.creditLimitBlocks[co] = !!patch.creditLimitBlocks[co];
  if (patch.waTemplates) for (const [k, text] of Object.entries(patch.waTemplates)) if (st.waTemplates[k]) st.waTemplates[k].text = cleanText(text, 1000);
  if (patch.companyProfile) {
    const { companyId, ...pf } = patch.companyProfile;
    assert(ACTIVE_COMPANY_IDS.includes(companyId), 'Empresa no válida.', 'company');
    const cur = st.companyProfiles[companyId] || {};
    for (const k of ['legalName', 'nit', 'phone', 'email', 'address', 'city', 'quoteTerms']) if (pf[k] !== undefined) cur[k] = cleanText(pf[k], k === 'quoteTerms' ? 1500 : 200);
    if (pf.logo !== undefined) {
      assert(pf.logo === null || (typeof pf.logo.dataUrl === 'string' && pf.logo.dataUrl.startsWith('data:image/jpeg') && pf.logo.dataUrl.length < 400000), 'El logo no es válido o es muy pesado.', 'logo');
      cur.logo = pf.logo;
    }
    st.companyProfiles[companyId] = cur;
  }
  if (patch.notifications !== undefined) st.notifications = !!patch.notifications;
  if (patch.migrationSeen) st.migrationSeen = true;
  if (patch.lastBackupAt) st.lastBackupAt = patch.lastBackupAt;
  audit(s, ctx, 'configuracion', 'ajustes', 'general', Object.keys(patch).join(','));
}

export function setGoals(s, { goals }, ctx) {
  for (const co of ACTIVE_COMPANY_IDS) {
    const g = goals[co];
    if (!g) continue;
    for (const k of ['sales', 'collection']) assert(Number.isSafeInteger(g[k]) && g[k] >= 0, 'Las metas deben ser valores en pesos.', 'goal');
    s.settings.goals[co] = { ...s.settings.goals[co], sales: g.sales, collection: g.collection };
  }
  audit(s, ctx, 'metas', 'ajustes', 'metas', JSON.stringify(goals));
}
