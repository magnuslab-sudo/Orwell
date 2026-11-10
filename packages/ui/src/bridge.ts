import type {
  AlvoDaDenuncia,
  Call,
  DenunciaPreparada,
  DenunciaRecebida,
  DesfechoDoAnexo,
  EscolhaDaDenuncia,
  ContaNaLista,
  EstadoDoCofre,
  EstadoDoVideo,
  EventoDoVideo,
  PairEvento,
  RegistoDeSucessao,
  RepairOutcome,
  SincroniaDoCanal,
  StoredChatMessage,
  StoredInvite,
  StoredPeerProfile,
  FichaDoCanal,
  Ticket,
} from "@enclave/client-core"
import type { AvisoDeSuspensao, FriendTie, InviteTie, PinnedMessage, Power } from "@enclave/protocol"
import type { MessageExtras } from "./types.js"

export type { DesfechoDoAnexo, EstadoDoVideo, EventoDoVideo, PairEvento, RepairOutcome, SincroniaDoCanal }

/**
 * An account that became another (phase 8.2, "Merge accounts"), as this account
 * received it: to whom, where it went, whether it was a friend, and what's already been answered.
 * See `sucessao.ts` in the core.
 */
export type Sucessao = RegistoDeSucessao

/**
 * The video to publish, as the bridge receives it from the interface: the file's bytes,
 * without transcoding, and what it read from it in an off-screen `<video>`.
 */
export interface VideoAPublicar {
  bytes: Uint8Array
  name: string
  mediaType: string
  /** Seconds. */
  duration: number
  /** The thumbnail (the frame at 1 s), already scaled down, as an image data URL. */
  poster?: string
}

/**
 * An attachment this device only has the name for (S5, §5.4): the channel, the
 * message or post `id`, and the attachment's position in its list.
 */
export interface IdDoAnexo {
  channel: string
  alvo: string
  indice: number
}

/** A device on the account, as the manifest lists it. See `pairing.devices`. */
export interface AparelhoDaConta {
  /** The device public key, base64url. There are no names in the manifest: this is what shows, shortened. */
  deviceKey: string
  /** Seconds since the epoch when the account added it. */
  addedAt: number
  /** It's the device where the interface is running. */
  esteAparelho: boolean
}

/**
 * A channel role: name, and the responsibilities it grants.
 *
 * Empty `powers` is the role that grants only channel access, and it's a legitimate state,  * not a list to fill in.
 *
 * `colour` is the name of a color from the palette, and its absence is the normal case: a
 * role with no color reads exactly as it did before colors existed. The name, not
 * the value, whoever chooses doesn't know what background the text will fall on, and whoever
 * paints does. See `lib/roleColours.ts`, where the values and measurements are.
 *
 * String not `RoleColour`: what comes from the core may have been written by a
 * newer version, and discounting what we don't know happens when we paint.
 */
export interface ChannelRole {
  role: string
  name: string
  powers: Power[]
  colour?: string
  /**
   * The height in the hierarchy (1.2): greater manages lesser. Absent in an
   * old host, and reads as zero. See `rank` in `role.define`.
   */
  rank?: number
  /** Order in the list, pure layout. */
  position?: number
}

/** A permission overlay on a room or category (1.2). See `Sobreposicao` in the protocol. */
export interface SobreposicaoDaSala {
  role: string
  allow: string[]
  deny: string[]
}

/** Where an overlay lives: a room, by identifier, or a category, by name. */
export type LugarDaSobreposicao = { sala: string } | { categoria: string }

export type { PinnedMessage }

/** A room inside a channel. The `room` identifies it and is never shown. */
export interface ChannelRoom {
  room: string
  name: string
  category: string
  kind: "text" | "voice"
  /**
   * How the room READS, when it's not the usual conversation. See `layout` in
   * `channel.meta`.
   *
   * String not a closed union, and it's the same reason as `ChannelRole.colour`:
   * what comes from the core may have been written by a newer version, and
   * discounting what we don't know happens when we draw. A layout this
   * version doesn't know how to show must read as its absence, which is a
   * text room.
   */
  layout?: string
  position: number
  /**
   * This voice room is the channel's AFK room, and the silent time it keeps there
   * (2/11/2026). Absent in the others. See `SalaAfk` in the protocol.
   */
  afk?: { minutos: number }
  /**
   * The timestamp when the vault saved the room (3/11/2026). Only a newer message
   * covers it on screen. Absent in an old host, and reads as 0.
   */
  updatedAt?: number
}

/**
 * What the interface needs from whatever is hosting it.
 *
 * The same React tree runs in a browser tab, where a `Session` sits right next
 * to it in the page, and in Electron, where the session lives in another process
 * behind IPC. Neither arrangement is visible from here: the UI only ever sees
 * this interface, so there is exactly one implementation of the screens.
 */

export interface DonationLink {
  kind: string
  label: string
  value: string
}

/** The activity a person chose. "invisivel" is local: it is never published
 *, an invisible account simply stops being announced.
 *
 * "ausente" is a manual choice, alongside the others (owner's order on 27
 * October 2026: "online, busy, away"). It's not the grey of someone offline:
 * the person is online and says they're not at the keyboard. */
export type Activity = "online" | "ocupado" | "ausente" | "invisivel"

export interface Profile {
  displayName: string
  /** Published activity. Absent means plain online. */
  activity?: "online" | "ocupado" | "ausente"
  statusText?: string
  bio?: string
  email?: string
  donations: DonationLink[]
  avatarDataUrl?: string
  updatedAt?: number
}

export type ConnectionState = "offline" | "connecting" | "online" | "reconnecting"

/**
 * The friend link that opened the page (`/app/a#<id>`, the short form from 1.0,
 * or the long `/app/amigo#@<id>:<servidor>`),
 * delivered by the HOST, as `StartupInvite`.
 *
 * The code that reads and clears the address is `apps/web/src/convite-arranque.ts`
 * (`lerAmigoDeArranque`), before the first render. The interface receives the
 * already-validated address (`lerLigacaoDeAmigo`, `lib/ligacaoDeAmigo.ts`) and opens the profile sheet
 * with "Add friend" after the gate. To make your own link:
 * `ligacaoCurtaDeAmigo(servidor, endereço)`, from the same file.
 */
export interface StartupFriend {
  /** The address read from the link, or what stayed saved in this tab. */
  address: string | null
  /** The page was opened by a friend link that cannot be read. */
  invalid: boolean
  /** Clear what the host stored. Call when the sheet resolves, no matter how. */
  forget: () => void
}

/** A link card, as composed by the sender. Readers never fetch anything. */
export interface LinkCard {
  url: string
  kind: "link" | "video" | "image" | "post"
  title?: string
  description?: string
  siteName?: string
  thumbnail?: string
}

/** An image carried inside the message, rather than in a separate blob store. */
export interface PostMedia {
  inline: string
  name: string
  mediaType: string
}

export interface PostExtras {
  media?: PostMedia[]
  links?: LinkCard[]
  /** The name given to the share, if any. */
  title?: string
  /**
   * The poll this post is, if it is one.
   *
   * The caption goes the same way and carries the question and options in full,
   * for anyone who cannot draw the card to read them as text. See `Poll` in the
   * protocol.
   */
  poll?: { question: string; options: string[] }
}

/**
 * Something that can be shared: a full screen, or a window.
 *
 * The same shape that the Electron main process returns, see
 * `reduzirFontes` in `apps/client/src/main/ecra.ts`. Repeated here and not
 * imported from there because the interface does not depend on the installed
 * app: the browser host never fills any of this.
 */
export interface FonteDeEcra {
  id: string
  nome: string
  /** The thumbnail in `data:`. Empty when the system did not provide it. */
  miniatura: string
  /** A full screen, as opposed to an application window. */
  ecraInteiro: boolean
}

/** What the system reports about screen recording. See `permissaoDeEcra`. */
export interface PermissaoDeEcra {
  estado: string
  /**
   * A sheet is showing and there is a shortcut to Settings.
   *
   * False does not mean "granted": on macOS in `not-determined`, the system
   * still opens its dialog, and explaining over it would mean talking at the
   * same time as the system.
   */
  podeExplicar: boolean
}

/**
 * A new version is published, and this is not it.
 *
 * The same shape that the Electron main process returns, see
 * `verificarActualizacao` in `apps/client/src/main/actualizacao.ts`. Repeated
 * here and not imported from there for the same reason as `FonteDeEcra`: the
 * interface does not depend on the installed app, and the browser host never
 * fills this.
 */
export interface AvisoDeActualizacao {
  /** The version this application is. */
  instalada: string
  /** The published version. Only arrives here when greater than the installed one. */
  disponivel: string
  /** The name given to the published version ("Statio"), when the manifest carries it. */
  nome?: string
  /**
   * The SHA-256 hash of the installer for this system, to verify after
   * download.
   *
   * It goes to the screen because it is the ONLY defense against a corrupted
   * file: installers are not signed with a commercial certificate. Absent when
   * the manifest does not carry a file for this system.
   */
  soma?: string
}

