import { describe, expect, it } from "vitest"
import { contasSemPerfil, podeResponderAPedidoDePerfis, Session } from "./session.js"

/**
 * F10: when a profile request has a response (finding 4 from the 0.7.0 review).
 *
 * The three guards, each one alone. Without them, any member of a channel
 * would make all accounts publish the profile in a loop. The proof with real accounts,
 * and repeated requests, is in `apps/server/src/sincronia-s1.test.ts`.
 */
describe("podeResponderAPedidoDePerfis", () => {
  const AGORA = 10 * Session.PERFIS_DADOS_MS
  const base = {
    eu: "@eu:s",
    contas: ["@eu:s", "@ana:s", "@nova:s"],
    ditas: ["@eu:s", "@ana:s"],
    ultimaResposta: undefined,
    agora: AGORA,
    seq: 50,
    aoVivo: true,
    lidoAntesDaLigacao: 40,
  }

  it("responde quando há uma conta que entrou depois da última publicação", () => {
    expect(podeResponderAPedidoDePerfis(base)).toBe(true)
  })

  it("não responde quando todas as contas do canal já receberam o perfil", () => {
    expect(podeResponderAPedidoDePerfis({ ...base, ditas: ["@eu:s", "@ana:s", "@nova:s"] })).toBe(false)
  })

  it("sem publicação conhecida, qualquer outra conta é nova", () => {
    expect(podeResponderAPedidoDePerfis({ ...base, ditas: undefined, contas: ["@eu:s", "@ana:s"] })).toBe(true)
    expect(podeResponderAPedidoDePerfis({ ...base, ditas: undefined, contas: ["@eu:s"] })).toBe(false)
  })

  it("não responde duas vezes no mesmo dia, e responde depois", () => {
    expect(podeResponderAPedidoDePerfis({ ...base, ultimaResposta: AGORA - 60_000 })).toBe(false)
    expect(podeResponderAPedidoDePerfis({ ...base, ultimaResposta: AGORA - Session.PERFIS_DADOS_MS })).toBe(true)
  })

  it("ignora um pedido que a recuperação traz de antes da ligação, e não o que vem ao vivo", () => {
    expect(podeResponderAPedidoDePerfis({ ...base, aoVivo: false, seq: 40 })).toBe(false)
    expect(podeResponderAPedidoDePerfis({ ...base, aoVivo: false, seq: 41 })).toBe(true)
    expect(podeResponderAPedidoDePerfis({ ...base, aoVivo: true, seq: 10 })).toBe(true)
  })
})

describe("contasSemPerfil", () => {
  it("pede quem não tem perfil e quem só tem o que um irmão contou, nunca a própria conta", () => {
    const diretorio = { "@ana:s": {}, "@bruno:s": { parcial: true as const } }
    expect(contasSemPerfil(["@eu:s", "@carla:s", "@bruno:s", "@ana:s"], "@eu:s", diretorio)).toEqual(["@bruno:s", "@carla:s"])
  })
})
