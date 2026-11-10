import {
  addMembers,
  createChannel,
  encryptPayload,
  generateKeyPackages,
  joinChannel,
  publishableGroupInfo,
  rotateEpoch,
  type GroupSession,
} from "@enclave/crypto"
import {
  CAPACIDADE_COFRE_CIFRADO,
  fromBase64,
  generateIdentity,
  PROTOCOL_VERSION,
  sign,
  toBase64,
  type Identity,
  type ServerFrame,
} from "@enclave/protocol"
import { randomBytes } from "node:crypto"
import { createProposal, encodeMlsMessage } from "ts-mls"
import { WebSocket } from "ws"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Cliente, COMMIT_DEPOIS_DO_ECO, levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"

/**
 * The old client: converses, but does not commit or touch the card.
 *
 * The bundle `eabfd6c` applies its commit BEFORE sending it. When it loses
 * the race for the epoch it ends up alone in E+1, and from then on everything
 * it sends comes from that branch: the next commit and the card it publishes.
 * If the server accepted either one, it would start following a single-person
 * branch and lock the room for everyone. So a connection is only trusted for
 * commits if the `hello` says `commit-after-echo`, and what does not depend on
 * that (conversing, proposals, Welcomes, history) keeps working for who has not updated.
 */

let servidor: ServidorDeTeste

/** The common room with an updated founder, an old member, and the room at epoch 2. */
interface Cena {
  idFundador: Identity
  idAntigo: Identity
  fundador: Cliente
  grupoDoFundador: GroupSession
  antigo: Cliente
  grupoDoAntigo: GroupSession
  cartao: Uint8Array
}

let cena: Cena

async function montar(): Promise<Cena> {
  const { url, casa, sala } = servidor
  const idFundador = generateIdentity(casa)
  const idAntigo: Identity = generateIdentity(casa)

  const fundador = await Cliente.ligar(url, idFundador)
  fundador.enviar({ t: "channel.subscribe", channels: [sala] })
  fundador.enviar({ t: "channel.send", channel: sala, kind: "application", ciphertext: toBase64(new Uint8Array([1])) })
  await fundador.proximoDe("channel.event")

  const fundacao = await rotateEpoch(await createChannel(idFundador, sala))
  fundador.enviar({ t: "channel.send", channel: sala, kind: "handshake", ciphertext: toBase64(fundacao.commits[0] as Uint8Array) })
  await fundador.proximoDe("channel.event")

  const [pacote] = await generateKeyPackages(idAntigo, 1)
  if (!pacote) throw new Error("sem key package")
  const adicao = await addMembers(fundacao.session, [pacote.publicPackage])
  fundador.enviar({ t: "channel.send", channel: sala, kind: "handshake", ciphertext: toBase64(adicao.commit) })
  await fundador.proximoDe("channel.event")
  fundador.enviar({
    t: "channel.send",
    channel: sala,
    kind: "welcome",
    ciphertext: toBase64(adicao.welcome),
    recipient: idAntigo.address,
  })
  const cartao = await publishableGroupInfo(adicao.session)
  fundador.enviar({ t: "channel.groupinfo.put", channel: sala, info: toBase64(cartao) })
  expect((await fundador.ateAoPong()).map((f) => f.t)).not.toContain("channel.rejected")

  const antigo = await Cliente.ligar(url, idAntigo, { capacidades: null })
  antigo.enviar({ t: "channel.subscribe", channels: [sala] })
  await antigo.ateAoPong()
  const grupoDoAntigo = await joinChannel(sala, adicao.welcome, pacote.publicPackage, pacote.privatePackage)

  return { idFundador, idAntigo, fundador, grupoDoFundador: adicao.session, antigo, grupoDoAntigo, cartao }
}

beforeAll(async () => {
  servidor = await levantarServidor()
  cena = await montar()
  expect(servidor.enclave.store.epochDoCanal(servidor.sala)).toBe(2)
}, 60_000)

