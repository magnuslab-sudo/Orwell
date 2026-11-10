import { dobrarEnvolvimento, dobrarVotos, instantaneoDoCanal, Session } from "@enclave/client-core"
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
 * Absolute sync, phases S1 and S2, with real accounts (§8.1 of the plan
 * `docs/planos/2026-10-20-sincronia-absoluta.md`).
 *
 * The real server, the MLS groups, `Session`s with their own vaults. Each
 * test locks a goal of S1 or S2 that the S0 measurement showed failing.
 */

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

const mensagem = (body: string) =>
  ({ t: "message", id: crypto.randomUUID(), body, sentAt: Date.now(), attachments: [] }) as never

const entradaCom = (conta: ContaDeTeste, canal: string, corpo: string) =>
  conta.session.history(canal).find((entrada) => entrada.payload["body"] === corpo)

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Sockets opened before `repor()` drop their own connection's echoes
 * (`channel.event` with `ref`) while `engolir` is on. Only those: sockets from
 * other accounts, and those opened later, stay as they are.
 */
function socketQueEngoleEcos(): { engolir: boolean; engolidos: number; repor: () => void } {
  const Original = globalThis.WebSocket
  const estado = {
    engolir: false,
    engolidos: 0,
    repor: () => {
      globalThis.WebSocket = Original
    },
  }
  class ComFiltro extends Original {
    override addEventListener(tipo: string, ouvinte: EventListenerOrEventListenerObject, opcoes?: boolean | AddEventListenerOptions): void {
      if (tipo !== "message") return super.addEventListener(tipo, ouvinte, opcoes)
      super.addEventListener(
        tipo,
        (evento: Event) => {
          if (estado.engolir) {
            const trama = JSON.parse(String((evento as MessageEvent).data)) as { t?: string; ref?: string }
            if (trama.t === "channel.event" && trama.ref !== undefined) {
              estado.engolidos += 1
              return
            }
          }
          if (typeof ouvinte === "function") ouvinte(evento)
          else ouvinte.handleEvent(evento)
        },
        opcoes,
      )
    }
  }
  globalThis.WebSocket = ComFiltro as typeof WebSocket
  return estado
}

/** An account posing as 0.6.0 (or 0.5.7): it never sends the device signal, so it never announces itself (§4.6). */
function semAnuncio(conta: ContaDeTeste): () => void {
  const enviar = conta.session.send.bind(conta.session)
  conta.session.send = async (destino, payload) => {
    if (payload.t === "typing") return
    return enviar(destino, payload)
  }
  // And since S4, no anti-entropy: an old client neither requests nor applies reports.
  conta.session.antiEntropiaLigada = false
  return () => {
    conta.session.send = enviar
    conta.session.antiEntropiaLigada = true
  }
}

