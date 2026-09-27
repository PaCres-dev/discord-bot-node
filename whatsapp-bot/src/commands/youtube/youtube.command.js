// !youtube <búsqueda>: envía el link del primer resultado de YouTube con vista previa.
// (YouTube bloquea las descargas desde servidores, por eso se envía el link y no el video.)
export function createYoutubeCommand({ findFirstVideo }) {
  return {
    name: 'youtube',
    aliases: ['yt'],
    description: 'Te envía el link del primer video de YouTube',
    usage: 'youtube <búsqueda>',

    async run(ctx) {
      const query = ctx.args;
      if (!query) {
        await ctx.reply.text(`Uso: ${ctx.prefix}${this.usage}`);
        return;
      }

      let video = null;
      try {
        video = await findFirstVideo(query);
      } catch (err) {
        ctx.logger.error?.(err, 'Falló la búsqueda en YouTube');
      }
      if (!video) {
        await ctx.reply.text(`No encontré videos de YouTube para "${query}"`);
        return;
      }
      const description = [video.channel, video.duration].filter(Boolean).join(' · ');
      await ctx.reply.link({ url: video.url, title: video.title, description, thumbnail: video.thumbnail });
      ctx.logger.info?.(`  → link ${video.url}`);
    },
  };
}
