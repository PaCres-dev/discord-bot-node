import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildFeedUrl,
  createNewsFeed,
  decodeGoogleNewsLink,
  extractSummary,
  isPublicHttpsUrl,
  parseFeed,
  resolveSection,
} from './google-news.js';

const item = (id, title, source = 'Medio', date = 'Sun, 27 Sep 2026 14:12:49 GMT') => `<item>
  <title>${title} - ${source}</title>
  <link>https://news.google.com/rss/articles/${id}?oc=5</link>
  <pubDate>${date}</pubDate>
  <description>&lt;a href="x"&gt;${title}&lt;/a&gt;</description>
  <source url="https://medio.com">${source}</source>
</item>`;
const rss = (...items) => `<?xml version="1.0"?><rss><channel><title>x</title>${items.join('')}</channel></rss>`;

describe('secciones y URL del feed', () => {
  test('acepta nombres en español e inglés', () => {
    assert.equal(resolveSection('tech'), 'tech');
    assert.equal(resolveSection('Tecnología'), 'tech');
    assert.equal(resolveSection('sports'), 'deportes');
    assert.equal(resolveSection('rust'), null);
  });

  test('búsqueda de la última semana, acotada a la sección si hay', () => {
    const url = new URL(buildFeedUrl({ query: 'rust', section: 'tech' }));
    assert.equal(url.pathname, '/rss/search');
    assert.match(url.searchParams.get('q'), /^rust \(software OR .*\) when:7d$/);
    assert.equal(url.searchParams.get('hl'), 'en-US');
    assert.equal(new URL(buildFeedUrl({ query: 'bitcoin' })).searchParams.get('q'), 'bitcoin when:7d');
  });

  test('sin tema: titulares de la sección', () => {
    assert.match(buildFeedUrl({ section: 'deportes' }), /\/rss\/headlines\/section\/topic\/SPORTS\?/);
  });
});

describe('parseFeed', () => {
  test('lee título sin el medio, medio, fecha e id, en el orden de Google', () => {
    const items = parseFeed(rss(item('AAA', 'Rust &amp; C: news'), item('BBB', 'Otra')));
    assert.deepEqual(items.map((n) => [n.id, n.title, n.source]), [['AAA', 'Rust & C: news', 'Medio'], ['BBB', 'Otra', 'Medio']]);
    assert.equal(items[0].date.toISOString(), '2026-09-27T14:12:49.000Z');
  });

  test('descarta items sin link de Google News o sin título', () => {
    const bad = '<item><title>x</title><link>https://evil.com/a</link></item><item><link>https://news.google.com/rss/articles/Z</link></item>';
    assert.deepEqual(parseFeed(rss(bad)), []);
  });
});

describe('resumen', () => {
  test('usa og:description, luego twitter:description, luego description', () => {
    assert.equal(extractSummary('<meta property="og:description" content="Resumen &amp; más">', 'T'), 'Resumen & más');
    assert.equal(extractSummary('<meta content=\'Del tweet\' name="twitter:description"><meta name="description" content="Meta">', 'T'), 'Del tweet');
    assert.equal(extractSummary('<meta name="description" content="Meta">', 'T'), 'Meta');
  });

  test('sin descripción, vacía o igual al título: sin resumen', () => {
    assert.equal(extractSummary('<html></html>', 'T'), null);
    assert.equal(extractSummary('<meta property="og:description" content="  ">', 'T'), null);
    assert.equal(extractSummary('<meta property="og:description" content="Mismo título">', 'mismo título'), null);
  });

  test('recorta resúmenes largos', () => {
    const long = 'palabra '.repeat(100);
    const summary = extractSummary(`<meta property="og:description" content="${long}">`, 'T');
    assert.ok(summary.length <= 351);
    assert.ok(summary.endsWith('…'));
  });

  test('solo abre notas públicas por HTTPS', () => {
    assert.equal(isPublicHttpsUrl('https://www.infoq.com/news/x'), true);
    for (const bad of ['http://medio.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://intranet/x', 'https://srv.internal/x', 'no es url']) {
      assert.equal(isPublicHttpsUrl(bad), false, bad);
    }
  });
});

