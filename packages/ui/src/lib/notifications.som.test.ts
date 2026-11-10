import { afterEach, describe, expect, it, vi } from "vitest"
import {
  avisoTemSomProprio,
  registerSystemNoticeHost,
  showSystemNotice,
  systemNoticeVerdictOf,
  type SystemNotice,
} from "./notifications.js"
import { caladaPeloSilencio, somDaMensagem } from "../sons/acontecimentos.js"
import { moradaDeTeste } from "../../testes/moradas.js"

const DM_ANA_EU = moradaDeTeste("directa ana eu", "s")

/**
 * System alert and app sound: one sound per event, never two.
 *
 * Page alert and Electron alert are silent, and the sound is from the app.
 * Only the Service Worker alert (Android) plays the system sound, and that is
 * what the engine reads to avoid playing again.
 */

const aviso: SystemNotice = { id: "a", title: "Orwell", body: "Ana escreveu-te", countable: false }

afterEach(() => {
  vi.unstubAllGlobals()
  registerSystemNoticeHost(null)
})

describe("por onde sai o aviso, e se faz som", () => {
  it("pelo Electron: sai calado, a aplicação toca", () => {
    registerSystemNoticeHost({ show: () => {} })
    const caminho = showSystemNotice(aviso, () => {})
    expect(caminho).toBe("anfitriao")
    expect(avisoTemSomProprio(caminho)).toBe(false)
  })

  it("pela página: sai com `silent`, a aplicação toca", () => {
    const opcoes: NotificationOptions[] = []
    class NotificationFalsa {
      static permission = "granted"
      onclick: (() => void) | null = null
      constructor(_titulo: string, opcao: NotificationOptions) {
        opcoes.push(opcao)
      }
    }
    vi.stubGlobal("Notification", NotificationFalsa)
    const caminho = showSystemNotice(aviso, () => {})
    expect(caminho).toBe("pagina")
    expect(opcoes[0]?.silent).toBe(true)
    expect(avisoTemSomProprio(caminho)).toBe(false)
  })

  it("pelo Service Worker (Android): o aviso faz o som, a aplicação não repete", () => {
    class NotificationQueRebenta {
      static permission = "granted"
      constructor() {
        throw new TypeError("Illegal constructor")
      }
    }
    vi.stubGlobal("Notification", NotificationQueRebenta)
    const caminho = showSystemNotice(aviso, () => {})
    expect(caminho).toBe("worker")
    expect(avisoTemSomProprio(caminho)).toBe(true)
  })

  it("sem permissão, não sai aviso nenhum, e a aplicação toca", () => {
    class NotificationNegada {
      static permission = "denied"
    }
    vi.stubGlobal("Notification", NotificationNegada)
    const caminho = showSystemNotice(aviso, () => {})
    expect(caminho).toBeNull()
    expect(avisoTemSomProprio(caminho)).toBe(false)
  })
})

/**
 * Muted silences it (owner's request on October 27, 2026): no system alert and
 * no sound. Mentions still go through, like on Discord.
 */
describe("silenciado cala o aviso e o som, menos a menção", () => {
  const contexto = { enabled: true, busy: false, preview: true, windowInFront: false, unlocked: true }
  const entrada = (kind: "dm-message" | "mention" | "room-added") => ({
    id: "x",
    kind,
    at: 1,
    channel: DM_ANA_EU,
    read: false,
  })

  it("o aviso do sistema sai calado num sítio silenciado", () => {
    expect(systemNoticeVerdictOf(entrada("dm-message"), contexto)).toBe("detailed")
    expect(systemNoticeVerdictOf(entrada("dm-message"), { ...contexto, silenciado: true })).toBe("silent")
    expect(systemNoticeVerdictOf(entrada("room-added"), { ...contexto, silenciado: true })).toBe("silent")
    expect(systemNoticeVerdictOf(entrada("mention"), { ...contexto, silenciado: true })).toBe("detailed")
  })

  it("o som da entrada do sino cala-se pela mesma regra", () => {
    expect(caladaPeloSilencio("dm-message", true)).toBe(true)
    expect(caladaPeloSilencio("dm-message", false)).toBe(false)
    expect(caladaPeloSilencio("mention", true)).toBe(false)
  })

  it("um ticket novo numa sala silenciada não toca; no canal silenciado também não", () => {
    const ticket = {
      channel: "!lagar:s",
      sender: "@ana:s",
      payload: { t: "message", room: "apoio", ticket: { id: "t1", subject: "luz" } },
    }
    const ninguem = (): null => null
    expect(somDaMensagem(ticket, "@eu:s", ninguem)).toBe("ticket")
    expect(somDaMensagem(ticket, "@eu:s", ninguem, ["!lagar:s/apoio"])).toBeNull()
    expect(somDaMensagem(ticket, "@eu:s", ninguem, ["!lagar:s"])).toBeNull()
    expect(somDaMensagem(ticket, "@eu:s", ninguem, ["!lagar:s/outra"])).toBe("ticket")
  })
})
