import type { ChannelRole } from "../../bridge.js"
import { Interruptor } from "../../components/Interruptor.js"
import { RolePowers } from "../../components/RolePowers.js"
import { hexDaCor, tintaDoPapel } from "../../lib/roleColours.js"
import { strings } from "../../strings.js"

/**
 * A person's roles, inside their profile.
 *
 * These are two different operations, and both lived in channel properties.
 * DEFINING a role, creating "Moderator", saying what it gives, renaming it,
 * deleting it, is managing the channel, and stays where it was. ASSIGNING
 * roles to someone is looking at a person, and that is what lives here.
 * Separated, each screen answers one question: one says what roles exist, the
 * other says who has them.
 *
 * **Seeing is not a privilege.** Any channel member sees any other's roles, and
 * sees what each role gives, that is what makes a role useful, and it is the
 * only way someone with one discovers what it lets them do. An earlier version
 * closed this section to admins and closed with it the reading; it is reverted.
 * What stays closed is CHANGING.
 *
 * **The one who changes comes from the core.** `mayManageRoles`, not a new rule
 * written on screen. Managing roles is deliberately outside the four
 * responsibilities (`expulsar`, `convidar`, `renomear`, `mover`): if it were
 * one of them, it would take just one power to nominate yourself all the others.
 * Hiding the boxes does not stop anyone from calling the bridge, the real
 * refusal is in the core, both sides, in `assignRoles`.
 *
 * **Boxes, not drag.** The original gesture was dragging a person onto the
 * role's card; it died and does not come back. Anyone who does not see well, or
 * uses keyboard, never dragged anything. Here the list is roles and the person
 * is one, which makes the checkbox field the obvious form: checked is having,
 * unchecked is not, and removing is no longer a gesture that did not exist.
 *
 * **Two lists, not one.** The question this screen asks is "what roles does
 * this person have?", and the answer was a 13px square at the corner of four
 * cards otherwise identical: to know it you had to read the boxes one by one.
 * Separated, what they have, and what they can get, the answer reads from
 * the header, and what is left becomes explicitly the other question.
 *
 * Checking moves the card from one list to the other, and that is confirmation:
 * the gesture has visible consequence where the consequence is the information.
 */
/**
 * A role, in someone's profile: the name, what it gives, and the box that gives
 * or takes it.
 *
 * **`data-tem` not a hand-built class.** Those who have the role and those who
 * can get it are told apart by background and by a bar of the role's color, and
 * CSS decides this from state, in one place. Before the card was the same in
 * both cases and the whole difference lived in a 13px square at the corner.
 *
 * **The color lives in the `<li>` not the name.** This way the left bar can be
 * the role's color, it is the same color the people list shows, and the name
 * keeps reading it by inheritance, as it always has.
 */
function CartaoDoCargo({
  papel,
  tem,
  editavel,
  onToggle,
}: {
  papel: ChannelRole
  tem: boolean
  editavel: boolean
  onToggle: (role: string, ter: boolean) => void
}): React.JSX.Element {
  return (
    <li className="role-card" data-tem={tem ? "sim" : "nao"} style={tintaDoPapel(hexDaCor(papel.colour))}>
      {editavel ? (
        // A toggle, not a checkbox: giving or taking a role is turning a
        // responsibility on or off. The label is the role's name and nothing else: it
        // is what gives the toggle its accessible name, and an `aria-label` on top
        // would hide the visible text from voice control.
        <span className="role-head">
          <Interruptor
            ligado={tem}
            onMudar={(ter) => onToggle(papel.role, ter)}
            rotulo={<span className="role-name">{papel.name}</span>}
          />
        </span>
      ) : (
        <span className="role-head">
          <span className="role-name">{papel.name}</span>
        </span>
      )}
      <RolePowers powers={papel.powers} />
    </li>
  )
}

