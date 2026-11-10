import { describe, expect, it } from "vitest"
import { EMPTY_SETUP_PROGRESS, SETUP_STEPS, ecraInicial, firstIncomplete, markDone } from "./setupSteps.js"

describe("setup steps", () => {
  it("a ordem é cofre → identidade → ligação → perfil", () => {
    expect(SETUP_STEPS).toEqual(["cofre", "identidade", "ligacao", "perfil"])
  })

  it("começa no cofre", () => {
    expect(firstIncomplete(EMPTY_SETUP_PROGRESS)).toBe("cofre")
  })

  it("uma falha a meio retoma no primeiro passo incompleto — nunca re-executa os anteriores", () => {
    let progress = markDone(EMPTY_SETUP_PROGRESS, "cofre")
    progress = markDone(progress, "identidade")
    // The connection failed: retry starts here, with vault and identity untouched.
    expect(firstIncomplete(progress)).toBe("ligacao")
    expect(progress.cofre).toBe(true)
    expect(progress.identidade).toBe(true)
  })

  it("tudo feito devolve null", () => {
    const done = SETUP_STEPS.reduce((acc, step) => markDone(acc, step), EMPTY_SETUP_PROGRESS)
    expect(firstIncomplete(done)).toBeNull()
  })

  it("markDone não muta o progresso anterior", () => {
    const next = markDone(EMPTY_SETUP_PROGRESS, "cofre")
    expect(EMPTY_SETUP_PROGRESS.cofre).toBe(false)
    expect(next.cofre).toBe(true)
  })
})

describe("o primeiro ecrã do Setup (fase 8.1)", () => {
  it("pergunta primeiro se já há conta noutro aparelho, quando há para onde emparelhar", () => {
    expect(ecraInicial({ podeEmparelhar: true })).toBe("outro-aparelho")
  })

  it("sem caminho para emparelhar, segue direito para a criação", () => {
    expect(ecraInicial({ podeEmparelhar: false })).toBe("criar")
  })
})
