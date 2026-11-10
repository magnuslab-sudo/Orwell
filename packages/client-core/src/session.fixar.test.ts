import { moradaDeTeste } from "../testes/moradas.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_ROOM } from "@enclave/protocol"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * Pin messages in a room: who can, who cannot, and who arrives later.
 *
 * Three questions, and none answers from one side of the wire alone, hence two
 * and three real accounts, with a real relay in the middle. The relay is the
 * server part that these questions need (per-channel sequence, subscriptions,
 * key package reserve, welcome only to the intended recipient), copied from
 * `session.publicacoes.test.ts`, which copied it from `session.corrida.test.ts`.
 *
 * **What is measured is always the VAULT OF THE READER**, never what passed
 * over the wire. A pin that leaves and is not accepted on the other side is
 * indistinguishable, at the sender, from a pin that took, and that is exactly
 * the case the second question needs to catch.
 */

/** Creating an account is real cryptography. See the same note nearby. */
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

interface Frame {
  t: string
  [key: string]: unknown
}

interface Evento {
  seq: number
  kind: string
  ciphertext: string
  recipient?: string | undefined
  ref?: string | undefined
}

const TRAMAS_MAXIMAS = 3_000

class Rele {
  readonly eventos = new Map<string, Evento[]>()
  readonly pools = new Map<string, string[]>()
  readonly ligacoes = new Set<FakeSocket>()
  entregues = 0

