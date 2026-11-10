import { generateIdentity } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { appendHistory, ehDoLivro, HISTORY_MAX_PER_CHANNEL, LEDGER_MAX_PER_CHANNEL, mergeOlderHistory, entradasDoCanal, Vault, type StoredChatMessage, type VaultBackend } from "./vault.js"
import { canalComFicha, moradaNova, SERVIDOR_DE_TESTE } from "../testes/moradas.js"

/**
 * **The history cap does not erase friendships or invites** (F1, audit of 20/10/2026).
 *
 * The state of each friendship and each invite comes only from the vault's history, and
 * the history has a cap of 400 per channel. Until this fix the cap cut without looking: in a
 * direct with conversation, four hundred messages after accepting, the fold made
 * the person disappear, and the pair went back to "none". Reconciliation then
 * stopped guaranteeing them a place in the feed, and the interface showed them as a stranger.
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

const CASA = SERVIDOR_DE_TESTE

function mensagem(seq: number, sender: string): StoredChatMessage {
  return {
    seq,
    sender,
    at: 1_000 + seq,
    payload: { t: "message", id: `m${seq}`, body: `mensagem ${seq}`, sentAt: 1_000 + seq, attachments: [] },
  }
}

async function contaComDirecta(): Promise<{ session: Session; vault: Vault; me: string; par: string; directa: string }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  const identidade = await session.createIdentity("localhost:8448")
  const par = generateIdentity(CASA).address
  const directa = canalComFicha(vault.contents, { tipo: "directa", par })
  return { session, vault, me: identidade.address, par, directa }
}

describe("o livro das amizades e dos convites sobrevive ao tecto do histórico", () => {
  it('401 mensagens depois do aceite, o par continua "amigos"', async () => {
    const { session, vault, me, par, directa } = await contaComDirecta()
    await vault.update((contents) => {
      appendHistory(contents, directa, { seq: 1, sender: par, at: 1, payload: { t: "friend.request", sentAt: 1 } })
      appendHistory(contents, directa, { seq: 2, sender: me, at: 2, payload: { t: "friend.accept", acceptedAt: 2 } })
    })
    expect(session.friendTies().get(par)?.link).toBe("amigos")

    await vault.update((contents) => {
      for (let i = 0; i < HISTORY_MAX_PER_CHANNEL + 1; i++) appendHistory(contents, directa, mensagem(10 + i, i % 2 ? me : par))
    })

    expect(session.friendTies().get(par)?.link).toBe("amigos")
    // And common messages keep their usual cap.
    const guardadas = entradasDoCanal(vault.contents, directa)
    expect(guardadas.filter((entrada) => !ehDoLivro(entrada))).toHaveLength(HISTORY_MAX_PER_CHANNEL)
    expect(guardadas.filter(ehDoLivro)).toHaveLength(2)
    // In order of arrival: the book stays at the head, where it was.
    expect(guardadas[0]?.payload.t).toBe("friend.request")
    expect(guardadas[1]?.payload.t).toBe("friend.accept")
  })

  it("um convite aceite sobrevive ao tecto, e a página recuperada também não o corta", async () => {
    const { session, vault, me, par, directa } = await contaComDirecta()
    const alvo = moradaNova()
    await vault.update((contents) => {
      appendHistory(contents, directa, {
        seq: 1,
        sender: me,
        at: Date.now(),
        payload: { t: "message", id: "c1", body: "convite", sentAt: Date.now(), attachments: [], invite: { channel: alvo, at: Date.now() } },
      })
      appendHistory(contents, directa, {
        seq: 2,
        sender: par,
        at: Date.now(),
        payload: { t: "message", id: "c2", body: "sim", sentAt: Date.now(), attachments: [], inviteReply: { channel: alvo, accepted: true, at: Date.now() } },
      })
      for (let i = 0; i < HISTORY_MAX_PER_CHANNEL; i++) appendHistory(contents, directa, mensagem(500 + i, par))
      // A page of older messages, which enters at the front and pushes the
      // cap: the invite cannot exit here.
      mergeOlderHistory(contents, directa, [mensagem(3, par), mensagem(4, me)])
    })
    const convite = [...session.channelInvites().values()].find((tie) => tie.target === alvo)
    expect(convite?.state).toBe("aceite")
  })

  it("o livro tem tecto próprio: as repetições que não mudam nada saem primeiro, e o pedido original fica", async () => {
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const canal = moradaNova()
    await vault.update((contents) => {
      for (let i = 0; i < LEDGER_MAX_PER_CHANNEL + 50; i++) {
        appendHistory(contents, canal, { seq: i, sender: "@x:localhost:8448", at: i, payload: { t: "friend.request", sentAt: i } })
      }
      for (let i = 0; i < 10; i++) appendHistory(contents, canal, mensagem(1_000 + i, "@x:localhost:8448"))
    })
    const guardadas = entradasDoCanal(vault.contents, canal)
    expect(guardadas.filter(ehDoLivro)).toHaveLength(LEDGER_MAX_PER_CHANNEL)
    expect(guardadas.filter(ehDoLivro)[0]?.seq).toBe(0)
    expect(guardadas.filter((entrada) => !ehDoLivro(entrada))).toHaveLength(10)
  })

  /**
   * I4 of the review: repeating the last act (F4) writes equal accepts, and
   * cutting by position lost the request that gives them meaning. Without the request, the
   * fold rejects the accept and the friendship disappeared.
   */
  it('pedido, aceite e 250 aceites repetidos: o laço continua "amigos"', async () => {
    const { session, vault, me, par, directa } = await contaComDirecta()
    await vault.update((contents) => {
      appendHistory(contents, directa, { seq: 1, sender: par, at: 1, payload: { t: "friend.request", sentAt: 1 } })
      appendHistory(contents, directa, { seq: 2, sender: me, at: 2, payload: { t: "friend.accept", acceptedAt: 2 } })
      for (let i = 0; i < 250; i++) {
        appendHistory(contents, directa, { seq: 3 + i, sender: me, at: 2, payload: { t: "friend.accept", acceptedAt: 2 } })
      }
    })
    const livro = entradasDoCanal(vault.contents, directa).filter(ehDoLivro)
    expect(livro.length).toBeLessThanOrEqual(LEDGER_MAX_PER_CHANNEL)
    expect(livro[0]?.payload.t).toBe("friend.request")
    expect(session.friendTies().get(par)?.link).toBe("amigos")
  })
})
