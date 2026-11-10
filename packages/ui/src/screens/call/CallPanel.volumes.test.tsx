import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render } from "@testing-library/react"
import type { Participant } from "@enclave/client-core"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { PREFS_KEY } from "../../hooks/usePrefs.js"
import { ganhos, montarWebAudioFalso, vozFalsa } from "../../hooks/vozFalsa.js"
import { esquecerContextoDeAudio } from "../../lib/contextoDeAudio.js"
import { strings } from "../../strings.js"
import { CallDock } from "./CallDock.js"
import { CallPanel } from "./CallPanel.js"

/**
 * Each person's volume survives the panel that displayed it.
 *
 * Owner complaint on August 13, 2026: "when you switch windows, the volume
 * we changed resets from the users". That was right, and for two reasons:
 *
 * 1. The map lived in a `useState` of the panel, labeled "for the life of the
 *    call". The panel's life is even shorter: it lives inside the conversation
 *    screen, and switching channels unmounts it.
 * 2. The dock, which plays sound while the panel is off screen, never knew
 *    these values. It played everyone at 100%.
 *
 * Both tests bite: without persistence, the first one remounts with the slider at
 * 1; without `volume` in the dock, the second finds the element at 1.
 */

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  // The context is stored for the whole page, and each test file installs a fake
  // Web Audio context: without this, the second test connects to the previous
  // test's context and measures a graph that is no longer its own.
  esquecerContextoDeAudio()
})

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

function participante(address: string): Participant {
  return { address, connected: true, stream: null } as Participant
}

const perfil = { displayName: "Eu", donations: [] } as unknown as Profile

function painel(): React.JSX.Element {
  return (
    <CallPanel
      call={{ setMuted: () => {}, setCameraOff: () => {} } as unknown as EnclaveBridge["call"]}
      channel="!geral:s"
      participants={[participante("@ana:s")]}
      localStream={null}
      selfLabel="Eu"
      selfProfile={perfil}
      nameFor={(sender) => sender}
      directory={new Map()}
      onToggleMic={() => {}}
      onToggleSound={() => {}}
      onLeave={() => {}}
    />
  )
}

/**
 * A panel with real audio coming in.
 *
 * `stream: null` is enough to measure what the element writes, but not for
 * amplification: no track means nothing to amplify, and a test on a silent
 * participant would assert the silence instead of the rule.
 */
function painelComVoz(): React.JSX.Element {
  const ana = vozFalsa("ana", 30)
  return (
    <CallPanel
      call={{ setMuted: () => {}, setCameraOff: () => {} } as unknown as EnclaveBridge["call"]}
      channel="!geral:s"
      participants={[{ address: "@ana:s", connected: true, stream: ana.stream } as Participant]}
      localStream={null}
      selfLabel="Eu"
      selfProfile={perfil}
      nameFor={(sender) => sender}
      directory={new Map()}
      onToggleMic={() => {}}
      onToggleSound={() => {}}
      onLeave={() => {}}
    />
  )
}

const cursor = (container: HTMLElement): HTMLInputElement =>
  container.querySelector<HTMLInputElement>(".chip-volume input[type='range']")!

describe("CallPanel — o volume de cada pessoa", () => {
  it("sobrevive a desmontar e voltar, que é o que mudar de canal faz", () => {
    const primeiro = render(painel())
    fireEvent.change(cursor(primeiro.container), { target: { value: "0.3" } })
    expect(cursor(primeiro.container).value).toBe("0.3")

    // Switching channels unmounts the panel. When you come back, it's a new component.
    cleanup()
    const segundo = render(painel())

    expect(cursor(segundo.container).value).toBe("0.3")
  })

  it("e chega ao elemento que toca o som, e não só ao cursor", () => {
    const primeiro = render(painel())
    fireEvent.change(cursor(primeiro.container), { target: { value: "0.2" } })
    cleanup()

    const { container } = render(painel())
    // The first box is ours (always muted); the other person's comes next.
    const audios = [...container.querySelectorAll<HTMLVideoElement>(".call-video video")]
    expect(audios[1]?.volume).toBeCloseTo(0.2)
  })
})

