import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DEFAULT_ROOM, SalaAfk } from "@enclave/protocol"
import type { ChannelRoom, EnclaveBridge } from "../bridge.js"
import type { ChatMessage } from "../types.js"
import { categoriaVisivel, type QuemVe } from "../screens/chat/categorias.js"

/** Rooms grouped for display: the category and the rooms that belong to it. */
export interface RoomGroup {
  category: string
  rooms: ChannelRoom[]
}

/** A declared category: the order it appears in, and who can see its rooms. */
export interface CategoriaDeclarada {
  category: string
  position: number
  /** The roles that see it. Empty means everyone. See `categoriaVisivel`. */
  roles: string[]
}

/** A category as the vault returns it: with the timestamp it stored. */
type CategoriaDoCofre = CategoriaDeclarada & {
  updatedAt?: number
  /**
   * A tombstone (the category was deleted). The host collects them with live
   * ones from 3/11/2026: without them, the UI did not know the category had been
   * deleted, and republishing from before the tombstone brought it back.
   */
  removed?: true
}

/**
 * The room without the vault timestamp: the timestamp decides merging, and is
 * not drawn. Outside it, the lists this hook returns have the usual shape.
 */
function semCarimbo(sala: ChannelRoom): ChannelRoom {
  const { updatedAt: _carimbo, ...resto } = sala
  return resto
}

/**
 * The default room identifier: nothing.
 *
 * Not a pretty name for just any room, it is literally the empty `room` field
 * that all messages before rooms existed have. It is empty so the migration to
 * the rooms model needed no schema change, and that is why it cannot simply go
 * away: closing it hides it, and what is there stays there.
 */
export const SALA_POR_OMISSAO = DEFAULT_ROOM.room

/** The factory name, until someone publishes a different one. */
export const NOME_POR_OMISSAO = DEFAULT_ROOM.name

/**
 * The name of a room by its identifier.
 *
 * Exists so the call dock can say WHERE the call takes place. It floats above
 * any screen, and the channel where the call is may not be the channel being
 * read, so it gets the room list from outside and does not fetch it from
 * anywhere. `undefined` when the room is not known, never invented: a dock that
 * makes up a room name sends the caller to find a room that does not exist. The
 * exception is the default room, which always exists even with nothing
 * published, see `SALA_POR_OMISSAO`.
 */
export function nomeDaSala(salas: readonly ChannelRoom[], room: string): string | undefined {
  const achada = salas.find((sala) => sala.room === room)
  if (achada) return achada.name
  return room === SALA_POR_OMISSAO ? NOME_POR_OMISSAO : undefined
}

/**
 * The default room as it is before anyone changes it.
 *
 * The values come from the protocol and are no longer written here, and the
 * reason changed nature: while this room was only DRAWN, the factory name could
 * live alongside the drawing. Pinning a message to it makes the core PUBLISH
 * the `channel.meta` it never had, and a second copy of the name or position
 * would eventually disagree with it. The symptom would be the room changing name
 * or place in the sidebar at the first pinned message.
 */
function omissaoDeFabrica(): ChannelRoom {
  // Negative position: appears first while it is factory, and starts to obey the
  // published order as soon as someone drags it.
  return {
    room: SALA_POR_OMISSAO,
    name: NOME_POR_OMISSAO,
    category: "",
    kind: "text",
    position: DEFAULT_ROOM.position,
  }
}

/** A room and what we know about it: whether it is closed, and when we learned it. */
interface Entrada {
  sala: ChannelRoom
  closed: boolean
  /** Permanently deleted. Stays in the map as a tombstone, exits both lists. */
  removed: boolean
  at: number
  /** Came from the vault, so it already passed through the core's tombstone rule. */
  doCofre?: true
}

/**
 * The rooms of a channel, from the vault and what arrived since.
 *
 * Same pattern as `useSpaceMeta`, for the same reason: the vault responds at
 * once so the sidebar does not flicker, and in-memory messages bring what
 * changed now. The most recent timestamp wins.
 *
 * A channel with no rooms returns only the default room, and the UI handles
 * that as it always has, a single conversation. This lets channels that
 * predate this idea keep working with no migration at all.
 */
