import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  CANAIS_DE_CANAL,
  LEITURAS_DE_CANAL,
  ligarCanais,
  type Resposta,
  type SalaDoNucleo,
  type SessaoDeCanais,
} from "./canais.js"

/**
 * The main process really does wire up channel operations to the session.
 *
 * The criterion is not "the session works", that is proven in
 * `packages/client-core`, with mutations. It is **remove the connection line
 * and the test fails**, which is the same criterion as `sfu.test.ts` and for
 * the same reason: between the core, which has thousands of tests, and what
 * the person sees, there is this layer.
 *
 * And this layer has the worst track record in the repo. It is where we found
 * that `applyMediaPrefs` was never implemented; it is where the path to the
 * SFU went unwired; and it is where 37 channel operations, rooms, categories,
 * roles, tickets, simply did not exist, while the type said they did.
 * **None of the three broke anything**, and that is what makes them expensive
 * to find: a feature that does not happen does not complain.
 *
 * What gets tested here, and is more than "called someone":
 *
 *  - **the method name**, because `mayEdit` calling `mayManageRoles`
 *    compiles;
 *  - **the order of arguments**, because `(canal, sala, ticket)` swapped
 *    compiles and returns the wrong state of the wrong ticket;
 *  - **the channel's nature**, which is the whole decision of this file: a
 *    read wired as a request returns a promise, and a promise is truthy,  *    `mayEdit` would start saying yes to everyone.
 */

/** What the session saw, in the order it saw it. */
const feito: string[] = []

