import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import type { Profile } from "../../bridge.js"
import { CallChip } from "./CallChip.js"

afterEach(cleanup)

/**
 * The presence ring on call cards (point 6 of the rings report).
 *
 * In a call everyone is in a call: the ring pulses always, in the color of the
 * state. The halo and voice ring keep saying who speaks. The geometry (the
 * pulse ends before the voice ring) is measured in `scripts/medir-aneis-de-presenca.mjs`.
 */
const perfil = { displayName: "Ana" } as unknown as Profile
/* The path in a variable, as in `CallChip.halo.test.tsx`: with a literal, Vite
   rewrites `new URL(…, import.meta.url)` as a resource, not a file. */
const ler = (relativo: string): string => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8")
const componentes = ler("../../styles/components.css").replace(/\/\*[\s\S]*?\*\//g, "")

function anel(props: Partial<React.ComponentProps<typeof CallChip>> = {}): HTMLElement {
  render(<CallChip label="Ana" profile={perfil} texto="ligada" {...props} />)
  return document.querySelector<HTMLElement>(".call-chip [data-anel]")!
}

describe("CallChip — o anel de presença", () => {
  it("pulsa sempre, e sem estado de fora pinta a ligação", () => {
    const ligada = anel()
    expect(ligada.dataset["anel"]).toBe("online")
    expect(ligada.hasAttribute("data-em-chamada")).toBe(true)
    cleanup()

    expect(anel({ tom: "aEsperar" }).dataset["anel"]).toBe("offline")
  })

  it("com o estado de fora, a cor dele: quem está ocupado fica vermelho", () => {
    expect(anel({ presence: "busy" }).dataset["anel"]).toBe("ocupado")
  })

  it("as regras que tiravam o anel aos cartões saíram", () => {
    expect(componentes).not.toMatch(/\.call-chip \[data-anel\]\s*\{[^}]*box-shadow:\s*none/)
    expect(componentes).not.toMatch(/\.call-chip \[data-anel\] > \.presence-dot/)
  })

  it("o pulso no cartão cresce menos, para não passar por cima do anel de voz", () => {
    expect(componentes).toMatch(/\.call-chip \[data-anel\]\[data-em-chamada\]::after\s*\{\s*animation-name:\s*anel-pulsa-no-cartao/)
    const fim = /@keyframes anel-pulsa-no-cartao\s*\{[\s\S]*?100%\s*\{([^}]*)\}/.exec(componentes)?.[1] ?? ""
    expect(fim).toMatch(/transform:\s*scale\(1\.1\)/)
    expect(fim).toMatch(/opacity:\s*0/)
  })
})
