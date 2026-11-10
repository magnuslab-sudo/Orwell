import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { EnclaveBridge } from "../bridge.js"
import { PREFS_KEY, readPrefs } from "../hooks/usePrefs.js"
import { CHAVE_DA_LINGUA, definirLingua, linguaActual } from "../strings.js"
import { DM_CLOSED_KEY } from "./directs.js"
import {
  arquivar,
  desarquivar,
  desligarEstadoDaConta,
  esquecerEstadoDoBrowser,
  LAST_READ_KEY,
  lerEstadoDaConta,
  ligarEstadoDaConta,
  marcarLido,
} from "./estadoDaConta.js"
import { MARCA_DE_SEMENTE, PREFERENCIAS_QUE_VIAJAM } from "./preferenciasDaConta.js"
import { moradaDeTeste } from "../../testes/moradas.js"

const DM_A_B = moradaDeTeste("directa a b", "s")
const DM_X_Y = moradaDeTeste("directa x y", "s")
const DM_C_D = moradaDeTeste("directa c d", "s")

/**
 * A session of fiction, with the core's merge rule: reads only go up,
 * archive and preferences keep the last one. Events leave like on the bridge.
 */
function sessaoFalsa(
  inicial: {
    lidas?: Record<string, number>
    arquivo?: Record<string, number>
    preferencias?: Record<string, string>
    /** The channels the session knows. By default, the ones the tests use. */
    canais?: string[]
  } = {},
) {
  const canais = inicial.canais ?? ["!a:s", "!b:s", DM_A_B]
  const lidas: Record<string, number> = { ...inicial.lidas }
  const arquivo: Record<string, number> = { ...inicial.arquivo }
  const preferencias: Record<string, string> = { ...inicial.preferencias }
  const ouvintes = {
    lidas: new Set<(e: { lidas: Record<string, number> }) => void>(),
    arquivo: new Set<(e: { arquivo: Record<string, number> }) => void>(),
    preferencias: new Set<(e: { preferencias: Record<string, string> }) => void>(),
  }
  const chamadas: string[] = []
  const estado: NonNullable<EnclaveBridge["estado"]> = {
    lidas: async () => ({ ...lidas }),
    marcarLido: vi.fn(async (channel: string, at: number) => {
      chamadas.push(`lido ${channel} ${at}`)
      if (channel === "") throw new Error("read mark channel is invalid", { cause: { channel } })
      if ((lidas[channel] ?? -1) < at) lidas[channel] = at
      return { ok: true }
    }),
    arquivo: async () => ({ ...arquivo }),
    arquivar: vi.fn(async (channel: string, at?: number) => {
      chamadas.push(at === undefined ? `arquivar ${channel}` : `arquivar ${channel} @${at}`)
      arquivo[channel] = at ?? 1000
      return { ok: true }
    }),
    desarquivar: vi.fn(async (channel: string) => {
      chamadas.push(`desarquivar ${channel}`)
      delete arquivo[channel]
      return { ok: true }
    }),
    preferencias: async () => ({ ...preferencias }),
    definirPreferencia: vi.fn(async (chave: string, valor: string, at?: number) => {
      chamadas.push(at === undefined ? `pref ${chave}=${valor}` : `pref ${chave}=${valor} @${at}`)
      // A seed (low mark) loses to what the count already has.
      if (at === undefined || preferencias[chave] === undefined) preferencias[chave] = valor
      return { ok: true }
    }),
  }
  const on = {
    lidas: (h: (e: { lidas: Record<string, number> }) => void) => {
      ouvintes.lidas.add(h)
      return () => ouvintes.lidas.delete(h)
    },
    arquivo: (h: (e: { arquivo: Record<string, number> }) => void) => {
      ouvintes.arquivo.add(h)
      return () => ouvintes.arquivo.delete(h)
    },
    preferencias: (h: (e: { preferencias: Record<string, string> }) => void) => {
      ouvintes.preferencias.add(h)
      return () => ouvintes.preferencias.delete(h)
    },
  } as unknown as EnclaveBridge["on"]
  /** A sibling device changed something: the core merges and notifies. */
  const doIrmao = {
    lidas(novas: Record<string, number>) {
      Object.assign(lidas, novas)
      for (const h of ouvintes.lidas) h({ lidas: { ...lidas } })
    },
    arquivo(novo: Record<string, number>) {
      for (const chave of Object.keys(arquivo)) delete arquivo[chave]
      Object.assign(arquivo, novo)
      for (const h of ouvintes.arquivo) h({ arquivo: { ...arquivo } })
    },
    preferencias(novas: Record<string, string>) {
      Object.assign(preferencias, novas)
      for (const h of ouvintes.preferencias) h({ preferencias: { ...preferencias } })
    },
  }
  const channels = { list: vi.fn(async () => [...canais]) }
  return { bridge: { estado, on, channels }, estado, chamadas, doIrmao, lidas, arquivo, preferencias }
}

