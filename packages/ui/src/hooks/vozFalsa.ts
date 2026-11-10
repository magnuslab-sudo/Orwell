/**
 * A Web Audio fake, with a real graph inside.
 *
 * It exists for visible voice tests: the call card, the dock waveform, and the
 * Settings meter. jsdom has no `AudioContext`, and a double that always returns
 * the same waveform turns all three tests into tests of whether the hook
 * doesn't crash.
 *
 * All the care is here: this double CONNECTS nodes to each other. A `connect`
 * stores who was plugged into whom, a `GainNode` multiplies what reaches it,
 * and what an analyser reads is what traveled the path to it. Without that, the
 * Settings meter would pass with the gain out of the signal path, which is
 * exactly the bug it was written not to repeat (the noise suppressor that saved
 * to disk but never reached the live track).
 *
 * What stays fake, and fairly: there is no sound. The "amplitude" is the
 * constant deviation of each sample from silence (128), which is exactly what
 * the meter converts to RMS, a waveform steady at 128+n gives an RMS value of
 * n/128, no arithmetic in between and no room to doubt what we're measuring.
 */

/** The deviation of each sample, per voice. Changeable mid-test. */
const amplitudes = new Map<string, number>()

interface No {
  /** What comes out of this node, in amplitude. */
  nivel(): number
  entradas: No[]
  connect(destino: No): No
  disconnect(): void
}

function ligar(nivel: () => number): No {
  const no: No = {
    entradas: [],
    nivel,
    connect(destino: No): No {
      destino.entradas.push(no)
      return destino
    },
    disconnect(): void {
      no.entradas.length = 0
    },
  }
  return no
}

/** The max of what goes in, which is what a mix node does for real. */
const doQueEntra = (no: No): number => no.entradas.reduce((maior, entrada) => Math.max(maior, entrada.nivel()), 0)

/** A fake track: can clone itself, can stop, and knows its level. */
export interface FaixaFalsa {
  kind: "audio"
  parada: boolean
  nivel(): number
  stop(): void
  clone(): FaixaFalsa
}

/** The clones the meter made, so we can verify they were stopped. */
export const clonesFeitos: FaixaFalsa[] = []

function faixa(nivel: () => number): FaixaFalsa {
  const dela: FaixaFalsa = {
    kind: "audio",
    parada: false,
    nivel,
    stop(): void {
      dela.parada = true
    },
    clone(): FaixaFalsa {
      const clone = faixa(nivel)
      clonesFeitos.push(clone)
      return clone
    },
  }
  return dela
}

class StreamFalso {
  constructor(
    readonly faixas: FaixaFalsa[],
    readonly id: string = `s${Math.random().toString(36).slice(2, 8)}`,
    /** A connected camera. Changes what the call shows, not what it measures. */
    readonly video: boolean = false,
  ) {}
  getAudioTracks(): FaixaFalsa[] {
    return this.faixas
  }
  getVideoTracks(): unknown[] {
    return this.video ? [{ kind: "video" }] : []
  }
  getTracks(): FaixaFalsa[] {
    return this.faixas
  }
}

export interface VozFalsa {
  /** What we give to a component, shaped like a `MediaStream`. */
  stream: MediaStream
  /** Change what this voice is saying, mid-test. */
  falar(amplitude: number): void
}

/**
 * A voice, with a name.
 *
 * The name lets us change it after the component is mounted: the meter holds
 * the reference it got at input, and creating a new stream would give an
 * analyser it never sees, a test that thought it was measuring silence would
 * measure the old voice and pass.
 */
export function vozFalsa(nome: string, amplitude = 0, opcoes: { video?: boolean } = {}): VozFalsa {
  amplitudes.set(nome, amplitude)
  const stream = new StreamFalso([faixa(() => amplitudes.get(nome) ?? 0)], nome, opcoes.video ?? false)
  return {
    stream: stream as unknown as MediaStream,
    falar: (novo: number) => amplitudes.set(nome, novo),
  }
}

/** A stream with no audio track: a camera, or a connection in progress. */
export function semVoz(nome = "sem-voz"): MediaStream {
  return new StreamFalso([], nome) as unknown as MediaStream
}

/** The gain the Settings meter puts in the signal path, visible to the test. */
export interface GanhoFalso {
  gain: { value: number }
}

/** The `GainNode` objects created, in order. The Settings meter creates one. */
export const ganhos: GanhoFalso[] = []

/** Quantos contextos foram abertos, e quantos foram fechados. */
export const contextos = { abertos: 0, fechados: 0 }

