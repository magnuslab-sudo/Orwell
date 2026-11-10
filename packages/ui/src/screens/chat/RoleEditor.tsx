import { useId, useRef, useState } from "react"
import { compararCargos, PODERES_CUMPRIDOS, type Power } from "@enclave/protocol"
import type { ChannelRole } from "../../bridge.js"
import { Avatar } from "../../components/Avatar.js"
import { Button } from "../../components/Button.js"
import { degrausDe, gruposDePermissoes, POWERS, RolePowers } from "../../components/RolePowers.js"
import { Interruptor } from "../../components/Interruptor.js"
import {
  AnuncioDaOrdem,
  classesDaLinha,
  type OrdemDosCargos,
  PegaDaOrdem,
  SetasDaOrdem,
  useOrdemDosCargos,
} from "../../components/OrdemDosCargos.js"
import { hexDaCor, ROLE_COLOUR_HEX, ROLE_COLOUR_ORDER, tintaDoPapel } from "../../lib/roleColours.js"
import { strings } from "../../strings.js"

/**
 * Irreversible responsibilities, coming from the SAME partition that draws the
 * role cards.
 *
 * `degrausDe(POWERS)` and not a `filter` written here: this file once had its
 * own copy, with `CRYPTOGRAPHIC_POWERS` and its negation, which is why it was
 * born with two groups when the protocol already had three kinds. A copy of the
 * criterion is a copy that falls behind.
 */
// Only the ones this version supports (1.2): the others from `POWERS` don't do anything yet.
const DEGRAUS = degrausDe(PODERES_CUMPRIDOS)

/**
 * The groups in the Permissions tab. See `gruposDePermissoes`: the encryption
 * group first, then the rest by subject, like Discord.
 */
const GRUPOS = gruposDePermissoes(PODERES_CUMPRIDOS)

/** The built-in role. The core doesn't declare it, so the bridge doesn't fetch it. */
const ADMIN = "admin"

/** A channel member, as the Members tab needs to see it. */
export interface MembroDoCanal {
  address: string
  name: string
  /** The identifiers of the roles this person has in this channel. */
  roles: readonly string[]
}

type Separador = "aparencia" | "permissoes" | "membros"
const SEPARADORES: readonly Separador[] = ["aparencia", "permissoes", "membros"]

/** The open role. Empty `role` means a new role, not yet created. */
interface Rascunho {
  role: string
  name: string
  powers: Power[]
  colour?: string
}

/**
 * The channel roles: which roles exist, what they grant, and who has them.
 *
 * **Organized the way Discord organizes a role, since 27 October 2026.**
 * Owner request: "reorganize the menu exactly like Discord", and "abilities
 * must be split so they can be assigned as roles". When closed, the editor is
 * the card list. When a role opens, the list shrinks to the left (up on mobile)
 * and the role opens in three tabs: Appearance (name, color, and how it shows
 * in the member list), Permissions (each responsibility on a toggle with a
 * sentence), and Members (who has it).
 *
 * **This replaces an earlier decision.** That screen showed which roles exist
 * but not who has them: assignment moved to the person's profile (`MemberRoles`),
 * so each screen answers one question. Discord puts both in the role, and the
 * owner asked for Discord. The profile still grants and revokes roles; here is
 * the second path to the same action, with the same bridge (`setRoles`). Until
 * the implementer delivers the member list (`membros` and `onSetMemberRole`), the
 * tab shows the path to the profile instead of an empty list.
 *
 * **The list order is the channel order, and changes here** (4/11/2026, owner
 * request: "the founder/admin should be able to reorder how the roles are
 * shown"). Since 1.2 a role has a place in the protocol: the `rank` (the
 * hierarchy, signed in `role.define`) and `position` to match, for clients
 * 1.1.x. The list comes via `compararCargos`, the same rule as the core, and
 * is the order the member list, profile, and menus use across all clients. With
 * `onReorder`, the implementer says this person can reorder (the founder and
 * whoever has `admin`, the rule in `reorderRoles`): the drag handle and Up/Down
 * arrows appear. `admin` always stays at the top and doesn't drag; `@todos` is
 * not in this list.
 *
 * Only those who can manage roles see it, and those who can't don't see it
 * grayed out: that's the rule across all the menus in this product. The check is
 * `mayManageRoles`, from the core. Managing roles is DELIBERATELY outside
 * responsibilities: if it were one, having any role would let you grant yourself
 * all the others. It goes to the founder and to whoever has the `admin` role.
 */
