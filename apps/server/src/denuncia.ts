import { createHash, randomBytes } from "node:crypto"
import { link, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  AvisoDeSuspensao,
  CorpoDaDenuncia,
  IdDaCaixa,
  ITENS_DA_CAIXA_MAX,
  ItemDaCaixa,
  MOTIVOS_PRIORITARIOS,
  PedidoDaCaixa,
  PedidoDeRevisao,
  PedidoDoFundador,
  ROTAS_DA_DENUNCIA,
  toBase64,
  type Motivo,
  type RespostaDaCaixa,
  type RespostaDaSuspensao,
  type RotaDaDenuncia,
  type RespostaDoFundador,
} from "@enclave/protocol"
import type { FastifyInstance } from "fastify"
import type { ServerConfig } from "./config.js"
import { provarDenuncia, type VeredictoDoItem } from "./denuncia-prova.js"
import { verificarPedidoAssinado, type NoncesVistos } from "./pedido-assinado.js"
import { enderecoCurto, JanelaDeUmaHora } from "./relato.js"
import type { Store } from "./store.js"

/**
 * Reports (`docs/planos/denuncias-design.md`, §6.1 and §9b), on the server
 * side: `POST /_enclave/denuncia`.
 *
 * **Outside the database.** Each report is a file in `<dados>/denuncias/`, and
 * the backup leaving the VPS carries only the database and `server.key.json`.
 * The reporter hands us other people's text, decrypted: this is the exception
 * to "the server does not read", so it lives in a separate place, with a
 * deadline.
 *
 * **Authenticated by a signed request** (`pedido-assinado.ts`): the reporter's
 * address is data we store, so it cannot simply be claimed.
 *
 * **Always the same response**: 200 `{}`, after a random delay, whether the
 * target exists or not (as in Matrix). The caps return 429.
 *
 * **No automatic punishment.** Nothing here counts reports against anyone:
 * only a human, through the VPS script, suspends an account.
 */

/** Maximum body stored (without founder copy), in JSON bytes. */
export const DENUNCIA_MAX_BYTES = 512 * 1024
/** Reports per hour, per reporter address. */
export const DENUNCIAS_POR_HORA = 5
/** Reports per hour, per IP: the cap that many accounts on one machine cannot get around. */
export const DENUNCIAS_POR_HORA_POR_IP = 20
/** Days a closed report is stored (Matrix stores 90). */
export const DENUNCIAS_DIAS = 90
/** Response delay, in ms: response time does not reveal whether the target exists. */
export const ATRASO_DA_RESPOSTA_MS: readonly [number, number] = [150, 900]
/** Delay before the copy reaches the founder, in hours (`ENCLAVE_DENUNCIA_ATRASO_HORAS`). */
export const DENUNCIA_ATRASO_HORAS: readonly [number, number] = [1, 6]
/** Requests per hour, by address, to each of the `fundador`, `caixa`, `suspensao` and `revisao` routes. */
export const PEDIDOS_DA_CAIXA_POR_HORA = 60
/** Review requests accepted per day, per suspended account. */
export const REVISOES_POR_DIA = 3
/**
 * What the body of `POST /_enclave/denuncia` can have beyond what we store:
 * the sealed copy (up to 600,000 characters) and the signed envelope. A body
 * at the cap, with a copy at the cap, must reach the route, where the
 * signature is verified first.
 */
export const FOLGA_DA_COPIA_BYTES = 700_000

const HORA_MS = 3_600_000
const DIA_MS = 24 * HORA_MS

export type Prioridade = "alta" | "normal"

export interface DenunciaGuardada {
  v: 1
  numero: number
  /** ISO 8601, to the millisecond. */
  recebida: string
  denunciante: string
  prioridade: Prioridade
  /** Reasons 1 and 2: suspected crime against life or safety (art. 18 of the DSA). */
  art18: boolean
  estado: "aberta" | "fechada"
  fechada?: string
  decisao?: "suspensa" | "sem-accao"
  verificacao: { geral: "verificada" | "nao-verificada"; itens: VeredictoDoItem[] }
  autoridades?: { informado: "PJ" | "MP" | "nao"; data: string; nota: string }
  /** No `copia`: that goes to the founder's inbox. No IP and no device. */
  corpo: Omit<CorpoDaDenuncia, "copia">
}

/** What the alert and the script read: numbers, never content. */
export interface Fila {
  v: 1
  abertas: { numero: number; motivo: Motivo; prioridade: Prioridade; art18: boolean; recebida: string }[]
  revisoesPendentes: number
  actualizada: string
}

/**
 * The report body, validated. `null` means malformed. Never throws.
 *
 * Beyond the schema: reason 8 ("other") requires a note; outside reason 1, the
 * good faith box is mandatory (art. 16, para. 2 of the DSA); and `denunciada`
 * points to an item that exists, or is -1.
 */
