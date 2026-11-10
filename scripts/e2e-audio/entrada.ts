/**
 * The test page for the voice chain, for `scripts/e2e-audio.mjs`.
 *
 * Uses the built core (`packages/client-core/dist`), with the same `?url`
 * parameters as the app: the worklet module and the `gtcrn.wasm` are served
 * with a hash in the name, from the same origin, under the SAME security policy
 * as `apps/web/index.html` (the script copies it from there).
 *
 * Two test runs per engine:
 * 1. Offline: synthetic voice with pink noise at 5 dB, via an `OfflineAudioContext`,
 *    with the worklet and the model. Measures noise in pauses before and after.
 * 2. Live: an oscillator via `MediaStream`, using `CadeiaMontada` as the call does,
 *    and the measurements the worklet sends to the main thread.
 */
import { CadeiaMontada, carregarRecursos } from "../../packages/client-core/dist/audio/cadeia.js"
import { CONFIGURACAO_DO_PERFIL } from "../../packages/client-core/dist/audio/perfis.js"
import { NOME_DO_PROCESSADOR, type MensagemDoWorklet } from "../../packages/client-core/dist/audio/processador-de-voz.js"

const TAXA = 48000
const SEGUNDOS = 6

const violacoes: string[] = []
document.addEventListener("securitypolicyviolation", (evento) => {
  violacoes.push(`${evento.violatedDirective} ${evento.blockedURI}`)
})

