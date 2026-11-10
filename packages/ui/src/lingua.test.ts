import { afterEach, describe, expect, it } from "vitest"
import {
  aoMudarLingua,
  CHAVE_DA_LINGUA,
  definirLingua,
  escolherLingua,
  guardarPreferencia,
  lerPreferencia,
  linguaActual,
  linguaNoEndereco,
  LINGUA_BASE,
  strings,
  translateError,
} from "./strings.js"

/**
 * The language: who chooses it, what happens when text is missing, and the
 * promise that tests in this suite depend on without ever writing it.
 *
 * That promise is the first assertion in the file: **with no one calling
 * anything, the language is Portuguese**. Two thousand seven hundred assertions
 * in this suite are written against Portuguese text, and none of them ask for
 * it. If detection started running on module load, jsdom, whose `navigator`
 * says "en-US", would make them all run against English overnight.
 */

// Each case leaves the language as it found it. Without this, the first test
// that switched to English would carry the rest along, and order would start to matter.
afterEach(() => {
  definirLingua(LINGUA_BASE)
  localStorage.removeItem(CHAVE_DA_LINGUA)
})

describe("a língua por omissão", () => {
  it("é o português, sem ninguém a pedir nada", () => {
    expect(linguaActual()).toBe("pt")
    expect(strings.menu.leave).toBe("Sair do canal")
  })

  it("e o `navigator` do jsdom não a muda, porque ninguém detectou nada", () => {
    // Proof from inside: here `navigator.language` IS English. The interface
    // speaks Portuguese anyway, because `arrancarLingua()` was not called.
    expect(navigator.language.startsWith("en")).toBe(true)
    expect(linguaActual()).toBe("pt")
  })
})

describe("escolherLingua — a ordem de quem manda", () => {
  it("o endereço ganha a tudo", () => {
    expect(escolherLingua({ doEndereco: "en", guardada: "pt", doSistema: ["pt-PT"] })).toBe("en")
  })

  it("depois do endereço, a escolha guardada", () => {
    expect(escolherLingua({ guardada: "en", doSistema: ["pt-PT"] })).toBe("en")
  })

  it('"auto" não é uma escolha: deixa passar para o sistema', () => {
    expect(escolherLingua({ guardada: "auto", doSistema: ["en-GB"] })).toBe("en")
  })

  it("o sistema lê-se POR ORDEM, e a segunda preferência conta", () => {
    // A French person with English as second choice picks English, not Portuguese
    // just because Portuguese is the base: what they wrote was that they prefer
    // English next.
    expect(escolherLingua({ doSistema: ["fr-FR", "en-GB", "pt-PT"] })).toBe("en")
  })

  it("uma etiqueta regional conta pela língua, não pela região", () => {
    expect(escolherLingua({ doSistema: ["pt-BR"] })).toBe("pt")
    expect(escolherLingua({ doSistema: ["en-US"] })).toBe("en")
    expect(escolherLingua({ doSistema: ["EN_gb"] })).toBe("en")
  })

  it("um sistema que só nomeia línguas que não existem aqui apanha inglês", () => {
    // 1.3.6: two users with the browser in German and French saw the
    // app only in Portuguese. Someone who speaks neither reads English better.
    expect(escolherLingua({ doSistema: ["de-DE"] })).toBe("en")
    expect(escolherLingua({ doSistema: ["fr-FR"] })).toBe("en")
    expect(escolherLingua({ doSistema: ["es-ES"] })).toBe("en")
    expect(escolherLingua({ doSistema: ["de-DE", "ja"] })).toBe("en")
    expect(escolherLingua({ guardada: "auto", doSistema: ["de-DE"] })).toBe("en")
    expect(escolherLingua({ doEndereco: "klingon", doSistema: ["de-DE"] })).toBe("en")
  })

  it("uma língua conhecida mais abaixo na lista ganha ao inglês de recurso", () => {
    expect(escolherLingua({ doSistema: ["de-DE", "pt-PT"] })).toBe("pt")
    expect(escolherLingua({ doSistema: ["fr", "en-GB"] })).toBe("en")
    expect(escolherLingua({ doSistema: ["pt-BR"] })).toBe("pt")
  })

  it("sem informação nenhuma do sistema, cai na base e não numa chave em cru", () => {
    expect(escolherLingua({ doSistema: [] })).toBe("pt")
    expect(escolherLingua({})).toBe("pt")
    expect(escolherLingua({ doEndereco: "klingon" })).toBe("pt")
    // Junk in the list is not information: it counts as empty.
    expect(escolherLingua({ doSistema: ["", "  "] })).toBe("pt")
  })
})

describe("o parâmetro do endereço — a porta por onde os guiões pedem", () => {
  it("lê-se de um endereço inteiro", () => {
    expect(linguaNoEndereco("http://127.0.0.1:5173/app/?lingua=pt")).toBe("pt")
    expect(linguaNoEndereco("http://127.0.0.1:5173/app/?lingua=en#/algures")).toBe("en")
  })

  it("e a ausência dele não é um erro", () => {
    expect(linguaNoEndereco("http://127.0.0.1:5173/app/")).toBeUndefined()
    expect(linguaNoEndereco("nada disto é um endereço")).toBeUndefined()
  })
})

