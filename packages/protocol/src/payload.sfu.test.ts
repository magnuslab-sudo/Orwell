import { describe, expect, it } from "vitest"
import { newRoomId } from "./names.js"
import {
  DEFAULT_ROOM,
  decodePayload,
  encodePayload,
  SALA_DA_PERGUNTA,
  TECTO_DO_AVER,
  type Payload,
} from "./payload.js"

/**
 * The two rules that the move to SFU cannot break on the payload side.
 *
 * This file exists because the cascade already cost history once and the
 * mechanism is always the same: a rejected payload is discarded silently, counts
 * as an ignored event, and ignored events in a row mark the channel deaf, see
 * `DEAF_FAILURES` in core, which needs a new place in the group and takes the
 * history with it for future secrecy. None of this gives an error anywhere: the
 * symptom is conversation disappearing.
 *
 * There are exactly two ways a payload can be rejected when two client versions
 * talk to each other, and each has its test here:
 *
 *  1. **A `t` the receiver doesn't know.** Hence the rule to never add types:
 *     what needs to be said between clients goes in optional fields of frames
 *     that already exist. The `sfu` in `voice.join` is the fourth to do it, and
 *     `muted`, `screen` and `joinId` did it before for the same reason.
 *  2. **A `t` the receiver has STOPPED knowing.** It is the same failure the
 *     other way around, and it is what Phase 4 of the plan will have on hand:
 *     `voice.offer`, `voice.answer` and `voice.ice` stop being emitted and
 *     look like dead code. Deleting them makes a new client deafen the channel
 *     for those still on a mesh version.
 *
 * What makes rule 1 safe is a property of the schema and not a habit: these
 * objects are not `strict()`, so an extra field is dropped on read at no cost.
 * It is the first test, and it fails the day someone "tidies up" the union with
 * `.strict()`.
 */

const ANUNCIO_BASE = {
  t: "voice.join",
  at: 1_700_000_000_000,
  video: false,
  sframe: true,
  alone: false,
} satisfies Payload

/** The bytes a NEWER client puts on the wire, unknown fields and all. */
function bytesDeUmClienteMaisNovo(extras: Record<string, unknown>): Uint8Array {
  // By hand, not by `encodePayload`: Zod removes keys it doesn't know, so the
  // encoder of this version could never produce a field from a future version. What
  // we want to measure is the READ.
  return new TextEncoder().encode(JSON.stringify({ ...ANUNCIO_BASE, ...extras }))
}

