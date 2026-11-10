import { TIPOS_RELATAVEIS, type ResumoNivel0 } from "@enclave/client-core"
import { appendFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
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
 * Phase S4 of absolute sync: anti-entropy between accounts, with real sessions
 * against a real server (`docs/planos/2026-10-20-sincronia-absoluta.md`,
 * §8.1). Each scenario ends with matching summaries in the types that are
 * reported (in the window of the most recent place) and writes a line
 * `MEDIDA-S4` with the time taken: that is what `scripts/medir-sincronia.mjs`
 * collects.
 *
 * The targets from §2.3: 30 s with accounts connected, 2 min after return.
 */

const META_LIGADAS_MS = 30_000
const META_VOLTAR_MS = 120_000

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  await servidor?.fechar()
})

async function contas(...nomes: string[]): Promise<ContaDeTeste[]> {
  const novas = await contasDeTeste(servidor, nomes)
  abertas.push(...novas)
  return novas
}

function registar(medida: Record<string, unknown>): void {
  const linha = JSON.stringify({ fase: "S4", ...medida })
  console.log(`MEDIDA-S4 ${linha}`)
  const saida = process.env["MEDIR_SINCRONIA_SAIDA"]
  if (saida) appendFileSync(saida, `${linha}\n`)
}

const mensagem = (body: string) =>
  ({ t: "message", id: crypto.randomUUID(), body, sentAt: Date.now(), attachments: [] }) as never

const publicacao = (id: string, caption: string) =>
  ({ t: "post", id, postedAt: Date.now(), caption, media: [], links: [], tags: [] }) as never

const corpos = (conta: ContaDeTeste, canal: string, prefixo: string): string[] =>
  conta.session
    .history(canal)
    .map((entrada) => String(entrada.payload["body"] ?? entrada.payload["caption"] ?? ""))
    .filter((corpo) => corpo.startsWith(prefixo))

/** The common window: the most recent place across accounts. */
function janela(quem: readonly ContaDeTeste[], canal: string): number {
  return Math.max(...quem.map((conta) => conta.vault.contents.seatSince?.[canal] ?? -1))
}

/** The reportable types where accounts differ, in the common window. */
function diferentes(quem: readonly ContaDeTeste[], canal: string): Record<string, number[]> {
  const desde = janela(quem, canal)
  const resumos: ResumoNivel0[] = quem.map((conta) => conta.session.resumoDoCanal(canal, desde))
  const saida: Record<string, number[]> = {}
  for (const tipo of TIPOS_RELATAVEIS) {
    const pares = resumos.map((r) => r[tipo])
    if (pares.some((par) => par.h !== pares[0]!.h)) saida[tipo] = pares.map((par) => par.n)
  }
  return saida
}

