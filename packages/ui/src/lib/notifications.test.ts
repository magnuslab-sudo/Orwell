import { afterEach, describe, expect, it, vi } from "vitest"
import {
  appendNotification,
  fundirNotificacoes,
  listenForSystemNoticeClicks,
  markAllRead,
  markRead,
  NOTICE_CLICK_MESSAGE,
  NOTIFICATION_CAP,
  notificationTextOf,
  retirarPedidoDe,
  registerSystemNoticeHost,
  showSystemNotice,
  systemNoticeVerdictOf,
  unreadCountOf,
  type AppNotification,
  type SystemNotice,
  type SystemNoticeContext,
} from "./notifications.js"
import { strings } from "../strings.js"
import { moradaDeTeste } from "../../testes/moradas.js"

const DM_A_B = moradaDeTeste("directa a b", "s")
const DM_ANA_BRUNO = moradaDeTeste("directa ana bruno", "s")
const DM_C_D = moradaDeTeste("directa c d", "s")

/**
 * The omission type is `dm-message`, and used to be `friend-request`.
 *
 * It changed when the bell started storing one friend request per person. With
 * `friend-request` as the default, the generic tests here, order, cap, merge,  * were all measuring collapse instead of what they care about, because they use
 * the same actor in every entry. `dm-message` has no rules in this file (the
 * "one per conversation" rule lives in `App.tsx`), so it is the right neutral type.
 * Anyone who wants a friend request asks for it: it is written in each test that
 * measures it.
 */
function entry(id: string, overrides: Partial<AppNotification> = {}): AppNotification {
  return { id, kind: "dm-message", at: 1, actor: "@ana:s", channel: DM_A_B, read: false, ...overrides }
}

describe("appendNotification", () => {
  it("mais recente primeiro, sem duplicados, com tecto", () => {
    let list: AppNotification[] = []
    list = appendNotification(list, entry("a"))
    list = appendNotification(list, entry("b"))
    list = appendNotification(list, entry("a"))
    expect(list.map((item) => item.id)).toEqual(["b", "a"])

    for (let i = 0; i < NOTIFICATION_CAP + 10; i++) list = appendNotification(list, entry(`x${i}`))
    expect(list).toHaveLength(NOTIFICATION_CAP)
  })
})

describe("estado de leitura", () => {
  it("conta por ler, marca uma, marca todas", () => {
    let list = [entry("a"), entry("b"), entry("c", { read: true })]
    expect(unreadCountOf(list)).toBe(2)
    list = markRead(list, "a")
    expect(unreadCountOf(list)).toBe(1)
    list = markAllRead(list)
    expect(unreadCountOf(list)).toBe(0)
  })
})

describe("notificationTextOf", () => {
  const nameFor = (address: string): string => (address === "@ana:s" ? "Ana" : address)
  const labelFor = (channel: string): string => (channel === "!geral:s" ? "geral" : channel)

  it("cada tipo diz o que aconteceu, com nomes vivos", () => {
    // "Wants to be your friend", not "wants you to follow": friendship is mutual, and
    // an accepted request makes both sides.
    expect(notificationTextOf(entry("1", { kind: "friend-request" }), nameFor, labelFor)).toBe(
      strings.people.wantsToBeFriends("Ana"),
    )
    expect(notificationTextOf(entry("2", { kind: "friend-accept" }), nameFor, labelFor)).toBe(
      strings.notifCenter.friendAccept("Ana"),
    )
    expect(notificationTextOf(entry("3", { kind: "dm-new" }), nameFor, labelFor)).toBe(
      strings.notifCenter.dmNew("Ana"),
    )
    expect(notificationTextOf(entry("4", { kind: "dm-message" }), nameFor, labelFor)).toBe(
      strings.notifCenter.dmMessage("Ana"),
    )
    expect(
      notificationTextOf(entry("5", { kind: "room-added", channel: "!geral:s" }), nameFor, labelFor),
    ).toBe(strings.notifCenter.roomAdded("geral"))
  })

  it("a decisão sobre uma denúncia diz a decisão e as vias de reparação, e mais nada", () => {
    const decisao = (d: "suspensa" | "sem-accao"): string =>
      notificationTextOf({ id: "d", kind: "report-decision", at: 1, decisao: d, read: false }, nameFor, labelFor)
    const vias = "Se discordas, escreve para orwell.eu@proton.me, podes recorrer aos tribunais, ou reclamar à ANACOM."
    expect(decisao("suspensa")).toBe(`A tua denúncia foi analisada: conta suspensa. ${vias}`)
    expect(decisao("sem-accao")).toBe(`A tua denúncia foi analisada: sem acção. ${vias}`)
  })
})

