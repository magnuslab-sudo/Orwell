import { CRYPTOGRAPHIC_POWERS, IRREVERSIBLE_POWERS, PODERES_CUMPRIDOS, POWERS, type Power } from "@enclave/protocol"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { degrausDe, gruposDePermissoes, RolePowers } from "./RolePowers.js"

afterEach(cleanup)

/**
 * The three kinds of responsibility, and why there are three.
 *
 * The protocol asks two different questions and stores them in two lists:
 * `CRYPTOGRAPHIC_POWERS` asks what the cipher guarantees against an ALTERED
 * client, and `IRREVERSIBLE_POWERS` asks what does not undo for those who
 * COMPLY. The answers do not match, `expulsar` is in both, `eliminar` only in
 * the second, and from that mismatch comes the third tier.
 *
 * The interface read only the first list all the time the second one existed.
 * The result looked like this, on a role card:
 *
 *     App rule: end the channel, change the name.
 *
 * Two verbs in the same sentence, one that undoes the channel for everyone and
 * one that undoes by writing again.
 *
 * These tests do NOT write the list of powers by hand. They read it from the
 * protocol and check partition properties, total, no overlap, and each power
 * in the tier the protocol lists give it. A list written here would be a third
 * copy of the criterion to diverge from the other two, which is exactly the
 * flaw being fixed.
 */
describe("degrausDe — a partição das responsabilidades", () => {
  it("todo o poder cai num degrau, e nenhum cai em dois", () => {
    const { cifra, semVolta, combinado } = degrausDe(POWERS)
    const juntos = [...cifra, ...semVolta, ...combinado]

    expect(juntos.length).toBe(POWERS.length)
    expect(new Set(juntos).size).toBe(POWERS.length)
    // The order within each tier stays the order from `POWERS`, which is the order
    // in which responsibilities read on the screen.
    expect([...juntos].sort()).toEqual([...POWERS].sort())
  })

  it("o degrau da cifra é exactamente o que o protocolo diz que a cifra garante", () => {
    expect(degrausDe(POWERS).cifra).toEqual(POWERS.filter((poder) => CRYPTOGRAPHIC_POWERS.includes(poder)))
  })

  it("o degrau do meio é o que não tem volta e a cifra NÃO garante", () => {
    /*
      Without those from the cipher, and that is a choice not an omission:
      `expulsar` is in both protocol lists, and a power that appeared in two
      tiers would make the interface promise two things with one responsibility.
    */
    const esperado = POWERS.filter((poder) => IRREVERSIBLE_POWERS.includes(poder) && !CRYPTOGRAPHIC_POWERS.includes(poder))
    expect(degrausDe(POWERS).semVolta).toEqual(esperado)
    expect(degrausDe(POWERS).semVolta).not.toContain("expulsar")
  })

  it("e nada do que não tem volta sobra para o degrau das combinações leves", () => {
    // The regression, stated as a property: the lower tier is what UNDOES.
    for (const poder of degrausDe(POWERS).combinado) {
      expect(IRREVERSIBLE_POWERS).not.toContain(poder)
    }
  })

  it("hoje isso quer dizer: expulsar na cifra, eliminar sem volta, o resto leve", () => {
    /*
      Today's state, written out in full, because the properties above would
      pass with all three tiers empty. This is the concrete case the owner saw
      wrong on screen, and it is what must stay right.
    */
    // The ones this version offers (1.2: `PODERES_CUMPRIDOS`). `banir` comes with no undo, but is not yet offered.
    const { cifra, semVolta, combinado } = degrausDe(PODERES_CUMPRIDOS)
    expect(cifra).toEqual(["expulsar"])
    expect(semVolta).toEqual(["eliminar"])
    expect(combinado).toEqual([
      "convidar",
      "renomear",
      "mover",
      "fixar",
      "atender",
      "moderar",
      "gerircargos",
      "gerirsalas",
      "desligar",
      "mencionartodos",
    ])
    expect(degrausDe(POWERS).semVolta).toEqual(["eliminar", "banir"])
  })
})

