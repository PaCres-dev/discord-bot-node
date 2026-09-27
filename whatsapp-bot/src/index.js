// Bot de WhatsApp: responde a "!img <texto>" (solo mensajes propios) con una imagen.
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  normalizeMessageContent,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { proxyAgent } from './proxy.js';
import { getRandomImage } from './images.js';

const AUTH_DIR = process.env.AUTH_DIR || './auth';
const PHONE_NUMBER = (process.env.PHONE_NUMBER || '').replace(/\D/g, '');
const PREFIX = '!img';

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });
const startedAt = Math.floor(Date.now() / 1000);
// IDs de los mensajes que envía el bot, para no procesarlos de nuevo.
const sentByBot = new Set();

function getText(message) {
  const content = normalizeMessageContent(message);
  return content?.conversation || content?.extendedTextMessage?.text || '';
}

async function reply(sock, jid, content, quoted) {
  const sent = await sock.sendMessage(jid, content, { quoted });
  if (sent?.key?.id) sentByBot.add(sent.key.id);
}

async function handleMessage(sock, msg) {
  if (!msg.key.fromMe || !msg.message) return;
  if (sentByBot.has(msg.key.id)) return;
  if (Number(msg.messageTimestamp) < startedAt - 5) return; // historial viejo

  const text = getText(msg.message).trim();
  if (text !== PREFIX && !text.startsWith(`${PREFIX} `)) return;

  // El self-chat puede venir como @s.whatsapp.net o como @lid; respondemos al mismo chat.
  const jid = msg.key.remoteJid;
  const query = text.slice(PREFIX.length).trim();
  console.log(`[${jid}] ${text}`);

  if (!query) {
    await reply(sock, jid, { text: `Uso: ${PREFIX} <búsqueda>` }, msg);
    return;
  }

  let image = null;
  try {
    image = await getRandomImage(query, logger);
  } catch (err) {
    logger.error(err, 'Falló la búsqueda');
  }
  if (!image) {
    await reply(sock, jid, { text: `No encontré imágenes para "${query}"` }, msg);
    return;
  }
  await reply(sock, jid, { image: image.buffer, caption: query }, msg);
  console.log(`  → enviada ${image.url}`);
}

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