describe("systemNoticeVerdictOf", () => {
  /** Someone outside, with notifications on and not hiding content. */
  const fora: SystemNoticeContext = {
    enabled: true,
    busy: false,
    preview: true,
    windowInFront: false,
    unlocked: true,
  }

  it("com o cofre fechado nunca diz nada, nem sequer que há coisa nova", () => {
    // The most critical mute in the list: no keys means nothing is decrypted, and an
    // alert from here could only be a lie or a leak.
    expect(systemNoticeVerdictOf(entry("a", { kind: "dm-message" }), { ...fora, unlocked: false })).toBe("silent")
    // And it mutes even when everything else is on and waiting.
    expect(
      systemNoticeVerdictOf(entry("b", { kind: "mention" }), {
        enabled: true,
        busy: false,
        preview: true,
        windowInFront: false,
        unlocked: false,
      }),
    ).toBe("silent")
  })

  /*
    Owner's request (November 2, 2026, item 6): the system alert also shows when
    the window is in front. Only the alert from the open conversation that is being
    read gets muted: it is already on screen.
  */
  it("com a janela à frente, cala só a conversa aberta e a ser lida", () => {
    expect(systemNoticeVerdictOf(entry("a"), { ...fora, windowInFront: true, canalAberto: DM_A_B })).toBe("silent")
    expect(systemNoticeVerdictOf(entry("a"), { ...fora, windowInFront: true, canalAberto: "!outra:s" })).toBe(
      "detailed",
    )
    expect(systemNoticeVerdictOf(entry("a"), { ...fora, windowInFront: true, canalAberto: null })).toBe("detailed")
    // The conversation is open, but the window is behind another: no one is reading it.
    expect(systemNoticeVerdictOf(entry("a"), { ...fora, windowInFront: false, canalAberto: DM_A_B })).toBe("detailed")
  })

  it('cala em "Ocupado" e com o interruptor desligado', () => {
    expect(systemNoticeVerdictOf(entry("b"), { ...fora, busy: true })).toBe("silent")
    expect(systemNoticeVerdictOf(entry("c"), { ...fora, enabled: false })).toBe("silent")
  })

  it("fala do que é dirigido a nós: mensagem privada, menção, pedido, convite", () => {
    for (const kind of ["dm-message", "mention", "friend-request", "room-added", "dm-new", "friend-accept"] as const) {
      expect(systemNoticeVerdictOf(entry(kind, { kind }), fora)).toBe("detailed")
    }
  })

  it("não interrompe por alguém ter usado um convite meu", () => {
    // Good to know, never urgent, the same reason it does not become a balloon inside
    // the app. See the note in `AppNotification`.
    expect(systemNoticeVerdictOf(entry("a", { kind: "channel-join" }), fora)).toBe("silent")
  })

  it('sem "Mostrar o conteúdo", diz que há e não diz o quê', () => {
    expect(systemNoticeVerdictOf(entry("a", { kind: "dm-message" }), { ...fora, preview: false })).toBe("discreet")
  })
})

describe("showSystemNotice", () => {
  const aviso: SystemNotice = { id: "a", title: "Orwell", body: "Ana escreveu-te", countable: true }

  it("entrega ao anfitrião registado, com a forma de abrir a conversa", () => {
    const vistos: SystemNotice[] = []
    let abrir = (): void => {}
    registerSystemNoticeHost({
      show: (notice, open) => {
        vistos.push(notice)
        abrir = open
      },
    })
    let aberto = false
    showSystemNotice(aviso, () => {
      aberto = true
    })
    expect(vistos).toEqual([aviso])
    abrir()
    expect(aberto).toBe(true)
    registerSystemNoticeHost(null)
  })

  it("sem anfitrião e sem permissão do browser, não rebenta nem mostra nada", () => {
    registerSystemNoticeHost(null)
    expect(() => showSystemNotice(aviso, () => {})).not.toThrow()
  })
})

