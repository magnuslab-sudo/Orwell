import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { Participant } from "@enclave/client-core"
import type { EnclaveBridge, Profile } from "../bridge.js"
import { VOLUMES_KEY } from "../hooks/useVolumes.js"
import { en } from "../linguas/en.js"
import { pt } from "../linguas/pt.js"
import { CallPanel } from "../screens/call/CallPanel.js"
import { MemberPanel } from "../screens/chat/MemberPanel.js"
import { MarcaDeChamada, MarcaDeTransmissao, transmissaoDe, type TipoDeMarca } from "./MarcaDeChamada.js"

afterEach(cleanup)
beforeEach(() => localStorage.clear())

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

const TIPOS: readonly TipoDeMarca[] = ["calado", "silenciado", "ecra", "musica"]

/** The drawing without what changes from instance to instance (the mask id). */
function desenhoDe(tipo: TipoDeMarca): string {
  const { container, unmount } = render(<MarcaDeChamada tipo={tipo} nome="Ana" className="x" />)
  const svg = container.querySelector("svg")?.innerHTML.replace(/marca-[a-zA-Z0-9]+/g, "marca") ?? ""
  unmount()
  return svg
}

/**
 * The person marks in a call.
 *
 * What we store here is why they exist in pairs: "muted" and "I silenced them" are
 * two opposite facts that lived behind the same drawing. If they go back to sharing
 * the label OR the drawing, the bug is back, and neither of them will see themselves
 * reading the code.
 */
describe("marca de chamada: nenhuma sem nome", () => {
  it("cada tipo é um `img` com rótulo, o rótulo diz de quem se fala, e o `title` repete-o", () => {
    for (const tipo of TIPOS) {
      const { container, unmount } = render(<MarcaDeChamada tipo={tipo} nome="Ana Bivar" className="x" />)
      const marca = container.querySelector('[role="img"]')
      const rotulo = marca?.getAttribute("aria-label") ?? ""
      expect(rotulo.length, tipo).toBeGreaterThan(10)
      expect(rotulo).toContain("Ana Bivar")
      expect(rotulo).not.toMatch(/undefined|NaN|—/)
      expect(marca?.getAttribute("title")).toBe(rotulo)
      expect(marca?.getAttribute("data-marca")).toBe(tipo)
      // The speaker is the `<span>`; the drawing stays silent.
      expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
      unmount()
    }
  })

  it("os rótulos são frases diferentes, uma por tipo", () => {
    const rotulos = TIPOS.map((tipo) => {
      const { container, unmount } = render(<MarcaDeChamada tipo={tipo} nome="Ana" className="x" />)
      const rotulo = container.querySelector('[role="img"]')?.getAttribute("aria-label")
      unmount()
      return rotulo
    })
    expect(new Set(rotulos).size).toBe(TIPOS.length)
  })
})

describe("marca de chamada: calado por ela não é silenciado por nós", () => {
  it("nunca partilham o rótulo, em nenhuma das duas línguas", () => {
    // `en` is partial and falls to Portuguese silently: it reads directly.
    for (const [nome, chamada] of [["pt", pt.call], ["en", en.call]] as const) {
      const { micOffOf, silencedByYouOf } = chamada ?? {}
      if (!micOffOf || !silencedByYouOf) throw new Error(`falta uma das duas frases em ${nome}`)
      expect(micOffOf("Ana")).not.toBe(silencedByYouOf("Ana"))
      expect(silencedByYouOf("Ana")).toContain("Ana")
      expect(silencedByYouOf("Ana")).not.toMatch(/undefined|—/)
    }
    expect(en.call?.silencedByYouOf?.("Ana")).not.toBe(pt.call.silencedByYouOf("Ana"))
  })

  it("quem diz de quem é o gesto: o calado fala DELA, o silenciado fala de NÓS", () => {
    expect(pt.call.micOffOf("Ana")).toMatch(/^Ana /)
    expect(pt.call.silencedByYouOf("Ana")).toMatch(/^Silenciaste /)
    expect(en.call?.silencedByYouOf?.("Ana")).toMatch(/^You /)
  })

  it("nunca partilham o desenho", () => {
    expect(desenhoDe("calado")).not.toBe(desenhoDe("silenciado"))
    expect(desenhoDe("calado")).not.toBe(desenhoDe("ecra"))
    expect(desenhoDe("silenciado")).not.toBe(desenhoDe("ecra"))
  })

  it("e a diferença é de FORMA: um é atravessado por um risco, o outro não tem risco nenhum", () => {
    // The microphone line opens with a mask. If the speaker got one too, it would be
    // two glyphs again cut by the same diagonal, which at 15 px is the same smudge.
    const calado = render(<MarcaDeChamada tipo="calado" nome="Ana" className="x" />)
    expect(calado.container.querySelector("mask")).toBeTruthy()
    calado.unmount()
    const silenciado = render(<MarcaDeChamada tipo="silenciado" nome="Ana" className="x" />)
    expect(silenciado.container.querySelector("mask")).toBeNull()
    expect(silenciado.container.querySelectorAll("path")).toHaveLength(2)
  })

  it("duas marcas no mesmo ecrã não partilham a máscara, e o traço é o da casa (1,7)", () => {
    const { container } = render(
      <>
        <MarcaDeChamada tipo="calado" nome="Ana" className="x" />
        <MarcaDeChamada tipo="calado" nome="Rui" className="x" />
        <MarcaDeChamada tipo="ecra" nome="Rui" className="x" />
      </>,
    )
    const ids = [...container.querySelectorAll("mask")].map((mascara) => mascara.id)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
    for (const id of ids) expect(id).toMatch(/^[a-zA-Z][a-zA-Z0-9-]*$/)
    // Full on the home grid (owner's choice, October 28, 2026): what is stroke
    // outside the mask is the 1.7 line of the rail icons.
    const tracos = [...container.querySelectorAll("path")].filter((p) => !p.closest("mask") && p.getAttribute("stroke") === "currentColor")
    expect(tracos.length).toBeGreaterThan(0)
    for (const traco of tracos) expect(traco.getAttribute("stroke-width")).toBe("1.7")
  })
})

