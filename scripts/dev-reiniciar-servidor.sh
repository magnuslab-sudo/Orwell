#!/bin/sh
# Clean local server for a test to start from scratch.
#
# The common room is ARBITRATED: whoever creates it keeps it, and whoever
# arrives later needs an online member to admit them. In a single-account test
# this means the second run never sees the room, the first one already claimed it and
# disconnected. Deleting the database returns arbitration to whoever arrives
# next.
#
# Port 8452 and not 8448 or 8449: 8448 may be occupied by another session, and
# 8449 is the one `gateway.test.ts` uses, a test server sleeping on it
# makes the test suite fail with EADDRINUSE, which doesn't look like a bad test at all.
set -e
RAIZ=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
lsof -nP -iTCP:8452 -sTCP:LISTEN -t 2>/dev/null | xargs -r kill || true
sleep 1
rm -rf "$RAIZ/.dev-data/enclave.sqlite" "$RAIZ/.dev-data/enclave.sqlite-wal" "$RAIZ/.dev-data/enclave.sqlite-shm"
ENCLAVE_DATA_DIR="$RAIZ/.dev-data" \
ENCLAVE_SERVER_NAME=localhost:8452 \
ENCLAVE_BIND_PORT=8452 \
ENCLAVE_COMMON_ROOM='!orwell:localhost:8452' \
ENCLAVE_COMMUNITY_MODE=true \
exec node "$RAIZ/apps/server/dist/main.js"
