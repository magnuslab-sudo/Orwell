import { describe, expect, it } from "vitest"
import { INVITE_TTL_MS } from "@enclave/protocol"
import { Session } from "./session.js"
import { Vault, type StoredChatMessage, type VaultBackend } from "./vault.js"
import { canalComFicha, moradaNova } from "../testes/moradas.js"

/**
 * The invite by address, on the vault side.
 *
 * What is proved here is what can be proved without network: that the fold reads from
 * the vault and survives closing the app, and that responses refuse themselves when they
 * must refuse. That inviting no longer seats anyone, and that accepting gives the
 * place for real, is proved with two real accounts against a real homeserver, see
 * `scripts/e2e-convite.mjs`, which is where that question has an answer.
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

const SALA = moradaNova()

async function offlineSession(): Promise<{ vault: Vault; session: Session; address: string }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  const { address } = await session.createIdentity("localhost:8448")
  return { vault, session, address }
}

/**
 * A direct conversation between this account and `par`, built by hand: an
 * opaque address with the direct record in the vault (1.0 "Ark", slice 6). The address
 * does not say the peer; the record does.
 */
function dmCom(par: string, vault: Vault): string {
  return canalComFicha(vault.contents, { tipo: "directa", par })
}

function convite(sender: string, at: number, target = SALA): StoredChatMessage {
  return {
    seq: at,
    sender,
    at,
    payload: {
      t: "message",
      id: `convite-${at}`,
      sentAt: at,
      body: 'Convido-te para "Lagar do Zé".',
      attachments: [],
      mentions: [],
      invite: { channel: target, name: "Lagar do Zé", at },
    },
  }
}

function resposta(sender: string, at: number, accepted: boolean, target = SALA): StoredChatMessage {
  return {
    seq: at,
    sender,
    at,
    payload: {
      t: "message",
      id: `resposta-${at}`,
      sentAt: at,
      body: accepted ? "Aceitei." : "Não vou.",
      attachments: [],
      mentions: [],
      inviteReply: { channel: target, accepted, at },
    },
  }
}

describe("convidar não mete ninguém em lado nenhum", () => {
  it("não se convida para um canal onde não se tem lugar", async () => {
    const { session } = await offlineSession()
    await expect(session.invite(SALA, "@ela:localhost:8448")).rejects.toThrow("not a member of this channel")
  }, 60_000)

  it("convidar não pode assentar ninguém: a árvore fica como estava", async () => {
    const { session, address } = await offlineSession()
    const channel = session.feedChannel
    await session.createSpaceChannel(channel).catch(() => {})
    const antes = session.membersOf(channel)

    // Without network the message does not go out, but what is measured here is something
    // else: no path inside `invite` touches the channel tree. That is exactly what it did before,  // a place given to someone who never asked for it.
    await session.invite(channel, "@ela:localhost:8448").catch(() => {})

    expect(session.membersOf(channel)).toEqual(antes)
    expect(session.membersOf(channel)).toEqual([address])
  }, 60_000)
})

describe("a dobra dos convites lê do cofre", () => {
  it("um convite recebido aparece por responder, e sobrevive a reabrir a aplicação", async () => {
    const { vault, session, address } = await offlineSession()
    const ela = "@ela:localhost:8448"
    const dm = dmCom(ela, vault)
    await vault.update((contents) => {
      contents.history[dm] = [convite(ela, Date.now() - 1000)]
    })

    const pendentes = session.pendingChannelInvites()
    expect(pendentes).toHaveLength(1)
    expect(pendentes[0]).toMatchObject({ target: SALA, peer: ela, channel: dm, mine: false, name: "Lagar do Zé" })

    // Reopen the app: new session, same vault. An invite that only lived
    // in memory would disappear here, and it is exactly now that it matters,
    // because whoever invited can have connected by then.
    const outra = new Session(vault)
    outra.loadIdentity()
    expect(outra.pendingChannelInvites()).toHaveLength(1)
  }, 60_000)

  it("um convite nosso não é um convite por responder", async () => {
    const { vault, session, address } = await offlineSession()
    const dm = dmCom("@ela:localhost:8448", vault)
    await vault.update((contents) => {
      contents.history[dm] = [convite(address, Date.now() - 1000)]
    })
    expect(session.pendingChannelInvites()).toHaveLength(0)
    expect(session.channelInvites().size).toBe(1)
  }, 60_000)

  it("uma conversa normal não produz convite nenhum", async () => {
    const { vault, session, address } = await offlineSession()
    const dm = dmCom("@ela:localhost:8448", vault)
    await vault.update((contents) => {
      contents.history[dm] = [
        {
          seq: 1,
          sender: "@ela:localhost:8448",
          at: 1,
          payload: { t: "message", id: "m-1", sentAt: 1, body: "olá", attachments: [], mentions: [] },
        },
      ]
    })
    expect(session.channelInvites().size).toBe(0)
  }, 60_000)
})

