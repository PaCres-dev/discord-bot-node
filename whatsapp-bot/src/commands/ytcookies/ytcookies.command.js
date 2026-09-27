// !ytcookies (como texto de un documento): recibe el registro de chrome://net-export,
// extrae solo las cookies de YouTube y las guarda para que !youtube pueda descargar.
export function createYtcookiesCommand({ extractYoutubeCookies, toNetscape, saveCookies, maxBytes }) {
  return {
    name: 'ytcookies',
    description: 'Guarda tu sesión de YouTube (manda el registro de chrome://net-export con este texto)',
    usage: 'ytcookies (como texto del archivo)',

    async run(ctx) {
      const file = ctx.attachment;
      if (!file) {
        await ctx.reply.text(
          `Manda el archivo de chrome://net-export como documento con el texto ${ctx.prefix}ytcookies.`,
        );
        return;
      }
      if (file.size > maxBytes) {
        await ctx.reply.text(`El archivo es muy grande (máx. ${Math.round(maxBytes / 1024 / 1024)} MB). Graba menos tiempo.`);
        return;
      }

      let cookies;
      try {
        const text = (await file.download()).toString('utf8');
        cookies = extractYoutubeCookies(text);
      } catch (err) {
        ctx.logger.warn?.(`!ytcookies: ${err.message}`);
        await ctx.reply.text(err.name === 'CookiesError' ? err.message : 'No pude leer el archivo.');
        return;
      }
      await saveCookies(toNetscape(cookies));
      await ctx.reply.text(
        `Listo: guardé tu sesión de YouTube (${cookies.size} cookies). Ahora borra el mensaje con el archivo "para todos".`,
      );
    },
  };
}
