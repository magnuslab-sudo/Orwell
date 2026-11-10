import { describe, expect, it, vi } from "vitest"
import {
  DEFINICOES_DE_GRAVACAO_DE_ECRA,
  PedidosDeEcra,
  permissaoDeEcra,
  reduzirFontes,
  escolhaDoEcra,
  somDoSistema,
  temPortaoDeEcra,
  USAR_SELECTOR_DO_SISTEMA,
  type EscolhaDeEcra,
  type EstadoDaPermissao,
  type FonteDeEcra,
} from "./ecra.js"

/**
 * Screen sharing logic in the main process, tested without Electron.
 *
 * The `vitest.config.ts` of this package only ran `src/renderer` because "the
 * main process talks to Electron, which doesn't exist outside it". That was
 * true while the logic lived in `index.ts`. This file exists precisely to keep
 * it out of there: ports come as parameters, and what stays is arithmetic that
 * can be tested.
 */

/** A thumbnail as Electron provides it. */
function miniatura(vazia = false): { isEmpty: () => boolean; toDataURL: () => string } {
  return { isEmpty: () => vazia, toDataURL: () => "data:image/png;base64,AAAA" }
}

describe("o portão do sistema é do macOS, e só dele", () => {
  it("no macOS há permissão a pedir; no Windows e no Linux não há", () => {
    expect(temPortaoDeEcra("darwin")).toBe(true)
    expect(temPortaoDeEcra("win32")).toBe(false)
    expect(temPortaoDeEcra("linux")).toBe(false)
  })

  it("fora do macOS responde concedido sem sequer perguntar ao sistema", () => {
    // Asking returned `granted` on Windows and nothing on Linux, and handling all
    // three platforms by macOS's answer would show a permission prompt where
    // there's nothing to authorize.
    const perguntou = vi.fn<() => EstadoDaPermissao>(() => "denied")

    expect(permissaoDeEcra("win32", perguntou)).toEqual({ estado: "granted", podeExplicar: false })
    expect(perguntou).not.toHaveBeenCalled()
  })

  it("no macOS, negado é o estado que ganha uma explicação", () => {
    expect(permissaoDeEcra("darwin", () => "denied")).toEqual({ estado: "denied", podeExplicar: true })
    expect(permissaoDeEcra("darwin", () => "restricted")).toEqual({ estado: "restricted", podeExplicar: true })
  })

  it("concedido não explica nada, e POR DECIDIR também não", () => {
    /*
      `not-determined` is the distinction that decides if the sheet helps or
      gets in the way. In that state macOS still opens its dialog on the first
      try; our sheet on top would be the app explaining what the system is
      asking at the same time. The sheet is for when the system doesn't ask
      anymore.
      */
    expect(permissaoDeEcra("darwin", () => "granted").podeExplicar).toBe(false)
    expect(permissaoDeEcra("darwin", () => "not-determined").podeExplicar).toBe(false)
    // And the state travels with it: whoever reads it tells the two apart.
    expect(permissaoDeEcra("darwin", () => "not-determined").estado).toBe("not-determined")
  })

  it("o atalho leva ao painel da GRAVAÇÃO DE ECRÃ, e não às Definições em geral", () => {
    // Without the fragment, macOS opens Privacy & Security at the top and the
    // user scrolls through eighteen panels looking for the right one.
    expect(DEFINICOES_DE_GRAVACAO_DE_ECRA).toContain("x-apple.systempreferences:")
    expect(DEFINICOES_DE_GRAVACAO_DE_ECRA).toContain("Privacy_ScreenCapture")
  })
})

