import { describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach } from "vitest"
import { OrwellMark } from "../icons.js"
import { MARCA_CHEIA, MARCA_COMPACTA } from "../marca.gen.js"
import { OrwellWordmark } from "./Logo.js"
import { strings } from "../strings.js"

afterEach(cleanup)

describe("marca Orwell", () => {
  it("o mark rende aos dois tamanhos que importam: favicon e rail", () => {
    const { container } = render(
      <>
        <OrwellMark size={16} />
        <OrwellMark size={48} />
      </>,
    )
    const svgs = container.querySelectorAll("svg")
    expect(svgs).toHaveLength(2)
    expect(svgs[0]?.getAttribute("width")).toBe("16")
    expect(svgs[1]?.getAttribute("width")).toBe("48")
    // Full banners, never stroke: a banner is a banner because it has weight.
    expect(svgs[0]?.getAttribute("fill")).toBe("currentColor")
    expect(svgs[0]?.getAttribute("stroke")).toBeNull()
    // And the two optical variants: compact at 16, full at 48. If someone simplifies this
    // to one someday, that is where we know.
    expect(svgs[0]?.querySelectorAll("path").length).toBe(MARCA_COMPACTA.length)
    expect(svgs[1]?.querySelectorAll("path").length).toBe(MARCA_CHEIA.length)
    expect(MARCA_CHEIA.length).toBeGreaterThan(MARCA_COMPACTA.length)
  })

  it("o wordmark tem o nome acessível completo, com o O redigido como primeira letra", () => {
    render(<OrwellWordmark />)
    const mark = screen.getByRole("img", { name: "Orwell" })
    expect(mark.querySelector("svg")).toBeTruthy()
    expect(mark.textContent).toBe("rwell")
  })
})

describe("fronteira marca vs protocolo", () => {
  it("nenhum texto visível diz Enclave; o esquema técnico enclave:// pode ficar", () => {
    const offenders: string[] = []
    const walk = (value: unknown, path: string): void => {
      if (typeof value === "string") {
        if (value.includes("Enclave")) offenders.push(`${path}: ${value}`)
        return
      }
      if (typeof value === "function") {
        const sample = (value as (a: string, b?: number | null) => string)("amostra", 1)
        if (typeof sample === "string" && sample.includes("Enclave")) offenders.push(`${path}(): ${sample}`)
        return
      }
      if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`)
      }
    }
    walk(strings, "strings")
    expect(offenders).toEqual([])
  })
})
