import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AvisoDeSuspensao, type ItemDaCaixa, type Motivo } from "@enclave/protocol"
import { openDatabase } from "./db.js"
import { ArquivoDeDenuncias, CaixaDeEntrega, nomeDoFicheiroDaConta, prioridadeDe, type DenunciaGuardada, type Fila } from "./denuncia.js"
import { enderecoCurto } from "./relato.js"
import { Store } from "./store.js"

/**
 * The reports VPS script (`scripts/denuncias.mjs`), run for real
 * against a local `denuncias/` folder and database.
 *
 * **None of these tests reach production**: each run points `ORWELL_BASE`
 * and `ORWELL_DENUNCIAS` at the temp dir, and a fake `ssh` first in the
 * PATH exits with an error and does nothing. If the script tried the server,
 * the output would say "ssh falso" and the test would fail.
 *
 * The script does not import the server's TypeScript: it writes the same formats
 * by hand. The defense against drift is this: everything the script writes is read
 * back here with the server's own classes (`ArquivoDeDenuncias.ler` and
 * `lerAviso`, `CaixaDeEntrega.levantar`, `AvisoDeSuspensao`, `Store`).
 */

const RAIZ = fileURLToPath(new URL("../../../", import.meta.url))
const GUIAO = join(RAIZ, "scripts", "denuncias.mjs")

const ANA = "@ana:orwell.pt"
const BRUNO = "@bruno:orwell.pt"
const CARLA = "@carla:orwell.pt"
const CANAL = "!abcdefghijabcdefghijabcdefghijabcdefghij:orwell.pt"
const SEGREDO = "SEGREDO-DO-TEXTO-DA-MENSAGEM"

