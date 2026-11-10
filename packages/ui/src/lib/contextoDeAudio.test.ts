import { afterEach, describe, expect, it, vi } from "vitest"
import { esquecerContextoDeAudio, obterContextoDeAudio, vigiarContextoDeAudio, type MudancaDoContexto } from "./contextoDeAudio.js"

/**
 * The shared audio context suspended by the system (report from November 2, 2026).
 *
 * This is the path for the sound of someone with volume above 100%. A context
 * suspended by the system would not come back on its own, and nothing said so in
 * the log.
 */

class ContextoFalso extends EventTarget {
  state: AudioContextState = "running"
  retomas = 0
  async resume(): Promise<void> {
    this.retomas++
  }
  mudar(estado: string): void {
    this.state = estado as AudioContextState
    this.dispatchEvent(new Event("statechange"))
  }
}

afterEach(() => {
  esquecerContextoDeAudio()
  vi.unstubAllGlobals()
})

describe("o contexto de áudio parado pelo sistema", () => {
  it("diz que parou, pede para voltar, e diz quando voltou", () => {
    vi.stubGlobal("window", { AudioContext: ContextoFalso })
    const mudancas: MudancaDoContexto[] = []
    const largar = vigiarContextoDeAudio((mudanca) => mudancas.push(mudanca))

    const contexto = obterContextoDeAudio() as unknown as ContextoFalso
    contexto.mudar("suspended")
    // A suspension is reported once, no matter how many events the browser sends.
    contexto.mudar("interrupted")
    expect(mudancas).toEqual([{ t: "parou", estado: "suspended" }])
    expect(contexto.retomas).toBe(1)

    contexto.mudar("running")
    expect(mudancas).toEqual([{ t: "parou", estado: "suspended" }, { t: "voltou" }])

    // Closing is not a suspension to resume.
    contexto.mudar("closed")
    expect(mudancas).toHaveLength(2)
    largar()
  })
})
