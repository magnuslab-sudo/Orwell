/**
 * The 720p measurement bench: a minimal SFU, with the product's codecs.
 *
 * It is not the product, it is the lab where we measure the PHYSICS that the product inherits:
 * what the Chrome encoder does with a 1280×720 camera when given
 * a bitrate cap, and what leaves the router for each person watching.
 *
 * The codecs are copied from `apps/server/src/media.ts` exactly, including the
 * `x-google-start-bitrate`: measuring with another codec or another parameter would be
 * measuring something else. VP8 and only VP8, for the same reason it is written there, full frame
 * encryption does not survive the H.264 packetizer.
 *
 *   PROVA_PORTO_HTTP=8463 PROVA_PORTO_MEDIA=44330 node scripts/sfu-prova-720p/bancada.mjs
 */
import { createReadStream } from "node:fs"
import { createServer } from "node:http"
import { extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as mediasoup from "mediasoup"
import { WebSocketServer } from "ws"

const AQUI = fileURLToPath(new URL(".", import.meta.url))
const PORTO_HTTP = Number(process.env.PROVA_PORTO_HTTP ?? 8463)
const PORTO_MEDIA = Number(process.env.PROVA_PORTO_MEDIA ?? 44330)

/** A worker, like on the VPS: two cores, one of them from magnuslab.pt. */
const worker = await mediasoup.createWorker({ logLevel: "warn" })

const CODECS = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    parameters: { useinbandfec: 1, usedtx: 1, "sprop-stereo": 0, maxaveragebitrate: 32000 },
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: { "x-google-start-bitrate": 600 },
  },
]

const router = await worker.createRouter({ mediaCodecs: CODECS })
const webRtcServer = await worker.createWebRtcServer({
  listenInfos: [
    { protocol: "udp", ip: "127.0.0.1", port: PORTO_MEDIA },
    { protocol: "tcp", ip: "127.0.0.1", port: PORTO_MEDIA },
  ],
})

const transportes = new Map()
const produtores = new Map()
const consumidores = new Map()

const http = createServer((pedido, resposta) => {
  const nome = pedido.url === "/" ? "/pagina.html" : (pedido.url ?? "/").split("?")[0]
  if (!/^\/[a-z0-9.-]+$/.test(nome)) {
    resposta.writeHead(400).end()
    return
  }
  const tipos = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" }
  resposta.writeHead(200, { "content-type": tipos[extname(nome)] ?? "application/octet-stream" })
  createReadStream(join(AQUI, nome))
    .on("error", () => resposta.writeHead(404).end())
    .pipe(resposta)
})

const ws = new WebSocketServer({ server: http, path: "/sinal" })
ws.on("connection", (ligacao) => {
  const meus = { transportes: new Set() }
  ligacao.on("message", async (cru) => {
    const pedido = JSON.parse(String(cru))
    try {
      ligacao.send(JSON.stringify({ id: pedido.id, ok: await responder(pedido, meus) }))
    } catch (erro) {
      ligacao.send(JSON.stringify({ id: pedido.id, erro: String(erro?.message ?? erro) }))
    }
  })
  ligacao.on("close", () => {
    for (const id of meus.transportes) {
      transportes.get(id)?.close()
      transportes.delete(id)
    }
  })
})

async function responder(pedido, meus) {
  switch (pedido.t) {
    case "ola":
      return { rtpCapabilities: router.rtpCapabilities }

    case "transporte.criar": {
      const transporte = await router.createWebRtcTransport({
        webRtcServer,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      })
      // The same input cap per transport that the product applies. Without it,
      // the measurement from the top of the range would not have the same physics.
      await transporte.setMaxIncomingBitrate(Number(pedido.bandaDeEntrada ?? 4_000_000))
      transportes.set(transporte.id, transporte)
      meus.transportes.add(transporte.id)
      return {
        id: transporte.id,
        iceParameters: transporte.iceParameters,
        iceCandidates: transporte.iceCandidates,
        dtlsParameters: transporte.dtlsParameters,
      }
    }

    case "transporte.ligar":
      await transportes.get(pedido.transporte)?.connect({ dtlsParameters: pedido.dtlsParameters })
      return {}

    case "produzir": {
      const produtor = await transportes.get(pedido.transporte).produce({
        kind: pedido.kind,
        rtpParameters: pedido.rtpParameters,
      })
      produtores.set(produtor.id, produtor)
      return { id: produtor.id }
    }

    case "consumir": {
      const consumidor = await transportes.get(pedido.transporte).consume({
        producerId: pedido.produtor,
        rtpCapabilities: pedido.rtpCapabilities,
        paused: true,
      })
      consumidores.set(consumidor.id, consumidor)
      return {
        id: consumidor.id,
        produtor: consumidor.producerId,
        kind: consumidor.kind,
        rtpParameters: consumidor.rtpParameters,
      }
    }

    case "retomar":
      await consumidores.get(pedido.consumidor)?.resume()
      return {}

    /**
     * What the SERVER saw pass, the bytes it received and the bytes it sent,
     * counted by it.
     *
     * This is the measure that matters for the cap: the SFU bottleneck is the
     * output, and the output is `bitrate do produtor × número de quem consome`. What the browser says it sent is the
     * other half of the same count, and the two must match.
     */
    case "contas": {
      // The closed ones leave the list before being asked to account. A previous
      // run leaves its producer here, and asking statistics from a producer
      // whose transport is dead throws from the worker side, that is what broke
      // the second run of the first measurement.
      for (const [id, produtor] of produtores) if (produtor.closed) produtores.delete(id)
      for (const [id, consumidor] of consumidores) if (consumidor.closed) consumidores.delete(id)

      const doProdutor = []
      for (const produtor of produtores.values()) {
        for (const linha of await produtor.getStats()) {
          if (linha.type === "inbound-rtp") doProdutor.push({ bytes: linha.byteCount, bitrate: linha.bitrate })
        }
      }
      const doConsumidor = []
      for (const consumidor of consumidores.values()) {
        for (const linha of await consumidor.getStats()) {
          if (linha.type === "outbound-rtp") doConsumidor.push({ bytes: linha.byteCount, bitrate: linha.bitrate })
        }
      }
      return { entrada: doProdutor, saida: doConsumidor }
    }

    default:
      throw new Error(`pedido desconhecido: ${pedido.t}`)
  }
}

http.listen(PORTO_HTTP, "127.0.0.1", () => {
  console.log(`bancada-720p: http://127.0.0.1:${PORTO_HTTP} · média em 127.0.0.1:${PORTO_MEDIA} · worker pid ${worker.pid}`)
})

for (const sinal of ["SIGTERM", "SIGINT"]) {
  process.on(sinal, () => {
    worker.close()
    process.exit(0)
  })
}
