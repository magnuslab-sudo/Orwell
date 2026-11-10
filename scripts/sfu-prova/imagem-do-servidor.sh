#!/usr/bin/env bash
#
# The `--ignore-scripts` trap, measured instead of argued.
#
# Builds the image from `imagem/Dockerfile` twice, which is the two-stage pattern
# from `infra/Dockerfile` stripped to the bone, and starts a mediasoup
# worker from each:
#
#   without the binary crossing stages → MUST fail
#   with the binary crossing stages    → MUST start
#
# If both give the same result, nothing is being measured.
#
#   scripts/sfu-prova/imagem-do-servidor.sh
set -uo pipefail

PLATAFORMA="${PLATAFORMA:-linux/amd64}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

correr() {
  local trazer="$1"
  local etiqueta="orwell-prova-worker:$1"
  docker build --platform "$PLATAFORMA" --quiet --build-arg "TRAZER_WORKER=$trazer" -t "$etiqueta" "$AQUI/imagem" > /dev/null 2>&1 \
    || { echo "     (a construção falhou)"; return 1; }
  docker run --rm --platform "$PLATAFORMA" "$etiqueta" 2>&1 | tail -2
  return "${PIPESTATUS[0]}"
}

echo "== sem o binário a viajar entre estágios (como o infra/Dockerfile está hoje)"
correr 0
sem=$?
echo "   saiu com $sem"

echo
echo "== com o binário a viajar entre estágios"
correr 1
com=$?
echo "   saiu com $com"

echo
if [ "$sem" -ne 0 ] && [ "$com" -eq 0 ]; then
  echo "BEM: a armadilha existe e a correcção resolve-a."
  exit 0
fi
echo "MAL: os dois cenários deram o mesmo. Isto não está a medir a armadilha."
exit 1
