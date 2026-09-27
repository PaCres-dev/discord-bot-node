// Sesión de X: se inicia con usuario/contraseña una sola vez y se guarda solo la cookie de sesión
// (auth_token y ct0) en AUTH_DIR, fuera del repo. La contraseña nunca se escribe en disco.
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';

export async function loadSession(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return data?.auth_token && data?.ct0 ? { auth_token: data.auth_token, ct0: data.ct0 } : null;
  } catch {
    return null;
  }
}

export async function saveSession(file, session) {
  await writeFile(file, JSON.stringify({ auth_token: session.auth_token, ct0: session.ct0 }), { mode: 0o600 });
  await chmod(file, 0o600);
}

export async function deleteSession(file) {
  await rm(file, { force: true });
}

// Inicia sesión con la librería @the-convocation/twitter-scraper y devuelve { auth_token, ct0 }.
export async function loginWithPassword({ username, password, email }) {
  const { Scraper } = await import('@the-convocation/twitter-scraper');
  const scraper = new Scraper({ experimental: { xClientTransactionId: true, xpff: true } });
  await scraper.login(username, password, email || undefined);
  const cookies = await scraper.getCookies();
  const get = (key) => cookies.find((c) => c.key === key)?.value;
  const session = { auth_token: get('auth_token'), ct0: get('ct0') };
  if (!session.auth_token || !session.ct0) throw new Error('X no devolvió una sesión válida');
  return session;
}
