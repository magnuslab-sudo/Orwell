import {
  addMembers,
  createChannel,
  encryptPayload,
  generateKeyPackages,
  joinChannelExternally,
  publishableGroupInfo,
  rotateEpoch,
  type GroupSession,
} from "@enclave/crypto"
import {
  fromBase64,
  generateIdentity,
  moradaDeSala,
  parseServerName,
  toBase64,
  type ServerFrame,
  type ServerName,
} from "@enclave/protocol"
import { createProposal, encodeMlsMessage } from "ts-mls"
import type { DatabaseSync } from "node:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocket } from "ws"
import { Cliente, levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildServer } from "./app.js"
import type { ServerConfig } from "./config.js"
import { openDatabase } from "./db.js"
import { Store } from "./store.js"

/**
 * One commit per epoch, per channel, what keeps a group from splitting.
 *
 * On 9/12/2026 the common room in production was in three branches: members
 * writing in epoch 17, others in 12, and the entry card in 16. Nobody saw or
 * heard each other, because the roster and the call key come from the epoch.
 * On the server side, two paths led there: store ANY handshake (two nearly
 * simultaneous entries got recorded with the same epoch, and each author applied
 * theirs), and accept the card from any member over the good one (a late member
 * reput the one from their epoch, and the next one to enter opened another
 * branch).
 *
 * All frames here are real, from `@enclave/crypto`. No byte is built by hand,  * see `cabecalho-mls.test.ts` for the reason.
 */

const HOME = parseServerName("enclave.test")
const COMUM = "!984:enclave.test"
const FEED = "!feed-abc:enclave.test"
const LEITOR = "@leitor:enclave.test"

/**
 * Real commits on the chain. `commits[i]` starts from epoch `i`, and `sessoes[i]` is the
 * group AT epoch `i`, where a second commit for the same epoch is drawn from, which
 * is exactly the branch we want to prevent.
 */
async function cadeia(canal: string, quantos: number): Promise<{ commits: Uint8Array[]; sessoes: GroupSession[] }> {
  let sala = await createChannel(generateIdentity(HOME), canal)
  const commits: Uint8Array[] = []
  const sessoes: GroupSession[] = [sala]
  for (let i = 0; i < quantos; i++) {
    const rotacao = await rotateEpoch(sala)
    commits.push(rotacao.commits[0] as Uint8Array)
    sala = rotacao.session
    sessoes.push(sala)
  }
  return { commits, sessoes }
}

/** A commit from a different branch, starting from the group at a given epoch. */
async function ramo(sessao: GroupSession): Promise<Uint8Array> {
  return (await rotateEpoch(sessao)).commits[0] as Uint8Array
}

/** An outsider joining via the group's key package at this epoch. */
async function entradaPeloCartao(sessao: GroupSession): Promise<{ commit: Uint8Array; session: GroupSession }> {
  const [pacote] = await generateKeyPackages(generateIdentity(HOME), 1)
  if (!pacote) throw new Error("sem key package")
  return joinChannelExternally(sessao.channel, await publishableGroupInfo(sessao), pacote.publicPackage, pacote.privatePackage)
}

async function aplicacao(sessao: GroupSession): Promise<Uint8Array> {
  const cifrada = await encryptPayload(sessao, {
    t: "message",
    id: crypto.randomUUID(),
    sentAt: 1_700_000_000_000,
    body: "olá",
    attachments: [],
    links: [],
    mentions: [],
  })
  return cifrada.ciphertext
}

// ------------------------------------------------------------------- base

let dataDir: string
let db: DatabaseSync
let store: Store

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-epochs-"))
  db = openDatabase(join(dataDir, "test.sqlite"))
  store = new Store(db)
})