describe("S1: o seq do eco em todos os envios", () => {
  /**
   * The S0 finding (scenario "member who joins late"): Ana's message sent before
   * Carla's seat stayed in Ana's vault with `seq` -1, and Ana's snapshot gave
   * it to Carla. With the echo's `seq`, the seat rule now holds for our own
   * messages too.
   */
  it("uma mensagem nossa ganha o seq do servidor, e a regra do lugar deixa-a fora do instantâneo", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ana!.session.send(canal, mensagem("antes do lugar"))
    await ate(() => (entradaCom(ana!, canal, "antes do lugar")?.seq ?? -1) >= 0, "o eco dá o seq à mensagem da Ana")
    await ate(() => entradaCom(bruno!, canal, "antes do lugar") !== undefined, "o Bruno lê a mensagem")
    // Same number on both sides: same event.
    expect(entradaCom(ana!, canal, "antes do lugar")?.seq).toBe(entradaCom(bruno!, canal, "antes do lugar")?.seq)
    expect(ana!.vault.contents.enviosPorConfirmar ?? {}).toEqual({})

    await ana!.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra")
    const lugar = carla!.vault.contents.seatSince?.[canal]
    expect(lugar).toBeGreaterThan(entradaCom(ana!, canal, "antes do lugar")!.seq)

    const instantaneo = instantaneoDoCanal(ana!.vault.contents, canal, { desde: lugar! })
    expect(instantaneo.porParte["mensagens-da-janela"]?.n).toBe(0)

    // After the seat, the new message enters the window on both sides, and the
    // digests with a window become equal (the "before" message is no longer a false divergence).
    await ana!.session.send(canal, mensagem("depois do lugar"))
    await ate(() => entradaCom(carla!, canal, "depois do lugar") !== undefined, "a Carla lê a nova")
    await ate(() => (entradaCom(ana!, canal, "depois do lugar")?.seq ?? -1) >= 0, "o eco da nova")
    await ate(() => !divergencias([ana!, carla!], canal, lugar).includes("mensagem"), "as mensagens da janela ficam iguais")
  }, 120_000)

  it("um eco perdido (a ligação caiu logo a seguir ao envio) chega pela recuperação, reconhecido pelos bytes", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    /*
      The echo is dropped on purpose, not by timing (S6). Before, the test
      would disconnect right after `send` and expect the echo not to have arrived
      yet; on a fast local server it sometimes did, and the test would fail.
      Now Ana's connection runs through a filter that drops her echoes
      (`channel.event` with `ref`) while `engolir` is on.
    */
    ana!.session.disconnect()
    const filtro = socketQueEngoleEcos()
    await ana!.session.connect()
    filtro.repor()
    filtro.engolir = true
    await ana!.session.send(canal, mensagem("sem eco"))
    await ate(() => filtro.engolidos > 0, "o eco da Ana foi deitado fora")
    ana!.session.disconnect()
    filtro.engolir = false
    expect(entradaCom(ana!, canal, "sem eco")?.seq).toBe(-1)
    expect(Object.keys(ana!.vault.contents.enviosPorConfirmar ?? {}).length).toBeGreaterThanOrEqual(1)
    await ana!.session.connect()
    await ate(() => (entradaCom(ana!, canal, "sem eco")?.seq ?? -1) >= 0, "a recuperação dá o seq à mensagem")
    await ate(() => entradaCom(bruno!, canal, "sem eco") !== undefined, "o Bruno lê")
    expect(entradaCom(ana!, canal, "sem eco")?.seq).toBe(entradaCom(bruno!, canal, "sem eco")?.seq)
    expect(ana!.vault.contents.enviosPorConfirmar ?? {}).toEqual({})
    // And it wasn't duplicated.
    expect(ana!.session.history(canal).filter((e) => e.payload["body"] === "sem eco")).toHaveLength(1)
  }, 120_000)
})

const publicacao = (id: string, caption: string) =>
  ({ t: "post", id, postedAt: Date.now(), caption, media: [], links: [], tags: [] }) as never

