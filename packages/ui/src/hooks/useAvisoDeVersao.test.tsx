import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { AvisoDeActualizacao, EnclaveBridge } from "../bridge.js"
import { clearDiagnostics, diagnosticsSnapshot } from "../lib/diagnostics.js"
import { useAvisoDeVersao } from "./useAvisoDeVersao.js"

/**
 * End-to-end notification on the interface side.
 *
 * What we measure here is not the request itself: it is WHEN it happens and HOW MANY
 * times. A notification that appears before the user logs in, or that asks again on every
 * render, is the kind of notification people learn to ignore. One that asks in the browser
 * is a request to orwell.pt with no justification, in an app that disables Chromium
 * telemetry at startup.
 */

afterEach(cleanup)

const AVISO: AvisoDeActualizacao = { instalada: "0.1.0", disponivel: "0.2.0", nome: "Statio" }

/** A bridge reduced to what this hook touches. Nothing else is read. */
function ponte(actualizacao?: NonNullable<EnclaveBridge["actualizacao"]>): EnclaveBridge {
  return { ...(actualizacao ? { actualizacao } : {}) } as unknown as EnclaveBridge
}

function anfitriao(aviso: AvisoDeActualizacao | null): NonNullable<EnclaveBridge["actualizacao"]> {
  return {
    verificar: vi.fn(async () => aviso),
    dispensar: vi.fn(async () => ({ ok: true })),
    abrir: vi.fn(async () => ({ ok: true })),
  }
}

/** The shell, reduced to the path that matters. Nothing here spies on the hook. */
function Casca({ bridge, entrou }: { bridge: EnclaveBridge; entrou: boolean }): React.JSX.Element {
  const { aviso, descarregar, dispensar } = useAvisoDeVersao(bridge, entrou)
  return (
    <div>
      <span data-testid="estado">{aviso ? `${aviso.instalada} para ${aviso.disponivel}` : "nada"}</span>
      <button onClick={descarregar}>descarregar</button>
      <button onClick={dispensar}>dispensar</button>
    </div>
  )
}

describe("quando é que se pergunta", () => {
  it("não pergunta nada antes de a pessoa entrar", async () => {
    /*
      A card appearing above the password field is an interruption at the only moment
      when the user is doing something for real. And before the session starts it has
      not connected yet, so the network is the least reliable it will be.
      */
    const host = anfitriao(AVISO)
    render(<Casca bridge={ponte(host)} entrou={false} />)

    expect(host.verificar).not.toHaveBeenCalled()
    expect(screen.getByTestId("estado").textContent).toBe("nada")
  })

  it("pergunta depois de entrar, e avisa", async () => {
    const host = anfitriao(AVISO)
    const { rerender } = render(<Casca bridge={ponte(host)} entrou={false} />)
    rerender(<Casca bridge={ponte(host)} entrou={true} />)

    await waitFor(() => expect(screen.getByTestId("estado").textContent).toBe("0.1.0 para 0.2.0"))
    expect(host.verificar).toHaveBeenCalledOnce()
  })

  it("e pergunta UMA vez, por muitas voltas que a árvore dê", async () => {
    // Without the guard, React strict mode remounting made two requests to orwell.pt on
    // each login, and a `bridge` recreated on every render made one per loop.
    const host = anfitriao(AVISO)
    const { rerender } = render(<Casca bridge={ponte(host)} entrou={true} />)
    await waitFor(() => expect(host.verificar).toHaveBeenCalledOnce())

    for (let i = 0; i < 5; i++) rerender(<Casca bridge={ponte(host)} entrou={true} />)
    expect(host.verificar).toHaveBeenCalledOnce()
  })

  it("no browser não pergunta a ninguém: uma página não fica para trás", async () => {
    // `bridge.actualizacao` only comes from the Electron `preload`. Its absence decides,
    // not an `if` written in the interface.
    render(<Casca bridge={ponte()} entrou={true} />)
    await waitFor(() => expect(screen.getByTestId("estado").textContent).toBe("nada"))
  })

  it("cala-se quando não há versão nova", async () => {
    const host = anfitriao(null)
    render(<Casca bridge={ponte(host)} entrou={true} />)
    await waitFor(() => expect(host.verificar).toHaveBeenCalledOnce())
    expect(screen.getByTestId("estado").textContent).toBe("nada")
  })

  it("um IPC que rejeita não rebenta a entrada na aplicação", async () => {
    /*
      This is the literal case of this feature: whoever has 0.1.0 installed has a
      `preload` that does not know `actualizacao:verificar`, and an `invoke` with no
      handler on the other side rejects. Crashing the login because of a version
      notification would be in poor taste.
    */
    const host = {
      ...anfitriao(null),
      verificar: vi.fn(async () => {
        throw new Error("No handler registered for 'actualizacao:verificar'")
      }),
    }
    render(<Casca bridge={ponte(host)} entrou={true} />)
    await waitFor(() => expect(host.verificar).toHaveBeenCalledOnce())
    expect(screen.getByTestId("estado").textContent).toBe("nada")
  })
})

