// Traduce un mensaje de Baileys a un objeto simple que el resto del bot entiende.
// Así los comandos y el router no dependen de WhatsApp.
import { areJidsSameUser, normalizeMessageContent } from '@whiskeysockets/baileys';

export function getText(message) {
  const content = normalizeMessageContent(message);
  return content?.conversation || content?.extendedTextMessage?.text || '';
}

// "Mensaje a mí mismo": el chat puede venir como mi número (@s.whatsapp.net) o como mi @lid.
export function isSelfChat(user, jid) {
  return areJidsSameUser(jid, user?.id) || areJidsSameUser(jid, user?.lid);
}

// Devuelve { id, chatId, fromMe, isSelfChat, text, timestamp } o null si no tiene contenido.
export function toIncoming(msg, user) {
  if (!msg?.message || !msg.key) return null;
  return {
    id: msg.key.id,
    chatId: msg.key.remoteJid,
    fromMe: msg.key.fromMe === true,
    isSelfChat: isSelfChat(user, msg.key.remoteJid),
    text: getText(msg.message).trim(),
    timestamp: Number(msg.messageTimestamp) || 0,
  };
}
