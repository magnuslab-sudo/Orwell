import { PROTOCOL_VERSION, CODIGO_VERSAO_ANTIGA, type ClientFrame, type ServerFrame } from "@enclave/protocol"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import { loadConfig } from "./config.js"
import { levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"

/**
 * The rejection of old clients at `hello` (1.0 "Arca", slice 4).
 *
 * On the 1.0 cutover the server restarts with opaque addresses and an empty database. A
 * 0.9 client in cache (the web app) or installed (the desktop app) does not
 * speak that language: it must hear a message that tells it what to do, and not
 * keep reconnecting to a server that does not understand it. The minimum comes from the environment
 * and is empty by default, so this server can go to production BEFORE the
 * cutover without rejecting anyone.
 */

/** What the server responds to a `hello`, and whether it closes the connection after. */
async function dizerOla(url: string, versao: string | undefined): Promise<{ resposta: ServerFrame; fechou: boolean }> {
  const socket = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve())
    socket.once("error", reject)
  })
  const resposta = new Promise<ServerFrame>((resolve) => {
    socket.once("message", (raw: Buffer) => resolve(JSON.parse(raw.toString("utf8")) as ServerFrame))
  })
  const fechou = new Promise<boolean>((resolve) => {
    socket.once("close", () => resolve(true))
    setTimeout(() => resolve(false), 400)
  })
  const ola: ClientFrame = {
    t: "hello",
    version: PROTOCOL_VERSION,
    capabilities: ["commit-after-echo"],
    ...(versao === undefined ? {} : { versao }),
  }
  socket.send(JSON.stringify(ola))
  const frame = await resposta
  // An accepted connection stays open: we close it here so the test does not leave it hanging.
  const fechada = await fechou
  socket.close()
  return { resposta: frame, fechou: fechada }
}

describe("com a mínima a 1.0.0", () => {
  let servidor: ServidorDeTeste
  beforeAll(async () => {
    servidor = await levantarServidor({ versaoMinimaDoCliente: "1.0.0" })
  }, 30_000)
  afterAll(async () => {
    await servidor?.fechar()
  })

  it("um hello da 0.9.5 recebe versao-antiga, com a frase, e a ligação fecha", async () => {
    const { resposta, fechou } = await dizerOla(servidor.url, "0.9.5")
    expect(resposta.t).toBe("error")
    if (resposta.t !== "error") return
    expect(resposta.code).toBe(CODIGO_VERSAO_ANTIGA)
    expect(resposta.code).toBe("versao-antiga")
    expect(resposta.message).toBe("Há uma versão nova do Orwell. Recarrega a página, ou descarrega a versão nova.")
    expect(resposta.fatal).toBe(true)
    expect(fechou).toBe(true)
  })

  it("um hello sem versão conta como antigo", async () => {
    const { resposta, fechou } = await dizerOla(servidor.url, undefined)
    expect(resposta.t === "error" && resposta.code).toBe("versao-antiga")
    expect(fechou).toBe(true)
  })

  it("um hello de versão ilegível conta como antigo", async () => {
    const { resposta } = await dizerOla(servidor.url, "beta")
    expect(resposta.t === "error" && resposta.code).toBe("versao-antiga")
  })

  it("um hello da 1.0.0, ou acima, entra", async () => {
    for (const versao of ["1.0.0", "1.0.1", "1.2.0", "2.0.0", "10.0.0"]) {
      const { resposta, fechou } = await dizerOla(servidor.url, versao)
      expect(resposta.t, versao).toBe("hello.ok")
      expect(fechou, versao).toBe(false)
    }
  })
})

describe("sem mínima (o servidor de hoje)", () => {
  let servidor: ServidorDeTeste
  beforeAll(async () => {
    servidor = await levantarServidor()
  }, 30_000)
  afterAll(async () => {
    await servidor?.fechar()
  })

  it("a 0.9.5, a 1.0.0 e quem não diz versão entram todos", async () => {
    for (const versao of ["0.9.5", "1.0.0", undefined]) {
      const { resposta, fechou } = await dizerOla(servidor.url, versao)
      expect(resposta.t, String(versao)).toBe("hello.ok")
      expect(fechou, String(versao)).toBe(false)
    }
  })
})

describe("ENCLAVE_VERSAO_MINIMA_DO_CLIENTE", () => {
  const com = (valor: string | undefined) =>
    loadConfig({ ...(valor === undefined ? {} : { ENCLAVE_VERSAO_MINIMA_DO_CLIENTE: valor }) } as NodeJS.ProcessEnv)
      .versaoMinimaDoCliente

  it("ausente ou vazia não recusa ninguém", () => {
    expect(com(undefined)).toBe("")
    expect(com("")).toBe("")
    expect(com("  ")).toBe("")
    expect(com(" 1.0.0 ")).toBe("1.0.0")
  })

  it("lixo é um erro no arranque, e não um servidor que recusa toda a gente", () => {
    expect(() => com("1.0")).toThrow(/ENCLAVE_VERSAO_MINIMA_DO_CLIENTE/)
    expect(() => com("v1.0.0")).toThrow(/ENCLAVE_VERSAO_MINIMA_DO_CLIENTE/)
    expect(() => com("arca")).toThrow(/ENCLAVE_VERSAO_MINIMA_DO_CLIENTE/)
  })
})
