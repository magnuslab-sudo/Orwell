import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { copiarTexto } from "../../lib/copiar.js"
import { RichText } from "../../components/RichText.js"
import type { Profile } from "../../bridge.js"
import type { ChatMessage, MediaItem } from "../../types.js"
import type { OutboxEntry } from "../../hooks/useOutbox.js"
import { Avatar } from "../../components/Avatar.js"
import { DistintivoDeEmbaixador } from "../../components/DistintivoDeEmbaixador.js"
import { NomeComApelido } from "../../components/NomeComApelido.js"
import { EmptyState } from "../../components/EmptyState.js"
import { FileAttachments, separarAnexos } from "../../components/FileAttachments.js"
import { AnexosDoItem } from "../../components/AnexoAPedido.js"
import { Lightbox } from "../../components/Lightbox.js"
import { PostImages } from "../../components/PostImages.js"
import { useToast } from "../../components/Toast.js"
import { CopyIcon, MoreIcon, PinIcon, ResponderIcon } from "../../icons.js"
import { chaveDe, usePorLer } from "../../hooks/usePorLer.js"
import { useToqueLongo } from "../../hooks/useToqueLongo.js"
import { useDeslizarParaResponder } from "../../hooks/useDeslizarParaResponder.js"
import { formatTime, nomeEmFalta } from "../../lib/format.js"
import { isNearBottom, prefersReducedMotion } from "../../lib/scroll.js"
import { strings } from "../../strings.js"
import { LinkPreview } from "../social/LinkPreview.js"
import { PedidoCard } from "./PedidoCard.js"
import { vazioDaConversa } from "./vazioDaConversa.js"
import { FraseDoMomento } from "../../components/FraseDoMomento.js"
import { Votacao } from "../../components/Votacao.js"
import { votacaoDe, type Apuramento } from "../../lib/votacoes.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"
import { podeResponder, resumoDoOriginal, type Citacao } from "../../lib/respostas.js"

/** A key pressed in a field is not a shortcut: R for "reply" only counts outside them. */
function emCampoDeTexto(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return false
  return alvo.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName)
}

/**
 * One confirmed message, memoized: appending a message re-renders the timeline,
 * and without this every existing row re-renders with it — in a 400-message
 * channel that is 399 wasted renders per arrival.
 *
 * The props are chosen for stability, which is what makes the memo effective:
 * `authorName` is a resolved string rather than the `nameFor` closure (whose
 * identity changes with every directory rebuild), and `profile` is the entry
 * from the directory map (payload references, stable per profile version) — not
 * the map itself, whose identity changes on any message.
 */
