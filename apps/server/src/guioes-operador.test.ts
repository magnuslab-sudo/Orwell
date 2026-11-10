import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createChannel, rotateEpoch } from "@enclave/crypto"
import { generateIdentity, parseServerName } from "@enclave/protocol"
import { openDatabase } from "./db.js"
import { Store } from "./store.js"

/**
 * The operator scripts, run for real against a local database.
 *
 * None of these tests can reach production, and there are two guards for it:
 * each script runs with `ORWELL_BASE` pointing to a temp database, and with
 * a fake `ssh` at the front of the PATH that exits with error and does nothing.
 * If a script ignored the local database and tried the server, it failed here
 * instead of wiping production.
 */

const RAIZ = fileURLToPath(new URL("../../../", import.meta.url))
const sqlite3Disponivel = spawnSync("sqlite3", ["-version"]).status === 0

let dir: string
let base: string
let ambiente: NodeJS.ProcessEnv

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "enclave-guioes-"))
  base = join(dir, "enclave.sqlite")
  const bin = join(dir, "bin")
  execFileSync("mkdir", ["-p", bin])
  writeFileSync(join(bin, "ssh"), "#!/bin/sh\necho 'ssh falso: um guiao tentou ir ao servidor' >&2\nexit 97\n")
  chmodSync(join(bin, "ssh"), 0o755)
  ambiente = {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HOME: dir,
    ORWELL_BASE: base,
    ORWELL_SSH: "ninguem@127.0.0.1",
    ORWELL_SSH_KEY: join(dir, "chave-que-nao-existe"),
  }
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function correr(guiao: string, argumentos: string[], extra: NodeJS.ProcessEnv = {}): { codigo: number; saida: string } {
  const resultado = spawnSync(process.execPath, [join(RAIZ, "scripts", guiao), ...argumentos], {
    env: { ...ambiente, ...extra },
    encoding: "utf8",
  })
  return { codigo: resultado.status ?? -1, saida: `${resultado.stdout}${resultado.stderr}` }
}

function sql(consulta: string): string {
  return execFileSync("sqlite3", [base, consulta], { encoding: "utf8" }).trim()
}

const CANAL = "!984:orwell.pt"

/** Real commits in chain for a channel. See `commit-por-epoch.test.ts`. */
async function cadeiaDeCommits(canal: string, quantos: number): Promise<{ commits: Uint8Array[] }> {
  let sala = await createChannel(generateIdentity(parseServerName("orwell.pt")), canal)
  const commits: Uint8Array[] = []
  for (let i = 0; i < quantos; i++) {
    const rotacao = await rotateEpoch(sala)
    commits.push(rotacao.commits[0] as Uint8Array)
    sala = rotacao.session
  }
  return { commits }
}

/** A database with the server schema and one row in each table that cleanup deletes. */
function basePovoada(): void {
  openDatabase(base).close()
  sql(`
    INSERT INTO accounts VALUES ('@a:orwell.pt', x'01', 0);
    INSERT INTO events VALUES ('${CANAL}', 0, 'handshake', x'01', NULL, 0);
    INSERT INTO subscriptions VALUES ('${CANAL}', '@a:orwell.pt');
    INSERT INTO key_packages (address, package) VALUES ('@a:orwell.pt', x'01');
    INSERT INTO channel_claims VALUES ('${CANAL}', '@a:orwell.pt', 0);
    INSERT INTO channel_activity VALUES ('${CANAL}');
    INSERT INTO channel_epochs VALUES ('${CANAL}', 17);
    INSERT INTO group_infos VALUES ('${CANAL}', x'01', 0);
    INSERT INTO cofres (escopo, chave, versao, conteudo, at_minute) VALUES ('canal:${CANAL}', 'AAAAAAAAAAAAAAAAAAAAAA', 1, x'01', 0);
    INSERT INTO cofres_meta (escopo, versao_global) VALUES ('canal:${CANAL}', 1);
  `)
}

const TABELAS_APAGADAS = [
  "events",
  "subscriptions",
  "key_packages",
  "channel_claims",
  "channel_activity",
  "channel_epochs",
  "group_infos",
  "cofres",
  "cofres_meta",
]

