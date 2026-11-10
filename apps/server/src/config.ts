import { ed25519 } from "@noble/curves/ed25519.js"
import {
  COFRE_BALDE_BYTES,
  COFRE_ENTRADA_MAX_BYTES,
  fromBase64,
  parseServerName,
  SINAL_MAX_CARACTERES,
  toBase64,
  type ServerName,
} from "@enclave/protocol"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { DENUNCIAS_DIAS } from "./denuncia.js"
import { ORCAMENTO_DE_VIDEO_MBPS, RESERVA_DA_VOZ_MBPS } from "./orcamento-de-saida.js"
import { ORCAMENTO_DE_VIDEO_REDUZIDO_MBPS, QUOTA_MENSAL_TB } from "./quota-mensal.js"

/** Is this the channel the server announces as common? One question, one place. */
export function ehSalaComum(config: Pick<ServerConfig, "commonRoom">, channel: string): boolean {
  return config.commonRoom !== "" && channel === config.commonRoom
}

export interface ServerConfig {
  serverName: ServerName
  bindHost: string
  bindPort: number
  dataDir: string
  databasePath: string
  /**
   * The single port where the media engine listens, UDP and TCP with the same
   * number.
   *
   * **Zero, which is the default, means "no SFU".** The process starts anyway,
   * the gateway responds anyway, and the only difference is that `hello.ok` does
   * not announce the `sfu` capability and every client keeps using the mesh,
   * which is exactly today's behaviour. It is what makes this phase deployable on its
   * own.
   *
   * One port, not a range: the mediasoup `WebRtcServer` multiplexes all
   * transports on a single number, and in UFW it is two rules (`44300/udp` and
   * `44300/tcp`) instead of ten thousand. TCP exists as a fallback for
   * networks that block UDP, and it is why coturn is no longer needed to cross
   * NAT.
   *
   * For a whole version, this spot held the line "Where the SFU lives. Media
   * never touches this process.", hanging over no member, because the member
   * was never written. The decision of 15 August 2026
   * (`docs/PENDENTES.md`, "SFU always") flipped it: media now crosses THIS
   * process. What stays true, and is the part that matters, is that it crosses
   * **encrypted with a key this process does not have**: only the clients open
   * the SFrame. See `media.ts`.
   */
  sfuPort: number
  /**
   * The address ICE candidates announce, when it is not the interface's.
   *
   * Inside Docker it is REQUIRED and it is not tuning: the worker sees the
   * bridge's internal IP (`172.x`), and a candidate with that address tells the
   * client to connect to a machine that, from its side, does not exist. The
   * symptom would be a call that negotiates completely and never connects, the
   * worst kind of break, because everything you read in the logs says it worked.
   *
   * Empty leaves mediasoup announcing the IP it listens on, which works in
   * development and in tests, where everything lives on `127.0.0.1`.
   */
  sfuAnnouncedIp: string
  /**
   * Days to keep ciphertext before deleting it.
   *
   * Defaults to 30. This is the single most consequential privacy setting an
   * operator controls: everything the server retains is everything a subpoena or
   * a breach can reach. Set to 0 to keep nothing beyond live delivery.
   */
  retentionDays: number
  /** Refuse federation with anyone not on this list. Empty means federation off. */
  allowlist: ServerName[]
  /**
   * TURN and STUN for calls, if the operator runs any.
   *
   * `turnSecret` is coturn's `static-auth-secret` and never reaches a client:
   * the gateway mints a short-lived username and HMAC per session. Empty means
   * clients fall back to a public STUN, which leaks the time and IP of every
   * call to a third party and cannot traverse symmetric NAT.
   */
  turnUrls: string[]
  turnSecret: string
  /** Seconds a minted TURN credential stays valid. */
  turnTtl: number
  /**
   * Everyone with an account here may learn that the other accounts exist.
   *
   * Off by default, and it must stay that way: on any server whose users do
   * not already know each other, handing out the account list is a betrayal
   * of the people on it. It exists for the private, family deployment
   * (a handful of people who all know they are here), where "who else is on
   * this server" is not a secret and the friend-request dance is pure
   * friction. Documented in docs/THREAT-MODEL.md and stated in the interface,
   * because a posture change the users cannot see is a lie by omission.
   */
  communityMode: boolean
  /** The room every user on this server joins. Empty turns the feature off. */
  commonRoom: string
  /**
   * Caps for ephemeral signals (`channel.sinal`). Optional: defaults come from
   * `TECTOS_DO_SINAL`. See there for the rationale of each number.
   */
  sinal?: Partial<TectosDoSinal>
  /**
   * The lowest app version this server accepts (`1.0.0`).
   *
   * Empty, the default, rejects no one: the server behaves as it always has, and it lets
   * this version ship to production before the 1.0 cut. Set, a `hello` from an
   * app below it (or that does not report a version, like all pre-1.0 apps)
   * gets the `error` `versao-antiga` and the connection closes. Optional in the
   * type for the same reason as `sinal`: tests build the config by hand and do
   * not need to know about this.
   */
  versaoMinimaDoCliente?: string
  /**
   * Caps for the encrypted vault (`cofre.*`, phase 3a). Optional for the same
   * reason as `sinal`: defaults come from `TECTOS_DO_COFRE`.
   */
  cofre?: Partial<TectosDoCofre>
  /**
   * Days without subscribers after which a channel's vault is erased (decision
   * D7 of the encrypted state plan: 90). Zero, the default, turns off sweeping:
   * nothing erases itself until the operator asks with `ENCLAVE_COFRE_GC_DIAS`.
   * See `Store.varrerCofres`.
   */
  cofreGcDias?: number
  /**
   * The media engine output budget, summed across all calls, in Mbit/s:
   * `ENCLAVE_ORCAMENTO_VIDEO_MBPS` (300) and `ENCLAVE_RESERVA_VOZ_MBPS` (40).
   * Optional for the same reason as `sinal`. See `orcamento-de-saida.ts`.
   */
  orcamentoDeSaida?: { videoMbps: number; reservaDaVozMbps: number }
  /**
   * Video cut-off near the monthly traffic quota. An empty `ficheiro` turns the
   * watch off:
   * `ENCLAVE_QUOTA_FICHEIRO`, `ENCLAVE_QUOTA_MENSAL_TB` (8), and
   * `ENCLAVE_ORCAMENTO_VIDEO_REDUZIDO_MBPS` (50). See `quota-mensal.ts`.
   */
  quota?: { ficheiro: string; mensalTb: number; videoReduzidoMbps: number }
  /**
   * The GoFundMe campaign address that the site meter reads
   * (`ENCLAVE_CAMPANHA_GOFUNDME`). Empty, the default, turns off reading, and
   * `/_enclave/apoiar.json` returns 404. See `apoio.ts`.
   */
  campanhaGofundme?: string
  /**
   * Days a closed report stays in `<dados>/denuncias/`
   * (`ENCLAVE_DENUNCIAS_DIAS`, 90). Optional for the same reason as `sinal`:
   * defaults are `DENUNCIAS_DIAS`. See `denuncia.ts`.
   */
  denunciasDias?: number
  /**
   * The delay, in hours, before a report copy reaches the founder
   * (`ENCLAVE_DENUNCIA_ATRASO_HORAS`, `1-6`): minimum and maximum, chosen at
   * random between them. Delivery to the second would let anyone match the time
   * against who was online. Optional for the same reason as `sinal`.
   */
  denunciaAtrasoHoras?: [number, number]
  /*
    There is no opaque-addresses switch (`ENCLAVE_SO_MORADAS_OPACAS`, slice 4): in
    1.0 "Arca" is the only mode (slice 6a). An old `.env` that still has it
    changes nothing, because no one reads it anymore.
  */
}

