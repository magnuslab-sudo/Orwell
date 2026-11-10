import {
  Call,
  ehPerguntaDePresenca,
  erroDaChamada,
  transmissaoDoAnuncio,
  type MediaKeyMaterial,
  type PairEvento,
  type Transmissao,
} from "@enclave/client-core"
import type { FonteDeMedia, Payload, UserAddress } from "@enclave/protocol"
import { registerSystemNoticeHost, type EnclaveBridge, type SystemNotice } from "@enclave/ui"
import { Device } from "mediasoup-client"
import type { FonteDeEcra, PermissaoDeEcra } from "@enclave/ui"
import { desembrulharAnfitriao } from "./envelope.js"

/**
 * The desktop host, seen from the renderer.
 *
 * Everything below is a call across IPC into the main process, where the session
 * actually lives. The one thing constructed on this side is `Call`: WebRTC has
 * no presence in a Node process, so peer connections have to be here.
 */

/**
 * The envelope for a synchronous read. See `main/canais.ts`.
 *
 * Repeated here and not imported from there on purpose: the renderer does not
 * load code from the main process, what connects it is a channel name, and
 * nothing else. It is the same decision that keeps `FonteDeEcra` written twice.
 */
type Resposta<T> = { ok: true; valor: T } | { ok: false; erro: string }

/** The channel operations of the UI bridge, so the signatures come from there. */
type CanaisDaInterface = EnclaveBridge["channels"]

/**
 * What each read returns, taken from the UI bridge and not written again.
 *
 * `ReturnType` and not imported types: this way the shape of what crosses IPC
 * stays TIED to the signature the UI consumes. A room that gains a field now
 * has that field here without anyone remembering to write it, and a read that
 * returns something else stops compiling, which is what we want.
 */
type Salas = ReturnType<CanaisDaInterface["rooms"]>
type Categorias = ReturnType<NonNullable<CanaisDaInterface["categories"]>>
type Propriedades = ReturnType<CanaisDaInterface["meta"]>
type Fichas = ReturnType<NonNullable<CanaisDaInterface["fichas"]>>
type Papeis = ReturnType<CanaisDaInterface["roles"]>
type Fixadas = ReturnType<NonNullable<CanaisDaInterface["pins"]>>
type Tickets = ReturnType<NonNullable<CanaisDaInterface["tickets"]>>

/**
 * What `preload` exposes in `channels`.
 *
 * REQUESTS inherit the signature of the UI bridge, word for word: the browser
 * bridge sends them, and a mismatch of arguments between the two hosts is how
 * the two versions that disagree are born. READS are written by hand because
 * only they change shape crossing the boundary, they bring the envelope.
 */
interface CanaisDoAnfitriao {
  // -------------------------------------------------------- the requests
  list?: CanaisDaInterface["list"]
  archived?: NonNullable<CanaisDaInterface["archived"]>
  create?: CanaisDaInterface["create"]
  invite?: CanaisDaInterface["invite"]
  expel?: NonNullable<CanaisDaInterface["expel"]>
  channelInvites?: CanaisDaInterface["channelInvites"]
  acceptChannelInvite?: CanaisDaInterface["acceptChannelInvite"]
  declineChannelInvite?: CanaisDaInterface["declineChannelInvite"]
  send?: CanaisDaInterface["send"]
  typing?: CanaisDaInterface["typing"]
  buzz?: CanaisDaInterface["buzz"]
  members?: CanaisDaInterface["members"]
  history?: CanaisDaInterface["history"]
  forget?: CanaisDaInterface["forget"]
  leave?: NonNullable<CanaisDaInterface["leave"]>
  safetyNumber?: CanaisDaInterface["safetyNumber"]
  setRoom?: CanaisDaInterface["setRoom"]
  setCategory?: NonNullable<CanaisDaInterface["setCategory"]>
  setMeta?: CanaisDaInterface["setMeta"]
  setAdmin?: CanaisDaInterface["setAdmin"]
  claimFounder?: CanaisDaInterface["claimFounder"]
  remove?: NonNullable<CanaisDaInterface["remove"]>
  setRoles?: CanaisDaInterface["setRoles"]
  defineRole?: CanaisDaInterface["defineRole"]
  deleteRole?: CanaisDaInterface["deleteRole"]
  reorderRoles?: NonNullable<CanaisDaInterface["reorderRoles"]>
  moveVoice?: NonNullable<CanaisDaInterface["moveVoice"]>
  disconnectVoice?: NonNullable<CanaisDaInterface["disconnectVoice"]>
  pin?: NonNullable<CanaisDaInterface["pin"]>
  unpin?: NonNullable<CanaisDaInterface["unpin"]>
  openTicket?: NonNullable<CanaisDaInterface["openTicket"]>
  replyToTicket?: NonNullable<CanaisDaInterface["replyToTicket"]>
  setTicketState?: NonNullable<CanaisDaInterface["setTicketState"]>
  takeTicket?: NonNullable<CanaisDaInterface["takeTicket"]>
  releaseTicket?: NonNullable<CanaisDaInterface["releaseTicket"]>
  deleteTicket?: NonNullable<CanaisDaInterface["deleteTicket"]>
  setNickname?: NonNullable<CanaisDaInterface["setNickname"]>
  editMessage?: NonNullable<CanaisDaInterface["editMessage"]>
  deleteMessage?: NonNullable<CanaisDaInterface["deleteMessage"]>

  // ------------------------------------------------------- as leituras
  rooms?: (channel: string) => Resposta<Salas>
  closedRooms?: (channel: string) => Resposta<Salas>
  categories?: (channel: string) => Resposta<Categorias>
  meta?: (channel: string) => Resposta<Propriedades>
  fichas?: () => Resposta<Fichas>
  mayEdit?: (channel: string) => Resposta<boolean>
  founder?: (channel: string) => Resposta<string | null>
  admins?: (channel: string) => Resposta<string[]>
  mayDelete?: (channel: string) => Resposta<boolean>
  roles?: (channel: string) => Resposta<Papeis>
  adminRole?: (channel: string) => Resposta<ReturnType<NonNullable<CanaisDaInterface["adminRole"]>>>
  rolesFor?: (channel: string, address: string) => Resposta<string[]>
  mayManageRoles?: (channel: string) => Resposta<boolean>
  mayAttend?: (channel: string) => Resposta<boolean>
  mayModerate?: (channel: string, address: string) => Resposta<boolean>
  nicknames?: (channel: string) => Resposta<Record<string, string>>
  mayMove?: (channel: string) => Resposta<boolean>
  mayMentionAll?: (channel: string, room: string) => Resposta<boolean>
  mayInvite?: (channel: string) => Resposta<boolean>
  mayExpel?: (channel: string) => Resposta<boolean>
  pins?: (channel: string, room: string) => Resposta<Fixadas>
  mayPin?: (channel: string) => Resposta<boolean>
  tickets?: (channel: string, room: string) => Resposta<Tickets>
  mayDecideTicket?: (channel: string, room: string, ticket: string) => Resposta<boolean>
}

