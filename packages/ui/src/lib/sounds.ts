import { motor, janelaComFoco, type Motivo } from "../sons/motor.js"
import type { TipoDeSom } from "../sons/familia.js"

/**
 * The rules for call sounds, and the bridge to the new engine.
 *
 * The sound family lives in `sons/familia.ts` and the general rules (gesture,
 * focus, own, burst, activity, volume) live in `sons/motor.ts`. Here are the
 * watchers for the voice room, which decide WHO joined and left, and the old
 * name of each sound, for those who used it before.
 */

export type SoundKind = "call" | "buzz" | "voice-join" | "voice-leave" | "voice-connected"

/** The old name of each sound, in the new family. */
export const TIPO_DO_TOQUE: Record<SoundKind, TipoDeSom> = {
  call: "chamada",
  buzz: "cotovelada",
  "voice-join": "entrou",
  "voice-leave": "saiu",
  "voice-connected": "ligado",
}

/** Plays through the engine, with its rules. Returns whether it played. */
export function playSound(kind: SoundKind): boolean {
  const motivo: Motivo = motor.tocar({ tipo: TIPO_DO_TOQUE[kind] })
  return motivo === "tocou"
}

/** Waits for the first gesture to create audio. See `motor.armar`. */
export function armSounds(): () => void {
  return motor.armar()
}

/* ----------------------------------------------------------------- rules */

/**
 * When a sound is right, as pure functions — the interesting part, and the
 * part worth testing without an audio device anywhere near it.
 */

export interface CallSoundInput {
  /** The event is somebody joining, rather than leaving. */
  joined: boolean
  actorIsMe: boolean
  /** Somebody was already in that call before this event. */
  callAlreadyOngoing: boolean
  /** This device is in the call in question. */
  imInThisCall: boolean
  /**
   * The connection is still settling: arriving presences are calls that were
   * already running, not new calls starting. See `createCallRingGate`.
   */
  aAssentar: boolean
}

/**
 * A call starting in one of your channels.
 *
 * Only the first arrival rings. The second and third person joining a call
 * that is already running is not news, and would turn a busy channel into an
 * alarm clock.
 */
export function callSoundOf(input: CallSoundInput): SoundKind | null {
  if (!input.joined || input.actorIsMe) return null
  if (input.callAlreadyOngoing || input.imInThisCall) return null
  if (input.aAssentar) return null
  return "call"
}

/**
 * How long after connecting to the server entries to calls still represent what
 * was already running, not new calls starting.
 *
 * Owner complaint on October 27, 2026: "when a user joins the platform, they
 * hear the ring tone early, during loading". When connecting, presences from
 * voice rooms arrive as entries, one per active call, and `callSoundOf` had no
 * way to know they were already there: the list of who is ringing (`ringing`)
 * starts empty. Each old call rang as if it were beginning.
 *
 * Five seconds covers the `hello.ok`, the channel list, and a round trip of
 * presences, with margin. It matches the choice of `ROSTER_SETTLE_MS` on the
 * other side: a call that truly starts in those seconds stays silent, and an
 * old call ringing on load is worse than a new one with no sound.
 */
export const CALL_SETTLE_MS = 5000

/**
 * The cap on waiting for the channel list. Without it, a server that never
 * sends it would silence all calls forever.
 */
export const CALL_SETTLE_MAX_MS = 20_000

export interface CallRingGate {
  /** The connection is up (the `hello.ok`). The wait restarts, also on reconnect. */
  ligou(now: number): void
  /** The connection dropped. Nothing plays until it comes back: no presences to trust. */
  desligou(): void
  /** The channel list arrived after connecting. Presences come after it. */
  salasChegaram(now: number): void
  /** Are entries to calls arriving now still from what was already running? */
  aAssentar(now: number): boolean
}

/**
 * The gate for ring tones, at load and on reconnect.
 *
 * Closed before the first connection, for `CALL_SETTLE_MS` after it, and while
 * the channel list has not arrived (until `CALL_SETTLE_MAX_MS`). After the list
 * arrives there is still `ROSTER_SETTLE_MS`: each room's presences arrive after
 * the list that announces them.
 *
 * The gate only silences sound. The caller continues to track who is ringing
 * while the gate is closed, and that is why the old call stays silent later too:
 * when the person alone in a room announces again, five seconds later, the call
 * already counts as running.
 */
