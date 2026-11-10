/**
 * The emoji catalog, hand-written and built into the package.
 *
 * There is no network request here, no search, no sprite sheet, no CDN. An
 * emoji is a Unicode glyph that already lives on the writer's machine; what
 * is missing is the Portuguese name to get it there. That name is what this
 * file brings, and that's all that needs to travel with the app.
 *
 * **Why a curated list and not the full Unicode table.** The official table
 * has nearly 1900 emojis; with Portuguese name and synonyms it would be over
 * 60 KB of data, which nobody writes by hand without mistakes and which would
 * justify on-demand loading, async state, loading screen, and a new failure
 * mode. The 831 here take up 22 KB of data, about 10 KB after compression: less
 * than a single GIF, which is what this replaced. The savings from on-demand
 * loading would be less than the complexity it cost, so the list goes static
 * and the code has no branches.
 *
 * To add an emoji, just one line in the right category block:
 *
 *     <glyph> <name> | <synonyms separated by spaces>
 *
 * Synonyms are optional and exist only for search; they never appear on screen.
 * The name is what the screen reader announces, so it reads as a description
 * not a technical label.
 */

export interface Emoji {
  /** The glyph. Never normalized: normalizing would break ZWJ sequences. */
  char: string
  /** Portuguese name, what shows and what the screen reader announces. */
  name: string
  /**
   * Name and synonyms, lowercase and without accents, ready to compare.
   * Pre-calculated at startup because search runs on every keystroke.
   */
  haystack: string
}

export interface EmojiCategory {
  /** Also the key for the category separator label in `strings.emoji.categorias`:
   * the label is visible text and lives in the catalog, in both languages. */
  id: "rostos" | "gestos" | "natureza" | "comida" | "actividades" | "viagens" | "objectos" | "simbolos" | "bandeiras"
  /** Separator glyph: an emoji from the category itself, which explains itself
   * and does not need nine new icons drawn. */
  symbol: string
  emojis: Emoji[]
}

/**
 * Strip accents and capitals for comparison.
 *
 * Without this, "cafe" would not find "café" and "girassol" would not find
 * "Girassol", in Portuguese accents are the rule, not the exception, and
 * nobody types accents in a search box.
 */
export function fold(text: string): string {
  return (
    text
      .normalize("NFD")
      // \p{M} not a hand-written range: raw combining marks would be invisible to
      // someone reading the file and would not survive a careless copy-paste.
      .replace(/\p{M}/gu, "")
      .toLowerCase()
  )
}

/** One line per emoji. Empty lines and lines without a name are ignored. */
function parse(block: string): Emoji[] {
  const out: Emoji[] = []
  for (const line of block.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // The glyph runs to the first space. No emoji sequence contains a space, not
    // even those made with ZWJ, so the split is safe.
    const space = trimmed.indexOf(" ")
    if (space === -1) continue
    const char = trimmed.slice(0, space)
    const rest = trimmed.slice(space + 1)
    const bar = rest.indexOf("|")
    const name = (bar === -1 ? rest : rest.slice(0, bar)).trim()
    const terms = bar === -1 ? "" : rest.slice(bar + 1).trim()
    if (!char || !name) continue
    out.push({ char, name, haystack: fold(terms ? `${name} ${terms}` : name) })
  }
  return out
}

