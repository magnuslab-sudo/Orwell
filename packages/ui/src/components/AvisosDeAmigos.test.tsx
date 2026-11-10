import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useAvisoDeAmigo } from "./AvisosDeAmigos.js"
import { ToastProvider } from "./Toast.js"
import type { AvisoDeAmigo } from "../hooks/useAvisosDeAmigos.js"
import { strings } from "../strings.js"

/**
 * The card in the MSN style (mockup chosen by the owner on November 3, 2026): 2 s
 * lifespan, paused with the cursor, at most 3 showing, and the rest in a "+N".
 */

const AQUI = dirname(fileURLToPath(import.meta.url))

function aviso(nome: string, extra: Partial<AvisoDeAmigo> = {}): AvisoDeAmigo {
  return {
    tipo: "online",
    texto: strings.notifications.amigoOnline(nome),
    iniciais: nome[0] ?? "?",
    rotulo: strings.notifications.abrirConversa,
    fazer: () => {},
    ...extra,
  }
}

let empurrar: (aviso: AvisoDeAmigo) => void = () => {}
function Pedinte(): null {
  empurrar = useAvisoDeAmigo()
  return null
}

function montar(): void {
  render(
    <ToastProvider>
      <input aria-label="escrita" />
      <Pedinte />
    </ToastProvider>,
  )
}

function chega(...avisos: AvisoDeAmigo[]): void {
  act(() => {
    for (const um of avisos) empurrar(um)
  })
}