export function RoleEditor({
  roles,
  onCreateRole,
  onEditRole,
  onDeleteRole,
  onReorder,
  souFundador = false,
  membros,
  onSetMemberRole,
  admin = null,
}: {
  roles: ChannelRole[]
  /**
   * `colour` is the name of a color from the palette, or `undefined`, which is
   * the normal case and not an unmade choice. See `lib/roleColours.ts`.
   */
  onCreateRole: (name: string, powers: Power[], colour: string | undefined) => void
  /**
   * Edit an existing role: the label, the responsibilities, or both.
   *
   * The `role` is the identifier and never changes: it ties the role to whoever
   * has it. Renaming "Moderator" to "Warden" doesn't rename anyone.
   */
  onEditRole: (role: string, name: string, powers: Power[], colour: string | undefined) => void
  onDeleteRole: (role: string) => void
  /**
   * Reorder the declared roles, top to bottom (`reorderRoles`). Only for those
   * who can: if absent, the list shows the order and won't let it change. A
   * promise, so the list reorders until the core responds.
   */
  onReorder?: ((ordem: string[]) => Promise<unknown> | void) | undefined
  /**
   * The viewer founded the channel. Only used for the `admin` role warning,
   * which readies phase 3: there the founder will create admin roles to their
   * liking, instead of the built-in `admin` that has everything.
   */
  souFundador?: boolean | undefined
  /** The channel members, for the Members tab. Absent: the path to the profile. */
  membros?: readonly MembroDoCanal[] | undefined
  /** Grant (`ter` true) or revoke a role from someone. The bridge is `setRoles`. */
  onSetMemberRole?: ((address: string, role: string, ter: boolean) => void) | undefined
  /**
   * The name and color the built-in role already has, if someone changed them
   * (`adminRole`, in the core). Null: "Administrator", no color.
   */
  admin?: { name: string; colour?: string } | null | undefined
}): React.JSX.Element {
  const base = useId()
  const nomeDoNovo = `${base}-nome`
  const separadoresRef = useRef<HTMLDivElement>(null)
  /**
   * The open role. `null` is the list.
   *
   * The same draft serves for creating and for editing, and the difference is
   * just one: empty `role` is a new role, filled `role` is one that exists. Two
   * separate forms would be two copies of the same toggles.
   */
  const [novo, setNovo] = useState<Rascunho | null>(null)
  const [separador, setSeparador] = useState<Separador>("aparencia")
  const [aAdicionar, setAAdicionar] = useState(false)

  /**
   * The list, with the built-in role at the head.
   *
   * The bridge doesn't fetch `admin` (the label of a built-in role comes from
   * the interface), but it exists in every channel and is the role that grants
   * the most. Hiding it would make the list lie about who can do what. Read-only.
   */
  const declarados = roles.filter((papel) => papel.role !== ADMIN).sort(compararCargos)
  const ordem = useOrdemDosCargos({
    ids: declarados.map((papel) => papel.role),
    nomeDe: (role) => declarados.find((papel) => papel.role === role)?.name ?? role,
    onOrdenar: onReorder,
  })
  const ordenados = ordem.ordem.flatMap((role) => declarados.filter((papel) => papel.role === role))
  const embutido: ChannelRole = roles.find((papel) => papel.role === ADMIN) ?? {
    role: ADMIN,
    name: admin?.name ?? strings.cargos.adminName,
    powers: [...PODERES_CUMPRIDOS],
    ...(admin?.colour ? { colour: admin.colour } : {}),
  }
  const lista: ChannelRole[] = [embutido, ...ordenados]

  const abrir = (papel: Rascunho): void => {
    // Opening another role drops the draft of the last one, like Cancel. Discord
    // asks; here the list beside it is the exit, and a role that hasn't saved
    // doesn't belong to anyone.
    setNovo(papel)
    setSeparador("aparencia")
    setAAdicionar(false)
  }

  const abrirExistente = (papel: ChannelRole): void =>
    abrir({
      role: papel.role,
      name: papel.name,
      powers: [...papel.powers],
      // The color it already has shows checked, like the abilities do: a form that
      // forgot it would turn "edit" into "start over".
      ...(papel.colour ? { colour: papel.colour } : {}),
    })

  return (
    <section className="role-editor">
      {/* The title rules the list, not a footnote to it. */}
      <h3>{strings.roles.title}</h3>

      {novo === null ? (
        <>
          {ordem.pode && declarados.length > 1 && (
            <p className="field-note">
              {strings.cargosEPermissoes.ordemComoMudar} {strings.cargosEPermissoes.ordemFixa}
            </p>
          )}
          <AnuncioDaOrdem ordem={ordem} />
          <ul>
            {lista.map((papel) => (
              <CartaoDoCargo
                key={papel.role}
                papel={papel}
                // `admin` is line 0 and doesn't move: the order indices are the declared ones.
                ordem={papel.role === ADMIN ? undefined : { controlo: ordem, indice: lista.indexOf(papel) - 1 }}
                souFundador={souFundador}
                onAbrir={() => abrirExistente(papel)}
                onDeleteRole={onDeleteRole}
                onRenomear={(nome) => onEditRole(papel.role, nome, papel.powers, papel.colour)}
              />
            ))}
          </ul>
          <Button variant="ghost" className="wide" type="button" onClick={() => abrir({ role: "", name: "", powers: [] })}>
            {strings.roles.add}
          </Button>
        </>
      ) : (
        /**
         * A `<div>` not a `<form>`: this lives inside the properties form, and
         * forms don't nest in HTML. Nested, the browser would discard the inner
         * one, and Create Role would submit the properties and close the sheet.
         *
         * `data-aberto` widens the sheet (`screens.css`): two columns at 532 px
         * were a list of cut-off names next to tight toggles.
         */
        <div className="cargos" data-aberto="sim">
          <nav className="cargos-lista" aria-label={strings.cargos.listLabel}>
            <ul>
              {lista.map((papel) => (
                <li key={papel.role}>
                  <button
                    type="button"
                    className="cargos-item"
                    aria-current={papel.role === novo.role ? "true" : undefined}
                    style={tintaDoPapel(hexDaCor(papel.colour))}
                    onClick={() => abrirExistente(papel)}
                  >
                    <span className="role-colour-dot" aria-hidden="true" />
                    <span className="cargos-item-nome">{papel.name}</span>
                    {membros && papel.role !== ADMIN && (
                      <span className="cargos-item-conta">
                        {membros.filter((membro) => membro.roles.includes(papel.role)).length}
                      </span>
                    )}
                  </button>
                </li>
              ))}
              {novo.role === "" && (
                <li>
                  <span className="cargos-item" aria-current="true">
                    <span className="role-colour-dot none" aria-hidden="true" />
                    <span className="cargos-item-nome">{novo.name.trim() || strings.roles.add}</span>
                  </span>
                </li>
              )}
            </ul>
          </nav>

          <FolhaDoCargo
            base={base}
            nomeDoNovo={nomeDoNovo}
            novo={novo}
            setNovo={setNovo}
            separador={separador}
            setSeparador={setSeparador}
            separadoresRef={separadoresRef}
            aAdicionar={aAdicionar}
            setAAdicionar={setAAdicionar}
            souFundador={souFundador}
            membros={membros}
            onSetMemberRole={onSetMemberRole}
            onDeleteRole={(role) => {
              onDeleteRole(role)
              setNovo(null)
            }}
            onGuardar={() => {
              const nome = novo.name.trim()
              // A role with no name is not a role: it's a label nobody can read in a
              // list of people.
              if (!nome) {
                setSeparador("aparencia")
                return
              }
              const poderes = POWERS.filter((poder) => novo.powers.includes(poder))
              // Filled `role` is a role that exists: edit it, and the identifier goes
              // unchanged so nobody loses it.
              if (novo.role) onEditRole(novo.role, nome, poderes, novo.colour)
              else onCreateRole(nome, poderes, novo.colour)
              setNovo(null)
            }}
            onFechar={() => setNovo(null)}
          />
        </div>
      )}

      {/**
       * The footer, with a hierarchy inside: the nature of responsibilities,
       * which is product doctrine and carries a mark; and the organization notes.
       */}
      <div className="role-doutrina">
        <p className="role-line role-sealed">{strings.roles.note}</p>
        <p className="role-line role-final">{strings.roles.noteFinal}</p>
      </div>
      {/* Without the member list delivered, whoever just created a role needs to know
          where to give it. With it, the Members tab is that path. */}
      {roles.length > 0 && !membros && <p className="field-note">{strings.roles.assignElsewhere}</p>}
      {roles.length > 0 && <p className="field-note">{strings.roles.deleteNote}</p>}
    </section>
  )
}