beforeEach(() => {
  localStorage.clear()
  desligarEstadoDaConta()
})
afterEach(() => {
  desligarEstadoDaConta()
  definirLingua("pt")
})

describe("o estado da conta no modo local (sem `bridge.estado`)", () => {
  it("lê e escreve o `localStorage`, como antes da fase 5", () => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ "!a:s": 5 }))
    expect(lerEstadoDaConta().lidas).toEqual({ "!a:s": 5 })
    marcarLido("!a:s", 9)
    expect(JSON.parse(localStorage.getItem(LAST_READ_KEY)!)).toEqual({ "!a:s": 9 })
    arquivar(DM_A_B, 50)
    expect(JSON.parse(localStorage.getItem(DM_CLOSED_KEY)!)).toEqual({ [DM_A_B]: 50 })
    desarquivar(DM_A_B)
    expect(JSON.parse(localStorage.getItem(DM_CLOSED_KEY)!)).toEqual({})
  })

  it("a leitura é estável sem mudança (o `useSyncExternalStore` exige-o)", () => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ "!a:s": 5 }))
    expect(lerEstadoDaConta()).toBe(lerEstadoDaConta())
  })

  it("uma ponte sem `estado` fica no modo local", async () => {
    const desligar = await ligarEstadoDaConta({ on: {} as EnclaveBridge["on"], channels: { list: async () => [] } }, () => {})
    marcarLido("!a:s", 3)
    expect(localStorage.getItem(LAST_READ_KEY)).not.toBeNull()
    desligar()
  })
})

