import { fromBase64, generateIdentity, toBase64 } from "@enclave/protocol"
import { addMembers, createChannel, generateKeyPackages, joinChannelExternally, publishableGroupInfo } from "@enclave/crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Cliente, levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"

/**
 * The common room card with more than ~68 leaves (3/11/2026, `!984`).
 *
 * The card is the `GroupInfo` with the full tree: about 2.9 KB per leaf
 * (measured with real sessions, 3/11/2026). The `channel.groupinfo.put` schema
 * cut it at 262 144 base64 characters, i.e. 196 KB, about 68 leaves.
 * In `!984` (108 accounts on 3/11) each member's `put`, at every epoch,
 * was rejected by the parser as `bad-frame: unparseable frame` (the one in the owner's log
 * at 23:07:27), the server was left without a card (`group_infos` empty), and
 * from about 17:00 on 3/11 every join depended on a connected member to
 * admit the newcomer.
 */

let servidor: ServidorDeTeste

beforeAll(async () => {
  servidor = await levantarServidor()
})

afterAll(async () => {
  await servidor?.fechar()
})

describe("o cartão grande da sala comum", () => {
  it("um cartão de mais de 256 KiB de base64 guarda-se, e quem chega entra com ele", async () => {
    const { url, casa, sala } = servidor
    const idFundador = generateIdentity(casa)
    const fundador = await Cliente.ligar(url, idFundador)
    fundador.enviar({ t: "channel.subscribe", channels: [sala] })
    fundador.enviar({ t: "channel.send", channel: sala, kind: "application", ciphertext: toBase64(new Uint8Array([1])) })
    await fundador.proximoDe("channel.event")

    // 150 accounts in the tree, in a single admission: the common room on a busy day.
    const pacotes = []
    for (let i = 0; i < 150; i++) {
      const [pacote] = await generateKeyPackages(generateIdentity(casa), 1)
      if (!pacote) throw new Error("sem key package")
      pacotes.push(pacote.publicPackage)
    }
    const entrada = await addMembers(await createChannel(idFundador, sala), pacotes)
    fundador.enviar({ t: "channel.send", channel: sala, kind: "handshake", ciphertext: toBase64(entrada.commit) })
    await fundador.proximoDe("channel.event")

    const cartao = toBase64(await publishableGroupInfo(entrada.session))
    expect(cartao.length).toBeGreaterThan(262_144)
    fundador.enviar({ t: "channel.groupinfo.put", channel: sala, info: cartao })
    const respostas = await fundador.ateAoPong()
    expect(respostas.filter((frame) => frame.t === "error")).toEqual([])
    expect(servidor.enclave.store.hasGroupInfo(sala)).toBe(true)

    const quemChega = await Cliente.ligar(url, generateIdentity(casa))
    quemChega.enviar({ t: "channel.groupinfo.take", channel: sala })
    const levantado = await quemChega.proximoDe("channel.groupinfo")
    const [pacote] = await generateKeyPackages(generateIdentity(casa), 1)
    if (!pacote || !levantado.info) throw new Error("sem cartão ou sem key package")
    const externa = await joinChannelExternally(sala, fromBase64(levantado.info), pacote.publicPackage, pacote.privatePackage)
    quemChega.enviar({ t: "channel.send", channel: sala, kind: "handshake", ciphertext: toBase64(externa.commit), ref: "entrada" })
    expect((await quemChega.proximoDe("channel.event")).ref).toBe("entrada")
  }, 120_000)
})
