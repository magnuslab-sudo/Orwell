#!/usr/bin/env node
/**
 * The script for the reports VPS (`docs/planos/denuncias-design.md`, §6 to §9b).
 * A person runs it; nothing on the server suspends by itself.
 *
 * Usage:
 *   node scripts/denuncias.mjs list
 *   node scripts/denuncias.mjs read <number>
 *   node scripts/denuncias.mjs close <number> --decision no-action|suspended
 *   node scripts/denuncias.mjs suspend <address> --report <number> --reason N --scope "..." \
 *        --facts "..." --rule "..." [--until YYYY-MM-DD] [--origin report|authority|operator]
 *   node scripts/denuncias.mjs lift <address> [--note "..."]
 *   node scripts/denuncias.mjs keep <address> --note "..."
 *   node scripts/denuncias.mjs revisions
 *   node scripts/denuncias.mjs authorities <number> --notified PJ|MP|no --note "..."
 *
 * **Where.** By default is LOCAL, and then `ORWELL_BASE` (the `enclave.sqlite`)
 * and `ORWELL_DENUNCIAS` (the `denuncias/` folder) are required and must exist:
 * nothing is created. Production only with `ORWELL_ALVO=producao` and
 * `ORWELL_SSH` (user@host); `ORWELL_SSH_KEY` chooses the key, as in
 * `limpar-servidor.mjs`. The `-6` flag is only used when the host is an IPv6
 * address.
 *
 * **The formats are the server's** (`apps/server/src/denuncia.ts`), written here
 * by hand because the script has no dependencies and does not import TypeScript.
 * The test (`apps/server/src/guiao-denuncias.test.ts`) reads back everything
 * this script writes with the server's own classes: if a format changes there,
 * the test fails here.
 *
 * **Concurrency (R33, R35).** The server is another process and writes to the
 * same folder, but only adds reports with new numbers, revisions with new names,
 * new items to the inbox, and rewrites `fila.json`; and only deletes CLOSED
 * reports. This script rewrites one report at a time, by atomic rename.
 * `fila.json` is calculated in full from files on both sides, and
 * `revisoesPendentes` too (requests without `decidida`, same rule on the server
 * and here): if two queue writes cross, the next one from either side fixes it.
 * What is NOT protected: two people running this script at the same time (the
 * same report closed twice, one note written over another). One person at a time.
 *
 * Never deletes reports: cleanup is the server's job (`varrer`).
 */
import { execFileSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { parseArgs } from "node:util"

const PRODUCAO = process.env.ORWELL_ALVO === "producao"
const ANFITRIAO = process.env.ORWELL_SSH ?? ""
const CHAVE = process.env.ORWELL_SSH_KEY ? ["-i", process.env.ORWELL_SSH_KEY] : []
if (PRODUCAO && !ANFITRIAO) {
  console.error("Falta ORWELL_SSH (por exemplo utilizador@anfitriao) para ir ao servidor.")
  process.exit(2)
}
const VOLUME = "/var/lib/docker/volumes/enclave_server-data/_data"

const USO = `Uso:
  node scripts/denuncias.mjs listar
  node scripts/denuncias.mjs ler <numero>
  node scripts/denuncias.mjs fechar <numero> --decisao sem-accao|suspensa
  node scripts/denuncias.mjs suspender <endereco> --denuncia <numero> --motivo N --ambito "..." --factos "..." --norma "..." [--ate AAAA-MM-DD] [--origem denuncia|autoridade|operador]
  node scripts/denuncias.mjs levantar <endereco> [--nota "..."]
  node scripts/denuncias.mjs manter <endereco> --nota "..."
  node scripts/denuncias.mjs revisoes
  node scripts/denuncias.mjs autoridades <numero> --informado PJ|MP|nao --nota "..."

Local por omissão: ORWELL_BASE e ORWELL_DENUNCIAS obrigatórias. Produção: ORWELL_ALVO=producao.`

class Recusa extends Error {}

// ------------------------------------------------------------ server formats

const MOTIVOS_PRIORITARIOS = [1, 2]
const NOME_DA_DENUNCIA = /^(\d+)\.json$/
const NOME_DA_REVISAO = /^([0-9a-f]{32})-(\d+)\.json$/
const ID_DA_CAIXA = /^[a-z0-9-]{1,64}$/
const DIA = /^\d{4}-\d{2}-\d{2}$/

/** `nomeDoFicheiroDaConta` from `denuncia.ts`: the first 32 hex digits of the SHA-256 of the full address. */
function nomeDoFicheiroDaConta(endereco) {
  return createHash("sha256").update(endereco, "utf8").digest("hex").slice(0, 32)
}

/** `enderecoCurto` from `relato.ts`: the name of the inbox folder. */
function enderecoCurto(endereco) {
  const local = endereco.slice(1, endereco.indexOf(":") > 0 ? endereco.indexOf(":") : undefined)
  const limpo = local.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 32)
  return limpo || "anonimo"
}

/** `YYYY-MM-DD` for a day that exists: 2026-02-31 does not come back the same from `Date`. */
function diaQueExiste(texto) {
  if (!DIA.test(texto)) return false
  const data = new Date(`${texto}T00:00:00Z`)
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === texto
}

