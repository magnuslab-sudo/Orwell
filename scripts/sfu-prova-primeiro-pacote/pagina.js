/**
 * The test page for the first packet: the PRODUCT'S ENGINE (`MotorSfu` and
 * `CifraDeMedia`, from `packages/client-core/dist`) putting the microphone on air
 * through a real SFU, on real Chromium.
 *
 * What the page measures, under the product without it knowing:
 *
 *  - how many frames LEAVE the cipher transform (an interception in the sender's
 *    `createEncodedStreams`), and whether each brings an SFrame header;
 *  - how many RTP packets the connection says it sent (`outbound-rtp`, across all
 *    `RTCPeerConnection` the page created).
 *
 * One voice frame is one RTP packet. If the connection sent more packets than
 * the cipher let out, packets didn't pass through it: they're in the clear.
 *
 * Scenarios (`?cenario=`): `certo`, `plataforma-recusa` (the `createEncodedStreams`
 * throws, like Chromium when it's too late) and `sem-chave` (the session has no
 * key of ours). Sabotage (`?sabotagem=ordem-antiga`): the cipher hooks
 * AFTER `produce()` resolves, which was the order until 1.2.0. And
 * `?sabotagem=sem-cifra`: the engine thinks it's protected with nothing hooked.
 */
import { readHeader } from "@enclave/crypto"
import { Device } from "mediasoup-client"
import { MotorSfu } from "../../packages/client-core/dist/call-sfu.js"
import { CifraDeMedia } from "../../packages/client-core/dist/media-sframe.js"
import { KEY_ID, materialEmBytes, SENDER_ID } from "../sfu-prova/chave-de-teste.mjs"

const parametros = new URLSearchParams(location.search)
const CENARIO = parametros.get("cenario") ?? "certo"
const SABOTAGEM = parametros.get("sabotagem") ?? ""

const estado = {
  cenario: CENARIO,
  sabotagem: SABOTAGEM,
  pronto: false,
  erroDaEntrada: undefined,
  erro: undefined,
  diagnosticos: [],
  pedidos: [],
  framesQueSairamDaCifra: 0,
  framesSemCabecalho: 0,
  primeiroKeyId: undefined,
  pacotesEnviados: 0,
}
window.__prova = estado
const registo = (texto) => {
  document.getElementById("registo").textContent += `${texto}\n`
}

// --- the instrumentation, before the product existed ----------------------------
const ligacoes = []
const LigacaoOriginal = window.RTCPeerConnection
window.RTCPeerConnection = class extends LigacaoOriginal {
  constructor(...argumentos) {
    super(...argumentos)
    ligacoes.push(this)
  }
}

/*
 * WebKit (and Firefox) don't have `createEncodedStreams`: the product ciphers with
 * `RTCRtpScriptTransform`, in a worker, and who counts frames is the worker
 * (`contagensDoWorker`). Platform refusal, there, is the constructor throwing.
 */
const PELO_WORKER = typeof RTCRtpSender.prototype.createEncodedStreams !== "function"
if (PELO_WORKER && CENARIO === "plataforma-recusa") {
  window.RTCRtpScriptTransform = class {
    constructor() {
      throw new DOMException("a transformação foi recusada", "InvalidStateError")
    }
  }
}

const abrirOriginal = RTCRtpSender.prototype.createEncodedStreams
if (!PELO_WORKER) RTCRtpSender.prototype.createEncodedStreams = function () {
  if (CENARIO === "plataforma-recusa") throw new DOMException("Too late to create encoded streams", "InvalidStateError")
  const par = abrirOriginal.call(this)
  const escritor = par.writable.getWriter()
  const contado = new WritableStream({
    async write(frame) {
      estado.framesQueSairamDaCifra++
      const cabecalho = readHeader(new Uint8Array(frame.data))
      if (!cabecalho) estado.framesSemCabecalho++
      else estado.primeiroKeyId ??= cabecalho.keyId
      await escritor.write(frame)
    },
  })
  return { readable: par.readable, writable: contado }
}

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
  estado.pedidos.push(t)
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
    const { rtpCapabilities } = await pedir("ola")
    return { rtpCapabilities, producers: [] }
  },
  sfuSairDoAmbito() {},
  sfuCriarTransporte: () => pedir("transporte.criar"),
  sfuLigarTransporte: (transporte, dtlsParameters) => pedir("transporte.ligar", { transporte, dtlsParameters }),
  async sfuProduzir(transporte, kind, rtpParameters) {
    return (await pedir("produzir", { transporte, kind, rtpParameters })).id
  },
  sfuFecharProdutor: (produtor) => pedir("produtor.fechar", { produtor }),
  sfuConsumir: () => Promise.reject(new Error("esta prova não consome")),
  sfuRetomar: async () => {},
  sfuPausar: async () => {},
}

