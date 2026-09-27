#!/bin/sh
# Quita el generador de tokens PO: detiene sus procesos, borra /opt/pot-service y el usuario potsvc.
set -u
pkill -u potsvc 2>/dev/null || true
rm -rf /opt/pot-service
id potsvc >/dev/null 2>&1 && userdel potsvc
echo "Generador de tokens PO desinstalado"