describe("os dois gestos", () => {
  it("descarregar abre a página, e não dispensa a versão", async () => {
    /*
      Close the card without dismissing the version: whoever went to download does not need to
      keep seeing the notification, and whoever does not manage to install will see it again
      on the next startup. It fails in the right direction.
    */
    const host = anfitriao(AVISO)
    render(<Casca bridge={ponte(host)} entrou={true} />)
    await waitFor(() => expect(screen.getByTestId("estado").textContent).toBe("0.1.0 para 0.2.0"))

    fireEvent.click(screen.getByText("descarregar"))

    expect(host.abrir).toHaveBeenCalledOnce()
    expect(host.dispensar).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByTestId("estado").textContent).toBe("nada"))
  })

  it("abrir não leva endereço nenhum, e é o desenho e não uma economia", async () => {
    /*
      The URL lives in the main process, as a constant. If this gesture fetched one, the
      interface, which is the untrusted part of this app, would be able to choose where
      a user is sent to download an executable.
    */
    const host = anfitriao(AVISO)
    render(<Casca bridge={ponte(host)} entrou={true} />)
    await waitFor(() => expect(screen.getByTestId("estado").textContent).toBe("0.1.0 para 0.2.0"))

    fireEvent.click(screen.getByText("descarregar"))
    expect(host.abrir).toHaveBeenCalledWith()
  })

  it("dispensar cala a versão, pelo nome dela", async () => {
    // The number goes to disk in the main process, and that is what makes the notification
    // once per version instead of an alarm on every startup.
    const host = anfitriao(AVISO)
    render(<Casca bridge={ponte(host)} entrou={true} />)
    await waitFor(() => expect(screen.getByTestId("estado").textContent).toBe("0.1.0 para 0.2.0"))

    fireEvent.click(screen.getByText("dispensar"))

    expect(host.dispensar).toHaveBeenCalledWith("0.2.0")
    await waitFor(() => expect(screen.getByTestId("estado").textContent).toBe("nada"))
  })
})

describe("o desfecho da actualização automática do arranque", () => {
  it("vai para o registo de diagnóstico depois de entrar", async () => {
    clearDiagnostics()
    const host = {
      ...anfitriao(null),
      diagnostico: vi.fn(async () => ({ quando: 1, codigo: "assinatura-errada", versao: "1.0.7" })),
    }
    render(<Casca bridge={ponte(host)} entrou={true} />)

    await waitFor(() =>
      expect(diagnosticsSnapshot()).toContainEqual(
        expect.objectContaining({ code: "actualizacao-windows", outcome: "assinatura-errada", detail: "1.0.7" }),
      ),
    )
    expect(host.diagnostico).toHaveBeenCalledOnce()
  })

  it("um preload sem o canal não rebenta nada", async () => {
    clearDiagnostics()
    const host = anfitriao(AVISO)
    render(<Casca bridge={ponte(host)} entrou={true} />)
    await waitFor(() => expect(screen.getByTestId("estado").textContent).toBe("0.1.0 para 0.2.0"))
    expect(diagnosticsSnapshot().filter((e) => e.code === "actualizacao-windows")).toEqual([])
  })
})
