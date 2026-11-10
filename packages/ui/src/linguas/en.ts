import type { DetalheDoErro, FraseDeErro } from "../lib/codigosDeErro.js"
import type { Traducao } from "../strings.js"

/**
 * The interface in English. A partial overlay on the Portuguese base.
 *
 * Anything missing here falls through to `pt.ts`, key by key, so this file can
 * grow a screen at a time without ever putting a raw key on screen. What it
 * must NOT do is leave a single screen half and half: a settings pane with
 * three English labels and two Portuguese ones reads as a bug, not as work in
 * progress. Translate by group, and finish the group.
 *
 * Three rules that are not style:
 *
 * - **No em dashes.** The Portuguese copy does not use them in interface text
 *   and neither does this. A colon or a full stop carries the same weight
 *   without the width.
 * - **Watch the width.** English is usually shorter than Portuguese, and that
 *   is not free either: a dozen scripts in `scripts/medir-*.mjs` assert pixel
 *   geometry, and a button that shrinks moves everything beside it. Where a
 *   label sits in a fixed slot next to others, this keeps roughly the
 *   Portuguese length rather than the shortest possible wording.
 * - **Same signature.** A function here takes exactly the arguments the
 *   Portuguese one takes, and the compiler enforces it. The plural branches
 *   have to be reproduced, not simplified: "1 room" and "4 rooms" are two
 *   sentences in both languages.
 *
 * The voice is the Portuguese voice: blunt about what the app cannot do, never
 * cheerful about failure, and it says "channel", "category" and "room" for the
 * three levels of the hierarchy. Never "server" for a channel: what you join
 * is a channel, and the homeserver is a different animal that learns as little
 * as possible. See `terminologia.test.ts`, which holds that line in Portuguese.
 */
/** Reasons 1 to 7, shared by the report sheet and the founder inbox. See `pt.ts`. */
const MOTIVOS_DA_DENUNCIA = {
  1: "Sexual abuse of children",
  2: "Threats or incitement to violence",
  3: "Harassment or stalking",
  4: "Intimate images without consent",
  5: "Fraud, phishing or spam",
  6: "Hate speech",
  7: "Other illegal content",
} as const