interface HostApi {
  vault: {
    status: EnclaveBridge["vault"]["status"]
    create: (passphrase: string | null) => Promise<{ ok: boolean }>
    unlock: (passphrase: string | null) => Promise<{ ok: boolean }>
    lock: () => Promise<{ ok: boolean }>
    memorizar?: (ligar: boolean) => Promise<{ ok: boolean }>
    definirPalavraPasse?: (frase: string) => Promise<{ ok: boolean }>
    destroy: () => Promise<{ ok: boolean }>
    export: (passphrase?: string) => Promise<{ data: string }>
    import: (data: string, passphrase: string) => Promise<{ ok: boolean }>
    createProvisional?: (passphrase: string | null) => Promise<{ ok: boolean }>
  }
  /** "Switch account". Optional: an old `preload` does not bring it. */
  contas?: NonNullable<EnclaveBridge["contas"]>
  identity: {
    create: (homeserver: string) => Promise<{ address: string; accountId: string }>
    load: () => Promise<{ address: string; accountId: string }>
    address: () => Promise<string>
  }
  /** Pairing, exactly as the UI bridge asks for it. Optional: an old `preload` does not bring it. */
  pairing?: NonNullable<EnclaveBridge["pairing"]>
  session: {
    connect: () => Promise<{ ok: boolean }>
    capabilities: () => Promise<string[]>
    /** The common channel announced by the server. See `bridge.ts` in `@enclave/ui`. */
    commonRoom: () => Promise<string | null>
    /** The account choice on the common channel. See `bridge.ts` in `@enclave/ui`. */
    escolherSalaComum: (entrar: boolean) => Promise<{ ok: boolean }>
    setVisible: (visible: boolean) => Promise<{ ok: boolean }>
    /** A round trip to the server, in ms. See `bridge.ts` in `@enclave/ui`. */
    latency: () => Promise<number | null>
    /** Whether the session still writes. Synchronous. Optional: an old `preload` does not bring it. */
    escreve?: () => boolean
  }
  /**
   * The channels, as the `preload` exposes them IN PRACTICE.
   *
   * Written out explicitly, and it is the most important fix in this file. It
   * used to say `EnclaveBridge["channels"]` and was given to the interface as
   * is, `channels: host.channels`. The type promised 52 operations from the
   * browser bridge; the `preload` brought 15. **A method declared in the type
   * but missing at runtime does not error: it stays silent**, and silence reads
   * as "this channel has no rooms". While this line existed, adding operations
   * to the type would not force anyone to add them to the other end.
   *
   * Two families, and the difference is in behavior, not in structure:
   *
   *  - REQUESTS return promises, like any `invoke`;
   *  - READS return the envelope from `canais.ts`, already resolved, because
   *    they cross via `sendSync`. The interface calls them in the middle of a
   *    `render` and expects a value, an `invoke` would return a promise, and a
   *    promise is truthy.
   *
   * All optional on purpose: nothing in this process checks the `preload`
   * against this type, they are two separate builds, linked by a channel
   * name, and in development the renderer comes from vite while the `preload`
   * comes from the last build. A missing operation must read as missing and not
   * crash the startup. The test suite guarantees nothing is missing:
   * `scripts/ipc-canais-electron.mjs`.
   */
  channels: CanaisDoAnfitriao
  social: EnclaveBridge["social"]
  /** Cast a vote in a voting. See `bridge.ts` in `@enclave/ui`. */
  votacoes: NonNullable<EnclaveBridge["votacoes"]>
  notifications: EnclaveBridge["notifications"]
  notify: {
    show: (notice: SystemNotice) => Promise<{ shown: boolean; reason?: string }>
  }
  invites: EnclaveBridge["invites"]
  profile: EnclaveBridge["profile"]
  voice: {
    signal: (channel: string, payload: Payload) => Promise<{ ok: boolean }>
    key: (channel: string, address: string, folha?: number) => Promise<MediaKeyMaterial | null>
    /** The SFrame counter block, reserved on the vault side. */
    reservarContador: (channel: string, keyId: number) => Promise<number>
    setActive: (active: boolean) => Promise<{ ok: boolean }>
    ice: () => Promise<{ urls: string[]; username?: string | undefined; credential?: string | undefined }[]>
  }
  /**
   * Negotiation with the SFU, when this server has one.
   *
   * Each of these is a round trip to the main process, where the session lives.
   * The form is that of `SfuSignaling` (see `call-sfu.ts`) with the names from
   * this side of the boundary, and translating between them is what the bridge
   * below does.
   */
  sfu: {
    suporta: () => Promise<boolean>
    entrar: (
      channel: string,
      scope: string,
    ) => Promise<{ rtpCapabilities: unknown; producers: { id: string; kind: "audio" | "video"; address: string }[] }>
    sair: (channel: string, scope: string) => Promise<{ ok: boolean }>
    criarTransporte: (
      channel: string,
      scope: string,
      direction: "envio" | "recepcao",
    ) => Promise<{ id: string; iceParameters: unknown; iceCandidates: unknown; dtlsParameters: unknown }>
    ligarTransporte: (transport: string, dtlsParameters: unknown) => Promise<{ ok: boolean }>
    produzir: (
      transport: string,
      kind: "audio" | "video",
      rtpParameters: unknown,
      fonte?: FonteDeMedia,
    ) => Promise<string>
    fecharProdutor: (producer: string) => Promise<{ ok: boolean }>
    consumir: (
      transport: string,
      producer: string,
      rtpCapabilities: unknown,
    ) => Promise<{ id: string; producerId: string; kind: "audio" | "video"; rtpParameters: unknown }>
    retomar: (transport: string, consumer: string) => Promise<{ ok: boolean }>
    pausar: (transport: string, consumer: string) => Promise<{ ok: boolean }>
    /** Missing in a `preload` earlier than Phase M2: the call stays the same, without the request. */
    pedirFotogramaChave?: (transport: string, consumer: string) => Promise<{ ok: boolean }>
  }