const ROSTOS = `
😀 cara a sorrir | sorriso alegre feliz
😃 cara alegre | sorriso feliz
😄 cara radiante | sorriso feliz alegre
😁 cara com sorriso aberto | dentes feliz
😆 cara a rir | riso gargalhada
😅 riso nervoso | suor alivio
🤣 a rolar de riso | gargalhada chorar
😂 lágrimas de riso | chorar gargalhada
🙂 sorriso leve | contente
🙃 cara ao contrário | ironia sarcasmo
😉 piscar o olho | cumplicidade
😊 cara acanhada | sorriso tímido feliz
😇 cara com auréola | anjo inocente
🥰 cara apaixonada | corações amor
😍 olhos de coração | amor paixão
🤩 olhos de estrela | deslumbrado
😘 beijo | amor
😗 a mandar um beijo | beijo
😚 beijo de olhos fechados | carinho
😙 beijo a sorrir | carinho
🥲 sorriso com lágrima | comovido
😋 a lamber os lábios | delicioso guloso
😛 língua de fora | brincalhão
😜 língua e piscadela | brincalhão
🤪 cara maluca | doido
😝 língua e olhos fechados | brincadeira
🤑 cara com dinheiro | ganância euros
🤗 abraço | acolher
🤭 mão na boca | riso discreto
🤫 pedido de silêncio | calar segredo
🤔 cara pensativa | dúvida pensar
🫡 continência | saudação respeito
🤐 boca fechada | segredo calado
🤨 sobrancelha levantada | desconfiança
😐 cara neutra | indiferente
😑 cara sem expressão | impaciente
😶 cara sem boca | sem palavras
😏 sorriso malandro | ironia
😒 cara desagradada | contrariado
🙄 revirar os olhos | impaciência
😬 careta | embaraço nervoso
🤥 cara mentirosa | mentira nariz
😌 cara aliviada | calma paz
😔 cara desanimada | tristeza
😪 sono | cansaço
🤤 baba | desejo comida
😴 a dormir | sono ressonar
😷 máscara | doença gripe
🤒 febre | termómetro doente
🤕 ferido | ligadura acidente
🤢 náusea | enjoo vomitar
🤮 a vomitar | enjoo
🤧 espirro | constipação
🥵 calor | suor abafado
🥶 frio | gelo congelado
🥴 tonto | bêbado zonzo
😵 cara atordoada | tonto
🤯 cabeça a explodir | espanto choque
🤠 chapéu de cowboy | oeste
🥳 festa | aniversário celebração
🥸 disfarce | bigode óculos
😎 óculos escuros | fixe
🤓 cara de marrão | estudioso óculos nerd
🧐 monóculo | curioso inspecção
😕 cara confusa | dúvida
😟 cara preocupada | inquieto
🙁 cara triste | desagrado
😮 boca aberta | surpresa
😯 espanto | surpresa
😲 pasmado | choque
😳 cara corada | vergonha embaraço
🥺 olhos suplicantes | pedido piedade
🥹 a segurar as lágrimas | comovido
😦 cara de espanto | boca aberta
😧 angústia | aflição
😨 medo | susto
😰 ansiedade | suor medo
😥 desilusão aliviada | tristeza
😢 a chorar | lágrima triste
😭 choro alto | desespero
😱 grito de medo | pânico
😖 cara aflita | confusão
😣 perseverança | esforço
😞 desilusão | tristeza
😓 suor frio | derrota
😩 cansaço | exaustão
😫 fartura | esgotado
🥱 bocejo | sono aborrecido
😤 a bufar | frustração raiva
😡 cara zangada | fúria raiva
😠 zangado | irritado
🤬 palavrões | fúria censura
😈 diabinho a sorrir | travessura
👿 diabo zangado | maldade
💀 caveira | morte
☠️ caveira e ossos | perigo veneno
💩 cocó | porcaria
🤡 palhaço | circo
👹 ogre | monstro
👺 duende | máscara
👻 fantasma | assombração
👽 extraterrestre | alienígena
🤖 robô | máquina
😺 gato a sorrir | felino
😹 gato a chorar de riso | felino
😻 gato apaixonado | felino
😼 gato malandro | felino
🙀 gato assustado | felino
😿 gato a chorar | felino
😾 gato zangado | felino
🙈 macaco a tapar os olhos | não vi
🙉 macaco a tapar os ouvidos | não ouvi
🙊 macaco a tapar a boca | segredo calar
`

