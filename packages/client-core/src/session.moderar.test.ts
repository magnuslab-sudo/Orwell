import { describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { appendHistory, Vault, type VaultBackend } from "./vault.js"
import { canalComFicha, moradaNova } from "../testes/moradas.js"

/**
 * The `moderate` power in the core (phase 3 of 0.9).
 *
 * We measure the guard of who SENDS: what this account can request. The other half,
 * what the reader accepts, is in the folds (`dobras.test.ts`, `tickets.test.ts`).
 * No network: the send fails after the guard, and that is the stopping point.
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

const ANA = "@ana:localhost:8448"

/** A channel of another person (the room is owned by Owner), with a message from Ana in the vault. */
async function canalDeOutrem(): Promise<{ vault: Vault; session: Session; address: string; canal: string }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  const { address } = await session.createIdentity("localhost:8448")
  const canal = moradaNova()
  await session.createSpaceChannel(canal).catch(() => {})
  await vault.update((contents) => {
    contents.channelFounder[canal] = { address: "@dona:localhost:8448", seq: 1 }
    appendHistory(contents, canal, {
      seq: 1,
      sender: ANA,
      at: 1,
      payload: { t: "message", id: "m-da-ana", sentAt: 1, body: "olá", attachments: [], links: [], mentions: [] },
    })
  })
  return { vault, session, address, canal }
}

/** Saves a role and gives it to this account, as if it had arrived over the network. */
async function comCargo(vault: Vault, canal: string, address: string, powers: string[]): Promise<void> {
  await vault.update((contents) => {
    contents.channelRoles[canal] = {
      cargo: {
        at: 1,
        payload: { t: "role.define", role: "cargo", name: "Cargo", powers, position: 0, removed: false, definedAt: 1 },
      },
    }
    contents.channelMemberRoles[canal] = { [address]: ["cargo"] }
  })
}

describe("moderar: eliminar a mensagem de outra pessoa", () => {
  it("sem o poder, a guarda recusa", async () => {
    const { vault, session, address, canal } = await canalDeOutrem()
    await comCargo(vault, canal, address, ["fixar"])
    expect(session.mayModerate(canal)).toBe(false)
    await expect(session.deleteMessage(canal, "m-da-ana")).rejects.toThrow(
      "only the author or a moderator may delete this message",
    )
  }, 60_000)

  it("com o poder, a guarda deixa passar (e o envio falha por não haver ligação)", async () => {
    const { vault, session, address, canal } = await canalDeOutrem()
    await comCargo(vault, canal, address, ["moderar"])
    expect(session.mayModerate(canal)).toBe(true)
    expect(session.mayModerate(canal, ANA)).toBe(false)
    await expect(session.deleteMessage(canal, "m-da-ana")).rejects.not.toThrow(
      "only the author or a moderator may delete this message",
    )
  }, 60_000)

  it("uma mensagem que o cofre não conhece passa: a lápide é um pedido, e quem lê julga", async () => {
    const { session, canal } = await canalDeOutrem()
    await expect(session.deleteMessage(canal, "m-acabada-de-enviar")).rejects.not.toThrow(
      "only the author or a moderator may delete this message",
    )
  }, 60_000)

  it("numa conversa directa ninguém modera, mesmo sem fundação", async () => {
    const { session, address, vault } = await canalDeOutrem()
    // The record says it is a direct (the opaque address says nothing).
    const dm = canalComFicha(vault.contents, { tipo: "directa" })
    expect(session.mayModerate(dm, address)).toBe(false)
  }, 60_000)
})

describe("moderar: eliminar um ticket", () => {
  /** An Ana ticket in the ticket room, open or already closed. */
  async function comTicket(vault: Vault, canal: string, fechado: boolean): Promise<void> {
    await vault.update((contents) => {
      appendHistory(contents, canal, {
        seq: 2,
        sender: ANA,
        at: 2,
        payload: {
          t: "message",
          room: "forum",
          id: "m-abre",
          sentAt: 2,
          body: "Abriu um ticket: porta",
          attachments: [],
          links: [],
          mentions: [],
          ticket: { id: "t1", subject: "porta", state: "open", at: 2 },
        },
      })
      if (fechado) {
        appendHistory(contents, canal, {
          seq: 3,
          sender: ANA,
          at: 3,
          payload: {
            t: "message",
            room: "forum",
            id: "m-fecha",
            sentAt: 3,
            body: 'Fechou o ticket "porta".',
            attachments: [],
            links: [],
            mentions: [],
            ticket: { id: "t1", state: "closed", at: 3 },
          },
        })
      }
    })
  }

  it("sem o poder, recusa", async () => {
    const { vault, session, canal } = await canalDeOutrem()
    await comTicket(vault, canal, true)
    await expect(session.deleteTicket(canal, "forum", "t1")).rejects.toThrow("you may not moderate in this channel")
  }, 60_000)

  it("com o poder, um ticket aberto não se elimina", async () => {
    const { vault, session, address, canal } = await canalDeOutrem()
    await comCargo(vault, canal, address, ["moderar"])
    await comTicket(vault, canal, false)
    await expect(session.deleteTicket(canal, "forum", "t1")).rejects.toThrow("only a closed ticket can be deleted")
  }, 60_000)

  it("com o poder e o ticket fechado, a guarda deixa passar", async () => {
    const { vault, session, address, canal } = await canalDeOutrem()
    await comCargo(vault, canal, address, ["moderar"])
    await comTicket(vault, canal, true)
    const tentativa = session.deleteTicket(canal, "forum", "t1")
    await expect(tentativa).rejects.not.toThrow("only a closed ticket can be deleted")
    await expect(session.deleteTicket(canal, "forum", "t1")).rejects.not.toThrow("you may not moderate in this channel")
  }, 60_000)
})
