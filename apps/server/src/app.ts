import websocket from "@fastify/websocket"
import { FEDERATION_PATH, FederationEnvelope, PeerClaim, toBase64, type PeerClaimReply } from "@enclave/protocol"
import Fastify, { type FastifyInstance } from "fastify"
import { join } from "node:path"
import { CACHE_DO_JSON_S, VigiaDaCampanha } from "./apoio.js"
import { currentSecond, openDatabase } from "./db.js"
import { ehSalaComum, loadOrCreateServerKey, type ServerConfig } from "./config.js"
import { Federation } from "./federation.js"
import { Gateway, MAX_FRAME_BYTES } from "./gateway.js"
import { MotorDeMedia } from "./media.js"
import { ORCAMENTO_DE_VIDEO_MBPS, linhaDaSaida } from "./orcamento-de-saida.js"
import { VigiaDaQuota } from "./quota-mensal.js"
import { registarDenuncias } from "./denuncia.js"
import { NoncesVistos } from "./pedido-assinado.js"
import { registarRelatos } from "./relato.js"
import { Store } from "./store.js"

export interface Enclave {
  app: FastifyInstance
  store: Store
  gateway: Gateway
  federation: Federation
  /** The media engine, when the operator configured a port for it. */
  media: MotorDeMedia | undefined
  /** Nonces of the signed report requests (tests read the size). */
  nonces: NoncesVistos
  close: () => Promise<void>
}

/**
 * Which peers we accept X-Forwarded-For from (NET-01, 1.2.1). It was `true`, trusting
 * any peer and reading the leftmost address: a client reaching the server via
 * another path could pick its own IP. Now only private network peers (Caddy on
 * the compose network, and the network gateway that the host's nginx reaches from),
 * and the caller's IP is the first PUBLIC address from the right. A forged value
 * on the left is never read. The full path and proof are in `docs/DEPLOY-WEB.md`
 * ("O IP de quem pede") and `ip-do-cliente.test.ts`.
 */
export const PROXIES_DE_CONFIANCA = "loopback, linklocal, uniquelocal"

