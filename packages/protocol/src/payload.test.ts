import { describe, expect, it } from "vitest"
import { z } from "zod"
import { BUZZ_INTERVAL_MS, BUZZ_MAX_AGE_MS, decodePayload, encodePayload, Payload, POWERS, ROLE_COLOURS, SALA_DA_PERGUNTA } from "./payload.js"

/**
 * These tests exist because of a bug that shipped: `publishProfile` wrote the
 * avatar data URL into `avatar.url`, which is capped at 2048 characters, while the
 * field built for inline bytes — `avatar.inline` — allows four megabytes. The
 * sender did not validate, so every profile carrying a real avatar was rejected
 * whole by every recipient: name, status and bio along with the picture. Enough
 * rejections in a row mark a channel deaf — see `DEAF_FAILURES` in the core —
 * which triggers a rejoin, which reseats members, which destroys history by
 * forward secrecy.
 *
 * The test that was supposed to cover this built its own idea of the wire format
 * by hand and passed while production was broken. So these assert the round trip
 * end to end, at a realistic size, on the payload the client actually sends.
 */

function profileWithAvatar(avatarBytes: number): Payload {
  // A data URL of roughly the requested size, shaped like the real thing.
  const dataUrl = `data:image/png;base64,${"A".repeat(avatarBytes)}`
  return {
    t: "profile",
    displayName: "Ana Bento",
    donations: [],
    updatedAt: 29765701,
    statusText: "a testar",
    bio: "uma bio qualquer",
    avatar: {
      url: "",
      inline: dataUrl,
      key: "",
      nonce: "",
      digest: "",
      kind: "image",
      name: "avatar",
      mediaType: "image/*",
      byteLength: dataUrl.length,
    },
  } as Payload
}

describe("profile payloads survive the wire", () => {
  it("a real avatar makes the full round trip", () => {
    // 100 KB is an ordinary photograph after the editor's downscale, and the
    // editor accepts up to 512 KB.
    const sent = profileWithAvatar(100_000)
    const received = decodePayload(encodePayload(sent))

    expect(received.t).toBe("profile")
    // The whole payload has to survive, not just the picture: the regression this
    // guards against destroyed the display name as collateral.
    expect(received).toMatchObject({ displayName: "Ana Bento", statusText: "a testar" })
    const avatar = (received as { avatar?: { inline?: string } }).avatar
    expect(avatar?.inline).toHaveLength(`data:image/png;base64,${"A".repeat(100_000)}`.length)
  })

  it("the largest avatar the editor allows still fits", () => {
    const sent = profileWithAvatar(512 * 1024)
    expect(() => decodePayload(encodePayload(sent))).not.toThrow()
  })

  it("an avatar written to the wrong field fails at the SENDER, not silently at the receiver", () => {
    const dataUrl = `data:image/png;base64,${"A".repeat(100_000)}`
    const wrong = {
      t: "profile",
      displayName: "Ana Bento",
      donations: [],
      updatedAt: 29765701,
      // `url` is the content-addressed path and is capped at 2048.
      avatar: { url: dataUrl, key: "", nonce: "", digest: "", kind: "image", name: "avatar", mediaType: "image/*", byteLength: dataUrl.length },
    } as unknown as Payload

    // This is the point of the change: the sender refuses instead of emitting
    // something the receiver will drop without telling anyone.
    expect(() => encodePayload(wrong)).toThrow()
  })
})

/**
 * Likes, replies and link thumbnails travel inside the encrypted message.
 *
 * These assertions exist for the same reason as the ones above: a field the
 * sender writes and the receiver refuses gives no error where someone sees it,  * it disappears silently on the other end, and several refusals in a row mark a
 * channel as deaf (see `DEAF_FAILURES`). If one of these fields stops fitting,
 * it has to crash here.
 */
describe("publicações: gostos, comentários e pré-visualizações", () => {
  it("um gosto leva id e carimbo, que são o que decide o voto mais recente", () => {
    const sent: Payload = {
      t: "post.reaction",
      id: "reaccao-0001",
      target: "publicacao-0001",
      emoji: "👍",
      at: 29765701,
      remove: false,
    }
    expect(decodePayload(encodePayload(sent))).toMatchObject(sent)
  })

  it("retirar um voto é a mesma mensagem com `remove`, e não a ausência dela", () => {
    // Without this message, removing a like would be indistinguishable from never
    // giving it, and the device on the other end would keep counting it.
    const sent: Payload = {
      t: "post.reaction",
      id: "reaccao-0002",
      target: "publicacao-0001",
      emoji: "👍",
      at: 29765800,
      remove: true,
    }
    expect(decodePayload(encodePayload(sent))).toMatchObject({ remove: true })
  })

  it("um comentário do tamanho máximo cabe inteiro", () => {
    const sent: Payload = {
      t: "post.comment",
      id: "comentario-0001",
      target: "publicacao-0001",
      postedAt: 29765701,
      body: "a".repeat(2200),
    }
    expect((decodePayload(encodePayload(sent)) as { body: string }).body).toHaveLength(2200)
  })

  it("uma publicação leva título e a miniatura do link lá dentro", () => {
    // The thumbnail is the whole product of the request: if it didn't fit on the
    // wire, whoever reads it would have to go fetch it from the site, which is what
    // cannot happen.
    const thumbnail = `data:image/jpeg;base64,${"A".repeat(90_000)}`
    const sent: Payload = {
      t: "post",
      id: "publicacao-0001",
      postedAt: 29765701,
      title: "Um título curto",
      caption: "com um link",
      media: [],
      tags: [],
      links: [{ url: "https://exemplo.pt/artigo", kind: "link", title: "Artigo", thumbnail }],
    }
    const received = decodePayload(encodePayload(sent)) as {
      title?: string
      links: { thumbnail?: string }[]
    }
    expect(received.title).toBe("Um título curto")
    expect(received.links[0]?.thumbnail).toHaveLength(thumbnail.length)
  })

  it("uma publicação sem título continua a ser uma publicação válida", () => {
    const sent: Payload = {
      t: "post",
      id: "publicacao-0002",
      postedAt: 29765701,
      caption: "sem nome nenhum",
      media: [],
      tags: [],
      links: [],
    }
    expect(decodePayload(encodePayload(sent))).not.toHaveProperty("title")
  })
})

/**
 * Chat messages: images, link cards and the typing signal.
 *
 * Same reason as everything else in this file. A field the sender writes and the
 * receiver refuses gives no error anywhere: the payload is discarded ENTIRELY and
 * silently, counts as an ignored event, and several ignored events in a row mark
 * the channel deaf, the cascade that already wiped history once. If an image or
 * a thumbnail stops fitting, it has to crash here, not in production.
 */
