#!/usr/bin/env bash
# Test, against real Caddy, the site language redirects (English at the root,
# Portuguese at /pt/, since 3 November 2026), and the downloads page ones
# (/transferencias/ and /pt/transferencias/).
#
#   cd apps/site && npx vite build && cd ../..
#   bash scripts/provar-linguas-caddy.sh            # with Docker
#   CADDY=/path/to/caddy bash scripts/provar-linguas-caddy.sh   # without Docker
#
# Validates infra/Caddyfile and serves apps/site/dist as a test tree on port 18080,
# with the same Caddyfile as production. Then queries with curl what each visit
# receives. Does not touch production.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
PORTA=18080
DIST="$RAIZ/apps/site/dist"
[ -f "$DIST/pt/index.html" ] || { echo "Falta o site construído: cd apps/site && npx vite build" >&2; exit 2; }

# The downloads page lives in a separate volume in production
# (/opt/enclave/transferencias). For the test, both versions are generated here
# inside dist, with dummy data, and deleted at the end.
TRANSF="$DIST/transferencias"
[ -e "$TRANSF" ] && { echo "Já existe $TRANSF; apaga-o antes do ensaio." >&2; exit 2; }
node --input-type=module -e '
  import { mkdirSync, writeFileSync } from "node:fs"
  import { join } from "node:path"
  const [modulo, pasta] = process.argv.slice(1)
  const { FICHEIROS, paginaDeTransferencias } = await import(modulo)
  const dados = { versao: "0.0.0", versaoCurta: "0.0", nomeDaVersao: "Ensaio", folha: "ensaio.css", guiao: "ensaio.js", simbolos: "", ficheiros: [] }
  mkdirSync(join(pasta, "pt"), { recursive: true })
  for (const lingua of ["en", "pt"]) writeFileSync(join(pasta, FICHEIROS[lingua]), paginaDeTransferencias(lingua, dados))
  writeFileSync(join(pasta, "versao.json"), "{}\n")
' "$RAIZ/scripts/pagina-de-transferencias.mjs" "$TRANSF"

if [ -n "${CADDY:-}" ]; then
  ENCLAVE_SITE_ADDRESS=":$PORTA" "$CADDY" validate --config "$RAIZ/infra/Caddyfile" --adapter caddyfile
  # Caddyfile serves from /srv; the test tree goes there via a temporary copy of the file.
  ENSAIO="$(mktemp -d)"
  sed "s|root \* /srv|root * $DIST|" "$RAIZ/infra/Caddyfile" >"$ENSAIO/Caddyfile"
  ENCLAVE_SITE_ADDRESS=":$PORTA" "$CADDY" run --config "$ENSAIO/Caddyfile" --adapter caddyfile >"$ENSAIO/caddy.log" 2>&1 &
  PID=$!
  trap 'kill $PID 2>/dev/null; rm -rf "$ENSAIO" "$TRANSF"' EXIT
else
  docker run --rm -e ENCLAVE_SITE_ADDRESS=:80 -v "$RAIZ/infra/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2 \
    caddy validate --config /etc/caddy/Caddyfile
  NOME="orwell-linguas-ensaio"
  docker run -d --rm --name "$NOME" -p "127.0.0.1:$PORTA:80" -e ENCLAVE_SITE_ADDRESS=:80 \
    -v "$RAIZ/infra/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$DIST:/srv:ro" caddy:2 >/dev/null
  trap 'docker stop "$NOME" >/dev/null 2>&1 || true; rm -rf "$TRANSF"' EXIT
fi

for i in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORTA/" && break; sleep 0.2; done

falhas=0
prova() { # description, expected code, expected Location ("" = none), curl args...
  local descricao="$1" codigo="$2" destino="$3"; shift 3
  local saida; saida="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$@")"
  local obtido_codigo="${saida%% *}" obtido_destino="${saida#* }"
  obtido_destino="${obtido_destino#http://127.0.0.1:$PORTA}"
  if [ "$obtido_codigo" = "$codigo" ] && [ "$obtido_destino" = "$destino" ]; then
    echo "  ok    $descricao: $obtido_codigo $obtido_destino"
  else
    echo " FALHA  $descricao: esperado $codigo $destino, veio $obtido_codigo $obtido_destino"
    falhas=$((falhas + 1))
  fi
}

