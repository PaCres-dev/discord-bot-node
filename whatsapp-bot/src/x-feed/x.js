// Feed "Para ti" de X: sesión, paginado, filtros y memoria de tweets enviados.
// Todo lo específico de X vive en esta carpeta; si X cambia algo, se arregla acá.
import { join } from 'node:path';
import { buildHomeTimelineUrl, createOperationProvider, parseTimeline, WEB_BEARER } from './home-timeline.js';
import { deleteSession, loadSession, loginWithPassword, saveSession } from './session.js';
import { createSeenStore } from './seen-store.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';
const TIMEOUT_MS = 20000;
export const MAX_PAGES = 5;
// Solo se descargan fotos de este dominio.
const PHOTO_HOST = 'pbs.twimg.com';

export class XNotConfiguredError extends Error {}

export function createXFeed({
  username,
  password,
  email,
  authDir,
  fetchImpl = fetch,
  login = loginWithPassword,
  transactionId = async () => null,
  logger = console,
}) {
  const sessionFile = join(authDir, 'x-session.json');
  const seenFile = join(authDir, 'x-seen.json');
  const getOperation = createOperationProvider({ fetchImpl, logger });
  let session = null;
  let seenStore = null;

  const seen = async () => (seenStore ??= await createSeenStore(seenFile));

  async function ensureSession({ fresh = false } = {}) {
    if (!fresh) session ??= await loadSession(sessionFile);
    if (session && !fresh) return session;
    if (!username || !password) throw new XNotConfiguredError('Faltan X_USERNAME y X_PASSWORD');
    session = await login({ username, password, email });
    await saveSession(sessionFile, session);
    return session;
  }

  async function requestPage(cursor) {
    const op = await getOperation();
    const url = buildHomeTimelineUrl(op, { cursor });
    const headers = {
      authorization: `Bearer ${WEB_BEARER}`,
      cookie: `auth_token=${session.auth_token}; ct0=${session.ct0}`,
      'x-csrf-token': session.ct0,
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'es',
      'content-type': 'application/json',
      'user-agent': UA,
      referer: 'https://x.com/home',
    };
    const tid = await transactionId('GET', new URL(url).pathname).catch(() => null);
    if (tid) headers['x-client-transaction-id'] = tid;
    return fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  }

  async function fetchPage(cursor) {
    await ensureSession();
    let res = await requestPage(cursor);
    if (res.status === 401 || res.status === 403) {
      // Sesión vencida: se borra y se inicia sesión de nuevo una sola vez.
      logger.warn?.(`X respondió ${res.status}; renovando la sesión`);
      await deleteSession(sessionFile);
      await ensureSession({ fresh: true });
      res = await requestPage(cursor);
    }
    if (!res.ok) throw new Error(`X respondió ${res.status}`);
    return parseTimeline(await res.json());
  }

  return {
    // Configurado si hay usuario y contraseña, o una sesión guardada de antes.
    async isConfigured() {
      return Boolean((username && password) || (await loadSession(sessionFile)));
    },

    // Hasta `count` tweets nuevos del feed (sin publicidad ni repetidos).
    async getNewTweets(count) {
      const store = await seen();
      const result = [];
      const pending = new Set();
      let cursor = null;
      for (let page = 0; page < MAX_PAGES && result.length < count; page++) {
        const { tweets, cursor: next } = await fetchPage(cursor);
        for (const tweet of tweets) {
          if (tweet.promoted || tweet.ids.some((id) => store.has(id) || pending.has(id))) continue;
          tweet.ids.forEach((id) => pending.add(id));
          result.push(tweet);
          if (result.length === count) break;
        }
        if (!next || next === cursor) break;
        cursor = next;
      }
      return result;
    },

    // Se llama después de enviar cada tweet, así un fallo no lo marca como enviado.
    async markSent(tweet) {
      await (await seen()).add(tweet.ids);
    },

    async downloadPhoto(url) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.hostname !== PHOTO_HOST) throw new Error(`Host no permitido: ${parsed.hostname}`);
      parsed.searchParams.set('name', 'medium');
      const res = await fetchImpl(parsed.href, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`foto respondió ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

// Encabezado x-client-transaction-id que X pide cada vez más. Si no se puede generar
// (X cambia su web seguido), se envía el pedido sin él.
export function createTransactionIdGenerator({ fetchImpl = fetch } = {}) {
  let transactionPromise = null;
  return async function transactionId(method, path) {
    transactionPromise ??= (async () => {
      const [{ ClientTransaction }, { DOMParser }] = await Promise.all([
        import('x-client-transaction-id'),
        import('linkedom'),
      ]);
      const html = await (await fetchImpl('https://x.com', { headers: { 'user-agent': UA } })).text();
      return ClientTransaction.create(new DOMParser().parseFromString(html, 'text/html'));
    })().catch((err) => {
      transactionPromise = null;
      throw err;
    });
    return (await transactionPromise).generateTransactionId(method, path);
  };
}
