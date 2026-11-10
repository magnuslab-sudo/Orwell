import { describe, expect, it, vi } from "vitest"

/**
 * Both bridges offer the SAME set of capabilities.
 *
 * The same screen runs on three hosts, the browser tab, this app, and the phone
 * that `docs/PLANO_MOVEL.md` sketches, and one bridge separates each one. A
 * capability that exists in one and is missing in another **raises no error**: the
 * type says it's optional, the interface reads the absence as "not here", and the
 * feature simply doesn't happen. It's the costliest bug class this layer can
 * produce, and we've built it three times:
 *
 *  - `applyMediaPrefs`, which the desktop bridge never implemented: noise
 *    suppression, gain, and microphone selection never worked in the installed
 *    app, not ever;
 *  - the 37 channel operations that `preload` didn't expose: each channel showed
 *    one room only, no categories, no roles, and no tickets;
 *  - the path to SFU, left unplugged when Phase 2 closed: all calls from the
 *    installed app ran over mesh against any server, even with `hello.ok`
 *    advertising the capability.
 *
 * All three were found by someone looking, not by a test. **This file tries to
 * stop needing someone to look**: it walks both bridges and demands the same set,
 * with deliberate differences written down here. A new capability in one bridge
 * passes the gate two ways only: implement it in the other, or write here why you
 * don't.
 *
 * **Both bridges real, and the `preload` real.** The desktop one is measured
 * against what the REAL `preload` exposes, `electron` is the only mock, and it
 * returns the real surface to `contextBridge`. Without that the host would be a
 * `Proxy` that always has whatever method you ask for, and an operation the
 * `preload` forgot would still pass. What measures the other half of that
 * boundary, that channel names match across processes, and what crosses survives
 * the clone, is `scripts/ipc-canais-electron.mjs`.
 */

/** What each bridge delivered to `Call`. It's the second surface, and it diverges on its own. */
const pontesDoCall: Record<string, unknown>[] = []

/** The preference sources that each bridge delivered to the audio chain (`call.audio.ligarPreferencias`). */
const fontesDaVoz: Record<string, unknown>[] = []

vi.mock("@enclave/client-core", () => ({
  Call: class {
    constructor(ponte: Record<string, unknown>) {
      pontesDoCall.push(ponte)
    }
    readonly audio = {
      ligarPreferencias: (fonte: Record<string, unknown>) => {
        fontesDaVoz.push(fonte)
        return () => {}
      },
    }
    set audioSettings(_valor: unknown) {}
    get audioSettings(): unknown {
      return null
    }
    set videoQuality(_valor: string) {}
    set inputGain(_valor: number) {}
    async aplicarSomAoVivo(): Promise<void> {}
    async handleSfuAviso(): Promise<void> {}
    on(): () => void {
      return () => {}
    }
    emit(): void {}
    async rekey(): Promise<void> {}
  },
  Session: class {
    identity = { address: "@eu:servidor" }
    loadIdentity(): { address: string; accountId: string } {
      return { address: "@eu:servidor", accountId: "conta" }
    }
    preferencias(): Record<string, string> {
      return {}
    }
    async definirPreferencia(): Promise<void> {}
    on(): () => void {
      return () => {}
    }
    get suportaSfu(): boolean {
      return false
    }
  },
  // The core vault responds to `status` with a beta vault: see end of file.
  Vault: class {
    async estado(): Promise<unknown> {
      return { exists: true, supportsOsProtection: false, versao: "beta" }
    }
  },
}))
vi.mock("@enclave/crypto", () => ({ kindOf: () => "application" }))
vi.mock("@enclave/ui", () => ({ registerSystemNoticeHost: () => {} }))
vi.mock("mediasoup-client", () => ({
  Device: class {
    readonly rtpCapabilities = {}
    async load(): Promise<void> {}
  },
}))
vi.mock("../../../web/src/vault-backend.js", () => ({ BrowserVaultBackend: class {} }))

/**
 * The `electron`, which is the only mock on this test bench.
 *
 * The `contextBridge` here stores what `preload` gives it, and it's that object
 *, the real one, with every key it exposes and none it doesn't, that becomes
 * the `window.enclaveHost` of the desktop bridge.
 */