describe("S1: quem entra tarde recebe o que é de quem estava", () => {
  /**
   * The S0 scenario that never converged: Carla joined a space and got zero
   * posts, zero comments, zero votes and zero tickets. Now each author
   * resends what is theirs, and the role arrives with the original timestamp (F11).
   */
  it("publicações, comentários, gostos, votos, tickets e cargos com o carimbo original", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ana!.session.defineRole(canal, { role: "porteiro", name: "Porteiro", powers: ["convidar"] })
    await ana!.session.assignRoles(canal, bruno!.address, ["porteiro"])
    await ate(() => ana!.vault.contents.channelMemberRolesAt?.[canal]?.[bruno!.address] !== undefined, "a atribuição gravada na Ana")
    const carimbo = ana!.vault.contents.channelMemberRolesAt![canal]![bruno!.address]!.at

    const posts: string[] = []
    for (let i = 0; i < 5; i++) {
      const id = crypto.randomUUID()
      posts.push(id)
      await ana!.session.send(canal, publicacao(id, `mural ${i}`))
    }
    for (let i = 0; i < 10; i++) await bruno!.session.commentOnPost(canal, posts[i % 5]!, `comentário ${i}`)
    await bruno!.session.reactToPost(canal, posts[0]!, "👍")
    await bruno!.session.voteOnPoll(canal, posts[1]!, 2)
    await ana!.session.voteOnPoll(canal, posts[1]!, 0)
    const ticket = await ana!.session.openTicket(canal, "", "A porta não fecha")
    await ana!.session.setTicketState(canal, "", ticket, "working")
    await bruno!.session.openTicket(canal, "", "Falta luz")
    await ate(() => bruno!.session.ticketsOf(canal, "").length === 2, "os dois tickets no Bruno")
    await ate(() => divergencias([ana!, bruno!], canal).length === 0, "a Ana e o Bruno iguais")

    await ana!.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra")
    const lugar = carla!.vault.contents.seatSince?.[canal]

    const contar = (conta: ContaDeTeste) => {
      const r = resumoDe(conta, canal, lugar)
      return { publicacao: r.publicacao.n, comentario: r.comentario.n, voto: r.voto.n, gosto: r.gosto.n, ticket: r.ticket.n }
    }
    await ate(() => JSON.stringify(contar(carla!)) === JSON.stringify(contar(ana!)), "o mural e os tickets iguais na Carla", 30_000)
    expect(contar(carla!)).toMatchObject({ publicacao: 5, comentario: 10 })

    // Each person's likes and votes, as the fold counts them.
    const envolvimento = dobrarEnvolvimento(carla!.session.history(canal), carla!.address)
    expect(envolvimento.get(posts[0]!)?.up).toBe(1)
    expect([...(dobrarVotos(carla!.session.history(canal)).get(posts[1]!) ?? new Map())].sort()).toEqual(
      [
        [ana!.address, 0],
        [bruno!.address, 2],
      ].sort(),
    )
    // Carla's ticket board: both tickets, and the state decided by Ana.
    await ate(() => carla!.session.ticketsOf(canal, "").length === 2, "os dois tickets na Carla")
    expect(carla!.session.ticketsOf(canal, "").find((t) => t.id === ticket)?.state).toBe("working")
    // Bruno's role, with the assignment timestamp, not the resend time.
    expect(carla!.session.rolesFor(canal, bruno!.address)).toContain("porteiro")
    expect(carla!.vault.contents.channelMemberRolesAt?.[canal]?.[bruno!.address]?.at).toBe(carimbo)
    // And no message from before the seat.
    expect(
      carla!.session.history(canal).filter((e) => e.payload.t === "message" && !e.payload["ticket"] && e.seq >= 0 && e.seq < (lugar ?? 0)),
    ).toHaveLength(0)
    // No duplicates: nobody stored copies from the resend. Count the history
    // ENTRIES, not the unique keys of the digest, which hid a copy stored under the same key.
    const entradas = (conta: ContaDeTeste) => {
      const lidas = conta.session.history(canal)
      const quantas = (t: string, ticket = false) =>
        lidas.filter((e) => e.payload.t === t && (!ticket || e.payload["ticket"] !== undefined)).length
      return {
        publicacao: quantas("post"),
        comentario: quantas("post.comment"),
        reaccao: quantas("post.reaction"),
        ticket: quantas("message", true),
      }
    }
    await esperar(500)
    for (const conta of [ana!, bruno!, carla!]) {
      expect(entradas(conta)).toEqual({ publicacao: 5, comentario: 10, reaccao: 3, ticket: 3 })
    }
  }, 180_000)
})

describe("S2: o cofre no tecto não perde o estado", () => {
  it("depois de 410 mensagens, o mural, o comentário, a lápide e o ticket continuam nas duas contas", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const post = crypto.randomUUID()
    await ana!.session.send(canal, publicacao(post, "a publicação antiga"))
    await bruno!.session.commentOnPost(canal, post, "o comentário antigo")
    await ana!.session.openTicket(canal, "", "Ticket antigo")
    await ana!.session.send(canal, mensagem("para apagar"))
    await ate(() => entradaCom(bruno!, canal, "para apagar") !== undefined, "o Bruno lê a mensagem a apagar")
    await ana!.session.deleteMessage(canal, entradaCom(bruno!, canal, "para apagar")!.payload["id"] as string)
    await ate(() => bruno!.session.history(canal).some((e) => e.payload.t === "redact"), "a lápide chega ao Bruno")

    for (let i = 0; i < 410; i++) await ana!.session.send(canal, mensagem(`enchimento ${i}`))
    await ate(() => entradaCom(bruno!, canal, "enchimento 409") !== undefined, "o Bruno lê as 410", 60_000)

    for (const conta of [ana!, bruno!]) {
      const r = resumoDe(conta, canal)
      expect({ publicacao: r.publicacao.n, comentario: r.comentario.n, apagamento: r.apagamento.n, ticket: r.ticket.n }).toEqual({
        publicacao: 1,
        comentario: 1,
        apagamento: 1,
        ticket: 1,
      })
      expect(conta.vault.contents.history[canal]?.length).toBe(400)
      expect(conta.session.ticketsOf(canal, "")).toHaveLength(1)
    }
    await ate(() => divergencias([ana!, bruno!], canal).length === 0, "as duas contas iguais")
  }, 240_000)
})

