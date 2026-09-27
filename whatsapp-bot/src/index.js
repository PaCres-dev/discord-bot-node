// Bot de WhatsApp: responde a "!img <texto>" (solo mensajes propios) con una imagen.
import makeWASocket, {
  areJidsSameUser,
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  normalizeMessageContent,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { proxyAgent } from './proxy.js';
import { getRandomImages } from './images.js';

const AUTH_DIR = process.env.AUTH_DIR || './auth';
const PHONE_NUMBER = (process.env.PHONE_NUMBER || '').replace(/\D/g, '');
const PREFIX = '!img';
const MAX_IMAGES = 5;

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });
const startedAt = Math.floor(Date.now() / 1000);
// IDs de los mensajes que envía el bot, para no procesarlos de nuevo.
const sentByBot = new Set();

function getText(message) {
  const content = normalizeMessageContent(message);
  return content?.conversation || content?.extendedTextMessage?.text || '';
}

// Solo "Mensaje a mí mismo": el chat puede venir como mi número (@s.whatsapp.net) o como mi @lid.
function isSelfChat(sock, jid) {
  return areJidsSameUser(jid, sock.user?.id) || areJidsSameUser(jid, sock.user?.lid);
}

// "!img 3 gato" → { count: 3, query: 'gato' }. El número va primero y se limita a MAX_IMAGES.
function parseArgs(args) {
  const match = args.match(/^(\d{1,2})\s+(.+)$/);
  if (!match) return { count: 1, query: args };
  const count = Math.min(Math.max(Number(match[1]), 1), MAX_IMAGES);
  return { count, query: match[2].trim() };
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

  const jid = msg.key.remoteJid;
  if (!isSelfChat(sock, jid)) return;
  console.log(`[${jid}] ${text}`);

  const { count, query } = parseArgs(text.slice(PREFIX.length).trim());
  if (!query) {
    await reply(sock, jid, { text: `Uso: ${PREFIX} [1-${MAX_IMAGES}] <búsqueda>` }, msg);
    return;
  }

  let images = [];
  try {
    images = await getRandomImages(query, count, logger);
  } catch (err) {
    logger.error(err, 'Falló la búsqueda');
  }
  if (images.length === 0) {
    await reply(sock, jid, { text: `No encontré imágenes para "${query}"` }, msg);
    return;
  }
  for (const image of images) {
    await reply(sock, jid, { image: image.buffer, caption: query }, msg);
    console.log(`  → enviada ${image.url}`);
  }
  if (images.length < count) {
    await reply(sock, jid, { text: `Solo encontré ${images.length} de ${count} para "${query}"` }, msg);
  }
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
