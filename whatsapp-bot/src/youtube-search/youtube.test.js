import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { findFirstVideo, parseSearchResults } from './youtube.js';

// Página de resultados mínima con la misma forma que la de YouTube.
function page(videos) {
  const data = {
    contents: {
      sectionListRenderer: {
        contents: [
          { itemSectionRenderer: { contents: [{ adSlotRenderer: {} }, ...videos.map((videoRenderer) => ({ videoRenderer }))] } },
        ],
      },
    },
  };
  return `<html><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`;
}

const GATOS = {
  videoId: 'oxXFYnM3u6Y',
  title: { runs: [{ text: 'Gatos ' }, { text: 'graciosos' }] },
  ownerText: { runs: [{ text: 'Life for Fun' }] },
  lengthText: { simpleText: '1:02:28' },
};

describe('parseSearchResults', () => {
  test('extrae id, título, canal, duración y link', () => {
    assert.deepEqual(parseSearchResults(page([GATOS])), [
      {
        id: 'oxXFYnM3u6Y',
        title: 'Gatos graciosos',
        channel: 'Life for Fun',
        duration: '1:02:28',
        url: 'https://www.youtube.com/watch?v=oxXFYnM3u6Y',
      },
    ]);
  });
  test('respeta el orden y descarta ids inválidos', () => {
    const results = parseSearchResults(page([{ videoId: 'malo' }, GATOS, { ...GATOS, videoId: 'AAAAAAAAAAA' }]));
    assert.deepEqual(results.map((r) => r.id), ['oxXFYnM3u6Y', 'AAAAAAAAAAA']);
  });
  test('falla si la página no tiene resultados', () => {
    assert.throws(() => parseSearchResults('<html></html>'), /No se encontraron resultados/);
  });
});

describe('findFirstVideo', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => (globalThis.fetch = realFetch));

  function mockFetch(videos, thumbStatus = 200) {
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      if (String(url).includes('/results?')) return new Response(page(videos));
      return new Response('JPEG', { status: thumbStatus });
    };
    return urls;
  }

  test('devuelve el primero con su miniatura', async () => {
    const urls = mockFetch([GATOS]);
    const video = await findFirstVideo('gatos graciosos');
    assert.equal(video.id, 'oxXFYnM3u6Y');
    assert.equal(video.thumbnail.toString(), 'JPEG');
    assert.equal(urls[0], 'https://www.youtube.com/results?search_query=gatos%20graciosos');
    assert.equal(urls[1], 'https://i.ytimg.com/vi/oxXFYnM3u6Y/hqdefault.jpg');
  });
  test('sin miniatura igual devuelve el video', async () => {
    mockFetch([GATOS], 404);
    const video = await findFirstVideo('gatos');
    assert.equal(video.thumbnail, null);
  });
  test('sin resultados devuelve null', async () => {
    mockFetch([]);
    assert.equal(await findFirstVideo('nada'), null);
  });
});
