import { describe, expect, it } from "vitest"
import { aplicarPrioridade, prioridadeDoFluxo } from "./prioridade.js"

/**
 * Voice takes priority over video when the network is tight. Requested by the owner on
 * November 2, 2026: "make voice the priority".
 */
describe("a prioridade dos fluxos", () => {
  it("a voz é alta, o som do ecrã e a música médios, a imagem baixa", () => {
    expect(prioridadeDoFluxo("microfone")).toBe("high")
    expect(prioridadeDoFluxo("musica")).toBe("medium")
    expect(prioridadeDoFluxo("ecra-som")).toBe("medium")
    expect(prioridadeDoFluxo("camara")).toBe("low")
    expect(prioridadeDoFluxo("ecra")).toBe("low")
  })

  function emissorFalso(encodings: Record<string, unknown>[] | undefined, recusa = false) {
    const gravados: unknown[] = []
    return {
      gravados,
      emissor: {
        getParameters: () => ({ encodings: encodings?.map((e) => ({ ...e })) }),
        setParameters: async (p: unknown) => {
          if (recusa) throw new Error("InvalidModificationError")
          gravados.push(p)
        },
      } as unknown as RTCRtpSender,
    }
  }

  it("marca a prioridade e a da rede em cada codificação, sem mexer no tecto", async () => {
    const { emissor, gravados } = emissorFalso([{ maxBitrate: 2_500_000 }])
    expect(await aplicarPrioridade(emissor, "high")).toBe(true)
    expect(gravados).toEqual([{ encodings: [{ maxBitrate: 2_500_000, priority: "high", networkPriority: "high" }] }])
  })

  it("sem codificações, ou com o browser a recusar, não rebenta e diz que não aplicou", async () => {
    expect(await aplicarPrioridade(emissorFalso([]).emissor, "high")).toBe(false)
    expect(await aplicarPrioridade(emissorFalso(undefined).emissor, "high")).toBe(false)
    expect(await aplicarPrioridade(emissorFalso([{}], true).emissor, "high")).toBe(false)
  })
})
