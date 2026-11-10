import { describe, expect, it } from "vitest"
import { en, errosEn } from "./linguas/en.js"
import { errosPt, pt } from "./linguas/pt.js"
import { strings } from "./strings.js"

/**
 * The hierarchy, locked by tests because it broke once.
 *
 * ```
 * Canal        ← o grupo MLS. É o que a cifra protege. `channel` no código.
 *  └ Categoria ← agrupa. Não tem existência criptográfica nenhuma.
 *     └ Sala   ← de texto ou de voz. `room` no código.
 * ```
 *
 * The code always had this right, `channel` is the group, `room` is the division,  * and it was the INTERFACE that got out of line: it called the group a "space"
 * and the division a "channel", and from then on everyone who read the interface
 * learned the backwards model, including whoever wrote more interface.
 *
 * These tests do not check grammar. They check the decision rule: if the sentence
 * talks about the WHOLE GROUP (the cipher, what gets deleted from the vault, what
 * gets merged) it is channel; if it talks about a DIVISION of text or voice
 * inside it, it is room. Each case below was wrong or has neighbors that were.
 */
describe("terminologia — o que é canal", () => {
  it("importar fala da conta e dos aparelhos, e nunca de salas", () => {
    // The phrase stopped talking about the encryption (revision STE100 from
    // 20/10/2026): it states the effect on the person. The channel and room rule
    // still applies to it.
    expect(strings.settings.importReplacesDevice).toContain("passa a conta para este aparelho")
    expect(strings.settings.importReplacesDevice).not.toContain("salas")
  })

  it("o que o cofre guarda e se apaga são canais, não salas", () => {
    expect(strings.settings.destroyDetail).toContain("canais")
    expect(strings.settings.destroyDetail).not.toContain("salas")
  })

  it("sair e eliminar largam o grupo inteiro, e por isso são canal", () => {
    // "Forget channel" was here and followed the same rule: the action is about
    // the GROUP, with all rooms inside. It became two actions, leave, which is
    // about me, and delete, which is about the channel, and the word must stay
    // "channel" in both.
    expect(strings.menu.leave).toBe("Sair do canal")
    expect(strings.menu.remove).toBe("Eliminar canal")
  })

  it('as propriedades são do canal — era "do espaço", palavra fora do modelo', () => {
    expect(strings.roomProperties.title).toBe("Propriedades do canal")
  })

  it('nenhuma frase visível volta a chamar "espaço" a coisa nenhuma', () => {
    for (const linha of frasesVisiveis()) {
      expect(linha.toLowerCase()).not.toMatch(/\bespaços?\b/)
    }
  })
})

describe("terminologia — o que é sala", () => {
  it("o que se cria dentro de um canal é uma sala", () => {
    expect(strings.newRoom.title).toBe("Nova sala")
    expect(strings.newRoom.created).toBe("Sala criada.")
    expect(strings.newRoom.nameRequired).toContain("sala")
    expect(strings.menu.newRoom).toBe("Nova sala")
    expect(strings.sidebar.newRoom).toBe("Nova sala")
  })

  it("fechar e renomear são gestos sobre salas", () => {
    expect(strings.menu.closeRoom).toBe("Fechar sala")
    expect(strings.menu.renameRoomTitle).toContain("sala")
    expect(strings.rooms.closedDefault).toContain("a sala por omissão")
    expect(strings.rooms.removeAction).toBe("Eliminar sala")
  })

  it("uma categoria agrupa salas, e apagá-la solta salas", () => {
    expect(strings.rooms.categoryDeleted("Direcção", 3)).toContain("salas")
    expect(strings.rooms.categoryDeleted("Direcção", 1)).toContain("A sala")
    expect(strings.rooms.mergeCategoryConfirm("Arquivo", 2)).toContain("salas")
    expect(strings.rooms.categoryDeleted("Arquivo", 2)).toContain("salas")
  })

  it("o que se esconde por baixo de uma categoria dobrada são salas", () => {
    expect(strings.sidebar.hiddenRooms(1)).toBe("1 sala escondida")
    expect(strings.sidebar.hiddenRooms(4)).toBe("4 salas escondidas")
  })

  it("as salas de voz são salas — mover alguém é mudá-lo de sala", () => {
    expect(strings.sidebar.voiceCount(1)).toContain("sala")
    expect(strings.voiceMove.personTitle("Ana")).toContain("sala de voz")
    // Since 2/11/2026 move is send, like Discord: the phrase says what happened.
    expect(strings.voiceMove.moved("Ana", "Estúdio")).toBe("Ana moveu-te para Estúdio.")
  })

  it("o `+` do cabeçalho continua a criar um CANAL: são gestos diferentes", () => {
    // Proof that this is not a blind word swap. The two entries live in the same
    // sidebar and create things at different levels.
    expect(strings.sidebar.createRoom).toBe("Criar canal")
    expect(strings.sidebar.newRoom).toBe("Nova sala")
  })
})

