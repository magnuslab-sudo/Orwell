import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Session, Vault, type PairEvento } from "@enclave/client-core"
import { CofreEmMemoria, levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"

/**
 * The two core `hello` messages send the app version (1.0 "Arca", slice 2).
 *
 * Slice 4 made the server reject, with `ENCLAVE_VERSAO_MINIMA_DO_CLIENTE`, a
 * `hello` below the minimum or without a version. Without this, the 1.0 server would reject
 * 1.0 itself, and would reject pairing (the guest `hello`, on its own socket). Real
 * sessions, against a real server with the minimum set to 1.0.0.
 */

let servidor: ServidorDeTeste
beforeAll(async () => {
  servidor = await levantarServidor({ versaoMinimaDoCliente: "1.0.0" })
}, 30_000)
afterAll(async () => {
  await servidor?.fechar()
})

async function sessao(versaoDaApp?: string): Promise<Session> {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-passe-de-teste")
  const session = new Session(vault, versaoDaApp ? { versaoDaApp } : {})
  await session.createIdentity(servidor.casa)
  return session
}

/** The first phase of pairing that is not `aguarda`, or `falhou`. */
function primeiraFase(session: Session): Promise<PairEvento> {
  return new Promise((resolve) => {
    const desligar = session.on("pair", (evento) => {
      if (evento.fase === "aguarda") return
      desligar()
      resolve(evento)
    })
  })
}

describe("a versão no hello, contra um servidor com mínima", () => {
  it("a sessão com a versão da app entra", async () => {
    const session = await sessao("1.0.0")
    await session.connect()
    expect(session.connection).toBe("online")
    session.disconnect()
  })

  it("a sessão sem versão é recusada", async () => {
    const session = await sessao()
    await expect(session.connect()).rejects.toThrow()
    expect(session.connection).not.toBe("online")
    session.disconnect()
  })

  it("o convidado do emparelhamento com a versão chega à caixa; sem ela, não", async () => {
    const computador = await sessao("1.0.0")
    await computador.connect()

    for (const [versao, esperado] of [
      ["1.0.0", "ligado"],
      [undefined, "falhou"],
    ] as const) {
      const { link } = await computador.emparelharComoAnfitriao()
      const cofre = new Vault(new CofreEmMemoria())
      await cofre.create("frase-do-telemovel")
      const telemovel = new Session(cofre, versao ? { versaoDaApp: versao } : {})
      const fase = primeiraFase(telemovel)
      telemovel.emparelharComoConvidado(link)
      expect((await fase).fase).toBe(esperado)
      telemovel.cancelarEmparelhamento()
      computador.cancelarEmparelhamento()
    }
    computador.disconnect()
  }, 30_000)
})
