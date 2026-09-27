import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MAX_BYTES, MODES, assertYoutubeUrl, buildArgs, buildSplitArgs, countParts, downloadYoutube, parseDuration } from './ytdlp.js';

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

test('buildArgs: cookies, sin en vivo, H.264, tramo opcional y la URL después de "--"', () => {
  const args = buildArgs({ url: URL_OK, cookiesFile: '/auth/c.txt', ffmpegPath: '/usr/bin/ffmpeg', output: '/tmp/x/video.%(ext)s' });
  assert.equal(args[args.indexOf('--cookies') + 1], '/auth/c.txt');
  assert.equal(args[args.indexOf('--match-filter') + 1], '!is_live');
  assert.match(args[args.indexOf('-f') + 1], /vcodec\^=avc1/);
  assert.ok(args.includes('--no-playlist'));
  assert.ok(!args.includes('--download-sections'));
  assert.deepEqual(args.slice(-2), ['--', URL_OK]);
  const partial = buildArgs({ url: URL_OK, cookiesFile: '/c', ffmpegPath: 'ffmpeg', output: 'o', seconds: 900 });
  assert.equal(partial[partial.indexOf('--download-sections') + 1], '*0-900');
});

test('buildArgs: ffmpeg sin ruta se busca en el PATH (no se pasa --ffmpeg-location)', () => {
  const bare = buildArgs({ url: URL_OK, cookiesFile: '/c', ffmpegPath: 'ffmpeg', output: 'o' });
  assert.ok(!bare.includes('--ffmpeg-location'));
  const full = buildArgs({ url: URL_OK, cookiesFile: '/c', ffmpegPath: '/usr/bin/ffmpeg', output: 'o' });
  assert.equal(full[full.indexOf('--ffmpeg-location') + 1], '/usr/bin/ffmpeg');
});

test('buildSplitArgs: partes de 5 minutos sin volver a codificar', () => {
  const args = buildSplitArgs('/tmp/v.mp4', '/tmp/parte-%02d.mp4');
  assert.equal(args[args.indexOf('-segment_time') + 1], '300');
  assert.equal(args[args.indexOf('-c') + 1], 'copy');
  assert.equal(args.at(-1), '/tmp/parte-%02d.mp4');
});

// Proceso falso: yt-dlp escribe video.mp4; ffmpeg escribe `partes` archivos (con tamaños dados).
function fakeProcesses({ videoBytes = 100_000, partSizes = [] } = {}) {
  const calls = [];
  const runProcess = async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd.endsWith('yt-dlp')) {
      if (videoBytes) await writeFile(args[args.indexOf('-o') + 1].replace('%(ext)s', 'mp4'), Buffer.alloc(videoBytes));
    } else {
      const pattern = args.at(-1);
      for (const [i, size] of partSizes.entries()) await writeFile(pattern.replace('%02d', String(i).padStart(2, '0')), Buffer.alloc(size));
    }
  };
  return { calls, runProcess };
}

