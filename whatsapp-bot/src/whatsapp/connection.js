// Conexión con WhatsApp (Baileys): sesión, vinculación por código, reconexión y mensajes.
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { proxyAgent } from '../proxy.js';
import { toIncoming } from './incoming.js';

// onMessage(incoming, send): send(content) responde en el mismo chat citando el mensaje
// y devuelve el id del mensaje enviado. content es { text } o { image, caption }.
export async function startWhatsApp({ config, logger, onMessage }) {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version } = await fetchLatestWaWebVersion().catch(() => ({}));

  if (!state.creds.registered && !config.phoneNumber) {
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
      const code = await sock.requestPairingCode(config.phoneNumber);
      console.log(`\nCódigo de vinculación: ${code.slice(0, 4)}-${code.slice(4)}`);
      console.log('WhatsApp → Dispositivos vinculados → Vincular con número de teléfono\n');
    }
    if (connection === 'open') {
      console.log(`Conectado a WhatsApp. Escribe "${config.prefix}help" en "Mensaje a mí mismo".`);
    }
    if (connection === 'close') {
      const status = lastDisconnect?.error?.output?.statusCode;
      if (status === DisconnectReason.loggedOut) {
        console.log(`Sesión cerrada. Borra ${config.authDir} y vuelve a vincular.`);
        process.exit(1);
      }
      console.log(`Conexión cerrada (${status}), reconectando...`);
      setTimeout(() => startWhatsApp({ config, logger, onMessage }), 2000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      const incoming = toIncoming(msg, sock.user);
      if (!incoming) continue;
      const send = async (content) => {
        const sent = await sock.sendMessage(msg.key.remoteJid, content, { quoted: msg });
        return sent?.key?.id;
      };
      try {
        await onMessage(incoming, send);
      } catch (err) {
        logger.error(err, 'Error manejando mensaje');
      }
    }
  });
}
