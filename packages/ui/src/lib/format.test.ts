import { moradaDeTeste } from "../../testes/moradas.js"
import { lembrarFichasDosCanais } from "./tipoDoCanal.js"
import { beforeEach, describe, expect, it } from "vitest"
import { generateIdentity, parseServerName } from "@enclave/protocol"
import type { ChatMessage } from "../types.js"
import {
  comEmendas,
  directaPorResolver,
  dmPeerAddress,
  extractTags,
  feedOf,
  filterByTag,
  formatRelative,
  friendRequestsOf,
  lastActivityOf,
  owedFollowersOf,
  postKindOf,
  presenceKindOf,
  presenceOf,
  shortAddress,
} from "./format.js"

const DM_A_B = moradaDeTeste("directa a b", "s")
const DM_ABC_XYZ = moradaDeTeste("directa abc xyz", "s")
const DM_C_D = moradaDeTeste("directa c d", "s")
const DIRECTA_EU_OUTRO = moradaDeTeste("directa eu outro", "casa.pt")
const DM_UM_DOIS = moradaDeTeste("directa um dois", "s")
const DM_X_Y = moradaDeTeste("directa x y", "s")
const MURAL_A = moradaDeTeste("mural a", "s")
const MURAL_ANA = moradaDeTeste("mural ana", "s")
// The sheet for each channel (1.0 "Arca", slice 6b): no sheet, a channel is a room.
beforeEach(() =>
  lembrarFichasDosCanais({
    [DM_A_B]: { tipo: "directa" },
    [DM_ABC_XYZ]: { tipo: "directa" },
    [DM_C_D]: { tipo: "directa" },
    [DIRECTA_EU_OUTRO]: { tipo: "directa" },
    [DM_UM_DOIS]: { tipo: "directa" },
    [DM_X_Y]: { tipo: "directa" },
    [MURAL_A]: { tipo: "mural", dono: "@a:s" },
    [MURAL_ANA]: { tipo: "mural", dono: "@ana:s" },
  }),
)

// A fixed clock: midday, well clear of any midnight boundary.
const NOW = new Date(2026, 7, 3, 12, 0, 0).getTime()

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 24 * HOUR

describe("formatRelative", () => {
  it("sem timestamp não inventa nada", () => {
    expect(formatRelative(undefined, NOW)).toBe("")
    expect(formatRelative(0, NOW)).toBe("")
  })

  it('menos de um minuto é "agora mesmo"', () => {
    expect(formatRelative(NOW - 10_000, NOW)).toBe("agora mesmo")
    expect(formatRelative(NOW - 59_000, NOW)).toBe("agora mesmo")
  })

  it("um timestamp do futuro é desvio de relógio, não viagem no tempo", () => {
    expect(formatRelative(NOW + 5 * MIN, NOW)).toBe("agora mesmo")
  })

  it("minutos até à hora", () => {
    expect(formatRelative(NOW - MIN, NOW)).toBe("há 1 min")
    expect(formatRelative(NOW - 5 * MIN, NOW)).toBe("há 5 min")
    expect(formatRelative(NOW - 59 * MIN, NOW)).toBe("há 59 min")
  })

  it("horas até ao dia", () => {
    expect(formatRelative(NOW - 60 * MIN, NOW)).toBe("há 1 h")
    expect(formatRelative(NOW - 2 * HOUR, NOW)).toBe("há 2 h")
    expect(formatRelative(NOW - 23 * HOUR, NOW)).toBe("há 23 h")
  })

  it('o dia de ontem chama-se "ontem"', () => {
    expect(formatRelative(NOW - DAY, NOW)).toBe("ontem")
    // 30 hours ago still falls on yesterday's calendar day.
    expect(formatRelative(NOW - 30 * HOUR, NOW)).toBe("ontem")
  })

  it("mais antigo que ontem passa a data absoluta, sem ano se for o mesmo", () => {
    const at = NOW - 3 * DAY
    expect(formatRelative(at, NOW)).toBe(
      new Date(at).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" }),
    )
  })

  it("outro ano inclui o ano", () => {
    const at = new Date(2024, 11, 25, 9, 30).getTime()
    expect(formatRelative(at, NOW)).toBe(
      new Date(at).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", year: "numeric" }),
    )
  })
})

