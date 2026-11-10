import { describe, expect, it } from "vitest"
import { CANAIS_SFU, ligarSfu, type SessaoSfu } from "./sfu.js"

/**
 * The main process wires the SFU to the session for real.
 *
 * The test criterion is not "the session works"-that's proven in
 * `packages/client-core` with mutations. It's that **delete the connection
 * line, the test dies.** Between the core, which has thousands of tests, and
 * what the user sees, there's this layer. It was in one like it that we found
 * `applyMediaPrefs` was never implemented, and the installed app never had
 * noise suppression.
 *
 * Each missing channel fails differently, none fail loudly: without `suporta`
 * the installed app hangs forever; without `entrar` there are no
 * `rtpCapabilities`; without `retomar` sound arrives, decodes, never plays;
 * without `aviso` no one who joins after us is heard.
 */

/** A mock session that logs what it is asked and in what order. */
function sessaoFalsa(): SessaoSfu & {
  pedidos: string[]
  capacidade: boolean
  avisar: (aviso: unknown) => void
  inscritos: string[]
} {
  const pedidos: string[] = []
  const inscritos: string[] = []
  let emitir: ((aviso: never) => void) | null = null
  return {
    pedidos,
    capacidade: false,
    get suportaSfu(): boolean {
      pedidos.push("suporta?")
      return this.capacidade
    },
    avisar: (aviso: unknown) => emitir?.(aviso as never),
    async sfuEntrarNoAmbito(channel, scope) {
      pedidos.push(`entrar:${channel}:${scope}`)
      return { rtpCapabilities: { codecs: [] }, producers: [{ id: "p1", kind: "audio" as const, address: "@quem:s" }] }
    },
    sfuSairDoAmbito(channel, scope) {
      pedidos.push(`sair:${channel}:${scope}`)
    },
    async sfuCriarTransporte(channel, scope, direction) {
      pedidos.push(`transporte:${channel}:${scope}:${direction}`)
      return { id: `t-${direction}`, iceParameters: {}, iceCandidates: [], dtlsParameters: {} }
    },
    async sfuLigarTransporte(transport, dtlsParameters) {
      pedidos.push(`ligar:${transport}:${JSON.stringify(dtlsParameters)}`)
    },
    async sfuProduzir(transport, kind, rtpParameters, fonte) {
      pedidos.push(`produzir:${transport}:${kind}:${JSON.stringify(rtpParameters)}:${fonte ?? "sem-fonte"}`)
      return "p-nosso"
    },
    async sfuFecharProdutor(producer) {
      pedidos.push(`fechar:${producer}`)
    },
    async sfuConsumir(transport, producer, rtpCapabilities) {
      pedidos.push(`consumir:${transport}:${producer}:${JSON.stringify(rtpCapabilities)}`)
      return { id: `c-${producer}`, producerId: producer, kind: "audio" as const, rtpParameters: { x: 1 } }
    },
    async sfuRetomar(transport, consumer) {
      pedidos.push(`retomar:${transport}:${consumer}`)
    },
    async sfuPausar(transport, consumer) {
      pedidos.push(`pausar:${transport}:${consumer}`)
    },
    sfuPedirFotogramaChave(transport, consumer) {
      pedidos.push(`fotograma-chave:${transport}:${consumer}`)
    },
    on(evento, ouvinte) {
      // The name gets saved, not just the listener: subscribing to the wrong event
      // compiles fine with an `as` and emit-and-verify misses it, because this mock
      // always emits to the same target.
      inscritos.push(evento)
      emitir = ouvinte as (aviso: never) => void
      return () => {
        emitir = null
      }
    },
    inscritos,
  }
}

/** Wire the SFU to fake ports and return everything that can be inspected. */
function montar(): {
  sessao: ReturnType<typeof sessaoFalsa>
  canais: Map<string, (...argumentos: never[]) => unknown>
  enviados: { canal: string; carga: unknown }[]
} {
  const sessao = sessaoFalsa()
  const canais = new Map<string, (...argumentos: never[]) => unknown>()
  const enviados: { canal: string; carga: unknown }[] = []
  ligarSfu({
    registar: (canal, ouvinte) => canais.set(canal, ouvinte as (...argumentos: never[]) => unknown),
    enviar: (canal, carga) => enviados.push({ canal, carga }),
    sessao,
  })
  return { sessao, canais, enviados }
}

/** Call a registered channel without the test needing to know the handler shape. */
function invocar(
  canais: Map<string, (...argumentos: never[]) => unknown>,
  canal: string,
  ...argumentos: unknown[]
): unknown {
  const ouvinte = canais.get(canal)
  if (!ouvinte) throw new Error(`o canal ${canal} não foi registado`)
  return (ouvinte as (...quaisquer: unknown[]) => unknown)(...argumentos)
}

