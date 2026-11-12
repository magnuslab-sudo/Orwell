/**
 * The voice chain, on the audio thread.
 *
 * This file is the WORKLET MODULE: the browser loads it with
 * `audioWorklet.addModule`, exactly as it comes from `tsc`, without going through the bundler.
 * So it imports NOTHING, an `import` here would be a network request that
 * Vite does not rewrite. Everything the chain needs is in this file.
 *
 * Tests import the same classes (`CadeiaDeVoz`, `MotorGtcrn`) and run them
 * in Node with synthetic audio: the code being measured is the code that runs.
 *
 * Order of stages, and why:
 *
 * 1. High-pass (80 Hz, fourth order). Below voice are fan, mains at 50 Hz
 *    and desk. Comes first so suppression does not waste effort on it.
 * 2. Noise suppression (GTCRN, via WebAssembly). Blended with the aligned dry signal,
 *    at the proportion of its strength. See `README.md` for the motor choice.
 * 3. Voice detection gate, with one-block lookahead (2.7 ms): the detector
 *    sees sound before gain is applied to it, so word starts pass through.
 * 4. Automatic gain control, soft compressor and cap at -1 dBFS.
 * 5. Split-band de-esser (only the band above 5.5 kHz descends).
 *
 * Each stage connects and disconnects via a 10 ms ramp: nothing clicks when adjusting.
 */

// ------------------------------------------------------------------ tipos

export type NomeDaEtapa = "passaAlto" | "supressao" | "gate" | "compressor" | "deEsser"

export type EtapasDaCadeia = Readonly<Record<NomeDaEtapa, boolean>>

export interface ConfiguracaoDaCadeia {
  readonly etapas: EtapasDaCadeia
  /** Suppression strength, 0 (dry signal) to 1 (motor output only). */
  readonly forca: number
  /** Input gain, linear, 0 to 2. The microphone volume slider. */
  readonly ganhoDeEntrada: number
  /** How much the gate lowers sound when no voice is present, in dB (negative). */
  readonly gateFundoDb: number
  /** Maximum that automatic gain control can raise, in dB. */
  readonly agcMaxDb: number
  /** Maximum that the de-esser can remove from the high band, in dB. */
  readonly deEsserMaxDb: number
  /**
   * Microphone sensitivity in manual mode, in dBFS, or `null` for
   * automatic mode (the default: gate follows the noise floor).
   *
   * With a threshold, the gate opens when level crosses the line and closes 3 dB
   * below it, with the same timing as automatic (opens in 1 ms, holds
   * 200 ms, closes in 80 ms). When closed, output is DIGITAL SILENCE, not the
   * `gateFundoDb` background: Opus with DTX stops sending packets, and the speaker
   * ring does not light on the other side. The threshold enables the gate even with the
   * `gate` stage disabled: it is an explicit choice by the user.
   *
   * The level being compared is what the gate detector already saw: AFTER the
   * high-pass, suppression and input volume, and BEFORE the AGC. So noise that suppression
   * removes does not open the gate, and AGC (which raises quiet voice slowly) does not
   * move the line the user set.
   */
  readonly limiarDb: number | null
}

export interface MedidasDaCadeia {
  /** Level of raw input (RMS, dBFS), in the last window of ~100 ms. */
  readonly entradaDb: number
  /** Level of output (RMS, dBFS), in the same window. */
  readonly saidaDb: number
  /** Estimated noise floor at input (dBFS), via minima. */
  readonly ruidoEstimadoDb: number
  /** Average processing time per block, in milliseconds. */
  readonly cpuMs: number
  /**
   * `cpuMs` comes from a fine clock (`performance.now`). False on Chromium,
   * which does not give `performance` to worklets: there the main thread measures the cost
   * separately (see `custoPorBloco` in `cadeia.ts`).
   */
  readonly relogioPreciso: boolean
  /** The voice detector is open now. */
  readonly vozAtiva: boolean
  /**
   * The level the gate compares with the threshold (dBFS): the peak of the
   * 10 ms envelope in the last window of ~100 ms. It is what the "Microphone
   * sensitivity" meter draws, so the line and bar speak of the same number.
   */
  readonly portaoDb: number
  /** The suppression engine is loaded and working. */
  readonly motorPronto: boolean
  /**
   * How many times the chain caught a non-number (`NaN`,
   * `Infinity`) and recovered, since it was born. See `CadeiaDeVoz.#reporEstado`.
   * Optional because a report from an old worklet does not bring it.
   */
  readonly naoFinitos?: number
}

/** Messages from the main thread to the worklet. */
export type MensagemParaOWorklet =
  | { readonly tipo: "configurar"; readonly config: ConfiguracaoDaCadeia }
  | { readonly tipo: "destruir" }

/** Messages from the worklet to the main thread. */
export type MensagemDoWorklet =
  | { readonly tipo: "medidas"; readonly medidas: MedidasDaCadeia }
  | { readonly tipo: "motor"; readonly estado: "pronto" | "falhou"; readonly detalhe?: string }

