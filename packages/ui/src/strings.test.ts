import { describe, expect, it } from "vitest"
import { POWERS } from "@enclave/protocol"
import { definirLingua, strings, translateError, translatePairingError } from "./strings.js"

/**
 * An error on screen is two lines: the code on top ("Error 104") and the
 * sentence below. The line break comes from here, and CSS draws it
 * (`white-space: pre-line`). The code is what someone dictates over the phone
 * or pastes in a report.
 */
describe("translateError", () => {
  it("traduz os erros conhecidos do client-core, com o código à frente", () => {
    expect(translateError("vault is locked")).toBe("Erro 101\nO cofre está bloqueado.")
    expect(translateError("no vault to open")).toBe("Erro 102\nNão há cofre neste aparelho.")
    expect(translateError("vault holds no identity")).toBe("Erro 103\nO cofre não tem identidade.")
    expect(translateError("wrong passphrase, or the vault is damaged")).toBe(
      "Erro 104\nPalavra-passe errada. Se tens a certeza dela, os dados deste aparelho podem estar danificados.",
    )
    expect(translateError("could not reach the homeserver")).toBe("Erro 201\nNão foi possível contactar o servidor.")
    expect(translateError("this platform cannot protect a vault without a passphrase")).toBe(
      "Erro 109\nEste aparelho precisa de uma palavra-passe para proteger o cofre.",
    )
  })

  it("uma mensagem desconhecida é o 900: a frase fixa, e a mensagem em cru por baixo", () => {
    expect(translateError("something else entirely")).toBe("Erro 900\nAconteceu um erro que a app não conhece.\nsomething else entirely")
    // No message means no third line.
    expect(translateError("")).toBe("Erro 900\nAconteceu um erro que a app não conhece.")
  })

  it("a frase nunca passa de duas linhas curtas", () => {
    for (const mensagem of ["vault is locked", "vault storage is full", "this vault was written by a newer version of the app"]) {
      const linhas = translateError(mensagem).split("\n")
      expect(linhas).toHaveLength(2)
      expect(linhas[0]).toMatch(/^Erro \d{3}$/)
      expect(linhas[1]!.length).toBeLessThan(180)
    }
  })

  it("as frases com dados usam o cause, e sem ele dizem a versão geral", () => {
    expect(translateError("could not leave every channel, account kept", { canais: 3 })).toBe(
      "Erro 115\nNão foi possível sair de 3 canais. A conta não foi apagada. Verifica a ligação e tenta outra vez.",
    )
    expect(translateError("could not leave every channel, account kept", { canais: 1 })).toContain("sair de 1 canal.")
    expect(translateError("could not leave every channel, account kept")).toContain("sair de todos os canais.")

    expect(translateError("the room has the maximum of pinned messages", { max: 50 })).toBe(
      "Erro 330\nEsta sala já tem 50 mensagens fixas, o máximo. Desafixa uma primeiro.",
    )
    expect(translateError("the room has the maximum of pinned messages")).toBe(
      "Erro 330\nEsta sala já tem o máximo de mensagens fixas. Desafixa uma primeiro.",
    )

    expect(translateError("that role does not exist in this channel", { channel: "!c:x", role: "moderador" })).toBe(
      'Erro 313\nO papel "moderador" não existe neste canal.',
    )
    expect(translateError("that role does not exist in this channel")).toBe("Erro 313\nEsse papel não existe neste canal.")
  })

  it("um cause que não é objecto simples conta como nenhum", () => {
    const geral = "Erro 330\nEsta sala já tem o máximo de mensagens fixas. Desafixa uma primeiro."
    expect(translateError("the room has the maximum of pinned messages", new Error("x"))).toBe(geral)
    expect(translateError("the room has the maximum of pinned messages", "50")).toBe(geral)
    expect(translateError("the room has the maximum of pinned messages", null)).toBe(geral)
  })

  it("a frase nunca mostra o endereço que viaja no cause", () => {
    const endereco = "@ana7x2kq9:orwell.example"
    for (const chave of ["that person is already in this channel", "that person has no invite keys", "that person is not in this channel"]) {
      expect(translateError(chave, { address: endereco })).not.toContain("ana7x2kq9")
    }
  })

  it("em inglês as funções também respondem com e sem cause", () => {
    definirLingua("en")
    try {
      expect(translateError("could not leave every channel, account kept", { canais: 2 })).toBe(
        "Error 115\nCould not leave 2 channels. The account was not deleted. Check the connection and try again.",
      )
      expect(translateError("could not leave every channel, account kept")).toContain("Could not leave every channel.")
      expect(translateError("the room has the maximum of pinned messages", { max: 50 })).toContain("already has 50 pinned")
      expect(translateError("the room has the maximum of pinned messages")).toContain("the maximum of pinned messages")
      expect(translateError("that role does not exist in this channel", { role: "mod" })).toContain('The role "mod"')
      expect(translateError("that role does not exist in this channel")).toBe("Error 313\nThat role does not exist in this channel.")
    } finally {
      definirLingua("pt")
    }
  })

  it("o emparelhamento passa pela mesma tabela, pelo código do núcleo ou pela chave", () => {
    expect(translatePairingError("recusado:full")).toBe(
      "Erro 707\nJá se juntou outro aparelho a este código. Gera um novo no aparelho principal.",
    )
    expect(translatePairingError("fechado:peer-left")).toBe(translatePairingError("fechado:closed"))
    expect(translatePairingError("sem-chave-de-conta")).toBe(translateError("this device has no account key"))
    expect(translatePairingError("this server cannot pair devices")).toMatch(/^Erro 702\n/)
    expect(translatePairingError("razao-nova")).toBe("Erro 900\nAconteceu um erro que a app não conhece.\nrazao-nova")
  })
})

