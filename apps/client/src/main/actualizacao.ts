/**
 * Know it fell behind. Don't auto-update.
 *
 * **Note from November 2, 2026:** On Windows the app started auto-updating on
 * startup with an Ed25519 key of ours instead of `electron-updater`. The design
 * and reasoning are in `actualizacao-windows.ts`. This file remains the login warning:
 * the macOS path, and Windows plan B when auto-update couldn't run. Everything said
 * below about `electron-updater` remains entirely true.
 *
 * The distinction is the whole point of this file, and it's not laziness: it's what
 * code signing allows and we don't have.
 *
 * ## Why there's no `electron-updater` here
 *
 * **On macOS it's impossible.** The Electron docs say it outright: "Your
 * application must be signed for automatic updates on macOS. This is a
 * requirement of Squirrel.Mac". Squirrel saves the *designated requirement* of
 * the running application (`SecCodeCopyDesignatedRequirement`) and validates the
 * downloaded package against it (`SecStaticCodeCheckValidityWithErrors`) before
 * swapping them. Without signing there's no requirement to save, and the builder
 * throws "Could not get code signature for running application".
 *
 * `electron-builder.yml` says `identity: null` by the owner's decision on August 12,
 * 2026, and the packager shouts it out ("skipped macOS code signing, identity
 * explicitly is set to null"). It's not a missing tuning; it's the machinery refusing.
 * And it refuses LATE: `electron-updater` only calls `setFeedURL` after downloading
 * the entire ZIP, so what you'd see is a full download followed by an error.
 *
 * **On Windows it would be possible, and it's worse.** `electron-updater` with NSIS
 * runs unsigned, and the signature verification it has **turns itself off**: `verifySignature`
 * compares the downloaded file's certificate against the `publisherName` from
 * `app-update.yml`, and in an unsigned package there's no certificate to get that
 * name from: the field isn't written, and the function returns `null` without checking
 * anything. OPEN failure, intentional and documented.
 *
 * What's left is the SHA-512 in `latest.yml`, served by the SAME server the
 * installer comes from. That's not origin verification: it's a checksum to guarantee
 * the download didn't corrupt midway. Whoever got write access to `orwell.pt` would
 * rewrite the installer, the checksum, and the version number, and from then on everyone
 * opening the app would execute what he wrote, silently, without a click, and with
 * elevation if the installation is for the whole machine.
 *
 * It would be the worst flaw this product could have, worse than everything encryption
 * protects. MLS protects conversations from a compromised server; an updater like
 * this would hand it the entire machine, and with it the vault and keys. A product whose
 * argument is "the server learns as little as possible" cannot have a path where the
 * server makes code execute.
 *
 * Today, without this, a compromised server can serve an altered installer, but someone
 * has to go fetch it, get past SmartScreen or System Settings, and has the published
 * checksum next to it to verify. It's little. It's more than zero, and it's reversible;
 * the other path isn't.
 *
 * **What would unlock real automatic updates:** an Apple Developer ID (99 USD/year,
 * notarization included) for macOS, and a Windows signing certificate. With both, the
 * trust anchor stops being the web server and becomes a key he doesn't have: on macOS
 * the altered package doesn't satisfy the *designated requirement*, on Windows the
 * `publisherName` no longer matches and `electron-updater` refuses with
 * `ERR_UPDATER_INVALID_SIGNATURE`. That's it, and only that, that separates "someone
 * controls our server" from "someone controls everyone's machines".
 *
 * And there are still two packing steps that don't exist today: `publish` is set to
 * `null`, and without it `electron-builder` **doesn't generate** `latest.yml` or
 * `app-update.yml`; and auto-update on macOS requires a `zip` target, when
 * `electron-builder.yml` only produces `dmg`.
 *
 * Without any of this, warning is the furthest you can honestly go.
 *
 * ## What this file does, then
 *
 * A GET to a static manifest, compares two numbers, returns a warning or nothing.
 * **It downloads nothing. It executes nothing. It writes nothing to disk.** The only
 * gesture the interface offers next is to open the system browser at an address written
 * HERE BELOW, as a constant: never at an address from the response. See
 * `ENDERECO_DAS_DESCARGAS`.
 *
 * No `electron` in here, and that's why the file exists separate from `index.ts`.
 * The same as `sfu.ts`, `ecra.ts`, `canais.ts` and `link-preview.ts`. `fetch` and
 * the memory of what's already been dismissed are passed as parameters, so this can
 * be tested without opening a window and without network.
 *
 * ## Why the manifest, not `hello.ok`
 *
 * `hello.ok` already exists, the client already talks to the server, and it wouldn't
 * cost a new request. It was weighed, and it lost for three reasons:
 *
 *  1. **It answers a different question.** `hello.ok` says what the HOMESERVER is
 *     running. What's old is the INSTALLER published on orwell.pt, and
 *     `docs/PUBLICAR-A-APP.md` makes clear the installer is the only thing that can
 *     fall behind. A server on 0.2.0 without a built installer would send everyone
 *     looking for a 0.1.0.
 *  2. **This is federated.** Everyone connects to the homeserver where their account
 *     lives, which might not be ours. A third-party server on 0.1.9 would tell this
 *     app it's ahead; one on 0.9.0 would send it looking for a version that doesn't
 *     exist to download anywhere.
 *  3. **It put the warning in the hands of the untrustworthy party.** The entire
 *     product is built on the server being untrustworthy for content. Letting it decide
 *     when "there's an update" appears gives it a lever for harassment, and if someday
 *     the address came with it, for phishing. The address doesn't come, but the lever
 *     would.
 *
 * What the manifest costs, stated whole: **one request to orwell.pt per startup**, which
 * tells this server that IP address has the app installed and what version. `hello.ok`
 * wouldn't cost that, and that's the only thing it won on. It's worth it because it's
 * once per startup, no cookies, no referrer, nothing logged on this side, and because
 * the alternative is a wrong answer given with confidence.
 */

