import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { openDatabase } from "./db.js"
import { Store } from "./store.js"

/**
 * The first column migration in this project: `key_packages.device`.
 *
 * The production database was created on August 14, 2026 with the `key_packages`
 * below, without the column, and `CREATE TABLE IF NOT EXISTS` would never add
 * it. This test creates the database with the schema from that day (copied from
 * `db.ts` at `2666629`, version 0.2.3), fills it as a 0.2.3 server would, and
 * opens it with today's `openDatabase`: the column must appear, old packages
 * must still be served, and opening again must do nothing.
 */

/** The table as version 0.2.3 created it. Copied, not imported: it is the past. */
const SCHEMA_0_2_3 = `
  CREATE TABLE IF NOT EXISTS key_packages (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    address  TEXT NOT NULL,
    package  BLOB NOT NULL,
    claimed  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS key_packages_available ON key_packages (address, claimed);
`

const ANA = "@ana:localhost"
let pasta: string
let caminho: string

function colunas(db: DatabaseSync): string[] {
  return (db.prepare("PRAGMA table_info(key_packages)").all() as { name: string }[]).map((c) => c.name)
}

beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), "enclave-migracao-"))
  caminho = join(pasta, "enclave.sqlite")
  // A 0.2.3 database: in WAL like production, with the old table and three
  // unclaimed packages plus one already spent.
  const antiga = new DatabaseSync(caminho)
  antiga.exec("PRAGMA journal_mode = WAL")
  antiga.exec(SCHEMA_0_2_3)
  const insert = antiga.prepare("INSERT INTO key_packages (address, package, claimed) VALUES (?, ?, ?)")
  insert.run(ANA, new Uint8Array([1]), 0)
  insert.run(ANA, new Uint8Array([2]), 0)
  insert.run(ANA, new Uint8Array([3]), 1)
  insert.run(ANA, new Uint8Array([4]), 0)
  expect(colunas(antiga)).not.toContain("device")
  antiga.close()
})

afterEach(() => {
  rmSync(pasta, { recursive: true, force: true })
})

describe("a coluna key_packages.device numa base de antes", () => {
  it("aparece ao abrir, com NULL nas linhas antigas, e o índice novo existe", () => {
    const db = openDatabase(caminho)
    expect(colunas(db)).toContain("device")
    const linhas = db.prepare("SELECT id, device FROM key_packages ORDER BY id").all() as { id: number; device: unknown }[]
    expect(linhas).toHaveLength(4)
    expect(linhas.every((l) => l.device === null)).toBe(true)
    const indices = (db.prepare("PRAGMA index_list(key_packages)").all() as { name: string }[]).map((i) => i.name)
    expect(indices).toContain("key_packages_by_device")
    expect(indices).toContain("key_packages_available")
    db.close()
  })

  it("os pacotes antigos continuam a ser reclamáveis, do mais recente para o mais antigo", () => {
    const db = openDatabase(caminho)
    const store = new Store(db)
    expect(store.availableKeyPackages(ANA)).toBe(3)
    expect(Uint8Array.from(store.claimKeyPackage(ANA) as Uint8Array)).toEqual(new Uint8Array([4]))
    expect(Uint8Array.from(store.claimKeyPackage(ANA) as Uint8Array)).toEqual(new Uint8Array([2]))
    // The spent package never leaves again.
    expect(Uint8Array.from(store.claimKeyPackage(ANA) as Uint8Array)).toEqual(new Uint8Array([1]))
    expect(store.claimKeyPackage(ANA)).toBeUndefined()
    db.close()
  })

  it("um pacote antigo sem aparelho conta para a piscina de qualquer aparelho, e um claim por aparelho não o serve", () => {
    const db = openDatabase(caminho)
    const store = new Store(db)
    const aparelho = new Uint8Array(32).fill(7)
    // For the `keypackage.low` warning to a client connecting with a chain:
    // the old pool belongs to it, even without a device on record.
    expect(store.availableKeyPackages(ANA, aparelho)).toBe(3)
    // But a claim PER device does not know whose they are, and leaves them alone.
    expect(store.claimKeyPackage(ANA, aparelho)).toBeUndefined()
    expect(store.availableKeyPackages(ANA)).toBe(3)
    db.close()
  })

  it("abrir duas vezes é o mesmo que abrir uma", () => {
    openDatabase(caminho).close()
    const db = openDatabase(caminho)
    expect(colunas(db).filter((c) => c === "device")).toHaveLength(1)
    expect(new Store(db).availableKeyPackages(ANA)).toBe(3)
    db.close()
  })

  it("uma base nova já nasce com a coluna, sem passar pelo ALTER", () => {
    const nova = openDatabase(join(pasta, "nova.sqlite"))
    expect(colunas(nova)).toContain("device")
    nova.close()
  })
})