export const en: Traducao = {
  common: {
    close: "Close",
    remove: "Remove",
    retry: "Try again",
    you: "You",
    copyFailed: "could not copy",
    unsupported: "this version of the app does not do that yet",
    cancel: "Cancel",
    mediaEvicted: "image is no longer on this device",
    fileEvicted: "file is no longer on this device",
    connectionOnline: "connected",
    connectionConnecting: "connecting…",
    connectionReconnecting: "reconnecting…",
    connectionOffline: "no connection",
    pasteNotImage: "The pasted content is not an image the app can read. Use PNG, JPEG, GIF, WebP or AVIF.",
    imageShrunk: (de: string, para: string): string => `Image reduced from ${de} to ${para}.`,
    gifParado: (tem: string, maximo: string): string =>
      `The GIF is ${tem}. To stay animated, the maximum is ${maximo}. It is now still.`,
    imagesShrunk: (n: number, de: string, para: string): string => `${n} images reduced from ${de} to ${para}.`,
    spoilerShow: "Show hidden text",
  },

  connection: {
    banner: "No connection. Trying to reconnect…",
    semLigacaoHa: (tempo: string): string => `No connection for ${tempo}.`,
    duracao: (minutos: number): string =>
      minutos < 1
        ? "less than 1 min"
        : minutos < 60
          ? `${minutos} min`
          : Math.floor(minutos / 60) === 1
            ? "1 hour"
            : `${Math.floor(minutos / 60)} hours`,
    ligarAgora: "Connect now",
    tentaSozinha: "The app tries again automatically. This button tries now.",
    aLigar: "Connecting…",
    composerEspera: "Sends later",
    separadorParado: "This tab no longer connects to the server. Close the other tabs or reload.",
    anexosOffline: "Images and files need a connection.",
  },

  /** Ver a nota do português. A palavra "update" não aparece num botão de
   *  propósito: nada disto actualiza nada. */
  actualizacao: {
    titulo: "There is a newer version of Orwell",
    versoes: (instalada: string, disponivel: string): string =>
      `You have ${instalada} installed. Version ${disponivel} is out.`,
    versoesComNome: (instalada: string, disponivel: string, nome: string): string =>
      `You have ${instalada} installed. Version ${disponivel} "${nome}" is out.`,
    nota: "The installed app does not update itself. Download the new installer. Install it over this version.",
    descarregar: "Go to the downloads page",
    dispensar: "Dismiss",
    dispensarTitulo: (versao: string): string => `Stop telling me about ${versao}`,
    somaRotulo: "Installer SHA-256",
    somaNota: "Check this sum after downloading. If it does not match, do not install.",
    webTexto: "New version. Reload to continue.",
    webDetalhe: "This tab no longer sends or receives.",
    webRecarregar: "Reload",
  },

  separadores: {
    titulo: "You already have Orwell open in another tab.",
    texto: "Your account works in only one tab at a time.",
    usar: "Use this tab",
    aPedir: "Asking the other tab…",
    nota: "When you use this tab, the other one stops. If you close the other one, this one opens by itself.",
    semProteccao: "This browser cannot protect against two open tabs. Use Orwell in one tab only.",
    semResposta: "The other tab does not answer. Use this one anyway?",
    forcar: "Use this one anyway",
    temConvite: "This tab has an invite. Select \"Use this tab\" to open it.",
    temEmparelhamento: "This tab has a pairing link. Select \"Use this tab\" to open it.",
    outroEscritor: "Close the other Orwell tabs and reload.",
  },

  errors: {
    codigo: (n: number): string => `Error ${n}`,
    desconhecido: "The app does not know this error.",
    boot: "Could not open the local storage of this device.",
    crashTitle: "Something went wrong.",
    reload: "Reload",
    membersFailed: "Could not load the members.",
  },

  gate: {
    splashTitle: "Orwell",
    splashBody: "Opening…",
    setupTitle: "Create account",
    setupLead: "We ask for no email and no phone number. The account stays on this device.",
    name: "Name",
    namePlaceholder: "How you want to appear",
    server: "Server",
    osKeychain: "Use the lock of this device",
    devicePassphrase: "Password for this device",
    passphrasePlaceholder: "At least 8 characters",
    passphraseNote: "If you forget it, you cannot recover it.",
    confirmPassphrase: "Confirm the password",
    passphraseMismatch: "The two passwords are different.",
    passphraseShort: "Type at least 8 characters.",
    reveal: "Show",
    conceal: "Hide",
    serverInvalid: "This server address is not valid.",
    askName: "How do you want your name shown?",
    askNameLead: "This is how you appear to the people you talk to. You can change the name later.",
    askPhoto: "Do you want a profile picture?",
    askPhotoLead: "It is the picture others see next to your name. You can change it later.",
    choosePhoto: "Choose a picture",
    removePhoto: "Remove",
    skipPhoto: "Skip",
    askPass: "What is the password going to be?",
    askPassLead: "Choose a new password. Do not use one from another place.",
    askPassKeychain: "How do you want to protect the account?",
    askPassKeychainLead: "You can use the lock of the device. To use a password, clear the tick.",
    askConfirm: "Confirm the password",
    askConfirmLead: "Type it again.",
    stepOf: (passo: number, total: number) => `Step ${passo} of ${total}`,
    next: "Continue",
    back: "Back",
    advanced: "Advanced options",
    advancedNote: "The server of your account. If you do not know what it is, do not change it.",
    creatingTitle: "Creating your account",
    creatingLead: "Do not close this window.",
    vaultExists: "There is already an account on this device.",
    vaultExistsBody:
      "A new account deletes the account on this device. To start again, clear the data of this site in the browser.",
    goToUnlock: "Sign in to the account on this device",
    warning: "If you lose this device or the password, you lose the account.",
    creating: "creating…",
    create: "Create account",
    stepLabels: {
      cofre: "Preparing the device…",
      identidade: "Creating the account…",
      ligacao: "Connecting to the server…",
      perfil: "Saving the profile…",
    },
    stepNames: {
      cofre: "Device",
      identidade: "Account",
      ligacao: "Connection",
      perfil: "Profile",
    },
    importLead: "Do you have the account file (.enclave)? Import it here.",
    importPick: "Import account",
    importPassLabel: "File password",
    importing: "Importing…",
    importAction: "Import",
    unlockTitle: "Welcome back",
    unlockLead: "Type the password for this device.",
    lostAccount: "Did you forget the password?",
    lostAccountAction: "Create a new account.",
    otherAccount: "Sign in with another account",
    otherAccountTitle: "Sign in with another account",
    otherAccountLead: "This device keeps one account only. Both ways first erase the account on this device.",
    otherAccountImport: "Import an account file",
    otherAccountPair: "Pair with the main device",
    passphrase: "Password",
    opening: "Opening…",
    openingNote: "This can take a few seconds.",
    memorizar: "Remember this session",
    memorizarNota: "Next time, Orwell opens without asking for the password. Anyone using this unlocked device gets into your account.",
    memorizarNotaIos: "On iPhone, seven days without opening Orwell can erase the session and the account on this device.",
    memorizarFalhou: "You are in, but the session could not be remembered on this device.",
    canalOficial: "Join the Orwell channel, the community of all users",
    canalOficialNota: "It has the Release notes, help and other people. You can join or leave later.",
    revogadoSemFrase: "This account has no password on this device. To use Orwell here again, start over.",
    comecarDeNovo: "Start over",
    open: "Sign in",
    joinLead: "Do you have an account on another device? Pair this device with it.",
    joinAction: "Pair",
    outroAparelhoPergunta: "Do you already use Orwell on another device?",
    outroAparelhoLead: "One account is enough for all your devices. If you already have an account, pair this device with it.",
    outroAparelhoSim: "Yes, pair this device",
    outroAparelhoNao: "No, create an account",
  },

  pairing: {
    joinTitle: "Pair this device",
    joinLead:
      "On the main device, open Settings, Devices, Add device. Then read the code with the camera, or paste the link here.",
    scan: "Read the code with the camera",
    scanning: "Point the camera at the code on the main device.",
    stopScan: "Stop the camera",
    cameraDenied: "The browser did not give access to the camera. Paste the link.",
    cameraUnavailable: "This device has no camera available. Paste the link.",
    pasteLabel: "Or paste the link",
    pasteAction: "Continue",
    linkInvalid: "This is not a pairing link.",
    keyTitle: "Password for this device",
    keyLead: "Choose a password for this device.",
    connecting: "Connecting to the main device…",
    waitingHost: "Waiting for the main device…",
    waitingGuest: "Waiting for the other device. Scan this code with its camera, or paste the link into it.",
    sasTitle: "Are the words the same?",
    sasLead: "Compare the six words on the two screens. If they are different, select \"They are not\".",
    sasHistoricoAqui: "After pairing, this device receives the old conversations and files from the other device.",
    sasHistoricoNoNovo: "After pairing, the new device receives the old conversations and files from this device.",
    sasSame: "They are the same",
    sasDifferent: "They are not",
    sasConfirmedHere: "Confirmed here. Confirm on the other device too.",
    joining: "Joining the account…",
    receivingState: "Receiving your data…",
    receivingStateLead: "The other device sends what you read, the archived conversations, the blocked people and the preferences.",
    stateDeadline: (segundos: number): string => `This device joins in ${segundos} s, with or without the data.`,
    stateMissing: "Your data did not arrive in time. It arrives when the two devices are connected.",
    profileMissing: "Your profile did not arrive from the main device yet. It arrives when the two devices are connected.",
    doneTitle: "This device now belongs to the account",
    doneBody: "This device gets new messages now. The old conversations come from the other device while both are online.",
    doneGuestNote: "Add or remove devices on the main device of the account.",
    doneHostBody: "The new device gets messages from now on. Earlier messages stay on the other devices.",
    doneAction: "Enter",
    hostTitle: "Add device",
    hostLead: "On the other device, select \"Yes, pair this device\". Then scan this code with its camera, or paste the link into it.",
    copyLink: "Copy link",
    linkCopied: "link copied",
    qrAlt: "Code to read with the other device's camera",
    noAccountKey: "Add or remove devices on the main device of the account.",
    serverUnsupported: "This server cannot pair devices yet.",
    gateHasAccount: "This device already has an account. To pair, use a device without an account.",
    gateInvalid: "This pairing link cannot be read.",
    failedTitle: "Pairing failed",
  },

  /* Os nomes dos destinos. A fronteira e a razão dela estão escritas no
     português, em `linguas/pt.ts`; aqui vale igual, com o mesmo cuidado que a
     `terminologia inglesa` do `catalogo.test.ts` já tem: a secção chama-se
     Communities, a coisa continua a ser um channel, e "server" continua fora. */
  rail: {
    profile: "Me",
    chat: "Communities",
    social: "Feed",
    people: "Friends",
    settings: "Settings",
    menu: "Open the side panel",
    porAtender: (quantas: number): string => (quantas === 1 ? "1 unattended" : `${quantas} unattended`),
  },

  sidebar: {
    aEsperaDeEntrada: "waiting for someone in the channel",
    chegouOutroNome: "the channel that arrived has another name",
    cancelar: "Cancel",
    cancelarEspera: (nome: string): string => `Stop waiting for ${nome}`,
    cancelarEsperaSemNome: "Stop waiting",
    canalDoConvite: "Channel from the invite",
    esperaCancelada: "You stopped waiting. If someone in the channel lets you in later, the channel shows up here.",
    headerProfile: "Me",
    headerChat: "Communities",
    headerSocial: "Feed",
    headerSettings: "Settings",
    newPost: "New post",
    createRoom: "Create channel",
    newRoom: "New room",
    editProfile: "Edit profile",
    joinWithLink: "Join with a link",
    entrarNoCanalOficial: "Join the Orwell channel",
    aEntrarNoCanalOficial: "Joining the Orwell channel…",
    noRoomsBefore: "You have no channels yet. Create one with the ",
    noRoomsAfter: " beside it.",
    addFriend: "Add friend",
    callPeople: (n: number): string => (n === 1 ? "1 person in a call, waiting for company" : `${n} people in a call`),
    /** A contagem e quem são. A razão inteira está na folha portuguesa. */
    callWho: (frase: string, quem: string): string => `${frase}: ${quem}`,
    callingYou: (name: string): string => `${name} is calling you`,
    inCallWith: (outros: number): string =>
      outros === 0
        ? "In a call: only you"
        : outros === 1
          ? "In a call: you and 1 other"
          : `In a call: you and ${outros} others`,
    myProfile: "Your profile",
    pickName: "Pick a name",
    audioGroup: "Sound and microphone",
    accountGroup: "Notifications and settings",
    painelDeControlo: "Control panel",
    abrirDefinicoes: "Open the settings",
    statusPrompt: "What are you up to?",
    unreadCount: (n: number): string => (n === 1 ? "1 unread message" : `${n} unread messages`),
    drawerLabel: "Channels",
    collapse: (nome: string): string => `Collapse ${nome}`,
    expand: (nome: string): string => `Show ${nome}`,
    hiddenRooms: (n: number): string => (n === 1 ? "1 hidden room" : `${n} hidden rooms`),
    voiceCount: (n: number): string => (n === 1 ? "1 person in this room" : `${n} people in this room`),
    categoryRestricted:
      "Shows only to people with the chosen roles. Other members can still read it.",
  },

  chat: {
    call: "Call",
    video: "Video",
    membersToggle: "Members",
    noRoom: "No channel open",
    inCallOne: " is in a call",
    inCallMany: " are in a call",
    joinCall: "Join",
    emptyTitle: "Start by creating a channel",
    emptyBody:
      "Only the members of a channel can read it. The server cannot read it.",
    emptyAction: "Create channel",
    copyText: "Copy text",
    textCopied: "text copied",
    /* Three states, three sentences. See the Portuguese note and
       `vazioDaConversa`: the middle one is the one that could not stay unsaid. */
    timelineEmpty: "Nobody has written here yet.",
    timelineEmptyBody: "Write the first message.",
    timelineEmptyLocked: "The conversation starts once the request is accepted.",
    timelineKeptTitle: "Nothing from this room is kept here.",
    timelineKeptBody:
      "This device keeps only the most recent messages of each channel. Old messages drop off over time. You did not delete anything.",
    timelineOlderTitle: "There are older messages still closed.",
    timelineOlderBody: "This device still holds history from this channel that is not on screen.",
    composerPlaceholder: "Write a message",
    send: "Send",
    sending: "sending",
    sendFailed: "not sent",
    aEsperaDeLigacao: "waiting for a connection",
    aEsperaDeLigacaoNota: "waiting for a connection. It shows the time it is sent.",
    discard: "Discard",
    newMessages: "↓ New messages",
    loadOlder: "Load older",
    joinPending: "Request sent. Waiting for somebody in the channel to accept you…",
    joined: (name: string): string => `You joined ${name}`,
    joinedOpaco: "You joined the channel.",
    leaveTitle: "Leave this channel?",
    leaveBody: "You can no longer see the messages in this channel. You leave the member list.",
    leaveOfflineTitle: "Could not leave the channel.",
    leaveOffline: "You can leave on this device only. The other members keep seeing you in the list until someone removes you.",
    leaveOnlyHereAction: "Leave this device only",
    left: "You left the channel. It is no longer on this device.",
    forgottenHere: "Forgotten on this device. The other members keep seeing you in the list.",
    leaveOnlyHereTitle: "Leave on this device only?",
    leaveOnlyHere:
      "The channel goes out of this device only. The other members still see you in the list until someone removes you.",
    removeChannelTitle: (nome: string): string => `Delete "${nome}"?`,
    removeChannelConfirm:
      "The channel disappears for all members. You cannot undo this. The app of each member deletes the messages of the channel, but a changed app can keep them.",
    removedChannel: (nome: string): string => `"${nome}" deleted.`,
    typing: (nomes: string[]): string => {
      if (nomes.length === 1) return `${nomes[0] ?? ""} is typing…`
      if (nomes.length === 2) return `${nomes[0] ?? ""} and ${nomes[1] ?? ""} are typing…`
      if (nomes.length === 3) return `${nomes[0] ?? ""}, ${nomes[1] ?? ""} and ${nomes[2] ?? ""} are typing…`
      return `${nomes.length} people are typing…`
    },
    unreadMark: "unread",
    unreadJump: (n: number): string => (n === 1 ? "1 unread message: go there" : `${n} unread messages: go there`),
    imageAdd: "Attach image",
    imageDrop: (nome: string): string => `Remove ${nome}`,
    imageCompressing: "compressing…",
    imagesFull: (n: number): string => `Only ${n} images fit in one message.`,
    messageTooLong: (n: number): string => `The message is longer than ${n} characters. Shorten it, or split it in two.`,
    /** The `@all` line in the mention list. */
    mencionarTodos: "Everyone in the channel",
    fileAdd: "Attach file",
    fileDrop: (nome: string): string => `Remove ${nome}`,
    filesFull: (n: number): string => `Only ${n} files fit in one message.`,
    fileTooBig: (nome: string, limite: string): string =>
      `${nome} does not fit in this message. The maximum is ${limite}. With images or text already attached, the maximum is smaller.`,
    fileNoRoom: "This message will not take anything else. Send what you have and attach the file to the next one.",
    fileUnreadable: "Could not read that file on this device.",
    fileReading: "reading…",
    fileDownload: "Save",
    fileDownloadOf: (nome: string): string => `Save ${nome}`,
    fileBroken: "this attachment arrived damaged and cannot be saved",
    linkPreviewAsk: "Preview",
    linkPreviewDrop: "Do not preview this link",
    buzz: "Nudge",
    moreActions: "Attach or nudge",
    editedMark: "(edited)",
    messageEdit: "Edit",
    messageEditLabel: "What you meant to say",
    messageEditSave: "Save",
    messageEditNote:
      "The message shows as edited. People who already read it saw the earlier version.",
    messageDelete: "Delete",
    messageMore: "More actions on this message",
    messageDeleteTitle: "Delete this message?",
    messageDeleteConfirm: "The message goes out of the conversation. Deleting does not undo what people already read.",
    messageModerate: "Delete",
    messageModerateTitle: (nome: string): string => `Delete the message of ${nome}?`,
    messageModerateConfirm: "The apps of the members hide the message. People who already read it, read it.",
    messageModerated: "Message deleted by moderation",
    messagePin: "Pin to the room",
    messageUnpin: "Unpin",
    pinnedTitle: "Pinned in this room",
    pinnedToggle: "See what is pinned in this room",
    pinnedNote:
      "A pinned message stays visible after it goes out of the history.",
    /* Two sentences for one emptiness: see the Portuguese note. Whoever cannot
       pin is not told about a door that is not there for them. */
    pinnedEmpty: "Nothing pinned in this room.",
    pinnedEmptyCanPin: "Nothing pinned in this room. Open a message's menu and choose \"Pin to the room\".",
    pinnedBy: (nome: string): string => `pinned by ${nome}`,
    pinnedNoText: "(no text)",
    pinnedDone: "Message pinned in this room.",
    pinnedUndone: "Message unpinned.",
    pinnedMark: "Pinned in this room",
    buzzTitle: "Shakes the screen of the other person, with sound.",
    buzzCounting: (segundos: number): string => `${segundos}s`,
    buzzWait: (segundos: number): string =>
      segundos === 1 ? "You can send another in 1 second" : `You can send another in ${segundos} seconds`,
    buzzMenuWait: (segundos: number): string => `Nudge (${segundos} s)`,
    searchToggle: "Search this conversation",
    searchPlaceholder: "Search",
    searchClear: "Clear",
    searchHint: "Type to search the messages in this channel.",
    searchEmpty: (termo: string): string => `Nothing found for "${termo}".`,
    searchCount: (n: number): string => (n === 1 ? "1 message found" : `${n} messages found`),
    searchMore: (mostradas: number, total: number): string =>
      `Showing the ${mostradas} most recent of ${total}. Type more to narrow it down.`,
    searchScanned: (n: number): string =>
      n === 1
        ? "Searched 1 message kept on this device."
        : `Searched ${n} messages kept on this device.`,
    searchCeiling:
      "The search finds only the messages kept on this device.",
    searchInRoom: (sala: string): string => `in ${sala}`,
    searchJump: "Go to the message",
    searchReading: "reading…",
  },

  primeirosPassos: {
    titulo: "How to reach someone",
    corpo: "To talk to someone, give your address, send a friend request or join with an invite link.",
    copiar: "Copy your address",
    copiado: "Address copied. Give it to a person. That person can add you.",
    amigo: "Add a friend",
    link: "Join with a link",
    fechar: "Close",
  },

  oficial: {
    selo: "official",
    seloTitle:
      "Common channel of this server. Any account can join without an invitation. Only the server can give this seal.",
    apresentacaoTitle: "Welcome to Orwell.",
    apresentacaoBody: "This is the common channel of the server. All accounts can read it.",
    apresentacaoFechar: "Close",
  },

  novidades: {
    titulo: "Release notes",
    soLeitura: "This room is read-only. It shows the release notes of each version.",
  },

  embaixador: {
    selo: "Orwell ambassador",
  },

  members: {
    count: (n: number): string => (n === 1 ? "1 person" : `${n} people`),
    drawerLabel: "People",
    groupOnline: "Online",
    groupOffline: "Offline",
    groupHeading: (titulo: string, n: number): string => `${titulo} · ${n}`,
    loading: "Loading…",
    empty: "Nobody here yet.",
    inviteSomeone: "Invite…",
    openChannel: "Common channel. Any account on this server can join without an invitation and read.",
    verifyHint: (name: string): string => `Verify security with ${name}`,
  },

  roles: {
    title: "Roles",
    accessOnly: "Access to the channel only.",
    cryptographic: (list: string): string => `Always applies: ${list}.`,
    irreversible: (list: string): string => `Permanent: ${list}.`,
    convention: (list: string): string => `App rule: ${list}.`,
    note: "A person who is expelled can no longer read the channel. The other rules depend on the app of each person.",
    noteFinal:
      "Ending the channel is permanent. The app of each member deletes the messages of the channel, but a changed app can keep them.",
    assignElsewhere: "Giving somebody a role is done on that person's profile.",
    add: "New role",
    nameLabel: "Role name",
    namePlaceholder: "Moderator",
    sealedGroup: "Always applies",
    irreversibleGroup: "Permanent",
    conventionGroup: "App rules",
    sealedNote: "The expelled person can no longer read the channel.",
    irreversibleNote: "You cannot undo it.",
    conventionNote: "The Orwell app obeys these rules. A changed app can ignore them.",
    create: "Create role",
    edit: "Edit",
    editTitle: (role: string): string => `Edit the ${role} role`,
    rename: "Rename",
    renameTitle: (role: string): string => `Rename the ${role} role`,
    renameLabel: (role: string): string => `New name of the ${role} role`,
    save: "Save",
    deleteLabel: "Delete",
    deleteTitle: (role: string): string => `Delete the ${role} role`,
    deleteNote: "People with this role lose its powers. Nobody is expelled.",
    powers: {
      expulsar: "expel",
      convidar: "invite",
      renomear: "rename",
      mover: "move",
      eliminar: "end the channel",
      fixar: "pin messages",
      atender: "handle tickets",
      moderar: "moderate",
      gerircargos: "manage roles",
      gerirsalas: "manage rooms",
      escrever: "write",
      anexar: "attach files",
      reagir: "react",
      mencionartodos: "mention everyone",
      ligar: "join voice",
      falar: "speak",
      video: "turn on video",
      ecra: "share the screen",
      musica: "play music",
      silenciarvoz: "mute in voice",
      ensurdecer: "deafen",
      desligar: "disconnect from the call",
      prioridade: "priority in voice",
      banir: "ban",
      silenciar: "time out",
      gerireventos: "manage events",
      gerirregras: "manage rules",
      gerirconvites: "manage invites",
      verregisto: "see the log",
      apelidos: "change nicknames",
    },
    colourLabel: "Colour",
    colourNone: "No colour",
    colourNoneTitle: "No colour. The role uses the colour of the app.",
    colourTitle: (cor: string): string => `${cor} colour`,
    colourNames: {
      rosa: "Pink",
      coral: "Coral",
      ambar: "Amber",
      lima: "Lime",
      menta: "Mint",
      turquesa: "Turquoise",
      ceu: "Sky",
      lilas: "Lilac",
      vermelho: "Red",
      laranja: "Orange",
      amarelo: "Yellow",
      verde: "Green",
      esmeralda: "Emerald",
      azul: "Blue",
      violeta: "Violet",
      fucsia: "Fuchsia",
    },
  },

  memberRoles: {
    title: (channel: string): string => `Roles in ${channel}`,
    has: (n: number): string => (n === 1 ? "Has 1 role" : `Has ${n} roles`),
    available: "Can receive",
    none: "No roles in this channel.",
    founder: "Founded this channel.",
    admin: "Channel administrator.",
    noneDeclared: "This channel has no roles yet. Create them in the channel properties.",
    founderLocked:
      "You cannot change the roles of the channel founder.",
  },

  cargosEPermissoes: {
    titulo: "Roles and permissions",
    ordemTitulo: "Order of the roles",
    ordemNota: "The role at the top manages the roles below it.",
    ordemComoMudar: "Drag a role, or use the arrows, to change the order.",
    posicaoNova: (cargo: string, lugar: number, total: number): string => `"${cargo}" is now in place ${lugar} of ${total}.`,
    ordemFixa: "Administration always stays at the top. Everyone in the channel sees this order.",
    fundador: "The person who founded the channel is above all roles.",
    subir: (cargo: string): string => `Move the ${cargo} role up`,
    descer: (cargo: string): string => `Move the ${cargo} role down`,
    arrastar: (cargo: string): string => `Drag the ${cargo} role`,
    abrir: (cargo: string): string => `Open the ${cargo} role`,
    novo: "New role",
    novoNome: "Name of the new role",
    criar: "Create",
    nome: (cargo: string): string => `Name of the ${cargo} role`,
    cor: (cargo: string): string => `Colour of the ${cargo} role`,
    semCor: "No colour",
    apagar: (cargo: string): string => `Delete the ${cargo} role`,
    permissoesDe: (cargo: string): string => `Permissions of the ${cargo} role`,
    bloqueado: "You cannot change this role. It is at your level or above.",
    semPoder: "You do not have this permission, so you cannot give it.",
    implicada: (de: string): string => `Comes with "${de}".`,
    todosTitulo: "Everyone",
    todosNota: "What all the people in the channel can do, with or without a role.",
    natureza: {
      cifra: "The encryption makes sure of this.",
      semVolta: "App rule. You cannot undo it.",
      combinado: "App rule. A changed app can ignore it.",
    },
    sobreposicoesTitulo: "Permissions per room",
    sobreposicoesNota:
      "A room or a category can give or remove a permission for a role. This is an app rule: the room has no key of its own, and the people in the channel can read all rooms.",
    lugar: "Room or category",
    categoria: (nome: string): string => `Category ${nome}`,
    sala: (nome: string): string => `Room ${nome}`,
    todos: "Everyone",
    estado: { herda: "Inherit", da: "Give", tira: "Remove" },
    estadoDe: (poder: string, cargo: string, lugar: string): string => `${poder} for ${cargo} in ${lugar}`,
    semLugares: "This channel has no rooms yet.",
    semPermissaoNoLugar: "You cannot change the permissions of this place.",
    delegacaoDesligada: "Only the founder and the administration change roles now. Somebody in the channel has an old version of the app.",
  },

  cargos: {
    listLabel: "Roles of the channel",
    tabsLabel: "Parts of the role",
    tabAppearance: "Appearance",
    tabPermissions: "Permissions",
    tabMembers: "Members",
    back: "All roles",
    open: "View",
    openTitle: (role: string): string => `View the ${role} role`,
    adminName: "Administrator",
    adminReadOnly: "This role comes with the channel. It always has all the permissions, and you cannot delete it.",
    adminAppearance: "You can change the name and the colour of this role. The permissions do not change.",
    adminWarning: "This role has everything. To give only a part, create a new role and select the permissions.",
    previewLabel: "Preview",
    previewNote: "This is how the role shows in the list of members.",
    previewPerson: "Ana",
    groups: {
      gerir: "Manage channel",
      membros: "Members",
      mensagens: "Messages",
      voz: "Voice",
      outras: "Other",
    },
    powerHelp: {
      expulsar: "Remove a person from the channel. The person cannot read the new messages.",
      convidar: "Bring new people into the channel.",
      renomear: "Change the name of the channel and arrange the rooms and the categories.",
      mover: "Move a person from one voice room to a different one.",
      eliminar: "End the channel for all members. You cannot undo it.",
      fixar: "Pin and unpin messages at the top of a room.",
      atender: "Take tickets, change their status and close them.",
      moderar: "Delete messages of other people, delete closed tickets and change nicknames.",
      gerircargos: "Create, change and give the roles below its own. It never gives more than it has.",
      gerirsalas: "Create and arrange rooms and categories, and their permissions.",
      escrever: "Write messages in the rooms.",
      anexar: "Attach files to messages.",
      reagir: "React to messages.",
      mencionartodos: "Write @all to mention everyone in the channel. In a muted room, @all does not notify.",
      ligar: "Join the voice rooms.",
      falar: "Speak in a voice room.",
      video: "Turn on the camera in a voice room.",
      ecra: "Share the screen in a voice room.",
      musica: "Play music in a voice room.",
      silenciarvoz: "Mute the microphone of a different person in voice.",
      ensurdecer: "Remove the sound for a different person in voice.",
      desligar: "Remove a person from the voice call.",
      prioridade: "Speak over the other people in voice.",
      banir: "Remove a person from the channel and stop the person from coming back.",
      silenciar: "Stop a person from writing in the channel for some time.",
      gerireventos: "Create and change the events of the channel.",
      gerirregras: "Create and change the automatic rules of the channel.",
      gerirconvites: "See, pause and delete the invites of the channel.",
      verregisto: "Read the log of what the roles did.",
      apelidos: "Change the nickname of other people in this channel.",
    },
    membersCount: (n: number): string => (n === 1 ? "1 member" : `${n} members`),
    membersNone: "Nobody has this role.",
    addMembers: "Add members",
    addMember: "Add",
    addMemberTitle: (name: string): string => `Give this role to ${name}`,
    removeMember: "Remove",
    removeMemberTitle: (name: string): string => `Remove this role from ${name}`,
    candidatesNone: "All members already have this role.",
    doneAdding: "Done",
    membersElsewhere: "To give or remove this role, open the profile of the person in the list of members.",
    membersNew: "Create the role first. Then you can give it to members.",
    membersAdmin: "You name and remove an administrator in the menu of the person.",
  },

  verify: {
    title: "Verify security",
    note: "Compare this number with the other person by voice or in person. If it matches, the connection is secure.",
    unavailable: "Could not verify this person now.",
  },

  call: {
    waiting: "waiting for somebody to join",
    people: (n: number): string => `${n} ${n === 1 ? "person" : "people"}`,
    micOn: "Turn microphone on",
    micOff: "Turn microphone off",
    cameraOn: "Turn camera on",
    cameraOff: "Turn camera off",
    soundOn: "Turn sound on",
    soundOff: "Turn sound off",
    shareScreen: "Share screen",
    stopScreen: "Stop sharing",
    screenAria: (sharing: boolean): string => (sharing ? "Sharing screen. Stop sharing." : "Share screen."),
    shareScreenBySfu: "This call carries voice only.",
    shareScreenByPeople: (limite: number, _porServidor = false): string =>
      `With ${limite} or more people in the call, you cannot share your screen.`,
    sharingOf: (name: string): string => `${name} is sharing their screen`,
    screenOf: (name: string): string => `${name}'s screen`,
    screenSelf: "Your screen",
    screenSoundVolume: "Screen sound volume",
    ecraInteiro: "View full screen",
    sairDoEcraInteiro: "Exit full screen",
    screenSoundSharing: "Sharing the system sound",
    screenSoundMutedSelf: "The system sound is muted",
    screenSoundMute: "Mute the screen sound",
    screenSoundUnmute: "Turn on the screen sound",
    /* O convite a ver, e quem está a ver. A razão inteira está na folha
       portuguesa: o ecrã de alguém passou a ver-se por escolha. */
    screenWatch: "Watch",
    screenStopWatching: "Stop watching",
    screenWatchAria: (name: string): string => `Watch ${name}'s screen`,
    screenStopWatchingAria: (name: string): string => `Stop watching ${name}'s screen`,
    screenViewers: (n: number): string =>
      n === 0 ? "Nobody watching" : n === 1 ? "1 watching" : `${n} watching`,
    aoVivo: "LIVE",
    verATransmissao: "Watch the stream",
    verATransmissaoDe: (name: string): string => `Watch the stream from ${name}`,
    micAria: (muted: boolean): string =>
      muted ? "Muted. Turn microphone on." : "Microphone on. Turn microphone off.",
    soundAria: (off: boolean): string => (off ? "No sound. Turn sound on." : "Sound on. Turn sound off."),
    micBySound: "Muted because the sound is off",
    videoLimitado: (razao: "bandwidth" | "cpu", _altura: number): string =>
      razao === "bandwidth" ? "picture reduced: slow network" : "picture reduced: slow device",
    micOptions: "Microphone options",
    soundOptions: "Sound options",
    inputDeviceDefault: "Whatever the system picks",
    inputDevicesLocked:
      "Microphones only appear by name after you have given microphone access once.",
    inputDevicesNone: "No microphone found.",
    inputDevicePick: "Choose microphone…",
    inputVolume: "Input volume…",
    notificationVolume: "Notification volume…",
    audioSettings: "Audio settings…",
    leave: "Leave the call",
    popOut: "Open in a window",
    self: "you",
    selfFallback: "You",
    connected: "connected",
    connecting: "connecting…",
    naChamadaSemSom: "in the call, no sound yet",
    semSomHaMuito: "in the call, but no sound reaches here",
    semLigacao: "could not connect to this person",
    silenced: "muted by you",
    micOffOf: (name: string): string => `${name} muted their own microphone`,
    silencedByYouOf: (name: string): string => `You muted ${name}: their volume is at zero on your side`,
    volumeOf: (label: string): string => `${label}'s volume`,
    menuSection: "In this call",
    menuSilence: "Silence for me",
    menuUnsilence: "Hear again",
    menuVolume: "Volume",
    menuVolumeValor: (pct: number): string => `${pct} %`,
    menuVolumeRepor: "Reset to normal volume, 100 %",
    personMenu: (label: string): string => `More actions for ${label}`,
    avisoCaminhosDiferentesDe: (nome: string): string => `You and ${nome} cannot hear each other. Both of you, leave the call and join again.`,
    avisoCaminhosDiferentes:
      "One person in this call cannot hear you. Both of you, leave the call and join again.",
    avisoEntradaFalhou:
      "The call did not start. Try again. If it fails again, copy the log in Settings, Diagnostics.",
    avisoPresencaCaducouDe: (nome: string): string => `${nome} lost the connection and left the call.`,
    avisoPresencaCaducou: "One person lost the connection and left the call.",
    avisoFechar: "Dismiss the warning",
    vistaAria: (sala: string): string => `Call in ${sala}`,
    pessoasNaChamada: "People in the call",
    controlos: "Call controls",
    soPalco: "Show only the stage",
    conversaDaSala: "Room chat",
    focoAria: (nome: string): string => `${nome}, in focus`,
  },

  ecra: {
    escolherTitulo: "Choose what to share",
    escolherLead: "The people in the call see this until you stop sharing.",
    ecras: "Screens",
    janelas: "Windows",
    ecraInteiroNota: "A whole screen shows everything that appears on it, system notifications included.",
    semNome: "Window with no name",
    aCarregar: "Looking for what there is to share…",
    vazio: "There is nothing to share right now.",
    escolherAria: (nome: string): string => `Share ${nome}`,
    escolherSomTitulo: "Where the sound comes from",
    escolherSomLead: "The others hear the sound. They do not see the window.",
    escolherSomAria: (nome: string): string => `Share the sound of ${nome}`,
    somDoSistemaNota:
      "The system sound goes with the screen. This sound includes the voice of the call, and the others can hear themselves with a delay. To mute it, press 'Mute the screen sound' in the call.",
    permissaoTitulo: "macOS is not allowing screen recording",
    permissaoCorpo:
      "Open macOS Settings, Privacy and Security, Screen Recording, and turn on Orwell. Without this, you cannot share your screen.",
    permissaoReiniciar:
      "Then quit Orwell and open it again.",
    permissaoAbrir: "Open Settings",
  },

  social: {
    title: "Posts",
    sealed: "Friends only",
    sealedTitle: "Only your friends can see your posts.",
    placeholder: "Write a post. Only your friends can see it.",
    titlePlaceholder: "Title (optional)",
    imagesFull: (n: number): string => `Only ${n} images fit in one post.`,
    imagesNoRoom: "This post will not take more images. Publish what you have and put the image in another one.",
    fileAdd: "Attach file",
    fileDrop: (nome: string): string => `Remove ${nome}`,
    filesFull: (n: number): string => `Only ${n} files fit in one post.`,
    fileTooBig: (nome: string, limite: string): string =>
      `${nome} does not fit in this post. The maximum is ${limite}. With images or text already attached, the maximum is smaller.`,
    fileNoRoom: "This post will not take anything else. Publish what you have and put the file in another one.",
    fileUnreadable: "Could not read that file on this device.",
    attachVideo: "Attach video",
    recordVideo: "Record video",
    videoOnlyOne: "A post takes one video only. Remove the video from the draft to choose another.",
    videoReading: "Reading the video…",
    videoDrop: (nome: string): string => `Remove ${nome}`,
    videoSending: (feitas: number, de: number): string => `Sending the video: part ${feitas} of ${de}.`,
    videoSendCancel: "Cancel the upload",
    videoOnlyThisSession: "This video is too large for the vault on this device. It stays only in this session until someone asks for it.",
    videoPlay: (nome: string, duracao: string): string => `Watch the video ${nome} (${duracao})`,
    videoReceiving: (feitas: number, de: number): string => `The video is arriving: part ${feitas} of ${de}.`,
    videoNotHere: "The video is not on this device.",
    videoAsking: "Asking for the video…",
    videoNobody: "No member with this video is online now. Try again later.",
    videoFailed: "The video arrived with errors. Ask for it again.",
    videoCannotPlay: "This device cannot show this video.",
    attachImage: "Attach image",
    addLink: "Add link",
    image: "Image",
    link: "Link",
    ctrlEnter: "Ctrl+Enter publishes",
    publishing: "publishing…",
    publish: "Publish",
    emptyTitle: "No posts yet.",
    emptyBody: "Post something or add a friend. Posts from your friends appear here.",
    emptyCircleTitle: "There is nothing to read yet.",
    emptyCircleBody: (people: number): string =>
      `${people === 1 ? "You have 1 friend" : `You have ${people} friends`}. No post has arrived yet. New posts appear here.`,
    emptyTagTitle: (tag: string): string => `Nothing with #${tag}.`,
    emptyTagBody: "No post has this tag.",
    support: "Support",
    filterByTag: (tag: string): string => `Show only #${tag}`,
    filterChip: (tag: string): string => `Showing only #${tag}: click to see everything`,
    filterClear: "Show everything",
    tagPreview: "goes with",
    viewImage: "See bigger",
    imageFallbackName: "Image",
    imagePrev: "Previous photograph",
    imageNext: "Next photograph",
    imageAt: (n: number, total: number): string => `Photograph ${n} of ${total}`,
    imageGo: (n: number): string => `See photograph ${n}`,
    copyAuthor: "Copy address",
    authorCopied: "address copied",
    postMenu: "Post options",
    edit: "Edit",
    editingChip: "Editing the post: only the caption changes.",
    editCancel: "Cancel",
    save: "Save",
    deleteAction: "Delete",
    deleteTitle: "Delete the post?",
    deleteConfirm: "Your friends stop seeing it. Deleting does not undo what people already read.",
    deleted: "post deleted",
    edited: (when: string): string => `edited on ${when}`,
    like: "Like",
    likeUndo: "Take back the like",
    dislike: "Dislike",
    dislikeUndo: "Take back the dislike",
    commentsToggle: (n: number): string => (n === 0 ? "Comments" : n === 1 ? "1 comment" : `${n} comments`),
    commentsEmpty: "Nobody has commented yet. Write the first one below.",
    commentPlaceholder: "Write a comment…",
    commentSend: "Comment",
    voteFailed: "could not record the vote",
    commentFailed: "could not comment",
    commentDelete: "Delete the comment",
    commentDeleteTitle: "Delete the comment?",
    commentDeleteConfirm: "The comment goes out of the post. Deleting does not undo what people already read.",
    commentDeleted: "comment deleted",
    commentDeleteFailed: "could not delete the comment",
    untitled: "Post",
    untitledPhoto: "Photograph",
    untitledLink: "Link",
  },

  people: {
    title: "Friends",
    sealed: "on this device only",
    sealedTitle:
      "This list stays on your devices only. The server does not know who your friends are.",
    searchPlaceholder: "Search by name, status or address…",
    noMatch: (query: string): string => `Nothing for "${query}".`,
    /* An answer to a search, which is not the same thing as an invitation.
       See the Portuguese note: this used to carry the "you know nobody yet"
       lecture underneath it. */
    noMatchBody: (n: number): string =>
      n === 1
        ? "Searched the one friend on this list, by name, status and address."
        : `Searched all ${n} friends on this list, by name, status and address.`,
    noMatchAction: "Show all",
    emptyTitle: "Nobody is here yet.",
    emptyBody:
      "Profiles appear when you join channels or add friends.",
    noFriendsTitle: "You have no friends here yet.",
    noFriendsBody: (n: number): string =>
      `You know ${n === 1 ? "one person" : `${n} people`} from your channels. To be friends, send a friend request. The other person must accept it.`,
    copyAddress: "Copy address",
    addressCopied: "address copied",
    requestsTitle: "Requests",
    accept: "Accept",
    accepted: "accepted. That person now sees what you publish",
    presence: "online",
    presenceIdle: "offline",
    presenceBusy: "busy",
    presenceTitle:
      "Green: this person was active in the last 10 minutes.",
    presenceTitleLive:
      "Green: online now. Your channels also see when you are online.",
    friendsTitle: "Contacts",
    wantsToBeFriends: (name: string): string => `${name} wants to be your friend`,
    requestWaits: "Waiting for your answer.",
    requestSent: (name: string): string => `You asked ${name} to be friends`,
    requestSentWait: "Waiting for that person's answer.",
    escritaEspera: "You can only exchange messages once the request is accepted.",
    escritaAceitaPrimeiro: "Accept the friend request so you can exchange messages.",
    escritaSemAmizade: "Private messages are between friends. Send a friend request to talk.",
    decline: "Decline",
    declined: "request declined",
    accepting: "accepting…",
    acceptedMutual: (name: string): string => `${name} is your friend`,
    acceptedPending: (name: string): string =>
      `${name} can now see your posts. You will see the posts of ${name} when they are online.`,
    asideLabel: "Friends and conversations",
    tabsLabel: "Friends tabs",
    titleCount: (n: number): string => `Friends (${n})`,
    tab: {
      amigos: "All",
      recebidos: "Received",
      enviados: "Sent",
      encontrar: "Find",
    },
    pendingCount: (n: number): string =>
      n === 1 ? "1 request waiting for an answer" : `${n} requests waiting for an answer`,
    directsTitle: "Private messages",
    directsEmpty: "None open. Pick somebody from the list to start talking.",
    directMine: "You: ",
    directFriendRequest: "Friend request",
    directClose: "Close conversation",
    directUnread: (n: number): string => `${n} unread`,
    backToList: "Back to the conversations",
    noPendingTitle: "Nothing waiting.",
    noPendingBody: "Friend requests made to you appear here, and in the bell.",
    unfriend: "Undo friendship",
    unfriendTitle: (name: string): string => `Undo the friendship with ${name}?`,
    unfriendConfirm: "You stop seeing the posts of each other.",
    directClosed: "Conversation closed. Nothing was erased. It comes back when a message arrives.",
    directReopen: "Reopen",
    unfriendDone: (name: string): string => `the friendship with ${name} is undone`,
    rowMore: (name: string): string => `More actions for ${name}`,

    sentTitle: "Sent requests",
    sentEmptyTitle: "No request is waiting.",
    sentEmptyBody: "The requests you make stay here until the person answers.",
    sentAt: (quando: string): string => `Sent ${quando}`,
    cancelRequest: "Cancel request",
    cancelled: "request cancelled",

    findTitle: "Find friends",
    findBody:
      "Show your QR code or send your link. To add someone, paste the link of that person.",
    myQrAlt: "The QR of your friend link",
    myLink: "Your friend link",
    copyLink: "Copy link",
    linkCopied: "friend link copied",
    pasteLabel: "Paste a link or an address",
    pastePlaceholder: "https://… or @name:server",
    pasteOpen: "Open profile",
    pasteInvalid: "This is not a friend link or an account address.",
    scanQr: "Scan QR",
    friendLinkInvalid: "This friend link cannot be read. Ask that person for a new link.",
    friendLinkOtherServer: "This account is on a different server. You can add friends only from your server.",
    scanning: "Point the camera at the QR of the friend link.",

    block: "Block",
    blockTitle: (name: string): string => `Block ${name}?`,
    blockBody:
      "This person can no longer write to you, send you a friend request or see your posts.",
    blockDone: (name: string): string => `${name} is blocked`,
    unblock: "Unblock",
    blockedState: "Blocked on this device",
    unblockDone: (name: string): string => `${name} is unblocked. To be friends again, a new request is necessary.`,
    escritaBloqueado: "You blocked this person. Unblock them in Settings to talk again.",
  },

  activity: {
    title: "How you appear",
    online: "Online",
    busy: "Busy",
    away: "Away",
    invisible: "Invisible",
    custom: "Custom…",
    busyNote: "While you are busy, system notifications stay quiet.",
    current: (activity: "online" | "ocupado" | "ausente" | "invisivel"): string =>
      activity === "invisivel"
        ? "Invisible: you appear offline to the others"
        : activity === "ocupado"
          ? "Busy: other people see you like this"
          : activity === "ausente"
            ? "Away: other people see you like this"
            : "Online: other people see you like this",
    invisibleNote:
      "Other people see you as offline. The server knows that you are connected, so it can deliver your messages.",
    latencyServer: (ms: number): string => `${ms} ms to the server`,
    latencyPeer: (ms: number): string => `${ms} ms to the people in the call`,
    latencyTail: (ms: number): string => ` · ${ms} ms`,
    stateLine: (estado: string, aSeguir: string | null): string => (aSeguir ? `${estado} · ${aSeguir}` : estado),
  },

  arquivados: {
    titulo: "Archived",
    nota: "Channels that you were removed from. You can read what stays on this device, but you cannot write.",
    vazio: "No archived channels.",
    desde: (quando: string): string => `archived on ${quando}`,
    ver: "View history",
    esconder: "Hide history",
    historicoDe: (canal: string): string => `History of ${canal}`,
    semMensagens: "No message with text was kept.",
    apagar: "Delete",
    apagarTitulo: (canal: string): string => `Delete the history of ${canal}?`,
    apagarCorpo: "The history goes out of this device permanently. There is no other copy.",
    apagado: "History deleted.",
  },

  sincronia: {
    lugar: "You joined here. What was said before does not come to this device.",
    lugarData: (data: string): string => `You joined on ${data}.`,
    aReceber: "Receiving the channel…",
    historico: (feitas: number, total: number): string => `Getting the history: ${feitas} of ${total} messages.`,
    historicoMedia: (feitas: number, total: number): string => `Getting the files: ${feitas} of ${total}.`,
    parte: (nome: string, recebidos: number, esperados: number): string => `${nome}: ${recebidos} of ${esperados}`,
    tipos: {
      fundador: "Founding",
      cargo: "Roles",
      atribuicao: "Who has roles",
      categoria: "Categories",
      sala: "Rooms",
      apagamento: "Deleted items",
      publicacao: "Posts",
      comentario: "Comments",
      gosto: "Likes",
      voto: "Votes",
      ticket: "Tickets",
    },
    titulo: "Same as the other members",
    nota: "Compares each channel with what the other members have. When something is missing, this device asks for it.",
    vazio: "You are not in a channel yet.",
    estados: {
      igual: "Same",
      "a-reparar": "Receiving what is missing",
      "sem-resposta": "No answer from the other members",
      "por-comparar": "Not compared yet",
    },
    ultima: (hora: string): string => `Last comparison: ${hora}`,
    feedDe: (nome: string): string => `${nome}'s feed`,
    anexoPedir: "Ask the other members",
    anexoAPedir: "Asking…",
    anexoNinguem: "No member with this image is connected now. Try again later.",
    anexoFicheiroNinguem: "No member with this file is connected now. Try again later.",
    anexoRecusado: "What came is not the original. It is not shown.",
    anexoSemLigacao: "No connection to the server. Try again.",
    anexoTentarOutraVez: "Try again",
    anexoCancelar: "Cancel",
  },

  avisosDoNucleo: {
    channelRemoved: (canal: string): string => `You are not in ${canal} now. You do not get its messages.`,
    welcomeDead: "This invitation does not work now. We asked for a new one.",
    channelDeleted: (canal: string): string =>
      `An administrator deleted ${canal}. The app of each member deletes the messages of the channel.`,
  },

  notifCenter: {
    sucessao: (de: string, para: string): string => `${de} is now ${para}. The account ${de} says so.`,
    sucessaoAdicionar: (para: string): string => `Add ${para}?`,
    sucessaoConvidar: (para: string, canal: string): string => `Invite ${para} to ${canal}?`,
    adicionar: "Add",
    convidar: "Invite",
    agoraNao: "Not now",
    title: "Notifications",
    bell: "Notifications",
    bellWithCount: (n: number): string =>
      n === 0 ? "Notifications" : n === 1 ? "Notifications, 1 unread" : `Notifications, ${n} unread`,
    empty: "You are up to date.",
    filtros: "Filter the notifications",
    filtroTudo: "All",
    filtroMencoes: "Mentions",
    filtroChamadas: "Calls",
    filtroConvites: "Invitations",
    filtroAmigos: "Friends",
    filtroVazio: "Nothing here.",
    hoje: "Today",
    ontem: "Yesterday",
    porLer: "unread",
    chamadaPerdida: (nome: string): string => `Missed call from ${nome}`,
    falhou: "Could not read the notifications stored on this device.",
    falhouNota: "Nothing was lost. What is stored is still there, unread.",
    markAllRead: "Mark everything as read",
    roomAdded: (room: string): string => `You were added to #${room}`,
    dmNew: (name: string): string => `${name} opened a conversation with you`,
    friendRequest: (name: string): string => `${name} wants to be your friend`,
    friendAccept: (name: string): string => `${name} accepted your request`,
    dmMessage: (name: string): string => `New message from ${name}`,
    joinedByInvite: (name: string, room: string): string => `${name} joined #${room} through your link`,
    mention: (name: string, room: string): string => `${name} mentioned you in #${room}`,
    friendRequestClosed: (name: string): string => `Request from ${name}: answered`,
  },

  userMenu: {
    profile: "View profile",
    dm: "Message",
    call: "Call",
    inviteToRoom: "Invite to a channel…",
    makeAdmin: "Make administrator",
    dropAdmin: "Remove as administrator",
    nickname: "Change nickname…",
    nicknameRemove: "Remove nickname",
    nicknameTitle: (nome: string): string => `Nickname of ${nome} in this channel`,
    nicknameTitleSelf: "Your nickname in this channel",
    nicknameLabel: "Nickname",
    nicknameHint: "It shows in front of the name, only in this channel. Maximum 32 characters.",
    nicknameSaved: "Nickname changed.",
    nicknameRemoved: "Nickname removed.",
    expel: "Expel from the channel",
    expelTitle: (name: string): string => `Expel ${name} from the channel`,
    expelBody:
      "The person can no longer read the channel. To come back, they need a new invitation.",
    expelConfirmLabel: (name: string): string => `Type "${name}" to confirm`,
    expelConfirm: "Expel",
    expelDone: (name: string): string => `${name} was expelled from the channel`,
    adminChanged: "Roles updated.",
    invited: (room: string): string => `invitation sent for #${room}`,
    noRooms: "You have no channels. Create one first.",
    friend: "Ask to be friends",
    friendSent: "request sent",
    acceptFriend: "Accept the request",
    friendPending: "Request sent",
    friendsNow: "Friends",
    friendsMenu: (name: string): string => `Friends: friendship menu with ${name}`,
    noteLabel: "Note for the request",
    notePlaceholder: "Optional. Say who you are, for example.",
    more: (name: string): string => `More actions for ${name}`,
  },

  convite: {
    titulo: (sala: string): string => `Invitation to ${sala}`,
    porResponder: "You will see messages from now on. You will not see earlier messages.",
    aceitar: "Join",
    recusar: "Not now",
    aResponder: "one moment…",
    aguarda: (nome: string): string => `Waiting for ${nome} to answer.`,
    aceiteFalta: (nome: string): string => `You accepted. You are in as soon as ${nome} connects.`,
    aceiteDado: "You accepted. You are already inside.",
    aceiteDeles: (nome: string): string => `${nome} accepted.`,
    recusado: "Invitation declined.",
    recusadoDeles: (nome: string): string => `${nome} is not joining.`,
    caducado: "This invitation has expired. Ask the person who invited you for a new one.",
    caducadoMeu: (nome: string): string => `The invitation to ${nome} expired. You can invite again.`,
  },

  callDock: {
    ongoing: "Call in progress",
    back: "Back to the channel",
    emChamada: "In a call",
    aPartilharEcra: "Sharing screen",
    /**
     * «Canal · Sala», pela ordem de quem procura: primeiro onde, depois a
     * divisão. Era «canal / sala»; o dono pediu o ponto a 27 de Outubro de
     * 2026, e a mesma linha serve o cartão lateral, que a faz andar quando
     * não cabe (ver `Andante`).
     */
    ondeComSala: (canal: string, sala: string): string => `${canal} · ${sala}`,
    /** O ping, no lugar de «Ligado» no cartão lateral: diz que está ligado e quão bem. */
    ping: (ms: number): string => `${ms} ms`,
    ligado: "Connected",
  },

  musicaNaChamada: {
    volumeDaEmissao: "Broadcast volume",
    volumeDaEmissaoNota: "Changes the sound that goes to the call. It does not change what you hear.",
    emissaoA: (percentagem: number): string => `Broadcast at ${percentagem}%`,
    silenciar: "Mute the music",
    ouvir: "Unmute the music",
    silenciarDe: (nome: string): string => `Mute the music of ${nome}`,
    ouvirDe: (nome: string): string => `Unmute the music of ${nome}`,
    silenciada: "Music muted",
  },

  leitorDeMusica: {
    visor: "Player display",
    tempo: (decorrido: string, total: string | null): string =>
      total === null ? `${decorrido} elapsed` : `${decorrido} of ${total}`,
    semFaixa: "Nothing is playing",
    espectro: "Sound spectrum",
    posicao: "Position in the track",
    anterior: "Previous track",
    seguinte: "Next track",
    abrir: "Open files",
    repetir: "Repeat the list",
    baralhar: "Shuffle the list",
    adicionarFicheiros: "Add files",
    adicionarPasta: "Add a folder",
    largarAqui: "Drop the audio files here.",
    arrastar: "Drag to change the order.",
    outrasFontes: "Other sources",
    volumes: "Volumes",
  },

  linkCard: {
    kindLink: "Link",
    kindVideo: "Video",
    kindImage: "Image",
    kindPost: "Post",
    urlPlaceholder: "https://…",
    titlePlaceholder: "Title (optional)",
    videoPrefix: "Video · ",
    fetchPreview: "Fetch title and thumbnail",
    fetching: "fetching…",
    fetchFailed: "This site did not let your device read the page. Write the title and choose the thumbnail.",
    fetchEmpty: "The page states no title and no image. Write them yourself.",
    pickThumb: "Choose thumbnail",
    dropThumb: "Remove the thumbnail",
    thumbTooBig: "That image cannot be a thumbnail. Choose a smaller one.",
    openVideo: "Open the video on YouTube, in a new window",
  },

  profile: {
    noName: "No name",
    nomeDoEndereco: "From the address",
    sealed: "Your channels",
    sealedTitle: "Only people in your channels can see your profile.",
    editProfile: "Edit profile",
    postSingular: "post",
    postPlural: "posts",
    emptyTitle: "You have not posted anything yet.",
    emptyBody:
      "Only your friends can see your posts.",
    newPost: "New post",
    kindsLabel: "Kinds of post",
    kindPhotos: "Photos",
    kindFiles: "Files",
    kindText: "Text",
    kindLinks: "Links",
    kindEmpty: "Nothing of this kind.",
    kindEmptyBody: "Change tab, or publish something of this kind.",
    postsListLabel: "Your posts",
    openPost: "Open the post",
    rowPhotos: (n: number): string => (n === 1 ? "1 photograph" : `${n} photographs`),
    rowLink: "link",
    foundedTitle: "Channels I founded",
    foundedEmpty: "You have not founded a channel yet.",
    foundedOpen: (nome: string): string => `Open ${nome}`,
  },

  enquadrar: {
    titulo: {
      circulo: "Frame the photo",
      quadrado: "Frame the icon",
      capa: "Frame the cover",
    },
    instrucoes: "Drag the image to move it. Use the mouse wheel, two fingers or the bar to zoom.",
    teclado: "Use the arrow keys to move the image. Use plus and minus to zoom.",
    moldura: "Image to frame",
    ampliar: "Zoom",
    gifFixo: "An animated GIF cannot move or zoom. It stays in the centre, so that it stays animated.",
    guardar: "Save",
    aGuardar: "Saving…",
    enquadrarCapa: "Frame the cover",
  },

  profileEditor: {
    title: "Your profile",
    lead: "Only people in your channels can see your profile. The server does not keep it.",
    nameRequired: "A name first.",
    chooseImage: "Choose image",
    remove: "Remove",
    name: "Name",
    namePlaceholder: "How you want to appear",
    bio: "Bio",
    bioNote: "Who you are, in a few lines. The status is what you do now.",
    email: "Email",
    optional: "optional",
    emailPlaceholder: "For contact outside Orwell",
    emailNote:
      "It is not for sign-in or account recovery. Only people who already talk to you can see it.",
    donations: "Support",
    donationLabelPlaceholder: "Label",
    donationValuePlaceholder: "Link, IBAN or address",
    add: "Add",
    donationsNote:
      "They show as text to copy. The app does not contact payment services.",
    saving: "saving…",
    save: "Save",
    discard: "Discard the changes?",
    showFriends: "Show my friend list to my friends",
    showFriendsNote: "Only your friends see the list. Choose who appears in it. Nobody sees which friends they share.",
    showFriendsEmpty: "You have no friends to show yet.",
    showFriendsWho: "Who appears in the list",
  },

  settings: {
    media: "Microphone and camera",
    voz: {
      lead: "The app processes your voice on this device, before it encrypts it. Your voice does not leave the device for processing.",
      perfil: "Noise reduction",
      perfis: {
        desligado: { nome: "Off", frase: "No processing. Your voice goes out as the microphone captures it." },
        leve: { nome: "Light", frase: "Removes constant noise. The voice stays almost the same." },
        normal: { nome: "Normal", frase: "Removes noise and keyboard sounds. Makes the voice volume even. Recommended." },
        maximo: { nome: "Maximum", frase: "Removes the most noise in the pauses. For places with much noise." },
      },
      teste: "Microphone test",
      entrada: "Input",
      saida: "Output",
      ruido: "Estimated noise",
      dbfs: (db: number): string => `${db} dB`,
      ouvirMe: "Hear me",
      ouvirMeNota: "Use headphones. With speakers you get echo.",
      indisponivel: "This version of the app does not process the voice.",
    },
    sensibilidade: {
      titulo: "Microphone sensitivity",
      automatica: "Automatic",
      automaticaNota: "The app decides when the microphone transmits. It follows the noise in the room.",
      nota: "The microphone transmits only above this line. Speak normally and put the line below the green.",
      linha: "Microphone line",
      nivel: "Microphone level",
      db: (db: number): string => `${db} dB`,
      aAbrir: "Opening the microphone.",
      carregarParaFalar: 'With the "Talk while held" shortcut, the line also applies while you hold the key.',
    },
    atalhos: "Keyboard shortcuts",
    atalhosNota: "They work only when the page is in front. Any key works, or mouse buttons 4 and 5.",
    atalhosNotaSecretaria:
      "During a call, the microphone and sound shortcuts also work when the app is minimised or behind another app. The other shortcuts and the mouse buttons work only when the app is in front.",
    atalhoAccao: {
      microfone: "Mute or unmute the microphone",
      som: "Turn the sound off or on",
      camara: "Turn the camera on or off",
      ecra: "Share or stop sharing the screen",
      sair: "Leave the call",
      falar: "Talk while held, with the microphone muted",
      overlay: "Show or hide the game overlay",
    },
    atalhoMudar: "Change",
    atalhoLimpar: "Clear",
    atalhoNenhum: "No shortcut",
    atalhoAGravar: "Press a key or a side mouse button. Esc cancels.",
    atalhoInvalido: "That key cannot be a shortcut.",
    atalhoRato: (botao: number): string => `Mouse ${botao}`,
    atalhoAvisoComum: "This key types text. The shortcut works only when the app is in front and outside text boxes.",
    atalhoAvisoEscreve: "This key types a symbol. During a call, it stops typing in other apps.",
    atalhoOcupado: "Another app already uses the key of a shortcut. When the app is hidden, that shortcut does not work. Choose another key.",
    atalhoSemAcessibilidade:
      "To use a media key when the app is hidden, macOS asks for the Accessibility permission. Turn on Orwell in Privacy and Security, Accessibility.",
    atalhoAbrirAcessibilidade: "Open the Settings",
    atalhosRepor: "Restore the defaults",
    micMuted: "Mute the microphone",
    soundOff: "Turn the sound off",
    echoCancellation: "Cancel echo",
    echoCancellationNota: "For people who use speakers.",
    inputDevice: "Microphone",
    inputGain: "Input volume",
    outputVolume: "Output volume",
    /** O teste do microfone, por palavras. Ver as notas no português, que é o catálogo base. */
    testeNaChamada: "You are in a call. The test uses the same microphone.",
    entradaParada: 'Turn on "Hear me" and speak. The bars show the sound after noise reduction.',
    entradaAEscutar: "Listening. Say something.",
    entradaApanha: "Picking you up. This is the microphone the call will use.",
    entradaSemSinal: "Nothing picked up. If you are speaking, the microphone you chose is not the one hearing you.",
    entradaEsgotado: "Stopped after a minute and closed the microphone. Start it again if you need it.",

    camara: "Camera",
    videoQuality: "Video quality",
    videoAuto: "Automatic",

    title: "Settings",
    language: "Language",
    languageAuto: "Automatic",
    languageNote:
      "Changes the language of the app. Messages are not translated.",
    account: "Account",
    editProfile: "Edit profile",
    notifications: "Notifications",
    notifSystem: "System notifications",
    notifBlocked: "Blocked by the browser. To use them, allow notifications in the site settings.",
    notifUnsupported: "Notifications do not work here.",
    notifPreview: "Show the content",
    avisarAmigosOnline: "When a friend comes online",
    avisarAmigosOnlineNota: "A notice and a sound, at most once every 30 minutes per friend and per type.",
    avisosDeAmigos: "Friend notices",
    avisarAmigosNaVoz: "When a friend joins a voice room",
    avisarAmigosNoEcra: "When a friend shares the screen",
    avisarAmigosNaComunidade: "When a friend joins one of your channels",
    sounds: "Sounds",
    soundVolume: "Sound volume",
    soundSample: "Listen",
    device: "This device",
    zonaDePerigo: "Danger zone",
    exportAction: "Export account",
    exportPassLabel: "Password for the file",
    exported: "account exported. The file is the account, keep it safe",
    exportNeedsAccountKey: "Make the backup on the main device of the account.",
    importReplacesDevice:
      "Importing moves the account to this device. The old device can no longer use it. To use the account on two devices, select \"Add device\" on the main device and \"Yes, pair this device\" on the new one.",
    devices: "Devices",
    devicesLead: "The devices with this account. Each device has only the messages it got after it joined.",
    deviceAddedAt: (data: string): string => `device added on ${data}`,
    thisDevice: "this device",
    devicesUnknown: "Could not get the list of devices.",
    addDevice: "Add device",
    revoke: "Revoke",
    revokeTitle: "Revoke this device?",
    revokeBody:
      "The device leaves the account and every channel. Revoking stops reading from the next epoch. What the device already had, it keeps.",
    revokeHonest: "Revoking stops reading from the next epoch. What the device already had, it keeps.",
    revoking: "Revoking the device…",
    revoked: "The device was revoked.",
    revokePending: "being revoked",
    revokeServerUnsupported: "This server cannot revoke devices.",
    revokeSelf: "This device does not revoke itself. Revoke it from another device.",
    ajuda: "Help and diagnostics",
    diagnostics: "Diagnostics log",
    diagnosticsNote:
      "Keeps the last 200 events of this session, without messages or text from you. It is deleted when you close the app. Copy it to report a problem.",
    diagnosticsCopy: "Copy the log",
    blocked: "Blocked",
    blockedNote: "The list goes to your other devices. A device with an old version does not know it.",
    blockedEmpty: "You did not block anyone.",
    blockedSince: (data: string): string => `since ${data}`,
    privacidade: "Privacy",
    oQueGuarda: "What the app keeps",
    oQueGuardaTexto:
      "The messages stay encrypted in the vault of this device. The server never has them in clear. The diagnostics log keeps 200 events without text from you, and it is deleted when you close the app.",
    sincronizar: "Sync the account",
    sincronizarNota: "Asks again for the channels that do not open, and checks the friendships and the conversations. Deletes nothing.",
    aSincronizar: "Syncing…",
    repararSemLigacao: "Needs a connection to the server.",
    repararNada: "Every channel opens.",
    repararAmizadesFeito: "The friendships were checked.",
    repararFeito: (antes: number, depois: number): string =>
      depois === 0
        ? antes === 1
          ? "Before, 1 channel did not open. Now it opens."
          : `Before, ${antes} channels did not open. Now they all open.`
        : depois === 1
          ? "1 channel is still closed. It opens when someone in that channel is online."
          : `${depois} channels are still closed. They open when someone in those channels is online.`,
    diagnosticsCopied: "log copied. Paste it into the report",
    diagnosticsEmpty: "No events recorded in this session yet.",
    diagnosticsCount: (n: number): string => (n === 1 ? "1 event" : `${n} events`),
    sobreVersao: (versao: string): string => `Orwell ${versao}`,
    codigoAberto: "Orwell is open source, under the AGPL-3.0.",
    codigoFonte: "Source code",
    lockNow: "Sign out",
    lockNote: "Closes the vault and forgets the session on this device. The account stays, and comes back with the password.",
    memorizarSessao: "Remember the session on this device",
    memorizarSessaoNota: "With this on, Orwell opens without asking for the password. To be asked again, turn it off or sign out.",
    memorizarSessaoIndisponivel: "This device has nowhere safe to keep the session.",
    sessaoNaoExpira: "With the session remembered, the session does not expire. To expire it, turn off \"Remember the session\".",
    semPalavraPasse: "This account has no password on this device. To be able to sign out, set one.",
    definirPalavraPasse: "Set a password",
    definirPalavraPasseNota: "From now on, the account opens with this password on this device. With it, you can sign out. The account stays, and comes back with the password.",
    palavraPasseDefinida: "The account now has a password on this device.",
    destroyAction: "Erase the account from this device",
    destroyTitle: "Erase the account?",
    destroyBody: "There is no copy on the server. The account is gone permanently.",
    destroyDetail:
      "Deletes the account, the channels, the history and the invitations from this device. Nobody can recover them.",
    destroyConfirmLabel: 'Type "erase" to confirm',
    destroyConfirmWord: "erase",
    destroyConfirm: "Erase for ever",
    destroySteps:
      "Before it is deleted, the account leaves all channels.",
    destroyStepsGate:
      "With the account locked, it cannot leave the channels. Your name can stay in the member lists.",
    destroyStepsImport:
      "Importing erases the account on this device and puts the one from the file in its place. With the vault locked, the erased account does not leave its channels. Its name can stay visible there.",
    destroyStepsJoin:
      "Joining erases this account from this device. First, the account tells its contacts and channels, ends its friendships and leaves every channel. If pairing fails, nothing is erased.",
    destroyStepsPair:
      "Pairing puts the other account in place of this one. The app erases the account on this device only when the other account is in. If pairing fails, this account stays. With the vault locked, the erased account does not leave its channels. Its name can stay visible there.",
    destroyRetry: "Try again",
    somPorTipo: "One sound for each event",
    somTipos: {
      directa: "Private message",
      mencao: "When someone mentions you",
      canal: "Sound for messages in channels",
      pedido: "Friend request",
      aceite: "Friend request accepted",
      chamada: "Incoming call",
      entrou: "Someone joins the voice room",
      saiu: "Someone leaves the voice room",
      ligado: "The call connects",
      cotovelada: "Nudge",
      ticket: "New ticket or reply",
      publicacao: "Post from a friend",
      actualizacao: "Update available",
      "mic-silenciado": "Mute the microphone",
      "mic-ligado": "Unmute the microphone",
      "tudo-silenciado": "Mute all (microphone and sound)",
      "tudo-ligado": "Unmute all (microphone and sound)",
      "amigo-online": "A friend comes online",
      "sala-afk": "Moving to the AFK room",
      enviada: "Sound when sending messages",
      "a-chamar": "Outgoing call, waiting for an answer",
      "voz-perdida": "The connection to the call drops",
      movido: "A moderator moves you to another room",
      "transmissao-iniciada": "A stream starts",
      "transmissao-terminada": "A stream ends",
      "espectador-entrou": "Someone starts to watch your stream",
      "espectador-saiu": "Someone stops watching your stream",
    },
    somOuvirTipo: (nome: string): string => `Listen: ${nome}`,
    somVibrar: "Vibrate on the phone",
    somChamadaComOcupado: "The call rings when you are \"Busy\" or \"Invisible\"",
    somNota: "These sounds stay on this device. \"Busy\" and \"Invisible\" silence all of them, except the call.",
  },

  notifications: {
    title: "Orwell",
    reportCopy: "New report in the channel",
    reportDecision: (decisao: "suspensa" | "sem-accao"): string =>
      decisao === "suspensa" ? "We reviewed your report: account suspended." : "We reviewed your report: no action.",
    reportDecisionVias: "If you disagree, write to orwell.eu@proton.me, go to the courts, or complain to ANACOM.",
    newMessage: (room: string): string => `New message in ${room}`,
    newNotice: "You have a new notification",
    amigoOnline: (nome: string): string => `${nome} is online`,
    amigoOnlineDiscreto: "A friend is online",
    abrirConversa: "Open conversation",
    amigoNaVoz: (nome: string, sala: string): string => `${nome} joined the voice room ${sala}`,
    amigoNaVozDiscreto: "A friend joined a voice room",
    amigoNoEcra: (nome: string, sala: string): string => `${nome} started to share the screen in ${sala}`,
    amigoNoEcraDiscreto: "A friend started to share the screen",
    amigoNaComunidade: (nome: string, canal: string): string => `${nome} joined the channel ${canal}`,
    amigoNaComunidadeDiscreto: "A friend joined a channel",
    juntarMe: "Join",
    ver: "Watch",
    abrir: "Open",
    agoraMesmo: "just now",
    maisAmigosOnline: (n: number): string => (n === 1 ? "+1 friend online" : `+${n} friends online`),
    maisAvisos: (n: number): string => (n === 1 ? "+1 friend notice" : `+${n} friend notices`),
  },

  invite: {
    title: "Invite link",
    expiresIn: "Expires in",
    usesFor: "Good for",
    expiry1h: "1 hour",
    expiry1d: "1 day",
    expiry7d: "7 days",
    expiryNever: "Never",
    uses1: "1 person",
    uses5: "5 people",
    uses25: "25 people",
    usesUnlimited: "No limit",
    yourLink: "Your link",
    qrAlt: "The QR of the invite",
    linkCare:
      "Use a short deadline and few uses.",
    /** Desktop build only: an https link opens the browser, not this window. */
    desktopNote:
      "In the installed app, paste the link into \"Join with a link\".",
    waitingNote: "Somebody from the channel has to be online to complete the joining.",
    copyLink: "Copy link",
    creating: "creating…",
    createLink: "Create link",
    linkCopied: "link copied",
    activeTitle: "Active invitations",
    /* An invitation that ran out of time is not an invitation never made.
       See the Portuguese note: only expiry removes one from this list. */
    activeEmpty: "No active invitations.",
    revoke: "Revoke",
    revoked: "Invitation revoked.",
    neverExpires: "never expires",
    expiresAt: (when: string): string => `expires on ${when}`,
    usesOf: (uses: number, maxUses: number | null): string =>
      maxUses === null ? `${uses} uses · no limit` : `${uses}/${maxUses} uses`,

    /* The invitation the page was opened with. It never joins by itself. */
    gateWaiting: "You have an invitation waiting. Sign in or create an account to open it.",
    gateInvalid: "The invitation link you opened is not valid. Ask the sender for a new one.",
    arrivedTitle: "Invitation to a channel",
    /* "The link says": the channel name is written into the link by its sender
       and is not verified. See the Portuguese note. */
    arrivedBody: (channel: string, server: string, quem?: string): string =>
      quem
        ? `Invitation from ${quem} to "${channel}", on ${server}. The names can be false. You can confirm them only after you join. Do you want to ask to join?`
        : `Invitation to "${channel}", on ${server}. The name can be false. You can confirm it only after you join. Do you want to ask to join?`,
    arrivedBodyUnnamed: (server: string): string =>
      `Invitation to a channel, on ${server}. You see the name of the channel only after you join. Do you want to ask to join?`,
    arrivedMismatch: (appeared: string, named: string): string =>
      `The channel ${appeared} appeared while you were waiting for ${named}. If you joined through the link, the name it gave was not the real one.`,
    arrivedNote: "People in the channel will see your address. Somebody there has to be online to let you in.",
    arrivedAccept: "Join",
    arrivedDecline: "Not now",
    otherServer: (theirs: string, mine: string): string =>
      `This invitation is from the server ${theirs}. Your account is on ${mine}. You can use only invitations from your server.`,
    alreadyIn: (name: string): string => `You are already in ${name}.`,
    alreadyInOpaco: "You are already in this channel.",
    arrivedMismatchOpaco: "Another channel appeared while you waited for the one in the invite. Check where you joined.",
  },

  menu: {
    open: "Open",
    joinCall: "Join the call",
    joinVideo: "Join with video",
    invite: "Invite…",
    leaveCall: "Leave the call",
    properties: "Properties",
    renameRoom: "Rename",
    renameRoomTitle: "Rename the room",
    closeRoom: "Close room",
    leave: "Leave the channel",
    remove: "Delete channel",
    joinRoom: "Join",
    newRoom: "New room",
    newCategory: "New category",
    markRead: "Mark as read",
    markReadDirect: "Mark as read",
    renameCategory: "Rename the category",
    categoryVisibility: "Who sees this category",
    deleteCategory: "Delete category",
  },

  newRoom: {
    title: "New room",
    lead: "A room inside this channel. All members of the channel see all rooms.",
    nameLabel: "Name",
    namePlaceholder: "Announcements",
    categoryLabel: "Category",
    categoryPlaceholder: "Leave empty not to group it",
    kindLabel: "Kind",
    kindText: "Text",
    kindVoice: "Voice",
    kindTickets: "Tickets",
    ticketsNote:
      "Each request for help is a ticket, with its own status.",
    note: "Hiding a room only tidies the list. All members of the channel can read it.",
    nameRequired: "The room needs a name.",
    create: "Create",
    creating: "Creating…",
    created: "Room created.",
    afkLabel: "AFK room",
    afkNote: "People who stay muted in a voice room come here by themselves. A channel has one AFK room only.",
  },

  tickets: {
    title: "Tickets",
    empty: "There are no tickets in this room yet.",
    emptyHint: "Open one to ask for help. All members of this channel see it.",
    open: "Open ticket",
    subjectLabel: "Subject",
    subjectPlaceholder: "Broken printer",
    subjectRequired: "The ticket needs a subject.",
    create: "Open",
    creating: "Opening…",
    stateOpen: "Open",
    stateWorking: "In progress",
    stateClosed: "Closed",
    filterAll: "All",
    openedBy: (quem: string): string => `Opened by ${quem}`,
    attendedBy: (quem: string): string => `${quem} is handling it`,
    unattended: "Unattended",
    take: "Handle it",
    release: "Drop it",
    close: "Close ticket",
    reopen: "Reopen",
    delete: "Delete ticket",
    deleteTitle: (assunto: string): string => `Delete the ticket "${assunto}"?`,
    deleteConfirm: "The ticket goes out of the board of all members. You cannot reopen it. People who already read it, read it.",
    replyPlaceholder: "Reply in this ticket",
    send: "Reply",
    back: "Back to the board",
    count: (n: number): string => (n === 1 ? "1 message" : `${n} messages`),
    noSubject: "Ticket with no subject",
    noSubjectHint:
      "The first message of this ticket is from before you joined the channel. You cannot see it.",
    partial:
      "Tickets opened before you joined the channel can be missing here.",
    note: "All members of the channel can read tickets.",
  },

  newCategory: {
    title: "New category",
    lead: "It groups rooms in the list. After you create it, drag rooms into it.",
    nameLabel: "Name",
    namePlaceholder: "Management",
    nameRequired: "The category needs a name.",
    note: "Deleting a category does not delete its rooms.",
    create: "Create",
    creating: "Creating…",
    created: "Category created. Drag rooms into it.",
  },

  categoryProperties: {
    title: "Who sees this category",
    lead: "Choose who sees the rooms in this category.",
    note: "Hiding only tidies the list. All members of the channel can read these rooms. To keep conversations apart, create a different channel.",
    audienceLabel: "Who sees it",
    everyoneOption: "Everybody",
    adminsOption: "Administrators only",
    rolesOption: "Specific roles",
    rolesLabel: "Roles",
    everyone: "Every member of the channel",
    adminNote:
      "Administrators always see all categories.",
    defaultRoomNote: "The default room is always visible.",
    noRoles:
      "This channel has no roles yet. Create one in the channel properties.",
    noRolesYet: "This channel has no roles yet.",
    creating: "Creating…",
    save: "Save",
    saving: "Saving…",
    saved: (categoria: string): string => `Saved who sees ${categoria}.`,
    hides: (salas: number): string =>
      salas === 0
        ? "No room leaves the list yet: the restriction will apply to the rooms you put in this category."
        : salas === 1
          ? "1 room leaves the list of the people without these roles."
          : `${salas} rooms leave the list of the people without these roles.`,
    hidesFromNonAdmins: (salas: number): string =>
      salas === 0
        ? "No room leaves the list yet: the restriction will apply to the rooms you put in this category."
        : salas === 1
          ? "1 room leaves the list of the people who do not administer the channel."
          : `${salas} rooms leave the list of the people who do not administer the channel.`,
  },

  roomProperties: {
    title: "Channel properties",
    lead: "The name and the icon everybody sees. They change for every member.",
    nameLabel: "Name",
    topicLabel: "Description",
    topicPlaceholder: "What this channel is for",
    pickIcon: "Choose icon",
    clearIcon: "Remove",
    iconTooBig: "That image could not be used. Choose another one.",
    nameRequired: "The channel needs a name.",
    discard: "Discard the changes?",
    save: "Save",
    saving: "Saving…",
    saved: "Properties saved.",
    readOnly: "Only the channel administrators can change this.",
    noOwner:
      "This channel has no administrator. While that is the case, any member can change these properties.",
    claim: "Take over the administration",
    claimed: "You now administer this channel.",
    roleFounder: "Founder",
    roleAdmin: "Administrator",
    seccoesLabel: "Property sections",
    seccoes: {
      geral: "General",
      salas: "Rooms",
      cargos: "Roles",
      membros: "Members",
      convites: "Invites",
      moderacao: "Moderation",
      eventos: "Events",
    },
    salasNota: "To create a room, use \"New room\" in the channel menu. To rename a room or to close it, open the menu of that room.",
    membrosBreve: "The list of the channel members, with the roles of each one, will be here. To give a role now, open the profile of the person.",
    convitesBreve: "The list of the channel invites, with the time limit and the uses of each one, will be here. To invite now, use \"Invite\" in the channel menu.",
    moderacaoBreve: "The banned and muted people, and the automatic rules of the channel, will be here.",
    eventosBreve: "The events room will be here: the message for people who join and the notice when someone leaves.",
    denuncias: {
      titulo: "Reports",
      vazio: "Nobody reported anything in this channel.",
      nota: "Each report comes without the name of the person who made it. The server also received it.",
      aLer: "Reading the reports…",
      motivos: { ...MOTIVOS_DA_DENUNCIA, 8: "Other" },
      pessoaRotulo: "Reported person",
      canalRotulo: "Channel",
      salaRotulo: "Room",
      provaRotulo: "Proof",
      notaRotulo: "Note",
      mensagensRotulo: "Messages",
      porAbrir: (n: number): string =>
        n === 1
          ? "1 report is waiting. It arrives when the device with the account key is online."
          : `${n} reports are waiting. They arrive when the device with the account key is online.`,
      nova: "New",
      verificada: "Verified",
      naoVerificada: "Not verified",
      denunciada: "Reported message",
      semTexto: "No text.",
      anexo: (nome: string, tipo: string): string => `Attachment: ${nome} (${tipo})`,
    },
  },

  prompts: {
    createRoomTitle: "Create channel",
    nameLabel: "Name",
    namePlaceholder: "general",
    joinTitle: "Join with a link",
    joinLabel: "Invitation link",
    joinPlaceholder: "https://orwell.pt/c#…",
    joinHint: "Somebody from the channel has to be online to let you in.",
    joinInvalid: "That link is not valid.",
    friendTitle: "Add friend",
    personLabel: "The person's address",
    personPlaceholder: "@abc…:server",
    friendHint: "It opens the profile of that person. There you ask to be friends, with a note if you like.",
    friendConfirm: "View profile",
    seatDone: "The person is in the channel now.",
    seatAlready: "This person was already in the channel.",
    cancel: "Cancel",
    confirm: "Confirm",
  },

  confirmar: {
    cancelar: "Cancel",
    descartarCorpo: "Your changes will be lost.",
    descartar: "Discard",
  },

  convidar: {
    title: (canal: string): string => `Invite to ${canal}`,
    modosLabel: "How to invite",
    modoEndereco: "By address",
    modoLink: "By link",
    modoMeter: "Add now",
    enderecoHint:
      "The person gets the invitation in a private message. They join if they accept. They see messages from then on.",
    enderecoAccao: "Send invitation",
    meterHint:
      "The person joins now and does not have to accept. They see messages from now on, not earlier ones.",
    meterAccao: "Add now",
    meterPorProvar: "The entry is not confirmed yet. Nothing changed. Try again soon.",
    meterEspera: "This person was added a short time ago. Wait a little and try again.",
    meterSemAparelho:
      "The person is in the channel. One of their devices joins when it connects.",
    escolherCanal: "Invite to which channel?",
  },

  rooms: {
    dropBefore: (nome: string): string => `Drop here to put it before ${nome}`,
    dropInCategory: (nome: string): string => `Drop here to put it at the end of ${nome}`,
    dragCategory: (nome: string): string => `Drag ${nome}, with its rooms`,
    dropCategoryBefore: (nome: string): string => `Drop here to put it before ${nome}`,
    dropCategoryAfter: (nome: string): string => `Drop here to put it after ${nome}`,
    categoryOrderPartial: (nomes: string): string => `The order did not change in ${nomes}. Drag again.`,
    closedTitle: "Closed",
    reopen: "reopen",
    reopenTitle: (nome: string): string => `Show ${nome} again`,
    reopened: (nome: string): string => `${nome} is back in the list.`,
    remove: "delete",
    removeTitle: (nome: string): string => `Delete ${nome}`,
    removeRoomTitle: (nome: string): string => `Delete "${nome}"?`,
    removeConfirm:
      "The room disappears for everybody. You cannot undo this. Its messages move to the default room.",
    removeAction: "Delete room",
    removeVoiceNote: "The people in the call of that room leave the call.",
    removed: (nome: string): string => `"${nome}" deleted. What was said there is read in the default room.`,
    closed: (nome: string): string => `You closed "${nome}". Nothing was deleted.`,
    closedDefault:
      "You closed the default room. Messages with no room still go there. Nothing was deleted.",
    showAgain: "Show again",
    mergeCategoryTitle: "Join the two categories?",
    mergeCategoryConfirm: (nome: string, quantos: number): string =>
      `There is already a category called "${nome}". ${quantos === 1 ? "The room moves" : `The ${quantos} rooms move`} there, and the two become one.`,
    mergeCategoryAction: "Join",
    categoryRenamed: (de: string, para: string): string => `"${de}" is now called "${para}".`,
    categoryDeleted: (nome: string, quantos: number): string =>
      quantos === 0
        ? `Category "${nome}" deleted.`
        : `Category "${nome}" deleted. ${quantos === 1 ? "The room stays in the list." : `The ${quantos} rooms stay in the list.`}`,
    categoryUndo: "Undo",
    categoryRestored: (nome: string): string => `The category "${nome}" is back, with its rooms.`,
    categoryRestoredEmpty: (nome: string): string => `The category "${nome}" is back.`,
    // O inglês não concorda o verbo com o número; o parâmetro fica pela assinatura.
    categoryPartial: (nomes: string, _quantos: number): string =>
      `${nomes} did not change category. Check the connection and try again.`,
  },

  voiceMove: {
    group: "Move to another room",
    menu: "Move to",
    noCategory: "No category",
    back: "Back",
    disconnect: "Disconnect from the call",
    disconnected: (nome: string): string => `You disconnected ${nome} from the call.`,
    disconnectedYou: (quem: string): string => `${quem} disconnected you from the call.`,
    personTitle: (nome: string): string => `Drag ${nome} to another voice room, or click to choose`,
    personMenuTitle: (nome: string): string => `${nome}'s options`,
    dropTitle: (sala: string): string => `Drop here to move them to ${sala}`,
    to: (sala: string): string => `Move to ${sala}`,
    sent: (nome: string, sala: string): string => `You moved ${nome} to ${sala}.`,
    moved: (quem: string, sala: string): string => `${quem} moved you to ${sala}.`,
  },

  emoji: {
    open: "Emoji",
    title: "Emoji",
    searchLabel: "Search emoji by name",
    searchPlaceholder: "Search…",
    recents: "Recent",
    results: "Results",
    noResults: "No emoji with that name.",
    close: "Close",
    categorias: {
      rostos: "Faces",
      gestos: "Gestures and people",
      natureza: "Nature",
      comida: "Food and drink",
      actividades: "Activities",
      viagens: "Travel and places",
      objectos: "Objects",
      simbolos: "Symbols",
      bandeiras: "Flags",
    },
  },

  personProfile: {
    openHint: (name: string): string => `See ${name}'s profile`,
    title: (name: string): string => `${name}'s profile`,
    postsListLabel: (name: string): string => `${name}'s posts`,
    back: "Back to the profile",
    message: "Message",
    unknown:
      "We do not have the name or picture of this person yet. They appear when this person shares them in a channel you are both in.",
    emptyTitle: "Nothing to read from this person.",
    emptyBody:
      "No post from this person has arrived yet. Select \"Ask for the posts\" to request them.",
    askPosts: "Ask for the posts",
    askPostsHint: (name: string): string =>
      `Asks ${name} for their last 30 posts. It works only if ${name} is online. It can take a minute. Older posts do not come back.`,
    askPostsSent: (name: string): string => `Request sent to ${name}. The posts appear when they arrive.`,
    friendsTab: "Friends",
    friendsListLabel: (name: string): string => `Friends of ${name}`,
    backFromPage: "Back",
    tabsLabel: (name: string): string => `Sections of ${name}'s profile`,
    postsTab: "Posts",
    sharedTab: "In common",
    friendsHidden: (name: string): string => `${name} does not show the friends list.`,
    friendsOnlyFriends: (name: string): string => `The friends list of ${name} appears only to the friends of ${name}.`,
    friendsEmpty: (name: string): string => `The friends list of ${name} is empty.`,
    sharedListLabel: (name: string): string => `Channels in common with ${name}`,
    sharedLoading: "Looking for the channels in common.",
    sharedEmpty: "There are no channels in common.",
    deafNote: (name: string): string => `This device cannot read the posts of ${name}.`,
  },

  votacao: {
    criar: "Create poll",
    titulo: "New poll",
    perguntaLabel: "Question",
    perguntaPlaceholder: "What do you want to ask?",
    opcaoLabel: (numero: number): string => `Option ${numero}`,
    opcaoPlaceholder: "Answer",
    acrescentar: "Add option",
    retirarOpcao: (numero: number): string => `Remove option ${numero}`,
    opcoesCheias: (maximo: number): string => `No more than ${maximo} options fit.`,
    confirmar: "Create",
    nota: "All people here can see the votes. The poll stays open, with no deadline.",
    votosVisiveis: "the votes are visible",
    votosVisiveisAjuda:
      "All members of the channel can see the vote of each person.",
    total: (quantos: number): string => (quantos === 1 ? "1 vote" : `${quantos} votes`),
    semVotos: "Nobody has voted yet.",
    votarEm: (opcao: string): string => `Vote for ${opcao}`,
    retirarVoto: (opcao: string): string => `Take back the vote for ${opcao}`,
    /*
      Montada com um ciclo e sem `join`, como a portuguesa: a fronteira de
      marca percorre TODAS as funções do catálogo e chama-as com uma cadeia de
      amostra. Uma que só saiba trabalhar sobre um array rebenta essa auditoria.
    */
    quemVotou: (nomes: string[], restantes = 0): string => {
      let lista = ""
      for (let indice = 0; indice < nomes.length; indice += 1) {
        const nome = nomes[indice] ?? ""
        if (indice === 0) lista = nome
        else if (indice === nomes.length - 1 && restantes === 0) lista = `${lista} and ${nome}`
        else lista = `${lista}, ${nome}`
      }
      return restantes > 0 ? `${lista} and ${restantes} more` : lista
    },
    votoFalhou: "could not record the vote",
    linhaDeOpcao: (numero: number, texto: string): string => `${numero}. ${texto}`,
  },

  comoFunciona: {
    titulo: "How Orwell works",
    link: "How it works",
    lead: "Six ideas about what happens inside Orwell. Each one has a drawing.",
    cartaoLead: "Six short ideas, each with a drawing. They show what the server knows about you, what stays only on your device, and why Orwell works this way.",
    ver: "See how it works",
    lerMais: "Read more",
    lerMenos: "Read less",
    umaContaChega: "One account is enough for all your devices.",
    carteiro: {
      titulo: "The server is a postman who cannot read",
      resumo: "Your message leaves the device closed in an envelope. The server reads only the channel address and delivers the envelope.",
      mais: [
        "In other chat apps, the message reaches the server open. The company keeps the text, who wrote it, to whom and when.",
        "The Orwell server keeps a closed copy for people who were offline. The key that opens the envelope exists only on the devices of the people in the conversation.",
        "This is called end-to-end encryption. One end is your device. The other end is the device of the person who reads. Everything in the middle sees only envelopes.",
      ],
      desenho: "In another app, the server opens the message and keeps the text. In Orwell, the server sees only a closed envelope and the channel address.",
      outraApp: "Another app",
      orwell: "Orwell",
      ana: "Ana",
      rui: "Rui",
      ola: "\"hello\"",
      servidor: "server",
      leEGuarda: "reads and keeps \"hello\"",
      soAMorada: "sees only the channel address",
      nota: ["The key that opens the", "envelope exists only on", "the devices of Ana and Rui."],
    },
    chave: {
      titulo: "The account is a key, not an email with a password",
      resumo: "When you create the account, your device makes a key. Your address is a summary of that key, and the server knows only the summary.",
      mais: [
        "The key lives in the vault on the device. The password opens the vault and never leaves the device.",
        "There is no \"forgot my password\". Nobody has the password but you. If you lose it, the vault stays closed forever.",
        "The export file is the account. A person with the file and the password has the account. Keep it as you keep a passport.",
        "The server does not know you. It has no name, email, phone or photo. Your name and photo travel inside the envelopes, only to your friends.",
      ],
      desenho: "The key makes the address. The key and the messages stay in the vault on the device. The password opens the vault. The server knows only the address.",
      oTeuAparelho: "your device",
      cofre: "vault",
      chaveDaConta: "account key",
      chavesDosCanais: "channel keys",
      mensagensLidas: "messages you read",
      palavraPasse: "password",
      abre: "opens",
      resumoDaChave: "summary of the key",
      endereco: "@duarte:orwell.pt",
      soIsto: "server: only this",
      semVolta: ["you cannot", "go back"],
    },
    cofre: {
      titulo: "The vault is the only place where the history exists",
      resumo: "Your device opens each message and keeps it in the vault, which is encrypted. The server keeps the closed envelope for a few days, and then deletes it.",
      mais: [
        "The channel keys change with each message, like a ratchet that turns only forward. When the device opens a message, it uses up the key for that position.",
        "So you cannot ask the server again for a message that you already read. If the vault is lost, the messages are lost.",
        "This is called forward secrecy. If somebody steals today's keys, they cannot read what was said yesterday.",
        "Search runs on your device, inside the vault. \"Close conversation\" hides the conversation. It does not delete it.",
      ],
      desenho: "The vault on the device keeps the messages you read. The server keeps only closed envelopes, for a few days. The channel key changes with each message and does not go back.",
      oTeuAparelho: "your device",
      cofre: "vault",
      mensagensEmClaro: "messages you read",
      cifrado: "closed by the password",
      servidor: "server",
      envelopes: "closed envelopes",
      unsDias: "only a few days",
      catraca: "the key changes with each message and turns only forward",
    },
    canal: {
      titulo: "A channel is a group with a key that changes",
      resumo: "The members of a channel share a key. Each time somebody joins or leaves, the key changes, and each change is called an epoch.",
      mais: [
        "A person who joins a channel does not see the old conversation. The invite gives a place in an epoch, and there is no key for the earlier ones. The wall and the tickets arrive, because other members send them again.",
        "Removing a person is done by the encryption. The key changes, and the removed person no longer has it. Neither the server nor a changed app can go around this.",
        "Deleting the channel does not delete the messages. Each person has their own messages in their own vault.",
        "The group protocol is MLS (RFC 9420). The encryption is hybrid post-quantum: to break a message, you must break both halves.",
      ],
      desenho: "A line of epochs in a channel. Rui joins at epoch 3 and reads from there. He does not read epochs 1 and 2. When Ana leaves, the epoch changes to 5 and Ana stops reading.",
      tempo: "time",
      cadaCirculo: "each circle is an epoch: a new key for the group",
      ruiEntra: "Rui joins: this is his place",
      anaSai: "Ana leaves",
      ruiLe: "Rui reads from here on",
      ruiNaoLe: "Rui does not read this: it was before his place",
      anaLeu: "Ana read up to here, and she keeps what she had",
      anaNaoLe: "Ana does not read this",
    },
    aparelhos: {
      titulo: "One account, many devices",
      resumo: "Each device has its own key, and the account key signs it.",
      mais: [
        "The main device has the account key. Only the main device exports the account, adds devices and revokes devices.",
        "To add a device, pair it. The secret goes from a screen to a camera, by QR or link, and never through the server. The two screens show six words. If they are the same, nobody got in the middle.",
        "Importing the file on another machine does not add a device. It moves the account. To have two devices, pair them. Do not create another account.",
        "Revoking a device stops it from reading from the next epoch. The device keeps what it already had.",
      ],
      desenho: "The account key, on the main device, signs the keys of the other devices. Pairing goes through the server in a temporary vault that the server does not open. The two devices compare six words.",
      principal: "main device",
      chaveDaConta: "account key",
      chaveDoAparelho1: "key of device 1",
      soEste: "only this one exports, adds and revokes",
      novo: "new device",
      chaveDoAparelho2: "key of device 2",
      assinada: "signed by the account",
      semChaveDaConta: "without the account key",
      servidor: "server",
      cofreTemporario: "temporary vault, closed",
      segredo: "the secret goes by QR or link, from screen to camera, never through the server",
      seisPalavras: "the two screens show six words: if they are the same, nobody got in the middle",
    },
    servidor: {
      titulo: "What the server sees",
      resumo: "The server sees closed envelopes, channel addresses and addresses without names. It does not see the text, who wrote it, or the voice.",
      mais: [
        "It knows: one address for each account, which channels each account is in, and how many devices each account has. It sees envelopes with the size rounded to blocks of 512 bytes, and it knows that somebody wrote in a channel, to the minute.",
        "It does not know: the text of the messages, who wrote each message, names, photos, reactions, mentions, attachments, voice and video. It has no password, and no summary of a password.",
        "The known weakness: in a private conversation, the two addresses are part of the channel address. A person with the server database sees who talks to whom, by addresses without names. They do not see what they say. This is the next thing to fix in the protocol.",
      ],
      desenho: "Two columns. What the server knows: addresses, channels, envelopes of the same size, the time. What it does not know: the text, who wrote it, names, voice and video, the password.",
      sabe: "Knows",
      naoSabe: "Does not know",
      listaSabe: ["one address for each account", "the channels of each account", "envelopes of the same size", "the time, to the minute"],
      listaNaoSabe: ["the text", "who wrote it", "names and photos", "voice and video", "the password"],
    },
  },

  frasesDoMomento: {
    conta: "Your account is a key on this device. Nobody can reset it. Keep your password safe.",
    canal: "You see the conversation from now on. What was said before stays with the people who were there.",
    entendi: "Got it",
  },
  musica: {
    partilharAudio: "Share audio",
    partilharAudioAria: (aPartilhar: boolean): string =>
      aPartilhar ? "Sharing audio. Open the list." : "Share audio.",
    fechar: "Close",
    fontes: "Where the sound comes from",
    fonte: (fonte: string): string => {
      switch (fonte) {
        case "separador":
          return "Browser tab"
        case "sistema":
          return "System sound"
        case "janela":
          return "One window or app"
        default:
          return "Files or a list"
      }
    },
    porqueNao: (codigo: string): string => {
      switch (codigo) {
        case "separador-sem-browser":
          return "This browser does not give the audio of a tab."
        case "sistema-so-na-app":
          return "Only in the desktop app, on Windows and macOS 14.2 or later."
        case "sistema-sem-browser":
          return "This browser does not give the system sound."
        case "sistema-linux":
          return "On Linux, the app does not get the system sound."
        case "janela-sem-browser":
          return "No browser gives the audio of one window. Only in the desktop app, on Windows and macOS."
        case "janela-linux":
          return "On Linux, the app does not get the audio of one window."
        default:
          return "Not in this version yet."
      }
    },
    escolherFicheiros: "Choose files",
    escolherPasta: "Choose a folder",
    formatos: ".mp3, .m4a, .ogg, .flac or .wav files.",
    nenhumAudio: "None of these files is audio. Choose .mp3, .m4a, .ogg, .flac or .wav files.",
    listaVazia: "The list is empty. Choose files to play.",
    lista: "List",
    tocar: "Play",
    pausar: "Pause",
    saltar: "Skip",
    baralhar: "Shuffle",
    parar: "Stop",
    pararAria: "Stop sharing audio",
    tocarEsta: (nome: string): string => `Play ${nome}`,
    remover: (nome: string): string => `Remove ${nome} from the list`,
    aTocar: (nome: string): string => `Playing: ${nome}`,
    emPausa: "Music paused",
    volumeLocal: "Volume for you",
    volumeDaMusica: (nome: string): string => `Volume of ${nome}'s music`,
    origem: (fonte: string): string => {
      switch (fonte) {
        case "separador":
          return "A browser tab"
        case "janela":
          return "A window"
        default:
          return "System sound"
      }
    },
    escolherFonte: "Choose and share",
    aPartilharFonte: (origem: string): string => `Sharing: ${origem}`,
    pararFonte: "Stop this sound",
    notaDaFonte: (fonte: string, secretaria: boolean): string => {
      if (fonte === "separador") {
        return secretaria
          ? "The app has no tabs. Choose the browser window. The sound of the whole system goes."
          : "Choose the tab in the browser picker. The audio box comes ticked. The others do not see the tab."
      }
      if (fonte === "janela") {
        return "Choose the window. The system does not split the sound of one window: the sound of the whole system goes. The others do not see the window."
      }
      return secretaria
        ? "All that the computer plays goes. The others do not see the screen."
        : "Choose the entire screen and tick the box “Also share system audio”. The others do not see the screen."
    },
    ecoNaApp: "In the app, this sound can carry the voice of the call. The others can hear themselves late. To stop this, turn off the call sound.",
  },
  definicoesNovas: {
    sessao: "Session",
    bloquearSozinho: "Session expiry",
    bloquearSozinhoNota: "If you do not use Orwell for this time, the session ends on this device. To come back, sign in with your password. During a call, the session does not end.",
    tempoDeBloqueio: (minutos: number): string => (minutos === 0 ? "Never" : minutos < 60 ? `${minutos} min` : `${minutos / 60} h`),
    pausar: "Pause",
    pausarNota: "Silences everything except calls, for a time.",
    duracaoDaPausa: (duracao: "1h" | "8h" | "amanha"): string =>
      duracao === "1h" ? "1 h" : duracao === "8h" ? "8 h" : "Until tomorrow",
    emPausaAte: (hora: string, amanha: boolean): string =>
      amanha ? `Paused until tomorrow at ${hora}. Only calls ring.` : `Paused until ${hora}. Only calls ring.`,
    retomar: "Resume",
    entrarSilenciado: "Join calls with the microphone muted",
    camaraAparelho: "Device",
    camaraDoSistema: "System default",
    camarasNenhuma: "This device has no camera connected.",
    camarasSemNome: "The camera names show after you open the camera once. Use \"Preview the camera\".",
    espelhar: "Mirror my image",
    espelharNota: "Only for you. The others see you normally.",
    previa: "Preview the camera",
    previaFechar: "Close the preview",
    previaFalhou: "The camera did not open. Check the system permissions.",
    previaEmChamada: "You are in a call. The preview opens when the call ends.",
    quemMeEncontra: "Who can find me",
    pedidosDeAmizade: "Who can send me friend requests",
    regraDosPedidos: (regra: "todos" | "amigos-de-amigos" | "ninguem"): string =>
      regra === "todos" ? "Everyone" : regra === "amigos-de-amigos" ? "Friends of friends" : "Nobody",
    pedidosNota:
      "A request from somebody outside the rule does not show and does not ring. Friends of friends are people who share a channel or a friend with you.",
    mostrarOnline: "Show when I am online",
    mostrarOnlineNota: "Off, you always show as \"Invisible\" to the others.",
    enviarRegisto: "Send log",
    aEnviarRegisto: "Sending…",
    registoEnviado: "log sent, thank you",
    enviarRegistoNota: "\"Send\" sends the log to the server, with your address and the version. No messages. The server keeps it 30 days.",
  },
  aneis: {
    away: "away",
  },
  overlayDeJogo: {
    titulo: "Game overlay",
    ligar: "Show the game overlay",
    nota: "During a call, the overlay shows the voice room and who talks, on top of the game. It shows only when the Orwell window is not in front. Drag it to another place. Double-click it to put it back in the centre.",
    ecraInteiro:
      "It shows on top of games in a window and in full screen. Some old games in exclusive full screen do not show it: for those, choose \"borderless window\".",
    opacidade: "Background opacity",
    repor: "Put it back at the top centre",
    atalhoNota: "To show or hide the overlay during a call, use the shortcut in \"Keyboard shortcuts\".",
    entrou: "joined the room",
    saiu: "left the room",
  },
  copiarId: {
    de: (nome: string): string => `Copy the id of ${nome}`,
    proprio: "Copy your id",
    copiado: "id copied",
  },
  silencio: {
    silenciar: "Mute notifications",
    ativar: "Unmute notifications",
    marca: "Notifications muted",
  },
  respostas: {
    responder: "Reply",
    aResponderA: "Replying to",
    mencionar: "@ Mention",
    mencionarLigado: "The author gets a mention. Tap to turn off.",
    mencionarDesligado: "The author does not get a mention. Tap to turn on.",
    cancelar: "Cancel the reply",
    anuncio: (nome: string) => `Replying to ${nome}. Esc cancels.`,
    irPara: (nome: string) => `Go to the message from ${nome}`,
    imagem: "Image",
    vazia: "Message without text",
    apagada: "The original message was deleted.",
    ausente: "The original message is not on this device.",
    porCarregar: "Load the original message",
  },
  transmissao: {
    ecra: "Sharing the screen",
    musica: "Playing music",
    ambos: "Sharing screen and music",
    musicaDe: (nome: string): string => `${nome} is playing music`,
  },
  outraConta: {
    lead: "Importing or pairing puts the other account in place of this one. First you choose the other account. The app erases the account on this device only after you confirm.",
    pairKeyNote: "When you select Continue, the app asks you to confirm that it erases the account on this device. The app erases it only when the other account is in.",
  },
  contas: {
    mudar: "Switch account",
    titulo: "Switch account",
    lead: "Each account has its own vault on this device. The account you leave stays here, closed.",
    semNome: "Account with no name",
    abreSozinha: "Opens without asking for the password.",
    pedeFrase: "Asks for the password.",
    acrescentar: "Add another account",
    acrescentarNota: "You create, import or pair another account. This account stays on this device.",
    voltar: "Go back to an account on this device",
    nenhumaOutra: "There is no other account on this device yet.",
  },
  juntar: {
    entrada: "Join another account",
    entradaNota: "Do you have two accounts? Join this one to your main account. This account leaves this device.",
    titulo: "Join another account",
    lead: "This device becomes a device of your main account. This account is erased.",
    passa: "What moves: your friends and your channels get a notice. With one tap, they add or invite the main account.",
    naoPassa: "What does not move: no history, no profile, no preferences.",
    assinado: "This account signs the notice. The people who get it decide.",
    passos: "Three steps: pair with the main account, tell the contacts and channels, erase this account.",
    comecar: "Start",
    avisando: "The app tells your contacts and your channels.",
    apagando: "The app erases this account from this device.",
    feitoTitulo: "Accounts joined",
    feito: (principal: string): string => `This device now belongs to ${principal}. This account was erased.`,
    feitoNota: "Your contacts see the notice when they open the app.",
    continuar: "Continue",
    voltarAoInicio: "Back to the start",
  },
  barra: {
    lista: "Commands",
    descricao: {
      me: "Write an action in the third person. It shows in italics.",
      away: "Set your personal message. With no text, it clears it.",
      estado: "Set your personal message. With no text, it clears it.",
      nick: "Change your name. It comes in the next version.",
      topic: "Change the channel topic. It comes in the next version.",
      kick: "Remove a person from the channel. It comes in the next version.",
    },
    meVazio: "Write what you do after /me.",
    estadoPosto: "Your personal message changed.",
    estadoApagado: "Your personal message was cleared.",
    estadoLongo: (max: number): string => `The personal message has a maximum of ${max} characters.`,
    estadoIndisponivel: "You cannot change the personal message here. Change it on the account card.",
    naProximaVersao: (comando: string): string => `${comando} comes in the next version. The message was not sent.`,
  },
  saiuDeBeta: {
    titulo: "Orwell is out of beta.",
    texto:
      "Thank you for testing Orwell. We changed how conversations are stored, so the server knows even less. Beta accounts do not move to the new version. We are sorry: you must create a new account.",
    criarContaNova: "Create a new account",
  },

  salaAfk: {
    marca: "AFK",
    marcaTitulo: "AFK room: no voice and no text.",
    semVozNemTexto: "The AFK room has no voice and no text.",
    movido: (minutos: number): string => `You were muted for ${minutos} minutes. You moved to the AFK room.`,
    voltar: "Go back",
    voltarPara: (sala: string): string => `Go back to ${sala}`,
    fechar: "Close the notice",
    seccaoTitulo: "AFK room",
    seccaoLead:
      "People in a voice room with the microphone muted go to the AFK room by themselves. There is no voice and no text there.",
    salaLabel: "AFK room",
    nenhuma: "None",
    tempoLabel: "Time muted",
    minutos: (minutos: number): string => `${minutos} minutes`,
    guardar: "Save",
    guardado: "AFK room saved.",
    semSalasDeVoz: "This channel has no voice rooms. Make a voice room first.",
  },

  denunciar: {
    menu: "Report…",
    tituloPessoa: (nome: string): string => `Report ${nome}`,
    tituloMensagem: (nome: string): string => `Report the message from ${nome}`,
    motivoLegenda: "Why do you report?",
    motivos: { ...MOTIVOS_DA_DENUNCIA, 8: "Other (note required)" },
    nota: "Note",
    notaObrigatoria: "Note (required)",
    notaDica: "Say what happened, in a few words.",
    boaFe: "I confirm that I believe, in good faith, that this report is accurate and complete.",
    contactoLegenda: "Contact",
    nome: "Name",
    email: "Email",
    contactoNota: "Optional. Only we read the name and the email.",
    previsualizacaoTitulo: "What leaves the device",
    previsualizacaoNota: "Only this leaves the device. An edited message goes as the author first wrote it.",
    semMensagens: "No message goes. Only the address of the person goes.",
    resumoTitulo: "The report also carries",
    rotulos: {
      pessoa: "Reported person",
      canal: "Channel",
      sala: "Room",
      motivo: "Reason",
      nota: "Note",
      boaFe: "Good faith",
      contacto: "Contact",
      versao: "App version",
    },
    boaFeConfirmada: "confirmed.",
    mostrarEnderecos: "Show addresses",
    enderecosNota: "The addresses also go in the report.",
    passosRotulo: "Report steps",
    passos: { motivo: "Reason", rever: "Review", enviar: "Send" },
    passoFeito: "done",
    denunciadaPilula: "Reported",
    avisoTitulo: "Before you send",
    aPreparar: "Preparing the report…",
    aviso: "The founder of the channel gets a copy without your name. In a small conversation, they can guess who you are.",
    continuar: "Continue",
    voltar: "Back",
    enviar: "Send report",
    aEnviar: "Sending…",
    enviada: "Report sent.",
  },

  contaSuspensa: {
    titulo: "Account suspended",
    medida: "Measure: suspension of the account.",
    motivo: (motivo: string): string => `Reason: ${motivo}`,
    motivos: { ...MOTIVOS_DA_DENUNCIA, 8: "Other" },
    duracao: (desde: string, ate: string): string => `From ${desde} to ${ate}.`,
    ateARevisao: (desde: string): string => `From ${desde}, until the review.`,
    ambito: (texto: string): string => `Scope: ${texto}`,
    factos: (texto: string): string => `Facts: ${texto}`,
    origem: {
      denuncia: "It came from a report.",
      autoridade: "It came from an authority.",
      operador: "Decision of the operator.",
    },
    semMeiosAutomaticos: "No automated means were used: a person read and decided.",
    norma: (texto: string): string => `Rule or clause: ${texto}`,
    viasTitulo: "What you can do",
    notaRevisao: "Note for the review",
    notaDica: "Say why you think the decision is wrong.",
    pedirRevisao: "Ask for a review",
    aEnviar: "Sending…",
    revisaoEnviada: "Review request sent.",
    revisaoPedida: (quando: string): string => `You asked for a review on ${quando}.`,
    decisao: {
      mantida: "Review: the suspension was kept.",
      levantada: "Review: the suspension was lifted.",
    },
    notaDaDecisao: (nota: string): string => `Review note: ${nota}`,
    tribunais: "You can go to the courts.",
    anacom: "You can complain to ANACOM, the Digital Services Coordinator in Portugal.",
    semAviso: "We could not read the notice. Try again later.",
    tentarOutraVez: "Try again",
  },
}

