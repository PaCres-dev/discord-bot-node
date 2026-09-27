// !twitter: envía los últimos 10 tweets nuevos del feed "Para ti" de X, uno por mensaje.
import { formatTweet } from './format-tweet.js';

export const TWEETS_PER_UPDATE = 10;

export function createTwitterCommand({ feed }) {
  return {
    name: 'twitter',
    aliases: ['x'],
    description: `Te envía ${TWEETS_PER_UPDATE} tweets nuevos de tu feed "Para ti"`,
    usage: 'twitter',

    async run(ctx) {
      if (!(await feed.isConfigured())) {
        await ctx.reply.text(`${ctx.prefix}twitter todavía no está configurado: faltan X_USERNAME, X_PASSWORD y X_EMAIL.`);
        return;
      }

      let tweets;
      try {
        tweets = await feed.getNewTweets(TWEETS_PER_UPDATE);
      } catch (err) {
        ctx.logger.error?.(err, 'Falló la lectura del feed de X');
        await ctx.reply.text('No pude leer tu feed de X. Puede que X haya pedido verificar la cuenta o cambiado algo.');
        return;
      }
      if (tweets.length === 0) {
        await ctx.reply.text('No hay tweets nuevos en tu feed.');
        return;
      }

      for (const tweet of tweets) {
        await sendTweet(ctx, feed, tweet);
        await feed.markSent(tweet);
      }
      ctx.logger.info?.(`  → ${tweets.length} tweets`);
    },
  };
}

async function sendTweet(ctx, feed, tweet) {
  const text = formatTweet(tweet);
  const photos = [];
  for (const url of tweet.photos) {
    try {
      photos.push(await feed.downloadPhoto(url));
    } catch (err) {
      ctx.logger.warn?.(`No se pudo bajar la foto ${url}: ${err.message}`);
    }
  }
  if (photos.length === 0) {
    await ctx.reply.text(text);
    return;
  }
  // La primera foto lleva el texto del tweet; las demás van sin texto.
  await ctx.reply.image(photos[0], text);
  for (const photo of photos.slice(1)) await ctx.reply.image(photo, '');
}
