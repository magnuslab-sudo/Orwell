import {
  Call,
  ehPerguntaDePresenca,
  enviarRelato,
  erroDaChamada,
  mensagemAEnviar,
  Session,
  transmissaoDoAnuncio,
  Vault,
  type ConnectionState,
  type DerivarChaveDoCofre,
  type MediaKeyMaterial,
  type Transmissao,
} from "@enclave/client-core"
// By its own path: accounts are pure logic, and bridge tests that swap the
// entire core for a double still have the real one.
import { CONTA_PRINCIPAL, ContasDoAparelho } from "@enclave/client-core/contas"
import { kindOf } from "@enclave/crypto"
import { CAPACIDADE_REVOGACAO, TYPING_TTL_MS, type Payload, type Sobreposicao, type UserAddress } from "@enclave/protocol"
import { Device } from "mediasoup-client"
import { ehIos, type EnclaveBridge, type Profile } from "@enclave/ui"
import { BrowserVaultBackend, type MotivoDaPerda } from "./vault-backend.js"
import { derivarNoWorker } from "./kdf.js"
import pacote from "../package.json" with { type: "json" }

/**
 * The browser host.
 *
 * Everything runs in the page: vault, session, MLS, calls. There is no second
 * process to hide keys in, which is the honest cost of running in a tab. The
 * desktop build keeps the identity key out of the renderer; this one cannot,
 * and `docs/THREAT-MODEL.md` records that difference.
 */
/**
 * Reload-survival for the vault key, scoped to this tab.
 *
 * sessionStorage, never localStorage: it survives F5 — the complaint it
 * exists to fix — and dies with the tab. What is cached is the Argon2id
 * output, never the passphrase people reuse elsewhere. "Bloquear agora" and
 * destroy clear it. The honest caveat stands: any script running in this
 * origin could read it — but such a script could equally read the unlocked
 * session out of memory, so the added exposure is the closed-but-open-tab
 * window, which is exactly what the person accepted by not locking.
 */
const SESSION_KEY = "enclave-session-key"

/**
 * The tab key is per account ("Switch Account"): the main one keeps the usual
 * name, and each added account gets its id after it.
 */
function chaveDoSeparadorDa(conta: string): string {
  return conta === CONTA_PRINCIPAL ? SESSION_KEY : `${SESSION_KEY}:${conta}`
}

function cacheSessionKey(bytes: Uint8Array, chave = SESSION_KEY): void {
  try {
    sessionStorage.setItem(chave, btoa(String.fromCharCode(...bytes)))
  } catch {
    // Storage full or blocked: the cache is a convenience, never a requirement.
  }
}

