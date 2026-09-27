import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { isAllowedHost, startAllowlistProxy } from './allowlist-proxy.js';

describe('isAllowedHost', () => {
  test('dominios de YouTube y sus subdominios', () => {
    for (const h of ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'rr3---sn-abc.googlevideo.com', 'i.ytimg.com', 'www.google.com', 'jnn-pa.googleapis.com']) {
      assert.equal(isAllowedHost(h), true, h);
    }
  });
  test('rechaza impostores y otros dominios', () => {
    for (const h of ['evilyoutube.com', 'youtube.com.evil.net', 'example.com', 'google.com', 'mail.google.com', 'web.whatsapp.com']) {
      assert.equal(isAllowedHost(h), false, h);
    }
  });
});

// Envía un CONNECT al proxy y devuelve la primera línea de la respuesta.
function connectThrough(proxyUrl, target) {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(proxyUrl);
    const socket = connect(Number(port), hostname, () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    socket.once('data', (d) => (resolve(d.toString().split('\r\n')[0]), socket.destroy()));
    socket.once('error', reject);
  });
}

describe('startAllowlistProxy', () => {
  test('bloquea dominios no permitidos y puertos distintos de 443, y los registra', async () => {
    const proxy = await startAllowlistProxy({ logger: {} });
    try {
      assert.match(proxy.url, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.equal(await connectThrough(proxy.url, 'example.com:443'), 'HTTP/1.1 403 Forbidden');
      assert.equal(await connectThrough(proxy.url, 'www.youtube.com:80'), 'HTTP/1.1 403 Forbidden');
      assert.deepEqual(proxy.denied, ['example.com:443', 'www.youtube.com:80']);
    } finally {
      await proxy.close();
    }
  });

  test('deja pasar dominios permitidos a través del proxy de salida', async () => {
    // Proxy de salida falso que acepta el túnel.
    const upstreamTargets = [];
    const { createServer } = await import('node:http');
    const upstream = createServer();
    upstream.on('connect', (req, socket) => {
      upstreamTargets.push(req.url);
      socket.end('HTTP/1.1 200 Connection Established\r\n\r\n');
    });
    await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
    const proxy = await startAllowlistProxy({ upstream: `http://127.0.0.1:${upstream.address().port}`, logger: {} });
    try {
      assert.equal(await connectThrough(proxy.url, 'www.youtube.com:443'), 'HTTP/1.1 200 Connection Established');
      assert.deepEqual(upstreamTargets, ['www.youtube.com:443']);
      assert.deepEqual(proxy.denied, []);
    } finally {
      await proxy.close();
      await new Promise((r) => upstream.close(r));
    }
  });
});
