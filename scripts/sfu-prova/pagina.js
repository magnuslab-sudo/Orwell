/**
 * The proof page: one side encrypts and produces, the other consumes and decrypts.
 *
 * This is where the two client guesses are decided, and the design is for them:
 *
 *  1. `additionalSettings: { encodedInsertableStreams: true }` reaches the
 *     constructor of the `RTCPeerConnection` that mediasoup-client makes inside?
 *     If it does not reach, `createEncodedStreams()` throws `InvalidStateError` and there is no
 *     encryption. The proof measures this for real: `?sabotagem=sem-insertable`
 *     removes the `additionalSettings` and the page MUST fail.
 *  2. `producer.rtpSender` and `consumer.rtpReceiver` exist? They are the objects
 *     that encryption hangs from. If they are `undefined`, `call.ts` has nowhere to
 *     hang and the piece choice opens again.
 *
 * The encryption is from the product, `SframeSender`/`SframeReceiver` from
 * `@enclave/crypto`, without a single line adapted, and the key is a test constant. In
 * the real application it comes from the MLS exporter of the epoch; here there is
 * no MLS, and that is not what is being proved.
 *
 * The page writes everything it measured to `window.__prova`, which is what
 * `prova.mjs` will read from the other side of Playwright.
 */
import { importSframeKey, SframeReceiver, SframeSender } from "@enclave/crypto"
import * as mediasoupClient from "mediasoup-client"
import { KEY_ID, materialEmBytes, SENDER_ID } from "./chave-de-teste.mjs"

const parametros = new URLSearchParams(location.search)
const PAPEL = parametros.get("papel") ?? "emissor"
const SABOTAGEM = parametros.get("sabotagem") ?? ""

const estado = {
  papel: PAPEL,
  sabotagem: SABOTAGEM,
  pronto: false,
  erro: undefined,
  // What we learned about mediasoup-client, which is half the point of the phase.
  temRtpSender: undefined,
  temRtpReceiver: undefined,
  insertableNoEmissor: undefined,
  insertableNoReceptor: undefined,
  handler: undefined,
  // As contagens.
  framesCifrados: 0,
  framesRecebidos: 0,
  framesDecifrados: 0,
  framesSemCabecalho: 0,
  framesRecusados: 0,
  primeiroCabecalho: undefined,
  ultimoCabecalho: undefined,
  stats: undefined,
  energiaDeAudio: 0,
  rms: 0,
}
window.__prova = estado

const registo = (texto) => {
  document.getElementById("registo").textContent += `${texto}\n`
}

// --- signaling, as raw as possible ------------------------------------------
const ligacao = new WebSocket(`ws://${location.host}/sinal`)
const pendentes = new Map()
let proximoId = 1
const escutas = new Map()

ligacao.onmessage = (evento) => {
  const frame = JSON.parse(evento.data)
  if (frame.id !== undefined) {
    const { resolver, rejeitar } = pendentes.get(frame.id) ?? {}
    pendentes.delete(frame.id)
    if (frame.erro) rejeitar?.(new Error(frame.erro))
    else resolver?.(frame.ok)
    return
  }
  escutas.get(frame.t)?.(frame)
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
  const chave = await importSframeKey(chaveDaProva(), KEY_ID, SENDER_ID)
  const { rtpCapabilities, produtores } = await pedir("ola")

  const device = new mediasoupClient.Device()
  await device.load({ routerRtpCapabilities: rtpCapabilities })
  estado.handler = device.handlerName
  registo(`handler do mediasoup-client: ${device.handlerName}`)

  if (PAPEL === "emissor") await emitir(device, chave)
  else await receber(device, chave, produtores)
}

/**
 * The key this side uses.
 *
 * `?sabotagem=chave-errada` swaps one byte, and only on the RECEIVER, on purpose. If
 * it swapped on both, both would still understand each other and what would fail was just the
 * analysis out there; this way the count of decrypted frames must go
 * to zero, and that count is what the proof says it is measuring.
 */
function chaveDaProva() {
  const material = materialEmBytes()
  if (SABOTAGEM === "chave-errada" && PAPEL === "receptor") material[0] ^= 0xff
  return material
}