export const MessageRow = memo(function MessageRow({
  message,
  grouped,
  fixada = false,
  destacada = false,
  authorName,
  apelido,
  profile,
  mentionNames,
  onMention,
  onOpenAuthor,
  onOpenImage,
  onMessageMenu,
  pedido,
  pedidoOcupado = false,
  onPedidoResposta,
  apuramento,
  onVotar,
  nameFor,
  presence,
  emChamada = false,
  onResponder,
  citacaoEstado,
  citacaoAutor,
  citacaoNome,
  citacaoTexto,
  citacaoPerfil,
  onIrParaOriginal,
}: {
  message: ChatMessage
  /** Same sender, shortly after the previous message: no name, no avatar. */
  grouped: boolean
  /**
   * Whether this message is pinned in the room.
   *
   * A boolean, not the list of pinned messages or a function to check it, for
   * the reason the memo comment gives: this line's props must be comparable by
   * VALUE. The list changes identity each time something is pinned and forced
   * four hundred lines to re-render because of one.
   */
  fixada?: boolean | undefined
  /**
   * This is the line we just jumped to.
   *
   * A boolean, like `fixada` and for the same reason: this line's props must be
   * comparable by VALUE, or the memo that saves 399 re-renders per arriving
   * message stops working.
   */
  destacada?: boolean | undefined
  authorName: string
  /** The member's alias in this channel (phase 3), before the name. A string, for the memo. */
  apelido?: string | undefined
  profile: Profile | undefined
  /**
   * The request card for this line, already resolved by the shell.
   *
   * Arrives in simple values, three strings and a boolean, not in maps or
   * closures, for the same reason `mentionNames` is a string: this line's props
   * must be comparable by VALUE, or the memo that saves 399 re-renders per
   * arriving message stops working.
   */
  pedido?: { titulo: string; estado: string; aceitar: string; recusar: string; respondivel: boolean } | undefined
  pedidoOcupado?: boolean | undefined
  /** Stable by construction, see `Timeline`. Without it the memo breaks anyway. */
  onPedidoResposta?: ((message: ChatMessage, aceitar: boolean) => void) | undefined
  /**
   * The tally of this poll, if the line is one.
   *
   * Already counted from the shell, not calculated here: votes are events of the
   * entire channel and this line only knows the message. It comes from a memoized
   * map higher up, so identity only changes when votes change, which is exactly
   * when this line must re-render. See the memo.
   */
  apuramento?: Apuramento | undefined
  /** Vote. Stable by construction, like the others. */
  onVotar?: ((message: ChatMessage, opcao: number) => void) | undefined
  /** Who is who, for the names of those who voted. Stable by construction. */
  nameFor?: ((address: string) => string) | undefined
  /**
   * The state of who wrote it, for the face ring, and whether they are in a call.
   *
   * Values, not the `presenceFor` function, for the memo reason: the function
   * changes identity each arriving message (derived presence reads the thread),
   * and re-rendered four hundred lines. A string and a boolean only change when
   * the person changes state.
   */
  presence?: "active" | "away" | "busy" | "idle" | undefined
  emChamada?: boolean | undefined
  /**
   * The names of those mentioned, in the order of `payload.mentions` and
   * separated by null byte.
   *
   * A string, not a map, precisely for the reason the comment above gives: this
   * line's props must be comparable by VALUE. A map (or `nameFor`) brought fresh
   * identity each message arriving on the channel, the directory is rebuilt each
   * time, and the memo stopped working, same as re-rendering the whole
   * conversation per sentence.
   *
   * This way the line only re-renders when one of the mentioned names actually
   * CHANGES, which is exactly when it must re-render.
   */
  mentionNames?: string | undefined
  /** Stable by construction, see `Timeline`. Without it the memo breaks anyway. */
  onMention?: ((address: string) => void) | undefined
  /**
   * Open the page of who wrote it, by face or by name. Stable, like `onMention`:
   * a fresh prop per render would kill this line's memo. Absent, face and name
   * stay text.
   */
  onOpenAuthor?: ((address: string) => void) | undefined
  /** Open an image full size. Stable by construction, like the others. */
  onOpenImage?: ((item: MediaItem) => void) | undefined
  /**
   * The menu for the message itself, opened with the right button.
   *
   * Absent is absent: without it there is no menu, and this is how other
   * people's messages end up without one. `Timeline` decides whether this line
   * gets it, it knows who wrote what; this line does not repeat the rule.
   */
  onMessageMenu?: ((at: { x: number; y: number }) => void) | undefined
  /**
   * Reply to this message: the action bar button, the R key, and swipe left.
   * Stable by design, like the others; absent when the line offers no reply
   * (see `podeResponder`).
   */
  onResponder?: ((message: ChatMessage) => void) | undefined
  /**
   * The quote line, when this message is a reply.
   *
   * Simple values, not an object, because of memoization: a new object by
   * design would redraw all replies on each incoming message. `citacaoTexto`
   * comes resolved (the text start, "Image", or the file name); `citacaoNome`
   * is the current name of who wrote the original.
   */
  citacaoEstado?: Citacao["estado"] | undefined
  citacaoAutor?: string | undefined
  citacaoNome?: string | undefined
  citacaoTexto?: string | undefined
  citacaoPerfil?: Profile | undefined
  /** Jump to the original via the quote. Stable by design. */
  onIrParaOriginal?: ((id: string) => void) | undefined
}): React.JSX.Element {
  const toast = useToast()
  /* Reply by touch: swipe the line left. See the hook. */
  const responderAqui = onResponder ? () => onResponder(message) : undefined
  const deslize = useDeslizarParaResponder(responderAqui)
  /* The same menu, with the finger down. See `useToqueLongo`. */
  const aoDedo = useToqueLongo()

  /**
   * Images on one side, files on the other.
   *
   * Memoized with the rest of the line: the split walks the attachment list,
   * and this line redraws on each incoming message if the memo fails.
   * `separarAnexos` divides by `mediaType`, not by `kind`, the reason is
   * there, and the vault explains it.
   */
  const { imagens, ficheiros } = useMemo(
    () => separarAnexos(message.payload.attachments ?? []),
    [message.payload.attachments],
  )

  /**
   * The poll this line carries, if it carries a readable one.
   *
   * `null` when there is none, and also when what arrived is not drawable, a
   * poll from a future version this client could not read. In that case the
   * line draws the text, which has the question and options in full: that is
   * why the body is written this way. See `corpoDaVotacao`.
   */
  const votacao = useMemo(() => votacaoDe(message.payload), [message.payload])

  /** The context of attachments on demand (S5). Memoized: a new object by design would redraw the grid. */
  const anexosDoItem = useMemo(
    () => ({ channel: message.channel, alvo: message.payload.id ?? "", lista: message.payload.attachments ?? [] }),
    [message.channel, message.payload.id, message.payload.attachments],
  )

  /** Address → current name, rebuilt from the two parallel lists. */
  const nomeDeMencao = useMemo(() => {
    const enderecos = message.payload.mentions ?? []
    if (enderecos.length === 0) return undefined
    // Null byte as separator, not space: "Ana Rita" is one name, and splitting
    // on space would break it into two people that do not exist.
    const nomes = (mentionNames ?? "").split("\u0000")
    const mapa = new Map(enderecos.map((endereco, indice) => [endereco, nomes[indice] ?? ""]))
    // The address word, quiet, not the full address: see `nomeEmFalta`.
    return (endereco: string): string => mapa.get(endereco) || nomeEmFalta(endereco)
  }, [message.payload.mentions, mentionNames])
  return (
    <article
      className={`${grouped ? "message grouped" : "message"}${destacada ? " destacada" : ""}${deslize.deslocamento ? " a-deslizar" : ""}`}
      /* The line we jumped to gets focus (see `Timeline`), and only that one:
         with focus on each line, a click to read removed it from the box. */
      tabIndex={destacada ? -1 : undefined}
      style={deslize.deslocamento ? { transform: `translateX(${deslize.deslocamento}px)` } : undefined}
      /* R with the message focused (or one of its buttons), like in Discord.
         No modifiers: Ctrl+R and Cmd+R belong to the browser. */
      onKeyDown={
        responderAqui
          ? (event) => {
              if (event.key !== "r" && event.key !== "R") return
              if (event.ctrlKey || event.metaKey || event.altKey || emCampoDeTexto(event.target)) return
              event.preventDefault()
              responderAqui()
            }
          : undefined
      }
      {...deslize.props}
      /*
        The message identifier, written on the element.

        The jump finds the line through this, and on purpose it is not an `id`
        nor a selector built from the value: an identifier comes from a payload
        another person wrote, and passing it to `querySelector` would let them
        write a selector. Here `Timeline` searches for `.message`, which is
        constant, and compares this attribute in JavaScript.
      */
      data-mensagem={message.payload.id}
      /* Only on own messages, and `Timeline` decides that when delivering (or
         not) the `onMessageMenu`. No menu, right-click does the system one,
         which is what someone expects when they want to copy text. */
      onContextMenu={
        onMessageMenu
          ? (event) => {
              event.preventDefault()
              onMessageMenu({ x: event.clientX, y: event.clientY })
            }
          : undefined
      }
      {...aoDedo(onMessageMenu)}
    >
      {/* The pinned badge, in the top right corner.

          First in the DOM, not last, despite floating: someone listening to the
          conversation instead of reading it gets "pinned in this room" BEFORE
          the name and text, which is where the information matters. After the
          body would have been a footnote to a sentence already read.

          The pin does not catch the mouse (see the CSS): right-click over this
          area still opens the message menu, which is where you unpin. */}
      {fixada && (
        <span className="message-fixada" role="img" aria-label={strings.chat.pinnedMark}>
          <PinIcon size={12} />
        </span>
      )}
      {grouped ? (
        <span className="message-gutter">{formatTime(message.payload.sentAt)}</span>
      ) : onOpenAuthor ? (
        /* The face opens the person's profile, for mouse and touch only: keyboard
           and screen reader reach it through the name, which is the same action
           with words. */
        <button
          type="button"
          className="message-avatar-botao"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => onOpenAuthor(message.sender)}
        >
          <Avatar profile={profile} fallback={message.sender[1] ?? "?"} presence={presence} emChamada={emChamada} />
        </button>
      ) : (
        <Avatar profile={profile} fallback={message.sender[1] ?? "?"} presence={presence} emChamada={emChamada} />
      )}
      <div className="message-body">
        {/* The original's quote, on top of everything: it is the context for the
            phrase. Only the immediate original, no trees, like in Discord.
            See `lib/respostas.ts`. */}
        {message.payload.replyTo !== undefined && citacaoEstado !== undefined && (
          <LinhaDeCitacao
            id={message.payload.replyTo}
            estado={citacaoEstado}
            autor={citacaoAutor}
            nome={citacaoNome ?? ""}
            texto={citacaoTexto ?? ""}
            perfil={citacaoPerfil}
            onIr={onIrParaOriginal}
          />
        )}
        {!grouped && (
          <header>
            {onOpenAuthor ? (
              <button
                type="button"
                className="author author-botao"
                title={strings.personProfile.openHint(authorName)}
                onClick={() => onOpenAuthor(message.sender)}
              >
                <NomeComApelido nome={authorName} apelido={apelido} endereco={message.sender} />
                <DistintivoDeEmbaixador address={message.sender} />
              </button>
            ) : (
              <span className="author" title={message.sender}>
                <NomeComApelido nome={authorName} apelido={apelido} endereco={message.sender} />
                <DistintivoDeEmbaixador address={message.sender} />
              </span>
            )}
            <time>{formatTime(message.payload.sentAt)}</time>
          </header>
        )}
        {/* Rendered as text, never as markup. A message is data. */}
        {/* A message with only an image does not draw an empty paragraph taking up
a line.

And a drawn poll does not repeat the body: the body IS the poll
written in full, and it exists for those who cannot draw it. Those
who draw it read it once. If the poll is not readable, the text
stays, that is why it travels. */}
        {/* Removed by moderation (phase 3): the line stays, the text does not. The
            fold already removed the content; this says why, in its place. */}
        {message.payload.moderada === true && <p className="message-moderada">{strings.chat.messageModerated}</p>}
        {(message.payload.body ?? "") !== "" && !votacao && (
          <p>
            <RichText nameFor={nomeDeMencao} onMention={onMention}>
              {message.payload.body ?? ""}
            </RichText>
            {/* The badge stays always, with no edit window: what you gain by fixing a
                typo you cannot pay with a conversation that changes under
                someone who already read it. Owner decision on August 12, 2026. */}
            {message.payload.editedAt !== undefined && (
              <span className="message-edited" title={strings.social.edited(formatTime(message.payload.editedAt))}>
                {strings.chat.editedMark}
              </span>
            )}
          </p>
        )}

        {/* The poll, when the message is one. Without `onVotar` (old host, or low
            connection) the card reads and you cannot vote.

            Without `nameFor` the resource is `nomeEmFalta`, like everywhere:
            it was `(address) => address`, and anyone opening the vote list for
            an option would read full addresses instead of names. */}
        {votacao && (
          <Votacao
            votacao={votacao}
            apuramento={apuramento ?? { porOpcao: votacao.options.map(() => []), total: 0, minha: null }}
            nameFor={nameFor ?? nomeEmFalta}
            {...(onVotar ? { onVote: (opcao: number) => onVotar(message, opcao) } : {})}
          />
        )}

        {/*
          The attachments came inside the encrypted text, not from an address.

          Reuses the feed grid instead of having a second one: they are the same
          thing on the wire, and two grids would end up diverging the day one of
          them learned to handle bytes dumped from the vault.

          `onOpen` is what was missing here: without it `PostImages` draws the
          images and nothing else, and that is why they opened in the feed and
          not in the conversation. A dumped image still does not become a button
          , `PostImages` handles that before reaching `onOpen`, and opening what
          no longer exists was worse than not offering it.
        */}
        {/* Which message these attachments belong to: to request them from other members when missing (S5). */}
        <AnexosDoItem.Provider value={anexosDoItem}>
          {imagens.length > 0 && (
            <div className="message-media">
              <PostImages media={imagens} onOpen={onOpenImage} />
            </div>
          )}

          {/* And what is not an image: one line per file, with a button to save.
              Nothing opens here, see `FileAttachments`. */}
          <FileAttachments files={ficheiros} />
        </AnexosDoItem.Provider>

        {/*
          The card was composed by the sender, and is drawn from bytes already
          here. NOTHING here goes and fetches anything from the site: if it did,
          the link owner would know who opened this conversation and when,           without anyone having clicked anything.
          */}
        {message.payload.links?.map((link, index) => <LinkPreview key={index} link={link} />)}

        {/* The invite, or the friend request, with the reply next to where it
            arrived. See `PedidoCard`. */}
        {pedido && (
          <PedidoCard
            titulo={pedido.titulo}
            estado={pedido.estado}
            aceitar={pedido.aceitar}
            recusar={pedido.recusar}
            ocupado={pedidoOcupado}
            {...(pedido.respondivel && onPedidoResposta
              ? {
                  onAceitar: () => onPedidoResposta(message, true),
                  onRecusar: () => onPedidoResposta(message, false),
                }
              : {})}
          />
        )}
      </div>

      {/* Quiet actions, surfaced on hover or keyboard focus. Only what the app
          can honestly do today: no placeholder buttons.

          Copy, and the "..." that opens the message menu. Without it, pinning,
          editing and deleting were only found by those who knew about right-click.
          A line with no body has no text to copy: a friend request is an action,
          not a phrase. */}
      {/* The tips for these buttons grow INWARD (`data-tip-side="end"`). Centered,
          the one on the end button passed half beyond the right edge of the
          conversation: invisible but wide, and the conversation gained 53 px in
          width and a horizontal scroll bar above the input box, which on Windows
          never hides (owner report, 11/4/2026). See `[data-tip-side="end"]`
          in `components.css`. */}
      {((message.payload.body ?? "") !== "" || onMessageMenu || responderAqui) && (
        <div className="msg-actions">
          {responderAqui && (
            <button
              type="button"
              data-tip={strings.respostas.responder}
              data-tip-side="end"
              aria-label={strings.respostas.responder}
              aria-keyshortcuts="R"
              onClick={responderAqui}
            >
              <ResponderIcon size={14} />
            </button>
          )}
          {(message.payload.body ?? "") !== "" && (
            <button
              type="button"
              data-tip={strings.chat.copyText}
              data-tip-side="end"
              aria-label={strings.chat.copyText}
              onClick={() => {
                void copiarTexto(message.payload.body ?? "")
                  .then(() => toast(strings.chat.textCopied))
                  .catch(() => toast(strings.common.copyFailed, "error"))
              }}
            >
              <CopyIcon size={14} />
            </button>
          )}
          {onMessageMenu && (
            <button
              type="button"
              data-tip={strings.chat.messageMore}
              data-tip-side="end"
              aria-label={strings.chat.messageMore}
              aria-haspopup="menu"
              onClick={(event) => {
                const caixa = event.currentTarget.getBoundingClientRect()
                onMessageMenu({ x: caixa.left, y: caixa.bottom + 4 })
              }}
            >
              <MoreIcon size={14} />
            </button>
          )}
        </div>
      )}
    </article>
  )
})

