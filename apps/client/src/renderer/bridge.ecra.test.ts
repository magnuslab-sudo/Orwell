import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Screen sharing crosses the desktop bridge.
 *
 * This is the last joint in the path, and the one you don't see either way
 * when it breaks: the UI already knows how to open a selector and read the
 * macOS permission, the main process already knows how to list sources and
 * answer the request, and between them is this file. Without these lines,
 * `bridge.ecra` is `undefined` in the installed app, and the UI reads the
 * absence as "this host handles this itself", which in Electron is precisely
 * the opposite of the truth. The result would be the original bug again:
 * `getDisplayMedia` falling on a request nobody answers, and a button that
 * does nothing.
 *
 * What we measure is the contract with `enclaveHost`: what goes in one side
 * comes out the other, with the arguments in the right order.
 */

/** What the Electron host received, on the `preload` side. */
const anfitriao = {
  fontesPedidas: [] as string[],
  escolhas: [] as { id: string; fonte: { id: string; nome: string } | null }[],
  definicoes: 0,
  /** The listener for the `event:ecra-pedido` event, saved by the subscription. */
  aoPedir: null as ((carga: unknown) => void) | null,
}

const FONTES = [
  { id: "screen:0:0", nome: "Ecrã 1", miniatura: "data:image/png;base64,M", ecraInteiro: true },
  { id: "window:12:0", nome: "Editor", miniatura: "", ecraInteiro: false },
]

vi.mock("@enclave/client-core", () => ({
  Call: class {
    on(): () => void {
      return () => {}
    }
    emit(): void {}
    rekey(): Promise<void> {
      return Promise.resolve()
    }
  },
  Session: class {},
  Vault: class {},
}))

vi.mock("@enclave/crypto", () => ({ kindOf: () => "application" }))
vi.mock("@enclave/ui", () => ({ registerSystemNoticeHost: () => {} }))

/**
 * The host, with `ecra` for real and the rest blank.
 *
 * The `Proxy` answers everything the bridge asks it, which makes this test
 * measure one thing only, but `ecra` and `on.ecraPedido` are real, because
 * that is what is being tested.
 */
function montarAnfitriao(comEcra: boolean): void {
  const ecra = {
    fontes: async (semNome: string) => {
      anfitriao.fontesPedidas.push(semNome)
      return FONTES
    },
    escolher: async (id: string, fonte: { id: string; nome: string } | null) => {
      anfitriao.escolhas.push({ id, fonte })
      return { ok: true }
    },
    permissao: async () => ({ estado: "denied", podeExplicar: true }),
    abrirDefinicoes: async () => {
      anfitriao.definicoes += 1
      return { ok: true }
    },
  }

  Object.defineProperty(window, "enclaveHost", {
    value: new Proxy(
      {},
      {
        get: (_alvo, chave) => {
          if (chave === "ecra") return comEcra ? ecra : undefined
          if (chave === "on") {
            return new Proxy(
              {},
              {
                get: (_outro, evento) => {
                  if (evento === "ecraPedido") {
                    return (handler: (carga: unknown) => void) => {
                      anfitriao.aoPedir = handler
                      return () => {
                        anfitriao.aoPedir = null
                      }
                    }
                  }
                  return () => () => {}
                },
              },
            )
          }
          return new Proxy({}, { get: () => async () => ({}) })
        },
      },
    ),
    writable: true,
    configurable: true,
  })
}

const { createDesktopBridge } = await import("./bridge.js")

beforeEach(() => {
  anfitriao.fontesPedidas = []
  anfitriao.escolhas = []
  anfitriao.definicoes = 0
  anfitriao.aoPedir = null
})

describe("a ponte da secretária leva a partilha de ecrã ao processo principal", () => {
  it("as fontes vêm do anfitrião, com a etiqueta das janelas sem nome pelo caminho", async () => {
    montarAnfitriao(true)
    const bridge = createDesktopBridge()

    const fontes = await bridge.ecra?.fontes("Janela sem nome")

    expect(fontes).toEqual(FONTES)
    // The label crosses over: the UI writes it, because it is the one that speaks
    // the person's language. The main process just applies it.
    expect(anfitriao.fontesPedidas).toEqual(["Janela sem nome"])
  })

  it("a escolha chega com o identificador do pedido e a fonte, por essa ordem", async () => {
    montarAnfitriao(true)
    const bridge = createDesktopBridge()

    await bridge.ecra?.escolher("ecra-1", { id: "window:12:0", nome: "Editor" })

    expect(anfitriao.escolhas).toEqual([{ id: "ecra-1", fonte: { id: "window:12:0", nome: "Editor" } }])
  })

  it("e desistir também chega, que é o que fecha o pedido sem dar fluxo nenhum", async () => {
    montarAnfitriao(true)
    const bridge = createDesktopBridge()

    await bridge.ecra?.escolher("ecra-1", null)

    expect(anfitriao.escolhas).toEqual([{ id: "ecra-1", fonte: null }])
  })

  it("a permissão e o atalho para as Definições passam tal como vieram", async () => {
    montarAnfitriao(true)
    const bridge = createDesktopBridge()

    expect(await bridge.ecra?.permissao()).toEqual({ estado: "denied", podeExplicar: true })

    await bridge.ecra?.abrirDefinicoes()
    expect(anfitriao.definicoes).toBe(1)
  })

  it("o anúncio do pedido chega à interface com o identificador", () => {
    montarAnfitriao(true)
    const bridge = createDesktopBridge()
    const recebidos: { id: string }[] = []

    bridge.ecra?.aoPedir((pedido) => recebidos.push(pedido))
    anfitriao.aoPedir?.({ id: "ecra-7" })

    expect(recebidos).toEqual([{ id: "ecra-7" }])
  })

  /**
   * An announcement without an identifier is not a request.
   *
   * What crosses IPC is a simple object, and an `undefined` arriving as the
   * identifier would open a selector that answers to nothing, and the real
   * request would wait for the timeout.
   */
  it("um anúncio sem identificador é ignorado, em vez de abrir um selector cego", () => {
    montarAnfitriao(true)
    const bridge = createDesktopBridge()
    const recebidos: { id: string }[] = []

    bridge.ecra?.aoPedir((pedido) => recebidos.push(pedido))
    anfitriao.aoPedir?.({})
    anfitriao.aoPedir?.(null)

    expect(recebidos).toEqual([])
  })

  /**
   * A `preload` from another version, which is the real case of an update in
   * progress.
   *
   * The absence reads as "this host handles this itself", the same rule for
   * all optional additions of this bridge. The UI behaves like in the browser:
   * without our selector and without a permission sheet.
   */
  it("um anfitrião sem `ecra` dá uma ponte sem `ecra`, e não uma que rebenta", () => {
    montarAnfitriao(false)
    const bridge = createDesktopBridge()

    expect(bridge.ecra).toBeUndefined()
  })
})
