import { useBridge } from "../../App.js"
import { ConfirmarDestruicao } from "../../components/ConfirmarDestruicao.js"
import { useToast } from "../../components/Toast.js"
import { strings } from "../../strings.js"

/**
 * The last confirmation before the only gesture in the interface with no undo.
 *
 * Everything else called administration here is convention: inviting, renaming
 * and moving travel encrypted and are carried out by the other person's client,
 * by their choice. Removing someone is not. It advances the epoch and removes
 * keys, the removed person stops decrypting what comes next, and there is no
 * gesture from either side that can undo it. They come back with a new invite
 * or they do not come back.
 *
 * That is why it asks for the name written out, like the button that deletes
 * the account. It is not ceremony for its own sake: a dialog where you tap
 * without reading is no barrier against a habit, and this is the act where
 * getting the person wrong costs the most. The choice is the owner's, made on
 * August 12, 2026 from three designs.
 *
 * The comparison is loose on purpose, without capitals and without spaces
 * around it: see `ConfirmarDestruicao`. A network failure stays on the sheet,
 * with the reason, and the name stays written to try again.
 */
export function ExpelModal({
  who,
  channel,
  name,
  onClose,
}: {
  who: string
  channel: string
  /** Already resolved by the shell: the published name, or the abbreviated address. */
  name: string
  onClose: () => void
}): React.JSX.Element {
  const bridge = useBridge()
  const toast = useToast()

  // The sheet is the common one for written text (`ConfirmarDestruicao`), the
  // same as deleting the account: the same card, the same Cancel, the verb in red.
  const expulsar = async (): Promise<void> => {
    const gesto = bridge.channels.expel
    if (!gesto) {
      // An old host does not bring the gesture. The menu entry should not have
      // appeared; if it did, say it instead of doing nothing.
      toast(strings.common.unsupported, "error")
      onClose()
      return
    }
    await gesto(channel, who)
    toast(strings.userMenu.expelDone(name))
    onClose()
  }

  return (
    <ConfirmarDestruicao
      titulo={strings.userMenu.expelTitle(name)}
      avisos={[strings.userMenu.expelBody]}
      rotuloDoCampo={strings.userMenu.expelConfirmLabel(name)}
      palavra={name}
      verbo={strings.userMenu.expelConfirm}
      verboDepoisDeFalhar={strings.userMenu.expelConfirm}
      fazer={expulsar}
      onClose={onClose}
    />
  )
}
