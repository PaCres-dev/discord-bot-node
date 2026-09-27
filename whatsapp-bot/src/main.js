// Punto de entrada: arma la configuración, los comandos y la conexión a WhatsApp.
import './proxy.js';
import pino from 'pino';
import { loadConfig } from './config.js';
import { createRouter } from './bot/router.js';
import { createCommands } from './commands/index.js';
import * as imageSearch from './image-search/duckduckgo.js';
import { startWhatsApp } from './whatsapp/connection.js';

const config = loadConfig();
const baileysLogger = pino({ level: config.logLevel });
// Los comandos recibidos siempre se ven en consola, aunque LOG_LEVEL sea warn.
const logger = {
  info: console.log,
  warn: baileysLogger.warn.bind(baileysLogger),
  error: baileysLogger.error.bind(baileysLogger),
};

const router = createRouter({
  commands: createCommands({ imageSearch }),
  prefix: config.prefix,
  logger,
  startedAt: Math.floor(Date.now() / 1000),
});

startWhatsApp({ config, logger: baileysLogger, onMessage: router.handle });
