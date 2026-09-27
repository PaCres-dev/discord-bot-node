// Búsqueda de imágenes en DuckDuckGo (sin API keys) y descarga vía su proxy de imágenes.
// Si DuckDuckGo cambia su endpoint interno, solo hay que tocar este archivo.

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TOP = 10;
const MAX_INTENTOS = 5;
const TIMEOUT_MS = 15000;

// Reintenta fallos de red transitorios (ej. "fetch failed").
async function withRetry(fn, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
}

async function getVqd(query) {
  const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`DuckDuckGo respondió ${res.status}`);
  const html = await res.text();
  const match = html.match(/vqd=["']?([\d-]+)["']?/);
  if (!match) throw new Error('No se encontró el token vqd');
  return match[1];
}

// Devuelve las URLs de las primeras imágenes encontradas (SafeSearch desactivado).
export function searchImages(query) {
  return withRetry(() => searchOnce(query));
}

async function searchOnce(query) {
  const vqd = await getVqd(query);
  const params = new URLSearchParams({
    l: 'wt-wt',
    o: 'json',
    q: query,
    vqd,
    f: ',,,,,',
    p: '-1',
  });
  const res = await fetch(`https://duckduckgo.com/i.js?${params}`, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      Referer: 'https://duckduckgo.com/',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`i.js respondió ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).map((r) => r.image).filter(Boolean).slice(0, TOP);
}

async function download(imageUrl) {
  const proxied = `https://external-content.duckduckgo.com/iu/?u=${encodeURIComponent(imageUrl)}&f=1`;
  const res = await fetch(proxied, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`descarga respondió ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  // WhatsApp muestra bien JPEG y PNG; otros formatos (webp, gif, svg) se descartan.
  if (!/^image\/(jpeg|png)/.test(type)) throw new Error(`formato no soportado (${type})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) throw new Error('imagen vacía');
  return buffer;
}

// Busca, elige una al azar del top 10 y la descarga. Reintenta con otra hasta 5 veces.
// Devuelve { buffer, url } o null si no hay resultados o todas las descargas fallan.
export async function getRandomImage(query, logger = console) {
  const candidates = await searchImages(query);
  for (let i = 0; i < MAX_INTENTOS && candidates.length > 0; i++) {
    const [url] = candidates.splice(Math.floor(Math.random() * candidates.length), 1);
    try {
      return { buffer: await download(url), url };
    } catch (err) {
      logger.warn?.(`Intento ${i + 1} falló (${url}): ${err.message}`);
    }
  }
  return null;
}