async function ateIguais(quem: readonly ContaDeTeste[], canal: string, prazoMs: number): Promise<number | null> {
  const inicio = Date.now()
  while (Date.now() - inicio < prazoMs) {
    if (Object.keys(diferentes(quem, canal)).length === 0) return Date.now() - inicio
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return null
}

function apagarDoServidor(canal: string, seqs: readonly number[]): void {
  const base = new DatabaseSync(servidor.baseDeDados)
  for (const seq of seqs) base.prepare("DELETE FROM events WHERE channel = ? AND seq = ?").run(canal, seq)
  base.close()
}

const seqsDe = (conta: ContaDeTeste, canal: string, prefixo: string): number[] =>
  conta.session
    .history(canal)
    .filter((e) => String(e.payload["body"] ?? e.payload["caption"] ?? "").startsWith(prefixo))
    .map((e) => e.seq)
    .filter((seq) => seq >= 0)
    .sort((a, b) => a - b)

const estatisticas = (quem: readonly ContaDeTeste[]) =>
  Object.fromEntries(quem.map((conta) => [conta.nome, conta.session.estatisticasDaSincronia]))

describe("S4: anti-entropia entre contas", () => {
  it("servidor que perde eventos: o que perdeu volta por relato de quem o tem", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])
    carla!.session.disconnect()
    for (let i = 0; i < 10; i++) await ana!.session.send(canal, mensagem(`perdida ${i}`))
    await ate(() => corpos(bruno!, canal, "perdida ").length === 10, "o Bruno lê as 10")
    apagarDoServidor(canal, seqsDe(bruno!, canal, "perdida ").slice(2, 7))

    const inicio = Date.now()
    await carla!.session.connect()
    const ms = await ateIguais([ana!, bruno!, carla!], canal, META_VOLTAR_MS)
    registar({ cenario: "servidor-perde", ateIgualarMs: ms, desdeLigarMs: Date.now() - inicio, diferentes: diferentes([ana!, bruno!, carla!], canal), estatisticas: estatisticas([ana!, bruno!, carla!]) })
    expect(ms).not.toBeNull()
    expect(corpos(carla!, canal, "perdida ").sort()).toEqual(corpos(bruno!, canal, "perdida ").sort())
    // What comes back, comes back with its original seq, and only once.
    expect(seqsDe(carla!, canal, "perdida ")).toEqual(seqsDe(bruno!, canal, "perdida "))
    // And marked as reported: the seq was told by whoever reported it, and it defers to the server (S4 review, finding 6).
    const relatadas = carla!.session.history(canal).filter((e) => String(e.payload["body"] ?? "").startsWith("perdida ") && e.relatada)
    expect(relatadas).toHaveLength(5)
    expect(carla!.avisos).not.toContain("channel-deaf")
  }, 180_000)

  it("conta desligada: ao voltar fica igual dentro da meta, sem relatos (o servidor tinha tudo)", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])
    carla!.session.disconnect()
    const posts: string[] = []
    for (let i = 0; i < 20; i++) await ana!.session.send(canal, mensagem(`fora ${i}`))
    for (let i = 0; i < 5; i++) {
      const id = crypto.randomUUID()
      posts.push(id)
      await ana!.session.send(canal, publicacao(id, `mural ${i}`))
    }
    for (let i = 0; i < 10; i++) await bruno!.session.commentOnPost(canal, posts[i % 5]!, `comentário ${i}`)
    await ate(() => corpos(bruno!, canal, "fora ").length === 20, "o Bruno lê as 20")
    const inicio = Date.now()
    await carla!.session.connect()
    const ms = await ateIguais([ana!, bruno!, carla!], canal, META_VOLTAR_MS)
    registar({ cenario: "desligada", ateIgualarMs: ms, desdeLigarMs: Date.now() - inicio, estatisticas: estatisticas([ana!, bruno!, carla!]) })
    expect(ms).not.toBeNull()
    expect(ms!).toBeLessThan(META_VOLTAR_MS)
  }, 180_000)

  it("duas contas divergem nos dois sentidos, e a terceira entra tarde: tudo igual, sem conversa anterior ao lugar", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ana!.session.send(canal, mensagem("antes do lugar da Carla"))

    // Ana publishes with Bruno offline, and the server loses it.
    bruno!.session.disconnect()
    for (let i = 0; i < 3; i++) await ana!.session.send(canal, publicacao(crypto.randomUUID(), `da Ana ${i}`))
    await ate(() => seqsDe(ana!, canal, "da Ana ").length === 3, "os ecos da Ana")
    apagarDoServidor(canal, seqsDe(ana!, canal, "da Ana "))
    ana!.session.disconnect()

    // Bruno publishes with Ana offline, and the server loses it too.
    await bruno!.session.connect()
    for (let i = 0; i < 3; i++) await bruno!.session.send(canal, publicacao(crypto.randomUUID(), `do Bruno ${i}`))
    await ate(() => seqsDe(bruno!, canal, "do Bruno ").length === 3, "os ecos do Bruno")
    apagarDoServidor(canal, seqsDe(bruno!, canal, "do Bruno "))

    const inicio = Date.now()
    await ana!.session.connect()
    const ms = await ateIguais([ana!, bruno!], canal, META_LIGADAS_MS)
    registar({ cenario: "duas-divergem", ateIgualarMs: ms, desdeLigarMs: Date.now() - inicio, diferentes: diferentes([ana!, bruno!], canal), estatisticas: estatisticas([ana!, bruno!]) })
    expect(ms).not.toBeNull()
    expect(corpos(ana!, canal, "do Bruno ")).toHaveLength(3)
    expect(corpos(bruno!, canal, "da Ana ")).toHaveLength(3)

    // Carla joins late and receives all six posts, and nothing from the earlier conversation.
    const entrada = Date.now()
    await ana!.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra")
    const msTarde = await ateIguais([ana!, bruno!, carla!], canal, META_LIGADAS_MS)
    registar({ cenario: "terceira-entra-tarde", ateIgualarMs: msTarde, desdeSentarMs: Date.now() - entrada, diferentes: diferentes([ana!, bruno!, carla!], canal), estatisticas: estatisticas([ana!, bruno!, carla!]) })
    expect(msTarde).not.toBeNull()
    expect(corpos(carla!, canal, "da Ana ")).toHaveLength(3)
    expect(corpos(carla!, canal, "do Bruno ")).toHaveLength(3)
    expect(corpos(carla!, canal, "antes do lugar")).toHaveLength(0)
  }, 240_000)

  it("membro que entra tarde: mural, comentários, votos e tickets chegam em 30 s; nada de antes do lugar", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ana!.session.send(canal, mensagem("antes do lugar"))
    const posts: string[] = []
    for (let i = 0; i < 15; i++) {
      const id = crypto.randomUUID()
      posts.push(id)
      await ana!.session.send(canal, publicacao(id, `mural ${i}`))
    }
    for (let i = 0; i < 40; i++) await bruno!.session.commentOnPost(canal, posts[i % 15]!, `comentário ${i}`)
    for (let i = 0; i < 5; i++) await bruno!.session.voteOnPoll(canal, posts[i]!, 1)
    await bruno!.session.openTicket(canal, "", "Ticket do Bruno")
    await ate(() => Object.keys(diferentes([ana!, bruno!], canal)).length === 0, "a Ana e o Bruno iguais")

    const inicio = Date.now()
    await ana!.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra")
    const ms = await ateIguais([ana!, bruno!, carla!], canal, META_LIGADAS_MS)
    registar({ cenario: "entra-tarde", ateIgualarMs: ms, desdeSentarMs: Date.now() - inicio, diferentes: diferentes([ana!, bruno!, carla!], canal), estatisticas: estatisticas([ana!, bruno!, carla!]) })
    expect(ms).not.toBeNull()
    expect(carla!.session.history(canal).filter((e) => e.payload.t === "post.comment")).toHaveLength(40)
    expect(corpos(carla!, canal, "antes do lugar")).toHaveLength(0)
    expect(carla!.avisos).not.toContain("channel-deaf")
  }, 240_000)

  it("relator mentiroso: um payload alterado com a autoria de outro é recusado e não entra", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])
    await ana!.session.send(canal, publicacao(crypto.randomUUID(), "verdadeira"))
    await ate(() => corpos(bruno!, canal, "verdadeira").length === 1 && corpos(carla!, canal, "verdadeira").length === 1, "a publicação chega")
    const original = bruno!.session.history(canal).find((e) => e.payload["caption"] === "verdadeira")!
    expect(original.payload["autoria"]).toBeDefined()
    // Bruno reports a post that Ana never made, claiming the real author.
    const falsa = { ...original.payload, id: crypto.randomUUID(), caption: "falsa" }
    await bruno!.session.send(canal, { t: "typing", until: 0, relatos: { v: 1, itens: [{ s: -1, a: ana!.address, p: falsa }] } } as never)
    await ate(() => (carla!.session.estatisticasDaSincronia.relatosRecusados.autoria ?? 0) >= 1, "a Carla recusa")
    expect(corpos(carla!, canal, "falsa")).toHaveLength(0)
    expect(corpos(ana!, canal, "falsa")).toHaveLength(0)
  }, 120_000)

  it("aparelho revogado a relatar: o relato assinado por ele é recusado", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])
    carla!.session.disconnect()
    await ana!.session.send(canal, publicacao(crypto.randomUUID(), "do aparelho revogado"))
    await ate(() => seqsDe(bruno!, canal, "do aparelho revogado").length === 1, "o Bruno tem-na")
    apagarDoServidor(canal, seqsDe(bruno!, canal, "do aparelho revogado"))
    // Carla learned (from the revocation of Ana's account) that device was removed.
    const aparelhoDaAna = Buffer.from(ana!.session.identity.deviceSigningPublicKey).toString("base64url")
    ;(carla!.vault.contents as { revokedDevices?: Record<string, string[]> }).revokedDevices = { [ana!.address]: [aparelhoDaAna] }
    await carla!.session.connect()
    await ate(() => (carla!.session.estatisticasDaSincronia.relatosRecusados.aparelho ?? 0) >= 1, "a Carla recusa o relato", 30_000)
    expect(corpos(carla!, canal, "do aparelho revogado")).toHaveLength(0)
  }, 120_000)

  it("tempestade: cinco membros, a quinta entra tarde; responde um só, e cada item vai no máximo uma vez e meia", async () => {
    const todas = await contas("Ana", "Bruno", "Dora", "Eva", "Carla")
    const [ana, bruno, dora, eva, carla] = todas
    const canal = await canalComTodos(servidor, ana!, [bruno!, dora!, eva!])
    const quatro = [ana!, bruno!, dora!, eva!]
    const posts: string[] = []
    for (let i = 0; i < 8; i++) {
      const id = crypto.randomUUID()
      posts.push(id)
      await ana!.session.send(canal, publicacao(id, `mural ${i}`))
    }
    for (let i = 0; i < 24; i++) await quatro[1 + (i % 3)]!.session.commentOnPost(canal, posts[i % 8]!, `comentário ${i}`)
    await ate(() => Object.keys(diferentes(quatro, canal)).length === 0, "as quatro iguais", 60_000)
    const antes = Object.fromEntries(quatro.map((c) => [c.nome, c.session.estatisticasDaSincronia.relatosEnviados]))

    await ana!.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra")
    const ms = await ateIguais(todas, canal, META_LIGADAS_MS)
    const relataram = quatro.filter((c) => c.session.estatisticasDaSincronia.relatosEnviados > (antes[c.nome] ?? 0))
    const relatados = quatro.reduce((soma, c) => soma + c.session.estatisticasDaSincronia.relatosEnviados - (antes[c.nome] ?? 0), 0)
    registar({ cenario: "tempestade", ateIgualarMs: ms, relataram: relataram.map((c) => c.nome), relatados, estatisticas: estatisticas(todas) })
    expect(ms).not.toBeNull()
    expect(relataram.length).toBeLessThanOrEqual(1)
    expect(relatados).toBeLessThanOrEqual(Math.ceil(1.5 * (8 + 24)))
  }, 300_000)
})