/**
 * A role in the closed list: the name, what it grants, and what you can do with it.
 *
 * **The name changes in place** (2/11/2026, owner request: "the founder should
 * be able to change the role name"), like Discord: "Change name" swaps the label
 * for a field, Enter or leaving the field saves, Escape cancels. The built-in
 * one does too, as long as the core allows it: the name and color change,
 * permissions don't.
 *
 * The field lives inside the properties form, and Enter in a form field submits
 * it: so Enter is caught here and doesn't bubble up.
 */
function CartaoDoCargo({
  papel,
  ordem,
  souFundador,
  onAbrir,
  onDeleteRole,
  onRenomear,
}: {
  papel: ChannelRole
  /** The position of this role in the reorderable order. Absent in `admin`, which stays at the top. */
  ordem?: { controlo: OrdemDosCargos; indice: number } | undefined
  souFundador: boolean
  onAbrir: () => void
  onDeleteRole: (role: string) => void
  onRenomear: (nome: string) => void
}): React.JSX.Element {
  const embutido = papel.role === ADMIN
  const [aRenomear, setARenomear] = useState<string | null>(null)
  const guardarNome = (): void => {
    const nome = (aRenomear ?? "").trim()
    setARenomear(null)
    // Empty or unchanged is not a change: a role with no name doesn't read in the list.
    if (nome && nome !== papel.name) onRenomear(nome)
  }
  return (
    <li
      className={ordem ? classesDaLinha(ordem.controlo, "role-card", ordem.indice, papel.role) : "role-card"}
      data-embutido={embutido ? "sim" : undefined}
      {...(ordem ? ordem.controlo.arrasto(ordem.indice, papel.role) : {})}
    >
      <span className="role-head">
        {ordem && <PegaDaOrdem ordem={ordem.controlo} nome={papel.name} />}
        {/* The color tints the NAME, and the name always says which role it is. */}
        {aRenomear === null ? (
          <span className="role-name" style={tintaDoPapel(hexDaCor(papel.colour))}>
            {papel.name}
          </span>
        ) : (
          <input
            className="role-name-campo"
            aria-label={strings.roles.renameLabel(papel.name)}
            value={aRenomear}
            maxLength={64}
            autoFocus
            onChange={(evento) => setARenomear(evento.target.value)}
            onBlur={guardarNome}
            onKeyDown={(evento) => {
              if (evento.key === "Enter") {
                evento.preventDefault()
                guardarNome()
              }
              if (evento.key === "Escape") {
                // Escape closes the whole sheet elsewhere; here it just cancels the name edit.
                evento.preventDefault()
                evento.stopPropagation()
                setARenomear(null)
              }
            }}
          />
        )}
        {aRenomear === null && (
          <button
            type="button"
            className="role-edit"
            title={strings.roles.renameTitle(papel.name)}
            onClick={() => setARenomear(papel.name)}
          >
            {strings.roles.rename}
          </button>
        )}
        {/* The built-in role doesn't get redefined: an `admin` with zero abilities
            would strip everyone who has it, including whoever created it. The
            guard is in the core; here it's just not offering what will be refused.
            Opens in read mode, so you can see what it grants. */}
        <button
          type="button"
          className="role-edit"
          title={embutido ? strings.cargos.openTitle(papel.name) : strings.roles.editTitle(papel.name)}
          onClick={onAbrir}
        >
          {embutido ? strings.cargos.open : strings.roles.edit}
        </button>
        {/* A word not an `×`: deleting a role can't be hidden. */}
        {!embutido && (
          <button
            type="button"
            className="role-drop"
            title={strings.roles.deleteTitle(papel.name)}
            onClick={() => onDeleteRole(papel.role)}
          >
            {strings.roles.deleteLabel}
          </button>
        )}
        {ordem && <SetasDaOrdem ordem={ordem.controlo} role={papel.role} nome={papel.name} indice={ordem.indice} />}
      </span>
      {/* The same component the person's profile uses: here you define the role,
          there you read who has it, and what each one grants is the same sentence. */}
      <RolePowers powers={papel.powers} />
      {embutido && souFundador && <p className="cargos-aviso">{strings.cargos.adminWarning}</p>}
    </li>
  )
}

