import { RecusaDoSfu } from "@enclave/client-core"
import { afterEach, describe, expect, it } from "vitest"
import { definirLingua, translateError, traduzirErro } from "../strings.js"
import { fraseDoStatus } from "./statusPolicy.js"

afterEach(() => definirLingua("pt"))

/** A browser error as engines throw it: the `name` says what it is, the message is engine-specific. */
function erroDoBrowser(name: string, message: string): Error {
  const erro = new Error(message)
  erro.name = name
  return erro
}

describe("traduzirErro: o erro inteiro, e não só a mensagem", () => {
  it("um erro do núcleo passa como no translateError, com o cause", () => {
    const erro = new Error("the room has the maximum of pinned messages", { cause: { max: 3 } })
    expect(traduzirErro(erro)).toBe(translateError(erro.message, erro.cause))
    expect(traduzirErro(erro)).toMatch(/^Erro 330\n.*3 mensagens fixas/)
  })

  it("um erro do browser ganha o código pelo `name`, seja qual for a frase do motor", () => {
    expect(traduzirErro(erroDoBrowser("NotAllowedError", "Permission denied"))).toMatch(/^Erro 404\n/)
    expect(traduzirErro(erroDoBrowser("NotAllowedError", "The request is not allowed by the user agent"))).toMatch(
      /^Erro 404\n/,
    )
    expect(traduzirErro(erroDoBrowser("NotFoundError", "Requested device not found"))).toMatch(/^Erro 405\n/)
    expect(traduzirErro(erroDoBrowser("NotReadableError", "Could not start audio source"))).toMatch(/^Erro 406\n/)
    expect(traduzirErro(erroDoBrowser("InvalidStateError", "x"))).toMatch(/^Erro 409\n/)
    expect(traduzirErro(erroDoBrowser("SecurityError", "x"))).toMatch(/^Erro 410\n/)
    // Full storage is a full vault: same fix, same code.
    expect(traduzirErro(erroDoBrowser("QuotaExceededError", "x"))).toMatch(/^Erro 106\n/)
  })

  it("um DOMException a sério também", () => {
    expect(traduzirErro(new DOMException("Permission denied", "NotAllowedError"))).toMatch(/^Erro 404\n/)
  })

  it("a recusa do microfone no Electron chega só com a mensagem, e tem código na mesma", () => {
    expect(traduzirErro(new Error("Permission denied by system"))).toMatch(/^Erro 404\n/)
  })

  it("uma recusa do SFU diz o que é, e não a frase portuguesa do servidor", () => {
    const recusa = new RecusaDoSfu("chamada-cheia", "esta chamada já tem 12 pessoas")
    expect(traduzirErro(recusa)).toBe("Erro 425\nEsta chamada está cheia. O servidor não aguenta mais pessoas.")
    expect(traduzirErro(new RecusaDoSfu("transporte-desconhecido", "esse transporte não existe"))).toMatch(/^Erro 430\n/)
  })

  it("o imprevisto é o 900: a frase fixa e a mensagem em cru, nas duas línguas", () => {
    expect(traduzirErro(new TypeError("x is not a function"))).toBe(
      "Erro 900\nAconteceu um erro que a app não conhece.\nx is not a function",
    )
    definirLingua("en")
    expect(traduzirErro(new TypeError("x is not a function"))).toBe(
      "Error 900\nThe app does not know this error.\nx is not a function",
    )
  })

  it("quem atira uma string ou nada não parte a tradução", () => {
    expect(traduzirErro("vault is locked")).toMatch(/^Erro 101\n/)
    expect(traduzirErro(undefined)).toBe("Erro 900\nAconteceu um erro que a app não conhece.")
  })
})

describe("os erros da chamada (`call.ts`) com os dados no cause", () => {
  it("o microfone que não abre diz porquê, pelo nome do erro do browser", () => {
    expect(translateError("could not open the microphone", { nome: "NotAllowedError" })).toBe(
      "Erro 412\nNão foi possível abrir o microfone. Verifica as permissões do sistema.",
    )
    expect(translateError("could not open the microphone", { nome: "NotReadableError" })).toBe(
      "Erro 412\nNão foi possível abrir o microfone. Outra app está a usá-lo.",
    )
    expect(translateError("could not open the camera or the microphone")).toMatch(/^Erro 413\n/)
  })

  it("a partilha de ecrã recusada por haver gente a mais diz os números", () => {
    const servidor = translateError("the call is too large to share a screen", { pessoas: 9, tecto: 8, caminho: "servidor" })
    expect(servidor).toMatch(/^Erro 420\nJá são 9 pessoas na chamada\. O ecrã sai do servidor/)
    const directo = translateError("the call is too large to share a screen", { pessoas: 7, tecto: 6, caminho: "directo" })
    expect(directo).toMatch(/O ecrã vai directo para cada pessoa\. Acima de 6 pessoas/)
    // No data, one complete sentence.
    expect(translateError("the call is too large to share a screen")).toMatch(/^Erro 420\nA chamada tem pessoas a mais/)
  })

  it("a frase não mostra o endereço de quem não respondeu", () => {
    const frase = translateError("that person did not answer the call", { pessoa: "@ana:servidor.pt" })
    expect(frase).toMatch(/^Erro 415\n/)
    expect(frase).not.toContain("@ana")
  })
})

