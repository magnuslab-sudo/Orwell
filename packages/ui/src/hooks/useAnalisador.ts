import { useEffect, useState } from "react"
import { obterContextoDeAudio } from "../lib/contextoDeAudio.js"

/**
 * An `AnalyserNode` on someone's MUSIC track, to draw it.
 *
 * It serves the visualizer on the card of whoever is streaming (`Visualizer`)
 * and the spectrum on the "Share Audio" sheet (`Spectrum`). On the DJ side the
 * track is from the player; on the listener side, it is the incoming stream.
 *
 * It measures a CLONE, like `useNivelDeVoz` and for the same reason: on Chrome,
 * connecting the graph to the stream that a media element is playing can mute
 * the element. A visualization must never mute the music it draws. The clone
 * stops when unmounted.
 *
 * The context is the shared one for the room (`obterContextoDeAudio`): one per
 * page, not one per card. Nothing connects to the destination: the analyzer
 * reads, it does not play.
 *
 * `ligado` false (stopped, out of view, reduced motion) tears everything down:
 * with no analyzer there is no work per frame.
 */
export function useAnalisador(stream: MediaStream | null, ligado: boolean): AnalyserNode | null {
  const [analisador, setAnalisador] = useState<AnalyserNode | null>(null)

  useEffect(() => {
    if (!ligado || !stream) return
    const faixas = stream.getAudioTracks()
    if (faixas.length === 0) return
    const ctx = obterContextoDeAudio()
    if (!ctx) return
    // A context created outside a gesture starts suspended, and an analyzer in a
    // suspended context reads zeros: the drawing would stay frozen while music
    // plays. We ask to resume; if the browser refuses, it stays as it was.
    if (ctx.state === "suspended" && typeof ctx.resume === "function") void Promise.resolve(ctx.resume()).catch(() => {})
    const clones = faixas.map((faixa) => faixa.clone())
    let fonte: MediaStreamAudioSourceNode | null = null
    let no: AnalyserNode | null = null
    try {
      fonte = ctx.createMediaStreamSource(new MediaStream(clones))
      no = ctx.createAnalyser()
      // 1024 samples: 512 bins of ~47 Hz at 48 kHz. Enough to split bass (up to
      // 250 Hz, five bins) from mids and treble.
      no.fftSize = 1024
      // Smooth, so the animation breathes with the music and does not stutter on every beat.
      no.smoothingTimeConstant = 0.78
      fonte.connect(no)
      setAnalisador(no)
    } catch {
      for (const clone of clones) clone.stop()
      return
    }
    return () => {
      fonte?.disconnect()
      no?.disconnect()
      for (const clone of clones) clone.stop()
      setAnalisador(null)
    }
  }, [stream, ligado])

  return analisador
}

/** The three bands, 0 to 1, read from one frame of the analyzer. */
export interface Bandas {
  graves: number
  medios: number
  agudos: number
}

/**
 * Bass (up to 250 Hz), mids (up to 2 kHz) and treble (up to 12 kHz), each the
 * average of the analyzer bins in that range, 0 to 1. `dados` is a
 * `Uint8Array` the size of `frequencyBinCount`, reused between frames.
 */
export function lerBandas(analisador: AnalyserNode, dados: Uint8Array<ArrayBuffer>): Bandas {
  analisador.getByteFrequencyData(dados)
  const hzPorBanda = analisador.context.sampleRate / analisador.fftSize
  const media = (de: number, ate: number): number => {
    const inicio = Math.max(1, Math.floor(de / hzPorBanda))
    const fim = Math.min(dados.length, Math.max(inicio + 1, Math.ceil(ate / hzPorBanda)))
    let soma = 0
    for (let i = inicio; i < fim; i++) soma += dados[i] ?? 0
    return soma / ((fim - inicio) * 255)
  }
  return { graves: media(20, 250), medios: media(250, 2000), agudos: media(2000, 12000) }
}
