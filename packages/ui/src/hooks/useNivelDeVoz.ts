import { useEffect, type RefObject } from "react"
import { obterContextoDeAudio } from "../lib/contextoDeAudio.js"
import { ChaoDeRuido, dbDeRms, emPassos, inicioDaEscala, nivelDaVoz } from "../lib/medidorDeDb.js"

/**
 * How much each person is speaking, written on their card.
 *
 * Owner's request on August 13, 2026: the call's cards respond to sound. In
 * a grid of still faces it is not clear who is speaking, the information
 * exists (it comes in the audio), it just was not on the screen anywhere.
 *
 * The value does NOT go through React state. It is measured every frame, and
 * a `setState` 60 times a second times the number of people in the call is an
 * entire grid redrawing itself because of a shadow. What comes out of here is
 * a CSS property (`--voz`, from 0 to 1) written directly to the element, and
 * the drawing is done by CSS from it, React never knows this is happening.
 *
 * `--voz` INHERITS, and that is what makes the rest cheap: written once on
 * the card, it reaches everything inside it. The wave (`components/Onda.tsx`)
 * does not measure anything, it reads `var(--voz)` from its container, and
 * that is why putting a wave in a card that already measures costs exactly
 * zero new measurements.
 *
 * Does not wire anything to the audio output: an `AnalyserNode` measures
 * without playing. Wiring it to the destination meant hearing each person
 * twice, one of them without volume control.
 *
 * In environments without Web Audio (jsdom, and old browsers) it does nothing
 * and does not complain: a card without a ring is still a card.
 */

/*
  The scale (from dBFS to `--voz`, from 0 to 1) lives in `lib/medidorDeDb.ts`:
  it lights up at −50 dBFS, reaches maximum at −12, and the start rises with
  room noise measured in the first 2 s. It was a threshold at RMS 0.06
  (−24 dBFS), and normal speech (−30) did not reach it: the owner saw sound
  coming in with no animation.
  */

/**
 * How much `--voz` has to change to be written. It was 0.02; with the new
 * scale quiet speech lives in the first 20%, and 0.02 were visible steps. The
 * cost per write does not change: CSS only uses `--voz` in `opacity` and
 * `transform` of already painted layers (the halo and the green ring), and in
 * the card's frame color.
 */
const PASSO_DE_ESCRITA = 0.005

/**
 * The descent is slow on purpose.
 *
 * Speech has pauses of tenths of a second between words, and a ring that
 * follows the raw signal flickers at each syllable. It rises fast (so the
 * response does not seem delayed) and falls slow (to endure the pauses): it
 * is the same principle as a VU meter, and the difference between a card that
 * breathes and one that strobes.
 */
const SUBIDA = 0.5
const DESCIDA = 0.08

/* The shared context moved to `lib/contextoDeAudio.ts` when it gained a
   second reader: amplification above 100%, in `VideoTile`. See the import
   at the top of this file. */

/**
 * What is measured: one voice, several, or none.
 *
 * Several is the dock. It draws ONE wave for the entire call, and what that
 * wave says is "sound is coming in", so what matters is the loudest person
 * at each instant, not the sum of them. One cycle, N analyzers, one maximum:
 * the alternative was to mount the meter N times and leave N cycles
 * arguing over who writes the same property, each one erasing the other's value.
 *
 * ⚠️ A LIST must be stable between renders (`useMemo`, with a key made
 * from the streams' `id`), or the effect remounts each render and reclones
 * tracks several times a second. A single `MediaStream` is stable by nature,
 * which is the case for all cards.
 */
export type Vozes = MediaStream | readonly MediaStream[] | null

/**
 * `dbDaEntrada`: the level in dBFS coming from outside, when there is one.
 * It is our own card: the track the call gives us (`localStream`) has already
 * gone through the voice chain and the gate, and the gate mutes quiet speech
 * before it reaches the meter. The chain measures the input BEFORE everything
 * (`call.audio.medir().entradaDb`), and that is the level the halo should
 * show. `null` (no chain) falls back to the track.
 *
 * The others' always comes from the received track, already decrypted: it is
 * what you hear.
 */
