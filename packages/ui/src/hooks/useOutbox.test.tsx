import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import type { ConnectionState, EnclaveBridge } from "../bridge.js"
import type { ChatMessage } from "../types.js"
import { strings } from "../strings.js"
import { outboxReducer, useOutbox, type OutboxEntry } from "./useOutbox.js"
import { amplitudeDe, criarMotor, type EstadoDoSom, type Motor, type Saida } from "../sons/motor.js"
import { PREFERENCIAS_DE_SOM_POR_OMISSAO } from "../sons/preferencias.js"
import type { TipoDeSom } from "../sons/familia.js"

afterEach(cleanup)

const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id: "a",
  channel: "!geral:s",
  body: "olá",
  at: 1,
  state: "sending",
  ...over,
})

describe("outboxReducer", () => {
  it("adiciona, falha e remove", () => {
    let state = outboxReducer([], { type: "add", entry: entry() })
    expect(state).toHaveLength(1)
    state = outboxReducer(state, { type: "failed", id: "a" })
    expect(state[0]?.state).toBe("failed")
    state = outboxReducer(state, { type: "sending", id: "a" })
    expect(state[0]?.state).toBe("sending")
    state = outboxReducer(state, { type: "remove", id: "a" })
    expect(state).toHaveLength(0)
  })

  it("delivered remove a entrada 'sending' mais antiga com o mesmo canal e corpo", () => {
    const oldest = entry({ id: "a", at: 1 })
    const newest = entry({ id: "b", at: 2 })
    const other = entry({ id: "c", body: "outra" })
    const state = outboxReducer([oldest, newest, other], {
      type: "delivered",
      channel: "!geral:s",
      body: "olá",
    })
    expect(state.map((item) => item.id)).toEqual(["b", "c"])
  })

  it("delivered ignora entradas falhadas e canais diferentes", () => {
    const failed = entry({ id: "a", state: "failed" })
    const elsewhere = entry({ id: "b", channel: "!outra:s" })
    const state = outboxReducer([failed, elsewhere], { type: "delivered", channel: "!geral:s", body: "olá" })
    expect(state).toHaveLength(2)
  })
})

function bridgeWith(send: (channel: string, body: string) => Promise<{ ok: boolean }>): EnclaveBridge {
  return { channels: { send } } as unknown as EnclaveBridge
}

const ownMessage = (body: string, channel = "!geral:s"): ChatMessage => ({
  channel,
  seq: -1,
  sender: "@me:s",
  payload: { t: "message", body, id: "uuid-from-bridge", sentAt: 1 },
})

