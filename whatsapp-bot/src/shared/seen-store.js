// Recuerda los IDs ya enviados (tweets, noticias) en AUTH_DIR, para no repetirlos entre reinicios.
import { readFile, writeFile } from 'node:fs/promises';

export const MAX_SEEN = 5000;

export async function createSeenStore(file, { max = MAX_SEEN } = {}) {
  let ids = [];
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (Array.isArray(data)) ids = data.filter((id) => typeof id === 'string');
  } catch {
    // Primera vez o archivo dañado: se empieza vacío.
  }
  const set = new Set(ids);

  return {
    has: (id) => set.has(id),
    async add(newIds) {
      for (const id of newIds) {
        if (set.has(id)) continue;
        set.add(id);
        ids.push(id);
      }
      // Guarda solo los más recientes para que el archivo no crezca sin límite.
      if (ids.length > max) {
        for (const old of ids.splice(0, ids.length - max)) set.delete(old);
      }
      await writeFile(file, JSON.stringify(ids), { mode: 0o600 });
    },
  };
}
