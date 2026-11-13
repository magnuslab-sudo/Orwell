import { createServer, type Server } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import { generateIdentity } from "@enclave/protocol"
import { Cliente, levantarServidor } from "../../apps/server/testes/cliente-de-teste.js"

/**
 * A pré-visualização pede um URL escolhido por quem publica.
 *
 * A guarda SSRF recusa o loopback antes de abrir o socket. Este teste não
 * abre uma excepção para 127.0.0.1: sobe uma armadilha nessa máquina e exige
 * que ela receba zero pedidos. O motivo que volta ao cliente é sempre o
 * mesmo, seja o endereço privado, local ou metadados de nuvem.
 */

const MOTIVO = "não foi possível ler a página"
const fechos: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const fechar of fechos.splice(0)) await fechar()
})

function fecharHttp(sitio: Server): Promise<void> {
  return new Promise((resolver, rejeitar) => {
    sitio.close((erro) => (erro ? rejeitar(erro) : resolver()))
  })
}

describe("pré-visualização de um link, pelo gateway", () => {
  it("não liga a um servidor em 127.0.0.1, e a recusa não distingue o motivo", async () => {
    let batidas = 0
    const armadilha = createServer((_pedido, resposta) => {
      batidas += 1
      resposta.end("não devia chegar")
    })
    await new Promise<void>((resolver) => armadilha.listen(0, "127.0.0.1", resolver))
    const porto = (armadilha.address() as { port: number }).port
    fechos.push(() => fecharHttp(armadilha))

    const servidor = await levantarServidor()
    fechos.push(servidor.fechar)
    const cliente = await Cliente.ligar(servidor.url, generateIdentity(servidor.casa))
    fechos.push(async () => {
      cliente.fechar()
    })

    const enderecos = [
      `http://127.0.0.1:${porto}/admin`,
      "http://127.8.8.8/",
      "http://10.1.2.3/",
      "http://192.168.1.50/",
      "http://172.16.0.4/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
    ]
    for (const url of enderecos) {
      cliente.enviar({ t: "link.preview", url })
      const resultado = await cliente.proximoDe("link.preview.result")
      expect(resultado.ok).toBe(false)
      expect(resultado.url).toBe(url)
      expect(resultado.reason).toBe(MOTIVO)
      expect(resultado.reason).not.toContain("127.0.0.1")
      expect(resultado.reason).not.toContain("script")
    }
    expect(batidas).toBe(0)
  })
})
