import {
  enviarRelato,
  mensagemAEnviar,
  origemDoServidorDe,
  podeSair,
  Session,
  Vault,
  type AlvoDaDenuncia,
  type DenunciaPreparada,
  type EscolhaDaDenuncia,
  type InvitePolicy,
  type PostExtras,
  type StoredProfile,
  type VideoAPublicar,
} from "@enclave/client-core"
import { ContasDoAparelho } from "@enclave/client-core/contas"
import { kindOf } from "@enclave/crypto"
// From the protocol, not the UI: this process loads no React, and
// `@enclave/ui` brings the entire tree behind it.
import {
  CAPACIDADE_REVOGACAO,
  MOTIVOS,
  NOTA_MAX,
  TYPING_TTL_MS,
  type MessageExtras,
  type Payload,
  type UserAddress,
} from "@enclave/protocol"
import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  session as electronSession,
  shell,
  systemPreferences,
} from "electron"
import { spawn } from "node:child_process"
import { constants as fsConstants, readFileSync, rmSync } from "node:fs"
import { access, readFile, rm, writeFile } from "node:fs/promises"
import { release } from "node:os"
import { dirname, join } from "node:path"
import { CANAIS_DE_ACTUALIZACAO, ENDERECO_DAS_DESCARGAS, verificarActualizacao } from "./actualizacao.js"
import {
  ARGUMENTOS_DO_INSTALADOR,
  ARGUMENTOS_DO_INSTALADOR_PARA_TODOS,
  arranqueComActualizacao,
  arranqueComDiagnostico,
  chavePublicaDe,
  dentroDosProgramas,
  lancarComAdministrador,
  lancarInstalador,
  lerDiagnosticoDoArranque,
  type EstadoDoEcra,
  type ResultadoDoArranque,
} from "./actualizacao-windows.js"
import { CHAVE_PUBLICA_DE_ACTUALIZACOES } from "./chave-de-actualizacoes.js"
import { codigoDoEstado, HTML_DO_ARRANQUE } from "./ecra-de-arranque.js"
import { CANAIS_DE_ATALHOS, DEFINICOES_DE_ACESSIBILIDADE, criarAtalhosGlobais } from "./atalhos.js"
import { montarBandeja, sanearAviso, type Bandeja } from "./bandeja.js"
import { ligarCanais, type RegistarLeitura, type Resposta } from "./canais.js"
import { embrulharErros } from "./envelope.js"
import {
  DEFINICOES_DE_GRAVACAO_DE_ECRA,
  escolhaDoEcra,
  PedidosDeEcra,
  permissaoDeEcra,
  reduzirFontes,
  somDoSistema,
  USAR_SELECTOR_DO_SISTEMA,
  type EscolhaDeEcra,
  type EstadoDaPermissao,
} from "./ecra.js"
import { preVisualizarLink } from "./link-preview.js"
import { enderecoParaAbrirFora } from "./links-externos.js"
import { ligarOverlayDeJogo } from "./overlay-janela.js"
import { ligarSfu, type RegistarPedido } from "./sfu.js"
import { DesktopVaultBackend, escreverInteiro } from "./vault-backend.js"
import { permissaoConcedida } from "./permissoes.js"

/**
 * Main process: window lifecycle, hardening, and the IPC surface.
 *
 * The session lives here, so the renderer never holds the identity key or any
 * MLS group state. The one exception is media: WebRTC exists only where there is
 * a DOM, so per-epoch SFrame keys do cross to the renderer. Those decrypt one
 * participant's audio for one epoch and nothing else.
 */

type Campos = Record<string, unknown>
const eObjecto = (valor: unknown): valor is Campos => typeof valor === "object" && valor !== null && !Array.isArray(valor)
const textoAte = (valor: unknown, tecto: number): string | null => (typeof valor === "string" && valor.length <= tecto ? valor : null)

/** The target of a report from the renderer, rebuilt field by field. `null` if the shape does not fit. */
function alvoDaDenunciaDe(valor: unknown): AlvoDaDenuncia | null {
  if (!eObjecto(valor)) return null
  const canal = textoAte(valor["canal"], 300)
  const pessoa = textoAte(valor["pessoa"], 300)
  if (canal === null || pessoa === null) return null
  const sala = valor["sala"] === undefined ? undefined : textoAte(valor["sala"], 64)
  if (sala === null) return null
  const mensagem = valor["mensagem"]
  let id: string | undefined
  if (mensagem !== undefined) {
    if (!eObjecto(mensagem)) return null
    const lido = textoAte(mensagem["id"], 64)
    if (lido === null) return null
    id = lido
  }
  return { canal, pessoa, ...(sala !== undefined ? { sala } : {}), ...(id !== undefined ? { mensagem: { id } } : {}) }
}

/**
 * The prepared report that comes back from the renderer. Shape only: what goes
 * inside (the items and authorship of each) the server verifies, and the report
 * seal carries only what is there.
 */
function denunciaPreparadaDe(valor: unknown): DenunciaPreparada | null {
  if (!eObjecto(valor)) return null
  if (textoAte(valor["canal"], 300) === null || textoAte(valor["denunciado"], 300) === null) return null
  if (!eObjecto(valor["alvo"]) || typeof valor["denunciada"] !== "number") return null
  if (!Array.isArray(valor["itens"]) || !Array.isArray(valor["itensDoFundador"])) return null
  if (![...valor["itens"], ...valor["itensDoFundador"]].every((item) => eObjecto(item) && eObjecto(item["item"]))) return null
  return valor as unknown as DenunciaPreparada
}

/** The form choice, rebuilt field by field. `null` if the shape does not fit. */
function escolhaDaDenunciaDe(valor: unknown): EscolhaDaDenuncia | null {
  if (!eObjecto(valor)) return null
  const motivo = (MOTIVOS as readonly unknown[]).includes(valor["motivo"]) ? (valor["motivo"] as EscolhaDaDenuncia["motivo"]) : null
  const nota = textoAte(valor["nota"], NOTA_MAX)
  if (motivo === null || nota === null || typeof valor["boaFe"] !== "boolean") return null
  const contacto = valor["contacto"]
  if (contacto === undefined) return { motivo, nota, boaFe: valor["boaFe"] }
  if (!eObjecto(contacto)) return null
  const nome = textoAte(contacto["nome"], 120)
  const email = textoAte(contacto["email"], 254)
  if (nome === null || email === null) return null
  return { motivo, nota, boaFe: valor["boaFe"], contacto: { nome, email } }
}

/**
 * The images and files of a post, from the UI shape (`inline`, `name`,
 * `mediaType`) to the protocol shape.
 *
 * The same translation as the browser host (`social.post` in
 * `apps/web/src/bridge.ts`), and it must match. Missing here until 26/10/2026:
 * `social:post` passed the UI shape as is, the schema rejected it for missing
 * `byteLength`, and a post with an image would not leave the installed app.
 * Attachments already in protocol shape (video) pass as is.
 */
function mediaDaPublicacao(extras: PostExtras | undefined): PostExtras {
  if (!extras) return {}
  const media = (extras.media ?? []).map((item) => {
    const daInterface = item as unknown as { inline?: string; name: string; mediaType: string; byteLength?: number }
    if (typeof daInterface.byteLength === "number") return item
    return {
      url: "",
      inline: daInterface.inline ?? "",
      key: "",
      nonce: "",
      digest: "",
      kind: kindOf(daInterface.mediaType),
      name: daInterface.name,
      mediaType: daInterface.mediaType,
      byteLength: (daInterface.inline ?? "").length,
    }
  })
  return { ...extras, media }
}

/*
  The accounts on this device (Switch account). Without `contas.json`, the device
  has only the main account, in the usual `vault.enc`. The vault opens on the
  active account; `contas:mudar` and `contas:acrescentar` lock and pass storage
  to another.
  */
const FICHEIRO_DAS_CONTAS = join(app.getPath("userData"), "contas.json")
const contas: ContasDoAparelho = new ContasDoAparelho({
  lerLista: () => {
    try {
      return readFileSync(FICHEIRO_DAS_CONTAS, "utf8")
    } catch {
      return null
    }
  },
  gravarLista: (texto) => {
    if (texto === null) rmSync(FICHEIRO_DAS_CONTAS, { force: true })
    else escreverInteiro(FICHEIRO_DAS_CONTAS, new TextEncoder().encode(texto))
  },
  estadoDaConta: async (id) => armazemDoCofre.estadoDaConta(id),
  largarConta: async (id) => armazemDoCofre.largarConta(id),
})
const armazemDoCofre: DesktopVaultBackend = new DesktopVaultBackend(app.getPath("userData"), contas.activa)
const vault = new Vault(armazemDoCofre)
// The version goes in both `hello` calls for the 1.0 server to verify. See `Session`.
const session = new Session(vault, { versaoDaApp: app.getVersion() })

/** Resolve a sibling bundle from `out/main`. See the note in `asset`. */
const asset = (...parts: string[]): string => join(__dirname, "..", ...parts)

