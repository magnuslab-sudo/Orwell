import { describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { StoredChatMessage } from "@enclave/client-core"
import type { EnclaveBridge } from "../bridge.js"
import type { ChatMessage } from "../types.js"
import { useProcura } from "./useProcura.js"

const CANAL = "!lagar:exemplo"

function guardada(seq: number, body: string, extra: Record<string, unknown> = {}): StoredChatMessage {
  return {
    seq,
    sender: "@ana:exemplo",
    at: seq * 1000,
    payload: { t: "message", id: `id-${seq}`, sentAt: seq * 1000, body, ...extra },
  }
}

/** A bridge with the minimum the hook touches: history stored in the vault. */
function ponteCom(
  cofre: Record<string, StoredChatMessage[]>,
  espia?: (channel: string) => void,
): EnclaveBridge {
  return {
    channels: {
      history: async (channel: string) => {
        espia?.(channel)
        return cofre[channel] ?? []
      },
    },
  } as unknown as EnclaveBridge
}

/** What the shell passes as the trigger: messages in memory. */
const SEM_MENSAGENS: ChatMessage[] = []

describe("useProcura", () => {
  it("não toca no cofre enquanto a folha estiver fechada", () => {
    const lidos: string[] = []
    const ponte = ponteCom({ [CANAL]: [guardada(1, "olá")] }, (canal) => lidos.push(canal))

    renderHook(() => useProcura(ponte, CANAL, false, SEM_MENSAGENS))

    expect(lidos).toEqual([])
  })

  it("aberta, encontra a mensagem e diz quem a disse e quando", async () => {
    const ponte = ponteCom({
      [CANAL]: [guardada(1, "nada a ver"), guardada(2, "o orçamento do estaleiro")],
    })

    const { result } = renderHook(() => useProcura(ponte, CANAL, true, SEM_MENSAGENS))
    await waitFor(() => expect(result.current.procuradas).toBe(2))

    act(() => result.current.definirTermo("orçamento"))

    expect(result.current.resultados).toEqual([
      { id: "id-2", sender: "@ana:exemplo", at: 2000, room: "", body: "o orçamento do estaleiro" },
    ])
  })

  /**
   * The message just read is the most searched, and the vault does not have it yet.
   *
   * Write is deferred by 1500 ms (`Session.FLUSH_MS`) to avoid re-encrypting
   * the entire vault for every message sent. A search over only the vault would
   * fail in that window. The one moment certainty exists that the message is
   * there because it is on the adjacent screen.
   */
  it("encontra o que ainda está por gravar, e não o mostra duas vezes", async () => {
    const jaGravada: ChatMessage = {
      channel: CANAL,
      seq: 1,
      sender: "@ana:exemplo",
      payload: { t: "message", id: "id-1", sentAt: 1000, body: "o orçamento antigo" },
    }
    const acabadaDeChegar: ChatMessage = {
      channel: CANAL,
      seq: 2,
      sender: "@ana:exemplo",
      payload: { t: "message", id: "id-2", sentAt: 2000, body: "o orçamento novo" },
    }
    // The vault only knows the first: the second still waits for the flush.
    const ponte = ponteCom({ [CANAL]: [guardada(1, "o orçamento antigo")] })

    const { result } = renderHook(() =>
      useProcura(ponte, CANAL, true, [jaGravada, acabadaDeChegar]),
    )
    await waitFor(() => expect(result.current.procuradas).toBe(2))

    act(() => result.current.definirTermo("orçamento"))

    expect(result.current.resultados.map((achado) => achado.id)).toEqual(["id-2", "id-1"])
  })

  /**
   * Memory has ALL conversations; search is for one.
   *
   * The shell keeps messages from all channels in the same list. Putting them
   * in reach without filtering would surface messages from another conversation,
   * and jumping to them would take the user somewhere the message is not.
   */
  it("não deixa entrar mensagens de outra conversa", async () => {
    const OUTRO = "!adega:exemplo"
    const doOutro: ChatMessage = {
      channel: OUTRO,
      seq: 9,
      sender: "@rui:exemplo",
      payload: { t: "message", id: "id-9", sentAt: 9000, body: "o orçamento da adega" },
    }
    const ponte = ponteCom({ [CANAL]: [guardada(1, "o orçamento do lagar")] })

    const { result } = renderHook(() => useProcura(ponte, CANAL, true, [doOutro]))
    await waitFor(() => expect(result.current.procuradas).toBe(1))

    act(() => result.current.definirTermo("orçamento"))

    expect(result.current.resultados.map((achado) => achado.id)).toEqual(["id-1"])
  })

  /**
   * The vault is re-read as the conversation scrolls, not just when the page opens.
   *
   * The merge with memory covers the message not yet written. This re-read covers
   * everything else the write brings with it: an edit, a deletion, a page of old
   * messages recovered. Without it, the open page would answer about a vault
   * frozen at the moment it opened.
   */
  it("relê o cofre quando chega mensagem nova com a folha aberta", async () => {
    let doCofre = [guardada(1, "o orçamento antigo")]
    const ponte = {
      channels: { history: async () => doCofre },
    } as unknown as EnclaveBridge
    const primeira: ChatMessage = {
      channel: CANAL,
      seq: 1,
      sender: "@ana:exemplo",
      payload: { t: "message", id: "id-1", sentAt: 1000, body: "o orçamento antigo" },
    }

    const { result, rerender } = renderHook(
      ({ lista }: { lista: ChatMessage[] }) => useProcura(ponte, CANAL, true, lista),
      { initialProps: { lista: [primeira] } },
    )
    await waitFor(() => expect(result.current.procuradas).toBe(1))

    // The flush happened: the second message is now in the vault. A `channel.meta`
    // arrives in memory, which is not a conversation line so it does not enter
    // the scope on its own, it only serves as a trigger, which is what we are guarding.
    doCofre = [guardada(1, "o orçamento antigo"), guardada(2, "o orçamento revisto")]
    const meta: ChatMessage = {
      channel: CANAL,
      seq: 3,
      sender: "@ana:exemplo",
      payload: { t: "channel.meta", room: "" } as ChatMessage["payload"],
    }
    rerender({ lista: [primeira, meta] })

    await waitFor(() => expect(result.current.procuradas).toBe(2))
    act(() => result.current.definirTermo("revisto"))
    expect(result.current.resultados.map((achado) => achado.id)).toEqual(["id-2"])
  })

  /**
   * What has left the vault must be reported.
   *
   * Without this, a search that finds nothing is indistinguishable from a message that
   * never existed, and the conclusion someone draws is about the other
   * person, not the product. The signal is the history hitting the cap: from
   * that point on the vault discards the oldest message for each new phrase that arrives.
   */
  it("diz quando o histórico está no tecto e já despejou o mais antigo", async () => {
    const cheio = Array.from({ length: 400 }, (_, i) => guardada(i + 1, `linha ${i}`))
    const { result } = renderHook(() => useProcura(ponteCom({ [CANAL]: cheio }), CANAL, true, SEM_MENSAGENS))

    await waitFor(() => expect(result.current.noTecto).toBe(true))
  })

  it("com folga no cofre não inventa um aviso", async () => {
    const folgado = Array.from({ length: 12 }, (_, i) => guardada(i + 1, `linha ${i}`))
    const { result } = renderHook(() => useProcura(ponteCom({ [CANAL]: folgado }), CANAL, true, SEM_MENSAGENS))

    await waitFor(() => expect(result.current.procuradas).toBe(12))
    expect(result.current.noTecto).toBe(false)
  })

  it("mudar de canal esquece o termo e o que se tinha encontrado", async () => {
    const OUTRO = "!adega:exemplo"
    const ponte = ponteCom({
      [CANAL]: [guardada(1, "o orçamento")],
      [OUTRO]: [guardada(1, "outra conversa")],
    })

    const { result, rerender } = renderHook(
      ({ canal }: { canal: string }) => useProcura(ponte, canal, true, SEM_MENSAGENS),
      { initialProps: { canal: CANAL } },
    )
    await waitFor(() => expect(result.current.procuradas).toBe(1))
    act(() => result.current.definirTermo("orçamento"))
    expect(result.current.resultados).toHaveLength(1)

    rerender({ canal: OUTRO })

    expect(result.current.termo).toBe("")
    expect(result.current.resultados).toEqual([])
  })

  /**
   * A response from a channel that is no longer open does not appear on screen.
   *
   * Two reads in flight at the same time is the normal case for someone switching channels
   * while the sheet is open. Without a guard, the slower one wins by arriving
   * last, and the search starts responding about the wrong conversation.
   */
  it("uma resposta atrasada do canal anterior não substitui a do actual", async () => {
    const OUTRO = "!adega:exemplo"
    const atrasos: Record<string, number> = { [CANAL]: 40, [OUTRO]: 0 }
    const ponte = {
      channels: {
        history: async (channel: string) => {
          await new Promise((resolve) => setTimeout(resolve, atrasos[channel] ?? 0))
          return channel === CANAL
            ? [guardada(1, "do lagar"), guardada(2, "também do lagar")]
            : [guardada(1, "da adega")]
        },
      },
    } as unknown as EnclaveBridge

    const { result, rerender } = renderHook(
      ({ canal }: { canal: string }) => useProcura(ponte, canal, true, SEM_MENSAGENS),
      { initialProps: { canal: CANAL } },
    )
    rerender({ canal: OUTRO })

    await waitFor(() => expect(result.current.procuradas).toBe(1))
    // Enough time for the slow read of the previous channel to arrive late.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80))
    })

    expect(result.current.procuradas).toBe(1)
  })

  it("um cofre que não se deixa ler não deita a procura abaixo", async () => {
    const ponte = {
      channels: { history: async () => Promise.reject(new Error("vault is locked")) },
    } as unknown as EnclaveBridge
    const erros = vi.fn()

    const { result } = renderHook(() => useProcura(ponte, CANAL, true, SEM_MENSAGENS, erros))

    await waitFor(() => expect(erros).toHaveBeenCalledWith("vault is locked"))
    expect(result.current.resultados).toEqual([])
    expect(result.current.aLer).toBe(false)
  })
})
