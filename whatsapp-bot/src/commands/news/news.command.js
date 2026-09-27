// !noticias [1-5] [sección] <tema>: noticias de la última semana (Google News, en inglés),
// una por mensaje, con resumen. No repite noticias ya enviadas.
export const MAX_NEWS = 5;

// "3 tech rust" → { count: 3, section: 'tech', query: 'rust' }.
export function parseNewsArgs(args, resolveSection) {
  const words = args.split(/\s+/).filter(Boolean);
  let count = 1;
  if (words.length > 1 && /^\d{1,2}$/.test(words[0])) count = Math.min(Math.max(Number(words.shift()), 1), MAX_NEWS);
  const section = words.length ? resolveSection(words[0]) : null;
  if (section) words.shift();
  return { count, section, query: words.join(' ') };
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// 📰 *Título*
// Medio · 27 sep
// Resumen
// link
export function formatNews(news) {
  const date = news.date ? `${news.date.getUTCDate()} ${MONTHS[news.date.getUTCMonth()]}` : '';
  const lines = [`📰 *${news.title}*`, [news.source, date].filter(Boolean).join(' · ')];
  if (news.summary) lines.push(news.summary);
  lines.push(news.url);
  return lines.filter(Boolean).join('\n');
}

export function createNewsCommand({ feed, sections, resolveSection }) {
  const sectionList = Object.keys(sections).join(', ');
  return {
    name: 'noticias',
    aliases: ['news'],
    description: 'Noticias de la última semana sobre un tema, con resumen',
    usage: `noticias [1-${MAX_NEWS}] [sección] <tema>`,

    async run(ctx) {
      const { count, section, query } = parseNewsArgs(ctx.args, resolveSection);
      if (!query && !section) {
        await ctx.reply.text(`Uso: ${ctx.prefix}${this.usage}\nSecciones: ${sectionList}`);
        return;
      }

      let items;
      try {
        items = await feed.getNews({ query, section, count });
      } catch (err) {
        ctx.logger.error?.(err, 'Falló la búsqueda de noticias');
        await ctx.reply.text('No pude traer noticias ahora. Prueba de nuevo en un rato.');
        return;
      }
      const about = [section && `en ${section}`, query && `sobre "${query}"`].filter(Boolean).join(' ');
      if (items.length === 0) {
        await ctx.reply.text(`No hay noticias nuevas ${about} de la última semana.`);
        return;
      }
      for (const news of items) {
        await ctx.reply.text(formatNews(news));
        await feed.markSent(news);
      }
      if (items.length < count) await ctx.reply.text(`Solo encontré ${items.length} de ${count} noticias nuevas ${about}.`);
      ctx.logger.info?.(`  → ${items.length} noticias`);
    },
  };
}
