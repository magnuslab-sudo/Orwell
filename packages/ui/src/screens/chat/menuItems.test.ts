import { describe, expect, it, vi } from "vitest"
import { strings } from "../../strings.js"
import {
  itensDaCategoria,
  itensDaPessoaEmVoz,
  itensDaPessoaNaChamada,
  itensDaSala,
  itensDoCanal,
  type SalaResumo,
} from "./menuItems.js"
import { itensDaPessoa } from "../profile/menuDaPessoa.js"

/**
 * The rule these tests exist to lock down: what the person cannot do DOES NOT
 * APPEAR. Never greyed, never fails after being chosen.
 *
 * A menu that offers what will be refused teaches the permission model wrong,  * and it is the same care that separates organization from enforcement
 * everywhere else in the product.
 */

const nada = {
  abrir: (): void => {},
  sairDaChamada: (): void => {},
  marcarLido: (): void => {},
  propriedades: (): void => {},
  novaSala: (): void => {},
  novaCategoria: (): void => {},
  convidar: (): void => {},
  sair: (): void => {},
  eliminar: (): void => {},
}

function espaco(over: Partial<Parameters<typeof itensDoCanal>[0]> = {}): string[] {
  return itensDoCanal({
    emChamada: false,
    porLer: false,
    podeOrganizar: false,
    podeConvidar: false,
    podeEliminar: false,
    ehFeed: false,
    accoes: nada,
    ...over,
  }).map((item) => item.label)
}