const hoje = () => new Date().toISOString().slice(0, 10)
const comoJson = (valor) => `${JSON.stringify(valor, null, 2)}\n`

const eTexto = (valor, maximo) => typeof valor === "string" && valor.length <= maximo

/** The `AvisoDeSuspensao` schema from `packages/protocol/src/denuncia.ts`, field by field. */
function avisoValido(aviso) {
  const r = aviso?.revisao
  return (
    aviso?.v === 1 &&
    eTexto(aviso.endereco, 300) &&
    Number.isInteger(aviso.motivo) &&
    aviso.motivo >= 1 &&
    aviso.motivo <= 8 &&
    aviso.medida === "suspensao-da-conta" &&
    eTexto(aviso.desde, 40) &&
    (aviso.ate === null || eTexto(aviso.ate, 40)) &&
    eTexto(aviso.ambito, 300) &&
    eTexto(aviso.factos, 2000) &&
    ["denuncia", "autoridade", "operador"].includes(aviso.origem) &&
    aviso.semMeiosAutomaticos === true &&
    eTexto(aviso.norma, 300) &&
    typeof r === "object" &&
    r !== null &&
    (r.pedida === null || eTexto(r.pedida, 40)) &&
    ["pendente", "mantida", "levantada"].includes(r.decisao) &&
    eTexto(r.nota, 2000)
  )
}

/** The notice with only the schema fields, in order (what `AvisoDeSuspensao.parse` returns). */
function avisoArrumado(a) {
  return {
    v: 1,
    endereco: a.endereco,
    motivo: a.motivo,
    medida: a.medida,
    desde: a.desde,
    ate: a.ate,
    ambito: a.ambito,
    factos: a.factos,
    origem: a.origem,
    semMeiosAutomaticos: true,
    norma: a.norma,
    revisao: { pedida: a.revisao.pedida, decisao: a.revisao.decisao, nota: a.revisao.nota },
  }
}

/** The inbox decision, as `ItemDaCaixa` accepts it. */
function itemDeDecisaoValido(item) {
  return (
    item?.tipo === "decisao" &&
    typeof item.id === "string" &&
    ID_DA_CAIXA.test(item.id) &&
    Number.isInteger(item.denuncia) &&
    ["suspensa", "sem-accao"].includes(item.decisao) &&
    eTexto(item.canal, 300) &&
    typeof item.dia === "string" &&
    DIA.test(item.dia)
  )
}

// ------------------------------------------------------------ o disco

/**
 * The `denuncias/` folder, with paths relative to it. Always writes via temp
 * file and rename, with mode 0600, and folders with 0700: same as `escreverAtomico`
 * and the server's `mkdir` calls.
 */
function discoLocal(raiz) {
  const absoluto = (relativo) => join(raiz, relativo)
  return {
    ler(relativo) {
      try {
        return readFileSync(absoluto(relativo), "utf8")
      } catch (erro) {
        if (erro?.code === "ENOENT") return null
        throw erro
      }
    },
    /** Files in a folder whose name matches `padrao`, with the text of each one. */
    lerPasta(relativo, padrao) {
      let nomes
      try {
        nomes = readdirSync(absoluto(relativo))
      } catch (erro) {
        if (erro?.code === "ENOENT") return []
        throw erro
      }
      return nomes
        .filter((nome) => padrao.test(nome))
        .map((nome) => ({ nome, texto: this.ler(join(relativo, nome)) }))
        .filter((ficheiro) => ficheiro.texto !== null)
    },
    escrever(relativo, texto) {
      const caminho = absoluto(relativo)
      mkdirSync(dirname(caminho), { recursive: true, mode: 0o700 })
      const temporario = `${caminho}.${randomBytes(6).toString("hex")}.tmp`
      writeFileSync(temporario, texto, { encoding: "utf8", mode: 0o600 })
      renameSync(temporario, caminho)
    },
    /** Only to undo a notice that just got written. Never a report. */
    apagar(relativo) {
      rmSync(absoluto(relativo), { force: true })
    },
  }
}

/** A word in single quotes for the host's shell. */
const plicas = (texto) => `'${String(texto).replaceAll("'", "'\\''")}'`

function ssh(comando, entrada) {
  const familia = ANFITRIAO.slice(ANFITRIAO.indexOf("@") + 1).includes(":") ? ["-6"] : []
  return execFileSync("ssh", [...familia, ...CHAVE, ...(CHAVE.length ? ["-o", "IdentitiesOnly=yes"] : []), "-o", "BatchMode=yes", ANFITRIAO, comando], {
    encoding: "utf8",
    input: entrada,
    maxBuffer: 256 * 1024 * 1024,
  })
}

