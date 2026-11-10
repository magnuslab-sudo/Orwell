import { useLayoutEffect, useRef, useState } from "react"
import type { EnclaveBridge } from "../bridge.js"
import { strings } from "../strings.js"

/**
 * Reorder roles: by drag and drop or with "Up" and "Down" buttons.
 *
 * **One place for both editors** (4/11/2026, owner request: "the
 * founder/admin should be able to reorganize the order roles are
 * presented"). The role editor (`RoleEditor`) and the permissions model
 * section (`CargosEPermissoes`) show the same list; both sort here, with
 * the same rule and the same text. Two copies of this gesture meant two
 * rules that could diverge.
 *
 * The rule lives in the core (`reorderRoles`): only the founder and those
 * with `admin`. The component passes `onOrdenar` only to those the rule
 * allows; without it there are no arrows or drag. `admin` and `@todos` do
 * not enter the list: they have a fixed place.
 *
 * **The list updates right away.** The core republishes a role for each
 * position that changes, and that takes time. While waiting for the response,
 * we show the requested order; a second gesture in the meantime does not run
 * in parallel (two crossed `reorderRoles` calls could leave half of each),
 * it waits and runs after, only the last one.
 */

export interface OrdemDosCargos {
  /** The order to display: the requested one while the core responds, otherwise the channel order. */
  ordem: readonly string[]
  /** Whether this person can change the order. */
  pode: boolean
  /** Move the role from position `de` to position `para` (zero-indexed). */
  mover: (de: number, para: number, comoFoi?: "teclado" | "arrasto") => void
  /** What the screen reader announces after a gesture. */
  anuncio: string
  /** The role that just changed position, so the row can settle. */
  movido: string | null
  /** The drag properties of a row. Empty without permission. */
  arrasto: (indice: number, role: string) => React.LiHTMLAttributes<HTMLLIElement>
  /** The index of the row being dragged, or null. */
  arrastado: number | null
  /** Where the arrows are stored, so focus returns to the same one after the row moves. */
  setaRef: (role: string, sentido: "subir" | "descer") => (botao: HTMLButtonElement | null) => void
}

/**
 * Whether this account can reorder roles in this channel: the
 * `reorderRoles` rule in the core (the founder and those with `admin`), and
 * a host that knows how. One place, so both editors ask the same question.
 *
 * Those who manage roles by delegation (`gerircargos`) do not reorder:
 * dragging the entire list touches roles above theirs, and the rule without
 * escalation does not allow it.
 */
export function podeOrdenarCargos(bridge: EnclaveBridge, channel: string, address: string | null): boolean {
  if (address === null || !bridge.channels.reorderRoles) return false
  if (bridge.channels.founder?.(channel) === address) return true
  return (bridge.channels.rolesFor?.(channel, address) ?? []).includes("admin")
}

/** Move element `de` to position `para`, without changing the original list. */
export function reordenar<T>(lista: readonly T[], de: number, para: number): T[] {
  const nova = [...lista]
  const [item] = nova.splice(de, 1)
  if (item === undefined) return nova
  nova.splice(Math.max(0, Math.min(para, nova.length)), 0, item)
  return nova
}

