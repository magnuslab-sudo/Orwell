import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DesenhoDaOverlay, ResumoDaOverlay } from "../../main/overlay.js"
import { CARAS_VISIVEIS, DURACAO_DO_AVISO_MS, duracoes, montarOverlay, type PonteDaOverlay } from "./pagina.js"

function ponteFalsa() {
  let desenhar: (valor: unknown) => void = () => {}
  let caras: (valor: unknown) => void = () => {}
  const ponte: PonteDaOverlay & { chamadas: string[] } = {
    chamadas: [],
    aoDesenhar: (fazer) => {
      desenhar = fazer
      return () => {}
    },
    aoReceberCaras: (fazer) => {
      caras = fazer
      return () => {}
    },
    rato: (dentro) => ponte.chamadas.push(`rato:${dentro}`),
    arrastar: (fase) => ponte.chamadas.push(`arrastar:${fase}`),
    largura: (pixeis) => ponte.chamadas.push(`largura:${pixeis}`),
    repor: () => ponte.chamadas.push("repor"),
  }
  return { ponte, desenhar: (d: unknown) => desenhar(d), caras: (c: unknown) => caras(c) }
}

const pessoa = (id: string, extra: Partial<ResumoDaOverlay["pessoas"][number]> = {}) => ({
  id,
  nome: id,
  aFalar: false,
  micCalado: false,
  somDesligado: false,
  ...extra,
})

const desenho = (pessoas: ResumoDaOverlay["pessoas"], extra: Partial<DesenhoDaOverlay> = {}): DesenhoDaOverlay => ({
  resumo: { sala: "Sala de jogo", entrada: 1, pessoas },
  opacidade: 0.6,
  lado: "abaixo",
  textos: { entrou: "entrou na sala", saiu: "saiu da sala" },
  ...extra,
})

