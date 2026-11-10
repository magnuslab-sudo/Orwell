import { afterEach, describe, expect, it, vi } from "vitest"
import { IRREVERSIBLE_POWERS, parseServerName, PODERES_ANTIGOS, PODERES_DE_TODOS_POR_OMISSAO, POWERS, SALA_DA_PERGUNTA, type Payload } from "@enclave/protocol"
import { BOOTSTRAP_PEERS } from "./bootstrap.js"
import { formatInviteLink, Session, surdezConfirmada } from "./session.js"
import { noteTransmitter, Vault, type StoredChatMessage, type VaultBackend } from "./vault.js"
import { canalComFicha, moradaNova } from "../testes/moradas.js"

/**
 * `forgetChannel`, against a real vault and a real MLS group.
 *
 * The group is created through `createSpaceChannel`, which persists the state
 * before it ever touches the socket — sending then throws, because there is no
 * connection, and that is exactly the point where a test can stop it. What is
 * asserted afterwards is the whole contract: the channel gone from memory,
 * every trace of it gone from the vault, and the `channels` event emitted.
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

function storedMessage(seq: number): StoredChatMessage {
  return {
    seq,
    sender: "@abc:localhost",
    at: seq,
    payload: { t: "message", id: `id-${seq}`, sentAt: seq, body: `mensagem ${seq}`, attachments: [], mentions: [] },
  }
}

describe("Session.forgetChannel", () => {
  it("apaga grupo, histórico e lastSeq, deixa de listar o canal e emite channels", async () => {
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")

    const session = new Session(vault)
    await session.createIdentity("localhost:8448")

    const channel = moradaNova()
    const other = moradaNova()
    // Offline: the group state is persisted, then the subscribe frame throws.
    await session.createSpaceChannel(channel).catch(() => {})
    await session.createSpaceChannel(other).catch(() => {})
    expect(session.channels).toContain(channel)
    expect(vault.contents.groups[channel]).toBeTruthy()

    await vault.update((contents) => {
      contents.history[channel] = [storedMessage(1), storedMessage(2)]
      contents.lastSeq[channel] = 2
      contents.history[other] = [storedMessage(7)]
      contents.lastSeq[other] = 7
    })

    const emitted: string[][] = []
    session.on("channels", (event) => emitted.push(event.channels))

    await session.forgetChannel(channel)

    expect(session.channels).not.toContain(channel)
    expect(vault.contents.groups[channel]).toBeUndefined()
    expect(vault.contents.history[channel]).toBeUndefined()
    expect(vault.contents.lastSeq[channel]).toBeUndefined()
    expect(session.history(channel)).toEqual([])

    // The other channel is untouched, and the event carries the survivors.
    expect(session.channels).toContain(other)
    expect(vault.contents.history[other]).toHaveLength(1)
    expect(vault.contents.lastSeq[other]).toBe(7)
    expect(emitted).toEqual([[other]])
  }, 60_000)
})

/** A session with a real vault, a real identity and a real MLS group, offline. */
async function offlineSession(): Promise<{ vault: Vault; session: Session; address: string }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  const { address } = await session.createIdentity("localhost:8448")
  return { vault, session, address }
}

/**
 * The regression that cost everyone their history: a repair that re-seats a
 * member who is reading perfectly well.
 *
 * A re-seat rekeys the group, and forward secrecy then denies the new seat
 * every post made before it. Doing that to a healthy member is not a repair,
 * it is the damage — and it used to happen on every reconnect, and again on
 * every press of "Reparar", because `force` jumped straight to `#reseat`.
 */
describe("Session.repairInvite — a tempestade de re-assentos", () => {
  it("não re-assenta quem tem prova de vida, mesmo forçado", async () => {
    const { vault, session, address } = await offlineSession()
    const channel = session.feedChannel
    await session.createSpaceChannel(channel).catch(() => {})

    // The proof: something this member sealed to this channel came out again.
    await vault.update((contents) => noteTransmitter(contents, channel, address))
    const before = vault.contents.groups[channel]

    // Forced is the button, not the reconnect loop. It lifts the cooldown; it
    // does not get to overrule the cryptography.
    expect(await session.repairInvite(channel, address, true)).toBe("live")
    expect(vault.contents.groups[channel]).toBe(before)
    // A no-op is not an attempt, so nothing goes on cooldown either.
    expect(vault.contents.repairAttempts[`${address}|${channel}`]).toBeUndefined()
  }, 60_000)

  it("sem prova nenhuma no canal, espera em vez de adivinhar", async () => {
    const { vault, session, address } = await offlineSession()
    const channel = session.feedChannel
    await session.createSpaceChannel(channel).catch(() => {})
    const before = vault.contents.groups[channel]

    // A vault written before the transmitters record existed knows nothing
    // about anybody. "I do not know" must never be read as "they are dead".
    expect(await session.repairInvite(channel, address, true)).toBe("unproven")
    expect(vault.contents.groups[channel]).toBe(before)
  }, 60_000)
})

/**
 * A bootstrap that could not finish must not be recorded as finished.
 *
 * The flag was written unconditionally after a loop that swallowed every
 * failure: one peer offline or out of key packages when it first ran, and that
 * friendship was never made — and could never be retried, because the flag
 * stopped every later pass. That is exactly how one founding account never
 * got a seat in another's feed.
 */
describe("Session.syncCommunity", () => {
  const server = "localhost:8448"
  afterEach(() => {
    delete BOOTSTRAP_PEERS[server]
  })

  it("não marca o bootstrap como feito quando um par não pôde ser assentado", async () => {
    const { vault, session, address } = await offlineSession()
    const peer = "@ausente:localhost:8448"
    BOOTSTRAP_PEERS[server] = [address, peer]

    // Pre-created, so `ensureFeed` finds it instead of failing on the socket.
    await session.createSpaceChannel(session.feedChannel).catch(() => {})

    // Offline: claiming a key package throws, which is precisely the "she was
    // not there when it ran" case.
    expect(await session.syncCommunity()).toEqual([peer])
    expect(vault.contents.bootstrapDone).toBeUndefined()

    // And because it was never marked done, the next connect tries again.
    expect(await session.syncCommunity()).toEqual([peer])
    expect(vault.contents.bootstrapDone).toBeUndefined()
  }, 60_000)
})

/**
 * Deafness is a sustained chain of failures, not a burst that passes.
 *
 * Counting alone declared the device deaf on the third frame it did not open,  * and our own echoes do not open, by design. In a call you swap dozens of
 * messages per second, which made the client request a new seat mid-call and
 * trigger a reseat that wipes the channel history for future secrecy.
 */
describe("surdezConfirmada", () => {
  const inicio = 1_000_000

  it("não se deixa enganar por uma rajada, por muitas falhas que traga", () => {
    // Twenty failures in one hundred milliseconds: a burst of echoes, not a dead spot.
    expect(surdezConfirmada({ falhas: 20, desde: inicio }, inicio + 100)).toBe(false)
  })

  it("confirma quando as falhas duram", () => {
    expect(surdezConfirmada({ falhas: 5, desde: inicio }, inicio + 30_000)).toBe(true)
  })

  it("exige as duas condições, não uma delas", () => {
    // Plenty of time, few failures: the channel is quiet, not deaf.
    expect(surdezConfirmada({ falhas: 4, desde: inicio }, inicio + 600_000)).toBe(false)
    // Too many failures, not enough time.
    expect(surdezConfirmada({ falhas: 99, desde: inicio }, inicio + 29_999)).toBe(false)
  })
})

/**
 * One invite per person, one friend request at a time.
 *
 * Clicking the button twice sent two. In the case of the room, that burns
 * another key package from the person and gives her a second leaf in the tree
 * for the same address: half the messages now encrypt to a place she cannot
 * open, and the exhausted reserve stops anyone who comes next from inviting her
 * at all.
 */