export function useNivelDeVoz(
  alvo: RefObject<HTMLElement | null>,
  vozes: Vozes,
  { dbDaEntrada }: { dbDaEntrada?: (() => number | null) | undefined } = {},
): void {
  useEffect(() => {
    const elemento = alvo.current
    const entradas: MediaStream[] = vozes === null ? [] : Array.isArray(vozes) ? [...vozes] : [vozes as MediaStream]
    if (!elemento || entradas.length === 0) return
    if (!entradas.some((entrada) => entrada.getAudioTracks().length > 0)) return

    const ctx = obterContextoDeAudio()
    if (!ctx) return

    /**
     * Measures a CLONE, and never the stream that is playing.
     *
     * Wiring a `MediaStreamAudioSourceNode` to the same stream that feeds the
     * media element is well-known territory for crashes in Chrome: the Web
     * Audio graph becomes owner of routing and the element goes silent, wired,
     * with the card on screen, and no sound coming out. A meter must never,
     * under any circumstance, be able to mute the person it measures.
     *
     * `clone()` gives independent tracks on the same source. They cost little
     * and stop at the end, along with everything else.
     */
    const faixas: MediaStreamTrack[] = []
    const fontes: MediaStreamAudioSourceNode[] = []
    const analisadores: AnalyserNode[] = []

    const largar = (): void => {
      for (const fonte of fontes) fonte.disconnect()
      for (const analisador of analisadores) analisador.disconnect()
      // The cloned tracks are ours: stopping them is mandatory, or one remains per
      // person per call, all consuming from the same source.
      for (const faixa of faixas) faixa.stop()
      fontes.length = 0
      analisadores.length = 0
      faixas.length = 0
    }

    for (const entrada of entradas) {
      const audio = entrada.getAudioTracks()
      if (audio.length === 0) continue
      const clones = audio.map((faixa) => faixa.clone())
      try {
        const fonte = ctx.createMediaStreamSource(new MediaStream(clones))
        const analisador = ctx.createAnalyser()
        // Small on purpose: 512 samples at 48 kHz are ~10 ms of sound, which is the
        // reaction time we want. A larger window smooths speech until it stops being
        // distinguishable from noise.
        analisador.fftSize = 512
        fonte.connect(analisador)
        faixas.push(...clones)
        fontes.push(fonte)
        analisadores.push(analisador)
      } catch {
        // A video-only stream, already closed, or an engine without `clone`. There is
        // no level to measure on THIS one, and not measuring never cost a call
        // anybody. The others in the list keep going: in a dock with four people, a
        // mid-way connection cannot erase the wave of the other three.
        for (const clone of clones) clone.stop()
      }
    }

    if (analisadores.length === 0) {
      largar()
      return
    }

    /*
      Samples in floating point, not bytes. A byte has 256 steps, and the
      smallest is 1/128 (−42 dBFS): a whisper at −45 dBFS read as ZERO.
      It was the other half of "sound coming in with no animation". Bytes stay
      only for an engine without `getFloatTimeDomainData`.
    */
    const comFloat = typeof analisadores[0]!.getFloatTimeDomainData === "function"
    const amostras = new Float32Array(analisadores[0]!.fftSize)
    const bytes = new Uint8Array(analisadores[0]!.fftSize)
    let suavizado = 0
    let anterior = -1
    let frame = 0
    const agora = (): number => globalThis.performance?.now() ?? Date.now()
    const chao = new ChaoDeRuido(agora())
    // Read once per mount: with reduced movement the level steps at 10%
    // increments, and only writes when it changes step.
    const reduzido = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false

    const medir = (): void => {
      // The loudest of all, not the sum: two silent people do not make one
      // speaking, and three speaking at once do not blow the scale.
      let nivel = 0
      const deFora = dbDaEntrada?.() ?? null
      if (deFora !== null && Number.isFinite(deFora)) {
        nivel = 10 ** (deFora / 20)
      } else {
        for (const analisador of analisadores) {
          // Root mean square (RMS), not the peak: the peak spikes on a keystroke and
          // an entire sentence spoken quietly never gets there.
          let soma = 0
          if (comFloat) {
            analisador.getFloatTimeDomainData(amostras)
            for (const amostra of amostras) soma += amostra * amostra
          } else {
            analisador.getByteTimeDomainData(bytes)
            for (const amostra of bytes) {
              const desvio = (amostra - 128) / 128
              soma += desvio * desvio
            }
          }
          const desta = Math.sqrt(soma / amostras.length)
          if (desta > nivel) nivel = desta
        }
      }

      suavizado = nivel > suavizado ? suavizado + (nivel - suavizado) * SUBIDA : suavizado + (nivel - suavizado) * DESCIDA

      const db = dbDeRms(suavizado)
      const instante = agora()
      chao.observar(db, instante)
      const cru = nivelDaVoz(db, inicioDaEscala(chao.valor(instante)))
      const escala = reduzido ? emPassos(cru) : cru
      // Only writes when it changes enough to be visible: writing to `style` every
      // frame forces the browser to recalculate style even when the value is the
      // same to three decimal places.
      if (Math.abs(escala - anterior) > PASSO_DE_ESCRITA) {
        elemento.style.setProperty("--voz", escala.toFixed(3))
        anterior = escala
      }
      frame = requestAnimationFrame(medir)
    }
    frame = requestAnimationFrame(medir)

    return () => {
      cancelAnimationFrame(frame)
      largar()
      elemento.style.removeProperty("--voz")
    }
  }, [alvo, vozes, dbDaEntrada])
}
