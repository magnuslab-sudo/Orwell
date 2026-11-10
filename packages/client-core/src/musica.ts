import { Emitter } from "./emitter.js"

/**
 * The music player for a call: files or playlists, played on this device.
 *
 * Phase 9 de `docs/planos/definicoes-0-9.md`, the first source of "Share audio". The DJ picks files (or a folder), the player queues them, and the
 * sound goes out through ONE stereo track (`faixa`) that the call puts on the air with
 * `Call.partilharMusica`. The track stays the same from start to end of the queue: changing
 * a file does not create a new producer or renegotiate anything.
 *
 * ## How it decodes, and why it is not `decodeAudioData`
 *
 * `decodeAudioData` decodes the ENTIRE file to float-point PCM: one hour of stereo music at 48 kHz is 48 000 × 2 × 4 bytes per
 * second, 1,4 GB. "In chunks" does not help: only MP3 cuts into independent frames;
 * M4A, FLAC and OGG need the whole container, and manual cutting means writing
 * a demultiplexer per format.
 *
 * So the player uses an `<audio>` element with an `blob:` URL and connects it to the
 * graph with `createMediaElementSource`. The element decodes in chunks, as it plays (the same engine that plays video), and the `File` of a
 * `<input type="file">` is read from disk when needed: memory stays at
 * a few seconds of sound, whether there is one file or two hundred. The formats
 * are what the browser can play (`.mp3`, `.m4a`, `.ogg`, `.flac`, `.wav` across
 * three engines, with `.ogg` only from Safari 17).
 *
 * ## What goes out, and where
 *
 * ```
 * <audio blob:> → MediaElementSource ─┬→ ganho da emissão → MediaStreamAudioDestination → faixa (chamada)
 *                                     └→ ganho local → altifalantes (o DJ ouve)
 * ```
 *
 * The send gain is the DJ's "Send volume" (owner, 27 October of
 * 2026): it affects what GOES OUT, before it reaches listeners, not what the DJ hears.
 * Each listener still has their own volume for the music on top of this.
 *
 * The DJ hears through the SAME node that feeds the track, not through the call: the music
 * never comes back in anywhere, and never goes through the voice chain (that is the
 * microphone chain, and noise reduction eats the music).
 */

/** The extensions the selector accepts. MIME types vary by system; these don't. */
export const EXTENSOES_DE_AUDIO = [".mp3", ".m4a", ".ogg", ".flac", ".wav"] as const

/** A file, as the interface delivers it: a `File` (or a `Blob` with a name). */
export interface FicheiroDeAudio extends Blob {
  readonly name: string
}

/** Is this file one the player can play? Check the extension, then the type if missing. */
export function eFicheiroDeAudio(ficheiro: { name: string; type?: string }): boolean {
  const nome = ficheiro.name.toLowerCase()
  if (EXTENSOES_DE_AUDIO.some((extensao) => nome.endsWith(extensao))) return true
  // No known extension, the type decides: an `audio/*` with no nice name plays.
  return !nome.includes(".") && (ficheiro.type ?? "").startsWith("audio/")
}

/** The display name: the file name, without extension or folder. */
export function nomeDaFaixa(nomeDoFicheiro: string): string {
  const semPasta = nomeDoFicheiro.split(/[\\/]/).pop() ?? nomeDoFicheiro
  const ponto = semPasta.lastIndexOf(".")
  const nome = ponto > 0 ? semPasta.slice(0, ponto) : semPasta
  return nome.trim() || semPasta
}

/** A track in the queue. The `id` belongs to the player, not the file: the same file can appear twice. */
export interface FaixaNaFila {
  readonly id: string
  readonly nome: string
  /** The duration in seconds, once the browser reads it from the metadata. */
  readonly duracao?: number
}

export interface EstadoDoLeitor {
  readonly fila: readonly FaixaNaFila[]
  /** The loaded track (playing or paused), or none. */
  readonly actual: string | null
  readonly aTocar: boolean
  /** At the end of the queue, loop back to the first instead of stopping. */
  readonly repetir: boolean
  /** Shuffle on: what's left to play, and what enters, goes in random order. */
  readonly aleatorio: boolean
}

