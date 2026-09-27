# Handoff: correr el bot en una sesión nueva de Claude Code

## Para pegar en una sesión nueva

> Estoy en el repo PaCres-dev/discord-bot-node. Lee `whatsapp-bot/HANDOFF.md` en la rama
> `claude/whatsapp-image-downloader-bot-ilvbz2` y seguilo para volver a correr el bot de WhatsApp.
> No puedo hacer nada fuera de Claude Code ni de WhatsApp. Pedime el número recién cuando vayas a arrancarlo.

## Estado

- Código en la rama **`claude/whatsapp-image-downloader-bot-ilvbz2`**, sin mergear a `master`. Todo el bot está en `whatsapp-bot/`.
- Qué hace y cómo está organizado: [SPEC.md](SPEC.md). Uso y deploy: [README.md](README.md).
- Comandos: `!img [1-5] <texto>`, `!youtube` / `!yt <texto>` (descarga con sesión de YouTube; si no, link), `!ytcookies` (importa esa sesión), `!video <texto>` (descarga de Dailymotion), `!twitter` / `!x` (sin configurar) y `!help`.
- Solo responde a los mensajes del dueño en "Mensaje a mí mismo".

## Qué se pierde entre sesiones

El contenedor de cada sesión es temporal. Al cerrarse se pierden:
- **La vinculación de WhatsApp** (`whatsapp-bot/auth/`, fuera del repo a propósito): hay que **vincular de nuevo** con un código de 8 dígitos.
- **ffmpeg** y **yt-dlp** (para `!video` y `!youtube`): hay que reinstalarlos.
- **La sesión de YouTube** (`auth/youtube-cookies.txt`): el dueño repite `!ytcookies` (pasos en el README).
- **Los tweets ya enviados** por `!twitter` (`auth/x-seen.json`), si alguna vez se activa.

## Pasos (los hace Claude)

1. **Rama:**
   ```bash
   git fetch origin claude/whatsapp-image-downloader-bot-ilvbz2
   git checkout claude/whatsapp-image-downloader-bot-ilvbz2
   ```
2. **Red:** comprobar con curl que se llega a `web.whatsapp.com`, `mmg.whatsapp.net`, `duckduckgo.com`,
   `external-content.duckduckgo.com`, `www.youtube.com`, `api.dailymotion.com` y `x.com`.
   (`g.whatsapp.net` puede fallar y no importa.)
3. **Dependencias:**
   ```bash
   cd whatsapp-bot
   npm ci
   apt-get update && apt-get install -y ffmpeg   # para !video y !youtube
   python3 -m venv <scratchpad>/venv && <scratchpad>/venv/bin/pip install "yt-dlp[default]"   # para !youtube
   ```
   No usar `ffmpeg-static` de npm: su binario se cae en este entorno.
4. **Tests:** `npm test`. Tienen que pasar todos, y no usan red.
5. **Arrancar en segundo plano** con el número que da el dueño (código de país, sin `+`):
   ```bash
   PHONE_NUMBER=<numero> YTDLP_PATH=<scratchpad>/venv/bin/yt-dlp LOG_LEVEL=warn node src/main.js > <scratchpad>/bot.log 2>&1
   ```
   Usar `run_in_background`. Imprime `Código de vinculación: XXXX-XXXX`. Pasárselo al dueño, que lo escribe en
   **WhatsApp → Dispositivos vinculados → Vincular un dispositivo → Vincular con número de teléfono**.
   El código vence en 1–2 minutos; si vence, reiniciar el bot para generar otro.
6. Tras vincular, WhatsApp corta una vez con `515` y el bot se reconecta solo. Cuando aparece
   `Conectado a WhatsApp`, el dueño prueba `!help` y `!img gato` desde "Mensaje a mí mismo".
7. **Apagar:** matar el proceso `node src/main.js` (buscarlo con `pgrep -f "^node src/main.js"`). No usar
   `pkill -f` con un patrón que también coincida con el propio comando de la shell.

## Cuidados

- **Nunca commitear** `whatsapp-bot/auth/`, el número de teléfono, el identificador `@lid` ni credenciales de X.
- Commits y push solo a `claude/whatsapp-image-downloader-bot-ilvbz2`; sin PR salvo que lo pida el dueño.
- CI: GitHub Actions (`.github/workflows/whatsapp-bot.yml`) corre `npm test` con Node 20 y 22.
- El bot vive solo mientras la sesión esté activa. Para tenerlo 24/7 hay que desplegarlo en Railway (ver README),
  y eso requiere que el dueño entre a Railway desde algún navegador.

## Pendientes y decisiones ya tomadas

- **YouTube:** descarga solo con la sesión del dueño importada con `!ytcookies` (desde `chrome://net-export`, sin apps).
  No hace falta el servidor de tokens PO. Si YouTube responde 429 (límite por IP), esperar unos minutos.
- **`!twitter`:** implementado y testeado sin red, **nunca probado contra X**. Se activa con `X_USERNAME`, `X_PASSWORD`
  y `X_EMAIL` (conviene una cuenta secundaria). Es probable que la primera prueba requiera ajustes en `src/x-feed/`;
  los riesgos están en el SPEC.
