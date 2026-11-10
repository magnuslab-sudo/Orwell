import { useId, useState } from "react"
import { Button } from "../../components/Button.js"
import { Modal } from "../../components/Modal.js"
import type { ChannelRole } from "../../bridge.js"
import { modoDeVisibilidade, papeisDoModo, type ModoDeVisibilidade } from "../chat/categorias.js"
import { strings, traduzirErro } from "../../strings.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"

/**
 * Who sees the rooms in a category.
 *
 * Sheet separate from `RoomProperties`, which is for the CHANNEL. The hierarchy
 * is channel → category → room, and the properties at each level are different
 * things: the channel has name, icon, and roles; the category has one thing
 * only, which is who it exists for. Putting them in the same sheet taught the
 * wrong model, which is the error the terminology tests exist to stop.
 *
 * **Three choices, not a list of checkboxes.** Everyone, admins only, or
 * specific roles. All three translate to the same list of roles always
 * published, see `modoDeVisibilidade`, and the first stays an empty list.
 * What changed was only this: "everyone" stopped being the absence of choice
 * and became a choice with a name, because all empty boxes read as "nobody" to
 * anyone arriving here for the first time.
 *
 * **This organizes, it does not protect, and the sheet says so before letting
 * you choose.** Anyone on the channel has the keys to all its public rooms: the
 * room is not its own cryptographic group, it is a tag within the channel group.
 * A hidden room still receives messages encrypted with the key everyone has. The
 * warning goes ABOVE the boxes for exactly this reason, a warning you read
 * after deciding is not a warning.
 *
 * Nothing here is rejected in the core, and it is honest that it is not rejected:
 * there is nothing to reject. `upsertCategory` publishes the preference and
 * honest clients honor it, as they honor the order of rooms. This is the status
 * of `rename` and `move`, and the opposite of `expel`.
 */