export async function buildServer(config: ServerConfig): Promise<Enclave> {
  const db = openDatabase(config.databasePath)
  const store = new Store(db)
  // Before the gateway accepts the first frame: a commit for a channel whose
  // epoch is not known yet is accepted at any epoch. See
  // `Store.inicializarEpochs`.
  // Re-foundings in the history: counting starts from the latest one in every
  // channel except the common room, group channels included, which before this
  // deploy were recreated with the same name. See `Store.inicializarEpochs`.
  store.inicializarEpochs((canal) => !ehSalaComum(config, canal))
  const key = loadOrCreateServerKey(config.dataDir)

  const gateway = new Gateway(store, config)
  const federation = new Federation(store, config, key, gateway)
  gateway.attachFederation(federation)

  /**
   * The media engine, if the operator gave it a port.
   *
   * **Failing to bring it up must not take the server down.** The common case is
   * the port being in use, and on a machine shared with magnuslab.pt that is a
   * matter of time, not a hypothesis. A server that refused to start because of that
   * would take with it the text, the history, and federation, everything that
   * works without media, for a feature that doesn't even have a client yet.
   * So: log it loudly, don't advertise the capability, and everyone keeps using
   * the mesh, which is exactly the previous behaviour.
   *
   * `attachMedia` is what declares the capability, and it declares it from the
   * engine's STATE. Without this line, `#sfuDePe` keeps returning false and
   * `hello.ok` doesn't promise anything, which is why Phase 1 is deployable
   * on its own.
   */
  let media: MotorDeMedia | undefined
  if (config.sfuPort > 0) {
    try {
      media = await MotorDeMedia.arrancar({
        porto: config.sfuPort,
        anunciarIp: config.sfuAnnouncedIp,
        escutarEm: config.bindHost === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0",
        ...(config.orcamentoDeSaida
          ? {
              orcamentoDeSaida: {
                videoBps: config.orcamentoDeSaida.videoMbps * 1_000_000,
                reservaDaVozBps: config.orcamentoDeSaida.reservaDaVozMbps * 1_000_000,
              },
            }
          : {}),
      })
      gateway.attachMedia(media)
    } catch (erro) {
      process.stderr.write(
        `enclave: o motor de media não arrancou no porto ${config.sfuPort} (${String(erro)}).\n` +
          "         O servidor continua; as chamadas ficam em malha, como antes.\n",
      )
    }
  }

  const app = Fastify({
    // Request logging is off by default. An access log is a per-user, per-minute
    // activity record; on a privacy server that is a liability, not telemetry.
    // Set ENCLAVE_LOG=debug when you are actively debugging, not in production.
    logger: process.env.ENCLAVE_LOG === "debug",
    trustProxy: PROXIES_DE_CONFIANCA,
  })

  // 12 MB: a post may carry up to four 3 MB images, and each arrives here as
  // base64 of ciphertext of base64 (~1.8× the file). 1 MB silently severed the
  // connection on the first real photo: the composer's limit and this one
  // must move together. The gateway's own ceiling is the same constant now,
  // and not a second number written down twice: they drifted once, and the
  // cost was every post with a photo in it vanishing between two people.
  await app.register(websocket, { options: { maxPayload: MAX_FRAME_BYTES } })

  app.get("/_enclave/gateway", { websocket: true }, (socket) => {
    gateway.accept(socket)
  })

  /**
   * Advertised verify keys.
   *
   * Public by necessity (peers cannot check our signatures otherwise) and
   * harmless: these keys sign routing envelopes and cannot decrypt anything.
   */
  app.get(`${FEDERATION_PATH}/keys`, async () => ({
    server: config.serverName,
    validUntil: currentSecond() + 7 * 24 * 3600,
    keys: { [key.keyId]: { key: toBase64(key.publicKey) } },
  }))

  app.post(`${FEDERATION_PATH}/send`, async (request, reply) => {
    const parsed = FederationEnvelope.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "malformed-envelope" })

    const result = await federation.receive(parsed.data)
    // The per-origin cap (FED-01) is the only refusal the peer should retry later.
    if (!result.ok) return reply.code(result.reason === "rate-limited" ? 429 : 403).send({ error: result.reason })
    return { ok: true }
  })

  /**
   * Hand a key package to a federated peer so it can add one of our accounts to
   * a group while that account is offline.
   *
   * This route CONSUMES a package: `claimKeyPackage` marks it claimed and it is
   * never served again. Unauthenticated, that made it a denial of service anyone
   * could run with a curl loop: drain someone's pool and nobody can invite
   * them to anything until their client next comes online and publishes more,
   * with the victim seeing only invitations that never arrive. It also confirmed
   * whether an address existed here, which is an account enumeration oracle.
   *
   * So: only for peers we federate with, and only when federation is on at all.
   * A local client never needs this route: it publishes and claims over the
   * authenticated gateway.
   *
   * It used to be a GET decided by headers (the `Origin` and an
   * `X-Enclave-Server`), and the caller chooses its headers. Anyone who knew
   * the name of a peer on the allowlist could send it and drain the pool of any
   * account here; on the production server, whose allowlist includes its own
   * name, it was enough to claim to be that server. Now it is a POST, SIGNED
   * with the key of the requesting server, verified against the directory that
   * server publishes, with destination, clock and nonce: the same proof the
   * delivery route already required. See `PeerClaim`.
   */
  app.post(`${FEDERATION_PATH}/keypackage`, async (request, reply) => {
    const parsed = PeerClaim.safeParse(request.body)
    // Same answer for "malformed", "not allowed" and "no such account", so the
    // route cannot be used to test whether an address exists.
    if (!parsed.success) return reply.code(403).send({ error: "not-federated" })

    const allowed = await federation.claimForPeer(parsed.data)
    if (!allowed.ok) return reply.code(403).send({ error: "not-federated" })

    // A suspended account cannot be invited (reports, §8), not even from another server:
    // the response is that of an empty pool, and nothing is spent.
    if (store.estaSuspensa(allowed.address)) {
      return (parsed.data.bundle ? { keyPackage: null, keyPackages: [], manifest: null } : { keyPackage: null }) satisfies PeerClaimReply
    }

    // Same contract as `keypackage.claim` on the gateway: without `bundle`, one
    // package and nothing more (a 0.2.3 peer asks and reads this way); with `bundle`,
    // the single package plus the per-device packages and the manifest. See `PeerClaim`.
    if (!parsed.data.bundle) {
      const claimed = store.claimKeyPackage(allowed.address)
      return { keyPackage: claimed ? toBase64(claimed) : null } satisfies PeerClaimReply
    }
    const { manifest, packages, fallback } = store.claimBundle(allowed.address, parsed.data.devices)
    const keyPackages = packages.map((p) => ({ deviceKey: p.deviceKey, keyPackage: toBase64(p.keyPackage) }))
    return {
      keyPackage: keyPackages[0]?.keyPackage ?? (fallback ? toBase64(fallback) : null),
      keyPackages,
      manifest,
    } satisfies PeerClaimReply
  })

  /**
   * Liveness only.
   *
   * Deliberately reports nothing about users, channels or volume. An unauthenticated
   * endpoint that exposes "how many people are on this server right now" is a
   * traffic-analysis feed for anyone who polls it.
   */
  app.get("/_enclave/health", async () => ({ ok: true, server: config.serverName }))

  /*
    The meter for the "Support" section of the website: the GoFundMe campaign
    total, read by this server every 15 minutes. Visitors to orwell.pt read this
    JSON on the same origin and never send a request to GoFundMe. It lives under
    `/_enclave/` for the same reason as `relato.ts`: Caddy already routes this path
    to the server, so the infrastructure does not change. With no value (reading
    disabled, or no good read yet) it returns 404, and the site shows no bar.
    See `apoio.ts`.
  */
  const campanha = config.campanhaGofundme
    ? new VigiaDaCampanha({
        url: config.campanhaGofundme,
        ficheiro: join(config.dataDir, "apoio-campanha.json"),
        registar: (linha) => void process.stderr.write(`${linha}\n`),
      })
    : undefined
  const pararCampanha = campanha?.arrancar()
  app.get("/_enclave/apoiar.json", async (_pedido, resposta) => {
    const apoio = campanha?.ultimoBom
    if (!apoio) return resposta.code(404).header("cache-control", "no-store").send({ erro: "sem-valor" })
    return resposta.header("cache-control", `public, max-age=${CACHE_DO_JSON_S}`).send(apoio)
  })

  // The app's "Enviar registo" (send log) button (Help and diagnostics): see `relato.ts`.
  const pararRelatos = registarRelatos(app, config.dataDir)

  // Reports (`denuncia.ts`): files in `<dados>/denuncias/`, outside the
  // database. One nonce store for the signed requests covers every report route.
  const nonces = new NoncesVistos()
  const pararDenuncias = registarDenuncias(app, { store, config, nonces })

  // Supersedeen welcomes are dead weight that used to be re-delivered for
  // ever; clear them at boot and hourly.
  store.pruneSupersededWelcomes()
  const welcomeSweep = setInterval(() => store.pruneSupersededWelcomes(), 3_600_000)
  welcomeSweep.unref()

  // Sweep of the vaults of channels with no subscribers (decision D7). Off
  // by default: runs only with ENCLAVE_COFRE_GC_DIAS above zero. Hourly, like
  // the Welcome sweep; see `Store.varrerCofres`.
  const diasDoCofre = config.cofreGcDias ?? 0
  const varrerCofres = (): void => {
    store.varrerCofres(Math.floor(Date.now() / 60_000), diasDoCofre)
  }
  const cofreSweep = diasDoCofre > 0 ? setInterval(varrerCofres, 3_600_000) : undefined
  if (cofreSweep) {
    varrerCofres()
    cofreSweep.unref()
  }

  /*
    Reserved media output, summed over all calls, every minute.
    Numbers only, no channels or accounts (same reason as `metricasDoSinal`),
    and only when it changed: an idle server doesn't fill the log.
  */
  let saidaAnterior = ""
  const saidaTimer = media
    ? setInterval(() => {
        const linha = linhaDaSaida(media.saida())
        if (linha === saidaAnterior) return
        saidaAnterior = linha
        process.stderr.write(`enclave: saída de media: ${linha}\n`)
      }, 60_000)
    : undefined
  saidaTimer?.unref()

  // Video cut-off near the monthly quota, when the host writes the file
  // (`infra/quota-vnstat.sh`). See `quota-mensal.ts`.
  const pararQuota =
    media && config.quota?.ficheiro
      ? new VigiaDaQuota({
          ficheiro: config.quota.ficheiro,
          quotaBytes: config.quota.mensalTb * 1e12,
          videoNormalBps: (config.orcamentoDeSaida?.videoMbps ?? ORCAMENTO_DE_VIDEO_MBPS) * 1_000_000,
          videoReduzidoBps: config.quota.videoReduzidoMbps * 1_000_000,
          aplicar: (bits) => media.definirOrcamentoDeVideo(bits),
          registar: (linha) => void process.stderr.write(`${linha}\n`),
        }).arrancar()
      : undefined

  // Connections of suspended accounts that send nothing (reports, §8): closed
  // at most a minute after the suspension. See `Gateway.fecharSuspensas`.
  const suspensasTimer = setInterval(() => gateway.fecharSuspensas(), Gateway.VARRER_SUSPENSAS_MS)
  suspensasTimer.unref()

  const outboxTimer = setInterval(() => void federation.flush(), 1000)
  const sweepTimer = setInterval(() => federation.sweep(), 60_000)
  outboxTimer.unref()
  sweepTimer.unref()

  return {
    app,
    store,
    gateway,
    federation,
    media,
    nonces,
    close: async () => {
      clearInterval(outboxTimer)
      clearInterval(suspensasTimer)
      if (saidaTimer) clearInterval(saidaTimer)
      pararQuota?.()
      pararCampanha?.()
      clearInterval(sweepTimer)
      if (cofreSweep) clearInterval(cofreSweep)
      pararRelatos()
      pararDenuncias()
      await app.close()
      // The worker is a SUBPROCESS, and a subprocess nobody closes stays alive.
      // In a test suite that's dozens of dangling processes until the machine says no;
      // in production it's one orphaned worker per restart.
      await media?.fechar()
      db.close()
    },
  }
}
