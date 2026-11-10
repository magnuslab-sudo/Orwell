/**
 * The page for the microphone-recovery proof, with two roles (`?papel=`).
 *
 * `emissor`: the ENTIRE `Call` of the product (`packages/client-core/dist/call.js`),
 * with the true voice chain (the worklet and gtcrn) and true encryption,
 * connected to the minimal Phase 0 SFU. Under the product, and without it
 * knowing, the page counts the frames that COME OUT of the encryption transform
 * and whether each one has an SFrame header, and saves the captures and audio
 * nodes the product opens, so the script can kill them halfway.
 *
 * `ouvinte`: the `MotorSfu` and `CifraDeMedia` of the product consuming the
 * sender's voice through the SFU, and an analyzer on what comes out of decryption.
 * It is the "can I hear you or not" measured from the other side.
 *
 * Sender scenarios (`?cenario=`): `faixa-termina`, `worklet-rebenta`,
 * `contexto-preso` and `cifra-tarda` (the key arrives only 3 s after entry).
 */
import { readHeader } from "@enclave/crypto"
import { Device } from "mediasoup-client"
import { VigiaDoMicrofone } from "../../packages/client-core/dist/audio/vigia-do-microfone.js"
import { Call } from "../../packages/client-core/dist/call.js"
import { MotorSfu } from "../../packages/client-core/dist/call-sfu.js"
import { CifraDeMedia } from "../../packages/client-core/dist/media-sframe.js"
import { KEY_ID, materialEmBytes, SENDER_ID } from "../sfu-prova/chave-de-teste.mjs"

const parametros = new URLSearchParams(location.search)
const PAPEL = parametros.get("papel") ?? "emissor"
const CENARIO = parametros.get("cenario") ?? "faixa-termina"
const SABOTAGEM = parametros.get("sabotagem") ?? ""
const EMISSOR = "@prova:local"
const CANAL = "!prova:local"
const AMBITO = "a".repeat(43)
const MATERIAL = { keyId: KEY_ID, senderId: SENDER_ID, material: materialEmBytes() }

const estado = {
  papel: PAPEL,
  cenario: CENARIO,
  pronto: false,
  erro: undefined,
  diagnosticos: [],
  erros: [],
  terminou: false,
  framesQueSairamDaCifra: 0,
  framesSemCabecalho: 0,
  pacotesEnviados: 0,
  niveis: [],
}
window.__prova = estado
const t0 = performance.now()
const agora = () => Math.round(performance.now() - t0)

// --- the signaling of `sfu-prova/servidor.mjs` --------------------------------
const ws = new WebSocket(`ws://${location.host}/sinal`)
const pendentes = new Map()
let proximo = 1
ws.onmessage = (evento) => {
  const frame = JSON.parse(evento.data)
  if (frame.id === undefined) return
  const { resolver, rejeitar } = pendentes.get(frame.id) ?? {}
  pendentes.delete(frame.id)
  if (frame.erro) rejeitar?.(new Error(frame.erro))
  else resolver?.(frame.ok)
}
const pedir = (t, dados = {}) => {
  const id = proximo++
  return new Promise((resolver, rejeitar) => {
    pendentes.set(id, { resolver, rejeitar })
    ws.send(JSON.stringify({ id, t, ...dados }))
  })
}
await new Promise((pronto) => {
  ws.onopen = pronto
})

const sinalizacao = {
  async sfuEntrarNoAmbito() {
    const { rtpCapabilities, produtores } = await pedir("ola")
    // The one already on air is the sender: the listener joins after.
    const producers = PAPEL === "ouvinte" ? produtores.map((id) => ({ id, kind: "audio", address: EMISSOR, fonte: "microfone" })) : []
    return { rtpCapabilities, producers }
  },
  sfuSairDoAmbito() {},
  sfuCriarTransporte: () => pedir("transporte.criar"),
  sfuLigarTransporte: (transporte, dtlsParameters) => pedir("transporte.ligar", { transporte, dtlsParameters }),
  async sfuProduzir(transporte, kind, rtpParameters) {
    return (await pedir("produzir", { transporte, kind, rtpParameters })).id
  },
  sfuFecharProdutor: (produtor) => pedir("produtor.fechar", { produtor }),
  async sfuConsumir(transporte, produtor, rtpCapabilities) {
    const r = await pedir("consumir", { transporte, produtor, rtpCapabilities })
    return { id: r.id, producerId: r.produtor, kind: r.kind, rtpParameters: r.rtpParameters }
  },
  sfuRetomar: (transporte, consumidor) => pedir("retomar", { transporte, consumidor }),
  sfuPausar: async () => {},
}

