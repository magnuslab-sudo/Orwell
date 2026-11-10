import { generateIdentity, parseServerName } from "@enclave/protocol"
import {
  addMembers,
  createChannel,
  encryptPayload,
  epochOf,
  generateKeyPackages,
  joinChannel,
  joinChannelExternally,
  publishableGroupInfo,
  receive,
  rotateEpoch,
  type GroupSession,
} from "@enclave/crypto"
import { createCommit, createProposal, decodeMlsMessage, encodeMlsMessage, makePskIndex, type Proposal } from "ts-mls"
import { beforeAll, describe, expect, it } from "vitest"
import { lerCabecalhoMls } from "./cabecalho-mls.js"

/**
 * The MLS header read by the server, tested against REAL frames.
 *
 * No byte here is written by hand. This lesson was learned the hard way:
 * the server suite passed with critical defenses disabled, because it tested
 * formats built by the test itself, and a hand-built format always agrees
 * with the parser of whoever built it. Here frames come from `@enclave/crypto`
 * (and, for the two forms the product does not emit today, from the `ts-mls` it
 * uses), and we compare what the parser reads against what the group says about
 * itself.
 */

const HOME = parseServerName("enclave.test")
const CANAL = "!984:enclave.test"
const bytesDe = (texto: string): Uint8Array => new TextEncoder().encode(texto)

interface Frames {
  cartaoEpoch0: Uint8Array
  commitPrivadoEpoch0: Uint8Array
  welcome: Uint8Array
  aplicacaoEpoch1: Uint8Array
  propostaPrivadaEpoch1: Uint8Array
  propostaPublicaEpoch1: Uint8Array
  commitPublicoDeMembroEpoch1: Uint8Array
  commitExternoEpoch2: Uint8Array
  commitPrivadoEpoch5: Uint8Array
  keyPackage: Uint8Array
}

/** Authenticated data with 70 bytes: the length now takes two bytes. */
const DADOS_AUTENTICADOS = new Uint8Array(70).fill(7)

let frames: Frames

beforeAll(async () => {
  const fundador = generateIdentity(HOME)
  const convidado = generateIdentity(HOME)
  const deFora = generateIdentity(HOME)

  let sala: GroupSession = await createChannel(fundador, CANAL)
  const cartaoEpoch0 = await publishableGroupInfo(sala)

  const [pacoteDoConvidado] = await generateKeyPackages(convidado, 1)
  const [pacoteDeFora] = await generateKeyPackages(deFora, 1)
  if (!pacoteDoConvidado || !pacoteDeFora) throw new Error("sem key packages")

  const adicao = await addMembers(sala, [pacoteDoConvidado.publicPackage])
  sala = adicao.session
  const salaDoConvidado = await joinChannel(
    CANAL,
    adicao.welcome,
    pacoteDoConvidado.publicPackage,
    pacoteDoConvidado.privatePackage,
  )
  expect(epochOf(sala)).toBe(1n)
  expect(epochOf(salaDoConvidado)).toBe(1n)

  const aplicacao = await encryptPayload(sala, {
    t: "message",
    id: crypto.randomUUID(),
    sentAt: 1_700_000_000_000,
    body: "olá",
    attachments: [],
    links: [],
    mentions: [],
  })
  sala = aplicacao.session

  const remover: Proposal = { proposalType: "remove", remove: { removed: 1 } }
  const propostaPrivada = await createProposal(sala.state, false, remover, sala.suite)
  const propostaPublica = await createProposal(sala.state, true, remover, sala.suite, DADOS_AUTENTICADOS)

  // A plaintext member commit: the product encrypts its own, but the RFC allows it, and
  // it is the only way to test reading a `member` sender in a commit.
  const commitPublico = await createCommit(
    { state: sala.state, cipherSuite: sala.suite, pskIndex: makePskIndex(sala.state, {}) },
    { wireAsPublicMessage: true, authenticatedData: DADOS_AUTENTICADOS },
  )

  // The branch that follows: an encrypted commit takes the room to epoch 2, and anyone
  // arriving from outside joins with that epoch's card.
  const rotacao = await rotateEpoch(sala)
  sala = rotacao.session
  expect(epochOf(sala)).toBe(2n)
  const entrada = await joinChannelExternally(
    CANAL,
    await publishableGroupInfo(sala),
    pacoteDeFora.publicPackage,
    pacoteDeFora.privatePackage,
  )
  const aplicada = await receive(sala, entrada.commit)
  expect(aplicada.kind).toBe("epoch")
  sala = aplicada.session

  while (epochOf(sala) < 5n) sala = (await rotateEpoch(sala)).session
  const commitEpoch5 = await rotateEpoch(sala)

  frames = {
    cartaoEpoch0,
    commitPrivadoEpoch0: adicao.commit,
    welcome: adicao.welcome,
    aplicacaoEpoch1: aplicacao.ciphertext,
    propostaPrivadaEpoch1: encodeMlsMessage(propostaPrivada.message),
    propostaPublicaEpoch1: encodeMlsMessage(propostaPublica.message),
    commitPublicoDeMembroEpoch1: encodeMlsMessage(commitPublico.commit),
    commitExternoEpoch2: entrada.commit,
    commitPrivadoEpoch5: commitEpoch5.commits[0] as Uint8Array,
    keyPackage: pacoteDoConvidado.wire,
  }
}, 60_000)