describe("menu do canal", () => {
  /**
   * A missing label makes no noise, and that is how this file let a bug pass
   * into production.
   *
   * The "add to channel" entry read `strings.menu.seat`, and the phrase had been
   * left in the `chat` catalog. The label was `undefined`, the entry appeared in
   * the menu with no word at all, and both assertions watching it turned green
   * both ways: `toContain(undefined)` hits when the list has an `undefined` in
   * it, and `not.toContain(undefined)` hits when it does not.
   *
   * So this guard is about the SHAPE, not about a key: no entry, in any
   * combination of rights, reaches the screen without a word that names it. A
   * new key wired wrong falls here without anyone thinking of it.
   */
  it("nenhuma entrada chega ao menu sem rótulo", () => {
    const casos = [
      {},
      { podeOrganizar: true },
      { podeConvidar: true },
      { podeEliminar: true },
      { emChamada: true },
      { porLer: true },
      { ehFeed: true },
      { podeOrganizar: true, podeConvidar: true, podeEliminar: true, emChamada: true, porLer: true },
    ]
    for (const caso of casos) {
      for (const label of espaco(caso)) {
        expect(label, `com ${JSON.stringify(caso)}`).toBeTypeOf("string")
        expect(String(label).trim(), `com ${JSON.stringify(caso)}`).not.toBe("")
      }
    }
  })

  it("não se entra em chamada a partir de um canal: entra-se numa sala de voz", () => {
    // A channel call ran in parallel to voice rooms and was invisible to whoever
    // was inside one, two people "in call" in the same channel, unable to hear
    // each other.
    const labels = espaco()
    expect(labels).not.toContain(strings.menu.joinCall)
    expect(labels).not.toContain(strings.menu.joinVideo)
  })


  it("quem não administra vê o que se usa, e nada do que se gere", () => {
    const labels = espaco()
    expect(labels).toContain(strings.menu.open)
    expect(labels).toContain(strings.menu.properties)
    expect(labels).not.toContain(strings.menu.newRoom)
    expect(labels).not.toContain(strings.menu.newCategory)
    expect(labels).not.toContain(strings.menu.invite)
  })

  it("cada responsabilidade traz a sua entrada, e só a sua", () => {
    expect(espaco({ podeConvidar: true })).toContain(strings.menu.invite)
    expect(espaco({ podeConvidar: true })).not.toContain(strings.menu.newRoom)
    expect(espaco({ podeOrganizar: true })).toContain(strings.menu.newRoom)
  })

  it("convidar é uma entrada só: a folha tem os três modos", () => {
    // There was "Invite someone" and "Add to channel", two doors to the same
    // right. The sheet this opens has address, link, and add now.
    const labels = espaco({ podeConvidar: true })
    expect(labels.filter((label) => label === strings.menu.invite)).toHaveLength(1)
    expect(espaco()).not.toContain(strings.menu.invite)
  })

  it("segue a ordem da casa: abrir, lido ‖ convidar ‖ arrumar ‖ sair, eliminar", () => {
    expect(
      espaco({ porLer: true, podeConvidar: true, podeOrganizar: true, podeEliminar: true }),
    ).toEqual([
      strings.menu.open,
      strings.menu.markRead,
      strings.menu.invite,
      strings.menu.newRoom,
      strings.menu.newCategory,
      strings.menu.properties,
      strings.menu.leave,
      strings.menu.remove,
    ])
  })

  /**
   * No entry in this menu is SILENT, and a test must say so.
   *
   * An entry once came to life reading a catalog key that did not exist, and
   * the menu drew a clickable line with no word in it at all. `undefined` does
   * not crash in JSX and writes nothing, and a `toContain(undefined)` over an
   * array that has it turns green because of the bug. This measures the whole
   * menu: a new entry without a phrase falls here on the day it is born.
   */
  it("nenhuma entrada chega ao ecrã sem palavras", () => {
    const todas = [
      ...espaco(),
      ...espaco({ podeConvidar: true, podeOrganizar: true, podeEliminar: true, emChamada: true, porLer: true }),
      ...espaco({ ehFeed: true }),
    ]
    expect(todas.length).toBeGreaterThan(0)
    for (const label of todas) {
      expect(typeof label, `entrada sem frase no menu do canal: ${String(label)}`).toBe("string")
      expect(label.trim()).not.toBe("")
    }
  })

  it("sair da chamada só existe quando se está nela", () => {
    expect(espaco()).not.toContain(strings.menu.leaveCall)
    expect(espaco({ emChamada: true })).toContain(strings.menu.leaveCall)
  })

  it("marcar como lido só existe quando há alguma coisa por ler", () => {
    expect(espaco()).not.toContain(strings.menu.markRead)
    expect(espaco({ porLer: true })).toContain(strings.menu.markRead)
  })

  it("o canal do próprio feed não se larga: parti-lo era silencioso", () => {
    expect(espaco()).toContain(strings.menu.leave)
    expect(espaco({ ehFeed: true })).not.toContain(strings.menu.leave)
  })

  /**
   * Leaving and deleting are different gestures, and the difference is
   * everything.
   *
   * Leaving is about me: I drop the channel from this device and nobody else
   * notices. Deleting is about the channel: you publish a tombstone that honest
   * clients obey, and it ends for everyone. Having the second can never make the
   * first disappear, whoever runs it also has the right to walk away without
   * tearing down what stays.
   */
  it("quem não administra tem por onde sair, e não vê eliminar", () => {
    const labels = espaco()
    expect(labels).toContain(strings.menu.leave)
    expect(labels).not.toContain(strings.menu.remove)
  })

  it("quem pode eliminar continua a poder sair: são gestos diferentes", () => {
    const labels = espaco({ podeEliminar: true })
    expect(labels).toContain(strings.menu.leave)
    expect(labels).toContain(strings.menu.remove)
  })

  it("eliminar não vem agarrado a arrumar nem a gerir papéis", () => {
    // The right is its own (`eliminar`, in the protocol). Without it it does not
    // appear, no matter how much power the person has in everything else.
    expect(espaco({ podeOrganizar: true, podeConvidar: true })).not.toContain(strings.menu.remove)
  })

  it("o canal do próprio feed não se elimina, tenha-se a responsabilidade ou não", () => {
    // It is worth the same or more than leaving: deleting carries the posts of
    // whoever has it, and carries them to everyone.
    expect(espaco({ podeEliminar: true, ehFeed: true })).not.toContain(strings.menu.remove)
  })


  it("eliminar é a última entrada, e pinta-se de vermelho", () => {
    const itens = itensDoCanal({
      emChamada: false,
      porLer: false,
      podeOrganizar: false,
      podeConvidar: false,
      podeEliminar: true,
      ehFeed: false,
      accoes: nada,
    })
    const ultimo = itens[itens.length - 1]
    expect(ultimo?.label).toBe(strings.menu.remove)
    expect(ultimo?.destructive).toBe(true)
  })

  it("cada entrada chama a sua acção, e não a do lado", () => {
    // Leaving and deleting sit next to each other at the end of the menu.
    // Swapping them would destroy a channel for someone who just wanted to leave.
    const sair = vi.fn()
    const eliminar = vi.fn()
    const itens = itensDoCanal({
      emChamada: false,
      porLer: false,
      podeOrganizar: false,
      podeConvidar: false,
      podeEliminar: true,
      ehFeed: false,
      accoes: { ...nada, sair, eliminar },
    })
    itens.find((item) => item.label === strings.menu.leave)?.onSelect()
    expect(sair).toHaveBeenCalledOnce()
    expect(eliminar).not.toHaveBeenCalled()
    itens.find((item) => item.label === strings.menu.remove)?.onSelect()
    expect(eliminar).toHaveBeenCalledOnce()
  })
})

