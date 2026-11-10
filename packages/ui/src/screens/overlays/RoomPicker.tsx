import { useId } from "react"
import { Button } from "../../components/Button.js"
import { RoomIcon } from "../../components/RoomIcon.js"
import { Modal } from "../../components/Modal.js"
import { strings } from "../../strings.js"

/**
 * Choose the channel to invite someone to, and nothing else.
 *
 * It used to invite on tap, on a path of its own. Now it only chooses: the
 * invite happens on the single form (`ConvidarSheet`), which opens next with
 * the channel and person filled in. Feeds and direct chats never show: one is
 * channeling, the other is already theirs.
 */
export function RoomPicker({
  rooms,
  labelFor,
  iconFor,
  preferido,
  onPick,
  onCancel,
}: {
  rooms: string[]
  /**
   * The channel where the person was found, if there is one: it comes first
   * and checked, because that is almost always the one you want.
   */
  preferido?: string | undefined
  labelFor: (channel: string) => string
  /** Published icon for the channel, if any. See `space.meta`. */
  iconFor?: ((channel: string) => string | undefined) | undefined
  onPick: (channel: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const heading = useId()
  const ordem = preferido && rooms.includes(preferido) ? [preferido, ...rooms.filter((r) => r !== preferido)] : rooms
  return (
    <Modal className="prompt" labelledBy={heading} onClose={onCancel}>
      <h2 id={heading}>{strings.convidar.escolherCanal}</h2>
      {rooms.length === 0 ? (
        <p className="field-note">{strings.userMenu.noRooms}</p>
      ) : (
        <ul className="room-pick-list">
          {ordem.map((room) => (
            <li key={room}>
              <button
                type="button"
                className={room === preferido ? "channel active" : "channel"}
                aria-current={room === preferido ? "true" : undefined}
                autoFocus={room === ordem[0]}
                onClick={() => onPick(room)}
              >
                <RoomIcon channel={room} label={labelFor(room)} size={22} icon={iconFor?.(room)} />
                {labelFor(room)}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="prompt-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>
          {strings.prompts.cancel}
        </Button>
      </div>
    </Modal>
  )
}
