import { describe, expect, it } from "vitest"
import { strings } from "../strings.js"
import { avisoDaChamada, caminhoDoDetalhe, estadoDaPessoa, PACIENCIA_MS } from "./estadoDaChamada.js"

/**
 * The word "connecting..." covered four states, and three of them were not that.
 *
 * What made it indefensible, written in the core itself: in an SFU call
 * the `connected` the interface gets is `fluxos.has(address)`, "I am receiving
 * media from them", and there is no connection being set up with that person. The
 * connection is to the server and it is already up. A person in the roster with no stream
 * would draw as "connecting" until someone hung up.
 *
 * And the question none of the versions answered, because the state never changed:
 * **is this still on the way, or is it broken?**
 */
describe("estadoDaPessoa — quatro estados onde havia dois", () => {
  it("quem se ouve está ligado, em qualquer caminho", () => {
    for (const caminho of ["sfu", "malha", null] as const) {
      const estado = estadoDaPessoa({ connected: true, caminho, esperaMs: 0 })
      expect(estado.texto).toBe(strings.call.connected)
      expect(estado.tom).toBe("activo")
    }
  })

  it('na malha, e dentro do prazo, "a ligar" continua a descrever o que se passa', () => {
    const estado = estadoDaPessoa({ connected: false, caminho: "malha", esperaMs: 3_000 })
    expect(estado.texto).toBe(strings.call.connecting)
    expect(estado.tom).toBe("aEsperar")
  })

  it("no SFU, e dentro do prazo, ela está lá: o som é que não chegou", () => {
    // The entire fix, in one assertion. Nothing is connecting to anything.
    const estado = estadoDaPessoa({ connected: false, caminho: "sfu", esperaMs: 3_000 })
    expect(estado.texto).toBe(strings.call.naChamadaSemSom)
    expect(estado.texto).not.toBe(strings.call.connecting)
    expect(estado.tom).toBe("aEsperar")
  })

  it("passado o prazo, no SFU, deixa de ser uma reticência", () => {
    const estado = estadoDaPessoa({ connected: false, caminho: "sfu", esperaMs: PACIENCIA_MS })
    expect(estado.texto).toBe(strings.call.semSomHaMuito)
    expect(estado.tom).toBe("parado")
  })

  it("e na malha diz outra coisa, porque a avaria é outra", () => {
    // Two different failures: here we never got a connection set up at all; in the
    // SFU someone is there but their audio does not arrive. The reader must be able to tell which.
    const estado = estadoDaPessoa({ connected: false, caminho: "malha", esperaMs: PACIENCIA_MS })
    expect(estado.texto).toBe(strings.call.semLigacao)
    expect(estado.texto).not.toBe(strings.call.semSomHaMuito)
    expect(estado.tom).toBe("parado")
  })

  it("sem saber o caminho, fala como a malha sempre falou", () => {
    // The conservative reading: an unknown path cannot let the interface claim
    // "in the call" about someone who may not be.
    expect(estadoDaPessoa({ connected: false, caminho: null, esperaMs: 0 }).texto).toBe(strings.call.connecting)
    expect(estadoDaPessoa({ connected: false, caminho: null, esperaMs: PACIENCIA_MS }).texto).toBe(
      strings.call.semLigacao,
    )
  })

  it("o prazo é uma fronteira e não um sítio onde os dois lados coincidem", () => {
    const antes = estadoDaPessoa({ connected: false, caminho: "sfu", esperaMs: PACIENCIA_MS - 1 })
    const depois = estadoDaPessoa({ connected: false, caminho: "sfu", esperaMs: PACIENCIA_MS })
    expect(antes.tom).toBe("aEsperar")
    expect(depois.tom).toBe("parado")
    expect(antes.texto).not.toBe(depois.texto)
  })

  it("nenhum estado chega ao ecrã com o mesmo texto de outro", () => {
    // Proof this is not the same sentence four times. If two coincided, the interface
    // would have fewer states than facts again.
    const textos = [
      estadoDaPessoa({ connected: true, caminho: "sfu", esperaMs: 0 }).texto,
      estadoDaPessoa({ connected: false, caminho: "sfu", esperaMs: 0 }).texto,
      estadoDaPessoa({ connected: false, caminho: "malha", esperaMs: 0 }).texto,
      estadoDaPessoa({ connected: false, caminho: "sfu", esperaMs: PACIENCIA_MS }).texto,
      estadoDaPessoa({ connected: false, caminho: "malha", esperaMs: PACIENCIA_MS }).texto,
    ]
    expect(new Set(textos).size).toBe(textos.length)
  })
})

describe("caminhoDoDetalhe — o que o núcleo escreve, lido como é", () => {
  it("lê os três detalhes que o `call-caminho` emite", () => {
    // The literals are from `emit` in `call.ts`. Written by hand here on purpose:
    // if they change there, this is where someone will catch it.
    expect(caminhoDoDetalhe("sfu")).toBe("sfu")
    expect(caminhoDoDetalhe("malha: sem cifra de media")).toBe("malha")
    expect(caminhoDoDetalhe("malha: servidor sem sfu")).toBe("malha")
  })

  it("o que não reconhece é nulo, e nulo fala como a malha", () => {
    expect(caminhoDoDetalhe(undefined)).toBeNull()
    expect(caminhoDoDetalhe("")).toBeNull()
    expect(caminhoDoDetalhe("qualquer coisa nova")).toBeNull()
  })
})

