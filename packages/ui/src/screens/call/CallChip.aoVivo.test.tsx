import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { strings } from "../../strings.js"
import { CallChip } from "./CallChip.js"

afterEach(cleanup)

/**
 * The card for screen sharing, "A with C" (chosen by the owner on November 2,
 * 2026, `Downloads/Orwell-overlays-ao-vivo/`).
 *
 * Always in view (A): the red "LIVE" badge with a pulsing dot, and next to it
 * the eye and the number of people watching. On hover, and always on touch
 * screens (C): the darkened preview and the "Watch the broadcast" button.
 * Clicking anywhere on the card opens the share full screen. The gesture moved
 * off a bar at the top of the panel.
 */
describe("o cartão de quem está ao vivo", () => {
  it('leva o selo "AO VIVO" com o ponto, e o olho com o número de quem vê', () => {
    const { container } = render(<CallChip label="Kaori" profile={undefined} texto="ligada" aoVivo={{ aVer: 3, onVer: () => {} }} />)
    const selo = container.querySelector(".ao-vivo-selo")
    expect(selo?.textContent).toContain(strings.call.aoVivo)
    expect(selo?.querySelector(".ao-vivo-ponto")).toBeTruthy()
    const aVer = screen.getByRole("img", { name: strings.call.screenViewers(3) })
    expect(aVer.textContent).toBe("3")
    expect(container.querySelector(".call-chip")?.classList.contains("ao-vivo")).toBe(true)
  })

  it("sem saber quantos vêem, não inventa um número", () => {
    const { container } = render(<CallChip label="Kaori" profile={undefined} texto="ligada" aoVivo={{ aVer: null, onVer: () => {} }} />)
    expect(container.querySelector(".ao-vivo-a-ver")).toBeNull()
    expect(container.querySelector(".ao-vivo-selo")).toBeTruthy()
  })

  it('o botão "Ver a transmissão" abre a partilha, e é a porta do teclado', () => {
    let vezes = 0
    render(<CallChip label="Kaori" profile={undefined} texto="ligada" aoVivo={{ aVer: 1, onVer: () => vezes++ }} />)
    const botao = screen.getByRole("button", { name: strings.call.verATransmissaoDe("Kaori") })
    expect(botao.textContent).toContain(strings.call.verATransmissao)
    fireEvent.click(botao)
    expect(vezes).toBe(1)
  })

  it("clicar em qualquer sítio do cartão abre a partilha", () => {
    let vezes = 0
    const { container } = render(<CallChip label="Kaori" profile={undefined} texto="ligada" aoVivo={{ aVer: 1, onVer: () => vezes++ }} />)
    fireEvent.click(container.querySelector(".call-chip-name") as HTMLElement)
    fireEvent.click(container.querySelector(".call-chip") as HTMLElement)
    expect(vezes).toBe(2)
  })

  it('mas os controlos do cartão continuam a ser deles: o volume e o "⋯" não abrem a partilha', () => {
    let vezes = 0
    let menus = 0
    const { container } = render(
      <CallChip
        label="Kaori"
        profile={undefined}
        texto="ligada"
        volume={1}
        onVolume={() => {}}
        onMenu={() => menus++}
        aoVivo={{ aVer: 1, onVer: () => vezes++ }}
      />,
    )
    fireEvent.click(container.querySelector(".chip-volume input") as HTMLElement)
    fireEvent.click(screen.getByRole("button", { name: strings.call.personMenu("Kaori") }))
    expect(vezes).toBe(0)
    expect(menus).toBe(1)
  })

  it("o nosso cartão, ou um ecrã que já se está a ver, leva o selo e não o convite", () => {
    const { container } = render(<CallChip label="Eu" profile={undefined} texto="tu" proprio aoVivo={{ aVer: 0 }} />)
    expect(container.querySelector(".ao-vivo-selo")).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.call.verATransmissaoDe("Eu") })).toBeNull()
    expect(container.querySelector(".call-chip")?.classList.contains("ao-vivo-convida")).toBe(false)
    // Say zero: streaming to no one is what matters to know.
    expect(screen.getByRole("img", { name: strings.call.screenViewers(0) }).textContent).toBe("0")
  })

  it("sem partilha, nada disto", () => {
    const { container } = render(<CallChip label="Kaori" profile={undefined} texto="ligada" />)
    expect(container.querySelector(".ao-vivo-selo")).toBeNull()
    expect(container.querySelector(".ao-vivo-convite")).toBeNull()
  })
})

describe("o ponto do selo com movimento reduzido", () => {
  /*
   * Owner rule: the dot keeps pulsing with reduced motion, slower. The universal
   * rule in `base.css` zeros the duration of all animations with `!important`;
   * without an exception in the same place, the dot would stay still. It is the
   * same trap the elbow and the bell already had.
   */
  const AQUI = dirname(fileURLToPath(import.meta.url))
  const base = readFileSync(join(AQUI, "../../styles/base.css"), "utf8")
  const bloco = base.slice(base.indexOf("@media (prefers-reduced-motion: reduce)"))

  it("tem uma excepção na regra universal, mais lenta, e a repetir para sempre", () => {
    const regra = /\.ao-vivo-ponto\s*\{([^}]*)\}/.exec(bloco)?.[1] ?? ""
    expect(regra).toMatch(/animation-iteration-count:\s*infinite\s*!important/)
    const duracao = /animation-duration:\s*([\d.]+)s\s*!important/.exec(regra)?.[1]
    expect(Number(duracao)).toBeGreaterThan(1.6)
  })
})
