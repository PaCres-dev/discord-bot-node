import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createYoutubeCommand } from './youtube.command.js';

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
    },
  };
}

const VIDEO = { id: 'abcdefghijk', title: 'Gatos', channel: 'Canal', duration: '3:15', url: 'https://www.youtube.com/watch?v=abcdefghijk', thumbnail: null };

test('envía el link con título, canal y duración', async () => {
  const c = ctx('gatos');
  await createYoutubeCommand({ findFirstVideo: async () => VIDEO }).run(c);
  assert.deepEqual(c.replies, [
    { link: { url: VIDEO.url, title: 'Gatos', description: 'Canal · 3:15', thumbnail: null } },
  ]);
});

test('sin búsqueda muestra el uso', async () => {
  const c = ctx('');
  await createYoutubeCommand({ findFirstVideo: async () => VIDEO }).run(c);
  assert.deepEqual(c.replies, [{ text: 'Uso: !youtube <búsqueda>' }]);
});

test('si la búsqueda falla, avisa sin romperse', async () => {
  const c = ctx('gatos');
  await createYoutubeCommand({
    findFirstVideo: async () => {
      throw new Error('YouTube caído');
    },
  }).run(c);
  assert.deepEqual(c.replies, [{ text: 'No encontré videos de YouTube para "gatos"' }]);
});