describe("S1: a conta desligada apanha tudo pela ordem do seq", () => {
  it("a Carla volta e fica igual, com cada evento no mesmo seq que os outros têm", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])
    carla!.session.disconnect()
    const post = crypto.randomUUID()
    await ana!.session.send(canal, publicacao(post, "fora"))
    for (let i = 0; i < 5; i++) await ana!.session.send(canal, mensagem(`fora ${i}`))
    await bruno!.session.commentOnPost(canal, post, "comentei fora")
    const alvo = entradaCom(ana!, canal, "fora 0")!
    await ana!.session.editMessage(canal, alvo.payload["id"] as string, "fora 0, emendada")
    await ate(() => bruno!.session.history(canal).some((e) => e.payload.t === "edit"), "o Bruno vê a edição")

    await carla!.session.connect()
    await ate(() => divergencias([ana!, bruno!, carla!], canal).length === 0, "as três iguais", 30_000)
    // Same event key with same `seq` across all three accounts (including their own sends).
    const porChave = (conta: ContaDeTeste) =>
      Object.fromEntries(
        conta.session
          .history(canal)
          .filter((e) => typeof e.payload["id"] === "string")
          .map((e) => [`${e.payload.t}|${e.sender}|${String(e.payload["id"])}`, e.seq]),
      )
    await ate(() => Object.values(porChave(ana!)).every((seq) => seq >= 0), "os ecos da Ana")
    const daCarla = porChave(carla!)
    for (const [chave, seq] of Object.entries(porChave(ana!))) {
      if (chave.startsWith("profile|") || daCarla[chave] === undefined) continue
      expect(daCarla[chave]).toBe(seq)
    }
  }, 120_000)
})

