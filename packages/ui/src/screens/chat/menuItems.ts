import { VOLUME_MAX, VOLUME_NORMAL } from "../../hooks/useVolumes.js"
import { strings } from "../../strings.js"
import type { MenuItem } from "../overlays/ContextMenu.js"
import { itensDaPessoa } from "../profile/menuDaPessoa.js"

/**
 * What each context menu offers, and to whom.
 *
 * Pure functions, away from the screen, for one reason: the rule across everything is that **what you cannot do does not appear grayed out, it does not appear at all**. A menu showing "kick" to someone who cannot kick teaches the permissions model wrong, and that rule deserves tests that don't need to mount the whole app to read.
 *
 * Permissions come from channel roles (`POWERS` in the protocol). What is here is only what we OFFER: the real refusal lives in the core, which trusts no screen.
 */

/** A channel room, as the menu needs to know it. */
/**
 * Mute or unmute where the menu is. Absent means nowhere to save it, so the entry does not appear. See `lib/silenciados.ts`.
 */
export interface Silencio {
  silenciado: boolean
  alternar: () => void
}

/** The mute entry: says what the tap will do, not the state. */
export function itemDoSilencio(silencio: Silencio): MenuItem {
  return {
    label: silencio.silenciado ? strings.silencio.ativar : strings.silencio.silenciar,
    onSelect: silencio.alternar,
  }
}

export interface SalaResumo {
  room: string
  name: string
  kind: "text" | "voice"
  /** The category the room is in, for the "Move to" hierarchy. Empty means none. */
  category?: string | undefined
}

/**
 * The menu for a CHANNEL: the encrypted group, what the sidebar lists.
 *
 * The hierarchy, because these three terms got mixed up and confused people:
 * a channel contains categories, and a category groups text or voice rooms.
 * Only the channel has cryptographic existence; the category is not even a stored
 * thing, it is a name written in the `category` field of each room.
 *
 * **A direct conversation does not use this menu.** It has its own, same as Friends and in the
 * channel bar: see `itensDaConversa`. Here we offered "Leave channel" and
 * "Properties" to a two-person conversation, and there "Close conversation". Two
 * menus for the same thing taught that they were two different things.
 *
 * The order follows the house convention: view, invite, organize, leave.
 *
 * ```
 * Abrir · Sair da chamada (só em chamada) · Marcar como lido
 * ‖ Convidar…
 * ‖ Nova sala · Nova categoria · Propriedades
 * ‖ Sair do canal · Eliminar canal
 * ```
 */