/**
 * The boundary between the name of the PLACE and the name of the THING.
 *
 * On August 20, 2026 the rail began to read **Me · Communities · Feed ·
 * Friends**. The vocabulary DID NOT follow, and that is a deliberate choice,
 * not an oversight: the button names the app section, "channel" names the
 * encrypted group that gets created, left and deleted inside it. The full
 * reason is written in `linguas/pt.ts`, above `rail`.
 *
 * A boundary written in words alone falls apart by itself, and in both
 * directions: someone "tidies up" and starts calling the channel a community
 * everywhere, or someone "corrects" the rail back to Channels. The tests below
 * lock both doors, and they are why this decision can be minimal without being
 * fragile.
 *
 * They stay in this suite, not another, because they are exactly the same
 * matter as the tests above: what the UI TEACHES those who read it.
 */
describe("terminologia — o carril nomeia o sítio, o vocabulário nomeia a coisa", () => {
  it("os destinos chamam-se assim, e é o carril que os diz", () => {
    expect(strings.rail.profile).toBe("Eu")
    expect(strings.rail.chat).toBe("Comunidades")
    expect(strings.rail.social).toBe("Feed")
    expect(strings.rail.people).toBe("Amigos")
    expect(strings.rail.settings).toBe("Configurações")
  })

  it("a coluna que o botão abre repete o nome do botão, e não inventa outro", () => {
    // At 60px apart. Two names for the same destination at a glance's distance is
    // the cheapest way to teach the backwards model.
    expect(strings.sidebar.headerProfile).toBe(strings.rail.profile)
    expect(strings.sidebar.headerChat).toBe(strings.rail.chat)
    expect(strings.sidebar.headerSocial).toBe(strings.rail.social)
    expect(strings.sidebar.headerSettings).toBe(strings.rail.settings)
    // And the `h1` of the Friends destination, the third place the name appears.
    expect(strings.people.title).toBe(strings.rail.people)
  })

  it('"comunidade" é nome de destino e mais nada: no resto, a palavra é canal', () => {
    const fora = frasesComCaminho()
      .filter(({ caminho }) => !caminho.startsWith("rail.") && !caminho.startsWith("sidebar.header"))
      // The only exception, and it is the owner's text (3/11/2026): "the channel
      // Orwell, the community of all users". The phrase says channel for the group;
      // the community is the people in it.
      .filter(({ caminho }) => caminho !== "gate.canalOficial")
      .filter(({ frase }) => /\bcomunidades?\b/i.test(frase))
      .map(({ caminho, frase }) => `${caminho}: ${frase.slice(0, 70)}`)
    expect(
      fora,
      `"comunidade" fora do nome do destino. O grupo cifrado chama-se canal:\n${fora.join("\n")}`,
    ).toEqual([])
  })

  it("e o que se cria, se larga e se elimina lá dentro continua a ser um canal", () => {
    // Proof that the boundary has both sides. The `+` lives in the "Communities"
    // header and what it does is a channel: that is where you see it live.
    expect(strings.sidebar.createRoom).toBe("Criar canal")
    expect(strings.menu.leave).toBe("Sair do canal")
    expect(strings.menu.remove).toBe("Eliminar canal")
  })

  it("e o carril não importou a palavra que este produto recusa", () => {
    // "Communities" was chosen because it is not "Servers". The server here is the
    // homeserver, and it is the piece we want ignorant. See the `English
    // terminology` in `linguas/catalogo.test.ts`, which keeps the same on that
    // side.
    for (const nome of Object.values(strings.rail)) {
      if (typeof nome === "string") expect(nome.toLowerCase()).not.toMatch(/\bservidor(es)?\b/)
    }
  })
})