function post(id: string, tags: string[] | undefined): ChatMessage {
  return { channel: MURAL_A, seq: 1, sender: "@a:s", payload: { t: "post", id, ...(tags ? { tags } : {}) } }
}

describe("filterByTag", () => {
  const feed = [post("1", ["gatos", "sofá"]), post("2", ["cães"]), post("3", undefined)]

  it("null devolve tudo, intocado", () => {
    expect(filterByTag(feed, null)).toBe(feed)
  })

  it("filtra pelos posts que carregam a tag", () => {
    expect(filterByTag(feed, "gatos").map((p) => p.payload.id)).toEqual(["1"])
    expect(filterByTag(feed, "cães").map((p) => p.payload.id)).toEqual(["2"])
  })

  it("posts sem tags nunca passam num filtro", () => {
    expect(filterByTag(feed, "inexistente")).toEqual([])
  })
})

describe("extractTags", () => {
  it("apanha tags únicas, sem o cardinal", () => {
    expect(extractTags("olá #mundo e #mundo outra vez, #já")).toEqual(["mundo", "já"])
  })

  it("sem tags devolve vazio", () => {
    expect(extractTags("nada para ver aqui")).toEqual([])
  })
})

// Default channel is @ana's feed, because she is who publishes in these cases:
// a post counts only in the feed of who subscribes to it, and a test fixture
// mixing owner and author would stop proving what it claims to prove.
function raw(sender: string, payload: ChatMessage["payload"], channel = MURAL_ANA): ChatMessage {
  return { channel, seq: 1, sender, payload }
}

describe("feedOf — edições e apagados", () => {
  const original = raw("@ana:s", { t: "post", id: "p1", postedAt: 100, caption: "primeira #velha" })

  it("uma edição do autor substitui a legenda e re-extrai as #tags", () => {
    const folded = feedOf([
      original,
      raw("@ana:s", { t: "edit", id: "e1", target: "p1", editedAt: 200, body: "corrigida #nova" }),
    ])
    expect(folded).toHaveLength(1)
    expect(folded[0]?.payload.caption).toBe("corrigida #nova")
    expect(folded[0]?.payload.tags).toEqual(["nova"])
    expect(folded[0]?.payload.editedAt).toBe(200)
    // Position in the feed does not change: editing is not a way to move up the list.
    expect(folded[0]?.payload.postedAt).toBe(100)
  })

  it("a edição mais recente ganha", () => {
    const folded = feedOf([
      original,
      raw("@ana:s", { t: "edit", id: "e1", target: "p1", editedAt: 200, body: "segunda" }),
      raw("@ana:s", { t: "edit", id: "e2", target: "p1", editedAt: 300, body: "terceira" }),
    ])
    expect(folded[0]?.payload.caption).toBe("terceira")
  })

  it("ninguém edita as palavras dos outros: remetente diferente é ignorado", () => {
    const folded = feedOf([
      original,
      raw("@intruso:s", { t: "edit", id: "e1", target: "p1", editedAt: 200, body: "hackeada" }),
      raw("@intruso:s", { t: "redact", id: "r1", target: "p1", redactedAt: 200 }),
    ])
    expect(folded).toHaveLength(1)
    expect(folded[0]?.payload.caption).toBe("primeira #velha")
  })

  it("um redact do autor remove a publicação", () => {
    const folded = feedOf([original, raw("@ana:s", { t: "redact", id: "r1", target: "p1", redactedAt: 200 })])
    expect(folded).toHaveLength(0)
  })
})