export function itensDoCanal(ctx: {
  /** Is this account in this channel's call? */
  emChamada: boolean
  /** Are there unread messages in this channel? */
  porLer: boolean
  /** Can organize rooms and change properties (permission "rename"). */
  podeOrganizar: boolean
  /** Can invite (permission "invite"). */
  podeConvidar: boolean
  /**
   * Can end the channel for everyone (permission "delete").
   *
   * Comes from the core (`mayDeleteChannel`), which adds to the permission the exceptions that don't depend on any power: the server's default room, among them. A rule written here would end up disagreeing with that.
   */
  podeEliminar: boolean
  /** The feed's own channel: leaving it broke posts in silence. */
  ehFeed: boolean
  silencio?: Silencio | undefined
  accoes: {
    abrir: () => void
    sairDaChamada: () => void
    marcarLido: () => void
    /** Opens the single invite sheet, for this channel. See `ConvidarSheet`. */
    convidar: () => void
    propriedades: () => void
    novaSala: () => void
    novaCategoria: () => void
    sair: () => void
    eliminar: () => void
  }
}): MenuItem[] {
  const itens: MenuItem[] = [{ label: strings.menu.open, onSelect: ctx.accoes.abrir }]
  /*
    You enter a voice room channel by clicking it in the list. There is no
    "join call" here: that would open a call parallel to the rooms, invisible
    to anyone inside one. Leave, yes: that is leaving where you are, and the
    dock is not always visible.
  */
  if (ctx.emChamada) {
    itens.push({ label: strings.menu.leaveCall, destructive: true, onSelect: ctx.accoes.sairDaChamada })
  }
  // Only when there is something to read: an entry that does nothing is noise.
  if (ctx.porLer) itens.push({ label: strings.menu.markRead, onSelect: ctx.accoes.marcarLido })
  // Next to "mark as read": these are the two gestures on what the channel says.
  if (ctx.silencio) itens.push(itemDoSilencio(ctx.silencio))

  /*
    An entry just for inviting. There were two ("Invite someone" and "Add to
    channel") and the first used the OPEN channel, not the one from the menu. The
    sheet this opens has three modes: by address, by link, and add now.
  */
  if (ctx.podeConvidar) {
    itens.push({ label: strings.menu.invite, separatorBefore: true, onSelect: ctx.accoes.convidar })
  }

  /*
    Clean up the channel and see what it is, in the same block. Properties are
    where you see and change roles, name and icon; they stay visible to everyone,
    because seeing who is in charge does not depend on being in charge.
  */
  if (ctx.podeOrganizar) {
    itens.push({ label: strings.menu.newRoom, separatorBefore: true, onSelect: ctx.accoes.novaSala })
    itens.push({ label: strings.menu.newCategory, onSelect: ctx.accoes.novaCategoria })
  }
  itens.push({ label: strings.menu.properties, separatorBefore: !ctx.podeOrganizar, onSelect: ctx.accoes.propriedades })

  /**
   * The end of the menu: leave, and end the channel.
   *
   * **These are two gestures, and the distance between them is everything.** Leave
   * is about me; delete publishes a tombstone that honest clients honor, and the
   * channel ends for everyone. So only the second depends on a responsibility.
   *
   * Leave appears to EVERYONE, including administrators. It is the exit for someone
   * invited to a channel they do not want to be in, and they cannot delete it,
   * which is the action of someone in charge.
   */
  if (!ctx.ehFeed) {
    itens.push({ label: strings.menu.leave, separatorBefore: true, destructive: true, onSelect: ctx.accoes.sair })
    if (ctx.podeEliminar) {
      itens.push({ label: strings.menu.remove, destructive: true, onSelect: ctx.accoes.eliminar })
    }
  }
  return itens
}

export function itensDaSala(ctx: {
  sala: SalaResumo
  podeOrganizar: boolean
  silencio?: Silencio | undefined
  accoes: {
    abrir: () => void
    renomear: () => void
    fechar: () => void
  }
}): MenuItem[] {
  // In a voice room, open means join the call: that is what clicking it does, and
  // the menu cannot call it anything else.
  const itens: MenuItem[] = [
    { label: ctx.sala.kind === "voice" ? strings.menu.joinRoom : strings.menu.open, onSelect: ctx.accoes.abrir },
  ]
  // Mute is for everyone, not just the organizer: it is about what THIS person
  // hears. So it comes before the exit gate below.
  if (ctx.silencio) itens.push(itemDoSilencio(ctx.silencio))
  // The default room, the one with empty identifier, is no longer an exception:
  // it changes name and closes like the others. Closing hides it from the list and
  // nothing else: what was said there stays in the vault, and messages that keep
  // arriving without a room keep being stored in it.
  if (!ctx.podeOrganizar) return itens

  itens.push({ label: strings.menu.renameRoom, separatorBefore: true, onSelect: ctx.accoes.renomear })
  itens.push({ label: strings.menu.closeRoom, separatorBefore: true, destructive: true, onSelect: ctx.accoes.fechar })
  return itens
}