describe("convites repetidos", () => {
  it("recusa convidar quem já está na sala", async () => {
    const { session, address } = await offlineSession()
    const channel = session.feedChannel
    // The channel creator is its first member, and serves as a guinea pig without safety net.
    await session.createSpaceChannel(channel).catch(() => {})

    await expect(session.invite(channel, address)).rejects.toThrow("that person is already in this channel")
  }, 60_000)

  /**
   * A request that did not send does not stay pending (F2, 20/10/2026).
   *
   * This test measured the opposite: the first request was saved to the log and
   * only then failed to send, and that record blocked the second one. That was
   * the bug: a request that never reached anyone stayed "sent" forever, and the
   * button to ask again was locked by it. Now the log saves only with the server
   * echo, so the second request tries again, and it is the lack of connection
   * that is reported.
   */
  it("um pedido que não saiu não fica pendente, e o segundo volta a tentar", async () => {
    const { vault, session } = await offlineSession()
    const channel = session.feedChannel
    await session.createSpaceChannel(channel).catch(() => {})

    await expect(session.sendFriendRequest(channel)).rejects.toThrow("no connection to the server")
    await expect(session.sendFriendRequest(channel)).rejects.toThrow("no connection to the server")
    expect((vault.contents.history[channel] ?? []).filter((m) => m.payload.t === "friend.request")).toHaveLength(0)
  }, 60_000)

  it("dois cliques ao mesmo tempo não deixam pedido nenhum gravado sem ligação", async () => {
    const { vault, session } = await offlineSession()
    const channel = session.feedChannel
    await session.createSpaceChannel(channel).catch(() => {})

    // Both clicks merge into the same promise (`#umaDeCadaVez`), and with no
    // connection neither leaves a trace: the log saves only with the echo.
    const desfechos = await Promise.allSettled([session.sendFriendRequest(channel), session.sendFriendRequest(channel)])
    expect(desfechos.every((desfecho) => desfecho.status === "rejected")).toBe(true)

    const pedidos = (vault.contents.history[channel] ?? []).filter((m) => m.payload.t === "friend.request")
    expect(pedidos).toHaveLength(0)
  }, 60_000)
})

/**
 * Channel administration survives an F5.
 *
 * The founding record arrives once and never again, consumed during catch-up and
 * never returns. Stored only in memory, reloading the page would erase it: the channel
 * would appear again without an owner and offer itself to whoever arrived, which is
 * exactly how this bug appeared.
 */
describe("quem administra um canal", () => {
  it("sem registo de fundação, qualquer membro manda", async () => {
    const { session } = await offlineSession()
    const channel = session.feedChannel
    await session.createSpaceChannel(channel).catch(() => {})
    // `createSpaceChannel` publishes the record, but offline the send fails: the
    // channel ends up ownerless, which is the state of channels born before this.
    expect(session.founderOf(channel)).toBeNull()
    expect(session.mayEditChannel(channel)).toBe(true)
  }, 60_000)

  it("com dono registado no cofre, só ele manda — e sobrevive a reabrir", async () => {
    const { vault, session, address } = await offlineSession()
    const channel = session.feedChannel
    await session.createSpaceChannel(channel).catch(() => {})

    // As if someone else's record had arrived and been saved.
    await vault.update((contents) => {
      contents.channelFounder[channel] = { address: "@outra:teste", seq: 3 }
    })

    expect(session.founderOf(channel)).toBe("@outra:teste")
    expect(session.mayEditChannel(channel)).toBe(false)
    await expect(session.updateSpaceMeta(channel, { name: "Meu agora" })).rejects.toThrow("only an administrator may edit this channel")

    // And whoever was named gets to command.
    await vault.update((contents) => {
      contents.channelAdmins[channel] = [address]
    })
    expect(session.mayEditChannel(channel)).toBe(true)
  }, 60_000)

  /**
   * The answer cannot depend on what is already on disk.
   *
   * `powersOf` read `founderOf`, which is only the vault, while `#mandaEm`,    * a hundred lines above, already accounted for what was waiting to be saved.
   * Both answer the same question and disagreed for the duration of a drain.
   *
   * What that looked like on screen, measured in a swarm run: the invite button
   * visible, the click refused with "you don't have the power to invite", and
   * four people in the same channel with different answers depending on what
   * each vault had already drained. A rule that depends on that is not a rule.
   *
   * The test bites because it saves the record by two paths and demands the same
   * answer from both: `mayEditChannel` (which always accounted for the pending)
   * and `may(…, "convidar")` (which did not).
   */
  it("convidar e administrar concordam sobre quem fundou o canal", async () => {
    const { vault, session } = await offlineSession()
    const channel = session.feedChannel
    await session.createSpaceChannel(channel).catch(() => {})

    // No owner: both allow, which is the rule for channels without foundation.
    expect(session.mayEditChannel(channel)).toBe(true)
    expect(session.may(channel, "convidar")).toBe(true)

    // With someone else's owner: both refuse. Before, this second line answered
    // "yes" while the record was not yet saved.
    await vault.update((contents) => {
      contents.channelFounder[channel] = { address: "@outra:teste", seq: 3 }
    })
    expect(session.mayEditChannel(channel)).toBe(false)
    expect(session.may(channel, "convidar")).toBe(false)
  }, 60_000)

  it("um canal já fundado não se deixa tomar", async () => {
    const { vault, session } = await offlineSession()
    const channel = session.feedChannel
    await session.createSpaceChannel(channel).catch(() => {})
    await vault.update((contents) => {
      contents.channelFounder[channel] = { address: "@outra:teste", seq: 3 }
    })
    await expect(session.claimFounder(channel)).rejects.toThrow("this channel already has an administrator")
  }, 60_000)
})

/**
 * Named roles, with separate powers.
 *
 * Real access control lives here and never on screen alone: hiding a button
 * does not stop anyone from calling the endpoint, and what protects is the
 * core refusing to publish. For the receiver's side the same holds backward,  * an altered client publishes whatever it wants, and what keeps it powerless is
 * each honest client refusing what does not come from whoever commands.
 *
 * The distinction these tests exist to fix: `expulsar` has cryptographic effect
 * and is irreversible; `convidar`, `renomear` and `mover` are convention
 * applied by clients. Holding back any of them is always convention, what
 * changes is what gets done when someone uses it.
 */