const GESTOS = `
👋 acenar | olá adeus mão
🤚 mão levantada | parar
✋ mão aberta | parar cinco
🖐️ mão com dedos abertos | parar
🖖 saudação vulcana | trekkie
🫱 mão para a direita | aperto
🫲 mão para a esquerda | aperto
🫳 palma para baixo | mão
🫴 palma para cima | oferecer mão
👌 sinal de perfeito | ok certo
🤌 dedos juntos | itália gesto
🤏 pouco | pequeno pitada
✌️ vitória | paz dois
🤞 dedos cruzados | sorte
🫰 dedos cruzados em coração | amor dinheiro
🤟 gesto de amor | rock
🤘 gesto de rock | metal
🤙 telefona-me | shaka
👈 dedo para a esquerda | apontar
👉 dedo para a direita | apontar
👆 dedo para cima | apontar
👇 dedo para baixo | apontar
☝️ dedo indicador | atenção um
👍 polegar para cima | gosto sim aprovado boa
👎 polegar para baixo | não gosto reprovado
✊ punho fechado | força luta
👊 murro | soco cumprimento
🤛 punho para a esquerda | cumprimento
🤜 punho para a direita | cumprimento
👏 palmas | aplauso parabéns
🙌 mãos ao alto | celebração aleluia
🫶 coração com as mãos | amor
👐 mãos abertas | abraço
🤲 mãos em concha | pedido oração
🤝 aperto de mão | acordo negócio
🙏 mãos juntas | obrigado oração por favor
✍️ a escrever | caneta assinatura
💅 verniz | unhas
🤳 selfie | telemóvel foto
💪 braço com músculo | força ginásio
🦾 braço mecânico | prótese força
🦿 perna mecânica | prótese
🦵 perna | corpo
🦶 pé | corpo
👂 orelha | ouvir
🦻 orelha com aparelho | audição
👃 nariz | cheirar
🧠 cérebro | pensar inteligência
🫀 coração anatómico | órgão
🫁 pulmões | respirar
🦷 dente | dentista
🦴 osso | esqueleto
👀 olhos | ver reparar
👁️ olho | ver
👅 língua | boca
👄 boca | lábios
👶 bebé | criança
🧒 criança | miúdo
👦 rapaz | miúdo
👧 rapariga | miúda
🧑 pessoa | adulto
👨 homem | adulto
👩 mulher | adulta
🧓 pessoa idosa | velhice
👴 velho | avô
👵 velha | avó
🙅 gesto de não | recusa
🙆 gesto de sim | certo
💁 pessoa a informar | balcão
🙋 braço no ar | pergunta voluntário
🧏 pessoa surda | surdez
🙇 vénia | desculpa respeito
🤦 mão na cara | descrença
🤷 encolher de ombros | não sei
👮 polícia | agente
🕵️ detective | espião
💂 guarda | sentinela
👷 trabalhador de obra | capacete
🤴 príncipe | realeza
👸 princesa | realeza
👰 noiva | casamento
🤵 noivo | fato casamento
🎅 pai natal | natal
🤶 mãe natal | natal
🦸 super-herói | poderes
🦹 vilão | maldade
🧙 mago | feiticeiro
🧚 fada | magia
🧛 vampiro | drácula
🧜 sereia | mar
🧝 elfo | fantasia
🧟 zombie | morto-vivo
🤰 grávida | gravidez
🤱 amamentar | bebé
👪 família | pais filhos
🚶 a caminhar | passeio
🏃 a correr | corrida pressa
💃 mulher a dançar | dança
🕺 homem a dançar | dança
🧘 meditação | ioga calma
🛌 na cama | dormir descanso
💤 zzz | sono dormir
`