export function useRooms(
  bridge: EnclaveBridge,
  channel: string | null,
  messages: ChatMessage[],
  quemVe?: QuemVe,
): {
  /**
   * The rooms that EXIST, including hidden ones.
   *
   * Not the list that gets drawn, that is `groups`, and that is what hides. The
   * distinction is the easiest thing to lose here and the most costly: answering
   * the question "does this `room` label still name a room?" is this list, and
   * the answer decides where a message is read. See `visible` in `App.tsx`: a
   * message whose room no longer exists reads in the default room. Removing here
   * the rooms of a hidden category would dump their messages into the default
   * room, in other words, hiding a category would publish its conversations in
   * the middle of everyone's conversation. The opposite of the ask.
   */
  rooms: ChannelRoom[]
  /** The rooms grouped and ALREADY FILTERED by what `quemVe` can see. */
  groups: RoomGroup[]
  /** The closed ones, to have a way to bring them back. */
  closed: ChannelRoom[]
  /**
   * The categories with published position, and only those.
   *
   * Comes from here, not from the bridge, because the bridge only knows what is
   * in the vault: whoever tidies the list needs to know what was declared NOW,
   * including newly arrived messages. A category not in this list is one yet to
   * declare, and that is the difference that decides whether its position has a
   * place to go. See `reordenarCategorias`.
   *
   * No filtering at all, unlike `groups`: whoever administers needs to see the
   * restriction to undo it, and whoever tidies the list needs to resend the
   * roles the category already had to not delete them by accident.
   */
  categories: CategoriaDeclarada[]
  refresh: () => void
} {
  const [doCofre, setDoCofre] = useState<{
    abertas: ChannelRoom[]
    fechadas: ChannelRoom[]
    categorias: CategoriaDoCofre[]
  }>({
    abertas: [],
    fechadas: [],
    categorias: [],
  })

  // See `useSpaceMeta`: the bridge by reference, never by dependency, or a host
  // that recreates it on each render puts this running forever.
  const ponte = useRef(bridge)
  ponte.current = bridge

  const refresh = useCallback(() => {
    const abertas = channel ? (ponte.current.channels.rooms?.(channel) ?? []) : []
    const fechadas = channel ? (ponte.current.channels.closedRooms?.(channel) ?? []) : []
    // Missing `roles` means an older host, and reads as empty list, that is, a
    // category for everyone. None hides because the host cannot speak about this,
    // which fails in the right direction.
    const categorias = channel
      ? (ponte.current.channels.categories?.(channel) ?? []).map((entrada) => ({
          category: entrada.category,
          position: entrada.position,
          roles: entrada.roles ?? [],
          ...(typeof entrada.updatedAt === "number" ? { updatedAt: entrada.updatedAt } : {}),
          ...(entrada.removed === true ? { removed: true as const } : {}),
        }))
      : []
    setDoCofre((actual) =>
      mesmasSalas(actual.abertas, abertas) &&
      mesmasSalas(actual.fechadas, fechadas) &&
      mesmasCategorias(actual.categorias, categorias)
        ? actual
        : { abertas, fechadas, categorias },
    )
  }, [channel])

  useEffect(refresh, [refresh])

  /**
   * Everything we know about the rooms of this channel, closed ones included.
   *
   * The closed ones stay in the map instead of leaving: a closed room still
   * exists, and we need to know it exists to be able to reopen it. The next step
   * is what separates them.
   */
  const conhecidas = useMemo(() => {
    const porId = new Map<string, Entrada>()
    // The vault no longer returns deleted ones: `roomsOf` and `closedRoomsOf` skip
    // tombstones. What arrives as a message can still bring one.
    //
    // **With the vault timestamp, not with 0** (3/11/2026, "info from some text
    // channels disappears"). Who enters the shared channel makes the others say the
    // rooms again, with the original timestamp, and who says them may have a
    // stale vault. The core throws away the old copy (`venceCarimbo`); with 0 here,
    // it would win on screen, and the room would change name, group or vanish until
    // the right copy arrives. An older host does not send the timestamp: reads as 0,
    // as always.
    for (const sala of doCofre.abertas) {
      porId.set(sala.room, { sala: semCarimbo(sala), closed: false, removed: false, at: sala.updatedAt ?? 0, doCofre: true })
    }
    for (const sala of doCofre.fechadas) {
      porId.set(sala.room, { sala: semCarimbo(sala), closed: true, removed: false, at: sala.updatedAt ?? 0, doCofre: true })
    }

    for (const message of messages) {
      if (message.payload.t !== "channel.meta" || message.channel !== channel) continue
      const bruto = message.payload as {
        room?: unknown
        name?: unknown
        category?: unknown
        kind?: unknown
        layout?: unknown
        position?: unknown
        closed?: unknown
        removed?: unknown
        updatedAt?: unknown
        afk?: unknown
      }
      // The empty identifier is the default room and is a valid value: this is how it
      // gets its own name and how it closes.
      if (typeof bruto.room !== "string" || typeof bruto.name !== "string") continue
      const at = typeof bruto.updatedAt === "number" ? bruto.updatedAt : 0
      const conhecida = porId.get(bruto.room)
      if (conhecida && conhecida.at > at) continue
      porId.set(bruto.room, {
        at,
        closed: bruto.closed === true,
        removed: bruto.removed === true,
        sala: {
          room: bruto.room,
          name: bruto.name,
          category: typeof bruto.category === "string" ? bruto.category : "",
          kind: bruto.kind === "voice" ? "voice" : "text",
          /**
           * The layout comes from the thread, not just the vault.
           *
           * This branch is what renders a room that was just created or
           * changed by someone else, before the vault is reread. Without this
           * line, a ticket room appeared as a text room until the next reread, and the coercion that was here, `kind === "voice"
           * ? "voice" : "text"`, did it without a warning the compiler could catch. The key only exists when there is a layout: absent and empty both read as the usual conversation.
           */
          ...(typeof bruto.layout === "string" && bruto.layout ? { layout: bruto.layout } : {}),
          position: typeof bruto.position === "number" ? bruto.position : 0,
          // The AFK mark comes from the feed for the same reason as the kind. See the end.
          ...(bruto.kind === "voice" && SalaAfk.safeParse(bruto.afk).success
            ? { afk: SalaAfk.parse(bruto.afk) }
            : {}),
        },
      })
    }

    /*
      At most one AFK room per channel, by the core's rule (`#salaAfkDe`): the
      most recent declaration wins, and on a tie the larger identifier wins. What
      came from the vault already passed through it (timestamp 0); what arrived
      as a message has not yet, and is newer than the vault.
    */
    let vencedora: { room: string; at: number } | null = null
    for (const [room, entrada] of porId) {
      if (!entrada.sala.afk || entrada.closed || entrada.removed) continue
      if (vencedora && (entrada.at < vencedora.at || (entrada.at === vencedora.at && room < vencedora.room))) continue
      vencedora = { room, at: entrada.at }
    }
    for (const [room, entrada] of porId) {
      if (entrada.sala.afk && room !== vencedora?.room) {
        const { afk: _perdeu, ...semAfk } = entrada.sala
        porId.set(room, { ...entrada, sala: semAfk })
      }
    }

    return porId
  }, [doCofre, messages, channel])

  /**
   * The declared categories, with what arrived to them by message.
   *
   * A declared category exists even with no rooms, that is why the record
   * exists. The removed declaration (`removed`) disappears from here, but that
   * does not delete the category: if there are rooms with that name written in,
   * it keeps grouping, because what defines it is still that text.
   */
  const declaradas = useMemo(() => {
    const porNome = new Map<string, { position: number; roles: string[]; removed: boolean; at: number }>()
    // With the vault timestamp, for the same reason as rooms (above).
    for (const entrada of doCofre.categorias) {
      porNome.set(entrada.category, {
        position: entrada.position,
        roles: entrada.roles,
        removed: entrada.removed === true,
        at: entrada.updatedAt ?? 0,
      })
    }
    for (const message of messages) {
      if (message.payload.t !== "channel.category" || message.channel !== channel) continue
      const bruto = message.payload as {
        category?: unknown
        position?: unknown
        roles?: unknown
        removed?: unknown
        updatedAt?: unknown
      }
      if (typeof bruto.category !== "string" || bruto.category.length === 0) continue
      const at = typeof bruto.updatedAt === "number" ? bruto.updatedAt : 0
      const conhecida = porNome.get(bruto.category)
      if (conhecida && conhecida.at > at) continue
      porNome.set(bruto.category, {
        at,
        position: typeof bruto.position === "number" ? bruto.position : 0,
        /**
         * Missing is empty, and empty is everyone.
         *
         * A declaration published by a client that does not know the field hides
         * nothing, and that is what virtually all already recorded declarations
         * are. Reading it the other way would wipe the sidebar of all channels
         * that already exist on first startup after this version.
         */
        roles: Array.isArray(bruto.roles) ? bruto.roles.filter((papel): papel is string => typeof papel === "string") : [],
        removed: bruto.removed === true,
      })
    }
    return porNome
  }, [doCofre, messages, channel])

  /**
   * The rooms that show, with the default one among the others.
   *
   * It goes into the same sort as all of them, not stuck to the top by force:
   * with name, category and position published, it is a room like any other and
   * sorts like any other. With nothing published, the factory position puts it
   * at the head, which is where it has always been.
   */
  const rooms = useMemo<ChannelRoom[]>(() => {
    const omissao = conhecidas.get(SALA_POR_OMISSAO)
    const visiveis = [...conhecidas.values()]
      .filter((entrada) => !entrada.closed && !entrada.removed)
      .map((entrada) => semCategoriaApagada(entrada))
    /**
     * With nothing published about it, the default room exists anyway, and it
     * exists even if someone publishes a tombstone with the empty identifier.
     *
     * The core refuses to publish that tombstone, but the core is OURS: a
     * modified client on the other side can send it, and without this line it
     * would delete from the screen the only room that must not disappear. The
     * refusal here is the second half of the same invariant.
     */
    if (!omissao || omissao.removed) visiveis.push(omissaoDeFabrica())
    return visiveis.sort(
      (a, b) => a.category.localeCompare(b.category) || a.position - b.position || a.name.localeCompare(b.name),
    )
  }, [conhecidas, declaradas])

  /**
   * The core's rule for tombstones (`#categoriaDaSala`): a room said BEFORE its
   * category's tombstone loses its category; said after, someone is creating it
   * again, and it counts. What comes from the vault already passed through it;
   * what comes as a message has not yet.
   */
  function semCategoriaApagada(entrada: Entrada): ChannelRoom {
    if (entrada.doCofre) return entrada.sala
    const lapide = entrada.sala.category ? declaradas.get(entrada.sala.category) : undefined
    if (lapide?.removed && lapide.at > entrada.at) return { ...entrada.sala, category: "" }
    return entrada.sala
  }

  const closed = useMemo<ChannelRoom[]>(
    () =>
      [...conhecidas.values()]
        .filter((entrada) => entrada.closed && !entrada.removed)
        .map((entrada) => semCategoriaApagada(entrada))
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    [conhecidas, declaradas],
  )


  /**
   * The rooms grouped, and empty categories among them.
   *
   * An empty category must appear: it is where rooms are dropped, and a target
   * you cannot see is not a target at all. Without this, "create category" would
   * make an invisible thing and the next gesture, dragging a room into it,    * would have nowhere to go.
   *
   * Declaration order beats alphabetical when it exists. Before, categories
   * sorted by name because there was nothing else to sort by; now whoever
   * declares them says what order they appear in.
   */
  const groups = useMemo(() => {
    const porCategoria = new Map<string, ChannelRoom[]>()
    // Declared ones first, so empty ones exist before there are rooms.
    for (const [nome, entrada] of declaradas) {
      if (!entrada.removed) porCategoria.set(nome, [])
    }
    for (const sala of rooms) {
      const lista = porCategoria.get(sala.category)
      if (lista) lista.push(sala)
      else porCategoria.set(sala.category, [sala])
    }

    const ordem = (nome: string): number => declaradas.get(nome)?.position ?? Number.MAX_SAFE_INTEGER
    return (
      [...porCategoria.entries()]
        .map(([category, salas]) => ({ category, rooms: esconderSePreciso(category, salas) }))
        /*
          A group disappears when it has no rooms, and that is how the hidden
          category disappears, without a second rule to say it. The condition
          already existed for the nameless group; now it applies to all, because
          a DECLARED empty category keeps showing (it is where rooms are dropped)
          but a hidden category went empty for another reason.
        */
        .filter((grupo) => grupo.rooms.length > 0 || (grupo.category !== "" && visivel(grupo.category)))
        .sort(
          (a, b) =>
            // No category always comes first: these are loose rooms, and that is where
            // they have always been.
            Number(a.category !== "") - Number(b.category !== "") ||
            ordem(a.category) - ordem(b.category) ||
            a.category.localeCompare(b.category),
        )
    )

    /** Is this category for the eyes of whoever is looking? */
    function visivel(category: string): boolean {
      // With no one identified, nothing hides. It is the old behavior, and fails in
      // the right direction: hiding rooms from someone we do not know is would break
      // the list without serving any purpose.
      if (!quemVe) return true
      return categoriaVisivel(declaradas.get(category)?.roles, quemVe)
    }

    /**
     * The rooms of a hidden category, except the one that never hides.
     *
     * **The default room always stays.** It is the one with empty identifier, it
     * is where messages without a label and messages from a deleted room fall,
     * and without it there is no ground: hiding it would leave a channel where
     * part of the messages have nowhere to read. Someone can publish a `category`
     * to it (and `useRooms.test` proves it happens), so the exception must be
     * here and not in an assumption about where it lives.
     *
     * A hidden category that has the default room still appears for that reason,
     * only with it. It is honest: the room is there, it must be reachable, and
     * moving it to another group was tidying for someone who did not ask.
     */
    function esconderSePreciso(category: string, salas: ChannelRoom[]): ChannelRoom[] {
      if (visivel(category)) return salas
      return salas.filter((sala) => sala.room === SALA_POR_OMISSAO)
    }
  }, [rooms, declaradas, quemVe])

  /**
   * Declared rooms, in list form, excluding any that were removed.
   *
   * A removed room drops out of here, which is the intended behavior: it no longer
   * has a published position, so it reverts to being an undeclared room, which
   * is exactly what happens if other rooms continue to name it.
   */
  const categories = useMemo<CategoriaDeclarada[]>(
    () =>
      [...declaradas.entries()]
        .filter(([, entrada]) => !entrada.removed)
        .map(([category, entrada]) => ({ category, position: entrada.position, roles: entrada.roles })),
    [declaradas],
  )

  return { rooms, groups, closed, categories, refresh }
}