/** The peak of a track's signal, read by a separate context, every 250 ms. */
function medirNivel(faixa, onde = estado.niveis) {
  const contexto = new (window.__ContextoOriginal ?? AudioContext)()
  const analisador = contexto.createAnalyser()
  analisador.fftSize = 2048
  contexto.createMediaStreamSource(new MediaStream([faixa])).connect(analisador)
  const amostras = new Float32Array(analisador.fftSize)
  let pico = 0
  setInterval(() => {
    analisador.getFloatTimeDomainData(amostras)
    for (const v of amostras) pico = Math.max(pico, Math.abs(v))
  }, 20)
  setInterval(() => {
    onde.push([agora(), Number(pico.toFixed(4))])
    pico = 0
  }, 250)
}

if (PAPEL === "ouvinte") {
  // The frames that COME OUT of decryption, per 250 ms window: "their voice reached me".
  estado.decifrados = []
  let decifrados = 0
  const abrirReceptor = RTCRtpReceiver.prototype.createEncodedStreams
  RTCRtpReceiver.prototype.createEncodedStreams = function () {
    const par = abrirReceptor.call(this)
    const escritor = par.writable.getWriter()
    const contado = new WritableStream({
      async write(frame) {
        decifrados++
        await escritor.write(frame)
      },
    })
    return { readable: par.readable, writable: contado }
  }
  setInterval(() => {
    estado.decifrados.push([agora(), decifrados])
    decifrados = 0
  }, 250)
  const cifra = new CifraDeMedia(
    { selfAddress: "@ouvinte:local", mediaKey: async (_c, quem) => (quem === EMISSOR ? MATERIAL : null), reservarContadorSframe: async () => 5000 },
    (code, detail) => estado.diagnosticos.push(detail ? `${code}:${detail}` : code),
  )
  const motor = new MotorSfu({
    sinalizacao,
    cifra,
    criarDispositivo: () => new Device(),
    aoDiagnosticar: (code, detail) => estado.diagnosticos.push(detail ? `${code}:${detail}` : code),
    aoMudar: () => {
      const fluxo = motor.fluxos().find((cada) => cada.address === EMISSOR)
      const faixa = fluxo?.stream?.getAudioTracks()[0]
      if (!faixa || estado.aMedir) return
      estado.aMedir = true
      // Chromium only delivers remote sound to WebAudio with an element playing it.
      const elemento = document.getElementById("som")
      elemento.srcObject = new MediaStream([faixa])
      elemento.muted = true
      void elemento.play().catch(() => {})
      medirNivel(faixa)
    },
    verOEcraDe: () => false,
  })
  try {
    await motor.entrar(CANAL, AMBITO, null)
    estado.pronto = true
  } catch (erro) {
    estado.erro = String(erro?.message ?? erro)
  }
} else {
  // --- the sender's instrumentation, before the product existed -----------------
  const ligacoes = []
  const LigacaoOriginal = window.RTCPeerConnection
  window.RTCPeerConnection = class extends LigacaoOriginal {
    constructor(...argumentos) {
      super(...argumentos)
      ligacoes.push(this)
    }
  }
  const abrirOriginal = RTCRtpSender.prototype.createEncodedStreams
  RTCRtpSender.prototype.createEncodedStreams = function () {
    const par = abrirOriginal.call(this)
    const escritor = par.writable.getWriter()
    const contado = new WritableStream({
      async write(frame) {
        estado.framesQueSairamDaCifra++
        if (!readHeader(new Uint8Array(frame.data))) estado.framesSemCabecalho++
        await escritor.write(frame)
      },
    })
    return { readable: par.readable, writable: contado }
  }
  const capturas = []
  const pedirMicrofone = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = async (pedido) => {
    const fluxo = await pedirMicrofone(pedido)
    capturas.push(fluxo)
    estado.capturas = capturas.length
    return fluxo
  }
  const nos = []
  const NoOriginal = window.AudioWorkletNode
  window.AudioWorkletNode = class extends NoOriginal {
    constructor(...argumentos) {
      super(...argumentos)
      nos.push(this)
    }
  }
  const contextos = []
  const ContextoOriginal = window.AudioContext
  window.__ContextoOriginal = ContextoOriginal
  window.AudioContext = class extends ContextoOriginal {
    constructor(...argumentos) {
      super(...argumentos)
      contextos.push(this)
    }
  }

  // The sabotage that MUST make the proof fail: without a watch, no one notices the death.
  if (SABOTAGEM === "sem-vigia") VigiaDoMicrofone.prototype.ligar = function () {}

  let comChave = CENARIO !== "cifra-tarda"
  const call = new Call({
    selfAddress: EMISSOR,
    sendSignal: async () => {},
    mediaKey: async () => (comChave ? MATERIAL : null),
    reservarContadorSframe: async () => 1000,
    sfu: { suportaSfu: () => true, criarDispositivo: () => new Device(), ...sinalizacao },
  })
  call.on("diagnostic", (e) => estado.diagnosticos.push(`${agora()} ${e.code}${e.detail ? `:${e.detail}` : ""}`))
  call.on("error", (e) => estado.erros.push(e.detail))
  call.on("ended", () => (estado.terminou = true))
  // What comes out of the product's microphone, at the sender's input: each capture has its own series.
  estado.niveisDaSaida = []
  call.on("local", (e) => {
    const faixa = e.stream?.getAudioTracks()[0]
    if (!faixa) return
    const serie = []
    estado.niveisDaSaida.push(serie)
    medirNivel(faixa, serie)
  })

  window.__chaveChega = () => {
    comChave = true
    void call.rekey(CANAL)
  }
  /** Kill the microphone halfway, by the scenario's cause. */
  window.__matar = () => {
    estado.morteEm = agora()
    if (CENARIO === "faixa-termina") {
      // The device disappears: the raw track ends.
      for (const faixa of capturas.at(-1).getAudioTracks()) faixa.stop()
    } else if (CENARIO === "worklet-rebenta") {
      // A setting the `process()` cannot take: throw it in, and the node fires
      // `processorerror` and starts giving silence.
      nos.at(-1).port.postMessage({ tipo: "configurar", config: null })
    } else if (CENARIO === "contexto-preso") {
      // A suspended context that refuses to come back (the system took away its audio).
      const contexto = contextos.filter((cada) => cada.state === "running").at(-1)
      contexto.resume = () => Promise.reject(new DOMException("preso", "InvalidStateError"))
      void contexto.suspend()
    }
  }
  window.__contarPacotes = async () => {
    let total = 0
    for (const ligacao of ligacoes) {
      const relatorio = await ligacao.getStats().catch(() => null)
      relatorio?.forEach((linha) => {
        if (linha.type === "outbound-rtp" && linha.kind === "audio") total += linha.packetsSent ?? 0
      })
    }
    estado.pacotesEnviados = total
    estado.canal = call.channel
    estado.cadeia = call.audio.temCadeia
    return total
  }

  /*
    The voice chain stays (it is what gets killed in two scenarios), but without
    suppression and without the gate: the tone of Chromium's fake device is
    stationary, and to gtcrn a stationary tone is noise. With both on, the
    listener would measure suppression working, not the microphone.
  */
  await call.audio.definirEtapa("supressao", false).catch(() => {})
  await call.audio.definirEtapa("gate", false).catch(() => {})
  try {
    await call.join(CANAL)
    estado.pronto = true
  } catch (erro) {
    estado.erro = String(erro?.message ?? erro)
  }
  if (CENARIO === "cifra-tarda") setTimeout(() => window.__chaveChega(), 3000)
}
