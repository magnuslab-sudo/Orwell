#!/bin/sh
# The test rig in a Linux arm64 container, with the worker pinned to one core and the rest
# (generators, sinks) on four others. Needs Docker running.
#
#   scripts/sfu-carga/contentor.sh --pessoas=50 --camaras=4 --falam=10 --json
#
# The mediasoup for Linux is installed once in a Docker volume
# (`orwell-sfu-carga`), at the same version as the repository. Nothing stays on the
# repository disk. To delete it: `docker volume rm orwell-sfu-carga`.
set -e
AQUI=$(cd "$(dirname "$0")" && pwd)
RAIZ=$(cd "$AQUI/../.." && pwd)
VERSAO=$(node -p "require('$RAIZ/node_modules/mediasoup/package.json').version")
docker volume create orwell-sfu-carga >/dev/null
exec docker run --rm --platform linux/arm64 --cpuset-cpus=0-4 --memory=3g \
  -v orwell-sfu-carga:/ms/node_modules -v "$AQUI":/ms/carga:ro -w /ms \
  -e MEDIASOUP_WORKER_BIN=/ms/carga/worker-num-nucleo.sh \
  node:24-bookworm-slim sh -c "
    if ! grep -q '\"version\": \"$VERSAO\"' node_modules/mediasoup/package.json 2>/dev/null; then
      npm init -y >/dev/null && npm install --no-save mediasoup@$VERSAO >/dev/null 2>&1
    fi
    # npm 11 won't run postinstall without consent, and it's the one that fetches
    # the worker already built for Linux arm64. We run it here, by hand, and WITHOUT
    # MEDIASOUP_WORKER_BIN: with it set, postinstall won't download anything.
    [ -x node_modules/mediasoup/worker/out/Release/mediasoup-worker ] \
      || (cd node_modules/mediasoup && env -u MEDIASOUP_WORKER_BIN node npm-scripts.mjs postinstall >/dev/null) || exit 3
    exec taskset -c 1-4 node carga/bancada.mjs \"\$@\"" sh "$@"
