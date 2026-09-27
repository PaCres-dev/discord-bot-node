import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createYoutubeCommand } from './youtube.command.js';
import { parseDuration } from '../../youtube-download/ytdlp.js';

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

function downloader({ configured = true, fail = false } = {}) {
  const calls = { downloads: [], cleaned: 0 };
  return {
    calls,
    isConfigured: async () => configured,
    parseDuration,
    maxMinutes: 20,
    download: async (url) => {
      calls.downloads.push(url);
      if (fail) throw new Error('yt-dlp falló');
      return { file: '/tmp/video.mp4', cleanup: async () => calls.cleaned++ };
    },
  };
}

function command({ video = VIDEO, dl = downloader(), find } = {}) {
  return createYoutubeCommand({ findFirstVideo: find ?? (async () => video), downloader: dl });
}

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
  test('avisa, descarga, envía el video y limpia', async () => {
    const c = ctx('gatos');
    const dl = downloader();
    await command({ dl }).run(c);
    assert.deepEqual(c.replies, [
      { text: 'Descargando "Gatos" (3:15)...' },
      { video: '/tmp/video.mp4', caption: `Gatos\n${VIDEO.url}` },
    ]);
    assert.deepEqual(dl.calls.downloads, [VIDEO.url]);
    assert.equal(dl.calls.cleaned, 1);
  });

  test('si la descarga falla, envía el link', async () => {
    const c = ctx('gatos');
    await command({ dl: downloader({ fail: true }) }).run(c);
    assert.deepEqual(c.replies.slice(1), [LINK, { text: 'No pude descargar el video, te dejo el link.' }]);
  });

  test('videos largos o en vivo: link sin intentar descargar', async () => {
    for (const duration of ['1:02:28', '20:01', '']) {
      const c = ctx('gatos');
      const dl = downloader();
      await command({ video: { ...VIDEO, duration }, dl }).run(c);
      assert.deepEqual(dl.calls.downloads, []);
      assert.equal(c.replies.length, 2);
      assert.match(c.replies[1].text, /^Dura más de 20 minutos/);
    }
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
  assert.deepEqual(c.replies, [{ text: 'Uso: !youtube <búsqueda>' }]);
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
