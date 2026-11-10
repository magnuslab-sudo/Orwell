import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { Session, Vault, type VaultBackend } from "@enclave/client-core"
import { moradaDeSala, parseServerName, PODERES_DE_TODOS_POR_OMISSAO, POWERS } from "@enclave/protocol"
import { buildServer, type Enclave } from "./app.js"
import type { ServerConfig } from "./config.js"

/** The session vault is private; tests read and modify it on purpose. */
const cofreDe = (session: Session): Vault => (session as unknown as { vault: Vault }).vault

/**
 * Who controls a channel, with two real accounts against a real server.
 *
 * Everything that decides authority in a channel (`founderOf`, `powersOf`, `#mandaEm`,
 * and the guards for expelling, renaming and assigning) hangs on a single fact: who
 * sent the first `room.created`. That record is published ONCE, at founding, in
 * an epoch before any guest joins. Forward secrecy: whoever joins later never decrypts it.
 *
 * The tests that already existed injected the founder by hand into the vault, so
 * there was never a second account joining a founded channel, and the invariant
 * that matters is precisely that one. Without it, for the guest the channel has no
 * owner, and "channel with no owner" meant "everybody can do everything": a guest
 * with no power could expel the founder, cryptographically and irreversibly.
 *
 * This file locks it down. Nothing here writes to the vault by hand: what B knows,
 * it knows because it arrived over the wire, encrypted, like in real life.
 */

// Own port, for the reason written in `common-room.test.ts`: two test servers
// on the same port break with EADDRINUSE and take `npm test` down with them.
const PORT = 8454
const HOME = parseServerName(`localhost:${PORT}`)

let enclave: Enclave
let dataDir: string

class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  /**
   * The message with which this vault REFUSES to write, or `null` to write.
   *
   * A full vault is one of two real reasons why `publishProfile`
   * gives up on a channel (the other is the socket), and it is the one a test can trigger without
   * touching any product method: `vault.update` calls `#persist`, which
   * calls this. A test that mocked `publishProfile` would replace the method that
   * swallows the error with the desired behavior, and prove the plumbing instead of the
   * condition.
   */
  recusar: string | null = null
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    if (this.recusar) throw new Error(this.recusar)
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

interface Peer {
  session: Session
  address: string
  seen: { channel: string; sender: string; payload: Record<string, unknown> }[]
  /** The disk for this account, so a test can make it stop accepting writes. */
  cofre: MemoryBackend
}

async function peer(nome: string): Promise<Peer> {
  const cofre = new MemoryBackend()
  const vault = new Vault(cofre)
  await vault.create("frase-passe-de-teste")
  const session = new Session(vault)
  const identity = await session.createIdentity(`localhost:${PORT}`)
  const seen: Peer["seen"] = []
  session.on("message", (event) => {
    seen.push({
      channel: event.channel,
      sender: event.sender,
      payload: event.payload as unknown as Record<string, unknown>,
    })
  })
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  return { session, address: identity.address, seen, cofre }
}

/**
 * A connected account WITH NO profile, which is how every account starts out.
 *
 * The `peer` above names itself right away, because almost every test in this file
 * needs a name to measure. What is missing is the state before that: an
 * account that is already a member of channels and has not yet told anyone its name.
 */
async function peerSemPerfil(): Promise<Peer> {
  const cofre = new MemoryBackend()
  const vault = new Vault(cofre)
  await vault.create("frase-passe-de-teste")
  const session = new Session(vault)
  const identity = await session.createIdentity(`localhost:${PORT}`)
  const seen: Peer["seen"] = []
  session.on("message", (event) => {
    seen.push({
      channel: event.channel,
      sender: event.sender,
      payload: event.payload as unknown as Record<string, unknown>,
    })
  })
  await session.connect()
  return { session, address: identity.address, seen, cofre }
}

/** Wait until the condition holds, or give up: delivery is asynchronous. */
async function until(predicate: () => boolean, label: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`esgotou o tempo à espera de: ${label}`)
}