describe('decodeGoogleNewsLink', () => {
  test('obtiene el link real con la firma de la página', async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url: String(url), body: init.body });
      if (String(url).includes('/rss/articles/')) return new Response('<div data-n-a-sg="SIG" data-n-a-ts="123"></div>');
      return new Response(')]}\'\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://medio.com/nota\\",1]"]]');
    };
    assert.equal(await decodeGoogleNewsLink('https://news.google.com/rss/articles/ABC?oc=5', fetchImpl), 'https://medio.com/nota');
    assert.ok(decodeURIComponent(calls[1].body).includes('\\"ABC\\",123,\\"SIG\\"'));
  });

  test('sin firma, o con un link no público, devuelve null', async () => {
    assert.equal(await decodeGoogleNewsLink('https://news.google.com/rss/articles/ABC', async () => new Response('<html>')), null);
    const toLocal = async (url) =>
      String(url).includes('/rss/articles/')
        ? new Response('<div data-n-a-sg="S" data-n-a-ts="1"></div>')
        : new Response('[\\"garturlres\\",\\"https://127.0.0.1/admin\\"]');
    assert.equal(await decodeGoogleNewsLink('https://news.google.com/rss/articles/ABC', toLocal), null);
  });
});

describe('createNewsFeed', () => {
  let dir;
  beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), 'news-'))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  function fakeGoogle({ decode = true } = {}) {
    return async (url) => {
      const u = String(url);
      if (u.includes('/rss/search') || u.includes('/rss/headlines')) return new Response(rss(item('A', 'Uno'), item('B', 'Dos'), item('C', 'Tres')));
      if (u.includes('/rss/articles/')) {
        const id = u.match(/articles\/(\w+)/)[1];
        return new Response(decode ? `<div data-n-a-sg="S${id}" data-n-a-ts="1"></div>` : '<html>');
      }
      if (u.includes('batchexecute')) return new Response('[\\"garturlres\\",\\"https://medio.com/nota\\"]');
      if (u.startsWith('https://medio.com/')) {
        return new Response('<meta property="og:description" content="El resumen">', { headers: { 'content-type': 'text/html' } });
      }
      throw new Error(`petición inesperada: ${u}`);
    };
  }

  test('trae noticias con link real y resumen', async () => {
    const feed = createNewsFeed({ authDir: dir, fetchImpl: fakeGoogle(), logger: {} });
    const [n] = await feed.getNews({ query: 'rust', section: 'tech', count: 1 });
    assert.equal(n.title, 'Uno');
    assert.equal(n.url, 'https://medio.com/nota');
    assert.equal(n.summary, 'El resumen');
  });

  test('si no se puede decodificar: link de Google y sin resumen', async () => {
    const feed = createNewsFeed({ authDir: dir, fetchImpl: fakeGoogle({ decode: false }), logger: {} });
    const [n] = await feed.getNews({ query: 'rust', count: 1 });
    assert.match(n.url, /^https:\/\/news\.google\.com\/rss\/articles\/A/);
    assert.equal(n.summary, null);
  });

  test('no repite noticias enviadas, ni entre reinicios', async () => {
    const feed = createNewsFeed({ authDir: dir, fetchImpl: fakeGoogle(), logger: {} });
    const first = await feed.getNews({ query: 'rust', count: 2 });
    for (const n of first) await feed.markSent(n);
    const again = await createNewsFeed({ authDir: dir, fetchImpl: fakeGoogle(), logger: {} }).getNews({ query: 'rust', count: 2 });
    assert.deepEqual(again.map((n) => n.title), ['Tres']);
  });

  test('solo marca como enviadas las confirmadas', async () => {
    const feed = createNewsFeed({ authDir: dir, fetchImpl: fakeGoogle(), logger: {} });
    await feed.getNews({ query: 'rust', count: 1 });
    assert.equal((await feed.getNews({ query: 'rust', count: 1 }))[0].title, 'Uno');
  });

  test('si Google News falla, lanza el error', async () => {
    const feed = createNewsFeed({ authDir: dir, fetchImpl: async () => new Response('', { status: 503 }), logger: {} });
    await assert.rejects(feed.getNews({ query: 'rust', count: 1 }), /Google News respondió 503/);
  });
});