describe("papéis de um canal", () => {
  /** A channel with a registered owner who is not us, and we are in it. */
  async function canalDeOutrem(): Promise<{ vault: Vault; session: Session; address: string; canal: string }> {
    const { vault, session, address } = await offlineSession()
    const canal = session.feedChannel
    await session.createSpaceChannel(canal).catch(() => {})
    await vault.update((contents) => {
      contents.channelFounder[canal] = { address: "@dona:teste", seq: 1 }
    })
    return { vault, session, address, canal }
  }

  /** Saves a role defined on the channel, as if it had arrived over the network. */
  async function definir(
    vault: Vault,
    canal: string,
    role: string,
    powers: string[],
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await vault.update((contents) => {
      const doCanal = contents.channelRoles[canal] ?? {}
      doCanal[role] = {
        at: 1,
        payload: { t: "role.define", role, name: role, powers, position: 0, removed: false, definedAt: 1, ...extra },
      }
      contents.channelRoles[canal] = doCanal
    })
  }

  it("um papel sem responsabilidades nenhumas dá acesso e mais nada", async () => {
    const { vault, session, address, canal } = await canalDeOutrem()
    await definir(vault, canal, "convidado", [])
    await vault.update((contents) => {
      contents.channelMemberRoles[canal] = { [address]: ["convidado"] }
    })

    // Has the role, and you can see it does. What it does not have is any power
    // beyond the base for everyone (`@todos`, 1.2: what was already free).
    expect(session.rolesFor(canal, address)).toEqual(["convidado"])
    expect(session.powersOf(canal, address)).toEqual(POWERS.filter((poder) => PODERES_DE_TODOS_POR_OMISSAO.includes(poder)))
    expect(session.may(canal, "renomear")).toBe(false)
    expect(session.may(canal, "expulsar")).toBe(false)
  }, 60_000)

  it("quem só pode renomear muda o nome do canal, e não nomeia ninguém", async () => {
    const { vault, session, address, canal } = await canalDeOutrem()
    await definir(vault, canal, "arrumador", ["renomear"])
    await vault.update((contents) => {
      contents.channelMemberRoles[canal] = { [address]: ["arrumador"] }
    })

    expect(session.may(canal, "renomear")).toBe(true)
    // Offline the send fails after the guard passes, and that is what we want to
    // see: it rejects for lack of connection, not for lack of permission.
    await expect(session.updateSpaceMeta(canal, { name: "Outro nome" })).rejects.not.toThrow(/only an administrator may edit this channel|you may not/)

    // Managing roles IS NOT one of the four powers. If it were, any role with
    // any power would be enough to name itself everything.
    expect(session.mayManageRoles(canal)).toBe(false)
    await expect(session.assignRoles(canal, "@outra:teste", ["arrumador"])).rejects.toThrow("only an administrator may manage roles")
    await expect(session.defineRole(canal, { role: "novo", name: "Novo", powers: [] })).rejects.toThrow("only an administrator may manage roles")
  }, 60_000)

  it("ter TODAS as responsabilidades de antes continua a não deixar gerir papéis", async () => {
    // Since 1.2 managing roles has a name (`gerircargos`), and only it opens this
    // door, with hierarchy on top (`session.permissoes.test.ts`). The eight from
    // before, all together, do not open it.
    const { vault, session, address, canal } = await canalDeOutrem()
    await definir(vault, canal, "capataz", [...PODERES_ANTIGOS])
    await vault.update((contents) => {
      contents.channelMemberRoles[canal] = { [address]: ["capataz"] }
    })
    expect(session.powersOf(canal, address)).not.toContain("gerircargos")
    expect(session.mayManageRoles(canal)).toBe(false)
  }, 60_000)

  it("sem a responsabilidade de expulsar, o núcleo recusa — mesmo que o ecrã deixe", async () => {
    const { vault, session, canal, address } = await canalDeOutrem()
    await definir(vault, canal, "arrumador", ["renomear"])
    await vault.update((contents) => {
      contents.channelMemberRoles[canal] = { [address]: ["arrumador"] }
    })
    // Refuses before touching the tree: a committed removal does not undo.
    await expect(session.expel(canal, "@alguem:teste")).rejects.toThrow("you may not expel in this channel")
  }, 60_000)

  it("expulsar não se vira contra quem fundou o canal, nem contra a própria conta", async () => {
    const { vault, session, canal, address } = await canalDeOutrem()
    // With the power in hand, and still refused in these two cases: whoever founds
    // does not unseat themselves, and leaving a channel is something else, with a
    // different name.
    await vault.update((contents) => {
      contents.channelMemberRoles[canal] = { [address]: ["admin"] }
    })
    expect(session.may(canal, "expulsar")).toBe(true)
    await expect(session.expel(canal, "@dona:teste")).rejects.toThrow("the founder cannot be expelled")
    await expect(session.expel(canal, address)).rejects.toThrow("to leave, forget the channel")
  }, 60_000)

  it("um papel apagado deixa de dar o que dava, sem tirar o papel a ninguém", async () => {
    const { vault, session, address, canal } = await canalDeOutrem()
    await definir(vault, canal, "moderador", ["expulsar"])
    await vault.update((contents) => {
      contents.channelMemberRoles[canal] = { [address]: ["moderador"] }
    })
    expect(session.may(canal, "expulsar")).toBe(true)

    await definir(vault, canal, "moderador", ["expulsar"], { removed: true })
    // The person still says they have the role; the role just no longer exists,
    // and a role that does not exist grants nothing.
    expect(session.rolesFor(canal, address)).toEqual(["moderador"])
    expect(session.rolesOf(canal)).toEqual([])
    expect(session.may(canal, "expulsar")).toBe(false)
  }, 60_000)

  /**
   * Moving between voice rooms: the guard on the caller's side.
   *
   * This is all this layer can do, and it is little on purpose. Whoever
   * receives the request obeys of their own will, see `voice.move` in the
   * protocol and the `handleSignal` in `call.ts`. The difference from `expel`,
   * which is here beside these same tests, is the effect: a completed expulsion
   * does not undo.
   */
  it("sem a responsabilidade de mover, o núcleo recusa mover alguém de sala", async () => {
    const { vault, session, canal, address } = await canalDeOutrem()
    await definir(vault, canal, "arrumador", ["renomear"])
    await vault.update((contents) => {
      contents.channelMemberRoles[canal] = { [address]: ["arrumador"] }
    })

    expect(session.may(canal, "mover")).toBe(false)
    await expect(session.moveVoice(canal, "@alguem:teste", "estudio")).rejects.toThrow("you may not move people in this channel")
  }, 60_000)

  it("com a responsabilidade de mover, a guarda deixa passar", async () => {
    const { vault, session, canal, address } = await canalDeOutrem()
    await definir(vault, canal, "capataz", ["mover"])
    await vault.update((contents) => {
      contents.channelMemberRoles[canal] = { [address]: ["capataz"] }
    })

    expect(session.may(canal, "mover")).toBe(true)
    // Offline the send fails after the guard: it rejects for lack of connection,
    // not for lack of permission.
    await expect(session.moveVoice(canal, "@alguem:teste", "estudio")).rejects.not.toThrow("you may not move people in this channel")
  }, 60_000)

  it("mover-se a si próprio é entrar na sala, e tem outro nome", async () => {
    const { vault, session, canal, address } = await canalDeOutrem()
    await vault.update((contents) => {
      contents.channelMemberRoles[canal] = { [address]: ["admin"] }
    })
    await expect(session.moveVoice(canal, address, "estudio")).rejects.toThrow("to change room, join it")
  }, 60_000)

  it("quem fundou tem tudo", async () => {
    const { vault, session, address } = await offlineSession()
    const canal = session.feedChannel
    await session.createSpaceChannel(canal).catch(() => {})
    await vault.update((contents) => {
      contents.channelFounder[canal] = { address, seq: 1 }
    })
    expect(session.powersOf(canal, address)).toEqual([...POWERS])
    expect(session.mayManageRoles(canal)).toBe(true)
  }, 60_000)

  /**
   * And a channel without recorded foundation gives what undoes, nothing more.
   *
   * It was "gives everything", by the logic of channels born before there was a
   * record: refusing everyone left them with no one to change their name. What
   * that rule did not see is that "no recorded foundation" does not describe
   * only old channels, it describes the entire channel as seen by WHOEVER JOINS
   * AFTER IT WAS FOUNDED, because the `room.created` was encrypted in an epoch
   * that person will never have. In other words: it described everyone invited
   * anywhere, and gave them the power to expel. See `apps/server/src/fundador.test.ts`,
   * with two real accounts, and `republishAuthority`, which is the fix.
   *
   * The line stayed where it separates what corrects from what gets done:
   * renaming someone else's channel undoes with another name; expelling advances
   * the epoch and publishing erases it, and neither has a backward move. The old
   * channel can still be tidied by whoever is in it, and the whole exit stays
   * `claimFounder`, one click in properties.
   */
  it("um canal sem fundação registada dá o que se desfaz, e nunca o que não se desfaz", async () => {
    const { session, address } = await offlineSession()
    const canal = session.feedChannel
    await session.createSpaceChannel(canal).catch(() => {})
    expect(session.founderOf(canal)).toBeNull()

    expect(session.powersOf(canal, address)).toEqual(POWERS.filter((poder) => !IRREVERSIBLE_POWERS.includes(poder)))
    // From the protocol list and not from a hand-written copy: when a new
    // irreversible power enters, this is where we want to see it also does not get
    // granted by ignorance.
    for (const poder of IRREVERSIBLE_POWERS) expect(session.may(canal, poder)).toBe(false)
    // Tidying can still happen, which is what old channels needed.
    expect(session.mayEditChannel(canal)).toBe(true)
    // Do not name it: with the role baked in, any member would assume they owned everything.
    expect(session.mayManageRoles(canal)).toBe(false)
  }, 60_000)

  /**
   * And a role saved on that channel does not reopen it.
   *
   * The poisoned vault case: before this version, any member of an ownerless
   * channel published a `role.define` with `expulsar` and a `role.assign` giving
   * it to themselves, and the save path accepted both. Those roles are saved in
   * the vaults that exist today. If `powersOf` summed the roles to the minimum
   * instead of answering and exiting, the update fixed nothing.
   */
  it("um papel gravado num canal sem dono não devolve o que não se desfaz", async () => {
    const { vault, session, address } = await offlineSession()
    const canal = session.feedChannel
    await session.createSpaceChannel(canal).catch(() => {})
    await vault.update((contents) => {
      contents.channelRoles[canal] = {
        carrasco: {
          at: 1,
          payload: { t: "role.define", role: "carrasco", name: "Carrasco", powers: [...POWERS], position: 0, definedAt: 1 },
        },
      }
      contents.channelMemberRoles[canal] = { [address]: ["carrasco"] }
      // And the naming of the old format, which is the other door to the same place.
      contents.channelAdmins[canal] = [address]
    })

    expect(session.may(canal, "expulsar")).toBe(false)
    expect(session.mayManageRoles(canal)).toBe(false)
    await expect(session.expel(canal, "@alguem:teste")).rejects.toThrow(/you may not expel in this channel|this channel has no recorded founder/)
  }, 60_000)

  /**
   * The receiver's side, which is what stops an altered client.
   *
   * `send` publishes the payload raw, without passing through the guards of
   * `assignRoles`, exactly what a modified client would do. What disarms it is
   * the save path refusing what does not come from whoever commands, and that
   * runs on each honest client, this one included.
   */
  it("uma nomeação publicada por quem não manda não convence nem o próprio cliente", async () => {
    const { session, canal } = await canalDeOutrem()
    await session
      .send(canal, { t: "role.assign", subject: "@amigo:teste", roles: ["admin"], assignedAt: 1 })
      .catch(() => {})
    expect(session.rolesFor(canal, "@amigo:teste")).toEqual([])
    expect(session.adminsOf(canal)).toEqual([])
  }, 60_000)

  it("um papel definido por quem não manda não chega a existir", async () => {
    const { session, canal } = await canalDeOutrem()
    await session
      .send(canal, { t: "role.define", role: "chefe", name: "Chefe", powers: ["expulsar"], position: 0, removed: false, definedAt: 1 })
      .catch(() => {})
    expect(session.rolesOf(canal)).toEqual([])
  }, 60_000)

  it("num canal que é nosso, o que publicamos fica gravado e vale", async () => {
    const { vault, session, address } = await offlineSession()
    const canal = session.feedChannel
    await session.createSpaceChannel(canal).catch(() => {})
    await vault.update((contents) => {
      contents.channelFounder[canal] = { address, seq: 1 }
    })

    await session.defineRole(canal, { role: "porteiro", name: "Porteiro", powers: ["convidar"] }).catch(() => {})
    await session.assignRoles(canal, "@amigo:teste", ["porteiro"]).catch(() => {})

    expect(session.rolesOf(canal).map((papel) => papel.name)).toEqual(["Porteiro"])
    expect(session.rolesFor(canal, "@amigo:teste")).toEqual(["porteiro"])
    const base = POWERS.filter((poder) => PODERES_DE_TODOS_POR_OMISSAO.includes(poder))
    expect(session.powersOf(canal, "@amigo:teste")).toEqual(POWERS.filter((poder) => poder === "convidar" || base.includes(poder)))
    // Inviting is convention: the friend's role does not stop them from anything
    // on their side, and what the power does here is decide what THIS client
    // publishes.
    expect(session.powersOf(canal, "@estranho:teste")).toEqual(base)
  }, 60_000)

  it("a cor de um papel grava-se e volta a ler-se; um papel sem cor não ganha nenhuma", async () => {
    const { vault, session, address } = await offlineSession()
    const canal = session.feedChannel
    await session.createSpaceChannel(canal).catch(() => {})
    await vault.update((contents) => {
      contents.channelFounder[canal] = { address, seq: 1 }
    })

    await session.defineRole(canal, { role: "guarda", name: "Guarda", powers: [], colour: "menta" }).catch(() => {})
    await session.defineRole(canal, { role: "convidado", name: "Convidado", powers: [] }).catch(() => {})

    const papeis = session.rolesOf(canal)
    expect(papeis.find((papel) => papel.role === "guarda")?.colour).toBe("menta")
    // Absence, not a default color: a role without a color must continue to read exactly as it did before this field existed.
    expect(papeis.find((papel) => papel.role === "convidado")).not.toHaveProperty("colour")
  }, 60_000)

  it("uma cor por inventar não sai daqui, e não leva o papel com ela", async () => {
    const { vault, session, address } = await offlineSession()
    const canal = session.feedChannel
    await session.createSpaceChannel(canal).catch(() => {})
    await vault.update((contents) => {
      contents.channelFounder[canal] = { address, seq: 1 }
    })

    // A modified client, or a future version whose color name we don't recognize. The role must survive intact, it carries the name and responsibilities. What is lost is the color, and that is all we can afford to lose.
    await session.defineRole(canal, { role: "chefe", name: "Chefe", powers: ["convidar"], colour: "cobalto" }).catch(() => {})

    const papel = session.rolesOf(canal).find((actual) => actual.role === "chefe")
    expect(papel?.name).toBe("Chefe")
    expect(papel?.powers).toEqual(["convidar"])
    expect(papel).not.toHaveProperty("colour")
  }, 60_000)

  it("um cofre gravado antes dos papéis continua a saber quem administra", async () => {
    const { vault, session, address, canal } = await canalDeOutrem()
    // The old format: a list of addresses, nothing else.
    await vault.update((contents) => {
      contents.channelAdmins[canal] = [address]
    })
    expect(session.rolesFor(canal, address)).toEqual(["admin"])
    expect(session.powersOf(canal, address)).toEqual([...POWERS])
    expect(session.mayManageRoles(canal)).toBe(true)

    // The first new nomination for that person overrides the old list, otherwise removing someone wouldn't stick: the old entry would resurrect them.
    await vault.update((contents) => {
      contents.channelMemberRoles[canal] = { [address]: [] }
    })
    expect(session.rolesFor(canal, address)).toEqual([])
    expect(session.adminsOf(canal)).toEqual([])
  }, 60_000)

  /**
   * Inviting is a deliberate act; filling a seat is not.
   *
   * The same `invite` serves both, and spending the guard on both would break
   * what keeps channels alive: `seat` and handling reentry requests restore
   * who should already be there, and run on any member. If only the inviter
   * could seat someone, the common room would stop healing itself.
   */
  it("convidar pede a responsabilidade; reparar um lugar continua a ser de qualquer membro", async () => {
    const { session, canal } = await canalDeOutrem()
    await expect(session.invite(canal, "@alguem:teste")).rejects.toThrow("you may not invite in this channel")
    await expect(session.createInvite(canal)).rejects.toThrow("you may not invite in this channel")
    // `seat` fails due to no connection, not lack of authorization.
    await expect(session.seat(canal, "@alguem:teste")).rejects.not.toThrow("you may not invite in this channel")
  }, 60_000)

  /**
   * `invite.redeem` is local to one server. An invite from another is not sent
   * to ours: that would tell it the hash of a secret that is not its own. The
   * interface refuses earlier, with a better message; this is the floor, for
   * any host.
   */
  it("um convite de outro servidor não chega a sair daqui", async () => {
    const { session, address } = await canalDeOutrem()
    const meu = address.slice(address.indexOf(":") + 1)
    const codigo = "AbCdEfGhIjKlMnOpQrStUvWxYz012345"
    const salaDeFora = moradaNova(parseServerName("outro.servidor.pt"))
    const salaDeCasa = moradaNova(parseServerName(meu))

    await expect(session.redeemInvite(formatInviteLink("outro.servidor.pt", salaDeFora, codigo))).rejects.toThrow(
      "that invite is from another server",
    )
    await expect(session.redeemInvite(`enclave://join/outro.servidor.pt/${encodeURIComponent("!x:y")}#${codigo}`)).rejects.toThrow(
      "that invite is from another server",
    )
    // From ours, in both forms, the guard passes through: it fails later, due to
    // no connection, not because it came from outside.
    await expect(session.redeemInvite(formatInviteLink(meu, salaDeCasa, codigo))).rejects.not.toThrow(/that invite is from another server|that is not a valid invite link/)
    await expect(session.redeemInvite(`enclave://join/${meu}/${encodeURIComponent(salaDeCasa)}#${codigo}`)).rejects.not.toThrow(
      /that invite is from another server|that is not a valid invite link/,
    )
  }, 60_000)

  it("o papel embutido não se redefine: um 'admin' sem poderes destituía toda a gente", async () => {
    const { session, canal } = await canalDeOutrem()
    // In another's channel the guard for managing roles comes first. The old
    // `/admin/i` caught both messages ("administers" and "admin"); the keys
    // separate them, and either one is a refusal.
    await expect(session.defineRole(canal, { role: "admin", name: "Chefe", powers: [] })).rejects.toThrow(
      /the admin role is built in|only an administrator may manage roles/,
    )
  }, 60_000)
})

