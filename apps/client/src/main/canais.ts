import type { FichaDoCanal, Ticket } from "@enclave/client-core"
import type { PinnedMessage, Power, RoleColour, TicketState } from "@enclave/protocol"

/**
 * The channel operations on the main process side.
 *
 * **This is the fix for an entire missing feature, not an addition.** Until 18 de
 * August 2026 a the web channel bridge exposed 52 opera and Electron's `preload` exposed 15. Missing were 37, the rooms, the categories, the roles, the admins, the founder, channel properties, pinned messages, entire tickets, and editing and deleting a message.
 *
 * **And it didn't break**, which is what made it treacherous: the UI is written defensively (`bridge.channels.rooms?.(channel) ?? []`,
 * `mayEdit?.() ?? false`), so the absence read as "this channel has no rooms" instead of as a failure. In the installed app each channel showed exactly one room, the default, and there was no way to create another, see the ones that existed, or join a voice room that wasn't the first. It's the same family as `applyMediaPrefs` that never existed and the SFU that only the web had: the type says it exists, the runtime doesn't have it, and nothing complains.
 *
 * No `electron` anywhere inside here, and that's why the file exists separate from `index.ts`, the same reason as `sfu.ts` and `ecra.ts`. The ports come in as parameters, `index.ts` connects them to the real ones, and so the layer where the failures of this class live becomes measurable without opening a window.
 *
 * ## Two kinds of channel, and why
 *
 * Half of these operations are SYNCHRONOUS QUESTIONS: `rooms`, `mayEdit`, `roles`,
 * `pins`, `tickets` and the rest of the reads return a value, not a promise, the UI calls them in the middle of a `render`, and that's how the browser bridge delivers them, because there the session is on the same page. Here it isn't: it's on this side of the IPC.
 *
 * A `ipcMain.handle` always returns a promise, and a promise is an object, so truthy. That was exactly the flaw of the only `may*` that existed: `mayExpel` went through `invoke`, the UI read `mayExpel?.(canal) ?? false`, got a promise, and **offered to expel everyone**. A read that responds with a promise isn't half functionality: it's the wrong answer, every time.
 *
 * That's why reads go through `sendSync`, `ipcMain.on` with `event.returnValue`
 * on the other side. The cost is stated entirely: it blocks the renderer while the main process responds. It's paid because the alternative, a mirror of state pushed on every change, becomes stale exactly in the window where these questions exist to be asked, and because the renderer bridge puts a layer of caching on top of this that collapses dozens of reads of a whole `render` into one per operation and arguments. See `bridge.ts` of the renderer.
 *
 * ## The envelope, and what `structuredClone` requires
 *
 * A synchronous read can't THROW across the boundary: on the other side `sendSync` has no way to tell an exception from a response, and an exception in the middle of a `render` takes the whole screen. So each read responds with `{ ok: true, valor }` or `{ ok: false, erro }`, and whoever receives it decides, the renderer bridge logs the failure loudly and returns the safe default value, which is the same read it already made from absence.
 *
 * What crosses the IPC is CLONED (structured clone algorithm): functions, classes and anything that's not simple data don't survive, and a response that can't be cloned doesn't error on the side of the asker, it goes silent. All reads here return simple data on purpose, and `index.ts` proves it before responding. See the note in `registarLeitura`, there.
 */

/**
 * The names of channels that REQUEST something: a promise on the other side.
 *
 * One place only, not written on both sides, for the same reason as `CANAIS_SFU`:
 * a letter swapped between processes gives no compile error. Written twice, a
 * channel renamed only on the `preload` side gives an `invoke` with no handler-and
 * what you see is a button that does nothing.
 */
export const CANAIS_DE_CANAL = {
  criarSala: "channel:set-room",
  criarCategoria: "channel:set-category",
  fixar: "channel:pin",
  desafixar: "channel:unpin",
  abrirTicket: "channel:ticket-open",
  responderTicket: "channel:ticket-reply",
  estadoDoTicket: "channel:ticket-state",
  tomarTicket: "channel:ticket-take",
  largarTicket: "channel:ticket-release",
  eliminarTicket: "channel:ticket-delete",
  mudarApelido: "channel:set-nickname",
  moverVoz: "channel:move-voice",
  desligarDaVoz: "channel:disconnect-voice",
  nomearAdministrador: "channel:set-admin",
  atribuirPapeis: "channel:set-roles",
  definirPapel: "channel:define-role",
  apagarPapel: "channel:delete-role",
  ordenarPapeis: "channel:reorder-roles",
  assumirFundacao: "channel:claim-founder",
  propriedades: "channel:set-meta",
  emendarMensagem: "channel:edit-message",
  apagarMensagem: "channel:delete-message",
  eliminarCanal: "channel:remove",
} as const