function dizer(session: Session, channel: string, body: string): Promise<void> {
  return session.send(channel, {
    t: "message",
    id: crypto.randomUUID(),
    sentAt: Date.now(),
    body,
    attachments: [],
    links: [],
    mentions: [],
  })
}

function textosDe(quem: Peer, channel: string): string[] {
  return quem.seen
    .filter((m) => m.channel === channel && m.payload["t"] === "message")
    .map((m) => String(m.payload["body"] ?? ""))
}

/**
 * A channel founded by A, with a name and a role, and B inside it.
 *
 * The order is the real-life one: found, set up, and only then invite. Everything
 * A published before B joined was encrypted in an epoch B will never have.
 */
async function canalFundadoComConvidado(): Promise<{ a: Peer; b: Peer; canal: string }> {
  const a = await peer("Alice")
  const b = await peer("Bob")
  const canal = moradaDeSala(HOME)

  await a.session.createSpaceChannel(canal)
  await a.session.updateSpaceMeta(canal, { name: "Lagar do Zé" })
  await a.session.defineRole(canal, { role: "porteiro", name: "Porteiro", powers: ["convidar"] })
  await a.session.assignRoles(canal, b.address, ["porteiro"])

  await a.session.seat(canal, b.address)
  await until(() => b.session.channels.includes(canal), "B entra no canal")
  return { a, b, canal }
}

