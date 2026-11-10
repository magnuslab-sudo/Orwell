import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "@testing-library/react"
import { useRef } from "react"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/**
 * The voice meter: what it measures, and what it cannot do.
 *
 * ⚠️ This file had three tests and all three were negative, does not crash,
 * does not write to output, does not mount without a track. None of them
 * measured a level. `--voz`, which is the only thing this hook produces and
 * the only thing CSS reads, was never asserted anywhere in the repo: a stub
 * `useNivelDeVoz = () => {}` passed the entire suite. RMS, `LIMIAR`,
 * the asymmetry `SUBIDA`/`DESCIDA`, and normalization had no tests.
 *
 * ⚠️ And there was a second trap, quieter. The module stores the
 * `AudioContext` in a module variable (`let contexto`), on purpose: browsers
 * cut off around a dozen per page. But that lets the context from the
 * FIRST test survive all the following ones, the third test's `vi.stubGlobal`
 * was ignored, and its `expect(criar).not.toHaveBeenCalled()` passed because
 * `criar` could never have been called, not because the guard works. Hence
 * the `vi.resetModules()` and dynamic import: each test gets a freshly born
 * module with an empty cache.
 */

/** Each test imports the hook again, to not inherit the context from the previous one. */
async function montarCartao(stream: MediaStream | null): Promise<HTMLElement> {
  const { useNivelDeVoz } = await import("./useNivelDeVoz.js")
  function Cartao(): React.JSX.Element {
    const caixa = useRef<HTMLDivElement>(null)
    useNivelDeVoz(caixa, stream)
    return <div ref={caixa} data-testid="cartao" />
  }
  const { getByTestId } = render(<Cartao />)
  return getByTestId("cartao")
}

/**
 * A fake stream, with an audio track and nothing else.
 *
 * The track knows how to clone itself: the meter analyzes a clone and never
 * the stream that is playing. See the hook header, wiring Web Audio to the
 * stream feeding the media element mutes it, and a meter that mutes what it
 * measures is worse than not existing.
 */
function comSom(): { stream: MediaStream; clones: { parada: boolean }[] } {
  const clones: { parada: boolean }[] = []
  const faixa = {
    clone(): unknown {
      const clone = { parada: false, stop(): void { clone.parada = true } }
      clones.push(clone)
      return clone
    },
  }
  const stream = {
    getAudioTracks: () => [faixa],
    getVideoTracks: () => [],
  } as unknown as MediaStream
  return { stream, clones }
}

/**
 * The frames the hook requested, so they can run one by one.
 *
 * `medir()` reschedules itself at the end, so running one frame consumes the
 * pending one and leaves the next one scheduled.
 */
function relogioDeFrames(): { correrUm: () => void; pendente: () => boolean } {
  let proximo: (() => void) | null = null
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    proximo = cb
    return 1
  })
  vi.stubGlobal("cancelAnimationFrame", () => {
    proximo = null
  })
  return {
    correrUm: () => {
      const agora = proximo
      proximo = null
      act(() => agora?.())
    },
    pendente: () => proximo !== null,
  }
}

/**
 * A fake Web Audio where the waveform is chosen by the test.
 *
 * `amplitude` is each sample's offset from silence (128), which is exactly
 * what the hook converts to RMS: a constant wave at 128+n gives an RMS value
 * of n/128, with no arithmetic in between and no room for doubt about what
 * is being measured.
 */
function webAudioFalso(amplitude: number): { onda: (nova: number) => void } {
  let actual = amplitude
  const analisador = {
    fftSize: 0,
    connect: vi.fn(),
    disconnect: vi.fn(),
    // Body with braces: `fill` returns the array itself, and an `arrow` with
    // concise body annotated `: void` returning `Uint8Array` is a type error.
    // Passes tests and only `typecheck` catches it, which is where it was red.
    getByteTimeDomainData: (destino: Uint8Array): void => {
      destino.fill(128 + Math.round(actual))
    },
    // The same wave in floating point, which is what the hook reads: n/128.
    getFloatTimeDomainData: (destino: Float32Array): void => {
      destino.fill(actual / 128)
    },
  }
  const fonte = { connect: vi.fn(), disconnect: vi.fn() }
  class ContextoFalso {
    destination = {}
    createMediaStreamSource = (): typeof fonte => fonte
    createAnalyser = (): typeof analisador => analisador
  }
  vi.stubGlobal("AudioContext", ContextoFalso)
  vi.stubGlobal("MediaStream", class {
    constructor(public faixas: unknown[]) {}
  })
  // The wave changes AFTER mounting, and it must be in the same analyzer: the
  // hook stores the reference it received at the input. Calling `webAudioFalso`
  // again created a new analyzer that the hook never sees, and a test that
  // thought it was measuring silence measured loud voice from before, and passed.
  return { onda: (nova: number) => { actual = nova } }
}