/** A fake session that records what it is asked and returns marked values. */
function sessaoFalsa(): SessaoDeCanais & { rebentar: boolean } {
  const sala = (room: string): SalaDoNucleo => ({
    room,
    name: `sala ${room}`,
    category: "geral",
    kind: "text",
    position: 1,
  })
  return {
    rebentar: false,

    roomsOf(channel) {
      feito.push(`roomsOf:${channel}`)
      if (this.rebentar) throw new Error("o cofre está trancado")
      return [sala("a"), sala("b")]
    },
    closedRoomsOf(channel) {
      feito.push(`closedRoomsOf:${channel}`)
      return [sala("fechada")]
    },
    categoriesOf(channel) {
      feito.push(`categoriesOf:${channel}`)
      return [{ category: "geral", position: 0, roles: ["papel"] }]
    },
    categoryTombstonesOf() {
      // Tombstones go in the same read as live ones (3/11/2026); there are none here.
      return []
    },
    spaceMeta(channel) {
      feito.push(`spaceMeta:${channel}`)
      return { name: "O Canal", updatedAt: 7 }
    },
    fichasDosCanais() {
      feito.push("fichasDosCanais:")
      return { "!opaca:servidor": { tipo: "directa" as const, par: "@par:servidor" } }
    },
    mayEditChannel(channel) {
      feito.push(`mayEditChannel:${channel}`)
      return true
    },
    founderOf(channel) {
      feito.push(`founderOf:${channel}`)
      return "@quem:servidor"
    },
    adminsOf(channel) {
      feito.push(`adminsOf:${channel}`)
      return ["@outro:servidor"]
    },
    rolesOf(channel) {
      feito.push(`rolesOf:${channel}`)
      return [{ role: "guarda", name: "Guarda", powers: ["fixar"], position: 0 }]
    },
    adminRole(channel) {
      feito.push(`adminRole:${channel}`)
      return { name: "Guardiões", colour: "ambar" }
    },
    rolesFor(channel, address) {
      feito.push(`rolesFor:${channel}:${address}`)
      return ["guarda"]
    },
    mayManageRoles(channel) {
      feito.push(`mayManageRoles:${channel}`)
      return true
    },
    pinnedOf(channel, room) {
      feito.push(`pinnedOf:${channel}:${room}`)
      return [{ id: "m1", sender: "@quem:servidor", body: "isto fica", sentAt: 3, pinnedAt: 4, pinnedBy: "@quem:servidor" }]
    },
    mayPin(channel) {
      feito.push(`mayPin:${channel}`)
      return true
    },
    ticketsOf(channel, room) {
      feito.push(`ticketsOf:${channel}:${room}`)
      return [
        {
          id: "t1",
          subject: "a porta",
          state: "open",
          opener: "@quem:servidor",
          assignee: "",
          openedAt: 1,
          updatedAt: 2,
          messages: 3,
        },
      ]
    },
    mayDecideTicket(channel, room, ticket) {
      feito.push(`mayDecideTicket:${channel}:${room}:${ticket}`)
      return true
    },
    mayModerate(channel, address) {
      feito.push(`mayModerate:${channel}:${address}`)
      return true
    },
    nicknamesOf(channel) {
      feito.push(`nicknamesOf:${channel}`)
      return { "@ana:servidor": "Aninhas" }
    },
    mayDeleteChannel(channel) {
      feito.push(`mayDeleteChannel:${channel}`)
      return true
    },
    may(channel, power) {
      feito.push(`may:${channel}:${power}`)
      return true
    },

    async upsertRoom(channel, next) {
      feito.push(`upsertRoom:${channel}:${next.room}:${next.name}:${next.closed ?? false}:${next.removed ?? false}`)
    },
    async upsertCategory(channel, next) {
      feito.push(`upsertCategory:${channel}:${next.category}:${(next.roles ?? []).join("+")}`)
    },
    async pinMessage(channel, room, message) {
      feito.push(`pinMessage:${channel}:${room}:${message.id}:${message.body}`)
    },
    async unpinMessage(channel, room, id) {
      feito.push(`unpinMessage:${channel}:${room}:${id}`)
    },
    async openTicket(channel, room, subject) {
      feito.push(`openTicket:${channel}:${room}:${subject}`)
      return "t-novo"
    },
    async replyToTicket(channel, room, ticket, body) {
      feito.push(`replyToTicket:${channel}:${room}:${ticket}:${body}`)
    },
    async setTicketState(channel, room, ticket, state) {
      feito.push(`setTicketState:${channel}:${room}:${ticket}:${state}`)
    },
    async takeTicket(channel, room, ticket) {
      feito.push(`takeTicket:${channel}:${room}:${ticket}`)
    },
    async releaseTicket(channel, room, ticket) {
      feito.push(`releaseTicket:${channel}:${room}:${ticket}`)
    },
    async deleteTicket(channel, room, ticket) {
      feito.push(`deleteTicket:${channel}:${room}:${ticket}`)
    },
    async setNickname(channel, subject, nick) {
      feito.push(`setNickname:${channel}:${subject}:${nick}`)
    },
    async moveVoice(channel, subject, room) {
      feito.push(`moveVoice:${channel}:${subject}:${room}`)
    },
    async disconnectVoice(channel, subject) {
      feito.push(`disconnectVoice:${channel}:${subject}`)
    },
    async assignRole(channel, subject, admin) {
      feito.push(`assignRole:${channel}:${subject}:${admin}`)
    },
    async assignRoles(channel, subject, roles) {
      feito.push(`assignRoles:${channel}:${subject}:${roles.join("+")}`)
    },
    async defineRole(channel, next) {
      feito.push(`defineRole:${channel}:${next.role}:${next.name}:${next.powers.join("+")}`)
    },
    async deleteRole(channel, role) {
      feito.push(`deleteRole:${channel}:${role}`)
    },
    async reorderRoles(channel, ordem) {
      feito.push(`reorderRoles:${channel}:${ordem.join("+")}`)
    },
    async claimFounder(channel) {
      feito.push(`claimFounder:${channel}`)
    },
    async updateSpaceMeta(channel, next) {
      feito.push(`updateSpaceMeta:${channel}:${next.name}:${next.topic ?? ""}`)
    },
    async editMessage(channel, target, body) {
      feito.push(`editMessage:${channel}:${target}:${body}`)
    },
    async deleteMessage(channel, target) {
      feito.push(`deleteMessage:${channel}:${target}`)
    },
    async deleteChannel(channel) {
      feito.push(`deleteChannel:${channel}`)
    },
  }
}

