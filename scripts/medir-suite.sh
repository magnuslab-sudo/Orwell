#!/bin/bash
#
# Measures the suite test by test, and optionally with the machine loaded.
#
# WHY THIS EXISTS. A slow suite gets disabled, and a disabled suite is the same
# as having no tests at all. But there is a pitfall in measuring it: the numbers
# only mean something if the measurement conditions are known. A run with another
# suite running alongside easily takes three to ten times the time of a solo run, # that is how `names.test.ts` went from 3.6 s to 23 s and `common-room.test.ts`
# from 18 s to 900 s, with no one touching anything.
#
# So this script does two things and always tells you which one:
#
#   bash scripts/medir-suite.sh
#       Runs the suite test by test and writes the time of each one. Before
#       trusting the number, check the load line it prints at the end: with the
#       machine busy the number is worthless.
#
#   bash scripts/medir-suite.sh --carga=8
#       THE SAME, but with eight processes burning CPU alongside, from start to
#       finish. It proves that the tests are deterministic: a test that only
#       fails with a loaded machine fails HERE. Use the number of cores on your
#       machine as a starting point.
#
# The load is cleaned up at the end, even if the script is interrupted.
#
set -u

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACOTES="packages/protocol packages/crypto packages/client-core apps/server packages/ui apps/web apps/client apps/site"

CARGA=0
for argumento in "$@"; do
  case "$argumento" in
    --carga=*) CARGA="${argumento#*=}" ;;
    *) echo "argumento que não conheço: $argumento" >&2; exit 2 ;;
  esac
done

PIDS=()
arrumar() {
  for pid in ${PIDS+"${PIDS[@]}"}; do kill "$pid" 2>/dev/null; done
  PIDS=()
}
trap arrumar EXIT INT TERM

if [ "$CARGA" -gt 0 ]; then
  echo "A pôr $CARGA processos a queimar CPU ao lado. Isto é de propósito."
  for _ in $(seq "$CARGA"); do
    bash -c 'while :; do :; done' &
    PIDS+=($!)
  done
  # Let the load appear in the average before starting to measure.
  sleep 5
fi

echo
echo "carga no arranque: $(uptime | sed 's/.*averages*: //')"
echo

cd "$RAIZ" || exit 1
FALHADOS=""
INICIO=$(date +%s)
for pacote in $PACOTES; do
  T0=$(date +%s)
  npx vitest run --root "$pacote" > "/tmp/medir-suite-$(echo "$pacote" | tr '/' '_').log" 2>&1
  RC=$?
  T1=$(date +%s)
  if [ "$RC" -eq 0 ]; then
    printf '  %-24s %4ds\n' "$pacote" "$((T1 - T0))"
  else
    printf '  %-24s %4ds  ← VERMELHO\n' "$pacote" "$((T1 - T0))"
    FALHADOS="$FALHADOS $pacote"
  fi
done
FIM=$(date +%s)

echo
echo "TOTAL: $((FIM - INICIO))s"
if [ "$CARGA" -gt 0 ]; then
  echo "Medido COM $CARGA processos de carga ao lado."
else
  echo "Medido sem carga sintética — mas ver a linha de carga em cima."
fi
echo "carga no fim:     $(uptime | sed 's/.*averages*: //')"

if [ -n "$FALHADOS" ]; then
  echo
  echo "PACOTES COM TESTES A FALHAR:$FALHADOS" >&2
  echo "Os registos ficaram em /tmp/medir-suite-*.log" >&2
  exit 1
fi
echo
echo "Tudo verde."
