import { moradaDeTeste } from "../testes/moradas.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { addMembers, createChannel, decodeKeyPackage, epochOf, exportSession, generateKeyPackages, joinChannel } from "@enclave/crypto"
import { toBase64 } from "@enclave/protocol"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * Leave a channel and delete the account without staying in it.
 *
 * **The bug, reported by the owner:** "I deleted an account and it's still visible
 * in the channel". `Vault.destroy()` locks the vault and clears local storage, and
 * nothing more, it sends no commit, notifies no channel, advances no epoch.
 * The sheet stayed in the MLS tree of each channel: the person remained in the
 * members list for everyone, and worse than the visible symptom, the future
 * secrecy that a leave should guarantee didn't happen. A deleted account that
 * had saved the keys could still read everything that came after.
 *
 * There are three separate questions, and each one has its tests here:
 *
 * 1. **Does leaving request a leave, and does the request actually get through?** It's not
 *    enough for the frame to land on an open socket: the server can refuse it
 *    next, and that looked exactly like a successful leave.
 * 2. **Do those who stay honor the request?** That's the part with cryptographic weight, and it's
 *    on the other side: MLS won't let anyone commit their own removal, so the
 *    epoch only advances by those who stay. Proven with two real accounts.
 * 3. **What happens when the leave fails?** The decision is in
 *    `docs/PENDENTES.md`: the account is NOT deleted. Destroying the vault without leaving is the
 *    worst of both worlds, because the only device that could request the leave
 *    just threw away the keys it would use to request it.
 */

vi.setConfig({ testTimeout: 60_000 })

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

interface Sent {
  t: string
  [key: string]: unknown
}

/**
 * The fake server receives the frame AND the socket that sent it.
 *
 * Two real accounts mean two sockets alive at the same time, and a response that
 * only knew the frame wouldn't know where to send it back. That's the only
 * difference from the template in `session.eliminar.test.ts`.
 */
type Reply = (frame: Sent, socket: FakeSocket) => unknown[] | undefined

class FakeSocket {
  static last: FakeSocket | null = null
  static reply: Reply = () => undefined

  readyState = 0
  readonly sent: Sent[] = []
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    FakeSocket.last = this
    setTimeout(() => {
      this.readyState = 1
      this.fire("open", {})
    }, 0)
  }

  addEventListener(kind: string, handler: (event: unknown) => void, options?: { once?: boolean }): void {
    const wrapped = options?.once
      ? (event: unknown): void => {
          this.removeEventListener(kind, wrapped)
          handler(event)
        }
      : handler
    this.#listeners.set(kind, [...(this.#listeners.get(kind) ?? []), wrapped])
  }

  removeEventListener(kind: string, handler: (event: unknown) => void): void {
    this.#listeners.set(
      kind,
      (this.#listeners.get(kind) ?? []).filter((item) => item !== handler),
    )
  }

  send(raw: string): void {
    const frame = JSON.parse(raw) as Sent
    this.sent.push(frame)
    for (const reply of FakeSocket.reply(frame, this) ?? []) {
      setTimeout(() => this.fire("message", { data: JSON.stringify(reply) }), 0)
    }
  }

  close(): void {
    this.readyState = 3
    this.fire("close", {})
  }

  fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }

  /** Deliver a channel event to this client, the way the server would. */
  entregar(channel: string, kind: string, ciphertext: string, seq: number): void {
    this.fire("message", {
      data: JSON.stringify({ t: "channel.event", channel, seq, kind, ciphertext, receivedAtMinute: 0 }),
    })
  }
}

/**
 * The server: authenticates, and returns an echo of each send with the given reference.
 *
 * The echo is the receipt. `#confirmado` waits for it to know the leave actually
 * got through, and the options below are exactly the two ways it doesn't come.
 */
function servidor(opcoes: { semEco?: boolean; recusa?: string } = {}): Reply {
  let seq = 0
  return (frame) => {
    if (frame.t === "hello") return [{ t: "hello.ok", version: 1, capabilities: [] }]
    if (frame.t === "auth.begin") return [{ t: "auth.challenge", nonce: "AAAA" }]
    if (frame.t === "auth.finish") return [{ t: "auth.ok", address: "@x:localhost" }]
    if (frame.t === "channel.send") {
      if (opcoes.recusa !== undefined && frame.channel === opcoes.recusa) {
        return [{ t: "channel.rejected", channel: frame.channel, reason: "no-seat" }]
      }
      if (opcoes.semEco === true) return undefined
      return [
        {
          t: "channel.event",
          channel: frame.channel,
          seq: seq++,
          kind: frame.kind,
          ciphertext: frame.ciphertext,
          receivedAtMinute: 0,
          ...(typeof frame.ref === "string" ? { ref: frame.ref } : {}),
        },
      ]
    }
    return undefined
  }
}

