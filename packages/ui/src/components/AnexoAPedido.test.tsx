import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { BridgeContext } from "../App.js"
import type { DesfechoDoAnexo, EnclaveBridge } from "../bridge.js"
import { strings } from "../strings.js"
import type { MediaItem } from "../types.js"
import { AnexosDoItem } from "./AnexoAPedido.js"
import { PostImages } from "./PostImages.js"

/** An image that this device only has the name for: requested from other members when opened (S5, §5.4). */

afterEach(cleanup)

const IMAGEM = "data:image/png;base64,iVBORw0KGgo="

function montar(desfecho: DesfechoDoAnexo, comContexto = true): { pedir: ReturnType<typeof vi.fn>; lista: MediaItem[] } {
  const pedir = vi.fn(async () => desfecho)
  const lista: MediaItem[] = [{ name: "a.png", mediaType: "image/png", inline: IMAGEM }, { evicted: true, name: "b.png", mediaType: "image/png" }]
  const bridge = { anexo: { pedir } } as unknown as EnclaveBridge
  const grelha = <PostImages media={lista} />
  render(
    <BridgeContext.Provider value={bridge}>
      {comContexto ? <AnexosDoItem.Provider value={{ channel: "!lagar:s", alvo: "post-1", lista }}>{grelha}</AnexosDoItem.Provider> : grelha}
    </BridgeContext.Provider>,
  )
  return { pedir, lista }
}

async function carregar(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(strings.sincronia.anexoPedir) }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe("ImagemAPedido", () => {
  it("só pede quando se carrega, com a posição certa, e mostra a imagem que chegou", async () => {
    const { pedir } = montar({ ok: true, anexo: { name: "b.png", mediaType: "image/png", inline: IMAGEM } })
    expect(pedir).not.toHaveBeenCalled()
    await carregar()
    expect(pedir).toHaveBeenCalledWith({ channel: "!lagar:s", alvo: "post-1", indice: 1 })
    expect(screen.getAllByRole("img").filter((img) => img.getAttribute("src") === IMAGEM)).toHaveLength(2)
  })

  it("se ninguém a tem, diz a frase do limite", async () => {
    montar({ ok: false, motivo: "ninguem" })
    await carregar()
    expect(screen.getByRole("status").textContent).toBe(strings.sincronia.anexoNinguem)
  })

  it("se o que chegou não confere, não se mostra", async () => {
    montar({ ok: false, motivo: "recusado" })
    await carregar()
    expect(screen.getByRole("status").textContent).toBe(strings.sincronia.anexoRecusado)
  })

  it('a frase de "ninguém" diz que nenhum membro com a imagem está ligado, e há "Tentar outra vez"', async () => {
    const { pedir } = montar({ ok: false, motivo: "ninguem" })
    await carregar()
    expect(strings.sincronia.anexoNinguem).toMatch(/ligado/)
    expect(screen.getByRole("status").textContent).toBe(strings.sincronia.anexoNinguem)
    pedir.mockResolvedValueOnce({ ok: true, anexo: { name: "b.png", mediaType: "image/png", inline: IMAGEM } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.sincronia.anexoTentarOutraVez }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(pedir).toHaveBeenCalledTimes(2)
    expect(screen.getAllByRole("img").filter((img) => img.getAttribute("src") === IMAGEM)).toHaveLength(2)
  })

  it("a pedir, deixa cancelar; cancelado, volta o botão de pedir", async () => {
    let acabar: (desfecho: DesfechoDoAnexo) => void = () => {}
    const pedir = vi.fn(() => new Promise<DesfechoDoAnexo>((resolver) => (acabar = resolver)))
    const cancelar = vi.fn(async () => {
      acabar({ ok: false, motivo: "cancelado" })
      return true
    })
    const lista: MediaItem[] = [{ evicted: true, name: "b.png", mediaType: "image/png" }]
    render(
      <BridgeContext.Provider value={{ anexo: { pedir, cancelar } } as unknown as EnclaveBridge}>
        <AnexosDoItem.Provider value={{ channel: "!lagar:s", alvo: "post-1", lista }}>
          <PostImages media={lista} />
        </AnexosDoItem.Provider>
      </BridgeContext.Provider>,
    )
    await carregar()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.sincronia.anexoCancelar }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(cancelar).toHaveBeenCalledWith({ channel: "!lagar:s", alvo: "post-1", indice: 0 })
    expect(screen.getByRole("button", { name: new RegExp(strings.sincronia.anexoPedir) })).toBeTruthy()
    expect(screen.queryByRole("status")).toBeNull()
  })

  it('com a fila cheia ("por pedir"), volta o botão de pedir, sem frase de falha', async () => {
    montar({ ok: false, motivo: "por-pedir" })
    await carregar()
    expect(screen.getByRole("button", { name: new RegExp(strings.sincronia.anexoPedir) })).toBeTruthy()
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("sem saber de que mensagem é, fica o marcador de sempre, sem botão", () => {
    montar({ ok: true, anexo: {} }, false)
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByRole("img", { name: strings.common.mediaEvicted })).toBeTruthy()
  })
})
