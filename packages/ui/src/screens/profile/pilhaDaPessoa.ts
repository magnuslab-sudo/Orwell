import { useEffect, useRef, useState } from "react"

/**
 * A person page in the stack: who it is, and how we got there.
 *
 * `publicacao` is the identifier of a post opened inside the page. An open
 * post is a stack entry like any other: the browser "back" closes it before
 * closing the page, like the arrow and Escape do.
 */
export interface EntradaDaPessoa {
  address: string
  /** The shared channel we came from. Decides ranks and "Verify". */
  channel: string | null
  publicacao?: string | undefined
}

/**
 * The identifier of a post in the stack.
 *
 * Its `id`, which all new posts carry. Without it, its place in the channel,
 * which is unique there.
 */
export function idDaPublicacao(post: { channel: string; seq: number; payload: { id?: string | undefined } }): string {
  return post.payload.id ?? `${post.channel}#${post.seq}`
}

/** The key of the state this stack stores in each history entry. */
const CHAVE = "orwellPessoa"

interface EstadoNoHistorico {
  /** Which assembly this entry belongs to. See `sessao` below. */
  sessao: string
  /** How many of our entries there are, including this one. */
  profundidade: number
  entrada: EntradaDaPessoa
}

function lerEstado(estado: unknown, sessao: string): EstadoNoHistorico | null {
  if (typeof estado !== "object" || estado === null) return null
  const nosso = (estado as Record<string, unknown>)[CHAVE]
  if (typeof nosso !== "object" || nosso === null) return null
  const candidato = nosso as Partial<EstadoNoHistorico>
  if (candidato.sessao !== sessao || typeof candidato.profundidade !== "number" || !candidato.entrada) return null
  return candidato as EstadoNoHistorico
}

function iguais(a: EntradaDaPessoa | undefined, b: EntradaDaPessoa): boolean {
  return a !== undefined && a.address === b.address && a.channel === b.channel && a.publicacao === b.publicacao
}

export interface PilhaDaPessoa {
  /** The entry on top, the one in view. Null: no page is open. */
  readonly actual: () => EntradaDaPessoa | null
  /** Opens a page (or a post of it) on top of the current one. */
  abrir: (entrada: EntradaDaPessoa) => void
  /** The arrow and Escape: removes the top entry. */
  voltar: () => void
  /** Go to another destination: removes the whole stack. */
  fechar: () => void
  /** Starts listening to `popstate`. Can connect again after disconnect. */
  ligar: () => void
  /** Drops the `popstate` listener. */
  desligar: () => void
}

/**
 * The stack of person pages, and the browser history mirrored from it.
 *
 * **The stack in memory commands; the history follows.** Each open page is an
 * entry with `pushState`, and that is what gives the browser back button and
 * the same stack in the installed app, where the arrow and Escape go through
 * the same `history`. The interface changes right away, without waiting for
 * `popstate`: the history follows after, by `go`, until it has the same depth.
 *
 * **One move at a time.** `history.go` is async, and two in a row on Chrome
 * do not make two correct trips. While one is in flight (`aCaminho`), the rest
 * waits, and the `popstate` from it corrects the count again. A `pushState`
 * mid-trip also waits, for the same reason: it would land on the wrong entry.
 *
 * **The page address does not change.** The state goes in the entry, not in
 * the URL: a person address in the path would go to the server on the next
 * reload, and that is precisely what this app does not tell it.
 *
 * **`sessao` separates this assembly from earlier ones.** A reload saves the
 * state of old entries; without a mark, "back" after reload would open a page
 * no one had opened. Entries from another session count as entries with no page.
 *
 * No history (an opaque origin throws on `pushState`): the stack keeps working
 * in memory alone. The arrow and Escape go back the same way; only the browser
 * button does not know about it.
 */
export function criarPilhaDaPessoa({
  historico,
  janela,
  aoMudar,
  sessao = Math.random().toString(36).slice(2),
}: {
  historico: Pick<History, "pushState" | "go"> | null
  janela: Pick<Window, "addEventListener" | "removeEventListener"> | null
  aoMudar: (actual: EntradaDaPessoa | null) => void
  sessao?: string
}): PilhaDaPessoa {
  const pilha: EntradaDaPessoa[] = []
  /** How many of our entries the history has, above the start one. */
  let noHistorico = 0
  let aCaminho = false
  let semHistorico = historico === null

  const avisar = (): void => aoMudar(pilha.at(-1) ?? null)

  /** Makes the history have the same depth as the stack. */
  const acertar = (): void => {
    if (semHistorico || aCaminho || historico === null) return
    if (noHistorico > pilha.length) {
      aCaminho = true
      historico.go(pilha.length - noHistorico)
      return
    }
    while (noHistorico < pilha.length) {
      const profundidade = noHistorico + 1
      const entrada = pilha[noHistorico] as EntradaDaPessoa
      try {
        historico.pushState({ [CHAVE]: { sessao, profundidade, entrada } satisfies EstadoNoHistorico }, "")
      } catch {
        semHistorico = true
        return
      }
      noHistorico = profundidade
    }
  }

  const aoPopstate = (evento: PopStateEvent): void => {
    if (semHistorico) return
    const estado = lerEstado(evento.state, sessao)
    const profundidade = estado?.profundidade ?? 0
    noHistorico = profundidade
    if (aCaminho) {
      // The stack belonged to us: it was already correct before she left.
      aCaminho = false
      acertar()
      return
    }
    // The browser button, back or forward.
    if (profundidade < pilha.length) pilha.length = profundidade
    else if (estado && profundidade > pilha.length) pilha.push(estado.entrada)
    avisar()
  }
  return {
    actual: () => pilha.at(-1) ?? null,
    abrir: (entrada) => {
      if (iguais(pilha.at(-1), entrada)) return
      pilha.push(entrada)
      avisar()
      acertar()
    },
    voltar: () => {
      if (pilha.length === 0) return
      pilha.pop()
      avisar()
      acertar()
    },
    fechar: () => {
      if (pilha.length === 0) return
      pilha.length = 0
      avisar()
      acertar()
    },
    ligar: () => janela?.addEventListener("popstate", aoPopstate),
    desligar: () => janela?.removeEventListener("popstate", aoPopstate),
  }
}

/**
 * The stack of person pages, for `App`. See `criarPilhaDaPessoa`.
 *
 * The three functions are stable: they can go into the dependencies of a
 * `useCallback` without being remade on each render.
 */
export function usePilhaDaPessoa(): {
  actual: EntradaDaPessoa | null
  abrir: (entrada: EntradaDaPessoa) => void
  voltar: () => void
  fechar: () => void
} {
  const [actual, setActual] = useState<EntradaDaPessoa | null>(null)
  const pilha = useRef<PilhaDaPessoa | null>(null)
  pilha.current ??= criarPilhaDaPessoa({
    historico: typeof window === "undefined" ? null : window.history,
    janela: typeof window === "undefined" ? null : window,
    aoMudar: setActual,
  })
  useEffect(() => {
    // In the effect, not at creation: strict mode mounts, unmounts and mounts again,
    // and a listener attached only at creation would be left dangling after that.
    const esta = pilha.current
    esta?.ligar()
    return () => esta?.desligar()
  }, [])
  const [accoes] = useState(() => ({
    abrir: (entrada: EntradaDaPessoa) => pilha.current?.abrir(entrada),
    voltar: () => pilha.current?.voltar(),
    fechar: () => pilha.current?.fechar(),
  }))
  return { actual, ...accoes }
}