function gerador(semente: number): () => number {
  let s = semente >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

/** The same synthetic voice as the unit tests: glottal pulses, formants, syllables and pauses. */
function voz(n: number): Float32Array {
  const formantes = [
    [700, 1220, 2600],
    [300, 2300, 3000],
    [500, 1000, 2500],
    [400, 1700, 2400],
  ]
  const estado = [
    [0, 0],
    [0, 0],
    [0, 0],
  ]
  const x = new Float32Array(n)
  let fase = 0
  for (let i = 0; i < n; i++) {
    const t = i / TAXA
    fase += (120 + 15 * Math.sin(2 * Math.PI * 0.7 * t) + 8 * Math.sin(2 * Math.PI * 5 * t)) / TAXA
    if (fase >= 1) fase -= 1
    const fonte = (fase < 0.4 ? Math.sin((Math.PI * fase) / 0.4) : 0) - 0.25
    const F = formantes[Math.floor(t / 0.25) % 4]!
    let y = 0
    for (let j = 0; j < 3; j++) {
      const r = Math.exp((-Math.PI * (80 + 40 * j)) / TAXA)
      const e = estado[j]!
      const v = fonte * (1 - r) + 2 * r * Math.cos((2 * Math.PI * F[j]!) / TAXA) * e[0]! - r * r * e[1]!
      e[1] = e[0]!
      e[0] = v
      y += v / (j + 1)
    }
    x[i] = t % 2 < 1.4 ? y * Math.pow(Math.sin(Math.PI * ((t % 0.25) / 0.25)), 0.6) : 0
  }
  return x
}

function rosa(n: number): Float32Array {
  const r = gerador(7)
  const x = new Float32Array(n)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1
    b0 = 0.99886 * b0 + w * 0.0555179
    b1 = 0.99332 * b1 + w * 0.0750759
    b2 = 0.969 * b2 + w * 0.153852
    b3 = 0.8665 * b3 + w * 0.3104856
    b4 = 0.55 * b4 + w * 0.5329522
    b5 = -0.7616 * b5 - w * 0.016898
    x[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
    b6 = w * 0.115926
  }
  return x
}

function potencia(x: Float32Array, de = 0, ate = x.length): number {
  let s = 0
  for (let i = de; i < ate; i++) s += x[i]! * x[i]!
  return s / Math.max(1, ate - de)
}

/** Power in the voice pauses (1.4 to 2.0 s of each 2 s), from 2 s onward, with delay `d`. */
function nasPausas(x: Float32Array, d: number): number {
  let s = 0
  let c = 0
  for (let inicio = 2; inicio + 2 <= SEGUNDOS; inicio += 2) {
    const de = Math.round((inicio + 1.45) * TAXA) + d
    const ate = Math.round((inicio + 1.95) * TAXA) + d
    s += potencia(x, de, Math.min(ate, x.length)) * (ate - de)
    c += ate - de
  }
  return s / c
}

const db = (p: number) => 10 * Math.log10(Math.max(p, 1e-12))

async function offline(wasm: ArrayBuffer | null, worklet: string) {
  const n = TAXA * SEGUNDOS
  const limpa = voz(n)
  const barulho = rosa(n)
  // Voice at -20 dBFS (measured where there is voice), pink noise 5 dB below it.
  let soma = 0
  let contados = 0
  for (const v of limpa) if (v !== 0) (soma += v * v), contados++
  const k = Math.pow(10, -20 / 20) / Math.sqrt(soma / contados)
  const g = Math.sqrt(potencia(limpa) / potencia(barulho) / Math.pow(10, 5 / 10))
  const misturada = limpa.map((v, i) => k * (v + g * barulho[i]!))

  const contexto = new OfflineAudioContext(1, n, TAXA)
  await contexto.audioWorklet.addModule(worklet)
  const buffer = contexto.createBuffer(1, n, TAXA)
  buffer.copyToChannel(misturada, 0)
  const fonte = contexto.createBufferSource()
  fonte.buffer = buffer
  const no = new AudioWorkletNode(contexto, NOME_DO_PROCESSADOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: "explicit",
    processorOptions: { config: CONFIGURACAO_DO_PERFIL.normal, wasm },
  })
  const motor = new Promise<string>((resolver) => {
    no.port.onmessage = (evento: MessageEvent<MensagemDoWorklet>) => {
      if (evento.data.tipo === "motor") resolver(`${evento.data.estado}${evento.data.detalhe ? ` (${evento.data.detalhe})` : ""}`)
    }
    setTimeout(() => resolver("sem resposta em 10 s"), 10_000)
  })
  // The model compiles in the worklet asynchronously: we wait for it before
  // rendering, otherwise the test measures the dry signal.
  const estadoDoMotor = await motor
  fonte.connect(no).connect(contexto.destination)
  fonte.start()
  const t0 = performance.now()
  const saida = (await contexto.startRendering()).getChannelData(0)
  const ms = performance.now() - t0
  const atraso = 1530 + 128
  return {
    motor: estadoDoMotor,
    finita: saida.every((v) => Number.isFinite(v)),
    pausasAntesDb: db(nasPausas(misturada, 0)),
    pausasDepoisDb: db(nasPausas(saida, atraso)),
    vozAntesDb: db(potencia(misturada, 2 * TAXA, Math.round(3.4 * TAXA))),
    vozDepoisDb: db(potencia(saida, 2 * TAXA + atraso, Math.round(3.4 * TAXA) + atraso)),
    renderMsPorSegundo: ms / SEGUNDOS,
  }
}

async function aoVivo() {
  const contexto = new AudioContext()
  await contexto.resume().catch(() => {})
  // The same voice, looped, as if it were a microphone: a fixed tone would be
  // taken for noise (correctly), and the test would measure silence.
  const n = TAXA * SEGUNDOS
  const buffer = contexto.createBuffer(1, n, TAXA)
  const limpa = voz(n)
  buffer.copyToChannel(limpa.map((v) => v * 0.3), 0)
  const oscilador = contexto.createBufferSource()
  oscilador.buffer = buffer
  oscilador.loop = true
  const destino = contexto.createMediaStreamDestination()
  oscilador.connect(destino)
  oscilador.start()

  let motor = "a-carregar"
  const diagnosticos: string[] = []
  const cadeia = await CadeiaMontada.montar(destino.stream, {
    config: CONFIGURACAO_DO_PERFIL.normal,
    aoMotor: (estado, detalhe) => {
      motor = `${estado}${detalhe ? ` (${detalhe})` : ""}`
    },
    aoDiagnosticar: (code, detail) => diagnosticos.push(`${code}${detail ? `: ${detail}` : ""}`),
  })
  await new Promise((resolver) => setTimeout(resolver, 2500))
  const resultado = {
    motor,
    estadoDoContexto: cadeia.contexto.state,
    taxa: cadeia.contexto.sampleRate,
    medidas: cadeia.medidas,
    faixa: cadeia.saida.getAudioTracks()[0]?.readyState ?? "sem faixa",
    diagnosticos,
  }
  cadeia.fechar()
  oscilador.stop()
  await contexto.close()
  return resultado
}

