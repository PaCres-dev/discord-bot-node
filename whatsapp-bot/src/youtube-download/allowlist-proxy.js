// Proxy local (solo 127.0.0.1) que deja pasar únicamente conexiones HTTPS (CONNECT al puerto 443)
// hacia dominios permitidos. yt-dlp y el generador de tokens PO se ejecutan detrás de él, así
// no pueden conectarse a ningún otro lugar. Si hay un proxy de salida (HTTPS_PROXY), se encadena.
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';

export const YOUTUBE_HOSTS = [
  'youtube.com',
  'googlevideo.com',
  'ytimg.com',
  'ggpht.com',
  'www.google.com',
  'googleapis.com',
];

// "rr3---sn-x.googlevideo.com" coincide con "googlevideo.com"; "evilyoutube.com" no.
export function isAllowedHost(host, allowed = YOUTUBE_HOSTS) {
  const h = String(host).toLowerCase().replace(/\.$/, '');
  return allowed.some((a) => h === a || h.endsWith(`.${a}`));
}

function tunnelViaUpstream(upstream, host, port) {
  return new Promise((resolve, reject) => {
    const u = new URL(upstream);
    const req = httpRequest({ host: u.hostname, port: u.port || 80, method: 'CONNECT', path: `${host}:${port}` });
    req.once('connect', (res, socket) => (res.statusCode === 200 ? resolve(socket) : (socket.destroy(), reject(new Error(`upstream ${res.statusCode}`)))));
    req.once('error', reject);
    req.end();
  });
}

function tunnelDirect(host, port) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, host, () => resolve(socket));
    socket.once('error', reject);
  });
}

// Devuelve { url, close(), denied } — denied lista los hosts rechazados (para registros y tests).
export async function startAllowlistProxy({ allowed = YOUTUBE_HOSTS, upstream = null, port: listenPort = 0, logger = console } = {}) {
  const denied = [];
  const server = createServer((req, res) => {
    // Solo túneles HTTPS; HTTP plano no se permite.
    res.writeHead(405).end();
  });
  server.on('connect', async (req, clientSocket, head) => {
    const [host, portText] = String(req.url).split(':');
    const port = Number(portText);
    if (port !== 443 || !isAllowedHost(host, allowed)) {
      denied.push(`${host}:${portText}`);
      logger.warn?.(`Conexión bloqueada por el aislamiento de YouTube: ${host}:${portText}`);
      clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    try {
      const target = upstream ? await tunnelViaUpstream(upstream, host, port) : await tunnelDirect(host, port);
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) target.write(head);
      target.pipe(clientSocket).pipe(target);
      target.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => target.destroy());
    } catch {
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    }
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(listenPort, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    denied,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