/** The open role: the header, the three tabs, and what gets saved. */
function FolhaDoCargo({
  base,
  nomeDoNovo,
  novo,
  setNovo,
  separador,
  setSeparador,
  separadoresRef,
  aAdicionar,
  setAAdicionar,
  souFundador,
  membros,
  onSetMemberRole,
  onDeleteRole,
  onGuardar,
  onFechar,
}: {
  base: string
  nomeDoNovo: string
  novo: Rascunho
  setNovo: (rascunho: Rascunho) => void
  separador: Separador
  setSeparador: (separador: Separador) => void
  separadoresRef: React.RefObject<HTMLDivElement | null>
  aAdicionar: boolean
  setAAdicionar: (sim: boolean) => void
  souFundador: boolean
  membros: readonly MembroDoCanal[] | undefined
  onSetMemberRole: ((address: string, role: string, ter: boolean) => void) | undefined
  onDeleteRole: (role: string) => void
  onGuardar: () => void
  onFechar: () => void
}): React.JSX.Element {
  const embutido = novo.role === ADMIN
  const tinta = tintaDoPapel(hexDaCor(novo.colour))
  const nomeVisivel = novo.name.trim() || strings.roles.add
  const letreiro: Record<Separador, string> = {
    aparencia: strings.cargos.tabAppearance,
    permissoes: strings.cargos.tabPermissions,
    membros: strings.cargos.tabMembers,
  }

  /**
   * The arrows switch tabs, like a real `tablist` (WAI-ARIA, the tab standard
   * with auto-activation). Focus follows the choice.
   */
  const aoTeclado = (evento: React.KeyboardEvent<HTMLDivElement>): void => {
    const passo = evento.key === "ArrowRight" ? 1 : evento.key === "ArrowLeft" ? -1 : 0
    if (passo === 0) return
    evento.preventDefault()
    const indice = (SEPARADORES.indexOf(separador) + passo + SEPARADORES.length) % SEPARADORES.length
    const proximo = SEPARADORES[indice] ?? "aparencia"
    setSeparador(proximo)
    separadoresRef.current?.ownerDocument.getElementById(`${base}-tab-${proximo}`)?.focus()
  }

  return (
    <div className="role-form cargos-folha">
      <div className="cargos-cabeca">
        <span className="role-name" style={tinta}>
          {nomeVisivel}
        </span>
        {novo.role !== "" && !embutido && (
          <button
            type="button"
            className="role-drop"
            title={strings.roles.deleteTitle(novo.name)}
            onClick={() => onDeleteRole(novo.role)}
          >
            {strings.roles.deleteLabel}
          </button>
        )}
      </div>

      <div
        ref={separadoresRef}
        className="cargos-separadores"
        role="tablist"
        aria-label={strings.cargos.tabsLabel}
        onKeyDown={aoTeclado}
      >
        {SEPARADORES.map((cada) => (
          <button
            key={cada}
            id={`${base}-tab-${cada}`}
            type="button"
            role="tab"
            className="cargos-separador"
            aria-selected={cada === separador}
            aria-controls={`${base}-painel`}
            tabIndex={cada === separador ? 0 : -1}
            onClick={() => setSeparador(cada)}
          >
            {letreiro[cada]}
          </button>
        ))}
      </div>

      <div
        id={`${base}-painel`}
        role="tabpanel"
        className="cargos-painel"
        aria-labelledby={`${base}-tab-${separador}`}
        data-separador={separador}
      >
        {separador === "aparencia" && (
          <Aparencia nomeDoNovo={nomeDoNovo} novo={novo} setNovo={setNovo} embutido={embutido} />
        )}
        {separador === "permissoes" && (
          <Permissoes novo={novo} setNovo={setNovo} embutido={embutido} souFundador={souFundador} />
        )}
        {separador === "membros" && (
          <Membros
            novo={novo}
            embutido={embutido}
            membros={membros}
            onSetMemberRole={onSetMemberRole}
            aAdicionar={aAdicionar}
            setAAdicionar={setAAdicionar}
          />
        )}
      </div>

      {/* Save and cancel sit below all three tabs, not inside one: the name, color,
          and responsibilities save together. The built-in role saves too since
          2/11/2026, but only the name and color: its permissions don't change
          (see `defineRole` in the core). */}
      <div className="role-form-actions">
        <Button variant="primary" type="button" onClick={onGuardar}>
          {novo.role ? strings.roles.save : strings.roles.create}
        </Button>
        <Button variant="ghost" type="button" onClick={onFechar}>
          {strings.prompts.cancel}
        </Button>
      </div>
    </div>
  )
}

