/**
 * Screen sharing from the main process.
 *
 * In the browser, `getDisplayMedia` opens the system picker and the app does
 * nothing: Chrome handles it all, including asking. That path doesn't exist in
 * Electron, without `setDisplayMediaRequestHandler`, the renderer's
 * `getDisplayMedia` **rejects with `NotAllowedError`**, which is exactly the
 * error the core reads as "the user hit cancel". So in the installed app, the
 * share button would give no error. It would do nothing.
 *
 * This file is the logic, without Electron.
 *
 * Nothing here imports `electron`, and that's why it exists separate from
 * `index.ts`: the main process talks to a library that doesn't run outside it,
 * and while the logic lived in there there was no way to test it. Ports come
 * as parameters; `index.ts` wires them to the real ones.
 */

/** What macOS returns about screen capture. See `getMediaAccessStatus`. */
export type EstadoDaPermissao = "not-determined" | "granted" | "denied" | "restricted" | "unknown"

/** A capture source, already trimmed to what the UI needs to draw. */
export interface FonteDeEcra {
  id: string
  nome: string
  /** The thumbnail in `data:` format. Empty when the system did not provide it. */
  miniatura: string
  /** A full screen, as opposed to an application window. */
  ecraInteiro: boolean
}

/**
 * The Settings pane where screen recording permission is granted on macOS.
 *
 * Uses an `x-apple.systempreferences:` URL, not written instructions. The
 * difference is measurable in user dropoff: "Settings > Privacy and
 * Security > Screen Recording > Orwell" is four steps with three names that
 * shift between OS versions.
 *
 * The pane opens; permission is granted by whoever controls the computer, and
 * the app must restart after. That is macOS behavior and unavoidable-we say so
 * rather than pretend the button fixes everything.
 */
export const DEFINICOES_DE_GRAVACAO_DE_ECRA =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"

/**
 * Whether this system has a separate permission gate for screen capture.
 *
 * macOS only, from Catalina onward. Windows and Linux have no permission to
 * request: `getMediaAccessStatus("screen")` returns `granted` on Windows and
 * has no meaning on Linux, and treating all three platforms by macOS behavior
 * would show a permission prompt on systems where there is nothing to grant.
 */
export function temPortaoDeEcra(plataforma: string): boolean {
  return plataforma === "darwin"
}

/**
 * The screen recording permission, as the interface needs to read it.
 *
 * Off macOS it always returns `granted`, which is correct: there is no gate, so
 * nothing to grant. On macOS the response is from the system, and `not-determined`
 * is different from `denied`: the first still triggers the system dialog on first
 * attempt, the second shows nothing and is what makes sharing appear broken.
 */
export function permissaoDeEcra(
  plataforma: string,
  ler: () => EstadoDaPermissao,
): { estado: EstadoDaPermissao; podeExplicar: boolean } {
  if (!temPortaoDeEcra(plataforma)) return { estado: "granted", podeExplicar: false }
  const estado = ler()
  /*
    `podeExplicar`: a sheet showing instructions and a shortcut to Settings.

    `not-determined` is deliberately excluded. In that state macOS still opens
    its own dialog on first attempt, and our sheet on top would mean the app
    explaining something while the system is asking it at the same time. The sheet
    exists for the state where the system no longer prompts.
  */
  return { estado, podeExplicar: estado === "denied" || estado === "restricted" }
}

/**
 * The system picker (`useSystemPicker`) on macOS 15+: disabled.
 *
 * It was on while the app had no picker of its own. Now it does (the
 * `ScreenPicker`), and the system one had two flaws this one does not:
 *
 *  - **Bypasses our `setDisplayMediaRequestHandler`.** Without the handler there
 *    is no `audio: "loopback"`, and screen sharing went silent on macOS 15+
 *    with no warning: `somDoSistema` said "audio present" and error 441 never
 *    appeared.
 *  - **Does not state that audio is included.** Our picker has the line that
 *    states it (see `escolhaDoEcra`), and there is nowhere to put it there.
 *
 * The tradeoff: on macOS 15 the system may occasionally ask to confirm screen
 * recording for an app that does not use its picker. It is a system prompt, not
 * a defect.
 *
 * A constant, not a literal in `index.ts`: `somDoSistema` needs to know which
 * of the two paths will run, and reads it from here.
 */
export const USAR_SELECTOR_DO_SISTEMA = false

/**
 * System audio during screen sharing: does Electron provide it here?
 *
 * In the browser, screen audio is a checkbox in the system picker. In the app,
 * the picker is ours and audio is the entire system audio (`audio: "loopback"`
 * in `setDisplayMediaRequestHandler`), and the OS decides if it is available:
 *
 *  - **Windows:** always. The only one Electron docs (43) list as unconditionally
 *    supported.
 *  - **macOS 14.2 (Sonoma) or later:** yes, via the CoreAudio Tap API, which
 *    Chromium uses by default since Electron 39. Requires the
 *    `NSAudioCaptureUsageDescription` key in `Info.plist` (in
 *    `electron-builder.yml`) and the "Screen Recording and System Audio"
 *    permission. **Without it the track is born ended and yields no samples, no
 *    JavaScript error**: the `Call` detects and reports it (error 440).
 *  - **macOS before 14.2:** no. The OS does not provide audio without a signed
 *    kernel extension, which Chromium does not bundle.
 *  - **Linux:** no. Electron does not offer `loopback` there.
 *
 * `versao` is `os.release()` (the Darwin version on macOS): macOS 14.2 is
 * Darwin 23.2. A version that cannot be read returns no: promising audio and
 * delivering silence is worse than saying there is none.
 *
 * `selectorDoSistema`: with `useSystemPicker` on, macOS 15+ (Darwin 24 or later)
 * opens its picker and our handler never runs, so `loopback` is never requested.
 * Then the answer is "no", and 441 tells the truth.
 */