/**
 * The same folder, on the server volume, over ssh as root.
 *
 * **The owner.** The container runs as `node` (`infra/Dockerfile`: `USER node`,
 * and `/data` with `chown node:node`), and it creates `denuncias/` with 0700.
 * A file root writes stays root, and the server could not read it (the inbox,
 * the notice) or rewrite it (`fila.json`, rename in a folder it owns works, but
 * the notice read by `lerAviso` does not). So every new file and folder get the
 * uid:gid of `denuncias/` (`stat -c %u:%g`), read on the host at each write, and
 * mode 0600 (folders 0700), with `umask 077` so the temp never exists open to
 * others.
 *
 * The content travels in base64 through the ssh input, never inside the command:
 * quotes, `$` and newlines in notes break nothing.
 */
function discoRemoto(raiz) {
  const absoluto = (relativo) => (relativo === "" ? raiz : `${raiz}/${relativo}`)
  return {
    ler(relativo) {
      const caminho = plicas(absoluto(relativo))
      const saida = ssh(`if [ -f ${caminho} ]; then printf 'ok:'; base64 -w0 ${caminho}; else printf 'ausente'; fi`)
      if (saida === "ausente") return null
      if (!saida.startsWith("ok:")) throw new Error(`resposta inesperada do servidor ao ler ${relativo}`)
      return Buffer.from(saida.slice(3), "base64").toString("utf8")
    },
    lerPasta(relativo, padrao) {
      // A link to the whole folder: one line "name<TAB>base64" per file.
      const saida = ssh(
        `cd ${plicas(absoluto(relativo))} 2>/dev/null || exit 0; for f in *.json; do [ -f "$f" ] || continue; printf '%s\\t' "$f"; base64 -w0 "$f"; printf '\\n'; done`,
      )
      return saida
        .split("\n")
        .filter((linha) => linha.includes("\t"))
        .map((linha) => {
          const [nome, b64] = linha.split("\t")
          return { nome, texto: Buffer.from(b64, "base64").toString("utf8") }
        })
        .filter((ficheiro) => padrao.test(ficheiro.nome))
    },
    escrever(relativo, texto) {
      const partes = relativo.split("/")
      const pastas = []
      for (let i = 1; i < partes.length; i++) pastas.push(absoluto(partes.slice(0, i).join("/")))
      const final = plicas(absoluto(relativo))
      const temporario = plicas(`${absoluto(relativo)}.${randomBytes(6).toString("hex")}.tmp`)
      const comando = [
        "set -e",
        "umask 077",
        `dono=$(stat -c %u:%g ${plicas(raiz)})`,
        ...pastas.map((pasta) => `[ -d ${plicas(pasta)} ] || { mkdir -m 700 ${plicas(pasta)} && chown "$dono" ${plicas(pasta)}; }`),
        `trap 'rm -f ${temporario.slice(1, -1)}' EXIT`,
        `base64 -d > ${temporario}`,
        `chown "$dono" ${temporario}`,
        `chmod 600 ${temporario}`,
        `mv -f ${temporario} ${final}`,
      ].join("\n")
      ssh(comando, Buffer.from(texto, "utf8").toString("base64"))
    },
    apagar(relativo) {
      ssh(`rm -f -- ${plicas(absoluto(relativo))}`)
    },
  }
}

// ------------------------------------------------------------ a base

/** A value as SQL literal, for the remote database (sqlite3 does not take parameters from the command line). */
function literal(valor) {
  if (valor === null) return "NULL"
  if (typeof valor === "number" && Number.isSafeInteger(valor)) return String(valor)
  if (typeof valor === "string") return `'${valor.replaceAll("'", "''")}'`
  throw new Error(`valor SQL inesperado: ${valor}`)
}

async function baseLocal(caminho) {
  // node:sqlite warns it is experimental. It does not matter here, and the warning cluttered the output.
  process.removeAllListeners("warning")
  const { DatabaseSync } = await import("node:sqlite")
  const db = new DatabaseSync(caminho, { timeout: 5000 })
  return {
    consultar: (sql, parametros = []) => db.prepare(sql).all(...parametros),
    executar: (sql, parametros = []) => void db.prepare(sql).run(...parametros),
  }
}

/**
 * The server database, over ssh, with the host's sqlite3. The SQL goes in base64
 * through the input, like files. `-bail` stops at the first error; `.timeout`
 * waits for the server if it is writing.
 *
 * The database is in WAL and owned by `node`. If the server is down, sqlite3
 * as root creates `-wal` and `-shm` as root, and the server would not start.
 * So after, all three files go back to the database owner.
 */
function baseRemota(caminho) {
  // The chown runs in a `trap ... EXIT`: it also runs when sqlite3 fails and
  // `set -e` exits midway, so no root files are left behind.
  const devolverAoDono = [
    `dono=$(stat -c %u:%g ${plicas(caminho)})`,
    `for f in ${plicas(`${caminho}-wal`)} ${plicas(`${caminho}-shm`)} ${plicas(`${caminho}-journal`)}; do [ -e "$f" ] && chown "$dono" "$f"; done`,
    "true",
  ].join("; ")
  const correr = (sql, comJson) =>
    ssh(
      [
        "set -e",
        `trap ${plicas(devolverAoDono)} EXIT`,
        `base64 -d | sqlite3 -bail ${comJson ? "-json " : ""}-cmd '.timeout 5000' ${plicas(caminho)}`,
      ].join("\n"),
      Buffer.from(sql, "utf8").toString("base64"),
    )
  const preencher = (sql, parametros) => {
    let i = 0
    return sql.replaceAll("?", () => literal(parametros[i++]))
  }
  return {
    consultar(sql, parametros = []) {
      const saida = correr(preencher(sql, parametros), true).trim()
      return saida === "" ? [] : JSON.parse(saida)
    },
    executar(sql, parametros = []) {
      correr(preencher(sql, parametros), false)
    },
  }
}