/** A version `x.y.z` parsed into three numbers, or `null` if it is not one. */
function lerVersao(versao: string): [number, number, number] | null {
  // A pre-release (`1.0.0-rc.1`) is judged by its three numbers: a 1.0
  // release candidate must get into the 1.0 server, which is where it is tested.
  const partes = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+][0-9A-Za-z.-]*)?$/.exec(versao)
  if (!partes) return null
  return [Number(partes[1]), Number(partes[2]), Number(partes[3])]
}

/**
 * Should this app be rejected for being old?
 *
 * Without a minimum, never. With a minimum, a missing or unreadable version is
 * old: no app from 1.0 onward fails to send it, and all earlier ones omit it,
 * so its absence is the very mark of a beta app.
 */
export function eVersaoAntiga(config: Pick<ServerConfig, "versaoMinimaDoCliente">, versao: string | undefined): boolean {
  const minima = config.versaoMinimaDoCliente ? lerVersao(config.versaoMinimaDoCliente) : null
  if (!minima) return false
  const dela = versao === undefined ? null : lerVersao(versao)
  if (!dela) return true
  for (let i = 0; i < 3; i++) {
    if ((dela[i] as number) !== (minima[i] as number)) return (dela[i] as number) < (minima[i] as number)
  }
  return false
}

