import { monitorEventLoopDelay } from "node:perf_hooks"
import { DatabaseSync } from "node:sqlite"
import { generateIdentity } from "@enclave/protocol"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"

/**
 * What a join costs those already in the common room (slow-after-join, 4/11/2026).
 *
 * Not a test: it is the measurement the report cites, and it only runs with `MEDIR_ESCALA=1`.
 * Real sessions and server. Ana sets up the common room like `!984` (3 categories,
 * 10 rooms, one role assigned to `ATRIBUICOES` accounts), and Duarte, already seated, is
 * the one observed: how many frames he receives, how many vault saves he makes, how much
 * time is spent inside them and how long the event loop stays blocked, from the joiner's
 * commit until the room settles. Duarte's vault carries `LASTRO_MB` of ballast (directory
 * avatars), because a real vault, with history and 150 profiles, is not empty.
 *
 *   MEDIR_ESCALA=1 LASTRO_MB=8 npx vitest run --root apps/server src/medida-entrada-na-sala-comum.test.ts
 */

const MEMBROS = Number(process.env.MEMBROS ?? 12)
const ATRIBUICOES = Number(process.env.ATRIBUICOES ?? 80)
const LASTRO_MB = Number(process.env.LASTRO_MB ?? 0)
const ENTRADAS = Number(process.env.ENTRADAS ?? 2)
const LASTRO_ADMIN_MB = Number(process.env.LASTRO_ADMIN_MB ?? 0)

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 60_000)

afterAll(async () => {
  desligarContas(abertas.splice(0))
  await servidor?.fechar()
})

