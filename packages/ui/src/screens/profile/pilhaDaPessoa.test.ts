import { describe, expect, it } from "vitest"
import { criarPilhaDaPessoa, type EntradaDaPessoa } from "./pilhaDaPessoa.js"

/**
 * A browser history in small point: entries, an index, and `go` async like
 * the real thing. The `popstate` fires when the trip ends.
 */
function historicoFalso(): {
  historico: Pick<History, "pushState" | "go">
  janela: EventTarget
  entradas: unknown[]
  indice: () => number
  /** The browser back button (or forward button). */
  botao: (passos: number) => Promise<void>
  /** Waits for trips in flight to finish. */
  assentar: () => Promise<void>
} {
  const entradas: unknown[] = [null]
  let indice = 0
  const janela = new EventTarget()
  let viagens: Promise<void> = Promise.resolve()
  const go = (passos: number): void => {
    viagens = viagens.then(
      () =>
        new Promise<void>((resolver) => {
          setTimeout(() => {
            indice = Math.max(0, Math.min(entradas.length - 1, indice + passos))
            const evento = new Event("popstate") as PopStateEvent
            Object.defineProperty(evento, "state", { value: entradas[indice] })
            janela.dispatchEvent(evento)
            resolver()
          }, 0)
        }),
    )
  }
  return {
    historico: {
      pushState: (estado: unknown) => {
        entradas.length = indice + 1
        entradas.push(estado)
        indice += 1
      },
      go,
    },
    janela,
    entradas,
    indice: () => indice,
    botao: async (passos) => {
      go(passos)
      await viagens
    },
    assentar: async () => {
      // Two loops: one `popstate` may ask for another trip.
      await viagens
      await new Promise((resolver) => setTimeout(resolver, 5))
      await viagens
    },
  }
}

function montar(): ReturnType<typeof historicoFalso> & {
  pilha: ReturnType<typeof criarPilhaDaPessoa>
  vistas: (EntradaDaPessoa | null)[]
} {
  const falso = historicoFalso()
  const vistas: (EntradaDaPessoa | null)[] = []
  const pilha = criarPilhaDaPessoa({
    historico: falso.historico,
    janela: falso.janela as unknown as Window,
    aoMudar: (actual) => vistas.push(actual),
    sessao: "s1",
  })
  pilha.ligar()
  return { ...falso, pilha, vistas }
}

const ana: EntradaDaPessoa = { address: "@ana:s", channel: null }
const rui: EntradaDaPessoa = { address: "@rui:s", channel: "!sala:s" }

describe("a pilha das páginas de pessoa", () => {
  it("abrir empilha uma entrada no histórico, e a seta volta por ele", async () => {
    const { pilha, entradas, indice, assentar } = montar()
    pilha.abrir(ana)
    expect(pilha.actual()).toEqual(ana)
    expect(entradas).toHaveLength(2)
    pilha.voltar()
    // The interface changes now; the history follows after.
    expect(pilha.actual()).toBeNull()
    await assentar()
    expect(indice()).toBe(0)
  })

  it("o botão de voltar do browser fecha a página de cima, e o de avançar reabre-a", async () => {
    const { pilha, botao } = montar()
    pilha.abrir(ana)
    pilha.abrir(rui)
    await botao(-1)
    expect(pilha.actual()).toEqual(ana)
    await botao(-1)
    expect(pilha.actual()).toBeNull()
    await botao(1)
    expect(pilha.actual()).toEqual(ana)
  })

  it("fechar tira a pilha toda numa viagem só", async () => {
    const { pilha, indice, assentar, botao } = montar()
    pilha.abrir(ana)
    pilha.abrir(rui)
    pilha.abrir({ ...rui, publicacao: "p1" })
    pilha.fechar()
    expect(pilha.actual()).toBeNull()
    await assentar()
    expect(indice()).toBe(0)
    // A back right after does not reopen anything.
    await botao(-1)
    expect(pilha.actual()).toBeNull()
  })

  it("voltar duas vezes depressa não deixa o histórico a meio caminho", async () => {
    const { pilha, indice, assentar } = montar()
    pilha.abrir(ana)
    pilha.abrir(rui)
    pilha.voltar()
    pilha.voltar()
    expect(pilha.actual()).toBeNull()
    await assentar()
    expect(indice()).toBe(0)
    expect(pilha.actual()).toBeNull()
  })

  it("abrir outra pessoa a meio de uma viagem espera por ela, e fica por cima", async () => {
    const { pilha, entradas, indice, assentar, botao } = montar()
    pilha.abrir(ana)
    pilha.abrir(rui)
    pilha.voltar()
    pilha.abrir({ address: "@zoe:s", channel: null })
    await assentar()
    expect(indice()).toBe(2)
    expect(entradas).toHaveLength(3)
    await botao(-1)
    expect(pilha.actual()).toEqual(ana)
  })

  it("abrir a mesma página outra vez não empilha nada", () => {
    const { pilha, entradas } = montar()
    pilha.abrir(ana)
    pilha.abrir({ ...ana })
    expect(entradas).toHaveLength(2)
  })

  it("entradas de outra sessão (um recarregamento) contam como sem página", async () => {
    const { pilha, historico, botao } = montar()
    historico.pushState({ orwellPessoa: { sessao: "antiga", profundidade: 1, entrada: rui } }, "")
    historico.pushState(null, "")
    await botao(-1)
    expect(pilha.actual()).toBeNull()
  })

  it("sem histórico, a seta e o Escape voltam na mesma", () => {
    const vistas: (EntradaDaPessoa | null)[] = []
    const pilha = criarPilhaDaPessoa({
      historico: {
        pushState: () => {
          throw new DOMException("origem opaca", "SecurityError")
        },
        go: () => {
          throw new Error("não devia viajar")
        },
      },
      janela: null,
      aoMudar: (actual) => vistas.push(actual),
    })
    pilha.abrir(ana)
    pilha.abrir(rui)
    pilha.voltar()
    expect(pilha.actual()).toEqual(ana)
    pilha.fechar()
    expect(vistas.at(-1)).toBeNull()
  })
})