let anfitriaoDoPreload: Record<string, unknown> = {}
vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_nome: string, valor: Record<string, unknown>) => {
      anfitriaoDoPreload = valor
    },
  },
  ipcRenderer: {
    // `vault:status` responds like the main process responds to a beta vault
    // (`vault.estado()` in `src/main/index.ts`); the rest is empty.
    invoke: async (canal: string) =>
      canal === "vault:status" ? { exists: true, supportsOsProtection: false, versao: "beta" } : {},
    // The envelope for synchronous reads. See `ler` in `preload`.
    sendSync: () => ({ ok: true, valor: [] }),
    on: () => {},
    removeListener: () => {},
  },
}))

await import("../preload/index.js")
Object.defineProperty(window, "enclaveHost", { value: anfitriaoDoPreload, writable: true })

const { createDesktopBridge } = await import("./bridge.js")
const { createBrowserBridge } = await import("../../../web/src/bridge.js")

/**
 * Paths in an object, two levels deep.
 *
 * Two and no more because that's where the bridge ends: `vault.export`,
 * `channels.pins`, `sfu.sfuProduzir`. Below that are arguments and return values,
 * which is what the compiler checks, both bridges implement the SAME interface,
 * and a swapped signature won't compile. What won't compile doesn't need testing;
 * what's completely missing is what passes.
 */
function capacidades(objecto: unknown, prefixo = "", nivel = 0): string[] {
  if (objecto === null || typeof objecto !== "object") return []
  const saida: string[] = []
  for (const chave of Object.keys(objecto as Record<string, unknown>)) {
    const nome = prefixo ? `${prefixo}.${chave}` : chave
    saida.push(nome)
    const valor = (objecto as Record<string, unknown>)[chave]
    if (nivel < 1 && valor !== null && typeof valor === "object") saida.push(...capacidades(valor, nome, nivel + 1))
  }
  return saida
}

/**
 * What only the installed app has, and why. **One line per difference.**
 *
 * This list is the only way a capability lives on one host alone. It's not a
 * list of tolerated exceptions: it's where you write the reason, and an
 * undocumented difference won't pass. The gain is that the next difference must
 * be a choice, not an oversight.
 */
const SO_NA_SECRETARIA: Record<string, string> = {
  /*
    Screen sharing with its own picker. In the browser the engine brings its
    picker and asks permission itself; here `getDisplayMedia` falls to a request
    to the main process that waits for someone to choose. See `ecra` in
    `EnclaveBridge` and `apps/client/src/main/ecra.ts`.
  */
  ecra: "o browser tem o selector do sistema; aqui é preciso construí-lo",
  "ecra.fontes": "idem",
  "ecra.escolher": "idem",
  "ecra.permissao": "idem",
  "ecra.abrirDefinicoes": "idem",
  "ecra.som": "idem",
  "ecra.aoPedir": "idem",

  /*
    The new version alert. In the browser the prompt doesn't exist: the page
    refreshes on reload and whoever opens it gets the latest. The installed app
    is the only one that can fall behind, because its renderer is a frozen copy
    inside `app.asar`.
  */
  actualizacao: "a página do browser está sempre na última versão; o `app.asar` não",
  "actualizacao.verificar": "idem",
  "actualizacao.dispensar": "idem",
  "actualizacao.abrir": "idem",
  "actualizacao.diagnostico": "idem: a actualização automática só existe na aplicação instalada",

  /*
    Global keyboard shortcuts (mute with the window hidden). A page can't listen
    to another app's keyboard, and no browser API allows it; there shortcuts only
    work with the page in front, and the shortcuts screen says so. See
    `apps/client/src/main/atalhos.ts`.
  */
  atalhosGlobais: "uma página do browser não ouve o teclado quando não está à frente",
  "atalhosGlobais.definir": "idem",
  "atalhosGlobais.suspender": "idem",
  "atalhosGlobais.abrirAcessibilidade": "idem",
  "atalhosGlobais.aoAccionar": "idem",
  overlay: "uma página do browser não abre uma janela por cima de outra app (a overlay de jogo)",
  "overlay.estado": "idem",
  "overlay.caras": "idem",
  "overlay.preferencias": "idem",
  "overlay.alternar": "idem",
  "overlay.repor": "idem",
}

/** The same, for the `Call` bridge. */
const SO_NA_SECRETARIA_NO_CALL: Record<string, string> = {
  /*
    The Electron permission gate, which denies microphone and camera by default
    and only opens them during a call. The browser has no permission model this
    client can control, the engine decides, with its own dialog.
    */
  setMediaActive: "só o Electron tem um portão de media para levantar",
  /*
    System audio. In the browser the system picker has a "Share audio" checkbox,
    and no audio is the user's choice. In Electron the picker is ours, no
    checkbox: no audio means the SYSTEM isn't providing it, and the call must
    report that. See `somDoSistema` in `src/main/ecra.ts`.
  */
  somDoEcraDisponivel: "no browser o som do ecrã é uma caixa do selector do sistema; aqui depende do sistema operativo",
}

