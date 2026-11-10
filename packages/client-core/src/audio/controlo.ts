import type { Session } from "../session.js"
import { CadeiaMontada, cadeiaDisponivel, MEDIDAS_VAZIAS, type EstadoDoMotor } from "./cadeia.js"
import { DB_MINIMO } from "./processador-de-voz.js"
import {
  configuracaoPara,
  ehEtapa,
  ehPerfil,
  ETAPAS_DE_AUDIO,
  etapasDoPerfil,
  forcaDoPerfil,
  PERFIL_DE_AUDIO_POR_OMISSAO,
  type EtapasDaCadeia,
  type NomeDaEtapa,
  type PerfilDeAudio,
} from "./perfis.js"

/**
 * Voice chain control: what the interface sees and changes.
 *
 * Lives in `Call.audio`. Stores the choice (profile, stages, strength), applies it to
 * whichever chain is running, the call or the preview, and saves it to the
 * account preferences, which sync across devices.
 */

/** What the interface reads to render. Goes in the call's `audio` event. */
export interface EstadoDoAudio {
  readonly perfil: PerfilDeAudio
  readonly etapas: EtapasDaCadeia
  readonly forca: number
  /** The preview (hearing yourself through the chain) is enabled. */
  readonly previa: boolean
  /**
   * Who is suppressing noise now:
   * - `"modelo"`: ours (GTCRN), loaded and running;
   * - `"a-carregar"`: the chain is up and the model is not yet;
   * - `"nativo"`: the browser suppressor, because ours failed to load or is off;
   * - `"nenhum"`: no chain is running (outside a call, no preview).
   */
  readonly motor: "modelo" | "a-carregar" | "nativo" | "nenhum"
}

export interface MedidaDoAudio {
  readonly entradaDb: number
  readonly saidaDb: number
  readonly ruidoEstimadoDb: number
  readonly cpuMs: number
  /**
   * The level the gate compares against the "Microphone Sensitivity" threshold
   * (after high-pass, suppression, and input gain; before AGC).
   * This is what the meter for that option displays.
   */
  readonly portaoDb: number
  /** The gate is open: voice is passing through. */
  readonly vozAtiva: boolean
  /**
   * The level for the ring on our own card. On automatic it is the input
   * (as always: the automatic gate mutes low speech, and the ring should not
   * stay quiet while sound is coming in). With the manual threshold it follows the gate:
   * closed, `-120`, and no one sees the person speaking, not even themselves.
   */
  readonly anelDb: number
}

/** The range of the manual threshold in dBFS: what the interface offers. */
export const LIMIAR_MINIMO_DB = -80
export const LIMIAR_MAXIMO_DB = 0

/**
 * Where choices are stored. The `Session` is used as-is
 * (`preferencias`, `definirPreferencia`, `on("preferencias")`); on desktop the
 * same pair works via IPC.
 */
export interface FonteDePreferenciasDeAudio {
  preferencias(): Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>
  definirPreferencia(chave: string, valor: string): Promise<void>
  on?(
    evento: "preferencias",
    ouvinte: (dados: { preferencias: Readonly<Record<string, string>> }) => void,
  ): () => void
}

/** The `Session` must serve as a source as-is. If it stops, `tsc` fails here. */
type Afirmar<T extends true> = T
export type SessaoServeDeFonte = Afirmar<Session extends FonteDePreferenciasDeAudio ? true : false>

export const CHAVES_DE_PREFERENCIA = {
  perfil: "audio.perfil",
  etapas: "audio.etapas",
  forca: "audio.forca",
} as const

/** What the control needs from the call. */
export interface LigacoesDoControlo {
  /** Open the microphone for the preview outside a call (with the Electron gate). */
  abrirMicrofone(): Promise<MediaStream>
  /**
   * Close the preview capture. Stops ONLY the tracks it receives: with an active call,
   * those are clones, and the call track keeps running.
   */
  fecharMicrofone(captura: MediaStream): Promise<void>
  /**
   * The raw capture of the active call, or `null` outside a call.
   *
   * A call with no chain (profile "Off", or chain that did not start) has
   * no chain to attach the preview to. Opening the microphone again in that case
   * could stop the call track (same device, requested twice). The
   * preview uses clones of this capture.
   */
  capturaDaChamada?: () => MediaStream | null
  /**
   * The input gain the call will use (`Call.inputGain`). Read when mounting the chain
   * outside a call, so the meter shows the level the call will get.
   */
  ganhoDeEntrada?: () => number
  /** The chain changed what it asks from the native suppressor: reapply to the raw track. */
  aoMudarNativo(): void
  aoMudar(estado: EstadoDoAudio): void
  aoDiagnosticar(code: string, detail?: string): void
}

