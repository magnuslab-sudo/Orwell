#!/bin/sh
# Verification server for the scroll-sala branch, on its own port (8481) to
# not step on 8452 from other sessions. Database dropped on each startup.
set -e
RAIZ=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
lsof -nP -iTCP:8481 -sTCP:LISTEN -t 2>/dev/null | xargs -r kill || true
sleep 1
rm -rf "$RAIZ/.dev-data/scroll"
mkdir -p "$RAIZ/.dev-data/scroll"
ENCLAVE_DATA_DIR="$RAIZ/.dev-data/scroll" \
ENCLAVE_SERVER_NAME=localhost:8481 \
ENCLAVE_BIND_PORT=8481 \
ENCLAVE_COMMON_ROOM='!orwell:localhost:8481' \
ENCLAVE_COMMUNITY_MODE=true \
exec node "$RAIZ/apps/server/dist/main.js"
