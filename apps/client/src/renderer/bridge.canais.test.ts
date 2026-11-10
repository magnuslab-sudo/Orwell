import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The DESKTOP bridge actually delivers channel operations to the UI.
 *
 * The rule for this whole layer is: disconnect the link, the test dies. And
 * here the line was literally one: `channels: host.channels`, with the type
 * promising the 52 operations from the browser bridge and the `preload`
 * bringing 15. The UI is written defensively, `rooms?.(canal) ?? []`,
 * `mayEdit?.() ?? false`, so the 37 that were missing read as "this channel
 * has no rooms". In the installed app each channel showed just one room, and
 * nobody understood why.
 *
 * What we lock down here, in order of importance:
 *
 *  1. **that the operations reach the UI, all of them, with the right arguments**;
 *  2. **that reads return VALUE not the envelope or a promise**, it was a
 *     promise that made `mayExpel` in this app say yes to everyone for its
 *     entire lifetime;
 *  3. **that memory is cleared before the UI rerereads**, because memory that
 *     outlives the message that invalidates it shows forever the state one
 *     message behind;
 *  4. **that a read that fails complains**, instead of disguising itself as an
 *     empty channel, which is exactly how these 37 hid.
 */

vi.mock("@enclave/client-core", () => ({
  Call: class {
    on(): () => void {
      return () => {}
    }
    emit(): void {}
    async rekey(): Promise<void> {}
    async aplicarSomAoVivo(): Promise<void> {}
    reafirmarPresenca(): void {}
  },
}))
vi.mock("mediasoup-client", () => ({ Device: class {} }))
vi.mock("@enclave/ui", () => ({ registerSystemNoticeHost: () => {} }))

/** A read response, as the `preload` returns it. */
const bem = <T>(valor: T): { ok: true; valor: T } => ({ ok: true, valor })

/** What the host saw, in the order it saw it. */
let feito: string[] = []
/** What the next read will answer when it is not the normal value. */
let leituraFalha: string | null = null
/** The rejection that the next request will throw, if there is one. */
let pedidoFalha: string | null = null

const SALA = { room: "a", name: "Sala A", category: "geral", kind: "text" as const, position: 1 }

/**
 * The Electron host: the `preload`, faking it.
 *
 * Reads answer with the envelope and mutations with promises, which is the
 * difference in style that crosses real IPC. Each one registers itself in
 * `feito`, so we can prove IT WAS CALLED and with what, not just that the
 * bridge returned something.
 */
