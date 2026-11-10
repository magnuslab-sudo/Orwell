import { Session, Vault, type VaultBackend } from "@enclave/client-core"
import type { Payload } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"

/**
 * The cascade of who tidies the channel with ONE vault save (slow-after-join, 4/11/2026).
 *
 * `republishAuthority` sends one `role.assign` per person with a role at each join (80 in `!984`),
 * and each `send` saved the entire vault before the frame left: 101 saves per join,
 * measured at 13 MB. `Session.sendBatch` encrypts them all, saves once, and only then sends.
 *
 * What cannot change is the guarantee that saving before sending gives: after a crash,
 * no ratchet generation is ever reused. Proved from the receiver side: Bruno reads
 * everything that left, then the first message from Ana's device reopened from disk. If
 * the disk had the ratchet behind what left, that message would come in a generation Bruno
 * already spent, and it would not open.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const sessoes: Session[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 60_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
  for (const s of sessoes.splice(0)) s.disconnect()
})

afterAll(async () => {
  await servidor?.fechar()
})

const atribuicao = (i: number): Payload => ({ t: "role.assign", subject: `@sujeito${i}:localhost`, roles: [], assignedAt: 1_000 + i }) as Payload
const texto = (corpo: string): Payload => ({ t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: corpo, attachments: [], mentions: [], links: [] }) as Payload

/** A disk that can lock: writes wait until it unlocks, like in a crash mid-save. */
class DiscoPrendivel implements VaultBackend {
  bytes: Uint8Array | null = null
  escritas = 0
  readonly supportsOsProtection = false
  preso: Promise<void> | null = null
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    if (this.preso) await this.preso
    this.escritas++
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

/** Ana reopened from what is on disk, like after a crash. */
async function reabrir(bytes: Uint8Array): Promise<Session> {
  const disco = new DiscoPrendivel()
  disco.bytes = bytes
  const vault = new Vault(disco)
  await vault.unlock("frase-passe-de-teste")
  const session = new Session(vault)
  session.loadIdentity()
  await session.connect()
  sessoes.push(session)
  return session
}

/** How many role assignments for this channel the account has heard, from now on. */
function contarAtribuicoes(conta: ContaDeTeste, canal: string): () => number {
  let n = 0
  conta.session.on("message", (m) => {
    if (m.channel === canal && m.payload.t === "role.assign") n++
  })
  return () => n
}

describe("a cascata em lote", () => {
  it("cem envios, uma gravação do cofre, e quem recebe vê-os todos pela ordem", async () => {
    const [ana, bruno] = (await contasDeTeste(servidor, ["Ana", "Bruno"])) as [ContaDeTeste, ContaDeTeste]
    abertas.push(ana, bruno)
    const canal = await canalComTodos(servidor, ana, [bruno])
    const vistos: number[] = []
    bruno.session.on("message", (m) => {
      if (m.channel === canal && m.payload.t === "role.assign") vistos.push((m.payload as { assignedAt: number }).assignedAt)
    })
    await new Promise((r) => setTimeout(r, 2_000))

    const antes = ana.backend.escritas
    await ana.session.sendBatch(canal, Array.from({ length: 100 }, (_, i) => atribuicao(i)))
    const gravacoes = ana.backend.escritas - antes
    await ate(() => vistos.length >= 100, "as cem chegam ao Bruno", 30_000)
    expect(vistos).toEqual(Array.from({ length: 100 }, (_, i) => 1_000 + i))
    // Before it was a hundred (one per send). One from the batch, and at most one from the next history.
    expect(gravacoes).toBeLessThanOrEqual(2)
  }, 120_000)

  it("uma queda antes da gravação do lote não deixa sair nada, e o aparelho reaberto não repete gerações", async () => {
    const [bruno] = (await contasDeTeste(servidor, ["Bruno"])) as [ContaDeTeste]
    abertas.push(bruno)
    const disco = new DiscoPrendivel()
    const vault = new Vault(disco)
    await vault.create("frase-passe-de-teste")
    const anaSessao = new Session(vault)
    sessoes.push(anaSessao)
    const ana = { nome: "Ana", session: anaSessao, vault, backend: disco as never, address: (await anaSessao.createIdentity(servidor.casa)).address, avisos: [] } as ContaDeTeste
    await anaSessao.connect()
    await anaSessao.updateProfile({ displayName: "Ana", donations: [] })
    const canal = await canalComTodos(servidor, ana, [bruno])
    await anaSessao.send(canal, texto("antes"))
    await ate(() => bruno.session.history(canal).some((e) => e.payload["body"] === "antes"), "o Bruno lê a de antes", 30_000)
    await new Promise((r) => setTimeout(r, 1_500))

    // The disk locks: the batch save never finishes. It is the crash mid-cascade.
    const noDiscoAntes = disco.bytes as Uint8Array
    const ouvidas = contarAtribuicoes(bruno, canal)
    disco.preso = new Promise(() => {})
    void anaSessao.sendBatch(canal, Array.from({ length: 30 }, (_, i) => atribuicao(i))).catch(() => {})
    await new Promise((r) => setTimeout(r, 2_000))
    expect(ouvidas()).toBe(0)
    anaSessao.disconnect()

    // Reopened from the disk from before: what she encrypts now opens on Bruno's side.
    const reaberta = await reabrir(noDiscoAntes)
    await reaberta.send(canal, texto("depois da queda"))
    await ate(() => bruno.session.history(canal).some((e) => e.payload["body"] === "depois da queda"), "o Bruno lê a do aparelho reaberto", 30_000)
  }, 120_000)

  it("depois da gravação do lote, o disco tem a ratchet à frente de tudo o que saiu", async () => {
    const [ana, bruno] = (await contasDeTeste(servidor, ["Ana", "Bruno"])) as [ContaDeTeste, ContaDeTeste]
    abertas.push(ana, bruno)
    const canal = await canalComTodos(servidor, ana, [bruno])
    await new Promise((r) => setTimeout(r, 1_500))
    const ouvidas = contarAtribuicoes(bruno, canal)
    await ana.session.sendBatch(canal, Array.from({ length: 40 }, (_, i) => atribuicao(i)))
    await ate(() => ouvidas() >= 40, "as quarenta chegam ao Bruno", 30_000)
    // The crash right after the last frame: the disk is what was left from the batch save.
    const noDisco = ana.backend.bytes as Uint8Array
    ana.session.disconnect()
    const reaberta = await reabrir(noDisco)
    await reaberta.send(canal, texto("depois do lote"))
    // Bruno already spent the forty generations; this one only opens if it comes in a new one.
    await ate(() => bruno.session.history(canal).some((e) => e.payload["body"] === "depois do lote"), "o Bruno lê a do aparelho reaberto", 30_000)
    expect(bruno.avisos.filter((c) => c === "epoca-saltada" || c === "event-failed")).toEqual([])
  }, 120_000)
})