/**
 * Rooms within a channel.
 *
 * A room is not a cryptographic group: it is a partition within the channel's
 * group, and the `room` label on messages is what separates them. Everyone in
 * the channel has the keys to all rooms, hiding a room is organization, not
 * security, and the only real separation remains membership in the group.
 */
describe("salas de um canal", () => {
  it("um canal sem salas declaradas não tem nenhuma", async () => {
    const { session } = await offlineSession()
    expect(session.roomsOf(session.feedChannel)).toEqual([])
  }, 60_000)

  it("ordena por categoria, depois por posição, depois por nome", async () => {
    const { vault, session } = await offlineSession()
    const canal = session.feedChannel
    await vault.update((contents) => {
      contents.channelRooms[canal] = {
        b: { at: 1, payload: { t: "channel.meta", room: "b", name: "Beta", category: "Zona", position: 1 } },
        a: { at: 1, payload: { t: "channel.meta", room: "a", name: "Alfa", category: "Zona", position: 0 } },
        v: { at: 1, payload: { t: "channel.meta", room: "v", name: "Voz", category: "Apoio", kind: "voice" } },
      }
    })
    expect(session.roomsOf(canal).map((s) => s.name)).toEqual(["Voz", "Alfa", "Beta"])
    expect(session.roomsOf(canal)[0]?.kind).toBe("voice")
  }, 60_000)

  /**
   * Anyone joining a channel must receive the rooms again.
   *
   * Rooms were declared in an earlier epoch, and newcomers don't have its
   * keys, forward secrecy working. Without republishing, the person joins
   * and sees the channel and nothing else: no text rooms, no voice rooms, no
   * categories. An empty place where others are talking.
   *
   * It is the same flaw that profiles had and that was already solved two
   * lines from here, rooms were left out.
   */
  it("republicar manda outra vez todas as salas, incluindo as fechadas", async () => {
    const { vault, session } = await offlineSession()
    const canal = moradaNova()
    // A real group: republishing requires membership and organize permissions, and both are checked against the group state.
    await session.createSpaceChannel(canal).catch(() => {})
    await vault.update((contents) => {
      contents.channelRooms[canal] = {
        a: { at: 1, payload: { t: "channel.meta", room: "a", name: "Alfa" } },
        f: { at: 1, payload: { t: "channel.meta", room: "f", name: "Fechada", closed: true } },
      }
    })

    const enviadas: Record<string, unknown>[] = []
    const original = session.send.bind(session)
    session.send = async (destino: string, payload: Record<string, unknown>): Promise<void> => {
      enviadas.push(payload)
    }
    // Rooms come in batch (slow-on-entry): they show up there as well.
    const emLote = session.sendBatch.bind(session)
    session.sendBatch = async (destino: string, payloads: readonly Record<string, unknown>[]): Promise<void> => {
      enviadas.push(...payloads)
    }
    await session.republishRooms(canal)
    session.send = original
    session.sendBatch = emLote

    // The closed one comes too: newcomers must receive the current state of the room, not a version without the decisions made in the meantime.
    expect(enviadas.map((p) => p.room).sort()).toEqual(["a", "f"])
    expect(enviadas.find((p) => p.room === "f")?.closed).toBe(true)
  }, 60_000)

  it("uma sala fechada deixa de aparecer, sem apagar o que lá foi dito", async () => {
    const { vault, session } = await offlineSession()
    const canal = session.feedChannel
    await vault.update((contents) => {
      contents.channelRooms[canal] = {
        x: { at: 1, payload: { t: "channel.meta", room: "x", name: "Antiga", closed: true } },
      }
    })
    expect(session.roomsOf(canal)).toEqual([])
  }, 60_000)

  /**
   * The default room closes but is never deleted. Product invariant.
   *
   * Not caution: it harbors everything said before rooms existed, it is where
   * any message without a label falls, and, since deletion exists, it is
   * where messages from a deleted room now appear. Deleting it would pull the
   * ground out from all three cases, and the last one because of the very act
   * that would delete it.
   *
   * The guard lives in the core, not in the screen that hides the button: a
   * screen only decides what it offers, and the bridge is callable by any
   * client.
   */
  it("a sala por omissão não se elimina, por muito que quem administra peça", async () => {
    const { session } = await offlineSession()
    const canal = session.feedChannel
    await session.createSpaceChannel(canal).catch(() => {})

    await expect(session.upsertRoom(canal, { room: "", name: "geral", removed: true })).rejects.toThrow(
      "the default room cannot be deleted",
    )
    /*
      And closing remains possible, the owner asked for it.

      Without a connection, `send` breaks after the guards, because this is an
      offline session. What we check here is that the refusal is NOT from the
      invariant: closing made it through the guards and died on the network,
      which is the opposite of being blocked by rule.
    */
    await expect(session.upsertRoom(canal, { room: "", name: "geral", closed: true })).rejects.not.toThrow(
      "the default room cannot be deleted",
    )
  }, 60_000)

  /**
   * The QUESTION ROOM is not declared: the identifier is reserved.
   *
   * A channel's room list comes from `channel.meta` messages from other
   * members, so it is one of two remote paths where an arbitrary room identifier
   * enters (the other is `voice.move`). A room declared with the sentinel name
   * would have people announcing themselves with `room: "?quem"`, and on a
   * victim running 0.3.3 in the same room those announcements read as the
   * goodbye that the sentinel exists to prevent.
   */
  it("a sala da pergunta não se declara, porque o identificador é reservado", async () => {
    const { session } = await offlineSession()
    const canal = session.feedChannel
    await session.createSpaceChannel(canal).catch(() => {})

    await expect(session.upsertRoom(canal, { room: SALA_DA_PERGUNTA, name: "Quem está" })).rejects.toThrow(
      "that room id is reserved",
    )
    // And the contrast, by the same mechanics of the default room test: a real
    // room makes it through the guards and dies on the network, which is the
    // opposite of being blocked by rule.
    await expect(session.upsertRoom(canal, { room: "forum-sala-boa", name: "Boa" })).rejects.not.toThrow(
      "that room id is reserved",
    )
  }, 60_000)

  it("uma sala eliminada sai das duas listas, e não se oferece para reabrir", async () => {
    const { vault, session } = await offlineSession()
    const canal = session.feedChannel
    await session.createSpaceChannel(canal).catch(() => {})
    await vault.update((contents) => {
      contents.channelRooms[canal] = {
        viva: { at: 1, payload: { t: "channel.meta", room: "viva", name: "Viva" } },
        morta: { at: 2, payload: { t: "channel.meta", room: "morta", name: "Morta", closed: true, removed: true } },
      }
    })
    expect(session.roomsOf(canal).map((sala) => sala.room)).toEqual(["viva"])
    // The departure stays recorded, it is the tombstone, and it prevents
    // resurrection, but it does not count as a closed room, because there is
    // nothing to reopen.
    expect(session.closedRoomsOf(canal)).toEqual([])
  }, 60_000)

  it("só quem administra pode organizar as salas", async () => {
    const { vault, session } = await offlineSession()
    const canal = session.feedChannel
    await session.createSpaceChannel(canal).catch(() => {})
    await vault.update((contents) => {
      contents.channelFounder[canal] = { address: "@outra:teste", seq: 1 }
    })
    await expect(session.upsertRoom(canal, { room: "nova", name: "Nova" })).rejects.toThrow("only an administrator may edit this channel")
  }, 60_000)

  /**
   * A channel is born explained.
   *
   * A single channel, the empty one, which the interface calls "general",    * says nothing to newcomers. Three say something: a place for what is not
   * discussed, one for conversation, one for talking out loud.
   */
  it("um canal nasce com três salas, ao lado da sala por omissão", async () => {
    const { session } = await offlineSession()
    const canal = session.feedChannel
    await session.createSpace(canal).catch(() => {})

    const salas = session.roomsOf(canal)
    expect(salas.map((sala) => sala.name)).toEqual(["anúncios", "conversa", "voz"])
    expect(salas.map((sala) => sala.kind)).toEqual(["text", "text", "voice"])
    // The identifier says the type, and none of them is the default channel: that remains the empty one, which does not declare itself to exist.
    expect(salas.every((sala) => sala.room.startsWith("forum-") || sala.room.startsWith("contio-"))).toBe(true)
    expect(salas.some((sala) => sala.room === "")).toBe(false)
  }, 60_000)

  it("anúncios é um canal de texto com nome, e não um tipo novo", async () => {
    // Only `text` and `voice` exist. Making up a third type now would make something no other client knows how to read.
    const { session } = await offlineSession()
    await session.createSpace(session.feedChannel).catch(() => {})
    const anuncios = session.roomsOf(session.feedChannel).find((sala) => sala.name === "anúncios")
    expect(anuncios?.kind).toBe("text")
  }, 60_000)

  it("uma conversa directa não nasce com canais lá dentro", async () => {
    // `createSpaceChannel` is still what creates only the group: that is what serves the feed, direct conversations, and the common room, and none of them want it.
    const { session, vault } = await offlineSession()
    const canal = canalComFicha(vault.contents, { tipo: "directa" })
    await session.createSpaceChannel(canal).catch(() => {})
    expect(session.roomsOf(canal)).toEqual([])
  }, 60_000)
})

