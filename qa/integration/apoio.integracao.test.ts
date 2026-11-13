import { createServer, type Server } from "node:http"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { levantarServidor, type ServidorDeTeste } from "../../apps/server/testes/cliente-de-teste.js"
import { origemHttp } from "./casa.js"

/**
 * O visitante do site nunca fala com o GoFundMe.
 *
 * Quem pede a página é o homeserver, para um endereço que o operador configurou
 * (`campanhaGofundme`). Aqui esse endereço é um HTTP local que serve a fixture
 * real, `apps/server/testes/gofundme-campanha.html`. O `fetch` é o verdadeiro:
 * não se passa `fazerPedido`. O que o site leria é `GET /_enclave/apoiar.json`.
 */

const FIXTURE = fileURLToPath(new URL("../../apps/server/testes/gofundme-campanha.html", import.meta.url))
const SLUG = "orwell-privacidade-e-comunicacao-livre-na-europa"
const HTML = readFileSync(FIXTURE, "utf8")

const fechos: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const fechar of fechos.splice(0)) await fechar()
})

function fecharServidor(sitio: Server): Promise<void> {
  return new Promise((resolver, rejeitar) => {
    sitio.close((erro) => (erro ? rejeitar(erro) : resolver()))
  })
}

async function ouvir(pagina: (pedidos: { n: number; agente: string }) => Server): Promise<{ sitio: Server; origem: string; rasto: { n: number; agente: string } }> {
  const rasto = { n: 0, agente: "" }
  const sitio = pagina(rasto)
  await new Promise<void>((resolver) => sitio.listen(0, "127.0.0.1", resolver))
  const porto = (sitio.address() as { port: number }).port
  fechos.push(() => fecharServidor(sitio))
  return { sitio, origem: `http://127.0.0.1:${porto}`, rasto }
}

async function jsonQuandoHouver(url: string): Promise<{ estado: number; corpo: unknown }> {
  const limite = Date.now() + 10_000
  let ultimo = 0
  while (Date.now() < limite) {
    const resposta = await fetch(url)
    ultimo = resposta.status
    if (resposta.status === 200) return { estado: 200, corpo: await resposta.json() }
    await resposta.body?.cancel()
    await new Promise((resolver) => setTimeout(resolver, 40))
  }
  throw new Error(`/_enclave/apoiar.json ficou em ${ultimo}`)
}

describe("o medidor do apoio", () => {
  it("lê a página por HTTP, grava o último valor e serve-o ao site", async () => {
    const { origem: daCampanha, rasto } = await ouvir((rasto) =>
      createServer((pedido, resposta) => {
        rasto.n += 1
        rasto.agente = String(pedido.headers["user-agent"] ?? "")
        if (pedido.url?.startsWith(`/f/${SLUG}`)) {
          resposta.writeHead(200, { "content-type": "text/html; charset=utf-8" })
          resposta.end(HTML)
          return
        }
        resposta.writeHead(404)
        resposta.end()
      }),
    )

    const servidor: ServidorDeTeste = await levantarServidor({
      campanhaGofundme: `${daCampanha}/f/${SLUG}`,
    })
    fechos.push(servidor.fechar)
    const origem = origemHttp(servidor)

    const lido = await jsonQuandoHouver(`${origem}/_enclave/apoiar.json`)
    expect(lido.corpo).toMatchObject({
      angariado: 5,
      meta: 2200,
      metaTotal: 10000,
      doacoes: 1,
      moeda: "EUR",
    })
    expect(rasto.n).toBe(1)
    expect(rasto.agente).toContain("OrwellApoio/1.0")

    const outraVez = await fetch(`${origem}/_enclave/apoiar.json`)
    expect(outraVez.status).toBe(200)
    expect(rasto.n).toBe(1)

    const noDisco = readFileSync(join(dirname(servidor.baseDeDados), "apoio-campanha.json"), "utf8")
    expect(JSON.parse(noDisco)).toMatchObject({ angariado: 5, moeda: "EUR" })

    const saude = await fetch(`${origem}/_enclave/health`)
    expect(saude.status).toBe(200)
  })

  it("com a campanha incontactável o texto continua, e o site fica sem barra", async () => {
    const sitio = createServer()
    await new Promise<void>((resolver) => sitio.listen(0, "127.0.0.1", resolver))
    const porto = (sitio.address() as { port: number }).port
    await fecharServidor(sitio)
    const servidor = await levantarServidor({
      campanhaGofundme: `http://127.0.0.1:${porto}/f/${SLUG}`,
    })
    fechos.push(servidor.fechar)

    await new Promise((resolver) => setTimeout(resolver, 800))
    const origem = origemHttp(servidor)
    const barra = await fetch(`${origem}/_enclave/apoiar.json`)
    expect(barra.status).toBe(404)
    await barra.body?.cancel()
    const saude = await fetch(`${origem}/_enclave/health`)
    expect(await saude.json()).toMatchObject({ ok: true })
  })
})
