import { describe, expect, it } from "vitest"
import { en, errosEn } from "./en.js"
import { errosPt, pt } from "./pt.js"

/**
 * What a language must meet to get in here.
 *
 * The design rule is that a missing leaf falls back to Portuguese. That is the
 * right safety net against a raw key on screen, and it is also what makes the
 * worst version of this work EASY: a sheet half in one language and half in
 * another, which whoever sees it reads as a fault and not as a translation in
 * progress.
 *
 * So completeness is measured, not promised. A language that enters this file
 * enters whole, or not at all.
 */

/** A leaf: a text, a function or an array. Objects are a path, not a leaf. */
function folhas(valor: unknown, caminho: string): string[] {
  if (typeof valor === "string" || typeof valor === "function" || Array.isArray(valor)) return [caminho]
  if (valor && typeof valor === "object") {
    return Object.entries(valor).flatMap(([chave, dentro]) =>
      folhas(dentro, caminho ? `${caminho}.${chave}` : chave),
    )
  }
  return [caminho]
}

function em(objecto: unknown, caminho: string): unknown {
  let aqui: unknown = objecto
  for (const parte of caminho.split(".")) {
    if (!aqui || typeof aqui !== "object") return undefined
    aqui = (aqui as Record<string, unknown>)[parte]
  }
  return aqui
}

/** All the text that reaches the screen, with the functions called on a sample. */
function frasesVisiveis(catalogo: unknown): { caminho: string; frase: string }[] {
  const saida: { caminho: string; frase: string }[] = []
  const visitar = (valor: unknown, caminho: string): void => {
    if (typeof valor === "string") {
      saida.push({ caminho, frase: valor })
      return
    }
    if (typeof valor === "function") {
      // The numbers are not decoration: many of these are plurals, and calls
      // with text only always fall into the same branch.
      for (const argumento of [" ", 0, 1, 2]) {
        try {
          const feita: unknown = (valor as (...args: unknown[]) => unknown)(argumento, argumento, argumento)
          if (typeof feita === "string") saida.push({ caminho, frase: feita })
        } catch {
          // A function that requires a specific shape of argument.
        }
      }
      return
    }
    if (Array.isArray(valor)) {
      valor.forEach((item, i) => visitar(item, `${caminho}[${i}]`))
      return
    }
    if (valor && typeof valor === "object") {
      for (const [chave, dentro] of Object.entries(valor)) visitar(dentro, caminho ? `${caminho}.${chave}` : chave)
    }
  }
  visitar(catalogo, "")
  return saida
}

const TODAS = folhas(pt, "")

describe("o inglês está inteiro", () => {
  it("nenhuma folha do português fica sem contrapartida", () => {
    const emFalta = TODAS.filter((caminho) => em(en, caminho) === undefined)
    expect(
      emFalta,
      `folhas por traduzir (caem para português, e deixam o ecrã a meio):\n${emFalta.join("\n")}`,
    ).toEqual([])
  })

  it("e não diz nada que o português não diga", () => {
    // An extra key is either a typo, or text left orphaned after the
    // Portuguese changed. Either way it is dead code that nobody reads again.
    const aMais = folhas(en, "").filter((caminho) => em(pt, caminho) === undefined)
    expect(aMais, `chaves inglesas sem par no português:\n${aMais.join("\n")}`).toEqual([])
  })

  it("os erros do núcleo estão traduzidos nos dois mapas", () => {
    const emFalta = Object.keys(errosPt).filter((chave) => errosEn[chave] === undefined)
    expect(emFalta, `erros sem frase inglesa:\n${emFalta.join("\n")}`).toEqual([])
  })

  it("uma folha do inglês nunca é uma função onde o português é texto", () => {
    // The compiler already requires it, but this catches the case it lets through:
    // a function written as text by mistake, which compiles and then shows up on
    // screen with a `${}` inside.
    const trocadas = TODAS.filter((caminho) => typeof em(en, caminho) !== typeof em(pt, caminho))
    expect(trocadas, `folhas com feitio diferente do português:\n${trocadas.join("\n")}`).toEqual([])
  })
})

describe("as regras de escrita, nas duas línguas", () => {
  it("nenhum texto visível leva travessão", () => {
    // A house rule, not a personal taste: the em dash does not go into interface
    // text. Comments use it freely; what reaches the screen does not.
    for (const [nome, catalogo] of [
      ["pt", pt],
      ["en", en],
    ] as const) {
      const comTravessao = frasesVisiveis(catalogo)
        .filter(({ frase }) => frase.includes("—") || frase.includes("–"))
        .map(({ caminho, frase }) => `${caminho}: ${frase.slice(0, 70)}`)
      expect(comTravessao, `travessões no texto ${nome}:\n${comTravessao.join("\n")}`).toEqual([])
    }
  })

  it("e nenhuma frase inglesa fica com um marcador por substituir", () => {
    // `${nome}` written inside quotes instead of in a template reaches the screen
    // as is. It compiles, goes unnoticed, and is ridiculous.
    const cruas = frasesVisiveis(en)
      .filter(({ frase }) => /\$\{/.test(frase))
      .map(({ caminho, frase }) => `${caminho}: ${frase.slice(0, 70)}`)
    expect(cruas, `marcadores por substituir:\n${cruas.join("\n")}`).toEqual([])
  })
})

/**
 * The hierarchy, in English, pinned for the same reasons as the Portuguese one.
 *
 * ```
 * Channel   ← the MLS group. It is what the encryption protects.
 *  └ Category ← groups. It has no cryptographic existence at all.
 *     └ Room  ← text or voice.
 * ```
 *
 * The risk in English has a name, and it is Discord: there, the whole group is
 * called a "server". Here it cannot be: the server is something else, it is the
 * homeserver, and it is precisely the piece this product exists to keep
 * ignorant. Calling a channel a "server" would teach the wrong model to
 * everyone who read the interface, which is exactly what happened in
 * Portuguese when the channel was called "espaço". See `terminologia.test.ts`.
 */
describe("terminologia inglesa", () => {
  it("o que se larga e o que se elimina é o CANAL", () => {
    expect(en.menu?.leave).toBe("Leave the channel")
    expect(en.menu?.remove).toBe("Delete channel")
    expect(en.roomProperties?.title).toBe("Channel properties")
  })

  it("o que se cria dentro de um canal é uma SALA", () => {
    expect(en.newRoom?.title).toBe("New room")
    expect(en.newRoom?.created).toBe("Room created.")
    expect(en.menu?.newRoom).toBe("New room")
    expect(en.sidebar?.newRoom).toBe("New room")
    expect(en.menu?.closeRoom).toBe("Close room")
  })

  it("e o `+` do cabeçalho continua a criar um canal: são gestos diferentes", () => {
    expect(en.sidebar?.createRoom).toBe("Create channel")
    expect(en.sidebar?.newRoom).toBe("New room")
  })

  it('nenhuma frase inglesa chama "server" ao que se junta', () => {
    /*
      The word "server" is legitimate and does appear: it is the homeserver, and
      the interface talks about it on purpose: "Could not reach the server",
      "whoever runs the server". What cannot exist is the Discord construction,
      where you JOIN a server or CREATE one.
    */
    const doDiscord = frasesVisiveis(en)
      .filter(({ frase }) => /\b(join|create|leave|delete)( a| the| this)? server\b/i.test(frase))
      .map(({ caminho, frase }) => `${caminho}: ${frase.slice(0, 70)}`)
    expect(doDiscord, `um canal chamado servidor:\n${doDiscord.join("\n")}`).toEqual([])
  })
})