/**
 * The default room closes, and closing is hiding, never destroying.
 *
 * It is the one with an empty identifier, and it is not a real room: it is the
 * `room` field that ALL messages before rooms had, meaning the entire history
 * before this idea. Migration was spared because it was empty, and that is why
 * a slip here costs dearly.
 *
 * What is fixed here is what the owner asked for word for word: closing removes
 * it from the list, what was there stays in the vault, and reopening returns
 * it with everything.
 */
describe("a sala por omissão fecha-se sem levar o histórico atrás", () => {
  /** A message like those before rooms: no `room` field. */
  const semSala = (seq: number, corpo: string): StoredChatMessage => ({
    seq,
    sender: "@abc:localhost",
    at: seq,
    payload: { t: "message", id: `antiga-${seq}`, sentAt: seq, body: corpo, attachments: [], mentions: [] },
  })

  it("fechada sai da lista, reaberta volta, e o que lá foi dito nunca se mexe", async () => {
    const { vault, session } = await offlineSession()
    const canal = session.feedChannel

    // Before: years of conversation, all of it without a room.
    await vault.update((contents) => {
      contents.history[canal] = [semSala(1, "a primeira de todas"), semSala(2, "e outra qualquer")]
    })
    const antes = session.history(canal)
    expect(antes).toHaveLength(2)

    // Closing: publish `channel.meta` with the EMPTY identifier, which is what makes it a room like the others instead of an exception.
    await vault.update((contents) => {
      contents.channelRooms[canal] = {
        "": { at: 10, payload: { t: "channel.meta", room: "", name: "geral", closed: true } },
      }
    })
    expect(session.roomsOf(canal).some((sala) => sala.room === "")).toBe(false)
    expect(session.closedRoomsOf(canal).map((sala) => sala.room)).toEqual([""])
    // The whole point: hiding is not erasing.
    expect(session.history(canal)).toEqual(antes)

    // And a new message without a room still has a place to go while it is closed, otherwise closing would shut down the channel.
    await vault.update((contents) => {
      contents.history[canal]?.push(semSala(3, "chegou com ela fechada"))
    })
    expect(session.history(canal)).toHaveLength(3)

    // Reopening: the opposite published on top, with a newer timestamp.
    await vault.update((contents) => {
      const doCanal = contents.channelRooms[canal]
      if (doCanal) doCanal[""] = { at: 11, payload: { t: "channel.meta", room: "", name: "recepção", closed: false } }
    })
    const reaberta = session.roomsOf(canal).find((sala) => sala.room === "")
    expect(reaberta?.name).toBe("recepção")
    expect(session.closedRoomsOf(canal)).toEqual([])
    // And there it all is: the two from before and the one that arrived while it was closed.
    expect(session.history(canal).map((m) => m.payload.body)).toEqual([
      "a primeira de todas",
      "e outra qualquer",
      "chegou com ela fechada",
    ])
  }, 60_000)

  it("dar-lhe nome próprio não a transforma noutra sala", async () => {
    // The identifier is what ties messages to the room. If renaming changed the identifier, renaming "general" would lose the entire history at once.
    const { vault, session } = await offlineSession()
    const canal = session.feedChannel
    await vault.update((contents) => {
      contents.channelRooms[canal] = {
        "": { at: 5, payload: { t: "channel.meta", room: "", name: "recepção" } },
      }
    })
    const salas = session.roomsOf(canal)
    expect(salas).toHaveLength(1)
    expect(salas[0]?.room).toBe("")
    expect(salas[0]?.name).toBe("recepção")
  }, 60_000)
})

