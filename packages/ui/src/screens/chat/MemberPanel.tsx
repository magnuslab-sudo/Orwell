import { useEffect, useRef } from "react"
import type { Power } from "@enclave/protocol"
import type { Profile } from "../../bridge.js"
import { Andante } from "../../components/Andante.js"
import { Avatar } from "../../components/Avatar.js"
import { BotaoMais } from "../../components/BotaoMais.js"
import { Button } from "../../components/Button.js"
import { DistintivoDeEmbaixador } from "../../components/DistintivoDeEmbaixador.js"
import { NomeComApelido } from "../../components/NomeComApelido.js"
import { Skeleton } from "../../components/Skeleton.js"
import { MarcaDeChamada } from "../../components/MarcaDeChamada.js"
import { useVolumes } from "../../hooks/useVolumes.js"
import { useToqueLongo } from "../../hooks/useToqueLongo.js"
import { PersonAddIcon } from "../../icons.js"
import { agruparMembros, type CargoDoMembro } from "../../lib/agruparMembros.js"
import { tintaDoPapel } from "../../lib/roleColours.js"
import { strings } from "../../strings.js"

/** A channel role, as the interface needs to know it. */
export interface ChannelRole {
  role: string
  name: string
  powers: Power[]
}

/**
 * Who is in this channel.
 *
 * The list comes from the group's own key tree, so it is not a roster a server
 * could pad with an extra reader or trim to hide one — it is exactly the set of
 * people holding keys that decrypt this channel. That is worth showing plainly,
 * because "who can read this" is the question the whole app exists to answer.
 *
 * Loading, failed and empty are three different truths, told apart on purpose:
 * an eternal "A carregar…" over a fetch that already failed is a lie.
 */