/**
 * The core's own error strings, said as sentences.
 *
 * The source is already English, so an entry missing here degrades to the raw
 * message and stays readable. That is the one map whose fallback is NOT the
 * Portuguese base, and `strings.ts` says why.
 */
export const errosEn: Record<string, FraseDeErro> = {
  "vault is locked": "The vault is locked.",
  "no vault to open": "There is no vault on this device.",
  "vault holds no identity": "The vault holds no identity.",
  "wrong passphrase, or the vault is damaged": "Wrong password. If you are sure of it, the data on this device may be damaged.",
  "this vault was written by a newer version of the app":
    "This vault was written by a newer version of the app. Update the app before you open it. Opening the vault with this version would erase what it cannot read.",
  "this vault is from the beta": "This vault is from a beta version. It does not open in this version.",
  "this account file is from the beta": "This file is from a beta version. It cannot go into this version.",
  "clipboard unavailable": "Could not copy. Select the text and copy it with the keyboard.",
  "clipboard text is invalid": "Could not copy this text.",
  "this device cannot remember the session": "This device has nowhere safe to keep the session.",
  "this vault has no passphrase to remember": "This account has no password on this device. There is no session to remember.",
  "this vault already has a passphrase": "This account already has a password on this device.",
  "there is no such account on this device": "This account is no longer on this device.",
  "could not reach the homeserver": "Could not reach the server.",
  "the server did not take the log": "The server did not take the log. Copy it and paste it in the report.",
  "too many logs sent": "You already sent 10 logs in this hour. Try again later, or copy the log.",
  "the server did not take the report": "The server did not take the report. Try again later.",
  "too many reports sent": "You sent too many reports. Try again later.",
  "the device clock is off": "The clock of this device is wrong. Set the time and try again.",
  "could not read the report inbox": "The server sent an answer we cannot read. Try again later.",
  "account-suspended": "Your account is suspended on this server. Read the reason and ask for a review.",
  "the server did not take the review request": "The server did not take the review request. Try again later.",
  "the report needs a note": "Write a note. The reason \"Other\" needs one.",
  "the report needs the good-faith confirmation": "Confirm that the report is in good faith.",
  "the founder copy could not be sealed": "We could not encrypt the copy for the founder of the channel. The report went without it.",
  "vault storage is full":
    "The storage of this device is full. Delete old images or conversations. Until then, nothing new is stored here.",
  "this is not an enclave account file": "This file is not an Orwell account.",
  "an export passphrase is required": "Choose a password for the exported file.",
  "this platform cannot protect a vault without a passphrase":
    "This device needs a password to protect the vault.",
  "this device cannot shrink images": "This device cannot shrink images. Choose a smaller one.",
  "this is not an image this device can read": "This is not an image this device can read.",
  "this image is too large even after compression": "That image is too large, even after compression. Choose another one.",
  "could not compress this image": "Could not compress that image.",

  /* Vault and account. */
  "this vault needs the system keychain": "This vault needs the system keychain. This device does not have it.",
  "the vault file is damaged": "The vault file is damaged. Import the account again.",
  "this account is no longer valid on this server": "This account is no longer valid on this server. Create a new account.",
  "this vault already holds an account": "This vault already has an account. Only a device without an account can join one.",
  "local storage failed": "Could not open the storage of this device. Reload the page.",
  "this tab no longer writes": "This tab no longer connects to the server. Use the other tab, or reload this one.",
  "this tab no longer writes to the vault": "This tab no longer saves anything. Another tab uses the account now. Reload this one.",
  "could not leave every channel, account kept": (detalhe) => {
    const canais = detalhe["canais"]
    const quantos =
      typeof canais !== "number" || canais < 1 ? "every channel" : canais === 1 ? "1 channel" : `${canais} channels`
    return `Could not leave ${quantos}. The account was not deleted. Check the connection and try again.`
  },

  /* Server and connection. */
  "no connection to the server": "No connection to the server. The app tries to connect again.",
  "the server refused the login": "The server did not accept the login. Try again.",
  "the server did not answer in time": "The server did not answer in time. Try again.",
  "the server did not confirm the send": "The server did not confirm the send. Check the connection and try again.",
  "the connection dropped": "The connection dropped.",
  "the session ended": "The session ended. Open the app again.",
  "unexpected answer from the server": "The server gave an unexpected answer. Try again.",

  /* Channels, invites and members. */
  "not a member of this channel": "You are not a member of this channel.",
  "you may not invite in this channel": "Your role does not let you invite people to this channel.",
  "that person is already in this channel": "That person is already in this channel.",
  "that person has no invite keys": "That person has no invite keys. Ask them to open the app, then try again.",
  "no invite key verifies": "Could not add that person. No invite key is valid.",
  "that person's invite key expired": "The invite of that person expired. Ask them to open the app, then try again.",
  "could not add that person to this channel": "Could not add that person to this channel.",
  "a direct conversation has no administration":
    "A conversation between two people has no administration. The two people are equal.",
  "only an administrator may manage roles": "Only an administrator of this channel can create, delete or give roles.",
  "the role needs an id and a name": "The role needs an identifier and a name.",
  "the admin role is built in": "The administrator role comes with the channel. You cannot delete it.",
  "the founder cannot lose the role": "The founder of the channel cannot lose the role.",
  "that role does not exist in this channel": (detalhe) => {
    const papel = detalhe["role"]
    return typeof papel === "string" && papel !== ""
      ? `The role "${papel}" does not exist in this channel.`
      : "That role does not exist in this channel."
  },
  "to leave, forget the channel": 'You cannot expel yourself. To leave, use "Leave the channel".',
  "you may not expel in this channel": "Your role does not let you expel people from this channel.",
  "this channel has no recorded founder":
    "This channel has no founder recorded here yet. You cannot undo an expulsion.",
  "the founder cannot be expelled": "You cannot expel the founder of the channel.",
  "that person is not in this channel": "That person is not in this channel.",
  "to change room, join it": "To change room, join it.",
  "to leave the call, leave it": 'To leave the call, use "Leave the call".',
  "the everyone role is built in": 'The "Everyone" role comes with the channel. You cannot delete it or give it to a person.',
  "you may not change the permissions of this room": "You cannot change the permissions of this place.",
  "you may not move people in this channel": "Your role does not let you move people in this channel.",
  "you already administer this channel": "You already administer this channel.",
  "this channel already has an administrator": "This channel already has an administrator.",
  "only an administrator may edit this channel":
    "Only an administrator of this channel can change its properties and rooms.",
  "the channel needs a name": "The channel needs a name.",
  "the category needs a name": "The category needs a name.",
  "the room needs a name": "The room needs a name.",
  "the default room cannot be deleted": "You cannot delete the default room. It gets the messages without a room.",
  "that room id is reserved": "That identifier is reserved. It cannot be a room.",
  "you may not pin in this channel": "Your role does not let you pin messages in this channel.",
  "the room has the maximum of pinned messages": (detalhe) => {
    const maximo = detalhe["max"]
    return typeof maximo === "number"
      ? `This room already has ${maximo} pinned messages, the maximum. Unpin one first.`
      : "This room already has the maximum of pinned messages. Unpin one first."
  },
  "this room was never published": "Nobody has published this room yet. You cannot pin here.",
  "the ticket needs a subject": "The ticket needs a subject.",
  "only an attendant or the author may change the ticket":
    "Only the people who attend tickets in this channel, or the author of this ticket, can change its state.",
  "you may not attend tickets in this channel": "Your role does not let you attend tickets in this channel.",
  "the reply needs text": "The reply needs text.",
  "a feed channel cannot be deleted": "You cannot delete the channel of a feed. The posts live in it.",
  "a direct conversation cannot be deleted": "You cannot delete a conversation between two people. You leave it.",
  "the common room belongs to the server": "The common room belongs to this server. The server decides if it exists.",
  "you may not delete this channel": "Your role does not let you delete this channel.",
  "only the author or a moderator may delete this message":
    "Only the author of the message, or a moderator of the channel, can delete it.",
  "only a closed ticket can be deleted": "You can delete only a closed ticket. Close it first.",
  "you may not moderate in this channel": "Your role does not let you moderate this channel.",
  "the nickname is too long": (detalhe) => {
    const maximo = detalhe["max"]
    return typeof maximo === "number" ? `The nickname has more than ${maximo} characters.` : "The nickname is too long."
  },
  "a nickname belongs to a channel": "A nickname belongs to a channel. A conversation between two people and a feed have no nicknames.",
  "that is not a valid invite link": "That link is not valid.",
  "that invite is from another server": "That invite is from another server.",
  "could not prepare the entry": "Could not prepare the entry. Try again.",
  "that invite no longer exists": "That invite no longer exists.",
  "that invite expired": "That invite expired. Ask the other person to invite you again.",
  "this device has no seat in this channel": "The server refused. This device has no seat in this channel.",

  /* Calls and media. */
  "the call could not be set up on this server":
    "The call could not start on this server. Try again. If it happens again, copy the diagnostic in Settings.",
  "the call has no send path": "The call has no path to send. Join the call again.",
  "the call dropped and did not come back": "The call dropped and did not come back. Join again.",

  /* Notices from the core that are not errors, told by the same table (I9). */
  "you are no longer a member of this channel": "You are not a member of this channel now.",
  "an invitation to this channel can no longer be opened, a new seat was requested":
    "This invitation does not open now. We asked for a new seat.",

  /* Files and images. */
  "too large to send": "This is too large to send. Use a smaller image.",
  "unreadable image": "Could not read that image. Choose another one.",

  /* Friends, feed and profile. */
  "a friend request is already pending": "You already sent a request to this person. Wait for the answer.",
  "that person is blocked": "You blocked this person. Unblock them first.",
  "this device cannot start a new conversation":
    "This device cannot start a new conversation. Start it on the device where you created the account. Then the conversation also shows here.",
  "the other account is not known to the server": "The server does not know this account. Check the address and try again.",
  "this device has not received this conversation yet":
    "This conversation has not reached this device yet. Connect the device where you created the account and try again.",
  "this conversation is waiting for the other person":
    "This conversation needs the other person. When they open the app, the conversation opens again.",
  "this device does not know the account feed yet":
    "This device does not know the account feed yet. Connect the device where you created the account and try again.",
  "there is no friend request to cancel": "You have no request to cancel.",
  "you cannot block yourself": "You cannot block yourself.",
  "that is not an account address": "This is not an account address.",
  "too many friends to show": "The list has more than 500 people. Choose fewer.",
  "your feed has people who are not friends": "Your feed has people who are not friends. Try again with a connection.",

  /* Devices and pairing. */
  "this device has no account key": "This device is not the main device. Add devices on the main device.",
  "this server cannot pair devices": "This server cannot pair devices yet.",
  "this version of the app cannot do that": "This version of the app cannot do that yet. Update the app.",
  "not a pairing link": "This is not a pairing link.",
  "a pairing with this code already exists": "There is already a pairing with this code. Generate another one.",
  "this code is no longer open": "This code is no longer open. Ask for a new one on the main device.",
  "another device already joined this code": "Another device already joined this code. Generate a new one on the main device.",
  "too many pairing attempts": "Too many attempts. Wait a minute.",
  "the other device disconnected": "The other device disconnected before the end.",
  "the pairing code expired": "The code expired. Generate a new one.",
  "a third device tried to join": "A third device tried to join with this code. Nothing was added. Generate a new code.",
  "the words were not the same": "The words were not the same on the two devices. Nothing was added.",
  "pairing cancelled": "Cancelled.",
  "the other device did not answer in time": "The other device did not answer in time.",
  "the certificate is not from this account": "The certificate that arrived is not from this account. Nothing was saved.",
  "the server refused the device list": "The server did not accept the device list. Nothing was added.",
  "this account already has four devices": "This account already has four devices.",

  /* Phase 5 (20/10/2026): the end of «Error 900». */

  /* Vault and account. */
  "this vault needs a passphrase": "This vault needs the passphrase. Type it to open the vault.",
  "no identity loaded": "The account is not open yet. Wait a moment and try again.",
  /* Join accounts (phase 8.2). */
  "there is no account to join": "This device has not paired with the other account yet. Start again with the link.",
  "could not leave every channel, nothing was deleted": (detalhe) => {
    const canais = detalhe["canais"]
    const quantos =
      typeof canais !== "number" || canais < 1 ? "every channel" : canais === 1 ? "1 channel" : `${canais} channels`
    return `Could not leave ${quantos}. This account was not deleted. Check the connection and try again.`
  },
  "the account could not be switched":
    "This device did not move to the other account. This account stays on the device. Open it with its passphrase.",
  "this account did not become another": "This account did not become another account.",
  "an account cannot be joined to itself": "This link is from the same account. An account cannot join itself.",
  "the other device stopped waiting, nothing was deleted":
    "The device of the main account stopped waiting. This account was not erased. Start again with the link.",

  /* Server and connection. */
  "the connection was replaced": "A new connection replaced this one. Try again.",
  "this address belongs to another key":
    "This address belongs to another key on this server. This account cannot sign in here.",
  "the key does not match the address": "The key does not match the account address. The server does not let it sign in.",
  "the server closed the connection": (detalhe) => {
    const codigo = detalhe["codigo"]
    const base = "The server closed the connection. The app tries to connect again."
    return typeof codigo === "string" && codigo !== "" ? `${base} Server code: ${codigo}.` : base
  },
  "the server refused a message that was too large":
    "The server refused a message that was too large. Send a smaller one.",

  /* Channels. */
  "unknown ticket state": "That ticket state does not exist.",
  "this channel was recreated": (detalhe) => {
    const nome = detalhe["nome"]
    const canal = typeof nome === "string" && nome !== "" ? `The channel "${nome}"` : "This channel"
    return `${canal} lost its state and was created again. Invite the people in it again.`
  },
  "this channel no longer exists here":
    "This channel no longer exists on the server, or this device lost its seat in it. What you write here reaches nobody. Leave the channel and ask for a new invite.",
  "some channels could not be read": (detalhe) => {
    const quantos = detalhe["quantos"]
    if (typeof quantos !== "number" || quantos < 1) {
      return "Could not read some channels on this device. These channels are not shown."
    }
    return quantos === 1
      ? "Could not read 1 channel on this device. That channel is not shown."
      : `Could not read ${quantos} channels on this device. These channels are not shown.`
  },
  "that invite reached its limit": "That invite reached its maximum number of uses. Ask for a new invite.",
  "this invite link is wrong": "This link is wrong. Ask the person who invited you for a new one.",
  "too many invite lookups": "Wait one minute and try again.",
  "too many invite requests": "Too many invite requests. Wait one minute and try again.",
  "the server does not open this channel address":
    "The server does not open a channel with this address. Use \"Create channel\".",
  "this server does not open short invite links":
    "This server does not open short links. Ask the person who invited you for the long link.",
  "this message cannot be reported": "You cannot report this message.",

  /* Browser errors. */
  "the browser or the system did not allow this":
    "The browser or the system did not give permission. Check the permissions and try again.",
  "no microphone or camera was found": "No microphone or camera is connected to this device.",
  "the microphone or the camera is busy": "Another app uses the microphone or the camera. Close it and try again.",
  "no microphone or camera fits": "No microphone or camera on this device fits these settings. Choose another one in Settings.",
  "the browser stopped the operation": "The browser stopped the operation. Try again.",
  "the browser was not ready": "The browser was not ready for this. Try again.",
  "the browser blocked this for safety": "The browser blocked this for safety. Check the permissions of this site.",
  "this browser cannot do that": "This browser cannot do that. Use another browser or the desktop app.",

  /* Calls. */
  "could not open the microphone": (detalhe) => `Could not open the microphone. ${whyItDidNotOpen(detalhe)}`,
  "could not open the camera or the microphone": (detalhe) =>
    `Could not open the camera or the microphone. ${whyItDidNotOpen(detalhe)}`,
  "call signalling failed": "Could not send a call signal. Check the connection.",
  "that person did not answer the call": "A person did not answer the call. Maybe that person left.",
  "the network blocks the call to that person":
    "Could not connect to a person in the call. The network on one side blocks the call.",
  "no relay server for the call": "No relay server. The call can fail for people on another network.",
  "you are not in a call": "You are not in a call. Join a call, then share the screen.",
  "this call server carries only voice":
    "The server of this call carries only voice. The image does not go through. Nothing was shared.",
  "the afk room has no voice and no text": "The AFK room has no voice and no text.",
  "only a voice room can be the afk room": "Only a voice room can be the AFK room.",
  "the call is too large to share a screen": (detalhe) => {
    const pessoas = detalhe["pessoas"]
    const tecto = detalhe["tecto"]
    const fim = "To share, the call must have fewer people."
    if (typeof pessoas !== "number" || typeof tecto !== "number") {
      return `The call has too many people to share the screen. ${fim}`
    }
    return detalhe["caminho"] === "directo"
      ? `There are ${pessoas} people in the call. The screen goes directly to each person. Above ${tecto} people, your connection is not enough and the call drops, sound included. ${fim}`
      : `There are ${pessoas} people in the call. The screen leaves the server once for each person. Above ${tecto} people, the server does not have the bandwidth. ${fim}`
  },
  "this device cannot share the screen from the app": "This device does not let the app share the screen.",
  "could not share the screen": "Could not share the screen. Check the system permissions.",
  "the system did not give the screen sound":
    "The system did not give the screen sound. The others see the screen, but they do not hear it. On macOS, open System Settings › Privacy & Security › Screen & System Audio Recording, turn on Orwell and open the app again.",
  "this system cannot share the screen sound":
    "This system does not let you share the screen sound. The others see the screen, but they do not hear it.",
  "the browser did not give the screen sound":
    "The browser did not give the screen sound. The others see the screen, but they do not hear it. To send the sound, share again: choose a tab, or tick the audio box in the browser picker.",
  "someone already shares a screen in this call":
    "This call already has 2 shared screens. That is the maximum. Wait until one share stops.",
  "the call has the maximum of cameras": "This call already has the maximum of cameras. Turn off a camera first.",
  "the call is full": "This call is full. The server cannot carry more people.",
  "the server is full of broadcasts": "The server is full of broadcasts. Try again in a moment.",
  "no media key for this person yet": (detalhe) => {
    const nome = detalhe["nome"]
    const quem = typeof nome === "string" && nome !== "" ? nome : "one person in this call"
    return `You cannot hear ${quem} yet: the call key is missing. The sound starts by itself when the key arrives.`
  },
  "the microphone keeps stopping": "Your microphone stopped several times. Leave the call and join again.",
  "the sound of this person is not here yet": (detalhe) => {
    const nome = detalhe["nome"]
    const quem = typeof nome === "string" && nome !== "" ? nome : "one person in this call"
    return `You cannot hear ${quem} yet. The app is asking for the sound again.`
  },
  "your media is not going out yet": (detalhe) => {
    const fonte = detalhe["fonte"]
    if (fonte === "camara") return "Your camera is not sending yet: preparing the encryption."
    if (fonte === "ecra") return "Your screen is not being shared yet: preparing the encryption."
    if (fonte === "ecra-som") return "Your screen sound is not sending yet: preparing the encryption."
    if (fonte === "musica") return "Your music is not sending yet: preparing the encryption."
    return "Your microphone is not sending yet: preparing the encryption."
  },
  "the call media could not be encrypted": (detalhe) => {
    const fonte = detalhe["fonte"]
    const base = "The call encryption was not ready. Nothing goes out without encryption."
    if (fonte === "camara") return `${base} The others do not see your camera.`
    if (fonte === "ecra") return `${base} Your screen was not shared.`
    if (fonte === "ecra-som") return `${base} The others see your screen, but do not hear the screen sound.`
    if (fonte === "musica") return `${base} Your music does not go out.`
    return `${base} You left the call. Join again.`
  },
  "this device is in too many calls": "This device is in too many calls. Leave a call first.",
  "too many call requests": "Too many call requests in this minute. Wait one minute.",
  "this server does not relay call media": "This server does not relay the sound and image of calls.",
  "join the call first": "Join the call first.",
  "the call server refused the request": "The call server refused the request. Try again.",
  "could not announce you in the call": "Could not tell the others that you joined. Leave the call and join again.",
  "the call media key failed": "The call key did not renew. Leave the call and join again.",
  "the call media failed": "The call connection failed. Leave the call and join again.",
  "audio-invalid-profile": "This voice profile does not exist. Pick a profile from the list.",
  "audio-invalid-stage": "This voice stage does not exist. Pick a stage from the list.",
  "audio-invalid-strength": "The suppression strength must be between 0 and 100 %.",
  "audio-preference-save-failed": "The choice applies on this device. Could not save it to the account.",
  "audio-preview-unavailable": "This browser cannot process the voice. Try another browser or the app.",
  "audio-preview-failed": "Could not open the microphone to hear yourself. Check the microphone permissions.",
  "audio-invalid-threshold": "The microphone line must be between -80 and 0 dB.",
  "audio-meter-denied": "The browser does not let Orwell use the microphone. Give the microphone permission to Orwell and open this screen again.",
  "audio-meter-failed": "The microphone did not open. Close the other apps that use it and open this screen again.",

  /* Files and pages. */
  "could not read the page": "Could not read the page.",

  /* Video in posts (508 to 514). */
  "the video is too large": (detalhe: DetalheDoErro): string =>
    typeof detalhe["max"] === "number"
      ? `The video is too large. The maximum is ${Math.round(detalhe["max"] / 1_048_576)} MB.`
      : "The video is too large.",
  "the video is too long": (detalhe: DetalheDoErro): string =>
    typeof detalhe["max"] === "number"
      ? `The video is too long. The maximum is ${detalhe["max"]} seconds.`
      : "The video is too long.",
  "this video format is not accepted": "This video format is not accepted. Use MP4, WebM or MOV.",
  "the video upload was cancelled": "You cancelled the video upload. The post was deleted.",
  "could not read this video": "This device cannot read that video. Choose another one.",
  "a video upload is already in progress": "A video is already uploading. Wait until it ends.",
  "the video upload failed": "The video upload stopped. The post was deleted. Publish it again.",

  /* Friends and feed. */
  "too many friend lists in a row":
    "The shown friend list changed 3 times in a row. The new list goes out with the next post.",

  /* Devices. */
  "this device is not on the account's list":
    "The server does not know this device as a device of the account. This device cannot sign in.",
  /* Account state between devices. Programming errors of the interface, but they reach the screen if they happen. */
  "read mark channel is invalid": "The read mark has no valid channel. The mark was not saved.",
  "read mark time is invalid": "The read mark has no valid time. The mark was not saved.",
  "preference key is invalid": "The name of this preference is not valid. The preference was not saved.",
  "preference value is too long": "This preference is too long. The preference was not saved.",
  "too many preferences": (detalhe) =>
    typeof detalhe["tecto"] === "number"
      ? `This account already has ${detalhe["tecto"]} preferences. The new preference was not saved.`
      : "This account already has the maximum of preferences. The new preference was not saved.",
  "archive channel is invalid": "This conversation has no valid channel. The conversation was not archived.",

  /* Device revocation. */
  "device-revoke-no-account-key": "Only the main device can revoke devices. Revoke from the main device.",
  "device-revoke-unsupported": "This server cannot revoke devices. Nothing changed.",
  "device-key-invalid": "The key of this device is not valid. Nothing changed.",
  "device-revoke-self": "You cannot revoke this device from itself. Revoke it from another device.",
  "device-revoke-manifest-unread": "Could not read the device list of the account. Nothing changed. Try again.",
  "device-not-in-manifest": "This device is not on the account's list. Nothing changed.",
  "device-revoke-manifest-refused": (detalhe) =>
    detalhe["reason"] === "no-answer"
      ? "The server did not answer in time. This device is already marked as revoked. Repeat to finish the revocation."
      : "The server did not accept the new device list. Nothing changed. Try again.",
  "device-revoke-incomplete": (detalhe) =>
    Array.isArray(detalhe["channels"])
      ? `The device left the account, but it is still in ${detalhe["channels"].length} channels. Revoke again to finish.`
      : "The device left the account, but it is still in some channels. Revoke again to finish.",
  "device-revoked": "This device was removed from the account on another device.",
  "account-channel-foreign":
    "The account channel had a device that is not of this account. This device left that channel. The state passes again when the channel is made again.",
  "this call server does not carry music": "This call server does not carry music yet. The call goes on without it.",
  "could not read this audio file": (detalhe) =>
    typeof detalhe["nome"] === "string" && detalhe["nome"] !== ""
      ? `Could not read "${detalhe["nome"]}". The list goes to the next file.`
      : "Could not read this file. The list goes to the next file.",
  "could not play this audio file": "The browser did not let the file play. Press Play again.",
  "the chosen source gave no sound": "The source gave no sound. Share again: in the browser picker, tick the audio box.",
  "this device does not give the system sound": "This device does not give the system sound to the app. You need Windows, or macOS 14.2 or later.",
  "could not capture this sound source": "Could not capture this sound. Check the system permissions.",
  "this device cannot capture a sound source": "This browser does not let you capture the sound of a source. Use files or the desktop app.",
  "the system does not allow recording the sound":
    "macOS does not let the app record the sound. Open System Settings › Privacy & Security › Screen & System Audio Recording, turn on Orwell and open the app again.",
}

/** Why the microphone or the camera did not open, by the name of the browser error. See `porqueNaoAbriu` in `pt.ts`. */
function whyItDidNotOpen(detalhe: DetalheDoErro): string {
  switch (detalhe["nome"]) {
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "This device has no microphone connected."
    case "NotReadableError":
    case "TrackStartError":
      return "Another app uses it."
    case "OverconstrainedError":
      return "The chosen device does not fit. Choose another one in Settings."
    default:
      return "Check the system permissions."
  }
}
