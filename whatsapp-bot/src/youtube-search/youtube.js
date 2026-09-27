// Búsqueda en YouTube sin API key: lee los resultados que YouTube incluye en su página de búsqueda.
// Si YouTube cambia su HTML, solo hay que tocar este archivo.

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT_MS = 15000;

function* findVideoRenderers(node) {
  if (Array.isArray(node)) {
    for (const item of node) yield* findVideoRenderers(item);
  } else if (node && typeof node === 'object') {
    if (node.videoRenderer) yield node.videoRenderer;
    for (const value of Object.values(node)) yield* findVideoRenderers(value);
  }
}

// Extrae los videos de la página de resultados: [{ id, title, channel, duration, url }].
export function parseSearchResults(html) {
  const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!match) throw new Error('No se encontraron resultados en la página de YouTube');
  const data = JSON.parse(match[1]);
  return [...findVideoRenderers(data)]
    .filter((v) => /^[\w-]{11}$/.test(v.videoId ?? ''))
    .map((v) => ({
      id: v.videoId,
      title: v.title?.runs?.map((r) => r.text).join('') ?? '',
      channel: v.ownerText?.runs?.[0]?.text ?? '',
      duration: v.lengthText?.simpleText ?? '',
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
    }));
}

export async function searchYouTube(query) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'es' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`YouTube respondió ${res.status}`);
  return parseSearchResults(await res.text());
}

// Miniatura del video para la vista previa del link. null si no se puede bajar.
export async function getThumbnail(videoId) {
  try {
    const res = await fetch(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// Primer resultado con su miniatura, o null si no hay resultados.
export async function findFirstVideo(query) {
  const [video] = await searchYouTube(query);
  if (!video) return null;
  return { ...video, thumbnail: await getThumbnail(video.id) };
}