export function MemberPanel({
  channel,
  open = false,
  onClose,
  members,
  state,
  onRetry,
  me,
  directory,
  nameFor,
  onInvite,
  podeConvidar,
  onOpenProfile,
  onUserMenu,
  presenceFor,
  presenceHint,
  emChamada,
  roleFor,
  apelidoDe,
  micCaladoDe,
  oficial = false,
}: {
  channel: string
  /** On narrow screens the panel is a slide-in overlay; this is it, open.
   * On wide screens it is a plain grid column and this flag is inert. */
  open?: boolean
  /**
   * Close the drawer. Absent means there's no drawer to close.
   *
   * Before this existed, the people list would open on top of the conversation
   * on a phone and the only way to get it off was to hit the 34px handle that
   * opened it again. No veil, no Escape, nothing to tap outside: a panel that
   * won't close is a panel that covers the app.
   *
   * It's the same contract the channel bar already had. See `ChannelSidebar`.
   */
  onClose?: (() => void) | undefined
  members: string[]
  /** Each person's nickname in this channel (phase 3), before their name. */
  apelidoDe?: ((address: string) => string | undefined) | undefined
  state: "loading" | "error" | "ready"
  onRetry: () => void
  me: string | null
  directory: Map<string, Profile>
  nameFor: (sender: string) => string
  /** Opens the single invite sheet, for this channel. See `ConvidarSheet`. */
  onInvite: () => void
  /**
   * Whether this account has the right to invite people to this channel.
   *
   * Both buttons appeared for everyone, and only on tap did you discover what
   * could happen: the sheet would open, "Create link" would answer "you don't
   * have the right to invite to this channel", and that was it. It was the most
   * repeated bug in one swarm run, thirteen failures in twenty-three, always
   * on bots that didn't create the channel.
   *
   * The rule of this app is that what you cannot do does not appear greyed out:
   * it does not appear at all. The real gate stays where it was (`mayInvite`,
   * on the core side); this is the interface stopping to promise what it cannot
   * deliver.
   *
   * Absent means "no", which is the safe read for an old host who cannot answer
   * the question.
   */
  podeConvidar?: boolean | undefined
  /**
   * Opens a person's profile from the list, including your own.
   *
   * It took the place of the tap that showed the security number. In a list of
   * people, tapping a person shows the person, and verification was not lost:
   * it moved inside the profile, which is where you look for it and where it
   * finally has a label instead of just a hover tip.
   */
  onOpenProfile: (member: string) => void
  /** Right-click on a member: the shared person menu, owned by the shell. */
  onUserMenu: (member: string, at: { x: number; y: number }) => void
  /** Presence per person, live or derived — the shell knows which. */
  presenceFor?: ((address: string) => "active" | "away" | "busy" | "idle") | undefined
  /**
   * The role of each person in this channel, if they have one.
   *
   * It takes the place where the address was. The address is still what you give
   * someone to invite them, but it is not what you want to know when looking at
   * a list of people, and it stays one tap away, in the line title and in the
   * menu.
   *
   * **The label and the color come from the same function, and that is
   * deliberate.** Two separate functions let them disagree, and they already
   * disagreed on the first case: whoever created the channel reads as "Founder",
   * which is not any declared role, and a separate color function painted that
   * word with the color of a role that is not written there. The color was
   * saying something the text does not say, which is exactly what cannot
   * happen. Coming from the same place, the color is always that of a role named
   * in the label, or it does not exist.
   *
   * `tint` is an already resolved color value, or nothing. Nothing is the normal
   * case.
   *
   * **And the GROUP comes from the same function, for the same reason.** The list
   * is organized by role, and the role that organizes it must be the same one
   * the label names and the color paints. See `agruparMembros`.
   */
  roleFor?: ((address: string) => CargoDoMembro | null) | undefined
  /**
   * Who is in a call with the microphone off.
   *
   * A function, not a list: whoever knows this is the call layer, and the list
   * of channel members has nothing to do with the list of who is in voice.
   * Returning `false` for everyone, which is what happens when nobody provides
   * the prop, is the right read: outside a call there is no state saying
   * anything about anyone's microphone.
   */
  micCaladoDe?: ((address: string) => boolean) | undefined
  /**
   * Who is in a voice room or call, to make the face ring pulse.
   *
   * A function, like `presenceFor`: the call layer and room map know this, and
   * they live in `App`. Absent means nobody in a call, the ring stays still,
   * which is the reading that commits to nothing.
   */
  emChamada?: ((address: string) => boolean) | undefined
  /*
   * The list of roles and the form that creates them used to be here, and moved
   * to the channel properties sheet. See `RoleEditor`.
   *
   * With them went the drag-person-to-role gesture, which is what made this list
   * the source of a gesture. The lines are just lines again: they open the
   * profile on tap and the menu on right-click, as they always did.
   */
  presenceHint?: string | undefined
  /**
   * This channel is the server's commons, open to any account here.
   *
   * It comes decided from outside, like everything that depends on what the
   * server announced (see `lib/oficial.ts`). It matters to this list more than
   * anywhere else: the list answers "who can read this", and in an open channel
   * the honest answer is not the names here, it is these plus everyone who
   * connects next.
   *
   * Absent means "no", which is the safe read: a channel you don't know is open
   * does not announce itself as open.
   */
  oficial?: boolean | undefined
}): React.JSX.Element {
  const painel = useRef<HTMLElement>(null)
  const fecharRef = useRef(onClose)
  fecharRef.current = onClose

  /*
    Drawer behavior, and only while it is open: focus enters, Escape closes it,
    and on close focus returns to the handle that opened it. Copied from the
    channel bar on purpose, because they are the same thing on opposite sides of
    the screen and two drawers that close differently are two things to learn.
    Lighter than a `Modal` for the same reason as there: the rail and the
    conversation stay reachable, so focus does not trap.
  */
  useEffect(() => {
    if (!open || !fecharRef.current) return
    const abriu = document.activeElement instanceof HTMLElement ? document.activeElement : null
    painel.current?.querySelector<HTMLElement>("button:not([disabled]), [href], input:not([disabled])")?.focus()
    const aoTeclado = (evento: KeyboardEvent): void => {
      if (evento.key === "Escape") fecharRef.current?.()
    }
    document.addEventListener("keydown", aoTeclado)
    return () => {
      document.removeEventListener("keydown", aoTeclado)
      abriu?.focus()
    }
  }, [open])

  /**
   * Who is here, for the purposes of this list.
   *
   * Busy is present: it is people who are there and who respond. Absent from the
   * prop is "don't know", and the safe read is "is here", a host who cannot
   * answer cannot make the whole list look empty.
   */
  const estaCa = (address: string): boolean => (presenceFor ? presenceFor(address) !== "idle" : true)

  const grupos = agruparMembros(members, {
    online: estaCa,
    cargoDe: (address) => roleFor?.(address) ?? null,
    nameFor,
    titulos: { online: strings.members.groupOnline, offline: strings.members.groupOffline },
  })

  const { volumeDe } = useVolumes()
  /* The same menu, with the finger down. See `useToqueLongo`. */
  const aoDedo = useToqueLongo()

  /**
   * A person's line, exactly as this list has always drawn it.
   *
   * It came out of the `map` so it could be called from inside each group, and
   * it has not changed a thing: what changed was the order it appears in, and
   * under which heading.
   */
  const linhaDe = (member: string): React.JSX.Element => {
    const profile = directory.get(member)
    const papel = roleFor?.(member) ?? null
    const labels = (
      <>
        <Avatar profile={profile} fallback={member[1] ?? "?"} presence={presenceFor?.(member)}
          presenceTitle={presenceHint}
          emChamada={emChamada?.(member)}
        />
        <span className="member-labels">
          <span className="member-name">
            <NomeComApelido nome={nameFor(member)} apelido={apelidoDe?.(member)} endereco={member} />
            <DistintivoDeEmbaixador address={member} />
            {/* Next to the name, inside the same line: you look next to the name, and a
                mark in its own column would force the whole list to make space for
                something that is almost never there. */}
            {micCaladoDe?.(member) && (
              <MarcaDeChamada tipo="calado" nome={nameFor(member)} className="member-mic-off" size={14} />
            )}
            {/* And who WE have muted, which until now only showed in the call card.
                It stays visible even outside a call: zero volume is saved, and it
                is on the next call that the silence surprises you. */}
            {volumeDe(member) === 0 && (
              <MarcaDeChamada tipo="silenciado" nome={nameFor(member)} className="member-silenced" size={14} />
            )}
            {/* The personal message NEXT TO the name, like in Messenger (owner, October
                28, 2026): in italics and faded, after the name, and not on a line
                below. When it does not fit, it scrolls like a news ticker (the
                `Andante`), instead of cutting with ellipsis. */}
            {profile?.statusText && <Andante className="member-status" texto={profile.statusText} />}
          </span>
          {/* The role, when it exists. The address was here when there was no role, and
              left on owner's order on October 27, 2026 ("i don't want ids
              exposed"): it copies via the button next to the line.
              
              The role's color comes in by variable, and only when it exists:
              without it the CSS rule falls back to accent, which is what this
              line has always shown. What the color paints is the role's name,
              which is still written here, whoever cannot tell the colors apart
              reads the same thing they always did. */}
          {papel && (
            <span className="member-sub member-role" style={tintaDoPapel(papel.tint)}>
              {papel.label}
            </span>
          )}
        </span>
      </>
    )
    // The line itself also opens, and takes you to your own profile screen:
    // seeing yourself as others see you is what that screen always promised, and
    // an inert line in the middle of a clickable list just looks broken.
    return (
      <li key={member}>
        <button
          className="member-row"
          title={member === me ? strings.sidebar.myProfile : strings.personProfile.openHint(nameFor(member))}
          onClick={() => onOpenProfile(member)}
          onContextMenu={(event) => {
            event.preventDefault()
            onUserMenu(member, { x: event.clientX, y: event.clientY })
          }}
          {...aoDedo((ponto) => onUserMenu(member, ponto))}
        >
          {labels}
        </button>
        {/* No copy-id button next to the name (owner, October 28, 2026: "it is
            already in the menu …"): the "⋯" and right-click give the same menu,
            and that is where the id copies. The line is the name and the "⋯",
            and nothing else. */}
        <BotaoMais
          label={strings.people.rowMore(nameFor(member))}
          onAbrir={(ponto) => onUserMenu(member, ponto)}
        />
      </li>
    )
  }

  return (
    <>
      {/* The overlay, only with the drawer open. On wide screens the CSS hides it:
          the column is not on top of anything, and there is nothing to return
          to. */}
      {open && onClose && <div className="members-scrim" aria-hidden="true" onMouseDown={onClose} />}
      <aside
        ref={painel}
        className={open ? "members open" : "members"}
        role={open && onClose ? "dialog" : undefined}
        aria-label={open && onClose ? strings.members.drawerLabel : undefined}
      >
        <header className="members-header">
          <span>
            {state === "ready"
              ? strings.members.count(members.length)
              : state === "loading"
                ? strings.members.loading
                : ""}
          </span>
        </header>

        {/* Below the count and above the names, because it is the count it corrects:
            four names in a list read as four people.

            Outside the footer on purpose. The footer disappears for whoever
            cannot invite, and knowing where you are does not depend on any
            right. */}
        {oficial && <p className="members-open field-note">{strings.members.openChannel}</p>}

        <ul className="member-list">
          {state === "loading" &&
            [0, 1, 2].map((row) => (
              <li key={`skeleton-${row}`} aria-hidden="true">
                <Skeleton className="skeleton-avatar" />
                <span className="member-labels">
                  <Skeleton className="skeleton-line" />
                  <Skeleton className="skeleton-line short" />
                </span>
              </li>
            ))}

          {state === "error" && (
            <li className="member-error">
              <span>{strings.errors.membersFailed}</span>
              <Button variant="ghost" onClick={onRetry}>
                {strings.common.retry}
              </Button>
            </li>
          )}

          {/* One block per role, and one at the end for those outside. The list used to
              come sorted by ADDRESS, which is a random string of characters
              deciding who appears first. The rules are in `agruparMembros`;
              here we just draw what they say. */}
          {state === "ready" &&
            grupos.map((grupo) => (
              <li key={grupo.id} className={grupo.offline ? "member-group offline" : "member-group"}>
                {/* The role's color paints the heading by the same variable that paints the
                    sub-line, and only when it exists: without it the CSS rule
                    falls back to faded text as always. */}
                <h3
                  className="member-group-head"
                  id={`membros-${channel}-${grupo.id}`}
                  style={tintaDoPapel(grupo.tint)}
                >
                  {strings.members.groupHeading(grupo.titulo, grupo.membros.length)}
                </h3>
                <ul className="member-group-list" aria-labelledby={`membros-${channel}-${grupo.id}`}>
                  {grupo.membros.map((member) => linhaDe(member))}
                </ul>
              </li>
            ))}

          {state === "ready" && members.length === 0 && <li className="member-empty">{strings.members.empty}</li>}
        </ul>

        {/* Without the right to invite, the footer disappears. One button alone: the
            sheet has all three modes (address, link, add now). Primary, in the
            identity gradient, and without the note below (owner's request, 0.8.0):
            the sheet says what each mode does. */}
        {podeConvidar && (
          <footer className="members-footer">
            <Button variant="primary" className="wide" onClick={onInvite}>
              <PersonAddIcon size={16} />
              {strings.members.inviteSomeone}
            </Button>
          </footer>
        )}
      </aside>
    </>
  )
}
