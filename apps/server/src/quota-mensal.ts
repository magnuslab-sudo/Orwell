import { readFile } from "node:fs/promises"

/**
 * The VPS's monthly traffic quota, and the video budget cut-off near it.
 *
 * The provider gives the VPS a monthly quota (8 TB by default). When it runs
 * out, the machine drops to 10 Mbit/s for the rest of the month, and with it
 * magnuslab.pt and everyone's voice. A 50-person call with four cameras uses
 * ~130 GB per hour (`docs/planos/limites-media-relatorio.md`). Once
 * `LIMIAR_DA_QUOTA` is reached, the video budget drops to the reduced one, and
 * the quota lasts the rest of the month.
 *
 * **The server does not see `vnstat`.** It runs in Docker, and `vnstat` counts
 * the host interface. It is read by `infra/quota-vnstat.sh`, on the host,
 * which writes a small JSON to a read-only mounted volume:
 *
 *   {"mes":"2026-11","saidaBytes":1234,"lidoEm":"2026-11-03T02:00:00Z"}
 *
 * **When in doubt, the normal budget.** A file that is missing, unreadable or older than
 * `IDADE_MAXIMA_DA_LEITURA_MS` says nothing about the quota, and cutting video
 * for everyone because a cron stopped would be a worse failure than the one it
 * tries to prevent. It is logged, and things go on as if there were no file.
 *
 * The cut-off only affects new admissions: anyone already sending or watching
 * carries on (see `OrcamentoDeSaida.definirTectoDoVideo`). Voice is never touched.
 */

/** The fraction of the quota at which video switches to the reduced budget. */
export const LIMIAR_DA_QUOTA = 0.8

/** A reading older than this does not count: the cron has stopped. */
export const IDADE_MAXIMA_DA_LEITURA_MS = 2 * 3600_000

/** The default quota, in TB (10^12 bytes, like `scripts/trafego-do-mes.mjs`). */
export const QUOTA_MENSAL_TB = 8

/** The default reduced video budget, in Mbit/s. */
export const ORCAMENTO_DE_VIDEO_REDUZIDO_MBPS = 50

export type EstadoDaQuota =
  | { estado: "normal"; fracao: number }
  | { estado: "reduzido"; fracao: number }
  | { estado: "ignorado"; razao: string }

/** The month of `agora` as `vnstat` counts it in the script: `YYYY-MM`, in UTC. */
export function mesDe(agora: Date): string {
  return `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, "0")}`
}

/**
 * What the file says about the quota, now.
 *
 * @param texto the file contents, or `null` if it does not exist or cannot be read.
 */
export function avaliarQuota(texto: string | null, quotaBytes: number, agora: Date): EstadoDaQuota {
  if (texto === null) return { estado: "ignorado", razao: "o ficheiro da quota não existe ou não se lê" }

  let dados: unknown
  try {
    dados = JSON.parse(texto)
  } catch {
    return { estado: "ignorado", razao: "o ficheiro da quota não é JSON" }
  }
  const { mes, saidaBytes, lidoEm } = (dados ?? {}) as { mes?: unknown; saidaBytes?: unknown; lidoEm?: unknown }
  const lido = typeof lidoEm === "string" ? Date.parse(lidoEm) : Number.NaN
  if (
    typeof mes !== "string" ||
    !/^\d{4}-\d{2}$/.test(mes) ||
    typeof saidaBytes !== "number" ||
    !Number.isFinite(saidaBytes) ||
    saidaBytes < 0 ||
    !Number.isFinite(lido)
  ) {
    return { estado: "ignorado", razao: "o ficheiro da quota não tem mes, saidaBytes e lidoEm válidos" }
  }

  if (agora.getTime() - lido > IDADE_MAXIMA_DA_LEITURA_MS) {
    return { estado: "ignorado", razao: `a leitura da quota é de ${lidoEm}, há mais de 2 h` }
  }

  // New month, new quota: what the file counts is from the month that ended.
  if (mes !== mesDe(agora)) return { estado: "normal", fracao: 0 }

  const fracao = quotaBytes > 0 ? saidaBytes / quotaBytes : 0
  return { estado: fracao >= LIMIAR_DA_QUOTA ? "reduzido" : "normal", fracao }
}

export interface OpcoesDaVigia {
  ficheiro: string
  quotaBytes: number
  videoNormalBps: number
  videoReduzidoBps: number
  /** Sets the video cap in the media engine. See `MotorDeMedia.definirOrcamentoDeVideo`. */
  aplicar: (videoBps: number) => void
  registar: (linha: string) => void
  /** Only tests change this. */
  ler?: (ficheiro: string) => Promise<string | null>
  agora?: () => Date
}

const percentagem = (fracao: number) => `${Math.round(fracao * 100)} %`

/** Reads the file, decides the video cap, and logs it when it changes. */
export class VigiaDaQuota {
  readonly #opcoes: OpcoesDaVigia
  readonly #ler: (ficheiro: string) => Promise<string | null>
  readonly #agora: () => Date
  /** The last state logged, to avoid repeating the same line every minute. */
  #ultimo = ""

  constructor(opcoes: OpcoesDaVigia) {
    this.#opcoes = opcoes
    this.#ler = opcoes.ler ?? ((ficheiro) => readFile(ficheiro, "utf8").catch(() => null))
    this.#agora = opcoes.agora ?? (() => new Date())
  }

  async verificar(): Promise<EstadoDaQuota> {
    const { ficheiro, quotaBytes, videoNormalBps, videoReduzidoBps, aplicar, registar } = this.#opcoes
    const estado = avaliarQuota(await this.#ler(ficheiro), quotaBytes, this.#agora())
    const reduzido = estado.estado === "reduzido"
    aplicar(reduzido ? videoReduzidoBps : videoNormalBps)

    const mbps = (bps: number) => Math.round(bps / 1_000_000)
    const chave = estado.estado === "ignorado" ? `ignorado:${estado.razao}` : estado.estado
    if (chave !== this.#ultimo) {
      const antes = this.#ultimo
      this.#ultimo = chave
      if (estado.estado === "ignorado") {
        registar(`enclave: aviso: ${estado.razao} (${ficheiro}); o orçamento de vídeo fica em ${mbps(videoNormalBps)} Mbit/s`)
      } else if (reduzido) {
        registar(
          `enclave: a saída do mês vai em ${percentagem(estado.fracao)} da quota: o orçamento de vídeo desce para ${mbps(videoReduzidoBps)} Mbit/s nas admissões novas`,
        )
      } else if (antes !== "") {
        registar(`enclave: a quota do mês está em ${percentagem(estado.fracao)}: o orçamento de vídeo volta a ${mbps(videoNormalBps)} Mbit/s`)
      }
    }
    return estado
  }

  /** Checks now and then every `intervaloMs`. Returns a function that stops it. */
  arrancar(intervaloMs = 60_000): () => void {
    const correr = () => void this.verificar().catch((erro: unknown) => this.#opcoes.registar(`enclave: aviso: a vigia da quota falhou (${String(erro)})`))
    correr()
    const relogio = setInterval(correr, intervaloMs)
    relogio.unref?.()
    return () => clearInterval(relogio)
  }
}