describe("o que um frame MLS diz de si em claro", () => {
  it("o commit que acrescenta alguém: cifrado, na epoch de onde partiu", () => {
    expect(lerCabecalhoMls(frames.commitPrivadoEpoch0)).toEqual({
      formato: "private_message",
      grupo: bytesDe(CANAL),
      epoch: 0n,
      conteudo: "commit",
    })
  })

  it("uma mensagem de aplicação e uma proposta cifradas não passam por commit", () => {
    expect(lerCabecalhoMls(frames.aplicacaoEpoch1)).toEqual({
      formato: "private_message",
      grupo: bytesDe(CANAL),
      epoch: 1n,
      conteudo: "application",
    })
    expect(lerCabecalhoMls(frames.propostaPrivadaEpoch1)).toEqual({
      formato: "private_message",
      grupo: bytesDe(CANAL),
      epoch: 1n,
      conteudo: "proposal",
    })
  })

  it("em claro, o remetente e os dados autenticados ficam entre a epoch e o tipo", () => {
    expect(lerCabecalhoMls(frames.propostaPublicaEpoch1)).toEqual({
      formato: "public_message",
      grupo: bytesDe(CANAL),
      epoch: 1n,
      remetente: "member",
      conteudo: "proposal",
    })
    expect(lerCabecalhoMls(frames.commitPublicoDeMembroEpoch1)).toEqual({
      formato: "public_message",
      grupo: bytesDe(CANAL),
      epoch: 1n,
      remetente: "member",
      conteudo: "commit",
    })
  })

  it("o commit externo de quem entra pelo cartão: em claro, sem folha, na epoch do cartão", () => {
    expect(lerCabecalhoMls(frames.commitExternoEpoch2)).toEqual({
      formato: "public_message",
      grupo: bytesDe(CANAL),
      epoch: 2n,
      remetente: "new_member_commit",
      conteudo: "commit",
    })
  })

  it("a epoch é um u64 lido inteiro, e não o último byte", () => {
    const cabecalho = lerCabecalhoMls(frames.commitPrivadoEpoch5)
    expect(cabecalho).toMatchObject({ formato: "private_message", epoch: 5n, conteudo: "commit" })
  })

  it("o cartão diz o grupo e a epoch que descreve", () => {
    expect(lerCabecalhoMls(frames.cartaoEpoch0)).toEqual({ formato: "group_info", grupo: bytesDe(CANAL), epoch: 0n })
  })

  it("um Welcome e um key package não dizem grupo nem epoch", () => {
    expect(lerCabecalhoMls(frames.welcome)).toEqual({ formato: "welcome" })
    expect(lerCabecalhoMls(frames.keyPackage)).toEqual({ formato: "key_package" })
  })
})

