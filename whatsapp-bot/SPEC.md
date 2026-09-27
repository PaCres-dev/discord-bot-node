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
| Comandos | `!img [1-5] <texto>`, `!youtube` / `!yt <texto>`, `!ytcookies` (documento), `!video <texto>`, `!twitter` / `!x` y `!help` / `!ayuda` |
| YouTube | Con la sesión de YouTube del dueño (cookies importadas con `!ytcookies` desde un registro de `chrome://net-export`), `!youtube [1-6]` descarga el video con yt-dlp (H.264, hasta 720p) y lo envía en partes de 5 minutos: por defecto 1, como máximo 6 (los primeros 30 minutos). Sin sesión, o si falla, envía el link con vista previa. Sin cookies YouTube bloquea las descargas desde servidores (probado: yt-dlp, clientes alternativos, tokens PO, Invidious, Piped, cobalt, ssyoutube, loader.to). La API oficial no permite descargar |
| X (Twitter) | `!twitter` lee el feed "Para ti" iniciando sesión como el usuario (la API oficial no da ese feed y es paga). **Estado: implementado pero sin probar en vivo**, porque todavía no hay una cuenta para usar. Se activa con `X_USERNAME`, `X_PASSWORD` y `X_EMAIL`; sin ellas responde que no está configurado |
| Videos | `!video` busca y descarga de Dailymotion (sin API key): hasta 20 min, hasta 720p y ~90 MB. ffmpeg une los fragmentos localmente |
| Permisos | Solo mis propios mensajes (`fromMe`) y solo en el chat "Mensaje a mí mismo" (`@s.whatsapp.net` o `@lid`); ignora el resto. Es una política única en `bot/access.js` que aplica a **todos** los comandos |
| Arquitectura | Screaming architecture: carpetas por funcionalidad (`commands/img`, `commands/help`), un router común y WhatsApp aislado en `whatsapp/` |
| Estructura | El bot de Discord sigue en la raíz, sin cambios. El de WhatsApp va en `/whatsapp-bot` con su propio `package.json` |
| Ejecución hoy | Dentro de la sesión de Claude Code; funciona mientras la sesión esté activa |
| Nube (después) | `Dockerfile` y README para desplegar en Railway, Render o un VPS |

## Comportamiento

- `!img perro salchicha` → busca, elige una imagen al azar del top 10 y la envía al mismo chat con el caption `perro salchicha`.
- `!img 3 perro salchicha` → envía 3 imágenes distintas del top 10. Un número mayor a 5 se limita a 5. Si solo consigue algunas, avisa `Solo encontré X de N`.
- `!img` sin texto → responde `Uso: !img [1-5] <búsqueda>`.
- `!youtube gatos` (o `!yt`, `!YouTube`) → busca en YouTube. Con sesión de YouTube guardada: responde `Descargando "<título>" (m:ss)...` y envía el video. Si dura más de 5 minutos, se envía en partes de 5 minutos numeradas (`<título> (parte 1/3)`; la primera lleva el link): `!youtube gatos` = 1 parte (los primeros 5 minutos), `!youtube 3 gatos` = hasta 3 partes, máximo 6 (los primeros 30 minutos). Si se piden más partes de las que tiene, avisa `El video solo tiene N partes.`; si pasa de 30 minutos, avisa `Solo se envían los primeros 30 minutos (6 partes).`. Sin sesión, envía el link con vista previa (título, canal · duración y miniatura). En vivo: link + aviso. Si la descarga falla: link + `No pude descargar el video, te dejo el link.` Los archivos temporales se borran siempre.
- `!ytcookies` como texto de un **documento** (el registro de `chrome://net-export` grabado con "Include cookies and credentials" mientras se usa `m.youtube.com` con sesión iniciada) → extrae solo las cookies de `youtube.com`, verifica que haya sesión y las guarda en `AUTH_DIR/youtube-cookies.txt` (permisos 600). Responde `Listo: guardé tu sesión de YouTube (N cookies). Ahora borra el mensaje con el archivo "para todos".` o explica qué faltó. Máx. 150 MB.
- `!video gatos` → responde `Descargando "<título> (m:ss)"...`, busca en Dailymotion el primer video de hasta 20 min, lo descarga (la mejor calidad hasta 720p que pese menos de ~90 MB) y lo envía como video con el título de caption. Si falla, responde `No pude descargar "<título>"`; sin resultados, `No encontré videos para "<texto>"`. El archivo temporal se borra siempre.
- `!twitter` (o `!x`) → envía los 10 tweets más recientes del feed "Para ti" que todavía no se hayan enviado, uno por mensaje: `🔁 @quien retuiteó` (si es retweet), `*Nombre* (@usuario) · ↩️ respuesta a @otro` (si es respuesta), el texto y el link. Si tiene fotos, la primera lleva el texto y las demás van solas. Excluye publicidad; incluye retweets y respuestas. Si en la primera página no hay 10 nuevos, sigue leyendo hasta 5 páginas. Un tweet se marca como enviado recién después de enviarlo. Sin configurar → `!twitter todavía no está configurado: faltan X_USERNAME, X_PASSWORD y X_EMAIL.`; si X falla → `No pude leer tu feed de X...`; sin nuevos → `No hay tweets nuevos en tu feed.`
- `!help` o `!ayuda` → lista los comandos disponibles con su uso (se genera solo a partir del registro).
- Si un comando falla inesperadamente → responde `Hubo un error con !<comando>` y el bot sigue funcionando.
- Varios comandos seguidos → se atienden de a uno, en orden, sin mezclar respuestas.
- Sin resultados, o 5 descargas fallidas → responde `No encontré imágenes para "<texto>"`.
- Cualquier otro mensaje, o un comando que no existe (`!nada`) → lo ignora.
- El nombre del comando no distingue mayúsculas: `!IMG gato` = `!img gato`.
- Mensajes de otras personas, o míos en otros chats o grupos → los ignora, sea cual sea el comando.
- Mensajes anteriores al arranque (historial que WhatsApp reenvía al conectar) → los ignora.
- No entra en bucles: ignora los mensajes que envió el propio bot.

