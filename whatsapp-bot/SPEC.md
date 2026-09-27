# Bot de WhatsApp — descargador de imágenes

## Objetivo

Un bot mínimo, vinculado a mi WhatsApp personal. Cuando le escribo `!img <texto>`, busca imágenes en internet y me envía una.
Está organizado por comandos para poder sumar funcionalidades nuevas sin tocar ni romper las existentes.
Vive en este repo junto al bot de Discord y es totalmente independiente de él.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Número | Mi número personal, vinculado como "dispositivo vinculado" |
| Librería | [Baileys](https://github.com/WhiskeySockets/Baileys) (`@whiskeysockets/baileys`): WebSocket directo, sin navegador ni Chromium |
| Vinculación | Código de 8 dígitos (pairing code) que se escribe en *Dispositivos vinculados → Vincular con número de teléfono* |
| Número de teléfono | Variable de entorno `PHONE_NUMBER` al ejecutar; nunca se guarda en el repo |
| Fuente de imágenes | Búsqueda de imágenes de DuckDuckGo, sin API keys |
| Descarga | A través del proxy de imágenes de DuckDuckGo (`external-content.duckduckgo.com`), así no hay que acceder a dominios arbitrarios |
| SafeSearch | Desactivado |
| Selección | Una imagen al azar del top 10; si falla la descarga, se prueba otra (máx. 5 intentos) |
| Comandos | `!img [1-5] <texto>` (cantidad opcional, default 1, máximo 5) y `!help` / `!ayuda` |
| Permisos | Solo mis propios mensajes (`fromMe`) y solo en el chat "Mensaje a mí mismo" (`@s.whatsapp.net` o `@lid`); ignora el resto. Es una política única en `bot/access.js` que aplica a **todos** los comandos |
| Arquitectura | Screaming architecture: carpetas por funcionalidad (`commands/img`, `commands/help`), un router común y WhatsApp aislado en `whatsapp/` |
| Estructura | El bot de Discord sigue en la raíz, sin cambios. El de WhatsApp va en `/whatsapp-bot` con su propio `package.json` |
| Ejecución hoy | Dentro de la sesión de Claude Code; funciona mientras la sesión esté activa |
| Nube (después) | `Dockerfile` y README para desplegar en Railway, Render o un VPS |

## Comportamiento

- `!img perro salchicha` → busca, elige una imagen al azar del top 10 y la envía al mismo chat con el caption `perro salchicha`.
- `!img 3 perro salchicha` → envía 3 imágenes distintas del top 10. Un número mayor a 5 se limita a 5. Si solo consigue algunas, avisa `Solo encontré X de N`.
- `!img` sin texto → responde `Uso: !img [1-5] <búsqueda>`.
- `!help` o `!ayuda` → lista los comandos disponibles con su uso (se genera solo a partir del registro).
- Si un comando falla inesperadamente → responde `Hubo un error con !<comando>` y el bot sigue funcionando.
- Varios comandos seguidos → se atienden de a uno, en orden, sin mezclar respuestas.
- Sin resultados, o 5 descargas fallidas → responde `No encontré imágenes para "<texto>"`.
- Cualquier otro mensaje, o un comando que no existe (`!nada`) → lo ignora.
- Mensajes de otras personas, o míos en otros chats o grupos → los ignora, sea cual sea el comando.
- Mensajes anteriores al arranque (historial que WhatsApp reenvía al conectar) → los ignora.
- No entra en bucles: ignora los mensajes que envió el propio bot.

## Estructura de archivos

```
whatsapp-bot/
├── SPEC.md, README.md
├── package.json              # dependencias propias (Node >= 20, ESM)
├── Dockerfile, .dockerignore
├── .gitignore                # ignora auth/ y node_modules/
├── scripts/
│   └── search-images.js      # npm run test:search -- gato (DuckDuckGo real, con red)
└── src/
    ├── main.js               # punto de entrada: une config + comandos + WhatsApp
    ├── config.js             # única lectura de variables de entorno, validadas
    ├── proxy.js              # HTTPS_PROXY para fetch, WebSocket y subida de media
    ├── commands/             # ← lo que el bot sabe hacer
    │   ├── index.js          # registro: la lista de comandos
    │   ├── img/              # !img: img.command.js, parse-args.js, img.test.js
    │   └── help/             # !help: help.command.js, help.test.js
    ├── bot/                  # motor común a todos los comandos
    │   ├── router.js         # "!nombre args" → comando; anti-bucle, historial, errores, orden
    │   └── access.js         # política de acceso única
    ├── image-search/
    │   └── duckduckgo.js     # búsqueda y descarga de imágenes
    └── whatsapp/             # todo lo de Baileys queda acá
        ├── connection.js     # sesión, pairing code, reconexión
        └── incoming.js       # mensaje de Baileys → { id, chatId, fromMe, isSelfChat, text, timestamp }
```

Cada `*.test.js` vive junto al código que prueba. La sesión de WhatsApp se guarda en `whatsapp-bot/auth/` (gitignored), así que reiniciar el bot no obliga a re-vincular.

## Arquitectura

Un mensaje recorre siempre el mismo camino:

1. `whatsapp/connection.js` recibe el mensaje de Baileys y `whatsapp/incoming.js` lo convierte en un objeto simple.
2. `bot/router.js` descarta, en este orden: mensajes enviados por el propio bot, historial viejo y todo lo que `bot/access.js` no permita. Recién después busca el comando.
3. El comando recibe un `ctx` y responde con `ctx.reply.text(texto)` o `ctx.reply.image(buffer, caption)`. No conoce WhatsApp.

### Contrato de un comando

```js
{
  name: 'img',                  // minúsculas, sin espacios, único
  aliases: ['imagen'],          // opcional, también únicos
  description: 'Busca imágenes y te las envía',
  usage: 'img [1-5] <búsqueda>', // empieza con el nombre; lo usa !help
  async run(ctx) { ... },       // ctx: { args, prefix, logger, commands, reply }
}
```

### Agregar un comando nuevo

1. Crear `src/commands/<nombre>/<nombre>.command.js` que exporte un objeto con el contrato de arriba (o una función `create...Command(deps)` si necesita servicios externos).
2. Sumarlo a la lista en `src/commands/index.js`.
3. Agregar `src/commands/<nombre>/<nombre>.test.js`.
4. `npm test`. El test de contrato (`commands.contract.test.js`) verifica nombre, descripción, uso, `run` y que no haya duplicados.

No hace falta tocar `bot/` ni `whatsapp/`. Si el comando usa un servicio externo nuevo, va en su propia carpeta (como `image-search/`) y se inyecta desde `commands/index.js`.

### Reglas de seguridad (no negociables)

- La política de acceso vive **solo** en `bot/access.js` y el router la aplica antes de ejecutar cualquier comando. Los comandos no deciden quién los usa: el test de contrato falla si un comando define `access`.
- Habilitar un comando para otras personas o chats sería una decisión explícita que primero se actualiza en este spec y en sus tests.
- `config.js` es el único que lee la configuración, salvo `proxy.js` con las variables estándar de proxy. El número de teléfono y la sesión nunca se commitean.

## Tests

- `npm test`: tests sin red ni WhatsApp (`node:test`), junto a cada módulo. Incluyen un test de integración (`bot/bot.integration.test.js`) que pasa mensajes con forma de Baileys por el router y los comandos reales.
- GitHub Actions (`.github/workflows/whatsapp-bot.yml`) corre `npm test` con Node 20 y 22 en cada push o PR que toque `whatsapp-bot/`.
- `npm run test:search -- gato`: prueba manual contra DuckDuckGo real.

## Configuración (variables de entorno)

| Variable | Obligatoria | Uso |
|---|---|---|
| `PHONE_NUMBER` | Solo la primera vez | Número con código de país y sin `+` (ej. `5491122334455`), para generar el código de vinculación |
| `AUTH_DIR` | No (default `./auth`) | Dónde se guarda la sesión; en la nube apunta a un volumen persistente |
| `HTTPS_PROXY` | No | Si existe, la conexión y las descargas pasan por ese proxy (necesario en el entorno de Claude Code) |
| `LOG_LEVEL` | No (default `warn`) | Nivel de logs de Baileys |

## Red necesaria

- `web.whatsapp.com`, `*.whatsapp.net`: conexión a WhatsApp y subida de media
- `duckduckgo.com`: búsqueda
- `external-content.duckduckgo.com`: descarga de imágenes

## Plan de desarrollo

1. **Esqueleto:** carpeta `whatsapp-bot/`, `package.json`, `.gitignore` y la instalación de dependencias (`@whiskeysockets/baileys`, `pino`, `https-proxy-agent`, `undici`).
2. **Búsqueda (`images.js`):** obtener el token `vqd` de DuckDuckGo, llamar a `i.js` con SafeSearch desactivado, tomar el top 10, elegir al azar y descargar vía `external-content`, reintentando hasta 5 veces. Lo pruebo aislado con un script (`npm run test:search -- gato`).
3. **Conexión (`index.js`):** `useMultiFileAuthState`, soporte de proxy, pairing code impreso en consola si la sesión no existe, y reconexión automática salvo al cerrar sesión.
4. **Comando:** escuchar `messages.upsert`, filtrar `fromMe` y el prefijo `!img`, buscar y enviar la imagen con `sendMessage({ image, caption })`.
5. **Prueba real:** verificar la red, correr el bot con tu número, pasarte el código de 8 dígitos, que lo vincules y lo pruebes con `!img gato` desde "Mensaje a mí mismo".
6. **Nube:** `Dockerfile` y README con los pasos de deploy (Railway con volumen en `/app/auth`).
7. **Commit y push** a `claude/whatsapp-image-downloader-bot-ilvbz2`.
8. **Varias imágenes y solo self-chat:** `!img [1-5] <texto>` y respuesta únicamente en "Mensaje a mí mismo".
9. **Tests** sin red con `node:test`.
10. **Arquitectura por comandos:** router, política de acceso única, registro de comandos, `!help`, tests de contrato y CI en GitHub Actions.

## Riesgos conocidos

- Baileys no es oficial. Con uso personal y bajo volumen el riesgo de bloqueo es bajo, pero existe.
- DuckDuckGo puede cambiar su endpoint interno. Todo está aislado en `image-search/duckduckgo.js` para arreglarlo fácil.
- Aquí el bot vive mientras esta sesión esté activa; para 24/7 hay que desplegarlo en la nube (paso 6).