describe("comprimentos de mais de um byte, com grupos a sério", () => {
  it("um identificador de 64 bytes ou mais leva o comprimento em dois", async () => {
    const canal = `!${"a".repeat(80)}:enclave.test`
    const dono = generateIdentity(HOME)
    const sala = await createChannel(dono, canal)
    expect(lerCabecalhoMls(await publishableGroupInfo(sala))).toEqual({
      formato: "group_info",
      grupo: bytesDe(canal),
      epoch: 0n,
    })
    const rotacao = await rotateEpoch(sala)
    expect(lerCabecalhoMls(rotacao.commits[0] as Uint8Array)).toEqual({
      formato: "private_message",
      grupo: bytesDe(canal),
      epoch: 0n,
      conteudo: "commit",
    })
  }, 30_000)

  it("e um de 16384 bytes ou mais leva-o em quatro", async () => {
    const canal = `!${"b".repeat(16_400)}:enclave.test`
    const dono = generateIdentity(HOME)
    const sala = await createChannel(dono, canal)
    const rotacao = await rotateEpoch(sala)
    expect(lerCabecalhoMls(rotacao.commits[0] as Uint8Array)).toEqual({
      formato: "private_message",
      grupo: bytesDe(canal),
      epoch: 0n,
      conteudo: "commit",
    })
    expect(lerCabecalhoMls(await publishableGroupInfo(rotacao.session))).toMatchObject({ epoch: 1n })
  }, 30_000)
})