function anfitriao(): Record<string, never> & {
  ouvintes: Record<string, ((carga: unknown) => void)[]>
  disparar: (evento: string, carga?: unknown) => void
} {
  const ouvintes: Record<string, ((carga: unknown) => void)[]> = {}
  const inscrever =
    (nome: string) =>
    (handler: (carga: unknown) => void): (() => void) => {
      ;(ouvintes[nome] ??= []).push(handler)
      return () => {
        ouvintes[nome] = (ouvintes[nome] ?? []).filter((cada) => cada !== handler)
      }
    }

  const ler = <T>(nome: string, argumentos: unknown[], valor: T): { ok: true; valor: T } | { ok: false; erro: string } => {
    feito.push(`${nome}:${argumentos.join(":")}`)
    if (leituraFalha) return { ok: false, erro: leituraFalha }
    return bem(valor)
  }
  const pedir = async (nome: string, argumentos: unknown[]): Promise<{ ok: boolean }> => {
    feito.push(`${nome}:${argumentos.join(":")}`)
    if (pedidoFalha) throw new Error(pedidoFalha)
    return { ok: true }
  }

  const host = {
    ouvintes,
    disparar: (evento: string, carga: unknown = {}) => {
      for (const ouvinte of [...(ouvintes[evento] ?? [])]) ouvinte(carga)
    },
    vault: {},
    identity: {},
    session: {},
    social: {},
    votacoes: {},
    notifications: {},
    notify: { show: async () => ({ shown: false }) },
    invites: {},
    profile: {},
    voice: { key: async () => null, ice: async () => [] },
    sfu: { suporta: async () => false },
    channels: {
      // ------------------------------------------------------- as leituras
      rooms: (channel: string) => ler("rooms", [channel], [SALA]),
      closedRooms: (channel: string) => ler("closedRooms", [channel], [{ ...SALA, room: "z" }]),
      categories: (channel: string) => ler("categories", [channel], [{ category: "geral", position: 0, roles: [] }]),
      meta: (channel: string) => ler("meta", [channel], { name: "O Canal", updatedAt: 7 }),
      mayEdit: (channel: string) => ler("mayEdit", [channel], true),
      founder: (channel: string) => ler("founder", [channel], "@quem:servidor"),
      admins: (channel: string) => ler("admins", [channel], ["@outro:servidor"]),
      mayDelete: (channel: string) => ler("mayDelete", [channel], true),
      roles: (channel: string) => ler("roles", [channel], [{ role: "guarda", name: "Guarda", powers: [] }]),
      rolesFor: (channel: string, address: string) => ler("rolesFor", [channel, address], ["guarda"]),
      mayManageRoles: (channel: string) => ler("mayManageRoles", [channel], true),
      mayAttend: (channel: string) => ler("mayAttend", [channel], true),
      mayMove: (channel: string) => ler("mayMove", [channel], true),
      mayInvite: (channel: string) => ler("mayInvite", [channel], true),
      mayExpel: (channel: string) => ler("mayExpel", [channel], true),
      pins: (channel: string, room: string) =>
        ler("pins", [channel, room], [{ id: "m1", sender: "@quem:servidor", body: "fica", sentAt: 1, pinnedAt: 2 }]),
      mayPin: (channel: string) => ler("mayPin", [channel], true),
      tickets: (channel: string, room: string) =>
        ler("tickets", [channel, room], [{ id: "t1", subject: "a porta", state: "open" }]),
      mayDecideTicket: (channel: string, room: string, ticket: string) =>
        ler("mayDecideTicket", [channel, room, ticket], true),

      // -------------------------------------------------------- the requests
      list: async () => ["!geral:servidor"],
      create: (channel: string) => pedir("create", [channel]),
      invite: (channel: string, address: string) => pedir("invite", [channel, address]),
      channelInvites: async () => [],
      acceptChannelInvite: (dm: string, alvo: string) => pedir("acceptChannelInvite", [dm, alvo]),
      declineChannelInvite: (dm: string, alvo: string) => pedir("declineChannelInvite", [dm, alvo]),
      send: (channel: string, body: string) => pedir("send", [channel, body]),
      typing: (channel: string) => pedir("typing", [channel]),
      buzz: (channel: string) => pedir("buzz", [channel]),
      members: async () => [],
      history: async () => [],
      forget: (channel: string) => pedir("forget", [channel]),
      safetyNumber: async () => null,
      setRoom: (channel: string, next: { room: string; name: string }) =>
        pedir("setRoom", [channel, next.room, next.name]),
      setCategory: (channel: string, next: { category: string }) => pedir("setCategory", [channel, next.category]),
      setMeta: (channel: string, next: { name: string }) => pedir("setMeta", [channel, next.name]),
      setAdmin: (channel: string, address: string, admin: boolean) => pedir("setAdmin", [channel, address, admin]),
      claimFounder: (channel: string) => pedir("claimFounder", [channel]),
      remove: (channel: string) => pedir("remove", [channel]),
      setRoles: (channel: string, address: string, roles: string[]) =>
        pedir("setRoles", [channel, address, roles.join("+")]),
      defineRole: (channel: string, next: { role: string }) => pedir("defineRole", [channel, next.role]),
      deleteRole: (channel: string, role: string) => pedir("deleteRole", [channel, role]),
      reorderRoles: (channel: string, ordem: string[]) => pedir("reorderRoles", [channel, ordem.join("+")]),
      moveVoice: (channel: string, address: string, room: string) => pedir("moveVoice", [channel, address, room]),
      expel: (channel: string, address: string) => pedir("expel", [channel, address]),
      pin: (channel: string, room: string, message: { id: string; body: string }) =>
        pedir("pin", [channel, room, message.id, message.body]),
      unpin: (channel: string, room: string, id: string) => pedir("unpin", [channel, room, id]),
      openTicket: async (channel: string, room: string, subject: string) => {
        feito.push(`openTicket:${channel}:${room}:${subject}`)
        return { ok: true, id: "t-novo" }
      },
      replyToTicket: (channel: string, room: string, ticket: string, body: string) =>
        pedir("replyToTicket", [channel, room, ticket, body]),
      setTicketState: (channel: string, room: string, ticket: string, state: string) =>
        pedir("setTicketState", [channel, room, ticket, state]),
      takeTicket: (channel: string, room: string, ticket: string) => pedir("takeTicket", [channel, room, ticket]),
      releaseTicket: (channel: string, room: string, ticket: string) => pedir("releaseTicket", [channel, room, ticket]),
      editMessage: (channel: string, alvo: string, body: string) => pedir("editMessage", [channel, alvo, body]),
      deleteMessage: (channel: string, alvo: string) => pedir("deleteMessage", [channel, alvo]),
    },
    on: {
      message: inscrever("message"),
      epoch: inscrever("epoch"),
      status: inscrever("status"),
      connection: inscrever("connection"),
      channels: inscrever("channels"),
      presence: inscrever("presence"),
      typing: inscrever("typing"),
      buzz: inscrever("buzz"),
      voice: inscrever("voice"),
      sfu: inscrever("sfu"),
      noticeOpen: inscrever("noticeOpen"),
      windowState: inscrever("windowState"),
      ecraPedido: inscrever("ecraPedido"),
    },
  }
  return host as unknown as ReturnType<typeof anfitriao>
}