/**
 * The update version that the user silenced.
 *
 * A file separate from the vault, with no encryption: this is not a secret, it's
 * a UI preference. Storing it in the vault would force the vault to be open
 * to know whether we can warn, and would put a product decision where keys
 * live.
 *
 * **That's what makes the warning happen once per version instead of at every
 * startup.** A warning that won't quiet down is one people learn to ignore.
 */
const FICHEIRO_DA_ACTUALIZACAO = join(app.getPath("userData"), "actualizacao.json")

/** The dismissed version, or `null`. A file that doesn't exist, can't be read,
 *  or is corrupted reads as "nothing was dismissed", failure leans toward
 *  warning more, which is the safe direction of the two. */
async function versaoDispensada(): Promise<string | null> {
  try {
    const guardado = JSON.parse(await readFile(FICHEIRO_DA_ACTUALIZACAO, "utf8")) as { dispensada?: unknown }
    return typeof guardado.dispensada === "string" ? guardado.dispensada : null
  } catch {
    return null
  }
}

/**
 * The outcome of the last auto update on startup (Windows).
 *
 * Written by the main process BEFORE the UI exists, and read by the UI after it
 * loads (`actualizacao:diagnostico`), which puts it in Send Report. Without this,
 * an update that fails on someone's Windows would fail silently forever: whoever
 * sees it fail is the startup screen, which has already closed by the time they
 * think to send a report.
 */
const FICHEIRO_DO_ARRANQUE = join(app.getPath("userData"), "actualizacao-windows.json")

/** The folder where the installer downloads. In the user's temp folder, not in
 *  `userData`: on Windows that's the roaming profile, and 100 MB there would
 *  follow the person to every domain machine. */
const PASTA_DA_ACTUALIZACAO = join(app.getPath("temp"), "orwell-actualizacao")

/**
 * Is the app installed per-user, so it can update without asking for admin?
 *
 * Two questions, and both matter. Being outside `Program Files` isn't enough:
 * an "all users" install might have gone elsewhere. And being able to write to
 * the folder isn't enough: `Program Files` might have loose permissions. In an
 * all-users install, the update asks UAC once, after the installer is downloaded
 * and verified (`instalarComAdministrador`).
 */
