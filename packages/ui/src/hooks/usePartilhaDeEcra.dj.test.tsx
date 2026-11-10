import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { EnclaveBridge, FonteDeEcra } from "../bridge.js"
import { appDoDj, largarPedidoDoDj, marcarPedidoDoDj } from "../lib/pedidoDoDj.js"
import { strings } from "../strings.js"
import { electronFalso } from "./electronFalso.js"
import { usePartilhaDeEcra } from "./usePartilhaDeEcra.js"

/**
 * The DJ on the desktop app: the DJ capture request hits the SAME handler on
 * the main process as screen share, and the shell responds.
 *
 *  - "System audio": responds on its own with a screen, no selector.
 *  - "Tab" and "One window": the selector in "audio only" mode, tabs and
 *    windows only, with the stated cap (Electron gives system audio as a whole,
 *    not per window).
 *
 * The counterpart is `electronFalso`: an unanswered request hangs, and a `null`
 * arrives as `NotAllowedError`, as in Electron.
 */

afterEach(() => {
  cleanup()
  largarPedidoDoDj()
})

const fonte = (id: string, nome: string): FonteDeEcra => ({ id, nome, miniatura: "", ecraInteiro: id.startsWith("screen:") })
const FONTES = [fonte("screen:0:0", "Ecrã 1"), fonte("window:12:0", "Spotify"), fonte("window:13:0", "Editor")]

function Casca({ bridge }: { bridge: EnclaveBridge }): React.JSX.Element {
  const { folha } = usePartilhaDeEcra(bridge)
  return <>{folha}</>
}

describe("o DJ na app de secretária", () => {
  it("a concha diz ao DJ se o sistema dá o som do sistema, e deixa de o dizer ao sair", async () => {
    const com = electronFalso({ fontes: FONTES, somDoSistema: true })
    const { unmount } = render(<Casca bridge={com.bridge} />)
    expect(await appDoDj()?.somDoSistema()).toBe(true)
    unmount()
    expect(appDoDj()).toBeNull()

    const sem = electronFalso({ fontes: FONTES, somDoSistema: false })
    render(<Casca bridge={sem.bridge} />)
    expect(await appDoDj()?.somDoSistema()).toBe(false)
  })

  it("no browser não há app do DJ", () => {
    const { bridge } = electronFalso({ comEcra: false })
    render(<Casca bridge={bridge} />)
    expect(appDoDj()).toBeNull()
  })

  it('"Som do sistema": responde sozinha com um ecrã, sem selector nenhum', async () => {
    const falso = electronFalso({ fontes: FONTES, somDoSistema: true })
    render(<Casca bridge={falso.bridge} />)
    marcarPedidoDoDj("sistema")
    let fluxo: MediaStream | null = null
    await act(async () => {
      fluxo = await falso.getDisplayMedia()
    })
    expect((fluxo as MediaStream | null)?.id).toBe("screen:0:0")
    expect(screen.queryByText(strings.ecra.escolherTitulo)).toBeNull()
    expect(screen.queryByText(strings.ecra.escolherSomTitulo)).toBeNull()
    expect(falso.pendentes()).toBe(0)
  })

  it('"Som do sistema" sem ecrã nenhum: nega, e o pedido não fica pendurado', async () => {
    const falso = electronFalso({ fontes: [fonte("window:12:0", "Spotify")], somDoSistema: true })
    render(<Casca bridge={falso.bridge} />)
    marcarPedidoDoDj("sistema")
    await act(async () => {
      await expect(falso.getDisplayMedia()).rejects.toMatchObject({ name: "NotAllowedError" })
    })
    expect(falso.pendentes()).toBe(0)
  })

  it('"Uma janela": o selector só com janelas e o limite dito; a escolha dá o nome ao cartão', async () => {
    const falso = electronFalso({ fontes: FONTES, somDoSistema: true })
    render(<Casca bridge={falso.bridge} />)
    marcarPedidoDoDj("janela")
    const pedido = falso.getDisplayMedia()
    expect(await screen.findByText(strings.ecra.escolherSomTitulo)).toBeTruthy()
    await waitFor(() => expect(document.querySelectorAll(".ecra-fonte")).toHaveLength(2))
    const nomes = [...document.querySelectorAll(".ecra-fonte")].map((linha) => linha.textContent)
    expect(nomes).toEqual(["Spotify", "Editor"])
    expect(screen.getByText(strings.musica.notaDaFonte("janela", true))).toBeTruthy()
    expect(screen.getByText(strings.musica.ecoNaApp)).toBeTruthy()
    // Without the screen phrase: no image shows up here.
    expect(screen.queryByText(strings.ecra.somDoSistemaNota)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: strings.ecra.escolherSomAria("Spotify") }))
    expect((await pedido).id).toBe("window:12:0")
    expect(largarPedidoDoDj()).toEqual({ fonte: "janela", nome: "Spotify" })
  })

  it("um pedido sem marca do DJ continua a ser a partilha de ecrã de sempre", async () => {
    const falso = electronFalso({ fontes: FONTES, somDoSistema: true })
    render(<Casca bridge={falso.bridge} />)
    void falso.getDisplayMedia().catch(() => {})
    expect(await screen.findByText(strings.ecra.escolherTitulo)).toBeTruthy()
    await waitFor(() => expect(document.querySelectorAll(".ecra-fonte")).toHaveLength(3))
  })
})