// --- o produto -----------------------------------------------------------------
const cifra = new CifraDeMedia(
  {
    selfAddress: "@prova:local",
    mediaKey: async () =>
      CENARIO === "sem-chave" ? null : { keyId: KEY_ID, senderId: SENDER_ID, material: materialEmBytes() },
    reservarContadorSframe: async () => 1000,
    ...(PELO_WORKER ? { criarWorkerDeCifra: () => new Worker("/primeiro-pacote.worker.js", { type: "module" }) } : {}),
  },
  (code, detail) => estado.diagnosticos.push(detail ? `${code}:${detail}` : code),
)

/*
 * The sabotage that must make the test fail: an engine that believes it is
 * protected but has nothing connected (the open failure of SEC-02, seen from
 * inside). This is what proves the measurements work: frames in the clear,
 * packets that skipped encryption, and captures that do not decrypt.
 */
if (SABOTAGEM === "sem-cifra") cifra.pendurarNoEmissor = () => true

/** The sabotage: the order from 1.2.0, with encryption wired after `produce()`. */
function comOrdemAntiga(dispositivo) {
  const criar = dispositivo.createSendTransport.bind(dispositivo)
  dispositivo.createSendTransport = (opcoes) => {
    const transporte = criar(opcoes)
    const produzir = transporte.produce.bind(transporte)
    transporte.produce = async ({ onRtpSender, ...resto }) => {
      const produtor = await produzir(resto)
      onRtpSender?.(produtor.rtpSender)
      return produtor
    }
    return transporte
  }
  return dispositivo
}

/*
 * No encryption retries (4/11/2026): this test measures what goes on the wire
 * when encryption is not ready, not the retries, which have their own test
 * (`scripts/sfu-prova-mic-recupera/`, scenario `cifra-tarda`). Since the fix,
 * voice no longer crashes the input: it gives up via `aoPerderAVoz`, and that
 * is what counts here as "the input failed".
 */
MotorSfu.ESPERAS_DA_CIFRA_MS = []
let vozPerdida
const desistiu = new Promise((resolver) => {
  vozPerdida = resolver
})

const motor = new MotorSfu({
  aoPerderAVoz: (erro) => vozPerdida(erro),
  sinalizacao,
  cifra,
  criarDispositivo: () => (SABOTAGEM === "ordem-antiga" ? comOrdemAntiga(new Device()) : new Device()),
  aoDiagnosticar: (code, detail) => estado.diagnosticos.push(detail ? `${code}:${detail}` : code),
  aoMudar: () => {},
  verOEcraDe: () => false,
})

try {
  const fluxo = await navigator.mediaDevices.getUserMedia({ audio: true })
  try {
    await motor.entrar("!prova:local", "a".repeat(43), fluxo.getAudioTracks()[0])
    // The voice that gives up arrives right after (no retries); the one that entered never arrives.
    const perdida = await Promise.race([desistiu, new Promise((r) => setTimeout(() => r(null), 1000))])
    if (perdida) throw perdida
    registo("entrou")
  } catch (erro) {
    estado.erroDaEntrada = String(erro?.message ?? erro)
    registo(`a entrada falhou: ${estado.erroDaEntrada}`)
  }
  estado.pronto = true
} catch (erro) {
  estado.erro = String(erro?.message ?? erro)
}

/** The audio packets that the connections report sending. Called by the test. */
window.__contarPacotes = async () => {
  let total = 0
  for (const ligacao of ligacoes) {
    const relatorio = await ligacao.getStats().catch(() => null)
    relatorio?.forEach((linha) => {
      if (linha.type === "outbound-rtp" && linha.kind === "audio") total += linha.packetsSent ?? 0
    })
  }
  estado.pacotesEnviados = total
  estado.ligacoes = ligacoes.map((ligacao) => `${ligacao.connectionState}/${ligacao.iceConnectionState}`)
  // With the worker, frames do not go through the main thread: whoever encrypts counts.
  if (PELO_WORKER) estado.framesQueSairamDaCifra = (await cifra.contagensDoWorker())?.cifrados ?? 0
  estado.caminho = cifra.caminho
  return total
}
