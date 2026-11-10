import { friendsOfTies, type Payload } from "@enclave/protocol"
import { DatabaseSync } from "node:sqlite"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
// The server of the server harness, for real, on an ephemeral port, and its
// accounts and pairing. The sessions are those of this package: it is the core
// being tested.
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
// From `dist`, like the sessions of the harness: the caps that come down are theirs.
import {
  chaveDoEvento,
  dobrarConversa,
  entradasDoCanal,
  TECTOS_DO_FIO_DO_HISTORICO,
  TECTOS_DO_HISTORICO,
  type StoredChatMessage,
  type VaultContents,
} from "@enclave/client-core"

/**
 * History across devices on the same account (1.0 "Arca", 29/10/2026).
 *
 * The owner's request: "and that can also apply to messages and everything
 * else", and when asked about timeframe and large files, "everything". The new
 * device receives, during pairing and without prompting, all history from the
 * primary: conversations, bulletin boards, tickets, pins, votes and media. And
 * what one account device lost while offline arrives from another via the
 * account channel.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const tectosDoFio = { ...TECTOS_DO_FIO_DO_HISTORICO }
const tectosDoConteudo = { ...TECTOS_DO_HISTORICO }

beforeAll(async () => {
  /*
    Signal caps rise on the test server, and history caps on the client: the
    production ones (40 signals per minute) would take minutes to pass what is
    measured here. Pages come down, so history comes in many and a failure mid
    page has somewhere to land.
  */
  servidor = await levantarServidor({ sinal: { porMinutoPorLigacao: 100_000, bytesPorCanalPorMinuto: 1024 * 1024 * 1024 } })
  Object.assign(TECTOS_DO_FIO_DO_HISTORICO, {
    sinaisPorMinuto: 50_000,
    passoMs: 200,
    esperaDaRespostaMs: 3_000,
    esperaDoInventarioMs: 3_000,
    primeiraReposicaoMs: 1_000,
    intervaloDaReposicaoMs: 1_000,
  })
  Object.assign(TECTOS_DO_HISTORICO, { bytesPorPagina: 4 * 1024, entradasPorPagina: 8 })
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  Object.assign(TECTOS_DO_FIO_DO_HISTORICO, tectosDoFio)
  Object.assign(TECTOS_DO_HISTORICO, tectosDoConteudo)
  await servidor?.fechar()
})

async function contas(...nomes: string[]): Promise<ContaDeTeste[]> {
  const novas = await contasDeTeste(servidor, nomes)
  abertas.push(...novas)
  return novas
}

async function amigos(a: ContaDeTeste, b: ContaDeTeste): Promise<string> {
  const dm = await a.session.openDirect(b.address)
  await ate(() => b.session.channels.includes(dm), `${b.nome} entra na directa`)
  await a.session.sendFriendRequest(dm)
  await ate(() => b.session.friendTies().get(a.address)?.link === "pedido-recebido", `o pedido chega a ${b.nome}`)
  await b.session.acceptFriend(dm, a.address)
  await ate(
    () => friendsOfTies(a.session.friendTies()).includes(b.address) && friendsOfTies(b.session.friendTies()).includes(a.address),
    "os dois são amigos",
  )
  return dm
}

function mensagem(corpo: string, anexo?: { nome: string; bytes: number }): Payload {
  const inline = anexo ? `data:image/png;base64,${"A".repeat(anexo.bytes)}` : undefined
  return {
    t: "message",
    id: crypto.randomUUID(),
    sentAt: Date.now(),
    body: corpo,
    attachments: anexo
      ? [{ url: "", key: "", nonce: "", digest: "", kind: "image", name: anexo.nome, mediaType: "image/png", byteLength: anexo.bytes, inline }]
      : [],
    links: [],
    mentions: [],
  } as unknown as Payload
}

/** The identity of an entry: the event key, or the `seq`. */
const identidade = (entrada: StoredChatMessage): string => chaveDoEvento(entrada) ?? `seq:${entrada.seq}`

