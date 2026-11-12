import type { DetalheDoErro, FraseDeErro } from "../lib/codigosDeErro.js"

/**
 * All visible text, in European Portuguese, grouped by screen.
 *
 * This is the BASE LANGUAGE, and the word is literal: it is the only catalogue
 * that must be complete. The other languages are partial overlays on this one
 * (see `linguas/en.ts`), and whatever they lack falls back to here, leaf by
 * leaf. A raw key never reaches the screen because there is never a leaf
 * without Portuguese.
 *
 * BRAND vs PROTOCOL: the product is called Orwell. "enclave" survives only as
 * a technical surface that existing accounts and installs depend on: the
 * enclave:// invite scheme, the server's /_enclave/* routes, the
 * @enclave/* packages, the ENCLAVE_* variables, the storage keys and the
 * exported .enclave file. The text says Orwell; the identifiers stay where
 * they are. Renaming them is cosmetic debt, not text.
 *
 * The text is part of the product: it is deliberately frank about what the
 * application can and cannot do. Keeping it in a single file keeps that voice
 * consistent, and keeps a future translation from being an archaeology job.
 *
 * No dashes in what reaches the screen: the long dash does not enter the interface.
 */
/**
 * Report reasons 1 to 7, the same in the report sheet and in the founder's
 * inbox. Number 8 differs: the sheet says the note is required, the inbox does not.
 */
const MOTIVOS_DA_DENUNCIA = {
  1: "Abuso sexual de menores",
  2: "Ameaças ou incitamento à violência",
  3: "Assédio ou perseguição",
  4: "Imagens íntimas sem consentimento",
  5: "Burla, phishing ou spam",
  6: "Discurso de ódio",
  7: "Outro conteúdo ilegal",
} as const

