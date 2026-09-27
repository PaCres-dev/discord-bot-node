// !youtube y !audio: buscan en YouTube y envían el primer resultado en partes de 5 minutos
// (por defecto 1 parte, como máximo 6 = los primeros 30 minutos). Son el mismo comando en dos
// modos: "video" envía videos y "audio" solo el audio (m4a, pesa mucho menos).
// Sin sesión de YouTube (!ytcookies), en vivo o si la descarga falla, envían el link con vista previa.
import { parseArgs } from './parse-args.js';

const MODES = {
  video: {
    name: 'youtube',
    aliases: ['yt'],
    description: (m) => `Te envía el primer video de YouTube en partes de ${m} min (o su link si no se puede bajar)`,
    noun: 'el video',
  },
  audio: {
    name: 'audio',
    aliases: ['yta'],
    description: (m) => `Te envía solo el audio del primer video de YouTube, en partes de ${m} min`,
    noun: 'el audio',
  },
};

export function createYoutubeCommand({ findFirstVideo, downloader, mode = 'video' }) {
  const { partMinutes, maxParts } = downloader;
  const m = MODES[mode];
  return {
    name: m.name,
    aliases: m.aliases,
    description: m.description(partMinutes),
    usage: `${m.name} [1-${maxParts}] <búsqueda>`,

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
        await sendLink(mode === 'audio' ? 'Para mandarte el audio necesito tu sesión de YouTube (!ytcookies).' : undefined);
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
      // Los audios de WhatsApp no llevan texto: en modo audio, el link va en este primer mensaje.
      await ctx.reply.text(
        mode === 'audio'
          ? `🎧 Descargando el audio de "${video.title}" (${video.duration})${plan}...\n${video.url}`
          : `Descargando "${video.title}" (${video.duration})${plan}...`,
      );
      let download;
      try {
        download = await downloader.download(video.url, { durationSeconds: seconds, parts, mode });
      } catch (err) {
        ctx.logger.error?.(err, `Falló la descarga de YouTube (${mode})`);
        await sendLink(`No pude descargar ${m.noun}, te dejo el link.`);
        return;
      }
      try {
        const total = download.files.length;
        for (const [i, file] of download.files.entries()) {
          if (mode === 'audio') {
            await ctx.reply.audio(file);
          } else {
            const label = total > 1 ? ` (parte ${i + 1}/${total})` : '';
            await ctx.reply.video(file, i === 0 ? `${video.title}${label}\n${video.url}` : `${video.title}${label}`);
          }
        }
        // Se pidieron más partes de las que hay (video corto) o del máximo (30 minutos).
        if (requested > parts) {
          await ctx.reply.text(
            seconds > maxParts * partMinutes * 60
              ? `Solo se envían los primeros ${maxParts * partMinutes} minutos (${maxParts} partes).`
              : `El video solo tiene ${parts} parte${parts > 1 ? 's' : ''}.`,
          );
        }
        ctx.logger.info?.(`  → ${mode} ${video.url} (${total} partes)`);
      } finally {
        await download.cleanup();
      }
    },
  };
}
