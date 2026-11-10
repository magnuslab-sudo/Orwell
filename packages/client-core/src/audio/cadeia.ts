import {
  CadeiaDeVoz,
  DB_MINIMO,
  MotorGtcrn,
  NOME_DO_PROCESSADOR,
  type ConfiguracaoDaCadeia,
  type MedidasDaCadeia,
  type MensagemDoWorklet,
  type MensagemParaOWorklet,
} from "./processador-de-voz.js"

/**
 * The voice chain on the main thread: the `AudioContext`, the worklet node, and
 * the track coming out of it to WebRTC.
 *
 * Audio work is not done here; it is done in `processador-de-voz.ts`, in the
 * audio thread. This mounts, configures, measures, and unmounts.
 */

export type EstadoDoMotor = "a-carregar" | "pronto" | "falhou"

export const MEDIDAS_VAZIAS: MedidasDaCadeia = {
  entradaDb: DB_MINIMO,
  saidaDb: DB_MINIMO,
  ruidoEstimadoDb: DB_MINIMO,
  cpuMs: 0,
  relogioPreciso: true,
  vozAtiva: false,
  motorPronto: false,
  portaoDb: DB_MINIMO,
}

/** Is there an `AudioWorklet` in this browser? Without it there is no chain, and capture stays raw. */
/** The main thread clock, the same one the microphone watch uses. */
function agora(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

export function cadeiaDisponivel(): boolean {
  return (
    typeof AudioContext !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    typeof MediaStream !== "undefined" &&
    "audioWorklet" in AudioContext.prototype
  )
}

interface Recursos {
  readonly worklet: string
  readonly wasm: ArrayBuffer | null
  readonly erroDoWasm: string | null
}

let recursos: Promise<Recursos> | null = null

/**
 * Read a binary from the site itself.
 *
 * Try `fetch` first. In the desktop app the page is `file://`, and Chromium's
 * `fetch` rejects that scheme; `XMLHttpRequest` accepts it for a page that is
 * itself `file://`. Nothing leaves the machine in either case.
 */
async function lerBinario(endereco: string): Promise<ArrayBuffer> {
  try {
    const resposta = await fetch(endereco, { credentials: "same-origin" })
    if (!resposta.ok) throw new Error("noise-suppressor-fetch-failed", { cause: { status: resposta.status } })
    return await resposta.arrayBuffer()
  } catch (erroDoFetch) {
    if (typeof XMLHttpRequest === "undefined") throw erroDoFetch
    return await new Promise<ArrayBuffer>((resolver, rejeitar) => {
      const pedido = new XMLHttpRequest()
      pedido.open("GET", endereco)
      pedido.responseType = "arraybuffer"
      pedido.onload = () =>
        pedido.response instanceof ArrayBuffer && (pedido.status === 0 || pedido.status === 200)
          ? resolver(pedido.response)
          : rejeitar(new Error("noise-suppressor-fetch-failed", { cause: { status: pedido.status } }))
      pedido.onerror = () => rejeitar(new Error("noise-suppressor-fetch-failed", { cause: { status: 0 } }))
      pedido.send()
    })
  }
}

/**
 * The worklet module address and model bytes, once per page.
 *
 * Both come via `import()` with `?url`: the bundler copies them with the hash
 * in the name, and they are only requested when the first chain is created. A
 * model failure does not stop the chain (other stages do not need it); a worklet
 * failure does, and is not cached: the next attempt requests it again.
 */
export function carregarRecursos(): Promise<Recursos> {
  recursos ??= (async () => {
    const [{ default: worklet }, { default: enderecoDoWasm }] = await Promise.all([
      import("./processador-de-voz.js?url"),
      import("@sapphi-red/web-noise-suppressor/gtcrn.wasm?url"),
    ])
    try {
      return { worklet, wasm: await lerBinario(enderecoDoWasm), erroDoWasm: null }
    } catch (erro) {
      return { worklet, wasm: null, erroDoWasm: String((erro as Error)?.message ?? erro) }
    }
  })()
  recursos.catch(() => {
    recursos = null
  })
  return recursos
}

let custo: Promise<number> | null = null

/**
 * How much one block of 128 samples costs on this machine, measured on the main
 * thread.
 *
 * Chromium only, where the worklet has no fine clock. Runs the same chain, with
 * the same model, over noise: 100 warmup blocks and 300 measured, roughly 30 to
 * 40 ms of work, once per page and away from the call startup.
 */
function custoPorBloco(config: ConfiguracaoDaCadeia, wasm: ArrayBuffer | null): Promise<number> {
  custo ??= (async () => {
    const cadeia = new CadeiaDeVoz(48000, config)
    try {
      if (wasm) cadeia.usarMotor(await MotorGtcrn.criar(wasm, 48000))
      let semente = 1
      const entrada = new Float32Array(128).map(() => {
        semente = (semente * 1103515245 + 12345) >>> 0
        return (semente / 4294967296 - 0.5) * 0.1
      })
      const saida = new Float32Array(128)
      for (let i = 0; i < 100; i++) cadeia.processar(entrada, saida)
      const inicio = performance.now()
      for (let i = 0; i < 300; i++) cadeia.processar(entrada, saida)
      return (performance.now() - inicio) / 300
    } finally {
      cadeia.destruir()
    }
  })()
  return custo
}

const GESTOS = ["pointerdown", "keydown", "touchend"] as const

export interface OpcoesDaCadeia {
  readonly config: ConfiguracaoDaCadeia
  /** Set by `montar`, with the model bytes that went to the worklet. */
  readonly wasm?: ArrayBuffer | null
  readonly aoMotor: (estado: EstadoDoMotor, detalhe?: string) => void
  readonly aoDiagnosticar: (code: string, detail?: string) => void
}

export class CadeiaMontada {
  readonly contexto: AudioContext
  readonly saida: MediaStream
  #fonte: MediaStreamAudioSourceNode
  readonly #no: AudioWorkletNode
  readonly #destino: MediaStreamAudioDestinationNode
  #medidas: MedidasDaCadeia = MEDIDAS_VAZIAS
  #custoNoFioPrincipal: number | null = null
  #motor: EstadoDoMotor = "a-carregar"
  #ouvir = false
  #fechada = false
  readonly #retomar: () => void
  /**
   * When the last message from the worklet arrived, on the main thread clock.
   *
   * The worklet sends measurements roughly 10 times a second from inside
   * `process()`. If they stop coming with the context saying `running`, the
   * audio clock stopped and the output track is silence. This is the heartbeat
   * that the microphone watch reads (`vigia-do-microfone.ts`).
   */
  ultimoBatimento = agora()
  /** The worklet threw inside `process()` (`processorerror`): output is silence forever. */
  rebentou = false
  #naoFinitosVistos = 0

  private constructor(
    contexto: AudioContext,
    fonte: MediaStreamAudioSourceNode,
    no: AudioWorkletNode,
    opcoes: OpcoesDaCadeia,
  ) {
    this.contexto = contexto
    this.#fonte = fonte
    this.#no = no
    this.#destino = contexto.createMediaStreamDestination()
    // Mono: the call's Opus is mono, and a stereo track would double the work.
    this.#destino.channelCount = 1
    fonte.connect(no)
    no.connect(this.#destino)
    this.saida = this.#destino.stream

    /*
      Measured on Chromium (4/11/2026): a worklet that throws in `process()`
      fires this once then returns silence, with the output track `live`.
      With no one listening, the voice died silently.
    */
    no.onprocessorerror = () => {
      this.rebentou = true
      opcoes.aoDiagnosticar("audio-worklet-rebentou")
    }
    no.port.onmessage = (evento: MessageEvent<MensagemDoWorklet>) => {
      this.ultimoBatimento = agora()
      const mensagem = evento.data
      if (mensagem.tipo === "medidas") {
        this.#medidas = mensagem.medidas
        const naoFinitos = mensagem.medidas.naoFinitos ?? 0
        if (naoFinitos > this.#naoFinitosVistos) {
          // The chain recovered on its own: noted, so the log can explain the click.
          this.#naoFinitosVistos = naoFinitos
          opcoes.aoDiagnosticar("audio-cadeia-nao-finito", String(naoFinitos))
        }
        if (!mensagem.medidas.relogioPreciso && this.#custoNoFioPrincipal === null) {
          this.#custoNoFioPrincipal = -1
          setTimeout(() => {
            if (this.#fechada) return
            custoPorBloco(opcoes.config, opcoes.wasm ?? null).then(
              (ms) => (this.#custoNoFioPrincipal = ms),
              () => (this.#custoNoFioPrincipal = null),
            )
          }, 2000)
        }
      } else if (mensagem.tipo === "motor") {
        this.#motor = mensagem.estado
        opcoes.aoMotor(mensagem.estado, mensagem.detalhe)
      }
    }

    /**
     * A suspended context delivers silence to WebRTC: the person speaks and no
     * one hears them. It is born suspended when there is no recent gesture
     * (autoplay policy), and Safari suspends it ("interrupted") when another
     * application takes audio. It resumes right away, on every state change, and
     * on the person's next gesture, when the browser lets it.
     */
    this.#retomar = () => {
      if (this.#fechada) return
      const estado = this.contexto.state as string
      if (estado === "running" || estado === "closed") return
      this.contexto.resume().catch(() => {
        opcoes.aoDiagnosticar("audio-contexto-suspenso", estado)
      })
    }
    contexto.addEventListener("statechange", this.#retomar)
    for (const gesto of GESTOS) globalThis.addEventListener?.(gesto, this.#retomar, { passive: true, capture: true })
    globalThis.document?.addEventListener?.("visibilitychange", this.#retomar)
    this.#retomar()
  }

  /**
   * Mount the chain over the raw capture.
   *
   * The context requests 48 kHz: the Opus rate, and one of two at which the
   * model runs. Old Firefox refuses to connect a microphone to a context at a
   * different rate; then try the system rate, and the model only runs if it is
   * 48 or 16 kHz (the worklet says so in the `motor` message).
   */
  static async montar(bruto: MediaStream, opcoes: OpcoesDaCadeia): Promise<CadeiaMontada> {
    const { worklet, wasm, erroDoWasm } = await carregarRecursos()
    if (erroDoWasm) opcoes.aoDiagnosticar("audio-modelo-nao-carregou", erroDoWasm)

    const tentar = async (taxa: number | null): Promise<CadeiaMontada> => {
      const contexto = new AudioContext(
        taxa === null ? { latencyHint: "interactive" } : { latencyHint: "interactive", sampleRate: taxa },
      )
      try {
        await contexto.audioWorklet.addModule(worklet)
        const fonte = contexto.createMediaStreamSource(new MediaStream(bruto.getAudioTracks()))
        const no = new AudioWorkletNode(contexto, NOME_DO_PROCESSADOR, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          channelCount: 1,
          channelCountMode: "explicit",
          channelInterpretation: "speakers",
          processorOptions: { config: opcoes.config, wasm },
        })
        return new CadeiaMontada(contexto, fonte, no, { ...opcoes, wasm })
      } catch (erro) {
        void contexto.close().catch(() => {})
        throw erro
      }
    }

    try {
      return await tentar(48000)
    } catch (erro) {
      opcoes.aoDiagnosticar("audio-contexto-48k-recusado", String((erro as Error)?.name ?? erro))
      return await tentar(null)
    }
  }

  get medidas(): MedidasDaCadeia {
    const custo = this.#custoNoFioPrincipal
    return !this.#medidas.relogioPreciso && custo !== null && custo >= 0
      ? { ...this.#medidas, cpuMs: custo }
      : this.#medidas
  }

  get motor(): EstadoDoMotor {
    return this.#motor
  }

  get ouvir(): boolean {
    return this.#ouvir
  }

  configurar(config: ConfiguracaoDaCadeia): void {
    if (this.#fechada) return
    const mensagem: MensagemParaOWorklet = { tipo: "configurar", config }
    this.#no.port.postMessage(mensagem)
  }

  /** Connect the chain output to speakers: a preview for tuning. */
  definirOuvir(ligado: boolean): void {
    if (this.#fechada || ligado === this.#ouvir) return
    this.#ouvir = ligado
    if (ligado) this.#no.connect(this.contexto.destination)
    else this.#no.disconnect(this.contexto.destination)
  }

  /**
   * Switch the microphone without changing the outgoing track.
   *
   * The output track stays the same: WebRTC does not detect the swap, and there is
   * no renegotiation or `replaceTrack`.
   */
  trocarEntrada(bruto: MediaStream): void {
    if (this.#fechada) return
    const nova = this.contexto.createMediaStreamSource(new MediaStream(bruto.getAudioTracks()))
    this.#fonte.disconnect()
    this.#fonte = nova
    nova.connect(this.#no)
    this.#retomar()
  }

  fechar(): void {
    if (this.#fechada) return
    this.#fechada = true
    for (const gesto of GESTOS) globalThis.removeEventListener?.(gesto, this.#retomar, { capture: true })
    globalThis.document?.removeEventListener?.("visibilitychange", this.#retomar)
    this.contexto.removeEventListener("statechange", this.#retomar)
    const mensagem: MensagemParaOWorklet = { tipo: "destruir" }
    this.#no.port.postMessage(mensagem)
    this.#no.port.onmessage = null
    this.#no.onprocessorerror = null
    for (const faixa of this.saida.getTracks()) faixa.stop()
    try {
      this.#fonte.disconnect()
      this.#no.disconnect()
    } catch {
      // Already disconnected: nothing to do.
    }
    void this.contexto.close().catch(() => {})
  }
}