export function CategoryProperties({
  categoria,
  roles,
  initial,
  salas,
  onCreateRole,
  onSubmit,
  onCancel,
}: {
  /** The category name. It is also the key: see `channel.category`. */
  categoria: string
  /** The roles declared on the channel. With none, there is nothing to choose from. */
  roles: ChannelRole[]
  /** The roles that already see the category. **Empty means everyone.** */
  initial: readonly string[]
  /** How many rooms this category groups today, to show the effect of the action. */
  salas: number
  /**
   * Create a role without leaving here, returning the identifier it got.
   *
   * Absent for anyone who cannot manage roles (`mayManageRoles`), and in that
   * case the form does not appear, it does not appear grayed out, that is the
   * house rule.
   *
   * It exists because the alternative was an absurd detour: if you are deciding
   * who sees a category and find the role you need does not exist, you had to
   * close this, open the channel properties, create the role there, and come
   * back. The identifier comes back so the new role enters checked, it was
   * created FOR this category, and making you search for it in the list was
   * half the detour over again.
   */
  onCreateRole?: ((nome: string) => Promise<string>) | undefined
  onSubmit: (papeis: string[]) => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const heading = useId()
  const campoDoPapel = useId()
  const modoInicial = modoDeVisibilidade(initial)
  const [modo, setModo] = useState<ModoDeVisibilidade>(modoInicial)
  /**
   * The choice in a `Set` and not a list.
   *
   * Checking the same role twice must give the same result, and with a list it
   * would give a duplicate role in the payload, harmless until someone counts
   * how many roles the category needs and arrives at two where there is one.
   */
  const [escolhidos, setEscolhidos] = useState<Set<string>>(() => new Set(initial))
  const [nomeDoNovo, setNomeDoNovo] = useState("")
  const [aCriar, setACriar] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The order of roles comes from the declared list and not from the `Set`: the
  // insertion order of a `Set` is the order you checked the boxes, and that made
  // two identical choices publish different payloads.
  const marcados = roles.map((papel) => papel.role).filter((role) => escolhidos.has(role))
  /** What this state would publish right now, exactly as is. */
  const papeis = papeisDoModo(modo, marcados)

  /**
   * What would be published is different from what is published?
   *
   * This is the right question and not "did someone check a box", and the
   * difference solves on its own the case of the **role deleted after being
   * chosen**: it stayed in the category payload, does not appear in any box, is
   * invisible and still counts. Since it does not enter `papeis` (which comes
   * from the declared list), the comparison gives different right away, the
   * button opens lit, and saving clears it. It is the only door to get a ghost
   * out of there, and it is on purpose that it stands open.
   */
  const mudou = !mesmosPapeis(papeis, initial)
  /**
   * "Specific roles" with none chosen does not save.
   *
   * Would publish an empty list, which is "everyone", and "everyone" now has
   * its own button. Letting it through was the radio saying one thing and the
   * wire saying another. Anyone wanting to lift the restriction chooses
   * "Everyone", which is more visible than unchecking boxes until none remain;
   * and it is also how you clean a category where only ghosts are left.
   */
  const porGuardar = modo !== "papeis" || papeis.length > 0

  const alternar = (role: string): void => {
    setEscolhidos((actuais) => {
      const proximos = new Set(actuais)
      if (proximos.has(role)) proximos.delete(role)
      else proximos.add(role)
      return proximos
    })
  }

  const criarPapel = (): void => {
    const nome = nomeDoNovo.trim()
    // A role with no name is not a role: it is a tag nobody can read.
    if (!nome || aCriar || !onCreateRole) return
    setACriar(true)
    setError(null)
    void onCreateRole(nome)
      .then((role) => {
        setNomeDoNovo("")
        setACriar(false)
        setEscolhidos((actuais) => new Set(actuais).add(role))
      })
      .catch((cause: Error) => {
        setACriar(false)
        setError(traduzirErro(cause))
      })
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    // Without this the browser navigates and reloads the page in the middle of
    // publishing. See `RoomProperties`, where it took an afternoon to discover.
    event.preventDefault()
    if (busy || !porGuardar) return
    setBusy(true)
    setError(null)
    void onSubmit(papeis).catch((cause: Error) => {
      setBusy(false)
      setError(traduzirErro(cause))
    })
  }

  return (
    <Modal className="sheet narrow" labelledBy={heading} onClose={onCancel} onSubmit={submit}>
      <header className="sheet-header">
        <h2 id={heading}>{strings.categoryProperties.title}</h2>
      </header>
      <p className="sheet-lead">{strings.categoryProperties.lead}</p>

      <div className="sheet-body">
        {/*
          The warning first, and in `hint`, which is body text and not small
          print. It is deliberately the same class that carries the same
          sentence in `NewRoom`: both say that hiding rooms is organizing, both
          must be read with the same weight, and one grayed out taught that the
          other is the one that matters.
        */}
        <p className="hint">{strings.categoryProperties.note}</p>

        {/* `role-group` and `checkbox` are the house convention for choosing from a
            list, the same as the role editor, so both sheets do not speak
            different languages about the same thing. Radio buttons and not
            checkboxes because the three choices exclude each other: a category
            is not at once for everyone and for two roles. */}
        <fieldset className="role-group">
          <legend>{strings.categoryProperties.audienceLabel}</legend>
          {(
            [
              ["todos", strings.categoryProperties.everyoneOption],
              ["administracao", strings.categoryProperties.adminsOption],
              ["papeis", strings.categoryProperties.rolesOption],
            ] as const
          ).map(([valor, letreiro]) => (
            <label key={valor} className="checkbox" htmlFor={`${heading}-${valor}`}>
              <input
                id={`${heading}-${valor}`}
                type="radio"
                name={`${heading}-modo`}
                checked={modo === valor}
                onChange={() => setModo(valor)}
              />
              {letreiro}
            </label>
          ))}
        </fieldset>

        {/* The list of roles comes from the radio button and is not always on screen:
            in a 390px sheet, three role checkboxes above a create form pushed
            the save button out of view for anyone who just wanted "Everyone". */}
        {modo === "papeis" && (
          <>
            {roles.length === 0 ? (
              <p className="hint">
                {onCreateRole ? strings.categoryProperties.noRolesYet : strings.categoryProperties.noRoles}
              </p>
            ) : (
              <fieldset className="role-group">
                <legend>{strings.categoryProperties.rolesLabel}</legend>
                {roles.map((papel) => (
                  <label key={papel.role} className="checkbox" htmlFor={`${heading}-${papel.role}`}>
                    <input
                      id={`${heading}-${papel.role}`}
                      type="checkbox"
                      checked={escolhidos.has(papel.role)}
                      onChange={() => alternar(papel.role)}
                    />
                    {papel.name || papel.role}
                  </label>
                ))}
              </fieldset>
            )}

            {/*
              Create a role right here.

              A `<div>` and not a `<form>`, and the button with `type="button"`:
              this lives inside the sheet form, forms do not nest in HTML, and a
              button with no type inside a form is a submit button, creating a
              role saved the category and closed the sheet. It is the same trip-up
              that `RoleEditor` already has written down.

              Only the name. Responsibilities and color are set in the role
              editor, and repeating them here was the second copy of the same
              boxes, the one left behind when you add a responsibility. A role
              with no responsibilities is the normal case, and it is exactly what
              someone coming to restrict a category needs: a label to give to
              someone.
            */}
            {onCreateRole && (
              <div className="role-form">
                <label htmlFor={campoDoPapel}>{strings.roles.nameLabel}</label>
                <input
                  id={campoDoPapel}
                  value={nomeDoNovo}
                  placeholder={strings.roles.namePlaceholder}
                  onChange={(event) => setNomeDoNovo(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter in a text field submits the form around it. Without this, writing the
                    // role name and pressing Enter saved the category instead of creating the role.
                    if (event.key !== "Enter") return
                    event.preventDefault()
                    criarPapel()
                  }}
                />
                <div className="role-form-actions">
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={aCriar || nomeDoNovo.trim() === ""}
                    onClick={criarPapel}
                  >
                    {aCriar ? strings.categoryProperties.creating : strings.roles.create}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {/* The effect of what is chosen, in words and with the count of rooms.
            "Everyone" is the NORMAL case and is spelled out in full instead of
            leaving whoever chose it to guess what the choice does. */}
        <p className="hint">
          {modo === "todos"
            ? strings.categoryProperties.everyone
            : modo === "administracao"
              ? strings.categoryProperties.hidesFromNonAdmins(salas)
              : strings.categoryProperties.hides(salas)}
        </p>
        <span className="field-note">{strings.categoryProperties.adminNote}</span>
        <span className="field-note">{strings.categoryProperties.defaultRoomNote}</span>

        {error && (
          <p className="error">
            <TextoDeErro texto={error} />
          </p>
        )}
      </div>

      <footer className="sheet-actions">
        {/* Inside a form, a button with no type is a submit button. */}
        <Button variant="ghost" type="button" onClick={onCancel}>
          {strings.prompts.cancel}
        </Button>
        <Button variant="primary" type="submit" disabled={busy || !mudou || !porGuardar}>
          {busy ? strings.categoryProperties.saving : strings.categoryProperties.save}
        </Button>
      </footer>
    </Modal>
  )
}

/**
 * Two lists of roles with the same content?
 *
 * By set and not by order: `initial` comes from the wire and the order inside
 * it is whoever published it's order, which does not have to be the declared
 * list order. Comparing by index made the sheet open saying there were changes
 * to save just because two roles came swapped.
 */
function mesmosPapeis(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const outros = new Set(b)
  return a.every((papel) => outros.has(papel))
}
