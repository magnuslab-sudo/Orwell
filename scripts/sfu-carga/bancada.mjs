/**
 * Load test of the mediasoup worker: how many consumers can ONE worker handle,
 * which is what the VPS has.
 *
 * NEVER against production. Everything runs on this machine, at 127.0.0.1, in
 * its own worker, and nothing is saved to disk.
 *
 * What matches the product: the mediasoup version, a worker with the same
 * `logLevel`, a router per call with the same codecs (`CODECS` of
 * `apps/server/src/media.ts`), one send transport and one receive transport per
 * person, one consumer per stream from each other person, router RTP
 * capabilities like the device (so `transport-cc`, NACK and PLI, and the worker-side
 * congestion control client), and output encrypted in SRTP
 * (AEAD_AES_256_GCM, what Chrome negotiates).
 *
 * What does NOT match, and pulls the numbers toward optimism: `PlainTransport`
 * instead of `WebRtcTransport` (no ICE or DTLS, which only cost at startup),
 * input without SRTP (decrypting 1 fluxo per person is little next to encrypting
 * 49), and receivers that do not send RTCP back (no NACK or reports from
 * `transport-cc`). So the report rounds down.
 *
 * Usage:
 *   node scripts/sfu-carga/bancada.mjs --pessoas=50 --camaras=4 --ecras=2 \
 *        --falam=10 --chamadas=1 --segundos=30
 *
 *   --falam   how many people speak at once; the rest are in DTX
 *             (a 400 em 400 ms packet). Default: all (the worst case).
 *   --json    print only the JSON result line.
 *
 * Stops on its own if the machine's free memory drops below 25 %.
 */
import { fork, execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"
import * as mediasoup from "mediasoup"

const arg = (nome, omissao) => {
  const a = process.argv.find((x) => x.startsWith(`--${nome}=`))
  return a ? Number(a.split("=")[1]) : omissao
}
const PESSOAS = arg("pessoas", 50)
const CAMARAS = arg("camaras", 0)
const ECRAS = arg("ecras", 0)
const FALAM = arg("falam", PESSOAS)
const CHAMADAS = arg("chamadas", 1)
const SEGUNDOS = arg("segundos", 30)
const SUMIDOUROS = arg("sumidouros", 4)
const SO_JSON = process.argv.includes("--json")

// The caps from the product (packages/protocol/src/wire.ts), which this test does not change.
const TECTO_DA_CAMARA = 1_200_000
const TECTO_DO_ECRA = 2_500_000
const TECTO_DO_SOM_DO_ECRA = 64_000

// Copy of `CODECS` from apps/server/src/media.ts.
const CODECS = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    parameters: { useinbandfec: 1, usedtx: 1, "sprop-stereo": 0, maxaveragebitrate: 32000 },
  },
  { kind: "video", mimeType: "video/VP8", clockRate: 90000, parameters: { "x-google-start-bitrate": 600 } },
]

const log = (...a) => {
  if (!SO_JSON) console.log(...a)
}

/*
 * Also runs on Linux, in a container (see the report): there, memory is read
 * from the Docker VM's `/proc/meminfo`, and RSS from `/proc/<pid>`.
 */
const LINUX = process.platform === "linux"

function memoriaLivre() {
  if (LINUX) {
    const m = readFileSync("/proc/meminfo", "utf8")
    const kb = (k) => Number(m.match(new RegExp(`${k}:\\s+(\\d+)`))[1])
    return Math.round((kb("MemAvailable") / kb("MemTotal")) * 100)
  }
  const s = execFileSync("memory_pressure", { encoding: "utf8" })
  return Number(s.match(/free percentage: (\d+)%/)?.[1] ?? 0)
}

function rssKB(pid) {
  if (LINUX) return Number(readFileSync(`/proc/${pid}/status`, "utf8").match(/VmRSS:\s+(\d+)/)[1])
  return Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim())
}

const livreAntes = memoriaLivre()
if (livreAntes < 40) {
  console.error(`memória livre a ${livreAntes} %: o ensaio só arranca acima de 40 %`)
  process.exit(2)
}

const T0 = process.hrtime.bigint() / 1000n
const env = { ...process.env, CARGA_T0: String(T0) }
const aqui = (f) => fileURLToPath(new URL(f, import.meta.url))

