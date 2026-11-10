import { fromBase64, generateIdentity, moradaDeSala, sign, toBase64 } from "@enclave/protocol"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Cliente, levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"

/**
 * AUTH-02 (external audit of 1.1.0, addendum of 3/11/2026): a second login
 * on the SAME socket.
 *
 * `auth.begin` and `auth.finish` were allowed without an account, and therefore also with
 * one. A second login on an already authenticated socket set `address` to null and
 * left `connection.channels` as it was; the `auth.finish` from account B
 * accepted the new identity on top, and `#isSeated` read that set in
 * memory. Account B then subscribed to account A's channel, the subscription went to
 * disk in B's name, and on a new socket B read A's history without a Welcome.
 *
 * No client does a second login on the same socket: `Session` opens a
 * new socket on each `connect()`, "Switch account" reloads the page, and the
 * phone being paired uses one socket just for the pairing box and another to log in.
 * The rule is now one account per socket.
 */

let servidor: ServidorDeTeste
beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterAll(async () => {
  await servidor?.fechar()
})

/** Did the server close the socket before responding to a ping? Without waiting for the `proximo` timeout. */
async function fechouSemPong(cliente: Cliente): Promise<boolean> {
  return Promise.race([cliente.fechado().then(() => true), cliente.ateAoPong().then(() => false, () => true)])
}

describe("AUTH-02: uma conta por socket", () => {
  it("o segundo login no mesmo socket é recusado, e a conta B não fica com o canal da conta A", async () => {
    const a = generateIdentity(servidor.casa)
    const b = generateIdentity(servidor.casa)
    const canal = moradaDeSala(servidor.casa)

    // A claims a new private channel and writes an encrypted frame there.
    const socket = await Cliente.ligar(servidor.url, a)
    socket.enviar({ t: "channel.subscribe", channels: [canal] })
    socket.enviar({
      t: "channel.send",
      channel: canal,
      kind: "application",
      ciphertext: toBase64(crypto.getRandomValues(new Uint8Array(48))),
    })
    const eco = await socket.proximoDe("channel.event")
    expect(eco.channel).toBe(canal)

    // On the same socket, B logs in, as in the auditors' reproduction.
    socket.enviar({ t: "auth.begin", address: b.address, signingKey: toBase64(b.signingPublicKey) })
    const resposta = await socket.proximo()
    if (resposta.t === "auth.challenge") {
      socket.enviar({ t: "auth.finish", signature: toBase64(sign(b, fromBase64(resposta.nonce))) })
      await socket.proximoDe("auth.ok")
      // And B subscribes to A's channel, which is what put the subscription on disk.
      socket.enviar({ t: "channel.subscribe", channels: [canal] })
    }
    const fechou = await fechouSemPong(socket)

    // B, on a new socket, does not read A's channel.
    const novo = await Cliente.ligar(servidor.url, b)
    novo.enviar({ t: "channel.backfill", channel: canal, limit: 50 })
    const recebidos = await novo.ateAoPong()
    expect(recebidos.filter((f) => f.t === "channel.backfill.page")).toEqual([])
    novo.fechar()

    // The refusal is stated in the protocol, and the socket closes.
    expect(resposta).toMatchObject({ t: "error", code: "already-authenticated", fatal: true })
    expect(fechou).toBe(true)
  })

  it("um auth.finish num socket já autenticado também é recusado", async () => {
    const a = generateIdentity(servidor.casa)
    const socket = await Cliente.ligar(servidor.url, a)
    socket.enviar({ t: "auth.finish", signature: toBase64(sign(a, new Uint8Array(32))) })
    const resposta = await socket.proximo()
    expect(resposta).toMatchObject({ t: "error", code: "already-authenticated", fatal: true })
    socket.fechar()
  })
})