// ------------------------------------------------------------ o arquivo

function criarArquivo(disco) {
  const lerJson = (relativo) => {
    const texto = disco.ler(relativo)
    if (texto === null) return null
    try {
      return JSON.parse(texto)
    } catch {
      return null
    }
  }

  const listar = () =>
    disco
      .lerPasta("", NOME_DA_DENUNCIA)
      .map(({ texto }) => {
        try {
          return JSON.parse(texto)
        } catch {
          return null // Unreadable: it is skipped and does not stop the others, as on the server.
        }
      })
      .filter((denuncia) => denuncia !== null && Number.isSafeInteger(denuncia.numero))
      .sort((a, b) => a.numero - b.numero)

  const revisoes = () =>
    disco
      .lerPasta("revisoes", NOME_DA_REVISAO)
      .map(({ nome, texto }) => {
        try {
          return { nome, pedido: JSON.parse(texto) }
        } catch {
          return null
        }
      })
      .filter((revisao) => revisao !== null && typeof revisao.pedido?.endereco === "string")
      .sort((a, b) => String(a.pedido.recebido).localeCompare(String(b.pedido.recebido)))

  /** Pending is the request without `decidida`: this script marks it when someone decides. */
  const revisoesPendentes = () => revisoes().filter((revisao) => revisao.pedido.decidida === undefined)

  const caminhoDoAviso = (endereco) => `suspensoes/${nomeDoFicheiroDaConta(endereco)}.json`

  return {
    listar,
    revisoes,
    revisoesPendentes,
    caminhoDoAviso,

    ler(numero) {
      return lerJson(`${numero}.json`)
    },

    escreverDenuncia(denuncia) {
      disco.escrever(`${denuncia.numero}.json`, comoJson(denuncia))
    },

    /**
     * `fila.json` as `#reescreverFila`: the open ones, priority first and, within
     * each priority, oldest first; only numbers and dates. `revisoesPendentes`
     * counts requests without `decidida`, as on the server (R35): never added to
     * the previous value.
     */
    reescreverFila() {
      const peso = (prioridade) => (prioridade === "alta" ? 0 : 1)
      const abertas = listar()
        .filter((denuncia) => denuncia.estado === "aberta")
        .sort((a, b) => peso(a.prioridade) - peso(b.prioridade) || a.numero - b.numero)
        .map(({ numero, corpo, prioridade, art18, recebida }) => ({ numero, motivo: corpo.motivo, prioridade, art18, recebida }))
      const fila = { v: 1, abertas, revisoesPendentes: revisoesPendentes().length, actualizada: new Date().toISOString() }
      disco.escrever("fila.json", comoJson(fila))
    },

    /** `lerAviso`: `null` if no file, unreadable, outside the schema, or from another account. */
    lerAviso(endereco) {
      const aviso = lerJson(caminhoDoAviso(endereco))
      return avisoValido(aviso) && aviso.endereco === endereco ? avisoArrumado(aviso) : null
    },

    /** The notice text as it is on disk, to undo it. */
    avisoCru(endereco) {
      return disco.ler(caminhoDoAviso(endereco))
    },

    escreverAviso(aviso) {
      if (!avisoValido(aviso)) throw new Recusa("o aviso não passa no esquema AvisoDeSuspensao")
      disco.escrever(caminhoDoAviso(aviso.endereco), comoJson(avisoArrumado(aviso)))
    },

    repor(relativo, textoAnterior) {
      if (textoAnterior === null) disco.apagar(relativo)
      else disco.escrever(relativo, textoAnterior)
    },

    /** The `id` item in the inbox of `endereco`, as `CaixaDeEntrega.lerItem`: `null` if not theirs or unreadable. */
    lerItemDaCaixa(endereco, id) {
      const guardado = lerJson(`caixa/${enderecoCurto(endereco)}/${id}.json`)
      if (!guardado || typeof guardado.endereco !== "string" || !Number.isFinite(guardado.entregarEm)) return null
      if (guardado.endereco !== endereco) return null
      return guardado.item ?? null
    },

    /** `CaixaDeEntrega.depositar`: `{ endereco, item, entregarEm }` on one line, on top of the same id. */
    depositar(endereco, item, entregarEm) {
      if (!itemDeDecisaoValido(item)) throw new Recusa("a decisão não passa no esquema ItemDaCaixa")
      disco.escrever(`caixa/${enderecoCurto(endereco)}/${item.id}.json`, `${JSON.stringify({ endereco, item, entregarEm })}\n`)
    },

    /** Mark as decided the review requests for this account that were pending. Delete none. */
    decidirRevisoes(endereco, decisao) {
      const nome = nomeDoFicheiroDaConta(endereco)
      const agora = new Date().toISOString()
      let marcados = 0
      for (const revisao of revisoesPendentes()) {
        if (!revisao.nome.startsWith(`${nome}-`) || revisao.pedido.endereco !== endereco) continue
        disco.escrever(`revisoes/${revisao.nome}`, comoJson({ ...revisao.pedido, decidida: agora, decisao }))
        marcados += 1
      }
      return marcados
    },
  }
}

