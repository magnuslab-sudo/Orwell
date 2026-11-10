import { useId } from "react"
import { Button } from "../../components/Button.js"
import { Modal } from "../../components/Modal.js"
import { strings } from "../../strings.js"

/**
 * The safety-number check, in the sense of Signal's.
 *
 * Both people compute the same string from the same two signing keys and
 * compare it out of band — aloud, or side by side. A match proves the person
 * you are talking to holds the key this device encrypts to, which is the one
 * claim no server, honest or otherwise, can fake. Presentational on purpose:
 * the number arrives as a prop, so the rendering is testable without a ratchet.
 */
export function VerifyModal({
  name,
  address,
  number,
  onClose,
}: {
  name: string
  address: string
  /** Null when the member's key could not be read from the ratchet tree. */
  number: string | null
  onClose: () => void
}): React.JSX.Element {
  const heading = useId()
  const groups = number === null ? [] : number.split(" ")

  return (
    <Modal className="sheet narrow" labelledBy={heading} onClose={onClose}>
      <header className="sheet-header">
        <h2 id={heading}>{strings.verify.title}</h2>
        <Button variant="ghost" onClick={onClose}>
          {strings.common.close}
        </Button>
      </header>

      <div className="sheet-body">
        <div className="verify-who">
          <span className="member-labels">
            <span className="member-name">{name}</span>
            <span className="member-sub" title={address}>
              {address}
            </span>
          </span>
        </div>

        {number === null ? (
          <p className="field-note warn">{strings.verify.unavailable}</p>
        ) : (
          <>
            <div className="safety-number" data-testid="safety-number">
              {groups.map((group, index) => (
                <span key={index}>{group}</span>
              ))}
            </div>
            <p className="field-note">{strings.verify.note}</p>
          </>
        )}
      </div>
    </Modal>
  )
}
