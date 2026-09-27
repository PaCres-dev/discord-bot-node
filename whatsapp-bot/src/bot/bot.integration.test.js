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

const fakeYoutube = {
  findFirstVideo: async (query) =>
    query === 'nada'
      ? null
      : { id: 'abcdefghijk', title: `Video de ${query}`, channel: 'Canal', duration: '3:15', url: 'https://www.youtube.com/watch?v=abcdefghijk', thumbnail: Buffer.from('jpg') },
};

function fakeVideos() {
  const cleaned = [];
  return {
    cleaned,
    MAX_MINUTES: 20,
    searchVideos: async (query) => (query === 'nada' ? [] : [{ id: 'x1', title: `Clip de ${query}`, duration: 195 }]),
    downloadVideo: async (video) => ({ file: `/tmp/${video.id}.mp4`, cleanup: async () => cleaned.push(video.id) }),
  };
}

const fakeXFeed = {
  isConfigured: async () => true,
  getNewTweets: async () => [
    { id: 't1', ids: ['t1'], author: { name: 'Ana', username: 'ana' }, text: 'Hola', url: 'https://x.com/ana/status/t1', photos: [], retweetedBy: null, replyTo: null },
  ],
  markSent: async () => {},
  downloadPhoto: async () => Buffer.from('jpg'),
};

// Sin sesión de YouTube guardada: !youtube manda el link (la descarga se prueba en youtube.test.js).
const fakeDownloader = { isConfigured: async () => false, download: async () => null, parseDuration: () => 0, countParts: () => 1, partMinutes: 5, maxParts: 6 };

const savedCookies = [];
const fakeCookies = {
  extractYoutubeCookies: (text) => new Map([['SAPISID', text]]),
  toNetscape: (c) => `cookies:${c.get('SAPISID')}`,
  saveCookies: async (text) => savedCookies.push(text),
  maxBytes: 1000,
};