  /**
   * Screen sharing, exposed by the `preload`.
   *
   * Optional here and not just in the interface bridge: a `preload` from
   * another version, the real case is a mid-release update, does not bring
   * it, and reading `.fontes` from `undefined` would crash the renderer
   * startup entirely because of a call feature.
   */
  ecra?: {
    fontes: (semNome: string) => Promise<FonteDeEcra[]>
    escolher: (id: string, fonte: { id: string; nome: string; som?: boolean } | null) => Promise<{ ok: boolean }>
    permissao: () => Promise<PermissaoDeEcra>
    abrirDefinicoes: () => Promise<{ ok: boolean }>
    /** Optional: an earlier `preload` doesn't provide the screen audio. */
    som?: () => Promise<{ disponivel: boolean }>
  }
  /**
   * The new version alert, exposed by `preload`.
   *
   * Optional for the same reason as `ecra`: a `preload` from another version doesn't provide it.
   * The case here is literal: someone running version 0.1.0 has a `preload` that doesn't know what this is. Reading `.verificar` on `undefined` crashes the renderer on startup.
   */
  actualizacao?: NonNullable<EnclaveBridge["actualizacao"]>
  /** "Send log". Optional for the same reason: an old `preload` doesn't provide it. */
  relato?: NonNullable<EnclaveBridge["relato"]>
  /** The reports. Optional for the same reason: an old `preload` doesn't provide them. */
  denuncias?: NonNullable<EnclaveBridge["denuncias"]>
  /**
   * The global shortcuts. Optional for the same reason. `aoAccionar` delivers what crossed the IPC as-is; the shape is validated in the bridge.
   */
  atalhosGlobais?: Omit<NonNullable<EnclaveBridge["atalhosGlobais"]>, "aoAccionar"> & {
    aoAccionar: (handler: (payload: unknown) => void) => () => void
  }
  /** The game overlay. Optional for the same reason: an old `preload` doesn't provide it. */
  overlay?: NonNullable<EnclaveBridge["overlay"]>
  /** The account state across devices. Optional: an old `preload` doesn't provide it. */
  estado?: NonNullable<EnclaveBridge["estado"]>
  /** The sync between accounts and on-demand attachments (S5). Optional for the same reason. */
  sincronia?: NonNullable<EnclaveBridge["sincronia"]>
  anexo?: NonNullable<EnclaveBridge["anexo"]>
  /** The video for posts. Optional for the same reason. */
  video?: NonNullable<EnclaveBridge["video"]>
  on: Omit<EnclaveBridge["on"], "typing" | "buzz" | "pair"> & {
    voice: (handler: (payload: unknown) => void) => () => void
    /** Crosses the IPC as a plain object; the shape is restored in the bridge. */
    pair?: (handler: (payload: unknown) => void) => () => void
    /** Crosses the IPC as a plain object; the shape is restored in the bridge. */
    sfu: (handler: (payload: unknown) => void) => () => void
    /** Cross the IPC as plain objects; the shape is restored in the bridge. */
    typing: (handler: (payload: unknown) => void) => () => void
    buzz: (handler: (payload: unknown) => void) => () => void
    noticeOpen: (handler: (payload: unknown) => void) => () => void
    windowState: (handler: (payload: unknown) => void) => () => void
    /** Someone clicked share screen, and now needs to pick which one. */
    ecraPedido: (handler: (payload: unknown) => void) => () => void
  }
}

/**
 * Channel operations, on this side of the boundary.
 *
 * Three jobs, and none of them is translating names:
 *
 * 1. **Unwrap reads.** What arrives is `{ ok, valor }` or `{ ok, erro }`; what the interface expects is the value. A read that fails returns the default value, the empty list, `false`, `null`, which is the same read the interface already made from absence, and it **complains out loud**. That's the difference between this failure and the one that's been here all along: that one was silent by design.
 *
 * 2. **Cache what was read.** Each read crosses the IPC synchronously and blocks the renderer while the other process answers. The interface makes dozens of these queries per `render`, `mayEdit` alone appears a dozen times, and `rolesFor` once per person in the list. Without cache, typing a letter in the message box would pay for all of them again.
 *
 * 3. **Forget what was cached when state may have changed**: with each message, each epoch, each channel change, and after each request this process makes. Without this, the cache is a stale mirror, which is worse than having no mirror at all.
 *
 * Keys that the host does NOT bring stay out of the object instead of coming as a function that crashes: the interface decides what to offer based on presence, see `bridge.channels.setCategory &&` in `App.tsx` -, and a gate that exists to give an error is worse than a gate that doesn't exist.
 */
