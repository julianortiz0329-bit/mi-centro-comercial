// Conexión con la nube (Supabase). Solo se usan las funciones alegria_* y la
// clave personal de cada socio: sin ella no se puede leer ni escribir nada.
export const CLOUD = {
  url: 'https://zqjdqrcvnkripgbkagcu.supabase.co',
  key: 'sb_publishable_TzeQkZxUk39BJDEBZRHWsg_HILlKlEc',
};

export class RemoteError extends Error {
  constructor(message, { offline = false, auth = false } = {}) {
    super(message);
    this.name = 'RemoteError';
    this.offline = offline;
    this.auth = auth;
  }
}

export async function rpc(fn, args, { timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(`${CLOUD.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: CLOUD.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: ctrl.signal,
    });
  } catch {
    throw new RemoteError('Sin conexión con la nube. Lo guardado queda en el celular y se sube cuando vuelva el internet.', { offline: true });
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const auth = body?.code === '28000';
    throw new RemoteError(auth ? 'La clave no es válida o fue desactivada.' : body?.message || `Error ${res.status} de la nube.`, { auth });
  }
  return body;
}
