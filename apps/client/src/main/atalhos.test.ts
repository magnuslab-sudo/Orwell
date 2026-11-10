import { describe, expect, it, vi } from "vitest"
// The interface's rule, read from its place: main doesn't import it (doesn't load
// the interface), and this test is what ties them together.
import { combinacaoValida, teclaComum } from "../../../../packages/ui/src/lib/atalhosDeVoz.js"
import { aceleradorDe, criarAtalhosGlobais, lerPedido, pedeAcessibilidade, type PortaDeAtalhos } from "./atalhos.js"

/**
 * A double of `globalShortcut`, with system memory: what's registered and by whom.
 * `ocupadas` are keys that "another app" already has.
 */
function duplo(ocupadas: string[] = []): PortaDeAtalhos & {
  registadas: Map<string, () => void>
  suspenso: boolean
  carregar: (acelerador: string) => void
} {
  const registadas = new Map<string, () => void>()
  const porta = {
    registadas,
    suspenso: false,
    register: vi.fn((acelerador: string, aoCarregar: () => void) => {
      if (acelerador === "CommandOrControl+Rebenta") throw new Error("Error processing argument")
      if (ocupadas.includes(acelerador) || registadas.has(acelerador)) return false
      registadas.set(acelerador, aoCarregar)
      return true
    }),
    unregister: vi.fn((acelerador: string) => {
      registadas.delete(acelerador)
    }),
    setSuspended: vi.fn((sim: boolean) => {
      porta.suspenso = sim
    }),
    carregar: (acelerador: string) => {
      if (!porta.suspenso) registadas.get(acelerador)?.()
    },
  }
  return porta
}

function montar(opcoes: { ocupadas?: string[]; plataforma?: string; acessibilidade?: boolean } = {}) {
  const porta = duplo(opcoes.ocupadas)
  const accionados: string[] = []
  const atalhos = criarAtalhosGlobais({
    porta,
    plataforma: opcoes.plataforma ?? "darwin",
    temAcessibilidade: () => opcoes.acessibilidade ?? false,
    aoAccionar: (accao) => accionados.push(accao),
  })
  return { porta, accionados, atalhos }
}

describe("a combinação como acelerador do Electron", () => {
  it("traduz o Mod, as setas, as teclas de função e as de multimédia", () => {
    expect(aceleradorDe("Mod+Shift+M")).toBe("CommandOrControl+Shift+M")
    expect(aceleradorDe("Alt+ArrowUp")).toBe("Alt+Up")
    expect(aceleradorDe("F13")).toBe("F13")
    expect(aceleradorDe("F24")).toBe("F24")
    expect(aceleradorDe("`")).toBe("`")
    expect(aceleradorDe("MediaPlayPause")).toBe("MediaPlayPause")
    expect(aceleradorDe("MediaTrackNext")).toBe("MediaNextTrack")
    expect(aceleradorDe("AudioVolumeMute")).toBe("VolumeMute")
    expect(aceleradorDe("Alt+Space")).toBe("Alt+Space")
  })

  it("uma tecla comum sozinha nunca é global: não se rouba uma letra ao sistema", () => {
    for (const comum of ["M", "Shift+M", "7", "Space", "Shift+Space", "ArrowUp", "Home", "Ç"]) {
      expect(aceleradorDe(comum), comum).toBeNull()
    }
  })

  it("os botões do rato e o que o Electron não conhece ficam só com a janela", () => {
    expect(aceleradorDe("Mouse4")).toBeNull()
    expect(aceleradorDe("Mod+Mouse5")).toBeNull()
    expect(aceleradorDe("Mod+Ç")).toBeNull()
    expect(aceleradorDe("§")).toBeNull()
    expect(aceleradorDe("Lixo+M")).toBeNull()
    expect(aceleradorDe("")).toBeNull()
    expect(aceleradorDe("F".repeat(80))).toBeNull()
  })

  it("concorda com a interface: o que ela diz ser comum, o principal nunca regista", () => {
    const casos = ["M", "Shift+M", "Mod+M", "F13", "`", "Space", "Alt+Space", "ArrowLeft", "Alt+ArrowLeft", "9", "Mod+Shift+9", "MediaStop", "PageDown"]
    for (const caso of casos) {
      expect(combinacaoValida(caso), caso).toBe(true)
      if (teclaComum(caso)) expect(aceleradorDe(caso), caso).toBeNull()
      else expect(aceleradorDe(caso), caso).not.toBeNull()
    }
  })

  it("só as quatro teclas de multimédia pedem Acessibilidade, e só no macOS", () => {
    expect(pedeAcessibilidade("MediaPlayPause", "darwin")).toBe(true)
    expect(pedeAcessibilidade("MediaPlayPause", "win32")).toBe(false)
    expect(pedeAcessibilidade("VolumeMute", "darwin")).toBe(false)
    expect(pedeAcessibilidade("CommandOrControl+Shift+M", "darwin")).toBe(false)
  })
})

describe("o pedido do renderer, que não é de confiança", () => {
  it("só passam o microfone, o som e a overlay, em texto curto", () => {
    expect(lerPedido(null)).toBeNull()
    expect(lerPedido("Mod+M")).toBeNull()
    expect(lerPedido({ microfone: "F13", som: 7, camara: "F14" })).toEqual({ microfone: "F13", som: null, overlay: null })
    expect(lerPedido({ microfone: "x".repeat(65), som: "", overlay: "Alt+Shift+O" })).toEqual({
      microfone: null,
      som: null,
      overlay: "Alt+Shift+O",
    })
  })
})

