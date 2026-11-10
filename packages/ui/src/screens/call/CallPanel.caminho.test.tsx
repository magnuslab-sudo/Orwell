import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { Participant } from "@enclave/client-core"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { PACIENCIA_MS } from "../../lib/estadoDaChamada.js"
import { strings } from "../../strings.js"
import { CallPanel } from "./CallPanel.js"

afterEach(cleanup)

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

function participant(address: string, connected = true): Participant {
  return { address, connected, stream: null } as Participant
}

const perfil = { displayName: "Eu", donations: [] } as unknown as Profile

function painel(overrides: Partial<React.ComponentProps<typeof CallPanel>> = {}): React.JSX.Element {
  return (
    <CallPanel
      call={{ setMuted: () => {}, setCameraOff: () => {} } as unknown as EnclaveBridge["call"]}
      channel="!geral:s"
      participants={[participant("@ana:s", false)]}
      localStream={null}
      selfLabel="Eu"
      selfProfile={perfil}
      nameFor={(sender) => (sender === "@ana:s" ? "Ana" : sender)}
      directory={new Map()}
      onToggleMic={() => {}}
      onToggleSound={() => {}}
      onLeave={() => {}}
      {...overrides}
    />
  )
}

/** What is written below each person's name, in order. */
const estados = (container: HTMLElement): string[] =>
  [...container.querySelectorAll<HTMLElement>(".call-chip-state")].map((cada) => cada.textContent ?? "")

/**
 * "Connecting…" for someone in the call for ten minutes.
 *
 * In an SFU call, someone's `connected` is `fluxos.has(address)`, written in
 * `#anunciarPorSfu`, in `call.ts`, that is, "I get media from them". Someone
 * on the roster with no stream is IN THE CALL: they are not connecting to
 * anything. The panel wrote "connecting…" below them, with no timeout and no
 * end, and the viewer could not tell "still on the way" from "this is broken".
 *
 * These tests mount the panel for real, with both halves: the text and the
 * timer. The decision logic itself is pure and has its own tests in
 * `lib/estadoDaChamada.test.ts`.
 */
describe("CallPanel — o que se diz de quem ainda não se ouve", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("numa chamada por SFU, quem não se ouve está na chamada e não a ligar-se", () => {
    const { container } = render(painel({ caminho: "sfu" }))
    expect(estados(container)).toContain(strings.call.naChamadaSemSom)
    expect(estados(container)).not.toContain(strings.call.connecting)
  })

  it('numa chamada de malha, "a ligar" continua a ser verdade', () => {
    const { container } = render(painel({ caminho: "malha" }))
    expect(estados(container)).toContain(strings.call.connecting)
  })

  it("passado o prazo, a frase muda: deixa de haver reticência", () => {
    const { container } = render(painel({ caminho: "sfu" }))
    expect(estados(container)).toContain(strings.call.naChamadaSemSom)

    act(() => {
      vi.advanceTimersByTime(PACIENCIA_MS + 1_000)
    })

    // This is the line that answers the question of someone looking. Before, the
    // text after ten minutes was the same as in the first second.
    expect(estados(container)).toContain(strings.call.semSomHaMuito)
    expect(estados(container)).not.toContain(strings.call.naChamadaSemSom)
  })

  it("e o cartão deixa de ser uma promessa tracejada", () => {
    const { container } = render(painel({ caminho: "sfu" }))
    expect(container.querySelector(".call-chip.tom-aEsperar")).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(PACIENCIA_MS + 1_000)
    })

    expect(container.querySelector(".call-chip.tom-parado")).toBeTruthy()
    expect(container.querySelector(".call-chip.tom-aEsperar")).toBeNull()
  })

  it("quem se ouve não conta prazo nenhum", () => {
    const { container } = render(painel({ caminho: "sfu", participants: [participant("@ana:s", true)] }))
    act(() => {
      vi.advanceTimersByTime(PACIENCIA_MS * 5)
    })
    expect(estados(container)).toContain(strings.call.connected)
    expect(container.querySelector(".call-chip.pending")).toBeNull()
  })

  it("quem entra tarde não herda a espera de quem já cá estava", () => {
    // The reason the count is PER PERSON and not the call's age. Reading the
    // `useElapsed` that was already there would have been easier and would have
    // drawn Rui broken the instant he appeared.
    const { container, rerender } = render(painel({ caminho: "sfu" }))
    act(() => {
      vi.advanceTimersByTime(PACIENCIA_MS + 1_000)
    })
    rerender(painel({ caminho: "sfu", participants: [participant("@ana:s", false), participant("@rui:s", false)] }))

    const escrito = estados(container)
    expect(escrito).toContain(strings.call.semSomHaMuito)
    expect(escrito).toContain(strings.call.naChamadaSemSom)
  })

  it("quem se liga depois de cair recomeça a contagem, e não volta partido", () => {
    const { container, rerender } = render(painel({ caminho: "sfu" }))
    act(() => {
      vi.advanceTimersByTime(PACIENCIA_MS + 1_000)
    })
    expect(estados(container)).toContain(strings.call.semSomHaMuito)

    // We hear it. And it drops again right after.
    rerender(painel({ caminho: "sfu", participants: [participant("@ana:s", true)] }))
    rerender(painel({ caminho: "sfu", participants: [participant("@ana:s", false)] }))

    expect(estados(container)).toContain(strings.call.naChamadaSemSom)
    expect(estados(container)).not.toContain(strings.call.semSomHaMuito)
  })
})

