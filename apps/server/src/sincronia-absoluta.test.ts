import { bytesDoNivel0, instantaneoDoCanal } from "@enclave/client-core"
import { appendFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  divergencias,
  levantarServidor,
  resumoDe,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"

/**
 * Absolute sync across accounts: the scenarios in §8.1, marked as measurement.
 *
 * Phase S0 of the plan in `docs/planos/2026-10-20-sincronia-absoluta.md`. Nothing
 * is fixed here: each scenario runs on today's code and prints today's numbers,  * how much it diverges, how long until it matches, what never matches within the
 * deadline. So assertions only lock down what the scenario set up, never the goal.
 * Phases S1 through S6 replace each `medida` with an `expect` of the goal in §2.3.
 *
 * Each measurement goes out on a line `MEDIDA-S0 {json}` and, with
 * `MEDIR_SINCRONIA_SAIDA=<ficheiro>`, also in a JSONL file. That is what the
 * script `scripts/medir-sincronia.mjs` reads to extract p50 and p95.
 *
 * The deadline for each wait is `MEDIR_PRAZO_MS` (20 s by default, so the suite
 * stays fast). "Did not match" means "did not match within the deadline".
 *
 * "An hour offline" is compressed: what counts for sync is what happened while
 * the account was away, not the clock. The server's 30-day retention does not
 * apply (the controlled clock comes in S1).
 */

const PRAZO_MS = Number(process.env["MEDIR_PRAZO_MS"] ?? 20_000)

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
  const linha = JSON.stringify(medida)
  console.log(`MEDIDA-S0 ${linha}`)
  const saida = process.env["MEDIR_SINCRONIA_SAIDA"]
  if (saida) appendFileSync(saida, `${linha}\n`)
}

/**
 * Waits until the accounts have matching summaries, or until the deadline. Returns
 * the ms (or `null`) and, if they did not match, the types that stayed different
 * with each account's count.
 */