async function correr() {
  const erros: string[] = []
  try {
    const { worklet, wasm, erroDoWasm } = await carregarRecursos()
    const off = await offline(wasm, worklet).catch((erro: unknown) => {
      erros.push(`offline: ${String(erro)}`)
      return null
    })
    const vivo = await aoVivo().catch((erro: unknown) => {
      erros.push(`ao vivo: ${String(erro)}`)
      return null
    })
    return { worklet, erroDoWasm, offline: off, aoVivo: vivo, violacoes, erros }
  } catch (erro) {
    erros.push(String(erro))
    return { violacoes, erros }
  }
}

/**
 * Comparison with the native suppressor (Chromium only, with the fake microphone
 * reading a WAV): records `segundos` from the microphone in three modes and
 * returns the samples in base64. Calculations are done in the script, using the
 * same functions as the tests.
 *
 * - `cru`: no native suppressor, no chain;
 * - `nativo`: the browser suppressor (`noiseSuppression: true`), no chain;
 * - `nosso`: no native suppressor, with the chain in Normal profile.
 */
async function gravar(modo: "cru" | "nativo" | "nosso", segundos: number): Promise<string> {
  const captura = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: modo === "nativo" },
  })
  const cadeia =
    modo === "nosso"
      ? await CadeiaMontada.montar(captura, {
          config: CONFIGURACAO_DO_PERFIL.normal,
          aoMotor: () => {},
          aoDiagnosticar: () => {},
        })
      : null
  const contexto = cadeia?.contexto ?? new AudioContext({ sampleRate: TAXA })
  await contexto.resume()
  await contexto.audioWorklet.addModule("./gravador.js")
  const fonte = contexto.createMediaStreamSource(cadeia ? cadeia.saida : captura)
  const gravador = new AudioWorkletNode(contexto, "gravador-de-prova")
  const pedacos: Float32Array[] = []
  let gravando = false
  gravador.port.onmessage = (evento: MessageEvent<Float32Array>) => {
    if (gravando) pedacos.push(evento.data)
  }
  fonte.connect(gravador)
  // Two seconds for the suppressor (ours or the native one) to settle.
  await new Promise((resolver) => setTimeout(resolver, 2000))
  gravando = true
  await new Promise((resolver) => setTimeout(resolver, segundos * 1000))
  gravando = false
  gravador.port.postMessage("parar")
  cadeia?.fechar()
  for (const faixa of captura.getTracks()) faixa.stop()
  await contexto.close().catch(() => {})
  const total = pedacos.reduce((soma, p) => soma + p.length, 0)
  const tudo = new Float32Array(total)
  let posicao = 0
  for (const p of pedacos) {
    tudo.set(p, posicao)
    posicao += p.length
  }
  const bytes = new Uint8Array(tudo.buffer)
  let texto = ""
  for (let i = 0; i < bytes.length; i += 0x8000) texto += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(texto)
}
;(window as unknown as { gravar: typeof gravar }).gravar = gravar

// The test starts with a click: that gesture lets the AudioContext run in all
// three engines without triggering autoplay policies.
let resultado: Promise<unknown> | null = null
document.getElementById("correr")!.addEventListener("click", () => {
  resultado ??= correr()
})
;(window as unknown as { resultado: () => Promise<unknown> | null }).resultado = () => resultado
