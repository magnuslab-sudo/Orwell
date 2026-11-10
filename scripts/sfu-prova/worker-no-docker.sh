#!/usr/bin/env bash
#
# Phase 0 guess 3: does the mediasoup precompiled worker run on the image the
# VPS uses?
#
# `infra/Dockerfile` is based on `node:24-bookworm-slim` (glibc, and the VPS is
# x64). Mediasoup brings a native binary; if npm does not bring it precompiled,
# the build stage starts needing python3, meson, ninja and g++, and it is much
# cheaper to know that now than in Phase 1.
#
# This script does not install anything on the machine: everything runs inside a
# disposable container, exactly the Dockerfile image, and writes what it finds.
#
#   scripts/sfu-prova/worker-no-docker.sh              → linux/amd64 (the VPS)
#   PLATAFORMA=linux/arm64 scripts/sfu-prova/worker-no-docker.sh
#
# Exits with 0 only if the worker starts and creates router and WebRtcServer.
set -euo pipefail

PLATAFORMA="${PLATAFORMA:-linux/amd64}"
IMAGEM="${IMAGEM:-node:24-bookworm-slim}"
VERSAO="${VERSAO:-3.24.2}"

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== $IMAGEM ($PLATAFORMA), mediasoup@$VERSAO"
exec docker run --rm --platform "$PLATAFORMA" \
  -v "$AQUI/worker-no-docker-dentro.sh:/dentro.sh:ro" \
  -e "VERSAO=$VERSAO" \
  "$IMAGEM" bash /dentro.sh