/** The identities of entries in a channel, without the actions inherited from pairing. */
function identidades(contents: VaultContents, canal: string): string[] {
  return entradasDoCanal(contents, canal)
    .filter((entrada) => !entrada.herdado)
    .map(identidade)
}

/** The bodies of messages seen in the channel: the tombstones folded, as in the interface. */
const corpos = (conta: ContaDeTeste, canal: string): string[] =>
  dobrarConversa(entradasDoCanal(conta.vault.contents, canal))
    .filter((e) => e.payload.t === "message")
    .map((e) => String(e.payload["body"]))

/** The inline attachment of a message with this body, if present with the bytes. */
function inlineDe(contents: VaultContents, canal: string, corpo: string): string | undefined {
  const entrada = entradasDoCanal(contents, canal).find((e) => e.payload["body"] === corpo)
  const anexo = (entrada?.payload["attachments"] as { inline?: string }[] | undefined)?.[0]
  return anexo?.inline
}

/**
 * A server that lost events: deletes messages (not commits) from the channel
 * with `seq` between `desde` and `ate`, exclusive. Returns how many. Always
 * leaves one event after: the server numbers from the largest stored `seq`, and
 * deleting the last ones would make it give the same numbers to new events.
 */
function apagarDoServidor(canal: string, desde: number, ate: number): number {
  const base = new DatabaseSync(servidor.baseDeDados)
  try {
    const feito = base
      .prepare("DELETE FROM events WHERE channel = ? AND seq > ? AND seq < ? AND kind = 'application'")
      .run(canal, desde, ate)
    return Number(feito.changes)
  } finally {
    base.close()
  }
}

