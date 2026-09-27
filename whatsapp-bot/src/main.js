// Punto de entrada: arma la configuración, los comandos y la conexión a WhatsApp.
import './proxy.js';
import pino from 'pino';
import { loadConfig } from './config.js';
import { createRouter } from './bot/router.js';
import { createCommands } from './commands/index.js';
import * as imageSearch from './image-search/duckduckgo.js';
import * as youtubeSearch from './youtube-search/youtube.js';
import * as dailymotion from './video-search/dailymotion.js';
import { createTransactionIdGenerator, createXFeed } from './x-feed/x.js';
import { join } from 'node:path';
import * as cookies from './youtube-download/cookies.js';
import { startWhatsApp } from './whatsapp/connection.js';

const config = loadConfig();
const youtubeCookiesFile = join(config.authDir, 'youtube-cookies.txt');
const baileysLogger = pino({ level: config.logLevel });
// Los comandos recibidos siempre se ven en consola, aunque LOG_LEVEL sea warn.
const logger = {
  info: console.log,
  warn: baileysLogger.warn.bind(baileysLogger),
  error: baileysLogger.error.bind(baileysLogger),
};

const router = createRouter({
  commands: createCommands({
    imageSearch,
    youtubeSearch,
    videoSearch: {
      ...dailymotion,
      downloadVideo: (video) => dailymotion.downloadVideo(video, { ffmpegPath: config.ffmpegPath }),
    },
    xFeed: createXFeed({
      ...config.x,
      authDir: config.authDir,
      transactionId: createTransactionIdGenerator(),
      logger,
    }),
    youtubeCookies: {
      extractYoutubeCookies: cookies.extractYoutubeCookies,
      toNetscape: (c) => cookies.toNetscape(c),
      saveCookies: (text) => cookies.saveCookiesFile(youtubeCookiesFile, text),
      maxBytes: cookies.MAX_NETLOG_BYTES,
    },
  }),
  prefix: config.prefix,
  logger,
  startedAt: Math.floor(Date.now() / 1000),
});

startWhatsApp({ config, logger: baileysLogger, onMessage: router.handle });
