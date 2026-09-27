import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { XNotConfiguredError, createXFeed } from './x.js';
import { OPERATIONS_URL } from './home-timeline.js';
import { cursorEntry, entry, rawTweet, timeline } from './fixtures.js';

const silent = { warn() {}, error() {}, info() {} };
const CREDS = { username: 'yo', password: 'secreto', email: 'yo@mail.com' };

let dir;
let pages; // cursor → entradas de esa página
let requests;
let status; // estado HTTP que devuelve el feed (para simular sesión vencida)
let logins;

const login = async (creds) => {
  logins.push(creds);
  return { auth_token: `AUTH${logins.length}`, ct0: `CT${logins.length}` };
};

async function fetchImpl(input, init = {}) {
  const url = new URL(String(input));
  requests.push({ url, headers: init.headers ?? {} });
  if (url.href === OPERATIONS_URL) return new Response('{}', { status: 404 });
  if (url.hostname === 'pbs.twimg.com') return new Response('JPEG');
  if (url.pathname.endsWith('/HomeTimeline')) {
    if (status.length) return new Response('{}', { status: status.shift() });
    const cursor = JSON.parse(url.searchParams.get('variables')).cursor ?? 'start';
    return Response.json(timeline(pages[cursor] ?? []));
  }
  throw new Error(`petición inesperada: ${url}`);
}

function feed(overrides = {}) {
  return createXFeed({ ...CREDS, authDir: dir, fetchImpl, login, logger: silent, ...overrides });
}

const tweets = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => entry(rawTweet(String(from + i))));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'x-feed-'));
  requests = [];
  status = [];
  logins = [];
  pages = { start: [...tweets(1, 6), cursorEntry('p2')], p2: [...tweets(7, 14), cursorEntry('p3')], p3: [] };
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('createXFeed', () => {
  test('sin credenciales ni sesión no está configurado', async () => {
    const f = feed({ username: '', password: '' });
    assert.equal(await f.isConfigured(), false);
    await assert.rejects(f.getNewTweets(10), XNotConfiguredError);
  });

  test('con una sesión guardada funciona sin contraseña', async () => {
    await writeFile(join(dir, 'x-session.json'), JSON.stringify({ auth_token: 'S', ct0: 'T' }));
    const f = feed({ username: '', password: '' });
    assert.equal(await f.isConfigured(), true);
    assert.equal((await f.getNewTweets(3)).length, 3);
    assert.equal(logins.length, 0);
  });

  test('inicia sesión una vez, guarda solo la sesión y manda los encabezados de la web', async () => {
    const f = feed();
    await f.getNewTweets(3);
    await f.getNewTweets(3);
    assert.equal(logins.length, 1);
    assert.deepEqual(logins[0], CREDS);
    const saved = await readFile(join(dir, 'x-session.json'), 'utf8');
    assert.deepEqual(JSON.parse(saved), { auth_token: 'AUTH1', ct0: 'CT1' });
    assert.ok(!saved.includes('secreto'));
    const { headers } = requests.find((r) => r.url.pathname.endsWith('/HomeTimeline'));
    assert.equal(headers['x-csrf-token'], 'CT1');
    assert.equal(headers.cookie, 'auth_token=AUTH1; ct0=CT1');
    assert.match(headers.authorization, /^Bearer /);
    assert.ok(!JSON.stringify(requests.map((r) => [r.url.href, r.headers])).includes('secreto'));
  });

  test('junta 10 tweets recorriendo páginas y sin publicidad', async () => {
    pages.start.splice(2, 0, entry(rawTweet('AD'), { entryId: 'promoted-tweet-AD', promoted: true }));
    const result = await feed().getNewTweets(10);
    assert.deepEqual(result.map((t) => t.id), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  });

  test('no repite tweets ya enviados, ni siquiera entre reinicios', async () => {
    const f = feed();
    const first = await f.getNewTweets(4);
    for (const t of first) await f.markSent(t);
    const again = await feed().getNewTweets(4); // otra instancia = bot reiniciado
    assert.deepEqual(again.map((t) => t.id), ['5', '6', '7', '8']);
  });

  test('solo marca como enviados los que se confirman con markSent', async () => {
    const f = feed();
    const [first] = await f.getNewTweets(1);
    assert.equal((await f.getNewTweets(1))[0].id, first.id);
  });

  test('no repite un tweet que aparece como original y como retweet', async () => {
    const original = rawTweet('50', { username: 'famoso' });
    pages.start = [entry(original), entry(rawTweet('51', { legacy: { retweeted_status_result: { result: original } } }))];
    assert.deepEqual((await feed().getNewTweets(10)).map((t) => t.id), ['50']);
  });

  test('para cuando no hay más páginas', async () => {
    pages = { start: tweets(1, 2) };
    assert.equal((await feed().getNewTweets(10)).length, 2);
  });

  test('como máximo 5 páginas', async () => {
    pages = {};
    for (let i = 0; i < 10; i++) pages[i === 0 ? 'start' : `p${i}`] = [cursorEntry(`p${i + 1}`)];
    assert.deepEqual(await feed().getNewTweets(10), []);
    assert.equal(requests.filter((r) => r.url.pathname.endsWith('/HomeTimeline')).length, 5);
  });

  test('si la sesión venció, inicia sesión de nuevo una sola vez', async () => {
    const f = feed();
    await f.getNewTweets(1);
    status = [401];
    assert.equal((await f.getNewTweets(1)).length, 1);
    assert.equal(logins.length, 2);
    status = [403, 403];
    await assert.rejects(f.getNewTweets(1), /X respondió 403/);
    assert.equal(logins.length, 3);
  });

  test('downloadPhoto solo baja de pbs.twimg.com', async () => {
    const f = feed();
    assert.equal((await f.downloadPhoto('https://pbs.twimg.com/media/A.jpg')).toString(), 'JPEG');
    assert.equal(requests.at(-1).url.searchParams.get('name'), 'medium');
    await assert.rejects(f.downloadPhoto('https://evil.example.com/a.jpg'), /Host no permitido/);
    await assert.rejects(f.downloadPhoto('http://pbs.twimg.com/a.jpg'), /Host no permitido/);
  });

  test('agrega x-client-transaction-id si se puede generar', async () => {
    const f = feed({ transactionId: async (method, path) => `${method}:${path}` });
    await f.getNewTweets(1);
    const { headers } = requests.find((r) => r.url.pathname.endsWith('/HomeTimeline'));
    assert.match(headers['x-client-transaction-id'], /^GET:\/i\/api\/graphql\/.+\/HomeTimeline$/);
  });
});
