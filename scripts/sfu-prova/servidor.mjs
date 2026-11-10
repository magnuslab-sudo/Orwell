/**
 * The minimal SFU of Phase 0: an audio relay, and nothing more.
 *
 * **This file has no media key and cannot have one.** That is the entire
 * point of the proof, and it is not a promise: `prova.mjs` reads this source code and fails if
 * it finds key material in here, an import from `@enclave/crypto`, or
 * even a call to `crypto.subtle`, because a router that never decrypts has no reason
 * to touch it. See `auditarSegredos`.
 *
 * What is here: a mediasoup worker, a router with Opus only, a
 * `WebRtcServer` on a single port, and the rawest signaling that can be written. Not
 * embryonic Phase 1, no gateway, no MLS, no accounts, no `#mayReach`. It is a
 * lab skeleton, and the only thing asked of it is to relay RTP without looking at the payload.
 *
 * Packet capture for the proof is done by `DirectTransport`: the server
 * consumes the producer into the Node process itself and writes the raw
 * RTP packets to a file. It is the best possible place for the proof, they are the
 * bytes it relays, seen by it, with the key it does not have.
 *
 *   PROVA_PORTO_HTTP=8460 PROVA_PORTO_MEDIA=44300 node scripts/sfu-prova/servidor.mjs
 */
import { createReadStream, existsSync, writeFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as mediasoup from "mediasoup"
import { WebSocketServer } from "ws"

const AQUI = fileURLToPath(new URL(".", import.meta.url))
const PORTO_HTTP = Number(process.env.PROVA_PORTO_HTTP ?? 8460)
const PORTO_MEDIA = Number(process.env.PROVA_PORTO_MEDIA ?? 44300)
const CAPTURA = process.env.PROVA_CAPTURA
// 40 reach the Phase 0 proof; the microphone recovery one keeps the entire call
// (`scripts/sfu-prova-mic-recupera/`), to also open the packets
// that went out during and after the track switch.
const PACOTES_A_GUARDAR = Number(process.env.PROVA_PACOTES_A_GUARDAR ?? 40)

/**
 * ONE worker, not one per core.
 *
 * The VPS has two cores and eight GB, and shares them with magnuslab.pt, nginx,
 * Postgres, the bots and the site. One media worker leaves an entire core for
 * them. The temptation to scale by `os.cpus().length` is everyone's recipe and
 * it is wrong on this machine: the dominant cost of an SFU is network, not
 * CPU, and one worker handles hundreds of voice streams. This is written here because
 * this is where someone would change it without thinking.
 */
const WORKERS = 1

/**
 * Opus only. Phase 0 is voice, and a router with video would only serve to
 * negotiate codecs that nobody uses in this test.
 *
 * The parameters are not decoration, they are the two containment measures that
 * save the most on this machine, and they stay here from day one so they do not
 * become "tuning for later":
 *
 *  - `usedtx=1` (discontinuous transmission). In a conversation each person speaks
 *    perhaps a quarter of the time. Without DTX, Opus sends encoded silence all
 *    the time; with DTX it stops sending when nobody speaks. It cuts close to
 *    seventy percent of voice traffic, and the quality of what you hear does not
 *    change.
 *  - `maxaveragebitrate=32000` and `sprop-stereo=0`. Spoken voice at 24-32 kbps
 *    mono is indistinguishable from 64 kbps stereo, and it is half. A room of
 *    four goes from around 600 kbps outbound to close to a hundred, accounting
 *    for DTX.
 *
 * The `channels: 2` stays the same: mediasoup requires it for Opus. What decides
 * that mono gets encoded is `sprop-stereo=0`, and the `opusStereo: false` on the
 * producer side.
 */
const CODECS = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    parameters: { useinbandfec: 1, usedtx: 1, "sprop-stereo": 0, maxaveragebitrate: 32000 },
  },
]

const workers = []
for (let i = 0; i < WORKERS; i++) workers.push(await mediasoup.createWorker({ logLevel: "warn" }))
const worker = workers[0]

const router = await worker.createRouter({ mediaCodecs: CODECS })
/**
 * One port only, UDP and TCP with the same number: the `WebRtcServer` multiplexes
 * all transports through it. It is what UFW opens and what compose maps in Phase 1
 *, and it is one of the four questions this test answers.
 */
const webRtcServer = await worker.createWebRtcServer({
  listenInfos: [
    { protocol: "udp", ip: "127.0.0.1", port: PORTO_MEDIA },
    { protocol: "tcp", ip: "127.0.0.1", port: PORTO_MEDIA },
  ],
})

const transportes = new Map()
const produtores = new Map()
const capturados = []

/** A `DirectTransport` that brings forwarded packets into the Node. */
const espia = CAPTURA ? await router.createDirectTransport() : undefined

/**
 * All packets that ARRIVE at the producer, with and without payload, through
 * mediasoup's `trace`. The microphone recovery test compares this with what the
 * browser says it sent: padding-only packets (bandwidth estimate probes, no media)
 * count in the browser's `packetsSent` and do not reach the spy, which only sees
 * what the router forwards.
 */
const chegados = { comCarga: 0, soEnchimento: 0, repetidos: 0 }
const numerosVistos = new Set()