/** Appearance: the name, the color, and how the role shows in the member list. */
function Aparencia({
  nomeDoNovo,
  novo,
  setNovo,
  embutido,
}: {
  nomeDoNovo: string
  novo: Rascunho
  setNovo: (rascunho: Rascunho) => void
  embutido: boolean
}): React.JSX.Element {
  const tinta = tintaDoPapel(hexDaCor(novo.colour))
  const nomeVisivel = novo.name.trim() || strings.roles.namePlaceholder
  return (
    <>
      <label htmlFor={nomeDoNovo}>{strings.roles.nameLabel}</label>
      <input
        id={nomeDoNovo}
        value={novo.name}
        placeholder={strings.roles.namePlaceholder}
        onChange={(event) => setNovo({ ...novo, name: event.target.value })}
      />

      {embutido && <p className="field-note">{strings.cargos.adminAppearance}</p>}
      {
        /**
         * The role color.
         *
         * **A closed palette, not a free color picker.** The label ends in a
         * sub-line of 11px on dark background, and a hand-picked color can fade
         * unreadably without the picker noticing. See `roleColours.ts`.
         *
         * **Each option says the full name.** Here the information IS the color,
         * and a row of silent dots would make anyone choose blind who can't tell
         * them apart. "No color" is an option in the row, not the absence of choice.
         */
        <fieldset className="role-group role-colour-group">
          <legend>{strings.roles.colourLabel}</legend>
          <div className="role-colour-row">
            <button
              type="button"
              className={novo.colour === undefined ? "chip role-colour on" : "chip role-colour"}
              aria-pressed={novo.colour === undefined}
              title={strings.roles.colourNoneTitle}
              onClick={() => {
                const { colour: _cor, ...resto } = novo
                setNovo(resto)
              }}
            >
              <span className="role-colour-dot none" aria-hidden="true" />
              {strings.roles.colourNone}
            </button>
            {ROLE_COLOUR_ORDER.map((cor) => (
              <button
                key={cor}
                type="button"
                className={novo.colour === cor ? "chip role-colour on" : "chip role-colour"}
                aria-pressed={novo.colour === cor}
                title={strings.roles.colourTitle(strings.roles.colourNames[cor] ?? cor)}
                onClick={() => setNovo({ ...novo, colour: cor })}
              >
                <span className="role-colour-dot" style={{ background: ROLE_COLOUR_HEX[cor] }} aria-hidden="true" />
                {strings.roles.colourNames[cor] ?? cor}
              </button>
            ))}
          </div>
        </fieldset>
      }

      {/**
       * The preview, with the member list classes not an imitation of it: the
       * group header and the person's sub-line tint themselves by the same
       * variable (`--role-tint`) that `MemberPanel` writes. If the list changes
       * shape, the sample changes with it.
       */}
      <div className="cargos-amostra">
        <span className="cargos-amostra-titulo">{strings.cargos.previewLabel}</span>
        <div className="cargos-amostra-lista" aria-hidden="true">
          <p className="member-group-head" style={tinta}>
            {strings.members.groupHeading(nomeVisivel, 1)}
          </p>
          <div className="member-row">
            <Avatar profile={undefined} fallback={strings.cargos.previewPerson[0] ?? "A"} />
            <span className="member-labels">
              <span className="member-name">{strings.cargos.previewPerson}</span>
              <span className="member-sub member-role" style={tinta}>
                {nomeVisivel}
              </span>
            </span>
          </div>
        </div>
        <span className="field-note">{strings.cargos.previewNote}</span>
      </div>
    </>
  )
}