/** What only the browser has, each entry with the reason in writing. */
const SO_NO_BROWSER: Record<string, string> = {
  /*
    The permission model for 1.2 (3/11/2026). NOT a platform difference: IPC is
    missing. The core, in the main process, refuses the same way; without this
    the desktop app shows the usual role editor and reads `mayMove`. See
    `docs/planos/cargos-permissoes-relatorio.md`, D-P3.
  */
  "channels.mayMoveIn": "por fazer na secretária: falta o IPC (cargos-permissoes D-P3)",
  "channels.permissoes": "idem",
  pararDeEscrever:
    "a posse entre separadores (`posse-do-separador.ts`): o browser tem vários separadores sobre o mesmo cofre e só um escreve; a aplicação instalada tem uma janela só e o cofre é dela",
  assumirPosse:
    "a ficha de posse no IndexedDB (fencing, `vault-backend.ts`): trava as escritas de um separador que perdeu a posse; na aplicação instalada `requestSingleInstanceLock` garante uma instância só",
}
const SO_NO_BROWSER_NO_CALL: Record<string, string> = {}

function medir(): {
  browser: Set<string>
  secretaria: Set<string>
  callDoBrowser: Set<string>
  callDaSecretaria: Set<string>
} {
  pontesDoCall.length = 0
  const browser = createBrowserBridge()
  const callDoBrowser = pontesDoCall[pontesDoCall.length - 1] as Record<string, unknown>
  const secretaria = createDesktopBridge()
  const callDaSecretaria = pontesDoCall[pontesDoCall.length - 1] as Record<string, unknown>

  /*
    `call` leaves the account on purpose: it's not a bridge capability, it's the
    call engine, the SAME class on both hosts, with thousands of tests in
    `packages/client-core`. What matters is what each bridge GIVES it, and that's
    measured separately, in the two sets below.
  */
  const semOMotor = (nomes: string[]): Set<string> => new Set(nomes.filter((nome) => nome !== "call"))

  return {
    browser: semOMotor(capacidades(browser)),
    secretaria: semOMotor(capacidades(secretaria)),
    callDoBrowser: new Set(capacidades(callDoBrowser)),
    callDaSecretaria: new Set(capacidades(callDaSecretaria)),
  }
}

function soEm(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((nome) => !b.has(nome)).sort()
}

describe("as duas pontes oferecem o mesmo à interface", () => {
  it("nada existe só na aplicação instalada sem uma razão escrita", () => {
    const { browser, secretaria } = medir()
    const semRazao = soEm(secretaria, browser).filter((nome) => !(nome in SO_NA_SECRETARIA))
    expect(semRazao, "declarar em SO_NA_SECRETARIA, com a razão, ou implementar em apps/web").toEqual([])
  })

  it("nada existe só no browser sem uma razão escrita", () => {
    const { browser, secretaria } = medir()
    const semRazao = soEm(browser, secretaria).filter((nome) => !(nome in SO_NO_BROWSER))
    expect(semRazao, "declarar em SO_NO_BROWSER, com a razão, ou implementar em apps/client").toEqual([])
  })

  it("as divergências declaradas ainda são divergências", () => {
    /*
      The other side of the list, and it matters as much as the first: a written
      reason for a capability that now exists on both sides is a lie in the file,
      and the next person reading it will believe it. This assertion forces you
      to delete the line when the difference ends.
    */
    const { browser, secretaria } = medir()
    const jaNaoDiverge = Object.keys(SO_NA_SECRETARIA).filter((nome) => browser.has(nome))
    expect(jaNaoDiverge, "já existe nas duas pontes: apagar de SO_NA_SECRETARIA").toEqual([])
    const inventadas = Object.keys(SO_NA_SECRETARIA).filter((nome) => !secretaria.has(nome))
    expect(inventadas, "não existe em ponte nenhuma: apagar de SO_NA_SECRETARIA").toEqual([])
  })
})

