import { useEffect, useMemo, useRef, useState } from "react"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { bytesQueAindaCabem, caracteresDeDataUrl, FICHEIRO_MAX_BYTES } from "@enclave/client-core"
import type { ConnectionState, LinkCard, Profile } from "../../bridge.js"
import { useBridge } from "../../App.js"
import type { MessageExtras, OutgoingFile, OutgoingImage } from "../../types.js"
import { Button } from "../../components/Button.js"
import { EmojiPicker } from "../../components/EmojiPicker.js"
import { primeiroEndereco } from "../../components/RichText.js"
import { useAtalhosDeFormatacao } from "../../hooks/useAtalhosDeFormatacao.js"
import { CloseIcon, EnviarIcon, PlusIcon, SmileyIcon } from "../../icons.js"
import { colarImagens } from "../../lib/colar.js"
import {
  comandosASugerir,
  corpoDoMe,
  ESTADO_MAX_CARACTERES,
  lerComando,
  type Comando,
  type ComandoLido,
} from "../../lib/comandosDaBarra.js"
import { extensaoDe, formatarBytes, lerComoDataUrl, nomeSeguro } from "../../lib/ficheiros.js"
import { compressImage, IMAGE_BUDGETS, resumoDaReducao } from "../../lib/images.js"
import {
  aplicarMencoesComTodos,
  inserirMencao,
  mencaoEmCurso,
  sugerirMencoesComTodos,
  type MentionCandidate,
  type MentionPick,
} from "../../lib/mentions.js"
import { comResposta, type RespostaNaCaixa } from "../../lib/respostas.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"
import { strings, traduzirErro } from "../../strings.js"
import { ContextMenu } from "../overlays/ContextMenu.js"
import { LinkAttach } from "./LinkAttach.js"
import { MentionPicker } from "./MentionPicker.js"

/**
 * How many images fit in a message, and why this number.
 *
 * The protocol accepts ten. What matters here is the other cap: the frame
 * that comes out for the thread carries base64 of the encrypted base64 of the
 * image (about 1.8× the original bytes) and the session refuses anything over
 * 11 MB. Four images at 400 KB are about 2.9 MB in the thread, plenty safe,
 * and the refusal happens during composition, not midway through a send already
 * marked complete.
 */
/**
 * The character limit for a message, and where the counter shows up.
 *
 * Owner request from October 27, 2026: "a comfortable number for users".
 * 2000 is Discord's, which is the reference for who uses this: it fits a long
 * paragraph, but not a document. The protocol can handle much more (the real
 * cap is on the encrypted payload, `PAYLOAD_MAX_CHARS`); this is a comfort
 * limit, for the writer's side. The counter only shows near the end, so
 * people writing "ok" are not staring at a character count.
 */
export const MENSAGEM_MAX_CARACTERES = 2000
const CONTADOR_A_PARTIR_DE = 1800

const IMAGENS_MAX = 4

/**
 * How many files fit in a message.
 *
 * The protocol accepts ten ATTACHMENTS total, images included. Four images are
 * already accounted for, so six is what remains. But even those six rarely fit,
 * because the cap that really matters is the byte count, not the count itself:
 * see `bytesQueAindaCabem`, which is checked for each file picked and drops as
 * the message fills up.
 *
 * This number exists only for the edge case of someone dragging fifty tiny
 * files: without it, a message with thirty attachments would pass the byte cap
 * and be rejected by the schema on send.
 */
const FICHEIROS_MAX = 6

/**
 * Controlled by the per-channel draft map upstream, so switching channels
 * keeps each conversation's half-written sentence. On submit the text is
 * handed to the outbox *first* and only then cleared: a failed send lives on
 * as a failed bubble, never as vanished input.
 *
 * Images and the link card do NOT persist across channels, unlike text: an
 * attachment is a completed gesture, and rediscovering it hanging in a
 * conversation you return to half an hour later would be a cheap way to send
 * a photo to the wrong person.
 */
/**
 * The buzz is back in view (October 28, 2026, owner request).
 *
 * It was hidden since August 18, 2026, also by owner decision, with the entire
 * path live and tested underneath: the `useBuzz`, the `buzz` sound, the shake
 * `.main.buzzing` and the protocol event. It came back with a new limit, one
 * per minute per conversation (`lib/limiteDaCotovelada.ts`), which is what sets
 * it apart from a cheap way to bother someone.
 *
 * The toggle stays, to hide it again in one line if needed.
 */
const MOSTRAR_COTOVELADA = true

/**
 * Polls are hidden, by owner decision from August 18, 2026.
 *
 * Hidden, not removed: the entire path stays live and tested. The `Poll` in
 * the protocol, the count, vote rebroadcast, the card. What is gone are the
 * two entry points where someone creates one: the menu entry in the conversation
 * and the button in the feed.
 *
 * An existing poll keeps drawing and accepting votes. Hiding creation is not
 * erasing what was already said, and removing a poll from the screen that
 * someone else sees would be worse than not having the feature.
 *
 * It comes back in one line, and while it is off there is no dead code: tests
 * keep exercising everything underneath.
 */
