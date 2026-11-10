import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import type { Participant } from "@enclave/client-core"
import { definirLingua, strings } from "../../strings.js"
import { CallDock } from "./CallDock.js"

afterEach(() => {
  cleanup()
  definirLingua("pt")
})

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

/**
 * The "Connected · voice room" card reads in full, in Portuguese and English.
 *
 * Owner report: on the bottom-left card "connected" did not read in full. The cause
 * was in the sheet: the state line was `display: flex` with `white-space: nowrap` and
 * `overflow: hidden`. Loose text in a flex is an anonymous item that does not shrink
 * below its width, ellipsis never appeared, and "Connected · voice room" was cut off
 * mid-word.
 *
 * jsdom does not measure text. Lock what you can: the whole text sits in its own
 * element, and no line rule cuts it again. Real measurement (text width against box
 * width) is in `scripts/retratar-midnight.mjs`.
 */
const ler = (relativo: string): string => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8")
const semComentarios = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "")
const pele = semComentarios(ler("../../styles/pele.css"))
/* The sidebar box moved to the control panel sheet (P1, October 28, 2026). The
   `Andante` mechanic stayed in `pele.css`. */
const painel = semComentarios(ler("../../styles/painel.css"))
const ecras = semComentarios(ler("../../styles/screens.css"))

/** All declarations of rules whose selector is exactly this. */
function regras(folha: string, selector: string): string {
  const escapado = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return [...folha.matchAll(new RegExp(`(?:^|\\})\\s*${escapado}\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[1]).join("\n")
}

function cartao(latencia: { ms: number; ate: "servidor" | "par" } | null = null): HTMLElement {
  const participante = { address: "@ana:s", connected: true, stream: null } as Participant
  render(
    <CallDock
      variante="lateral"
      comAudio={false}
      channel="!nexo:s"
      channelLabel="nexo"
      roomLabel="voz"
      latencia={latencia}
      participants={[participante]}
      localStream={null}
      nameFor={(quem) => quem}
      onBack={() => {}}
      onLeave={() => {}}
      onToggleMic={() => {}}
    />,
  )
  return document.querySelector<HTMLElement>(".call-dock.lateral")!
}

describe("CallDock lateral — o ping em cima, o sítio em baixo", () => {
  it.each(["pt", "en"] as const)("em %s, sem medida fica a palavra, e a contagem ao lado", (lingua) => {
    definirLingua(lingua)
    const doca = cartao()
    const texto = doca.querySelector(".call-dock-state .call-dock-texto")
    expect(texto?.textContent).toBe(strings.callDock.ligado)
    expect(texto?.textContent).toBe(lingua === "en" ? "Connected" : "Ligado")
    expect(doca.querySelector(".call-dock-state .call-dock-count")?.textContent).toBe(strings.call.people(2))
    // Owner request (October 27, 2026): the bottom line is only "Channel · Room".
    const baixo = doca.querySelector(".call-dock-where")
    expect(baixo?.textContent).toBe("nexo · voz")
    expect(baixo?.getAttribute("title")).toBe("nexo · voz")
  })

  it("com medida, o ping no lugar da palavra", () => {
    const doca = cartao({ ms: 42, ate: "par" })
    expect(doca.querySelector(".call-dock-texto")?.textContent).toBe(strings.callDock.ping(42))
    expect(doca.querySelector(".call-dock-texto")?.textContent).toBe("42 ms")
  })

  it("num DOM sem larguras a linha de baixo fica parada: uma cópia só, sem `andante`", () => {
    const baixo = cartao().querySelector(".call-dock-where")!
    expect(baixo.classList.contains("andante")).toBe(false)
    expect(baixo.querySelectorAll(".andante-fita > span")).toHaveLength(1)
  })

  it("a linha do estado não corta o texto; a de baixo é uma linha que anda", () => {
    const estado = [
      regras(ecras, ".call-dock-state"),
      regras(painel, ".call-dock.lateral .call-dock-state"),
      regras(painel, ".call-dock.lateral .call-dock-texto"),
    ]
    for (const linha of estado) expect(linha).not.toBe("")
    const junto = estado.join("\n")
    expect(junto).not.toMatch(/white-space:\s*nowrap/)
    expect(junto).not.toMatch(/overflow:\s*hidden/)
    expect(junto).not.toMatch(/text-overflow/)
    // The bottom line: just one, hidden when it overflows, and the ticker scrolls only with `.andante`.
    // The mechanic is `Andante`'s (components/Andante.tsx), shared by all lines that scroll.
    expect(cartao().querySelector(".call-dock-where")?.classList.contains("andante-caixa")).toBe(true)
    const baixo = regras(pele, ".andante-caixa")
    expect(baixo).toMatch(/white-space:\s*nowrap/)
    expect(baixo).toMatch(/overflow:\s*hidden/)
    expect(regras(pele, ".andante-caixa.andante .andante-fita")).toMatch(/animation:\s*call-dock-anda/)
    expect(pele).toMatch(/@keyframes call-dock-anda/)
    // On the panel (P1): a box with radius 12, no margin, inside the middle floor.
    const cartaoLateral = regras(painel, ".call-dock.lateral")
    expect(cartaoLateral).toMatch(/margin:\s*0/)
    expect(cartaoLateral).toMatch(/border-radius:\s*12px/)
  })

  it("um botão só, o de voltar: o microfone e o desligar estão na fila do painel (P1, 28 de Outubro)", () => {
    const doca = cartao()
    // Until P1, it was back and hang up (owner, October 27, 2026). Hang up moved
    // to the fifth button in the panel queue (`CartaoDaConta`); its rules are in
    // `styles/painel.test.ts`.
    expect(doca.querySelectorAll("button")).toHaveLength(1)
    expect(doca.querySelector("button")?.getAttribute("aria-label")).toBe(strings.callDock.back)
    expect(doca.querySelector("button[aria-pressed]")).toBeNull()
    expect(regras(painel, ".call-dock.lateral .call-dock-state")).not.toMatch(/text-shadow:/)
  })

  it('a contagem lê-se sozinha: o "·" que a separa do ping é desenho', () => {
    const doca = cartao({ ms: 12, ate: "servidor" })
    expect(doca.querySelector(".call-dock-separador")?.getAttribute("aria-hidden")).toBe("true")
    expect(doca.querySelector(".call-dock-count")?.textContent).toBe(strings.call.people(2))
  })
})
