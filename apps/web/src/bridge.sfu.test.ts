import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The bridge really connects the SFU to the call engine.
 *
 * The criterion for these tests is not "the core works", that's proven in
 * `packages/client-core`, with mutations. It's **delete the connection line, the
 * test dies.** Between the core, which has thousands of tests, and what the user
 * sees, there was a silent layer: it was there we found that the desktop bridge
 * never implemented `applyMediaPrefs`, and neither of them called prep before
 * destroying the vault. A perfect `call-sfu` with a bridge that doesn't pass it
 * the path is exactly the same failure, again.
 *
 * There are three connections to keep, and each fails differently:
 *
 *  1. **`sfu` in the `Call` bridge.** Without it the gate is always closed and
 *     everyone stays stuck against a server that already has SFU. Nothing breaks:
 *     calls keep working, and Phase 2 entire does nothing.
 *  2. **`suportaSfu` reading the session on each check.** A boolean captured at
 *     bridge construction is read before `hello.ok` and is always false.
 *  3. **`session.on("sfu")` → `call.handleSfuAviso`.** Without it the call sets
 *     up, you hear who was already there, and nobody who joins AFTER is ever
 *     heard, never, with no error anywhere.
 */

/** What the bridge gave to `Call`, so we can look inside. */
const motor = {
  pontes: [] as Record<string, unknown>[],
  avisos: [] as unknown[],
  /** How many times the bridge ordered the media path rebuilt. */
  reconexoes: 0,
  /** The channels the bridge asked "who is in the room?" on, per call. */
  perguntas: [] as string[][],
}

/** The listeners the bridge hung on the session, per event. */
const ouvintes = new Map<string, ((evento: unknown) => void)[]>()

/** What the session was told to do, to see that the delegation is real. */
const sessao = {
  suportaSfu: false,
  chamadas: [] as string[],
  /** The channels the session says it has. The presence query goes out one per channel. */
  canais: ["!geral:s"] as string[],
}

vi.mock("@enclave/client-core", () => ({
  Call: class {
    constructor(ponte: Record<string, unknown>) {
      motor.pontes.push(ponte)
    }
    async handleSfuAviso(aviso: unknown): Promise<void> {
      motor.avisos.push(aviso)
    }
    async ligacaoVoltou(): Promise<void> {
      motor.reconexoes++
    }
    /**
     * The question "who is in the room?", which the bridge sends when reconnecting.
     *
     * Saved, not ignored: it's the symmetric half of the presence notice, the
     * notice doesn't go out to someone who arrives INVISIBLE, and without the
     * question those people wait 50s for the heartbeat to see the room. A bridge
     * that stops sending it has to turn red here. See `Call.perguntarQuemEsta`.
     */
    perguntarQuemEsta(canais: readonly string[]): void {
      motor.perguntas.push([...canais])
    }
    set audioSettings(_valor: unknown) {}
    set videoQuality(_valor: string) {}
    set inputGain(_valor: number) {}
    async aplicarSomAoVivo(): Promise<void> {}
    on(): () => void {
      return () => {}
    }
    emit(): void {}
    rekey(): Promise<void> {
      return Promise.resolve()
    }
  },
  Session: class {
    on(tipo: string, ouvinte: (evento: unknown) => void): () => void {
      ouvintes.set(tipo, [...(ouvintes.get(tipo) ?? []), ouvinte])
      return () => {}
    }
    get channels(): string[] {
      return sessao.canais
    }
    get suportaSfu(): boolean {
      return sessao.suportaSfu
    }
    async sfuEntrarNoAmbito(channel: string, scope: string): Promise<unknown> {
      sessao.chamadas.push(`entrar:${channel}:${scope}`)
      return { rtpCapabilities: {}, producers: [] }
    }
    sfuSairDoAmbito(channel: string, scope: string): void {
      sessao.chamadas.push(`sair:${channel}:${scope}`)
    }
    async sfuCriarTransporte(_c: string, _s: string, direction: string): Promise<unknown> {
      sessao.chamadas.push(`criar:${direction}`)
      return { id: "t", iceParameters: {}, iceCandidates: [], dtlsParameters: {} }
    }
    async sfuLigarTransporte(transport: string): Promise<void> {
      sessao.chamadas.push(`ligar:${transport}`)
    }
    async sfuProduzir(transport: string): Promise<string> {
      sessao.chamadas.push(`produzir:${transport}`)
      return "p"
    }
    async sfuConsumir(_t: string, producer: string): Promise<unknown> {
      sessao.chamadas.push(`consumir:${producer}`)
      return { id: "c", producerId: producer, kind: "audio", rtpParameters: {} }
    }
    async sfuRetomar(_t: string, consumer: string): Promise<void> {
      sessao.chamadas.push(`retomar:${consumer}`)
    }
  },
  Vault: class {},
  // The bridge uses it to not count a question as someone leaving. The double
  // is the real function, because it is pure and its answer is the contract.
  ehPerguntaDePresenca: (payload: { t: string; quemEsta?: boolean }): boolean =>
    payload.t === "voice.leave" && payload.quemEsta === true,
}))

