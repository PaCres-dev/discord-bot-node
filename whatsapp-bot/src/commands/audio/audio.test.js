import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createAudioCommand } from './audio.command.js';
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
      audio: async (file) => replies.push({ audio: file }),
    },
  };
}

const VIDEO = { id: 'abcdefghijk', title: 'Podcast', channel: 'Canal', duration: '45:10', url: 'https://www.youtube.com/watch?v=abcdefghijk', thumbnail: null };

function downloader({ configured = true, fail = false, files = 1 } = {}) {
  const calls = { downloads: [], cleaned: 0 };
  return {
    calls,
    isConfigured: async () => configured,
    parseDuration,
    audioPartMinutes: 60,
    audioMaxParts: 2,
    downloadAudio: async (url, opts) => {
      calls.downloads.push({ url, ...opts });
      if (fail) throw new Error('yt-dlp falló');
      return { files: Array.from({ length: files }, (_, i) => `/tmp/parte-${i}.m4a`), cleanup: async () => calls.cleaned++ };
    },
  };
}

const command = ({ video = VIDEO, dl = downloader() } = {}) => createAudioCommand({ findFirstVideo: async () => video, downloader: dl });

describe('!audio', () => {
  test('envía el título con el link y después el audio, y limpia', async () => {
    const c = ctx('podcast');
    const dl = downloader();
    await command({ dl }).run(c);
    assert.deepEqual(c.replies, [
      { text: `🎧 *Podcast* (45:10)\n${VIDEO.url}` },
      { audio: '/tmp/parte-0.m4a' },
    ]);
    assert.deepEqual(dl.calls.downloads, [{ url: VIDEO.url, durationSeconds: 2710 }]);
    assert.equal(dl.calls.cleaned, 1);
  });

  test('más de 1 hora: partes de 1 hora', async () => {
    const c = ctx('podcast');
    await command({ video: { ...VIDEO, duration: '1:30:00' }, dl: downloader({ files: 2 }) }).run(c);
    assert.equal(c.replies[0].text, `🎧 *Podcast* (1:30:00) — 2 partes de 1 h\n${VIDEO.url}`);
    assert.deepEqual(c.replies.slice(1), [{ audio: '/tmp/parte-0.m4a' }, { audio: '/tmp/parte-1.m4a' }]);
  });

  test('más de 2 horas: avisa que solo van las primeras 2', async () => {
    const c = ctx('podcast');
    await command({ video: { ...VIDEO, duration: '3:10:00' }, dl: downloader({ files: 2 }) }).run(c);
    assert.match(c.replies[0].text, /Solo se envían las primeras 2 horas\.$/);
  });

  test('sin sesión de YouTube: link y cómo activarlo', async () => {
    const c = ctx('podcast');
    const dl = downloader({ configured: false });
    await command({ dl }).run(c);
    assert.equal(c.replies.length, 2);
    assert.ok(c.replies[0].link);
    assert.match(c.replies[1].text, /!ytcookies/);
    assert.deepEqual(dl.calls.downloads, []);
  });

  test('en vivo o si falla la descarga: link con aviso', async () => {
    let c = ctx('podcast');
    await command({ video: { ...VIDEO, duration: '' } }).run(c);
    assert.match(c.replies[1].text, /en vivo/);
    c = ctx('podcast');
    await command({ dl: downloader({ fail: true }) }).run(c);
    assert.equal(c.replies[1].text, 'No pude descargar el audio, te dejo el link.');
  });

  test('limpia aunque falle el envío', async () => {
    const c = ctx('podcast');
    c.reply.audio = async () => {
      throw new Error('WhatsApp rechazó el audio');
    };
    const dl = downloader();
    await assert.rejects(command({ dl }).run(c), /rechazó/);
    assert.equal(dl.calls.cleaned, 1);
  });

  test('sin búsqueda muestra el uso', async () => {
    const c = ctx('');
    await command().run(c);
    assert.deepEqual(c.replies, [{ text: 'Uso: !audio <búsqueda>' }]);
  });
});
