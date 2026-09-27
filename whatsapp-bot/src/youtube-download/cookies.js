// Cookies de YouTube a partir de un registro de chrome://net-export (con "Include cookies and credentials").
// Solo se extraen las cookies enviadas a youtube.com; el resto del registro se descarta.
import { chmod, readFile, writeFile } from 'node:fs/promises';

export const MAX_NETLOG_BYTES = 150 * 1024 * 1024;
const YOUTUBE_HOST = /(^|\.)youtube\.com$/i;
// Sin estas cookies no hay sesión iniciada.
const SESSION_COOKIES = [
  ['SAPISID', '__Secure-3PAPISID'],
  ['SID', '__Secure-1PSID', '__Secure-3PSID'],
];

export class CookiesError extends Error {
  name = 'CookiesError';
}

// Normaliza los encabezados de un evento: lista "nombre: valor" u objeto { nombre: valor }.
function headerPairs(headers) {
  if (Array.isArray(headers)) {
    return headers
      .filter((h) => typeof h === 'string')
      .map((h) => {
        const i = h.indexOf(':', h.startsWith(':') ? 1 : 0);
        return i > 0 ? [h.slice(0, i).trim().toLowerCase(), h.slice(i + 1).trim()] : null;
      })
      .filter(Boolean);
  }
  if (headers && typeof headers === 'object') {
    return Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]);
  }
  return [];
}

// Todos los "headers" del registro. Si el JSON está cortado (Chrome no terminó de escribirlo),
// busca las listas de encabezados una por una.
function allHeaderLists(text) {
  try {
    const data = JSON.parse(text);
    return (data.events ?? []).map((e) => e?.params?.headers).filter(Boolean);
  } catch {
    const lists = [];
    for (const m of text.matchAll(/"headers":(\[(?:"(?:[^"\\]|\\.)*",?)*\]|\{[^{}]*\})/g)) {
      try {
        lists.push(JSON.parse(m[1]));
      } catch {
        // lista dañada: se ignora
      }
    }
    return lists;
  }
}

// Map nombre → valor con las cookies enviadas a youtube.com (la última vista gana).
export function extractYoutubeCookies(netlogText) {
  const cookies = new Map();
  let stripped = false;
  for (const headers of allHeaderLists(netlogText)) {
    const pairs = headerPairs(headers);
    const host = pairs.find(([k]) => k === ':authority' || k === 'host')?.[1]?.replace(/:\d+$/, '');
    if (!host || !YOUTUBE_HOST.test(host)) continue;
    for (const [k, v] of pairs) {
      if (k !== 'cookie') continue;
      if (/value was stripped|\[\d+ bytes were stripped\]/i.test(v)) {
        stripped = true;
        continue;
      }
      for (const part of v.split(';')) {
        const i = part.indexOf('=');
        if (i <= 0) continue;
        const name = part.slice(0, i).trim();
        const value = part.slice(i + 1).trim();
        if (/^[\w.-]+$/.test(name) && value && !/[\s\t\n]/.test(value)) cookies.set(name, value);
      }
    }
  }
  if (cookies.size === 0 && stripped) {
    throw new CookiesError('El registro no incluye las cookies: en chrome://net-export marca "Include cookies and credentials".');
  }
  if (!SESSION_COOKIES.every((group) => group.some((name) => cookies.has(name)))) {
    throw new CookiesError('No encontré una sesión de YouTube en el registro: inicia sesión en m.youtube.com y abre un video mientras graba.');
  }
  return cookies;
}

// Formato cookies.txt (Netscape) que entiende yt-dlp.
export function toNetscape(cookies, { now = Date.now() } = {}) {
  const expires = Math.floor(now / 1000) + 365 * 24 * 60 * 60;
  const lines = ['# Netscape HTTP Cookie File', '# Generado por el bot desde chrome://net-export', ''];
  for (const [name, value] of cookies) {
    // Las cookies "__Host-" solo valen para el dominio exacto.
    const [domain, sub] = name.startsWith('__Host-') ? ['www.youtube.com', 'FALSE'] : ['.youtube.com', 'TRUE'];
    lines.push([domain, sub, '/', 'TRUE', expires, name, value].join('\t'));
  }
  return `${lines.join('\n')}\n`;
}

export async function saveCookiesFile(file, text) {
  await writeFile(file, text, { mode: 0o600 });
  await chmod(file, 0o600);
}

export async function hasCookiesFile(file) {
  try {
    return (await readFile(file, 'utf8')).includes('youtube.com');
  } catch {
    return false;
  }
}