/**
 * The three diagnoses that could not stay only in the log.
 *
 * The worst is documented in `call.ts`, next to the `emit`: two people in
 * the same room on different media paths never hear each other, and the comment
 * there spells out the outcome in advance, *"the other person will see 'connecting'
 * until they give up and someone asks why"*.
 */
describe("avisoDaChamada — o que o registo dizia e o ecrã calava", () => {
  const nomeDe = (quem: string): string => (quem === "@ana:s" ? "Ana" : quem)

  it("uma oferta de malha numa chamada por SFU é grave, e nomeia quem", () => {
    const aviso = avisoDaChamada("call-sfu-oferta-de-malha", "@ana:s", nomeDe)
    expect(aviso?.nivel).toBe("grave")
    expect(aviso?.texto).toContain("Ana")
    // And it says what to do. A warning that describes a failure but offers no way out
    // leaves the person exactly where they were.
    expect(aviso?.texto.toLowerCase()).toContain("voltem a entrar")
  })

  it("sem saber quem, diz-lo na mesma em vez de se calar", () => {
    const aviso = avisoDaChamada("call-sfu-oferta-de-malha", undefined, nomeDe)
    expect(aviso?.nivel).toBe("grave")
    expect(aviso?.texto).toBe(strings.call.avisoCaminhosDiferentes)
  })

  it("a chamada a voltar a ligar (1.3.7) é uma nota, e não o 403", () => {
    const aviso = avisoDaChamada("call-sfu-a-religar", "sala", nomeDe)
    expect(aviso).toEqual({ code: "call-sfu-a-religar", nivel: "nota", texto: strings.call.avisoARelegar })
  })

  it("a entrada falhada no SFU é grave e manda ao registo", () => {
    const aviso = avisoDaChamada("call-sfu-entrada-falhou", "createEncodedStreams is not a function", nomeDe)
    expect(aviso?.nivel).toBe("grave")
    // The mechanics do NOT go in the sentence: `createEncodedStreams is not a function`
    // is exact and means nothing to someone who just wanted to talk to someone. It goes
    // in the log, by name, which is where the message sends them.
    expect(aviso?.texto).not.toContain("createEncodedStreams")
    expect(aviso?.texto).toContain("Diagnóstico")
  })

  it("a presença caducada é nota e não avaria: a chamada continua", () => {
    const aviso = avisoDaChamada("call-presenca-caducou", "@ana:s", nomeDe)
    expect(aviso?.nivel).toBe("nota")
    expect(aviso?.texto).toContain("Ana")
  })

  it("quem ainda não tem chave é nota com código, e nomeia quem (3/11/2026)", () => {
    const aviso = avisoDaChamada("sfu-receptor-sem-chave", "@ana:s", nomeDe)
    expect(aviso?.nivel).toBe("nota")
    // Number on one line, message on the next, like any error.
    expect(aviso?.texto.split("\n")[0]).toBe(strings.errors.codigo(447))
    expect(aviso?.texto).toContain("Ana")
    // A cipher that fails for another reason stays only in the log.
    expect(avisoDaChamada("sfu-receptor-sem-cifra", "@ana:s", nomeDe)).toBeNull()
  })

  it("a nossa fonte à espera da cifra é nota com o 449, e diz qual (4/11/2026)", () => {
    const aviso = avisoDaChamada("sfu-emissor-cifra-a-repetir", "microfone · 2/7 · 500 ms", nomeDe)
    expect(aviso?.nivel).toBe("nota")
    expect(aviso?.texto.split("\n")[0]).toBe(strings.errors.codigo(449))
    expect(aviso?.texto).toContain("microfone")
    expect(avisoDaChamada("sfu-emissor-cifra-a-repetir", "ecra · 2/7 · 500 ms", nomeDe)?.texto).toContain("ecrã")
    // What happens next goes in the log: recovery clears the warning, and
    // giving up is reported as 448 in the `error` event.
    expect(avisoDaChamada("sfu-emissor-cifra-recuperada", "microfone · 3/7", nomeDe)).toBeNull()
  })

  it("o som de alguém que o servidor recusou e que se pede outra vez é nota com o 453 (4/11/2026)", () => {
    const aviso = avisoDaChamada("sfu-consumo-em-falta", "@ana:s · microfone · p-1", nomeDe)
    expect(aviso?.nivel).toBe("nota")
    expect(aviso?.texto.split("\n")[0]).toBe(strings.errors.codigo(453))
    expect(aviso?.texto).toContain("Ana")
    // Voice only: a missing camera is not "you can't hear me".
    expect(avisoDaChamada("sfu-consumo-em-falta", "@ana:s · camara · p-2", nomeDe)).toBeNull()
    // The rest of the consumption mechanics goes in the log.
    expect(avisoDaChamada("sfu-consumo-recusado", "p-1 · x", nomeDe)).toBeNull()
    expect(avisoDaChamada("sfu-consumo-recuperado", "p-1 · @ana:s · tentativa 2", nomeDe)).toBeNull()
  })

  it("e a mecânica continua onde estava, que é o registo", () => {
    // This is the half that keeps the remedy from becoming the disease. One warning per
    // line of mechanics is the popup column that `statusPolicy` exists to avoid,
    // and these four describe plumbing that runs well.
    for (const code of ["call-sfu-ligado", "call-caminho", "call-sfu-sem-cifra-de-media", "call-leave"]) {
      expect(avisoDaChamada(code, "seja o que for", nomeDe), code).toBeNull()
    }
  })
})
