import { newRoomId } from "@enclave/protocol"
import { useId, useState } from "react"
import { Button } from "../../components/Button.js"
import { Field } from "../../components/Field.js"
import { Interruptor } from "../../components/Interruptor.js"
import { Modal } from "../../components/Modal.js"
import { strings, traduzirErro } from "../../strings.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"

/**
 * Create a room inside a channel.
 *
 * The room identifier is born here and never changes again, and never shows: it
 * is what links messages to the room, and if the name identified it, renaming
 * it would lose everything that was said there.
 *
 * The category is still free text and not a list: write the same name twice and
 * it groups, because two equal labels are the same label. What changed is that a
 * category no longer STARTS here, there is the sheet next door, `NewCategory`,
 * for that, and they are two gestures because they are two things.
 */
export function NewRoom({
  onSubmit,
  onCancel,
  categorias = [],
  minutosAfk,
}: {
  onSubmit: (next: {
    room: string
    name: string
    category: string
    kind: "text" | "voice"
    layout?: string
    afk?: { minutos: number }
  }) => Promise<void>
  onCancel: () => void
  /** The categories that already exist, to pick instead of typing. */
  categorias?: string[]
  /**
   * The timeout for the AFK room, if the new room is one (2/11/2026). The one
   * the channel already has, or 15. Absent hides the option (nobody can mark
   * it).
   */
  minutosAfk?: number | undefined
}): React.JSX.Element {
  const heading = useId()
  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  /**
   * TYPE and LAYOUT are chosen in the same button, and they are not the same
   * thing.
   *
   * Type says where things travel, application messages or a WebRTC call,    * and there are two cases because the product has two. Layout says how to
   * read what arrives. A ticket room is the first type with its own layout,
   * which is why it is not a third type: see `layout` in `channel.meta`, where
   * the cost of that is worked out.
   *
   * Here at the top it is a single choice because for whoever creates the room,
   * it is a single choice: nobody wants to decide twice what the room is.
   */
  const [escolha, setEscolha] = useState<"text" | "voice" | "tickets">("text")
  const kind = escolha === "voice" ? "voice" : "text"
  /** "AFK room": voice room only. See `SalaAfk` in the protocol. */
  const [afk, setAfk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    // Without this the browser navigates and reloads the page in the middle of
    // publishing. See `RoomProperties`, where it took an afternoon to discover.
    event.preventDefault()
    if (busy) return
    const limpo = name.trim()
    if (!limpo) {
      setError(strings.newRoom.nameRequired)
      return
    }
    setBusy(true)
    setError(null)
    void onSubmit({
      // Random and short. Intentionally does not come from the name: two equal
      // names are two rooms, and a renamed room is still the same. The prefix
      // says the type, `forum-` is written, `contio-` is spoken, so the
      // identifier that lasts forever at least says what the room is.
      /**
       * The prefix says the TYPE, not the layout, and that is on purpose: a
       * room identifier never changes, and the layout does, changing it in a
       * `forum-` room would leave the identifier lying forever. Below the
       * ticket board there is a forum for real.
       */
      room: newRoomId(kind),
      name: limpo,
      category: category.trim(),
      kind,
      ...(escolha === "tickets" ? { layout: "tickets" } : {}),
      ...(escolha === "voice" && afk && minutosAfk !== undefined ? { afk: { minutos: minutosAfk } } : {}),
    }).catch((cause: Error) => {
      setBusy(false)
      setError(traduzirErro(cause))
    })
  }

  return (
    <Modal className="sheet narrow" labelledBy={heading} onClose={onCancel} onSubmit={submit}>
      <header className="sheet-header">
        <h2 id={heading}>{strings.newRoom.title}</h2>
      </header>
      <p className="sheet-lead">{strings.newRoom.lead}</p>

      <div className="sheet-body">
        <Field label={strings.newRoom.nameLabel}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            placeholder={strings.newRoom.namePlaceholder}
            autoFocus
          />
        </Field>

        {/* Typed by hand as always, and the ones that exist are suggested: a category
            typed with a missing accent was a new category, and nobody understood
            why. The list does not close the door to new names. */}
        <Field label={strings.newRoom.categoryLabel}>
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            maxLength={64}
            placeholder={strings.newRoom.categoryPlaceholder}
            list={categorias.length > 0 ? "categorias-existentes" : undefined}
          />
          {categorias.length > 0 && (
            <datalist id="categorias-existentes">
              {categorias.map((nome) => (
                <option key={nome} value={nome} />
              ))}
            </datalist>
          )}
        </Field>

        <Field label={strings.newRoom.kindLabel}>
          {/* `type="button"` is not decoration: inside a form, a button with no type is
              a submit button. Without this, choosing "Voice" would submit the
              form before the type changed, and create a text channel called
              whatever was there. Tested live. */}
          {/**
           * Each button says its own name, and it must be said.
           *
           * The `Field` puts the label and the control inside the same
           * `<label>`, to click the text and focus the field. That works for
           * ONE control: with three buttons in there, the first inherits the
           * entire label text as its accessible name, the "Text" button was
           * announced as "Type Voice Tickets", which is the label plus the
           * names of its siblings. Without seeing the screen there was no way
           * to pick the first room type.
           *
           * It was like this with two buttons and nobody had noticed: no test
           * looked for them by name. The third made it more absurd, and it
           * appeared while writing that test. See `SettingsScreen`, which has
           * the same pattern and is still broken, it is in `PENDENTES`.
           */}
          <div className="kind-choice">
            <Button
              type="button"
              ariaLabel={strings.newRoom.kindText}
              variant={escolha === "text" ? "primary" : "ghost"}
              onClick={() => setEscolha("text")}
            >
              {strings.newRoom.kindText}
            </Button>
            <Button
              type="button"
              ariaLabel={strings.newRoom.kindVoice}
              variant={escolha === "voice" ? "primary" : "ghost"}
              onClick={() => setEscolha("voice")}
            >
              {strings.newRoom.kindVoice}
            </Button>
            <Button
              type="button"
              ariaLabel={strings.newRoom.kindTickets}
              variant={escolha === "tickets" ? "primary" : "ghost"}
              onClick={() => setEscolha("tickets")}
            >
              {strings.newRoom.kindTickets}
            </Button>
          </div>
        </Field>

        {/* Said only where it matters: the ticket caveat speaks about a choice the
            person just made, and showing it always taught them to ignore both. */}
        {escolha === "tickets" && <p className="hint">{strings.newRoom.ticketsNote}</p>}
        {escolha === "voice" && minutosAfk !== undefined && (
          <>
            <Interruptor ligado={afk} onMudar={setAfk} rotulo={strings.newRoom.afkLabel} />
            {afk && <p className="hint">{strings.newRoom.afkNote}</p>}
          </>
        )}
        <p className="hint">{strings.newRoom.note}</p>
        {error && (
          <p className="error">
            <TextoDeErro texto={error} />
          </p>
        )}
      </div>

      <footer className="sheet-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>
          {strings.prompts.cancel}
        </Button>
        <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
          {busy ? strings.newRoom.creating : strings.newRoom.create}
        </Button>
      </footer>
    </Modal>
  )
}
