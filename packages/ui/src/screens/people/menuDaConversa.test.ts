import { describe, expect, it, vi } from "vitest"
import { strings } from "../../strings.js"
import { itensDaConversa } from "./menuDaConversa.js"

/**
 * What this menu offers, and more importantly what it never offers: nothing that
 * breaks the cryptographic group. Closing hides the line; it does not delete the
 * conversation, does not leave the channel, and is not red for exactly that reason.
 */

const nada = {
  abrir: (): void => {},
  marcarLida: (): void => {},
  fechar: (): void => {},
  verPerfil: (): void => {},
  entrarNaChamada: (): void => {},
  entrarComVideo: (): void => {},
  sairDaChamada: (): void => {},
}

function conversa(over: Partial<Parameters<typeof itensDaConversa>[0]> = {}): string[] {
  return itensDaConversa({
    ehAberta: false,
    porLer: false,
    pessoa: "@ana:s",
    podeChamar: true,
    accoes: nada,
    ...over,
  }).map((item) => item.label)
}

describe("menu da conversa", () => {
  it("é o menu canónico: abrir ‖ perfil, chamada, vídeo ‖ fechar", () => {
    expect(conversa()).toEqual([
      strings.menu.open,
      strings.userMenu.profile,
      strings.menu.joinCall,
      strings.menu.joinVideo,
      strings.people.directClose,
    ])
  })

  it("nunca oferece sair do canal nem propriedades: uma directa fecha-se", () => {
    for (const over of [{}, { porLer: true }, { emChamada: true }]) {
      const labels = conversa(over)
      expect(labels).not.toContain(strings.menu.leave)
      expect(labels).not.toContain(strings.menu.properties)
      expect(labels).not.toContain(strings.menu.remove)
    }
  })

  it("a quem não é amigo não se oferece chamada, pela regra da escrita", () => {
    const labels = conversa({ podeChamar: false })
    expect(labels).not.toContain(strings.menu.joinCall)
    expect(labels).not.toContain(strings.menu.joinVideo)
    expect(labels).toContain(strings.people.directClose)
  })

  it("em chamada, oferece sair dela em vez de entrar", () => {
    const labels = conversa({ emChamada: true })
    expect(labels).toContain(strings.menu.leaveCall)
    expect(labels).not.toContain(strings.menu.joinCall)
  })

  it("não oferece abrir a conversa que já está aberta", () => {
    // An entry that produces no visible effect reads as broken.
    expect(conversa({ ehAberta: true })).not.toContain(strings.menu.open)
    expect(conversa({ ehAberta: true })).toContain(strings.people.directClose)
  })

  it("marcar como lida só quando há alguma coisa por ler", () => {
    expect(conversa({ porLer: false })).not.toContain(strings.menu.markReadDirect)
    expect(conversa({ porLer: true })).toContain(strings.menu.markReadDirect)
  })

  it("sem outra pessoa reconhecível não se oferece perfil nenhum", () => {
    // A channel whose identifier cannot be read has no profile to visit,
    // and an entry that opens nothing is worse than a missing entry.
    expect(conversa({ pessoa: null })).not.toContain(strings.userMenu.profile)
    expect(conversa({ pessoa: null })).toContain(strings.people.directClose)
  })

  it("fechar existe sempre, e NUNCA é destrutivo", () => {
    /*
      Closing does not delete: the MLS group stays standing, the history stays in
      the vault, and the conversation comes back on its own when a message arrives.
      Red is the promise that something gets destroyed. Here it confirmed the exact
      fear that the hint next to it exists to ease.
    */
    for (const over of [{}, { ehAberta: true }, { porLer: true }, { pessoa: null }]) {
      const fechar = itensDaConversa({ ehAberta: false, porLer: false, pessoa: "@ana:s", accoes: nada, ...over }).find(
        (item) => item.label === strings.people.directClose,
      )
      expect(fechar).toBeTruthy()
      expect(fechar?.destructive).toBeUndefined()
    }
  })

  it("nada acontece sem se escolher, e cada entrada chama a sua acção", () => {
    const fechar = vi.fn()
    const verPerfil = vi.fn()
    const itens = itensDaConversa({
      ehAberta: false,
      porLer: true,
      pessoa: "@ana:s",
      accoes: { ...nada, fechar, verPerfil },
    })
    expect(fechar).not.toHaveBeenCalled()
    itens.find((item) => item.label === strings.people.directClose)?.onSelect()
    itens.find((item) => item.label === strings.userMenu.profile)?.onSelect()
    expect(fechar).toHaveBeenCalledOnce()
    expect(verPerfil).toHaveBeenCalledOnce()
  })
})

describe("silenciar uma conversa privada", () => {
  it('a entrada vem a seguir a "marcar como lida", e diz o que o toque faz', () => {
    const alternar = vi.fn()
    const itens = itensDaConversa({
      ehAberta: false,
      porLer: true,
      pessoa: "@ana:s",
      silencio: { silenciado: false, alternar },
      accoes: nada,
    })
    const rotulos = itens.map((item) => item.label)
    expect(rotulos.indexOf(strings.silencio.silenciar)).toBe(rotulos.indexOf(strings.menu.markReadDirect) + 1)
    itens.find((item) => item.label === strings.silencio.silenciar)?.onSelect()
    expect(alternar).toHaveBeenCalledTimes(1)
    expect(conversa({ silencio: { silenciado: true, alternar } })).toContain(strings.silencio.ativar)
  })
})
