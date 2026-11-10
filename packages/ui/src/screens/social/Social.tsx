import { useEffect, useId, useMemo, useRef, useState } from "react"
import { copiarTexto } from "../../lib/copiar.js"
import { AnexosDoItem } from "../../components/AnexoAPedido.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import {
  bytesQueAindaCabem,
  caracteresDeBase64,
  caracteresDeDataUrl,
  FICHEIRO_MAX_BYTES,
  HISTORY_MEDIA_BUDGET_BYTES,
} from "@enclave/client-core"
import { useBridge } from "../../App.js"
import type { ConnectionState, LinkCard, Profile } from "../../bridge.js"
import type { ChatMessage, MediaItem, OutgoingFile, SocialDraft } from "../../types.js"
import { Avatar } from "../../components/Avatar.js"
import { Button } from "../../components/Button.js"
import { Enquadrar } from "../../components/Enquadrar.js"
import { ConnectionBanner } from "../../components/ConnectionBanner.js"
import { EmptyState } from "../../components/EmptyState.js"
import { Lightbox } from "../../components/Lightbox.js"
import { Modal } from "../../components/Modal.js"
import { useToast } from "../../components/Toast.js"
import { useAtalhosDeFormatacao } from "../../hooks/useAtalhosDeFormatacao.js"
import { useConfirmar } from "../../hooks/useConfirmar.js"
import { useToqueLongo } from "../../hooks/useToqueLongo.js"
import { CropIcon, ImageIcon, LinkIcon, LockIcon, PaperclipIcon } from "../../icons.js"
import { colarImagens } from "../../lib/colar.js"
import { extensaoDe, formatarBytes, lerComoDataUrl, nomeSeguro } from "../../lib/ficheiros.js"
import { dataUrlParaBlob, podeEnquadrar } from "../../lib/enquadrar.js"
import { compressImage, IMAGE_BUDGETS, resumoDaReducao, type CompressedImage } from "../../lib/images.js"
import { ACEITA_VIDEO, formatarDuracao, lerVideo, validarAntesDeLer } from "../../lib/videos.js"
import { VideoIcon } from "../../components/VideoDaPublicacao.js"
import {
  connectionLabel,
  donationsOf,
  extractTags,
  filterByTag,
  formatRelative,
  formatShortDate,
  formatStamp,
} from "../../lib/format.js"
import { strings, traduzirErro } from "../../strings.js"
import { ContextMenu } from "../overlays/ContextMenu.js"
import { engagementOf, NO_ENGAGEMENT } from "./engagement.js"
import { LinkDraft } from "./LinkDraft.js"
import { PostBody } from "./PostBody.js"
import { PostEngagement } from "./PostEngagement.js"
import { NovaVotacao } from "../overlays/NovaVotacao.js"
import { apurar, corpoDaVotacao, votacaoDe, votosDe, type Apuramento, type Votacao } from "../../lib/votacoes.js"
import { usePostActions } from "./usePostActions.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"

/**
 * How many files fit in a post.
 *
 * The protocol accepts ten attachments total and four images are already spoken
 * for. Four, not six like in conversation, for a reason outside the protocol: a
 * post stays in the vault of EVERYONE who follows, not just those in the
 * conversation. The cap that matters is still the bytes.
 */
const FICHEIROS_MAX_POST = 4

/**
 * How many images fit in a post.
 *
 * Four, like in conversation. The number was already here, hard-coded inside a
 * `slice`-and a `slice` by itself throws the fifth image away WITHOUT WARNING,
 * which actually started happening the day you could paste several at once. With
 * the name pulled out, there is a place to hang the refusal.
 */
const IMAGENS_MAX_POST = 4

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

/**
 * What to clear from the draft after a post goes out.
 *
 * Only the fields that still hold the posted value. A video takes seconds to go
 * out, and anyone who starts writing the next post in that time cannot lose what
 * they wrote when the previous one finishes. Lists are compared by reference: each
 * change to the draft creates a new list.
 */
export function limparPublicado(publicado: SocialDraft, atual: SocialDraft): Partial<SocialDraft> {
  const limpar: Partial<SocialDraft> = {}
  if (atual.caption === publicado.caption) limpar.caption = ""
  if ((atual.title ?? "") === (publicado.title ?? "")) limpar.title = ""
  if (atual.images === publicado.images) limpar.images = []
  if (atual.files === publicado.files) limpar.files = []
  if (atual.links === publicado.links) limpar.links = []
  if (atual.video === publicado.video) limpar.video = undefined
  return limpar
}

