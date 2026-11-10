import { describe, expect, it } from "vitest"
import { criarControladorDaOverlay, PERIODO_DO_TOPO_MS, type PortaDaJanela, type PortaDosEcras } from "./overlay-controlador.js"
import { MARGEM_DA_JANELA, MARGEM_DO_TOPO, type Area, type DesenhoDaOverlay } from "./overlay.js"

const ECRA_1 = { id: "1", area: { x: 0, y: 0, width: 1920, height: 1040 } }
const ECRA_2 = { id: "2", area: { x: 1920, y: 0, width: 1280, height: 1000 } }

function montar(opcoes: { guardadas?: unknown; ligada?: boolean } = {}) {
  const janela = {
    existe: false,
    visivel: false,
    ignora: true,
    limites: null as Area | null,
    desenhos: [] as DesenhoDaOverlay[],
    caras: [] as Record<string, string | null>[],
    topo: 0,
  }
  const porta: PortaDaJanela = {
    criar: () => {
      janela.existe = true
    },
    mostrar: () => {
      janela.visivel = true
    },
    esconder: () => {
      janela.visivel = false
    },
    colocar: (limites) => {
      janela.limites = limites
    },
    ignorarRato: (sim) => {
      janela.ignora = sim
    },
    desenhar: (desenho) => janela.desenhos.push(desenho),
    enviarCaras: (caras) => janela.caras.push(caras),
    reafirmarTopo: () => {
      janela.topo += 1
    },
    destruir: () => {
      janela.existe = false
      janela.visivel = false
    },
  }
  let cursor = { x: 960, y: 40 }
  const ecras: PortaDosEcras = {
    ecraEm: (ponto) => (ponto.x >= 1920 ? ECRA_2 : ECRA_1),
    ecraPorId: (id) => (id === "1" ? ECRA_1 : id === "2" ? ECRA_2 : null),
    principal: () => ECRA_1,
    cursor: () => cursor,
  }
  const gravadas: unknown[] = []
  const temporizadores = new Map<number, () => void>()
  let proximo = 1
  const controlador = criarControladorDaOverlay({
    janela: porta,
    ecras,
    guardadas: opcoes.guardadas ?? null,
    gravar: (posicoes) => gravadas.push(posicoes),
    repetir: (fazer) => {
      const id = proximo++
      temporizadores.set(id, fazer)
      return () => temporizadores.delete(id)
    },
  })
  // Since 2/11/2026 the overlay starts off: these tests talk about it on, as it
  // is when someone turns it on in Settings.
  if (opcoes.ligada !== false) controlador.preferencias({ ligada: true, opacidade: 0.45 })
  const correrTemporizadores = (): void => {
    for (const fazer of [...temporizadores.values()]) fazer()
  }
  return {
    janela,
    controlador,
    gravadas,
    temporizadores,
    correrTemporizadores,
    moverCursor: (x: number, y: number) => {
      cursor = { x, y }
    },
  }
}

const resumo = (pessoas: string[] = ["eu", "kaori"]) => ({
  sala: "Sala de jogo",
  entrada: 1,
  pessoas: pessoas.map((id) => ({ id, nome: id, aFalar: false, micCalado: false, somDesligado: false })),
})