describe("o processo principal entrega o caminho para o SFU", () => {
  it("regista os onze pedidos, e não um subconjunto que compila na mesma", () => {
    const { canais } = montar()

    // Written out and not derived from `CANAIS_SFU`: a list derived from the
    // object itself goes green the day someone deletes an entry-which is exactly
    // the bug this exists to catch.
    for (const canal of [
      "sfu:suporta",
      "sfu:entrar",
      "sfu:sair",
      "sfu:transporte-criar",
      "sfu:transporte-ligar",
      "sfu:produzir",
      "sfu:produtor-fechar",
      "sfu:consumir",
      "sfu:retomar",
      "sfu:pausar",
      "sfu:fotograma-chave",
    ]) {
      expect(canais.has(canal), `falta o canal ${canal}`).toBe(true)
    }
  })

  it("o pedido de fotograma-chave chega à sessão (Fase M2)", async () => {
    const { sessao, canais } = montar()
    expect(await invocar(canais, CANAIS_SFU.pedirFotogramaChave, "t-recepcao", "c-1")).toEqual({ ok: true })
    expect(sessao.pedidos).toContain("fotograma-chave:t-recepcao:c-1")
  })

  it("lê a capacidade A CADA pergunta, e não uma vez ao arrancar", async () => {
    const { sessao, canais } = montar()

    // The main process starts before any connection: at this point `hello.ok`
    // hasn't arrived and the response is false.
    expect(await invocar(canais, CANAIS_SFU.suporta)).toBe(false)

    sessao.capacidade = true
    expect(await invocar(canais, CANAIS_SFU.suporta)).toBe(true)

    // And the server rolls back-a rollback in production, an old container coming
    // up, a dead media worker. It must close on its own on the next call.
    sessao.capacidade = false
    expect(await invocar(canais, CANAIS_SFU.suporta)).toBe(false)
  })

  it("delega cada pedido na sessão, com os argumentos pela ordem certa", async () => {
    const { sessao, canais } = montar()

    await invocar(canais, CANAIS_SFU.entrar, "#c:s", "a".repeat(43))
    await invocar(canais, CANAIS_SFU.criarTransporte, "#c:s", "a".repeat(43), "envio")
    await invocar(canais, CANAIS_SFU.ligarTransporte, "t-envio", { fingerprints: [] })
    await invocar(canais, CANAIS_SFU.produzir, "t-envio", "audio", { codecs: 1 }, "microfone")
    await invocar(canais, CANAIS_SFU.consumir, "t-recepcao", "p1", { caps: 2 })
    await invocar(canais, CANAIS_SFU.retomar, "t-recepcao", "c-p1")
    await invocar(canais, CANAIS_SFU.fecharProdutor, "p-ecra")
    await invocar(canais, CANAIS_SFU.sair, "#c:s", "a".repeat(43))

    /*
      The order of ARGUMENTS is here on purpose, not just the order of
      requests. Swapping `transport` with `consumer` in `retomar`, or `channel`
      with `scope` in `entrar`, compiles fine-they are all strings-and gives a
      call that negotiates with IDs that don't exist on the server.
    */
    expect(sessao.pedidos).toEqual([
      `entrar:#c:s:${"a".repeat(43)}`,
      `transporte:#c:s:${"a".repeat(43)}:envio`,
      `ligar:t-envio:{"fingerprints":[]}`,
      `produzir:t-envio:audio:{"codecs":1}:microfone`,
      `consumir:t-recepcao:p1:{"caps":2}`,
      "retomar:t-recepcao:c-p1",
      // Stop sharing goes across IPC as its own request: without it, the renderer
      // closes its producer and the server never finds out.
      "fechar:p-ecra",
      `sair:#c:s:${"a".repeat(43)}`,
    ])
  })

  it("devolve ao renderer o que ele precisa, e não um `ok` por tudo", async () => {
    const { canais } = montar()

    // The `entrar` brings the router's `rtpCapabilities` and who is already
    // speaking. A handler that returned `{ok:true}` would leave `device.load()`
    // with nothing to load, and the call would be silent.
    expect(await invocar(canais, CANAIS_SFU.entrar, "#c:s", "a".repeat(43))).toMatchObject({
      rtpCapabilities: { codecs: [] },
      producers: [{ id: "p1", kind: "audio", address: "@quem:s" }],
    })

    expect(await invocar(canais, CANAIS_SFU.criarTransporte, "#c:s", "a".repeat(43), "recepcao")).toMatchObject({
      id: "t-recepcao",
    })

    // The producer ID is what `mediasoup-client` expects back in `produce`;
    // without it the transport waits forever.
    expect(await invocar(canais, CANAIS_SFU.produzir, "t-envio", "audio", {}, "microfone")).toBe("p-nosso")

    expect(await invocar(canais, CANAIS_SFU.consumir, "t-recepcao", "p1", {})).toMatchObject({
      id: "c-p1",
      producerId: "p1",
      rtpParameters: { x: 1 },
    })
  })
})

describe("os avisos do SFU são empurrados para o renderer", () => {
  it("um fluxo novo atravessa, no canal que o `preload` escuta", () => {
    const { sessao, enviados } = montar()

    const aviso = {
      t: "producer.new" as const,
      channel: "#c:s",
      scope: "a".repeat(43),
      producer: "p1",
      kind: "audio" as const,
      address: "@outro:s",
    }
    sessao.avisar(aviso)

    expect(enviados).toEqual([{ canal: "event:sfu", carga: aviso }])
  })

  it("e um que acaba também", () => {
    const { sessao, enviados } = montar()

    sessao.avisar({ t: "producer.closed", channel: "#c:s", scope: "a".repeat(43), producer: "p1" })

    expect(enviados).toHaveLength(1)
    expect(enviados[0]?.carga).toMatchObject({ t: "producer.closed", producer: "p1" })
  })

  it("o principal inscreve-se mesmo no acontecimento `sfu` da sessão", () => {
    // The assertion that kills the test if someone renames the event. The two
    // above measure what happens AFTER the listener exists, and they pass with
    // subscribing to `"sfu-que-nao-existe" as "sfu"`-because the emitter is the
    // mock, and it emits to whoever subscribed.
    const { sessao } = montar()
    expect(sessao.inscritos).toEqual(["sfu"])
  })
})
