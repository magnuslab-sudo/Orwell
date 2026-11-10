import { useContext, useEffect, useState } from "react"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastContext } from "../../components/Toast.js"
import { ehIos } from "../../lib/plataforma.js"
import { strings } from "../../strings.js"

/** What the gate knows about the vault and the platform. */
export type EstadoDoPortao = Awaited<ReturnType<EnclaveBridge["vault"]["status"]>>

/**
 * The vault state, read once on mount. A bridge that fails or does not report
 * it (a `preload` from another version, an old test) gives `null`, and the
 * screen stays as it always was: no checkbox.
 */
export function useEstadoDoCofre(bridge: EnclaveBridge): EstadoDoPortao | null {
  const [estado, setEstado] = useState<EstadoDoPortao | null>(null)
  useEffect(() => {
    let vivo = true
    void Promise.resolve()
      .then(() => bridge.vault.status())
      .then((lido) => {
        if (vivo && lido) setEstado(lido)
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [bridge])
  return estado
}

/**
 * Does the "Remember session" checkbox appear? Only when the bridge knows how
 * to remember, the platform has storage, and the vault (if it already exists)
 * has a password.
 */
export function podeMemorizar(bridge: EnclaveBridge, estado: EstadoDoPortao | null): boolean {
  return Boolean(bridge.vault.memorizar && estado?.memoriaDisponivel && estado.protection !== "os")
}

/**
 * Remembers after unlocking. A failure does not block entry: it reports, and
 * continues (plan, section 4). Without `ToastProvider` on top (some gate tests),
 * the failure stays silent.
 */
export function useMemorizarDepoisDeAbrir(bridge: EnclaveBridge): (ligada: boolean) => Promise<void> {
  const toast = useContext(ToastContext)
  return async (ligada) => {
    if (!ligada || !bridge.vault.memorizar) return
    try {
      await bridge.vault.memorizar(true)
    } catch {
      toast?.(strings.gate.memorizarFalhou, "error")
    }
  }
}

/**
 * The checkbox, below the password. Enabled by default (owner decision 1).
 * The note states the price in full: whoever uses the unlocked device enters.
 */
export function CaixaMemorizar({
  ligada,
  onMudar,
}: {
  ligada: boolean
  onMudar: (ligada: boolean) => void
}): React.JSX.Element {
  return (
    <div className="memorizar-sessao">
      <label className="checkbox">
        <input type="checkbox" name="memorizar" checked={ligada} onChange={(event) => onMudar(event.target.checked)} />
        {strings.gate.memorizar}
      </label>
      {ligada && (
        <p className="field-note">
          {strings.gate.memorizarNota}
          {ehIos() && <> {strings.gate.memorizarNotaIos}</>}
        </p>
      )}
    </div>
  )
}