describe("mensagens: imagens e pré-visualizações de link", () => {
  it("uma imagem comprimida viaja inteira dentro da mensagem", () => {
    // 400 KB is the limit that the interface compressor enforces on each conversation image.
    // The `inline` field accepts 4 MB, and that is the headroom we want to prove.
    const inline = `data:image/webp;base64,${"A".repeat(400 * 1024)}`
    const sent: Payload = {
      t: "message",
      id: "mensagem-0001",
      sentAt: 29765701,
      body: "olha isto",
      attachments: [
        {
          url: "",
          inline,
          key: "",
          nonce: "",
          digest: "",
          kind: "image",
          name: "foto.webp",
          mediaType: "image/webp",
          byteLength: inline.length,
        },
      ],
      links: [],
      mentions: [],
    }
    const received = decodePayload(encodePayload(sent)) as { attachments: { inline?: string }[] }
    expect(received.attachments[0]?.inline).toHaveLength(inline.length)
  })

  it("dez imagens é o limite, e a décima primeira rebenta no remetente", () => {
    const uma = {
      url: "",
      inline: "data:image/webp;base64,AAAA",
      key: "",
      nonce: "",
      digest: "",
      kind: "image" as const,
      name: "foto.webp",
      mediaType: "image/webp",
      byteLength: 4,
    }
    const base = { t: "message" as const, id: "mensagem-0002", sentAt: 1, body: "", links: [], mentions: [] }
    expect(() => encodePayload({ ...base, attachments: Array.from({ length: 10 }, () => uma) })).not.toThrow()
    expect(() => encodePayload({ ...base, attachments: Array.from({ length: 11 }, () => uma) })).toThrow()
  })

  it("o cartão de link vai dentro da mensagem, miniatura incluída", () => {
    // The whole point of the request: the thumbnail travels encrypted with the surrounding words.
    // If it did not fit, the reader would have to fetch it from the site, and the site
    // would know who opened the conversation and when.
    const thumbnail = `data:image/jpeg;base64,${"A".repeat(90_000)}`
    const sent: Payload = {
      t: "message",
      id: "mensagem-0003",
      sentAt: 29765701,
      body: "https://exemplo.pt/artigo vale a pena",
      attachments: [],
      links: [{ url: "https://exemplo.pt/artigo", kind: "link", title: "Artigo", siteName: "Exemplo", thumbnail }],
      mentions: [],
    }
    const received = decodePayload(encodePayload(sent)) as { links: { thumbnail?: string; title?: string }[] }
    expect(received.links[0]?.title).toBe("Artigo")
    expect(received.links[0]?.thumbnail).toHaveLength(thumbnail.length)
  })

  it("uma mensagem antiga, sem `links`, continua a ser válida e chega com a lista vazia", () => {
    // Compatibility is the silent requirement: every conversation recorded before
    // this field existed must still open. The `default([])` is what guarantees it,
    // and this is what proves it.
    const antiga = {
      t: "message",
      id: "mensagem-0004",
      sentAt: 29765701,
      body: "escrita antes dos cartões existirem",
    } as unknown as Payload
    const received = decodePayload(encodePayload(antiga)) as { links: unknown[]; attachments: unknown[] }
    expect(received.links).toEqual([])
    expect(received.attachments).toEqual([])
  })

  it("uma miniatura maior do que o campo rebenta no remetente, não em silêncio no receptor", () => {
    const gorda = `data:image/jpeg;base64,${"A".repeat(400_001)}`
    const wrong = {
      t: "message",
      id: "mensagem-0005",
      sentAt: 1,
      body: "",
      attachments: [],
      links: [{ url: "https://exemplo.pt", kind: "link", thumbnail: gorda }],
      mentions: [],
    } as unknown as Payload
    expect(() => encodePayload(wrong)).toThrow()
  })
})

/**
 * The typing indicator.
 *
 * It is the most frequent message this application produces, and the only one that must
 * never be stored. These assertions pin down the two things the indicator depends on:
 * the deadline travels (otherwise nothing erases it on its own) and the room travels
 * (otherwise whoever types in one room appears to type in all of them).
 */
describe("sinal de escrita", () => {
  it("leva um prazo, que é o que o faz morrer sozinho", () => {
    const sent: Payload = { t: "typing", until: 29765707 }
    expect(decodePayload(encodePayload(sent))).toMatchObject({ t: "typing", until: 29765707 })
  })

  it("leva a sala, e sem sala é a sala por omissão", () => {
    const naSala: Payload = { t: "typing", room: "geral", until: 29765707 }
    expect(decodePayload(encodePayload(naSala))).toMatchObject({ room: "geral" })
    // Absent and non-empty: that is how clients from before rooms existed are read,
    // and changing it would shift conversations that already exist.
    expect(decodePayload(encodePayload({ t: "typing", until: 1 }))).not.toHaveProperty("room")
  })

  it("um prazo negativo é recusado no remetente", () => {
    // A backwards clock would send an indicator that is born already expired,
    // which is harmless, but a payload that does not validate is discarded ENTIRELY
    // by the receiver and counts toward channel deafness. Rejecting here is cheap.
    expect(() => encodePayload({ t: "typing", until: -1 } as unknown as Payload)).toThrow()
  })
})

/**
 * The nudge.
 *
 * Ephemeral like the typing indicator, and with one more reason to be: a stored nudge
 * is replayed in backfill, and whoever opened the conversation the next day
 * would get hit with all the nudges from the day before at once, each one shaking
 * the screen and playing sound. The cut is at the session; what we pin down here is the format.
 */
describe("cotovelada", () => {
  it("leva um carimbo, que é o que permite recusar uma cotovelada velha", () => {
    const sent: Payload = { t: "buzz", at: 29765701 }
    expect(decodePayload(encodePayload(sent))).toMatchObject({ t: "buzz", at: 29765701 })
  })

  it("não leva mais nada: quem a deu é o remetente autenticado, nunca um campo", () => {
    // A field with the author would be a field that an altered client fills with
    // someone else's name. Who sent it comes from MLS, not from the payload.
    const received = decodePayload(encodePayload({ t: "buzz", at: 1 }))
    expect(Object.keys(received).sort()).toEqual(["at", "t"])
  })

  it("um carimbo negativo é recusado no remetente", () => {
    expect(() => encodePayload({ t: "buzz", at: -1 } as unknown as Payload)).toThrow()
  })

  it("o intervalo entre cotoveladas é maior do que zero e vive no protocolo", () => {
    // Without a throttle, the nudge goes back to being what it was in MSN: the cheapest way to
    // bother someone. The number lives here because the sender throttles by it
    // and the receiver rejects by it, two layers, one source.
    expect(BUZZ_INTERVAL_MS).toBe(5_000)
    expect(BUZZ_MAX_AGE_MS).toBeGreaterThan(BUZZ_INTERVAL_MS)
  })
})

/**
 * Roles: named, with separate responsibilities.
 *
 * What the schema must allow to be stated, and what it must refuse, is the owner's request
 * translated into types. A role can grant no power at all, it only serves to
 * mark who has access to the channel.
 *
 * The responsibilities are a closed list AT READ TIME, and the schema is not where it closes.
 * What decides what a role grants is `rolesOf`, which filters by the list from this version
 * and never returns a name it does not know, so an invented power is never granted,
 * no matter where the payload comes from. Refusing it here would add no security
 * and would break everything else: a rejected `role.define` does not lose a power,
 * it loses the entire role.
 *
 * What the schema refuses is garbage, and the refusal happens at the SENDER. A payload
 * that does not validate is discarded entirely by the receiver, counts as an ignored event,
 * and several ignored events in a row declare the channel deaf, the cascade
 * that has already wiped history once.
 */
