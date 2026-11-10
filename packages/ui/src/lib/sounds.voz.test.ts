import { describe, expect, it } from "vitest"
import { createVoiceRoomWatcher } from "./sounds.js"

/**
 * Who enters and exits the room we are in.
 *
 * Owner complaint, August 14, 2026: "there is no sound when a user disconnects
 * from a room". The sound exists in the engine (`voice-leave`, G5 down to D5) and
 * the logic that picks it also exists, but the watcher only plays the exit of
 * people it KNOWS, and the way to know someone was too narrow.
 *
 * These tests cover the four ways a person becomes known, and the file had none:
 * `createVoiceRoomWatcher` had no tests at all, and it decides all the sounds in
 * a voice room.
 */

const SALA = "!canal:s|voz"
const EU = "@eu:s"
const OUTRO = "@outro:s"

/** The watcher just entered a room, clock in hand. */
function numaSala(agora = 100_000): ReturnType<typeof createVoiceRoomWatcher> {
  const vigia = createVoiceRoomWatcher()
  vigia.enter(SALA, agora)
  return vigia
}

/** An entry or exit event, with what the app knows at the moment. */
function evento(over: Partial<Parameters<ReturnType<typeof createVoiceRoomWatcher>["hear"]>[0]> = {}) {
  return {
    room: SALA,
    joined: true,
    who: OUTRO,
    isMe: false,
    connected: false,
    deafened: false,
    ...over,
  }
}

describe("o som de quem sai da sala", () => {
  it("toca quando sai alguém que entrou depois de nós", () => {
    // The easy path: we saw them enter, so we know they were here.
    const vigia = numaSala()
    vigia.hear(evento({ joined: true }), 200_000)

    expect(vigia.hear(evento({ joined: false }), 300_000)).toBe("voice-leave")
  })

  it("toca quando sai alguém que já cá estava e com quem tínhamos ligação", () => {
    const vigia = numaSala()

    expect(vigia.hear(evento({ joined: false, connected: true }), 300_000)).toBe("voice-leave")
  })

  it("TOCA quando sai alguém que já cá estava e cuja ligação já caiu", () => {
    /*
      The report case, and what was missing.
      
      Those already there when we arrived never announce themselves to us: of
      those present, only ones with higher addresses respond to our announcement;
      the others offer us a connection directly. There is never a `joined` for
      them.
      
      And when that person leaves, the connection drops first or at the same time.
      The `connected` that comes with the leave event is already false. Without
      `joined` and without `connected`, the watcher did not recognize them as
      someone who was here, and their departure was silent.
      
      That is: the departure only sounded to those who had joined after we did.
      In a room where you arrive midway, that is almost nobody.
      */
    const vigia = numaSala()
    // We saw them connected at some earlier moment, which is what actually happens:
    // their card was on the screen.
    vigia.hear(evento({ joined: true, connected: true }), 150_000)

    expect(vigia.hear(evento({ joined: false, connected: false }), 300_000)).toBe("voice-leave")
  })

  it("não toca pela saída de alguém que nunca soubemos que cá estava", () => {
    // A `voice.leave` from a phantom session, or from someone who joined and left
    // before we noticed them. Firing here is noise about a person who, for the
    // listener, was never in the room.
    const vigia = numaSala()

    expect(vigia.hear(evento({ joined: false, connected: false }), 300_000)).toBeNull()
  })

  it("toca uma vez pela nossa entrada e uma vez pela nossa saída, e não pelos anúncios repetidos", () => {
    // Request from the owner (October 27, 2026): "I want sound when the user
    // themselves joins the channel". The user's own announcement repeats every
    // five seconds while alone; only the first one plays.
    const vigia = numaSala()

    expect(vigia.hear(evento({ joined: true, isMe: true }), 100_100)).toBe("voice-join")
    expect(vigia.hear(evento({ joined: true, isMe: true }), 105_100)).toBeNull()
    expect(vigia.hear(evento({ joined: true, isMe: true }), 110_100)).toBeNull()
    expect(vigia.hear(evento({ joined: false, isMe: true }), 300_000)).toBe("voice-leave")
    expect(vigia.hear(evento({ joined: false, isMe: true }), 300_100)).toBeNull()
  })

  it("com o som das chamadas desligado, a nossa entrada não toca", () => {
    const vigia = numaSala()
    expect(vigia.hear(evento({ joined: true, isMe: true, deafened: true }), 100_100)).toBeNull()
  })

  it("não toca com o som das chamadas desligado, mas continua a saber quem está cá", () => {
    // The silence is of the sound, not the count: turning the sound back on cannot
    // make everyone who joined in the meantime play.
    const vigia = numaSala()
    expect(vigia.hear(evento({ joined: true, deafened: true }), 200_000)).toBeNull()

    expect(vigia.hear(evento({ joined: false, deafened: false }), 300_000)).toBe("voice-leave")
  })

  it("ignora o que acontece noutra sala", () => {
    const vigia = numaSala()

    expect(vigia.hear(evento({ room: "!outro:s|voz", joined: false, connected: true }), 300_000)).toBeNull()
  })
})