/** Where the loaded track plays, in seconds. `duration` is `null` while unknown. */
export interface PosicaoDoLeitor {
  readonly tempo: number
  readonly duracao: number | null
}

export type EventosDoLeitor = {
  estado: EstadoDoLeitor
  /** A track the browser can't read. The key goes into the interface's error catalog. */
  erro: { detail: string; nome: string }
}

/** What the player needs from the browser. Injectable, so tests don't need sound. */
export interface DependenciasDoLeitor {
  criarContexto: () => AudioContext
  criarElemento: () => HTMLAudioElement
  criarUrl: (ficheiro: Blob) => string
  largarUrl: (url: string) => void
  /** Between 0 (inclusive) and 1 (exclusive), like `Math.random`. */
  aleatorio: () => number
  /**
   * The duration of a file, read only from metadata (the browser doesn't decode
   * the entire file for this). `null` when unknown.
   */
  lerDuracao: (ficheiro: Blob) => Promise<number | null>
}

const DEPENDENCIAS_DO_BROWSER: DependenciasDoLeitor = {
  criarContexto: () => new AudioContext({ latencyHint: "playback" }),
  criarElemento: () => new Audio(),
  criarUrl: (ficheiro) => URL.createObjectURL(ficheiro),
  largarUrl: (url) => URL.revokeObjectURL(url),
  aleatorio: () => Math.random(),
  lerDuracao: lerDuracaoNoBrowser,
}

/**
 * A separate `<audio>` with `preload = "metadata"`: reads the header and stops.
 * One per file, one at a time isn't needed: they're small reads. No browser (tests
 * in Node), or with a file it can't read, `null`.
 */
function lerDuracaoNoBrowser(ficheiro: Blob): Promise<number | null> {
  if (typeof Audio === "undefined" || typeof URL.createObjectURL !== "function") return Promise.resolve(null)
  return new Promise((resolver) => {
    let url = ""
    try {
      url = URL.createObjectURL(ficheiro)
    } catch {
      resolver(null)
      return
    }
    const elemento = new Audio()
    const acabar = (valor: number | null): void => {
      elemento.onloadedmetadata = null
      elemento.onerror = null
      elemento.removeAttribute("src")
      URL.revokeObjectURL(url)
      resolver(valor)
    }
    elemento.preload = "metadata"
    elemento.onloadedmetadata = () => acabar(Number.isFinite(elemento.duration) ? elemento.duration : null)
    elemento.onerror = () => acabar(null)
    elemento.src = url
  })
}

interface Entrada {
  readonly id: string
  readonly nome: string
  readonly ficheiro: Blob
  duracao?: number
}

/** The graph: born on the first play (that's when the person gestures). */
interface Grafo {
  contexto: AudioContext
  elemento: HTMLAudioElement
  destino: MediaStreamAudioDestinationNode
  emissao: GainNode
  monitor: GainNode
}

export class LeitorDeMusica extends Emitter<EventosDoLeitor> {
  readonly #deps: DependenciasDoLeitor
  #fila: Entrada[] = []
  #actual: string | null = null
  #aTocar = false
  #grafo: Grafo | null = null
  /** The `blob:` of the loaded file. One at a time: the others stay on disk. */
  #url: string | null = null
  #carregado: string | null = null
  #proximoId = 1
  #volumeLocal = 1
  #volumeDaEmissao = 1
  #repetir = false
  #aleatorio = false
  #fechado = false

  constructor(deps: Partial<DependenciasDoLeitor> = {}) {
    super()
    this.#deps = { ...DEPENDENCIAS_DO_BROWSER, ...deps }
  }

  get estado(): EstadoDoLeitor {
    return {
      fila: this.#fila.map(({ id, nome, duracao }) => (duracao === undefined ? { id, nome } : { id, nome, duracao })),
      actual: this.#actual,
      aTocar: this.#aTocar,
      repetir: this.#repetir,
      aleatorio: this.#aleatorio,
    }
  }

