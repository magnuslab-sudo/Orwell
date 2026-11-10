import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  aberturaDesmontou,
  aberturaMontou,
  esquecerAbertura,
  MINIMO_VISIVEL_MS,
  origemDaAbertura,
  SAIDA_MS,
  SAIDA_REDUZIDA_MS,
} from "./abertura-viva.js"

/**
 * The opening from start to finish: the phase between mounts and the fade-out.
 *
 * jsdom has no Web Animations. Here each element gets the animations given to it, in the form the browser gives them (a `CSSAnimation` with name and `startTime`); what is tested is what the module does with them. Testing with the real browser, frame by frame, is in `scripts/abertura-prova.mjs`.
 */
class AnimacaoFalsa {
  constructor(
    readonly animationName: string,
    public startTime: number | null,
  ) {}
}

const animacoes = new WeakMap<Element, AnimacaoFalsa[]>()

function comAnimacoes(elemento: Element, ...lista: AnimacaoFalsa[]): Element {
  animacoes.set(elemento, lista)
  return elemento
}

function splash(): HTMLElement {
  const gate = document.createElement("div")
  gate.className = "gate"
  gate.innerHTML = '<div class="abertura"><span class="abertura-anel"></span><p class="abertura-texto">A abrir…</p></div>'
  return gate
}

let reduzido = false

beforeEach(() => {
  vi.useFakeTimers()
  reduzido = false
  vi.stubGlobal("CSSAnimation", AnimacaoFalsa)
  vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: reduzido && consulta.includes("reduce") }))
  // The animations of an element and its children, like `{ subtree: true }`.
  Element.prototype.getAnimations = function (this: Element) {
    return [this, ...this.querySelectorAll("*")].flatMap((e) => animacoes.get(e) ?? []) as unknown as Animation[]
  }
})

