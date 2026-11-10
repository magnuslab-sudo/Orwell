#!/usr/bin/env bash
#
# The monthly egress report for the Orwell server, running in Docker and not seeing vnstat.
#
# Runs on the HOST, via cron (`infra/quota-vnstat.cron`). Reads
# `vnstat --json m`, extracts the current month's egress (tx) on the public interface, and
# writes a small JSON that the container reads read-only
# (`ENCLAVE_QUOTA_FICHEIRO`, see `apps/server/src/quota-mensal.ts`):
#
#   {"mes":"2026-11","saidaBytes":1234,"lidoEm":"2026-11-03T02:00:00Z"}
#
# Starting at 80% of quota the server lowers the video budget. If this
# script stops, the file ages, and after 2 hours the server ignores it and reverts
# to the normal budget: a stopped cron does not cut video for anyone.
#
# The month is UTC, as in `scripts/trafego-do-mes.mjs`. vnstat's `jsonversion` 1 (1.x) counts in KiB and 2 (2.x) in bytes: both read fine.
#
# Writes atomically (temp file and `mv`): the server
# never reads a JSON halfway through.
#
# Variables (all optional):
#   QUOTA_INTERFACE   the public interface. Default: the one from the default route.
#   QUOTA_SAIDA       the file to write. Default: /opt/enclave/quota/saida-do-mes.json
#   QUOTA_VNSTAT_JSON reads this file instead of running vnstat (for tests).
#   QUOTA_AGORA       the instant, ISO 8601 in UTC, instead of now (for tests).
#
# None of this is installed on the VPS. Install on deploy with approval.
set -euo pipefail

saida="${QUOTA_SAIDA:-/opt/enclave/quota/saida-do-mes.json}"
interface="${QUOTA_INTERFACE:-}"
if [[ -z "$interface" ]]; then
  interface="$(ip route show default 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit }}')"
fi
if [[ -z "$interface" ]]; then
  echo "quota-vnstat: não encontrei a interface pública; põe QUOTA_INTERFACE" >&2
  exit 1
fi

if [[ -n "${QUOTA_VNSTAT_JSON:-}" ]]; then
  json="$(cat "$QUOTA_VNSTAT_JSON")"
else
  json="$(vnstat --json m -i "$interface")"
fi

mkdir -p "$(dirname "$saida")"
temporario="$(mktemp "$(dirname "$saida")/.saida-do-mes.XXXXXX")"
trap 'rm -f "$temporario"' EXIT

# Python, not jq: it comes with all Ubuntu, and jq doesn't.
QUOTA_IFACE="$interface" QUOTA_AGORA="${QUOTA_AGORA:-}" python3 -I -c '
import json, os, sys
from datetime import datetime, timezone

dados = json.loads(sys.stdin.read())
agora_txt = os.environ.get("QUOTA_AGORA") or ""
agora = datetime.fromisoformat(agora_txt.replace("Z", "+00:00")) if agora_txt else datetime.now(timezone.utc)
agora = agora.astimezone(timezone.utc)
nome = os.environ["QUOTA_IFACE"]

factor = 1024 if str(dados.get("jsonversion")) == "1" else 1
iface = next((i for i in dados.get("interfaces", []) if (i.get("name") or i.get("id")) == nome), None)
if iface is None:
    sys.exit("quota-vnstat: o vnstat não tem a interface " + nome)
trafego = iface.get("traffic", {})
meses = trafego.get("month") or trafego.get("months") or []
deste = next((m for m in meses if m.get("date", {}).get("year") == agora.year and m.get("date", {}).get("month") == agora.month), None)
tx = int((deste or {}).get("tx", 0)) * factor

print(json.dumps({
    "mes": "%04d-%02d" % (agora.year, agora.month),
    "saidaBytes": tx,
    "lidoEm": agora.strftime("%Y-%m-%dT%H:%M:%SZ"),
}, separators=(",", ":")))
' <<<"$json" >"$temporario"

chmod 644 "$temporario"
mv "$temporario" "$saida"
trap - EXIT