  /**
   * Where the loaded track plays. Read when asked (the sheet view asks each
   * frame while open); no per-second event.
   */
  get posicao(): PosicaoDoLeitor {
    const elemento = this.#grafo?.elemento
    const duracaoDaFila = this.#fila.find((entrada) => entrada.id === this.#actual)?.duracao ?? null
    if (!elemento || this.#carregado === null) return { tempo: 0, duracao: duracaoDaFila }
    const duracao = Number.isFinite(elemento.duration) && elemento.duration > 0 ? elemento.duration : duracaoDaFila
    return { tempo: Number.isFinite(elemento.currentTime) ? elemento.currentTime : 0, duracao }
  }

  /** Jump to `seconds` within the loaded track. */
  procurar(segundos: number): void {
    const elemento = this.#grafo?.elemento
    if (!elemento || this.#carregado === null || !Number.isFinite(segundos)) return
    const fim = Number.isFinite(elemento.duration) ? elemento.duration : segundos
    elemento.currentTime = Math.min(Math.max(0, segundos), fim)
  }

  get repetir(): boolean {
    return this.#repetir
  }

  set repetir(valor: boolean) {
    if (this.#repetir === valor) return
    this.#repetir = valor
    this.#mudou()
  }

  get aleatorio(): boolean {
    return this.#aleatorio
  }

  /** Turn shuffle on to randomize what's left to play; off leaves the order as is. */
  set aleatorio(valor: boolean) {
    if (this.#aleatorio === valor) return
    this.#aleatorio = valor
    if (valor) this.baralhar()
    else this.#mudou()
  }

  /**
   * Put track `id` at position `index` in the queue (drag to reorder). The
   * loaded track stays the same: only what comes next changes.
   */
  mover(id: string, indice: number): void {
    const de = this.#fila.findIndex((entrada) => entrada.id === id)
    if (de < 0) return
    const [entrada] = this.#fila.splice(de, 1)
    if (!entrada) return
    const para = Math.min(Math.max(0, Math.trunc(indice)), this.#fila.length)
    this.#fila.splice(para, 0, entrada)
    this.#mudou()
  }

  /**
   * The previous track. After three seconds, it restarts the current track,
   * like players do: the first tap replays, the second tap rewinds.
   */
  async anterior(): Promise<void> {
    if (this.posicao.tempo > 3) {
      this.procurar(0)
      return
    }
    const indice = this.#fila.findIndex((entrada) => entrada.id === this.#actual)
    const antes = this.#fila[indice - 1]
    if (!antes) {
      this.procurar(0)
      return
    }
    const tocava = this.#aTocar
    this.#actual = antes.id
    if (tocava) await this.tocar()
    else this.#mudou()
  }

  /** The name of the playing track, for the "Now playing: ..." signal. */
  get nomeActual(): string | null {
    return this.#fila.find((entrada) => entrada.id === this.#actual)?.nome ?? null
  }

  /**
   * The stereo track that the caller sends. Stays the same while the player lives.
   *
   * `null` before the first "play": the `AudioContext` only starts with a user gesture,
   * and one created earlier would stay suspended (autoplay policy).
   */
  get faixa(): MediaStreamTrack | null {
    return this.#grafo?.destino.stream.getAudioTracks()[0] ?? null
  }

  /** How loud the DJ hears themselves, from 0 to 1. Does not change what goes out to the call. */
  get volumeLocal(): number {
    return this.#volumeLocal
  }

  set volumeLocal(valor: number) {
    this.#volumeLocal = Math.min(1, Math.max(0, valor))
    if (this.#grafo) this.#grafo.monitor.gain.value = this.#volumeLocal
  }

  /**
   * How loud the call output is, from 0 to 1. Does not change what the DJ hears.
   *
   * Restored before the graph is created: the interface sets this value from storage
   * when the sheet opens, and the first "play" already uses it.
   */
  get volumeDaEmissao(): number {
    return this.#volumeDaEmissao
  }

  set volumeDaEmissao(valor: number) {
    this.#volumeDaEmissao = Math.min(1, Math.max(0, Number.isFinite(valor) ? valor : 1))
    if (this.#grafo) this.#grafo.emissao.gain.value = this.#volumeDaEmissao
  }

  /**
   * Add files to the end of the queue. Non-audio files are skipped.
   *
   * @returns how many were added, so the interface can say "none of these
   * files are audio" instead of doing nothing.
   */
  acrescentar(ficheiros: Iterable<FicheiroDeAudio>): number {
    if (this.#fechado) return 0
    let entraram = 0
    for (const ficheiro of ficheiros) {
      if (!eFicheiroDeAudio(ficheiro)) continue
      const entrada: Entrada = { id: `f${this.#proximoId++}`, nome: nomeDaFaixa(ficheiro.name), ficheiro }
      this.#fila.push(entrada)
      entraram++
      void this.#deps.lerDuracao(ficheiro).then((duracao) => {
        if (duracao === null || this.#fechado || !this.#fila.includes(entrada)) return
        entrada.duracao = duracao
        this.#mudou()
      }, () => {})
    }
    if (entraram === 0) return 0
    // With shuffle on, incoming tracks mix with what is left to play.
    if (this.#aleatorio && this.#actual !== null) {
      this.baralhar()
      return entraram
    }
    // The first track is ready, but does not play: playing is a user gesture.
    if (this.#actual === null) this.#actual = this.#fila[this.#fila.length - entraram]?.id ?? null
    this.#mudou()
    return entraram
  }

  /** Play track `id`, or continue the loaded one. Called from a click. */
  async tocar(id?: string): Promise<void> {
    if (this.#fechado) return
    if (id !== undefined) {
      if (!this.#fila.some((entrada) => entrada.id === id)) return
      this.#actual = id
    }
    if (this.#actual === null) this.#actual = this.#fila[0]?.id ?? null
    const entrada = this.#fila.find((cada) => cada.id === this.#actual)
    if (!entrada) return

    const grafo = this.#montarGrafo()
    this.#carregar(grafo.elemento, entrada)
    this.#aTocar = true
    this.#mudou()
    try {
      // The context starts suspended outside a gesture; inside the click it resumes.
      if (grafo.contexto.state === "suspended") await grafo.contexto.resume()
      await grafo.elemento.play()
    } catch (erro) {
      // The browser refused it (bad format, corrupted file). The element's `error`
      // handles format; this catches playback refusal.
      if (this.#actual !== entrada.id) return
      this.#aTocar = false
      this.#mudou()
      this.emit("erro", { detail: "could not play this audio file", nome: String((erro as Error)?.name ?? erro) })
    }
  }

  /** Pause. The track stays loaded, and sends silence (which DTX does not send). */
  pausar(): void {
    if (!this.#aTocar) return
    this.#aTocar = false
    this.#grafo?.elemento.pause()
    this.#mudou()
  }

  /** Skip to the next track. At the end of the queue, it stops. */
  async saltar(): Promise<void> {
    const indice = this.#fila.findIndex((entrada) => entrada.id === this.#actual)
    // With "Repeat", after the last comes the first.
    const seguinte = this.#fila[indice + 1] ?? (this.#repetir ? this.#fila[0] : undefined)
    if (!seguinte) {
      this.#pararNoFim()
      return
    }
    const tocava = this.#aTocar
    if (seguinte.id === this.#actual) {
      // A single track on repeat: it restarts.
      this.procurar(0)
      if (tocava) await this.tocar()
      return
    }
    this.#actual = seguinte.id
    if (tocava) await this.tocar()
    else this.#mudou()
  }

  /**
   * Shuffle what is left to play. The loaded track stays where it is.
   *
   * Shuffling the whole queue would change the music mid-listen; the gesture
   * means "next, play in a different order".
   */
  baralhar(): void {
    const indice = this.#fila.findIndex((entrada) => entrada.id === this.#actual)
    const fixas = this.#fila.slice(0, indice + 1)
    const resto = this.#fila.slice(indice + 1)
    // Fisher-Yates: each order has the same probability.
    for (let i = resto.length - 1; i > 0; i--) {
      const j = Math.floor(this.#deps.aleatorio() * (i + 1))
      ;[resto[i], resto[j]] = [resto[j] as Entrada, resto[i] as Entrada]
    }
    this.#fila = [...fixas, ...resto]
    this.#mudou()
  }

  /** Remove a track from the queue. If it is playing, move to the next one. */
  async remover(id: string): Promise<void> {
    const indice = this.#fila.findIndex((entrada) => entrada.id === id)
    if (indice < 0) return
    if (id !== this.#actual) {
      this.#fila.splice(indice, 1)
      this.#mudou()
      return
    }
    const seguinte = this.#fila[indice + 1] ?? null
    const tocava = this.#aTocar
    this.#fila.splice(indice, 1)
    this.#esvaziarElemento()
    if (!seguinte) {
      this.#pararNoFim()
      return
    }
    this.#actual = seguinte.id
    if (tocava) await this.tocar()
    else this.#mudou()
  }

  /** Clean up everything: sound, `blob:` urls, context. The player will not play again. */
  fechar(): void {
    if (this.#fechado) return
    this.#fechado = true
    this.#aTocar = false
    this.#esvaziarElemento()
    const grafo = this.#grafo
    this.#grafo = null
    if (grafo) {
      grafo.elemento.onended = null
      grafo.elemento.onerror = null
      // The track stops with the context: whoever had it in the call sees it `ended`.
      for (const faixa of grafo.destino.stream.getTracks()) faixa.stop()
      void grafo.contexto.close().catch(() => {})
    }
    this.#fila = []
    this.#actual = null
    this.#mudou()
  }

  #montarGrafo(): Grafo {
    if (this.#grafo) return this.#grafo
    const contexto = this.#deps.criarContexto()
    const elemento = this.#deps.criarElemento()
    elemento.preload = "auto"
    const fonte = contexto.createMediaElementSource(elemento)
    // Explicit stereo: the default destination follows the source, and a mono track
    // at the start of the queue would make the call track mono forever.
    const destino = contexto.createMediaStreamDestination()
    destino.channelCount = 2
    const emissao = contexto.createGain()
    emissao.gain.value = this.#volumeDaEmissao
    const monitor = contexto.createGain()
    monitor.gain.value = this.#volumeLocal
    fonte.connect(emissao)
    emissao.connect(destino)
    fonte.connect(monitor)
    monitor.connect(contexto.destination)

    // The queue runs on its own: one ends, the next plays.
    elemento.onended = () => {
      void this.saltar()
    }
    // A file the browser cannot read (a FLAC on old Safari, a corrupted file)
    // does not stop the show: we report it and skip to the next.
    elemento.onerror = () => {
      const nome = this.nomeActual ?? ""
      this.emit("erro", { detail: "could not read this audio file", nome })
      const id = this.#actual
      if (id !== null) void this.remover(id)
    }
    this.#grafo = { contexto, elemento, destino, emissao, monitor }
    return this.#grafo
  }

  #carregar(elemento: HTMLAudioElement, entrada: Entrada): void {
    if (this.#carregado === entrada.id) return
    this.#esvaziarElemento()
    this.#url = this.#deps.criarUrl(entrada.ficheiro)
    this.#carregado = entrada.id
    elemento.src = this.#url
  }

  /** Release the loaded `blob:` url. Without this each played track stays locked until the page closes. */
  #esvaziarElemento(): void {
    if (this.#url) this.#deps.largarUrl(this.#url)
    this.#url = null
    this.#carregado = null
    const elemento = this.#grafo?.elemento
    if (elemento) {
      elemento.pause()
      elemento.removeAttribute("src")
    }
  }

  #pararNoFim(): void {
    this.#aTocar = false
    this.#esvaziarElemento()
    this.#actual = null
    this.#mudou()
  }

  #mudou(): void {
    this.emit("estado", this.estado)
  }
}
