#!/bin/sh
# Instala el generador de tokens PO de YouTube (bgutil-ytdlp-pot-provider, ya compilado) como
# servicio aislado: usuario de sistema sin privilegios "potsvc", archivos en /opt/pot-service de
# solo lectura para ese usuario y una caché propia. El usuario no puede leer auth/ del bot.
# Uso: install.sh <carpeta server compilada de bgutil> <archivo de certificados CA>
set -eu
SRC="${1:?falta la carpeta server de bgutil}"
CA="${2:?falta el archivo de certificados CA}"
DEST=/opt/pot-service

[ -f "$SRC/build/main.js" ] || { echo "No encuentro $SRC/build/main.js (¿está compilado?)" >&2; exit 1; }

id potsvc >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin potsvc

rm -rf "$DEST"
mkdir -p "$DEST/cache"
cp -r "$SRC/build" "$SRC/node_modules" "$SRC/package.json" "$DEST/"
cp "$CA" "$DEST/ca.crt"
# Todo es de root y de solo lectura para potsvc; solo la caché le pertenece.
chown -R root:root "$DEST"
chmod -R a+rX,go-w "$DEST"
chown potsvc:potsvc "$DEST/cache"
chmod 700 "$DEST/cache"
echo "Instalado en $DEST"