function ligarCanais(host: HostApi): { canais: EnclaveBridge["channels"]; esquecer: () => void } {
  const guardadas = new Map<string, unknown>()
  const esquecer = (): void => guardadas.clear()

  const queixar = (nome: string, motivo: string): void => {
    /*
      Out loud, and to the main process.
      
      The renderer `console` is forwarded to the main process `stderr` (see `console-message` in `index.ts`), so this appears in the terminal for whoever runs the app and in the log for whoever installed it. This is the only part of this file that exists for the day when something goes missing again: a read that fails silently is indistinguishable from a channel with no rooms, and that's how 37 operations got lost.
      */
    console.error(`[ponte] channels.${nome}: ${motivo}`)
  }

  /**
   * A synchronous read: from cache, or from the other process.
   *
   * **A failure also gets cached**, and that's a choice. Not caching would mean crossing the boundary again on each `render` for as long as the outage lasted, and each crossing BLOCKS the renderer, so a failing read would quickly turn into a slow app on top of a broken app. The price is that between events, a transient failure reads as the default value; the next event forgets it, and the complaint gets logged.
   */
  function ler<T>(nome: string, argumentos: (string | undefined)[], pedir: (() => Resposta<T>) | undefined, omissao: T): T {
    // `\u0000` as separator: doesn't appear in a channel, room, or person ID, and that's what keeps ("!a", "b") and ("!a\u0000b", "") from reading as the same query.
    const chave = `${nome}\u0000${argumentos.join("\u0000")}`
    if (guardadas.has(chave)) return guardadas.get(chave) as T

    const valor = ((): T => {
      if (!pedir) {
        queixar(nome, "o anfitrião não traz esta leitura")
        return omissao
      }
      const resposta = pedir()
      // A host from another version may respond with anything; the envelope is the contract, and what doesn't meet it is not a value at all.
      if (!resposta || typeof resposta !== "object" || !("ok" in resposta)) {
        queixar(nome, "resposta sem envelope")
        return omissao
      }
      if (!resposta.ok) {
        queixar(nome, resposta.erro)
        return omissao
      }
      return resposta.valor
    })()

    guardadas.set(chave, valor)
    return valor
  }

  /**
   * A request: the host's request, and cache cleared at the end.
   *
   * The end even if it crashes, `finally`, not `then`. A `setRoom` that fails partway through may have published something before failing, and cache that survives that shows the world before the action.
   */
  function pedido<A extends unknown[], R>(nome: string, fazer: ((...argumentos: A) => Promise<R>) | undefined) {
    return async (...argumentos: A): Promise<R> => {
      if (!fazer) throw new Error("this version of the app cannot do that", { cause: { metodo: `channels.${nome}` } })
      try {
        return await fazer(...argumentos)
      } finally {
        esquecer()
      }
    }
  }

  const canais = host.channels

  const canaisDaPonte: EnclaveBridge["channels"] = {
    // ------------------------------------------------------- what was already there
    list: pedido("list", canais.list),
    archived: pedido("archived", canais.archived),
    create: pedido("create", canais.create),
    invite: pedido("invite", canais.invite),
    channelInvites: pedido("channelInvites", canais.channelInvites),
    acceptChannelInvite: pedido("acceptChannelInvite", canais.acceptChannelInvite),
    declineChannelInvite: pedido("declineChannelInvite", canais.declineChannelInvite),
    send: pedido("send", canais.send),
    typing: pedido("typing", canais.typing),
    buzz: pedido("buzz", canais.buzz),
    members: pedido("members", canais.members),
    history: pedido("history", canais.history),
    forget: pedido("forget", canais.forget),
    leave: pedido("leave", canais.leave),
    safetyNumber: pedido("safetyNumber", canais.safetyNumber),

    // ---------------------------------------------------------- as salas
    rooms: (channel) => ler("rooms", [channel], canais.rooms && (() => canais.rooms!(channel)), []),
    setRoom: pedido("setRoom", canais.setRoom),

    // -------------------------------------------- the channel and who owns it
    meta: (channel) => ler("meta", [channel], canais.meta && (() => canais.meta!(channel)), null),
    fichas: () => ler("fichas", [], canais.fichas && (() => canais.fichas!()), {}),
    setMeta: pedido("setMeta", canais.setMeta),
    mayEdit: (channel) => ler("mayEdit", [channel], canais.mayEdit && (() => canais.mayEdit!(channel)), false),
    founder: (channel) => ler("founder", [channel], canais.founder && (() => canais.founder!(channel)), null),
    admins: (channel) => ler("admins", [channel], canais.admins && (() => canais.admins!(channel)), []),
    setAdmin: pedido("setAdmin", canais.setAdmin),
    claimFounder: pedido("claimFounder", canais.claimFounder),

    // ---------------------------------------------------------- the roles
    roles: (channel) => ler("roles", [channel], canais.roles && (() => canais.roles!(channel)), []),
    rolesFor: (channel, address) =>
      ler("rolesFor", [channel, address], canais.rolesFor && (() => canais.rolesFor!(channel, address)), []),
    setRoles: pedido("setRoles", canais.setRoles),
    defineRole: pedido("defineRole", canais.defineRole),
    deleteRole: pedido("deleteRole", canais.deleteRole),
    mayManageRoles: (channel) =>
      ler("mayManageRoles", [channel], canais.mayManageRoles && (() => canais.mayManageRoles!(channel)), false),

    /* ------------------------------------------------------------------
       From here down everything is optional on the interface bridge, so it
       only enters if the host brings it: this is how the interface detects
       features, and a key present is a promise that the action works.
       ------------------------------------------------------------------ */
    ...(canais.closedRooms
      ? { closedRooms: (channel: string) => ler("closedRooms", [channel], () => canais.closedRooms!(channel), []) }
      : {}),
    ...(canais.categories
      ? { categories: (channel: string) => ler("categories", [channel], () => canais.categories!(channel), []) }
      : {}),
    ...(canais.setCategory ? { setCategory: pedido("setCategory", canais.setCategory) } : {}),
    ...(canais.reorderRoles ? { reorderRoles: pedido("reorderRoles", canais.reorderRoles) } : {}),

    ...(canais.pins
      ? { pins: (channel: string, room: string) => ler("pins", [channel, room], () => canais.pins!(channel, room), []) }
      : {}),
    ...(canais.mayPin
      ? { mayPin: (channel: string) => ler("mayPin", [channel], () => canais.mayPin!(channel), false) }
      : {}),
    ...(canais.pin ? { pin: pedido("pin", canais.pin) } : {}),
    ...(canais.unpin ? { unpin: pedido("unpin", canais.unpin) } : {}),

    ...(canais.tickets
      ? {
          tickets: (channel: string, room: string) =>
            ler("tickets", [channel, room], () => canais.tickets!(channel, room), []),
        }
      : {}),
    ...(canais.mayDecideTicket
      ? {
          mayDecideTicket: (channel: string, room: string, ticket: string) =>
            ler(
              "mayDecideTicket",
              [channel, room, ticket],
              () => canais.mayDecideTicket!(channel, room, ticket),
              false,
            ),
        }
      : {}),
    ...(canais.openTicket ? { openTicket: pedido("openTicket", canais.openTicket) } : {}),
    ...(canais.replyToTicket ? { replyToTicket: pedido("replyToTicket", canais.replyToTicket) } : {}),
    ...(canais.setTicketState ? { setTicketState: pedido("setTicketState", canais.setTicketState) } : {}),
    ...(canais.takeTicket ? { takeTicket: pedido("takeTicket", canais.takeTicket) } : {}),
    ...(canais.releaseTicket ? { releaseTicket: pedido("releaseTicket", canais.releaseTicket) } : {}),
    ...(canais.deleteTicket ? { deleteTicket: pedido("deleteTicket", canais.deleteTicket) } : {}),
    ...(canais.setNickname ? { setNickname: pedido("setNickname", canais.setNickname) } : {}),
    ...(canais.nicknames
      ? { nicknames: (channel: string) => ler("nicknames", [channel], () => canais.nicknames!(channel), {}) }
      : {}),
    ...(canais.mayAttend
      ? { mayAttend: (channel: string) => ler("mayAttend", [channel], () => canais.mayAttend!(channel), false) }
      : {}),
    ...(canais.mayModerate
      ? {
          mayModerate: (channel: string, address: string) =>
            ler("mayModerate", [channel, address], () => canais.mayModerate!(channel, address), false),
        }
      : {}),

    ...(canais.mayMove
      ? { mayMove: (channel: string) => ler("mayMove", [channel], () => canais.mayMove!(channel), false) }
      : {}),
    ...(canais.mayMentionAll
      ? {
          mayMentionAll: (channel: string, room: string) =>
            ler("mayMentionAll", [channel, room], () => canais.mayMentionAll!(channel, room), false),
        }
      : {}),
    ...(canais.mayInvite
      ? { mayInvite: (channel: string) => ler("mayInvite", [channel], () => canais.mayInvite!(channel), false) }
      : {}),
    ...(canais.moveVoice ? { moveVoice: pedido("moveVoice", canais.moveVoice) } : {}),
    ...(canais.disconnectVoice ? { disconnectVoice: pedido("disconnectVoice", canais.disconnectVoice) } : {}),
    ...(canais.adminRole
      ? { adminRole: (channel: string) => ler("adminRole", [channel], () => canais.adminRole!(channel), null) }
      : {}),

    /*
      Kick, which is the only action in this list with cryptographic effect: advances
      the epoch and removes the keys. The query is a READ, it used to be an `invoke`, and
      a promise would be true: the installed app offered it to everyone.
    */
    ...(canais.mayExpel
      ? { mayExpel: (channel: string) => ler("mayExpel", [channel], () => canais.mayExpel!(channel), false) }
      : {}),
    ...(canais.expel ? { expel: pedido("expel", canais.expel) } : {}),

    ...(canais.mayDelete
      ? { mayDelete: (channel: string) => ler("mayDelete", [channel], () => canais.mayDelete!(channel), false) }
      : {}),
    ...(canais.remove ? { remove: pedido("remove", canais.remove) } : {}),

    ...(canais.editMessage ? { editMessage: pedido("editMessage", canais.editMessage) } : {}),
    ...(canais.deleteMessage ? { deleteMessage: pedido("deleteMessage", canais.deleteMessage) } : {}),
  }

  return { canais: canaisDaPonte, esquecer }
}

