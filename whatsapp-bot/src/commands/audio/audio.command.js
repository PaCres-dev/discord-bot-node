// !audio <búsqueda>: busca en YouTube y envía solo el audio (ideal para podcasts).
// Completo hasta 2 horas, en partes de 1 hora. Sin sesión de YouTube (!ytcookies), en vivo
// o si la descarga falla, envía el link con vista previa.
export function createAudioCommand({ findFirstVideo, downloader }) {
  const { audioPartMinutes, audioMaxParts } = downloader;
  const maxMinutes = audioPartMinutes * audioMaxParts;
  return {
    name: 'audio',
    aliases: ['yta'],
    description: `Te envía el audio del primer video de YouTube (hasta ${maxMinutes / 60} h)`,
    usage: 'audio <búsqueda>',

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

      const sendLink = async (note) => {
        const description = [video.channel, video.duration].filter(Boolean).join(' · ');
        await ctx.reply.link({ url: video.url, title: video.title, description, thumbnail: video.thumbnail });
        if (note) await ctx.reply.text(note);
      };

      if (!(await downloader.isConfigured())) {
        await sendLink('Para mandarte el audio necesito tu sesión de YouTube (!ytcookies).');
        return;
      }
      const seconds = downloader.parseDuration(video.duration);
      if (!seconds) {
        await sendLink('Parece un video en vivo, así que te dejo el link.');
        return;
      }

      let download;
      try {
        download = await downloader.downloadAudio(video.url, { durationSeconds: seconds });
      } catch (err) {
        ctx.logger.error?.(err, 'Falló la descarga del audio');
        await sendLink('No pude descargar el audio, te dejo el link.');
        return;
      }
      try {
        // WhatsApp no muestra texto en los audios: el título y el link van antes, en un mensaje.
        const total = download.files.length;
        const plan = total > 1 ? ` — ${total} partes de ${audioPartMinutes / 60} h` : '';
        const cut = seconds > maxMinutes * 60 ? `\nSolo se envían las primeras ${maxMinutes / 60} horas.` : '';
        await ctx.reply.text(`🎧 *${video.title}* (${video.duration})${plan}\n${video.url}${cut}`);
        for (const file of download.files) await ctx.reply.audio(file);
        ctx.logger.info?.(`  → audio ${video.url} (${total} partes)`);
      } finally {
        await download.cleanup();
      }
    },
  };
}
