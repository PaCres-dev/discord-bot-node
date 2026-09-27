// Búsqueda y descarga de videos de Dailymotion (sin API key).
// Descarga los fragmentos HLS con fetch y usa ffmpeg solo para unirlos en un MP4 (sin red).
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT_MS = 20000;
export const MAX_MINUTES = 20;
export const MAX_HEIGHT = 720;
export const MAX_BYTES = 90 * 1024 * 1024; // WhatsApp acepta videos de hasta ~100 MB
const PARALLEL_SEGMENTS = 6;
// Solo se descargan archivos de Dailymotion y su CDN.
const ALLOWED_HOSTS = /(^|\.)(dailymotion\.com|dmcdn\.net)$/;

function assertAllowed(url) {
  const { protocol, hostname } = new URL(url);
  if (protocol !== 'https:' || !ALLOWED_HOSTS.test(hostname)) {
    throw new Error(`Host no permitido: ${hostname}`);
  }
  return url;
}

async function get(url, as = 'text') {
  const res = await fetch(assertAllowed(url), {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${new URL(url).hostname} respondió ${res.status}`);
  if (as === 'json') return res.json();
  if (as === 'bytes') return Buffer.from(await res.arrayBuffer());
  return res.text();
}

// Busca videos de hasta MAX_MINUTES: [{ id, title, duration (segundos), channel }].
export async function searchVideos(query) {
  const params = new URLSearchParams({
    search: query,
    fields: 'id,title,duration,owner.screenname',
    sort: 'relevance',
    shorter_than: String(MAX_MINUTES),
    limit: '5',
  });
  const data = await get(`https://api.dailymotion.com/videos?${params}`, 'json');
  return (data.list ?? []).map((v) => ({
    id: v.id,
    title: v.title,
    duration: v.duration,
    channel: v['owner.screenname'],
  }));
}

// Lista de calidades del playlist maestro: [{ url, bandwidth, height }].
export function parseMasterPlaylist(text, baseUrl) {
  const lines = text.split('\n').map((l) => l.trim());
  const variants = [];
  lines.forEach((line, i) => {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) return;
    const uri = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
    if (!uri) return;
    const bandwidth = Number(line.match(/BANDWIDTH=(\d+)/)?.[1] ?? 0);
    const height = Number(line.match(/RESOLUTION=\d+x(\d+)/)?.[1] ?? 0);
    variants.push({ url: new URL(uri, baseUrl).href, bandwidth, height });
  });
  return variants;
}

// La mejor calidad de hasta MAX_HEIGHT cuyo tamaño estimado entre en MAX_BYTES; si ninguna, la más liviana.
export function pickVariant(variants, durationSeconds) {
  const sorted = [...variants].sort((a, b) => b.bandwidth - a.bandwidth);
  const fits = (v) => v.height <= MAX_HEIGHT && (v.bandwidth / 8) * durationSeconds <= MAX_BYTES;
  return sorted.find(fits) ?? sorted.at(-1) ?? null;
}

// URLs de los fragmentos del playlist de una calidad. Rechaza videos cifrados.
export function parseMediaPlaylist(text, baseUrl) {
  if (/#EXT-X-KEY:METHOD=(?!NONE)/.test(text)) throw new Error('Video cifrado, no se puede descargar');
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((uri) => new URL(uri, baseUrl).href);
}

function defaultRunFfmpeg(ffmpegPath, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg falló: ${stderr.slice(-300)}`))));
  });
}

async function downloadSegments(urls, file) {
  const out = createWriteStream(file);
  try {
    for (let i = 0; i < urls.length; i += PARALLEL_SEGMENTS) {
      const chunk = await Promise.all(urls.slice(i, i + PARALLEL_SEGMENTS).map((u) => get(u, 'bytes')));
      for (const bytes of chunk) {
        if (!out.write(bytes)) await new Promise((r) => out.once('drain', r));
      }
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
}

// Descarga el video como MP4 en una carpeta temporal.
// Devuelve { file, cleanup }: hay que llamar a cleanup() después de enviarlo.
export async function downloadVideo(video, { ffmpegPath = 'ffmpeg', runFfmpeg = defaultRunFfmpeg } = {}) {
  const meta = await get(`https://www.dailymotion.com/player/metadata/video/${encodeURIComponent(video.id)}`, 'json');
  if (meta.error) throw new Error(meta.error.title || 'Video no disponible');
  const masterUrl = meta.qualities?.auto?.[0]?.url;
  if (!masterUrl) throw new Error('Video sin formatos descargables');

  const variant = pickVariant(parseMasterPlaylist(await get(masterUrl), masterUrl), video.duration);
  if (!variant) throw new Error('Video sin calidades disponibles');
  const segments = parseMediaPlaylist(await get(variant.url), variant.url);
  if (segments.length === 0) throw new Error('Video vacío');

  const dir = await mkdtemp(join(tmpdir(), 'wa-video-'));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    const ts = join(dir, 'video.ts');
    const file = join(dir, 'video.mp4');
    await downloadSegments(segments, ts);
    await runFfmpeg(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', ts,
      '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart',
      file,
    ]);
    return { file, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
