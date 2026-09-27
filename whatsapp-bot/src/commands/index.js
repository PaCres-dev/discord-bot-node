// Registro de comandos. Para agregar uno: crea su carpeta en commands/ y súmalo a esta lista.
// Cada comando: { name, aliases?, description, usage, run(ctx) }.
import { createImgCommand } from './img/img.command.js';
import { helpCommand } from './help/help.command.js';

export function createCommands({ imageSearch }) {
  return [createImgCommand({ getImages: imageSearch.getRandomImages }), helpCommand];
}
