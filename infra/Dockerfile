# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- build
# One build stage for the whole workspace: the server and the web app share
# packages/, so building them together is simpler and always consistent.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json tsconfig.base.json ./
# The patches go in BEFORE `npm ci`: its `postinstall` is what applies them, and without
# the folder in the context `patch-package` says "No patch files found" and exits with
# zero. It stayed like that for months: the served bundle had ts-mls unpatched, and every
# single-member kick went out without an UpdatePath. The guard below is what keeps the image
# from building in that state again: it checks the file, not the log.
COPY patches ./patches
RUN npm ci
RUN node patches/verificar.mjs
RUN npx tsc -b && npm run build -w @enclave/web && npm run build -w @enclave/site

# ---------------------------------------------------------------- server
# The homeserver: Node 24 for node:sqlite. It only ever relays ciphertext,
# binds inside the compose network, and persists to the /data volume
# (sqlite database + the federation signing key, generated on first boot).
FROM node:24-bookworm-slim AS server
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/packages ./packages
# The ts-mls this installs stays UNPATCHED (`--ignore-scripts` does not run the
# `postinstall`), and that is fine only because the server does not load it: neither
# `apps/server` nor `@enclave/protocol` import `ts-mls` or `@enclave/crypto` outside
# tests. The day the server imports the crypto, this stage needs the patched file
# copied from `build`, and must run `patches/verificar.mjs`.
RUN npm ci --omit=dev --ignore-scripts

# The mediasoup worker, copied by hand from the build stage.
#
# Two lines, and without them the image builds, starts, the gateway responds, and the
# first call is what discovers there is no SFU. It is the worst possible symptom: the
# logs say everything went fine.
#
# Why it is needed: the `worker/out/Release/mediasoup-worker` does NOT travel in the
# npm tarball (mediasoup's `files` does not include it). What puts it on disk is the
# `postinstall`, which downloads the prebuilt binary, and this stage installs with
# `--ignore-scripts`. Measured in `scripts/sfu-prova/imagem-do-servidor.sh`, which
# builds the image in both scenarios and requires that only one starts.
#
# Removing `--ignore-scripts` would also solve it, and it is the wrong solution: that
# option exists so that the `postinstall` of NO dependency runs in the production
# image, and trading that guarantee for a binary is a bad deal.
#
# Phase 0 had found half the problem. The other half only showed up in Phase 1: while
# mediasoup was a devDependency of the ROOT, the `--omit=dev` here left the image
# without the whole library, not just without the binary. That is why it is now a
# production dependency of `@enclave/server`.
COPY --from=build /app/node_modules/mediasoup/worker/out/Release/mediasoup-worker /worker/mediasoup-worker
ENV MEDIASOUP_WORKER_BIN=/worker/mediasoup-worker

# The data volume mounts here; pre-create it owned by the runtime user, or an
# empty named volume arrives root-owned and the first write fails.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8448
# The single media port, UDP and TCP on the same number. The `WebRtcServer`
# multiplexes every transport on it: that is why there is no ten-thousand-port range
# here, and why UFW has two rules.
EXPOSE 44300/udp
EXPOSE 44300/tcp
CMD ["node", "--no-warnings=ExperimentalWarning", "apps/server/dist/main.js"]

# ------------------------------------------------------------------- web
# Caddy serves the static app and terminates TLS (automatic Let's Encrypt),
# proxying /_enclave/* (gateway WebSocket included) to the server container.
FROM caddy:2 AS web
COPY infra/Caddyfile /etc/caddy/Caddyfile
# The public page at the root, the app in /app/. The order is not tidiness: the site must
# go in first so that it does not hide the app's `dist`.
COPY --from=build /app/apps/site/dist /srv
COPY --from=build /app/apps/web/dist /srv/app