describe("o histórico no emparelhamento", () => {
  it("o aparelho novo recebe tudo, sem duplicados, sem ressuscitar o eliminado, e retoma depois de uma queda", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const dm = await amigos(ana!, bruno!)

    // A conversation with Bruno: twenty messages, one heavy image and one light.
    for (let n = 1; n <= 12; n++) await ana!.session.send(dm, mensagem(`da Ana ${n}`))
    for (let n = 1; n <= 8; n++) await bruno!.session.send(dm, mensagem(`do Bruno ${n}`))
    await ana!.session.send(dm, mensagem("a fotografia grande", { nome: "grande.png", bytes: 120_000 }))
    await ana!.session.send(dm, mensagem("a fotografia pequena", { nome: "pequena.png", bytes: 2_000 }))
    const apagada = mensagem("isto vai ser apagado")
    await ana!.session.send(dm, apagada)
    await ate(() => corpos(ana!, dm).includes("isto vai ser apagado"), "a Ana tem a mensagem a apagar")
    await ana!.session.deleteMessage(dm, (apagada as { id: string }).id)
    await ate(() => !corpos(ana!, dm).includes("isto vai ser apagado"), "a Ana apagou a mensagem")
    await ate(() => corpos(ana!, dm).filter((c) => c.startsWith("do Bruno")).length === 8, "a Ana tem as mensagens do Bruno", 30_000)

    // A channel with Carla: an open ticket with a reply, a deleted one, and a pinned message.
    const canal = await canalComTodos(servidor, ana!, [carla!])
    const aberto = await ana!.session.openTicket(canal, "", "A porta não fecha")
    await ana!.session.replyToTicket(canal, "", aberto, "Já chamei alguém.")
    const eliminado = await ana!.session.openTicket(canal, "", "Um ticket a eliminar")
    await ate(() => ana!.session.ticketsOf(canal, "").length === 2, "a Ana tem os dois tickets")
    await ana!.session.setTicketState(canal, "", eliminado, "closed")
    await ate(() => ana!.session.ticketsOf(canal, "").find((t) => t.id === eliminado)?.state === "closed", "o ticket fecha")
    await ana!.session.deleteTicket(canal, "", eliminado)
    await ate(() => ana!.session.ticketsOf(canal, "").length === 1, "a Ana eliminou um ticket")
    const fixar = mensagem("Leiam isto primeiro.")
    await ana!.session.send(canal, fixar)
    await ana!.session.pinMessage(canal, "", {
      id: (fixar as { id: string }).id,
      sender: ana!.address,
      body: "Leiam isto primeiro.",
      sentAt: Date.now(),
    })
    await ate(() => ana!.session.pinnedOf(canal, "").length === 1, "a Ana fixou uma mensagem")

    // The bulletin board: a post with a vote, a vote and a comment from Bruno.
    const publicacao = await ana!.session.post("Vamos ao rio?", [], { poll: { question: "Vamos ao rio?", options: ["Sim", "Não"] } })
    const mural = ana!.session.feedChannel
    await ana!.session.voteOnPoll(mural, publicacao, 0)
    await ate(() => bruno!.session.channels.includes(mural), "o Bruno lê o mural da Ana", 30_000)
    await ate(() => entradasDoCanal(bruno!.vault.contents, mural).some((e) => e.payload["id"] === publicacao), "a publicação chega ao Bruno", 30_000)
    await bruno!.session.commentOnPost(mural, publicacao, "Eu vou!")
    await ate(
      () => entradasDoCanal(ana!.vault.contents, mural).some((e) => e.payload.t === "post.comment"),
      "o comentário chega à Ana",
      30_000,
    )
    await ana!.session.flush()

    // Bruno and Carla disconnect: history comes from Ana, and from no one else.
    bruno!.session.disconnect()
    carla!.session.disconnect()

    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    const lidasAntes = { ...(telemovel.vault.contents.lidas ?? {}) }
    /*
      Midway, the connection drops: on the very event of the first page that
      arrives, not on a test clock. With the machine loaded, a clock would see
      the page and arrive after the end.
    */
    let plano: NonNullable<VaultContents["historico"]>["plano"]
    const largar = telemovel.session.on("historico", (evento) => {
      if (!evento.aTrazer || evento.feitas === 0 || evento.feitas >= evento.total) return
      largar()
      telemovel.session.disconnect()
      plano = structuredClone(telemovel.vault.contents.historico?.plano)
    })
    await ate(() => plano !== undefined, "o histórico começa a chegar", 60_000)
    expect(plano).toBeDefined()
    expect(Object.values(plano!.canais).some((c) => c.cursor !== null)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await telemovel.session.connect()

    await ate(() => telemovel.vault.contents.historico?.plano === undefined, "o histórico acaba de chegar", 120_000)
    expect(telemovel.vault.contents.historico?.inicial).toBeUndefined()

    for (const c of [dm, canal, mural]) {
      const daAna = identidades(ana!.vault.contents, c)
      const doTelemovel = identidades(telemovel.vault.contents, c)
      // Everything Ana has, the phone has.
      expect(doTelemovel).toEqual(expect.arrayContaining(daAna))
      // No duplicates.
      expect(new Set(doTelemovel).size).toBe(doTelemovel.length)
    }
    // The entire conversation, and the deleted stays deleted.
    expect(corpos(telemovel, dm).filter((c) => c.startsWith("da Ana")).length).toBe(12)
    expect(corpos(telemovel, dm).filter((c) => c.startsWith("do Bruno")).length).toBe(8)
    expect(corpos(telemovel, dm)).not.toContain("isto vai ser apagado")
    // The media: the large photo arrives at the end, the small one with the text.
    expect(inlineDe(telemovel.vault.contents, dm, "a fotografia grande")).toBe(inlineDe(ana!.vault.contents, dm, "a fotografia grande"))
    expect(inlineDe(telemovel.vault.contents, dm, "a fotografia pequena")).toBe(inlineDe(ana!.vault.contents, dm, "a fotografia pequena"))
    // The tickets: the open one with the reply, and the deleted one stays deleted.
    const tickets = telemovel.session.ticketsOf(canal, "")
    expect(tickets.map((t) => t.id)).toEqual([aberto])
    // A fixada.
    expect(telemovel.session.pinnedOf(canal, "").map((f) => f.body)).toEqual(["Leiam isto primeiro."])
    // The bulletin board: the post, the vote and the comment.
    const doMural = entradasDoCanal(telemovel.vault.contents, mural)
    expect(doMural.some((e) => e.payload["id"] === publicacao)).toBe(true)
    expect(doMural.some((e) => e.payload.t === "post.comment" && e.payload["body"] === "Eu vou!")).toBe(true)
    expect(doMural.some((e) => e.payload.t === "post.reaction" && e.payload["vote"] === 0)).toBe(true)
    // Read marks did not go backwards.
    for (const [c, marca] of Object.entries(lidasAntes)) expect(telemovel.vault.contents.lidas?.[c] ?? 0).toBeGreaterThanOrEqual(marca)
    // The channel founded by Ana: no "You joined here" marker on the phone.
    expect(telemovel.session.lugarEm(canal)).toBeNull()

    // A second pass brings no duplicates: the summary is the same.
    const antes = identidades(telemovel.vault.contents, dm).length
    telemovel.session.disconnect()
    await telemovel.session.connect()
    await new Promise((resolve) => setTimeout(resolve, 4_000))
    expect(identidades(telemovel.vault.contents, dm).length).toBe(antes)
  }, 300_000)
})

