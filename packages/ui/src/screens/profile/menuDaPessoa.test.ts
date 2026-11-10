import { moradaDeTeste } from "../../../testes/moradas.js"
import { lembrarFichasDosCanais } from "../../lib/tipoDoCanal.js"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { admiteAdministracao } from "../../lib/format.js"
import { strings } from "../../strings.js"
import { itensDaPessoa } from "./menuDaPessoa.js"

const DIRECTA_ORWELL = moradaDeTeste("directa ana bruno", "orwell.pt")
const DIRECTA = moradaDeTeste("directa ana bruno", "s")
const MURAL_DA_ANA = moradaDeTeste("mural ana", "orwell.pt")
// The sheet for each channel (1.0 "Arca", slice 6b): no sheet, a channel is a room.
beforeEach(() =>
  lembrarFichasDosCanais({
    [DIRECTA_ORWELL]: { tipo: "directa" },
    [DIRECTA]: { tipo: "directa" },
    [MURAL_DA_ANA]: { tipo: "mural", dono: "@ana:orwell.pt" },
  }),
)

/**
 * The rule these tests lock in: what the person cannot do DOES NOT APPEAR. And
 * above all, in a two-person conversation nobody gets managed, that's the kind
 * of thing that comes back on the first reorganization, so it's pinned here
 * instead of just on the screen.
 */

