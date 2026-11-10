/**
 * The screen-share testbed: a minimal SFU with the product's codecs and
 * mediasoup tracing switched on.
 *
 * Copied from the 720p testbed, with two differences that are the point:
 *
 *  - consumption starts paused and resumes only when the viewer asks for it, as
 *    the product does with screen (`sfu.pause`/`sfu.resume`). "Starting to watch
 *    mid-stream" is exactly this;
 *  - mediasoup trace events (`keyframe`, `pli`, `fir`) are wired on the producer
 *    and consumer. It is the only way to know what the ROUTER thinks is a
 *    keyframe, which is the question in hypothesis (b).
 *
 * The codecs are those from `apps/server/src/media.ts`, verbatim.
 *
 *   PROVA_PORTO_HTTP=8464 PROVA_PORTO_MEDIA=44340 node scripts/sfu-prova-ecra/bancada.mjs
 */
import { createReadStream } from "node:fs"
import { createServer } from "node:http"
import { extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as mediasoup from "mediasoup"
import { WebSocketServer } from "ws"

const AQUI = fileURLToPath(new URL(".", import.meta.url))
// The page package lives outside git, in `.verify-data/`, with the captures.
const PACOTE = process.env.PROVA_PACOTE ?? join(AQUI, "pagina.bundle.js")
const PORTO_HTTP = Number(process.env.PROVA_PORTO_HTTP ?? 8464)
const PORTO_MEDIA = Number(process.env.PROVA_PORTO_MEDIA ?? 44340)
/**
 * The periodic keyframe, as `apps/server/src/media.ts` requests it
 * (`INTERVALO_DA_CHAVE_DO_ECRA`): for each resumed consumer, every N ms. Zero
 * switches it off, which is server 1.0.5.
 */
const CHAVE_MS = Number(process.env.PROVA_CHAVE_MS ?? 0)

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

/**
 * The trace, per producer and per consumer, with the timestamp of each event.
 *
 * `keyframe` on the CONSUMER means "mediasoup sent a packet it thinks is the
 * start of a keyframe". With the VP8 header encrypted, that decision reads the
 * first byte of the SFrame header, not the VP8 one.
 */
const rasto = { produtor: [], consumo: [] }

const http = createServer((pedido, resposta) => {
  const nome = pedido.url === "/" ? "/pagina.html" : (pedido.url ?? "/").split("?")[0]
  if (!/^\/[a-z0-9.-]+$/.test(nome)) {
    resposta.writeHead(400).end()
    return
  }
  const tipos = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" }
  resposta.writeHead(200, { "content-type": tipos[extname(nome)] ?? "application/octet-stream" })
  createReadStream(nome === "/pagina.bundle.js" ? PACOTE : join(AQUI, nome))
    .on("error", () => resposta.end())
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
      await transporte.setMaxIncomingBitrate(4_000_000)
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
      await produtor.enableTraceEvent(["keyframe", "pli", "fir"])
      produtor.on("trace", (evento) => rasto.produtor.push({ t: Date.now(), tipo: evento.type, sentido: evento.direction }))
      produtores.set(produtor.id, produtor)
      return { id: produtor.id }
    }

    case "produtores":
      return { ids: [...produtores.values()].filter((p) => !p.closed).map((p) => p.id) }

    case "consumir": {
      const consumidor = await transportes.get(pedido.transporte).consume({
        producerId: pedido.produtor,
        rtpCapabilities: pedido.rtpCapabilities,
        paused: true,
      })
      await consumidor.enableTraceEvent(["keyframe", "pli", "fir"])
      consumidor.on("trace", (evento) => rasto.consumo.push({ t: Date.now(), tipo: evento.type, sentido: evento.direction }))
      consumidores.set(consumidor.id, consumidor)
      if (CHAVE_MS > 0 && consumidor.kind === "video") {
        const relogio = setInterval(() => {
          if (consumidor.closed) return clearInterval(relogio)
          if (!consumidor.paused) consumidor.requestKeyFrame().catch(() => {})
        }, CHAVE_MS)
      }
      return {
        id: consumidor.id,
        produtor: consumidor.producerId,
        kind: consumidor.kind,
        rtpParameters: consumidor.rtpParameters,
      }
    }

    case "retomar": {
      const instante = Date.now()
      await consumidores.get(pedido.consumidor)?.resume()
      return { instante }
    }

    /** The full trace, with server clock timestamps in milliseconds. */
    case "rasto":
      return { rasto, agora: Date.now() }

    default:
      throw new Error(`pedido desconhecido: ${pedido.t}`)
  }
}

http.listen(PORTO_HTTP, "127.0.0.1", () => {
  console.log(`bancada-ecra: http://127.0.0.1:${PORTO_HTTP} · média em 127.0.0.1:${PORTO_MEDIA} · worker pid ${worker.pid}`)
})

for (const sinal of ["SIGTERM", "SIGINT"]) {
  process.on(sinal, () => {
    worker.close()
    process.exit(0)
  })
}