export function useOrdemDosCargos({
  ids,
  nomeDe,
  onOrdenar,
}: {
  /** The roles, in channel order (`compararCargos`). */
  ids: readonly string[]
  nomeDe: (role: string) => string
  /** The new order, top to bottom. Absent: cannot reorder. */
  onOrdenar?: ((ordem: string[]) => Promise<unknown> | void) | undefined
}): OrdemDosCargos {
  const [pedida, setPedida] = useState<string[] | null>(null)
  const [anuncio, setAnuncio] = useState("")
  const [movido, setMovido] = useState<string | null>(null)
  const [arrastado, setArrastado] = useState<number | null>(null)
  const aEnviar = useRef(false)
  const seguinte = useRef<string[] | null>(null)
  const setas = useRef(new Map<string, HTMLButtonElement>())
  const focar = useRef<{ role: string; sentido: "subir" | "descer" } | null>(null)

  // Only the requested order matters if it covers the same roles: a role
  // created or deleted in the meantime makes the channel order take effect again.
  const mesmos = pedida !== null && pedida.length === ids.length && pedida.every((role) => ids.includes(role))
  const ordem = mesmos ? pedida : ids

  const enviar = (lista: string[]): void => {
    if (!onOrdenar) return
    if (aEnviar.current) {
      seguinte.current = lista
      return
    }
    aEnviar.current = true
    let pedido: Promise<unknown> | void
    try {
      pedido = onOrdenar(lista)
    } catch {
      pedido = undefined
    }
    void Promise.resolve(pedido)
      .catch(() => {})
      .finally(() => {
        aEnviar.current = false
        const proxima = seguinte.current
        seguinte.current = null
        if (proxima) enviar(proxima)
        else setPedida(null)
      })
  }

  const mover = (de: number, para: number, comoFoi: "teclado" | "arrasto" = "teclado"): void => {
    if (!onOrdenar || para < 0 || para >= ordem.length || de === para) return
    const nova = reordenar(ordem, de, para)
    const role = ordem[de]
    if (role === undefined) return
    setPedida(nova)
    setMovido(role)
    setAnuncio(strings.cargosEPermissoes.posicaoNova(nomeDe(role), para + 1, nova.length))
    if (comoFoi === "teclado") {
      // The same arrow if still valid; at the top or bottom, the other one.
      const sentido = para < de ? "subir" : "descer"
      const noLimite = sentido === "subir" ? para === 0 : para === nova.length - 1
      focar.current = { role, sentido: noLimite ? (sentido === "subir" ? "descer" : "subir") : sentido }
    }
    enviar(nova)
  }

  /*
    The row moves in the DOM, and an element that leaves and re-enters loses
    focus. We return it to the arrow after React places the rows in their new
    positions.
    */
  useLayoutEffect(() => {
    const alvo = focar.current
    if (!alvo) return
    focar.current = null
    setas.current.get(`${alvo.role}:${alvo.sentido}`)?.focus()
  })

  const pode = onOrdenar !== undefined
  return {
    ordem,
    pode,
    mover,
    anuncio,
    movido,
    arrastado,
    arrasto: (indice, role) =>
      pode
        ? {
            draggable: true,
            onDragStart: (evento) => {
              setArrastado(indice)
              evento.dataTransfer.effectAllowed = "move"
              evento.dataTransfer.setData("text/plain", role)
            },
            onDragOver: (evento) => {
              if (arrastado !== null) evento.preventDefault()
            },
            onDrop: (evento) => {
              evento.preventDefault()
              if (arrastado !== null) mover(arrastado, indice, "arrasto")
              setArrastado(null)
            },
            onDragEnd: () => setArrastado(null),
            // Settled: the next time this row moves, the animation runs again.
            onAnimationEnd: () => setMovido(null),
          }
        : { draggable: false },
    setaRef: (role, sentido) => (botao) => {
      const chave = `${role}:${sentido}`
      if (botao) setas.current.set(chave, botao)
      else setas.current.delete(chave)
    },
  }
}

/** The arrows on a row: "Up" and "Down", with the role name for screen readers. */
export function SetasDaOrdem({
  ordem,
  role,
  nome,
  indice,
}: {
  ordem: OrdemDosCargos
  role: string
  nome: string
  indice: number
}): React.JSX.Element | null {
  if (!ordem.pode) return null
  const t = strings.cargosEPermissoes
  return (
    <span className="cep-setas">
      <button
        type="button"
        ref={ordem.setaRef(role, "subir")}
        aria-label={t.subir(nome)}
        title={t.subir(nome)}
        disabled={indice === 0}
        onClick={() => ordem.mover(indice, indice - 1)}
      >
        ↑
      </button>
      <button
        type="button"
        ref={ordem.setaRef(role, "descer")}
        aria-label={t.descer(nome)}
        title={t.descer(nome)}
        disabled={indice === ordem.ordem.length - 1}
        onClick={() => ordem.mover(indice, indice + 1)}
      >
        ↓
      </button>
    </span>
  )
}

/** The drag handle. Mouse and touch only: keyboard users have the arrows. */
export function PegaDaOrdem({ ordem, nome }: { ordem: OrdemDosCargos; nome: string }): React.JSX.Element | null {
  if (!ordem.pode) return null
  return (
    <span className="cep-pega" aria-hidden="true" title={strings.cargosEPermissoes.arrastar(nome)}>
      ⋮⋮
    </span>
  )
}

/** The screen reader notice: the role's new position, announced once. */
export function AnuncioDaOrdem({ ordem }: { ordem: OrdemDosCargos }): React.JSX.Element {
  return (
    <p className="sr-only" aria-live="polite" role="status">
      {ordem.anuncio}
    </p>
  )
}

/** The classes on a row: the one being dragged faded, the one that moved settling. */
export function classesDaLinha(ordem: OrdemDosCargos, base: string, indice: number, role: string): string {
  return [base, ordem.arrastado === indice ? "cep-arrastado" : "", ordem.movido === role ? "cep-assenta" : ""]
    .filter(Boolean)
    .join(" ")
}