beforeEach(() => {
  vi.resetModules()
})

/**
 * What the hook PRODUCES: `--voz`, from 0 to 1, by the scale in `lib/medidorDeDb.ts`.
 *
 * The numbers all come from the same formula: a constant wave with amplitude n
 * has RMS n/128; the first reading rises halfway (`SUBIDA = 0.5`); the level
 * in dBFS goes to the scale, which starts at −50 and reaches 1 at −12. Room
 * noise only raises the start of the scale after 2 s (`ChaoDeRuido`), and
 * these tests run before that.
 */
const amplitudeDe = (db: number): number => 128 * 10 ** (db / 20)

describe("useNivelDeVoz — o nível que sai", () => {
  it("uma voz alta escreve o anel no máximo", async () => {
    webAudioFalso(100)
    const frames = relogioDeFrames()
    const cartao = await montarCartao(comSom().stream)

    // Before any frame there is nothing written: the value comes from the measurement.
    expect(cartao.style.getPropertyValue("--voz")).toBe("")

    // Amplitude 100 → RMS 0.78 → smoothed 0.39 → −8.2 dBFS, above −12: 1.
    frames.correrUm()
    expect(cartao.style.getPropertyValue("--voz")).toBe("1.000")
    // And it keeps measuring: the cycle reschedules itself.
    expect(frames.pendente()).toBe(true)
  })

  it("uma sala calada escreve zero, e não fica a meio", async () => {
    webAudioFalso(0)
    const frames = relogioDeFrames()
    const cartao = await montarCartao(comSom().stream)

    frames.correrUm()
    expect(cartao.style.getPropertyValue("--voz")).toBe("0.000")
  })

  /*
    The owner's calibration (October 26, 2026), point by point. Each level is
    held until the smoothed value reaches it. The whisper is what the bytes
    could not read: at −45 dBFS the amplitude is 0.7, below the step of a byte.
  */
  it.each([
    ["ruído de fundo, −56 dBFS", -56, 0],
    ["sussurro, −45 dBFS", -45, 0.132],
    ["fala, −30 dBFS", -30, 0.526],
    ["fala alta, −15 dBFS", -15, 0.921],
  ])("%s dá %s", async (_nome, db, esperado) => {
    webAudioFalso(amplitudeDe(db))
    const frames = relogioDeFrames()
    const cartao = await montarCartao(comSom().stream)
    for (let i = 0; i < 40; i++) frames.correrUm()
    expect(Number(cartao.style.getPropertyValue("--voz"))).toBeCloseTo(esperado, 2)
  })

  it("sobe depressa e desce devagar, que é o que faz o anel respirar em vez de piscar", async () => {
    const audio = webAudioFalso(64)
    const frames = relogioDeFrames()
    const cartao = await montarCartao(comSom().stream)

    frames.correrUm()
    expect(Number(cartao.style.getPropertyValue("--voz"))).toBeGreaterThan(0.99)

    // The person goes silent mid-sentence: the SAME analyzer now gives silence.
    audio.onda(0)

    // A frame of silence does not erase the ring: the descent traverses 8% of the
    // path, against 50% for the rise.
    frames.correrUm()
    expect(Number(cartao.style.getPropertyValue("--voz"))).toBeGreaterThan(0.5)

    // And it actually does descend, otherwise what was measured was a stuck value.
    for (let i = 0; i < 200; i++) frames.correrUm()
    expect(cartao.style.getPropertyValue("--voz")).toBe("0.000")
  })

  it("ao sair, o cartão fica sem a propriedade — e não com o último valor colado", async () => {
    webAudioFalso(64)
    const frames = relogioDeFrames()
    const { useNivelDeVoz } = await import("./useNivelDeVoz.js")
    function Cartao(): React.JSX.Element {
      const caixa = useRef<HTMLDivElement>(null)
      useNivelDeVoz(caixa, comSom().stream)
      return <div ref={caixa} data-testid="cartao" />
    }
    const { getByTestId, unmount } = render(<Cartao />)
    const cartao = getByTestId("cartao")

    frames.correrUm()
    expect(cartao.style.getPropertyValue("--voz")).toBe("0.999")

    unmount()
    // A ring on forever in a card that nobody is measuring anymore.
    expect(cartao.style.getPropertyValue("--voz")).toBe("")
  })
})

/**
 * Our own card measures before the gate (`dbDaEntrada`), and the reduced
 * movement steps in increments.
 */
