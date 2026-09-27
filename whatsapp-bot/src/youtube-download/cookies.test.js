import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractYoutubeCookies, hasCookiesFile, saveCookiesFile, toNetscape } from './cookies.js';

const SESSION = 'SID=sid1; __Secure-3PSID=p3; SAPISID=sap; __Secure-3PAPISID=ap3; PREF=f6=40000000';

// Registro con la misma forma que chrome://net-export (eventos con params.headers).
function netlog(events) {
  return JSON.stringify({ constants: { logEventTypes: {} }, events: events.map((headers, i) => ({ type: i, params: { headers } })) });
}

describe('extractYoutubeCookies', () => {
  test('HTTP/1.1: toma las cookies enviadas a youtube.com', () => {
    const cookies = extractYoutubeCookies(
      netlog([
        ['Host: www.youtube.com', 'User-Agent: x', `Cookie: ${SESSION}`],
        ['Host: www.google.com', 'Cookie: SID=de-google; OTRA=1'],
      ]),
    );
    assert.equal(cookies.get('SID'), 'sid1');
    assert.equal(cookies.get('PREF'), 'f6=40000000');
    assert.equal(cookies.has('OTRA'), false);
  });

  test('HTTP/2 y HTTP/3: :authority y cookies partidas o como objeto', () => {
    const cookies = extractYoutubeCookies(
      netlog([
        [':method: GET', ':authority: m.youtube.com', 'cookie: SID=sid1', 'cookie: SAPISID=sap'],
        { ':authority': 'www.youtube.com:443', cookie: 'YSC=abc' },
      ]),
    );
    assert.deepEqual([...cookies.keys()].sort(), ['SAPISID', 'SID', 'YSC']);
  });

  test('registro cortado (Chrome no terminó de escribirlo)', () => {
    const text = netlog([['Host: www.youtube.com', `Cookie: ${SESSION}`], ['Host: www.youtube.com', 'Cookie: YSC=cortad']]);
    // Chrome corta al final: el último evento queda a medias y falta cerrar la lista de eventos.
    const cookies = extractYoutubeCookies(text.slice(0, text.lastIndexOf('YSC=') + 6));
    assert.equal(cookies.get('SAPISID'), 'sap');
  });

  test('si faltó marcar "Include cookies and credentials", lo explica', () => {
    assert.throws(
      () => extractYoutubeCookies(netlog([['Host: www.youtube.com', 'Cookie: [value was stripped]']])),
      (err) => err.name === 'CookiesError' && /Include cookies and credentials/.test(err.message),
    );
  });

  test('sin sesión iniciada, lo explica', () => {
    assert.throws(
      () => extractYoutubeCookies(netlog([['Host: www.youtube.com', 'Cookie: YSC=abc; PREF=x']])),
      (err) => err.name === 'CookiesError' && /No encontré una sesión de YouTube/.test(err.message),
    );
    assert.throws(() => extractYoutubeCookies('no es json'), /No encontré una sesión/);
  });

  test('no acepta hosts que solo se parecen a youtube.com', () => {
    assert.throws(() => extractYoutubeCookies(netlog([['Host: youtube.com.evil.net', `Cookie: ${SESSION}`]])), /No encontré una sesión/);
  });
});

describe('toNetscape y archivo', () => {
  test('formato cookies.txt, __Host- solo para www.youtube.com', () => {
    const text = toNetscape(new Map([['SID', 'a'], ['__Host-X', 'b']]), { now: 0 });
    const lines = text.trim().split('\n').filter((l) => !l.startsWith('#') && l);
    assert.deepEqual(lines, ['.youtube.com\tTRUE\t/\tTRUE\t31536000\tSID\ta', 'www.youtube.com\tFALSE\t/\tTRUE\t31536000\t__Host-X\tb']);
  });

  test('se guarda con permisos 600', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ytc-'));
    const file = join(dir, 'youtube-cookies.txt');
    assert.equal(await hasCookiesFile(file), false);
    await saveCookiesFile(file, toNetscape(new Map([['SID', 'a']])));
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(await hasCookiesFile(file), true);
    await rm(dir, { recursive: true });
  });
});