describe("bytes que não se deixam ler", () => {
  const todos = (): [string, Uint8Array][] => Object.entries(frames)

  it("nunca lança, seja qual for o corte", () => {
    for (const [nome, frame] of todos()) {
      for (let corte = 0; corte <= frame.length; corte++) {
        expect(() => lerCabecalhoMls(frame.subarray(0, corte)), `${nome} cortado em ${corte}`).not.toThrow()
      }
    }
  })

  it("um corte ou devolve nada, ou devolve exactamente o que o frame inteiro diz", () => {
    // A parser that reads a field from the wrong place gives different answers
    // depending on the length of its input. This catches it without knowing where.
    for (const [nome, frame] of todos()) {
      const inteiro = lerCabecalhoMls(frame)
      for (let corte = 0; corte < frame.length; corte++) {
        const cortado = lerCabecalhoMls(frame.subarray(0, corte))
        if (cortado !== undefined) expect(cortado, `${nome} cortado em ${corte}`).toEqual(inteiro)
      }
    }
  })

  it("cifrado ou cartão, qualquer corte é ilegível: os comprimentos são verificados até ao fim", () => {
    for (const nome of ["commitPrivadoEpoch0", "aplicacaoEpoch1", "propostaPrivadaEpoch1", "cartaoEpoch0"] as const) {
      const frame = frames[nome]
      for (let corte = 0; corte < frame.length; corte++) {
        expect(lerCabecalhoMls(frame.subarray(0, corte)), `${nome} cortado em ${corte}`).toBeUndefined()
      }
    }
  })

  it("em claro, o cabeçalho acaba no tipo de conteúdo: um byte antes disso é ilegível", () => {
    // version u16, wire_format u16, group_id<V>, epoch u64, sender (u8 + u32
    // for `member`), authenticated_data<V>, content_type u8 (RFC 9420 §6).
    const grupo = bytesDe(CANAL).length
    const membro = 2 + 2 + 1 + grupo + 8 + 5 + 2 + DADOS_AUTENTICADOS.length + 1
    const externo = 2 + 2 + 1 + grupo + 8 + 1 + 1 + 1
    const casos: [Uint8Array, number][] = [
      [frames.commitPublicoDeMembroEpoch1, membro],
      [frames.propostaPublicaEpoch1, membro],
      [frames.commitExternoEpoch2, externo],
    ]
    for (const [frame, fim] of casos) {
      expect(lerCabecalhoMls(frame.subarray(0, fim - 1))).toBeUndefined()
      expect(lerCabecalhoMls(frame.subarray(0, fim))).toEqual(lerCabecalhoMls(frame))
    }
  })

  /** A real frame with one byte changed. The rest is still what the group emitted. */
  function comByte(frame: Uint8Array, posicao: number, valor: number): Uint8Array {
    const copia = frame.slice()
    copia[posicao] = valor
    return copia
  }

  it("versão, formato, tipo de conteúdo e remetente fora do registo são ilegíveis", () => {
    const grupo = bytesDe(CANAL).length
    const tipoPrivado = 2 + 2 + 1 + grupo + 8
    const remetentePublico = 2 + 2 + 1 + grupo + 8

    expect(lerCabecalhoMls(comByte(frames.commitPrivadoEpoch0, 1, 2))).toBeUndefined()
    expect(lerCabecalhoMls(comByte(frames.commitPrivadoEpoch0, 3, 6))).toBeUndefined()
    expect(lerCabecalhoMls(comByte(frames.commitPrivadoEpoch0, 3, 0))).toBeUndefined()
    expect(lerCabecalhoMls(comByte(frames.commitPrivadoEpoch0, tipoPrivado, 0))).toBeUndefined()
    expect(lerCabecalhoMls(comByte(frames.commitPrivadoEpoch0, tipoPrivado, 4))).toBeUndefined()
    expect(lerCabecalhoMls(comByte(frames.commitExternoEpoch2, remetentePublico, 0))).toBeUndefined()
    expect(lerCabecalhoMls(comByte(frames.commitExternoEpoch2, remetentePublico, 5))).toBeUndefined()
    // And the card context version, which is another field.
    expect(lerCabecalhoMls(comByte(frames.cartaoEpoch0, 5, 2))).toBeUndefined()
  })

  /**
   * The same commit, with the group id length rewritten in four bytes.
   *
   * Byte 4 is a one-byte length (the identifier is under 64 bytes); it is
   * replaced by `prefixo 00 00 comprimento`, and the rest of the
   * frame stays as the group sent it.
   */
  function comComprimentoEmQuatro(frame: Uint8Array, prefixo: number): Uint8Array {
    const comprimento = frame[4] as number
    expect(comprimento >> 6).toBe(0)
    return new Uint8Array([...frame.subarray(0, 4), prefixo, 0, 0, comprimento, ...frame.subarray(5)])
  }

  it("um comprimento em mais bytes do que o preciso lê-se, como o ts-mls o lê", () => {
    // If the server were stricter than the client, this commit, which the client
    // applies, would count as unreadable, and an unreadable frame does not count toward
    // the one-commit-per-epoch rule.
    const esticado = comComprimentoEmQuatro(frames.commitPrivadoEpoch0, 0b1000_0000)
    expect(decodeMlsMessage(esticado, 0)?.[0]).toMatchObject({ wireformat: "mls_private_message" })
    expect(lerCabecalhoMls(esticado)).toEqual(lerCabecalhoMls(frames.commitPrivadoEpoch0))
  })

  it("o prefixo de comprimento 0b11 não existe em MLS", () => {
    const proibido = comComprimentoEmQuatro(frames.commitPrivadoEpoch0, 0b1100_0000)
    // ts-mls rejects it by throwing; the server rejects it without throwing.
    expect(() => decodeMlsMessage(proibido, 0)).toThrow(/8-byte length/)
    expect(lerCabecalhoMls(proibido)).toBeUndefined()
  })

  it("lixo e vazio não são frame nenhum", () => {
    expect(lerCabecalhoMls(new Uint8Array())).toBeUndefined()
    expect(lerCabecalhoMls(bytesDe("commit externo"))).toBeUndefined()
  })
})