/** The name under which the processor registers. Stable: the main thread uses it. */
export const NOME_DO_PROCESSADOR = "orwell-cadeia-de-voz"

/** The floor of measurements in dB: digital silence is not -Infinity in JSON. */
export const DB_MINIMO = -120

// ------------------------------------------------------------------ utilidades

function paraDb(potencia: number): number {
  return potencia > 1e-12 ? Math.max(DB_MINIMO, 10 * Math.log10(potencia)) : DB_MINIMO
}

function deDb(db: number): number {
  return Math.pow(10, db / 20)
}

/** Coefficient of a one-pole filter with time constant `tau` seconds. */
function coeficiente(tau: number, taxa: number): number {
  return Math.exp(-1 / (tau * taxa))
}

/** A biquadratic section (RBJ), direct form transposed II. */
class Biquad {
  #b0 = 1
  #b1 = 0
  #b2 = 0
  #a1 = 0
  #a2 = 0
  #z1 = 0
  #z2 = 0

  passaAlto(frequencia: number, q: number, taxa: number): this {
    const w = (2 * Math.PI * frequencia) / taxa
    const cos = Math.cos(w)
    const alfa = Math.sin(w) / (2 * q)
    const a0 = 1 + alfa
    this.#b0 = (1 + cos) / 2 / a0
    this.#b1 = -(1 + cos) / a0
    this.#b2 = (1 + cos) / 2 / a0
    this.#a1 = (-2 * cos) / a0
    this.#a2 = (1 - alfa) / a0
    return this
  }

  /** Forget the filter memory. */
  limpar(): void {
    this.#z1 = 0
    this.#z2 = 0
  }

  passo(x: number): number {
    const y = this.#b0 * x + this.#z1
    this.#z1 = this.#b1 * x - this.#a1 * y + this.#z2
    this.#z2 = this.#b2 * x - this.#a2 * y
    return y
  }
}

/** A fixed-size delay line. */
class Atraso {
  readonly #memoria: Float32Array
  #posicao = 0

  constructor(readonly amostras: number) {
    this.#memoria = new Float32Array(Math.max(1, amostras))
  }

  limpar(): void {
    this.#memoria.fill(0)
  }

  passo(x: number): number {
    if (this.amostras === 0) return x
    const y = this.#memoria[this.#posicao]!
    this.#memoria[this.#posicao] = x
    this.#posicao = (this.#posicao + 1) % this.amostras
    return y
  }
}

/** A linear ramp between 0 and 1, to connect and disconnect without clicking. */
class Rampa {
  valor: number
  alvo: number
  readonly #passo: number

  constructor(inicial: number, taxa: number, segundos = 0.01) {
    this.valor = inicial
    this.alvo = inicial
    this.#passo = 1 / Math.max(1, segundos * taxa)
  }

