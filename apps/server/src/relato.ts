import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises"
import { join } from "node:path"
import { parseAddress } from "@enclave/protocol"
import type { FastifyInstance } from "fastify"

/**
 * "Send report" (Help and diagnostics, phase 4 of settings 0.9).
 *
 * The app sends the session diagnostic report (the same text as "Copy report",
 * which has no messages or person text) with the address and version. The
 * server saves it in a file per day and per address, for 30 days, so whoever
 * maintains the server can read it when the person reports the problem.
 *
 * **The route lives under `/_enclave/`**, not under `/relato` at the root: in
 * production Caddy only passes to the server what is under `/_enclave/*`
 * (`infra/Caddyfile`), and the page CSP already allows `fetch` to the same
 * origin (`connect-src 'self'`). Nothing changes in the infra.
 *
 * **No authentication, so it has caps.** The address is what the app declares,
 * not proof: it serves to organize the file and to count, not to trust. The
 * caps protect the disk: 64 kB per report, 10 per hour per address, and 30 per
 * hour per IP (the address is chosen by the caller; the IP is not). None of
 * this goes into the access log, which is off.
 */

/** The largest report accepted, in bytes of text. A 200-event report stays well below. */
export const RELATO_MAX_BYTES = 64 * 1024
/** How many reports per hour, per address. */
export const RELATOS_POR_HORA = 10
/** How many reports per hour, per IP: the cap that a declared address cannot bypass. */
export const RELATOS_POR_HORA_POR_IP = 30
/** How many days a report stays saved. */
export const RELATO_DIAS = 30

const HORA_MS = 3_600_000
const DIA_MS = 24 * HORA_MS

/** The version as the app writes it (`0.9.2`, `0.9.2-beta.1`). */
const VERSAO = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-+][0-9A-Za-z.-]{1,24})?$/

/**
 * A sliding one-hour window, per key. In memory: a restart begins counting again, and that is enough.
 *
 * `janelaMs` extends it: reviewing a suspension counts per day (`denuncia.ts`).
 */
export class JanelaDeUmaHora {
  readonly #vezes = new Map<string, number[]>()
  constructor(
    readonly maximo: number,
    readonly janelaMs = HORA_MS,
  ) {}

  /** Count one more, if there is still room. Return whether it fit. */
  tentar(chave: string, agora = Date.now()): boolean {
    const recentes = (this.#vezes.get(chave) ?? []).filter((quando) => agora - quando < this.janelaMs)
    if (recentes.length >= this.maximo) {
      this.#vezes.set(chave, recentes)
      return false
    }
    recentes.push(agora)
    this.#vezes.set(chave, recentes)
    return true
  }

  /** Forget keys with nothing in the last window, so the map does not grow forever. */
  limpar(agora = Date.now()): void {
    for (const [chave, vezes] of this.#vezes) {
      if (vezes.every((quando) => agora - quando >= this.janelaMs)) this.#vezes.delete(chave)
    }
  }
}

/**
 * The short address, for the file name: the local part, only letters, numbers,
 * `-` and `_`. The full address goes inside the file, in the header of each
 * report; the name only needs to be safe and readable.
 */
export function enderecoCurto(endereco: string): string {
  const local = endereco.slice(1, endereco.indexOf(":") > 0 ? endereco.indexOf(":") : undefined)
  const limpo = local.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 32)
  return limpo || "anonimo"
}

/** `2026-10-28`, in UTC: the same day for whoever reads it on the server, no matter their timezone. */
export function dataDoFicheiro(agora: Date): string {
  return agora.toISOString().slice(0, 10)
}

/** What the route accepts, already validated. `null` is a malformed request. */
export function lerPedidoDeRelato(corpo: unknown): { endereco: string; versao: string; texto: string } | null {
  if (!corpo || typeof corpo !== "object") return null
  const { endereco, versao, texto } = corpo as Record<string, unknown>
  if (typeof endereco !== "string" || endereco.length > 256) return null
  if (typeof versao !== "string" || !VERSAO.test(versao)) return null
  if (typeof texto !== "string" || texto.length === 0) return null
  try {
    if (parseAddress(endereco).sigil !== "@") return null
  } catch {
    return null
  }
  return { endereco, versao, texto }
}

/** Delete reports older than `RELATO_DIAS`. A failure on one file does not stop the others. */
export async function varrerRelatos(pasta: string, agora = Date.now()): Promise<number> {
  let apagados = 0
  let nomes: string[]
  try {
    nomes = await readdir(pasta)
  } catch {
    return 0
  }
  for (const nome of nomes) {
    if (!nome.endsWith(".txt")) continue
    const caminho = join(pasta, nome)
    try {
      const { mtimeMs } = await stat(caminho)
      if (agora - mtimeMs > RELATO_DIAS * DIA_MS) {
        await unlink(caminho)
        apagados += 1
      }
    } catch {
      // Another sweep deleted it meanwhile, or it cannot be read: leave it for the next one.
    }
  }
  return apagados
}

/**
 * Register `POST /_enclave/relato` and the daily sweep. Return how to stop the
 * sweep (the server's `close` calls it).
 */
export function registarRelatos(app: FastifyInstance, dataDir: string): () => void {
  const pasta = join(dataDir, "relatos")
  const porEndereco = new JanelaDeUmaHora(RELATOS_POR_HORA)
  const porIp = new JanelaDeUmaHora(RELATOS_POR_HORA_POR_IP)

  app.post(
    "/_enclave/relato",
    // The body is JSON with the text inside: a bit above the 64 kB of text, for
    // escaped quotes and the rest of the object. The exact cap is below.
    { bodyLimit: RELATO_MAX_BYTES * 2 },
    async (request, reply) => {
      const pedido = lerPedidoDeRelato(request.body)
      if (!pedido) return reply.code(400).send({ error: "malformed-report" })
      if (Buffer.byteLength(pedido.texto, "utf8") > RELATO_MAX_BYTES) {
        return reply.code(413).send({ error: "report-too-large" })
      }
      // IP first: an address made up for each request cannot bypass the cap.
      if (!porIp.tentar(request.ip) || !porEndereco.tentar(pedido.endereco)) {
        return reply.code(429).send({ error: "too-many-reports" })
      }
      const agora = new Date()
      const ficheiro = join(pasta, `${dataDoFicheiro(agora)}-${enderecoCurto(pedido.endereco)}.txt`)
      const cabecalho = `--- ${agora.toISOString()} · ${pedido.endereco} · versão ${pedido.versao}\n`
      await mkdir(pasta, { recursive: true })
      await appendFile(ficheiro, `${cabecalho}${pedido.texto}\n\n`, { encoding: "utf8", mode: 0o600 })
      return { ok: true }
    },
  )

  void varrerRelatos(pasta)
  const varrimento = setInterval(() => {
    porEndereco.limpar()
    porIp.limpar()
    void varrerRelatos(pasta)
  }, 6 * HORA_MS)
  varrimento.unref()
  return () => clearInterval(varrimento)
}
