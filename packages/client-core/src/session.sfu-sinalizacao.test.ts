import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { RecusaDoSfu } from "./call-sfu.js"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * SFU signaling seen from the client side: request, and receive the response
 * to THIS request.
 *
 * The gateway has no request identifiers, the usual `#await` pairs by FRAME
 * type and by arrival order, and that is enough for everything that was there
 * before: ask for something, wait for it, move on. SFU signaling breaks that
 * assumption in the first second of any call: `mediasoup-client` makes TWO
 * transports, one for sending and one for receiving, and both are born at the
 * same time. Two indistinguishable `sfu.transport.created` responses by shape,
 * and whoever pairs by order has fifty percent odds of installing the send
 * cipher on the transport where only media comes in.
 *
 * It is exactly the kind of race that the move to SFU exists to end. Repeating
 * it elsewhere would trade N connections that get tangled for two that get
 * tangled, and call it progress. Hence the `ref`, and hence these tests.
 */

class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false

  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

interface Sent {
  t: string
  ref?: string
  [key: string]: unknown
}

/**
 * A fake server that responds EXACTLY what the test tells it to.
 *
 * `guiao` receives each frame from the client and returns what the server is
 * to say, and when. This is how a swapped response is enacted, the thing that
 * in reality happens because the server handles two requests in parallel and
 * the second finishes first.
 */
class FakeSocket {
  static last: FakeSocket | null = null
  static capacidades: string[] = ["sfu"]
  /** Returns the frames to send back, with each one's delay. */
  static guiao: (frame: Sent) => { frame: unknown; atraso?: number }[] = () => []

  readyState = 0
  readonly sent: Sent[] = []
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    FakeSocket.last = this
    setTimeout(() => {
      this.readyState = 1
      this.#fire("open", {})
    }, 0)
  }

  addEventListener(kind: string, handler: (event: unknown) => void, options?: { once?: boolean }): void {
    const wrapped = options?.once
      ? (event: unknown): void => {
          this.removeEventListener(kind, wrapped)
          handler(event)
        }
      : handler
    this.#listeners.set(kind, [...(this.#listeners.get(kind) ?? []), wrapped])
  }

  removeEventListener(kind: string, handler: (event: unknown) => void): void {
    this.#listeners.set(kind, (this.#listeners.get(kind) ?? []).filter((item) => item !== handler))
  }

  send(raw: string): void {
    const frame = JSON.parse(raw) as Sent
    this.sent.push(frame)
    for (const resposta of autenticacao(frame) ?? FakeSocket.guiao(frame)) {
      setTimeout(() => this.#fire("message", { data: JSON.stringify(resposta.frame) }), resposta.atraso ?? 0)
    }
  }

  /** Push a frame from the server without anything being asked. */
  empurrar(frame: unknown): void {
    this.#fire("message", { data: JSON.stringify(frame) })
  }

  close(): void {
    this.readyState = 3
    this.#fire("close", {})
  }

  #fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

function autenticacao(frame: Sent): { frame: unknown; atraso?: number }[] | undefined {
  if (frame.t === "hello") return [{ frame: { t: "hello.ok", version: 1, capabilities: FakeSocket.capacidades } }]
  if (frame.t === "auth.begin") return [{ frame: { t: "auth.challenge", nonce: "AAAA" } }]
  if (frame.t === "auth.finish") return [{ frame: { t: "auth.ok", address: "@x:localhost" } }]
  return undefined
}

async function sessaoLigada(): Promise<Session> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  await session.createIdentity("localhost:8448")
  await session.connect()
  await assentar()
  return session
}

