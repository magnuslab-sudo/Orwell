/**
 * The measurement page: a 1280×720 camera produced with a bitrate cap, and the
 * same bandwidth consumed back by the SFU.
 *
 * One page, not two, unlike Phase 0: what we measure here is not the transit,  * that is proven, but what the ENCODER does when given a cap. The sender
 * decides this, and the producer's own consumption measures what leaves the
 * router (the SFU bottleneck) without needing a second browser competing for the
 * same CPU, which would skew the encoder measurement.
 *
 * Collected each second from the `outbound-rtp` of the sender:
 *
 *  - `frameWidth`/`frameHeight`, the ACTUAL encoded resolution. This shows the
 *    difference between "I asked for 720p" and "I am sending 720p": when the cap
 *    is too tight, Chrome drops resolution on its own and tells nobody.
 *  - `qpSum`/`framesEncoded`, the average QP. For VP8 it is the number that
 *    says if the image is sharp or mushy: below ~30 it reads well, above ~40 it
 *    is noise.
 *  - `qualityLimitationReason`, Chrome's own word on what is limiting it:
 *    `bandwidth`, `cpu`, or `none`.
 *  - `bytesSent`, the achieved bitrate, which is what the machine pays.
 *
 * All in `window.__medida`, which `medir.mjs` comes to read.
 */
import * as mediasoupClient from "mediasoup-client"

const parametros = new URLSearchParams(location.search)
const TECTO = Number(parametros.get("tecto") ?? 600_000)
const LARGURA = Number(parametros.get("largura") ?? 1280)
const ALTURA = Number(parametros.get("altura") ?? 720)

const estado = {
  tecto: TECTO,
  pedido: `${LARGURA}x${ALTURA}`,
  pronto: false,
  erro: undefined,
  capturado: undefined,
  amostras: [],
  recebido: undefined,
}
window.__medida = estado

const registo = (texto) => {
  document.getElementById("registo").textContent += `${texto}\n`
}

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

await new Promise((pronto) => {
  ligacao.onopen = pronto
})

try {
  await correr()
  estado.pronto = true
} catch (erro) {
  estado.erro = String(erro?.message ?? erro)
  registo(`ERRO: ${estado.erro}`)
}

async function correr() {
  const { rtpCapabilities } = await pedir("ola")
  const device = new mediasoupClient.Device()
  await device.load({ routerRtpCapabilities: rtpCapabilities })

  // Camera requested the way the product requests it: `ideal` not `exact`, which
  // lets the browser give what the camera has. See `videoConstraints` in
  // `call.ts`. What arrives here is the y4m file that Chrome pretends is a camera.
  const fluxo = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: LARGURA }, height: { ideal: ALTURA }, frameRate: { ideal: 30 } },
  })
  const faixa = fluxo.getVideoTracks()[0]
  const definicoes = faixa.getSettings()
  estado.capturado = `${definicoes.width}x${definicoes.height}@${definicoes.frameRate}`
  registo(`capturado: ${estado.capturado}`)

  const envio = await pedir("transporte.criar")
  const transporteDeEnvio = device.createSendTransport(envio)
  transporteDeEnvio.on("connect", ({ dtlsParameters }, feito, falhou) => {
    pedir("transporte.ligar", { transporte: transporteDeEnvio.id, dtlsParameters }).then(() => feito(), falhou)
  })
  transporteDeEnvio.on("produce", ({ kind, rtpParameters }, feito, falhou) => {
    pedir("produzir", { transporte: transporteDeEnvio.id, kind, rtpParameters }).then(({ id }) => feito({ id }), falhou)
  })

  // The cap, declared exactly as the product declares it in `call-sfu.ts`: one
  // encoding only, with `maxBitrate`. No simulcast, the product does not have it,
  // and measuring with it would be measuring a different platform.
  const produtor = await transporteDeEnvio.produce({
    track: faixa,
    encodings: [{ maxBitrate: TECTO }],
  })
  registo(`a produzir ${produtor.id} com tecto ${TECTO}`)

  const recepcao = await pedir("transporte.criar")
  const transporteDeRecepcao = device.createRecvTransport(recepcao)
  transporteDeRecepcao.on("connect", ({ dtlsParameters }, feito, falhou) => {
    pedir("transporte.ligar", { transporte: transporteDeRecepcao.id, dtlsParameters }).then(() => feito(), falhou)
  })
  const params = await pedir("consumir", {
    transporte: transporteDeRecepcao.id,
    produtor: produtor.id,
    rtpCapabilities: device.rtpCapabilities,
  })
  const consumidor = await transporteDeRecepcao.consume({
    id: params.id,
    producerId: params.produtor,
    kind: params.kind,
    rtpParameters: params.rtpParameters,
  })
  document.getElementById("recebido").srcObject = new MediaStream([consumidor.track])
  await pedir("retomar", { consumidor: params.id })

  // The server's own stats, on request from the measurer: what it received and
  // what it sent, as it counts it. This is the other half of the same truth, the
  // browser says what it thinks it sent, and the router says what passed through.
  window.__contas = () => pedir("contas")

  // One sample per second, with deltas already computed: we care about steady
  // state, and any encoder's first second is a ramp.
  let anterior
  setInterval(async () => {
    const linhas = await produtor.rtpSender.getStats()
    let saida
    for (const linha of linhas.values()) if (linha.type === "outbound-rtp") saida = linha
    if (!saida) return
    const agora = {
      t: saida.timestamp,
      bytes: saida.bytesSent ?? 0,
      frames: saida.framesEncoded ?? 0,
      qp: saida.qpSum ?? 0,
      largura: saida.frameWidth,
      altura: saida.frameHeight,
      limite: saida.qualityLimitationReason,
      alvo: saida.targetBitrate,
    }
    if (anterior) {
      const segundos = (agora.t - anterior.t) / 1000
      const frames = agora.frames - anterior.frames
      estado.amostras.push({
        bitrate: Math.round(((agora.bytes - anterior.bytes) * 8) / segundos),
        fps: Number((frames / segundos).toFixed(1)),
        qp: frames > 0 ? Number(((agora.qp - anterior.qp) / frames).toFixed(1)) : null,
        resolucao: `${agora.largura}x${agora.altura}`,
        limite: agora.limite,
        alvo: agora.alvo,
      })
    }
    anterior = agora

    const entradas = await consumidor.rtpReceiver.getStats()
    for (const linha of entradas.values()) {
      if (linha.type === "inbound-rtp") {
        estado.recebido = {
          resolucao: `${linha.frameWidth}x${linha.frameHeight}`,
          descodificados: linha.framesDecoded,
          bytes: linha.bytesReceived,
        }
      }
    }
  }, 1000)
}
