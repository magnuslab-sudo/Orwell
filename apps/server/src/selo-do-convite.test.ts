import {
  CAPACIDADE_SELO_DO_CONVITE,
  SELO_DO_CONVITE_MAX_CARACTERES,
  abrirSeloDoConvite,
  chaveDaProvaDoConvite,
  generateIdentity,
  moradaDeSala,
  selarNomeDoConvite,
  toBase64,
  type ServerFrame,
} from "@enclave/protocol"
import { sha256 } from "@noble/hashes/sha2.js"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { openDatabase } from "./db.js"
import { Cliente, levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"

/**
 * The invite seal, on the server side (1.0 "Arca", slice 5c).
 *
 * The server stores the seal that comes in `invite.create` (column `invites.selo`),
 * returns it in `invite.resolved` and `invite.selo.result`, and rejects a seal
 * above the limit. It does not read it: it has no code.
 */

let servidor: ServidorDeTeste
const crus: Cliente[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)
afterEach(() => {
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

/** An invite in an opaque room, with the seal given (or none). */
async function convite(
  dono: Cliente,
  selo: string | undefined,
  politica: { expiresAt?: number | null; maxUses?: number | null } = {},
): Promise<{ canal: string; codigo: string; codeHash: string; codigoCurto: string }> {
  const canal = moradaDeSala(servidor.casa)
  dono.enviar({ t: "channel.claim", channel: canal })
  await dono.proximoDe("channel.claim.result")
  const codigo = crypto.randomUUID()
  const codeHash = hashDe(codigo)
  dono.enviar({
    t: "invite.create",
    channel: canal,
    codeHash,
    expiresAt: politica.expiresAt ?? null,
    maxUses: politica.maxUses ?? null,
    codeKey: toBase64(chaveDaProvaDoConvite(codigo).publica),
    ...(selo === undefined ? {} : { selo }),
  })
  const criado = await dono.proximoDe("invite.created")
  return { canal, codigo, codeHash, codigoCurto: criado.codigoCurto as string }
}

async function pedirSelo(cliente: Cliente, codeHash: string): Promise<Extract<ServerFrame, { t: "invite.selo.result" }>> {
  cliente.enviar({ t: "invite.selo", codeHash })
  return cliente.proximoDe("invite.selo.result")
}

function seloNaBase(codeHash: string): string | null | undefined {
  const base = new DatabaseSync(servidor.baseDeDados)
  try {
    return (base.prepare("SELECT selo FROM invites WHERE code_hash = ?").get(codeHash) as { selo: string | null } | undefined)?.selo
  } finally {
    base.close()
  }
}

describe("o selo do convite no servidor", () => {
  it("o hello.ok anuncia o selo do convite", async () => {
    const { WebSocket } = await import("ws")
    const socket = new WebSocket(servidor.url)
    await new Promise<void>((resolve) => socket.once("open", () => resolve()))
    const frame = new Promise<ServerFrame>((resolve) =>
      socket.once("message", (raw: Buffer) => resolve(JSON.parse(raw.toString("utf8")) as ServerFrame)),
    )
    socket.send(JSON.stringify({ t: "hello", version: 1 }))
    const ola = await frame
    socket.close()
    expect(ola.t === "hello.ok" && ola.capabilities).toContain(CAPACIDADE_SELO_DO_CONVITE)
  })

  it("guarda o selo tal como veio, e devolve-o no invite.resolved e no invite.selo.result", async () => {
    const dono = await crua()
    const codigo = "0123456789abcdef"
    const selo = selarNomeDoConvite(codigo, { canal: "Horta", quem: "Ana" })
    const { canal, codeHash, codigoCurto } = await convite(dono, selo)
    expect(seloNaBase(codeHash)).toBe(selo)

    const visita = await crua()
    visita.enviar({ t: "invite.resolve", codigo: codigoCurto })
    const resolvido = await visita.proximoDe("invite.resolved")
    expect(resolvido).toEqual({ t: "invite.resolved", codigo: codigoCurto, channel: canal, codeHash, selo })

    expect(await pedirSelo(visita, codeHash)).toEqual({ t: "invite.selo.result", codeHash, selo })
    // And what comes back opens with the code, on the device of whoever has it.
    expect(abrirSeloDoConvite(codigo, selo)).toEqual({ canal: "Horta", quem: "Ana" })
  })

  it("sem selo, ou convite que não existe ou já acabou: a resposta vem sem selo", async () => {
    const dono = await crua()
    const semSelo = await convite(dono, undefined)
    expect(seloNaBase(semSelo.codeHash)).toBeNull()
    const visita = await crua()
    expect(await pedirSelo(visita, semSelo.codeHash)).toEqual({ t: "invite.selo.result", codeHash: semSelo.codeHash })
    expect(await pedirSelo(visita, hashDe("nunca-existiu"))).toEqual({ t: "invite.selo.result", codeHash: hashDe("nunca-existiu") })

    const esgotado = await convite(dono, selarNomeDoConvite("x", { canal: "Y" }), { maxUses: 1 })
    const base = new DatabaseSync(servidor.baseDeDados)
    try {
      base.prepare("UPDATE invites SET uses = 1 WHERE code_hash = ?").run(esgotado.codeHash)
    } finally {
      base.close()
    }
    expect((await pedirSelo(visita, esgotado.codeHash)).selo).toBeUndefined()
  })

  it("um selo acima do tecto é recusado, e o convite não fica guardado", async () => {
    const dono = await crua()
    const canal = moradaDeSala(servidor.casa)
    dono.enviar({ t: "channel.claim", channel: canal })
    await dono.proximoDe("channel.claim.result")
    const grande = hashDe("grande")
    dono.enviar({
      t: "invite.create",
      channel: canal,
      codeHash: grande,
      expiresAt: null,
      maxUses: null,
      selo: "a".repeat(SELO_DO_CONVITE_MAX_CARACTERES + 1),
    } as never)
    // The next one, valid, is the first `invite.created` that arrives.
    const bom = hashDe("bom")
    dono.enviar({ t: "invite.create", channel: canal, codeHash: bom, expiresAt: null, maxUses: null })
    expect((await dono.proximoDe("invite.created")).codeHash).toBe(bom)
    expect(seloNaBase(grande)).toBeUndefined()
  })
})

describe("a coluna invites.selo numa base de antes dela", () => {
  it("abrir a base acrescenta a coluna, sem perder convites, e abrir outra vez não faz nada", () => {
    const pasta = mkdtempSync(join(tmpdir(), "enclave-migracao-selo-"))
    try {
      const caminho = join(pasta, "enclave.sqlite")
      // The table as slice 4 left it: with short_code and code_key, no seal.
      const antiga = new DatabaseSync(caminho)
      antiga.exec(`
        CREATE TABLE invites (
          code_hash TEXT PRIMARY KEY, channel TEXT NOT NULL, expires_at INTEGER, max_uses INTEGER,
          uses INTEGER NOT NULL DEFAULT 0, created_second INTEGER NOT NULL, short_code TEXT, code_key TEXT
        );
      `)
      antiga.prepare("INSERT INTO invites (code_hash, channel, created_second) VALUES (?, ?, ?)").run("hash-a", "!x:localhost", 1)
      antiga.close()

      for (let vez = 0; vez < 2; vez++) {
        const db = openDatabase(caminho)
        const colunas = (db.prepare("PRAGMA table_info(invites)").all() as { name: string }[]).map((c) => c.name)
        expect(colunas.filter((c) => c === "selo")).toHaveLength(1)
        expect(db.prepare("SELECT code_hash, selo FROM invites").all()).toEqual([{ code_hash: "hash-a", selo: null }])
        db.close()
      }
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  })
})
