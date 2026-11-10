import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import type { Participant } from "@enclave/client-core"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { strings } from "../../strings.js"
import { CallPanel } from "./CallPanel.js"

/**
 * On entering a voice room, the faces that the sidebar already showed land in
 * the panel in a "connecting" state, until the connection to each one arrives.
 * Owner request on October 27, 2026: before, the room looked empty while joining.
 */

afterEach(cleanup)
vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

const perfil = { displayName: "Eu", donations: [] } as unknown as Profile

function painel(participants: Participant[], aLigar: string[]): React.JSX.Element {
  return (
    <CallPanel
      call={{ setMuted: () => {}, setCameraOff: () => {} } as unknown as EnclaveBridge["call"]}
      channel="!geral:s"
      participants={participants}
      localStream={null}
      selfLabel="Eu"
      selfProfile={perfil}
      nameFor={(sender) => sender}
      directory={new Map()}
      onLeave={() => {}}
      aLigar={aLigar}
    />
  )
}

const cartoes = (container: HTMLElement): HTMLElement[] => [...container.querySelectorAll<HTMLElement>(".call-chip")]

describe('CallPanel — cartões "a ligar"', () => {
  it("mostra quem está na sala pela presença, esbatido, antes de haver ligação", () => {
    const { container } = render(painel([], ["@ana:s", "@rui:s"]))
    const todos = cartoes(container)
    // Ours, and the two announced.
    expect(todos).toHaveLength(3)
    const aLigar = todos.filter((cartao) => cartao.classList.contains("a-ligar"))
    expect(aLigar.map((cartao) => cartao.querySelector(".call-chip-name")?.textContent)).toEqual(["@ana:s", "@rui:s"])
    for (const cartao of aLigar) {
      expect(cartao.querySelector(".call-chip-state")?.textContent).toBe(strings.call.connecting)
      // Without a connection, there is no volume to move.
      expect(cartao.querySelector("input[type=range]")).toBeNull()
    }
  })

  it("quem já tem ligação aparece uma vez só, com o cartão de sempre", () => {
    const ana = { address: "@ana:s", connected: true, stream: null } as Participant
    const { container } = render(painel([ana], ["@ana:s", "@rui:s"]))
    const nomes = cartoes(container).map((cartao) => cartao.querySelector(".call-chip-name")?.textContent)
    expect(nomes.filter((nome) => nome === "@ana:s")).toHaveLength(1)
    const daAna = cartoes(container).find((cartao) => cartao.textContent?.includes("@ana:s"))
    expect(daAna?.classList.contains("a-ligar")).toBe(false)
    const doRui = cartoes(container).find((cartao) => cartao.textContent?.includes("@rui:s"))
    expect(doRui?.classList.contains("a-ligar")).toBe(true)
  })

  it("sem anunciados, nada muda", () => {
    const { container } = render(painel([], []))
    expect(cartoes(container)).toHaveLength(1)
    expect(container.querySelector(".a-ligar")).toBeNull()
  })
})