/**
 * Likes and comments: where they go and where they are stored.
 *
 * The two things this test covers are discovered too late. First: the vote
 * travels to the feed of WHO PUBLISHED it, not ours, that is where the people
 * who read it are, and that is where the count must appear. Second: it is
 * recorded in the vault like any message, otherwise reloading the app would
 * leave the post standing and likes and comments gone, the kind of glitch that
 * gets blamed on the network and never gets fixed.
 */
describe("gostos e comentários numa publicação", () => {
  it("seguem para o feed de quem publicou e ficam no histórico", async () => {
    const { session, vault } = await offlineSession()
    // Another person's feed, which this account reads.
    const feedAlheio = canalComFicha(vault.contents, { tipo: "mural", dono: "@outra:localhost:8448" })
    await session.createSpaceChannel(feedAlheio).catch(() => {})

    // Offline: the payload is encrypted and stored, and sending breaks after that.
    await session.reactToPost(feedAlheio, "publicacao-0001", "👍").catch(() => {})
    await session.commentOnPost(feedAlheio, "publicacao-0001", "muito bom").catch(() => {})

    const historico = session.history(feedAlheio)
    expect(historico.map((entrada) => entrada.payload.t)).toEqual(["post.reaction", "post.comment"])
    expect(historico[0]?.payload).toMatchObject({ target: "publicacao-0001", emoji: "👍", remove: false })
    // The timestamp decides each person's most recent vote.
    expect(historico[0]?.at).toBeGreaterThan(0)
    expect(historico[1]?.payload).toMatchObject({ target: "publicacao-0001", body: "muito bom" })

    // And none of this ended up in our own feed.
    expect(session.history(session.feedChannel)).toEqual([])
  }, 60_000)

  it("retirar um gosto é uma mensagem, e não a falta de uma", async () => {
    const { session } = await offlineSession()
    const canal = session.feedChannel
    await session.createSpaceChannel(canal).catch(() => {})

    await session.reactToPost(canal, "publicacao-0001", "👍", true).catch(() => {})
    expect(session.history(canal)[0]?.payload).toMatchObject({ remove: true })
  }, 60_000)

  it("uma publicação leva o título que lhe foi dado, e só quando lho deram", async () => {
    const { session } = await offlineSession()
    await session.createSpaceChannel(session.feedChannel).catch(() => {})

    await session.post("com nome", [], { title: "  Serra de São Mamede  " }).catch(() => {})
    await session.post("sem nome", [], { title: "   " }).catch(() => {})

    const historico = session.history(session.feedChannel)
    expect(historico[0]?.payload).toMatchObject({ title: "Serra de São Mamede" })
    expect(historico[1]?.payload).not.toHaveProperty("title")
  }, 60_000)
})

