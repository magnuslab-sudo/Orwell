/**
 * The screen testbed page. Two roles, one per browser:
 *
 *   ?papel=emissor   draws a "screen" on a canvas (small text, like code or a
 *                    document), produces it as the product produces screen (VP8,
 *                    one encoding, `maxBitrate` 2.5 Mbit/s, `contentHint =
 *                    "detail"`), and encrypts each frame with the product's
 *                    SFrame.
 *   ?papel=receptor  consumes paused, resumes DELAY seconds later (starting to
 *                    watch mid-stream), decrypts, and measures.
 *
 * The cipher format is chosen via `cifra=`:
 *
 *   nenhuma  the control: no cipher. What mediasoup and Chrome do when they see
 *            VP8 for real.
 *   antiga   the whole frame encrypted, SFrame header in front (1.0.5).
 *   nova     the first bytes of VP8 in the clear (10 in a keyframe, 3 in a
 *            delta), authenticated, and the rest encrypted (1.0.6).
 *
 * What the receiver measures after resuming:
 *  - what CHROME thinks each frame is (`frame.type` in the transform, from the
 *    RTP depacker) against what it actually IS (the bit in the VP8 after
 *    decryption);
 *  - how many frames reach the decoder before the first keyframe;
 *  - `keyFramesDecoded`, `pliCount`, `firCount`, `framesDropped`, resolution;
 *  - frame ERROR: the fixed zone of the "screen" compared pixel-by-pixel with
 *    the same zone drawn here by the same code. Zero is identical; a corrupted
 *    image goes up and stays up.
 *
 * `perda=0.02` drops 2% of encrypted frames before decryption: a frame that did
 * not arrive complete, the normal case on a real network.
 */
import * as mediasoupClient from "mediasoup-client"
import { bytesEmClaroDoVp8, importSframeKey, SframeReceiver, SframeSender } from "../../packages/crypto/src/sframe.ts"

const parametros = new URLSearchParams(location.search)
const PAPEL = parametros.get("papel") ?? "emissor"
const CIFRA = parametros.get("cifra") ?? "antiga"
const EPOCA = Number(parametros.get("epoca") ?? 41)
const PERDA = Number(parametros.get("perda") ?? 0)
const ATRASO = Number(parametros.get("atraso") ?? 5)
const LARGURA = 1920
const ALTURA = 1080
const TECTO = 2_500_000

const estado = { papel: PAPEL, cifra: CIFRA, epoca: EPOCA, pronto: false, erro: undefined, amostras: [], fotogramas: [] }
window.__medida = estado

const registo = (texto) => {
  document.getElementById("registo").textContent += `${texto}\n`
}

// ------------------------------------------------------------------ sinal

const ligacao = new WebSocket(`ws://${location.host}/sinal`)
const pendentes = new Map()
let proximoId = 1
ligacao.onmessage = (evento) => {
  const frame = JSON.parse(evento.data)
  const { resolver, rejeitar } = pendentes.get(frame.id) ?? {}
  pendentes.delete(frame.id)
  if (frame.erro) rejeitar?.(new Error(frame.erro))
  else resolver?.(frame.ok)
}
function pedir(t, dados = {}) {
  const id = proximoId++
  return new Promise((resolver, rejeitar) => {
    pendentes.set(id, { resolver, rejeitar })
    ligacao.send(JSON.stringify({ id, t, ...dados }))
  })
}
window.__pedir = pedir
await new Promise((pronto) => {
  ligacao.onopen = pronto
})

// ------------------------------------------------------------ the "screen"

