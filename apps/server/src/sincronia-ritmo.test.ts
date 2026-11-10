import { moradaDeSala } from "@enclave/protocol"
import { CofreEmMemoria } from "../testes/cliente-de-teste.js"
import { Session, Vault } from "@enclave/client-core"
import { CAPACIDADE_ENVIO_RECUSADO, generateIdentity, toBase64 } from "@enclave/protocol"
import { appendFileSync } from "node:fs"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { Gateway } from "./gateway.js"
import {
  ate,
  canalComTodos,
  Cliente,
  COMMIT_DEPOIS_DO_ECO,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"

/**
 * The anomaly from S5, reproduced and closed (S6 of absolute synchrony).
 *
 * With 1,800 consecutive sends from one account, about 45% of likes and all votes
 * didn't reach the other member in 4 minutes. The cause: above
 * `Gateway.ENVIOS_POR_MINUTO` the server did `return` without saying anything. The
 * client saved the send as done (`seq` -1, waiting for an echo that never came);
 * the telemetry report that Dora sent next fell in the same minute, also silent;
 * Ana asked three times, Dora marked the request as answered, and the rest waited
 * for the ten-minute clock.
 *
 * Measured before the fix, with the rate limit at 60 and 120 comments: after
 * 150 s Ana had 57. After: 120, one second after the last one left.
 *
 * The rate limit is lowered for the test not to take minutes: it's static, and reset.
 */

const TECTO_ORIGINAL = Gateway.ENVIOS_POR_MINUTO
const TECTO = 20
// `static readonly` in the type, and only in the type: the gateway reads it on each send.
const tectoDosEnvios = (n: number): void => {
  ;(Gateway as unknown as { ENVIOS_POR_MINUTO: number }).ENVIOS_POR_MINUTO = n
}
let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  tectoDosEnvios(TECTO)
  servidor = await levantarServidor()
}, 30_000)
afterEach(() => desligarContas(abertas.splice(0)))
afterAll(async () => {
  tectoDosEnvios(TECTO_ORIGINAL)
  await servidor?.fechar()
})

describe("S6: o tecto de envios recusa com código, e nunca em silêncio", () => {
  async function rajada(capacidades: string[] | null): Promise<{ aceites: number; recusas: Record<string, unknown>[]; erros: Record<string, unknown>[] }> {
    const identidade = generateIdentity(servidor.casa)
    const cliente = await Cliente.ligar(servidor.url, identidade, { capacidades })
    const canal = moradaDeSala(servidor.casa)
    cliente.enviar({ t: "channel.subscribe", channels: [canal] })
    await cliente.ateAoPong()
    for (let i = 0; i < TECTO + 4; i++) {
      cliente.enviar({ t: "channel.send", channel: canal, kind: "application", ciphertext: toBase64(new Uint8Array([i])), ref: `r${i}` })
    }
    const recebidos = await cliente.ateAoPong()
    cliente.fechar()
    return {
      aceites: recebidos.filter((f) => f.t === "channel.event").length,
      recusas: recebidos.filter((f) => f.t === "channel.rejected") as never,
      erros: recebidos.filter((f) => f.t === "error") as never,
    }
  }

  it("quem anuncia `envio-recusado` recebe `channel.rejected` com `rate-limited`, o `ref` e quando repetir", async () => {
    const { aceites, recusas, erros } = await rajada([COMMIT_DEPOIS_DO_ECO, CAPACIDADE_ENVIO_RECUSADO])
    expect(aceites).toBe(TECTO)
    expect(erros).toHaveLength(0)
    expect(recusas).toHaveLength(4)
    expect(recusas.map((r) => r["ref"])).toEqual([`r${TECTO}`, `r${TECTO + 1}`, `r${TECTO + 2}`, `r${TECTO + 3}`])
    for (const recusa of recusas) {
      expect(recusa["reason"]).toBe("rate-limited")
      expect(recusa["retryAfterMs"]).toBeGreaterThan(0)
      expect(recusa["retryAfterMs"]).toBeLessThanOrEqual(60_000)
    }
  })

  it("um cliente antigo recebe um `error` que só vai ao diagnóstico, e nunca um `channel.rejected` (que ele lia como sala perdida)", async () => {
    const { aceites, recusas, erros } = await rajada(null)
    expect(aceites).toBe(TECTO)
    expect(recusas).toHaveLength(0)
    expect(erros).toHaveLength(4)
    for (const erro of erros) {
      expect(erro["code"]).toBe("rate-limited")
      expect(erro["fatal"]).toBe(false)
    }
  })
})