const CANAL = "!geral:servidor"

let host: ReturnType<typeof anfitriao>

const { createDesktopBridge } = await import("./bridge.js")

beforeEach(() => {
  feito = []
  leituraFalha = null
  pedidoFalha = null
  host = anfitriao()
  Object.defineProperty(window, "enclaveHost", { value: host, writable: true, configurable: true })
})

describe("a interface recebe as operações de canal todas", () => {
  it("nenhuma das 38 fica por entregar", () => {
    const canais = createDesktopBridge().channels as unknown as Record<string, unknown>

    /*
      The list is the one from the browser bridge, `apps/web/src/bridge.ts`,
      which is the reference: 52 operations, of which 15 already crossed. The
      remaining 37 are what was missing, and `mayExpel` is the 38th, it
      existed, with the wrong shape.
      
      Written out in full, not generated: a list derived from the type would
      compile with one fewer operation the day someone removes it from the
      type, which is exactly the step you don't want to be able to take
      without noticing.
      */
    for (const nome of [
      "rooms",
      "closedRooms",
      "categories",
      "setRoom",
      "setCategory",
      "meta",
      "setMeta",
      "mayEdit",
      "founder",
      "admins",
      "setAdmin",
      "claimFounder",
      "mayDelete",
      "remove",
      "roles",
      "rolesFor",
      "mayManageRoles",
      "setRoles",
      "defineRole",
      "deleteRole",
      "reorderRoles",
      "mayAttend",
      "mayMove",
      "mayInvite",
      "mayExpel",
      "moveVoice",
      "pins",
      "mayPin",
      "pin",
      "unpin",
      "tickets",
      "mayDecideTicket",
      "openTicket",
      "replyToTicket",
      "setTicketState",
      "takeTicket",
      "releaseTicket",
      "editMessage",
      "deleteMessage",
    ]) {
      expect(typeof canais[nome], nome).toBe("function")
    }
  })

  it("as leituras devolvem valor: nem promessa, nem envelope", () => {
    const canais = createDesktopBridge().channels

    // The bug that made `mayExpel` say yes to everyone fits in this line: a
    // promise is an object, and `?? false` lets it through whole.
    expect(canais.mayEdit(CANAL)).toBe(true)
    expect(canais.rooms(CANAL)).toEqual([SALA])
    expect(canais.founder(CANAL)).toBe("@quem:servidor")
    expect(canais.meta(CANAL)).toEqual({ name: "O Canal", updatedAt: 7 })
    expect(canais.mayPin?.(CANAL)).toBe(true)
    expect(canais.tickets?.(CANAL, "sala")).toEqual([{ id: "t1", subject: "a porta", state: "open" }])
    expect(canais.rooms(CANAL)).not.toBeInstanceOf(Promise)
  })

  it("as leituras vão mesmo ao anfitrião, com os argumentos por ordem", () => {
    const canais = createDesktopBridge().channels

    canais.rolesFor(CANAL, "@alguem:servidor")
    canais.pins?.(CANAL, "sala")
    canais.mayDecideTicket?.(CANAL, "sala", "t1")

    expect(feito).toEqual([
      `rolesFor:${CANAL}:@alguem:servidor`,
      `pins:${CANAL}:sala`,
      `mayDecideTicket:${CANAL}:sala:t1`,
    ])
  })

  it("os pedidos vão mesmo ao anfitrião, com os argumentos por ordem", async () => {
    const canais = createDesktopBridge().channels

    await canais.setRoom(CANAL, { room: "nova", name: "Nova", category: "", kind: "text", position: 0 })
    await canais.setCategory?.(CANAL, { category: "Voz" })
    await canais.pin?.(CANAL, "sala", { id: "m1", sender: "@quem:servidor", body: "a cópia", sentAt: 1 })
    await canais.setTicketState?.(CANAL, "sala", "t1", "closed")
    await canais.setRoles(CANAL, "@alguem:servidor", ["guarda", "porteiro"])
    await canais.editMessage?.(CANAL, "m1", "assim é que é")

    expect(feito).toEqual([
      `setRoom:${CANAL}:nova:Nova`,
      `setCategory:${CANAL}:Voz`,
      `pin:${CANAL}:sala:m1:a cópia`,
      `setTicketState:${CANAL}:sala:t1:closed`,
      `setRoles:${CANAL}:@alguem:servidor:guarda+porteiro`,
      `editMessage:${CANAL}:m1:assim é que é`,
    ])
  })

  it("abrir um ticket devolve o identificador que veio do outro processo", async () => {
    const canais = createDesktopBridge().channels

    expect(await canais.openTicket?.(CANAL, "sala", "a porta")).toEqual({ ok: true, id: "t-novo" })
  })
})