/**
 * Permissions: each responsibility on a toggle, with a short label.
 *
 * The groups match Discord's (Manage Channel, Members, Messages, Voice),
 * with the cipher group first and the existing badge. Since October 27, 2026,
 * this replaces three checkboxes by type. The type that the middle checkbox
 * stated (irreversibly) is now a badge on the row itself: "delete the channel"
 * still does not read as "rename it".
 */
function Permissoes({
  novo,
  setNovo,
  embutido,
  souFundador,
}: {
  novo: Rascunho
  setNovo: (rascunho: Rascunho) => void
  embutido: boolean
  souFundador: boolean
}): React.JSX.Element {
  return (
    <>
      {embutido && souFundador && <p className="cargos-aviso">{strings.cargos.adminWarning}</p>}
      {embutido && <p className="field-note">{strings.cargos.adminReadOnly}</p>}
      {GRUPOS.map(({ grupo, poderes }) => {
        const cifra = grupo === "cifra"
        return (
          <fieldset
            key={grupo}
            className={cifra ? "role-group sealed cargos-grupo" : "role-group cargos-grupo"}
            data-grupo={grupo}
          >
            <legend>{cifra ? strings.roles.sealedGroup : (strings.cargos.groups[grupo] ?? grupo)}</legend>
            {poderes.map((poder) => {
              const semVolta = DEGRAUS.semVolta.includes(poder)
              return (
                <div
                  key={poder}
                  className={semVolta ? "role-power cargo-poder final" : "role-power cargo-poder"}
                  data-poder={poder}
                >
                  <div className="cargo-poder-linha">
                    {/* Toggles, not checkboxes, ordered by the owner
                        (October 27, 2026). The label is just the name: it is the
                        accessible name, and voice commands speak what they read. */}
                    <Interruptor
                      ligado={embutido || novo.powers.includes(poder)}
                      disabled={embutido}
                      rotulo={strings.roles.powers[poder] ?? poder}
                      onMudar={(ligado) =>
                        setNovo({
                          ...novo,
                          powers: ligado ? [...novo.powers, poder] : novo.powers.filter((actual) => actual !== poder),
                        })
                      }
                    />
                    {semVolta && <span className="cargo-marca final">{strings.roles.irreversibleGroup}</span>}
                  </div>
                  <p className="cargo-poder-frase">{strings.cargos.powerHelp[poder] ?? ""}</p>
                </div>
              )
            })}
            {cifra && <span className="field-note">{strings.roles.sealedNote}</span>}
          </fieldset>
        )
      })}
      <p className="field-note">{strings.roles.conventionNote}</p>
    </>
  )
}