export function createCallRingGate(): CallRingGate {
  let ligouEm: number | null = null
  let salasEm: number | null = null
  return {
    ligou(now) {
      ligouEm = now
      salasEm = null
    },
    desligou() {
      ligouEm = null
      salasEm = null
    },
    salasChegaram(now) {
      // A list that arrives before connecting comes from the vault, and tells us
      // nothing about presences in this connection.
      if (ligouEm === null) return
      salasEm = now
    },
    aAssentar(now) {
      if (ligouEm === null) return true
      if (now - ligouEm < CALL_SETTLE_MS) return true
      if (salasEm === null) return now - ligouEm < CALL_SETTLE_MAX_MS
      return now - salasEm < ROSTER_SETTLE_MS
    },
  }
}

/**
 * How long after we join a voice room do arriving presences still represent the
 * list filling up, not people joining.
 *
 * This exists because of one concrete thing. People already in a room do not
 * repeat their announcement: they stop doing it once the first peer connects.
 * When we join, it is OUR announcement that makes each of them answer with
 * theirs, and that is how we learn who is there. In a room with five people five
 * announcements come at once, all because of us, all within one second. Playing
 * there would be five arrivals that never happened.
 *
 * Three seconds is a round trip to the server with plenty of margin. The cost is
 * known and it is the cheaper of the two: a real arrival in the first three
 * seconds stays silent. The engine's `RAJADA_MS` is the second line of defense,  * if a late response escapes the window, one note escapes, not five.
 */
export const ROSTER_SETTLE_MS = 3000

/** An entry or exit announcement as it appears on screen. */
export interface VoiceRoomEvent {
  /** The voice room for the announcement, keyed the same way `enter` was called. */
  room: string
  /** Entry; `false` is an ANNOUNCED exit, see `hear`. */
  joined: boolean
  who: string
  /** The announcement is ours. */
  isMe: boolean
  /** We already have an active connection with this person on this call. */
  connected: boolean
  /** Mute all is on for this device. */
  deafened: boolean
}

export interface VoiceRoomWatcher {
  /**
   * We entered a voice room, or moved to another. `null` means we left.
   *
   * Resets the roster and the clock: each room fills fresh, and the one we came
   * from has no bearing on this one.
   *
   * `moved`: a moderator moved us. They already played the sound for it
   * (`moved`), so we do not play it again when we enter the new room.
   */
  enter(room: string | null, now: number, opcoes?: { movido?: boolean }): void
  /** An announcement. Returns the sound, or `null` if there is nothing to say. */
  hear(event: VoiceRoomEvent, now: number): SoundKind | null
  /**
   * Who is in the room right now, based on the active connections this device has.
   *
   * We need this because the most common exit is not the announced kind. If
   * someone closes the app, loses the network, or shuts their laptop, they send
   * no goodbye: on our end their card stays until ICE gives up, then vanishes
   * with no event. `hear` never runs, and the room would empty in silence, that
   * is exactly what the owner reported on August 14, 2026.
   *
   * This compares who was here against who is here now and returns the sound for
   * whoever left. The roster is the source of truth: if someone left by saying
   * goodbye, `hear` already removed them and this will not play for them again.
   */
  vePresentes(quem: readonly string[], deafened: boolean): SoundKind | null
}

/**
 * Who enters and exits the voice room we are in.
 *
 * During a call you are not watching the roster, and without sound nobody notices
 * arrivals or departures. But the same signal that brings that news also brings
 * a lot of noise, and these four rules separate them:
 *
 * - **Only for us, once.** Our entry plays once, and so does our exit: it is
 *   confirmation that the action happened, like in Discord. Before October 27,
 *   2026 it was "never for us"; the owner would enter a room and hear nothing,
 *   and asked for the sound. Our own announcement repeats every five seconds when
 *   alone, so there is a gate on entry.
 * - **Only in the room we are in.** If someone entered a different room, that is
 *   the sidebar's concern, not the ears of whoever is talking.
 * - **Only people who arrive after us.** See `ROSTER_SETTLE_MS`.
 * - **Only once per person.** An announcement repeats: when alone, someone who
 *   entered will re-announce every five seconds, and reply to each entry from
 *   people with a lower address. If they are already on the roster, they do not
 *   arrive again.
 *
 * And a fifth rule, about what we do NOT hear: **the roster decides, not the
 * delay.** This paragraph used to say the opposite, that only explicit goodbye
 * made sound, and whoever vanished went silent. That was the description of a
 * bug, and it is what the owner reported on August 14, 2026: closing the tab
 * sends no `voice.leave`, so the most common exit of all was the only one with
 * no sound. `vePresentes` is the answer, and what it compares is who was here
 * against who is here, not who said goodbye.
 *
 * The cost of that is the mirror case, handled in `despedidos`: a media
 * connection that has not fallen yet cannot resurrect someone who said goodbye,
 * or the same exit plays twice, fifteen seconds apart.
 */
