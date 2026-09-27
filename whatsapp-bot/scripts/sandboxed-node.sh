#!/bin/sh
# Node con el modelo de permisos, para el generador de tokens PO de YouTube (lo usa yt-dlp):
# solo puede leer el generador y su caché, escribir en la caché, y no puede ejecutar otros programas.
# La red la restringe el proxy de dominios permitidos (src/youtube-download/allowlist-proxy.js).
set -eu
: "${POT_SERVER_HOME:?falta POT_SERVER_HOME}"
: "${POT_CACHE_DIR:?falta POT_CACHE_DIR}"
exec node --permission \
  --allow-fs-read="$POT_SERVER_HOME" \
  --allow-fs-read="$POT_CACHE_DIR" \
  --allow-fs-write="$POT_CACHE_DIR" \
  "$@"