describe("mudar de língua", () => {
  it("troca o texto todo de uma vez", () => {
    definirLingua("en")
    expect(strings.menu.leave).toBe("Leave the channel")
    expect(strings.sidebar.newRoom).toBe("New room")
    expect(strings.gate.create).toBe("Create account")
  })

  it("as funções continuam a montar-se, com a mesma assinatura", () => {
    definirLingua("en")
    expect(strings.sidebar.hiddenRooms(1)).toBe("1 hidden room")
    expect(strings.sidebar.hiddenRooms(4)).toBe("4 hidden rooms")
    expect(strings.memberRoles.title("Direcção")).toBe("Roles in Direcção")
  })

  it("e voltar atrás devolve o português, sem restos", () => {
    definirLingua("en")
    definirLingua("pt")
    expect(strings.menu.leave).toBe("Sair do canal")
    expect(strings.sidebar.hiddenRooms(4)).toBe("4 salas escondidas")
  })

  it("avisa quem estiver à escuta, e só quando muda mesmo", () => {
    let avisos = 0
    const largar = aoMudarLingua(() => (avisos += 1))
    definirLingua("en")
    expect(avisos).toBe(1)
    definirLingua("en")
    expect(avisos, "definir a mesma língua não é uma mudança").toBe(1)
    definirLingua("pt")
    expect(avisos).toBe(2)
    largar()
    definirLingua("en")
    expect(avisos, "quem largou deixa de ser avisado").toBe(2)
  })
})

describe("o que falta cai para português, e nunca para uma chave em cru", () => {
  it("uma língua sem uma folha usa a portuguesa dessa folha", () => {
    // Proved with an overlay of fake data instead of a hole in real English:
    // English is complete today, and a test that relied on it being incomplete
    // would die the day someone finished the translation.
    const junta = juntarComoOModulo({ menu: { leave: "Leave" } })
    expect(junta.menu.leave).toBe("Leave")
    expect(junta.menu.remove, "o que a sobreposição não diz fica em português").toBe("Eliminar canal")
  })

  it("e nenhuma folha do catálogo é indefinida em nenhuma das línguas", () => {
    for (const lingua of ["pt", "en"] as const) {
      definirLingua(lingua)
      const vazias = folhasVazias(strings, "")
      expect(vazias, `folhas sem texto em ${lingua}:\n${vazias.join("\n")}`).toEqual([])
    }
  })
})

describe("a escolha guardada", () => {
  it('sem nada escrito, é "auto"', () => {
    expect(lerPreferencia()).toBe("auto")
  })

  it("guarda-se e volta a ler-se", () => {
    guardarPreferencia("en")
    expect(lerPreferencia()).toBe("en")
    guardarPreferencia("auto")
    expect(lerPreferencia()).toBe("auto")
  })

  it("lixo lê-se como ausência, e não impede a aplicação de abrir", () => {
    localStorage.setItem(CHAVE_DA_LINGUA, "{isto não é uma língua}")
    expect(lerPreferencia()).toBe("auto")
  })

  it("um armazenamento que atira não leva a aplicação com ele", () => {
    const partido = {
      getItem(): string {
        throw new Error("bloqueado")
      },
      setItem(): void {
        throw new Error("bloqueado")
      },
    }
    expect(lerPreferencia(partido)).toBe("auto")
    expect(() => guardarPreferencia("en", partido)).not.toThrow()
  })
})

describe("translateError — o único recurso que não é o português", () => {
  it("em português, diz a frase portuguesa", () => {
    expect(translateError("vault is locked")).toBe("Erro 101\nO cofre está bloqueado.")
  })

  it("em inglês, diz a frase inglesa e não a portuguesa", () => {
    definirLingua("en")
    expect(translateError("vault is locked")).toBe("Error 101\nThe vault is locked.")
  })

  it("o que não conhece é o 900 na língua de quem lê, com a mensagem em cru por baixo", () => {
    expect(translateError("something else entirely")).toBe("Erro 900\nAconteceu um erro que a app não conhece.\nsomething else entirely")
    definirLingua("en")
    expect(translateError("something else entirely")).toBe("Error 900\nThe app does not know this error.\nsomething else entirely")
  })
})

describe('voltar a "automática" segue o mesmo sistema que o arranque', () => {
  it("na aplicação instalada, a lista do anfitrião, e não o `navigator`", async () => {
    const { arrancarLingua } = await import("./strings.js")
    const { aplicarEscolhaDeLingua } = await import("./hooks/useLingua.js")
    // The host (Electron) says Portuguese; the jsdom `navigator` says "en-US".
    expect(arrancarLingua({ doSistema: ["pt-PT"] })).toBe("pt")
    aplicarEscolhaDeLingua("en")
    expect(linguaActual()).toBe("en")
    aplicarEscolhaDeLingua("auto")
    expect(linguaActual()).toBe("pt")
  })
})

/* ------------------------------------------------------------------ ferramentas */

/** The same merge the module does, over a sample overlay. */
function juntarComoOModulo(porCima: Record<string, unknown>): typeof strings {
  const juntar = (base: unknown, cima: unknown): unknown => {
    if (cima === undefined) return base
    if (typeof cima === "function" || Array.isArray(cima)) return cima
    if (typeof base !== "object" || base === null || Array.isArray(base)) return cima
    if (typeof cima !== "object" || cima === null) return cima
    const saida: Record<string, unknown> = {}
    for (const [chave, valor] of Object.entries(base as Record<string, unknown>)) {
      saida[chave] = juntar(valor, (cima as Record<string, unknown>)[chave])
    }
    return saida
  }
  return juntar(strings, porCima) as typeof strings
}

/** Screens that would reach the display empty, another name for a raw key. */
function folhasVazias(valor: unknown, caminho: string): string[] {
  if (typeof valor === "string") return valor.length > 0 ? [] : [caminho]
  if (typeof valor === "function") return []
  if (Array.isArray(valor)) return valor.flatMap((item, i) => folhasVazias(item, `${caminho}[${i}]`))
  if (valor && typeof valor === "object") {
    return Object.entries(valor).flatMap(([chave, dentro]) =>
      folhasVazias(dentro, caminho ? `${caminho}.${chave}` : chave),
    )
  }
  return [caminho]
}