afterAll(async () => {
  cena?.fundador.fechar()
  cena?.antigo.fechar()
  await servidor?.fechar()
})

describe("uma ligação sem commit-after-echo", () => {
  it("vê o seu commit descartado em silêncio, seja qual for o kind, e ninguém o recebe", async () => {
    /*
      Silently, not with `update-required`: `eabfd6c` does not distinguish reasons.
      Any `channel.rejected` fails sends waiting for receipt in that channel and shows
      "This room no longer exists… leave and ask to be invited again" (session.ts:7075-7101
      of that commit). The advice to leave, to everyone with an old separator, at each
      common room epoch.
    */
    const { sala } = servidor
    const commit = (await rotateEpoch(cena.grupoDoAntigo)).commits[0] as Uint8Array

    for (const [kind, ref] of [["handshake", "como-handshake"], ["application", "como-aplicacao"]] as const) {
      cena.antigo.enviar({ t: "channel.send", channel: sala, kind, ciphertext: toBase64(commit), ref })
      expect(await cena.antigo.ateAoPong()).toEqual([])
    }
    expect((await cena.fundador.ateAoPong()).map((f) => f.t)).not.toContain("channel.event")
    expect(servidor.enclave.store.epochDoCanal(sala)).toBe(2)
  }, 30_000)

  it("o bundle antigo a commitar do seu ramo, numa epoch à frente, não mexe na epoch do canal", async () => {
    // The case that locks the room: lost the race, applied its own anyway, and
    // the next one it sends is already from the epoch after the channel's.
    const { sala } = servidor
    const noRamoDele = (await rotateEpoch(cena.grupoDoAntigo)).session
    const aFrente = (await rotateEpoch(noRamoDele)).commits[0] as Uint8Array

    cena.antigo.enviar({ t: "channel.send", channel: sala, kind: "handshake", ciphertext: toBase64(aFrente), ref: "a-frente" })
    expect(await cena.antigo.ateAoPong()).toEqual([])
    expect(servidor.enclave.store.epochDoCanal(sala)).toBe(2)
  }, 30_000)

  it("não publica cartão, e o que lá está fica", async () => {
    const { sala } = servidor
    const doRamoDele = await publishableGroupInfo((await rotateEpoch(cena.grupoDoAntigo)).session)
    cena.antigo.enviar({ t: "channel.groupinfo.put", channel: sala, info: toBase64(doRamoDele) })
    // The `put` goes out on its own at each common room epoch: a rejection here was
    // the advice to leave the room appearing with no one doing anything.
    expect(await cena.antigo.ateAoPong()).toEqual([])
    expect(servidor.enclave.store.hasGroupInfo(sala)).toBe(true)
  }, 30_000)

  it("não levanta o cartão: recebe só a resposta vazia, e o cartão não se gasta", async () => {
    // An empty response is the classic "no card": the old client gives up on the
    // card and asks for a seat from the members (`#entrarComCartao` returns false),
    // without waiting for the deadline and with no warning.
    const { sala } = servidor
    cena.antigo.enviar({ t: "channel.groupinfo.take", channel: sala })
    expect(await cena.antigo.ateAoPong()).toEqual([{ t: "channel.groupinfo", channel: sala }])
    expect(servidor.enclave.store.hasGroupInfo(sala)).toBe(true)
  }, 30_000)

  it("o Welcome de um separador antigo não se guarda nem chega a quem é convidado", async () => {
    /*
      Bundle `eabfd6c` sends the commit and Welcome back-to-back, without waiting
      for a verdict (session.ts:1964-1972 in that commit). The commit does not
      enter; the Welcome, if it did, would be accepted by whoever is invited: it
      would replace their group with a branch E+1 that only the old separator has,
      and they would go deaf in silence, real messages in epoch E count for them
      as earlier than their seat.
    */
    const { sala, url, casa } = servidor
    const idConvidado = generateIdentity(casa)
    const convidado = await Cliente.ligar(url, idConvidado)
    const [dele] = await generateKeyPackages(idConvidado, 1)
    if (!dele) throw new Error("sem key package")
    const adicao = await addMembers(cena.grupoDoAntigo, [dele.publicPackage])

    cena.antigo.enviar({ t: "channel.send", channel: sala, kind: "handshake", ciphertext: toBase64(adicao.commit), ref: "commit" })
    cena.antigo.enviar({
      t: "channel.send",
      channel: sala,
      kind: "welcome",
      ciphertext: toBase64(adicao.welcome),
      recipient: idConvidado.address,
      ref: "welcome",
    })
    expect(await cena.antigo.ateAoPong()).toEqual([])

    expect((await convidado.ateAoPong()).map((f) => f.t)).not.toContain("channel.event")
    expect(servidor.enclave.store.pendingWelcomes(idConvidado.address, 10)).toHaveLength(0)
    convidado.enviar({ t: "welcome.resync" })
    expect((await convidado.ateAoPong()).map((f) => f.t)).not.toContain("channel.event")
    expect(servidor.enclave.store.epochDoCanal(sala)).toBe(2)
    convidado.fechar()
  }, 30_000)

  it("continua a conversar: mensagens, propostas e histórico", async () => {
    const { sala, casa } = servidor

    const mensagem = await encryptPayload(cena.grupoDoAntigo, {
      t: "message",
      id: crypto.randomUUID(),
      sentAt: 1_700_000_000_000,
      body: "ainda não actualizei",
      attachments: [],
      links: [],
      mentions: [],
    })
    cena.antigo.enviar({ t: "channel.send", channel: sala, kind: "application", ciphertext: toBase64(mensagem.ciphertext) })
    expect((await cena.fundador.proximoDe("channel.event")).kind).toBe("application")

    const [pacote] = await generateKeyPackages(generateIdentity(casa), 1)
    if (!pacote) throw new Error("sem key package")
    const proposta = await createProposal(
      mensagem.session.state,
      false,
      { proposalType: "add", add: { keyPackage: pacote.publicPackage } },
      mensagem.session.suite,
    )
    cena.antigo.enviar({ t: "channel.send", channel: sala, kind: "handshake", ciphertext: toBase64(encodeMlsMessage(proposta.message)) })
    expect((await cena.fundador.proximoDe("channel.event")).kind).toBe("handshake")

    cena.antigo.enviar({ t: "channel.backfill", channel: sala, afterSeq: -1, limit: 100 })
    expect((await cena.antigo.proximoDe("channel.backfill.page")).events.length).toBeGreaterThan(0)
    expect(servidor.enclave.store.epochDoCanal(sala)).toBe(2)
  }, 30_000)
})