describe("papéis de um canal", () => {
  it("um papel sem responsabilidades nenhumas é válido: é o que dá só acesso", () => {
    const sent: Payload = { t: "role.define", role: "convidado", name: "Convidado", powers: [], position: 0, removed: false, definedAt: 1 }
    const received = decodePayload(encodePayload(sent))
    expect(received).toMatchObject({ t: "role.define", role: "convidado", powers: [] })
  })

  it("as quatro responsabilidades viajam separadas umas das outras", () => {
    const sent: Payload = {
      t: "role.define",
      role: "moderador",
      name: "Moderador",
      powers: ["expulsar", "convidar", "renomear", "mover"],
      position: 1,
      removed: false,
      definedAt: 2,
    }
    const received = decodePayload(encodePayload(sent))
    expect((received as { powers: string[] }).powers).toEqual(["expulsar", "convidar", "renomear", "mover"])
  })

  /**
   * The case that `POWERS` was written to have and the schema would not allow.
   *
   * The list grows by design, its comment says "Add to the END, always",
   * and `remove` already entered last. A `z.enum` would make the day a newer client
   * assigns a new power the day older clients lose the role ENTIRELY: the name,
   * the powers they already knew, `expel` included -, and its very existence,
   * left without the power to edit or delete.
   *
   * And it exchanged nothing for nothing: who grants is `rolesOf`, which filters
   * by the local list. The unknown power arrives, stays stored raw so as not to be lost
   * to whoever understands it, and grants nothing here.
   */
  it("um poder que esta versão não conhece não reprova o papel: o papel chega inteiro", () => {
    const futuro = {
      t: "role.define",
      role: "moderador",
      name: "Moderador",
      // Does not yet exist in `POWERS`. A newer client assigned it.
      powers: ["expulsar", "arquivar"],
      position: 0,
      removed: false,
      definedAt: 3,
    } as unknown as Payload

    const lido = decodePayload(encodePayload(futuro)) as { powers: string[]; name: string }
    expect(lido).toMatchObject({ t: "role.define", role: "moderador", name: "Moderador" })
    // The known power survives, and the unknown travels intact: removing it
    // here would make re-editing the role in an older client erase it for everyone.
    expect(lido.powers).toEqual(["expulsar", "arquivar"])
  })

  it("o tecto de poderes não é o tamanho da lista desta versão", () => {
    // `.max(POWERS.length)` was the same defect in another form: six powers
    // from a future version would not fit in a version that knows five, and the
    // role fell because of the count instead of because of the name.
    const muitos = {
      t: "role.define",
      role: "moderador",
      name: "Moderador",
      // Eight from an old version and three it does not know: the schema's cap (32)
      // does not depend on the size of the list. With the 1.2 model, the list from this version
      // already has 30, close to the cap: see `POWERS`.
      powers: [...POWERS.slice(0, 8), "arquivar", "fixar", "silenciar"],
      position: 0,
      removed: false,
      definedAt: 11,
    } as unknown as Payload
    expect(() => encodePayload(muitos)).not.toThrow()
  })

  it("um poder que não é um nome de poder é recusado no remetente", () => {
    // What the field must block is garbage, a `style`, a `url(...)`, half a
    // megabyte of nothing -, not a name this version has not learned yet. And
    // it blocks it here, at the sender, where someone can act: on the other side the
    // payload would fall silent and feed the cascade of ignored events.
    for (const lixo of ["apagar-tudo", "url(javascript:0)", "EXPULSAR", "a".repeat(25), "a", ""]) {
      const wrong = {
        t: "role.define",
        role: "moderador",
        name: "Moderador",
        powers: [lixo],
        position: 0,
        removed: false,
        definedAt: 3,
      } as unknown as Payload
      expect(() => encodePayload(wrong)).toThrow()
    }
  })

  it("apagar um papel é dizê-lo, não deixar de o dizer", () => {
    // Silence does not propagate: a role disappears from a client if and only if
    // someone publishes that it ended. Without `removed`, deleting a role left it
    // alive on every device that had already stored it.
    const sent: Payload = { t: "role.define", role: "antigo", name: "Antigo", powers: [], position: 0, removed: true, definedAt: 4 }
    expect(decodePayload(encodePayload(sent))).toMatchObject({ removed: true })
  })

  /*
   * The color of a role, going and coming back.
   *
   * New field in a payload that already circulates, so what these tests store
   * is not the color: it is that it cannot bring the role down with it. The old form,  * without `colour`, is what exists in every channel that already has roles, and it
   * must continue to pass exactly as it did.
   */
  it("um papel pode levar cor, e ela chega do outro lado", () => {
    const sent: Payload = {
      t: "role.define",
      role: "moderador",
      name: "Moderador",
      powers: ["expulsar"],
      colour: "menta",
      position: 0,
      removed: false,
      definedAt: 7,
    }
    expect(decodePayload(encodePayload(sent))).toMatchObject({ colour: "menta" })
  })

  it("a forma antiga, sem cor, continua a passar — e sem cor sai do outro lado", () => {
    // Absence is absence. A `.default()` in the schema would write here a choice
    // nobody made, and all already-published roles would wake up painted.
    const sent: Payload = { t: "role.define", role: "convidado", name: "Convidado", powers: [], position: 0, removed: false, definedAt: 8 }
    const received = decodePayload(encodePayload(sent)) as { colour?: unknown }
    expect(received).toMatchObject({ t: "role.define", role: "convidado" })
    expect(received.colour).toBeUndefined()
  })

  it("uma cor que esta versão não conhece não reprova o papel: o papel chega inteiro", () => {
    // The opposite of what we do to an invented power, and on purpose. A power
    // nobody evaluates is a power granted; a color nobody knows is
    // a color that does not paint. Rejecting the payload because of it would erase the
    // name, the responsibilities, and the very existence of the role in a client
    // that is just out of date. Whoever reads is the one who discounts it.
    const futuro = {
      t: "role.define",
      role: "moderador",
      name: "Moderador",
      powers: [],
      colour: "cobalto",
      position: 0,
      removed: false,
      definedAt: 9,
    } as unknown as Payload
    expect(decodePayload(encodePayload(futuro))).toMatchObject({ role: "moderador", name: "Moderador" })
  })

  it("uma cor que não é um nome de cor é recusada no remetente", () => {
    // The field is how garbage gets in if not tightened: an entire `style`, a
    // `url(...)`, or an endless string. And garbage here does not spoil the color, // it makes the entire payload fall silent at the receiver, which is the cascade
    // of several ignored events.
    for (const lixo of ["#ff0000", "url(javascript:0)", "red; background:url(x)", "ab", "a".repeat(17), ""]) {
      const wrong = {
        t: "role.define",
        role: "moderador",
        name: "Moderador",
        powers: [],
        colour: lixo,
        position: 0,
        removed: false,
        definedAt: 10,
      } as unknown as Payload
      expect(() => encodePayload(wrong)).toThrow()
    }
  })

  it("as cores declaradas passam todas, uma a uma", () => {
    // If someone adds a name to `ROLE_COLOURS` that the schema's format does not
    // accept, it is here that we find out, not in a channel, with the role
    // disappearing on the other side.
    for (const cor of ROLE_COLOURS) {
      const sent: Payload = {
        t: "role.define",
        role: "papel",
        name: "Papel",
        powers: [],
        colour: cor,
        position: 0,
        removed: false,
        definedAt: 11,
      }
      expect(decodePayload(encodePayload(sent))).toMatchObject({ colour: cor })
    }
  })

  it("role.assign leva a lista de papéis de uma pessoa, e a lista vazia significa nenhum", () => {
    const sent: Payload = { t: "role.assign", subject: "@ana:s", roles: ["moderador", "convidado"], assignedAt: 5 }
    expect(decodePayload(encodePayload(sent))).toMatchObject({ roles: ["moderador", "convidado"] })
    const nenhum: Payload = { t: "role.assign", subject: "@ana:s", roles: [], assignedAt: 6 }
    expect((decodePayload(encodePayload(nenhum)) as { roles: string[] }).roles).toEqual([])
  })
})