/**
 * Mutual friendship, from the server side.
 *
 * What is proved here is what needs no network: the state comes from the vault
 * and survives restarting the app, and none of the paths that MUST NOT grant
 * access grant it. The two places themselves, which are MLS commits, and thus
 * require a key package from another person and a server to deliver it, are
 * proved with two real accounts in `scripts/e2e-amizade.mjs`.
 */
describe("amizade mútua", () => {
  const ELA = "@ela:localhost:8448"

  /**
   * The channel of a direct conversation made by hand: an opaque address with
   * the direct conversation record in the vault (1.0 "Arca", slice 6: the
   * address does not say what the channel is).
   */
  function canalDirecto(ela: string, vault: Vault): string {
    return canalComFicha(vault.contents, { tipo: "directa", par: ela })
  }

  /** An open direct conversation and a request for it waiting for a response. */
  async function comPedidoDela(): Promise<{
    vault: Vault
    session: Session
    address: string
    dm: string
  }> {
    const { vault, session, address } = await offlineSession()
    const dm = canalDirecto(ELA, vault)
    await session.createSpaceChannel(session.feedChannel).catch(() => {})
    await session.createSpaceChannel(dm).catch(() => {})
    await vault.update((contents) => {
      contents.history[dm] = [{ seq: 1, sender: ELA, at: 1, payload: { t: "friend.request", sentAt: 1 } }]
    })
    return { vault, session, address, dm }
  }

  it("um pedido por responder é isso mesmo, e sobrevive a reabrir a aplicação", async () => {
    const { vault, session, address } = await comPedidoDela()
    expect(session.openFriendRequests().map((tie) => tie.peer)).toEqual([ELA])

    // Same vault, fresh session: this is the case that matters, because an acceptance almost always arrives when the app is closed.
    const outra = new Session(vault)
    outra.loadIdentity()
    expect(outra.identity.address).toBe(address)
    expect(outra.openFriendRequests().map((tie) => tie.peer)).toEqual([ELA])
  }, 60_000)

  /**
   * A ledger entry that was published: what the vault keeps after the server echo.
   *
   * No connection, since 20/10/2026 (F2), the ledger does not save: see "a rejection with no connection closes nothing" below. These tests measure the fold over what was saved, so they record it as the echo would, with real `seq`.
   */
  async function comoEnviado(vault: Vault, dm: string, sender: string, payload: Payload, seq: number): Promise<void> {
    await vault.update((contents) => {
      ;(contents.history[dm] ??= []).push({ seq, sender, at: seq, payload: payload as never })
    })
  }

  it("uma recusa sem ligação não fecha nada, e o pedido continua por responder", async () => {
    const { session, dm } = await comPedidoDela()
    await expect(session.declineFriend(dm)).rejects.toThrow("no connection to the server")
    expect(session.friendTies().get(ELA)?.link).toBe("pedido-recebido")
    expect(session.openFriendRequests().map((tie) => tie.peer)).toEqual([ELA])
  }, 60_000)

  it("recusar fecha o pedido e não dá lugar nenhum", async () => {
    const { vault, session, dm } = await comPedidoDela()
    const feed = session.feedChannel

    await comoEnviado(vault, dm, session.identity.address, { t: "friend.decline", declinedAt: 2 }, 2)

    // No friendship, no request rotting on the screen, and above all no seat.
    expect(session.openFriendRequests()).toEqual([])
    expect(session.friendTies().get(ELA)?.link).toBe("nenhum")
    expect(session.membersOf(feed).map(String)).not.toContain(ELA)
  }, 60_000)

  it("recusar não impede um pedido novo mais tarde", async () => {
    // A rejected request that blocked forever was the hidden cost of having a reject button: whoever was rejected could not ask again.
    const { vault, session, dm } = await comPedidoDela()
    await comoEnviado(vault, dm, session.identity.address, { t: "friend.decline", declinedAt: 2 }, 2)
    await comoEnviado(vault, dm, session.identity.address, { t: "friend.request", sentAt: 3 }, 3)

    expect(session.history(dm).filter((m) => m.payload.t === "friend.request")).toHaveLength(2)
    expect(session.friendTies().get(ELA)?.link).toBe("pedido-enviado")
  }, 60_000)

  it("uma aceitação que ninguém pediu não vale um lugar", async () => {
    const { vault, session } = await offlineSession()
    const { address } = session.identity
    const dm = canalDirecto(ELA, vault)
    await session.createSpaceChannel(session.feedChannel).catch(() => {})
    await session.createSpaceChannel(dm).catch(() => {})

    // A message on the thread, with no request behind it. If it counted, the next reconnection would seat this person in our feed.
    await vault.update((contents) => {
      contents.history[dm] = [{ seq: 1, sender: ELA, at: 1, payload: { t: "friend.accept", acceptedAt: 1 } }]
    })

    expect(session.friendTies().get(ELA)?.link).toBe("nenhum")
    await session.syncFriendships()
    expect(vault.contents.repairAttempts[`${ELA}|${session.feedChannel}`]).toBeUndefined()
    expect(session.membersOf(session.feedChannel).map(String)).not.toContain(ELA)
  }, 60_000)

  /*
    The direct chat, repaired as a feed.
    
    In production (18 October 2026) there were four direct conversations with only one person registered on the server: the other side lost their seat and no action restored it, because `repairInvite` only ran on feeds. Friendship requests travel inside the direct chat, so everything fell together, in silence.
    */
  it("uma directa onde o par não tem lugar é reparada na sincronização, como um feed", async () => {
    const { vault, session, address } = await offlineSession()
    const dm = canalDirecto(ELA, vault)
    await session.createSpaceChannel(session.feedChannel).catch(() => {})
    await session.createSpaceChannel(dm).catch(() => {})
    await vault.update((contents) => {
      contents.history[dm] = [{ seq: 1, sender: address, at: 1, payload: { t: "friend.request", sentAt: 1 } }]
    })
    expect(session.friendTies().get(ELA)?.link).toBe("pedido-enviado")

    const reparacoes = vi.spyOn(session, "repairInvite").mockResolvedValue("invited")
    await session.syncFriendships()

    expect(session.channels).toContain(dm)
    expect(reparacoes.mock.calls.map(([canal, quem]) => [canal, quem])).toContainEqual([dm, ELA])
  }, 60_000)

  it("uma directa aberta sem pedido de amizade também é reparada", async () => {
    const { vault, session, address } = await offlineSession()
    const dm = canalDirecto(ELA, vault)
    await session.createSpaceChannel(session.feedChannel).catch(() => {})
    await session.createSpaceChannel(dm).catch(() => {})
    expect(session.friendTies().get(ELA)).toBeUndefined()

    const reparacoes = vi.spyOn(session, "repairInvite").mockResolvedValue("invited")
    await session.syncFriendships()

    expect(reparacoes.mock.calls.map(([canal, quem]) => [canal, quem])).toContainEqual([dm, ELA])
  }, 60_000)

  it("uma directa de uma amizade desfeita não repõe ninguém", async () => {
    const { vault, session, address } = await offlineSession()
    const dm = canalDirecto(ELA, vault)
    await session.createSpaceChannel(session.feedChannel).catch(() => {})
    await session.createSpaceChannel(dm).catch(() => {})
    await vault.update((contents) => {
      contents.history[dm] = [
        { seq: 1, sender: address, at: 1, payload: { t: "friend.request", sentAt: 1 } },
        { seq: 2, sender: ELA, at: 2, payload: { t: "friend.accept", acceptedAt: 2 } },
        { seq: 3, sender: address, at: 3, payload: { t: "friend.remove", removedAt: 3 } },
      ]
    })
    expect(session.friendTies().get(ELA)?.severed).toBe(true)

    const reparacoes = vi.spyOn(session, "repairInvite").mockResolvedValue("invited")
    await session.syncFriendships()

    expect(session.channels).toContain(dm)
    expect(reparacoes.mock.calls.map(([canal]) => canal)).not.toContain(dm)
  }, 60_000)

  it("pedir a quem já nos pediu é aceitar, e não um segundo pedido", async () => {
    const { session, dm } = await comPedidoDela()

    // Without network the acceptance does not seat anyone, and it is exactly why you see this was the acceptance path: it fails to give the seat, instead of writing a second request.
    await session.sendFriendRequest(dm).catch(() => {})

    expect(session.history(dm).filter((m) => m.payload.t === "friend.request")).toHaveLength(1)
    expect(session.openFriendRequests().map((tie) => tie.peer)).toEqual([ELA])
  }, 60_000)

  it("desfazer a amizade pede o corte do outro lado e não a refaz sozinha", async () => {
    const { vault, session, dm } = await comPedidoDela()
    // As if the friendship had been made: their request, and our acceptance.
    await vault.update((contents) => {
      contents.history[dm]?.push({
        seq: 2,
        sender: session.identity.address,
        at: 2,
        payload: { t: "friend.accept", acceptedAt: 2 },
      })
    })
    expect(session.friendTies().get(ELA)?.link).toBe("amigos")

    // Without connection, the removal does not go out and is not saved (F2): the friendship continues, and that is what the screen must say, instead of a removal that never happened.
    await expect(session.unfriend(ELA)).rejects.toThrow("no connection to the server")
    expect(session.friendTies().get(ELA)?.link).toBe("amigos")

    // The removal request goes out, so their client can remove our seat from their feed: the seat that is not in our reach. Here, as if it had gone out.
    await comoEnviado(vault, dm, session.identity.address, { t: "friend.remove", removedAt: 3 }, 3)
    expect(session.friendTies().get(ELA)?.link).toBe("nenhum")

    /**
     * And reconciliation does not remake it.
     *
     * It is the half that forgets: reconciliation runs at each reconnection and reseat anyone it thinks is a friend. If it read only the acceptances, which stay in the history because they happened, it would reseat this person in our feed minutes after someone removed them, with nothing on the screen to say it.
     */
    await session.syncFriendships()
    expect(vault.contents.repairAttempts[`${ELA}|${session.feedChannel}`]).toBeUndefined()
    expect(session.membersOf(session.feedChannel).map(String)).not.toContain(ELA)
  }, 60_000)
})