export function lerCorpoDaDenuncia(corpo: unknown): CorpoDaDenuncia | null {
  const lido = CorpoDaDenuncia.safeParse(corpo)
  if (!lido.success) return null
  const denuncia = lido.data
  if (denuncia.motivo === 8 && denuncia.nota.trim() === "") return null
  if (denuncia.motivo !== 1 && !denuncia.boaFe) return null
  if (denuncia.denunciada >= denuncia.itens.length) return null
  return denuncia
}

export function prioridadeDe(motivo: Motivo): Prioridade {
  return MOTIVOS_PRIORITARIOS.includes(motivo) ? "alta" : "normal"
}

const NOME_DA_DENUNCIA = /^(\d+)\.json$/
/** `revisoes/<nomeDoFicheiroDaConta>-<ms>.json`. The VPS script uses the same pattern. */
const NOME_DA_REVISAO = /^[0-9a-f]{32}-\d+\.json$/

/**
 * The filename of an account, for the suspension notice and review requests:
 * the first 32 hex characters of the SHA-256 of the full address. Never the
 * `enderecoCurto`: that truncates and lowercases, and two accounts could
 * get the same name. The full address goes inside the file, and is checked
 * on read.
 *
 * The VPS script (Task 10) calculates the same name.
 */
export function nomeDoFicheiroDaConta(endereco: string): string {
  return createHash("sha256").update(endereco, "utf8").digest("hex").slice(0, 32)
}

/** What goes in `revisoes/<nome>-<ms>.json`: the person's note and, once decided, the decision. */
export interface PedidoDeRevisaoGuardado {
  v: 1
  endereco: string
  /** ISO 8601, to the millisecond. */
  recebido: string
  nota: string
  /** ISO 8601: when a person decided, via the VPS script. Without this, the request is pending. */
  decidida?: string
  decisao?: "mantida" | "levantada"
}

/** Writes via temporary file and `rename`: readers never see half a file. */
async function escreverAtomico(caminho: string, conteudo: string): Promise<void> {
  const temporario = `${caminho}.${randomBytes(6).toString("hex")}.tmp`
  await writeFile(temporario, conteudo, { encoding: "utf8", mode: 0o600 })
  await rename(temporario, caminho)
}

function eCodigo(erro: unknown, codigo: string): boolean {
  return (erro as NodeJS.ErrnoException | undefined)?.code === codigo
}

/**
 * The reports folder: `<numero>.json`, `contador.json` and `fila.json`.
 *
 * Everything written goes through a serial queue, so two requests at once do not grab
 * the same number or leave an old `fila.json`.
 */
export class ArquivoDeDenuncias {
  #emSerie: Promise<unknown> = Promise.resolve()

  constructor(readonly pasta: string) {}

