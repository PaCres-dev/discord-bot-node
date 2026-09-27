// !youtube [partes] <búsqueda>: busca en YouTube y envía el primer video.
// Con sesión de YouTube guardada (!ytcookies) lo descarga y lo envía en partes de 5 minutos
// (por defecto 1 parte, como máximo 6 = los primeros 30 minutos). Sin sesión, en vivo
// o si la descarga falla, envía el link con vista previa.
import { parseArgs } from './parse-args.js';

export function createYoutubeCommand({ findFirstVideo, downloader }) {
  const { partMinutes, maxParts } = downloader;
  return {
    name: 'youtube',
    aliases: ['yt'],
    description: `Te envía el primer video de YouTube en partes de ${partMinutes} min (o su link si no se puede bajar)`,
    usage: `youtube [1-${maxParts}] <búsqueda>`,

    async run(ctx) {
      const { parts: requested, query } = parseArgs(ctx.args);
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
        await sendLink();
        ctx.logger.info?.(`  → link ${video.url}`);
        return;
      }
      const seconds = downloader.parseDuration(video.duration);
      if (!seconds) {
        await sendLink('Parece un video en vivo, así que te dejo el link.');
        return;
      }

      const parts = downloader.countParts(seconds, requested);
      const plan = parts > 1 ? ` en ${parts} partes de ${partMinutes} min` : '';
      await ctx.reply.text(`Descargando "${video.title}" (${video.duration})${plan}...`);
      let download;
      try {
        download = await downloader.download(video.url, { durationSeconds: seconds, parts });
      } catch (err) {
        ctx.logger.error?.(err, 'Falló la descarga de YouTube');
        await sendLink('No pude descargar el video, te dejo el link.');
        return;
      }
      try {
        const total = download.files.length;
        for (const [i, file] of download.files.entries()) {
          const label = total > 1 ? ` (parte ${i + 1}/${total})` : '';
          const caption = i === 0 ? `${video.title}${label}\n${video.url}` : `${video.title}${label}`;
          await ctx.reply.video(file, caption);
        }
        // Se pidieron más partes de las que hay (video corto) o del máximo (30 minutos).
        if (requested > parts) {
          await ctx.reply.text(
            seconds > maxParts * partMinutes * 60
              ? `Solo se envían los primeros ${maxParts * partMinutes} minutos (${maxParts} partes).`
              : `El video solo tiene ${parts} parte${parts > 1 ? 's' : ''}.`,
          );
        }
        ctx.logger.info?.(`  → video ${video.url} (${total} partes)`);
      } finally {
        await download.cleanup();
      }
    },
  };
}