/**
 * The minimum version read from the environment. Garbage is a loud startup
 * error: a `1.0` accepted silently and read as "no minimum" would let beta
 * clients into a server that no longer understands them, and read as
 * "impossible version" would reject everyone.
 */
function readVersaoMinima(raw: string | undefined): string {
  const valor = (raw ?? "").trim()
  if (valor === "") return ""
  if (!lerVersao(valor)) {
    throw new Error(`ENCLAVE_VERSAO_MINIMA_DO_CLIENTE must be a version like 1.0.0, got ${JSON.stringify(raw)}`)
  }
  return valor
}

/**
 * The caps for `channel.sinal`, the ephemeral sync frame between accounts.
 *
 * The server does not decide who replies to whom: the clients do, through the
 * plan's election (`docs/planos/2026-10-20-sincronia-absoluta.md`, §4.4). The
 * server only limits, so a broken or hostile client cannot use up everyone's
 * egress. The numbers start from the plan's estimates for an honest device and
 * leave at least 2x headroom.
 */
export interface TectosDoSinal {
  /**
   * Signals per CONNECTION and per minute, summed across all channels.
   *
   * The plan gives a device, per minute: 1 level-0 digest per channel, and 30
   * requests total. A device with 20 channels that connects sends up to 20
   * digests, plus 30 requests, plus level-1 and level-2 replies to other
   * devices' digests. That is about 60. 120 gives 2x headroom. Per
   * connection, not per account, because each device has its own leaf and its
   * own digests.
   */
  porMinutoPorLigacao: number
  /**
   * Maximum size of a signal, in base64url characters, as it travels.
   *
   * The heaviest signal in the plan is a level-2 list or a request: 6-byte
   * keys. A thousand keys are 6 KB, 8 KiB in base64, plus the signature. 16 KiB
   * is twice that. Above the protocol cap (`SINAL_MAX_CARACTERES`, 64 KiB) it
   * cannot go: the schema rejects it first.
   */
  maxBytes: number
  /**
   * Bytes leaving the server per CHANNEL and per minute, counting every copy.
   *
   * A signal of S bytes in a channel with N other members online costs S × N in
   * server egress. This is what gets limited, not the signal count: N
   * members sending small digests cost little, and a large signal in a large
   * channel costs a lot. 4 MiB per minute per channel: a channel with 50 members
   * online holds close to 340 digests of 240 bytes per minute, and the 28
   * production channels (20/10) all at cap at once give about 15 Mbit/s, well
   * below the VPS link. A signal that alone costs more than this gets rejected
   * with `sinal-too-large`, because waiting will not fix it.
   */
  bytesPorCanalPorMinuto: number
  /**
   * Rejections per connection and per minute before closing the connection.
   *
   * The first rejection never closes: an honest client hears the code, waits
   * `retryAfterMs`, and backs off. Thirty rejections in a minute mean the
   * client is not listening, and the connection closes with `error`
   * `sinal-abuse`, as the `pair.join` cap closes a client that keeps trying.
   */
  recusasAteFechar: number
}

export const TECTOS_DO_SINAL: Readonly<TectosDoSinal> = Object.freeze({
  porMinutoPorLigacao: 120,
  maxBytes: 16 * 1024,
  bytesPorCanalPorMinuto: 4 * 1024 * 1024,
  recusasAteFechar: 30,
})