describe("useOutbox", () => {
  it("um envio com sucesso remove a entrada", async () => {
    let resolve: (value: { ok: boolean }) => void = () => {}
    const send = vi.fn(() => new Promise<{ ok: boolean }>((r) => (resolve = r)))
    const { result } = renderHook(() => useOutbox(bridgeWith(send), "online", vi.fn()))

    act(() => result.current.send("!geral:s", "olá"))
    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0]?.state).toBe("sending")
    // Room and attachments, both missing: a text message in the room by default.
    expect(send).toHaveBeenCalledWith("!geral:s", "olá", undefined, undefined)

    await act(async () => {
      resolve({ ok: true })
      await Promise.resolve()
    })
    expect(result.current.entries).toHaveLength(0)
  })

  it("uma falha marca a entrada como failed e avisa por toast", async () => {
    const notify = vi.fn()
    // A real rejection, not a connection failure: those wait (see `SEM_LIGACAO`).
    const send = vi.fn(() => Promise.reject(new Error("vault is locked")))
    const { result } = renderHook(() => useOutbox(bridgeWith(send), "online", notify))

    await act(async () => {
      result.current.send("!geral:s", "olá")
      await Promise.resolve()
    })
    expect(result.current.entries[0]?.state).toBe("failed")
    // Translated on the way out, and marked as an error.
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("O cofre está bloqueado."), "error")
  })

  it("retry reenvia uma entrada falhada; o corpo nunca se perde", async () => {
    const send = vi
      .fn<(channel: string, body: string) => Promise<{ ok: boolean }>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ ok: true })
    const { result } = renderHook(() => useOutbox(bridgeWith(send), "online", vi.fn()))

    await act(async () => {
      result.current.send("!geral:s", "olá")
      await Promise.resolve()
    })
    expect(result.current.entries[0]?.state).toBe("failed")

    await act(async () => {
      result.current.retry(result.current.entries[0]!.id)
      await Promise.resolve()
    })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith("!geral:s", "olá", undefined, undefined)
    expect(result.current.entries).toHaveLength(0)
  })

  it("a própria mensagem emitida pela sessão (seq -1) faz dedup da entrada", () => {
    const send = vi.fn(() => new Promise<{ ok: boolean }>(() => {}))
    const { result } = renderHook(() => useOutbox(bridgeWith(send), "online", vi.fn()))

    act(() => result.current.send("!geral:s", "olá"))
    expect(result.current.entries).toHaveLength(1)

    act(() => result.current.noteOwnMessage(ownMessage("olá")))
    expect(result.current.entries).toHaveLength(0)
  })

  it("mensagens com seq real ou de outro tipo não fazem dedup", () => {
    const send = vi.fn(() => new Promise<{ ok: boolean }>(() => {}))
    const { result } = renderHook(() => useOutbox(bridgeWith(send), "online", vi.fn()))

    act(() => result.current.send("!geral:s", "olá"))
    act(() => result.current.noteOwnMessage({ ...ownMessage("olá"), seq: 7 }))
    act(() => result.current.noteOwnMessage({ ...ownMessage("olá"), payload: { t: "profile" } }))
    expect(result.current.entries).toHaveLength(1)
  })

  it("voltar a estar online tenta de novo as entradas falhadas, uma vez", async () => {
    const send = vi
      .fn<(channel: string, body: string) => Promise<{ ok: boolean }>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ ok: true })
    const { result, rerender } = renderHook(
      ({ connection }: { connection: ConnectionState }) => useOutbox(bridgeWith(send), connection, vi.fn()),
      { initialProps: { connection: "online" as ConnectionState } },
    )

    await act(async () => {
      result.current.send("!geral:s", "olá")
      await Promise.resolve()
    })
    expect(result.current.entries[0]?.state).toBe("failed")

    rerender({ connection: "reconnecting" })
    expect(send).toHaveBeenCalledTimes(1)

    await act(async () => {
      rerender({ connection: "online" })
      await Promise.resolve()
    })
    expect(send).toHaveBeenCalledTimes(2)
    expect(result.current.entries).toHaveLength(0)
  })

  it("descartar apaga a entrada sem reenviar", async () => {
    const send = vi.fn(() => Promise.reject(new Error("boom")))
    const { result } = renderHook(() => useOutbox(bridgeWith(send), "online", vi.fn()))

    await act(async () => {
      result.current.send("!geral:s", "olá")
      await Promise.resolve()
    })
    act(() => result.current.discard(result.current.entries[0]!.id))
    expect(result.current.entries).toHaveLength(0)
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe("useOutbox: escrever sem ligação", () => {
  it("sem ligação, a mensagem fica à espera e não vai à ponte; sai quando a ligação volta, pela ordem", async () => {
    const send = vi.fn(async () => ({ ok: true }))
    const notify = vi.fn()
    const { result, rerender } = renderHook(
      ({ connection }: { connection: ConnectionState }) => useOutbox(bridgeWith(send), connection, notify),
      { initialProps: { connection: "reconnecting" as ConnectionState } },
    )

    act(() => {
      result.current.send("!geral:s", "primeira")
      result.current.send("!geral:s", "segunda")
    })
    expect(result.current.entries.map((e) => e.state)).toEqual(["waiting", "waiting"])
    expect(send).not.toHaveBeenCalled()
    // Waiting is not failure: no red warning.
    expect(notify).not.toHaveBeenCalled()

    await act(async () => {
      rerender({ connection: "online" })
      await Promise.resolve()
    })
    expect(send.mock.calls.map((call) => (call as unknown[])[1])).toEqual(["primeira", "segunda"])
    expect(result.current.entries).toHaveLength(0)
  })

  it("descartar uma mensagem à espera tira-a, e ela já não sai quando a ligação volta", async () => {
    const send = vi.fn(async () => ({ ok: true }))
    const { result, rerender } = renderHook(
      ({ connection }: { connection: ConnectionState }) => useOutbox(bridgeWith(send), connection, vi.fn()),
      { initialProps: { connection: "offline" as ConnectionState } },
    )
    act(() => result.current.send("!geral:s", "afinal não"))
    act(() => result.current.discard(result.current.entries[0]!.id))
    await act(async () => {
      rerender({ connection: "online" })
      await Promise.resolve()
    })
    expect(send).not.toHaveBeenCalled()
  })

  it("um envio que falha porque a ligação caiu a meio volta a ficar à espera, sem aviso", async () => {
    let rejeitar: (erro: Error) => void = () => {}
    const send = vi.fn(() => new Promise<{ ok: boolean }>((_, r) => (rejeitar = r)))
    const notify = vi.fn()
    // No `rerender`: the error arrives before the shell knows the connection dropped.
    const { result } = renderHook(() => useOutbox(bridgeWith(send), "online", notify))
    act(() => result.current.send("!geral:s", "olá"))
    await act(async () => {
      rejeitar(new Error("no connection to the server"))
      await Promise.resolve()
    })
    expect(result.current.entries[0]?.state).toBe("waiting")
    expect(notify).not.toHaveBeenCalled()
  })
})

describe("useOutbox: fechar a página com mensagens por sair", () => {
  function fecha(): boolean {
    const evento = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(evento)
    return evento.defaultPrevented
  }

  it("pergunta antes de fechar quando há uma mensagem à espera, e deixa de perguntar ao sair", async () => {
    const send = vi.fn(async () => ({ ok: true }))
    const { result, rerender } = renderHook(
      ({ connection }: { connection: ConnectionState }) => useOutbox(bridgeWith(send), connection, vi.fn()),
      { initialProps: { connection: "offline" as ConnectionState } },
    )
    expect(fecha()).toBe(false)
    act(() => result.current.send("!geral:s", "à espera"))
    expect(fecha()).toBe(true)
    await act(async () => {
      rerender({ connection: "online" })
      await Promise.resolve()
    })
    expect(result.current.entries).toHaveLength(0)
    expect(fecha()).toBe(false)
  })

  it("uma falhada não segura a página: a pessoa já a viu falhar", async () => {
    const send = vi.fn(() => Promise.reject(new Error("boom")))
    const { result } = renderHook(() => useOutbox(bridgeWith(send), "online", vi.fn()))
    await act(async () => {
      result.current.send("!geral:s", "olá")
      await Promise.resolve()
    })
    expect(result.current.entries[0]?.state).toBe("failed")
    expect(fecha()).toBe(false)
  })
})

describe("useOutbox: um separador que deixou de escrever", () => {
  function pontePara(escreve: { valor: boolean }): EnclaveBridge {
    return { channels: { send: vi.fn(async () => ({ ok: true })) }, session: { escreve: () => escreve.valor } } as unknown as EnclaveBridge
  }
  function fecha(): boolean {
    const evento = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(evento)
    return evento.defaultPrevented
  }

  it('não segura a página: o recarregar que a aplicação pede não abre "Sair do site?"', () => {
    const escreve = { valor: true }
    const { result } = renderHook(() => useOutbox(pontePara(escreve), "offline", vi.fn()))
    act(() => result.current.send("!geral:s", "à espera"))
    expect(fecha()).toBe(true)
    // Stopped (new version, ownership transferred) and reloads right after, with no render in between.
    escreve.valor = false
    expect(fecha()).toBe(false)
  })

  it("as que esperavam passam a falhadas, com a frase do separador parado", () => {
    const escreve = { valor: true }
    const notify = vi.fn()
    const { result, rerender } = renderHook(
      ({ connection }: { connection: ConnectionState }) => useOutbox(pontePara(escreve), connection, notify),
      { initialProps: { connection: "reconnecting" as ConnectionState } },
    )
    act(() => result.current.send("!geral:s", "à espera"))
    expect(result.current.entries[0]?.state).toBe("waiting")
    escreve.valor = false
    rerender({ connection: "offline" })
    expect(result.current.entries[0]?.state).toBe("failed")
    expect(notify).toHaveBeenCalledWith(strings.connection.separadorParado, "error")
    expect(notify).toHaveBeenCalledTimes(1)
  })
})

/*
  Send sound (owner request, November 3, 2026). Plays when the bridge confirms
  a message that just left the outbox, and only then.
*/
describe("o som ao enviar", () => {
  const motorFalso = (): Pick<Motor, "tocar"> & { tocar: ReturnType<typeof vi.fn> } => ({
    tocar: vi.fn(() => "tocou" as const),
  })

  it("toca uma vez quando o envio tem sucesso, e só depois da confirmação", async () => {
    let resolve: (value: { ok: boolean }) => void = () => {}
    const send = vi.fn(() => new Promise<{ ok: boolean }>((r) => (resolve = r)))
    const som = motorFalso()
    const { result } = renderHook(() => useOutbox(bridgeWith(send), "online", vi.fn(), som))

    act(() => result.current.send("!geral:s", "olá"))
    expect(som.tocar).not.toHaveBeenCalled()
    await act(async () => {
      resolve({ ok: true })
      await Promise.resolve()
    })
    expect(som.tocar.mock.calls).toEqual([[{ tipo: "enviada" }]])
  })

  it("uma mensagem com anexos é um envio só, e faz um som só", async () => {
    const send = vi.fn(async () => ({ ok: true }))
    const som = motorFalso()
    const { result } = renderHook(() => useOutbox(bridgeWith(send), "online", vi.fn(), som))

    await act(async () => {
      result.current.send("!geral:s", "fotos", undefined, {
        images: [
          { name: "a.jpg", dataUrl: "data:image/jpeg;base64,AA" },
          { name: "b.jpg", dataUrl: "data:image/jpeg;base64,AA" },
        ],
      } as never)
      await Promise.resolve()
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect(som.tocar).toHaveBeenCalledTimes(1)
  })

  it("não toca quando o envio falha", async () => {
    const send = vi.fn(() => Promise.reject(new Error("vault is locked")))
    const som = motorFalso()
    const { result } = renderHook(() => useOutbox(bridgeWith(send), "online", vi.fn(), som))

    await act(async () => {
      result.current.send("!geral:s", "olá")
      await Promise.resolve()
    })
    expect(result.current.entries[0]?.state).toBe("failed")
    expect(som.tocar).not.toHaveBeenCalled()
  })

  it("não toca quando a ligação cai a meio, nem quando a mensagem sai depois sozinha", async () => {
    const send = vi
      .fn<(channel: string, body: string) => Promise<{ ok: boolean }>>()
      .mockRejectedValueOnce(new Error("the connection dropped"))
      .mockResolvedValueOnce({ ok: true })
    const som = motorFalso()
    const { result, rerender } = renderHook(
      ({ connection }: { connection: ConnectionState }) => useOutbox(bridgeWith(send), connection, vi.fn(), som),
      { initialProps: { connection: "online" as ConnectionState } },
    )

    await act(async () => {
      result.current.send("!geral:s", "olá")
      await Promise.resolve()
    })
    expect(result.current.entries[0]?.state).toBe("waiting")
    rerender({ connection: "reconnecting" as ConnectionState })
    await act(async () => {
      rerender({ connection: "online" })
      await Promise.resolve()
    })
    expect(send).toHaveBeenCalledTimes(2)
    expect(result.current.entries).toHaveLength(0)
    expect(som.tocar).not.toHaveBeenCalled()
  })

  it('não toca no "Tentar outra vez": a mensagem já não sai da caixa de escrita', async () => {
    const send = vi
      .fn<(channel: string, body: string) => Promise<{ ok: boolean }>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ ok: true })
    const som = motorFalso()
    const { result } = renderHook(() => useOutbox(bridgeWith(send), "online", vi.fn(), som))

    await act(async () => {
      result.current.send("!geral:s", "olá")
      await Promise.resolve()
    })
    await act(async () => {
      result.current.retry(result.current.entries[0]!.id)
      await Promise.resolve()
    })
    expect(result.current.entries).toHaveLength(0)
    expect(som.tocar).not.toHaveBeenCalled()
  })

  it("não toca ao receber: a mensagem própria vinda da sessão não é um envio", () => {
    const send = vi.fn(() => new Promise<{ ok: boolean }>(() => {}))
    const som = motorFalso()
    const { result } = renderHook(() => useOutbox(bridgeWith(send), "online", vi.fn(), som))

    act(() => result.current.noteOwnMessage(ownMessage("olá")))
    expect(som.tocar).not.toHaveBeenCalled()
  })

  describe("com o motor a sério: o interruptor, o tipo e o volume", () => {
    function montar(estado: Partial<EstadoDoSom>): { tocados: [TipoDeSom, number][]; motor: Motor } {
      const tocados: [TipoDeSom, number][] = []
      const saida: Saida = {
        tocar: (tipo, amplitude) => {
          tocados.push([tipo, amplitude])
          return true
        },
        calar: () => {},
        vibrar: () => {},
        preparar: () => {},
      }
      const motor = criarMotor({
        saida,
        lerEstado: () => ({
          ligado: true,
          volume: 70,
          actividade: "online",
          som: PREFERENCIAS_DE_SOM_POR_OMISSAO,
          ...estado,
        }),
        ambiente: { houveGesto: () => true, janelaAFrente: () => true, visivel: () => true },
      })
      return { tocados, motor }
    }

    async function enviarCom(motor: Motor): Promise<void> {
      const send = vi.fn(async () => ({ ok: true }))
      const { result } = renderHook(() => useOutbox(bridgeWith(send), "online", vi.fn(), motor))
      await act(async () => {
        result.current.send("!geral:s", "olá")
        await Promise.resolve()
      })
    }

    it("ligado de fábrica, no volume das definições", async () => {
      expect(PREFERENCIAS_DE_SOM_POR_OMISSAO.porTipo.enviada).toBe(true)
      const { tocados, motor } = montar({ volume: 40 })
      await enviarCom(motor)
      expect(tocados).toEqual([["enviada", amplitudeDe(40)]])
    })

    it('"Som ao enviar mensagens" desligado cala-o', async () => {
      const som = { ...PREFERENCIAS_DE_SOM_POR_OMISSAO, porTipo: { ...PREFERENCIAS_DE_SOM_POR_OMISSAO.porTipo, enviada: false } }
      const { tocados, motor } = montar({ som })
      await enviarCom(motor)
      expect(tocados).toEqual([])
    })

    it("o interruptor geral dos sons cala-o", async () => {
      const { tocados, motor } = montar({ ligado: false })
      await enviarCom(motor)
      expect(tocados).toEqual([])
    })

    it("o volume zero cala-o", async () => {
      const { tocados, motor } = montar({ volume: 0 })
      await enviarCom(motor)
      expect(tocados).toEqual([])
    })

    it("dois envios seguidos fazem dois sons", async () => {
      const { tocados, motor } = montar({})
      const send = vi.fn(async () => ({ ok: true }))
      const { result } = renderHook(() => useOutbox(bridgeWith(send), "online", vi.fn(), motor))
      await act(async () => {
        result.current.send("!geral:s", "um")
        await Promise.resolve()
      })
      const agora = Date.now()
      const relogio = vi.spyOn(Date, "now").mockReturnValue(agora + 400)
      try {
        await act(async () => {
          result.current.send("!geral:s", "dois")
          await Promise.resolve()
        })
      } finally {
        relogio.mockRestore()
      }
      expect(tocados.map(([tipo]) => tipo)).toEqual(["enviada", "enviada"])
    })
  })
})
