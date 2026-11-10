import { useEffect, useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { EnclaveBridge, FonteDeEcra } from "../bridge.js"
import { strings } from "../strings.js"
import { electronFalso } from "./electronFalso.js"
import { usePartilhaDeEcra } from "./usePartilhaDeEcra.js"

/**
 * End-to-end screen sharing, wired in the installed app.
 *
 * What was built and without a caller: `ecra:fontes`, `ecra:escolher`,
 * `ecra:permissao` and `ecra:abrirDefinicoes`, four tested names on the main
 * process side with not a single line of UI reading them. The result was the
 * defect described in `docs/PENDENTES.md`: where the system picker does not
 * exist, the request fell into our handler and had no one to choose it, until
 * the two-minute timeout denied it.
 *
 * The mock in `electronFalso.ts` fails the way Electron fails: a denied request
 * arrives at the page as `NotAllowedError`, which the core reads as "user hit
 * cancel" and handles silently. That is what made this defect invisible, and
 * that is why the tests below measure the screen and request state, never a
 * method call.
 */

afterEach(cleanup)

function fonte(id: string, nome: string): FonteDeEcra {
  return { id, nome, miniatura: "data:image/png;base64,M", ecraInteiro: id.startsWith("screen:") }
}

const FONTES = [fonte("screen:0:0", "Ecrã 1"), fonte("window:12:0", "Editor")]

/**
 * The shell, reduced to the path that matters: the button, the hook, and what
 * shows.
 *
 * The `screen` and `diagnostic` come from the call engine the same way they
 * come in the product, that is how the `App` knows it is sharing. Nothing here
 * spies on the hook: what is asserted is the line drawn with what came out of
 * the engine.
 */
function Casca({ bridge }: { bridge: EnclaveBridge }): React.JSX.Element {
  const { pedirPartilha, folha } = usePartilhaDeEcra(bridge)
  const [ecra, setEcra] = useState<MediaStream | null>(null)
  const [nota, setNota] = useState("")

  useEffect(() => {
    const largar = [
      bridge.call.on("screen", (evento) => setEcra(evento.stream)),
      bridge.call.on("diagnostic", (evento) => setNota(evento.code)),
    ]
    return () => largar.forEach((remover) => remover())
  }, [bridge])

  return (
    <>
      <button type="button" onClick={pedirPartilha}>
        partilhar
      </button>
      <p>captura: {ecra ? ecra.id : "nenhuma"}</p>
      <p>nota: {nota || "nenhuma"}</p>
      {folha}
    </>
  )
}

/*
  Braced body, not a terse arrow: `fireEvent.click` returns a boolean, and a
  terse arrow typed `void` returns it anyway. The `tsc -b` of this tree lets it
  pass (tests stay out of the compiled project) and `npm run typecheck` from
  `apps/web` catches it, which is where this broke once.
*/
const carregarEmPartilhar = (): void => {
  fireEvent.click(screen.getByText("partilhar"))
}
const linhas = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".ecra-fonte")]

describe("a partilha de ecrã na aplicação instalada", () => {
  it("carregar em partilhar abre o selector, com o que o sistema tem para oferecer", async () => {
    const { bridge } = electronFalso({ fontes: FONTES })
    render(<Casca bridge={bridge} />)

    carregarEmPartilhar()

    // The picker opens because the main process announced a request, and the
    // request brings it: without it there is nothing to choose and nothing waiting.
    expect(await screen.findByText(strings.ecra.escolherTitulo)).toBeTruthy()
    expect(linhas().map((linha) => linha.textContent)).toEqual(["Ecrã 1", "Editor"])
  })

  /**
   * The half that was entirely missing: the choice reaches Chromium.
   *
   * The capture that comes out is from the LOADED window, not the first in the
   * list, the flow brings the source ID, and that is what we assert. A picker
   * bound to the wrong source shared the wrong screen and passed any assertion
   * that only looked for "is sharing".
   */
  it("escolher uma janela fecha o selector e é ESSA janela que passa a ser capturada", async () => {
    const falso = electronFalso({ fontes: FONTES })
    render(<Casca bridge={falso.bridge} />)

    carregarEmPartilhar()
    await screen.findByText(strings.ecra.escolherTitulo)
    expect(screen.getByText("captura: nenhuma")).toBeTruthy()

    fireEvent.click(linhas()[1]!)

    expect(await screen.findByText("captura: window:12:0")).toBeTruthy()
    expect(screen.queryByText(strings.ecra.escolherTitulo)).toBeNull()
    // And nothing hangs on the main process side, which is the reason all this
    // exists: a request with no answer is a button thinking forever.
    expect(falso.pendentes()).toBe(0)
  })

  /**
   * Giving up, the normal path.
   *
   * What the main process does with a `null` is deny it, and denial reaches
   * the screen as `NotAllowedError`, the same name as when someone clicks cancel in
   * the system selector. The core reads it and stays silent on purpose: `call-ecra-
   * cancelado` is a diagnostic, not an error on anyone's screen.
   */
  it("desistir responde ao pedido, e ninguém fica a partilhar nada", async () => {
    const falso = electronFalso({ fontes: FONTES })
    render(<Casca bridge={falso.bridge} />)

    carregarEmPartilhar()
    await screen.findByText(strings.ecra.escolherTitulo)

    fireEvent.click(screen.getByText(strings.common.cancel))

    expect(await screen.findByText("nota: call-ecra-cancelado")).toBeTruthy()
    expect(screen.getByText("captura: nenhuma")).toBeTruthy()
    expect(screen.queryByText(strings.ecra.escolherTitulo)).toBeNull()
    expect(falso.pendentes()).toBe(0)
  })
})

