import { itemDoPayload, TECTOS_DOS_ANEXOS, TIPOS_DO_INSTANTANEO, type TipoDoResumo } from "@enclave/client-core"
import { appendFileSync } from "node:fs"
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished } from "vitest"
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
 * Phase S5 of absolute sync: the snapshot for late arrivals and attachments on
 * request, with three real sessions against a real server
 * (`docs/planos/2026-10-20-sincronia-absoluta.md`, §5 and §8.1).
 *
 * Each scenario writes a line `MEDIDA-S5` with the time and bytes of the
 * snapshot (§5.5): that is what `scripts/medir-sincronia.mjs` collects.
 */

const META_LIGADAS_MS = 30_000

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
  const linha = JSON.stringify({ fase: "S5", ...medida })
  console.log(`MEDIDA-S5 ${linha}`)
  const saida = process.env["MEDIR_SINCRONIA_SAIDA"]
  if (saida) appendFileSync(saida, `${linha}\n`)
}

const mensagem = (body: string) =>
  ({ t: "message", id: crypto.randomUUID(), body, sentAt: Date.now(), attachments: [] }) as never

const IMAGEM = `data:image/png;base64,${"iVBORw0KGgoAAAANSUhEUg".repeat(200)}`

const publicacao = (id: string, caption: string, comImagem = false) =>
  ({
    t: "post",
    id,
    postedAt: Date.now(),
    caption,
    media: comImagem ? [{ name: "foto.png", mediaType: "image/png", byteLength: 3300, inline: IMAGEM }] : [],
    links: [],
    tags: [],
  }) as never

const corpos = (conta: ContaDeTeste, canal: string, prefixo: string): string[] =>
  conta.session
    .history(canal)
    .map((entrada) => String(entrada.payload["body"] ?? entrada.payload["caption"] ?? ""))
    .filter((corpo) => corpo.startsWith(prefixo))