describe("uma ligação com commit-after-echo", () => {
  it("commita, convida, publica cartão e levanta-o", async () => {
    const { sala, url, casa } = servidor
    const idConvidado = generateIdentity(casa)
    const [dele] = await generateKeyPackages(idConvidado, 1)
    if (!dele) throw new Error("sem key package")
    const rotacao = await addMembers(cena.grupoDoFundador, [dele.publicPackage])
    cena.fundador.enviar({ t: "channel.send", channel: sala, kind: "handshake", ciphertext: toBase64(rotacao.commit), ref: "actual" })
    expect((await cena.fundador.proximoDe("channel.event")).ref).toBe("actual")
    expect(servidor.enclave.store.epochDoCanal(sala)).toBe(3)
    cena.fundador.enviar({ t: "channel.send", channel: sala, kind: "welcome", ciphertext: toBase64(rotacao.welcome), recipient: idConvidado.address })
    await cena.fundador.ateAoPong()
    expect(servidor.enclave.store.pendingWelcomes(idConvidado.address, 10)).toHaveLength(1)

    const cartao = await publishableGroupInfo(rotacao.session)
    cena.fundador.enviar({ t: "channel.groupinfo.put", channel: sala, info: toBase64(cartao) })
    expect((await cena.fundador.ateAoPong()).map((f) => f.t)).not.toContain("channel.rejected")

    const novo = await Cliente.ligar(url, generateIdentity(casa))
    novo.enviar({ t: "channel.groupinfo.take", channel: sala })
    expect((await novo.proximoDe("channel.groupinfo")).info).toBe(toBase64(cartao))
    novo.fechar()
  }, 30_000)
})