/**
 * How many alerts sit waiting for a click.
 *
 * What gets cached is the open function, not the alert, and an alert no one clicks stays here forever, hence the cap. It's the same spirit as the cap on the notification log: limited memory, and the oldest one gets dropped.
 */
const AVISOS_POR_ABRIR = 50


/**
 * The global shortcuts, with what comes from the main process validated: only "microphone" or
 * "audio" reach the interface. Anything else is a main process from another
 * version, and gets ignored instead of calling a command that doesn't exist.
 */
function atalhosGlobaisDe(
  anfitriao: NonNullable<HostApi["atalhosGlobais"]>,
): NonNullable<EnclaveBridge["atalhosGlobais"]> {
  return {
    definir: (pedido) => anfitriao.definir(pedido),
    suspender: (sim) => anfitriao.suspender(sim),
    abrirAcessibilidade: () => anfitriao.abrirAcessibilidade(),
    aoAccionar: (handler) =>
      anfitriao.aoAccionar((cru) => {
        if (cru === "microfone" || cru === "som" || cru === "overlay") handler(cru)
      }),
  }
}

/**
 * The game overlay: everything "fire and forget". What crosses is copied here
 * into plain objects (the `contextBridge` clones, and a `Set` or a function
 * mixed in would crash the send). The main process sanitizes the same way.
 */
function overlayDe(anfitriao: NonNullable<HostApi["overlay"]>): NonNullable<EnclaveBridge["overlay"]> {
  return {
    estado: (resumo) =>
      anfitriao.estado(
        resumo === null
          ? null
          : {
              sala: resumo.sala,
              entrada: resumo.entrada,
              pessoas: resumo.pessoas.map((p) => ({
                id: p.id,
                nome: p.nome,
                aFalar: p.aFalar,
                micCalado: p.micCalado,
                somDesligado: p.somDesligado,
                ...(p.doEndereco ? { doEndereco: true } : {}),
              })),
            },
      ),
    caras: (caras) => anfitriao.caras({ ...caras }),
    preferencias: (p) =>
      anfitriao.preferencias({ ligada: p.ligada, opacidade: p.opacidade, textos: { entrou: p.textos.entrou, saiu: p.textos.saiu } }),
    alternar: () => anfitriao.alternar(),
    repor: () => anfitriao.repor(),
  }
}

/**
 * The bridge between the system-shown alert and the chat it opens.
 *
 * The click happens in the main process, which doesn't know how to navigate; the
 * interface does, and the decision of where to go already lives there in one place. So
 * what crosses the IPC back is the alert ID and nothing else: here we look up what to
 * do with it, and the interface does it.
 */
function ligarAvisosDoSistema(host: HostApi): void {
  const porAbrir = new Map<string, () => void>()

  /**
   * Where the window is, according to whoever owns it.
   *
   * Starts at `true` because it's true: the app just opened with the window
   * in front. If for some reason the announcement never arrived, the error would
   * fall on the silent side, which is the right side to err on for a system alert.
   */
  let janelaAFrente = true
  host.on.windowState((cru) => {
    const { inFront } = (cru ?? {}) as { inFront?: boolean }
    if (typeof inFront === "boolean") janelaAFrente = inFront
  })

  host.on.noticeOpen((cru) => {
    const { id } = (cru ?? {}) as { id?: string }
    if (!id) return
    const abrir = porAbrir.get(id)
    porAbrir.delete(id)
    abrir?.()
  })

  registerSystemNoticeHost({
    windowInFront: () => janelaAFrente,
    show: (notice, open) => {
      if (porAbrir.size >= AVISOS_POR_ABRIR) {
        const maisAntigo = porAbrir.keys().next()
        if (!maisAntigo.done) porAbrir.delete(maisAntigo.value)
      }
      porAbrir.set(notice.id, open)
      void host.notify.show(notice).then(
        (resultado) => {
          // Denied, vault locked in the meantime, or a system without
          // notifications. Storing the click on an alert that doesn't exist would
          // leave garbage waiting for an event that never arrives.
          if (!resultado.shown) porAbrir.delete(notice.id)
        },
        () => porAbrir.delete(notice.id),
      )
    },
  })
}

declare global {
  interface Window {
    enclaveHost: HostApi
  }
}

