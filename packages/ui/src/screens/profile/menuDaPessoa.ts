import { strings } from "../../strings.js"
import type { MenuItem } from "../overlays/ContextMenu.js"

/**
 * The right-click menu on a PERSON, from wherever the click came.
 *
 * A pure function, decoupled from the screen, for the same reason as `menuItems.ts`: the rule
 * that runs through everything is that **what you cannot do does not appear grayed out, it
 * does not appear at all**, and that rule deserves tests that do not need to mount the entire
 * app to be read. It was written by hand inside `App.tsx`,
 * in a list with two `filter` chained to decide who saw what; the logic
 * was the same, but there was no way to look at it without opening a file of
 * 2.600 linhas.
 *
 * This menu opens from five places (the members panel of a channel, the author
 * of a post, the Friends list, a conversation line, and who is in a
 * voice room), and each knows different things about the context. That is why
 * almost everything here is a question, not a deduction: the caller knows
 * if there is a shared channel, and which one.
 *
 * **The order is one only, and it is the house convention:** view, communicate, relationship, channel,
 * administration, destructive, with a line before each block.
 *
 * ```
 * Ver perfil · Copiar endereço
 * ‖ Mensagem · Chamada (só a amigos)
 * ‖ Pedir amizade | Aceitar pedido | Cancelar pedido | Desfazer amizade · Convidar para um canal…
 * ‖ Mudar apelido… · Tirar apelido (fase 3: o próprio, ou quem modera)
 * ‖ Tornar administrador | Deixar de ser administrador
 * ‖ Mover para › (escada das salas de voz, por categoria) · Desligar da chamada (só em voz)
 * ‖ Expulsar do canal
 * ‖ Denunciar… · Bloquear
 * ```
 *
 * With the person blocked, Message, Call, friendship, and invite leave. The
 * core already refuses them. What is of the channel stays, and "Unblock" comes at the end.
 *
 * The profile page draws the same, in the same order and with the same functions:
 * the menu is the shortcut, the page is the place. See `PersonProfile`.
 */