/**
 * Everything that arrives at a `hello` without capabilities after `auth.ok`,
 * up to the `pong`. `Cliente.ligar` throws this away; here is what we want to see.
 */
async function oQueChegaAoLogin(url: string, identidade: Identity): Promise<ServerFrame[]> {
  const socket = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve())
    socket.once("error", reject)
  })
  const frames: ServerFrame[] = []
  let aposLogin = false
  const fim = new Promise<void>((resolve) => {
    socket.on("message", (raw: Buffer) => {
      const frame = JSON.parse(raw.toString("utf8")) as ServerFrame
      if (frame.t === "auth.challenge") {
        socket.send(JSON.stringify({ t: "auth.finish", signature: toBase64(sign(identidade, fromBase64(frame.nonce))) }))
      } else if (frame.t === "auth.ok") {
        aposLogin = true
        socket.send(JSON.stringify({ t: "ping" }))
      } else if (frame.t === "pong") {
        resolve()
      } else if (aposLogin) {
        frames.push(frame)
      }
    })
  })
  socket.send(JSON.stringify({ t: "hello", version: PROTOCOL_VERSION }))
  socket.send(JSON.stringify({ t: "auth.begin", address: identidade.address, signingKey: toBase64(identidade.signingPublicKey) }))
  await fim
  socket.close()
  return frames
}

describe("o cofre cifrado e um cliente antigo (fase 3a)", () => {
  it("um hello sem a capacidade nunca recebe cofre.*, nem no login, nem no subscribe, nem quando outros escrevem", async () => {
    const { sala, url } = servidor
    // A new device of the founder, with the vault: it has a seat in the room by subscription.
    const novo = await Cliente.ligar(url, cena.idFundador, { capacidades: [COMMIT_DEPOIS_DO_ECO, CAPACIDADE_COFRE_CIFRADO] })
    const conteudo = toBase64(randomBytes(1024))
    novo.enviar({ t: "cofre.put", escopo: `canal:${sala}`, entradas: [{ chave: toBase64(randomBytes(16)), conteudo }] })
    expect((await novo.proximoDe("cofre.put.result")).aceites).toHaveLength(1)
    novo.enviar({ t: "cofre.put", escopo: `conta:${cena.idFundador.address}`, entradas: [{ chave: toBase64(randomBytes(16)), conteudo }] })
    expect((await novo.proximoDe("cofre.put.result")).aceites).toHaveLength(1)

    // The old one is subscribed to the room, and the old founder is the same account:
    // neither of them hears the writes.
    const tipos = (frames: ServerFrame[]) => frames.map((f) => f.t).filter((t) => t.startsWith("cofre."))
    expect(tipos(await cena.antigo.ateAoPong())).toEqual([])
    expect(tipos(await cena.fundador.ateAoPong())).toEqual([])

    // Subscribe again, with vault in the room: nothing.
    cena.antigo.enviar({ t: "channel.subscribe", channels: [sala] })
    expect(tipos(await cena.antigo.ateAoPong())).toEqual([])

    // Connect again, without capabilities, with vault of the account saved: nothing.
    expect(tipos(await oQueChegaAoLogin(url, cena.idFundador))).toEqual([])
    expect(tipos(await oQueChegaAoLogin(url, cena.idAntigo))).toEqual([])
    novo.fechar()
  }, 30_000)
})