/** The same phrases, but with the path taken to get there. */
function frasesComCaminho(): { caminho: string; frase: string }[] {
  const saida: { caminho: string; frase: string }[] = []
  const visitar = (valor: unknown, caminho: string): void => {
    if (typeof valor === "string") {
      saida.push({ caminho, frase: valor })
      return
    }
    if (typeof valor === "function") {
      try {
        const feita: unknown = (valor as (...args: unknown[]) => unknown)("x", 2, ["x"])
        if (typeof feita === "string") saida.push({ caminho, frase: feita })
      } catch {
        // See the twin note in `frasesVisiveis`.
      }
      return
    }
    if (valor && typeof valor === "object") {
      for (const [chave, dentro] of Object.entries(valor)) {
        visitar(dentro, caminho ? `${caminho}.${chave}` : chave)
      }
    }
  }
  visitar(strings, "")
  return saida
}

/** Every phrase that reaches the screen, with functions called with an example. */
function frasesVisiveis(...catalogos: unknown[]): string[] {
  const saida: string[] = []
  const visitar = (valor: unknown): void => {
    if (typeof valor === "string") {
      saida.push(valor)
      return
    }
    if (typeof valor === "function") {
      // A phrase that builds still is a phrase. The arguments here are just to make
      // it exist: none of them inspect them.
      try {
        const feita: unknown = (valor as (...args: unknown[]) => unknown)("x", 2, ["x"])
        if (typeof feita === "string") saida.push(feita)
      } catch {
        // A phrase that does not build with these arguments is not tested here.
      }
      return
    }
    if (valor && typeof valor === "object") for (const dentro of Object.values(valor)) visitar(dentro)
  }
  for (const catalogo of catalogos.length > 0 ? catalogos : [strings]) visitar(catalogo)
  return saida
}

describe("terminologia — um termo por coisa (STE100)", () => {
  it('o programa chama-se "app" em todo o catálogo, e nunca "aplicação"', () => {
    expect(frasesVisiveis(pt, errosPt).filter((frase) => /aplicaç/i.test(frase))).toEqual([])
  })

  it('o inglês diz quem é, em vez de "whoever"', () => {
    expect(frasesVisiveis(en, errosEn).filter((frase) => /\bwhoever\b/i.test(frase))).toEqual([])
  })

  it("os erros falam do aparelho principal, e não do computador nem da chave da conta", () => {
    expect(frasesVisiveis(errosPt).filter((frase) => /computador|chave da conta/i.test(frase))).toEqual([])
    expect(frasesVisiveis(errosEn).filter((frase) => /\bcomputer\b|account key/i.test(frase))).toEqual([])
  })
})

describe("terminologia — mensagem privada", () => {
  /*
   * Owner request from October 27, 2026: "direct message" becomes "private
   * message" in everything users see. The code still says `directa`/`dm`; only
   * the text changed, and this test holds the text in place.
   */
  it('o que se vê diz "privada", em pt e em en', () => {
    expect(pt.people.directsTitle).toBe("Mensagens privadas")
    expect(pt.settings.somTipos.directa).toBe("Mensagem privada")
    expect(en.people?.directsTitle).toBe("Private messages")
    expect(en.settings?.somTipos?.directa).toBe("Private message")
  })

  it('nenhuma string visível volta a dizer "mensagem directa"', () => {
    const tudo = JSON.stringify([pt, en]).toLowerCase()
    expect(tudo).not.toMatch(/mensage(m|ns) directas?|direct messages?/)
  })
})
