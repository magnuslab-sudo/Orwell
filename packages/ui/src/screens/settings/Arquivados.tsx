import { useEffect, useState } from "react"
import { useBridge } from "../../App.js"
import { Button } from "../../components/Button.js"
import { useToast } from "../../components/Toast.js"
import { useConfirmar } from "../../hooks/useConfirmar.js"
import { formatStamp, shortAddress, shortName } from "../../lib/format.js"
import { strings, traduzirErro } from "../../strings.js"
import type { StoredChatMessage } from "@enclave/client-core"

/**
 * The channels this account was removed from, and what is left of them here.
 *
 * Being removed from a channel stops giving keys for what comes next, but what
 * was already read stays in this device's vault (`archivedChannels`, in the
 * core). This section shows it, read-only, and lets you delete it for good.
 * Delete is the only action, and it asks first: it cannot be undone, and there
 * is no other copy.
 *
 * Without `channels.archived` in the bridge (an old host) the section says
 * there is nothing, which is what that host knows.
 */
/** The text of a saved entry, when it has any. */
function textoDe(mensagem: StoredChatMessage): string {
  const corpo = (mensagem.payload as { body?: unknown }).body
  return typeof corpo === "string" ? corpo : ""
}

export function Arquivados(): React.JSX.Element {
  const bridge = useBridge()
  const toast = useToast()
  const confirmar = useConfirmar()
  /** Null while the list is not here. */
  const [lista, setLista] = useState<{ channel: string; archivedAt: number }[] | null>(null)
  const [aberto, setAberto] = useState<{ channel: string; mensagens: StoredChatMessage[] } | null>(null)

  useEffect(() => {
    let vivo = true
    const ler = bridge.channels.archived
    if (!ler) {
      setLista([])
      return
    }
    void ler()
      .then((arquivados) => {
        if (vivo) setLista([...arquivados].sort((a, b) => b.archivedAt - a.archivedAt))
      })
      .catch(() => {
        if (vivo) setLista([])
      })
    return () => {
      vivo = false
    }
  }, [bridge])

  const ver = (channel: string): void => {
    if (aberto?.channel === channel) {
      setAberto(null)
      return
    }
    void bridge.channels
      .history(channel)
      .then((mensagens) => setAberto({ channel, mensagens }))
      .catch((error: Error) => toast(traduzirErro(error), "error"))
  }

  const apagar = (channel: string): void => {
    void confirmar({
      titulo: strings.arquivados.apagarTitulo(shortName(channel)),
      corpo: strings.arquivados.apagarCorpo,
      verbo: strings.arquivados.apagar,
      destructive: true,
    })
      .then(async (sim) => {
        if (!sim) return
        await bridge.channels.forget(channel)
        setLista((actual) => actual?.filter((entrada) => entrada.channel !== channel) ?? null)
        if (aberto?.channel === channel) setAberto(null)
        toast(strings.arquivados.apagado)
      })
      .catch((error: Error) => toast(traduzirErro(error), "error"))
  }

  return (
    <section className="card settings-card arquivados">
      <h2>{strings.arquivados.titulo}</h2>
      <p className="field-note">{strings.arquivados.nota}</p>
      {lista !== null && lista.length === 0 && <p className="field-note">{strings.arquivados.vazio}</p>}
      {lista !== null && lista.length > 0 && (
        <ul className="arquivados-lista">
          {lista.map(({ channel, archivedAt }) => (
            <li key={channel} className="arquivado">
              <div className="arquivado-linha">
                <span className="arquivado-nome">
                  {shortName(channel)}
                  <span className="field-note"> · {strings.arquivados.desde(formatStamp(archivedAt))}</span>
                </span>
                <Button variant="ghost" type="button" onClick={() => ver(channel)}>
                  {aberto?.channel === channel ? strings.arquivados.esconder : strings.arquivados.ver}
                </Button>
                <Button variant="ghost" type="button" className="danger" onClick={() => apagar(channel)}>
                  {strings.arquivados.apagar}
                </Button>
              </div>
              {/* Read-only: a channel you left is not writable. Text, and never
                  markup: a message is data. */}
              {aberto?.channel === channel && (
                <ol className="arquivado-historico" aria-label={strings.arquivados.historicoDe(shortName(channel))}>
                  {aberto.mensagens.filter((m) => textoDe(m) !== "").length === 0 ? (
                    <li className="field-note">{strings.arquivados.semMensagens}</li>
                  ) : (
                    aberto.mensagens
                      .filter((m) => textoDe(m) !== "")
                      .map((m) => (
                        <li key={`${m.seq}:${m.sender}`}>
                          <span className="arquivado-autor">{shortAddress(m.sender)}</span>{" "}
                          <span>{textoDe(m)}</span>
                        </li>
                      ))
                  )}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