/**
 * The account is two keys, and the vault keeps both.
 *
 * The device key must survive restart for a hard reason: the MLS sheets already published are signed by it. Minting another at each startup would make the same account present itself as a different device every time, new key packages with one key, old groups with another, and the chain would not close against what the tree already has.
 *
 * The address cannot depend on the device: it is the hash of the account key, and it is where foundation, papers, friendships and admin lists hang.
 *
 * ⚠️ The three tests in this block were the only ones in the file without a written timeout, and they were why they turned red with a full machine, passing in eight seconds alone. It was not a fault in what they measure: each one did `vault.create()`, which ran Argon2id of 64 MiB for 1.5 s of CPU, and the default vitest timeout is 5 s. With another suite beside it fighting for memory and cache, 1.5 s became thirty and the whole file went from 8 s to over four minutes. Two things changed, and they are independent of each other:
 *
 *   1. the KDF became the cheap replacement of `testes/kdf-de-teste.ts`, which keeps everything these tests measure, each `createIdentity` still generates keys for real, and drops the cost that none of them measured;
 *   2. the timeouts became WRITTEN, like the other 52 tests in this file. A default timeout is a timeout nobody chose.
 *
 * The timeout is `60_000` and not `5_000` on purpose: it is not to fit snugly on a fast machine, it is to never let the machine decide the test color.
 */
describe("Session: conta e aparelho", () => {
  it("guarda as duas chaves, distintas, e o endereço é o da conta", async () => {
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")

    const session = new Session(vault)
    const identidade = await session.createIdentity("localhost:8448")

    expect(vault.contents.signingPrivateKey).not.toBe("")
    expect(vault.contents.deviceSigningPrivateKey).not.toBe("")
    expect(vault.contents.deviceSigningPrivateKey).not.toBe(vault.contents.signingPrivateKey)
    expect(identidade.address).toContain(identidade.accountId)
  }, 60_000)

  it("reabrir a aplicação devolve o MESMO aparelho, não um novo", async () => {
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")

    const primeira = new Session(vault)
    const nascida = await primeira.createIdentity("localhost:8448")

    const segunda = new Session(vault)
    const relida = segunda.loadIdentity()

    expect(relida.address).toBe(nascida.address)
    expect(relida.signingPublicKey).toEqual(nascida.signingPublicKey)
    expect(relida.deviceSigningPublicKey).toEqual(nascida.deviceSigningPublicKey)
    // The chain is deterministic, so the credential bytes are the same: that is what makes today's sheet still be yesterday's sheet.
    expect(relida.credential.signature).toEqual(nascida.credential.signature)
  }, 60_000)

  it("um cofre sem chave de aparelho recebe uma, e guarda-a", async () => {
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")

    const session = new Session(vault)
    await session.createIdentity("localhost:8448")
    await vault.update((contents) => {
      contents.deviceSigningPrivateKey = ""
    })

    const outra = new Session(vault)
    const identidade = outra.loadIdentity()
    expect(vault.contents.deviceSigningPrivateKey).not.toBe("")

    // And the one that was saved is the one the identity is using, or the next startup would bring another, and another, and no sheet would be good from one to the next.
    const terceira = new Session(vault)
    expect(terceira.loadIdentity().deviceSigningPublicKey).toEqual(identidade.deviceSigningPublicKey)
  }, 60_000)
})
