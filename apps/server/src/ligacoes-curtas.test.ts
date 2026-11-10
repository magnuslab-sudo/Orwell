import { parseInviteLink } from "@enclave/client-core"
import {
  ALFABETO_DO_CODIGO_CURTO,
  CAPACIDADE_LIGACOES_CURTAS,
  chaveDaProvaDoConvite,
  eCodigoCurto,
  generateIdentity,
  moradaDeSala,
  normalizarCodigoCurto,
  provarCodigoDoConvite,
  toBase64,
  type ServerFrame,
} from "@enclave/protocol"
import { sha256 } from "@noble/hashes/sha2.js"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { openDatabase } from "./db.js"
import { Gateway } from "./gateway.js"
import { Store } from "./store.js"
import {
  ate,
  Cliente,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"
import { PACOTE_DE_TESTE } from "../testes/convite-com-prova.js"

/**
 * Short invite links, on the server side (1.0 "Arca", slice 4).
 *
 * Each invite gets an eight-character code, given to whoever creates it. An
 * authenticated account resolves it to the channel and the invite's `codeHash`,
 * and uses that hash to ask to join, as with the long link. Resolution respects
 * the expiry and the uses, does not consume a use, and has a cap.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const crus: Cliente[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
  for (const c of crus.splice(0)) c.fechar()
})

afterAll(async () => {
  await servidor?.fechar()
})

async function crua(): Promise<Cliente> {
  const cliente = await Cliente.ligar(servidor.url, generateIdentity(servidor.casa))
  crus.push(cliente)
  return cliente
}

const hashDe = (codigo: string): string => toBase64(sha256(new TextEncoder().encode(codigo)))

/** A room with an opaque address, first created by this client, and an invite in it. */
async function salaComConvite(
  dono: Cliente,
  politica: { expiresAt?: number | null; maxUses?: number | null } = {},
): Promise<{ canal: string; codeHash: string; codigo: string; codigoCurto: string }> {
  const canal = moradaDeSala(servidor.casa)
  dono.enviar({ t: "channel.claim", channel: canal })
  await dono.proximoDe("channel.claim.result")
  // With `codeKey`, as 1.0 creates them: an invite without it can no longer be redeemed.
  const codigo = crypto.randomUUID()
  const codeHash = hashDe(codigo)
  dono.enviar({
    t: "invite.create",
    channel: canal,
    codeHash,
    expiresAt: politica.expiresAt ?? null,
    maxUses: politica.maxUses ?? null,
    codeKey: toBase64(chaveDaProvaDoConvite(codigo).publica),
  })
  const criado = await dono.proximoDe("invite.created")
  if (!criado.codigoCurto) throw new Error("o invite.created não trouxe código curto")
  return { canal, codeHash, codigo, codigoCurto: criado.codigoCurto }
}

async function resolver(
  cliente: Cliente,
  codigo: string,
): Promise<Extract<ServerFrame, { t: "invite.resolved" | "invite.unresolved" }>> {
  cliente.enviar({ t: "invite.resolve", codigo })
  for (let i = 0; i < 20; i++) {
    const frame = await cliente.proximo()
    if (frame.t === "invite.resolved" || frame.t === "invite.unresolved") return frame
    if (frame.t === "error" && frame.code === "timeout") break
  }
  throw new Error("nunca chegou a resposta do invite.resolve")
}

describe("o código curto", () => {
  it("o hello.ok anuncia as ligações curtas", async () => {
    const { WebSocket } = await import("ws")
    const socket = new WebSocket(servidor.url)
    await new Promise<void>((resolve) => socket.once("open", () => resolve()))
    const frame = new Promise<ServerFrame>((resolve) =>
      socket.once("message", (raw: Buffer) => resolve(JSON.parse(raw.toString("utf8")) as ServerFrame)),
    )
    socket.send(JSON.stringify({ t: "hello", version: 1 }))
    const ola = await frame
    socket.close()
    expect(ola.t === "hello.ok" && ola.capabilities).toContain(CAPACIDADE_LIGACOES_CURTAS)
  })

  it("quem cria recebe oito caracteres do alfabeto sem ambiguidade, e outra conta resolve-o", async () => {
    const dono = await crua()
    const { canal, codeHash, codigoCurto } = await salaComConvite(dono)
    expect(codigoCurto).toHaveLength(8)
    expect(eCodigoCurto(codigoCurto)).toBe(true)
    expect(codigoCurto).not.toMatch(/[01oil]/)

    const visita = await crua()
    const resposta = await resolver(visita, codigoCurto)
    expect(resposta).toEqual({ t: "invite.resolved", codigo: codigoCurto, channel: canal, codeHash })
  })

  it("resolver não gasta um uso: um convite de um uso resolve-se duas vezes e entra uma", async () => {
    const dono = await crua()
    const { codeHash, codigo, codigoCurto } = await salaComConvite(dono, { maxUses: 1 })
    const identidade = generateIdentity(servidor.casa)
    const visita = await Cliente.ligar(servidor.url, identidade)
    crus.push(visita)
    expect((await resolver(visita, codigoCurto)).t).toBe("invite.resolved")
    expect((await resolver(visita, codigoCurto)).t).toBe("invite.resolved")
    // The use is consumed through the usual gate: the hash from resolution, and the
    // code proof (without it the redemption consumes nothing, slice 6a).
    const keyPackage = PACOTE_DE_TESTE
    const prova = provarCodigoDoConvite(codigo, { codeHash, address: identidade.address, keyPackage })
    visita.enviar({ t: "invite.redeem", codeHash, keyPackage, prova })
    await visita.ateAoPong()
    const depois = await resolver(await crua(), codigoCurto)
    expect(depois).toEqual({ t: "invite.unresolved", codigo: codigoCurto, reason: "exhausted" })
  })

  it("um convite fora de prazo não se resolve", async () => {
    const dono = await crua()
    // One second in the past: the schema only asks for a positive integer.
    const { codigoCurto } = await salaComConvite(dono, { expiresAt: Math.floor(Date.now() / 1000) - 1 })
    const resposta = await resolver(await crua(), codigoCurto)
    expect(resposta).toEqual({ t: "invite.unresolved", codigo: codigoCurto, reason: "expired" })
  })

  it("um convite revogado, ou um código que nunca existiu, dá unknown", async () => {
    const dono = await crua()
    const { codeHash, codigoCurto } = await salaComConvite(dono)
    dono.enviar({ t: "invite.revoke", codeHash })
    await dono.ateAoPong()
    const visita = await crua()
    expect(await resolver(visita, codigoCurto)).toEqual({ t: "invite.unresolved", codigo: codigoCurto, reason: "unknown" })
    expect((await resolver(visita, "zzzzzzzz")).t).toBe("invite.unresolved")
  })

  it("a lista de convites de quem tem lugar traz o código curto de cada um", async () => {
    const dono = await crua()
    const { canal, codeHash, codigoCurto } = await salaComConvite(dono)
    // The list only includes those with a seat, and claiming the first creation seats no one.
    dono.enviar({ t: "channel.subscribe", channels: [canal] })
    dono.enviar({ t: "invite.list", channel: canal })
    const lista = await dono.proximoDe("invite.list.result")
    expect(lista.invites.find((c) => c.codeHash === codeHash)?.codigoCurto).toBe(codigoCurto)
  })

  it("tem tecto por conta: acima dele a resposta é rate-limited, e outra conta continua a resolver", async () => {
    const dono = await crua()
    const { codigoCurto } = await salaComConvite(dono)
    const insistente = await crua()
    const respostas: string[] = []
    for (let i = 0; i < Gateway.RESOLUCOES_POR_MINUTO + 2; i++) {
      const r = await resolver(insistente, i === 0 ? codigoCurto : "zzzzzzzz")
      respostas.push(r.t === "invite.unresolved" ? r.reason : "ok")
    }
    expect(respostas[0]).toBe("ok")
    expect(respostas.slice(Gateway.RESOLUCOES_POR_MINUTO)).toEqual(["rate-limited", "rate-limited"])
    expect((await resolver(await crua(), codigoCurto)).t).toBe("invite.resolved")
  })

  it("o molde recusa um código fora do alfabeto antes de chegar à base", async () => {
    const visita = await crua()
    visita.enviar({ t: "invite.resolve", codigo: "0O1lI000" } as never)
    const frames = await visita.ateAoPong()
    expect(frames.some((f) => f.t === "error" && f.code === "bad-frame")).toBe(true)
    expect(normalizarCodigoCurto(" AB2C-D3EF ")).toBe("ab2cd3ef")
    expect(normalizarCodigoCurto("ab2cd3e0")).toBeNull()
  })

  it("a ligação longa de um convite feito por uma sessão a sério resolve-se no mesmo hash, e a entrada abre", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canal = moradaDeSala(servidor.casa)
    await ana!.session.createSpaceChannel(canal)
    const ligacao = await ana!.session.createInvite(canal)
    const lida = parseInviteLink(ligacao)
    expect(lida?.channel).toBe(canal)

    // The short code for this invite, as the app will show it: from the list.
    const anaCrua = await Cliente.ligar(servidor.url, ana!.session.identity)
    crus.push(anaCrua)
    anaCrua.enviar({ t: "invite.list", channel: canal })
    const lista = await anaCrua.proximoDe("invite.list.result")
    const codigoCurto = lista.invites[0]?.codigoCurto
    expect(codigoCurto && eCodigoCurto(codigoCurto)).toBe(true)

    const brunoCru = await Cliente.ligar(servidor.url, bruno!.session.identity)
    crus.push(brunoCru)
    const resposta = await resolver(brunoCru, codigoCurto as string)
    expect(resposta).toEqual({ t: "invite.resolved", codigo: codigoCurto, channel: canal, codeHash: hashDe(lida!.code) })

    // The resolved hash is the long link's, and the gate works by hash: joining by
    // one is joining by the other. Bruno's session joins, and Ana admits him.
    await bruno!.session.redeemInvite(ligacao)
    await ate(() => bruno!.session.channels.includes(canal), "o Bruno entra na sala", 30_000)
  }, 120_000)
})