let dir: string
let base: string
let pasta: string
let ambiente: NodeJS.ProcessEnv
let arquivo: ArquivoDeDenuncias
let caixa: CaixaDeEntrega

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "enclave-guiao-denuncias-"))
  base = join(dir, "enclave.sqlite")
  pasta = join(dir, "denuncias")
  mkdirSync(pasta, { mode: 0o700 })
  openDatabase(base).close()
  const bin = join(dir, "bin")
  mkdirSync(bin)
  writeFileSync(join(bin, "ssh"), "#!/bin/sh\necho 'ssh falso: o guiao tentou ir ao servidor' >&2\nexit 97\n")
  chmodSync(join(bin, "ssh"), 0o755)
  ambiente = {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HOME: dir,
    ORWELL_BASE: base,
    ORWELL_DENUNCIAS: pasta,
    ORWELL_SSH: "ninguem@127.0.0.1",
    ORWELL_SSH_KEY: join(dir, "chave-que-nao-existe"),
  }
  arquivo = new ArquivoDeDenuncias(pasta)
  caixa = new CaixaDeEntrega(join(pasta, "caixa"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function correr(argumentos: string[], extra: NodeJS.ProcessEnv = {}): { codigo: number; saida: string } {
  const resultado = spawnSync(process.execPath, [GUIAO, ...argumentos], { env: { ...ambiente, ...extra }, encoding: "utf8" })
  const saida = `${resultado.stdout}${resultado.stderr}`
  // Guard for all tests: the script never reaches ssh in local mode.
  expect(saida).not.toContain("ssh falso")
  return { codigo: resultado.status ?? -1, saida }
}

/** A report saved by the server itself, as it arrived: open, with the queue written. */
async function denunciar(motivo: Motivo, extra: { recebida?: string; denunciante?: string } = {}): Promise<DenunciaGuardada> {
  const guardada = await arquivo.guardar({
    v: 1,
    recebida: extra.recebida ?? "2026-11-03T22:15:00.000Z",
    denunciante: extra.denunciante ?? CARLA,
    prioridade: prioridadeDe(motivo),
    art18: motivo === 1 || motivo === 2,
    estado: "aberta",
    verificacao: { geral: "verificada", itens: [{ indice: 0, autor: BRUNO, veredicto: "verificada", aparelho: "AAAA" }] },
    corpo: {
      v: 1,
      motivo,
      nota: "uma nota de quem denuncia",
      boaFe: true,
      canal: CANAL,
      denunciado: BRUNO,
      alvo: { tipo: "mensagem", id: "m1" },
      itens: [{ s: 4, a: BRUNO, p: { type: "text", body: SEGREDO } }],
      denunciada: 0,
      versao: "1.2.0",
      fundador: null,
    },
  })
  await arquivo.escreverFila()
  return guardada
}

function lerFila(): Fila {
  return JSON.parse(readFileSync(join(pasta, "fila.json"), "utf8")) as Fila
}

function comStore<T>(usar: (store: Store) => T): T {
  const db = openDatabase(base)
  try {
    return usar(new Store(db))
  } finally {
    db.close()
  }
}

function linhaDaSuspensao(endereco: string): { activa: number; denuncia: number | null; at_second: number } | undefined {
  const db = openDatabase(base)
  try {
    return db.prepare("SELECT activa, denuncia, at_second FROM suspensoes WHERE address = ?").get(endereco) as
      | { activa: number; denuncia: number | null; at_second: number }
      | undefined
  } finally {
    db.close()
  }
}

function fimDaSuspensao(endereco: string): number | null | undefined {
  const db = openDatabase(base)
  try {
    return (db.prepare("SELECT ate_second FROM suspensoes WHERE address = ?").get(endereco) as { ate_second: number | null } | undefined)
      ?.ate_second
  } finally {
    db.close()
  }
}

const caminhoDoAviso = (endereco: string): string => join(pasta, "suspensoes", `${nomeDoFicheiroDaConta(endereco)}.json`)
const modo = (caminho: string): number => statSync(caminho).mode & 0o777
const hoje = (): string => new Date().toISOString().slice(0, 10)

const SUSPENDER_BRUNO = [
  "suspender",
  BRUNO,
  "--denuncia",
  "1",
  "--motivo",
  "4",
  "--ambito",
  "a conta inteira, em todos os canais",
  "--factos",
  "mensagens de assédio a outra pessoa, verificadas pela assinatura",
  "--norma",
  "Termos, ponto 3",
]

describe("denuncias.mjs: listar e ler", () => {
  it("listar põe as prioritárias primeiro e não mostra texto das mensagens", async () => {
    await denunciar(4)
    await denunciar(1)
    await denunciar(6)
    await denunciar(2)
    const { codigo, saida } = correr(["listar"])
    expect(codigo, saida).toBe(0)
    expect(saida).not.toContain(SEGREDO)
    expect(saida).not.toContain("uma nota de quem denuncia")
    const ordem = [...saida.matchAll(/^#(\d+)\b/gm)].map((linha) => Number(linha[1]))
    expect(ordem).toEqual([2, 4, 1, 3])
    expect(saida).toContain("verificada")
    expect(saida).toContain("2026-11-03T22:15:00.000Z")
    expect(saida).toMatch(/revisões pendentes: 0/)
  })

  it("listar conta as revisões pendentes", async () => {
    await arquivo.guardarRevisao(BRUNO, "não fui eu")
    const { codigo, saida } = correr(["listar"])
    expect(codigo, saida).toBe(0)
    expect(saida).toMatch(/revisões pendentes: 1/)
  })

  it("ler mostra a denúncia inteira, com a verificação item a item", async () => {
    await denunciar(4)
    const { codigo, saida } = correr(["ler", "1"])
    expect(codigo, saida).toBe(0)
    expect(saida).toContain(SEGREDO)
    expect(saida).toContain(BRUNO)
    expect(saida).toContain(CARLA)
    expect(saida).toMatch(/item 0.*verificada/)
    expect(correr(["ler", "9"]).codigo).not.toBe(0)
    expect(correr(["ler", "abc"]).codigo).not.toBe(0)
  })
})

describe("denuncias.mjs: fechar", () => {
  it("fechar muda o estado e deposita a decisão, lida de volta pelo servidor", async () => {
    await denunciar(4)
    await denunciar(1)
    const { codigo, saida } = correr(["fechar", "1", "--decisao", "sem-accao"])
    expect(codigo, saida).toBe(0)

    const fechada = await arquivo.ler(1)
    expect(fechada?.estado).toBe("fechada")
    expect(fechada?.decisao).toBe("sem-accao")
    expect(Date.parse(fechada?.fechada ?? "")).toBeGreaterThan(Date.now() - 60_000)
    expect(fechada?.corpo.itens[0]?.p).toEqual({ type: "text", body: SEGREDO })
    expect(modo(join(pasta, "1.json"))).toBe(0o600)

    const esperado: ItemDaCaixa = { tipo: "decisao", id: "d-1", denuncia: 1, decisao: "sem-accao", canal: CANAL, dia: "2026-11-03" }
    expect(await caixa.lerItem(CARLA, "d-1")).toEqual(esperado)
    // `entregarEm = agora`: the decision goes out at the very next pickup, and only to the reporter.
    expect(await caixa.levantar(CARLA, [])).toEqual([esperado])
    expect(await caixa.levantar(BRUNO, [])).toEqual([])
    const ficheiro = join(pasta, "caixa", enderecoCurto(CARLA), "d-1.json")
    expect(JSON.parse(readFileSync(ficheiro, "utf8")).endereco).toBe(CARLA)
    expect(modo(ficheiro)).toBe(0o600)

    // The queue drops the closed one, and only that one.
    const fila = lerFila()
    expect(fila.abertas.map((aberta) => aberta.numero)).toEqual([2])
    expect(fila.abertas[0]).toEqual({ numero: 2, motivo: 1, prioridade: "alta", art18: true, recebida: "2026-11-03T22:15:00.000Z" })
    expect(modo(join(pasta, "fila.json"))).toBe(0o600)
  })

  it("não fecha duas vezes, e não fecha com uma decisão que não existe", async () => {
    await denunciar(4)
    expect(correr(["fechar", "1", "--decisao", "talvez"]).codigo).not.toBe(0)
    expect(correr(["fechar", "1"]).codigo).not.toBe(0)
    expect((await arquivo.ler(1))?.estado).toBe("aberta")
    expect(correr(SUSPENDER_BRUNO).codigo).toBe(0)
    expect(correr(["fechar", "1", "--decisao", "suspensa"]).codigo).toBe(0)
    const segunda = correr(["fechar", "1", "--decisao", "sem-accao"])
    expect(segunda.codigo).not.toBe(0)
    expect(segunda.saida).toContain("já está fechada")
    expect(await caixa.lerItem(CARLA, "d-1")).toMatchObject({ decisao: "suspensa" })
    expect(correr(["fechar", "7", "--decisao", "sem-accao"]).codigo).not.toBe(0)
  })

  it("recusa se a caixa já tem d-<n> com outra decisão, e não escreve nada (R34)", async () => {
    await denunciar(4)
    await caixa.depositar(CARLA, { tipo: "decisao", id: "d-1", denuncia: 1, decisao: "suspensa", canal: CANAL, dia: "2026-11-03" }, 1)
    const filaAntes = readFileSync(join(pasta, "fila.json"), "utf8")
    const ficheiroDaCaixa = join(pasta, "caixa", enderecoCurto(CARLA), "d-1.json")
    const caixaAntes = readFileSync(ficheiroDaCaixa, "utf8")

    const { codigo, saida } = correr(["fechar", "1", "--decisao", "sem-accao"])
    expect(codigo).not.toBe(0)
    expect(saida).toContain("suspensa")
    expect((await arquivo.ler(1))?.estado).toBe("aberta")
    expect(readFileSync(ficheiroDaCaixa, "utf8")).toBe(caixaAntes)
    expect(readFileSync(join(pasta, "fila.json"), "utf8")).toBe(filaAntes)
  })

  it("fechar --decisao suspensa com a conta não suspensa recusa antes de escrever: a caixa fica vazia e a denúncia aberta", async () => {
    await denunciar(4)
    const filaAntes = readFileSync(join(pasta, "fila.json"), "utf8")
    const { codigo, saida } = correr(["fechar", "1", "--decisao", "suspensa"])
    expect(codigo).not.toBe(0)
    expect(saida).toContain("ainda não está suspensa: corre primeiro suspender")
    expect(await caixa.lerItem(CARLA, "d-1")).toBeNull()
    expect(existsSync(join(pasta, "caixa"))).toBe(false)
    expect((await arquivo.ler(1))?.estado).toBe("aberta")
    expect(readFileSync(join(pasta, "fila.json"), "utf8")).toBe(filaAntes)

    // A suspension whose end has passed does not count either.
    expect(correr([...SUSPENDER_BRUNO, "--ate", hoje()]).codigo).toBe(0)
    const db = openDatabase(base)
    db.prepare("UPDATE suspensoes SET ate_second = ? WHERE address = ?").run(Math.floor(Date.now() / 1000) - 1, BRUNO)
    db.close()
    expect(correr(["fechar", "1", "--decisao", "suspensa"]).codigo).not.toBe(0)
    expect(await caixa.lerItem(CARLA, "d-1")).toBeNull()
    expect((await arquivo.ler(1))?.estado).toBe("aberta")
  })

  it("com a mesma decisão já na caixa (uma corrida que caiu a meio), fecha", async () => {
    await denunciar(4)
    await caixa.depositar(CARLA, { tipo: "decisao", id: "d-1", denuncia: 1, decisao: "sem-accao", canal: CANAL, dia: "2026-11-03" }, 1)
    expect(correr(["fechar", "1", "--decisao", "sem-accao"]).codigo).toBe(0)
    expect((await arquivo.ler(1))?.estado).toBe("fechada")
  })
})

describe("denuncias.mjs: suspender, levantar e manter", () => {
  it("suspender escreve a tabela e o aviso com os campos obrigatórios", async () => {
    await denunciar(4)
    const { codigo, saida } = correr([...SUSPENDER_BRUNO, "--ate", "2027-01-31"])
    expect(codigo, saida).toBe(0)

    expect(comStore((store) => store.estaSuspensa(BRUNO))).toBe(true)
    expect(comStore((store) => store.estaSuspensa(ANA))).toBe(false)
    const linha = linhaDaSuspensao(BRUNO)
    expect(linha?.denuncia).toBe(1)
    expect(linha?.at_second).toBeGreaterThan(Date.now() / 1000 - 60)

    const aviso = await arquivo.lerAviso(BRUNO)
    expect(aviso).toEqual({
      v: 1,
      endereco: BRUNO,
      motivo: 4,
      medida: "suspensao-da-conta",
      desde: hoje(),
      ate: "2027-01-31",
      ambito: "a conta inteira, em todos os canais",
      factos: "mensagens de assédio a outra pessoa, verificadas pela assinatura",
      origem: "denuncia",
      semMeiosAutomaticos: true,
      norma: "Termos, ponto 3",
      revisao: { pedida: null, decisao: "pendente", nota: "" },
    })
    const cru = JSON.parse(readFileSync(caminhoDoAviso(BRUNO), "utf8"))
    expect(AvisoDeSuspensao.safeParse(cru).success).toBe(true)
    expect(cru).toEqual(aviso)
    expect(modo(caminhoDoAviso(BRUNO))).toBe(0o600)
    // The report stays open: closing is another step.
    expect((await arquivo.ler(1))?.estado).toBe("aberta")
  })

  it("sem --ate a suspensão é até à revisão", async () => {
    await denunciar(4)
    expect(correr(SUSPENDER_BRUNO).codigo).toBe(0)
    expect((await arquivo.lerAviso(BRUNO))?.ate).toBeNull()
    expect(fimDaSuspensao(BRUNO)).toBeNull()
  })

  it("com --ate a coluna ate_second guarda o último segundo desse dia em UTC, e depois dele a conta já não está suspensa", async () => {
    await denunciar(4)
    const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    expect(correr([...SUSPENDER_BRUNO, "--ate", amanha]).codigo).toBe(0)
    expect(fimDaSuspensao(BRUNO)).toBe(Date.parse(`${amanha}T23:59:59Z`) / 1000)
    expect(comStore((store) => store.estaSuspensa(BRUNO))).toBe(true)

    // The end has passed (the row as it stands two days later): the server lets it in.
    const db = openDatabase(base)
    db.prepare("UPDATE suspensoes SET ate_second = ? WHERE address = ?").run(Math.floor(Date.now() / 1000) - 86_400, BRUNO)
    db.close()
    expect(comStore((store) => store.estaSuspensa(BRUNO))).toBe(false)
    expect(comStore((store) => store.suspensas())).toEqual([])
    expect(linhaDaSuspensao(BRUNO)?.activa).toBe(1)
    // And the script agrees: `manter` refuses, and `revisoes` says not suspended.
    expect(correr(["manter", BRUNO, "--nota", "x"]).codigo).not.toBe(0)
  })

  it("sem --factos ou --norma recusa e não escreve nada", async () => {
    await denunciar(4)
    for (const falta of ["--factos", "--norma", "--ambito", "--motivo"]) {
      const i = SUSPENDER_BRUNO.indexOf(falta)
      const semEle = [...SUSPENDER_BRUNO.slice(0, i), ...SUSPENDER_BRUNO.slice(i + 2)]
      const { codigo, saida } = correr(semEle)
      expect(codigo, falta).not.toBe(0)
      expect(saida, falta).toContain(falta)
    }
    // And empty ones are not accepted either.
    const vazios = SUSPENDER_BRUNO.map((valor, i) => (SUSPENDER_BRUNO[i - 1] === "--factos" ? "  " : valor))
    expect(correr(vazios).codigo).not.toBe(0)
    expect(correr([...SUSPENDER_BRUNO, "--ate", "amanhã"]).codigo).not.toBe(0)
    // A day that does not exist: the format passes, the calendar does not.
    for (const impossivel of ["2099-02-31", "2099-13-01", "2099-04-31", "2099-00-10"]) {
      expect(correr([...SUSPENDER_BRUNO, "--ate", impossivel]).codigo, impossivel).not.toBe(0)
    }
    expect(correr([...SUSPENDER_BRUNO, "--origem", "robot"]).codigo).not.toBe(0)
    expect(correr(SUSPENDER_BRUNO.map((valor, i) => (SUSPENDER_BRUNO[i - 1] === "--motivo" ? "9" : valor))).codigo).not.toBe(0)

    expect(linhaDaSuspensao(BRUNO)).toBeUndefined()
    expect(existsSync(join(pasta, "suspensoes"))).toBe(false)
  })

  it("com origem denuncia, a denúncia tem de existir e ser contra esta conta", async () => {
    await denunciar(4)
    const outra = SUSPENDER_BRUNO.map((valor) => (valor === BRUNO ? ANA : valor))
    expect(correr(outra).codigo).not.toBe(0)
    const inexistente = SUSPENDER_BRUNO.map((valor, i) => (SUSPENDER_BRUNO[i - 1] === "--denuncia" ? "5" : valor))
    expect(correr(inexistente).codigo).not.toBe(0)
    expect(linhaDaSuspensao(ANA)).toBeUndefined()
    expect(linhaDaSuspensao(BRUNO)).toBeUndefined()
  })

  it("por ordem de uma autoridade, sem denúncia", () => {
    const semDenuncia = [...SUSPENDER_BRUNO.slice(0, 2), ...SUSPENDER_BRUNO.slice(4), "--origem", "autoridade"]
    const { codigo, saida } = correr(semDenuncia)
    expect(codigo, saida).toBe(0)
    expect(linhaDaSuspensao(BRUNO)).toMatchObject({ activa: 1, denuncia: null })
  })

  it("se a tabela não se escreve, o aviso desfaz-se: as duas escritas são uma operação", async () => {
    await denunciar(4)
    const db = openDatabase(base)
    db.exec("DROP TABLE suspensoes")
    db.close()
    const { codigo } = correr(SUSPENDER_BRUNO)
    expect(codigo).not.toBe(0)
    expect(existsSync(caminhoDoAviso(BRUNO))).toBe(false)

    // And with an earlier notice, the earlier one stays.
    openDatabase(base).close()
    expect(correr(SUSPENDER_BRUNO).codigo).toBe(0)
    const antes = readFileSync(caminhoDoAviso(BRUNO), "utf8")
    const db2 = openDatabase(base)
    db2.exec("DROP TABLE suspensoes")
    db2.close()
    expect(correr(SUSPENDER_BRUNO.map((valor) => (valor === "Termos, ponto 3" ? "Termos, ponto 9" : valor))).codigo).not.toBe(0)
    expect(readFileSync(caminhoDoAviso(BRUNO), "utf8")).toBe(antes)
  })

  it("levantar põe activa a 0, não muda at_second, e escreve a decisão da revisão (R31)", async () => {
    await denunciar(4)
    expect(correr(SUSPENDER_BRUNO).codigo).toBe(0)
    const db = openDatabase(base)
    db.prepare("UPDATE suspensoes SET at_second = 1700000000 WHERE address = ?").run(BRUNO)
    db.close()
    await arquivo.guardarRevisao(BRUNO, "foi um mal-entendido")

    const { codigo, saida } = correr(["levantar", BRUNO, "--nota", "a revisão deu razão à pessoa"])
    expect(codigo, saida).toBe(0)
    expect(comStore((store) => store.estaSuspensa(BRUNO))).toBe(false)
    expect(linhaDaSuspensao(BRUNO)).toEqual({ activa: 0, denuncia: 1, at_second: 1700000000 })
    const aviso = await arquivo.lerAviso(BRUNO)
    expect(aviso?.revisao.decisao).toBe("levantada")
    expect(aviso?.revisao.nota).toBe("a revisão deu razão à pessoa")
    expect(aviso?.revisao.pedida).not.toBeNull()
    expect(lerFila().revisoesPendentes).toBe(0)

    // Picking up again changes nothing; an account that was never suspended is an error.
    expect(correr(["levantar", BRUNO]).codigo).toBe(0)
    expect(linhaDaSuspensao(BRUNO)).toEqual({ activa: 0, denuncia: 1, at_second: 1700000000 })
    expect((await arquivo.lerAviso(BRUNO))?.revisao.nota).toBe("a revisão deu razão à pessoa")
    expect(correr(["levantar", ANA]).codigo).not.toBe(0)
    expect(linhaDaSuspensao(ANA)).toBeUndefined()
  })

  it("levantar que caiu a meio (levantada na base, revisão por decidir) completa-se na segunda corrida", async () => {
    await denunciar(4)
    expect(correr(SUSPENDER_BRUNO).codigo).toBe(0)
    await arquivo.guardarRevisao(BRUNO, "peço revisão")
    // The state where the first run stopped: the notice and the database already written,
    // and the review still pending.
    const aviso = await arquivo.lerAviso(BRUNO)
    await arquivo.escreverAviso(BRUNO, { ...aviso!, revisao: { ...aviso!.revisao, decisao: "levantada", nota: "revisto" } })
    const db = openDatabase(base)
    db.prepare("UPDATE suspensoes SET activa = 0 WHERE address = ?").run(BRUNO)
    db.close()
    expect(lerFila().revisoesPendentes).toBe(1)

    const { codigo, saida } = correr(["levantar", BRUNO])
    expect(codigo, saida).toBe(0)
    expect(lerFila().revisoesPendentes).toBe(0)
    expect(correr(["revisoes"]).saida).toMatch(/revisões pendentes: 0/)
    const pedido = JSON.parse(readFileSync(join(pasta, "revisoes", readdirSync(join(pasta, "revisoes"))[0]!), "utf8"))
    expect(pedido.decisao).toBe("levantada")
    expect((await arquivo.lerAviso(BRUNO))?.revisao).toMatchObject({ decisao: "levantada", nota: "revisto" })
    expect(linhaDaSuspensao(BRUNO)?.activa).toBe(0)
  })

  it("manter deixa a conta suspensa e escreve a decisão da revisão", async () => {
    await denunciar(4)
    expect(correr(SUSPENDER_BRUNO).codigo).toBe(0)
    expect(correr(["manter", BRUNO]).codigo).not.toBe(0)
    const { codigo, saida } = correr(["manter", BRUNO, "--nota", "os factos confirmam-se"])
    expect(codigo, saida).toBe(0)
    expect(comStore((store) => store.estaSuspensa(BRUNO))).toBe(true)
    const aviso = await arquivo.lerAviso(BRUNO)
    expect(aviso?.revisao).toEqual({ pedida: null, decisao: "mantida", nota: "os factos confirmam-se" })
  })

  it("revisoes mostra os pedidos pendentes com a nota da pessoa, e a decisão tira-os da lista", async () => {
    await denunciar(4)
    expect(correr(SUSPENDER_BRUNO).codigo).toBe(0)
    await arquivo.guardarRevisao(BRUNO, "peço que revejam, a mensagem era uma citação")
    expect(lerFila().revisoesPendentes).toBe(1)

    const antes = correr(["revisoes"])
    expect(antes.codigo, antes.saida).toBe(0)
    expect(antes.saida).toContain(BRUNO)
    expect(antes.saida).toContain("peço que revejam, a mensagem era uma citação")
    expect(antes.saida).toContain("pendente")

    expect(correr(["manter", BRUNO, "--nota", "revisto"]).codigo).toBe(0)
    const depois = correr(["revisoes"])
    expect(depois.saida).not.toContain("peço que revejam")
    expect(depois.saida).toMatch(/revisões pendentes: 0/)
    expect(lerFila().revisoesPendentes).toBe(0)
    // The user's request is not deleted.
    expect(readdirSync(join(pasta, "revisoes"))).toHaveLength(1)

    // A new request after the decision is pending again, and the server still reads it.
    await arquivo.guardarRevisao(BRUNO, "outra vez")
    expect(lerFila().revisoesPendentes).toBe(1)
    expect(correr(["revisoes"]).saida).toContain("outra vez")
    expect((await arquivo.lerAviso(BRUNO))?.revisao.decisao).toBe("mantida")
  })
})

describe("denuncias.mjs: autoridades", () => {
  it("regista informado e a data de hoje", async () => {
    await denunciar(1)
    const { codigo, saida } = correr(["autoridades", "1", "--informado", "PJ", "--nota", "participação por email à PJ"])
    expect(codigo, saida).toBe(0)
    expect(saida).not.toContain("não se aplica")
    const denuncia = await arquivo.ler(1)
    expect(denuncia?.autoridades).toEqual({ informado: "PJ", data: hoje(), nota: "participação por email à PJ" })
    expect(denuncia?.estado).toBe("aberta")
    expect(modo(join(pasta, "1.json"))).toBe(0o600)
  })

  it("para o motivo 3 avisa que o art. 18.º não se aplica, mas regista na mesma", async () => {
    await denunciar(3)
    const { codigo, saida } = correr(["autoridades", "1", "--informado", "nao", "--nota", "sem ameaça"])
    expect(codigo, saida).toBe(0)
    expect(saida).toContain("não se aplica")
    expect((await arquivo.ler(1))?.autoridades).toEqual({ informado: "nao", data: hoje(), nota: "sem ameaça" })
  })

  it("recusa um informado fora de PJ, MP e nao", async () => {
    await denunciar(1)
    expect(correr(["autoridades", "1", "--informado", "GNR", "--nota", "x"]).codigo).not.toBe(0)
    expect((await arquivo.ler(1))?.autoridades).toBeUndefined()
  })
})

describe("denuncias.mjs: o ambiente", () => {
  it("sem subcomando imprime o uso e sai 1", () => {
    const { codigo, saida } = correr([])
    expect(codigo).toBe(1)
    expect(saida).toContain("listar")
    expect(saida).toContain("suspender")
    expect(correr(["apagar", "1"]).codigo).toBe(1)
  })

  it("sem ORWELL_BASE ou ORWELL_DENUNCIAS recusa, e nunca vai ao servidor", () => {
    for (const falta of ["ORWELL_BASE", "ORWELL_DENUNCIAS"]) {
      const semEla = { ...ambiente }
      delete semEla[falta]
      const resultado = spawnSync(process.execPath, [GUIAO, "listar"], { env: semEla, encoding: "utf8" })
      const saida = `${resultado.stdout}${resultado.stderr}`
      expect(saida, falta).not.toContain("ssh falso")
      expect(saida, falta).toContain(falta)
      expect(resultado.status, falta).toBe(1)
    }
  })

  it("uma base ou uma pasta que não existem não se criam", () => {
    expect(correr(["listar"], { ORWELL_BASE: join(dir, "nao-existe.sqlite") }).codigo).toBe(1)
    expect(existsSync(join(dir, "nao-existe.sqlite"))).toBe(false)
    expect(correr(["listar"], { ORWELL_DENUNCIAS: join(dir, "nao-existe") }).codigo).toBe(1)
    expect(existsSync(join(dir, "nao-existe"))).toBe(false)
  })

  it("nenhum subcomando tenta o ssh falso", async () => {
    await denunciar(1)
    await denunciar(4)
    const corridas = [
      ["listar"],
      ["ler", "1"],
      ["autoridades", "1", "--informado", "MP", "--nota", "x"],
      ["fechar", "1", "--decisao", "sem-accao"],
      SUSPENDER_BRUNO.map((valor, i) => (SUSPENDER_BRUNO[i - 1] === "--denuncia" ? "2" : valor)),
      ["revisoes"],
      ["manter", BRUNO, "--nota", "x"],
      ["levantar", BRUNO],
    ]
    for (const argumentos of corridas) {
      // `correr` already fails if the output says "ssh falso".
      expect(correr(argumentos).codigo, argumentos.join(" ")).toBe(0)
    }
    // Never deletes reports.
    expect((await arquivo.listar()).map((denuncia) => denuncia.numero)).toEqual([1, 2])
  })
})