async function espiar(produtor) {
  if (!espia) return
  await produtor.enableTraceEvent(["rtp"])
  produtor.on("trace", (traco) => {
    if (traco.type !== "rtp") return
    const pacote = traco.info?.rtpPacket
    if (!pacote) return
    // A retransmission is a copy of a packet that already arrived: it counts separately.
    const numero = `${pacote.ssrc}:${pacote.sequenceNumber}`
    if (Number(pacote.payloadSize) === 0) chegados.soEnchimento++
    else if (numerosVistos.has(numero) || traco.info.isRtx) chegados.repetidos++
    else chegados.comCarga++
    numerosVistos.add(numero)
  })
  const consumidor = await espia.consume({ producerId: produtor.id, rtpCapabilities: router.rtpCapabilities })
  consumidor.on("rtp", (pacote) => {
    if (capturados.length >= PACOTES_A_GUARDAR) return
    capturados.push(Buffer.from(pacote).toString("base64"))
    if (capturados.length === PACOTES_A_GUARDAR) void writeFile(CAPTURA, JSON.stringify(capturados))
  })
}

const http = createServer((pedido, resposta) => {
  const nome = pedido.url === "/" ? "/pagina.html" : (pedido.url ?? "/").split("?")[0]
  // A lab file server, listening only on 127.0.0.1: it refuses any path with
  // extra slashes instead of trying to normalize it.
  if (!/^\/[a-z0-9.-]+$/.test(nome)) {
    resposta.writeHead(400).end()
    return
  }
  // A missing file (the `favicon.ico` that Firefox requests) broke the server
  // (the 404 written after the 200). Check first.
  if (!existsSync(join(AQUI, nome))) {
    resposta.writeHead(404).end()
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
  const meus = { transportes: new Set(), produtores: new Set() }

  ligacao.on("message", async (cru) => {
    const pedido = JSON.parse(String(cru))
    try {
      ligacao.send(JSON.stringify({ id: pedido.id, ok: await responder(pedido, meus, ligacao) }))
    } catch (erro) {
      ligacao.send(JSON.stringify({ id: pedido.id, erro: String(erro?.message ?? erro) }))
    }
  })

  ligacao.on("close", () => {
    for (const id of meus.transportes) {
      transportes.get(id)?.close()
      transportes.delete(id)
    }
    for (const id of meus.produtores) produtores.delete(id)
  })
})

async function responder(pedido, meus, ligacao) {
  switch (pedido.t) {
    case "ola":
      // The producers that already exist: whoever arrives late must pick them up, or
      // a receiver that joins after the sender never consumes anything.
      return { rtpCapabilities: router.rtpCapabilities, produtores: [...produtores.keys()] }

    case "transporte.criar": {
      const transporte = await router.createWebRtcTransport({ webRtcServer, enableUdp: true, enableTcp: true, preferUdp: true })
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
      const produtor = await transportes.get(pedido.transporte).produce({ kind: pedido.kind, rtpParameters: pedido.rtpParameters })
      produtores.set(produtor.id, produtor)
      meus.produtores.add(produtor.id)
      await espiar(produtor)
      // Everyone finds out, except who produced.
      for (const outro of ws.clients) {
        if (outro !== ligacao && outro.readyState === 1) outro.send(JSON.stringify({ t: "produtor.novo", produtor: produtor.id }))
      }
      return { id: produtor.id }
    }

    case "consumir": {
      // Born paused on purpose. Between `consume` and installing the transform that
      // decrypts there is an interval, and frames that pass in that interval arrive
      // encrypted at the decoder, which reads them as noise. The client resumes when
      // ready.
      const consumidor = await transportes.get(pedido.transporte).consume({
        producerId: pedido.produtor,
        rtpCapabilities: pedido.rtpCapabilities,
        paused: true,
      })
      transportes.get(pedido.transporte).appData.consumidores ??= new Map()
      transportes.get(pedido.transporte).appData.consumidores.set(consumidor.id, consumidor)
      return { id: consumidor.id, produtor: consumidor.producerId, kind: consumidor.kind, rtpParameters: consumidor.rtpParameters }
    }

    // For the first packet test (`scripts/sfu-prova-primeiro-pacote/`): the client
    // closes on the server the producer that did not get encrypted.
    case "produtor.fechar":
      produtores.get(pedido.produtor)?.close()
      produtores.delete(pedido.produtor)
      return {}

    case "retomar":
      await transportes.get(pedido.transporte).appData.consumidores?.get(pedido.consumidor)?.resume()
      return {}

    default:
      throw new Error(`pedido desconhecido: ${pedido.t}`)
  }
}

http.listen(PORTO_HTTP, "127.0.0.1", () => {
  console.log(`sfu-prova: http://127.0.0.1:${PORTO_HTTP} · média em 127.0.0.1:${PORTO_MEDIA} (udp+tcp) · worker pid ${worker.pid}`)
})

// The script that started this asks for shutdown by signal; the worker dies with the process.
for (const sinal of ["SIGTERM", "SIGINT"]) {
  process.on(sinal, () => {
    if (CAPTURA && capturados.length > 0 && capturados.length < PACOTES_A_GUARDAR) {
      // Synchronous: the process closes on the next line, and an asynchronous write
      // would leave the file empty (seen with the large capture of the microphone
      // recovery test).
      writeFileSync(CAPTURA, JSON.stringify(capturados))
    }
    if (CAPTURA) {
      writeFileSync(`${CAPTURA}.chegados.json`, JSON.stringify(chegados))
    }
    worker.close()
    process.exit(0)
  })
}
