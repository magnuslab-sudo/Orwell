import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { assinarPedido } from "@enclave/client-core"
import { generateIdentity, ROTAS_DA_DENUNCIA, type CorpoDaDenuncia } from "@enclave/protocol"
import { Cliente, levantarServidor, type ServidorDeTeste } from "../../apps/server/testes/cliente-de-teste.js"
import { origemHttp } from "./casa.js"

/**
 * A denúncia é a única vez em que o servidor lê texto.
 *
 * O pedido sai de `assinarPedido`, a função que `enviarDenuncia` usa na app, e
 * entra por HTTP a sério em `POST /_enclave/denuncia`. A chave só passa a existir no SQLite
 * quando a conta faz login no gateway. Antes disso o mesmo pedido, já
 * assinado, é recusado. Não há atalho por `app.inject` nem por
 * `registerOrVerifyAccount`.
 */

const fechos: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const fechar of fechos.splice(0)) await fechar()
})

function ficheiros(servidor: ServidorDeTeste): string[] {
  const pasta = join(dirname(servidor.baseDeDados), "denuncias")
  if (!existsSync(pasta)) return []
  return readdirSync(pasta).filter((nome) => /^\d+\.json$/.test(nome))
}

async function postar(origem: string, corpo: unknown): Promise<Response> {
  return fetch(`${origem}${ROTAS_DA_DENUNCIA.enviar}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  })
}

describe("denúncia, da assinatura ao ficheiro", () => {
  it("só entra depois do login no gateway, e a repetição do mesmo pedido não grava outra", async () => {
    const servidor = await levantarServidor()
    fechos.push(servidor.fechar)
    const origem = origemHttp(servidor)
    const ana = generateIdentity(servidor.casa)
    const bruno = generateIdentity(servidor.casa)
    const frase = "Insultos repetidos na sala geral."
    const corpo: CorpoDaDenuncia = {
      v: 1,
      motivo: 3,
      nota: frase,
      boaFe: true,
      canal: `#espaco:${servidor.casa}`,
      sala: "geral",
      denunciado: bruno.address,
      alvo: { tipo: "mensagem", id: "m-1" },
      itens: [{ s: 1, a: bruno.address, p: { t: "texto da mensagem" } }],
      denunciada: 0,
      versao: "1.3.5",
      fundador: null,
      copia: null,
    }
    const pedido = assinarPedido(ana, ROTAS_DA_DENUNCIA.enviar, corpo)

    const cedo = await postar(origem, pedido)
    expect(cedo.status).toBe(401)
    expect(await cedo.json()).toEqual({ error: "unauthorized" })
    expect(ficheiros(servidor)).toEqual([])

    const vazio = await postar(origem, {})
    expect(vazio.status).toBe(401)

    const ligacao = await Cliente.ligar(servidor.url, ana)
    fechos.push(async () => {
      ligacao.fechar()
    })

    const aceite = await postar(origem, pedido)
    expect(aceite.status).toBe(200)
    expect(await aceite.json()).toEqual({})

    const nomes = ficheiros(servidor)
    expect(nomes).toHaveLength(1)
    const texto = readFileSync(join(dirname(servidor.baseDeDados), "denuncias", nomes[0] as string), "utf8")
    const guardada = JSON.parse(texto) as {
      denunciante: string
      prioridade: string
      art18: boolean
      estado: string
      corpo: { nota: string; denunciado: string }
    }
    expect(guardada.denunciante).toBe(ana.address)
    expect(guardada.prioridade).toBe("normal")
    expect(guardada.art18).toBe(false)
    expect(guardada.estado).toBe("aberta")
    expect(guardada.corpo.nota).toBe(frase)
    expect(guardada.corpo.denunciado).toBe(bruno.address)
    expect(texto).not.toContain('"copia"')
    expect(texto).not.toContain("frase que o cliente não entregou")

    const repetido = await postar(origem, pedido)
    expect(repetido.status).toBe(401)
    expect(ficheiros(servidor)).toHaveLength(1)
  })
})