/**
 * The same post stated twice is one post, not two.
 *
 * Reported by the owner in production: "posts appear duplicated". It is not
 * twice as many-it is the SAME post, same `id`, stored twice. `republishPosts`
 * restates the wall on each new feed entry, precisely so newcomers do not find
 * an empty wall, and writes in the header that this is "idempotent by design:
 * `feedOf` indexes posts by `id`". It indexed into the edits fold and returned
 * the raw list, so idempotence was a claim, not a mechanism.
 *
 * Two copies with the same `id` also gave two equal `key` to React's list,
 * which is the other sign of never expecting them.
 */
describe("feedOf — a mesma publicação dita outra vez", () => {
  const publicada = raw("@ana:s", { t: "post", id: "p1", postedAt: 100, caption: "primeira" })

  it("uma republicação da mesma publicação não é um segundo cartão", () => {
    const folded = feedOf([publicada, { ...publicada, seq: 9 }])
    expect(folded).toHaveLength(1)
    expect(folded[0]?.payload.caption).toBe("primeira")
  })

  it("e um só redact apaga a publicação, por muitas cópias que dela existam", () => {
    const folded = feedOf([
      publicada,
      { ...publicada, seq: 9 },
      raw("@ana:s", { t: "redact", id: "r1", target: "p1", redactedAt: 200 }),
      // A republish that arrives AFTER deletion does not resurrect anything: the
      // tombstone is on the `id`, and the `id` does not change.
      { ...publicada, seq: 20 },
    ])
    expect(folded).toHaveLength(0)
  })

  it("uma cópia sem as fotografias não apaga as que a primeira trazia", () => {
    // The publisher's vault dumps old media by quota; a republish can come back
    // without the photos. Keeping that one would erase from the screen an image
    // this device still has.
    const comFoto = raw("@ana:s", {
      t: "post",
      id: "p2",
      postedAt: 100,
      caption: "com foto",
      media: [{ inline: "data:image/png;base64,AAA", name: "uma", mediaType: "image/png" }],
    })
    const semFoto = raw("@ana:s", { t: "post", id: "p2", postedAt: 100, caption: "com foto", media: [] })

    expect(feedOf([comFoto, { ...semFoto, seq: 9 }])[0]?.payload.media).toHaveLength(1)
    expect(feedOf([semFoto, { ...comFoto, seq: 9 }])[0]?.payload.media).toHaveLength(1)
  })
})

/**
 * The same fold, now for messages in a conversation.
 *
 * The feed one always existed and this one did not: `edit` and `redact`
 * reached the channel, were stored in the vault, and changed nothing on
 * screen. Writing the wrong sentence in a conversation was writing it forever.
 */
describe("comEmendas — a conversa", () => {
  const dita = raw("@ana:s", { t: "message", id: "m1", sentAt: 100, body: "primeira" }, "!geral:s")

  it("uma edição do autor troca o corpo e deixa a marca", () => {
    const dobrado = comEmendas([
      dita,
      raw("@ana:s", { t: "edit", id: "e1", target: "m1", editedAt: 200, body: "corrigida" }, "!geral:s"),
    ])
    expect(dobrado).toHaveLength(1)
    expect(dobrado[0]?.payload.body).toBe("corrigida")
    expect(dobrado[0]?.payload.editedAt).toBe(200)
    // And it stays where it was: a spelling fix does not jump ahead of what was
    // said after it.
    expect(dobrado[0]?.payload.sentAt).toBe(100)
  })

  it("a edição mais recente ganha", () => {
    const dobrado = comEmendas([
      dita,
      raw("@ana:s", { t: "edit", id: "e1", target: "m1", editedAt: 200, body: "segunda" }, "!geral:s"),
      raw("@ana:s", { t: "edit", id: "e2", target: "m1", editedAt: 300, body: "terceira" }, "!geral:s"),
    ])
    expect(dobrado[0]?.payload.body).toBe("terceira")
  })

  it("um redact do autor tira a mensagem da conversa", () => {
    const dobrado = comEmendas([
      dita,
      raw("@ana:s", { t: "redact", id: "r1", target: "m1", redactedAt: 200 }, "!geral:s"),
    ])
    expect(dobrado).toHaveLength(0)
  })

  it("ninguém apaga nem reescreve as palavras dos outros", () => {
    /*
      The guard that matters, and why it lives on READ: any member of the
      group can SEND a redact with another member's message ID-the payload is
      the same and the group is shared. What keeps it harmless is each honest
      client rejecting anything that does not come from who wrote it, against
      the authenticated sender via MLS.
    */
    const dobrado = comEmendas([
      dita,
      raw("@intruso:s", { t: "edit", id: "e1", target: "m1", editedAt: 200, body: "não fui eu" }, "!geral:s"),
      raw("@intruso:s", { t: "redact", id: "r1", target: "m1", redactedAt: 200 }, "!geral:s"),
    ])
    expect(dobrado).toHaveLength(1)
    expect(dobrado[0]?.payload.body).toBe("primeira")
  })

  it("uma emenda sem original não inventa mensagem nenhuma", () => {
    // Edit arrives and the message has not-or already left the vault by history
    // cap. There is nothing to fold, and no line is made to receive it.
    const dobrado = comEmendas([
      raw("@ana:s", { t: "edit", id: "e1", target: "desaparecida", editedAt: 200, body: "x" }, "!geral:s"),
    ])
    expect(dobrado).toHaveLength(0)
  })
})

