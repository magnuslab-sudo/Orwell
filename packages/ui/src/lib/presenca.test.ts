import { PRESENCA_REAFIRMADA_MS } from "@enclave/client-core"
import { describe, expect, it } from "vitest"
import { PRESENCA_VALIDA_MS, presencasVivas, quemEstaNaSala, semAPessoa } from "./presenca.js"

const AGORA = 1_800_000_000_000

describe("presencasVivas", () => {
  it("quem se reafirmou agora fica", () => {
    const vivas = presencasVivas(new Map([["@ana:s", AGORA]]), AGORA)
    expect([...vivas.keys()]).toEqual(["@ana:s"])
  })

  it("quem não se reafirma desde antes da janela sai", () => {
    // The case this exists to solve: closing the laptop sends no goodbye, and
    // without expiry the person would stay in the call forever.
    const partiu = AGORA - PRESENCA_VALIDA_MS - 1
    expect(presencasVivas(new Map([["@ana:s", partiu]]), AGORA).size).toBe(0)
  })

  it("no limite exacto ainda conta", () => {
    // The boundary is inclusive on purpose: a heartbeat that arrives at the exact
    // limit is a sign of life, not a delay.
    const limite = AGORA - PRESENCA_VALIDA_MS
    expect(presencasVivas(new Map([["@ana:s", limite]]), AGORA).size).toBe(1)
  })

  it("separa quem ficou de quem se foi, na mesma sala", () => {
    const presencas = new Map([
      ["@ana:s", AGORA - 3_000],
      ["@bruno:s", AGORA - PRESENCA_VALIDA_MS - 10_000],
      ["@carla:s", AGORA],
    ])
    expect([...presencasVivas(presencas, AGORA).keys()]).toEqual(["@ana:s", "@carla:s"])
  })

  it("um carimbo do futuro não expulsa ninguém", () => {
    // Clock skew between two computers. Distrusting it would remove the person
    // who is actually speaking from the list, which is the opposite of what we want.
    const adiantado = AGORA + 30_000
    expect(presencasVivas(new Map([["@ana:s", adiantado]]), AGORA).size).toBe(1)
  })

  /**
   * The window must fit the rhythm at which the core reaffirms presence, not the other way around.
   *
   * This test exists because of the bug on August 18, 2026: the window was
   * a hand-written number, the comment said the core reaffirmed itself every
   * five seconds, and the core did not reaffirm at all after the call settled. A window shorter than the heartbeat removes
   * the speaker from the screen; a heartbeat slower than the window does the same.
   */
  it("a janela dá pelo menos duas oportunidades ao batimento do núcleo", () => {
    expect(PRESENCA_VALIDA_MS).toBeGreaterThan(PRESENCA_REAFIRMADA_MS * 2)
  })
})

describe("semAPessoa", () => {
  it("tira quem se desligou de todas as salas onde estava", () => {
    const mapas = new Map([
      ["!a:s|tasca", new Map([["@ana:s", AGORA], ["@bruno:s", AGORA]])],
      ["!b:s|estudio", new Map([["@ana:s", AGORA]])],
    ])

    const depois = semAPessoa(mapas, "@ana:s")

    expect([...(depois.get("!a:s|tasca") ?? []).keys()]).toEqual(["@bruno:s"])
    // An empty room stops existing, otherwise the sidebar would draw
    // a voice room line with nobody in it.
    expect(depois.has("!b:s|estudio")).toBe(false)
  })

  it("quem não estava em chamada nenhuma não faz redesenhar nada", () => {
    // Identity, not equality: almost everyone who connects is not in
    // a call, and a new map for each of those would make React redraw the
    // entire sidebar even though nothing changed.
    const mapas = new Map([["!a:s|tasca", new Map([["@bruno:s", AGORA]])]])
    expect(semAPessoa(mapas, "@ana:s")).toBe(mapas)
  })
})

describe("quemEstaNaSala", () => {
  const EU = "@eu:s"
  const ANA = "@ana:s"
  const BRUNO = "@bruno:s"

  it("junta quem tem ligação de pé com quem se anunciou", () => {
    const quem = quemEstaNaSala([{ address: ANA }], new Map([[BRUNO, AGORA]]), EU, AGORA)

    expect(quem.sort()).toEqual([ANA, BRUNO])
  })

  it("conta quem se anunciou e ainda não é par de ligação nenhuma", () => {
    // The instant that produced the extra sound: the announcement arrived, the negotiation
    // has not yet produced a pair. Without this line the person reads as having left.
    expect(quemEstaNaSala([], new Map([[ANA, AGORA]]), EU, AGORA)).toEqual([ANA])
  })

  it("conta quem tem ligação de pé e de quem nunca se ouviu anúncio", () => {
    expect(quemEstaNaSala([{ address: ANA }], undefined, EU, AGORA)).toEqual([ANA])
  })

  it("não conta duas vezes quem está nas duas listas", () => {
    expect(quemEstaNaSala([{ address: ANA }], new Map([[ANA, AGORA]]), EU, AGORA)).toEqual([ANA])
  })

  it("deita fora o anúncio que caducou", () => {
    const partiu = AGORA - PRESENCA_VALIDA_MS - 1

    expect(quemEstaNaSala([], new Map([[ANA, partiu]]), EU, AGORA)).toEqual([])
  })

  it("nunca nos inclui a nós, venha o nosso nome de onde vier", () => {
    // Pairs never include us; announcements do, because ours comes back
    // the same way everyone else's does.
    expect(quemEstaNaSala([{ address: EU }], new Map([[EU, AGORA]]), EU, AGORA)).toEqual([])
  })

  it("sem sala anunciada, fica-se pelos pares", () => {
    expect(quemEstaNaSala([{ address: ANA }, { address: BRUNO }], undefined, EU, AGORA).sort()).toEqual([ANA, BRUNO])
  })

  it("não estraga o mapa dos anúncios ao lê-lo", () => {
    // The guard is about the SHAPE, not a value: `presencasVivas` receives a
    // `Map` that might be from React state, and a `delete` inside it would be a silent
    // mutation of what the sidebar draws.
    const anunciados = new Map([[ANA, AGORA - PRESENCA_VALIDA_MS - 1]])
    quemEstaNaSala([], anunciados, EU, AGORA)

    expect(anunciados.has(ANA)).toBe(true)
  })
})