/**
 * The visibility of a category, going and coming back.
 *
 * The field is new, and a new field in a payload that already circulates is the cheapest way
 * to break a channel: a payload the receiver refuses is discarded entirely and in silence,
 * counts as an ignored event, and several ignored events in a row declare the channel deaf,  * the cascade that has already wiped history once. That is why what we
 * test here is not just the round trip: it is COMPATIBILITY in both directions,
 * which is where the cascade begins.
 */
describe("visibilidade de uma categoria", () => {
  it("a lista de papéis sobrevive ao fio", () => {
    const sent: Payload = {
      t: "channel.category",
      category: "Direcção",
      position: 100,
      roles: ["moderador", "socio"],
      removed: false,
      updatedAt: 1,
    }
    expect(decodePayload(encodePayload(sent))).toMatchObject({ roles: ["moderador", "socio"] })
  })

  it("uma categoria sem restrição é o caso normal, e a lista vazia é como se diz", () => {
    // Empty means EVERYONE, never nobody. It is the read that keeps already-published
    // categories showing to everyone; the reverse would empty the sidebar of all channels
    // that already exist.
    const sent: Payload = {
      t: "channel.category",
      category: "Conversa",
      position: 0,
      roles: [],
      removed: false,
      updatedAt: 2,
    }
    expect((decodePayload(encodePayload(sent)) as { roles: string[] }).roles).toEqual([])
  })

  it("uma categoria publicada por um cliente ANTIGO continua a ler-se", () => {
    // What is stored in today's vaults does not have `roles`, and the `default([])`
    // from the schema is what keeps it readable. Without it, opening the new app made
    // each old category count as an ignored event.
    const antigo = { t: "channel.category", category: "Arquivo", position: 300, removed: false, updatedAt: 3 }
    const bytes = new TextEncoder().encode(JSON.stringify(antigo))
    expect(decodePayload(bytes)).toMatchObject({ category: "Arquivo", roles: [] })
  })

  it("um cliente ANTIGO não fica surdo com uma categoria publicada por um novo", () => {
    // The other direction, and what nobody checks because they already wrote the
    // new schema: a client that never heard of `roles` receives the field and must
    // ignore it without rejecting the message. Zod drops what it does not know instead
    // of refusing, and that is what we pin down here, changing that policy to
    // `strict` would declare every channel with a restricted category deaf.
    const novo = JSON.stringify({
      t: "channel.category",
      category: "Direcção",
      position: 0,
      roles: ["moderador"],
      inventado: "o que vier depois disto",
      updatedAt: 4,
    })
    const lido = decodePayload(new TextEncoder().encode(novo)) as Record<string, unknown>
    expect(lido).toMatchObject({ category: "Direcção" })
    expect(lido).not.toHaveProperty("inventado")
  })

  /**
   * The role cap is refused ON BOTH SIDES, and that is what we pin down here.
   *
   * The name of this test was "fails at the sender, not at the receiver", and the
   * second half was false. Both `encodePayload` and `decodePayload` call
   * `Payload.parse`: probed, a `channel.category` with 17 roles, with a role
   * longer than 32 characters, or with `roles: null` throws `ZodError` at
   * DECODING just as it does at encoding.
   *
   * The difference between the two sides is not whether it fails, it is what
   * the failure costs. At the sender it is an exception with location, time, and stack,
   * caught before a single byte leaves. At the receiver it is a payload discarded entirely
   * and in silence, which counts as an ignored event; several ignored events in a row
   * declare the channel deaf, the client re-enters the group, the members are
   * re-presented, and the history dies for future secrecy. A test that claimed the receiver
   * was tolerant hid exactly the path through which the cascade enters.
   */
  it("mais papéis do que o tecto é recusado por quem envia E por quem recebe", () => {
    const demasiados = {
      t: "channel.category",
      category: "Direcção",
      position: 0,
      roles: Array.from({ length: 17 }, (_, i) => `papel-${i}`),
      updatedAt: 5,
    } as unknown as Payload
    // At the sender: cheap, visible, and before it goes out.
    expect(() => encodePayload(demasiados)).toThrow()
    // At the receiver: expensive and silent. Written by hand because `encodePayload` already
    // rejected it, that is how it would arrive from an altered client or a future version.
    const cru = new TextEncoder().encode(JSON.stringify(demasiados))
    expect(() => decodePayload(cru)).toThrow()
  })

  it("um papel maior do que o campo, e um `roles` que nem lista é, morrem no receptor da mesma maneira", () => {
    // The other two forms probed. They go together because the lesson is one: everything
    // the schema refuses is, on the other side, an ignored event, and the count of ignored events
    // does not distinguish causes.
    const papelLongo = {
      t: "channel.category",
      category: "Direcção",
      position: 0,
      roles: ["p".repeat(33)],
      updatedAt: 6,
    }
    const nemLista = {
      t: "channel.category",
      category: "Direcção",
      position: 0,
      roles: null,
      updatedAt: 7,
    }
    for (const mau of [papelLongo, nemLista]) {
      expect(() => decodePayload(new TextEncoder().encode(JSON.stringify(mau)))).toThrow()
    }
    // And the limit itself continues to let the legitimate case pass: a cap that
    // rejected 16 would be the same cascade, with better intentions.
    const noTecto = {
      t: "channel.category",
      category: "Direcção",
      position: 0,
      roles: Array.from({ length: 16 }, (_, i) => `papel-${i}`),
      removed: false,
      updatedAt: 8,
    } as unknown as Payload
    expect(() => decodePayload(encodePayload(noTecto))).not.toThrow()
  })
})

/**
 * The lists of names that will still grow, and the only one that will not.
 *
 * Every `z.enum` in this file was a future version dropping an entire payload
 * because of one name, the whole profile for a presence state, the whole message
 * for a card type, the whole post for an attachment format. The criterion that separates
 * the ones that opened from the ones that stayed closed is written in `NarrowName`:
 * it opens when the list names things in the world, it closes when it names
 * a structural choice of the product.
 *
 * These tests pin down both halves. The first is the one that was missing;
 * the second exists so that closing stays a decision and not an oversight.
 */