describe("feedOf — de quem é o feed", () => {
  const daAna = raw("@ana:s", { t: "post", id: "p1", postedAt: 100, caption: "minha" })

  it("uma publicação de terceiro no feed de outra pessoa não entra", () => {
    // Who follows someone has a seat in that person's feed and can write there.
    // That is how comments work. What they cannot do is have their post appear as
    // if it came from the feed that holds it.
    const folded = feedOf([
      daAna,
      raw("@intruso:s", { t: "post", id: "p2", postedAt: 300, caption: "não pediste isto" }),
    ])
    expect(folded).toHaveLength(1)
    expect(folded[0]?.payload.id).toBe("p1")
  })

  it("uma publicação fora de um canal de feed não entra", () => {
    // Posting always sends to your own feed. A `post` in a conversation room is
    // not a publication: it is someone building the payload by hand.
    const folded = feedOf([raw("@ana:s", { t: "post", id: "p9", postedAt: 400 }, "!geral:s")])
    expect(folded).toHaveLength(0)
  })

  it("o dono continua a poder editar e apagar o que é seu", () => {
    const folded = feedOf([daAna, raw("@ana:s", { t: "edit", id: "e1", target: "p1", editedAt: 200, body: "outra" })])
    expect(folded).toHaveLength(1)
    expect(folded[0]?.payload.caption).toBe("outra")
  })
})

describe("friendRequestsOf", () => {
  const ME = "@me:s"

  it("um pedido de outra pessoa fica aberto até eu aceitar nesse canal", () => {
    const messages = [raw("@ana:s", { t: "friend.request", sentAt: 100 }, DM_A_B)]
    expect(friendRequestsOf(messages, ME)).toEqual([
      { sender: "@ana:s", channel: DM_A_B, sentAt: 100, note: undefined },
    ])

    const accepted = [...messages, raw(ME, { t: "friend.accept", acceptedAt: 150 }, DM_A_B)]
    expect(friendRequestsOf(accepted, ME)).toEqual([])
  })

  it("os meus próprios pedidos não aparecem na minha caixa", () => {
    expect(friendRequestsOf([raw(ME, { t: "friend.request", sentAt: 100 })], ME)).toEqual([])
  })
})

describe("dmPeerAddress", () => {
  it("devolve a outra pessoa de uma DM pela ficha (fatia 3: o nome já não a diz)", () => {
    lembrarFichasDosCanais({ [DM_ABC_XYZ]: { tipo: "directa", par: "@xyz:s" } })
    expect(dmPeerAddress(DM_ABC_XYZ, "@abc:s")).toBe("@xyz:s")
    lembrarFichasDosCanais({ [DM_ABC_XYZ]: { tipo: "directa", par: "@abc:s" } })
    expect(dmPeerAddress(DM_ABC_XYZ, "@xyz:s")).toBe("@abc:s")
  })

  it("nunca inventa: sala normal, DM alheia ou sem mim dá null", () => {
    expect(dmPeerAddress("!geral:s", "@abc:s")).toBeNull()
    expect(dmPeerAddress(DM_UM_DOIS, "@tres:s")).toBeNull()
    expect(dmPeerAddress(DM_ABC_XYZ, null)).toBeNull()
  })
})