// Arma el bot como main.js, pero con un WhatsApp falso que guarda lo que se envía.
function setup(opts) {
  const imageSearch = fakeImages(opts);
  const videoSearch = fakeVideos();
  const router = createRouter({
    commands: createCommands({ imageSearch, youtubeSearch: fakeYoutube, youtubeDownloader: fakeDownloader, videoSearch, xFeed: fakeXFeed, youtubeCookies: fakeCookies }),
    prefix: '!',
    logger: silent,
    startedAt: 1000,
  });
  const sent = [];
  let n = 0;
  const receive = (raw, download) => {
    const incoming = toIncoming(raw, ME);
    if (!incoming) return;
    if (incoming.attachment && download) incoming.attachment.download = download;
    return router.handle(incoming, async (content) => {
      sent.push({ jid: raw.key.remoteJid, content });
      return `BOT${n++}`;
    });
  };
  return { receive, sent, calls: imageSearch.calls, cleaned: videoSearch.cleaned };
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
      assert.match(content.text, /!youtube \[1-6\] <búsqueda>/);
      assert.match(content.text, /!video <búsqueda>/);
      assert.match(content.text, /!twitter/);
    }
  });

  test('el comando no distingue mayúsculas (!IMG, !Help)', async () => {
    const { receive, sent, calls } = setup();
    await receive(msg('!IMG Gato', { id: 'A' }));
    await receive(msg('!Help', { id: 'B' }));
    assert.deepEqual(calls, [{ query: 'Gato', count: 1 }]);
    assert.equal(sent.length, 2);
  });

  test('!youtube, !yt y !YouTube envían el link con vista previa', async () => {
    const { receive, sent } = setup();
    await receive(msg('!youtube gatos', { id: 'A' }));
    await receive(msg('!yt gatos', { id: 'B' }));
    await receive(msg('!YouTube gatos', { id: 'C' }));
    assert.equal(sent.length, 3);
    for (const { content } of sent) {
      assert.equal(content.text, '*Video de gatos*\nhttps://www.youtube.com/watch?v=abcdefghijk');
      assert.equal(content.linkPreview['matched-text'], 'https://www.youtube.com/watch?v=abcdefghijk');
      assert.equal(content.linkPreview.description, 'Canal · 3:15');
      assert.ok(Buffer.isBuffer(content.linkPreview.jpegThumbnail));
    }
  });

  test('!youtube sin resultados avisa', async () => {
    const { receive, sent } = setup();
    await receive(msg('!youtube nada'));
    assert.deepEqual(sent.map((s) => s.content), [{ text: 'No encontré videos de YouTube para "nada"' }]);
  });

  test('!video avisa, envía el MP4 y borra el archivo temporal', async () => {
    const { receive, sent, cleaned } = setup();
    await receive(msg('!video gatos'));
    assert.equal(sent.length, 2);
    assert.equal(sent[0].content.text, 'Descargando "Clip de gatos (3:15)"...');
    assert.deepEqual(sent[1].content.video, { url: '/tmp/x1.mp4' });
    assert.equal(sent[1].content.mimetype, 'video/mp4');
    assert.equal(sent[1].content.caption, 'Clip de gatos (3:15)');
    assert.deepEqual(cleaned, ['x1']);
  });

  test('!video sin resultados avisa', async () => {
    const { receive, sent } = setup();
    await receive(msg('!video nada'));
    assert.deepEqual(sent.map((s) => s.content), [{ text: 'No encontré videos para "nada"' }]);
  });

  test('!twitter y !x envían los tweets del feed', async () => {
    const { receive, sent } = setup();
    await receive(msg('!twitter', { id: 'A' }));
    await receive(msg('!X', { id: 'B' }));
    assert.deepEqual(sent.map((s) => s.content.text), [
      '*Ana* (@ana)\nHola\nhttps://x.com/ana/status/t1',
      '*Ana* (@ana)\nHola\nhttps://x.com/ana/status/t1',
    ]);
  });

  test('!ytcookies como texto de un documento guarda las cookies', async () => {
    const { receive, sent } = setup();
    savedCookies.length = 0;
    const doc = {
      key: { remoteJid: SELF_LID, fromMe: true, id: 'DOC1' },
      messageTimestamp: 2000,
      message: { documentWithCaptionMessage: { message: { documentMessage: { caption: '!ytcookies', fileName: 'chrome-net-export-log.json', fileLength: 10 } } } },
    };
    // La descarga real la hace Baileys; acá se reemplaza por una función falsa.
    const incomingDownload = async () => Buffer.from('netlog');
    await receive(doc, incomingDownload);
    assert.deepEqual(savedCookies, ['cookies:netlog']);
    assert.match(sent[0].content.text, /^Listo: guardé tu sesión de YouTube/);
  });

  test('!ytcookies de otra persona o en otro chat se ignora', async () => {
    const { receive, sent } = setup();
    savedCookies.length = 0;
    for (const [jid, fromMe] of [[OTHER, false], [SELF_LID, false], [GROUP, true]]) {
      await receive(
        { key: { remoteJid: jid, fromMe, id: `D-${jid}` }, messageTimestamp: 2000, message: { documentMessage: { caption: '!ytcookies', fileLength: 10 } } },
        async () => Buffer.from('netlog'),
      );
    }
    assert.deepEqual(savedCookies, []);
    assert.equal(sent.length, 0);
  });

  test('ignora mensajes de otras personas', async () => {
    const { receive, sent, calls } = setup();
    for (const text of ['!img gato', '!help', '!youtube gato', '!video gato', '!twitter']) {
      await receive(msg(text, { jid: OTHER, fromMe: false }));
      await receive(msg(text, { jid: SELF_LID, fromMe: false }));
      await receive(msg(text, { jid: GROUP, fromMe: false }));
    }
    assert.equal(calls.length, 0);
    assert.equal(sent.length, 0);
  });

  test('ignora mis mensajes en otros chats y grupos', async () => {
    const { receive, sent, calls } = setup();
    for (const text of ['!img gato', '!help', '!youtube gato', '!video gato', '!twitter']) {
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
