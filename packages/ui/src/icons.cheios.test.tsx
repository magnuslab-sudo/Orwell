/**
 * The call icons are filled (owner, October 28, 2026), and the "disconnected"
 * bar cuts a path in the filled form instead of getting lost in it.
 */
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { CameraIcon, HangUpIcon, HeadphonesIcon, MicIcon } from "./icons.js"

afterEach(cleanup)

describe("ícones da chamada, cheios", () => {
  it("o microfone, os auscultadores, a câmara e o desligar têm forma cheia", () => {
    for (const icone of [<MicIcon key="m" />, <HeadphonesIcon key="h" />, <CameraIcon key="c" />, <HangUpIcon key="d" />]) {
      const { container, unmount } = render(icone)
      expect(container.querySelector('[fill="currentColor"]'), String(icone.key)).toBeTruthy()
      unmount()
    }
  })

  it("desligado: a forma é recortada por uma máscara ao longo do risco, e o risco fica por cima", () => {
    for (const icone of [<MicIcon key="m" off />, <HeadphonesIcon key="h" off />, <CameraIcon key="c" off />]) {
      const { container, unmount } = render(icone)
      const mascara = container.querySelector("mask")
      expect(mascara, String(icone.key)).toBeTruthy()
      const grupo = container.querySelector("g[mask]")
      expect(grupo?.getAttribute("mask")).toBe(`url(#${mascara?.id})`)
      expect(grupo?.querySelector('[fill="currentColor"]')).toBeTruthy()
      // The visible bar is the last drawing, outside the clipped group.
      const ultimo = container.querySelector("svg")?.lastElementChild
      expect(ultimo?.tagName).toBe("path")
      expect(ultimo?.getAttribute("stroke")).toBe("currentColor")
      unmount()
    }
  })

  it("ligado: sem máscara nem risco", () => {
    const { container } = render(<MicIcon />)
    expect(container.querySelector("mask")).toBeNull()
  })

  it("dois ícones riscados na mesma página não partilham a máscara", () => {
    const { container } = render(
      <>
        <MicIcon off />
        <HeadphonesIcon off />
      </>,
    )
    const ids = [...container.querySelectorAll("mask")].map((m) => m.id)
    expect(new Set(ids).size).toBe(2)
  })
})