const NATUREZA = `
🐶 cão | cachorro
🐱 gato | gatinho felino
🐭 rato | roedor
🐹 hamster | roedor
🐰 coelho | orelhas
🦊 raposa | matreiro
🐻 urso | floresta
🐼 panda | urso
🐨 coala | austrália
🐯 tigre | felino
🦁 leão | felino
🐮 vaca | boi leite
🐷 porco | suíno
🐸 sapo | rã
🐵 macaco | primata
🐔 galinha | ave
🐧 pinguim | gelo
🐦 pássaro | ave
🐤 pintainho | ave
🦆 pato | ave
🦅 águia | ave rapina
🦉 coruja | ave noite
🦇 morcego | noite
🐺 lobo | matilha
🐗 javali | caça
🐴 cavalo | equino
🦄 unicórnio | fantasia
🐝 abelha | mel
🦋 borboleta | insecto
🐌 caracol | lento
🐞 joaninha | insecto
🐜 formiga | insecto
🦗 grilo | insecto
🕷️ aranha | insecto
🦂 escorpião | veneno
🐢 tartaruga | lento
🐍 cobra | serpente
🦎 lagarto | réptil
🦖 dinossauro | trex
🐙 polvo | mar
🦑 lula | mar
🦐 camarão | marisco
🦀 caranguejo | marisco
🐠 peixe tropical | mar
🐟 peixe | mar
🐬 golfinho | mar
🐳 baleia | mar
🦈 tubarão | mar
🐊 crocodilo | réptil
🦓 zebra | riscas
🦍 gorila | primata
🐘 elefante | tromba
🦏 rinoceronte | chifre
🐪 camelo | deserto
🦒 girafa | pescoço
🐂 touro | boi
🐄 vaca leiteira | leite
🐎 cavalo a correr | equino
🐖 porco inteiro | suíno
🐏 carneiro | ovino
🐑 ovelha | lã
🐐 cabra | caprino
🦌 veado | caça
🐕 cão inteiro | canino
🐩 caniche | cão
🦮 cão-guia | cão
🐈 gato inteiro | felino
🐓 galo | ave
🦃 peru | ave
🦚 pavão | ave
🦜 papagaio | ave
🦢 cisne | ave
🕊️ pomba | paz ave
🐇 coelho inteiro | lebre
🦔 ouriço | espinhos
🦦 lontra | rio
🐿️ esquilo | árvore
🦥 preguiça | lento
🐾 patas | pegadas
🌵 cato | deserto
🎄 árvore de natal | natal
🌲 pinheiro | árvore
🌳 árvore | floresta
🌴 palmeira | praia
🌱 rebento | crescer semente
🌿 folhagem | erva
☘️ trevo | irlanda
🍀 trevo de quatro folhas | sorte
🍃 folhas ao vento | brisa
🍂 folhas de outono | queda
🍁 folha de bordo | outono
🌾 espiga | trigo campo
🌷 tulipa | flor
🌹 rosa | flor amor
🥀 flor murcha | tristeza
🌺 hibisco | flor
🌸 flor de cerejeira | primavera
🌼 margarida | flor
🌻 girassol | flor sol
🌞 sol com cara | dia
☀️ sol | calor dia
🌤️ sol entre nuvens | tempo
⛅ nublado | tempo
☁️ nuvem | tempo
🌧️ chuva | tempo
⛈️ trovoada | tempestade
🌩️ relâmpago | tempestade
❄️ floco de neve | frio inverno
☃️ boneco de neve | inverno
🌬️ vento | ar
🌪️ tornado | tempestade
🌈 arco-íris | cores
💧 gota | água
🌊 onda | mar
🔥 fogo | chama
⭐ estrela | noite
🌟 estrela brilhante | destaque
✨ brilho | magia
⚡ raio | electricidade
🌙 lua | noite
🌕 lua cheia | noite
🌍 planeta terra | mundo europa
🪐 planeta com anel | saturno
`

const COMIDA = `
🍏 maçã verde | fruta
🍎 maçã | fruta
🍐 pêra | fruta
🍊 laranja | fruta citrino
🍋 limão | fruta citrino
🍌 banana | fruta
🍉 melancia | fruta verão
🍇 uvas | fruta vinho
🍓 morango | fruta
🫐 mirtilos | fruta
🍈 melão | fruta
🍒 cerejas | fruta
🍑 pêssego | fruta
🥭 manga | fruta tropical
🍍 ananás | fruta tropical
🥥 coco | fruta tropical
🥝 kiwi | fruta
🍅 tomate | legume
🍆 beringela | legume
🥑 abacate | fruta
🥦 brócolos | legume
🥬 couve | legume
🥒 pepino | legume
🌶️ malagueta | picante piri-piri
🌽 milho | espiga
🥕 cenoura | legume
🧄 alho | tempero
🧅 cebola | tempero
🥔 batata | legume
🍠 batata-doce | legume
🥐 croissant | pão
🥖 baguete | pão
🍞 pão | padaria
🥨 pretzel | pão
🧀 queijo | lacticínio
🥚 ovo | pequeno-almoço
🍳 ovo estrelado | pequeno-almoço
🥞 panquecas | doce
🧇 waffle | doce
🥓 bacon | carne
🍗 coxa de frango | carne
🍖 carne com osso | churrasco
🥩 bife | carne
🌭 cachorro-quente | fast food
🍔 hambúrguer | fast food
🍟 batatas fritas | fast food
🍕 pizza | fast food
🥪 sanduíche | lanche
🌮 taco | méxico
🌯 burrito | méxico
🥙 pita | wrap
🧆 falafel | grão
🥗 salada | leve
🥘 caçarola | tacho
🍲 sopa | caldo
🍜 massa | ramen
🍝 esparguete | massa
🍣 sushi | japão
🍤 camarão frito | marisco
🍚 arroz | acompanhamento
🍛 caril | picante
🥟 dumpling | ásia
🦪 ostra | marisco
🍦 gelado | doce verão
🍩 dónute | doce
🍪 bolacha | doce
🎂 bolo de aniversário | festa doce
🍰 fatia de bolo | doce
🧁 queque | doce
🥧 tarte | doce
🍫 chocolate | doce
🍬 rebuçado | doce
🍭 chupa-chupa | doce
🍯 mel | doce abelha
🍼 biberão | bebé
🥛 leite | lacticínio
☕ café | bica cafeína
🫖 bule | chá
🍵 chá verde | infusão
🍶 saqué | japão
🍾 espumante | celebração champanhe
🍷 vinho tinto | copo
🍸 cocktail | bebida
🍹 bebida tropical | férias
🍺 cerveja | imperial
🍻 cervejas | brinde
🥂 brinde | champanhe celebração
🥃 whisky | bebida
🧊 gelo | frio
🧂 sal | tempero
🥄 colher | talher
🍴 talheres | garfo faca
🍽️ prato e talheres | refeição
`