describe("lastActivityOf", () => {
  it("guarda o instante mais recente por pessoa, venha de post ou mensagem", () => {
    const seen = lastActivityOf([
      raw("@ana:s", { t: "message", id: "m1", sentAt: 100 }),
      raw("@ana:s", { t: "post", id: "p1", postedAt: 300 }),
      raw("@rui:s", { t: "message", id: "m2", sentAt: 200 }),
    ])
    expect(seen.get("@ana:s")).toBe(300)
    expect(seen.get("@rui:s")).toBe(200)
  })
})

describe("postKindOf", () => {
  it("media ganha a links; links ganham a texto", () => {
    const base = { channel: MURAL_A, seq: 1, sender: "@a:s" }
    expect(postKindOf({ ...base, payload: { t: "post", id: "1", media: [{ inline: "x" }], links: [{ url: "u", kind: "link" }] } })).toBe("fotos")
    expect(postKindOf({ ...base, payload: { t: "post", id: "2", links: [{ url: "u", kind: "link" }] } })).toBe("links")
    expect(postKindOf({ ...base, payload: { t: "post", id: "3", caption: "só palavras" } })).toBe("texto")
  })

  /**
   * A post that is only a document is not a photo post.
   *
   * Before file attachments, `media` only carried images and having one made
   * the post "photos". With a PDF inside, that became a lie: the post appeared
   * in the photos section and vanished from the sight of who went to find it.
   */
  const base = { channel: MURAL_A, seq: 1, sender: "@a:s" }
  const post = (media: unknown[]): Parameters<typeof postKindOf>[0] =>
    ({ ...base, payload: { t: "post", id: "x", media } }) as Parameters<typeof postKindOf>[0]

  it("só documentos é uma publicação de ficheiros", () => {
    expect(postKindOf(post([{ inline: "x", mediaType: "application/pdf" }]))).toBe("ficheiros")
    expect(postKindOf(post([{ inline: "x", mediaType: "application/zip" }]))).toBe("ficheiros")
  })

  it("basta UMA imagem para voltar a ser de fotos", () => {
    // It is what the eye sees first. A PDF hanging next to a photo does not
    // change what the post is.
    expect(postKindOf(post([{ inline: "x", mediaType: "application/pdf" }, { inline: "y", mediaType: "image/webp" }]))).toBe("fotos")
  })

  it("média sem tipo declarado continua a ser fotos", () => {
    // For the entire product life until this existed, `media` only carried
    // images. An item with no type is from that era-and changing its section now
    // would be rewriting everyone's past.
    expect(postKindOf(post([{ inline: "x" }]))).toBe("fotos")
  })

  it("um documento despejado do cofre NÃO muda de secção", () => {
    // Dump saves `mediaType` and drops `kind`. Sorting by `kind` would shift the
    // post to another section as it aged.
    expect(postKindOf(post([{ evicted: true, name: "a.pdf", mediaType: "application/pdf" }]))).toBe("ficheiros")
    expect(postKindOf(post([{ evicted: true, name: "f.webp", mediaType: "image/webp" }]))).toBe("fotos")
  })
})

describe("presenceOf", () => {
  const NOW_P = 1_000_000_000
  it("verde com actividade há menos de dez minutos; cinzento depois", () => {
    const seen = new Map([["@ana:s", NOW_P - 60_000], ["@rui:s", NOW_P - 11 * 60_000]])
    expect(presenceOf(seen, "@ana:s", NOW_P)).toBe("active")
    expect(presenceOf(seen, "@rui:s", NOW_P)).toBe("idle")
    expect(presenceOf(seen, "@nunca:s", NOW_P)).toBe("idle")
  })
})

