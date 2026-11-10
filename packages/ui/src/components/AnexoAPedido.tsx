import { createContext, useContext, useState } from "react"
import { BridgeContext } from "../App.js"
import type { DesfechoDoAnexo } from "../bridge.js"
import { descarregar } from "../lib/ficheiros.js"
import { strings } from "../strings.js"
import type { MediaItem } from "../types.js"
import { dimensoesDaImagem, reserva } from "../lib/dimensoesDaImagem.js"

/**
 * Which message or post owns the attachments drawn here (S5, §5.4): the
 * channel, the `id`, and the ORIGINAL attachment list (an attachment's
 * position in it is what the core asks for). The message drawer sets it; the
 * grid and file list read it. Without it, an attachment with no bytes is just
 * the usual marker (the profile sheet, for example).
 */
export const AnexosDoItem = createContext<{ channel: string; alvo: string; lista: readonly MediaItem[] } | null>(null)

type Motivo = Exclude<DesfechoDoAnexo, { ok: true }>["motivo"]
type Estado = { fase: "parado" } | { fase: "a-pedir" } | { fase: "chegou"; item: MediaItem } | { fase: "falhou"; motivo: Motivo }

/** The message for a request that yielded no bytes. None of these are errors with a code: they are limits. */
export function fraseDoMotivo(motivo: Motivo, ficheiro: boolean): string {
  switch (motivo) {
    case "recusado":
      return strings.sincronia.anexoRecusado
    case "sem-ligacao":
      return strings.sincronia.anexoSemLigacao
    default:
      return ficheiro ? strings.sincronia.anexoFicheiroNinguem : strings.sincronia.anexoNinguem
  }
}

/**
 * Request the bytes for `item`, if there is a path: the bridge and the context.
 * `cancel` only exists if the bridge allows it. A cancelled request, or one that
 * did not fit in the core's queue, goes back to the start: the request button.
 */
export function usePedirAnexo(item: MediaItem): {
  pode: boolean
  estado: Estado
  pedir: () => Promise<MediaItem | null>
  cancelar: (() => void) | null
} {
  // Direct context, not `useBridge`, which throws without a provider: this piece
  // also renders where there is no bridge (component tests, the profile sheet).
  const bridge = useContext(BridgeContext)
  const doItem = useContext(AnexosDoItem)
  const [estado, setEstado] = useState<Estado>({ fase: "parado" })
  const indice = doItem ? doItem.lista.indexOf(item) : -1
  const pode = Boolean(bridge?.anexo && doItem && indice >= 0)
  const pedir = async (): Promise<MediaItem | null> => {
    if (!bridge?.anexo || !doItem || indice < 0) return null
    setEstado({ fase: "a-pedir" })
    const desfecho = await bridge.anexo
      .pedir({ channel: doItem.channel, alvo: doItem.alvo, indice })
      .catch((): DesfechoDoAnexo => ({ ok: false, motivo: "ninguem" }))
    if (!desfecho.ok) {
      if (desfecho.motivo === "cancelado" || desfecho.motivo === "por-pedir") setEstado({ fase: "parado" })
      else setEstado({ fase: "falhou", motivo: desfecho.motivo })
      return null
    }
    const chegou = desfecho.anexo as MediaItem
    setEstado({ fase: "chegou", item: chegou })
    return chegou
  }
  const cancelar =
    bridge?.anexo?.cancelar && doItem && indice >= 0
      ? (): void => {
          void bridge.anexo?.cancelar?.({ channel: doItem.channel, alvo: doItem.alvo, indice }).catch(() => false)
        }
      : null
  return { pode, estado, pedir, cancelar }
}

/** The "Try again" button for a failed request. */
function TentarOutraVez({ pedir }: { pedir: () => Promise<unknown> }): React.JSX.Element {
  return (
    <button type="button" className="ghost" onClick={() => void pedir()}>
      {strings.sincronia.anexoTentarOutraVez}
    </button>
  )
}

