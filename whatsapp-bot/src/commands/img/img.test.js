import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from './parse-args.js';
import { createImgCommand } from './img.command.js';

describe('parseArgs', () => {
  test('sin número pide 1 imagen', () => {
    assert.deepEqual(parseArgs('perro salchicha'), { count: 1, query: 'perro salchicha' });
  });
  test('número al principio es la cantidad', () => {
    assert.deepEqual(parseArgs('3 gato'), { count: 3, query: 'gato' });
  });
  test('la cantidad se limita a 5', () => {
    assert.deepEqual(parseArgs('10 gato'), { count: 5, query: 'gato' });
    assert.deepEqual(parseArgs('99 gato'), { count: 5, query: 'gato' });
  });
  test('0 se convierte en 1', () => {
    assert.deepEqual(parseArgs('0 gato'), { count: 1, query: 'gato' });
  });
  test('números de 3+ cifras son parte de la búsqueda', () => {
    assert.deepEqual(parseArgs('1984 orwell'), { count: 1, query: '1984 orwell' });
  });
  test('un número solo es la búsqueda', () => {
    assert.deepEqual(parseArgs('3'), { count: 1, query: '3' });
  });
  test('vacío', () => {
    assert.deepEqual(parseArgs(''), { count: 1, query: '' });
  });
});

describe('!img', () => {
  function ctx(args) {
    const replies = [];
    return {
      replies,
      args,
      prefix: '!',
      logger: { info() {}, warn() {}, error() {} },
      reply: {
        text: async (text) => replies.push({ text }),
        image: async (buffer, caption) => replies.push({ image: buffer, caption }),
      },
    };
  }

  test('envía las imágenes con la búsqueda como caption', async () => {
    const getImages = async (q, n) => Array.from({ length: n }, () => ({ buffer: Buffer.from('x'), url: 'u' }));
    const c = ctx('2 gato');
    await createImgCommand({ getImages }).run(c);
    assert.equal(c.replies.length, 2);
    assert.ok(c.replies.every((r) => r.caption === 'gato'));
  });

  test('sin búsqueda muestra el uso', async () => {
    const c = ctx('');
    await createImgCommand({ getImages: async () => [] }).run(c);
    assert.deepEqual(c.replies, [{ text: 'Uso: !img [1-5] <búsqueda>' }]);
  });
});
