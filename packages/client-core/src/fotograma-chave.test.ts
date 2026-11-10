import { describe, expect, it } from "vitest"
import { VigiaDoFotogramaChave } from "./fotograma-chave.js"

/** Phase M2: when does the receiver request a keyframe. */
describe("VigiaDoFotogramaChave", () => {
  it("a primeira amostra é só a base, mesmo com contadores altos", () => {
    const vigia = new VigiaDoFotogramaChave()
    expect(vigia.amostra({ congelamentos: 9, pli: 40, chaves: 3 }, 0)).toBeNull()
  })

  it("pede quando a imagem congela, e quando há erros de descodificação", () => {
    const vigia = new VigiaDoFotogramaChave()
    vigia.amostra({ congelamentos: 0, chaves: 1 }, 0)
    expect(vigia.amostra({ congelamentos: 1, chaves: 1 }, 500)).toBe("congelou")
    const outra = new VigiaDoFotogramaChave()
    outra.amostra({ errosDeDescodificacao: 0 }, 0)
    expect(outra.amostra({ errosDeDescodificacao: 2 }, 500)).toBe("erros-de-descodificacao")
  })

  it("com os contadores parados não pede nada", () => {
    const vigia = new VigiaDoFotogramaChave()
    for (let t = 0; t <= 10_000; t += 500) expect(vigia.amostra({ congelamentos: 2, pli: 5, chaves: 7 + t / 500 }, t)).toBeNull()
  })

  it("um PLI do browser só se reforça quando não chega fotograma-chave na amostra seguinte", () => {
    const resolvido = new VigiaDoFotogramaChave()
    resolvido.amostra({ pli: 0, chaves: 1 }, 0)
    expect(resolvido.amostra({ pli: 1, chaves: 1 }, 500)).toBeNull()
    expect(resolvido.amostra({ pli: 1, chaves: 2 }, 1000)).toBeNull()

    const falhado = new VigiaDoFotogramaChave()
    falhado.amostra({ pli: 0, chaves: 1 }, 0)
    expect(falhado.amostra({ pli: 1, chaves: 1 }, 500)).toBeNull()
    expect(falhado.amostra({ pli: 1, chaves: 1 }, 1000)).toBe("pli-sem-chave")
  })

  it("não dispara em rajada: com os contadores a subir a cada amostra, no máximo um por segundo", () => {
    const vigia = new VigiaDoFotogramaChave()
    vigia.amostra({ congelamentos: 0 }, 0)
    const pedidos: number[] = []
    // Ten seconds of frozen video, sampled every 100 ms, counter always rising.
    for (let i = 1; i <= 100; i++) if (vigia.amostra({ congelamentos: i }, i * 100)) pedidos.push(i * 100)
    expect(pedidos.length).toBeLessThanOrEqual(10)
    expect(pedidos.length).toBeGreaterThanOrEqual(9)
    for (let i = 1; i < pedidos.length; i++) expect(pedidos[i]! - pedidos[i - 1]!).toBeGreaterThanOrEqual(1000)
  })

  it("um motivo dentro do intervalo fica devido e sai depois dele; um fotograma-chave entretanto apaga-o", () => {
    const vigia = new VigiaDoFotogramaChave()
    vigia.amostra({ congelamentos: 0, chaves: 0 }, 0)
    expect(vigia.amostra({ congelamentos: 1, chaves: 0 }, 100)).toBe("congelou")
    expect(vigia.amostra({ congelamentos: 2, chaves: 0 }, 400)).toBeNull()
    expect(vigia.amostra({ congelamentos: 2, chaves: 0 }, 1100)).toBe("congelou")

    const apagado = new VigiaDoFotogramaChave()
    apagado.amostra({ congelamentos: 0, chaves: 0 }, 0)
    expect(apagado.amostra({ congelamentos: 1, chaves: 0 }, 100)).toBe("congelou")
    expect(apagado.amostra({ congelamentos: 2, chaves: 0 }, 400)).toBeNull()
    expect(apagado.amostra({ congelamentos: 2, chaves: 1 }, 1100)).toBeNull()
  })

  it("a decifra que volta pede, com o mesmo tecto", () => {
    const vigia = new VigiaDoFotogramaChave()
    expect(vigia.videoVoltou(0)).toBe("decifra-voltou")
    expect(vigia.videoVoltou(300)).toBeNull()
    vigia.amostra({ chaves: 0 }, 400)
    expect(vigia.amostra({ chaves: 0 }, 1200)).toBe("decifra-voltou")
  })
})
