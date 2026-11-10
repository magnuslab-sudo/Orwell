import { Emitter } from "./emitter.js"

/**
 * CAPTURED sources from the DJ: a browser tab, system audio, or a window.
 * Phase 9 de `docs/planos/definicoes-0-9.md`, the second slice (owner, 2 November 2026: "go").
 * The first slice is files (`musica.ts`).
 *
 * All three come from the same place, the `getDisplayMedia`, which is what screen
 * sharing already uses. What changes is what gets requested and what happens
 * to it:
 *
 *  - **The video frame is dropped immediately.** The browser won't give audio
 *    without video (`video` cannot be `false`), so request the smallest frame
 *    possible and stop the video track before anything else. Never goes to
 *    the call.
 *  - **Audio goes to the MUSIC track**, not the screen audio track:
 *    `Call.partilharMusica`, with the same producer, the same cipher and the same volume
 *    and mute behavior as files have.
 *  - **No voice processing**, like music: no echo cancellation, no noise
 *    reduction, no automatic gain. And with `restrictOwnAudio`, within `audio`,
 *    so that voice from the call playing on this page doesn't feed back into
 *    the system audio.
 *
 * ```
 * getDisplayMedia ─┬→ vídeo: stop() logo
 *                  └→ áudio → MediaStreamSource → ganho da emissão → MediaStreamDestination → faixa (chamada)
 * ```
 *
 * Gain is the DJ's "Emission Volume", the same slider as files. The DJ
 * doesn't hear himself here: the tab keeps playing for him in the browser
 * (`suppressLocalAudioPlayback: false`), and the system plays what it plays.
 *
 * At the end: the browser's "Stop sharing" terminates the audio track. The
 * destination track doesn't stop on its own, so the browser track is heard
 * and `fim` is sent, and the caller removes the music from the call.
 */

export type FonteCapturada = "separador" | "sistema" | "janela"

/** Audio, as requested for all sources. See the header. */
const SOM_SEM_TRATAMENTO = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  /* Call voice excluded from captured audio. Track constraint (Chrome 140+,
     Windows and macOS): Chrome ignores it at the top of the request. A browser
     that doesn't know it ignores it too, without refusing. */
  restrictOwnAudio: true,
  /* System audio separator keeps playing for the DJ. */
  suppressLocalAudioPlayback: false,
} as const

/** The smallest image the browser accepts. Dropped right away; the small request just saves engine work. */
const IMAGEM_MINIMA = { width: { max: 320 }, height: { max: 180 }, frameRate: { max: 1 } } as const

/**
 * The request to `getDisplayMedia` for each source.
 *
 * Members the browser doesn't know are ignored. The audio checkbox in Chrome's
 * selector can't be set by code: it comes checked for the system audio separator;
 * it comes unchecked for the full screen, hence the sheet message and error 480.
 */
export function pedidoDoSomDaFonte(fonte: FonteCapturada): Record<string, unknown> {
  const comum = {
    audio: { ...SOM_SEM_TRATAMENTO },
    /* Our own page off the list: its audio is the call. */
    selfBrowserSurface: "exclude",
    preferCurrentTab: false,
  }
  switch (fonte) {
    case "separador":
      return {
        ...comum,
        video: { ...IMAGEM_MINIMA, displaySurface: "browser" },
        monitorTypeSurfaces: "exclude",
        systemAudio: "exclude",
        /* Switch separators mid-stream without stopping music. */
        surfaceSwitching: "include",
      }
    case "sistema":
      return {
        ...comum,
        video: { ...IMAGEM_MINIMA, displaySurface: "monitor" },
        monitorTypeSurfaces: "include",
        systemAudio: "include",
        surfaceSwitching: "exclude",
      }
    case "janela":
      return {
        ...comum,
        video: { ...IMAGEM_MINIMA, displaySurface: "window" },
        monitorTypeSurfaces: "exclude",
        windowAudio: "system",
        systemAudio: "include",
        surfaceSwitching: "include",
      }
  }
}

/**
 * A display name, or nothing.
 *
 * Chrome puts in the track label either a name or an engine identifier
 * (`screen:0:0`, `window:1234:0`, `web-contents-media-stream://…`, a random
 * base64 code). An identifier on the DJ's card tells nobody anything.
 */
export function nomeDaOrigem(etiqueta: string | null | undefined): string | null {
  const limpa = (etiqueta ?? "").trim()
  if (limpa === "") return null
  if (/^(screen|window|tab):[\d:-]+$/i.test(limpa)) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(limpa)) return null
  // A random identifier (a screen label, a UUID): long, no spaces, with digits.
  // A long window name has spaces.
  if (limpa.length >= 20 && /^[A-Za-z0-9+/=_-]+$/.test(limpa) && /\d/.test(limpa)) return null
  return limpa
}

export interface DependenciasDaCaptura {
  /** This browser's `getDisplayMedia`, or nothing if it doesn't exist. */
  getDisplayMedia?: ((pedido: unknown) => Promise<MediaStream>) | undefined
  criarContexto: () => AudioContext
  criarFluxo: (faixas: MediaStreamTrack[]) => MediaStream
}

function dependenciasDoBrowser(): DependenciasDaCaptura {
  const media = typeof navigator === "undefined" ? undefined : (navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (pedido: unknown) => Promise<MediaStream> } | undefined)
  return {
    getDisplayMedia: typeof media?.getDisplayMedia === "function" ? (pedido) => media.getDisplayMedia!(pedido) : undefined,
    criarContexto: () => new AudioContext({ latencyHint: "playback" }),
    criarFluxo: (faixas) => new MediaStream(faixas),
  }
}

export type EventosDoSomCapturado = {
  /** A source has ended: stopped here, or by the browser ("Stop sharing"). Once. */
  fim: { fonte: FonteCapturada }
}