describe("a memória das leituras", () => {
  it("uma leitura repetida não volta a atravessar o IPC", () => {
    const canais = createDesktopBridge().channels

    canais.mayEdit(CANAL)
    canais.mayEdit(CANAL)
    canais.mayEdit(CANAL)

    // Each of these blocks the renderer while the other process replies, and the
    // UI does dozens of them per `render`. Without caching, typing a letter in
    // the message box would pay for all of them again.
    expect(feito).toEqual([`mayEdit:${CANAL}`])
  })

  it("guarda por argumentos, e não por operação", () => {
    const canais = createDesktopBridge().channels

    canais.rolesFor(CANAL, "@um:servidor")
    canais.rolesFor(CANAL, "@outro:servidor")
    canais.rolesFor(CANAL, "@um:servidor")

    // One cache per operation answered the roles of the first person to everyone
    // on the list, and the member list is made of one query per person.
    expect(feito).toEqual([`rolesFor:${CANAL}:@um:servidor`, `rolesFor:${CANAL}:@outro:servidor`])
  })

  it("esquece com uma mensagem, com a epoch e com a lista de canais", () => {
    const canais = createDesktopBridge().channels

    canais.rooms(CANAL)
    host.disparar("message", { channel: CANAL })
    canais.rooms(CANAL)
    host.disparar("epoch", { channel: CANAL })
    canais.rooms(CANAL)
    host.disparar("channels", [CANAL])
    canais.rooms(CANAL)

    expect(feito).toEqual([`rooms:${CANAL}`, `rooms:${CANAL}`, `rooms:${CANAL}`, `rooms:${CANAL}`])
  })

  it("NÃO esquece com um sinal de escrita", () => {
    const canais = createDesktopBridge().channels

    canais.rooms(CANAL)
    host.disparar("typing", { channel: CANAL, from: "@alguem:servidor" })
    canais.rooms(CANAL)

    // Someone else's keystroke does not change any rooms, and forgetting here
    // meant paying all the reads again for every letter someone types next to you.
    expect(feito).toEqual([`rooms:${CANAL}`])
  })

  it("esquece depois de um pedido, mesmo quando o pedido falha", async () => {
    const canais = createDesktopBridge().channels
    canais.rooms(CANAL)

    await canais.setRoom(CANAL, { room: "nova", name: "Nova", category: "", kind: "text", position: 0 })
    canais.rooms(CANAL)

    pedidoFalha = "não administras este canal"
    await expect(
      canais.setRoom(CANAL, { room: "x", name: "X", category: "", kind: "text", position: 0 }),
    ).rejects.toThrow(/administras/)
    canais.rooms(CANAL)

    // The second read must cross again: publishing a room changes what `roomsOf`
    // returns. And the third too, a request that fails halfway might have
    // published before failing, and caching that survives that shows the world
    // before the gesture.
    expect(feito.filter((cada) => cada.startsWith("rooms")).length).toBe(3)
  })

  it("esquece ANTES de a interface reler, e não depois", () => {
    const ponte = createDesktopBridge()
    const vistas: unknown[][] = []

    // The UI subscribes AFTER the bridge, which is what happens in reality: the
    // bridge is built before the React tree mounts. Listeners fire in subscription
    // order, and that ensures the cache is cleared before `useRooms` rerereads.
    // Otherwise the message reached the screen and the rooms stayed the old ones, // forever one message behind.
    ponte.on.message(() => vistas.push(ponte.channels.rooms(CANAL)))

    ponte.channels.rooms(CANAL)
    const anfitriaoComOutraSala = host as unknown as {
      channels: { rooms: (canal: string) => { ok: true; valor: unknown[] } }
    }
    anfitriaoComOutraSala.channels.rooms = () => bem([SALA, { ...SALA, room: "b", name: "Sala B" }])

    host.disparar("message", { channel: CANAL })

    expect(vistas).toEqual([[SALA, { ...SALA, room: "b", name: "Sala B" }]])
  })
})