describe("owedFollowersOf", () => {
  const ME = "@me:s"

  it("quem me aceitou merece follow-back; quem eu aceitei devia ler-me", () => {
    const owed = owedFollowersOf(
      [
        raw("@ana:s", { t: "friend.accept", acceptedAt: 100 }, DM_A_B),
        raw("@rui:s", { t: "friend.request", sentAt: 50 }, DM_C_D),
        raw(ME, { t: "friend.accept", acceptedAt: 60 }, DM_C_D),
      ],
      ME,
    )
    expect(owed).toEqual(new Set(["@ana:s", "@rui:s"]))
  })

  it("pedidos sem aceitação minha não obrigam a nada", () => {
    const owed = owedFollowersOf([raw("@zoe:s", { t: "friend.request", sentAt: 50 }, DM_X_Y)], ME)
    expect(owed).toEqual(new Set())
  })
})

describe("presenceKindOf", () => {
  it("ligado + ocupado = ocupado; ligado sem escolha = online; desligado = offline", () => {
    expect(presenceKindOf(true, undefined)).toBe("active")
    expect(presenceKindOf(true, "online")).toBe("active")
    expect(presenceKindOf(true, "ocupado")).toBe("busy")
    expect(presenceKindOf(false, "ocupado")).toBe("idle")
    expect(presenceKindOf(false, undefined)).toBe("idle")
  })

  it("ligado + ausente = ausente (o amarelo); desligado continua offline", () => {
    expect(presenceKindOf(true, "ausente")).toBe("away")
    expect(presenceKindOf(false, "ausente")).toBe("idle")
  })
})

describe("shortAddress", () => {
  it("é a primeira palavra, inteira, sem reticências", () => {
    expect(shortAddress("@milsinda-odreto-viddyvox-pofletum:orwell.pt")).toBe("milsinda")
  })

  it("funciona sobre um endereço derivado a sério, e não sobre um escrito à mão", () => {
    // Derived, not written: address format has changed twice already, and a
    // hand-written address in a test is a claim about yesterday's format.
    const { address } = generateIdentity(parseServerName("orwell.pt"))
    const curto = shortAddress(address)
    const local = address.replace(/^@/, "").split(":")[0] ?? ""

    expect(local.startsWith(curto)).toBe(true)
    expect(curto).toBe(local.split("-")[0])
    // One word, not a snippet: no ellipsis, no hyphens.
    expect(curto).not.toContain("…")
    expect(curto).not.toContain("-")
    expect(curto.length).toBeGreaterThan(3)
  })

  it("aguenta um endereço mal formado sem inventar nada", () => {
    expect(shortAddress("semarroba")).toBe("semarroba")
    expect(shortAddress("")).toBe("")
  })
})

/**
 * The new channel that has no name yet.
 *
 * Measured live on 10 September 2026: with the app closed when the friend
 * request arrived, opening it sent TWO notifications of the same event, and
 * one said "Added to #Ana" about a direct conversation. The other side's
 * address had not resolved when the channel list came, so there was no way to
 * know the name.
 */
describe("uma directa que ainda não se sabe anunciar", () => {
  const DIRECTA = DIRECTA_EU_OUTRO
  const CANAL = "!lagar:casa.pt"

  it("espera, quando é directa e o outro lado ainda não se sabe", () => {
    expect(directaPorResolver(DIRECTA, null)).toBe(true)
  })

  it("não espera quando já se sabe quem é o outro lado", () => {
    expect(directaPorResolver(DIRECTA, "@outro:casa.pt")).toBe(false)
  })

  /*
    And the half that stops the guard from eating what is not hers: a normal
    channel has no other side to resolve, and waiting for it would silence the
    notification for every channel where someone adds you.
  */
  it("um canal nunca espera, com ou sem endereço", () => {
    expect(directaPorResolver(CANAL, null)).toBe(false)
    expect(directaPorResolver(CANAL, "@outro:casa.pt")).toBe(false)
  })
})