// ------------------------------------------------------------ the arguments

function numeroDaDenuncia(texto) {
  if (texto === undefined || !/^\d{1,15}$/.test(texto) || Number(texto) < 1) {
    throw new Recusa(`número de denúncia inválido: ${texto ?? "(nenhum)"}`)
  }
  return Number(texto)
}

/** An account address, `@local:servidor`, with no spaces, quotes or slashes. */
function enderecoDeConta(texto) {
  if (texto === undefined || texto.length > 300 || !/^@[^\s:'"\\/]+:[^\s'"\\/]+$/.test(texto)) {
    throw new Recusa(`endereço de conta inválido: ${texto ?? "(nenhum)"}`)
  }
  return texto
}

function obrigatorio(opcoes, nome, maximo) {
  const valor = opcoes[nome]
  if (typeof valor !== "string" || valor.trim() === "") throw new Recusa(`falta --${nome}`)
  if (valor.length > maximo) throw new Recusa(`--${nome} tem mais de ${maximo} caracteres`)
  return valor
}

function opcional(opcoes, nome, maximo) {
  const valor = opcoes[nome]
  if (valor === undefined) return undefined
  if (valor.length > maximo) throw new Recusa(`--${nome} tem mais de ${maximo} caracteres`)
  return valor
}

function argumentos(lista, opcoes) {
  try {
    return parseArgs({ args: lista, options: opcoes, allowPositionals: true, strict: true })
  } catch (erro) {
    throw new Recusa(erro.message)
  }
}

const texto = { type: "string" }

// ------------------------------------------------------------ the subcommands

function linhaDaLista(denuncia) {
  const art18 = denuncia.art18 ? "  art. 18.º" : ""
  const autoridades = denuncia.autoridades ? `  autoridades: ${denuncia.autoridades.informado} em ${denuncia.autoridades.data}` : ""
  const decisao = denuncia.decisao ? ` (${denuncia.decisao})` : ""
  return `#${denuncia.numero}  motivo ${denuncia.corpo?.motivo}  ${denuncia.prioridade}  ${denuncia.estado}${decisao}  ${denuncia.verificacao?.geral}  ${denuncia.recebida}${art18}${autoridades}`
}

/** Numbers, states, and dates. Never message text or notes. */
function listar(arquivo) {
  const peso = (d) => (d.estado === "aberta" ? 0 : 2) + (d.prioridade === "alta" ? 0 : 1)
  const todas = arquivo.listar().sort((a, b) => peso(a) - peso(b) || a.numero - b.numero)
  if (todas.length === 0) console.log("Nenhuma denúncia.")
  for (const denuncia of todas) console.log(linhaDaLista(denuncia))
  console.log("")
  console.log(`revisões pendentes: ${arquivo.revisoesPendentes().length}`)
}

function ler(arquivo, numero) {
  const denuncia = arquivo.ler(numero)
  if (!denuncia) throw new Recusa(`a denúncia ${numero} não existe`)
  const corpo = denuncia.corpo ?? {}
  console.log(linhaDaLista(denuncia))
  console.log(`denunciante: ${denuncia.denunciante}`)
  console.log(`denunciado:  ${corpo.denunciado}`)
  console.log(`canal:       ${corpo.canal}${corpo.sala ? `  sala ${corpo.sala}` : ""}`)
  console.log(`alvo:        ${corpo.alvo?.tipo}${corpo.alvo?.id ? ` ${corpo.alvo.id}` : ""}  (item denunciado: ${corpo.denunciada})`)
  console.log(`versão:      ${corpo.versao}`)
  if (corpo.contacto) console.log(`contacto:    ${corpo.contacto.nome} <${corpo.contacto.email}>`)
  if (denuncia.fechada) console.log(`fechada:     ${denuncia.fechada}`)
  console.log(`nota:        ${corpo.nota}`)
  console.log("")
  console.log(`verificação: ${denuncia.verificacao?.geral}`)
  const veredictos = new Map((denuncia.verificacao?.itens ?? []).map((v) => [v.indice, v]))
  ;(corpo.itens ?? []).forEach((item, indice) => {
    const v = veredictos.get(indice)
    const aparelho = v?.aparelho ? `  aparelho ${v.aparelho}` : ""
    console.log(`  item ${indice}  ${v?.veredicto ?? "sem veredicto"}  autor ${item.a}  seq ${item.s}${aparelho}${indice === corpo.denunciada ? "  <- denunciado" : ""}`)
    console.log(`    ${JSON.stringify(item.p)}`)
  })
  console.log("")
  console.log("A denúncia inteira:")
  console.log(JSON.stringify(denuncia, null, 2))
}

/**
 * `ArquivoDeDenuncias.fechar`, step by step: rejects if it does not exist, if
 * it is already closed, or if the inbox already has `d-<n>` with a DIFFERENT
 * decision (R34; the reporter may have already read the first one); then it
 * writes nothing. With `suspensa`, it also rejects if the reported account is
 * not suspended now (`suspensaAgora`): the reporter does not read "suspended"
 * for an account that is coming in. Then the inbox first and the report second:
 * if the second write fails, the report stays open and closes again, with the
 * same item in the inbox.
 */
function fechar(arquivo, base, numero, decisao) {
  const denuncia = arquivo.ler(numero)
  if (!denuncia) throw new Recusa(`a denúncia ${numero} não existe`)
  if (denuncia.estado === "fechada") throw new Recusa(`a denúncia ${numero} já está fechada`)
  const anterior = arquivo.lerItemDaCaixa(denuncia.denunciante, `d-${numero}`)
  if (anterior?.tipo === "decisao" && anterior.decisao !== decisao) {
    throw new Recusa(`a denúncia ${numero} já tem a decisão "${anterior.decisao}" na caixa de quem denunciou`)
  }
  if (decisao === "suspensa" && !suspensaAgora(base, denuncia.corpo.denunciado)) {
    throw new Recusa(`${denuncia.corpo.denunciado} ainda não está suspensa: corre primeiro suspender`)
  }
  const agora = Date.now()
  const item = {
    tipo: "decisao",
    id: `d-${numero}`,
    denuncia: numero,
    decisao,
    canal: denuncia.corpo.canal,
    dia: denuncia.recebida.slice(0, 10),
  }
  arquivo.depositar(denuncia.denunciante, item, agora)
  arquivo.escreverDenuncia({ ...denuncia, estado: "fechada", fechada: new Date(agora).toISOString(), decisao })
  arquivo.reescreverFila()
  console.log(`Denúncia ${numero} fechada: ${decisao}. A decisão está na caixa de ${denuncia.denunciante}.`)
}

/**
 * Two writes as one: `primeira` then `segunda`. If the second fails, the first
 * undoes itself with `desfazer`, and the error propagates.
 */
function asDuas(primeira, segunda, desfazer) {
  primeira()
  try {
    segunda()
  } catch (erro) {
    try {
      desfazer()
    } catch (erroAoDesfazer) {
      console.error(`ATENÇÃO: não consegui desfazer a primeira escrita: ${erroAoDesfazer.message}`)
    }
    throw erro
  }
}

function suspender(arquivo, base, endereco, opcoes) {
  const origem = opcoes.origem ?? "denuncia"
  if (!["denuncia", "autoridade", "operador"].includes(origem)) throw new Recusa(`--origem inválida: ${origem}`)
  const motivoTexto = obrigatorio(opcoes, "motivo", 1)
  if (!/^[1-8]$/.test(motivoTexto)) throw new Recusa(`--motivo tem de ser de 1 a 8: ${motivoTexto}`)
  const ambito = obrigatorio(opcoes, "ambito", 300)
  const factos = obrigatorio(opcoes, "factos", 2000)
  const norma = obrigatorio(opcoes, "norma", 300)
  const desde = hoje()
  const ate = opcoes.ate ?? null
  if (ate !== null && (!diaQueExiste(ate) || ate < desde)) {
    throw new Recusa(`--ate tem de ser um dia AAAA-MM-DD, de hoje em diante: ${ate}`)
  }

  let denuncia = null
  if (opcoes.denuncia !== undefined) denuncia = numeroDaDenuncia(opcoes.denuncia)
  if (origem === "denuncia") {
    if (denuncia === null) throw new Recusa("falta --denuncia (ou --origem autoridade|operador)")
    const lida = arquivo.ler(denuncia)
    if (!lida) throw new Recusa(`a denúncia ${denuncia} não existe`)
    if (lida.corpo?.denunciado !== endereco) {
      throw new Recusa(`a denúncia ${denuncia} é contra ${lida.corpo?.denunciado}, e não contra ${endereco}`)
    }
  }

  const aviso = {
    v: 1,
    endereco,
    motivo: Number(motivoTexto),
    medida: "suspensao-da-conta",
    desde,
    ate,
    ambito,
    factos,
    origem,
    semMeiosAutomaticos: true,
    norma,
    revisao: { pedida: null, decisao: "pendente", nota: "" },
  }
  if (!avisoValido(aviso)) throw new Recusa("o aviso não passa no esquema AvisoDeSuspensao")

  const anterior = arquivo.avisoCru(endereco)
  asDuas(
    () => arquivo.escreverAviso(aviso),
    // `Store.suspender`: suspending again overwrites with the current second.
    // The end is the last second of day `--ate` in UTC; without `--ate`, NULL (until review).
    () =>
      base.executar(
        `INSERT INTO suspensoes (address, activa, denuncia, at_second, ate_second) VALUES (?, 1, ?, ?, ?)
         ON CONFLICT (address) DO UPDATE SET activa = 1, denuncia = excluded.denuncia, at_second = excluded.at_second,
           ate_second = excluded.ate_second;`,
        [endereco, denuncia, agoraEmSegundos(), ate === null ? null : Date.parse(`${ate}T23:59:59Z`) / 1000],
      ),
    () => arquivo.repor(arquivo.caminhoDoAviso(endereco), anterior),
  )
  arquivo.reescreverFila()
  console.log(`${endereco} suspensa desde ${desde}${ate ? ` até ${ate}` : ", até à revisão"}.`)
  if (denuncia !== null) console.log(`Para avisar quem denunciou: node scripts/denuncias.mjs fechar ${denuncia} --decisao suspensa`)
}

function linhaActiva(base, endereco) {
  return base.consultar("SELECT activa, denuncia, at_second FROM suspensoes WHERE address = ?", [endereco])[0]
}

const agoraEmSegundos = () => Math.floor(Date.now() / 1000)

/**
 * `Store.estaSuspensa`, the same rule: `activa` and the end (`ate_second`)
 * still to come, or no end. After the end the account comes in, and `activa`
 * becomes 1.
 */
function suspensaAgora(base, endereco) {
  return (
    base.consultar("SELECT 1 AS x FROM suspensoes WHERE address = ? AND activa = 1 AND (ate_second IS NULL OR ate_second > ?)", [
      endereco,
      agoraEmSegundos(),
    ]).length > 0
  )
}

/**
 * `Store.levantar`: `activa = 0`, and the row and `at_second` stay put (R31).
 *
 * Idempotent: with `activa` already 0 (a run that crashed after the database
 * and before marking reviews), it does not touch the database and completes the
 * rest, the notice and pending reviews. Only rejects an account never suspended.
 */
function levantar(arquivo, base, endereco, nota) {
  const linha = linhaActiva(base, endereco)
  if (linha === undefined) throw new Recusa(`${endereco} não está suspensa`)
  const aviso = arquivo.lerAviso(endereco)
  const levantarNaBase = () => base.executar("UPDATE suspensoes SET activa = 0 WHERE address = ?;", [endereco])
  if (linha.activa !== 1) {
    console.log(`${endereco} já estava levantada na base. Completo o aviso e as revisões.`)
    const jaLevantado = aviso?.revisao.decisao === "levantada" && (nota === undefined || nota === aviso.revisao.nota)
    if (aviso && !jaLevantado) {
      arquivo.escreverAviso({ ...aviso, revisao: { ...aviso.revisao, decisao: "levantada", nota: nota ?? aviso.revisao.nota } })
    }
  } else if (aviso) {
    const anterior = arquivo.avisoCru(endereco)
    const novo = { ...aviso, revisao: { ...aviso.revisao, decisao: "levantada", nota: nota ?? aviso.revisao.nota } }
    asDuas(() => arquivo.escreverAviso(novo), levantarNaBase, () => arquivo.repor(arquivo.caminhoDoAviso(endereco), anterior))
  } else {
    // Lifting never gets stuck waiting for a missing notice.
    console.log(`Atenção: ${endereco} não tem aviso legível. Levanta-se só na base.`)
    levantarNaBase()
  }
  const decididas = arquivo.decidirRevisoes(endereco, "levantada")
  arquivo.reescreverFila()
  console.log(`${endereco} levantada.${decididas ? ` ${decididas} pedido(s) de revisão decidido(s).` : ""}`)
}

function manter(arquivo, base, endereco, nota) {
  if (!suspensaAgora(base, endereco)) throw new Recusa(`${endereco} não está suspensa`)
  const aviso = arquivo.lerAviso(endereco)
  if (!aviso) throw new Recusa(`${endereco} não tem aviso legível`)
  arquivo.escreverAviso({ ...aviso, revisao: { ...aviso.revisao, decisao: "mantida", nota } })
  const decididas = arquivo.decidirRevisoes(endereco, "mantida")
  arquivo.reescreverFila()
  console.log(`${endereco} mantida suspensa.${decididas ? ` ${decididas} pedido(s) de revisão decidido(s).` : ""}`)
}

function revisoes(arquivo, base) {
  const pendentes = arquivo.revisoesPendentes()
  for (const { pedido } of pendentes) {
    const aviso = arquivo.lerAviso(pedido.endereco)
    const activa = suspensaAgora(base, pedido.endereco) ? "suspensa" : "não suspensa"
    console.log(`${pedido.recebido}  ${pedido.endereco}  (${activa}; aviso: ${aviso ? aviso.revisao.decisao : "sem aviso"})`)
    console.log(`  ${String(pedido.nota).replaceAll("\n", "\n  ")}`)
  }
  if (pendentes.length > 0) console.log("")
  console.log(`revisões pendentes: ${pendentes.length}`)
}

/** Article 18 of the DSA: who was notified (police, prosecutor, or nobody) and when. */
function autoridades(arquivo, numero, informado, nota) {
  if (!["PJ", "MP", "nao"].includes(informado)) throw new Recusa(`--informado tem de ser PJ, MP ou nao: ${informado}`)
  const denuncia = arquivo.ler(numero)
  if (!denuncia) throw new Recusa(`a denúncia ${numero} não existe`)
  if (!MOTIVOS_PRIORITARIOS.includes(denuncia.corpo?.motivo)) {
    console.log(`Atenção: o motivo ${denuncia.corpo?.motivo} não é 1 nem 2, e o art. 18.º não se aplica. Fica registado na mesma.`)
  }
  arquivo.escreverDenuncia({ ...denuncia, autoridades: { informado, data: hoje(), nota } })
  arquivo.reescreverFila()
  console.log(`Denúncia ${numero}: autoridades "${informado}" registado em ${hoje()}.`)
}

// ------------------------------------------------------------ o arranque

async function ligar() {
  if (PRODUCAO) {
    return {
      arquivo: criarArquivo(discoRemoto(`${VOLUME}/denuncias`)),
      base: baseRemota(`${VOLUME}/enclave.sqlite`),
    }
  }
  const caminhoDaBase = process.env.ORWELL_BASE
  const pasta = process.env.ORWELL_DENUNCIAS
  if (!caminhoDaBase) throw new Recusa("falta ORWELL_BASE (o enclave.sqlite local), ou ORWELL_ALVO=producao")
  if (!pasta) throw new Recusa("falta ORWELL_DENUNCIAS (a pasta denuncias/ local), ou ORWELL_ALVO=producao")
  // Nothing gets created: a wrong path is an error, not an empty database or folder.
  if (!existsSync(caminhoDaBase)) throw new Recusa(`a base local não existe: ${caminhoDaBase}`)
  if (!existsSync(pasta) || !statSync(pasta).isDirectory()) throw new Recusa(`a pasta local não existe: ${pasta}`)
  return { arquivo: criarArquivo(discoLocal(pasta)), base: await baseLocal(caminhoDaBase) }
}

const SUBCOMANDOS = ["listar", "ler", "fechar", "suspender", "levantar", "manter", "revisoes", "autoridades"]

async function principal() {
  const [subcomando, ...resto] = process.argv.slice(2)
  if (!SUBCOMANDOS.includes(subcomando)) {
    console.error(USO)
    process.exit(1)
  }
  const opcoesDe = {
    listar: {},
    ler: {},
    revisoes: {},
    fechar: { decisao: texto },
    suspender: { denuncia: texto, motivo: texto, ambito: texto, factos: texto, norma: texto, ate: texto, origem: texto },
    levantar: { nota: texto },
    manter: { nota: texto },
    autoridades: { informado: texto, nota: texto },
  }
  const { values: opcoes, positionals } = argumentos(resto, opcoesDe[subcomando])
  const quantos = ["listar", "revisoes"].includes(subcomando) ? 0 : 1
  if (positionals.length !== quantos) throw new Recusa(`"${subcomando}" leva ${quantos} argumento(s) sem nome\n\n${USO}`)

  // Arguments validate BEFORE connecting: a write error never reaches the server.
  let accao
  switch (subcomando) {
    case "listar":
      accao = ({ arquivo }) => listar(arquivo)
      break
    case "revisoes":
      accao = ({ arquivo, base }) => revisoes(arquivo, base)
      break
    case "ler": {
      const numero = numeroDaDenuncia(positionals[0])
      accao = ({ arquivo }) => ler(arquivo, numero)
      break
    }
    case "fechar": {
      const numero = numeroDaDenuncia(positionals[0])
      const decisao = obrigatorio(opcoes, "decisao", 20)
      if (!["sem-accao", "suspensa"].includes(decisao)) throw new Recusa(`--decisao tem de ser sem-accao ou suspensa: ${decisao}`)
      accao = ({ arquivo, base }) => fechar(arquivo, base, numero, decisao)
      break
    }
    case "suspender": {
      const endereco = enderecoDeConta(positionals[0])
      accao = ({ arquivo, base }) => suspender(arquivo, base, endereco, opcoes)
      break
    }
    case "levantar": {
      const endereco = enderecoDeConta(positionals[0])
      const nota = opcional(opcoes, "nota", 2000)
      accao = ({ arquivo, base }) => levantar(arquivo, base, endereco, nota)
      break
    }
    case "manter": {
      const endereco = enderecoDeConta(positionals[0])
      const nota = obrigatorio(opcoes, "nota", 2000)
      accao = ({ arquivo, base }) => manter(arquivo, base, endereco, nota)
      break
    }
    case "autoridades": {
      const numero = numeroDaDenuncia(positionals[0])
      const informado = obrigatorio(opcoes, "informado", 3)
      const nota = obrigatorio(opcoes, "nota", 2000)
      accao = ({ arquivo }) => autoridades(arquivo, numero, informado, nota)
      break
    }
  }
  if (!PRODUCAO) console.log(`Local: ${process.env.ORWELL_DENUNCIAS ?? "(sem pasta)"}`)
  accao(await ligar())
}

try {
  await principal()
} catch (erro) {
  console.error(erro instanceof Recusa ? `Recusado: ${erro.message}` : `Erro: ${erro?.stack ?? erro}`)
  process.exit(1)
}