describe("useNivelDeVoz — a entrada de fora e o movimento reduzido", () => {
  async function montarCom(dbDaEntrada?: () => number | null): Promise<HTMLElement> {
    const { useNivelDeVoz } = await import("./useNivelDeVoz.js")
    const { stream } = comSom()
    function Cartao(): React.JSX.Element {
      const caixa = useRef<HTMLDivElement>(null)
      useNivelDeVoz(caixa, stream, { dbDaEntrada })
      return <div ref={caixa} data-testid="cartao" />
    }
    return render(<Cartao />).getByTestId("cartao")
  }

  it("com `dbDaEntrada`, mede esse nível e não a faixa (que o gate calou)", async () => {
    // The track is in silence, as after the gate; the input is at −30 dBFS.
    webAudioFalso(0)
    const frames = relogioDeFrames()
    const cartao = await montarCom(() => -30)
    for (let i = 0; i < 40; i++) frames.correrUm()
    expect(Number(cartao.style.getPropertyValue("--voz"))).toBeCloseTo(0.526, 2)
  })

  it("e sem medida de fora (`null`) cai para a faixa", async () => {
    webAudioFalso(64)
    const frames = relogioDeFrames()
    const cartao = await montarCom(() => null)
    frames.correrUm()
    expect(cartao.style.getPropertyValue("--voz")).toBe("0.999")
  })

  it("com `prefers-reduced-motion`, o nível anda em passos de 10%", async () => {
    vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: consulta.includes("reduce") }))
    webAudioFalso(amplitudeDe(-30))
    const frames = relogioDeFrames()
    const cartao = await montarCom()
    for (let i = 0; i < 40; i++) frames.correrUm()
    expect(cartao.style.getPropertyValue("--voz")).toBe("0.500")
  })
})

/**
 * And what it cannot do. Two things, and both have already broken interfaces
 * in other lives:
 *
 * 1. In an environment without Web Audio it must be silent. `AudioContext`
 *    does not exist in jsdom or old browsers, and a hook that crashes on
 *    mount takes the whole call down with it, without sound measured there
 *    is still a call, without a card there is nothing.
 *
 * 2. Never wire the meter to the audio output. An `AnalyserNode` measures
 *    without playing; wiring it to the destination meant hearing each person
 *    twice, the second time without passing through the volume they chose.
 */
describe("useNivelDeVoz — o que ele não faz", () => {
  it("num ambiente sem Web Audio não rebenta nem escreve nada", async () => {
    vi.stubGlobal("AudioContext", undefined)
    const cartao = await montarCartao(comSom().stream)

    expect(cartao.style.getPropertyValue("--voz")).toBe("")
  })

  it("mede sem reproduzir: o analisador nunca chega ao destino do som", async () => {
    const analisador = { fftSize: 0, connect: vi.fn(), disconnect: vi.fn(), getByteTimeDomainData: vi.fn() }
    const fonte = { connect: vi.fn(), disconnect: vi.fn() }
    const destino = {}
    let criado: unknown = null
    class ContextoFalso {
      destination = destino
      createMediaStreamSource = (entrada: unknown): typeof fonte => {
        criado = entrada
        return fonte
      }
      createAnalyser = (): typeof analisador => analisador
    }
    vi.stubGlobal("AudioContext", ContextoFalso)
    vi.stubGlobal("MediaStream", class {
      constructor(public faixas: unknown[]) {}
    })

    const { stream, clones } = comSom()
    const { useNivelDeVoz } = await import("./useNivelDeVoz.js")
    function Cartao(): React.JSX.Element {
      const caixa = useRef<HTMLDivElement>(null)
      useNivelDeVoz(caixa, stream)
      return <div ref={caixa} data-testid="cartao" />
    }
    const { unmount } = render(<Cartao />)

    expect(fonte.connect).toHaveBeenCalledWith(analisador)
    // What matters: nothing was wired to the output.
    expect(analisador.connect).not.toHaveBeenCalled()
    // And what was measured is a CLONE, not the stream that is playing. It is not
    // enough to say it is something else, `not.toBe(stream)` was satisfied by
    // `null`, by `undefined`, and by any wrong object. Say which one it is.
    expect(clones).toHaveLength(1)
    expect((criado as { faixas: unknown[] }).faixas).toEqual(clones)

    // And on exit it unwires what it wired and stops what it cloned, or one track
    // per person per call remains consuming from the same source.
    unmount()
    expect(fonte.disconnect).toHaveBeenCalled()
    expect(clones[0]?.parada).toBe(true)
  })

  it("sem faixa de som não monta medidor nenhum", async () => {
    const criar = vi.fn()
    class ContextoFalso {
      createMediaStreamSource = criar
      createAnalyser = (): unknown => ({})
    }
    vi.stubGlobal("AudioContext", ContextoFalso)

    await montarCartao({ getAudioTracks: () => [], getVideoTracks: () => [{}] } as unknown as MediaStream)

    expect(criar).not.toHaveBeenCalled()
  })
})