const ACTIVIDADES = `
⚽ futebol | bola desporto
🏀 basquetebol | desporto
🏈 futebol americano | desporto
⚾ basebol | desporto
🎾 ténis | desporto
🏐 voleibol | desporto
🏉 râguebi | desporto
🥏 disco voador | frisbee
🎱 bilhar | snooker
🏓 ténis de mesa | pingue-pongue
🏸 badminton | desporto
🥅 baliza | golo
🏒 hóquei no gelo | desporto
🏑 hóquei em campo | desporto
🏏 críquete | desporto
⛳ golfe | buraco
🏹 arco e flecha | tiro
🎣 pesca | cana
🤿 mergulho | máscara
🥊 boxe | luvas
🥋 artes marciais | judo karaté
🛹 skate | rua
🛼 patins | rodas
⛸️ patinagem no gelo | inverno
🎿 esqui | neve
⛷️ esquiador | neve
🏂 snowboard | neve
🏋️ halterofilismo | ginásio pesos
🤼 luta | wrestling
🤸 ginástica | acrobacia
⛹️ a driblar | basquetebol
🤺 esgrima | espada
🤾 andebol | desporto
🏌️ a jogar golfe | taco
🏇 corrida de cavalos | hipismo
🧗 escalada | montanha
🚴 ciclismo | bicicleta
🚵 btt | bicicleta montanha
🏊 natação | piscina
🤽 pólo aquático | piscina
🚣 remo | barco
🏄 surf | onda
🎪 circo | tenda
🎭 teatro | máscaras drama
🎨 pintura | arte paleta
🎬 claquete | cinema filme
🎤 microfone | cantar karaoke
🎧 auscultadores | música ouvir
🎼 pauta musical | notas
🎹 piano | teclado
🥁 bateria | tambor
🎷 saxofone | jazz
🎺 trompete | sopro
🎸 guitarra | rock
🎻 violino | corda
🪕 banjo | corda
🎲 dado | jogo sorte
♟️ xadrez | peão estratégia
🎯 alvo | pontaria
🎳 bowling | pinos
🎮 comando | videojogos consola
🎰 slot machine | casino
🧩 puzzle | peça
🎁 presente | prenda
🎈 balão | festa
🎉 festa | celebração parabéns
🎊 confetti | festa
🎃 abóbora | halloween
🎆 fogo de artifício | festa
🏆 troféu | vitória campeão
🥇 medalha de ouro | primeiro
🥈 medalha de prata | segundo
🥉 medalha de bronze | terceiro
🏅 medalha | prémio
🎖️ medalha militar | honra
`

