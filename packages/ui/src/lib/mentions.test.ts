import { describe, expect, it } from "vitest"
import {
  aplicarMencoes,
  inserirMencao,
  MENTION_ADDRESS,
  mencaoEmCurso,
  mencionaMe,
  sugerirMencoes,
  type MentionCandidate,
} from "./mentions.js"

const ANA: MentionCandidate = { address: "@milsinda-odreto-viddyvox-pofletum:orwell.pt", name: "Ana" }
const RITA: MentionCandidate = { address: "@sactynsis-peldenda-horriro-xethoga:orwell.pt", name: "Ana Rita" }
const INES: MentionCandidate = { address: "@toprico-nattygus-viscylla-mectynum:orwell.pt", name: "Inês" }
const SEM_NOME: MentionCandidate = { address: "@gennore-biphora-zanfyno-tiptimus:orwell.pt", name: "gennor…" }
const TODOS = [ANA, RITA, INES, SEM_NOME]

describe("a arroba que está a ser escrita", () => {
  it("reconhece uma menção começada agora", () => {
    expect(mencaoEmCurso("olá @an", 7)).toEqual({ inicio: 4, procura: "an" })
  })

  it("reconhece a arroba sozinha, para escolher sem saber o nome de cor", () => {
    expect(mencaoEmCurso("@", 1)).toEqual({ inicio: 0, procura: "" })
  })

  it("não confunde um email com uma menção", () => {
    // The @ is glued to a letter: this is an email address, and opening a people menu
    // over it just gets in the way of whoever is typing.
    expect(mencaoEmCurso("escreve a ana@exemplo.pt", 24)).toBeNull()
  })

  it("fecha-se no espaço", () => {
    // Without this, an @ typed mid-morning would leave the menu open over the rest
    // of the text until someone hit Escape.
    expect(mencaoEmCurso("@ana disse que", 14)).toBeNull()
  })

  it("não se abre sobre um endereço já escrito por inteiro", () => {
    expect(mencaoEmCurso("@milsinda-odreto-viddyvox-pofletum:orwell.pt", 44)).toBeNull()
  })

  it("olha para o cursor e não para o fim do texto", () => {
    // Mentioning someone in the middle of already-written text is the normal case.
    const texto = "olá @an, tudo bem?"
    expect(mencaoEmCurso(texto, 7)).toEqual({ inicio: 4, procura: "an" })
  })
})

describe("quem aparece sugerido", () => {
  it("põe à frente quem começa pelo que se escreveu", () => {
    expect(sugerirMencoes(TODOS, "ana").map((c) => c.name)).toEqual(["Ana", "Ana Rita"])
  })

  it("encontra pela segunda palavra do nome, como o Facebook", () => {
    expect(sugerirMencoes(TODOS, "ri").map((c) => c.name)).toEqual(["Ana Rita"])
  })

  it("ignora acentos nos dois sentidos", () => {
    expect(sugerirMencoes(TODOS, "ines").map((c) => c.name)).toEqual(["Inês"])
    expect(sugerirMencoes(TODOS, "inê").map((c) => c.name)).toEqual(["Inês"])
  })

  it("encontra pelo endereço quem ainda não tem perfil publicado", () => {
    expect(sugerirMencoes(TODOS, "gennor").map((c) => c.address)).toEqual([SEM_NOME.address])
  })

  it("com a arroba sozinha mostra toda a gente", () => {
    expect(sugerirMencoes(TODOS, "")).toHaveLength(4)
  })

  it("respeita o tecto de sugestões", () => {
    const muitos = Array.from({ length: 30 }, (_, i) => ({ address: `@a-b-c-d${i}:x.pt`, name: `Pessoa ${i}` }))
    expect(sugerirMencoes(muitos, "pessoa")).toHaveLength(6)
  })

  it("não inventa ninguém quando nada corresponde", () => {
    expect(sugerirMencoes(TODOS, "zzz")).toEqual([])
  })
})

