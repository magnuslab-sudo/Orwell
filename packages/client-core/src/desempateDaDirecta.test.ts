import { describe, expect, it } from "vitest"
import { desempateDaDirecta, type CorridaDaDirecta } from "./desempateDaDirecta.js"

/**
 * The tiebreaker rule for a direct chat with two groups (phase 1g).
 *
 * `@ana` is less than `@bruno`: Ana's group wins, from both sides.
 */
const ANA = "@ana:localhost"
const BRUNO = "@bruno:localhost"

const corrida = (parte: Partial<CorridaDaDirecta>): CorridaDaDirecta => ({
  eu: ANA,
  par: BRUNO,
  criadorDoNosso: ANA,
  criadorDoWelcome: BRUNO,
  parNoNosso: true,
  ultimaDoPar: -1,
  seqDoWelcome: 5,
  ...parte,
})

describe("o desempate da directa", () => {
  it("o vencedor mantém o seu grupo e recusa o Welcome do perdedor", () => {
    expect(desempateDaDirecta(corrida({}))).toBe("manter-o-nosso")
  })

  it("o perdedor adopta o grupo do vencedor", () => {
    expect(desempateDaDirecta(corrida({ eu: BRUNO, par: ANA, criadorDoNosso: BRUNO, criadorDoWelcome: ANA }))).toBe(
      "adoptar-o-do-vencedor",
    )
  })

  it("o defeito da 1d: o perdedor já falou no grupo do vencedor DEPOIS do seu Welcome, e o vencedor mantém o seu", () => {
    // With the old rule, having opened anything from the pair undid the tiebreaker, and
    // the winner adopted the group the loser had abandoned.
    expect(desempateDaDirecta(corrida({ ultimaDoPar: 9, seqDoWelcome: 5 }))).toBe("manter-o-nosso")
  })

  it("uma reparação a sério (o par escreveu no nosso grupo só ANTES do Welcome) adopta-se como sempre", () => {
    expect(desempateDaDirecta(corrida({ ultimaDoPar: 3, seqDoWelcome: 40 }))).toBeNull()
  })

  it("o perfil que o perdedor publica ao adoptar não conta como escrita: sem mensagens dele, é corrida", () => {
    expect(desempateDaDirecta(corrida({ ultimaDoPar: -1, seqDoWelcome: 40 }))).toBe("manter-o-nosso")
  })

  it("sem o par no nosso grupo, o vencedor adopta o dele em vez de o deixar sozinho", () => {
    expect(desempateDaDirecta(corrida({ parNoNosso: false }))).toBeNull()
  })

  it("dois grupos do mesmo criador não são uma corrida: é o par a refazer o seu, e adopta-se", () => {
    expect(desempateDaDirecta(corrida({ criadorDoNosso: BRUNO, criadorDoWelcome: BRUNO }))).toBeNull()
    expect(desempateDaDirecta(corrida({ criadorDoNosso: ANA, criadorDoWelcome: ANA }))).toBeNull()
  })

  it("um criador fora do par não entra no desempate", () => {
    expect(desempateDaDirecta(corrida({ criadorDoWelcome: "@carla:localhost" }))).toBeNull()
  })

  it("a mesma regra dos dois lados põe os dois no grupo da Ana, seja qual for a ordem", () => {
    // Ana has hers and receives Bruno's; Bruno has his and receives Ana's.
    const daAna = desempateDaDirecta(corrida({}))
    const doBruno = desempateDaDirecta(corrida({ eu: BRUNO, par: ANA, criadorDoNosso: BRUNO, criadorDoWelcome: ANA, ultimaDoPar: 7 }))
    expect([daAna, doBruno]).toEqual(["manter-o-nosso", "adoptar-o-do-vencedor"])
    // The swapped case: Bruno is already in Ana's group and receives another Welcome from her.
    expect(desempateDaDirecta(corrida({ eu: BRUNO, par: ANA, criadorDoNosso: ANA, criadorDoWelcome: ANA }))).toBeNull()
  })
})