const VIAGENS = `
🚗 carro | automóvel
🚕 táxi | transporte
🚙 jipe | todo-o-terreno
🚌 autocarro | transporte
🏎️ carro de corrida | fórmula
🚓 carro da polícia | autoridade
🚑 ambulância | emergência
🚒 camião dos bombeiros | emergência
🚐 carrinha | transporte
🚚 camião | carga
🚜 tractor | campo agricultura
🛵 scooter | mota
🏍️ mota | motociclo
🚲 bicicleta | pedalar
🛴 trotinete | rua
🚨 sirene | alarme emergência
🚂 comboio a vapor | locomotiva
🚆 comboio | caminho de ferro
🚇 metro | subterrâneo
🚊 eléctrico | lisboa
🚁 helicóptero | ar
✈️ avião | viagem voo
🛫 descolagem | aeroporto
🛬 aterragem | aeroporto
🪂 paraquedas | salto
💺 lugar sentado | assento
🚀 foguetão | lançamento espaço
🛸 disco voador | ovni
⛵ veleiro | barco vela
🚤 lancha | barco
🛳️ navio de cruzeiro | mar
⚓ âncora | marinha
⛽ bomba de gasolina | combustível
🚧 obras | sinalização
🗺️ mapa | orientação
🧭 bússola | direcção norte
🏔️ montanha com neve | serra
⛰️ montanha | serra
🌋 vulcão | erupção
🏕️ acampamento | tenda campismo
🏖️ praia | sombrinha verão
🏝️ ilha deserta | férias
🏜️ deserto | areia
🏞️ parque natural | paisagem
🌅 nascer do sol | amanhecer
🌄 amanhecer nas montanhas | serra
🌇 pôr do sol na cidade | entardecer
🌆 cidade ao entardecer | anoitecer
🌃 cidade à noite | estrelas
🌉 ponte à noite | rio
🏙️ cidade | horizonte prédios
🏠 casa | lar
🏡 casa com jardim | lar
🏘️ bairro | casas
🏢 escritório | prédio empresa
🏥 hospital | saúde
🏦 banco | dinheiro
🏨 hotel | dormida
🏪 loja | comércio
🏫 escola | ensino
🏰 castelo | história
🗼 torre | monumento
🗽 estátua da liberdade | nova iorque
⛪ igreja | culto
🕌 mesquita | culto
🛕 templo | culto
🕍 sinagoga | culto
⛩️ portão japonês | tório
⛲ fonte | praça
🎡 roda gigante | feira
🎢 montanha-russa | feira
🎠 carrossel | feira
`

const OBJECTOS = `
⌚ relógio de pulso | horas
📱 telemóvel | telefone
💻 portátil | computador
⌨️ teclado | escrever
🖥️ computador de secretária | ecrã
🖨️ impressora | papel
🖱️ rato do computador | clicar
💾 disquete | guardar
💿 cd | disco
📷 máquina fotográfica | foto
📹 câmara de vídeo | filmar
🎥 câmara de cinema | filmar
📽️ projector | cinema
📺 televisão | ecrã
📻 rádio | emissora
🎙️ microfone de estúdio | podcast
⏱️ cronómetro | tempo
⏰ despertador | alarme hora
⏳ ampulheta | tempo espera
🔋 bateria | carga
🔌 ficha | tomada corrente
💡 lâmpada | ideia luz
🔦 lanterna | luz
🕯️ vela | luz
🧯 extintor | fogo segurança
💸 dinheiro a voar | gastar
💵 notas | dinheiro
💰 saco de dinheiro | riqueza
💳 cartão de crédito | pagar
🧾 recibo | factura
💎 diamante | jóia
⚖️ balança | justiça equilíbrio
🪜 escada | subir
🧰 caixa de ferramentas | reparar
🔧 chave inglesa | reparar
🔨 martelo | obra
🛠️ ferramentas | reparar
⛏️ picareta | escavar
🔩 parafuso e porca | montagem
⚙️ engrenagem | definições mecânica
🧱 tijolos | parede obra
🔗 elo | ligação link
⛓️ correntes | prender
🧲 íman | atracção
💣 bomba | explosão
🧨 petardo | explosão
🪓 machado | lenha
🔪 faca | cozinha
🗡️ espada | duelo
🛡️ escudo | protecção defesa
⚰️ caixão | morte
🏺 ânfora | antiguidade
🔮 bola de cristal | adivinhar
🧿 olho grego | amuleto
📿 terço | oração
⚗️ alambique | química
🔭 telescópio | astronomia
🔬 microscópio | ciência
💊 comprimido | medicamento
💉 seringa | vacina
🩸 gota de sangue | análise
🩹 penso rápido | ferida
🩺 estetoscópio | médico
🚪 porta | entrada
🪑 cadeira | sentar
🚿 chuveiro | banho
🛁 banheira | banho
🧴 frasco | creme
🧹 vassoura | limpar
🧺 cesto | roupa
🧻 papel higiénico | casa de banho
🧼 sabão | lavar
🪥 escova de dentes | higiene
🔑 chave | abrir
🗝️ chave antiga | segredo
🔒 cadeado fechado | segurança privado
🔓 cadeado aberto | destrancado
🔐 cadeado com chave | cifrado segurança
🛎️ campainha de serviço | atendimento
🧳 mala de viagem | férias
☂️ chapéu de chuva | guarda-chuva
🎒 mochila | escola
👓 óculos | ver
🕶️ óculos de sol | verão
👔 gravata | formal
👕 t-shirt | roupa
👖 calças de ganga | roupa
🧥 casaco | frio roupa
👗 vestido | roupa
👞 sapato | calçado
👟 ténis | calçado desporto
👑 coroa | rei realeza
🎩 cartola | elegante
🧢 boné | chapéu
📚 livros | ler biblioteca
📖 livro aberto | ler estudo
📓 caderno | apontamentos
📝 nota | escrever apontar
📄 documento | folha papel
📋 prancheta | lista
📌 alfinete | fixar
📎 clipe | anexo
✂️ tesoura | cortar
📐 esquadro | medir
📏 régua | medir
🗓️ calendário | data agenda
📁 pasta | ficheiros
📂 pasta aberta | ficheiros
🗄️ arquivo | gaveta
🗑️ lixo | apagar
✉️ carta | correio email
📧 email | correio
📨 mensagem recebida | correio
📩 mensagem enviada | correio
📮 marco do correio | carta
📦 encomenda | caixa entrega
🏷️ etiqueta | preço
📢 megafone | anúncio
📣 megafone de mão | gritar
🔔 sino | notificação aviso
🔕 sino cortado | silêncio mudo
📡 antena parabólica | sinal
🔍 lupa | pesquisar procurar
🔎 lupa à direita | procurar
`

