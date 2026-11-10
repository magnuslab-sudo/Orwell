import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { AvisoDeActualizacao } from "./AvisoDeActualizacao.js"

afterEach(cleanup)

const AVISO = {
  instalada: "0.1.0",
  disponivel: "0.2.0",
  nome: "Statio",
  soma: "a".repeat(64),
}

describe("o aviso de versão nova", () => {
  it("diz as duas versões, e o nome da que saiu", () => {
    render(<AvisoDeActualizacao aviso={AVISO} onDescarregar={() => {}} onDispensar={() => {}} />)
    const cartao = screen.getByRole("status")
    expect(cartao.textContent).toContain('Tens a 0.1.0 instalada. A 0.2.0 "Statio" já está publicada.')
  })

  it("e sem nome diz na mesma as versões", () => {
    render(
      <AvisoDeActualizacao
        aviso={{ instalada: "0.1.0", disponivel: "0.2.0" }}
        onDescarregar={() => {}}
        onDispensar={() => {}}
      />,
    )
    expect(screen.getByRole("status").textContent).toContain("Tens a 0.1.0 instalada. A 0.2.0 já está publicada.")
  })

  it("admite que não se actualiza sozinha", () => {
    /*
      The most important message on the card. Without it, someone hitting "Go to downloads"
      expects a progress bar and gets a browser, and next time they see this warning
      they think the app is broken.
    */
    render(<AvisoDeActualizacao aviso={AVISO} onDescarregar={() => {}} onDispensar={() => {}} />)
    expect(screen.getByRole("status").textContent).toContain("não se actualiza sozinha")
  })

  it("mostra a soma, que é a única defesa que há sem assinatura", () => {
    // A checksum published on a page no one opens defends against nothing. Here
    // it is read before downloading, which is when it still serves a purpose.
    render(<AvisoDeActualizacao aviso={AVISO} onDescarregar={() => {}} onDispensar={() => {}} />)
    expect(screen.getByRole("status").textContent).toContain("a".repeat(64))
    expect(screen.getByRole("status").textContent).toContain("SHA-256 do instalador")
  })

  it("e sem soma continua a avisar", () => {
    // Losing the checksum is not losing the warning. See `lerManifesto` in the
    // main process, which drops a malformed checksum and keeps the version.
    const { instalada, disponivel } = AVISO
    render(
      <AvisoDeActualizacao aviso={{ instalada, disponivel }} onDescarregar={() => {}} onDispensar={() => {}} />,
    )
    expect(screen.getByRole("status").textContent).not.toContain("SHA-256")
  })

  it("não existe quando não há nada a dizer", () => {
    // The normal case, and the whole case in the browser: a page does not fall behind.
    const { container } = render(
      <AvisoDeActualizacao aviso={null} onDescarregar={() => {}} onDispensar={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("interrompe ninguém: é `status` e não `alert`", () => {
    /*
      An `alert` cuts off what a screen reader is saying. Interrupting
      someone in the middle of a conversation to talk about a version number is the
      kind of warning people learn to ignore.
    */
    render(<AvisoDeActualizacao aviso={AVISO} onDescarregar={() => {}} onDispensar={() => {}} />)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite")
  })
})

describe("os dois gestos", () => {
  it("o botão principal diz para onde leva, e não que actualiza", () => {
    /*
      Nothing here updates anything, without signed installers there cannot be
      an updater you can trust. A button saying "Update" that then opens a browser
      is a promise broken on the first click.
    */
    const descarregar = vi.fn()
    render(<AvisoDeActualizacao aviso={AVISO} onDescarregar={descarregar} onDispensar={() => {}} />)

    const botao = screen.getByRole("button", { name: "Ir à página de descargas" })
    expect(botao.textContent).not.toMatch(/actualizar/i)

    fireEvent.click(botao)
    expect(descarregar).toHaveBeenCalledOnce()
  })

  it("e o de dispensar diz o que dispensa, com a versão pelo nome", () => {
    // "Dismiss" alone does not say for how long. The `title` says: will not warn again
    // about THIS version, and will warn again for the next one.
    const dispensar = vi.fn()
    render(<AvisoDeActualizacao aviso={AVISO} onDescarregar={() => {}} onDispensar={dispensar} />)

    const botao = screen.getByRole("button", { name: "Dispensar" })
    expect(botao.getAttribute("title")).toBe("Não voltar a avisar sobre a 0.2.0")

    fireEvent.click(botao)
    expect(dispensar).toHaveBeenCalledOnce()
  })
})
