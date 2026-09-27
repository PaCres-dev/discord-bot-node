// Noticias de Google News (RSS, sin API key), edición en inglés (EE.UU.), de la última semana.
// Todo lo específico de Google News vive en este archivo, para arreglarlo en un solo lugar.
import { join } from 'node:path';
import { createSeenStore } from '../shared/seen-store.js';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT_MS = 15000;
const EDITION = { hl: 'en-US', gl: 'US', ceid: 'US:en' };
const MAX_SUMMARY = 350;
const MAX_ARTICLE_BYTES = 2 * 1024 * 1024;

// Secciones: nombre de Google News y términos que acotan una búsqueda a ese tema
// (Google busca la palabra, no el tema: "programming" solo trae TV y ciencia).
export const SECTIONS = {
  tech: { topic: 'TECHNOLOGY', terms: 'software OR developer OR code OR programming OR app OR AI OR tech' },
  ciencia: { topic: 'SCIENCE', terms: 'science OR research OR study OR scientists' },
  negocios: { topic: 'BUSINESS', terms: 'business OR market OR company OR economy' },
  deportes: { topic: 'SPORTS', terms: 'sports OR game OR match OR team OR league' },
  mundo: { topic: 'WORLD', terms: 'world OR international OR government' },
  salud: { topic: 'HEALTH', terms: 'health OR medical OR disease OR study' },
  entretenimiento: { topic: 'ENTERTAINMENT', terms: 'movie OR music OR series OR celebrity OR show' },
};
// Otros nombres aceptados para cada sección.
export const SECTION_ALIASES = {
  tecnologia: 'tech', tecnología: 'tech', technology: 'tech',
  science: 'ciencia',
  business: 'negocios', economia: 'negocios', economía: 'negocios',
  sports: 'deportes',
  world: 'mundo', internacional: 'mundo',
  health: 'salud',
  entertainment: 'entretenimiento', espectaculos: 'entretenimiento', espectáculos: 'entretenimiento',
};

export function resolveSection(word) {
  const w = String(word ?? '').toLowerCase();
  if (SECTIONS[w]) return w;
  return SECTION_ALIASES[w] ?? null;
}

// URL del RSS: búsqueda (acotada a la sección si hay) de la última semana, o titulares de la sección.
export function buildFeedUrl({ query, section }) {
  const params = new URLSearchParams(EDITION);
  if (!query) {
    return `https://news.google.com/rss/headlines/section/topic/${SECTIONS[section].topic}?${params}`;
  }
  const terms = section ? ` (${SECTIONS[section].terms})` : '';
  params.set('q', `${query}${terms} when:7d`);
  return `https://news.google.com/rss/search?${params}`;
}

export function decodeEntities(text) {
  return String(text ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(m[1]).trim() : '';
}

// Lee el RSS: [{ id, title, source, date, link }] en el orden de Google (más relevante primero).
export function parseFeed(xml) {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map(([, item]) => {
      const link = tag(item, 'link');
      const source = tag(item, 'source');
      let title = tag(item, 'title');
      // Google agrega " - Medio" al final del título.
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
      const id = link.match(/\/articles\/([\w-]+)/)?.[1] ?? link;
      const date = new Date(tag(item, 'pubDate'));
      return { id, title, source, date: Number.isNaN(date.getTime()) ? null : date, link };
    })
    .filter((n) => n.title && n.link.startsWith('https://news.google.com/'));
}

// --- Link real de la nota ---
// Los links de Google News son redirecciones cifradas. Se decodifican con el mismo servicio que usa
// la web de Google News (no es oficial: si falla, se usa el link de Google).
export async function decodeGoogleNewsLink(link, fetchImpl = fetch) {
  const id = link.match(/\/articles\/([\w-]+)/)?.[1];
  if (!id) return null;
  const page = await (await fetchImpl(`https://news.google.com/rss/articles/${id}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })).text();
  const signature = page.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const timestamp = page.match(/data-n-a-ts="(\d+)"/)?.[1];
  if (!signature || !timestamp) return null;
  const payload = [
    'Fbv4je',
    JSON.stringify([
      'garturlreq',
      [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
      id,
      Number(timestamp),
      signature,
    ]),
  ];
  const res = await fetchImpl('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA },
    body: `f.req=${encodeURIComponent(JSON.stringify([[payload]]))}`,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  const url = text.match(/garturlres\\",\\"(https?:[^"\\]+)/)?.[1];
  return url && isPublicHttpsUrl(url) ? url : null;
}

// Solo notas públicas por HTTPS: nada de IPs, localhost ni redes internas.
export function isPublicHttpsUrl(url) {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:') return false;
    if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) return false;
    if (/^[\d.]+$/.test(hostname) || hostname.includes(':') || hostname.startsWith('[')) return false;
    return hostname.includes('.');
  } catch {
    return false;
  }
}

// --- Resumen ---
// La descripción que publica la propia nota (og:description / twitter:description / description).
export function extractSummary(html, title = '') {
  const metas = [...String(html).matchAll(/<meta\s[^>]*>/gi)].map(([m]) => m);
  const find = (key) => {
    for (const m of metas) {
      const name = m.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (name !== key) continue;
      const content = m.match(/content\s*=\s*"([^"]*)"/i)?.[1] ?? m.match(/content\s*=\s*'([^']*)'/i)?.[1];
      if (content?.trim()) return content;
    }
    return null;
  };
  const raw = find('og:description') ?? find('twitter:description') ?? find('description');
  if (!raw) return null;
  let summary = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  if (!summary || summary.toLowerCase() === title.toLowerCase()) return null;
  if (summary.length > MAX_SUMMARY) summary = `${summary.slice(0, MAX_SUMMARY).replace(/\s+\S*$/, '')}…`;
  return summary;
}

async function readLimited(res, maxBytes) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchSummary(url, title, fetchImpl = fetch) {
  if (!isPublicHttpsUrl(url)) return null;
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null;
  return extractSummary(await readLimited(res, MAX_ARTICLE_BYTES), title);
}

// --- Servicio ---
export function createNewsFeed({ authDir, fetchImpl = fetch, logger = console }) {
  let store = null;
  const seen = async () => (store ??= await createSeenStore(join(authDir, 'news-seen.json'), { max: 2000 }));

  return {
    // Hasta `count` noticias nuevas (no enviadas antes), con link real y resumen si se pueden obtener.
    async getNews({ query, section, count }) {
      const res = await fetchImpl(buildFeedUrl({ query, section }), {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Google News respondió ${res.status}`);
      const store = await seen();
      const fresh = parseFeed(await res.text()).filter((n) => !store.has(n.id)).slice(0, count);
      for (const news of fresh) {
        news.url = news.link;
        news.summary = null;
        try {
          news.url = (await decodeGoogleNewsLink(news.link, fetchImpl)) ?? news.link;
          if (news.url !== news.link) news.summary = await fetchSummary(news.url, news.title, fetchImpl);
        } catch (err) {
          logger.warn?.(`Sin resumen para "${news.title}": ${err.message}`);
        }
      }
      return fresh;
    },

    // Se llama después de enviar cada noticia, así un fallo no la marca como enviada.
    async markSent(news) {
      await (await seen()).add([news.id]);
    },
  };
}
