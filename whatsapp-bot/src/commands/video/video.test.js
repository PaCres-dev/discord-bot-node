import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createVideoCommand } from './video.command.js';
import { formatDuration } from './format-duration.js';

describe('formatDuration', () => {
  test('minutos y horas', () => {
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(195), '3:15');
    assert.equal(formatDuration(3747), '1:02:27');
    assert.equal(formatDuration(undefined), '0:00');
  });
});

describe('!video', () => {
  function ctx(args) {
    const replies = [];
    return {
      replies,
      args,
      prefix: '!',
      logger: { info() {}, warn() {}, error() {} },
      reply: {
        text: async (text) => replies.push({ text }),
        video: async (file, caption) => replies.push({ video: file, caption }),
      },
    };
  }
  const CLIP = { id: 'x1', title: 'Gatos', duration: 195 };

  function command({ search = async () => [CLIP], download } = {}) {
    const cleaned = [];
    const cmd = createVideoCommand({
      searchVideos: search,
      downloadVideo: download ?? (async () => ({ file: '/tmp/x1.mp4', cleanup: async () => cleaned.push('x1') })),
      maxMinutes: 20,
    });
    return { cmd, cleaned };
  }

  test('avisa que descarga, envía el video y limpia', async () => {
    const c = ctx('gatos');
    const { cmd, cleaned } = command();
    await cmd.run(c);
    assert.deepEqual(c.replies, [
      { text: 'Descargando "Gatos (3:15)"...' },
      { video: '/tmp/x1.mp4', caption: 'Gatos (3:15)' },
    ]);
    assert.deepEqual(cleaned, ['x1']);
  });

  test('limpia aunque falle el envío', async () => {
    const c = ctx('gatos');
    c.reply.video = async () => {
      throw new Error('WhatsApp rechazó el video');
    };
    const { cmd, cleaned } = command();
    await assert.rejects(cmd.run(c), /rechazó/);
    assert.deepEqual(cleaned, ['x1']);
  });

  test('si la descarga falla, avisa', async () => {
    const c = ctx('gatos');
    const { cmd } = command({
      download: async () => {
        throw new Error('403');
      },
    });
    await cmd.run(c);
    assert.deepEqual(c.replies.at(-1), { text: 'No pude descargar "Gatos"' });
  });

  test('sin resultados o si la búsqueda falla, avisa', async () => {
    for (const search of [async () => [], async () => { throw new Error('caído'); }]) {
      const c = ctx('nada');
      await command({ search }).cmd.run(c);
      assert.deepEqual(c.replies, [{ text: 'No encontré videos para "nada"' }]);
    }
  });

  test('sin búsqueda muestra el uso', async () => {
    const c = ctx('');
    await command().cmd.run(c);
    assert.deepEqual(c.replies, [{ text: 'Uso: !video <búsqueda>' }]);
  });
});