/** The snapshot types where accounts differ (no window: they span the entire channel). */
function diferentes(quem: readonly ContaDeTeste[], canal: string): Record<string, number[]> {
  const resumos = quem.map((conta) => conta.session.resumoDoCanal(canal, Number.MAX_SAFE_INTEGER))
  const saida: Record<string, number[]> = {}
  for (const tipo of TIPOS_DO_INSTANTANEO) {
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

/**
 * The order in which items in `ausentes` arrived at an account: `message` events
 * in the order they went out, each item once. The authors are offline, so what
 * arrives from them can only arrive via report.
 */
function ouvirChegadas(conta: ContaDeTeste, ausentes: readonly ContaDeTeste[]): () => TipoDoResumo[] {
  const deles = new Set(ausentes.map((a) => a.address))
  const vistas = new Set<string>()
  const ordem: TipoDoResumo[] = []
  conta.session.on("message", (evento) => {
    if (!deles.has(String(evento.sender))) return
    const item = itemDoPayload(String(evento.sender), evento.payload as never)
    if (!item || vistas.has(item.chave)) return
    vistas.add(item.chave)
    ordem.push(item.tipo)
  })
  return () => [...ordem]
}

const ORDEM_DO_PLANO: readonly TipoDoResumo[] = TIPOS_DO_INSTANTANEO

describe("S5: o instantâneo a quem entra tarde", () => {
  it("quem entra tarde recebe o estado e o mural pela ordem do §5.2, num pedido de tipo inteiro; nada de antes do lugar", async () => {
    const [ana, bruno, dora, carla] = await contas("Ana", "Bruno", "Dora", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!, dora!])
    await ana!.session.send(canal, mensagem("antes do lugar"))
    const posts: string[] = []
    for (let i = 0; i < 20; i++) {
      const id = crypto.randomUUID()
      posts.push(id)
      await ana!.session.send(canal, publicacao(id, `mural ${i}`))
    }
    for (let i = 0; i < 40; i++) await dora!.session.commentOnPost(canal, posts[i % 20]!, `comentário ${i}`)
    for (let i = 0; i < 20; i++) await dora!.session.reactToPost(canal, posts[i]!, "❤️")
    for (let i = 0; i < 5; i++) await dora!.session.voteOnPoll(canal, posts[i]!, 1)
    await dora!.session.openTicket(canal, "", "Ticket da Dora")
    await ate(() => Object.keys(diferentes([ana!, bruno!, dora!], canal)).length === 0, "as três iguais", 60_000)

    /*
      Ana and Dora leave before Carla joins: so nothing from them reaches Carla
      through their own resend (S1). What reaches Carla from them arrives via Bruno's
      report, and that is what gets ordered.
    */
    ana!.session.disconnect()
    dora!.session.disconnect()
    const chegadas = ouvirChegadas(carla!, [ana!, dora!])
    const bytesAntes = bruno!.session.estatisticasDaSincronia.bytesDeRelato
    const inicio = Date.now()
    await bruno!.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra")
    const ms = await ateIguais([bruno!, carla!], canal, META_LIGADAS_MS)
    const bytes = bruno!.session.estatisticasDaSincronia.bytesDeRelato - bytesAntes
    const ordem = chegadas()
    registar({
      cenario: "instantaneo",
      ateIgualarMs: ms,
      desdeSentarMs: Date.now() - inicio,
      bytesDoInstantaneo: bytes,
      itens: ordem.length,
      porTipo: Object.fromEntries(ORDEM_DO_PLANO.map((tipo) => [tipo, ordem.filter((t) => t === tipo).length])),
      diferentes: diferentes([bruno!, carla!], canal),
      pedidos: carla!.session.estatisticasDaSincronia.pedidosEnviados,
      instantaneos: carla!.session.estatisticasDaSincronia.instantaneosPedidos,
    })
    expect(ms).not.toBeNull()
    expect(carla!.session.estatisticasDaSincronia.instantaneosPedidos).toBeGreaterThanOrEqual(1)
    expect(corpos(carla!, canal, "mural ")).toHaveLength(20)
    expect(carla!.session.history(canal).filter((e) => e.payload.t === "post.comment")).toHaveLength(40)
    // By the order in §5.2: the type index never goes down.
    const posicoes = ordem.filter((tipo) => ORDEM_DO_PLANO.includes(tipo)).map((tipo) => ORDEM_DO_PLANO.indexOf(tipo))
    expect(posicoes.length).toBeGreaterThanOrEqual(1 + 20 + 40 + 20 + 5 + 1)
    expect(ordem[0]).toBe("fundador")
    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b))
    // The conversation before the seat never arrives, not even via report.
    expect(corpos(carla!, canal, "antes do lugar")).toHaveLength(0)
    expect(carla!.avisos).not.toContain("channel-deaf")
    // The seat date was saved, so the interface can mark it.
    const lugar = carla!.session.lugarEm(canal)
    expect(lugar).not.toBeNull()
    expect(lugar!.seq).toBe(carla!.vault.contents.seatSince?.[canal])
    expect(Math.abs(lugar!.em - Date.now())).toBeLessThan(5 * 60_000)
    // The founder has no marker.
    expect(bruno!.session.lugarEm(canal)).not.toBeNull()
    expect(ana!.session.lugarEm(canal)).toBeNull()
    // And the state that Diagnostics shows.
    await ate(() => carla!.session.estadoDaSincronia().find((e) => e.channel === canal)?.estado === "igual", "a Carla igual", 20_000)
    expect(carla!.session.estadoDaSincronia().find((e) => e.channel === canal)?.ultimaComparacao).toBeTypeOf("number")
  }, 240_000)

  it("a regra do lugar: um relato à mão de conversa anterior ao lugar é recusado por quem entrou", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ana!.session.send(canal, mensagem("segredo de antes"))
    await ate(() => corpos(bruno!, canal, "segredo de antes").length === 1, "o Bruno lê-a")
    await ana!.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra")
    const antiga = bruno!.session.history(canal).find((e) => e.payload["body"] === "segredo de antes")!
    expect(antiga.payload["autoria"]).toBeDefined()
    // Bruno, in bad faith, reports the earlier conversation with Ana's real authorship.
    await bruno!.session.send(canal, {
      t: "typing",
      until: 0,
      relatos: { v: 1, itens: [{ s: antiga.seq, a: ana!.address, p: antiga.payload }] },
    } as never)
    await ate(() => (carla!.session.estatisticasDaSincronia.relatosRecusados.lugar ?? 0) >= 1, "a Carla recusa pelo lugar")
    expect(corpos(carla!, canal, "segredo de antes")).toHaveLength(0)
  }, 120_000)
})