/** The caps that apply, with defaults filling what is missing. */
export function tectosDoSinal(config: Pick<ServerConfig, "sinal">): TectosDoSinal {
  return { ...TECTOS_DO_SINAL, ...config.sinal }
}

/**
 * A signal cap, read from the environment. Empty or missing is the default;
 * garbage, zero, or negative is a startup error, from the lesson of
 * `readRetentionDays`: a `Number("")` that gives 0 here would silence all
 * signals with no one knowing why.
 */
function readTectoDoSinal(nome: string, raw: string | undefined, porOmissao: number, maximo = Number.MAX_SAFE_INTEGER): number {
  const trimmed = raw?.trim()
  if (!trimmed) return porOmissao
  const valor = Number(trimmed)
  if (!Number.isInteger(valor) || valor < 1 || valor > maximo) {
    throw new Error(`${nome} must be a whole number between 1 and ${maximo}, got ${JSON.stringify(raw)}`)
  }
  return valor
}

function readTectosDoSinal(env: NodeJS.ProcessEnv): TectosDoSinal {
  return {
    porMinutoPorLigacao: readTectoDoSinal("ENCLAVE_SINAL_POR_MINUTO", env.ENCLAVE_SINAL_POR_MINUTO, TECTOS_DO_SINAL.porMinutoPorLigacao),
    maxBytes: readTectoDoSinal("ENCLAVE_SINAL_MAX_BYTES", env.ENCLAVE_SINAL_MAX_BYTES, TECTOS_DO_SINAL.maxBytes, SINAL_MAX_CARACTERES),
    bytesPorCanalPorMinuto: readTectoDoSinal(
      "ENCLAVE_SINAL_BYTES_POR_CANAL",
      env.ENCLAVE_SINAL_BYTES_POR_CANAL,
      TECTOS_DO_SINAL.bytesPorCanalPorMinuto,
    ),
    recusasAteFechar: readTectoDoSinal("ENCLAVE_SINAL_RECUSAS_ATE_FECHAR", env.ENCLAVE_SINAL_RECUSAS_ATE_FECHAR, TECTOS_DO_SINAL.recusasAteFechar),
  }
}

/**
 * The caps for the encrypted vault (`cofre.*`, phase 3a of the encrypted state
 * plan).
 *
 * The vault stores STATE (rooms, categories, roles, profiles), one entry per
 * fact, and never conversations. The numbers come from the largest plausible channel
 * and leave headroom; what gets limited is the disk of each scope and the rate
 * of each account, so a broken or hostile client does not fill the server.
 */
export interface TectosDoCofre {
  /**
   * Bytes of one entry, after padding. 64 KiB fits an encrypted `ItemRelatado`
   * with plenty of headroom; icons and profile pictures go in `anexo:` entries,
   * downscaled on write (decision D5). Must be a multiple of
   * `COFRE_BALDE_BYTES` and not exceed `COFRE_ENTRADA_MAX_BYTES`, the protocol
   * cap.
   */
  entradaMaxBytes: number
  /**
   * Live entries per scope. A channel with 200 rooms, 30 categories, 40 roles,
   * and 500 members with a profile has close to 1,300 entries: 4096 is three
   * times that. Tombstones count separately and get pruned (see
   * `Store.cofrePut`).
   */
  entradasPorEscopo: number
  /** Live bytes per channel scope. 4096 entries of 4 KiB. */
  bytesPorEscopoDeCanal: number
  /** Live bytes per account scope: a device's `EstadoDeConta`, with headroom. */
  bytesPorEscopoDeConta: number
  /** Entries written (and erased) per account and per minute, summed across scopes. */
  escritasPorMinuto: number
  /** Reads (`cofre.get`, one per page) per account and per minute. */
  leiturasPorMinuto: number
  /**
   * Frames rejected per connection and per minute before closing with `error`
   * `cofre-abuso`. The first rejection never closes, like with signals.
   */
  recusasAteFechar: number
}

export const TECTOS_DO_COFRE: Readonly<TectosDoCofre> = Object.freeze({
  entradaMaxBytes: 64 * 1024,
  entradasPorEscopo: 4096,
  bytesPorEscopoDeCanal: 16 * 1024 * 1024,
  bytesPorEscopoDeConta: 2 * 1024 * 1024,
  escritasPorMinuto: 120,
  leiturasPorMinuto: 60,
  recusasAteFechar: 30,
})