/** Wires channels to mock gates and returns everything that can be queried. */
function montar(): {
  leituras: Map<string, (...argumentos: unknown[]) => Resposta<unknown>>
  pedidos: Map<string, (...argumentos: unknown[]) => unknown>
  sessao: ReturnType<typeof sessaoFalsa>
} {
  feito.length = 0
  const leituras = new Map<string, (...argumentos: unknown[]) => Resposta<unknown>>()
  const pedidos = new Map<string, (...argumentos: unknown[]) => unknown>()
  const sessao = sessaoFalsa()

  ligarCanais({
    registarPedido: (canal, ouvinte) => {
      // A name registered twice, the second one wins, silently. Here it is an error,
      // because that is how copy-and-paste erases an operation.
      if (pedidos.has(canal) || leituras.has(canal)) throw new Error(`canal repetido: ${canal}`)
      pedidos.set(canal, ouvinte as (...argumentos: unknown[]) => unknown)
    },
    registarLeitura: (canal, ouvinte) => {
      if (pedidos.has(canal) || leituras.has(canal)) throw new Error(`canal repetido: ${canal}`)
      leituras.set(canal, ouvinte as (...argumentos: unknown[]) => Resposta<unknown>)
    },
    sessao,
  })

  return { leituras, pedidos, sessao }
}

const CANAL = "!geral:servidor"

describe("o processo principal expõe as operações de canal todas", () => {
  it("regista os 47 nomes, e nenhum fica por registar", () => {
    const { leituras, pedidos } = montar()

    for (const nome of Object.values(LEITURAS_DE_CANAL)) expect(leituras.has(nome)).toBe(true)
    for (const nome of Object.values(CANAIS_DE_CANAL)) expect(pedidos.has(nome)).toBe(true)

    /*
      The count, spelled out: 19 reads and 19 requests.

      Thirty-seven of these operations did not exist in the shipped app at all
      , the web bridge exposed 52 and `preload` exposed 15. The thirty-eighth
      is `mayExpel`, which existed with the wrong behavior: it was a request,
      returned a promise, and a promise is truthy.

      Phase 3 (moderation): two reads, `mayModerate` and `nicknames`, and two
      requests, `deleteTicket` and `setNickname`. 21 reads and 21 requests.

      1.0 "Arca", slice 2: one read, `fichas` (the type of each channel, from
      the vault). 22 reads and 21 requests.

      Voice and role moderation (2/11/2026): one read, `adminRole` (the name of
      the built-in role), and one request, `disconnectVoice` ("Disconnect from
      call"). 23 reads and 22 requests.

      `@all` (3/11/2026): one read, `mayMentionAll` (the `mencionartodos`
      permission in the room). 24 reads and 22 requests.

      Role order (4/11/2026): one request, `reorderRoles` (drag and arrows in
      the role editor). 24 reads and 23 requests.
    */
    expect(leituras.size).toBe(24)
    expect(pedidos.size).toBe(23)
  })

  it("nenhuma leitura responde com uma promessa", () => {
    const { leituras } = montar()

    for (const [nome, ler] of leituras) {
      const resposta = ler(CANAL, "sala", "t1")
      // It is the lesson of `mayExpel` written as a test: the interface reads
      // `mayEdit?.(canal) ?? false` in the middle of a render, and a promise passes
      // that read as true. A read that returns a promise is not half a feature, it
      // is the wrong answer, every time.
      expect(resposta).not.toBeInstanceOf(Promise)
      expect(resposta, nome).toHaveProperty("ok", true)
    }
  })
})