describe("RolePowers — o que se lê num cartão de cargo", () => {
  it("acabar com o canal tem frase própria, e não vem colada a mudar o nome", () => {
    render(<RolePowers powers={["eliminar", "renomear"]} />)

    expect(screen.getByText("Definitivo: acabar com o canal.")).toBeTruthy()
    expect(screen.getByText("Regra da app: mudar o nome.")).toBeTruthy()
    // The old sentence, which put both in the same list.
    expect(screen.queryByText(/Regra da app: acabar com o canal/)).toBeNull()
  })

  it("expulsar continua a ser a única do lado da cifra", () => {
    render(<RolePowers powers={["expulsar", "eliminar", "mover"]} />)

    expect(screen.getByText("Garantido: expulsar.")).toBeTruthy()
    expect(screen.getByText("Definitivo: acabar com o canal.")).toBeTruthy()
    expect(screen.getByText("Regra da app: mover.")).toBeTruthy()
  })

  it("um cargo sem responsabilidades diz o que é, e não promete nada", () => {
    render(<RolePowers powers={[]} />)

    expect(screen.getByText("Só acesso ao canal.")).toBeTruthy()
    expect(screen.queryByText(/Garantido:/)).toBeNull()
    expect(screen.queryByText(/Definitivo:/)).toBeNull()
    expect(screen.queryByText(/Regra da app:/)).toBeNull()
  })

  it("um degrau vazio não deixa uma frase pendurada com nada dentro", () => {
    // "Permanent: ." was the result of drawing the line without asking if there
    // were powers in it, the kind of sentence you only discover in production.
    render(<RolePowers powers={["mover"]} />)

    expect(screen.queryByText(/Garantido:/)).toBeNull()
    expect(screen.queryByText(/Definitivo:/)).toBeNull()
    expect(screen.getByText("Regra da app: mover.")).toBeTruthy()
  })

  it("as três frases saem por ordem de peso: primeiro o que não se desfaz", () => {
    /*
      The order matters and is not the order from `POWERS`. Someone reading a
      card is deciding whether to give it to someone, and what changes the
      decision is what has no undo, not what reverses with the opposite gesture.
    */
    const { container } = render(<RolePowers powers={["expulsar", "eliminar", "mover"]} />)
    const lidas = [...container.querySelectorAll(".role-line")].map((linha) => linha.textContent)

    expect(lidas).toEqual([
      "Garantido: expulsar.",
      "Definitivo: acabar com o canal.",
      "Regra da app: mover.",
    ])
  })
})

/**
 * The groups of the "Permissions" section (27 October 2026, "just like in
 * Discord"). The partition must be total: a responsibility with no group is a
 * responsibility with no toggle, which was the silent flaw of `eliminar`.
 */
describe("gruposDePermissoes", () => {
  it("cada responsabilidade cai num grupo, e num só", () => {
    const grupos = gruposDePermissoes(POWERS)
    const todas = grupos.flatMap((cada) => cada.poderes)
    expect(todas).toHaveLength(POWERS.length)
    expect(new Set(todas).size).toBe(POWERS.length)
  })

  it("a cifra vem à cabeça, e o resto pelo assunto", () => {
    const grupos = gruposDePermissoes(PODERES_CUMPRIDOS)
    expect(grupos.map((cada) => cada.grupo)).toEqual(["cifra", "gerir", "membros", "mensagens", "voz"])
    expect(grupos[0]?.poderes).toEqual([...CRYPTOGRAPHIC_POWERS])
  })

  it('moderar (fase 3) e mencionartodos (@all) caem em "Mensagens", ao lado de fixar e atender', () => {
    const mensagens = gruposDePermissoes(POWERS).find((cada) => cada.grupo === "mensagens")
    expect(mensagens?.poderes).toEqual(["fixar", "atender", "moderar", "mencionartodos"])
  })

  it('uma responsabilidade que esta versão não sabe arrumar cai em "outras", e não desaparece', () => {
    const futura = "teletransporte" as Power
    const grupos = gruposDePermissoes([...PODERES_CUMPRIDOS, futura])
    expect(grupos.at(-1)).toEqual({ grupo: "outras", poderes: [futura] })
  })
})
