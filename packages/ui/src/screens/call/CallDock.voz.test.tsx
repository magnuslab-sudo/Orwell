import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import type { Participant } from "@enclave/client-core"
import { clonesFeitos, montarWebAudioFalso, vozFalsa, type VozFalsa } from "../../hooks/vozFalsa.js"
import { CallDock } from "./CallDock.js"

/**
 * The dock stops blinking by the clock and starts saying what is arriving.
 *
 * What was here was `.call-dot`: a seven-pixel dot with
 * `animation: pulse 1.8s infinite`. It blinked to a stopwatch rhythm, with the
 * call live, dead, or everyone quiet, the only thing it claimed was that the
 * dock exists, and that already shows on the whole card.
 *
 * The waveform claims something else, and it is one no one had: **sound is
 * arriving, from someone, now**. A still waveform with people talking on
 * the other side is the first clue the connection broke, and before this there was none.
 */

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

let audio: ReturnType<typeof montarWebAudioFalso>

beforeEach(() => {
  audio = montarWebAudioFalso()
})

afterEach(() => {
  cleanup()
  audio.desmontar()
})

function participante(address: string, voz: VozFalsa | null, connected = true): Participant {
  return { address, connected, stream: voz?.stream ?? null } as Participant
}

function doca(overrides: Partial<React.ComponentProps<typeof CallDock>> = {}): React.JSX.Element {
  return (
    <CallDock
      channel="!geral:s"
      channelLabel="geral"
      participants={[]}
      localStream={null}
      nameFor={(sender) => sender}
      onBack={() => {}}
      onLeave={() => {}}
      {...overrides}
    />
  )
}

/** The level the entire dock carries written, which the waveform inside inherits. */
const nivel = (container: HTMLElement): string =>
  container.querySelector<HTMLElement>(".call-dock")?.style.getPropertyValue("--voz") ?? "sem doca"

describe("a doca mostra a voz da chamada, e não um ponto a piscar", () => {
  it("tem uma onda, e já não tem o ponto que pulsava a relógio", () => {
    const { container } = render(doca())

    expect(container.querySelector(".call-dock-onda")).toBeTruthy()
    expect(container.querySelectorAll(".call-dock-onda .onda-barra")).toHaveLength(5)
    expect(container.querySelector(".call-dot")).toBeNull()
  })

  it("mexe-se com quem está a falar do outro lado", () => {
    const ana = vozFalsa("ana", 100)
    const { container } = render(doca({ participants: [participante("@ana:s", ana)] }))

    expect(nivel(container)).toBe("")
    audio.correrUm()
    expect(nivel(container)).toBe("1.000")

    ana.falar(0)
    for (let i = 0; i < 200; i++) audio.correrUm()
    expect(nivel(container)).toBe("0.000")
  })

  it("com várias pessoas, segue a mais alta e não a soma delas", () => {
    /*
      Two silent people do not make one talking, and three talking at once do not
      blow the scale. The dock has one waveform for the whole call: what it says
      is "sound is arriving", and the loudest is the right answer.
    */
    const ana = vozFalsa("ana", 0)
    const rui = vozFalsa("rui", 100)
    const { container } = render(
      doca({ participants: [participante("@ana:s", ana), participante("@rui:s", rui)] }),
    )

    audio.correrUm()
    expect(nivel(container)).toBe("1.000")
  })

  it("uma ligação a meio caminho não apaga a onda de quem já fala", () => {
    /*
      The sound slot is reserved on all connections, with or without voice coming:
      a person joining brings a stream with no track. If one of those cancelled
      the meter for the whole dock, the waveform would vanish every time someone
      joined the call and come back on its own a few seconds later.
    */
    const ana = vozFalsa("ana", 100)
    const { container } = render(
      doca({
        participants: [participante("@aluno:s", null, false), participante("@ana:s", ana)],
      }),
    )

    audio.correrUm()
    expect(nivel(container)).toBe("1.000")
  })

  it("NÃO se mexe com a nossa própria voz", () => {
    /*
      The dock is what you glance at while somewhere else in the app, and the
      question you ask it is "is that still alive?". Your own voice always
      answers yes, even with the call broken on the other side. A waveform that
      animates when you look at it does not tell you anything.
    */
    const eu = vozFalsa("eu", 100)
    const { container } = render(doca({ localStream: eu.stream }))

    audio.correrUm()
    expect(nivel(container)).toBe("")
  })

  it("sem som, a onda continua a dizer que falam e deixa de se apresentar como som a sair", () => {
    const ana = vozFalsa("ana", 100)
    const { container } = render(doca({ participants: [participante("@ana:s", ana)], soundOff: true }))

    audio.correrUm()
    expect(nivel(container)).toBe("1.000")
    expect(container.querySelector(".call-dock-onda")?.classList.contains("sem-som")).toBe(true)
  })
})

describe("o custo da doca", () => {
  it("as caixas escondidas deixaram de medir: a doca mede uma vez, para a onda", () => {
    /*
      These boxes live in a one-pixel square at 1% opacity, and exist only for
      audio to play through. Each one ran its own meter, per person, per frame,
      to paint a ring inside an invisible element.
    */
    const ana = vozFalsa("ana", 100)
    const rui = vozFalsa("rui", 100)
    const { container } = render(
      doca({ participants: [participante("@ana:s", ana), participante("@rui:s", rui)] }),
    )

    audio.correrUm()

    const caixas = [...container.querySelectorAll<HTMLElement>(".call-dock-audio .tile")]
    expect(caixas).toHaveLength(3)
    expect(caixas.map((caixa) => caixa.style.getPropertyValue("--voz"))).toEqual(["", "", ""])
    // And one band cloned per voice, not one per voice per box.
    expect(clonesFeitos).toHaveLength(2)
  })

  it("um render novo com as mesmas vozes não volta a clonar faixa nenhuma", () => {
    /*
      The trap in this hook. `participants` gets rebuilt on every `App` render-
      a message arrives, a count changes, and the array is a new object with the
      same people inside it. With the array as a dependency of the meter effect,
      it would unmount and remount several times a second: stopping bands, cloning
      bands, creating analyzers, all over again, and the waveform restarting from
      zero each time.
      
      So the dependency is a KEY made from the stream `id`s. Here we document what
      that saves, which is the only way the key won't vanish in a refactor.
      */
    const ana = vozFalsa("ana", 100)
    const { rerender } = render(doca({ participants: [participante("@ana:s", ana)] }))
    expect(clonesFeitos).toHaveLength(1)

    // A new array, with a new participant, with the SAME stream: this is what
    // `App` delivers on every render.
    for (let volta = 0; volta < 5; volta++) {
      rerender(doca({ participants: [participante("@ana:s", ana)] }))
    }
    expect(clonesFeitos).toHaveLength(1)

    // And a new voice remounts, as it should.
    const rui = vozFalsa("rui", 100)
    rerender(doca({ participants: [participante("@ana:s", ana), participante("@rui:s", rui)] }))
    expect(clonesFeitos).toHaveLength(3)
  })
})
