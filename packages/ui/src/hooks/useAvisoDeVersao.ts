import { useCallback, useEffect, useRef, useState } from "react"
import type { AvisoDeActualizacao, EnclaveBridge } from "../bridge.js"
import { recordDiagnostic } from "../lib/diagnostics.js"
import { tocarSomDeActualizacao } from "../sons/motor.js"

/**
 * Ask ONCE, after login, if this app version is behind.
 *
 * ## When, and why after login and not at startup
 *
 * The owner asked "notify those who already have the system installed, or check at login".
 * It is at login, for three reasons that all point to the same place:
 *
 *  - **someone unlocking the vault does not want to read about versions.** A card
 *    appearing above the password field is an interruption at the only moment when
 *    the user is doing something for real;
 *  - **the network is usually up at that point**, because the session just connected.
 *    Asking before then wastes the only attempt at the worst moment;
 *  - **it is a signal per session not per startup**, which is already the quieter half
 *    of "once per version". The other half is `dismiss`, which survives restarts because
 *    it is written to disk in the main process.
 *
 * ## Once, and once for real
 *
 * `pedido` is a reference not state: in strict mode React mounts, unmounts and remounts
 * each effect, and without this guard startup in development made two requests to orwell.pt
 * on each login. With it, the second passes by.
 *
 * ## None of this updates anything
 *
 * The action out of here is `open`, and what it does is open the download page in the
 * system browser. Windows automatic update happens first, on the startup screen, with our
 * Ed25519 signature (`apps/client/src/main/actualizacao-windows.ts`); this notification
 * sits as a backup for when it cannot run, and is the only path on macOS.
 *
 * In the browser `bridge.actualizacao` does not exist, so this never asks anyone anything:
 * a page does not fall behind.
 */
export function useAvisoDeVersao(
  bridge: EnclaveBridge,
  /** Only after the user logs in. See the note above. */
  entrou: boolean,
): {
  aviso: AvisoDeActualizacao | null
  /** Open the download page, and get the card out of the way. */
  descarregar: () => void
  /** Stop warning about this version. It gets written and survives restarts. */
  dispensar: () => void
} {
  const [aviso, setAviso] = useState<AvisoDeActualizacao | null>(null)
  const pedido = useRef(false)

  /** The bridge by reference, like in `useLatencia`: a host that recreates it on
   *  every render cannot turn this into a request per loop. */
  const ponte = useRef(bridge)
  ponte.current = bridge

  useEffect(() => {
    if (!entrou || pedido.current) return
    const anfitriao = ponte.current.actualizacao
    if (!anfitriao) return
    pedido.current = true

    /*
      The outcome of automatic startup update (Windows), for "Send report". Whoever saw it
      fail was the startup screen, which already closed; without this line the failure would
      sit in a file nobody reads.
    */
    void anfitriao
      .diagnostico?.()
      .then((desfecho) => {
        if (!desfecho) return
        recordDiagnostic({
          kind: "action",
          code: "actualizacao-windows",
          outcome: desfecho.codigo,
          ...(desfecho.versao ? { detail: desfecho.versao } : {}),
        })
      })
      .catch(() => {
        // A `preload` with no channel on the other side. Nothing to register.
      })

    let vivo = true
    void anfitriao
      .verificar()
      .then((novo) => {
        if (!vivo) return
        setAviso(novo)
        // The card arrives, and the sound with it (phase 4). Once per version: the main process
        // `dismiss` no longer returns a dismissed version.
        if (novo) tocarSomDeActualizacao()
      })
      .catch(() => {
        /*
          The bridge already promises not to throw, and this is here anyway: between the
          `preload` and this file there is an IPC, and an `invoke` with no handler on the
          other side rejects. It is exactly what happens with a `preload` from another
          version, which is the case this feature exists to solve. An update notification
          that crashes the app login would be in poor taste.
          */
      })

    return () => {
      vivo = false
    }
  }, [entrou])

  const descarregar = useCallback(() => {
    // Close the card without dismissing the version: whoever went to download does not need to
    // keep seeing the notification, and if they do not manage to install they will see it again
    // on the next startup. It fails in the right direction.
    setAviso(null)
    void ponte.current.actualizacao?.abrir().catch(() => {
      // No browser, or the system refusing. Nothing to tell anyone: the page is written in the
      // card the user just saw.
    })
  }, [])

  const dispensar = useCallback(() => {
    const versao = aviso?.disponivel
    setAviso(null)
    if (versao) void ponte.current.actualizacao?.dispensar(versao).catch(() => {})
  }, [aviso])

  return { aviso, descarregar, dispensar }
}