describe("responder a um convite", () => {
  it("não se responde a um convite que não existe", async () => {
    const { session, address, vault } = await offlineSession()
    const dm = dmCom("@ela:localhost:8448", vault)
    await expect(session.acceptChannelInvite(dm, SALA)).rejects.toThrow("that invite no longer exists")
  }, 60_000)

  it("não se responde ao próprio convite", async () => {
    // Accepting the invite we made ourselves would be admitting ourselves by
    // proxy: the fold would start owing a place to someone who never said
    // anything.
    const { vault, session, address } = await offlineSession()
    const dm = dmCom("@ela:localhost:8448", vault)
    await vault.update((contents) => {
      contents.history[dm] = [convite(address, Date.now() - 1000)]
    })
    await expect(session.acceptChannelInvite(dm, SALA)).rejects.toThrow("that invite no longer exists")
  }, 60_000)

  it("um convite caducado não se aceita, e diz-se porquê", async () => {
    const { vault, session, address } = await offlineSession()
    const ela = "@ela:localhost:8448"
    const dm = dmCom(ela, vault)
    await vault.update((contents) => {
      contents.history[dm] = [convite(ela, Date.now() - INVITE_TTL_MS - 1)]
    })
    expect(session.pendingChannelInvites()).toHaveLength(0)
    await expect(session.acceptChannelInvite(dm, SALA)).rejects.toThrow("that invite expired")
  }, 60_000)

  it("responder duas vezes dá o mesmo que responder uma", async () => {
    // The second reply cannot go out: on the other side the fold discards it, and
    // here it would only write to the conversation a sentence that answers nothing.
    // `send` would break for no connection, not breaking is the proof.
    const { vault, session, address } = await offlineSession()
    const ela = "@ela:localhost:8448"
    const dm = dmCom(ela, vault)
    const agora = Date.now()
    await vault.update((contents) => {
      contents.history[dm] = [convite(ela, agora - 2000), resposta(address, agora - 1000, false)]
    })
    await expect(session.declineChannelInvite(dm, SALA)).resolves.toBeUndefined()
    await expect(session.acceptChannelInvite(dm, SALA)).resolves.toBeUndefined()

    // `resolves.toBeUndefined()` on a `Promise<void>` is true whenever the
    // promise resolves: the only thing these two lines prove is that it did not break.
    // And not breaking is satisfied by any early return, // a channel not found, a room that does not exist, one guard too many
    // above what is being measured. What this test says in its name is that the
    // second reply does NOT go out, and that is what is measured: the conversation stays with
    // the two lines it already had, and no new reply was written to it.
    expect(vault.contents.history[dm]).toHaveLength(2)
  }, 60_000)
})

describe("o lugar em dívida", () => {
  it("uma aceitação de quem convidámos deixa o lugar por dar", async () => {
    const { vault, session, address } = await offlineSession()
    const ela = "@ela:localhost:8448"
    const dm = dmCom(ela, vault)
    const agora = Date.now()
    await vault.update((contents) => {
      contents.history[dm] = [convite(address, agora - 2000), resposta(ela, agora - 1000, true)]
    })
    const tie = [...session.channelInvites().values()][0]
    expect(tie).toMatchObject({ mine: true, state: "aceite", peer: ela, target: SALA })
  }, 60_000)

  it("uma aceitação que ninguém convidou não deixa dívida nenhuma", async () => {
    // Without this guard, a sentence in the thread would buy a place: it took only
    // saying yes to an invite that never existed for this device to commit the addition.
    const { vault, session, address } = await offlineSession()
    const ela = "@ela:localhost:8448"
    const dm = dmCom(ela, vault)
    await vault.update((contents) => {
      contents.history[dm] = [resposta(ela, Date.now() - 1000, true)]
    })
    expect(session.channelInvites().size).toBe(0)
    // And reconciliation has nothing to do, so it does not break trying.
    await expect(session.syncChannelInvites()).resolves.toBeUndefined()
  }, 60_000)

  it("uma aceitação a um convite caducado também não", async () => {
    const { vault, session, address } = await offlineSession()
    const ela = "@ela:localhost:8448"
    const dm = dmCom(ela, vault)
    const velho = Date.now() - INVITE_TTL_MS - 1
    await vault.update((contents) => {
      contents.history[dm] = [convite(address, velho), resposta(ela, Date.now(), true)]
    })
    expect([...session.channelInvites().values()][0]?.state).toBe("caducado")
    await expect(session.syncChannelInvites()).resolves.toBeUndefined()
  }, 60_000)
})
