import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_OPERATION,
  OPERATIONS_URL,
  buildHomeTimelineUrl,
  createOperationProvider,
  parseTimeline,
  validateOperation,
} from './home-timeline.js';
import { cursorEntry, entry, rawTweet, timeline, user } from './fixtures.js';

const silent = { warn() {} };

describe('validateOperation', () => {
  test('acepta un queryId simple y features booleanos', () => {
    assert.deepEqual(validateOperation({ queryId: 'abcDEF123_-xyz', features: { a_b: true, c: false }, url: 'x' }), {
      queryId: 'abcDEF123_-xyz',
      features: { a_b: true, c: false },
    });
  });
  test('rechaza datos con forma inesperada', () => {
    for (const bad of [
      null,
      { queryId: '../../evil', features: { a: true } },
      { queryId: 'abcDEF123456', features: { a: 'true' } },
      { queryId: 'abcDEF123456', features: {} },
      { queryId: 'abcDEF123456', features: { 'x y': true } },
      { queryId: 'abcDEF123456' },
    ]) {
      assert.equal(validateOperation(bad), null);
    }
  });
});

describe('createOperationProvider', () => {
  const remote = (body, status = 200) => async (url) => {
    assert.equal(url, OPERATIONS_URL);
    return new Response(JSON.stringify(body), { status });
  };

  test('usa la operación actualizada si es válida', async () => {
    const op = { queryId: 'NEWqueryId12345', features: { f: true } };
    const get = createOperationProvider({ fetchImpl: remote({ graphql: { HomeTimeline: op } }), logger: silent });
    assert.equal((await get()).queryId, 'NEWqueryId12345');
  });

  test('si el listado falla o es inválido, usa la de respaldo', async () => {
    for (const fetchImpl of [remote({}, 500), remote({ graphql: { HomeTimeline: { queryId: '../x' } } }), async () => { throw new Error('sin red'); }]) {
      const get = createOperationProvider({ fetchImpl, logger: silent });
      assert.equal(await get(), DEFAULT_OPERATION);
    }
  });

  test('guarda la operación 24 h', async () => {
    let calls = 0;
    let time = 0;
    const get = createOperationProvider({
      fetchImpl: async () => (calls++, new Response('{}')),
      now: () => time,
      logger: silent,
    });
    await get();
    time += 60 * 60 * 1000;
    await get();
    assert.equal(calls, 1);
    time += 24 * 60 * 60 * 1000;
    await get();
    assert.equal(calls, 2);
  });
});

test('buildHomeTimelineUrl arma el pedido del feed', () => {
  const url = new URL(buildHomeTimelineUrl({ queryId: 'QID1234567890', features: { f: true } }, { cursor: 'C1' }));
  assert.equal(url.origin + url.pathname, 'https://x.com/i/api/graphql/QID1234567890/HomeTimeline');
  const variables = JSON.parse(url.searchParams.get('variables'));
  assert.equal(variables.cursor, 'C1');
  assert.equal(variables.count, 20);
  assert.deepEqual(JSON.parse(url.searchParams.get('features')), { f: true });
});

describe('parseTimeline', () => {
  test('lee tweets normales, con fotos y links, y el cursor', () => {
    const photo = rawTweet('1', {
      text: 'Mirá esto https://t.co/abc &amp; más https://t.co/foto',
      legacy: {
        entities: { urls: [{ url: 'https://t.co/abc', expanded_url: 'https://ejemplo.com/nota' }] },
        extended_entities: { media: [{ type: 'photo', url: 'https://t.co/foto', media_url_https: 'https://pbs.twimg.com/media/A.jpg' }, { type: 'video', media_url_https: 'https://pbs.twimg.com/v.jpg' }] },
      },
    });
    const { tweets, cursor } = parseTimeline(timeline([entry(photo), cursorEntry('NEXT')]));
    assert.equal(cursor, 'NEXT');
    assert.deepEqual(tweets[0], {
      id: '1',
      ids: ['1'],
      author: { name: 'AUTOR', username: 'autor' },
      text: 'Mirá esto https://ejemplo.com/nota & más',
      url: 'https://x.com/autor/status/1',
      photos: ['https://pbs.twimg.com/media/A.jpg'],
      retweetedBy: null,
      replyTo: null,
      promoted: false,
    });
  });

  test('retweets muestran el original y marcan ambos IDs', () => {
    const original = rawTweet('10', { username: 'famoso', text: 'original' });
    const rt = rawTweet('11', { username: 'amigo', text: 'RT @famoso: original', legacy: { retweeted_status_result: { result: original } } });
    const [tweet] = parseTimeline(timeline([entry(rt)])).tweets;
    assert.equal(tweet.id, '11');
    assert.deepEqual(tweet.ids, ['11', '10']);
    assert.equal(tweet.author.username, 'famoso');
    assert.equal(tweet.text, 'original');
    assert.equal(tweet.retweetedBy, 'amigo');
    assert.equal(tweet.url, 'https://x.com/famoso/status/10');
  });

  test('respuestas, tweets largos, visibilidad limitada y usuarios con formato viejo', () => {
    const reply = rawTweet('20', { legacy: { in_reply_to_screen_name: 'otro' } });
    const long = rawTweet('21', { text: 'corto…', extra: { note_tweet: { note_tweet_results: { result: { text: 'texto largo completo' } } } } });
    const limited = { __typename: 'TweetWithVisibilityResults', tweet: rawTweet('22') };
    const oldUser = { ...rawTweet('23'), core: { user_results: { result: { legacy: { screen_name: 'viejo', name: 'Viejo' } } } } };
    const tweets = parseTimeline(timeline([entry(reply), entry(long), entry(limited), entry(oldUser)])).tweets;
    assert.equal(tweets[0].replyTo, 'otro');
    assert.equal(tweets[1].text, 'texto largo completo');
    assert.equal(tweets[2].id, '22');
    assert.deepEqual(tweets[3].author, { name: 'Viejo', username: 'viejo' });
  });

  test('marca la publicidad y lee conversaciones agrupadas', () => {
    const ad = entry(rawTweet('30'), { entryId: 'promoted-tweet-30', promoted: true });
    const conversation = {
      entryId: 'home-conversation-1',
      content: {
        entryType: 'TimelineTimelineModule',
        items: [
          { item: { itemContent: { itemType: 'TimelineTweet', tweet_results: { result: rawTweet('31') } } } },
          { item: { itemContent: { itemType: 'TimelineTweet', tweet_results: { result: rawTweet('32') } } } },
        ],
      },
    };
    const tweets = parseTimeline(timeline([ad, conversation])).tweets;
    assert.deepEqual(tweets.map((t) => [t.id, t.promoted]), [['30', true], ['31', false], ['32', false]]);
  });

  test('ignora entradas desconocidas y respuestas vacías', () => {
    assert.deepEqual(parseTimeline({}), { tweets: [], cursor: null });
    const weird = { entryId: 'who-to-follow', content: { itemContent: { itemType: 'TimelineUser', user_results: user('x') } } };
    assert.deepEqual(parseTimeline(timeline([weird, entry({ __typename: 'TweetTombstone' })])).tweets, []);
  });
});