describe("CallDock — o que se escolheu no painel vale aqui", () => {
  it("toca o par no volume guardado, e não a 100%", () => {
    // The dock has no slider: the cards are in the panel. What it has to do is
    // obey what was chosen, which is exactly what plays the sound when the panel
    // leaves the screen, which is precisely when the complaint happened.
    const primeiro = render(painel())
    fireEvent.change(cursor(primeiro.container), { target: { value: "0.15" } })
    cleanup()

    const { container } = render(
      <CallDock
        channel="!geral:s"
        channelLabel="geral"
        participants={[participante("@ana:s")]}
        localStream={null}
        nameFor={(sender) => sender}
        onBack={() => {}}
        onLeave={() => {}}
      />,
    )

    const audios = [...container.querySelectorAll<HTMLVideoElement>(".call-dock-audio video")]
    expect(audios[1]?.volume).toBeCloseTo(0.15)
  })

  it("sem escolha nenhuma, toca toda a gente tal como vem", () => {
    const { container } = render(
      <CallDock
        channel="!geral:s"
        channelLabel="geral"
        participants={[participante("@ana:s")]}
        localStream={null}
        nameFor={(sender) => sender}
        onBack={() => {}}
        onLeave={() => {}}
      />,
    )

    const audios = [...container.querySelectorAll<HTMLVideoElement>(".call-dock-audio video")]
    expect(audios[1]?.volume).toBe(1)
  })
})

/**
 * Hear someone LOUDER than they arrive.
 *
 * General complaint on September 13, 2026: "the sound is too quiet". The slider
 * maxed out at 100%, which is the cap on a media element's `volume`, no way to
 * go past it. Whoever arrived quiet stayed quiet and that was it.
 *
 * Above 100% the sound stops going through the element and goes through WebAudio
 * instead, with a limiter at the end: amplify without it is trading "quiet" for
 * "loud and distorted", which was exactly the microphone flaw fixed that same day.
 * The element stays silent, but the stream stays connected, otherwise Chromium won't
 * deliver remote audio to the graph, and the result would be silence.
 *
 * Up to 100% none of this happens: the element does what it always did, and no
 * audio graph runs per person in an eight-person call.
 */
describe("ouvir alguém acima dos 100%", () => {
  it("o cursor vai até 200%", () => {
    const { container } = render(painel())

    expect(cursor(container).max).toBe("2")
  })

  it("até 100% é o elemento que manda, e não se abre grafo nenhum", () => {
    const audio = montarWebAudioFalso()
    try {
      const { container } = render(painelComVoz())
      fireEvent.change(cursor(container), { target: { value: "0.6" } })

      const audios = [...container.querySelectorAll<HTMLVideoElement>(".call-video video")]
      expect(audios[1]?.volume).toBeCloseTo(0.6)
      expect(ganhos).toHaveLength(0)
    } finally {
      audio.desmontar()
    }
  })

  it("acima de 100% o elemento cala-se e o ganho fica com o valor", () => {
    const audio = montarWebAudioFalso()
    try {
      const { container } = render(painelComVoz())
      fireEvent.change(cursor(container), { target: { value: "1.5" } })

      const audios = [...container.querySelectorAll<HTMLVideoElement>(".call-video video")]
      expect(audios[1]?.muted).toBe(true)
      expect(ganhos.at(-1)?.gain.value).toBeCloseTo(1.5)
    } finally {
      audio.desmontar()
    }
  })

  it("e o volume de saída multiplica o de cada pessoa", () => {
    // One slider per person doesn't help when EVERYONE sounds too quiet: you'd drag
    // one per person for each call.
    localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, outputVolume: 1.5 }))
    const audio = montarWebAudioFalso()
    try {
      render(painelComVoz())

      expect(ganhos.at(-1)?.gain.value).toBeCloseTo(1.5)
    } finally {
      audio.desmontar()
    }
  })
})

describe("o cursor diz de quem é", () => {
  it("o rótulo acessível nomeia a pessoa", () => {
    // Without this, whoever watches the screen finds several identical sliders and
    // none saying who they belong to.
    const { container } = render(painel())

    expect(container.querySelector(".chip-volume")?.getAttribute("title")).toBe(strings.call.volumeOf("@ana:s"))
  })
})
