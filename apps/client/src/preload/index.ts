import { contextBridge, ipcRenderer } from "electron"
import { CANAIS_DE_ACTUALIZACAO } from "../main/actualizacao.js"
import { CANAIS_DE_ATALHOS } from "../main/atalhos.js"
import { CANAIS_DE_CANAL, LEITURAS_DE_CANAL } from "../main/canais.js"
import { CANAIS_DA_OVERLAY } from "../main/overlay.js"
import { CANAIS_SFU } from "../main/sfu.js"

/**
 * The IPC bridge.
 *
 * This is the entire surface between untrusted rendering and the process that
 * holds the keys, so it is a fixed list of named operations with no
 * pass-through. Nothing here accepts a channel name from the renderer and
 * forwards it, which is the usual way a preload script quietly becomes a
 * remote-code-execution bridge.
 */

/** Whether the session is still writing, driven by the main process. See `escreve` in `session`. */
let escreveEmCache = true
ipcRenderer.on("session:escreve", (_evento, valor: unknown) => {
  escreveEmCache = valor !== false
})

function subscribe(channel: string, handler: (payload: unknown) => void): () => void {
  // The event object is dropped on purpose: it carries a `sender` the renderer
  // has no business holding a reference to.
  const listener = (_event: unknown, payload: unknown): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/**
 * A query with a synchronous answer, and the only reason this exists.
 *
 * `rooms`, `mayEdit`, `roles`, `pins`, `tickets`, the UI calls them during a `render` and expects a value, because the browser bridge delivers them that way: there, the session is on the same page. Here it's across IPC, and an `invoke` would return a promise. **A promise is an object, and an object is truthy:** `mayEdit?.(canal) ?? false` would say yes to everyone, exactly what `mayExpel` in this app did from the start.
 *
 * The full cost: this BLOCKS the renderer until the main process answers. It's tolerable because the other side just reads the vault from memory, and because the renderer bridge caches what it read until something changes it, a full `render` costs one read per operation, not per screen appearance.
 *
 * What comes back is the envelope from `canais.ts`, `{ ok, valor }` or `{ ok, erro }`, and passes up raw from here: any read that threw across this boundary carried the `render` that triggered it.
 */
function ler(channel: string, ...argumentos: unknown[]): unknown {
  return ipcRenderer.sendSync(channel, ...argumentos)
}

contextBridge.exposeInMainWorld("enclaveHost", {
  /** Write only (the Copy buttons). See `clipboard:write` in main and `ui/lib/copiar.ts`. */
  clipboard: {
    write: (texto: string) => ipcRenderer.invoke("clipboard:write", texto),
  },
  vault: {
    status: () => ipcRenderer.invoke("vault:status"),
    create: (passphrase: string | null) => ipcRenderer.invoke("vault:create", passphrase),
    unlock: (passphrase: string | null) => ipcRenderer.invoke("vault:unlock", passphrase),
    lock: () => ipcRenderer.invoke("vault:lock"),
    memorizar: (ligar: boolean) => ipcRenderer.invoke("vault:memorizar", ligar),
    definirPalavraPasse: (frase: string) => ipcRenderer.invoke("vault:definir-palavra-passe", frase),
    destroy: () => ipcRenderer.invoke("vault:destroy"),
    export: (passphrase?: string) => ipcRenderer.invoke("vault:export", passphrase),
    import: (data: string, passphrase: string) => ipcRenderer.invoke("vault:import", data, passphrase),
    createProvisional: (passphrase: string | null) => ipcRenderer.invoke("vault:createProvisional", passphrase),
  },
  /** Switch account. See `contas` in `EnclaveBridge`. */
  contas: {
    listar: () => ipcRenderer.invoke("contas:listar"),
    mudar: (id: string) => ipcRenderer.invoke("contas:mudar", id),
    acrescentar: () => ipcRenderer.invoke("contas:acrescentar"),
  },
  identity: {
    create: (homeserver: string) => ipcRenderer.invoke("identity:create", homeserver),
    load: () => ipcRenderer.invoke("identity:load"),
    address: () => ipcRenderer.invoke("identity:address"),
  },
  /** Device pairing. See `pairing` in `EnclaveBridge`. */
  pairing: {
    status: () => ipcRenderer.invoke("pairing:status"),
    host: () => ipcRenderer.invoke("pairing:host"),
    join: (link: string) => ipcRenderer.invoke("pairing:join", link),
    confirm: () => ipcRenderer.invoke("pairing:confirm"),
    refuse: () => ipcRenderer.invoke("pairing:refuse"),
    cancel: () => ipcRenderer.invoke("pairing:cancel"),
    done: () => ipcRenderer.invoke("pairing:done"),
    devices: () => ipcRenderer.invoke("pairing:devices"),
    revoke: (deviceKey: string) => ipcRenderer.invoke("pairing:revoke", deviceKey),
    juntar: (link: string) => ipcRenderer.invoke("pairing:juntar", link),
    juntarAvisar: () => ipcRenderer.invoke("pairing:juntar-avisar"),
    juntarTrocar: (passphrase: string | null) => ipcRenderer.invoke("pairing:juntar-trocar", passphrase),
    juntarCancelar: () => ipcRenderer.invoke("pairing:juntar-cancelar"),
  },
  /** Account state that travels between devices. See `estado` in `EnclaveBridge`. */
  estado: {
    lidas: () => ipcRenderer.invoke("estado:lidas"),
    marcarLido: (channel: string, at: number) => ipcRenderer.invoke("estado:marcar-lido", channel, at),
    arquivo: () => ipcRenderer.invoke("estado:arquivo"),
    arquivar: (channel: string, at?: number) => ipcRenderer.invoke("estado:arquivar", channel, at),
    desarquivar: (channel: string) => ipcRenderer.invoke("estado:desarquivar", channel),
    preferencias: () => ipcRenderer.invoke("estado:preferencias"),
    definirPreferencia: (chave: string, valor: string, at?: number) =>
      ipcRenderer.invoke("estado:definir-preferencia", chave, valor, at),
  },
  /** Sync between accounts (S5). See `sincronia` in `EnclaveBridge`. */
  sincronia: {
    estado: () => ipcRenderer.invoke("sincronia:estado"),
    lugarEm: (channel: string) => ipcRenderer.invoke("sincronia:lugar-em", channel),
    historico: () => ipcRenderer.invoke("sincronia:historico"),
  },
  /** Post video. See `video` in `EnclaveBridge`. */
  video: {
    publicar: (caption: string, tags: string[], extras: unknown, video: unknown) =>
      ipcRenderer.invoke("video:publicar", caption, tags, extras, video),
    cancelar: () => ipcRenderer.invoke("video:cancelar"),
    estado: (sha: string) => ipcRenderer.invoke("video:estado", sha),
    bytes: (sha: string) => ipcRenderer.invoke("video:bytes", sha),
  },
  /** Attachment bytes on demand (S5). See `anexo` in `EnclaveBridge`. */
  anexo: {
    pedir: (id: { channel: string; alvo: string; indice: number }) =>
      ipcRenderer.invoke("anexo:pedir", { channel: id.channel, alvo: id.alvo, indice: id.indice }),
    cancelar: (id: { channel: string; alvo: string; indice: number }) =>
      ipcRenderer.invoke("anexo:cancelar", { channel: id.channel, alvo: id.alvo, indice: id.indice }),
  },
  session: {
    connect: () => ipcRenderer.invoke("session:connect"),
    capabilities: () => ipcRenderer.invoke("session:capabilities"),
    commonRoom: () => ipcRenderer.invoke("session:common-room"),
    escolherSalaComum: (entrar: boolean) => ipcRenderer.invoke("session:escolher-sala-comum", entrar),
    setVisible: (visible: boolean) => ipcRenderer.invoke("session:set-visible", visible),
    latency: () => ipcRenderer.invoke("session:latency"),
    verificarLigacao: () => ipcRenderer.invoke("session:verificar-ligacao"),
    // Read during a render, so from cache: the main process pushes the value when
    // it changes (`avisarEscrita`), starting as yes. See the main process.
    escreve: (): boolean => escreveEmCache,
  },
  /**
   * The update available notification. **It notifies; it doesn't update.**
   *
   * Notice what's not here: `verificar` takes no address and `abrir` takes nothing. On purpose, that's the whole design, this file is the boundary with the untrusted renderer, and accepting an address would let it choose where to send users to download the executable. See `actualizacao.ts` in the main process.
   */
  /** Send log: only the text crosses; the destination and version come from the main process. */
  relato: {
    enviar: (pedido: { texto: string; versao: string }) => ipcRenderer.invoke("relato:enviar", { texto: pedido.texto }),
  },
  /** Reports: the target, prepared report, and choice cross over; the server and version come from the main process. */
  denuncias: {
    preparar: (alvo: unknown) => ipcRenderer.invoke("denuncia:preparar", alvo),
    enviar: (preparada: unknown, escolha: unknown) => ipcRenderer.invoke("denuncia:enviar", preparada, escolha),
    lista: (canal: string) => ipcRenderer.invoke("denuncia:lista", canal),
    marcarLida: (id: string) => ipcRenderer.invoke("denuncia:marcarLida", id),
    porAbrir: (canal: string) => ipcRenderer.invoke("denuncia:porAbrir", canal),
    suspensao: () => ipcRenderer.invoke("denuncia:suspensao"),
    pedirRevisao: (nota: string) => ipcRenderer.invoke("denuncia:pedirRevisao", nota),
  },
  /**
   * Global keyboard shortcuts. See `atalhos.ts` in the main process. The renderer says WHICH keys it wants; it doesn't name a channel, and the main process sanitizes the request.
   */
  atalhosGlobais: {
    definir: (pedido: { microfone: string | null; som: string | null; overlay?: string | null } | null) =>
      ipcRenderer.invoke(
        CANAIS_DE_ATALHOS.definir,
        pedido === null ? null : { microfone: pedido.microfone, som: pedido.som, overlay: pedido.overlay ?? null },
      ),
    suspender: (sim: boolean) => ipcRenderer.invoke(CANAIS_DE_ATALHOS.suspender, sim === true),
    abrirAcessibilidade: () => ipcRenderer.invoke(CANAIS_DE_ATALHOS.abrirAcessibilidade),
    aoAccionar: (handler: (payload: unknown) => void) => subscribe(CANAIS_DE_ATALHOS.accionado, handler),
  },
  /**
   * The game overlay. See `overlay-janela.ts` in the main process. Send-only: the room summary (names, who's speaking, who's muted), small avatars, preferences, and the shortcut. The main process sanitizes everything, nothing comes back.
   */
  overlay: {
    estado: (resumo: unknown) => ipcRenderer.send(CANAIS_DA_OVERLAY.estado, resumo),
    caras: (caras: unknown) => ipcRenderer.send(CANAIS_DA_OVERLAY.caras, caras),
    preferencias: (preferencias: unknown) => ipcRenderer.send(CANAIS_DA_OVERLAY.preferencias, preferencias),
    alternar: () => ipcRenderer.send(CANAIS_DA_OVERLAY.alternar),
    repor: () => ipcRenderer.send(CANAIS_DA_OVERLAY.repor),
  },
  actualizacao: {
    verificar: () => ipcRenderer.invoke(CANAIS_DE_ACTUALIZACAO.verificar),
    dispensar: (versao: string) => ipcRenderer.invoke(CANAIS_DE_ACTUALIZACAO.dispensar, versao),
    abrir: () => ipcRenderer.invoke(CANAIS_DE_ACTUALIZACAO.abrir),
    diagnostico: () => ipcRenderer.invoke(CANAIS_DE_ACTUALIZACAO.diagnostico),
  },
  channels: {
    list: () => ipcRenderer.invoke("channel:list"),
    archived: () => ipcRenderer.invoke("channel:archived"),
    create: (channel: string, nome?: string) => ipcRenderer.invoke("channel:create", channel, nome),
    invite: (channel: string, address: string, note?: string) =>
      ipcRenderer.invoke("channel:invite", channel, address, note),

    /* ------------------------------------------------------------------
       The 37 missing operations, plus one that existed with the wrong shape.
       
       The list below brings the web bridge up to speed: `apps/web/src/bridge.ts`
       exposes 52 channel operations and this file exposed 15. The missing ones
       didn't crash, the UI reads `rooms?.(canal) ?? []`, and what showed was
       a channel with one room, no categories, no roles, and an empty tickets board.
       
       READS go through `ler` (synchronous, with envelope) and REQUESTS through
       `invoke`. The split is not cosmetic: see the note on `ler`.
       ------------------------------------------------------------------ */

    // The rooms, which is the complaint this came from.
    rooms: (channel: string) => ler(LEITURAS_DE_CANAL.salas, channel),
    closedRooms: (channel: string) => ler(LEITURAS_DE_CANAL.salasFechadas, channel),
    categories: (channel: string) => ler(LEITURAS_DE_CANAL.categorias, channel),
    setRoom: (channel: string, next: unknown) => ipcRenderer.invoke(CANAIS_DE_CANAL.criarSala, channel, next),
    setCategory: (channel: string, next: unknown) =>
      ipcRenderer.invoke(CANAIS_DE_CANAL.criarCategoria, channel, next),

    // The channel: how it presents itself, and who runs it.
    meta: (channel: string) => ler(LEITURAS_DE_CANAL.propriedades, channel),
    fichas: () => ler(LEITURAS_DE_CANAL.fichas),
    setMeta: (channel: string, next: unknown) => ipcRenderer.invoke(CANAIS_DE_CANAL.propriedades, channel, next),
    mayEdit: (channel: string) => ler(LEITURAS_DE_CANAL.podeOrganizar, channel),
    founder: (channel: string) => ler(LEITURAS_DE_CANAL.fundador, channel),
    admins: (channel: string) => ler(LEITURAS_DE_CANAL.administradores, channel),
    setAdmin: (channel: string, address: string, admin: boolean) =>
      ipcRenderer.invoke(CANAIS_DE_CANAL.nomearAdministrador, channel, address, admin),
    claimFounder: (channel: string) => ipcRenderer.invoke(CANAIS_DE_CANAL.assumirFundacao, channel),
    mayDelete: (channel: string) => ler(LEITURAS_DE_CANAL.podeEliminar, channel),
    remove: (channel: string) => ipcRenderer.invoke(CANAIS_DE_CANAL.eliminarCanal, channel),

    // The roles.
    roles: (channel: string) => ler(LEITURAS_DE_CANAL.papeis, channel),
    adminRole: (channel: string) => ler(LEITURAS_DE_CANAL.cargoDeAdministrador, channel),
    rolesFor: (channel: string, address: string) => ler(LEITURAS_DE_CANAL.papeisDe, channel, address),
    mayManageRoles: (channel: string) => ler(LEITURAS_DE_CANAL.podeGerirPapeis, channel),
    setRoles: (channel: string, address: string, roles: string[]) =>
      ipcRenderer.invoke(CANAIS_DE_CANAL.atribuirPapeis, channel, address, roles),
    defineRole: (channel: string, next: unknown) => ipcRenderer.invoke(CANAIS_DE_CANAL.definirPapel, channel, next),
    deleteRole: (channel: string, role: string) => ipcRenderer.invoke(CANAIS_DE_CANAL.apagarPapel, channel, role),
    reorderRoles: (channel: string, ordem: string[]) => ipcRenderer.invoke(CANAIS_DE_CANAL.ordenarPapeis, channel, ordem),

    // The permissions, and the voice gesture one of them enables.
    mayAttend: (channel: string) => ler(LEITURAS_DE_CANAL.podeAtender, channel),
    mayModerate: (channel: string, address: string) => ler(LEITURAS_DE_CANAL.podeModerar, channel, address),
    nicknames: (channel: string) => ler(LEITURAS_DE_CANAL.apelidos, channel),
    setNickname: (channel: string, subject: string, nick: string) =>
      ipcRenderer.invoke(CANAIS_DE_CANAL.mudarApelido, channel, subject, nick),
    mayMove: (channel: string) => ler(LEITURAS_DE_CANAL.podeMover, channel),
    mayMentionAll: (channel: string, room: string) => ler(LEITURAS_DE_CANAL.podeMencionarTodos, channel, room),
    mayInvite: (channel: string) => ler(LEITURAS_DE_CANAL.podeConvidar, channel),
    moveVoice: (channel: string, address: string, room: string) =>
      ipcRenderer.invoke(CANAIS_DE_CANAL.moverVoz, channel, address, room),
    disconnectVoice: (channel: string, address: string) =>
      ipcRenderer.invoke(CANAIS_DE_CANAL.desligarDaVoz, channel, address),

    // Pinned messages. The text copy travels with the pin, see `pin`.
    pins: (channel: string, room: string) => ler(LEITURAS_DE_CANAL.fixadas, channel, room),
    mayPin: (channel: string) => ler(LEITURAS_DE_CANAL.podeFixar, channel),
    pin: (channel: string, room: string, message: unknown) =>
      ipcRenderer.invoke(CANAIS_DE_CANAL.fixar, channel, room, message),
    unpin: (channel: string, room: string, id: string) =>
      ipcRenderer.invoke(CANAIS_DE_CANAL.desafixar, channel, room, id),

    // The full tickets.
    tickets: (channel: string, room: string) => ler(LEITURAS_DE_CANAL.tickets, channel, room),
    mayDecideTicket: (channel: string, room: string, ticket: string) =>
      ler(LEITURAS_DE_CANAL.podeDecidirTicket, channel, room, ticket),
    openTicket: (channel: string, room: string, subject: string) =>
      ipcRenderer.invoke(CANAIS_DE_CANAL.abrirTicket, channel, room, subject),
    replyToTicket: (channel: string, room: string, ticket: string, body: string) =>
      ipcRenderer.invoke(CANAIS_DE_CANAL.responderTicket, channel, room, ticket, body),
    setTicketState: (channel: string, room: string, ticket: string, state: string) =>
      ipcRenderer.invoke(CANAIS_DE_CANAL.estadoDoTicket, channel, room, ticket, state),
    takeTicket: (channel: string, room: string, ticket: string) =>
      ipcRenderer.invoke(CANAIS_DE_CANAL.tomarTicket, channel, room, ticket),
    releaseTicket: (channel: string, room: string, ticket: string) =>
      ipcRenderer.invoke(CANAIS_DE_CANAL.largarTicket, channel, room, ticket),
    deleteTicket: (channel: string, room: string, ticket: string) =>
      ipcRenderer.invoke(CANAIS_DE_CANAL.eliminarTicket, channel, room, ticket),

    // Edit and delete what was said. Delete is a request, not a direct erase.
    editMessage: (channel: string, target: string, body: string) =>
      ipcRenderer.invoke(CANAIS_DE_CANAL.emendarMensagem, channel, target, body),
    deleteMessage: (channel: string, target: string) =>
      ipcRenderer.invoke(CANAIS_DE_CANAL.apagarMensagem, channel, target),

    /* --------------------------------------------------------------- */

    /*
      Expel: the ONLY gesture with cryptographic effect, it advances the epoch
      and revokes keys. The guard logic lives in the core, on the other side of
this channel.
      
      `mayExpel` was an `invoke` and became a read, a fix not a refactor: a promise
      is truthy, so the installed app let you expel anyone.
    */
    mayExpel: (channel: string) => ler(LEITURAS_DE_CANAL.podeExpulsar, channel),
    expel: (channel: string, address: string) => ipcRenderer.invoke("channel:expel", channel, address),
    channelInvites: () => ipcRenderer.invoke("channel:invites"),
    acceptChannelInvite: (dmChannel: string, target: string) =>
      ipcRenderer.invoke("channel:invite-accept", dmChannel, target),
    declineChannelInvite: (dmChannel: string, target: string) =>
      ipcRenderer.invoke("channel:invite-decline", dmChannel, target),
    send: (channel: string, body: string, room?: string, extras?: unknown) =>
      ipcRenderer.invoke("channel:send", channel, body, room, extras),
    typing: (channel: string, room?: string) => ipcRenderer.invoke("channel:typing", channel, room),
    buzz: (channel: string) => ipcRenderer.invoke("channel:buzz", channel),
    members: (channel: string) => ipcRenderer.invoke("channel:members", channel),
    history: (channel: string) => ipcRenderer.invoke("channel:history", channel),
    forget: (channel: string) => ipcRenderer.invoke("channel:forget", channel),
    leave: (channel: string) => ipcRenderer.invoke("channel:leave", channel),
    safetyNumber: (channel: string, address: string) =>
      ipcRenderer.invoke("channel:safety-number", channel, address),
  },
  invites: {
    create: (channel: string, policy: unknown) => ipcRenderer.invoke("invite:create", channel, policy),
    redeem: (link: string) => ipcRenderer.invoke("invite:redeem", link),
    resolve: (link: string) => ipcRenderer.invoke("invite:resolve", link),
    nome: (link: string) => ipcRenderer.invoke("invite:nome", link),
    list: (channel: string) => ipcRenderer.invoke("invite:list", channel),
    revoke: (codeHash: string) => ipcRenderer.invoke("invite:revoke", codeHash),
  },
  social: {
    post: (caption: string, tags: string[], extras?: unknown) =>
      ipcRenderer.invoke("social:post", caption, tags, extras),
    acceptFollower: (address: string) => ipcRenderer.invoke("social:accept-follower", address),
    feedChannel: () => ipcRenderer.invoke("social:feed-channel"),
    edit: (id: string, caption: string) => ipcRenderer.invoke("social:edit", id, caption),
    remove: (id: string) => ipcRenderer.invoke("social:remove", id),
    react: (channel: string, target: string, emoji: string, remove?: boolean) =>
      ipcRenderer.invoke("social:react", channel, target, emoji, remove),
    comment: (channel: string, target: string, body: string) =>
      ipcRenderer.invoke("social:comment", channel, target, body),
    removeComment: (channel: string, id: string) => ipcRenderer.invoke("social:remove-comment", channel, id),
    linkPreview: (url: string) => ipcRenderer.invoke("social:link-preview", url),
    friendRequest: (channel: string, note?: string) => ipcRenderer.invoke("social:friend-request", channel, note),
    acceptFriend: (channel: string, address: string) => ipcRenderer.invoke("social:accept-friend", channel, address),
    declineFriend: (channel: string) => ipcRenderer.invoke("social:decline-friend", channel),
    cancelFriendRequest: (address: string) => ipcRenderer.invoke("social:cancel-friend-request", address),
    block: (address: string) => ipcRenderer.invoke("social:block", address),
    unblock: (address: string) => ipcRenderer.invoke("social:unblock", address),
    blocked: () => ipcRenderer.invoke("social:blocked"),
    friendTies: () => ipcRenderer.invoke("social:friend-ties"),
    sucessoes: () => ipcRenderer.invoke("social:sucessoes"),
    marcarSucessao: (de: string, feito: string) => ipcRenderer.invoke("social:marcar-sucessao", de, feito),
    adicionarSucessora: (de: string) => ipcRenderer.invoke("social:adicionar-sucessora", de),
    convidarSucessora: (de: string, channel: string) => ipcRenderer.invoke("social:convidar-sucessora", de, channel),
    setShownFriends: (list: string[]) => ipcRenderer.invoke("social:set-shown-friends", list),
    shownFriendsOf: (address: string) => ipcRenderer.invoke("social:shown-friends-of", address),
    sincronizarAgora: () => ipcRenderer.invoke("social:sincronizar-agora"),
    unfriend: (address: string) => ipcRenderer.invoke("social:unfriend", address),
    openDirect: (address: string) => ipcRenderer.invoke("social:open-direct", address),
    repairInvite: (channel: string, address: string, force?: boolean) =>
      ipcRenderer.invoke("social:repair-invite", channel, address, force),
    deadWelcomes: () => ipcRenderer.invoke("social:dead-welcomes"),
    deafChannels: () => ipcRenderer.invoke("social:deaf-channels"),
    syncCommunity: () => ipcRenderer.invoke("social:sync-community"),
    resyncWelcomes: (channel?: string) => ipcRenderer.invoke("social:resync-welcomes", channel),
    pedirPublicacoes: (channel: string) => ipcRenderer.invoke("social:pedir-publicacoes", channel),
  },
  /* Vote. Creating a poll doesn't go through here: it travels inside `channel:send`
     or `social:post` as an optional field. See `Poll` in the protocol. */
  votacoes: {
    votar: (channel: string, target: string, opcao: number, retirar?: boolean) =>
      ipcRenderer.invoke("votacao:votar", channel, target, opcao, retirar),
  },
  notifications: {
    list: () => ipcRenderer.invoke("notifications:list"),
    save: (entries: unknown) => ipcRenderer.invoke("notifications:save", entries),
  },
  /** The OS alert. The decision is the UI's; the display is the main process's,
   * it knows if the vault is open. */
  notify: {
    show: (notice: unknown) => ipcRenderer.invoke("notify:show", notice),
  },
  profile: {
    get: () => ipcRenderer.invoke("profile:get"),
    set: (profile: unknown) => ipcRenderer.invoke("profile:set", profile),
    directory: () => ipcRenderer.invoke("profile:directory"),
  },
  voice: {
    signal: (channel: string, payload: unknown) => ipcRenderer.invoke("voice:signal", channel, payload),
    key: (channel: string, address: string, folha?: number) => ipcRenderer.invoke("voice:key", channel, address, folha),
    reservarContador: (channel: string, keyId: number) =>
      ipcRenderer.invoke("voice:reservarContador", channel, keyId),
    setActive: (active: boolean) => ipcRenderer.invoke("voice:active", active),
    ice: () => ipcRenderer.invoke("voice:ice"),
  },
  /**
   * SFU negotiation when this server has one.
   *
   * None of this opens a frame: what crosses are ICE, DTLS, and RTP parameters,
   * and media is encrypted with SFrame underneath, with the key from the epoch
   * exporter. The server relays without ever holding a key, and this process
   * doesn't touch it either.
   *
   * The names come from `CANAIS_SFU` and are not written here: a typo between
   * processes gives no compile error, and renaming a channel on this side alone
   * would be a call that breaks at entry.
   */
  sfu: {
    /** Does this server advertise the capability? Asked on every call join. */
    suporta: () => ipcRenderer.invoke(CANAIS_SFU.suporta),
    entrar: (channel: string, scope: string) => ipcRenderer.invoke(CANAIS_SFU.entrar, channel, scope),
    sair: (channel: string, scope: string) => ipcRenderer.invoke(CANAIS_SFU.sair, channel, scope),
    criarTransporte: (channel: string, scope: string, direction: "envio" | "recepcao") =>
      ipcRenderer.invoke(CANAIS_SFU.criarTransporte, channel, scope, direction),
    ligarTransporte: (transport: string, dtlsParameters: unknown) =>
      ipcRenderer.invoke(CANAIS_SFU.ligarTransporte, transport, dtlsParameters),
    produzir: (transport: string, kind: "audio" | "video", rtpParameters: unknown, fonte?: string) =>
      ipcRenderer.invoke(CANAIS_SFU.produzir, transport, kind, rtpParameters, fonte),
    fecharProdutor: (producer: string) => ipcRenderer.invoke(CANAIS_SFU.fecharProdutor, producer),
    consumir: (transport: string, producer: string, rtpCapabilities: unknown) =>
      ipcRenderer.invoke(CANAIS_SFU.consumir, transport, producer, rtpCapabilities),
    retomar: (transport: string, consumer: string) => ipcRenderer.invoke(CANAIS_SFU.retomar, transport, consumer),
    pausar: (transport: string, consumer: string) => ipcRenderer.invoke(CANAIS_SFU.pausar, transport, consumer),
    pedirFotogramaChave: (transport: string, consumer: string) =>
      ipcRenderer.invoke(CANAIS_SFU.pedirFotogramaChave, transport, consumer),
  },
  /**
   * Screen sharing, which in Electron has no system picker.
   *
   * Two names for the picker, sources and selection, and two for the macOS
   * permission gate. None accept an IPC channel from the renderer to forward:
   * same rule as the rest of this file.
   */
  ecra: {
    /** What can be shared. `semNome` is the label for windows with no title. */
    fontes: (semNome: string) => ipcRenderer.invoke("ecra:fontes", semNome),
    /** The response to the pending request. `null` is giving up, not an error. */
    escolher: (id: string, fonte: { id: string; nome: string; som?: boolean } | null) =>
      ipcRenderer.invoke("ecra:escolher", id, fonte),
    /** What macOS says about recording the screen. Outside macOS, always granted. */
    permissao: () => ipcRenderer.invoke("ecra:permissao"),
    /** If this system provides screen audio (system sound). See `somDoSistema`. */
    som: () => ipcRenderer.invoke("ecra:som"),
    /** The Settings panel where permission is granted. macOS only. */
    abrirDefinicoes: () => ipcRenderer.invoke("ecra:abrirDefinicoes"),
  },
  /**
   * The operating system languages, so the UI can choose its own.
   *
   * Intentionally synchronous: read once at startup, before the screen exists.
   * See `main/index.ts`. Does not go through the `{ ok, valor }` envelope of
   * channel reads because there is no wrong answer, an empty list reads as "I
   * don't know", and the caller falls back to `navigator`.
   */
  lingua: {
    doSistema: (): unknown => ipcRenderer.sendSync("lingua:sistema"),
  },
  on: {
    message: (handler: (payload: unknown) => void) => subscribe("event:message", handler),
    epoch: (handler: (payload: unknown) => void) => subscribe("event:epoch", handler),
    status: (handler: (payload: unknown) => void) => subscribe("event:status", handler),
    connection: (handler: (payload: unknown) => void) => subscribe("event:connection", handler),
    channels: (handler: (payload: unknown) => void) => subscribe("event:channels", handler),
    presence: (handler: (payload: unknown) => void) => subscribe("event:presence", handler),
    /** Pairing, step by step. A simple object with `fase`. */
    pair: (handler: (payload: unknown) => void) => subscribe("event:pair", handler),
    /** The account state changed, here or on a sibling device. Each gets the full map. */
    lidas: (handler: (payload: unknown) => void) => subscribe("event:lidas", handler),
    arquivo: (handler: (payload: unknown) => void) => subscribe("event:arquivo", handler),
    preferencias: (handler: (payload: unknown) => void) => subscribe("event:preferencias", handler),
    bloqueio: (handler: (payload: unknown) => void) => subscribe("event:bloqueio", handler),
    amizades: (handler: (payload: unknown) => void) => subscribe("event:amizades", handler),
    sucessoes: (handler: (payload: unknown) => void) => subscribe("event:sucessoes", handler),
    perfil: (handler: (payload: unknown) => void) => subscribe("event:perfil", handler),
    /** Profiles of other people that a sibling device learned about. The addresses; the directory is reread. */
    perfis: (handler: (payload: unknown) => void) => subscribe("event:perfis", handler),
    /** The history of a sibling device: the progress and the channels that changed. */
    historico: (handler: (payload: unknown) => void) => subscribe("event:historico", handler),
    sincronia: (handler: (payload: unknown) => void) => subscribe("event:sincronia", handler),
    video: (handler: (payload: unknown) => void) => subscribe("event:video", handler),
    typing: (handler: (payload: unknown) => void) => subscribe("event:typing", handler),
    buzz: (handler: (payload: unknown) => void) => subscribe("event:buzz", handler),
    voice: (handler: (payload: unknown) => void) => subscribe("event:voice", handler),
    /**
     * A stream appeared or ended in the call, announced by the gateway.
     *
     * Same path as `voice`, for the same reason: whoever knows a new stream
     * appeared in the router is whoever routes it. Without this the call
     * connects, you hear whoever was already there, and nobody who joins
     * AFTER is heard, ever, with no error anywhere.
     */
    sfu: (handler: (payload: unknown) => void) => subscribe(CANAIS_SFU.aviso, handler),
    /** A system alert was tapped. Carries the identifier and nothing else. */
    noticeOpen: (handler: (payload: unknown) => void) => subscribe("event:notice-open", handler),
    /** The window opened, hid, gained or lost focus. */
    windowState: (handler: (payload: unknown) => void) => subscribe("event:window-state", handler),
    /**
     * Someone tapped screen share and needs to choose what.
     *
     * Carries the request identifier and nothing else. This is the only event
     * in this file that REQUIRES a response: a request without `ecra:escolher`
     * leaves `getDisplayMedia` on the other end thinking forever.
     */
    ecraPedido: (handler: (payload: unknown) => void) => subscribe("event:ecra-pedido", handler),
  },
})
