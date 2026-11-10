import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import type { Profile } from "../../bridge.js"
import { CallChip } from "./CallChip.js"

afterEach(cleanup)

// jsdom has no media: the camera image just needs `play()` not to crash.
vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

/**
 * The halo around the avatar (board A3, "Halo", chosen by the owner on October
 * 21, 2026).
 *
 * Pin down the drawing by state (muted, speaking, mic off, camera on) and the
 * cost rule: the halo is one layer painted once, and per frame only its
 * `opacity` and `transform` change. A shadow whose radius read the voice was
 * repainted each change, for each person in the call.
 */
const ler = (relativo: string): string => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8")
const ecras = ler("../../styles/screens.css").replace(/\/\*[\s\S]*?\*\//g, "")

/** The declarations of rules whose selector is exactly this one. */
function regra(selector: string): string {
  const escapado = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return [...ecras.matchAll(new RegExp(`(?:^|\\})\\s*${escapado}\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[1]).join("\n")
}

const perfil = { displayName: "Ana" } as unknown as Profile

function chip(props: Partial<React.ComponentProps<typeof CallChip>> = {}): HTMLElement {
  render(<CallChip label="Ana" profile={perfil} texto="ligada" {...props} />)
  return document.querySelector<HTMLElement>(".call-chip")!
}

describe("CallChip — o halo e o anel, por estado", () => {
  it("calada ou a falar: um halo, o anel de repouso e o anel verde por cima", () => {
    const cartao = chip()
    expect(cartao.querySelectorAll(".halo-de-voz")).toHaveLength(1)
    expect(cartao.querySelectorAll(".anel-de-voz.repouso circle")).toHaveLength(1)
    expect(cartao.querySelectorAll(".anel-de-voz.fala circle")).toHaveLength(1)
    expect(cartao.classList.contains("mic-calado")).toBe(false)
    // No arc: the earlier dB ring is gone.
    expect(cartao.querySelector(".anel-nivel, .anel-pico, [pathLength]")).toBeNull()
  })

  it("o avatar e o ponto de presença vêm depois, e ficam por cima", () => {
    const rosto = chip().querySelector(".call-chip-rosto")!
    const ordem = [...rosto.children].map((filho) => filho.getAttribute("class"))
    expect(ordem.indexOf("halo-de-voz")).toBeLessThan(ordem.indexOf("avatar-wrap"))
    expect(ordem.indexOf("anel-de-voz fala")).toBeLessThan(ordem.indexOf("avatar-wrap"))
    expect(rosto.querySelector(".avatar-wrap .presence-dot")).not.toBeNull()
  })

  it("microfone desligado: o cartão leva `mic-calado`, que risca o anel e apaga o halo", () => {
    expect(chip({ micCalado: true }).classList.contains("mic-calado")).toBe(true)
    expect(regra(".call-chip.mic-calado .anel-de-voz.repouso circle")).toMatch(/stroke-dasharray:\s*3 5/)
    expect(regra(".call-chip.mic-calado .anel-de-voz.fala,\n.call-chip.mic-calado .halo-de-voz")).toMatch(
      /display:\s*none/,
    )
  })

  it("com câmara não há halo nem anel: a imagem enche o cartão", () => {
    const camara = { getVideoTracks: () => [{}], getAudioTracks: () => [] } as unknown as MediaStream
    const cartao = chip({ camara })
    expect(cartao.querySelector(".halo-de-voz, .anel-de-voz")).toBeNull()
  })
})

describe("CallChip — o custo do halo por quadro", () => {
  const halo = regra(".halo-de-voz")

  it("só `opacity` e `transform` lêem a voz", () => {
    expect(halo).toMatch(/opacity:\s*var\(--voz, 0\)/)
    expect(halo).toMatch(/transform:\s*scale\(calc\([^)]*var\(--voz, 0\)/)
    expect(halo).toMatch(/will-change:\s*opacity, transform/)
    for (const linha of halo.split(";")) {
      if (/--voz/.test(linha)) expect(linha).toMatch(/^\s*(opacity|transform):/)
    }
  })

  it("a sombra é fixa: não lê a voz em nenhum dos três tamanhos", () => {
    for (const seletor of [".halo-de-voz", ".call-faixa .halo-de-voz", ".call-corpo.com-foco .halo-de-voz"]) {
      const sombra = /box-shadow:([^;]*);/.exec(regra(seletor))?.[1] ?? ""
      expect(sombra, seletor).not.toBe("")
      expect(sombra, seletor).not.toMatch(/--voz/)
    }
  })

  it("o cartão já não tem sombra que siga a voz", () => {
    expect(regra(".call-chip")).not.toMatch(/box-shadow[^;]*--voz/)
  })

  it("o anel verde só muda de `opacity`", () => {
    const fala = regra(".anel-de-voz.fala")
    expect(fala).toMatch(/opacity:\s*min\(1, var\(--voz, 0\) \* 3\)/)
    expect(regra(".anel-de-voz.fala circle")).not.toMatch(/--voz/)
  })

  it("nenhum `::after` nem `::before` no halo nem no anel: são os da dica (`[data-tip]`)", () => {
    expect(ecras).not.toMatch(/\.(halo-de-voz|anel-de-voz)[^{,]*::(after|before)/)
  })

  /*
    * Owner rule for Windows with effects off: with reduced motion nothing stops,
    * it goes slower. Here was `transition: none`, and the halo jumped step by step.
    * The universal rule in `base.css` puts transitions at 0 s with `!important`,
    * and only another `!important` gets past it.
    */
  it("com movimento reduzido o halo e o anel verde deslizam ao dobro do tempo, e nunca sem transição", () => {
    const blocos = ecras.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g) ?? []
    const doHalo = blocos.filter((b) => /\.halo-de-voz\s*\{/.test(b))
    expect(doHalo).toHaveLength(1)
    const bloco = doHalo[0]!
    expect(bloco).not.toMatch(/transition:\s*none/)

    const halo = /\.halo-de-voz\s*\{([^}]*)\}/.exec(bloco)?.[1] ?? ""
    const normal = Number(/opacity (\d+)ms/.exec(regra(".halo-de-voz"))?.[1])
    const devagar = Number(/opacity (\d+)ms/.exec(halo)?.[1])
    expect(devagar).toBe(normal * 2)
    expect(halo).toMatch(/transform \d+ms linear !important/)

    const fala = /\.anel-de-voz\.fala\s*\{([^}]*)\}/.exec(bloco)?.[1] ?? ""
    expect(fala).toMatch(/transition:\s*opacity calc\(var\(--dur-fast\) \* 2\)[^;]*!important/)
  })
})
