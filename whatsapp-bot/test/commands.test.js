import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMessageHandler, getText, isSelfChat, parseArgs } from '../src/commands.js';

const ME = { id: '5491100000000:66@s.whatsapp.net', lid: '111111111111111:66@lid' };
const SELF_PN = '5491100000000@s.whatsapp.net';
const SELF_LID = '111111111111111@lid';
const OTHER = '5491199999999@s.whatsapp.net';
const GROUP = '120363000000000000@g.us';
const silent = { info() {}, warn() {}, error() {} };

// Socket falso: guarda lo que el bot intenta enviar.
function fakeSock() {
  const sent = [];
  let n = 0;
  return {
    user: ME,
    sent,
    async sendMessage(jid, content, opts) {
      sent.push({ jid, content, opts });
      return { key: { id: `BOT${n++}`, fromMe: true, remoteJid: jid } };
    },
  };
}

function msg(text, { jid = SELF_LID, fromMe = true, id = 'MSG1', ts = 2000 } = {}) {
  return { key: { remoteJid: jid, fromMe, id }, messageTimestamp: ts, message: { conversation: text } };
}

// Imágenes falsas: devuelve `count` (o `available`, si es menor) y registra las llamadas.
function fakeImages({ available = Infinity, fail = false } = {}) {
  const calls = [];
  const fn = async (query, count) => {
    calls.push({ query, count });
    if (fail) throw new Error('DuckDuckGo caído');
    return Array.from({ length: Math.min(count, available) }, (_, i) => ({
      buffer: Buffer.from(`img${i}`),
      url: `https://example.com/${i}.jpg`,
    }));
  };
  fn.calls = calls;
  return fn;
}

function setup(opts) {
  const getImages = fakeImages(opts);
  const handle = createMessageHandler({ getImages, logger: silent, startedAt: 1000 });
  return { getImages, handle, sock: fakeSock() };
}

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

describe('isSelfChat', () => {
  test('reconoce mi chat por número y por @lid', () => {
    assert.equal(isSelfChat(ME, SELF_PN), true);
    assert.equal(isSelfChat(ME, SELF_LID), true);
  });
  test('rechaza otros chats y grupos', () => {
    assert.equal(isSelfChat(ME, OTHER), false);
    assert.equal(isSelfChat(ME, GROUP), false);
    assert.equal(isSelfChat(undefined, SELF_PN), false);
  });
});

describe('getText', () => {
  test('lee texto simple, extendido y de mensajes temporales', () => {
    assert.equal(getText({ conversation: 'hola' }), 'hola');
    assert.equal(getText({ extendedTextMessage: { text: 'hola' } }), 'hola');
    assert.equal(getText({ ephemeralMessage: { message: { conversation: 'hola' } } }), 'hola');
    assert.equal(getText({ imageMessage: {} }), '');
  });
});

describe('handleMessage', () => {
  test('!img gato → 1 imagen con caption en el mismo chat', async () => {
    const { handle, sock, getImages } = setup();
    await handle(sock, msg('!img gato'));
    assert.deepEqual(getImages.calls, [{ query: 'gato', count: 1 }]);
    assert.equal(sock.sent.length, 1);
    assert.equal(sock.sent[0].jid, SELF_LID);
    assert.equal(sock.sent[0].content.caption, 'gato');
    assert.ok(Buffer.isBuffer(sock.sent[0].content.image));
  });

  test('funciona también con el self-chat como @s.whatsapp.net', async () => {
    const { handle, sock } = setup();
    await handle(sock, msg('!img gato', { jid: SELF_PN }));
    assert.equal(sock.sent.length, 1);
    assert.equal(sock.sent[0].jid, SELF_PN);
  });

  test('!img 3 gato → 3 imágenes', async () => {
    const { handle, sock, getImages } = setup();
    await handle(sock, msg('!img 3 gato'));
    assert.deepEqual(getImages.calls, [{ query: 'gato', count: 3 }]);
    assert.equal(sock.sent.length, 3);
    assert.ok(sock.sent.every((s) => s.content.caption === 'gato'));
  });

  test('!img 10 gato → como máximo 5', async () => {
    const { handle, sock } = setup();
    await handle(sock, msg('!img 10 gato'));
    assert.equal(sock.sent.length, 5);
  });

  test('si encuentra menos de las pedidas, avisa', async () => {
    const { handle, sock } = setup({ available: 2 });
    await handle(sock, msg('!img 4 gato'));
    assert.equal(sock.sent.length, 3);
    assert.equal(sock.sent[2].content.text, 'Solo encontré 2 de 4 para "gato"');
  });

  test('sin resultados responde "No encontré"', async () => {
    const { handle, sock } = setup({ available: 0 });
    await handle(sock, msg('!img xyz'));
    assert.deepEqual(sock.sent.map((s) => s.content), [{ text: 'No encontré imágenes para "xyz"' }]);
  });

  test('si la búsqueda falla responde "No encontré" sin romperse', async () => {
    const { handle, sock } = setup({ fail: true });
    await handle(sock, msg('!img gato'));
    assert.deepEqual(sock.sent.map((s) => s.content), [{ text: 'No encontré imágenes para "gato"' }]);
  });

  test('!img sin texto muestra el uso', async () => {
    const { handle, sock, getImages } = setup();
    await handle(sock, msg('!img'));
    assert.equal(getImages.calls.length, 0);
    assert.deepEqual(sock.sent.map((s) => s.content), [{ text: 'Uso: !img [1-5] <búsqueda>' }]);
  });

  test('ignora mensajes de otras personas', async () => {
    const { handle, sock, getImages } = setup();
    await handle(sock, msg('!img gato', { jid: OTHER, fromMe: false }));
    await handle(sock, msg('!img gato', { jid: SELF_LID, fromMe: false }));
    assert.equal(getImages.calls.length, 0);
    assert.equal(sock.sent.length, 0);
  });

  test('ignora mis mensajes en otros chats y grupos', async () => {
    const { handle, sock, getImages } = setup();
    await handle(sock, msg('!img gato', { jid: OTHER }));
    await handle(sock, msg('!img gato', { jid: GROUP }));
    assert.equal(getImages.calls.length, 0);
    assert.equal(sock.sent.length, 0);
  });

  test('ignora textos que no son el comando', async () => {
    const { handle, sock } = setup();
    for (const text of ['hola', '!imggato', '!image gato', 'dame !img gato']) {
      await handle(sock, msg(text));
    }
    assert.equal(sock.sent.length, 0);
  });

  test('ignora mensajes viejos (historial) y mensajes sin contenido', async () => {
    const { handle, sock } = setup();
    await handle(sock, msg('!img gato', { ts: 900 }));
    await handle(sock, { key: { remoteJid: SELF_LID, fromMe: true, id: 'X' }, messageTimestamp: 2000 });
    assert.equal(sock.sent.length, 0);
  });

  test('no se responde a sí mismo (sin bucles)', async () => {
    const { handle, sock, getImages } = setup();
    await handle(sock, msg('!img gato'));
    // WhatsApp nos devuelve el mensaje que envió el bot, también como fromMe.
    const echo = { ...msg('!img gato', { id: 'BOT0' }) };
    await handle(sock, echo);
    assert.equal(getImages.calls.length, 1);
    assert.equal(sock.sent.length, 1);
  });

  test('el caption de la imagen nunca dispara el comando', async () => {
    const { handle, sock } = setup();
    await handle(sock, msg('!img gato'));
    assert.ok(!sock.sent[0].content.caption.startsWith('!img'));
  });
});