describe("S6: o cliente pára, espera e repete", () => {
  it("uma rajada acima do tecto chega inteira ao outro membro, sem surdez", async () => {
    const [ana, dora] = await contasDeTeste(servidor, ["Ana", "Dora"])
    abertas.push(ana!, dora!)
    /*
      The foundation and anti-entropy spend Ana's sends with the rate limit low:
      publication can be rejected and go out only when the minute allows (up to 60 s).
      The timeout is therefore the rate limit's, not the 15 s of `ate`. Measured on 10/21:
      in the whole suite, with 15 s, it failed once in three.
    */
    const canal = await canalComTodos(servidor, ana!, [dora!])
    const id = crypto.randomUUID()
    await ana!.session.send(canal, { t: "post", id, postedAt: Date.now(), caption: "p", media: [], links: [], tags: [] } as never)
    await ate(() => dora!.session.history(canal).some((e) => e.payload["id"] === id), "a Dora tem a publicação", 90_000)
    const total = TECTO + 10
    const inicio = Date.now()
    for (let i = 0; i < total; i++) await dora!.session.commentOnPost(canal, id, `c${i}`)
    const comentarios = () => ana!.session.history(canal).filter((e) => e.payload["t"] === "post.comment").length
    await ate(() => comentarios() === total, "a Ana tem todos os comentários", 90_000)
    // The time is what the rate limit says (30 sends at 20 per minute), not a target from §2.3.
    const linha = JSON.stringify({ fase: "S6", cenario: "rajada-acima-do-tecto", envios: total, tecto: TECTO, ateIgualarMs: Date.now() - inicio })
    console.log(`MEDIDA-S6 ${linha}`)
    const saida = process.env["MEDIR_SINCRONIA_SAIDA"]
    if (saida) appendFileSync(saida, `${linha}\n`)
    expect(dora!.avisos).toContain("send-rate-limited")
    expect(ana!.session.deafChannels()).toEqual([])
    expect(ana!.avisos).not.toContain("channel-deaf")
    // No duplicate comment in the vault of whoever wrote it.
    const daDora = dora!.session.history(canal).filter((e) => e.payload["t"] === "post.comment")
    expect(new Set(daDora.map((e) => e.payload["id"])).size).toBe(daDora.length)
    expect(daDora).toHaveLength(total)
  }, 300_000)
})

/** Changes a `static readonly` in the gateway for the test, and returns how to reset it. */
function mudarEstatico(nome: string, valor: number): () => void {
  const alvo = Gateway as unknown as Record<string, number>
  const antes = alvo[nome] as number
  alvo[nome] = valor
  return () => {
    alvo[nome] = antes
  }
}

describe("S6, revisão: dois baldes, e um tecto às recusas", () => {
  it("o balde das mensagens cheio não atrasa um commit, e o dos commits cheio não atrasa uma mensagem", async () => {
    const repor = mudarEstatico("ENVIOS_HANDSHAKE_POR_MINUTO", 3)
    try {
      const identidade = generateIdentity(servidor.casa)
      const cliente = await Cliente.ligar(servidor.url, identidade, { capacidades: [COMMIT_DEPOIS_DO_ECO, CAPACIDADE_ENVIO_RECUSADO] })
      const canal = moradaDeSala(servidor.casa)
      cliente.enviar({ t: "channel.subscribe", channels: [canal] })
      await cliente.ateAoPong()
      for (let i = 0; i < TECTO; i++) {
        cliente.enviar({ t: "channel.send", channel: canal, kind: "application", ciphertext: toBase64(new Uint8Array([i])), ref: `a${i}` })
      }
      await cliente.ateAoPong()
      // Capped messages: a handshake is never rate-limited.
      cliente.enviar({ t: "channel.send", channel: canal, kind: "handshake", ciphertext: toBase64(new Uint8Array([1, 2, 3])), ref: "h0" })
      const depoisDoHandshake = await cliente.ateAoPong()
      expect(depoisDoHandshake.filter((f) => f.t === "channel.rejected" && (f as { reason?: string }).reason === "rate-limited")).toEqual([])
      // Three more handshakes fill their bucket; the fourth is rejected, and it's the `ref`.
      for (let i = 1; i <= 3; i++) {
        cliente.enviar({ t: "channel.send", channel: canal, kind: "handshake", ciphertext: toBase64(new Uint8Array([i, 9])), ref: `h${i}` })
      }
      const recebidos = await cliente.ateAoPong()
      const recusas = recebidos.filter((f) => f.t === "channel.rejected" && (f as { reason?: string }).reason === "rate-limited")
      expect(recusas.map((f) => (f as { ref?: string }).ref)).toEqual(["h3"])
      cliente.fechar()
      const metricas = servidor.enclave.gateway.metricasDosEnvios().actual
      expect(metricas.recusas["envios-handshake"]).toBeGreaterThanOrEqual(1)
    } finally {
      repor()
    }
  })

  it("uma ligação que não pára de ser recusada é fechada com `rate-abuse`, e conta-se", async () => {
    const repor = mudarEstatico("ENVIO_RECUSAS_ATE_FECHAR", 5)
    try {
      const antes = servidor.enclave.gateway.metricasDosEnvios().actual.fechos
      const identidade = generateIdentity(servidor.casa)
      const cliente = await Cliente.ligar(servidor.url, identidade, { capacidades: [COMMIT_DEPOIS_DO_ECO, CAPACIDADE_ENVIO_RECUSADO] })
      const canal = moradaDeSala(servidor.casa)
      cliente.enviar({ t: "channel.subscribe", channels: [canal] })
      await cliente.ateAoPong()
      for (let i = 0; i < TECTO + 10; i++) {
        cliente.enviar({ t: "channel.send", channel: canal, kind: "application", ciphertext: toBase64(new Uint8Array([i])), ref: `r${i}` })
      }
      // The twenty echoes and five rejections first; the sixth rejection is the close.
      let fatal: { code?: string; fatal?: boolean } | null = null
      for (let i = 0; i < TECTO + 20 && !fatal; i++) {
        const frame = await cliente.proximo()
        if (frame.t === "error") fatal = frame
      }
      expect(fatal?.code).toBe("rate-abuse")
      expect(fatal?.fatal).toBe(true)
      expect(servidor.enclave.gateway.metricasDosEnvios().actual.fechos).toBe(antes + 1)
      cliente.fechar()
    } finally {
      repor()
    }
  })
})