describe.runIf(process.env.MEDIR_ESCALA)("medida: uma entrada na sala comum, vista de quem lá está", () => {
  it("conta tramas, gravações do cofre e paragens da volta de eventos", async () => {
    const comum = servidor.sala
    const [ana, duarte] = (await contasDeTeste(servidor, ["Ana", "Duarte"])) as [ContaDeTeste, ContaDeTeste]
    abertas.push(ana, duarte)
    await ana.session.ensureCommonRoom()
    await ate(() => ana.session.channels.includes(comum), "a Ana está na sala comum")
    if (!ana.session.founderOf(comum)) await ana.session.claimFounder(comum)
    await ate(() => ana.session.founderOf(comum) === ana.address, "a Ana funda a sala comum")
    for (let c = 0; c < 3; c++) await ana.session.upsertCategory(comum, { category: `cat${c}`, position: c })
    for (let s = 0; s < 10; s++) await ana.session.upsertRoom(comum, { room: `sala${s}`, name: `sala ${s}`, category: `cat${s % 3}` })
    await ana.session.defineRole(comum, { role: "membro", name: "Membro", powers: [] })

    const membros = await contasDeTeste(servidor, Array.from({ length: MEMBROS }, (_, i) => `m${i}`))
    abertas.push(...membros)
    for (const conta of [duarte, ...membros]) {
      await conta.session.ensureCommonRoom()
      await ate(() => conta.session.channels.includes(comum), `${conta.nome} entra`, 60_000)
    }
    // The assignments from `!984`: one per person with a role, announced again at each join.
    const comCargo = [duarte, ...membros].map((c) => c.address as string)
    while (comCargo.length < ATRIBUICOES) comCargo.push(generateIdentity(servidor.casa).address)
    for (const quem of comCargo) await ana.session.assignRoles(comum, quem, ["membro"])
    await ate(() => duarte.session.roomsOf(comum).length >= 10, "as salas chegam ao Duarte", 60_000)

    if (LASTRO_MB > 0) {
      await duarte.vault.update((c) => {
        for (let i = 0; i < 150; i++) {
          c.directory[`@lastro${i}:${servidor.casa}`] = {
            at: 1,
            payload: { t: "profile", displayName: `l${i}`, avatar: "A".repeat(Math.round((LASTRO_MB * 1e6) / 150)) },
          } as never
        }
      })
    }
    // The vault of whoever tidies the room, which is who sends the cascade at each join.
    if (LASTRO_ADMIN_MB > 0) {
      await ana.vault.update((c) => {
        for (let i = 0; i < 150; i++) {
          c.directory[`@lastro${i}:${servidor.casa}`] = {
            at: 1,
            payload: { t: "profile", displayName: `l${i}`, avatar: "A".repeat(Math.round((LASTRO_ADMIN_MB * 1e6) / 150)) },
          } as never
        }
      })
    }
    // Let whatever the setup stirred up settle.
    await new Promise((r) => setTimeout(r, 8_000))

    // Duarte's instrumentation: vault saves and the time spent inside them.
    let gravacoes = 0
    let msNoCofre = 0
    const update = duarte.vault.update.bind(duarte.vault)
    duarte.vault.update = async (mutate) => {
      gravacoes++
      const t0 = performance.now()
      try {
        return await update(mutate)
      } finally {
        msNoCofre += performance.now() - t0
      }
    }
    const base = new DatabaseSync(servidor.baseDeDados, { readOnly: true })
    const contar = () =>
      base.prepare("SELECT kind, COUNT(*) AS n FROM events WHERE channel = ? GROUP BY kind").all(comum) as { kind: string; n: number }[]
    const porTipo = (antes: { kind: string; n: number }[], depois: { kind: string; n: number }[]) =>
      Object.fromEntries(depois.map(({ kind, n }) => [kind, n - (antes.find((a) => a.kind === kind)?.n ?? 0)]))
    const tamanhoDoCofre = () => duarte.backend.bytes?.length ?? 0

    for (let e = 0; e < ENTRADAS; e++) {
      gravacoes = 0
      msNoCofre = 0
      const escritasAntes = duarte.backend.escritas
      const escritasDaAnaAntes = ana.backend.escritas
      const atrasoDaAna = { inicio: 0, fim: 0 }
      void atrasoDaAna
      const eventosAntes = contar()
      const atraso = monitorEventLoopDelay({ resolution: 10 })
      atraso.enable()
      const [novo] = await contasDeTeste(servidor, [`novo${e}`])
      abertas.push(novo!)
      const t0 = performance.now()
      await novo!.session.ensureCommonRoom()
      await ate(() => novo!.session.channels.includes(comum), "quem chega entra", 60_000)
      // Until the room settles: 4 seconds straight with no vault saves by Duarte (max 60 s).
      let ultima = duarte.backend.escritas
      let quieto = performance.now()
      while (performance.now() - t0 < 60_000) {
        await new Promise((r) => setTimeout(r, 250))
        if (duarte.backend.escritas !== ultima) {
          ultima = duarte.backend.escritas
          quieto = performance.now()
        } else if (performance.now() - quieto > 4_000) break
      }
      atraso.disable()
      const duracao = (quieto - t0) / 1000
      const eventosDepois = contar()
      console.log(
        JSON.stringify({
          entrada: e + 1,
          membros: MEMBROS + 3 + e,
          atribuicoes: ATRIBUICOES,
          cofreKB: Math.round(tamanhoDoCofre() / 1024),
          eventosNoCanal: porTipo(eventosAntes, eventosDepois),
          gravacoesDoCofre: duarte.backend.escritas - escritasAntes,
          gravacoesDoCofreDaAna: ana.backend.escritas - escritasDaAnaAntes,
          cofreDaAnaKB: Math.round((ana.backend.bytes?.length ?? 0) / 1024),
          updates: gravacoes,
          msDentroDoCofre: Math.round(msNoCofre),
          segundosAteAcalmar: Number(duracao.toFixed(1)),
          voltaDeEventosMaxMs: Math.round(atraso.max / 1e6),
          voltaDeEventosP99Ms: Math.round(atraso.percentile(99) / 1e6),
        }),
      )
    }
    expect(true).toBe(true)
  }, 900_000)
})