describe("meter a menção no texto", () => {
  it("substitui o que estava a ser escrito e deixa o cursor a seguir", () => {
    const { texto, cursor, pick } = inserirMencao("olá @an", 4, 7, ANA)
    expect(texto).toBe("olá @Ana ")
    expect(cursor).toBe(9)
    expect(pick).toEqual({ token: "@Ana", address: ANA.address })
  })

  it("mantém o resto da frase e devolve o cursor ao sítio certo", () => {
    // Returning just the text put the cursor at the end, and the rest of the phrase
    // jumped behind the hands of whoever was typing.
    const { texto, cursor } = inserirMencao("olá @an, tudo bem?", 4, 7, ANA)
    expect(texto).toBe("olá @Ana , tudo bem?")
    expect(cursor).toBe(9)
  })

  it("não duplica o espaço quando já havia um", () => {
    const { texto } = inserirMencao("@an ok", 0, 3, ANA)
    expect(texto).toBe("@Ana ok")
  })
})

describe("a troca do nome pelo endereço, no envio", () => {
  it("põe o endereço no corpo e na lista", () => {
    const { corpo, mentions } = aplicarMencoes("olá @Ana tudo bem?", [{ token: "@Ana", address: ANA.address }])
    expect(corpo).toBe(`olá ${ANA.address} tudo bem?`)
    expect(mentions).toEqual([ANA.address])
  })

  it("esquece quem foi escolhido e depois apagado à mão", () => {
    // Notifying someone who is no longer written anywhere is the app claiming something
    // that never happened.
    const { corpo, mentions } = aplicarMencoes("mudei de ideias", [{ token: "@Ana", address: ANA.address }])
    expect(corpo).toBe("mudei de ideias")
    expect(mentions).toEqual([])
  })

  it("não come o nome comprido ao trocar o curto", () => {
    // "@Ana" is the start of "@Ana Rita": swapping the short one first left the second
    // person unmentioned and their text broken in half.
    const { corpo, mentions } = aplicarMencoes("@Ana e @Ana Rita vêm", [
      { token: "@Ana", address: ANA.address },
      { token: "@Ana Rita", address: RITA.address },
    ])
    expect(corpo).toBe(`${ANA.address} e ${RITA.address} vêm`)
    expect(mentions).toHaveLength(2)
    expect(mentions).toContain(RITA.address)
  })

  it("a mesma pessoa nomeada duas vezes conta uma só", () => {
    const { mentions } = aplicarMencoes("@Ana e outra vez @Ana", [{ token: "@Ana", address: ANA.address }])
    expect(mentions).toEqual([ANA.address])
  })

  it("um corpo sem menções nenhumas sai como entrou", () => {
    expect(aplicarMencoes("uma frase normal", [])).toEqual({ corpo: "uma frase normal", mentions: [] })
  })
})

describe("o endereço reconhecido dentro do texto", () => {
  it("apanha o endereço inteiro, com porta e tudo", () => {
    // Without the port, a local server address got cut off mid-way and the mention did
    // not open anyone's profile.
    const texto = "olá @silfobis-poglotis-rephosa-vonvipa:localhost:8448 tudo bem"
    expect(texto.match(MENTION_ADDRESS)).toEqual(["@silfobis-poglotis-rephosa-vonvipa:localhost:8448"])
  })

  it("apanha um endereço de servidor com domínio", () => {
    expect("diz ao @milsinda-odreto-viddyvox-pofletum:orwell.pt".match(MENTION_ADDRESS)).toEqual([ANA.address])
  })

  it("não confunde um email com um endereço de conta", () => {
    expect("ana@exemplo.pt".match(MENTION_ADDRESS)).toBeNull()
  })
})

describe("fui eu que fui nomeado?", () => {
  it("sim, quando o meu endereço lá está", () => {
    expect(mencionaMe([ANA.address, RITA.address], ANA.address)).toBe(true)
  })

  it("não, quando não está — nem quando ainda não sei quem sou", () => {
    expect(mencionaMe([RITA.address], ANA.address)).toBe(false)
    expect(mencionaMe([ANA.address], null)).toBe(false)
    expect(mencionaMe(undefined, ANA.address)).toBe(false)
  })
})