describe("um convidado num canal fundado", () => {
  it("aprende quem o fundou, e por isso não expulsa o fundador", async () => {
    const { a, b, canal } = await canalFundadoComConvidado()

    // The fact that everything depends on. Without it, the rest of this test would pass by
    // accident and the app would stay wide open.
    await until(() => b.session.founderOf(canal) === a.address, "B aprende quem fundou o canal")

    // Neither of the two guards for `expel` can keep depending on not knowing who the founder is:
    // a guest with no role has nothing.
    expect(b.session.may(canal, "expulsar")).toBe(false)
    expect(b.session.mayManageRoles(canal)).toBe(false)
    await expect(b.session.expel(canal, a.address)).rejects.toThrow(/you may not expel|founder/i)

    // And the founder stays where they were: expulsion is cryptographic and cannot
    // be undone, so what we prove here is that it never happened.
    expect(a.session.membersOf(canal)).toContain(a.address)
    expect(a.session.membersOf(canal)).toContain(b.address)
    await dizer(a.session, canal, "ainda cá estou")
    await until(() => textosDe(b, canal).includes("ainda cá estou"), "B lê o canal com A ainda lá dentro")

    // The contrast, so the test does not pass just because everything is refused to everyone:
    // whoever founded it can still do everything.
    expect(a.session.may(canal, "expulsar")).toBe(true)
    expect(a.session.mayManageRoles(canal)).toBe(true)

    a.session.disconnect()
    b.session.disconnect()
  }, 60_000)

  it("vê o nome do canal e os papéis que lá foram definidos antes de entrar", async () => {
    const { a, b, canal } = await canalFundadoComConvidado()

    // The siblings of the same problem: `space.meta`, `role.define` and `role.assign`
    // were published once, before B had keys. Without being republished,
    // B saw a channel with no name, no roles, and without the role it was given.
    await until(() => b.session.spaceMeta(canal)?.name === "Lagar do Zé", "B vê o nome do canal")
    await until(() => b.session.rolesOf(canal).length > 0, "B vê os papéis do canal")

    expect(b.session.rolesOf(canal).map((papel) => papel.name)).toEqual(["Porteiro"])
    expect(b.session.rolesFor(canal, b.address)).toEqual(["porteiro"])
    // The role gives what it gives, and nothing more: inviting is by convention, expelling is not included.
    // Plus the baseline everyone gets (`@todos`, 1.2), which is what was already free.
    expect(b.session.powersOf(canal, b.address)).toEqual(
      POWERS.filter((poder) => poder === "convidar" || PODERES_DE_TODOS_POR_OMISSAO.includes(poder)),
    )

    a.session.disconnect()
    b.session.disconnect()
  }, 60_000)

  /**
   * The entire republish arriving at once, without tripping over itself.
   *
   * This is the ordering trap, and it is not hypothetical: recovery applies a
   * whole PAGE of events, up to a hundred, and only writes at the end (see `#rememberSeq`).
   * A joining member receives the republish that way, so the `room.created` and the
   * `role.assign` republished fall in the same batch, and the receive guard for the
   * assignment asks `#mandaEm` at the moment of writing it, when the foundation record
   * still only exists in the queue.
   *
   * With the guard reading only the vault, the assignment would be refused because the founder had not yet
   * reached disk, the same hole again, now backwards: instead of granting too much, it threw
   * away the repair. That is why `#mandaEm` also counts what is still pending a write, and why
   * `republishAuthority` sends the foundation first and alone.
   *
   * We force the case instead of waiting for it: B leaves before being seated, and
   * comes back later. What was live delivery, one event at a time, becomes
   * a single page, which is exactly the batch that matters.
   */
  it("a republicação que chega toda no mesmo lote pega à mesma", async () => {
    const a = await peer("Alice")
    const b = await peer("Bob")
    const canal = moradaDeSala(HOME)

    await a.session.createSpaceChannel(canal)
    await a.session.updateSpaceMeta(canal, { name: "Adega" })
    await a.session.defineRole(canal, { role: "porteiro", name: "Porteiro", powers: ["convidar"] })
    await a.session.assignRoles(canal, b.address, ["porteiro"])

    // B out, and his vault with nothing from this channel: the invite and the republish
    // both happen while he is not here.
    b.session.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 500))
    await a.session.seat(canal, b.address)
    await new Promise((resolve) => setTimeout(resolve, 2000))

    await b.session.connect()
    await until(() => b.session.channels.includes(canal), "B entra no canal ao voltar")
    await until(() => b.session.founderOf(canal) === a.address, "a fundação sobrevive ao lote")

    // The proof: the assignment was written even though the foundation, at the moment the
    // guard judged it, was still not in the vault.
    await until(() => b.session.rolesFor(canal, b.address).length > 0, "a nomeação sobrevive ao mesmo lote")
    expect(b.session.rolesFor(canal, b.address)).toEqual(["porteiro"])
    expect(b.session.rolesOf(canal).map((papel) => papel.name)).toEqual(["Porteiro"])
    expect(b.session.spaceMeta(canal)?.name).toBe("Adega")

    // And what all this is for: B still has no control over the founder's channel.
    expect(b.session.may(canal, "expulsar")).toBe(false)
    await expect(b.session.expel(canal, a.address)).rejects.toThrow(/you may not expel|founder/i)

    a.session.disconnect()
    b.session.disconnect()
  }, 60_000)

  /**
   * And the name of whoever invited, which is the forgotten sibling of the other three.
   *
   * `#announceLocalEpoch` is the inviter's path: a commit of ours is never
   * delivered back to us, so whoever makes it does not go through the receive path. Authority
   * and rooms were republished there, but the PROFILE was not. The receive path republishes all three.
   *
   * Exact consequence, and observed live: the guest publishes its profile
   * on subscribing, so whoever invited sees its name; whoever invited never
   * republishes its own, and the guest ends up seeing the other's `shortAddress`, which is
   * the first word of the address. It reads like a name but is not, and that is why
   * the symptom was reported as "the name does not match" instead of "there is no
   * name": nobody suspects "bebobbus" is an address.
   *
   * None of this depends on the chosen name. It failed with and without accents.
   */
  it("mostra ao convidado o nome de quem o convidou, e não a primeira palavra do endereço", async () => {
    const { a, b, canal } = await canalFundadoComConvidado()

    const perfisDeA = (): { displayName?: string }[] =>
      b.seen
        .filter((m) => m.channel === canal && m.sender === a.address && m.payload["t"] === "profile")
        .map((m) => m.payload as { displayName?: string })

    await until(() => perfisDeA().some((p) => p.displayName === "Alice"), "B recebe o perfil de quem o convidou")

    // The contrast that gives the test meaning: without the profile, THIS is what B would see
    // instead of the name. A made-up word, with the look of a nickname.
    expect(a.address.replace(/^@/, "").split("-")[0]).not.toBe("Alice")

    a.session.disconnect()
    b.session.disconnect()
  }, 60_000)
})