const MOSTRAR_VOTACOES = false

export function Composer({
  connection,
  value,
  onChange,
  onSend,
  onTyping,
  mentionable = [],
  podeMencionarTodos = false,
  directory,
  presenceFor,
  emChamada,
  onBuzz,
  buzzCooldown = 0,
  onVotacao,
  meuNome,
  onSaveStatus,
  eu = null,
  resposta = null,
  onAlternarMencao,
  onCancelarResposta,
}: {
  connection: ConnectionState
  value: string
  onChange: (text: string) => void
  onSend: (body: string, extras?: MessageExtras) => void
  /**
   * A key was pressed. The signal rate is decided in `useTyping`, not here:
   * this box calls this for each keystroke and the vast majority of calls send
   * nothing.
   */
  onTyping?: (() => void) | undefined
  /**
   * Who can be mentioned here, with their name already resolved.
   *
   * It comes from above and is not looked up here, because the conversation
   * screen knows who is in this room. It always comes from this device's
   * directory: there is no global account search in this product, and asking
   * the server who matches a prefix was leaking the social graph one letter
   * at a time.
   */
  mentionable?: readonly MentionCandidate[]
  /**
   * Whether the writer can mention everyone in this room. With it, the list
   * offers `@all` and sending includes a mention for everyone. Without it,
   * `@all` typed by hand comes through as plain text. Missing means "cannot".
   */
  podeMencionarTodos?: boolean | undefined
  /** Just to show each person's photo next to their name in suggestions. */
  directory?: Map<string, Profile> | undefined
  /** The ring of photos in suggestions. See `MentionPicker`. */
  presenceFor?: ((address: string) => "active" | "away" | "busy" | "idle") | undefined
  emChamada?: ((address: string) => boolean) | undefined
  /**
   * Send a buzz, if this conversation allows it.
   *
   * Missing is missing: without this there is no button. The `useBuzz` decides
   * if the conversation allows it. Only in direct chats, because a buzz to
   * thirty people is an alarm. This box does not repeat the rule, just obeys
   * whoever gives it to them or not.
   */
  onBuzz?: (() => void) | undefined
  /** Seconds left before another buzz can be sent. Zero means free. */
  buzzCooldown?: number
  /**
   * Create a poll in this conversation.
   *
   * Opens the sheet, which lives in the shell: this box does not mount or send
   * the poll, just says someone asked for one. Missing is missing: without it
   * there is no menu entry. A host that does not know about polls stays without
   * them instead of offering them and failing.
   */
  onVotacao?: (() => void) | undefined
  /**
   * The name of the writer, so `/me` comes out as "Ana waves". Missing, `/me`
   * comes out with just the action in italics, like Discord: the conversation
   * already shows who wrote it. See `lib/comandosDaBarra.ts`.
   */
  meuNome?: string | undefined
  /**
   * Set the status message via `/away` and `/estado`. It's the SAME gesture as
   * the account card (`onSaveStatus` from `CartaoDaConta`), not a separate
   * path. When unavailable, both commands say where to change it instead of
   * pretending.
   */
  onSaveStatus?: ((statusText: string) => void) | undefined
  /** The writer's account: do not mention yourself. */
  eu?: string | null | undefined
  /**
   * The reply being written, if any. It lives above, per room, like a draft:
   * switching rooms and coming back finds it where it was.
   */
  resposta?: RespostaNaCaixa | null | undefined
  /** The "@ Mencionar" toggle. */
  onAlternarMencao?: (() => void) | undefined
  /** The X on the bar, and Esc in the box. */
  onCancelarResposta?: (() => void) | undefined
}): React.JSX.Element {
  /*
    No connection, you can still write.

    The box was blank offline, and the thought someone had in their head on the
    train would be lost. Now the message goes into the outbox as "waiting for
    connection", shows in the conversation with that mark, and sends itself when
    the connection comes back. See `useOutbox`.

    Images and files still need connection: they are megabytes in memory waiting
    for a network that might not return in this session, and a large send
    mid-reconnect is the case that fails most. The `+` says why when you tap it,
    instead of being blank with no explanation.
  */
  const offline = connection !== "online"
  /*
    A vault that no longer writes (old version, or another vault got the
    storage) will not reconnect, not even via the button. There, writing to the
    outbox was a promise for a send that never leaves: the box closes and says
    why. A bridge with the prompt writes, as always.
  */
  const bridge = useBridge()
  // Read on every draw, no memory: stopping the write closes the session, and
  // the `connection` change that brings is the draw that reads it again.
  const parado = bridge.session?.escreve?.() === false
  /** The person tapped `+` with no connection: show the reason. */
  const [pediuAnexoOffline, setPediuAnexoOffline] = useState(false)
  useEffect(() => {
    if (!offline) setPediuAnexoOffline(false)
  }, [offline])

  const [picking, setPicking] = useState(false)
  const [images, setImages] = useState<OutgoingImage[]>([])
  const [files, setFiles] = useState<OutgoingFile[]>([])
  const [aLer, setALer] = useState(false)
  const [card, setCard] = useState<LinkCard | null>(null)
  /** An address whose preview the person dismissed. The link still goes through. */
  const [dispensado, setDispensado] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  /**
   * What compression did to the image, in bytes.
   *
   * Separate from `warning` because it is not a warning: nothing went wrong,
   * and drawing it in red next to the refusals would teach people to ignore
   * both. A photo that comes in at twelve megabytes and leaves at three hundred
   * kilobytes changed, and whoever sends it has the right to know without
   * discovering it on the other end.
   */
  const [reducao, setReducao] = useState<string | null>(null)
  const [aComprimir, setAComprimir] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  /**
   * Starting a reply puts the focus in the box: someone who tapped "Reply"
   * wants to write next. By ID, not by object: changing the mention does not
   * start a new reply.
   */
  const respostaId = resposta?.id ?? null
  useEffect(() => {
    if (respostaId !== null) field.current?.focus()
  }, [respostaId])
  /** The two file fields, hidden and opened by the `+` menu. */
  const campoImagens = useRef<HTMLInputElement>(null)
  const campoFicheiros = useRef<HTMLInputElement>(null)
  const botaoMais = useRef<HTMLButtonElement>(null)
  /** Where the `+` menu is open, or null if it is not. */
  const [maisAberto, setMaisAberto] = useState<{ x: number; y: number } | null>(null)
  const caret = useRef<number | null>(null)
  /** Cmd/Ctrl+B and friends, on whatever is selected. See the hook. */
  const formatar = useAtalhosDeFormatacao(value, onChange)

  // The cursor goes back after the emoji lands. The text is controlled above,
  // so the box only exists with the new value after this render. Before that
  // there is nowhere to put the cursor.
  useEffect(() => {
    const at = caret.current
    if (at === null) return
    caret.current = null
    const node = field.current
    if (!node) return
    node.focus()
    node.setSelectionRange(at, at)
  }, [value])

  // ------------------------------------------------------------- mentions
  //
  // The people picked in this sentence. Held until send, where the names are
  // swapped for addresses. See `aplicarMencoes`. Anyone picked and then deleted
  // by hand does not survive the swap, and that is how it should be: a mention
  // that is no longer written is not a mention.
  const [picks, setPicks] = useState<MentionPick[]>([])
  /** Where the @ starts being typed, and what already follows it. */
  const [mencao, setMencao] = useState<{ inicio: number; procura: string } | null>(null)
  const [escolhido, setEscolhido] = useState(0)
  /** An @ that the person closed with Escape. Does not reopen until they touch it. */
  const [dispensada, setDispensada] = useState<number | null>(null)

  const sugestoes = useMemo(
    () => (mencao && mencao.inicio !== dispensada ? sugerirMencoesComTodos(mentionable, mencao.procura, podeMencionarTodos) : []),
    [mencao, dispensada, mentionable, podeMencionarTodos],
  )
  const aSugerir = sugestoes.length > 0

  // ------------------------------------------------- slash commands
  //
  // The list when typing `/`, like the mention list and with the same keyboard.
  // Mentions win if both show: an @ in the middle of a command is the person
  // picking someone, and that is the list they are reading.
  const [comandoEscolhido, setComandoEscolhido] = useState(0)
  /** The list was closed with Escape. It comes back when the text stops starting with `/`. */
  const [comandosDispensados, setComandosDispensados] = useState(false)
  const comandos = useMemo(
    () => (comandosDispensados ? [] : comandosASugerir(value)),
    [value, comandosDispensados],
  )
  const aSugerirComando = !aSugerir && comandos.length > 0
  /** What a command did, stated without the red of a warning: nothing went wrong. */
  const [nota, setNota] = useState<string | null>(null)

  const escolherComando = (comando: Comando): void => {
    const texto = `/${comando.nome} `
    onChange(texto)
    caret.current = texto.length
    setComandoEscolhido(0)
  }

  /**
   * Execute the command that was read. Returns the body to send (only `/me` sends), or
   * `null` when the command ends here: handled, or rejected with the reason.
   *
   * A rejected command leaves the text in the box so the user can fix it without
   * retyping. A completed command clears it, like a sent message.
   */
  const fazerComando = ({ nome, argumento }: ComandoLido): string | null => {
    switch (nome) {
      case "me":
        if (argumento.length === 0) {
          setAviso(strings.barra.meVazio)
          return null
        }
        return corpoDoMe(argumento, meuNome)
      case "away":
      case "estado":
        if (!onSaveStatus) {
          setAviso(strings.barra.estadoIndisponivel)
          return null
        }
        if (argumento.length > ESTADO_MAX_CARACTERES) {
          setAviso(strings.barra.estadoLongo(ESTADO_MAX_CARACTERES))
          return null
        }
        // No text clears the box, like `/away` in IRC: it means "I'm back".
        onSaveStatus(argumento)
        onChange("")
        setPicks([])
        setMencao(null)
        setAviso(null)
        setNota(argumento.length > 0 ? strings.barra.estadoPosto : strings.barra.estadoApagado)
        return null
      case "nick":
      case "topic":
      case "kick":
        // These depend on the backend (account name, channel topic, kick via
        // slash). Until then, the server reports them, and does not send the command as text: a
        // `/kick ana` in the chat would be worse than nothing.
        setAviso(strings.barra.naProximaVersao(`/${nome}`))
        return null
    }
  }

  /** Re-evaluate the mention at each keystroke, starting from the cursor position. */
  const reavaliarMencao = (texto: string, cursor: number): void => {
    const encontrada = mencaoEmCurso(texto, cursor)
    setMencao(encontrada)
    setEscolhido(0)
    // Moved to a different mention: the one that was dismissed no longer counts.
    if (encontrada === null || encontrada.inicio !== dispensada) setDispensada(null)
  }

  const escolherMencao = (candidato: MentionCandidate): void => {
    if (!mencao) return
    const node = field.current
    const cursor = node?.selectionStart ?? value.length
    const { texto, cursor: novoCursor, pick } = inserirMencao(value, mencao.inicio, cursor, candidato)
    onChange(texto)
    caret.current = novoCursor
    // The same person chosen twice counts once: the token is the same, and
    // two identical entries would run the swap twice over itself.
    setPicks((atuais) =>
      atuais.some((p) => p.token === pick.token && p.address === pick.address) ? atuais : [...atuais, pick],
    )
    setMencao(null)
    setDispensada(null)
  }

  const endereco = useMemo(() => primeiroEndereco(value), [value])

  // The card describes ONE address. If the address changes, the old card becomes
  // a wrong label stuck to a new link, which is worse than having none.
  useEffect(() => {
    setCard((atual) => (atual && atual.url === endereco ? atual : null))
  }, [endereco])

  /**
   * Insert the emoji where the cursor was, not at the end.
   *
   * If someone writes "thanks " and moves back to add an emoji in the middle of the sentence,
   * they don't want to see it land after the period. With no known selection,
   * a box that has not been touched yet assumes the end of the text is correct.
   */
  const insert = (char: string): void => {
    const node = field.current
    const start = node?.selectionStart ?? value.length
    const end = node?.selectionEnd ?? start
    onChange(value.slice(0, start) + char + value.slice(end))
    caret.current = start + char.length
  }

  /**
   * Choose images.
   *
   * ALL of them go through the compressor before being encrypted, and it must be in this
   * order: encrypted, an image is noise that no one can shrink, not this
   * device, not the server, which is the point. See `lib/images.ts` for the
   * budgets and the reason for each one.
   */
  const escolherImagens = (escolhidasTodas: File[]): void => {
    if (escolhidasTodas.length === 0) return
    const espaço = IMAGENS_MAX - images.length
    if (espaço <= 0) {
      setAviso(strings.chat.imagesFull(IMAGENS_MAX))
      return
    }
    setAviso(null)
    setReducao(null)
    setAComprimir(true)
    const escolhidas = escolhidasTodas.slice(0, espaço)
    void Promise.all(
      escolhidas.map(async (file) => {
        const imagem = await compressImage(file, IMAGE_BUDGETS.chat)
        return {
          dataUrl: imagem.dataUrl,
          name: file.name || "imagem",
          // The type of the BYTES when it exists: what comes from the file
          // picker carries what the system declared, and what comes from the clipboard has already
          // been confirmed byte by byte in `lib/colar.ts`.
          mediaType: file.type || "image/jpeg",
          bytes: imagem.bytes,
        }
      }),
    )
      .then((novas) => {
        setImages((atuais) => [...atuais, ...novas].slice(0, IMAGENS_MAX))
        setReducao(resumoDaReducao(escolhidas, novas))
      })
      // An image that does not fit is an error to show here, not a message that
      // the other side discards entirely and silently. It goes through translation to
      // carry the code ("Error 501") and the phrase in the interface language.
      .catch((erro: Error) => setAviso(traduzirErro(erro)))
      .finally(() => setAComprimir(false))
  }

  /**
   * Handle a `paste` in the text box.
   *
   * The entire policy, text wins, bytes decide the type, either everything enters or
   * nothing enters, lives in `lib/colar.ts` and is shared with the feed text box. Here
   * is only the destination: confirmed images enter through the
   * SAME path as the button, with the same compressor, the same limits and the
   * same rejections. A second path for the same attachment is what gets left behind
   * the day we add a check to one of them.
   */
  const colar = (event: React.ClipboardEvent): void => {
    const tomou = colarImagens(event.clipboardData, {
      aceitar: escolherImagens,
      recusar: () => setAviso(strings.common.pasteNotImage),
    })
    // The browser only locks up if there are images to process: a
    // `preventDefault` on text pasting would swallow the user's sentence, which is
    // a much worse trade than not having this feature.
    if (tomou) event.preventDefault()
  }

  /**
   * The payload characters this message has already used.
   *
   * Measured, not estimated: `JSON.stringify` of the text counts escapes for real
   * (an emoji takes more than one character after escaping), and data URLs
   * count by their actual length. This number is what gets deducted from the limit
   * before accepting another file, because a fixed limit would lie the second time
   * something attaches to the message.
   */
  const ocupado = useMemo(() => {
    let total = JSON.stringify(value).length + (card ? JSON.stringify(card).length : 0)
    for (const imagem of images) total += imagem.dataUrl.length
    for (const ficheiro of files) total += ficheiro.dataUrl.length
    return total
  }, [value, card, images, files])

  /**
   * Choose files that are not images.
   *
   * **They do not go through any compressor, and that is intentional.** A photograph
   * shrinks because it has redundancy to lose; a PDF already comes compressed inside
   * and recompressing it gets BIGGER, the second pass only adds
   * headers to bytes that have no pattern left to exploit. Instead of compression
   * we have an honest rejection, and that is why it has to be good.
   *
   * **The check happens before reading the file.** `file.size` is known
   * without touching the bytes, so a half-gigabyte file chosen by mistake
   * is rejected without costing half a gigabyte of memory. It is only read after it fits.
   *
   * **And it is sequential on purpose.** Each file accepted changes the budget for
   * the next one; if chosen in parallel, two two-megabyte files would both pass
   * on an empty message budget and together bust the frame.
   */
  const escolherFicheiros = async (escolhidos: File[]): Promise<void> => {
    const espaço = FICHEIROS_MAX - files.length
    if (espaço <= 0) {
      setAviso(strings.chat.filesFull(FICHEIROS_MAX))
      return
    }
    setAviso(null)
    setALer(true)
    try {
      let gasto = ocupado
      const novos: OutgoingFile[] = []
      for (const file of escolhidos.slice(0, espaço)) {
        const mediaType = file.type || "application/octet-stream"
        const cabe = bytesQueAindaCabem(gasto, mediaType)
        if (cabe <= 0) {
          setAviso(strings.chat.fileNoRoom)
          break
        }
        if (file.size > cabe) {
          // The number reported is what fits NOW, not the absolute limit: it is the
          // only answer to the question the user just asked. The absolute limit
          // stays on the button label for whoever wants to know ahead of time.
          setAviso(strings.chat.fileTooBig(nomeSeguro(file.name), formatarBytes(cabe)))
          break
        }
        const dataUrl = await lerComoDataUrl(file)
        gasto += caracteresDeDataUrl(file.size, mediaType)
        novos.push({ dataUrl, name: file.name, mediaType, bytes: file.size })
      }
      if (novos.length > 0) setFiles((atuais) => [...atuais, ...novos].slice(0, FICHEIROS_MAX))
    } catch {
      setAviso(strings.chat.fileUnreadable)
    } finally {
      setALer(false)
    }
  }

  const limpar = (): void => {
    setImages([])
    setFiles([])
    setCard(null)
    setDispensado(null)
    setAviso(null)
    setReducao(null)
    setPicks([])
    setMencao(null)
    setDispensada(null)
    setNota(null)
  }

  const vazio = value.trim().length === 0 && images.length === 0 && files.length === 0
  /** Attachments chosen with a connection, and the connection dropped before sending. */
  const anexosSemLigacao = offline && (images.length > 0 || files.length > 0)
  const notaOffline = offline && (pediuAnexoOffline || anexosSemLigacao)
  /** Nothing goes out while bytes are still coming in: see `aComprimir` and `aLer`. */
  const ocupada = aComprimir || aLer

  return (
    <>
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault()
          if (parado) return
          // With the suggestions menu open, Enter picks a person instead of
          // sending. The `form` gets the submit anyway when the field has focus,
          // so the guard has to be here and not just in `keydown`.
          if (aSugerir) return
          const escrito = value.trim()
          // An image or file alone is a valid message; empty text with nothing attached is not.
          if (!escrito && images.length === 0 && files.length === 0) return
          if (anexosSemLigacao) return
          // A command with a slash decides here whether there is a message. Only `/me` sends,
          // and sends text: the protocol does not know a command happened.
          const comando = lerComando(escrito)
          const body = comando ? fazerComando(comando) : escrito
          if (body === null) return
          if (body.length > MENSAGEM_MAX_CARACTERES) {
            setAviso(strings.chat.messageTooLong(MENSAGEM_MAX_CARACTERES))
            return
          }
          // Names become addresses here: the screen showed the name while
          // typing, and what goes out to the group is the address, the only one
          // that does not age and the only one the notification can route.
          const { corpo, mentions } = aplicarMencoesComTodos(body, picks, podeMencionarTodos)
          // The reply goes in here: the `replyTo` and, with "@ Mention" on, the
          // author of the original in the mentions. See `lib/respostas.ts`.
          const extras: MessageExtras = comResposta(
            {
              ...(images.length > 0 ? { images } : {}),
              ...(files.length > 0 ? { files } : {}),
              ...(card ? { links: [card] } : {}),
              ...(mentions.length > 0 ? { mentions } : {}),
            },
            resposta,
            eu,
          )
          // Without attachments, it is called with one argument: the same
          // call as always, and nothing downstream has to learn a new form.
          if (extras.images || extras.files || extras.links || extras.mentions || extras.replyTo) onSend(corpo, extras)
          else onSend(corpo)
          onChange("")
          limpar()
        }}
      >
        {/* The reply announcement, always built: a live region that starts
            with text is not read by all screen readers. Polished: it says who
            is being replied to and how to cancel, once. */}
        <span className="sr-only composer-resposta-anuncio" aria-live="polite">
          {resposta ? strings.respostas.anuncio(resposta.nome) : ""}
        </span>
        {/* The reply bar, stuck on top of everything, like in Discord. */}
        {resposta && (
          <div className="composer-resposta">
            <span className="composer-resposta-quem">
              {strings.respostas.aResponderA}{" "}
              <strong>
                <NomeDePessoa nome={resposta.nome} endereco={resposta.autor} />
              </strong>
            </span>
            {resposta.autor !== eu && onAlternarMencao && (
              <button
                type="button"
                className="composer-resposta-mencao"
                aria-pressed={resposta.mencionar}
                title={resposta.mencionar ? strings.respostas.mencionarLigado : strings.respostas.mencionarDesligado}
                onClick={() => {
                  onAlternarMencao()
                  field.current?.focus()
                }}
              >
                {strings.respostas.mencionar}
              </button>
            )}
            {onCancelarResposta && (
              <button
                type="button"
                className="composer-resposta-cancelar"
                aria-label={strings.respostas.cancelar}
                title={strings.respostas.cancelar}
                onClick={() => {
                  onCancelarResposta()
                  field.current?.focus()
                }}
              >
                <CloseIcon size={14} />
              </button>
            )}
          </div>
        )}
        {/* Everything that goes with the text lives above the text line, so the
            box does not shrink and the message can still be read in one go. */}
        {(images.length > 0 ||
          files.length > 0 ||
          ocupada ||
          parado ||
          notaOffline ||
          aviso ||
          nota ||
          reducao ||
          (endereco && endereco !== dispensado)) && (
          <div className="composer-extras">
            {images.length > 0 && (
              <ul className="composer-images">
                {images.map((image, index) => (
                  <li key={index}>
                    <img src={image.dataUrl} alt={image.name} />
                    <button
                      type="button"
                      title={strings.common.remove}
                      aria-label={strings.chat.imageDrop(image.name)}
                      onClick={() => setImages((atuais) => atuais.filter((_, i) => i !== index))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {/* The files, in cards with what you need to know before
                sending: what it is (the extension), the name, and how big it is. No
                thumbnail, a PDF does not have one, and making up a generic
                page icon just wastes space saying "this is a file", which the
                whole line already says. */}
            {files.length > 0 && (
              <ul className="composer-files">
                {files.map((file, index) => {
                  const nome = nomeSeguro(file.name)
                  return (
                    <li key={index}>
                      <span className="file-mark" aria-hidden="true">
                        {extensaoDe(nome) || "?"}
                      </span>
                      <span className="file-text">
                        <bdi className="file-name">{nome}</bdi>
                        <span className="file-meta">{formatarBytes(file.bytes)}</span>
                      </span>
                      <button
                        type="button"
                        title={strings.common.remove}
                        aria-label={strings.chat.fileDrop(nome)}
                        onClick={() => setFiles((atuais) => atuais.filter((_, i) => i !== index))}
                      >
                        ×
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {aComprimir && <p className="field-note">{strings.chat.imageCompressing}</p>}
            {aLer && <p className="field-note">{strings.chat.fileReading}</p>}
            {/* No `warn`: shrinking a photo is not a problem. */}
            {reducao && <p className="field-note">{reducao}</p>}
            {/* In full and not just in the box text: at 375px the box shows
                about fifteen characters, and this sentence is what tells the user what to do. */}
            {parado && <p className="field-note warn">{strings.connection.separadorParado}</p>}
            {notaOffline && !parado && <p className="field-note">{strings.connection.anexosOffline}</p>}
            {nota && (
              <p className="field-note" role="status">
                {nota}
              </p>
            )}
            {aviso && (
              <p className="field-note warn">
                <TextoDeErro texto={aviso} />
              </p>
            )}
            {endereco && endereco !== dispensado && (
              <LinkAttach
                url={endereco}
                card={card}
                onChange={setCard}
                onDismiss={() => {
                  setCard(null)
                  setDispensado(endereco)
                }}
              />
            )}
          </div>
        )}

        <div className="composer-line">
          {/* Grows up from the text line, which sits at the bottom:
              a list that dropped from here would be off screen. */}
          {aSugerir && (
            <MentionPicker
              candidatos={sugestoes}
              escolhido={escolhido}
              directory={directory}
              presenceFor={presenceFor}
              emChamada={emChamada}
              onEscolher={escolherMencao}
              onApontar={setEscolhido}
            />
          )}
          {/* The commands, on the same card as mentions and with the same classes:
              the same list, with something else inside it. */}
          {aSugerirComando && (
            <ul className="mention-picker comandos-da-barra" role="listbox" aria-label={strings.barra.lista}>
              {comandos.map((comando, indice) => (
                <li key={comando.nome}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={indice === comandoEscolhido}
                    className={indice === comandoEscolhido ? "mention-option escolhido" : "mention-option"}
                    // `mousedown` not `click`: `click` comes after the
                    // box loses focus, and the cursor would land outside it.
                    onMouseDown={(event) => {
                      event.preventDefault()
                      escolherComando(comando)
                    }}
                    onMouseEnter={() => setComandoEscolhido(indice)}
                  >
                    <span className="mention-name">/{comando.nome}</span>
                    <span className="mention-name field-note">{strings.barra.descricao[comando.nome]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* An icon instead of words: the text box is narrow, and the
              accessible label says what the drawing cannot fit in.
              IT IS THE SAME ICON AS THE FEED, at the same size. Adding an
              image is the same gesture on both sides of the app; two
              nearly identical drawings for the same gesture make the user stop and compare them,
              hunting for a difference that does not exist. */}
          {/*
            The two file input fields, hidden and triggered by reference.

            They used to be inside visible `<label>` tags, which is the simplest way to
            open them. They no longer fit: at 390px the line had four buttons
            plus the text box and busted. Now the `+` menu opens them, and a menu
            item cannot be a `<label>`, so we use `.click()`
            on the reference, which does exactly what clicking the label does.

            They stay in the form and not inside the menu on purpose: a menu that
            dismounts when closed would take the field with it, and `change`
            would arrive at an element that no longer exists.
          */}
          <input
            ref={campoImagens}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            multiple
            hidden
            disabled={offline || ocupada}
            onChange={(event) => {
              escolherImagens([...(event.target.files ?? [])])
              event.target.value = ""
            }}
          />
          {/* The attachment button, next to the photo icon, owner request, and in the right order:
              the image is the everyday gesture and goes first.

              NO `accept`: any file works, and a list of types here
              only hid legitimate formats behind an "all files"
              the user had to discover. What decides is not the type, it is the
              size, and that is checked properly in `escolherFicheiros`.

              The label shows the absolute limit. With the message already carrying things
              the real number is smaller, and rejection is what says it, but someone
              who hovers here before choosing deserves to know the
              order of magnitude without having to try. */}
          <input
            ref={campoFicheiros}
            type="file"
            multiple
            hidden
            disabled={offline || ocupada}
            onChange={(event) => {
              void escolherFicheiros([...(event.target.files ?? [])])
              event.target.value = ""
            }}
          />

          {/*
            The `+`, which brings together the three gestures that are not typing.

            At 390px the line had emoji, image, attachment, send and the box,
            and it busted. Of the three layouts tested, the owner chose this one on
            August 12, 2026: the box stays wide and the two buttons used
            all the time stay out, and what is rarer moves to a click away.

            The menu is the standard `ContextMenu`, not a new design: it brings
            positioning, `Escape`, close on capture and arrow keys. Anchored
            to the top of the button, which is where `ContextMenu` counts from,
            see what that already cost on the account card.
          */}
          <button
            ref={botaoMais}
            type="button"
            className="composer-attach"
            disabled={ocupada}
            title={offline ? strings.connection.anexosOffline : strings.chat.moreActions}
            aria-label={strings.chat.moreActions}
            aria-expanded={maisAberto !== null}
            onClick={() => {
              if (offline) {
                setPediuAnexoOffline(true)
                return
              }
              const caixa = botaoMais.current?.getBoundingClientRect()
              if (!caixa) return
              setMaisAberto({ x: caixa.left, y: caixa.top })
            }}
          >
            <PlusIcon size={17} />
          </button>
          <input
            ref={field}
            value={value}
            disabled={parado}
            placeholder={
              parado
                ? strings.connection.separadorParado
                : offline
                  ? strings.connection.composerEspera
                  : strings.chat.composerPlaceholder
            }
            role={aSugerir || aSugerirComando ? "combobox" : undefined}
            aria-expanded={aSugerir || aSugerirComando}
            aria-autocomplete="list"
            onChange={(event) => {
              onChange(event.target.value)
              reavaliarMencao(event.target.value, event.target.selectionStart ?? event.target.value.length)
              setComandoEscolhido(0)
              setNota(null)
              // Outside a command, the dismissed list can come back next time.
              if (!event.target.value.startsWith("/")) setComandosDispensados(false)
              // Never offline: a signal that cannot go out is not worth the error.
              if (!offline) onTyping?.()
            }}
            // The cursor moved with arrows or mouse also changes which mention
            // is current: without this, moving back to fix a name already
            // typed would not reopen any suggestion.
            onSelect={(event) => {
              const node = event.currentTarget
              if (!aSugerir) reavaliarMencao(node.value, node.selectionStart ?? node.value.length)
            }}
            onPaste={colar}
            onKeyDown={(event) => {
              // Formatting first, and only it needs to come first: it always takes Cmd/Ctrl,
              // so it never fights a key with the suggestions menu, which uses arrows, Enter, Tab and Escape.
              if (formatar(event)) return
              /*
                The list of commands, with the mentions menu keyboard: arrow keys to
                navigate, Enter or Tab to select, Escape to close without changing
                the text. Only when the mentions menu is not open.
              */
              if (aSugerirComando) {
                if (event.key === "Escape") {
                  event.preventDefault()
                  event.stopPropagation()
                  setComandosDispensados(true)
                  return
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault()
                  setComandoEscolhido((atual) => (atual + 1) % comandos.length)
                  return
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault()
                  setComandoEscolhido((atual) => (atual - 1 + comandos.length) % comandos.length)
                  return
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  const comando = comandos[comandoEscolhido]
                  if (!comando) return
                  event.preventDefault()
                  escolherComando(comando)
                }
                return
              }
              if (!aSugerir) {
                // Without the list open, Esc cancels the reply, like in Discord.
                // With the list open, Esc belongs to it (closes it), and the reply stays.
                if (event.key === "Escape" && resposta && onCancelarResposta) {
                  event.preventDefault()
                  event.stopPropagation()
                  onCancelarResposta()
                }
                return
              }
              /**
               * With the menu open, the keyboard is its own. Only the keys it uses.
               *
               * Escape CLOSES THE MENU AND DELETES NOTHING: it is the key you press
               * when the menu is in the way, and an Escape that cleared the
               * text below it would be the worst trade-off in the entire app.
               * So we store which mention was dismissed instead of changing the text.
               */
              if (event.key === "Escape") {
                event.preventDefault()
                event.stopPropagation()
                setDispensada(mencao?.inicio ?? null)
                return
              }
              if (event.key === "ArrowDown") {
                event.preventDefault()
                setEscolhido((atual) => (atual + 1) % sugestoes.length)
                return
              }
              if (event.key === "ArrowUp") {
                event.preventDefault()
                setEscolhido((atual) => (atual - 1 + sugestoes.length) % sugestoes.length)
                return
              }
              // Enter and Tab select. Without `preventDefault`, Enter would reach
              // the form and send the message while naming someone.
              if (event.key === "Enter" || event.key === "Tab") {
                const candidato = sugestoes[escolhido]
                if (!candidato) return
                event.preventDefault()
                escolherMencao(candidato)
              }
            }}
            autoComplete="off"
          />
          {/* A drawn face, not a `🙂`. See `SmileyIcon`: the emoji came
              from the system font, with its own metrics and color, and that is why
              it was misaligned next to the others in this row. */}
          <button
            type="button"
            className="composer-emoji"
            title={strings.emoji.open}
            aria-label={strings.emoji.open}
            aria-expanded={picking}
            onClick={() => setPicking(true)}
          >
            <SmileyIcon size={17} />
          </button>
          {/* The counter, only near the limit: from 1800 it shows how many are left,
              and turns red when it goes over. See `MENSAGEM_MAX_CARACTERES`. */}
          {value.length >= CONTADOR_A_PARTIR_DE && (
            <span
              className={value.length > MENSAGEM_MAX_CARACTERES ? "composer-contador passou" : "composer-contador"}
              aria-live="polite"
            >
              {MENSAGEM_MAX_CARACTERES - value.length}
            </span>
          )}
          {/* On the phone the button drops its word and keeps the plane, so the
              text box gets the room (1.3.6). The word stays in the DOM, the
              `.sr-only` way: it is the button's name. See `.composer-enviar`. */}
          <Button
            type="submit"
            variant="primary"
            className="composer-enviar"
            disabled={parado || vazio || ocupada || anexosSemLigacao || value.trim().length > MENSAGEM_MAX_CARACTERES}
          >
            <EnviarIcon size={18} />
            <span className="composer-enviar-texto">{strings.chat.send}</span>
          </Button>
        </div>
      </form>

      {/*
        Outside the <form>, like the emoji picker and for the same reason: the menu is
        made of buttons, and a button inside a form submits it.
      */}
      {maisAberto && (
        <ContextMenu
          at={maisAberto}
          onClose={() => setMaisAberto(null)}
          items={[
            { label: strings.chat.imageAdd, onSelect: () => campoImagens.current?.click() },
            {
              label: `${strings.chat.fileAdd} (máx. ${formatarBytes(FICHEIRO_MAX_BYTES)})`,
              onSelect: () => campoFicheiros.current?.click(),
            },
            // The poll, next to the other two actions that are not writing.
            // It follows `onVotacao` by the same rule as the nudge: if the caller
            // does not provide it, the input does not appear.
            ...(onVotacao && MOSTRAR_VOTACOES ? [{ label: strings.votacao.criar, onSelect: onVotacao }] : []),
            /*
              The nudge only exists where it makes sense, in one-on-one chats -,
              and that is why the input follows `onBuzz`. The wait time goes in the label
              instead of the input disappearing: an option that vanishes and reappears on its own
              makes people doubt what they saw, and `useBuzz` refuses anyway if the time
              has not come yet.
            */
            ...(onBuzz && MOSTRAR_COTOVELADA
              ? [
                  {
                    label: buzzCooldown > 0 ? strings.chat.buzzMenuWait(buzzCooldown) : strings.chat.buzz,
                    separatorBefore: true,
                    onSelect: onBuzz,
                  },
                ]
              : []),
          ]}
        />
      )}
      {/* Outside the <form>: the picker is made of buttons, and a button inside a
          form submits it. There is no way to get it wrong here. */}
      {picking && <EmojiPicker onPick={insert} onClose={() => setPicking(false)} />}
    </>
  )
}
