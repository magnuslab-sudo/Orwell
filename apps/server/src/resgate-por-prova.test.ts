import {
  CAPACIDADE_RESGATE_POR_PROVA,
  chaveDaProvaDoConvite,
  generateIdentity,
  moradaDeSala,
  provarCodigoDoConvite,
  toBase64,
  type ServerFrame,
} from "@enclave/protocol"
import { parseInviteLink } from "@enclave/client-core"
import { sha256 } from "@noble/hashes/sha2.js"
import { DatabaseSync } from "node:sqlite"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
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
 * Invite redemption proves the code, not the hash (1.0 "Arca", slice 2).
 *
 * The finding from slice 4: `invite.redeem` accepted the `codeHash`, which is
 * in the `invites` table, so a copy of the database was enough to get in. Now
 * an invite stores the PUBLIC key derived from the code, and redemption asks
 * for a signature with the private one. The main proof reads the server
 * database like someone who stole it and tries to get in with what is there.
 */

const crus: Cliente[] = []
const abertas: ContaDeTeste[] = []
afterEach(() => {
  for (const c of crus.splice(0)) c.fechar()
  desligarContas(abertas.splice(0))
})

const hashDe = (codigo: string): string => toBase64(sha256(new TextEncoder().encode(codigo)))
// A real MLS key package: the server checks the shape before the proof (INV-02).
const PACOTE = PACOTE_DE_TESTE

async function crua(servidor: ServidorDeTeste): Promise<{ cliente: Cliente; address: string }> {
  const identidade = generateIdentity(servidor.casa)
  const cliente = await Cliente.ligar(servidor.url, identidade)
  crus.push(cliente)
  return { cliente, address: identidade.address }
}

/** A room opened by the owner, and an invite in it; with `comChave`, as 1.0 creates it. */
async function convite(servidor: ServidorDeTeste, dono: Cliente, comChave: boolean): Promise<{ canal: string; codigo: string }> {
  const canal = moradaDeSala(servidor.casa)
  dono.enviar({ t: "channel.claim", channel: canal })
  await dono.proximoDe("channel.claim.result")
  // Subscribed, so `invite.request` reaches it (and to see when it does not).
  dono.enviar({ t: "channel.subscribe", channels: [canal] })
  await dono.ateAoPong()
  const codigo = toBase64(crypto.getRandomValues(new Uint8Array(24)))
  dono.enviar({
    t: "invite.create",
    channel: canal,
    codeHash: hashDe(codigo),
    expiresAt: null,
    maxUses: null,
    ...(comChave ? { codeKey: toBase64(chaveDaProvaDoConvite(codigo).publica) } : {}),
  })
  await dono.proximoDe("invite.created")
  return { canal, codigo }
}

/** What the server replied to redemption, up to the pong: `invite.rejected` or nothing (accepted). */
async function resgatar(
  quem: Cliente,
  frame: { codeHash: string; keyPackage: string; prova?: string },
): Promise<ServerFrame[]> {
  quem.enviar({ t: "invite.redeem", ...frame })
  return quem.ateAoPong()
}

const rejeitado = (frames: ServerFrame[]): boolean => frames.some((f) => f.t === "invite.rejected")

