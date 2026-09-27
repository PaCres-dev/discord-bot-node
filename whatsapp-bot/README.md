# Bot de WhatsApp

Bot mínimo vinculado a tu WhatsApp personal. En el chat "Mensaje a mí mismo":

- `!img gato` → una imagen al azar del top 10 de DuckDuckGo.
- `!img 3 gato` → 3 imágenes distintas (máximo 5).
- `!youtube gatos` (o `!yt`) → link del primer video de YouTube, con vista previa.
- `!video gatos` → descarga el primer video de Dailymotion (hasta 20 min, 720p) y te lo envía.
- `!help` (o `!ayuda`) → lista de comandos.

Solo responde a tus propios mensajes y solo en ese chat. Detalles en [SPEC.md](SPEC.md).

## Correrlo localmente

Requiere Node 20 o superior y `ffmpeg` instalado (para `!video`; el `Dockerfile` ya lo incluye).

```bash
cd whatsapp-bot
npm install
npm test                              # tests sin red
npm run test:search -- gato          # prueba la búsqueda real, sin WhatsApp
PHONE_NUMBER=5491122334455 npm start  # número con código de país, sin +
```

La primera vez imprime un código de 8 dígitos. En el teléfono:
**WhatsApp → Dispositivos vinculados → Vincular un dispositivo → Vincular con número de teléfono**
y escribe el código. La sesión queda en `auth/` (no se sube al repo), así que después
basta con `npm start`.

Variables opcionales: `AUTH_DIR` (carpeta de sesión, default `./auth`), `HTTPS_PROXY`
(la conexión y las descargas pasan por ese proxy), `LOG_LEVEL` (default `warn`) y
`FFMPEG_PATH` (default `ffmpeg`).

## Tests

```bash
npm test
```

No usan la red ni WhatsApp: simulan DuckDuckGo y el socket. Cubren cada comando, el router
(solo tus mensajes en "Mensaje a mí mismo", `@lid` y `@s.whatsapp.net`, anti-bucle,
historial, errores aislados, orden), la configuración y la búsqueda/descarga.
GitHub Actions los corre en cada push que toque `whatsapp-bot/`.
`npm run test:search -- gato` prueba contra DuckDuckGo real.

## Agregar un comando

1. Crea `src/commands/<nombre>/<nombre>.command.js` con `{ name, description, usage, run(ctx) }`.
2. Súmalo a la lista en `src/commands/index.js`.
3. Agrega su test al lado y corre `npm test`.

`!help` lo muestra solo y la seguridad (solo tú, solo tu chat) la aplica el router a todos
los comandos. Detalles y reglas en [SPEC.md](SPEC.md#arquitectura).

## Desplegar en Railway (24/7)

1. En Railway: **New Project → Deploy from GitHub repo** y elige este repo.
2. En **Settings → Source**, pon **Root Directory** = `whatsapp-bot`. Railway detecta el `Dockerfile`.
3. En **Variables**, agrega `PHONE_NUMBER` con tu número.
4. Agrega un **Volume** montado en `/app/auth` (ahí se guarda la sesión).
5. Despliega y mira los **Logs**: aparece el código de vinculación. Vincúlalo en el teléfono.
6. Una vez conectado puedes borrar `PHONE_NUMBER`; la sesión vive en el volumen.

Si cierras la sesión desde el teléfono, borra el contenido del volumen y repite el paso 5.

> No corras el bot en dos lugares a la vez con la misma sesión.