/**
 * The encrypted vault (phase 3a) in a 1.0.8 "Arca" database.
 *
 * The 1.0.8 production database has no `cofres` or `cofres_meta`. Both tables
 * are created by `CREATE TABLE IF NOT EXISTS`, which on an existing database adds
 * what is missing and leaves the rest alone. The schema below is from `db.ts`
 * at `05b58a9e` (the 1.0.8 release), without comments: copied, not imported.
 */
const SCHEMA_1_0_8 = `
  CREATE TABLE IF NOT EXISTS accounts (
    address        TEXT PRIMARY KEY,
    signing_key    BLOB NOT NULL,
    created_minute INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS devices (
    address      TEXT NOT NULL,
    device_key   BLOB NOT NULL,
    added_minute INTEGER NOT NULL,
    PRIMARY KEY (address, device_key)
  );
  CREATE TABLE IF NOT EXISTS device_manifests (
    address          TEXT PRIMARY KEY,
    version          INTEGER NOT NULL,
    manifest         TEXT NOT NULL,
    published_minute INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS revoked_devices (
    address        TEXT NOT NULL,
    device_key     TEXT NOT NULL,
    revoked_minute INTEGER NOT NULL,
    PRIMARY KEY (address, device_key)
  );
  CREATE TABLE IF NOT EXISTS device_posse (
    address    TEXT NOT NULL,
    device_key TEXT NOT NULL,
    geracao    INTEGER NOT NULL,
    marca      TEXT NOT NULL,
    PRIMARY KEY (address, device_key)
  );
  CREATE TABLE IF NOT EXISTS events (
    channel            TEXT NOT NULL,
    seq                INTEGER NOT NULL,
    kind               TEXT NOT NULL CHECK (kind IN ('application','handshake','welcome')),
    ciphertext         BLOB NOT NULL,
    recipient          TEXT,
    received_minute    INTEGER NOT NULL,
    PRIMARY KEY (channel, seq)
  );
  CREATE INDEX IF NOT EXISTS events_by_age ON events (received_minute);
  CREATE TABLE IF NOT EXISTS channel_activity (
    channel TEXT PRIMARY KEY
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    channel TEXT NOT NULL,
    address TEXT NOT NULL,
    PRIMARY KEY (channel, address)
  );
  CREATE TABLE IF NOT EXISTS channel_peers (
    channel TEXT NOT NULL,
    server  TEXT NOT NULL,
    PRIMARY KEY (channel, server)
  );
  CREATE TABLE IF NOT EXISTS key_packages (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    address  TEXT NOT NULL,
    package  BLOB NOT NULL,
    claimed  INTEGER NOT NULL DEFAULT 0,
    device   BLOB
  );
  CREATE INDEX IF NOT EXISTS key_packages_available ON key_packages (address, claimed);
  CREATE TABLE IF NOT EXISTS invites (
    code_hash    TEXT PRIMARY KEY,
    channel      TEXT NOT NULL,
    expires_at   INTEGER,
    max_uses     INTEGER,
    uses         INTEGER NOT NULL DEFAULT 0,
    created_second INTEGER NOT NULL,
    short_code   TEXT,
    code_key     TEXT,
    selo         TEXT
  );
  CREATE INDEX IF NOT EXISTS invites_by_channel ON invites (channel);
  CREATE TABLE IF NOT EXISTS server_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS channel_claims (
    channel   TEXT PRIMARY KEY,
    owner     TEXT NOT NULL,
    at_second INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS group_infos (
    channel   TEXT PRIMARY KEY,
    info      BLOB NOT NULL,
    at_minute INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS channel_epochs (
    channel TEXT PRIMARY KEY,
    epoch   INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS federation_nonces (
    origin      TEXT NOT NULL,
    nonce       TEXT NOT NULL,
    seen_second INTEGER NOT NULL,
    PRIMARY KEY (origin, nonce)
  );
  CREATE INDEX IF NOT EXISTS federation_nonces_by_age ON federation_nonces (seen_second);
  CREATE TABLE IF NOT EXISTS peer_keys (
    server       TEXT NOT NULL,
    key_id       TEXT NOT NULL,
    public_key   BLOB NOT NULL,
    valid_until  INTEGER NOT NULL,
    PRIMARY KEY (server, key_id)
  );
  CREATE TABLE IF NOT EXISTS outbox (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    destination  TEXT NOT NULL,
    payload      TEXT NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0,
    next_try     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS outbox_ready ON outbox (next_try);
  CREATE INDEX IF NOT EXISTS key_packages_by_device ON key_packages (address, device, claimed);
  CREATE UNIQUE INDEX IF NOT EXISTS invites_by_short_code ON invites (short_code);
`