describe("cada leitura chama o método certo, com os argumentos por ordem", () => {
  const casos: [string, unknown[], string, unknown][] = [
    [LEITURAS_DE_CANAL.salas, [CANAL], `roomsOf:${CANAL}`, undefined],
    [LEITURAS_DE_CANAL.salasFechadas, [CANAL], `closedRoomsOf:${CANAL}`, undefined],
    [LEITURAS_DE_CANAL.categorias, [CANAL], `categoriesOf:${CANAL}`, undefined],
    [LEITURAS_DE_CANAL.propriedades, [CANAL], `spaceMeta:${CANAL}`, { name: "O Canal", updatedAt: 7 }],
    [LEITURAS_DE_CANAL.fichas, [], "fichasDosCanais:", { "!opaca:servidor": { tipo: "directa", par: "@par:servidor" } }],
    [LEITURAS_DE_CANAL.podeOrganizar, [CANAL], `mayEditChannel:${CANAL}`, true],
    [LEITURAS_DE_CANAL.fundador, [CANAL], `founderOf:${CANAL}`, "@quem:servidor"],
    [LEITURAS_DE_CANAL.administradores, [CANAL], `adminsOf:${CANAL}`, ["@outro:servidor"]],
    [LEITURAS_DE_CANAL.papeis, [CANAL], `rolesOf:${CANAL}`, undefined],
    [LEITURAS_DE_CANAL.cargoDeAdministrador, [CANAL], `adminRole:${CANAL}`, { name: "Guardiões", colour: "ambar" }],
    [LEITURAS_DE_CANAL.papeisDe, [CANAL, "@alguem:servidor"], `rolesFor:${CANAL}:@alguem:servidor`, ["guarda"]],
    [LEITURAS_DE_CANAL.podeGerirPapeis, [CANAL], `mayManageRoles:${CANAL}`, true],
    [LEITURAS_DE_CANAL.fixadas, [CANAL, "sala"], `pinnedOf:${CANAL}:sala`, undefined],
    [LEITURAS_DE_CANAL.podeFixar, [CANAL], `mayPin:${CANAL}`, true],
    [LEITURAS_DE_CANAL.tickets, [CANAL, "sala"], `ticketsOf:${CANAL}:sala`, undefined],
    [LEITURAS_DE_CANAL.podeDecidirTicket, [CANAL, "sala", "t1"], `mayDecideTicket:${CANAL}:sala:t1`, true],
    [LEITURAS_DE_CANAL.podeEliminar, [CANAL], `mayDeleteChannel:${CANAL}`, true],
    [LEITURAS_DE_CANAL.podeModerar, [CANAL, "@ana:servidor"], `mayModerate:${CANAL}:@ana:servidor`, true],
    [LEITURAS_DE_CANAL.apelidos, [CANAL], `nicknamesOf:${CANAL}`, { "@ana:servidor": "Aninhas" }],
    /*
      All four responsibilities go to the same method with different power, and
      that is where the test has to be strict: swap `atender` for `mover` and
      it compiles, and what you see is the wrong button appearing to someone
      who cannot use it. The power is part of what you measure.
    */
    [LEITURAS_DE_CANAL.podeAtender, [CANAL], `may:${CANAL}:atender`, true],
    [LEITURAS_DE_CANAL.podeMover, [CANAL], `may:${CANAL}:mover`, true],
    [LEITURAS_DE_CANAL.podeConvidar, [CANAL], `may:${CANAL}:convidar`, true],
    [LEITURAS_DE_CANAL.podeExpulsar, [CANAL], `may:${CANAL}:expulsar`, true],
  ]

  for (const [canal, argumentos, esperado, valor] of casos) {
    it(`${canal} → ${esperado.split(":")[0]}`, () => {
      const { leituras } = montar()

      const resposta = leituras.get(canal)!(...argumentos)

      expect(feito).toEqual([esperado])
      expect(resposta.ok).toBe(true)
      if (valor !== undefined && resposta.ok) expect(resposta.valor).toEqual(valor)
    })
  }

  it("as salas atravessam inteiras, e não só o nome", () => {
    const { leituras } = montar()

    const resposta = leituras.get(LEITURAS_DE_CANAL.salas)!(CANAL)

    // The sidebar needs the category, type, and position: a room without `kind` is
    // a voice room rendered as text where no one can join.
    expect(resposta.ok && resposta.valor).toEqual([
      { room: "a", name: "sala a", category: "geral", kind: "text", position: 1 },
      { room: "b", name: "sala b", category: "geral", kind: "text", position: 1 },
    ])
  })

  it("uma resposta que NÃO ATRAVESSA o IPC vira queixa, e não silêncio", () => {
    const { leituras, sessao } = montar()
    /*
      Here's the issue: a core method that returns something with a function
      inside-an object with methods, a class, a convenience `Map`. Without
      verification, cloning fails inside Electron, the sync read times out, and
      the renderer hangs. With verification, the caller gets an error naming
      the channel.
    */
    sessao.spaceMeta = () =>
      ({ name: "O Canal", updatedAt: 1, aoLer: () => "isto não atravessa" }) as unknown as ReturnType<
        SessaoDeCanais["spaceMeta"]
      >

    const resposta = leituras.get(LEITURAS_DE_CANAL.propriedades)!(CANAL)

    expect(resposta.ok).toBe(false)
    expect(resposta.ok === false && resposta.erro).toContain(LEITURAS_DE_CANAL.propriedades)
    expect(resposta.ok === false && resposta.erro).toMatch(/não atravessa o IPC/)
  })

  it("o que atravessa é uma CÓPIA: mexer nela não mexe no cofre", () => {
    const { leituras } = montar()

    const primeira = leituras.get(LEITURAS_DE_CANAL.salas)!(CANAL)
    if (primeira.ok) (primeira.valor as { name: string }[])[0]!.name = "mexida"
    const segunda = leituras.get(LEITURAS_DE_CANAL.salas)!(CANAL)

    // IPC clones anyway. Testing this here means proving the bridge doesn't assume
    // reference sharing, which only works when both sides run in the same process.
    // That's exactly what sets this bridge apart from the browser one.
    expect(segunda.ok && (segunda.valor as { name: string }[])[0]!.name).toBe("sala a")
  })

  it("uma leitura que rebenta responde com o envelope, e não atira", () => {
    const { leituras, sessao } = montar()
    sessao.rebentar = true

    // Without this, a vault locked mid-operation crashes the `render` making the
    // query-and the UI is built on these queries.
    const resposta = leituras.get(LEITURAS_DE_CANAL.salas)!(CANAL)

    expect(resposta).toEqual({ ok: false, erro: "o cofre está trancado" })
  })
})