/** Two category lists with the same content? See `refresh`. */
function mesmasCategorias(a: CategoriaDoCofre[], b: CategoriaDoCofre[]): boolean {
  if (a.length !== b.length) return false
  return a.every((entrada, i) => {
    const outra = b[i]
    return (
      outra !== undefined &&
      outra.category === entrada.category &&
      outra.position === entrada.position &&
      // Roles too: otherwise changing visibility would not trigger a redraw. The state
      // would stay the same as before and `setDoCofre` would return the same object.
      // Comparing by text is enough, the lists are short and always come in order from
      // the same side.
      outra.roles.join(" ") === entrada.roles.join(" ") &&
      // And the timestamp: it decides whether a message in memory is still valid.
      outra.updatedAt === entrada.updatedAt &&
      outra.removed === entrada.removed
    )
  })
}

/** Two room lists with the same content? See `refresh`. */
function mesmasSalas(a: ChannelRoom[], b: ChannelRoom[]): boolean {
  if (a.length !== b.length) return false
  return a.every((sala, i) => {
    const outra = b[i]
    return (
      outra !== undefined &&
      outra.room === sala.room &&
      outra.name === sala.name &&
      outra.category === sala.category &&
      outra.kind === sala.kind &&
      outra.position === sala.position &&
      outra.layout === sala.layout &&
      outra.afk?.minutos === sala.afk?.minutos &&
      outra.updatedAt === sala.updatedAt
    )
  })
}