function lerEtapas(texto: string | undefined, base: EtapasDaCadeia): EtapasDaCadeia {
  if (!texto) return base
  try {
    const lido = JSON.parse(texto) as unknown
    if (typeof lido !== "object" || lido === null) return base
    const resultado = { ...base }
    for (const etapa of ETAPAS_DE_AUDIO) {
      const valor = (lido as Record<string, unknown>)[etapa]
      if (typeof valor === "boolean") resultado[etapa] = valor
    }
    return resultado
  } catch {
    return base
  }
}

function lerForca(texto: string | undefined, base: number): number {
  const valor = texto === undefined ? NaN : Number(texto)
  return Number.isFinite(valor) && valor >= 0 && valor <= 1 ? valor : base
}

export class ControloDeVoz {
  #perfil: PerfilDeAudio = PERFIL_DE_AUDIO_POR_OMISSAO
  #etapas: EtapasDaCadeia = etapasDoPerfil(PERFIL_DE_AUDIO_POR_OMISSAO)
  #forca = forcaDoPerfil(PERFIL_DE_AUDIO_POR_OMISSAO)
  #ganho = 1
  /** The manual threshold for "Microphone Sensitivity", or `null` (automatic). */
  #limiar: number | null = null

  /** The call's chain when there is a call with a chain. */
  #daChamada: CadeiaMontada | null = null
  /** The preview chain outside a call, with the microphone that opened. */
  #daPrevia: { cadeia: CadeiaMontada; captura: MediaStream } | null = null
  #previa = false
  /** The "Microphone Sensitivity" meter needs a chain (no speakers). */
  #medidor = false
  /** The outside-call chain currently opening, to prevent two requests from opening two. */
  #abrindo: Promise<void> | null = null
  #modeloFalhou = false

  #fonte: FonteDePreferenciasDeAudio | null = null

  constructor(private readonly ligacoes: LigacoesDoControlo) {}

  // ---------------------------------------------------------------- the interface API

  perfil(): PerfilDeAudio {
    return this.#perfil
  }

  async definirPerfil(perfil: PerfilDeAudio): Promise<void> {
    if (!ehPerfil(perfil)) throw new Error("audio-invalid-profile", { cause: { perfil: String(perfil) } })
    this.#perfil = perfil
    this.#etapas = etapasDoPerfil(perfil)
    this.#forca = forcaDoPerfil(perfil)
    this.#aplicar()
    await this.#gravar({
      [CHAVES_DE_PREFERENCIA.perfil]: perfil,
      [CHAVES_DE_PREFERENCIA.etapas]: JSON.stringify(this.#etapas),
      [CHAVES_DE_PREFERENCIA.forca]: String(this.#forca),
    })
  }

  etapas(): EtapasDaCadeia {
    return this.#etapas
  }

  async definirEtapa(nome: NomeDaEtapa, ligada: boolean): Promise<void> {
    if (!ehEtapa(nome)) throw new Error("audio-invalid-stage", { cause: { etapa: String(nome) } })
    if (typeof ligada !== "boolean") throw new Error("audio-invalid-stage", { cause: { etapa: nome, ligada: String(ligada) } })
    this.#etapas = { ...this.#etapas, [nome]: ligada }
    this.#aplicar()
    await this.#gravar({ [CHAVES_DE_PREFERENCIA.etapas]: JSON.stringify(this.#etapas) })
  }

  forcaDaSupressao(): number {
    return this.#forca
  }

  async definirForcaDaSupressao(valor: number): Promise<void> {
    if (typeof valor !== "number" || !Number.isFinite(valor) || valor < 0 || valor > 1) {
      throw new Error("audio-invalid-strength", { cause: { forca: String(valor) } })
    }
    this.#forca = valor
    this.#aplicar()
    await this.#gravar({ [CHAVES_DE_PREFERENCIA.forca]: String(valor) })
  }

  /** What the active chain measures now. With no chain, the floor for everything. */
  medir(): MedidaDoAudio {
    const { entradaDb, saidaDb, ruidoEstimadoDb, cpuMs, portaoDb, vozAtiva } = this.#cadeia()?.medidas ?? MEDIDAS_VAZIAS
    const anelDb = this.#limiar !== null && !vozAtiva ? DB_MINIMO : entradaDb
    return { entradaDb, saidaDb, ruidoEstimadoDb, cpuMs, portaoDb, vozAtiva, anelDb }
  }