describe('downloadYoutube', () => {
  const base = { cookiesFile: '/c.txt', ytdlpPath: '/bin/yt-dlp', ffmpegPath: '/bin/ffmpeg' };

  test('video de 6 min pedido en 1 parte: recorta los primeros 5 minutos', async () => {
    const { calls, runProcess } = fakeProcesses({ partSizes: [100_000, 100_000] });
    const result = await downloadYoutube(URL_OK, { ...base, durationSeconds: 369, parts: 1, runProcess });
    assert.equal(calls[1].args[calls[1].args.indexOf('-t') + 1], '300');
    assert.equal(result.files.length, 1);
    await result.cleanup();
  });

  test('video corto: descarga entero, sin dividir, y limpia', async () => {
    const { calls, runProcess } = fakeProcesses();
    const result = await downloadYoutube(URL_OK, { ...base, durationSeconds: 195, parts: 3, runProcess });
    assert.equal(calls.length, 1);
    assert.ok(!calls[0].args.includes('--download-sections'));
    assert.equal(result.files.length, 1);
    assert.ok(existsSync(result.files[0]));
    await result.cleanup();
    assert.equal(existsSync(dirname(result.files[0])), false);
  });

  test('video de hasta 90 min: lo baja entero y recorta aquí solo lo pedido', async () => {
    const { calls, runProcess } = fakeProcesses({ partSizes: [100_000, 100_000, 100_000, 10] });
    const result = await downloadYoutube(URL_OK, { ...base, durationSeconds: 3600, parts: 3, runProcess });
    assert.ok(!calls[0].args.includes('--download-sections'));
    assert.equal(calls[1].cmd, '/bin/ffmpeg');
    assert.equal(calls[1].args[calls[1].args.indexOf('-t') + 1], '900');
    // El resto diminuto del corte se descarta.
    assert.deepEqual(result.files.map((f) => f.split('/').pop()), ['parte-00.mp4', 'parte-01.mp4', 'parte-02.mp4']);
    await result.cleanup();
  });

  test('más de 90 min: baja solo el tramo; nunca más de 6 partes (30 minutos)', async () => {
    const { calls, runProcess } = fakeProcesses({ partSizes: Array(8).fill(100_000) });
    const result = await downloadYoutube(URL_OK, { ...base, durationSeconds: 7200, parts: 20, runProcess });
    assert.equal(calls[0].args[calls[0].args.indexOf('--download-sections') + 1], '*0-1800');
    assert.equal(calls[1].args[calls[1].args.indexOf('-t') + 1], '1800');
    assert.equal(result.files.length, 6);
    await result.cleanup();
  });

  test('sin archivo (en vivo o falló) o parte demasiado pesada: falla y limpia', async () => {
    let dir;
    const noFile = async (cmd, args) => (dir = dirname(args[args.indexOf('-o') + 1]));
    await assert.rejects(downloadYoutube(URL_OK, { ...base, durationSeconds: 60, runProcess: noFile }), /en vivo o no se pudo descargar/);
    assert.equal(existsSync(dir), false);
    const { runProcess } = fakeProcesses({ videoBytes: MAX_BYTES + 1 });
    await assert.rejects(downloadYoutube(URL_OK, { ...base, durationSeconds: 60, runProcess }), /pesa demasiado/);
  });

  test('si yt-dlp falla, limpia; y no ejecuta nada con links inválidos', async () => {
    await assert.rejects(
      downloadYoutube(URL_OK, { ...base, durationSeconds: 60, runProcess: async () => { throw new Error('yt-dlp falló'); } }),
      /yt-dlp falló/,
    );
    let ran = false;
    await assert.rejects(
      downloadYoutube('https://evil.com/x', { ...base, durationSeconds: 60, runProcess: async () => (ran = true) }),
      /no válido/,
    );
    assert.equal(ran, false);
  });
});

describe('modo audio', () => {
  const base = { cookiesFile: '/c.txt', ytdlpPath: '/bin/yt-dlp', ffmpegPath: '/bin/ffmpeg', mode: MODES.audio };

  test('pide solo audio m4a y parte cada 1 hora, máximo 2 partes', () => {
    const args = buildArgs({ url: URL_OK, cookiesFile: '/c', ffmpegPath: 'ffmpeg', output: 'o', mode: MODES.audio });
    assert.equal(args[args.indexOf('-f') + 1], 'ba[ext=m4a]/ba');
    assert.ok(args.includes('-x'));
    assert.equal(args[args.indexOf('--audio-format') + 1], 'm4a');
    assert.ok(!args.includes('--merge-output-format'));
    assert.equal(countParts(45 * 60, 2, MODES.audio), 1);
    assert.equal(countParts(90 * 60, 2, MODES.audio), 2);
    assert.equal(countParts(5 * 60 * 60, 2, MODES.audio), 2);
    const split = buildSplitArgs('/tmp/a.m4a', '/tmp/parte-%02d.m4a', 7200, MODES.audio);
    assert.equal(split[split.indexOf('-segment_time') + 1], '3600');
  });

  test('audio corto: un solo archivo m4a', async () => {
    const calls = [];
    const runProcess = async (cmd, args) => {
      calls.push(cmd);
      await writeFile(args[args.indexOf('-o') + 1].replace('%(ext)s', 'm4a'), Buffer.alloc(100_000));
    };
    const result = await downloadYoutube(URL_OK, { ...base, durationSeconds: 45 * 60, parts: 2, runProcess });
    assert.deepEqual(calls, ['/bin/yt-dlp']);
    assert.ok(result.files[0].endsWith('/video.m4a'));
    await result.cleanup();
  });

  test('audio de 3 horas: baja solo las primeras 2 y las divide en 2 partes', async () => {
    const calls = [];
    const runProcess = async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd.endsWith('yt-dlp')) await writeFile(args[args.indexOf('-o') + 1].replace('%(ext)s', 'm4a'), Buffer.alloc(100_000));
      else for (const i of [0, 1]) await writeFile(args.at(-1).replace('%02d', `0${i}`), Buffer.alloc(100_000));
    };
    const result = await downloadYoutube(URL_OK, { ...base, durationSeconds: 3 * 60 * 60, parts: 2, runProcess });
    assert.equal(calls[0].args[calls[0].args.indexOf('--download-sections') + 1], '*0-7200');
    assert.deepEqual(result.files.map((f) => f.split('/').pop()), ['parte-00.m4a', 'parte-01.m4a']);
    await result.cleanup();
  });
});