afterEach(() => {
  esquecerAbertura()
  document.body.replaceChildren()
  delete (Element.prototype as { getAnimations?: unknown }).getAnimations
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** The microtask in which the exit decides. */
const depoisDoCommit = (): Promise<void> => Promise.resolve()

describe("a fase da abertura", () => {
  it("herda o relógio do splash do index.html, e cada montagem entra nele", () => {
    const doHtml = splash()
    comAnimacoes(doHtml.querySelector(".abertura-anel")!, new AnimacaoFalsa("abertura-gira-vivo", 137))
    document.body.append(doHtml)
    expect(origemDaAbertura()).toBe(137)

    // React removes the one from the HTML and puts its own: new animations, starting now.
    doHtml.remove()
    const doReact = splash()
    const anel = new AnimacaoFalsa("abertura-gira-vivo", null)
    const tarja = new AnimacaoFalsa("abertura-tarja", null)
    comAnimacoes(doReact.querySelector(".abertura-anel")!, anel, tarja)
    document.body.append(doReact)
    aberturaMontou(doReact)
    expect(anel.startTime).toBe(137)
    expect(tarja.startTime).toBe(137)
  })

  it("com movimento reduzido também: a fase não depende de nenhuma regra da folha", () => {
    reduzido = true
    const doHtml = splash()
    comAnimacoes(doHtml.querySelector(".abertura-anel")!, new AnimacaoFalsa("abertura-pulsa", 90))
    document.body.append(doHtml)
    origemDaAbertura()
    doHtml.remove()

    const doReact = splash()
    const pulsa = new AnimacaoFalsa("abertura-pulsa", 2400)
    comAnimacoes(doReact, pulsa)
    aberturaMontou(doReact)
    expect(pulsa.startTime).toBe(90)
  })

  it("não toca nas animações que não são da abertura", () => {
    const outra = new AnimacaoFalsa("aurora", 5)
    const el = comAnimacoes(splash(), outra)
    aberturaMontou(el)
    expect(outra.startTime).toBe(5)
  })
})

describe("a saída da abertura", () => {
  it("um splash que dá lugar a outro no mesmo commit não sai", async () => {
    const primeiro = splash()
    aberturaMontou(primeiro)
    aberturaDesmontou(primeiro)
    aberturaMontou(splash())
    await depoisDoCommit()
    expect(document.querySelector(".abertura-veu")).toBeNull()
    expect(document.documentElement.className).toBe("")
  })

  it("o último fica por cima, segura até ao mínimo, esbate e sai", async () => {
    const ultimo = splash()
    document.body.append(ultimo)
    aberturaMontou(ultimo)
    ultimo.remove()
    aberturaDesmontou(ultimo)
    await depoisDoCommit()

    const veu = document.querySelector<HTMLElement>(".abertura-veu")
    expect(veu).not.toBeNull()
    expect(veu?.getAttribute("aria-hidden")).toBe("true")
    expect(veu?.inert).toBe(true)
    // The next screen waits hidden already.
    expect(document.documentElement.classList.contains("abertura-a-segurar")).toBe(true)

    vi.advanceTimersByTime(MINIMO_VISIVEL_MS - 50)
    expect(document.documentElement.classList.contains("abertura-a-segurar")).toBe(true)

    vi.advanceTimersByTime(50)
    expect(document.documentElement.classList.contains("abertura-a-sair")).toBe(true)
    expect(document.documentElement.classList.contains("abertura-a-segurar")).toBe(false)
    expect(document.documentElement.style.getPropertyValue("--abertura-saida")).toBe(`${SAIDA_MS}ms`)

    vi.advanceTimersByTime(SAIDA_MS)
    expect(document.querySelector(".abertura-veu")).toBeNull()
    expect(document.documentElement.className).toBe("")
    expect(document.documentElement.style.getPropertyValue("--abertura-saida")).toBe("")
  })

  it("com movimento reduzido esbate na mesma, mais devagar", async () => {
    reduzido = true
    const ultimo = splash()
    aberturaMontou(ultimo)
    aberturaDesmontou(ultimo)
    await depoisDoCommit()
    vi.advanceTimersByTime(MINIMO_VISIVEL_MS)
    expect(document.documentElement.style.getPropertyValue("--abertura-saida")).toBe(`${SAIDA_REDUZIDA_MS}ms`)
    vi.advanceTimersByTime(SAIDA_MS)
    expect(document.querySelector(".abertura-veu")).not.toBeNull()
    vi.advanceTimersByTime(SAIDA_REDUZIDA_MS - SAIDA_MS)
    expect(document.querySelector(".abertura-veu")).toBeNull()
  })

  it("um splash que volta a meio da saída cancela-a, e entra no mesmo relógio", async () => {
    const ultimo = splash()
    aberturaMontou(ultimo)
    aberturaDesmontou(ultimo)
    await depoisDoCommit()
    expect(document.querySelector(".abertura-veu")).not.toBeNull()

    const outraVez = splash()
    const anel = new AnimacaoFalsa("abertura-gira-vivo", null)
    comAnimacoes(outraVez, anel)
    aberturaMontou(outraVez)
    expect(document.querySelector(".abertura-veu")).toBeNull()
    expect(document.documentElement.className).toBe("")
    expect(anel.startTime).toBe(origemDaAbertura())
  })

  it("se a abertura já se viu o mínimo, esbate logo", async () => {
    // The opening started long ago: the splash from the HTML has been going since the first draw.
    const doHtml = splash()
    comAnimacoes(doHtml.querySelector(".abertura-anel")!, new AnimacaoFalsa("abertura-gira-vivo", performance.now() - 5_000))
    document.body.append(doHtml)
    origemDaAbertura()
    doHtml.remove()

    const ultimo = splash()
    aberturaMontou(ultimo)
    aberturaDesmontou(ultimo)
    await depoisDoCommit()
    vi.advanceTimersByTime(0)
    expect(document.documentElement.classList.contains("abertura-a-sair")).toBe(true)
  })

  it("sem Web Animations (o jsdom dos outros testes) não deixa cópias no body", async () => {
    delete (Element.prototype as { getAnimations?: unknown }).getAnimations
    const ultimo = splash()
    aberturaMontou(ultimo)
    aberturaDesmontou(ultimo)
    await depoisDoCommit()
    expect(document.querySelector(".abertura-veu")).toBeNull()
  })
})
