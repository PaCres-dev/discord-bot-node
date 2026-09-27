// Prueba contra DuckDuckGo real (con red): npm run test:search -- gato
import { writeFile } from 'node:fs/promises';
import '../src/proxy.js';
import { getRandomImages, searchImages } from '../src/image-search/duckduckgo.js';

const query = process.argv.slice(2).join(' ') || 'gato';

const urls = await searchImages(query);
console.log(`${urls.length} resultados para "${query}":`);
urls.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));

const [image] = await getRandomImages(query);
if (!image) {
  console.log(`No encontré imágenes para "${query}"`);
  process.exit(1);
}
const file = 'test-image.jpg';
await writeFile(file, image.buffer);
console.log(`Descargada ${image.url} (${image.buffer.length} bytes) → ${file}`);
