import type { DetalheDoErro, FraseDeErro } from "../lib/codigosDeErro.js"

/**
 * Todo o texto visível, em português de Portugal, agrupado por ecrã.
 *
 * Esta é a LÍNGUA BASE, e a palavra é literal: é o único catálogo obrigado a
 * estar completo. As outras línguas são sobreposições parciais sobre esta —
 * ver `linguas/en.ts` — e o que lhes faltar cai para aqui, folha a folha. Uma
 * chave em cru nunca chega ao ecrã porque nunca há uma folha sem português.
 *
 * MARCA vs PROTOCOLO: o produto chama-se Orwell. "enclave" sobrevive só como
 * superfície técnica de que contas e instalações existentes dependem — o
 * esquema de convites enclave://, as rotas /_enclave/* do servidor, os pacotes
 * @enclave/*, as variáveis ENCLAVE_*, as chaves de armazenamento e o ficheiro
 * .enclave exportado. O texto diz Orwell; os identificadores ficam onde estão.
 * Mudar-lhes o nome é dívida cosmética, não texto.
 *
 * O texto é parte do produto: é deliberadamente franco sobre o que a aplicação
 * consegue e não consegue fazer. Mantê-lo num ficheiro só mantém essa voz
 * coerente — e mantém uma tradução futura longe de ser um trabalho de
 * arqueologia.
 *
 * Sem travessões no que chega ao ecrã: a barra longa não entra na interface.
 */
