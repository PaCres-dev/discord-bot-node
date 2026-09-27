// Lógica del comando !img, separada de la conexión para poder testearla.
import { areJidsSameUser, normalizeMessageContent } from '@whiskeysockets/baileys';

export const PREFIX = '!img';
export const MAX_IMAGES = 5;

export function getText(message) {
  const content = normalizeMessageContent(message);
  return content?.conversation || content?.extendedTextMessage?.text || '';
}

// Solo "Mensaje a mí mismo": el chat puede venir como mi número (@s.whatsapp.net) o como mi @lid.
export function isSelfChat(user, jid) {
  return areJidsSameUser(jid, user?.id) || areJidsSameUser(jid, user?.lid);
}

// "!img 3 gato" → { count: 3, query: 'gato' }. El número va primero y se limita a MAX_IMAGES.
export function parseArgs(args) {
  const match = args.match(/^(\d{1,2})\s+(.+)$/);
  if (!match) return { count: 1, query: args };
  const count = Math.min(Math.max(Number(match[1]), 1), MAX_IMAGES);
  return { count, query: match[2].trim() };
}

// Devuelve la función que procesa cada mensaje entrante.
export function createMessageHandler({ getImages, logger = console, startedAt = 0 }) {
  // IDs de los mensajes que envía el bot, para no procesarlos de nuevo.
  const sentByBot = new Set();

  async function reply(sock, jid, content, quoted) {
    const sent = await sock.sendMessage(jid, content, { quoted });
    if (sent?.key?.id) sentByBot.add(sent.key.id);
  }

  return async function handleMessage(sock, msg) {
    if (!msg.key.fromMe || !msg.message) return;
    if (sentByBot.has(msg.key.id)) return;
    if (Number(msg.messageTimestamp) < startedAt - 5) return; // historial viejo

    const text = getText(msg.message).trim();
    if (text !== PREFIX && !text.startsWith(`${PREFIX} `)) return;

    const jid = msg.key.remoteJid;
    if (!isSelfChat(sock.user, jid)) return;
    logger.info?.(`[${jid}] ${text}`);

    const { count, query } = parseArgs(text.slice(PREFIX.length).trim());
    if (!query) {
      await reply(sock, jid, { text: `Uso: ${PREFIX} [1-${MAX_IMAGES}] <búsqueda>` }, msg);
      return;
    }

    let images = [];
    try {
      images = await getImages(query, count, logger);
    } catch (err) {
      logger.error?.(err, 'Falló la búsqueda');
    }
    if (images.length === 0) {
      await reply(sock, jid, { text: `No encontré imágenes para "${query}"` }, msg);
      return;
    }
    for (const image of images) {
      await reply(sock, jid, { image: image.buffer, caption: query }, msg);
      logger.info?.(`  → enviada ${image.url}`);
    }
    if (images.length < count) {
      await reply(sock, jid, { text: `Solo encontré ${images.length} de ${count} para "${query}"` }, msg);
    }
  };
}