/**
 * The alert from the Service Worker, which is the path of the installed web app.
 *
 * On Android, Chrome refuses `new Notification()` on a page, so the alert has to go
 * through `registration.showNotification()`. The tap reaches the Service Worker and
 * comes back to the page as a message with the alert id: what this proves is that
 * the tap opens the SAME conversation that `onclick` opened, and the desktop app,
 * which shares this file, never reaches `navigator.serviceWorker`.
 */
describe("showSystemNotice pelo Service Worker", () => {
  const aviso: SystemNotice = { id: "aviso-1", title: "Orwell", body: "Ana escreveu-te", countable: true }

  interface Mostrado {
    title: string
    options: { body?: string; tag?: string; data?: unknown }
  }

  /** A mock `navigator.serviceWorker`, with or without an active registration. */
  function workersFalsos(registo: "activo" | "nenhum" | "a-instalar" | "rebenta" | "recusa-mostrar") {
    const mostrados: Mostrado[] = []
    const alvo = new EventTarget()
    let consultas = 0
    let ouvintes = 0
    const registration = {
      active: registo === "a-instalar" ? null : {},
      showNotification: async (title: string, options: Mostrado["options"]) => {
        if (registo === "recusa-mostrar") throw new Error("recusado")
        mostrados.push({ title, options })
      },
    }
    const workers = {
      getRegistration: async () => {
        consultas += 1
        if (registo === "rebenta") throw new Error("SecurityError")
        return registo === "nenhum" ? undefined : registration
      },
      addEventListener: (tipo: string, ouvinte: EventListener) => {
        ouvintes += 1
        alvo.addEventListener(tipo, ouvinte)
      },
    }
    const tocar = (data: unknown): void => {
      alvo.dispatchEvent(new MessageEvent("message", { data }))
    }
    return { workers, mostrados, tocar, consultas: () => consultas, ouvintes: () => ouvintes }
  }

  /** The page `Notification`: records what created it, or fails like on Android. */
  function paginaFalsa(comportamento: "cria" | "rebenta") {
    const criados: { title: string; onclick: (() => void) | null; fechado: boolean }[] = []
    class NotificationFalsa {
      static permission = "granted"
      onclick: (() => void) | null = null
      fechado = false
      close(): void {
        this.fechado = true
      }
      constructor(public title: string) {
        if (comportamento === "rebenta") throw new TypeError("Illegal constructor")
        criados.push(this)
      }
    }
    vi.stubGlobal("Notification", NotificationFalsa)
    // jsdom does not implement `window.focus` and complains to stderr.
    vi.stubGlobal("focus", () => {})
    return criados
  }

  function porWorkers(workers: unknown): void {
    Object.defineProperty(navigator, "serviceWorker", { value: workers, configurable: true })
  }

  /** `getRegistration().then(...)`: deixa as promessas encadeadas assentar. */
  const assentar = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, "serviceWorker")
    registerSystemNoticeHost(null)
  })

  /** The symbol that went to the Service Worker in the last alert shown. */
  const simboloDe = (mostrado: Mostrado | undefined): string =>
    (mostrado?.options.data as { id: string } | undefined)?.id ?? ""

  it("sem erro no construtor, o Service Worker nem é consultado: a secretária fica como sempre esteve", async () => {
    // With active registration and all. A Service Worker alert is persistent, and on
    // Windows and Linux it does not close by itself: only those without another one go there.
    const criados = paginaFalsa("cria")
    const sw = workersFalsos("activo")
    porWorkers(sw.workers)
    let aberturas = 0
    showSystemNotice(aviso, () => {
      aberturas += 1
    })
    await assentar()

    expect(criados.map((c) => c.title)).toEqual(["Orwell"])
    expect(sw.consultas()).toBe(0)
    expect(sw.mostrados).toHaveLength(0)
    criados[0]?.onclick?.()
    expect(aberturas).toBe(1)
  })

  it("um aviso com prazo fecha-se sozinho nesse tempo (amigo online: 2 s)", () => {
    vi.useFakeTimers()
    try {
      const criados = paginaFalsa("cria")
      showSystemNotice({ ...aviso, expiraEmMs: 2000 }, () => {})
      expect(criados).toHaveLength(1)
      vi.advanceTimersByTime(1999)
      expect(criados[0]?.fechado).toBe(false)
      vi.advanceTimersByTime(1)
      expect(criados[0]?.fechado).toBe(true)
      // No timeout, uses the system time.
      showSystemNotice(aviso, () => {})
      vi.advanceTimersByTime(60_000)
      expect(criados[1]?.fechado).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("o TypeError do Android leva ao Service Worker, e o toque abre a conversa uma vez", async () => {
    paginaFalsa("rebenta")
    const sw = workersFalsos("activo")
    porWorkers(sw.workers)
    let aberturas = 0
    expect(() =>
      showSystemNotice(aviso, () => {
        aberturas += 1
      }),
    ).not.toThrow()
    await assentar()

    expect(sw.mostrados).toHaveLength(1)
    expect(sw.mostrados[0]?.title).toBe("Orwell")
    expect(sw.mostrados[0]?.options.body).toBe("Ana escreveu-te")
    const simbolo = simboloDe(sw.mostrados[0])

    // A symbol from no page, and garbage: nothing opens.
    sw.tocar({ type: NOTICE_CLICK_MESSAGE, id: "outro" })
    sw.tocar({ type: "outra-coisa", id: simbolo })
    sw.tocar(null)
    expect(aberturas).toBe(0)

    sw.tocar({ type: NOTICE_CLICK_MESSAGE, id: simbolo })
    expect(aberturas).toBe(1)
    // The same tap repeated does not open again.
    sw.tocar({ type: NOTICE_CLICK_MESSAGE, id: simbolo })
    expect(aberturas).toBe(1)
  })

  it("o que segue para o browser é um símbolo nosso, e não o identificador do aviso", async () => {
    // The real id is `dm:<canal>:<mensagem>`: channel metadata, with a piece chosen by the sender. The browser saves `tag` and `data` to disk, outside the vault, while the notification is there.
    paginaFalsa("rebenta")
    const sw = workersFalsos("activo")
    porWorkers(sw.workers)
    const secreto: SystemNotice = { ...aviso, id: `dm:${DM_ANA_BRUNO}:m-123`, channel: DM_ANA_BRUNO }
    showSystemNotice(secreto, () => {})
    showSystemNotice(secreto, () => {})
    await assentar()

    expect(sw.mostrados).toHaveLength(2)
    for (const mostrado of sw.mostrados) {
      expect(Object.keys(mostrado.options).sort()).toEqual(["body", "data"])
      expect(Object.keys(mostrado.options.data as object)).toEqual(["id"])
      expect(simboloDe(mostrado)).toMatch(/^[0-9a-f]{32}$/)
      expect(JSON.stringify(mostrado.options)).not.toMatch(/dm:|ana|bruno|m-123/)
    }
    // Drawn per alert: the same alert twice gives two symbols.
    expect(simboloDe(sw.mostrados[0])).not.toBe(simboloDe(sw.mostrados[1]))
  })

  it("o toque no id verdadeiro não abre nada: a chave do mapa não é escolhida por quem envia", async () => {
    paginaFalsa("rebenta")
    const sw = workersFalsos("activo")
    porWorkers(sw.workers)
    let aberturas = 0
    showSystemNotice(aviso, () => {
      aberturas += 1
    })
    await assentar()
    sw.tocar({ type: NOTICE_CLICK_MESSAGE, id: aviso.id })
    expect(aberturas).toBe(0)
  })

  it("o tipo da mensagem é o que o sw.js escreve", () => {
    expect(NOTICE_CLICK_MESSAGE).toBe("enclave.notice-click")
  })

  it.each(["nenhum", "a-instalar", "rebenta", "recusa-mostrar"] as const)(
    "construtor a rebentar e registo %s: fica sem aviso do sistema, e sem rebentar",
    async (registo) => {
      paginaFalsa("rebenta")
      const sw = workersFalsos(registo)
      porWorkers(sw.workers)
      const rejeicoes: unknown[] = []
      const apanhar = (motivo: unknown): void => void rejeicoes.push(motivo)
      process.on("unhandledRejection", apanhar)
      expect(() => showSystemNotice(aviso, () => {})).not.toThrow()
      await assentar()
      await new Promise((resolve) => setTimeout(resolve, 0))
      process.off("unhandledRejection", apanhar)

      expect(rejeicoes).toEqual([])
      expect(sw.mostrados).toHaveLength(0)
    },
  )

  it("construtor a rebentar e sem navigator.serviceWorker: nada, e sem rebentar", () => {
    paginaFalsa("rebenta")
    expect(() => showSystemNotice(aviso, () => {})).not.toThrow()
  })

  it("com anfitrião (a aplicação de secretária) nem a página nem o Service Worker são tocados", async () => {
    const criados = paginaFalsa("rebenta")
    const sw = workersFalsos("activo")
    porWorkers(sw.workers)
    const vistos: SystemNotice[] = []
    registerSystemNoticeHost({ show: (notice) => void vistos.push(notice) })
    showSystemNotice(aviso, () => {})
    listenForSystemNoticeClicks()
    await assentar()

    expect(vistos).toEqual([aviso])
    expect(sw.consultas()).toBe(0)
    expect(sw.ouvintes()).toBe(0)
    expect(sw.mostrados).toHaveLength(0)
    expect(criados).toHaveLength(0)
  })

  it("o ouvinte do arranque traz a janela à frente mesmo sem saber que conversa abrir", () => {
    // A page just reloaded: no alert shown, map empty.
    paginaFalsa("rebenta")
    const focos = vi.fn()
    vi.stubGlobal("focus", focos)
    const sw = workersFalsos("activo")
    porWorkers(sw.workers)

    listenForSystemNoticeClicks()
    listenForSystemNoticeClicks()
    expect(sw.ouvintes()).toBe(1)

    sw.tocar({ type: NOTICE_CLICK_MESSAGE, id: "de-antes-de-recarregar" })
    expect(focos).toHaveBeenCalledTimes(1)
    // And garbage does not count as a tap.
    sw.tocar({ type: "outra-coisa", id: "x" })
    expect(focos).toHaveBeenCalledTimes(1)
  })

  it("sem navigator.serviceWorker o ouvinte do arranque não faz nada", () => {
    expect(() => listenForSystemNoticeClicks()).not.toThrow()
  })
})

/**
 * An event, one line in the bell.
 *
 * `requestFriend` opens the direct conversation and then sends the request, and on the
 * receiver side that arrived as two separate events. The bell showed "Ana opened a
 * conversation with you" right above "Ana wants to be your friend", read live on
 * September 10, 2026, and the first of the two announced a conversation where you
 * cannot yet write.
 */
describe("um pedido de amizade não traz uma conversa nova atrás", () => {
  const CANAL = moradaDeTeste("directa a b", "s")

  it("o pedido apaga o aviso de conversa nova do mesmo canal", () => {
    let lista = appendNotification([], entry("chan", { kind: "dm-new", at: 1 }))
    lista = appendNotification(lista, entry("freq", { kind: "friend-request", at: 2 }))

    expect(lista.map((item) => item.kind)).toEqual(["friend-request"])
  })

  it("e um aviso de conversa nova que chegue depois não se acrescenta", () => {
    // The real order is the other way, the channel exists before the message travels through
    // it, but a guaranteed order today is one no one will verify again tomorrow.
    let lista = appendNotification([], entry("freq", { kind: "friend-request", at: 2 }))
    lista = appendNotification(lista, entry("chan", { kind: "dm-new", at: 1 }))

    expect(lista.map((item) => item.kind)).toEqual(["friend-request"])
  })

  it("mas uma conversa nova de OUTRO canal continua a ser notícia", () => {
    let lista = appendNotification([], entry("freq", { kind: "friend-request", at: 2, channel: CANAL }))
    lista = appendNotification(lista, entry("chan", { kind: "dm-new", at: 3, channel: DM_C_D }))

    expect(lista.map((item) => item.id)).toEqual(["chan", "freq"])
  })

  it("e um pedido sem canal não apaga aviso nenhum", () => {
    // Saves on the FORM: a request with no channel would match every `dm-new` that also had
    // no channel, and clear the bell of things that are not its.
    let lista = appendNotification([], entry("chan", { kind: "dm-new", at: 1, channel: undefined }))
    lista = appendNotification(lista, entry("freq", { kind: "friend-request", at: 2, channel: undefined }))

    expect(lista.map((item) => item.id)).toEqual(["freq", "chan"])
  })
})

/**
 * A friend request per person, the one the owner saw in the notification bell.
 *
 * The key has the timestamp (`freq:<canal>:<sentAt>`, in `App.tsx`), so two
 * requests from the same person would give two `id`s and two lines saying the same thing. The
 * rule "one entry per conversation" existed for direct messages and was never
 * written for requests.
 */
describe("um pedido de amizade por pessoa", () => {
  const ANA = "@ana:s"
  const BENTO = "@bento:s"

  it("dois pedidos da mesma pessoa dão uma linha, a mais recente", () => {
    let lista = appendNotification([], entry("freq-1", { kind: "friend-request", at: 1, actor: ANA }))
    lista = appendNotification(lista, entry("freq-2", { kind: "friend-request", at: 2, actor: ANA }))

    expect(lista.map((item) => item.id)).toEqual(["freq-2"])
  })

  it("mas duas pessoas diferentes continuam a ser duas linhas", () => {
    let lista = appendNotification([], entry("freq-ana", { kind: "friend-request", at: 1, actor: ANA }))
    lista = appendNotification(lista, entry("freq-bento", { kind: "friend-request", at: 2, actor: BENTO }))

    expect(lista.map((item) => item.id)).toEqual(["freq-bento", "freq-ana"])
  })

  it("o pedido novo nasce por ler, mesmo que o anterior já tivesse sido visto", () => {
    // A new request is news: collapsing to keep the OLD entry left the bell quiet about
    // something that just happened.
    let lista = appendNotification([], entry("freq-1", { kind: "friend-request", at: 1, actor: ANA, read: true }))
    lista = appendNotification(lista, entry("freq-2", { kind: "friend-request", at: 2, actor: ANA }))

    expect(lista).toHaveLength(1)
    expect(lista[0]?.read).toBe(false)
  })

  it("sem actor vale a conversa, que é a dos dois", () => {
    const CONVERSA = moradaDeTeste("directa a b", "s")
    let lista = appendNotification(
      [],
      entry("freq-1", { kind: "friend-request", at: 1, actor: undefined, channel: CONVERSA }),
    )
    lista = appendNotification(
      lista,
      entry("freq-2", { kind: "friend-request", at: 2, actor: undefined, channel: CONVERSA }),
    )

    expect(lista.map((item) => item.id)).toEqual(["freq-2"])
  })

  it("sem actor E sem canal não há colapso nenhum", () => {
    // Saves on the form, like the `dm-new` one: an empty key would match all requests
    // without a name and delete requests from different people.
    let lista = appendNotification(
      [],
      entry("freq-1", { kind: "friend-request", at: 1, actor: undefined, channel: undefined }),
    )
    lista = appendNotification(
      lista,
      entry("freq-2", { kind: "friend-request", at: 2, actor: undefined, channel: undefined }),
    )

    expect(lista.map((item) => item.id)).toEqual(["freq-2", "freq-1"])
  })

  it("e a fusão com o cofre também dá uma linha só", () => {
    // The path that `appendNotification` does not cover: a request saved yesterday and another
    // arriving now have different `id` and both would pass.
    const guardado = entry("freq-1", { kind: "friend-request", at: 1, actor: ANA, read: true })
    const chegado = entry("freq-2", { kind: "friend-request", at: 2, actor: ANA })

    expect(fundirNotificacoes([guardado], [chegado]).map((item) => item.id)).toEqual(["freq-2"])
  })

  /**
   * **An early timestamp cannot silence the bell.**
   *
   * The `at` of a friend request is the `sentAt` that the SENDER writes, and
   * `sentAt` has no cap in the protocol. The merge sorts by `at` descending and
   * the collapse keeps the first: with a future timestamp, the first is the OLD
   * entry, and the old one is already marked as read. The new request made the
   * bell swing and disappeared from it seconds later, when the vault read
   * responded and the merge result was saved.
   *
   * And it never came back: the entry with `at` in the future wins all following
   * collapses, so a single early timestamp silenced on the bell all future
   * requests from that person, forever.
   *
   * All tests here measure the monotone case, where the new rule decides nothing.
   * This one reverses the timestamps, which is the only case where it decides.
   */
  it("um carimbo no futuro não dá por lido o pedido que acabou de chegar", () => {
    const adiantado = entry("freq-futuro", { kind: "friend-request", at: 9_999_999_999_999, actor: ANA, read: true })
    const agora = entry("freq-agora", { kind: "friend-request", at: 1_700_000_000_000, actor: ANA })

    const sino = fundirNotificacoes([adiantado], [agora])
    expect(sino).toHaveLength(1)
    // The bell SWINGS: it is the promise written in the header of `umPedidoPorPessoa`.
    expect(unreadCountOf(sino)).toBe(1)
    expect(sino[0]?.read).toBe(false)
  })

  it("e o colapso não inventa por ler quando as duas já foram vistas", () => {
    // The other half of the same rule: inheriting the unread state is inheriting, not creating.
    const adiantado = entry("freq-futuro", { kind: "friend-request", at: 9_999_999_999_999, actor: ANA, read: true })
    const antigo = entry("freq-antigo", { kind: "friend-request", at: 1, actor: ANA, read: true })

    expect(unreadCountOf(fundirNotificacoes([adiantado, antigo], []))).toBe(0)
  })
})

/**
 * The bell that opens while notifications are still arriving.
 *
 * The list lives in the vault and is read once per unlock; the catch delivers
 * late messages in the same window. Writing the read on top of what arrived
 * meanwhile erased it, and erased it forever, because on a later opening the
 * message already comes from the local archive and does not go through the path
 * that creates alerts.
 */
describe("fundirNotificacoes", () => {
  it("o que chegou durante a leitura do cofre sobrevive a ela", () => {
    const chegada = entry("freq", { at: 20 })

    expect(fundirNotificacoes([entry("velha", { at: 10 })], [chegada]).map((item) => item.id)).toEqual([
      "freq",
      "velha",
    ])
  })

  it("o mesmo acontecimento nas duas listas fica com a versão do cofre", () => {
    // It is the one in the vault that knows if it was already read. The one that arrived is always born unread.
    const guardada = entry("freq", { at: 10, read: true })
    const chegada = entry("freq", { at: 10, read: false })

    expect(fundirNotificacoes([guardada], [chegada])[0]?.read).toBe(true)
  })

  it("ordena pelo instante, do mais recente para o mais antigo", () => {
    const fundida = fundirNotificacoes(
      [entry("a", { at: 30 }), entry("c", { at: 10 })],
      [entry("b", { at: 20 })],
    )

    expect(fundida.map((item) => item.id)).toEqual(["a", "b", "c"])
  })

  it("e continua a caber no tecto", () => {
    const muitas = Array.from({ length: NOTIFICATION_CAP + 10 }, (_, i) => entry(`x${i}`, { at: i }))

    expect(fundirNotificacoes(muitas, [entry("nova", { at: 999 })])).toHaveLength(NOTIFICATION_CAP)
  })

  it("com o cofre vazio, o que chegou é tudo o que há", () => {
    expect(fundirNotificacoes([], [entry("freq", { at: 5 })]).map((item) => item.id)).toEqual(["freq"])
  })
})

describe("retirarPedidoDe", () => {
  const pedido = (actor: string, id: string): AppNotification => ({ id, kind: "friend-request", at: 1, actor, read: false })

  it("tira só os pedidos de amizade dessa pessoa", () => {
    const lista: AppNotification[] = [
      pedido("@ana:s", "freq:1"),
      pedido("@rui:s", "freq:2"),
      { id: "facc:1", kind: "friend-accept", at: 1, actor: "@ana:s", read: false },
    ]
    expect(retirarPedidoDe(lista, "@ana:s").map((entrada) => entrada.id)).toEqual(["freq:2", "facc:1"])
  })

  it("sem nada a tirar, devolve a mesma lista", () => {
    const lista = [pedido("@rui:s", "freq:2")]
    expect(retirarPedidoDe(lista, "@ana:s")).toBe(lista)
  })
})

describe("systemNoticeVerdictOf e a pausa (fase 4)", () => {
  it("em pausa, nada sai para o sistema, nem a menção", () => {
    const contexto: SystemNoticeContext = { enabled: true, busy: false, preview: true, windowInFront: false, unlocked: true }
    expect(systemNoticeVerdictOf(entry("a", { kind: "mention" }), { ...contexto, pausado: true })).toBe("silent")
    expect(systemNoticeVerdictOf(entry("b", { kind: "dm-message" }), { ...contexto, pausado: true })).toBe("silent")
    expect(systemNoticeVerdictOf(entry("c", { kind: "dm-message" }), { ...contexto, pausado: false })).toBe("detailed")
  })
})