## Estructura de archivos

```
whatsapp-bot/
├── SPEC.md, README.md, HANDOFF.md
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
    │   ├── youtube/          # !youtube / !yt: descarga el video (o link con vista previa)
    │   ├── ytcookies/        # !ytcookies: importa la sesión de YouTube
    │   ├── video/            # !video: descarga y envía un video
    │   ├── twitter/          # !twitter / !x: feed "Para ti" de X
    │   └── help/             # !help: help.command.js, help.test.js
    ├── bot/                  # motor común a todos los comandos
    │   ├── router.js         # "!nombre args" → comando; anti-bucle, historial, errores, orden
    │   └── access.js         # política de acceso única
    ├── image-search/
    │   └── duckduckgo.js     # búsqueda y descarga de imágenes
    ├── youtube-search/
    │   └── youtube.js        # búsqueda en YouTube (sin API key) y miniatura
    ├── youtube-download/
    │   ├── cookies.js        # cookies de YouTube desde chrome://net-export → cookies.txt
    │   └── ytdlp.js          # descarga con yt-dlp (H.264 ≤ 720p) y división en partes de 5 min (máx. 6)
    ├── video-search/
    │   └── dailymotion.js    # búsqueda y descarga HLS de Dailymotion → MP4 con ffmpeg
    ├── x-feed/               # todo lo de X, para ajustarlo en un solo lugar
    │   ├── x.js              # sesión, páginas, filtros, memoria de enviados, fotos
    │   ├── home-timeline.js  # consulta HomeTimeline (queryId/features auto-actualizados) y lectura de la respuesta
    │   ├── session.js        # inicio de sesión (librería @the-convocation/twitter-scraper) y sesión guardada
    │   └── seen-store.js     # IDs de tweets ya enviados
    └── whatsapp/             # todo lo de Baileys queda acá
        ├── connection.js     # sesión, pairing code, reconexión
        └── incoming.js       # mensaje de Baileys → { id, chatId, fromMe, isSelfChat, text, timestamp, attachment }
```

Cada `*.test.js` vive junto al código que prueba. La sesión de WhatsApp se guarda en `whatsapp-bot/auth/` (gitignored), así que reiniciar el bot no obliga a re-vincular.

## Arquitectura

Un mensaje recorre siempre el mismo camino:

1. `whatsapp/connection.js` recibe el mensaje de Baileys y `whatsapp/incoming.js` lo convierte en un objeto simple.
2. `bot/router.js` descarta, en este orden: mensajes enviados por el propio bot, historial viejo y todo lo que `bot/access.js` no permita. Recién después busca el comando.
3. El comando recibe un `ctx` (con `ctx.args` y, si el mensaje era un documento, `ctx.attachment` con `download()`) y responde con `ctx.reply.text(texto)`, `ctx.reply.image(buffer, caption)`, `ctx.reply.video(archivoMp4, caption)` o `ctx.reply.link({ url, title, description, thumbnail })`. No conoce WhatsApp.

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
- Los servicios que descargan archivos solo aceptan sus propios dominios por HTTPS (ej. `video-search/dailymotion.js`: `dailymotion.com` y `dmcdn.net`), y los archivos temporales se borran siempre después de enviarlos.
- **X:** la contraseña solo se usa para el primer inicio de sesión y nunca se escribe en disco ni en los registros. Se guarda únicamente la sesión (`auth_token` y `ct0`) en `AUTH_DIR/x-session.json` con permisos 600, junto con `x-seen.json` (IDs enviados, máx. 5000). La consulta del feed se actualiza desde un listado público (`fa0311/TwitterInternalAPIDocument`) solo si pasa una validación estricta (queryId simple y features booleanos); si no, se usa la de respaldo. Las fotos solo se bajan de `pbs.twimg.com` por HTTPS.
- **YouTube:** las cookies del registro de Chrome se filtran a solo `youtube.com` (el resto del registro se descarta en memoria) y se guardan con permisos 600 en `AUTH_DIR`. El archivo recibido nunca se escribe en disco. yt-dlp solo recibe links `https://www.youtube.com/watch?v=<id>` validados, después de `--`.
- Los programas externos (ffmpeg, yt-dlp) se ejecutan con una lista de argumentos, nunca a través de una shell.
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
| `X_USERNAME`, `X_PASSWORD`, `X_EMAIL` | Solo para `!twitter`, la primera vez | Cuenta de X. Después alcanza con la sesión guardada en `AUTH_DIR` |
| `YTDLP_PATH` | No (default `yt-dlp`) | Ruta a yt-dlp para `!youtube`. El `Dockerfile` ya lo instala (`yt-dlp[default]`) |
| `FFMPEG_PATH` | No (default `ffmpeg`) | Ruta a ffmpeg, necesario para `!video`. El `Dockerfile` ya lo instala |

