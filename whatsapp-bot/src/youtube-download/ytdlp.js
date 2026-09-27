// Descarga de videos de YouTube con yt-dlp, usando la sesión guardada con !ytcookies.
// yt-dlp se ejecuta con una lista de argumentos (nunca a través de una shell).
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MAX_MINUTES = 20;
export const MAX_BYTES = 90 * 1024 * 1024; // WhatsApp acepta videos de hasta ~100 MB
// H.264 (el que WhatsApp reproduce en todos lados) hasta 720p y ~80 MB; si no, 480p; si no, el formato 18 (360p).
export const FORMAT = [
  'bv*[height<=720][vcodec^=avc1][filesize_approx<=80M]+ba[ext=m4a]',
  'bv*[height<=480][vcodec^=avc1]+ba[ext=m4a]',
  'b[height<=720][vcodec^=avc1]',
  '18',
].join('/');
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
      code === 0 ? resolve() : reject(new YoutubeDownloadError(`yt-dlp falló: ${stderr.trim().split('\n').pop()}`));
    });
  });
}

export function buildArgs({ url, cookiesFile, ffmpegPath, output }) {
  return [
    '--cookies', cookiesFile,
    '--js-runtimes', 'node',
    '--ffmpeg-location', ffmpegPath,
    '--no-playlist',
    '--no-progress',
    '--match-filter', `duration<=${MAX_MINUTES * 60}`,
    '-f', FORMAT,
    '--merge-output-format', 'mp4',
    '-o', output,
    '--', assertYoutubeUrl(url),
  ];
}

// Descarga el video como MP4 en una carpeta temporal. Devuelve { file, cleanup }.
export async function downloadYoutube(url, { cookiesFile, ytdlpPath = 'yt-dlp', ffmpegPath = 'ffmpeg', runProcess = defaultRunProcess }) {
  const dir = await mkdtemp(join(tmpdir(), 'wa-youtube-'));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    const file = join(dir, 'video.mp4');
    await runProcess(ytdlpPath, buildArgs({ url, cookiesFile, ffmpegPath, output: join(dir, 'video.%(ext)s') }));
    const info = await stat(file).catch(() => null);
    // yt-dlp termina bien pero sin archivo cuando el video supera la duración máxima.
    if (!info) throw new YoutubeDownloadError(`El video dura más de ${MAX_MINUTES} minutos o no se pudo descargar`);
    if (info.size > MAX_BYTES) throw new YoutubeDownloadError('El video pesa demasiado para WhatsApp');
    return { file, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