/**
 * The transport adjustments that connect the insertable streams.
 *
 * `encodedInsertableStreams` is not in the standard `RTCConfiguration`, it is
 * a Chromium extension, and so the only way to know if
 * mediasoup-client lets it through is to try.
 */
function ajustesDoTransporte() {
  if (SABOTAGEM === "sem-insertable") return {}
  return { additionalSettings: { encodedInsertableStreams: true } }
}

async function emitir(device, chave) {
  const parametros = await pedir("transporte.criar")
  const transporte = device.createSendTransport({ ...parametros, ...ajustesDoTransporte() })

  transporte.on("connect", ({ dtlsParameters }, feito, falhou) => {
    pedir("transporte.ligar", { transporte: transporte.id, dtlsParameters }).then(() => feito(), falhou)
  })
  transporte.on("produce", ({ kind, rtpParameters }, feito, falhou) => {
    pedir("produzir", { transporte: transporte.id, kind, rtpParameters }).then(({ id }) => feito({ id }), falhou)
  })

  const fluxo = await navigator.mediaDevices.getUserMedia({ audio: true })
  const emissorSframe = new SframeSender(chave, 1000)

  const produtor = await transporte.produce({
    track: fluxo.getAudioTracks()[0],
    // The same two containment measures the router asks for, stated from the side
    // of the encoder: mono, with DTX, at 32 kbps. Without this Chrome ignores what
    // the router would prefer and sends stereo at 64.
    codecOptions: { opusStereo: false, opusDtx: true, opusFec: true, opusMaxAverageBitrate: 32000, opusPtime: 20 },
  })
  estado.produtor = produtor.id

  // Guess 2, sender side.
  estado.temRtpSender = produtor.rtpSender !== undefined
  registo(`producer.rtpSender: ${estado.temRtpSender ? "existe" : "NÃO EXISTE"}`)
  if (!produtor.rtpSender) throw new Error("producer.rtpSender não existe — não há onde pendurar a cifra")

  // Guess 1, sender side. `createEncodedStreams` only exists if the connection
  // constructor received `encodedInsertableStreams`.
  let fluxos
  try {
    fluxos = produtor.rtpSender.createEncodedStreams()
    estado.insertableNoEmissor = true
  } catch (erro) {
    estado.insertableNoEmissor = false
    throw new Error(`createEncodedStreams() no emissor: ${erro?.name ?? erro}`)
  }
  registo("createEncodedStreams() no emissor: aceite")

  void fluxos.readable
    .pipeThrough(
      new TransformStream({
        transform: async (frame, controlador) => {
          if (SABOTAGEM === "sem-cifra") {
            // Passes Opus in clear. The receiver must notice this, if it does not,
            // what it counts is not SFrame frames.
            estado.framesCifrados++
            controlador.enqueue(frame)
            return
          }
          frame.data = (await emissorSframe.encrypt(new Uint8Array(frame.data))).buffer
          estado.framesCifrados++
          controlador.enqueue(frame)
        },
      }),
    )
    .pipeTo(fluxos.writable)
    .catch(() => {
      // Ends when the sender closes. Not an error.
    })

  registo(`a produzir ${produtor.id}`)
}