/**
 * Where the published version is read from. Constant, never a parameter.
 *
 * Written here and not received from outside because it's the entire anchor:
 * the response can change a number and a checksum shown to someone, and nothing else.
 * It can't change where that person is sent or where the next read comes from.
 *
 * The file name must match `NOME_DO_MANIFESTO` in
 * `scripts/publicar-instaladores.mjs`, which is what writes it.
 */
export const ENDERECO_DA_VERSAO = "https://orwell.pt/transferencias/versao.json"

/**
 * The IPC channel names, in one place.
 *
 * For the same reason as `CANAIS_SFU` and `CANAIS_DE_CANAL`: this is a contract
 * between two processes, linked by a text string. Written twice, a swapped letter
 * gives no compile error: it gives an `invoke` with no handler on the other side,
 * and what you see is a button that does nothing, or a warning that never appears.
 */
export const CANAIS_DE_ACTUALIZACAO = {
  verificar: "actualizacao:verificar",
  dispensar: "actualizacao:dispensar",
  abrir: "actualizacao:abrir",
  /** The outcome of startup auto-update (Windows). See
   *  `actualizacao-windows.ts`. */
  diagnostico: "actualizacao:diagnostico",
} as const

/** Where the interface sends whoever wants to update. Constant, for the same
 *  reason: it's our address, opened in the system browser, where the user sees
 *  where it is before downloading anything. */
export const ENDERECO_DAS_DESCARGAS = "https://orwell.pt/transferencias/"

/** This runs on startup, behind the back of whoever is logging in. Short, and
 *  failure is silent. */
const TIMEOUT_MS = 6000

/** A manifest is a few hundred bytes. Nothing bigger than this is a manifest. */
const MANIFESTO_MAX_BYTES = 16_384

/** What the interface needs to know to draw the warning. */
export interface AvisoDeActualizacao {
  /** The version this application is. */
  instalada: string
  /** The version that's published. It only gets here if it's greater. */
  disponivel: string
  /** The name given to the published version ("Statio"), if the manifest includes it. */
  nome?: string
  /**
   * The SHA-256 checksum of this system's file.
   *
   * Shows on screen because it's the only defense that exists unsigned, and because
   * anyone who sees it before downloading can verify it later. Absent when the manifest
   * doesn't include a file for this system, which is the case for Linux, not a target
   * today.
   */
  soma?: string
}

export interface PortasDaActualizacao {
  /** The version of this application. Comes from `package.json` via `app.getVersion()`. */
  instalada: string
  /** `process.platform`. Decides which checksums from the manifest matter. */
  sistema: string
  /** The version the user has dismissed, or `null`. See `dispensar`. */
  dispensada: string | null
  buscar?: typeof fetch
  timeoutMs?: number
}

/**
 * System names as the manifest writes them.
 *
 * The manifest is written by `scripts/instaladores.mjs` based on file extension
 * (`.dmg` is macOS, `.exe` is Windows), not `process.platform`. Two ways of saying
 * the same thing, so the mapping lives in one place.
 */
const SISTEMA_NO_MANIFESTO: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
}