describe("nomes de uma lista que cresce", () => {
  const anexoFuturo = {
    url: "",
    inline: "data:application/x-futuro;base64,AAAA",
    key: "",
    nonce: "",
    digest: "",
    // Does not yet exist. A newer client knows how to draw it.
    kind: "modelo3d",
    name: "peça.glb",
    mediaType: "model/gltf-binary",
    byteLength: 4,
  }

  it("um tipo de anexo futuro não leva a mensagem com ele", () => {
    const futura = {
      t: "message",
      id: "mensagem-3001",
      sentAt: 1,
      body: "olha o que eu fiz",
      attachments: [anexoFuturo],
      links: [],
      mentions: [],
    } as unknown as Payload

    const lida = decodePayload(encodePayload(futura)) as { body: string; attachments: { kind: string }[] }
    // The body is what matters to save: losing someone's text because we do not know
    // how to draw the attachment is the entire defect in one sentence.
    expect(lida.body).toBe("olha o que eu fiz")
    expect(lida.attachments[0]?.kind).toBe("modelo3d")
  })

  it("um tipo de cartão de link futuro não leva a publicação com ele", () => {
    const futura = {
      t: "post",
      id: "publicacao-3002",
      postedAt: 2,
      caption: "a leitura da semana",
      media: [],
      links: [{ url: "https://exemplo.pt/mapa", kind: "mapa", title: "Mapa" }],
      tags: [],
    } as unknown as Payload

    const lida = decodePayload(encodePayload(futura)) as { caption: string; links: { kind: string }[] }
    expect(lida.caption).toBe("a leitura da semana")
    expect(lida.links[0]?.kind).toBe("mapa")
  })

  it("um estado de presença futuro não leva o perfil com ele", () => {
    const futuro = {
      t: "profile",
      displayName: "ana",
      bio: "biografia inteira",
      activity: "ausente",
      donations: [],
      updatedAt: 3,
    } as unknown as Payload

    const lido = decodePayload(encodePayload(futuro)) as { displayName: string; bio: string; activity: string }
    expect(lido).toMatchObject({ displayName: "ana", bio: "biografia inteira" })
    expect(lido.activity).toBe("ausente")
  })

  it("uma forma de apoiar que ainda não existe não leva o perfil com ela", () => {
    const futuro = {
      t: "profile",
      displayName: "ana",
      donations: [{ kind: "mbway", label: "MB WAY", value: "912345678" }],
      updatedAt: 4,
    } as unknown as Payload

    const lido = decodePayload(encodePayload(futuro)) as { displayName: string; donations: { kind: string }[] }
    expect(lido.displayName).toBe("ana")
    expect(lido.donations[0]?.kind).toBe("mbway")
  })

  it("mas lixo continua a morrer no remetente, em qualquer um deles", () => {
    // The narrow format is not decoration: without it the field accepted an entire `style`,
    // a `url(...)`, or half a megabyte of nothing.
    for (const lixo of ["url(javascript:0)", "IMAGE", "a".repeat(25), "", "3d/model", "modelo 3d", "3delo", "audio."]) {
      const wrong = {
        t: "message",
        id: "mensagem-3003",
        sentAt: 5,
        body: "",
        attachments: [{ ...anexoFuturo, kind: lixo }],
        links: [],
        mentions: [],
      } as unknown as Payload
      expect(() => encodePayload(wrong)).toThrow()
    }
  })

  /**
   * `channel.meta.kind` stays closed, and it is said why.
   *
   * A room either carries messages or carries a call, and that fork is what all
   * voice signaling assumes. A forum is a text room with a different layout;
   * it asks for a presentation field, not a third `kind`.
   *
   * The test exists for the day someone disagrees: whoever adds a third value
   * sees this fail and will read the comment, where the price is, a rejected `channel.meta`
   * takes a `removed` tombstone with it, and a lost tombstone resurrects the room.
   */
  it("o tipo de uma sala continua fechado, de propósito", () => {
    const futura = {
      t: "channel.meta",
      room: "forum",
      name: "Fórum",
      category: "",
      kind: "forum",
      position: 0,
      closed: false,
      removed: false,
      updatedAt: 6,
    } as unknown as Payload
    expect(() => encodePayload(futura)).toThrow()
  })
})

/**
 * The round trip of each friend payload, in full.
 *
 * A payload the receiver refuses is discarded in silence, counts as an ignored event,
 * and several ignored events in a row declare the channel deaf, the cascade
 * that has already wiped history once. A rejected `friend.remove` would be worse
 * than noise: the friendship would be broken on one side and intact on the other,
 * which is exactly the state this payload exists to prevent.
 */
describe("os payloads de amizade sobrevivem ao fio", () => {
  it("um pedido, com e sem recado", () => {
    const comRecado: Payload = { t: "friend.request", sentAt: 1_700_000_000_000, note: "somos do mesmo lagar" }
    expect(decodePayload(encodePayload(comRecado))).toEqual(comRecado)

    const seco: Payload = { t: "friend.request", sentAt: 1_700_000_000_001 }
    expect(decodePayload(encodePayload(seco))).toEqual(seco)
  })

  it("um recado maior do que o permitido falha em quem envia, não em quem recebe", () => {
    const grande = { t: "friend.request", sentAt: 1, note: "a".repeat(281) } as Payload
    expect(() => encodePayload(grande)).toThrow()
  })

  it("uma aceitação", () => {
    const sent: Payload = { t: "friend.accept", acceptedAt: 1_700_000_000_002 }
    expect(decodePayload(encodePayload(sent))).toEqual(sent)
  })

  it("uma recusa", () => {
    const sent: Payload = { t: "friend.decline", declinedAt: 1_700_000_000_003 }
    expect(decodePayload(encodePayload(sent))).toEqual(sent)
  })

  it("um corte", () => {
    const sent: Payload = { t: "friend.remove", removedAt: 1_700_000_000_004 }
    expect(decodePayload(encodePayload(sent))).toEqual(sent)
  })

  it("um cancelamento: a recusa com `withdrawn`, que chega inteira", () => {
    const sent: Payload = { t: "friend.decline", declinedAt: 1_700_000_000_005, withdrawn: true }
    expect(decodePayload(encodePayload(sent))).toEqual(sent)
  })

  /**
   * What a 0.5.x client does with the new field: its schema does not have it, and a
   * `z.object` that is not `strict()` DROPS IT instead of rejecting it. Read with a
   * schema that does not have the field, the cancellation passes as rejection, not as an
   * ignored payload (which would count toward deafness).
   */
  it("um esquema que não conhece `withdrawn` lê o cancelamento como recusa, sem o reprovar", async () => {
    const { z } = await import("zod")
    const antigo = z.object({ t: z.literal("friend.decline"), declinedAt: z.number().int().nonnegative() })
    const cru = JSON.parse(new TextDecoder().decode(encodePayload({ t: "friend.decline", declinedAt: 7, withdrawn: true })))
    expect(antigo.parse(cru)).toEqual({ t: "friend.decline", declinedAt: 7 })
  })
})

/**
 * The friends list shown in the profile (phase 5). The only new `t` from friendships,
 * and the reason is in the schema: it must travel only in the feed of whoever shows it.
 */
describe("friends.shown", () => {
  it("uma lista, e a lista vazia que é deixar de mostrar", () => {
    const sent: Payload = { t: "friends.shown", shown: ["@ela:orwell.pt", "@outro:localhost:8448"], updatedAt: 1_700_000_000_006 }
    expect(decodePayload(encodePayload(sent))).toEqual(sent)
    const vazia: Payload = { t: "friends.shown", shown: [], updatedAt: 1_700_000_000_007 }
    expect(decodePayload(encodePayload(vazia))).toEqual(vazia)
  })

  it("quinhentos cabem, quinhentos e um não", () => {
    const quinhentos = Array.from({ length: 500 }, (_v, i) => `@conta${i}:orwell.pt`)
    expect(() => encodePayload({ t: "friends.shown", shown: quinhentos, updatedAt: 1 })).not.toThrow()
    expect(() => encodePayload({ t: "friends.shown", shown: [...quinhentos, "@mais:orwell.pt"], updatedAt: 1 })).toThrow()
  })

  it("só endereços de conta: nem canais, nem texto livre, nem espaços", () => {
    for (const lixo of ["!feed-x:orwell.pt", "ela", "@ela", "@ela :orwell.pt", "@a@b:orwell.pt", `@${"x".repeat(400)}:orwell.pt`]) {
      expect(() => encodePayload({ t: "friends.shown", shown: [lixo], updatedAt: 1 } as Payload), lixo).toThrow()
    }
  })
})

/**
 * Leaving a channel, which is `friend.remove` taken to any channel.
 *
 * It deserves the same round trip, and for the same reason taken further: a
 * `member.left` the receiver refuses is not noise, it is the leaf of whoever left
 * staying in the tree forever. **MLS does not let anyone commit their own removal**
 * (RFC 9420 §12.2), so this request is the ONLY way a departure can happen:
 * if it does not cross the wire intact, whoever deleted the account stays in the
 * member list with the epoch frozen.
 */