/**
 * The quote line of a reply.
 *
 * A button when there is somewhere to go: the original in the conversation,
 * or the history to load. The label says where it goes ("Go to Bruno's message"),
 * not the quoted text, which the screen reader reads next in the reply itself.
 * When the original was deleted or is not on this device, it is a phrase,
 * not a button: there is nowhere to go.
 */
function LinhaDeCitacao({
  id,
  estado,
  autor,
  nome,
  texto,
  perfil,
  onIr,
}: {
  id: string
  estado: Citacao["estado"]
  autor: string | undefined
  nome: string
  texto: string
  perfil: Profile | undefined
  onIr: ((id: string) => void) | undefined
}): React.JSX.Element {
  if (estado === "apagada" || estado === "ausente" || !onIr) {
    return (
      <p className="message-citacao message-citacao-falta">
        {estado === "apagada" ? strings.respostas.apagada : estado === "ausente" ? strings.respostas.ausente : texto}
      </p>
    )
  }
  if (estado === "por-carregar") {
    return (
      <button type="button" className="message-citacao message-citacao-falta" onClick={() => onIr(id)}>
        {strings.respostas.porCarregar}
      </button>
    )
  }
  return (
    <button type="button" className="message-citacao" aria-label={strings.respostas.irPara(nome)} onClick={() => onIr(id)}>
      <span className="message-citacao-cara" aria-hidden="true">
        <Avatar profile={perfil} fallback={autor?.[1] ?? "?"} />
      </span>
      <span className="message-citacao-nome">
        <NomeDePessoa nome={nome} endereco={autor} />
      </span>
      <span className="message-citacao-texto">{texto}</span>
    </button>
  )
}