describe("quando a leitura falha", () => {
  it("devolve o valor de omissão seguro e QUEIXA-SE", () => {
    const queixas: unknown[] = []
    const original = console.error
    console.error = (...argumentos: unknown[]): void => {
      queixas.push(argumentos.join(" "))
    }
    try {
      leituraFalha = "o cofre está trancado"
      const canais = createDesktopBridge().channels

      expect(canais.rooms(CANAL)).toEqual([])
      expect(canais.mayEdit(CANAL)).toBe(false)
      expect(canais.founder(CANAL)).toBe(null)

      /*
        The complaint is what separates this from the bug that was fixed. A
        read that fails silently is indistinguishable from a channel with no
        rooms, and that is exactly how 37 operations were absent without
        anyone noticing.
      */
      expect(queixas.some((cada) => String(cada).includes("channels.rooms"))).toBe(true)
      expect(queixas.some((cada) => String(cada).includes("o cofre está trancado"))).toBe(true)
    } finally {
      console.error = original
    }
  })

  it("as leituras que o anfitrião não trouxer não aparecem, em vez de rebentarem", () => {
    // The real case is development: the renderer comes from vite and the `preload`
    // comes from the last build. A missing operation must read as missing.
    const velho = host as unknown as { channels: Record<string, unknown> }
    delete velho.channels.tickets
    delete velho.channels.mayPin

    const canais = createDesktopBridge().channels

    // Absent, not present-but-broken: the UI decides what to offer based on
    // presence, `bridge.channels.setCategory &&`, in `App.tsx`.
    expect(canais.tickets).toBeUndefined()
    expect(canais.mayPin).toBeUndefined()
    // And the ones that are mandatory in the bridge still answer with the safe
    // value, because the UI calls them without checking.
    delete velho.channels.rooms
    expect(createDesktopBridge().channels.rooms(CANAL)).toEqual([])
  })
})