export function somDoSistema(
  plataforma: string,
  versao: string,
  selectorDoSistema: boolean = USAR_SELECTOR_DO_SISTEMA,
): "loopback" | null {
  if (plataforma === "win32") return "loopback"
  if (plataforma !== "darwin") return null
  if (selectorDoSistema && Number.parseInt(versao, 10) >= 24) return null
  const [maior, menor] = versao.split(".").map((parte) => Number.parseInt(parte, 10))
  if (maior === undefined || !Number.isFinite(maior)) return null
  if (maior > 23) return "loopback"
  return maior === 23 && (menor ?? 0) >= 2 ? "loopback" : null
}

/** What the interface chose: the source. Audio is not a choice. */
export interface EscolhaDeEcra {
  id: string
  nome: string
  /**
   * The old audio checkbox. No longer read (see `escolhaDoEcra`); stays in the
   * type because the `ecra:escolher` channel still copies it, and an old
   * interface may still send it.
   */
  som?: boolean
}

/**
 * The response to `setDisplayMediaRequestHandler`, from the choice.
 *
 * System audio flows whenever the system provides it. There was a "Also share
 * system audio" checkbox, off by default, and the owner removed it on 2/11/2026:
 * "this does not need to be an option, audio is transmitted by default". An old
 * interface that sends a `som` field is ignored. Anyone wanting to mute mid-call
 * has "Mute screen audio" in the call.
 */
export function escolhaDoEcra(
  escolha: EscolhaDeEcra,
  som: "loopback" | null,
): { video: { id: string; name: string }; audio?: "loopback" } {
  const video = { id: escolha.id, name: escolha.nome }
  return som ? { video, audio: som } : { video }
}

/**
 * Capture sources, trimmed to what crosses the IPC boundary.
 *
 * The thumbnail travels as `data:`, not `NativeImage`: what crosses this
 * frontier must be plain data, and an Electron object on the renderer side
 * would be a handle for the key-holding process.
 *
 * A source without a name is not dropped: it displays as is. macOS returns
 * untitled windows for some apps, and a list with gaps is worse than a list
 * with a line saying "Untitled window".
 */
export function reduzirFontes(
  cruas: { id: string; name: string; thumbnail: { isEmpty: () => boolean; toDataURL: () => string } }[],
  semNome: string,
): FonteDeEcra[] {
  return cruas.map((crua) => ({
    id: crua.id,
    nome: crua.name.trim() || semNome,
    miniatura: crua.thumbnail.isEmpty() ? "" : crua.thumbnail.toDataURL(),
    // `screen:0:0` for screens, `window:1234:0` for windows. The prefix is from
    // Electron and stable; the name ("Screen 1", "Ecrã 1") is translated.
    ecraInteiro: crua.id.startsWith("screen:"),
  }))
}

/**
 * Screen share requests waiting for a response from the viewer.
 *
 * `setDisplayMediaRequestHandler` delivers a response callback that MUST be
 * called, and the choice happens on the other side of the IPC in the UI. Between
 * these two things sits a pending request, and this is it.
 *
 * Why a class and not a variable: there can be two. A window with two calls does
 * not exist today, but a request left hanging after the user closes the picker
 * always exists-and with a single variable, the second request would erase the
 * first and the first promise would never resolve. A `getDisplayMedia` that
 * never resolves or rejects is a button that spins forever.
 */
export class PedidosDeEcra {
  #pendentes = new Map<string, (fonte: EscolhaDeEcra | null) => void>()
  #proximo = 0

  /** How many are waiting. For logging and tests. */
  get pendentes(): number {
    return this.#pendentes.size
  }

  /**
   * Open a request. Returns the ID the interface will cite.
   *
   * `responder` is called once and only once: with the chosen source, or with
   * `null` when declining. Calling it with `null` closes the Chromium-side
   * request without giving it any stream, and that is the normal path: cancel.
   */
  abrir(responder: (fonte: EscolhaDeEcra | null) => void): string {
    this.#proximo += 1
    const id = `ecra-${this.#proximo}`
    this.#pendentes.set(id, responder)
    return id
  }

  /**
   * Respond to a request. `false` if none existed with that ID.
   *
   * An unknown request is not an error to throw: it happens each time the window
   * reloads with a picker open, and what remains on the other side is a message
   * about a request that died with the page. Ignoring is the right behavior, and
   * the return value exists for those who want to log it.
   */
  responder(id: string, fonte: EscolhaDeEcra | null): boolean {
    const responder = this.#pendentes.get(id)
    if (!responder) return false
    this.#pendentes.delete(id)
    responder(fonte)
    return true
  }

  /**
   * Close everything open, declining them.
   *
   * For app exit and call end: a pending request when the call ends is a picker
   * open over a call that no longer exists, and any response it receives would
   * enter a `Call` with no channel.
   */
  fecharTodos(): void {
    const abertos = [...this.#pendentes.values()]
    this.#pendentes.clear()
    for (const responder of abertos) responder(null)
  }
}