const SIMBOLOS = `
❤️ coração vermelho | amor
🧡 coração laranja | amor
💛 coração amarelo | amor
💚 coração verde | amor
💙 coração azul | amor
💜 coração roxo | amor
🖤 coração preto | luto
🤍 coração branco | pureza
🤎 coração castanho | amor
💔 coração partido | desgosto
💕 dois corações | amor
💞 corações a girar | amor
💓 coração a bater | amor
💗 coração a crescer | amor
💖 coração brilhante | amor
💘 coração com seta | cupido
💝 coração com laço | prenda
💯 cem | perfeito nota
💢 fúria | irritação
💥 explosão | choque
💫 tonturas | estrelas
💦 gotas | suor água
💨 rajada | fuga vento
✅ visto verde | certo feito
☑️ caixa marcada | tarefa
✔️ visto | certo
❌ cruz | errado não
⭕ círculo | certo
❗ ponto de exclamação | atenção
❓ ponto de interrogação | dúvida
‼️ dupla exclamação | urgente
⁉️ exclamação e interrogação | espanto
⚠️ aviso | perigo cuidado
🚫 proibido | interdito
⛔ entrada proibida | interdito
🔞 maiores de dezoito | idade
☢️ radioactivo | perigo
☣️ risco biológico | perigo
♻️ reciclagem | ambiente
⚜️ flor-de-lis | heráldica
🔱 tridente | neptuno
🆗 ok | certo
🆕 novo | novidade
🆓 grátis | gratuito
🔝 topo | subir
🔙 voltar | atrás
🔜 em breve | brevemente
🔄 recarregar | repetir actualizar
▶️ reproduzir | play
⏸️ pausa | parar
⏹️ parar | stop
⏭️ seguinte | avançar
⏮️ anterior | recuar
🔀 aleatório | baralhar
🔁 repetir | ciclo
🔊 som alto | volume
🔉 som médio | volume
🔈 som baixo | volume
🔇 sem som | mudo silêncio
➕ mais | somar
➖ menos | subtrair
➗ dividir | divisão
✖️ multiplicar | vezes
♾️ infinito | sempre
✳️ asterisco | nota
©️ direitos de autor | copyright
®️ marca registada | registo
™️ marca comercial | marca
♠️ espadas | cartas naipe
♥️ copas | cartas naipe
♦️ ouros | cartas naipe
♣️ paus | cartas naipe
🔴 círculo vermelho | ponto
🟠 círculo laranja | ponto
🟡 círculo amarelo | ponto
🟢 círculo verde | ponto
🔵 círculo azul | ponto
🟣 círculo roxo | ponto
⚫ círculo preto | ponto
⚪ círculo branco | ponto
🟥 quadrado vermelho | bloco
🟧 quadrado laranja | bloco
🟨 quadrado amarelo | bloco
🟩 quadrado verde | bloco
🟦 quadrado azul | bloco
🟪 quadrado roxo | bloco
⬛ quadrado preto | bloco
⬜ quadrado branco | bloco
`