describe("a migração única do `localStorage` para a sessão", () => {
  it("as marcas entram pela sessão e as chaves antigas apagam-se", async () => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ "!a:s": 100, "!b:s": 200 }))
    localStorage.setItem(DM_CLOSED_KEY, JSON.stringify({ [DM_A_B]: 300 }))
    const sessao = sessaoFalsa()
    await ligarEstadoDaConta(sessao.bridge, () => {})
    expect(sessao.lidas).toEqual({ "!a:s": 100, "!b:s": 200 })
    expect(Object.keys(sessao.arquivo)).toEqual([DM_A_B])
    expect(localStorage.getItem(LAST_READ_KEY)).toBeNull()
    expect(localStorage.getItem(DM_CLOSED_KEY)).toBeNull()
    expect(lerEstadoDaConta().lidas).toEqual({ "!a:s": 100, "!b:s": 200 })
  })

  it('o arquivo entra com a hora do browser, e não com "agora"', async () => {
    localStorage.setItem(DM_CLOSED_KEY, JSON.stringify({ [DM_A_B]: 300 }))
    const sessao = sessaoFalsa()
    await ligarEstadoDaConta(sessao.bridge, () => {})
    expect(sessao.chamadas).toEqual([`arquivar ${DM_A_B} @300`])
  })

  it("só migra os canais que a sessão conhece: o resto era de outra conta neste browser", async () => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ "!a:s": 100, "!de-outra:s": 200 }))
    localStorage.setItem(DM_CLOSED_KEY, JSON.stringify({ [DM_A_B]: 300, [DM_X_Y]: 400 }))
    const sessao = sessaoFalsa({ canais: ["!a:s", DM_A_B] })
    await ligarEstadoDaConta(sessao.bridge, () => {})
    expect(sessao.lidas).toEqual({ "!a:s": 100 })
    expect(Object.keys(sessao.arquivo)).toEqual([DM_A_B])
    // And the keys leave anyway: what did not come in does not stay waiting.
    expect(localStorage.getItem(LAST_READ_KEY)).toBeNull()
    expect(localStorage.getItem(DM_CLOSED_KEY)).toBeNull()
  })

  it("sem a lista dos canais, não migra nada e a chave fica", async () => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ "!a:s": 100 }))
    const sessao = sessaoFalsa()
    sessao.bridge.channels.list.mockRejectedValueOnce(new Error("no connection to the server"))
    const falhas: Error[] = []
    await ligarEstadoDaConta(sessao.bridge, (erro) => falhas.push(erro))
    expect(sessao.chamadas).toEqual([])
    expect(localStorage.getItem(LAST_READ_KEY)).not.toBeNull()
    expect(falhas).toHaveLength(1)
  })

  it("apagar a conta esquece as marcas do browser", () => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ "!a:s": 100 }))
    localStorage.setItem(DM_CLOSED_KEY, JSON.stringify({ [DM_A_B]: 300 }))
    esquecerEstadoDoBrowser()
    expect(localStorage.getItem(LAST_READ_KEY)).toBeNull()
    expect(localStorage.getItem(DM_CLOSED_KEY)).toBeNull()
    expect(lerEstadoDaConta().lidas).toEqual({})
  })

  it("as lidas do modo local ficam no ecrã enquanto a sessão não responde", async () => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ "!a:s": 100 }))
    const sessao = sessaoFalsa()
    let responder: (lidas: Record<string, number>) => void = () => {}
    sessao.estado.lidas = () =>
      new Promise((resolve) => {
        responder = resolve
      })
    const ligada = ligarEstadoDaConta(sessao.bridge, () => {})
    for (let vez = 0; vez < 10; vez++) await Promise.resolve()
    expect(lerEstadoDaConta().lidas["!a:s"]).toBe(100)
    responder({ "!a:s": 100 })
    await ligada
    expect(lerEstadoDaConta().lidas["!a:s"]).toBe(100)
  })

  it("corre uma vez só: a segunda abertura não manda nada", async () => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ "!a:s": 100 }))
    const sessao = sessaoFalsa()
    await ligarEstadoDaConta(sessao.bridge, () => {})
    desligarEstadoDaConta()
    sessao.chamadas.length = 0
    await ligarEstadoDaConta(sessao.bridge, () => {})
    expect(sessao.chamadas).toEqual([])
  })

  it("uma marca recusada com chave conhecida não prende a migração", async () => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ "": 1, "!a:s": 2 }))
    const sessao = sessaoFalsa()
    await ligarEstadoDaConta(sessao.bridge, () => {})
    expect(localStorage.getItem(LAST_READ_KEY)).toBeNull()
    expect(sessao.lidas).toEqual({ "!a:s": 2 })
  })

  it("uma falha da ponte deixa a chave para a ligação seguinte, e diz-se", async () => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ "!a:s": 2 }))
    const sessao = sessaoFalsa()
    vi.mocked(sessao.estado.marcarLido).mockRejectedValueOnce(new Error("no connection to the server"))
    const falhas: Error[] = []
    await ligarEstadoDaConta(sessao.bridge, (erro) => falhas.push(erro))
    expect(falhas.map((erro) => erro.message)).toEqual(["no connection to the server"])
    expect(localStorage.getItem(LAST_READ_KEY)).not.toBeNull()
  })
})

describe("o estado da conta no modo conta", () => {
  it("marcar lido manda à sessão, e só sobe", async () => {
    const sessao = sessaoFalsa({ lidas: { "!a:s": 50 } })
    await ligarEstadoDaConta(sessao.bridge, () => {})
    marcarLido("!a:s", 40)
    marcarLido("!a:s", 60)
    expect(sessao.chamadas).toEqual(["lido !a:s 60"])
    expect(lerEstadoDaConta().lidas["!a:s"]).toBe(60)
    expect(localStorage.getItem(LAST_READ_KEY)).toBeNull()
  })

  it("o que um irmão lê chega aqui, sem baixar uma marca local maior", async () => {
    const sessao = sessaoFalsa()
    await ligarEstadoDaConta(sessao.bridge, () => {})
    marcarLido("!a:s", 90)
    sessao.doIrmao.lidas({ "!b:s": 70 })
    expect(lerEstadoDaConta().lidas).toEqual({ "!a:s": 90, "!b:s": 70 })
  })

  it("arquivar e desarquivar vão à sessão; um irmão a desarquivar tira-a daqui", async () => {
    const sessao = sessaoFalsa()
    await ligarEstadoDaConta(sessao.bridge, () => {})
    arquivar(DM_A_B, 5_000)
    expect(sessao.chamadas).toEqual([`arquivar ${DM_A_B}`])
    // The local time (the one from `closeDirect`) stays, even if the session's is smaller.
    expect(lerEstadoDaConta().arquivo[DM_A_B]).toBe(5_000)
    sessao.doIrmao.arquivo({})
    expect(lerEstadoDaConta().arquivo).toEqual({})
    sessao.doIrmao.arquivo({ [DM_C_D]: 7 })
    desarquivar(DM_C_D)
    expect(sessao.chamadas).toContain(`desarquivar ${DM_C_D}`)
  })

  it("o Erro 720 (marca de lido recusada) fica oculto, por ordem do dono (28 de Outubro de 2026)", async () => {
    const sessao = sessaoFalsa()
    const falhas: Error[] = []
    await ligarEstadoDaConta(sessao.bridge, (erro) => falhas.push(erro))
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {})
    marcarLido("", 5)
    await Promise.resolve()
    await Promise.resolve()
    expect(falhas).toEqual([])
    expect(aviso).toHaveBeenCalled()
    aviso.mockRestore()
  })

  it("desligar volta ao modo local", async () => {
    const sessao = sessaoFalsa({ lidas: { "!a:s": 1 } })
    const desligar = await ligarEstadoDaConta(sessao.bridge, () => {})
    expect(lerEstadoDaConta().lidas).toEqual({ "!a:s": 1 })
    desligar()
    expect(lerEstadoDaConta().lidas).toEqual({})
  })
})

