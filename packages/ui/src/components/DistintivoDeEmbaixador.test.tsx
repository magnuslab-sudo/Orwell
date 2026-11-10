import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import type { Profile } from "../bridge.js"
import { MemberPanel } from "../screens/chat/MemberPanel.js"
import { strings } from "../strings.js"
import { DistintivoDeEmbaixador } from "./DistintivoDeEmbaixador.js"

/*
  The published list is empty, so no one gets the badge. To prove
  it appears to those in it, the list changes HERE and only here: the
  `ehEmbaixador` true, with a list of one name.
*/
const ANA = "@ana-7f3a:orwell.pt"
const RUI = "@rui-1b2c:orwell.pt"
vi.mock("../lib/embaixadores.js", async (original) => {
  const verdadeiro = await original<typeof import("../lib/embaixadores.js")>()
  return {
    ...verdadeiro,
    ehEmbaixador: (address: string | null | undefined) => verdadeiro.ehEmbaixador(address, new Set([ANA])),
  }
})

afterEach(cleanup)

describe("o distintivo de embaixador", () => {
  it("aparece a quem está na lista, com o nome por palavras", () => {
    render(<DistintivoDeEmbaixador address={ANA} />)
    const distintivo = screen.getByRole("img", { name: strings.embaixador.selo })
    expect(distintivo.getAttribute("title")).toBe("Embaixador do Orwell")
  })

  it("não aparece a quem não está, nem sem endereço", () => {
    const { container } = render(
      <>
        <DistintivoDeEmbaixador address={RUI} />
        <DistintivoDeEmbaixador address={null} />
      </>,
    )
    expect(container.innerHTML).toBe("")
  })

  it("o desenho não fala duas vezes: quem anuncia é o `<span>`", () => {
    const { container } = render(<DistintivoDeEmbaixador address={ANA} />)
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
  })

  it("no painel de membros, fica ao lado do nome do embaixador e de mais ninguém", () => {
    const noop = (): void => {}
    render(
      <MemberPanel
        channel="!geral:orwell.pt"
        members={[ANA, RUI]}
        state="ready"
        onRetry={noop}
        me={null}
        directory={new Map<string, Profile>()}
        nameFor={(sender) => (sender === ANA ? "Ana" : "Rui")}
        onInvite={noop}
        onUserMenu={noop}
        onOpenProfile={noop}
      />,
    )
    const nomes = [...document.querySelectorAll<HTMLElement>(".member-name")]
    const daAna = nomes.find((nome) => nome.textContent?.startsWith("Ana"))
    const doRui = nomes.find((nome) => nome.textContent?.startsWith("Rui"))
    expect(daAna && within(daAna).getByRole("img", { name: strings.embaixador.selo })).toBeTruthy()
    expect(doRui && within(doRui).queryByRole("img", { name: strings.embaixador.selo })).toBeNull()
    expect(screen.getAllByRole("img", { name: strings.embaixador.selo })).toHaveLength(1)
  })
})