  frame(socket: FakeSocket, frame: Frame): void {
    switch (frame.t) {
      case "hello":
        socket.entregar({ t: "hello.ok", version: 1, capabilities: [] })
        return
      case "auth.begin":
        socket.address = frame.address as string
        socket.entregar({ t: "auth.challenge", nonce: "AAAA" })
        return
      case "auth.finish":
        socket.entregar({ t: "auth.ok", address: socket.address })
        return
      case "channel.subscribe":
        for (const canal of frame.channels as string[]) socket.canais.add(canal)
        return
      case "channel.unsubscribe":
        for (const canal of frame.channels as string[]) socket.canais.delete(canal)
        return
      case "keypackage.publish": {
        const anterior = frame.replace ? [] : (this.pools.get(socket.address ?? "") ?? [])
        this.pools.set(socket.address ?? "", [...anterior, ...(frame.packages as string[])])
        return
      }
      case "keypackage.claim": {
        const pool = this.pools.get(frame.address as string) ?? []
        const pacote = pool.shift() ?? null
        socket.entregar({ t: "keypackage.claimed", address: frame.address, keyPackage: pacote })
        return
      }
      case "channel.send": {
        const canal = frame.channel as string
        const log = this.eventos.get(canal) ?? []
        const evento: Evento = {
          seq: log.length,
          kind: frame.kind as string,
          ciphertext: frame.ciphertext as string,
          recipient: frame.recipient as string | undefined,
          ref: frame.ref as string | undefined,
        }
        log.push(evento)
        this.eventos.set(canal, log)
        this.difundir(canal, evento)
        return
      }
      case "channel.backfill": {
        const canal = frame.channel as string
        const log = this.eventos.get(canal) ?? []
        const depois = (frame.afterSeq as number | undefined) ?? -1
        const visiveis = log.filter(
          (evento) => evento.seq > depois && (evento.recipient === undefined || evento.recipient === socket.address),
        )
        const pagina = visiveis.slice(0, (frame.limit as number | undefined) ?? 50)
        socket.entregar({
          t: "channel.backfill.page",
          channel: canal,
          events: pagina.map((evento) => ({
            seq: evento.seq,
            kind: evento.kind,
            ciphertext: evento.ciphertext,
            receivedAtMinute: 0,
          })),
          more: pagina.length < visiveis.length,
        })
        return
      }
      case "welcome.resync": {
        for (const [canal, log] of this.eventos) {
          for (const evento of log) {
            if (evento.kind === "welcome" && evento.recipient === socket.address) {
              socket.entregar(this.#comoEvento(canal, evento))
            }
          }
        }
        return
      }
      default:
        return
    }
  }

  difundir(canal: string, evento: Evento): void {
    for (const ligacao of this.ligacoes) {
      if (!ligacao.address) continue
      if (evento.recipient) {
        if (ligacao.address !== evento.recipient) continue
      } else if (!ligacao.canais.has(canal)) continue
      ligacao.entregar(this.#comoEvento(canal, evento))
    }
  }

  #comoEvento(canal: string, evento: Evento): Frame {
    return {
      t: "channel.event",
      channel: canal,
      seq: evento.seq,
      kind: evento.kind,
      ciphertext: evento.ciphertext,
      receivedAtMinute: 0,
      ...(evento.ref !== undefined ? { ref: evento.ref } : {}),
    }
  }
}

let rele = new Rele()

class FakeSocket {
  address: string | null = null
  readonly canais = new Set<string>()
  readyState = 0
  readonly #rele = rele
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    this.#rele.ligacoes.add(this)
    setTimeout(() => {
      this.readyState = 1
      this.#fire("open", {})
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
    this.#rele.frame(this, JSON.parse(raw) as Frame)
  }

  entregar(frame: unknown): void {
    if (this.#rele.entregues++ > TRAMAS_MAXIMAS) return
    setTimeout(() => this.#fire("message", { data: JSON.stringify(frame) }), 0)
  }

  close(): void {
    this.readyState = 3
    this.#rele.ligacoes.delete(this)
    this.#fire("close", {})
  }

  #fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

async function settle(times = 200): Promise<void> {
  for (let index = 0; index < times; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

let abertas: Session[] = []

interface Conta {
  session: Session
  address: string
  vault: Vault
}

async function conta(): Promise<Conta> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  abertas.push(session)
  const { address } = await session.createIdentity("localhost:8448")
  await session.connect()
  await settle(20)
  return { session, address, vault }
}

beforeEach(() => {
  rele = new Rele()
  abertas = []
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  for (const session of abertas) session.disconnect()
  abertas = []
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

const CANAL = moradaDeTeste("lagar")
/** The default room: the one that exists without anyone having declared it. */
const SALA = ""

function mensagem(id: string, corpo: string) {
  return { t: "message" as const, id, sentAt: 1_700_000_000_000, body: corpo, attachments: [], mentions: [], links: [] }
}

/** Ana starts the channel and Bento joins. Ana sends, Bento is a member and nothing more. */
async function canalComDois(): Promise<{ ana: Conta; bento: Conta; carlos: Conta }> {
  const ana = await conta()
  const bento = await conta()
  const carlos = await conta()

  await ana.session.createSpaceChannel(CANAL)
  await settle(20)
  await ana.session.seat(CANAL, bento.address)
  await settle(80)

  return { ana, bento, carlos }
}

/** What a person sees pinned in the room, from their vault. */
function fixadasVistas(quem: Conta): { id: string; body: string; pinnedBy: string }[] {
  return quem.session
    .pinnedOf(CANAL, SALA)
    .map((fixada) => ({ id: fixada.id, body: fixada.body, pinnedBy: fixada.pinnedBy }))
}

/** The name a person sees in the default room, from their vault. */
function nomeVisto(quem: Conta): string | undefined {
  return quem.session.roomsOf(CANAL).find((sala) => sala.room === SALA)?.name
}

describe("fixar uma mensagem: quem tem a responsabilidade", () => {
  it("quem funda fixa, e a outra pessoa vê a mensagem fixada — texto incluído", async () => {
    const { ana, bento } = await canalComDois()

    await ana.session.send(CANAL, mensagem("m-inscricoes-1", "As inscrições fecham na sexta."))
    await settle(40)
    await ana.session.pinMessage(CANAL, SALA, {
      id: "m-inscricoes-1",
      sender: ana.address,
      body: "As inscrições fecham na sexta.",
      sentAt: 1_700_000_000_000,
    })
    await settle(80)

    expect(fixadasVistas(bento)).toEqual([
      { id: "m-inscricoes-1", body: "As inscrições fecham na sexta.", pinnedBy: ana.address },
    ])
    // On the screen of whoever pinned the message, where the click must have an immediate response.
    expect(fixadasVistas(ana)).toHaveLength(1)
  })

  it("desafixar tira-a do ecrã da outra pessoa, e não só do nosso", async () => {
    const { ana, bento } = await canalComDois()

    await ana.session.pinMessage(CANAL, SALA, {
      id: "m-inscricoes-1",
      sender: ana.address,
      body: "As inscrições fecham na sexta.",
      sentAt: 1_700_000_000_000,
    })
    await settle(80)
    expect(fixadasVistas(bento)).toHaveLength(1)

    await ana.session.unpinMessage(CANAL, SALA, "m-inscricoes-1")
    await settle(80)

    // An empty list is a statement and must travel as such. If absent and empty were the same thing, the last pinned message would never leave the top.
    expect(fixadasVistas(bento)).toEqual([])
  })

  it("um cargo com `fixar` dá a responsabilidade a quem não a tinha", async () => {
    const { ana, bento } = await canalComDois()

    expect(bento.session.mayPin(CANAL)).toBe(false)

    await ana.session.defineRole(CANAL, { role: "avisos", name: "Avisos", powers: ["fixar"], position: 0 })
    await settle(40)
    await ana.session.assignRoles(CANAL, bento.address, ["avisos"])
    await settle(80)

    expect(bento.session.mayPin(CANAL)).toBe(true)

    await bento.session.pinMessage(CANAL, SALA, {
      id: "m-do-bento-1",
      sender: bento.address,
      body: "Reunião adiada.",
      sentAt: 1_700_000_100_000,
    })
    await settle(80)

    expect(fixadasVistas(ana)).toEqual([{ id: "m-do-bento-1", body: "Reunião adiada.", pinnedBy: bento.address }])
  })

  it("fixar na sala por omissão não lhe muda o nome nem o lugar", async () => {
    /**
     * The default room may never have been declared, and it is where most
     * conversations live. Pinning there forces publishing `channel.meta` that it
     * never had, and that is where the expensive mistake lies: an invented name
     * would rename the room for everyone, and an invented position would send it
     * to the middle of the others in the sidebar. Without anyone touching it,
     * and because of a click that was on something else.
     *
     * The values are those of `DEFAULT_ROOM` in the protocol, which is where
     * the interface reads them from, the reason the constant was moved out of
     * the interface.
     */
    const { ana, bento } = await canalComDois()

    await ana.session.pinMessage(CANAL, SALA, {
      id: "m-inscricoes-1",
      sender: ana.address,
      body: "As inscrições fecham na sexta.",
      sentAt: 1_700_000_000_000,
    })
    await settle(80)

    for (const quem of [ana, bento]) {
      const omissao = quem.session.roomsOf(CANAL).find((sala) => sala.room === DEFAULT_ROOM.room)
      expect(omissao?.name).toBe(DEFAULT_ROOM.name)
      expect(omissao?.position).toBe(DEFAULT_ROOM.position)
      expect(omissao?.category).toBe("")
      expect(omissao?.kind).toBe("text")
    }
  })

  it("e numa sala declarada, fixar não lhe mexe no nome nem na categoria", async () => {
    // The other side of the same trap: here the record exists, and what comes out
    // of here must repeat it exactly instead of rebuilding it from nothing.
    const { ana, bento } = await canalComDois()

    await ana.session.upsertRoom(CANAL, { room: "avisos", name: "Avisos", category: "Direcção", position: 7 })
    await settle(60)

    await ana.session.pinMessage(CANAL, "avisos", {
      id: "m-inscricoes-1",
      sender: ana.address,
      body: "As inscrições fecham na sexta.",
      sentAt: 1_700_000_000_000,
    })
    await settle(80)

    const vista = bento.session.roomsOf(CANAL).find((sala) => sala.room === "avisos")
    expect(vista).toMatchObject({ name: "Avisos", category: "Direcção", position: 7 })
    expect(bento.session.pinnedOf(CANAL, "avisos")).toHaveLength(1)
    // And the default room gained no pin: they are different rooms.
    expect(bento.session.pinnedOf(CANAL, SALA)).toEqual([])
  })

  it("fixar a mesma mensagem duas vezes não gasta dois lugares", async () => {
    const { ana, bento } = await canalComDois()
    const alvo = { id: "m-inscricoes-1", sender: ana.address, body: "Uma só.", sentAt: 1_700_000_000_000 }

    await ana.session.pinMessage(CANAL, SALA, alvo)
    await settle(40)
    await ana.session.pinMessage(CANAL, SALA, alvo)
    await settle(80)

    expect(fixadasVistas(bento)).toHaveLength(1)
  })
})

/**
 * The half that is not enough to hide.
 *
 * The interface does not offer the action to whoever does not have the
 * responsibility, and that is teaching not protection: the bridge is callable
 * by any client, and the payload is a line of JSON. These two tests measure
 * the two gates that exist below, the one that refuses on the sender side, and
 * the one that ignores on the receiver side.
 */
describe("fixar uma mensagem: quem NÃO tem a responsabilidade", () => {
  it("o núcleo RECUSA, e não é só o botão que está escondido", async () => {
    const { bento } = await canalComDois()

    expect(bento.session.mayPin(CANAL)).toBe(false)
    await expect(
      bento.session.pinMessage(CANAL, SALA, {
        id: "m-a-martelo-1",
        sender: bento.address,
        body: "Leiam isto.",
        sentAt: 1_700_000_200_000,
      }),
    ).rejects.toThrow("you may not pin in this channel")
    await expect(bento.session.unpinMessage(CANAL, SALA, "m-a-martelo-1")).rejects.toThrow("you may not pin in this channel")
  })

  it("e um cliente ALTERADO que a publique à mão é ignorado por quem recebe", async () => {
    // The raw `send` is the altered client: it skips the sender gate and puts
    // exactly the `channel.meta` on the wire that the interface would never let it
    // compose. It is the only honest way to measure the second gate.
    const { ana, bento } = await canalComDois()

    await bento.session.send(CANAL, {
      t: "channel.meta",
      room: SALA,
      name: "geral",
      category: "",
      kind: "text",
      position: -1,
      closed: false,
      removed: false,
      pinned: [
        {
          id: "m-a-martelo-1",
          sender: bento.address,
          body: "Leiam isto.",
          sentAt: 1_700_000_200_000,
          pinnedAt: 1_700_000_200_000,
          pinnedBy: bento.address,
        },
      ],
      updatedAt: 1_700_000_200_000,
    })
    await settle(80)

    // Nothing at the top of the sender's room.
    expect(fixadasVistas(ana)).toEqual([])
    // And the room itself kept arriving: refusing the whole record took away from
    // whoever only has `rename` the ability to tidy up the sidebar.
    expect(nomeVisto(ana)).toBe("geral")
  })

  it("quem tem `renomear` e não tem `fixar` muda o nome à sala sem desfixar nada", async () => {
    const { ana, bento } = await canalComDois()

    await ana.session.pinMessage(CANAL, SALA, {
      id: "m-inscricoes-1",
      sender: ana.address,
      body: "As inscrições fecham na sexta.",
      sentAt: 1_700_000_000_000,
    })
    await settle(80)

    await ana.session.defineRole(CANAL, { role: "arrumo", name: "Arrumo", powers: ["renomear"], position: 0 })
    await settle(40)
    await ana.session.assignRoles(CANAL, bento.address, ["arrumo"])
    await settle(80)
    expect(bento.session.mayPin(CANAL)).toBe(false)

    await bento.session.upsertRoom(CANAL, { room: SALA, name: "Conversa" })
    await settle(80)

    // The name changed for both...
    expect(nomeVisto(ana)).toBe("Conversa")
    expect(nomeVisto(bento)).toBe("Conversa")
    // ...and the pinned message did not fall with it. Absent is not an empty list:
    // a `channel.meta` that does not mention pins does not unpin anything.
    expect(fixadasVistas(ana)).toHaveLength(1)
    expect(fixadasVistas(bento)).toHaveLength(1)
  })
})

/**
 * What was pinned before someone had a place in the channel.
 *
 * Persistent secrecy ensures that whoever joins now will never open the
 * `channel.meta` that led to the pin, nor the original message it cites.
 * Without reissue, newcomers see the top of the room empty, and an empty top
 * has no symptom: it does not look like a fault, it looks like a room where
 * nobody pinned anything. It is the same wound as the bulletin board with no
 * posts, in the place where it least stands out.
 */
describe("quem chega depois", () => {
  it("vê o que está fixado, com o texto, sem nunca ter podido abrir a mensagem", async () => {
    const { ana, bento, carlos } = await canalComDois()

    await ana.session.send(CANAL, mensagem("m-inscricoes-1", "As inscrições fecham na sexta."))
    await settle(40)
    await ana.session.pinMessage(CANAL, SALA, {
      id: "m-inscricoes-1",
      sender: ana.address,
      body: "As inscrições fecham na sexta.",
      sentAt: 1_700_000_000_000,
    })
    await settle(80)
    expect(fixadasVistas(bento)).toHaveLength(1)

    // Carlos joins now. Everything above was encrypted in epochs he will never have.
    await ana.session.seat(CANAL, carlos.address)
    await settle(200)

    expect(fixadasVistas(carlos)).toEqual([
      { id: "m-inscricoes-1", body: "As inscrições fecham na sexta.", pinnedBy: ana.address },
    ])
    // The proof that the copy is what serves him: the original message is NOT in
    // his history, and could not be.
    expect(carlos.session.history(CANAL).some((entrada) => (entrada.payload as { id?: string }).id === "m-inscricoes-1")).toBe(
      false,
    )
  })

  it("e o que foi desafixado não volta com quem chega", async () => {
    const { ana, carlos } = await canalComDois()

    await ana.session.pinMessage(CANAL, SALA, {
      id: "m-inscricoes-1",
      sender: ana.address,
      body: "As inscrições fecham na sexta.",
      sentAt: 1_700_000_000_000,
    })
    await settle(60)
    await ana.session.unpinMessage(CANAL, SALA, "m-inscricoes-1")
    await settle(60)

    await ana.session.seat(CANAL, carlos.address)
    await settle(200)

    expect(fixadasVistas(carlos)).toEqual([])
  })
})