describe("cada pedido chama o método certo, com os argumentos por ordem", () => {
  const casos: [string, unknown[], string][] = [
    [
      CANAIS_DE_CANAL.criarSala,
      [CANAL, { room: "nova", name: "Nova", category: "geral", kind: "text", position: 2, closed: true }],
      `upsertRoom:${CANAL}:nova:Nova:true:false`,
    ],
    [
      CANAIS_DE_CANAL.criarCategoria,
      [CANAL, { category: "Voz", position: 1, roles: ["guarda"] }],
      `upsertCategory:${CANAL}:Voz:guarda`,
    ],
    [
      CANAIS_DE_CANAL.fixar,
      [CANAL, "sala", { id: "m1", sender: "@quem:servidor", body: "a cópia", sentAt: 9 }],
      `pinMessage:${CANAL}:sala:m1:a cópia`,
    ],
    [CANAIS_DE_CANAL.desafixar, [CANAL, "sala", "m1"], `unpinMessage:${CANAL}:sala:m1`],
    [CANAIS_DE_CANAL.abrirTicket, [CANAL, "sala", "a porta"], `openTicket:${CANAL}:sala:a porta`],
    [CANAIS_DE_CANAL.responderTicket, [CANAL, "sala", "t1", "já vou"], `replyToTicket:${CANAL}:sala:t1:já vou`],
    [CANAIS_DE_CANAL.estadoDoTicket, [CANAL, "sala", "t1", "closed"], `setTicketState:${CANAL}:sala:t1:closed`],
    [CANAIS_DE_CANAL.tomarTicket, [CANAL, "sala", "t1"], `takeTicket:${CANAL}:sala:t1`],
    [CANAIS_DE_CANAL.largarTicket, [CANAL, "sala", "t1"], `releaseTicket:${CANAL}:sala:t1`],
    [CANAIS_DE_CANAL.eliminarTicket, [CANAL, "sala", "t1"], `deleteTicket:${CANAL}:sala:t1`],
    [CANAIS_DE_CANAL.mudarApelido, [CANAL, "@ana:servidor", "Aninhas"], `setNickname:${CANAL}:@ana:servidor:Aninhas`],
    [CANAIS_DE_CANAL.moverVoz, [CANAL, "@alguem:servidor", "sala"], `moveVoice:${CANAL}:@alguem:servidor:sala`],
    [CANAIS_DE_CANAL.desligarDaVoz, [CANAL, "@alguem:servidor"], `disconnectVoice:${CANAL}:@alguem:servidor`],
    [
      CANAIS_DE_CANAL.nomearAdministrador,
      [CANAL, "@alguem:servidor", true],
      `assignRole:${CANAL}:@alguem:servidor:true`,
    ],
    [
      CANAIS_DE_CANAL.atribuirPapeis,
      [CANAL, "@alguem:servidor", ["guarda", "porteiro"]],
      `assignRoles:${CANAL}:@alguem:servidor:guarda+porteiro`,
    ],
    [
      CANAIS_DE_CANAL.definirPapel,
      [CANAL, { role: "guarda", name: "Guarda", powers: ["fixar", "atender"] }],
      `defineRole:${CANAL}:guarda:Guarda:fixar+atender`,
    ],
    [CANAIS_DE_CANAL.apagarPapel, [CANAL, "guarda"], `deleteRole:${CANAL}:guarda`],
    [CANAIS_DE_CANAL.ordenarPapeis, [CANAL, ["porteiro", "guarda"]], `reorderRoles:${CANAL}:porteiro+guarda`],
    [CANAIS_DE_CANAL.assumirFundacao, [CANAL], `claimFounder:${CANAL}`],
    [
      CANAIS_DE_CANAL.propriedades,
      [CANAL, { name: "Outro nome", topic: "o tópico" }],
      `updateSpaceMeta:${CANAL}:Outro nome:o tópico`,
    ],
    [CANAIS_DE_CANAL.emendarMensagem, [CANAL, "m1", "assim é que é"], `editMessage:${CANAL}:m1:assim é que é`],
    [CANAIS_DE_CANAL.apagarMensagem, [CANAL, "m1"], `deleteMessage:${CANAL}:m1`],
    [CANAIS_DE_CANAL.eliminarCanal, [CANAL], `deleteChannel:${CANAL}`],
  ]

  for (const [canal, argumentos, esperado] of casos) {
    it(`${canal} → ${esperado.split(":")[0]}`, async () => {
      const { pedidos } = montar()

      const resposta = await pedidos.get(canal)!(...argumentos)

      expect(feito).toEqual([esperado])
      expect(resposta).toMatchObject({ ok: true })
    })
  }

  it("abrir um ticket devolve o identificador, que é para onde a interface vai a seguir", async () => {
    const { pedidos } = montar()

    // Without the identifier back, the UI would have to invent it-and you'd end up
    // with two names for the same ticket, one on each side of the boundary.
    expect(await pedidos.get(CANAIS_DE_CANAL.abrirTicket)!(CANAL, "sala", "a porta")).toEqual({
      ok: true,
      id: "t-novo",
    })
  })

  it("um pedido que rebenta rebenta mesmo: quem carregou tem de saber", async () => {
    const { pedidos, sessao } = montar()
    sessao.upsertRoom = async (): Promise<void> => {
      throw new Error("Só quem administra este canal pode organizar as salas.")
    }

    // Opposite of reads, and by design: a read lives inside a render and can't
    // throw. A request is a gesture, and a gesture that fails silently just means
    // the user will try again.
    await expect(
      pedidos.get(CANAIS_DE_CANAL.criarSala)!(CANAL, { room: "x", name: "X" }),
    ).rejects.toThrow(/administra/)
  })
})