/**
 * What the warnings say, which is the part of this gesture you cannot get
 * wrong.
 *
 * Deleting a channel publishes a tombstone (`space.removed`). Each member's app
 * obeys it with `forgetChannel`, which erases the channel's history in the
 * vault. An altered app can ignore it and keep everything. The warning says
 * both things, and never promises the messages disappear from everywhere.
 */
describe("o que se diz antes de eliminar", () => {
  it("o aviso diz o que acontece e o que não acontece", () => {
    // The name goes in the title, the rest in the body: "Confirm" shows both.
    const aviso = `${strings.chat.removeChannelTitle("Direcção")} ${strings.chat.removeChannelConfirm}`
    expect(aviso).toContain("Direcção")
    expect(aviso).toContain("A app de cada membro apaga as mensagens do canal")
    expect(aviso).toContain("uma app alterada pode guardá-las")
    expect(aviso).toContain("Não podes desfazer isto")
  })

  it("o aviso não promete que as mensagens desaparecem de lado nenhum", () => {
    // The name goes in the title, the rest in the body: "Confirm" shows both.
    const aviso = `${strings.chat.removeChannelTitle("Direcção")} ${strings.chat.removeChannelConfirm}`
    expect(aviso).not.toMatch(/apaga tudo|apagadas para (toda a gente|sempre)/)
  })

  it("sair continua a dizer a verdade: é deste aparelho, e os outros continuam a ver-nos", () => {
    expect(strings.chat.leaveOffline).toMatch(/aparelho|dispositivo/)
    expect(strings.chat.leaveOffline).toContain("continuam")
  })
})

describe("menu de uma sala do canal", () => {
  const texto: SalaResumo = { room: "r1", name: "avisos", kind: "text" }
  const voz: SalaResumo = { room: "v1", name: "Estúdio", kind: "voice" }

  it("num canal de voz, abrir chama-se entrar — que é o que clicar faz", () => {
    expect(itensDaSala({ sala: voz, podeOrganizar: false, accoes: { abrir: () => {}, renomear: () => {}, fechar: () => {} } })[0]?.label).toBe(
      strings.menu.joinRoom,
    )
    expect(itensDaSala({ sala: texto, podeOrganizar: false, accoes: { abrir: () => {}, renomear: () => {}, fechar: () => {} } })[0]?.label).toBe(
      strings.menu.open,
    )
  })

  it("quem não pode organizar abre, e mais nada", () => {
    const labels = itensDaSala({
      sala: texto,
      podeOrganizar: false,
      accoes: { abrir: () => {}, renomear: () => {}, fechar: () => {} },
    }).map((item) => item.label)
    expect(labels).toEqual([strings.menu.open])
  })

  it("a sala por omissão deixou de ser excepção: muda de nome e fecha-se", () => {
    // Where conversations from before rooms existed still live. Closing a room hides it without deleting anything. See `useRooms` and `strings.rooms`.
    const labels = itensDaSala({
      sala: { room: "", name: "geral", kind: "text" },
      podeOrganizar: true,
      accoes: { abrir: () => {}, renomear: () => {}, fechar: () => {} },
    }).map((item) => item.label)
    expect(labels).toEqual([strings.menu.open, strings.menu.renameRoom, strings.menu.closeRoom])
  })

  it("quem organiza muda o nome e fecha", () => {
    const labels = itensDaSala({
      sala: texto,
      podeOrganizar: true,
      accoes: { abrir: () => {}, renomear: () => {}, fechar: () => {} },
    }).map((item) => item.label)
    expect(labels).toEqual([strings.menu.open, strings.menu.renameRoom, strings.menu.closeRoom])
  })
})