  #emFila<T>(tarefa: () => Promise<T>): Promise<T> {
    const resultado = this.#emSerie.then(tarefa, tarefa)
    this.#emSerie = resultado.catch(() => undefined)
    return resultado
  }

  /**
   * Stores with the next number. The file enters via `link`, which fails if the
   * name already exists: a delayed counter (crash between file and counter, or
   * counter deleted) skips the number instead of overwriting.
   */
  guardar(denuncia: Omit<DenunciaGuardada, "numero">): Promise<DenunciaGuardada> {
    return this.#emFila(async () => {
      await mkdir(this.pasta, { recursive: true, mode: 0o700 })
      let numero = await this.#proximoNumero()
      for (;;) {
        const guardada: DenunciaGuardada = { ...denuncia, numero }
        const temporario = join(this.pasta, `.${numero}.${randomBytes(6).toString("hex")}.tmp`)
        await writeFile(temporario, `${JSON.stringify(guardada, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
        try {
          await link(temporario, join(this.pasta, `${numero}.json`))
        } catch (erro) {
          if (!eCodigo(erro, "EEXIST")) throw erro
          numero += 1
          continue
        } finally {
          await unlink(temporario).catch(() => undefined)
        }
        await escreverAtomico(join(this.pasta, "contador.json"), `${JSON.stringify({ proximo: numero + 1 })}\n`)
        return guardada
      }
    })
  }

  async #proximoNumero(): Promise<number> {
    try {
      const { proximo } = JSON.parse(await readFile(join(this.pasta, "contador.json"), "utf8")) as { proximo?: unknown }
      if (Number.isSafeInteger(proximo) && (proximo as number) >= 1) return proximo as number
    } catch {
      // No counter, or unreadable: count from the folder.
    }
    const numeros = (await this.#nomes()).map((nome) => Number(NOME_DA_DENUNCIA.exec(nome)?.[1]))
    return numeros.length === 0 ? 1 : Math.max(...numeros) + 1
  }

  async #nomes(): Promise<string[]> {
    try {
      return (await readdir(this.pasta)).filter((nome) => NOME_DA_DENUNCIA.test(nome))
    } catch (erro) {
      if (eCodigo(erro, "ENOENT")) return []
      throw erro
    }
  }

  async ler(numero: number): Promise<DenunciaGuardada | null> {
    if (!Number.isSafeInteger(numero) || numero < 1) return null
    try {
      return JSON.parse(await readFile(join(this.pasta, `${numero}.json`), "utf8")) as DenunciaGuardada
    } catch {
      return null
    }
  }

  /** All of them, by number. An unreadable file is skipped and does not stop the others. */
  async listar(): Promise<DenunciaGuardada[]> {
    const lidas: DenunciaGuardada[] = []
    for (const nome of await this.#nomes()) {
      const denuncia = await this.ler(Number(NOME_DA_DENUNCIA.exec(nome)?.[1]))
      if (denuncia) lidas.push(denuncia)
    }
    return lidas.sort((a, b) => a.numero - b.numero)
  }

  /**
   * `fila.json`: the open ones, highest priority first and, within each
   * priority, oldest first. Only numbers and dates.
   *
   * `revisoesPendentes` is always counted from files (R35): requests in
   * `revisoes/` without `decidida`, which the VPS script marks when a person
   * decides. The script counts the same way. Never sum to the previous value:
   * a write crossing another, or a missing `fila.json`, would leave the number
   * wrong forever. This way, the next write from either side corrects it.
   */
  escreverFila(): Promise<void> {
    return this.#emFila(() => this.#reescreverFila())
  }

  /** `escreverFila` without the serial queue, for callers already inside it. */
  async #reescreverFila(): Promise<void> {
    await mkdir(this.pasta, { recursive: true, mode: 0o700 })
    const peso = (prioridade: Prioridade): number => (prioridade === "alta" ? 0 : 1)
    const abertas = (await this.listar())
      .filter((denuncia) => denuncia.estado === "aberta")
      .sort((a, b) => peso(a.prioridade) - peso(b.prioridade) || a.numero - b.numero)
      .map(({ numero, corpo, prioridade, art18, recebida }) => ({
        numero,
        motivo: corpo.motivo as Motivo,
        prioridade,
        art18,
        recebida,
      }))
    const fila: Fila = { v: 1, abertas, revisoesPendentes: await this.#revisoesPendentes(), actualizada: new Date().toISOString() }
    await escreverAtomico(join(this.pasta, "fila.json"), `${JSON.stringify(fila, null, 2)}\n`)
  }

  /** Review requests without `decidida`. An unreadable file does not count (the script skips it too). */
  async #revisoesPendentes(): Promise<number> {
    const pasta = join(this.pasta, "revisoes")
    let nomes: string[]
    try {
      nomes = (await readdir(pasta)).filter((nome) => NOME_DA_REVISAO.test(nome))
    } catch (erro) {
      if (eCodigo(erro, "ENOENT")) return 0
      throw erro
    }
    let pendentes = 0
    for (const nome of nomes) {
      try {
        const pedido = JSON.parse(await readFile(join(pasta, nome), "utf8")) as { endereco?: unknown; decidida?: unknown }
        if (typeof pedido.endereco === "string" && pedido.decidida === undefined) pendentes += 1
      } catch {
        // Unreadable: does not count.
      }
    }
    return pendentes
  }

  /**
   * Closes report `numero` with `decisao` and sends the decision to the reporter
   * (art. 16, para. 5 of the DSA). The caller is a person, via the VPS script.
   *
   * The decision goes to the inbox of `corpo.denunciante`, and no one else, with
   * `entregarEm = agora`: there is nothing to hide from the reporter. The item is
   * `{ tipo: "decisao", id: "d-<numero>", denuncia: numero, decisao, canal: corpo.canal, dia }`,
   * with `dia` the UTC day (`YYYY-MM-DD`) when the report arrived (`recebida`).
   * The inbox file is the one from `CaixaDeEntrega.depositar`:
   * `caixa/<enderecoCurto(denunciante)>/d-<numero>.json` with
   * `{ endereco, item, entregarEm }`. The Task 10 script writes the same.
   *
   * Inbox first, then the report file: if the report write fails, the report stays
   * open and can be closed again, with the same id in the inbox (which is
   * overwritten). Throws if the report does not exist, if it is already closed, or
   * if the inbox already has `d-<numero>` with a DIFFERENT decision; in that case
   * it changes nothing.
   */
  fechar(
    numero: number,
    decisao: "suspensa" | "sem-accao",
    caixa: CaixaDeEntrega,
    agora = Date.now(),
  ): Promise<DenunciaGuardada> {
    return this.#emFila(async () => {
      const denuncia = await this.ler(numero)
      if (!denuncia) throw new Error(`a denúncia ${numero} não existe`)
      if (denuncia.estado === "fechada") throw new Error(`a denúncia ${numero} já está fechada`)
      // A prior run may have deposited the decision and failed before closing the file.
      // With the same decision, overwrite (same item). With a different one, refuse:
      // the reporter may already have read the first.
      const anterior = await caixa.lerItem(denuncia.denunciante, `d-${numero}`)
      if (anterior?.tipo === "decisao" && anterior.decisao !== decisao) {
        throw new Error(`a denúncia ${numero} já tem a decisão "${anterior.decisao}" na caixa de quem denunciou`)
      }
      const item: ItemDaCaixa = {
        tipo: "decisao",
        id: `d-${numero}`,
        denuncia: numero,
        decisao,
        canal: denuncia.corpo.canal,
        dia: denuncia.recebida.slice(0, 10),
      }
      await caixa.depositar(denuncia.denunciante, item, agora)
      const fechada: DenunciaGuardada = { ...denuncia, estado: "fechada", fechada: new Date(agora).toISOString(), decisao }
      await escreverAtomico(join(this.pasta, `${numero}.json`), `${JSON.stringify(fechada, null, 2)}\n`)
      await this.#reescreverFila()
      return fechada
    })
  }

  #caminhoDoAviso(endereco: string): string {
    return join(this.pasta, "suspensoes", `${nomeDoFicheiroDaConta(endereco)}.json`)
  }

  /**
   * Writes the suspension notice for `endereco` (art. 17, para. 3 of the DSA),
   * replacing the previous one. It is the only place that writes it; the VPS script follows
   * the same format. Throws if the notice fails the schema, or if it is from another account.
   */
  escreverAviso(endereco: string, aviso: AvisoDeSuspensao): Promise<void> {
    const lido = AvisoDeSuspensao.parse(aviso)
    if (lido.endereco !== endereco) return Promise.reject(new Error("o aviso é de outra conta"))
    return this.#emFila(() => this.#gravarAviso(lido))
  }

  async #gravarAviso(aviso: AvisoDeSuspensao): Promise<void> {
    await mkdir(join(this.pasta, "suspensoes"), { recursive: true, mode: 0o700 })
    await escreverAtomico(this.#caminhoDoAviso(aviso.endereco), `${JSON.stringify(aviso, null, 2)}\n`)
  }

  /**
   * The suspension notice for `endereco`, or `null`: no file, unreadable, outside
   * the schema, or from another account (the address inside is not this one). Never throws.
   */
  async lerAviso(endereco: string): Promise<AvisoDeSuspensao | null> {
    try {
      const lido = AvisoDeSuspensao.safeParse(JSON.parse(await readFile(this.#caminhoDoAviso(endereco), "utf8")))
      return lido.success && lido.data.endereco === endereco ? lido.data : null
    } catch {
      return null
    }
  }

  /**
   * Stores a review request in `revisoes/<nome>-<ms>.json`, mark the time
   * in `revisao.pedida` in the notice (when there is a notice) and rewrite the queue,
   * which counts it from the new file. A human decides, through the script.
   */
  guardarRevisao(endereco: string, nota: string, agora = Date.now()): Promise<PedidoDeRevisaoGuardado> {
    return this.#emFila(async () => {
      const pasta = join(this.pasta, "revisoes")
      await mkdir(pasta, { recursive: true, mode: 0o700 })
      const pedido: PedidoDeRevisaoGuardado = { v: 1, endereco, recebido: new Date(agora).toISOString(), nota }
      const conteudo = `${JSON.stringify(pedido, null, 2)}\n`
      // Two requests in the same millisecond do not overwrite each other: `wx` fails
      // if the name exists, and the second gets the next millisecond.
      for (let ms = agora; ; ms++) {
        try {
          await writeFile(join(pasta, `${nomeDoFicheiroDaConta(endereco)}-${ms}.json`), conteudo, {
            encoding: "utf8",
            mode: 0o600,
            flag: "wx",
          })
          break
        } catch (erro) {
          if (!eCodigo(erro, "EEXIST")) throw erro
        }
      }
      const aviso = await this.lerAviso(endereco)
      if (aviso) await this.#gravarAviso({ ...aviso, revisao: { ...aviso.revisao, pedida: pedido.recebido } })
      await this.#reescreverFila()
      return pedido
    })
  }

  /**
   * Deletes reports closed more than `dias` ago, except those of an account with an
   * active suspension (the notice in `suspensoes/<nomeDoFicheiroDaConta>.json`, until a
   * review lifts it or its end `ate`, if set, passes). Open ones are never deleted.
   * Returns how many it deleted.
   */
  varrer(agora = Date.now(), dias = DENUNCIAS_DIAS): Promise<number> {
    return this.#emFila(async () => {
      let apagadas = 0
      for (const denuncia of await this.listar()) {
        if (denuncia.estado !== "fechada") continue
        const fechada = Date.parse(denuncia.fechada ?? denuncia.recebida)
        if (!Number.isFinite(fechada) || agora - fechada <= dias * DIA_MS) continue
        if (await this.#suspensaoEmCurso(denuncia.corpo.denunciado, agora)) continue
        try {
          await unlink(join(this.pasta, `${denuncia.numero}.json`))
          apagadas += 1
        } catch {
          // Already gone, or cannot be deleted: left for the next sweep.
        }
      }
      return apagadas
    })
  }

  /**
   * When in doubt (unreadable notice), treat it as active: keeping too much is the
   * cheap mistake. A notice that names another address is from another account and
   * does not count. After the last second of `ate` (UTC, the `Store.estaSuspensa` rule)
   * the suspension is over and does not count either.
   */
  async #suspensaoEmCurso(endereco: string, agora: number): Promise<boolean> {
    let texto: string
    try {
      texto = await readFile(this.#caminhoDoAviso(endereco), "utf8")
    } catch (erro) {
      return !eCodigo(erro, "ENOENT")
    }
    try {
      const aviso = JSON.parse(texto) as { endereco?: unknown; ate?: unknown; revisao?: { decisao?: unknown } }
      if (typeof aviso.endereco === "string" && aviso.endereco !== endereco) return false
      if (typeof aviso.ate === "string" && Date.parse(`${aviso.ate}T23:59:59Z`) < agora) return false
      return aviso.revisao?.decisao !== "levantada"
    } catch {
      return true
    }
  }
}

/**
 * A delay drawn between `horas[0]` and `horas[1]` hours, in ms, both ends inclusive.
 * The copy to the founder does not arrive at once (§6.2): delivery to the second
 * would let anyone match the time against who was online.
 */
export function atrasoAleatorioMs(horas: readonly [number, number], aleatorio: () => number = Math.random): number {
  const minimo = Math.max(0, Math.min(horas[0], horas[1])) * HORA_MS
  const maximo = Math.max(0, Math.max(horas[0], horas[1])) * HORA_MS
  return minimo + Math.floor(aleatorio() * (maximo - minimo + 1))
}

/**
 * The founder of `canal`, according to the server (`channel_claims`), and their
 * account key, so the reporter can seal the copy. Never taken from the caller's vault:
 * otherwise the reporter could send the copy to anyone they chose (§6.2).
 *
 * `null`, without explanation, when the caller is not subscribed to the channel,
 * when the channel has no claim (an opaque address nobody has used yet, an old format),
 * when the founder is no longer subscribed (§9b: the copy would show them messages
 * they never had), when their key is not known, or when the channel is the common room
 * (`config.commonRoom`): whoever claimed it first is not the founder of any space.
 *
 * Direct conversations also have claims, and the server does not distinguish them
 * from a space: the reporter's device, which knows what the channel is, refuses
 * them. Here, in a DM, the founder is always the reporter or the reported user,
 * and the send route drops the copy for that reason.
 */
export function fundadorPara(
  store: Store,
  canal: string,
  quemPede: string,
  config?: Pick<ServerConfig, "commonRoom">,
): { fundador: string; chaveDeConta: Uint8Array } | null {
  // Same question as `ehSalaComum` (config.ts), without importing from there: config.ts already imports from here.
  if (config && config.commonRoom !== "" && canal === config.commonRoom) return null
  if (!store.isSubscribed(canal, quemPede)) return null
  const fundador = store.claimantOf(canal)
  if (fundador === undefined || !store.isSubscribed(canal, fundador)) return null
  const chaveDeConta = store.signingKeyOf(fundador)
  if (chaveDeConta === undefined || chaveDeConta.length !== 32) return null
  return { fundador, chaveDeConta }
}

/** What each inbox file holds. `endereco` is stored in full: the folder name is short. */
interface NaCaixa {
  endereco: string
  item: ItemDaCaixa
  entregarEm: number
}

const NOME_NA_CAIXA = /^([a-z0-9-]{1,64})\.json$/

/**
 * The inbox of each account: what the server stores to deliver later
 * (the copy to the founder, and the decision to the reporter). One file per item,
 * in `<pasta>/<endereço curto>/<id>.json`, outside the database like reports.
 *
 * Delivers only what is past `entregarEm`. Deletes what the account says it has
 * stored (`vistos`): anything it did not list comes back on the next request.
 */
export class CaixaDeEntrega {
  constructor(readonly pasta: string) {}

  #pastaDe(endereco: string): string {
    return join(this.pasta, enderecoCurto(endereco))
  }

  /** Stores `item` for `endereco`. An item with the same id overwrites it (decision `d-<n>` is the same item). */
  async depositar(endereco: string, item: ItemDaCaixa, entregarEm: number): Promise<void> {
    const lido = ItemDaCaixa.parse(item)
    const pasta = this.#pastaDe(endereco)
    await mkdir(pasta, { recursive: true, mode: 0o700 })
    const guardado: NaCaixa = { endereco, item: lido, entregarEm }
    await escreverAtomico(join(pasta, `${lido.id}.json`), `${JSON.stringify(guardado)}\n`)
  }

  /** The item `id` from the inbox of `endereco`, or `null`: no file, unreadable, malformed id, or from another account. Never throws. */
  async lerItem(endereco: string, id: string): Promise<ItemDaCaixa | null> {
    if (!IdDaCaixa.safeParse(id).success) return null
    const guardado = await this.#ler(join(this.#pastaDe(endereco), `${id}.json`))
    return guardado?.endereco === endereco ? guardado.item : null
  }

  async #ler(caminho: string): Promise<NaCaixa | null> {
    try {
      const lido = JSON.parse(await readFile(caminho, "utf8")) as Partial<NaCaixa>
      const item = ItemDaCaixa.safeParse(lido.item)
      if (!item.success || typeof lido.endereco !== "string" || !Number.isFinite(lido.entregarEm)) return null
      return { endereco: lido.endereco, item: item.data, entregarEm: lido.entregarEm as number }
    } catch {
      return null
    }
  }

  async #nomes(pasta: string): Promise<string[]> {
    try {
      return (await readdir(pasta)).filter((nome) => NOME_NA_CAIXA.test(nome))
    } catch (erro) {
      if (eCodigo(erro, "ENOENT")) return []
      throw erro
    }
  }

  /**
   * Deletes this account's `vistos` and returns what can already be delivered,
   * oldest first, up to `ITENS_DA_CAIXA_MAX`. A malformed id, or a file from another
   * account with the same short address, does not delete anything.
   */
  async levantar(endereco: string, vistos: readonly string[], agora = Date.now()): Promise<ItemDaCaixa[]> {
    const pasta = this.#pastaDe(endereco)
    for (const id of vistos) {
      if (!IdDaCaixa.safeParse(id).success) continue
      const caminho = join(pasta, `${id}.json`)
      const guardado = await this.#ler(caminho)
      if (guardado?.endereco !== endereco) continue
      await unlink(caminho).catch(() => undefined)
    }
    const prontos: NaCaixa[] = []
    for (const nome of await this.#nomes(pasta)) {
      const guardado = await this.#ler(join(pasta, nome))
      if (guardado && guardado.endereco === endereco && guardado.entregarEm <= agora) prontos.push(guardado)
    }
    return prontos
      .sort((a, b) => a.entregarEm - b.entregarEm || (a.item.id < b.item.id ? -1 : 1))
      .slice(0, ITENS_DA_CAIXA_MAX)
      .map((guardado) => guardado.item)
  }

  /**
   * Deletes what went uncollected more than `dias` after `entregarEm`, and unreadable
   * files. Returns how many it deleted.
   */
  async varrer(agora = Date.now(), dias = DENUNCIAS_DIAS): Promise<number> {
    let apagados = 0
    let contas: string[]
    try {
      contas = await readdir(this.pasta)
    } catch (erro) {
      if (eCodigo(erro, "ENOENT")) return 0
      throw erro
    }
    for (const conta of contas) {
      const pasta = join(this.pasta, conta)
      let nomes: string[]
      try {
        nomes = await this.#nomes(pasta)
      } catch {
        continue
      }
      for (const nome of nomes) {
        const caminho = join(pasta, nome)
        const guardado = await this.#ler(caminho)
        if (guardado && agora - guardado.entregarEm <= dias * DIA_MS) continue
        try {
          await unlink(caminho)
          apagados += 1
        } catch {
          // Already gone: left for the next sweep.
        }
      }
    }
    return apagados
  }
}

function atrasoAleatorio(): number {
  const [minimo, maximo] = ATRASO_DA_RESPOSTA_MS
  return minimo + Math.floor(Math.random() * (maximo - minimo + 1))
}

/**
 * Registers `POST /_enclave/denuncia`, `/_enclave/denuncia/fundador`,
 * `/_enclave/denuncia/caixa`, `/_enclave/denuncia/suspensao`,
 * `/_enclave/denuncia/revisao` and the sweep every 6 hours. Returns a function
 * that stops the sweep (the server's `close` calls it).
 *
 * Order: 401 for the signature, 400 for the shape, 413 for the size, 429 for the
 * caps. The caps count every request whose signature is accepted, even one that
 * later gets 400 or 413. The cap is checked before the nonce is recorded, and
 * only a request within the cap leaves a nonce in memory: per account, the map
 * grows by at most the route's cap each hour, and in total up to `NONCES_MAX`.
 */
export function registarDenuncias(
  app: FastifyInstance,
  deps: { store: Store; config: ServerConfig; nonces: NoncesVistos },
): () => void {
  const arquivo = new ArquivoDeDenuncias(join(deps.config.dataDir, "denuncias"))
  const caixa = new CaixaDeEntrega(join(deps.config.dataDir, "denuncias", "caixa"))
  const dias = deps.config.denunciasDias ?? DENUNCIAS_DIAS
  const atrasoHoras = deps.config.denunciaAtrasoHoras ?? DENUNCIA_ATRASO_HORAS
  const porEndereco = new JanelaDeUmaHora(DENUNCIAS_POR_HORA)
  const porIp = new JanelaDeUmaHora(DENUNCIAS_POR_HORA_POR_IP)
  const fundadorPorEndereco = new JanelaDeUmaHora(PEDIDOS_DA_CAIXA_POR_HORA)
  const caixaPorEndereco = new JanelaDeUmaHora(PEDIDOS_DA_CAIXA_POR_HORA)
  const suspensaoPorEndereco = new JanelaDeUmaHora(PEDIDOS_DA_CAIXA_POR_HORA)
  const revisaoPorEndereco = new JanelaDeUmaHora(PEDIDOS_DA_CAIXA_POR_HORA)
  const revisoesPorDia = new JanelaDeUmaHora(REVISOES_POR_DIA, DIA_MS)

  // Only the clock has its own response: the app tells the user to fix it.
  // The other refusals look the same, so they do not reveal which check failed.
  const verificar = (
    corpo: unknown,
    rota: RotaDaDenuncia,
    tecto: (endereco: string) => boolean,
  ):
    | { ok: true; endereco: string; corpo: unknown; coube: boolean }
    | { ok: false; error: "stale-request" | "unauthorized" } => {
    const verificado = verificarPedidoAssinado(corpo, rota, {
      store: deps.store,
      serverName: deps.config.serverName,
      nonces: deps.nonces,
      tecto,
    })
    if (verificado.ok) return verificado
    return { ok: false as const, error: verificado.razao === "stale-request" ? "stale-request" : "unauthorized" }
  }

  app.post(
    ROTAS_DA_DENUNCIA.enviar,
    // The signed envelope and the founder's copy wrap the body; the exact cap
    // of what is stored is the 413 below.
    { bodyLimit: DENUNCIA_MAX_BYTES + FOLGA_DA_COPIA_BYTES },
    async (request, reply) => {
      // IP first: many accounts on the same machine cannot get around the cap.
      const verificado = verificar(
        request.body,
        ROTAS_DA_DENUNCIA.enviar,
        (endereco) => porIp.tentar(request.ip) && porEndereco.tentar(endereco),
      )
      if (!verificado.ok) return reply.code(401).send({ error: verificado.error })
      const { coube } = verificado

      const corpo = lerCorpoDaDenuncia(verificado.corpo)
      if (!corpo) return reply.code(400).send({ error: "malformed-report" })
      const { copia: _copia, ...semCopia } = corpo
      if (Buffer.byteLength(JSON.stringify(semCopia), "utf8") > DENUNCIA_MAX_BYTES) {
        return reply.code(413).send({ error: "report-too-large" })
      }
      if (!coube) return reply.code(429).send({ error: "too-many-reports" })

      const motivo = corpo.motivo as Motivo
      const prova = provarDenuncia(deps.store, corpo)
      await arquivo.guardar({
        v: 1,
        recebida: new Date().toISOString(),
        denunciante: verificado.endereco,
        prioridade: prioridadeDe(motivo),
        art18: MOTIVOS_PRIORITARIOS.includes(motivo),
        estado: "aberta",
        verificacao: prova.verificacao,
        corpo: { ...semCopia, itens: prova.itens },
      })
      // Copy to the founder, after the report is stored. The founder is the one the
      // server names, not the one in the body: a `fundador` that does not match, a
      // founder who is the reported user or the reporter, or who is no longer in the
      // channel, makes the copy drop silently. The response is the same.
      if (corpo.copia) {
        const achado = fundadorPara(deps.store, corpo.canal, verificado.endereco, deps.config)
        if (
          achado &&
          corpo.fundador === achado.fundador &&
          achado.fundador !== corpo.denunciado &&
          achado.fundador !== verificado.endereco
        ) {
          const item: ItemDaCaixa = { tipo: "copia", id: randomBytes(16).toString("hex"), canal: corpo.canal, copia: corpo.copia }
          await caixa.depositar(achado.fundador, item, Date.now() + atrasoAleatorioMs(atrasoHoras)).catch((erro: unknown) => {
            process.stderr.write(`enclave: a cópia ao fundador não se guardou: ${(erro as Error)?.message ?? erro}\n`)
          })
        }
      }
      // The report is already stored: a failed queue write does not undo it, and the
      // response stays the same. The next request rewrites the whole queue.
      await arquivo.escreverFila().catch((erro: unknown) => {
        process.stderr.write(`enclave: a fila das denúncias não se escreveu: ${(erro as Error)?.message ?? erro}\n`)
      })
      await new Promise<void>((resolver) => setTimeout(resolver, atrasoAleatorio()))
      return {}
    },
  )

  // The founder of a channel, to seal the copy. A caller not in the channel
  // gets the same response as for a channel with no founder.
  app.post(ROTAS_DA_DENUNCIA.fundador, async (request, reply): Promise<RespostaDoFundador | undefined> => {
    const verificado = verificar(request.body, ROTAS_DA_DENUNCIA.fundador, (endereco) => fundadorPorEndereco.tentar(endereco))
    if (!verificado.ok) return reply.code(401).send({ error: verificado.error })
    const { coube } = verificado
    const pedido = PedidoDoFundador.safeParse(verificado.corpo)
    if (!pedido.success) return reply.code(400).send({ error: "malformed-request" })
    if (!coube) return reply.code(429).send({ error: "too-many-requests" })
    const achado = fundadorPara(deps.store, pedido.data.canal, verificado.endereco, deps.config)
    return achado ? { fundador: achado.fundador, chaveDeConta: toBase64(achado.chaveDeConta) } : { fundador: null, chaveDeConta: null }
  })

  // The caller's inbox: only its own, because the address comes from the signature.
  app.post(ROTAS_DA_DENUNCIA.caixa, async (request, reply): Promise<RespostaDaCaixa | undefined> => {
    const verificado = verificar(request.body, ROTAS_DA_DENUNCIA.caixa, (endereco) => caixaPorEndereco.tentar(endereco))
    if (!verificado.ok) return reply.code(401).send({ error: verificado.error })
    const { coube } = verificado
    const pedido = PedidoDaCaixa.safeParse(verificado.corpo)
    if (!pedido.success) return reply.code(400).send({ error: "malformed-request" })
    if (!coube) return reply.code(429).send({ error: "too-many-requests" })
    return { itens: await caixa.levantar(verificado.endereco, pedido.data.vistos) }
  })

  // The caller's suspension notice (art. 17, para. 3 of the DSA). By signed request,
  // no session: a suspended account cannot enter the gateway, so it reads the reason here.
  // `{ aviso: null }` with no notice, whether suspended or not.
  app.post(ROTAS_DA_DENUNCIA.suspensao, async (request, reply): Promise<RespostaDaSuspensao | undefined> => {
    const verificado = verificar(request.body, ROTAS_DA_DENUNCIA.suspensao, (endereco) => suspensaoPorEndereco.tentar(endereco))
    if (!verificado.ok) return reply.code(401).send({ error: verificado.error })
    if (!verificado.coube) return reply.code(429).send({ error: "too-many-requests" })
    return { aviso: await arquivo.lerAviso(verificado.endereco) }
  })

  // The caller's review request, only from a suspended account (403 for others).
  // Two windows: one for every request with an accepted signature, counted before the
  // nonce is recorded, and one for accepted reviews, 3 per day.
  app.post(ROTAS_DA_DENUNCIA.revisao, async (request, reply) => {
    const verificado = verificar(request.body, ROTAS_DA_DENUNCIA.revisao, (endereco) => revisaoPorEndereco.tentar(endereco))
    if (!verificado.ok) return reply.code(401).send({ error: verificado.error })
    const { coube } = verificado
    const pedido = PedidoDeRevisao.safeParse(verificado.corpo)
    if (!pedido.success || pedido.data.nota.trim() === "") return reply.code(400).send({ error: "malformed-request" })
    if (!deps.store.estaSuspensa(verificado.endereco)) return reply.code(403).send({ error: "not-suspended" })
    if (!coube || !revisoesPorDia.tentar(verificado.endereco)) return reply.code(429).send({ error: "too-many-requests" })
    await arquivo.guardarRevisao(verificado.endereco, pedido.data.nota)
    return { ok: true }
  })

  const varrer = (): void => {
    void arquivo.varrer(Date.now(), dias).catch((erro: unknown) => {
      process.stderr.write(`enclave: varrimento das denúncias falhou: ${(erro as Error)?.message ?? erro}\n`)
    })
    void caixa.varrer(Date.now(), dias).catch((erro: unknown) => {
      process.stderr.write(`enclave: varrimento da caixa das denúncias falhou: ${(erro as Error)?.message ?? erro}\n`)
    })
  }
  varrer()
  const varrimento = setInterval(() => {
    porEndereco.limpar()
    porIp.limpar()
    fundadorPorEndereco.limpar()
    caixaPorEndereco.limpar()
    suspensaoPorEndereco.limpar()
    revisaoPorEndereco.limpar()
    revisoesPorDia.limpar()
    varrer()
  }, 6 * HORA_MS)
  varrimento.unref()
  return () => clearInterval(varrimento)
}