describe("o cofre numa base da 1.0.8", () => {
  let pasta108: string
  let caminho108: string
  const CANAL = "!sala-opaca:localhost"

  function colunasDe(db: DatabaseSync, tabela: string): string[] {
    return (db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[]).map((c) => c.name)
  }

  beforeEach(() => {
    pasta108 = mkdtempSync(join(tmpdir(), "enclave-migracao-108-"))
    caminho108 = join(pasta108, "enclave.sqlite")
    const antiga = new DatabaseSync(caminho108)
    antiga.exec("PRAGMA journal_mode = WAL")
    antiga.exec(SCHEMA_1_0_8)
    antiga.prepare("INSERT INTO accounts VALUES (?, ?, ?)").run(ANA, new Uint8Array([1]), 1)
    antiga.prepare("INSERT INTO subscriptions VALUES (?, ?)").run(CANAL, ANA)
    antiga.prepare("INSERT INTO events VALUES (?, 0, 'application', ?, NULL, 1)").run(CANAL, new Uint8Array([9]))
    antiga.prepare("INSERT INTO channel_epochs VALUES (?, 7)").run(CANAL)
    const tabelas = (antiga.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name)
    expect(tabelas).not.toContain("cofres")
    expect(tabelas).not.toContain("cofres_meta")
    antiga.close()
  })

  afterEach(() => {
    rmSync(pasta108, { recursive: true, force: true })
  })

  it("as duas tabelas aparecem ao abrir, com as colunas do plano, e o resto fica como estava", () => {
    const db = openDatabase(caminho108)
    expect(colunasDe(db, "cofres")).toEqual(["escopo", "chave", "versao", "conteudo", "lapide", "epoch", "at_minute"])
    expect(colunasDe(db, "cofres_meta")).toEqual([
      "escopo",
      "versao_global",
      "bytes",
      "entradas",
      "lapides",
      "podado_ate",
      "chave_de_escrita",
      "epoch",
      "sem_subscritores_desde",
    ])
    const indices = (db.prepare("PRAGMA index_list(cofres)").all() as { name: string }[]).map((i) => i.name)
    expect(indices).toContain("cofres_por_escopo")
    expect(db.prepare("SELECT count(*) AS n FROM cofres").get()).toEqual({ n: 0 })
    expect(db.prepare("SELECT count(*) AS n FROM events").get()).toEqual({ n: 1 })
    expect(db.prepare("SELECT epoch FROM channel_epochs WHERE channel = ?").get(CANAL)).toEqual({ epoch: 7 })
    expect(new Store(db).isSubscribed(CANAL, ANA)).toBe(true)
    db.close()
  })

  it("o cofre funciona na base migrada, e abrir outra vez não lhe toca", () => {
    const db = openDatabase(caminho108)
    const store = new Store(db)
    const limites = { entradaMaxBytes: 64 * 1024, entradas: 4096, bytes: 16 * 1024 * 1024 }
    const escrito = store.cofrePut(`canal:${CANAL}`, [{ chave: "A".repeat(22), conteudo: new Uint8Array(1024).fill(3) }], limites)
    expect(escrito.aceites).toEqual([{ chave: "A".repeat(22), versao: 1 }])
    db.close()

    const outraVez = openDatabase(caminho108)
    expect(colunasDe(outraVez, "cofres").filter((c) => c === "lapide")).toHaveLength(1)
    const pagina = new Store(outraVez).cofreGet(`canal:${CANAL}`, 0, 1 << 20, 100)
    expect(pagina.versaoGlobal).toBe(1)
    expect(pagina.entradas.map((e) => e.chave)).toEqual(["A".repeat(22)])
    outraVez.close()
  })
})