/**
 * The context menu for a member in a voice room.
 *
 * It used to be just a list with one entry: "Move to". The whole menu was hidden from anyone without the "move" permission, so right-clicking a name did nothing. Now it's the MEMBER menu with move destinations added. The challenge is drawing the line between these two concerns.
 */
describe("menu de quem está numa sala de voz", () => {
  const salas: SalaResumo[] = [
    { room: "v1", name: "Balcão", kind: "voice" },
    { room: "v2", name: "Estúdio", kind: "voice" },
  ]

  const accoesDaPessoa = {
    verPerfil: (): void => {},
    copiarEndereco: (): void => {},
    mensagem: (): void => {},
    chamada: (): void => {},
    pedirAmizade: (): void => {},
    aceitarAmizade: (): void => {},
    desfazerAmizade: (): void => {},
    convidarParaCanal: (): void => {},
    alternarAdministrador: (): void => {},
    expulsar: (): void => {},
  }

  function alguem(over: Partial<Parameters<typeof itensDaPessoa>[0]> = {}): Parameters<typeof itensDaPessoa>[0] {
    return {
      ehEuProprio: false,
      ehAmigo: false,
      canal: "!c:s",
      canalAdmiteAdministracao: false,
      podeGerirPapeis: false,
      ehFundador: false,
      jaEhAdministrador: false,
      accoes: accoesDaPessoa,
      ...over,
    }
  }

  function menu(over: Partial<Parameters<typeof itensDaPessoaEmVoz>[0]> = {}): ReturnType<typeof itensDaPessoaEmVoz> {
    return itensDaPessoaEmVoz({
      pessoa: alguem(),
      podeMover: true,
      salaActual: "v1",
      salasDeVoz: salas,
      mover: () => {},
      ...over,
    })
  }

  it("sem a responsabilidade de mover, continua a haver o menu da pessoa", () => {
    // The bug this fixes: right-clicking did nothing for users who cannot move anyone, which is most people in a channel.
    const labels = menu({ podeMover: false }).map((item) => item.label)
    expect(labels).toEqual(itensDaPessoa(alguem()).map((item) => item.label))
    expect(labels.length).toBeGreaterThan(0)
  })

  it("é o mesmo menu da pessoa, e não uma segunda lista a dizer o mesmo", () => {
    // Two lists of the same thing drift apart on the first change, and one silently falls behind. The issue is REUSE, not the labels.
    const labels = menu().map((item) => item.label)
    for (const item of itensDaPessoa(alguem())) expect(labels).toContain(item.label)
  })

  /** The rooms in the "Move to" hierarchy, with each one's label. */
  const escadaDe = (itens: ReturnType<typeof itensDaPessoaEmVoz>): { label: string; section?: string | undefined }[] =>
    (itens.find((item) => item.label === strings.voiceMove.menu)?.submenu ?? []).map((item) => ({
      label: item.label,
      section: item.section,
    }))

  /**
   * One "Move to" entry and rooms in a list (2/11/2026, owner request: "in the menu I don't want a name for each room where I can move the user").
   */
  it('há uma só entrada "Mover para", e nenhuma linha por sala no menu da pessoa', () => {
    const tres = [...salas, { room: "v3", name: "Régie", kind: "voice" } as SalaResumo]
    const itens = menu({ salasDeVoz: tres })
    expect(itens.filter((item) => item.label === strings.voiceMove.menu)).toHaveLength(1)
    expect(itens.some((item) => item.label === "Estúdio" || item.label.startsWith("Mover para "))).toBe(false)
  })

  it("a escada tem as outras salas de voz, nunca aquela onde a pessoa já está", () => {
    const labels = escadaDe(menu()).map((item) => item.label)
    expect(labels).toEqual(["Estúdio"])
  })

  it("escolher uma sala na escada move para essa sala", () => {
    const mover = vi.fn()
    const escada = menu({ mover }).find((item) => item.label === strings.voiceMove.menu)?.submenu ?? []
    escada.find((item) => item.label === "Estúdio")?.onSelect()
    expect(mover).toHaveBeenCalledWith("v2")
  })

  it("as salas agrupam-se por categoria, pela ordem da barra lateral, e as sem categoria vêm no fim", () => {
    const comCategorias: SalaResumo[] = [
      { room: "v1", name: "Balcão", kind: "voice", category: "Produção" },
      { room: "v2", name: "Estúdio", kind: "voice", category: "Produção" },
      { room: "v3", name: "Régie", kind: "voice", category: "Produção" },
      { room: "v4", name: "Jogos", kind: "voice", category: "Lazer" },
      { room: "v5", name: "voz", kind: "voice", category: "" },
    ]
    expect(escadaDe(menu({ salasDeVoz: comCategorias }))).toEqual([
      { label: "Estúdio", section: "Produção" },
      { label: "Régie", section: undefined },
      { label: "Jogos", section: "Lazer" },
      { label: "voz", section: strings.voiceMove.noCategory },
    ])
  })

  it("sem categoria nenhuma, a escada não leva letreiros", () => {
    expect(escadaDe(menu()).every((item) => item.section === undefined)).toBe(true)
  })

  it('sem outra sala de voz para onde ir, "Mover para" não aparece', () => {
    // A voice room is the normal case for nearly all channels. What leads nowhere is not offered, and the member menu stays intact.
    const labels = menu({ salasDeVoz: [salas[0] as SalaResumo] }).map((item) => item.label)
    expect(labels).toEqual(itensDaPessoa(alguem()).map((item) => item.label))
  })

  it("a si próprio não se oferece mover nem desligar: isso é entrar noutra sala, ou sair", () => {
    // The core rejects it, and we don't offer it here. For the member's own name, the menu stays at profile and address, which is what `itensDaPessoa` returns.
    const labels = menu({ pessoa: alguem({ ehEuProprio: true }), desligar: () => {} }).map((item) => item.label)
    expect(labels).toEqual(itensDaPessoa(alguem({ ehEuProprio: true })).map((item) => item.label))
    expect(labels).not.toContain(strings.voiceMove.menu)
    expect(labels).not.toContain(strings.voiceMove.disconnect)
  })

  it('"Mover para" vem depois da pessoa, e separado dela', () => {
    // What you do to the member and what you do to their call are different things, and the label says which.
    const itens = menu()
    const entrada = itens.findIndex((item) => item.label === strings.voiceMove.menu)
    expect(entrada).toBe(itens.length - 1)
    expect(itens[entrada]?.separatorBefore).toBe(true)
  })

  it('"Desligar da chamada" vem logo a seguir a "Mover para", com o mesmo poder', () => {
    const desligar = vi.fn()
    const itens = menu({ desligar })
    const entrada = itens.findIndex((item) => item.label === strings.voiceMove.menu)
    expect(itens[entrada + 1]?.label).toBe(strings.voiceMove.disconnect)
    itens[entrada + 1]?.onSelect()
    expect(desligar).toHaveBeenCalled()
    // Without "move", neither.
    const sem = menu({ desligar, podeMover: false }).map((item) => item.label)
    expect(sem).not.toContain(strings.voiceMove.disconnect)
    expect(sem).not.toContain(strings.voiceMove.menu)
  })

  it("com uma sala de voz só, desligar continua a poder fazer-se", () => {
    const labels = menu({ salasDeVoz: [salas[0] as SalaResumo], desligar: () => {} }).map((item) => item.label)
    expect(labels).not.toContain(strings.voiceMove.menu)
    expect(labels).toContain(strings.voiceMove.disconnect)
  })

  it('"Mover para" vem antes de expulsar, que fecha sempre o menu', () => {
    // House rule: the only irreversible action is always the last one.
    const itens = menu({
      pessoa: alguem({ canalAdmiteAdministracao: true, podeExpulsar: true }),
    })
    const destino = itens.findIndex((item) => item.label === strings.voiceMove.menu)
    const expulsar = itens.findIndex((item) => item.label === strings.userMenu.expel)
    expect(destino).toBeGreaterThan(-1)
    expect(expulsar).toBe(itens.length - 1)
    expect(destino).toBeLessThan(expulsar)
  })

  it("sem destinos não há letreiro a anunciar um bloco que não existe", () => {
    const itens = menu({ salasDeVoz: [salas[0] as SalaResumo] })
    expect(itens.every((item) => item.section === undefined)).toBe(true)
  })
})