/**
 * The role editor with three tabs (owner request on October 27, 2026: "just
 * like Discord"). Each protocol responsibility must reach the screen with a
 * sentence in both languages: a switch without a sentence is a responsibility
 * given without knowing what it gives.
 */
describe("cargos — o texto do editor", () => {
  it("cada responsabilidade tem uma frase curta, em português e em inglês", () => {
    for (const lingua of ["pt", "en"] as const) {
      definirLingua(lingua)
      try {
        for (const poder of POWERS) {
          const frase = strings.cargos.powerHelp[poder]
          expect(frase, `${lingua}: ${poder}`).toBeTruthy()
          // STE100: short sentences. Two at most, and none long.
          for (const parte of frase!.split(". ")) expect(parte.split(" ").length).toBeLessThanOrEqual(20)
        }
      } finally {
        definirLingua("pt")
      }
    }
  })

  it("os grupos têm os nomes do Discord, nas duas línguas", () => {
    expect(strings.cargos.groups.gerir).toBe("Gerir canal")
    expect(strings.cargos.groups.membros).toBe("Membros")
    expect(strings.cargos.groups.mensagens).toBe("Mensagens")
    expect(strings.cargos.groups.voz).toBe("Voz")
    definirLingua("en")
    try {
      expect(strings.cargos.groups.gerir).toBe("Manage channel")
      expect(strings.cargos.tabPermissions).toBe("Permissions")
    } finally {
      definirLingua("pt")
    }
  })

  it("o aviso do cargo embutido diz como dar só uma parte (fase 3)", () => {
    expect(strings.cargos.adminWarning).toBe(
      "Este cargo tem tudo. Para dar só uma parte, cria um cargo novo e escolhe as permissões.",
    )
  })

  it("a contagem dos membros tem singular e plural, nas duas línguas", () => {
    expect(strings.cargos.membersCount(1)).toBe("1 membro")
    expect(strings.cargos.membersCount(3)).toBe("3 membros")
    definirLingua("en")
    try {
      expect(strings.cargos.membersCount(1)).toBe("1 member")
      expect(strings.cargos.membersCount(3)).toBe("3 members")
    } finally {
      definirLingua("pt")
    }
  })
})