/** A seeded pseudo-random generator: sender and receiver draw the same thing. */
function semente(n) {
  let s = n >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const PALAVRAS = ["const", "await", "frame", "chave", "receptor", "if", "return", "=>", "{", "}", "VP8", "nonce", "0x01", "SFrame"]

/** The fixed zone: 46 lines of small text. This is what we compare. */
const ZONA = { x: 0, y: 0, l: 1100, a: 760 }
function desenharZonaFixa(ctx) {
  ctx.fillStyle = "#fff"
  ctx.fillRect(ZONA.x, ZONA.y, ZONA.l, ZONA.a)
  ctx.fillStyle = "#111"
  ctx.font = "13px monospace"
  const r = semente(7)
  for (let linha = 0; linha < 46; linha++) {
    let texto = `${String(linha + 1).padStart(3)}  `
    const n = 4 + Math.floor(r() * 9)
    for (let i = 0; i < n; i++) texto += `${PALAVRAS[Math.floor(r() * PALAVRAS.length)]} `
    ctx.fillText(texto, 8, 16 + linha * 16)
  }
}

function desenharEcra(ctx, instante) {
  ctx.fillStyle = "#f4f4f4"
  ctx.fillRect(0, 0, LARGURA, ALTURA)
  desenharZonaFixa(ctx)
  // The moving part: a clock, a line being written, and a cursor, like someone
  // sharing an editor and typing. Little motion, which is how screen behaves.
  ctx.fillStyle = "#123"
  ctx.font = "22px monospace"
  ctx.fillText(`t = ${(instante / 1000).toFixed(2)} s`, 1200, 60)
  const r = semente(Math.floor(instante / 400))
  ctx.font = "13px monospace"
  for (let linha = 0; linha < 14; linha++) {
    ctx.fillText(`${PALAVRAS[Math.floor(r() * PALAVRAS.length)]} ${Math.floor(r() * 1e6)}`, 1200, 120 + linha * 16)
  }
  ctx.fillStyle = "#c22"
  ctx.fillRect(1200 + ((instante / 10) % 600), 900, 40, 40)
}

// ------------------------------------------------------------------ cifra

const MATERIAL = new Uint8Array(28).map((_, i) => (i * 37 + 11) & 0xff)
const chave = await importSframeKey(MATERIAL, EPOCA % 65536, 0)

const ehVideo = (frame) => "type" in frame

// ------------------------------------------------------------------ correr

try {
  if (PAPEL === "emissor") await emissor()
  else await receptor()
  estado.pronto = true
} catch (erro) {
  estado.erro = String(erro?.stack ?? erro)
  registo(`ERRO: ${estado.erro}`)
}

async function dispositivo() {
  const { rtpCapabilities } = await pedir("ola")
  const device = new mediasoupClient.Device()
  await device.load({ routerRtpCapabilities: rtpCapabilities })
  return device
}

function transporte(device, dados, sentido) {
  const t =
    sentido === "envio"
      ? device.createSendTransport({ ...dados, additionalSettings: { encodedInsertableStreams: true } })
      : device.createRecvTransport({ ...dados, additionalSettings: { encodedInsertableStreams: true } })
  t.on("connect", ({ dtlsParameters }, feito, falhou) => {
    pedir("transporte.ligar", { transporte: t.id, dtlsParameters }).then(() => feito(), falhou)
  })
  return t
}

async function emissor() {
  const device = await dispositivo()
  const canvas = document.createElement("canvas")
  canvas.width = LARGURA
  canvas.height = ALTURA
  const ctx = canvas.getContext("2d")
  const inicio = performance.now()
  const desenhar = () => {
    desenharEcra(ctx, performance.now() - inicio)
    requestAnimationFrame(desenhar)
  }
  desenhar()
  // `setInterval` too, because rAF stops on an unfocused tab.
  setInterval(() => desenharEcra(ctx, performance.now() - inicio), 66)

  const faixa = canvas.captureStream(15).getVideoTracks()[0]
  faixa.contentHint = "detail"

  const t = transporte(device, await pedir("transporte.criar"), "envio")
  t.on("produce", ({ kind, rtpParameters }, feito, falhou) => {
    pedir("produzir", { transporte: t.id, kind, rtpParameters }).then(({ id }) => feito({ id }), falhou)
  })
  const produtor = await t.produce({ track: faixa, encodings: [{ maxBitrate: TECTO }] })

  const sender = new SframeSender(chave, 0)
  const { readable, writable } = produtor.rtpSender.createEncodedStreams()
  void readable
    .pipeThrough(
      new TransformStream({
        async transform(frame, controlador) {
          const bytes = new Uint8Array(frame.data)
          estado.fotogramas.push({ t: Date.now(), chave: frame.type === "key", bytes: bytes.length })
          if (CIFRA === "antiga") frame.data = (await sender.encrypt(bytes)).buffer
          else if (CIFRA === "nova") frame.data = (await sender.encrypt(bytes, ehVideo(frame) ? bytesEmClaroDoVp8(bytes) : 0)).buffer
          controlador.enqueue(frame)
        },
      }),
    )
    .pipeTo(writable)

  registo(`a produzir ${produtor.id}, cifra ${CIFRA}, epoca ${EPOCA}`)
  let anterior
  setInterval(async () => {
    for (const linha of (await produtor.rtpSender.getStats()).values()) {
      if (linha.type !== "outbound-rtp") continue
      const agora = { t: linha.timestamp, bytes: linha.bytesSent ?? 0, frames: linha.framesEncoded ?? 0, qp: linha.qpSum ?? 0 }
      estado.amostras.push({
        t: Date.now(),
        chavesCodificadas: linha.keyFramesEncoded,
        plisRecebidos: linha.pliCount,
        firsRecebidos: linha.firCount,
        resolucao: `${linha.frameWidth}x${linha.frameHeight}`,
        fps: linha.framesPerSecond,
        limite: linha.qualityLimitationReason,
        bitrate: anterior ? Math.round(((agora.bytes - anterior.bytes) * 8) / ((agora.t - anterior.t) / 1000)) : null,
        qp: anterior && agora.frames > anterior.frames ? (agora.qp - anterior.qp) / (agora.frames - anterior.frames) : null,
      })
      anterior = agora
    }
  }, 500)
}

async function receptor() {
  const device = await dispositivo()
  let produtorId
  for (let volta = 0; volta < 100 && !produtorId; volta++) {
    produtorId = (await pedir("produtores")).ids[0]
    if (!produtorId) await new Promise((r) => setTimeout(r, 200))
  }
  if (!produtorId) throw new Error("sem produtor")

  const t = transporte(device, await pedir("transporte.criar"), "recepcao")
  const params = await pedir("consumir", { transporte: t.id, produtor: produtorId, rtpCapabilities: device.rtpCapabilities })
  const consumidor = await t.consume({
    id: params.id,
    producerId: params.produtor,
    kind: params.kind,
    rtpParameters: params.rtpParameters,
  })

  const receiver = new SframeReceiver(chave)
  const r = semente(99)
  const { readable, writable } = consumidor.rtpReceiver.createEncodedStreams()
  void readable
    .pipeThrough(
      new TransformStream({
        async transform(frame, controlador) {
          let bytes = new Uint8Array(frame.data)
          if (PERDA > 0 && r() < PERDA) {
            estado.fotogramas.push({ t: Date.now(), perdido: true })
            return
          }
          if (CIFRA !== "nenhuma") {
            const aberto = await receiver.decrypt(bytes)
            if (!aberto) {
              estado.fotogramas.push({ t: Date.now(), falhou: true })
              return
            }
            bytes = aberto
            frame.data = aberto.buffer
          }
          // What Chrome thinks (from the RTP depacker) and what VP8 says.
          estado.fotogramas.push({ t: Date.now(), chromeJulgaChave: frame.type === "key", eChave: (bytes[0] & 0x01) === 0 })
          controlador.enqueue(frame)
        },
      }),
    )
    .pipeTo(writable)

  const video = document.getElementById("recebido")
  video.srcObject = new MediaStream([consumidor.track])
  void video.play().catch(() => {})

  // Start watching mid-stream: the sender has been sharing for DELAY seconds.
  await new Promise((r) => setTimeout(r, ATRASO * 1000))
  const { instante } = await pedir("retomar", { consumidor: params.id })
  estado.retomadoNoServidor = instante
  estado.retomado = Date.now()
  registo(`retomado ao fim de ${ATRASO} s`)

  // The reference of the fixed zone, drawn by the same code.
  const referencia = document.createElement("canvas")
  referencia.width = LARGURA
  referencia.height = ALTURA
  const rctx = referencia.getContext("2d", { willReadFrequently: true })
  desenharZonaFixa(rctx)
  const ref = rctx.getImageData(ZONA.x, ZONA.y, ZONA.l, ZONA.a).data
  const tela = document.createElement("canvas")
  tela.width = LARGURA
  tela.height = ALTURA
  const tctx = tela.getContext("2d", { willReadFrequently: true })

  setInterval(async () => {
    let erro = null
    if (video.videoWidth > 0) {
      tctx.drawImage(video, 0, 0, LARGURA, ALTURA)
      const px = tctx.getImageData(ZONA.x, ZONA.y, ZONA.l, ZONA.a).data
      let soma = 0
      for (let i = 0; i < px.length; i += 4) soma += Math.abs(px[i] - ref[i]) + Math.abs(px[i + 1] - ref[i + 1]) + Math.abs(px[i + 2] - ref[i + 2])
      erro = Number((soma / ((px.length / 4) * 3)).toFixed(2))
    }
    for (const linha of (await consumidor.rtpReceiver.getStats()).values()) {
      if (linha.type !== "inbound-rtp") continue
      estado.amostras.push({
        t: Date.now(),
        descodificados: linha.framesDecoded,
        chavesDescodificadas: linha.keyFramesDecoded,
        plisEnviados: linha.pliCount,
        firsEnviados: linha.firCount,
        nacks: linha.nackCount,
        perdidosRtp: linha.packetsLost,
        largados: linha.framesDropped,
        congelamentos: linha.freezeCount,
        resolucao: `${linha.frameWidth}x${linha.frameHeight}`,
        erro,
      })
    }
  }, 500)
}
