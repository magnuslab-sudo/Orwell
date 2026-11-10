#!/bin/sh
# The same development server, without community mode. Port 8453.
#
# It exists for one reason only, and it is what you discover in the middle of
# verification: in community mode everyone on the server is already friends with
# everyone, and therefore **there are no friend requests at all**, not in the
# Friends list, not in the chat. Anyone who wants to see the request card live
# needs a server where friendship is still something you ask for.
#
# Otherwise it is just like `dev-reiniciar-servidor.sh`, common room included:
# without it there is no channel with a voice room, and without a voice room
# there is no call for the dock to show.
#
# Port 8453 so it can coexist with 8452, which is what the other scripts use.
set -e
RAIZ=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
lsof -nP -iTCP:8453 -sTCP:LISTEN -t 2>/dev/null | xargs -r kill || true
sleep 1
rm -rf "$RAIZ/.dev-data-8453"
mkdir -p "$RAIZ/.dev-data-8453"
ENCLAVE_DATA_DIR="$RAIZ/.dev-data-8453" \
ENCLAVE_SERVER_NAME=localhost:8453 \
ENCLAVE_BIND_PORT=8453 \
ENCLAVE_COMMON_ROOM='!orwell:localhost:8453' \
exec node "$RAIZ/apps/server/dist/main.js"