export function Timeline({
  channel,
  conversa,
  messages,
  pending,
  onRetry,
  onDiscard,
  me,
  onMessageMenu,
  podeMenuAlheio = false,
  temMenu,
  nameFor,
  apelidoDe,
  directory,
  hasStoredHistory = false,
  canLoadOlder = false,
  onLoadOlder,
  typists = [],
  onOpenProfile,
  pedidoDe,
  pedidoOcupado,
  onPedidoResposta,
  apuramentos,
  onVotar,
  fixadas,
  destacada = null,
  semCaixaDeEscrita = false,
  lugar = null,
  fraseDoLugar = false,
  presenceFor,
  emChamada,
  onResponder,
  citacaoDe,
  onIrParaOriginal,
}: {
  channel: string
  /**
   * Which conversation is this: the channel AND the room.
   *
   * The `channel` is not enough for scrolling. A room is a conversation with
   * its own list, and switching rooms in the same channel does not change the
   * channel: without this the switch looked like "new messages arrived", and
   * the list scrolled from top to bottom in front of whoever clicked (owner
   * report, 11/4/2026). It is also the key for the saved position, which was
   * one for the entire channel.
   *
   * Absent, defaults to the channel: a direct has no rooms.
   */
  conversa?: string | undefined
  /**
   * This device's first place in the channel (S5, §2.5): the Welcome `seq`
   * and time. The conversation carries the "You entered here" marker at that
   * point. Null for whoever created the channel and for a channel from before
   * this version: you do not mark what you do not know.
   */
  lugar?: { seq: number; em: number } | null | undefined
  /**
   * This conversation has no input bar right now.
   *
   * Only changes the empty phrase, so it does not point to a box that is not
   * there. Who decides if there is input is the shell, as it decides the lock:
   * this screen does not know what a friend request is and does not need to.
   */
  semCaixaDeEscrita?: boolean | undefined
  /**
   * This conversation is a channel, not a direct (phase 6, layer 1).
   *
   * With a `place` and the new conversation, empty says once "You see the
   * conversation from now on...". Only in a channel: that is where someone
   * enters a conversation already underway. Whoever created the channel has no
   * place, and does not see it.
   */
  fraseDoLugar?: boolean | undefined
  /**
   * The state of each person, for the face ring. Absent: faces have no ring,
   * because this screen does not know the state and grey would say "offline".
   */
  presenceFor?: ((address: string) => "active" | "away" | "busy" | "idle") | undefined
  /** Whoever is in a call or a voice room: the ring pulses. */
  emChamada?: ((address: string) => boolean) | undefined
  messages: ChatMessage[]
  /** Our own unconfirmed sends for this channel, rendered after the real ones. */
  pending: OutboxEntry[]
  onRetry: (id: string) => void
  onDiscard: (id: string) => void
  me: string | null
  /**
   * The menu for OWN messages, opened with right-click.
   *
   * The "own messages only" rule lives here, not in the line: this one knows
   * the `me`, and repeating it down there was having two copies of the same
   * decision waiting to diverge. A friend request also gets no menu, it is not
   * something said, it is an action, and there is nothing in it to edit.
   */
  onMessageMenu?: ((message: ChatMessage, at: { x: number; y: number }) => void) | undefined
  /**
   * The menu also opens on other people's messages.
   *
   * False by default, which is how this always behaved: no menu on others,
   * right-click does the system one and someone copies text. Who turns this on
   * is someone with an action to offer on another person's message, today,
   * pinning.
   */
  podeMenuAlheio?: boolean | undefined
  /**
   * Does this message have any menu entry? Whoever builds the menu knows.
   * Without an answer, the rule above applies. Both right-click and "..." decide.
   */
  temMenu?: ((message: ChatMessage) => boolean) | undefined
  nameFor: (sender: string) => string
  /** The nickname of each person in this channel (phase 3). Absent means nobody has one. */
  apelidoDe?: ((address: string) => string | undefined) | undefined
  directory: Map<string, Profile>
  /** The vault holds history for this channel; anything older is gone for good. */
  hasStoredHistory?: boolean
  /** Stored messages older than the ones shown exist and can be paged in. */
  canLoadOlder?: boolean
  onLoadOlder?: () => void
  /**
   * Who is typing now, with the name already resolved.
   *
   * Lives at the bottom of the scroller, stuck there, not as a message: a
   * typing indicator is not something said, does not enter the history, and
   * drawing it as a conversation line was the first step toward someone saving it.
   */
  typists?: string[]
  /** Click on a mention: that person's profile, which the shell draws. */
  onOpenProfile?: ((address: string) => void) | undefined
  /**
   * The request card for a line, if it is one.
   *
   * The shell knows: an invite state comes from a fold over the entire history,
   * and a friendship state from another. One of them living here would be a
   * second source of truth about who enters which channel, and those diverge
   * on the first change.
   */
  pedidoDe?:
    | ((message: ChatMessage) => { titulo: string; estado: string; aceitar: string; recusar: string; respondivel: boolean } | null)
    | undefined
  /** Who has a partial response, indexed by address. See `PedidoCard`. */
  pedidoOcupado?: string | null | undefined
  onPedidoResposta?: ((message: ChatMessage, aceitar: boolean) => void) | undefined
  /**
   * The tally for each vote in this channel, indexed by message id.
   *
   * It comes from the shell and is not calculated here, for the same reason
   * that request state comes from there: a vote is a CHANNEL event, and this
   * list only holds messages from this room. Counting here would create a
   * second source of truth about the tally, and those diverge the moment any
   * message goes missing.
   */
  apuramentos?: Map<string, Apuramento> | undefined
  /** Vote for an option in a poll on this conversation. */
  onVotar?: ((message: ChatMessage, opcao: number) => void) | undefined
  /**
   * The identifiers of what is pinned in this room.
   *
   * A set, already built from the shell: the pinned list lives there, and
   * that is where it changes. Searching an array on every drawn line would
   * scan through every message, and the conversation has four hundred.
   *
   * Absent means "nothing is pinned", which is what an unmoderated room gives.
   */
  fixadas?: ReadonlySet<string> | undefined
  /**
   * The message we just jumped to, by identifier.
   *
   * It comes from the shell and is not decided here: the search sheet jumps,
   * and it lives above, and the message may not be in this room when the jump
   * starts. Null is the normal state.
   */
  destacada?: string | null | undefined
  /**
   * Reply to a message. Absent, no line offers a reply: that is what happens
   * where there is no text box.
   */
  onResponder?: ((message: ChatMessage) => void) | undefined
  /**
   * The state of the original for each reply, by id. It comes from the shell,
   * which has all channel messages and tombstones (see `indiceDasCitacoes`).
   * Absent, replies draw as normal messages.
   */
  citacaoDe?: ((id: string) => Citacao) | undefined
  /** Jump to the original of a reply: the shell changes room and loads the history. */
  onIrParaOriginal?: ((id: string) => void) | undefined
}): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)

  /**
   * Where the marker goes: before the first message said in the location or
   * after it. With nothing, at the end. With older messages waiting to load
   * and the location before the first, we don't mark: the right spot is not
   * in view yet, and a marker at the wrong top would be a lie about where we
   * came in.
   */
  const indiceDoLugar = useMemo(() => {
    if (!lugar) return null
    // Without `seq` (a report saved without it, a send pending confirmation) it does not say where we came in: it does not count.
    const indice = messages.findIndex((message) => message.seq >= 0 && message.seq >= lugar.seq)
    if (indice === -1) return messages.length
    if (indice === 0 && canLoadOlder) return null
    return indice
  }, [lugar, messages, canLoadOlder])
  const marcaDoLugar = lugar ? (
    <div className="timeline-lugar" role="note" data-lugar={lugar.seq}>
      <span className="timeline-lugar-texto">{strings.sincronia.lugar}</span>
      <time className="timeline-lugar-data" dateTime={new Date(lugar.em).toISOString()}>
        {strings.sincronia.lugarData(
          new Date(lugar.em).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }),
        )}
      </time>
    </div>
  ) : null

  /**
   * The same click, with an identity that never changes.
   *
   * Passing `onOpenProfile` directly to lines would give them a new prop
   * every time the shell redraws, and the memo on `MessageRow`, which exists
   * to save 399 renders per arriving message, would become worthless. The
   * reference always reads the current version, so nothing gets stuck to an
   * old function.
   */
  const abrirRef = useRef(onOpenProfile)
  abrirRef.current = onOpenProfile
  const abrirMencao = useCallback((address: string) => abrirRef.current?.(address), [])
  /** The same discipline for replying to a request, for the same reason. */
  const responderRef = useRef(onPedidoResposta)
  responderRef.current = onPedidoResposta
  const responder = useCallback(
    (message: ChatMessage, aceitar: boolean) => responderRef.current?.(message, aceitar),
    [],
  )
  /** And for voting. */
  const votarRef = useRef(onVotar)
  votarRef.current = onVotar
  const votar = useCallback((message: ChatMessage, opcao: number) => votarRef.current?.(message, opcao), [])
  /** And for replying and for jumping to the original, for the same reason. */
  const responderARef = useRef(onResponder)
  responderARef.current = onResponder
  const responderA = useCallback((message: ChatMessage) => responderARef.current?.(message), [])
  const irRef = useRef(onIrParaOriginal)
  irRef.current = onIrParaOriginal
  const irParaOriginal = useCallback((id: string) => irRef.current?.(id), [])
  /**
   * The names of who voted, via a reference that never changes.
   *
   * `nameFor` gets a new identity each time the directory rebuilds, and
   * passing it to lines killed the memo that saves 399 redraws per arriving
   * message, the same trap as `onMention`. The price, plain: a name that
   * changes only appears the next time the line redraws, and a vote line
   * redraws whenever a vote moves. For a list of who voted, it is a fair
   * trade.
   */
  const nomearRef = useRef(nameFor)
  nomearRef.current = nameFor
  const nomear = useCallback((address: string) => nomearRef.current(address), [])
  /**
   * The open image, if any.
   *
   * It lives here, not in each line: one sheet per message would be four
   * hundred sheets mounted for none to be open. The open action is a
   * `useCallback` with no dependencies, for the usual reason in this file,    * a new prop per render would kill the memo that saves 399 redraws per
   * arriving message.
   */
  const [zoom, setZoom] = useState<MediaItem | null>(null)
  const abrirImagem = useCallback((item: MediaItem) => setZoom(item), [])

  /**
   * Where we left off last time, and how many are unread since then.
   *
   * Frozen at room entry, see `usePorLer`, which explains why and why it
   * must be a layout effect.
   */
  const porLer = usePorLer(channel, messages, me)
  /** The marker line, so we can jump to it. */
  const linhaPorLer = useRef<HTMLDivElement>(null)
  /** The marker exists and is out of view: only then is the jump offered. */
  const [mostrarSalto, setMostrarSalto] = useState(false)

  /**
   * Jump to the marker, and it is a GESTURE, never automatic.
   *
   * An automatic scroll would steal control from someone who arrived and is
   * reading something else. Those who want new messages from the start can
   * tap; those who do not stay put, and the bar vanishes as soon as the
   * marker comes into view on its own.
   */
  const saltarParaPorLer = useCallback(() => {
    const alvo = linhaPorLer.current
    if (!alvo) return
    alvo.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" })
    setMostrarSalto(false)
  }, [])

  /**
   * Where each conversation was, to return to it in the same place.
   *
   * `noFundo` ranks higher than the number: whoever left the bottom returns to
   * the bottom, even if messages arrived in the meantime and the bottom is now lower.
   */
  const conversaActual = conversa ?? channel
  const positions = useRef(new Map<string, { top: number; noFundo: boolean }>())
  /**
   * The reader is stuck to the bottom: what arrives, or grows, keeps them
   * there.
   *
   * Only the reader can unstick by scrolling up. See `onScroll`: the browser
   * also moves `scrollTop` when content grows (Chrome's anchoring pushes it
   * down), and that is not anyone reading further up.
   */
  const nearBottom = useRef(true)
  /** The last `scrollTop` seen, to know if what moved was upward. */
  const ultimoTopo = useRef(0)
  const [showJump, setShowJump] = useState(false)

  const itemCount = messages.length + pending.length

  /**
   * Jump to the bottom now. No animation: the bottom may still be moving (an
   * image decoding), and an animation to a moving target ends short.
   */
  const colarAoFundo = useCallback(() => {
    const el = container.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    ultimoTopo.current = el.scrollTop
    nearBottom.current = true
    setShowJump(false)
  }, [])

  /** The gesture of the "new messages" button: here yes, it can slide. */
  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const el = container.current
    if (!el) return
    if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior })
    else el.scrollTop = el.scrollHeight
    setShowJump(false)
    nearBottom.current = true
  }, [])

  // New room or channel: restore the saved location, or the bottom. A layout
  // effect so the position is right before the browser paints the switch: the
  // room's first draw is already final.
  const shownConversa = useRef<string | null>(null)
  useLayoutEffect(() => {
    const el = container.current
    if (!el || shownConversa.current === conversaActual) return
    // The one we leave: the DOM is already the new one, so what we saw last is right.
    if (shownConversa.current !== null) {
      positions.current.set(shownConversa.current, { top: ultimoTopo.current, noFundo: nearBottom.current })
    }
    shownConversa.current = conversaActual
    const guardada = positions.current.get(conversaActual)
    el.scrollTop = guardada && !guardada.noFundo ? guardada.top : el.scrollHeight
    ultimoTopo.current = el.scrollTop
    nearBottom.current = !guardada || guardada.noFundo || isNearBottom(el)
    setShowJump(false)
  }, [conversaActual])

  // New content: follow it only if the reader was already at the bottom.
  // Someone scrolled up is reading, yanking them down would be theft; they
  // get the floating chip instead. Keyed on the *last* item, not the count:
  // paging older history in prepends, and that must not look like news.
  //
  // A layout effect, not a normal one: with a normal effect the new line would
  // paint once outside the bottom and then jump there.
  const last = messages[messages.length - 1]
  const lastKey = pending.length
    ? (pending[pending.length - 1]?.id ?? null)
    : last
      ? `${last.channel}:${last.payload.id ?? last.seq}`
      : null
  const lastSeen = useRef<{ conversa: string; count: number; lastKey: string | null } | null>(null)
  useLayoutEffect(() => {
    const previous = lastSeen.current
    lastSeen.current = { conversa: conversaActual, count: itemCount, lastKey }
    if (!previous || previous.conversa !== conversaActual || itemCount <= previous.count) return
    if (lastKey === previous.lastKey) return
    if (nearBottom.current) colarAoFundo()
    else setShowJump(true)
  }, [conversaActual, itemCount, lastKey, colarAoFundo])

  /**
   * An image just finished loading: whoever was at the bottom stays at the
   * bottom.
   *
   * Message images already reserve height (`dimensoesDaImagem`), and this is
   * the net for those we cannot read upfront: a format the header does not
   * tell, an image asked from another member that arrives later. `load` does
   * not bubble, so we listen in capture.
   */
  useEffect(() => {
    const el = container.current
    if (!el) return
    const aoCarregar = (): void => {
      if (nearBottom.current) colarAoFundo()
    }
    el.addEventListener("load", aoCarregar, true)
    return () => el.removeEventListener("load", aoCarregar, true)
  }, [colarAoFundo])

  /**
   * Is the marker out of view?
   *
   * This is the only condition for the jump bar to appear, besides having
   * unread messages. A bar offering to take us to a place already in front of
   * our eyes is noise, and it is the house rule: what cannot be used does
   * not show.
   */
  const reavaliarSalto = useCallback(() => {
    const el = container.current
    const alvo = linhaPorLer.current
    if (!el || !alvo) {
      setMostrarSalto(false)
      return
    }
    const caixa = el.getBoundingClientRect()
    const marca = alvo.getBoundingClientRect()
    setMostrarSalto(marca.bottom < caixa.top || marca.top > caixa.bottom)
  }, [])

  // After the room position is restored, and whenever the marker moves. A
  // layout effect so the bar does not flicker between draw and measure.
  useLayoutEffect(() => {
    reavaliarSalto()
  }, [conversaActual, porLer.primeira, itemCount, reavaliarSalto])

  /**
   * Go to the message we jumped to.
   *
   * **It depends on the number of lines, and that dependency is the whole
   * thing.** The in-memory conversation holds the two hundred most recent; a
   * result older than that forces the shell to fetch the rest from the vault,
   * which takes time. Without retrying when the list grows, the jump would
   * happen once over a conversation that still lacked the line, find nothing,
   * and die in silence: the sheet would close and the reader would be exactly
   * where they started.
   *
   * The search is by `.message`, a constant selector, and the identifier
   * comparison happens after in JavaScript. Building a selector with an
   * identifier that came from someone else's payload would let them write the
   * query.
   */
  /** The highlight that already got focus: the growing list will not steal it from the box. */
  const focada = useRef<string | null>(null)
  useLayoutEffect(() => {
    const el = container.current
    if (!destacada) focada.current = null
    if (!el || !destacada) return
    const alvo = [...el.querySelectorAll<HTMLElement>(".message")].find(
      (linha) => linha.dataset["mensagem"] === destacada,
    )
    /* Focus goes to the line, once per jump: the screen reader reads it, and the
       R key answers it right away. Without scrolling: the `scrollIntoView` does that. */
    if (alvo && focada.current !== destacada) {
      focada.current = destacada
      alvo.focus({ preventScroll: true })
    }
    // Stored like the `scrollTo` of `scrollToBottom`, and for a stronger reason:
    // that one runs on a click, and this runs on its own at every render where
    // there is a highlight. On a host without this function, a test DOM, an old
    // engine, what would be a button with no effect there, here would bring the
    // whole app down because of a search.
    if (!alvo || typeof alvo.scrollIntoView !== "function") return
    alvo.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" })
  }, [destacada, itemCount])

  const onScroll = useCallback(() => {
    const el = container.current
    if (!el) return
    // Only upward scrolls unstick. A `scrollTop` that goes down without reaching
    // the bottom is the browser compensating for content that grew above, and
    // whoever was stuck stays stuck, the next `load` or the next message
    // restores the bottom.
    if (isNearBottom(el)) nearBottom.current = true
    else if (el.scrollTop < ultimoTopo.current) nearBottom.current = false
    ultimoTopo.current = el.scrollTop
    if (nearBottom.current) setShowJump(false)
    reavaliarSalto()
  }, [reavaliarSalto])

  /**
   * There is not a single line in the room: neither sent nor pending.
   *
   * What is pending counts, and must count: the message not yet sent already
   * takes up the conversation, and an empty screen above it would say there is
   * nothing exactly when the reader just put something there.
   */
  const semNada = messages.length === 0 && pending.length === 0
  const porque = vazioDaConversa({
    temMensagensGuardadas: hasStoredHistory,
    podeCarregarAntigas: canLoadOlder,
  })

  return (
    <div className="timeline" ref={container} onScroll={onScroll}>
      {/*
        Jump to what is unread.

        It only exists when there really is something unread AND the marker is
        out of view, the house rule: what cannot be used does not show. Stuck
        to the top of the scroller because we go UP: new messages are at the
        end, and where we stopped reading is above them.

        Reading the number aloud is the whole point: "seven unread" says if it
        is worth going up, and "one" says no.
      */}
      {mostrarSalto && porLer.quantas > 0 && (
        <button type="button" className="timeline-unread-jump" onClick={saltarParaPorLer}>
          {strings.chat.unreadJump(porLer.quantas)}
        </button>
      )}

      {/* With an empty conversation this button does not appear here: it becomes the
          gate of the empty state, right below. A button alone at the top of a
          blank screen, with the explanation half a meter away, were two halves
          of the same sentence in different places. */}
      {!semNada && canLoadOlder && onLoadOlder && (
        <button type="button" className="timeline-load-older" onClick={onLoadOlder}>
          {strings.chat.loadOlder}
        </button>
      )}

      {/* The line that said "older messages are not stored on this device" was
          removed on the owner's say-so: it explained the model, and at this
          stage we do not explain how it works.

          What it said stays true, above the oldest stored message the record
          simply stops, and those who want to pull more have the load older
          button, which stays. `hasStoredHistory` still serves that button,
          and now it also serves the choice of which of the three empty states
          this is. See `vazioDaConversa`. */}

      {semNada &&
        (porque === "por-abrir" ? (
          <EmptyState
            title={strings.chat.timelineOlderTitle}
            body={strings.chat.timelineOlderBody}
            {...(onLoadOlder ? { action: { label: strings.chat.loadOlder, onClick: onLoadOlder } } : {})}
          />
        ) : porque === "despejado" ? (
          <EmptyState title={strings.chat.timelineKeptTitle} body={strings.chat.timelineKeptBody} />
        ) : (
          <EmptyState
            title={strings.chat.timelineEmpty}
            /*
              Without a text box, the body cannot point to it.

              The conversation of a friend request awaiting reply has no write
              bar, and the usual sentence tells to look for it below: the screen
              contradicted itself in two places at once, with the lock saying
              no write and the empty space saying where.
            */
            body={semCaixaDeEscrita ? strings.chat.timelineEmptyLocked : strings.chat.timelineEmptyBody}
          />
        ))}
      {semNada && porque === "nova" && fraseDoLugar && lugar !== null && (
        <div className="timeline-frase-do-lugar">
          <FraseDoMomento id="canal" />
        </div>
      )}

      {messages.map((message, index) => {
        // Consecutive messages from the same person within a few minutes are
        // shown as one block: the repeated name and avatar are noise.
        const previous = messages[index - 1]
        // A reply is never grouped: the quote sits above the name, like Discord, and without the name the line looked like it was quoting the message above.
        const grouped =
          previous?.sender === message.sender &&
          message.payload.replyTo === undefined &&
          (message.payload.sentAt ?? 0) - (previous?.payload.sentAt ?? 0) < 5 * 60_000

        const pedido = pedidoDe?.(message) ?? null
        const chave = chaveDe(message)
        /* The quote, stored as plain values for the line's memo. */
        const replyTo = message.payload.replyTo
        const citacao = replyTo !== undefined && citacaoDe ? citacaoDe(replyTo) : undefined
        const original = citacao?.estado === "presente" ? citacao.original : undefined
        const resumo = original ? resumoDoOriginal(original.payload, nameFor) : undefined

        const linha = (
          <MessageRow
            // A friend request carries no identifier, it is not something said, it is an action, and the key falls into `t` with the `seq`, which is unique per channel. Without this, two requests in the same conversation shared the key `undefined` and React drew only one.
            key={chave}
            message={message}
            grouped={grouped}
            authorName={nameFor(message.sender)}
            apelido={apelidoDe?.(message.sender)}
            profile={directory.get(message.sender)}
            /* Only on lines with a face: a grouped line does not draw an avatar, and calculating its state was wasted work. */
            presence={grouped ? undefined : presenceFor?.(message.sender)}
            emChamada={!grouped && (emChamada?.(message.sender) ?? false)}
            mentionNames={
              message.payload.mentions?.length
                ? message.payload.mentions.map(nameFor).join("\u0000")
                : undefined
            }
            onMention={abrirMencao}
            /* The same gate as the mention: opens the page of who wrote it. Our messages too, and that goes to the own profile screen. */
            onOpenAuthor={abrirMencao}
            onOpenImage={abrirImagem}
            {...(/* The rule was "only ours", and it stopped working: pinning a message is almost always pinning someone else's. The `Timeline` still decides who gets a menu, the line does not repeat the rule, and filtering what each ENTRY offers falls to whoever builds the menu: edit and delete still apply only to what is ours. See `ChatScreen`. */
            onMessageMenu &&
            (message.sender === me || podeMenuAlheio) &&
            message.payload.t === "message" &&
            (temMenu?.(message) ?? true)
              ? { onMessageMenu: (at: { x: number; y: number }) => onMessageMenu(message, at) }
              : {})}
            {...(pedido ? { pedido } : {})}
            pedidoOcupado={pedidoOcupado === message.sender}
            onPedidoResposta={responder}
            apuramento={apuramentos?.get(message.payload.id ?? "")}
            {...(onVotar ? { onVotar: votar } : {})}
            nameFor={nomear}
            /* No identifier means no pin is possible: a friend request is not something said. The `?? ""` would fall into the empty set anyway, but saying it here saves the caller the question. */
            fixada={message.payload.id !== undefined && (fixadas?.has(message.payload.id) ?? false)}
            destacada={message.payload.id !== undefined && message.payload.id === destacada}
            {...(onResponder && podeResponder(message) ? { onResponder: responderA } : {})}
            citacaoEstado={citacao?.estado}
            citacaoAutor={original?.sender}
            citacaoNome={original ? nameFor(original.sender) : undefined}
            citacaoTexto={
              !resumo
                ? undefined
                : resumo.tipo === "texto"
                  ? resumo.texto
                  : resumo.tipo === "imagem"
                    ? strings.respostas.imagem
                    : resumo.tipo === "ficheiro"
                      ? resumo.nome
                      : strings.respostas.vazia
            }
            citacaoPerfil={original ? directory.get(original.sender) : undefined}
            {...(onIrParaOriginal ? { onIrParaOriginal: irParaOriginal } : {})}
          />
        )

        // The mark of where we left off, just above the first unread message. It stays in the flow of the conversation and does not float: it is a place, not a banner.
        const comPorLer =
          chave !== porLer.primeira ? (
            linha
          ) : (
            <Fragment key={`marca-${chave}`}>
              <div className="timeline-unread-mark" ref={linhaPorLer} role="separator">
                <span>{strings.chat.unreadMark}</span>
              </div>
              {linha}
            </Fragment>
          )
        // The place marker (S5), where we came in: also in the flow.
        if (index !== indiceDoLugar) return comPorLer
        return (
          <Fragment key={`lugar-${chave}`}>
            {marcaDoLugar}
            {comPorLer}
          </Fragment>
        )
      })}
      {indiceDoLugar !== null && indiceDoLugar === messages.length && marcaDoLugar}

      {/* Our own sends still in flight (dimmed, clock in the gutter) or failed (red mark, retry and discard inline). They sit after the confirmed messages because that is where they will land once the send lands.
          
          Offline writes have the same shape and say it in words: "waiting for connection", next to "Discard". The mark alone was not enough, because a clock in the gutter reads as "sending", and someone who wrote offline needs to know the message has not gone out yet. */}
      {pending.map((entry) => (
        <article key={entry.id} className={`message outbox ${entry.state}`}>
          <span
            className="message-gutter"
            role="img"
            aria-label={
              entry.state === "failed"
                ? strings.chat.sendFailed
                : entry.state === "waiting"
                  ? strings.chat.aEsperaDeLigacao
                  : strings.chat.sending
            }
          >
            {entry.state === "failed" ? "!" : "◷"}
          </span>
          <div className="message-body">
            <header>
              <span className="author">{me ? <NomeDePessoa nome={nameFor(me)} endereco={me} /> : strings.common.you}</span>
              <time>{formatTime(entry.at)}</time>
            </header>
            <p>{entry.body}</p>
            {entry.state === "failed" && (
              <div className="outbox-actions">
                <button type="button" className="retry" onClick={() => onRetry(entry.id)}>
                  {strings.common.retry}
                </button>
                <button type="button" onClick={() => onDiscard(entry.id)}>
                  {strings.chat.discard}
                </button>
              </div>
            )}
            {entry.state === "waiting" && (
              <div className="outbox-actions">
                <span className="outbox-espera">{strings.chat.aEsperaDeLigacaoNota}</span>
                <button type="button" onClick={() => onDiscard(entry.id)}>
                  {strings.chat.discard}
                </button>
              </div>
            )}
          </div>
        </article>
      ))}

      {showJump && (
        <button
          type="button"
          className="timeline-jump"
          onClick={() => scrollToBottom(prefersReducedMotion() ? "auto" : "smooth")}
        >
          {strings.chat.newMessages}
        </button>
      )}

      {/*
        Glued to the bottom of the scroller, not on its own screen line: it appears and disappears second by second, and a line that springs up and dies in the middle of the layout pushed the conversation up and down with each phrase someone began to type.
        
        `aria-live="polite"` not "assertive": it is a courtesy, not a banner.
        */}
      {typists.length > 0 && (
        <p className="timeline-typing" aria-live="polite">
          <span className="typing-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {strings.chat.typing(typists)}
        </p>
      )}

      {/* The same sheet as the feed. See `Lightbox`. */}
      {zoom && <Lightbox item={zoom} onClose={() => setZoom(null)} />}
    </div>
  )
}