/** The vault caps that apply, with defaults filling what is missing. */
export function tectosDoCofre(config: Pick<ServerConfig, "cofre">): TectosDoCofre {
  return { ...TECTOS_DO_COFRE, ...config.cofre }
}

function readTectosDoCofre(env: NodeJS.ProcessEnv): TectosDoCofre {
  const entradaMaxBytes = readTectoDoSinal(
    "ENCLAVE_COFRE_ENTRADA_MAX_BYTES",
    env.ENCLAVE_COFRE_ENTRADA_MAX_BYTES,
    TECTOS_DO_COFRE.entradaMaxBytes,
    COFRE_ENTRADA_MAX_BYTES,
  )
  // A cap that is not a multiple of the bucket would reject entries larger than
  // what fits in it and accept the rest: a number that lies about what it lets
  // through. Better to reject at startup.
  if (entradaMaxBytes % COFRE_BALDE_BYTES !== 0) {
    throw new Error(
      `ENCLAVE_COFRE_ENTRADA_MAX_BYTES must be a multiple of ${COFRE_BALDE_BYTES}, got ${JSON.stringify(env.ENCLAVE_COFRE_ENTRADA_MAX_BYTES)}`,
    )
  }
  return {
    entradaMaxBytes,
    entradasPorEscopo: readTectoDoSinal("ENCLAVE_COFRE_ENTRADAS_POR_ESCOPO", env.ENCLAVE_COFRE_ENTRADAS_POR_ESCOPO, TECTOS_DO_COFRE.entradasPorEscopo),
    bytesPorEscopoDeCanal: readTectoDoSinal("ENCLAVE_COFRE_BYTES_POR_CANAL", env.ENCLAVE_COFRE_BYTES_POR_CANAL, TECTOS_DO_COFRE.bytesPorEscopoDeCanal),
    bytesPorEscopoDeConta: readTectoDoSinal("ENCLAVE_COFRE_BYTES_POR_CONTA", env.ENCLAVE_COFRE_BYTES_POR_CONTA, TECTOS_DO_COFRE.bytesPorEscopoDeConta),
    escritasPorMinuto: readTectoDoSinal("ENCLAVE_COFRE_ESCRITAS_POR_MINUTO", env.ENCLAVE_COFRE_ESCRITAS_POR_MINUTO, TECTOS_DO_COFRE.escritasPorMinuto),
    leiturasPorMinuto: readTectoDoSinal("ENCLAVE_COFRE_LEITURAS_POR_MINUTO", env.ENCLAVE_COFRE_LEITURAS_POR_MINUTO, TECTOS_DO_COFRE.leiturasPorMinuto),
    recusasAteFechar: readTectoDoSinal("ENCLAVE_COFRE_RECUSAS_ATE_FECHAR", env.ENCLAVE_COFRE_RECUSAS_ATE_FECHAR, TECTOS_DO_COFRE.recusasAteFechar),
  }
}

/**
 * The days for the sweep of vaults with no subscribers. Empty or missing is 0 (off);
 * garbage or negative is a startup error, from the lesson of `readRetentionDays`:
 * here a `Number("")` read as 0 is harmless, but a `0,5` read as NaN would
 * silence the sweep the operator asked for without saying so.
 */
function readCofreGcDias(raw: string | undefined): number {
  const trimmed = raw?.trim()
  if (!trimmed) return 0
  const dias = Number(trimmed)
  if (!Number.isInteger(dias) || dias < 0) {
    throw new Error(`ENCLAVE_COFRE_GC_DIAS must be a non-negative whole number of days, got ${JSON.stringify(raw)}`)
  }
  return dias
}

/**
 * An output budget in Mbit/s. Empty is the default; garbage, or a negative
 * number, is a startup error, from the lesson of `readRetentionDays`. Zero is
 * accepted: `ENCLAVE_ORCAMENTO_VIDEO_MBPS=0` rejects all video.
 */
