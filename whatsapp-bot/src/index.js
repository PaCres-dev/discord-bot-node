// Bot de WhatsApp: responde a "!img <texto>" (solo mensajes propios) con una imagen.
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { proxyAgent } from './proxy.js';
import { getRandomImages } from './images.js';
import { createMessageHandler } from './commands.js';

const AUTH_DIR = process.env.AUTH_DIR || './auth';
const PHONE_NUMBER = (process.env.PHONE_NUMBER || '').replace(/\D/g, '');

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });
const handleMessage = createMessageHandler({
  getImages: getRandomImages,
  // Los mensajes del comando siempre se ven en consola, aunque LOG_LEVEL sea warn.
  logger: { info: console.log, warn: logger.warn.bind(logger), error: logger.error.bind(logger) },
  startedAt: Math.floor(Date.now() / 1000),
});

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestWaWebVersion().catch(() => ({}));

  if (!state.creds.registered && !PHONE_NUMBER) {
    console.error('Falta PHONE_NUMBER (con código de país, sin +) para vincular por primera vez.');
    process.exit(1);
  }

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    logger,
    browser: Browsers.macOS('Chrome'),
    agent: proxyAgent,
    fetchAgent: proxyAgent,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  let pairingRequested = false;
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && !pairingRequested && !sock.authState.creds.registered) {
      pairingRequested = true;
      const code = await sock.requestPairingCode(PHONE_NUMBER);
      console.log(`\nCódigo de vinculación: ${code.slice(0, 4)}-${code.slice(4)}`);
      console.log('WhatsApp → Dispositivos vinculados → Vincular con número de teléfono\n');
    }
    if (connection === 'open') {
      console.log('Conectado a WhatsApp. Escribe "!img <texto>" en "Mensaje a mí mismo".');
    }
    if (connection === 'close') {
      const status = lastDisconnect?.error?.output?.statusCode;
      if (status === DisconnectReason.loggedOut) {
        console.log(`Sesión cerrada. Borra ${AUTH_DIR} y vuelve a vincular.`);
        process.exit(1);
      }
      console.log(`Conexión cerrada (${status}), reconectando...`);
      setTimeout(start, 2000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      try {
        await handleMessage(sock, msg);
      } catch (err) {
        logger.error(err, 'Error manejando mensaje');
      }
    }
  });
}

start();
