import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createYoutubeCommand } from './youtube.command.js';
import { parseArgs } from './parse-args.js';
import { countParts, parseDuration } from '../../youtube-download/ytdlp.js';

function ctx(args) {
  const replies = [];
  return {
    replies,
    args,
    prefix: '!',
    logger: { info() {}, warn() {}, error() {} },
    reply: {
      text: async (text) => replies.push({ text }),
      link: async (link) => replies.push({ link }),
      video: async (file, caption) => replies.push({ video: file, caption }),
    },
  };
}

const VIDEO = { id: 'abcdefghijk', title: 'Gatos', channel: 'Canal', duration: '3:15', url: 'https://www.youtube.com/watch?v=abcdefghijk', thumbnail: null };
const LINK = { link: { url: VIDEO.url, title: 'Gatos', description: 'Canal · 3:15', thumbnail: null } };

// Descargador falso: devuelve tantas partes como se pidieron.
function downloader({ configured = true, fail = false } = {}) {
  const calls = { downloads: [], cleaned: 0 };
  return {
    calls,
    isConfigured: async () => configured,
    parseDuration,
    countParts,
    partMinutes: 5,
    maxParts: 6,
    download: async (url, opts) => {
      calls.downloads.push({ url, ...opts });
      if (fail) throw new Error('yt-dlp falló');
      return { files: Array.from({ length: opts.parts }, (_, i) => `/tmp/parte-${i}.mp4`), cleanup: async () => calls.cleaned++ };
    },
  };
}

function command({ video = VIDEO, dl = downloader(), find } = {}) {
  return createYoutubeCommand({ findFirstVideo: find ?? (async () => video), downloader: dl });
}

describe('parseArgs', () => {
  test('número de partes al principio, por defecto 1', () => {
    assert.deepEqual(parseArgs('naruto'), { parts: 1, query: 'naruto' });
    assert.deepEqual(parseArgs('3 naruto ending'), { parts: 3, query: 'naruto ending' });
    assert.deepEqual(parseArgs('0 naruto'), { parts: 1, query: 'naruto' });
    assert.deepEqual(parseArgs('1984 orwell'), { parts: 1, query: '1984 orwell' });
  });
});

describe('countParts', () => {
  test('partes de 5 minutos, según lo pedido y como máximo 6', () => {
    assert.equal(countParts(195, 1), 1); // 3:15
    assert.equal(countParts(195, 4), 1); // más corto que lo pedido
    assert.equal(countParts(301, 2), 2); // 5:01 → 2 partes
    assert.equal(countParts(12 * 60, 5), 3); // 12 min → 3 partes
    assert.equal(countParts(60 * 60, 3), 3);
    assert.equal(countParts(60 * 60, 10), 6); // máximo 30 minutos
  });
});

describe('!youtube sin sesión de YouTube', () => {
  test('envía el link con título, canal y duración', async () => {
    const c = ctx('gatos');
    const dl = downloader({ configured: false });
    await command({ dl }).run(c);
    assert.deepEqual(c.replies, [LINK]);
    assert.deepEqual(dl.calls.downloads, []);
  });
});

describe('!youtube con sesión de YouTube', () => {
  test('video corto: 1 video con título y link', async () => {
    const c = ctx('gatos');
    const dl = downloader();
    await command({ dl }).run(c);
    assert.deepEqual(c.replies, [
      { text: 'Descargando "Gatos" (3:15)...' },
      { video: '/tmp/parte-0.mp4', caption: `Gatos\n${VIDEO.url}` },
    ]);
    assert.deepEqual(dl.calls.downloads, [{ url: VIDEO.url, durationSeconds: 195, parts: 1 }]);
    assert.equal(dl.calls.cleaned, 1);
  });

  test('!youtube 3 → 3 partes numeradas de 5 minutos', async () => {
    const c = ctx('3 gatos');
    const dl = downloader();
    await command({ video: { ...VIDEO, duration: '40:00' }, dl }).run(c);
    assert.deepEqual(c.replies, [
      { text: 'Descargando "Gatos" (40:00) en 3 partes de 5 min...' },
      { video: '/tmp/parte-0.mp4', caption: `Gatos (parte 1/3)\n${VIDEO.url}` },
      { video: '/tmp/parte-1.mp4', caption: 'Gatos (parte 2/3)' },
      { video: '/tmp/parte-2.mp4', caption: 'Gatos (parte 3/3)' },
    ]);
    assert.equal(dl.calls.downloads[0].parts, 3);
  });

  test('más de 30 minutos: como máximo 6 partes y avisa', async () => {
    const c = ctx('10 gatos');
    await command({ video: { ...VIDEO, duration: '1:02:28' } }).run(c);
    assert.equal(c.replies.filter((r) => r.video).length, 6);
    assert.equal(c.replies.at(-1).text, 'Solo se envían los primeros 30 minutos (6 partes).');
  });

  test('si se piden más partes de las que tiene el video, avisa', async () => {
    const c = ctx('4 gatos');
    await command({ video: { ...VIDEO, duration: '7:30' } }).run(c);
    assert.equal(c.replies.filter((r) => r.video).length, 2);
    assert.equal(c.replies.at(-1).text, 'El video solo tiene 2 partes.');
  });

  test('en vivo (sin duración): link sin intentar descargar', async () => {
    const c = ctx('gatos');
    const dl = downloader();
    await command({ video: { ...VIDEO, duration: '' }, dl }).run(c);
    assert.deepEqual(dl.calls.downloads, []);
    assert.match(c.replies[1].text, /en vivo/);
  });

  test('si la descarga falla, envía el link', async () => {
    const c = ctx('gatos');
    await command({ dl: downloader({ fail: true }) }).run(c);
    assert.deepEqual(c.replies.slice(1), [
      { link: { url: VIDEO.url, title: 'Gatos', description: 'Canal · 3:15', thumbnail: null } },
      { text: 'No pude descargar el video, te dejo el link.' },
    ]);
  });

  test('limpia aunque falle el envío', async () => {
    const c = ctx('gatos');
    c.reply.video = async () => {
      throw new Error('WhatsApp rechazó el video');
    };
    const dl = downloader();
    await assert.rejects(command({ dl }).run(c), /rechazó/);
    assert.equal(dl.calls.cleaned, 1);
  });
});

test('sin búsqueda muestra el uso', async () => {
  const c = ctx('');
  await command().run(c);
  assert.deepEqual(c.replies, [{ text: 'Uso: !youtube [1-6] <búsqueda>' }]);
});

test('si la búsqueda falla, avisa sin romperse', async () => {
  const c = ctx('gatos');
  await command({
    find: async () => {
      throw new Error('YouTube caído');
    },
  }).run(c);
  assert.deepEqual(c.replies, [{ text: 'No encontré videos de YouTube para "gatos"' }]);
});