vi.mock("@enclave/crypto", () => ({ kindOf: () => "application" }))
vi.mock("./vault-backend.js", () => ({ BrowserVaultBackend: class {} }))
vi.mock("mediasoup-client", () => ({
  Device: class {
    readonly rtpCapabilities = {}
    async load(): Promise<void> {}
  },
}))

const { createBrowserBridge } = await import("./bridge.js")

/** The object the bridge gave to `Call`, with the path to SFU. */
function ponteDoMotor(): Record<string, unknown> {
  return motor.pontes[0] as Record<string, unknown>
}

function caminhoSfu(): Record<string, (...args: never[]) => unknown> {
  return ponteDoMotor()["sfu"] as Record<string, (...args: never[]) => unknown>
}

beforeEach(() => {
  motor.pontes = []
  motor.avisos = []
  motor.reconexoes = 0
  sessao.suportaSfu = false
  sessao.chamadas = []
  ouvintes.clear()
  createBrowserBridge()
})

describe("a ponte entrega o caminho para o SFU", () => {
  it("dá ao motor de chamada um `sfu`, e não um objecto vazio", () => {
    // Without this, the gate is always closed: nothing breaks, calls keep working
    // by mesh, and Phase 2 entire does nothing. It's the most expensive failure
    // this layer can produce to find.
    const sfu = caminhoSfu()
    expect(sfu).toBeTruthy()
    for (const nome of [
      "suportaSfu",
      "criarDispositivo",
      "sfuEntrarNoAmbito",
      "sfuSairDoAmbito",
      "sfuCriarTransporte",
      "sfuLigarTransporte",
      "sfuProduzir",
      "sfuConsumir",
      "sfuRetomar",
    ]) {
      expect(typeof sfu[nome], `a ponte tem de passar ${nome}`).toBe("function")
    }
  })

  it("lê a capacidade da sessão A CADA pergunta, e não uma vez na construção", () => {
    const sfu = caminhoSfu()

    // The bridge is built before there's a connection: at this point `hello.ok`
    // hasn't arrived yet and the answer is false.
    expect(sfu["suportaSfu"]?.()).toBe(false)

    // The `hello.ok` arrives with the capability. A boolean captured at build
    // time would keep saying no, forever.
    sessao.suportaSfu = true
    expect(sfu["suportaSfu"]?.()).toBe(true)

    // And the server goes backwards, a rollback, an old container, a media
    // worker that died. It has to close on its own.
    sessao.suportaSfu = false
    expect(sfu["suportaSfu"]?.()).toBe(false)
  })

  it("delega cada pedido na sessão, e não os inventa", async () => {
    const sfu = caminhoSfu()

    await (sfu["sfuEntrarNoAmbito"] as (c: string, s: string) => Promise<unknown>)("#c:s", "a".repeat(43))
    await (sfu["sfuCriarTransporte"] as (c: string, s: string, d: string) => Promise<unknown>)("#c:s", "a".repeat(43), "envio")
    await (sfu["sfuLigarTransporte"] as (t: string, d: unknown) => Promise<void>)("t1", {})
    await (sfu["sfuProduzir"] as (t: string, k: string, r: unknown) => Promise<string>)("t1", "audio", {})
    await (sfu["sfuConsumir"] as (t: string, p: string, c: unknown) => Promise<unknown>)("t1", "p1", {})
    await (sfu["sfuRetomar"] as (t: string, c: string) => Promise<void>)("t1", "c1")
    ;(sfu["sfuSairDoAmbito"] as (c: string, s: string) => void)("#c:s", "a".repeat(43))

    // Each one has to reach the session, which is what talks to the gateway. A
    // bridge that swallowed them would make a call that negotiates alone and never
    // connects.
    expect(sessao.chamadas).toEqual([
      `entrar:#c:s:${"a".repeat(43)}`,
      "criar:envio",
      "ligar:t1",
      "produzir:t1",
      "consumir:p1",
      "retomar:c1",
      `sair:#c:s:${"a".repeat(43)}`,
    ])
  })

  it("entrega o mediasoup-client do host, porque o núcleo não o pode importar", () => {
    // The call runs in the Electron renderer, where the session doesn't live; this
    // object crosses the boundary. The `criarDispositivo` is the only meaty piece
    // of the entire path.
    const dispositivo = (caminhoSfu()["criarDispositivo"] as () => unknown)()
    expect(dispositivo).toBeTruthy()
    expect(typeof (dispositivo as { load?: unknown }).load).toBe("function")
  })
})

