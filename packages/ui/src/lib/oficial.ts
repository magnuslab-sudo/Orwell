/**
 * The official channel: something that is DERIVED, never something declared.
 *
 * The obvious temptation was a field, `official: true` inside `space.meta`, and
 * that's exactly the wrong thing to do. The one who publishes `space.meta` is a
 * client, and any member of any channel can publish whatever they want there
 * (see `useSpaceMeta`, which spells it out). A seal that writes itself
 * distinguishes nothing: it would only distinguish whoever remembered to write
 * it, and along the way it teaches people to trust a symbol that anyone can
 * draw. It's worse than having no seal at all.
 *
 * What this file does instead is read something that already exists: the
 * server announces the common channel in `hello.ok`, `session.ts` stores it in
 * `#commonRoom` and passes it along. A channel is official if and only if it's
 * what the server this app is connected to announces as common.
 *
 * That can't be faked without being the server, and whoever is the server was
 * already chosen by the user when they created the account, because their
 * address derives from the server where it was born and never changes. There's
 * no new authority being invented here: there's existing authority being shown
 * on screen.
 *
 * What this is NOT, and worth keeping clear: it's not a cryptographic promise.
 * The server could announce something else, and the core's `#acceptCommonRoom`
 * exists precisely to limit the damage. It's the same nature that channel roles
 * have, a deal kept by honest clients, and the seal's text says that instead of
 * hiding it.
 */

/**
 * The name of the official channel while no one inside publishes another.
 *
 * By default, not by force: the day someone with a place there publishes a
 * name, that's the one we read, like any other channel. What never happens is
 * the raw identifier showing up where the name should be, the identifier is
 * plumbing, it comes from the server as standard, nobody chooses it and nobody
 * reads it on screen.
 */
export const NOME_CANAL_OFICIAL = "Orwell"

/**
 * The ROOM where bugs are reported, by name.
 *
 * Room not channel: it's a text subdivision inside the common channel, and the
 * difference is the whole hierarchy, channel, category, room.
 *
 * By NAME not by identifier: the UI points to the place if it exists, and the
 * one who creates it is the client that won the arbitration of the common
 * channel (see `SALAS_DO_CANAL_COMUM`, in the core), which could be an older
 * version of this, or none. Looking by name makes the text appear when it's true
 * and disappear when it's not, with no coordination between the two sides.
 */
export const NOME_SALA_DE_AVARIAS = "avarias"

/**
 * The TEXT ROOM where the official channel shows the news for each version.
 *
 * By name, for the same reason as `NOME_SALA_DE_AVARIAS`: the one who creates
 * it is the one with a place in the common channel, not a coordination between
 * versions. Normalized (lowercase, no accents) because the name is written
 * "anúncios" and someone writes it "Anuncios" when creating the room; both are
 * the same room.
 *
 * The name alone is not enough, and that's on purpose: it only counts in the
 * official channel (`ehCanalOficial`). A room called "announcements" in another
 * channel is normal chat; without this guard, anyone could get a room that
 * speaks with Orwell's voice just by giving it this name.
 */
export const NOME_SALA_DE_ANUNCIOS = "anuncios"

/**
 * The names the room can have. "Release notes" since 2 November 2026
 * (owner's order); "anúncios" still works, so the room doesn't lose its
 * place between the new version and the name change. With hyphen or
 * space, because a room's name is written both ways.
 */
export const NOMES_DA_SALA_DE_ANUNCIOS: readonly string[] = [NOME_SALA_DE_ANUNCIOS, "release notes", "release-notes"]

export function ehSalaDeAnuncios(nome: string): boolean {
  const normal = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
  return NOMES_DA_SALA_DE_ANUNCIOS.includes(normal)
}

/**
 * Is this channel the common channel the server announced?
 *
 * Equality check and nothing more, on purpose. Anything smarter (a prefix, a
 * suffix, a reserved name) would be a pattern to imitate, and from there a
 * channel created by someone else could dress up as official just by being
 * called the right way.
 */
export function ehCanalOficial(
  channel: string | null | undefined,
  commonRoom: string | null | undefined,
): boolean {
  if (!channel || !commonRoom) return false
  return channel === commonRoom
}