describe("a página da overlay", () => {
  let raiz: HTMLElement
  beforeEach(() => {
    vi.useFakeTimers()
    raiz = document.createElement("div")
    document.body.append(raiz)
  })
  afterEach(() => {
    vi.useRealTimers()
    raiz.remove()
  })

  it("desenha o nome da sala, as caras, quem fala e quem está silenciado", () => {
    const { ponte, desenhar, caras } = ponteFalsa()
    montarOverlay({ raiz, ponte, reduzido: false })
    caras({ kaori: "data:image/png;base64,AAAA" })
    desenhar(desenho([pessoa("eu", { somDesligado: true }), pessoa("kaori", { aFalar: true }), pessoa("rui", { micCalado: true })]))

    expect(raiz.querySelector(".sala")?.textContent).toBe("Sala de jogo")
    const lista = [...raiz.querySelectorAll<HTMLElement>(".cara")]
    expect(lista.map((cara) => cara.dataset.id)).toEqual(["eu", "kaori", "rui"])
    expect(lista[1]?.hasAttribute("data-fala")).toBe(true)
    expect(lista[0]?.hasAttribute("data-fala")).toBe(false)
    expect(lista[1]?.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA")
    // No face, just the initial.
    expect(lista[2]?.querySelector(".inicial")?.textContent).toBe("R")
    expect(lista[2]?.querySelector('[data-marca="microfone"]')).not.toBeNull()
    expect(lista[0]?.querySelector('[data-marca="som"]')).not.toBeNull()
  })

  it("um nome é texto, nunca marcação", () => {
    const { ponte, desenhar } = ponteFalsa()
    montarOverlay({ raiz, ponte, reduzido: false })
    desenhar(desenho([pessoa("x", { nome: '<img src=x onerror="alert(1)">' })]))
    expect(raiz.querySelector("img[onerror]")).toBeNull()
  })

  it("mostra no máximo as caras que cabem, e conta as outras", () => {
    const { ponte, desenhar } = ponteFalsa()
    montarOverlay({ raiz, ponte, reduzido: false })
    desenhar(desenho(Array.from({ length: CARAS_VISIVEIS + 3 }, (_, i) => pessoa(`p${i}`))))
    expect(raiz.querySelectorAll(".cara")).toHaveLength(CARAS_VISIVEIS)
    expect(raiz.querySelector(".mais")?.textContent).toBe("+3")
  })

  it("avisa quem entrou e quem saiu, com a cara, e o aviso some sozinho", () => {
    const { ponte, desenhar, caras } = ponteFalsa()
    montarOverlay({ raiz, ponte, reduzido: false })
    desenhar(desenho([pessoa("eu")]))
    // The first photo does not alert anyone.
    expect(raiz.querySelector(".aviso")?.hasAttribute("hidden")).toBe(true)

    caras({ kaori: "data:image/png;base64,AAAA" })
    desenhar(desenho([pessoa("eu"), pessoa("kaori", { nome: "Kaori" })]))
    const aviso = raiz.querySelector<HTMLElement>(".aviso")!
    expect(aviso.hasAttribute("hidden")).toBe(false)
    expect(aviso.querySelector(".aviso-nome")?.textContent).toBe("Kaori")
    expect(aviso.textContent).toContain("entrou na sala")
    expect(aviso.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA")

    desenhar(desenho([pessoa("eu")]))
    vi.advanceTimersByTime(DURACAO_DO_AVISO_MS + 1000)
    expect(aviso.textContent).toContain("saiu da sala")
    vi.advanceTimersByTime(DURACAO_DO_AVISO_MS + 1000)
    expect(aviso.hasAttribute("hidden")).toBe(true)
  })

  it("um nome tirado do endereço sai discreto no aviso, e um nome escolhido não", () => {
    const { ponte, desenhar } = ponteFalsa()
    montarOverlay({ raiz, ponte, reduzido: false })
    const milsinda = pessoa("@milsinda-a-b-c:orwell.pt", { nome: "Milsinda", doEndereco: true })
    const kaori = pessoa("kaori", { nome: "Kaori" })
    desenhar(desenho([pessoa("eu")]))
    desenhar(desenho([pessoa("eu"), kaori]))
    const aviso = raiz.querySelector<HTMLElement>(".aviso")!
    expect(aviso.querySelector(".aviso-nome")?.textContent).toBe("Kaori")
    expect(aviso.querySelector(".aviso-nome")?.classList.contains("do-endereco")).toBe(false)

    vi.advanceTimersByTime(DURACAO_DO_AVISO_MS + 1000)
    desenhar(desenho([pessoa("eu"), kaori, milsinda]))
    expect(aviso.querySelector(".aviso-nome")?.textContent).toBe("Milsinda")
    expect(aviso.querySelector(".aviso-nome")?.classList.contains("do-endereco")).toBe(true)
  })

  it("o aviso vai para o lado que o principal diz, e a opacidade é a das Definições", () => {
    const { ponte, desenhar } = ponteFalsa()
    montarOverlay({ raiz, ponte, reduzido: false })
    desenhar(desenho([pessoa("eu")], { lado: "acima", opacidade: 0.35 }))
    expect(raiz.dataset.lado).toBe("acima")
    expect(raiz.style.getPropertyValue("--fundo-alfa")).toBe("0.35")
  })

  it("o rato sobre a pílula, o arrasto e o duplo clique vão ao principal", () => {
    const { ponte, desenhar } = ponteFalsa()
    montarOverlay({ raiz, ponte, reduzido: false })
    desenhar(desenho([pessoa("eu")]))
    const pilula = raiz.querySelector<HTMLElement>(".pilula")!
    pilula.dispatchEvent(new Event("pointerenter"))
    pilula.dispatchEvent(Object.assign(new Event("pointerdown"), { button: 0, pointerId: 1 }))
    pilula.dispatchEvent(new Event("pointerup"))
    pilula.dispatchEvent(new Event("dblclick"))
    pilula.dispatchEvent(new Event("pointerleave"))
    expect(ponte.chamadas.filter((c) => !c.startsWith("largura"))).toEqual([
      "rato:true",
      "arrastar:inicio",
      "arrastar:fim",
      "repor",
      "rato:false",
    ])
  })

  it("o botão direito não arrasta", () => {
    const { ponte, desenhar } = ponteFalsa()
    montarOverlay({ raiz, ponte, reduzido: false })
    desenhar(desenho([pessoa("eu")]))
    const pilula = raiz.querySelector<HTMLElement>(".pilula")!
    pilula.dispatchEvent(Object.assign(new Event("pointerdown"), { button: 2, pointerId: 1 }))
    expect(ponte.chamadas).not.toContain("arrastar:inicio")
  })

  it("diz a largura da pílula ao principal depois de desenhar", () => {
    const { ponte, desenhar } = ponteFalsa()
    montarOverlay({ raiz, ponte, reduzido: false })
    desenhar(desenho([pessoa("eu")]))
    expect(ponte.chamadas.some((c) => c.startsWith("largura:"))).toBe(true)
  })

  it("com movimento reduzido, o anel e o aviso continuam a mexer, mais devagar", () => {
    const normal = duracoes(false)
    const lento = duracoes(true)
    expect(lento.anelMs).toBeGreaterThan(normal.anelMs)
    expect(lento.avisoMs).toBeGreaterThan(normal.avisoMs)
    expect(lento.anelMs).toBeGreaterThan(0)
    expect(lento.avisoMs).toBeGreaterThan(0)
    // And the alert shift never reaches zero: it moves, just more slowly.
    expect(lento.deslocamentoPx).toBeGreaterThan(0)

    const { ponte } = ponteFalsa()
    montarOverlay({ raiz, ponte, reduzido: true })
    expect(raiz.style.getPropertyValue("--dur-anel")).toBe(`${lento.anelMs}ms`)
    expect(raiz.style.getPropertyValue("--dur-aviso")).toBe(`${lento.avisoMs}ms`)
  })

  it("lixo vindo do principal não desenha nada", () => {
    const { ponte, desenhar } = ponteFalsa()
    montarOverlay({ raiz, ponte, reduzido: false })
    desenhar("lixo")
    desenhar({ resumo: null })
    expect(raiz.querySelectorAll(".cara")).toHaveLength(0)
  })
})
