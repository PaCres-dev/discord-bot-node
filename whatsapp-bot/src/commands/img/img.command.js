// !img [1-5] <búsqueda>: busca imágenes y las envía al chat.
import { MAX_IMAGES, parseArgs } from './parse-args.js';

export function createImgCommand({ getImages }) {
  return {
    name: 'img',
    description: 'Busca imágenes y te las envía',
    usage: `img [1-${MAX_IMAGES}] <búsqueda>`,

    async run(ctx) {
      const { count, query } = parseArgs(ctx.args);
      if (!query) {
        await ctx.reply.text(`Uso: ${ctx.prefix}${this.usage}`);
        return;
      }

      let images = [];
      try {
        images = await getImages(query, count, ctx.logger);
      } catch (err) {
        ctx.logger.error?.(err, 'Falló la búsqueda');
      }
      if (images.length === 0) {
        await ctx.reply.text(`No encontré imágenes para "${query}"`);
        return;
      }
      for (const image of images) {
        await ctx.reply.image(image.buffer, query);
        ctx.logger.info?.(`  → enviada ${image.url}`);
      }
      if (images.length < count) {
        await ctx.reply.text(`Solo encontré ${images.length} de ${count} para "${query}"`);
      }
    },
  };
}