describe.skipIf(!sqlite3Disponivel)("limpar-servidor.mjs", () => {
  it("sem confirmação, conta e não apaga nada", () => {
    basePovoada()
    const { codigo, saida } = correr("limpar-servidor.mjs", [])
    expect(saida).not.toContain("ssh falso")
    expect(codigo).toBe(0)
    expect(saida).toContain("Nada foi apagado")
    expect(sql("SELECT count(*) FROM events")).toBe("1")
  })

  it("com confirmação, apaga as nove tabelas, mantém as contas e escreve o marcador", () => {
    basePovoada()
    const { codigo, saida } = correr("limpar-servidor.mjs", [], { ORWELL_APAGAR: "sim" })
    expect(saida).not.toContain("ssh falso")
    expect(codigo).toBe(0)
    for (const tabela of TABELAS_APAGADAS) expect(sql(`SELECT count(*) FROM ${tabela}`), tabela).toBe("0")
    expect(sql("SELECT count(*) FROM accounts")).toBe("1")
    expect(Number(sql("SELECT value FROM server_meta WHERE key = 'reset_at_minute'"))).toBeGreaterThan(0)
  })

  it("uma base de antes de `channel_epochs` limpa-se na mesma, com marcador", () => {
    // This is where it failed: deleted five tables, crashed on the sixth, and the
    // marker-the half that tells clients to forget-was never written.
    basePovoada()
    sql("DROP TABLE channel_epochs")
    const { codigo, saida } = correr("limpar-servidor.mjs", [], { ORWELL_APAGAR: "sim" })
    expect(codigo, saida).toBe(0)
    expect(sql("SELECT count(*) FROM events")).toBe("0")
    expect(sql("SELECT count(*) FROM group_infos")).toBe("0")
    expect(sql("SELECT count(*) FROM server_meta WHERE key = 'reset_at_minute'")).toBe("1")
  })

  it("por omissão é local: sem ORWELL_BASE nem ORWELL_ALVO nunca vai ao servidor", () => {
    // The house rule: a script points to the local machine, and to production only when
    // asked. This one pointed to production by default.
    //
    // WITHOUT `ORWELL_APAGAR`, on purpose: without `ORWELL_BASE` the database is the
    // true `.dev-data` of the repository, and with confirmation this test deleted it
    // whenever it existed (9/13/2026, mid-bancada). To prove where the script points,
    // just count it, which touches nothing; and the exit code depends on whether
    // `.dev-data` exists, so we do not assert.
    const semBase = { ...ambiente }
    delete semBase.ORWELL_BASE
    const resultado = spawnSync(process.execPath, [join(RAIZ, "scripts", "limpar-servidor.mjs")], {
      env: semBase,
      encoding: "utf8",
    })
    const saida = `${resultado.stdout}${resultado.stderr}`
    expect(saida).not.toContain("ssh falso")
    expect(saida).toContain(".dev-data")
  })

  it("à produção só com ORWELL_ALVO=producao, e aí vai mesmo pelo ssh", () => {
    const semBase = { ...ambiente }
    delete semBase.ORWELL_BASE
    const resultado = spawnSync(process.execPath, [join(RAIZ, "scripts", "limpar-servidor.mjs")], {
      env: { ...semBase, ORWELL_ALVO: "producao" },
      encoding: "utf8",
    })
    expect(`${resultado.stdout}${resultado.stderr}`).toContain("ssh falso")
    expect(resultado.status).not.toBe(0)
  })

  it("se o marcador não se escreve, não se apaga nada: é uma transacção só", () => {
    basePovoada()
    sql("DROP TABLE server_meta")
    const { codigo } = correr("limpar-servidor.mjs", [], { ORWELL_APAGAR: "sim" })
    expect(codigo).not.toBe(0)
    expect(sql("SELECT count(*) FROM events")).toBe("1")
    expect(sql("SELECT count(*) FROM channel_epochs")).toBe("1")
  })
})