describe("o registo dos globais", () => {
  it('o atalho da overlay de jogo regista-se como os outros, e carregar diz "overlay"', () => {
    const { porta, accionados, atalhos } = montar()
    const estado = atalhos.definir({ microfone: "Mod+Shift+M", som: null, overlay: "Alt+Shift+O" })
    expect(estado.globais).toEqual(["microfone", "overlay"])
    expect([...porta.registadas.keys()]).toContain("Alt+Shift+O")
    porta.carregar("Alt+Shift+O")
    expect(accionados).toEqual(["overlay"])
  })

  it("regista os dois, e carregar na tecla chama o comando", () => {
    const { porta, accionados, atalhos } = montar()
    const estado = atalhos.definir({ microfone: "Mod+Shift+M", som: "F13" })
    expect(estado).toEqual({ globais: ["microfone", "som"], soComAJanela: [], ocupados: [], faltaAcessibilidade: [] })
    expect([...porta.registadas.keys()]).toEqual(["CommandOrControl+Shift+M", "F13"])
    porta.carregar("F13")
    porta.carregar("CommandOrControl+Shift+M")
    expect(accionados).toEqual(["som", "microfone"])
  })

  it("`null` liberta tudo: fora da chamada a tecla volta às outras apps", () => {
    const { porta, atalhos } = montar()
    atalhos.definir({ microfone: "F13", som: "F14" })
    const estado = atalhos.definir(null)
    expect(estado.globais).toEqual([])
    expect(porta.registadas.size).toBe(0)
    expect(porta.unregister).toHaveBeenCalledWith("F13")
    expect(porta.unregister).toHaveBeenCalledWith("F14")
  })

  it("mudar a tecla a meio da chamada larga a antiga", () => {
    const { porta, atalhos } = montar()
    atalhos.definir({ microfone: "F13", som: null })
    atalhos.definir({ microfone: "F15", som: null })
    expect([...porta.registadas.keys()]).toEqual(["F15"])
  })

  it("`libertar` (renderer caído, app a sair) larga só o que é seu", () => {
    const { porta, atalhos } = montar()
    porta.registadas.set("F20", () => {})
    atalhos.definir({ microfone: "F13", som: null })
    atalhos.libertar()
    expect([...porta.registadas.keys()]).toEqual(["F20"])
  })

  it("uma tecla comum e um botão do rato ficam só com a janela, sem chegar ao sistema", () => {
    const { porta, atalhos } = montar()
    const estado = atalhos.definir({ microfone: "M", som: "Mouse4" })
    expect(estado.soComAJanela).toEqual(["microfone", "som"])
    expect(porta.register).not.toHaveBeenCalled()
  })

  it("a tecla que outra app já tem volta como ocupada", () => {
    const { atalhos } = montar({ ocupadas: ["F13"] })
    expect(atalhos.definir({ microfone: "F13", som: "F14" })).toEqual({
      globais: ["som"],
      soComAJanela: [],
      ocupados: ["microfone"],
      faltaAcessibilidade: [],
    })
  })

  it("a mesma tecla nos dois vai só para o primeiro", () => {
    const { atalhos } = montar()
    const estado = atalhos.definir({ microfone: "F13", som: "F13" })
    expect(estado.globais).toEqual(["microfone"])
    expect(estado.ocupados).toEqual(["som"])
  })

  it("um acelerador que o Electron recusa com excepção não parte o resto", () => {
    const { atalhos } = montar()
    const estado = atalhos.definir({ microfone: "Mod+Rebenta", som: "F14" })
    expect(estado.soComAJanela).toEqual(["microfone"])
    expect(estado.globais).toEqual(["som"])
  })

  it("no macOS sem Acessibilidade, a tecla de multimédia não se regista e diz-se porquê", () => {
    const { porta, atalhos } = montar({ plataforma: "darwin", acessibilidade: false })
    const estado = atalhos.definir({ microfone: "MediaPlayPause", som: "AudioVolumeMute" })
    expect(estado.faltaAcessibilidade).toEqual(["microfone"])
    expect(estado.globais).toEqual(["som"])
    expect(porta.registadas.has("MediaPlayPause")).toBe(false)
  })

  it("com Acessibilidade, ou fora do macOS, a tecla de multimédia regista-se", () => {
    expect(montar({ plataforma: "darwin", acessibilidade: true }).atalhos.definir({ microfone: "MediaPlayPause", som: null }).globais).toEqual(["microfone"])
    expect(montar({ plataforma: "win32" }).atalhos.definir({ microfone: "MediaPlayPause", som: null }).globais).toEqual(["microfone"])
  })

  it("suspender pára as teclas enquanto se grava uma nova, e retomar devolve-as", () => {
    const { porta, accionados, atalhos } = montar()
    atalhos.definir({ microfone: "F13", som: null })
    atalhos.suspender(true)
    porta.carregar("F13")
    expect(accionados).toEqual([])
    atalhos.suspender(false)
    porta.carregar("F13")
    expect(accionados).toEqual(["microfone"])
  })
})