describe("mostrar e esconder", () => {
  it("não cria janela nenhuma fora de uma sala de voz", () => {
    const { janela, controlador } = montar()
    controlador.janelaPrincipal(false)
    expect(janela.existe).toBe(false)
    controlador.estado(null)
    expect(janela.existe).toBe(false)
  })

  it("sem a pessoa a ligar nas Definições, não aparece (desligada por omissão desde 2/11/2026)", () => {
    const { janela, controlador } = montar({ ligada: false })
    controlador.janelaPrincipal(false)
    controlador.estado(resumo())
    expect(janela.visivel).toBe(false)
  })

  it("numa sala, com a janela principal atrás, aparece sem roubar o rato ao jogo", () => {
    const { janela, controlador } = montar()
    controlador.janelaPrincipal(false)
    controlador.estado(resumo())
    expect(janela.visivel).toBe(true)
    expect(janela.ignora).toBe(true)
    expect(janela.desenhos.at(-1)?.resumo.sala).toBe("Sala de jogo")
  })

  it("esconde-se quando a janela principal vem para a frente, e volta quando sai", () => {
    const { janela, controlador } = montar()
    controlador.estado(resumo())
    controlador.janelaPrincipal(true)
    expect(janela.visivel).toBe(false)
    controlador.janelaPrincipal(false)
    expect(janela.visivel).toBe(true)
  })

  it("sair da sala esconde, e desligar nas Definições destrói a janela", () => {
    const { janela, controlador } = montar()
    controlador.estado(resumo())
    controlador.estado(null)
    expect(janela.visivel).toBe(false)
    controlador.estado(resumo())
    controlador.preferencias({ ligada: false, opacidade: 0.5 })
    expect(janela.existe).toBe(false)
  })

  it("o atalho esconde e mostra; a próxima chamada começa visível", () => {
    const { janela, controlador } = montar()
    controlador.estado(resumo())
    controlador.alternar()
    expect(janela.visivel).toBe(false)
    controlador.alternar()
    expect(janela.visivel).toBe(true)
    controlador.alternar()
    controlador.estado(null)
    controlador.estado(resumo())
    expect(janela.visivel).toBe(true)
  })

  it("com a janela principal à frente o atalho não faz nada: não se esconde às escuras o que não se vê", () => {
    const { janela, controlador } = montar()
    controlador.estado(resumo())
    controlador.janelaPrincipal(true)
    controlador.alternar()
    controlador.janelaPrincipal(false)
    expect(janela.visivel).toBe(true)
  })

  it('reafirma o "sempre por cima" enquanto está visível, e pára quando se esconde', () => {
    const { janela, controlador, correrTemporizadores, temporizadores } = montar()
    expect(PERIODO_DO_TOPO_MS).toBeLessThanOrEqual(2000)
    controlador.estado(resumo())
    const antes = janela.topo
    correrTemporizadores()
    expect(janela.topo).toBeGreaterThan(antes)
    controlador.estado(null)
    expect(temporizadores.size).toBe(0)
  })

  it("a opacidade e o lado do aviso vão no desenho", () => {
    const { janela, controlador } = montar()
    controlador.preferencias({ ligada: true, opacidade: 0.4 })
    controlador.estado(resumo())
    expect(janela.desenhos.at(-1)).toMatchObject({ opacidade: 0.4, lado: "abaixo" })
  })
})

describe("as caras", () => {
  it("passam à página só quando mudam", () => {
    const { janela, controlador } = montar()
    controlador.estado(resumo())
    controlador.caras({ kaori: "data:image/png;base64,AAAA" })
    expect(janela.caras).toEqual([{ kaori: "data:image/png;base64,AAAA" }])
    controlador.caras({ kaori: "data:image/png;base64,AAAA" })
    expect(janela.caras).toHaveLength(1)
  })

  it("ao mostrar outra vez, a página recebe todas as que já tinha", () => {
    const { janela, controlador } = montar()
    controlador.caras({ kaori: "data:image/png;base64,AAAA" })
    controlador.estado(resumo())
    expect(janela.caras.at(-1)).toEqual({ kaori: "data:image/png;base64,AAAA" })
  })
})

