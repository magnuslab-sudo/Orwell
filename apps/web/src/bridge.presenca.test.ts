import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The caller needs to know that a call is in progress.
 *
 * Report from the owner on August 18, 2026: *"call does not show, users enter
 * as if everything is empty"*. The list of who is in each voice room is built
 * from the `voice.join` events the device HEARS, and voice signals don't recover
 * in the snapshot (`aoVivo`, in `session.ts`). Someone who opens the app arrived
 * after all announcements already went out, and nothing tells them again.
 *
 * The server presence notice is the trigger, and it's the only one without a
 * race: it goes out when the other side SUBSCRIBES to the channel, so it's
 * listening when the response arrives.
 *
 * This locks the CONNECTION, not the behavior, which is in `Call` and is locked
 * in `call.test.ts`. The two halves fail on their own: a `Call` that reasserts
 * through a bridge that never asks it to keeps showing an empty server.
 */

/** What the `Call` received. Filled in by the double below. */
const motor = { reafirmacoes: 0, desligados: [] as string[] }

/** The listeners that the bridge registered in the session, so we can fire them. */
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
    on(evento: string, handler: (evento: unknown) => void): () => void {
      const lista = ouvintes.get(evento) ?? []
      lista.push(handler)
      ouvintes.set(evento, lista)
      return () => {}
    }
  },
  Vault: class {},
}))

vi.mock("@enclave/crypto", () => ({ kindOf: () => "application" }))
vi.mock("./vault-backend.js", () => ({ BrowserVaultBackend: class {} }))

const { createBrowserBridge } = await import("./bridge.js")

function dizerAoVivo(evento: string, dados: unknown): void {
  for (const handler of ouvintes.get(evento) ?? []) handler(dados)
}

beforeEach(() => {
  motor.reafirmacoes = 0
  motor.desligados = []
  ouvintes.clear()
})

describe("a ponte do browser responde a quem chega", () => {
  it("alguém que se liga faz a chamada reafirmar-se", () => {
    createBrowserBridge()

    dizerAoVivo("presence", { address: "@carla:orwell.pt", online: true })

    expect(motor.reafirmacoes).toBe(1)
  })

  it("alguém que se desliga não faz reafirmar nada", () => {
    // The contrast that prevents the test from passing because the bridge calls it
    // on purpose for everything: an exit is opposite information, and answering it
    // with an announcement would be speaking to someone who just closed the door.
    createBrowserBridge()

    dizerAoVivo("presence", { address: "@carla:orwell.pt", online: false })

    expect(motor.reafirmacoes).toBe(0)
  })

  /**
   * The other half of the same notice, and it has been unimplemented since day one.
   *
   * The `online: false` was read and thrown away here. Someone who closes the
   * tab in the middle of an SFU call doesn't send `voice.leave`, there's no
   * `beforeunload` in this repo, and the gateway, when the socket dies, only
   * closes the producers: kills the stream, not the person. Without this line
   * they stay on everyone else's screen forever, in "connecting".
   */
  it("alguém que se desliga sai do roster da chamada", () => {
    createBrowserBridge()

    dizerAoVivo("presence", { address: "@carla:orwell.pt", online: false })

    expect(motor.desligados).toEqual(["@carla:orwell.pt"])
  })

  it("e quem se LIGA não é tirado de chamada nenhuma", () => {
    // The opposite of the contrast above: removing from the roster someone who just
    // arrived would erase from the screen a person who is actually in the call.
    createBrowserBridge()

    dizerAoVivo("presence", { address: "@carla:orwell.pt", online: true })

    expect(motor.desligados).toEqual([])
  })
})
