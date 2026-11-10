import { describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"
import type { FichaDoCanal } from "./tipoDoCanal.js"
import { darFicha, moradaNova } from "../testes/moradas.js"

/**
 * Administration in a conversation between two people: does not exist, it is a rule.
 *
 * Owner's order, word for word: "It must not be possible to make admin in the private
 * conversation between two users." Until now only the screen enforced it,  * `admiteAdministracao`, in `packages/ui/src/lib/format.ts`, whose comment promises that
 * "the real refusal lives in the core, which trusts no screen". These tests exist for
 * that promise to be true and stay true.
 *
 * Two sides, and both count: the one publishing, where the refusal is an exception with
 * the reason written; and the one receiving, which is what holds back an altered client,  * no hidden menu stops anyone from calling the bridge, or from sending down a `role.assign`
 * that never went through any guard. Modeled on the twin ones in `session.eliminar.test.ts`,
 * which hold the same refusal for the neighbor gesture: a conversation is not deleted either.
 */

class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

/**
 * The phrase, written by hand and in full.
 *
 * Importing the constant from the core would make this test pass with any wording,
 * even one that said the opposite: what is held here is what the person reads, and
 * that is not checked against itself.
 */
const RECUSA = "a direct conversation has no administration"

/** A direct conversation, from the vault record (the opaque address says nothing). */
const DIRECTA: FichaDoCanal = { tipo: "directa" }
const SALA: FichaDoCanal = { tipo: "sala" }

/** A session offline, with the channel created and saved by this account. */
async function sessaoCom(channel: string, ficha: FichaDoCanal): Promise<{ session: Session; vault: Vault; eu: string }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  const { address } = await session.createIdentity("localhost:8448")
  // The record before the channel is born: the first one stays, and without it is a room.
  darFicha(vault.contents, channel, ficha)
  // Offline: the group is saved, and it is the `channel.subscribe` that breaks.
  await session.createSpaceChannel(channel).catch(() => {})
  return { session, vault, eu: address }
}

/**
 * Save the founding by hand, as if sign-up had already arrived and been saved.
 *
 * Offline `createSpaceChannel` never gets to publish the `room.created`, the
 * `channel.subscribe` breaks first, so the vault of a channel created here has no owner.
 * It is the same setup as the tests in `session.test.ts`, and it is what lets us
 * separate the two cases that matter: with a recorded owner and without one.
 */
async function fundadoPor(vault: Vault, channel: string, address: string): Promise<void> {
  await vault.update((contents) => {
    contents.channelFounder[channel] = { address, seq: 1 }
  })
}

/** The message the promise was refused with, to compare it whole. */
async function recusaDe(promessa: Promise<unknown>): Promise<string> {
  return await promessa.then(
    () => "não recusou nada",
    (erro: unknown) => (erro as Error).message,
  )
}

describe("numa conversa entre duas pessoas não manda ninguém", () => {
  const dm = moradaNova()
  const sala = moradaNova()

  it("nem quem a abriu, que é quem fica registado como fundador do lado dele", async () => {
    const { session, vault, eu } = await sessaoCom(dm, DIRECTA)
    await fundadoPor(vault, dm, eu)

    // With the founding record in hand: it is the shortcut of `#mandaEm` that, without
    // the guard, gave everything to whoever opened the conversation.
    expect(session.founderOf(dm)).toBe(eu)
    expect(session.mayManageRoles(dm)).toBe(false)
  }, 60_000)

  it("nem o outro lado, que nunca chegou a receber o registo de fundação", async () => {
    // `openDirect` publishes `room.created` BEFORE seating the second person, so in their
    // vault there is no founder. It is the worst case, and the normal one: "channel with no
    // owner is for all" would have given full admin to both.
    const { session } = await sessaoCom(dm, DIRECTA)

    expect(session.founderOf(dm)).toBeNull()
    expect(session.mayManageRoles(dm)).toBe(false)
  }, 60_000)

  it("nem quem tenha o papel embutido, que numa sala bastaria", async () => {
    // A conversation in a vault saved before this guard can have inside it an assignment
    // that is no longer valid. This is the case, and it is not valid.
    const { session, vault, eu } = await sessaoCom(dm, DIRECTA)
    await fundadoPor(vault, dm, "@outra:localhost:8448")
    await vault.update((contents) => {
      contents.channelMemberRoles[dm] = { [eu]: ["admin"] }
    })

    expect(session.rolesFor(dm, eu)).toEqual(["admin"])
    expect(session.mayManageRoles(dm)).toBe(false)
  }, 60_000)

  it("numa sala fundada por esta conta continua a mandar-se, como sempre", async () => {
    // The contrast that makes sense of the three above: what closes the door is being a
    // conversation, not a failure that refuses everything to everyone.
    const { session, vault, eu } = await sessaoCom(sala, SALA)
    await fundadoPor(vault, sala, eu)

    expect(session.founderOf(sala)).toBe(eu)
    expect(session.mayManageRoles(sala)).toBe(true)
  }, 60_000)
})