/**
 * The history that comes from a sibling device on the same account (1.0 "Arca"),
 * as the core reports it (`EventoDoHistorico`). `feitas` and `total` are items
 * (messages, shares, tickets, and so on); `media` the heavy media, which come
 * at the end. `inicial`: it comes from a freshly paired device.
 */
export interface HistoricoDosIrmaos {
  aTrazer: boolean
  feitas: number
  total: number
  media: { feitas: number; total: number } | null
  canais: string[]
  inicial: boolean
  perfis?: true
}

/** Which key maps to each global command. See `atalhosGlobais`. */
export interface PedidoDeAtalhosGlobais {
  microfone: string | null
  som: string | null
  /** Show or hide the game overlay. Optional: an old main process does not know it. */
  overlay?: string | null
}

/** The commands that can be global in the desktop app. */
export type ComandoGlobal = "microfone" | "som" | "overlay"

/**
 * What the game overlay shows, and nothing else. See `useOverlayDeJogo` and
 * `apps/client/src/main/overlay.ts`, which sanitizes it on the other side.
 */
export interface ResumoParaAOverlay {
  sala: string
  /** Changes each time you enter a room: two rooms with the same name are not confused. */
  entrada: number
  pessoas: {
    id: string
    nome: string
    aFalar: boolean
    micCalado: boolean
    somDesligado: boolean
    /** The name is the word from the address, not a chosen name (`vemDoEndereco`): the page draws it discreetly. */
    doEndereco?: boolean
  }[]
}

export interface PreferenciasDaOverlay {
  ligada: boolean
  opacidade: number
  /** The warning phrases, in the interface language. */
  textos: { entrou: string; saiu: string }
}

/**
 * What the main process managed to register.
 *
 *  - `globais`: work with the app hidden;
 *  - `soComAJanela`: common keys and mouse buttons, which are never global
 *    (see `teclaComum` in `lib/atalhosDeVoz.ts`), and keys the system cannot
 *    register;
 *  - `ocupados`: another app already has the key;
 *  - `faltaAcessibilidade`: on macOS, a multimedia key without the
 *    Accessibility permission.
 */
export interface EstadoDosAtalhosGlobais {
  globais: ComandoGlobal[]
  soComAJanela: ComandoGlobal[]
  ocupados: ComandoGlobal[]
  faltaAcessibilidade: ComandoGlobal[]
}