B="http://127.0.0.1:$PORTA"
prova "raiz, browser em pt-PT" 302 "/pt/" -H 'Accept-Language: pt-PT,pt;q=0.9,en;q=0.8' "$B/"
prova "raiz, browser em fr com pt antes de en" 302 "/pt/" -H 'Accept-Language: fr-FR, pt;q=0.8, en;q=0.5' "$B/"
prova "raiz, browser em en-GB" 200 "" -H 'Accept-Language: en-GB,en;q=0.9,pt;q=0.8' "$B/"
prova "raiz, sem Accept-Language" 200 "" "$B/"
prova "raiz, pt-PT mas vem do selector em /pt/" 200 "" -H 'Accept-Language: pt-PT' -H "Referer: $B/pt/" "$B/"
prova "raiz, pt-PT e vem de fora (pesquisa)" 302 "/pt/" -H 'Accept-Language: pt-PT' -H 'Referer: https://www.example.org/' "$B/"
prova "/privacy.html não se mexe em pt-PT" 200 "" -H 'Accept-Language: pt-PT' "$B/privacy.html"
prova "/pt/ serve" 200 "" "$B/pt/"
prova "/embaixadores.html antigo" 301 "/pt/embaixadores.html" "$B/embaixadores.html"
prova "/privacidade.html antigo" 301 "/pt/privacidade.html" "$B/privacidade.html"
prova "/termos.html antigo" 301 "/pt/termos.html" "$B/termos.html"
prova "/ambassadors.html" 200 "" "$B/ambassadors.html"
prova "/pt/termos.html" 200 "" "$B/pt/termos.html"
prova "/transferencias/, browser em en-GB" 200 "" -H 'Accept-Language: en-GB,en;q=0.9,pt;q=0.8' "$B/transferencias/"
prova "/transferencias/, browser em pt-PT" 302 "/pt/transferencias/" -H 'Accept-Language: pt-PT,pt;q=0.9,en;q=0.8' "$B/transferencias/"
prova "/transferencias/, pt-PT mas vem do selector" 200 "" -H 'Accept-Language: pt-PT' -H "Referer: $B/pt/transferencias/" "$B/transferencias/"
prova "/transferencias/versao.json não se mexe em pt-PT" 200 "" -H 'Accept-Language: pt-PT' "$B/transferencias/versao.json"
prova "/pt/transferencias/ serve" 200 "" "$B/pt/transferencias/"
prova "/pt/transferencias sem barra" 301 "/pt/transferencias/" "$B/pt/transferencias"
prova "/transferencias/pt/ do disco" 301 "/pt/transferencias/" "$B/transferencias/pt/"
# English lives at the root: /en leads there (3 November 2026).
prova "/en" 301 "/" "$B/en"
prova "/en/" 301 "/" "$B/en/"
prova "/en/privacy.html" 301 "/privacy.html" "$B/en/privacy.html"
prova "/en/ambassadors.html" 301 "/ambassadors.html" "$B/en/ambassadors.html"
prova "/en/transferencias/" 301 "/transferencias/" "$B/en/transferencias/"
prova "/en/ em pt-PT: 301 para a raiz, e não ciclo" 301 "/" -H 'Accept-Language: pt-PT' "$B/en/"
# A malicious /en/ cannot lead out: Caddy joins the slashes before comparing,
# and the pattern rejects the rest. Either 404, or it stays inside.
nao_sai() { # caminho cru
  local saida; saida="$(curl -s --path-as-is -o /dev/null -w '%{http_code} %{redirect_url}' "$B$1")"
  local codigo="${saida%% *}" destino="${saida#* }"
  case "$destino" in
    "" | "http://127.0.0.1:$PORTA/"[!/\\]*) echo "  ok    $1 não sai do site: $codigo ${destino#http://127.0.0.1:$PORTA}" ;;
    *) echo " FALHA  $1 sai do site: $codigo $destino"; falhas=$((falhas + 1)) ;;
  esac
}
for caminho in '/en//exemplo.org' '/en/%2F%2Fexemplo.org' '/en/%5Cexemplo.org' '/en/\exemplo.org' '/en/%09/exemplo.org' '/en/a%0d%0aX:1'; do
  nao_sai "$caminho"
done
prova "/english não é /en" 404 "" "$B/english"
# Follow the jumps to the end: a cycle used to exhaust --max-redirs and fail here.
fim() { # description, final code, final URL, curl args...
  local descricao="$1" codigo="$2" destino="$3"; shift 3
  local saida; saida="$(curl -s -L --max-redirs 5 -o /dev/null -w '%{http_code} %{url_effective}' "$@")" || true
  local obtido_codigo="${saida%% *}" obtido_destino="${saida#* }"
  obtido_destino="${obtido_destino#http://127.0.0.1:$PORTA}"
  if [ "$obtido_codigo" = "$codigo" ] && [ "$obtido_destino" = "$destino" ]; then
    echo "  ok    $descricao: acaba em $obtido_codigo $obtido_destino"
  else
    echo " FALHA  $descricao: esperado $codigo $destino, acabou em $obtido_codigo $obtido_destino"
    falhas=$((falhas + 1))
  fi
}
fim "/en/ em en-GB" 200 "/" -H 'Accept-Language: en-GB' "$B/en/"
fim "/en/ em pt-PT" 200 "/pt/" -H 'Accept-Language: pt-PT' "$B/en/"
fim "/en/privacy.html em pt-PT" 200 "/privacy.html" -H 'Accept-Language: pt-PT' "$B/en/privacy.html"

vary="$(curl -s -D - -o /dev/null -H 'Accept-Language: en' "$B/" | tr -d '\r' | awk -F': ' 'tolower($1)=="vary"{print $2}')"
case "$vary" in *Accept-Language*) echo "  ok    Vary na raiz: $vary" ;; *) echo " FALHA  Vary na raiz: «$vary»"; falhas=$((falhas + 1)) ;; esac
lingua="$(curl -s "$B/pt/transferencias/" | sed -n 2p)"
[ "$lingua" = '<html lang="pt-PT">' ] && echo "  ok    /pt/transferencias/ é a portuguesa" || { echo " FALHA  /pt/transferencias/: «$lingua»"; falhas=$((falhas + 1)); }
cookie="$(curl -s -D - -o /dev/null -H 'Accept-Language: pt-PT' "$B/" | tr -d '\r' | grep -i '^set-cookie' || true)"
[ -z "$cookie" ] && echo "  ok    nenhum Set-Cookie" || { echo " FALHA  $cookie"; falhas=$((falhas + 1)); }

[ "$falhas" -eq 0 ] && echo "Tudo certo." || { echo "$falhas falha(s)."; exit 1; }