  /** The manual threshold in dBFS, or `null` when sensitivity is automatic. */
  limiar(): number | null {
    return this.#limiar
  }

  /**
   * The "Microphone Sensitivity": `null` is automatic (the usual gate),
   * a number is the manual threshold in dBFS. Applied right away to the active chain
   * via the config message (the worklet is not recreated), and to the next capture.
   *
   * Not stored: it is a preference for THIS device (the microphone and room
   * are on this computer), kept by the interface and brought by the bridge, like
   * the input gain.
   */
  definirLimiar(db: number | null): void {
    if (db !== null && (typeof db !== "number" || !Number.isFinite(db) || db < LIMIAR_MINIMO_DB || db > LIMIAR_MAXIMO_DB)) {
      throw new Error("audio-invalid-threshold", { cause: { limiar: String(db) } })
    }
    if (db === this.#limiar) return
    this.#limiar = db
    this.#aplicar()
  }

  /**
   * The meter for "Microphone sensitivity": a chain measuring without output to
   * speakers.
   *
   * During a call, the call already meters and opens nothing. Outside a call,
   * opens the microphone (via the Electron gate) and sets up a chain just to
   * meter, the same as the preview: toggling "Listen to myself" on top uses it,
   * and turning one off does not close the other. `medidor(false)` releases the
   * microphone if the preview does not use it.
   *
   * Rejections: `audio-preview-unavailable` (no AudioWorklet),
   * `audio-meter-denied` (microphone permission denied), and
   * `audio-meter-failed` with `{ nome, mensagem }` (everything else).
   */
  async medidor(ligado: boolean): Promise<void> {
    this.#medidor = ligado
    if (!ligado) {
      if (!this.#previa) await this.#fecharPrevia()
      return
    }
    if (this.#daChamada) return
    try {
      await this.#garantirCadeiaFora()
    } catch (causa) {
      this.#medidor = false
      if ((causa as Error)?.message === "audio-preview-unavailable") throw causa
      const nome = String((causa as Error)?.name ?? "")
      if (nome === "NotAllowedError" || nome === "SecurityError") throw new Error("audio-meter-denied", { cause: { nome } })
      throw new Error("audio-meter-failed", {
        cause: { nome, mensagem: String((causa as Error)?.message ?? causa) },
      })
    }
  }

  /**
   * Hear yourself through the chain, to adjust.
   *
   * During a call, connects the call chain output to speakers. Outside a call,
   * opens the microphone and builds a chain just for this, which closes when
   * preview turns off. With "Off", preview passes sound through the chain with
   * all stages disabled: you hear the microphone as it is.
   */
  async previa(ligada: boolean): Promise<void> {
    if (ligada === this.#previa) return
    this.#previa = ligada
    if (!ligada) {
      this.#daChamada?.definirOuvir(false)
      this.#daPrevia?.cadeia.definirOuvir(false)
      // The sensitivity meter may be using the same chain.
      if (!this.#medidor) await this.#fecharPrevia()
      this.#emitir()
      return
    }
    if (this.#daChamada) {
      this.#daChamada.definirOuvir(true)
      this.#emitir()
      return
    }
    try {
      await this.#garantirCadeiaFora()
    } catch (causa) {
      this.#previa = false
      this.#emitir()
      if ((causa as Error)?.message === "audio-preview-unavailable") throw causa
      throw new Error("audio-preview-failed", {
        cause: { nome: String((causa as Error)?.name ?? ""), mensagem: String((causa as Error)?.message ?? causa) },
      })
    }
    // Meanwhile a call may have come in: preview switches to its chain.
    const daChamada = this.#daChamada as CadeiaMontada | null
    if (this.#previa) (daChamada ?? this.#daPrevia?.cadeia)?.definirOuvir(true)
    this.#emitir()
  }

  /**
   * The chain outside a call, for preview and meter. One chain only, opened
   * once even with two requests at the same time.
   *
   * With an active call without a chain ("Off"), uses clones of its track and
   * does not open the microphone again. Throws the `getUserMedia` or setup
   * error as is, or `audio-preview-unavailable` if no AudioWorklet.
   */
  async #garantirCadeiaFora(): Promise<void> {
    if (this.#daPrevia || this.#daChamada) return
    if (this.#abrindo) return this.#abrindo
    if (!cadeiaDisponivel()) throw new Error("audio-preview-unavailable")
    this.#abrindo = (async () => {
      let captura: MediaStream | null = null
      try {
        // With an active call: clones of its track, nothing new opened.
        const daChamadaViva = this.ligacoes.capturaDaChamada?.() ?? null
        const faixas = daChamadaViva?.getAudioTracks() ?? []
        captura =
          faixas.length > 0
            ? new MediaStream(faixas.map((faixa) => faixa.clone()))
            : await this.ligacoes.abrirMicrofone()
        // The meter must see the level with the call's input volume.
        this.#ganho = this.ligacoes.ganhoDeEntrada?.() ?? this.#ganho
        const cadeia = await this.#montar(captura)
        // Re-read after await: meanwhile a call may have come in, or preview and
        // meter may have turned off.
        if (!(this.#previa || this.#medidor) || this.#daChamada) {
          cadeia.fechar()
          await this.ligacoes.fecharMicrofone(captura)
          return
        }
        this.#daPrevia = { cadeia, captura }
      } catch (causa) {
        if (captura) await this.ligacoes.fecharMicrofone(captura).catch(() => {})
        throw causa
      }
    })()
    try {
      await this.#abrindo
    } finally {
      this.#abrindo = null
    }
  }

  estado(): EstadoDoAudio {
    return {
      perfil: this.#perfil,
      etapas: this.#etapas,
      forca: this.#forca,
      previa: this.#previa,
      motor: this.#motor(),
    }
  }

  /**
   * Bind to account preferences. Reads what is there, applies it, and starts
   * listening for changes from another device. Returns the disconnect function.
   */
  ligarPreferencias(fonte: FonteDePreferenciasDeAudio): () => void {
    this.#fonte = fonte
    let ligada = true
    void Promise.resolve(fonte.preferencias())
      .then((preferencias) => {
        if (ligada) this.#aplicarPreferencias(preferencias)
      })
      .catch((causa: unknown) => this.ligacoes.aoDiagnosticar("audio-preferencias-nao-lidas", String(causa)))
    const desligarOuvinte = fonte.on?.("preferencias", ({ preferencias }) => this.#aplicarPreferencias(preferencias))
    return () => {
      ligada = false
      desligarOuvinte?.()
      if (this.#fonte === fonte) this.#fonte = null
    }
  }

  // ---------------------------------------------------------------- what the call uses

  /** Is the call capture passing through the chain right now? */
  get temCadeia(): boolean {
    return this.#daChamada !== null
  }

  /** Will the chain be created on the next capture? */
  get ativa(): boolean {
    // A manual line also needs the chain: that is where the gate lives.
    return (this.#perfil !== "desligado" || this.#limiar !== null) && cadeiaDisponivel()
  }

  /**
   * What to request from `getUserMedia` (and `applyConstraints`) for the native
   * suppressor and automatic gain. With our suppression on, the native suppressor
   * turns off: two suppressors in series eat the voice twice. Same for automatic
   * gain when our AGC is on. If our model did not load, the native one returns.
   * Assumes the capture goes through the chain: the caller confirms it first
   * (`ativa` on open, `temCadeia` mid-stream).
   */
  restricoesNativas(pedido: { noiseSuppression: boolean; autoGainControl: boolean }): {
    noiseSuppression: boolean
    autoGainControl: boolean
  } {
    const nossaSupressao = this.#perfil !== "desligado" && this.#etapas.supressao && !this.#modeloFalhou
    const nossoAgc = this.#perfil !== "desligado" && this.#etapas.compressor
    return {
      noiseSuppression: nossaSupressao ? false : pedido.noiseSuppression,
      autoGainControl: nossoAgc ? false : pedido.autoGainControl,
    }
  }

  /**
   * Pass the call capture through the chain. Returns the processed track (plus
   * call video if any), or `null` if the chain could not be created. Then the
   * call follows the old path.
   */
  async tratarCaptura(bruto: MediaStream, ganho: number): Promise<MediaStream | null> {
    this.largarCaptura()
    if (!this.ativa || bruto.getAudioTracks().length === 0) return null
    this.#ganho = ganho
    try {
      // A preview outside a call gives way to the call's preview: the same microphone
      // opened twice, and two speaker outputs, help no one.
      await this.#fecharPrevia()
      const cadeia = await this.#montar(bruto)
      this.#daChamada = cadeia
      if (this.#previa) cadeia.definirOuvir(true)
      this.#emitir()
      return new MediaStream([...cadeia.saida.getAudioTracks(), ...bruto.getVideoTracks()])
    } catch (causa) {
      this.ligacoes.aoDiagnosticar("audio-cadeia-indisponivel", String((causa as Error)?.message ?? causa))
      return null
    }
  }

  /** The call ended (or a new capture will open): tear down its chain. */
  largarCaptura(): void {
    const cadeia = this.#daChamada
    if (!cadeia) return
    this.#daChamada = null
    cadeia.fechar()
    if (this.#previa) this.#previa = false
    this.#emitir()
  }

  /**
   * The state of the call chain for the microphone watch (`vigia-do-microfone.ts`).
   *
   * The context, the last heartbeat from the worklet and whether it crashed.
   * `null` with no call chain.
   */
  get saudeDaCadeia(): { readonly contexto: AudioContext; readonly ultimoBatimento: number; readonly rebentou: boolean } | null {
    return this.#daChamada
  }

  /** The call microphone changed mid-call: same chain, same output track. */
  trocarMicrofone(bruto: MediaStream): boolean {
    if (!this.#daChamada) return false
    this.#daChamada.trocarEntrada(bruto)
    return true
  }

  // ---------------------------------------------------------------- internals

  #cadeia(): CadeiaMontada | null {
    return this.#daChamada ?? this.#daPrevia?.cadeia ?? null
  }

  #motor(): EstadoDoAudio["motor"] {
    const cadeia = this.#cadeia()
    if (!cadeia) return "nenhum"
    if (this.#perfil === "desligado" || !this.#etapas.supressao) return "nativo"
    const estados: Record<EstadoDoMotor, EstadoDoAudio["motor"]> = {
      "a-carregar": "a-carregar",
      pronto: "modelo",
      falhou: "nativo",
    }
    return estados[cadeia.motor]
  }

  async #montar(captura: MediaStream): Promise<CadeiaMontada> {
    return CadeiaMontada.montar(captura, {
      config: configuracaoPara(this.#perfil, this.#etapas, this.#forca, this.#ganho, this.#limiar),
      aoMotor: (estado, detalhe) => {
        if (estado === "falhou") {
          // Without our model, the browser suppressor goes back to work: better than
          // nothing, and the person still has suppression.
          this.#modeloFalhou = true
          this.ligacoes.aoDiagnosticar("audio-modelo-falhou", detalhe)
          this.ligacoes.aoMudarNativo()
        } else if (estado === "pronto") {
          this.#modeloFalhou = false
        }
        this.#emitir()
      },
      aoDiagnosticar: (code, detail) => this.ligacoes.aoDiagnosticar(code, detail),
    })
  }

  async #fecharPrevia(): Promise<void> {
    const previa = this.#daPrevia
    if (!previa) return
    this.#daPrevia = null
    previa.cadeia.fechar()
    await this.ligacoes.fecharMicrofone(previa.captura).catch(() => {})
  }

  #aplicar(): void {
    const config = configuracaoPara(this.#perfil, this.#etapas, this.#forca, this.#ganho, this.#limiar)
    this.#daChamada?.configurar(config)
    this.#daPrevia?.cadeia.configurar(config)
    this.ligacoes.aoMudarNativo()
    this.#emitir()
  }

  #aplicarPreferencias(preferencias: Readonly<Record<string, string>>): void {
    const perfil = preferencias[CHAVES_DE_PREFERENCIA.perfil]
    const novoPerfil = ehPerfil(perfil) ? perfil : this.#perfil
    const etapas = lerEtapas(
      preferencias[CHAVES_DE_PREFERENCIA.etapas],
      novoPerfil === this.#perfil ? this.#etapas : etapasDoPerfil(novoPerfil),
    )
    const forca = lerForca(
      preferencias[CHAVES_DE_PREFERENCIA.forca],
      novoPerfil === this.#perfil ? this.#forca : forcaDoPerfil(novoPerfil),
    )
    const mudou =
      novoPerfil !== this.#perfil ||
      forca !== this.#forca ||
      ETAPAS_DE_AUDIO.some((etapa) => etapas[etapa] !== this.#etapas[etapa])
    if (!mudou) return
    this.#perfil = novoPerfil
    this.#etapas = etapas
    this.#forca = forca
    this.#aplicar()
  }

  async #gravar(valores: Record<string, string>): Promise<void> {
    const fonte = this.#fonte
    if (!fonte) return
    try {
      for (const [chave, valor] of Object.entries(valores)) await fonte.definirPreferencia(chave, valor)
    } catch (causa) {
      throw new Error("audio-preference-save-failed", { cause: { mensagem: String((causa as Error)?.message ?? causa) } })
    }
  }

  #emitir(): void {
    this.ligacoes.aoMudar(this.estado())
  }
}