## Red necesaria

- `web.whatsapp.com`, `*.whatsapp.net`: conexión a WhatsApp y subida de media
- `duckduckgo.com`: búsqueda
- `external-content.duckduckgo.com`: descarga de imágenes
- `www.youtube.com`, `i.ytimg.com`: búsqueda y miniatura para `!youtube`
- `api.dailymotion.com`, `www.dailymotion.com`, `cdndirector.dailymotion.com`, `*.dmcdn.net`: búsqueda y descarga para `!video`
- `x.com`, `api.x.com`, `pbs.twimg.com`, `raw.githubusercontent.com`: inicio de sesión, feed y fotos para `!twitter`, y actualización de la consulta del feed

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
11. **Nombres de comando sin distinguir mayúsculas.**
12. **`!youtube` (link con vista previa) y `!video` (descarga desde Dailymotion).**
13. **`!twitter`:** implementado y testeado sin red; falta la prueba real con una cuenta.
15. **Tokens PO (probado, no activado):** se probó `bgutil-ytdlp-pot-provider` 2.0.0 como servicio aislado (`scripts/pot-service/`: usuario de sistema `potsvc` sin acceso a `auth/` ni a `/root`, archivos de solo lectura, entorno vacío, sin nuevos privilegios, solo en `127.0.0.1`, salida por `youtube-download/allowlist-proxy.js`). El aislamiento se verificó incluso con el módulo nativo `canvas` cargado, y no hubo conexiones fuera de YouTube/Google. Los tokens se generan, pero YouTube igual responde 403 en videos con licencia desde la IP de este servidor, así que no se activó y se desinstaló. Los scripts quedan para reintentar en otro host (`install.sh`, `run.sh`, `uninstall.sh`).
16. **YouTube en partes:** `!youtube [1-6]` envía hasta 6 partes de 5 minutos (máx. 30 min). Videos de hasta 90 min se bajan enteros y se recortan localmente con ffmpeg (1 h ≈ 46 s); más largos, se baja solo el tramo pedido (mucho más lento, pero sin ocupar tanto disco). Probado en vivo: 6:09 en 2 partes y 15 min de un video de 1 h en 3 partes de ~35 MB.
14. **Descarga de YouTube:** `!ytcookies` importa la sesión desde `chrome://net-export` (sin instalar apps) y `!youtube` descarga con yt-dlp. Probado en vivo: un video de 6 min en 720p H.264 (47 MB) en 9 s.

## Riesgos conocidos

- Baileys no es oficial. Con uso personal y bajo volumen el riesgo de bloqueo es bajo, pero existe.
- DuckDuckGo puede cambiar su endpoint interno. Todo está aislado en `image-search/duckduckgo.js` para arreglarlo fácil.
- YouTube y Dailymotion pueden cambiar su HTML o su API. Cada uno está aislado en su archivo (`youtube-search/`, `video-search/`).
- `!video` tarda unos segundos por minuto de video, y mientras tanto los demás comandos esperan su turno (el router atiende de a uno).
- Descargar de YouTube va contra sus términos y la cuenta cuyas cookies se usan puede ser marcada. Las cookies vencen cada tanto: se repite `!ytcookies`. Algunos videos (ej. Vevo) pueden no descargarse; en ese caso llega el link. La IP del servidor recibe límites (429) si se hacen muchos pedidos seguidos.
- `!twitter` va contra las reglas de X: la cuenta usada puede ser bloqueada o suspendida. Se recomienda una cuenta secundaria.
- X puede pedir verificar el inicio de sesión (código por email o captcha) al entrar desde un servidor; sin poder recibir códigos, el inicio de sesión fallaría.
- X cambia seguido su API interna. Lo más probable es que la primera prueba real requiera ajustes, todos dentro de `x-feed/`. El generador de `x-client-transaction-id` hoy no funciona con la web nueva de X; el pedido se envía sin ese encabezado.
- Aquí el bot vive mientras esta sesión esté activa; para 24/7 hay que desplegarlo en la nube (paso 6).