/**
 * The names of channels that QUERY: value, blocking the `render`.
 *
 * Separate from the above because the channel kind is different-`sendSync` versus
 * `invoke`-and because the distinction is the whole decision this file makes. A
 * read registered on the wrong list returns a promise, and a promise is truthy:
 * `mayEdit` would end up saying yes to everyone.
 */
export const LEITURAS_DE_CANAL = {
  salas: "channel:rooms",
  salasFechadas: "channel:closed-rooms",
  categorias: "channel:categories",
  propriedades: "channel:meta",
  podeOrganizar: "channel:may-edit",
  fundador: "channel:founder",
  administradores: "channel:admins",
  papeis: "channel:roles",
  cargoDeAdministrador: "channel:admin-role",
  papeisDe: "channel:roles-for",
  podeGerirPapeis: "channel:may-manage-roles",
  fixadas: "channel:pins",
  podeFixar: "channel:may-pin",
  tickets: "channel:tickets",
  podeAtender: "channel:may-attend",
  podeDecidirTicket: "channel:may-decide-ticket",
  podeMover: "channel:may-move",
  podeConvidar: "channel:may-invite",
  podeExpulsar: "channel:may-expel",
  podeEliminar: "channel:may-delete",
  podeModerar: "channel:may-moderate",
  podeMencionarTodos: "channel:may-mention-all",
  apelidos: "channel:nicknames",
  fichas: "channel:fichas",
} as const

/** What a sync read answers with. See the envelope note above. */
export type Resposta<T> = { ok: true; valor: T } | { ok: false; erro: string }

/**
 * Prove the answer crosses IPC before handing it to Electron.
 *
 * **This is the piece `structuredClone` forces into existence.** Everything that
 * crosses this boundary gets cloned, and anything not plain data doesn't: a class
 * loses its shape, a function breaks cloning, a `Map` returned by mistake arrives
 * as something else. If cloning breaks inside Electron, the asker gets no error-
 * the read just times out, and a sync read that times out is a frozen renderer.
 *
 * Cloning here first, an impossible answer becomes a readable error with the
 * channel name in it. The price is a second clone per read; the answers this
 * bridge sends are small-rooms, roles, categories, tickets without bodies-and
 * what you buy is the difference between an error and a mystery.
 *
 * It lives here, not in the Electron connection, for two reasons: to apply to
 * ALL reads without anyone remembering to call it, and to be testable without
 * opening a window.
 */
export function provarQueAtravessa<T>(canal: string, resposta: Resposta<T>): Resposta<T> {
  try {
    return structuredClone(resposta)
  } catch (erro) {
    return { ok: false, erro: `a resposta de ${canal} não atravessa o IPC: ${(erro as Error).message}` }
  }
}

/** A room, as the core returns and accepts it. */
export interface SalaDoNucleo {
  room: string
  name: string
  category: string
  kind: "text" | "voice"
  layout?: string
  position: number
  /** The channel's AFK room. See `SalaAfk` in the protocol. */
  afk?: { minutos: number }
  /** The vault's timestamp. See `SalaListada.updatedAt` in the core. */
  updatedAt?: number
}

/**
 * The session slice this file needs.
 *
 * Written by hand and narrowly on purpose, like `sfu.ts`'s slice: it makes
 * clear how much of the session the installed app touches, and lets you test
 * the bridge without spinning up a real session. The signatures are the real
 * ones-a swapped argument order has to be a compile error, not a channel that
 * answers with the ticket subject instead of the state.
 */