describe("os avisos do SFU chegam ao motor de chamada", () => {
  it("um fluxo novo é entregue ao `Call`", async () => {
    const aviso = {
      t: "producer.new" as const,
      channel: "#c:s",
      scope: "a".repeat(43),
      producer: "p1",
      kind: "audio" as const,
      address: "@outro:s",
    }

    // Without this connection the call sets up, you hear who was already there, and
    // nobody who joins AFTER is ever heard, never, with no error anywhere.
    for (const ouvinte of ouvintes.get("sfu") ?? []) ouvinte(aviso)
    await Promise.resolve()

    expect(motor.avisos).toHaveLength(1)
    expect(motor.avisos[0]).toMatchObject({ t: "producer.new", producer: "p1", address: "@outro:s" })
  })

  it("e um fluxo que acaba também", async () => {
    for (const ouvinte of ouvintes.get("sfu") ?? []) {
      ouvinte({ t: "producer.closed", channel: "#c:s", scope: "a".repeat(43), producer: "p1" })
    }
    await Promise.resolve()

    expect(motor.avisos).toHaveLength(1)
    expect(motor.avisos[0]).toMatchObject({ t: "producer.closed", producer: "p1" })
  })

  it("a ponte inscreve-se mesmo no acontecimento `sfu`", () => {
    // The assertion that kills the test if someone removes the `session.on("sfu", …)`.
    // The two above measure what happens AFTER the listener exists; this one measures
    // that it exists.
    expect(ouvintes.get("sfu") ?? []).toHaveLength(1)
  })
})

/**
 * The connection comes back, and the bridge orders the media path rebuilt.
 *
 * The fourth connection to keep, the one that was missing. When the socket dies
 * the gateway drops everything that connection had in the media engine; the
 * session reconnects and rebuilds what it knows how to rebuild, and media wasn't
 * on that list. Without this line the person's producer dies in the router and
 * nobody recreates it: they stay in everyone's encrypted roster, the presence
 * heartbeat knows nothing of media, and reappear on everyone else's screens
 * WITH NO STREAM, "connecting…" forever, while the others keep hearing each
 * other.
 */
describe("a ligação que volta manda refazer o caminho de media", () => {
  const avisar = (state: string): void => {
    for (const ouvinte of ouvintes.get("connection") ?? []) ouvinte({ state })
  }

  it("a ponte inscreve-se mesmo no acontecimento `connection`", () => {
    expect(ouvintes.get("connection") ?? []).toHaveLength(1)
  })

  it("uma queda seguida de uma volta refaz a chamada", async () => {
    avisar("reconnecting")
    avisar("online")
    await Promise.resolve()

    expect(motor.reconexoes).toBe(1)
  })

  it("mas um `online` repetido não é uma volta, e não refaz nada", async () => {
    // The server restates the state with nothing down. Rebuilding there would tear
    // down and rebuild a call that's fine, with the silence of a full rebuild in
    // between.
    avisar("online")
    await Promise.resolve()
    const ate = motor.reconexoes

    avisar("online")
    avisar("online")
    await Promise.resolve()

    expect(motor.reconexoes).toBe(ate)
  })

  /**
   * And, on that same reconnect, the bridge asks who is in the voice rooms.
   *
   * Report from the owner on October 5, 2026: there are people who don't see who
   * is in the room before they join. The list is made from the `voice.join`
   * events the device heard, and people who already left don't recover in the
   * snapshot; the server presence notice, which made everyone there reannounce
   * themselves, **doesn't go to someone arriving invisible**, and that's right.
   * The symmetric half is this: whoever arrives asks.
   *
   * Without this line the fix stays entirely in the core and never happens to
   * anyone, which is the kind of loss a bridge test exists to catch.
   */
  it("e pergunta quem está em chamada, em cada canal nosso", async () => {
    motor.perguntas.length = 0
    avisar("reconnecting")
    avisar("online")
    await Promise.resolve()

    expect(motor.perguntas).toEqual([["!geral:s"]])
  })

  it("e não pergunta quando nada caiu: é a mesma volta, e uma pergunta por volta", async () => {
    avisar("online")
    await Promise.resolve()
    motor.perguntas.length = 0

    avisar("online")
    avisar("online")
    await Promise.resolve()

    expect(motor.perguntas).toEqual([])
  })
})
