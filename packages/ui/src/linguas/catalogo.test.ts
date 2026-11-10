import { describe, expect, it } from "vitest"
import { en, errosEn } from "./en.js"
import { errosPt, pt } from "./pt.js"

/**
 * O que uma língua tem de cumprir para poder entrar aqui.
 *
 * A regra do desenho é que uma folha em falta cai para português. Isso é a
 * rede de segurança certa contra uma chave em cru no ecrã, e é também o que
 * torna FÁCIL a pior versão deste trabalho: uma folha metade numa língua e
 * metade noutra, que quem vê lê como avaria e não como tradução a meio.
 *
 * Por isso a completude é medida e não prometida. Uma língua que entre neste
 * ficheiro entra inteira, ou não entra.
 */

/** Uma folha: um texto, uma função ou um array. Objectos são caminho, não folha. */
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

/** Todo o texto que chega ao ecrã, com as funções montadas com uma amostra. */
function frasesVisiveis(catalogo: unknown): { caminho: string; frase: string }[] {
  const saida: { caminho: string; frase: string }[] = []
  const visitar = (valor: unknown, caminho: string): void => {
    if (typeof valor === "string") {
      saida.push({ caminho, frase: valor })
      return
    }
    if (typeof valor === "function") {
      // Os números não são decoração: muitas destas são de plural, e chamadas
      // só com texto caem sempre no mesmo ramo.
      for (const argumento of [" ", 0, 1, 2]) {
        try {
          const feita: unknown = (valor as (...args: unknown[]) => unknown)(argumento, argumento, argumento)
          if (typeof feita === "string") saida.push({ caminho, frase: feita })
        } catch {
          // Uma função que exige uma forma concreta de argumento.
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
    // Uma chave a mais é ou uma gralha, ou texto que ficou órfão depois de o
    // português mudar. Nos dois casos é código morto que ninguém volta a ler.
    const aMais = folhas(en, "").filter((caminho) => em(pt, caminho) === undefined)
    expect(aMais, `chaves inglesas sem par no português:\n${aMais.join("\n")}`).toEqual([])
  })

  it("os erros do núcleo estão traduzidos nos dois mapas", () => {
    const emFalta = Object.keys(errosPt).filter((chave) => errosEn[chave] === undefined)
    expect(emFalta, `erros sem frase inglesa:\n${emFalta.join("\n")}`).toEqual([])
  })

  it("uma folha do inglês nunca é uma função onde o português é texto", () => {
    // O compilador já o exige, mas isto apanha o caso que ele deixa passar: uma
    // função escrita como texto por engano, que compila e depois aparece no
    // ecrã com um `${}` por dentro.
    const trocadas = TODAS.filter((caminho) => typeof em(en, caminho) !== typeof em(pt, caminho))
    expect(trocadas, `folhas com feitio diferente do português:\n${trocadas.join("\n")}`).toEqual([])
  })
})

describe("as regras de escrita, nas duas línguas", () => {
  it("nenhum texto visível leva travessão", () => {
    // Regra da casa, e não gosto pessoal: a barra longa não entra em texto de
    // interface. Os comentários usam-na à vontade; o que chega ao ecrã não.
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
    // `${nome}` escrito dentro de aspas em vez de num template chega ao ecrã
    // tal e qual. Compila, passa despercebido, e é ridículo.
    const cruas = frasesVisiveis(en)
      .filter(({ frase }) => /\$\{/.test(frase))
      .map(({ caminho, frase }) => `${caminho}: ${frase.slice(0, 70)}`)
    expect(cruas, `marcadores por substituir:\n${cruas.join("\n")}`).toEqual([])
  })
})

/**
 * A hierarquia, em inglês, presa pelas mesmas razões que a portuguesa.
 *
 * ```
 * Channel   ← o grupo MLS. É o que a cifra protege.
 *  └ Category ← agrupa. Não tem existência criptográfica nenhuma.
 *     └ Room  ← de texto ou de voz.
 * ```
 *
 * O risco em inglês tem nome e é o Discord: lá, o grupo inteiro chama-se
 * "server". Aqui não pode: o servidor é outra coisa, é o homeserver, e é
 * precisamente a peça que este produto existe para manter ignorante. Chamar
 * "server" a um canal ensinava o modelo trocado a toda a gente que lesse a
 * interface, que foi exactamente o que aconteceu em português quando o canal
 * se chamou "espaço". Ver `terminologia.test.ts`.
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
      A palavra "server" é legítima e aparece: é o homeserver, e a interface
      fala dele por bem — "Could not reach the server", "whoever runs the
      server". O que não pode existir é a construção do Discord, em que se
      ENTRA num servidor ou se CRIA um.
    */
    const doDiscord = frasesVisiveis(en)
      .filter(({ frase }) => /\b(join|create|leave|delete)( a| the| this)? server\b/i.test(frase))
      .map(({ caminho, frase }) => `${caminho}: ${frase.slice(0, 70)}`)
    expect(doDiscord, `um canal chamado servidor:\n${doDiscord.join("\n")}`).toEqual([])
  })
})