export interface SessaoDeCanais {
  // ------------------------------------------------------------ as leituras
  roomsOf(channel: string): SalaDoNucleo[]
  closedRoomsOf(channel: string): SalaDoNucleo[]
  categoriesOf(channel: string): { category: string; position: number; roles: string[]; updatedAt?: number }[]
  categoryTombstonesOf(channel: string): { category: string; position: number; roles: string[]; updatedAt: number; removed: true }[]
  spaceMeta(channel: string): { name: string; topic?: string; icon?: string; updatedAt: number } | null
  fichasDosCanais(): Record<string, FichaDoCanal>
  mayEditChannel(channel: string): boolean
  founderOf(channel: string): string | null
  adminsOf(channel: string): string[]
  rolesOf(channel: string): { role: string; name: string; powers: Power[]; colour?: RoleColour; position: number }[]
  rolesFor(channel: string, address: string): string[]
  adminRole(channel: string): { name: string; colour?: RoleColour } | null
  mayManageRoles(channel: string): boolean
  pinnedOf(channel: string, room: string): PinnedMessage[]
  mayPin(channel: string): boolean
  ticketsOf(channel: string, room: string): Ticket[]
  mayDecideTicket(channel: string, room: string, ticket: string): boolean
  mayDeleteChannel(channel: string): boolean
  /** As responsabilidades: `atender`, `mover`, `convidar`, `expulsar`. */
  may(channel: string, power: Power, room?: string): boolean
  /** This person's `moderate` power (default is this account), no DMs or feeds. Phase 3. */
  mayModerate(channel: string, address?: string): boolean
  /** The channel's nicknames, by address (phase 3). */
  nicknamesOf(channel: string): Record<string, string>

  // ------------------------------------------------------------ the requests
  upsertRoom(
    channel: string,
    next: {
      room: string
      name: string
      category?: string
      kind?: "text" | "voice"
      layout?: string
      position?: number
      closed?: boolean
      removed?: boolean
      afk?: { minutos: number }
    },
  ): Promise<void>
  upsertCategory(
    channel: string,
    next: { category: string; position?: number; roles?: string[]; removed?: boolean; reordenar?: boolean },
  ): Promise<void>
  pinMessage(
    channel: string,
    room: string,
    message: { id: string; sender: string; body: string; sentAt: number },
  ): Promise<void>
  unpinMessage(channel: string, room: string, id: string): Promise<void>
  openTicket(channel: string, room: string, subject: string): Promise<string>
  replyToTicket(channel: string, room: string, ticket: string, body: string): Promise<void>
  setTicketState(channel: string, room: string, ticket: string, state: TicketState): Promise<void>
  takeTicket(channel: string, room: string, ticket: string): Promise<void>
  releaseTicket(channel: string, room: string, ticket: string): Promise<void>
  /** The tombstone of a closed ticket, for whoever moderates (phase 3). */
  deleteTicket(channel: string, room: string, ticket: string): Promise<void>
  /** Someone's nickname in this channel: themselves or whoever moderates (phase 3). */
  setNickname(channel: string, subject: string, nick: string): Promise<void>
  moveVoice(channel: string, subject: string, room: string): Promise<void>
  disconnectVoice(channel: string, subject: string): Promise<void>
  assignRole(channel: string, subject: string, admin: boolean): Promise<void>
  assignRoles(channel: string, subject: string, roles: string[]): Promise<void>
  defineRole(
    channel: string,
    next: { role: string; name: string; powers: Power[]; colour?: string; position?: number },
  ): Promise<void>
  deleteRole(channel: string, role: string): Promise<void>
  /** The role order, top to bottom (the `rank`). Founder and `admin` only. */
  reorderRoles(channel: string, ordem: string[]): Promise<void>
  claimFounder(channel: string): Promise<void>
  updateSpaceMeta(channel: string, next: { name: string; topic?: string; icon?: string }): Promise<void>
  editMessage(channel: string, target: string, body: string): Promise<void>
  deleteMessage(channel: string, target: string): Promise<void>
  deleteChannel(channel: string): Promise<void>
}

/**
 * Register a request-reply channel. `ipcMain.handle` in production.
 *
 * Generic so each connection below is written with the session method's real
 * types, not a list of `unknown` that would accept swapping argument order
 * without complaint.
 */
export interface RegistarPedido {
  <A extends unknown[], R>(canal: string, ouvinte: (...argumentos: A) => R): void
}