/** Members: who holds this role, and how to grant or revoke it. */
function Membros({
  novo,
  embutido,
  membros,
  onSetMemberRole,
  aAdicionar,
  setAAdicionar,
}: {
  novo: Rascunho
  embutido: boolean
  membros: readonly MembroDoCanal[] | undefined
  onSetMemberRole: ((address: string, role: string, ter: boolean) => void) | undefined
  aAdicionar: boolean
  setAAdicionar: (sim: boolean) => void
}): React.JSX.Element {
  // Admin is not a declared role: it lives in the person's menu,
  // where that action has always been. Two paths to the same state
  // would diverge if someone changed the first one.
  if (embutido) return <p className="field-note">{strings.cargos.membersAdmin}</p>
  // A role being created has no id yet, and without it there is nothing to assign.
  if (novo.role === "") return <p className="field-note">{strings.cargos.membersNew}</p>
  // The endpoint where the assignment lives while the sheet has not fetched it.
  if (!membros || !onSetMemberRole) return <p className="field-note">{strings.cargos.membersElsewhere}</p>

  const com = membros.filter((membro) => membro.roles.includes(novo.role))
  const sem = membros.filter((membro) => !membro.roles.includes(novo.role))

  return (
    <>
      <div className="cargos-membros-cabeca">
        <span className="cargos-membros-conta">{strings.cargos.membersCount(com.length)}</span>
        {!aAdicionar && (
          <Button variant="ghost" type="button" onClick={() => setAAdicionar(true)}>
            {strings.cargos.addMembers}
          </Button>
        )}
      </div>

      {aAdicionar && (
        <div className="cargos-candidatos">
          {sem.length === 0 ? (
            <p className="field-note">{strings.cargos.candidatesNone}</p>
          ) : (
            <ul className="cargos-membros">
              {sem.map((membro) => (
                <LinhaDoMembro
                  key={membro.address}
                  membro={membro}
                  verbo={strings.cargos.addMember}
                  titulo={strings.cargos.addMemberTitle(membro.name)}
                  onClick={() => onSetMemberRole(membro.address, novo.role, true)}
                />
              ))}
            </ul>
          )}
          <Button variant="ghost" type="button" onClick={() => setAAdicionar(false)}>
            {strings.cargos.doneAdding}
          </Button>
        </div>
      )}

      {com.length === 0 ? (
        <p className="field-note">{strings.cargos.membersNone}</p>
      ) : (
        <ul className="cargos-membros">
          {com.map((membro) => (
            <LinhaDoMembro
              key={membro.address}
              membro={membro}
              verbo={strings.cargos.removeMember}
              titulo={strings.cargos.removeMemberTitle(membro.name)}
              onClick={() => onSetMemberRole(membro.address, novo.role, false)}
            />
          ))}
        </ul>
      )}
    </>
  )
}

function LinhaDoMembro({
  membro,
  verbo,
  titulo,
  onClick,
}: {
  membro: MembroDoCanal
  verbo: string
  titulo: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <li className="cargos-membro">
      <Avatar profile={undefined} fallback={membro.name[0] ?? "?"} />
      <span className="cargos-membro-nome" title={membro.address}>
        {membro.name}
      </span>
      <button type="button" className="role-edit" title={titulo} onClick={onClick}>
        {verbo}
      </button>
    </li>
  )
}