describe("S1, §4.6: o reenvio de comentários e tickets espera que todas as folhas o saibam deduplicar", () => {
  /**
   * A 0.5.7 client stores each resent comment or ticket as a new entry, and a
   * 0.6.0 deduplicates posts and likes only against what it still has in history
   * (finding 1 of the 0.7.0 review). Here Carla poses as a 0.6.0 that doesn't
   * announce itself (the device signal is dropped before it goes out): in a space she
   * gets nothing from the resend, neither the wall nor the likes. When she announces,
   * everything arrives, once.
   */
  it("com uma folha que não se anunciou, o reenvio fica à espera; quando se anuncia, chega", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const post = crypto.randomUUID()
    await ana!.session.send(canal, publicacao(post, "mural"))
    await bruno!.session.commentOnPost(canal, post, "comentário do Bruno")
    await bruno!.session.reactToPost(canal, post, "👍")
    await bruno!.session.openTicket(canal, "", "Ticket do Bruno")
    await ate(() => divergencias([ana!, bruno!], canal).length === 0, "a Ana e o Bruno iguais")

    // Carla poses as 0.6.0: no device signal.
    const anunciar = semAnuncio(carla!)
    await ana!.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra")
    await ate(() => bruno!.vault.contents.reenvioPorFazer?.includes(canal) === true, "o Bruno guarda o reenvio por fazer")
    await ate(() => ana!.vault.contents.reenvioPorFazer?.includes(canal) === true, "a Ana guarda o reenvio por fazer")
    await esperar(500)
    const r = resumoDe(carla!, canal)
    expect({ publicacao: r.publicacao.n, gosto: r.gosto.n, comentario: r.comentario.n, ticket: r.ticket.n }).toEqual({
      publicacao: 0,
      gosto: 0,
      comentario: 0,
      ticket: 0,
    })

    // Carla learns to deduplicate and announces herself: each one resends what was missing.
    anunciar()
    delete carla!.vault.contents.reenvioAnunciado?.[canal]
    await carla!.session.sincronizarAgora()
    await ate(
      () => {
        const depois = resumoDe(carla!, canal)
        return depois.publicacao.n === 1 && depois.gosto.n === 1 && depois.comentario.n === 1 && depois.ticket.n === 1
      },
      "o mural, o gosto, o comentário e o ticket chegam",
    )
    await ate(() => !(bruno!.vault.contents.reenvioPorFazer ?? []).includes(canal), "o Bruno dá o reenvio por feito")
    expect(carla!.session.history(canal).filter((e) => e.payload.t === "post.comment")).toHaveLength(1)
  }, 120_000)

  /**
   * Finding 1 of the 0.7.0 review, with a 0.6.0 conversation counted.
   *
   * Carla is fully 0.6.0: doesn't announce, and stores what she receives as a
   * 0.6.0 stores it (the old schema and deduplication, copied below): one list
   * only, with a cap, where posts and likes are rejected only if the same `id`
   * from the same author is still there. Cap of 15 instead of 400, so the test
   * runs in seconds; the ratio is the same (eleven accounts with two hundred likes).
   * Bruno connects for the first time after the update (`reenviadoPara` empty):
   * without the gate from §4.6 on likes, his 20 likes would all come in again and
   * push the whole conversation out of Carla's vault.
   */
  it("a primeira ligação depois da actualização não apaga a conversa de um 0.6.0", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    for (let i = 0; i < 20; i++) {
      const id = crypto.randomUUID()
      await ana!.session.send(canal, publicacao(id, `mural ${i}`))
      await bruno!.session.reactToPost(canal, id, "👍")
    }
    await ate(() => divergencias([ana!, bruno!], canal).length === 0, "a Ana e o Bruno iguais")

    semAnuncio(carla!)
    await ana!.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra")
    await ate(() => bruno!.vault.contents.reenviadoPara?.[canal]?.includes(carla!.address) === true, "o reenvio do Bruno corre")
    await esperar(1_000)

    // A 0.6.0 vault: one list, a cap, deduplication only for `post` and `post.reaction`.
    const TECTO = 15
    const HISTORICO = new Set(["message", "post", "post.comment", "post.reaction", "edit", "redact"])
    const cofreAntigo: { sender: string; payload: Record<string, unknown> }[] = []
    carla!.session.on("message", ({ channel, sender, payload }) => {
      if (channel !== canal || !HISTORICO.has(payload.t)) return
      const id = (payload as { id?: unknown }).id
      const repetida =
        (payload.t === "post" || payload.t === "post.reaction") &&
        cofreAntigo.some((guardada) => guardada.sender === sender && guardada.payload["t"] === payload.t && guardada.payload["id"] === id)
      if (repetida) return
      cofreAntigo.push({ sender, payload: payload as Record<string, unknown> })
      if (cofreAntigo.length > TECTO) cofreAntigo.shift()
    })
    const conversa = () => cofreAntigo.filter((entrada) => entrada.payload["t"] === "message").length

    for (let i = 0; i < 10; i++) await ana!.session.send(canal, mensagem(`conversa ${i}`))
    await ate(() => conversa() === 10, "a conversa no cofre antigo da Carla")

    // Bruno on his first connection after the update: he has never resent anything to anyone.
    delete bruno!.vault.contents.reenviadoPara?.[canal]
    await bruno!.session.sincronizarAgora()
    await ate(() => bruno!.vault.contents.reenviadoPara?.[canal] !== undefined, "a passagem do Bruno acaba")
    await esperar(2_000)
    expect(conversa()).toBe(10)
  }, 120_000)

  /**
   * Finding 13: a dead leaf (deaf, or from an abandoned device) never announces
   * itself, and the resend waited for it forever. Dead means it hasn't opened
   * anything in the current epoch and has been silent for `FOLHA_CALADA_MS`.
   * Here the timeout is zero, and Carla sends nothing: Bruno's resend still goes
   * out. With a fourteen-day timeout (the test above), a live leaf that hasn't
   * spoken yet still blocks it.
   */
  it("uma folha morta não trava o reenvio", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const post = crypto.randomUUID()
    await ana!.session.send(canal, publicacao(post, "mural"))
    await bruno!.session.commentOnPost(canal, post, "comentário do Bruno")
    await ate(() => divergencias([ana!, bruno!], canal).length === 0, "a Ana e o Bruno iguais")

    // Carla is a dead leaf: she joins and never says anything.
    carla!.session.send = async () => undefined as never
    const prazo = Session.FOLHA_CALADA_MS
    Session.FOLHA_CALADA_MS = 0
    try {
      await ana!.session.seat(canal, carla!.address)
      await ate(() => bruno!.session.membersOf(canal).map(String).includes(carla!.address), "a Carla na árvore do Bruno")
      await ate(() => bruno!.vault.contents.reenviadoPara?.[canal]?.includes(carla!.address) === true, "o reenvio do Bruno corre")
      expect(bruno!.vault.contents.reenvioPorFazer ?? []).not.toContain(canal)
    } finally {
      Session.FOLHA_CALADA_MS = prazo
    }
  }, 120_000)
})