/**
 * The menu for a category, which is the menu for something that doesn't exist.
 *
 * The category is not stored anywhere: it's the name written in the `category` field of the channels that declare it. What these tests check is how we read it and how easily we lose sight of it. Deleting the label doesn't delete what it labels.
 */
/**
 * The member menu on call cards (phase 3): the same as in the voice room, with the call block (mute for me, volume) after the address.
 */
describe("menu de quem está numa chamada", () => {
  const nada = (): void => {}
  const pessoa = (over: Partial<Parameters<typeof itensDaPessoa>[0]> = {}): Parameters<typeof itensDaPessoa>[0] => ({
    ehEuProprio: false,
    ehAmigo: true,
    canal: "!c:s",
    canalAdmiteAdministracao: true,
    podeGerirPapeis: false,
    ehFundador: false,
    jaEhAdministrador: false,
    accoes: {
      verPerfil: nada,
      copiarEndereco: nada,
      mensagem: nada,
      chamada: nada,
      pedirAmizade: nada,
      aceitarAmizade: nada,
      desfazerAmizade: nada,
      convidarParaCanal: nada,
      alternarAdministrador: nada,
      expulsar: nada,
    },
    ...over,
  })
  const menu = (
    over: Partial<Parameters<typeof itensDaPessoaNaChamada>[0]> = {},
  ): ReturnType<typeof itensDaPessoaNaChamada> =>
    itensDaPessoaNaChamada({
      pessoa: pessoa(),
      podeMover: false,
      salaActual: "v1",
      salasDeVoz: [
        { room: "v1", name: "Balcão", kind: "voice" },
        { room: "v2", name: "Estúdio", kind: "voice" },
      ],
      mover: nada,
      nome: "Ana",
      volume: 1,
      definirVolume: nada,
      ...over,
    })

  it("é o menu da sala de voz, com o bloco da chamada logo a seguir ao endereço", () => {
    const labels = menu().map((item) => item.label)
    const daVoz = itensDaPessoaEmVoz({ pessoa: pessoa(), podeMover: false, salaActual: "v1", salasDeVoz: [], mover: nada }).map(
      (item) => item.label,
    )
    for (const label of daVoz) expect(labels).toContain(label)
    expect(labels.slice(0, 4)).toEqual([
      strings.userMenu.profile,
      strings.social.copyAuthor,
      strings.call.menuSilence,
      strings.call.menuVolume,
    ])
    expect(labels).toContain(strings.userMenu.dm)
  })

  /*
    Owner request on November 2, 2026: "instead of fixed levels 25, 50, 100, 150, 200, I want a volume slider". One entry, one slider from 0 to 200%, no fixed levels.
    */
  it("o volume é uma barra de 0 a 200 %, de 5 em 5, e não uma fila de níveis", () => {
    const itens = menu({ volume: 1.5 })
    const comBarra = itens.filter((item) => item.deslizante)
    expect(comBarra).toHaveLength(1)
    const barra = comBarra[0]?.deslizante
    expect(barra).toMatchObject({ valor: 150, min: 0, max: 200, passo: 5, normal: 100 })
    expect(barra?.ariaLabel).toBe(strings.call.volumeOf("Ana"))
    expect(barra?.textoDoValor(150)).toBe(strings.call.menuVolumeValor(150))
    // No old "Volume 150%" entry sits next to the slider.
    expect(itens.filter((item) => /\d+ %/.test(item.label))).toHaveLength(0)
  })

  it("a barra grava no formato de sempre: 150 % é 1,5, e o normal repõe 1", () => {
    const definirVolume = vi.fn()
    const barra = menu({ definirVolume }).find((item) => item.deslizante)
    barra?.deslizante?.aoMudar(35)
    expect(definirVolume).toHaveBeenLastCalledWith(0.35)
    barra?.deslizante?.aoMudar(200)
    expect(definirVolume).toHaveBeenLastCalledWith(2)
    // Tapping the entry resets to normal.
    barra?.onSelect()
    expect(definirVolume).toHaveBeenLastCalledWith(1)
  })

  it("um valor guardado fora da grelha de 5 desenha-se arredondado", () => {
    // Saved values (0.5, 1.5, or the card's slider) still read back.
    expect(menu({ volume: 0.333 }).find((item) => item.deslizante)?.deslizante?.valor).toBe(33)
  })

  it("silenciar para mim põe o volume a zero, e voltar a ouvir põe os 100%", () => {
    const definirVolume = vi.fn()
    menu({ definirVolume }).find((item) => item.label === strings.call.menuSilence)?.onSelect()
    expect(definirVolume).toHaveBeenCalledWith(0)
    const voltar = menu({ volume: 0, definirVolume }).find((item) => item.label === strings.call.menuUnsilence)
    voltar?.onSelect()
    expect(definirVolume).toHaveBeenLastCalledWith(1)
  })

  it("com poder, mover para, desligar e expulsar; sem poder, nenhum dos três", () => {
    const sem = menu({ desligar: nada }).map((item) => item.label)
    expect(sem).not.toContain(strings.voiceMove.menu)
    expect(sem).not.toContain(strings.voiceMove.disconnect)
    expect(sem).not.toContain(strings.userMenu.expel)
    const com = menu({ podeMover: true, desligar: nada, pessoa: pessoa({ podeExpulsar: true }) }).map((item) => item.label)
    expect(com).toContain(strings.voiceMove.menu)
    expect(com).toContain(strings.voiceMove.disconnect)
    expect(com.at(-1)).toBe(strings.userMenu.expel)
  })

  it("sobre mim mesmo não há volume", () => {
    const labels = menu({ pessoa: pessoa({ ehEuProprio: true }) }).map((item) => item.label)
    expect(labels).not.toContain(strings.call.menuSilence)
  })
})