function readMbps(nome: string, raw: string | undefined, omissao: number, unidade = "Mbit/s"): number {
  const trimmed = raw?.trim()
  if (!trimmed) return omissao
  const mbps = Number(trimmed)
  if (!Number.isFinite(mbps) || mbps < 0) {
    throw new Error(`${nome} must be a non-negative number of ${unidade}, got ${JSON.stringify(raw)}`)
  }
  return mbps
}

/**
 * Retention in days, refusing anything that is not a number.
 *
 * `Number(env.X ?? 30)` looks safe and is not: `??` only catches undefined, so
 * an empty or blank value becomes 0, and `expireEvents(0)` runs
 * `DELETE FROM events` with no clause, every sixty seconds. A stray
 * `ENCLAVE_RETENTION_DAYS=` in a unit file or a `docker run -e` would quietly
 * erase the entire server a minute after boot. `Number("thirty")` is NaN, which
 * silently disabled retention instead. Both now fail loudly at startup.
 *
 * Whole days only. `ENCLAVE_RETENTION_DAYS=1.5` used to be accepted and then
 * announced to clients as `retentionDays` in `hello.ok`, whose schema demands
 * an integer: every client would have rejected the frame and nobody would have
 * connected, over a config value the server itself had waved through.
 */
function readRetentionDays(raw: string | undefined): number {
  const trimmed = raw?.trim()
  if (!trimmed) return 30
  const days = Number(trimmed)
  if (!Number.isInteger(days) || days < 0) {
    throw new Error(`ENCLAVE_RETENTION_DAYS must be a non-negative whole number of days, got ${JSON.stringify(raw)}`)
  }
  return days
}

/**
 * The SFU port, rejecting what is not a port.
 *
 * Same shape as `readRetentionDays`, for the same lesson learned the hard way: `Number("")`
 * is 0 and `Number("quarenta")` is NaN, and neither looks like an error when
 * it reaches mediasoup. Here the difference between the two cases matters and
 * is handled in opposite ways, on purpose:
 *
 *  - **empty or missing is 0, and 0 is "no SFU"**, the only safe choice, because
 *    it lets the server behave as it always has;
 *  - **garbage is a loud startup error**, because `ENCLAVE_SFU_PORT=443OO` (with
 *    the letter O instead of zero) would give a server without SFU and a team
 *    hunting the bug in the client, nginx, and UFW before looking here.
 */
function readSfuPort(raw: string | undefined): number {
  const trimmed = raw?.trim()
  if (!trimmed) return 0
  const port = Number(trimmed)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`ENCLAVE_SFU_PORT must be a port number between 0 and 65535, got ${JSON.stringify(raw)}`)
  }
  return port
}

/**
 * The days to keep closed reports. Empty is 90; garbage, zero, or negative is
 * a startup error, from the lesson of `readRetentionDays`: a zero read in
 * silence would erase reports the day they close.
 */
function readDenunciasDias(raw: string | undefined): number {
  return readTectoDoSinal("ENCLAVE_DENUNCIAS_DIAS", raw, DENUNCIAS_DIAS)
}

/**
 * The delay of the copy to the founder, `minimum-maximum` in whole hours. Empty is
 * `1-6`; another format, or the minimum above the maximum, is a startup error.
 */