describe("silenciado por nós: aparece onde o calado aparece", () => {
  const perfil = { displayName: "Eu", donations: [] } as unknown as Profile
  const pessoa = (address: string, micMuted = false): Participant =>
    ({ address, connected: true, stream: null, micMuted }) as Participant
  const silenciar = (...quem: string[]): void =>
    localStorage.setItem(VOLUMES_KEY, JSON.stringify(quem.map((endereco) => [endereco, 0])))

  function painel(participants: Participant[]): React.JSX.Element {
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
        onToggleMic={() => {}}
        onToggleSound={() => {}}
        onLeave={() => {}}
      />
    )
  }

  it("no cartão da chamada: só quem NÓS silenciámos, e com a frase que o diz", () => {
    silenciar("@rui:s")
    const { container } = render(painel([pessoa("@ana:s"), pessoa("@rui:s")]))
    const marcas = container.querySelectorAll('.call-people [data-marca="silenciado"]')
    expect(marcas).toHaveLength(1)
    expect(marcas[0]?.getAttribute("aria-label")).toBe("Silenciaste @rui:s: tens o volume desta pessoa a zero")
    expect(container.querySelector('.call-people [data-marca="calado"]')).toBeNull()
  })

  it("os dois silêncios coexistem na mesma pessoa, com duas marcas e dois nomes", () => {
    silenciar("@ana:s")
    const { container } = render(painel([pessoa("@ana:s", true)]))
    const cartao = container.querySelector(".call-people .call-person:last-child")
    const marcas = [...(cartao?.querySelectorAll("[data-marca]") ?? [])]
    expect(marcas.map((marca) => marca.getAttribute("data-marca"))).toEqual(["calado", "silenciado"])
    expect(new Set(marcas.map((marca) => marca.getAttribute("aria-label"))).size).toBe(2)
  })

  it("no mosaico de vídeo também", () => {
    silenciar("@ana:s")
    const { container } = render(painel([pessoa("@ana:s")]))
    expect(container.querySelector('.tile-label [data-marca="silenciado"]')).toBeTruthy()
  })

  it("volume baixo não é silêncio: só o zero leva marca", () => {
    localStorage.setItem(VOLUMES_KEY, JSON.stringify([["@ana:s", 0.1]]))
    const { container } = render(painel([pessoa("@ana:s")]))
    expect(container.querySelector('[data-marca="silenciado"]')).toBeNull()
  })

  it("na lista de membros, ao lado do nome", () => {
    silenciar("@rui:s")
    render(
      <MemberPanel
        {...({
          members: ["@ana:s", "@rui:s"],
          state: "ready",
          directory: new Map(),
          nameFor: (quem: string) => quem,
          onClose: () => {},
        } as unknown as React.ComponentProps<typeof MemberPanel>)}
      />,
    )
    expect(screen.getAllByRole("img", { name: /^Silenciaste @rui:s/ })).toHaveLength(1)
    expect(screen.queryByRole("img", { name: /^Silenciaste @ana:s/ })).toBeNull()
  })
})

/**
 * The broadcast signal for voice rooms (owner request October 27, 2026, 23:55):
 * screen, music, or both, with a phrase for each fact.
 */
describe("marca de transmissão", () => {
  it("a música é um desenho próprio: duas bolas cheias e as hastes a traço da casa", () => {
    const { container } = render(<MarcaDeChamada tipo="musica" nome="Ana" className="x" />)
    expect(container.querySelectorAll("circle")).toHaveLength(2)
    for (const bola of container.querySelectorAll("circle")) expect(bola.getAttribute("fill")).toBe("currentColor")
    expect(container.querySelector("path")?.getAttribute("stroke-width")).toBe("1.7")
    expect(container.querySelector("path")?.getAttribute("stroke-linecap")).toBe("round")
    expect(desenhoDe("musica")).not.toBe(desenhoDe("ecra"))
  })

  it("o `title` diz o que se transmite, e com as duas coisas há dois glifos e uma frase", () => {
    const casos = [
      ["ecra", pt.transmissao.ecra, 1],
      ["musica", pt.transmissao.musica, 1],
      ["ecra+musica", pt.transmissao.ambos, 2],
    ] as const
    for (const [transmite, frase, glifos] of casos) {
      const { container, unmount } = render(<MarcaDeTransmissao transmite={transmite} />)
      const marca = screen.getByRole("img", { name: frase })
      expect(marca.getAttribute("title")).toBe(frase)
      expect(container.querySelectorAll("svg")).toHaveLength(glifos)
      unmount()
    }
    expect(pt.transmissao.ambos).toBe("A partilhar ecrã e música")
    expect(en.transmissao?.ambos).toBe("Sharing screen and music")
  })

  it("lê-se do participante: o ecrã oferecido e a música a tocar", () => {
    expect(transmissaoDe({ ecraOferecido: false })).toBeUndefined()
    expect(transmissaoDe({ ecraOferecido: true })).toBe("ecra")
    expect(transmissaoDe({ aTocar: "Faixa" })).toBe("musica")
    expect(transmissaoDe({ ecraOferecido: true, aTocar: "Faixa" })).toBe("ecra+musica")
    expect(transmissaoDe({ aTocar: null, musica: null })).toBeUndefined()
  })
})
