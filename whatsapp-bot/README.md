# Bot de WhatsApp — `!img`

Bot mínimo vinculado a tu WhatsApp personal. En el chat "Mensaje a mí mismo":

- `!img gato` → una imagen al azar del top 10 de DuckDuckGo.
- `!img 3 gato` → 3 imágenes distintas (máximo 5).

Solo responde a tus propios mensajes y solo en ese chat. Detalles en [SPEC.md](SPEC.md).

## Correrlo localmente

Requiere Node 20 o superior.

```bash
cd whatsapp-bot
npm install
npm run test:search -- gato          # prueba la búsqueda sin WhatsApp
PHONE_NUMBER=5491122334455 npm start  # número con código de país, sin +
```

La primera vez imprime un código de 8 dígitos. En el teléfono:
**WhatsApp → Dispositivos vinculados → Vincular un dispositivo → Vincular con número de teléfono**
y escribe el código. La sesión queda en `auth/` (no se sube al repo), así que después
basta con `npm start`.

Variables opcionales: `AUTH_DIR` (carpeta de sesión, default `./auth`), `HTTPS_PROXY`
(la conexión y las descargas pasan por ese proxy) y `LOG_LEVEL` (default `warn`).

## Tests

```bash
npm test
```

No usan la red ni WhatsApp: simulan DuckDuckGo y el socket. Cubren el formato del comando
(`!img`, cantidad 1–5), que solo responda a tus mensajes en "Mensaje a mí mismo"
(`@lid` y `@s.whatsapp.net`), que no entre en bucles, los mensajes de error y la
búsqueda/descarga (SafeSearch desactivado, top 10, sin repetidas, máx. 5 fallos).
Córrelos antes de cada cambio. `npm run test:search -- gato` prueba contra DuckDuckGo real.

## Desplegar en Railway (24/7)

1. En Railway: **New Project → Deploy from GitHub repo** y elige este repo.
2. En **Settings → Source**, pon **Root Directory** = `whatsapp-bot`. Railway detecta el `Dockerfile`.
3. En **Variables**, agrega `PHONE_NUMBER` con tu número.
4. Agrega un **Volume** montado en `/app/auth` (ahí se guarda la sesión).
5. Despliega y mira los **Logs**: aparece el código de vinculación. Vincúlalo en el teléfono.
6. Una vez conectado puedes borrar `PHONE_NUMBER`; la sesión vive en el volumen.

Si cierras la sesión desde el teléfono, borra el contenido del volumen y repite el paso 5.

> No corras el bot en dos lugares a la vez con la misma sesión.