/** A captured source live. See the header. */
export class SomCapturado extends Emitter<EventosDoSomCapturado> {
  readonly fonte: FonteCapturada
  /** The name of the tab or window, if known. `null` means the source did not provide it. */
  readonly origem: string | null
  readonly #fonteDoBrowser: MediaStreamTrack
  readonly #contexto: AudioContext
  readonly #ganho: GainNode
  readonly #faixa: MediaStreamTrack
  #volumeDaEmissao: number
  #parado = false

  constructor(partes: {
    fonte: FonteCapturada
    origem: string | null
    fonteDoBrowser: MediaStreamTrack
    contexto: AudioContext
    ganho: GainNode
    faixa: MediaStreamTrack
    volumeDaEmissao: number
  }) {
    super()
    this.fonte = partes.fonte
    this.origem = partes.origem
    this.#fonteDoBrowser = partes.fonteDoBrowser
    this.#contexto = partes.contexto
    this.#ganho = partes.ganho
    this.#faixa = partes.faixa
    this.#volumeDaEmissao = partes.volumeDaEmissao
    // The browser's "Stop sharing" action or the window closes: the track ends.
    this.#fonteDoBrowser.addEventListener("ended", () => this.parar())
  }

  /** The track going to the call: the destination's, not the browser's. */
  get faixa(): MediaStreamTrack {
    return this.#faixa
  }

  get parado(): boolean {
    return this.#parado
  }

  get volumeDaEmissao(): number {
    return this.#volumeDaEmissao
  }

  set volumeDaEmissao(valor: number) {
    this.#volumeDaEmissao = Math.min(1, Math.max(0, Number.isFinite(valor) ? valor : 1))
    this.#ganho.gain.value = this.#volumeDaEmissao
  }

  /** Drop everything: the browser capture (the recording badge disappears), the graph, the context. */
  parar(): void {
    if (this.#parado) return
    this.#parado = true
    if (this.#fonteDoBrowser.readyState !== "ended") this.#fonteDoBrowser.stop()
    this.#faixa.stop()
    void this.#contexto.close().catch(() => {})
    this.emit("fim", { fonte: this.fonte })
  }
}

export type ResultadoDaCaptura =
  | { ok: true; som: SomCapturado }
  | { ok: false; cancelado: true }
  | { ok: false; cancelado: false; detail: string; nome?: string }

/**
 * Open the browser's screen picker (or the app's) and bring in the audio from the source.
 *
 * Call from within the click: the audio context starts BEFORE the picker,
 * while the gesture is active, and keeps running.
 *
 * Does not throw. Closing the picker is `canceled`, not an error: the user
 * who closed it changed their mind.
 */
export async function capturarSomDaFonte(
  fonte: FonteCapturada,
  deps: Partial<DependenciasDaCaptura> = {},
  opcoes: { volumeDaEmissao?: number; origem?: string | null } = {},
): Promise<ResultadoDaCaptura> {
  const { getDisplayMedia, criarContexto, criarFluxo } = { ...dependenciasDoBrowser(), ...deps }
  if (typeof getDisplayMedia !== "function") {
    return { ok: false, cancelado: false, detail: "this device cannot capture a sound source" }
  }
  const contexto = criarContexto()
  const acordar = contexto.state === "suspended" ? contexto.resume().catch(() => {}) : Promise.resolve()
  const largarContexto = (): void => void contexto.close().catch(() => {})

  let fluxo: MediaStream
  try {
    fluxo = await getDisplayMedia(pedidoDoSomDaFonte(fonte))
  } catch (erro) {
    largarContexto()
    const nome = (erro as { name?: string })?.name ?? ""
    if (nome === "NotAllowedError" || nome === "AbortError") return { ok: false, cancelado: true }
    return { ok: false, cancelado: false, detail: "could not capture this sound source", nome: nome || String(erro) }
  }

  // The image out first, before anything else. Its name stays when it has one.
  const imagens = fluxo.getVideoTracks()
  const etiqueta = nomeDaOrigem(imagens[0]?.label)
  for (const imagem of imagens) imagem.stop()

  const [som, ...outros] = fluxo.getAudioTracks()
  for (const outro of outros) outro.stop()
  if (!som) {
    largarContexto()
    return { ok: false, cancelado: false, detail: "the chosen source gave no sound" }
  }

  const volumeDaEmissao = Math.min(1, Math.max(0, Number.isFinite(opcoes.volumeDaEmissao) ? (opcoes.volumeDaEmissao as number) : 1))
  let ganho: GainNode
  let faixa: MediaStreamTrack | undefined
  try {
    const entrada = contexto.createMediaStreamSource(criarFluxo([som]))
    ganho = contexto.createGain()
    ganho.gain.value = volumeDaEmissao
    // Explicit stereo, like files: the call track does not start mono.
    const destino = contexto.createMediaStreamDestination()
    destino.channelCount = 2
    entrada.connect(ganho)
    ganho.connect(destino)
    faixa = destino.stream.getAudioTracks()[0]
  } catch (erro) {
    som.stop()
    largarContexto()
    return { ok: false, cancelado: false, detail: "could not capture this sound source", nome: String((erro as Error)?.name ?? erro) }
  }
  if (!faixa) {
    som.stop()
    largarContexto()
    return { ok: false, cancelado: false, detail: "could not capture this sound source" }
  }
  await acordar
  if (contexto.state === "suspended") await contexto.resume().catch(() => {})
  return {
    ok: true,
    som: new SomCapturado({
      fonte,
      origem: nomeDaOrigem(opcoes.origem) ?? etiqueta,
      fonteDoBrowser: som,
      contexto,
      ganho,
      faixa,
      volumeDaEmissao,
    }),
  }
}
