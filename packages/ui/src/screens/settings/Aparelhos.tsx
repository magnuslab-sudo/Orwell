import { useCallback, useEffect, useState } from "react"
import { useBridge } from "../../App.js"
import type { AparelhoDaConta } from "../../bridge.js"
import { Button } from "../../components/Button.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { useToast } from "../../components/Toast.js"
import { useConfirmar } from "../../hooks/useConfirmar.js"
import { formatShortDate } from "../../lib/format.js"
import { strings, traduzirErro } from "../../strings.js"
import { AcrescentarAparelho } from "./AcrescentarAparelho.js"
import { JuntarContas } from "./JuntarContas.js"

/** What we know of the account and server, to decide which buttons to show. */
interface EstadoDaConta {
  temChaveDeConta: boolean
  servidorSuporta: boolean
  servidorRevoga?: boolean
}

/** A device revocation, while running or after failure. */
type Revogacao = { deviceKey: string; que: "a-revogar" } | { deviceKey: string; que: "falhou"; erro: string }

/**
 * The "Devices" section of Settings: the devices on this account, the button
 * to add one, and "Revoke" on each of the others.
 *
 * The list is the manifest, and shows what it has: the date each device was
 * added and a key digest. No names, and none are invented. This device shows
 * marked.
 *
 * Add only shows to those who have the account key AND are on a server that
 * knows how to pair. Revoke only shows to those who have the account key AND
 * are on a server that knows how to revoke (`device-revocation`), and never on
 * the device itself. When it does not show, we say why.
 *
 * Revoke asks first ("Confirm", with the honest phrase: what was read stays
 * read), shows progress in the device line, and an error stays in the line,
 * with code.
 *
 * **A revocation partway.** Two errors say the device is already marked as
 * revoked in the vault and repeating finishes the work: the server with no
 * answer to the manifest (746 with `reason: "no-answer"`) and channels to finish
 * (747). The device stays in the list with the "revoking" label and the button,
 * even if the new manifest no longer brings it. Only on this screen visit: the
 * bridge does not say who is marked in the vault.
 */