export function createVoiceRoomWatcher(): VoiceRoomWatcher {
  /** The room we are in, or `null`. */
  let sala: string | null = null
  /** When we arrived there. */
  let desde = 0
  /** Who we already counted as being inside. */
  const presentes = new Set<string>()
  /**
   * Who said goodbye by words, and cannot be brought back by the roster.
   *
   * Goodbye happens right away; the roster of who is in the room arrives late in
   * both directions. Someone who taps "leave call" sends `voice.leave` and
   * vanishes from the screen, but on our end their media connection stays up for
   * a few more seconds, until ICE gives up. Without this memory, the next roster
   * brings them back, `vePresentes` counts them as present again, and when the
   * connection finally drops their exit plays **again**. Two announcements for one
   * person, fifteen seconds apart, with nothing on screen to explain the second one.
   *
   * We forget it when the person announces themselves again: one goodbye closes
   * that stay and not the door.
   */
  const despedidos = new Set<string>()
  /** Has our entry played in this room yet? Our own announcement repeats. */
  let euToquei = false

  return {
    enter(room, now, opcoes) {
      sala = room
      desde = now
      presentes.clear()
      despedidos.clear()
      // Moved: entry counts as already played, one event, one sound. Exit by gesture
      // then plays as always.
      euToquei = opcoes?.movido === true
    },
    hear(event, now) {
      if (sala === null || event.room !== sala) return null
      if (event.isMe) {
        // Our entry once, our exit once; other own announcements (every five seconds,
        // alone) are silent.
        if (event.joined) {
          if (euToquei) return null
          euToquei = true
          return event.deafened ? null : "voice-join"
        }
        if (!euToquei) return null
        euToquei = false
        return event.deafened ? null : "voice-leave"
      }

      /**
       * An active connection counts as knowledge, and is not redundant.
       *
       * Of those who were already here when we arrived, only those with an address
       * higher than ours reply to our announcement; the others offer us a
       * connection directly, without announcing. They would never enter the roster
       * by any announcement, and one other person arriving later would be enough
       * for them to announce and pass as newcomers, even though they were here from
       * the start.
       */
      const conhecido = presentes.has(event.who) || event.connected

      // The roster always updates, whether it played or not: it is what we know, not
      // what we heard. Without this, turning the call sound back on would play for
      // everyone who arrived while it was off.
      if (event.joined) {
        presentes.add(event.who)
        despedidos.delete(event.who)
      } else {
        presentes.delete(event.who)
        despedidos.add(event.who)
      }

      // Whoever muted call sounds asked not to hear this call, and this is call sound.
      // See `soundOff` in `usePrefs`.
      if (event.deafened) return null

      if (!event.joined) return conhecido ? "voice-leave" : null
      if (conhecido) return null
      return now - desde < ROSTER_SETTLE_MS ? null : "voice-join"
    },
    vePresentes(quem, deafened) {
      if (sala === null) return null

      const agora = new Set(quem)
      let saiuAlguem = false
      for (const conhecido of [...presentes]) {
        if (agora.has(conhecido)) continue
        // They were here, and now they are not, and they did not say goodbye. The roster
        // updates whether it played or not, for the same reason as always: it is what we
        // know, not what we heard.
        presentes.delete(conhecido)
        saiuAlguem = true
      }
      // Anyone on the roster becomes known, even without announcement: that is how we
      // learn when someone who was here when we arrived has left, they never announce
      // to anyone. Except for those who said goodbye in words: their connection still
      // up is delay, not presence. See `despedidos`.
      for (const presente of quem) if (!despedidos.has(presente)) presentes.add(presente)

      if (!saiuAlguem) return null
      return deafened ? null : "voice-leave"
    },
  }
}

/**
 * How long to wait before trusting that the room is truly empty.
 *
 * It is the same round trip to the server that `ROSTER_SETTLE_MS` measures, seen
 * from the other side: that one asks "is the roster still filling?", this one asks
 * "has everything that could arrive, arrived?". The number is the same because the
 * distance is the same, but they are two questions, and the day one of them needs
 * a different value should not drag the other along.
 *
 * Without this wait, entering a room where people already are would say "connected"
 * at the exact moment of the click, which is precisely the moment that does not
 * matter.
 */
export const SALA_VAZIA_MS = 3000

/** The state of the call, as the screen sees it. */
export interface CallConnectedInput {
  /** The room for the call, keyed the same way `enter` was called. */
  room: string
  /** The peers on this call. Only matters if any of them connected. */
  peers: readonly { connected: boolean }[]
  /** This call has its own room; `false` on a direct conversation. See below. */
  temSala: boolean
  /** Our microphone is already open. */
  mediaPronta: boolean
  /** Mute all is on for this device. */
  deafened: boolean
}

