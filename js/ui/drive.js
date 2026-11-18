// Copia de seguridad en Google Drive (3.11). Usa el inicio de sesión de Google
// (Google Identity Services) con el permiso más pequeño posible: drive.file,
// que solo deja ver y cambiar los archivos que esta app creó. Se guarda un
// archivo que se actualiza en cada copia y otro por mes como historial.
// La configuración (ID de cliente y archivos) vive solo en este celular.
const KEY = 'mcc_drive';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const NAME = 'Mi Centro Comercial - respaldo.json';

export function driveConfig() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}
export function saveDriveConfig(patch) {
  const next = { ...driveConfig(), ...patch };
  for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
export const driveReady = () => /\.apps\.googleusercontent\.com$/.test(driveConfig().clientId || '');
/** Días desde la última copia en Drive (null si nunca). */
export function driveAgeDays(now = Date.now()) {
  const at = driveConfig().lastAt;
  return at ? Math.floor((now - Date.parse(at)) / 864e5) : null;
}

let gis = null;
function loadGis() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (!gis) {
    gis = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'https://accounts.google.com/gsi/client';
      sc.async = true;
      sc.onload = () => resolve();
      sc.onerror = () => {
        gis = null;
        reject(new Error('No se pudo cargar el inicio de sesión de Google. Revisa tu conexión.'));
      };
      document.head.appendChild(sc);
    });
  }
  return gis;
}

let token = null; // { value, exp } solo en memoria
async function getToken({ interactive = true } = {}) {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const { clientId, consented } = driveConfig();
  if (!driveReady()) throw new Error('Primero configura tu ID de cliente de Google.');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = globalThis.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        if (r.error) return reject(new Error(r.error === 'access_denied' ? 'No diste permiso a Google Drive.' : `Google respondió: ${r.error_description || r.error}`));
        token = { value: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
        saveDriveConfig({ consented: true });
        resolve(token.value);
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Cerraste la ventana de Google antes de terminar.' : 'No se pudo abrir la ventana de Google (¿bloqueador de ventanas?).')),
    });
    // La primera vez pide consentimiento; después la ventana se cierra sola.
    client.requestAccessToken({ prompt: consented || !interactive ? '' : 'consent' });
  });
}

async function upload(tok, fileId, name, body) {
  const auth = { Authorization: `Bearer ${tok}` };
  if (fileId) {
    const r = await fetch(`${UPLOAD}/${fileId}?uploadType=media&fields=id`, { method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' }, body });
    if (r.ok) return (await r.json()).id;
    if (r.status !== 404) throw await driveError(r);
  }
  const boundary = `mcc${Date.now()}`;
  const meta = JSON.stringify({ name, mimeType: 'application/json', description: 'Copia de seguridad de Mi Centro Comercial. Restáurala en Más → Datos → Restaurar desde archivo.' });
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const r = await fetch(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', headers: { ...auth, 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart });
  if (!r.ok) throw await driveError(r);
  return (await r.json()).id;
}

async function driveError(r) {
  if (r.status === 401) token = null;
  let msg = '';
  try {
    msg = (await r.json())?.error?.message || '';
  } catch {
    /* sin detalle */
  }
  if (r.status === 403 && /has not been used|disabled/i.test(msg)) return new Error('Falta activar "Google Drive API" en tu proyecto de Google Cloud.');
  return new Error(`Google Drive no aceptó la copia (${r.status}${msg ? `: ${msg}` : ''}).`);
}

/** Sube la copia (texto JSON ya armado). Devuelve la fecha de la copia. */
export async function backupToDrive(json, now = new Date()) {
  let tok = await getToken();
  const cfg = driveConfig();
  const month = now.toISOString().slice(0, 7);
  let fileId;
  try {
    fileId = await upload(tok, cfg.fileId, NAME, json);
  } catch (e) {
    if (token) throw e;
    tok = await getToken(); // el permiso venció: se pide de nuevo una vez
    fileId = await upload(tok, cfg.fileId, NAME, json);
  }
  const monthly = { ...(cfg.monthly || {}) };
  monthly[month] = await upload(tok, monthly[month], `Mi Centro Comercial - respaldo ${month}.json`, json);
  const at = now.toISOString();
  saveDriveConfig({ fileId, monthly, lastAt: at });
  return at;
}

export function disconnectDrive() {
  const tok = token?.value;
  token = null;
  if (tok && globalThis.google?.accounts?.oauth2) globalThis.google.accounts.oauth2.revoke(tok, () => {});
  saveDriveConfig({ consented: null });
}
