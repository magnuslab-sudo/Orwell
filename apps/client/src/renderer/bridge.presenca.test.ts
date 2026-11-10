import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The newcomer must learn there's a call in progress.
 *
 * The twin of `apps/web/src/bridge.presenca.test.ts`, and it exists for the
 * reason that made both bridges gain tests: `applyMediaPrefs` never existed
 * HERE, and no one noticed for months. Two bridges with the same contract are
 * two places where the same line can be missing, and one test only covers one of
 * them.
 */

/** What the `Call` received. Filled in by the double below. */
const motor = { reafirmacoes: 0, desligados: [] as string[] }

/** The listeners the bridge registered on the host, so we can fire them. */
const ouvintes = new Map<string, ((evento: unknown) => void)[]>()

vi.mock("@enclave/client-core", () => ({
  Call: class {
    reafirmarPresenca(): void {
      motor.reafirmacoes += 1
    }
    desligouSeDoServidor(quem: string): void {
      motor.desligados.push(quem)
    }
    on(): () => void {
      return () => {}
    }
    emit(): void {}
    rekey(): Promise<void> {
      return Promise.resolve()
    }
  },
  Session: class {
    on(): () => void {
      return () => {}
    }
  },
  Vault: class {},
}))

vi.mock("@enclave/crypto", () => ({ kindOf: () => "application" }))

/*
  The Electron host, which doesn't exist in the test browser.

  Unlike the mock in `bridge.media.test.ts`, this one KEEPS the listeners that
  register with it: what's tied here is precisely the subscription, and a mock
  that threw it away would measure something else.
*/
Object.defineProperty(window, "enclaveHost", {
  value: new Proxy(
    {},
    {
      get: (_alvo, chave) => {
        if (chave === "on") {
          return new Proxy(
            {},
            {
              get: (_a, evento: string) => (handler: (evento: unknown) => void) => {
                const lista = ouvintes.get(evento) ?? []
                lista.push(handler)
                ouvintes.set(evento, lista)
                return () => {}
              },
            },
          )
        }
        return new Proxy({}, { get: () => async () => ({}) })
      },
    },
  ),
  writable: true,
})

vi.mock("@enclave/ui", () => ({ registerSystemNoticeHost: () => {} }))

const { createDesktopBridge } = await import("./bridge.js")

function dizerAoVivo(evento: string, dados: unknown): void {
  for (const handler of ouvintes.get(evento) ?? []) handler(dados)
}

beforeEach(() => {
  motor.reafirmacoes = 0
  motor.desligados = []
  ouvintes.clear()
})

describe("a ponte da secretária responde a quem chega", () => {
  it("alguém que se liga faz a chamada reafirmar-se", () => {
    createDesktopBridge()

    dizerAoVivo("presence", { address: "@carla:orwell.pt", online: true })

    expect(motor.reafirmacoes).toBe(1)
  })

  it("alguém que se desliga não faz reafirmar nada", () => {
    createDesktopBridge()

    dizerAoVivo("presence", { address: "@carla:orwell.pt", online: false })

    expect(motor.reafirmacoes).toBe(0)
  })

  /**
   * The twin of `apps/web/src/bridge.presenca.test.ts`, and for the same reason
   * both bridges gained tests: two bridges with the same contract are two places
   * where the same line can be missing. Whoever closes the desktop app mid-SFU
   * call sends no `voice.leave`.
   */
  it("alguém que se desliga sai do roster da chamada", () => {
    createDesktopBridge()

    dizerAoVivo("presence", { address: "@carla:orwell.pt", online: false })

    expect(motor.desligados).toEqual(["@carla:orwell.pt"])
  })

  it("e quem se LIGA não é tirado de chamada nenhuma", () => {
    createDesktopBridge()

    dizerAoVivo("presence", { address: "@carla:orwell.pt", online: true })

    expect(motor.desligados).toEqual([])
  })
})