async function assentar(vezes = 40): Promise<void> {
  for (let index = 0; index < vezes; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  FakeSocket.capacidades = ["sfu"]
  FakeSocket.last = null
  FakeSocket.guiao = () => []
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

describe("os pedidos ao SFU casam-se pela etiqueta e não pela ordem", () => {
  it("dois transportes a nascer ao mesmo tempo, respostas trocadas, cada um recebe o seu", async () => {
    const session = await sessaoLigada()

    // The server responds to the SECOND request first. It is not staged malice:
    // it is what happens when the media engine handles both in parallel and one
    // finishes before. Without `ref`, whoever paired by arrival order would give
    // the send transport the parameters of the receive one.
    FakeSocket.guiao = (frame) => {
      if (frame.t !== "sfu.transport.create") return []
      const atraso = frame["direction"] === "envio" ? 20 : 0
      return [
        {
          atraso,
          frame: {
            t: "sfu.transport.created",
            transport: `transporte-de-${String(frame["direction"])}`,
            direction: frame["direction"],
            iceParameters: {},
            iceCandidates: [],
            dtlsParameters: {},
            ref: frame.ref,
          },
        },
      ]
    }

    const [envio, recepcao] = await Promise.all([
      session.sfuCriarTransporte("#c:localhost", "a".repeat(43), "envio"),
      session.sfuCriarTransporte("#c:localhost", "a".repeat(43), "recepcao"),
    ])

    expect(envio.id).toBe("transporte-de-envio")
    expect(recepcao.id).toBe("transporte-de-recepcao")
  }, 60_000)

  it("cada pedido leva uma etiqueta diferente", async () => {
    const session = await sessaoLigada()
    FakeSocket.guiao = (frame) =>
      frame.t === "sfu.resume" ? [{ frame: { t: "sfu.resumed", consumer: "c", ref: frame.ref } }] : []

    await session.sfuRetomar("t", "c1")
    await session.sfuRetomar("t", "c2")

    const etiquetas = (FakeSocket.last?.sent ?? []).filter((cada) => cada.t === "sfu.resume").map((cada) => cada.ref)
    expect(etiquetas).toHaveLength(2)
    expect(etiquetas[0]).toBeTruthy()
    // Two identical tags are worse than none: they give the appearance of pairing
    // and match the wrong response with full confidence.
    expect(etiquetas[0]).not.toBe(etiquetas[1])
  }, 60_000)

  it("e a pausa viaja pelo mesmo caminho, com a sua própria etiqueta", async () => {
    /*
      The frame that makes "Stop seeing" a screen save the server's bandwidth,
      not just the decryption on this side. What is measured here is what the
      wire carries: an `sfu.pause` with a tag, and the `sfu.paused` response
      matching it. See `sfu.pause`, in the protocol.
    */
    const session = await sessaoLigada()
    FakeSocket.guiao = (frame) =>
      frame.t === "sfu.pause" ? [{ frame: { t: "sfu.paused", consumer: "c", ref: frame.ref } }] : []

    await session.sfuPausar("t", "c-do-ecra")

    const pausas = (FakeSocket.last?.sent ?? []).filter((cada) => cada.t === "sfu.pause")
    expect(pausas).toHaveLength(1)
    expect(pausas[0]).toMatchObject({ transport: "t", consumer: "c-do-ecra" })
    expect((pausas[0] as { ref?: string }).ref).toBeTruthy()
  }, 60_000)

  it("uma resposta com a etiqueta de outro pedido não serve este", async () => {
    const session = await sessaoLigada()
    // The server responds with a tag that no one requested. This is not paranoia:
    // it is what you would see if the `ref` was echoed from the wrong place in the
    // gateway, and the difference between "the request went unanswered" and
    // "it was answered with someone else's response" is the difference between an
    // error and silent failure.
    FakeSocket.guiao = (frame) =>
      frame.t === "sfu.resume" ? [{ frame: { t: "sfu.resumed", consumer: "c", ref: "etiqueta-de-outro" } }] : []

    await expect(session.sfuRetomar("t", "c", 200)).rejects.toThrow("the server did not answer in time")
  }, 60_000)
})

describe("as recusas do SFU chegam a quem pediu", () => {
  it("um sfu.error com a etiqueta do pedido rejeita esse pedido, com a razão física", async () => {
    const session = await sessaoLigada()
    FakeSocket.guiao = (frame) =>
      frame.t === "sfu.scope.join"
        ? [
            {
              frame: {
                t: "sfu.error",
                code: "chamada-cheia",
                message: "esta chamada já tem 16 pessoas, que é o que a ligação do servidor aguenta",
                ref: frame.ref,
              },
            },
          ]
        : []

    // The refusal reaches whoever is to show it with its proper name: the key
    // "the call is full" (425), and the server's phrase intact in `cause`. A
    // refusal translated to "internal error" on the way sends the person to retry
    // forever, because nothing on screen says the problem is not theirs.
    const recusa = session.sfuEntrarNoAmbito("#c:localhost", "a".repeat(43))
    await expect(recusa).rejects.toThrow("the call is full")
    await expect(recusa).rejects.toMatchObject({ cause: { frase: expect.stringMatching(/16 pessoas/) } })
  }, 60_000)

  /**
   * **Rejection arrives with the CODE, not just the message.**
   *
   * This is the bridge between the server and the only decision the engine makes about
   * retrying a request: a `RecusaDoSfu` is a response and does not retry; everything
   * else may be lost and retries. The session rejected with a
   * `new Error(frame.message)` and the code died here, on the other side, a
   * legitimate rejection was indistinguishable from a timeout.
   *
   * Without this check, the engine tests all stayed green with this line
   * reverted: they build the `RecusaDoSfu` by hand in the mocks. In production,
   * every rejection got requested three times. This is the kind of hole that lets
   * an entire suite miss a defect.
   */
  it("a recusa chega com o código, que é o que decide se o pedido se repete", async () => {
    const session = await sessaoLigada()
    FakeSocket.guiao = (frame) =>
      frame.t === "sfu.consume"
        ? [{ frame: { t: "sfu.error", code: "produtor-desconhecido", message: "esse fluxo não existe nesta chamada", ref: frame.ref } }]
        : []

    const erro = await session.sfuConsumir("t-recepcao", "p-ana", {}).catch((caiu: unknown) => caiu)

    // The SHAPE, not the message: the engine decides by shape, and an assertion
    // about the text passed with a plain `Error` that carried the same message.
    expect(erro).toBeInstanceOf(RecusaDoSfu)
    expect((erro as RecusaDoSfu).codigo).toBe("produtor-desconhecido")
    // The raw message stays intact for diagnosis. What reaches the screen
    // is the catalog key with code: the raw message was "Error 900".
    expect((erro as RecusaDoSfu).frase).toBe("esse fluxo não existe nesta chamada")
    expect((erro as RecusaDoSfu).message).toBe("the call server refused the request")
    expect((erro as RecusaDoSfu).cause).toEqual({ codigo: "produtor-desconhecido", frase: "esse fluxo não existe nesta chamada" })
  }, 60_000)

  /**
   * The other side of the same boundary: what is NOT a response cannot arrive
   * disguised as a rejection, or the engine would give up retrying exactly when
   * retrying is the fix.
   */
  it("um socket que cai não se disfarça de recusa", async () => {
    const session = await sessaoLigada()
    // No response at all: the request stays pending, and the connection drops under
    // it. This is the "network accident" that the engine's retry logic exists to hide.
    FakeSocket.guiao = () => []

    const pedido = session.sfuConsumir("t-recepcao", "p-ana", {}).catch((caiu: unknown) => caiu)
    await assentar(3)
    session.disconnect()
    const erro = await pedido

    expect(erro).toBeInstanceOf(Error)
    expect(erro).not.toBeInstanceOf(RecusaDoSfu)
  }, 60_000)

  it("uma recusa de um pedido não derruba o outro que estava a correr", async () => {
    const session = await sessaoLigada()
    FakeSocket.guiao = (frame) => {
      if (frame.t !== "sfu.transport.create") return []
      if (frame["direction"] === "envio") {
        return [{ frame: { t: "sfu.error", code: "transporte-repetido", message: "já tens um", ref: frame.ref } }]
      }
      return [
        {
          atraso: 10,
          frame: {
            t: "sfu.transport.created",
            transport: "o-de-recepcao",
            direction: "recepcao",
            iceParameters: {},
            iceCandidates: [],
            dtlsParameters: {},
            ref: frame.ref,
          },
        },
      ]
    }

    const envio = session.sfuCriarTransporte("#c:localhost", "a".repeat(43), "envio")
    const recepcao = session.sfuCriarTransporte("#c:localhost", "a".repeat(43), "recepcao")

    await expect(envio).rejects.toMatchObject({ cause: { frase: expect.stringMatching(/já tens um/) } })
    // And the other one reaches the end: a call with half the transports is a
    // call where you hear but cannot speak, and the half that works must keep
    // working so the screen can tell which is which.
    await expect(recepcao).resolves.toMatchObject({ id: "o-de-recepcao" })
  }, 60_000)

  it("a ligação a cair falha o que estava à espera, em vez de o deixar pendurado", async () => {
    const session = await sessaoLigada()
    // No response at all: the request stays pending.
    FakeSocket.guiao = () => []

    const pedido = session.sfuEntrarNoAmbito("#c:localhost", "a".repeat(43))
    await assentar(3)
    // The other tab closed, the server restarted, the network went down. What
    // cannot happen is the call sitting for fifteen seconds pretending to negotiate
    // against a connection that no longer exists, that is how a lost socket
    // delayed diagnosis of the next one.
    const comecou = Date.now()
    session.disconnect()

    /*
      The reason for rejection IS the assertion, not a detail.

      With a plain `rejects.toThrow()`, this test passed the same way without the
      drop failing anything: the request timed out fifteen seconds later and
      rejected with "timed out", which is also a rejection. That is how it passed
      with the mutation `drop-without-failing-requests` applied, the exact defect
      it claims to catch. Measuring the MESSAGE and the TIME is what separates
      "failed because the connection dropped" from "failed because nobody answered".
    */
    await expect(pedido).rejects.toThrow(/the session ended/)
    expect(Date.now() - comecou).toBeLessThan(2000)
  }, 60_000)
})

describe("os avisos que o servidor manda sem ninguém pedir", () => {
  it("um fluxo novo na chamada chega como acontecimento", async () => {
    const session = await sessaoLigada()
    const vistos: { producer: string; address: string }[] = []
    session.on("sfu", (evento) => {
      if (evento.t === "producer.new") vistos.push({ producer: evento.producer, address: evento.address })
    })

    FakeSocket.last?.empurrar({
      t: "sfu.producer.new",
      channel: "#c:localhost",
      scope: "a".repeat(43),
      producer: "p1",
      kind: "audio",
      address: "@outro:localhost",
    })
    await assentar(5)

    expect(vistos).toEqual([{ producer: "p1", address: "@outro:localhost" }])
  }, 60_000)

  it("um fluxo que acaba também", async () => {
    const session = await sessaoLigada()
    const mortos: string[] = []
    session.on("sfu", (evento) => {
      if (evento.t === "producer.closed") mortos.push(evento.producer)
    })

    FakeSocket.last?.empurrar({
      t: "sfu.producer.closed",
      channel: "#c:localhost",
      scope: "a".repeat(43),
      producer: "p1",
    })
    await assentar(5)

    expect(mortos).toEqual(["p1"])
  }, 60_000)

  /**
   * The case that forces SFU dispatch to run BEFORE the type queue.
   *
   * The usual `#onFrame` starts by checking if someone is waiting for a frame
   * OF THIS TYPE, and delivers it. A `sfu.producer.new` has no one waiting,
   * so it passes, but a `sfu.error` with no label, or a late response to a
   * request already abandoned, would find another queue and be consumed silently.
   */
  it("um erro do SFU sem etiqueta não desaparece: fica no registo", async () => {
    const session = await sessaoLigada()
    const ditos: string[] = []
    session.on("status", (evento) => ditos.push(evento.detail))

    FakeSocket.last?.empurrar({ t: "sfu.error", code: "sem-sfu", message: "este servidor não encaminha media" })
    await assentar(5)

    expect(ditos.some((cada) => cada.includes("não encaminha media"))).toBe(true)
  }, 60_000)
})