describe("o histórico entre aparelhos já emparelhados", () => {
  it("o que o telemóvel perdeu desligado chega-lhe do computador pelo canal da conta; um canal esquecido não volta", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const dm = await amigos(ana!, bruno!)
    const canal = await canalComTodos(servidor, ana!, [carla!])
    await ana!.session.send(dm, mensagem("antes de emparelhar"))
    await ana!.session.send(canal, mensagem("no canal, antes"))
    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    await ate(() => telemovel.vault.contents.historico?.plano === undefined && telemovel.vault.contents.historico?.inicial === undefined, "o primeiro histórico chega", 120_000)
    await ate(() => corpos(telemovel, dm).includes("antes de emparelhar"), "o telemóvel tem a conversa")

    // The phone forgets Carla's channel: the restore does not bring it back.
    await telemovel.session.forgetChannel(canal)
    expect(entradasDoCanal(telemovel.vault.contents, canal)).toHaveLength(0)

    // The phone goes offline, and Bruno writes. The server loses those messages
    // (thirty days have passed, for example): only the computer has them.
    const ancora = telemovel.vault.contents.lastSeq[dm] ?? 0
    telemovel.session.disconnect()
    for (let n = 1; n <= 5; n++) await bruno!.session.send(dm, mensagem(`enquanto o telemóvel dormia ${n}`))
    await ate(() => corpos(ana!, dm).filter((c) => c.startsWith("enquanto")).length === 5, "o computador tem as cinco", 30_000)
    await ana!.session.send(canal, mensagem("no canal, depois"))
    // The sixth one stays on the server: it holds the numbering (see `apagarDoServidor`).
    await bruno!.session.send(dm, mensagem("a sexta, que o servidor guarda"))
    await ate(() => corpos(ana!, dm).includes("a sexta, que o servidor guarda"), "o computador tem a sexta", 30_000)
    const sexta = entradasDoCanal(ana!.vault.contents, dm).find((e) => e.payload["body"] === "a sexta, que o servidor guarda")!.seq
    expect(apagarDoServidor(dm, ancora, sexta)).toBeGreaterThanOrEqual(5)

    await telemovel.session.connect()
    await ate(
      () => corpos(telemovel, dm).filter((c) => c.startsWith("enquanto")).length === 5,
      "as cinco chegam ao telemóvel pelo canal da conta",
      60_000,
    )
    expect(corpos(telemovel, dm)).toContain("a sexta, que o servidor guarda")
    const doTelemovel = identidades(telemovel.vault.contents, dm)
    expect(new Set(doTelemovel).size).toBe(doTelemovel.length)
    // The forgotten channel stays forgotten.
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    expect(entradasDoCanal(telemovel.vault.contents, canal)).toHaveLength(0)
  }, 300_000)
})