/**
 * The two paths where a request would hang without anyone noticing.
 *
 * Neither is rare. The first happens to someone who hangs up with the picker
 * open, and from then on the choice goes nowhere, because there is no call to
 * put the capture in. The second happens to someone who taps twice: the main
 * process keeps requests in a map precisely because two can exist, and a UI
 * that only remembers the last leaves the first waiting out the two-minute
 * timeout.
 */
describe("um pedido nunca fica pendurado", () => {
  it("a chamada acaba com o selector aberto: fecha-se, e o pedido fica respondido", async () => {
    const falso = electronFalso({ fontes: FONTES })
    render(<Casca bridge={falso.bridge} />)

    carregarEmPartilhar()
    await screen.findByText(strings.ecra.escolherTitulo)
    expect(falso.pendentes()).toBe(1)

    falso.acabarChamada()

    expect(await screen.findByText("nota: call-ecra-cancelado")).toBeTruthy()
    expect(screen.queryByText(strings.ecra.escolherTitulo)).toBeNull()
    // And the main process stays clean without having to do it alone: here
    // the mock does NOT run `fecharTodos`, on purpose, to measure whether the
    // UI responds or whether it is counting on the other side of the network.
    expect(falso.pendentes()).toBe(0)
  })

  it("um segundo pedido não apaga o primeiro: o primeiro é respondido a negar", async () => {
    const falso = electronFalso({ fontes: FONTES })
    render(<Casca bridge={falso.bridge} />)

    carregarEmPartilhar()
    await screen.findByText(strings.ecra.escolherTitulo)
    carregarEmPartilhar()

    // The first died by response, not by forgetting: what waits is one only,
    // the new one.
    expect(await screen.findByText("nota: call-ecra-cancelado")).toBeTruthy()
    expect(falso.pendentes()).toBe(1)

    // And the picker on screen responds to the new request, not the old.
    fireEvent.click(linhas()[1]!)
    expect(await screen.findByText("captura: window:12:0")).toBeTruthy()
    expect(falso.pendentes()).toBe(0)
  })
})

/**
 * The macOS gate, read BEFORE touching `getDisplayMedia`.
 *
 * Order is everything. Asking for a capture that the system already decided to
 * refuse turns on the system's recording indicator and delivers not a single
 * pixel; and what the core gets back is the same `NotAllowedError` as always,
 * which it reads as "user hit cancel" and handles silently. In other words:
 * without this gate, a machine with permission denied has a button that does
 * nothing and says nothing.
 */