export interface EnclaveBridge {
  vault: {
    /**
     * `versao` is the version of the file on disk, read only from the plaintext
     * header (`Vault.versaoNoDisco`), without decrypting: `"beta"` is a vault
     * from 0.9.x, which 1.0 never opens (the gate shows "Orwell is out of beta"
     * before `Unlock`). Absent without a vault, and optional by the rule of
     * `preload` from another version.
     *
     * `protection` is FROM THIS vault, read from the plaintext envelope (F0 in
     * session memory; closes finding 9). `memoriaDisponivel` and
     * `sessaoMemorizada` only come from something that knows how to memorize
     * the session. See `EstadoDoCofre` in the core.
     */
    status: () => Promise<EstadoDoCofre>
    create: (passphrase: string | null) => Promise<{ ok: boolean }>
    /**
     * `null` is the gate's silent attempt: the system keychain (vault `os`),
     * the memorized session, and in the browser the tab key, in this order.
     * Throws when none of them work.
     */
    unlock: (passphrase: string | null) => Promise<{ ok: boolean }>
    /**
     * "Log out": forget the memorized session BEFORE locking, then disconnect
     * and erase keys in memory. The vault stays on disk.
     */
    lock: () => Promise<{ ok: boolean }>
    /**
     * "Remember the session" (F1): `true` stores the key of the open vault in
     * the platform registry; `false` forgets it. Does not lock, and never
     * writes to the vault. Throws 134 without a secure place to store the key,
     * and 135 in a vault without a password.
     *
     * Optional by the rule of `preload` from another version: without it, the
     * checkbox does not appear.
     */
    memorizar?: (ligar: boolean) => Promise<{ ok: boolean }>
    /**
     * "Set password" (F3): a vault `os` (desktop keychain only) becomes sealed
     * by this phrase, in a single write. Throws 136 in a vault that already has
     * a password. Optional by the rule of `preload`.
     */
    definirPalavraPasse?: (frase: string) => Promise<{ ok: boolean }>
    /**
     * Disconnect and erase the vault. Irreversible by design: there is no
     * server-side copy of the account, so nothing can bring it back.
     *
     * **Exits all channels first, and THROWS if it fails to exit any channel.**
     * Just erasing the vault would leave this account's leaf in the MLS tree of
     * each channel, with the epoch frozen: the person would stay on the member
     * list for everyone, and the keys the account had would still work to read
     * what comes next. When exit fails due to network, the account stays up on
     * purpose, so it can be tried again.
     */
    destroy: () => Promise<{ ok: boolean }>
    /** The encrypted vault as a portable file. Never plaintext. OS-protected
     * vaults must supply a passphrase to re-seal under. */
    export: (passphrase?: string) => Promise<{ data: string }>
    /** Adopt an exported account, replacing the local vault. The passphrase
     * is proven against the file before anything is written. */
    import: (data: string, passphrase: string) => Promise<{ ok: boolean }>
    /**
     * A new vault, open only in memory, for the pairing that will replace the
     * account on this device ("Sign in with another account"). Disk still holds
     * the old account. The provisional becomes this device's vault in
     * `pairing.done`, after the new account connects; `pairing.cancel` drops
     * it, and the old account opens as before. See `Vault.criarProvisorio`.
     *
     * Optional for the same reason as `pairing`: a `preload` from another
     * version does not bring it.
     */
    createProvisional?: (passphrase: string | null) => Promise<{ ok: boolean }>
  }
  /**
   * "Switch account": the accounts on this device, each with its own vault and
   * memorized session (see `contasDoAparelho.ts` in the core).
   *
   * `mudar` and `acrescentar` close the session and vault of the open account,
   * WITHOUT forgetting its memorized session, and make another account active.
   * The caller reloads the interface next: the gate opens the active account. A
   * newly added account starts empty, and the gate opens the signup form on it.
   *
   * Optional by the rule of `preload` from another version: without it, there
   * is no "Switch account".
   */
  contas?: {
    listar: () => Promise<{ contas: ContaNaLista[] }>
    /** Throws 137 if the account is not on this device. */
    mudar: (id: string) => Promise<{ ok: boolean }>
    acrescentar: () => Promise<{ ok: boolean }>
  }
  identity: {
    create: (homeserver: string) => Promise<{ address: string; accountId: string }>
    load: () => Promise<{ address: string; accountId: string }>
  }
  /**
   * Device pairing: the same account on a computer and a phone, without the
   * account private key leaving the first.
   *
   * Two sides, on the same bridge. The HOST is the device that owns the
   * account: opens the dialog and gets the QR link. The GUEST is the new
   * device, with a vault created and open but no account yet: joins via the
   * link. Everything that happens next arrives on `on.pair`, and the person
   * responds to the six words with `confirm` or `refuse`. After `certificado`,
   * the guest loads the identity, connects, and calls `done`.
   *
   * Optional for the same reason as the other additions: a `preload` from
   * another version does not bring it, and its absence reads as "this host
   * cannot pair".
   */
  pairing?: {
    /** Whether this device can add devices (has the account key) and whether the server knows how to pair. */
    status: () => Promise<{
      temChaveDeConta: boolean
      servidorSuporta: boolean
      /**
       * The server announces `device-revocation`: removing a device works there,
       * and the removed device cannot sign in anymore. Absent (old host) reads
       * as no.
       */
      servidorRevoga?: boolean
    }>
    host: () => Promise<{ pairId: string; link: string }>
    join: (link: string) => Promise<{ ok: boolean }>
    confirm: () => Promise<{ ok: boolean }>
    refuse: () => Promise<{ ok: boolean }>
    /** Drop the pairing. With a provisional vault open, disconnect and drop it too: disk did not change. */
    cancel: () => Promise<{ ok: boolean }>
    /**
     * The guest is connected: with a provisional vault, save it first over the
     * old account (throw if save fails, and then say nothing to the computer),
     * and only then tell the computer it is ready.
     */
    done: () => Promise<{ ok: boolean }>
    /** The devices on the own account, from the manifest; `null` without a manifest or a server that stores it. */
    devices: () => Promise<AparelhoDaConta[] | null>
    /**
     * Remove a device from this account (`Session.revokeDevice`): manifest
     * without it, its leaf out of each channel, and `device.revoke` in each
     * channel.
     *
     * Only on a device with the account key, and never the device itself. Throw
     * with stable key (740-747). Revocation cuts read access from the next epoch
     * onward; what the device already had, it keeps.
     *
     * Optional for the same reason as the rest: a `preload` from another
     * version does not bring it, and its absence reads as "this host cannot
     * revoke".
     */
    revoke?: (deviceKey: string) => Promise<{ ok: boolean }>
    /**
     * "Join another account" (phase 8.2), on the device with the extra account.
     * Three steps, in this order, each only after the previous:
     *
     * - `juntar(link)`: regular device pairing, on the guest side, but the
     *   certificate stays in memory and the vault does not change. Phases arrive
     *   on `on.pair`, and the six words are answered with `confirm` and
     *   `refuse`.
     * - `juntarAvisar()`: with the secondary key, notify each direct and each
     *   channel, break friendships, and exit all channels. Throw if any channel
     *   is left without exiting, and then nothing is erased.
     * - `juntarTrocar(frase)`: the vault becomes the primary's (provisional
     *   first, saved over it at the end). The secondary key exits here.
     *
     * `juntarCancelar` drops everything before the third step. Optional for the
     * same reason as the rest: a `preload` from another version does not bring
     * them.
     */
    juntar?: (link: string) => Promise<{ ok: boolean }>
    juntarAvisar?: () => Promise<{ ok: boolean }>
    juntarTrocar?: (passphrase: string | null) => Promise<{ address: string }>
    juntarCancelar?: () => Promise<{ ok: boolean }>
  }
  /**
   * The account state that travels between devices (phase 5): read marks,
   * archived chats, and interface preferences.
   *
   * Lives in the vault and moves to sibling devices via the account channel. It
   * was the `localStorage` of this browser (`enclave.lastRead`,
   * `enclave.dmClosed`), and for that reason it did not leave here. Changes
   * that arrive from a sibling come on `on.lidas`, `on.arquivo`, and
   * `on.preferencias`, with the full map.
   *
   * Optional: a `preload` from another version does not bring it, and the
   * interface falls back to what this device knows (nothing traveling).
   */
  estado?: {
    /** The timestamp of the last read message, per channel. */
    lidas: () => Promise<Record<string, number>>
    /** Mark a channel as read up to `at`. Only moves forward. Throws 720 or 721. */
    marcarLido: (channel: string, at: number) => Promise<{ ok: boolean }>
    /** Archived conversations, with the timestamp when they were archived. */
    arquivo: () => Promise<Record<string, number>>
    /**
     * Throws 725. `at` is the timestamp of the gesture if it wasn't just now (browser
     * migration): the core records `min(at, agora)`, and a timestamp older than
     * what the account already has changes nothing.
     */
    arquivar: (channel: string, at?: number) => Promise<{ ok: boolean }>
    desarquivar: (channel: string) => Promise<{ ok: boolean }>
    /** The UI preferences that travel across devices (see `lib/estadoDaConta.ts`). */
    preferencias: () => Promise<Record<string, string>>
    /**
     * Throws 722, 723 or 724. `at` seeds with a low timestamp (1): the
     * preference the account already has wins. Without `at`, it is the current
     * preference.
     */
    definirPreferencia: (chave: string, valor: string, at?: number) => Promise<{ ok: boolean }>
  }
  /**
   * Sync between accounts for the UI (S5): the state of each channel
   * (Diagnostic and the "Receiving channel..." bar) and the first position of
   * this device in a channel (the "You joined here" marker).
   *
   * Optional: a `preload` from an older version does not include it, and the UI
   * neither shows the bar nor the marker.
   */
  sincronia?: {
    estado: () => Promise<SincroniaDoCanal[]>
    /** `null` for whoever created the channel and for channels from before this version. */
    lugarEm: (channel: string) => Promise<{ seq: number; em: number } | null>
    /**
     * The history from a sibling device (1.0 "Arca"), now. Optional: a bridge
     * from before does not include it, and the UI does not show the bar.
     */
    historico?: () => Promise<HistoricoDosIrmaos>
  }
  /**
   * The bytes of an attachment where we only have the name, requested from
   * other members when the person opens it (S5, §5.4). Never throws: the outcome
   * says what happened. Optional, like the one above.
   */
  /**
   * Video for posts (26/10/2026). Optional like the one above: a `preload` from
   * another version does not include it, and the UI does not offer video.
   */
  video?: {
    /** Post with a video. Resolves when the last chunk sent; cancelled, rejects. */
    publicar: (caption: string, tags: string[], extras: PostExtras, video: VideoAPublicar) => Promise<{ ok: boolean; id: string }>
    /** Cancel the post in progress. The post is deleted. */
    cancelar: () => Promise<boolean>
    /** What this device has of the video with this digest. */
    estado: (sha: string) => Promise<EstadoDoVideo>
    /** The video bytes (from memory or vault), or `null`. */
    bytes: (sha: string) => Promise<Uint8Array | null>
  }
  anexo?: {
    pedir: (id: IdDoAnexo) => Promise<DesfechoDoAnexo>
    /** Give up on a request (waiting in queue, or running). Its `request` call ends "cancelled". */
    cancelar?: (id: IdDoAnexo) => Promise<boolean>
  }
  session: {
    connect: () => Promise<{ ok: boolean }>
    /** hello.ok capabilities — how the client feature-detects live presence. */
    capabilities: () => Promise<string[]>
    /**
     * The common channel this server advertises, or nothing if it advertises
     * none.
     *
     * The UI gets the official status of a channel from here, and it is
     * intentional that the answer comes from the server not the channel
     * metadata: metadata is written by clients, and a stamp any client writes
     * does not prove anything. See `lib/oficial.ts`.
     *
     * Comes from `hello.ok`, like capabilities, so there is an answer only after
     * the connection opens, and that is why it is read in the same place where
     * capabilities are read, on the shift to "online".
     *
     * Optional like the other additions to the bridge: an older host (Electron
     * running a `preload` from another version) does not have it, and the
     * absence reads as "this server does not advertise a common channel", no
     * channel becomes official, which is the safe failure mode.
     */
    commonRoom?: () => Promise<string | null>
    /**
     * The account choice about the common channel (3/11/2026): `false` at
     * signup, before the first connection, so the account does not join; `true`
     * at the "Join Orwell channel" button, which joins right away. See
     * `salaComum.ts` in the core.
     *
     * Optional like `commonRoom`: an older host does not have it. At signup, the
     * absence means the account joins, as before; and the button to join later
     * does not appear.
     */
    escolherSalaComum?: (entrar: boolean) => Promise<{ ok: boolean }>
    /** Announce this connection to channel-mates, or not. Hides you from
     * people; the server still knows, because it must. */
    setVisible: (visible: boolean) => Promise<{ ok: boolean }>
    /**
     * A round trip to the server in milliseconds, or `null` if there is no
     * measurement.
     *
     * Distance to the SERVER, never to a person: outside a call there is no
     * peer connection to measure. Inside a call there is a better and different
     * number, `call.measureLatency`, which measures to the other person. These
     * are different things and should not be presented with the same word.
     *
     * Optional like the other additions to the bridge: a `preload` from another
     * version does not have it, and the absence reads as "no measurement", which
     * is to draw nothing.
     */
    latency?: () => Promise<number | null>
    /**
     * Does the connection still carry anything? A `ping` with a short deadline;
     * with no `pong`, the session treats the connection as dropped and connects
     * again. `true` when the connection is alive, `false` when it is dead or
     * there is no connection.
     *
     * This guards against the phone's half-open connection (1.3.6): a socket
     * that says `OPEN` but no longer carries anything to anyone. Optional like
     * the other additions: an old `preload` does not have it, and then nothing
     * is checked.
     */
    verificarLigacao?: () => Promise<boolean>
    /**
     * Does this session still write? `false` after the tab loses ownership of
     * the vault or gets stale code (`pararDeEscrever` from the web host):
     * `connect` is then refused with "this tab no longer writes". Synchronous,
     * to read in the middle of a render (disable the compose box). Absent: it
     * writes.
     */
    escreve?: () => boolean
  }
  channels: {
    list: () => Promise<string[]>
    /**
     * The channels this account was removed from, with history kept here.
     * See `archivedChannels` in the core. Optional: an old bridge does not have
     * it.
     */
    archived?: () => Promise<{ channel: string; archivedAt: number }[]>
    /**
     * Create a channel with initial rooms. `name` is the name the person typed
     * (1.0 "Arca", slice 3): the address is random, and the name goes encrypted
     * in `room.created` and `space.meta`. Optional: an old bridge ignores it.
     */
    create: (channel: string, nome?: string) => Promise<{ ok: boolean }>
    /**
     * How the channel presents itself: real name, description and icon.
     *
     * `meta` reads from the vault and returns immediately, so the name is on
     * screen before the network responds. `setMeta` publishes to the channel,
     * and all members converge to the most recent write.
     *
     * `updatedAt` is part of the response, not decoration: whoever reads this
     * compares the vault against `space.meta` entries still in memory, and the
     * comparison is by date. Without it the vault would be worthless in that
     * account and lose against any old republish, see `Session.spaceMeta`,
     * where the full cost is explained.
     */
    meta: (channel: string) => { name: string; topic?: string; icon?: string; updatedAt: number } | null
    /**
     * What each channel is (direct, wall, room, account), with the peer and the
     * owner, read from the vault (1.0 "Arca", slice 2). Synchronous like `meta`:
     * the UI asks for it on each list change and stores it in
     * `lib/tipoDoCanal.ts`. Optional by the `preload` rule from another version;
     * without it, the UI reads the old form through the single port of the core.
     */
    fichas?: () => Record<string, FichaDoCanal>
    setMeta: (channel: string, next: { name: string; topic?: string; icon?: string }) => Promise<{ ok: boolean }>
    /**
     * Whether this account administers the channel.
     *
     * Authority goes to whoever created it and whoever they appointed. A channel
     * with no recorded founder, those born before this, has no owner, and
     * authority is with any member.
     */
    mayEdit: (channel: string) => boolean
    /** Who created the channel, or null if it was born before this existed. */
    founder: (channel: string) => string | null
    /** Who administers the channel, besides whoever created it. */
    admins: (channel: string) => string[]
    /** Appoint or remove someone as channel administrator. */
    setAdmin: (channel: string, address: string, admin: boolean) => Promise<{ ok: boolean }>
    /**
     * The roles declared in the channel, already ordered. Does not include the
     * built-in `admin`: the label of a built-in role comes from the UI, not the
     * core.
     */
    roles: (channel: string) => ChannelRole[]
    /**
     * The name and color that whoever manages roles gave to the built-in
     * `admin`, or null if nobody changed them (the UI then says "Administrator").
     * Changed with `defineRole` and `role: "admin"`; its powers do not change.
     * Optional: an old host does not bring it.
     */
    adminRole?: (channel: string) => { name: string; colour?: string } | null
    /** The roles of a person in this channel, by identifier. */
    rolesFor: (channel: string, address: string) => string[]
    /** Give someone the set of roles they now have. Empty list is no roles. */
    setRoles: (channel: string, address: string, roles: string[]) => Promise<{ ok: boolean }>
    /** Create or modify a role. `role` is the identifier and never changes. */
    defineRole: (channel: string, next: ChannelRole) => Promise<{ ok: boolean }>
    deleteRole: (channel: string, role: string) => Promise<{ ok: boolean }>
    /**
     * The order of roles, top to bottom: the hierarchy, which travels in `rank`
     * (and in `position`, for 1.1.x clients). Only the founder and whoever has
     * `admin`; the core refuses others. Optional: a host without it does not
     * offer dragging or arrows.
     *
     * Outside `permissoes` on purpose: the desktop app does not yet bring the
     * full model (D-P3), and ordering cannot wait for it. One port, for both
     * editors.
     */
    reorderRoles?: (channel: string, ordem: string[]) => Promise<{ ok: boolean }>
    /** Whether this account can create, delete and assign roles in this channel. */
    mayManageRoles: (channel: string) => boolean
    /**
     * The rooms inside a channel, already ordered.
     *
     * Empty means a channel with no declared rooms, and the UI shows it as it
     * always has: a single conversation. This is what keeps older channels
     * working without any migration.
     */
    rooms: (channel: string) => ChannelRoom[]
    /**
     * The closed rooms, so there is a way to reopen them.
     *
     * Optional: a host that does not bring it makes the UI behave as if none
     * were closed. See `closedRoomsOf` in the core.
     */
    closedRooms?: (channel: string) => ChannelRoom[]
    /**
     * The categories declared in this channel, in order.
     *
     * Optional, like the other additions to the bridge: a host that does not
     * bring it makes the UI behave as it always has, categories exist because
     * rooms name them, and none is born empty.
     *
     * `roles` are the roles that see the rooms in the category, and **empty is
     * everyone**. An older host returns entries without the field, and the UI
     * reads the absence as empty: no category is hidden because the host does
     * not know how to talk about this, which is the safe failure mode.
     *
     * With `removed: true` come the tombstones (3/11/2026): the category was
     * deleted, and `updatedAt` says when. They are not drawn; they prevent a
     * republish from before the tombstone from bringing the category back.
     */
    categories?: (
      channel: string,
    ) => { category: string; position: number; roles?: string[]; updatedAt?: number; removed?: true }[]
    /**
     * Declare a category, or withdraw the declaration. See `upsertCategory`.
     *
     * Missing `roles` is an empty list, not "leave it as it was": the most
     * recent declaration wins entirely. Whoever republishes only the position is
     * saying the category is for everyone, see the comment in the core, and
     * `arrumarCategoria` in `App.tsx`, which for that reason resends the roles
     * the category already had.
     */
    setCategory?: (
      channel: string,
      next: { category: string; position?: number; roles?: string[]; removed?: boolean; reordenar?: boolean },
    ) => Promise<{ ok: boolean }>
    /**
     * Create or modify a room. Only for whoever administers the channel.
     *
     * `removed` is the tombstone: it publishes that the room no longer exists,
     * and cannot be undone. Only set on a room already closed, closing is
     * reversible and exists to be the step before this, which is the best
     * protection there is against mistake. The default room refuses it in the
     * core.
     */
    setRoom: (channel: string, next: ChannelRoom & { closed?: boolean; removed?: boolean }) => Promise<{ ok: boolean }>
    /**
     * Pinned messages in a room, oldest to newest.
     *
     * Optional, like the other extensions: a host that does not bring it makes
     * the interface behave as always, no banner at the top and no menu entry.
     * Absence never means "there is none".
     *
     * `body` is the COPY made by whoever pinned it, not the message itself: if
     * someone has the original in history, they read it from there, and this is
     * what remains for those who do not, which is everyone who joined the
     * channel after it was sent.
     */
    pins?: (channel: string, room: string) => PinnedMessage[]
    /**
     * Pin a message at the top of the room, or unpin it.
     *
     * The text copy comes from here: whoever pins it makes the copy, which is
     * why the interface must pass the entire message, not just the identifier.
     *
     * The real refusal lives in the core, and the second half of it in the
     * receiver. This is what we OFFER, see `mayPin`.
     */
    pin?: (
      channel: string,
      room: string,
      message: { id: string; sender: string; body: string; sentAt: number },
    ) => Promise<{ ok: boolean }>
    unpin?: (channel: string, room: string, id: string) => Promise<{ ok: boolean }>
    /**
     * Whether this account has the power to pin messages in this channel.
     *
     * Absent means "cannot", as in `mayMove` and for the same reason: offering
     * a gate that will be refused is worse than not showing it.
     */
    mayPin?: (channel: string) => boolean
    /**
     * The ticket frame of a room, as this device reads it.
     *
     * Optional like the other extensions: a host that does not bring it makes
     * the frame appear empty instead of crashing. See `ticketsOf` in the core,
     * which folds the messages and discounts what came from someone without the
     * power to say it.
     */
    tickets?: (channel: string, room: string) => Ticket[]
    /** Open a ticket. Anyone in the channel can do this. Returns the identifier. */
    openTicket?: (channel: string, room: string, subject: string) => Promise<{ ok: boolean; id?: string }>
    /** Reply within a ticket. It is a message with a marker, nothing more. */
    replyToTicket?: (channel: string, room: string, ticket: string, body: string) => Promise<{ ok: boolean }>
    /**
     * Change the state of a ticket.
     *
     * The real guard lives in the core and refuses the same way; `mayDecideTicket`
     * is only what the interface needs to know to not offer a gesture that will
     * be refused.
     */
    setTicketState?: (
      channel: string,
      room: string,
      ticket: string,
      state: "open" | "working" | "closed",
    ) => Promise<{ ok: boolean }>
    /** Take a ticket for yourself and move it to in progress in the same action. */
    takeTicket?: (channel: string, room: string, ticket: string) => Promise<{ ok: boolean }>
    /** Drop a ticket without closing it. */
    releaseTicket?: (channel: string, room: string, ticket: string) => Promise<{ ok: boolean }>
    /**
     * Delete a closed ticket: the ticket tombstone (phase 3). Moderators only.
     * Absent, the button does not appear.
     */
    deleteTicket?: (channel: string, room: string, ticket: string) => Promise<{ ok: boolean }>
    /**
     * Whether this account has the power to handle tickets in this channel.
     *
     * Absent reads as "cannot", which is the safe reading, the same one
     * `mayMove` already does.
     */
    mayAttend?: (channel: string) => boolean
    /**
     * Whether this person moderates this channel (the `moderate` power, phase 3):
     * delete messages from others, closed tickets, and change nicknames.
     *
     * With the address, not just "this account": the conversation honors the
     * tombstone of whoever SENT it, and this question is how it knows if it
     * counts. Absent is "nobody moderates", and then tombstones from others do
     * not count, as before phase 3.
     */
    mayModerate?: (channel: string, address: string) => boolean
    /**
     * The nicknames for this channel, by address (phase 3). Absent means none.
     *
     * The nickname appears in front of the name, in the member list and in
     * messages. It changes via `setNickname`: by the person themselves, or by a
     * moderator.
     */
    nicknames?: (channel: string) => Record<string, string>
    /** Change someone's nickname in this channel. Empty removes it. */
    setNickname?: (channel: string, address: string, nick: string) => Promise<{ ok: boolean }>
    /** Whether this account can change the state of THIS ticket: assigned to handle it, or opened it. */
    mayDecideTicket?: (channel: string, room: string, ticket: string) => boolean
    /**
     * Whether this account has the power to move people between voice rooms.
     *
     * Optional: an older host does not bring it, and the interface treats
     * absence as "cannot", which is the safe reading.
     */
    mayMove?: (channel: string) => boolean
    /** Whether this account has the power to invite people to this channel. */
    mayInvite?: (channel: string) => boolean
    /** Whether this account has the power to remove people from this channel. */
    mayExpel?: (channel: string) => boolean
    /**
     * Remove someone from the channel, for real.
     *
     * **The only gesture in the interface with cryptographic effect**, and the
     * opposite of everything else called administration here: inviting,
     * renaming, and moving are convention that each client follows by choice;
     * this advances the epoch and removes keys. Whoever was removed can no
     * longer decrypt what comes next, and there is no gesture, neither from
     * this side nor from theirs, that undoes it. They return with a new invite
     * or not at all.
     *
     * Optional because an older host does not bring it; the interface treats
     * absence as "cannot".
     */
    expel?: (channel: string, address: string) => Promise<{ ok: boolean }>
    /**
     * Ask someone's client to move to a different voice room.
     *
     * **Convention, not cryptography.** The request travels encrypted, but
     * whoever fulfills it is the other person's client, by their choice, see
     * `voice.move` in the protocol. It has the same standing as inviting and
     * changing the name, and the opposite of removing, which really takes away
     * the keys.
     */
    moveVoice?: (channel: string, address: string, room: string, de?: string) => Promise<{ ok: boolean }>
    /**
     * "Disconnect from the call": remove someone from the voice call in this
     * channel. The same power and standing as move (`move`, convention). Optional:
     * an older host does not bring it, and the menu entry does not appear.
     */
    disconnectVoice?: (channel: string, address: string, de?: string) => Promise<{ ok: boolean }>
    /**
     * Whether this account can move someone from room `de` to room `para` (1.2,
     * per-room permissions). Without `para`, whether they can disconnect someone
     * who is in `de`. Optional: without it the interface reads `mayMove`, as
     * before.
     */
    mayMoveIn?: (channel: string, de: string, para?: string) => boolean
    /**
     * Whether this account can mention everyone (`@all`) in this room: the
     * `mentioneveryone` permission, with room overrides. Only decides what the
     * message box offers; the core checks on send and receive. Optional: absent
     * means "cannot".
     */
    mayMentionAll?: (channel: string, room: string) => boolean
    /**
     * The permission model of 1.2 (`permissoes.ts` in the protocol). All
     * optional: an older host does not bring it, and the `CargosEPermissoes`
     * component does not mount.
     */
    permissoes?: {
      /** Everyone's base permissions (`@todos`). */
      todos: (channel: string) => { powers: Power[]; definido: boolean }
      /** What this person can do, in the channel or in a room. */
      em: (channel: string, address: string, lugar?: LugarDaSobreposicao) => Power[]
      /** Whether this account changes THIS role (hierarchy and escalation). */
      mayManageRole: (channel: string, role: string) => boolean
      /** Whether role delegation is on in this channel (D13). */
      delegacao: (channel: string) => boolean
      sobreposicoes: (channel: string, lugar: LugarDaSobreposicao) => SobreposicaoDaSala[]
      maySetSobreposicoes: (channel: string, lugar: LugarDaSobreposicao) => boolean
      setSobreposicoes: (channel: string, lugar: LugarDaSobreposicao, perms: SobreposicaoDaSala[]) => Promise<{ ok: boolean }>
    }
    /** Claim an ownerless channel with this account. See `claimFounder`. */
    claimFounder: (channel: string) => Promise<{ ok: boolean }>
    /**
     * Invite someone to a channel.
     *
     * **Does not add anyone to the channel.** Sends an invite, which arrives as
     * a private message; they join if they accept it, and admission is a second
     * action by the inviter's device. See `channelInvites`.
     */
    invite: (channel: string, address: string, note?: string) => Promise<{ ok: boolean }>
    /**
     * The invites that this device knows about, folded from history.
     *
     * One source of truth, read by every place that shows invites: the
     * conversation where it arrived, the conversation list, the bell. Two lists
     * synced by hand diverge at the first change, and what diverges here is not
     * a label, it is who joins what channel.
     */
    channelInvites: () => Promise<InviteTie[]>
    /**
     * Accept an invite. Only resolves after the reply is truly sent.
     *
     * The caller relies on this to only remove the invite from the screen when
     * it is done, an invite that disappears by optimism and fails next does not
     * leave a trace: whoever invited stays waiting forever, and whoever accepted
     * thinks they accepted.
     */
    acceptChannelInvite: (dmChannel: string, target: string) => Promise<{ ok: boolean }>
    /** Decline. Closes the invite on both sides and grants no access. */
    declineChannelInvite: (dmChannel: string, target: string) => Promise<{ ok: boolean }>
    /**
     * Empty or absent `room` is the channel's default room.
     *
     * `extras` carries the images (already compressed) and the link cards that
     * accompany the text. Both travel WITHIN the encrypted message: there is no
     * address pointing outside, and so there is no vault that learns who fetched
     * what and when.
     */
    send: (channel: string, body: string, room?: string, extras?: MessageExtras) => Promise<{ ok: boolean }>
    /**
     * Tell the channel you are typing.
     *
     * Ephemeral end to end: never enters history, on either side, and carries a
     * timeout that erases it on its own. The cadence is decided by the interface
     *, see `hooks/useTyping.ts`, where the numbers are justified.
     */
    typing: (channel: string, room?: string) => Promise<{ ok: boolean }>
    /**
     * A nudge, the MSN nudge.
     *
     * Ephemeral like the typing indicator, and for an even stronger reason: a
     * recorded buzz would be replayed on backfill, and shake the screen of
     * whoever opened the conversation the next day, once for each person there.
     * Only makes sense between two people, the guard lives in `useBuzz`.
     */
    buzz: (channel: string) => Promise<{ ok: boolean }>
    /**
     * Edit and delete a message already sent, in the conversation where it was
     * sent.
     *
     * Optional because an older host does not bring them, and the interface
     * treats absence as "cannot": the menu entries do not appear.
     *
     * Delete is a REQUEST. It leaves the screen of whoever fulfills it; those
     * who already read, have read, and an altered client ignores it. The
     * interface says this in words before anyone taps.
     */
    editMessage?: (channel: string, target: string, body: string) => Promise<{ ok: boolean }>
    deleteMessage?: (channel: string, target: string) => Promise<{ ok: boolean }>
    /** Read from the group's own key tree, so it cannot be padded or trimmed. */
    members: (channel: string) => Promise<string[]>
    /**
     * The channel's stored history, oldest first, from the encrypted vault.
     * This device's copy is the only one: the server never held the plaintext,
     * and forward secrecy makes its ciphertext unreadable once consumed.
     */
    history: (channel: string) => Promise<StoredChatMessage[]>
    /**
     * Stop tracking a channel on this device: group secrets, history and
     * catch-up anchor are erased locally. The other members keep seeing this
     * account in the member list until somebody removes it — that is an MLS
     * fact, and the UI says so before calling this.
     */
    forget: (channel: string) => Promise<{ ok: boolean }>
    /**
     * Leave the channel for real: publish the departure to the group, wait for
     * the server receipt, and only then forget the channel here. Those who stay
     * remove us from the tree on the next commit, and stop seeing us in the list.
     *
     * Fire without connection, and forget nothing in that case: the interface
     * then offers `forget`, named for what it is. Optional because an older
     * `preload` does not bring it; the lack reads as failure, never as a silent
     * `forget`.
     */
    leave?: (channel: string) => Promise<{ ok: boolean }>
    /**
     * End the channel for everyone: publish the tombstone and drop it from here.
     *
     * The cap, which the interface repeats before calling this: **messages are
     * not deleted**. They are encrypted in each person's vault and there is no
     * way to reach them; an altered client ignores the tombstone and keeps what
     * it had.
     *
     * Optional, like the other extensions to the bridge: an older host does not
     * have it, and absence reads as "cannot be deleted", the failure in the safe
     * direction, which is the rule of this bridge.
     */
    remove?: (channel: string) => Promise<{ ok: boolean }>
    /**
     * Whether this account can end this channel, here and now.
     *
     * Joins the `delete` power to exceptions that do not depend on any power,      * a feed channel, a two-person conversation, the server common room. It comes
     * whole from the core on purpose: a second rule written in the interface
     * would end up disagreeing with the one that really refuses.
     */
    mayDelete?: (channel: string) => boolean
    /**
     * Safety number against one member's leaf signing key, or null when the
     * key cannot be read. Compared out of band; a match rules the server out
     * of the middle.
     */
    safetyNumber: (channel: string, address: string) => Promise<string | null>
  }
  invites: {
    /**
     * Returns the link. The code exists nowhere else, not even on the server.
     * Short form (`/c#…`) when the server gave a short code; otherwise long form.
     */
    create: (channel: string, policy: { expiresInSeconds?: number; maxUses?: number }) => Promise<string>
    redeem: (link: string) => Promise<{ ok: boolean }>
    /**
     * The short link (`/c#<código curto>.<código>`) resolved to the long one, which is
     * what `redeem` and the rest of the interface already read (1.0 "Arca", slice 5b-2).
     * Asks the server for the short code, does not consume a use, and rejects the
     * link whose code is not the invite's. Optional only for test doubles: both
     * bridges have it (`bridge.paridade.test.ts`).
     */
    resolve?: (link: string) => Promise<string>
    /**
     * The channel name of an invite (and the name of who invited), opened from
     * the seal with the long link code (1.0 "Arca", slice 5c). `null` when there
     * is no name to show; never throws. Optional only for test doubles, like
     * `resolve`.
     */
    nome?: (link: string) => Promise<{ canal: string; quem?: string } | null>
    /** The channel's live invites, as the server tracks them: hash, expiry, uses. */
    list: (channel: string) => Promise<StoredInvite[]>
    revoke: (codeHash: string) => Promise<{ ok: boolean }>
  }
  social: {
    post: (caption: string, tags: string[], extras?: PostExtras) => Promise<{ ok: boolean }>
    acceptFollower: (address: string) => Promise<{ ok: boolean }>
    feedChannel: () => Promise<string>
    /** Amend a post's caption; readers only honour the author's own edits. */
    edit: (id: string, caption: string) => Promise<{ ok: boolean }>
    /** Ask readers' devices to drop a post. A request, never an erasure. */
    remove: (id: string) => Promise<{ ok: boolean }>
    /**
     * A like or dislike on a post.
     *
     * The channel is the feed of who posted, and it must be stated: unlike
     * `edit` and `remove`, which only work on what is ours, this travels to
     * another person's group, the only place where people who read the post
     * will receive it.
     */
    react: (channel: string, target: string, emoji: string, remove?: boolean) => Promise<{ ok: boolean }>
    /** A comment on a post, for the same channel and for the same reason. */
    comment: (channel: string, target: string, body: string) => Promise<{ ok: boolean }>
    /**
     * Delete a comment of ours. The channel comes first for the usual reason: the
     * comment is in the feed of who posted, and that is where it must be deleted.
     *
     * Only the author deletes what they wrote, and that is enforced by who reads
     * it against the authenticated sender, sending the request is something any
     * group member can do, and no honest client obeys it.
     */
    removeComment: (channel: string, id: string) => Promise<{ ok: boolean }>
    /**
     * The title, description and image that a page declares, fetched outside
     * this separator.
     *
     * Exists because inside a browser direct reading fails on most sites, and a
     * link card without a title is a raw address. In Electron this runs in the
     * main process, where there is no such barrier and no one else gets to know;
     * on the web it goes through the homeserver, which then sees what link is
     * being posted. The reader never reaches here, by either path: what this
     * returns travels inside the encrypted message.
     *
     * The image comes in data URL format for transport. The client shrinks it
     * before posting, see `shrinkToThumbnail`.
     */
    linkPreview: (url: string) => Promise<{
      title?: string
      description?: string
      siteName?: string
      image?: string
    }>
    /** A friend request, sent into a channel the two already share. */
    friendRequest: (channel: string, note?: string) => Promise<{ ok: boolean }>
    /**
     * Accept a request: give them a place in my feed and tell them where they asked.
     *
     * Only resolves after the place is given. The caller relies on this to only
     * remove the request from the screen when it is done, a request that vanishes
     * by optimism and fails next leaves no trace and cannot be recovered.
     */
    acceptFriend: (channel: string, address: string) => Promise<{ ok: boolean }>
    /** Reject a request. Closes it on both sides and gives no access. */
    declineFriend: (channel: string) => Promise<{ ok: boolean }>
    /**
     * Cancel a request of ours that still has no response: only with the tie in
     * `pedido-enviado`. In a `cruzado` you cannot cancel (a 0.5.x client would
     * read the rejection of their request); there you offer accept or reject.
     * Closes the request on both sides. Without `pedido-enviado` throws
     * "there is no friend request to cancel" (603).
     *
     * On the other side, live, a `status` with `code: "friend-withdrawn"`,
     * `actor` (who cancelled) and `channel` arrives: that is the cue to remove
     * the request from the bell. In the UI layer, the event is a `friend.decline`
     * with `withdrawn: true` (see `FriendPayloadShape`).
     *
     * Optional, this and the following ones, like the other extensions to the
     * bridge: an older host does not bring them, and what cannot be used does
     * not appear.
     */
    cancelFriendRequest?: (address: string) => Promise<{ ok: boolean }>
    /**
     * Block: ends the friendship, removes them from my feed, leaves their feed,
     * and stops recording and showing what they say in direct and in both feeds.
     * In shared rooms nothing changes. Lives in the vault of THIS device: another
     * device on the same account does not know. Throws "you cannot block yourself"
     * (604) or "that is not an account address" (605). After this, `openDirect`,
     * `friendRequest` and `acceptFriend` with this person throw "that person is
     * blocked" (602).
     */
    block?: (address: string) => Promise<{ ok: boolean }>
    /** Unblock. The friendship does not come back by itself: a new request is needed. */
    unblock?: (address: string) => Promise<{ ok: boolean }>
    /** Who is blocked on this device, from most recent block to oldest. */
    blocked?: () => Promise<{ address: string; at: number }[]>
    /**
     * Show my friends a list of my friends (opt-in; `[]` stops showing). Only
     * live friends enter, the rest fail silently. More than 500 throws "too many
     * friends to show" (606).
     *
     * The choice is saved right away (`shownFriendsOf` with my address returns it),
     * and only the last one comes out, about 3 seconds after the last call: the
     * promise resolves then. Before it comes out, anyone in my feed who is not a
     * friend is removed from it: a feed is for friends, and this INCLUDES old
     * followers with no friendship (coordinator decision, 20/10/2026, for owner
     * review). Only whoever has a pending request or is being accepted at that
     * moment stays. If removal fails (no network), nothing comes out and throws
     * "your feed has people who are not friends" (607).
     */
    setShownFriends?: (list: string[]) => Promise<{ ok: boolean }>
    /**
     * The list a person shows, or `null` if they do not show it or we are not
     * friends. With my address, my choice. No "mutual friends".
     */
    shownFriendsOf?: (address: string) => Promise<{ shown: string[]; updatedAt: number } | null>
    /**
     * Run now the reconciliation that the session runs at each connection: direct
     * chats to open, missing feed slots and requests to retry. Does nothing
     * without a connection. This is "Repair friendships" in Diagnostics. See
     * `sincronizarAgora` in core.
     */
    sincronizarAgora?: () => Promise<{ ok: boolean }>
    /**
     * End the friendship: remove them from my feed, and ask their client to
     * remove me from their feed. See `unfriend` in core.
     */
    unfriend: (address: string) => Promise<{ ok: boolean }>
    /**
     * The friend ties, folded by core (`Session.friendTies`), in server order.
     * It is the only fold: the UI reads from here and from `on.amizades`, and
     * never from the messages it has in view (phase 1d).
     */
    friendTies?: () => Promise<FriendTie[]>
    /**
     * Accounts that became other accounts (phase 8.2), by old address. The UI
     * hides them from lists and offers, once, "Add?" to who was a friend and
     * "Invite?" to who can invite in a channel where they were.
     */
    sucessoes?: () => Promise<Record<string, Sucessao>>
    /** Close an offer without doing anything: `amigo`, a channel, or `*` for all. */
    marcarSucessao?: (de: string, feito: string) => Promise<{ ok: boolean }>
    /** "Add?": the friend request to the account that succeeds. Never joins by itself. */
    adicionarSucessora?: (de: string) => Promise<{ ok: boolean }>
    /** "Invite?": the invite to the account that succeeds, for this channel. */
    convidarSucessora?: (de: string, channel: string) => Promise<{ ok: boolean }>
    /** The direct channel with one person, created on first use. */
    openDirect: (address: string) => Promise<string>
    /**
     * Re-invite on the repair path, rate-limited per (person, channel).
     *
     * The outcome is what the interface must report, and the four cases are
     * genuinely different: a welcome went out and they have to open the app
     * ("invited"/"reseated"), the cryptography already proves they are reading
     * ("live"), this device has not heard enough from the channel to judge and
     * did nothing on purpose ("unproven"), the rate limiter declined an
     * unattended retry ("cooldown"), or the account is seated but one of its
     * devices has no key packages to be seated with ("device-unreachable":
     * nothing spent, brake recorded). `force` lifts the cooldown only — never
     * the liveness proof.
     */
    repairInvite: (
      channel: string,
      address: string,
      force?: boolean,
    ) => Promise<{ invited: boolean; outcome: RepairOutcome }>
    /** Channels whose invitation could not be opened on this device. */
    deadWelcomes: () => Promise<string[]>
    /** Channels whose events keep arriving and never open: deafness, not
     * silence. The difference matters more than any other diagnostic. */
    deafChannels: () => Promise<string[]>
    /** Forget written-off invitations and ask the server for them again. */
    resyncWelcomes: (channel?: string) => Promise<{ ok: boolean }>
    /**
     * Ask who publishes in a feed to republish the latest ones.
     *
     * **The frame already existed and the button did not.** `channel.rejoin.request`
     * makes the device of who publishes respond with a new seat
     * (`#answerRejoin` → `#reseat`), and a new seat makes the group grow, which
     * triggers `republishPosts` on the other side. It was the only path that
     * brought old posts back within reach of who could not decrypt them, and it
     * only ran by accident, when deafness was declared.
     *
     * Brings the LAST 30, not everything (`POSTS_REPUBLICADOS`), and the UI must
     * say so: promising the entire history would be a lie, because the rest was
     * encrypted for a seat that no longer exists.
     *
     * Optional like the other extensions to the bridge: an older host does not
     * bring it, and the UI treats the absence as "not possible", the house rule
     * is that what cannot be used does not appear.
     */
    pedirPublicacoes?: (channel: string) => Promise<{ ok: boolean }>
    /** Community mode: seat every local account in my feed, and list them.
     * Empty on servers that do not run the mode. */
    syncCommunity: () => Promise<string[]>
  }
  notifications: {
    /** The persisted in-app notification log, oldest data included. */
    list: () => Promise<{ id: string; kind: string; at: number; actor?: string | undefined; channel?: string | undefined; read: boolean }[]>
    save: (
      entries: { id: string; kind: string; at: number; actor?: string | undefined; channel?: string | undefined; read: boolean }[],
    ) => Promise<{ ok: boolean }>
  }
  /**
   * The polls: one verb only, and it is to vote.
   *
   * Creating a poll does not go through here on purpose, it travels INSIDE a
   * message (`channels.send`) or a post (`social.post`), as an optional field
   * of those, because a new `t` in the protocol would veto the whole union in
   * an old client. See `Poll` in the protocol. Voting is what needed its own
   * gate, and there is only one for both places: a vote in chat and a vote on
   * the wall are the same act on the same kind of event.
   *
   * `canal` is where the poll was said, the feed of who posted, or the chat
   * where the message is. That is where the people who saw it are, and a vote
   * sent elsewhere reaches no one.
   *
   * `opcao` is the option index, counted from zero. `retirar` undoes the vote.
   *
   * Optional like the other extensions to the bridge: an older host does not
   * bring it, and the UI treats the absence as "not possible", polls keep being
   * read, but without buttons to vote. It is the house rule: what cannot be used
   * does not appear.
   */
  votacoes?: {
    votar: (channel: string, target: string, opcao: number, retirar?: boolean) => Promise<{ ok: boolean }>
  }
  profile: {
    get: () => Promise<Profile>
    set: (profile: Profile) => Promise<{ ok: boolean }>
    /** Every peer profile the vault remembers, so names survive a reload. */
    directory: () => Promise<Record<string, StoredPeerProfile>>
  }
  on: {
    message: (handler: (message: unknown) => void) => () => void
    epoch: (handler: (epoch: unknown) => void) => () => void
    status: (handler: (status: unknown) => void) => () => void
    connection: (handler: (state: unknown) => void) => () => void
    channels: (handler: (channels: unknown) => void) => () => void
    /** Someone sharing a channel with us connected or disconnected. */
    presence: (handler: (event: { address: string; online: boolean }) => void) => () => void
    /**
     * Someone is typing in a channel we belong to.
     *
     * Separated from `message` for the same reason `callActivity` is separated
     * from signaling: this is not something said, it is something happening.
     * Passing it through the message path would put it in the chat line and in
     * the vault.
     */
    typing: (
      handler: (event: { channel: string; from: string; room: string; until: number }) => void,
    ) => () => void
    /** A nudge in a chat we belong to. Ephemeral like the one above. */
    buzz: (handler: (event: { channel: string; from: string; at: number }) => void) => () => void
    /**
     * Somebody joined or left a call, in any channel we belong to.
     *
     * Separate from the call layer's own signalling, which only concerns the
     * call you are already in. This is how you find out one is happening at all
     * — there are no ringing notifications, because a server that could ring
     * your device would be a server that knows who is calling whom.
     */
    callActivity: (
      /** `transmite`: what the person shares in that room, if the announcement says so (phase 1i). */
      handler: (event: {
        channel: string
        from: string
        joined: boolean
        room: string
        transmite?: "ecra" | "musica" | "ecra+musica"
      }) => void,
    ) => () => void
    /** The pairing, step by step. See `pairing`. Optional like it. */
    pair?: (handler: (evento: PairEvento) => void) => () => void
    /** Read marks changed, here or on a sibling device. The entire map. See `estado`. */
    lidas?: (handler: (evento: { lidas: Record<string, number> }) => void) => () => void
    /** The archive changed, here or on a sibling device. The entire map. */
    arquivo?: (handler: (evento: { arquivo: Record<string, number> }) => void) => () => void
    /** Preferences changed, here or on a sibling device. The entire map. */
    preferencias?: (handler: (evento: { preferencias: Record<string, string> }) => void) => () => void
    /** A sibling device blocked or unblocked someone. The list is reread from `social.blocked`. */
    bloqueio?: (handler: (evento: { address: string; bloqueado: boolean }) => void) => () => void
    /** Friend ties changed. The entire list, like `social.friendTies`. */
    amizades?: (handler: (evento: { ties: FriendTie[] }) => void) => () => void
    /** Account successions changed (phase 8.2). The entire map, like `social.sucessoes`. */
    sucessoes?: (handler: (evento: { sucessoes: Record<string, Sucessao> }) => void) => () => void
    /** Another device on the account changed the profile, and this one adopted it (phase 1e). The entire profile, like `profile.get`. */
    perfil?: (handler: (evento: { profile: Profile }) => void) => () => void
    /**
     * A sibling device fetched profiles of other people, newer than those in the
     * directory (profiles across devices). The addresses; the directory is reread
     * from `profile.directory`.
     */
    perfis?: (handler: (evento: { enderecos: string[] }) => void) => () => void
    /** The sync state of a channel changed (S5). Carries the state of that channel. */
    sincronia?: (handler: (estado: SincroniaDoCanal) => void) => () => void
    /**
     * The history of a sibling device (1.0 "Arca"): the progress, and the
     * channels whose history in the vault changed (the UI rereads them). See
     * `HistoricoDosIrmaos`.
     */
    historico?: (handler: (evento: HistoricoDosIrmaos) => void) => () => void
    /** The video of a post: part by part, ready, cancelled or failed. See `video`. */
    video?: (handler: (evento: EventoDoVideo) => void) => () => void
  }
  /**
   * The call object, which always lives wherever the DOM is.
   *
   * Even on desktop this is constructed in the renderer, because WebRTC has no
   * presence in a Node process. It reaches back for per-epoch media keys and
   * nothing else.
   */
  call: Call
  /**
   * Screen sharing, where there is no system selector.
   *
   * **Absent is the normal case**: in the browser Chrome brings its own selector,
   * asks for permission by itself, and the UI has nothing to do. This exists only
   * in the installed application, where `getDisplayMedia` falls into a request to
   * the main process that waits for someone to choose, and if no one chooses,
   * after two minutes the timeout denies it. See `apps/client/src/main/ecra.ts`.
   *
   * Optional like the other extensions to the bridge, and here for a second reason:
   * a preload of another version may not bring it. Absence reads as "this host
   * handles this by itself", which is the right reading in both cases.
   */
  ecra?: {
    /** What can be shared. `semNome` is the label for windows with no title. */
    fontes: (semNome: string) => Promise<FonteDeEcra[]>
    /**
     * The answer to the pending request. `null` is to give up, and it is not an error.
     *
     * **Must be called.** A request without an answer leaves the `getDisplayMedia`
     * on the other side without resolving or rejecting, and on the side of who
     * loaded it there is a button thinking until the application closes.
     */
    escolher: (id: string, fonte: { id: string; nome: string; som?: boolean } | null) => Promise<{ ok: boolean }>
    /**
     * Whether the system has audio output. Without it, the audio picker does not
     * show. Optional: an earlier `preload` may not have it.
     */
    som?: () => Promise<{ disponivel: boolean }>
    /** What the system says about screen recording permission. Always granted outside macOS. */
    permissao: () => Promise<PermissaoDeEcra>
    /** The Settings panel where permission is granted. macOS only. */
    abrirDefinicoes: () => Promise<{ ok: boolean }>
    /** Someone tapped share and needs to pick what to share. Requires a response. */
    aoPedir: (handler: (pedido: { id: string }) => void) => () => void
  }
  /**
   * Is there a new version of the app installed?
   *
   * **Absent is the normal case**, and not an error: in the browser the question
   * makes no sense. The page refreshes with a reload, and whoever opens it is
   * always on the latest. The installed app is the only one that can fall behind,
   * because its renderer is a frozen copy inside `app.asar`.
   *
   * **Alerts but does not update.** On Windows automatic updates run at startup,
   * before the UI, with our Ed25519 signature
   * (`apps/client/src/main/actualizacao-windows.ts`); this is the backup plan.
   * Without our key there would be no secure updater: on macOS Squirrel.Mac
   * requires the signature to swap the app, and on Windows an unsigned updater
   * trusts a checksum served by the same server that serves the executable. That
   * turns a compromised server into code execution on everyone's machine. The
   * full reason is in `apps/client/src/main/actualizacao.ts`.
   *
   * Optional like all other bridge extensions, and here for a second reason: a
   * `preload` from an older version may not have it. Absence reads as "nothing
   * to say about versions", which is the right reading in both cases.
   */
  actualizacao?: {
    /** What is new, or nothing. **Never throws**: no network is `null`, which is
     *  the same as being up to date. */
    verificar: () => Promise<AvisoDeActualizacao | null>
    /** Do not alert again for this version. The alert happens once per version. */
    dispensar: (versao: string) => Promise<{ ok: boolean }>
    /**
     * Open the downloads page in the system browser.
     *
     * **No arguments, and this is by design not an optimization.** The address
     * lives in the main process as a constant. If this function took one, the
     * UI and anything running inside it could choose where to send someone to
     * download an executable.
     */
    abrir: () => Promise<{ ok: boolean }>
    /**
     * The outcome of automatic update on this startup (Windows only), for
     * "Send logs": a stable code ("up-to-date", "bad-signature", etc) and the
     * version involved. `null` when no update was attempted. Optional: a
     * `preload` before 1.0.7 does not have it. See
     * `apps/client/src/main/actualizacao-windows.ts`.
     */
    diagnostico?: () => Promise<{ quando: number; codigo: string; versao?: string } | null>
  }
  /**
   * Global keyboard shortcuts for the desktop app: mute the mic and toggle audio
   * with the window minimized, hidden, or behind another app (item 5 of
   * `docs/planos/depois-da-1-0.md`). See `apps/client/src/main/atalhos.ts`.
   *
   * **Absent is normal in the browser**: a page cannot listen to another app's
   * keyboard, and the shortcuts screen says they only work with the page in
   * focus. Optional too because an old `preload` does not have it.
   */
  atalhosGlobais?: {
    /**
     * Register these shortcuts as global, replacing any previous ones. `null`
     * clears all. The UI calls this when joining and leaving a call.
     */
    definir: (pedido: PedidoDeAtalhosGlobais | null) => Promise<EstadoDosAtalhosGlobais>
    /** Pause (or resume) global shortcuts while the user is recording a new key. */
    suspender: (sim: boolean) => Promise<{ ok: boolean }>
    /** The Accessibility panel in System Settings. macOS only. */
    abrirAcessibilidade: () => Promise<{ ok: boolean }>
    /** A global shortcut was pressed. */
    aoAccionar: (handler: (accao: ComandoGlobal) => void) => () => void
  }
  /**
   * The game overlay for the desktop app: a pill on top of the game showing the
   * voice room and who is speaking (requested by the owner on November 2, 2026).
   * See `apps/client/src/main/overlay-janela.ts`.
   *
   * Absent in the browser: a page cannot open windows on top of another app. All
   * calls here are fire-and-forget: nothing comes back.
   */
  overlay?: {
    /** The voice room summary, or `null` outside a room. */
    estado: (resumo: ResumoParaAOverlay | null) => void
    /** New faces, scaled down, by id (data URL, or `null` with no face). */
    caras: (caras: Record<string, string | null>) => void
    preferencias: (preferencias: PreferenciasDaOverlay) => void
    /** The shortcut with the window in focus: same as the global one. */
    alternar: () => void
    /** Move back to the center, at the top. */
    repor: () => void
  }
  /**
   * "Send logs" (Help and diagnostics, phase 4): sends the diagnostic log to
   * the account server, with the address and version. The bridge picks the
   * server from the open account: the UI provides no address. Throws "could not
   * reach the homeserver" offline, "too many logs sent" at the rate limit (10
   * per hour), and "the server did not take the log" on rejection. Optional: an
   * old `preload` does not have it, and the button does not appear.
   */
  relato?: {
    enviar: (pedido: { texto: string; versao: string }) => Promise<{ ok: true }>
  }
  /**
   * Reports (`docs/planos/denuncias-design.md`). The bridge picks the server
   * and version, like with `relato`: the UI only provides the target and choice.
   *
   * - `preparar`: the report assembled from the vault, for preview.
   * - `enviar`: throws the keys from `enviarPedidoAssinado` ("Error 216" to "220").
   * - `lista`: reports that reached this founder, in a channel, newest first.
   *   Vault reports only: does not reach the server.
   * - `marcarLida`: marks one as read, in the vault.
   *
   * Optional: an old `preload` does not have it, and the UI shows nothing.
   */
  denuncias?: {
    preparar: (alvo: AlvoDaDenuncia) => Promise<DenunciaPreparada>
    enviar: (preparada: DenunciaPreparada, escolha: EscolhaDaDenuncia) => Promise<{ ok: true }>
    lista: (canal: string) => Promise<DenunciaRecebida[]>
    marcarLida: (id: string) => Promise<void>
    /**
     * How many copies of this channel are on the server waiting for the device
     * with the account key. Stays at zero until a device is paired. From the
     * vault, without hitting the server. Optional: an old `preload` does not
     * have it, and the count is zero.
     */
    porAbrir?: (canal: string) => Promise<number>
    /**
     * Request review of this account suspension, with the note. Throws "Error 219"
     * on rejection, and the keys from `enviarPedidoAssinado` offline or with
     * clock skew. Optional: an old `preload` does not have it.
     */
    pedirRevisao?: (nota: string) => Promise<{ ok: true }>
    /** The suspension notice for this account, or `null` if none. From the signed request, no gateway. */
    suspensao?: () => Promise<AvisoDeSuspensao | null>
  }
  /** Apply mic and camera choices to the next capture. */
  applyMediaPrefs?: (next: {
    noiseSuppression?: boolean
    echoCancellation?: boolean
    autoGainControl?: boolean
    videoQuality?: "auto" | "360p" | "720p" | "1080p"
    /** Which microphone to open. Empty means "whatever the system decides". */
    inputDeviceId?: string
    /** How much to amplify the input. 1 is raw system capture. */
    inputGain?: number
    /** Noise gate: cuts below speech and caps peaks at the output. */
    filtroDeMicrofone?: boolean
    /**
     * Which camera to open. Empty means "whatever the system decides". The UI
     * has sent it since 0.9 (phase 4) and bridges write it to `call.videoDeviceId`.
     * An old host that does not read it ignores it, and the capture opens the
     * system camera as it always has.
     */
    videoDeviceId?: string
    /**
     * "Mic sensitivity" › "Automatic". When off, the bridge passes
     * `limiarDoMicrofone` to `call.audio.definirLimiar`; when on, it passes
     * `null`. Takes effect immediately, even during a call. An old host that
     * does not read it stays on automatic, which is the old behavior.
     */
    sensibilidadeAutomatica?: boolean
    /** The manual sensitivity slider, in dBFS, from -80 to 0. */
    limiarDoMicrofone?: number
  }) => void
}