describe("S5: a data do lugar", () => {
  it("um membro antigo sem `lugares` que é reassentado não ganha «Entraste aqui» no meio da conversa", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    expect(bruno!.session.lugarEm(canal)).not.toBeNull()
    // Bruno as a member from before this version: the vault did not save the seat.
    const cofre = bruno!.vault.contents as unknown as { sincronia?: { lugares?: Record<string, unknown> } }
    delete cofre.sincronia!.lugares![canal]
    const epocas = bruno!.session.groupFor(canal)?.state.groupContext.epoch ?? 0n
    bruno!.session.requestRejoin(canal)
    await ate(() => (bruno!.session.groupFor(canal)?.state.groupContext.epoch ?? 0n) > epocas + 1n, "o Bruno é reassentado", 20_000)
    expect(bruno!.session.lugarEm(canal)).toBeNull()
  }, 60_000)

  it("numa directa não há lugar a marcar", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const dm = await ana!.session.openDirect(bruno!.address)
    await ate(() => bruno!.session.channels.includes(dm), "o Bruno entra na directa")
    expect(bruno!.session.lugarEm(dm)).toBeNull()
    expect(ana!.session.lugarEm(dm)).toBeNull()
  }, 60_000)
})

describe("S5: o custo do instantâneo à escala do plano (§5.5)", () => {
  /*
    The case from §5.5: 200 text posts, 600 comments, 1,000 likes and votes.
    Slow (1,800 sends), so only with MEDIR_S5_GRANDE=1, which the script
    `scripts/medir-sincronia.mjs` enables. Writes the snapshot bytes.
  */
  it.skipIf(!process.env["MEDIR_S5_GRANDE"])("200 publicações, 600 comentários, 1.000 gostos e votos: bytes e tempo", async () => {
    const [ana, bruno, dora, carla] = await contas("Ana", "Bruno", "Dora", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!, dora!])
    const posts: string[] = []
    for (let i = 0; i < 200; i++) {
      const id = crypto.randomUUID()
      posts.push(id)
      await ana!.session.send(canal, publicacao(id, `Publicação ${i}: ${"texto de exemplo com algumas palavras ".repeat(20)}`))
    }
    for (let i = 0; i < 600; i++) await dora!.session.commentOnPost(canal, posts[i % 200]!, `Comentário ${i}: ${"uma frase curta ".repeat(15)}`)
    for (let i = 0; i < 800; i++) await (i % 2 ? ana! : dora!).session.reactToPost(canal, posts[i % 200]!, "❤️")
    for (let i = 0; i < 200; i++) await dora!.session.voteOnPoll(canal, posts[i]!, 1)
    /*
      With 1,800 sends in a row, Dora hits the server's 600-per-minute cap.
      Before S6 the server dropped the excess SILENTLY, and after 4 min Bruno was
      still missing 45% of likes and all votes. Since S6 the server refuses with
      `rate-limited` and the client waits and retries (`sincronia-ritmo.test.ts`):
      the sends take as long as the cap demands, and the three accounts match
      right after the last one.
    */
    const iguaisAntes = await ateIguais([ana!, bruno!, dora!], canal, 60_000)
    expect(iguaisAntes).not.toBeNull()
    const doBruno = bruno!.session.resumoDoCanal(canal, Number.MAX_SAFE_INTEGER)
    ana!.session.disconnect()
    dora!.session.disconnect()
    const antes = { ...bruno!.session.estatisticasDaSincronia }
    const inicio = Date.now()
    await bruno!.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra")
    const ms = await ateIguais([bruno!, carla!], canal, 180_000)
    const depois = bruno!.session.estatisticasDaSincronia
    registar({
      cenario: "instantaneo-grande",
      ateIgualarMs: ms,
      bytesDoInstantaneo: depois.bytesDeRelato - antes.bytesDeRelato,
      tramas: depois.tramasDeRelato - antes.tramasDeRelato,
      itens: depois.relatosEnviados - antes.relatosEnviados,
      diferentes: diferentes([bruno!, carla!], canal),
      tresIguaisAntes: iguaisAntes !== null,
      doBruno: { publicacao: doBruno.publicacao.n, comentario: doBruno.comentario.n, gosto: doBruno.gosto.n, voto: doBruno.voto.n },
    })
    expect(ms).not.toBeNull()
  }, 900_000)
})