describe("a saída de um canal sobrevive ao fio", () => {
  it("uma saída", () => {
    const sent: Payload = { t: "member.left", leftAt: 1_700_000_000_005 }
    expect(decodePayload(encodePayload(sent))).toEqual(sent)
  })

  it("sem carimbo não passa em quem envia: uma saída sem hora não se ordena contra nada", () => {
    const semHora = { t: "member.left" } as unknown as Payload
    expect(() => encodePayload(semHora)).toThrow()
  })
})

/**
 * Muted microphone, traveling in frames that already exist.
 *
 * The alternative was a new `t`, `voice.muted`, and it was wrong. An old
 * client receiving a `t` its schema does not recognize discards the entire
 * payload silently, counts it as an ignored event, and consecutive ignored
 * events mark the channel deaf: the client rejoins the group, members are
 * re-sent, and history dies for future confidentiality. It happened, and
 * people in production are there now.
 *
 * An optional field in a known frame has none of that: the schema is not
 * `strict()`, so whoever does not know the field drops it on read and keeps
 * hearing everything else. This is the policy these tests pin down, not just
 * round-trip, because it is the policy that decides if the channel survives.
 */
describe("o microfone calado viaja sem `t` novo", () => {
  const entrada = (muted?: boolean): Payload =>
    ({
      t: "voice.join",
      at: 1_700_000_000_000,
      video: false,
      sframe: true,
      alone: false,
      ...(muted === undefined ? {} : { muted }),
    }) as Payload

  it("`voice.join` leva o estado do microfone nos dois sentidos", () => {
    expect(decodePayload(encodePayload(entrada(true)))).toMatchObject({ t: "voice.join", muted: true })
    expect(decodePayload(encodePayload(entrada(false)))).toMatchObject({ t: "voice.join", muted: false })
  })

  it("`voice.offer` leva-o também: quem entra a meio nunca ouviu o anúncio de ninguém", () => {
    const oferta: Payload = {
      t: "voice.offer",
      to: "@ana:s",
      sdp: "v=0\r\no=- oferta\r\n",
      sframe: true,
      video: false,
      muted: true,
    }
    expect(decodePayload(encodePayload(oferta))).toMatchObject({ t: "voice.offer", muted: true })
  })

  it("`voice.answer` leva-o no sentido inverso, pela mesma razão", () => {
    const resposta: Payload = {
      t: "voice.answer",
      to: "@ana:s",
      sdp: "v=0\r\no=- resposta\r\n",
      sframe: true,
      muted: false,
    }
    expect(decodePayload(encodePayload(resposta))).toMatchObject({ t: "voice.answer", muted: false })
  })

  it("a forma ANTIGA dos três frames continua a decodificar, e sem o campo", () => {
    // What a client that never heard of this puts on the wire today. If this
    // stopped being read, all voice signaling in progress would count ignored
    // events, the cascade, started by the fix that should have prevented it.
    const antigos = [
      { t: "voice.join", at: 1, video: false, sframe: true, alone: false },
      { t: "voice.offer", to: "@ana:s", sdp: "v=0\r\n", sframe: true },
      { t: "voice.answer", to: "@ana:s", sdp: "v=0\r\n", sframe: true },
    ]
    for (const antigo of antigos) {
      const lido = decodePayload(new TextEncoder().encode(JSON.stringify(antigo))) as Record<string, unknown>
      expect(lido).toMatchObject({ t: antigo.t })
      // Absent is "unknown", and must stay distinguishable from `false`. A
      // `default(false)` here would put on screen the claim that the person is
      // speaking, for a client that never said any such thing.
      expect(lido["muted"]).toBeUndefined()
    }
  })

  it("um cliente ANTIGO não fica surdo com a sinalização de um cliente NOVO", () => {
    // The sense that no one checks because they already wrote the new schema,
    // and the only one that matters to the cascade. `fabricated` stands in for a
    // field the old version does not know, which is what `muted` is to it.
    const novo = JSON.stringify({
      t: "voice.join",
      at: 2,
      video: false,
      sframe: true,
      alone: false,
      muted: true,
      inventado: "o que vier depois disto",
    })
    const lido = decodePayload(new TextEncoder().encode(novo)) as Record<string, unknown>
    expect(lido).toMatchObject({ t: "voice.join", muted: true })
    expect(lido).not.toHaveProperty("inventado")
  })

  it("`muted` que não é booleano é recusado, e não silenciosamente acreditado", () => {
    // An optional field is not a field without rules. "true" as text is the error
    // a modified client makes by accident, and believing it would put a mute mark
    // on someone who is speaking.
    const torto = { t: "voice.join", at: 3, video: false, sframe: true, alone: false, muted: "true" }
    expect(() => decodePayload(new TextEncoder().encode(JSON.stringify(torto)))).toThrow()
  })
})

/**
 * Which LIFE STAGE of a person is each voice frame in.
 *
 * Same rule as the microphone, and for the same reason: optional field in
 * frames that already exist, never a new `t`. Here compatibility has another
 * duty, a client that cannot tell which life stage it is must still be served
 * exactly as it is today. A missing field can cost an improvement; it cannot
 * cost a call that was already working.
 */
describe("o identificador de entrada na chamada", () => {
  it("viaja no anúncio, na oferta e na resposta", () => {
    const anuncio: Payload = {
      t: "voice.join",
      at: 1,
      video: false,
      sframe: true,
      alone: true,
      joinId: "6f1a2b3c-0000-4000-8000-000000000001",
    }
    expect(decodePayload(encodePayload(anuncio))).toMatchObject({
      joinId: "6f1a2b3c-0000-4000-8000-000000000001",
    })

    const oferta: Payload = {
      t: "voice.offer",
      to: "@ana:s",
      sdp: "v=0\r\n",
      sframe: true,
      joinId: "vida-2",
    }
    expect(decodePayload(encodePayload(oferta))).toMatchObject({ joinId: "vida-2" })

    const resposta: Payload = {
      t: "voice.answer",
      to: "@ana:s",
      sdp: "v=0\r\n",
      sframe: true,
      joinId: "vida-3",
    }
    expect(decodePayload(encodePayload(resposta))).toMatchObject({ joinId: "vida-3" })
  })

  it("a forma sem identificador continua a decodificar, e sem o campo", () => {
    // The client open right now in production. If this stopped being read, the
    // re-entry fix would break every call in progress, which is roughly the
    // opposite of what it is meant to do.
    const antigo = { t: "voice.join", at: 1, video: false, sframe: true, alone: true }
    const lido = decodePayload(new TextEncoder().encode(JSON.stringify(antigo))) as Record<string, unknown>
    expect(lido).toMatchObject({ t: "voice.join" })
    expect(lido["joinId"]).toBeUndefined()
  })

  it("um identificador maior do que o campo é recusado nos dois lados", () => {
    // 64 characters are way more than enough for a UUID (36). The cap exists so a
    // modified client cannot use this field as a channel for something else.
    const grande = {
      t: "voice.join",
      at: 1,
      video: false,
      sframe: true,
      alone: true,
      joinId: "x".repeat(65),
    } as unknown as Payload
    expect(() => encodePayload(grande)).toThrow()
    expect(() => decodePayload(new TextEncoder().encode(JSON.stringify(grande)))).toThrow()
  })

  it("os dois campos novos convivem no mesmo frame sem se estorvarem", () => {
    // They were added in different pieces of work and travel together. A frame
    // with both is the NORMAL case after this, not an edge case.
    const anuncio: Payload = {
      t: "voice.join",
      at: 2,
      video: false,
      sframe: true,
      alone: false,
      muted: true,
      joinId: "vida-4",
    }
    expect(decodePayload(encodePayload(anuncio))).toMatchObject({ muted: true, joinId: "vida-4" })
  })
})