/** The error says the device is marked in the vault, and repeating fixes it. */
function ficouMarcado(erro: Error): boolean {
  if (erro.message === "device-revoke-incomplete") return true
  const causa = erro.cause as { reason?: unknown } | undefined
  return erro.message === "device-revoke-manifest-refused" && causa?.reason === "no-answer"
}
export function Aparelhos(): React.JSX.Element {
  const bridge = useBridge()
  const toast = useToast()
  const confirmar = useConfirmar()
  const [aparelhos, setAparelhos] = useState<AparelhoDaConta[] | null | undefined>(undefined)
  const [estado, setEstado] = useState<EstadoDaConta | null>(null)
  const [aAcrescentar, setAAcrescentar] = useState(false)
  /** "Merge another account" open (phase 8.2). */
  const [aJuntar, setAJuntar] = useState(false)
  const podeJuntar = bridge.pairing?.juntar !== undefined
  const [revogacao, setRevogacao] = useState<Revogacao | null>(null)
  /** Devices marked as revoked that still need retry. See `ficouMarcado`. */
  const [marcados, setMarcados] = useState<ReadonlyMap<string, AparelhoDaConta>>(new Map())

  const recarregar = useCallback((): void => {
    if (!bridge.pairing) return
    void bridge.pairing
      .devices()
      .then(setAparelhos)
      .catch(() => setAparelhos(null))
    void bridge.pairing
      .status()
      .then(setEstado)
      .catch(() => setEstado(null))
  }, [bridge])

  useEffect(recarregar, [recarregar])

  const podeAcrescentar = estado?.temChaveDeConta === true && estado.servidorSuporta
  const revogar = bridge.pairing?.revoke
  const podeRevogar = estado?.temChaveDeConta === true && estado.servidorRevoga === true && revogar !== undefined
  const aRevogar = revogacao?.que === "a-revogar"

  const pedirRevogacao = (aparelho: AparelhoDaConta): void => {
    if (!revogar || aRevogar || aparelho.esteAparelho) return
    void confirmar({
      titulo: strings.settings.revokeTitle,
      corpo: strings.settings.revokeBody,
      verbo: strings.settings.revoke,
      destructive: true,
    }).then((sim) => {
      if (!sim) return
      setRevogacao({ deviceKey: aparelho.deviceKey, que: "a-revogar" })
      revogar(aparelho.deviceKey)
        .then(() => {
          setRevogacao(null)
          setMarcados((antes) => {
            const depois = new Map(antes)
            depois.delete(aparelho.deviceKey)
            return depois
          })
          toast(strings.settings.revoked)
        })
        .catch((erro: Error) => {
          if (ficouMarcado(erro)) setMarcados((antes) => new Map(antes).set(aparelho.deviceKey, aparelho))
          setRevogacao({ deviceKey: aparelho.deviceKey, que: "falhou", erro: traduzirErro(erro) })
        })
        // The manifest may have gone out even with a channel to finish (747): the
        // list always rereads.
        .finally(recarregar)
    })
  }

  return (
    <>
      <section className="card settings-card">
        <h2>{strings.settings.devices}</h2>
        <p className="field-note">{strings.settings.devicesLead}</p>
        {/* Phase 8.1: said here, where the second device is added, so no one
            creates a new account on it. The same phrase from "How it works". */}
        <p className="field-note">{strings.comoFunciona.umaContaChega}</p>
        {aparelhos === null && <p className="field-note">{strings.settings.devicesUnknown}</p>}
        {aparelhos && aparelhos.length > 0 && (
          <ul className="aparelhos-lista">
            {[...aparelhos, ...[...marcados.values()].filter((m) => !aparelhos.some((a) => a.deviceKey === m.deviceKey))]
              .sort((a, b) => a.addedAt - b.addedAt)
              .map((aparelho) => {
                const desta = revogacao?.deviceKey === aparelho.deviceKey ? revogacao : null
                return (
                  <li key={aparelho.deviceKey} className={aparelho.esteAparelho ? "este" : undefined}>
                    <span>
                      {strings.settings.deviceAddedAt(formatShortDate(aparelho.addedAt * 1000))}
                      {aparelho.esteAparelho ? ` (${strings.settings.thisDevice})` : ""}
                      {marcados.has(aparelho.deviceKey) ? ` (${strings.settings.revokePending})` : ""}
                    </span>
                    <code title={aparelho.deviceKey}>{aparelho.deviceKey.slice(0, 12)}</code>
                    {podeRevogar && aparelho.esteAparelho && <p className="field-note">{strings.settings.revokeSelf}</p>}
                    {podeRevogar && !aparelho.esteAparelho && (
                      <div className="aparelho-accoes">
                        <Button
                          variant="danger"
                          disabled={aRevogar}
                          onClick={() => pedirRevogacao(aparelho)}
                          ariaLabel={`${strings.settings.revoke} ${aparelho.deviceKey.slice(0, 12)}`}
                        >
                          {strings.settings.revoke}
                        </Button>
                      </div>
                    )}
                    {desta?.que === "a-revogar" && (
                      <p className="field-note" role="status">
                        {strings.settings.revoking}
                      </p>
                    )}
                    {desta?.que === "falhou" && (
                      <p className="error" role="alert">
                        <TextoDeErro texto={desta.erro} />
                      </p>
                    )}
                  </li>
                )
              })}
          </ul>
        )}
        {estado !== null && !estado.temChaveDeConta && <p className="field-note warn">{strings.pairing.noAccountKey}</p>}
        {estado !== null && estado.temChaveDeConta && !estado.servidorSuporta && (
          <p className="field-note">{strings.pairing.serverUnsupported}</p>
        )}
        {podeAcrescentar && (
          <Button variant="primary" onClick={() => setAAcrescentar(true)}>
            {strings.settings.addDevice}
          </Button>
        )}
        {podeRevogar && <p className="field-note">{strings.settings.revokeHonest}</p>}
        {/* Phase 8.2: the extra account merges with the main one and exits this device. */}
        {podeJuntar && (
          <div className="aparelhos-juntar">
            <p className="field-note">{strings.juntar.entradaNota}</p>
            <Button variant="ghost" onClick={() => setAJuntar(true)}>
              {strings.juntar.entrada}
            </Button>
          </div>
        )}
        {estado !== null && estado.temChaveDeConta && estado.servidorRevoga !== true && (
          <p className="field-note">{strings.settings.revokeServerUnsupported}</p>
        )}
      </section>

      {/* The sheet mounts beside the card: the card glass (`backdrop-filter`)
          pinned it to its box. */}
      {aAcrescentar && (
        <AcrescentarAparelho
          onClose={() => {
            setAAcrescentar(false)
            recarregar()
          }}
          onConcluido={recarregar}
        />
      )}
      {aJuntar && (
        <JuntarContas
          onClose={() => setAJuntar(false)}
          // The device changed account (or is locked): full reload, like after
          // "Delete account". Nothing from the old account stays on screen.
          onDone={() => window.location.reload()}
        />
      )}
    </>
  )
}