describe("as fontes, reduzidas ao que atravessa o IPC", () => {
  it("um ecrã inteiro distingue-se de uma janela pelo prefixo do Electron", () => {
    const fontes = reduzirFontes(
      [
        { id: "screen:0:0", name: "Ecrã 1", thumbnail: miniatura() },
        { id: "window:1234:0", name: "Orwell", thumbnail: miniatura() },
      ],
      "Janela sem nome",
    )

    expect(fontes.map((f) => f.ecraInteiro)).toEqual([true, false])
    // By prefix, not name. "Ecrã 1" is translated and "Screen 1" is not, and a
    // list sorted by name would break in another language.
    expect(fontes[0]?.nome).toBe("Ecrã 1")
  })

  it("uma janela sem título aparece na lista, dita pelo que é", () => {
    // macOS returns titleless windows for some apps. Dropping them would leave
    // holes in the list, which is worse than an honest line.
    const fontes = reduzirFontes([{ id: "window:9:0", name: "   ", thumbnail: miniatura() }], "Janela sem nome")

    expect(fontes).toHaveLength(1)
    expect(fontes[0]?.nome).toBe("Janela sem nome")
  })

  it("a miniatura viaja em `data:`, e uma vazia viaja como vazia", () => {
    // Never `NativeImage`: what crosses this boundary is plain data. An Electron
    // object on the renderer side was a handle for the process that holds the keys.
    const [comImagem, semImagem] = reduzirFontes(
      [
        { id: "screen:0:0", name: "Ecrã", thumbnail: miniatura() },
        { id: "screen:1:0", name: "Ecrã 2", thumbnail: miniatura(true) },
      ],
      "sem nome",
    )

    expect(comImagem?.miniatura.startsWith("data:image/")).toBe(true)
    expect(semImagem?.miniatura).toBe("")
  })
})

describe("os pedidos à espera de quem escolhe", () => {
  const fonte = (id: string): FonteDeEcra => ({ id, nome: id, miniatura: "", ecraInteiro: true })

  it("a escolha chega ao pedido certo, e cada pedido responde uma vez só", () => {
    const pedidos = new PedidosDeEcra()
    const respostas: (EscolhaDeEcra | null)[] = []

    const primeiro = pedidos.abrir((f) => respostas.push(f))
    const segundo = pedidos.abrir((f) => respostas.push(f))
    expect(primeiro).not.toBe(segundo)
    expect(pedidos.pendentes).toBe(2)

    // Respond to the second one. With a single variable instead of this map, the
    // second request would have wiped the first and the first's promise would
    // never resolve, a `getDisplayMedia` stuck thinking forever.
    pedidos.responder(segundo, fonte("screen:1:0"))
    expect(respostas).toEqual([fonte("screen:1:0")])
    expect(pedidos.pendentes).toBe(1)

    pedidos.responder(primeiro, fonte("screen:0:0"))
    expect(respostas).toEqual([fonte("screen:1:0"), fonte("screen:0:0")])
    expect(pedidos.pendentes).toBe(0)
  })

  it("responder duas vezes ao mesmo pedido não o responde duas vezes", () => {
    // Chromium rejects a second response with an exception. Here the second one
    // doesn't reach it.
    const pedidos = new PedidosDeEcra()
    const respostas: (EscolhaDeEcra | null)[] = []
    const id = pedidos.abrir((f) => respostas.push(f))

    expect(pedidos.responder(id, fonte("screen:0:0"))).toBe(true)
    expect(pedidos.responder(id, fonte("screen:1:0"))).toBe(false)
    expect(respostas).toHaveLength(1)
  })

  it("uma resposta a um pedido que já morreu é ignorada, e di-lo", () => {
    // It happens every time the window reloads with a picker open.
    const pedidos = new PedidosDeEcra()
    expect(pedidos.responder("ecra-99", fonte("screen:0:0"))).toBe(false)
  })

  it("cancelar responde `null`, que é o que nega sem parecer avaria", () => {
    const pedidos = new PedidosDeEcra()
    const respostas: (EscolhaDeEcra | null)[] = []
    const id = pedidos.abrir((f) => respostas.push(f))

    pedidos.responder(id, null)

    expect(respostas).toEqual([null])
  })

  it("fechar tudo nega os que ficaram, e não deixa nenhum pendurado", () => {
    /*
      A pending request when the call ends is a picker open over a call that no
      longer exists. Without this, its response would enter a `Call` with no
      channel, and on Chromium's side a request that never closes.
    */
    const pedidos = new PedidosDeEcra()
    const respostas: (EscolhaDeEcra | null)[] = []
    pedidos.abrir((f) => respostas.push(f))
    pedidos.abrir((f) => respostas.push(f))

    pedidos.fecharTodos()

    expect(respostas).toEqual([null, null])
    expect(pedidos.pendentes).toBe(0)
    // And closing again doesn't respond to anyone: nothing's left open.
    pedidos.fecharTodos()
    expect(respostas).toHaveLength(2)
  })
})

