# Bot de WhatsApp — descargador de imágenes

## Objetivo

Un bot mínimo, vinculado a mi WhatsApp personal. Cuando le escribo `!img <texto>`, busca imágenes en internet y me envía una.
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
| Comando | `!img <texto>` |
| Permisos | Solo mis propios mensajes (`fromMe`), por ejemplo desde el chat "Mensaje a mí mismo"; ignora a los demás |
| Estructura | El bot de Discord sigue en la raíz, sin cambios. El de WhatsApp va en `/whatsapp-bot` con su propio `package.json` |
| Ejecución hoy | Dentro de la sesión de Claude Code; funciona mientras la sesión esté activa |
| Nube (después) | `Dockerfile` y README para desplegar en Railway, Render o un VPS |

## Comportamiento

- `!img perro salchicha` → busca, elige una imagen al azar del top 10 y la envía al mismo chat con el caption `perro salchicha`.
- `!img` sin texto → responde `Uso: !img <búsqueda>`.
- Sin resultados, o 5 descargas fallidas → responde `No encontré imágenes para "<texto>"`.
- Cualquier otro mensaje → lo ignora.
- Mensajes de otras personas → los ignora, incluso si empiezan con `!img`.
- No entra en bucles: el caption de la imagen enviada nunca empieza con `!img`.

## Estructura de archivos

```
whatsapp-bot/
├── SPEC.md          # este documento
├── README.md        # cómo correrlo localmente y en la nube
├── package.json     # dependencias propias (Node >= 20, ESM)
├── Dockerfile       # para desplegar en la nube
├── .gitignore       # ignora auth/ y node_modules/
└── src/
    ├── index.js     # conexión a WhatsApp, pairing code, manejo de mensajes
    └── images.js    # búsqueda en DuckDuckGo y descarga de la imagen
```

La sesión de WhatsApp se guarda en `whatsapp-bot/auth/` (gitignored), así que reiniciar el bot no obliga a re-vincular.

## Configuración (variables de entorno)

| Variable | Obligatoria | Uso |
|---|---|---|
| `PHONE_NUMBER` | Solo la primera vez | Número con código de país y sin `+` (ej. `5491122334455`), para generar el código de vinculación |
| `AUTH_DIR` | No (default `./auth`) | Dónde se guarda la sesión; en la nube apunta a un volumen persistente |
| `HTTPS_PROXY` | No | Si existe, la conexión y las descargas pasan por ese proxy (necesario en el entorno de Claude Code) |

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

## Riesgos conocidos

- Baileys no es oficial. Con uso personal y bajo volumen el riesgo de bloqueo es bajo, pero existe.
- DuckDuckGo puede cambiar su endpoint interno. Todo está aislado en `images.js` para arreglarlo fácil.
- Aquí el bot vive mientras esta sesión esté activa; para 24/7 hay que desplegarlo en la nube (paso 6).