describe("as duas pontes dão o mesmo ao motor de chamada", () => {
  it("nada só na aplicação instalada sem razão escrita", () => {
    const { callDoBrowser, callDaSecretaria } = medir()
    const semRazao = soEm(callDaSecretaria, callDoBrowser).filter((nome) => !(nome in SO_NA_SECRETARIA_NO_CALL))
    expect(semRazao, "declarar em SO_NA_SECRETARIA_NO_CALL, com a razão, ou implementar em apps/web").toEqual([])
  })

  it("nada só no browser sem razão escrita", () => {
    const { callDoBrowser, callDaSecretaria } = medir()
    const semRazao = soEm(callDoBrowser, callDaSecretaria).filter((nome) => !(nome in SO_NO_BROWSER_NO_CALL))
    expect(semRazao, "declarar em SO_NO_BROWSER_NO_CALL, com a razão, ou implementar em apps/client").toEqual([])
  })

  it("as divergências declaradas do `Call` ainda são divergências", () => {
    const { callDoBrowser, callDaSecretaria } = medir()
    const jaNaoDiverge = Object.keys(SO_NA_SECRETARIA_NO_CALL).filter((nome) => callDoBrowser.has(nome))
    expect(jaNaoDiverge, "já existe nas duas pontes: apagar de SO_NA_SECRETARIA_NO_CALL").toEqual([])
  })
})

describe("o worker da cifra, que é a divergência que deixa gente em silêncio", () => {
  /**
   * The one with its own name, because the generic list doesn't tell the story.
   *
   * `caminhoDaCifra` has two paths: Chromium's `createEncodedStreams`, which is
   * nonstandard, and `RTCRtpScriptTransform`, which is standard and runs on
   * another thread, and another thread needs a worker only the host bundler
   * knows how to make. A host without `criarWorkerDeCifra` gets one path where
   * the other has two; when that path doesn't exist in the engine, the SFU gate
   * closes and the call falls back to MESH silently.
   *
   * **And the two paths don't talk to each other.** A client on SFU ignores
   * offers from a mesh client and just writes `call-sfu-oferta-de-malha` to the
   * log. Both sides hang at "connecting..." until they give up, in the same room,
   * on the same channel, with no error line on any screen.
   */
  it("as duas pontes sabem criar o worker", () => {
    const { callDoBrowser, callDaSecretaria } = medir()
    expect(callDoBrowser.has("criarWorkerDeCifra"), "apps/web/src/bridge.ts").toBe(true)
    expect(callDaSecretaria.has("criarWorkerDeCifra"), "apps/client/src/renderer/bridge.ts").toBe(true)
  })
})

describe("a cadeia de voz lê e grava as escolhas na conta, nas duas pontes", () => {
  /**
   * The profile, stages, and strength are saved to the account (`audio.perfil`,
   * `audio.etapas`, `audio.forca`). A bridge that doesn't wire the chain to the
   * session raises no error: audio stays on the default profile, and what the
   * user picks in Settings is lost on close. It's the same class of bug as
   * `applyMediaPrefs`, and it's measured the same way: both or neither.
   */
  it("as duas ligam `call.audio.ligarPreferencias` quando a identidade abre, com o par completo", async () => {
    fontesDaVoz.length = 0
    await createBrowserBridge().identity.load()
    expect(fontesDaVoz.length, "apps/web/src/bridge.ts").toBe(1)
    await createDesktopBridge().identity.load()
    expect(fontesDaVoz.length, "apps/client/src/renderer/bridge.ts").toBe(2)
    for (const fonte of fontesDaVoz) {
      expect(typeof fonte.preferencias).toBe("function")
      expect(typeof fonte.definirPreferencia).toBe("function")
      expect(typeof fonte.on).toBe("function")
    }
  })
})

describe("a versão do cofre chega à interface pelas duas pontes", () => {
  /**
   * 1.0 "Arca", part 2: the gate checks `versao` in `vault.status()` to decide
   * whether to show "Orwell exited beta" before `Unlock`. A bridge that loses
   * this (a `status` rewritten by hand, a `preload` that filters it) would take
   * a beta vault to `Unlock`, which is the decryption path. Both or neither.
   */
  it("um cofre do beta diz `versao: \"beta\"` no browser e na secretária", async () => {
    const esperado = { exists: true, supportsOsProtection: false, versao: "beta" }
    expect(await createBrowserBridge().vault.status(), "apps/web/src/bridge.ts").toEqual(esperado)
    expect(await createDesktopBridge().vault.status(), "apps/client: preload e renderer").toEqual(esperado)
  })
})