/**
 * Os motivos da denúncia de 1 a 7, iguais na folha de denunciar e na caixa do
 * fundador. O 8 difere: a folha diz que a nota é obrigatória, a caixa não.
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
    /** Um anfitrião antigo que não traz o gesto que se lhe pediu. */
    unsupported: "esta versão da app ainda não faz isso",
    cancel: "Cancelar",
    mediaEvicted: "imagem já não está neste aparelho",
    /**
     * O mesmo, para um anexo que não é imagem.
     *
     * Frase própria e não a de cima: chamar "imagem" a um PDF despejado era
     * mentir sobre o que ali esteve. O nome e o tipo sobrevivem ao despejo — ver
     * `evictEntryMedia` no cofre —, portanto a linha continua a dizer o que era.
     */
    fileEvicted: "ficheiro já não está neste aparelho",
    connectionOnline: "ligado",
    connectionConnecting: "a ligar…",
    connectionReconnecting: "a reconectar…",
    connectionOffline: "sem ligação",

    /*
      Colar imagens, nas duas caixas de escrita.

      Aqui e não em `chat` e `social` porque as frases são as MESMAS nos dois
      sítios, ao contrário das dos anexos: aquelas dizem "mensagem" ou
      "publicação" e têm de ser duas; estas falam do que veio da área de
      transferência, e o que veio é igual venha para onde vier.
    */

    /**
     * Colou-se qualquer coisa que se dizia imagem e não é.
     *
     * Diz o que foi verificado — os bytes — em vez de "formato não suportado",
     * que não explica nada a ninguém. O caso comum é um SVG ou um HEIC, e a
     * pessoa tem de saber que a culpa não é do tamanho nem da ligação.
     */
    pasteNotImage: "O que colaste não é uma imagem que a app consiga ler. Usa PNG, JPEG, GIF, WebP ou AVIF.",

    /**
     * A imagem foi encolhida antes de ser cifrada.
     *
     * Isto é informação e não um aviso: uma fotografia que entra com doze
     * megabytes e sai com trezentos kilobytes mudou, e quem a envia tem o
     * direito de saber que mudou. Escondê-lo era deixar a pessoa descobrir
     * sozinha, do outro lado, que a fotografia não está como estava.
     *
     * O que NÃO se diz aqui, porque não cabe numa linha da caixa de escrita e
     * está documentado em `lib/images.ts`: a recodificação deita fora os
     * metadados EXIF, e com eles a localização onde a fotografia foi tirada.
     */
    imageShrunk: (de: string, para: string): string => `Imagem reduzida de ${de} para ${para}.`,
    /*
      Um GIF acima do tecto dos animados (`lib/images.ts`) foi recodificado e
      ficou parado. Diz o peso e o tecto, para a pessoa poder escolher um GIF
      mais leve em vez de ficar a adivinhar.
    */
    gifParado: (tem: string, maximo: string): string =>
      `O GIF tem ${tem}. Para ficar animado, o máximo é ${maximo}. Ficou parado.`,
    imagesShrunk: (n: number, de: string, para: string): string =>
      `${n} imagens reduzidas de ${de} para ${para}.`,
    /**
     * O que um coberto (`||assim||`) diz antes de ser destapado.
     *
     * Em `common` e não em `chat`: o mesmo marcador vale numa mensagem, numa
     * publicação e num comentário, e três frases iguais em três sítios acabam
     * sempre por deixar de ser iguais.
     *
     * É também o que um leitor de ecrã anuncia no lugar do texto tapado. Por
     * isso diz o que fazer ("mostrar") e não só o que é: quem ouve isto precisa
     * de saber que há ali um gesto à espera.
     */
    spoilerShow: "Mostrar texto escondido",
  },

  connection: {
    banner: "Sem ligação. A tentar reconectar…",
    /** A faixa depois de uma queda: quanto tempo, e que a aplicação continua a tentar. */
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
     * A caixa de escrita sem ligação: escreve-se na mesma, e diz-se o que
     * acontece. Curta, porque a 375px a caixa mostra uns quinze caracteres; a
     * faixa de cima já diz que não há ligação.
     */
    composerEspera: "Sai depois",
    /** A caixa num separador que já não escreve. Ver `session.escreve`. */
    // A interface não sabe se parou por versão nova ou por outro separador ter
    // ficado com o cofre: a frase serve aos dois casos.
    separadorParado: "Este separador já não liga ao servidor. Fecha os outros separadores ou recarrega.",
    /** Porque é que os anexos param sem ligação, quando a caixa não para. */
    anexosOffline: "Imagens e ficheiros só com ligação.",
  },

  /**
   * O aviso de que há versão nova, só na aplicação instalada.
   *
   * **A palavra que falta aqui de propósito é "actualizar".** Nada disto
   * actualiza coisa nenhuma: sem assinatura de código não pode haver
   * actualizador em que se confie (ver `apps/client/src/main/actualizacao.ts`),
   * e um botão que diga "Actualizar" e depois abra um browser é uma promessa
   * partida no primeiro clique. Diz-se o que se faz: leva a uma página onde há
   * um ficheiro para descarregar.
   *
   * A soma vai ao ecrã porque é a única defesa contra um ficheiro adulterado que
   * este produto tem. Quem a lê antes de descarregar tem hipótese de a conferir
   * depois; escondida, não serve para nada.
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
    /** A faixa da web (`apps/web/src/main.tsx`): aqui recarregar chega, e é tudo o que se diz. */
    webTexto: "Versão nova. Recarrega para continuar.",
    /** A linha pequena por baixo, na pílula (escolha B, 28 de Outubro de 2026). */
    webDetalhe: "Este separador já não envia nem recebe.",
    webRecarregar: "Recarregar",
  },

  /**
   * Um dono por browser (`apps/web/src/posse-do-separador.ts`).
   *
   * Dois separadores com a mesma conta escreviam os dois no mesmo cofre, e a
   * 18 de Outubro de 2026 um deles partiu a sala comum. Agora só um separador
   * usa a conta; os outros mostram este ecrã. O texto não fala de cofres nem
   * de épocas: diz o que se passa e o que a pessoa pode fazer.
   */
  separadores: {
    titulo: "Já tens o Orwell aberto noutro separador.",
    texto: "A tua conta só funciona num separador de cada vez.",
    usar: "Usar este separador",
    aPedir: "A pedir ao outro separador…",
    nota: "Ao usar este separador, o outro pára. Se fechares o outro, este abre sozinho.",
    /** A faixa de um browser sem Web Locks nem BroadcastChannel. */
    semProteccao: "Este browser não protege contra dois separadores. Usa o Orwell só num separador.",
    /** O prazo passou sem «cedi»: o outro separador pode estar congelado. */
    semResposta: "O outro separador não responde. Usar este mesmo assim?",
    forcar: "Usar este mesmo assim",
    temConvite: 'Este separador tem um convite. Carrega em "Usar este separador" para o abrir.',
    temEmparelhamento: 'Este separador tem um link de emparelhamento. Carrega em "Usar este separador" para o abrir.',
    /**
     * Um separador com o código de antes desta versão gravou o cofre por baixo
     * do dono. Este pára; a pessoa tem de fechar o outro.
     */
    outroEscritor: "Fecha os outros separadores do Orwell e recarrega.",
  },

  errors: {
    /** A primeira linha de todo o erro: o número que se dita ou se cola num relato. */
    codigo: (n: number): string => `Erro ${n}`,
    /**
     * A frase do «Erro 900»: um erro que a tabela não conhece. A mensagem em
     * cru vai por baixo, mais pequena, para se poder relatar.
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
     * A criação de conta é uma pergunta de cada vez.
     *
     * Cada passo tem uma PERGUNTA (o cabeçalho, que é o que a pessoa lê
     * primeiro) e uma EXPLICAÇÃO por baixo. As etiquetas dos campos continuam a
     * existir — `name`, `devicePassphrase`, `confirmPassphrase` acima — mas
     * ficam só para quem lê o ecrã com um leitor: repetir "Nome" por baixo de
     * "Como queres mostrar o teu nome?" é ruído para quem vê.
     *
     * O tom de entrevista é de propósito: o dono reafirmou-o a 27 de Outubro
     * de 2026, quando se propôs trocar as perguntas por títulos directos.
     *
     * Tratamento por TU, como o resto da aplicação. O pedido veio escrito por
     * você ("Como quer mostrar o seu nome?"), mas este ecrã é o primeiro de uma
     * aplicação que trata toda a gente por tu a partir do ecrã seguinte — o de
     * desbloqueio já diz "Introduz a palavra-passe". Mudar de registo a meio da
     * porta de entrada notava-se mais do que a formalidade valia.
     */
    askName: "Como queres mostrar o teu nome?",
    askNameLead: "É assim que apareces a quem fala contigo. Podes mudar o nome mais tarde.",
    /*
      A imagem de perfil, a seguir ao nome (pedido do dono a 27 de Outubro de
      2026), no mesmo tom de pergunta das outras páginas. «Saltar» tem o mesmo
      peso que avançar: a conta não precisa de cara, e sem imagem fica a
      inicial do nome. «Imagem de perfil» e não «fotografia», por ordem do
      dono: pode ser um desenho ou um GIF, e «fotografia» prometia uma cara.
    */
    askPhoto: "Queres pôr uma imagem de perfil?",
    askPhotoLead: "É a imagem que os outros vêem ao lado do teu nome. Podes mudar depois.",
    choosePhoto: "Escolher imagem",
    removePhoto: "Remover",
    skipPhoto: "Saltar",
    askPass: "Qual vai ser a palavra-passe?",
    askPassLead: "Escolhe uma palavra-passe nova. Não uses uma de outro sítio.",
    /** O mesmo passo, quando o sistema se oferece para guardar a chave. */
    askPassKeychain: "Como queres proteger a conta?",
    askPassKeychainLead: "Podes usar o bloqueio do aparelho. Para usar uma palavra-passe, tira o visto.",
    askConfirm: "Confirma a palavra-passe",
    askConfirmLead: "Escreve-a outra vez.",
    stepOf: (passo: number, total: number) => `Passo ${passo} de ${total}`,
    next: "Continuar",
    back: "Voltar",
    /** O servidor sai do caminho de quem cria a conta, mas não desaparece. */
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
     * A saída para quem perdeu a palavra-passe, que até aqui não existia.
     *
     * Uma conta desta aplicação não se recupera: a chave é a palavra-passe, não
     * há cópia no servidor, e ninguém do outro lado a pode repor. Quem a
     * esquece fica preso neste ecrã para sempre, sem sequer um caminho para
     * começar de novo. É por isso que o único remédio possível é apagar o cofre
     * deste dispositivo e criar outra conta.
     *
     * A confirmação é a mesma folha de Configurações, com a palavra escrita:
     * ver `settings.destroyStepsGate`, que é a única frase que muda.
     */
    lostAccount: "Esqueceste a palavra-passe?",
    lostAccountAction: "Criar conta nova.",
    /*
      A segunda linha do rodapé do portão: entrar com OUTRA conta neste
      aparelho, por ficheiro ou por emparelhamento. Os dois caminhos apagam a
      conta que cá está, e a folha di-lo antes de perguntar. Ver
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
      A caixa do último passo do registo (pedido do dono, 3/11/2026). A frase
      é a do dono, palavra a palavra, e é a única fora do carril que diz
      "comunidade": fala das pessoas que lá estão, não do grupo cifrado. Ver
      `terminologia.test.ts`.
    */
    canalOficial: "Entrar no canal Orwell, a comunidade de todos os users",
    canalOficialNota: "Lá estão as Release notes, a ajuda e outras pessoas. Podes entrar ou sair mais tarde.",
    revogadoSemFrase: "Esta conta não tem palavra-passe neste aparelho. Para usar o Orwell aqui outra vez, começa de novo.",
    comecarDeNovo: "Começar de novo",
    open: "Entrar",
    /**
     * A antiga terceira via do portão, por baixo do nome. Saiu do ecrã na fase
     * 8.1 (a pergunta do outro aparelho veio para o início). As duas chaves
     * ficam enquanto `scripts/e2e-emparelhar.mjs` e `e2e-cliente-antigo.mjs`
     * procurarem «Emparelhar»: saem quando os guiões forem actualizados. Ver
     * `strings.guioes.test.ts`.
     */
    joinLead: "Já tens conta noutro aparelho? Emparelha este aparelho com ele.",
    joinAction: "Emparelhar",
    /*
      Fase 8.1: a primeira pergunta do Setup, antes da conta. Dois botões com o
      mesmo peso. Ver `ecraInicial`.
    */
    outroAparelhoPergunta: "Já usas o Orwell noutro aparelho?",
    outroAparelhoLead: "Uma conta chega para todos os teus aparelhos. Se já tens conta, emparelha este aparelho com ela.",
    outroAparelhoSim: "Sim, emparelhar este aparelho",
    outroAparelhoNao: "Não, criar conta",
  },

  /**
   * O emparelhamento: a mesma conta num computador e num telemóvel.
   *
   * Duas frases são de contrato e não de decoração, e ficam ditas uma vez, no
   * fim (docs/PLANO_MULTIDISPOSITIVO.md §2.3): `doneBody`, porque um aparelho
   * novo a ver um canal vazio conclui que perdeu mensagens, e não perdeu, nunca
   * as pôde ter; e `doneGuestNote`, porque o telemóvel não tem a chave da conta
   * e a pessoa tem de saber onde é que se acrescentam e tiram aparelhos.
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
     * O que acontece ao histórico, no ecrã das seis palavras (1.0 «Arca»,
     * 29/10/2026). Não há caixa nem pergunta (decisão do dono: «quero fora»):
     * só a frase, para quem emparelha saber.
     */
    sasHistoricoAqui: "Depois de emparelhar, este aparelho recebe as conversas antigas e os ficheiros do outro aparelho.",
    sasHistoricoNoNovo: "Depois de emparelhar, o aparelho novo recebe as conversas antigas e os ficheiros deste aparelho.",
    sasSame: "São as mesmas",
    sasDifferent: "Não são",
    sasConfirmedHere: "Confirmado aqui. Falta confirmar no outro aparelho.",
    joining: "A entrar na conta…",
    /* O instantâneo do estado da conta (fase 5), entre o certificado e a entrada. */
    receivingState: "A receber os teus dados…",
    receivingStateLead:
      "O outro aparelho envia o que já leste, as conversas arquivadas, os bloqueados e as preferências.",
    stateDeadline: (segundos: number): string => `Este aparelho entra daqui a ${segundos} s, com ou sem os dados.`,
    stateMissing: "Os teus dados não chegaram a tempo. Chegam quando os dois aparelhos estiverem ligados.",
    profileMissing: "O teu perfil ainda não chegou do aparelho principal. Chega quando os dois estiverem ligados.",
    doneTitle: "Este aparelho já é da conta",
    /*
      Até à 1.0.5 dizia «As anteriores ficam nos outros aparelhos». Desde o
      histórico entre aparelhos (29/10/2026) as conversas antigas passam, de
      aparelho para aparelho, quando os dois estão ligados.
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
    /** O link de emparelhamento aberto num aparelho que já tem conta. Uma linha no portão, como a do convite. */
    gateHasAccount: "Este aparelho já tem uma conta. Para emparelhar, usa um aparelho sem conta.",
    /** E o link que nem se lê. Dizê-lo é melhor do que o silêncio que havia. */
    gateInvalid: "Este link de emparelhamento não se lê.",
    failedTitle: "O emparelhamento falhou",
    /* A razão de não emparelhar já não vive aqui: é um erro como os outros,
       com código (7xx), e passa por `translatePairingError` em `strings.ts`. */
  },

  /**
   * Os nomes dos cinco destinos, e a fronteira que eles não atravessam.
   *
   * ## O que mudou, a 20 de Agosto de 2026
   *
   * ```
   * O teu perfil → Eu
   * Canais       → Comunidades
   * Social       → Feed
   * Contactos    → Amigos
   * Configurações  (fica)
   * ```
   *
   * ## A decisão, que é de fronteira e não de tradução
   *
   * **O carril nomeia o SÍTIO onde se vai. O vocabulário nomeia a COISA.** O
   * botão passa a chamar-se "Comunidades"; aquilo que lá dentro se cria, se
   * abre, se larga e se elimina continua a chamar-se **canal**. "Novo canal",
   * "Sair do canal", "Convidar para o canal", "Propriedades do canal": nada
   * disso se toca, e `terminologia.test.ts` continua a prendê-lo.
   *
   * A alternativa era trocar a palavra em todo o lado, e foi recusada por três
   * razões medidas, não por preguiça:
   *
   * 1. **O código diz `channel`.** É o grupo MLS, é o que a cifra protege, é o
   *    nome no protocolo e no servidor. Chamar "comunidade" ao canal na
   *    interface repunha, de propósito, a desincronização entre as palavras da
   *    interface e as palavras do código que o `terminologia.test.ts` existe
   *    para impedir — está lá escrito que já aconteceu uma vez, quando o canal
   *    se chamou "espaço", e que a partir daí toda a gente aprendeu o modelo
   *    trocado.
   * 2. **A homepage ensina a hierarquia, e duas das páginas são legais.** São
   *    128 linhas com "canal" só neste ficheiro, 87 com "channel" no inglês, e
   *    ainda o `index.html`, os `termos.html` e a `privacidade.html`, onde
   *    "canal" é termo definido. Reescrever isso para renomear um botão é
   *    desproporção, e mexe no que a homepage ensina a quem chega.
   * 3. **"Comunidade" não é a palavra proibida.** A que este produto recusa é
   *    "servidor" (e "server" em inglês), porque o servidor aqui é outra coisa,
   *    é o homeserver, e é a peça que se quer ignorante. "Comunidade" não
   *    colide com nada disso: é a palavra que o próprio produto já usa para se
   *    descrever ("community chat", no `package.json` da raiz).
   *
   * O que esta decisão obriga é a que a fronteira não se desfaça sozinha, e por
   * isso ela deixou de estar só escrita: `terminologia.test.ts` ganhou um caso
   * que falha se "comunidade" sair do carril para o vocabulário, ou se o carril
   * voltar a dizer "Canais".
   *
   * ## Porque é que o cabeçalho da coluna acompanha
   *
   * `sidebar.header*` são os mesmos nomes ditos uma segunda vez, a 60px do
   * botão. Um botão "Comunidades" a abrir uma coluna intitulada "Canais" são
   * dois nomes para um destino à distância de um olhar, que é exactamente a
   * maneira de ensinar o modelo trocado. Acompanham. O `+` dessa coluna
   * continua a dizer "Criar canal", e é aí que a fronteira se vê ao vivo: a
   * secção chama-se Comunidades, a coisa que ela faz chama-se canal.
   */
  rail: {
    profile: "Eu",
    chat: "Comunidades",
    social: "Feed",
    people: "Amigos",
    settings: "Configurações",
    menu: "Abrir o painel lateral",
    /**
     * O crachá dito por palavras, para quem não vê o ecrã.
     *
     * **Descrição do botão e não nome dele, e a diferença é deliberada.** O
     * nome de um destino é o destino: "Canais" chama-se Canais esteja o crachá
     * aceso ou apagado, e um botão que muda de nome conforme o que lá chegou é
     * um botão que ninguém consegue nomear a outra pessoa. O que está por
     * atender é uma circunstância do botão, não a sua identidade, e é por isso
     * que viaja em `aria-describedby` — anunciado a seguir ao nome, sem o
     * substituir.
     *
     * Diz o número inteiro mesmo quando o desenho encolheu para "9+": a
     * abreviatura é uma limitação de 40 píxeis e não uma coisa que se queira
     * dizer a quem está a ouvir.
     */
    porAtender: (quantas: number): string =>
      quantas === 1 ? "1 por atender" : `${quantas} por atender`,
  },

  sidebar: {
    /* Os mesmos nomes do carril, ditos a 60px dele. Ver a nota em `rail`. */
    headerProfile: "Eu",
    /** Uma linha a cinzento por cada canal pedido que ainda não chegou. */
    aEsperaDeEntrada: "à espera de alguém do canal",
    /** O link dizia um nome e chegou outro canal. Ver `invite.arrivedMismatch`. */
    chegouOutroNome: "o canal que chegou tem outro nome",
    cancelar: "Cancelar",
    cancelarEspera: (nome: string): string => `Deixar de esperar por ${nome}`,
    cancelarEsperaSemNome: "Deixar de esperar",
    /**
     * O nome da linha à espera quando a morada é opaca (1.0) e não há nome: nem
     * o selo do convite o deu, nem o canal o publicou. A morada não é um nome.
     */
    canalDoConvite: "Canal do convite",
    esperaCancelada: "Deixaste de esperar. Se alguém do canal te deixar entrar depois, o canal aparece aqui.",
    headerChat: "Comunidades",
    headerSocial: "Feed",
    headerSettings: "Configurações",
    newPost: "Nova publicação",
    /* Hierarquia, e as duas entradas que a atravessam: o `+` do cabeçalho cria
       um CANAL (o grupo cifrado), o `+` do fundo da árvore cria uma SALA dentro
       dele. Chamar canal às duas coisas era o engano que estas palavras
       existem para desfazer. */
    createRoom: "Criar canal",
    newRoom: "Nova sala",
    editProfile: "Editar perfil",
    joinWithLink: "Entrar com um link",
    /** Quem não está no canal comum entra por aqui (3/11/2026). Ver `escolherSalaComum`. */
    entrarNoCanalOficial: "Entrar no canal Orwell",
    aEntrarNoCanalOficial: "A entrar no canal Orwell…",
    noRoomsBefore: "Ainda não tens canais. Cria um com o ",
    noRoomsAfter: " ao lado.",
    addFriend: "Adicionar amigo",
    /**
     * O que o símbolo das vozes diz por palavras (`components/Vozes.tsx`).
     *
     * Eram duas frases sem número, "em chamada" e "Há uma chamada a decorrer",
     * e a segunda só aparecia a quem pousasse o rato. O desenho passou a contar
     * as pessoas, e o rótulo conta com ele: o que se vê e o que se ouve têm de
     * ser a mesma informação.
     */
    callPeople: (n: number): string =>
      n === 1 ? "1 pessoa em chamada, à espera de companhia" : `${n} pessoas em chamada`,
    /**
     * A contagem, e quem são.
     *
     * Relato do dono a 5 de Outubro de 2026: há pessoas que não vêem quem está
     * na sala antes de entrarem. A contagem já estava na linha do canal; os
     * nomes só existiam debaixo do canal ABERTO, portanto ver quem está numa
     * chamada obrigava a abrir o canal primeiro. Isto põe-nos onde a contagem já
     * está, que é também o `title` e o nome acessível do símbolo das vozes (ver
     * `components/Vozes.tsx`).
     *
     * Recebe a frase feita em vez de a compor: as três frases da linha do canal
     * dizem coisas diferentes ("3 pessoas em chamada", "Ana está a chamar-te",
     * "Em chamada: tu e mais 2 pessoas") e nenhuma delas se há-de repetir aqui
     * só para lhe pendurar nomes atrás.
     */
    callWho: (frase: string, quem: string): string => `${frase}: ${quem}`,
    /** Numa conversa directa, uma chamada em que não estamos é alguém a chamar-nos. */
    callingYou: (name: string): string => `${name} está a chamar-te`,
    /** `outros` não conta connosco. */
    inCallWith: (outros: number): string =>
      outros === 0
        ? "Em chamada: só tu"
        : outros === 1
          ? "Em chamada: tu e mais 1 pessoa"
          : `Em chamada: tu e mais ${outros} pessoas`,
    myProfile: "O teu perfil",
    pickName: "Escolhe um nome",
    /**
     * As duas secções de botões da faixa da conta.
     *
     * Não são decoração de código. Sem elas, quem ouve o ecrã recebe quatro
     * botões seguidos sem saber de que são; com elas, ouve "Som e microfone,
     * grupo" e depois os dois interruptores. É a mesma divisão que o desenho
     * mostra a quem vê, e é por isso que o nome descreve o CONTEÚDO da secção
     * e não a sua posição.
     */
    audioGroup: "Som e microfone",
    accountGroup: "Notificações e configurações",
    painelDeControlo: "Painel de controlo",
    /*
      A roda dentada da faixa da conta. Nome próprio e não o do carril
      («Configurações»): dois botões com o mesmo nome na mesma página são dois
      alvos que um comando de voz e um leitor de ecrã não distinguem.
    */
    abrirDefinicoes: "Abrir as configurações",
    statusPrompt: "Em que andas?",
    unreadCount: (n: number): string => (n === 1 ? "1 mensagem por ler" : `${n} mensagens por ler`),
    drawerLabel: "Canais",
    /** Minimizar e voltar a mostrar. O nome do que se dobra entra na etiqueta:
     *  uma lista de "Minimizar" iguais não diz nada a quem ouve o ecrã. */
    collapse: (nome: string): string => `Minimizar ${nome}`,
    expand: (nome: string): string => `Mostrar ${nome}`,
    /** Quantas salas ficaram escondidas por baixo de uma categoria dobrada. */
    hiddenRooms: (n: number): string => (n === 1 ? "1 sala escondida" : `${n} salas escondidas`),
    /** Quem está numa sala de voz, quando as caras estão minimizadas. */
    voiceCount: (n: number): string => (n === 1 ? "1 pessoa nesta sala" : `${n} pessoas nesta sala`),
    /**
     * O cadeado ao lado de uma categoria restrita.
     *
     * Diz o que a marca significa e o que ela NÃO significa. As salas de um
     * canal público são legíveis por quem tem as chaves do canal, escondidas ou
     * não; o que a restrição faz é arrumar a lista. Prometer uma porta fechada
     * aqui era prometer o que a folha das propriedades desmente três linhas
     * abaixo — ver `categoryProperties.note`.
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
      Uma sala vazia, dita pela razão de estar vazia. Ver `vazioDaConversa`.

      Eram uma frase só para três estados diferentes, e a frase afirmava o mais
      raro dos três: "ainda ninguém escreveu aqui" numa sala onde se falou
      ontem é a aplicação a dizer a uma pessoa que a memória dela está errada.

      A do meio é a que não podia continuar por dizer. O cofre tem tecto por
      canal e vai deitando fora o mais antigo, e um ecrã em branco por cima
      disso lê-se como perda — pior, como perda por culpa de quem lê. A frase
      afirma só o que é sempre verdade (o aparelho guarda as mais recentes) e
      depois tira a culpa do caminho, que é a única coisa que ali faz falta.

      É o mesmo registo do `searchCeiling`, e pela mesma licença: diz ONDE as
      mensagens estão sem explicar COMO o produto funciona.
    */
    timelineEmpty: "Ainda ninguém escreveu aqui.",
    timelineEmptyBody: "Escreve a primeira mensagem.",
    /**
     * E o mesmo vazio quando não há caixa de escrita nenhuma.
     *
     * A frase de cima aponta para uma caixa que existe. Numa conversa com um
     * pedido de amizade por responder ela não existe, e mandar procurá-la em
     * baixo era mandar a pessoa procurar o que foi tirado de propósito.
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
    /** Por extenso na linha: a hora que se vê agora é a da escrita, e a que fica é a do envio. */
    aEsperaDeLigacaoNota: "à espera de ligação. Mostra a hora de envio.",
    discard: "Descartar",
    newMessages: "↓ Novas mensagens",
    loadOlder: "Carregar mais antigas",
    joinPending: "Pedido enviado. À espera que alguém do canal te aceite…",
    joined: (name: string): string => `Entraste em ${name}`,
    /** Com moradas opacas (1.0) e sem nome do selo nem publicado: sem nome. */
    joinedOpaco: "Entraste no canal.",
    /*
      Sair, que é o que antes se chamava "esquecer".

      A palavra mudou porque "esquecer" era jargão nosso: descrevia o que o
      programa faz ao cofre, e não o que a pessoa quer fazer. O que ela quer é
      ir-se embora. O que a frase promete continua igual, e continua a ser toda
      a verdade: o MLS não deixa um membro remover-se a si próprio, portanto
      sair é deste aparelho e os outros continuam a ver-nos na lista até alguém
      nos remover. Prometer uma saída limpa era prometer o que não há.
    */
    leaveTitle: "Sair deste canal?",
    leaveBody: "Deixas de ver as mensagens deste canal. Sais da lista de membros.",
    /** A saída a sério falhou (sem ligação, sem recibo). Esquecer só aqui é outra coisa, e diz-se. */
    leaveOfflineTitle: "Não foi possível sair do canal.",
    leaveOffline:
      "Podes sair só deste aparelho. Os outros membros continuam a ver-te na lista até alguém te remover.",
    /** O verbo dos dois avisos de baixo: diz onde se sai, e não só que se sai. */
    leaveOnlyHereAction: "Sair só deste aparelho",
    left: "Saíste do canal. Deixou de estar neste aparelho.",
    /** Esquecido só aqui: a folha fica na árvore e os outros continuam a ver a pessoa. */
    forgottenHere: "Esquecido neste aparelho. Os outros membros continuam a ver-te na lista.",
    /** Um anfitrião antigo sem saída a sério: só há esquecer, sem falha nenhuma antes. */
    leaveOnlyHereTitle: "Sair só deste aparelho?",
    leaveOnlyHere:
      "O canal sai só deste aparelho. Os outros membros continuam a ver-te na lista até alguém te remover.",

    /*
      Eliminar, que é o gesto sobre o canal e não sobre mim.

      A frase diz o que o código faz (revisão de 20/10/2026). A lápide
      (`space.removed`) chega a cada membro, e a app dele cumpre-a com
      `forgetChannel`, que apaga o histórico do canal no cofre. Uma app alterada
      ignora a lápide e fica com tudo. A frase não promete obediência que a
      cifra não garante. A mesma frase está em `roles.noteFinal`.
    */
    removeChannelTitle: (nome: string): string => `Eliminar "${nome}"?`,
    removeChannelConfirm:
      "O canal desaparece para todos os membros. Não podes desfazer isto. A app de cada membro apaga as mensagens do canal, mas uma app alterada pode guardá-las.",
    removedChannel: (nome: string): string => `"${nome}" eliminado.`,

    /**
     * Quem está a escrever.
     *
     * Acima de três nomes deixa de se lerem nomes e passa a ler-se uma parede,
     * e a linha é estreita: a partir daí conta-se quantos são.
     */
    typing: (nomes: string[]): string => {
      if (nomes.length === 1) return `${nomes[0] ?? ""} está a escrever…`
      if (nomes.length === 2) return `${nomes[0] ?? ""} e ${nomes[1] ?? ""} estão a escrever…`
      if (nomes.length === 3) return `${nomes[0] ?? ""}, ${nomes[1] ?? ""} e ${nomes[2] ?? ""} estão a escrever…`
      return `${nomes.length} pessoas estão a escrever…`
    },

    /**
     * A marca de onde se ficou, e o atalho para lá chegar.
     *
     * "Por ler" e não "não lidas": é o que se diz em português quando se volta a
     * uma conversa. O número vem à frente porque é o que decide se vale a pena
     * subir — uma mensagem lê-se de onde se está, sete não.
     */
    unreadMark: "por ler",
    unreadJump: (n: number): string =>
      n === 1 ? "1 mensagem por ler: ir para lá" : `${n} mensagens por ler: ir para lá`,

    imageAdd: "Anexar imagem",
    imageDrop: (nome: string): string => `Tirar ${nome}`,
    /** As imagens são comprimidas neste aparelho, antes de serem cifradas. */
    imageCompressing: "a comprimir…",
    imagesFull: (n: number): string => `Só cabem ${n} imagens numa mensagem.`,
    /** O tecto de conforto de uma mensagem (2000, como no Discord). Ver `MENSAGEM_MAX_CARACTERES`. */
    messageTooLong: (n: number): string => `A mensagem tem mais de ${n} caracteres. Encurta-a, ou divide-a em duas.`,
    /** A linha de `@all` na lista das menções. */
    mencionarTodos: "Toda a gente do canal",

    /**
     * Anexar um ficheiro que não é imagem.
     *
     * "Ficheiro" e não "documento": um `zip` não é um documento, e a palavra
     * larga é a que não deixa ninguém de fora.
     */
    fileAdd: "Anexar ficheiro",
    fileDrop: (nome: string): string => `Tirar ${nome}`,
    filesFull: (n: number): string => `Só cabem ${n} ficheiros numa mensagem.`,
    /**
     * A recusa, COM O NÚMERO.
     *
     * Um ficheiro grande de mais tem de ser recusado antes de sair, e a recusa
     * tem de dizer quanto é que cabia — senão a pessoa tenta outra vez às cegas.
     * O limite não é fixo: encolhe com o que a mensagem já leva, e por isso vem
     * como argumento em vez de estar escrito aqui.
     */
    fileTooBig: (nome: string, limite: string): string =>
      `${nome} não cabe nesta mensagem. O máximo é ${limite}. Com imagens ou texto já juntos, o máximo é menor.`,
    /** Nada mais cabe, e não é por causa deste ficheiro em particular. */
    fileNoRoom: "Esta mensagem já não leva mais nada. Envia o que tens e junta o ficheiro à seguinte.",
    /** O ficheiro está lá, e o disco não o deixa ler. Não é culpa da mensagem. */
    fileUnreadable: "Não foi possível ler esse ficheiro neste aparelho.",
    fileReading: "a ler…",
    fileDownload: "Guardar",
    fileDownloadOf: (nome: string): string => `Guardar ${nome}`,
    /** Os bytes que cá estão não se deixam ler. O anexo veio estragado. */
    fileBroken: "este anexo veio estragado e não se consegue guardar",
    /** A busca é feita por este dispositivo. Quem lê nunca contacta o site. */
    linkPreviewAsk: "Pré-visualizar",
    linkPreviewDrop: "Não pré-visualizar este link",

    /**
     * A cotovelada, à maneira do MSN. Só em conversas directas.
     *
     * O contador aparece no próprio botão: um botão que deixa de responder sem
     * dizer porquê parece avaria, e quem o carrega outra vez fica sem saber se
     * a primeira chegou.
     */
    buzz: "Cotovelada",
    /**
     * O `+` do compositor, que junta os três gestos que não são escrever.
     *
     * A 390px a linha rebentava com emojis, imagem, clipe, cotovelada e a caixa
     * de escrita. Fica a caixa larga e os dois botões de todos os dias; o resto
     * passa a estar a um clique.
     */
    moreActions: "Anexar ou abanar",
    /** A marca de editado, ao lado do texto. Curta: a hora vai na dica. */
    editedMark: "(editada)",
    messageEdit: "Editar",
    messageEditLabel: "O que querias ter dito",
    messageEditSave: "Guardar",
    /* Dito antes de guardar, e não descoberto depois. */
    messageEditNote: "A mensagem fica marcada como editada. Quem já a leu viu a versão anterior.",
    messageDelete: "Apagar",
    /* O «⋯» que aparece ao passar por cima de uma mensagem. Abre o menu que o
       botão direito abre: sem ele, fixar, editar e apagar só se achavam por
       quem soubesse do botão direito. */
    messageMore: "Mais acções nesta mensagem",
    /**
     * O que se diz antes de apagar, e é a verdade inteira.
     *
     * Apagar é um PEDIDO aos aparelhos dos outros. Sai do ecrã de quem o
     * cumpre; quem já leu, leu, e um cliente alterado ignora-o. Prometer
     * apagamento seria a mentira mais fácil de contar e a pior de descobrir.
     */
    messageDeleteTitle: "Apagar esta mensagem?",
    messageDeleteConfirm: "A mensagem sai da conversa. Apagar não desfaz o que alguém já leu.",
    /**
     * Eliminar a mensagem de outra pessoa, com o poder `moderar` (fase 3).
     *
     * «Eliminar» e não «Apagar»: é outro gesto, sobre o que outra pessoa disse,
     * e a linha fica no sítio com a marca. A frase do aviso é a da fase 6
     * («uma frase no momento certo»), e é a verdade inteira.
     */
    messageModerate: "Eliminar",
    messageModerateTitle: (nome: string): string => `Eliminar a mensagem de ${nome}?`,
    messageModerateConfirm: "As apps dos membros escondem a mensagem. Quem já a leu, já a leu.",
    /* O que fica no lugar do texto. */
    messageModerated: "Mensagem eliminada por moderação",
    /**
     * Fixar uma mensagem no topo da sala.
     *
     * "na sala" e não "no canal": fixa-se na divisão onde a mensagem foi dita,
     * e um canal tem várias. É a distinção que a interface inteira defende, e
     * é a que uma pessoa precisa para saber onde a vai voltar a encontrar.
     */
    messagePin: "Fixar na sala",
    messageUnpin: "Desafixar",
    /**
     * O que fixar faz, dito sem prometer a mais.
     *
     * Uma cópia do texto viaja com a fixação, e é por isso que ela continua a
     * ler-se quando a mensagem já saiu do histórico e para quem entrou no canal
     * depois. Dizê-lo aqui é o que impede a leitura de que fixar guarda a
     * mensagem para sempre: guarda o texto, não a conversa à volta dele.
     */
    pinnedTitle: "Fixadas nesta sala",
    pinnedToggle: "Ver o que está fixado nesta sala",
    pinnedNote: "Uma mensagem fixada continua visível depois de sair do histórico.",
    /*
      Duas frases para o mesmo vazio, porque são duas pessoas diferentes.

      Quem pode fixar precisa de saber por onde se fixa: sem isso, a folha é um
      rectângulo que anuncia uma funcionalidade e não diz como se lhe chega. A
      quem NÃO pode, a mesma frase seria a descrição de uma porta que não
      existe — a regra que o rodapé do painel de membros já segue.
    */
    pinnedEmpty: "Nada fixado nesta sala.",
    pinnedEmptyCanPin: 'Nada fixado nesta sala. Abre o menu de uma mensagem e escolhe "Fixar na sala".',
    /** Quem fixou, na linha de baixo de cada fixada. */
    pinnedBy: (nome: string): string => `fixada por ${nome}`,
    /** Uma mensagem sem texto: só imagens, ou só ficheiros. */
    pinnedNoText: "(sem texto)",
    pinnedDone: "Mensagem fixada nesta sala.",
    pinnedUndone: "Mensagem desafixada.",
    /**
     * A marca no canto de uma mensagem fixada.
     *
     * Só se lê em voz alta: o que se vê é um alfinete de doze píxeis, e o
     * alfinete diz o que é sem palavras. Aqui o que a frase tem de fazer é dar
     * a mesma informação a quem não vê o ícone, e por isso diz onde a mensagem
     * está fixada e não só que está.
     */
    pinnedMark: "Fixada nesta sala",
    buzzTitle: "Abana o ecrã da outra pessoa, com som.",
    buzzCounting: (segundos: number): string => `${segundos}s`,
    buzzWait: (segundos: number): string =>
      segundos === 1 ? "Podes dar outra dentro de 1 segundo" : `Podes dar outra dentro de ${segundos} segundos`,
    /**
     * O mesmo, dentro do menu do `+`, e mais curto de propósito.
     *
     * `buzzWait` é uma frase inteira porque vivia numa dica que se lê com o
     * rato parado em cima. Numa lista de opções, uma frase dessas empurra as
     * irmãs e esconde o nome do gesto — e o nome é o que se procura ao abrir o
     * menu. Aqui diz-se o que é primeiro, e quanto falta a seguir.
     */
    buzzMenuWait: (segundos: number): string => `Cotovelada (${segundos} s)`,

    /**
     * Procurar na conversa.
     *
     * **A frase que não pode faltar é a do limite**, e é `searchCeiling`. Este
     * aparelho guarda um número fixo de mensagens por canal e despeja a mais
     * antiga por cada uma que chega; o que saiu não está em lado nenhum a que
     * esta conta chegue, porque o servidor transporta texto cifrado e não o
     * guarda em claro. Uma procura que não encontra o que já saiu é
     * indistinguível de uma mensagem que nunca existiu, e a conclusão que uma
     * pessoa tira daí é sobre a outra pessoa. Por isso o aviso aparece SEMPRE
     * que o histórico está no tecto, e não só quando a procura falha: encontrar
     * três do que eram cinco engana exactamente da mesma maneira.
     *
     * "Neste aparelho" e não "no servidor" é a frase inteira em três palavras:
     * diz onde a procura acontece sem explicar como o produto funciona, que é a
     * regra da casa para esta fase.
     */
    searchToggle: "Procurar nesta conversa",
    searchPlaceholder: "Procurar",
    searchClear: "Limpar",
    searchHint: "Escreve para procurar nas mensagens deste canal.",
    searchEmpty: (termo: string): string => `Nada encontrado para "${termo}".`,
    searchCount: (n: number): string => (n === 1 ? "1 mensagem encontrada" : `${n} mensagens encontradas`),
    /** Acima disto a lista deixa de se ler e passa a ser uma parede. */
    searchMore: (mostradas: number, total: number): string =>
      `A mostrar as ${mostradas} mais recentes de ${total}. Escreve mais para afinar.`,
    searchScanned: (n: number): string =>
      n === 1 ? "Procurado em 1 mensagem guardada neste aparelho." : `Procurado em ${n} mensagens guardadas neste aparelho.`,
    searchCeiling:
      "A procura só encontra as mensagens guardadas neste aparelho.",
    /** A sala de onde o resultado veio, quando não é a sala aberta. */
    searchInRoom: (sala: string): string => `em ${sala}`,
    /** O resultado leva a pessoa à mensagem; a mensagem acende-se por um instante. */
    searchJump: "Ir para a mensagem",
    searchReading: "a ler…",
  },

  /**
   * O cartão do primeiro ecrã depois de criar a conta. Ver `PrimeirosPassos`.
   * Diz o que há para fazer, e não explica o produto.
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
   * O canal comum do servidor, e como ele se apresenta.
   *
   * A regra de escrita aqui é a mesma do resto do ficheiro, e é mais apertada
   * do que parece: nada disto pode prometer o que o produto não cumpre. "Selo"
   * é uma palavra perigosa — sugere verificação, e não há verificação nenhuma.
   * O que há é um servidor a apontar um canal, e o texto do `seloTitle` diz
   * exactamente isso, com a mesma frontalidade com que `roles.note` distingue o
   * que a cifra garante do que os clientes combinam entre si.
   *
   * O selo passou de palavra a símbolo por pedido do dono, e o `seloTitle`
   * ganhou com isso todo o peso: era a explicação ao lado de uma palavra que já
   * dizia meia coisa, e passou a ser a explicação inteira. Não se encurta.
   *
   * A apresentação é apresentação e não manual: diz onde a pessoa está e
   * convida-a a participar. Não explica como o produto funciona, não enumera
   * garantias, e aparece uma vez.
   *
   * Acolhe primeiro, informa depois. A primeira versão abria com quem entra
   * aqui e como — verdadeiro, mas era uma regra de admissão a servir de porta
   * de entrada, e quem chega não veio saber quem mais pode chegar. Que o canal
   * é público continua dito, numa palavra, no sítio onde interessa: a seguir
   * às boas-vindas.
   */
  oficial: {
    /**
     * Já não se vê no ecrã: é o nome ACESSÍVEL do selo, que passou a símbolo.
     *
     * Não é texto morto, e é por isso que fica aqui em vez de sair. O selo é
     * hoje um desenho, e um desenho não se lê a quem usa leitor de ecrã —
     * apagar esta palavra apagava a única forma de essas pessoas saberem que o
     * canal é o comum. Ver `SeloOficial.tsx`, que a põe no `aria-label`.
     */
    selo: "oficial",
    /*
      A proveniência E a porta, e não só a proveniência.

      Esta frase dizia quem aponta o canal e calava-se sobre quem lá entra. É a
      metade que interessa a quem está a escrever: a sala comum está aberta a
      qualquer conta deste servidor por decisão tomada (ver
      `channel.groupinfo.take`, no `gateway.ts`, que o diz por extenso), e o
      único sítio onde isso aparecia era um cartão de boas-vindas que se
      dispensa uma vez e nunca mais volta. Quem chegou antes dele, ou o fechou
      há três semanas, escrevia num canal público a pensar que era o seu.
    */
    seloTitle:
      "Canal comum deste servidor. Qualquer conta entra sem convite. Só o servidor pode dar este selo.",
    apresentacaoTitle: "Bem-vindo ao Orwell.",
    /*
      Uma linha, e mais nada.

      Tinha três: a apresentação, um convite a escrever e uma indicação de onde
      reportar avarias. Um cartão de boas-vindas com três parágrafos é uma
      leitura obrigatória à porta de uma conversa, e ninguém a faz: lê-se a
      primeira linha e fecha-se. Decisão do dono a 14 de Agosto de 2026.
    */
    apresentacaoBody: "Este é o canal comum do servidor. Todas as contas o podem ler.",
    apresentacaoFechar: "Fechar",
  },

  /*
    A sala «anúncios» do canal oficial, que mostra as notas de cada versão em
    vez da conversa. Só os rótulos: as notas ficam em português, porque vêm de
    `docs/novidades.json` (ver `NotasDeVersao.tsx`). A frase de baixo ocupa o
    lugar da barra de escrita, pela razão de `chat-escrita-trancada`: um buraco
    onde a pessoa procura a caixa lê-se como avaria.
  */
  novidades: {
    titulo: "Release notes",
    soLeitura: "Esta sala é só para ler. Aqui ficam as release notes de cada versão.",
  },

  /*
    O distintivo de quem trouxe uma comunidade para o Orwell. Quem o dá é a
    lista em `lib/embaixadores.ts`, que viaja com a app. A mesma frase é o
    nome acessível e o `title`: o desenho sozinho não se lê.
  */
  embaixador: {
    selo: "Embaixador do Orwell",
  },

  members: {
    count: (n: number): string => (n === 1 ? "1 pessoa" : `${n} pessoas`),
    /* O nome da gaveta, para quem ouve o ecrã. Só existe em ecrã estreito, que
       é onde esta coluna passa a ser um painel por cima da conversa. */
    drawerLabel: "Pessoas",
    /* Os cabeçalhos da lista arrumada por cargo. O ponto separa sem parecer um
       traço de diálogo, e a contagem vai ao lado do título porque é a pergunta
       seguinte de quem olha para um cargo: quantos são. */
    groupOnline: "Online",
    groupOffline: "Offline",
    groupHeading: (titulo: string, n: number): string => `${titulo} · ${n}`,
    loading: "A carregar…",
    empty: "Ainda ninguém aqui.",
    inviteSomeone: "Convidar…",
    /*
      A porta do canal comum, dita na lista de quem já lá está.

      Esta lista responde à pergunta "quem consegue ler isto", e num canal
      comum a resposta não é a lista: é a lista de hoje mais qualquer conta
      deste servidor que se ligue amanhã. Sem esta linha, uma lista de quatro
      nomes lê-se como quatro pessoas, e o rodapé com os dois botões de
      convite ensina que a única forma de entrar é ser convidado.

      Fora do rodapé de propósito: convidar depende de responsabilidade, saber
      onde se está não depende de nada.
    */
    openChannel: "Canal comum. Qualquer conta deste servidor entra sem convite e lê.",
    verifyHint: (name: string): string => `Verificar a segurança com ${name}`,
  },

  /**
   * Os cargos do canal, e a distinção que não pode falhar.
   *
   * De todas elas, só expulsar tem peso criptográfico: tira as chaves a quem
   * sai, e nem o cliente dele desfaz isso. As outras são combinações que os
   * clientes cumprem, e um cliente alterado ignora-as. Mostrá-las com a mesma
   * cara prometia protecção onde só há arrumação.
   *
   * `eliminar` é a que mais custa a arrumar deste lado: acaba com o canal para
   * toda a gente, o que soa a criptografia, e não é — é a lápide que os
   * clientes honestos cumprem. Fica onde pertence, entre as combinações, por
   * mais grave que seja o efeito.
   *
   * **São TRÊS registos e não dois**, e esta secção dizia dois. O protocolo faz
   * duas perguntas diferentes e guarda-as em duas listas diferentes:
   * `CRYPTOGRAPHIC_POWERS` pergunta o que a cifra garante contra um cliente
   * alterado, e `IRREVERSIBLE_POWERS` pergunta o que não se desfaz a quem
   * cumpre. `expulsar` está nas duas; `eliminar` só na segunda — é convenção, e
   * mesmo assim não tem gesto inverso. Enquanto a interface teve só duas
   * frases, `eliminar` saía na mesma linha que `mudar o nome`: "Combinado entre
   * clientes: acabar com o canal, mudar o nome." Uma lista de dois verbos em que
   * um deles desfaz o canal para toda a gente e o outro se desfaz a escrever
   * outra vez.
   */
  roles: {
    title: "Cargos",
    accessOnly: "Só acesso ao canal.",
    cryptographic: (list: string): string => `Garantido: ${list}.`,
    /**
     * O registo do meio: o que os clientes só combinam, e mesmo assim não volta
     * atrás.
     *
     * Hoje é `eliminar` sozinha, e amanhã é o que `IRREVERSIBLE_POWERS` disser —
     * a frase não enumera nada de propósito, pela razão escrita em `note`.
     *
     * "Não tem volta" e não "irreversível": a palavra técnica é a que está no
     * protocolo, e quem está a dar um cargo a alguém não tem de a conhecer para
     * perceber que aquilo não se desfaz.
     */
    irreversible: (list: string): string => `Definitivo: ${list}.`,
    convention: (list: string): string => `Regra da app: ${list}.`,
    /* "As outras" e não a lista por extenso: a lista cresceu com `eliminar` e
       vai crescer outra vez, e uma frase que as enumera fica desactualizada em
       silêncio: a dizer que uma responsabilidade nova é garantida pela cifra
       quando não é. */
    note: "Quem é expulso deixa de ler o canal. As outras regras dependem da app de cada pessoa.",
    /* A segunda metade da nota, dita à parte para poder ser desenhada à parte.
       Junta à de cima ficava um parágrafo de três frases em 11px cinzento, que
       é a forma de garantir que a terceira não se lê. */
    noteFinal: "Acabar com o canal é definitivo. A app de cada membro apaga as mensagens do canal, mas uma app alterada pode guardá-las.",
    /* `dropHint` e `dropTitle` viviam aqui, e depois `give`, `givePick` e
       `giveTitle`. Nenhum é uma perda: o arrasto morreu quando os cargos
       saíram do painel de pessoas, e o selector que o substituiu foi com a
       atribuição para o perfil da pessoa: que é onde se olha para alguém.
       Aqui define-se o cargo; lá dá-se. Ver `MemberRoles`. */
    assignElsewhere: "Dar um cargo a alguém faz-se no perfil dessa pessoa.",
    add: "Novo cargo",
    nameLabel: "Nome do cargo",
    namePlaceholder: "Moderador",
    sealedGroup: "Garantido",
    /* O grupo do meio do formulário. Mesma palavra da linha da lista: quem
       marca a caixa e quem depois lê o cartão têm de reconhecer a mesma coisa. */
    irreversibleGroup: "Definitivo",
    conventionGroup: "Regras da app",
    /* Dito no formulário e não só na lista: é aqui que os poderes são dados. */
    sealedNote: "A pessoa expulsa deixa de ler o canal.",
    irreversibleNote: "Não se pode desfazer.",
    conventionNote: "A app do Orwell cumpre estas regras. Uma app alterada pode não cumprir.",
    create: "Criar cargo",
    /* Editar um cargo que já existe. O identificador não muda — só o letreiro
       e as responsabilidades: , e é por isso que renomear não desnomeia. */
    edit: "Editar",
    editTitle: (role: string): string => `Editar o cargo ${role}`,
    /* Mudar o nome no sítio, na lista dos cargos (2/11/2026). */
    rename: "Mudar o nome",
    renameTitle: (role: string): string => `Mudar o nome do cargo ${role}`,
    renameLabel: (role: string): string => `Nome novo do cargo ${role}`,
    save: "Guardar",
    /* "Apagar o cargo", com o nome: numa lista de cargos, uma etiqueta que
       diga só "Apagar" não diz o que vai desaparecer. */
    deleteLabel: "Apagar",
    deleteTitle: (role: string): string => `Apagar o cargo ${role}`,
    deleteNote: "Quem tinha este cargo perde os poderes dele. Ninguém é expulso.",
    powers: {
      expulsar: "expulsar",
      convidar: "convidar",
      renomear: "mudar o nome",
      mover: "mover",
      /* "acabar com o canal" e não "eliminar": no meio de uma lista de verbos
         curtos, "eliminar" lia-se como eliminar uma sala ou uma pessoa. O que
         esta responsabilidade dá é acabar com o canal inteiro, e quem a está a
         atribuir tem de o perceber sem abrir mais nada. */
      eliminar: "acabar com o canal",
      /* "fixar mensagens" e não "fixar": sozinho, o verbo lê-se como fixar a
         SALA no topo da lista, que é outra coisa e que ninguém pediu. O
         complemento é o que diz sobre o que a responsabilidade se exerce. */
      fixar: "fixar mensagens",
      /* "atender tickets", e não só "atender": num cargo, "atender" sozinho
         não diz atender o quê. É a mesma razão por que "eliminar" virou
         "acabar com o canal". */
      atender: "atender tickets",
      /* "moderar" sozinho, e o resto na frase de ajuda: as três coisas que dá
         (mensagens, tickets fechados, apelidos) não cabem num verbo curto. */
      moderar: "moderar",
      /* O modelo de permissões da 1.2 (§4 do plano da paridade). */
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
    /* A cor do cargo.
       Nomeada por extenso, e não só mostrada: a escolha ENTRE cores é a única
       coisa neste ecrã que a cor teria de comunicar sozinha, e quem não as
       distingue ficava a escolher às cegas. Em todo o lado onde a cor é DADA: 
       na lista de pessoas, no cartão do cargo: ela pinta o nome do cargo, que
       está escrito ao lado e diz tudo sem ela. */
    colourLabel: "Cor",
    /* O caso normal, e por isso é uma escolha na fila e não uma ausência de
       escolha: um cargo sem cor tem de ter onde se voltar a pôr sem cor. */
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
   * Os cargos de uma pessoa, no perfil dela.
   *
   * O título nomeia sempre o canal, e não é decoração: um cargo não existe
   * fora de um canal, e "Cargos" sozinho, no perfil de alguém, diria que a
   * pessoa é moderadora em toda a parte. Quando não há canal de que falar — o
   * perfil aberto a partir do feed — a secção não aparece de todo.
   */
  memberRoles: {
    title: (channel: string): string => `Cargos em ${channel}`,
    /**
     * As duas metades da lista, e a razão de a lista ser duas.
     *
     * A pergunta deste ecrã é "que cargos é que esta pessoa tem?", e a resposta
     * estava num quadrado de 13px no canto de quatro cartões iguais: quem
     * quisesse saber tinha de ler as caixas uma a uma. Separadas, a resposta
     * lê-se do título — e o que sobra passa a ser o que se lhe pode DAR, que é
     * a outra pergunta e merece o seu próprio letreiro.
     *
     * O número no título e não só as linhas: "Tem" com uma lista por baixo
     * obriga a contar, e contar não é ler.
     */
    has: (n: number): string => (n === 1 ? "Tem 1 cargo" : `Tem ${n} cargos`),
    /* O outro lado. Só aparece a quem pode dar: para quem não pode, a lista
       completa das etiquetas do canal a meio do perfil de alguém é inventário. */
    available: "Pode receber",
    /* Quem não tem nenhum, dito por palavras. Um título "Tem 0 cargos" com o
       vazio por baixo conta o nada como se fosse informação. */
    none: "Sem cargos neste canal.",
    /** Quem fundou não se destitui: é um facto do canal, não um cargo dado. */
    founder: "Fundou este canal.",
    /** O cargo embutido. Nomeia-se e destitui-se pelo menu da pessoa. */
    admin: "Administrador do canal.",
    /* Dito a quem pode dar cargos: sem cargos declarados não há nada a dar, e
       o caminho para os criar não é aqui. */
    noneDeclared: "Este canal ainda não tem cargos. Cria-os nas propriedades do canal.",
    founderLocked: "Não podes mudar os cargos de quem fundou o canal.",
  },

  /**
   * O editor de cargos com três separadores, como o Discord arruma um cargo.
   *
   * Bloco novo, e não chaves novas em `roles`, a 27 de Outubro de 2026: o
   * pedido do dono foi «reorganiza o menu, tal e qual como no Discord», e o
   * texto do editor antigo continua a servir os cartões da lista e o perfil.
   *
   * Uma frase por responsabilidade, em STE100: o verbo, o objecto, e o efeito
   * quando o efeito muda a decisão. Quem dá um cargo lê isto no momento de o
   * dar, e não abre mais nada.
   */
  /**
   * O componente `CargosEPermissoes` (1.2, §4 do plano da paridade): a ordem
   * dos cargos, as permissões de toda a gente e as permissões por sala. Cada
   * permissão diz o que a cifra garante e o que é só regra da app.
   */
  cargosEPermissoes: {
    titulo: "Cargos e permissões",
    ordemTitulo: "Ordem dos cargos",
    ordemNota: "O cargo de cima manda nos de baixo.",
    /** Só a quem pode ordenar: o fundador e a administração. */
    ordemComoMudar: "Arrasta um cargo, ou usa as setas, para mudar a ordem.",
    /** Depois de arrastar ou de uma seta, para o leitor de ecrã. */
    posicaoNova: (cargo: string, lugar: number, total: number): string => `"${cargo}" está agora no lugar ${lugar} de ${total}.`,
    /** Ao pé da lista, para quem pode ordenar: o que não se mexe e quem vê. */
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
    /* Voltar à lista sem guardar. "Cancelar" diz o mesmo e já existe; este é
       o letreiro do botão de cima, que fecha o cargo aberto. */
    back: "Todos os cargos",
    open: "Ver",
    openTitle: (role: string): string => `Ver o cargo ${role}`,
    /* O cargo embutido. Não é declarado pelo canal: vem com ele. */
    adminName: "Administrador",
    adminReadOnly: "Este cargo vem com o canal. Tem sempre todas as permissões e não se apaga.",
    /* Desde 2/11/2026 o nome e a cor do embutido mudam-se. */
    adminAppearance: "Podes mudar o nome e a cor deste cargo. As permissões não mudam.",
    /* Só o fundador o lê. Desde a fase 3 o fundador cria os cargos de
       administração com os poderes que escolhe (moderar incluído); o embutido
       continua a ter tudo, e a frase diz o caminho para dar só uma parte. */
    adminWarning: "Este cargo tem tudo. Para dar só uma parte, cria um cargo novo e escolhe as permissões.",
    previewLabel: "Pré-visualização",
    previewNote: "Assim aparece o cargo na lista de membros.",
    /* O nome de exemplo da pré-visualização. Um nome e não um endereço: a
       lista de membros mostra nomes. */
    previewPerson: "Ana",
    groups: {
      gerir: "Gerir canal",
      membros: "Membros",
      mensagens: "Mensagens",
      voz: "Voz",
      /* Uma responsabilidade que uma versão futura acrescente e esta não
         saiba arrumar. Aparece aqui em vez de desaparecer. */
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
    /* Os membros com este cargo. */
    membersCount: (n: number): string => (n === 1 ? "1 membro" : `${n} membros`),
    membersNone: "Ninguém tem este cargo.",
    addMembers: "Adicionar membros",
    addMember: "Adicionar",
    addMemberTitle: (name: string): string => `Dar este cargo a ${name}`,
    removeMember: "Tirar",
    removeMemberTitle: (name: string): string => `Tirar este cargo a ${name}`,
    candidatesNone: "Todos os membros já têm este cargo.",
    doneAdding: "Concluído",
    /* A porta para onde a atribuição vive enquanto esta folha não a recebe. */
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
     * Partilhar o ecrã: a acção, nos dois sentidos.
     *
     * Duas frases e não uma com "Parar" colado à frente: o que se lê num balão
     * de ajuda é o que vai acontecer se se clicar, e "Partilhar ecrã" com o
     * botão aceso lia-se como "já estás a partilhar".
     */
    shareScreen: "Partilhar ecrã",
    stopScreen: "Parar de partilhar",
    /**
     * O mesmo, para quem ouve o ecrã, com o estado à frente da acção.
     *
     * Mesma regra do `micAria`: começa pela palavra que está no botão, para
     * quem usa comando de voz poder pedir o botão pelo nome que vê.
     */
    screenAria: (sharing: boolean): string =>
      sharing ? "A partilhar ecrã. Parar de partilhar." : "Partilhar ecrã.",
    /**
     * Por que é que o botão de partilhar não está lá.
     *
     * Duas razões, e as duas são físicas. Um botão ausente sem explicação é o
     * que faz alguém procurar nas Configurações uma opção que não existe.
     */
    shareScreenBySfu: "Nesta chamada só passa voz.",
    /**
     * O tecto de gente.
     *
     * Na malha o que estoira é a SUBIDA de quem partilha; com um servidor de
     * media é a saída do SERVIDOR. Desde a revisão STE100 de 20/10/2026 a frase
     * diz só o limite, que é verdade nos dois casos, e `porServidor` fica na
     * assinatura para quem a chama.
     */
    shareScreenByPeople: (limite: number, _porServidor = false): string =>
      `Com ${limite} ou mais pessoas na chamada, não é possível partilhar o ecrã.`,
    /**
     * Quem está a partilhar, ao lado do nome.
     *
     * A marca aparece numa lista de gente e num rótulo de imagem, e um nome
     * acessível que não diz de quem é obriga a contar linhas para descobrir. É
     * a mesma decisão do `micOffOf`, pela mesma razão.
     */
    sharingOf: (name: string): string => `${name} está a partilhar o ecrã`,
    /** O rótulo do palco: de quem é aquele ecrã. */
    screenOf: (name: string): string => `Ecrã de ${name}`,
    /** O nosso próprio ecrã no palco. Ninguém diz "ecrã de Eu". */
    screenSelf: "O teu ecrã",
    /**
     * O som do ecrã de quem partilha, no palco: volume próprio, à parte do
     * volume da voz dessa pessoa (é música ou som do sistema, não a voz).
     */
    screenSoundVolume: "Volume do som do ecrã",
    /** O palco da partilha em ecrã inteiro (pedido do dono, 2/11/2026). Também com duplo clique; Esc sai. */
    ecraInteiro: "Ver em ecrã inteiro",
    sairDoEcraInteiro: "Sair do ecrã inteiro",
    /** O sinal de quem partilha: o som do sistema está a sair. */
    screenSoundSharing: "A partilhar o som do sistema",
    /** O sinal, com o som calado por quem partilha. */
    screenSoundMutedSelf: "O som do sistema está calado",
    /** O gesto ao lado de «Parar de partilhar». Não renegocia nada. */
    screenSoundMute: "Calar o som do ecrã",
    screenSoundUnmute: "Ligar o som do ecrã",
    /**
     * O convite a ver o ecrã de alguém, e a saída dele.
     *
     * Pedido do dono a 5 de Outubro de 2026: *quando alguém partilha o ecrã, os
     * outros devem entrar na stream só se quiserem.* Até aqui o palco abria
     * sozinho e levava 2,5 Mbps com ele, sem ninguém ter escolhido nada.
     *
     * «Ver» e não «Aceitar»: não é um pedido de autorização dirigido a quem lê,
     * é uma coisa que está ali e que se pode olhar. E «Parar de ver» e não
     * «Recusar», pela mesma razão vista do outro lado.
     */
    screenWatch: "Ver",
    screenStopWatching: "Parar de ver",
    /** O nome acessível dos dois botões: um «Ver» sozinho não diz ver o quê. */
    screenWatchAria: (name: string): string => `Ver o ecrã de ${name}`,
    screenStopWatchingAria: (name: string): string => `Parar de ver o ecrã de ${name}`,
    /**
     * Quantos estão a ver o nosso ecrã.
     *
     * O buraco simétrico do pedido, e da mesma peça: quem partilha não sabia
     * quem está a ver. Com a escolha a existir passou a ser informação que falta
     * de verdade — antes disto todos viam, e o número não dizia nada.
     *
     * Zero diz-se, e não se cala: partilhar um ecrã que ninguém está a ver é
     * precisamente o que convém saber antes de se falar dez minutos para ele.
     */
    screenViewers: (n: number): string =>
      n === 0 ? "Ninguém a ver" : n === 1 ? "1 a ver" : `${n} a ver`,
    /**
     * O cartão de quem partilha o ecrã («A com a C», escolhido pelo dono a 2 de
     * Novembro de 2026): o selo, e o convite que aparece ao passar o rato. Em
     * maiúsculas no texto, e não só no CSS, para o leitor de ecrã dizer o mesmo
     * que se vê.
     */
    aoVivo: "AO VIVO",
    verATransmissao: "Ver a transmissão",
    /** O nome acessível começa pelo que se lê no botão (ver `screenWatchAria`). */
    verATransmissaoDe: (name: string): string => `Ver a transmissão de ${name}`,
    /**
     * Estado e acção juntos, para quem ouve o ecrã.
     *
     * Começa pela palavra visível, exactamente como ela está escrita no botão:
     * um nome acessível que não contém a etiqueta que se lê deixa quem usa
     * comando de voz a pedir um botão que o computador não reconhece. É por
     * isso que diz "Silenciado. Ligar microfone." e não "Microfone silenciado" —
     * a segunda versão parece melhor escrita e falha a regra.
     */
    micAria: (muted: boolean): string =>
      muted ? "Silenciado. Ligar microfone." : "Microfone ligado. Desligar microfone.",
    soundAria: (off: boolean): string =>
      off ? "Sem som. Ligar o som." : "Som ligado. Desligar o som.",
    /** Por que é que o microfone está calado sem ninguém lhe ter mexido. */
    micBySound: "Silenciado porque o som está desligado",
    /**
     * A imagem desta pessoa está a sair mais pequena do que ela escolheu.
     *
     * **Existe porque a descida era muda.** O browser baixa a resolução sozinho
     * quando a subida não chega, e sem uma linha que o diga a pessoa aparece aos
     * outros a 360p com o menu a dizer 720p. O que ela conclui é que o produto é
     * mau, e não que a rede dela está má — é a conclusão errada, e é a que o
     * silêncio garante.
     *
     * **Diz a CAUSA e não o remédio.** "Melhora a tua ligação" seria dar uma
     * ordem a quem não tem nada a fazer com ela num comboio; "a rede não dá
     * mais" é a física, e o que fazer com ela é decisão de quem lê.
     *
     * **Sem o número de linhas.** Saiu na revisão STE100 de 20/10/2026:
     * «linhas» e «máquina» são jargão. A altura fica na assinatura.
     */
    videoLimitado: (razao: "bandwidth" | "cpu", _altura: number): string =>
      razao === "bandwidth" ? "imagem reduzida: rede lenta" : "imagem reduzida: aparelho lento",
    /**
     * As setas ao lado de cada ícone, no cartão da conta.
     *
     * Nomeadas pelo que abrem e não pela forma que têm: "seta para cima" diz a
     * quem ouve o ecrã o desenho do botão, que é a única coisa que essa pessoa
     * não precisa de saber.
     */
    micOptions: "Opções de microfone",
    soundOptions: "Opções de som",
    /** O microfone que o sistema escolher por nós. Ver `inputDeviceUnnamed`. */
    inputDeviceDefault: "O que o sistema escolher",
    /**
     * Antes de haver permissão, os nomes vêm vazios.
     *
     * `enumerateDevices` responde sempre, mas só põe etiqueta nos aparelhos
     * depois de alguém ter dado acesso ao microfone uma vez — antes disso a
     * lista existe e é ilegível, e uma lista de "Microfone 1, Microfone 2" não
     * ajuda ninguém a escolher. Diz-se o que falta em vez de a mostrar assim.
     */
    inputDevicesLocked: "Os microfones só aparecem pelo nome depois de dares acesso ao microfone uma vez.",
    inputDevicesNone: "Nenhum microfone encontrado.",
    /** Quando os nomes ainda não se lêem: leva a onde a escolha se pode fazer. */
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
      "A ligar" só onde há mesmo alguma coisa a ligar-se.

      Numa chamada de malha há: dois computadores a negociar uma ligação
      directa, e esta frase descreve-a. Numa chamada por SFU não há nada a
      ligar-se com aquela pessoa — a ligação é ao servidor, e já está feita.
      As quatro frases abaixo são os outros três estados que esta cobria
      sozinha. Ver `lib/estadoDaChamada.ts`, onde a regra de decisão vive.
    */
    connecting: "a ligar…",
    /** SFU, dentro do prazo: ela está lá, o som dela é que ainda não chegou. */
    naChamadaSemSom: "na chamada, sem som ainda",
    /*
      SFU, passado o prazo. Não afirma a causa porque há mais do que uma (ela
      pode estar noutro caminho de media, o produtor dela pode ter falhado), e
      afirmar a errada é pior do que dizer o que se vê. O que se vê é isto.
    */
    semSomHaMuito: "na chamada, mas o som não chega aqui",
    /** Malha, passado o prazo: aqui a ligação existia mesmo, e não se fez. */
    semLigacao: "não foi possível ligar a esta pessoa",
    silenced: "silenciado por ti",
    /**
     * A ESCOLHA DELA de não falar — o contrário de `silenced`, que é a nossa
     * escolha de não a ouvir.
     *
     * Duas frases porque são dois factos opostos, e o ecrã mostra-os no mesmo
     * sítio. "Silenciado" sozinho não distingue os dois, e a pessoa que baixou
     * o volume de alguém acabava a pensar que essa pessoa se tinha calado — ou
     * pior, ao contrário: à espera de uma resposta de quem tem o microfone
     * desligado, convencida de que era ela que o tinha mandado calar.
     *
     * Diz o nome porque a marca aparece numa lista de gente, e um nome
     * acessível que não diz de quem é obriga a contar linhas para descobrir.
     */
    micOffOf: (name: string): string => `${name} calou o próprio microfone`,
    /**
     * O outro silêncio, agora também com desenho: fomos NÓS que pusemos o
     * volume desta pessoa a zero. Diz de quem é o gesto e onde se desfaz, porque
     * quem o fez há uma semana já não se lembra.
     */
    silencedByYouOf: (name: string): string => `Silenciaste ${name}: tens o volume desta pessoa a zero`,
    volumeOf: (label: string): string => `Volume de ${label}`,
    /* O menu da pessoa no cartão da chamada (fase 3): o bloco da chamada. */
    menuSection: "Nesta chamada",
    menuSilence: "Silenciar para mim",
    menuUnsilence: "Voltar a ouvir",
    menuVolume: "Volume",
    menuVolumeValor: (pct: number): string => `${pct} %`,
    menuVolumeRepor: "Repor o volume normal, 100 %",
    /* O «⋯» do cartão, com o nome: há um por pessoa. */
    personMenu: (label: string): string => `Mais acções sobre ${label}`,
  /*
    Os avisos da chamada: o que o registo dizia e o ecrã calava.

    O núcleo emite diagnósticos com nome próprio, e a concha escrevia-os todos
    no registo de Diagnóstico e mais nada. Para a mecânica está certo. Para
    estes três está errado, porque descrevem uma chamada que não vai funcionar.

    Ver `lib/estadoDaChamada.ts` para quais entram e quais ficam de fora.
  */
    /*
      A avaria que o `call.ts` documenta e a interface não dizia.

      Duas pessoas na mesma sala podem estar em caminhos de media diferentes,
      uma pelo SFU e outra pela malha, e nunca se ouvirem. A oferta que chega
      pelo caminho errado é ignorada e fica uma linha no registo; do outro lado
      lê-se "a ligar" até a pessoa desistir.

      A frase diz o que se sabe e o que se pode fazer, e mais nada. Não manda
      trocar de browser porque não é sempre o browser: pode ser o servidor sem
      SFU, ou este ambiente sem cifra de media.
    */
    avisoCaminhosDiferentesDe: (nome: string): string => `Tu e ${nome} não se ouvem. Saiam os dois da chamada e voltem a entrar.`,
    avisoCaminhosDiferentes:
      "Uma pessoa nesta chamada não te ouve. Saiam os dois da chamada e voltem a entrar.",
    /** A entrada no SFU falhou e a chamada foi largada inteira. */
    avisoEntradaFalhou:
      "A chamada não começou. Tenta outra vez. Se voltar a falhar, copia o registo em Configurações, Diagnóstico.",
    /** Quem desapareceu sem desligar. Nota, não avaria: a chamada continua. */
    avisoPresencaCaducouDe: (nome: string): string => `${nome} perdeu a ligação e saiu da chamada.`,
    avisoPresencaCaducou: "Uma pessoa perdeu a ligação e saiu da chamada.",
    /** Fechar o aviso. Fica escrito no registo de qualquer maneira. */
    avisoFechar: "Fechar o aviso",
    /* A janela de chamada à Discord (fase visual, agente H). */
    vistaAria: (sala: string): string => `Chamada em ${sala}`,
    pessoasNaChamada: "Pessoas na chamada",
    controlos: "Controlo da chamada",
    soPalco: "Ver só o palco",
    conversaDaSala: "Conversa da sala",
    focoAria: (nome: string): string => `${nome}, em foco`,
  },

  /**
   * A partilha de ecrã na aplicação instalada: escolher o quê, e a permissão.
   *
   * Nada disto existe no browser. Lá o Chrome traz o selector dele e trata da
   * permissão sozinho; aqui o selector é nosso, porque sem ele o
   * `getDisplayMedia` do Electron cai num pedido que ninguém responde. Ver
   * `apps/client/src/main/ecra.ts`, onde a decisão vive.
   */
  ecra: {
    /** O selector: o título diz a escolha, não o mecanismo. */
    escolherTitulo: "Escolher o que partilhar",
    escolherLead: "Quem está na chamada passa a ver isto até parares a partilha.",
    /**
     * Os dois grupos, porque são duas coisas diferentes.
     *
     * Um ecrã inteiro mostra tudo o que lá estiver, incluindo o que aparecer a
     * seguir; uma janela mostra uma aplicação e mais nada. Quem escolhe tem de
     * saber qual dos dois está a escolher, e por isso a lista nunca é uma só.
     */
    ecras: "Ecrãs",
    janelas: "Janelas",
    /** O aviso que separa os dois grupos do que a escolha custa. */
    ecraInteiroNota: "Um ecrã inteiro mostra tudo o que lá aparecer, avisos do sistema incluídos.",
    /** O macOS devolve janelas sem título. Uma lista com buracos é pior. */
    semNome: "Janela sem nome",
    aCarregar: "A procurar o que há para partilhar…",
    vazio: "Não há nada para partilhar neste momento.",
    /** Para quem ouve o ecrã: o botão é uma escolha, e diz o que escolhe. */
    escolherAria: (nome: string): string => `Partilhar ${nome}`,
    /** O modo «só som» do DJ (2/11/2026): escolhe-se a janela, e só o som vai. */
    escolherSomTitulo: "De onde vem o som",
    escolherSomLead: "Os outros ouvem o som. Não vêem a janela.",
    escolherSomAria: (nome: string): string => `Partilhar o som de ${nome}`,
    /**
     * O som do sistema na aplicação, numa linha e sem caixa.
     *
     * O som do sistema é tudo o que o computador toca: música, notificações, e
     * a voz da própria chamada. Vai SEMPRE que o sistema o dá, sem caixa:
     * pedido do dono a 2/11/2026. Esta linha só informa, e diz como o calar.
     */
    somDoSistemaNota:
      'O som do sistema vai com o ecrã. Este som inclui a voz da chamada, e os outros podem ouvir-se com atraso. Para o calar, carrega em "Calar o som do ecrã" na chamada.',

    /**
     * A folha do macOS, quando o sistema já não pergunta mais.
     *
     * Só aparece em `denied` ou `restricted` — em `not-determined` o macOS
     * ainda abre o diálogo dele, e uma folha nossa por cima seria a aplicação a
     * explicar o que o sistema está a perguntar ao mesmo tempo. Ver
     * `permissaoDeEcra`.
     */
    permissaoTitulo: "O macOS não está a deixar gravar o ecrã",
    /**
     * DE QUEM é a permissão, dito antes de tudo o resto.
     *
     * É do sistema e não da aplicação, e quem não souber isso vai procurá-la às
     * Configurações do Orwell, onde nunca esteve nem pode estar. A frase começa
     * por aí de propósito: sem esse enquadramento, o botão que abre as
     * Definições parece um atalho para uma opção nossa.
     */
    permissaoCorpo:
      "Abre as Definições do macOS, Privacidade e Segurança, Gravação do Ecrã, e liga o Orwell. Sem isto, não podes partilhar o ecrã.",
    /**
     * A linha que não se pode calar.
     *
     * O macOS só entrega a captura a um processo que arrancou DEPOIS de a
     * permissão existir. Sem esta frase, a pessoa dá a permissão, volta à
     * aplicação, carrega outra vez e continua a não funcionar, e a conclusão
     * que tira é que o produto está avariado. É do sistema e não se contorna:
     * diz-se, em vez de se fingir que o botão resolve tudo.
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
      As duas frases que aqui estavam — "Essa imagem é um monstro (máx. 3 MB)" e
      "máx. 6 MB de imagens por post" — foram-se com os números que as
      justificavam. Mediam o ficheiro COMO ELE ENTRA, e a partir do dia em que a
      publicação passou a comprimir as imagens antes de as cifrar isso deixou de
      querer dizer nada: uma captura de ecrã de um 4K entra com doze megabytes e
      sai com trezentos kilobytes. Recusá-la à porta era recusar a única coisa
      que as pessoas colam.

      O que ficou no lugar mede o que vai mesmo para o fio — ver
      `bytesQueAindaCabem` — e conta as imagens que já lá estão.
    */
    imagesFull: (n: number): string => `Só cabem ${n} imagens numa publicação.`,
    imagesNoRoom: "Esta publicação já não leva mais imagens. Publica o que tens e junta a imagem a outra.",

    /**
     * Anexar ficheiros a uma publicação.
     *
     * As mesmas frases da conversa, com uma diferença que não é de estilo: aqui
     * diz-se "publicação" e não "mensagem", porque é isso que a pessoa está a
     * fazer e o tecto é do que ela está a compor.
     */
    fileAdd: "Anexar ficheiro",
    fileDrop: (nome: string): string => `Tirar ${nome}`,
    filesFull: (n: number): string => `Só cabem ${n} ficheiros numa publicação.`,
    fileTooBig: (nome: string, limite: string): string =>
      `${nome} não cabe nesta publicação. O máximo é ${limite}. Com imagens ou texto já juntos, o máximo é menor.`,
    fileNoRoom: "Esta publicação já não leva mais nada. Publica o que tens e junta o ficheiro a outra.",
    fileUnreadable: "Não foi possível ler esse ficheiro neste aparelho.",
    /**
     * O vídeo de uma publicação. Um por publicação, sem transcodificar: vai
     * como veio, até ao tecto do protocolo. Ver `lib/videos.ts`.
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
    /* Segue o círculo e ainda não lê nada. Fica o que fazer a seguir; saiu a
       explicação de porquê, que era o modelo a falar. */
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
     * O carrossel da publicação aberta: uma fotografia de cada vez.
     *
     * A posição diz-se por extenso e não só pelos pontos. Os pontos são uma
     * figura de três pixéis que quem ouve o ecrã não recebe e quem vê mal não
     * conta; a frase é a mesma informação dita a toda a gente.
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

    /** Gostos e não gostos. O voto é de quem o dá, e vê-se qual foi o teu. */
    like: "Gosto",
    likeUndo: "Retirar o gosto",
    dislike: "Não gosto",
    dislikeUndo: "Retirar o não gosto",
    /** Sem nenhum, é «Comentários» e não «Comentar»: o botão que envia já se
     * chama assim, e dois botões com o mesmo nome no mesmo cartão não se
     * distinguem — muito menos por quem os ouve em vez de os ver. */
    commentsToggle: (n: number): string =>
      n === 0 ? "Comentários" : n === 1 ? "1 comentário" : `${n} comentários`,
    commentsEmpty: "Ainda ninguém comentou. Escreve o primeiro aqui em baixo.",
    commentPlaceholder: "Escrever um comentário…",
    commentSend: "Comentar",
    voteFailed: "não foi possível registar o voto",
    commentFailed: "não foi possível comentar",
    /** Apagar um comentário nosso. Só aparece nos nossos: um botão que recusa
     * o clique ensina mal quem manda no quê. */
    commentDelete: "Apagar o comentário",
    commentDeleteTitle: "Apagar o comentário?",
    commentDeleteConfirm: "O comentário sai da publicação. Apagar não desfaz o que alguém já leu.",
    commentDeleted: "comentário apagado",
    commentDeleteFailed: "não foi possível apagar o comentário",

    /** Nomes para uma publicação que não tem palavras nenhumas. */
    untitled: "Publicação",
    untitledPhoto: "Fotografia",
    untitledLink: "Link",
  },

  people: {
    /* O nome do destino, dito uma terceira vez: é o `h1` da faixa. Ver `rail`.
       O ecrã por baixo dele já falava de amigos ("Ainda não tens amigos aqui"),
       e o título é que dizia outra coisa. */
    title: "Amigos",
    sealed: "só neste aparelho",
    sealedTitle:
      "Esta lista fica só nos teus aparelhos. O servidor não sabe quem são os teus amigos.",
    searchPlaceholder: "Procurar por nome, estado ou endereço…",
    noMatch: (query: string): string => `Nada para "${query}".`,
    /**
     * A resposta a uma procura, que não é o mesmo que um convite.
     *
     * Isto levava por baixo o `emptyBody` — o texto de quem ainda não conhece
     * ninguém, a explicar que não há pesquisa global. Dito a quem acabou de
     * escrever um nome na caixa, era uma lição em vez de uma resposta: a
     * pergunta foi "está cá o Manuel?" e a aplicação respondia com o modelo de
     * descoberta de contas.
     *
     * Uma procura sem resultados é um facto pequeno e fechado. Diz-se onde se
     * procurou, para o zero significar alguma coisa, e devolve-se a lista.
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
     * O vazio de quem conhece gente e não tem amigos.
     *
     * Deixou de ser um caso raro no dia em que passou a haver um canal onde
     * está toda a gente: o cofre enche-se de perfis à primeira ligação e nenhum
     * deles é amigo. Sem uma palavra, o ecrã ficava em branco por baixo do
     * título "Amigos", que é indistinguível de estar avariado.
     */
    noFriendsTitle: "Ainda não tens amigos aqui.",
    noFriendsBody: (n: number): string =>
      `Conheces ${n === 1 ? "uma pessoa" : `${n} pessoas`} dos teus canais. Para serem amigos, pede amizade. A outra pessoa tem de aceitar.`,
    copyAddress: "Copiar endereço",
    addressCopied: "endereço copiado",
    requestsTitle: "Pedidos",
    accept: "Aceitar",
    accepted: "aceite. Essa pessoa passa a ver o que publicas",
    // There was a family of strings here for membership diagnostics — "amizade
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
     * A amizade passou a ser mútua, e a copy tem de dizer isso.
     *
     * "Quer que o sigas" descrevia o que havia: uma permissão num sentido, e um
     * segundo acto do outro lado para o outro sentido. Agora um pedido aceite
     * faz as duas metades, e chamar-lhe seguir seria descrever mal o que o
     * botão faz — que é a única coisa que uma legenda destas tem de fazer bem.
     */
    wantsToBeFriends: (name: string): string => `${name} quer ser teu amigo`,
    /**
     * A linha de estado do cartão, quando quem pediu não escreveu nada.
     *
     * O cartão vive na conversa e fica de pé enquanto o pedido estiver aberto.
     * Um cartão mudo é indistinguível de uma avaria, e por isso há sempre uma
     * linha: ou a nota de quem pediu, ou esta.
     */
    requestWaits: "À espera da tua resposta.",
    /** O nosso próprio pedido, visto da conversa: sem botões, mas com sinal. */
    requestSent: (name: string): string => `Pediste amizade a ${name}`,
    requestSentWait: "À espera da resposta dessa pessoa.",
    /**
     * A barra de escrita trancada, e as três razões por que o está.
     *
     * A caixa de escrita não desaparece: fica no lugar dela, calada, a dizer o
     * que falta. Tirá-la do ecrã deixava um buraco onde a pessoa procurava a
     * caixa e não a encontrava, que se lê como avaria e não como regra. Ver
     * `escritaNaDirecta`.
     */
    escritaEspera: "Só podem trocar mensagens depois de o pedido ser aceite.",
    escritaAceitaPrimeiro: "Aceita o pedido de amizade para poderem trocar mensagens.",
    escritaSemAmizade: "As mensagens privadas são entre amigos. Pede amizade para poderem falar.",
    decline: "Recusar",
    declined: "pedido recusado",
    accepting: "a aceitar…",
    /** O que a aceitação faz, dito nos dois sentidos porque é nos dois que é. */
    acceptedMutual: (name: string): string => `${name} é teu amigo`,
    /**
     * O intervalo em que a amizade está feita de um lado só.
     *
     * Quem aceitou já deu o seu lugar; o lugar de volta depende do dispositivo
     * de quem pediu, e esse pode estar desligado. Dizê-lo é a alternativa
     * honesta a fingir que já está completo — e o que se pede a quem lê não é
     * que faça nada, é só que não estranhe.
     */
    acceptedPending: (name: string): string =>
      `${name} já vê o que publicas. Vais ver as publicações de ${name} quando estiver online.`,
    /* ------------------------------------------------- o destino "Amigos" */
    asideLabel: "Amigos e conversas",
    tabsLabel: "Separadores de Amigos",
    /** O título da faixa, com quantos amigos há. */
    titleCount: (n: number): string => `Amigos (${n})`,
    /*
      O separador da lista diz «Todos», e não «Amigos»: o título da faixa já
      diz «Amigos (n)», e o botão do carril também se chama «Amigos». Dois
      botões com o mesmo nome no mesmo ecrã confundem o leitor de ecrã.
    */
    tab: {
      amigos: "Todos",
      recebidos: "Recebidos",
      enviados: "Enviados",
      encontrar: "Encontrar",
    },
    /**
     * O contador de pedidos na faixa, dito por inteiro a quem ouve o ecrã.
     *
     * O número sozinho lê-se "dois" ao lado de "Pendentes", o que não é uma
     * frase. É este contador que sustenta os pedidos terem saído do corpo do
     * ecrã, portanto tem de se anunciar como aquilo que é.
     */
    pendingCount: (n: number): string => (n === 1 ? "1 pedido à espera de resposta" : `${n} pedidos à espera de resposta`),
    directsTitle: "Mensagens privadas",
    /**
     * O vazio da coluna, dito pelo que se faz a seguir e não pelo que falta.
     *
     * "Sem conversas" descrevia o estado e deixava a pessoa no mesmo sítio. O
     * que ela precisa de saber é por onde se começa uma — e começa-se na lista
     * ao lado, que está mesmo à frente dela.
     */
    directsEmpty: "Nenhuma aberta. Escolhe alguém da lista para começar a falar.",
    directMine: "Tu: ",
    /**
     * O que a linha mostra quando a última coisa da conversa foi um pedido de
     * amizade.
     *
     * Um pedido de amizade não tem corpo — não é uma frase escrita, é um acto.
     * Sem isto a conversa aparecia na lista com a pré-visualização vazia, e uma
     * linha em branco lê-se como avaria e não como "há aqui uma coisa à tua
     * espera".
     */
    directFriendRequest: "Pedido de amizade",
    directClose: "Fechar conversa",
    directUnread: (n: number): string => `${n} por ler`,
    /** Voltar à lista, só onde a coluna e a conversa não cabem lado a lado. */
    backToList: "Voltar às conversas",
    noPendingTitle: "Nada à espera.",
    noPendingBody: "Os pedidos de amizade que te fizerem aparecem aqui, e no sino.",

    unfriend: "Desfazer amizade",
    unfriendTitle: (name: string): string => `Desfazer a amizade com ${name}?`,
    unfriendConfirm:
      "Deixam de ver as publicações um do outro.",
    /*
      Fechar uma conversa directa não confirma: não apaga nada, e a conversa
      volta sozinha quando lá chegar mensagem. O brinde diz isso e traz o
      caminho de volta, para quem fechou a errada. Até à 0.9 havia também uma
      nota fixa no fim da lista a dizer o mesmo; o dono pediu a 27 de Outubro
      de 2026 que fosse só o aviso, no momento em que se fecha.
    */
    directClosed: "Conversa fechada. Nada foi apagado. Volta quando chegar mensagem.",
    directReopen: "Reabrir",
    unfriendDone: (name: string): string => `a amizade com ${name} está desfeita`,
    /** O «⋯» de uma linha de pessoa ou de conversa, dito com o nome. */
    rowMore: (name: string): string => `Mais acções para ${name}`,

    /* ------------------------------------------------- pedidos enviados */
    sentTitle: "Pedidos enviados",
    sentEmptyTitle: "Nenhum pedido à espera.",
    sentEmptyBody: "Os pedidos que fizeres ficam aqui até a pessoa responder.",
    sentAt: (quando: string): string => `Enviado ${quando}`,
    /** O verbo fixo para retirar o nosso pedido. */
    cancelRequest: "Cancelar pedido",
    cancelled: "pedido cancelado",

    /* ------------------------------------------------- encontrar */
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
    /** O link de amizade com que a página abriu não se deixa ler. */
    friendLinkInvalid: "Este link de amizade não se deixa ler. Pede um link novo a essa pessoa.",
    friendLinkOtherServer: "Esta conta é de outro servidor. Só podes adicionar amigos do teu servidor.",
    /** O leitor de QR de «Encontrar», enquanto a câmara procura. */
    scanning: "Aponta a câmara ao QR do link de amizade.",

    /* ------------------------------------------------- bloquear */
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
     * O tempo de ida e volta, ao passar o rato pelo ponto de estado.
     *
     * Duas frases e não uma, porque são duas distâncias diferentes e confundi-las
     * seria mentir com um número certo. Fora de uma chamada não há ligação a
     * pessoa nenhuma — os canais são grupos criptográficos, não ligações — e o
     * que se mede é a volta ao servidor. Dentro de uma chamada há mesmo alguém
     * do outro lado, e é essa a distância que interessa.
     *
     * Sem medida não há frase: o ponto continua a dizer só como apareces. Um
     * número inventado é pior do que não haver número nenhum.
     */
    latencyServer: (ms: number): string => `${ms} ms até ao servidor`,
    latencyPeer: (ms: number): string => `${ms} ms até quem está na chamada`,
    /*
      O fim da linha por baixo do nome, na faixa da conta («Ocupado · 42 ms»).
      A latência curta, sem dizer até onde: a frase longa vai no ponto. Um
      pedaço à parte, com o separador, porque é ele que sai quando a linha
      não cabe (a coluna tem 236 px) e o estado fica sozinho.
    */
    latencyTail: (ms: number): string => ` · ${ms} ms`,
    stateLine: (estado: string, aSeguir: string | null): string => (aSeguir ? `${estado} · ${aSeguir}` : estado),
  },

  /**
   * Os canais de onde esta conta foi tirada. Ser removido tira as chaves do
   * que vem a seguir; o que já se leu fica neste aparelho até se apagar.
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
   * A sincronia entre contas, como se diz à pessoa (S5, §2.5 do plano
   * `2026-10-20-sincronia-absoluta.md`). Não são erros e não têm código: são
   * limites e estados. Sem jargão: nada de «época», «MLS» nem «resumo».
   */
  sincronia: {
    /** O marcador na conversa, no sítio do lugar. Não aparece no mural. */
    lugar: "Entraste aqui. O que foi dito antes não chega a este aparelho.",
    lugarData: (data: string): string => `Entraste a ${data}.`,
    /** A barra fina enquanto o canal chega a quem entrou tarde. Some sozinha. */
    aReceber: "A receber o canal…",
    /**
     * A barra do histórico que vem de um aparelho irmão (1.0 «Arca»). Primeiro
     * as entradas (mensagens, publicações, tickets), depois os ficheiros, que
     * vêm no fim. Não tapa nada: a app continua a funcionar.
     */
    historico: (feitas: number, total: number): string => `A trazer o histórico: ${feitas} de ${total} mensagens.`,
    historicoMedia: (feitas: number, total: number): string => `A trazer os ficheiros: ${feitas} de ${total}.`,
    /** Uma parte da barra: quanto já chegou de um tipo. */
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
    /** O Diagnóstico: uma linha por canal. */
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
    /** Um anexo de que este aparelho só tem o nome. */
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
   * Avisos do núcleo que chegam ao ecrã, traduzidos pelo `code`. O `detail`
   * do núcleo é inglês de registo; isto é o que uma pessoa lê.
   */
  avisosDoNucleo: {
    channelRemoved: (canal: string): string => `Já não estás em ${canal}. Não recebes as mensagens dele.`,
    welcomeDead: "Este convite já não funciona. Pedimos outro.",
    channelDeleted: (canal: string): string =>
      `Um administrador eliminou ${canal}. A app de cada membro apaga as mensagens do canal.`,
  },

  notifCenter: {
    /* «Juntar contas» (fase 8.2): a frase diz quem assinou e pede o toque. */
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
    /* Os filtros da linha do tempo. Ver `filtroDaNotificacao`. */
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
    /* Uma conversa privada tocou e ninguém atendeu. Ver `lib/chamadasPerdidas.ts`. */
    chamadaPerdida: (nome: string): string => `Chamada perdida de ${nome}`,
    /*
      Três verdades onde havia duas.

      "Nada por aqui. Bom sinal." era o que aparecia também quando a LEITURA
      falhava: a lista vive no cofre, o cofre recusou-se a abri-la, e o painel
      dizia à pessoa que não tinha notificações nenhumas. Podia ter cinquenta.
      A aplicação sabia que tinha falhado — escrevia-o no registo, e não marca
      a lista como lida justamente para não gravar o vazio por cima do que lá
      está — e mesmo assim afirmava o contrário no ecrã.

      É a mesma regra que a lista de pessoas já cumpre: a carregar, falhou e
      vazio são três coisas diferentes, e a pior de todas é a segunda vestida
      de terceira.
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
    /** Nomeia a sala: uma menção sem sítio obriga a procurá-la à mão. */
    mention: (name: string, room: string): string => `${name} mencionou-te em #${room}`,
    /**
     * O que resta de um pedido depois de resolvido.
     *
     * A entrada fica — é o registo de uma coisa que aconteceu, e essas não se
     * apagam — mas os botões desaparecem, porque vêm do estado e não do
     * registo. É isto que faz "aceitar num sítio desaparece do outro" não
     * precisar de ser programado.
     */
    friendRequestClosed: (name: string): string => `Pedido de ${name}: respondido`,
  },

  userMenu: {
    /* A primeira do menu: é a menos destrutiva e a mais usada. */
    profile: "Ver perfil",
    dm: "Mensagem",
    /* Só a amigos: uma chamada é uma conversa privada. */
    call: "Chamada",
    inviteToRoom: "Convidar para um canal…",
    makeAdmin: "Tornar administrador",
    dropAdmin: "Deixar de ser administrador",
    /* O apelido neste canal (fase 3): o próprio, ou quem modera. */
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
     * A confirmação que pede o nome escrito, como a de apagar a conta.
     *
     * É o único gesto do menu da pessoa com efeito criptográfico: a epoch
     * avança, quem foi expulso deixa de decifrar o que vem a seguir, e não há
     * gesto nenhum que o traga de volta sem convite novo. Um diálogo onde se
     * carrega sem ler é barreira nenhuma para um hábito, e este é o acto em que
     * o engano custa mais.
     */
    expelTitle: (name: string): string => `Expulsar ${name} do canal`,
    expelBody:
      "A pessoa deixa de ler o canal. Para voltar, precisa de um convite novo.",
    expelConfirmLabel: (name: string): string => `Escreve "${name}" para confirmar`,
    expelConfirm: "Expulsar",
    expelDone: (name: string): string => `${name} foi expulso do canal`,
    adminChanged: "Cargos actualizados.",
    /**
     * O que aconteceu ao carregar em convidar, dito sem prometer a mais.
     *
     * "Convite enviado" e nada mais: a pessoa não entrou, e a lista de membros
     * não vai mudar até ela aceitar. Antes isto dizia o mesmo e assentava-a de
     * imediato, o que fazia a frase parecer modesta e o acto ser outro.
     */
    invited: (room: string): string => `convite enviado para #${room}`,
    noRooms: "Não tens canais. Cria um primeiro.",
    friend: "Pedir amizade",
    friendSent: "pedido enviado",
    /**
     * O botão único da amizade, na folha de perfil, e os seus estados.
     *
     * Um botão que muda de palavra conforme a relação, em vez de quatro botões
     * em quatro sítios. «Pedido enviado» não é botão: não há nada a fazer até
     * a outra pessoa responder.
     */
    acceptFriend: "Aceitar pedido",
    friendPending: "Pedido enviado",
    friendsNow: "Amigos",
    friendsMenu: (name: string): string => `Amigos: menu da amizade com ${name}`,
    noteLabel: "Nota para o pedido",
    notePlaceholder: "Opcional. Diz quem és, por exemplo.",
    /** O «⋯» da folha de perfil: o resto do menu da pessoa. */
    more: (name: string): string => `Mais acções para ${name}`,
  },

  /**
   * O convite para um canal, na conversa onde ele chega.
   *
   * Chega como mensagem privada e responde-se ali: é onde a pessoa está a ler,
   * e é onde ela vai procurar. As frases dizem o que acontece a seguir sem
   * fingir que é imediato — entre aceitar e entrar depende de quem convidou
   * estar ligado, e isso diz-se com as mesmas palavras que os Amigos já usam.
   */
  convite: {
    titulo: (sala: string): string => `Convite para ${sala}`,
    /**
     * O que entrar dá, e o que não dá — dito a quem vai carregar no botão.
     *
     * Escrito do lado de quem lê, e não do de quem convidou: a frase da caixa
     * de convidar fala DELE ("chega-lhe", "só entra se aceitar"), e usada aqui
     * lia-se como se o convite fosse para outra pessoa qualquer.
     */
    porResponder: "Vais ver as mensagens a partir de agora. As anteriores não.",
    aceitar: "Entrar",
    recusar: "Agora não",
    aResponder: "um momento…",
    /** Do lado de quem convidou, enquanto não há resposta. */
    aguarda: (nome: string): string => `À espera da resposta de ${nome}.`,
    /**
     * Aceitou, e ainda não entrou. O intervalo é real e diz-se.
     *
     * Ninguém entra sozinho num grupo cifrado: quem convidou é que tem de
     * admitir, e pode estar desligado. É a mesma verdade que `people.
     * acceptedPending` diz sobre as amizades, pelas mesmas razões.
     */
    aceiteFalta: (nome: string): string => `Aceitaste. Entras assim que ${nome} se ligar.`,
    aceiteDado: "Aceitaste. Já estás lá dentro.",
    /** Do lado de quem convidou, depois de a outra pessoa aceitar. */
    aceiteDeles: (nome: string): string => `${nome} aceitou.`,
    recusado: "Convite recusado.",
    recusadoDeles: (nome: string): string => `${nome} não vai entrar.`,
    /** Ver `INVITE_TTL_MS`: catorze dias, e depois volta-se a convidar. */
    caducado: "Este convite expirou. Pede outro a quem te convidou.",
    caducadoMeu: (nome: string): string => `O convite a ${nome} expirou. Podes convidar outra vez.`,
  },

  callDock: {
    /** O nome da região, para quem ouve o ecrã. Não é a linha que se lê. */
    ongoing: "Chamada a decorrer",
    back: "Voltar ao canal",
    /**
     * O que está a acontecer, na primeira linha da doca.
     *
     * Curto de propósito: a doca é vista de esguelha, e a frase que lá está tem
     * de se ler sem se parar para a ler.
     */
    emChamada: "Em chamada",
    /**
     * A linha que substitui "Em chamada" enquanto ESTA conta partilha o ecrã.
     *
     * Nasceu preparada e desligada, à espera da Fase 3. Está ligada desde 16 de
     * Agosto de 2026: o `screen` do motor de chamada chega ao `App`, que passa
     * `aPartilharEcra` à doca. A doca não precisou de ser reescrita, que era o
     * objectivo de a frase ter sido escrita antes de existir botão nenhum.
     *
     * Só a NOSSA partilha a acende. A de outra pessoa não muda esta linha: quem
     * lê a doca precisa de saber se o próprio ecrã está a ir para o ar, e isso é
     * um facto sobre este dispositivo.
     */
    aPartilharEcra: "A partilhar ecrã",
    /**
     * Onde a chamada decorre: o canal, e a sala lá dentro.
     *
     * A doca flutuava sem dizer de onde era. Com duas salas de voz abertas, ou
     * com a chamada a continuar enquanto se lê outro canal, "sair" era um
     * salto no escuro.
     *
     * Numa conversa directa não há sala nenhuma, e então diz-se só o canal: ver
     * `onde` na doca.
     */
    /**
     * «Canal · Sala», pela ordem de quem procura: primeiro onde, depois a
     * divisão. Era «canal / sala»; o dono pediu o ponto a 27 de Outubro de
     * 2026, e a mesma linha serve o cartão lateral, que a faz andar quando
     * não cabe (ver `Andante`).
     */
    ondeComSala: (canal: string, sala: string): string => `${canal} · ${sala}`,
    /** O ping, no lugar de «Ligado» no cartão lateral: diz que está ligado e quão bem. */
    ping: (ms: number): string => `${ms} ms`,
    /* O cartão da barra lateral, em ecrã largo: a linha de cima. A sala vai na
       linha de baixo, mais pequena, à frente do canal e da contagem. */
    ligado: "Ligado",
  },

  /**
   * A música na chamada, pedidos do dono de 27 de Outubro de 2026 (23h40 e
   * 23h50): o DJ escolhe o volume do que SAI, e quem ouve cala só a música de
   * uma pessoa sem calar a voz dela.
   */
  musicaNaChamada: {
    /** Na folha «Partilhar áudio», do lado do DJ. */
    volumeDaEmissao: "Volume da emissão",
    volumeDaEmissaoNota: "Muda o som que sai para a chamada. Não muda o que tu ouves.",
    /** No sinal «A tocar», quando a emissão não está no máximo. */
    emissaoA: (percentagem: number): string => `Emissão a ${percentagem} %`,
    /** Do lado de quem ouve, ao lado do volume da música da pessoa. */
    silenciar: "Silenciar a música",
    ouvir: "Ouvir a música",
    silenciarDe: (nome: string): string => `Silenciar a música de ${nome}`,
    ouvirDe: (nome: string): string => `Ouvir a música de ${nome}`,
    /** O estado no cartão, por baixo de «A tocar». */
    silenciada: "Música silenciada",
  },

  /**
   * O leitor da folha «Partilhar áudio», refeito à maneira do Winamp e do
   * Windows Media Player (dono, 27 de Outubro de 2026): o visor, o transporte,
   * a lista de reprodução e as outras fontes num rodapé.
   */
  leitorDeMusica: {
    visor: "Visor do leitor",
    /** Para o leitor de ecrã: o tempo dos dígitos grandes. */
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
    /** No título de cada linha: a lista ordena-se a arrastar. */
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
    /** A busca é feita por este dispositivo, uma vez, antes de publicar. */
    fetchPreview: "Buscar título e miniatura",
    fetching: "a buscar…",
    /* Fica o que diz o que fazer a seguir; saiu a explicação de quem fala com
       quem, que era o modelo e não o passo. */
    fetchFailed: "Este site não deixou o teu aparelho ler a página. Escreve o título e escolhe a miniatura.",
    fetchEmpty: "A página não diz título nem imagem. Escreve tu.",
    pickThumb: "Escolher miniatura",
    dropThumb: "Remover a miniatura",
    thumbTooBig: "Essa imagem não dá miniatura. Escolhe uma mais pequena.",
    /** A fachada de um vídeo, quando nem título tem para se anunciar. */
    openVideo: "Abrir o vídeo no YouTube, numa janela nova",
  },

  profile: {
    noName: "Sem nome",
    /** O `title` de um nome tirado do endereço (`NomeDePessoa`), para leitores de ecrã e para o rato. */
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
    /** Publicações cujos anexos não são imagens. Ver `postKindOf`. */
    kindFiles: "Ficheiros",
    kindText: "Texto",
    kindLinks: "Links",
    kindEmpty: "Nada deste tipo.",
    kindEmptyBody: "Muda de separador, ou publica algo deste tipo.",
    /** A lista de publicações, uma por linha. */
    postsListLabel: "As tuas publicações",
    openPost: "Abrir a publicação",
    /** O que a linha diz por baixo do nome, além da data. */
    rowPhotos: (n: number): string => (n === 1 ? "1 fotografia" : `${n} fotografias`),
    rowLink: "link",
    /** A secção do próprio perfil com os canais que esta conta fundou. */
    foundedTitle: "Canais que fundei",
    foundedEmpty: "Ainda não fundaste nenhum canal.",
    foundedOpen: (nome: string): string => `Abrir ${nome}`,
  },

  /*
    A folha de enquadrar uma imagem (fotografia de perfil, ícone do canal,
    capa de uma publicação). Pedido do dono e da comunidade, 2 de Novembro de
    2026. Frases em STE100: curtas, activas, uma instrução por frase.
  */
  enquadrar: {
    titulo: {
      circulo: "Enquadrar a fotografia",
      quadrado: "Enquadrar o ícone",
      capa: "Enquadrar a capa",
    },
    instrucoes: "Arrasta a imagem para a mover. Usa a roda do rato, dois dedos ou a barra para ampliar.",
    /* O que o leitor de ecrã lê ao chegar à moldura: os gestos de teclado. */
    teclado: "Usa as setas para mover a imagem. Usa mais e menos para ampliar.",
    moldura: "Imagem a enquadrar",
    ampliar: "Ampliar",
    /* Um GIF animado não se enquadra: ver `gifQueFicaAnimado` em `lib/enquadrar.ts`. */
    gifFixo: "Um GIF animado não pode mover nem ampliar. Fica ao centro, para continuar animado.",
    guardar: "Guardar",
    aGuardar: "A guardar…",
    /* O botão na miniatura da primeira imagem de uma publicação. */
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
      «Biografia» e não «Sobre ti» (pedido do dono a 27 de Outubro de 2026): o
      nome diz que é outra coisa que o estado, e a frase de ajuda diz a
      diferença.
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
    /** A lista de amigos no perfil: desligada por omissão, e escolhida por pessoa. */
    showFriends: "Mostrar a minha lista de amigos aos meus amigos",
    showFriendsNote: "Só os teus amigos vêem a lista. Escolhe quem aparece nela. Ninguém vê que amigos têm em comum.",
    showFriendsEmpty: "Ainda não tens amigos para mostrar.",
    showFriendsWho: "Quem aparece na lista",
  },

  settings: {
    media: "Microfone e câmara",
    /*
      Configurações › Voz: a cadeia de voz (ver `client-core/src/audio/README.md`).
      STE100: frases curtas, activas, um termo por coisa. «Redução de ruído» é o
      todo; «supressão» é a etapa do modelo.
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
    /* A sensibilidade do microfone, à Discord (dono, 2 de Novembro de 2026). */
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
      Atalhos de teclado dos comandos de voz, à escolha de cada pessoa (pedido
      do dono a 19 de Outubro de 2026). As predefinições são as do Discord
      que a mão já sabe; o «falar» não tem tecla até a pessoa lhe dar uma.
    */
    atalhos: "Atalhos de teclado",
    /*
      1.0.6 (pontos 5 e 8 de `docs/planos/depois-da-1-0.md`): qualquer tecla
      sozinha e os botões 4 e 5 do rato; na app de secretária, o microfone e o
      som são globais durante uma chamada. No browser, só com a página à frente.
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
      Os dois interruptores que já existiam no cartão da barra lateral, aqui
      também: é aqui que se vem procurar opções de microfone, e é aqui que elas
      faltavam. É o MESMO interruptor, não uma segunda cópia: ver as notas.
    */
    micMuted: "Silenciar o microfone",
    soundOff: "Desligar o som",
    echoCancellation: "Cancelar eco",
    /* Fica o eco, e só ele, dos pedidos ao browser: o perfil de redução de
       ruído faz o resto, e melhor. Cancelar o eco só o browser faz. */
    echoCancellationNota: "Para quem usa altifalantes.",
    inputDevice: "Microfone",
    inputGain: "Volume de entrada",
    outputVolume: "Volume de saída",
    /*
     * O teste do microfone, por palavras.
     *
     * As barras mostram o nível; estas frases dizem a CONCLUSÃO, que é a coisa
     * que uma barra não sabe dizer e que quem ouve o ecrã não tem por onde ver.
     * São cinco estados, e nenhum é decorativo:
     *
     * - parada: como se abre o microfone para o teste
     * - a escutar: o microfone está aberto, falta a pessoa falar
     * - apanha: confirmado, e diz que é ESTE o microfone que a chamada usa
     * - sem sinal: a razão de isto existir. Sem esta frase, a descoberta de que
     *   se escolheu o aparelho errado fazia-se numa chamada, com gente à espera.
     * - esgotado: a prévia fechou-se sozinha, e diz-se porquê
     *
     * "não é o que te ouve" e não "está mal escolhido": o microfone escolhido
     * pode estar perfeitamente bem e estar noutra divisão. A frase diz o facto
     * medido e deixa a conclusão a quem sabe onde está sentado.
     */
    /**
     * Com uma chamada viva, o teste usa a faixa que a chamada já tem e não abre
     * o microfone outra vez: uma segunda captura do mesmo aparelho pode parar
     * ou mudar a da chamada, e quem estava a ouvir deixava de ouvir.
     */
    testeNaChamada: "Estás numa chamada. O teste usa o mesmo microfone.",
    entradaParada: 'Liga "Ouvir-me" e fala. As barras mostram o som depois da redução de ruído.',
    entradaAEscutar: "A ouvir. Diz alguma coisa.",
    entradaApanha: "A apanhar. É este o microfone que a chamada vai usar.",
    entradaSemSinal: "Nada apanhado. Se estás a falar, o microfone escolhido não é o que te ouve.",
    /** Fecha-se sozinho, e diz que se fechou: a luz do microfone não fica acesa. */
    entradaEsgotado: "Parou ao fim de um minuto e fechou o microfone. Liga outra vez se precisares.",

    camara: "Câmara",
    videoQuality: "Qualidade de vídeo",
    videoAuto: "Automática",

    title: "Configurações",
    /*
      A língua da interface, e só da interface.

      "Automática" é uma escolha guardada e não a ausência de uma: sem ela, quem
      escolhesse português num sistema português ficava preso a português para
      sempre, e mudar a língua do sistema deixava de ter efeito nenhum sem
      ninguém perceber porquê.

      Os nomes das línguas ficam cada um na sua língua — "English" e não
      "Inglês" — porque quem abre a aplicação numa língua que não lê tem de
      conseguir encontrar a sua sem saber ler a que está no ecrã.
    */
    language: "Língua",
    languageAuto: "Automática",
    /**
     * O que esta opção NÃO faz, dito onde ela está.
     *
     * A pergunta seguinte de quem muda a língua da aplicação é se as mensagens
     * também mudam, e a resposta tem de estar aqui e não numa página de ajuda:
     * traduzir uma mensagem obriga a mandá-la a quem a traduza, e este produto
     * não manda o que se escreve para lado nenhum. É a mesma promessa que a
     * cifra faz, dita em texto.
     */
    languageNote:
      "Muda a língua da app. As mensagens não são traduzidas.",
    account: "Conta",
    /* A porta do editor do perfil a partir das Configurações: era só pelo
       cartão da conta, e quem vinha aqui procurar o nome não o encontrava. */
    editProfile: "Editar perfil",
    notifications: "Notificações",
    /* Um interruptor só, que pede a permissão do browser ao ligar. Eram dois
       botões, «Activar» e «Desactivar», e só um estava à vista de cada vez. */
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
    /* O fim da secção Aparelhos, com o gesto que ninguém desfaz. */
    zonaDePerigo: "Zona de perigo",
    exportAction: "Exportar conta",
    exportPassLabel: "Palavra-passe para o ficheiro",
    exported: "conta exportada. O ficheiro é a conta, guarda-o bem",
    /**
     * O que se diz em vez do botão a um aparelho emparelhado.
     *
     * O cofre dele não tem a chave privada de conta, e o ficheiro que saísse
     * daqui também não: quem o importasse ficava com uma cópia deste aparelho
     * e sem poder acrescentar, tirar nem recuperar nada. Um botão que promete
     * "o ficheiro é a conta" e entrega outra coisa é pior do que botão nenhum.
     */
    exportNeedsAccountKey: "Faz a cópia de segurança no aparelho principal da conta.",
    /**
     * O aviso da importação, que substituiu o de "um dispositivo de cada vez".
     *
     * Esse deixou de ser verdade no dia em que uma conta passou a ter até
     * quatro aparelhos. O que continua a ser verdade, e mais duro: importar o
     * cofre não acrescenta um aparelho, MUDA a conta de aparelho, porque o
     * cofre leva as chaves de grupo e dois cofres iguais em dois sítios partem
     * a cifra dos canais. O caminho para dois aparelhos é o outro.
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
    /* Revogar um aparelho (fase 5). A frase honesta é do plano: dizer o que se corta e o que não se corta. */
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
    /* A secção: o registo, a sincronização e a versão. */
    ajuda: "Ajuda e diagnóstico",
    diagnostics: "Registo de diagnóstico",
    diagnosticsNote:
      "Guarda os últimos 200 acontecimentos desta sessão, sem mensagens nem texto teu. Apaga-se quando fechas a app. Copia-o para relatar um erro.",
    diagnosticsCopy: "Copiar registo",
    /** Os bloqueados da conta (fase 5: viajam pelo canal da conta). */
    blocked: "Bloqueados",
    blockedNote: "A lista passa aos teus outros aparelhos. Um aparelho com uma versão antiga não a conhece.",
    blockedEmpty: "Não bloqueaste ninguém.",
    blockedSince: (data: string): string => `desde ${data}`,
    /* Privacidade: os bloqueados e o que a app guarda neste aparelho. */
    privacidade: "Privacidade",
    oQueGuarda: "O que a app guarda",
    oQueGuardaTexto:
      "As mensagens ficam cifradas no cofre deste aparelho. O servidor nunca as tem em claro. O registo de diagnóstico guarda 200 acontecimentos sem texto teu e apaga-se ao fechar.",
    /*
      «Sincronizar conta»: um botão para as duas reparações que eram dois
      (pedir de novo os convites dos canais que não abrem, e verificar as
      amizades). Uma frase de estado só: os canais primeiro, as amizades a
      seguir, na mesma linha.
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
    /* A versão e o código-fonte (AGPL-3.0, secção 13), no fim de "Ajuda e diagnóstico". */
    sobreVersao: (versao: string): string => `Orwell ${versao}`,
    codigoAberto: "O Orwell é código aberto, com a licença AGPL-3.0.",
    codigoFonte: "Código-fonte",
    /*
      «Terminar sessão» e não «Bloquear agora» (dono, 27 de Outubro de 2026):
      é o gesto que toda a gente conhece de outras apps. O que faz é fechar o
      cofre neste aparelho; a conta fica, e volta com a palavra-passe. A linha
      por baixo diz isso, porque «terminar sessão» noutras apps apaga mais.
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
     * O passo invisível, dito antes de acontecer.
     *
     * Apagar a conta começa por sair de todos os canais, porque só limpar o
     * cofre deixava a folha desta conta na árvore MLS de cada um. Sem esta
     * linha, a pessoa não tinha como adivinhar que apagar depende de haver
     * rede, nem porquê — e a recusa que pode vir a seguir aparecia do nada.
     */
    destroySteps: "Antes de apagar, a conta sai de todos os canais.",
    /*
      A mesma folha nas outras duas portas, e só esta frase muda.

      No portão («Perdeu a sua conta?») e no Setup com cofre existente, o cofre
      está fechado. Sem as chaves não há como pedir a saída dos canais, e a
      folha desta conta fica na árvore MLS de cada um. Quem apaga assim tem de
      o saber antes e não depois.
    */
    destroyStepsGate:
      "Com a conta trancada, não é possível sair dos canais. O teu nome pode ficar nas listas de membros.",
    destroyStepsImport:
      "Importar apaga a conta deste aparelho e põe a do ficheiro no lugar dela. Com o cofre fechado, a conta apagada não sai dos canais. O nome dela pode ficar visível lá.",
    /* A mesma frase, para o emparelhar do portão. O emparelhamento corre num
       cofre provisório e a conta de cá só se apaga quando a nova entrar
       (núcleo 1j): se falhar, nada se apagou. */
    /* «Juntar a outra conta» (fase 8.2): com o cofre aberto, a conta avisa e
       sai de tudo antes de se apagar. */
    destroyStepsJoin:
      "Juntar apaga esta conta deste aparelho. Antes, a conta avisa os contactos e os canais, desfaz as amizades e sai de todos os canais. Se o emparelhamento falhar, nada é apagado.",
    destroyStepsPair:
      "Emparelhar põe a outra conta no lugar desta. A app só apaga a conta deste aparelho quando a outra conta entrar. Se o emparelhamento falhar, esta conta fica. Com o cofre fechado, a conta apagada não sai dos canais. O nome dela pode ficar visível lá.",
    /**
     * O botão, depois de uma tentativa falhada.
     *
     * "Apagar para sempre" a seguir a uma falha prometia o que não tinha feito.
     * A resposta certa é voltar a carregar quando houver rede, e o botão passa
     * a dizer isso.
     */
    destroyRetry: "Tentar outra vez",
    /*
      A secção «Sons», em Notificações. Uma linha por acontecimento, com o
      nome que a pessoa reconhece. As escolhas ficam neste aparelho.
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
      // Fase 4: o único som que não vem de uma pessoa.
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
    /* Uma denúncia chegou a um canal que fundei. Sem nome, sem canal: diz só que há. */
    reportCopy: "Nova denúncia no canal",
    /* A decisão sobre uma denúncia que fiz (art. 16.º, n.º 5 do DSA), com as vias de reparação. Sem número e sem factos. */
    reportDecision: (decisao: "suspensa" | "sem-accao"): string =>
      decisao === "suspensa" ? "A tua denúncia foi analisada: conta suspensa." : "A tua denúncia foi analisada: sem acção.",
    reportDecisionVias: "Se discordas, escreve para orwell.eu@proton.me, podes recorrer aos tribunais, ou reclamar à ANACOM.",
    newMessage: (room: string): string => `Nova mensagem em ${room}`,
    // Com "Mostrar o conteúdo" desligado e sem uma conversa para nomear: um
    // pedido de amizade dito por extenso levaria o nome de quem o fez para fora
    // da aplicação, que é o que a preferência foi desligada para evitar.
    newNotice: "Tens uma notificação nova",
    /** Ponto 6: o aviso à MSN. Frase curta, como no sistema operativo. */
    amigoOnline: (nome: string): string => `${nome} está online`,
    // Com "Mostrar o conteúdo" desligado: sem nome nem cara fora da aplicação.
    amigoOnlineDiscreto: "Um amigo está online",
    abrirConversa: "Abrir conversa",
    /*
      Os outros avisos de amigos (pedido do dono, 3 de Novembro de 2026). O
      mesmo card do «está online», e a mesma regra: com «Mostrar o conteúdo»
      desligado, nem nome nem sítio.
    */
    amigoNaVoz: (nome: string, sala: string): string => `${nome} entrou na sala de voz ${sala}`,
    amigoNaVozDiscreto: "Um amigo entrou numa sala de voz",
    amigoNoEcra: (nome: string, sala: string): string => `${nome} começou a partilhar o ecrã em ${sala}`,
    amigoNoEcraDiscreto: "Um amigo começou a partilhar o ecrã",
    /* «Canal» e não «comunidade»: comunidade é só o nome do destino no carril
       (ver `terminologia.test.ts`). */
    amigoNaComunidade: (nome: string, canal: string): string => `${nome} entrou no canal ${canal}`,
    amigoNaComunidadeDiscreto: "Um amigo entrou num canal",
    juntarMe: "Juntar-me",
    ver: "Ver",
    abrir: "Abrir",
    agoraMesmo: "agora mesmo",
    /* O que fica de fora da pilha de 3. Uma linha, sem botão. */
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
      O link passou a ser um endereço que se clica, e isso alarga quem o pode
      usar: já não é preciso saber onde o colar. O conselho diz o que fazer com
      isso, e os valores por omissão da folha (1 dia, 1 pessoa) já o cumprem.
    */
    linkCare:
      "Usa um prazo curto e poucas utilizações.",
    /** Só na aplicação instalada: um https abre o browser, e não esta janela. */
    desktopNote:
      'Na app instalada, cola o link em "Entrar com um link".',
    waitingNote: "Alguém do canal tem de estar online para completar a entrada.",
    copyLink: "Copiar link",
    creating: "a criar…",
    createLink: "Criar link",
    linkCopied: "link copiado",
    activeTitle: "Convites activos",
    /*
      O vazio que tinha duas leituras e dizia uma.

      "Nenhum convite activo" tanto serve para quem nunca criou nenhum como
      para quem criou e viu o prazo acabar — e essa segunda pessoa fica a
      pensar que o convite se perdeu. O prazo é que o tira, e o servidor
      apaga-o mesmo (`Store.expireInvites`, varrido pela federação).

      O que se ESGOTA nos usos não é dito aqui de propósito: esse fica na
      lista, com o contador no máximo, e prometer que sai era falso.
    */
    activeEmpty: "Nenhum convite activo.",
    revoke: "Revogar",
    revoked: "Convite revogado.",
    neverExpires: "nunca expira",
    expiresAt: (when: string): string => `expira a ${when}`,
    usesOf: (uses: number, maxUses: number | null): string =>
      maxUses === null ? `${uses} utilizações · sem limite` : `${uses}/${maxUses} utilizações`,

    /*
      O convite com que a página foi aberta. Nunca entra sozinho: um clique num
      link não pode pôr a conta de alguém num canal, e mostrar o endereço dela a
      quem lá está, sem um sim.
    */
    gateWaiting: "Tens um convite à espera. Entra ou cria conta para o abrir.",
    gateInvalid: "O link de convite que abriste não é válido. Pede outro a quem to enviou.",
    arrivedTitle: "Convite para um canal",
    /*
      "O link diz", e não "foste convidado para": o nome do canal vem escrito no
      link por quem o enviou, e o pedido de entrada só leva a impressão digital
      do código. Quem tiver um convite verdadeiro para um canal pode escrever-lhe
      outro nome. A frase diz o que se sabe e de onde vem.
    */
    arrivedBody: (channel: string, server: string, quem?: string): string =>
      quem
        ? `Convite de ${quem} para "${channel}", em ${server}. Os nomes podem ser falsos. Só os confirmas depois de entrares. Queres pedir para entrar?`
        : `Convite para "${channel}", em ${server}. O nome pode ser falso. Só o confirmas depois de entrares. Queres pedir para entrar?`,
    /*
      Sem nome a mostrar (1.0 «Arca», fatia 5c): convite antigo sem selo, selo
      que não abre, ou servidor que não o guarda. A morada opaca não é um nome,
      e por isso não se mostra.
    */
    arrivedBodyUnnamed: (server: string): string =>
      `Convite para um canal, em ${server}. Só sabes o nome do canal depois de entrares. Queres pedir para entrar?`,
    /** Apareceu um canal que não é o que o link dizia. Ver `onChannels`, na `App`. */
    arrivedMismatch: (appeared: string, named: string): string =>
      `Apareceu-te o canal ${appeared} enquanto esperavas por ${named}. Se entraste pelo link, o nome que ele dizia não era o verdadeiro.`,
    arrivedNote: "Quem está no canal fica a ver o teu endereço. Alguém de lá tem de estar online para te deixar entrar.",
    arrivedAccept: "Entrar",
    arrivedDecline: "Agora não",
    otherServer: (theirs: string, mine: string): string =>
      `Este convite é do servidor ${theirs}. A tua conta é de ${mine}. Só podes usar convites do teu servidor.`,
    alreadyIn: (name: string): string => `Já estás em ${name}.`,
    /** Com moradas opacas (1.0) a morada não é um nome: diz-se «neste canal». */
    alreadyInOpaco: "Já estás neste canal.",
    /** Com moradas opacas o link não traz nome, por isso não há nome a comparar. */
    arrivedMismatchOpaco: "Apareceu-te outro canal enquanto esperavas pelo do convite. Confirma onde entraste.",
  },

  menu: {
    open: "Abrir",
    joinCall: "Entrar em chamada",
    joinVideo: "Entrar com vídeo",
    /* As reticências dizem que abre uma folha, e não que convida já. */
    invite: "Convidar…",
    leaveCall: "Sair da chamada",
    properties: "Propriedades",
    renameRoom: "Mudar o nome",
    renameRoomTitle: "Mudar o nome da sala",
    closeRoom: "Fechar sala",
    /* Sair e eliminar, encostadas uma à outra no fim do menu e a fazer coisas
       de tamanhos muito diferentes.

       Sair é sobre mim: largo o canal deste aparelho, com as salas todas lá
       dentro, e mais ninguém dá por isso. Eliminar é sobre o canal: acaba para
       toda a gente. Por isso só uma delas se pinta de vermelho, e por isso só
       uma delas depende de uma responsabilidade.

       "Sair" onde antes esteve "esquecer": esquecer descrevia o que o programa
       faz ao cofre, não o que a pessoa quer. */
    leave: "Sair do canal",
    remove: "Eliminar canal",
    /* Menus desenvolvidos: o que se faz a um canal, a uma sala e a quem está
       dentro de uma sala de voz. O que a pessoa não pode fazer não aparece
       cinzento: não aparece de todo. */
    joinRoom: "Entrar",
    newRoom: "Nova sala",
    newCategory: "Nova categoria",
    markRead: "Marcar como lido",
    /* Uma conversa é feminina: «lida». O canal fica «lido». */
    markReadDirect: "Marcar como lida",
    /* Uma categoria não é uma coisa: é o nome que as salas têm escrito no
       campo `category`. Por isso mudar-lhe o nome é reescrevê-lo em todas, e
       apagá-la é apagá-lo de todas: nunca é mexer nas salas em si. As
       palavras aqui e no aviso têm de dizer isso, senão "apagar" lê-se como
       "apagar o que está lá dentro". */
    renameCategory: "Mudar o nome da categoria",
    /* "Quem vê" e não "Permissões" nem "Privacidade": as duas prometiam uma
       protecção que isto não dá. A folha diz o resto: ver
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
    /* Dito onde se escolhe, porque é onde a escolha se faz mal. Uma sala de
       tickets é uma sala de texto por baixo: quem usar uma versão anterior
       vê-a como conversa, e não fica sem nada do que lá foi dito. */
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
   * A sala de tickets: o quadro, e o que cada estado quer dizer.
   *
   * Duas honestidades que o ecrã tem de dizer e não pode disfarçar. A primeira
   * é a de sempre nas salas: quem está no canal tem as chaves de todas, e um
   * ticket não é uma conversa privada com quem atende. A segunda é a do sigilo
   * persistente: o quadro é o que ESTE aparelho ouviu, e quem entrou depois de
   * um ticket ser aberto pode não o ter.
   *
   * Nenhuma das duas é uma avaria, e por isso nenhuma das duas se escreve como
   * aviso de erro. São o preço de não haver servidor a saber o que se passa, e
   * o sítio de as dizer é onde a pessoa está a olhar para a consequência.
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
    /* Os três estados, nas palavras em que se lêem. Os nomes que viajam no fio
       são outros e são em inglês, como todo o protocolo: aqui é o letreiro. */
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
    /* Eliminar um ticket fechado, com o poder `moderar` (fase 3). */
    delete: "Eliminar ticket",
    deleteTitle: (assunto: string): string => `Eliminar o ticket "${assunto}"?`,
    deleteConfirm: "O ticket sai do quadro de todos os membros. Não se pode reabrir. Quem já o leu, já o leu.",
    replyPlaceholder: "Responder neste ticket",
    send: "Responder",
    back: "Voltar ao quadro",
    count: (n: number): string => (n === 1 ? "1 mensagem" : `${n} mensagens`),
    noSubject: "Ticket sem assunto",
    /* O caso que o sigilo persistente cria, dito onde ele aparece. Sem esta
       frase, um ticket sem assunto lê-se como um defeito da aplicação. */
    noSubjectHint:
      "A primeira mensagem deste ticket é de antes de entrares no canal. Não a podes ver.",
    partial:
      "Os tickets abertos antes de entrares no canal podem não aparecer aqui.",
    /* A mesma ressalva que as salas já fazem, no sítio onde ela é nova: um
       ticket parece uma conversa reservada, e não é. */
    note: "Todos os membros do canal podem ler os tickets.",
  },

  /**
   * Criar uma categoria, que é outra coisa que criar uma sala.
   *
   * As duas abriam a mesma folha. A frase que aqui esteve dizia que "uma
   * categoria nasce com o primeiro canal que a usa" — o modelo de dados a
   * falar, num sítio onde quem lê só quer arrumar a lista.
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
   * Quem vê as salas de uma categoria — e o que isso NÃO é.
   *
   * A frase mais importante deste bloco é a `note`, e o que ela impede é uma
   * pessoa fechar uma categoria a um cargo e sair de lá a pensar que fechou uma
   * conversa. Não fechou: quem está no canal tem as chaves de todas as salas
   * públicas dele, porque a sala não é um grupo criptográfico — é uma etiqueta
   * dentro do grupo do canal. Esta folha ARRUMA a lista.
   *
   * É a mesma frontalidade de `newRoom.note`, que já dizia isto de outra maneira,
   * e de `roles.note`, que separa o que a cifra garante do que os clientes
   * combinam entre si. Nenhuma destas frases se abrevia: são a diferença entre um
   * produto honesto e um que vende protecção por arrumação.
   *
   * A `note` fica ACIMA das caixas, e não em letra pequena no fim. Um aviso que
   * se lê depois de decidir não é um aviso, é uma desculpa.
   */
  categoryProperties: {
    title: "Quem vê esta categoria",
    lead: "Escolhe quem vê as salas desta categoria.",
    note: "Esconder só arruma a lista. Todos os membros do canal podem ler estas salas. Para separar conversas, cria outro canal.",
    /* As três escolhas, e a legenda que as cobre.

       "Todos" é a primeira porque é o caso de quase todas as categorias, e
       passou a ser uma opção com nome em vez da ausência de escolha: caixas
       todas vazias liam-se como "ninguém", que é o contrário do que valem.

       "Só quem administra" é a restrição máxima que isto sabe exprimir: quem
       administra vê sempre: , e por isso não há uma quarta escolha mais
       apertada por baixo dela. */
    audienceLabel: "Quem vê",
    everyoneOption: "Todos",
    adminsOption: "Só quem administra",
    rolesOption: "Cargos específicos",
    rolesLabel: "Cargos",
    everyone: "Todos os membros do canal",
    /* O nome do cargo embutido não se declara e não aparece na lista de cargos
: dizer que ele vê sempre poupa a pergunta. */
    adminNote: "Os administradores vêem sempre todas as categorias.",
    defaultRoomNote: "A sala por omissão está sempre visível.",
    noRoles: "Este canal ainda não tem cargos. Cria um nas propriedades do canal.",
    /* A mesma constatação, para quem PODE criar o cargo aqui mesmo: sem o
       reencaminhamento, que deixaria de ser verdade com o formulário logo por
       baixo. Quem não pode gerir cargos continua a ler a frase de cima. */
    noRolesYet: "Este canal ainda não tem cargos.",
    creating: "A criar…",
    save: "Guardar",
    saving: "A guardar…",
    saved: (categoria: string): string => `Guardado quem vê ${categoria}.`,
    /* Quantas salas o gesto acabou de tirar da lista de alguém. Serve para a
       pessoa perceber que o efeito é sobre a LISTA e mais nada.

       O zero é o caso NORMAL e não uma esquisitice: uma categoria nasce vazia, e
       escolher quem a vê é dos primeiros gestos que se lhe faz. "0 salas saem da
       lista" lia-se como "isto não faz nada", que é falso: a restrição fica
       escrita e vale para as salas que lá forem parar. */
    hides: (salas: number): string =>
      salas === 0
        ? "Nenhuma sala sai já da lista: a restrição fica a valer para as salas que puseres nesta categoria."
        : salas === 1
          ? "1 sala sai da lista de quem não tiver estes cargos."
          : `${salas} salas saem da lista de quem não tiver estes cargos.`,
    /* A mesma contagem para "só quem administra", e a razão de ser uma frase à
       parte em vez de um parâmetro: com esta escolha não há cargos nenhuns
       marcados, e "quem não tiver estes cargos" apontava para uma lista vazia. */
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
    /* `idLabel` e `idNote` viviam aqui. O identificador deixou de aparecer no
       ecrã: ver o cabeçalho de `RoomProperties`. */
    pickIcon: "Escolher ícone",
    clearIcon: "Remover",
    /** A imagem é comprimida neste aparelho; isto é para quando nem assim dá. */
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
    /* As secções da folha (3/11/2026). Ver `seccoesDoCanal.ts`. */
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
    /* A linha de cada secção que ainda não tem conteúdo: diz o que lá vai haver. */
    salasNota: "Para criar uma sala, usa \"Nova sala\" no menu do canal. Para mudar o nome de uma sala ou para a fechar, abre o menu dessa sala.",
    membrosBreve: "Aqui vai aparecer a lista dos membros do canal, com os cargos de cada um. Para dar um cargo agora, abre o perfil da pessoa.",
    convitesBreve: "Aqui vai aparecer a lista dos convites do canal, com o prazo e os usos de cada um. Para convidar agora, usa \"Convidar\" no menu do canal.",
    moderacaoBreve: "Aqui vão aparecer as pessoas banidas e silenciadas, e as regras automáticas do canal.",
    eventosBreve: "Aqui vai aparecer a sala de eventos: a mensagem para quem entra e o aviso de quem sai.",
    /*
      A caixa de denúncias do fundador, na secção Moderação (Tarefa 6 das
      denúncias). Nada de quem denunciou: nem o nome, nem a hora, só o dia.
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
    /* O endereço abre a folha de perfil dessa pessoa, onde está o botão de
       pedir amizade e o campo da nota. Um caminho só para pedir. */
    friendHint: "Abre o perfil dessa pessoa. Lá pedes amizade, com uma nota se quiseres.",
    friendConfirm: "Ver perfil",
    seatDone: "Entrou. Está no canal a partir de agora.",
    seatAlready: "Esta pessoa já estava no canal.",
    cancel: "Cancelar",
    confirm: "Confirmar",
  },

  /**
   * O diálogo de confirmação da casa, que substituiu o `window.confirm`.
   *
   * O título e o verbo de cada pergunta vivem com o gesto que a faz. Aqui fica
   * só o que é igual em todas: o Cancelar, e a pergunta das folhas que editam.
   */
  confirmar: {
    cancelar: "Cancelar",
    descartarCorpo: "As tuas alterações perdem-se.",
    descartar: "Descartar",
  },

  /**
   * A folha única de convidar, com os seus três modos.
   *
   * Era um prompt de convite, um prompt de meter, uma folha de link e uma lista
   * de canais. As frases de cada um vieram para aqui.
   */
  convidar: {
    title: (canal: string): string => `Convidar para ${canal}`,
    modosLabel: "Como convidar",
    modoEndereco: "Por endereço",
    modoLink: "Por link",
    modoMeter: "Adicionar já",
    /**
     * O que convidar faz, dito por inteiro.
     *
     * Convidar não mete ninguém no canal: manda um convite, e a pessoa entra se
     * o aceitar. Dizê-lo aqui impede quem convida de ficar à espera que a
     * lista de membros mude sozinha.
     */
    enderecoHint:
      "A pessoa recebe o convite numa mensagem privada. Entra se aceitar. Vê as mensagens a partir daí.",
    enderecoAccao: "Enviar convite",
    /*
      Meter, que é o irmão sem licença do convidar. Existe para o caso que o
      convite não resolve: alguém que devia estar no canal e não está, e que
      ninguém sabe quando volta.
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
   * Mover alguém de uma sala de voz para outra.
   *
   * A palavra "pedido" está aqui de propósito, e em quase todas estas frases.
   * Mover é combinação entre clientes, como convidar e mudar o nome, e não tem
   * nada da força de expulsar: quem recebe o pedido cumpre-o porque o cliente
   * dele decidiu cumpri-lo, e um cliente alterado fica onde está. Chamar-lhe
   * ordem seria prometer protecção onde só há arrumação.
   */
  /**
   * Arrumar canais: a ordem, as categorias e os que foram fechados.
   *
   * "Fechado" e não "apagado", em todas estas frases e de propósito: fechar um
   * canal esconde-o da lista e mais nada. O que lá foi dito continua no cofre e
   * as mensagens que continuem a chegar continuam a ter sítio — é por isso que
   * há sempre por onde o trazer de volta, e é isso que estas palavras prometem.
   */
  rooms: {
    dropBefore: (nome: string): string => `Largar aqui para pôr antes de ${nome}`,
    dropInCategory: (nome: string): string => `Largar aqui para pôr no fim de ${nome}`,

    /*
      Arrastar a categoria inteira, que é o terceiro arrasto desta lista.

      As palavras dizem o que o gesto leva consigo: "com as salas dela": porque
      é a dúvida que ele levanta: quem arrasta um cabeçalho não sabe, antes de o
      largar, se está a mover a etiqueta ou o bloco. E dizem de que lado a
      categoria vai ficar, porque largar em cima de outra põe-na depois quando
      desce e antes quando sobe: sem isso, metade dos arrastos surpreendia.
    */
    dragCategory: (nome: string): string => `Arrastar ${nome}, com as salas dela`,
    dropCategoryBefore: (nome: string): string => `Largar aqui para pôr antes de ${nome}`,
    dropCategoryAfter: (nome: string): string => `Largar aqui para pôr depois de ${nome}`,
    /* Cada declaração é uma mensagem cifrada independente: falhando algumas, a
       lista fica meio arrumada. Nomeiam-se, porque é por essas que se repete o
       gesto: e repetir não estraga nada. */
    categoryOrderPartial: (nomes: string): string => `A ordem não mudou em ${nomes}. Arrasta outra vez.`,
    closedTitle: "Fechados",
    reopen: "reabrir",
    reopenTitle: (nome: string): string => `Mostrar ${nome} outra vez`,
    reopened: (nome: string): string => `${nome} está outra vez na lista.`,

    /*
      Eliminar, que é o passo a seguir a fechar e não uma alternativa a ele.

      Só se elimina o que já está fechado: fechar é reversível, eliminar não é,
      e obrigar a passar pelo primeiro é a melhor protecção que há contra o
      engano: ninguém elimina uma sala com um clique distraído numa lista que
      está à frente dos olhos.

      A frase de confirmação tem uma coisa que não pode faltar, e é a mesma
      exigência do aviso de apagar categoria: dizer o que NÃO acontece. Aqui o
      que não acontece é apagar mensagens: não por falta de vontade, mas
      porque não há por onde. Estão cifradas no cofre de cada pessoa, o
      servidor nunca as teve em claro, e quem elimina a sala não lhes chega.
      Qualquer palavra que sugira o contrário seria uma mentira sobre a única
      coisa que este produto promete.
    */
    remove: "eliminar",
    removeTitle: (nome: string): string => `Eliminar ${nome}`,
    removeRoomTitle: (nome: string): string => `Eliminar "${nome}"?`,
    removeConfirm:
      "A sala desaparece para todos. Não podes desfazer isto. As mensagens dela passam para a sala por omissão.",
    removeAction: "Eliminar sala",
    /* Junta-se à frase acima quando a sala é de voz. Deixar isto ao acaso era
       tirar o chão a quem está a falar, sem aviso nenhum. */
    removeVoiceNote: "Quem estiver na chamada dessa sala sai dela.",
    removed: (nome: string): string => `"${nome}" eliminada. O que lá foi dito lê-se na sala por omissão.`,
    /*
      Fechar não pergunta: é reversível, e confirmar o reversível ensina a
      carregar em «sim» sem ler. O brinde diz o que aconteceu e traz o caminho
      de volta. A sala por omissão tem frase sua, porque é onde caem as
      mensagens sem sala, e fechá-la não muda isso.
    */
    closed: (nome: string): string => `Fechaste "${nome}". Nada foi apagado.`,
    closedDefault:
      "Fechaste a sala por omissão. As mensagens sem sala continuam a ir para lá. Nada foi apagado.",
    showAgain: "Mostrar de novo",

    /*
      Categorias: etiquetas, e não caixas.

      A categoria é o nome escrito no campo `category` de cada sala: não há
      pasta nenhuma, e não há nada lá dentro. Apagá-la tira a etiqueta e as
      salas ficam soltas. Quem lê "apagar categoria" teme o contrário, e é
      exactamente no momento de confirmar que esse medo tem de ser desfeito:
      daí o aviso dizer, por números, quantas salas NÃO são apagadas.
    */
    /* Renomear para um nome que já existe junta as duas, porque duas etiquetas
       iguais são a mesma etiqueta. É o comportamento certo, e por isso não se
       recusa: diz-se antes de acontecer, para não ser surpresa. */
    mergeCategoryTitle: "Juntar as duas categorias?",
    mergeCategoryConfirm: (nome: string, quantos: number): string =>
      `Já existe uma categoria chamada "${nome}". ${quantos === 1 ? "A sala passa" : `As ${quantos} salas passam`} para lá, e as duas ficam uma só.`,
    mergeCategoryAction: "Juntar",
    categoryRenamed: (de: string, para: string): string => `"${de}" passou a chamar-se "${para}".`,
    /*
      Apagar uma categoria já não pergunta: tira uma etiqueta e não apaga sala
      nenhuma, e por isso desfaz-se. O brinde conta quantas salas NÃO foram
      apagadas, que era o trabalho do aviso antigo, e traz o «Desfazer».
    */
    categoryDeleted: (nome: string, quantos: number): string =>
      quantos === 0
        ? `Categoria "${nome}" apagada.`
        : `Categoria "${nome}" apagada. ${quantos === 1 ? "A sala continua na lista." : `As ${quantos} salas continuam na lista.`}`,
    categoryUndo: "Desfazer",
    categoryRestored: (nome: string): string => `A categoria "${nome}" voltou, com as salas dela.`,
    /** O mesmo, para uma categoria que não tinha salas. */
    categoryRestoredEmpty: (nome: string): string => `A categoria "${nome}" voltou.`,
    /*
      O meio do caminho, que é o que não pode acontecer em silêncio.

      Mudar uma categoria é uma publicação POR SALA. Falhando algumas, as
      salas ficam repartidas por dois nomes e a categoria parte-se em duas na
      lista: sem isto dito, ninguém sabia porquê. Nomeiam-se as que ficaram
      para trás porque é por elas que se repete o gesto: repetir é inofensivo,
      cada publicação diz apenas onde a sala está.
    */
    /* `nomes` já vem escrito e `quantos` à parte, como o resto deste ficheiro:
       são todos escalares a entrar. A contagem é precisa para a frase concordar
       e não se lê da lista, que aqui já é texto. */
    categoryPartial: (nomes: string, quantos: number): string =>
      `${nomes} não ${quantos === 1 ? "mudou" : "mudaram"} de categoria. Verifica a ligação e tenta outra vez.`,
  },

  voiceMove: {
    /**
     * O letreiro do bloco dos destinos, dentro do menu da pessoa.
     *
     * O menu é o da PESSOA — perfil, endereço, mensagem — e os destinos são um
     * acrescento. Vinham a seguir a um traço e mais nada, portanto com quatro
     * salas de voz o menu acabava em quatro linhas soltas por baixo de "Copiar
     * endereço", sem nada a dizer que aquilo era outra natureza de gesto.
     */
    group: "Mover para outra sala",
    /* A entrada única do menu da pessoa, que abre a escada das salas (2/11/2026). */
    menu: "Mover para",
    /* As salas sem categoria, no fim da escada. */
    noCategory: "Sem categoria",
    /* No telemóvel a escada abre como folha, e esta entrada volta ao menu. */
    back: "Voltar",
    disconnect: "Desligar da chamada",
    disconnected: (nome: string): string => `Desligaste ${nome} da chamada.`,
    disconnectedYou: (quem: string): string => `${quem} desligou-te da chamada.`,
    personTitle: (nome: string): string => `Arrastar ${nome} para outra sala de voz, ou clicar para escolher`,
    /* Para quem NÃO pode mover ninguém: o menu abre-se na mesma, com o perfil e
       o endereço lá dentro, mas prometer um arrasto que o núcleo recusa era
       mandar a pessoa tentar um gesto que não existe para ela. */
    personMenuTitle: (nome: string): string => `Opções de ${nome}`,
    dropTitle: (sala: string): string => `Largar aqui para mover para ${sala}`,
    to: (sala: string): string => `Mover para ${sala}`,
    /* Mover não é pedir (2/11/2026, «como no Discord»): a pessoa muda logo. */
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
    /** Os rótulos dos separadores de `components/emoji.ts`, pelo `id` de cada categoria. */
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
   * O perfil de outra pessoa.
   *
   * Tudo aqui é leitura. E as duas frases longas são o coração disto: quando
   * não chegou nada, o ecrã tem de dizer *que não chegou nada a este aparelho*
   * e porquê. Uma página vazia leria como "esta pessoa não tem nada", que é uma
   * mentira sobre outra pessoa; e a única forma de a desmentir seria perguntar
   * ao servidor quem está por trás de um endereço, que é a pergunta que esta
   * aplicação existe para ele não conseguir responder.
   */
  personProfile: {
    openHint: (name: string): string => `Ver o perfil de ${name}`,
    /** Só para leitores de ecrã: no ecrã, o nome está no corpo da folha. */
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
      O botão que pede as publicações outra vez.

      A dica diz as últimas 30 porque é isso que `republishPosts` publica, e
      prometer o histórico inteiro seria mentir: o resto foi cifrado para um
      lugar que já não existe. Diz também que não é instantâneo — o pedido
      chega ao aparelho dela, e é o aparelho dela que responde.
    */
    askPosts: "Pedir as publicações",
    askPostsHint: (name: string): string =>
      `Pede a ${name} as últimas 30 publicações. Só funciona com ${name} online. Pode demorar um minuto. As publicações mais antigas não voltam.`,
    askPostsSent: (name: string): string => `Pedido enviado a ${name}. As publicações aparecem quando chegarem.`,
    /** O separador da lista de amigos que a pessoa escolheu mostrar. */
    friendsTab: "Amigos",
    friendsListLabel: (name: string): string => `Amigos de ${name}`,
    /*
      A página da pessoa: a seta, os separadores e o que cada um diz quando não
      tem nada. Frases curtas e activas, um termo por coisa (STE100).
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
    As votações, na conversa e no mural.

    A frase que não pode faltar é a de que os votos são visíveis, e ela aparece
    duas vezes de propósito: a quem cria, antes de criar, e a quem lê, antes de
    votar. Quem vota não é quem escreveu a pergunta, e um aviso que só o autor
    visse era um aviso dado à pessoa errada.

    O que ela diz é a verdade da criptografia e não uma preferência do produto:
    num canal cifrado ponta a ponta, quem lá está decifra tudo o que o canal diz.
    Um voto "secreto" que viajasse pelo mesmo caminho seria secreto para o
    servidor e para mais ninguém. Prometê-lo era mentir.
  */
  votacao: {
    /** A entrada no menu do `+`, na conversa, e o botão do mural. */
    criar: "Criar votação",
    titulo: "Nova votação",
    perguntaLabel: "Pergunta",
    perguntaPlaceholder: "O que queres perguntar?",
    opcaoLabel: (numero: number): string => `Opção ${numero}`,
    opcaoPlaceholder: "Resposta",
    acrescentar: "Acrescentar opção",
    /* Retirar uma opção enquanto se escreve a votação. Nada a ver com retirar
       um voto: uma votação criada não se edita, e não há por onde. */
    retirarOpcao: (numero: number): string => `Retirar a opção ${numero}`,
    /* O tecto vem do protocolo, e a folha di-lo em vez de o botão desaparecer
       sem explicação. */
    opcoesCheias: (maximo: number): string => `Não cabem mais do que ${maximo} opções.`,
    /* "Criar" e não "Criar votação": dentro de uma folha que já se chama "Nova
       votação", repetir a palavra é ruído — e o botão do mural, esse sim, tem
       de dizer o que cria porque está ao lado de outros três. Ver `newRoom`. */
    confirmar: "Criar",
    /*
      As duas coisas que quem cria tem de saber ANTES de criar, e são as duas
      decisões deste desenho.

      Sem prazo porque não há relógio partilhado: cada aparelho tem o seu, e o
      carimbo de uma mensagem é a afirmação de quem a enviou. Um prazo fechava
      em instantes diferentes em cada ecrã, aceitando num aparelho o voto que
      outro recusava, e sem servidor não há quem desempate.
    */
    nota: "Todos vêem os votos. A votação fica aberta, sem prazo.",

    /* No cartão, a quem vai votar. Curta, porque está sempre no ecrã. */
    votosVisiveis: "os votos são visíveis",
    votosVisiveisAjuda:
      "Todos os membros do canal vêem o voto de cada pessoa.",
    total: (quantos: number): string => (quantos === 1 ? "1 voto" : `${quantos} votos`),
    semVotos: "Ainda ninguém votou.",
    votarEm: (opcao: string): string => `Votar em ${opcao}`,
    retirarVoto: (opcao: string): string => `Retirar o voto em ${opcao}`,
    /*
      Quem votou em cada opção, dito por nomes e não por um número: é isto que
      torna o aviso de cima verdadeiro em vez de teórico.

      `restantes` são os que não couberam na linha. Zero fecha a lista com "e",
      como se lê em voz alta; acima de zero fecha com "e mais N", que é o que
      diz que a lista foi cortada e não que acabou.

      Montada com um ciclo e sem `join`, como a `typing` acima é montada com
      índices: a fronteira de marca percorre TODAS as funções deste ficheiro e
      chama-as com uma cadeia de amostra. Uma que só saiba trabalhar sobre um
      array rebenta essa auditoria, e o que se perde não é este letreiro — é a
      verificação de que nenhum texto visível diz a palavra errada.
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
    /* A votação escrita por extenso, que é o que viaja no corpo da mensagem
       para um cliente que não a saiba desenhar a ler à mesma. */
    linhaDeOpcao: (numero: number, texto: string): string => `${numero}. ${texto}`,
  },
  /**
   * «Como funciona»: seis ideias, um cartão por ideia (fase 6, camada 2).
   *
   * A fonte é `docs/COMO-FUNCIONA-A-MIUDOS.html`, e o texto segue-a de perto.
   * Duas mudanças são de propósito: a interface não diz o nome de outra
   * empresa (o documento compara com o Discord; aqui diz-se «noutras apps de
   * conversa»), e cada cartão abre com duas frases, porque é o que se lê no
   * ecrã sem carregar em nada. O resto vai para «Ler mais».
   *
   * Os rótulos dos desenhos também vivem aqui: um SVG em português no ecrã
   * inglês é um desenho que não se lê.
   */
  comoFunciona: {
    /* «Como funciona o Orwell» (dono, 28 de Outubro de 2026); o link do registo continua «Como funciona». */
    titulo: "Como funciona o Orwell",
    /** O link no rodapé do portão. */
    link: "Como funciona",
    lead: "Seis ideias sobre o que acontece por dentro do Orwell. Cada uma tem um desenho.",
    /** O cartão em Ajuda e diagnóstico. */
    cartaoLead: "Seis ideias curtas, cada uma com um desenho. Mostram o que o servidor sabe de ti, o que fica só no teu aparelho, e porque é que o Orwell funciona assim.",
    ver: "Ver como funciona",
    lerMais: "Ler mais",
    lerMenos: "Ler menos",
    /** Fase 8.1: dita em Aparelhos e no cartão dos aparelhos. */
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
      /** Vem a seguir a `umaContaChega`: as duas frases do cartão. */
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
   * As frases no momento certo (fase 6, camada 1): uma vez cada, com um toque
   * para fechar. Quem já a fechou não a volta a ver neste aparelho
   * (`Prefs.frasesVistas`). Ver `FraseDoMomento`.
   */
  frasesDoMomento: {
    conta: "A tua conta é uma chave neste aparelho. Ninguém a pode repor. Guarda a palavra-passe.",
    canal: "Vês a conversa a partir de agora. O que foi dito antes fica com quem lá estava.",
    entendi: "Entendi",
  },
  /*
    «Partilhar áudio» na chamada (fase 9 de `docs/planos/definicoes-0-9.md`).

    O DJ fala e toca ao mesmo tempo: a música é uma segunda faixa, ao lado da
    voz. Nesta versão só a primeira fonte está ligada (ficheiros ou lista); as
    outras aparecem desligadas, com a frase do porquê para ESTE aparelho (ver
    `lib/fontesDeAudio.ts`). Frases curtas, voz activa, um termo por coisa.
  */
  musica: {
    partilharAudio: "Partilhar áudio",
    /** O botão da barra, com o estado à frente, como o `screenAria`. */
    partilharAudioAria: (aPartilhar: boolean): string =>
      aPartilhar ? "A partilhar áudio. Abrir a lista." : "Partilhar áudio.",
    fechar: "Fechar",
    fontes: "De onde vem o som",
    /** O nome de cada fonte no selector. */
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
    /** Porque é que uma fonte está desligada NESTE aparelho. Ver `fontesDeAudioDoAnfitriao`. */
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
    /** «Parar» tira a música da chamada. A lista fica. */
    parar: "Parar",
    pararAria: "Parar de partilhar áudio",
    tocarEsta: (nome: string): string => `Tocar ${nome}`,
    remover: (nome: string): string => `Tirar ${nome} da lista`,
    /** O sinal no painel e no cartão da pessoa. */
    aTocar: (nome: string): string => `A tocar: ${nome}`,
    emPausa: "Música em pausa",
    /** Quanto o DJ se ouve a si próprio. Não muda o que os outros ouvem. */
    volumeLocal: "Volume para ti",
    /** Do lado de quem ouve: separado do volume da voz da pessoa. */
    volumeDaMusica: (nome: string): string => `Volume da música de ${nome}`,
    /**
     * As fontes capturadas (separador, sistema, janela), 2/11/2026. O nome que
     * vai no anúncio quando não se sabe o do separador ou da janela: quem ouve
     * lê «A tocar: Som do sistema».
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
    /** O botão que abre o selector da fonte escolhida. */
    escolherFonte: "Escolher e partilhar",
    /** A fonte no ar. */
    aPartilharFonte: (origem: string): string => `A partilhar: ${origem}`,
    pararFonte: "Parar este som",
    /** O que acontece a seguir, por fonte e por anfitrião. Lido antes do clique. */
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
    /** Na app, o loopback leva o som da própria app. Não se prova que o Electron o tira. */
    ecoNaApp: "Na app, este som pode levar a voz da chamada. Os outros podem ouvir-se com atraso. Para o evitar, desliga o som da chamada.",
  },
  /**
   * As novidades das definições da 0.9 (fase 4, maqueta «Orwell Definições
   * 0.9», secção 3). Um bloco à parte, para não mexer nas chaves de
   * `settings` que outras mãos estão a mudar ao mesmo tempo.
   */
  definicoesNovas: {
    /** O cartão da Conta com «Terminar sessão» e «Bloquear sozinho». */
    sessao: "Sessão",
    /* «Expirar sessão», e não «Bloquear sozinho» (dono, 28 de Outubro de 2026). */
    bloquearSozinho: "Expirar sessão",
    bloquearSozinhoNota: "Se não usares o Orwell durante este tempo, a sessão termina neste aparelho. Para voltar, entras com a palavra-passe. Durante uma chamada, a sessão não termina.",
    /** As pastilhas de «Bloquear sozinho», pela ordem de `TEMPOS_DE_BLOQUEIO`. */
    tempoDeBloqueio: (minutos: number): string => (minutos === 0 ? "Nunca" : minutos < 60 ? `${minutos} min` : `${minutos / 60} h`),
    /** «Pausar» nas Notificações: cala tudo menos as chamadas, durante um tempo. */
    pausar: "Pausar",
    pausarNota: "Silencia tudo menos as chamadas, durante um tempo.",
    duracaoDaPausa: (duracao: "1h" | "8h" | "amanha"): string =>
      duracao === "1h" ? "1 h" : duracao === "8h" ? "8 h" : "Até amanhã",
    /** A hora já vem escrita (`14:30`). `amanha` diz se a pausa acaba noutro dia. */
    emPausaAte: (hora: string, amanha: boolean): string =>
      amanha ? `Em pausa até amanhã às ${hora}. Só as chamadas tocam.` : `Em pausa até às ${hora}. Só as chamadas tocam.`,
    retomar: "Retomar",
    /** Microfone e câmara: cada entrada numa chamada começa com o microfone calado. */
    entrarSilenciado: "Entrar nas chamadas com o microfone silenciado",
    /** O cartão Câmara: o aparelho, o espelho e a pré-visualização. */
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
    /** Privacidade: quem pode pedir amizade, e se a presença se mostra. Viajam com a conta. */
    quemMeEncontra: "Quem me pode encontrar",
    pedidosDeAmizade: "Quem me pode enviar pedidos de amizade",
    regraDosPedidos: (regra: "todos" | "amigos-de-amigos" | "ninguem"): string =>
      regra === "todos" ? "Toda a gente" : regra === "amigos-de-amigos" ? "Amigos de amigos" : "Ninguém",
    pedidosNota:
      "Um pedido de quem não cabe na regra não aparece e não toca. Amigos de amigos são quem partilha um canal ou um amigo contigo.",
    mostrarOnline: "Mostrar quando estou online",
    mostrarOnlineNota: 'Desligado, apareces sempre "Invisível" aos outros.',
    /** Ajuda: «Enviar registo», ao lado de «Copiar registo». */
    enviarRegisto: "Enviar registo",
    aEnviarRegisto: "A enviar…",
    registoEnviado: "registo enviado, obrigado",
    enviarRegistoNota: '"Enviar" manda o registo para o servidor, com o teu endereço e a versão. Sem mensagens. O servidor guarda-o 30 dias.',
  },
  /**
   * O anel de presença à volta das caras (pedido do dono, 27 de Outubro de
   * 2026). A cor diz o estado; estas palavras dizem-no a quem não vê a cor.
   */
  aneis: {
    /** O estado amarelo: ligado, mas sem actividade. */
    away: "ausente",
  },
  /**
   * O botão que copia o id de alguém, ao lado do nome (ordem do dono a 27 de
   * Outubro de 2026: «não quero os ids expostos»). Ver `BotaoCopiarId`.
   */
  /**
   * A overlay de jogo da app de secretária (pedido do dono a 2 de Novembro de
   * 2026): o cartão nas Definições › Voz, e as frases do aviso de quem entra e
   * sai. As frases do aviso viajam até à janela da overlay, que não carrega
   * este catálogo; o nome vai à frente, em destaque.
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
   * Silenciar uma sala, um canal ou uma conversa privada (pedido do dono de 27
   * de Outubro de 2026). Silenciado: sem som, sem aviso do sistema e sem
   * número. Uma menção continua a acender. Ver `lib/silenciados.ts`.
   */
  silencio: {
    silenciar: "Silenciar notificações",
    ativar: "Ativar notificações",
    /** O sino riscado ao lado do nome, dito a quem não o vê. */
    marca: "Notificações silenciadas",
  },
  /**
   * Responder a uma mensagem, como no Discord (4/11/2026). A barra por cima da
   * caixa de escrita, a linha de citação por cima da resposta, e os três
   * estados de um original que não se vê. Frases curtas, em STE100.
   */
  respostas: {
    responder: "Responder",
    /** Antes do nome, na barra por cima da caixa: "A responder a Bruno". */
    aResponderA: "A responder a",
    /** O interruptor da menção. Ligado, o autor do original recebe uma menção. */
    mencionar: "@ Mencionar",
    mencionarLigado: "O autor recebe uma menção. Toca para desligar.",
    mencionarDesligado: "O autor não recebe uma menção. Toca para ligar.",
    cancelar: "Cancelar a resposta",
    /** Dito pelo leitor de ecrã quando a barra aparece. */
    anuncio: (nome: string) => `A responder a ${nome}. Esc cancela.`,
    irPara: (nome: string) => `Ir para a mensagem de ${nome}`,
    imagem: "Imagem",
    vazia: "Mensagem sem texto",
    apagada: "A mensagem original foi apagada.",
    ausente: "A mensagem original não está neste aparelho.",
    porCarregar: "Carregar a mensagem original",
  },
  /**
   * O sinal de transmissão ao lado da cara de quem, numa sala de voz, partilha
   * o ecrã ou toca música (pedido do dono de 27 de Outubro de 2026, 23h55).
   * Ver `MarcaDeTransmissao`.
   */
  transmissao: {
    ecra: "A partilhar o ecrã",
    musica: "A tocar música",
    ambos: "A partilhar ecrã e música",
    /** O rótulo da marca `musica` de `MarcaDeChamada`, que diz de quem se fala. */
    musicaDe: (nome: string): string => `${nome} está a tocar música`,
  },
  /**
   * «Entrar com outra conta», na ordem segura: escolher primeiro, apagar no
   * fim. Ver `EntrarComOutraConta`. Chaves novas, e não as de `gate`, porque a
   * frase de antes («os dois caminhos apagam primeiro») deixou de ser verdade.
   */
  outraConta: {
    lead: "Importar ou emparelhar põe a outra conta no lugar desta. Primeiro escolhes a outra conta. A app só apaga a conta deste aparelho depois de confirmares.",
    /** Na página da chave do `Emparelhar`, quando há uma conta a substituir. */
    pairKeyNote:
      "Quando carregares em Continuar, a app pede para confirmares que apaga a conta deste aparelho. A app só a apaga quando a outra conta entrar.",
  },
  /** «Mudar de conta»: várias contas no mesmo aparelho, cada uma com o seu cofre. */
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
   * «Juntar a outra conta» (fase 8.2), em Aparelhos. A ordem do dono: funde
   * amigos e canais, e não funde mais nada; a conta a mais é apagada.
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
   * Os comandos com barra da caixa de escrita, à IRC (pedido do dono de 28 de
   * Outubro de 2026). Ver `lib/comandosDaBarra.ts`. A descrição de cada um é a
   * linha que aparece na lista, ao escrever `/`.
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
   * O ecrã do corte da 1.0 «Arca» (`screens/gate/SaiuDeBeta.tsx`). O texto é o
   * D3 aprovado pelo dono a 27 de Outubro de 2026
   * (`docs/planos/moradas-opacas-e-corte.md`, secção 2): não se muda uma
   * palavra sem nova decisão. Há um teste que o fixa.
   */
  saiuDeBeta: {
    titulo: "O Orwell saiu de beta.",
    texto:
      "Obrigado por testares o Orwell. Mudámos a forma como as conversas são guardadas, para o servidor saber ainda menos. As contas do beta não passam para a versão nova. Lamentamos: tens de criar uma conta nova.",
    criarContaNova: "Criar conta nova",
  },

  /** A sala AFK (2/11/2026). Ver `lib/relogioAfk.ts`. */
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
    A folha de denunciar (Tarefa 7 das denúncias): "Denunciar…" no menu da
    mensagem e no da pessoa. Ver `DenunciarSheet` e `denunciar.ts`.
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
    // O resumo da pré-visualização: rótulo e valor, "Motivo: Assédio ou perseguição".
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
    // O indicador de passos (desenho escolhido pelo dono, 4/11/2026).
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
    O aviso de suspensão (Tarefa 8 das denúncias; art. 17.º, n.º 3 do DSA): a
    medida, a duração, o âmbito, os factos, a origem, a norma e as vias de
    reparação. Ver `ContaSuspensa`.
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
 * O inglês em cru que escapa do client-core, dito na voz da aplicação.
 *
 * Mensagens desconhecidas passam sem ser tocadas: uma tradução errada é pior do
 * que uma por traduzir, porque esconde o que aconteceu mesmo. Quem escolhe o
 * mapa da língua activa é o `translateError` de `strings.ts`.
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
  // «Enviar registo» (fase 4): a recusa e o tecto da rota `/_enclave/relato`.
  "the server did not take the log": "O servidor não aceitou o registo. Copia-o e cola-o no relato.",
  "too many logs sent": "Já enviaste 10 registos nesta hora. Tenta outra vez mais tarde, ou copia o registo.",
  // Denúncias: a recusa, o tecto e o relógio do pedido assinado.
  "the server did not take the report": "O servidor não aceitou a denúncia. Tenta outra vez mais tarde.",
  "too many reports sent": "Enviaste demasiadas denúncias. Tenta outra vez mais tarde.",
  "the device clock is off": "O relógio deste aparelho está errado. Acerta a hora e tenta outra vez.",
  "could not read the report inbox": "O servidor mandou uma resposta que não conseguimos ler. Tenta outra vez mais tarde.",
  // A suspensão da conta (denúncias, §8): o aviso e o pedido de revisão.
  "account-suspended": "A tua conta está suspensa neste servidor. Lê o motivo e pede revisão.",
  "the server did not take the review request": "O servidor não aceitou o pedido de revisão. Tenta outra vez mais tarde.",
  // A folha de denunciar: as duas validações e a cópia ao fundador.
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

  /* Cofre e conta. */
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

  /* Servidor e ligação. */
  "no connection to the server": "Sem ligação ao servidor. A app tenta ligar de novo.",
  "the server refused the login": "O servidor não aceitou o início de sessão. Tenta outra vez.",
  "the server did not answer in time": "O servidor não respondeu a tempo. Tenta outra vez.",
  "the server did not confirm the send": "O servidor não confirmou o envio. Verifica a ligação e tenta outra vez.",
  "the connection dropped": "A ligação caiu a meio.",
  "the session ended": "A sessão terminou. Abre a app outra vez.",
  "unexpected answer from the server": "O servidor deu uma resposta inesperada. Tenta outra vez.",

  /* Canais, convites e membros. */
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

  /* Chamadas e media. */
  "the call could not be set up on this server":
    "A chamada não se montou neste servidor. Tenta outra vez. Se repetir, copia o diagnóstico nas Configurações.",
  "the call has no send path": "A chamada não tem caminho de envio. Entra de novo na chamada.",
  "the call dropped and did not come back": "A chamada caiu e não voltou. Entra outra vez.",

  /* Avisos do núcleo que não são erros, ditos pela mesma tabela (I9). */
  "you are no longer a member of this channel": "Já não és membro deste canal.",
  "an invitation to this channel can no longer be opened, a new seat was requested":
    "Este convite já não abre. Pedimos um lugar novo.",

  /* Ficheiros e imagens. */
  "too large to send": "Isto é demasiado grande para enviar. Usa uma imagem mais pequena.",
  "unreadable image": "Não foi possível ler essa imagem. Escolhe outra.",

  /* Amizades, feed e perfil. */
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

  /* Aparelhos e emparelhamento. */
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
    Fase 5 (20/10/2026): o fim do «Erro 900». Cada chave que pode chegar ao
    ecrã ganhou código e frase. Ver `codigosDeErro.cobertura.test.ts`.
  */

  /* Cofre e conta. */
  "this vault needs a passphrase": "Este cofre precisa da palavra-passe. Escreve-a para abrir o cofre.",
  "no identity loaded": "A conta ainda não está aberta. Espera um momento e tenta outra vez.",
  /* Juntar contas (fase 8.2). */
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

  /* Servidor e ligação. */
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

  /* Canais. */
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

  /* Erros do browser. */
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

  /* Chamadas. */
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

  /* Ficheiros e páginas. */
  "could not read the page": "Não foi possível ler a página.",

  /* O vídeo das publicações (508 a 514). */
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

  /* Amizades e feed. */
  "too many friend lists in a row":
    "A lista de amigos mostrada mudou 3 vezes seguidas. A lista nova sai com a próxima publicação.",

  /* Aparelhos. */
  "this device is not on the account's list":
    "O servidor não reconhece este aparelho como aparelho da conta. Este aparelho não pode entrar.",
  /* Estado da conta entre aparelhos. São erros de programação da interface, mas chegam ao ecrã se acontecerem. */
  "read mark channel is invalid": "A marca de lido não tem um canal válido. A marca não foi guardada.",
  "read mark time is invalid": "A marca de lido não tem uma hora válida. A marca não foi guardada.",
  "preference key is invalid": "O nome desta preferência não é válido. A preferência não foi guardada.",
  "preference value is too long": "Esta preferência é longa demais. A preferência não foi guardada.",
  "too many preferences": (detalhe) =>
    typeof detalhe["tecto"] === "number"
      ? `Esta conta já tem ${detalhe["tecto"]} preferências. A preferência nova não foi guardada.`
      : "Esta conta já tem o máximo de preferências. A preferência nova não foi guardada.",
  "archive channel is invalid": "Esta conversa não tem um canal válido. A conversa não foi arquivada.",

  /* Revogação de aparelhos. */
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
  // A música na chamada (fase 9): a chamada continua; a pessoa sabe o que falhou.
  "this call server does not carry music": "Este servidor de chamadas ainda não leva música. A chamada continua sem ela.",
  "could not read this audio file": (detalhe) =>
    typeof detalhe["nome"] === "string" && detalhe["nome"] !== ""
      ? `Não foi possível ler "${detalhe["nome"]}". A lista passa ao ficheiro seguinte.`
      : "Não foi possível ler este ficheiro. A lista passa ao ficheiro seguinte.",
  "could not play this audio file": "O browser não deixou tocar o ficheiro. Carrega em Tocar outra vez.",
  // As fontes capturadas do DJ (2/11/2026). Ver `somDoDj.ts` no núcleo.
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
 * Porque é que o microfone ou a câmara não abriram, pelo nome do erro do browser.
 *
 * O nome vem no `cause` (ver `call.ts`). Uma permissão recusada e um microfone
 * ocupado por outra aplicação são duas avarias com remédios opostos, e a mesma
 * frase para as duas mandava a pessoa ao sítio errado.
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
