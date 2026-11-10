/**
 * The microphone watchdog: catch it when capture dies silently (4/11/2026).
 *
 * The owner's report: "I stopped hearing a user. It looks like Orwell stopped
 * capturing my mic. I left and came back and it worked." No error, no warning.
 *
 * Measured on Chromium for real (`scripts/mic-recupera-evidencia/`): with the voice
 * chain in the middle, the sender has the track that LEAVES the chain (a
 * `MediaStreamAudioDestinationNode`), and that track stays `live` and not
 * `muted` in all cases where the microphone dies. The encoder keeps sending
 * packets of silence. Four ways to die, and none show on the sender's side:
 *
 *  - the RAW track ends (`ended`: the device disappeared, Windows switched
 *    devices, the audio service restarted);
 *  - the raw track goes `muted` (the system stopped delivering sound);
 *  - the `AudioContext` of the chain leaves `running` and doesn't come back;
 *  - the chain's worklet breaks (`processorerror`) or stops beating.
 *
 * This watchdog reads the state every second and says which one happened. The
 * caller (the `Call`) opens the microphone again and swaps the track in the sender.
 *
 * **By polling, not by events.** The state reads from one place,
 * and the same read serves the track, the context and the beat. One second delay
 * in catching the death beats the death that went on until the person left the call.
 *
 * **A main thread freeze is not a death.** The vault recorded on each event
 * freezes the thread for 5 to 13 s (branch `lento-depois-de-entrar`).
 * During that time neither this watchdog runs nor worklet messages arrive:
 * on the first read after the freeze, the last beat looks old.
 * A read that arrives much late restarts the counts and concludes nothing; the
 * next one already sees the messages that were in the queue.
 */

/** Why the microphone stopped being captured. Each one has its own code in the log. */
export type MorteDoMicrofone = "terminou" | "calado" | "contexto-parado" | "cadeia-rebentou" | "cadeia-parada"

/** What the watchdog reads each round. `null` when there is no capture to watch. */
export interface SaudeDoMicrofone {
  /** The RAW track, the one from the device. */
  readonly faixa: { readonly readyState: string; readonly muted: boolean } | null
  /** The audio context that capture goes through, if it goes through one. */
  readonly contexto?: { readonly state: string } | null
  /** The worklet of the voice chain, if there is a chain. See `CadeiaMontada`. */
  readonly cadeia?: { readonly ultimoBatimento: number; readonly rebentou: boolean } | null
}

export interface RelogioDaVigia {
  agora(): number
  repetir(fazer: () => void, ms: number): unknown
  parar(marca: unknown): void
}

const RELOGIO: RelogioDaVigia = {
  agora: () => globalThis.performance?.now?.() ?? Date.now(),
  repetir: (fazer, ms) => setInterval(fazer, ms),
  parar: (marca) => clearInterval(marca as ReturnType<typeof setInterval>),
}

export class VigiaDoMicrofone {
  /** How often the state reads. */
  static readonly PERIODO_MS = 1_000
  /**
   * How long the raw track can stay `muted` before counting as dead.
   * A short mute happens when the system switches format; one lasting 3 s
   * is not a switch.
   */
  static readonly CALADO_MS = 3_000
  /**
   * How long the context can stay outside `running`. The chain asks
   * `resume()` on each state change and on each gesture (`CadeiaMontada`); 2 s
   * later, the request didn't take.
   */
  static readonly CONTEXTO_PARADO_MS = 2_000
  /**
   * How long with no news from the worklet. It sends measurements ~10 times per
   * second from inside `process()`: 3 s of silence is the audio clock
   * stopped, with the context saying `running`.
   */
  static readonly SEM_BATIMENTO_MS = 3_000

  #marca: unknown = null
  #ultimaLeitura = 0
  #caladoDesde: number | null = null
  #contextoParadoDesde: number | null = null
  /** The first beat read after (re)arming: the chain may be new. */
  #batimentoDeReferencia: number | null = null
  #referenciaEm = 0

  constructor(
    private readonly ler: () => SaudeDoMicrofone | null,
    private readonly aoMorrer: (morte: MorteDoMicrofone, detalhe: string) => void,
    private readonly relogio: RelogioDaVigia = RELOGIO,
  ) {}

  get ligada(): boolean {
    return this.#marca !== null
  }

  /** Start (or restart, with new capture) watching. */
  ligar(): void {
    this.desligar()
    this.#recomecar()
    this.#marca = this.relogio.repetir(() => this.#verificar(), VigiaDoMicrofone.PERIODO_MS)
  }

  desligar(): void {
    if (this.#marca !== null) this.relogio.parar(this.#marca)
    this.#marca = null
  }

  #recomecar(): void {
    this.#ultimaLeitura = this.relogio.agora()
    this.#caladoDesde = null
    this.#contextoParadoDesde = null
    this.#batimentoDeReferencia = null
  }

  #verificar(): void {
    const agora = this.relogio.agora()
    const atraso = agora - this.#ultimaLeitura
    this.#ultimaLeitura = agora
    // The thread was frozen: the counts and the beat are worthless.
    if (atraso > 3 * VigiaDoMicrofone.PERIODO_MS) {
      this.#caladoDesde = null
      this.#contextoParadoDesde = null
      this.#batimentoDeReferencia = null
      return
    }

    const saude = this.ler()
    if (!saude?.faixa) return
    const { faixa } = saude

    if (faixa.readyState === "ended") return this.#morreu("terminou", "")

    if (faixa.muted) {
      this.#caladoDesde ??= agora
      const ha = agora - this.#caladoDesde
      if (ha >= VigiaDoMicrofone.CALADO_MS) return this.#morreu("calado", `${Math.round(ha)} ms`)
    } else {
      this.#caladoDesde = null
    }

    const cadeia = saude.cadeia
    if (cadeia?.rebentou) return this.#morreu("cadeia-rebentou", "")

    const estado = saude.contexto?.state
    if (estado !== undefined && estado !== "running") {
      this.#contextoParadoDesde ??= agora
      const ha = agora - this.#contextoParadoDesde
      if (ha >= VigiaDoMicrofone.CONTEXTO_PARADO_MS) return this.#morreu("contexto-parado", `${estado} · ${Math.round(ha)} ms`)
      // A stopped context doesn't beat, and that's already counted here.
      this.#batimentoDeReferencia = null
      return
    }
    this.#contextoParadoDesde = null

    if (cadeia) {
      /*
        The beat counts from when the watchdog first saw it,
        not from the worklet's clock: `ultimoBatimento` is the instant the
        last message ARRIVED on the main thread, on the same clock as this one.
      */
      if (this.#batimentoDeReferencia !== cadeia.ultimoBatimento) {
        this.#batimentoDeReferencia = cadeia.ultimoBatimento
        this.#referenciaEm = agora
        return
      }
      const ha = agora - this.#referenciaEm
      if (ha >= VigiaDoMicrofone.SEM_BATIMENTO_MS) return this.#morreu("cadeia-parada", `${Math.round(ha)} ms`)
    }
  }

  #morreu(morte: MorteDoMicrofone, detalhe: string): void {
    // One death at a time: the caller rearms the watchdog with the new capture.
    this.desligar()
    this.aoMorrer(morte, detalhe)
  }
}
