// "3 naruto" → { parts: 3, query: 'naruto' }. El número va primero; sin número, 1 parte.
// El máximo de partes lo aplica el descargador.
export function parseArgs(args) {
  const match = args.match(/^(\d{1,2})\s+(.+)$/);
  if (!match) return { parts: 1, query: args };
  return { parts: Math.max(1, Number(match[1])), query: match[2].trim() };
}
