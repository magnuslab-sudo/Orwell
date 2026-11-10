import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { strings } from "../../strings.js"
import { CallChip } from "./CallChip.js"

/**
 * The footer of the card for someone streaming music (design D1, chosen by the
 * owner on October 28, 2026): "audio when streamed should be controlled by who
 * listens", and the footer covered the mute button.
 *
 * Pin down the form (the listener controls live INSIDE the footer, in one row;
 * the DJ sees just the track; the name is an `Andante`) and the sheet: no
 * control has its own place in the bottom corner, where the footer is. Pixel
 * measurement (nothing overlaps in the browser) is from `scripts/medir-chamada-23h.mjs`.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const musica = { id: "m", getAudioTracks: () => [], getTracks: () => [] } as unknown as MediaStream

function quemOuve(props: Partial<React.ComponentProps<typeof CallChip>> = {}): HTMLElement {
  render(
    <CallChip
      label="Ana"
      profile={undefined}
      texto="ligada"
      aTocar="Madredeus · Haja o que houver"
      musica={musica}
      volumeDaMusica={0.6}
      onVolumeDaMusica={() => {}}
      onAlternarMusica={() => {}}
      {...props}
    />,
  )
  return document.querySelector<HTMLElement>(".call-chip-musica")!
}

describe("CallChip — o rodapé é a consola de quem ouve", () => {
  it("quem ouve: a nota, o nome, o botão de calar e a régua, por esta ordem, dentro do rodapé", () => {
    const rodape = quemOuve()
    const filhos = [...rodape.children]
    expect(filhos[0]?.tagName.toLowerCase()).toBe("svg")
    expect(filhos[1]?.classList.contains("call-chip-musica-nome")).toBe(true)
    expect(filhos[2]?.matches("button.chip-musica-calar")).toBe(true)
    expect(filhos[3]?.matches("label.chip-volume-musica")).toBe(true)
    expect(filhos).toHaveLength(4)

    const regua = rodape.querySelector<HTMLInputElement>("input[type='range']")!
    expect(regua.value).toBe("0.6")
    expect(rodape.querySelector(".chip-musica-calar")?.getAttribute("aria-label")).toBe(
      strings.musicaNaChamada.silenciarDe("Ana"),
    )
    // Outside the footer no music control stays: the old box is gone.
    const cartao = document.querySelector(".call-chip")!
    expect(cartao.querySelectorAll(".chip-musica-calar, .chip-volume-musica")).toHaveLength(2)
    expect(cartao.querySelector(".chip-musica")).toBeNull()
  })

  it("o nome da faixa é um `Andante`, e o título diz a faixa inteira", () => {
    const nome = quemOuve().querySelector(".call-chip-musica-nome")!
    expect(nome.classList.contains("andante-caixa")).toBe(true)
    expect(nome.getAttribute("title")).toBe(strings.musica.aTocar("Madredeus · Haja o que houver"))
  })

  it("calar e ouvir chamam o gesto, e calada o rodapé diz-se `calada` e o botão fica premido", () => {
    const alternar = vi.fn()
    const rodape = quemOuve({ onAlternarMusica: alternar, musicaCalada: true })
    expect(rodape.classList.contains("calada")).toBe(true)
    const botao = rodape.querySelector<HTMLButtonElement>(".chip-musica-calar")!
    expect(botao.getAttribute("aria-pressed")).toBe("true")
    expect(botao.getAttribute("aria-label")).toBe(strings.musicaNaChamada.ouvirDe("Ana"))
    fireEvent.click(botao)
    expect(alternar).toHaveBeenCalledTimes(1)
  })

  it("mexer na régua dá o valor novo", () => {
    const mudar = vi.fn()
    const rodape = quemOuve({ onVolumeDaMusica: mudar })
    fireEvent.change(rodape.querySelector("input[type='range']")!, { target: { value: "0.25" } })
    expect(mudar).toHaveBeenCalledWith(0.25)
  })

  it("o DJ (o nosso cartão, sem os gestos de quem ouve) vê só a faixa", () => {
    render(<CallChip label="Tu" profile={undefined} texto="tu" aTocar="Fado" musica={musica} proprio />)
    const rodape = document.querySelector(".call-chip-musica")!
    expect(rodape.querySelector(".call-chip-musica-nome")?.textContent).toContain("Fado")
    expect(rodape.querySelector("button, input")).toBeNull()
    expect(document.querySelector(".call-chip")?.classList.contains("com-rodape")).toBe(true)
  })

  it("em pausa não há rodapé, nem controlos: não há som para regular", () => {
    quemOuve({ aTocar: null })
    expect(document.querySelector(".call-chip-musica, .chip-musica-calar, .chip-volume-musica")).toBeNull()
    expect(document.querySelector(".call-chip")?.classList.contains("com-rodape")).toBe(false)
  })
})

const ler = (relativo: string): string => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8")
const ecras = ler("../../styles/screens.css").replace(/\/\*[\s\S]*?\*\//g, "")
/** Each rule from the sheet: the selector (normalized) and the declarations. */
const regras = [...ecras.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: (m[1] ?? "").replace(/\s+/g, " ").trim(),
  corpo: m[2] ?? "",
}))

describe("screens.css — nada se sobrepõe ao rodapé", () => {
  it("nenhuma regra dá posição própria ao botão de calar nem à régua da música", () => {
    const dosControlos = regras.filter((r) => /\.chip-musica-calar|\.chip-volume-musica/.test(r.selector))
    expect(dosControlos.length).toBeGreaterThan(0)
    for (const r of dosControlos) {
      expect(r.corpo, r.selector).not.toMatch(/(?:^|[;\s])(?:position:\s*absolute|top:|bottom:|left:|right:|inset:)/)
    }
  })

  it('a régua desfaz a posição e o "aparecer com o rato" que herda do cursor da voz', () => {
    const regua = regras.find((r) => r.selector === ".call-chip-musica .chip-volume-musica")?.corpo ?? ""
    expect(regua).toMatch(/position:\s*static/)
    expect(regua).toMatch(/opacity:\s*1/)
  })

  it("a caixa antiga (`.chip-musica`, no canto de baixo) saiu da folha", () => {
    expect(regras.filter((r) => /\.chip-musica(?![-\w])/.test(r.selector))).toEqual([])
  })

  it("o rodapé tem 40 px, e o nome e as marcas sobem essa altura", () => {
    expect(regras.find((r) => r.selector.startsWith(".call-chip.com-rodape,"))?.corpo).toMatch(/--rodape:\s*40px/)
    expect(regras.find((r) => r.selector === ".call-chip-musica")?.corpo).toMatch(/height:\s*var\(--rodape\)/)
    expect(regras.find((r) => r.selector === ".call-chip.com-rodape .call-chip-labels")?.corpo).toMatch(/var\(--rodape\)/)
    expect(
      regras.find((r) => r.selector === ".call-person:has(> .call-chip.com-rodape) .call-person-marcas")?.corpo,
    ).toMatch(/var\(--rodape\)/)
  })
})