/**
 * What you do to a category: rename it, or remove it.
 *
 * **A category is barely an entity.** What defines it is the name written in the
 * `category` field of each room; what gets published separately is only the list
 * of those that exist and the order you read them, so a category can sit empty
 * waiting for rooms. Everything else follows from this.
 *
 * - **Rename** means rewrite it in ALL rooms that declare it: one publish per
 *   room, not one total. If the new name already belongs to another category, the
 *   two become one, two identical labels are the same label, and that is not a
 *   bug, it is the model. Whoever causes it gets warned first.
 * - **Delete** means delete that name from those same rooms, which end up loose at
 *   the top. **Do not delete any room, and cannot let it look like you do**: the
 *   category is the label, rooms are the content, and removing the label releases
 *   them instead of taking them away. This is the expensive mistake of this menu,
 *   so the confirmation warning counts out loud how many rooms are NOT deleted.
 *
 * Without the `rename` responsibility there is no menu at all, what you cannot
 * do does not appear gray, it does not appear, and whoever calls this should not
 * open an empty menu.
 */
export function itensDaCategoria(ctx: {
  podeOrganizar: boolean
  accoes: {
    renomear: () => void
    /**
     * Choose which roles see rooms in this category.
     *
     * Absent is a host that does not know how to declare categories, without
     * `setCategory` there is nowhere for the choice to stick, and a menu entry
     * that leads nowhere is worse than none.
     */
    visibilidade?: (() => void) | undefined
    apagar: () => void
  }
}): MenuItem[] {
  if (!ctx.podeOrganizar) return []
  const visibilidade = ctx.accoes.visibilidade
  return [
    { label: strings.menu.renameCategory, onSelect: ctx.accoes.renomear },
    /*
      Without `destructive`, like "rename": hiding does not destroy anything. And
      that is exactly why the sheet this opens must say it also protects nothing,       see `categoryProperties.note`.
      */
    ...(visibilidade ? [{ label: strings.menu.categoryVisibility, onSelect: visibilidade }] : []),
    /*
      Without `destructive`, unlike "close room".

      Red is the promise that it destroys something. Here it does not: all rooms
      stay, they just lose the label. Painting it red would confirm at a glance
      exactly the fear that the warning below has to undo, and a menu that
      frightens opposite to what it does teaches the model wrong, which is why
      these functions exist separately from the screen.
    */
    { label: strings.menu.deleteCategory, separatorBefore: true, onSelect: ctx.accoes.apagar },
  ]
}

/**
 * Someone in a voice room: their menu, plus where to move them.
 *
 * **It is their menu, not a separate menu.** Being in a voice room does not make
 * someone something else: they are still someone whose profile you want to see,
 * whose address you want to copy, who you want to message or add as a friend. This
 * used to offer only "move to", and if you did not have the `move` responsibility
 * it offered nothing, right-clicking a name in a voice room did absolutely
 * nothing, which is indistinguishable from being broken.
 *
 * `itensDaPessoa` reused, not copied: two lists of the same diverge at the first
 * change, and one of them falls behind in silence. This is the bug "Properties"
 * and "Manage roles" had until recently, opening the same sheet from two entries.
 *
 * The destinations are ADDED ON, and still depend on the `move` responsibility.
 * Without it, or without another voice room to move to, that part does not appear
 *, and the person's menu still stands. It is also the entry point for keyboard
 * users: if dragging were the only way to move someone, half the people would be
 * left out.
 *
 * **Move is convention, not cryptography.** What leaves here is an encrypted
 * request to the other person's client, who leaves one call and enters the other
 * by their own choice; an altered client ignores it and stays where it is. See
 * `strings.voiceMove.sent`, which tells the requester.
 */