export const pt = {
  common: {
    close: "Fechar",
    remove: "Remover",
    retry: "Tentar de novo",
    you: "Tu",
    copyFailed: "não foi possível copiar",
    /** An old host that does not bring the gesture it was asked for. */
    unsupported: "esta versão da app ainda não faz isso",
    cancel: "Cancelar",
    mediaEvicted: "imagem já não está neste aparelho",
    /**
     * The same, for an attachment that is not an image.
     *
     * Its own sentence and not the one above: calling a PDF that was evicted an
     * "imagem" would be lying about what was there. The name and the type
     * survive the eviction (see `evictEntryMedia` in the vault), so the line
     * still says what it was.
     */
    fileEvicted: "ficheiro já não está neste aparelho",
    connectionOnline: "ligado",
    connectionConnecting: "a ligar…",
    connectionReconnecting: "a reconectar…",
    connectionOffline: "sem ligação",

    /*
      Pasting images, in both composers.

      Here and not in `chat` and `social` because the sentences are the SAME in
      both places, unlike the attachment ones: those say "mensagem" or
      "publicação" and have to be two; these talk about what came from the
      clipboard, and what came is the same wherever it goes.
    */

    /**
     * Something was pasted that claimed to be an image and is not.
     *
     * Says what was checked (the bytes) instead of "unsupported format", which
     * explains nothing to anyone. The common case is an SVG or a HEIC, and the
     * person has to know it is not the size's fault nor the connection's.
     */
    pasteNotImage: "O que colaste não é uma imagem que a app consiga ler. Usa PNG, JPEG, GIF, WebP ou AVIF.",

    /**
     * The image was shrunk before it was encrypted.
     *
     * This is information and not a warning: a photo that goes in at twelve
     * megabytes and comes out at three hundred kilobytes has changed, and the
     * sender has the right to know it changed. Hiding it would leave the person
     * to find out alone, on the other side, that the photo is not as it was.
     *
     * What is NOT said here, because it does not fit in one line of the
     * composer and is documented in `lib/images.ts`: re-encoding throws away
     * the EXIF metadata, and with it the location where the photo was taken.
     */
    imageShrunk: (de: string, para: string): string => `Imagem reduzida de ${de} para ${para}.`,
    /*
      A GIF above the animated cap (`lib/images.ts`) was re-encoded and became
      still. Says the size and the cap, so the person can pick a lighter GIF
      instead of guessing.
    */
    gifParado: (tem: string, maximo: string): string =>
      `O GIF tem ${tem}. Para ficar animado, o máximo é ${maximo}. Ficou parado.`,
    imagesShrunk: (n: number, de: string, para: string): string =>
      `${n} imagens reduzidas de ${de} para ${para}.`,
    /**
     * What a spoiler (`||like this||`) says before it is revealed.
     *
     * In `common` and not in `chat`: the same marker works in a message, a post
     * and a comment, and three identical sentences in three places always end
     * up no longer identical.
     *
     * It is also what a screen reader announces in place of the hidden text. So
     * it says what to do ("mostrar") and not only what it is: whoever hears
     * this needs to know there is a gesture waiting there.
     */
    spoilerShow: "Mostrar texto escondido",
  },

  connection: {
    banner: "Sem ligação. A tentar reconectar…",
    /** The banner after a drop: how long, and that the application keeps trying. */
    semLigacaoHa: (tempo: string): string => `Sem ligação há ${tempo}.`,
    duracao: (minutos: number): string =>
      minutos < 1
        ? "menos de 1 min"
        : minutos < 60
          ? `${minutos} min`
          : Math.floor(minutos / 60) === 1
            ? "1 hora"
            : `${Math.floor(minutos / 60)} horas`,
    ligarAgora: "Ligar agora",
    tentaSozinha: "A app tenta outra vez sozinha. Este botão tenta agora.",
    aLigar: "A ligar…",
    /**
     * The composer with no connection: you can still write, and it says what
     * happens. Short, because at 375px the box shows about fifteen characters;
     * the banner above already says there is no connection.
     */
    composerEspera: "Sai depois",
    /** The composer in a tab that no longer writes. See `session.escreve`. */
    // The interface does not know whether it stopped for a new version or because
    // another tab took the vault: the sentence serves both cases.
    separadorParado: "Este separador já não liga ao servidor. Fecha os outros separadores ou recarrega.",
    /** Why attachments stop without a connection, when the composer does not. */
    anexosOffline: "Imagens e ficheiros só com ligação.",
  },

  /**
   * The notice that there is a new version, only in the installed application.
   *
   * **The word missing here on purpose is "actualizar".** None of this updates
   * anything: without code signing there can be no updater worth trusting (see
   * `apps/client/src/main/actualizacao.ts`), and a button that says
   * "Actualizar" and then opens a browser is a promise broken on the first
   * click. It says what it does: it leads to a page with a file to download.
   *
   * The checksum goes on screen because it is the only defence against a
   * tampered file this product has. Whoever reads it before downloading has a
   * chance to check it afterwards; hidden, it is useless.
   */
  actualizacao: {
    titulo: "Há uma versão nova do Orwell",
    versoes: (instalada: string, disponivel: string): string =>
      `Tens a ${instalada} instalada. A ${disponivel} já está publicada.`,
    versoesComNome: (instalada: string, disponivel: string, nome: string): string =>
      `Tens a ${instalada} instalada. A ${disponivel} "${nome}" já está publicada.`,
    nota: "A app instalada não se actualiza sozinha. Descarrega o instalador novo. Instala-o por cima desta versão.",
    descarregar: "Ir à página de descargas",
    dispensar: "Dispensar",
    dispensarTitulo: (versao: string): string => `Não voltar a avisar sobre a ${versao}`,
    somaRotulo: "SHA-256 do instalador",
    somaNota: "Confere esta soma depois de descarregares. Se não for igual, não instales.",
    /** The web banner (`apps/web/src/main.tsx`): here reloading is enough, and that is all it says. */
    webTexto: "Versão nova. Recarrega para continuar.",
    /** The small line underneath, in the pill (choice B, 28 October 2026). */
    webDetalhe: "Este separador já não envia nem recebe.",
    webRecarregar: "Recarregar",
  },

  /**
   * One owner per browser (`apps/web/src/posse-do-separador.ts`).
   *
   * Two tabs with the same account both wrote to the same vault, and on
   * 18 October 2026 one of them broke the common room. Now only one tab uses
   * the account; the others show this screen. The text does not talk about
   * vaults or epochs: it says what is going on and what the person can do.
   */
  separadores: {
    titulo: "Já tens o Orwell aberto noutro separador.",
    texto: "A tua conta só funciona num separador de cada vez.",
    usar: "Usar este separador",
    aPedir: "A pedir ao outro separador…",
    nota: "Ao usar este separador, o outro pára. Se fechares o outro, este abre sozinho.",
    /** The banner for a browser with neither Web Locks nor BroadcastChannel. */
    semProteccao: "Este browser não protege contra dois separadores. Usa o Orwell só num separador.",
    /** The deadline passed without «cedi»: the other tab may be frozen. */
    semResposta: "O outro separador não responde. Usar este mesmo assim?",
    forcar: "Usar este mesmo assim",
    temConvite: 'Este separador tem um convite. Carrega em "Usar este separador" para o abrir.',
    temEmparelhamento: 'Este separador tem um link de emparelhamento. Carrega em "Usar este separador" para o abrir.',
    /**
     * A tab running code from before this version wrote the vault behind the
     * owner's back. This one stops; the person has to close the other.
     */
    outroEscritor: "Fecha os outros separadores do Orwell e recarrega.",
  },

  errors: {
    /** The first line of every error: the number you read out or paste into a report. */
    codigo: (n: number): string => `Erro ${n}`,
    /**
     * The «Erro 900» sentence: an error the table does not know. The raw
     * message goes underneath, smaller, so it can be reported.
     */
    desconhecido: "Aconteceu um erro que a app não conhece.",
    boot: "Não foi possível abrir o armazenamento local deste aparelho.",
    crashTitle: "Algo correu mal.",
    reload: "Recarregar",
    membersFailed: "Não foi possível carregar os membros.",
  },

  gate: {
    splashTitle: "Orwell",
    splashBody: "A abrir…",
    setupTitle: "Criar conta",
    setupLead: "Não pedimos email nem telefone. A conta fica neste aparelho.",
    name: "Nome",
    namePlaceholder: "Como queres aparecer",
    server: "Servidor",
    osKeychain: "Usar o bloqueio deste aparelho",
    devicePassphrase: "Palavra-passe deste aparelho",
    passphrasePlaceholder: "Pelo menos 8 caracteres",
    passphraseNote: "Se a esqueceres, não a podes recuperar.",
    confirmPassphrase: "Confirmar a palavra-passe",
    passphraseMismatch: "As duas palavras-passe são diferentes.",
    passphraseShort: "Escreve pelo menos 8 caracteres.",
    reveal: "Mostrar",
    conceal: "Ocultar",
    serverInvalid: "Este endereço de servidor não é válido.",

    /*
     * Account creation is one question at a time.
     *
     * Each step has a QUESTION (the heading, which is what the person reads
     * first) and an EXPLANATION underneath. The field labels still exist
     * (`name`, `devicePassphrase`, `confirmPassphrase` above) but are only for
     * screen reader users: repeating "Nome" under "Como queres mostrar o teu
     * nome?" is noise for whoever sees it.
     *
     * The interview tone is on purpose: the owner reaffirmed it on 27 October
     * 2026, when it was proposed to swap the questions for plain titles.
     *
     * Informal TU address, like the rest of the application. The request came
     * written in the formal você ("Como quer mostrar o seu nome?"), but this
     * screen is the first of an application that addresses everyone as tu from
     * the next screen on (the unlock screen already says "Introduz a
     * palavra-passe"). Switching register halfway through the front door would
     * show more than the formality was worth.
     */
    askName: "Como queres mostrar o teu nome?",
    askNameLead: "É assim que apareces a quem fala contigo. Podes mudar o nome mais tarde.",
    /*
      The profile image, right after the name (owner's request, 27 October
      2026), in the same question tone as the other pages. «Saltar» has the
      same weight as going forward: the account does not need a face, and
      without an image the name's initial stays. «Imagem de perfil» and not
      «fotografia», by the owner's order: it can be a drawing or a GIF, and
      «fotografia» promised a face.
    */
    askPhoto: "Queres pôr uma imagem de perfil?",
    askPhotoLead: "É a imagem que os outros vêem ao lado do teu nome. Podes mudar depois.",
    choosePhoto: "Escolher imagem",
    removePhoto: "Remover",
    skipPhoto: "Saltar",
    askPass: "Qual vai ser a palavra-passe?",
    askPassLead: "Escolhe uma palavra-passe nova. Não uses uma de outro sítio.",
    /** The same step, when the system offers to keep the key. */
    askPassKeychain: "Como queres proteger a conta?",
    askPassKeychainLead: "Podes usar o bloqueio do aparelho. Para usar uma palavra-passe, tira o visto.",
    askConfirm: "Confirma a palavra-passe",
    askConfirmLead: "Escreve-a outra vez.",
    stepOf: (passo: number, total: number) => `Passo ${passo} de ${total}`,
    next: "Continuar",
    back: "Voltar",
    /** The server gets out of the way of whoever creates the account, but does not disappear. */
    advanced: "Opções avançadas",
    advancedNote: "O servidor da tua conta. Se não sabes o que é, não mudes.",
    creatingTitle: "A criar a tua conta",
    creatingLead: "Não feches esta janela.",
    vaultExists: "Já existe uma conta neste aparelho.",
    vaultExistsBody:
      "Uma conta nova apaga a conta deste aparelho. Para começar de novo, apaga os dados deste site no browser.",
    goToUnlock: "Entrar na conta deste aparelho",
    warning: "Se perderes este aparelho ou a palavra-passe, perdes a conta.",
    creating: "a criar…",
    create: "Criar conta",
    stepLabels: {
      cofre: "A preparar o aparelho…",
      identidade: "A criar a conta…",
      ligacao: "A ligar ao servidor…",
      perfil: "A guardar o perfil…",
    } as Record<"cofre" | "identidade" | "ligacao" | "perfil", string>,
    stepNames: {
      cofre: "Aparelho",
      identidade: "Conta",
      ligacao: "Ligação",
      perfil: "Perfil",
    } as Record<"cofre" | "identidade" | "ligacao" | "perfil", string>,
    importLead: "Tens o ficheiro da conta (.enclave)? Importa-o aqui.",
    importPick: "Importar conta",
    importPassLabel: "Palavra-passe do ficheiro",
    importing: "A importar…",
    importAction: "Importar",
    unlockTitle: "Bem-vindo de volta",
    unlockLead: "Escreve a palavra-passe deste aparelho.",
    /*
     * The way out for whoever lost the passphrase, which did not exist until now.
     *
     * An account in this application cannot be recovered: the key is the
     * passphrase, there is no copy on the server, and nobody on the other side
     * can reset it. Whoever forgets it is stuck on this screen forever, without
     * even a path to start over. That is why the only possible remedy is to
     * delete this device's vault and create another account.
     *
     * The confirmation is the same Settings sheet, with the typed word: see
     * `settings.destroyStepsGate`, which is the only sentence that changes.
     */
    lostAccount: "Esqueceste a palavra-passe?",
    lostAccountAction: "Criar conta nova.",
    /*
      The second line of the gate's footer: sign in with ANOTHER account on
      this device, by file or by pairing. Both paths delete the account that
      is here, and the sheet says so before asking. See
      `EntrarComOutraConta`.
    */
    otherAccount: "Entrar com outra conta",
    otherAccountTitle: "Entrar com outra conta",
    otherAccountLead: "Este aparelho guarda uma conta só. Os dois caminhos apagam primeiro a conta deste aparelho.",
    otherAccountImport: "Importar um ficheiro de conta",
    otherAccountPair: "Emparelhar com o aparelho principal",
    passphrase: "Palavra-passe",
    opening: "A abrir…",
    openingNote: "Pode demorar alguns segundos.",
    memorizar: "Memorizar a sessão",
    memorizarNota: "Da próxima vez, o Orwell abre sem pedir a palavra-passe. Quem usar este aparelho desbloqueado entra na tua conta.",
    memorizarNotaIos: "No iPhone, sete dias sem abrir o Orwell podem apagar a sessão e a conta deste aparelho.",
    memorizarFalhou: "Entraste, mas não foi possível memorizar a sessão neste aparelho.",
    /*
      The box on the last registration step (owner's request, 3/11/2026). The
      sentence is the owner's, word for word, and it is the only one outside
      the rail that says "comunidade": it talks about the people who are there,
      not about the encrypted group. See `terminologia.test.ts`.
    */
    canalOficial: "Entrar no canal Orwell, a comunidade de todos os users",
    canalOficialNota: "Lá estão as Release notes, a ajuda e outras pessoas. Podes entrar ou sair mais tarde.",
    revogadoSemFrase: "Esta conta não tem palavra-passe neste aparelho. Para usar o Orwell aqui outra vez, começa de novo.",
    comecarDeNovo: "Começar de novo",
    open: "Entrar",
    /**
     * The gate's old third path, under the name. It left the screen in phase
     * 8.1 (the question about the other device moved to the start). The two
     * keys stay while `scripts/e2e-emparelhar.mjs` and `e2e-cliente-antigo.mjs`
     * look for «Emparelhar»: they go when the scripts are updated. See
     * `strings.guioes.test.ts`.
     */
    joinLead: "Já tens conta noutro aparelho? Emparelha este aparelho com ele.",
    joinAction: "Emparelhar",
    /*
      Phase 8.1: the first question of Setup, before the account. Two buttons
      with the same weight. See `ecraInicial`.
    */
    outroAparelhoPergunta: "Já usas o Orwell noutro aparelho?",
    outroAparelhoLead: "Uma conta chega para todos os teus aparelhos. Se já tens conta, emparelha este aparelho com ela.",
    outroAparelhoSim: "Sim, emparelhar este aparelho",
    outroAparelhoNao: "Não, criar conta",
  },

  /**
   * Pairing: the same account on a computer and on a phone.
   *
   * Two sentences are contract and not decoration, and are said once, at the
   * end (docs/PLANO_MULTIDISPOSITIVO.md §2.3): `doneBody`, because a new device
   * seeing an empty channel concludes it lost messages, and it did not, it
   * could never have had them; and `doneGuestNote`, because the phone does not
   * have the account key and the person has to know where devices are added
   * and removed.
   */
  pairing: {
    joinTitle: "Emparelhar este aparelho",
    joinLead:
      "No aparelho principal, abre Configurações, Aparelhos, Acrescentar aparelho. Depois lê o código com a câmara, ou cola aqui o link.",
    scan: "Ler o código com a câmara",
    scanning: "Aponta a câmara ao código do aparelho principal.",
    stopScan: "Parar a câmara",
    cameraDenied: "O browser não deu acesso à câmara. Cola o link.",
    cameraUnavailable: "Este aparelho não tem câmara disponível. Cola o link.",
    pasteLabel: "Ou cola o link",
    pasteAction: "Continuar",
    linkInvalid: "Isto não é um link de emparelhamento.",
    keyTitle: "Palavra-passe deste aparelho",
    keyLead: "Escolhe uma palavra-passe para este aparelho.",
    connecting: "A ligar ao aparelho principal…",
    waitingHost: "À espera do aparelho principal…",
    waitingGuest: "À espera do outro aparelho. Lê este código com a câmara dele, ou cola lá o link.",
    sasTitle: "São as mesmas palavras?",
    sasLead: 'Compara as seis palavras nos dois ecrãs. Se forem diferentes, carrega em "Não são".',
    /**
     * What happens to history, on the six-word screen (1.0 «Arca»,
     * 29/10/2026). There is no checkbox and no question (owner's decision:
     * «quero fora»): just the sentence, so whoever pairs knows.
     */
    sasHistoricoAqui: "Depois de emparelhar, este aparelho recebe as conversas antigas e os ficheiros do outro aparelho.",
    sasHistoricoNoNovo: "Depois de emparelhar, o aparelho novo recebe as conversas antigas e os ficheiros deste aparelho.",
    sasSame: "São as mesmas",
    sasDifferent: "Não são",
    sasConfirmedHere: "Confirmado aqui. Falta confirmar no outro aparelho.",
    joining: "A entrar na conta…",
    /* The snapshot of the account state (phase 5), between the certificate and the entry. */
    receivingState: "A receber os teus dados…",
    receivingStateLead:
      "O outro aparelho envia o que já leste, as conversas arquivadas, os bloqueados e as preferências.",
    stateDeadline: (segundos: number): string => `Este aparelho entra daqui a ${segundos} s, com ou sem os dados.`,
    stateMissing: "Os teus dados não chegaram a tempo. Chegam quando os dois aparelhos estiverem ligados.",
    profileMissing: "O teu perfil ainda não chegou do aparelho principal. Chega quando os dois estiverem ligados.",
    doneTitle: "Este aparelho já é da conta",
    /*
      Up to 1.0.5 it said «As anteriores ficam nos outros aparelhos». Since
      history between devices (29/10/2026) old conversations pass from device
      to device when both are connected.
    */
    doneBody: "Este aparelho já recebe as mensagens novas. As conversas antigas chegam do outro aparelho enquanto os dois estiverem ligados.",
    doneGuestNote: "Acrescenta ou tira aparelhos no aparelho principal da conta.",
    doneHostBody: "O aparelho novo recebe as mensagens a partir de agora. As anteriores ficam nos outros aparelhos.",
    doneAction: "Entrar",
    hostTitle: "Acrescentar aparelho",
    hostLead:
      'No outro aparelho, escolhe "Sim, emparelhar este aparelho". Depois lê este código com a câmara dele, ou cola lá o link.',
    copyLink: "Copiar link",
    linkCopied: "link copiado",
    qrAlt: "Código para ler com a câmara do outro aparelho",
    noAccountKey: "Acrescenta ou tira aparelhos no aparelho principal da conta.",
    serverUnsupported: "Este servidor ainda não sabe emparelhar aparelhos.",
    /** The pairing link opened on a device that already has an account. One line on the gate, like the invite's. */
    gateHasAccount: "Este aparelho já tem uma conta. Para emparelhar, usa um aparelho sem conta.",
    /** And the link that cannot even be read. Saying so is better than the silence there was. */
    gateInvalid: "Este link de emparelhamento não se lê.",
    failedTitle: "O emparelhamento falhou",
    /* The reason for not pairing no longer lives here: it is an error like the
       others, with a code (7xx), and goes through `translatePairingError` in `strings.ts`. */
  },

  /**
   * The names of the five destinations, and the boundary they do not cross.
   *
   * ## What changed, on 20 August 2026
   *
   * ```
   * O teu perfil → Eu
   * Canais       → Comunidades
   * Social       → Feed
   * Contactos    → Amigos
   * Configurações  (stays)
   * ```
   *
   * ## The decision, which is about a boundary and not about translation
   *
   * **The rail names the PLACE you go to. The vocabulary names the THING.** The
   * button is now called "Comunidades"; what gets created, opened, left and
   * deleted inside it is still called **canal**. "Novo canal", "Sair do
   * canal", "Convidar para o canal", "Propriedades do canal": none of that is
   * touched, and `terminologia.test.ts` keeps pinning it.
   *
   * The alternative was to swap the word everywhere, and it was rejected for
   * three measured reasons, not out of laziness:
   *
   * 1. **The code says `channel`.** It is the MLS group, it is what the
   *    encryption protects, it is the name in the protocol and on the server.
   *    Calling the channel "comunidade" in the interface would bring back, on
   *    purpose, the mismatch between the interface's words and the code's
   *    words that `terminologia.test.ts` exists to prevent. It records that
   *    this already happened once, when the channel was called "espaço", and
   *    from then on everyone learned the wrong model.
   * 2. **The homepage teaches the hierarchy, and two of the pages are legal.**
   *    There are 128 lines with "canal" in this file alone, 87 with "channel"
   *    in the English one, plus `index.html`, `termos.html` and
   *    `privacidade.html`, where "canal" is a defined term. Rewriting that to
   *    rename a button is disproportionate, and touches what the homepage
   *    teaches newcomers.
   * 3. **"Comunidade" is not the forbidden word.** The one this product
   *    refuses is "servidor" ("server" in English), because the server here is
   *    something else, the homeserver, the piece meant to know nothing.
   *    "Comunidade" collides with none of that: it is the word the product
   *    already uses to describe itself ("community chat", in the root
   *    `package.json`).
   *
   * What this decision requires is that the boundary does not dissolve by
   * itself, so it is no longer only written down: `terminologia.test.ts`
   * gained a case that fails if "comunidade" leaks from the rail into the
   * vocabulary, or if the rail says "Canais" again.
   *
   * ## Why the column heading follows
   *
   * `sidebar.header*` are the same names said a second time, 60px from the
   * button. A "Comunidades" button opening a column titled "Canais" is two
   * names for one destination a glance apart, which is exactly how to teach
   * the wrong model. They follow. The column's `+` still says "Criar canal",
   * and that is where the boundary shows live: the section is called
   * Comunidades, the thing it makes is called canal.
   */
  rail: {
    profile: "Eu",
    chat: "Comunidades",
    social: "Feed",
    people: "Amigos",
    settings: "Configurações",
    menu: "Abrir o painel lateral",
    /**
     * The badge in words, for whoever cannot see the screen.
     *
     * **The button's description and not its name, and the difference is
     * deliberate.** A destination's name is the destination: "Canais" is called
     * Canais whether the badge is lit or not, and a button that changes name
     * depending on what arrived is a button nobody can name to another person.
     * What is waiting is a circumstance of the button, not its identity, which
     * is why it travels in `aria-describedby`: announced after the name,
     * without replacing it.
     *
     * Says the full number even when the drawing shrank to "9+": the
     * abbreviation is a 40-pixel limitation and not something you want to say
     * to someone listening.
     */
    porAtender: (quantas: number): string =>
      quantas === 1 ? "1 por atender" : `${quantas} por atender`,
  },

  sidebar: {
    /* The rail's same names, said 60px from it. See the note in `rail`. */
    headerProfile: "Eu",
    /** A grey line for each requested channel that has not arrived yet. */
    aEsperaDeEntrada: "à espera de alguém do canal",
    /** The link said one name and another channel arrived. See `invite.arrivedMismatch`. */
    chegouOutroNome: "o canal que chegou tem outro nome",
    cancelar: "Cancelar",
    cancelarEspera: (nome: string): string => `Deixar de esperar por ${nome}`,
    cancelarEsperaSemNome: "Deixar de esperar",
    /**
     * The name of the waiting line when the address is opaque (1.0) and there
     * is no name: neither the invite seal gave it, nor the channel published it.
     * The address is not a name.
     */
    canalDoConvite: "Canal do convite",
    esperaCancelada: "Deixaste de esperar. Se alguém do canal te deixar entrar depois, o canal aparece aqui.",
    headerChat: "Comunidades",
    headerSocial: "Feed",
    headerSettings: "Configurações",
    newPost: "Nova publicação",
    /* Hierarchy, and the two entries that cross it: the heading's `+` creates a
       CHANNEL (the encrypted group), the `+` at the bottom of the tree creates
       a ROOM inside it. Calling both things a channel was the mistake these
       words exist to undo. */
    createRoom: "Criar canal",
    newRoom: "Nova sala",
    editProfile: "Editar perfil",
    joinWithLink: "Entrar com um link",
    /** Whoever is not in the common channel joins through here (3/11/2026). See `escolherSalaComum`. */
    entrarNoCanalOficial: "Entrar no canal Orwell",
    aEntrarNoCanalOficial: "A entrar no canal Orwell…",
    noRoomsBefore: "Ainda não tens canais. Cria um com o ",
    noRoomsAfter: " ao lado.",
    addFriend: "Adicionar amigo",
    /**
     * What the voices symbol says in words (`components/Vozes.tsx`).
     *
     * There were two sentences without a number, "em chamada" and "Há uma
     * chamada a decorrer", and the second only appeared to whoever hovered the
     * mouse. The drawing started counting people, and the label counts with
     * it: what is seen and what is heard have to be the same information.
     */
    callPeople: (n: number): string =>
      n === 1 ? "1 pessoa em chamada, à espera de companhia" : `${n} pessoas em chamada`,
    /**
     * The count, and who they are.
     *
     * Owner's report on 5 October 2026: some people cannot see who is in the
     * room before joining. The count was already on the channel line; the names
     * only existed under the OPEN channel, so seeing who is in a call meant
     * opening the channel first. This puts them where the count already is,
     * which is also the `title` and the accessible name of the voices symbol
     * (see `components/Vozes.tsx`).
     *
     * Takes the finished sentence instead of composing it: the three sentences
     * on the channel line say different things ("3 pessoas em chamada", "Ana
     * está a chamar-te", "Em chamada: tu e mais 2 pessoas") and none of them
     * should be repeated here just to hang names after it.
     */
    callWho: (frase: string, quem: string): string => `${frase}: ${quem}`,
    /** In a direct conversation, a call we are not in is someone calling us. */
    callingYou: (name: string): string => `${name} está a chamar-te`,
    /** `outros` does not count us. */
    inCallWith: (outros: number): string =>
      outros === 0
        ? "Em chamada: só tu"
        : outros === 1
          ? "Em chamada: tu e mais 1 pessoa"
          : `Em chamada: tu e mais ${outros} pessoas`,
    myProfile: "O teu perfil",
    pickName: "Escolhe um nome",
    /**
     * The two button sections of the account strip.
     *
     * They are not code decoration. Without them, whoever listens to the screen
     * gets four buttons in a row without knowing what they are for; with them,
     * they hear "Som e microfone, grupo" and then the two toggles. It is the
     * same split the drawing shows to whoever sees it, which is why the name
     * describes the section's CONTENT and not its position.
     */
    audioGroup: "Som e microfone",
    accountGroup: "Notificações e configurações",
    painelDeControlo: "Painel de controlo",
    /*
      The gear on the account strip. Its own name and not the rail's
      («Configurações»): two buttons with the same name on the same page are
      two targets that a voice command and a screen reader cannot tell apart.
    */
    abrirDefinicoes: "Abrir as configurações",
    statusPrompt: "Em que andas?",
    unreadCount: (n: number): string => (n === 1 ? "1 mensagem por ler" : `${n} mensagens por ler`),
    drawerLabel: "Canais",
    /** Minimise and show again. The name of what folds goes into the label:
     *  a list of identical "Minimizar" says nothing to whoever listens to the screen. */
    collapse: (nome: string): string => `Minimizar ${nome}`,
    expand: (nome: string): string => `Mostrar ${nome}`,
    /** How many rooms were hidden under a folded category. */
    hiddenRooms: (n: number): string => (n === 1 ? "1 sala escondida" : `${n} salas escondidas`),
    /** Who is in a voice room, when the faces are minimised. */
    voiceCount: (n: number): string => (n === 1 ? "1 pessoa nesta sala" : `${n} pessoas nesta sala`),
    /**
     * The padlock next to a restricted category.
     *
     * Says what the mark means and what it does NOT mean. The rooms of a public
     * channel are readable by whoever has the channel keys, hidden or not; what
     * the restriction does is tidy the list. Promising a closed door here would
     * promise what the properties sheet denies three lines below (see
     * `categoryProperties.note`).
     */
    categoryRestricted: "Só aparece a quem tem os cargos escolhidos. Os outros membros podem ler à mesma.",
  },

  chat: {
    call: "Chamada",
    video: "Vídeo",
    membersToggle: "Membros",
    noRoom: "Sem canal aberto",
    inCallOne: " está em chamada",
    inCallMany: " estão em chamada",
    joinCall: "Entrar",
    emptyTitle: "Começa por criar um canal",
    emptyBody: "Só os membros de um canal o podem ler. Nem o servidor lê.",
    emptyAction: "Criar canal",
    copyText: "Copiar texto",
    textCopied: "texto copiado",
    /*
      An empty room, told by the reason it is empty. See `vazioDaConversa`.

      It used to be one sentence for three different states, and the sentence
      claimed the rarest of the three: "ainda ninguém escreveu aqui" in a room
      where people talked yesterday is the application telling a person their
      memory is wrong.

      The middle one is the one that could not stay unsaid. The vault has a cap
      per channel and keeps throwing away the oldest, and a blank screen over
      that reads as loss, worse, as loss by the reader's fault. The sentence
      states only what is always true (the device keeps the most recent ones)
      and then takes the blame out of the way, which is the only thing needed
      there.

      It is the same register as `searchCeiling`, and with the same licence: it
      says WHERE the messages are without explaining HOW the product works.
    */
    timelineEmpty: "Ainda ninguém escreveu aqui.",
    timelineEmptyBody: "Escreve a primeira mensagem.",
    /**
     * And the same emptiness when there is no composer at all.
     *
     * The sentence above points to a box that exists. In a conversation with an
     * unanswered friend request it does not exist, and sending the person to
     * look for it at the bottom was sending them to look for what was removed
     * on purpose.
     */
    timelineEmptyLocked: "A conversa começa depois de aceite o pedido.",
    timelineKeptTitle: "Não há nada guardado desta sala.",
    timelineKeptBody:
      "Este aparelho guarda só as mensagens mais recentes de cada canal. As antigas saem com o tempo. Não apagaste nada.",
    timelineOlderTitle: "Há mensagens mais antigas por abrir.",
    timelineOlderBody: "Este aparelho ainda guarda histórico deste canal que não está à vista.",
    composerPlaceholder: "Escreve uma mensagem",
    send: "Enviar",
    sending: "a enviar",
    sendFailed: "não enviada",
    aEsperaDeLigacao: "à espera de ligação",
    /** Spelled out on the line: the time shown now is when it was written, and the one that stays is when it was sent. */
    aEsperaDeLigacaoNota: "à espera de ligação. Mostra a hora de envio.",
    discard: "Descartar",
    newMessages: "↓ Novas mensagens",
    loadOlder: "Carregar mais antigas",
    joinPending: "Pedido enviado. À espera que alguém do canal te aceite…",
    joined: (name: string): string => `Entraste em ${name}`,
    /** With opaque addresses (1.0) and no name from the seal nor published: no name. */
    joinedOpaco: "Entraste no canal.",
    /*
      Leaving, which used to be called "esquecer".

      The word changed because "esquecer" was our jargon: it described what the
      program does to the vault, not what the person wants to do. What they
      want is to go away. What the sentence promises is unchanged, and is still
      the whole truth: MLS does not let a member remove itself, so leaving is
      from this device and the others keep seeing us in the list until someone
      removes us. Promising a clean exit would promise what does not exist.
    */
    leaveTitle: "Sair deste canal?",
    leaveBody: "Deixas de ver as mensagens deste canal. Sais da lista de membros.",
    /** The real leave failed (no connection, no receipt). Forgetting only here is something else, and it says so. */
    leaveOfflineTitle: "Não foi possível sair do canal.",
    leaveOffline:
      "Podes sair só deste aparelho. Os outros membros continuam a ver-te na lista até alguém te remover.",
    /** The verb of the two notices below: says where you leave, not only that you leave. */
    leaveOnlyHereAction: "Sair só deste aparelho",
    left: "Saíste do canal. Deixou de estar neste aparelho.",
    /** Forgotten only here: the leaf stays in the tree and the others keep seeing the person. */
    forgottenHere: "Esquecido neste aparelho. Os outros membros continuam a ver-te na lista.",
    /** An old host with no real leave: there is only forgetting, with no failure before it. */
    leaveOnlyHereTitle: "Sair só deste aparelho?",
    leaveOnlyHere:
      "O canal sai só deste aparelho. Os outros membros continuam a ver-te na lista até alguém te remover.",

    /*
      Deleting, which is the gesture on the channel and not on me.

      The sentence says what the code does (review of 20/10/2026). The
      tombstone (`space.removed`) reaches every member, and their app honours
      it with `forgetChannel`, which deletes the channel's history from the
      vault. A modified app ignores the tombstone and keeps everything. The
      sentence does not promise obedience the encryption does not guarantee.
      The same sentence is in `roles.noteFinal`.
    */
    removeChannelTitle: (nome: string): string => `Eliminar "${nome}"?`,
    removeChannelConfirm:
      "O canal desaparece para todos os membros. Não podes desfazer isto. A app de cada membro apaga as mensagens do canal, mas uma app alterada pode guardá-las.",
    removedChannel: (nome: string): string => `"${nome}" eliminado.`,

    /**
     * Who is typing.
     *
     * Above three names you stop reading names and start reading a wall, and
     * the line is narrow: from there on it counts how many there are.
     */
    typing: (nomes: string[]): string => {
      if (nomes.length === 1) return `${nomes[0] ?? ""} está a escrever…`
      if (nomes.length === 2) return `${nomes[0] ?? ""} e ${nomes[1] ?? ""} estão a escrever…`
      if (nomes.length === 3) return `${nomes[0] ?? ""}, ${nomes[1] ?? ""} e ${nomes[2] ?? ""} estão a escrever…`
      return `${nomes.length} pessoas estão a escrever…`
    },

    /**
     * The marker of where you left off, and the shortcut to get there.
     *
     * "Por ler" and not "não lidas": it is what you say in Portuguese when you
     * come back to a conversation. The number comes first because it decides
     * whether scrolling up is worth it: one message you read from where you
     * are, seven you do not.
     */
    unreadMark: "por ler",
    unreadJump: (n: number): string =>
      n === 1 ? "1 mensagem por ler: ir para lá" : `${n} mensagens por ler: ir para lá`,

    imageAdd: "Anexar imagem",
    imageDrop: (nome: string): string => `Tirar ${nome}`,
    /** Images are compressed on this device, before they are encrypted. */
    imageCompressing: "a comprimir…",
    imagesFull: (n: number): string => `Só cabem ${n} imagens numa mensagem.`,
    /** A message's comfort cap (2000, as in Discord). See `MENSAGEM_MAX_CARACTERES`. */
    messageTooLong: (n: number): string => `A mensagem tem mais de ${n} caracteres. Encurta-a, ou divide-a em duas.`,
    /** The `@all` line in the mentions list. */
    mencionarTodos: "Toda a gente do canal",

    /**
     * Attaching a file that is not an image.
     *
     * "Ficheiro" and not "documento": a `zip` is not a document, and the broad
     * word is the one that leaves nobody out.
     */
    fileAdd: "Anexar ficheiro",
    fileDrop: (nome: string): string => `Tirar ${nome}`,
    filesFull: (n: number): string => `Só cabem ${n} ficheiros numa mensagem.`,
    /**
     * The refusal, WITH THE NUMBER.
     *
     * A file that is too big has to be refused before it goes out, and the
     * refusal has to say how much would fit, or the person tries again
     * blindly. The limit is not fixed: it shrinks with what the message
     * already carries, which is why it comes as an argument instead of being
     * written here.
     */
    fileTooBig: (nome: string, limite: string): string =>
      `${nome} não cabe nesta mensagem. O máximo é ${limite}. Com imagens ou texto já juntos, o máximo é menor.`,
    /** Nothing else fits, and it is not because of this particular file. */
    fileNoRoom: "Esta mensagem já não leva mais nada. Envia o que tens e junta o ficheiro à seguinte.",
    /** The file is there, and the disk will not let it be read. Not the message's fault. */
    fileUnreadable: "Não foi possível ler esse ficheiro neste aparelho.",
    fileReading: "a ler…",
    fileDownload: "Guardar",
    fileDownloadOf: (nome: string): string => `Guardar ${nome}`,
    /** The bytes stored here cannot be read. The attachment came corrupted. */
    fileBroken: "este anexo veio estragado e não se consegue guardar",
    /** The search is done by this device. Whoever reads never contacts the site. */
    linkPreviewAsk: "Pré-visualizar",
    linkPreviewDrop: "Não pré-visualizar este link",

    /**
     * The nudge, MSN style. Only in direct conversations.
     *
     * The countdown shows on the button itself: a button that stops responding
     * without saying why looks broken, and whoever presses it again cannot
     * tell whether the first one arrived.
     */
    buzz: "Cotovelada",
    /**
     * The composer's `+`, which gathers the three gestures that are not writing.
     *
     * At 390px the line burst with emojis, image, paperclip, nudge and the
     * text box. The wide box and the two everyday buttons stay; the rest is
     * now one click away.
     */
    moreActions: "Anexar ou abanar",
    /** The edited marker, next to the text. Short: the time goes in the tooltip. */
    editedMark: "(editada)",
    messageEdit: "Editar",
    messageEditLabel: "O que querias ter dito",
    messageEditSave: "Guardar",
    /* Said before saving, not discovered afterwards. */
    messageEditNote: "A mensagem fica marcada como editada. Quem já a leu viu a versão anterior.",
    messageDelete: "Apagar",
    /* The «⋯» that appears when hovering a message. Opens the menu the right
       click opens: without it, pinning, editing and deleting were only found
       by whoever knew about the right click. */
    messageMore: "Mais acções nesta mensagem",
    /**
     * What is said before deleting, and it is the whole truth.
     *
     * Deleting is a REQUEST to the other people's devices. It leaves the screen
     * of whoever honours it; whoever already read it, read it, and a modified
     * client ignores it. Promising deletion would be the easiest lie to tell
     * and the worst to discover.
     */
    messageDeleteTitle: "Apagar esta mensagem?",
    messageDeleteConfirm: "A mensagem sai da conversa. Apagar não desfaz o que alguém já leu.",
    /**
     * Deleting another person's message, with the `moderar` power (phase 3).
     *
     * «Eliminar» and not «Apagar»: it is another gesture, on what another
     * person said, and the line stays in place with the marker. The warning
     * sentence is phase 6's («uma frase no momento certo»), and it is the
     * whole truth.
     */
    messageModerate: "Eliminar",
    messageModerateTitle: (nome: string): string => `Eliminar a mensagem de ${nome}?`,
    messageModerateConfirm: "As apps dos membros escondem a mensagem. Quem já a leu, já a leu.",
    /* What stays in place of the text. */
    messageModerated: "Mensagem eliminada por moderação",
    /**
     * Pinning a message to the top of the room.
     *
     * "na sala" and not "no canal": you pin in the room where the message was
     * said, and a channel has several. It is the distinction the whole
     * interface defends, and the one a person needs to know where they will
     * find it again.
     */
    messagePin: "Fixar na sala",
    messageUnpin: "Desafixar",
    /**
     * What pinning does, said without overpromising.
     *
     * A copy of the text travels with the pin, which is why it can still be
     * read once the message has left the history, and by whoever joined the
     * channel later. Saying it here is what prevents the reading that pinning
     * keeps the message forever: it keeps the text, not the conversation
     * around it.
     */
    pinnedTitle: "Fixadas nesta sala",
    pinnedToggle: "Ver o que está fixado nesta sala",
    pinnedNote: "Uma mensagem fixada continua visível depois de sair do histórico.",
    /*
      Two sentences for the same emptiness, because they are two different people.

      Whoever can pin needs to know how to pin: without that, the sheet is a
      rectangle that announces a feature and does not say how to reach it. To
      whoever CANNOT, the same sentence would describe a door that does not
      exist (the rule the member panel footer already follows).
    */
    pinnedEmpty: "Nada fixado nesta sala.",
    pinnedEmptyCanPin: 'Nada fixado nesta sala. Abre o menu de uma mensagem e escolhe "Fixar na sala".',
    /** Who pinned it, on the bottom line of each pinned message. */
    pinnedBy: (nome: string): string => `fixada por ${nome}`,
    /** A message with no text: only images, or only files. */
    pinnedNoText: "(sem texto)",
    pinnedDone: "Mensagem fixada nesta sala.",
    pinnedUndone: "Mensagem desafixada.",
    /**
     * The marker in the corner of a pinned message.
     *
     * Only read aloud: what is seen is a twelve-pixel pin, and the pin says what
     * it is without words. Here the sentence has to give the same information
     * to whoever cannot see the icon, so it says where the message is pinned
     * and not only that it is.
     */
    pinnedMark: "Fixada nesta sala",
    buzzTitle: "Abana o ecrã da outra pessoa, com som.",
    buzzCounting: (segundos: number): string => `${segundos}s`,
    buzzWait: (segundos: number): string =>
      segundos === 1 ? "Podes dar outra dentro de 1 segundo" : `Podes dar outra dentro de ${segundos} segundos`,
    /**
     * The same, inside the `+` menu, and shorter on purpose.
     *
     * `buzzWait` is a full sentence because it lived in a tooltip read with the
     * mouse resting on it. In a list of options, a sentence like that pushes
     * its siblings and hides the gesture's name, and the name is what you look
     * for when opening the menu. Here it says what it is first, and how long is
     * left after.
     */
    buzzMenuWait: (segundos: number): string => `Cotovelada (${segundos} s)`,

    /**
     * Searching the conversation.
     *
     * **The sentence that must not be missing is the limit's**, and it is
     * `searchCeiling`. This device keeps a fixed number of messages per channel
     * and evicts the oldest for each one that arrives; what left is nowhere
     * this account can reach, because the server carries ciphertext and does
     * not keep it in the clear. A search that does not find what left is
     * indistinguishable from a message that never existed, and the conclusion a
     * person draws from that is about the other person. So the notice appears
     * WHENEVER the history is at the cap, not only when the search fails:
     * finding three out of five misleads in exactly the same way.
     *
     * "Neste aparelho" and not "no servidor" is the whole sentence in three
     * words: it says where the search happens without explaining how the
     * product works, which is the house rule for this phase.
     */
    searchToggle: "Procurar nesta conversa",
    searchPlaceholder: "Procurar",
    searchClear: "Limpar",
    searchHint: "Escreve para procurar nas mensagens deste canal.",
    searchEmpty: (termo: string): string => `Nada encontrado para "${termo}".`,
    searchCount: (n: number): string => (n === 1 ? "1 mensagem encontrada" : `${n} mensagens encontradas`),
    /** Above this the list stops being readable and becomes a wall. */
    searchMore: (mostradas: number, total: number): string =>
      `A mostrar as ${mostradas} mais recentes de ${total}. Escreve mais para afinar.`,
    searchScanned: (n: number): string =>
      n === 1 ? "Procurado em 1 mensagem guardada neste aparelho." : `Procurado em ${n} mensagens guardadas neste aparelho.`,
    searchCeiling:
      "A procura só encontra as mensagens guardadas neste aparelho.",
    /** The room the result came from, when it is not the open room. */
    searchInRoom: (sala: string): string => `em ${sala}`,
    /** The result takes the person to the message; the message lights up for a moment. */
    searchJump: "Ir para a mensagem",
    searchReading: "a ler…",
  },

  /**
   * The card on the first screen after creating the account. See `PrimeirosPassos`.
   * Says what there is to do, and does not explain the product.
   */
  primeirosPassos: {
    titulo: "Como chegar a alguém",
    corpo: "Para falar com alguém, dá o teu endereço, pede amizade ou entra com um link de convite.",
    copiar: "Copiar o teu endereço",
    copiado: "Endereço copiado. Dá-o a quem te quiser adicionar.",
    amigo: "Adicionar amigo",
    link: "Entrar com um link",
    fechar: "Fechar",
  },

  /**
   * The server's common channel, and how it introduces itself.
   *
   * The writing rule here is the same as in the rest of the file, and it is
   * tighter than it looks: none of this may promise what the product does not
   * deliver. "Selo" is a dangerous word: it suggests verification, and there
   * is no verification at all. What there is is a server pointing at a
   * channel, and the `seloTitle` text says exactly that, with the same
   * frankness with which `roles.note` separates what the encryption
   * guarantees from what clients agree among themselves.
   *
   * The seal went from word to symbol at the owner's request, and `seloTitle`
   * gained all the weight from it: it was the explanation next to a word that
   * already said half of it, and it became the whole explanation. Do not
   * shorten it.
   *
   * The introduction is an introduction and not a manual: it says where the
   * person is and invites them to take part. It does not explain how the
   * product works, does not list guarantees, and appears once.
   *
   * Welcome first, inform after. The first version opened with who gets in
   * here and how: true, but it was an admission rule serving as the front
   * door, and whoever arrives did not come to learn who else can arrive. That
   * the channel is public is still said, in one word, where it matters: right
   * after the welcome.
   */
  oficial: {
    /**
     * No longer seen on screen: it is the ACCESSIBLE name of the seal, which
     * became a symbol.
     *
     * It is not dead text, which is why it stays here instead of going. The
     * seal is a drawing today, and a drawing cannot be read to screen reader
     * users: deleting this word would delete the only way those people know the
     * channel is the common one. See `SeloOficial.tsx`, which puts it in the
     * `aria-label`.
     */
    selo: "oficial",
    /*
      The provenance AND the door, not just the provenance.

      This sentence said who points the channel and was silent about who gets
      in. That is the half that matters to whoever is writing: the common room
      is open to any account on this server by a decision taken (see
      `channel.groupinfo.take`, in `gateway.ts`, which says it in full), and
      the only place that showed it was a welcome card dismissed once and never
      seen again. Whoever arrived before it, or closed it three weeks ago, wrote
      in a public channel thinking it was their own.
    */
    seloTitle:
      "Canal comum deste servidor. Qualquer conta entra sem convite. Só o servidor pode dar este selo.",
    apresentacaoTitle: "Bem-vindo ao Orwell.",
    /*
      One line, and nothing more.

      It had three: the introduction, an invitation to write and a pointer to
      where to report faults. A welcome card with three paragraphs is required
      reading at the door of a conversation, and nobody does it: the first line
      is read and the card is closed. Owner's decision on 14 August 2026.
    */
    apresentacaoBody: "Este é o canal comum do servidor. Todas as contas o podem ler.",
    apresentacaoFechar: "Fechar",
  },

  /*
    The «anúncios» room of the official channel, which shows each version's
    notes instead of the conversation. Only the labels: the notes stay in
    Portuguese, because they come from `docs/novidades.json` (see
    `NotasDeVersao.tsx`). The sentence below takes the composer's place, for
    the reason in `chat-escrita-trancada`: a hole where the person looks for the
    box reads as a fault.
  */
  novidades: {
    titulo: "Release notes",
    soLeitura: "Esta sala é só para ler. Aqui ficam as release notes de cada versão.",
  },

  /*
    The badge of whoever brought a community to Orwell. Who gets it is the
    list in `lib/embaixadores.ts`, which ships with the app. The same sentence
    is the accessible name and the `title`: the drawing alone cannot be read.
  */
  embaixador: {
    selo: "Embaixador do Orwell",
  },

  members: {
    count: (n: number): string => (n === 1 ? "1 pessoa" : `${n} pessoas`),
    /* The drawer's name, for whoever listens to the screen. It only exists on a
       narrow screen, which is where this column becomes a panel over the conversation. */
    drawerLabel: "Pessoas",
    /* The headings of the list sorted by role. The dot separates without looking
       like a dialogue dash, and the count goes next to the title because it is
       the next question of whoever looks at a role: how many are there. */
    groupOnline: "Online",
    groupOffline: "Offline",
    groupHeading: (titulo: string, n: number): string => `${titulo} · ${n}`,
    loading: "A carregar…",
    empty: "Ainda ninguém aqui.",
    inviteSomeone: "Convidar…",
    /*
      The common channel's door, said in the list of who is already there.

      This list answers the question "who can read this", and in a common
      channel the answer is not the list: it is today's list plus any account
      on this server that connects tomorrow. Without this line, a list of four
      names reads as four people, and the footer with the two invite buttons
      teaches that the only way in is being invited.

      Outside the footer on purpose: inviting depends on a responsibility,
      knowing where you are depends on nothing.
    */
    openChannel: "Canal comum. Qualquer conta deste servidor entra sem convite e lê.",
    verifyHint: (name: string): string => `Verificar a segurança com ${name}`,
  },

  /**
   * The channel's roles, and the distinction that must not fail.
   *
   * Of all of them, only kicking has cryptographic weight: it takes the keys
   * from whoever leaves, and not even their client undoes that. The others are
   * agreements clients honour, and a modified client ignores them. Showing
   * them with the same face promised protection where there is only tidying.
   *
   * `eliminar` is the hardest to place on this side: it ends the channel for
   * everyone, which sounds like cryptography, and is not: it is the tombstone
   * honest clients honour. It stays where it belongs, among the agreements,
   * however grave its effect.
   *
   * **There are THREE registers and not two**, and this section said two. The
   * protocol asks two different questions and keeps them in two different
   * lists: `CRYPTOGRAPHIC_POWERS` asks what the encryption guarantees against a
   * modified client, and `IRREVERSIBLE_POWERS` asks what cannot be undone for
   * whoever honours it. `expulsar` is in both; `eliminar` only in the second:
   * it is a convention, and even so it has no inverse gesture. While the
   * interface had only two sentences, `eliminar` came out on the same line as
   * `mudar o nome`: "Combinado entre clientes: acabar com o canal, mudar o
   * nome." A list of two verbs where one undoes the channel for everyone and
   * the other is undone by typing again.
   */
  roles: {
    title: "Cargos",
    accessOnly: "Só acesso ao canal.",
    cryptographic: (list: string): string => `Garantido: ${list}.`,
    /**
     * The middle register: what clients only agree on, and still does not go
     * back.
     *
     * Today it is `eliminar` alone, and tomorrow it is whatever
     * `IRREVERSIBLE_POWERS` says: the sentence lists nothing on purpose, for
     * the reason written in `note`.
     *
     * "Não tem volta" and not "irreversível": the technical word is the one in
     * the protocol, and whoever is giving someone a role does not need to know
     * it to understand that it cannot be undone.
     */
    irreversible: (list: string): string => `Definitivo: ${list}.`,
    convention: (list: string): string => `Regra da app: ${list}.`,
    /* "As outras" and not the list spelled out: the list grew with `eliminar`
       and will grow again, and a sentence that lists them goes stale
       silently: saying a new responsibility is guaranteed by the encryption
       when it is not. */
    note: "Quem é expulso deixa de ler o canal. As outras regras dependem da app de cada pessoa.",
    /* The second half of the note, said apart so it can be drawn apart. Joined
       to the one above it made a three-sentence paragraph in grey 11px, which
       is the way to guarantee the third is not read. */
    noteFinal: "Acabar com o canal é definitivo. A app de cada membro apaga as mensagens do canal, mas uma app alterada pode guardá-las.",
    /* `dropHint` and `dropTitle` lived here, and later `give`, `givePick` and
       `giveTitle`. None is a loss: dragging died when roles left the people
       panel, and the picker that replaced it went with assignment to the
       person's profile: which is where you look at someone. Here the role is
       defined; there it is given. See `MemberRoles`. */
    assignElsewhere: "Dar um cargo a alguém faz-se no perfil dessa pessoa.",
    add: "Novo cargo",
    nameLabel: "Nome do cargo",
    namePlaceholder: "Moderador",
    sealedGroup: "Garantido",
    /* The middle group of the form. Same word as the list line: whoever ticks
       the box and whoever later reads the card have to recognise the same thing. */
    irreversibleGroup: "Definitivo",
    conventionGroup: "Regras da app",
    /* Said in the form and not only in the list: this is where the powers are given. */
    sealedNote: "A pessoa expulsa deixa de ler o canal.",
    irreversibleNote: "Não se pode desfazer.",
    conventionNote: "A app do Orwell cumpre estas regras. Uma app alterada pode não cumprir.",
    create: "Criar cargo",
    /* Editing a role that already exists. The identifier does not change, only
       the label and the responsibilities, which is why renaming does not unname. */
    edit: "Editar",
    editTitle: (role: string): string => `Editar o cargo ${role}`,
    /* Renaming in place, in the roles list (2/11/2026). */
    rename: "Mudar o nome",
    renameTitle: (role: string): string => `Mudar o nome do cargo ${role}`,
    renameLabel: (role: string): string => `Nome novo do cargo ${role}`,
    save: "Guardar",
    /* "Apagar o cargo", with the name: in a list of roles, a label that only
       says "Apagar" does not say what will disappear. */
    deleteLabel: "Apagar",
    deleteTitle: (role: string): string => `Apagar o cargo ${role}`,
    deleteNote: "Quem tinha este cargo perde os poderes dele. Ninguém é expulso.",
    powers: {
      expulsar: "expulsar",
      convidar: "convidar",
      renomear: "mudar o nome",
      mover: "mover",
      /* "acabar com o canal" and not "eliminar": in the middle of a list of short
         verbs, "eliminar" read as deleting a room or a person. What this
         responsibility gives is ending the whole channel, and whoever assigns
         it has to understand that without opening anything else. */
      eliminar: "acabar com o canal",
      /* "fixar mensagens" and not "fixar": alone, the verb reads as pinning the
         ROOM to the top of the list, which is something else that nobody asked
         for. The object is what says what the responsibility acts on. */
      fixar: "fixar mensagens",
      /* "atender tickets", and not just "atender": in a role, "atender" alone
         does not say handle what. It is the same reason "eliminar" became
         "acabar com o canal". */
      atender: "atender tickets",
      /* "moderar" alone, and the rest in the help sentence: the three things it
         gives (messages, closed tickets, nicknames) do not fit in a short verb. */
      moderar: "moderar",
      /* The 1.2 permissions model (§4 of the parity plan). */
      gerircargos: "gerir cargos",
      gerirsalas: "gerir salas",
      escrever: "escrever",
      anexar: "anexar ficheiros",
      reagir: "reagir",
      mencionartodos: "mencionar todos",
      ligar: "entrar na voz",
      falar: "falar",
      video: "ligar o vídeo",
      ecra: "partilhar o ecrã",
      musica: "pôr música",
      silenciarvoz: "calar na voz",
      ensurdecer: "ensurdecer",
      desligar: "desligar da chamada",
      prioridade: "prioridade na voz",
      banir: "banir",
      silenciar: "silenciar por um tempo",
      gerireventos: "gerir eventos",
      gerirregras: "gerir regras",
      gerirconvites: "gerir convites",
      verregisto: "ver o registo",
      apelidos: "mudar apelidos",
    } as Record<string, string>,
    /* The role's colour.
       Named in full, not only shown: the choice BETWEEN colours is the only
       thing on this screen the colour would have to communicate alone, and
       whoever cannot tell them apart would be choosing blindly. Everywhere the
       colour is GIVEN: in the people list, on the role card: it paints the
       role's name, which is written next to it and says everything without it. */
    colourLabel: "Cor",
    /* The normal case, so it is a choice in the row and not an absence of
       choice: a role without colour has to have somewhere to go back to no colour. */
    colourNone: "Sem cor",
    colourNoneTitle: "Sem cor. O cargo usa a cor da app.",
    colourTitle: (cor: string): string => `Cor ${cor}`,
    colourNames: {
      rosa: "Rosa",
      coral: "Coral",
      ambar: "Âmbar",
      lima: "Lima",
      menta: "Menta",
      turquesa: "Turquesa",
      ceu: "Céu",
      lilas: "Lilás",
      vermelho: "Vermelho",
      laranja: "Laranja",
      amarelo: "Amarelo",
      verde: "Verde",
      esmeralda: "Esmeralda",
      azul: "Azul",
      violeta: "Violeta",
      fucsia: "Fúcsia",
    } as Record<string, string>,
  },

  /**
   * A person's roles, on their profile.
   *
   * The title always names the channel, and it is not decoration: a role does
   * not exist outside a channel, and "Cargos" alone, on someone's profile,
   * would say the person is a moderator everywhere. When there is no channel
   * to speak of (the profile opened from the feed) the section does not
   * appear at all.
   */
  memberRoles: {
    title: (channel: string): string => `Cargos em ${channel}`,
    /**
     * The two halves of the list, and why the list is two.
     *
     * This screen's question is "what roles does this person have?", and the
     * answer was in a 13px square in the corner of four identical cards:
     * whoever wanted to know had to read the boxes one by one. Split, the
     * answer reads from the title, and what is left becomes what can be GIVEN
     * to them, which is the other question and deserves its own label.
     *
     * The number in the title and not only the lines: "Tem" with a list
     * underneath forces counting, and counting is not reading.
     */
    has: (n: number): string => (n === 1 ? "Tem 1 cargo" : `Tem ${n} cargos`),
    /* The other side. Only shown to whoever can give: for whoever cannot, the
       full list of the channel's labels in the middle of someone's profile is inventory. */
    available: "Pode receber",
    /* Someone with none, said in words. A title "Tem 0 cargos" with emptiness
       underneath reports nothing as if it were information. */
    none: "Sem cargos neste canal.",
    /** Whoever founded cannot be removed: it is a fact of the channel, not a role given. */
    founder: "Fundou este canal.",
    /** The built-in role. It is named and removed through the person's menu. */
    admin: "Administrador do canal.",
    /* Said to whoever can give roles: with no declared roles there is nothing to
       give, and the way to create them is not here. */
    noneDeclared: "Este canal ainda não tem cargos. Cria-os nas propriedades do canal.",
    founderLocked: "Não podes mudar os cargos de quem fundou o canal.",
  },

  /**
   * The roles editor with three tabs, the way Discord lays out a role.
   *
   * A new block, and not new keys in `roles`, on 27 October 2026: the owner's
   * request was «reorganiza o menu, tal e qual como no Discord», and the old
   * editor's text still serves the list cards and the profile.
   *
   * One sentence per responsibility, in STE100: the verb, the object, and the
   * effect when the effect changes the decision. Whoever gives a role reads
   * this at the moment of giving it, and opens nothing else.
   */
  /**
   * The `CargosEPermissoes` component (1.2, §4 of the parity plan): the order
   * of the roles, everyone's permissions and per-room permissions. Each
   * permission says what the encryption guarantees and what is only an app rule.
   */
  cargosEPermissoes: {
    titulo: "Cargos e permissões",
    ordemTitulo: "Ordem dos cargos",
    ordemNota: "O cargo de cima manda nos de baixo.",
    /** Only for whoever can reorder: the founder and the administration. */
    ordemComoMudar: "Arrasta um cargo, ou usa as setas, para mudar a ordem.",
    /** After dragging or an arrow key, for the screen reader. */
    posicaoNova: (cargo: string, lugar: number, total: number): string => `"${cargo}" está agora no lugar ${lugar} de ${total}.`,
    /** At the foot of the list, for whoever can reorder: what does not move and who sees it. */
    ordemFixa: "A administração fica sempre no topo. Todos no canal vêem esta ordem.",
    fundador: "Quem fundou o canal fica acima de todos os cargos.",
    subir: (cargo: string): string => `Subir o cargo ${cargo}`,
    descer: (cargo: string): string => `Descer o cargo ${cargo}`,
    arrastar: (cargo: string): string => `Arrastar o cargo ${cargo}`,
    abrir: (cargo: string): string => `Abrir o cargo ${cargo}`,
    novo: "Novo cargo",
    novoNome: "Nome do cargo novo",
    criar: "Criar",
    nome: (cargo: string): string => `Nome do cargo ${cargo}`,
    cor: (cargo: string): string => `Cor do cargo ${cargo}`,
    semCor: "Sem cor",
    apagar: (cargo: string): string => `Apagar o cargo ${cargo}`,
    permissoesDe: (cargo: string): string => `Permissões do cargo ${cargo}`,
    bloqueado: "Não podes mudar este cargo. Está ao nível do teu ou acima.",
    semPoder: "Não tens esta permissão, por isso não a podes dar.",
    implicada: (de: string): string => `Vem com "${de}".`,
    todosTitulo: "Toda a gente",
    todosNota: "O que todas as pessoas do canal podem, com ou sem cargo.",
    natureza: {
      cifra: "A cifra garante isto.",
      semVolta: "Regra da app. Não se pode desfazer.",
      combinado: "Regra da app. Uma app alterada pode não cumprir.",
    },
    sobreposicoesTitulo: "Permissões por sala",
    sobreposicoesNota:
      "Uma sala ou uma categoria pode dar ou tirar uma permissão a um cargo. É uma regra da app: a sala não tem chave própria, e quem está no canal pode ler todas as salas.",
    lugar: "Sala ou categoria",
    categoria: (nome: string): string => `Categoria ${nome}`,
    sala: (nome: string): string => `Sala ${nome}`,
    todos: "Toda a gente",
    estado: { herda: "Herda", da: "Dá", tira: "Tira" },
    estadoDe: (poder: string, cargo: string, lugar: string): string => `${poder} para ${cargo} em ${lugar}`,
    semLugares: "Este canal ainda não tem salas.",
    semPermissaoNoLugar: "Não podes mudar as permissões deste lugar.",
    delegacaoDesligada:
      "Só quem fundou o canal e a administração mudam cargos agora. Alguém no canal tem uma versão antiga da app.",
  },

  cargos: {
    listLabel: "Cargos do canal",
    tabsLabel: "Partes do cargo",
    tabAppearance: "Aparência",
    tabPermissions: "Permissões",
    tabMembers: "Membros",
    /* Back to the list without saving. "Cancelar" says the same and already
       exists; this is the label of the top button, which closes the open role. */
    back: "Todos os cargos",
    open: "Ver",
    openTitle: (role: string): string => `Ver o cargo ${role}`,
    /* The built-in role. It is not declared by the channel: it comes with it. */
    adminName: "Administrador",
    adminReadOnly: "Este cargo vem com o canal. Tem sempre todas as permissões e não se apaga.",
    /* Since 2/11/2026 the built-in role's name and colour can be changed. */
    adminAppearance: "Podes mudar o nome e a cor deste cargo. As permissões não mudam.",
    /* Only the founder reads it. Since phase 3 the founder creates the
       administration roles with the powers they choose (moderar included); the
       built-in one still has everything, and the sentence gives the way to grant only part. */
    adminWarning: "Este cargo tem tudo. Para dar só uma parte, cria um cargo novo e escolhe as permissões.",
    previewLabel: "Pré-visualização",
    previewNote: "Assim aparece o cargo na lista de membros.",
    /* The preview's sample name. A name and not an address: the member list
       shows names. */
    previewPerson: "Ana",
    groups: {
      gerir: "Gerir canal",
      membros: "Membros",
      mensagens: "Mensagens",
      voz: "Voz",
      /* A responsibility that a future version adds and this one does not know
         how to place. It shows here instead of disappearing. */
      outras: "Outras",
    } as Record<string, string>,
    powerHelp: {
      expulsar: "Tirar uma pessoa do canal. A pessoa deixa de ler as mensagens novas.",
      convidar: "Trazer pessoas novas para o canal.",
      renomear: "Mudar o nome do canal e arrumar as salas e as categorias.",
      mover: "Mover uma pessoa de uma sala de voz para outra.",
      eliminar: "Acabar com o canal para todos os membros. Não se pode desfazer.",
      fixar: "Fixar e desafixar mensagens no topo de uma sala.",
      atender: "Tomar tickets, mudar o estado deles e fechá-los.",
      moderar: "Eliminar mensagens de outras pessoas, eliminar tickets fechados e mudar apelidos.",
      gerircargos: "Criar, mudar e dar os cargos abaixo do seu. Nunca dá mais do que tem.",
      gerirsalas: "Criar e arrumar salas e categorias, e as permissões delas.",
      escrever: "Escrever mensagens nas salas.",
      anexar: "Anexar ficheiros às mensagens.",
      reagir: "Reagir às mensagens.",
      mencionartodos: "Escrever @all para mencionar toda a gente do canal. Numa sala silenciada, @all não avisa.",
      ligar: "Entrar nas salas de voz.",
      falar: "Falar numa sala de voz.",
      video: "Ligar a câmara numa sala de voz.",
      ecra: "Partilhar o ecrã numa sala de voz.",
      musica: "Pôr música numa sala de voz.",
      silenciarvoz: "Calar o microfone de outra pessoa na voz.",
      ensurdecer: "Tirar o som a outra pessoa na voz.",
      desligar: "Tirar uma pessoa da chamada de voz.",
      prioridade: "Falar por cima dos outros na voz.",
      banir: "Tirar uma pessoa do canal e não a deixar voltar.",
      silenciar: "Calar uma pessoa no canal durante um tempo.",
      gerireventos: "Criar e mudar os eventos do canal.",
      gerirregras: "Criar e mudar as regras automáticas do canal.",
      gerirconvites: "Ver, pausar e apagar os convites do canal.",
      verregisto: "Ler o registo do que os cargos fizeram.",
      apelidos: "Mudar o apelido de outras pessoas neste canal.",
    } as Record<string, string>,
    /* The members with this role. */
    membersCount: (n: number): string => (n === 1 ? "1 membro" : `${n} membros`),
    membersNone: "Ninguém tem este cargo.",
    addMembers: "Adicionar membros",
    addMember: "Adicionar",
    addMemberTitle: (name: string): string => `Dar este cargo a ${name}`,
    removeMember: "Tirar",
    removeMemberTitle: (name: string): string => `Tirar este cargo a ${name}`,
    candidatesNone: "Todos os membros já têm este cargo.",
    doneAdding: "Concluído",
    /* The door to where assignment lives while this sheet does not take it. */
    membersElsewhere: "Para dar ou tirar este cargo, abre o perfil da pessoa na lista de membros.",
    membersNew: "Cria o cargo primeiro. Depois podes dá-lo a membros.",
    membersAdmin: "O administrador nomeia-se e destitui-se no menu da pessoa.",
  },

  verify: {
    title: "Verificar segurança",
    note: "Compara este número com a outra pessoa por voz ou em pessoa. Se for igual, a ligação é segura.",
    unavailable: "Não foi possível verificar esta pessoa agora.",
  },

  call: {
    waiting: "à espera que alguém entre",
    people: (n: number): string => `${n} ${n === 1 ? "pessoa" : "pessoas"}`,
    micOn: "Ligar microfone",
    micOff: "Desligar microfone",
    cameraOn: "Ligar câmara",
    cameraOff: "Desligar câmara",
    soundOn: "Ligar o som",
    soundOff: "Desligar o som",
    /**
     * Sharing the screen: the action, both ways.
     *
     * Two sentences and not one with "Parar" stuck in front: what you read in a
     * tooltip is what will happen if you click, and "Partilhar ecrã" with the
     * button lit read as "you are already sharing".
     */
    shareScreen: "Partilhar ecrã",
    stopScreen: "Parar de partilhar",
    /**
     * The same, for whoever listens to the screen, with the state before the action.
     *
     * Same rule as `micAria`: it starts with the word on the button, so voice
     * control users can ask for the button by the name they see.
     */
    screenAria: (sharing: boolean): string =>
      sharing ? "A partilhar ecrã. Parar de partilhar." : "Partilhar ecrã.",
    /**
     * Why the share button is not there.
     *
     * Two reasons, and both are physical. A missing button with no explanation
     * is what makes someone search Settings for an option that does not exist.
     */
    shareScreenBySfu: "Nesta chamada só passa voz.",
    /**
     * The cap on people.
     *
     * In the mesh what bursts is the UPLOAD of whoever shares; with a media
     * server it is the SERVER's output. Since the STE100 review of 20/10/2026
     * the sentence says only the limit, which is true in both cases, and
     * `porServidor` stays in the signature for its callers.
     */
    shareScreenByPeople: (limite: number, _porServidor = false): string =>
      `Com ${limite} ou mais pessoas na chamada, não é possível partilhar o ecrã.`,
    /**
     * Who is sharing, next to the name.
     *
     * The marker appears in a list of people and in an image label, and an
     * accessible name that does not say whose it is forces counting lines to
     * find out. It is the same decision as `micOffOf`, for the same reason.
     */
    sharingOf: (name: string): string => `${name} está a partilhar o ecrã`,
    /** The stage label: whose screen that is. */
    screenOf: (name: string): string => `Ecrã de ${name}`,
    /** Our own screen on the stage. Nobody says "ecrã de Eu". */
    screenSelf: "O teu ecrã",
    /**
     * The screen audio of whoever is sharing, on the stage: its own volume,
     * separate from that person's voice volume (it is music or system sound,
     * not the voice).
     */
    screenSoundVolume: "Volume do som do ecrã",
    /** The share stage in full screen (owner's request, 2/11/2026). Also with double click; Esc exits. */
    ecraInteiro: "Ver em ecrã inteiro",
    sairDoEcraInteiro: "Sair do ecrã inteiro",
    /** The sign for whoever shares: the system sound is going out. */
    screenSoundSharing: "A partilhar o som do sistema",
    /** The sign, with the sound muted by whoever shares. */
    screenSoundMutedSelf: "O som do sistema está calado",
    /** The gesture next to «Parar de partilhar». It renegotiates nothing. */
    screenSoundMute: "Calar o som do ecrã",
    screenSoundUnmute: "Ligar o som do ecrã",
    /**
     * The invitation to watch someone's screen, and the way out of it.
     *
     * Owner's request on 5 October 2026: *when someone shares their screen, the
     * others should join the stream only if they want to.* Until then the stage
     * opened by itself and took 2.5 Mbps with it, without anyone choosing
     * anything.
     *
     * «Ver» and not «Aceitar»: it is not a request for permission addressed to
     * the reader, it is something that is there and can be looked at. And
     * «Parar de ver» and not «Recusar», for the same reason seen from the other
     * side.
     */
    screenWatch: "Ver",
    screenStopWatching: "Parar de ver",
    /** The accessible name of both buttons: a «Ver» alone does not say watch what. */
    screenWatchAria: (name: string): string => `Ver o ecrã de ${name}`,
    screenStopWatchingAria: (name: string): string => `Parar de ver o ecrã de ${name}`,
    /**
     * How many are watching our screen.
     *
     * The symmetric gap of the request, and of the same piece: whoever shares
     * did not know who is watching. Once the choice exists it became
     * information that is really missing; before this everyone watched, and
     * the number said nothing.
     *
     * Zero is said, not hidden: sharing a screen nobody is watching is exactly
     * what you want to know before talking to it for ten minutes.
     */
    screenViewers: (n: number): string =>
      n === 0 ? "Ninguém a ver" : n === 1 ? "1 a ver" : `${n} a ver`,
    /**
     * The card of whoever shares the screen («A com a C», chosen by the owner
     * on 2 November 2026): the seal, and the invitation that appears on hover.
     * Upper case in the text, not only in the CSS, so the screen reader says
     * the same as what is seen.
     */
    aoVivo: "AO VIVO",
    verATransmissao: "Ver a transmissão",
    /** The accessible name starts with what is read on the button (see `screenWatchAria`). */
    verATransmissaoDe: (name: string): string => `Ver a transmissão de ${name}`,
    /**
     * State and action together, for whoever listens to the screen.
     *
     * It starts with the visible word, exactly as it is written on the button:
     * an accessible name that does not contain the visible label leaves voice
     * control users asking for a button the computer does not recognise. That
     * is why it says "Silenciado. Ligar microfone." and not "Microfone
     * silenciado": the second version looks better written and breaks the rule.
     */
    micAria: (muted: boolean): string =>
      muted ? "Silenciado. Ligar microfone." : "Microfone ligado. Desligar microfone.",
    soundAria: (off: boolean): string =>
      off ? "Sem som. Ligar o som." : "Som ligado. Desligar o som.",
    /** Why the microphone is muted without anyone touching it. */
    micBySound: "Silenciado porque o som está desligado",
    /**
     * This person's video is going out smaller than they chose.
     *
     * **It exists because the drop was silent.** The browser lowers the
     * resolution by itself when the upload is not enough, and without a line
     * saying so the person appears to others at 360p with the menu saying
     * 720p. What they conclude is that the product is bad, not that their
     * network is bad: the wrong conclusion, and the one silence guarantees.
     *
     * **It says the CAUSE and not the remedy.** "Melhora a tua ligação" would be
     * giving an order to someone on a train who can do nothing with it; "a
     * rede não dá mais" is physics, and what to do with it is the reader's
     * decision.
     *
     * **Without the line count.** Removed in the STE100 review of 20/10/2026:
     * «linhas» and «máquina» are jargon. The height stays in the signature.
     */
    videoLimitado: (razao: "bandwidth" | "cpu", _altura: number): string =>
      razao === "bandwidth" ? "imagem reduzida: rede lenta" : "imagem reduzida: aparelho lento",
    /**
     * The arrows next to each icon, on the account card.
     *
     * Named by what they open and not by their shape: "seta para cima" tells
     * whoever listens to the screen the button's drawing, which is the only
     * thing that person does not need to know.
     */
    micOptions: "Opções de microfone",
    soundOptions: "Opções de som",
    /** The microphone the system picks for us. See `inputDeviceUnnamed`. */
    inputDeviceDefault: "O que o sistema escolher",
    /**
     * Before there is permission, the names come back empty.
     *
     * `enumerateDevices` always answers, but only labels the devices after
     * someone has granted microphone access once: before that the list exists
     * and is unreadable, and a list of "Microfone 1, Microfone 2" helps nobody
     * choose. It says what is missing instead of showing it like that.
     */
    inputDevicesLocked: "Os microfones só aparecem pelo nome depois de dares acesso ao microfone uma vez.",
    inputDevicesNone: "Nenhum microfone encontrado.",
    /** When the names cannot be read yet: leads to where the choice can be made. */
    inputDevicePick: "Escolher microfone…",
    inputVolume: "Volume de entrada…",
    notificationVolume: "Volume dos sons…",
    audioSettings: "Definições de áudio…",
    leave: "Sair da chamada",
    popOut: "Abrir numa janela",
    self: "tu",
    selfFallback: "Tu",
    connected: "ligado",
    /*
      "A ligar" only where something really is connecting.

      In a mesh call there is: two computers negotiating a direct connection,
      and this sentence describes it. In an SFU call nothing is connecting with
      that person: the connection is to the server, and it is already made. The
      four sentences below are the other three states this one covered alone.
      See `lib/estadoDaChamada.ts`, where the decision rule lives.
    */
    connecting: "a ligar…",
    /** SFU, within the deadline: they are there, it is their audio that has not arrived yet. */
    naChamadaSemSom: "na chamada, sem som ainda",
    /*
      SFU, past the deadline. It does not claim a cause because there is more
      than one (they may be on another media path, their producer may have
      failed), and claiming the wrong one is worse than saying what is seen.
      What is seen is this.
    */
    semSomHaMuito: "na chamada, mas o som não chega aqui",
    /** Mesh, past the deadline: here the connection really existed, and was not made. */
    semLigacao: "não foi possível ligar a esta pessoa",
    silenced: "silenciado por ti",
    /**
     * THEIR CHOICE not to speak: the opposite of `silenced`, which is our
     * choice not to hear them.
     *
     * Two sentences because they are two opposite facts, and the screen shows
     * them in the same place. "Silenciado" alone does not tell the two apart,
     * and the person who turned someone's volume down ended up thinking that
     * person had gone quiet, or worse, the reverse: waiting for an answer from
     * someone with the microphone off, convinced it was they who had silenced
     * them.
     *
     * Says the name because the marker appears in a list of people, and an
     * accessible name that does not say whose it is forces counting lines to
     * find out.
     */
    micOffOf: (name: string): string => `${name} calou o próprio microfone`,
    /**
     * The other silence, now also with a drawing: it was US who set this
     * person's volume to zero. Says whose gesture it is and where it is undone,
     * because whoever did it a week ago no longer remembers.
     */
    silencedByYouOf: (name: string): string => `Silenciaste ${name}: tens o volume desta pessoa a zero`,
    volumeOf: (label: string): string => `Volume de ${label}`,
    /* The person's menu on the call card (phase 3): the call block. */
    menuSection: "Nesta chamada",
    menuSilence: "Silenciar para mim",
    menuUnsilence: "Voltar a ouvir",
    menuVolume: "Volume",
    menuVolumeValor: (pct: number): string => `${pct} %`,
    menuVolumeRepor: "Repor o volume normal, 100 %",
    /* The card's «⋯», with the name: there is one per person. */
    personMenu: (label: string): string => `Mais acções sobre ${label}`,
  /*
    The call notices: what the log said and the screen kept quiet.

    The core emits diagnostics with their own names, and the shell wrote them
    all to the Diagnostics log and nothing else. For the mechanics that is
    right. For these three it is wrong, because they describe a call that is
    not going to work.

    See `lib/estadoDaChamada.ts` for which go in and which stay out.
  */
    /*
      The fault `call.ts` documents and the interface did not mention.

      Two people in the same room can be on different media paths, one through
      the SFU and the other through the mesh, and never hear each other. The
      offer that arrives on the wrong path is ignored and leaves a line in the
      log; on the other side it reads "a ligar" until the person gives up.

      The sentence says what is known and what can be done, and nothing more.
      It does not say to switch browsers because it is not always the browser:
      it can be the server without an SFU, or this environment without media
      encryption.
    */
    avisoCaminhosDiferentesDe: (nome: string): string => `Tu e ${nome} não se ouvem. Saiam os dois da chamada e voltem a entrar.`,
    avisoCaminhosDiferentes:
      "Uma pessoa nesta chamada não te ouve. Saiam os dois da chamada e voltem a entrar.",
    /** The SFU join failed and the whole call was dropped. */
    avisoEntradaFalhou:
      "A chamada não começou. Tenta outra vez. Se voltar a falhar, copia o registo em Configurações, Diagnóstico.",
    /** The connection dropped and the call is joining again (1.3.7). A note: the call goes on. */
    avisoARelegar: "A ligação caiu. A chamada está a voltar a ligar.",
    /** Someone who disappeared without hanging up. A note, not a fault: the call goes on. */
    avisoPresencaCaducouDe: (nome: string): string => `${nome} perdeu a ligação e saiu da chamada.`,
    avisoPresencaCaducou: "Uma pessoa perdeu a ligação e saiu da chamada.",
    /** Close the notice. It stays written in the log anyway. */
    avisoFechar: "Fechar o aviso",
    /* The Discord-style call window (visual phase, agent H). */
    vistaAria: (sala: string): string => `Chamada em ${sala}`,
    pessoasNaChamada: "Pessoas na chamada",
    controlos: "Controlo da chamada",
    soPalco: "Ver só o palco",
    conversaDaSala: "Conversa da sala",
    focoAria: (nome: string): string => `${nome}, em foco`,
  },

  /**
   * Screen sharing in the installed application: choosing what, and the permission.
   *
   * None of this exists in the browser. There Chrome brings its own picker and
   * handles the permission by itself; here the picker is ours, because
   * without it Electron's `getDisplayMedia` falls into a request nobody
   * answers. See `apps/client/src/main/ecra.ts`, where the decision lives.
   */
  ecra: {
    /** The picker: the title says the choice, not the mechanism. */
    escolherTitulo: "Escolher o que partilhar",
    escolherLead: "Quem está na chamada passa a ver isto até parares a partilha.",
    /**
     * The two groups, because they are two different things.
     *
     * A whole screen shows everything on it, including whatever appears next;
     * a window shows one application and nothing else. Whoever chooses has to
     * know which of the two they are choosing, so the list is never a single one.
     */
    ecras: "Ecrãs",
    janelas: "Janelas",
    /** The notice that separates the two groups from what the choice costs. */
    ecraInteiroNota: "Um ecrã inteiro mostra tudo o que lá aparecer, avisos do sistema incluídos.",
    /** macOS returns windows without a title. A list with holes is worse. */
    semNome: "Janela sem nome",
    aCarregar: "A procurar o que há para partilhar…",
    vazio: "Não há nada para partilhar neste momento.",
    /** For whoever listens to the screen: the button is a choice, and says what it chooses. */
    escolherAria: (nome: string): string => `Partilhar ${nome}`,
    /** The DJ's «só som» mode (2/11/2026): the window is chosen, and only the audio goes. */
    escolherSomTitulo: "De onde vem o som",
    escolherSomLead: "Os outros ouvem o som. Não vêem a janela.",
    escolherSomAria: (nome: string): string => `Partilhar o som de ${nome}`,
    /**
     * The system sound in the application, in one line and without a checkbox.
     *
     * The system sound is everything the computer plays: music, notifications,
     * and the call's own voice. It goes ALWAYS when the system provides it,
     * without a checkbox: owner's request on 2/11/2026. This line only informs,
     * and says how to mute it.
     */
    somDoSistemaNota:
      'O som do sistema vai com o ecrã. Este som inclui a voz da chamada, e os outros podem ouvir-se com atraso. Para o calar, carrega em "Calar o som do ecrã" na chamada.',

    /**
     * The macOS sheet, when the system no longer asks.
     *
     * It only appears on `denied` or `restricted`: on `not-determined` macOS
     * still opens its own dialog, and a sheet of ours on top would be the
     * application explaining what the system is asking at the same time. See
     * `permissaoDeEcra`.
     */
    permissaoTitulo: "O macOS não está a deixar gravar o ecrã",
    /**
     * WHOSE permission it is, said before everything else.
     *
     * It belongs to the system and not the application, and whoever does not
     * know that will look for it in Orwell's Settings, where it never was and
     * cannot be. The sentence starts there on purpose: without that framing,
     * the button that opens System Settings looks like a shortcut to an option
     * of ours.
     */
    permissaoCorpo:
      "Abre as Definições do macOS, Privacidade e Segurança, Gravação do Ecrã, e liga o Orwell. Sem isto, não podes partilhar o ecrã.",
    /**
     * The line that cannot be left out.
     *
     * macOS only hands the capture to a process that started AFTER the
     * permission existed. Without this sentence, the person grants the
     * permission, goes back to the application, clicks again and it still does
     * not work, and the conclusion they draw is that the product is broken. It
     * is the system's and cannot be worked around: it is said, instead of
     * pretending the button solves everything.
     */
    permissaoReiniciar:
      "Depois, fecha o Orwell e abre-o outra vez.",
    permissaoAbrir: "Abrir as Definições",
  },

  social: {
    title: "Publicações",
    sealed: "Só amigos",
    sealedTitle: "Só os teus amigos vêem as tuas publicações.",
    placeholder: "Escreve uma publicação. Só os teus amigos a vêem.",
    titlePlaceholder: "Título (opcional)",
    /*
      The two sentences that were here ("Essa imagem é um monstro (máx. 3 MB)"
      and "máx. 6 MB de imagens por post") went away with the numbers that
      justified them. They measured the file AS IT COMES IN, and from the day
      the post started compressing images before encrypting them that stopped
      meaning anything: a 4K screenshot comes in at twelve megabytes and goes
      out at three hundred kilobytes. Refusing it at the door was refusing the
      only thing people paste.

      What took their place measures what really goes on the wire (see
      `bytesQueAindaCabem`) and counts the images already there.
    */
    imagesFull: (n: number): string => `Só cabem ${n} imagens numa publicação.`,
    imagesNoRoom: "Esta publicação já não leva mais imagens. Publica o que tens e junta a imagem a outra.",

    /**
     * Attaching files to a post.
     *
     * The same sentences as the conversation, with a difference that is not
     * about style: here it says "publicação" and not "mensagem", because that
     * is what the person is doing and the cap is on what they are composing.
     */
    fileAdd: "Anexar ficheiro",
    fileDrop: (nome: string): string => `Tirar ${nome}`,
    filesFull: (n: number): string => `Só cabem ${n} ficheiros numa publicação.`,
    fileTooBig: (nome: string, limite: string): string =>
      `${nome} não cabe nesta publicação. O máximo é ${limite}. Com imagens ou texto já juntos, o máximo é menor.`,
    fileNoRoom: "Esta publicação já não leva mais nada. Publica o que tens e junta o ficheiro a outra.",
    fileUnreadable: "Não foi possível ler esse ficheiro neste aparelho.",
    /**
     * A post's video. One per post, without transcoding: it goes as it came, up
     * to the protocol's cap. See `lib/videos.ts`.
     */
    attachVideo: "Anexar vídeo",
    recordVideo: "Gravar vídeo",
    videoOnlyOne: "Uma publicação leva só um vídeo. Tira o vídeo do rascunho para escolher outro.",
    videoReading: "A ler o vídeo…",
    videoDrop: (nome: string): string => `Tirar ${nome}`,
    videoSending: (feitas: number, de: number): string => `A enviar o vídeo: parte ${feitas} de ${de}.`,
    videoSendCancel: "Cancelar o envio",
    videoOnlyThisSession: "Este vídeo é grande demais para o cofre deste aparelho. Fica só nesta sessão até alguém o pedir.",
    videoPlay: (nome: string, duracao: string): string => `Ver o vídeo ${nome} (${duracao})`,
    videoReceiving: (feitas: number, de: number): string => `O vídeo está a chegar: parte ${feitas} de ${de}.`,
    videoNotHere: "O vídeo não está neste aparelho.",
    videoAsking: "A pedir o vídeo…",
    videoNobody: "Nenhum membro com este vídeo está ligado agora. Tenta mais tarde.",
    videoFailed: "O vídeo chegou com erros. Pede-o outra vez.",
    videoCannotPlay: "Este aparelho não consegue mostrar este vídeo.",
    attachImage: "Anexar imagem",
    addLink: "Adicionar link",
    image: "Imagem",
    link: "Link",
    ctrlEnter: "Ctrl+Enter publica",
    publishing: "a publicar…",
    publish: "Publicar",
    emptyTitle: "Ainda não há publicações.",
    emptyBody: "Publica alguma coisa ou adiciona um amigo. As publicações dos teus amigos aparecem aqui.",
    /* Follows the circle and does not read anything yet. What to do next stays;
       the explanation of why, which was the model talking, went out. */
    emptyCircleTitle: "Ainda não há nada para ler.",
    emptyCircleBody: (people: number): string =>
      `${people === 1 ? "Tens 1 amigo" : `Tens ${people} amigos`}. Ainda não chegou nenhuma publicação. As novas aparecem aqui.`,
    emptyTagTitle: (tag: string): string => `Nada com #${tag}.`,
    emptyTagBody: "Nenhuma publicação tem esta tag.",
    support: "Apoiar",
    /** Title on a tag pill: what clicking it does. */
    filterByTag: (tag: string): string => `Ver só #${tag}`,
    /** The dismissible chip while a tag filter is on. */
    filterChip: (tag: string): string => `A mostrar só #${tag}: clica para veres tudo`,
    filterClear: "Mostrar tudo",
    /** Faint lead-in for the would-be tags under the composer. */
    tagPreview: "vai com",
    viewImage: "Ver maior",
    imageFallbackName: "Imagem",
    /**
     * The open post's carousel: one photo at a time.
     *
     * The position is said in words and not only by the dots. The dots are a
     * three-pixel figure that whoever listens to the screen does not get and
     * whoever sees poorly cannot count; the sentence is the same information
     * said to everyone.
     */
    imagePrev: "Fotografia anterior",
    imageNext: "Fotografia seguinte",
    imageAt: (n: number, total: number): string => `Fotografia ${n} de ${total}`,
    imageGo: (n: number): string => `Ver a fotografia ${n}`,
    copyAuthor: "Copiar endereço",
    authorCopied: "endereço copiado",
    postMenu: "Opções da publicação",
    edit: "Editar",
    editingChip: "A editar a publicação: só a legenda muda.",
    editCancel: "Cancelar",
    save: "Guardar",
    deleteAction: "Apagar",
    deleteTitle: "Apagar a publicação?",
    deleteConfirm: "Os teus amigos deixam de a ver. Apagar não desfaz o que alguém já leu.",
    deleted: "publicação apagada",
    /** The edit disclaimer, always visible: readers deserve to know. */
    edited: (when: string): string => `editada a ${when}`,

    /** Likes and dislikes. The vote belongs to whoever gives it, and you can see which was yours. */
    like: "Gosto",
    likeUndo: "Retirar o gosto",
    dislike: "Não gosto",
    dislikeUndo: "Retirar o não gosto",
    /** With none, it is «Comentários» and not «Comentar»: the send button is
     * already called that, and two buttons with the same name on the same card
     * cannot be told apart, much less by whoever hears them instead of seeing them. */
    commentsToggle: (n: number): string =>
      n === 0 ? "Comentários" : n === 1 ? "1 comentário" : `${n} comentários`,
    commentsEmpty: "Ainda ninguém comentou. Escreve o primeiro aqui em baixo.",
    commentPlaceholder: "Escrever um comentário…",
    commentSend: "Comentar",
    voteFailed: "não foi possível registar o voto",
    commentFailed: "não foi possível comentar",
    /** Delete one of our comments. Only shown on ours: a button that refuses
     * the click teaches badly who is in charge of what. */
    commentDelete: "Apagar o comentário",
    commentDeleteTitle: "Apagar o comentário?",
    commentDeleteConfirm: "O comentário sai da publicação. Apagar não desfaz o que alguém já leu.",
    commentDeleted: "comentário apagado",
    commentDeleteFailed: "não foi possível apagar o comentário",

    /** Names for a post with no words at all. */
    untitled: "Publicação",
    untitledPhoto: "Fotografia",
    untitledLink: "Link",
  },

  people: {
    /* The destination's name, said a third time: it is the strip's `h1`. See `rail`.
       The screen below it already talked about friends ("Ainda não tens amigos
       aqui"), and it was the title that said something else. */
    title: "Amigos",
    sealed: "só neste aparelho",
    sealedTitle:
      "Esta lista fica só nos teus aparelhos. O servidor não sabe quem são os teus amigos.",
    searchPlaceholder: "Procurar por nome, estado ou endereço…",
    noMatch: (query: string): string => `Nada para "${query}".`,
    /**
     * The answer to a search, which is not the same as an invitation.
     *
     * This used to carry `emptyBody` underneath: the text for someone who does
     * not know anyone yet, explaining there is no global search. Said to
     * someone who just typed a name in the box, it was a lesson instead of an
     * answer: the question was "is Manuel here?" and the application answered
     * with the account discovery model.
     *
     * A search with no results is a small, closed fact. It says where it
     * searched, so the zero means something, and gives the list back.
     */
    noMatchBody: (n: number): string =>
      n === 1
        ? "Procurado no único amigo desta lista, por nome, estado e endereço."
        : `Procurado nos ${n} amigos desta lista, por nome, estado e endereço.`,
    noMatchAction: "Ver todos",
    emptyTitle: "Ainda não há ninguém aqui.",
    emptyBody:
      "Os perfis aparecem quando entras em canais ou adicionas amigos.",
    /**
     * The emptiness of someone who knows people and has no friends.
     *
     * It stopped being a rare case the day there was a channel where everyone
     * is: the vault fills with profiles on the first connection and none of
     * them is a friend. Without a word, the screen stayed blank under the title
     * "Amigos", which is indistinguishable from being broken.
     */
    noFriendsTitle: "Ainda não tens amigos aqui.",
    noFriendsBody: (n: number): string =>
      `Conheces ${n === 1 ? "uma pessoa" : `${n} pessoas`} dos teus canais. Para serem amigos, pede amizade. A outra pessoa tem de aceitar.`,
    copyAddress: "Copiar endereço",
    addressCopied: "endereço copiado",
    requestsTitle: "Pedidos",
    accept: "Aceitar",
    accepted: "aceite. Essa pessoa passa a ver o que publicas",
    // There was a family of strings here for membership diagnostics: "amizade
    // a meio", "o convite já não abria", and a "Reparar" button beside them.
    // They are gone with the button: reconciliation is the system's job, runs
    // on every connect, and asking a person to repair their own membership was
    // an admission that it did not work. Copy only earns a place on screen if
    // a person can act on it or needs it to trust what they are looking at.
    presence: "online",
    presenceIdle: "offline",
    presenceBusy: "ocupado",
    /** Fallback, for servers without live presence: derived and local. */
    presenceTitle:
      "Verde: esta pessoa esteve activa nos últimos 10 minutos.",
    /** The live truth, shown when the server advertises presence. */
    presenceTitleLive:
      "Verde: online agora. Os teus canais também vêem quando estás online.",
    friendsTitle: "Contactos",

    /**
     * Friendship became mutual, and the copy has to say so.
     *
     * "Quer que o sigas" described what there was: a permission in one
     * direction, and a second act on the other side for the other direction.
     * Now an accepted request makes both halves, and calling it following
     * would misdescribe what the button does, which is the only thing a
     * caption like this has to get right.
     */
    wantsToBeFriends: (name: string): string => `${name} quer ser teu amigo`,
    /**
     * The card's status line, when whoever asked wrote nothing.
     *
     * The card lives in the conversation and stays up while the request is
     * open. A silent card is indistinguishable from a fault, so there is
     * always a line: either the requester's note, or this one.
     */
    requestWaits: "À espera da tua resposta.",
    /** Our own request, seen from the conversation: no buttons, but with a sign. */
    requestSent: (name: string): string => `Pediste amizade a ${name}`,
    requestSentWait: "À espera da resposta dessa pessoa.",
    /**
     * The locked composer, and the three reasons it is locked.
     *
     * The composer does not disappear: it stays in place, silent, saying what
     * is missing. Taking it off the screen left a hole where the person looked
     * for the box and did not find it, which reads as a fault and not as a
     * rule. See `escritaNaDirecta`.
     */
    escritaEspera: "Só podem trocar mensagens depois de o pedido ser aceite.",
    escritaAceitaPrimeiro: "Aceita o pedido de amizade para poderem trocar mensagens.",
    escritaSemAmizade: "As mensagens privadas são entre amigos. Pede amizade para poderem falar.",
    decline: "Recusar",
    declined: "pedido recusado",
    accepting: "a aceitar…",
    /** What accepting does, said both ways because it works both ways. */
    acceptedMutual: (name: string): string => `${name} é teu amigo`,
    /**
     * The interval in which the friendship is made on one side only.
     *
     * Whoever accepted has already given their place; the place back depends
     * on the requester's device, which may be offline. Saying it is the honest
     * alternative to pretending it is already complete, and what is asked of
     * the reader is not to do anything, just not to be surprised.
     */
    acceptedPending: (name: string): string =>
      `${name} já vê o que publicas. Vais ver as publicações de ${name} quando estiver online.`,
    /* ------------------------------------------------- the "Amigos" destination */
    asideLabel: "Amigos e conversas",
    tabsLabel: "Separadores de Amigos",
    /** The strip's title, with how many friends there are. */
    titleCount: (n: number): string => `Amigos (${n})`,
    /*
      The list tab says «Todos», and not «Amigos»: the strip's title already
      says «Amigos (n)», and the rail button is also called «Amigos». Two
      buttons with the same name on the same screen confuse the screen reader.
    */
    tab: {
      amigos: "Todos",
      recebidos: "Recebidos",
      enviados: "Enviados",
      encontrar: "Encontrar",
    },
    /**
     * The request counter on the strip, said in full to whoever listens to the screen.
     *
     * The number alone reads "dois" next to "Pendentes", which is not a
     * sentence. This counter is what justifies the requests having left the
     * screen's body, so it has to announce itself as what it is.
     */
    pendingCount: (n: number): string => (n === 1 ? "1 pedido à espera de resposta" : `${n} pedidos à espera de resposta`),
    directsTitle: "Mensagens privadas",
    /**
     * The column's emptiness, said by what to do next and not by what is missing.
     *
     * "Sem conversas" described the state and left the person in the same
     * place. What they need to know is where one starts, and one starts in the
     * list next to it, right in front of them.
     */
    directsEmpty: "Nenhuma aberta. Escolhe alguém da lista para começar a falar.",
    directMine: "Tu: ",
    /**
     * What the line shows when the last thing in the conversation was a friend
     * request.
     *
     * A friend request has no body: it is not a written sentence, it is an act.
     * Without this the conversation appeared in the list with an empty preview,
     * and a blank line reads as a fault and not as "there is something waiting
     * for you here".
     */
    directFriendRequest: "Pedido de amizade",
    directClose: "Fechar conversa",
    directUnread: (n: number): string => `${n} por ler`,
    /** Back to the list, only where the column and the conversation do not fit side by side. */
    backToList: "Voltar às conversas",
    noPendingTitle: "Nada à espera.",
    noPendingBody: "Os pedidos de amizade que te fizerem aparecem aqui, e no sino.",

    unfriend: "Desfazer amizade",
    unfriendTitle: (name: string): string => `Desfazer a amizade com ${name}?`,
    unfriendConfirm:
      "Deixam de ver as publicações um do outro.",
    /*
      Closing a direct conversation does not ask for confirmation: it deletes
      nothing, and the conversation comes back by itself when a message
      arrives. The toast says so and brings the way back, for whoever closed
      the wrong one. Up to 0.9 there was also a fixed note at the end of the
      list saying the same; the owner asked on 27 October 2026 for it to be
      only the notice, at the moment of closing.
    */
    directClosed: "Conversa fechada. Nada foi apagado. Volta quando chegar mensagem.",
    directReopen: "Reabrir",
    unfriendDone: (name: string): string => `a amizade com ${name} está desfeita`,
    /** The «⋯» of a person or conversation line, said with the name. */
    rowMore: (name: string): string => `Mais acções para ${name}`,

    /* ------------------------------------------------- sent requests */
    sentTitle: "Pedidos enviados",
    sentEmptyTitle: "Nenhum pedido à espera.",
    sentEmptyBody: "Os pedidos que fizeres ficam aqui até a pessoa responder.",
    sentAt: (quando: string): string => `Enviado ${quando}`,
    /** The fixed verb for withdrawing our request. */
    cancelRequest: "Cancelar pedido",
    cancelled: "pedido cancelado",

    /* ------------------------------------------------- find */
    findTitle: "Encontrar amigos",
    findBody:
      "Mostra o teu QR ou envia o teu link. Para adicionar alguém, cola o link dessa pessoa.",
    myQrAlt: "O QR do teu link de amizade",
    myLink: "O teu link de amizade",
    copyLink: "Copiar link",
    linkCopied: "link de amizade copiado",
    pasteLabel: "Cola um link ou endereço",
    pastePlaceholder: "https://… ou @nome:servidor",
    pasteOpen: "Abrir perfil",
    pasteInvalid: "Isto não é um link de amizade nem um endereço de conta.",
    scanQr: "Ler QR",
    /** The friendship link the page opened with cannot be read. */
    friendLinkInvalid: "Este link de amizade não se deixa ler. Pede um link novo a essa pessoa.",
    friendLinkOtherServer: "Esta conta é de outro servidor. Só podes adicionar amigos do teu servidor.",
    /** The QR reader in «Encontrar», while the camera is searching. */
    scanning: "Aponta a câmara ao QR do link de amizade.",

    /* ------------------------------------------------- block */
    block: "Bloquear",
    blockTitle: (name: string): string => `Bloquear ${name}?`,
    blockBody:
      "Esta pessoa deixa de te escrever, de te pedir amizade e de ver as tuas publicações.",
    blockDone: (name: string): string => `${name} está bloqueado`,
    unblock: "Desbloquear",
    blockedState: "Bloqueado neste aparelho",
    unblockDone: (name: string): string => `${name} está desbloqueado. Para voltarem a ser amigos, é preciso um pedido novo.`,
    escritaBloqueado: "Bloqueaste esta pessoa. Desbloqueia-a nas Configurações para voltarem a falar.",
  },

  activity: {
    title: "Como apareces",
    online: "Online",
    busy: "Ocupado",
    away: "Ausente",
    invisible: "Invisível",
    custom: "Personalizado…",
    busyNote: "Enquanto estiveres ocupado, as notificações do sistema ficam caladas.",
    current: (activity: "online" | "ocupado" | "ausente" | "invisivel"): string =>
      activity === "invisivel"
        ? "Invisível: apareces offline aos outros"
        : activity === "ocupado"
          ? "Ocupado: os outros vêem-te assim"
          : activity === "ausente"
            ? "Ausente: os outros vêem-te assim"
            : "Online: os outros vêem-te assim",
    invisibleNote:
      "Os outros vêem-te offline. O servidor sabe que estás ligado, para te entregar as mensagens.",
    /**
     * The round-trip time, when hovering the status dot.
     *
     * Two sentences and not one, because they are two different distances and
     * mixing them up would be lying with a correct number. Outside a call there
     * is no connection to any person (channels are cryptographic groups, not
     * connections) and what is measured is the round trip to the server.
     * Inside a call there really is someone on the other side, and that is the
     * distance that matters.
     *
     * With no measurement there is no sentence: the dot still says only how
     * you appear. A made-up number is worse than no number at all.
     */
    latencyServer: (ms: number): string => `${ms} ms até ao servidor`,
    latencyPeer: (ms: number): string => `${ms} ms até quem está na chamada`,
    /*
      The end of the line under the name, on the account strip («Ocupado · 42
      ms»). The short latency, without saying to where: the long sentence goes
      on the dot. A separate piece, with the separator, because it is what
      drops out when the line does not fit (the column is 236 px) and the
      status stays alone.
    */
    latencyTail: (ms: number): string => ` · ${ms} ms`,
    stateLine: (estado: string, aSeguir: string | null): string => (aSeguir ? `${estado} · ${aSeguir}` : estado),
  },

  /**
   * The channels this account was removed from. Being removed takes away the
   * keys for what comes next; what was already read stays on this device until
   * it is deleted.
   */
  arquivados: {
    titulo: "Arquivados",
    nota: "Canais de onde foste removido. Podes ler o que ficou neste aparelho, mas não podes escrever.",
    vazio: "Nenhum canal arquivado.",
    desde: (quando: string): string => `arquivado a ${quando}`,
    ver: "Ver histórico",
    esconder: "Esconder histórico",
    historicoDe: (canal: string): string => `Histórico de ${canal}`,
    semMensagens: "Não ficou nenhuma mensagem com texto.",
    apagar: "Apagar",
    apagarTitulo: (canal: string): string => `Apagar o histórico de ${canal}?`,
    apagarCorpo: "O histórico sai deste aparelho para sempre. Não há outra cópia.",
    apagado: "Histórico apagado.",
  },

  /**
   * Sync between accounts, as told to the person (S5, §2.5 of the plan
   * `2026-10-20-sincronia-absoluta.md`). They are not errors and have no code:
   * they are limits and states. No jargon: no «época», «MLS» or «resumo».
   */
  sincronia: {
    /** The marker in the conversation, where the seat is. It does not appear in the feed. */
    lugar: "Entraste aqui. O que foi dito antes não chega a este aparelho.",
    lugarData: (data: string): string => `Entraste a ${data}.`,
    /** The thin bar while the channel reaches whoever joined late. It goes away by itself. */
    aReceber: "A receber o canal…",
    /**
     * The bar for history coming from a sibling device (1.0 «Arca»). First the
     * entries (messages, posts, tickets), then the files, which come at the
     * end. It covers nothing: the app keeps working.
     */
    historico: (feitas: number, total: number): string => `A trazer o histórico: ${feitas} de ${total} mensagens.`,
    historicoMedia: (feitas: number, total: number): string => `A trazer os ficheiros: ${feitas} de ${total}.`,
    /** One part of the bar: how much of one type has arrived. */
    parte: (nome: string, recebidos: number, esperados: number): string => `${nome}: ${recebidos} de ${esperados}`,
    tipos: {
      fundador: "Fundação",
      cargo: "Cargos",
      atribuicao: "Quem tem cargos",
      categoria: "Categorias",
      sala: "Salas",
      apagamento: "Itens apagados",
      publicacao: "Publicações",
      comentario: "Comentários",
      gosto: "Gostos",
      voto: "Votos",
      ticket: "Tickets",
    },
    /** Diagnostics: one line per channel. */
    titulo: "Igual aos outros membros",
    nota: "Compara cada canal com o que os outros membros têm. Quando falta alguma coisa, este aparelho pede-a.",
    vazio: "Ainda não estás em nenhum canal.",
    estados: {
      igual: "Igual",
      "a-reparar": "A receber o que falta",
      "sem-resposta": "Sem resposta dos outros membros",
      "por-comparar": "Ainda sem comparação",
    },
    ultima: (hora: string): string => `Última comparação: ${hora}`,
    feedDe: (nome: string): string => `Feed de ${nome}`,
    /** An attachment of which this device only has the name. */
    anexoPedir: "Pedir aos outros membros",
    anexoAPedir: "A pedir…",
    anexoNinguem: "Nenhum membro com esta imagem está ligado agora. Tenta mais tarde.",
    anexoFicheiroNinguem: "Nenhum membro com este ficheiro está ligado agora. Tenta mais tarde.",
    anexoRecusado: "O que chegou não é o original. Não se mostra.",
    anexoSemLigacao: "Sem ligação ao servidor. Tenta outra vez.",
    anexoTentarOutraVez: "Tentar outra vez",
    anexoCancelar: "Cancelar",
  },

  /**
   * Core notices that reach the screen, translated by `code`. The core's
   * `detail` is log English; this is what a person reads.
   */
  avisosDoNucleo: {
    channelRemoved: (canal: string): string => `Já não estás em ${canal}. Não recebes as mensagens dele.`,
    welcomeDead: "Este convite já não funciona. Pedimos outro.",
    channelDeleted: (canal: string): string =>
      `Um administrador eliminou ${canal}. A app de cada membro apaga as mensagens do canal.`,
  },

  notifCenter: {
    /* «Juntar contas» (phase 8.2): the sentence says who signed and asks for the tap. */
    sucessao: (de: string, para: string): string => `${de} passou a ser ${para}. Quem o diz é a conta ${de}.`,
    sucessaoAdicionar: (para: string): string => `Adicionar ${para}?`,
    sucessaoConvidar: (para: string, canal: string): string => `Convidar ${para} para ${canal}?`,
    adicionar: "Adicionar",
    convidar: "Convidar",
    agoraNao: "Agora não",
    title: "Notificações",
    bell: "Notificações",
    bellWithCount: (n: number): string =>
      n === 0 ? "Notificações" : n === 1 ? "Notificações, 1 por ler" : `Notificações, ${n} por ler`,
    empty: "Estás em dia.",
    /* The timeline filters. See `filtroDaNotificacao`. */
    filtros: "Filtrar as notificações",
    filtroTudo: "Tudo",
    filtroMencoes: "Menções",
    filtroChamadas: "Chamadas",
    filtroConvites: "Convites",
    filtroAmigos: "Amigos",
    filtroVazio: "Nada aqui.",
    hoje: "Hoje",
    ontem: "Ontem",
    porLer: "por ler",
    /* A private conversation rang and nobody answered. See `lib/chamadasPerdidas.ts`. */
    chamadaPerdida: (nome: string): string => `Chamada perdida de ${nome}`,
    /*
      Three truths where there were two.

      "Nada por aqui. Bom sinal." was also what appeared when READING failed:
      the list lives in the vault, the vault refused to open it, and the panel
      told the person they had no notifications at all. They could have fifty.
      The application knew it had failed (it wrote it to the log, and does not
      mark the list as read precisely so it does not write the emptiness over
      what is there) and still claimed the opposite on screen.

      It is the same rule the people list already follows: loading, failed and
      empty are three different things, and the worst of all is the second
      dressed as the third.
    */
    falhou: "Não foi possível ler as notificações guardadas neste aparelho.",
    falhouNota: "Nada foi perdido. O que está guardado continua lá, por ler.",
    markAllRead: "Marcar tudo como lido",
    roomAdded: (room: string): string => `Foste adicionado a #${room}`,
    dmNew: (name: string): string => `${name} abriu uma conversa contigo`,
    friendRequest: (name: string): string => `${name} quer ser teu amigo`,
    friendAccept: (name: string): string => `${name} aceitou o teu pedido`,
    dmMessage: (name: string): string => `Mensagem nova de ${name}`,
    joinedByInvite: (name: string, room: string): string => `${name} entrou em #${room} pelo teu link`,
    /** Names the room: a mention with no place forces looking for it by hand. */
    mention: (name: string, room: string): string => `${name} mencionou-te em #${room}`,
    /**
     * What is left of a request after it is resolved.
     *
     * The entry stays (it is the record of something that happened, and those
     * are not deleted) but the buttons go, because they come from the state
     * and not from the record. That is what makes "accepting in one place
     * removes it from the other" need no programming.
     */
    friendRequestClosed: (name: string): string => `Pedido de ${name}: respondido`,
  },

  userMenu: {
    /* The first in the menu: it is the least destructive and the most used. */
    profile: "Ver perfil",
    dm: "Mensagem",
    /* Only to friends: a call is a private conversation. */
    call: "Chamada",
    inviteToRoom: "Convidar para um canal…",
    makeAdmin: "Tornar administrador",
    dropAdmin: "Deixar de ser administrador",
    /* The nickname in this channel (phase 3): your own, or whoever moderates. */
    nickname: "Mudar apelido…",
    nicknameRemove: "Tirar apelido",
    nicknameTitle: (nome: string): string => `Apelido de ${nome} neste canal`,
    nicknameTitleSelf: "O teu apelido neste canal",
    nicknameLabel: "Apelido",
    nicknameHint: "Aparece à frente do nome, só neste canal. Máximo 32 caracteres.",
    nicknameSaved: "Apelido mudado.",
    nicknameRemoved: "Apelido tirado.",
    expel: "Expulsar do canal",
    /**
     * The confirmation that asks for the name typed, like deleting the account.
     *
     * It is the only gesture in the person's menu with a cryptographic effect:
     * the epoch advances, whoever was kicked stops decrypting what comes next,
     * and no gesture brings them back without a new invite. A dialog you click
     * through without reading is no barrier at all to a habit, and this is the
     * act where a mistake costs most.
     */
    expelTitle: (name: string): string => `Expulsar ${name} do canal`,
    expelBody:
      "A pessoa deixa de ler o canal. Para voltar, precisa de um convite novo.",
    expelConfirmLabel: (name: string): string => `Escreve "${name}" para confirmar`,
    expelConfirm: "Expulsar",
    expelDone: (name: string): string => `${name} foi expulso do canal`,
    adminChanged: "Cargos actualizados.",
    /**
     * What happened when invite was pressed, said without overpromising.
     *
     * "Convite enviado" and nothing more: the person has not joined, and the
     * member list will not change until they accept. Before, this said the
     * same and seated them at once, which made the sentence look modest and
     * the act something else.
     */
    invited: (room: string): string => `convite enviado para #${room}`,
    noRooms: "Não tens canais. Cria um primeiro.",
    friend: "Pedir amizade",
    friendSent: "pedido enviado",
    /**
     * The single friendship button, on the profile sheet, and its states.
     *
     * One button that changes its word according to the relationship, instead
     * of four buttons in four places. «Pedido enviado» is not a button: there
     * is nothing to do until the other person answers.
     */
    acceptFriend: "Aceitar pedido",
    friendPending: "Pedido enviado",
    friendsNow: "Amigos",
    friendsMenu: (name: string): string => `Amigos: menu da amizade com ${name}`,
    noteLabel: "Nota para o pedido",
    notePlaceholder: "Opcional. Diz quem és, por exemplo.",
    /** The profile sheet's «⋯»: the rest of the person's menu. */
    more: (name: string): string => `Mais acções para ${name}`,
  },

  /**
   * The invite to a channel, in the conversation where it arrives.
   *
   * It arrives as a private message and is answered there: it is where the
   * person is reading, and where they will look. The sentences say what
   * happens next without pretending it is immediate: between accepting and
   * joining it depends on whoever invited being online, and that is said with
   * the same words Amigos already uses.
   */
  convite: {
    titulo: (sala: string): string => `Convite para ${sala}`,
    /**
     * What joining gives, and what it does not: said to whoever is about to press the button.
     *
     * Written from the reader's side, not the inviter's: the invite box
     * sentence talks about HIM ("chega-lhe", "só entra se aceitar"), and used
     * here it read as if the invite were for someone else.
     */
    porResponder: "Vais ver as mensagens a partir de agora. As anteriores não.",
    aceitar: "Entrar",
    recusar: "Agora não",
    aResponder: "um momento…",
    /** On the inviter's side, while there is no answer. */
    aguarda: (nome: string): string => `À espera da resposta de ${nome}.`,
    /**
     * Accepted, and not joined yet. The interval is real and it is said.
     *
     * Nobody joins an encrypted group alone: whoever invited has to admit them,
     * and may be offline. It is the same truth `people.acceptedPending` says
     * about friendships, for the same reasons.
     */
    aceiteFalta: (nome: string): string => `Aceitaste. Entras assim que ${nome} se ligar.`,
    aceiteDado: "Aceitaste. Já estás lá dentro.",
    /** On the inviter's side, after the other person accepts. */
    aceiteDeles: (nome: string): string => `${nome} aceitou.`,
    recusado: "Convite recusado.",
    recusadoDeles: (nome: string): string => `${nome} não vai entrar.`,
    /** See `INVITE_TTL_MS`: fourteen days, and then you invite again. */
    caducado: "Este convite expirou. Pede outro a quem te convidou.",
    caducadoMeu: (nome: string): string => `O convite a ${nome} expirou. Podes convidar outra vez.`,
  },

  callDock: {
    /** The region's name, for whoever listens to the screen. It is not the line that is read. */
    ongoing: "Chamada a decorrer",
    back: "Voltar ao canal",
    /**
     * What is happening, on the dock's first line.
     *
     * Short on purpose: the dock is seen from the corner of the eye, and its
     * sentence has to be read without stopping to read it.
     */
    emChamada: "Em chamada",
    /**
     * The line that replaces "Em chamada" while THIS account shares the screen.
     *
     * It was born ready and switched off, waiting for Phase 3. It has been on
     * since 16 August 2026: the call engine's `screen` reaches `App`, which
     * passes `aPartilharEcra` to the dock. The dock did not need rewriting,
     * which was the point of writing the sentence before any button existed.
     *
     * Only OUR sharing lights it. Someone else's does not change this line:
     * whoever reads the dock needs to know whether their own screen is going on
     * air, and that is a fact about this device.
     */
    aPartilharEcra: "A partilhar ecrã",
    /**
     * Where the call is happening: the channel, and the room inside it.
     *
     * The dock floated without saying where it was from. With two voice rooms
     * open, or with the call going on while reading another channel, "sair"
     * was a leap in the dark.
     *
     * In a direct conversation there is no room at all, so only the channel is
     * said: see `onde` in the dock.
     */
    /**
     * «Canal · Sala», in the order of whoever is looking: first where, then the
     * room. It was «canal / sala»; the owner asked for the dot on 27 October
     * 2026, and the same line serves the side card, which scrolls it when it
     * does not fit (see `Andante`).
     */
    ondeComSala: (canal: string, sala: string): string => `${canal} · ${sala}`,
    /** The ping, in place of «Ligado» on the side card: says it is connected and how well. */
    ping: (ms: number): string => `${ms} ms`,
    /* The sidebar card, on a wide screen: the top line. The room goes on the
       bottom line, smaller, ahead of the channel and the count. */
    ligado: "Ligado",
  },

  /**
   * Music in the call, owner's requests of 27 October 2026 (23:40 and 23:50):
   * the DJ chooses the volume of what GOES OUT, and whoever listens mutes only
   * one person's music without muting their voice.
   */
  musicaNaChamada: {
    /** In the «Partilhar áudio» sheet, on the DJ's side. */
    volumeDaEmissao: "Volume da emissão",
    volumeDaEmissaoNota: "Muda o som que sai para a chamada. Não muda o que tu ouves.",
    /** On the «A tocar» sign, when the broadcast is not at maximum. */
    emissaoA: (percentagem: number): string => `Emissão a ${percentagem} %`,
    /** On the listener's side, next to the volume of the person's music. */
    silenciar: "Silenciar a música",
    ouvir: "Ouvir a música",
    silenciarDe: (nome: string): string => `Silenciar a música de ${nome}`,
    ouvirDe: (nome: string): string => `Ouvir a música de ${nome}`,
    /** The status on the card, under «A tocar». */
    silenciada: "Música silenciada",
  },

  /**
   * The player in the «Partilhar áudio» sheet, redone in the style of Winamp
   * and Windows Media Player (owner, 27 October 2026): the display, the
   * transport, the playlist and the other sources in a footer.
   */
  leitorDeMusica: {
    visor: "Visor do leitor",
    /** For the screen reader: the time of the big digits. */
    tempo: (decorrido: string, total: string | null): string =>
      total === null ? `${decorrido} decorridos` : `${decorrido} de ${total}`,
    semFaixa: "Nada a tocar",
    espectro: "Espectro do som",
    posicao: "Posição na faixa",
    anterior: "Faixa anterior",
    seguinte: "Faixa seguinte",
    abrir: "Abrir ficheiros",
    repetir: "Repetir a lista",
    baralhar: "Baralhar a lista",
    adicionarFicheiros: "Adicionar ficheiros",
    adicionarPasta: "Adicionar uma pasta",
    largarAqui: "Larga aqui os ficheiros de áudio.",
    /** In each line's title: the list is reordered by dragging. */
    arrastar: "Arrasta para mudar a ordem.",
    outrasFontes: "Outras fontes",
    volumes: "Volumes",
  },

  linkCard: {
    kindLink: "Link",
    kindVideo: "Vídeo",
    kindImage: "Imagem",
    kindPost: "Publicação",
    urlPlaceholder: "https://…",
    titlePlaceholder: "Título (opcional)",
    videoPrefix: "Vídeo · ",
    /** The lookup is done by this device, once, before posting. */
    fetchPreview: "Buscar título e miniatura",
    fetching: "a buscar…",
    /* What says what to do next stays; the explanation of who talks to whom,
       which was the model and not the step, went out. */
    fetchFailed: "Este site não deixou o teu aparelho ler a página. Escreve o título e escolhe a miniatura.",
    fetchEmpty: "A página não diz título nem imagem. Escreve tu.",
    pickThumb: "Escolher miniatura",
    dropThumb: "Remover a miniatura",
    thumbTooBig: "Essa imagem não dá miniatura. Escolhe uma mais pequena.",
    /** A video's facade, when it does not even have a title to announce itself. */
    openVideo: "Abrir o vídeo no YouTube, numa janela nova",
  },

  profile: {
    noName: "Sem nome",
    /** The `title` of a name taken from the address (`NomeDePessoa`), for screen readers and for the mouse. */
    nomeDoEndereco: "Vindo do endereço",
    sealed: "Os teus canais",
    sealedTitle: "Só as pessoas dos teus canais vêem o teu perfil.",
    editProfile: "Editar perfil",
    postSingular: "publicação",
    postPlural: "publicações",
    emptyTitle: "Ainda não publicaste nada.",
    emptyBody: "Só os teus amigos vêem o que publicas.",
    newPost: "Nova publicação",
    kindsLabel: "Tipos de publicação",
    kindPhotos: "Fotos",
    /** Posts whose attachments are not images. See `postKindOf`. */
    kindFiles: "Ficheiros",
    kindText: "Texto",
    kindLinks: "Links",
    kindEmpty: "Nada deste tipo.",
    kindEmptyBody: "Muda de separador, ou publica algo deste tipo.",
    /** The list of posts, one per line. */
    postsListLabel: "As tuas publicações",
    openPost: "Abrir a publicação",
    /** What the line says under the name, besides the date. */
    rowPhotos: (n: number): string => (n === 1 ? "1 fotografia" : `${n} fotografias`),
    rowLink: "link",
    /** The section of your own profile with the channels this account founded. */
    foundedTitle: "Canais que fundei",
    foundedEmpty: "Ainda não fundaste nenhum canal.",
    foundedOpen: (nome: string): string => `Abrir ${nome}`,
  },

  /*
    The sheet for framing an image (profile photo, channel icon, a post's
    cover). Request from the owner and the community, 2 November 2026.
    Sentences in STE100: short, active, one instruction per sentence.
  */
  enquadrar: {
    titulo: {
      circulo: "Enquadrar a fotografia",
      quadrado: "Enquadrar o ícone",
      capa: "Enquadrar a capa",
    },
    instrucoes: "Arrasta a imagem para a mover. Usa a roda do rato, dois dedos ou a barra para ampliar.",
    /* What the screen reader reads on reaching the frame: the keyboard gestures. */
    teclado: "Usa as setas para mover a imagem. Usa mais e menos para ampliar.",
    moldura: "Imagem a enquadrar",
    ampliar: "Ampliar",
    /* An animated GIF is not framed: see `gifQueFicaAnimado` in `lib/enquadrar.ts`. */
    gifFixo: "Um GIF animado não pode mover nem ampliar. Fica ao centro, para continuar animado.",
    guardar: "Guardar",
    aGuardar: "A guardar…",
    /* The button on the thumbnail of a post's first image. */
    enquadrarCapa: "Enquadrar a capa",
  },

  profileEditor: {
    title: "O teu perfil",
    lead: "Só as pessoas dos teus canais vêem o teu perfil. O servidor não o guarda.",
    nameRequired: "Primeiro, um nome.",
    chooseImage: "Escolher imagem",
    remove: "Remover",
    name: "Nome",
    namePlaceholder: "Como queres aparecer",
    /*
      «Biografia» and not «Sobre ti» (owner's request on 27 October 2026): the
      name says it is something other than the status, and the help sentence
      says the difference.
    */
    bio: "Biografia",
    bioNote: "Quem és, em poucas linhas. O estado é o que estás a fazer agora.",
    email: "Email",
    optional: "opcional",
    emailPlaceholder: "Para te contactarem fora do Orwell",
    emailNote:
      "Não serve para entrar nem para recuperar a conta. Só o vêem as pessoas que já falam contigo.",
    donations: "Apoios",
    donationLabelPlaceholder: "Etiqueta",
    donationValuePlaceholder: "Link, IBAN ou endereço",
    add: "Adicionar",
    donationsNote:
      "Aparecem como texto para copiar. A app não contacta serviços de pagamento.",
    saving: "a guardar…",
    save: "Guardar",
    discard: "Descartar as alterações?",
    /** The friends list on the profile: off by default, and chosen per person. */
    showFriends: "Mostrar a minha lista de amigos aos meus amigos",
    showFriendsNote: "Só os teus amigos vêem a lista. Escolhe quem aparece nela. Ninguém vê que amigos têm em comum.",
    showFriendsEmpty: "Ainda não tens amigos para mostrar.",
    showFriendsWho: "Quem aparece na lista",
  },

  settings: {
    media: "Microfone e câmara",
    /*
      Settings › Voice: the voice chain (see `client-core/src/audio/README.md`).
      STE100: short, active sentences, one term per thing. «Redução de ruído» is
      the whole; «supressão» is the model's stage.
    */
    voz: {
      lead: "A app trata a tua voz neste aparelho, antes de a cifrar. A tua voz não sai do aparelho para ser tratada.",
      perfil: "Redução de ruído",
      perfis: {
        desligado: { nome: "Desligado", frase: "Sem tratamento. A voz vai tal como o microfone a capta." },
        leve: { nome: "Leve", frase: "Tira o ruído constante. A voz fica quase igual." },
        normal: { nome: "Normal", frase: "Tira o ruído e o som do teclado. Iguala o volume da voz. Recomendado." },
        maximo: { nome: "Máximo", frase: "Tira o máximo de ruído nas pausas. Para sítios com muito ruído." },
      },
      teste: "Teste do microfone",
      entrada: "Entrada",
      saida: "Saída",
      ruido: "Ruído estimado",
      dbfs: (db: number): string => `${db} dB`,
      ouvirMe: "Ouvir-me",
      ouvirMeNota: "Usa auscultadores. Com altifalantes faz eco.",
      indisponivel: "Esta versão da app não trata a voz.",
    },
    /* Microphone sensitivity, Discord style (owner, 2 November 2026). */
    sensibilidade: {
      titulo: "Sensibilidade do microfone",
      automatica: "Automática",
      automaticaNota: "A app decide quando o microfone transmite. Segue o ruído da sala.",
      nota: "O microfone só transmite acima desta linha. Fala normalmente e põe a linha abaixo do verde.",
      linha: "Linha do microfone",
      nivel: "Nível do microfone",
      db: (db: number): string => `${db} dB`,
      aAbrir: "A abrir o microfone.",
      carregarParaFalar: 'Com o atalho "Falar enquanto carregas", a linha também vale enquanto carregas na tecla.',
    },
    /*
      Keyboard shortcuts for the voice controls, chosen by each person (owner's
      request on 19 October 2026). The defaults are Discord's, which the hand
      already knows; «falar» has no key until the person gives it one.
    */
    atalhos: "Atalhos de teclado",
    /*
      1.0.6 (points 5 and 8 of `docs/planos/depois-da-1-0.md`): any key alone
      and mouse buttons 4 and 5; in the desktop app, the microphone and sound
      are global during a call. In the browser, only with the page in front.
    */
    atalhosNota: "Funcionam só com a página à frente. Serve qualquer tecla, ou os botões 4 e 5 do rato.",
    atalhosNotaSecretaria:
      "Durante uma chamada, os atalhos do microfone e do som funcionam também com a app minimizada ou atrás de outra app. Os outros atalhos e os botões do rato funcionam só com a app à frente.",
    atalhoAccao: {
      microfone: "Silenciar ou ligar o microfone",
      som: "Desligar ou ligar o som",
      camara: "Ligar ou desligar a câmara",
      ecra: "Partilhar ou parar o ecrã",
      sair: "Sair da chamada",
      falar: "Falar enquanto carregas, com o microfone silenciado",
      overlay: "Mostrar ou esconder a overlay de jogo",
    },
    atalhoMudar: "Mudar",
    atalhoLimpar: "Limpar",
    atalhoNenhum: "Sem atalho",
    atalhoAGravar: "Carrega numa tecla ou num botão lateral do rato. Esc cancela.",
    atalhoInvalido: "Essa tecla não serve de atalho.",
    atalhoRato: (botao: number): string => `Rato ${botao}`,
    atalhoAvisoComum: "Esta tecla escreve texto. O atalho funciona só com a app à frente e fora das caixas de texto.",
    atalhoAvisoEscreve:
      "Esta tecla escreve um símbolo. Durante uma chamada, ela deixa de escrever nas outras apps.",
    atalhoOcupado: "Outra app já usa a tecla de um atalho. Com a app escondida, esse atalho não funciona. Escolhe outra tecla.",
    atalhoSemAcessibilidade:
      "Para usar uma tecla de multimédia com a app escondida, o macOS pede a permissão de Acessibilidade. Liga o Orwell em Privacidade e segurança, Acessibilidade.",
    atalhoAbrirAcessibilidade: "Abrir as Definições",
    atalhosRepor: "Repor as predefinições",
    /*
      The two toggles that already existed on the sidebar card, here too: this
      is where people come looking for microphone options, and this is where
      they were missing. It is the SAME toggle, not a second copy: see the notes.
    */
    micMuted: "Silenciar o microfone",
    soundOff: "Desligar o som",
    echoCancellation: "Cancelar eco",
    /* Of the requests to the browser, only echo stays: the noise reduction
       profile does the rest, and better. Only the browser can cancel echo. */
    echoCancellationNota: "Para quem usa altifalantes.",
    inputDevice: "Microfone",
    inputGain: "Volume de entrada",
    outputVolume: "Volume de saída",
    /*
     * The microphone test, in words.
     *
     * The bars show the level; these sentences say the CONCLUSION, which is
     * what a bar cannot say and what whoever listens to the screen has no way
     * to see. There are five states, and none is decorative:
     *
     * - stopped: how the microphone is opened for the test
     * - listening: the microphone is open, the person still has to speak
     * - picks up: confirmed, and says THIS is the microphone the call uses
     * - no signal: the reason this exists. Without this sentence, finding out
     *   the wrong device was chosen happened in a call, with people waiting.
     * - timed out: the preview closed by itself, and it says why
     *
     * "não é o que te ouve" and not "está mal escolhido": the chosen microphone
     * can be perfectly fine and be in another room. The sentence says the
     * measured fact and leaves the conclusion to whoever knows where they sit.
     */
    /**
     * With a live call, the test uses the track the call already has and does
     * not open the microphone again: a second capture of the same device can
     * stop or change the call's, and whoever was listening would stop hearing.
     */
    testeNaChamada: "Estás numa chamada. O teste usa o mesmo microfone.",
    entradaParada: 'Liga "Ouvir-me" e fala. As barras mostram o som depois da redução de ruído.',
    entradaAEscutar: "A ouvir. Diz alguma coisa.",
    entradaApanha: "A apanhar. É este o microfone que a chamada vai usar.",
    entradaSemSinal: "Nada apanhado. Se estás a falar, o microfone escolhido não é o que te ouve.",
    /** Closes by itself, and says it closed: the microphone light does not stay on. */
    entradaEsgotado: "Parou ao fim de um minuto e fechou o microfone. Liga outra vez se precisares.",

    camara: "Câmara",
    videoQuality: "Qualidade de vídeo",
    videoAuto: "Automática",

    title: "Configurações",
    /* On the phone the screen opens with the list of sections (1.3.6). */
    seccoesDoEcra: "Secções das configurações",
    voltarAsSeccoes: "Voltar às secções",
    /*
      The interface language, and only the interface's.

      "Automática" is a stored choice and not the absence of one: without it,
      whoever chose Portuguese on a Portuguese system was stuck with Portuguese
      forever, and changing the system language stopped having any effect
      without anyone understanding why.

      Language names stay each in its own language ("English" and not
      "Inglês") because whoever opens the application in a language they cannot
      read has to be able to find theirs without reading the one on screen.
    */
    language: "Língua",
    languageAuto: "Automática",
    /**
     * What this option does NOT do, said where it is.
     *
     * The next question of whoever changes the application's language is
     * whether messages change too, and the answer has to be here and not on a
     * help page: translating a message means sending it to someone who
     * translates it, and this product sends what you write nowhere. It is the
     * same promise the encryption makes, said in text.
     */
    languageNote:
      "Muda a língua da app. As mensagens não são traduzidas.",
    account: "Conta",
    /* The door to the profile editor from Settings: it used to be only through
       the account card, and whoever came here looking for the name did not find it. */
    editProfile: "Editar perfil",
    notifications: "Notificações",
    /* A single toggle, which asks for the browser permission when switched on.
       It used to be two buttons, «Activar» and «Desactivar», and only one was visible at a time. */
    notifSystem: "Notificações do sistema",
    notifBlocked: "Bloqueadas pelo browser. Para as usares, permite notificações nas definições do site.",
    notifUnsupported: "Aqui as notificações não funcionam.",
    notifPreview: "Mostrar o conteúdo",
    avisosDeAmigos: "Avisos de amigos",
    avisarAmigosOnline: "Quando um amigo fica online",
    avisarAmigosNaVoz: "Quando um amigo entra numa sala de voz",
    avisarAmigosNoEcra: "Quando um amigo partilha o ecrã",
    avisarAmigosNaComunidade: "Quando um amigo entra num canal teu",
    avisarAmigosOnlineNota: "Um aviso e um som, no máximo uma vez a cada 30 minutos por amigo e por tipo.",
    sounds: "Sons",
    soundVolume: "Volume dos sons",
    soundSample: "Ouvir",
    device: "Este aparelho",
    /* The end of the Devices section, with the gesture nobody undoes. */
    zonaDePerigo: "Zona de perigo",
    exportAction: "Exportar conta",
    exportPassLabel: "Palavra-passe para o ficheiro",
    exported: "conta exportada. O ficheiro é a conta, guarda-o bem",
    /**
     * What is said instead of the button to a paired device.
     *
     * Its vault does not have the account private key, and the file that
     * left from here would not either: whoever imported it would get a copy of
     * this device and be unable to add, remove or recover anything. A button
     * that promises "o ficheiro é a conta" and delivers something else is worse
     * than no button.
     */
    exportNeedsAccountKey: "Faz a cópia de segurança no aparelho principal da conta.",
    /**
     * The import warning, which replaced the "one device at a time" one.
     *
     * That one stopped being true the day an account could have up to four
     * devices. What is still true, and harsher: importing the vault does not add
     * a device, it MOVES the account to another device, because the vault
     * carries the group keys and two identical vaults in two places break the
     * channels' encryption. The way to two devices is the other one.
     */
    importReplacesDevice:
      'Importar passa a conta para este aparelho. O aparelho antigo deixa de a poder usar. Para usar a conta em dois aparelhos, no aparelho principal escolhe "Acrescentar aparelho" e no novo escolhe "Sim, emparelhar este aparelho".',
    devices: "Aparelhos",
    devicesLead:
      "Os aparelhos com esta conta. Cada aparelho tem só as mensagens que recebeu depois de entrar.",
    deviceAddedAt: (data: string): string => `aparelho acrescentado a ${data}`,
    thisDevice: "este aparelho",
    devicesUnknown: "Não foi possível obter a lista de aparelhos.",
    addDevice: "Acrescentar aparelho",
    /* Revoking a device (phase 5). The honest sentence comes from the plan: say what is cut and what is not. */
    revoke: "Revogar",
    revokeTitle: "Revogar este aparelho?",
    revokeBody:
      "O aparelho sai da conta e de todos os canais. Revogar corta a leitura a partir da época seguinte. O que o aparelho já tinha, continua a ter.",
    revokeHonest: "Revogar corta a leitura a partir da época seguinte. O que o aparelho já tinha, continua a ter.",
    revoking: "A revogar o aparelho…",
    revoked: "O aparelho foi revogado.",
    revokePending: "a revogar",
    revokeServerUnsupported: "Este servidor não sabe revogar aparelhos.",
    revokeSelf: "Este aparelho não se revoga a si próprio. Revoga-o a partir de outro aparelho.",
    /* The section: the log, sync and the version. */
    ajuda: "Ajuda e diagnóstico",
    diagnostics: "Registo de diagnóstico",
    diagnosticsNote:
      "Guarda os últimos 200 acontecimentos desta sessão, sem mensagens nem texto teu. Apaga-se quando fechas a app. Copia-o para relatar um erro.",
    diagnosticsCopy: "Copiar registo",
    /** The account's blocked people (phase 5: they travel through the account channel). */
    blocked: "Bloqueados",
    blockedNote: "A lista passa aos teus outros aparelhos. Um aparelho com uma versão antiga não a conhece.",
    blockedEmpty: "Não bloqueaste ninguém.",
    blockedSince: (data: string): string => `desde ${data}`,
    /* Privacy: the blocked people and what the app keeps on this device. */
    privacidade: "Privacidade",
    oQueGuarda: "O que a app guarda",
    oQueGuardaTexto:
      "As mensagens ficam cifradas no cofre deste aparelho. O servidor nunca as tem em claro. O registo de diagnóstico guarda 200 acontecimentos sem texto teu e apaga-se ao fechar.",
    /*
      «Sincronizar conta»: one button for the two repairs that used to be two
      (asking again for the invites of channels that do not open, and checking
      friendships). A single status sentence: channels first, friendships
      next, on the same line.
    */
    sincronizar: "Sincronizar conta",
    sincronizarNota: "Pede de novo os canais que não abrem e verifica as amizades e as conversas. Não apaga nada.",
    aSincronizar: "A sincronizar…",
    repararSemLigacao: "Precisa de ligação ao servidor.",
    repararNada: "Todos os canais abrem.",
    repararAmizadesFeito: "As amizades foram verificadas.",
    repararFeito: (antes: number, depois: number): string =>
      depois === 0
        ? antes === 1
          ? "Antes, 1 canal não abria. Agora abre."
          : `Antes, ${antes} canais não abriam. Agora abrem todos.`
        : depois === 1
          ? "Falta 1 canal. Abre quando alguém desse canal estiver online."
          : `Faltam ${depois} canais. Abrem quando alguém desses canais estiver online.`,
    diagnosticsCopied: "registo copiado. Cola-o no relato",
    diagnosticsEmpty: "Ainda sem acontecimentos registados nesta sessão.",
    diagnosticsCount: (n: number): string => (n === 1 ? "1 acontecimento" : `${n} acontecimentos`),
    /* The version and the source code (AGPL-3.0, section 13), at the end of "Ajuda e diagnóstico". */
    sobreVersao: (versao: string): string => `Orwell ${versao}`,
    codigoAberto: "O Orwell é código aberto, com a licença AGPL-3.0.",
    codigoFonte: "Código-fonte",
    /*
      «Terminar sessão» and not «Bloquear agora» (owner, 27 October 2026): it
      is the gesture everyone knows from other apps. What it does is close the
      vault on this device; the account stays, and comes back with the
      passphrase. The line below says so, because «terminar sessão» in other
      apps deletes more.
    */
    lockNow: "Terminar sessão",
    lockNote: "Fecha o cofre e esquece a sessão neste aparelho. A conta fica, e volta com a palavra-passe.",
    memorizarSessao: "Memorizar a sessão neste aparelho",
    memorizarSessaoNota: "Com isto ligado, o Orwell abre sem pedir a palavra-passe. Para voltar a pedir, desliga ou termina a sessão.",
    memorizarSessaoIndisponivel: "Este aparelho não tem onde guardar a sessão com segurança.",
    sessaoNaoExpira: 'Com a sessão memorizada, a sessão não expira. Para expirar, desliga "Memorizar a sessão".',
    semPalavraPasse: "Esta conta não tem palavra-passe neste aparelho. Para poderes terminar a sessão, define uma.",
    definirPalavraPasse: "Definir palavra-passe",
    definirPalavraPasseNota: "A partir daqui, a conta abre com esta palavra-passe neste aparelho. Com ela, podes terminar a sessão. A conta fica, e volta com a palavra-passe.",
    palavraPasseDefinida: "A conta tem agora palavra-passe neste aparelho.",
    destroyAction: "Apagar a conta deste aparelho",
    destroyTitle: "Apagar a conta?",
    destroyBody: "Não há cópia no servidor. A conta desaparece para sempre.",
    destroyDetail:
      "Apaga deste aparelho a conta, os canais, o histórico e os convites. Ninguém os pode recuperar.",
    destroyConfirmLabel: 'Escreve "apagar" para confirmar',
    destroyConfirmWord: "apagar",
    destroyConfirm: "Apagar para sempre",
    /**
     * The invisible step, said before it happens.
     *
     * Deleting the account starts by leaving every channel, because only
     * clearing the vault left this account's leaf in each one's MLS tree.
     * Without this line, the person had no way of guessing that deleting
     * depends on having a network, nor why, and the refusal that may follow
     * appeared out of nowhere.
     */
    destroySteps: "Antes de apagar, a conta sai de todos os canais.",
    /*
      The same sheet at the other two doors, and only this sentence changes.

      On the gate («Perdeu a sua conta?») and in Setup with an existing vault,
      the vault is closed. Without the keys there is no way to request leaving
      the channels, and this account's leaf stays in each one's MLS tree.
      Whoever deletes like this has to know it before and not after.
    */
    destroyStepsGate:
      "Com a conta trancada, não é possível sair dos canais. O teu nome pode ficar nas listas de membros.",
    destroyStepsImport:
      "Importar apaga a conta deste aparelho e põe a do ficheiro no lugar dela. Com o cofre fechado, a conta apagada não sai dos canais. O nome dela pode ficar visível lá.",
    /* The same sentence, for pairing from the gate. Pairing runs in a
       provisional vault and the account here is only deleted when the new one
       enters (core 1j): if it fails, nothing was deleted. */
    /* «Juntar a outra conta» (phase 8.2): with the vault open, the account warns
       and leaves everything before it is deleted. */
    destroyStepsJoin:
      "Juntar apaga esta conta deste aparelho. Antes, a conta avisa os contactos e os canais, desfaz as amizades e sai de todos os canais. Se o emparelhamento falhar, nada é apagado.",
    destroyStepsPair:
      "Emparelhar põe a outra conta no lugar desta. A app só apaga a conta deste aparelho quando a outra conta entrar. Se o emparelhamento falhar, esta conta fica. Com o cofre fechado, a conta apagada não sai dos canais. O nome dela pode ficar visível lá.",
    /**
     * The button, after a failed attempt.
     *
     * "Apagar para sempre" after a failure promised what it had not done. The
     * right answer is to press again when there is a network, and the button
     * now says that.
     */
    destroyRetry: "Tentar outra vez",
    /*
      The «Sons» section, in Notifications. One line per event, with the name
      the person recognises. The choices stay on this device.
    */
    somPorTipo: "Um som por acontecimento",
    somTipos: {
      directa: "Mensagem privada",
      mencao: "Quando alguém te menciona",
      canal: "Som das mensagens nos canais",
      pedido: "Pedido de amizade",
      aceite: "Pedido de amizade aceite",
      chamada: "Chamada a entrar",
      entrou: "Alguém entra na sala de voz",
      saiu: "Alguém sai da sala de voz",
      ligado: "A chamada liga",
      cotovelada: "Cotovelada",
      ticket: "Ticket novo ou resposta",
      publicacao: "Publicação de um amigo",
      // Phase 4: the only sound that does not come from a person.
      actualizacao: "Actualização disponível",
      "mic-silenciado": "Silenciar o microfone",
      "mic-ligado": "Ligar o microfone",
      "tudo-silenciado": "Silenciar tudo (microfone e som)",
      "tudo-ligado": "Ligar tudo (microfone e som)",
      "amigo-online": "Um amigo fica online",
      "sala-afk": "Passar para a sala AFK",
      enviada: "Som ao enviar mensagens",
      "a-chamar": "Chamada a sair, à espera que atendam",
      "voz-perdida": "A ligação à chamada cai",
      movido: "Um moderador muda-te de sala",
      "transmissao-iniciada": "Uma transmissão começa",
      "transmissao-terminada": "Uma transmissão acaba",
      "espectador-entrou": "Alguém começa a ver a tua transmissão",
      "espectador-saiu": "Alguém deixa de ver a tua transmissão",
    },
    somOuvirTipo: (nome: string): string => `Ouvir: ${nome}`,
    somVibrar: "Vibrar no telemóvel",
    somChamadaComOcupado: 'A chamada toca com "Ocupado" e "Invisível"',
    somNota: 'Estes sons ficam neste aparelho. "Ocupado" e "Invisível" silenciam todos, menos a chamada.',
  },

  notifications: {
    title: "Orwell",
    /* A report arrived in a channel I founded. No name, no channel: it only says there is one. */
    reportCopy: "Nova denúncia no canal",
    /* The decision on a report I made (DSA art. 16(5)), with the redress routes. No number and no facts. */
    reportDecision: (decisao: "suspensa" | "sem-accao"): string =>
      decisao === "suspensa" ? "A tua denúncia foi analisada: conta suspensa." : "A tua denúncia foi analisada: sem acção.",
    reportDecisionVias: "Se discordas, escreve para orwell.eu@proton.me, podes recorrer aos tribunais, ou reclamar à ANACOM.",
    newMessage: (room: string): string => `Nova mensagem em ${room}`,
    // With "Mostrar o conteúdo" off and no conversation to name: a
    // friend request spelled out would carry the requester's name out of
    // the application, which is what the preference was turned off to avoid.
    newNotice: "Tens uma notificação nova",
    /** Point 6: the MSN-style notice. A short sentence, as in the operating system. */
    amigoOnline: (nome: string): string => `${nome} está online`,
    // With "Mostrar o conteúdo" off: no name and no face outside the application.
    amigoOnlineDiscreto: "Um amigo está online",
    abrirConversa: "Abrir conversa",
    /*
      The other friend notices (owner's request, 3 November 2026). The same
      card as «está online», and the same rule: with «Mostrar o conteúdo» off,
      neither name nor place.
    */
    amigoNaVoz: (nome: string, sala: string): string => `${nome} entrou na sala de voz ${sala}`,
    amigoNaVozDiscreto: "Um amigo entrou numa sala de voz",
    amigoNoEcra: (nome: string, sala: string): string => `${nome} começou a partilhar o ecrã em ${sala}`,
    amigoNoEcraDiscreto: "Um amigo começou a partilhar o ecrã",
    /* «Canal» and not «comunidade»: comunidade is only the destination's name on
       the rail (see `terminologia.test.ts`). */
    amigoNaComunidade: (nome: string, canal: string): string => `${nome} entrou no canal ${canal}`,
    amigoNaComunidadeDiscreto: "Um amigo entrou num canal",
    juntarMe: "Juntar-me",
    ver: "Ver",
    abrir: "Abrir",
    agoraMesmo: "agora mesmo",
    /* What is left out of the stack of 3. One line, no button. */
    maisAmigosOnline: (n: number): string => (n === 1 ? "+1 amigo online" : `+${n} amigos online`),
    maisAvisos: (n: number): string => (n === 1 ? "+1 aviso de amigo" : `+${n} avisos de amigos`),
  },

  invite: {
    title: "Link de convite",
    expiresIn: "Expira em",
    usesFor: "Serve para",
    expiry1h: "1 hora",
    expiry1d: "1 dia",
    expiry7d: "7 dias",
    expiryNever: "Nunca",
    uses1: "1 pessoa",
    uses5: "5 pessoas",
    uses25: "25 pessoas",
    usesUnlimited: "Sem limite",
    yourLink: "O teu link",
    qrAlt: "O QR do convite",
    /*
      The link became an address you click, and that widens who can use it: you
      no longer need to know where to paste it. The advice says what to do about
      that, and the sheet's defaults (1 day, 1 person) already follow it.
    */
    linkCare:
      "Usa um prazo curto e poucas utilizações.",
    /** Only in the installed application: an https link opens the browser, not this window. */
    desktopNote:
      'Na app instalada, cola o link em "Entrar com um link".',
    waitingNote: "Alguém do canal tem de estar online para completar a entrada.",
    copyLink: "Copiar link",
    creating: "a criar…",
    createLink: "Criar link",
    linkCopied: "link copiado",
    activeTitle: "Convites activos",
    /*
      The emptiness that had two readings and said one.

      "Nenhum convite activo" fits both someone who never created one and
      someone who created one and saw the deadline end, and that second person
      is left thinking the invite got lost. It is the deadline that removes it,
      and the server really deletes it (`Store.expireInvites`, swept by the
      federation).

      What RUNS OUT of uses is not said here on purpose: that one stays in the
      list, with the counter at the maximum, and promising it goes away would
      be false.
    */
    activeEmpty: "Nenhum convite activo.",
    revoke: "Revogar",
    revoked: "Convite revogado.",
    neverExpires: "nunca expira",
    expiresAt: (when: string): string => `expira a ${when}`,
    usesOf: (uses: number, maxUses: number | null): string =>
      maxUses === null ? `${uses} utilizações · sem limite` : `${uses}/${maxUses} utilizações`,

    /*
      The invite the page was opened with. It never joins by itself: a click on
      a link cannot put someone's account in a channel, and show their address
      to whoever is there, without a yes.
    */
    gateWaiting: "Tens um convite à espera. Entra ou cria conta para o abrir.",
    gateInvalid: "O link de convite que abriste não é válido. Pede outro a quem to enviou.",
    arrivedTitle: "Convite para um canal",
    /*
      "O link diz", and not "foste convidado para": the channel name is written
      into the link by whoever sent it, and the join request only carries the
      code's fingerprint. Whoever has a real invite to a channel can write
      another name into it. The sentence says what is known and where it comes from.
    */
    arrivedBody: (channel: string, server: string, quem?: string): string =>
      quem
        ? `Convite de ${quem} para "${channel}", em ${server}. Os nomes podem ser falsos. Só os confirmas depois de entrares. Queres pedir para entrar?`
        : `Convite para "${channel}", em ${server}. O nome pode ser falso. Só o confirmas depois de entrares. Queres pedir para entrar?`,
    /*
      No name to show (1.0 «Arca», slice 5c): an old invite without a seal, a
      seal that does not open, or a server that does not keep it. The opaque
      address is not a name, so it is not shown.
    */
    arrivedBodyUnnamed: (server: string): string =>
      `Convite para um canal, em ${server}. Só sabes o nome do canal depois de entrares. Queres pedir para entrar?`,
    /** A channel appeared that is not the one the link said. See `onChannels`, in `App`. */
    arrivedMismatch: (appeared: string, named: string): string =>
      `Apareceu-te o canal ${appeared} enquanto esperavas por ${named}. Se entraste pelo link, o nome que ele dizia não era o verdadeiro.`,
    arrivedNote: "Quem está no canal fica a ver o teu endereço. Alguém de lá tem de estar online para te deixar entrar.",
    arrivedAccept: "Entrar",
    arrivedDecline: "Agora não",
    otherServer: (theirs: string, mine: string): string =>
      `Este convite é do servidor ${theirs}. A tua conta é de ${mine}. Só podes usar convites do teu servidor.`,
    alreadyIn: (name: string): string => `Já estás em ${name}.`,
    /** With opaque addresses (1.0) the address is not a name: it says «neste canal». */
    alreadyInOpaco: "Já estás neste canal.",
    /** With opaque addresses the link carries no name, so there is no name to compare. */
    arrivedMismatchOpaco: "Apareceu-te outro canal enquanto esperavas pelo do convite. Confirma onde entraste.",
  },

  menu: {
    open: "Abrir",
    joinCall: "Entrar em chamada",
    joinVideo: "Entrar com vídeo",
    /* The ellipsis says it opens a sheet, not that it invites right away. */
    invite: "Convidar…",
    leaveCall: "Sair da chamada",
    properties: "Propriedades",
    renameRoom: "Mudar o nome",
    renameRoomTitle: "Mudar o nome da sala",
    closeRoom: "Fechar sala",
    /* Leave and delete, side by side at the end of the menu and doing things of
       very different sizes.

       Leaving is about me: I drop the channel from this device, with all the
       rooms inside it, and nobody else notices. Deleting is about the channel:
       it ends for everyone. That is why only one of them is painted red, and
       why only one of them depends on a responsibility.

       "Sair" where "esquecer" used to be: esquecer described what the program
       does to the vault, not what the person wants. */
    leave: "Sair do canal",
    remove: "Eliminar canal",
    /* Expanded menus: what you do to a channel, a room and whoever is inside a
       voice room. What the person cannot do does not appear greyed out: it
       does not appear at all. */
    joinRoom: "Entrar",
    newRoom: "Nova sala",
    newCategory: "Nova categoria",
    markRead: "Marcar como lido",
    /* A conversa is feminine: «lida». The canal stays «lido». */
    markReadDirect: "Marcar como lida",
    /* A category is not a thing: it is the name the rooms have written in the
       `category` field. So renaming it is rewriting it in all of them, and
       deleting it is deleting it from all of them: it never touches the rooms
       themselves. The words here and in the warning have to say that, or
       "apagar" reads as "delete what is inside". */
    renameCategory: "Mudar o nome da categoria",
    /* "Quem vê" and not "Permissões" or "Privacidade": both promised a
       protection this does not give. The sheet says the rest: see
       `categoryProperties.note`. */
    categoryVisibility: "Quem vê esta categoria",
    deleteCategory: "Apagar categoria",
  },

  newRoom: {
    title: "Nova sala",
    lead: "Uma sala dentro deste canal. Quem cá está vê todas.",
    nameLabel: "Nome",
    namePlaceholder: "Anúncios",
    categoryLabel: "Categoria",
    categoryPlaceholder: "Deixa vazio para não agrupar",
    kindLabel: "Tipo",
    kindText: "Texto",
    kindVoice: "Voz",
    kindTickets: "Tickets",
    /* Said where it is chosen, because that is where the choice goes wrong. A
       tickets room is a text room underneath: whoever uses an older version
       sees it as a conversation, and loses nothing of what was said there. */
    ticketsNote: "Cada pedido de ajuda é um ticket, com o seu estado.",
    note: "Esconder uma sala só arruma a lista. Todos os membros do canal a podem ler.",
    nameRequired: "A sala precisa de um nome.",
    create: "Criar",
    creating: "A criar…",
    created: "Sala criada.",
    afkLabel: "Sala AFK",
    afkNote: "Quem estiver silenciado numa sala de voz vem para aqui sozinho. Só há uma sala AFK por canal.",
  },

  /**
   * The tickets room: the board, and what each state means.
   *
   * Two honesties the screen has to say and cannot disguise. The first is the
   * usual one for rooms: whoever is in the channel has the keys to all of
   * them, and a ticket is not a private conversation with whoever handles it.
   * The second is that of forward secrecy: the board is what THIS device
   * heard, and whoever joined after a ticket was opened may not have it.
   *
   * Neither is a fault, so neither is written as an error notice. They are the
   * price of there being no server that knows what is going on, and the place
   * to say them is where the person is looking at the consequence.
   */
  tickets: {
    title: "Tickets",
    empty: "Ainda não há tickets nesta sala.",
    emptyHint: "Abre um para pedir ajuda. Quem está neste canal vê-o.",
    open: "Abrir ticket",
    subjectLabel: "Assunto",
    subjectPlaceholder: "Impressora avariada",
    subjectRequired: "O ticket precisa de um assunto.",
    create: "Abrir",
    creating: "A abrir…",
    /* The three states, in the words they are read in. The names that travel on
       the wire are different and in English, like the whole protocol: here it is the label. */
    stateOpen: "Aberto",
    stateWorking: "Em curso",
    stateClosed: "Fechado",
    filterAll: "Todos",
    openedBy: (quem: string): string => `Aberto por ${quem}`,
    attendedBy: (quem: string): string => `Atende ${quem}`,
    unattended: "Por atender",
    take: "Atender",
    release: "Largar",
    close: "Fechar ticket",
    reopen: "Reabrir",
    /* Deleting a closed ticket, with the `moderar` power (phase 3). */
    delete: "Eliminar ticket",
    deleteTitle: (assunto: string): string => `Eliminar o ticket "${assunto}"?`,
    deleteConfirm: "O ticket sai do quadro de todos os membros. Não se pode reabrir. Quem já o leu, já o leu.",
    replyPlaceholder: "Responder neste ticket",
    send: "Responder",
    back: "Voltar ao quadro",
    count: (n: number): string => (n === 1 ? "1 mensagem" : `${n} mensagens`),
    noSubject: "Ticket sem assunto",
    /* The case forward secrecy creates, said where it appears. Without this
       sentence, a ticket with no subject reads as a defect of the application. */
    noSubjectHint:
      "A primeira mensagem deste ticket é de antes de entrares no canal. Não a podes ver.",
    partial:
      "Os tickets abertos antes de entrares no canal podem não aparecer aqui.",
    /* The same caveat the rooms already make, where it is new: a ticket looks
       like a reserved conversation, and it is not. */
    note: "Todos os membros do canal podem ler os tickets.",
  },

  /**
   * Creating a category, which is something other than creating a room.
   *
   * Both opened the same sheet. The sentence that was here said "uma categoria
   * nasce com o primeiro canal que a usa": the data model talking, in a place
   * where the reader only wants to tidy the list.
   */
  newCategory: {
    title: "Nova categoria",
    lead: "Agrupa salas na lista. Depois de a criares, arrasta salas para dentro.",
    nameLabel: "Nome",
    namePlaceholder: "Direcção",
    nameRequired: "A categoria precisa de um nome.",
    note: "Apagar uma categoria não apaga as salas dela.",
    create: "Criar",
    creating: "A criar…",
    created: "Categoria criada. Arrasta-lhe salas para dentro.",
  },

  /**
   * Who sees a category's rooms, and what that is NOT.
   *
   * The most important sentence in this block is `note`, and what it prevents
   * is a person closing a category to a role and leaving thinking they closed
   * a conversation. They did not: whoever is in the channel has the keys to all
   * its public rooms, because the room is not a cryptographic group: it is a
   * label inside the channel's group. This sheet TIDIES the list.
   *
   * It is the same frankness as `newRoom.note`, which already said this in
   * another way, and as `roles.note`, which separates what the encryption
   * guarantees from what clients agree among themselves. None of these
   * sentences is shortened: they are the difference between an honest product
   * and one that sells protection for tidying.
   *
   * The `note` goes ABOVE the boxes, not in small print at the end. A warning
   * read after deciding is not a warning, it is an excuse.
   */
  categoryProperties: {
    title: "Quem vê esta categoria",
    lead: "Escolhe quem vê as salas desta categoria.",
    note: "Esconder só arruma a lista. Todos os membros do canal podem ler estas salas. Para separar conversas, cria outro canal.",
    /* The three choices, and the caption that covers them.

       "Todos" comes first because it is the case of almost every category, and
       it became a named option instead of the absence of a choice: boxes all
       empty read as "nobody", which is the opposite of what they mean.

       "Só quem administra" is the tightest restriction this can express:
       whoever administers always sees it, so there is no fourth, tighter
       choice below it. */
    audienceLabel: "Quem vê",
    everyoneOption: "Todos",
    adminsOption: "Só quem administra",
    rolesOption: "Cargos específicos",
    rolesLabel: "Cargos",
    everyone: "Todos os membros do canal",
    /* The built-in role's name is not declared and does not appear in the roles
       list: saying it always sees spares the question. */
    adminNote: "Os administradores vêem sempre todas as categorias.",
    defaultRoomNote: "A sala por omissão está sempre visível.",
    noRoles: "Este canal ainda não tem cargos. Cria um nas propriedades do canal.",
    /* The same statement, for whoever CAN create the role right here: without
       the redirect, which would stop being true with the form just below.
       Whoever cannot manage roles still reads the sentence above. */
    noRolesYet: "Este canal ainda não tem cargos.",
    creating: "A criar…",
    save: "Guardar",
    saving: "A guardar…",
    saved: (categoria: string): string => `Guardado quem vê ${categoria}.`,
    /* How many rooms the gesture just took out of someone's list. It serves to
       let the person understand the effect is on the LIST and nothing else.

       Zero is the NORMAL case and not an oddity: a category is born empty, and
       choosing who sees it is one of the first gestures made on it. "0 salas
       saem da lista" read as "this does nothing", which is false: the
       restriction stays written and applies to the rooms that end up there. */
    hides: (salas: number): string =>
      salas === 0
        ? "Nenhuma sala sai já da lista: a restrição fica a valer para as salas que puseres nesta categoria."
        : salas === 1
          ? "1 sala sai da lista de quem não tiver estes cargos."
          : `${salas} salas saem da lista de quem não tiver estes cargos.`,
    /* The same count for "só quem administra", and the reason it is a separate
       sentence instead of a parameter: with this choice no roles are ticked,
       and "quem não tiver estes cargos" pointed at an empty list. */
    hidesFromNonAdmins: (salas: number): string =>
      salas === 0
        ? "Nenhuma sala sai já da lista: a restrição fica a valer para as salas que puseres nesta categoria."
        : salas === 1
          ? "1 sala sai da lista de quem não administrar o canal."
          : `${salas} salas saem da lista de quem não administrar o canal.`,
  },

  roomProperties: {
    title: "Propriedades do canal",
    lead: "O nome e o ícone que toda a gente vê. Mudam para todos os membros.",
    nameLabel: "Nome",
    topicLabel: "Descrição",
    topicPlaceholder: "Para que serve este canal",
    /* `idLabel` and `idNote` lived here. The identifier no longer appears on
       screen: see the header of `RoomProperties`. */
    pickIcon: "Escolher ícone",
    clearIcon: "Remover",
    /** The image is compressed on this device; this is for when even that is not enough. */
    iconTooBig: "Não foi possível usar essa imagem. Escolhe outra.",
    nameRequired: "O canal precisa de um nome.",
    discard: "Descartar as alterações?",
    save: "Guardar",
    saving: "A guardar…",
    saved: "Propriedades guardadas.",
    readOnly: "Só quem administra este canal pode mudar isto.",
    noOwner: "Este canal não tem administrador. Enquanto assim for, qualquer membro pode mudar estas propriedades.",
    claim: "Assumir a administração",
    claimed: "Passaste a administrar este canal.",
    roleFounder: "Fundador",
    roleAdmin: "Administrador",
    /* The sheet's sections (3/11/2026). See `seccoesDoCanal.ts`. */
    seccoesLabel: "Secções das propriedades",
    seccoes: {
      geral: "Geral",
      salas: "Salas",
      cargos: "Cargos",
      membros: "Membros",
      convites: "Convites",
      moderacao: "Moderação",
      eventos: "Eventos",
    },
    /* The line of each section that has no content yet: says what will be there. */
    salasNota: "Para criar uma sala, usa \"Nova sala\" no menu do canal. Para mudar o nome de uma sala ou para a fechar, abre o menu dessa sala.",
    membrosBreve: "Aqui vai aparecer a lista dos membros do canal, com os cargos de cada um. Para dar um cargo agora, abre o perfil da pessoa.",
    convitesBreve: "Aqui vai aparecer a lista dos convites do canal, com o prazo e os usos de cada um. Para convidar agora, usa \"Convidar\" no menu do canal.",
    moderacaoBreve: "Aqui vão aparecer as pessoas banidas e silenciadas, e as regras automáticas do canal.",
    eventosBreve: "Aqui vai aparecer a sala de eventos: a mensagem para quem entra e o aviso de quem sai.",
    /*
      The founder's reports inbox, in the Moderation section (Task 6 of the
      reports). Nothing about who reported: not the name, not the time, only the day.
    */
    denuncias: {
      titulo: "Denúncias",
      vazio: "Ninguém denunciou nada neste canal.",
      nota: "Cada denúncia chega sem o nome de quem a fez. O servidor também a recebeu.",
      aLer: "A ler as denúncias…",
      motivos: { ...MOTIVOS_DA_DENUNCIA, 8: "Outro" },
      pessoaRotulo: "Pessoa denunciada",
      canalRotulo: "Canal",
      salaRotulo: "Sala",
      provaRotulo: "Prova",
      notaRotulo: "Nota",
      mensagensRotulo: "Mensagens",
      porAbrir: (n: number): string =>
        n === 1
          ? "Há 1 denúncia à espera. Chega quando o aparelho com a chave da conta estiver ligado."
          : `Há ${n} denúncias à espera. Chegam quando o aparelho com a chave da conta estiver ligado.`,
      nova: "Nova",
      verificada: "Verificada",
      naoVerificada: "Não verificada",
      denunciada: "Mensagem denunciada",
      semTexto: "Sem texto.",
      anexo: (nome: string, tipo: string): string => `Anexo: ${nome} (${tipo})`,
    },
  },

  prompts: {
    createRoomTitle: "Criar canal",
    nameLabel: "Nome",
    namePlaceholder: "geral",
    joinTitle: "Entrar com um link",
    joinLabel: "Link do convite",
    joinPlaceholder: "https://orwell.pt/c#…",
    joinHint: "Alguém do canal tem de estar online para te deixar entrar.",
    joinInvalid: "Esse link não é válido.",
    friendTitle: "Adicionar amigo",
    personLabel: "Endereço da pessoa",
    personPlaceholder: "@abc…:servidor",
    /* The address opens that person's profile sheet, where the friend request
       button and the note field are. A single path to ask. */
    friendHint: "Abre o perfil dessa pessoa. Lá pedes amizade, com uma nota se quiseres.",
    friendConfirm: "Ver perfil",
    seatDone: "Entrou. Está no canal a partir de agora.",
    seatAlready: "Esta pessoa já estava no canal.",
    cancel: "Cancelar",
    confirm: "Confirmar",
  },

  /**
   * The house confirmation dialog, which replaced `window.confirm`.
   *
   * The title and verb of each question live with the gesture that asks it.
   * Only what is the same in all of them stays here: Cancel, and the question
   * for sheets that edit.
   */
  confirmar: {
    cancelar: "Cancelar",
    descartarCorpo: "As tuas alterações perdem-se.",
    descartar: "Descartar",
  },

  /**
   * The single invite sheet, with its three modes.
   *
   * It used to be an invite prompt, an add prompt, a link sheet and a list of
   * channels. The sentences of each came here.
   */
  convidar: {
    title: (canal: string): string => `Convidar para ${canal}`,
    modosLabel: "Como convidar",
    modoEndereco: "Por endereço",
    modoLink: "Por link",
    modoMeter: "Adicionar já",
    /**
     * What inviting does, said in full.
     *
     * Inviting puts nobody in the channel: it sends an invite, and the person
     * joins if they accept it. Saying it here keeps whoever invites from
     * waiting for the member list to change by itself.
     */
    enderecoHint:
      "A pessoa recebe o convite numa mensagem privada. Entra se aceitar. Vê as mensagens a partir daí.",
    enderecoAccao: "Enviar convite",
    /*
      Adding, which is the unlicensed sibling of inviting. It exists for the
      case the invite does not solve: someone who should be in the channel and
      is not, and nobody knows when they will be back.
    */
    meterHint:
      "A pessoa entra já, sem ter de aceitar. Vê as mensagens a partir de agora, não as anteriores.",
    meterAccao: "Adicionar já",
    meterPorProvar: "Ainda não foi possível confirmar a entrada. Nada mudou. Tenta daqui a pouco.",
    meterEspera: "Já se meteu esta pessoa há pouco. Espera um pouco e tenta outra vez.",
    meterSemAparelho:
      "A pessoa já está no canal. Um dos aparelhos dela entra quando se ligar.",
    escolherCanal: "Convidar para que canal?",
  },

  /**
   * Moving someone from one voice room to another.
   *
   * The word "pedido" is here on purpose, and in almost all these sentences.
   * Moving is an agreement between clients, like inviting and renaming, and
   * has none of the force of kicking: whoever receives the request honours it
   * because their client decided to honour it, and a modified client stays
   * where it is. Calling it an order would promise protection where there is
   * only tidying.
   */
  /**
   * Tidying channels: the order, the categories and the ones that were closed.
   *
   * "Fechado" and not "apagado", in all these sentences and on purpose:
   * closing a channel hides it from the list and nothing else. What was said
   * there stays in the vault and messages that keep arriving still have a
   * place, which is why there is always a way to bring it back, and that is
   * what these words promise.
   */
  rooms: {
    dropBefore: (nome: string): string => `Largar aqui para pôr antes de ${nome}`,
    dropInCategory: (nome: string): string => `Largar aqui para pôr no fim de ${nome}`,

    /*
      Dragging the whole category, which is the third drag in this list.

      The words say what the gesture takes with it: "com as salas dela":
      because that is the doubt it raises: whoever drags a heading does not
      know, before dropping it, whether they are moving the label or the
      block. And they say on which side the category will end up, because
      dropping on another puts it after when going down and before when going
      up: without that, half the drags surprised.
    */
    dragCategory: (nome: string): string => `Arrastar ${nome}, com as salas dela`,
    dropCategoryBefore: (nome: string): string => `Largar aqui para pôr antes de ${nome}`,
    dropCategoryAfter: (nome: string): string => `Largar aqui para pôr depois de ${nome}`,
    /* Each declaration is an independent encrypted message: if some fail, the
       list ends up half tidied. They are named, because those are the ones the
       gesture is repeated for: and repeating breaks nothing. */
    categoryOrderPartial: (nomes: string): string => `A ordem não mudou em ${nomes}. Arrasta outra vez.`,
    closedTitle: "Fechados",
    reopen: "reabrir",
    reopenTitle: (nome: string): string => `Mostrar ${nome} outra vez`,
    reopened: (nome: string): string => `${nome} está outra vez na lista.`,

    /*
      Deleting, which is the step after closing and not an alternative to it.

      Only what is already closed is deleted: closing is reversible, deleting
      is not, and forcing the first is the best protection there is against
      mistakes: nobody deletes a room with a distracted click in a list in
      front of their eyes.

      The confirmation sentence has one thing that must not be missing, the
      same requirement as the delete category warning: saying what does NOT
      happen. Here what does not happen is deleting messages: not for lack of
      will, but because there is no way to. They are encrypted in each
      person's vault, the server never had them in the clear, and whoever
      deletes the room cannot reach them. Any word suggesting otherwise would
      be a lie about the only thing this product promises.
    */
    remove: "eliminar",
    removeTitle: (nome: string): string => `Eliminar ${nome}`,
    removeRoomTitle: (nome: string): string => `Eliminar "${nome}"?`,
    removeConfirm:
      "A sala desaparece para todos. Não podes desfazer isto. As mensagens dela passam para a sala por omissão.",
    removeAction: "Eliminar sala",
    /* Joined to the sentence above when the room is a voice room. Leaving this
       to chance would pull the floor from whoever is talking, with no warning at all. */
    removeVoiceNote: "Quem estiver na chamada dessa sala sai dela.",
    removed: (nome: string): string => `"${nome}" eliminada. O que lá foi dito lê-se na sala por omissão.`,
    /*
      Closing does not ask: it is reversible, and confirming the reversible
      teaches people to press «sim» without reading. The toast says what
      happened and brings the way back. The default room has its own sentence,
      because it is where messages without a room land, and closing it does
      not change that.
    */
    closed: (nome: string): string => `Fechaste "${nome}". Nada foi apagado.`,
    closedDefault:
      "Fechaste a sala por omissão. As mensagens sem sala continuam a ir para lá. Nada foi apagado.",
    showAgain: "Mostrar de novo",

    /*
      Categories: labels, not boxes.

      The category is the name written in each room's `category` field: there
      is no folder at all, and nothing inside. Deleting it removes the label
      and the rooms are left loose. Whoever reads "apagar categoria" fears the
      opposite, and it is exactly at the moment of confirming that this fear
      has to be undone: hence the warning saying, in numbers, how many rooms
      are NOT deleted.
    */
    /* Renaming to a name that already exists merges the two, because two equal
       labels are the same label. It is the right behaviour, so it is not
       refused: it is said before it happens, so it is not a surprise. */
    mergeCategoryTitle: "Juntar as duas categorias?",
    mergeCategoryConfirm: (nome: string, quantos: number): string =>
      `Já existe uma categoria chamada "${nome}". ${quantos === 1 ? "A sala passa" : `As ${quantos} salas passam`} para lá, e as duas ficam uma só.`,
    mergeCategoryAction: "Juntar",
    categoryRenamed: (de: string, para: string): string => `"${de}" passou a chamar-se "${para}".`,
    /*
      Deleting a category no longer asks: it removes a label and deletes no
      room, so it can be undone. The toast counts how many rooms were NOT
      deleted, which was the old warning's job, and brings «Desfazer».
    */
    categoryDeleted: (nome: string, quantos: number): string =>
      quantos === 0
        ? `Categoria "${nome}" apagada.`
        : `Categoria "${nome}" apagada. ${quantos === 1 ? "A sala continua na lista." : `As ${quantos} salas continuam na lista.`}`,
    categoryUndo: "Desfazer",
    categoryRestored: (nome: string): string => `A categoria "${nome}" voltou, com as salas dela.`,
    /** The same, for a category that had no rooms. */
    categoryRestoredEmpty: (nome: string): string => `A categoria "${nome}" voltou.`,
    /*
      The halfway point, which is what must not happen silently.

      Changing a category is one post PER ROOM. If some fail, the rooms end up
      split between two names and the category breaks in two in the list:
      without this said, nobody knew why. The ones left behind are named
      because those are what the gesture is repeated for: repeating is
      harmless, each post only says where the room is.
    */
    /* `nomes` already comes written and `quantos` apart, like the rest of this
       file: they are all scalars going in. The count is needed for the
       sentence to agree and is not read from the list, which here is already text. */
    categoryPartial: (nomes: string, quantos: number): string =>
      `${nomes} não ${quantos === 1 ? "mudou" : "mudaram"} de categoria. Verifica a ligação e tenta outra vez.`,
  },

  voiceMove: {
    /**
     * The label of the destinations block, inside the person's menu.
     *
     * The menu is the PERSON's (profile, address, message) and the
     * destinations are an addition. They came after a separator and nothing
     * else, so with four voice rooms the menu ended in four loose lines under
     * "Copiar endereço", with nothing saying that was a different kind of
     * gesture.
     */
    group: "Mover para outra sala",
    /* The single entry in the person's menu, which opens the room ladder (2/11/2026). */
    menu: "Mover para",
    /* The rooms without a category, at the end of the ladder. */
    noCategory: "Sem categoria",
    /* On the phone the ladder opens as a sheet, and this entry goes back to the menu. */
    back: "Voltar",
    disconnect: "Desligar da chamada",
    disconnected: (nome: string): string => `Desligaste ${nome} da chamada.`,
    disconnectedYou: (quem: string): string => `${quem} desligou-te da chamada.`,
    personTitle: (nome: string): string => `Arrastar ${nome} para outra sala de voz, ou clicar para escolher`,
    /* For whoever CANNOT move anyone: the menu opens anyway, with the profile
       and the address inside, but promising a drag the core refuses would send
       the person to try a gesture that does not exist for them. */
    personMenuTitle: (nome: string): string => `Opções de ${nome}`,
    dropTitle: (sala: string): string => `Largar aqui para mover para ${sala}`,
    to: (sala: string): string => `Mover para ${sala}`,
    /* Moving is not asking (2/11/2026, «como no Discord»): the person moves at once. */
    sent: (nome: string, sala: string): string => `Moveste ${nome} para ${sala}.`,
    moved: (quem: string, sala: string): string => `${quem} moveu-te para ${sala}.`,
  },

  emoji: {
    open: "Emojis",
    title: "Emojis",
    searchLabel: "Procurar emoji pelo nome",
    searchPlaceholder: "Procurar…",
    recents: "Recentes",
    results: "Resultados",
    noResults: "Nenhum emoji com esse nome.",
    close: "Fechar",
    /** The tab labels of `components/emoji.ts`, by each category's `id`. */
    categorias: {
      rostos: "Rostos",
      gestos: "Gestos e pessoas",
      natureza: "Natureza",
      comida: "Comida e bebida",
      actividades: "Actividades",
      viagens: "Viagens e lugares",
      objectos: "Objectos",
      simbolos: "Símbolos",
      bandeiras: "Bandeiras",
    },
  },

  /**
   * Another person's profile.
   *
   * Everything here is reading. And the two long sentences are the heart of
   * it: when nothing arrived, the screen has to say *that nothing arrived on
   * this device* and why. An empty page would read as "this person has
   * nothing", which is a lie about another person; and the only way to
   * disprove it would be asking the server who is behind an address, which is
   * the question this application exists to keep it from answering.
   */
  personProfile: {
    openHint: (name: string): string => `Ver o perfil de ${name}`,
    /** Only for screen readers: on screen, the name is in the sheet's body. */
    title: (name: string): string => `Perfil de ${name}`,
    postsListLabel: (name: string): string => `Publicações de ${name}`,
    back: "Voltar ao perfil",
    message: "Mensagem",
    unknown:
      "Ainda não temos o nome nem a imagem desta pessoa. Aparecem quando ela os partilhar num canal onde estejam os dois.",
    emptyTitle: "Nada para ler desta pessoa.",
    emptyBody:
      'Ainda não chegou nenhuma publicação desta pessoa. Carrega em "Pedir as publicações" para as pedir.',
    /*
      The button that asks for the posts again.

      The tooltip says the last 30 because that is what `republishPosts`
      publishes, and promising the whole history would be lying: the rest was
      encrypted for a seat that no longer exists. It also says it is not
      instant: the request reaches their device, and it is their device that
      answers.
    */
    askPosts: "Pedir as publicações",
    askPostsHint: (name: string): string =>
      `Pede a ${name} as últimas 30 publicações. Só funciona com ${name} online. Pode demorar um minuto. As publicações mais antigas não voltam.`,
    askPostsSent: (name: string): string => `Pedido enviado a ${name}. As publicações aparecem quando chegarem.`,
    /** The tab with the friends list the person chose to show. */
    friendsTab: "Amigos",
    friendsListLabel: (name: string): string => `Amigos de ${name}`,
    /*
      The person's page: the arrow, the tabs and what each says when it has
      nothing. Short, active sentences, one term per thing (STE100).
    */
    backFromPage: "Voltar",
    tabsLabel: (name: string): string => `Secções do perfil de ${name}`,
    postsTab: "Publicações",
    sharedTab: "Em comum",
    friendsHidden: (name: string): string => `${name} não mostra a lista de amigos.`,
    friendsOnlyFriends: (name: string): string => `A lista de amigos de ${name} só aparece aos amigos de ${name}.`,
    friendsEmpty: (name: string): string => `A lista de amigos de ${name} está vazia.`,
    sharedListLabel: (name: string): string => `Canais em comum com ${name}`,
    sharedLoading: "A procurar os canais em comum.",
    sharedEmpty: "Não há canais em comum.",
    deafNote: (name: string): string => `Este aparelho não consegue ler as publicações de ${name}.`,
  },

  /*
    Polls, in the conversation and in the feed.

    The sentence that must not be missing is that votes are visible, and it
    appears twice on purpose: to whoever creates, before creating, and to
    whoever reads, before voting. Whoever votes is not who wrote the question,
    and a warning only the author saw would be a warning given to the wrong
    person.

    What it says is the truth of the cryptography and not a product
    preference: in an end-to-end encrypted channel, whoever is there decrypts
    everything the channel says. A "secret" vote travelling the same path
    would be secret from the server and from nobody else. Promising it would
    be lying.
  */
  votacao: {
    /** The entry in the `+` menu, in the conversation, and the feed button. */
    criar: "Criar votação",
    titulo: "Nova votação",
    perguntaLabel: "Pergunta",
    perguntaPlaceholder: "O que queres perguntar?",
    opcaoLabel: (numero: number): string => `Opção ${numero}`,
    opcaoPlaceholder: "Resposta",
    acrescentar: "Acrescentar opção",
    /* Removing an option while writing the poll. Nothing to do with withdrawing
       a vote: a created poll is not edited, and there is no way to. */
    retirarOpcao: (numero: number): string => `Retirar a opção ${numero}`,
    /* The cap comes from the protocol, and the sheet says so instead of the
       button disappearing without explanation. */
    opcoesCheias: (maximo: number): string => `Não cabem mais do que ${maximo} opções.`,
    /* "Criar" and not "Criar votação": inside a sheet already called "Nova
       votação", repeating the word is noise, and the feed button, on the other
       hand, has to say what it creates because it sits next to three others. See `newRoom`. */
    confirmar: "Criar",
    /*
      The two things whoever creates has to know BEFORE creating, and they are
      the two decisions of this design.

      No deadline because there is no shared clock: each device has its own,
      and a message's timestamp is its sender's claim. A deadline would close
      at different instants on each screen, accepting on one device the vote
      another refused, and without a server there is nobody to break the tie.
    */
    nota: "Todos vêem os votos. A votação fica aberta, sem prazo.",

    /* On the card, to whoever is about to vote. Short, because it is always on screen. */
    votosVisiveis: "os votos são visíveis",
    votosVisiveisAjuda:
      "Todos os membros do canal vêem o voto de cada pessoa.",
    total: (quantos: number): string => (quantos === 1 ? "1 voto" : `${quantos} votos`),
    semVotos: "Ainda ninguém votou.",
    votarEm: (opcao: string): string => `Votar em ${opcao}`,
    retirarVoto: (opcao: string): string => `Retirar o voto em ${opcao}`,
    /*
      Who voted for each option, said by names and not by a number: this is
      what makes the warning above true instead of theoretical.

      `restantes` are the ones that did not fit on the line. Zero closes the
      list with "e", as read aloud; above zero it closes with "e mais N", which
      says the list was cut and not that it ended.

      Built with a loop and without `join`, just as `typing` above is built
      with indices: the brand boundary walks ALL the functions in this file and
      calls them with a sample string. One that only works on an array breaks
      that audit, and what is lost is not this label: it is the check that no
      visible text says the wrong word.
    */
    quemVotou: (nomes: string[], restantes = 0): string => {
      let lista = ""
      for (let indice = 0; indice < nomes.length; indice += 1) {
        const nome = nomes[indice] ?? ""
        if (indice === 0) lista = nome
        else if (indice === nomes.length - 1 && restantes === 0) lista = `${lista} e ${nome}`
        else lista = `${lista}, ${nome}`
      }
      return restantes > 0 ? `${lista} e mais ${restantes}` : lista
    },
    votoFalhou: "não foi possível registar o voto",
    /* The poll written out in full, which is what travels in the message body
       so a client that cannot draw it can still read it. */
    linhaDeOpcao: (numero: number, texto: string): string => `${numero}. ${texto}`,
  },
  /**
   * «Como funciona»: six ideas, one card per idea (phase 6, layer 2).
   *
   * The source is `docs/COMO-FUNCIONA-A-MIUDOS.html`, and the text follows it
   * closely. Two changes are on purpose: the interface does not name another
   * company (the document compares with Discord; here it says «noutras apps
   * de conversa»), and each card opens with two sentences, because that is
   * what is read on screen without pressing anything. The rest goes to «Ler
   * mais».
   *
   * The drawings' labels also live here: an SVG in Portuguese on the English
   * screen is a drawing that cannot be read.
   */
  comoFunciona: {
    /* «Como funciona o Orwell» (owner, 28 October 2026); the registration link stays «Como funciona». */
    titulo: "Como funciona o Orwell",
    /** The link in the gate's footer. */
    link: "Como funciona",
    lead: "Seis ideias sobre o que acontece por dentro do Orwell. Cada uma tem um desenho.",
    /** The card in Help and diagnostics. */
    cartaoLead: "Seis ideias curtas, cada uma com um desenho. Mostram o que o servidor sabe de ti, o que fica só no teu aparelho, e porque é que o Orwell funciona assim.",
    ver: "Ver como funciona",
    lerMais: "Ler mais",
    lerMenos: "Ler menos",
    /** Phase 8.1: said in Devices and on the devices card. */
    umaContaChega: "Uma conta chega para todos os teus aparelhos.",
    carteiro: {
      titulo: "O servidor é um carteiro que não sabe ler",
      resumo: "A tua mensagem sai do aparelho fechada num envelope. O servidor só lê a morada do canal e entrega o envelope.",
      mais: [
        "Noutras apps de conversa, a mensagem chega ao servidor aberta. A empresa guarda o texto, quem escreveu, para quem e quando.",
        "O servidor do Orwell guarda uma cópia fechada para quem estava desligado. A chave que abre o envelope só existe nos aparelhos de quem está na conversa.",
        "A isto chama-se cifra de ponta a ponta. Uma ponta é o teu aparelho. A outra ponta é o aparelho de quem lê. Tudo o que está no meio só vê envelopes.",
      ],
      desenho: "Noutra app, o servidor abre a mensagem e guarda o texto. No Orwell, o servidor só vê um envelope fechado e a morada do canal.",
      outraApp: "Outra app",
      orwell: "Orwell",
      ana: "Ana",
      rui: "Rui",
      ola: '"olá"',
      servidor: "servidor",
      leEGuarda: 'lê e guarda "olá"',
      soAMorada: "vê só a morada do canal",
      nota: ["A chave que abre o", "envelope só existe nos", "aparelhos da Ana e do Rui."],
    },
    chave: {
      titulo: "A conta é uma chave, não um email com palavra-passe",
      resumo: "Quando crias a conta, o teu aparelho gera uma chave. O teu endereço é um resumo dessa chave, e o servidor só conhece o resumo.",
      mais: [
        "A chave vive no cofre do aparelho. A palavra-passe abre o cofre e nunca sai do aparelho.",
        'Não há "esqueci a palavra-passe". Ninguém tem a palavra-passe senão tu. Se a perderes, o cofre fica fechado para sempre.',
        "O ficheiro de exportação é a conta. Quem tem o ficheiro e a palavra-passe tem a conta. Guarda-o como guardas um passaporte.",
        "O servidor não te conhece. Não tem nome, email, telefone nem fotografia. O nome e a fotografia viajam dentro dos envelopes, só para os teus amigos.",
      ],
      desenho: "A chave gera o endereço. A chave e as mensagens ficam no cofre do aparelho. A palavra-passe abre o cofre. O servidor só conhece o endereço.",
      oTeuAparelho: "o teu aparelho",
      cofre: "cofre",
      chaveDaConta: "chave da conta",
      chavesDosCanais: "chaves dos canais",
      mensagensLidas: "mensagens lidas",
      palavraPasse: "palavra-passe",
      abre: "abre",
      resumoDaChave: "resumo da chave",
      endereco: "@duarte:orwell.pt",
      soIsto: "servidor: só isto",
      semVolta: ["não dá para", "voltar atrás"],
    },
    cofre: {
      titulo: "O cofre é o único sítio onde o histórico existe",
      resumo: "O teu aparelho abre cada mensagem e guarda-a no cofre, que está cifrado. O servidor guarda o envelope fechado durante uns dias, e depois apaga-o.",
      mais: [
        "As chaves dos canais mudam a cada mensagem, como uma catraca que só roda para a frente. Quando o aparelho abre uma mensagem, gasta a chave dessa posição.",
        "Por isso não podes pedir outra vez ao servidor uma mensagem que já leste. Se o cofre se perde, as mensagens perdem-se.",
        "A isto chama-se sigilo para a frente. Se alguém roubar as chaves de hoje, não lê o que foi dito ontem.",
        'A pesquisa corre no teu aparelho, dentro do cofre. "Fechar conversa" esconde a conversa. Não a apaga.',
      ],
      desenho: "O cofre do aparelho guarda as mensagens lidas. O servidor guarda só envelopes fechados, durante uns dias. A chave do canal muda a cada mensagem e não volta atrás.",
      oTeuAparelho: "o teu aparelho",
      cofre: "cofre",
      mensagensEmClaro: "mensagens lidas",
      cifrado: "fechado pela palavra-passe",
      servidor: "servidor",
      envelopes: "envelopes fechados",
      unsDias: "só uns dias",
      catraca: "a chave muda a cada mensagem e só roda para a frente",
    },
    canal: {
      titulo: "Um canal é um grupo com uma chave que muda",
      resumo: "Os membros de um canal partilham uma chave. Cada vez que alguém entra ou sai, a chave muda, e a cada mudança chama-se época.",
      mais: [
        "Quem entra num canal não vê a conversa antiga. O convite dá um lugar numa época, e não há chave para as anteriores. O mural e os tickets chegam, porque outros membros os reenviam.",
        "Expulsar é feito pela cifra. A chave muda, e a pessoa expulsa deixa de a ter. Nem o servidor nem uma app alterada conseguem dar a volta.",
        "Eliminar o canal não apaga as mensagens. Cada pessoa tem as suas no seu cofre.",
        "O protocolo dos grupos é o MLS (RFC 9420). A cifra é pós-quântica híbrida: para partir uma mensagem, é preciso partir as duas metades.",
      ],
      desenho: "Uma linha de épocas de um canal. O Rui entra na época 3 e lê a partir daí. Não lê as épocas 1 e 2. Quando a Ana sai, a época muda para 5 e a Ana deixa de ler.",
      tempo: "tempo",
      cadaCirculo: "cada círculo é uma época: uma chave nova para o grupo",
      ruiEntra: "o Rui entra: é o lugar dele",
      anaSai: "a Ana sai",
      ruiLe: "o Rui lê daqui para a frente",
      ruiNaoLe: "o Rui não lê isto: foi antes do lugar dele",
      anaLeu: "a Ana leu até aqui, e o que já tinha, continua a ter",
      anaNaoLe: "a Ana não lê isto",
    },
    aparelhos: {
      titulo: "Uma conta, vários aparelhos",
      /** Comes after `umaContaChega`: the card's two sentences. */
      resumo: "Cada aparelho tem a sua chave, e a chave da conta assina-a.",
      mais: [
        "O aparelho principal tem a chave da conta. Só ele exporta a conta, acrescenta aparelhos e revoga aparelhos.",
        "Para acrescentar um aparelho, emparelha-o. O segredo passa de um ecrã para uma câmara, por QR ou link, e nunca pelo servidor. Os dois ecrãs mostram seis palavras. Se forem iguais, ninguém se meteu no meio.",
        "Importar o ficheiro noutra máquina não acrescenta um aparelho. Muda a conta de sítio. Para ter dois aparelhos, emparelha. Não cries outra conta.",
        "Revogar um aparelho corta a leitura a partir da época seguinte. O que o aparelho já tinha, continua a ter.",
      ],
      desenho: "A chave da conta, no aparelho principal, assina as chaves dos outros aparelhos. Emparelhar passa pelo servidor num cofre temporário que o servidor não abre. Os dois aparelhos comparam seis palavras.",
      principal: "aparelho principal",
      chaveDaConta: "chave da conta",
      chaveDoAparelho1: "chave do aparelho 1",
      soEste: "só este exporta, acrescenta e revoga",
      novo: "aparelho novo",
      chaveDoAparelho2: "chave do aparelho 2",
      assinada: "assinada pela conta",
      semChaveDaConta: "sem a chave da conta",
      servidor: "servidor",
      cofreTemporario: "cofre temporário, fechado",
      segredo: "o segredo vai por QR ou link, de ecrã para câmara, nunca pelo servidor",
      seisPalavras: "os dois ecrãs mostram seis palavras: se forem iguais, ninguém se meteu no meio",
    },
    servidor: {
      titulo: "O que o servidor vê",
      resumo: "O servidor vê envelopes fechados, moradas de canais e endereços sem nome. Não vê o texto, nem quem escreveu, nem a voz.",
      mais: [
        "Sabe: um endereço por conta, a que canais cada conta está ligada, e quantos aparelhos cada conta tem. Vê envelopes com o tamanho arredondado a blocos de 512 bytes, e sabe que alguém escreveu num canal, ao minuto.",
        "Não sabe: o texto das mensagens, quem escreveu cada mensagem, nomes, fotografias, reacções, menções, anexos, voz e vídeo. Não tem nenhuma palavra-passe, nem um resumo dela.",
        "A fraqueza conhecida: numa conversa privada, os dois endereços fazem parte da morada. Quem tiver a base de dados do servidor vê quem fala com quem, por endereços sem nome. Não vê o que dizem. É a próxima coisa a corrigir no protocolo.",
      ],
      desenho: "Duas colunas. O que o servidor sabe: endereços, canais, envelopes de tamanho igual, a hora. O que não sabe: o texto, quem escreveu, nomes, voz e vídeo, a palavra-passe.",
      sabe: "Sabe",
      naoSabe: "Não sabe",
      listaSabe: ["um endereço por conta", "os canais de cada conta", "envelopes de tamanho igual", "a hora, ao minuto"],
      listaNaoSabe: ["o texto", "quem escreveu", "nomes e fotografias", "voz e vídeo", "a palavra-passe"],
    },
  },

  /**
   * The sentences at the right moment (phase 6, layer 1): once each, with a tap
   * to close. Whoever closed one does not see it again on this device
   * (`Prefs.frasesVistas`). See `FraseDoMomento`.
   */
  frasesDoMomento: {
    conta: "A tua conta é uma chave neste aparelho. Ninguém a pode repor. Guarda a palavra-passe.",
    canal: "Vês a conversa a partir de agora. O que foi dito antes fica com quem lá estava.",
    entendi: "Entendi",
  },
  /*
    «Partilhar áudio» in the call (phase 9 of `docs/planos/definicoes-0-9.md`).

    The DJ talks and plays at the same time: the music is a second track,
    next to the voice. In this version only the first source is wired (files
    or playlist); the others appear disabled, with the sentence saying why for
    THIS device (see `lib/fontesDeAudio.ts`). Short sentences, active voice,
    one term per thing.
  */
  musica: {
    partilharAudio: "Partilhar áudio",
    /** The bar button, with the state in front, like `screenAria`. */
    partilharAudioAria: (aPartilhar: boolean): string =>
      aPartilhar ? "A partilhar áudio. Abrir a lista." : "Partilhar áudio.",
    fechar: "Fechar",
    fontes: "De onde vem o som",
    /** The name of each source in the picker. */
    fonte: (fonte: string): string => {
      switch (fonte) {
        case "separador":
          return "Separador do browser"
        case "sistema":
          return "Som do sistema"
        case "janela":
          return "Uma janela ou aplicação"
        default:
          return "Ficheiros ou lista"
      }
    },
    /** Why a source is disabled ON THIS device. See `fontesDeAudioDoAnfitriao`. */
    porqueNao: (codigo: string): string => {
      switch (codigo) {
        case "separador-sem-browser":
          return "Este browser não dá o áudio de um separador."
        case "sistema-so-na-app":
          return "Só na app de secretária, em Windows e macOS 14.2 ou mais."
        case "sistema-sem-browser":
          return "Este browser não dá o som do sistema."
        case "sistema-linux":
          return "Em Linux, a app não recebe o som do sistema."
        case "janela-sem-browser":
          return "Nenhum browser dá o áudio de uma só janela. Só na app de secretária, em Windows e macOS."
        case "janela-linux":
          return "Em Linux, a app não recebe o áudio de uma só janela."
        default:
          return "Ainda não está nesta versão."
      }
    },
    escolherFicheiros: "Escolher ficheiros",
    escolherPasta: "Escolher uma pasta",
    formatos: "Ficheiros .mp3, .m4a, .ogg, .flac ou .wav.",
    nenhumAudio: "Nenhum destes ficheiros é áudio. Escolhe ficheiros .mp3, .m4a, .ogg, .flac ou .wav.",
    listaVazia: "A lista está vazia. Escolhe ficheiros para tocar.",
    lista: "Lista",
    tocar: "Tocar",
    pausar: "Pausar",
    saltar: "Saltar",
    baralhar: "Baralhar",
    /** «Parar» takes the music out of the call. The playlist stays. */
    parar: "Parar",
    pararAria: "Parar de partilhar áudio",
    tocarEsta: (nome: string): string => `Tocar ${nome}`,
    remover: (nome: string): string => `Tirar ${nome} da lista`,
    /** The sign on the panel and on the person's card. */
    aTocar: (nome: string): string => `A tocar: ${nome}`,
    emPausa: "Música em pausa",
    /** How much the DJ hears themselves. It does not change what the others hear. */
    volumeLocal: "Volume para ti",
    /** On the listener's side: separate from the volume of the person's voice. */
    volumeDaMusica: (nome: string): string => `Volume da música de ${nome}`,
    /**
     * The captured sources (tab, system, window), 2/11/2026. The name that goes
     * in the announcement when the tab's or window's is not known: whoever
     * listens reads «A tocar: Som do sistema».
     */
    origem: (fonte: string): string => {
      switch (fonte) {
        case "separador":
          return "Um separador do browser"
        case "janela":
          return "Uma janela"
        default:
          return "Som do sistema"
      }
    },
    /** The button that opens the picker for the chosen source. */
    escolherFonte: "Escolher e partilhar",
    /** The source on air. */
    aPartilharFonte: (origem: string): string => `A partilhar: ${origem}`,
    pararFonte: "Parar este som",
    /** What happens next, per source and per host. Read before the click. */
    notaDaFonte: (fonte: string, secretaria: boolean): string => {
      if (fonte === "separador") {
        return secretaria
          ? "Na app não há separadores. Escolhe a janela do browser. Vai o som do sistema inteiro."
          : "Escolhe o separador no selector do browser. A caixa do áudio vem marcada. Os outros não vêem o separador."
      }
      if (fonte === "janela") {
        return "Escolhe a janela. O sistema não separa o som de uma só janela: vai o som do sistema inteiro. Os outros não vêem a janela."
      }
      return secretaria
        ? "Vai tudo o que o computador toca. Os outros não vêem o ecrã."
        : 'Escolhe o ecrã inteiro e marca a caixa "Partilhar também o áudio do sistema". Os outros não vêem o ecrã.'
    },
    /** In the app, loopback carries the app's own sound. There is no proof that Electron removes it. */
    ecoNaApp: "Na app, este som pode levar a voz da chamada. Os outros podem ouvir-se com atraso. Para o evitar, desliga o som da chamada.",
  },
  /**
   * What is new in the 0.9 settings (phase 4, mockup «Orwell Definições 0.9»,
   * section 3). A separate block, so as not to touch the `settings` keys
   * other hands are changing at the same time.
   */
  definicoesNovas: {
    /** The Account card with «Terminar sessão» and «Bloquear sozinho». */
    sessao: "Sessão",
    /* «Expirar sessão», and not «Bloquear sozinho» (owner, 28 October 2026). */
    bloquearSozinho: "Expirar sessão",
    bloquearSozinhoNota: "Se não usares o Orwell durante este tempo, a sessão termina neste aparelho. Para voltar, entras com a palavra-passe. Durante uma chamada, a sessão não termina.",
    /** The «Bloquear sozinho» pills, in the order of `TEMPOS_DE_BLOQUEIO`. */
    tempoDeBloqueio: (minutos: number): string => (minutos === 0 ? "Nunca" : minutos < 60 ? `${minutos} min` : `${minutos / 60} h`),
    /** «Pausar» in Notifications: mutes everything except calls, for a while. */
    pausar: "Pausar",
    pausarNota: "Silencia tudo menos as chamadas, durante um tempo.",
    duracaoDaPausa: (duracao: "1h" | "8h" | "amanha"): string =>
      duracao === "1h" ? "1 h" : duracao === "8h" ? "8 h" : "Até amanhã",
    /** The time already comes written (`14:30`). `amanha` says whether the pause ends on another day. */
    emPausaAte: (hora: string, amanha: boolean): string =>
      amanha ? `Em pausa até amanhã às ${hora}. Só as chamadas tocam.` : `Em pausa até às ${hora}. Só as chamadas tocam.`,
    retomar: "Retomar",
    /** Microphone and camera: every call entry starts with the microphone muted. */
    entrarSilenciado: "Entrar nas chamadas com o microfone silenciado",
    /** The Camera card: the device, the mirror and the preview. */
    camaraAparelho: "Aparelho",
    camaraDoSistema: "Predefinida do sistema",
    camarasNenhuma: "Este aparelho não tem câmara ligada.",
    camarasSemNome: 'Os nomes das câmaras aparecem depois de abrires a câmara uma vez. Usa "Pré-visualizar a câmara".',
    espelhar: "Espelhar a minha imagem",
    espelharNota: "Só para ti. Os outros vêem-te normal.",
    previa: "Pré-visualizar a câmara",
    previaFechar: "Fechar a pré-visualização",
    previaFalhou: "A câmara não abriu. Verifica as permissões do sistema.",
    previaEmChamada: "Estás numa chamada. A pré-visualização abre quando a chamada acabar.",
    /** Privacy: who can send friend requests, and whether presence is shown. They travel with the account. */
    quemMeEncontra: "Quem me pode encontrar",
    pedidosDeAmizade: "Quem me pode enviar pedidos de amizade",
    regraDosPedidos: (regra: "todos" | "amigos-de-amigos" | "ninguem"): string =>
      regra === "todos" ? "Toda a gente" : regra === "amigos-de-amigos" ? "Amigos de amigos" : "Ninguém",
    pedidosNota:
      "Um pedido de quem não cabe na regra não aparece e não toca. Amigos de amigos são quem partilha um canal ou um amigo contigo.",
    mostrarOnline: "Mostrar quando estou online",
    mostrarOnlineNota: 'Desligado, apareces sempre "Invisível" aos outros.',
    /** Help: «Enviar registo», next to «Copiar registo». */
    enviarRegisto: "Enviar registo",
    aEnviarRegisto: "A enviar…",
    registoEnviado: "registo enviado, obrigado",
    enviarRegistoNota: '"Enviar" manda o registo para o servidor, com o teu endereço e a versão. Sem mensagens. O servidor guarda-o 30 dias.',
  },
  /**
   * The presence ring around faces (owner's request, 27 October 2026). The
   * colour says the state; these words say it to whoever cannot see the colour.
   */
  aneis: {
    /** The yellow state: connected, but idle. */
    away: "ausente",
  },
  /**
   * The button that copies someone's id, next to the name (owner's order on 27
   * October 2026: «não quero os ids expostos»). See `BotaoCopiarId`.
   */
  /**
   * The desktop app's game overlay (owner's request on 2 November 2026): the
   * card in Settings › Voice, and the sentences of the join and leave notice.
   * The notice sentences travel to the overlay window, which does not load
   * this catalogue; the name goes first, highlighted.
   */
  overlayDeJogo: {
    titulo: "Overlay de jogo",
    ligar: "Mostrar a overlay de jogo",
    nota: "Durante uma chamada, a overlay mostra a sala de voz e quem fala, por cima do jogo. Aparece só quando a janela do Orwell não está à frente. Arrasta-a para outro sítio. Faz duplo clique nela para a pôr de novo ao centro.",
    ecraInteiro:
      'Aparece por cima dos jogos em janela e em ecrã inteiro. Alguns jogos antigos em ecrã inteiro exclusivo não a mostram: nesses, escolhe "janela sem bordas".',
    opacidade: "Opacidade do fundo",
    repor: "Pôr ao centro, em cima",
    atalhoNota: 'Para mostrar ou esconder a overlay durante uma chamada, usa o atalho em "Atalhos de teclado".',
    entrou: "entrou na sala",
    saiu: "saiu da sala",
  },
  copiarId: {
    de: (nome: string): string => `Copiar id de ${nome}`,
    proprio: "Copiar o teu id",
    copiado: "id copiado",
  },
  /**
   * Muting a room, a channel or a private conversation (owner's request of 27
   * October 2026). Muted: no sound, no system notification and no number. A
   * mention still lights up. See `lib/silenciados.ts`.
   */
  silencio: {
    silenciar: "Silenciar notificações",
    ativar: "Ativar notificações",
    /** The struck-through bell next to the name, said to whoever cannot see it. */
    marca: "Notificações silenciadas",
  },
  /**
   * Replying to a message, as in Discord (4/11/2026). The bar above the
   * composer, the quote line above the reply, and the three states of an
   * original that cannot be seen. Short sentences, in STE100.
   */
  respostas: {
    responder: "Responder",
    /** Before the name, on the bar above the box: "A responder a Bruno". */
    aResponderA: "A responder a",
    /** The mention toggle. On, the original's author gets a mention. */
    mencionar: "@ Mencionar",
    mencionarLigado: "O autor recebe uma menção. Toca para desligar.",
    mencionarDesligado: "O autor não recebe uma menção. Toca para ligar.",
    cancelar: "Cancelar a resposta",
    /** Said by the screen reader when the bar appears. */
    anuncio: (nome: string) => `A responder a ${nome}. Esc cancela.`,
    irPara: (nome: string) => `Ir para a mensagem de ${nome}`,
    imagem: "Imagem",
    vazia: "Mensagem sem texto",
    apagada: "A mensagem original foi apagada.",
    ausente: "A mensagem original não está neste aparelho.",
    porCarregar: "Carregar a mensagem original",
  },
  /**
   * The broadcast sign next to the face of whoever, in a voice room, shares
   * the screen or plays music (owner's request of 27 October 2026, 23:55).
   * See `MarcaDeTransmissao`.
   */
  transmissao: {
    ecra: "A partilhar o ecrã",
    musica: "A tocar música",
    ambos: "A partilhar ecrã e música",
    /** The label of `MarcaDeChamada`'s `musica` mark, which says who it is about. */
    musicaDe: (nome: string): string => `${nome} está a tocar música`,
  },
  /**
   * «Entrar com outra conta», in the safe order: choose first, delete at the
   * end. See `EntrarComOutraConta`. New keys, and not the `gate` ones, because
   * the old sentence («os dois caminhos apagam primeiro») stopped being true.
   */
  outraConta: {
    lead: "Importar ou emparelhar põe a outra conta no lugar desta. Primeiro escolhes a outra conta. A app só apaga a conta deste aparelho depois de confirmares.",
    /** On the key page of `Emparelhar`, when there is an account to replace. */
    pairKeyNote:
      "Quando carregares em Continuar, a app pede para confirmares que apaga a conta deste aparelho. A app só a apaga quando a outra conta entrar.",
  },
  /** «Mudar de conta»: several accounts on the same device, each with its own vault. */
  contas: {
    mudar: "Mudar de conta",
    titulo: "Mudar de conta",
    lead: "Cada conta tem o seu cofre neste aparelho. A conta que deixas fica aqui, fechada.",
    semNome: "Conta sem nome",
    abreSozinha: "Abre sem pedir a palavra-passe.",
    pedeFrase: "Pede a palavra-passe.",
    acrescentar: "Acrescentar outra conta",
    acrescentarNota: "Crias, importas ou emparelhas outra conta. Esta conta fica neste aparelho.",
    voltar: "Voltar a uma conta deste aparelho",
    nenhumaOutra: "Ainda não há outra conta neste aparelho.",
  },
  /**
   * «Juntar a outra conta» (phase 8.2), in Devices. The owner's order: it
   * merges friends and channels, and nothing else; the extra account is deleted.
   */
  juntar: {
    entrada: "Juntar a outra conta",
    entradaNota: "Tens duas contas? Junta esta à tua conta principal. Esta conta sai deste aparelho.",
    titulo: "Juntar a outra conta",
    lead: "Este aparelho passa a ser da tua conta principal. Esta conta é apagada.",
    passa: "O que passa: os teus amigos e os teus canais recebem um aviso. Com um toque, adicionam ou convidam a conta principal.",
    naoPassa: "O que não passa: nem histórico, nem perfil, nem preferências.",
    assinado: "Esta conta assina o aviso. Quem o recebe decide.",
    passos: "Três passos: emparelhar com a conta principal, avisar os contactos e os canais, apagar esta conta.",
    comecar: "Começar",
    avisando: "A app avisa os teus contactos e os teus canais.",
    apagando: "A app apaga esta conta deste aparelho.",
    feitoTitulo: "Contas juntas",
    feito: (principal: string): string => `Este aparelho é agora de ${principal}. Esta conta foi apagada.`,
    feitoNota: "Os teus contactos vêem o aviso quando abrirem a app.",
    continuar: "Continuar",
    voltarAoInicio: "Voltar ao início",
  },
  /**
   * The composer's slash commands, IRC style (owner's request of 28 October
   * 2026). See `lib/comandosDaBarra.ts`. Each one's description is the line
   * that appears in the list when typing `/`.
   */
  barra: {
    lista: "Comandos",
    descricao: {
      me: "Escreve uma acção na terceira pessoa. Sai em itálico.",
      away: "Põe a tua mensagem pessoal. Sem texto, apaga-a.",
      estado: "Põe a tua mensagem pessoal. Sem texto, apaga-a.",
      nick: "Muda o teu nome. Chega na próxima versão.",
      topic: "Muda o tema do canal. Chega na próxima versão.",
      kick: "Tira uma pessoa do canal. Chega na próxima versão.",
    },
    meVazio: "Escreve o que fazes depois de /me.",
    estadoPosto: "A tua mensagem pessoal mudou.",
    estadoApagado: "A tua mensagem pessoal foi apagada.",
    estadoLongo: (max: number): string => `A mensagem pessoal tem no máximo ${max} caracteres.`,
    estadoIndisponivel: "Aqui não é possível mudar a mensagem pessoal. Muda-a no cartão da conta.",
    naProximaVersao: (comando: string): string => `${comando} chega na próxima versão. A mensagem não foi enviada.`,
  },
  /**
   * The 1.0 «Arca» cutover screen (`screens/gate/SaiuDeBeta.tsx`). The text is
   * D3, approved by the owner on 27 October 2026
   * (`docs/planos/moradas-opacas-e-corte.md`, section 2): not a word changes
   * without a new decision. A test pins it.
   */
  saiuDeBeta: {
    titulo: "O Orwell saiu de beta.",
    texto:
      "Obrigado por testares o Orwell. Mudámos a forma como as conversas são guardadas, para o servidor saber ainda menos. As contas do beta não passam para a versão nova. Lamentamos: tens de criar uma conta nova.",
    criarContaNova: "Criar conta nova",
  },

  /** The AFK room (2/11/2026). See `lib/relogioAfk.ts`. */
  salaAfk: {
    marca: "AFK",
    marcaTitulo: "Sala AFK: não há voz nem texto.",
    semVozNemTexto: "Na sala AFK não há voz nem texto.",
    movido: (minutos: number): string => `Estiveste silenciado ${minutos} minutos. Passaste para a sala AFK.`,
    voltar: "Voltar",
    voltarPara: (sala: string): string => `Voltar para ${sala}`,
    fechar: "Fechar o aviso",
    seccaoTitulo: "Sala AFK",
    seccaoLead:
      "Quem estiver numa sala de voz com o microfone silenciado vai sozinho para a sala AFK. Lá não há voz nem texto.",
    salaLabel: "Sala AFK",
    nenhuma: "Nenhuma",
    tempoLabel: "Tempo silenciado",
    minutos: (minutos: number): string => `${minutos} minutos`,
    guardar: "Guardar",
    guardado: "Sala AFK guardada.",
    semSalasDeVoz: "Este canal não tem salas de voz. Cria uma sala de voz primeiro.",
  },

  /*
    The report sheet (Task 7 of the reports): "Denunciar…" in the message menu
    and in the person's menu. See `DenunciarSheet` and `denunciar.ts`.
  */
  denunciar: {
    menu: "Denunciar…",
    tituloPessoa: (nome: string): string => `Denunciar ${nome}`,
    tituloMensagem: (nome: string): string => `Denunciar a mensagem de ${nome}`,
    motivoLegenda: "Porque denuncias?",
    motivos: { ...MOTIVOS_DA_DENUNCIA, 8: "Outro (nota obrigatória)" },
    nota: "Nota",
    notaObrigatoria: "Nota (obrigatória)",
    notaDica: "Diz o que aconteceu, em poucas palavras.",
    boaFe: "Confirmo que acredito, de boa-fé, que esta denúncia é exacta e completa.",
    contactoLegenda: "Contacto",
    nome: "Nome",
    email: "Email",
    contactoNota: "Opcional. Só nós lemos o nome e o email.",
    previsualizacaoTitulo: "O que sai do aparelho",
    previsualizacaoNota: "Só isto sai do aparelho. Uma mensagem corrigida vai como o autor a escreveu primeiro.",
    semMensagens: "Não vai nenhuma mensagem. Vai só o endereço da pessoa.",
    resumoTitulo: "Também vai na denúncia",
    // The preview summary: label and value, "Motivo: Assédio ou perseguição".
    rotulos: {
      pessoa: "Pessoa denunciada",
      canal: "Canal",
      sala: "Sala",
      motivo: "Motivo",
      nota: "Nota",
      boaFe: "Boa-fé",
      contacto: "Contacto",
      versao: "Versão da app",
    },
    boaFeConfirmada: "confirmada.",
    mostrarEnderecos: "Mostrar endereços",
    enderecosNota: "Os endereços também vão na denúncia.",
    // The step indicator (design chosen by the owner, 4/11/2026).
    passosRotulo: "Passos da denúncia",
    passos: { motivo: "Motivo", rever: "Rever", enviar: "Enviar" },
    passoFeito: "feito",
    denunciadaPilula: "Denunciada",
    avisoTitulo: "Antes de enviar",
    aPreparar: "A preparar a denúncia…",
    aviso: "O fundador do canal recebe uma cópia sem o teu nome. Numa conversa pequena, pode adivinhar quem foste.",
    continuar: "Continuar",
    voltar: "Voltar",
    enviar: "Enviar denúncia",
    aEnviar: "A enviar…",
    enviada: "Denúncia enviada.",
  },

  /*
    The suspension notice (Task 8 of the reports; DSA art. 17(3)): the
    measure, the duration, the scope, the facts, the source, the rule and the
    redress routes. See `ContaSuspensa`.
  */
  contaSuspensa: {
    titulo: "Conta suspensa",
    medida: "Medida: suspensão da conta.",
    motivo: (motivo: string): string => `Motivo: ${motivo}`,
    motivos: { ...MOTIVOS_DA_DENUNCIA, 8: "Outro" },
    duracao: (desde: string, ate: string): string => `Desde ${desde} até ${ate}.`,
    ateARevisao: (desde: string): string => `Desde ${desde}, até à revisão.`,
    ambito: (texto: string): string => `Âmbito: ${texto}`,
    factos: (texto: string): string => `Factos: ${texto}`,
    origem: {
      denuncia: "Veio de uma denúncia.",
      autoridade: "Veio de uma autoridade.",
      operador: "Decisão do operador.",
    },
    semMeiosAutomaticos: "Não houve meios automáticos: uma pessoa leu e decidiu.",
    norma: (texto: string): string => `Norma ou cláusula: ${texto}`,
    viasTitulo: "O que podes fazer",
    notaRevisao: "Nota para a revisão",
    notaDica: "Diz porque achas que a decisão está errada.",
    pedirRevisao: "Pedir revisão",
    aEnviar: "A enviar…",
    revisaoEnviada: "Pedido de revisão enviado.",
    revisaoPedida: (quando: string): string => `Pediste revisão em ${quando}.`,
    decisao: {
      mantida: "Revisão: a suspensão foi mantida.",
      levantada: "Revisão: a suspensão foi levantada.",
    },
    notaDaDecisao: (nota: string): string => `Nota da revisão: ${nota}`,
    tribunais: "Podes recorrer aos tribunais.",
    anacom: "Podes reclamar à ANACOM, o Coordenador dos Serviços Digitais em Portugal.",
    semAviso: "Não foi possível ler o aviso. Tenta outra vez mais tarde.",
    tentarOutraVez: "Tentar outra vez",
  },
} as const