async function ateIgualar(
  quem: readonly ContaDeTeste[],
  canal: string,
  desde?: number,
): Promise<{ ms: number | null; diferentes: Record<string, Record<string, number>> }> {
  const inicio = Date.now()
  while (Date.now() - inicio < PRAZO_MS) {
    if (divergencias(quem, canal, desde).length === 0) return { ms: Date.now() - inicio, diferentes: {} }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const diferentes: Record<string, Record<string, number>> = {}
  for (const tipo of divergencias(quem, canal, desde)) {
    diferentes[tipo] = Object.fromEntries(quem.map((conta) => [conta.nome, resumoDe(conta, canal, desde)[tipo].n]))
  }
  return { ms: null, diferentes }
}

const mensagem = (body: string) =>
  ({ t: "message", id: crypto.randomUUID(), body, sentAt: Date.now(), attachments: [] }) as never

const publicacao = (id: string, caption: string) =>
  ({ t: "post", id, postedAt: Date.now(), caption, media: [], links: [], tags: [] }) as never

const temCorpo = (conta: ContaDeTeste, canal: string, corpo: string): boolean =>
  conta.session.history(canal).some((entrada) => entrada.payload["body"] === corpo)

describe("sincronia absoluta (S0: medida, não meta)", () => {
  it("medida: conta desligada durante «uma hora», e o que tem 20 s depois de ligar", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])
    await ana!.session.defineRole(canal, { role: "porteiro", name: "Porteiro", powers: ["convidar"] })
    const antes = await ateIgualar([ana!, bruno!, carla!], canal)

    carla!.session.disconnect()
    for (let i = 0; i < 50; i++) await ana!.session.send(canal, mensagem(`fora ${i}`))
    const posts: string[] = []
    for (let i = 0; i < 5; i++) {
      const id = crypto.randomUUID()
      posts.push(id)
      await ana!.session.send(canal, publicacao(id, `mural ${i}`))
    }
    for (let i = 0; i < 20; i++) await bruno!.session.commentOnPost(canal, posts[i % 5]!, `comentário ${i}`)
    for (const post of posts) await bruno!.session.voteOnPoll(canal, post, 1)
    await ana!.session.assignRoles(canal, bruno!.address, ["porteiro"])
    await ana!.session.openTicket(canal, "", "A porta não fecha")
    await ate(() => temCorpo(bruno!, canal, "fora 49"), "o Bruno lê as 50")
    const entreAnaEBruno = await ateIgualar([ana!, bruno!], canal)

    const inicio = Date.now()
    await carla!.session.connect()
    const ligar = Date.now() - inicio
    const depois = await ateIgualar([ana!, bruno!, carla!], canal)
    registar({
      cenario: "desligada",
      igualAntesMs: antes.ms,
      anaBrunoIguaisMs: entreAnaEBruno.ms,
      anaBrunoDiferentes: entreAnaEBruno.diferentes,
      connectMs: ligar,
      ateIgualarMs: depois.ms,
      diferentes: depois.diferentes,
    })
    expect(temCorpo(ana!, canal, "fora 49")).toBe(true)
  }, 180_000)

  it("medida: cofre no tecto de 400, e o que sobra do mural e das lápides", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const post = crypto.randomUUID()
    await ana!.session.send(canal, publicacao(post, "a publicação antiga"))
    await bruno!.session.commentOnPost(canal, post, "o comentário antigo")
    await ana!.session.send(canal, mensagem("para apagar"))
    await ate(() => temCorpo(bruno!, canal, "para apagar"), "o Bruno lê a mensagem a apagar")
    const alvo = bruno!.session.history(canal).find((e) => e.payload["body"] === "para apagar")!
    await ana!.session.deleteMessage(canal, alvo.payload["id"] as string)
    await ate(
      () => bruno!.session.history(canal).some((e) => e.payload.t === "redact"),
      "a lápide chega ao Bruno",
    )
    const contar = (conta: ContaDeTeste) => {
      const r = resumoDe(conta, canal)
      return { publicacao: r.publicacao.n, comentario: r.comentario.n, apagamento: r.apagamento.n, mensagem: r.mensagem.n }
    }
    const antes = { ana: contar(ana!), bruno: contar(bruno!) }

    for (let i = 0; i < 410; i++) await ana!.session.send(canal, mensagem(`enchimento ${i}`))
    await ate(() => temCorpo(bruno!, canal, "enchimento 409"), "o Bruno lê as 410", 60_000)
    const iguais = await ateIgualar([ana!, bruno!], canal)
    const depois = { ana: contar(ana!), bruno: contar(bruno!) }
    // Does the tombstone still apply? If the tombstone left the cap and the original came back, the body would reappear.
    const originalVisivel = temCorpo(bruno!, canal, "para apagar")
    registar({
      cenario: "tecto",
      antes,
      depois,
      historiaAna: ana!.vault.contents.history[canal]?.length,
      historiaBruno: bruno!.vault.contents.history[canal]?.length,
      ateIgualarMs: iguais.ms,
      diferentes: iguais.diferentes,
      originalApagadoVisivel: originalVisivel,
    })
    expect(antes.ana.publicacao).toBe(1)
  }, 240_000)

  it("medida: membro que entra tarde, e o estado e o mural que recebe", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ana!.session.updateSpaceMeta(canal, { name: "Lagar" })
    await ana!.session.defineRole(canal, { role: "porteiro", name: "Porteiro", powers: ["convidar"] })
    await ana!.session.assignRoles(canal, bruno!.address, ["porteiro"])
    await ana!.session.upsertRoom(canal, { room: "avisos", name: "Avisos" })
    await ana!.session.send(canal, mensagem("antes do lugar"))
    const fixar = ana!.session.history(canal).find((e) => e.payload["body"] === "antes do lugar")!
    await ana!.session.pinMessage(canal, "avisos", {
      id: fixar.payload["id"] as string,
      sender: ana!.address,
      body: "antes do lugar",
      sentAt: fixar.payload["sentAt"] as number,
    })
    const posts: string[] = []
    for (let i = 0; i < 30; i++) {
      const id = crypto.randomUUID()
      posts.push(id)
      await ana!.session.send(canal, publicacao(id, `mural ${i}`))
    }
    for (let i = 0; i < 100; i++) await bruno!.session.commentOnPost(canal, posts[i % 30]!, `comentário ${i}`)
    for (let i = 0; i < 10; i++) {
      await ana!.session.voteOnPoll(canal, posts[i]!, 0)
      await bruno!.session.voteOnPoll(canal, posts[i]!, 1)
    }
    const ticket = await ana!.session.openTicket(canal, "", "Ticket antigo")
    await ana!.session.setTicketState(canal, "", ticket, "working")
    await bruno!.session.openTicket(canal, "", "Ticket do Bruno")
    await ate(() => bruno!.session.history(canal).filter((e) => e.payload["ticket"]).length >= 3, "os tickets chegam ao Bruno")
    const anaBruno = await ateIgualar([ana!, bruno!], canal)

    const inicio = Date.now()
    await ana!.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra")
    const entrar = Date.now() - inicio
    const lugar = carla!.vault.contents.seatSince?.[canal]
    const depois = await ateIgualar([ana!, carla!], canal, lugar)
    const anteriores = carla!.session
      .history(canal)
      .filter((e) => e.payload.t === "message" && !e.payload["ticket"] && e.payload["body"] === "antes do lugar").length
    const r = resumoDe(carla!, canal, lugar)
    // The snapshot of §5 that Ana would give to Carla, with what her vault has.
    const instantaneo = instantaneoDoCanal(ana!.vault.contents, canal, {
      membros: ana!.session.membersOf(canal).map(String),
      proprio: ana!.address,
      ...(lugar !== undefined ? { desde: lugar } : {}),
    })
    registar({
      instantaneoBytes: instantaneo.bytes,
      instantaneoPorParte: instantaneo.porParte,
      nivel0Bytes: bytesDoNivel0(resumoDe(ana!, canal, lugar)),
      cenario: "entra-tarde",
      anaBrunoIguaisMs: anaBruno.ms,
      anaBrunoDiferentes: anaBruno.diferentes,
      seatMs: entrar,
      lugar,
      ateIgualarMs: depois.ms,
      diferentes: depois.diferentes,
      carla: Object.fromEntries(Object.entries(r).map(([tipo, par]) => [tipo, par.n])),
      mensagensAnterioresAoLugar: anteriores,
    })
    expect(carla!.session.channels).toContain(canal)
  }, 240_000)

  it("medida: servidor que perde eventos, e se o que perdeu volta", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])
    carla!.session.disconnect()
    for (let i = 0; i < 10; i++) await ana!.session.send(canal, mensagem(`perdida ${i}`))
    await ate(() => temCorpo(bruno!, canal, "perdida 9"), "o Bruno lê as 10")
    // Bruno has the `seq` from the server of each one (Ana has -1: it is her send).
    const seqs = bruno!.session
      .history(canal)
      .filter((e) => String(e.payload["body"]).startsWith("perdida "))
      .map((e) => e.seq)
      .sort((a, b) => a - b)
    const apagar = seqs.slice(2, 7)
    const base = new DatabaseSync(servidor.baseDeDados)
    for (const seq of apagar) base.prepare("DELETE FROM events WHERE channel = ? AND seq = ?").run(canal, seq)
    base.close()

    await carla!.session.connect()
    const depois = await ateIgualar([ana!, bruno!, carla!], canal)
    const naCarla = carla!.session.history(canal).filter((e) => String(e.payload["body"]).startsWith("perdida ")).length
    registar({
      cenario: "servidor-perde",
      apagadas: apagar.length,
      mensagensNaCarla: naCarla,
      ateIgualarMs: depois.ms,
      diferentes: depois.diferentes,
      lacunasDaCarla: carla!.vault.contents.lacunas?.[canal]?.length ?? 0,
    })
    expect(seqs).toHaveLength(10)
  }, 180_000)
})