describe("S1: o reenvio do próprio, sem tempestade e sem dar por feito o que falhou", () => {
  /**
   * Finding 2: `reenviadoPara` was saved with failed sends (each `send`
   * had `.catch(() => {})`). A member that didn't receive it stayed marked as done,
   * and the next connection didn't retry. Now it is saved only with zero failures.
   */
  it("um envio falhado não dá o canal por dito, e a passagem seguinte repete", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])
    const post = crypto.randomUUID()
    await ana!.session.send(canal, publicacao(post, "mural"))
    await bruno!.session.commentOnPost(canal, post, "comentário do Bruno")
    await ate(() => divergencias([ana!, bruno!, carla!], canal).length === 0, "as três iguais")
    // All leaves announced: the full resend can go out.
    await ate(() => Object.keys(bruno!.vault.contents.capacidadesNoCanal?.[canal] ?? {}).length === 2, "a Ana e a Carla anunciadas ao Bruno")

    // The first connection after the update, with Bruno's comments failing on the way out.
    const enviar = bruno!.session.send.bind(bruno!.session)
    bruno!.session.send = async (destino, payload) => {
      if (payload.t === "post.comment") throw new Error("sem ligação")
      return enviar(destino, payload)
    }
    delete bruno!.vault.contents.reenviadoPara?.[canal]
    await bruno!.session.sincronizarAgora()
    expect(bruno!.vault.contents.reenviadoPara?.[canal]).toBeUndefined()
    expect(bruno!.vault.contents.reenvioPorFazer ?? []).toContain(canal)

    // The connection comes back: the next pass retries, and now it sticks.
    bruno!.session.send = enviar
    await bruno!.session.sincronizarAgora()
    expect(bruno!.vault.contents.reenviadoPara?.[canal]).toContain(carla!.address)
    expect(bruno!.vault.contents.reenvioPorFazer ?? []).not.toContain(canal)
  }, 120_000)

  /**
   * Finding 5. (a) On the first connection after the update, `reenviadoPara`
   * is empty on every channel: one channel per pass, not all at once. (b) Resending
   * something that already has `seq` marks nothing in `enviosPorConfirmar`: the
   * cap of 512 marks was being spent by resends.
   */
  it("um canal por passagem, e nenhuma marca por confirmar para o que já tem seq", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const canais: string[] = []
    for (let i = 0; i < 3; i++) {
      const canal = await canalComTodos(servidor, ana!, [bruno!])
      const post = crypto.randomUUID()
      await ana!.session.send(canal, publicacao(post, `mural ${i}`))
      for (let j = 0; j < 4; j++) await bruno!.session.commentOnPost(canal, post, `comentário ${i}.${j}`)
      canais.push(canal)
    }
    for (const canal of canais) {
      await ate(() => divergencias([ana!, bruno!], canal).length === 0, "a Ana e o Bruno iguais")
      await ate(
        () => bruno!.session.history(canal).every((e) => e.sender !== bruno!.address || e.seq >= 0),
        "os ecos do Bruno",
      )
    }
    await ate(() => Object.keys(bruno!.vault.contents.enviosPorConfirmar ?? {}).length === 0, "sem marcas à espera")
    await bruno!.session.sincronizarAgora()

    // New marks, counted at write time.
    const contents = bruno!.vault.contents
    let marcas = contents.enviosPorConfirmar
    let novas = 0
    Object.defineProperty(contents, "enviosPorConfirmar", {
      configurable: true,
      enumerable: true,
      get: () => marcas,
      set: (valor: typeof marcas) => {
        for (const marca of Object.keys(valor ?? {})) if (!(marca in (marcas ?? {}))) novas += 1
        marcas = valor
      },
    })

    // The first connection after the update.
    for (const canal of canais) delete contents.reenviadoPara?.[canal]
    const ditos = () => canais.filter((canal) => contents.reenviadoPara?.[canal] !== undefined).length
    await bruno!.session.sincronizarAgora()
    expect(ditos()).toBe(1)
    await bruno!.session.sincronizarAgora()
    expect(ditos()).toBe(2)
    await bruno!.session.sincronizarAgora()
    expect(ditos()).toBe(3)
    expect(novas).toBe(0)
  }, 180_000)
})