async function instaladaPorUtilizador(): Promise<boolean> {
  const pasta = dirname(app.getPath("exe"))
  if (dentroDosProgramas(pasta, process.env)) return false
  try {
    await access(pasta, fsConstants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * The startup screen and auto update. Windows only, packaged only.
 *
 * Returns `sair: true` when the verified installer has launched: the caller
 * closes the app, and the installer opens the new version (`--force-run`).
 * Also returns the screen, which stays open until the main window appears:
 * if it closed first, Windows would have no windows and `window-all-closed`
 * would close the app mid-startup.
 */
async function actualizarNoArranque(): Promise<{ sair: boolean; ecra: BrowserWindow | null }> {
  // Outside `correr`, for whoever calls destroy when the main window appears, and also if something throws after it opens.
  let ecra: BrowserWindow | null = null

  // Everything that can throw stays inside `correr`: an exception becomes `arranque-falhou`, and the outcome is saved anyway.
  const resultado: ResultadoDoArranque = await arranqueComDiagnostico(
    async () => {
      // The built-in one, and only that one. See `chave-de-actualizacoes.ts`. Read before opening the screen: if it broke, there would be no window.
      const chave = chavePublicaDe(CHAVE_PUBLICA_DE_ACTUALIZACOES)
      const { janela, mostrar } = abrirEcraDeArranque()
      ecra = janela
      return arranqueComActualizacao({
        instalada: app.getVersion(),
        chave,
        pasta: PASTA_DA_ACTUALIZACAO,
        mostrar,
        semAdministrador: instaladaPorUtilizador,
        // Downloaded by Node, not the browser, the file doesn't carry the "from Internet" mark, so SmartScreen doesn't block it. The defense is the Ed25519 signature, which has already passed by now.
        instalar: (caminho) => lancarInstalador(caminho, ARGUMENTOS_DO_INSTALADOR, spawn),
        // Program Files: the same installer with `/allusers`, through UAC. The PowerShell is the system one, by full path.
        instalarComAdministrador: (caminho) =>
          lancarComAdministrador(
            caminho,
            ARGUMENTOS_DO_INSTALADOR_PARA_TODOS,
            spawn,
            join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
          ),
      })
    },
    (registo) => writeFile(FICHEIRO_DO_ARRANQUE, `${JSON.stringify(registo)}\n`, "utf8"),
  )

  process.stderr.write(`[actualizacao-windows] ${resultado.codigo}${resultado.versao ? ` ${resultado.versao}` : ""}\n`)
  if (resultado.accao === "sair") return { sair: true, ecra }
  // The installer from a previous update, already run. Not needed.
  await rm(PASTA_DA_ACTUALIZACAO, { recursive: true, force: true }).catch(() => {})
  return { sair: false, ecra }
}

/** The small startup window, frameless and script-free. */
function abrirEcraDeArranque(): { janela: BrowserWindow; mostrar: (estado: EstadoDoEcra) => void } {
  const ecra = new BrowserWindow({
    title: "Orwell",
    width: 320,
    height: 400,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    center: true,
    show: false,
    backgroundColor: "#080c1a",
    webPreferences: {
      // Our page and script-free, and even so everything is locked down: the same hardening as the main window.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      spellcheck: false,
    },
  })
  ecra.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  ecra.webContents.on("will-navigate", (event) => event.preventDefault())
  ecra.once("ready-to-show", () => ecra.show())
  const carregado = ecra.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML_DO_ARRANQUE)}`).catch(() => {})

  // The bar updates at most ten times a second: a 100 MB download is thousands of chunks, and one `executeJavaScript` per chunk just burned CPU.
  let ultimaPintura = 0
  const mostrar = (estado: EstadoDoEcra): void => {
    const agora = Date.now()
    if (estado.fase === "a-descarregar" && estado.recebidos < estado.total && agora - ultimaPintura < 100) return
    ultimaPintura = agora
    void carregado
      .then(() => (ecra.isDestroyed() ? undefined : ecra.webContents.executeJavaScript(codigoDoEstado(estado))))
      .catch(() => {})
  }
  return { janela: ecra, mostrar }
}

/**
 * Telemetry, off at the earliest possible moment.
 *
 * Chromium phones home for variations seeds, crash reports, domain reliability
 * and safe-browsing lookups. On an app whose premise is that nobody watches you,
 * a background request to a third party is a contradiction, so these go off
 * before the app is ready rather than being configured afterwards.
 */
app.commandLine.appendSwitch("disable-features", "MediaRouter,OptimizationHints,Translate,AutofillServerCommunication")
app.commandLine.appendSwitch("disable-domain-reliability")
app.commandLine.appendSwitch("disable-background-networking")
app.commandLine.appendSwitch("no-pings")
app.commandLine.appendSwitch("disable-breakpad")

function createWindow(): BrowserWindow {
  // The default menu carries a devtools entry and navigation commands the app
  // has no use for. Removing it also removes the accelerators.
  Menu.setApplicationMenu(null)

  const window = new BrowserWindow({
    title: "Orwell",
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    backgroundColor: "#080c1a",
    show: false,
    webPreferences: {
      preload: asset("preload", "index.cjs"),
      // The renderer displays content other people wrote. It gets no Node, no module access, and a full OS sandbox.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      /**
       * `backgroundThrottling` stays at the default, and that's a deliberate choice.
       *
       * The temptation is to turn it off so the hidden window doesn't slow down. It's
       * expensive: with it off, Chromium marks the page as visible to keep from
       * throttling it, so `document.hidden` becomes false and `document.hasFocus()`
       * is true with the window hidden. Who asks "is someone looking at this?",  * the system notification and arrival sound, starts saying always yes, and
       * shuts up exactly when it should speak. Measured: without this, a message
       * arriving from a hidden window is delivered and rendered anyway, because this
       * path is driven by IPC, not timers, which is what throttling delays.
       */
    },
  })

  /**
   * Closing the window hides it; doesn't kill the process.
   *
   * That's what makes it possible to notify with the app "closed" without giving
   * anyone the schedule of our chats: the connection never drops, the keys stay
   * here, and the message is decrypted in this process as it always was.
   *
   * Quit still exists and is an explicit gesture: Quit from the menu bar, the
   * dock item on macOS, or ending the session, all go through `app.quit()` and
   * it's what raises `aSair`. No keyboard shortcut though: the app menu was
   * removed above, and the keyboard shortcuts with it.
   */
  window.on("close", (event) => {
    if (aSair) return
    event.preventDefault()
    window.hide()
  })

  window.once("ready-to-show", () => {
    window.show()
    // Devtools only under an explicit opt-in, and never from a menu entry: a
    // shipped app should not offer a keystroke to a console that can read the
    // decrypted timeline.
    if (process.env.ENCLAVE_TRACE) window.webContents.openDevTools({ mode: "bottom" })
  })

  // A renderer that fails to load otherwise leaves a running process and no
  // window, which is indistinguishable from a hang.
  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    process.stderr.write(`renderer failed to load: ${code} ${description} (${url})\n`)
    window.show()
  })
  window.webContents.on("preload-error", (_event, path, error) => {
    process.stderr.write(`preload failed at ${path}: ${error.message}\n`)
  })
  window.webContents.on("console-message", (details) => {
    process.stderr.write(`[renderer:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})\n`)
  })

  // Any attempt to navigate away, or to open a window, is a bug or an attack.
  // Links go to the system browser, where the user can see where they lead.
  // Only web links: see `links-externos.ts`. The YouTube thumbnail takes this
  // path since 2 November 2026; nothing opens inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    const destino = enderecoParaAbrirFora(url)
    if (destino) void shell.openExternal(destino)
    return { action: "deny" }
  })
  /*
    The only navigation that passes is the page reloading itself (same URL):
    Switch Account reloads the UI to open the active account from scratch. Without
    this exception `location.reload()` is refused here silently, and the UI stays
    on the account we switched from.
  */
  window.webContents.on("will-navigate", (event, url) => {
    if (url === window.webContents.getURL()) return
    event.preventDefault()
  })

  /*
    The UI guards against exit with a `beforeunload` when there are messages
    waiting for connection (see `useOutbox`). In the browser, the browser asks; in
    Electron nobody asks, and `beforeunload` canceled Quit silently: the window
    stayed without saying why. We ask here.

    Text is fixed in Portuguese: this process doesn't load the UI catalog.

    `preventDefault` on this event means "ignore beforeunload and quit". Staying
    undoes `aSair`, so the next window close hides it again instead of closing
    mid-exit that never happened.
  */
  window.webContents.on("will-prevent-unload", (event) => {
    const escolha = dialog.showMessageBoxSync(window, {
      type: "question",
      buttons: ["Sair na mesma", "Ficar"],
      defaultId: 1,
      cancelId: 1,
      message: "Há mensagens por enviar. Sair na mesma?",
      detail: "As mensagens à espera de ligação perdem-se ao sair.",
    })
    if (escolha === 0) event.preventDefault()
    else aSair = false
  })

  return window
}

function hardenSession(): void {
  const partition = electronSession.defaultSession

  /**
   * Deny every permission except the ones a live call genuinely needs.
   *
   * Discord asks once for the microphone and keeps it. Here nothing is implicit:
   * media is granted only while a call is in progress, and revoked the moment it
   * ends, so "is my microphone live" has an answer the user chose.
   *
   * `display-capture` came with screen sharing and goes through the SAME gate with
   * the same condition: outside a call there's no screen to capture. Chromium asks
   * this permission before reaching `setDisplayMediaRequestHandler`, without it
   * in the list, the request dies before the picker opens, and on the renderer
   * side you see a `NotAllowedError` indistinguishable from clicking cancel.
   */
  // Rules are in `permissoes.ts`: media only during calls; clipboard write always (Copy buttons); everything else never.
  partition.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permissaoConcedida(permission, callInProgress))
  })
  partition.setPermissionCheckHandler((_contents, permission) => permissaoConcedida(permission, callInProgress))

  /**
   * Who handles the renderer's `getDisplayMedia`.
   *
   * Without this, `getDisplayMedia` inside Electron **rejects**, rejecting with
   * `NotAllowedError`, which is what the kernel reads as "clicked cancel", and
   * treats silently on purpose. The result would be a share button that does
   * absolutely nothing in the packaged app, with no error anywhere. In the browser
   * this handler doesn't exist because Chrome brings its own picker; here the
   * picker is ours.
   *
   * The choice belongs to whoever's looking at the screen and lives in the UI:
   * the request stays pending, the UI asks for sources (`ecra:fontes`), and
   * responds via `ecra:escolher`. See `ecra.ts`.
   *
   * A call that's not running doesn't reach here, the gate above already refused
   * it, but the guard repeats anyway: they're two Chromium mechanisms and one
   * might change behavior between versions.
   */
  partition.setDisplayMediaRequestHandler((_pedido, callback) => {
    if (!callInProgress || !janelaPrincipal) {
      // `{}` not an exception: an object with no `video` is how to deny without leaving the request hanging on the Chromium side.
      callback({})
      return
    }

    const id = pedidosDeEcra.abrir((fonte) => {
      clearTimeout(prazo)
      if (!fonte) {
        callback({})
        return
      }
      /*
        System audio always goes through whenever the system has it, no checkbox,
        no asking (owner's order, November 2, 2026: "audio is always shared by
        default"). See `somDoSistema` (Windows always, macOS 14.2+ with permission,
        no others) and `escolhaDoEcra`. Where it's not available, sharing goes silent
        and the call says so (error 441).

        Electron 43 has no way to remove the app's own audio from the `loopback`
        (neither in `desktopCapturer` nor in this handler). The `restrictOwnAudio` in
        the request is the right ask, and the picker warns whoever checks the box
        that the call's voice might be in there.
      */
      callback(escolhaDoEcra(fonte, somDoSistema(process.platform, release())))
    })

    /**
     * A request never hangs forever.
     *
     * The `callback` MUST be called: a `getDisplayMedia` with no response doesn't
     * resolve or reject, and on the clicker's side a button keeps thinking until
     * the app closes. That happens if the window reloads mid-pick, if the renderer
     * crashes, and **today it always happens where the system picker doesn't
     * exist**, because the app's picker hasn't been written yet (see
     * `docs/PENDENTES.md`).
     *
     * Deny is the right way out when you don't know: the kernel reads the refusal
     * as "clicked cancel", which is silent and reversible, instead of leaving the
     * UI in a state only a restart fixes.
     */
    const prazo = setTimeout(() => pedidosDeEcra.responder(id, null), PRAZO_DA_ESCOLHA_MS)

    janelaPrincipal.webContents.send("event:ecra-pedido", { id })
  },
  /** The SYSTEM picker, disabled. See `USAR_SELECTOR_DO_SISTEMA`: on macOS 15+ it skipped this handler, and sharing went silent with no warning. */
  { useSystemPicker: USAR_SELECTOR_DO_SISTEMA })

  /**
   * A content security policy strict enough that the renderer cannot reach the
   * network. Everything it displays arrived over IPC, already decrypted and
   * validated — so a malicious message has nowhere to call out to even if it
   * somehow executes.
   */
  partition.webRequest.onHeadersReceived((details, callback) => {
    // Dev only: the Vite react plugin injects an inline refresh preamble. The
    // web host gets away with it because its CSP lives in a <meta> tag, which
    // only governs markup after itself; this one is a response header and
    // governs the whole document, so strict script-src kills the dev renderer.
    //
    // `'wasm-unsafe-eval'` allows WebAssembly compilation and nothing else (no
    // `eval`, no `new Function`): it's the voice chain's noise reduction model,
    // `gtcrn.wasm`, which runs on the AudioWorklet. The same keyword is in
    // `renderer/index.html`'s `<meta>`, which is the policy that applies at
    // `file://`. See `packages/client-core/src/audio/README.md` and
    // `scripts/audio-electron.mjs`.
    const scriptSrc = process.env.ELECTRON_RENDERER_URL
      ? "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'"
      : "script-src 'self' 'wasm-unsafe-eval'"
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          [
            "default-src 'self'",
            scriptSrc,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "media-src 'self' blob:",
            "font-src 'self'",
            "connect-src 'self'",
            /**
             * Nothing embeds. Between August 12 and November 2, 2026 it was
             * `https://www.youtube-nocookie.com`, for the YouTube player. The player is
             * gone: the thumbnail opens the video in the system browser (see
             * `links-externos.ts` and `LinkPreview`).
             */
            "frame-src 'none'",
            "form-action 'none'",
            "frame-ancestors 'none'",
            "object-src 'none'",
            "base-uri 'none'",
          ].join("; "),
        ],
      },
    })
  })

  /**
   * The hard brake: nothing leaves the renderer session.
   *
   * Belt and suspenders on top of the policy above: even if a directive is
   * loosened by mistake, nothing gets out. STUN and peer connections don't go
   * through here; WebRTC has its own transport.
   *
   * Until November 2, 2026 there was a port, for the embedded YouTube player.
   * It's gone with it: see `podeSair` in `@enclave/client-core`.
   *
   * The Vite dev server only passes if the app is bundled AND the electron-vite
   * env var is set. In the packaged app, no `localhost` passes.
   */
  const origemDeDesenvolvimento = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
  partition.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => {
    callback({ cancel: !podeSair(details.url, origemDeDesenvolvimento) })
  })
}

/** Gates the media permission handlers above. */
let callInProgress = false

/**
 * The window, for `setDisplayMediaRequestHandler` to reach.
 *
 * `hardenSession()` runs BEFORE the window exists, it's the right order,
 * because the security policy has to be in place before anything loads. The
 * handler is registered then and only fires much later, so it reads the window
 * when it needs it instead of receiving it as a parameter.
 */
let janelaPrincipal: BrowserWindow | null = null

/** Pushes to the renderer if the session still writes. See `session:escreve` in the preload. */
export function avisarEscrita(escreve: boolean): void {
  janelaPrincipal?.webContents.send("session:escreve", escreve)
}

