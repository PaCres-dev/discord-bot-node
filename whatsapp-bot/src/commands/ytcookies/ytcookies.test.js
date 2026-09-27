import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createYtcookiesCommand } from './ytcookies.command.js';
import { CookiesError } from '../../youtube-download/cookies.js';

function ctx(attachment) {
  const replies = [];
  return {
    replies,
    attachment,
    prefix: '!',
    logger: { info() {}, warn() {}, error() {} },
    reply: { text: async (text) => replies.push(text) },
  };
}

function command({ extract = () => new Map([['SID', 'x']]), saved = [] } = {}) {
  return createYtcookiesCommand({
    extractYoutubeCookies: extract,
    toNetscape: (c) => `netscape:${c.size}`,
    saveCookies: async (text) => saved.push(text),
    maxBytes: 100,
  });
}

const file = (content = 'log', size = 3) => ({ size, download: async () => Buffer.from(content) });

test('sin archivo, explica cómo mandarlo', async () => {
  const c = ctx(null);
  await command().run(c);
  assert.match(c.replies[0], /como documento con el texto !ytcookies/);
});

test('guarda las cookies y recuerda borrar el mensaje', async () => {
  const saved = [];
  const c = ctx(file());
  await command({ saved }).run(c);
  assert.deepEqual(saved, ['netscape:1']);
  assert.match(c.replies[0], /^Listo: guardé tu sesión de YouTube \(1 cookies\)\. Ahora borra el mensaje/);
});

test('archivo demasiado grande: no lo descarga', async () => {
  let downloaded = false;
  const c = ctx({ size: 101, download: async () => ((downloaded = true), Buffer.from('')) });
  await command().run(c);
  assert.equal(downloaded, false);
  assert.match(c.replies[0], /muy grande/);
});

test('errores de cookies se explican; otros errores no muestran detalles', async () => {
  const saved = [];
  let c = ctx(file());
  await command({ saved, extract: () => { throw new CookiesError('Falta marcar la opción'); } }).run(c);
  assert.deepEqual(c.replies, ['Falta marcar la opción']);
  c = ctx(file());
  await command({ saved, extract: () => { throw new Error('detalle interno'); } }).run(c);
  assert.deepEqual(c.replies, ['No pude leer el archivo.']);
  assert.deepEqual(saved, []);
});
