import { generateIdentity, moradaDeSala, toBase64, CAPACIDADE_MORADAS_OPACAS, type Payload, type ServerFrame } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  Cliente,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"

/**
 * Opaque addresses on the server (1.0 "Arca", slices 4 e 6a).
 *
 * The server at 1.0 s introduces opaque addresses (`!<40 base32>:<servidor>`),
 * arbitrated by whoever requests first, because a 200 bits address cannot be
 * guessed and names no one, and the common room uses the address at `hello`. The
 * forms in 0.9 (`!dm-a.b`, `!feed-x`, `!self-x`, `!<nome>`) are not introduced
 * by anyone, nor by those in the name. Until slice 6a this was a gate
 * (`ENCLAVE_SO_MORADAS_OPACAS`); now it is the only behavior, and there is no
 * configuration to turn it off.
 */

function mensagem(corpo: string): Payload {
  return {
    t: "message",
    id: crypto.randomUUID(),
    sentAt: Date.now(),
    body: corpo,
    attachments: [],
    links: [],
    mentions: [],
  } as unknown as Payload
}

const leu = (conta: ContaDeTeste, canal: string, corpo: string): boolean =>
  conta.session.history(canal).some((entrada) => entrada.payload["body"] === corpo)

/** The response to a `channel.claim`, requested by a raw client. */
async function reclamar(cliente: Cliente, canal: string): Promise<Extract<ServerFrame, { t: "channel.claim.result" }>> {
  cliente.enviar({ t: "channel.claim", channel: canal })
  return cliente.proximoDe("channel.claim.result")
}

/** A send to a channel, and whether the server refused it for lack of space. */
async function recusado(cliente: Cliente, canal: string): Promise<boolean> {
  cliente.enviar({ t: "channel.send", channel: canal, kind: "application", ciphertext: toBase64(new Uint8Array([7])) })
  const frames = await cliente.ateAoPong()
  return frames.some((f) => f.t === "channel.rejected" && f.channel === canal && f.reason === "no-seat")
}

async function ola(url: string): Promise<Extract<ServerFrame, { t: "hello.ok" }>> {
  const { WebSocket } = await import("ws")
  const socket = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve())
    socket.once("error", reject)
  })
  const frame = new Promise<ServerFrame>((resolve) => {
    socket.once("message", (raw: Buffer) => resolve(JSON.parse(raw.toString("utf8")) as ServerFrame))
  })
  socket.send(JSON.stringify({ t: "hello", version: 1 }))
  const resposta = await frame
  socket.close()
  if (resposta.t !== "hello.ok") throw new Error(`hello respondido com ${resposta.t}`)
  return resposta
}

describe("o servidor da 1.0: só moradas opacas", () => {
  let servidor: ServidorDeTeste
  const abertas: ContaDeTeste[] = []
  const crus: Cliente[] = []
  beforeAll(async () => {
    servidor = await levantarServidor()
  }, 30_000)
  afterEach(() => {
    desligarContas(abertas.splice(0))
    for (const c of crus.splice(0)) c.fechar()
  })
  afterAll(async () => {
    await servidor?.fechar()
  })

  async function crua(): Promise<{ cliente: Cliente; endereco: string; local: string }> {
    const id = generateIdentity(servidor.casa)
    const cliente = await Cliente.ligar(servidor.url, id)
    crus.push(cliente)
    return { cliente, endereco: id.address, local: id.address.slice(1, id.address.indexOf(":")) }
  }

  it("anuncia a capacidade das moradas opacas", async () => {
    expect((await ola(servidor.url)).capabilities).toContain(CAPACIDADE_MORADAS_OPACAS)
  })

  it("a estreia de uma opaca vale para quem a pede primeiro, sem olhar ao nome", async () => {
    const canal = moradaDeSala(servidor.casa)
    const [primeira, segunda] = [await crua(), await crua()]
    const dela = await reclamar(primeira.cliente, canal)
    expect(dela.mine).toBe(true)
    expect(dela.owner).toBe(primeira.endereco)
    const doOutro = await reclamar(segunda.cliente, canal)
    expect(doOutro.mine).toBe(false)
    expect(doOutro.owner).toBe(primeira.endereco)
  })

  it("quem não reclamou nem foi sentado não escreve numa opaca", async () => {
    const canal = moradaDeSala(servidor.casa)
    const [dona, estranha] = [await crua(), await crua()]
    expect((await reclamar(dona.cliente, canal)).mine).toBe(true)
    expect(await recusado(dona.cliente, canal)).toBe(false)
    expect(await recusado(estranha.cliente, canal)).toBe(true)
  })

  it("nenhuma forma antiga se estreia, nem por quem está no nome, e a resposta não diz quem a pediu", async () => {
    const [ana, bruno, terceira] = [await crua(), await crua(), await crua()]
    const dm = `!dm-${[ana.local, bruno.local].sort().join(".")}:${servidor.casa}`
    const formas = [dm, `!feed-${ana.local}:${servidor.casa}`, `!self-${ana.local}:${servidor.casa}`, `!cozinha:${servidor.casa}`]
    for (const canal of formas) {
      // Who's in the name, and a third account, end up the same: the name gives
      // nothing to anyone, and the response doesn't reveal if anyone tried before.
      for (const quem of [ana, bruno, terceira]) {
        const resposta = await reclamar(quem.cliente, canal)
        expect(resposta.mine, canal).toBe(false)
        expect(resposta.owner, canal).toBe("")
        expect(await recusado(quem.cliente, canal), canal).toBe(true)
      }
    }
    // And nothing was recorded: no old-form claims or subscriptions.
    for (const canal of formas) expect(servidor.enclave.store.claimantOf(canal)).toBeUndefined()
  })

  it("o próprio mural pela forma antiga não dá lugar ao dono", async () => {
    // In 0.9 the owner of `!feed-<id>` had a seat in it just because the name was theirs
    // (`#isSeated`). In 1.0 the name gives nothing to anyone.
    const ana = await crua()
    expect(await recusado(ana.cliente, `!feed-${ana.local}:${servidor.casa}`)).toBe(true)
  })

  it("a sala comum continua pela morada anunciada no hello", async () => {
    expect((await ola(servidor.url)).commonRoom).toBe(servidor.sala)
    const ana = await crua()
    const resposta = await reclamar(ana.cliente, servidor.sala)
    expect(resposta.mine).toBe(true)
    expect(await recusado(ana.cliente, servidor.sala)).toBe(false)
  })

  it("duas sessões a sério conversam numa sala de morada opaca", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canal = moradaDeSala(servidor.casa)
    await ana!.session.createSpaceChannel(canal)
    await ana!.session.seat(canal, bruno!.address)
    await ate(() => bruno!.session.channels.includes(canal), "o Welcome chega ao Bruno", 30_000)
    await ana!.session.send(canal, mensagem("da Ana, na opaca"))
    await bruno!.session.send(canal, mensagem("do Bruno, na opaca"))
    await ate(
      () => leu(bruno!, canal, "da Ana, na opaca") && leu(ana!, canal, "do Bruno, na opaca"),
      "cada um lê o outro",
      30_000,
    )
  }, 120_000)
})