const filhos = []
const esperar = (filho, tipo) => new Promise((ok) => {
  const h = (m) => {
    if (m.tipo === tipo) {
      filho.off("message", h)
      ok(m)
    }
  }
  filho.on("message", h)
})

const worker = await mediasoup.createWorker({ logLevel: "warn" })

// Sumidouros.
const sumidouros = []
for (let i = 0; i < SUMIDOUROS; i++) {
  const s = fork(aqui("./sumidouro.mjs"), { env })
  filhos.push(s)
  const { porta } = await esperar(s, "porta")
  sumidouros.push({ processo: s, porta })
}

const chave = () => randomBytes(44).toString("base64")
const listenInfo = { protocol: "udp", ip: "127.0.0.1" }
let ssrcSeguinte = 1000
let consumidores = 0
const esperado = { pps: 0, bps: 0 }

for (let c = 0; c < CHAMADAS; c++) {
  const router = await worker.createRouter({ mediaCodecs: CODECS })
  const ptOpus = router.rtpCapabilities.codecs.find((x) => x.mimeType === "audio/opus").preferredPayloadType
  const ptVp8 = router.rtpCapabilities.codecs.find((x) => x.mimeType === "video/VP8").preferredPayloadType
  if (c === 0) for (const s of sumidouros) s.processo.send({ tipo: "relogios", relogios: [[ptOpus, 48000], [ptVp8, 90000]] })

  const gerador = fork(aqui("./gerador.mjs"), { env })
  filhos.push(gerador)

  const pessoas = []
  const fluxos = []
  for (let p = 0; p < PESSOAS; p++) {
    const envio = await router.createPlainTransport({ listenInfo, rtcpMux: true, comedia: true })
    const recepcao = await router.createPlainTransport({
      listenInfo,
      rtcpMux: true,
      comedia: false,
      enableSrtp: true,
      srtpCryptoSuite: "AEAD_AES_256_GCM",
    })
    const sumidouro = sumidouros[(c * PESSOAS + p) % SUMIDOUROS]
    await recepcao.connect({
      ip: "127.0.0.1",
      port: sumidouro.porta,
      srtpParameters: { cryptoSuite: "AEAD_AES_256_GCM", keyBase64: chave() },
    })
    const produtores = []
    const produzir = async (tipo, bitrate, fps) => {
      const ssrc = ssrcSeguinte++
      const voz = tipo === "voz" || tipo === "som"
      const produtor = await envio.produce({
        kind: voz ? "audio" : "video",
        rtpParameters: {
          codecs: [
            voz
              ? { mimeType: "audio/opus", payloadType: ptOpus, clockRate: 48000, channels: 2, parameters: CODECS[0].parameters }
              : {
                  mimeType: "video/VP8",
                  payloadType: ptVp8,
                  clockRate: 90000,
                  rtcpFeedback: [{ type: "nack" }, { type: "nack", parameter: "pli" }, { type: "ccm", parameter: "fir" }],
                },
          ],
          encodings: [{ ssrc }],
          rtcp: { cname: `p${c}-${p}` },
        },
      })
      produtores.push(produtor)
      fluxos.push({ porta: envio.tuple.localPort, ssrc, pt: voz ? ptOpus : ptVp8, tipo: voz ? "voz" : "imagem", fala: tipo === "som" || p < FALAM, bitrate, fps })
    }
    await produzir("voz")
    if (p < CAMARAS) await produzir("imagem", TECTO_DA_CAMARA, 30)
    else if (p < CAMARAS + ECRAS) {
      await produzir("imagem", TECTO_DO_ECRA, 15)
      await produzir("som", TECTO_DO_SOM_DO_ECRA)
    }
    pessoas.push({ envio, recepcao, produtores })
  }

  // Each person consumes everything the others produce.
  for (const quem of pessoas) {
    for (const outra of pessoas) {
      if (outra === quem) continue
      for (const produtor of outra.produtores) {
        await quem.recepcao.consume({ producerId: produtor.id, rtpCapabilities: router.rtpCapabilities })
        consumidores++
      }
    }
  }

  // What should come out, to compare with what does come out.
  for (const f of fluxos) {
    const pps = f.tipo === "voz" ? (f.fala ? 50 : 2.5) : f.fps * Math.max(1, Math.ceil(f.bitrate / 8 / f.fps / 1150))
    const bps = f.tipo === "voz" ? (f.fala ? (96 + 12 + 28) * 8 * 50 : (3 + 12 + 28) * 8 * 2.5) : f.bitrate + pps * (12 + 4 + 28) * 8
    esperado.pps += pps * (PESSOAS - 1)
    esperado.bps += bps * (PESSOAS - 1)
  }

  gerador.send({ tipo: "fluxos", fluxos })
  await esperar(gerador, "pronto")
}