/**
 * The header count contradicted the list right below it.
 *
 * `people(connected + 1)` counts who has a STREAM. In an SFU call with five
 * people and two hearing each other, the header said "3 people" above five
 * cards, in the same card and at a glance's distance.
 */
describe("CallPanel — a contagem do cabeçalho conta quem está", () => {
  it("conta toda a gente do roster, e não só quem já se ouve", () => {
    const { container } = render(
      painel({
        caminho: "sfu",
        participants: [participant("@ana:s", true), participant("@rui:s", false), participant("@zeca:s", false)],
      }),
    )
    expect(container.querySelector(".call-meta")?.textContent).toContain(strings.call.people(4))
  })

  it("e o número bate certo com os cartões desenhados", () => {
    const { container } = render(
      painel({ caminho: "sfu", participants: [participant("@ana:s", false), participant("@rui:s", false)] }),
    )
    const cartoes = container.querySelectorAll(".call-person").length
    expect(container.querySelector(".call-meta")?.textContent).toContain(strings.call.people(cartoes))
  })
})

/**
 * Alerts that the core logged and the screen did not show.
 *
 * The panel does not decide which ones: it receives them already decided from
 * the shell, which reads them from `avisoDaChamada`. What we measure here is
 * that they reach the screen, that the warning is distinct from the note, and
 * that they can be dismissed.
 */
describe("CallPanel — o aviso da chamada", () => {
  it("sem aviso, não há faixa nenhuma: uma chamada normal não muda de forma", () => {
    const { container } = render(painel())
    expect(container.querySelector(".call-aviso")).toBeNull()
  })

  it("um aviso grave é lido, e é anunciado a quem ouve o ecrã", () => {
    const { container } = render(
      painel({ aviso: { code: "call-sfu-oferta-de-malha", texto: "não se vão ouvir", nivel: "grave" } }),
    )
    const faixa = container.querySelector(".call-aviso")
    expect(faixa?.textContent).toContain("não se vão ouvir")
    expect(faixa?.classList.contains("grave")).toBe(true)
    expect(faixa?.getAttribute("role")).toBe("status")
  })

  it("uma nota não se veste de avaria", () => {
    const { container } = render(
      painel({ aviso: { code: "call-presenca-caducou", texto: "Ana saiu da chamada.", nivel: "nota" } }),
    )
    expect(container.querySelector(".call-aviso")?.classList.contains("grave")).toBe(false)
  })

  it("dispensa-se, e quem manda é quem o guarda", () => {
    const onDispensarAviso = vi.fn()
    render(painel({ aviso: { code: "x", texto: "isto", nivel: "nota" }, onDispensarAviso }))
    fireEvent.click(screen.getByLabelText(strings.call.avisoFechar))
    expect(onDispensarAviso).toHaveBeenCalledTimes(1)
  })

  it("sem quem o dispense, não se desenha um botão que não faz nada", () => {
    const { container } = render(painel({ aviso: { code: "x", texto: "isto", nivel: "nota" } }))
    expect(container.querySelector(".call-aviso")).toBeTruthy()
    expect(container.querySelector(".call-aviso-fechar")).toBeNull()
  })
})