async function receber(device, chave, jaExistentes) {
  const parametros = await pedir("transporte.criar")
  const transporte = device.createRecvTransport({ ...parametros, ...ajustesDoTransporte() })

  transporte.on("connect", ({ dtlsParameters }, feito, falhou) => {
    pedir("transporte.ligar", { transporte: transporte.id, dtlsParameters }).then(() => feito(), falhou)
  })

  const receptorSframe = new SframeReceiver(chave)
  const consumir = async (produtorId) => {
    const params = await pedir("consumir", {
      transporte: transporte.id,
      produtor: produtorId,
      rtpCapabilities: device.rtpCapabilities,
    })
    const consumidor = await transporte.consume({
      id: params.id,
      producerId: params.produtor,
      kind: params.kind,
      rtpParameters: params.rtpParameters,
    })

    // Guess 2, receiver side.
    estado.temRtpReceiver = consumidor.rtpReceiver !== undefined
    registo(`consumer.rtpReceiver: ${estado.temRtpReceiver ? "existe" : "NÃO EXISTE"}`)
    if (!consumidor.rtpReceiver) throw new Error("consumer.rtpReceiver não existe — não há onde pendurar a decifra")

    // Guess 1, receiver side.
    let fluxos
    try {
      fluxos = consumidor.rtpReceiver.createEncodedStreams()
      estado.insertableNoReceptor = true
    } catch (erro) {
      estado.insertableNoReceptor = false
      throw new Error(`createEncodedStreams() no receptor: ${erro?.name ?? erro}`)
    }
    registo("createEncodedStreams() no receptor: aceite")

    void fluxos.readable
      .pipeThrough(
        new TransformStream({
          transform: async (frame, controlador) => {
            estado.framesRecebidos++
            const bytes = new Uint8Array(frame.data)
            const claro = await receptorSframe.decrypt(bytes)
            if (!claro) {
              // Distinguishes "this does not look like SFrame" from "it looks but won't open":
              // the first is a clear frame that passed, the second is wrong key
              // or corrupted payload. Different failures.
              if (bytes.length < 11 || bytes[10] !== 0) estado.framesSemCabecalho++
              else estado.framesRecusados++
              return
            }
            const cabecalho = { keyId: (bytes[0] << 8) | bytes[1], senderId: (bytes[2] << 8) | bytes[3] }
            estado.primeiroCabecalho ??= cabecalho
            estado.ultimoCabecalho = cabecalho
            estado.framesDecifrados++
            frame.data = claro.buffer
            controlador.enqueue(frame)
          },
        }),
      )
      .pipeTo(fluxos.writable)
      .catch(() => {})

    // Only now. The server created the consumer paused on purpose: frames that
    // arrived before this line went into the decoder still encrypted.
    await pedir("retomar", { transporte: transporte.id, consumidor: params.id })

    ouvir(consumidor.track)
    setInterval(() => void medir(consumidor), 500)
    registo(`a consumir ${produtorId}`)
  }

  escutas.set("produtor.novo", (frame) => void consumir(frame.produtor).catch((erro) => (estado.erro = String(erro.message))))
  for (const produtorId of jaExistentes) await consumir(produtorId)
}

/**
 * The sound, measured two ways because one alone does not convince.
 *
 * The `AnalyserNode` measures what reaches the audio graph AFTER decryption and
 * decoding: if it is zero, either nothing arrived or what arrived was noise that the
 * decoder rejected. The `<audio>` element is there because Chrome only puts
 * the decoder to work when the track has somewhere to go.
 */
function ouvir(faixa) {
  const fluxo = new MediaStream([faixa])
  const som = document.getElementById("som")
  som.srcObject = fluxo
  void som.play().catch(() => {})

  const contexto = new AudioContext()
  const fonte = contexto.createMediaStreamSource(fluxo)
  const analisador = contexto.createAnalyser()
  analisador.fftSize = 2048
  fonte.connect(analisador)
  const amostras = new Float32Array(analisador.fftSize)
  setInterval(() => {
    analisador.getFloatTimeDomainData(amostras)
    let soma = 0
    for (const amostra of amostras) soma += amostra * amostra
    estado.rms = Math.max(estado.rms, Math.sqrt(soma / amostras.length))
  }, 200)
}

async function medir(consumidor) {
  // An `RTCStatsReport` is a Map: iterating with `for...of` yields pairs
  // [identifier, row], not rows. Forget this and you get `linha.type` always
  // undefined and conclude no packets arrived, while all the rest of the test
  // says the opposite.
  const relatorio = await consumidor.getStats()
  relatorio.forEach((linha) => {
    if (linha.type !== "inbound-rtp") return
    estado.stats = {
      packetsReceived: linha.packetsReceived,
      bytesReceived: linha.bytesReceived,
      concealedSamples: linha.concealedSamples,
    }
    estado.energiaDeAudio = linha.totalAudioEnergy ?? estado.energiaDeAudio
  })
}