function readSessionKey(chave = SESSION_KEY): Uint8Array | null {
  const stored = sessionStorage.getItem(chave)
  if (!stored) return null
  try {
    return Uint8Array.from(atob(stored), (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

function clearSessionKey(chave = SESSION_KEY): void {
  sessionStorage.removeItem(chave)
}

/** The tab keys for all accounts: this is what "Lock Now" on another tab erases. */
function clearAllSessionKeys(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const chave = sessionStorage.key(i)
      if (chave === SESSION_KEY || chave?.startsWith(`${SESSION_KEY}:`)) sessionStorage.removeItem(chave)
    }
  } catch {
    // Without sessionStorage there's nothing to erase.
  }
}

/**
 * The list of accounts on this device, in `localStorage` ("Switch Account").
 * Only exists with two or more accounts. See `contasDoAparelho.ts` in the core.
 */
export const LISTA_DE_CONTAS = "orwell.contas"

function lerListaGuardada(): string | null {
  try {
    return localStorage.getItem(LISTA_DE_CONTAS)
  } catch {
    return null
  }
}

function gravarListaGuardada(texto: string | null): void {
  if (texto === null) localStorage.removeItem(LISTA_DE_CONTAS)
  else localStorage.setItem(LISTA_DE_CONTAS, texto)
}

/**
 * "Lock Now" applies to the whole device, not just this tab.
 *
 * The cached key is per tab (`sessionStorage`). A tab waiting to have been the
 * owner before kept its own, and when it took over would open the vault without
 * asking, right after the user locked it on another tab. Whoever locks announces
 * on the account channel; whoever hears erases their copy.
 */
export function avisarBloqueio(canal: string): void {
  try {
    const difusao = new BroadcastChannel(canal)
    difusao.postMessage({ t: "bloqueei" })
    difusao.close()
  } catch {
    // Without BroadcastChannel there's no safe way to alert other tabs.
  }
}

export function ouvirBloqueios(canal: string): void {
  try {
    new BroadcastChannel(canal).addEventListener("message", (evento: MessageEvent<unknown>) => {
      const dados = evento.data as { t?: unknown } | null
      if (dados?.t === "bloqueei") clearAllSessionKeys()
    })
  } catch {
    // Idem.
  }
}

/** The refusal to connect on a stopped tab. Catalog key, code 116. */
export const RECUSA_DE_LIGAR = "this tab no longer writes"

/**
 * The browser bridge, plus the only port that only the web host needs.
 *
 * `pararDeEscrever` is called by `main.tsx` when this tab stops owning the
 * vault (another tab took over) or becomes stale (a new version came out).
 * See `posse-do-separador.ts` and `version-watch.ts`.
 */
export type PonteDoBrowser = EnclaveBridge & {
  /**
   * Disconnects from the server, writes any pending data, and seals the vault.
   *
   * Resolves when the last write reaches disk: only then can another tab open
   * the vault without reading a state older than this one.
   */
  pararDeEscrever(modo?: { gravar: boolean }): Promise<void>
  /**
   * Acquires ownership in the vault (fencing). Called before the gate reads the
   * vault. See `BrowserVaultBackend.assumirPosse`.
   */
  assumirPosse(id: string): Promise<void>
}

export interface OpcoesDaPonte {
  /** A write found another tab's ownership token: this tab lost ownership. */
  aoPerderPosse?: (motivo: MotivoDaPerda) => void
  /** The account channel, so "Lock Now" can alert other tabs. */
  canalDaConta?: string
  /** For tests: storage and derivation, without IndexedDB or Worker. */
  backend?: BrowserVaultBackend
  derivar?: DerivarChaveDoCofre
  /**
   * For tests only: returns the true session and vault that the bridge created.
   * This is how `bridge.invariante.test.ts` leaves work pending before requesting
   * shutdown, without giving the bridge a public port to do so.
   */
  aoCriar?: (partes: { session: Session; vault: Vault }) => void
}

export function createBrowserBridge(opcoes: OpcoesDaPonte = {}): PonteDoBrowser {
  /*
    The vault derives the key in a Worker, not in this thread.
    
    The parameters remain those of the core (`KDF`, in `vault.ts`): what changes
    is WHERE the account runs, never what the account is. A phone would freeze
    the screen for one to seven seconds on each open, and the cost is the Argon2id
    cost parameter. That cost had to stop being paid by the rendering thread.
    See `kdf.ts`, and the fallback it keeps for engines without Worker support.
    */
  /*
    The accounts in this browser ("Switch Account"). The account for this tab
    is read once here: switching accounts reloads the page, and the new bridge
    opens whichever account was left active.
  */
  const contas: ContasDoAparelho = new ContasDoAparelho({
    lerLista: lerListaGuardada,
    gravarLista: gravarListaGuardada,
    estadoDaConta: (id: string): Promise<{ temCofre: boolean; memorizada: boolean }> => backend.estadoDaConta(id),
  })
  const conta: string = contas.activa
  const chaveDoSeparador = chaveDoSeparadorDa(conta)
  const backend: BrowserVaultBackend =
    opcoes.backend ??
    new BrowserVaultBackend({ ...(opcoes.aoPerderPosse ? { aoPerderPosse: opcoes.aoPerderPosse } : {}), conta })
  const vault = new Vault(backend, opcoes.derivar ?? derivarNoWorker)
  // The version goes in both `hello` calls for the 1.0 server to verify. See `Session`.
  const session = new Session(vault, { versaoDaApp: pacote.version })
  opcoes.aoCriar?.({ session, vault })

  /*
    This tab can no longer write: not to the server, not to the vault.

    Once stopped, it does not recover. What brings it back is reloading the page,
    which also brings new code, or puts the tab back in the lock queue.
    See `pararDeEscrever` below.
  */
  let escritaParada = false

  /*
    The page leaving writes anything still in the timer.

    The core batches writes one and a half seconds after each change, and an F5
    during that window would lose pending data. What cannot be lost no longer
    depends on this: the read anchor goes to disk with the commit that justifies
    it, and our commit is saved before exit (see `Session.#rememberSeq` and
    `#publicarCommit`). But the rest (history, groups, spent key packages) only
    went in the batch. Writing starts here and the browser may not let it finish:
    it is the best that `pagehide` offers, and it costs nothing to try. A locked
    vault refuses, and the refusal matters to no one.
  */
  window.addEventListener("pagehide", () => {
    // Stopped is stopped: the vault is now another tab's, or this tab is stale.
    if (escritaParada) return
    void session.flush().catch(() => {})
  })
  /*
    And when returning to the tab, reconciliation runs (sync across accounts, F9).

    `sincronizarAgora` and not `setVisible(true)`: the second also publishes
    presence, and anyone who chose to appear invisible would show as visible just by coming back to
    the tab. One minute between switches, like core does in `setVisible`:
    switching tabs ten times in a row does not trigger ten reconciliations.
  */
  let ultimaSinc = 0
  document.addEventListener("visibilitychange", () => {
    if (escritaParada || document.visibilityState !== "visible") return
    const agora = Date.now()
    if (agora - ultimaSinc < 60_000) return
    ultimaSinc = agora
    void session.sincronizarAgora().catch(() => {})
  })

  /**
   * The choice of call engine, and the caveat that decided it.
   *
   * Phase 2 of `docs/PLANO_SFU.md` foresaw a `call-sfu.ts` with the same public
   * surface and this line choosing between the two. The caveat written here before
   * any code existed decided it: `suportaSfu` only has an answer after `hello.ok`,
   * and this bridge is set up before there is a connection. Reading the capability
   * at this point always says no.
   *
   * Of the two exits the caveat left, the first was taken: **the choice moves down
   * to the moment of `join`.** What the bridge delivers is the PATH to the SFU
   * (`sfu` below), and who asks whether it works is the `Call`, on each entry.
   * This way a server rollback closes the gate by itself on the next call,
   * without anyone needing to remember to close it.
   */
  const call = new Call({
    get selfAddress(): UserAddress {
      return session.identity.address
    },
    sendSignal: (channel: string, payload: Payload) => session.send(channel, payload),
    mediaKey: (channel: string, address: UserAddress, folha?: number): Promise<MediaKeyMaterial | null> =>
      session.mediaKey(channel, address, folha),
    reservarContadorSframe: (channel: string, keyId: number): Promise<number> =>
      session.reservarContadorSframe(channel, keyId),
    // The AFK room (2/11/2026). See `salaAfk` in `CallBridge`.
    salaAfk: (channel: string, room: string): boolean => session.salaAfk(channel)?.room === room,

    /**
     * The worker where media encryption runs when the engine lacks insertable streams.
     *
     * **This is what puts Firefox and Safari inside the SFU.** Neither has
     * `createEncodedStreams`; both have `RTCRtpScriptTransform`, which does the
     * same work in another thread. Without the SFU those engines stay in the mesh,
     * which behind CGNAT cannot work without TURN. Measured across all three:
     * `scripts/sfu-script-transform-por-motor.mjs`.
     *
     * The `new URL(..., import.meta.url)` is how `vite` recognizes a worker to
     * bundle. It must be written this way, literally, for static analysis to catch
     * it. A variable in between and the file does not travel to `dist`: it works
     * in development but in production the worker does not load and encryption fails.
     */
    criarWorkerDeCifra: () => new Worker(new URL("./cifra-worker.ts", import.meta.url), { type: "module" }),
    // RTCIceServer under exactOptionalPropertyTypes will not take an explicit
    // undefined, and a STUN-only entry has no credential at all. Omit the keys
    // rather than send them empty.
    iceServers: async () =>
      (await session.iceServers()).map((server) => ({
        urls: server.urls,
        ...(server.username !== undefined ? { username: server.username } : {}),
        ...(server.credential !== undefined ? { credential: server.credential } : {}),
      })),

    /**
     * The path to the SFU, when this server has one.
     *
     * Pure delegation to the session on purpose: the client-core cannot import the
     * session (the call runs in Electron's renderer, where the session does not
     * live), and it is this object that crosses the boundary. The only piece with
     * substance is `criarDispositivo`. The `mediasoup-client` belongs to the HOST,
     * and that is why it enters here instead of being imported by the core.
     */
    sfu: {
      suportaSfu: () => session.suportaSfu,
      criarDispositivo: () => new Device(),
      sfuEntrarNoAmbito: (channel, scope) => session.sfuEntrarNoAmbito(channel, scope),
      sfuSairDoAmbito: (channel, scope) => session.sfuSairDoAmbito(channel, scope),
      sfuCriarTransporte: (channel, scope, direction) => session.sfuCriarTransporte(channel, scope, direction),
      sfuLigarTransporte: (transport, dtls) => session.sfuLigarTransporte(transport, dtls),
      sfuProduzir: (transport, kind, rtp, fonte) => session.sfuProduzir(transport, kind, rtp, fonte),
      sfuFecharProdutor: (producer) => session.sfuFecharProdutor(producer),
      sfuConsumir: (transport, producer, caps) => session.sfuConsumir(transport, producer, caps),
      sfuRetomar: (transport, consumer) => session.sfuRetomar(transport, consumer),
      sfuPausar: (transport, consumer) => session.sfuPausar(transport, consumer),
      sfuPedirFotogramaChave: (transport, consumer) => session.sfuPedirFotogramaChave(transport, consumer),
    },
  })

  /**
   * The SFU alerts reach the call engine.
   *
   * Same path as where `voice` already comes from, and for the same reason: whoever
   * knows a new stream appeared in the router is whoever routes it. Without this line
   * the call sets up, sound from those already there arrives, and nobody joining
   * AFTER gets heard, ever, with no error anywhere.
   */
  session.on("sfu", (aviso) => {
    void call
      .handleSfuAviso(aviso.t === "producer.new" ? { ...aviso, address: aviso.address } : aviso)
      .catch((error: unknown) => {
        call.emit("error", erroDaChamada(error, "the call media failed"))
      })
  })

  /**
   * The connection came back: the call must rebuild the media path.
   *
   * When the socket dies, the gateway drops everything that connection had in the
   * media engine. The session reconnects by itself and redoes what it can: it
   * authenticates, subscribes, recovers what it lost. But **nobody redid the media**:
   * the person's producer died in the router and nobody recreated it. She stayed
   * in everyone's encrypted roster because presence heartbeat knows nothing of media,
   * and reappeared on others' screens with no stream: "connecting..." forever while
   * the rest kept hearing each other.
   *
   * **Only on RETURN, not on all connections.** The first time you come online
   * there is no call to rebuild, and `Call` handles that by itself. The difference
   * that matters is whether there was a drop in between, and that is what this
   * stored state distinguishes.
   */
  let ligacaoAnterior: ConnectionState = "offline"
  session.on("connection", ({ state }) => {
    const voltou = state === "online" && ligacaoAnterior !== "online"
    ligacaoAnterior = state
    if (!voltou) return
    void call.ligacaoVoltou().catch((error: unknown) => {
      call.emit("error", erroDaChamada(error, "the call media failed"))
    })

    /*
      And ask who is in a call, on each of our channels.

      The symmetric half of the presence announcement just below: that one makes
      those already there re-announce when WE arrive, and does not go out to those
      arriving invisible. Invisible is invisible, that does not change. This question
      is ours, so it works invisible, and comes back in one round trip instead of
      the 50 s of the heartbeat. See `Call.perguntarQuemEsta`.

      Here, not in `vault.unlock`: `voltou` covers both the first connection and
      the return from a drop, which is when the list of who is in the room is most
      likely to be stale.

      **And `voltou` fires on EVERY return**, which with a shaky socket is many
      in a row. The `Call` counts the questions and keeps a minimum interval per
      channel (`PERGUNTA_MINIMO_MS`): without it, each return cost an MLS message
      per channel of ours. The decision lives there not here because both bridges
      call the same line, and a throttle written twice is a throttle that gets
      forgotten in one of them.
    */
    call.perguntarQuemEsta(session.channels)
  })

  // An epoch change is a change in who is in the channel, and the media key comes
  // from that epoch's exporter. Without this the call would keep encrypting with
  // the key from before the removal: whoever was removed from the channel kept
  // hearing it until someone disconnected. See `Call.rekey`.
  session.on("epoch", (event) => {
    void call.rekey(event.channel).catch((error: unknown) => {
      call.emit("error", erroDaChamada(error, "the call media key failed"))
    })
  })

  /**
   * Someone arrived at the server: if we are in a voice room, tell them.
   *
   * The sidebar of who arrives is built from the `voice.join` signals they HEAR,
   * and they heard none of the ones already gone. They cannot recover them because
   * voice signals do not replicate in the snapshot. Without this line, someone
   * opening the app sees an empty server while three people talk next to them.
   * This is the owner's report from 18 August 2026.
   *
   * The presence announcement goes out the moment the other side SUBSCRIBES to
   * the channel, so ears are already open when the response arrives: it is the
   * only trigger without a race. See `Call.reafirmarPresenca`, which batches an
   * arrival into a single announcement.
   */
  /*
    And the other half of the same announcement, which was missing.

    Who leaves exits any call, whether they had time to say so or not: the
    `voice.leave` only goes out from those who press disconnect, and closing the
    tab, reloading, or losing the network tell nobody. This was read and thrown
    away: the list of who is in a call, seen from outside, cleaned itself here
    (`semAPessoa`, in `packages/ui`), but the roster INSIDE the call did not.
    The person stayed on everyone else's screen forever, "connecting".
  */
  session.on("presence", (event) => {
    if (event.online) call.reafirmarPresenca()
    else call.desligouSeDoServidor(event.address)
  })

  // Call signalling never reaches the timeline; it is routed straight through.
  const activityHandlers = new Set<
    (event: { channel: string; from: string; joined: boolean; room: string; transmite?: Transmissao }) => void
  >()

  session.on("voice", (event) => {
    // Never swallow a signalling failure. A bare `void` here turned every error
    // into a silent unhandled rejection, which is why a call that could not be
    // set up said "connecting" for ever instead of saying what went wrong.
    void call.handleSignal(event.channel, event.from, event.payload).catch((error: unknown) => {
      call.emit("error", erroDaChamada(error, "call signalling failed"))
    })
    /*
      A question is not anyone's exit.

      It travels as a `voice.leave` so an old client can receive it without
      choking (see `quemEsta`, in the protocol), and that client reads it as
      the goodbye of someone who was never there: a non-event. Here we know what
      it is, so we do not pretend. Sending it as an exit would put the asker in
      the list of people who left the room's sound, and would remove them from
      the presence map of a channel where they might be in a DIFFERENT room's call.
    */
    if (ehPerguntaDePresenca(event.payload)) return
    if (event.payload.t === "voice.join" || event.payload.t === "voice.leave") {
      const joined = event.payload.t === "voice.join"
      // The room goes along. Without it the interface knew someone was in a call
      // on the channel but not WHICH voice room. A sign of life that does not say
      // where the life is does nothing. Absent is the default room, as in all
      // voice signaling.
      const room = event.payload.room ?? ""
      // What transmits (screen, music), read from the announcement: it lights the signal
      // in rooms where we are not (phase 1i).
      const transmite = transmissaoDoAnuncio(event.payload)
      for (const handler of activityHandlers) {
        handler({ channel: event.channel, from: event.from, joined, room, ...(transmite ? { transmite } : {}) })
      }
    }
  })

  /**
   * What the interface chose for the microphone and camera.
   *
   * Written into the call object instead of read by it: the core knows nothing
   * of storage or preferences, and changing that now would give it a dependency
   * it has been without all along.
   */
  const applyMediaPrefs = (next: {
    noiseSuppression?: boolean
    echoCancellation?: boolean
    autoGainControl?: boolean
    videoQuality?: "auto" | "360p" | "720p" | "1080p"
    inputDeviceId?: string
    inputGain?: number
    filtroDeMicrofone?: boolean
    videoDeviceId?: string
    sensibilidadeAutomatica?: boolean
    limiarDoMicrofone?: number
  }): void => {
    call.audioSettings = {
      ...(next.noiseSuppression !== undefined ? { noiseSuppression: next.noiseSuppression } : {}),
      ...(next.echoCancellation !== undefined ? { echoCancellation: next.echoCancellation } : {}),
      ...(next.autoGainControl !== undefined ? { autoGainControl: next.autoGainControl } : {}),
      // Empty is not an identifier: it is the absence of choice, and must reach the core
      // as absence so it does not ask for an `exact` on "".
      ...(next.inputDeviceId ? { inputDeviceId: next.inputDeviceId } : {}),
    }
    if (next.videoQuality) call.videoQuality = next.videoQuality
    if (next.inputGain !== undefined) call.inputGain = next.inputGain
    if (next.filtroDeMicrofone !== undefined) call.filtroDeMicrofone = next.filtroDeMicrofone
    // The chosen camera (phase 4). Empty is the absence of choice, and the core treats
    // it as such; an old interface that does not send it leaves it as is.
    if (next.videoDeviceId !== undefined) call.videoDeviceId = next.videoDeviceId
    // The microphone sensitivity: the line already goes to the running chain (the
    // configuration message to the worklet) and to the next capture. A broken line does
    // not mute anyone: it falls back to automatic.
    if (next.sensibilidadeAutomatica !== undefined) {
      try {
        call.audio.definirLimiar(next.sensibilidadeAutomatica ? null : (next.limiarDoMicrofone ?? null))
      } catch {
        call.audio.definirLimiar(null)
      }
    }

    /*
      And applies it to the stream already going out.

      Without this, changing the noise suppressor mid-call did nothing: the
      microphone was requested with the old settings and stayed that way until
      someone disconnected. For whoever made the change, the toggle simply
      did not work.

      No open call means no stream and this returns early. See `aplicarSomAoVivo`.
    */
    void call.aplicarSomAoVivo()
  }

  /**
   * The audio chain choices (profile, stages, strength) travel with the account.
   *
   * The `Session` serves as the source itself (`SessaoServeDeFonte`, in
   * `audio/controlo.ts`). It connects when the identity opens, because only then
   * does the vault have preferences to read; it disconnects when the vault closes.
   */
  let desligarPreferenciasDeVoz: (() => void) | null = null
  const ligarPreferenciasDeVoz = (): void => {
    desligarPreferenciasDeVoz?.()
    desligarPreferenciasDeVoz = call.audio.ligarPreferencias(session)
  }
  const largarPreferenciasDeVoz = (): void => {
    desligarPreferenciasDeVoz?.()
    desligarPreferenciasDeVoz = null
  }

  /** The name of the open account's profile, for the account list; `undefined` with vault closed. */
  const nomeDaContaAberta = (): string | undefined =>
    vault.unlocked && !vault.provisorio ? vault.contents.profile.displayName : undefined

  return {
    vault: {
      // Header only: a beta vault is never decrypted. See `Vault.estado`.
      status: () => vault.estado(),
      create: async (passphrase) => {
        await vault.create(passphrase)
        cacheSessionKey(vault.exportSessionKey(), chaveDoSeparador)
        return { ok: true }
      },
      unlock: async (passphrase) => {
        if (passphrase === null) {
          // The silent gate attempt. This host has no system keyring: first the
          // remembered session (F1), which survives closing the browser, then the
          // tab key, which only survives F5.
          if (await vault.abrirMemorizada()) {
            cacheSessionKey(vault.exportSessionKey(), chaveDoSeparador)
            return { ok: true }
          }
          const cached = readSessionKey(chaveDoSeparador)
          if (!cached) throw new Error("this vault needs a passphrase")
          await vault.unlockWithKey(cached)
          return { ok: true }
        }
        await vault.unlock(passphrase)
        cacheSessionKey(vault.exportSessionKey(), chaveDoSeparador)
        return { ok: true }
      },
      memorizar: async (ligar) => {
        if (!ligar) {
          await vault.esquecerSessao()
          return { ok: true }
        }
        await vault.memorizar()
        // On iPhone, Safari deletes a site's storage after seven days of disuse.
        // Asking it to stay is all the platform lets us do; the answer changes
        // nothing here (decision 6 of the plan). iOS only: Firefox responds to
        // this with a question to the person.
        if (ehIos()) void navigator.storage?.persist?.().catch(() => false)
        return { ok: true }
      },
      // F3. The browser has no `os` vaults (`supportsOsProtection` is false), and
      // the core refuses with 136; it exists for parity with the other bridges.
      definirPalavraPasse: async (frase) => {
        await vault.definirPalavraPasse(frase)
        cacheSessionKey(vault.exportSessionKey(), chaveDoSeparador)
        return { ok: true }
      },
      lock: async () => {
        // "Sign Out" forgets the remembered session BEFORE locking: if the tab dies
        // mid-way, what remains is a closed vault, never a session that opens by itself.
        await vault.esquecerSessao().catch(() => {})
        // Order matters: disconnect flushes what is buffered, reset drops the
        // in-memory group secrets, and only then does the vault key go away —
        // from memory and from the tab's reload cache alike.
        largarPreferenciasDeVoz()
        session.disconnect()
        session.reset()
        vault.lock()
        clearSessionKey(chaveDoSeparador)
        if (opcoes.canalDaConta) avisarBloqueio(opcoes.canalDaConta)
        return { ok: true }
      },
      destroy: async () => {
        // Leave channels BEFORE disconnecting, the only possible order: leaving is
        // an encrypted message that must reach the server. If we throw, nothing below
        // runs and the account stays up. That is the decision, written in
        // `Session.prepareAccountDeletion`.
        await session.prepareAccountDeletion()
        largarPreferenciasDeVoz()
        session.disconnect()
        session.reset()
        await vault.destroy()
        clearSessionKey(chaveDoSeparador)
        // With more accounts in the browser, the deleted one leaves the list and the
        // active one becomes another; the caller reloads. With only one, nothing changes.
        await contas.esquecerActiva()
        return { ok: true }
      },
      export: async (passphrase) => ({
        data: new TextDecoder().decode(await vault.exportVault(passphrase)),
      }),
      import: async (data, passphrase) => {
        largarPreferenciasDeVoz()
        session.disconnect()
        session.reset()
        await vault.importVault(new TextEncoder().encode(data), passphrase)
        // The imported account has its own passphrase; the old tab key is void.
        clearSessionKey(chaveDoSeparador)
        return { ok: true }
      },
      // Without `cacheSessionKey`: the tab key stays the tab key of whatever account
      // is on disk until the provisional is written (`pairing.done`).
      createProvisional: async (passphrase) => {
        await vault.criarProvisorio(passphrase)
        return { ok: true }
      },
    },

    /*
      "Switch Account". Only changes the list and deletes this account's tab key
      (like locking); the remembered session stays, and returning opens as before.
      The caller reloads the page: the open account dies with it, like closing the
      tab, and the new bridge opens whichever account was left active.

      We do not lock here on purpose. Locking and dropping the session with the
      interface still drawn would make it ask for an identity that no longer exists
      ("no identity loaded"), before the reload arrives.
    */
    contas: {
      listar: async () => ({ contas: await contas.listar(nomeDaContaAberta()) }),
      mudar: async (id) => {
        if (!contas.lista.contas.some((c: { id: string }) => c.id === id)) throw new Error("there is no such account on this device")
        const nome = nomeDaContaAberta()
        await contas.mudar(id, nome)
        if (contas.activa !== conta) clearSessionKey(chaveDoSeparador)
        return { ok: true }
      },
      acrescentar: async () => {
        await contas.acrescentar(nomeDaContaAberta())
        clearSessionKey(chaveDoSeparador)
        return { ok: true }
      },
    },

    identity: {
      create: async (homeserver) => {
        const identity = await session.createIdentity(homeserver)
        ligarPreferenciasDeVoz()
        return { address: identity.address, accountId: identity.accountId }
      },
      load: async () => {
        const identity = session.loadIdentity()
        ligarPreferenciasDeVoz()
        return { address: identity.address, accountId: identity.accountId }
      },
    },

    pairing: {
      status: async () => ({
        temChaveDeConta: session.temChaveDeConta,
        servidorSuporta: session.suportaEmparelhamento,
        servidorRevoga: session.serverCapabilities.includes(CAPACIDADE_REVOGACAO),
      }),
      host: () => session.emparelharComoAnfitriao(),
      join: async (link) => {
        session.emparelharComoConvidado(link)
        return { ok: true }
      },
      confirm: async () => {
        await session.confirmarSas()
        return { ok: true }
      },
      refuse: async () => {
        session.recusarSas()
        return { ok: true }
      },
      cancel: async () => {
        session.cancelarEmparelhamento()
        if (vault.provisorio) {
          // The new account did not stick: the session may already be connected with it,
          // and drops by the `lock` order. Disk did not change.
          largarPreferenciasDeVoz()
          session.disconnect()
          session.reset()
          vault.descartarProvisorio()
        }
        return { ok: true }
      },
      done: async () => {
        // The provisional goes to disk BEFORE `done`: if it does not write, we throw,
        // and the computer does not publish a device that did not stick here.
        if (vault.provisorio) {
          await vault.confirmarProvisorio()
          cacheSessionKey(vault.exportSessionKey(), chaveDoSeparador)
        }
        session.concluirEmparelhamento()
        return { ok: true }
      },
      devices: () => session.aparelhosDaConta(),
      revoke: async (deviceKey) => {
        await session.revokeDevice(deviceKey)
        return { ok: true }
      },
      // "Add the Other Account" (phase 8.2). The order lives in the core; here only
      // what is for this host: the audio chain and the tab key.
      juntar: async (link) => {
        session.emparelharParaJuntar(link)
        return { ok: true }
      },
      juntarAvisar: async () => {
        await session.juntarAvisar()
        return { ok: true }
      },
      juntarTrocar: async (passphrase) => {
        largarPreferenciasDeVoz()
        // If we throw, the vault stays closed with the secondary on disk, and the tab
        // key stays the secondary's: the gate opens it again.
        const { address } = await session.juntarTrocar(passphrase)
        // The tab key only changes after the primary vault is on disk.
        cacheSessionKey(vault.exportSessionKey(), chaveDoSeparador)
        ligarPreferenciasDeVoz()
        return { address }
      },
      juntarCancelar: async () => {
        session.cancelarJuntar()
        return { ok: true }
      },
    },

    estado: {
      lidas: async () => ({ ...session.lidas() }),
      marcarLido: async (channel, at) => {
        await session.marcarLido(channel, at)
        return { ok: true }
      },
      arquivo: async () => ({ ...session.arquivo() }),
      arquivar: async (channel, at) => {
        await session.arquivar(channel, at)
        return { ok: true }
      },
      desarquivar: async (channel) => {
        await session.desarquivar(channel)
        return { ok: true }
      },
      preferencias: async () => ({ ...session.preferencias() }),
      definirPreferencia: async (chave, valor, at) => {
        await session.definirPreferencia(chave, valor, at)
        return { ok: true }
      },
    },

    sincronia: {
      estado: async () => session.estadoDaSincronia(),
      lugarEm: async (channel) => session.lugarEm(channel),
      historico: async () => structuredClone(session.historicoEntreAparelhos()),
    },

    video: {
      publicar: async (caption, tags, extras, video) => {
        // Same as the translation of `social.post`: the images and files that go with the video.
        const id = await session.publicarVideo(
          caption,
          tags,
          {
            media: (extras.media ?? []).map((item) => ({
              url: "",
              inline: item.inline,
              key: "",
              nonce: "",
              digest: "",
              kind: kindOf(item.mediaType),
              name: item.name,
              mediaType: item.mediaType,
              byteLength: item.inline.length,
            })),
            links: extras.links ?? [],
            ...(extras.title ? { title: extras.title } : {}),
          },
          video,
        )
        return { ok: true, id }
      },
      cancelar: async () => session.cancelarEnvioDeVideo(),
      estado: async (sha) => session.estadoDoVideo(sha),
      bytes: async (sha) => session.bytesDoVideo(sha),
    },

    anexo: {
      pedir: ({ channel, alvo, indice }) => session.pedirAnexo(channel, alvo, indice),
      cancelar: async ({ channel, alvo, indice }) => session.cancelarAnexo(channel, alvo, indice),
    },

    session: {
      capabilities: async () => session.serverCapabilities,
      commonRoom: async () => session.commonRoom,
      escolherSalaComum: async (entrar) => {
        await session.escolherSalaComum(entrar)
        return { ok: true }
      },
      setVisible: async (visible) => {
        session.setVisible(visible)
        return { ok: true }
      },
      latency: () => session.measureLatency(),
      verificarLigacao: (opcoes) => session.verificarLigacao(opcoes),
      retomar: (opcoes) => session.retomar(opcoes),
      // Synchronous, so the interface can read it mid-frame. This channel's pause lives here (`escritaParada`, the same one that rejects `connect`);
      // the core's pause (`Session.pararDeEscrever`) applies to the caller.
      escreve: () => !escritaParada && session.escreve(),
      connect: async () => {
        // A paused channel does not reconnect, not even via the retry button: connecting means
        // receiving frames, and receiving frames means writing to the vault.
        if (escritaParada) throw new Error(RECUSA_DE_LIGAR)
        await session.connect()
        return { ok: true }
      },
    },

    channels: {
      list: async () => session.channels,
      archived: async () => session.archivedChannels(),
      create: async (channel, nome) => {
        // `createSpace`, not `createSpaceChannel`: a people channel is born with the rooms that define it.
        // See `SALAS_INICIAIS`.
        await session.createSpace(channel, undefined, nome)
        return { ok: true }
      },
      meta: (channel) => session.spaceMeta(channel),
      fichas: () => session.fichasDosCanais(),
      mayEdit: (channel) => session.mayEditChannel(channel),
      founder: (channel) => session.founderOf(channel),
      admins: (channel) => session.adminsOf(channel),
      rooms: (channel) => session.roomsOf(channel),
      // The live ones and the tombstones: the interface needs both. See `categoryTombstonesOf`.
      categories: (channel) => [...session.categoriesOf(channel), ...session.categoryTombstonesOf(channel)],
      setCategory: async (channel, next) => {
        await session.upsertCategory(channel, next)
        return { ok: true }
      },
      closedRooms: (channel) => session.closedRoomsOf(channel),
      // Pin messages. The real rejection is in `pinMessage`, in the core, and the second half in the receiver;
      // this is just what the interface needs to know to avoid offering a gesture that will be rejected.
      pins: (channel, room) => session.pinnedOf(channel, room),
      mayPin: (channel) => session.mayPin(channel),
      pin: async (channel, room, message) => {
        await session.pinMessage(channel, room, message)
        return { ok: true }
      },
      unpin: async (channel, room, id) => {
        await session.unpinMessage(channel, room, id)
        return { ok: true }
      },
      setRoom: async (channel, next) => {
        await session.upsertRoom(channel, next)
        return { ok: true }
      },
      tickets: (channel, room) => session.ticketsOf(channel, room),
      openTicket: async (channel, room, subject) => ({ ok: true, id: await session.openTicket(channel, room, subject) }),
      replyToTicket: async (channel, room, ticket, body) => {
        await session.replyToTicket(channel, room, ticket, body)
        return { ok: true }
      },
      setTicketState: async (channel, room, ticket, state) => {
        await session.setTicketState(channel, room, ticket, state)
        return { ok: true }
      },
      takeTicket: async (channel, room, ticket) => {
        await session.takeTicket(channel, room, ticket)
        return { ok: true }
      },
      releaseTicket: async (channel, room, ticket) => {
        await session.releaseTicket(channel, room, ticket)
        return { ok: true }
      },
      deleteTicket: async (channel, room, ticket) => {
        await session.deleteTicket(channel, room, ticket)
        return { ok: true }
      },
      // The real guards are in the core and reject just the same; this is just what the interface needs
      // to avoid offering a gesture that will be rejected.
      mayAttend: (channel) => session.may(channel, "atender"),
      mayModerate: (channel, address) => session.mayModerate(channel, address),
      nicknames: (channel) => session.nicknamesOf(channel),
      setNickname: async (channel, subject, nick) => {
        await session.setNickname(channel, subject, nick)
        return { ok: true }
      },
      mayDecideTicket: (channel, room, ticket) => session.mayDecideTicket(channel, room, ticket),
      // Move between voice rooms. The real guard is in `moveVoice`, in the core; this is just what the
      // interface needs to know to avoid offering a gesture that will be rejected.
      mayMove: (channel) => session.may(channel, "mover"),
      mayInvite: (channel) => session.may(channel, "convidar"),
      moveVoice: async (channel, address, room, de) => {
        await session.moveVoice(channel, address, room, de)
        return { ok: true }
      },
      disconnectVoice: async (channel, address, de) => {
        await session.disconnectVoice(channel, address, de)
        return { ok: true }
      },
      mayMoveIn: (channel, de, para) => session.mayMoveIn(channel, de, para),
      mayMentionAll: (channel, room) => session.may(channel, "mencionartodos", room),
      // The permission model for 1.2. The real guard is in the core.
      permissoes: {
        todos: (channel) => session.todosOf(channel),
        em: (channel, address, lugar) => session.permissoesEm(channel, address, lugar),
        mayManageRole: (channel, role) => session.mayManageRole(channel, role),
        delegacao: (channel) => session.delegacaoDeCargos(channel),
        sobreposicoes: (channel, lugar) => session.sobreposicoesDe(channel, lugar),
        maySetSobreposicoes: (channel, lugar) => session.maySetSobreposicoes(channel, lugar),
        setSobreposicoes: async (channel, lugar, perms) => {
          await session.setSobreposicoes(channel, lugar, perms as Sobreposicao[])
          return { ok: true }
        },
      },
      setAdmin: async (channel, address, admin) => {
        await session.assignRole(channel, address, admin)
        return { ok: true }
      },
      roles: (channel) => session.rolesOf(channel),
      reorderRoles: async (channel, ordem) => {
        await session.reorderRoles(channel, ordem)
        return { ok: true }
      },
      adminRole: (channel) => session.adminRole(channel),
      rolesFor: (channel, address) => session.rolesFor(channel, address),
      setRoles: async (channel, address, roles) => {
        await session.assignRoles(channel, address, roles)
        return { ok: true }
      },
      defineRole: async (channel, next) => {
        await session.defineRole(channel, next)
        return { ok: true }
      },
      deleteRole: async (channel, role) => {
        await session.deleteRole(channel, role)
        return { ok: true }
      },
      mayManageRoles: (channel) => session.mayManageRoles(channel),
      mayExpel: (channel) => session.may(channel, "expulsar"),
      // The real guard is in the core and rejects just the same; this only opens the gate to those who could already cross it.
      expel: async (channel, address) => {
        await session.expel(channel, address as UserAddress)
        return { ok: true }
      },
      claimFounder: async (channel) => {
        await session.claimFounder(channel)
        return { ok: true }
      },
      setMeta: async (channel, next) => {
        await session.updateSpaceMeta(channel, next)
        return { ok: true }
      },
      invite: async (channel, address, note) => {
        await session.invite(channel, address, note)
        return { ok: true }
      },
      channelInvites: async () => [...session.channelInvites().values()],
      acceptChannelInvite: async (dmChannel, target) => {
        await session.acceptChannelInvite(dmChannel, target)
        return { ok: true }
      },
      declineChannelInvite: async (dmChannel, target) => {
        await session.declineChannelInvite(dmChannel, target)
        return { ok: true }
      },
      send: async (channel, body, room, extras) => {
        // The same function on the computer host: a message, an image, a poll or a reply must arrive the same from both sides.
        await session.send(channel, mensagemAEnviar(body, room, extras, { id: crypto.randomUUID(), sentAt: Date.now() }))
        return { ok: true }
      },
      typing: async (channel, room) => {
        await session.send(channel, {
          t: "typing",
          ...(room ? { room } : {}),
          // The timeout travels with the signal. The receiver clears the indicator when it passes, without waiting
          // for an end message that may never come, see `useTyping.ts`.
          until: Date.now() + TYPING_TTL_MS,
        })
        return { ok: true }
      },
      editMessage: async (channel, target, body) => {
        await session.editMessage(channel, target, body)
        return { ok: true }
      },
      deleteMessage: async (channel, target) => {
        await session.deleteMessage(channel, target)
        return { ok: true }
      },
      buzz: async (channel) => {
        // Ephemeral: the session cuts it before the vault and before the conversation. Without that, every bump
        // would stay saved and shake the screen again the next day for anyone opening the conversation.
        await session.send(channel, { t: "buzz", at: Date.now() })
        return { ok: true }
      },
      members: async (channel) => session.membersOf(channel),
      history: async (channel) => session.history(channel),
      forget: async (channel) => {
        await session.forgetChannel(channel)
        return { ok: true }
      },
      leave: async (channel) => {
        await session.leaveChannel(channel)
        return { ok: true }
      },
      remove: async (channel) => {
        await session.deleteChannel(channel)
        return { ok: true }
      },
      mayDelete: (channel) => session.mayDeleteChannel(channel),
      safetyNumber: async (channel, address) => session.safetyNumberFor(channel, address),
    },

    invites: {
      // The short one when the server gave a short code; otherwise the long one (1.0 "Arca", 5b-2).
      create: async (channel, policy) => {
        const { longa, curta } = await session.criarConvite(channel, policy)
        return curta ?? longa
      },
      redeem: async (link) => {
        await session.redeemInvite(link)
        return { ok: true }
      },
      resolve: (link) => session.resolverConvite(link),
      nome: (link) => session.nomeDoConvite(link),
      list: (channel) => session.listInvites(channel),
      revoke: async (codeHash) => {
        await session.revokeInvite(codeHash)
        return { ok: true }
      },
    },

    social: {
      post: async (caption, tags, extras) => {
        // The interface speaks in inline images; the protocol's attachment shape
        // also covers blobs held in a store. Widening happens here, in the
        // adapter, rather than leaking store fields into the composer.
        await session.post(caption, tags, {
          media: (extras?.media ?? []).map((item) => ({
            url: "",
            inline: item.inline,
            key: "",
            nonce: "",
            digest: "",
            kind: kindOf(item.mediaType),
            name: item.name,
            mediaType: item.mediaType,
            byteLength: item.inline.length,
          })),
          links: extras?.links ?? [],
          ...(extras?.title ? { title: extras.title } : {}),
          ...(extras?.poll ? { poll: extras.poll } : {}),
        })
        return { ok: true }
      },
      acceptFollower: async (address) => {
        await session.acceptFollower(address)
        return { ok: true }
      },
      feedChannel: async () => session.feedChannel,
      edit: async (id, caption) => {
        await session.editPost(id, caption)
        return { ok: true }
      },
      remove: async (id) => {
        await session.deletePost(id)
        return { ok: true }
      },
      react: async (channel, target, emoji, remove) => {
        await session.reactToPost(channel, target, emoji, remove)
        return { ok: true }
      },
      comment: async (channel, target, body) => {
        await session.commentOnPost(channel, target, body)
        return { ok: true }
      },
      removeComment: async (channel, id) => {
        await session.deleteComment(channel, id)
        return { ok: true }
      },
      // In a tab there is no way to read a page from another domain: the browser forbids it, and no code on
      // our side gets around that. It goes through the homeserver, with the cost that brings, see `link.preview` in the protocol.
      linkPreview: (url) => session.previewLink(url),
      friendRequest: async (channel, note) => {
        await session.sendFriendRequest(channel, note)
        return { ok: true }
      },
      acceptFriend: async (channel, address) => {
        await session.acceptFriend(channel, address)
        return { ok: true }
      },
      declineFriend: async (channel) => {
        await session.declineFriend(channel)
        return { ok: true }
      },
      cancelFriendRequest: async (address) => {
        await session.cancelFriendRequest(address)
        return { ok: true }
      },
      block: async (address) => {
        await session.block(address)
        return { ok: true }
      },
      unblock: async (address) => {
        await session.unblock(address)
        return { ok: true }
      },
      blocked: async () => session.blocked(),
      friendTies: async () => [...session.friendTies().values()],
      sucessoes: async () => session.sucessoes(),
      marcarSucessao: async (de, feito) => {
        await session.marcarSucessao(de, feito)
        return { ok: true }
      },
      adicionarSucessora: async (de) => {
        await session.adicionarSucessora(de)
        return { ok: true }
      },
      convidarSucessora: async (de, channel) => {
        await session.convidarSucessora(de, channel)
        return { ok: true }
      },
      setShownFriends: async (list) => {
        await session.setShownFriends(list)
        return { ok: true }
      },
      shownFriendsOf: async (address) => session.shownFriendsOf(address),
      sincronizarAgora: async () => {
        await session.sincronizarAgora()
        return { ok: true }
      },
      unfriend: async (address) => {
        await session.unfriend(address)
        return { ok: true }
      },
      openDirect: (address) => session.openDirect(address),
      repairInvite: async (channel, address, force) => {
        const outcome = await session.repairInvite(channel, address, force)
        return { invited: outcome === "invited" || outcome === "reseated", outcome }
      },
      deadWelcomes: async () => session.deadWelcomeChannels(),
      deafChannels: async () => session.deafChannels(),
      syncCommunity: () => session.syncCommunity(),
      resyncWelcomes: async (channel) => {
        await session.resyncWelcomes(channel)
        return { ok: true }
      },
      /*
        The frame already existed, and the button did not. See `pedirPublicacoes` in the bridge.
        
        It does not wait for a response because there is no response to wait for: the
        `channel.rejoin.request` is a frame and nothing more, and what it triggers arrives later, as Welcome and as publications.
        That is also why `requestRejoin` is not async.
        */
      pedirPublicacoes: async (channel) => {
        session.requestRejoin(channel)
        return { ok: true }
      },
    },

    notifications: {
      list: async () => session.notificationsSnapshot(),
      save: async (entries) => {
        await session.saveNotifications(entries as never)
        return { ok: true }
      },
    },

    /**
     * Vote. One gate only for the two places where a poll appears.
     *
     * Creating a poll does not go through here: it travels inside a message or a publication,
     * as an optional field of those. See `Poll` in the protocol.
     */
    votacoes: {
      votar: async (channel, target, opcao, retirar) => {
        await session.voteOnPoll(channel, target, opcao, retirar)
        return { ok: true }
      },
    },

    profile: {
      get: async () => session.profile as Profile,
      set: async (profile) => {
        await session.updateProfile({
          displayName: profile.displayName,
          donations: profile.donations,
          // The chosen state goes in the profile (phase 1h); the core decides what gets published.
          ...(profile.activity !== undefined ? { activity: profile.activity } : {}),
          ...(profile.statusText !== undefined ? { statusText: profile.statusText } : {}),
          ...(profile.bio !== undefined ? { bio: profile.bio } : {}),
          ...(profile.email !== undefined ? { email: profile.email } : {}),
          ...(profile.avatarDataUrl !== undefined ? { avatarDataUrl: profile.avatarDataUrl } : {}),
        })
        return { ok: true }
      },
      directory: async () => session.directorySnapshot(),
    },

    on: {
      message: (handler) => session.on("message", handler),
      epoch: (handler) => session.on("epoch", handler),
      status: (handler) => session.on("status", handler),
      connection: (handler) => session.on("connection", handler),
      channels: (handler) => session.on("channels", handler),
      presence: (handler) => session.on("presence", handler),
      typing: (handler) => session.on("typing", handler),
      buzz: (handler) => session.on("buzz", handler),
      callActivity: (handler) => {
        activityHandlers.add(handler)
        return () => activityHandlers.delete(handler)
      },
      pair: (handler) => session.on("pair", handler),
      // The core gives read-only maps; the interface receives copies, as it does over IPC.
      lidas: (handler) => session.on("lidas", ({ lidas }) => handler({ lidas: { ...lidas } })),
      sincronia: (handler) => session.on("sincronia", (estado) => handler(estado)),
      video: (handler) => session.on("video", (evento) => handler(evento)),
      arquivo: (handler) => session.on("arquivo", ({ arquivo }) => handler({ arquivo: { ...arquivo } })),
      preferencias: (handler) =>
        session.on("preferencias", ({ preferencias }) => handler({ preferencias: { ...preferencias } })),
      bloqueio: (handler) => session.on("bloqueio", handler),
      amizades: (handler) => session.on("amizades", ({ ties }) => handler({ ties: ties.map((tie) => ({ ...tie })) })),
      sucessoes: (handler) => session.on("sucessoes", ({ sucessoes }) => handler({ sucessoes: { ...sucessoes } })),
      perfil: (handler) => session.on("perfil", ({ profile }) => handler({ profile: { ...profile } as Profile })),
      perfis: (handler) => session.on("perfis", ({ enderecos }) => handler({ enderecos: [...enderecos] })),
      historico: (handler) => session.on("historico", (evento) => handler(structuredClone(evento))),
    },

    call,
    applyMediaPrefs,

    /*
      "Send telemetry": to the same origin, which is the account server (the browser vault is by origin,
      and the page comes from the account server). The page CSP already allows it (`connect-src 'self'`).
      */
    relato: {
      enviar: ({ texto, versao }) =>
        enviarRelato(window.location.origin, { endereco: session.identity.address, versao, texto }),
    },

    /*
      Reports go to the same origin for the same reason as telemetry: it is the account server.
      The version is from this page, not what the interface says.
    */
    denuncias: {
      preparar: (alvo) => session.prepararDenuncia(alvo, window.location.origin),
      enviar: (preparada, escolha) => session.denunciar(preparada, escolha, window.location.origin, pacote.version),
      lista: async (canal) => session.denunciasDe(canal),
      marcarLida: (id) => session.marcarDenunciaLida(id),
      porAbrir: async (canal) => session.denunciasPorAbrir(canal),
      // Suspension (Task 8): by the signed request, no gateway.
      suspensao: () => session.avisoDeSuspensao(window.location.origin),
      pedirRevisao: (nota) => session.pedirRevisao(nota, window.location.origin),
    },

    pararDeEscrever: async (modo = { gravar: true }) => {
      if (escritaParada) return backend.escritasAcabadas()
      escritaParada = true
      if (!modo.gravar) {
        /*
          We are no longer the owner: another tab may be reading the vault right now. Seal BEFORE
          disconnecting, so the batch that `disconnect` saves is rejected here and does not land on top
          of the other one. What was pending to save is lost on this side; the server has the frames.
          */
        backend.selar()
        session.disconnect()
        await backend.escritasAcabadas()
        return
      }
      /*
        Order is the guarantee.

        0. Leave the call, if any: it is a notice to the others, and only the owner can give it.
           It is not waited for.
        1. `disconnect` closes the socket (what would touch the state stops arriving) and saves
           the pending batch. The core encrypts synchronously, and with the IndexedDB connection open
           the transaction is born inside the call.
        2. The seal rejects anything that comes after: the batch timer, `pagehide`, a frame still
           halfway through.
        3. Wait for the write that already left, until `oncomplete`. Only after that can the caller
           release the lock.

        The in-memory vault is left open on purpose. With an old version the tab keeps showing
        what it had, read-only only. Whoever gave up ownership reloads right after, and the memory
        goes with the page.
      */
      if (call.active) void call.leave().catch(() => {})
      session.disconnect()
      backend.selar()
      await backend.escritasAcabadas()
    },

    assumirPosse: async (id) => {
      await backend.assumirPosse(id)
    },
  }
}