function readDenunciaAtrasoHoras(raw: string | undefined): [number, number] {
  const valor = (raw ?? "").trim()
  if (valor === "") return [1, 6]
  const partes = /^(\d{1,3})-(\d{1,3})$/.exec(valor)
  const minimo = Number(partes?.[1])
  const maximo = Number(partes?.[2])
  if (!partes || minimo > maximo) {
    throw new Error(`ENCLAVE_DENUNCIA_ATRASO_HORAS must be two whole numbers of hours like 1-6, got ${JSON.stringify(raw)}`)
  }
  return [minimo, maximo]
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dataDir = env.ENCLAVE_DATA_DIR ?? "./data"
  return {
    serverName: parseServerName(env.ENCLAVE_SERVER_NAME ?? "localhost:8448"),
    bindHost: env.ENCLAVE_BIND_HOST ?? "127.0.0.1",
    bindPort: Number(env.ENCLAVE_BIND_PORT ?? 8448),
    dataDir,
    databasePath: env.ENCLAVE_DB_PATH ?? join(dataDir, "enclave.sqlite"),
    sfuPort: readSfuPort(env.ENCLAVE_SFU_PORT),
    sfuAnnouncedIp: (env.ENCLAVE_SFU_ANNOUNCED_IP ?? "").trim(),
    retentionDays: readRetentionDays(env.ENCLAVE_RETENTION_DAYS),
    turnUrls: (env.ENCLAVE_TURN_URLS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    turnSecret: env.ENCLAVE_TURN_SECRET ?? "",
    turnTtl: Number(env.ENCLAVE_TURN_TTL ?? 600),
    communityMode: env.ENCLAVE_COMMUNITY_MODE === "true",
    commonRoom: (env.ENCLAVE_COMMON_ROOM ?? "").trim(),
    allowlist: (env.ENCLAVE_FEDERATION_ALLOWLIST ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map(parseServerName),
    sinal: readTectosDoSinal(env),
    versaoMinimaDoCliente: readVersaoMinima(env.ENCLAVE_VERSAO_MINIMA_DO_CLIENTE),
    cofre: readTectosDoCofre(env),
    cofreGcDias: readCofreGcDias(env.ENCLAVE_COFRE_GC_DIAS),
    orcamentoDeSaida: {
      videoMbps: readMbps("ENCLAVE_ORCAMENTO_VIDEO_MBPS", env.ENCLAVE_ORCAMENTO_VIDEO_MBPS, ORCAMENTO_DE_VIDEO_MBPS),
      reservaDaVozMbps: readMbps("ENCLAVE_RESERVA_VOZ_MBPS", env.ENCLAVE_RESERVA_VOZ_MBPS, RESERVA_DA_VOZ_MBPS),
    },
    quota: {
      ficheiro: (env.ENCLAVE_QUOTA_FICHEIRO ?? "").trim(),
      mensalTb: readMbps("ENCLAVE_QUOTA_MENSAL_TB", env.ENCLAVE_QUOTA_MENSAL_TB, QUOTA_MENSAL_TB, "TB"),
      videoReduzidoMbps: readMbps(
        "ENCLAVE_ORCAMENTO_VIDEO_REDUZIDO_MBPS",
        env.ENCLAVE_ORCAMENTO_VIDEO_REDUZIDO_MBPS,
        ORCAMENTO_DE_VIDEO_REDUZIDO_MBPS,
      ),
    },
    campanhaGofundme: (env.ENCLAVE_CAMPANHA_GOFUNDME ?? "").trim(),
    denunciasDias: readDenunciasDias(env.ENCLAVE_DENUNCIAS_DIAS),
    denunciaAtrasoHoras: readDenunciaAtrasoHoras(env.ENCLAVE_DENUNCIA_ATRASO_HORAS),
  }
}

export interface ServerKeypair {
  keyId: string
  privateKey: Uint8Array
  publicKey: Uint8Array
}

/**
 * The server's federation signing key.
 *
 * Generated on first boot and kept on disk. It signs envelopes to peers; it is
 * not, and must never become, a key that can read user content. If this key
 * leaks, an attacker can impersonate the server to peers (bad), but still
 * cannot decrypt a single message.
 */
export function loadOrCreateServerKey(dataDir: string): ServerKeypair {
  const path = join(dataDir, "server.key.json")
  mkdirSync(dirname(path), { recursive: true })

  if (existsSync(path)) {
    const stored = JSON.parse(readFileSync(path, "utf8")) as { keyId: string; privateKey: string }
    const privateKey = fromBase64(stored.privateKey)
    return { keyId: stored.keyId, privateKey, publicKey: ed25519.getPublicKey(privateKey) }
  }

  const privateKey = ed25519.utils.randomSecretKey()
  const keyId = `ed25519:${toBase64(crypto.getRandomValues(new Uint8Array(6)))}`
  writeFileSync(path, JSON.stringify({ keyId, privateKey: toBase64(privateKey) }, null, 2), { mode: 0o600 })
  return { keyId, privateKey, publicKey: ed25519.getPublicKey(privateKey) }
}
