// Descarga de videos de YouTube con yt-dlp, usando la sesión guardada con !ytcookies.
// yt-dlp se ejecuta con una lista de argumentos (nunca a través de una shell).
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

// Videos largos se envían en partes de 5 minutos, como máximo 6 (los primeros 30 minutos).
export const PART_SECONDS = 5 * 60;
export const MAX_PARTS = 6;
export const MAX_BYTES = 90 * 1024 * 1024; // WhatsApp acepta videos de hasta ~100 MB por mensaje
// Hasta esta duración conviene bajar el video entero y recortarlo aquí (mucho más rápido:
// 1 h tarda ~1 min). Más largos: se baja solo el tramo pedido, para no ocupar tanto disco.
export const FULL_DOWNLOAD_MAX_SECONDS = 90 * 60;
// Partes más cortas que esto (restos de un corte) se descartan.
const MIN_PART_BYTES = 50 * 1024;
// H.264 (el que WhatsApp reproduce en todos lados) hasta 720p y ~1,8 Mbps (5 min ≈ 70 MB);
// si no, 480p; si no, el formato 18 (360p).
export const FORMAT = [
  'bv*[height<=720][vcodec^=avc1][tbr<=?1800]+ba[ext=m4a]',
  'bv*[height<=480][vcodec^=avc1]+ba[ext=m4a]',
  'b[height<=720][vcodec^=avc1]',
  '18',
].join('/');
// Solo audio (!audio): m4a/AAC, que WhatsApp reproduce directo (~1 MB por minuto).
// Mismas partes que el video: 5 minutos, como máximo 6.
export const AUDIO_FORMAT = 'ba[ext=m4a]/ba';

export const MODES = Object.freeze({
  video: { ext: 'mp4', format: FORMAT, partSeconds: PART_SECONDS, maxParts: MAX_PARTS, outputArgs: ['--merge-output-format', 'mp4'] },
  audio: { ext: 'm4a', format: AUDIO_FORMAT, partSeconds: PART_SECONDS, maxParts: MAX_PARTS, outputArgs: ['-x', '--audio-format', 'm4a'] },
});
const TIMEOUT_MS = 10 * 60 * 1000;

export class YoutubeDownloadError extends Error {
  name = 'YoutubeDownloadError';
}

// Acepta solo links normales de YouTube: https://www.youtube.com/watch?v=<11 caracteres>.
export function assertYoutubeUrl(url) {
  const parsed = new URL(url);
  const id = parsed.searchParams.get('v') ?? '';
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.youtube.com' || parsed.pathname !== '/watch' || !/^[\w-]{11}$/.test(id)) {
    throw new YoutubeDownloadError(`Link de YouTube no válido: ${url}`);
  }
  return `https://www.youtube.com/watch?v=${id}`;
}

// "6:10" → 370, "1:02:28" → 3748. 0 si no se puede leer.
export function parseDuration(text) {
  if (!/^\d+(:\d{1,2}){0,2}$/.test(text ?? '')) return 0;
  return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

function defaultRunProcess(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), TIMEOUT_MS);
    proc.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
    proc.on('error', (err) => (clearTimeout(timer), reject(err)));
    proc.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new YoutubeDownloadError(`${basename(command)} falló: ${stderr.trim().split('\n').pop()}`));
    });
  });
}

// seconds: cuántos segundos descargar desde el inicio (null = el video entero).
export function buildArgs({ url, cookiesFile, ffmpegPath, output, seconds = null, mode = MODES.video }) {
  return [
    '--cookies', cookiesFile,
    '--js-runtimes', 'node',
    // Solo si es una ruta: yt-dlp toma "--ffmpeg-location ffmpeg" como ruta inexistente y no une
    // audio y video. Sin la opción, busca ffmpeg en el PATH.
    ...(ffmpegPath.includes('/') ? ['--ffmpeg-location', ffmpegPath] : []),
    '--no-playlist',
    '--no-progress',
    '--match-filter', '!is_live',
    ...(seconds ? ['--download-sections', `*0-${seconds}`] : []),
    '-f', mode.format,
    ...mode.outputArgs,
    '-o', output,
    '--', assertYoutubeUrl(url),
  ];
}

// Cuántas partes de 5 minutos salen de un video, con el pedido y el máximo.
export function countParts(durationSeconds, requested, mode = MODES.video) {
  const available = Math.max(1, Math.ceil(durationSeconds / mode.partSeconds));
  return Math.min(available, Math.max(1, requested), mode.maxParts);
}

// Divide el archivo en partes de 5 minutos sin volver a codificar (en video, los cortes
// caen en el cuadro clave más cercano). Con `limitSeconds`, usa solo ese tramo inicial.
export function buildSplitArgs(input, outputPattern, limitSeconds = null, mode = MODES.video) {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    ...(limitSeconds ? ['-t', String(limitSeconds)] : []),
    '-map', '0', '-c', 'copy',
    '-f', 'segment', '-segment_time', String(mode.partSeconds), '-reset_timestamps', '1',
    outputPattern,
  ];
}

// Descarga los primeros `parts` × 5 minutos (video o solo audio) y lo devuelve en partes.
// Devuelve { files: [...], cleanup }.
export async function downloadYoutube(
  url,
  { cookiesFile, durationSeconds, parts = 1, mode = MODES.video, ytdlpPath = 'yt-dlp', ffmpegPath = 'ffmpeg', runProcess = defaultRunProcess },
) {
  const wanted = countParts(durationSeconds, parts, mode);
  const seconds = wanted * mode.partSeconds;
  const dir = await mkdtemp(join(tmpdir(), 'wa-youtube-'));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    const file = join(dir, `video.${mode.ext}`);
    const partial = durationSeconds > seconds;
    const onlySection = partial && durationSeconds > FULL_DOWNLOAD_MAX_SECONDS;
    await runProcess(
      ytdlpPath,
      buildArgs({ url, cookiesFile, ffmpegPath, output: join(dir, 'video.%(ext)s'), seconds: onlySection ? seconds : null, mode }),
    );
    const info = await stat(file).catch(() => null);
    if (!info) throw new YoutubeDownloadError('El video está en vivo o no se pudo descargar');

    let files = [file];
    if (partial || durationSeconds > mode.partSeconds) {
      await runProcess(ffmpegPath, buildSplitArgs(file, join(dir, `parte-%02d.${mode.ext}`), partial ? seconds : null, mode));
      const names = (await readdir(dir)).filter((n) => new RegExp(`^parte-\\d+\\.${mode.ext}$`).test(n)).sort();
      files = [];
      for (const name of names) {
        const path = join(dir, name);
        if ((await stat(path)).size >= MIN_PART_BYTES) files.push(path);
      }
      files = files.slice(0, wanted);
      if (files.length === 0) throw new YoutubeDownloadError('No se pudo dividir el archivo');
    }
    for (const f of files) {
      if ((await stat(f)).size > MAX_BYTES) throw new YoutubeDownloadError('Una parte pesa demasiado para WhatsApp');
    }
    return { files, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
