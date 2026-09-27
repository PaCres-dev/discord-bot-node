// Prueba de punta a punta sin red: mensaje con forma de Baileys → incoming → router → comandos reales.
// Son los mismos casos que cubría el bot antes de reorganizarlo, para asegurar que nada cambió.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from './router.js';
import { createCommands } from '../commands/index.js';
import { toIncoming } from '../whatsapp/incoming.js';

const ME = { id: '5491100000000:66@s.whatsapp.net', lid: '111111111111111:66@lid' };
const SELF_PN = '5491100000000@s.whatsapp.net';
const SELF_LID = '111111111111111@lid';
const OTHER = '5491199999999@s.whatsapp.net';
const GROUP = '120363000000000000@g.us';
const silent = { info() {}, warn() {}, error() {} };

function msg(text, { jid = SELF_LID, fromMe = true, id = 'MSG1', ts = 2000 } = {}) {
  return { key: { remoteJid: jid, fromMe, id }, messageTimestamp: ts, message: { conversation: text } };
}

// Imágenes falsas: devuelve `count` (o `available`, si es menor) y registra las llamadas.
function fakeImages({ available = Infinity, fail = false } = {}) {
  const calls = [];
  const getRandomImages = async (query, count) => {
    calls.push({ query, count });
    if (fail) throw new Error('DuckDuckGo caído');
    return Array.from({ length: Math.min(count, available) }, (_, i) => ({
      buffer: Buffer.from(`img${i}`),
      url: `https://example.com/${i}.jpg`,
    }));
  };
  return { getRandomImages, calls };
}

// Arma el bot como main.js, pero con un WhatsApp falso que guarda lo que se envía.
function setup(opts) {
  const imageSearch = fakeImages(opts);
  const router = createRouter({
    commands: createCommands({ imageSearch }),
    prefix: '!',
    logger: silent,
    startedAt: 1000,
  });
  const sent = [];
  let n = 0;
  const receive = (raw) => {
    const incoming = toIncoming(raw, ME);
    if (!incoming) return;
    return router.handle(incoming, async (content) => {
      sent.push({ jid: raw.key.remoteJid, content });
      return `BOT${n++}`;
    });
  };
  return { receive, sent, calls: imageSearch.calls };
}

describe('bot de punta a punta', () => {
  test('!img gato → 1 imagen con caption en el mismo chat', async () => {
    const { receive, sent, calls } = setup();
    await receive(msg('!img gato'));
    assert.deepEqual(calls, [{ query: 'gato', count: 1 }]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].jid, SELF_LID);
    assert.equal(sent[0].content.caption, 'gato');
    assert.ok(Buffer.isBuffer(sent[0].content.image));
  });

  test('funciona también con el self-chat como @s.whatsapp.net', async () => {
    const { receive, sent } = setup();
    await receive(msg('!img gato', { jid: SELF_PN }));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].jid, SELF_PN);
  });

  test('!img 3 gato → 3 imágenes', async () => {
    const { receive, sent, calls } = setup();
    await receive(msg('!img 3 gato'));
    assert.deepEqual(calls, [{ query: 'gato', count: 3 }]);
    assert.equal(sent.length, 3);
    assert.ok(sent.every((s) => s.content.caption === 'gato'));
  });

  test('!img 10 gato → como máximo 5', async () => {
    const { receive, sent } = setup();
    await receive(msg('!img 10 gato'));
    assert.equal(sent.length, 5);
  });

  test('si encuentra menos de las pedidas, avisa', async () => {
    const { receive, sent } = setup({ available: 2 });
    await receive(msg('!img 4 gato'));
    assert.equal(sent.length, 3);
    assert.equal(sent[2].content.text, 'Solo encontré 2 de 4 para "gato"');
  });

  test('sin resultados responde "No encontré"', async () => {
    const { receive, sent } = setup({ available: 0 });
    await receive(msg('!img xyz'));
    assert.deepEqual(sent.map((s) => s.content), [{ text: 'No encontré imágenes para "xyz"' }]);
  });

  test('si la búsqueda falla responde "No encontré" sin romperse', async () => {
    const { receive, sent } = setup({ fail: true });
    await receive(msg('!img gato'));
    assert.deepEqual(sent.map((s) => s.content), [{ text: 'No encontré imágenes para "gato"' }]);
  });

  test('!img sin texto muestra el uso', async () => {
    const { receive, sent, calls } = setup();
    await receive(msg('!img'));
    assert.equal(calls.length, 0);
    assert.deepEqual(sent.map((s) => s.content), [{ text: 'Uso: !img [1-5] <búsqueda>' }]);
  });

  test('!help y !ayuda listan los comandos', async () => {
    const { receive, sent } = setup();
    await receive(msg('!help', { id: 'A' }));
    await receive(msg('!ayuda', { id: 'B' }));
    assert.equal(sent.length, 2);
    for (const { content } of sent) {
      assert.match(content.text, /^Comandos disponibles:/);
      assert.match(content.text, /!img \[1-5\] <búsqueda>/);
      assert.match(content.text, /!help/);
    }
  });

  test('el comando no distingue mayúsculas (!IMG, !Help)', async () => {
    const { receive, sent, calls } = setup();
    await receive(msg('!IMG Gato', { id: 'A' }));
    await receive(msg('!Help', { id: 'B' }));
    assert.deepEqual(calls, [{ query: 'Gato', count: 1 }]);
    assert.equal(sent.length, 2);
  });

  test('ignora mensajes de otras personas', async () => {
    const { receive, sent, calls } = setup();
    for (const text of ['!img gato', '!help']) {
      await receive(msg(text, { jid: OTHER, fromMe: false }));
      await receive(msg(text, { jid: SELF_LID, fromMe: false }));
      await receive(msg(text, { jid: GROUP, fromMe: false }));
    }
    assert.equal(calls.length, 0);
    assert.equal(sent.length, 0);
  });

  test('ignora mis mensajes en otros chats y grupos', async () => {
    const { receive, sent, calls } = setup();
    for (const text of ['!img gato', '!help']) {
      await receive(msg(text, { jid: OTHER }));
      await receive(msg(text, { jid: GROUP }));
    }
    assert.equal(calls.length, 0);
    assert.equal(sent.length, 0);
  });

  test('ignora textos que no son un comando conocido', async () => {
    const { receive, sent } = setup();
    for (const text of ['hola', '!imggato', '!image gato', 'dame !img gato', '!', '! img gato', '!nada']) {
      await receive(msg(text));
    }
    assert.equal(sent.length, 0);
  });

  test('ignora mensajes viejos (historial) y mensajes sin contenido', async () => {
    const { receive, sent } = setup();
    await receive(msg('!img gato', { ts: 900 }));
    await receive({ key: { remoteJid: SELF_LID, fromMe: true, id: 'X' }, messageTimestamp: 2000 });
    assert.equal(sent.length, 0);
  });

  test('no se responde a sí mismo (sin bucles)', async () => {
    const { receive, sent, calls } = setup();
    await receive(msg('!img gato'));
    // WhatsApp nos devuelve el mensaje que envió el bot, también como fromMe.
    await receive(msg('!img gato', { id: 'BOT0' }));
    assert.equal(calls.length, 1);
    assert.equal(sent.length, 1);
  });

  test('el caption de la imagen nunca dispara el comando', async () => {
    const { receive, sent } = setup();
    await receive(msg('!img gato'));
    assert.ok(!sent[0].content.caption.startsWith('!img'));
  });
});