/**
 * Screen sharing, stated in frames that already exist.
 *
 * Third time this policy applies, and the third time it is the opposite of
 * what looks tidier. A new `t`, `voice.screen`, breaks the entire union in
 * an old client: the payload is discarded silently, counts as an ignored event,
 * and consecutive ignored events mark the channel deaf and trigger the repair
 * that ERASES HISTORY. People in production are there now.
 *
 * The two fields are not the same thing twice. `screen` is the decision
 * ("I am sharing"), and it is what tells the screen to draw; `screenStream` is
 * the id of the `MediaStream`, in case the `msid` survives the wire, today it
 * does not, because a dedicated transceiver with `replaceTrack` does not put it
 * there. See the note in the schema itself.
 */
describe("a partilha de ecrã viaja sem `t` novo", () => {
  it("o anúncio leva a decisão e o identificador do fluxo", () => {
    const anuncio: Payload = {
      t: "voice.join",
      at: 1_700_000_000_000,
      video: false,
      sframe: true,
      alone: false,
      screen: true,
      screenStream: "ecra-abc-123",
    }
    expect(decodePayload(encodePayload(anuncio))).toMatchObject({
      t: "voice.join",
      screen: true,
      screenStream: "ecra-abc-123",
    })
  })

  it("a oferta leva-os: quem entra a meio de uma partilha nunca ouviu o anúncio", () => {
    const oferta: Payload = {
      t: "voice.offer",
      to: "@ana:s",
      sdp: "v=0\r\no=- oferta\r\n",
      sframe: true,
      screen: true,
      screenStream: "ecra-abc-123",
    }
    expect(decodePayload(encodePayload(oferta))).toMatchObject({ screen: true, screenStream: "ecra-abc-123" })
  })

  it("a resposta leva-os no sentido inverso, pela mesma razão", () => {
    const resposta: Payload = {
      t: "voice.answer",
      to: "@ana:s",
      sdp: "v=0\r\no=- resposta\r\n",
      sframe: true,
      screen: true,
      screenStream: "ecra-xyz-987",
    }
    expect(decodePayload(encodePayload(resposta))).toMatchObject({ screen: true, screenStream: "ecra-xyz-987" })
  })

  it("a forma ANTIGA dos três frames continua a decodificar, e sem os campos", () => {
    // The client open right now in production. If this stopped being read, all
    // voice signaling in progress would count ignored events, the cascade,
    // started by a feature that does not touch it.
    const antigos = [
      { t: "voice.join", at: 1, video: false, sframe: true, alone: false },
      { t: "voice.offer", to: "@ana:s", sdp: "v=0\r\n", sframe: true },
      { t: "voice.answer", to: "@ana:s", sdp: "v=0\r\n", sframe: true },
    ]
    for (const antigo of antigos) {
      const lido = decodePayload(new TextEncoder().encode(JSON.stringify(antigo))) as Record<string, unknown>
      expect(lido).toMatchObject({ t: antigo.t })
      expect(lido["screen"]).toBeUndefined()
      expect(lido["screenStream"]).toBeUndefined()
    }
  })

  it("um cliente ANTIGO não fica surdo com um anúncio de partilha", () => {
    // The sense that no one checks because they already wrote the new schema, and
    // the only one that matters to the cascade. An old client reads the frame,
    // drops the two fields it does not know, and stays in the call without
    // noticing anything.
    const novo = JSON.stringify({
      t: "voice.join",
      at: 2,
      video: false,
      sframe: true,
      alone: false,
      screen: true,
      screenStream: "ecra-1",
      inventado: "o que vier depois disto",
    })
    const lido = decodePayload(new TextEncoder().encode(novo)) as Record<string, unknown>
    expect(lido).toMatchObject({ t: "voice.join", screen: true })
    expect(lido).not.toHaveProperty("inventado")
  })

  it("`screen` que não é booleano é recusado, e não silenciosamente acreditado", () => {
    const torto = { t: "voice.join", at: 3, video: false, sframe: true, alone: false, screen: "sim" }
    expect(() => decodePayload(new TextEncoder().encode(JSON.stringify(torto)))).toThrow()
  })

  it("um identificador de fluxo maior do que o campo é recusado nos dois lados", () => {
    // 128 characters are way more than enough for a `MediaStream` id (36). The
    // cap exists so a modified client cannot use this as a channel for something
    // else: what goes here is read by everyone in the channel.
    const grande = {
      t: "voice.join",
      at: 1,
      video: false,
      sframe: true,
      alone: true,
      screenStream: "x".repeat(129),
    } as unknown as Payload
    expect(() => encodePayload(grande)).toThrow()
    expect(() => decodePayload(new TextEncoder().encode(JSON.stringify(grande)))).toThrow()
  })
})

describe("voice.move — mover alguém entre salas de voz", () => {
  it("leva quem é movido e a sala de destino, e sobrevive à ida e volta", () => {
    const sent: Payload = { t: "voice.move", subject: "@ana:s", room: "estudio", at: 7 }
    expect(decodePayload(encodePayload(sent))).toMatchObject({ subject: "@ana:s", room: "estudio" })
  })

  it("a sala vazia é a sala por omissão do canal, como no resto da sinalização de voz", () => {
    const sent: Payload = { t: "voice.move", subject: "@ana:s", room: "", at: 8 }
    expect((decodePayload(encodePayload(sent)) as { room: string }).room).toBe("")
  })

  it("não leva quem move: quem move é o remetente, e o MLS já o autentica", () => {
    // A "by whom" field would be a claim from the frame itself, and a modified
    // client would write someone else's name there. The sender cannot be forged.
    const sent: Payload = { t: "voice.move", subject: "@ana:s", room: "voz", at: 9 }
    expect(Object.keys(decodePayload(encodePayload(sent)))).not.toContain("by")
  })

  it("«Desligar da chamada» é um mover com `desligar` e a sala da pergunta", () => {
    const sent: Payload = { t: "voice.move", subject: "@ana:s", room: SALA_DA_PERGUNTA, desligar: true, at: 10 }
    expect(decodePayload(encodePayload(sent))).toMatchObject({ room: SALA_DA_PERGUNTA, desligar: true })
  })

  it("um cliente sem o campo lê-o como mover para a sala reservada, que ele já recusa", () => {
    // The schema before this field: the same object without `hangup`. Zod drops
    // the key it does not know, and what is left is a move to the sentinel, which
    // the old `Call.handleSignal` refuses without touching anything.
    const ramo = Payload.options.find(
      (opcao) => (opcao.shape as { t: z.ZodLiteral<string> }).t.value === "voice.move",
    ) as unknown as z.ZodObject
    const antigo = ramo.omit({ desligar: true } as never)
    const lido = antigo.parse({ t: "voice.move", subject: "@ana:s", room: SALA_DA_PERGUNTA, desligar: true, at: 11 })
    expect(lido).toEqual({ t: "voice.move", subject: "@ana:s", room: SALA_DA_PERGUNTA, at: 11 })
  })

  it("`desligar` só aceita verdadeiro", () => {
    expect(() => decodePayload(new TextEncoder().encode(JSON.stringify({ t: "voice.move", subject: "@a:s", room: "", desligar: false, at: 1 })))).toThrow()
  })
})