/** The "Cancel" button for a running or queued request. */
function Cancelar({ cancelar }: { cancelar: () => void }): React.JSX.Element {
  return (
    <button type="button" className="ghost" onClick={cancelar}>
      {strings.sincronia.anexoCancelar}
    </button>
  )
}

/**
 * An image where this device has only the name (S5, §5.4). Bytes do not come
 * with the channel: they are requested when the user opens it, from other members, and only
 * show after verification against the author's signature (in the core). If
 * no one has it, we say so with the message from §2.5.
 */
export function ImagemAPedido({
  item,
  className = "media-evicted",
  onOpen,
}: {
  item: MediaItem
  className?: string
  onOpen?: ((item: MediaItem) => void) | undefined
}): React.JSX.Element {
  const { pode, estado, pedir, cancelar } = usePedirAnexo(item)
  if (estado.fase === "chegou") {
    const src = estado.item.inline ?? estado.item.url
    // The same reserved box from the grid: see `PostImages` and `dimensoesDaImagem`.
    const d = dimensoesDaImagem(src)
    const imagem = <img src={src} alt={estado.item.name ?? ""} {...(d ? { width: d.largura, height: d.altura } : {})} />
    if (!onOpen) return imagem
    return (
      <button type="button" className="image-open" title={strings.social.viewImage} style={reserva(d)} onClick={() => onOpen(estado.item)}>
        {imagem}
      </button>
    )
  }
  if (!pode) {
    return (
      <span className={className} role="img" aria-label={strings.common.mediaEvicted}>
        {strings.common.mediaEvicted}
      </span>
    )
  }
  if (estado.fase === "falhou") {
    return (
      <span className={`${className} anexo-a-pedido anexo-falhou`}>
        <span role="status">{fraseDoMotivo(estado.motivo, false)}</span>
        <TentarOutraVez pedir={pedir} />
      </span>
    )
  }
  if (estado.fase === "a-pedir" && cancelar) {
    return (
      <span className={`${className} anexo-a-pedido`} aria-busy="true">
        <span>{strings.common.mediaEvicted}</span>
        <span className="anexo-a-pedido-accao">{strings.sincronia.anexoAPedir}</span>
        <Cancelar cancelar={cancelar} />
      </span>
    )
  }
  return (
    <button
      type="button"
      className={`${className} anexo-a-pedido`}
      disabled={estado.fase === "a-pedir"}
      onClick={() => void pedir()}
      aria-label={`${strings.common.mediaEvicted}. ${strings.sincronia.anexoPedir}`}
    >
      <span>{strings.common.mediaEvicted}</span>
      <span className="anexo-a-pedido-accao">
        {estado.fase === "a-pedir" ? strings.sincronia.anexoAPedir : strings.sincronia.anexoPedir}
      </span>
    </button>
  )
}

/**
 * The same for a file: the line shows what it was and offers to request the bytes.
 * When they arrive, save them to disk, like the button always does.
 */
export function FicheiroAPedido({ item, nome }: { item: MediaItem; nome: string }): React.JSX.Element | null {
  const { pode, estado, pedir, cancelar } = usePedirAnexo(item)
  if (!pode) return null
  const pedirEGravar = (): Promise<void> =>
    pedir().then((chegou) => {
      const bytes = chegou?.inline ?? chegou?.url
      if (bytes) {
        try {
          descarregar(bytes, nome)
        } catch {
          // Bytes verified and unreadable: nothing to save.
        }
      }
    })
  if (estado.fase === "falhou") {
    return (
      <>
        <span className="file-meta anexo-falhou" role="status">
          {fraseDoMotivo(estado.motivo, true)}
        </span>
        <TentarOutraVez pedir={pedirEGravar} />
      </>
    )
  }
  return (
    <>
      <button
        type="button"
        className="file-get anexo-a-pedido"
        disabled={estado.fase === "a-pedir"}
        onClick={() => void pedirEGravar()}
      >
        {estado.fase === "a-pedir" ? strings.sincronia.anexoAPedir : strings.sincronia.anexoPedir}
      </button>
      {estado.fase === "a-pedir" && cancelar && <Cancelar cancelar={cancelar} />}
    </>
  )
}
