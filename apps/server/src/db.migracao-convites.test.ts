import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { openDatabase } from "./db.js"
import { Store } from "./store.js"

/**
 * The second column migration: `invites.short_code` (1.0 "Arca", slice 4).
 *
 * The short code for links `orwell.pt/c#<8>` lives in the invite row. The 0.9
 * production database has the table without the column, and the 1.0 cut removes
 * it; but this server can go to production BEFORE the cut, on the 0.9 database,
 * and must open it without losing an invite. This test creates the table as 0.9.5
 * created it and opens it with today's `openDatabase`.
 */

/** The table as 0.9.5 created it. Copied, not imported: it is the past. */
const SCHEMA_0_9_5 = `
  CREATE TABLE IF NOT EXISTS invites (
    code_hash    TEXT PRIMARY KEY,
    channel      TEXT NOT NULL,
    expires_at   INTEGER,
    max_uses     INTEGER,
    uses         INTEGER NOT NULL DEFAULT 0,
    created_second INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS invites_by_channel ON invites (channel);
`

const SALA = "!cozinha:localhost"
let pasta: string
let caminho: string

function colunas(db: DatabaseSync): string[] {
  return (db.prepare("PRAGMA table_info(invites)").all() as { name: string }[]).map((c) => c.name)
}

function indices(db: DatabaseSync): { name: string; unique: number }[] {
  return db.prepare("PRAGMA index_list(invites)").all() as { name: string; unique: number }[]
}

beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), "enclave-migracao-convites-"))
  caminho = join(pasta, "enclave.sqlite")
  // A 0.9.5 database, in WAL like the production one, with two live invites.
  const antiga = new DatabaseSync(caminho)
  antiga.exec("PRAGMA journal_mode = WAL")
  antiga.exec(SCHEMA_0_9_5)
  const insert = antiga.prepare(
    "INSERT INTO invites (code_hash, channel, expires_at, max_uses, uses, created_second) VALUES (?, ?, ?, ?, ?, ?)",
  )
  insert.run("hash-a", SALA, null, 2, 0, 1)
  insert.run("hash-b", SALA, null, null, 5, 2)
  expect(colunas(antiga)).not.toContain("short_code")
  antiga.close()
})

afterEach(() => {
  rmSync(pasta, { recursive: true, force: true })
})

describe("a coluna invites.short_code numa base da 0.9.5", () => {
  it("aparece ao abrir, com NULL nos convites antigos, e o índice único existe", () => {
    const db = openDatabase(caminho)
    expect(colunas(db)).toContain("short_code")
    const linhas = db.prepare("SELECT code_hash, short_code FROM invites ORDER BY code_hash").all() as {
      code_hash: string
      short_code: unknown
    }[]
    expect(linhas.map((l) => l.code_hash)).toEqual(["hash-a", "hash-b"])
    expect(linhas.every((l) => l.short_code === null)).toBe(true)
    const unico = indices(db).find((i) => i.name === "invites_by_short_code")
    expect(unico?.unique).toBe(1)
    db.close()
  })

  it("os convites antigos continuam a valer, pelo hash, como antes", () => {
    const db = openDatabase(caminho)
    const store = new Store(db)
    expect(store.redeemInvite("hash-a")).toEqual({ ok: true, channel: SALA })
    expect(store.listInvites(SALA)).toHaveLength(2)
    db.close()
  })

  it("abrir duas vezes é o mesmo que abrir uma", () => {
    openDatabase(caminho).close()
    const db = openDatabase(caminho)
    expect(colunas(db).filter((c) => c === "short_code")).toHaveLength(1)
    db.close()
  })

  it("uma base nova já nasce com a coluna e o índice", () => {
    const nova = openDatabase(join(pasta, "nova.sqlite"))
    expect(colunas(nova)).toContain("short_code")
    expect(indices(nova).some((i) => i.name === "invites_by_short_code" && i.unique === 1)).toBe(true)
    nova.close()
  })
})

describe("a coluna invites.code_key numa base da 0.9.5 (1.0 «Arca», fatia 2)", () => {
  it("aparece ao abrir, com NULL nos convites antigos, que continuam a resgatar-se pelo hash até ao corte", () => {
    const db = openDatabase(caminho)
    expect(colunas(db)).toContain("code_key")
    const linhas = db.prepare("SELECT code_key FROM invites").all() as { code_key: unknown }[]
    expect(linhas.every((l) => l.code_key === null)).toBe(true)
    expect(colunas(db).filter((c) => c === "code_key")).toHaveLength(1)
    db.close()
    const outraVez = openDatabase(caminho)
    expect(colunas(outraVez).filter((c) => c === "code_key")).toHaveLength(1)
    outraVez.close()
  })
})