describe("as preferências que viajam", () => {
  it("a língua, a cor e a densidade da conta aplicam-se a este aparelho", async () => {
    const sessao = sessaoFalsa({
      preferencias: {
        [PREFERENCIAS_QUE_VIAJAM.lingua]: "en",
        [PREFERENCIAS_QUE_VIAJAM.cor]: "1",
        [PREFERENCIAS_QUE_VIAJAM.densidade]: "compacta",
      },
    })
    await ligarEstadoDaConta(sessao.bridge, () => {})
    expect(linguaActual()).toBe("en")
    expect(localStorage.getItem(CHAVE_DA_LINGUA)).toBe("en")
    expect(readPrefs().accent).toBe(1)
    expect(readPrefs().density).toBe("compacta")
    // Applying what came from the account does not send it back.
    expect(sessao.chamadas.filter((c) => c.startsWith("pref"))).toEqual([])
  })

  it("o que um irmão muda chega ao ecrã", async () => {
    const sessao = sessaoFalsa()
    await ligarEstadoDaConta(sessao.bridge, () => {})
    sessao.doIrmao.preferencias({ [PREFERENCIAS_QUE_VIAJAM.cor]: "2" })
    expect(readPrefs().accent).toBe(2)
  })

  it("o que só este aparelho escolheu sobe para a conta; os valores de fábrica não", async () => {
    localStorage.setItem(CHAVE_DA_LINGUA, "en")
    localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, accent: 3 }))
    const sessao = sessaoFalsa()
    await ligarEstadoDaConta(sessao.bridge, () => {})
    expect(sessao.preferencias).toEqual({ [PREFERENCIAS_QUE_VIAJAM.lingua]: "en", [PREFERENCIAS_QUE_VIAJAM.cor]: "3" })
  })

  it("sobe como semente, com a marca baixa: a escolha que a conta já tem num irmão ganha", async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, accent: 3 }))
    const sessao = sessaoFalsa()
    await ligarEstadoDaConta(sessao.bridge, () => {})
    expect(sessao.chamadas).toContain(`pref ${PREFERENCIAS_QUE_VIAJAM.cor}=3 @${MARCA_DE_SEMENTE}`)
  })

  it("se a leitura inicial falhou, nada sobe", async () => {
    localStorage.setItem(CHAVE_DA_LINGUA, "en")
    localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, accent: 3 }))
    const sessao = sessaoFalsa()
    sessao.estado.preferencias = async () => {
      throw new Error("no connection to the server")
    }
    await ligarEstadoDaConta(sessao.bridge, () => {})
    expect(sessao.chamadas.filter((c) => c.startsWith("pref"))).toEqual([])
  })

  it("a conta ganha ao que está guardado aqui", async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, accent: 3 }))
    const sessao = sessaoFalsa({ preferencias: { [PREFERENCIAS_QUE_VIAJAM.cor]: "0" } })
    await ligarEstadoDaConta(sessao.bridge, () => {})
    expect(readPrefs().accent).toBe(0)
    expect(sessao.preferencias[PREFERENCIAS_QUE_VIAJAM.cor]).toBe("0")
  })

  it("lixo vindo da conta não se aplica", async () => {
    const sessao = sessaoFalsa({ preferencias: { [PREFERENCIAS_QUE_VIAJAM.lingua]: "xx", [PREFERENCIAS_QUE_VIAJAM.cor]: "99" } })
    await ligarEstadoDaConta(sessao.bridge, () => {})
    expect(linguaActual()).toBe("pt")
    expect(readPrefs().accent).toBe(4)
  })
})