const BANDEIRAS = `
🇵🇹 portugal | bandeira
🇧🇷 brasil | bandeira
🇪🇸 espanha | bandeira
🇫🇷 frança | bandeira
🇬🇧 reino unido | bandeira inglaterra
🇩🇪 alemanha | bandeira
🇮🇹 itália | bandeira
🇳🇱 países baixos | bandeira holanda
🇧🇪 bélgica | bandeira
🇨🇭 suíça | bandeira
🇦🇹 áustria | bandeira
🇮🇪 irlanda | bandeira
🇸🇪 suécia | bandeira
🇳🇴 noruega | bandeira
🇩🇰 dinamarca | bandeira
🇫🇮 finlândia | bandeira
🇵🇱 polónia | bandeira
🇬🇷 grécia | bandeira
🇷🇴 roménia | bandeira
🇺🇸 estados unidos | bandeira américa
🇨🇦 canadá | bandeira
🇲🇽 méxico | bandeira
🇦🇷 argentina | bandeira
🇯🇵 japão | bandeira
🇨🇳 china | bandeira
🇰🇷 coreia do sul | bandeira
🇮🇳 índia | bandeira
🇦🇺 austrália | bandeira
🇿🇦 áfrica do sul | bandeira
🇦🇴 angola | bandeira
🇲🇿 moçambique | bandeira
🇨🇻 cabo verde | bandeira
🇬🇼 guiné-bissau | bandeira
🇸🇹 são tomé e príncipe | bandeira
🇹🇱 timor-leste | bandeira
🇪🇺 união europeia | bandeira
🏳️ bandeira branca | rendição
🏴 bandeira preta | pirata
🏁 bandeira de xadrez | meta corrida
🚩 bandeira triangular | marcar
🏳️‍🌈 bandeira arco-íris | orgulho lgbt
`

export const CATEGORIES: readonly EmojiCategory[] = [
  { id: "rostos", symbol: "😀", emojis: parse(ROSTOS) },
  { id: "gestos", symbol: "👋", emojis: parse(GESTOS) },
  { id: "natureza", symbol: "🌿", emojis: parse(NATUREZA) },
  { id: "comida", symbol: "🍕", emojis: parse(COMIDA) },
  { id: "actividades", symbol: "⚽", emojis: parse(ACTIVIDADES) },
  { id: "viagens", symbol: "✈️", emojis: parse(VIAGENS) },
  { id: "objectos", symbol: "💡", emojis: parse(OBJECTOS) },
  { id: "simbolos", symbol: "❤️", emojis: parse(SIMBOLOS) },
  { id: "bandeiras", symbol: "🇵🇹", emojis: parse(BANDEIRAS) },
]

const ALL: readonly Emoji[] = CATEGORIES.flatMap((category) => category.emojis)

/** From glyph to its record. Recent ones store only the glyph, the name the
 * screen reader announces comes from here. */
const BY_CHAR = new Map(ALL.map((emoji) => [emoji.char, emoji]))

export function findEmoji(char: string): Emoji | undefined {
  return BY_CHAR.get(char)
}

/**
 * Search by name, in three layers of relevance.
 *
 * Someone typing "co" wants "coração" before "cachorro-quente": a name prefix
 * beats a word prefix, and a whole word beats a match in the middle. Without
 * these layers the order would be the table's, and the table does not know what
 * you were looking for.
 */
export function searchEmoji(query: string, limit = 96): Emoji[] {
  const needle = fold(query.trim())
  if (!needle) return []
  const prefix: Emoji[] = []
  const word: Emoji[] = []
  const anywhere: Emoji[] = []
  for (const emoji of ALL) {
    const hay = emoji.haystack
    if (hay.startsWith(needle)) prefix.push(emoji)
    else if (hay.includes(` ${needle}`)) word.push(emoji)
    else if (hay.includes(needle)) anywhere.push(emoji)
  }
  return [...prefix, ...word, ...anywhere].slice(0, limit)
}