afterEach(() => {
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

function guardar(canal: string, bytes: Uint8Array, opcoes: { kind?: "application" | "handshake" | "welcome"; refundavel?: boolean } = {}) {
  return store.appendEvent(
    { channel: canal, kind: opcoes.kind ?? "handshake", ciphertext: bytes },
    { refundavel: opcoes.refundavel ?? false },
  )
}

function handshakesGuardados(canal: string): number {
  return store.backfill(canal, undefined, 1000, LEITOR).filter((evento) => evento.kind === "handshake").length
}

describe("um commit por epoch, por canal", () => {
  it("duas entradas na mesma epoch: a primeira fica, a segunda é recusada e não se guarda", async () => {
    // The race we measure: an external commit and a member commit, both
    // starting from epoch 0. We store both, then each author applies theirs.
    const { sessoes } = await cadeia(COMUM, 0)
    const entrada = await entradaPeloCartao(sessoes[0] as GroupSession)
    const doMembro = await ramo(sessoes[0] as GroupSession)

    expect(guardar(COMUM, entrada.commit)).toMatchObject({ ok: true })
    expect(guardar(COMUM, doMembro)).toEqual({ ok: false, reason: "stale-epoch", epoch: 1 })
    expect(handshakesGuardados(COMUM)).toBe(1)
    expect(store.epochDoCanal(COMUM)).toBe(1)
  }, 30_000)

  it("um commit de uma epoch que o canal já deixou é recusado, com a epoch em que o canal está", async () => {
    const { commits, sessoes } = await cadeia(COMUM, 3)
    for (const commit of commits) expect(guardar(COMUM, commit).ok).toBe(true)

    // A lagging member, stuck at epoch 1, committing from there.
    expect(guardar(COMUM, await ramo(sessoes[1] as GroupSession))).toEqual({ ok: false, reason: "stale-epoch", epoch: 3 })
    expect(handshakesGuardados(COMUM)).toBe(3)
  }, 30_000)

  it("sem memória do canal, o primeiro commit é aceite na epoch que trouxer, e a regra segue daí", async () => {
    const { commits } = await cadeia(COMUM, 5)
    expect(store.epochDoCanal(COMUM)).toBeUndefined()

    expect(guardar(COMUM, commits[3] as Uint8Array).ok).toBe(true)
    expect(store.epochDoCanal(COMUM)).toBe(4)
    expect(guardar(COMUM, commits[2] as Uint8Array)).toEqual({ ok: false, reason: "stale-epoch", epoch: 4 })
    expect(guardar(COMUM, commits[4] as Uint8Array).ok).toBe(true)
    expect(store.epochDoCanal(COMUM)).toBe(5)
  }, 30_000)

  it("com memória, só a epoch do canal: um commit de uma epoch à frente é recusado e não salta", async () => {
    // Live, a commit ahead comes from a branch the server rejected (the
    // old client applied theirs anyway) or a forged header.
    // Jumping to it would make that branch official and lock the real group.
    // The jump only exists at startup, over history. See `inicializarEpochs`.
    const { commits } = await cadeia(COMUM, 4)
    expect(guardar(COMUM, commits[0] as Uint8Array).ok).toBe(true)
    expect(guardar(COMUM, commits[3] as Uint8Array)).toEqual({ ok: false, reason: "stale-epoch", epoch: 1 })
    expect(store.epochDoCanal(COMUM)).toBe(1)
    expect(guardar(COMUM, commits[1] as Uint8Array).ok).toBe(true)
  }, 30_000)

  it("propostas, mensagens de aplicação e Welcomes não são travados, seja qual for a epoch", async () => {
    const { commits, sessoes } = await cadeia(COMUM, 3)
    for (const commit of commits) guardar(COMUM, commit)
    const velha = sessoes[1] as GroupSession

    expect(guardar(COMUM, await aplicacao(velha), { kind: "application" }).ok).toBe(true)

    const [pacote] = await generateKeyPackages(generateIdentity(HOME), 1)
    if (!pacote) throw new Error("sem key package")
    const proposta = await createProposal(velha.state, false, { proposalType: "add", add: { keyPackage: pacote.publicPackage } }, velha.suite)
    expect(guardar(COMUM, encodeMlsMessage(proposta.message)).ok).toBe(true)

    // The Welcome is encrypted: no epoch can read it.
    const adicao = await addMembers(velha, [pacote.publicPackage])
    expect(guardar(COMUM, adicao.welcome, { kind: "welcome" }).ok).toBe(true)
    expect(store.epochDoCanal(COMUM)).toBe(3)
  }, 30_000)

  it("um commit declarado como mensagem de aplicação continua a ser um commit", async () => {
    // The client passes to MLS everything that is not Welcome (`#applyEvent`), no
    // matter what `kind` is declared. Blocking only by `kind` left the side door open.
    const { commits, sessoes } = await cadeia(COMUM, 2)
    for (const commit of commits) expect(guardar(COMUM, commit).ok).toBe(true)
    expect(guardar(COMUM, await ramo(sessoes[1] as GroupSession), { kind: "application" })).toEqual({
      ok: false,
      reason: "stale-epoch",
      epoch: 2,
    })
  }, 30_000)

  it("um commit de outro grupo não mexe na epoch deste canal", async () => {
    const alheio = await cadeia("!outro:enclave.test", 3)
    const proprio = await cadeia(COMUM, 1)
    expect(guardar(COMUM, alheio.commits[2] as Uint8Array).ok).toBe(true)
    expect(store.epochDoCanal(COMUM)).toBeUndefined()
    expect(guardar(COMUM, proprio.commits[0] as Uint8Array).ok).toBe(true)
  }, 30_000)

  it("num canal refundável, um commit de epoch 0 é o grupo refeito com o mesmo nome, e recomeça o canal", async () => {
    /*
      A caller who loses group state, another browser, imported account, "restart
      rooms", rebuilds the feed and conversations with the SAME identifier, from
      epoch 0, and invites again; `#acceptWelcome` says that is how a remade channel heals.
      Refusing the epoch 0 commit left that group unable to invite anyone ever: no commit
      of theirs would reach the old epoch.

      Whoever can refound is decided by the caller (`Gateway.#podeRefundar`): the owner
      of the feed, one of two people in a conversation. Here we prove what the
      base does with that decision.
    */
    const antigo = await cadeia(FEED, 6)
    for (const commit of antigo.commits) guardar(FEED, commit)
    expect(store.epochDoCanal(FEED)).toBe(6)

    const refeito = await cadeia(FEED, 2)
    expect(guardar(FEED, refeito.commits[0] as Uint8Array, { refundavel: true }).ok).toBe(true)
    expect(store.epochDoCanal(FEED)).toBe(1)
    expect(guardar(FEED, refeito.commits[1] as Uint8Array).ok).toBe(true)
    // And the old group, if someone still commits there, behind or ahead of
    // the new group's epoch, that is what gets locked out. With live jumping, the
    // lagging epoch 5 commit was accepted and locked the remade group.
    expect(guardar(FEED, await ramo(antigo.sessoes[1] as GroupSession))).toEqual({ ok: false, reason: "stale-epoch", epoch: 2 })
    expect(guardar(FEED, await ramo(antigo.sessoes[5] as GroupSession))).toEqual({ ok: false, reason: "stale-epoch", epoch: 2 })
    expect(store.epochDoCanal(FEED)).toBe(2)
  }, 30_000)

  it("num canal que não é refundável, um commit de epoch 0 atrasado é recusado como outro qualquer", async () => {
    const { commits, sessoes } = await cadeia(FEED, 2)
    for (const commit of commits) guardar(FEED, commit)
    expect(guardar(FEED, await ramo(sessoes[0] as GroupSession))).toEqual({ ok: false, reason: "stale-epoch", epoch: 2 })
  }, 30_000)

  it("na sala comum não há refundação: um commit de epoch 0 atrasado é recusado como outro qualquer", async () => {
    // The common room is only created empty (`mine && empty`), and it is the only one with a key package:
    // an external join via the epoch 0 key package racing against the founder's first
    // commit is the most likely race it faces.
    const { commits, sessoes } = await cadeia(COMUM, 2)
    for (const commit of commits) guardar(COMUM, commit)
    const entrada = await entradaPeloCartao(sessoes[0] as GroupSession)
    expect(guardar(COMUM, entrada.commit)).toEqual({ ok: false, reason: "stale-epoch", epoch: 2 })
    expect(guardar(COMUM, await ramo(sessoes[0] as GroupSession))).toEqual({
      ok: false,
      reason: "stale-epoch",
      epoch: 2,
    })
  }, 30_000)

  it("um commit com uma epoch que não cabe num número seguro não é travado nem mexe no canal", async () => {
    const { commits } = await cadeia(COMUM, 2)
    guardar(COMUM, commits[0] as Uint8Array)
    // The same real commit with the epoch (u64, right after the group) at the maximum.
    const enorme = (commits[1] as Uint8Array).slice()
    const inicioDaEpoch = 2 + 2 + 1 + new TextEncoder().encode(COMUM).length
    enorme.fill(0xff, inicioDaEpoch, inicioDaEpoch + 8)
    expect(guardar(COMUM, enorme).ok).toBe(true)
    expect(store.epochDoCanal(COMUM)).toBe(1)
  }, 30_000)
})

describe("o mesmo commit reenviado é o mesmo commit, e não um atrasado", () => {
  /*
    The echo is lost in a socket drop, the client resends the commit that
    was already accepted. With `stale-epoch`, the new client discarded it and
    fell behind itself: it cannot apply its own commit when it comes back via
    backfill. The right answer is the event that is already there.
  */
  it("devolve o evento original, sem gravar outra linha nem mexer na epoch", async () => {
    const { commits, sessoes } = await cadeia(COMUM, 3)
    const aceites = commits.map((commit) => guardar(COMUM, commit))
    const [, segundo] = aceites
    if (!segundo?.ok) throw new Error("o segundo commit devia ter sido aceite")

    // Right after (epoch C-1) and later, with another commit in between.
    const repetido = guardar(COMUM, commits[2] as Uint8Array)
    expect(repetido).toMatchObject({ ok: true, repetido: true, event: { seq: 2, kind: "handshake" } })
    expect(guardar(COMUM, commits[1] as Uint8Array)).toEqual({ ...segundo, repetido: true })
    expect(handshakesGuardados(COMUM)).toBe(3)
    expect(store.epochDoCanal(COMUM)).toBe(3)

    // And a DIFFERENT commit from the same epoch is still a lagging one.
    expect(guardar(COMUM, await ramo(sessoes[2] as GroupSession))).toEqual({
      ok: false,
      reason: "stale-epoch",
      epoch: 3,
    })
  }, 30_000)

  it("fora da sala comum, o commit de epoch 0 reenviado não recomeça o canal", async () => {
    // Without this, refound caught the founder's resend: the epoch went back to 1
    // and the commit was recorded twice.
    const { commits } = await cadeia(FEED, 2)
    for (const commit of commits) guardar(FEED, commit)
    expect(guardar(FEED, commits[0] as Uint8Array, { refundavel: true })).toMatchObject({ ok: true, repetido: true, event: { seq: 0 } })
    expect(store.epochDoCanal(FEED)).toBe(2)
    expect(handshakesGuardados(FEED)).toBe(2)
  }, 30_000)

  it("um commit novo, aceite, não vem marcado como repetido", async () => {
    const { commits } = await cadeia(COMUM, 1)
    expect(guardar(COMUM, commits[0] as Uint8Array)).toMatchObject({ ok: true, repetido: false })
  }, 30_000)
})

describe("destinatário só num Welcome", () => {
  /*
    An event with a recipient is only delivered to them, and backfill does not
    show it to anyone else. In a Welcome that is what you want. In a commit it was
    a commit that counted toward the channel's epoch and that other members never
    saw, the channel advanced without them.
  */
  it("um commit ou uma mensagem com destinatário é recusado, e não conta nem se guarda", async () => {
    const { commits } = await cadeia(COMUM, 2)
    guardar(COMUM, commits[0] as Uint8Array)
    for (const kind of ["handshake", "application"] as const) {
      expect(
        store.appendEvent({ channel: COMUM, kind, ciphertext: commits[1] as Uint8Array, recipient: LEITOR }, { refundavel: false }),
      ).toEqual({ ok: false, reason: "recipient-not-welcome" })
    }
    expect(store.epochDoCanal(COMUM)).toBe(1)
    expect(handshakesGuardados(COMUM)).toBe(1)
    expect(store.backfill(COMUM, undefined, 100, LEITOR)).toHaveLength(1)
  }, 30_000)

  it("um Welcome com destinatário continua a entrar", async () => {
    const { sessoes } = await cadeia(COMUM, 0)
    const [pacote] = await generateKeyPackages(generateIdentity(HOME), 1)
    if (!pacote) throw new Error("sem key package")
    const { welcome } = await addMembers(sessoes[0] as GroupSession, [pacote.publicPackage])
    expect(
      store.appendEvent({ channel: COMUM, kind: "welcome", ciphertext: welcome, recipient: LEITOR }, { refundavel: false }),
    ).toMatchObject({ ok: true, repetido: false })
  }, 30_000)
})

describe("o cartão de entrada guarda-se só se descrever a epoch do canal", () => {
  it("sem memória do canal, o cartão é aceite", async () => {
    const { sessoes } = await cadeia(COMUM, 0)
    expect(store.putGroupInfo(COMUM, await publishableGroupInfo(sessoes[0] as GroupSession))).toEqual({ ok: true })
    expect(store.hasGroupInfo(COMUM)).toBe(true)
  }, 30_000)

  it("da epoch do canal é aceite; de uma anterior é recusado e o que lá estava fica", async () => {
    const { commits, sessoes } = await cadeia(COMUM, 3)
    for (const commit of commits) guardar(COMUM, commit)
    const bom = await publishableGroupInfo(sessoes[3] as GroupSession)
    expect(store.putGroupInfo(COMUM, bom)).toEqual({ ok: true })

    // The lagging member restoring their epoch's key package over the good one.
    const velho = await publishableGroupInfo(sessoes[2] as GroupSession)
    expect(store.putGroupInfo(COMUM, velho)).toEqual({ ok: false, reason: "stale-groupinfo", epoch: 3 })
    expect(store.takeGroupInfo(COMUM)).toEqual(bom)
  }, 30_000)

  it("de uma epoch à frente do canal também é recusado: descreve um ramo que o servidor não aceitou", async () => {
    // Whoever publishes this applied a commit that was refused. Stored, the
    // next one to arrive entered that branch with a commit from the next epoch, and
    // a commit ahead is accepted.
    const { commits, sessoes } = await cadeia(COMUM, 3)
    for (const commit of commits.slice(0, 2)) guardar(COMUM, commit)
    expect(store.putGroupInfo(COMUM, await publishableGroupInfo(sessoes[3] as GroupSession))).toEqual({
      ok: false,
      reason: "stale-groupinfo",
      epoch: 2,
    })
    expect(store.hasGroupInfo(COMUM)).toBe(false)
  }, 30_000)

  it("um cartão que não se lê, ou que é de outro grupo, não se guarda", async () => {
    const outro = await cadeia("!outro:enclave.test", 0)
    expect(store.putGroupInfo(COMUM, await publishableGroupInfo(outro.sessoes[0] as GroupSession))).toEqual({
      ok: false,
      reason: "illegible",
    })
    expect(store.putGroupInfo(COMUM, new TextEncoder().encode("cartão"))).toEqual({ ok: false, reason: "illegible" })
    expect(store.hasGroupInfo(COMUM)).toBe(false)
  }, 30_000)

  it("aceitar um commit apaga o cartão que deixou de servir", async () => {
    // Without this, the `hello.ok` said there was a key package, no member published
    // another, and the next arrival wasted a key package on a dead key package.
    const { commits, sessoes } = await cadeia(COMUM, 1)
    expect(store.putGroupInfo(COMUM, await publishableGroupInfo(sessoes[0] as GroupSession))).toEqual({ ok: true })
    expect(guardar(COMUM, commits[0] as Uint8Array).ok).toBe(true)
    expect(store.hasGroupInfo(COMUM)).toBe(false)
  }, 30_000)
})

// ---------------------------------------------------------------- arranque

/** What `buildServer` says: all channels can have refounds in history, except the common room. */
const refundavelNoArranque = (canal: string): boolean => canal !== COMUM

function inserirCru(canal: string, seq: number, kind: string, bytes: Uint8Array): void {
  db.prepare(
    "INSERT INTO events (channel, seq, kind, ciphertext, recipient, received_minute) VALUES (?, ?, ?, ?, NULL, 0)",
  ).run(canal, seq, kind, bytes)
}

describe("arranque: a epoch de cada canal tirada do que já está guardado", () => {
  it("a sala comum de produção, com os ramos que tem, arranca na 17 e sem o cartão da 16", async () => {
    const { commits, sessoes } = await cadeia(COMUM, 17)
    const historia: [string, Uint8Array][] = []
    for (let epoch = 0; epoch <= 16; epoch++) {
      historia.push(["handshake", commits[epoch] as Uint8Array])
      // The two paths that split the room: a second commit in the same epoch,
      // and a join via an old key package with the group already far ahead.
      if (epoch === 12) historia.push(["handshake", await ramo(sessoes[12] as GroupSession)])
      if (epoch === 13) historia.push(["handshake", (await entradaPeloCartao(sessoes[6] as GroupSession)).commit])
    }
    historia.push(["application", await aplicacao(sessoes[17] as GroupSession)])
    historia.forEach(([kind, bytes], seq) => inserirCru(COMUM, seq, kind, bytes))
    db.prepare("INSERT INTO group_infos (channel, info, at_minute) VALUES (?, ?, 0)").run(
      COMUM,
      await publishableGroupInfo(sessoes[16] as GroupSession),
    )

    expect(store.inicializarEpochs(refundavelNoArranque)).toBe(1)
    expect(store.epochDoCanal(COMUM)).toBe(17)
    expect(store.hasGroupInfo(COMUM)).toBe(false)
    expect(guardar(COMUM, await ramo(sessoes[16] as GroupSession))).toEqual({
      ok: false,
      reason: "stale-epoch",
      epoch: 17,
    })
    expect(guardar(COMUM, await ramo(sessoes[17] as GroupSession)).ok).toBe(true)
  }, 60_000)

  it("é idempotente, e não reescreve um canal que já tem epoch", async () => {
    const { commits, sessoes } = await cadeia(COMUM, 3)
    commits.slice(0, 2).forEach((commit, seq) => inserirCru(COMUM, seq, "handshake", commit))

    expect(store.inicializarEpochs(refundavelNoArranque)).toBe(1)
    expect(store.epochDoCanal(COMUM)).toBe(2)
    expect(store.inicializarEpochs(refundavelNoArranque)).toBe(0)

    expect(guardar(COMUM, commits[2] as Uint8Array).ok).toBe(true)
    expect(store.inicializarEpochs(refundavelNoArranque)).toBe(0)
    expect(store.epochDoCanal(COMUM)).toBe(3)
    expect(sessoes).toHaveLength(4)
  }, 30_000)

  it("um canal refeito com o mesmo nome arranca na epoch do grupo novo, e um que não se refunda não", async () => {
    // The rule applied over history in the order it arrived, otherwise
    // startup would lock the remade group at the old epoch.
    const grupo = "!sala:enclave.test"
    for (const canal of [FEED, grupo]) {
      const antigo = await cadeia(canal, 3)
      const refeito = await cadeia(canal, 2)
      ;[...antigo.commits, ...refeito.commits].forEach((commit, seq) => inserirCru(canal, seq, "handshake", commit))
    }

    expect(store.inicializarEpochs((canal) => canal === FEED)).toBe(2)
    expect(store.epochDoCanal(FEED)).toBe(2)
    expect(store.epochDoCanal(grupo)).toBe(3)
  }, 30_000)

  it("no arranque também não se salta: um commit à frente na história é de um ramo que não conta", async () => {
    // Before the table the server stored all commits, so a channel's history
    // is contiguous; a commit ahead of it comes from another group with the
    // same name or a forged header. Jumping to it locked the channel.
    const { commits } = await cadeia(COMUM, 6)
    ;[commits[0], commits[1], commits[5]].forEach((commit, seq) => inserirCru(COMUM, seq, "handshake", commit as Uint8Array))
    expect(store.inicializarEpochs(refundavelNoArranque)).toBe(1)
    expect(store.epochDoCanal(COMUM)).toBe(2)
  }, 30_000)

  it("depois de uma refundação só contam os commits do grupo novo, e um commit tardio do velho não o tranca", async () => {
    /*
      Feed or conversation G1 went to epoch 20, the owner remakes it (G2, epoch 0),
      and then a late G1 commit still arrived at epoch 21. Running the rule
      over all history with jumping gave 22, the channel locked for G2, which
      is at 1. Count from the LAST refound (the last epoch 0 commit, by arrival order),
      and without jumping: the G1 latecomer is left out.
    */
    const velho = await cadeia(FEED, 22)
    const novo = await cadeia(FEED, 1)
    ;[...velho.commits.slice(0, 21), novo.commits[0], velho.commits[21]].forEach((commit, seq) =>
      inserirCru(FEED, seq, "handshake", commit as Uint8Array),
    )
    expect(store.inicializarEpochs(refundavelNoArranque)).toBe(1)
    expect(store.epochDoCanal(FEED)).toBe(1)
  }, 60_000)

  it("na sala comum não há refundação no arranque: um commit de epoch 0 tardio não a recomeça", async () => {
    const { commits, sessoes } = await cadeia(COMUM, 3)
    const tardio = await entradaPeloCartao(sessoes[0] as GroupSession)
    ;[...commits, tardio.commit].forEach((commit, seq) => inserirCru(COMUM, seq, "handshake", commit))
    expect(store.inicializarEpochs(refundavelNoArranque)).toBe(1)
    expect(store.epochDoCanal(COMUM)).toBe(3)
  }, 30_000)

  it("o servidor corre-o ao arrancar: refunda grupos refeitos antes do deploy, e nunca a sala comum", async () => {
    const { commits, sessoes } = await cadeia(COMUM, 2)
    // With a late join via an epoch 0 key package at the end: in the common room
    // it is no refound at all.
    const tardia = await entradaPeloCartao(sessoes[0] as GroupSession)
    ;[...commits, tardia.commit].forEach((commit, seq) => inserirCru(COMUM, seq, "handshake", commit))
    // A remade group channel with the same name before deploy (the client's `knownBefore`).
    // Live it no longer refounds; at startup, history says which group stayed.
    const grupo = "!grupo:enclave.test"
    const g1 = await cadeia(grupo, 4)
    const g2 = await cadeia(grupo, 2)
    ;[...g1.commits, ...g2.commits].forEach((commit, seq) => inserirCru(grupo, seq, "handshake", commit))
    const config: ServerConfig = {
      serverName: HOME,
      bindHost: "127.0.0.1",
      bindPort: 0,
      dataDir,
      databasePath: join(dataDir, "test.sqlite"),
      sfuPort: 0,
      sfuAnnouncedIp: "",
      retentionDays: 30,
      allowlist: [],
      turnUrls: [],
      turnSecret: "",
      turnTtl: 600,
      communityMode: false,
      commonRoom: COMUM,
    }
    const enclave = await buildServer(config)
    try {
      expect(enclave.store.epochDoCanal(COMUM)).toBe(2)
      expect(enclave.store.epochDoCanal(grupo)).toBe(2)
      // And with the common room correct: a lagging epoch 0 commit does not restart it.
      const entrada = await entradaPeloCartao(sessoes[0] as GroupSession)
      expect(enclave.store.appendEvent({ channel: COMUM, kind: "handshake", ciphertext: entrada.commit }, { refundavel: false })).toEqual({
        ok: false,
        reason: "stale-epoch",
        epoch: 2,
      })
    } finally {
      await enclave.close()
    }
  }, 30_000)

  it("um canal sem commits legíveis fica sem memória, e o primeiro commit ao vivo decide", async () => {
    inserirCru(COMUM, 0, "handshake", new TextEncoder().encode("commit externo"))
    expect(store.inicializarEpochs(refundavelNoArranque)).toBe(0)
    expect(store.epochDoCanal(COMUM)).toBeUndefined()
  })
})

// ------------------------------------------------------------------ na rede

describe("na rede: o gateway recusa ao autor, e a mais ninguém", () => {
  let servidor: ServidorDeTeste
  let url: string
  let casa: ServerName
  let sala: string

  beforeAll(async () => {
    servidor = await levantarServidor()
    ;({ url, casa, sala } = servidor)
  })

  afterAll(async () => {
    await servidor?.fechar()
  })

  it("o hello anuncia que o servidor aceita um commit por epoch", async () => {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve) => socket.once("open", () => resolve()))
    const resposta = new Promise<ServerFrame>((resolve) =>
      socket.once("message", (raw: Buffer) => resolve(JSON.parse(raw.toString("utf8")) as ServerFrame)),
    )
    socket.send(JSON.stringify({ t: "hello", version: 1 }))
    const hello = await resposta
    expect(hello.t === "hello.ok" && hello.capabilities).toContain("commit-per-epoch")
    socket.close()
  })

  it("a entrada e o commit do fundador na mesma epoch: o segundo volta ao autor com o ref, e não chega a ninguém", async () => {
    const idFundador = generateIdentity(casa)
    const fundador = await Cliente.ligar(url, idFundador)
    // Found the room: subscribe while no one used it, and speak in there.
    fundador.enviar({ t: "channel.subscribe", channels: [sala] })
    fundador.enviar({ t: "channel.send", channel: sala, kind: "application", ciphertext: toBase64(new Uint8Array([1])) })
    await fundador.proximoDe("channel.event")

    let grupoDoFundador = await createChannel(idFundador, sala)
    fundador.enviar({ t: "channel.groupinfo.put", channel: sala, info: toBase64(await publishableGroupInfo(grupoDoFundador)) })
    expect((await fundador.ateAoPong()).map((f) => f.t)).not.toContain("channel.rejected")

    const quemChega = await Cliente.ligar(url, generateIdentity(casa))
    quemChega.enviar({ t: "channel.groupinfo.take", channel: sala })
    const cartao = await quemChega.proximoDe("channel.groupinfo")
    const [pacote] = await generateKeyPackages(generateIdentity(casa), 1)
    if (!pacote || !cartao.info) throw new Error("sem cartão ou sem key package")
    const entrada = await joinChannelExternally(sala, fromBase64(cartao.info), pacote.publicPackage, pacote.privatePackage)

    quemChega.enviar({ t: "channel.send", channel: sala, kind: "handshake", ciphertext: toBase64(entrada.commit), ref: "entrada" })
    expect((await quemChega.proximoDe("channel.event")).ref).toBe("entrada")
    await fundador.proximoDe("channel.event")

    const rotacao = await rotateEpoch(grupoDoFundador)
    fundador.enviar({
      t: "channel.send",
      channel: sala,
      kind: "handshake",
      ciphertext: toBase64(rotacao.commits[0] as Uint8Array),
      ref: "rotacao",
    })
    expect(await fundador.proximoDe("channel.rejected")).toEqual({
      t: "channel.rejected",
      channel: sala,
      reason: "stale-epoch",
      ref: "rotacao",
      epoch: 1,
    })
    expect((await quemChega.ateAoPong()).map((f) => f.t)).not.toContain("channel.event")

    fundador.enviar({ t: "channel.backfill", channel: sala, afterSeq: -1, limit: 100 })
    const pagina = await fundador.proximoDe("channel.backfill.page")
    expect(pagina.events.filter((evento) => evento.kind === "handshake")).toHaveLength(1)

    // The founder's old key package, restored after join: refused to them, and
    // the good one, from whoever joined, stays as what is delivered.
    fundador.enviar({ t: "channel.groupinfo.put", channel: sala, info: toBase64(await publishableGroupInfo(grupoDoFundador)) })
    expect(await fundador.proximoDe("channel.rejected")).toEqual({
      t: "channel.rejected",
      channel: sala,
      reason: "stale-groupinfo",
      epoch: 1,
    })
    const bom = await publishableGroupInfo(entrada.session)
    quemChega.enviar({ t: "channel.subscribe", channels: [sala] })
    quemChega.enviar({ t: "channel.groupinfo.put", channel: sala, info: toBase64(bom) })
    expect((await quemChega.ateAoPong()).map((f) => f.t)).not.toContain("channel.rejected")

    const terceiro = await Cliente.ligar(url, generateIdentity(casa))
    terceiro.enviar({ t: "channel.groupinfo.take", channel: sala })
    expect((await terceiro.proximoDe("channel.groupinfo")).info).toBe(toBase64(bom))

    grupoDoFundador = rotacao.session
    fundador.fechar()
    quemChega.fechar()
    terceiro.fechar()
  }, 60_000)

  it("ao vivo ninguém refunda: nem um membro, nem quem estreou a morada", async () => {
    /*
      Refound worked in 0.9 for those who lost state and remade THEIR feed or
      THEIR conversation with the same identifier: the name (`!feed-x`, `!dm-a.b`)
      said who they were. An opaque address names no one, and the server does not
      tell a direct from a room; opened to whoever started it, it was how a
      room creator could split it to everyone with an epoch 0 commit. Whoever
      lost the group asks for a slot (slice 3). Opened to any member, it was how
      a hostile member could split a private channel on purpose.
    */
    const idDono = generateIdentity(casa)
    const idMembro = generateIdentity(casa)
    const canal = moradaDeSala(casa)

    const dono = await Cliente.ligar(url, idDono)
    dono.enviar({ t: "channel.subscribe", channels: [canal] })
    const fundacao = await rotateEpoch(await createChannel(idDono, canal))
    dono.enviar({ t: "channel.send", channel: canal, kind: "handshake", ciphertext: toBase64(fundacao.commits[0] as Uint8Array) })
    await dono.proximoDe("channel.event")
    const [pacote] = await generateKeyPackages(idMembro, 1)
    if (!pacote) throw new Error("sem key package")
    const adicao = await addMembers(fundacao.session, [pacote.publicPackage])
    dono.enviar({ t: "channel.send", channel: canal, kind: "handshake", ciphertext: toBase64(adicao.commit) })
    await dono.proximoDe("channel.event")
    dono.enviar({ t: "channel.send", channel: canal, kind: "welcome", ciphertext: toBase64(adicao.welcome), recipient: idMembro.address })
    await dono.ateAoPong()
    expect(servidor.enclave.store.epochDoCanal(canal)).toBe(2)

    const membro = await Cliente.ligar(url, idMembro)
    membro.enviar({ t: "channel.subscribe", channels: [canal] })
    await membro.ateAoPong()
    const doMembro = (await rotateEpoch(await createChannel(idMembro, canal))).commits[0] as Uint8Array
    membro.enviar({ t: "channel.send", channel: canal, kind: "handshake", ciphertext: toBase64(doMembro), ref: "refundar" })
    expect(await membro.proximoDe("channel.rejected")).toEqual({
      t: "channel.rejected",
      channel: canal,
      reason: "stale-epoch",
      ref: "refundar",
      epoch: 2,
    })

    const doDono = (await rotateEpoch(await createChannel(idDono, canal))).commits[0] as Uint8Array
    dono.enviar({ t: "channel.send", channel: canal, kind: "handshake", ciphertext: toBase64(doDono), ref: "refeito" })
    expect(await dono.proximoDe("channel.rejected")).toEqual({
      t: "channel.rejected",
      channel: canal,
      reason: "stale-epoch",
      ref: "refeito",
      epoch: 2,
    })
    expect(servidor.enclave.store.epochDoCanal(canal)).toBe(2)

    dono.fechar()
    membro.fechar()
  }, 60_000)

  it("um commit com destinatário é recusado ao autor como frame mal feito, e o canal não anda", async () => {
    const idAutor = generateIdentity(casa)
    const canal = moradaDeSala(casa)
    const autor = await Cliente.ligar(url, idAutor)
    autor.enviar({ t: "channel.subscribe", channels: [canal] })
    const fundacao = await rotateEpoch(await createChannel(idAutor, canal))
    autor.enviar({
      t: "channel.send",
      channel: canal,
      kind: "handshake",
      ciphertext: toBase64(fundacao.commits[0] as Uint8Array),
      recipient: idAutor.address,
    })
    const recebidos = await autor.ateAoPong()
    expect(recebidos).toContainEqual(expect.objectContaining({ t: "error", code: "bad-frame", fatal: false }))
    expect(recebidos.map((f) => f.t)).not.toContain("channel.event")
    expect(servidor.enclave.store.epochDoCanal(canal)).toBeUndefined()
    autor.fechar()
  }, 30_000)

  it("o reenvio de um commit aceite volta ao autor com o seq original e o ref novo, e a mais ninguém", async () => {
    const idAutor = generateIdentity(casa)
    const idOutro = generateIdentity(casa)
    const canal = moradaDeSala(casa)

    const autor = await Cliente.ligar(url, idAutor)
    autor.enviar({ t: "channel.subscribe", channels: [canal] })
    const fundacao = await rotateEpoch(await createChannel(idAutor, canal))
    autor.enviar({ t: "channel.send", channel: canal, kind: "handshake", ciphertext: toBase64(fundacao.commits[0] as Uint8Array) })
    await autor.proximoDe("channel.event")

    // The other member joins via Welcome, which is what gives them a slot here.
    const [pacote] = await generateKeyPackages(idOutro, 1)
    if (!pacote) throw new Error("sem key package")
    const adicao = await addMembers(fundacao.session, [pacote.publicPackage])
    autor.enviar({ t: "channel.send", channel: canal, kind: "handshake", ciphertext: toBase64(adicao.commit), ref: "adicao" })
    const original = await autor.proximoDe("channel.event")
    expect(original.ref).toBe("adicao")
    autor.enviar({ t: "channel.send", channel: canal, kind: "welcome", ciphertext: toBase64(adicao.welcome), recipient: idOutro.address })
    await autor.ateAoPong()

    const outro = await Cliente.ligar(url, idOutro)
    outro.enviar({ t: "channel.subscribe", channels: [canal] })
    await outro.ateAoPong()

    // The socket drop: the echo did not arrive, and the client sends again.
    autor.enviar({ t: "channel.send", channel: canal, kind: "handshake", ciphertext: toBase64(adicao.commit), ref: "reenvio" })
    const eco = await autor.proximoDe("channel.event")
    expect(eco).toEqual({ ...original, ref: "reenvio" })
    expect((await outro.ateAoPong()).map((f) => f.t)).not.toContain("channel.event")

    autor.enviar({ t: "channel.backfill", channel: canal, afterSeq: -1, limit: 100 })
    const pagina = await autor.proximoDe("channel.backfill.page")
    expect(pagina.events.filter((evento) => evento.kind === "handshake")).toHaveLength(2)

    // And a different commit from the same epoch is still refused.
    autor.enviar({ t: "channel.send", channel: canal, kind: "handshake", ciphertext: toBase64(await ramo(fundacao.session)), ref: "outro" })
    expect(await autor.proximoDe("channel.rejected")).toEqual({
      t: "channel.rejected",
      channel: canal,
      reason: "stale-epoch",
      ref: "outro",
      epoch: 2,
    })

    autor.fechar()
    outro.fechar()
  }, 60_000)
})
