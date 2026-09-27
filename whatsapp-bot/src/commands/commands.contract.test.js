// Contrato que todo comando registrado debe cumplir. Un comando nuevo mal armado falla acá.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommands } from './index.js';

const commands = createCommands({
  imageSearch: { getRandomImages: async () => [] },
  youtubeSearch: { findFirstVideo: async () => null },
  youtubeDownloader: { isConfigured: async () => false, download: async () => null, parseDuration: () => 0, countParts: () => 1, partMinutes: 5, maxParts: 6 },
  videoSearch: { searchVideos: async () => [], downloadVideo: async () => null, MAX_MINUTES: 20 },
  xFeed: { isConfigured: async () => false, getNewTweets: async () => [], markSent: async () => {}, downloadPhoto: async () => null },
  youtubeCookies: { extractYoutubeCookies: () => new Map(), toNetscape: () => '', saveCookies: async () => {}, maxBytes: 1 },
});

test('hay al menos un comando registrado', () => {
  assert.ok(commands.length > 0);
});

for (const command of commands) {
  test(`!${command.name} cumple el contrato`, () => {
    assert.match(command.name, /^[a-z0-9]+$/, 'name: minúsculas y sin espacios');
    for (const alias of command.aliases ?? []) assert.match(alias, /^[a-z0-9]+$/, `alias "${alias}"`);
    assert.equal(typeof command.description, 'string');
    assert.ok(command.description.length > 0, 'falta description');
    assert.ok(command.usage?.startsWith(command.name), 'usage debe empezar con el nombre');
    assert.equal(typeof command.run, 'function');
    // La seguridad la decide el router para todos; ningún comando define su propio acceso.
    assert.equal(command.access, undefined, 'los comandos no definen access');
  });
}

test('nombres y alias no se repiten', () => {
  const names = commands.flatMap((c) => [c.name, ...(c.aliases ?? [])]);
  assert.equal(new Set(names).size, names.length);
});