export function MemberRoles({
  channelLabel,
  declared,
  mine,
  mayManage,
  founder,
  admin,
  onToggle,
}: {
  /** The channel name these roles belong to, as the sidebar shows it. */
  channelLabel: string
  /** The roles declared in the channel, already sorted. Without the built-in `admin`. */
  declared: ChannelRole[]
  /** The identifiers of the roles this person has. */
  mine: readonly string[]
  /** Comes from `mayManageRoles`, from the core. False shows the same thing, read-only. */
  mayManage: boolean
  /** This person founded the channel: the core refuses to touch their roles. */
  founder: boolean
  /** This person has the built-in `admin` role. */
  admin: boolean
  onToggle: (role: string, ter: boolean) => void
}): React.JSX.Element | null {
  /**
   * The founder cannot step down, it's written into the core's `assignRoles`,
   * and offering the action would promise a gesture that always returns an error.
   */
  const editavel = mayManage && !founder

  /**
   * Who can assign sees the full list, because they need to choose from somewhere.
   * Who cannot sees only what the person has: the complete list of channel
   * labels in someone's profile is inventory, not information about them.
   */
  const visiveis = editavel ? declared : declared.filter((papel) => mine.includes(papel.role))

  // Nothing to say about this person in this channel, and nothing to do. A
  // heading with nothing under it is worse than no heading at all: it promises
  // something to read.
  if (!editavel && !founder && !admin && visiveis.length === 0) return null

  /**
   * The two halves, and the order they're read in.
   *
   * `has` first because it answers the screen's question; `can` after because
   * it's what you do with it. Within each, the channel's declared order is
   * kept, reordering by another criterion would make the list shift with each
   * check, and the goal is for only the checked card to move.
   */
  const tem = visiveis.filter((papel) => mine.includes(papel.role))
  const pode = visiveis.filter((papel) => !mine.includes(papel.role))

  return (
    <section className="member-roles">
      {/* The `h3` stays as what names the channel, and carries only that: it's what
          scripts read to prove a role doesn't exist outside a channel, and the
          headings of the two lists are `h4` under it. */}
      <h3>{strings.memberRoles.title(channelLabel)}</h3>

      {/* Founding and administering are not declared roles: they don't appear in the
          channel's list, they aren't checked in a box, and leaving them out would
          make this section lie about what the person can do. The admin names
          themselves and steps down from the person's menu, which is where that
          gesture has always lived, two paths to the same state would split on
          the first change. */}
      {founder && <p className="member-role-badge">{strings.memberRoles.founder}</p>}
      {admin && <p className="member-role-badge">{strings.memberRoles.admin}</p>}

      {/* The list of what the person HAS, which answers the screen's question. */}
      {tem.length > 0 ? (
        <div className="member-roles-grupo">
          <h4>{strings.memberRoles.has(tem.length)}</h4>
          <ul>
            {tem.map((papel) => (
              <CartaoDoCargo key={papel.role} papel={papel} tem editavel={editavel} onToggle={onToggle} />
            ))}
          </ul>
        </div>
      ) : (
        // Who has none says it in words. Without this, who can assign sees only the
        // list of what exists, and who cannot sees the empty section.
        visiveis.length > 0 && <p className="field-note">{strings.memberRoles.none}</p>
      )}

      {/* And the list of what can be GIVEN to them, which is the other question.
          Only to who can assign: for who cannot, `visiveis` already comes filtered
          to what the person has, and the heading would appear to promise a choice
          that isn't there. */}
      {editavel && pode.length > 0 && (
        <div className="member-roles-grupo">
          <h4>{strings.memberRoles.available}</h4>
          <ul>
            {pode.map((papel) => (
              <CartaoDoCargo key={papel.role} papel={papel} tem={false} editavel={editavel} onToggle={onToggle} />
            ))}
          </ul>
        </div>
      )}

      {visiveis.length === 0 && editavel && <p className="field-note">{strings.memberRoles.noneDeclared}</p>}

      {/* To who commands and is looking at the founder: the boxes aren't missing,
          that place just doesn't move. */}
      {mayManage && founder && <p className="field-note">{strings.memberRoles.founderLocked}</p>}

      {/* The split between what the cipher guarantees and what clients agree on
          follows the roles wherever they're read. It matters here as much as in
          the editor: it's where someone discovers what their role gives them,           and what it only seems to give. */}
      {visiveis.length > 0 && <p className="field-note">{strings.roles.note}</p>}
    </section>
  )
}
