import { beforeEach, describe, expect, it } from "vitest"
import type { ChatMessage } from "../types.js"
import {
  aplicarMencoesComTodos,
  CANDIDATO_TODOS,
  inserirMencao,
  MENCAO_TODOS,
  mencionaMe,
  sugerirMencoesComTodos,
  type MentionCandidate,
} from "./mentions.js"
import { dirigidaAMim } from "./porAtender.js"
import { contarPorSala, esquecerLidasPorSala } from "./porLerPorSala.js"
import { chaveDoSilencio } from "./silenciados.js"
import { lembrarFichasDosCanais } from "./tipoDoCanal.js"

/**
 * `@all` (item #10 of the parity plan) on the UI side: the suggestion, the send,
 * and the detector that the bell, counters, and sound read.
 *
 * The core only lets `MENCAO_TODOS` reach the UI if the author has `mencionartodos`
 * in the room (`#comMencoesConferidas`, proven in `apps/server/src/mencionar-todos.test.ts`).
 * We trust that here.
 */

const ANA: MentionCandidate = { address: "@milsinda-odreto-viddyvox-pofletum:orwell.pt", name: "Ana" }
const ALICE: MentionCandidate = { address: "@sactynsis-peldenda-horriro-xethoga:orwell.pt", name: "Alice" }
const EU = "@toprico-nattygus-viscylla-mectynum:orwell.pt"
const CANAL = "!lagar:orwell.pt"

beforeEach(() => {
  lembrarFichasDosCanais({})
  localStorage.clear()
  esquecerLidasPorSala()
})

describe("a sugestão de @all", () => {
  it("só a quem tem a permissão, e sempre no fim: Enter nunca avisa o canal por engano", () => {
    expect(sugerirMencoesComTodos([ANA, ALICE], "", true).at(-1)).toBe(CANDIDATO_TODOS)
    expect(sugerirMencoesComTodos([ANA, ALICE], "", true)[0]).not.toBe(CANDIDATO_TODOS)
    expect(sugerirMencoesComTodos([ANA, ALICE], "a", true).map((c) => c.name)).toEqual(["Alice", "Ana", "all"])
    expect(sugerirMencoesComTodos([ANA, ALICE], "", false)).not.toContain(CANDIDATO_TODOS)
    expect(sugerirMencoesComTodos([ANA, ALICE], "all", false)).toEqual([])
  })

  it("pelas três palavras: all, todos, everyone", () => {
    expect(sugerirMencoesComTodos([ANA], "tod", true)).toEqual([CANDIDATO_TODOS])
    expect(sugerirMencoesComTodos([ANA], "ever", true)).toEqual([CANDIDATO_TODOS])
    expect(sugerirMencoesComTodos([ANA], "zzz", true)).toEqual([])
  })

  it("respeita o tecto de sugestões, com @all a contar", () => {
    const muitos = Array.from({ length: 30 }, (_, i) => ({ address: `@a-b-c-d${i}:x.pt`, name: `Al ${i}` }))
    const lista = sugerirMencoesComTodos(muitos, "al", true)
    expect(lista).toHaveLength(6)
    expect(lista.at(-1)).toBe(CANDIDATO_TODOS)
  })
})

describe("o envio de @all", () => {
  it("escolhido na lista: o corpo fica com @all, e a mensagem leva MENCAO_TODOS", () => {
    const { texto, pick } = inserirMencao("@a", 0, 2, CANDIDATO_TODOS)
    expect(texto).toBe("@all ")
    expect(aplicarMencoesComTodos(`${texto}reunião`, [pick], true)).toEqual({ corpo: "@all reunião", mentions: [MENCAO_TODOS] })
  })

  it("escrito à mão por quem tem a permissão conta, nas três palavras", () => {
    for (const corpo of ["@all olá", "olá @todos", "(@everyone) olá", "olá @ALL."]) {
      expect(aplicarMencoesComTodos(corpo, [], true).mentions).toEqual([MENCAO_TODOS])
    }
  })

  it("sem a permissão vai como texto normal: o corpo igual, e sem menção nenhuma", () => {
    const { pick } = inserirMencao("@a", 0, 2, CANDIDATO_TODOS)
    expect(aplicarMencoesComTodos("@all olá", [pick], false)).toEqual({ corpo: "@all olá", mentions: [] })
  })

  it("não confunde um email, outra palavra ou um endereço com @all", () => {
    for (const corpo of ["escreve para equipa@all.pt", "@allison chegou", "@todos-os-dias", "@all-b-c-d:x.pt"]) {
      expect(aplicarMencoesComTodos(corpo, [], true).mentions).toEqual([])
    }
  })

  it("junta-se às menções pelo nome, sem trocar o texto de @all", () => {
    const ana = inserirMencao("@an", 0, 3, ANA)
    const resultado = aplicarMencoesComTodos(`${ana.texto}e @all`, [ana.pick], true)
    expect(resultado.corpo).toBe(`${ANA.address} e @all`)
    expect(resultado.mentions).toEqual([ANA.address, MENCAO_TODOS])
  })
})

describe("o detector: a mensagem menciona-me?", () => {
  it("@all conta como menção para cada membro", () => {
    expect(mencionaMe([MENCAO_TODOS], EU)).toBe(true)
    expect(mencionaMe([MENCAO_TODOS], ANA.address)).toBe(true)
    expect(mencionaMe([MENCAO_TODOS], null)).toBe(false)
  })

  it("num sítio silenciado, @all não conta, e a menção pelo nome passa na mesma", () => {
    expect(mencionaMe([MENCAO_TODOS], EU, true)).toBe(false)
    expect(mencionaMe([MENCAO_TODOS, EU], EU, true)).toBe(true)
  })

  function dita(room: string, mentions: string[], sender = ANA.address): ChatMessage {
    return { channel: CANAL, seq: 1, sender, payload: { t: "message", id: "m1", body: "@all", sentAt: 50, room, mentions } } as ChatMessage
  }

  it("o sino (dirigidaAMim): conta, menos com a sala ou o canal silenciados", () => {
    expect(dirigidaAMim(EU)(dita("", [MENCAO_TODOS]))).toBe(true)
    expect(dirigidaAMim(EU, [CANAL])(dita("", [MENCAO_TODOS]))).toBe(false)
    expect(dirigidaAMim(EU, [chaveDoSilencio(CANAL, "recados")])(dita("recados", [MENCAO_TODOS]))).toBe(false)
    expect(dirigidaAMim(EU, [chaveDoSilencio(CANAL, "recados")])(dita("", [MENCAO_TODOS]))).toBe(true)
    // A message without MENCAO_TODOS (the author did not have the permission: the core stripped it) is not for me.
    expect(dirigidaAMim(EU)(dita("", []))).toBe(false)
  })

  it("o contador de menções da sala acende com @all, e não numa sala silenciada", () => {
    const salaDe = (_canal: string, etiqueta: string): string => etiqueta
    const mensagens = [dita("", [MENCAO_TODOS]), dita("recados", [MENCAO_TODOS]), dita("", [])]
    const contas = contarPorSala(mensagens, {}, {}, { canal: null, sala: "" }, EU, salaDe, [chaveDoSilencio(CANAL, "recados")])
    expect(contas.get(CANAL)?.get("")).toEqual({ todas: 2, mencoes: 1 })
    expect(contas.get(CANAL)?.get("recados")).toEqual({ todas: 1, mencoes: 0 })
  })
})
