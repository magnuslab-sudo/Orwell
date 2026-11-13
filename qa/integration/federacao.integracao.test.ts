import { afterEach, describe, expect, it } from "vitest"
import { generateIdentity, toBase64, type FederationBody, type ServerName } from "@enclave/protocol"
import { levantarServidor, type ServidorDeTeste } from "../../apps/server/testes/cliente-de-teste.js"
import { origemHttp } from "./casa.js"

/**
 * Dois homeservers, cada um com o seu SQLite e o seu `listen`.
 *
 * O código de produção pede `https://<nome-do-par>/_enclave/federation/v1/...`.
 * Estes servidores de teste falam HTTP em 127.0.0.1, e o nome deles é
 * `localhost:<porto>`. O único desvio é esse: o `fetch` global entrega o
 * mesmo pedido, com o mesmo corpo, no HTTP real do outro processo lógico.
 * Não se abre TLS e não se muda o que a produção aceita.
 */

interface Troca {
  metodo: string
  caminho: string
  estado: number
}

const fechos: Array<() => Promise<void>> = []
let restaurarFetch: (() => void) | undefined

afterEach(async () => {
  restaurarFetch?.()
  restaurarFetch = undefined
  for (const fechar of fechos.splice(0)) await fechar()
})

function desviar(mapa: Map<string, string>, trocas: Troca[]): void {
  const original = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const bruto = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const url = new URL(bruto)
    const origem = mapa.get(url.host)
    if (!origem) return original(input, init)
    const resposta = await original(`${origem}${url.pathname}${url.search}`, init)
    trocas.push({ metodo: (init?.method ?? "GET").toUpperCase(), caminho: url.pathname, estado: resposta.status })
    return resposta
  }
  restaurarFetch = () => {
    globalThis.fetch = original
  }
}

async function casa(allowlist: ServerName[]): Promise<ServidorDeTeste> {
  const servidor = await levantarServidor({ allowlist })
  fechos.push(servidor.fechar)
  return servidor
}

describe("federação entre dois homeservers", () => {
  it("o ciphertext sai da fila de A, a chave de A é lida por HTTP, e B fica com o par inscrito", async () => {
    const listaA: ServerName[] = []
    const listaB: ServerName[] = []
    const a = await casa(listaA)
    const b = await casa(listaB)
    listaA.push(b.casa)
    listaB.push(a.casa)

    const trocas: Troca[] = []
    desviar(
      new Map([
        [a.casa, origemHttp(a)],
        [b.casa, origemHttp(b)],
      ]),
      trocas,
    )

    const claro = crypto.getRandomValues(new Uint8Array(48))
    const cifra = toBase64(claro)
    const canal = `!sala:${b.casa}`
    const corpo: FederationBody = { channel: canal, kind: "application", ciphertext: cifra }
    await a.enclave.federation.fanOut(canal, corpo)
    await a.enclave.federation.flush()

    const leitor = generateIdentity(b.casa)
    const eventos = b.enclave.store.backfill(canal, undefined, 20, leitor.address)
    expect(eventos.length).toBeGreaterThan(0)
    expect(eventos.every((evento) => evento.ciphertext === cifra && evento.kind === "application")).toBe(true)
    expect(b.enclave.store.channelPeers(canal)).toEqual([a.casa])
    expect(trocas).toContainEqual(expect.objectContaining({ metodo: "POST", caminho: "/_enclave/federation/v1/send", estado: 200 }))
    expect(trocas).toContainEqual(expect.objectContaining({ metodo: "GET", caminho: "/_enclave/federation/v1/keys", estado: 200 }))
    expect(a.enclave.store.dueOutbound(10)).toEqual([])
  })

  it("um servidor fora da allowlist não deixa rasto no outro", async () => {
    const listaB: ServerName[] = []
    const listaC: ServerName[] = []
    const b = await casa(listaB)
    const c = await casa(listaC)
    listaC.push(b.casa)

    const trocas: Troca[] = []
    desviar(new Map([[b.casa, origemHttp(b)], [c.casa, origemHttp(c)]]), trocas)

    const canal = `!sala:${b.casa}`
    const corpo: FederationBody = {
      channel: canal,
      kind: "application",
      ciphertext: toBase64(crypto.getRandomValues(new Uint8Array(32))),
    }
    await c.enclave.federation.fanOut(canal, corpo)
    await c.enclave.federation.flush()

    const leitor = generateIdentity(b.casa)
    expect(b.enclave.store.backfill(canal, undefined, 20, leitor.address)).toEqual([])
    expect(b.enclave.store.channelPeers(canal)).toEqual([])
    expect(trocas).toContainEqual(expect.objectContaining({ metodo: "POST", caminho: "/_enclave/federation/v1/send", estado: 403 }))
  })
})