export function createDesktopBridge(): EnclaveBridge {
  // Each request unwraps the error envelope from the main process, so the
  // interface gets the same `Error` that the web bridge throws. See `envelope.ts`.
  const host = desembrulharAnfitriao(window.enclaveHost)

  ligarAvisosDoSistema(host)

  /**
   * Rooms, roles, tickets, and the cache that makes them affordable.
   *
   * **Registered here, before the interface registers for anything.** IPC
   * listeners fire in the order they were registered, and this bridge is
   * built before the React tree mounts: when `useRooms` re-reads rooms because
   * of a new message, the cache has already been cleared because of that same
   * message. Otherwise, the message would land on screen and rooms would be
   * the ones from before it, until the next message, which would show the state
   * one message behind forever.
   *
   * Three events, not nine: a message can be a `channel.meta`, a `role.define`,
   * or a ticket mark; an epoch changes who's a member; the channel list changes
   * what exists. A `typing` doesn't change any state, and clearing the cache on
   * every keystroke from someone else would pay for all the reads again for nothing.
   */
  const { canais, esquecer: esquecerLeituras } = ligarCanais(host)
  host.on.message(esquecerLeituras)
  host.on.epoch(esquecerLeituras)
  host.on.channels(esquecerLeituras)

  // Cached after login so the call layer can compare addresses synchronously.
  let selfAddress = "" as UserAddress

  const call = new Call({
    get selfAddress(): UserAddress {
      return selfAddress
    },
    sendSignal: async (channel, payload) => {
      await host.voice.signal(channel, payload)
    },
    mediaKey: async (channel, address, folha) => {
      const key = await host.voice.key(channel, address, folha)
      // IPC hands back a plain object; the material arrives as a Uint8Array
      // already, but normalise in case a structured-clone path changes.
      return key ? { ...key, material: new Uint8Array(key.material) } : null
    },
    reservarContadorSframe: async (channel, keyId) => host.voice.reservarContador(channel, keyId),

    /**
     * The worker where media encryption runs, which this bridge didn't have.
     *
     * **Only `apps/web` delivered it, and the absence was the same kind as the `sfu`'s:
     * silent.** `caminhoDaCifra` has two paths, Chromium's non-standard `createEncodedStreams`
     * and `RTCRtpScriptTransform`, which is the standard and runs on another thread. A host
     * that can't create the worker gets only the first. The installed app got one path where
     * the browser has two, and the SFU gate (`cifraDeMediaEmFalta`) closes when there's
     * none: it falls back to MESH, with no error, while browsers in the same room stay on
     * SFU. A mesh client and an SFU client don't see each other, the latter ignores the
     * former's offers and only mentions it in the log (`call-sfu-oferta-de-malha`). Both
     * sides stay "connecting..." forever.
     *
     * **Today it doesn't happen, and that's why it had to be written before it does.**
     * Measured on Electron 43.2.0 (Chromium 150.0.7871.129): `createEncodedStreams` is in
     * both prototypes, so `caminhoDaCifra` answers `insertable` and this never gets called.
     * What this buys is the day when Chromium drops the API that was never standard, that
     * day the installed app changes paths on its own instead of losing quality.
     *
     * **Also measured at birth.** A worker that throws on creation would be worse than
     * having none: the gate starts saying it can encrypt and assembly discovers halfway
     * through it can't. In a `file://` window with this client's policy (`script-src 'self'`),
     * a URL worker is born and works; a `blob:` worker is DENIED by policy, which is why
     * this is a `new URL(...)` and not the built-in form that `docs/PLANO_MOVEL.md`
     * recommends for mobile.
     *
     * The literal `new URL(..., import.meta.url)` is the form that `vite`, here `electron-vite`,      * recognizes for bundling a worker. A variable in the middle and the file doesn't travel to
     * `out/renderer`: development works, packaged app the worker doesn't load.
     */
    criarWorkerDeCifra: () => new Worker(new URL("./cifra-worker.ts", import.meta.url), { type: "module" }),

    setMediaActive: async (active) => {
      await host.voice.setActive(active)
    },
    // The AFK room (2/11/2026): the room list already crosses the IPC in a synchronous read,
    // and it's that which says which one it is. See `salaAfk` in `CallBridge`.
    salaAfk: (channel, room) => canais.rooms(channel).some((sala) => sala.room === room && sala.afk !== undefined),
    /*
      The screen audio: here the selector is ours and has no checkbox, so
      the absence of audio means the SYSTEM doesn't provide it. We ask the
      main process (`ecra:som`); an old `preload` without the query
      answers "yes", which is the silence from before.
    */
    somDoEcraDisponivel: async () => {
      const perguntar = host.ecra?.som
      if (!perguntar) return true
      return (await perguntar()).disponivel
    },
    // RTCIceServer under exactOptionalPropertyTypes will not take an explicit
    // undefined, and a STUN-only entry has no credential at all. Omit the keys
    // rather than send them empty.
    iceServers: async () =>
      (await host.voice.ice()).map((server) => ({
        urls: server.urls,
        ...(server.username !== undefined ? { username: server.username } : {}),
        ...(server.credential !== undefined ? { credential: server.credential } : {}),
      })),

    /**
     * The path to SFU, which this bridge didn't have.
     *
     * Until now only `apps/web` delivered it: in the installed app all calls
     * ran on mesh, against any server, even with `hello.ok` announcing the
     * capability. Nothing broke, and that's what makes the absence expensive
     * to find, because a feature that simply doesn't happen doesn't complain.
     *
     * **Delegation and nothing else, with one exception:** `criarDispositivo`. The
     * `mediasoup-client` belongs to the HOST, not the core, and must be built
     * on THIS side of the boundary, WebRTC only exists where there's a DOM, and
     * the main process has none. It's the same reason the whole `Call` lives here.
     */
    sfu: {
      /*
        Asked on each call entry, never cached.
        
        There's no way to answer synchronously here: the session is on the other side
        of the IPC. Storing the answer in a mirror updated by notification was the
        alternative, but it goes stale exactly in the window this query exists to catch,         the server reversal window, plus it gets born false again on each reload of this
        window with the session already connected. So the core accepts a promise. See
        `CallBridge.sfu.suportaSfu`.
        */
      suportaSfu: async () => {
        try {
          return await host.sfu.suporta()
        } catch (erro) {
          // We don't know if there's SFU, so there isn't: mesh is what worked
          // yesterday, and an entry that breaks because of this query would be a
          // call lost to a capability that's optional by design.
          call.emit("diagnostic", { code: "sfu-capacidade-sem-resposta", detail: (erro as Error).message })
          return false
        }
      },
      criarDispositivo: () => new Device(),
      sfuEntrarNoAmbito: async (channel, scope) => {
        const resposta = await host.sfu.entrar(channel, scope)
        // The address comes from the other process as a string, and the mark is ours, as
        // everywhere on the boundary: the schema validated it, on the other side.
        return {
          rtpCapabilities: resposta.rtpCapabilities,
          producers: resposta.producers.map((cada) => ({ ...cada, address: cada.address as UserAddress })),
        }
      },
      /*
        The exit returns nothing, because the gateway doesn't answer to
        `sfu.scope.leave`. The `void` with `catch` isn't careless: an exit that
        breaks because the connection already fell isn't an error, the server
        already dropped everything when the socket died -, and an unhandled rejected
        promise crashes the entire renderer in an `unhandledrejection`.
      */
      sfuSairDoAmbito: (channel, scope) => {
        void host.sfu.sair(channel, scope).catch(() => {})
      },
      sfuCriarTransporte: (channel, scope, direction) => host.sfu.criarTransporte(channel, scope, direction),
      sfuLigarTransporte: async (transport, dtls) => {
        await host.sfu.ligarTransporte(transport, dtls)
      },
      sfuProduzir: (transport, kind, rtp, fonte) => host.sfu.produzir(transport, kind, rtp, fonte),
      async sfuFecharProdutor(producer) {
        await host.sfu.fecharProdutor(producer)
      },
      sfuConsumir: (transport, producer, caps) => host.sfu.consumir(transport, producer, caps),
      sfuRetomar: async (transport, consumer) => {
        await host.sfu.retomar(transport, consumer)
      },
      sfuPausar: async (transport, consumer) => {
        await host.sfu.pausar(transport, consumer)
      },
      // Fire and forget: a lost image request is remade by the watchdog.
      sfuPedirFotogramaChave: (transport, consumer) => {
        void host.sfu.pedirFotogramaChave?.(transport, consumer).catch(() => {})
      },
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
  host.on.sfu((cru) => {
    const aviso = cru as {
      t: "producer.new" | "producer.closed"
      channel: string
      scope: string
      producer: string
      address?: UserAddress
    }
    void call.handleSfuAviso(aviso).catch((error: unknown) => {
      call.emit("error", erroDaChamada(error, "the call media failed"))
    })
  })

  /**
   * Same reason as in `apps/web`, and the same line: the connection came back, and
   * the media path for this call must be rebuilt.
   *
   * The gateway drops everything a connection had in the media engine when the socket
   * dies. The session reconnects and rebuilds what it can; media was not on that list.
   * The person's producer died in the router and nobody recreated it, they stayed in
   * the encrypted roster of others, with no stream, "connecting…" forever. See
   * `Call.ligacaoVoltou`.
   */
  let ligacaoAnterior = "offline"
  host.on.connection((raw) => {
    const { state } = raw as { state: string }
    const voltou = state === "online" && ligacaoAnterior !== "online"
    ligacaoAnterior = state
    if (!voltou) return
    void call.ligacaoVoltou().catch((error: unknown) => {
      call.emit("error", erroDaChamada(error, "the call media failed"))
    })

    /*
      And the question "who is in the room?", matching `apps/web`.
      
      Through IPC and therefore async, which is the only difference: here the list of
      channels is not at hand like `session.channels` in the browser. Fire and forget,       a question that does not go out lets the list fill up by the 50-second heartbeat,
      as before this existed.
      
      The brake is the same and lives in the same place: the `Call` stores a minimum
      interval per channel, because this hook fires on each connection loop. See
      `Call.PERGUNTA_MINIMO_MS`.
      */
    void canais
      .list()
      .then((meus: string[]) => call.perguntarQuemEsta(meus))
      .catch(() => {})
  })

  // Same reason as in apps/web: the epoch changes, the media key must change with it,
  // or whoever was removed from the channel keeps hearing the call.
  host.on.epoch((raw) => {
    const { channel } = raw as { channel: string }
    void call.rekey(channel).catch((error: unknown) => {
      call.emit("error", erroDaChamada(error, "the call media key failed"))
    })
  })

  /**
   * Same reason as in apps/web, and the same line: someone arriving at the server
   * did not hear any of the `voice.join` messages already sent, and voice signals do
   * not recover in the sync. Without this, opening the installed app shows an empty
   * server while the conversation goes on. See `Call.reafirmarPresenca`.
   */
  host.on.presence((raw) => {
    const { address, online } = raw as { address: UserAddress; online: boolean }
    if (online) call.reafirmarPresenca()
    // The missing half, same as in `apps/web`: whoever disconnects leaves the call even
    // if they had no time to say so. Closing the app sends no `voice.leave`, and with
    // SFU there is no per-person connection that falls as a warning, without this it
    // stays on others' screens forever.
    else call.desligouSeDoServidor(address)
  })

  const activityHandlers = new Set<
    (event: { channel: string; from: string; joined: boolean; room: string; transmite?: Transmissao }) => void
  >()

  host.on.voice((raw) => {
    const event = raw as { channel: string; from: UserAddress; payload: Payload }
    // Never swallow a signalling failure — see the same note in apps/web.
    void call.handleSignal(event.channel, event.from, event.payload).catch((error: unknown) => {
      call.emit("error", erroDaChamada(error, "call signalling failed"))
    })
    // A question is not anyone's departure, the full note is in `apps/web`.
    if (ehPerguntaDePresenca(event.payload)) return
    if (event.payload.t === "voice.join" || event.payload.t === "voice.leave") {
      const joined = event.payload.t === "voice.join"
      // The room comes along, like in the browser host: without it the interface knows
      // there is a call in the channel but not in which voice room.
      const room = event.payload.room ?? ""
      // What transmits (screen, music), read from the announcement: it lights the signal
      // in rooms where we are not (phase 1i).
      const transmite = transmissaoDoAnuncio(event.payload)
      for (const handler of activityHandlers) {
        handler({ channel: event.channel, from: event.from, joined, room, ...(transmite ? { transmite } : {}) })
      }
    }
  })

  const rememberAddress = <T extends { address: string }>(identity: T): T => {
    selfAddress = identity.address as UserAddress
    ligarPreferenciasDeVoz()
    return identity
  }

  /**
   * The voice chain choices (profile, stages, strength) travel with the account.
   *
   * The session lives in the main process; the `Call` lives here. The pair that
   * control asks for (`preferencias`, `definirPreferencia`, the event) crosses IPC
   * through the `estado` of the `preload`, the same path where the interface reads
   * other preferences. Without `estado` (an old `preload`), voice stays on the default
   * profile and choices do not save: same as the others.
   */
  let desligarPreferenciasDeVoz: (() => void) | null = null
  const ligarPreferenciasDeVoz = (): void => {
    desligarPreferenciasDeVoz?.()
    desligarPreferenciasDeVoz = null
    const estado = host.estado
    if (!estado) return
    const ouvirPreferencias = host.on.preferencias
    desligarPreferenciasDeVoz = call.audio.ligarPreferencias({
      preferencias: () => estado.preferencias(),
      definirPreferencia: async (chave, valor) => {
        await estado.definirPreferencia(chave, valor)
      },
      ...(ouvirPreferencias
        ? {
            on: (_evento: "preferencias", ouvinte: (dados: { preferencias: Readonly<Record<string, string>> }) => void) =>
              ouvirPreferencias((dados) => ouvinte(dados)),
          }
        : {}),
    })
  }

  /**
   * The sound and video options, which never reached the engine here.
   *
   * The desktop bridge created the `Call` and passed it no option: neither the noise
   * suppressor, nor the gain, nor the chosen microphone, nor the video quality.
   * All of that existed in Settings, was saved to disk, and died on the way, in
   * the installed app, those switches never did anything.
   *
   * Found on August 13, 2026, investigating the complaint that the noise suppressor
   * did not work. It worked in the browser and not here, and the reason was this
   * absence, not the preference.
   *
   * The body is the same as the browser bridge on purpose: a second path to the same
   * state is how the two buttons that disagree with each other are born.
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
    // And to the banner already on the air, if there is one.
    void call.aplicarSomAoVivo()
  }

  /**
   * Screen sharing, tied to the host.
   *
   * Only exists if the `preload` brings it, and the absence is read by the interface
   * as "this host handles this on its own", which is true in the browser, where
   * Chrome brings its selector, and a benign lie in an old `preload`: there screen
   * sharing stops working again, but nothing breaks, and it is the failure in the
   * right direction.
   *
   * `aoPedir` is the only event from this bridge that REQUIRES a response. An alert
   * without an identifier is thrown away instead of opening a selector that would
   * answer to nothing, leaving the true request waiting for timeout.
   */
  const ecra: EnclaveBridge["ecra"] = host.ecra
    ? {
        fontes: (semNome) => host.ecra!.fontes(semNome),
        escolher: (id, fonte) => host.ecra!.escolher(id, fonte),
        permissao: () => host.ecra!.permissao(),
        abrirDefinicoes: () => host.ecra!.abrirDefinicoes(),
        ...(host.ecra.som ? { som: () => host.ecra!.som!() } : {}),
        aoPedir: (handler) =>
          host.on.ecraPedido((cru) => {
            const { id } = (cru ?? {}) as { id?: string }
            if (typeof id === "string" && id !== "") handler({ id })
          }),
      }
    : undefined

  return {
    vault: host.vault,
    ...(host.contas ? { contas: host.contas } : {}),
    applyMediaPrefs,
    ...(ecra ? { ecra } : {}),
    /*
      Passes raw, with no wrapper: the three operations have no form to restore on
      this side, unlike channel reads. What matters is the condition, without a
      `preload` that brings it, the key does not even exist in the bridge, and the
      interface reads the absence as "there is nothing to say about versions". That is
      the case in the browser, and the case in an old `preload`, and both want the
      same answer.
    */
    ...(host.actualizacao ? { actualizacao: host.actualizacao } : {}),
    // Without `preload` that brings it, there is no "Send logs" button: the CSP of the
    // renderer does not let the interface reach the server on its own.
    ...(host.relato ? { relato: host.relato } : {}),
    // And the reports, for the same reason: the server is chosen in the main process.
    ...(host.denuncias ? { denuncias: host.denuncias } : {}),
    ...(host.atalhosGlobais ? { atalhosGlobais: atalhosGlobaisDe(host.atalhosGlobais) } : {}),
    ...(host.overlay ? { overlay: overlayDe(host.overlay) } : {}),
    identity: {
      create: (homeserver) => host.identity.create(homeserver).then(rememberAddress),
      load: () => host.identity.load().then(rememberAddress),
    },
    // Raw, like `actualizacao`: without `preload` that brings it, the key does not exist
    // and the interface reads the absence as "this host does not know how to pair".
    ...(host.pairing ? { pairing: host.pairing } : {}),
    // Raw, for the same reason: without `preload` that brings it, the interface has what
    // this device knows, and nothing travels.
    ...(host.estado ? { estado: host.estado } : {}),
    ...(host.sincronia ? { sincronia: host.sincronia } : {}),
    ...(host.anexo ? { anexo: host.anexo } : {}),
    ...(host.video ? { video: host.video } : {}),
    session: host.session,
    channels: canais,
    social: host.social,
    votacoes: host.votacoes,
    notifications: host.notifications,
    invites: host.invites,
    profile: host.profile,
    on: {
      message: host.on.message,
      epoch: host.on.epoch,
      status: host.on.status,
      connection: host.on.connection,
      channels: host.on.channels,
      presence: host.on.presence,
      typing: (handler) =>
        host.on.typing((raw) => handler(raw as { channel: string; from: string; room: string; until: number })),
      buzz: (handler) => host.on.buzz((raw) => handler(raw as { channel: string; from: string; at: number })),
      callActivity: (handler) => {
        activityHandlers.add(handler)
        return () => activityHandlers.delete(handler)
      },
      ...(host.on.pair ? { pair: (handler: (evento: PairEvento) => void) => host.on.pair!((raw) => handler(raw as PairEvento)) } : {}),
      ...(host.on.lidas ? { lidas: host.on.lidas } : {}),
      ...(host.on.arquivo ? { arquivo: host.on.arquivo } : {}),
      ...(host.on.preferencias ? { preferencias: host.on.preferencias } : {}),
      ...(host.on.bloqueio ? { bloqueio: host.on.bloqueio } : {}),
      ...(host.on.amizades ? { amizades: host.on.amizades } : {}),
      ...(host.on.sucessoes ? { sucessoes: host.on.sucessoes } : {}),
      ...(host.on.perfil ? { perfil: host.on.perfil } : {}),
      ...(host.on.perfis ? { perfis: host.on.perfis } : {}),
      ...(host.on.historico ? { historico: host.on.historico } : {}),
      ...(host.on.sincronia ? { sincronia: host.on.sincronia } : {}),
      ...(host.on.video ? { video: host.on.video } : {}),
    },
    call,
  }
}