/**
 * System audio on screen share (bug of 26 October 2026).
 *
 * The handler always passed only `video`, and the installed app's share came
 * out mute on all systems, including Windows where Electron provides it.
 */
describe("o som do sistema, onde o sistema o dá", () => {
  it("Windows: sempre", () => {
    expect(somDoSistema("win32", "10.0.22631")).toBe("loopback")
  })

  it("macOS 14.2 (Darwin 23.2) ou mais recente: sim; antes disso, não", () => {
    expect(somDoSistema("darwin", "23.2.0")).toBe("loopback")
    expect(somDoSistema("darwin", "24.6.0")).toBe("loopback")
    expect(somDoSistema("darwin", "25.5.0")).toBe("loopback")
    expect(somDoSistema("darwin", "23.1.0")).toBeNull()
    expect(somDoSistema("darwin", "22.6.0")).toBeNull()
  })

  it("macOS 15+ com o selector do sistema: sem som, porque o nosso handler não corre", () => {
    // The system picker skips `setDisplayMediaRequestHandler`, and without it
    // there's no `loopback`. Saying "there's sound" hid issue 441.
    expect(somDoSistema("darwin", "25.5.0", true)).toBeNull()
    expect(somDoSistema("darwin", "24.0.0", true)).toBeNull()
    // Before macOS 15 the system picker doesn't exist, and the handler runs.
    expect(somDoSistema("darwin", "23.4.0", true)).toBe("loopback")
    // Windows has no system picker.
    expect(somDoSistema("win32", "10.0.22631", true)).toBe("loopback")
  })

  it("o selector do sistema está desligado, e por isso o macOS 15+ tem som", () => {
    expect(USAR_SELECTOR_DO_SISTEMA).toBe(false)
    expect(somDoSistema("darwin", "25.5.0")).toBe("loopback")
  })

  it("Linux: não, e uma versão que não se lê também não", () => {
    expect(somDoSistema("linux", "6.8.0")).toBeNull()
    expect(somDoSistema("darwin", "")).toBeNull()
    expect(somDoSistema("darwin", "desconhecida")).toBeNull()
  })
})

describe("a escolha do som do sistema", () => {
  /*
    Owner request on 2/11/2026: "this doesn't need to be an option, audio is
    transmitted by default too". No checkbox anymore: system audio goes
    whenever the system provides it.
  */
  it("onde o sistema o dá, vai o loopback, sem caixa nenhuma a marcar", () => {
    expect(escolhaDoEcra({ id: "screen:0:0", nome: "Ecrã 1" }, "loopback")).toEqual({
      video: { id: "screen:0:0", name: "Ecrã 1" },
      audio: "loopback",
    })
    expect(escolhaDoEcra({ id: "window:12:0", nome: "Editor" }, "loopback")).toHaveProperty("audio", "loopback")
  })

  it("onde o sistema não o dá, vai só a imagem", () => {
    expect(escolhaDoEcra({ id: "screen:0:0", nome: "Ecrã 1" }, null)).toEqual({
      video: { id: "screen:0:0", name: "Ecrã 1" },
    })
  })

  it("uma interface antiga que mande som: false não cala o som", () => {
    const antiga: EscolhaDeEcra = { id: "screen:0:0", nome: "Ecrã 1", som: false }
    expect(escolhaDoEcra(antiga, "loopback")).toHaveProperty("audio", "loopback")
  })
})
