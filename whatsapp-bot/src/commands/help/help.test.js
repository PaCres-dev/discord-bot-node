import { test } from 'node:test';
import assert from 'node:assert/strict';
import { helpCommand } from './help.command.js';

test('!help lista cada comando con su uso y descripción', async () => {
  const replies = [];
  await helpCommand.run({
    prefix: '!',
    commands: [
      { name: 'img', usage: 'img [1-5] <búsqueda>', description: 'Busca imágenes' },
      helpCommand,
    ],
    reply: { text: async (text) => replies.push(text) },
  });
  assert.deepEqual(replies, [
    'Comandos disponibles:\n!img [1-5] <búsqueda> — Busca imágenes\n!help — Muestra esta lista',
  ]);
});