/** A second device on an account: another vault with the same account key, which mints its own device key. */
async function segundoAparelho(conta: ContaDeTeste): Promise<ContaDeTeste> {
  const backend = new CofreEmMemoria()
  const vault = new Vault(backend)
  await vault.create("frase-passe-de-teste")
  await vault.update((contents) => {
    contents.signingPrivateKey = conta.vault.contents.signingPrivateKey
    contents.homeserver = conta.vault.contents.homeserver
    const minuto = conta.vault.contents.identityCreatedAtMinute
    if (minuto !== undefined) contents.identityCreatedAtMinute = minuto
    contents.profile = { ...conta.vault.contents.profile }
  })
  const session = new Session(vault)
  const avisos: string[] = []
  session.on("status", (evento) => {
    if (evento.code) avisos.push(evento.code)
  })
  const identidade = session.loadIdentity()
  expect(identidade.address).toBe(conta.address)
  await session.connect()
  return { nome: `${conta.nome} (2)`, session, vault, backend, address: identidade.address, avisos }
}

describe("S6, revisão: dois aparelhos da conta a disputar o balde", () => {
  it("cada aparelho pára à primeira recusa: nenhuma série de recusas passa de poucas gerações saltadas", async () => {
    const [ana, dora] = await contasDeTeste(servidor, ["Ana", "Dora"])
    abertas.push(ana!, dora!)
    const telemovel = await segundoAparelho(dora!)
    abertas.push(telemovel)
    const canal = await canalComTodos(servidor, ana!, [dora!])
    await ate(() => telemovel.session.channels.includes(canal), "o telemóvel da Dora entra", 90_000)
    const id = crypto.randomUUID()
    await ana!.session.send(canal, { t: "post", id, postedAt: Date.now(), caption: "p", media: [], links: [], tags: [] } as never)
    await ate(
      () => [dora!, telemovel].every((d) => d.session.history(canal).some((e) => e.payload["id"] === id)),
      "os dois aparelhos têm a publicação",
      90_000,
    )
    const porAparelho = 15
    const comentar = async (quem: ContaDeTeste, prefixo: string) => {
      for (let i = 0; i < porAparelho; i++) await quem.session.commentOnPost(canal, id, `${prefixo}${i}`)
    }
    await Promise.all([comentar(dora!, "pc"), comentar(telemovel, "tm")])
    const comentarios = () => ana!.session.history(canal).filter((e) => e.payload["t"] === "post.comment").length
    await ate(() => comentarios() === 2 * porAparelho, "a Ana tem os comentários dos dois aparelhos", 200_000)
    const series = [dora!, telemovel].map((d) => d.session.ritmoDosEnvios().maiorSerie)
    console.log(`MEDIDA-S6 ${JSON.stringify({ cenario: "dois-aparelhos", maiorSerie: series })}`)
    expect(dora!.avisos.concat(telemovel.avisos)).toContain("send-rate-limited")
    for (const serie of series) expect(serie).toBeLessThanOrEqual(4)
    expect(ana!.session.deafChannels()).toEqual([])
  }, 300_000)
})