/**
 * Register a sync read. `ipcMain.on` with `event.returnValue` in production.
 *
 * Returns the envelope already built: whoever wires this to Electron decides
 * nothing about errors, just delivers what this file answered.
 */
export interface RegistarLeitura {
  <A extends unknown[], R>(canal: string, ouvinte: (...argumentos: A) => Resposta<R>): void
}

export interface PortasDosCanais {
  registarPedido: RegistarPedido
  registarLeitura: RegistarLeitura
  sessao: SessaoDeCanais
}

/**
 * Wire in the 37 missing operations, plus the one that was working wrong.
 *
 * Order does not matter; what matters is not missing any, and each one fails in
 * its own way and none fail with a bang:
 *
 *  - without `salas`, each channel shows only one room and there is no way to
 *    create another, the complaint that started this;
 *  - without `categorias`, the sidebar loses its layout and restricted
 *    categories stop existing, which is seeing what should not be seen;
 *  - without `podeOrganizar` and `podeGerirPapeis`, whoever administers can no
 *    longer do it in the installed app, and can still do it in the browser,
 *    which is worse than not being able to do it anywhere;
 *  - without `fixadas`, the banner at the top disappears and whoever joined
 *    after loses the only copy of what was pinned;
 *  - without tickets, the frame appears empty and whoever writes there thinks
 *    nobody has anything in hand;
 *  - without `emendarMensagem` and `apagarMensagem`, the menu entries vanish,  *    and the delete request, which is the action with a promise behind it, can
 *    no longer be done from where the person is.
 */