/**
 * The raw English that escapes from client-core, said in the application's voice.
 *
 * Unknown messages pass untouched: a wrong translation is worse than an
 * untranslated one, because it hides what really happened. Whoever picks the
 * active language's map is `translateError` in `strings.ts`.
 */
export const errosPt: Record<string, FraseDeErro> = {
  "vault is locked": "O cofre está bloqueado.",
  "no vault to open": "Não há cofre neste aparelho.",
  "vault holds no identity": "O cofre não tem identidade.",
  "wrong passphrase, or the vault is damaged": "Palavra-passe errada. Se tens a certeza dela, os dados deste aparelho podem estar danificados.",
  "this vault was written by a newer version of the app":
    "Este cofre foi gravado por uma versão mais recente da app. Actualiza a app antes de o abrir. Abrir o cofre com esta versão apagaria o que ela não sabe ler.",
  "this vault is from the beta": "Este cofre é de uma versão do beta. Não abre nesta versão.",
  "this account file is from the beta": "Este ficheiro é de uma versão do beta. Não pode entrar nesta versão.",
  "clipboard unavailable": "Não foi possível copiar. Selecciona o texto e copia-o com o teclado.",
  "clipboard text is invalid": "Não foi possível copiar este texto.",
  "this device cannot remember the session": "Este aparelho não tem onde guardar a sessão com segurança.",
  "this vault has no passphrase to remember": "Esta conta não tem palavra-passe neste aparelho. Não há sessão para memorizar.",
  "this vault already has a passphrase": "Esta conta já tem palavra-passe neste aparelho.",
  "there is no such account on this device": "Esta conta já não está neste aparelho.",
  "could not reach the homeserver": "Não foi possível contactar o servidor.",
  // «Enviar registo» (phase 4): the refusal and the cap of the `/_enclave/relato` route.
  "the server did not take the log": "O servidor não aceitou o registo. Copia-o e cola-o no relato.",
  "too many logs sent": "Já enviaste 10 registos nesta hora. Tenta outra vez mais tarde, ou copia o registo.",
  // Reports: the refusal, the cap and the signed request's clock.
  "the server did not take the report": "O servidor não aceitou a denúncia. Tenta outra vez mais tarde.",
  "too many reports sent": "Enviaste demasiadas denúncias. Tenta outra vez mais tarde.",
  "the device clock is off": "O relógio deste aparelho está errado. Acerta a hora e tenta outra vez.",
  "could not read the report inbox": "O servidor mandou uma resposta que não conseguimos ler. Tenta outra vez mais tarde.",
  // The account suspension (reports, §8): the notice and the review request.
  "account-suspended": "A tua conta está suspensa neste servidor. Lê o motivo e pede revisão.",
  "the server did not take the review request": "O servidor não aceitou o pedido de revisão. Tenta outra vez mais tarde.",
  // The report sheet: the two validations and the copy to the founder.
  "the report needs a note": "Escreve uma nota. O motivo \"Outro\" precisa dela.",
  "the report needs the good-faith confirmation": "Confirma que a denúncia é de boa-fé.",
  "the founder copy could not be sealed": "Não foi possível cifrar a cópia para o fundador do canal. A denúncia seguiu sem ela.",
  "vault storage is full":
    "O armazenamento deste aparelho está cheio. Apaga imagens ou conversas antigas. Até lá, nada de novo fica guardado aqui.",
  "this is not an enclave account file": "Este ficheiro não é uma conta do Orwell.",
  "an export passphrase is required": "Escolhe uma palavra-passe para o ficheiro exportado.",
  "this platform cannot protect a vault without a passphrase":
    "Este aparelho precisa de uma palavra-passe para proteger o cofre.",
  "this device cannot shrink images": "Este aparelho não consegue encolher imagens. Escolhe uma mais pequena.",
  "this is not an image this device can read": "Isto não é uma imagem que este aparelho consiga ler.",
  "this image is too large even after compression": "Essa imagem é demasiado grande, mesmo depois de comprimida. Escolhe outra.",
  "could not compress this image": "Não foi possível comprimir essa imagem.",

  /* Vault and account. */
  "this vault needs the system keychain": "Este cofre precisa do porta-chaves do sistema. Este aparelho não o tem.",
  "the vault file is damaged": "O ficheiro do cofre está danificado. Importa a conta de novo.",
  "this account is no longer valid on this server": "Esta conta deixou de ser válida neste servidor. Cria uma conta nova.",
  "this vault already holds an account": "Este cofre já tem uma conta. Só um aparelho sem conta se pode juntar a uma.",
  "local storage failed": "Não foi possível abrir o armazenamento deste aparelho. Recarrega a página.",
  "this tab no longer writes": "Este separador já não liga ao servidor. Usa o outro separador, ou recarrega este.",
  "this tab no longer writes to the vault": "Este separador já não guarda nada. Outro separador usa a conta agora. Recarrega este.",
  "could not leave every channel, account kept": (detalhe) => {
    const canais = detalhe["canais"]
    const quantos =
      typeof canais !== "number" || canais < 1 ? "todos os canais" : canais === 1 ? "1 canal" : `${canais} canais`
    return `Não foi possível sair de ${quantos}. A conta não foi apagada. Verifica a ligação e tenta outra vez.`
  },

  /* Server and connection. */
  "no connection to the server": "Sem ligação ao servidor. A app tenta ligar de novo.",
  "the server refused the login": "O servidor não aceitou o início de sessão. Tenta outra vez.",
  "the server did not answer in time": "O servidor não respondeu a tempo. Tenta outra vez.",
  "the server did not confirm the send": "O servidor não confirmou o envio. Verifica a ligação e tenta outra vez.",
  "the connection dropped": "A ligação caiu a meio.",
  "the session ended": "A sessão terminou. Abre a app outra vez.",
  "unexpected answer from the server": "O servidor deu uma resposta inesperada. Tenta outra vez.",

  /* Channels, invites and members. */
  "not a member of this channel": "Não és membro deste canal.",
  "you may not invite in this channel": "O teu papel não te deixa convidar para este canal.",
  "that person is already in this channel": "Essa pessoa já está neste canal.",
  "that person has no invite keys": "Essa pessoa está sem chaves de convite. Pede-lhe que abra a app e tenta outra vez.",
  "no invite key verifies": "Não foi possível adicionar essa pessoa. Nenhuma chave de convite é válida.",
  "that person's invite key expired": "O convite dessa pessoa expirou. Pede-lhe que abra a app e tenta outra vez.",
  "could not add that person to this channel": "Não foi possível adicionar essa pessoa a este canal.",
  "a direct conversation has no administration": "Uma conversa a dois não tem administração. As duas pessoas são iguais.",
  "only an administrator may manage roles": "Só quem administra este canal pode criar, apagar ou atribuir papéis.",
  "the role needs an id and a name": "O papel precisa de um identificador e de um nome.",
  "the admin role is built in": "O cargo de administrador vem com o canal. Não se apaga.",
  "the founder cannot lose the role": "Quem fundou o canal não pode perder o papel.",
  "that role does not exist in this channel": (detalhe) => {
    const papel = detalhe["role"]
    return typeof papel === "string" && papel !== ""
      ? `O papel "${papel}" não existe neste canal.`
      : "Esse papel não existe neste canal."
  },
  "to leave, forget the channel": 'Não te podes expulsar a ti próprio. Para sair, usa "Sair do canal".',
  "you may not expel in this channel": "O teu papel não te deixa expulsar neste canal.",
  "this channel has no recorded founder": "Este canal ainda não tem fundador registado aqui. Uma expulsão não se desfaz.",
  "the founder cannot be expelled": "Quem fundou o canal não pode ser expulso.",
  "that person is not in this channel": "Essa pessoa não está neste canal.",
  "to change room, join it": "Para mudares de sala, entra nela.",
  "to leave the call, leave it": 'Para saíres da chamada, usa "Sair da chamada".',
  "the everyone role is built in": 'O cargo "Toda a gente" vem com o canal. Não se apaga nem se dá a ninguém.',
  "you may not change the permissions of this room": "Não podes mudar as permissões deste lugar.",
  "you may not move people in this channel": "O teu papel não te deixa mover pessoas neste canal.",
  "you already administer this channel": "Já administras este canal.",
  "this channel already has an administrator": "Este canal já tem quem o administre.",
  "only an administrator may edit this channel": "Só quem administra este canal pode mudar as propriedades e as salas.",
  "the channel needs a name": "O canal precisa de um nome.",
  "the category needs a name": "A categoria precisa de um nome.",
  "the room needs a name": "A sala precisa de um nome.",
  "the default room cannot be deleted": "A sala por omissão não se elimina. Recebe as mensagens sem sala.",
  "that room id is reserved": "Esse identificador está reservado. Não pode ser uma sala.",
  "you may not pin in this channel": "O teu papel não te deixa fixar mensagens neste canal.",
  "the room has the maximum of pinned messages": (detalhe) => {
    const maximo = detalhe["max"]
    return typeof maximo === "number"
      ? `Esta sala já tem ${maximo} mensagens fixas, o máximo. Desafixa uma primeiro.`
      : "Esta sala já tem o máximo de mensagens fixas. Desafixa uma primeiro."
  },
  "this room was never published": "Esta sala ainda não foi publicada por ninguém. Não dá para fixar aqui.",
  "the ticket needs a subject": "O ticket precisa de um assunto.",
  "only an attendant or the author may change the ticket":
    "Só quem atende os tickets deste canal, ou quem abriu este, pode mudar o estado.",
  "you may not attend tickets in this channel": "O teu papel não te deixa atender tickets neste canal.",
  "the reply needs text": "A resposta precisa de texto.",
  "a feed channel cannot be deleted": "O canal de um feed não se elimina. As publicações vivem lá dentro.",
  "a direct conversation cannot be deleted": "Uma conversa a dois não se elimina. Sai-se dela.",
  "the common room belongs to the server": "A sala comum é deste servidor. O servidor decide se ela existe.",
  "you may not delete this channel": "O teu papel não te deixa eliminar este canal.",
  "only the author or a moderator may delete this message":
    "Só quem escreveu a mensagem, ou quem modera o canal, a pode eliminar.",
  "only a closed ticket can be deleted": "Só se elimina um ticket fechado. Fecha-o primeiro.",
  "you may not moderate in this channel": "O teu cargo não te deixa moderar este canal.",
  "the nickname is too long": (detalhe) => {
    const maximo = detalhe["max"]
    return typeof maximo === "number" ? `O apelido tem mais de ${maximo} caracteres.` : "O apelido é longo de mais."
  },
  "a nickname belongs to a channel": "Um apelido é de um canal. Uma conversa a dois e um feed não têm apelidos.",
  "that is not a valid invite link": "Esse link não é válido.",
  "that invite is from another server": "Esse convite é de outro servidor.",
  "could not prepare the entry": "Não foi possível preparar a entrada. Tenta outra vez.",
  "that invite no longer exists": "Esse convite já não existe.",
  "that invite expired": "Esse convite expirou. Pede à outra pessoa que te convide outra vez.",
  "this device has no seat in this channel": "O servidor recusou. Este aparelho não tem lugar neste canal.",

  /* Calls and media. */
  "the call could not be set up on this server":
    "A chamada não se montou neste servidor. Tenta outra vez. Se repetir, copia o diagnóstico nas Configurações.",
  "the call has no send path": "A chamada não tem caminho de envio. Entra de novo na chamada.",
  "the call dropped and did not come back": "A chamada caiu e não voltou. Entra outra vez.",

  /* Core notices that are not errors, said through the same table (I9). */
  "you are no longer a member of this channel": "Já não és membro deste canal.",
  "an invitation to this channel can no longer be opened, a new seat was requested":
    "Este convite já não abre. Pedimos um lugar novo.",

  /* Files and images. */
  "too large to send": "Isto é demasiado grande para enviar. Usa uma imagem mais pequena.",
  "unreadable image": "Não foi possível ler essa imagem. Escolhe outra.",

  /* Friendships, feed and profile. */
  "a friend request is already pending": "Já enviaste um pedido a esta pessoa. Espera pela resposta.",
  "that person is blocked": "Bloqueaste esta pessoa. Desbloqueia-a primeiro.",
  "this device cannot start a new conversation":
    "Este aparelho não pode começar uma conversa nova. Começa-a no aparelho onde criaste a conta. Depois a conversa aparece também aqui.",
  "the other account is not known to the server": "O servidor não conhece esta conta. Confirma o endereço e tenta outra vez.",
  "this device has not received this conversation yet":
    "Esta conversa ainda não chegou a este aparelho. Liga o aparelho onde criaste a conta e tenta outra vez.",
  "this conversation is waiting for the other person":
    "Esta conversa precisa da outra pessoa. Quando ela ligar a app, a conversa volta a abrir.",
  "this device does not know the account feed yet":
    "Este aparelho ainda não conhece o mural da conta. Liga o aparelho onde criaste a conta e tenta outra vez.",
  "there is no friend request to cancel": "Não há pedido teu por cancelar.",
  "you cannot block yourself": "Não te podes bloquear a ti próprio.",
  "that is not an account address": "Isto não é o endereço de uma conta.",
  "too many friends to show": "A lista tem mais de 500 pessoas. Escolhe menos.",
  "your feed has people who are not friends": "O teu feed tem pessoas que não são amigas. Tenta outra vez com ligação.",

  /* Devices and pairing. */
  "this device has no account key": "Este aparelho não é o aparelho principal. Acrescenta aparelhos no aparelho principal.",
  "this server cannot pair devices": "Este servidor ainda não sabe emparelhar aparelhos.",
  "this version of the app cannot do that": "Esta versão da app ainda não faz isso. Actualiza a app.",
  "not a pairing link": "Isto não é um link de emparelhamento.",
  "a pairing with this code already exists": "Já há um emparelhamento com este código. Gera outro.",
  "this code is no longer open": "Este código já não está aberto. Pede um novo no aparelho principal.",
  "another device already joined this code": "Já se juntou outro aparelho a este código. Gera um novo no aparelho principal.",
  "too many pairing attempts": "Demasiadas tentativas. Espera um minuto.",
  "the other device disconnected": "O outro aparelho desligou-se antes de acabar.",
  "the pairing code expired": "O código expirou. Gera um novo.",
  "a third device tried to join":
    "Um terceiro aparelho tentou juntar-se com este código. Nada foi acrescentado. Gera um código novo.",
  "the words were not the same": "As palavras não eram as mesmas nos dois aparelhos. Nada foi acrescentado.",
  "pairing cancelled": "Cancelado.",
  "the other device did not answer in time": "O outro aparelho não respondeu a tempo.",
  "the certificate is not from this account": "O certificado que chegou não é desta conta. Nada foi guardado.",
  "the server refused the device list": "O servidor não aceitou a lista de aparelhos. Nada foi acrescentado.",
  "this account already has four devices": "Esta conta já tem quatro aparelhos.",

  /*
    Phase 5 (20/10/2026): the end of «Erro 900». Every key that can reach the
    screen got a code and a sentence. See `codigosDeErro.cobertura.test.ts`.
  */

  /* Vault and account. */
  "this vault needs a passphrase": "Este cofre precisa da palavra-passe. Escreve-a para abrir o cofre.",
  "no identity loaded": "A conta ainda não está aberta. Espera um momento e tenta outra vez.",
  /* Merging accounts (phase 8.2). */
  "there is no account to join": "Este aparelho ainda não emparelhou com a outra conta. Começa outra vez pelo link.",
  "could not leave every channel, nothing was deleted": (detalhe) => {
    const canais = detalhe["canais"]
    const quantos =
      typeof canais !== "number" || canais < 1 ? "todos os canais" : canais === 1 ? "1 canal" : `${canais} canais`
    return `Não foi possível sair de ${quantos}. Esta conta não foi apagada. Verifica a ligação e tenta outra vez.`
  },
  "the account could not be switched":
    "Este aparelho não passou para a outra conta. Esta conta continua no aparelho. Abre-a com a palavra-passe dela.",
  "this account did not become another": "Esta conta não passou a ser outra.",
  "an account cannot be joined to itself": "Este link é da mesma conta. Uma conta não se junta a si própria.",
  "the other device stopped waiting, nothing was deleted":
    "O aparelho da conta principal deixou de esperar. Esta conta não foi apagada. Começa outra vez pelo link.",

  /* Server and connection. */
  "the connection was replaced": "Uma ligação nova substituiu esta. Tenta outra vez.",
  "this address belongs to another key":
    "Este endereço pertence a outra chave neste servidor. Esta conta não pode entrar aqui.",
  "the key does not match the address": "A chave não corresponde ao endereço da conta. O servidor não deixa entrar.",
  "the server closed the connection": (detalhe) => {
    const codigo = detalhe["codigo"]
    const base = "O servidor fechou a ligação. A app tenta ligar de novo."
    return typeof codigo === "string" && codigo !== "" ? `${base} Código do servidor: ${codigo}.` : base
  },
  "the server refused a message that was too large":
    "O servidor recusou uma mensagem demasiado grande. Envia uma mais pequena.",

  /* Channels. */
  "unknown ticket state": "Esse estado de ticket não existe.",
  "this channel was recreated": (detalhe) => {
    const nome = detalhe["nome"]
    const canal = typeof nome === "string" && nome !== "" ? `O canal "${nome}"` : "Este canal"
    return `${canal} perdeu o estado e foi recriado. Convida outra vez quem lá estava.`
  },
  "this channel no longer exists here":
    "Este canal já não existe no servidor, ou este aparelho perdeu o lugar nele. O que escreves aqui não chega a ninguém. Sai do canal e pede um convite novo.",
  "some channels could not be read": (detalhe) => {
    const quantos = detalhe["quantos"]
    if (typeof quantos !== "number" || quantos < 1) {
      return "Não foi possível ler alguns canais neste aparelho. Esses canais ficaram de fora."
    }
    return quantos === 1
      ? "Não foi possível ler 1 canal neste aparelho. Esse canal ficou de fora."
      : `Não foi possível ler ${quantos} canais neste aparelho. Esses canais ficaram de fora.`
  },
  "that invite reached its limit": "Esse convite já foi usado o número máximo de vezes. Pede um convite novo.",
  "this invite link is wrong": "Esta ligação está errada. Pede uma nova a quem te convidou.",
  "too many invite lookups": "Espera um minuto e tenta outra vez.",
  "too many invite requests": "Demasiados pedidos de entrada. Espera um minuto e tenta outra vez.",
  "the server does not open this channel address":
    "O servidor não abre um canal com esta morada. Usa \"Criar canal\".",
  "this server does not open short invite links":
    "Este servidor não abre ligações curtas. Pede a ligação longa a quem te convidou.",
  "this message cannot be reported": "Não podes denunciar esta mensagem.",

  /* Browser errors. */
  "the browser or the system did not allow this":
    "O browser ou o sistema não deu permissão. Verifica as permissões e tenta outra vez.",
  "no microphone or camera was found": "Não há microfone nem câmara ligados a este aparelho.",
  "the microphone or the camera is busy": "Outra app está a usar o microfone ou a câmara. Fecha-a e tenta outra vez.",
  "no microphone or camera fits":
    "Nenhum microfone ou câmara deste aparelho serve para estas definições. Escolhe outro nas Configurações.",
  "the browser stopped the operation": "O browser parou a operação a meio. Tenta outra vez.",
  "the browser was not ready": "O browser não estava pronto para isto. Tenta outra vez.",
  "the browser blocked this for safety": "O browser bloqueou isto por segurança. Verifica as permissões deste site.",
  "this browser cannot do that": "Este browser não faz isso. Usa outro browser ou a app de secretária.",

  /* Calls. */
  "could not open the microphone": (detalhe) => `Não foi possível abrir o microfone. ${porqueNaoAbriu(detalhe)}`,
  "could not open the camera or the microphone": (detalhe) =>
    `Não foi possível abrir a câmara ou o microfone. ${porqueNaoAbriu(detalhe)}`,
  "call signalling failed": "Não foi possível enviar um sinal da chamada. Verifica a ligação.",
  "that person did not answer the call": "Uma pessoa não respondeu à chamada. Talvez já tenha saído.",
  "the network blocks the call to that person":
    "Não foi possível ligar a uma pessoa da chamada. A rede de um dos lados bloqueia a chamada.",
  "no relay server for the call": "Sem servidor de retransmissão. A chamada pode não ligar a quem está noutra rede.",
  "you are not in a call": "Não estás em nenhuma chamada. Entra numa chamada e depois partilha o ecrã.",
  "this call server carries only voice": "O servidor desta chamada só leva voz. A imagem não passa. Nada foi partilhado.",
  "the afk room has no voice and no text": "Na sala AFK não há voz nem texto.",
  "only a voice room can be the afk room": "Só uma sala de voz pode ser a sala AFK.",
  "the call is too large to share a screen": (detalhe) => {
    const pessoas = detalhe["pessoas"]
    const tecto = detalhe["tecto"]
    const fim = "Para partilhar, a chamada tem de ter menos pessoas."
    if (typeof pessoas !== "number" || typeof tecto !== "number") {
      return `A chamada tem pessoas a mais para partilhar o ecrã. ${fim}`
    }
    return detalhe["caminho"] === "directo"
      ? `Já são ${pessoas} pessoas na chamada. O ecrã vai directo para cada pessoa. Acima de ${tecto} pessoas, a tua ligação não chega e a chamada cai, som incluído. ${fim}`
      : `Já são ${pessoas} pessoas na chamada. O ecrã sai do servidor uma vez por pessoa. Acima de ${tecto} pessoas, o servidor não tem banda para isso. ${fim}`
  },
  "this device cannot share the screen from the app": "Este aparelho não deixa partilhar o ecrã a partir da app.",
  "could not share the screen": "Não foi possível partilhar o ecrã. Verifica as permissões do sistema.",
  "the system did not give the screen sound":
    "O sistema não deu o som do ecrã. Os outros vêem o ecrã, mas não o ouvem. No macOS, abre Definições do Sistema › Privacidade e segurança › Gravação de ecrã e áudio do sistema, liga o Orwell e abre a app outra vez.",
  "this system cannot share the screen sound":
    "Este sistema não deixa partilhar o som do ecrã. Os outros vêem o ecrã, mas não o ouvem.",
  "the browser did not give the screen sound":
    "O browser não deu o som do ecrã. Os outros vêem o ecrã, mas não o ouvem. Para enviar o som, partilha outra vez: escolhe um separador, ou marca a caixa do áudio no selector do browser.",
  "someone already shares a screen in this call":
    "Esta chamada já tem 2 ecrãs partilhados. É o máximo. Espera que uma partilha pare.",
  "the call has the maximum of cameras": "Esta chamada já tem o máximo de câmaras. Desliga uma câmara primeiro.",
  "the call is full": "Esta chamada está cheia. O servidor não aguenta mais pessoas.",
  "the server is full of broadcasts": "O servidor está cheio de transmissões. Tenta daqui a pouco.",
  "no media key for this person yet": (detalhe) => {
    const nome = detalhe["nome"]
    const quem = typeof nome === "string" && nome !== "" ? nome : "uma pessoa desta chamada"
    return `Ainda não ouves ${quem}: falta a chave da chamada. O som abre sozinho quando a chave chegar.`
  },
  "the microphone keeps stopping": "O teu microfone parou várias vezes. Sai e entra outra vez na chamada.",
  "the sound of this person is not here yet": (detalhe) => {
    const nome = detalhe["nome"]
    const quem = typeof nome === "string" && nome !== "" ? nome : "uma pessoa desta chamada"
    return `Ainda não ouves ${quem}. A app está a pedir o som outra vez.`
  },
  "your media is not going out yet": (detalhe) => {
    const fonte = detalhe["fonte"]
    if (fonte === "camara") return "A tua câmara ainda não está a enviar: a preparar a cifra."
    if (fonte === "ecra") return "O teu ecrã ainda não está a ser partilhado: a preparar a cifra."
    if (fonte === "ecra-som") return "O som do teu ecrã ainda não está a enviar: a preparar a cifra."
    if (fonte === "musica") return "A tua música ainda não está a enviar: a preparar a cifra."
    return "O teu microfone ainda não está a enviar: a preparar a cifra."
  },
  "the call media could not be encrypted": (detalhe) => {
    const fonte = detalhe["fonte"]
    const base = "A cifra da chamada não ficou pronta. Nada sai sem cifra."
    if (fonte === "camara") return `${base} Os outros não vêem a tua câmara.`
    if (fonte === "ecra") return `${base} O teu ecrã não foi partilhado.`
    if (fonte === "ecra-som") return `${base} Os outros vêem o teu ecrã, mas não ouvem o som do ecrã.`
    if (fonte === "musica") return `${base} A tua música não sai.`
    return `${base} Saíste da chamada. Entra outra vez.`
  },
  "this device is in too many calls": "Este aparelho já está em chamadas a mais. Sai de uma chamada primeiro.",
  "too many call requests": "Demasiados pedidos à chamada neste minuto. Espera um minuto.",
  "this server does not relay call media": "Este servidor não encaminha som nem imagem de chamadas.",
  "join the call first": "Entra na chamada primeiro.",
  "the call server refused the request": "O servidor da chamada recusou o pedido. Tenta outra vez.",
  "could not announce you in the call":
    "Não foi possível avisar os outros de que entraste. Sai e entra outra vez na chamada.",
  "the call media key failed": "A chave da chamada não se renovou. Sai e entra outra vez na chamada.",
  "the call media failed": "A ligação da chamada falhou. Sai e entra outra vez na chamada.",
  "audio-invalid-profile": "Este perfil de voz não existe. Escolhe um perfil da lista.",
  "audio-invalid-stage": "Esta etapa da voz não existe. Escolhe uma etapa da lista.",
  "audio-invalid-strength": "A força da supressão tem de ficar entre 0 e 100 %.",
  "audio-preference-save-failed": "A escolha está aplicada neste aparelho. Não foi possível guardá-la na conta.",
  "audio-preview-unavailable": "Este browser não consegue tratar a voz. Experimenta outro browser ou a app.",
  "audio-preview-failed": "Não foi possível abrir o microfone para te ouvires. Verifica as permissões do microfone.",
  "audio-invalid-threshold": "A linha do microfone tem de ficar entre -80 e 0 dB.",
  "audio-meter-denied": "O browser não deixa usar o microfone. Dá a permissão do microfone ao Orwell e abre este ecrã outra vez.",
  "audio-meter-failed": "O microfone não abriu. Fecha as outras apps que o usam e abre este ecrã outra vez.",

  /* Files and pages. */
  "could not read the page": "Não foi possível ler a página.",

  /* Post videos (508 to 514). */
  "the video is too large": (detalhe: DetalheDoErro): string =>
    typeof detalhe["max"] === "number"
      ? `O vídeo é demasiado grande. O máximo é ${Math.round(detalhe["max"] / 1_048_576)} MB.`
      : "O vídeo é demasiado grande.",
  "the video is too long": (detalhe: DetalheDoErro): string =>
    typeof detalhe["max"] === "number"
      ? `O vídeo é demasiado longo. O máximo é ${detalhe["max"]} segundos.`
      : "O vídeo é demasiado longo.",
  "this video format is not accepted": "Este formato de vídeo não é aceite. Usa MP4, WebM ou MOV.",
  "the video upload was cancelled": "Cancelaste o envio do vídeo. A publicação foi apagada.",
  "could not read this video": "Este aparelho não consegue ler esse vídeo. Escolhe outro.",
  "a video upload is already in progress": "Já está um vídeo a sair. Espera até acabar.",
  "the video upload failed": "O envio do vídeo parou. A publicação foi apagada. Publica outra vez.",
  "the attachment request failed": "O pedido do ficheiro falhou. Tenta outra vez.",

  /* Friendships and feed. */
  "too many friend lists in a row":
    "A lista de amigos mostrada mudou 3 vezes seguidas. A lista nova sai com a próxima publicação.",

  /* Devices. */
  "this device is not on the account's list":
    "O servidor não reconhece este aparelho como aparelho da conta. Este aparelho não pode entrar.",
  /* Account state between devices. They are interface programming errors, but they reach the screen if they happen. */
  "read mark channel is invalid": "A marca de lido não tem um canal válido. A marca não foi guardada.",
  "read mark time is invalid": "A marca de lido não tem uma hora válida. A marca não foi guardada.",
  "preference key is invalid": "O nome desta preferência não é válido. A preferência não foi guardada.",
  "preference value is too long": "Esta preferência é longa demais. A preferência não foi guardada.",
  "too many preferences": (detalhe) =>
    typeof detalhe["tecto"] === "number"
      ? `Esta conta já tem ${detalhe["tecto"]} preferências. A preferência nova não foi guardada.`
      : "Esta conta já tem o máximo de preferências. A preferência nova não foi guardada.",
  "archive channel is invalid": "Esta conversa não tem um canal válido. A conversa não foi arquivada.",

  /* Device revocation. */
  "device-revoke-no-account-key":
    "Só o aparelho principal pode revogar aparelhos. Revoga a partir do aparelho principal.",
  "device-revoke-unsupported": "Este servidor não sabe revogar aparelhos. Nada mudou.",
  "device-key-invalid": "A chave deste aparelho não é válida. Nada mudou.",
  "device-revoke-self": "Não podes revogar este aparelho a partir dele próprio. Revoga-o a partir de outro aparelho.",
  "device-revoke-manifest-unread": "Não foi possível ler a lista de aparelhos da conta. Nada mudou. Tenta outra vez.",
  "device-not-in-manifest": "Este aparelho não está na lista da conta. Nada mudou.",
  "device-revoke-manifest-refused": (detalhe) =>
    detalhe["reason"] === "no-answer"
      ? "O servidor não respondeu a tempo. Este aparelho já ficou marcado como revogado. Repete para acabar a revogação."
      : "O servidor não aceitou a lista de aparelhos nova. Nada mudou. Tenta outra vez.",
  "device-revoke-incomplete": (detalhe) =>
    Array.isArray(detalhe["channels"])
      ? `O aparelho saiu da conta, mas ainda está em ${detalhe["channels"].length} canais. Revoga outra vez para acabar.`
      : "O aparelho saiu da conta, mas ainda está em alguns canais. Revoga outra vez para acabar.",
  "device-revoked": "Este aparelho foi tirado da conta noutro aparelho.",
  "account-channel-foreign":
    "O canal da conta tinha um aparelho que não é desta conta. Este aparelho saiu desse canal. O estado volta a passar quando o canal for refeito.",
  // Music in the call (phase 9): the call goes on; the person knows what failed.
  "this call server does not carry music": "Este servidor de chamadas ainda não leva música. A chamada continua sem ela.",
  "could not read this audio file": (detalhe) =>
    typeof detalhe["nome"] === "string" && detalhe["nome"] !== ""
      ? `Não foi possível ler "${detalhe["nome"]}". A lista passa ao ficheiro seguinte.`
      : "Não foi possível ler este ficheiro. A lista passa ao ficheiro seguinte.",
  "could not play this audio file": "O browser não deixou tocar o ficheiro. Carrega em Tocar outra vez.",
  // The DJ's captured sources (2/11/2026). See `somDoDj.ts` in the core.
  "the chosen source gave no sound":
    "A fonte não deu som. Partilha outra vez: no selector do browser, marca a caixa do áudio.",
  "this device does not give the system sound":
    "Este aparelho não dá o som do sistema à app. Precisas de Windows, ou de macOS 14.2 ou mais.",
  "could not capture this sound source": "Não foi possível capturar este som. Verifica as permissões do sistema.",
  "this device cannot capture a sound source": "Este browser não deixa capturar o som de uma fonte. Usa ficheiros ou a app de secretária.",
  "the system does not allow recording the sound":
    "O macOS não deixa gravar o som. Abre Definições do Sistema › Privacidade e segurança › Gravação de ecrã e áudio do sistema, liga o Orwell e abre a app outra vez.",
}

/**
 * Why the microphone or the camera did not open, by the browser error's name.
 *
 * The name comes in `cause` (see `call.ts`). A refused permission and a
 * microphone taken by another application are two faults with opposite
 * remedies, and the same sentence for both sent the person to the wrong place.
 */
function porqueNaoAbriu(detalhe: DetalheDoErro): string {
  switch (detalhe["nome"]) {
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "Este aparelho não tem microfone ligado."
    case "NotReadableError":
    case "TrackStartError":
      return "Outra app está a usá-lo."
    case "OverconstrainedError":
      return "O aparelho escolhido não serve. Escolhe outro nas Configurações."
    default:
      return "Verifica as permissões do sistema."
  }
}