describe("o rato e o arrasto", () => {
  it("o rato sobre a pílula faz a janela receber cliques; fora dela, passam para o jogo", () => {
    const { janela, controlador } = montar()
    controlador.estado(resumo())
    controlador.rato(true)
    expect(janela.ignora).toBe(false)
    controlador.rato(false)
    expect(janela.ignora).toBe(true)
  })

  it("arrastar segue o cursor, fica no ecrã, e grava a posição por ecrã ao largar", () => {
    const { janela, controlador, correrTemporizadores, moverCursor, gravadas } = montar()
    controlador.largura(400)
    controlador.estado(resumo())
    const inicio = janela.limites!
    controlador.rato(true)
    controlador.arrastar("inicio")
    moverCursor(1060, 240)
    correrTemporizadores()
    expect(janela.limites!.x).toBe(inicio.x + 100)
    expect(janela.limites!.y).toBe(inicio.y + 200)
    // Leaving the pill mid-drag doesn't return clicks to the game.
    controlador.rato(false)
    expect(janela.ignora).toBe(false)
    controlador.arrastar("fim")
    expect(janela.ignora).toBe(true)
    expect(gravadas.at(-1)).toEqual({ ecras: { "1": { dx: 1060, dy: MARGEM_DO_TOPO + 200 } }, ultimo: "1" })
  })

  it("arrastar para o outro ecrã grava lá, e a próxima vez abre lá", () => {
    const { controlador, correrTemporizadores, moverCursor, gravadas } = montar()
    controlador.largura(400)
    controlador.estado(resumo())
    controlador.arrastar("inicio")
    moverCursor(960 + 1600, 40)
    correrTemporizadores()
    controlador.arrastar("fim")
    const ultima = gravadas.at(-1) as { ultimo: string; ecras: Record<string, { dx: number }> }
    expect(ultima.ultimo).toBe("2")
    expect(ultima.ecras["2"]!.dx).toBe(2560 - 1920)

    const outro = montar({ guardadas: ultima })
    outro.controlador.largura(400)
    outro.controlador.estado(resumo())
    expect(outro.janela.limites!.x).toBeGreaterThanOrEqual(1920)
  })

  it("repor volta ao centro em cima do ecrã onde está, e grava", () => {
    const { janela, controlador, gravadas } = montar({ guardadas: { ecras: { "1": { dx: 100, dy: 500 } }, ultimo: "1" } })
    controlador.largura(400)
    controlador.estado(resumo())
    expect(janela.limites!.y).toBe(500 - MARGEM_DA_JANELA)
    controlador.repor()
    expect(janela.limites!.y).toBe(MARGEM_DO_TOPO - MARGEM_DA_JANELA)
    expect(janela.limites!.x + janela.limites!.width / 2).toBe(960)
    expect(gravadas.at(-1)).toEqual({ ecras: { "1": { dx: 960, dy: MARGEM_DO_TOPO } }, ultimo: "1" })
  })

  it("as posições lidas do disco depois do arranque contam, se a pílula ainda não apareceu", () => {
    const { janela, controlador } = montar()
    controlador.carregarPosicoes(JSON.stringify({ ecras: { "2": { dx: 640, dy: 300 } }, ultimo: "2" }))
    controlador.largura(400)
    controlador.estado(resumo())
    expect(janela.limites!.x).toBeGreaterThanOrEqual(1920)
    expect(janela.limites!.y).toBe(300 - MARGEM_DA_JANELA)
    // Once it appears, a late file no longer moves it.
    controlador.carregarPosicoes(JSON.stringify({ ecras: {}, ultimo: null }))
    controlador.ecrasMudaram()
    expect(janela.limites!.y).toBe(300 - MARGEM_DA_JANELA)
  })

  it("um ecrã guardado que já não existe cai para o principal", () => {
    const { janela, controlador } = montar({ guardadas: { ecras: { "9": { dx: 100, dy: 100 } }, ultimo: "9" } })
    controlador.largura(400)
    controlador.estado(resumo())
    expect(janela.limites!.x).toBeLessThan(1920)
  })

  it("largar tudo pára os temporizadores e destrói a janela", () => {
    const { janela, controlador, temporizadores } = montar()
    controlador.estado(resumo())
    controlador.arrastar("inicio")
    controlador.libertar()
    expect(temporizadores.size).toBe(0)
    expect(janela.existe).toBe(false)
  })

  it("uma largura de lixo não estraga a janela", () => {
    const { janela, controlador } = montar()
    controlador.largura(Number.NaN)
    controlador.largura(-5)
    controlador.largura(1e9)
    controlador.estado(resumo())
    expect(janela.limites!.width).toBeLessThanOrEqual(1920)
  })
})