export function ligarCanais({ registarPedido, registarLeitura, sessao }: PortasDosCanais): void {
  /**
   * A read dressed in the envelope.
   *
   * The `try` is not decoration and not hiding: it's what stops a session locked
   * mid-operation, a vault that hasn't opened yet, or a channel that's gone from
   * crashing the `render` making the query. Whoever gets `{ ok: false }` decides
   * what to show-and logs it loud.
   */
  const leitura = <A extends unknown[], R>(canal: string, ler: (...argumentos: A) => R): void => {
    registarLeitura(canal, (...argumentos: A): Resposta<R> => {
      const resposta = ((): Resposta<R> => {
        try {
          return { ok: true, valor: ler(...argumentos) }
        } catch (erro) {
          return { ok: false, erro: (erro as Error).message }
        }
      })()
      // And we prove it crosses before it leaves here. See `provarQueAtravessa`.
      return provarQueAtravessa(canal, resposta)
    })
  }

  // ------------------------------------------------------------- as salas
  leitura(LEITURAS_DE_CANAL.salas, (channel: string) => sessao.roomsOf(channel))
  leitura(LEITURAS_DE_CANAL.salasFechadas, (channel: string) => sessao.closedRoomsOf(channel))
  // The live ones and the tombstones: the UI needs both. See `categoryTombstonesOf` in the core.
  leitura(LEITURAS_DE_CANAL.categorias, (channel: string) => [...sessao.categoriesOf(channel), ...sessao.categoryTombstonesOf(channel)])

  /*
    Create, change, close, and delete a room-all through the same gate, like in
    the browser. `removed` is the tombstone and doesn't come back; the guard for
    who can is in the core and refuses the same way, and the default room refuses
    deletion there.
    */
  registarPedido(
    CANAIS_DE_CANAL.criarSala,
    async (channel: string, next: SalaDoNucleo & { closed?: boolean; removed?: boolean }) => {
      await sessao.upsertRoom(channel, next)
      return { ok: true }
    },
  )

  registarPedido(
    CANAIS_DE_CANAL.criarCategoria,
    async (channel: string, next: { category: string; position?: number; roles?: string[]; removed?: boolean; reordenar?: boolean }) => {
      await sessao.upsertCategory(channel, next)
      return { ok: true }
    },
  )

  // ------------------------------------------------ the channel, and who runs it
  leitura(LEITURAS_DE_CANAL.propriedades, (channel: string) => sessao.spaceMeta(channel))
  // Each channel's type, from the vault (1.0 "Arca", slice 2). See `Session.fichasDosCanais`.
  leitura(LEITURAS_DE_CANAL.fichas, () => sessao.fichasDosCanais())
  leitura(LEITURAS_DE_CANAL.podeOrganizar, (channel: string) => sessao.mayEditChannel(channel))
  leitura(LEITURAS_DE_CANAL.fundador, (channel: string) => sessao.founderOf(channel))
  leitura(LEITURAS_DE_CANAL.administradores, (channel: string) => sessao.adminsOf(channel))
  leitura(LEITURAS_DE_CANAL.podeEliminar, (channel: string) => sessao.mayDeleteChannel(channel))

  registarPedido(
    CANAIS_DE_CANAL.propriedades,
    async (channel: string, next: { name: string; topic?: string; icon?: string }) => {
      await sessao.updateSpaceMeta(channel, next)
      return { ok: true }
    },
  )

  registarPedido(CANAIS_DE_CANAL.nomearAdministrador, async (channel: string, address: string, admin: boolean) => {
    await sessao.assignRole(channel, address, admin)
    return { ok: true }
  })

  registarPedido(CANAIS_DE_CANAL.assumirFundacao, async (channel: string) => {
    await sessao.claimFounder(channel)
    return { ok: true }
  })

  /*
    End the channel for everyone. Messages are NOT deleted-they're encrypted in
    each person's vault-and the UI tells them that in words before getting here.
    */
  registarPedido(CANAIS_DE_CANAL.eliminarCanal, async (channel: string) => {
    await sessao.deleteChannel(channel)
    return { ok: true }
  })

  // ------------------------------------------------------- the roles
  leitura(LEITURAS_DE_CANAL.papeis, (channel: string) => sessao.rolesOf(channel))
  leitura(LEITURAS_DE_CANAL.cargoDeAdministrador, (channel: string) => sessao.adminRole(channel))
  leitura(LEITURAS_DE_CANAL.papeisDe, (channel: string, address: string) => sessao.rolesFor(channel, address))
  leitura(LEITURAS_DE_CANAL.podeGerirPapeis, (channel: string) => sessao.mayManageRoles(channel))

  registarPedido(CANAIS_DE_CANAL.atribuirPapeis, async (channel: string, address: string, roles: string[]) => {
    await sessao.assignRoles(channel, address, roles)
    return { ok: true }
  })

  registarPedido(
    CANAIS_DE_CANAL.definirPapel,
    async (channel: string, next: { role: string; name: string; powers: Power[]; colour?: string; position?: number }) => {
      await sessao.defineRole(channel, next)
      return { ok: true }
    },
  )

  registarPedido(CANAIS_DE_CANAL.apagarPapel, async (channel: string, role: string) => {
    await sessao.deleteRole(channel, role)
    return { ok: true }
  })

  registarPedido(CANAIS_DE_CANAL.ordenarPapeis, async (channel: string, ordem: string[]) => {
    await sessao.reorderRoles(channel, ordem)
    return { ok: true }
  })

  /*
    The responsibilities, one question each.

    None of them is the guard: the guard lives in the core and refuses the same
    way. This is just what the UI needs to know to not offer a gesture that's
    going to be refused-and absence reads as "can't", which is failure in the
    safe direction and this bridge's rule.
  */
  leitura(LEITURAS_DE_CANAL.podeAtender, (channel: string) => sessao.may(channel, "atender"))
  // With whom: the conversation folds ask for the sender of each tombstone.
  leitura(LEITURAS_DE_CANAL.podeModerar, (channel: string, address: string) => sessao.mayModerate(channel, address))
  leitura(LEITURAS_DE_CANAL.apelidos, (channel: string) => sessao.nicknamesOf(channel))
  leitura(LEITURAS_DE_CANAL.podeMover, (channel: string) => sessao.may(channel, "mover"))
  leitura(LEITURAS_DE_CANAL.podeMencionarTodos, (channel: string, room: string) =>
    sessao.may(channel, "mencionartodos", room),
  )
  leitura(LEITURAS_DE_CANAL.podeConvidar, (channel: string) => sessao.may(channel, "convidar"))
  /*
    `expulsar` was on the REQUESTS side, and it is the bug this file fixes
    instead of adding to: `ipcMain.handle` answers with a promise, the UI reads
    `mayExpel?.(canal) ?? false`, and a promise is truthy, so the installed app
    offered to expel everyone, including those the core would refuse. The refusal
    happened; what did not happen was the person knowing, before trying, that
    they could not.
  */
  leitura(LEITURAS_DE_CANAL.podeExpulsar, (channel: string) => sessao.may(channel, "expulsar"))

  registarPedido(CANAIS_DE_CANAL.moverVoz, async (channel: string, address: string, room: string) => {
    await sessao.moveVoice(channel, address, room)
    return { ok: true }
  })

  registarPedido(CANAIS_DE_CANAL.desligarDaVoz, async (channel: string, address: string) => {
    await sessao.disconnectVoice(channel, address)
    return { ok: true }
  })

  // ------------------------------------------------------- as fixadas
  leitura(LEITURAS_DE_CANAL.fixadas, (channel: string, room: string) => sessao.pinnedOf(channel, room))
  leitura(LEITURAS_DE_CANAL.podeFixar, (channel: string) => sessao.mayPin(channel))

  /*
    The text copy travels with the pin, and that's why the whole message crosses,
    not just the ID: someone who joined after will never be able to open the
    original, and a list of IDs for messages they can't read is an empty list
    with extra steps.
  */
  registarPedido(
    CANAIS_DE_CANAL.fixar,
    async (channel: string, room: string, message: { id: string; sender: string; body: string; sentAt: number }) => {
      await sessao.pinMessage(channel, room, message)
      return { ok: true }
    },
  )

  registarPedido(CANAIS_DE_CANAL.desafixar, async (channel: string, room: string, id: string) => {
    await sessao.unpinMessage(channel, room, id)
    return { ok: true }
  })

  // ---------------------------------------------------- the tickets
  leitura(LEITURAS_DE_CANAL.tickets, (channel: string, room: string) => sessao.ticketsOf(channel, room))
  leitura(LEITURAS_DE_CANAL.podeDecidirTicket, (channel: string, room: string, ticket: string) =>
    sessao.mayDecideTicket(channel, room, ticket),
  )

  /* Returns the ticket ID. The opener needs to know which one to open next.
     Making it up on the interface side would mean keeping two copies. */
  registarPedido(CANAIS_DE_CANAL.abrirTicket, async (channel: string, room: string, subject: string) => ({
    ok: true,
    id: await sessao.openTicket(channel, room, subject),
  }))

  registarPedido(
    CANAIS_DE_CANAL.responderTicket,
    async (channel: string, room: string, ticket: string, body: string) => {
      await sessao.replyToTicket(channel, room, ticket, body)
      return { ok: true }
    },
  )

  registarPedido(
    CANAIS_DE_CANAL.estadoDoTicket,
    async (channel: string, room: string, ticket: string, state: TicketState) => {
      await sessao.setTicketState(channel, room, ticket, state)
      return { ok: true }
    },
  )

  registarPedido(CANAIS_DE_CANAL.tomarTicket, async (channel: string, room: string, ticket: string) => {
    await sessao.takeTicket(channel, room, ticket)
    return { ok: true }
  })

  registarPedido(CANAIS_DE_CANAL.largarTicket, async (channel: string, room: string, ticket: string) => {
    await sessao.releaseTicket(channel, room, ticket)
    return { ok: true }
  })

  registarPedido(CANAIS_DE_CANAL.eliminarTicket, async (channel: string, room: string, ticket: string) => {
    await sessao.deleteTicket(channel, room, ticket)
    return { ok: true }
  })

  registarPedido(CANAIS_DE_CANAL.mudarApelido, async (channel: string, subject: string, nick: string) => {
    await sessao.setNickname(channel, subject, nick)
    return { ok: true }
  })

  // ------------------------------------------------- emendar e apagar
  /*
    Deletion is a request. The interface says this in words before anyone clicks.
    It leaves the screen of whoever handles it. Readers keep what they've seen.
    A modified client ignores it.
  */
  registarPedido(CANAIS_DE_CANAL.emendarMensagem, async (channel: string, target: string, body: string) => {
    await sessao.editMessage(channel, target, body)
    return { ok: true }
  })

  registarPedido(CANAIS_DE_CANAL.apagarMensagem, async (channel: string, target: string) => {
    await sessao.deleteMessage(channel, target)
    return { ok: true }
  })
}