const nada = {
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

function pessoa(over: Partial<Parameters<typeof itensDaPessoa>[0]> = {}): string[] {
  return itensDaPessoa({
    ehEuProprio: false,
    ehAmigo: false,
    canal: "!sala:s",
    canalAdmiteAdministracao: true,
    podeGerirPapeis: false,
    ehFundador: false,
    jaEhAdministrador: false,
    accoes: nada,
    ...over,
  }).map((item) => item.label)
}

describe("menu da pessoa", () => {
  it("visitar o perfil vem primeiro, e existe sempre", () => {
    // The profile page was built and there was no entry for it: right-clicking a
    // name, the obvious gesture to learn who the person is, gave everything but
    // the profile.
    expect(pessoa()[0]).toBe(strings.userMenu.profile)
    expect(pessoa({ ehEuProprio: true })).toContain(strings.userMenu.profile)
    expect(pessoa({ canal: null })).toContain(strings.userMenu.profile)
  })

  it("sobre mim mesmo só o perfil e o endereço: não me peço amizade nem me convido", () => {
    expect(pessoa({ ehEuProprio: true })).toEqual([strings.userMenu.profile, strings.social.copyAuthor])
  })

  it("pede amizade a quem não é amigo, e desfaz a quem é — nunca as duas", () => {
    const estranho = pessoa({ ehAmigo: false })
    expect(estranho).toContain(strings.userMenu.friend)
    expect(estranho).not.toContain(strings.people.unfriend)

    const amigo = pessoa({ ehAmigo: true })
    expect(amigo).toContain(strings.people.unfriend)
    expect(amigo).not.toContain(strings.userMenu.friend)
  })
})

describe("a ordem e os verbos da casa", () => {
  it("ver ‖ comunicar ‖ relação e canal ‖ administração ‖ expulsar, por esta ordem", () => {
    const itens = itensDaPessoa({
      ehEuProprio: false,
      ehAmigo: true,
      canal: "!sala:s",
      canalAdmiteAdministracao: true,
      podeGerirPapeis: true,
      podeExpulsar: true,
      ehFundador: false,
      jaEhAdministrador: false,
      accoes: nada,
    })
    expect(itens.map((item) => item.label)).toEqual([
      strings.userMenu.profile,
      strings.social.copyAuthor,
      strings.userMenu.dm,
      strings.userMenu.call,
      strings.people.unfriend,
      strings.userMenu.inviteToRoom,
      strings.userMenu.makeAdmin,
      strings.userMenu.expel,
    ])
    // A line before each block, and only before each block.
    expect(itens.filter((item) => item.separatorBefore).map((item) => item.label)).toEqual([
      strings.userMenu.dm,
      strings.people.unfriend,
      strings.userMenu.makeAdmin,
      strings.userMenu.expel,
    ])
    // Only the irreversible in red.
    expect(itens.filter((item) => item.destructive).map((item) => item.label)).toEqual([strings.userMenu.expel])
  })

  it("a chamada só a amigos, como a escrita", () => {
    expect(pessoa({ ehAmigo: false })).not.toContain(strings.userMenu.call)
    expect(pessoa({ ehAmigo: true })).toContain(strings.userMenu.call)
  })

  it("com o pedido dela à espera, aceita-se; com o nosso, não se pede outra vez", () => {
    expect(pessoa({ pedido: "recebido" })).toContain(strings.userMenu.acceptFriend)
    expect(pessoa({ pedido: "recebido" })).not.toContain(strings.userMenu.friend)
    const enviado = pessoa({ pedido: "enviado" })
    expect(enviado).not.toContain(strings.userMenu.friend)
    expect(enviado).not.toContain(strings.userMenu.acceptFriend)
    // And inviting stays, now it opens the block.
    expect(enviado).toContain(strings.userMenu.inviteToRoom)
  })

  it('no "⋯" da página de perfil, só o que a página não tem em botão', () => {
    const daPagina = itensDaPessoa(
      {
        ehEuProprio: false,
        ehAmigo: true,
        canal: "!sala:s",
        canalAdmiteAdministracao: true,
        podeGerirPapeis: true,
        podeExpulsar: true,
        ehFundador: false,
        jaEhAdministrador: false,
        accoes: nada,
      },
      { semAccoesDaPagina: true },
    ).map((item) => item.label)
    // What the page already has as a button doesn't repeat in its "⋯".
    expect(daPagina).toEqual([strings.social.copyAuthor, strings.userMenu.makeAdmin, strings.userMenu.expel])
  })

  it("em modo comunidade não se pede amizade nem se desfaz, e a chamada é livre", () => {
    const labels = pessoa({ naComunidade: true })
    expect(labels).not.toContain(strings.userMenu.friend)
    expect(labels).not.toContain(strings.people.unfriend)
    expect(labels).toContain(strings.userMenu.call)
    expect(labels).toContain(strings.userMenu.inviteToRoom)
  })

  it('os verbos fixos: "Mensagem", e convidar com reticências', () => {
    expect(strings.userMenu.dm).toBe("Mensagem")
    expect(strings.userMenu.inviteToRoom.endsWith("…")).toBe(true)
    expect(strings.people.unfriend.startsWith("Desfazer")).toBe(true)
    expect(strings.userMenu.expel.startsWith("Expulsar")).toBe(true)
  })
})

describe("administração no menu da pessoa", () => {
  it("NUNCA se torna administrador numa conversa de duas pessoas", () => {
    /*
      The request, word for word: "It must not be possible to make admin in the
      private conversation between two users". There's no hierarchy to give, both
      people can do everything there is to do, and naming the other gives them
      nothing they don't already have.

      Note that who commands can do everything else: the entry disappears because
      the channel is a direct conversation, not because of lack of power.
    */
    const labels = pessoa({
      canal: DIRECTA,
      canalAdmiteAdministracao: admiteAdministracao(DIRECTA),
      podeGerirPapeis: true,
    })
    expect(labels).not.toContain(strings.userMenu.makeAdmin)
    expect(labels).not.toContain(strings.userMenu.dropAdmin)
    // And the rest of the menu stays all there: nothing got lost along the way.
    expect(labels).toContain(strings.userMenu.profile)
    expect(labels).toContain(strings.userMenu.dm)
  })

  it("nem se DESTITUI numa conversa directa — o gesto não existe nos dois sentidos", () => {
    // Half the regressions like this slip through because only "making" got tested.
    const labels = pessoa({
      canal: DIRECTA,
      canalAdmiteAdministracao: admiteAdministracao(DIRECTA),
      podeGerirPapeis: true,
      jaEhAdministrador: true,
    })
    expect(labels).not.toContain(strings.userMenu.dropAdmin)
  })

  it("num canal a sério, quem gere papéis nomeia e destitui", () => {
    expect(pessoa({ podeGerirPapeis: true })).toContain(strings.userMenu.makeAdmin)
    expect(pessoa({ podeGerirPapeis: true, jaEhAdministrador: true })).toContain(strings.userMenu.dropAdmin)
  })

  it("sem poder de gerir papéis, sem canal, ou sobre quem fundou: não aparece", () => {
    expect(pessoa({ podeGerirPapeis: false })).not.toContain(strings.userMenu.makeAdmin)
    expect(pessoa({ canal: null, podeGerirPapeis: true })).not.toContain(strings.userMenu.makeAdmin)
    expect(pessoa({ podeGerirPapeis: true, ehFundador: true })).not.toContain(strings.userMenu.makeAdmin)
  })

  it("as acções são as que se escolheram, e nenhuma corre sem se escolher", () => {
    const verPerfil = vi.fn()
    const alternar = vi.fn()
    const itens = itensDaPessoa({
      ehEuProprio: false,
      ehAmigo: false,
      canal: "!sala:s",
      canalAdmiteAdministracao: true,
      podeGerirPapeis: true,
      ehFundador: false,
      jaEhAdministrador: false,
      accoes: { ...nada, verPerfil, alternarAdministrador: alternar },
    })
    expect(verPerfil).not.toHaveBeenCalled()
    itens.find((item) => item.label === strings.userMenu.profile)?.onSelect()
    expect(verPerfil).toHaveBeenCalledOnce()
    itens.find((item) => item.label === strings.userMenu.makeAdmin)?.onSelect()
    expect(alternar).toHaveBeenCalledOnce()
  })
})

/**
 * Expel, which is the only gesture in this menu that can't be undone.
 *
 * `session.expel` existed, was saved and tested, and no interface called it:
 * whoever had the responsibility had no way to use it, and an abuser in the
 * common room stayed there. A swarm rush told us in the section on what wasn't
 * exercised because it didn't exist.
 *
 * The responsibility is `expel` not `mayManageRoles`: they're separate on
 * purpose, and who manages rooms doesn't remove anyone from the channel.
 */
describe("expulsar", () => {
  it("não aparece a quem não tem a responsabilidade", () => {
    expect(pessoa({ podeExpulsar: false })).not.toContain(strings.userMenu.expel)
    // And the absence of an answer reads as "cannot", which is the safe bet.
    expect(pessoa({})).not.toContain(strings.userMenu.expel)
  })

  it("aparece a quem a tem", () => {
    expect(pessoa({ podeExpulsar: true })).toContain(strings.userMenu.expel)
  })

  it("não se oferece contra quem fundou o canal", () => {
    // Always returns an error from the core; offering it would promise a gesture
    // that doesn't happen.
    expect(pessoa({ podeExpulsar: true, ehFundador: true })).not.toContain(strings.userMenu.expel)
  })

  it("não se oferece numa conversa de duas pessoas nem fora de um canal", () => {
    expect(pessoa({ podeExpulsar: true, canalAdmiteAdministracao: false })).not.toContain(strings.userMenu.expel)
    expect(pessoa({ podeExpulsar: true, canal: null })).not.toContain(strings.userMenu.expel)
  })

  it("é uma entrada destrutiva, e a última", () => {
    const itens = itensDaPessoa({
      ehEuProprio: false,
      ehAmigo: false,
      canal: "!sala:s",
      canalAdmiteAdministracao: true,
      podeGerirPapeis: true,
      podeExpulsar: true,
      ehFundador: false,
      jaEhAdministrador: false,
      accoes: nada,
    })
    const ultimo = itens.at(-1)
    expect(ultimo?.label).toBe(strings.userMenu.expel)
    expect(ultimo?.destructive).toBe(true)
  })

  it("gerir papéis não dá expulsar, nem o contrário", () => {
    // Two separate responsibilities: one role can give one and not the other.
    expect(pessoa({ podeGerirPapeis: true, podeExpulsar: false })).not.toContain(strings.userMenu.expel)
    expect(pessoa({ podeGerirPapeis: false, podeExpulsar: true })).not.toContain(strings.userMenu.makeAdmin)
  })
})

describe("admiteAdministracao", () => {
  it("uma conversa de duas pessoas não admite administração", () => {
    expect(admiteAdministracao(DIRECTA_ORWELL)).toBe(false)
  })

  it("um feed também não: é canalização, não sítio com membros", () => {
    expect(admiteAdministracao(MURAL_DA_ANA)).toBe(false)
  })

  it("um canal admite, e a ausência de canal não admite nada", () => {
    expect(admiteAdministracao("!geral:orwell.pt")).toBe(true)
    expect(admiteAdministracao(null)).toBe(false)
  })
})

describe("menu da pessoa — cancelar e bloquear", () => {
  const comBloqueio = {
    ...nada,
    cancelarPedido: (): void => {},
    bloquear: (): void => {},
    desbloquear: (): void => {},
  }

  it('com o nosso pedido em pé, a entrada da relação é "Cancelar pedido"', () => {
    const enviado = pessoa({ pedido: "enviado", accoes: comBloqueio })
    expect(enviado).toContain(strings.people.cancelRequest)
    expect(enviado).not.toContain(strings.userMenu.friend)
  })

  it("sem a porta de cancelar na ponte, não há entrada nenhuma", () => {
    expect(pessoa({ pedido: "enviado" })).not.toContain(strings.people.cancelRequest)
  })

  it('"Bloquear" é a última entrada, destrutiva e depois de um traço', () => {
    const itens = itensDaPessoa({
      ehEuProprio: false,
      ehAmigo: true,
      canal: "!sala:s",
      canalAdmiteAdministracao: true,
      podeGerirPapeis: true,
      podeExpulsar: true,
      ehFundador: false,
      jaEhAdministrador: false,
      accoes: comBloqueio,
    })
    const ultimo = itens[itens.length - 1]
    expect(ultimo?.label).toBe(strings.people.block)
    expect(ultimo?.destructive).toBe(true)
    expect(ultimo?.separatorBefore).toBe(true)
    // After expulsion, which is from the channel; blocking is of the whole person.
    expect(itens.map((item) => item.label).indexOf(strings.userMenu.expel)).toBe(itens.length - 2)
  })

  it('a página de perfil também o tem, no "⋯"', () => {
    const itens = itensDaPessoa(
      {
        ehEuProprio: false,
        ehAmigo: false,
        canal: null,
        canalAdmiteAdministracao: false,
        podeGerirPapeis: false,
        ehFundador: false,
        jaEhAdministrador: false,
        accoes: comBloqueio,
      },
      { semAccoesDaPagina: true },
    ).map((item) => item.label)
    expect(itens[itens.length - 1]).toBe(strings.people.block)
  })

  it('bloqueada, sem canal, a pessoa só tem perfil, endereço e "Desbloquear"', () => {
    expect(pessoa({ ehBloqueado: true, canal: null, accoes: comBloqueio })).toEqual([
      strings.userMenu.profile,
      strings.social.copyAuthor,
      strings.people.unblock,
    ])
  })

  it('bloquear não tira ao administrador "Tornar administrador", "Mover para" nem "Expulsar"', () => {
    const itens = itensDaPessoa({
      ehEuProprio: false,
      ehAmigo: true,
      ehBloqueado: true,
      canal: "!sala:s",
      canalAdmiteAdministracao: true,
      podeGerirPapeis: true,
      podeExpulsar: true,
      ehFundador: false,
      jaEhAdministrador: false,
      mover: { destinos: [{ room: "v1", name: "Voz" }], mover: () => {} },
      accoes: comBloqueio,
    }).map((item) => item.label)
    expect(itens).toEqual([
      strings.userMenu.profile,
      strings.social.copyAuthor,
      strings.userMenu.makeAdmin,
      strings.voiceMove.menu,
      strings.userMenu.expel,
      strings.people.unblock,
    ])
  })

  it("a mim próprio não me bloqueio", () => {
    expect(pessoa({ ehEuProprio: true, accoes: comBloqueio })).not.toContain(strings.people.block)
  })
})

describe("o apelido neste canal (fase 3)", () => {
  const comApelido = { ...nada, mudarApelido: (): void => {}, tirarApelido: (): void => {} }

  it("o meu, mudo-o sempre; o dos outros, só a moderar", () => {
    expect(pessoa({ ehEuProprio: true, accoes: comApelido })).toContain(strings.userMenu.nickname)
    expect(pessoa({ accoes: comApelido })).not.toContain(strings.userMenu.nickname)
    expect(pessoa({ podeModerar: true, accoes: comApelido })).toContain(strings.userMenu.nickname)
  })

  it("tirar só aparece a quem tem apelido", () => {
    expect(pessoa({ podeModerar: true, accoes: comApelido })).not.toContain(strings.userMenu.nicknameRemove)
    expect(pessoa({ podeModerar: true, temApelido: true, accoes: comApelido })).toContain(strings.userMenu.nicknameRemove)
  })

  it("numa conversa a dois, ou sem canal, não há apelidos", () => {
    expect(pessoa({ ehEuProprio: true, canalAdmiteAdministracao: false, accoes: comApelido })).not.toContain(
      strings.userMenu.nickname,
    )
    expect(pessoa({ ehEuProprio: true, canal: null, accoes: comApelido })).not.toContain(strings.userMenu.nickname)
  })
})

describe("denunciar (denúncias, Tarefa 7)", () => {
  const comDenuncia = { ...nada, denunciar: (): void => {}, bloquear: (): void => {}, desbloquear: (): void => {} }
  const REPORT = "Denunciar…"

  it("com `denunciar` presente e não sendo eu, 'Denunciar…' aparece antes de 'Bloquear'; para mim nunca", () => {
    expect(strings.denunciar.menu).toBe(REPORT)
    const labels = pessoa({ accoes: comDenuncia })
    expect(labels).toContain(REPORT)
    expect(labels.indexOf(REPORT)).toBe(labels.indexOf(strings.people.block) - 1)
    expect(pessoa({ ehEuProprio: true, accoes: comDenuncia })).not.toContain(REPORT)
    // Without the action, the entry doesn't appear.
    expect(pessoa()).not.toContain(REPORT)
    // On the profile page too, and with the person blocked too.
    const folha = itensDaPessoa(
      {
        ehEuProprio: false,
        ehAmigo: false,
        canal: null,
        canalAdmiteAdministracao: false,
        podeGerirPapeis: false,
        ehFundador: false,
        jaEhAdministrador: false,
        accoes: comDenuncia,
      },
      { semAccoesDaPagina: true },
    ).map((entrada) => entrada.label)
    expect(folha).toEqual([strings.social.copyAuthor, REPORT, strings.people.block])
    const bloqueada = pessoa({ ehBloqueado: true, accoes: comDenuncia })
    expect(bloqueada.indexOf(REPORT)).toBe(bloqueada.indexOf(strings.people.unblock) - 1)
  })
})