describe("itensDaCategoria", () => {
  const accoes = { renomear: () => {}, apagar: () => {} }

  it("sem a responsabilidade de organizar, não há menu nenhum", () => {
    // Not grayed out, not broken after choosing: it does not appear.
    expect(itensDaCategoria({ podeOrganizar: false, accoes })).toEqual([])
  })

  it("com ela, oferece mudar o nome e apagar", () => {
    const itens = itensDaCategoria({ podeOrganizar: true, accoes })
    expect(itens.map((item) => item.label)).toEqual([strings.menu.renameCategory, strings.menu.deleteCategory])
  })

  it('sem onde a escolha ficar, "quem vê" não aparece', () => {
    // The entry depends on `setCategory` above: a host who cannot declare categories has nowhere to save the choice. House rule handles it by absence, not by graying out. An entry that opens a sheet that posts nothing is worse than no entry.
    const itens = itensDaCategoria({ podeOrganizar: true, accoes })
    expect(itens.map((item) => item.label)).not.toContain(strings.menu.categoryVisibility)
  })

  it('com onde ficar, "quem vê" aparece entre mudar o nome e apagar', () => {
    const itens = itensDaCategoria({ podeOrganizar: true, accoes: { ...accoes, visibilidade: () => {} } })
    expect(itens.map((item) => item.label)).toEqual([
      strings.menu.renameCategory,
      strings.menu.categoryVisibility,
      strings.menu.deleteCategory,
    ])
  })

  it('"quem vê" chama a sua acção e não se pinta de vermelho', () => {
    // Hiding cleans up the list without destroying anything. See `categoryProperties.note`.
    const visibilidade = vi.fn()
    const itens = itensDaCategoria({ podeOrganizar: true, accoes: { ...accoes, visibilidade } })
    const entrada = itens.find((item) => item.label === strings.menu.categoryVisibility)
    entrada?.onSelect()
    expect(visibilidade).toHaveBeenCalledOnce()
    expect(entrada?.destructive).not.toBe(true)
  })

  it('sem a responsabilidade de organizar, "quem vê" também não aparece', () => {
    // Permission rules whether the action exists: no organizer means no menu, whatever `setCategory` the host has.
    expect(itensDaCategoria({ podeOrganizar: false, accoes: { ...accoes, visibilidade: () => {} } })).toEqual([])
  })

  it("apagar não se pinta de vermelho, porque não destrói nada", () => {
    // Red promises it destroys. Deleting a category removes a label and frees the channels. Coloring it red would confirm the fear that the confirmation warning exists to undo.
    const itens = itensDaCategoria({ podeOrganizar: true, accoes })
    // Check length first: `[].every(...)` is `true`, and a menu that stopped returning entries (for example, `podeOrganizar` read backwards) would prove "none are red" simply by having none at all.
    expect(itens.length).toBeGreaterThan(0)
    expect(itens.every((item) => item.destructive !== true)).toBe(true)
  })

  it("cada entrada chama a sua acção", () => {
    const renomear = vi.fn()
    const apagar = vi.fn()
    const itens = itensDaCategoria({ podeOrganizar: true, accoes: { renomear, apagar } })
    itens[0]?.onSelect()
    itens[1]?.onSelect()
    expect(renomear).toHaveBeenCalledOnce()
    expect(apagar).toHaveBeenCalledOnce()
  })

  it("o aviso de apagar diz quantas salas continuam na lista", () => {
    // This is the expensive mistake here. We no longer ask first because it undoes: the warning after, the "Undo" button, undoes the doubt.
    const aviso = strings.rooms.categoryDeleted("Direcção", 3)
    expect(aviso).toContain("As 3 salas continuam na lista")
    // And in singular it still reads as Portuguese.
    expect(strings.rooms.categoryDeleted("Direcção", 1)).toContain("A sala continua na lista")
  })

  it("o aviso de fusão diz que as duas ficam uma antes de acontecer", () => {
    const aviso = strings.rooms.mergeCategoryConfirm("Arquivo", 2)
    expect(aviso).toContain("Já existe")
    expect(aviso).toContain("uma só")
  })

  it("o aviso de meio-caminho nomeia os canais que ficaram para trás", () => {
    // Without the names, anyone seeing the category split in two wouldn't know why or how to retry.
    const aviso = strings.rooms.categoryPartial("actas, manutenção", 2)
    expect(aviso).toContain("actas")
    expect(aviso).toContain("manutenção")
    expect(aviso).toContain("tenta outra vez")
    // And the sentence agrees with the count, which the list no longer says.
    expect(strings.rooms.categoryPartial("actas", 1)).toContain("não mudou")
    expect(aviso).toContain("não mudaram")
  })
})

