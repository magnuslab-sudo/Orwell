import { beforeEach, describe, expect, it } from "vitest"
import { VOLUMES_KEY, readVolumes, writeVolumes } from "./useVolumes.js"

beforeEach(() => localStorage.clear())

/**
 * The record of how loud each person is heard.
 *
 * Tolerant reading and stingy writing, for the same reasons as everything else that
 * lives in `localStorage`: a broken record cannot mute anyone without explanation, and
 * a list that grows with every person you talk to needs a cap.
 */
describe("volumes por pessoa", () => {
  it("um registo que não existe não baixa ninguém", () => {
    expect(readVolumes().size).toBe(0)
  })

  it("JSON estragado lê-se como ninguém baixado, e não rebenta", () => {
    localStorage.setItem(VOLUMES_KEY, "{isto não é JSON")

    expect(readVolumes().size).toBe(0)
  })

  it("um valor fora de 0–2 é lixo e não entra", () => {
    // The cap moved to 2 when amplification stopped depending on the media element (see `VOLUME_MAX`). Above that is a broken record; below 0 means nothing. In both cases the person gets the factory volume.
    localStorage.setItem(
      VOLUMES_KEY,
      JSON.stringify([
        ["@alta:orwell.pt", 4],
        ["@negativa:orwell.pt", -1],
        ["@texto:orwell.pt", "0.5"],
        ["@boa:orwell.pt", 0.3],
        ["@amplificada:orwell.pt", 1.5],
      ]),
    )

    const lidos = readVolumes()
    expect([...lidos.keys()]).toEqual(["@boa:orwell.pt", "@amplificada:orwell.pt"])
    expect(lidos.get("@boa:orwell.pt")).toBe(0.3)
    expect(lidos.get("@amplificada:orwell.pt")).toBe(1.5)
  })

  it("guarda a escolha e devolve-a tal e qual", () => {
    writeVolumes(new Map([["@rita:orwell.pt", 0.4]]))

    expect(readVolumes().get("@rita:orwell.pt")).toBe(0.4)
  })

  it("voltar alguém a 100% APAGA a entrada em vez de a guardar", () => {
    // Being at 1 is the absence of choice. Saving it made the record grow with everyone you talk to, not just those you changed.
    writeVolumes(
      new Map([
        ["@rita:orwell.pt", 1],
        ["@bruno:orwell.pt", 0.2],
      ]),
    )

    const lidos = readVolumes()
    expect(lidos.has("@rita:orwell.pt")).toBe(false)
    expect(lidos.get("@bruno:orwell.pt")).toBe(0.2)
  })

  it("tem tecto, e o que fica são as escolhas mais recentes", () => {
    const muitos = new Map(Array.from({ length: 260 }, (_, i) => [`@p${i}:orwell.pt`, 0.5] as const))
    writeVolumes(muitos)

    const lidos = readVolumes()
    expect(lidos.size).toBe(200)
    expect(lidos.has("@p259:orwell.pt")).toBe(true)
    expect(lidos.has("@p0:orwell.pt")).toBe(false)
  })
})