  passo(): number {
    if (this.valor < this.alvo) this.valor = Math.min(this.alvo, this.valor + this.#passo)
    else if (this.valor > this.alvo) this.valor = Math.max(this.alvo, this.valor - this.#passo)
    return this.valor
  }
}

/**
 * The noise floor, by minima statistics.
 *
 * Fed by 10 ms frames. The floor is the lowest frame of the last
 * two seconds (eight 250 ms subwindows), plus 1 dB: the minimum of many
 * noise frames sits a bit below their average. Voice always has
 * gaps between syllables within two seconds, so it is not taken
 * for noise; noise that changes is caught in two seconds, up or down.
 *
 * Digital silence frames (below -100 dBFS) do not count: microphone startup,
 * or the chain's own delay, would pin the floor to the bottom.
 */
class ChaoDeRuido {
  db = DB_MINIMO
  readonly #minimos: Float64Array
  readonly #quadrosPorSubjanela: number
  #atual = Infinity
  #quadros = 0
  #posicao = 0
  #cheias = 0

  constructor(quadroSegundos: number, subjanelas = 8, subjanelaSegundos = 0.25) {
    this.#minimos = new Float64Array(subjanelas).fill(Infinity)
    this.#quadrosPorSubjanela = Math.max(1, Math.round(subjanelaSegundos / quadroSegundos))
  }

  quadro(db: number): void {
    if (db < -100) return
    if (db < this.#atual) this.#atual = db
    if (++this.#quadros >= this.#quadrosPorSubjanela) {
      this.#minimos[this.#posicao] = this.#atual
      this.#posicao = (this.#posicao + 1) % this.#minimos.length
      this.#cheias = Math.min(this.#minimos.length, this.#cheias + 1)
      this.#atual = Infinity
      this.#quadros = 0
    }
    let minimo = this.#atual
    for (let i = 0; i < this.#minimos.length; i++) if (this.#minimos[i]! < minimo) minimo = this.#minimos[i]!
    this.db = Number.isFinite(minimo) ? minimo + 1 : DB_MINIMO
  }
}

// ------------------------------------------------------------------ the suppression engine

/**
 * GTCRN delay, in samples. At 48 kHz: 640 from frame assembly in 768-sample
 * blocks (five 128-sample blocks queued) plus 890 from the model's STFT window.
 * Measured via cross-correlation in `audio/cadeia.test.ts`, fails if changed.
 */
export const ATRASO_DO_GTCRN: Readonly<Record<number, number>> = { 48000: 1530, 16000: 384 }

/** The exports from `gtcrn.wasm` of `@sapphi-red/web-noise-suppressor@0.4.1`. */
interface ExportacoesGtcrn {
  readonly c: WebAssembly.Memory
  readonly d: () => void
  readonly e: () => number
  readonly f: (ponteiro: number) => void
  readonly g: (estado: number) => void
  readonly i: (estado: number, entrada: number, saida: number) => void
  readonly j: (estado: number, entrada: number, saida: number) => void
  readonly k: (bytes: number) => number
}

function ehExportacaoGtcrn(exportacoes: WebAssembly.Exports): exportacoes is WebAssembly.Exports & ExportacoesGtcrn {
  return (
    exportacoes["c"] instanceof WebAssembly.Memory &&
    ["d", "e", "f", "g", "i", "j", "k"].every((nome) => typeof exportacoes[nome] === "function")
  )
}

/**
 * The GTCRN, called directly.
 *
 * Does not use the worklet or the Emscripten glue from the package: loads the `.wasm` and calls
 * the exported functions. So the engine runs INSIDE our processor, one
 * node, exact delay known to align the dry signal, and the engine time is counted
 * in the CPU measurement.
 *
 * Export names are what Emscripten minified in version 0.4.1,
 * pinned in `package.json`. A new version with different names fails at
 * `criar` with `noise-suppressor-exports-changed`, and the test catches it first.
 */
export class MotorGtcrn {
  readonly quadro: number
  readonly atraso: number
  readonly #exp: ExportacoesGtcrn
  readonly #processar: (estado: number, entrada: number, saida: number) => void
  #estado: number
  #entrada: number
  #saida: number

  private constructor(exp: ExportacoesGtcrn, taxa: 48000 | 16000) {
    this.#exp = exp
    this.quadro = taxa === 48000 ? 768 : 256
    this.atraso = ATRASO_DO_GTCRN[taxa]!
    this.#processar = taxa === 48000 ? exp.j : exp.i
    this.#estado = exp.e()
    this.#entrada = exp.k(this.quadro * 4)
    this.#saida = exp.k(this.quadro * 4)
    if (!this.#estado || !this.#entrada || !this.#saida) {
      this.destruir()
      throw new Error("noise-suppressor-alloc-failed")
    }
  }

  static suporta(taxa: number): taxa is 48000 | 16000 {
    return taxa === 48000 || taxa === 16000
  }

  static async criar(binario: ArrayBuffer | Uint8Array<ArrayBuffer>, taxa: number): Promise<MotorGtcrn> {
    if (!MotorGtcrn.suporta(taxa)) throw new Error("noise-suppressor-sample-rate", { cause: { taxa } })
    let memoria: WebAssembly.Memory | null = null
    const importacoes = {
      a: {
        // __assert_fail: the model never calls it in normal operation.
        a: () => {
          throw new Error("noise-suppressor-assert")
        },
        // emscripten_resize_heap: grow memory when malloc requests it.
        b: (pedido: number) => {
          if (!memoria) return 0
          const atual = memoria.buffer.byteLength
          const alvo = pedido >>> 0
          if (alvo <= atual) return 1
          try {
            memoria.grow(Math.ceil((alvo - atual) / 65536))
            return 1
          } catch {
            return 0
          }
        },
      },
    }
    const bytes = binario instanceof Uint8Array ? binario : new Uint8Array(binario)
    const modulo = await WebAssembly.compile(bytes)
    const instance = await WebAssembly.instantiate(modulo, importacoes)
    const exportacoes = instance.exports
    if (!ehExportacaoGtcrn(exportacoes)) throw new Error("noise-suppressor-exports-changed")
    memoria = exportacoes.c
    exportacoes.d()
    return new MotorGtcrn(exportacoes, taxa)
  }

  /** Process a frame of `quadro` samples. Output goes into `saida`. */
  processar(entrada: Float32Array, saida: Float32Array): void {
    // The view rebuilds on every frame: malloc may have grown memory, and
    // a view over the old buffer becomes stale.
    const heap = new Float32Array(this.#exp.c.buffer)
    heap.set(entrada, this.#entrada >>> 2)
    this.#processar(this.#estado, this.#entrada, this.#saida)
    const inicio = this.#saida >>> 2
    saida.set(heap.subarray(inicio, inicio + this.quadro))
  }

  /**
   * The model with memory zeroed, as if just created.
   *
   * Measured on 4/11/2026: an `Infinity` at the input poisons the model state, and
   * output becomes `NaN` even after input returns to speech. Resetting state
   * is what fixes it.
   */
  reiniciar(): void {
    if (this.#estado) this.#exp.g(this.#estado)
    this.#estado = this.#exp.e()
    if (!this.#estado) throw new Error("noise-suppressor-alloc-failed")
  }

  destruir(): void {
    if (this.#entrada) this.#exp.f(this.#entrada)
    if (this.#saida) this.#exp.f(this.#saida)
    if (this.#estado) this.#exp.g(this.#estado)
    this.#entrada = 0
    this.#saida = 0
    this.#estado = 0
  }
}

// ------------------------------------------------------------------ a cadeia

/** The configuration for the "Normal" profile, which is the default. `perfis.ts` uses it as-is. */
export const CONFIGURACAO_NORMAL: ConfiguracaoDaCadeia = {
  etapas: { passaAlto: true, supressao: true, gate: true, compressor: true, deEsser: true },
  forca: 1,
  ganhoDeEntrada: 1,
  gateFundoDb: -30,
  agcMaxDb: 9,
  deEsserMaxDb: 6,
  limiarDb: null,
}

const PASSA_ALTO_HZ = 100
const DE_ESSER_HZ = 5500
const ALVO_DA_VOZ_DB = -21
const COMPRESSOR_LIMIAR_DB = -12
const COMPRESSOR_RAZAO = 2
const COMPRESSOR_JOELHO_DB = 6
const TECTO_DB = -1
const ANTECIPACAO = 128
/** The gate hysteresis: closes this many dB below where it opens. */
const HISTERESE_DB = 3
/**
 * In manual mode, below this gain the gate closes hard (exact zero). That is
 * -60 dB: an 80 ms close reaches here in about 0.55 s, and the jump to zero is
 * inaudible. Without this, the exponential never reached zero.
 */
const GATE_FECHADO = 1e-3

/**
 * The full chain, on one channel.
 *
 * `processar` receives and returns blocks (128 samples in the worklet; tests use
 * the same size). No allocations inside `processar`.
 */
export class CadeiaDeVoz {
  readonly taxa: number
  /** Set by the worklet: is `performance.now` in scope? */
  relogioPreciso = true
  #config: ConfiguracaoDaCadeia = CONFIGURACAO_NORMAL

  // Ramps for each stage (0 off, 1 on).
  readonly #rPassaAlto: Rampa
  readonly #rSupressao: Rampa
  readonly #rGate: Rampa
  readonly #rCompressor: Rampa
  readonly #rDeEsser: Rampa

  // 1. High-pass: fourth-order Butterworth, two sections.
  readonly #pa1: Biquad
  readonly #pa2: Biquad

  // 2. Suppression.
  #motor: MotorGtcrn | null = null
  readonly #atrasoDoMotor: number
  readonly #seco: Atraso
  #quadroEntrada: Float32Array = new Float32Array(0)
  #quadroSaida: Float32Array = new Float32Array(0)
  #blocoNoQuadro = 0
  #leituraNoQuadro = 0
  /** Samples until the engine output is meaningful. */
  #aquecimento = 0
  #motorParadoHa = 0
  #correndo = false
  readonly #molhado: Float32Array
  readonly #sinal: Float32Array

  // 3. Gate.
  readonly #antecipacao: Atraso
  readonly #aEnvelope: number
  #envelope = 0
  readonly #chaoDaVoz: ChaoDeRuido
  #somaQuadro = 0
  #amostrasQuadroDaVoz = 0
  readonly #tamanhoQuadro: number
  #aberto = false
  #retencao = 0
  readonly #retencaoAmostras: number
  #ganhoGate = 1
  readonly #aGateAtaque: number
  readonly #aGateLibertacao: number

  // 4. AGC, compressor and ceiling.
  /** Average power of voice while the gate is open. */
  #nivelDaVoz = deDb(ALVO_DA_VOZ_DB) ** 2
  readonly #aNivel: number
  #agcDb = 0
  readonly #agcPassoDb: number
  #ganhoCompressorDb = 0
  readonly #aCompAtaque: number
  readonly #aCompLibertacao: number
  #ganhoTecto = 1
  readonly #aTecto: number

  // 5. De-esser.
  readonly #deAlta: Biquad
  #envAlta = 0
  #envTotal = 0
  readonly #aDe: number
  #ganhoDe = 1
  readonly #aDeAtaque: number
  readonly #aDeLibertacao: number

  // Medidas.
  readonly #chaoDaEntrada: ChaoDeRuido
  #somaQuadroEntrada = 0
  #amostrasQuadro = 0
  #somaEntrada = 0
  #somaSaida = 0
  #amostrasMedidas = 0
  #ultimaEntradaDb = DB_MINIMO
  #ultimaSaidaDb = DB_MINIMO
  #picoDoPortao = DB_MINIMO
  #ultimoPortaoDb = DB_MINIMO
  #cpuTotal = 0
  #cpuBlocos = 0
  #ultimoCpu = 0
  /** See `MedidasDaCadeia.naoFinitos`. */
  #naoFinitos = 0

  constructor(taxa: number, config: ConfiguracaoDaCadeia = CONFIGURACAO_NORMAL) {
    this.taxa = taxa
    const ligada = (nome: NomeDaEtapa) => (config.etapas[nome] ? 1 : 0)
    this.#rPassaAlto = new Rampa(ligada("passaAlto"), taxa)
    this.#rSupressao = new Rampa(ligada("supressao") * config.forca, taxa, 0.02)
    this.#rGate = new Rampa(ligada("gate"), taxa)
    this.#rCompressor = new Rampa(ligada("compressor"), taxa)
    this.#rDeEsser = new Rampa(ligada("deEsser"), taxa)

    this.#pa1 = new Biquad().passaAlto(PASSA_ALTO_HZ, 0.5412, taxa)
    this.#pa2 = new Biquad().passaAlto(PASSA_ALTO_HZ, 1.3066, taxa)

    // The dry signal waits the same as the engine. With no engine, the chain
    // maintains the same delay: toggling suppression does not jump in time.
    this.#atrasoDoMotor = ATRASO_DO_GTCRN[taxa] ?? 0
    this.#seco = new Atraso(this.#atrasoDoMotor)
    this.#molhado = new Float32Array(4096)
    this.#sinal = new Float32Array(4096)

    this.#antecipacao = new Atraso(ANTECIPACAO)
    this.#aEnvelope = coeficiente(0.01, taxa)
    this.#tamanhoQuadro = Math.round(taxa * 0.01)
    this.#chaoDaVoz = new ChaoDeRuido(0.01)
    this.#retencaoAmostras = Math.round(taxa * 0.2)
    this.#aGateAtaque = coeficiente(0.001, taxa)
    this.#aGateLibertacao = coeficiente(0.08, taxa)

    this.#aNivel = coeficiente(0.4, taxa)
    this.#agcPassoDb = 6 / taxa
    this.#aCompAtaque = coeficiente(0.003, taxa)
    this.#aCompLibertacao = coeficiente(0.1, taxa)
    this.#aTecto = coeficiente(0.05, taxa)

    this.#deAlta = new Biquad().passaAlto(DE_ESSER_HZ, 0.7071, taxa)
    this.#aDe = coeficiente(0.005, taxa)
    this.#aDeAtaque = coeficiente(0.001, taxa)
    this.#aDeLibertacao = coeficiente(0.04, taxa)

    this.#chaoDaEntrada = new ChaoDeRuido(0.01)
    this.configurar(config)
  }

  /** Total delay the chain adds, in samples. */
  get atraso(): number {
    return this.#atrasoDoMotor + ANTECIPACAO
  }

  get motorPronto(): boolean {
    return this.#motor !== null
  }

  configurar(config: ConfiguracaoDaCadeia): void {
    this.#config = config
    const e = config.etapas
    this.#rPassaAlto.alvo = e.passaAlto ? 1 : 0
    this.#rSupressao.alvo = e.supressao ? Math.max(0, Math.min(1, config.forca)) : 0
    // With manual threshold the gate always opens: the user requested it.
    this.#rGate.alvo = e.gate || config.limiarDb !== null ? 1 : 0
    this.#rCompressor.alvo = e.compressor ? 1 : 0
    this.#rDeEsser.alvo = e.deEsser ? 1 : 0
  }

  /** Hand over the suppression engine. Until here the chain passes dry signal. */
  usarMotor(motor: MotorGtcrn): void {
    if (motor.atraso !== this.#atrasoDoMotor) throw new Error("noise-suppressor-delay-mismatch")
    this.#motor?.destruir()
    this.#motor = motor
    this.#quadroEntrada = new Float32Array(motor.quadro)
    this.#quadroSaida = new Float32Array(motor.quadro)
    this.#correndo = false
  }

  destruir(): void {
    this.#motor?.destruir()
    this.#motor = null
  }

  /**
   * The engine: glues the block into the frame, and when the frame fills,
   * processes it. Output follows the same scheme as the original packet: the
   * first block of the processed frame comes out in the block that completed it.
   */
  #passarPeloMotor(bloco: Float32Array, n: number, saida: Float32Array): boolean {
    const motor = this.#motor
    if (!motor || motor.quadro % n !== 0) return false
    const blocos = motor.quadro / n
    this.#quadroEntrada.set(bloco.subarray(0, n), this.#blocoNoQuadro * n)
    if (this.#blocoNoQuadro === blocos - 1) {
      motor.processar(this.#quadroEntrada, this.#quadroSaida)
      this.#leituraNoQuadro = 0
      /*
        A non-number at the engine output stays in its state (it is recurrent), and
        from there spreads to all memory in the chain: speech died until it left and
        re-entered (4/11/2026). The frame is discarded, the model starts fresh, and
        its output only counts again after warmup.
      */
      if (!todosFinitos(this.#quadroSaida, this.#quadroSaida.length)) {
        this.#naoFinitos++
        this.#quadroSaida.fill(0)
        this.#aquecimento = this.#atrasoDoMotor + this.#quadroSaida.length
        try {
          motor.reiniciar()
        } catch {
          // Out of memory for new state: the chain continues without suppression.
          this.#motor = null
          motor.destruir()
        }
      }
    }
    const inicio = this.#leituraNoQuadro * n
    for (let i = 0; i < n; i++) saida[i] = this.#quadroSaida[inicio + i]!
    this.#leituraNoQuadro = (this.#leituraNoQuadro + 1) % blocos
    this.#blocoNoQuadro = (this.#blocoNoQuadro + 1) % blocos
    return true
  }

  processar(entrada: Float32Array, saida: Float32Array, relogio?: () => number): void {
    const inicio = relogio?.() ?? 0
    const n = Math.min(entrada.length, saida.length, this.#sinal.length)
    const sinal = this.#sinal
    const config = this.#config

    // ---- input measurement and 1. high-pass
    for (let i = 0; i < n; i++) {
      const x = entrada[i]!
      const q = x * x
      this.#somaEntrada += q
      this.#somaQuadroEntrada += q
      if (++this.#amostrasQuadro >= this.#tamanhoQuadro) {
        this.#chaoDaEntrada.quadro(paraDb(this.#somaQuadroEntrada / this.#amostrasQuadro))
        this.#somaQuadroEntrada = 0
        this.#amostrasQuadro = 0
      }
      const pa = this.#pa2.passo(this.#pa1.passo(x))
      const m = this.#rPassaAlto.passo()
      sinal[i] = x + m * (pa - x)
    }

    // ---- 2. suppression
    const querMotor = this.#rSupressao.alvo > 0 || this.#rSupressao.valor > 0
    if (querMotor) this.#motorParadoHa = 0
    else this.#motorParadoHa += n
    // Off for over a second, the engine stops running: saves CPU.
    const correr = this.#motor !== null && this.#motorParadoHa < this.taxa
    if (correr && !this.#correndo) {
      // Startup (or recovery): the frame restarts, and the engine output only counts
      // after its delay passes.
      this.#blocoNoQuadro = 0
      this.#leituraNoQuadro = 0
      this.#quadroSaida.fill(0)
      this.#aquecimento = this.#atrasoDoMotor + this.#quadroSaida.length
    }
    this.#correndo = correr
    const temMolhado = correr && this.#passarPeloMotor(sinal, n, this.#molhado)
    if (temMolhado && this.#aquecimento > 0) this.#aquecimento -= n
    const molhadoValido = temMolhado && this.#aquecimento <= 0
    const ganho = Math.max(0, Math.min(2, config.ganhoDeEntrada))
    for (let i = 0; i < n; i++) {
      const seco = this.#seco.passo(sinal[i]!)
      const f = this.#rSupressao.passo()
      const y = molhadoValido ? seco + f * (this.#molhado[i]! - seco) : seco
      sinal[i] = y * ganho
    }

    // ---- 3. gate, 4. AGC + compressor + cap, 5. de-esser
    const manual = typeof config.limiarDb === "number" && Number.isFinite(config.limiarDb)
    const limiar = manual ? (config.limiarDb as number) : 0
    const fundo = manual ? 0 : deDb(config.gateFundoDb)
    const agcMax = config.agcMaxDb
    const deMax = config.deEsserMaxDb
    const tecto = deDb(TECTO_DB)
    for (let i = 0; i < n; i++) {
      const u = sinal[i]!
      const uq = u * u
      this.#somaQuadro += uq
      if (++this.#amostrasQuadroDaVoz >= this.#tamanhoQuadro) {
        this.#chaoDaVoz.quadro(paraDb(this.#somaQuadro / this.#amostrasQuadroDaVoz))
        this.#somaQuadro = 0
        this.#amostrasQuadroDaVoz = 0
      }

      // Detector, on the signal BEFORE lookahead.
      this.#envelope = this.#aEnvelope * this.#envelope + (1 - this.#aEnvelope) * uq
      const envDb = paraDb(this.#envelope)
      if (envDb > this.#picoDoPortao) this.#picoDoPortao = envDb
      const abrir = manual ? limiar : Math.max(this.#chaoDaVoz.db + 6, -60)
      const fechar = abrir - HISTERESE_DB
      if (envDb > abrir) {
        this.#aberto = true
        this.#retencao = this.#retencaoAmostras
      } else if (envDb < fechar) {
        if (this.#retencao > 0) this.#retencao--
        else this.#aberto = false
      }
      const alvoGate = this.#aberto ? 1 : fundo
      const aG = alvoGate > this.#ganhoGate ? this.#aGateAtaque : this.#aGateLibertacao
      this.#ganhoGate = aG * this.#ganhoGate + (1 - aG) * alvoGate
      if (manual && !this.#aberto && this.#ganhoGate < GATE_FECHADO) this.#ganhoGate = 0
      const mGate = this.#rGate.passo()
      const gGate = 1 + mGate * (this.#ganhoGate - 1)

      // AGC: learns only from speech, and slowly.
      if (this.#aberto) {
        // Average in power not in dB: the average dB of a speech signal is
        // several dB below its RMS, and AGC would gain too much.
        this.#nivelDaVoz = this.#aNivel * this.#nivelDaVoz + (1 - this.#aNivel) * this.#envelope
        const desejado = Math.max(-6, Math.min(agcMax, ALVO_DA_VOZ_DB - paraDb(this.#nivelDaVoz)))
        const diferenca = desejado - this.#agcDb
        this.#agcDb += Math.max(-this.#agcPassoDb, Math.min(this.#agcPassoDb, diferenca))
      }
      // Wide-knee compressor, on the signal already with AGC.
      const comAgcDb = envDb + this.#agcDb
      const acima = comAgcDb - COMPRESSOR_LIMIAR_DB
      const meioJoelho = COMPRESSOR_JOELHO_DB / 2
      let reducao = 0
      if (acima > meioJoelho) reducao = (1 / COMPRESSOR_RAZAO - 1) * acima
      else if (acima > -meioJoelho)
        reducao = ((1 / COMPRESSOR_RAZAO - 1) * (acima + meioJoelho) ** 2) / (2 * COMPRESSOR_JOELHO_DB)
      const aC = reducao < this.#ganhoCompressorDb ? this.#aCompAtaque : this.#aCompLibertacao
      this.#ganhoCompressorDb = aC * this.#ganhoCompressorDb + (1 - aC) * reducao
      const mComp = this.#rCompressor.passo()
      const gComp = 1 + mComp * (deDb(this.#agcDb + this.#ganhoCompressorDb) - 1)

      let w = this.#antecipacao.passo(u) * gGate * gComp

      // Split-band de-esser.
      const alta = this.#deAlta.passo(w)
      this.#envAlta = this.#aDe * this.#envAlta + (1 - this.#aDe) * alta * alta
      this.#envTotal = this.#aDe * this.#envTotal + (1 - this.#aDe) * w * w
      const altaDb = paraDb(this.#envAlta)
      const razaoDb = altaDb - paraDb(this.#envTotal)
      const reducaoDe = altaDb > -45 && razaoDb > -6 ? Math.min(deMax, (razaoDb + 6) * 1.5) : 0
      const alvoDe = deDb(-reducaoDe)
      const aD = alvoDe < this.#ganhoDe ? this.#aDeAtaque : this.#aDeLibertacao
      this.#ganhoDe = aD * this.#ganhoDe + (1 - aD) * alvoDe
      const mDe = this.#rDeEsser.passo()
      w -= mDe * (1 - this.#ganhoDe) * alta

      // Cap: instant attack, 50 ms release. Always on.
      const pico = Math.abs(w) * this.#ganhoTecto
      if (pico > tecto) this.#ganhoTecto = tecto / Math.abs(w)
      else this.#ganhoTecto = this.#aTecto * this.#ganhoTecto + (1 - this.#aTecto)
      w *= this.#ganhoTecto
      // Manual gate closed: exact zero. De-esser and cap have memory, and
      // without this left a tail of -150 dB that is no longer digital silence.
      if (gGate === 0) w = 0

      saida[i] = w
      this.#somaSaida += w * w
    }

    // The final network: nothing that is not a number comes out, and the memory
    // that held it resets. A block of silence, not dead speech forever.
    if (!todosFinitos(saida, n)) {
      this.#naoFinitos++
      saida.fill(0, 0, n)
      this.#reporEstado()
    }

    this.#amostrasMedidas += n
    if (this.#amostrasMedidas >= this.taxa * 0.1) {
      this.#ultimaEntradaDb = paraDb(this.#somaEntrada / this.#amostrasMedidas)
      this.#ultimaSaidaDb = paraDb(this.#somaSaida / this.#amostrasMedidas)
      this.#ultimoPortaoDb = this.#picoDoPortao
      this.#picoDoPortao = DB_MINIMO
      this.#somaEntrada = 0
      this.#somaSaida = 0
      this.#amostrasMedidas = 0
    }
    if (relogio) {
      this.#cpuTotal += relogio() - inicio
      this.#cpuBlocos++
      if (this.#cpuBlocos >= 375) {
        this.#ultimoCpu = this.#cpuTotal / this.#cpuBlocos
        this.#cpuTotal = 0
        this.#cpuBlocos = 0
      }
    }
  }

  /**
   * All chain memory back to startup, except config and the engine.
   *
   * Called when a non-number escaped to output: somewhere in memory (a filter,
   * an envelope, AGC, measurement sums) there is a `NaN`, and a `NaN` in
   * recurrent memory never leaves it.
   */
  #reporEstado(): void {
    this.#pa1.limpar()
    this.#pa2.limpar()
    this.#deAlta.limpar()
    this.#seco.limpar()
    this.#antecipacao.limpar()
    this.#quadroSaida.fill(0)
    this.#correndo = false
    this.#envelope = 0
    this.#somaQuadro = 0
    this.#amostrasQuadroDaVoz = 0
    this.#aberto = false
    this.#retencao = 0
    this.#ganhoGate = 1
    this.#nivelDaVoz = deDb(ALVO_DA_VOZ_DB) ** 2
    this.#agcDb = 0
    this.#ganhoCompressorDb = 0
    this.#ganhoTecto = 1
    this.#envAlta = 0
    this.#envTotal = 0
    this.#ganhoDe = 1
    this.#somaQuadroEntrada = 0
    this.#amostrasQuadro = 0
    this.#somaEntrada = 0
    this.#somaSaida = 0
    this.#amostrasMedidas = 0
    this.#picoDoPortao = DB_MINIMO
    if (this.#motor) {
      try {
        this.#motor.reiniciar()
      } catch {
        this.#motor.destruir()
        this.#motor = null
      }
    }
  }

  medidas(): MedidasDaCadeia {
    return {
      entradaDb: this.#ultimaEntradaDb,
      saidaDb: this.#ultimaSaidaDb,
      ruidoEstimadoDb: this.#chaoDaEntrada.db,
      cpuMs: this.#cpuBlocos > 0 && this.#ultimoCpu === 0 ? this.#cpuTotal / this.#cpuBlocos : this.#ultimoCpu,
      relogioPreciso: this.relogioPreciso,
      vozAtiva: this.#aberto,
      portaoDb: this.#ultimoPortaoDb,
      motorPronto: this.#motor !== null,
      naoFinitos: this.#naoFinitos,
    }
  }
}

/** Are the first `n` samples all finite numbers? */
function todosFinitos(amostras: Float32Array, n: number): boolean {
  for (let i = 0; i < n; i++) if (!Number.isFinite(amostras[i]!)) return false
  return true
}

// ------------------------------------------------------------------ the worklet processor

/**
 * What the worklet scope has that `lib.dom` does not declare. Read from
 * `globalThis` instead of global declaration, to avoid polluting the types of
 * code that imports this file outside the worklet.
 */
interface EscopoDoWorklet {
  readonly AudioWorkletProcessor?: new () => { readonly port: MessagePort }
  readonly registerProcessor?: (nome: string, classe: unknown) => void
  readonly sampleRate?: number
  readonly performance?: { now(): number }
}

const escopo = globalThis as unknown as EscopoDoWorklet

if (typeof escopo.AudioWorkletProcessor === "function" && typeof escopo.registerProcessor === "function") {
  const Base = escopo.AudioWorkletProcessor
  const taxa = escopo.sampleRate ?? 48000
  /*
    Without `performance` in scope (Chromium does not expose it to worklets),
    the clock is `Date.now()`, millisecond precision, and a block takes a tenth
    of that: the average is meaningless. Measurements report it (`relogioPreciso: false`),
    and the main thread measures cost another way.
  */
  const relogio = escopo.performance ? () => escopo.performance!.now() : () => Date.now()

  class ProcessadorDeVoz extends Base {
    readonly #cadeia: CadeiaDeVoz
    #vivo = true
    #blocos = 0

    constructor(opcoes?: { processorOptions?: { config?: ConfiguracaoDaCadeia; wasm?: ArrayBuffer | null } }) {
      super()
      const config = opcoes?.processorOptions?.config ?? CONFIGURACAO_NORMAL
      this.#cadeia = new CadeiaDeVoz(taxa, config)
      this.#cadeia.relogioPreciso = Boolean(escopo.performance)
      this.port.onmessage = (evento: MessageEvent<MensagemParaOWorklet>) => {
        const m = evento.data
        if (m.tipo === "configurar") this.#cadeia.configurar(m.config)
        else if (m.tipo === "destruir") {
          this.#vivo = false
          this.#cadeia.destruir()
        }
      }
      const wasm = opcoes?.processorOptions?.wasm
      if (wasm && MotorGtcrn.suporta(taxa)) {
        MotorGtcrn.criar(wasm, taxa).then(
          (motor) => {
            if (!this.#vivo) return motor.destruir()
            this.#cadeia.usarMotor(motor)
            this.#enviar({ tipo: "motor", estado: "pronto" })
          },
          (erro: unknown) => {
            this.#enviar({ tipo: "motor", estado: "falhou", detalhe: String((erro as Error)?.message ?? erro) })
          },
        )
      } else {
        this.#enviar({ tipo: "motor", estado: "falhou", detalhe: wasm ? `sample-rate ${taxa}` : "no-wasm" })
      }
    }

    #enviar(mensagem: MensagemDoWorklet): void {
      this.port.postMessage(mensagem)
    }

    process(entradas: Float32Array[][], saidas: Float32Array[][]): boolean {
      if (!this.#vivo) return false
      const entrada = entradas[0]?.[0]
      const saida = saidas[0]
      if (!saida || saida.length === 0) return true
      const canal0 = saida[0]!
      if (entrada) this.#cadeia.processar(entrada, canal0, relogio)
      else canal0.fill(0)
      // Mono to all output channels: the call's Opus is mono.
      for (let c = 1; c < saida.length; c++) saida[c]!.set(canal0)
      // ~10 medidas por segundo a 48 kHz.
      if (++this.#blocos % 37 === 0) this.#enviar({ tipo: "medidas", medidas: this.#cadeia.medidas() })
      return true
    }
  }

  escopo.registerProcessor(NOME_DO_PROCESSADOR, ProcessadorDeVoz)
}