describe("os avisos do núcleo que são erros saem com código (`fraseDoStatus`)", () => {
  const rotulo = (canal: string): string => (canal === "!lagar:s" ? "lagar" : canal)

  it("um erro fatal do servidor, pelo código dele", () => {
    const status = (detail: string) => fraseDoStatus({ detail, level: "error", code: "server-error" }, rotulo)
    expect(status("address-taken: address bound to another key")).toMatch(/^Erro 210\n/)
    expect(status("key-mismatch: key does not match address")).toMatch(/^Erro 211\n/)
    expect(status("bad-device-cert: device is not this account's")).toMatch(/^Erro 718\n/)
    expect(status("frame-too-large: frame exceeds 1048576 bytes")).toMatch(/^Erro 213\n/)
    expect(status("rate-limited: too many pair.join")).toMatch(/^Erro 708\n/)
    expect(status("bad-signature: challenge not satisfied")).toBe(
      "Erro 212\nO servidor fechou a ligação. A app tenta ligar de novo. Código do servidor: bad-signature.",
    )
  })

  it("os canais ilegíveis, o canal recriado e o canal órfão", () => {
    expect(
      fraseDoStatus({ detail: "2 canal(is) com estado ilegível, ignorado(s)", level: "error", code: "channels-unreadable" }, rotulo),
    ).toBe("Erro 351\nNão foi possível ler 2 canais neste aparelho. Esses canais ficaram de fora.")
    expect(
      fraseDoStatus({ detail: "!lagar:s: o estado…", level: "error", code: "channel-forked", channel: "!lagar:s" }, rotulo),
    ).toBe('Erro 349\nO canal "lagar" perdeu o estado e foi recriado. Convida outra vez quem lá estava.')
    expect(fraseDoStatus({ detail: "Esta sala…", level: "error", code: "channel-orphaned" }, rotulo)).toMatch(/^Erro 350\n/)
    expect(fraseDoStatus({ detail: "As contas…", level: "error", code: "identity-obsolete" }, rotulo)).toMatch(/^Erro 112\n/)
  })

  it("o convite recusado, pela frase de hoje e pela chave do diff", () => {
    const convite = (detail: string) => fraseDoStatus({ detail, level: "error", code: "invite-rejected" }, rotulo)
    expect(convite("Esse convite expirou.")).toMatch(/^Erro 344\n/)
    expect(convite("that invite expired")).toMatch(/^Erro 344\n/)
    expect(convite("Esse convite já atingiu o limite de utilizações.")).toMatch(/^Erro 352\n/)
    expect(convite("that invite reached its limit")).toMatch(/^Erro 352\n/)
    expect(convite("Esse convite não existe ou foi revogado.")).toMatch(/^Erro 343\n/)
  })
})

/*
 * SEC-02: a source that did not go out because its cipher was not ready. A new
 * code (448), and the sentence says what was left out, via the source in `cause`.
 */
describe("a cifra do emissor que não ficou pronta (448)", () => {
  it("o microfone: a pessoa saiu da chamada, e sabe porquê", () => {
    const texto = translateError("the call media could not be encrypted", { fonte: "microfone" })
    expect(texto).toMatch(/^Erro 448\n/)
    expect(texto).toContain("Saíste da chamada")
  })

  it("as outras fontes dizem o que ficou de fora, nas duas línguas", () => {
    expect(translateError("the call media could not be encrypted", { fonte: "camara" })).toContain("câmara")
    expect(translateError("the call media could not be encrypted", { fonte: "ecra" })).toContain("ecrã")
    expect(translateError("the call media could not be encrypted", { fonte: "ecra-som" })).toContain("som do ecrã")
    expect(translateError("the call media could not be encrypted", { fonte: "musica" })).toContain("música")
    definirLingua("en")
    const texto = translateError("the call media could not be encrypted", { fonte: "camara" })
    expect(texto).toMatch(/^Error 448\n/)
    expect(texto).toContain("camera")
  })
})

/*
 * The same cipher while still trying (4/11/2026): a new code (449), never
 * 448, because it is not the same fact. 448 says it gave up; 449 says it
 * has not gone out yet and will go out on its own.
 */
describe("a cifra do emissor a tentar outra vez (449)", () => {
  it("o microfone, nas duas línguas", () => {
    const texto = translateError("your media is not going out yet", { fonte: "microfone" })
    expect(texto).toBe("Erro 449\nO teu microfone ainda não está a enviar: a preparar a cifra.")
    definirLingua("en")
    expect(translateError("your media is not going out yet", { fonte: "microfone" })).toBe(
      "Error 449\nYour microphone is not sending yet: preparing the encryption.",
    )
  })

  it("o som de alguém que a app pede outra vez tem o seu código (453), nas duas línguas", () => {
    expect(translateError("the sound of this person is not here yet", { nome: "Ana" })).toBe(
      "Erro 453\nAinda não ouves Ana. A app está a pedir o som outra vez.",
    )
    definirLingua("en")
    expect(translateError("the sound of this person is not here yet", { nome: "Ana" })).toBe(
      "Error 453\nYou cannot hear Ana yet. The app is asking for the sound again.",
    )
  })

  it("o microfone que pára sem parar tem o seu código (452)", () => {
    expect(translateError("the microphone keeps stopping")).toBe(
      "Erro 452\nO teu microfone parou várias vezes. Sai e entra outra vez na chamada.",
    )
  })

  it("as outras fontes nomeiam-se", () => {
    expect(translateError("your media is not going out yet", { fonte: "camara" })).toContain("câmara")
    expect(translateError("your media is not going out yet", { fonte: "ecra" })).toContain("ecrã")
    expect(translateError("your media is not going out yet", { fonte: "ecra-som" })).toContain("som do teu ecrã")
    expect(translateError("your media is not going out yet", { fonte: "musica" })).toContain("música")
  })
})
