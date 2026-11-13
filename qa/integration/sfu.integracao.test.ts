import { afterEach, describe, expect, it } from "vitest"
import { CAPACIDADE_SFU, PROTOCOL_VERSION } from "@enclave/protocol"
import { WebSocket } from "ws"
import { levantarServidor, type ServidorDeTeste } from "../../apps/server/testes/cliente-de-teste.js"
import { origemHttp, portoUdpLivre } from "./casa.js"

/**
 * O motor de media é um processo à parte. Se o porto estiver ocupado, o
 * homeserver tem de continuar a servir texto e não pode prometer SFU no
 * `hello.ok`. Com o porto livre, a promessa aparece, porque um cliente que a
 * vê deixa de construir a malha.
 */

const fechos: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const fechar of fechos.splice(0)) await fechar()
})

async function hello(url: string): Promise<{ capabilities?: string[] }> {
  const socket = new WebSocket(url)
  await new Promise<void>((resolver, rejeitar) => {
    socket.once("open", () => resolver())
    socket.once("error", rejeitar)
  })
  socket.send(JSON.stringify({ t: "hello", version: PROTOCOL_VERSION }))
  const cru = await new Promise<Buffer>((resolver) => socket.once("message", (dados) => resolver(dados as Buffer)))
  socket.close()
  return JSON.parse(cru.toString("utf8")) as { capabilities?: string[] }
}

async function subir(sfuPort: number): Promise<ServidorDeTeste> {
  const servidor = await levantarServidor({ sfuPort, sfuAnnouncedIp: "127.0.0.1" })
  fechos.push(servidor.fechar)
  return servidor
}

describe("o SFU e o texto no mesmo homeserver", () => {
  it("anuncia a capacidade quando o motor arranca, e não a anuncia quando o porto já está tomado", async () => {
    const porto = await portoUdpLivre()
    const comMotor = await subir(porto)
    const semMotor = await subir(porto)

    expect(comMotor.enclave.media).toBeDefined()
    expect(semMotor.enclave.media).toBeUndefined()

    const prometido = await hello(comMotor.url)
    expect(prometido.capabilities).toContain(CAPACIDADE_SFU)

    const calado = await hello(semMotor.url)
    expect(calado.capabilities ?? []).not.toContain(CAPACIDADE_SFU)

    const saude = await fetch(`${origemHttp(semMotor)}/_enclave/health`)
    expect(saude.status).toBe(200)
    expect(await saude.json()).toMatchObject({ ok: true })
  }, 60_000)
})