export interface CallConnectedWatcher {
  /**
   * We entered a voice room, or moved to another. `null` means we left.
   *
   * `moved`: a moderator moved us, and the sound for it (`moved`) is already the
   * confirmation. The connection in the new room does not play `connected` on top.
   */
  enter(room: string | null, now: number, opcoes?: { movido?: boolean }): void
  /** The call state changed. Returns the sound, or `null`. */
  observe(input: CallConnectedInput, now: number): SoundKind | null
}

/**
 * Confirmation that the call really is active.
 *
 * Between tapping a voice room and having a real connection, seconds can pass,  * negotiation, ICE, retransmission. Until now the difference between "connecting"
 * and "connected" existed only on the screen, for whoever was looking at it. This
 * gives it a sound: once, at the second moment, never at the first.
 *
 * It does not collide with `voice-join`, and it is worth saying why before someone
 * merges them: that one talks about ANOTHER person and so it mutes for us, this
 * one talks about US. Announcing our own entry is still noise; confirming that a
 * connection exists is information nobody else gives us.
 *
 * Four choices, and almost all are about what does NOT play:
 *
 * - **Once per entry, not per peer.** The gate `tocado` closes at the first sound
 *   and only `enter` opens it. In a room of eight there are seven connections to
 *   establish, and seven confirmations would be the same noise that
 *   `ROSTER_SETTLE_MS` avoids on the other side.
 *
 * - **A reconnect is not an arrival.** A peer can drop to `disconnected` and come
 *   back dozens of seconds later, and the new connection goes through `connected`
 *   exactly like the first. The same gate solves this with no extra rule: it
 *   already played for this entry, it does not play again. A network hiccup is
 *   not an event for anyone's ears.
 *
 * - **Alone in a voice room is legitimate, and plays.** Entering first and waiting
 *   is half of all entries, and the question "is this working?" is the same. There
 *   is no peer to call, so the confirmation is the other kind: the microphone
 *   opened and, after `SALA_VAZIA_MS`, nobody arrived. We require `mediaPronta`
 *   on purpose, the first call in a browser stops at a microphone permission, and
 *   saying "connected" with the microphone still closed was a lie.
 *
 * - **Alone on a direct conversation does NOT play.** Same situation, opposite
 *   meaning: there, being alone means nobody answered, and a confirmation over a
 *   call still ringing said the opposite of what happened. That is what `temSala`
 *   is for.
 *
 * And the fifth rule, about the call that never connects: **there is no sound for
 * that.** As soon as a peer appears, the empty-room branch closes forever
 * (`houvePar`), and from then on only a real connection plays, if none arrives,
 * silence lasts. It is deliberate. After `CONNECT_TIMEOUT_MS` the engine already
 * says what went wrong, with the cause distinguished, in a warning you can read;
 * a failure sound added a new voice to the palette to say worse what is already
 * said, and said it to someone who at that very moment is staring at the screen
 * waiting. The absence of confirmation is the information: it did not come because
 * it did not connect.
 */
export function createCallConnectedWatcher(): CallConnectedWatcher {
  /** The room we are in, or `null`. */
  let sala: string | null = null
  /** When we tapped it, before we had a microphone or any peer. */
  let desde = 0
  /** Has it played for this entry yet. */
  let tocado = false
  /** We have seen a peer on this entry, connected or still trying. */
  let houvePar = false

  return {
    enter(room, now, opcoes) {
      sala = room
      desde = now
      tocado = opcoes?.movido === true
      houvePar = false
    },
    observe(input, now) {
      if (sala === null || input.room !== sala) return null
      if (tocado) return null

      // A peer that appears, even if it never connects, closes the "empty room" case
      // for good: from here on there is someone to call, and what we wait for is the
      // connection, not the end of a countdown. Without this, a call that failed with
      // everyone would end with the roster empty again, and the end of the failure
      // would sound like confirmation.
      if (input.peers.length > 0) houvePar = true

      const ligado = input.peers.some((par) => par.connected)
      const sozinho = !houvePar && input.temSala && input.mediaPronta && now - desde >= SALA_VAZIA_MS
      if (!ligado && !sozinho) return null

      // The gate closes whether we played or not. Someone with calls muted does not
      // keep confirmation stored for when they turn them back on, same rule as the
      // roster in `createVoiceRoomWatcher`.
      tocado = true
      return input.deafened ? null : "voice-connected"
    },
  }
}

/** Whether the window is truly in front — hidden tab, or focus elsewhere. */
export const windowIsFocused = janelaComFoco
