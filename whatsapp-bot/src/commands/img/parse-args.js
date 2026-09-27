export const MAX_IMAGES = 5;

// "3 gato" → { count: 3, query: 'gato' }. El número va primero y se limita a MAX_IMAGES.
export function parseArgs(args) {
  const match = args.match(/^(\d{1,2})\s+(.+)$/);
  if (!match) return { count: 1, query: args };
  const count = Math.min(Math.max(Number(match[1]), 1), MAX_IMAGES);
  return { count, query: match[2].trim() };
}