export function Social({
  feed,
  messages = [],
  me,
  connection,
  connectionDetail,
  nameFor,
  directory,
  draft,
  onDraft,
  composeSignal,
  presenceFor,
  presenceHint,
  onUserMenu,
  onOpenProfile,
  circleSize = 0,
}: {
  feed: ChatMessage[]
  /**
   * The entire feed, not just the posts.
   *
   * Likes and comments are not state stored anywhere: they are messages like any
   * other, and the number appears from adding them up here. That is why the screen
   * needs the feed and not the already-folded feed-see `engagement.ts`.
   */
  messages?: ChatMessage[] | undefined
  me: string | null
  connection: ConnectionState
  connectionDetail: string | null
  nameFor: (sender: string) => string
  directory: Map<string, Profile>
  /** Owned by the shell so a tab switch never eats a half-written post. */
  draft: SocialDraft
  onDraft: (patch: Partial<SocialDraft>) => void
  /** "New post" anywhere in the app: focus the composer. */
  composeSignal?: number | undefined
  /** Presence per person, live or derived — the shell knows which. */
  presenceFor?: ((address: string) => "active" | "away" | "busy" | "idle") | undefined
  presenceHint?: string | undefined
  /** Right-click on an author: the shared person menu, owned by the shell.
   * The channel is the author's feed — a channel the two of us share. */
  onUserMenu?: ((address: string, at: { x: number; y: number }, channel: string) => void) | undefined
  /**
   * Click the author's name: open their profile.
   *
   * Replaced the click that copied the address. Reading a post and wanting to
   * know who wrote it are the same curiosity; copying an address is a task, and
   * it lives where tasks live, in the right-click menu.
   *
   * The channel comes along because it's the author's feed, a channel shared by
   * both of them, that's where the security number gets calculated.
   */
  onOpenProfile?: ((address: string, channel: string) => void) | undefined
  /*
    Friend requests no longer appear here. They were the fourth list, with a
    different label ("wants you to follow them") and no "Decline". They live in
    Pending, in the bell, in the chat, and in the profile sheet, all using the
    same card.
    */
  /** How many people's feeds this device actually holds. An empty feed means
   * something quite different at zero than it does at three. */
  circleSize?: number | undefined
}): React.JSX.Element {
  const bridge = useBridge()
  const toast = useToast()
  const confirmar = useConfirmar()
  /* The same menu, with the finger down. See `useToqueLongo`. */
  const aoDedo = useToqueLongo()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  /**
   * How much compression did to the images, stated in bytes.
   *
   * Separate from `note` because it's not a warning, just like in the chat box:
   * nothing went wrong, and drawing it in red next to refusals taught people to
   * ignore both.
   */
  const [reducao, setReducao] = useState<string | null>(null)
  /**
   * The cover (the first image in the draft) framed at 16:10, matching the
   * frame of the feed and the profile thumbnails. Only the first one, because
   * it's the only one that always appears in that full frame: with two or more
   * images the feed divides the frame internally, and the profile thumbnail
   * shows the first one (`ProfileBody`).
   */
  const [capaAEnquadrar, setCapaAEnquadrar] = useState<Blob | null>(null)
  /** Sending the video, part by part, as the post goes out. */
  const [envioDoVideo, setEnvioDoVideo] = useState<{ feitas: number; de: number } | null>(null)
  /**
   * A post going out, from click to finish. Stored in a ref, not in state: two
   * Ctrl+Enter presses can arrive before React renders the `busy` flag, and
   * with a video it would post twice.
   */
  const aPublicar = useRef(false)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [zoom, setZoom] = useState<MediaItem | null>(null)
  /** "…" on one of my own posts: Editar / Apagar. */
  const [postMenu, setPostMenu] = useState<{ post: ChatMessage; at: { x: number; y: number } } | null>(null)
  /** Editing a published post: its id, plus the draft to restore afterwards. */
  const [editing, setEditing] = useState<{ id: string; resume: SocialDraft } | null>(null)
  const captionRef = useRef<HTMLTextAreaElement | null>(null)
  /** The current draft, for anyone finishing after the click (the `.then` of `publish`). */
  const rascunhoAgora = useRef(draft)
  rascunhoAgora.current = draft

  // "New post" lands here already focused, cursor in the textarea.
  useEffect(() => {
    if (composeSignal) captionRef.current?.focus()
  }, [composeSignal])

  const { caption, images, links } = draft
  const files = draft.files ?? []
  const video = draft.video
  /** Cmd/Ctrl+B and friends in the caption, just like in the chat. */
  const formatar = useAtalhosDeFormatacao(caption, (texto) => onDraft({ caption: texto }))
  const draftTags = extractTags(caption)
  const shown = filterByTag(feed, activeTag)
  const engagement = useMemo(() => engagementOf(messages, me), [messages, me])

  /**
   * Vote, comment, delete a comment. These used to be written here; they moved
   * to `usePostActions` when the profile started opening posts with the same
   * buttons. The feed and profile call the same function, so they can't disagree
   * about what a second thumbs-up does.
   */
  /**
   * And the tally of each vote in the feed, by post id.
   *
   * One pass over the entire thread, not one per post: all votes come in the
   * same thread, and looping through it once per card meant looping through a
   * thirty-post feed thirty times. The options for each vote come from the post
   * they belong to, because it's their count that decides what is an out-of-place
   * vote, see `apurar`.
   */
  const apuramentos = useMemo(() => {
    const escolhas = votosDe(messages)
    const porPublicacao = new Map<string, Apuramento>()
    for (const publicacao of feed) {
      const votacao = votacaoDe(publicacao.payload)
      const id = publicacao.payload.id
      if (!votacao || !id) continue
      porPublicacao.set(id, apurar(escolhas.get(id), votacao.options.length, me))
    }
    return porPublicacao
  }, [messages, feed, me])

  const { vote, comment, deleteComment, votar } = usePostActions(engagement, apuramentos)

  /** Is the poll creation sheet open? */
  const [aCriarVotacao, setACriarVotacao] = useState(false)

  /**
   * Publish a poll.
   *
   * The caption is the poll spelled out, not decoration: that's what a client
   * that doesn't know how to draw polls shows, and without it that person would
   * see an empty post. See `corpoDaVotacao`.
   *
   * No images, links, or tags: a poll is a question. Mixing it with the draft
   * waiting to be posted would publish two things with one click.
   */
  const publicarVotacao = async (votacao: Votacao): Promise<void> => {
    await bridge.social
      .post(corpoDaVotacao(votacao), [], { poll: votacao })
      .then(() => setACriarVotacao(false))
      .catch((error: Error) => {
        toast(traduzirErro(error), "error")
        setACriarVotacao(false)
      })
  }

  /**
   * The payload characters this post has already spent.
   *
   * Same count the chat input box does, for the same reason: a post goes through
   * the same thread and hits the same limit. It weighs more here, and it's worth
   * saying why, a post lives in the vault of everyone who follows it, not just
   * the vault of people in a chat.
   */
  const ocupadoNaPublicacao = useMemo(() => {
    let total = JSON.stringify(caption).length + JSON.stringify(links).length
    for (const inline of images) total += inline.length
    for (const ficheiro of files) total += ficheiro.dataUrl.length
    return total
  }, [caption, links, images, files])

  /**
   * Attach non-image files to a post.
   *
   * Everything that works in the chat works here, and the code is literally the
   * same, `bytesQueAindaCabem` from the core, `lerComoDataUrl` and `nomeSeguro`
   * from the library. A second implementation for the feed was the copy that gets
   * left behind the day we add a check.
   *
   * No compressor, like the chat: a PDF comes pre-compressed and a zip
   * recompressed gets bigger.
   */
  const addFiles = async (escolhidos: File[]): Promise<void> => {
    const espaço = FICHEIROS_MAX_POST - files.length
    if (espaço <= 0) {
      setNote(strings.social.filesFull(FICHEIROS_MAX_POST))
      return
    }
    setNote(null)
    setBusy(true)
    try {
      let gasto = ocupadoNaPublicacao
      const novos: OutgoingFile[] = []
      for (const file of escolhidos.slice(0, espaço)) {
        const mediaType = file.type || "application/octet-stream"
        const cabe = bytesQueAindaCabem(gasto, mediaType)
        if (cabe <= 0) {
          setNote(strings.social.fileNoRoom)
          break
        }
        if (file.size > cabe) {
          setNote(strings.social.fileTooBig(nomeSeguro(file.name), formatarBytes(cabe)))
          break
        }
        const dataUrl = await lerComoDataUrl(file)
        gasto += caracteresDeDataUrl(file.size, mediaType)
        novos.push({ dataUrl, name: file.name, mediaType, bytes: file.size })
      }
      if (novos.length > 0) onDraft({ files: [...files, ...novos].slice(0, FICHEIROS_MAX_POST) })
    } catch {
      setNote(strings.social.fileUnreadable)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Attach images to a post.
   *
   * **Compressed before encryption**, with the post budget, see `lib/images.ts`,
   * where the numbers and reasons for each one live. This was missing here and
   * already existed in the chat: this box read the file as-is and refused at the
   * gate anything over three megabytes, which meant refusing any screenshot from
   * a large screen. A 4K screenshot comes in at about twelve megabytes and leaves
   * here at a few hundred kilobytes.
   *
   * **The remaining limit is what actually goes in the thread**, measured by
   * `bytesQueAindaCabem` like files are, not by a round number typed by hand,
   * which is what was here and stopped meaning anything the day images started
   * shrinking.
   *
   * **Sequential on purpose**, for the same reason as files: each image accepted
   * changes the budget for the next one.
   */
  const addImages = async (escolhidas: File[]): Promise<void> => {
    if (escolhidas.length === 0) return
    const espaço = IMAGENS_MAX_POST - images.length
    if (espaço <= 0) {
      setNote(strings.social.imagesFull(IMAGENS_MAX_POST))
      return
    }
    setNote(null)
    setReducao(null)
    setBusy(true)
    try {
      let gasto = ocupadoNaPublicacao
      const novas: string[] = []
      const originais: File[] = []
      const finais: { bytes: number }[] = []
      for (const file of escolhidas.slice(0, espaço)) {
        const imagem = await compressImage(file, IMAGE_BUDGETS.post)
        // The type comes from the data URL the compressor returned, not from the file:
        // an image recoded to WebP is no longer the PNG that came in.
        const mediaType = imagem.dataUrl.slice(5, imagem.dataUrl.indexOf(";")) || "image/*"
        if (imagem.bytes > bytesQueAindaCabem(gasto, mediaType)) {
          setNote(strings.social.imagesNoRoom)
          break
        }
        gasto += imagem.dataUrl.length
        novas.push(imagem.dataUrl)
        originais.push(file)
        finais.push(imagem)
      }
      if (novas.length > 0) {
        onDraft({ images: [...images, ...novas].slice(0, IMAGENS_MAX_POST) })
        setReducao(resumoDaReducao(originais, finais))
      }
    } catch (erro) {
      // The phrase comes from the compressor as a stable key ("this device cannot
      // shrink images") and it's the translation that the code and language give it.
      // Swapping it for a generic one would erase the only useful clue.
      setNote(traduzirErro(erro))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Swap the cover for the crop. The thread limit starts over without the old
   * cover: a small PNG that passed through unchanged could come out bigger after
   * cropping, and a post that doesn't fit gets refused entirely on the other side.
   */
  const trocarCapa = (imagem: CompressedImage): void => {
    setCapaAEnquadrar(null)
    const antiga = images[0]
    if (antiga === undefined) return
    const mediaType = imagem.dataUrl.slice(5, imagem.dataUrl.indexOf(";")) || "image/*"
    if (imagem.bytes > bytesQueAindaCabem(ocupadoNaPublicacao - antiga.length, mediaType)) {
      setNote(strings.social.imagesNoRoom)
      return
    }
    setReducao(null)
    onDraft({ images: [imagem.dataUrl, ...images.slice(1)] })
  }

  /**
   * Attach a video to the post. One only, and no transcoding: it goes as-is.
   *
   * Type and size are rejected before reading the file; duration and thumbnail
   * (the frame at 1 s) are read in an off-screen `<video>`. See `lib/videos.ts`.
   * Bytes are only read at publish time: a draft with a 25 MB video doesn't hold
   * 25 MB in memory twice.
   */
  const addVideo = async (ficheiro: File | undefined): Promise<void> => {
    if (!ficheiro) return
    if (video) {
      setNote(strings.social.videoOnlyOne)
      return
    }
    setNote(strings.social.videoReading)
    setBusy(true)
    try {
      const mediaType = validarAntesDeLer(ficheiro)
      const lido = await lerVideo(ficheiro)
      onDraft({
        video: {
          ficheiro,
          name: ficheiro.name || "video",
          mediaType,
          bytes: ficheiro.size,
          duration: lido.duration,
          poster: lido.poster,
        },
      })
      setNote(null)
    } catch (erro) {
      setNote(traduzirErro(erro))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Handle a `paste` in the post composer.
   *
   * The policy lives in `lib/colar.ts` and matches the chat: text wins, bytes
   * decide the type, either everything goes in or nothing does. Here it's just
   * the destination, the same `addImages` as the button, with the same
   * compressor and the same limits.
   */
  const colar = (event: React.ClipboardEvent): void => {
    const tomou = colarImagens(event.clipboardData, {
      aceitar: (imagens) => void addImages(imagens),
      recusar: () => setNote(strings.common.pasteNotImage),
    })
    if (tomou) event.preventDefault()
  }

  const startEdit = (post: ChatMessage): void => {
    if (!post.payload.id) return
    setEditing({ id: post.payload.id, resume: draft })
    onDraft({ caption: post.payload.caption ?? "", title: "", images: [], files: [], links: [] })
    captionRef.current?.focus()
  }

  const cancelEdit = (): void => {
    if (!editing) return
    onDraft(editing.resume)
    setEditing(null)
  }

  const deletePost = (post: ChatMessage): void => {
    const alvo = post.payload.id
    if (!alvo) return
    void confirmar({
      titulo: strings.social.deleteTitle,
      corpo: strings.social.deleteConfirm,
      verbo: strings.social.deleteAction,
      destructive: true,
    })
      .then(async (sim) => {
        if (!sim) return
        await bridge.social.remove(alvo)
        toast(strings.social.deleted)
      })
      .catch((error: Error) => toast(traduzirErro(error), "error"))
  }

  const publish = (): void => {
    // One at a time: the button says so, but Ctrl+Enter doesn't go through the button.
    if (aPublicar.current || busy || envioDoVideo) return
    const text = caption.trim()
    if (!text && images.length === 0 && files.length === 0 && links.length === 0 && !video) return

    aPublicar.current = true
    setBusy(true)
    setNote(null)

    if (editing) {
      // An edit replaces the caption; the new #tags come from the new text on
      // every reader's device, same as they would on a fresh post.
      const { id, resume } = editing
      void bridge.social
        .edit(id, text)
        .then(() => {
          setEditing(null)
          onDraft(resume)
        })
        .catch((error: Error) => setNote(traduzirErro(error)))
        .finally(() => {
          aPublicar.current = false
          setBusy(false)
        })
      return
    }

    const extras = {
      media: [
          ...images.map((inline, index) => ({
            inline,
            name: `imagem-${index + 1}`,
            mediaType: inline.slice(5, inline.indexOf(";")) || "image/*",
          })),
          // In the SAME list as images, like in the chat: in the thread they're the same
          // thing, and it's the adapter's `kindOf` that separates them again. A new field
          // in the payload would force all already-installed clients to learn it just to
          // see an attachment their schema already knew how to draw.
          ...files.map((ficheiro) => ({
            inline: ficheiro.dataUrl,
            name: ficheiro.name,
            mediaType: ficheiro.mediaType,
          })),
        ],
        links,
        ...(draft.title?.trim() ? { title: draft.title.trim() } : {}),
      }

    /*
      With video: the post goes through the video bridge, which sends the parts
      next and only resolves when the last one is out. Progress comes via the
      `video` event, and "Cancel" deletes the post. Without video, the normal path.
    */
    const enviar = ((): Promise<unknown> => {
      if (!video || !bridge.video) return bridge.social.post(text, extractTags(text), extras)
      const ponte = bridge.video
      const largar = bridge.on.video?.((evento) => {
        if (evento.fase === "a-enviar") setEnvioDoVideo({ feitas: evento.feitas, de: evento.de })
      })
      return video.ficheiro
        .arrayBuffer()
        .then((buffer) =>
          ponte.publicar(text, extractTags(text), extras, {
            bytes: new Uint8Array(buffer),
            name: video.name,
            mediaType: video.mediaType,
            duration: video.duration,
            poster: video.poster,
          }),
        )
        .finally(() => {
          largar?.()
          setEnvioDoVideo(null)
        })
    })()

    // What was posted, just as it was at the click: only that gets cleared at the end.
    const publicado = draft
    void enviar
      .then(() => {
        onDraft(limparPublicado(publicado, rascunhoAgora.current))
        // The compression note goes with the images it talked about.
        setReducao(null)
      })
      .catch((error: Error) => setNote(traduzirErro(error)))
      .finally(() => {
        aPublicar.current = false
        setBusy(false)
      })
  }

  // Closing or reloading mid-send cuts the video: the browser asks first.
  useEffect(() => {
    if (!envioDoVideo) return
    const avisar = (evento: BeforeUnloadEvent): void => {
      evento.preventDefault()
      evento.returnValue = ""
    }
    window.addEventListener("beforeunload", avisar)
    return () => window.removeEventListener("beforeunload", avisar)
  }, [envioDoVideo])

  /**
   * A video that doesn't fit in this device's vault (the media budget is 4
   * million characters for everything) stays only in this session's memory. It's
   * flagged before posting: after closing the app, this device only sees it if
   * it asks the other members.
   */
  const videoSoNaSessao = video !== undefined && caracteresDeBase64(video.bytes) > HISTORY_MEDIA_BUDGET_BYTES

  return (
    <main className="main">
      <ConnectionBanner state={connection} detail={connectionDetail} />
      <header className="topbar">
        <h1>{strings.social.title}</h1>
        <span className="sealed" title={strings.social.sealedTitle}>
          <LockIcon size={13} />
          {strings.social.sealed}
        </span>
      </header>

      <div className="feed">
        <section className="card composer-card">
          {editing && (
            <div className="editing-chip">
              <span>{strings.social.editingChip}</span>
              <Button variant="ghost" onClick={cancelEdit}>
                {strings.social.editCancel}
              </Button>
            </div>
          )}
          {/* Optional, so it doesn't take the caption's place: whoever doesn't name it
              sees the post called by its first words. Editing only touches the
              caption, and this field disappears from view. */}
          {!editing && (
            <input
              className="post-title-input"
              value={draft.title ?? ""}
              placeholder={strings.social.titlePlaceholder}
              maxLength={120}
              autoComplete="off"
              onChange={(event) => onDraft({ title: event.target.value })}
            />
          )}
          <textarea
            ref={captionRef}
            value={caption}
            placeholder={strings.social.placeholder}
            rows={3}
            onChange={(event) => onDraft({ caption: event.target.value })}
            onKeyDown={(event) => {
              // Before the Ctrl+Enter that posts: both carry commands, and without this order
              // a Cmd+B would reach the Enter test by accident.
              if (formatar(event)) return
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) publish()
            }}
            onPaste={colar}
          />

          {draftTags.length > 0 && (
            <ul className="tags tag-preview">
              <li className="tag-preview-label">{strings.social.tagPreview}</li>
              {draftTags.map((tag) => (
                <li key={tag} className="tag-pill">
                  #{tag}
                </li>
              ))}
            </ul>
          )}

          {images.length > 0 && (
            <div className="draft-images">
              {images.map((src, index) => (
                <div key={index} className="draft-image">
                  <img src={src} alt="" />
                  <button
                    onClick={() => onDraft({ images: images.filter((_, i) => i !== index) })}
                    title={strings.common.remove}
                    aria-label={strings.common.remove}
                  >
                    ×
                  </button>
                  {index === 0 && podeEnquadrar() && (
                    <button
                      type="button"
                      className="draft-image-enquadrar"
                      onClick={() => setCapaAEnquadrar(dataUrlParaBlob(src))}
                      title={strings.enquadrar.enquadrarCapa}
                      aria-label={strings.enquadrar.enquadrarCapa}
                    >
                      <CropIcon />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {capaAEnquadrar && (
            <Enquadrar
              ficheiro={capaAEnquadrar}
              forma="capa"
              budget={IMAGE_BUDGETS.post}
              onGuardar={trocarCapa}
              onCancelar={() => setCapaAEnquadrar(null)}
            />
          )}

          {/* The files, in cards like the ones in the chat: what it is, what it's called,
              how much it weighs. No thumbnail, because a PDF doesn't have one. */}
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
                      aria-label={strings.social.fileDrop(nome)}
                      onClick={() => onDraft({ files: files.filter((_, i) => i !== index) })}
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {/* The video: the thumbnail with duration, name, and size. */}
          {video && (
            <div className="draft-video">
              <div className="draft-image">
                <img src={video.poster} alt="" />
                <span>{formatarDuracao(video.duration)}</span>
                {!envioDoVideo && (
                  <button
                    type="button"
                    onClick={() => onDraft({ video: undefined })}
                    title={strings.common.remove}
                    aria-label={strings.social.videoDrop(nomeSeguro(video.name))}
                  >
                    ×
                  </button>
                )}
              </div>
              <span className="file-text">
                <bdi className="file-name">{nomeSeguro(video.name)}</bdi>
                <span className="file-meta">{formatarBytes(video.bytes)}</span>
                {videoSoNaSessao && <span className="file-meta">{strings.social.videoOnlyThisSession}</span>}
              </span>
            </div>
          )}

          {/* Sending the video, part by part, with output. */}
          {envioDoVideo && (
            <div className="envio-do-video">
              <progress max={envioDoVideo.de} value={envioDoVideo.feitas} aria-hidden="true" />
              <span role="status">{strings.social.videoSending(envioDoVideo.feitas, envioDoVideo.de)}</span>
              <Button variant="ghost" onClick={() => void bridge.video?.cancelar()}>
                {strings.social.videoSendCancel}
              </Button>
            </div>
          )}

          {links.map((link, index) => (
            <LinkDraft
              key={index}
              link={link}
              onChange={(next) => onDraft({ links: links.map((item, i) => (i === index ? next : item)) })}
              onRemove={() => onDraft({ links: links.filter((_, i) => i !== index) })}
            />
          ))}

          {/* No `warn`: shrinking a photo is not a problem. */}
          {reducao && <p className="field-note">{reducao}</p>}
          {note && (
            <p className="field-note warn">
              <TextoDeErro texto={note} />
            </p>
          )}

          <div className="composer-actions">
            {/* v1 edits touch the caption only, so media controls step aside. */}
            {!editing && (
              <>
                <label className="ghost file icon-only" data-tip={strings.social.attachImage} aria-label={strings.social.attachImage}>
                  <ImageIcon size={17} />
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(event) => {
                      void addImages([...(event.target.files ?? [])])
                      event.target.value = ""
                    }}
                  />
                </label>
                {/* The clip, next to the photo, like in the chat, the same gesture has to
                    look the same in both places. No `accept`: any file works, and
                    size decides. The label states the limit before any choice. */}
                <label
                  className="ghost file icon-only"
                  data-tip={`${strings.social.fileAdd} (máx. ${formatarBytes(FICHEIRO_MAX_BYTES)})`}
                  aria-label={strings.social.fileAdd}
                >
                  <PaperclipIcon size={17} />
                  <input
                    type="file"
                    multiple
                    onChange={(event) => {
                      void addFiles([...(event.target.files ?? [])])
                      event.target.value = ""
                    }}
                  />
                </label>
                {/* The video: only when the bridge knows it can send it. "Record video" opens
                    the back camera on a phone, and only shows on a touch screen. */}
                {bridge.video && (
                  <>
                    <label className="ghost file icon-only" data-tip={strings.social.attachVideo} aria-label={strings.social.attachVideo}>
                      <VideoIcon size={17} />
                      <input
                        type="file"
                        accept={ACEITA_VIDEO}
                        onChange={(event) => {
                          void addVideo(event.target.files?.[0])
                          event.target.value = ""
                        }}
                      />
                    </label>
                    <label className="ghost file so-toque" aria-label={strings.social.recordVideo}>
                      {strings.social.recordVideo}
                      <input
                        type="file"
                        accept="video/*"
                        capture="environment"
                        onChange={(event) => {
                          void addVideo(event.target.files?.[0])
                          event.target.value = ""
                        }}
                      />
                    </label>
                  </>
                )}
                <button
                  type="button"
                  className="ghost icon-only"
                  data-tip={strings.social.addLink}
                  aria-label={strings.social.addLink}
                  disabled={links.length >= 4}
                  onClick={() => onDraft({ links: [...links, { url: "", kind: "link" }] })}
                >
                  <LinkIcon size={16} />
                </button>
                {/* The poll. In words, not as an icon: the three next to it are gestures to
                    add to what's written, and this one publishes something else. A
                    fourth almost identical icon would make people guess which was which.
                    
                    Only when the host knows how to record a vote, posting a poll
                    nobody could vote on was offering half a feature. It's the house
                    rule: what can't be used doesn't show up. */}
                {bridge.votacoes && MOSTRAR_VOTACOES && (
                  <button type="button" className="ghost" onClick={() => setACriarVotacao(true)}>
                    {strings.votacao.criar}
                  </button>
                )}
              </>
            )}
            <span className="hint">{strings.social.ctrlEnter}</span>
            <Button
              variant="primary"
              disabled={busy || (!caption.trim() && images.length === 0 && files.length === 0 && links.length === 0 && !video)}
              onClick={publish}
            >
              {busy ? strings.social.publishing : editing ? strings.social.save : strings.social.publish}
            </Button>
          </div>
        </section>

        {activeTag && (
          <div className="feed-filter">
            <button
              type="button"
              className="filter-chip"
              title={strings.social.filterClear}
              aria-label={strings.social.filterChip(activeTag)}
              onClick={() => setActiveTag(null)}
            >
              #{activeTag}
              <span aria-hidden="true">×</span>
            </button>
          </div>
        )}

        {shown.length === 0 &&
          (activeTag ? (
            <EmptyState title={strings.social.emptyTagTitle(activeTag)} body={strings.social.emptyTagBody} />
          ) : circleSize > 0 ? (
            // Holding people's feeds and still reading nothing is not the same
            // silence as having nobody to read. Everything published before
            // this device had a seat in the group stays sealed — that is
            // forward secrecy working, not the app failing — and the only cure
            // is somebody publishing again. Saying so beats a blank page that
            // reads as "broken".
            <EmptyState title={strings.social.emptyCircleTitle} body={strings.social.emptyCircleBody(circleSize)} />
          ) : (
            <EmptyState title={strings.social.emptyTitle} body={strings.social.emptyBody} />
          ))}

        {shown.map((post) => {
          const author = directory.get(post.sender)
          const donations = donationsOf(author)
          return (
            <article key={`${post.channel}:${post.payload.id}`} className="card post">
              <header>
                <Avatar profile={author} fallback={post.sender[1] ?? "?"} presence={presenceFor?.(post.sender)} presenceTitle={presenceHint} />
                <div className="post-who">
                  <button
                    type="button"
                    className="author"
                    title={strings.personProfile.openHint(nameFor(post.sender))}
                    onClick={() => onOpenProfile?.(post.sender, post.channel)}
                    onContextMenu={(event) => {
                      if (!onUserMenu || post.sender === me) return
                      event.preventDefault()
                      onUserMenu(post.sender, { x: event.clientX, y: event.clientY }, post.channel)
                    }}
                    {...aoDedo(
                      onUserMenu && post.sender !== me
                        ? (ponto) => onUserMenu(post.sender, ponto, post.channel)
                        : undefined,
                    )}
                  >
                    <NomeDePessoa nome={nameFor(post.sender)} endereco={post.sender} />
                  </button>
                  <span className="post-meta">
                    {author?.statusText && (
                      <>
                        <span className="post-status">{author.statusText}</span>
                        <span className="sep">·</span>
                      </>
                    )}
                    <time title={formatStamp(post.payload.postedAt)}>{formatRelative(post.payload.postedAt)}</time>
                    {post.payload.editedAt !== undefined && (
                      <>
                        <span className="sep">·</span>
                        {/* Always visible: readers deserve to know it changed. */}
                        <span className="post-edited" title={formatStamp(post.payload.editedAt)}>
                          {strings.social.edited(formatShortDate(post.payload.editedAt))}
                        </span>
                      </>
                    )}
                  </span>
                </div>
                {/* The post menu, like the message menu: copy the caption is for all, edit
                    and delete only for ours. */}
                {(post.sender === me || (post.payload.caption ?? "") !== "") && (
                  <button
                    type="button"
                    className="post-more"
                    aria-haspopup="menu"
                    title={strings.social.postMenu}
                    aria-label={strings.social.postMenu}
                    onClick={(event) => setPostMenu({ post, at: { x: event.clientX, y: event.clientY } })}
                  >
                    …
                  </button>
                )}
              </header>

              {/* Which post the photos come from: to request them from other members when missing (S5). */}
              <AnexosDoItem.Provider value={{ channel: post.channel, alvo: post.payload.id ?? "", lista: post.payload.media ?? [] }}>
                <PostBody
                  payload={post.payload}
                  activeTag={activeTag}
                  onTagClick={(tag) => setActiveTag((current) => (current === tag ? null : tag))}
                  onOpenImage={setZoom}
                  apuramento={apuramentos.get(post.payload.id ?? "")}
                  nameFor={nameFor}
                  onVotar={(opcao) => votar(post, opcao)}
                />
              </AnexosDoItem.Provider>

              <PostEngagement
                engagement={engagement.get(post.payload.id ?? "") ?? NO_ENGAGEMENT}
                directory={directory}
                me={me}
                nameFor={nameFor}
                onVote={(choice) => vote(post, choice)}
                onComment={(body) => comment(post, body)}
                onDeleteComment={(id) => deleteComment(post, id)}
              />

              {donations.length > 0 && (
                <details className="support">
                  <summary>{strings.social.support}</summary>
                  <ul>
                    {donations.map((entry, index) => (
                      // Text, never a link. A click-through would tell a payment
                      // provider who is reading whose posts.
                      <li key={index}>
                        <span className="donation-kind">{entry.kind}</span>
                        <span className="donation-label">{entry.label}</span>
                        <code>{entry.value}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          )
        })}
      </div>

      <footer className="statusbar">{connectionLabel(connection)}</footer>

      {postMenu && (
        <ContextMenu
          at={postMenu.at}
          onClose={() => setPostMenu(null)}
          items={[
            /* The message order: Copy text ‖ Edit · Delete. */
            ...((postMenu.post.payload.caption ?? "") !== ""
              ? [
                  {
                    label: strings.chat.copyText,
                    onSelect: () => {
                      void copiarTexto(postMenu.post.payload.caption ?? "")
                        .then(() => toast(strings.chat.textCopied))
                        .catch(() => toast(strings.common.copyFailed, "error"))
                    },
                  },
                ]
              : []),
            ...(postMenu.post.sender === me
              ? [
                  {
                    label: strings.social.edit,
                    separatorBefore: (postMenu.post.payload.caption ?? "") !== "",
                    onSelect: () => startEdit(postMenu.post),
                  },
                  {
                    label: strings.social.deleteAction,
                    destructive: true,
                    onSelect: () => deletePost(postMenu.post),
                  },
                ]
              : []),
          ]}
        />
      )}

      {aCriarVotacao && (
        <NovaVotacao onSubmit={publicarVotacao} onCancel={() => setACriarVotacao(false)} />
      )}

      {/* Same sheet that the conversation uses. See `Lightbox`: it was written here
          inside, and the conversation lost it because of that. */}
      {zoom && <Lightbox item={zoom} onClose={() => setZoom(null)} />}
    </main>
  )
}
