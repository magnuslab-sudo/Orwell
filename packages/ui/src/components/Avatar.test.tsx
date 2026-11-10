import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { Avatar, atributosDoAnel, estadoDoAnel } from "./Avatar.js"

afterEach(cleanup)

/**
 * The letter inside the circle.
 *
 * Zé showed up with a "D" in a screenshot going to the homepage: six of the eight
 * places that draw avatars passed `endereco[1]`, the first letter of the
 * address, even though they had the profile. It is the same family as addresses in place of
 * names, hidden in a single letter.
 *
 * The test bites: without preferring the name, the first case returns "D".
 */
describe("Avatar", () => {
  it("mostra a inicial do NOME quando há perfil, e não a do endereço", () => {
    render(<Avatar profile={{ displayName: "Zé", donations: [] }} fallback="d" />)

    expect(screen.getByText("Z")).toBeTruthy()
  })

  it("sem nome, cai no que o chamador der", () => {
    render(<Avatar profile={undefined} fallback="d" />)

    expect(screen.getByText("D")).toBeTruthy()
  })

  it("um nome só de espaços não conta como nome", () => {
    // `"   "[0]` is a space, and a space inside a circle is an empty circle:
    // worse than the address letter, which at least identifies someone.
    render(<Avatar profile={{ displayName: "   ", donations: [] }} fallback="d" />)

    expect(screen.getByText("D")).toBeTruthy()
  })
})

/**
 * The presence ring (requested by the owner, October 27, 2026): color by
 * state, and pulsing only during a call. jsdom does not paint, so we measure what
 * CSS reads: `data-anel` and `data-em-chamada`. The color for each state and the
 * animation are in `scripts/medir-aneis-de-presenca.mjs`.
 */
describe("Avatar — o anel de presença", () => {
  const anel = (container: HTMLElement): HTMLElement => container.querySelector("[data-anel]") as HTMLElement

  it.each([
    ["active", "online"],
    ["away", "ausente"],
    ["busy", "ocupado"],
    ["idle", "offline"],
  ] as const)("presença %s pinta o anel %s", (presence, estado) => {
    const { container } = render(<Avatar profile={undefined} fallback="d" presence={presence} />)

    expect(anel(container).dataset["anel"]).toBe(estado)
  })

  it('sem presença conhecida não há anel nem ponto: o cinzento diria "offline"', () => {
    const { container } = render(<Avatar profile={undefined} fallback="d" emChamada />)

    expect(container.querySelector("[data-anel]")).toBeNull()
    expect(container.querySelector(".avatar-wrap")).not.toBeNull()
    // No state, no dot to tell the screen reader "offline": we do not know.
    expect(container.querySelector(".presence-dot")).toBeNull()
  })

  it("quem sabe que a pessoa está desligada passa `idle`, e o anel é cinzento", () => {
    const { container } = render(<Avatar profile={undefined} fallback="d" presence="idle" />)

    expect(anel(container).dataset["anel"]).toBe("offline")
  })

  it("só pulsa em chamada", () => {
    const parado = render(<Avatar profile={undefined} fallback="d" presence="active" />)
    expect(anel(parado.container).hasAttribute("data-em-chamada")).toBe(false)
    parado.unmount()

    const emChamada = render(<Avatar profile={undefined} fallback="d" presence="active" emChamada />)
    expect(anel(emChamada.container).hasAttribute("data-em-chamada")).toBe(true)
  })

  it("o ponto continua a dizer o estado por palavras, o ausente incluído", () => {
    render(<Avatar profile={undefined} fallback="d" presence="away" />)

    expect(screen.getByRole("img", { name: "ausente" })).toBeTruthy()
  })

  it("o embrulho continua a chamar-se só `avatar-wrap`: o anel são atributos", () => {
    const { container } = render(<Avatar profile={undefined} fallback="d" presence="busy" emChamada />)

    expect(anel(container).getAttribute("class")).toBe("avatar-wrap")
    expect(atributosDoAnel("ocupado", false)).toEqual({ "data-anel": "ocupado" })
    expect(atributosDoAnel("ocupado", true)).toEqual({ "data-anel": "ocupado", "data-em-chamada": "" })
    expect(estadoDoAnel(undefined)).toBe("offline")
  })
})
