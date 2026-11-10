import { PRESENCA_VALIDA_MS } from "@enclave/client-core"

/**
 * Who is in a call, and until when that claim holds true.
 *
 * The problem this solves: leaving a call announces itself, but closing the
 * laptop, losing the network, or killing the tab announces nothing. The list of
 * who is in a call was built only on "entered" and "left", and without the
 * second the person stayed there forever, visible to all but in no call.
 *
 * Exit is not waiting for a goodbye that may never come: date each
 * presence and let it expire. Someone actually in a call reaffirms themselves every
 * `PRESENCA_REAFIRMADA_MS` (`#comecarBatimento` in
 * `call.ts`), so a presence not reaffirmed in a long time is from someone
 * who has already gone.
 *
 * **This paragraph was once false, and that is why the number below is
 * derived and not hand-written.** It said five seconds, pointed to `#anunciar`, and
 * whoever repeated `#anunciar` was a clock that existed to negotiate connections
 * and stopped as soon as there was one. With SFU it never even started.
 */

/**
 * The window, DERIVED from the rhythm at which the core reaffirms presence.
 *
 * Hand-written, it was 45,000 and the comment said it was "the same as the core's".
 * It was not the same as anything: the core's number it seemed to match, `HEARD_WINDOW_MS`,
 * measures something else (how long an announcement heard before we enter is still
 * worth answering), and the heartbeat this comment promised did not exist.
 * The `#comecarAnuncio` in `call.ts` stops at the first pair, and on the SFU path it never
 * starts. Result, reported by the owner on August 18, 2026: the list of
 * who is in each voice room emptied after forty-five
 * seconds with people still speaking, and nothing refilled it.
 *
 * **Now it lives in the core and is re-exported from here.** The window is no longer
 * just on the screen: the roster inside the call via SFU expires by the same measure, and
 * whoever expires there is `call.ts`. Two similar definitions in two packages would be
 * coding the same bug twice, and `ui` imports `client-core`,
 * not the other way around. Anyone already reading it from this module keeps reading it from this module:
 * it is just a different home. See `PRESENCA_VALIDA_MS` in `call.ts` for why the
 * number is what it is.
 */
export { PRESENCA_VALIDA_MS }

/**
 * Remove a person from all calls we know about, in any map.
 *
 * Someone who disconnects leaves any call, whether they had time to say so or not.
 * `voice.leave` only removes someone who pressed disconnect, and closing the app,
 * sleeping the laptop, or losing the network tells no one. The presence announcement
 * from the server is what says it, and it is immediate.
 *
 * **One function for both maps, and that is what makes it necessary.** The screen
 * tracks who is in a call by CHANNEL (`ringing`, which makes the channel ring) and by
 * ROOM (`vozPorSala`, which fills the voice room line in the sidebar). The
 * cleanup was hand-written for the first and did not exist for the second:
 * someone who closed their laptop left the channel but stayed in the room, and only the timer
 * removed them. With the window stretched to match the presence heartbeat,
 * that timer became too slow to serve as a response.
 *
 * Returns the original map when there is nothing to remove, so React does not
 * redraw because of someone who was not in any call, which is the case
 * for almost everyone who connects.
 */
export function semAPessoa(
  mapas: ReadonlyMap<string, Map<string, number>>,
  quem: string,
): Map<string, Map<string, number>> {
  let mudou = false
  const seguinte = new Map(mapas)
  for (const [onde, pessoas] of seguinte) {
    if (!pessoas.has(quem)) continue
    mudou = true
    const restantes = new Map(pessoas)
    restantes.delete(quem)
    if (restantes.size === 0) seguinte.delete(onde)
    else seguinte.set(onde, restantes)
  }
  return mudou ? seguinte : (mapas as Map<string, Map<string, number>>)
}

/** Only the presences reaffirmed within the window. */
export function presencasVivas(presencas: Map<string, number>, agora: number): Map<string, number> {
  const vivas = new Map<string, number>()
  for (const [quem, quando] of presencas) {
    // `now - when`, not the other way: a timestamp from the future is clock skew
    // between two computers, and distrusting it would remove from the list
    // someone who is actually there.
    if (agora - quando <= PRESENCA_VALIDA_MS) vivas.set(quem, quando)
  }
  return vivas
}

/** A pair in a call, in what matters for this question. */
export interface ParDaChamada {
  address: string
}

/**
 * Who this device believes is in the voice room where we are.
 *
 * **Two sources, and the second exists because of an extra sound.** The output sound was fed
 * only by the call's pairs, the media connections this device holds,
 * and that list always arrives late compared to the announcement. Someone enters, announces
 * first, and negotiates after: between the two
 * there is a moment when the person is already counted as present (the
 * announcement counted them, and that is what makes the entry tone) and is not yet a connection
 * pair. Just one pair emission in that window would make the
 * comparison conclude they had left.
 *
 * That is what we heard, and it happened live on September 10, 2026: a
 * Bruno entering a room with Ana produced, in Ana's ear, the entry tone and the exit tone
 * glued to each other. Someone who just arrived announced as having gone.
 *
 * Merging both lists is the honest reading of what we know: someone is in the room
 * if they have a connection with us OR if they announced and the announcement is still valid.
 * Leaving requires both to be missing, and that is what makes absence
 * absence and not a delay.
 *
 * **We ourselves are left out.** Pairs never include us, but announcements
 * do, because our `voice.join` comes back the way everyone else's does. Without this
 * line, entering a room would put us in the watcher's count and our exit
 * would play in our own ears, which is the only sound nobody needs to hear.
 */
export function quemEstaNaSala(
  pares: readonly ParDaChamada[],
  anunciados: ReadonlyMap<string, number> | undefined,
  eu: string | null,
  agora: number,
): string[] {
  const quem = new Set<string>()
  for (const par of pares) quem.add(par.address)
  if (anunciados) {
    // Discarded in the read, like everywhere else: with no more events
    // coming in, a stale presence would never be cleaned from the map, and that is
    // exactly the case of someone who left without saying goodbye.
    for (const pessoa of presencasVivas(new Map(anunciados), agora).keys()) quem.add(pessoa)
  }
  if (eu !== null) quem.delete(eu)
  return [...quem]
}