describe("S5: os anexos a pedido", () => {
  it("o anexo chega sem bytes no instantâneo; a pedido, chegam e conferem; um anexo com `m` errado é recusado", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const id = crypto.randomUUID()
    await ana!.session.send(canal, publicacao(id, "com fotografia", true))
    await ate(() => corpos(bruno!, canal, "com fotografia").length === 1, "o Bruno tem-na")
    ana!.session.disconnect()
    await bruno!.session.seat(canal, carla!.address)
    await ate(() => corpos(carla!, canal, "com fotografia").length === 1, "a publicação chega à Carla", META_LIGADAS_MS)
    const chegada = carla!.session.history(canal).find((e) => e.payload["id"] === id)!
    expect((chegada.payload["media"] as Record<string, unknown>[])[0]).toMatchObject({ evicted: true, name: "foto.png" })

    // A reporter that swaps the bytes in transit: Bruno, on the way out, only this time.
    const enviar = bruno!.session.send.bind(bruno!.session)
    let trocar = true
    bruno!.session.send = (async (destino: string, payload: Record<string, unknown>) => {
      const relatos = payload["relatos"] as { q?: string; itens: { p: Record<string, unknown> }[] } | undefined
      if (trocar && relatos?.q?.startsWith("anx.")) {
        trocar = false
        const copia = structuredClone(payload) as typeof payload
        const p = (copia["relatos"] as typeof relatos).itens[0]!.p
        const media = p["media"] as Record<string, unknown>[]
        media[0] = { ...media[0], inline: `data:image/png;base64,${"AAAA".repeat(500)}` }
        return enviar(destino as never, copia as never)
      }
      return enviar(destino as never, payload as never)
    }) as NonNullable<typeof bruno>["session"]["send"]

    /*
      Bruno sends the same attachment to this channel only once per `repeticaoMs`
      (ten minutes). Here the first frame was swapped in transit and the second
      comes from the same Bruno: with no other live leaf, the test lowers the wait.
    */
    const repeticao = TECTOS_DOS_ANEXOS.repeticaoMs
    TECTOS_DOS_ANEXOS.repeticaoMs = 0
    onTestFinished(() => {
      TECTOS_DOS_ANEXOS.repeticaoMs = repeticao
    })
    const recusado = await carla!.session.pedirAnexo(canal, id, 0)
    expect(carla!.session.estatisticasDaSincronia.anexosRecusados).toBe(1)
    expect(recusado.ok).toBe(false)
    expect(carla!.session.history(canal).find((e) => e.payload["id"] === id)!.payload["media"]).toMatchObject([{ evicted: true }])

    // The second time, no swap: the bytes arrive, match, and go into the vault.
    const inicio = Date.now()
    const desfecho = await carla!.session.pedirAnexo(canal, id, 0)
    registar({ cenario: "anexo-a-pedido", ms: Date.now() - inicio, bytes: bruno!.session.estatisticasDaSincronia.bytesDeAnexos })
    expect(desfecho.ok).toBe(true)
    if (desfecho.ok) expect(desfecho.anexo["inline"]).toBe(IMAGEM)
    await ate(
      () => (carla!.session.history(canal).find((e) => e.payload["id"] === id)!.payload["media"] as { inline?: string }[])[0]?.inline === IMAGEM,
      "os bytes no cofre da Carla",
    )
    expect(bruno!.session.estatisticasDaSincronia.anexosEnviados).toBe(2)
  }, 180_000)
})