class ContextoFalso {
  destination = ligar(() => 0)

  constructor() {
    contextos.abertos += 1
  }

  createMediaStreamSource(entrada: StreamFalso): No {
    return ligar(() => entrada.getAudioTracks().reduce((maior, uma) => Math.max(maior, uma.nivel()), 0))
  }

  createGain(): No & GanhoFalso {
    const gain = { value: 1 }
    const no = ligar(() => doQueEntra(no) * gain.value) as No & GanhoFalso
    no.gain = gain
    ganhos.push(no)
    return no
  }

  /**
   * The amplified playback limiter. Passes what reaches it: what it does for
   * real is bite the peaks, and a double that simulated it would be making up
   * numbers. What the tests need to know is that it IS in the path.
   */
  createDynamicsCompressor(): No & Record<string, { value: number }> {
    const no = ligar(() => doQueEntra(no)) as No & Record<string, { value: number }>
    for (const campo of ["threshold", "knee", "ratio", "attack", "release"]) no[campo] = { value: 0 }
    return no
  }

  createMediaStreamDestination(): No & { stream: StreamFalso } {
    const no = ligar(() => doQueEntra(no)) as No & { stream: StreamFalso }
    // The track out of here has no level of its own: it has the level of what
    // reached it through the graph. This is what makes gain show in the meter
    // without anyone summing it by hand, and this is what a fixed-amplitude double
    // cannot do.
    no.stream = new StreamFalso([faixa(() => no.nivel())])
    return no
  }

  createAnalyser(): No & {
    fftSize: number
    getByteTimeDomainData(destino: Uint8Array): void
    getFloatTimeDomainData(destino: Float32Array): void
  } {
    const no = ligar(() => doQueEntra(no)) as No & {
      fftSize: number
      getByteTimeDomainData(destino: Uint8Array): void
      getFloatTimeDomainData(destino: Float32Array): void
    }
    no.fftSize = 0
    // The same voice in floating point: amplitude n is n/128, like bytes, but
    // without the format cap or the 1/128 step.
    no.getFloatTimeDomainData = (destino: Float32Array): void => {
      destino.fill(no.nivel() / 128)
    }
    no.getByteTimeDomainData = (destino: Uint8Array): void => {
      // The 127 cap is the format's: a sample is a byte, and 128+128 doesn't exist.
      // A gain of two on a loud voice saturates, just like for real.
      destino.fill(128 + Math.min(127, Math.round(no.nivel())))
    }
    return no
  }

  close(): Promise<void> {
    contextos.fechados += 1
    return Promise.resolve()
  }
}

/** What was there before, so we can restore it at the end. */
interface Reposicao {
  correrUm(): void
  pendente(): boolean
  desmontar(): void
}

/**
 * Set up fake Web Audio and a frame clock that runs by hand.
 *
 * The `medir()` of the hook reschedules itself at the end, so running a
 * frame is consuming pending callbacks and scheduling the next ones.
 *
 * ⚠️ PENDING, plural, not singular. A call panel mounts one meter per
 * person, and a clock that keeps only the last callback runs one meter and leaves
 * the others stopped. The first version of this file did that: Ana's card had no level and the test said, quite rightly, that the card does not respond.
 */
export function montarWebAudioFalso(): Reposicao {
  const antes = {
    AudioContext: globalThis.AudioContext,
    MediaStream: globalThis.MediaStream,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  }
  amplitudes.clear()
  clonesFeitos.length = 0
  ganhos.length = 0
  contextos.abertos = 0
  contextos.fechados = 0

  const pendentes = new Map<number, () => void>()
  let proximaMarca = 0
  const global = globalThis as unknown as Record<string, unknown>
  global.AudioContext = ContextoFalso
  global.MediaStream = StreamFalso
  global.requestAnimationFrame = (cb: () => void): number => {
    proximaMarca += 1
    pendentes.set(proximaMarca, cb)
    return proximaMarca
  }
  global.cancelAnimationFrame = (marca: number): void => {
    pendentes.delete(marca)
  }

  return {
    correrUm(): void {
      // A copy: each callback re-schedules itself, and iterating the live map would
      // run the next frame inside this one, forever.
      const agora = [...pendentes]
      pendentes.clear()
      for (const [, callback] of agora) callback()
    },
    pendente: () => pendentes.size > 0,
    desmontar(): void {
      global.AudioContext = antes.AudioContext
      global.MediaStream = antes.MediaStream
      global.requestAnimationFrame = antes.requestAnimationFrame
      global.cancelAnimationFrame = antes.cancelAnimationFrame
    },
  }
}