/**
 * The address invite travels inside a message, and with no new `t`.
 *
 * The reason is written in `ChannelInvite`, and it is the same as the muted
 * microphone: a `t` the receiver does not know is discarded whole and counts
 * toward the channel going deaf. Here there is also a second reason, from the
 * product side, only `message` payloads show in the conversation list and in
 * the conversation itself. An invite that was something else would reach the
 * vault and never reach anyone's eyes.
 */
describe("o convite para um canal viaja dentro de uma mensagem privada", () => {
  const convite = (): Payload => ({
    t: "message",
    id: "convite-000001",
    sentAt: 1_700_000_000_000,
    body: "Convidei-te para #Lagar do Zé.",
    attachments: [],
    links: [],
    mentions: [],
    invite: { channel: "!lagar:orwell.pt", name: "Lagar do Zé", at: 1_700_000_000_000 },
  })

  it("o convite sobrevive à ida e volta, com o corpo que se lê sozinho", () => {
    const lido = decodePayload(encodePayload(convite())) as Record<string, unknown>
    expect(lido).toMatchObject({ t: "message", body: "Convidei-te para #Lagar do Zé." })
    expect(lido["invite"]).toMatchObject({ channel: "!lagar:orwell.pt", name: "Lagar do Zé" })
  })

  it("a resposta viaja pelo mesmo caminho, nos dois sentidos", () => {
    const sim: Payload = {
      t: "message",
      id: "resposta-00001",
      sentAt: 1_700_000_001_000,
      body: "Aceitei o convite para #Lagar do Zé.",
      attachments: [],
      links: [],
      mentions: [],
      inviteReply: { channel: "!lagar:orwell.pt", accepted: true, at: 1_700_000_001_000 },
    }
    const nao: Payload = { ...sim, inviteReply: { channel: "!lagar:orwell.pt", accepted: false, at: 2 } }
    expect((decodePayload(encodePayload(sim)) as { inviteReply: { accepted: boolean } }).inviteReply.accepted).toBe(true)
    expect((decodePayload(encodePayload(nao)) as { inviteReply: { accepted: boolean } }).inviteReply.accepted).toBe(false)
  })

  it("a forma ANTIGA de uma mensagem continua a decodificar, e sem os campos", () => {
    // What a client that never heard of this puts on the wire today. If this
    // stopped being read, all conversation in progress would count ignored
    // events, the cascade this design exists to prevent.
    const antiga = { t: "message", id: "antiga-000001", sentAt: 1, body: "olá" }
    const lida = decodePayload(new TextEncoder().encode(JSON.stringify(antiga))) as Record<string, unknown>
    expect(lida).toMatchObject({ t: "message", body: "olá" })
    expect(lida["invite"]).toBeUndefined()
    expect(lida["inviteReply"]).toBeUndefined()
  })

  it("um cliente ANTIGO lê a mensagem de um cliente NOVO, e lê o corpo", () => {
    // The sense that matters to the cascade: the old schema version is the one
    // that does not know `invite`, and what it does with a field it does not know
    // is strip it, never reject the entire message. `fabricated` stands in for a
    // future field, which is what `invite` is to it.
    const nova = JSON.stringify({ ...convite(), inventado: "o que vier depois disto" })
    const lida = decodePayload(new TextEncoder().encode(nova)) as Record<string, unknown>
    expect(lida).toMatchObject({ body: "Convidei-te para #Lagar do Zé." })
    expect(lida).not.toHaveProperty("inventado")
  })

  it("um convite torto é recusado, e não silenciosamente acreditado", () => {
    // An optional field is not a field without rules. An invite with no channel is
    // not an invite, and accepting one like that would put a button on screen with
    // nowhere to ask for a place.
    const torto = { ...convite(), invite: { name: "sem canal", at: 1 } }
    expect(() => decodePayload(new TextEncoder().encode(JSON.stringify(torto)))).toThrow()
  })
})

/**
 * `device.revoke`, an account saying one of its devices stopped being its
 * device.
 *
 * **No one emits it yet, and that is why it exists already.** A `t` the
 * receiver does not know is not an ignored field: it is the entire payload
 * rejected, discarded silently, counted as an ignored event, and consecutive
 * ones mark the channel deaf, which asks for a new place in the group and
 * takes history along for future confidentiality. Within the window of a full
 * restart there is no client out there to whom it could make deaf. Outside it,
 * it would cost exactly that.
 *
 * These tests are round-trip and twisted forms, because it is the schema that
 * decides what survives the wire, and a schema that rejects what the sender
 * writes is the cascade again, now with good intentions.
 */
describe("revogação de aparelho no fio", () => {
  function revogacao(): Payload {
    return {
      t: "device.revoke",
      // 32 bytes in base64url are 43 characters; 64 bytes are 86.
      device: "A".repeat(43),
      revokedAt: 1_700_000_000_000,
      sig: "B".repeat(86),
    } as Payload
  }

  it("faz a ida e volta inteira", () => {
    const lida = decodePayload(encodePayload(revogacao())) as Record<string, unknown>

    expect(lida).toMatchObject({
      t: "device.revoke",
      device: "A".repeat(43),
      revokedAt: 1_700_000_000_000,
      sig: "B".repeat(86),
    })
  })

  it("uma chave e uma assinatura reais cabem nos limites do campo", () => {
    // The sizes are not made up: they are from an Ed25519 key and an Ed25519
    // signature in base64url, which is what the sender will put there.
    const chave = "n4bQgYhMfWWaL-qgxVrQFaO_TxsrC4Is0V1sFbDwCgg"
    const assinatura = `${"x".repeat(80)}_-Ab7z`
    const lida = decodePayload(encodePayload({ ...revogacao(), device: chave, sig: assinatura } as Payload))

    expect(lida).toMatchObject({ device: chave, sig: assinatura })
  })

  it("sem a assinatura da conta não é uma revogação", () => {
    // MLS authenticates the LEAF, and a leaf is a device. Without the account
    // signature, a stolen device would revoke its siblings and be left speaking
    // alone for the person. A missing field must hurt at the sender, where
    // someone sees it.
    const semAssinatura = { t: "device.revoke", device: "A".repeat(43), revokedAt: 1 }
    expect(() => encodePayload(semAssinatura as Payload)).toThrow()
    expect(() => decodePayload(new TextEncoder().encode(JSON.stringify(semAssinatura)))).toThrow()
  })

  it("uma chave que não é base64url é recusada nos dois lados", () => {
    const torta = { ...revogacao(), device: "isto não são bytes!" }
    expect(() => encodePayload(torta as Payload)).toThrow()
    expect(() => decodePayload(new TextEncoder().encode(JSON.stringify(torta)))).toThrow()
  })

  it("uma chave vazia é recusada, e não silenciosamente acreditada", () => {
    // An empty string passes any regex without `min`, and revoking "no device" is
    // an order with no target that the receiver would have to guess.
    expect(() => encodePayload({ ...revogacao(), device: "" } as Payload)).toThrow()
    expect(() => encodePayload({ ...revogacao(), sig: "" } as Payload)).toThrow()
  })

  it("um carimbo negativo é recusado no remetente", () => {
    expect(() => encodePayload({ ...revogacao(), revokedAt: -1 } as Payload)).toThrow()
  })

  it("um campo futuro é despido, e não derruba a revogação", () => {
    // The house rule: whoever does not know a field lets it drop. If instead it
    // rejected, a future version would deafen all earlier ones.
    const nova = JSON.stringify({ ...revogacao(), motivo: "portátil roubado no comboio" })
    const lida = decodePayload(new TextEncoder().encode(nova)) as Record<string, unknown>

    expect(lida).toMatchObject({ t: "device.revoke" })
    expect(lida).not.toHaveProperty("motivo")
  })
})