describe("S1, F12: a directa aberta pelos dois lados ao mesmo tempo", () => {
  it("fica um grupo só: o que um escreve, o outro lê, nos dois sentidos", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const [dmDaAna, dmDoBruno] = await Promise.all([ana!.session.openDirect(bruno!.address), bruno!.session.openDirect(ana!.address)])
    expect(dmDaAna).toBe(dmDoBruno)
    const dm = dmDaAna
    await ate(() => ana!.session.membersOf(dm).map(String).includes(bruno!.address), "o Bruno no grupo da Ana")
    await ate(() => bruno!.session.membersOf(dm).map(String).includes(ana!.address), "a Ana no grupo do Bruno")
    // Same group on both sides: same confirmed transcript, not just same epoch
    // (the two groups from the race are both in epoch 1).
    const transcricao = (conta: ContaDeTeste) =>
      Buffer.from(conta.session.groupFor(dm)?.state.groupContext.confirmedTranscriptHash ?? new Uint8Array()).toString("hex")
    await ate(() => transcricao(ana!) !== "" && transcricao(ana!) === transcricao(bruno!), "o mesmo grupo dos dois lados")
    await ana!.session.send(dm, mensagem("da Ana"))
    await bruno!.session.send(dm, mensagem("do Bruno"))
    await ate(() => entradaCom(bruno!, dm, "da Ana") !== undefined, "o Bruno lê a Ana", 20_000)
    await ate(() => entradaCom(ana!, dm, "do Bruno") !== undefined, "a Ana lê o Bruno", 20_000)
  }, 120_000)

  /**
   * Finding 6 of the 0.7.0 review: the loser of the race adopts the peer's group,
   * and what it had already written stayed in the old group, which the peer never opened.
   * Two crossed friend requests, each with a message written before the two groups converge:
   * the friendship is made on both sides, and the loser's message reaches the winner,
   * once. (The winner's message, read by the loser before adopting, stays a gap
   * until the next connection: it's in `docs/PENDENTES.md`.)
   */
  it("dois pedidos de amizade cruzados: amigos dos dois lados, e o que quem perdeu escreveu antes chega", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const pedir = async (de: ContaDeTeste, para: ContaDeTeste) => {
      const dm = await de.session.openDirect(para.address)
      await de.session.send(dm, mensagem(`de ${de.address}, antes`))
      await de.session.sendFriendRequest(dm).catch(() => {})
      return dm
    }
    const [dm, doOutroLado] = await Promise.all([pedir(ana!, bruno!), pedir(bruno!, ana!)])
    expect(dm).toBe(doOutroLado)
    // The group of the lower address wins (`#ganhaODesempate`).
    const [ganha, perde] = ana!.address < bruno!.address ? [ana!, bruno!] : [bruno!, ana!]
    await ate(
      () =>
        ana!.session.friendTies().get(bruno!.address)?.link === "amigos" &&
        bruno!.session.friendTies().get(ana!.address)?.link === "amigos",
      "amigos dos dois lados",
      30_000,
    )
    const corpo = `de ${perde.address}, antes`
    await ate(() => entradaCom(ganha, dm, corpo) !== undefined, "quem ganhou lê o que quem perdeu escreveu antes", 20_000)
    await esperar(500)
    expect(ganha.session.history(dm).filter((e) => e.payload["body"] === corpo)).toHaveLength(1)
    expect(perde.session.history(dm).filter((e) => e.payload["body"] === corpo)).toHaveLength(1)
  }, 120_000)
})

