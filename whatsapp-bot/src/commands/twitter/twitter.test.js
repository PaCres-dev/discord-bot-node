import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTwitterCommand } from './twitter.command.js';
import { formatTweet } from './format-tweet.js';

const TWEET = {
  id: '1',
  ids: ['1'],
  author: { name: 'Ana', username: 'ana' },
  text: 'Hola mundo',
  url: 'https://x.com/ana/status/1',
  photos: [],
  retweetedBy: null,
  replyTo: null,
};

describe('formatTweet', () => {
  test('tweet simple', () => {
    assert.equal(formatTweet(TWEET), '*Ana* (@ana)\nHola mundo\nhttps://x.com/ana/status/1');
  });
  test('retweet y respuesta', () => {
    assert.equal(
      formatTweet({ ...TWEET, retweetedBy: 'beto', replyTo: 'carla' }),
      '🔁 @beto retuiteó\n*Ana* (@ana) · ↩️ respuesta a @carla\nHola mundo\nhttps://x.com/ana/status/1',
    );
  });
  test('sin texto (solo foto)', () => {
    assert.equal(formatTweet({ ...TWEET, text: '' }), '*Ana* (@ana)\nhttps://x.com/ana/status/1');
  });
});

describe('!twitter', () => {
  function ctx() {
    const replies = [];
    return {
      replies,
      args: '',
      prefix: '!',
      logger: { info() {}, warn() {}, error() {} },
      reply: {
        text: async (text) => replies.push({ text }),
        image: async (buffer, caption) => replies.push({ image: buffer.toString(), caption }),
      },
    };
  }

  function fakeFeed({ configured = true, tweets = [TWEET], fail = false, badPhoto = false } = {}) {
    const sent = [];
    return {
      sent,
      isConfigured: async () => configured,
      getNewTweets: async (count) => {
        if (fail) throw new Error('X caído');
        return tweets.slice(0, count);
      },
      markSent: async (t) => sent.push(t.id),
      downloadPhoto: async (url) => {
        if (badPhoto) throw new Error('404');
        return Buffer.from(url.split('/').pop());
      },
    };
  }

  test('sin configurar, avisa qué falta', async () => {
    const c = ctx();
    await createTwitterCommand({ feed: fakeFeed({ configured: false }) }).run(c);
    assert.deepEqual(c.replies, [{ text: '!twitter todavía no está configurado: faltan X_USERNAME, X_PASSWORD y X_EMAIL.' }]);
  });

  test('pide 10 tweets y envía uno por mensaje, marcándolos como enviados', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...TWEET, id: String(i), ids: [String(i)] }));
    const feed = fakeFeed({ tweets: many });
    const c = ctx();
    await createTwitterCommand({ feed }).run(c);
    assert.equal(c.replies.length, 10);
    assert.deepEqual(feed.sent, ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  test('con fotos: la primera lleva el texto, las demás van solas', async () => {
    const c = ctx();
    await createTwitterCommand({ feed: fakeFeed({ tweets: [{ ...TWEET, photos: ['https://pbs.twimg.com/media/A.jpg', 'https://pbs.twimg.com/media/B.jpg'] }] }) }).run(c);
    assert.deepEqual(c.replies, [
      { image: 'A.jpg', caption: formatTweet(TWEET) },
      { image: 'B.jpg', caption: '' },
    ]);
  });

  test('si una foto no baja, envía el texto igual', async () => {
    const c = ctx();
    await createTwitterCommand({ feed: fakeFeed({ badPhoto: true, tweets: [{ ...TWEET, photos: ['https://pbs.twimg.com/media/A.jpg'] }] }) }).run(c);
    assert.deepEqual(c.replies, [{ text: formatTweet(TWEET) }]);
  });

  test('sin tweets nuevos o si X falla, avisa', async () => {
    let c = ctx();
    await createTwitterCommand({ feed: fakeFeed({ tweets: [] }) }).run(c);
    assert.deepEqual(c.replies, [{ text: 'No hay tweets nuevos en tu feed.' }]);
    c = ctx();
    await createTwitterCommand({ feed: fakeFeed({ fail: true }) }).run(c);
    assert.match(c.replies[0].text, /^No pude leer tu feed de X/);
  });

  test('si falla el envío, ese tweet no queda marcado', async () => {
    const feed = fakeFeed();
    const c = ctx();
    c.reply.text = async () => {
      throw new Error('WhatsApp caído');
    };
    await assert.rejects(createTwitterCommand({ feed }).run(c), /WhatsApp caído/);
    assert.deepEqual(feed.sent, []);
  });
});