export function itensDaPessoa(ctx: {
  /** That's me. You don't request friendship from yourself. */
  ehEuProprio: boolean
  /** Already my friend: request to undo, not to request. */
  ehAmigo: boolean
  /**
   * A pending request between the two, when they're not friends.
   *
   * With OUR request waiting there's no friendship entry: requesting again
   * changes nothing, and canceling is the next step. With THEIR request waiting,
   * the entry is accept, which is the gesture that closes it from both sides.
   */
  pedido?: "enviado" | "recebido" | undefined
  /**
   * The channel shared by where we arrived at this person, if the click site
   * knows one. Null in the Friends list, which is no channel.
   */
  canal: string | null
  /**
   * In this channel there's administration to give or take. Comes from
   * `admiteAdministracao`: a two-person conversation doesn't have any, and
   * that's why this field exists.
   */
  canalAdmiteAdministracao: boolean
  /** Comes from `mayManageRoles`, from the core. Never from a rule written here. */
  podeGerirPapeis: boolean
  /** This person founded the channel: they don't step down, and aren't offered. */
  ehFundador: boolean
  /** This person is already admin of the channel: the gesture is to remove. */
  jaEhAdministrador: boolean
  /**
   * Comes from `may(canal, "expulsar")`, not `mayManageRoles`.
   *
   * Separate responsibilities on purpose: one role can grant one without the other, and
   * room cleanup does not remove members. Absent means "cannot", which is the safe reading
   * for the only action in this menu with no undo.
   */
  podeExpulsar?: boolean | undefined
  /**
   * The voice rooms this person can move to, already filtered.
   *
   * Only the menu of who is in a voice room brings them (`itensDaPessoaEmVoz`).
   * They come BEFORE expel: expel is the only gesture with no undo, and closes
   * the menu by itself.
   *
   * `category` groups destinations on the hierarchy, in their order. `disconnect`
   * is "Disconnect from call": absent, the entry doesn't appear.
   */
  mover?:
    | {
        destinos: { room: string; name: string; category?: string | undefined }[]
        mover: (room: string) => void
        desligar?: (() => void) | undefined
      }
    | undefined
  /**
   * On a community server, everyone is already friends with everyone else:
   * no friend request needed, no friendship to undo, and calls are as open
   * as messaging.
   */
  naComunidade?: boolean | undefined
  /** I blocked this person on this device. */
  ehBloqueado?: boolean | undefined
  /**
   * I moderate this channel (phase 3): I can mute other people's nicknames.
   * I can always mute my own. Comes from `mayModerate` in core.
   */
  podeModerar?: boolean | undefined
  /** The person has a nickname in this channel: we offer to remove it. */
  temApelido?: boolean | undefined
  accoes: {
    verPerfil: () => void
    copiarEndereco: () => void
    mensagem: () => void
    /** Start a call in the direct conversation. Only offered to friends. */
    chamada: () => void
    pedirAmizade: () => void
    aceitarAmizade: () => void
    desfazerAmizade: () => void
    convidarParaCanal: () => void
    alternarAdministrador: () => void
    /** Opens the confirmation dialog; the caller draws it. See the comment below. */
    expulsar: () => void
    /** Withdraw our friend request. Missing in a host that cannot do it. */
    cancelarPedido?: (() => void) | undefined
    /** Block first asks; unblock does not. When missing, entries do not show. */
    bloquear?: (() => void) | undefined
    desbloquear?: (() => void) | undefined
    /** Opens the nickname sheet. Missing in a host that cannot change it. */
    mudarApelido?: (() => void) | undefined
    tirarApelido?: (() => void) | undefined
    /** Opens the report sheet (`DenunciarSheet`). Missing in a host with no reports. */
    denunciar?: (() => void) | undefined
  }
}, opcoes: {
  /**
   * The "⋯" on the profile page: the page is the profile itself, and already has
   * Message, Call, and friend buttons. Repeating them in the menu would create
   * two paths to the same action on the same screen. We keep what the page does
   * not have. Invite and Verify, the page puts them at the top of the "⋯".
   */
  semAccoesDaPagina?: boolean | undefined
} = {}): MenuItem[] {
  const daFolha = opcoes.semAccoesDaPagina === true
  /**
   * View profile comes first, and that is why this function exists.
   *
   * The profile page was built and linked, but had no entry in this menu: when
   * someone right-clicked a name (the obvious gesture for "who is this person?"),
   * they got copy, message, and friend, but never the profile.
   */
  const itens: MenuItem[] = []
  if (!daFolha) itens.push({ label: strings.userMenu.profile, onSelect: ctx.accoes.verPerfil })
  itens.push({ label: strings.social.copyAuthor, onSelect: ctx.accoes.copiarEndereco })

  /*
    The nickname in this channel (phase 3). I mute my own; someone else's, only
    the moderator can. Before I leave, so my own menu has it. Only in a channel
    that allows moderation: a one-on-one and a feed have no nicknames, and core
    rejects them.
  */
  const apelidoAqui =
    ctx.canal !== null && ctx.canalAdmiteAdministracao && (ctx.ehEuProprio || ctx.podeModerar === true)
  if (apelidoAqui && ctx.accoes.mudarApelido) {
    itens.push({ label: strings.userMenu.nickname, separatorBefore: true, onSelect: ctx.accoes.mudarApelido })
    if (ctx.temApelido && ctx.accoes.tirarApelido) {
      itens.push({ label: strings.userMenu.nicknameRemove, onSelect: ctx.accoes.tirarApelido })
    }
  }

  /*
    Everything that follows needs another person on the other end. About myself,
    the menu stays at profile and address: requesting friendship with myself, or
    inviting myself to a channel where I already am, make no sense.
  */
  if (ctx.ehEuProprio) return itens

  /*
    When blocked, the person loses what is between us two: Message, Call,
    friendship, and invite, which core already rejects. Channel things stay
    (admin, move, kick): my block does not remove powers from someone who
    administers.
    */
  const bloqueada = ctx.ehBloqueado === true

  if (!daFolha && !bloqueada) {
    itens.push({ label: strings.userMenu.dm, separatorBefore: true, onSelect: ctx.accoes.mensagem })
    /*
      Calls to friends only, by the same rule that locks writing: private chats
      are between friends, and a call is a private conversation.
    */
    if (ctx.ehAmigo || ctx.naComunidade) itens.push({ label: strings.userMenu.call, onSelect: ctx.accoes.chamada })
  }

  /**
   * Request, accept, or undo. Never two at once.
   *
   * The entry tracks the friendship state: you don't request friendship from
   * someone already a friend, and it is here, in the same place you requested,
   * that you undo. A "request friendship" entry shown to a friend told the user
   * the interface did not know what state the relationship was in.
   */
  const relacao: MenuItem | null = ctx.naComunidade
    ? null
    : ctx.ehAmigo
    ? { label: strings.people.unfriend, onSelect: ctx.accoes.desfazerAmizade }
    : ctx.pedido === "recebido"
      ? { label: strings.userMenu.acceptFriend, onSelect: ctx.accoes.aceitarAmizade }
      : ctx.pedido === "enviado"
        ? ctx.accoes.cancelarPedido
          ? { label: strings.people.cancelRequest, onSelect: ctx.accoes.cancelarPedido }
          : null
        : { label: strings.userMenu.friend, onSelect: ctx.accoes.pedirAmizade }
  if (!daFolha && !bloqueada) {
    if (relacao) itens.push({ ...relacao, separatorBefore: true })
    itens.push({
      label: strings.userMenu.inviteToRoom,
      separatorBefore: relacao === null,
      onSelect: ctx.accoes.convidarParaCanal,
    })
  }

  /**
   * Appoint and remove, for whoever administers the open channel.
   *
   * Four conditions, and each one fixed a bug on the screen:
   *
   * - **There is a channel.** Without a channel there is no moderation to speak
   *   of, and the Friends list is not a channel.
   * - **The channel allows moderation.** A one-on-one does not: both can do
   *   everything, and appointing the other gives them nothing. See
   *   `admiteAdministracao`.
   * - **I can manage roles.** `mayManageRoles` from core, not `mayEdit`:
   *   managing rooms is the "rename" responsibility, which a role can grant
   *   alone, and someone who only manages does not appoint admins.
   * - **The person did not found the channel.** The founder cannot be removed,
   *   and offering it would promise an action that always returns an error.
   */
  if (ctx.canal !== null && ctx.canalAdmiteAdministracao && ctx.podeGerirPapeis && !ctx.ehFundador) {
    itens.push({
      label: ctx.jaEhAdministrador ? strings.userMenu.dropAdmin : strings.userMenu.makeAdmin,
      separatorBefore: true,
      onSelect: ctx.accoes.alternarAdministrador,
    })
  }

  /**
   * "Move to", ONE entry that opens the room ladder (2/11/2026, owner request:
   * "I do not want a name in the menu for each voice room I can move the user
   * to; I want a 'move to room' and then the rooms in a ladder").
   *
   * It was one "Move to ..." line per voice room, and with eight rooms the
   * person's menu became a room list. In the ladder rooms group by category,
   * like in the sidebar; rooms without a category come at the end.
   *
   * "Disconnect from call" right after, with the same power (`move`), like in
   * Discord.
   */
  const mover = ctx.mover
  if (mover && (mover.destinos.length > 0 || mover.desligar)) {
    const comCategoria = mover.destinos.filter((sala) => (sala.category ?? "") !== "")
    const semCategoria = mover.destinos.filter((sala) => (sala.category ?? "") === "")
    const escada: MenuItem[] = []
    let anterior: string | null = null
    for (const sala of comCategoria) {
      const categoria = sala.category ?? ""
      escada.push({
        label: sala.name,
        ...(categoria !== anterior ? { section: categoria } : {}),
        onSelect: () => mover.mover(sala.room),
      })
      anterior = categoria
    }
    semCategoria.forEach((sala, indice) => {
      escada.push({
        label: sala.name,
        // The label only matters when there are rooms with a category above.
        ...(indice === 0 && comCategoria.length > 0 ? { section: strings.voiceMove.noCategory } : {}),
        onSelect: () => mover.mover(sala.room),
      })
    })
    let primeiro = true
    if (escada.length > 0) {
      itens.push({ label: strings.voiceMove.menu, separatorBefore: true, submenu: escada, onSelect: () => {} })
      primeiro = false
    }
    if (mover.desligar) {
      itens.push({ label: strings.voiceMove.disconnect, separatorBefore: primeiro, onSelect: mover.desligar })
    }
  }

  /**
   * Kick, the only action in this menu that cannot be undone.
   *
   * The conditions are the same as appoint, plus one: `podeExpulsar` comes from
   * `may(canal, "expulsar")` not from `mayManageRoles`. They are separate
   * responsibilities on purpose, and someone who manages rooms does not kick
   * anyone.
   *
   * Last, after a divider, because it is the only entry here with a
   * CRYPTOGRAPHIC effect: it advances the epoch, the person can no longer read
   * what comes next, and no action brings them back without a new invite. The
   * confirmation that asks for the name written lives in the caller; here we
   * just open the door.
   */
  if (ctx.canal !== null && ctx.canalAdmiteAdministracao && ctx.podeExpulsar && !ctx.ehFundador) {
    itens.push({
      label: strings.userMenu.expel,
      separatorBefore: true,
      destructive: true,
      onSelect: ctx.accoes.expulsar,
    })
  }

  /**
   * Report, in the same block as block and just before it (Task 7 of reports).
   * Also with the person blocked: blocking does not erase what they did.
   */
  const denunciar = ctx.accoes.denunciar
  if (denunciar) itens.push({ label: strings.denunciar.menu, separatorBefore: true, onSelect: denunciar })

  /**
   * Block, last, also on the profile page (its "⋯" brings it). Destructive: it
   * cuts friendship and both feeds, and only a new request restores it.
   */
  if (bloqueada) {
    if (ctx.accoes.desbloquear) {
      itens.push({ label: strings.people.unblock, separatorBefore: !denunciar, onSelect: ctx.accoes.desbloquear })
    }
  } else if (ctx.accoes.bloquear) {
    itens.push({
      label: strings.people.block,
      separatorBefore: !denunciar,
      destructive: true,
      onSelect: ctx.accoes.bloquear,
    })
  }

  return itens
}