describe("S1, F10: pedir os perfis de quem aparece sem nome", () => {
  /**
   * Bruno published his profile to the channel before Carla joined (the forced
   * send when she joined was lost), and Carla doesn't have it. She asks, and he
   * publishes it. Then (finding 4 of the 0.7.0 review) Carla asks over and over:
   * Bruno doesn't publish again, neither with the daily cap forgotten (he already told
   * everyone), nor with a new account (he already answered today).
   */
  it("a Carla perdeu o perfil do Bruno; pede, e o Bruno publica-o uma vez, por mais que ela repita", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])
    await ate(() => carla!.vault.contents.directory[bruno!.address] !== undefined, "a Carla tem o perfil do Bruno")
    await esperar(500)

    // The profiles Bruno publishes on this channel, counted on the way out.
    let publicados = 0
    const enviar = bruno!.session.send.bind(bruno!.session)
    bruno!.session.send = async (destino, payload) => {
      if (destino === canal && payload.t === "profile") publicados += 1
      return enviar(destino, payload)
    }
    // Bruno's last profile publish here was before Carla joined.
    bruno!.vault.contents.perfilPublicadoPara = { [canal]: [ana!.address, bruno!.address] }

    const pedir = async () => {
      delete carla!.vault.contents.directory[bruno!.address]
      delete carla!.vault.contents.perfisPedidos?.[canal]
      await carla!.session.sincronizarAgora()
    }
    const intervalo = Session.PEDIDO_DE_PERFIS_MS
    Session.PEDIDO_DE_PERFIS_MS = 0
    try {
      await pedir()
      await ate(() => carla!.vault.contents.directory[bruno!.address] !== undefined, "o perfil do Bruno volta", 20_000)
      expect(carla!.vault.contents.perfisPedidos?.[canal]).toContain(bruno!.address)
      await ate(() => publicados === 1, "o Bruno publica uma vez")

      // Repeated requests: no reply.
      for (let i = 0; i < 3; i++) await pedir()
      // Daily cap forgotten, but no new members: nothing.
      delete bruno!.vault.contents.perfisDadosEm?.[canal]
      await pedir()
      // New member, but already responded today: nothing.
      bruno!.vault.contents.perfisDadosEm = { [canal]: Date.now() }
      bruno!.vault.contents.perfilPublicadoPara = { [canal]: [ana!.address, bruno!.address] }
      await pedir()
      await esperar(1_500)
      expect(publicados).toBe(1)
    } finally {
      Session.PEDIDO_DE_PERFIS_MS = intervalo
    }
  }, 120_000)
})

describe("S1, F11: um relógio adiantado não manda para sempre", () => {
  /**
   * Finding 3 from the 0.7.0 review. The larger timestamp wins, and the
   * timestamp was the publisher's clock: an admin with the clock two hours ahead
   * could grant a role that nobody could remove for those two hours. A new act
   * is stamped above what is stored.
   */
  it("o Bruno dá o cargo com o relógio duas horas à frente; a Ana tira-o e vence", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!, carla!])
    await ana!.session.defineRole(canal, { role: "porteiro", name: "Porteiro", powers: ["convidar"] })
    await ana!.session.assignRoles(canal, bruno!.address, ["admin"])
    await ate(() => bruno!.session.mayManageRoles(canal), "o Bruno é administrador")
    await ate(() => bruno!.session.rolesOf(canal).some((papel) => papel.role === "porteiro"), "o Bruno conhece o cargo")
    await ana!.session.upsertRoom(canal, { room: "sala-um", name: "Sala" })
    await ate(() => bruno!.session.roomsOf(canal).some((sala) => sala.room === "sala-um"), "o Bruno conhece a sala")

    const relogio = Date.now
    Date.now = () => relogio() + 2 * 3_600_000
    try {
      await bruno!.session.assignRoles(canal, carla!.address, ["porteiro"])
      await bruno!.session.upsertRoom(canal, { room: "sala-um", name: "do futuro" })
    } finally {
      Date.now = relogio
    }
    for (const conta of [ana!, bruno!, carla!]) {
      await ate(() => conta.session.rolesFor(canal, carla!.address).includes("porteiro"), "o cargo chega")
      await ate(() => conta.session.roomsOf(canal).some((sala) => sala.name === "do futuro"), "o nome chega")
    }

    await ana!.session.assignRoles(canal, carla!.address, [])
    await ana!.session.upsertRoom(canal, { room: "sala-um", name: "de agora" })
    for (const conta of [ana!, bruno!, carla!]) {
      await ate(() => conta.session.rolesFor(canal, carla!.address).length === 0, "o cargo sai em todos")
      await ate(() => conta.session.roomsOf(canal).some((s) => s.name === "de agora"), "o nome novo vence em todos")
    }
  }, 120_000)
})
