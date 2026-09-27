// Motor del bot: filtra mensajes, encuentra el comando y lo ejecuta.
// Es igual para todos los comandos; agregar uno nuevo no requiere tocar este archivo.
import { isAllowed } from './access.js';

// Ignora mensajes anteriores al arranque (historial que WhatsApp reenvía al conectar).
const HISTORY_GRACE_SECONDS = 5;

// "!IMG 3 Gato" → { name: 'img', args: '3 Gato' }. null si no es un comando.
// El nombre no distingue mayúsculas (!YouTube = !youtube); los argumentos quedan tal cual.
export function parseCommand(text, prefix) {
  if (!text.startsWith(prefix)) return null;
  const match = text.slice(prefix.length).match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: (match[2] ?? '').trim() };
}

function buildRegistry(commands) {
  const registry = new Map();
  for (const command of commands) {
    for (const name of [command.name, ...(command.aliases ?? [])]) {
      if (registry.has(name)) throw new Error(`Comando duplicado: ${name}`);
      registry.set(name, command);
    }
  }
  return registry;
}

export function createRouter({ commands, prefix, logger = console, startedAt = 0 }) {
  const registry = buildRegistry(commands);
  // IDs de los mensajes que envía el bot, para no procesarlos de nuevo (anti-bucle).
  const sentByBot = new Set();
  // Los mensajes se atienden de a uno, en orden, para no mezclar respuestas.
  let queue = Promise.resolve();

  async function process(incoming, send) {
    if (sentByBot.has(incoming.id)) return;
    if (incoming.timestamp < startedAt - HISTORY_GRACE_SECONDS) return;
    if (!isAllowed(incoming)) return;

    const parsed = parseCommand(incoming.text, prefix);
    const command = parsed && registry.get(parsed.name);
    if (!command) return;
    logger.info?.(`[${incoming.chatId}] ${incoming.text}`);

    const track = async (content) => {
      const id = await send(content);
      if (id) sentByBot.add(id);
    };
    const ctx = {
      args: parsed.args,
      prefix,
      logger,
      commands,
      reply: {
        text: (text) => track({ text }),
        image: (buffer, caption) => track({ image: buffer, caption }),
      },
    };

    try {
      await command.run(ctx);
    } catch (err) {
      // Un comando que falla no tumba el bot ni afecta a los demás.
      logger.error?.(err, `Error en ${prefix}${command.name}`);
      await ctx.reply.text(`Hubo un error con ${prefix}${command.name}`).catch(() => {});
    }
  }

  return {
    handle(incoming, send) {
      const run = queue.then(() => process(incoming, send));
      queue = run.catch(() => {});
      return run;
    },
  };
}
