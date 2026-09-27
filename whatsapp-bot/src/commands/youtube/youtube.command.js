// !youtube <búsqueda>: busca en YouTube y envía el primer video.
// Si hay sesión de YouTube guardada (!ytcookies) y dura hasta el máximo, lo descarga y lo envía;
// si no, o si la descarga falla, envía el link con vista previa.
export function createYoutubeCommand({ findFirstVideo, downloader }) {
  return {
    name: 'youtube',
    aliases: ['yt'],
    description: 'Te envía el primer video de YouTube (o su link si no se puede bajar)',
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

      const sendLink = (note) => {
        const description = [video.channel, video.duration].filter(Boolean).join(' · ');
        return ctx.reply.link({ url: video.url, title: video.title, description, thumbnail: video.thumbnail }).then(() =>
          note ? ctx.reply.text(note) : undefined,
        );
      };

      if (!(await downloader.isConfigured())) {
        await sendLink();
        ctx.logger.info?.(`  → link ${video.url}`);
        return;
      }
      const seconds = downloader.parseDuration(video.duration);
      if (!seconds || seconds > downloader.maxMinutes * 60) {
        await sendLink(`Dura más de ${downloader.maxMinutes} minutos (o es en vivo), así que te dejo el link.`);
        return;
      }

      await ctx.reply.text(`Descargando "${video.title}" (${video.duration})...`);
      let download;
      try {
        download = await downloader.download(video.url);
      } catch (err) {
        ctx.logger.error?.(err, 'Falló la descarga de YouTube');
        await sendLink('No pude descargar el video, te dejo el link.');
        return;
      }
      try {
        await ctx.reply.video(download.file, `${video.title}\n${video.url}`);
        ctx.logger.info?.(`  → video ${video.url}`);
      } finally {
        await download.cleanup();
      }
    },
  };
}
