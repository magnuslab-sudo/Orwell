import { memberLeaves, type GroupSession } from "@enclave/crypto"
import { Session, Vault } from "@enclave/client-core"
import { moradaDeSala, toBase64, type UserAddress } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  Cliente,
  CofreEmMemoria,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"

/**
 * Defect in production on 1.3.3 (5/11/2026): an account switched from browser to
 * desktop app and lost the common room. The log repeated, once per minute:
 * `rejoin-resync` → 10 s → `commit-unconfirmed` → "Join request sent". The epoch
 * went up each time (365, 366, …): the commit got IN, and the author never knew.
 *
 * The cause: an account that already has a durable subscription in the channel
 * (the `subscriptions` table) passes `#relay` as seated, and the external
 * commit promotes nothing, but the NEW connection is not in `connection.channels`,
 * because the client only subscribes to the room after the verdict. `broadcast`
 * delivers to the connections in that set, and the echo, which is the verdict,
 * never reached the connection that asked for it. Before INV-01 (1.2.1) `channel.groupinfo.take` put the
 * connection in the channel, and the echo came through there.
 *
 * The rule these tests set: an accepted send always has an echo to whoever sent
 * it; never silence.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const confirmMsOriginal = Session.CONFIRM_MS

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterEach(() => {
  desligarContas(abertas.splice(0))
  Session.CONFIRM_MS = confirmMsOriginal
})
afterAll(async () => {
  await servidor?.fechar()
})

const cifra = (): string => toBase64(crypto.getRandomValues(new Uint8Array(64)))

describe("sala comum: reentrada por cartão de quem já tem subscrição durável", () => {
  it("o commit externo com resync, numa ligação nova, recebe veredicto e a conta volta a entrar", async () => {
    // Short timeout for the verdict: the bug is the lack of it, and ten seconds
    // per round is a test nobody runs.
    Session.CONFIRM_MS = 3_000
    const sala = servidor.sala
    const [fundador] = await contasDeTeste(servidor, ["fundador"])
    if (!fundador) throw new Error("sem fundador")
    abertas.push(fundador)
    await ate(() => fundador.session.channels.includes(sala), "o fundador cria a sala comum")
    await ate(() => servidor.enclave.store.hasGroupInfo(sala), "há cartão")

    /*
      The account in the browser. The account file exported BEFORE it joins the
      room is what the desktop app will import: the same device key,
      without the room's group (the production case: the app had no group and the
      tree still had this device's leaf).
    */
    const frase = "frase-passe-de-teste"
    const cofreDoBrowser = new Vault(new CofreEmMemoria())
    await cofreDoBrowser.create(frase)
    const browser = new Session(cofreDoBrowser)
    const { address } = await browser.createIdentity(servidor.casa)
    await cofreDoBrowser.gravarAdiada()
    const ficheiroDeConta = await cofreDoBrowser.exportVault()
    await browser.connect()
    abertas.push({ nome: "paptira (browser)", session: browser, vault: cofreDoBrowser, backend: new CofreEmMemoria(), address, avisos: [] })
    await ate(() => browser.channels.includes(sala), "a paptira entra pelo cartão no browser")
    await ate(() => fundador.session.membersOf(sala).length === 2, "o fundador vê-a")
    await ate(() => servidor.enclave.store.hasGroupInfo(sala), "a paptira repõe o cartão")
    // The durable subscription, per account: this is what makes `#relay` treat
    // the new connection as seated.
    expect(servidor.enclave.store.isSubscribed(sala, address)).toBe(true)
    browser.disconnect()
    const epocaAntes = fundador.session.groupFor(sala)?.state.groupContext.epoch ?? 0n

    // The desktop app: imports the file and connects. New connection, no
    // room in `connection.channels` (it has no group for it to subscribe to).
    const backend = new CofreEmMemoria()
    const cofreDaApp = new Vault(backend)
    await cofreDaApp.importVault(ficheiroDeConta, frase)
    await cofreDaApp.unlock(frase)
    const app = new Session(cofreDaApp)
    const paptira: ContaDeTeste = { nome: "paptira (app)", session: app, vault: cofreDaApp, backend, address, avisos: [] }
    app.on("status", (evento) => {
      if (evento.code) paptira.avisos.push(evento.code)
    })
    abertas.push(paptira)
    app.loadIdentity()
    await app.connect()

    await ate(() => paptira.avisos.includes("rejoin-resync"), "a reentrada leva a folha antiga (resync)")
    await ate(
      () => paptira.avisos.includes("commit-unconfirmed") || paptira.session.channels.includes(sala),
      "um desfecho para o commit de resync",
      20_000,
    )

    expect(paptira.avisos).not.toContain("commit-unconfirmed")
    expect(paptira.session.channels).toContain(sala)
    await ate(
      () => (fundador.session.groupFor(sala)?.state.groupContext.epoch ?? 0n) > epocaAntes,
      "o fundador aplica o commit de resync",
    )
    await ate(
      () => paptira.session.groupFor(sala)?.state.groupContext.epoch === fundador.session.groupFor(sala)?.state.groupContext.epoch,
      "os dois na mesma epoch",
    )
    // One leaf only: the old one left in the same commit.
    expect(memberLeaves(fundador.session.groupFor(sala) as GroupSession, paptira.address as UserAddress)).toHaveLength(1)
  }, 90_000)
})

describe("o servidor dá sempre veredicto a quem envia", () => {
  it("uma ligação sentada pela subscrição durável, sem `channel.subscribe` nesta ligação, recebe o eco do que manda", async () => {
    const { generateIdentity } = await import("@enclave/protocol")
    const idDono = generateIdentity(servidor.casa)
    const idOutra = generateIdentity(servidor.casa)
    const dono = await Cliente.ligar(servidor.url, idDono)
    const canal = moradaDeSala(servidor.casa)
    dono.enviar({ t: "channel.subscribe", channels: [canal] })
    dono.enviar({ t: "channel.send", channel: canal, kind: "application", ciphertext: cifra() })
    await dono.proximoDe("channel.event")

    // The account has a durable seat (it joined on another device, on another connection).
    servidor.enclave.store.subscribe(canal, idOutra.address)
    const outra = await Cliente.ligar(servidor.url, idOutra)
    outra.enviar({ t: "channel.send", channel: canal, kind: "application", ciphertext: cifra(), ref: "ref-da-outra" })
    const recebidos = await outra.ateAoPong()
    const eco = recebidos.find((f) => f.t === "channel.event" && f.ref === "ref-da-outra")
    const recusa = recebidos.find((f) => f.t === "channel.rejected")
    expect(eco ?? recusa).toBeDefined()
    expect(eco).toBeDefined()
    // And the owner, who is subscribed, gets it as usual, only once.
    const doDono = (await dono.ateAoPong()).filter((f) => f.t === "channel.event")
    expect(doDono).toHaveLength(1)
    dono.fechar()
    outra.fechar()
  })
})
