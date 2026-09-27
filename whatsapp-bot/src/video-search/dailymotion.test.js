import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  MAX_BYTES,
  downloadVideo,
  parseMasterPlaylist,
  parseMediaPlaylist,
  pickVariant,
  searchVideos,
} from './dailymotion.js';

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=460560,CODECS="mp4a.40.2,avc1.42001e",RESOLUTION=640x360,NAME="360"
https://vod3.cf.dmcdn.net/sec(x)/360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720,NAME="720"
https://vod3.cf.dmcdn.net/sec(x)/720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080,NAME="1080"
https://vod3.cf.dmcdn.net/sec(x)/1080.m3u8
`;

const MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:3
#EXTINF:3.0,
../../../frag(1)/video.ts
#EXTINF:3.0,
../../../frag(2)/video.ts
#EXT-X-ENDLIST
`;

describe('playlists', () => {
  test('parseMasterPlaylist lee calidades con URL absoluta', () => {
    assert.deepEqual(parseMasterPlaylist(MASTER, 'https://cdndirector.dailymotion.com/m.m3u8').map((v) => [v.height, v.bandwidth]), [
      [360, 460560],
      [720, 1500000],
      [1080, 4000000],
    ]);
  });

  test('parseMediaPlaylist resuelve rutas relativas', () => {
    assert.deepEqual(parseMediaPlaylist(MEDIA, 'https://vod3.cf.dmcdn.net/a/b/c/d/360.m3u8'), [
      'https://vod3.cf.dmcdn.net/a/frag(1)/video.ts',
      'https://vod3.cf.dmcdn.net/a/frag(2)/video.ts',
    ]);
  });

  test('parseMediaPlaylist rechaza videos cifrados', () => {
    assert.throws(() => parseMediaPlaylist(`#EXT-X-KEY:METHOD=AES-128,URI="k"\nseg.ts`, 'https://x.dmcdn.net/'), /cifrado/);
  });

  test('pickVariant elige la mejor hasta 720p que entre en el límite de tamaño', () => {
    const variants = parseMasterPlaylist(MASTER, 'https://x.dmcdn.net/');
    assert.equal(pickVariant(variants, 180).height, 720); // 3 min en 720p ≈ 34 MB
    const longest = Math.floor((MAX_BYTES * 8) / 1500000) + 60; // 720p ya no entra
    assert.equal(pickVariant(variants, longest).height, 360);
    assert.equal(pickVariant(variants, 100000).height, 360); // nada entra → la más liviana
    assert.equal(pickVariant([], 60), null);
  });
});

describe('searchVideos y downloadVideo', () => {
  const realFetch = globalThis.fetch;
  let requests;
  let routes;

  beforeEach(() => {
    requests = [];
    routes = {
      'api.dailymotion.com': () =>
        Response.json({ list: [{ id: 'x7ujm5q', title: 'Gatos graciosos', duration: 192, 'owner.screenname': 'Crazy cat' }] }),
      'www.dailymotion.com': () =>
        Response.json({ qualities: { auto: [{ url: 'https://cdndirector.dailymotion.com/cdn/manifest/video/x7ujm5q.m3u8?sec=1' }] } }),
      'cdndirector.dailymotion.com': () => new Response(MASTER),
      'vod3.cf.dmcdn.net': (url) =>
        url.pathname.endsWith('.m3u8') ? new Response(MEDIA) : new Response(`SEG${url.pathname.match(/frag\((\d)\)/)[1]}`),
    };
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      const route = routes[url.hostname];
      if (!route) throw new Error(`petición inesperada: ${url}`);
      return route(url);
    };
  });
  afterEach(() => (globalThis.fetch = realFetch));

  test('searchVideos pide videos de hasta 20 minutos', async () => {
    const [video] = await searchVideos('gatos graciosos');
    assert.deepEqual(video, { id: 'x7ujm5q', title: 'Gatos graciosos', duration: 192, channel: 'Crazy cat' });
    const api = requests[0];
    assert.equal(api.searchParams.get('search'), 'gatos graciosos');
    assert.equal(api.searchParams.get('shorter_than'), '20');
  });

  test('downloadVideo une los fragmentos en orden, llama a ffmpeg y limpia', async () => {
    let ffmpegCall;
    const runFfmpeg = async (path, args) => {
      ffmpegCall = { path, args, input: await readFile(args[args.indexOf('-i') + 1], 'utf8') };
      await writeFile(args.at(-1), 'MP4');
    };
    const result = await downloadVideo({ id: 'x7ujm5q', duration: 192 }, { ffmpegPath: '/usr/bin/ffmpeg', runFfmpeg });
    assert.equal(ffmpegCall.path, '/usr/bin/ffmpeg');
    assert.equal(ffmpegCall.input, 'SEG1SEG2');
    assert.ok(ffmpegCall.args.includes('copy'));
    assert.equal(await readFile(result.file, 'utf8'), 'MP4');
    // Eligió 720p (3 min entra en el límite), no 1080p.
    assert.ok(requests.some((u) => u.pathname.endsWith('/720.m3u8')));
    assert.ok(!requests.some((u) => u.pathname.endsWith('/1080.m3u8')));
    await result.cleanup();
    assert.equal(existsSync(dirname(result.file)), false);
  });

  test('si ffmpeg falla, no deja archivos temporales', async () => {
    let dir;
    const runFfmpeg = async (path, args) => {
      dir = dirname(args.at(-1));
      throw new Error('ffmpeg roto');
    };
    await assert.rejects(downloadVideo({ id: 'x7ujm5q', duration: 192 }, { runFfmpeg }), /ffmpeg roto/);
    assert.equal(existsSync(dir), false);
  });

  test('video no disponible', async () => {
    routes['www.dailymotion.com'] = () => Response.json({ error: { title: 'Video eliminado' } });
    await assert.rejects(downloadVideo({ id: 'x1', duration: 10 }), /Video eliminado/);
  });

  test('solo descarga de Dailymotion y su CDN (https)', async () => {
    routes['vod3.cf.dmcdn.net'] = () => new Response('#EXTM3U\nhttps://evil.example.com/seg.ts\n');
    await assert.rejects(downloadVideo({ id: 'x1', duration: 10 }, { runFfmpeg: async () => {} }), /Host no permitido: evil.example.com/);
    routes['www.dailymotion.com'] = () => Response.json({ qualities: { auto: [{ url: 'http://cdndirector.dailymotion.com/m.m3u8' }] } });
    await assert.rejects(downloadVideo({ id: 'x1', duration: 10 }), /Host no permitido/);
  });
});