log(`montado: ${CHAMADAS} chamada(s) de ${PESSOAS}, ${CAMARAS} câmaras, ${ECRAS} ecrãs, ${FALAM} a falar; ${consumidores} consumidores`)

// Warm up: video consumers only start on the first keyframe.
await new Promise((r) => setTimeout(r, 5000))
for (const s of sumidouros) s.processo.send({ tipo: "zerar" })
const tZero = performance.now()

const amostras = []
let anterior = await worker.getResourceUsage()
let tAnterior = performance.now()
let rssMax = 0
let livreMin = 100
let abortado = false
for (let s = 0; s < SEGUNDOS; s++) {
  await new Promise((r) => setTimeout(r, 1000))
  const uso = await worker.getResourceUsage()
  const t = performance.now()
  const cpu = (uso.ru_utime + uso.ru_stime - anterior.ru_utime - anterior.ru_stime) / (t - tAnterior)
  amostras.push(cpu)
  anterior = uso
  tAnterior = t
  const rss = rssKB(worker.pid)
  rssMax = Math.max(rssMax, rss)
  if (s % 5 === 4) {
    const livre = memoriaLivre()
    livreMin = Math.min(livreMin, livre)
    if (livre < 25) {
      console.error(`memória livre desceu a ${livre} %: pára aqui`)
      abortado = true
      break
    }
  }
  log(`  ${String(s + 1).padStart(2)} s  worker ${(cpu * 100).toFixed(1).padStart(5)} % de um núcleo  rss ${(rss / 1024).toFixed(0)} MB`)
}
const leituras = await Promise.all(
  sumidouros.map((s) => {
    const p = esperar(s.processo, "leitura")
    s.processo.send({ tipo: "ler" })
    return p
  }),
)
// Rates divide by wall clock time between zero and read, not by the number
// of samples: each loop takes a little over a second, and with the worker
// saturated `getResourceUsage` takes time to respond.
const duracao = (performance.now() - tZero) / 1000
const soma = (k) => leituras.reduce((a, l) => a + l[k], 0)
const perdidos = soma("perdidos")
const esperados = soma("esperados")
const ordenadas = [...amostras].sort((a, b) => a - b)
const resultado = {
  pessoas: PESSOAS,
  camaras: CAMARAS,
  ecras: ECRAS,
  falam: FALAM,
  chamadas: CHAMADAS,
  consumidores,
  segundos: +duracao.toFixed(1),
  cpuMedia: +((amostras.reduce((a, b) => a + b, 0) / amostras.length) * 100).toFixed(1),
  cpuP95: +(ordenadas[Math.floor(amostras.length * 0.95)] * 100).toFixed(1),
  rssMB: Math.round(rssMax / 1024),
  ppsSaida: Math.round(soma("pacotes") / duracao),
  ppsEsperado: Math.round(esperado.pps),
  mbpsSaida: +((soma("bytes") * 8) / duracao / 1e6).toFixed(1),
  mbpsEsperado: +(esperado.bps / 1e6).toFixed(1),
  perdaPct: esperados ? +((perdidos / esperados) * 100).toFixed(3) : null,
  atrasoP50ms: Math.max(...leituras.map((l) => l.p50 ?? 0)),
  atrasoP99ms: Math.max(...leituras.map((l) => l.p99 ?? 0)),
  atrasoMaxMs: Math.max(...leituras.map((l) => l.max ?? 0)),
  memoriaLivreMin: livreMin,
  abortado,
}
if (SO_JSON) console.log(JSON.stringify(resultado))
else console.log(resultado)

for (const f of filhos) f.send({ tipo: "parar" })
worker.close()
setTimeout(() => process.exit(0), 300)