/** Screen-sharing requests waiting for someone to pick. See `ecra.ts`. */
const pedidosDeEcra = new PedidosDeEcra()

/**
 * How long a sharing request waits for a pick before giving up.
 *
 * Long: on the other end is a person looking at a list of windows, and a short
 * timeout would snatch the picker from their hands mid-pick. Short enough that
 * a crashed renderer doesn't leave the request hanging until session end.
 */
const PRAZO_DA_ESCOLHA_MS = 120_000

/**
 * Quit for real has been requested.
 *
 * Without this, hiding the window when closing would make the app impossible to
 * quit: `app.quit()`'s `close` is the same as the window button's `close`.
 */
let aSair = false

/** The system tray presence. It exists between `whenReady` and quit. */
let bandeja: Bandeja | null = null

function registerIpc(window: BrowserWindow): void {
  // Every handler is a narrow, named operation. There is deliberately no generic
  // "run this in the main process" bridge.

  /**
   * Register a request, with the error wrapped.
   *
   * ALL requests go through here, and it fixes Error 900: an `ipcMain.handle`
   * that lets the exception bubble raw, which delivers to the renderer
   * `Error invoking remote method '…': Error: wrong passphrase`, and that phrase
   * isn't in the error catalog. See `envelope.ts`.
   */
  const tratar = <A extends unknown[], R>(
    nome: string,
    fazer: (evento: Electron.IpcMainInvokeEvent, ...argumentos: A) => R,
  ): void => {
    ipcMain.handle(nome, embrulharErros(fazer as (...quaisquer: unknown[]) => R))
  }

  /*
    The SYSTEM languages, which the renderer doesn't know.

    `navigator.languages` inside Electron returns the locale the app started with,
    and on macOS that's often just "en-US" even though the whole system is in
    Portuguese: the user's list is in System Preferences, not Chromium.
    `app.getPreferredSystemLanguages()` reads it for real, and that's why this
    port exists instead of the packaged app sticking with what the browser tells
    it.

    Synchronous, and it's the same reason `canais.ts` reads synchronously: this
    is read ONCE, at startup, before the first render. A promise would force
    drawing first in one language and switching after, which is a flicker
    nobody asked for.
  */
  ipcMain.on("lingua:sistema", (event) => {
    try {
      event.returnValue = app.getPreferredSystemLanguages()
    } catch {
      // An Electron version without this read, or a system that
      // doesn't respond. The renderer treats the empty list as "don't know" and
      // falls back to `navigator`, the browser's response, better than nothing.
      event.returnValue = []
    }
  })
  /*
    The update: warn, never update.
    
    Without code signing there is no trustworthy updater, the full reason,
    with what signing would unlock, lives in the header of `actualizacao.ts`.
    What exists here are three narrow gates, and their shape is security:
    
    - `verificar` takes no address. It reads what's in `actualizacao.ts`,
    nowhere else.
    - `abrir` TAKES NO ARGUMENTS. Opens Orwell's download page in the system
    browser, that's all. If it took an address, the renderer, the untrusted
    part of this app, could open anything, and the update warning becomes
    the phishing door it exists not to be.
    - `dispensar` stores a number, nothing else.
    
    Nothing here downloads a file, nothing here runs one.
    
    The privacy cost, stated in full because this process kills Chromium's
    telemetry at startup: `verificar` is ONE request to orwell.pt per startup,
    which tells that server this IP has the app installed and what version.
    It's to our server, not a third party, no credentials and no referrer, and
    it's not logged here.
    */
  tratar(CANAIS_DE_ACTUALIZACAO.verificar, async () =>
    verificarActualizacao({
      instalada: app.getVersion(),
      sistema: process.platform,
      dispensada: await versaoDispensada(),
    }),
  )

  tratar(CANAIS_DE_ACTUALIZACAO.dispensar, async (_event, versao: string) => {
    // Validated on this side, not the other: the renderer is the untrusted part, and
    // whatever it sent went straight to disk.
    if (typeof versao !== "string" || !/^\d+\.\d+\.\d+$/.test(versao)) return { ok: false }
    try {
      await writeFile(FICHEIRO_DA_ACTUALIZACAO, `${JSON.stringify({ dispensada: versao })}\n`, "utf8")
      return { ok: true }
    } catch {
      // Disk full or folder without permissions. The warning returns on the next startup,
      // which is annoying but not serious.
      return { ok: false }
    }
  })

  /*
    The outcome of this startup's auto-update, for "Send
    report". Read-only, no arguments, and validated before leaving here:
    The file is ours, but a corrupted disk shouldn't reach the UI.
  */
  tratar(CANAIS_DE_ACTUALIZACAO.diagnostico, async () => {
    try {
      return lerDiagnosticoDoArranque(JSON.parse(await readFile(FICHEIRO_DO_ARRANQUE, "utf8")))
    } catch {
      return null
    }
  })

  tratar(CANAIS_DE_ACTUALIZACAO.abrir, async () => {
    await shell.openExternal(ENDERECO_DAS_DESCARGAS)
    return { ok: true }
  })

  /*
    "Switch account". `contas:mudar` and `contas:acrescentar` only change the list:
    the open account stays up until the renderer reloads, so the still-drawn UI
    doesn't ask for an identity that no longer exists. The real switch
    (disconnect, drop, lock without forgetting the saved session, and pass
    the vault to the active account) happens when the renderer navigates, or at
    latest on the first gate request.
  */
  const nomeDaContaAberta = (): string | undefined =>
    vault.unlocked && !vault.provisorio ? vault.contents.profile.displayName : undefined
  let mudancaDeContaPendente = false
  const aplicarMudancaDeConta = (): void => {
    if (!mudancaDeContaPendente) return
    mudancaDeContaPendente = false
    session.disconnect()
    session.reset()
    vault.lock()
    bandeja?.aoTrancar()
    armazemDoCofre.usarConta(contas.activa)
  }
  window.webContents.on("did-start-navigation", (detalhes) => {
    if (detalhes.isMainFrame && !detalhes.isSameDocument) aplicarMudancaDeConta()
  })

  // Header only: a beta vault is never decrypted. See `Vault.estado`.
  tratar("vault:status", () => {
    aplicarMudancaDeConta()
    return vault.estado()
  })

  tratar("vault:create", async (_event, passphrase: string | null) => {
    aplicarMudancaDeConta()
    await vault.create(passphrase)
    return { ok: true }
  })

  // The pairing vault that replaces this device's account: in
  // memory until `pairing:done`. See `Vault.criarProvisorio`.
  // The "Copy" buttons in the UI (`lib/copiar.ts`): through the main process's
  // `clipboard`, which doesn't depend on permissions or window focus.
  // Write-only; reading the clipboard is never exposed.
  /*
    Global hotkeys (mute and unmute with the window hidden). The
    decision lives in `atalhos.ts`; here we only wire the real gates. Registered
    only during a call: the UI asks for them on entry and drops them on exit.
  */
  const atalhos = criarAtalhosGlobais({
    porta: globalShortcut,
    plataforma: process.platform,
    // `false`: ask without opening the system dialog. The dialog opens only
    // when the user clicks the button (`atalhos:abrir-acessibilidade`).
    temAcessibilidade: () => process.platform !== "darwin" || systemPreferences.isTrustedAccessibilityClient(false),
    aoAccionar: (accao) => {
      if (!window.isDestroyed()) window.webContents.send(CANAIS_DE_ATALHOS.accionado, accao)
    },
  })
  tratar(CANAIS_DE_ATALHOS.definir, (_event, pedido: unknown) => atalhos.definir(pedido))
  tratar(CANAIS_DE_ATALHOS.suspender, (_event, sim: unknown) => {
    atalhos.suspender(sim === true)
    return { ok: true }
  })
  tratar(CANAIS_DE_ATALHOS.abrirAcessibilidade, async () => {
    if (process.platform !== "darwin") return { ok: false }
    await shell.openExternal(DEFINICOES_DE_ACESSIBILIDADE)
    return { ok: true }
  })
  /*
    A renderer that crashes or reloads is no longer in the call that requested the
    hotkeys, and won't come back to say `definir(null)`. Without this the key would stay
    stolen from other apps until the app closes.
  */
  window.webContents.on("render-process-gone", () => atalhos.libertar())
  window.webContents.on("did-start-navigation", (detalhes) => {
    if (detalhes.isMainFrame && !detalhes.isSameDocument) atalhos.libertar()
  })
  app.on("will-quit", () => atalhos.libertar())

  tratar("clipboard:write", async (_event, texto: unknown) => {
    if (typeof texto !== "string" || texto.length > 100_000) throw new Error("clipboard text is invalid")
    clipboard.writeText(texto)
    return { ok: true }
  })

  tratar("vault:createProvisional", async (_event, passphrase: string | null) => {
    await vault.criarProvisorio(passphrase)
    return { ok: true }
  })

  tratar("vault:unlock", async (_event, passphrase: string | null) => {
    aplicarMudancaDeConta()
    // The silent attempt: an `os` vault opens via keychain, and a password
    // vault opens via the saved session, if there is one (F1). An `os` vault
    // never has memory, so the order between the two doesn't show.
    if (passphrase === null && (await vault.abrirMemorizada())) return { ok: true }
    await vault.unlock(passphrase ?? undefined)
    return { ok: true }
  })

  // F3: an `os` vault gains a password. See `Vault.definirPalavraPasse`.
  tratar("vault:definir-palavra-passe", async (_event, frase: unknown) => {
    if (typeof frase !== "string" || frase.length === 0) throw new Error("this vault needs a passphrase")
    await vault.definirPalavraPasse(frase)
    return { ok: true }
  })

  tratar("vault:memorizar", async (_event, ligar: unknown) => {
    if (ligar === true) await vault.memorizar()
    else await vault.esquecerSessao()
    return { ok: true }
  })

  // Locking is more than dropping the vault key: the session holds live MLS
  // group state in this process, so it is disconnected and reset first.
  // "Sign out" forgets the saved session BEFORE locking (F1).
  tratar("vault:lock", async () => {
    await vault.esquecerSessao().catch(() => {})
    session.disconnect()
    session.reset()
    vault.lock()
    // The unread count is knowledge of what arrived, and dies with the keys:
    // leaving it in the icon tells anyone looking at a locked app's
    // screen how many conversations happened while away.
    bandeja?.aoTrancar()
    return { ok: true }
  })

  tratar("contas:listar", async () => ({ contas: await contas.listar(nomeDaContaAberta()) }))
  tratar("contas:mudar", async (_event, id: unknown) => {
    if (typeof id !== "string" || !contas.lista.contas.some((conta) => conta.id === id)) {
      throw new Error("there is no such account on this device")
    }
    await contas.mudar(id, nomeDaContaAberta())
    mudancaDeContaPendente = true
    return { ok: true }
  })
  tratar("contas:acrescentar", async () => {
    await contas.acrescentar(nomeDaContaAberta())
    mudancaDeContaPendente = true
    return { ok: true }
  })

  tratar("vault:export", async (_event, passphrase?: string) => ({
    data: new TextDecoder().decode(await vault.exportVault(passphrase)),
  }))

  tratar("vault:import", async (_event, data: string, passphrase: string) => {
    session.disconnect()
    session.reset()
    await vault.importVault(new TextEncoder().encode(data), passphrase)
    return { ok: true }
  })

  tratar("vault:destroy", async () => {
    // Exit channels BEFORE disconnecting, the only possible order: exit is an
    // encrypted message that must reach the server. If it fails, nothing
    // below runs and the account stays up, that's the decision, and it's
    // written in `Session.prepareAccountDeletion`.
    await session.prepareAccountDeletion()
    session.disconnect()
    session.reset()
    await vault.destroy()
    // With more than one account on the device, the deleted one leaves the list and
    // the vault passes to whichever account stays active. With just one, nothing changes.
    await contas.esquecerActiva()
    armazemDoCofre.usarConta(contas.activa)
    return { ok: true }
  })

  tratar("identity:create", async (_event, homeserver: string) => {
    const identity = await session.createIdentity(homeserver)
    return { address: identity.address, accountId: identity.accountId }
  })

  tratar("identity:load", () => {
    const identity = session.loadIdentity()
    return { address: identity.address, accountId: identity.accountId }
  })

  tratar("session:capabilities", () => session.serverCapabilities)

  // The pairing lives where the session lives. The renderer only sees phases.
  tratar("pairing:status", () => ({
    temChaveDeConta: session.temChaveDeConta,
    servidorSuporta: session.suportaEmparelhamento,
    servidorRevoga: session.serverCapabilities.includes(CAPACIDADE_REVOGACAO),
  }))
  tratar("pairing:host", () => session.emparelharComoAnfitriao())
  tratar("pairing:join", (_event, link: string) => {
    session.emparelharComoConvidado(link)
    return { ok: true }
  })
  tratar("pairing:confirm", async () => {
    await session.confirmarSas()
    return { ok: true }
  })
  tratar("pairing:refuse", () => {
    session.recusarSas()
    return { ok: true }
  })
  tratar("pairing:cancel", () => {
    session.cancelarEmparelhamento()
    if (vault.provisorio) {
      // The new account didn't stick: drop it via `vault:lock` order. The disk is unchanged.
      session.disconnect()
      session.reset()
      vault.descartarProvisorio()
    }
    return { ok: true }
  })
  tratar("pairing:done", async () => {
    // The temporary goes to disk BEFORE `pronto`: if it fails to write, bail, and
    // the device doesn't publish one that didn't land here.
    if (vault.provisorio) await vault.confirmarProvisorio()
    session.concluirEmparelhamento()
    return { ok: true }
  })
  tratar("pairing:devices", () => session.aparelhosDaConta())
  // "Join the other account" (phase 8.2). The order lives in the core: see `Session.juntarTrocar`.
  tratar("pairing:juntar", (_event, link: string) => {
    session.emparelharParaJuntar(link)
    return { ok: true }
  })
  tratar("pairing:juntar-avisar", async () => {
    await session.juntarAvisar()
    return { ok: true }
  })
  tratar("pairing:juntar-trocar", (_event, passphrase: string | null) => session.juntarTrocar(passphrase))
  tratar("pairing:juntar-cancelar", () => {
    session.cancelarJuntar()
    return { ok: true }
  })
  tratar("pairing:revoke", async (_event, deviceKey: string) => {
    await session.revokeDevice(deviceKey)
    return { ok: true }
  })

  // Sync between accounts (S5): state per channel, the first place, and
  // the bytes of an attachment on request. The core never bails on `pedirAnexo`.
  tratar("sincronia:estado", () => session.estadoDaSincronia())
  tratar("sincronia:lugar-em", (_event, channel: string) => session.lugarEm(channel))
  tratar("sincronia:historico", () => structuredClone(session.historicoEntreAparelhos()))
  tratar("anexo:pedir", (_event, id: { channel: string; alvo: string; indice: number }) =>
    session.pedirAnexo(String(id?.channel ?? ""), String(id?.alvo ?? ""), Number(id?.indice ?? -1)),
  )
  tratar("anexo:cancelar", (_event, id: { channel: string; alvo: string; indice: number }) =>
    session.cancelarAnexo(String(id?.channel ?? ""), String(id?.alvo ?? ""), Number(id?.indice ?? -1)),
  )

  // Video from posts. Bytes cross IPC as `Uint8Array`, which structured
  // clone copies as-is. See `videos.ts` in the core.
  tratar("video:publicar", async (_event, caption: string, tags: string[], extras: PostExtras, video: VideoAPublicar) => {
    const id = await session.publicarVideo(caption, tags, mediaDaPublicacao(extras), video)
    return { ok: true, id }
  })
  tratar("video:cancelar", () => session.cancelarEnvioDeVideo())
  tratar("video:estado", (_event, sha: string) => session.estadoDoVideo(String(sha)))
  tratar("video:bytes", (_event, sha: string) => session.bytesDoVideo(String(sha)))

  // Account state that travels between devices (phase 5). Shallow copies: the
  // core returns read-only maps, and IPC clones what it gets.
  tratar("estado:lidas", () => ({ ...session.lidas() }))
  tratar("estado:marcar-lido", async (_event, channel: string, at: number) => {
    await session.marcarLido(channel, at)
    return { ok: true }
  })
  tratar("estado:arquivo", () => ({ ...session.arquivo() }))
  tratar("estado:arquivar", async (_event, channel: string, at?: number) => {
    await session.arquivar(channel, at)
    return { ok: true }
  })
  tratar("estado:desarquivar", async (_event, channel: string) => {
    await session.desarquivar(channel)
    return { ok: true }
  })
  tratar("estado:preferencias", () => ({ ...session.preferencias() }))
  tratar("estado:definir-preferencia", async (_event, chave: string, valor: string, at?: number) => {
    await session.definirPreferencia(chave, valor, at)
    return { ok: true }
  })

  tratar("session:common-room", () => session.commonRoom)

  tratar("session:escolher-sala-comum", async (_event, entrar: boolean) => {
    await session.escolherSalaComum(entrar === true)
    return { ok: true }
  })

  tratar("session:set-visible", (_event, visible: boolean) => {
    session.setVisible(visible)
    return { ok: true }
  })

  // The round trip to the server is measured where the socket lives, in the main
  // process here: measuring it in the renderer would accidentally time the IPC.
  tratar("session:latency", () => session.measureLatency())
  // The half-open connection check, also where the socket lives. See `Session.verificarLigacao`.
  tratar("session:verificar-ligacao", () => session.verificarLigacao())

  /*
    If the session still writes: the renderer caches the answer and the main
    process PUSHES it when it changes (`session:escreve`). Not a synchronous
    question by design, on purpose: a `sendSync` on each keystroke would block
    the renderer while the main process wrote a big vault (up to 380 ms). Nobody
    here calls `pararDeEscrever` (one window, one vault), so the cache
    starts and stays "yes"; whoever stops writing on this side one day calls
    `avisarEscrita()` after.
  */

  tratar("session:connect", async () => {
    await session.connect()
    return { ok: true }
  })

  tratar("channel:list", () => session.channels)
  tratar("channel:archived", () => session.archivedChannels())

  tratar("channel:create", async (_event, channel: string, nome?: unknown) => {
    // See `createSpace` in the core: a channel is born with three rooms alongside
    // the default channel, which stays first. The name comes from the UI, and
    // anything that isn't text doesn't get past here.
    await session.createSpace(channel, undefined, typeof nome === "string" ? nome : undefined)
    return { ok: true }
  })

  tratar("channel:invite", async (_event, channel: string, address: string, note?: string) => {
    await session.invite(channel, address, note)
    return { ok: true }
  })

  /*
    `channel:may-expel` CHANGED SHAPE and now lives in `canais.ts`, on the sync reads
    side. It was a `handle`, and a `handle` returns a promise:
    the UI reads `mayExpel?.(canal) ?? false`, a promise is truthy, and the
    installed app offered to expel everyone. See the note there.
  */

  // Advances the epoch and drops the keys. The guard lives in the core and refuses
  // anyway; this just wires the UI gesture to whoever could already do it.
  tratar("channel:expel", async (_event, channel: string, address: string) => {
    await session.expel(channel, address as UserAddress)
    return { ok: true }
  })

  // Invites, and the two replies. See the "invites to a channel" section in
  // `session.ts`: inviting sends a message, and the seat is granted on accept.
  tratar("channel:invites", () => [...session.channelInvites().values()])

  tratar("channel:invite-accept", async (_event, dmChannel: string, target: string) => {
    await session.acceptChannelInvite(dmChannel, target)
    return { ok: true }
  })

  tratar("channel:invite-decline", async (_event, dmChannel: string, target: string) => {
    await session.declineChannelInvite(dmChannel, target)
    return { ok: true }
  })

  tratar(
    "channel:send",
    async (_event, channel: string, body: string, room?: string, extras?: MessageExtras) => {
      // The same function as the browser host, and it has to be: a
      // message, an image, a poll or a reply sent from the
      // computer and the browser must arrive identical to the same group.
      await session.send(channel, mensagemAEnviar(body, room, extras, { id: crypto.randomUUID(), sentAt: Date.now() }))
      return { ok: true }
    },
  )

  tratar("channel:typing", async (_event, channel: string, room?: string) => {
    // Ephemeral: the session cuts it before the vault and before the chat line.
    // The deadline is what clears the indicator on the other side without an end message.
    await session.send(channel, { t: "typing", ...(room ? { room } : {}), until: Date.now() + TYPING_TTL_MS })
    return { ok: true }
  })

  tratar("channel:buzz", async (_event, channel: string) => {
    // Ephemeral for the same reason as above, taken further: a saved buzz
    // would play on backfill, shaking the screen of whoever opened
    // the chat the next day, once for each one that landed there.
    await session.send(channel, { t: "buzz", at: Date.now() })
    return { ok: true }
  })

  tratar("channel:members", (_event, channel: string) => session.membersOf(channel))

  // Plaintext history crosses to the renderer the same way live messages do:
  // decrypted in the main process, never as ciphertext.
  tratar("channel:history", (_event, channel: string) => session.history(channel))

  tratar("channel:forget", async (_event, channel: string) => {
    await session.forgetChannel(channel)
    return { ok: true }
  })

  // Leave for real: publishes the exit to the group and waits for receipt. No connection,
  // bail, and the UI offers to forget on this device only.
  tratar("channel:leave", async (_event, channel: string) => {
    await session.leaveChannel(channel)
    return { ok: true }
  })


  tratar("channel:safety-number", (_event, channel: string, address: string) =>
    session.safetyNumberFor(channel, address),
  )

  // Short when the server gave short code; otherwise long. Same rule as the
  // browser bridge (`apps/web/src/bridge.ts`), 1.0 "Arca", slice 5b-2.
  tratar("invite:create", async (_event, channel: string, policy: InvitePolicy) => {
    const { longa, curta } = await session.criarConvite(channel, policy)
    return curta ?? longa
  })

  tratar("invite:redeem", async (_event, link: string) => {
    await session.redeemInvite(link)
    return { ok: true }
  })

  // Short link resolved to long. See `resolverConvite` in the core.
  tratar("invite:resolve", (_event, link: string) => session.resolverConvite(link))

  // The channel name, opened from the invite seal (1.0 "Arca", slice 5c). See `nomeDoConvite`.
  tratar("invite:nome", (_event, link: string) => session.nomeDoConvite(link))

  tratar("invite:list", (_event, channel: string) => session.listInvites(channel))

  tratar("invite:revoke", async (_event, codeHash: string) => {
    await session.revokeInvite(codeHash)
    return { ok: true }
  })

  tratar("social:post", async (_event, caption: string, tags: string[], extras?: PostExtras) => {
    await session.post(caption, tags, mediaDaPublicacao(extras))
    return { ok: true }
  })

  tratar("social:accept-follower", async (_event, address: string) => {
    await session.acceptFollower(address)
    return { ok: true }
  })

  tratar("social:feed-channel", () => session.feedChannel)

  tratar("social:edit", async (_event, id: string, caption: string) => {
    await session.editPost(id, caption)
    return { ok: true }
  })

  tratar("social:remove", async (_event, id: string) => {
    await session.deletePost(id)
    return { ok: true }
  })

  /**
   * Vote in a poll, in the chat or on the wall.
   *
   * Creating a poll has no gate of its own: it travels inside `channel:send`
   * or `social:post`, as an optional field. See `Poll` in the protocol.
   */
  tratar(
    "votacao:votar",
    async (_event, channel: string, target: string, opcao: number, retirar?: boolean) => {
      await session.voteOnPoll(channel, target, opcao, retirar)
      return { ok: true }
    },
  )

  tratar("social:react", async (_event, channel: string, target: string, emoji: string, remove?: boolean) => {
    await session.reactToPost(channel, target, emoji, remove)
    return { ok: true }
  })

  tratar("social:comment", async (_event, channel: string, target: string, body: string) => {
    await session.commentOnPost(channel, target, body)
    return { ok: true }
  })

  /**
   * Link preview, fetched by this process, not the homeserver.
   *
   * The work lives in `link-preview.ts`, no `electron` inside and with
   * `fetch` passed as a parameter: this makes measurable what this process
   * asks and from whom, and in what order, without opening a window. A
   * YouTube video has its own path, because once video preview became
   * automatic the generic path costs 256 KB to Google's cookie domain to
   * bring nothing.
   */
  tratar("social:link-preview", async (_event, url: string) => preVisualizarLink(url))

  /*
    "Send report" (Help and diagnostics). From here, not the renderer: the renderer's
    CSP only allows `'self'`, and the destination must be chosen on this
    side. The server is the open account's, and the version is this installation's;
    only the text comes from the renderer, validated here (it's the untrusted part).
  */
  tratar("relato:enviar", async (_event, pedido: { texto?: unknown }) => {
    const texto = typeof pedido?.texto === "string" ? pedido.texto.slice(0, 64 * 1024) : ""
    if (!texto) throw new Error("the server did not take the log")
    const endereco = session.identity.address
    return enviarRelato(origemDoServidorDe(endereco), { endereco, versao: app.getVersion(), texto })
  })

  /*
    Reports. Like telemetry: the server is from the open account and the version
    is from this installation, both decided here. The renderer sends only the
    target, the prepared report, and the choice, all verified in form (the
    untrusted part). The server verifies the rest: the authorship of each item
    and the body schema.
    */
  tratar("denuncia:preparar", async (_event, alvo: unknown) => {
    const lido = alvoDaDenunciaDe(alvo)
    if (!lido) throw new Error("this message cannot be reported")
    return session.prepararDenuncia(lido, origemDoServidorDe(session.identity.address))
  })
  tratar("denuncia:enviar", async (_event, preparada: unknown, escolha: unknown) => {
    const lida = denunciaPreparadaDe(preparada)
    const escolhida = escolhaDaDenunciaDe(escolha)
    if (!lida || !escolhida) throw new Error("the server did not take the report")
    return session.denunciar(lida, escolhida, origemDoServidorDe(session.identity.address), app.getVersion())
  })
  tratar("denuncia:lista", async (_event, canal: unknown) => (typeof canal === "string" ? session.denunciasDe(canal) : []))
  tratar("denuncia:porAbrir", async (_event, canal: unknown) => (typeof canal === "string" ? session.denunciasPorAbrir(canal) : 0))
  tratar("denuncia:marcarLida", async (_event, id: unknown) => {
    if (typeof id === "string") await session.marcarDenunciaLida(id)
  })
  // Suspension (Task 8): the server is from the open account, decided here. The
  // renderer sends only the note, verified in form; the server verifies the rest.
  tratar("denuncia:suspensao", async () => session.avisoDeSuspensao(origemDoServidorDe(session.identity.address)))
  tratar("denuncia:pedirRevisao", async (_event, nota: unknown) => {
    const texto = textoAte(nota, NOTA_MAX)
    if (texto === null || texto.trim() === "") throw new Error("the server did not take the review request")
    return session.pedirRevisao(texto, origemDoServidorDe(session.identity.address))
  })

  tratar("social:remove-comment", async (_event, channel: string, id: string) => {
    await session.deleteComment(channel, id)
    return { ok: true }
  })

  tratar("social:friend-request", async (_event, channel: string, note?: string) => {
    await session.sendFriendRequest(channel, note)
    return { ok: true }
  })

  tratar("social:accept-friend", async (_event, channel: string, address: string) => {
    await session.acceptFriend(channel, address)
    return { ok: true }
  })

  tratar("social:decline-friend", async (_event, channel: string) => {
    await session.declineFriend(channel)
    return { ok: true }
  })

  tratar("social:cancel-friend-request", async (_event, address: string) => {
    await session.cancelFriendRequest(address)
    return { ok: true }
  })

  tratar("social:block", async (_event, address: string) => {
    await session.block(address)
    return { ok: true }
  })

  tratar("social:unblock", async (_event, address: string) => {
    await session.unblock(address)
    return { ok: true }
  })

  tratar("social:blocked", () => session.blocked())
  tratar("social:friend-ties", () => [...session.friendTies().values()])
  tratar("social:sucessoes", () => session.sucessoes())
  tratar("social:marcar-sucessao", async (_event, de: string, feito: string) => {
    await session.marcarSucessao(de, feito)
    return { ok: true }
  })
  tratar("social:adicionar-sucessora", async (_event, de: string) => {
    await session.adicionarSucessora(de)
    return { ok: true }
  })
  tratar("social:convidar-sucessora", async (_event, de: string, channel: string) => {
    await session.convidarSucessora(de, channel)
    return { ok: true }
  })

  tratar("social:set-shown-friends", async (_event, list: string[]) => {
    await session.setShownFriends(list)
    return { ok: true }
  })

  tratar("social:shown-friends-of", (_event, address: string) => session.shownFriendsOf(address))

  tratar("social:sincronizar-agora", async () => {
    await session.sincronizarAgora()
    return { ok: true }
  })

  tratar("social:unfriend", async (_event, address: string) => {
    await session.unfriend(address)
    return { ok: true }
  })

  tratar("social:open-direct", (_event, address: string) => session.openDirect(address))

  tratar("social:repair-invite", async (_event, channel: string, address: string, force?: boolean) => {
    const outcome = await session.repairInvite(channel, address, force)
    return { invited: outcome === "invited" || outcome === "reseated", outcome }
  })

  tratar("social:dead-welcomes", () => session.deadWelcomeChannels())

  tratar("social:deaf-channels", () => session.deafChannels())

  tratar("social:sync-community", () => session.syncCommunity())

  tratar("social:resync-welcomes", async (_event, channel?: string) => {
    await session.resyncWelcomes(channel)
    return { ok: true }
  })

  // The frame that makes the publisher repost the latest 30. See
  // `pedirPublicacoes` in `packages/ui/src/bridge.ts`.
  tratar("social:pedir-publicacoes", (_event, channel: string) => {
    session.requestRejoin(channel)
    return { ok: true }
  })

  /**
   * Operating system notification, requested by the interface.
   *
   * The interface sends what it decided to show; this process decides whether it
   * can be displayed. The vault check is on this side intentionally: with the
   * vault closed, there is no key in this process, so nothing decrypted can
   * legitimately appear in a notification, and a request in that state can only
   * come from an error or a renderer that is no longer trusted. See
   * `montarBandeja`.
   */
  tratar("notify:show", (_event, cru: unknown) => {
    const aviso = sanearAviso(cru)
    if (!aviso) return { shown: false, reason: "invalido" }
    // No `??` on purpose: `avisar` returns `null` WHEN SUCCESSFUL, and a
    // `?? "sem-suporte"` would turn each success into a failure. The screen trusts
    // this response to know whether to save the click, and thus discarded it right
    // after showing the notification.
    if (!bandeja) return { shown: false, reason: "sem-bandeja" }
    const recusa = bandeja.avisar(aviso)
    return { shown: recusa === null, ...(recusa ? { reason: recusa } : {}) }
  })

  tratar("notifications:list", () => session.notificationsSnapshot())

  tratar("notifications:save", async (_event, entries: unknown) => {
    await session.saveNotifications(entries as never)
    return { ok: true }
  })

  tratar("profile:get", () => session.profile)

  tratar("profile:directory", () => session.directorySnapshot())

  tratar("profile:set", async (_event, profile: Omit<StoredProfile, "updatedAt">) => {
    await session.updateProfile(profile)
    return { ok: true }
  })

  tratar("identity:address", () => session.identity.address)

  /**
   * Voice signalling and media keys.
   *
   * The renderer can ask for signalling to be sent and for a media key, and
   * nothing else. `voice:key` returns 28 bytes scoped to one epoch and one
   * participant — it decrypts that person's media for that epoch, not the
   * channel's text and not any other epoch.
   */
  tratar("voice:signal", async (_event, channel: string, payload: Payload) => {
    await session.send(channel, payload)
    return { ok: true }
  })

  tratar("voice:key", async (_event, channel: string, address: string, folha?: unknown) => {
    // `folha` comes from the renderer, which is untrusted: only an integer passes.
    // The session then confirms that the sheet really belongs to this person.
    const key = await session.mediaKey(
      channel,
      address as UserAddress,
      typeof folha === "number" && Number.isInteger(folha) && folha >= 0 ? folha : undefined,
    )
    return key ? { keyId: key.keyId, senderId: key.senderId, material: key.material } : null
  })

  // The reserve lives in the vault, and the vault lives here: the renderer never touches it.
  tratar("voice:reservarContador", async (_event, channel: string, keyId: number) =>
    session.reservarContadorSframe(channel, keyId),
  )

  tratar("voice:ice", async () => session.iceServers())

  /**
   * The SFU path, which until now only the web had.
   *
   * Without this, the `Call` from the renderer always runs in a loop against
   * any server, and nothing breaks, which is what makes the missing piece
   * expensive to find. The decision of which engine to use still goes down to
   * `join`, and it's `CANAIS_SFU.suporta` that answers it: the capability only
   * exists after `hello.ok`, and a server can be behind. The connections are
   * made here and the decisions live in `sfu.ts`, which doesn't import any
   * `electron`, that's what makes this layer measurable without opening a
   * window. The event is dropped at the entry, just like in `preload`: it
   * carries a `sender` that has no business being there.
   */
  const registarPedido: RegistarPedido = (canal, ouvinte) => {
    tratar(canal, (_evento, ...argumentos) =>
      /*
        The only type conversion in this connection, and it's here on purpose.

        `ipcMain` delivers the arguments untyped, that's the cost of a boundary
        between processes, and it's paid once at this point, instead of scattered
        across eight handlers. On the other side, `preload` is what sends them,
        with the form written: that's where the truth about the form lives, and
        that's why the channel names are shared instead of written twice.
      */
      (ouvinte as (...quaisquer: unknown[]) => unknown)(...argumentos),
    )
  }
  ligarSfu({
    registar: registarPedido,
    enviar: (canal, carga) => window.webContents.send(canal, carga),
    sessao: session,
  })

  /**
   * Rooms, categories, roles, tickets, the 37 that were missing.
   *
   * The web channel bridge exposed 52 operations and this process exposed 15.
   * The missing ones didn't break anything: the interface is written
   * defensively, and the absence read as "this channel has no rooms". See
   * `canais.ts`, where the decisions and the cost of each missing one are.
   *
   * **Half of them cannot be a `handle`**, and it's the only non-mechanical part
   * of this connection: `rooms`, `mayEdit`, `roles`, `pins` and the other reads
   * are called in the middle of a `render` and must return VALUE. A `handle`
   * returns a promise, and a promise is truthy, that's how `mayExpel` in this
   * app spent all its time saying yes.
   */
  const registarLeitura: RegistarLeitura = (canal, ouvinte) => {
    /*
      `ipcMain.on` with `event.returnValue`, which is the other side of
      `sendSync`, not `ipcMain.handle`.

      The response already comes verified against cloning, `provarQueAtravessa`
      in `canais.ts` -, so there's nothing to decide here: what comes in is what
      goes out. This function exists only so Electron doesn't go into that file.
    */
    ipcMain.on(canal, (evento, ...argumentos) => {
      evento.returnValue = (ouvinte as (...quaisquer: unknown[]) => Resposta<unknown>)(...argumentos)
    })
  }

  ligarCanais({ registarPedido, registarLeitura, sessao: session })

  tratar("voice:active", (_event, active: boolean) => {
    callInProgress = active
    // A call ending with an open picker left a pending request hanging on a call
    // that no longer exists. See `PedidosDeEcra.fecharTodos`.
    if (!active) pedidosDeEcra.fecharTodos()
    return { ok: true }
  })

  /**
   * Screen sharing: the sources and the choice.
   *
   * Two names and nothing else, neither accepts an IPC channel from the
   * renderer to forward, which is the usual way a preload becomes a remote
   * execution bridge.
   *
   * `ecra:fontes` READS and doesn't decide: it returns what there is to choose,
   * with thumbnails already in `data:`. It doesn't open any capture, the
   * capture only starts when the handler's `callback` receives a source.
   */
  tratar("ecra:fontes", async (_event, semNome: string) => {
    if (!callInProgress) return []
    const cruas = await desktopCapturer.getSources({
      types: ["screen", "window"],
      // Small thumbnails on purpose: they're to recognize the window, and a grid of
      // full-size thumbnails of six 4K screens would cross the IPC in megabytes.
      thumbnailSize: { width: 320, height: 200 },
      fetchWindowIcons: false,
    })
    return reduzirFontes(cruas, semNome)
  })

  /** `ecra:escolher`: the response to the pending request. `null` means give up. */
  tratar("ecra:escolher", (_event, id: string, fonte: EscolhaDeEcra | null) => {
    // Only the three fields, and sound only as `true` literal: what comes from the
    // renderer chooses nothing more than this.
    const respondido = pedidosDeEcra.responder(
      id,
      fonte ? { id: String(fonte.id), nome: String(fonte.nome), som: fonte.som === true } : null,
    )
    return { ok: respondido }
  })

  /**
   * Screen recording permission on macOS, and the shortcut to grant it.
   *
   * Without this, the first share on a new machine looks like an app crash:
   * macOS refuses the capture silently, and what you see is a button that does
   * nothing. Outside macOS it always responds granted, see `permissaoDeEcra`,
   * which is where the decision is and where it's measured.
   */
  tratar("ecra:permissao", () =>
    permissaoDeEcra(process.platform, () =>
      // `getMediaAccessStatus` only exists on macOS and Windows; outside them it's
      // not even called, because `permissaoDeEcra` responds first.
      systemPreferences.getMediaAccessStatus("screen") as EstadoDaPermissao,
    ),
  )

  /**
   * `ecra:som`: does this system provide screen audio? See `somDoSistema`.
   *
   * Read by `Call` (`somDoEcraDisponivel`) after the share starts without audio:
   * in Electron there's no checkbox to tick, and the absence means the system
   * doesn't provide it.
   */
  tratar("ecra:som", () => ({ disponivel: somDoSistema(process.platform, release()) !== null }))

  /**
   * Open the Settings panel where the permission is granted.
   *
   * It goes through `shell.openExternal` with an address
   * `x-apple.systempreferences:`, not through `podeSair`: that filter governs
   * what the APP fetches from the network, and this is not network at all, it's
   * a request to the operating system to open a panel of its own. The address is
   * a constant in this repository and doesn't come from the renderer, which is
   * what makes it safe.
   */
  tratar("ecra:abrirDefinicoes", async () => {
    if (process.platform !== "darwin") return { ok: false }
    await shell.openExternal(DEFINICOES_DE_GRAVACAO_DE_ECRA)
    return { ok: true }
  })

  // Push decrypted payloads to the renderer. Ciphertext never crosses this line.
  session.on("message", (message) => window.webContents.send("event:message", message))
  session.on("epoch", (epoch) => window.webContents.send("event:epoch", epoch))
  session.on("status", (status) => window.webContents.send("event:status", status))
  session.on("connection", (state) => window.webContents.send("event:connection", state))
  session.on("channels", (channels) => window.webContents.send("event:channels", channels))
  session.on("voice", (event) => window.webContents.send("event:voice", event))
  session.on("presence", (event) => window.webContents.send("event:presence", event))
  session.on("pair", (event) => window.webContents.send("event:pair", event))
  session.on("lidas", ({ lidas }) => window.webContents.send("event:lidas", { lidas: { ...lidas } }))
  session.on("arquivo", ({ arquivo }) => window.webContents.send("event:arquivo", { arquivo: { ...arquivo } }))
  session.on("preferencias", ({ preferencias }) =>
    window.webContents.send("event:preferencias", { preferencias: { ...preferencias } }),
  )
  session.on("bloqueio", (event) => window.webContents.send("event:bloqueio", event))
  session.on("amizades", (event) => window.webContents.send("event:amizades", event))
  session.on("sucessoes", (event) => window.webContents.send("event:sucessoes", event))
  session.on("perfil", ({ profile }) => window.webContents.send("event:perfil", { profile: { ...profile } }))
  session.on("perfis", ({ enderecos }) => window.webContents.send("event:perfis", { enderecos: [...enderecos] }))
  session.on("historico", (evento) => window.webContents.send("event:historico", structuredClone(evento)))
  session.on("sincronia", (estado) => window.webContents.send("event:sincronia", { ...estado, progresso: estado.progresso.map((p) => ({ ...p })) }))
  session.on("typing", (event) => window.webContents.send("event:typing", event))
  session.on("buzz", (event) => window.webContents.send("event:buzz", event))
  session.on("video", (event) => window.webContents.send("event:video", { ...event }))
}