describe("a permissão de gravar o ecrã, no macOS", () => {
  const NEGADA = { estado: "denied", podeExplicar: true }
  const CONCEDIDA = { estado: "granted", podeExplicar: false }

  it("com a permissão negada, explica-se — e não se abre captura nenhuma", async () => {
    const falso = electronFalso({ fontes: FONTES, permissao: NEGADA })
    render(<Casca bridge={falso.bridge} />)

    carregarEmPartilhar()

    expect(await screen.findByText(strings.ecra.permissaoTitulo)).toBeTruthy()
    // No capture, no picker: the path stops here on purpose.
    expect(falso.capturas()).toBe(0)
    expect(screen.getByText("captura: nenhuma")).toBeTruthy()
    expect(screen.queryByText(strings.ecra.escolherTitulo)).toBeNull()
  })

  /**
   * `not-determined` is NOT a leaf case, and that distinction decides it all.
   *
   * In that state macOS still opens its dialog on the first try. A sheet of
   * ours on top would be the app explaining what the system is asking at the
   * same time. Who decides is `permissaoDeEcra`, and the UI obeys `podeExplicar`
   * instead of reinterpreting the state.
   */
  it("com a permissão por decidir, deixa-se o sistema perguntar: parte-se para a captura", async () => {
    const falso = electronFalso({ fontes: FONTES, permissao: { estado: "not-determined", podeExplicar: false } })
    render(<Casca bridge={falso.bridge} />)

    carregarEmPartilhar()

    expect(await screen.findByText(strings.ecra.escolherTitulo)).toBeTruthy()
    expect(screen.queryByText(strings.ecra.permissaoTitulo)).toBeNull()
  })

  it("com a permissão dada, parte-se para a captura sem folha nenhuma pelo meio", async () => {
    const falso = electronFalso({ fontes: FONTES, permissao: CONCEDIDA })
    render(<Casca bridge={falso.bridge} />)

    carregarEmPartilhar()

    expect(await screen.findByText(strings.ecra.escolherTitulo)).toBeTruthy()
    expect(screen.queryByText(strings.ecra.permissaoTitulo)).toBeNull()
    expect(falso.capturas()).toBe(1)
  })

  /**
   * A read that breaks is not a system refusal.
   *
   * Fail on the side of letting it try: in the worst case the system refuses
   * next, which is exactly where things were before this read existed. Locking
   * sharing because of an IPC that did not answer was inventing an obstacle that
   * no one declared.
   */
  it("se a leitura da permissão rebentar, tenta-se na mesma", async () => {
    const falso = electronFalso({ fontes: FONTES, permissaoRebenta: true })
    render(<Casca bridge={falso.bridge} />)

    carregarEmPartilhar()

    expect(await screen.findByText(strings.ecra.escolherTitulo)).toBeTruthy()
    expect(falso.capturas()).toBe(1)
  })

  it("o botão das Definições da folha leva ao painel do sistema", async () => {
    const falso = electronFalso({ permissao: NEGADA })
    render(<Casca bridge={falso.bridge} />)

    carregarEmPartilhar()
    await screen.findByText(strings.ecra.permissaoTitulo)
    expect(falso.definicoes()).toBe(0)

    fireEvent.click(screen.getByText(strings.ecra.permissaoAbrir))

    expect(falso.definicoes()).toBe(1)
  })
})

/**
 * The browser, where none of this exists and should not.
 *
 * Chrome brings its picker, translated, aware of screens waking mid-stream,
 * and the same one people see in other apps, and handles permission itself. The
 * web bridge brings no `ecra`, and that absence must read as "this host handles
 * it", not as a missing capability.
 */
describe("no browser, o anfitrião trata disto sozinho", () => {
  it("carregar em partilhar vai direito ao motor, sem selector nosso pelo meio", async () => {
    const falso = electronFalso({ fontes: FONTES, comEcra: false })
    render(<Casca bridge={falso.bridge} />)

    carregarEmPartilhar()

    expect(await screen.findByText("captura: ecra-do-sistema")).toBeTruthy()
    expect(screen.queryByText(strings.ecra.escolherTitulo)).toBeNull()
    expect(screen.queryByText(strings.ecra.permissaoTitulo)).toBeNull()
  })
})

describe("o som do sistema, sem caixa", () => {
  it("onde o sistema o dá, não há caixa: escolher partilha, e o anfitrião manda o som", async () => {
    const falso = electronFalso({ fontes: FONTES, somDoSistema: true })
    render(<Casca bridge={falso.bridge} />)
    carregarEmPartilhar()
    expect(await screen.findByText(strings.ecra.somDoSistemaNota)).toBeTruthy()
    expect(screen.queryByRole("checkbox")).toBeNull()

    fireEvent.click(linhas()[0]!)
    expect(await screen.findByText("captura: screen:0:0")).toBeTruthy()
    // The UI no longer says no: who decides is the main process.
    expect(falso.somEscolhido()).not.toBe(false)
  })

  it("onde o sistema não o dá, não há caixa nem linha", async () => {
    const falso = electronFalso({ fontes: FONTES })
    render(<Casca bridge={falso.bridge} />)
    carregarEmPartilhar()
    await screen.findByText(strings.ecra.escolherTitulo)
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(screen.queryByText(strings.ecra.somDoSistemaNota)).toBeNull()
  })
})