/**
 * The repair round, for vaults that already went silent.
 *
 * The fix to `#announceLocalEpoch` handles invites going forward and
 * does not undo the ones already made: in those, the profile is listed as published on the
 * inviter's side, and `publishProfile` skips the channel forever. Whoever was
 * invited before ended up seeing the address instead of the name, with nothing to change it.
 *
 * This forces it once per device, on connection. The test fakes the
 * old state (marks the profile as already published in this
 * channel and clears what B saw) and proves that reconnecting sends it again.
 */
describe("a ronda de reparação de perfis", () => {
  it("uma reconexão volta a publicar o perfil onde ele consta como publicado", async () => {
    const { a, b, canal } = await canalFundadoComConvidado()
    await until(
      () => b.seen.some((m) => m.channel === canal && m.sender === a.address && m.payload["t"] === "profile"),
      "B recebe o perfil pelo caminho normal",
    )

    // The state that old vaults have: profile marked as published in this
    // channel, and the repair round pending.
    b.seen.length = 0
    cofreDe(a.session).contents.profileRepairRound = 0
    a.session.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 500))
    await a.session.connect()

    await until(
      () => b.seen.some((m) => m.channel === canal && m.sender === a.address && m.payload["t"] === "profile"),
      "a ronda de reparação volta a mandar o perfil",
    )

    // And a second connection no longer sends it: the round runs once; otherwise
    // this would become 124 KB per channel on every reconnect, which once
    // filled a live server's database.
    expect(cofreDe(a.session).contents.profileRepairRound).toBeGreaterThan(0)
    b.seen.length = 0
    a.session.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 500))
    await a.session.connect()
    await new Promise((resolve) => setTimeout(resolve, 2500))
    expect(b.seen.filter((m) => m.sender === a.address && m.payload["t"] === "profile")).toHaveLength(0)

    a.session.disconnect()
    b.session.disconnect()
  }, 90_000)

  /**
   * And it does not count as done when it fails, which was the worst of the two bugs.
   *
   * The write of `profileRepairRound` came after a `.catch(() => {})`, and
   * so the round stayed recorded as done even when nothing had been sent.
   * Whoever connected with the network down, or with the vault full (the two reasons
   * why `publishProfile` gives up), would burn the repair without fixing anything and
   * end up exactly in the state it exists to fix, with no second chance: on the
   * next connection the round already counted as done.
   *
   * **And the first fix to this fixed nothing.** A `try/catch` was put
   * around the publish waiting for an exception that never comes: both causes
   * of failure sit inside the PER CHANNEL `try/catch` of `publishProfile`,
   * which rightly catches them (a silent channel cannot stall the others) and
   * so it resolves successfully even when nothing was sent. The real fix is for
   * `publishProfile` to REPORT which channels failed, and that is what these two
   * tests measure, with the vault refusing the write, not with the method mocked.
   *
   * **The mock that was here was the opposite bug:**
   * `vi.spyOn(a.session, "publishProfile").mockRejectedValue(...)` replaced
   * exactly the method that swallows errors with the desired behavior. It passed
   * green on broken code.
   *
   * The cost of being wrong the other way is one extra attempt. Reported by the owner on October 5, 2026,
   * with names showing as addresses in a call.
   */
  it("uma ronda que falha fica por cumprir, e a ligação seguinte volta a tentar", async () => {
    const { a, b, canal } = await canalFundadoComConvidado()
    const perfisDeA = (): unknown[] =>
      b.seen.filter((m) => m.channel === canal && m.sender === a.address && m.payload["t"] === "profile")
    await until(() => perfisDeA().length > 0, "B recebe o perfil pelo caminho normal")

    /*
      The old vault, and the FULL vault: one of two reasons why
      `publishProfile` gives up on a channel, and the one a test can trigger without
      touching any product method. `vault.update` calls `#persist`, which calls the
      disk's `write`, and it is that `write` that refuses.
    */
    cofreDe(a.session).contents.profileRepairRound = 0
    a.cofre.recusar = "storage is full"
    a.session.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 500))
    await a.session.connect()

    // The assertion that matters: the round was NOT written. This is where it used to end up as 2.
    expect(cofreDe(a.session).contents.profileRepairRound ?? 0).toBe(0)

    // And the next connection, with the vault accepting again, completes it.
    a.cofre.recusar = null
    b.seen.length = 0
    a.session.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 500))
    await a.session.connect()

    await until(() => perfisDeA().length > 0, "a ronda por cumprir volta a mandar o perfil")
    expect(cofreDe(a.session).contents.profileRepairRound).toBeGreaterThan(0)

    a.session.disconnect()
    b.session.disconnect()
  }, 90_000)

  /**
   * And whoever has no name yet does not waste the round publishing nothing.
   *
   * The second way it got burned for nothing, and this one needed
   * no failure to happen: `publishProfile` starts with
   * `if (!profile.displayName) return`, so it resolved successfully without
   * publishing a single thing, and the round got recorded. Whoever created the account and only
   * set a name later would have the repair spent before it had anything to repair.
   */
  it("uma conta sem nome não dá a ronda por cumprida", async () => {
    const semNome = await peerSemPerfil()
    const canal = moradaDeSala(HOME)
    await semNome.session.createSpaceChannel(canal)

    cofreDe(semNome.session).contents.profileRepairRound = 0
    semNome.session.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 500))
    await semNome.session.connect()

    expect(cofreDe(semNome.session).contents.profileRepairRound ?? 0).toBe(0)

    // And with a name, the next connection completes it: the round waited for something to
    // publish, which is the whole point.
    await semNome.session.updateProfile({ displayName: "Anónimo", donations: [] })
    semNome.session.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 500))
    await semNome.session.connect()

    expect(cofreDe(semNome.session).contents.profileRepairRound).toBeGreaterThan(0)

    semNome.session.disconnect()
  }, 90_000)

  /**
   * And a vault that already completed the previous round republishes again after an update.
   *
   * That is what a new round is for, and that is what fixes names that are already wrong
   * in the field: an updated vault carries `profileRepairRound: 1` and must publish
   * the profile again in all channels, once.
   *
   * The owner's case is this, not a new channel: he imported onto the computer a
   * weeks-old vault, which carries the `publishedProfileAt` of whoever exported it,
   * saying "I already published" on channels where THIS device never published anything. The
   * channel did not grow, nothing changes epoch, and without a new round no path
   * sends the profile again. Only the round fixes it.
   *
   * This pins the CONSTANT without exporting it: if `RONDA_DE_REPARACAO` goes back to 1,
   * a vault with 1 already done will not republish and this turns red.
   */
  it("um cofre que já fez a ronda anterior volta a publicar o perfil ao actualizar", async () => {
    const { a, b, canal } = await canalFundadoComConvidado()
    const perfisDeA = (): unknown[] =>
      b.seen.filter((m) => m.channel === canal && m.sender === a.address && m.payload["t"] === "profile")
    await until(() => perfisDeA().length > 0, "B recebe o perfil pelo caminho normal")

    // The state of an updated vault: round 1 done, and the profile marked as
    // published in this channel, which is what makes `publishProfile` without `force`
    // skip it forever.
    cofreDe(a.session).contents.profileRepairRound = 1
    expect(cofreDe(a.session).contents.publishedProfileAt[canal]).toBeDefined()

    b.seen.length = 0
    a.session.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 500))
    await a.session.connect()

    await until(() => perfisDeA().length > 0, "a ronda nova republica o perfil num canal que não cresceu")

    a.session.disconnect()
    b.session.disconnect()
  }, 90_000)
})