describe("a geração do código, na loja", () => {
  it("mil convites, mil códigos diferentes, todos do alfabeto", () => {
    const pasta = mkdtempSync(join(tmpdir(), "enclave-codigos-"))
    try {
      const store = new Store(openDatabase(join(pasta, "c.sqlite")))
      const vistos = new Set<string>()
      for (let i = 0; i < 1000; i++) {
        const codigo = store.createInvite({ codeHash: `h${i}`, channel: "!sala:localhost", expiresAt: null, maxUses: null })
        expect(codigo && eCodigoCurto(codigo)).toBe(true)
        vistos.add(codigo as string)
      }
      expect(vistos.size).toBe(1000)
      // All 31 symbols appear: the random draw leaves none out.
      const usados = new Set([...vistos].join(""))
      expect([...ALFABETO_DO_CODIGO_CURTO].every((c) => usados.has(c))).toBe(true)
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  })

  it("o mesmo hash outra vez no mesmo canal devolve o mesmo código; noutro canal, nenhum", () => {
    const pasta = mkdtempSync(join(tmpdir(), "enclave-codigos-"))
    try {
      const store = new Store(openDatabase(join(pasta, "c.sqlite")))
      const primeiro = store.createInvite({ codeHash: "h", channel: "!a:localhost", expiresAt: null, maxUses: null })
      expect(store.createInvite({ codeHash: "h", channel: "!a:localhost", expiresAt: null, maxUses: null })).toBe(primeiro)
      expect(store.createInvite({ codeHash: "h", channel: "!b:localhost", expiresAt: null, maxUses: null })).toBeUndefined()
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  })
})