async function settle(times = 60): Promise<void> {
  for (let index = 0; index < times; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Wait for the outcome, not a clock.
 *
 * Honoring a leave has the `#honrarSaida` queue in the middle, which is seconds
 * on purpose. A fixed timeout longer than it makes a test that passes on the
 * writer's machine and turns red on the machine indexing the disk, and a red
 * that shifts between tests as each day teaches you not to trust the red. The
 * deadline here is just the limit to give up.
 */
async function ateQue(condicao: () => boolean, limiteMs = 45_000): Promise<void> {
  const fim = Date.now() + limiteMs
  while (Date.now() < fim) {
    if (condicao()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("o que se esperava não aconteceu dentro do prazo")
}

/**
 * Open sessions, to close them at the end no matter what.
 *
 * A session that stays connected keeps pushing reconnection attempts forever, and
 * a test that fails halfway never reaches a `disconnect` written at the end of the body
 *, which is exactly when it matters, because its retries compete with the event
 * loop for the next tests. Always close here.
 */
const abertas: Session[] = []

/** A connected account, with no channels in the vault. */
async function contaLigada(): Promise<{ session: Session; vault: Vault; socket: FakeSocket }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  await session.createIdentity("localhost:8448")
  FakeSocket.last = null
  await session.connect()
  await settle()
  const socket = FakeSocket.last
  if (!socket) throw new Error("a sessão não abriu socket nenhum")
  return { session, vault, socket }
}

/**
 * Put an already built MLS group into an account.
 *
 * `restore()` is public and reads from the vault, so the state goes in there and it gets called.
 * Connecting first and only then restoring avoids message recovery from startup, which
 * would need a fake server with history, and what's measured here isn't recovery.
 */
async function comGrupo(
  conta: { session: Session; vault: Vault },
  channel: string,
  estado: Uint8Array,
): Promise<void> {
  await conta.vault.update((contents) => {
    contents.groups[channel] = toBase64(estado)
  })
  await conta.session.restore()
}

beforeEach(() => {
  FakeSocket.reply = servidor()
  FakeSocket.last = null
  Session.CONFIRM_MS = 10_000
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  for (const sessao of abertas.splice(0)) sessao.disconnect()
  vi.useRealTimers()
  Session.CONFIRM_MS = 10_000
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

const SALA = moradaDeTeste("lagar")

describe("sair de um canal pede a saída a quem fica", () => {
  it("publica a saída dentro do canal e só larga o grupo depois de o servidor a aceitar", async () => {
    const conta = await contaLigada()
    await conta.session.createSpaceChannel(SALA)
    await settle()

    const antes = conta.socket.sent.filter((frame) => frame.t === "channel.send").length
    await conta.session.leaveChannel(SALA)

    // Something encrypted went out, and the channel stopped existing here.
    expect(conta.socket.sent.filter((frame) => frame.t === "channel.send").length).toBeGreaterThan(antes)
    expect(conta.session.channels).not.toContain(SALA)
    expect(conta.vault.contents.groups[SALA]).toBeUndefined()
  })

  it("sem ligação não larga nada: a saída que não sai deixava a folha na árvore para sempre", async () => {
    // The case that makes the order matter. Dropping the group before the request
    // arrives left the person without the channel AND with the sheet still in it, and
    // no way to request again, because the keys to request it just got thrown away.
    // Same rule as `deleteChannel`: publish first, drop after.
    const conta = await contaLigada()
    await conta.session.createSpaceChannel(SALA)
    await settle()
    conta.session.disconnect()

    await expect(conta.session.leaveChannel(SALA)).rejects.toThrow()
    expect(conta.session.channels).toContain(SALA)
    expect(conta.vault.contents.groups[SALA]).toBeTruthy()
  })

  it("o servidor a recusar o envio não conta como saída, por muito que o socket esteja aberto", async () => {
    // The server's refusal (`channel.rejected`) was silent to whoever sent it: the
    // frame landed on an open socket, `#send` didn't throw, and from here everything
    // looked fine. In a chat message that's acceptable; in a leave that comes before
    // deleting the account, it's the difference between leaving and thinking you left.
    FakeSocket.reply = servidor({ recusa: SALA })
    const conta = await contaLigada()
    await conta.session.createSpaceChannel(SALA)
    await settle()

    await expect(conta.session.leaveChannel(SALA)).rejects.toThrow("this device has no seat in this channel")
    expect(conta.session.channels).toContain(SALA)
  })

  it("o servidor calado também não conta: espera-se o recibo, não o envio", async () => {
    // The other side of the same coin, and the more treacherous: the server accepts the
    // connection, refuses nothing, and just doesn't save. No receipt means no leave, // after the deadline, this throws.
    FakeSocket.reply = servidor({ semEco: true })
    Session.CONFIRM_MS = 300
    const conta = await contaLigada()
    await conta.session.createSpaceChannel(SALA)
    await settle()

    await expect(conta.session.leaveChannel(SALA)).rejects.toThrow("the server did not confirm the send")
    expect(conta.session.channels).toContain(SALA)
  })
})

describe("apagar a conta sai primeiro dos canais", () => {
  it("com tudo a correr bem, sai de todos e não fica nenhum por sair", async () => {
    const outra = moradaDeTeste("forja")
    const conta = await contaLigada()
    await conta.session.createSpaceChannel(SALA)
    await conta.session.createSpaceChannel(outra)
    await settle()

    await expect(conta.session.prepareAccountDeletion()).resolves.toBeUndefined()
    expect(conta.session.channels).toEqual([])
  })

  it("sem ligação RECUSA apagar, com a razão escrita, e a conta fica de pé", async () => {
    /**
     * The decision, and why this file exists.
     *
     * Before: `Vault.destroy()` cleared the vault and the sheet stayed in the tree.
     * The person tapped delete, saw the account disappear from their screen, and
     * stayed in the members list of everyone with the epoch frozen. Now the leave
     * comes first, and if you can't leave nothing gets deleted: the account stays
     * and reloads next time there's network.
     */
    const conta = await contaLigada()
    await conta.session.createSpaceChannel(SALA)
    await settle()
    conta.session.disconnect()

    await expect(conta.session.prepareAccountDeletion()).rejects.toThrow("could not leave every channel, account kept")
    // And the essential part: the vault stays, with the channel still in it.
    expect(conta.vault.contents.groups[SALA]).toBeTruthy()
    expect(conta.vault.unlocked).toBe(true)
  })

  it("conta as que ficaram por sair, e só essas: o que saiu fica saído", async () => {
    // Idempotence is what makes "retry" cheap: the second attempt does not repeat
    // the outcomes that already succeeded.
    const teimoso = moradaDeTeste("forja")
    FakeSocket.reply = servidor({ recusa: teimoso })
    const conta = await contaLigada()
    await conta.session.createSpaceChannel(SALA)
    await conta.session.createSpaceChannel(teimoso)
    await settle()

    expect(await conta.session.leaveAllChannels()).toEqual([teimoso])
    // The second pass has only one channel left to try.
    expect(await conta.session.leaveAllChannels()).toEqual([teimoso])
    expect(conta.session.channels).toEqual([teimoso])
  })

  it("um canal que está no cofre e não em memória conta como canal, e impede", async () => {
    /**
     * The gap that `#groups` alone left open.
     *
     * Groups only load into memory in `restore()`, and `restore()` runs inside
     * `connect()`. A session that opens without network, which is exactly the
     * situation where someone hits delete and the exit cannot go out, has
     * `#groups` empty and the vault full. Asking only memory answered "there
     * are no channels to exit from" and allowed delete, which is the original
     * defect all over again, now through another door.
     */
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const session = new Session(vault)
    abertas.push(session)
    await session.createIdentity("localhost:8448")

    const grupo = await createChannel(session.identity, SALA)
    await vault.update((contents) => {
      contents.groups[SALA] = toBase64(exportSession(grupo))
    })
    // Never connected, so never restored: there is no channel in memory.
    expect(session.channels).toEqual([])

    await expect(session.prepareAccountDeletion()).rejects.toThrow("could not leave every channel, account kept")
    expect(vault.contents.groups[SALA]).toBeTruthy()
  })

  it("sem canais nenhuns não há nada a impedir: apagar uma conta vazia continua a poder fazer-se", async () => {
    const conta = await contaLigada()
    await expect(conta.session.prepareAccountDeletion()).resolves.toBeUndefined()
  })
})

describe("quem fica honra a saída, e é aí que a epoch avança", () => {
  it("tira a folha de quem saiu e avança a epoch, com duas contas a sério", async () => {
    /**
     * The proof with cryptographic weight, and why it must be on the other side.
     *
     * MLS does not allow anyone to commit their own removal (RFC 9420 §12.2),
     * so whoever leaves can only REQUEST. If the client of whoever stays does
     * not honor the request, the exit does not exist: the leaf stays in the tree,
     * the epoch stays where it was, and the keys that whoever left had still work
     * to read whatever comes next. This is exactly the state that deleting the
     * account left everyone in.
     */
    const alice = await contaLigada()
    const bob = await contaLigada()

    // The group built in the lower layer, with the identities of these two
    // accounts, and then put in both vaults. It is the same group, not two.
    let grupoAlice = await createChannel(alice.session.identity, SALA)
    const [pacote] = await generateKeyPackages(bob.session.identity, 1)
    if (!pacote) throw new Error("sem key package")
    const admissao = await addMembers(grupoAlice, [decodeKeyPackage(pacote.wire)])
    grupoAlice = admissao.session
    const grupoBob = await joinChannel(SALA, admissao.welcome, pacote.publicPackage, pacote.privatePackage)

    await comGrupo(alice, SALA, exportSession(grupoAlice))
    await comGrupo(bob, SALA, exportSession(grupoBob))

    expect(bob.session.membersOf(SALA)).toContain(alice.session.identity.address)
    const epochAntes = epochOf(grupoBob)

    // Alice leaves. What goes on the wire is the encrypted payload of `member.left`.
    await alice.session.leaveChannel(SALA)
    const saida = alice.socket.sent.filter((frame) => frame.t === "channel.send").at(-1)
    if (!saida) throw new Error("a saída não foi enviada")

    // The server delivers it to Bob, which is what was missing.
    bob.socket.entregar(SALA, "application", saida.ciphertext as string, 1)
    // Alice's leaf disappearing from BOB's tree is the whole outcome. It waits
    // its turn in the queue (see `#honrarSaida`), and that is why we wait for it
    // and not for a clock.
    await ateQue(() => !bob.session.membersOf(SALA).includes(alice.session.identity.address))
    await settle()

    expect(bob.session.membersOf(SALA)).not.toContain(alice.session.identity.address)
    const grupoDepois = bob.session.groupFor(SALA)
    if (!grupoDepois) throw new Error("o Bob perdeu o grupo")
    expect(epochOf(grupoDepois)).toBeGreaterThan(epochAntes)
    // And the removal commit went out on the channel: without that Bob's tree
    // would be the only one in the world that knew Alice had left.
    expect(bob.socket.sent.some((frame) => frame.t === "channel.send" && frame.kind === "handshake")).toBe(true)
  })

  it("a saída não entra na conversa de quem fica: é uma ordem à árvore, não uma mensagem", async () => {
    const alice = await contaLigada()
    const bob = await contaLigada()

    let grupoAlice = await createChannel(alice.session.identity, SALA)
    const [pacote] = await generateKeyPackages(bob.session.identity, 1)
    if (!pacote) throw new Error("sem key package")
    const admissao = await addMembers(grupoAlice, [decodeKeyPackage(pacote.wire)])
    grupoAlice = admissao.session
    const grupoBob = await joinChannel(SALA, admissao.welcome, pacote.publicPackage, pacote.privatePackage)

    await comGrupo(alice, SALA, exportSession(grupoAlice))
    await comGrupo(bob, SALA, exportSession(grupoBob))

    const mensagens: unknown[] = []
    bob.session.on("message", (evento) => mensagens.push(evento))

    await alice.session.leaveChannel(SALA)
    const saida = alice.socket.sent.filter((frame) => frame.t === "channel.send").at(-1)
    if (!saida) throw new Error("a saída não foi enviada")
    bob.socket.entregar(SALA, "application", saida.ciphertext as string, 1)
    await settle()

    expect(mensagens).toEqual([])
    expect(bob.vault.contents.history[SALA] ?? []).toEqual([])
  })
})