/**
 * The name of EVERYBODY, not just whoever invited.
 *
 * The owner's report on August 18, 2026: *"she is seeing the first word
 * of the address instead of the username"*, and the detail that makes it diagnostic:
 * **she sees the right name of ONE of the users, and not the others**.
 *
 * The path of whoever invites already republishes the profile (it is the test above). What remains
 * is what happens to whoever was in the channel and did not invite anyone: for the
 * newcomer, that person's profile was published in an epoch they will never have, and the
 * asymmetry of the report has exactly that shape: one path covers it, the other must cover it too.
 */
describe("um canal com três, e o terceiro a chegar", () => {
  it("mostra a quem chega o nome de todos os que já lá estavam", async () => {
    const a = await peer("Alice")
    const b = await peer("Bob")
    const c = await peer("Carla")
    const canal = moradaDeSala(HOME)

    await a.session.createSpaceChannel(canal)
    await a.session.seat(canal, b.address)
    await until(() => b.session.channels.includes(canal), "B entra no canal")

    // A and B already know each other by name. It is the normal state of a channel with people
    // in it, and it is from there that C arrives.
    await until(
      () => b.seen.some((m) => m.sender === a.address && m.payload["t"] === "profile"),
      "B recebe o perfil de A",
    )

    await a.session.seat(canal, c.address)
    await until(() => c.session.channels.includes(canal), "C entra no canal")

    const nomeQueCVe = (de: string): string | undefined => {
      const perfis = c.seen.filter((m) => m.channel === canal && m.sender === de && m.payload["t"] === "profile")
      return perfis.at(-1)?.payload["displayName"] as string | undefined
    }

    // Whoever invited: already proven, and stays as a control: without it, a
    // red here would not tell "the republish does not run" from "the delivery
    // does not arrive".
    await until(() => nomeQueCVe(a.address) === "Alice", "C vê o nome de quem a convidou")

    // And whoever was there without inviting anyone, which is the missing half.
    await until(() => nomeQueCVe(b.address) === "Bob", "C vê o nome de quem já lá estava")

    expect(nomeQueCVe(a.address)).toBe("Alice")
    expect(nomeQueCVe(b.address)).toBe("Bob")

    a.session.disconnect()
    b.session.disconnect()
    c.session.disconnect()
  }, 90_000)
})