/**
 * Mute (owner request from October 27, 2026). It belongs to everyone, not just organizers: it is about what THIS person hears. The entry says what the tap will do.
 */
describe("silenciar no menu do canal e da sala", () => {
  it('no canal: "Silenciar notificações", a seguir a "marcar como lido", e o toque alterna', () => {
    const alternar = vi.fn()
    const itens = itensDoCanal({
      emChamada: false,
      porLer: true,
      podeOrganizar: false,
      podeConvidar: false,
      podeEliminar: false,
      ehFeed: false,
      silencio: { silenciado: false, alternar },
      accoes: nada,
    })
    const rotulos = itens.map((item) => item.label)
    expect(rotulos.indexOf(strings.silencio.silenciar)).toBe(rotulos.indexOf(strings.menu.markRead) + 1)
    itens.find((item) => item.label === strings.silencio.silenciar)?.onSelect()
    expect(alternar).toHaveBeenCalledTimes(1)
  })

  it('no canal silenciado, a entrada passa a "Ativar notificações"', () => {
    expect(espaco({ silencio: { silenciado: true, alternar: () => {} } })).toContain(strings.silencio.ativar)
    expect(espaco({ silencio: { silenciado: true, alternar: () => {} } })).not.toContain(strings.silencio.silenciar)
  })

  it("sem onde guardar, não há entrada", () => {
    expect(espaco()).not.toContain(strings.silencio.silenciar)
  })

  it("na sala, mesmo sem poder organizar", () => {
    const sala: SalaResumo = { room: "vinha", name: "vinha", kind: "text" }
    const semPoder = itensDaSala({
      sala,
      podeOrganizar: false,
      silencio: { silenciado: false, alternar: () => {} },
      accoes: { abrir: () => {}, renomear: () => {}, fechar: () => {} },
    }).map((item) => item.label)
    expect(semPoder).toEqual([strings.menu.open, strings.silencio.silenciar])
    const silenciada = itensDaSala({
      sala,
      podeOrganizar: true,
      silencio: { silenciado: true, alternar: () => {} },
      accoes: { abrir: () => {}, renomear: () => {}, fechar: () => {} },
    }).map((item) => item.label)
    expect(silenciada.slice(0, 2)).toEqual([strings.menu.open, strings.silencio.ativar])
  })
})