describe("o resgate na 1.0", () => {
  let servidor: ServidorDeTeste
  beforeAll(async () => {
    servidor = await levantarServidor()
  }, 30_000)
  afterAll(async () => {
    await servidor?.fechar()
  })

  it("o hello.ok anuncia a capacidade", async () => {
    const { cliente } = await crua(servidor)
    cliente.enviar({ t: "hello", version: 1 })
    const ola = await cliente.proximoDe("hello.ok")
    expect(ola.capabilities).toContain(CAPACIDADE_RESGATE_POR_PROVA)
  })

  it("um convite da 1.0: o hash sozinho não entra; a prova entra, e o membro recebe o pedido", async () => {
    const { cliente: dono } = await crua(servidor)
    const { canal, codigo } = await convite(servidor, dono, true)
    const { cliente: visita, address } = await crua(servidor)
    const codeHash = hashDe(codigo)

    expect(rejeitado(await resgatar(visita, { codeHash, keyPackage: PACOTE }))).toBe(true)

    const prova = provarCodigoDoConvite(codigo, { codeHash, address, keyPackage: PACOTE })
    expect(rejeitado(await resgatar(visita, { codeHash, keyPackage: PACOTE, prova }))).toBe(false)
    const pedido = await dono.proximoDe("invite.request")
    expect(pedido).toMatchObject({ channel: canal, address, codeHash })
  })

  it("a prova de outra conta não serve: o servidor confere o endereço da ligação", async () => {
    const { cliente: dono } = await crua(servidor)
    const { codigo } = await convite(servidor, dono, true)
    const codeHash = hashDe(codigo)
    const { address: outra } = await crua(servidor)
    const { cliente: ladrao } = await crua(servidor)
    const prova = provarCodigoDoConvite(codigo, { codeHash, address: outra, keyPackage: PACOTE })
    expect(rejeitado(await resgatar(ladrao, { codeHash, keyPackage: PACOTE, prova }))).toBe(true)
  })

  it("UMA CÓPIA DA BASE NÃO CHEGA PARA ENTRAR: com o code_hash e a code_key da tabela, recusado", async () => {
    const { cliente: dono } = await crua(servidor)
    const { codigo } = await convite(servidor, dono, true)

    // The vault as it was carried: read-only, and only what is in it.
    const copia = new DatabaseSync(servidor.baseDeDados, { readOnly: true })
    const linhas = copia.prepare("SELECT * FROM invites").all() as Record<string, unknown>[]
    copia.close()
    const linha = linhas.find((l) => l["code_hash"] === hashDe(codigo))
    expect(linha).toBeDefined()
    // The code is not in any column.
    expect(JSON.stringify(linhas)).not.toContain(codigo)

    const { cliente: ladrao, address } = await crua(servidor)
    const codeHash = linha!["code_hash"] as string
    const codeKey = linha!["code_key"] as string
    for (const tentativa of [
      { codeHash, keyPackage: PACOTE },
      { codeHash, keyPackage: PACOTE, prova: codeKey },
      { codeHash, keyPackage: PACOTE, prova: provarCodigoDoConvite(codeHash, { codeHash, address, keyPackage: PACOTE }) },
      { codeHash, keyPackage: PACOTE, prova: provarCodigoDoConvite(codeKey, { codeHash, address, keyPackage: PACOTE }) },
    ]) {
      expect(rejeitado(await resgatar(ladrao, tentativa))).toBe(true)
    }
    // And no request reached the owner.
    expect((await dono.ateAoPong()).some((f) => f.t === "invite.request")).toBe(false)
  })

  it("um convite sem code_key (como a 0.9.x os fazia) não se resgata pelo hash, nem com o código", async () => {
    // Until slice 6a this path stayed open behind the cut door when disabled.
    // Now it always closes: the hash is in the vault, and whoever has a copy
    // cannot enter through it.
    const { cliente: dono } = await crua(servidor)
    const { codigo } = await convite(servidor, dono, false)
    const { cliente: visita, address } = await crua(servidor)
    const codeHash = hashDe(codigo)
    expect(rejeitado(await resgatar(visita, { codeHash, keyPackage: PACOTE }))).toBe(true)
    const prova = provarCodigoDoConvite(codigo, { codeHash, address, keyPackage: PACOTE })
    expect(rejeitado(await resgatar(visita, { codeHash, keyPackage: PACOTE, prova }))).toBe(true)
    expect((await dono.ateAoPong()).some((f) => f.t === "invite.request")).toBe(false)
  })

  it("com sessões a sério: a Ana cria a ligação, o Bruno entra pela prova, e a base guarda a chave", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canal = moradaDeSala(servidor.casa)
    await ana!.session.createSpaceChannel(canal)
    const ligacao = await ana!.session.createInvite(canal)
    const codigo = parseInviteLink(ligacao)!.code

    const copia = new DatabaseSync(servidor.baseDeDados, { readOnly: true })
    const linha = copia.prepare("SELECT code_key FROM invites WHERE code_hash = ?").get(hashDe(codigo)) as
      | { code_key: string | null }
      | undefined
    copia.close()
    expect(linha?.code_key).toBe(toBase64(chaveDaProvaDoConvite(codigo).publica))

    await bruno!.session.redeemInvite(ligacao)
    await ate(() => bruno!.session.channels.includes(canal), "o Bruno entra na sala", 30_000)
  }, 120_000)
})