/**
 * And the main process actually wires this up in production.
 *
 * Loaded from the file, not imported: `index.ts` boots the app on load-opens
 * the window, creates the vault, starts the tray-and you can't import it in a
 * test without opening all of Electron. We could skip measuring this last inch,
 * but that's exactly where this layer has failed twice already: `applyMediaPrefs`
 * and the SFU path weren't left incomplete, they just were never called at all.
 *
 * The test harness in `scripts/ipc-canais-electron.mjs` measures everything else
 * against real Electron, but with its own bridge. Only this one sees the product's.
 */
describe("a ligação no processo principal", () => {
  const index = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8")

  it("chama `ligarCanais` com a sessão de verdade", () => {
    expect(index).toContain("ligarCanais({ registarPedido, registarLeitura, sessao: session })")
  })

  it("as leituras são `ipcMain.on` com `returnValue`, e nunca `handle`", () => {
    // A `handle` at the last inch returns the promise straight back, and the UI
    // reads "yes" on everything. This is how the `mayExpel` bug can reappear
    // without ever leaving this file.
    const ligacao = index.slice(index.indexOf("const registarLeitura"), index.indexOf("ligarCanais({"))
    expect(ligacao).toContain("ipcMain.on(canal")
    expect(ligacao).toContain("evento.returnValue")
    // `handle(canal` and not `handle`: the note above it explains why it is not a
    // `handle`, and a measurement that stumbles on the comment explaining it
    // measures the comment.
    expect(ligacao).not.toContain("ipcMain.handle(canal")
  })

  it("já não há um `channel:may-expel` do lado dos pedidos", () => {
    expect(index).not.toContain('ipcMain.handle("channel:may-expel"')
  })
})
