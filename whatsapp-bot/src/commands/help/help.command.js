// !help: lista los comandos disponibles a partir del registro (no se mantiene a mano).
export const helpCommand = {
  name: 'help',
  aliases: ['ayuda'],
  description: 'Muestra esta lista',
  usage: 'help',

  async run(ctx) {
    const lines = ctx.commands.map((c) => `${ctx.prefix}${c.usage} — ${c.description}`);
    await ctx.reply.text(['Comandos disponibles:', ...lines].join('\n'));
  },
};
