import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MAX_BYTES, assertYoutubeUrl, buildArgs, downloadYoutube, parseDuration } from './ytdlp.js';

const URL_OK = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

describe('parseDuration', () => {
  test('lee m:ss y h:mm:ss', () => {
    assert.equal(parseDuration('3:15'), 195);
    assert.equal(parseDuration('1:02:28'), 3748);
    assert.equal(parseDuration(''), 0);
    assert.equal(parseDuration('EN VIVO'), 0);
    assert.equal(parseDuration(undefined), 0);
  });
});

describe('assertYoutubeUrl', () => {
  test('acepta links normales de YouTube', () => {
    assert.equal(assertYoutubeUrl(`${URL_OK}&t=10`), URL_OK);
  });
  test('rechaza otros hosts, http, rutas raras o ids inválidos', () => {
    for (const bad of [
      'https://evil.com/watch?v=jNQXAC9IVRw',
      'http://www.youtube.com/watch?v=jNQXAC9IVRw',
      'https://www.youtube.com/playlist?list=x',
      'https://www.youtube.com/watch?v=--exec=rm',
    ]) {
      assert.throws(() => assertYoutubeUrl(bad), /no válido/);
    }
  });
});

test('buildArgs: cookies, límite de duración, H.264 y la URL después de "--"', () => {
  const args = buildArgs({ url: URL_OK, cookiesFile: '/auth/c.txt', ffmpegPath: '/usr/bin/ffmpeg', output: '/tmp/x/video.%(ext)s' });
  assert.equal(args[args.indexOf('--cookies') + 1], '/auth/c.txt');
  assert.equal(args[args.indexOf('--match-filter') + 1], 'duration<=1200');
  assert.match(args[args.indexOf('-f') + 1], /vcodec\^=avc1/);
  assert.ok(args.includes('--no-playlist'));
  assert.deepEqual(args.slice(-2), ['--', URL_OK]);
});

describe('downloadYoutube', () => {
  test('ejecuta yt-dlp sin shell y devuelve el MP4', async () => {
    let call;
    const runProcess = async (cmd, args) => {
      call = { cmd, args };
      await writeFile(args[args.indexOf('-o') + 1].replace('%(ext)s', 'mp4'), 'MP4');
    };
    const result = await downloadYoutube(URL_OK, { cookiesFile: '/c.txt', ytdlpPath: '/bin/yt-dlp', runProcess });
    assert.equal(call.cmd, '/bin/yt-dlp');
    assert.ok(Array.isArray(call.args));
    assert.ok(existsSync(result.file));
    await result.cleanup();
    assert.equal(existsSync(dirname(result.file)), false);
  });

  test('sin archivo (video demasiado largo) falla y limpia', async () => {
    let dir;
    const runProcess = async (cmd, args) => {
      dir = dirname(args[args.indexOf('-o') + 1]);
    };
    await assert.rejects(downloadYoutube(URL_OK, { cookiesFile: '/c.txt', runProcess }), /dura más de 20 minutos/);
    assert.equal(existsSync(dir), false);
  });

  test('si pesa demasiado falla y limpia', async () => {
    let dir;
    const runProcess = async (cmd, args) => {
      const out = args[args.indexOf('-o') + 1].replace('%(ext)s', 'mp4');
      dir = dirname(out);
      await writeFile(out, Buffer.alloc(MAX_BYTES + 1));
    };
    await assert.rejects(downloadYoutube(URL_OK, { cookiesFile: '/c.txt', runProcess }), /pesa demasiado/);
    assert.equal(existsSync(dir), false);
  });

  test('si yt-dlp falla, limpia y no ejecuta nada con links inválidos', async () => {
    await assert.rejects(
      downloadYoutube(URL_OK, { cookiesFile: '/c.txt', runProcess: async () => { throw new Error('yt-dlp falló'); } }),
      /yt-dlp falló/,
    );
    let ran = false;
    await assert.rejects(
      downloadYoutube('https://evil.com/x', { cookiesFile: '/c.txt', runProcess: async () => (ran = true) }),
      /no válido/,
    );
    assert.equal(ran, false);
  });
});