export function itensDaPessoaEmVoz(ctx: {
  /**
   * The context of the person's menu, exactly.
   *
   * By the type of the function, not by a copy of the form: if someone adds a
   * field to it tomorrow, they add it here for free, and if they remove one,
   * the build breaks instead of the menu breaking silently.
   */
  pessoa: Parameters<typeof itensDaPessoa>[0]
  podeMover: boolean
  /** The room this person is in now. Moving to it is not a move. */
  salaActual: string
  salasDeVoz: SalaResumo[]
  mover: (room: string) => void
  /** "Hang up the call". Absent in a host that does not know how to do it. */
  desligar?: (() => void) | undefined
}): MenuItem[] {
  // Moving yourself is entering another room, and you do that by clicking it. The
  // core refuses it, and here it is not offered.
  if (!ctx.podeMover || ctx.pessoa.ehEuProprio) return itensDaPessoa(ctx.pessoa)
  const destinos = ctx.salasDeVoz.filter((sala) => sala.room !== ctx.salaActual)
  /*
    Destinations go INSIDE the person's menu, before remove, not hanging off the
    end: remove is the only gesture with no undo and always closes the menu. See
    the order in `itensDaPessoa`.
  */
  return itensDaPessoa({
    ...ctx.pessoa,
    ...(destinos.length > 0 || ctx.desligar
      ? { mover: { destinos, mover: ctx.mover, ...(ctx.desligar ? { desligar: ctx.desligar } : {}) } }
      : {}),
  })
}

/**
 * The volume slider in the call menu, as a percentage.
 *
 * It was a series of fixed levels (50, 100, 150, 200 %) until the owner asked at 2 de
 * November 2026: "instead of switching between sound 25, 50, 100, 150, 200, I want a
 * volume slider". From 5 em 5 d steps are audible without forcing you to hit an exact
 * point. The cap is `useVolumes` (`VOLUME_MAX`, 2 = 200 %).
 */
export const BARRA_DO_VOLUME = { min: 0, max: Math.round(VOLUME_MAX * 100), passo: 5, normal: Math.round(VOLUME_NORMAL * 100) } as const

/**
 * Someone on a CALL: the menu of the voice room person, plus what is call-specific
 * (phase 3, owner's request on October 27: "cards on call should have a user menu").
 *
 * **One menu only.** It is `itensDaPessoaEmVoz` exactly as is (View profile,
 * Message, friendship, nickname, Move to..., Remove, per powers), with a call
 * block right after "Copy address": mute for me, and this person's volume. Written
 * separately, the call card and the sidebar would diverge at the first entry
 * someone added to either one.
 *
 * "Mute for me" is volume zero, the same as what the slider in the card keeps
 * (`useVolumes`): it does not touch anyone's microphone, and the other person does
 * not know. Unmuting puts it back to 100%.
 */
export function itensDaPessoaNaChamada(
  ctx: Parameters<typeof itensDaPessoaEmVoz>[0] & {
    /** This person's name, so the slider can say whose volume it is. */
    nome: string
    /** This person's volume right now, 0 to 2. */
    volume: number
    definirVolume: (volume: number) => void
  },
): MenuItem[] {
  const base = itensDaPessoaEmVoz(ctx)
  if (ctx.pessoa.ehEuProprio) return base
  const silenciada = ctx.volume === 0
  const bloco: MenuItem[] = [
    {
      label: silenciada ? strings.call.menuUnsilence : strings.call.menuSilence,
      separatorBefore: true,
      section: strings.call.menuSection,
      onSelect: () => ctx.definirVolume(silenciada ? VOLUME_NORMAL : 0),
    },
    {
      label: strings.call.menuVolume,
      // The entry's gesture is the "100 %" button next to the slider: restore normal.
      onSelect: () => ctx.definirVolume(VOLUME_NORMAL),
      deslizante: {
        ...BARRA_DO_VOLUME,
        valor: Math.round(ctx.volume * 100),
        // Saves in the usual format (0 to 2), so values already stored keep reading.
        aoMudar: (pct) => ctx.definirVolume(pct / 100),
        ariaLabel: strings.call.volumeOf(ctx.nome),
        textoDoValor: strings.call.menuVolumeValor,
        textoRepor: strings.call.menuVolumeValor(BARRA_DO_VOLUME.normal),
        ariaRepor: strings.call.menuVolumeRepor,
      },
    },
  ]
  // After "Copy address": see who they are, and right after how loud they are.
  const depois = base.findIndex((item) => item.label === strings.social.copyAuthor)
  return [...base.slice(0, depois + 1), ...bloco, ...base.slice(depois + 1)]
}
