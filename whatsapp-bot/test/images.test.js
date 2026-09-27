import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getRandomImages, searchImages } from '../src/images.js';

// Reemplaza fetch por un DuckDuckGo falso, sin red.
const realFetch = globalThis.fetch;
let requests;
let images; // URL original → { status, type } de la descarga
let resultsCount;
let searchFailures; // cuántas veces falla la búsqueda antes de responder

function imageUrl(i) {
  return `https://site${i}.com/foto${i}.jpg`;
}

function response(status, body, type) {
  return new Response(body, { status, headers: { 'content-type': type } });
}

beforeEach(() => {
  requests = [];
  images = {};
  resultsCount = 20;
  searchFailures = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.hostname === 'duckduckgo.com' && url.pathname === '/') {
      if (searchFailures-- > 0) throw new TypeError('fetch failed');
      return response(200, '<script>vqd="4-12345678901234567890"</script>', 'text/html');
    }
    if (url.hostname === 'duckduckgo.com' && url.pathname === '/i.js') {
      const results = Array.from({ length: resultsCount }, (_, i) => ({ image: imageUrl(i) }));
      return response(200, JSON.stringify({ results }), 'application/json');
    }
    if (url.hostname === 'external-content.duckduckgo.com') {
      const original = url.searchParams.get('u');
      const { status = 200, type = 'image/jpeg' } = images[original] ?? {};
      return response(status, status === 200 ? 'JPEGDATA' : 'error', type);
    }
    throw new Error(`petición inesperada: ${url}`);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('searchImages', () => {
  test('usa el token vqd, SafeSearch desactivado y devuelve el top 10', async () => {
    const urls = await searchImages('perro salchicha');
    assert.equal(urls.length, 10);
    assert.equal(urls[0], imageUrl(0));
    const ijs = requests.find((u) => u.pathname === '/i.js');
    assert.equal(ijs.searchParams.get('q'), 'perro salchicha');
    assert.equal(ijs.searchParams.get('vqd'), '4-12345678901234567890');
    assert.equal(ijs.searchParams.get('p'), '-1');
  });

  test('reintenta fallos de red transitorios', async () => {
    searchFailures = 2;
    const urls = await searchImages('gato');
    assert.equal(urls.length, 10);
  });

  test('sin resultados devuelve lista vacía', async () => {
    resultsCount = 0;
    assert.deepEqual(await searchImages('xyz'), []);
  });
});

describe('getRandomImages', () => {
  test('descarga a través del proxy de DuckDuckGo', async () => {
    const [img] = await getRandomImages('gato', 1, { warn() {} });
    assert.ok(Buffer.isBuffer(img.buffer));
    const download = requests.find((u) => u.hostname === 'external-content.duckduckgo.com');
    assert.equal(download.searchParams.get('u'), img.url);
  });

  test('devuelve la cantidad pedida, sin repetir y solo del top 10', async () => {
    const imgs = await getRandomImages('gato', 5, { warn() {} });
    assert.equal(imgs.length, 5);
    assert.equal(new Set(imgs.map((i) => i.url)).size, 5);
    const top10 = new Set(Array.from({ length: 10 }, (_, i) => imageUrl(i)));
    assert.ok(imgs.every((i) => top10.has(i.url)));
  });

  test('descarta errores y formatos no soportados y prueba con otra', async () => {
    for (let i = 0; i < 10; i++) images[imageUrl(i)] = { status: 404 };
    images[imageUrl(3)] = { type: 'image/webp' };
    images[imageUrl(7)] = {}; // la única buena
    // Con máx. 5 fallos puede no llegar a la buena; se repite para que sea estable.
    let found;
    for (let t = 0; t < 50 && !found; t++) [found] = await getRandomImages('gato', 1, { warn() {} });
    assert.equal(found.url, imageUrl(7));
  });

  test('acepta PNG', async () => {
    for (let i = 0; i < 10; i++) images[imageUrl(i)] = { type: 'image/png' };
    const imgs = await getRandomImages('gato', 1, { warn() {} });
    assert.equal(imgs.length, 1);
  });

  test('se rinde después de 5 descargas fallidas', async () => {
    for (let i = 0; i < 10; i++) images[imageUrl(i)] = { status: 500 };
    const imgs = await getRandomImages('gato', 1, { warn() {} });
    assert.deepEqual(imgs, []);
    const downloads = requests.filter((u) => u.hostname === 'external-content.duckduckgo.com');
    assert.equal(downloads.length, 5);
  });

  test('sin resultados devuelve lista vacía', async () => {
    resultsCount = 0;
    assert.deepEqual(await getRandomImages('xyz', 3, { warn() {} }), []);
  });
});
