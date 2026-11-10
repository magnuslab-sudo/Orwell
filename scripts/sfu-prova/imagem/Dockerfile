# syntax=docker/dockerfile:1
#
# The two-stage pattern from `infra/Dockerfile`, stripped to the bone, to measure
# a trap that only appears in production.
#
# The `worker/out/Release/mediasoup-worker` does NOT travel in the npm tarball: mediasoup's
# `files` does not include it. The `postinstall` is what puts it there, transferring
# the precompiled binary. And the `server` stage of `infra/Dockerfile` installs
# with `npm ci --omit=dev --ignore-scripts`, which is the right option for all the
# other reasons, and which here leaves the image without any worker.
#
# The symptom would be the worst possible: the image builds, comes up, the gateway responds,
# and the first call discovers there is no SFU.
#
#   --build-arg TRAZER_WORKER=1  → the binary crosses from the build stage
#   --build-arg TRAZER_WORKER=0  → as it stands today, and must fail

ARG TRAZER_WORKER=1

# ------------------------------------------------------------------- build
# With scripts, like the build stage of the repository. This is where the
# precompiled worker reaches disk.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund

# ------------------------------------------------------------------ server
FROM node:24-bookworm-slim AS server
ARG TRAZER_WORKER
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund --omit=dev --ignore-scripts

# The binary crosses the stages. `COPY` with a variable source does not exist in
# Dockerfile, so it always copies and deletes when measuring the
# scenario without it, which gives exactly the same image that `--ignore-scripts`
# would produce on its own.
#
# And with it we delete the variable, so the "without" scenario fails the true way: mediasoup
# looks for the worker inside its own node_modules and does not find it there. Leaving the
# variable pointing to a deleted file would give the same failure with the wrong message,
# and a wrong message in a proof is a new trap.
COPY --from=build /app/node_modules/mediasoup/worker/out/Release/mediasoup-worker /worker/mediasoup-worker
ENV MEDIASOUP_WORKER_BIN=/worker/mediasoup-worker
RUN if [ "$TRAZER_WORKER" != "1" ]; then rm -rf /worker; fi
RUN if [ "$TRAZER_WORKER" != "1" ]; then echo 'unset MEDIASOUP_WORKER_BIN' > /sem-variavel.sh; else touch /sem-variavel.sh; fi

COPY arranque.mjs ./
CMD ["bash", "-c", ". /sem-variavel.sh && node arranque.mjs"]
