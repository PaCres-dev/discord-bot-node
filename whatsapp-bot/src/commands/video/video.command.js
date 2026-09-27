// !video <búsqueda>: busca en Dailymotion, descarga el primer resultado y lo envía como video.
import { formatDuration } from './format-duration.js';

export function createVideoCommand({ searchVideos, downloadVideo, maxMinutes }) {
  return {
    name: 'video',
    description: `Busca un video (hasta ${maxMinutes} min) y te lo envía`,
    usage: 'video <búsqueda>',

    async run(ctx) {
      const query = ctx.args;
      if (!query) {
        await ctx.reply.text(`Uso: ${ctx.prefix}${this.usage}`);
        return;
      }

      let video = null;
      try {
        [video] = await searchVideos(query);
      } catch (err) {
        ctx.logger.error?.(err, 'Falló la búsqueda de videos');
      }
      if (!video) {
        await ctx.reply.text(`No encontré videos para "${query}"`);
        return;
      }

      const label = `${video.title} (${formatDuration(video.duration)})`;
      await ctx.reply.text(`Descargando "${label}"...`);
      let download;
      try {
        download = await downloadVideo(video);
      } catch (err) {
        ctx.logger.error?.(err, 'Falló la descarga del video');
        await ctx.reply.text(`No pude descargar "${video.title}"`);
        return;
      }
      try {
        await ctx.reply.video(download.file, label);
        ctx.logger.info?.(`  → video ${video.id}`);
      } finally {
        await download.cleanup();
      }
    },
  };
}