describe("campos novos no voice.join", () => {
  it("o esquema de hoje lê um anúncio com um campo que ainda não existe", () => {
    // `ambito` is an invented field, in the role of what Phase 2 or Phase 3 might
    // need. If this test fails, the union gained `.strict()` somewhere and all
    // version compatibility went with it.
    const lido = decodePayload(bytesDeUmClienteMaisNovo({ ambito: "abc123", camadas: 3 }))

    expect(lido.t).toBe("voice.join")
    // And it is not just not crashing: what this version knows has to arrive whole.
    // A payload that passes but loses `sframe` along the way would put the call
    // without media cipher and no one would notice.
    expect(lido).toMatchObject({ sframe: true, video: false, alone: false })
  })

  /**
   * The two fields of October 5, 2026, read as a 0.3.3 client reads them.
   *
   * The owner reported three things after a real call, and two of them needed a
   * new field on the wire: `aVer` in `voice.join` (who is this person watching
   * the screen of, so the sharer can count viewers) and `quemEsta` in
   * `voice.leave` (the question "who is in the room?", which arrivals ask because
   * the server presence notice doesn't go out to those arriving invisibly).
   *
   * Neither is a new `t`, by the rule of this file. This proves reading on the
   * side that matters: **today's schema reads both frames without the fields**, which
   * is exactly what the 0.3.3 schema does with them present, the same construct,
   * `z.object` without `strict()`, dropping keys it doesn't know.
   *
   * The proof running, with the real 0.3.3 client against this server, is
   * `scripts/e2e-cliente-antigo.mjs`.
   */
  it("o `aVer` de um cliente 0.4.0 cai na leitura de um 0.3.3, e o resto do anúncio chega inteiro", () => {
    const lido = decodePayload(bytesDeUmClienteMaisNovo({ aVer: ["@ana:orwell.pt", "@rui:orwell.pt"] }))

    expect(lido.t).toBe("voice.join")
    // What matters: the announcement is still an announcement. A `voice.join`
    // rejected because of this field was a person disappearing from the roster of
    // those on the old version, and five of them declared the channel deaf.
    expect(lido).toMatchObject({ sframe: true, video: false, alone: false })
  })

  it("e o `quemEsta` faz de um `voice.leave` a despedida de uma sala que não existe", () => {
    /*
      The question travels as a `voice.leave` for an old client to receive without
      choking. But "the goodbye of someone who was never there" was a comfortable
      half-truth: **rosters are indexed by ACCOUNT address, not device address**,
      so the device asking can have the OTHER device of the same account inside
      that call, and there the goodbye would erase it from the screen of those
      who were there.

      What makes it harmless is the ROOM: `SALA_DA_PERGUNTA` cannot be any room's
      identifier, so the old client's room filter discards it before the roster.
      That is what locks in here.
    */
    const bytes = new TextEncoder().encode(
      JSON.stringify({ t: "voice.leave", at: 1_700_000_000_000, room: SALA_DA_PERGUNTA, quemEsta: true }),
    )
    const lido = decodePayload(bytes)

    expect(lido.t).toBe("voice.leave")
    expect(lido).toMatchObject({ room: SALA_DA_PERGUNTA })
  })

  it("e a sentinela da pergunta não colide com nenhuma sala que este software gere", () => {
    /*
      The claim the guard depends on, measured against the real generator and not
      a supposition: room identifiers are `forum-` or `contio-` plus two words
      (see `roomIdFromBytes`), and the default room is the empty one. A hundred
      draws are enough for the form; what this locks in is the FORM, because it is
      what cannot change without the sentinel protecting no one.
    */
    expect(SALA_DA_PERGUNTA).not.toBe(DEFAULT_ROOM.room)
    for (let i = 0; i < 100; i++) {
      for (const kind of ["text", "voice"] as const) {
        expect(newRoomId(kind)).not.toBe(SALA_DA_PERGUNTA)
      }
    }
    // And it fits in the field: a `room` over 64 characters was the question being
    // rejected by the schema and never sent.
    expect(SALA_DA_PERGUNTA.length).toBeLessThanOrEqual(64)
  })

  it("e o `aVer` recusa uma lista acima do tecto, que é por isso que quem a escreve a corta", () => {
    /*
      The reason `TECTO_DO_AVER` is exported instead of written only in the
      schema. `encodePayload` does `Payload.parse`: a list over the cap does not
      give a truncated field, it gives an EXCEPTION from inside the presence
      announcement, `#anunciar` crashes, no `voice.join` leaves, and at 160 s
      everyone removes those from the roster who stopped beating.
    */
    const nomes = Array.from({ length: TECTO_DO_AVER }, (_, i) => `@quem-${i}:orwell.pt`)
    expect(() => encodePayload({ ...ANUNCIO_BASE, aVer: nomes })).not.toThrow()
    expect(() => encodePayload({ ...ANUNCIO_BASE, aVer: [...nomes, "@um-a-mais:orwell.pt"] })).toThrow()
  })

  it("e um `voice.who` — o `t` que NÃO se criou — seria reprovado", () => {
    // The contrast that gives meaning to the two above, and why the fields exist
    // instead of a type. A rejected payload is discarded silently, counts as an
    // ignored event, and ignored events in a row mark the channel deaf and trigger
    // the repair that erases history.
    const bytes = new TextEncoder().encode(JSON.stringify({ t: "voice.who", at: 1_700_000_000_000 }))
    expect(() => decodePayload(bytes)).toThrow()
  })

  it("um anúncio de um cliente de malha — sem `sfu` — continua a passar, e `sfu` fica por dizer", () => {
    const lido = decodePayload(encodePayload(ANUNCIO_BASE))

    expect(lido.t).toBe("voice.join")
    // Undefined, not `false`. The difference matters the day this field is read:
    // `false` is a claim about the engine on the other end, `undefined` is "didn't
    // say". A `.default(false)` here would erase the difference silently and make
    // everyone look like they are on the mesh, which is true today and stops being
    // true in a month.
    expect((lido as { sfu?: boolean }).sfu).toBeUndefined()
  })

  it("e o anúncio de um cliente de SFU faz a viagem toda com o campo intacto", () => {
    const lido = decodePayload(encodePayload({ ...ANUNCIO_BASE, sfu: true }))
    expect((lido as { sfu?: boolean }).sfu).toBe(true)
  })

  it("mas um `t` novo reprova o payload inteiro — a razão de tudo isto", () => {
    // Kept as an executable claim about cost. `voice.screen` was a type that was
    // once considered and not created; if one day someone thinks a new type is
    // cleaner, it is this behavior that it inherits.
    const inventado = new TextEncoder().encode(
      JSON.stringify({ t: "voice.sfu", at: 1_700_000_000_000, ambito: "abc123" }),
    )
    expect(() => decodePayload(inventado)).toThrow()
  })
})

/**
 * The mesh `t`s that are no longer emitted and cannot stop being read.
 *
 * This test does not prove that someone sends them, it proves that whoever
 * receives them understands them. It is the difference between a new client that
 * gracefully ignores an old client's offer and a new client that deafens its
 * channel.
 */
describe("a sinalização de malha continua legível para sempre", () => {
  it("voice.offer", () => {
    const lido = decodePayload(
      encodePayload({ t: "voice.offer", to: "@ana:orwell.pt", sdp: "v=0\r\n", sframe: true }),
    )
    expect(lido.t).toBe("voice.offer")
  })

  it("voice.answer", () => {
    const lido = decodePayload(
      encodePayload({ t: "voice.answer", to: "@ana:orwell.pt", sdp: "v=0\r\n", sframe: true }),
    )
    expect(lido.t).toBe("voice.answer")
  })

  it("voice.ice", () => {
    const lido = decodePayload(
      encodePayload({
        t: "voice.ice",
        to: "@ana:orwell.pt",
        candidate: "candidate:1 1 udp 2113937151 192.0.2.1 50000 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
      }),
    )
    expect(lido.t).toBe("voice.ice")
  })
})
