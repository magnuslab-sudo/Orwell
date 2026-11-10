import { useCallback, useEffect, useRef } from "react"
import type { ComandoGlobal, EnclaveBridge, EstadoDosAtalhosGlobais } from "../bridge.js"
import type { AccaoDeVoz, MapaDeAtalhos } from "../lib/atalhosDeVoz.js"

const NENHUM: ReadonlySet<AccaoDeVoz> = new Set()

/** What comes back from the main process, verified: an error envelope or a malformed shape counts as "not registered". */
function estadoDe(cru: unknown): EstadoDosAtalhosGlobais {
  const lista = (valor: unknown): ComandoGlobal[] =>
    Array.isArray(valor)
      ? valor.filter((v): v is ComandoGlobal => v === "microfone" || v === "som" || v === "overlay")
      : []
  const objecto = (cru ?? {}) as Record<string, unknown>
  return {
    globais: lista(objecto.globais),
    soComAJanela: lista(objecto.soComAJanela),
    ocupados: lista(objecto.ocupados),
    faltaAcessibilidade: lista(objecto.faltaAcessibilidade),
  }
}

/**
 * Global keyboard shortcuts for the desktop app: registered when entering a call,
 * released when exiting (see `apps/client/src/main/atalhos.ts` for the reason).
 *
 * Returns a function that tells which commands are global NOW, so
 * `useAtalhos` does not handle them again with the window in focus.
 *
 * In the browser `ponte` does not exist and this does nothing.
 */
export function useAtalhosGlobais(opcoes: {
  ponte: EnclaveBridge["atalhosGlobais"]
  emChamada: boolean
  mapa: MapaDeAtalhos
  /** `overlay` only when there is a game overlay: without it, its shortcut is not requested from the system. */
  accoes: { microfone: () => void; som: () => void; overlay?: (() => void) | undefined }
  /** What the main process managed to register, after each request made during a call. */
  aoRegistar?: (estado: EstadoDosAtalhosGlobais) => void
}): () => ReadonlySet<AccaoDeVoz> {
  const { ponte, emChamada } = opcoes
  const globais = useRef<ReadonlySet<AccaoDeVoz>>(NENHUM)
  const accoes = useRef(opcoes.accoes)
  accoes.current = opcoes.accoes
  const aoRegistar = useRef(opcoes.aoRegistar)
  aoRegistar.current = opcoes.aoRegistar
  // If there are globals requested from the main process. Without this, every mount outside a
  // call would send a `definir(null)` that releases nothing.
  const pedidos = useRef(false)

  useEffect(() => {
    if (!ponte) return
    return ponte.aoAccionar((accao) => accoes.current[accao]?.())
  }, [ponte])

  const microfone = opcoes.mapa.microfone
  const som = opcoes.mapa.som
  const comOverlay = opcoes.accoes.overlay !== undefined
  const overlay = opcoes.mapa.overlay
  useEffect(() => {
    if (!ponte) return
    if (!emChamada && !pedidos.current) return
    pedidos.current = emChamada
    if (!emChamada) globais.current = NENHUM
    let vivo = true
    ponte
      .definir(emChamada ? { microfone, som, ...(comOverlay ? { overlay } : {}) } : null)
      .then((cru) => {
        if (!vivo) return
        const estado = estadoDe(cru)
        globais.current = new Set(estado.globais)
        if (emChamada) aoRegistar.current?.(estado)
      })
      .catch(() => {
        // With no response from the main process, the focused window handles everything: this is what
        // existed before 1.0.6, not a surprise.
        if (vivo) globais.current = NENHUM
      })
    return () => {
      vivo = false
    }
  }, [ponte, emChamada, microfone, som, comOverlay, overlay])

  // On unmount (session close) releases the key if it was requested.
  useEffect(() => {
    return () => {
      if (ponte && pedidos.current) {
        pedidos.current = false
        void ponte.definir(null).catch(() => {})
      }
    }
  }, [ponte])

  return useCallback(() => globais.current, [])
}