describe.skipIf(!sqlite3Disponivel)("destrancar-canal.mjs", () => {
  it("sem ORWELL_EPOCH, diz em que epoch o canal está e o que falta, e não muda nada", () => {
    basePovoada()
    const { codigo, saida } = correr("destrancar-canal.mjs", [CANAL], { ORWELL_DESTRANCAR: "sim" })
    expect(saida).not.toContain("ssh falso")
    expect(codigo).not.toBe(0)
    expect(saida).toContain(CANAL)
    expect(saida).toContain("17")
    expect(saida).toContain("ORWELL_EPOCH")
    expect(sql(`SELECT epoch FROM channel_epochs WHERE channel = '${CANAL}'`)).toBe("17")
  })

  it("com ORWELL_EPOCH e sem confirmação, mostra de onde para onde e não muda nada", () => {
    basePovoada()
    const { codigo, saida } = correr("destrancar-canal.mjs", [CANAL], { ORWELL_EPOCH: "18" })
    expect(codigo).toBe(0)
    expect(saida).toContain("17")
    expect(saida).toContain("18")
    expect(saida).toContain("Nada foi alterado")
    expect(sql(`SELECT epoch FROM channel_epochs WHERE channel = '${CANAL}'`)).toBe("17")
  })

  it("com confirmação, grava a epoch pedida nesse canal e só nesse", () => {
    basePovoada()
    sql("INSERT INTO channel_epochs VALUES ('!outro:orwell.pt', 4)")
    const { codigo, saida } = correr("destrancar-canal.mjs", [CANAL], { ORWELL_DESTRANCAR: "sim", ORWELL_EPOCH: "18" })
    expect(saida).not.toContain("ssh falso")
    expect(codigo, saida).toBe(0)
    expect(sql(`SELECT epoch FROM channel_epochs WHERE channel = '${CANAL}'`)).toBe("18")
    expect(sql("SELECT epoch FROM channel_epochs WHERE channel = '!outro:orwell.pt'")).toBe("4")
    // Nothing else touched: no events, no card, no subscriptions.
    expect(sql("SELECT count(*) FROM events")).toBe("1")
    expect(sql("SELECT count(*) FROM group_infos")).toBe("1")
  })

  it("e o que grava sobrevive a um reinício do servidor", async () => {
    /*
      Deleted the row, and `inicializarEpochs` recalculated it from history at
      the next startup: a restart before the next commit would lock the
      channel again at the epoch where the operator had taken it from.
    */
    openDatabase(base).close()
    const { commits } = await cadeiaDeCommits(CANAL, 3)
    commits.forEach((commit, seq) =>
      sql(`INSERT INTO events VALUES ('${CANAL}', ${seq}, 'handshake', x'${Buffer.from(commit).toString("hex")}', NULL, 0)`),
    )
    sql(`INSERT INTO channel_epochs VALUES ('${CANAL}', 3)`)

    const { codigo, saida } = correr("destrancar-canal.mjs", [CANAL], { ORWELL_DESTRANCAR: "sim", ORWELL_EPOCH: "7" })
    expect(codigo, saida).toBe(0)

    const db = openDatabase(base)
    try {
      new Store(db).inicializarEpochs(() => false)
    } finally {
      db.close()
    }
    expect(sql(`SELECT epoch FROM channel_epochs WHERE channel = '${CANAL}'`)).toBe("7")
  }, 30_000)

  it("num canal sem epoch guardada, grava-a", () => {
    basePovoada()
    const { codigo, saida } = correr("destrancar-canal.mjs", ["!ninguem:orwell.pt"], {
      ORWELL_DESTRANCAR: "sim",
      ORWELL_EPOCH: "3",
    })
    expect(codigo, saida).toBe(0)
    expect(saida).toContain("sem epoch guardada")
    expect(sql("SELECT epoch FROM channel_epochs WHERE channel = '!ninguem:orwell.pt'")).toBe("3")
  })

  it("uma ORWELL_EPOCH que não é um inteiro não negativo é recusada, e nada muda", () => {
    basePovoada()
    for (const errada of ["abc", "-1", "1.5", "", "9007199254740993"]) {
      const { codigo } = correr("destrancar-canal.mjs", [CANAL], { ORWELL_DESTRANCAR: "sim", ORWELL_EPOCH: errada })
      expect(codigo, errada).not.toBe(0)
    }
    expect(sql(`SELECT epoch FROM channel_epochs WHERE channel = '${CANAL}'`)).toBe("17")
  })

  it("um identificador com caracteres fora do formato é recusado antes de chegar à base", () => {
    basePovoada()
    const { codigo } = correr("destrancar-canal.mjs", ["!984:orwell.pt'; DROP TABLE events; --"], { ORWELL_DESTRANCAR: "sim" })
    expect(codigo).not.toBe(0)
    expect(sql("SELECT count(*) FROM events")).toBe("1")
    expect(correr("destrancar-canal.mjs", []).codigo).not.toBe(0)
  })

  it("por omissão é local: sem ORWELL_BASE usa a base de desenvolvimento, e nunca o servidor", () => {
    const semBase = { ...ambiente }
    delete semBase.ORWELL_BASE
    const resultado = spawnSync(process.execPath, [join(RAIZ, "scripts", "destrancar-canal.mjs"), CANAL], {
      env: semBase,
      encoding: "utf8",
    })
    const saida = `${resultado.stdout}${resultado.stderr}`
    expect(saida).not.toContain("ssh falso")
    expect(saida).toContain(".dev-data")
  })
})
