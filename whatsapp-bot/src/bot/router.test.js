import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, parseCommand } from './router.js';
import { isAllowed } from './access.js';

const silent = { info() {}, warn() {}, error() {} };

function incoming(text, overrides = {}) {
  return { id: `M-${text}`, chatId: 'yo', fromMe: true, isSelfChat: true, text, timestamp: 2000, ...overrides };
}

function command(name, run, extra = {}) {
  return { name, description: name, usage: name, run, ...extra };
}

function collector() {
  const sent = [];
  let n = 0;
  const send = async (content) => {
    sent.push(content);
    return `BOT${n++}`;
  };
  return { sent, send };
}

describe('parseCommand', () => {
  test('separa nombre y argumentos', () => {
    assert.deepEqual(parseCommand('!img 3 gato', '!'), { name: 'img', args: '3 gato' });
    assert.deepEqual(parseCommand('!help', '!'), { name: 'help', args: '' });
    assert.deepEqual(parseCommand('!img   gato  ', '!'), { name: 'img', args: 'gato' });
  });
  test('el nombre no distingue mayúsculas, los argumentos sí se conservan', () => {
    assert.deepEqual(parseCommand('!YouTube Gatos Graciosos', '!'), { name: 'youtube', args: 'Gatos Graciosos' });
    assert.deepEqual(parseCommand('!IMG 2 Messi', '!'), { name: 'img', args: '2 Messi' });
  });
  test('no es comando si no empieza con el prefijo o está vacío', () => {
    assert.equal(parseCommand('img gato', '!'), null);
    assert.equal(parseCommand('!', '!'), null);
    assert.equal(parseCommand('! img', '!'), null);
  });
});

describe('isAllowed (política de acceso)', () => {
  test('solo mis mensajes en "Mensaje a mí mismo"', () => {
    assert.equal(isAllowed({ fromMe: true, isSelfChat: true }), true);
    assert.equal(isAllowed({ fromMe: false, isSelfChat: true }), false);
    assert.equal(isAllowed({ fromMe: true, isSelfChat: false }), false);
    assert.equal(isAllowed({ fromMe: false, isSelfChat: false }), false);
    assert.equal(isAllowed({}), false);
  });
});

describe('createRouter', () => {
  test('ejecuta el comando por nombre o alias con sus argumentos', async () => {
    const seen = [];
    const router = createRouter({
      commands: [command('eco', async (ctx) => seen.push(ctx.args), { aliases: ['e'] })],
      prefix: '!',
      logger: silent,
    });
    const { send } = collector();
    await router.handle(incoming('!eco hola'), send);
    await router.handle(incoming('!e chau'), send);
    assert.deepEqual(seen, ['hola', 'chau']);
  });

  test('no ejecuta nada si la política de acceso lo rechaza', async () => {
    let runs = 0;
    const router = createRouter({ commands: [command('eco', async () => runs++)], prefix: '!', logger: silent });
    const { send } = collector();
    await router.handle(incoming('!eco', { fromMe: false }), send);
    await router.handle(incoming('!eco', { isSelfChat: false }), send);
    assert.equal(runs, 0);
  });

  test('rechaza nombres o alias duplicados', () => {
    const run = async () => {};
    assert.throws(() => createRouter({ commands: [command('a', run), command('a', run)], prefix: '!' }), /duplicado: a/);
    assert.throws(
      () => createRouter({ commands: [command('a', run, { aliases: ['b'] }), command('b', run)], prefix: '!' }),
      /duplicado: b/,
    );
  });

  test('un comando que falla responde un error y el bot sigue funcionando', async () => {
    const router = createRouter({
      commands: [
        command('roto', async () => {
          throw new Error('boom');
        }),
        command('ok', async (ctx) => ctx.reply.text('bien')),
      ],
      prefix: '!',
      logger: silent,
    });
    const { sent, send } = collector();
    await router.handle(incoming('!roto'), send);
    await router.handle(incoming('!ok'), send);
    assert.deepEqual(sent, [{ text: 'Hubo un error con !roto' }, { text: 'bien' }]);
  });

  test('atiende los mensajes en orden, sin mezclar respuestas', async () => {
    const router = createRouter({
      commands: [
        command('lento', async (ctx) => {
          await ctx.reply.text('lento 1');
          await new Promise((r) => setTimeout(r, 30));
          await ctx.reply.text('lento 2');
        }),
        command('rapido', async (ctx) => ctx.reply.text('rápido')),
      ],
      prefix: '!',
      logger: silent,
    });
    const { sent, send } = collector();
    await Promise.all([router.handle(incoming('!lento'), send), router.handle(incoming('!rapido'), send)]);
    assert.deepEqual(sent.map((s) => s.text), ['lento 1', 'lento 2', 'rápido']);
  });

  test('ignora sus propios mensajes enviados (anti-bucle)', async () => {
    let runs = 0;
    const router = createRouter({
      commands: [command('eco', async (ctx) => (runs++, ctx.reply.text('!eco')))],
      prefix: '!',
      logger: silent,
    });
    const { send } = collector();
    await router.handle(incoming('!eco'), send);
    await router.handle(incoming('!eco', { id: 'BOT0' }), send); // el eco de lo que envió el bot
    assert.equal(runs, 1);
  });

  test('reply.video y reply.link arman el mensaje de WhatsApp', async () => {
    const router = createRouter({
      commands: [
        command('media', async (ctx) => {
          await ctx.reply.video('/tmp/v.mp4', 'Clip');
          await ctx.reply.link({ url: 'https://youtu.be/x', title: 'T', description: 'D', thumbnail: Buffer.from('j') });
          await ctx.reply.link({ url: 'https://youtu.be/y', title: 'T2', description: 'D2', thumbnail: null });
        }),
      ],
      prefix: '!',
      logger: silent,
    });
    const { sent, send } = collector();
    await router.handle(incoming('!media'), send);
    assert.deepEqual(sent[0], { video: { url: '/tmp/v.mp4' }, caption: 'Clip', mimetype: 'video/mp4' });
    assert.deepEqual(sent[1], {
      text: '*T*\nhttps://youtu.be/x',
      linkPreview: { 'canonical-url': 'https://youtu.be/x', 'matched-text': 'https://youtu.be/x', title: 'T', description: 'D', jpegThumbnail: Buffer.from('j') },
    });
    assert.equal('jpegThumbnail' in sent[2].linkPreview, false);
  });

  test('le pasa a los comandos la lista de comandos y el prefijo', async () => {
    let ctxSeen;
    const commands = [command('info', async (ctx) => (ctxSeen = ctx))];
    const router = createRouter({ commands, prefix: '!', logger: silent });
    await router.handle(incoming('!info'), collector().send);
    assert.equal(ctxSeen.prefix, '!');
    assert.equal(ctxSeen.commands, commands);
  });
});