/**
 * Is `a` newer than `b`?
 *
 * Component-by-component numeric comparison, the only way that works: `"0.10.0" >
 * "0.9.0"` is false as text and true as a version, and the day the minor reached 10
 * was the day everyone stopped getting notified, silently.
 *
 * A missing component reads as zero, `"0.2"` against `"0.2.0"` is equal, but in
 * practice nothing gets here without three: the validator requires them.
 */
export function maisRecente(a: string, b: string): boolean {
  const parte = (versao: string, i: number): number => Number(versao.split(".")[i] ?? 0)
  for (let i = 0; i < 3; i++) {
    const esquerda = parte(a, i)
    const direita = parte(b, i)
    if (esquerda !== direita) return esquerda > direita
  }
  return false
}

/** Three numbers separated by dots, and nothing else. Everything else is rejected. */
const VERSAO = /^\d+\.\d+\.\d+$/
/** A SHA-256 in hexadecimal. */
const SOMA = /^[0-9a-f]{64}$/

/**
 * The manifest, validated before it's worth anything.
 *
 * Nothing here originates internally: it comes over HTTPS from a server that
 * could be compromised or just serving a completely different file. What comes
 * out of here is a version-shaped number and a checksum-shaped sum, or
 * nothing.
 *
 * Silent on purpose: a corrupted manifest isn't an error to show anyone. It's
 * indistinguishable from no update available, and that's how it reads.
 */
function lerManifesto(cru: unknown, sistema: string): { versao: string; nome?: string; soma?: string } | null {
  if (!cru || typeof cru !== "object") return null
  const dados = cru as { versao?: unknown; nome?: unknown; ficheiros?: unknown }

  if (typeof dados.versao !== "string" || !VERSAO.test(dados.versao)) return null

  const nome = typeof dados.nome === "string" && dados.nome.length <= 40 ? dados.nome : undefined

  let soma: string | undefined
  const procurado = SISTEMA_NO_MANIFESTO[sistema]
  if (procurado && Array.isArray(dados.ficheiros)) {
    for (const entrada of dados.ficheiros) {
      if (!entrada || typeof entrada !== "object") continue
      const ficheiro = entrada as { sistema?: unknown; soma?: unknown }
      if (ficheiro.sistema !== procurado) continue
      if (typeof ficheiro.soma === "string" && SOMA.test(ficheiro.soma)) soma = ficheiro.soma
      break
    }
  }

  return { versao: dados.versao, ...(nome ? { nome } : {}), ...(soma ? { soma } : {}) }
}

/**
 * Is there a new version? Returns the notice, or nothing.
 *
 * **Never throws.** No network, server down, file corrupted, or certificate
 * rejected: the answer is `null`, same as everything being up to date. An update
 * notice that breaks startup is worse than no notice at all, and a chat app must
 * start offline.
 *
 * Three gates before returning anything, all three required:
 *
 *  1. the published version must be GREATER than the installed one. Equal doesn't
 *     notify, and less certainly doesn't, a server announcing an old version won't
 *     make anyone "update" backwards;
 *  2. the published version can't be the one already dismissed. This makes the
 *     notice appear once per version, not as an alarm every startup;
 *  3. it must have version shape. See `lerManifesto`.
 */
export async function verificarActualizacao(portas: PortasDaActualizacao): Promise<AvisoDeActualizacao | null> {
  const buscar = portas.buscar ?? fetch
  const controlo = new AbortController()
  const prazo = setTimeout(() => controlo.abort(), portas.timeoutMs ?? TIMEOUT_MS)

  try {
    const resposta = await buscar(ENDERECO_DA_VERSAO, {
      // No identity in this call: it's reading a public file, and there's no reason to
      // carry credentials or say where we're coming from.
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal: controlo.signal,
    })
    if (!resposta.ok) return null

    // A manifest is hundreds of bytes. This isn't an optimization: it's what prevents
    // a server from hanging startup with an infinite response.
    const declarado = Number(resposta.headers.get("content-length") ?? 0)
    if (declarado > MANIFESTO_MAX_BYTES) return null
    const texto = await resposta.text()
    if (texto.length > MANIFESTO_MAX_BYTES) return null

    const manifesto = lerManifesto(JSON.parse(texto), portas.sistema)
    if (!manifesto) return null

    if (!maisRecente(manifesto.versao, portas.instalada)) return null
    if (manifesto.versao === portas.dispensada) return null

    return {
      instalada: portas.instalada,
      disponivel: manifesto.versao,
      ...(manifesto.nome ? { nome: manifesto.nome } : {}),
      ...(manifesto.soma ? { soma: manifesto.soma } : {}),
    }
  } catch {
    // No network, server down, corrupt JSON, timeout. All the same to someone starting
    // the app: nothing to report.
    return null
  } finally {
    clearTimeout(prazo)
  }
}