function passa(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("o card de um amigo online", () => {
  it('mostra a frase, "agora mesmo" e o botão; o leitor de ecrã lê "Ana está online"', () => {
    montar()
    chega(aviso("Ana"))
    const card = document.querySelector(".aviso-amigo")
    expect(card?.querySelector(".aviso-amigo-titulo")?.textContent).toBe("Ana está online")
    expect(card?.textContent).toContain(strings.notifications.agoraMesmo)
    expect(screen.getByRole("button", { name: strings.notifications.abrirConversa })).toBeTruthy()
    expect(screen.getByRole("status").textContent).toBe("Ana está online")
    // The stack mutes the notification region for itself: otherwise the button would be read too.
    expect(document.querySelector(".avisos-amigos")?.getAttribute("aria-live")).toBe("off")
  })

  it("sai sozinho aos 2 s, e a região do leitor fica vazia", () => {
    montar()
    chega(aviso("Ana"))
    passa(1999)
    expect(document.querySelector(".aviso-amigo")).toBeTruthy()
    passa(1)
    expect(document.querySelector(".aviso-amigo")).toBeNull()
    expect(screen.getByRole("status").textContent).toBe("")
  })

  it("com o rato por cima o relógio pára, e a linha também; ao sair retoma com o que faltava", () => {
    montar()
    chega(aviso("Ana"))
    passa(1000)
    const card = document.querySelector(".aviso-amigo") as HTMLElement
    fireEvent.mouseEnter(card)
    expect(card.classList.contains("parado")).toBe(true)
    passa(10_000)
    expect(document.querySelector(".aviso-amigo")).toBeTruthy()
    fireEvent.mouseLeave(card)
    expect(card.classList.contains("parado")).toBe(false)
    passa(999)
    expect(document.querySelector(".aviso-amigo")).toBeTruthy()
    passa(1)
    expect(document.querySelector(".aviso-amigo")).toBeNull()
  })

  it("o botão faz a acção e fecha o card", () => {
    montar()
    const fazer = vi.fn()
    chega(aviso("Ana", { fazer }))
    fireEvent.click(screen.getByRole("button", { name: strings.notifications.abrirConversa }))
    expect(fazer).toHaveBeenCalledTimes(1)
    expect(document.querySelector(".aviso-amigo")).toBeNull()
  })

  it("não rouba o foco da escrita; com o foco no botão, Esc fecha", () => {
    montar()
    const escrita = screen.getByRole("textbox", { name: "escrita" })
    escrita.focus()
    chega(aviso("Ana"))
    expect(document.activeElement).toBe(escrita)
    const botao = screen.getByRole("button", { name: strings.notifications.abrirConversa })
    botao.focus()
    // Focus also stops the timer.
    passa(5000)
    expect(document.querySelector(".aviso-amigo")).toBeTruthy()
    fireEvent.keyDown(botao, { key: "Escape" })
    expect(document.querySelector(".aviso-amigo")).toBeNull()
  })

  it("a cara, quando há, e as iniciais quando não há", () => {
    montar()
    chega(aviso("Ana", { cara: "data:image/png;base64,iVBORw0KGgo=" }), aviso("Bruno"))
    const cards = document.querySelectorAll(".aviso-amigo")
    expect(cards[0]?.querySelector("img")).toBeTruthy()
    expect(cards[1]?.querySelector(".aviso-amigo-iniciais")?.textContent).toBe("B")
  })

  it("o sítio, quando o aviso o traz, vai por baixo em cinzento", () => {
    montar()
    chega(aviso("Ana", { tipo: "voz", texto: strings.notifications.amigoNaVoz("Ana", "Lounge"), onde: "Oficina" }))
    expect(document.querySelector(".aviso-amigo-onde")?.textContent).toBe("Oficina")
  })
})

describe("vários amigos ao mesmo tempo", () => {
  it('empilham-se: 3 à vista, os outros num "+N amigos online"', () => {
    montar()
    chega(aviso("Ana"), aviso("Bruno"), aviso("Carla"), aviso("Duarte"), aviso("Eva"))
    const titulos = [...document.querySelectorAll(".aviso-amigo-titulo")].map((n) => n.textContent)
    // The newest, the last one at the bottom, near the corner.
    expect(titulos).toEqual(["Carla está online", "Duarte está online", "Eva está online"])
    expect(document.querySelector(".avisos-amigos-mais")?.textContent).toBe(strings.notifications.maisAmigosOnline(2))
  })

  it('com tipos misturados fora da pilha, "+N avisos de amigos"', () => {
    montar()
    chega(
      aviso("Ana", { tipo: "voz", texto: strings.notifications.amigoNaVoz("Ana", "Lounge") }),
      aviso("Bruno"),
      aviso("Carla"),
      aviso("Duarte"),
    )
    expect(document.querySelector(".avisos-amigos-mais")?.textContent).toBe(strings.notifications.maisAvisos(1))
  })

  it("cada um com o seu relógio de 2 s", () => {
    montar()
    chega(aviso("Ana"))
    passa(1000)
    chega(aviso("Bruno"))
    passa(1000)
    expect([...document.querySelectorAll(".aviso-amigo-titulo")].map((n) => n.textContent)).toEqual([
      "Bruno está online",
    ])
    passa(1000)
    expect(document.querySelector(".aviso-amigo")).toBeNull()
  })

  it("parar um não pára os outros", () => {
    montar()
    chega(aviso("Ana"), aviso("Bruno"))
    fireEvent.mouseEnter(document.querySelectorAll(".aviso-amigo")[0] as HTMLElement)
    passa(2000)
    expect([...document.querySelectorAll(".aviso-amigo-titulo")].map((n) => n.textContent)).toEqual([
      "Ana está online",
    ])
  })
})

describe("movimento reduzido, à folha de estilos", () => {
  const componentes = readFileSync(join(AQUI, "../styles/components.css"), "utf8")
  const base = readFileSync(join(AQUI, "../styles/base.css"), "utf8")
  const reduzido = (css: string): string => {
    const partes = css.split("@media (prefers-reduced-motion: reduce)").slice(1)
    return partes.join("\n")
  }

  it("o card entra a esvanecer em vez de deslizar", () => {
    expect(reduzido(componentes)).toMatch(/\.aviso-amigo\s*\{[^}]*animation-name:\s*aviso-amigo-esvanece/)
    const esvanece = componentes.slice(componentes.indexOf("@keyframes aviso-amigo-esvanece"))
    expect(esvanece.slice(0, esvanece.indexOf("}\n}"))).not.toMatch(/transform/)
  })

  it("a regra universal não zera a entrada nem a linha: a linha esvazia-se nos 2 s", () => {
    const bloco = reduzido(base)
    expect(bloco).toMatch(/\.aviso-amigo\s*\{\s*animation-duration:\s*400ms\s*!important/)
    expect(bloco).toMatch(/\.aviso-amigo-vida > span\s*\{\s*animation-duration:\s*var\(--vida-do-aviso, 2000ms\)\s*!important/)
  })
})

describe("o card discreto", () => {
  it("sem cara nem iniciais, fica o desenho de uma pessoa, e a frase não tem nome", () => {
    montar()
    chega(aviso("Ana", { texto: strings.notifications.amigoOnlineDiscreto, iniciais: "" }))
    const card = document.querySelector(".aviso-amigo")
    expect(card?.querySelector("img")).toBeNull()
    expect(card?.querySelector(".aviso-amigo-cara svg")).toBeTruthy()
    expect(card?.querySelector(".aviso-amigo-titulo")?.textContent).toBe("Um amigo está online")
  })
})