/**
 * The wall, which is the same wound where it shows most.
 *
 * Each person's feed is a channel, and a friend joins it when the friendship
 * is made. Everything published there before that was encrypted in epochs he
 * will never have. Nobody reads that as cryptography: it reads as "published nothing".
 */
describe("o mural de quem aceita um amigo", () => {
  it("mostra ao amigo novo o que já lá estava publicado antes da amizade", async () => {
    const a = await peer("Alice")
    const b = await peer("Bob")

    // Published BEFORE any friendship existed, so in an epoch before
    // B's entry. It is this order that matters; the other way always worked
    // and proved nothing.
    await a.session.post("o que ficou dito antes de nos conhecermos")

    // And now the friendship, which is what gives B a seat in A's feed.
    await a.session.acceptFollower(b.address)

    const feed = a.session.feedChannel
    await until(() => b.session.channels.includes(feed), "B entra no feed de A")

    const publicacoesVistas = (): string[] =>
      b.seen
        .filter((m) => m.channel === feed && m.payload["t"] === "post")
        .map((m) => String(m.payload["caption"] ?? ""))

    await until(
      () => publicacoesVistas().some((c) => c.includes("antes de nos conhecermos")),
      "B recebe a publicação anterior à amizade",
    )

    a.session.disconnect()
    b.session.disconnect()
  }, 60_000)

  /**
   * And what HANGS OFF the posts, which until phase S1 nobody repeated.
   *
   * `republishPosts` republishes the `post`. The `post.comment` and the
   * `post.reaction` travel as their own events, and were sent in an epoch
   * before the new friend's entry. Until 20/10/2026 nobody sent them again:
   * the wall appeared with the posts and zero comments and likes.
   * Since phase S1 of absolute sync, each author resends their own
   * (`republishEngagement`), once each, with the original `id`. The comments
   * wait for the new friend to announce itself (§4.6), and so
   * they arrive a little after the post.
   */
  it("os comentários e os gostos da dona do mural chegam a quem entra (S1)", async () => {
    const a = await peer("Alice")
    const b = await peer("Bob")

    await a.session.post("uma publicação com conversa por baixo")
    const feedDeA = a.session.feedChannel
    const publicacao = a.seen.filter((m) => m.channel === feedDeA && m.payload["t"] === "post").at(-1)
    const id = String(publicacao?.payload["id"] ?? "")
    if (!id) throw new Error("a publicação não entrou no mural de quem a escreveu")
    await a.session.commentOnPost(feedDeA, id, "e um comentário da própria")
    await a.session.reactToPost(feedDeA, id, "❤")

    // And only now the friendship, which is what gives B a seat in the feed.
    await a.session.acceptFollower(b.address)
    const feed = a.session.feedChannel
    await until(() => b.session.channels.includes(feed), "B entra no feed de A")
    await until(
      () => b.seen.some((m) => m.channel === feed && m.payload["t"] === "post"),
      "B recebe a publicação republicada",
    )
    await until(() => b.seen.some((m) => m.channel === feed && m.payload["t"] === "post.comment"), "B recebe o comentário")
    await until(() => b.seen.some((m) => m.channel === feed && m.payload["t"] === "post.reaction"), "B recebe o gosto")

    // Once each, in B's vault: the resend creates no new entries.
    const doFeed = b.session.history(feed)
    expect(doFeed.filter((m) => m.payload.t === "post.comment")).toHaveLength(1)
    expect(doFeed.filter((m) => m.payload.t === "post.reaction")).toHaveLength(1)

    a.session.disconnect()
    b.session.disconnect()
  }, 60_000)

  it("não republica o mural de outra pessoa, mesmo tendo-o no cofre", async () => {
    // The contrast that prevents a repair from turning into a hole: the sender is
    // authenticated by MLS, so republishing someone else's feed would sign it with
    // our key and write to their wall.
    const a = await peer("Alice")
    const b = await peer("Bob")

    await a.session.post("isto é do mural da Alice")
    await a.session.acceptFollower(b.address)
    const feed = a.session.feedChannel
    await until(() => b.session.channels.includes(feed), "B entra no feed de A")

    /*
      A's own republish has to land before we count anything.

      Joining the feed grows the member list, and a new member makes A
      republish her wall: that is what a join is for. That post
      reaches B a few hundred milliseconds after the `until` above returns, so
      it fell AFTER the baseline sample and BEFORE the second count: the test
      read one more post and blamed B's `republishPosts` for it.
      Reproduced in 9cd95a3, which is the production version, so it is not from
      this slice; what changes with the machine is just the frequency.

      We wait for A's post, then take the sample. The pause after it stays as it
      was, for whatever comes next.
    */
    await until(
      () => b.seen.some((m) => m.channel === feed && m.payload["t"] === "post"),
      "o mural de A chega a B pelo caminho normal",
    )
    await new Promise((resolve) => setTimeout(resolve, 1500))

    // B has the publication in the vault and is a member of the channel. Still,
    // republishing A's feed from B puts nothing there: the guard is that the
    // channel is OUR feed, and A's is not.
    const antes = b.seen.filter((m) => m.channel === feed && m.payload["t"] === "post").length
    await b.session.republishPosts(feed)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const depois = b.seen.filter((m) => m.channel === feed && m.payload["t"] === "post").length
    expect(depois).toBe(antes)

    a.session.disconnect()
    b.session.disconnect()
  }, 60_000)
})

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-fundador-"))
  const config: ServerConfig = {
    serverName: HOME,
    bindHost: "127.0.0.1",
    bindPort: PORT,
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
    commonRoom: "",
  }
  enclave = await buildServer(config)
  await enclave.app.listen({ host: config.bindHost, port: config.bindPort })
}, 30_000)

afterAll(async () => {
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
})
