#!/usr/bin/env bash
# The part that runs INSIDE the container. See `worker-no-docker.sh`.
set -euo pipefail

mkdir -p /prova && cd /prova
printf '{"name":"prova","type":"module","private":true}\n' > package.json

echo "-- arquitectura: $(uname -m)"
echo "-- glibc: $(ldd --version 2>&1 | head -1)"

echo "-- ferramentas de build ANTES do install (se o worker fosse compilado, precisaria delas):"
for f in python3 meson ninja g++ cc make; do
  printf '   %-8s %s\n' "$f" "$(command -v "$f" || echo 'NÃO EXISTE')"
done

echo "-- npm install mediasoup@${VERSAO}"
npm install --no-audit --no-fund "mediasoup@${VERSAO}" 2>&1 | tail -4

BINARIO=node_modules/mediasoup/worker/out/Release/mediasoup-worker
if [ ! -x "$BINARIO" ]; then
  echo "FALHA: não há worker executável em $BINARIO"
  exit 1
fi
echo "-- binário: $(ls -l "$BINARIO" | awk '{print $5" bytes"}')"
echo "-- primeiros bytes (7f454c46 = ELF): $(head -c 4 "$BINARIO" | od -An -tx1 | tr -d ' ')"
echo "-- bibliotecas dinâmicas:"
ldd "$BINARIO" 2>&1 | sed 's/^/   /'

echo "-- worker a arrancar de verdade:"
node -e '
import("mediasoup").then(async (ms) => {
  const worker = await ms.createWorker({ logLevel: "warn" })
  const router = await worker.createRouter({
    mediaCodecs: [{ kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 }],
  })
  // O porto único do plano: um `WebRtcServer` a multiplexar UDP e TCP no mesmo
  // número, que é o que o UFW abre e o compose mapeia.
  const servidor = await worker.createWebRtcServer({
    listenInfos: [
      { protocol: "udp", ip: "0.0.0.0", port: 44300 },
      { protocol: "tcp", ip: "0.0.0.0", port: 44300 },
    ],
  })
  console.log(`   OK worker pid=${worker.pid} router=${router.id.slice(0, 8)} webRtcServer=${servidor.id.slice(0, 8)}`)
  worker.close()
  process.exit(0)
}).catch((erro) => {
  console.error("   FALHOU:", erro.message)
  process.exit(1)
})'