describe("as três portas da administração recusam, e dizem porquê", () => {
  const dm = moradaNova()

  it("nomear alguém", async () => {
    const { session } = await sessaoCom(dm, DIRECTA)
    expect(await recusaDe(session.assignRoles(dm, "@outra:localhost:8448", ["admin"]))).toBe(RECUSA)
  }, 60_000)

  it("tornar administrador, que é o gesto da ordem, pelo atalho que a interface usa", async () => {
    const { session } = await sessaoCom(dm, DIRECTA)
    expect(await recusaDe(session.assignRole(dm, "@outra:localhost:8448", true))).toBe(RECUSA)
  }, 60_000)

  it("criar um papel", async () => {
    const { session } = await sessaoCom(dm, DIRECTA)
    expect(await recusaDe(session.defineRole(dm, { role: "chefe", name: "Chefe", powers: ["expulsar"] }))).toBe(RECUSA)
  }, 60_000)

  it("apagar um papel", async () => {
    const { session } = await sessaoCom(dm, DIRECTA)
    expect(await recusaDe(session.deleteRole(dm, "chefe"))).toBe(RECUSA)
  }, 60_000)

  it("a razão certa, e não a genérica: aqui não falta poder, não há poder nenhum", async () => {
    // The generic refusal ("only who administers...") would send the person looking for
    // who administers the conversation. There is no one. That is why the phrase is different.
    const { session } = await sessaoCom(dm, DIRECTA)
    expect(await recusaDe(session.assignRoles(dm, "@outra:localhost:8448", ["admin"]))).not.toBe("only an administrator may manage roles")
  }, 60_000)

  it("num canal de que não somos membros, primeiro vem isso — a ordem das guardas mantém-se", async () => {
    const { session } = await sessaoCom(moradaNova(), SALA)
    const outra = moradaNova()
    expect(await recusaDe(session.assignRoles(outra, "@outra:localhost:8448", ["admin"]))).toBe("not a member of this channel")
  }, 60_000)
})

/**
 * The receiving side, the only one that can handle a modified client.
 *
 * `send` publishes the payload raw, without going through `assignRoles` or
 * `defineRole`, exactly what a client with guards removed does, or the other
 * end of a conversation running one. What disarms it is the recording path
 * rejecting anything that does not come from the sender, and in a conversation
 * nobody sends.
 */
describe("uma nomeação que chegue pelo fio a uma conversa não convence este cliente", () => {
  const dm = moradaNova()
  const sala = moradaNova()
  const alvo = "@amigo:localhost:8448"

  it("um `role.assign` não dá papel nenhum a ninguém", async () => {
    // Founded by this account, which is the most favorable case for publishing: without
    // the guard, the recording path accepted the claim without hesitation.
    const { session, vault, eu } = await sessaoCom(dm, DIRECTA)
    await fundadoPor(vault, dm, eu)
    await session.send(dm, { t: "role.assign", subject: alvo, roles: ["admin"], assignedAt: 1 }).catch(() => {})

    expect(session.rolesFor(dm, alvo)).toEqual([])
    expect(session.adminsOf(dm)).toEqual([])
  }, 60_000)

  it("um `role.define` não chega a criar o papel", async () => {
    const { session, vault, eu } = await sessaoCom(dm, DIRECTA)
    await fundadoPor(vault, dm, eu)
    await session
      .send(dm, { t: "role.define", role: "chefe", name: "Chefe", powers: ["expulsar"], position: 0, removed: false, definedAt: 1 })
      .catch(() => {})

    expect(session.rolesOf(dm)).toEqual([])
  }, 60_000)

  it("a mesma nomeação, na sala que esta conta fundou, é gravada — o arnês não está a mentir", async () => {
    // Without this, the two tests above would pass with the entire recording path
    // broken, and nobody would notice.
    const { session, vault, eu } = await sessaoCom(sala, SALA)
    await fundadoPor(vault, sala, eu)
    await session.send(sala, { t: "role.assign", subject: alvo, roles: ["admin"], assignedAt: 1 }).catch(() => {})

    expect(session.rolesFor(sala, alvo)).toEqual(["admin"])
    expect(session.adminsOf(sala)).toEqual([alvo])
  }, 60_000)
})
