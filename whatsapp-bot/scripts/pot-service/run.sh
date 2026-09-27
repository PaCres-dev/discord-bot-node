#!/bin/sh
# Ejecuta el generador de tokens PO como el usuario "potsvc", con un entorno vacío (sin número de
# teléfono, sesiones ni credenciales), sin poder ganar privilegios, escuchando solo en 127.0.0.1
# y con la salida a internet forzada por el proxy de dominios permitidos (YouTube/Google).
# Uso: run.sh <url del proxy de dominios permitidos> [puerto, default 4416]
set -eu
PROXY="${1:?falta la url del proxy de dominios permitidos}"
PORT="${2:-4416}"
DEST=/opt/pot-service
NODE="$(command -v node)"

exec setpriv --reuid=potsvc --regid=potsvc --clear-groups --no-new-privs \
  env -i \
    PATH=/usr/local/bin:/usr/bin:/bin \
    HOME="$DEST/cache" \
    XDG_CACHE_HOME="$DEST/cache" \
    HTTPS_PROXY="$PROXY" HTTP_PROXY="$PROXY" https_proxy="$PROXY" http_proxy="$PROXY" \
    NODE_EXTRA_CA_CERTS="$DEST/ca.crt" \
  "$NODE" "$DEST/build/main.js" --host 127.0.0.1 --port "$PORT"