const trace = (stage: string): void => {
  if (process.env.ENCLAVE_TRACE) process.stderr.write(`[main] ${stage}\n`)
}

async function start(): Promise<void> {
  trace("module evaluated")
  await app.whenReady()
  trace("app ready")

  hardenSession()

  /*
    Automatic update before the main window exists. This is what guarantees it
    never updates in the middle of a call: here there's no session, no open
    vault, no call. Only on Windows and only in the packaged app (in
    development there's no installer to return to). macOS is for later: see
    `docs/planos/depois-da-1-0.md`.
  */
  let ecraDeArranque: BrowserWindow | null = null
  if (app.isPackaged && process.platform === "win32") {
    try {
      const { sair, ecra } = await actualizarNoArranque()
      if (sair) {
        aSair = true
        app.quit()
        return
      }
      ecraDeArranque = ecra
    } catch (erro) {
      // An update that prevents the app from opening is worse than having no update
      // at all. You start with the version you have.
      // `arranqueComDiagnostico` already logs the outcome and doesn't throw; this is
      // the last safety net, and logs too, so the log never stays empty.
      process.stderr.write(`[actualizacao-windows] falhou: ${(erro as Error)?.message}\n`)
      await writeFile(
        FICHEIRO_DO_ARRANQUE,
        `${JSON.stringify({ quando: Date.now(), codigo: "arranque-falhou" })}\n`,
        "utf8",
      ).catch(() => {})
    }
  }

  const window = createWindow()
  // The splash screen exits when the main window appears, not before. The `show`
  // also happens when the renderer fails to load.
  if (ecraDeArranque) {
    const ecra = ecraDeArranque
    window.once("show", () => {
      if (!ecra.isDestroyed()) ecra.destroy()
    })
  }
  // Handled by `setDisplayMediaRequestHandler`, which was registered above and
  // only fires when someone clicks share.
  janelaPrincipal = window
  bandeja = montarBandeja({
    janela: window,
    // Read at the moment and not saved: between the request and the notification
    // the vault may have been locked, and it's the state at that moment that
    // matters.
    cofreAberto: () => vault.unlocked,
    sair: () => {
      aSair = true
      app.quit()
    },
  })
  registerIpc(window)
  // The game overlay: the rules are in `overlay-controlador.ts`.
  const overlay = ligarOverlayDeJogo({
    principal: window,
    preload: asset("preload", "overlay.cjs"),
    carregar: (janela) =>
      process.env.ELECTRON_RENDERER_URL
        ? janela.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay.html`)
        : janela.loadFile(asset("renderer", "overlay.html")),
    pastaDeDados: app.getPath("userData"),
  })
  app.on("will-quit", () => overlay.libertar())
  trace("window created")

  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await window.loadFile(asset("renderer", "index.html"))
  }
  trace("renderer loaded")
}

function shutdown(): void {
  // Persist buffered group state before the process goes away; losing it would
  // put us behind our own MLS epoch on the next launch.
  void session.flush().catch(() => {
    // Vault already locked, or nothing to write.
  })
}

app.on("before-quit", () => {
  // From here on, a `close` is a real close, not just hiding the window.
  aSair = true
  bandeja?.destruir()
  shutdown()
})

// Click on the dock on macOS with the window hidden by the close button.
app.on("activate", () => bandeja?.revelar())

app.on("window-all-closed", () => {
  // You only get here on a real exit: outside that, the window hides instead of
  // being destroyed, and that's why the vault is no longer locked when closing
  // it.
  shutdown()
  vault.lock()
  if (process.platform !== "darwin") app.quit()
})

/*
  One instance only, like one tab on the web (`apps/web/src/posse-do-separador.ts`).

  Two app instances opened the SAME vault and both connected to the server, each
  with its own copy of MLS groups: the bug that broke the common room on October
  18, 2026, seen from the desktop side. The lock is Electron's; the second
  instance shows the first and exits without touching the vault.
*/
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (bandeja) bandeja.revelar()
    else {
      janelaPrincipal?.show()
      janelaPrincipal?.focus()
    }
  })
  void start().catch((error: Error) => {
    process.stderr.write(`enclave failed to start: ${error.stack ?? error.message}\n`)
    app.exit(1)
  })
}