/**
 * The departure that nobody announces, which is the most common of all.
 *
 * Those who close the app, lose the network, or close the laptop send no
 * goodbye. On our side the card stays until ICE gives up, then disappears
 * without a single event. The `hear` is never called. The room emptied in
 * silence, and that is what the owner reported: "there is no sound when a
 * user disconnects from the room".
 */
describe("a saída que não se anuncia", () => {
  it("toca quando alguém desaparece da lista sem se despedir", () => {
    const vigia = numaSala()
    // The list reveals who is here, even without any announcement.
    expect(vigia.vePresentes([OUTRO], false)).toBeNull()

    expect(vigia.vePresentes([], false)).toBe("voice-leave")
  })

  it("não toca duas vezes quando a pessoa se despediu antes de desaparecer", () => {
    // Orderly departure: the `hear` plays, and the list emptying afterward cannot
    // play again for the same person.
    const vigia = numaSala()
    vigia.hear(evento({ joined: true }), 200_000)
    expect(vigia.hear(evento({ joined: false }), 300_000)).toBe("voice-leave")

    expect(vigia.vePresentes([], false)).toBeNull()
  })

  it("a despedida não é desfeita pela ligação que ainda está de pé", () => {
    /*
      The case of two notifications from the same person, fifteen seconds apart.

      Those who press "leave call" send goodbye and disappear from the screen,
      but their media connection stays up until ICE gives up. The next list still
      shows them. Without memory of the goodbye, the watcher counted them as
      present again. When the connection finally dropped, their departure played
      again, with nothing on the screen to explain it.
    */
    const vigia = numaSala()
    vigia.hear(evento({ joined: true }), 200_000)
    expect(vigia.hear(evento({ joined: false }), 300_000)).toBe("voice-leave")

    // The connection is still there. This is lag, not presence.
    expect(vigia.vePresentes([OUTRO], false)).toBeNull()

    expect(vigia.vePresentes([], false)).toBeNull()
  })

  it("mas quem se despede e volta a entrar conta outra vez", () => {
    // A goodbye closes that stay, not the gate.
    const vigia = numaSala()
    vigia.hear(evento({ joined: true }), 200_000)
    vigia.hear(evento({ joined: false }), 300_000)
    vigia.hear(evento({ joined: true }), 400_000)

    expect(vigia.vePresentes([], false)).toBe("voice-leave")
  })

  it("uma sala nova não herda as despedidas da anterior", () => {
    const vigia = numaSala()
    vigia.hear(evento({ joined: true }), 200_000)
    vigia.hear(evento({ joined: false }), 300_000)

    vigia.enter(SALA, 400_000)
    // The same person is in there, and this time with no goodbye in between: the
    // list reveals them.
    expect(vigia.vePresentes([OUTRO], false)).toBeNull()
    expect(vigia.vePresentes([], false)).toBe("voice-leave")
  })

  it("não toca por uma lista que só cresce", () => {
    const vigia = numaSala()
    vigia.vePresentes([OUTRO], false)

    expect(vigia.vePresentes([OUTRO, "@terceiro:s"], false)).toBeNull()
  })

  it("cala-se com o som das chamadas desligado, mas continua a contar", () => {
    const vigia = numaSala()
    vigia.vePresentes([OUTRO], true)

    expect(vigia.vePresentes([], true)).toBeNull()
    // And the person really left: they do not hang around to play when sound returns.
    expect(vigia.vePresentes([], false)).toBeNull()
  })

  it("fora de uma sala não diz nada", () => {
    const vigia = createVoiceRoomWatcher()

    expect(vigia.vePresentes([], false)).toBeNull()
  })
})
