import { strings } from "../strings.js"

/**
 * The in-app notification log, as pure data and pure rules.
 *
 * Everything here is derived from events the device already witnessed and is
 * stored only in the vault: there is no server-side inbox, no read receipts
 * leaving the device, and nothing here the timeline does not already know —
 * this is memory with a bell on it, not a new data source.
 */

export interface AppNotification {
  id: string
  /** `channel-join`: somebody used one of my invite links and is now in. It
   * belongs here rather than in a popup — worth knowing, never urgent. */
  /** `mention`: someone wrote my name. See `notificationTextOf`. */
  /** `missed-call`: a private conversation rang and nobody answered (`lib/chamadasPerdidas.ts`). */
  /** `report-copy`: a report arrived on a channel I founded. The channel only: never the reporter. */
  /** `report-decision`: a decision arrived on a report I made. The decision only: no number, no channel, no facts. */
  kind:
    | "room-added"
    | "dm-new"
    | "friend-request"
    | "friend-accept"
    | "dm-message"
    | "channel-join"
    | "mention"
    | "missed-call"
    | "report-copy"
    | "report-decision"
  at: number
  /** The person behind it, when there is one. */
  actor?: string | undefined
  /** The channel to open when clicked, when there is one. */
  channel?: string | undefined
  /** Only in `report-decision`. */
  decisao?: "suspensa" | "sem-accao" | undefined
  read: boolean
}

/** Keep the log honest and bounded: dedupe by id, newest first, cap at 50. */
export const NOTIFICATION_CAP = 50

/**
 * The key by which a friend request collapses: the PERSON.
 *
 * The actor when there is one, which is the normal case; the conversation when
 * there is none, because it is the direct conversation of the two and identifies
 * the same connection. Without either of the two there is no collapse: an empty
 * key would match all requests with no actor or channel and clear the bell of
 * things that are not from the same person, it is the same guard over the form
 * that `dm-new` already has here below.
 */
function pessoaDoPedido(entry: AppNotification): string | null {
  return entry.actor ?? entry.channel ?? null
}

/**
 * A friend request per person, and this is what the owner saw.
 *
 * The notification key has the TIMESTAMP (`freq:<canal>:<sentAt>`, in
 * `App.tsx`), and deduplication here is only by `id`: two requests from the same
 * person, she cancels and asks again, or the request arrives again through a
 * different path, would give two different timestamps, so two different `id`s,
 * so two lines in the bell saying the same thing.
 *
 * For direct conversations the rule "one entry per conversation" exists since
 * forever (it's in `App.tsx`, in `onMessage`); for friend requests it was never
 * written. This is it.
 *
 * Keeps the MOST RECENT one, not the first: a new request is news, and the new entry
 * is born by reading, which is what makes the bell swing again, as it should.
 *
 * **And "most recent" is first in the list, and the caller orders it, so the collapse
 * NEVER MARKS UNREAD as read.** This is where the bell went silent forever: `fundirNotificacoes`
 * sorts by `at` descending, the `at` of a friend request is the `sentAt` the SENDER writes,
 * and `sentAt` has no cap in the protocol. An advanced timestamp, a broken clock, or on
 * purpose, put the old entry at the head of the sort, and the old entry was already marked
 * as read: the merge kept it, saved that result, and the new request vanished from the bell
 * seconds after it rang. Worse, it never recovered: the entry with `at` in the future won every
 * collapse that followed, so one advanced timestamp silenced on the bell every future
 * request from that person.
 *
 * It's the same refusal that `foldFriendTies` already applies to sender timestamps, state
 * comes from arrival order, not from what's in the payload, here applied to the bell: order
 * can be decided by another's timestamp, but UNREAD cannot.
 *
 * What's left to say, and said: the visible line is still the one sort chose, so with an
 * advanced timestamp it's the old one. Open the same conversation and the same person (collapse
 * is per person), and the reply buttons come from the friend fold, not the entry, the right
 * text on the line is lost, never the request.
 */
function umPedidoPorPessoa(list: AppNotification[]): AppNotification[] {
  /** Where each person's entry stayed, so unread can be inherited from it. */
  const ficou = new Map<string, number>()
  const resultado: AppNotification[] = []
  for (const entrada of list) {
    if (entrada.kind !== "friend-request") {
      resultado.push(entrada)
      continue
    }
    const quem = pessoaDoPedido(entrada)
    if (quem === null) {
      resultado.push(entrada)
      continue
    }
    const onde = ficou.get(quem)
    if (onde !== undefined) {
      // Copy, not mutation: these entries are the ones the vault keeps and the ones
      // the interface is already drawing, and a collapse must never reach either one
      // from behind.
      const guardada = resultado[onde]
      if (guardada && guardada.read && !entrada.read) resultado[onde] = { ...guardada, read: false }
      continue
    }
    ficou.set(quem, resultado.length)
    resultado.push(entrada)
  }
  return resultado
}

export function appendNotification(list: AppNotification[], entry: AppNotification): AppNotification[] {
  if (list.some((known) => known.id === entry.id)) return list
  /*
    A friend request does not bring a new conversation behind it: it brings itself.

    `requestFriend` opens the direct conversation and ONLY THEN sends the request,
    and on the receiving side this arrived as two events: "Ana opened a
    conversation with you" and "Ana wants to be your friend". Two lines on the
    bell, two system alerts, one act. This was read live on September 10, 2026,
    and the first of the two was the worst, it announced a conversation where
    you cannot yet write (see `escritaNaDirecta`), which makes it not only noise
    but misleading noise.

    The order is always this, and that is why it can be treated in one direction
    only: the channel exists before the message can travel through it. Still, both
    halves are written, because an order guaranteed today is an order nobody will
    verify again tomorrow.
  */
  if (entry.kind === "friend-request" && entry.channel) {
    const semAConversa = list.filter((known) => !(known.kind === "dm-new" && known.channel === entry.channel))
    // And one request per person: the new entry goes first, so it is the one that
    // survives the collapse. See `umPedidoPorPessoa`.
    return umPedidoPorPessoa([entry, ...semAConversa]).slice(0, NOTIFICATION_CAP)
  }
  if (entry.kind === "dm-new" && list.some((known) => known.kind === "friend-request" && known.channel === entry.channel)) {
    return list
  }
  if (entry.kind === "friend-request") return umPedidoPorPessoa([entry, ...list]).slice(0, NOTIFICATION_CAP)
  return [entry, ...list].slice(0, NOTIFICATION_CAP)
}

/**
 * What was in the vault and what arrived while it was opening, in one bell.
 *
 * **This exists because of a friend request that never reached the bell.**
 * The list lives in the vault and is read once per unlock; the read is
 * asynchronous, and what arrived meanwhile was written over it, the shell did
 * `setNotifications(guardadas)` on its own. Whoever opened the app with a
 * request waiting on the server heard the sound and saw nothing: the catch
 * delivers late messages in the first seconds, so the notification was born
 * BEFORE the vault read responded, and died with it. And did not come back: on a
 * later opening the message already comes from the local archive and does not go
 * through the path that creates alerts.
 *
 * Measured live on September 10, 2026: account closed, request sent, account
 * opening. Sound yes, bell empty, and stayed empty after reload.
 *
 * The stored ones override the arriving ones when the identifier is the same:
 * they are the same event, and it is the vault version that knows if it was
 * already read. Sort by instant, from most recent to oldest, which is the order
 * of the bell.
 */
export function fundirNotificacoes(
  guardadas: AppNotification[],
  chegadas: AppNotification[],
): AppNotification[] {
  const porId = new Map<string, AppNotification>()
  for (const entrada of chegadas) porId.set(entrada.id, entrada)
  for (const entrada of guardadas) porId.set(entrada.id, entrada)
  /*
    And here also one request per person, not only in `appendNotification`.

    This merge pairs by `id`, and two requests from the same person have different
    `id` values (the instant goes in the key): one stored in the vault yesterday
    and one arriving now would both pass, side by side on the bell. Sort first, so
    the collapse keeps the most recent.
  */
  const porOrdem = [...porId.values()].sort((antes, depois) => depois.at - antes.at)
  return umPedidoPorPessoa(porOrdem).slice(0, NOTIFICATION_CAP)
}

/**
 * Someone who asked for friendship withdrew the request: his entry leaves the
 * bell.
 *
 * Only the `friend-request` from that `actor`. A withdrawn request leaves no
 * notice, like a refusal: the person does not know that someone changed their
 * mind. Returns the same list when there is nothing to remove, so React state
 * does not change for nothing.
 */
export function retirarPedidoDe(list: AppNotification[], actor: string): AppNotification[] {
  const resto = list.filter((entry) => !(entry.kind === "friend-request" && entry.actor === actor))
  return resto.length === list.length ? list : resto
}

export function unreadCountOf(list: AppNotification[]): number {
  return list.reduce((count, entry) => (entry.read ? count : count + 1), 0)
}

export function markAllRead(list: AppNotification[]): AppNotification[] {
  return list.map((entry) => (entry.read ? entry : { ...entry, read: true }))
}

export function markRead(list: AppNotification[], id: string): AppNotification[] {
  return list.map((entry) => (entry.id === id ? { ...entry, read: true } : entry))
}

/**
 * And the same event, told by the operating system.
 *
 * The rule for what deserves an alert is this, and it is only one: the system
 * alert comes from the SAME entry that makes the bell ring from inside. Writing
 * here a second list of "what is worth alerting" was a guarantee that the two
 * would drift apart, and the day they drifted would be the day a mention
 * alerted in one place and not the other.
 *
 * What changes between the two is not the "what", it is the "when" and the "how
 * much": the bell records always, and the system only speaks when the person is
 * not looking.
 */

export type SystemNoticeVerdict =
  /** Say nothing. */
  | "silent"
  /** Say there is something new, with no name or text. */
  | "discreet"
  /** Say who and what. */
  | "detailed"

export interface SystemNoticeContext {
  /** The notifications switch, in Settings. */
  enabled: boolean
  /** "Busy": the person said they do not want to be interrupted. */
  busy: boolean
  /** "Show content": lets the name and text escape outside the app. */
  preview: boolean
  /** The window is open and in front, with the keyboard. */
  windowInFront: boolean
  /**
   * The channel open on screen, or `null`. With the window in front, it is the
   * conversation being read: the only alert that the window in front silences.
   */
  canalAberto?: string | null | undefined
  /** The vault is open. Closed, there is nothing decrypted to say. */
  unlocked: boolean
  /**
   * The place of this entry is muted (`lib/silenciados.ts`). Silences everything
   * except mention: being named still calls, like in Discord.
   */
  silenciado?: boolean | undefined
  /**
   * Notifications are paused ("Pause", phase 4). Silences everything: calls do
   * not go through this alert, they ring through the sound engine.
   */
  pausado?: boolean | undefined
}

/**
 * Whether this event should leave the app, and how much content to show.
 *
 * The silences, by weight:
 *
 * Vault closed silences everything. Locking releases the keys and ends the
 * session, so in this state nothing even arrives that could be said; this line
 * exists so the rule is written and not just implied, the same refusal is
 * made again in the process that holds the keys, which is where it can be
 * verified.
 *
 * "Busy" silences, because it is literally what the person asked for, and a
 * system alert is the hardest interruption the app has to ignore.
 *
 * The conversation open and being read silences: it is on screen, and a system
 * alert on top is the same news told twice. "Being read" is the window open,
 * with focus, and that channel open in it. A window visible behind the browser
 * does not count.
 *
 * The window in front used to silence EVERYTHING, and stopped silencing (request
 * of the owner and community, November 2, 2026, point 6). Someone reading a
 * conversation does not see the message that arrives in another: the bell swings
 * in a corner, and that does not reach. Now the system alert also leaves with
 * the window in front, except for the conversation that is open. Inside the app
 * there is no balloon repeating the same alert (see `avisarAmigoOnline`, in
 * `App.tsx`).
 *
 * And `channel-join` always silences, regardless of anything. Whoever uses an
 * invite of mine already joined, and nothing is lost if I know an hour later,  * it is noted next to the type declaration, and it is the same reason why it
 * does not become a balloon inside the app.
 */
export function systemNoticeVerdictOf(
  entry: AppNotification,
  context: SystemNoticeContext,
): SystemNoticeVerdict {
  if (!context.unlocked) return "silent"
  if (!context.enabled) return "silent"
  if (context.busy) return "silent"
  if (context.pausado) return "silent"
  if (context.windowInFront && entry.channel !== undefined && entry.channel === context.canalAberto) return "silent"
  if (entry.kind === "channel-join") return "silent"
  if (context.silenciado && entry.kind !== "mention") return "silent"
  return context.preview ? "detailed" : "discreet"
}

/** The alert already composed, on its way to the operating system. */
export interface SystemNotice {
  /** The one from the entry that generated it: this is how the click goes back to the right place. */
  id: string
  title: string
  body: string
  channel?: string | undefined
  /**
   * Can be counted in a visible icon.
   *
   * Only with `detailed`. A count of unread messages is content: it tells
   * someone passing by the screen that people are talking to you, and how many.
   * The preference that hides the text hides this for the same reason.
   */
  countable: boolean
  /**
   * The face of who the alert is about, as a data URL. Only the alert of a
   * friend online carries it, and only with "Show content": a face is a name
   * in another shape.
   */
  icon?: string | undefined
  /**
   * The alert closes by itself after this time, in milliseconds. Without it,
   * it stays for as long as the operating system decides.
   *
   * The alert of a friend online is 2 s (`AVISO_DO_AMIGO_MS`): order of the
   * owner on November 2, 2026, "2 seconds max, must not be the user who closes
   * it". An alert of presence reads at a glance; stuck on screen is noise.
   */
  expiraEmMs?: number | undefined
}

/** How long the alert of a friend online stays, on the system and inside the app. */
export const AVISO_DO_AMIGO_MS = 2000

/**
 * Who shows the alert, when the host knows how to do it better.
 *
 * On desktop it is the Electron main process: it is the only one that knows
 * if the vault is open, that can bring the window to the front on click, and
 * that has an icon in the system tray. In the browser there is nothing of this
 * and we fall back to the browser's own API, below.
 */
export interface SystemNoticeHost {
  show: (notice: SystemNotice, open: () => void) => void
  /**
   * The window is open and in front, according to whoever runs it.
   *
   * It exists because the document cannot answer this in a desktop app: measured,
   * a hidden Electron window still says `document.hidden === false` and
   * `document.hasFocus() === true`. The one with the right answer is the process
   * that creates and hides the window, and this value comes from there. In the
   * browser there is no such doubt and no such function.
   */
  windowInFront?: () => boolean
}

let host: SystemNoticeHost | null = null

/**
 * What the host knows about the window, or `null` if it has no opinion.
 *
 * Returning `null` instead of a guess is intentional: the caller has a
 * better answer than any guess we could make here.
 */
export function hostWindowInFront(): boolean | null {
  return host?.windowInFront?.() ?? null
}

/** Set once by the host at startup. `null` returns it to the browser. */
export function registerSystemNoticeHost(next: SystemNoticeHost | null): void {
  host = next
}

/**
 * Is there a host showing notices (the desktop app)?
 *
 * Then the browser permission doesn't matter: the renderer's `Notification` is
 * deliberately refused (`apps/client/src/main/permissoes.ts`), and notices
 * come from the main process. Reading the browser permission in the desktop app
 * said "blocked by browser" and locked the toggle (owner report,
 * 2 November 2026).
 */
export function temAnfitriaoDeAvisos(): boolean {
  return host !== null
}

/**
 * System notices are truly on: the user turned them on, and someone shows them
 * (the host, or the browser with permission). It's the same check that Settings
 * uses to show "Show content": only with this true does that toggle exist, and
 * only then does the user's choice matter inside the app
 * (friend cards, in `App.tsx`).
 */
export function avisosDoSistemaLigados(ligados: boolean): boolean {
  if (!ligados) return false
  if (host) return true
  return typeof Notification !== "undefined" && Notification.permission === "granted"
}

/**
 * Show it, to whoever can.
 *
 * `open` is what to do if the user taps the notice, and it's the same function
 * that opens the entry in the notification center. Tapping a system notice must
 * land in the right conversation, and a channel's route is decided in one place
 * only.
 */
export function showSystemNotice(notice: SystemNotice, open: () => void): CaminhoDoAviso {
  if (host) {
    host.show(notice, open)
    return "anfitriao"
  }
  // No host: the browser. Here the permission is the browser's own and may
  // never have been given, in which case this does nothing, as before.
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return null

  // First the notice from the page itself, which is the standard one and works on
  // all desktop browsers. Only when the constructor fails (Chrome on Android,
  // and that's literally its restriction) do we fall back to the Service Worker.
  if (showFromPage(notice, open)) return "pagina"
  showThroughWorker(notice, open)
  return "worker"
}

/**
 * How the notice was delivered, and thus whether it makes sound by itself.
 *
 * - `anfitriao`: Electron. The notice is silent (`silent: true`, in
 *   `apps/client/src/main/bandeja.ts`), and the sound comes from the app.
 * - `pagina`: desktop browser. Also silent (see `showFromPage`),
 *   for the same reason.
 * - `worker`: Android. The page may be paused in the background and play
 *   nothing; the notice makes system sound and vibration. It's the only path
 *   with its own sound, and it's what `sons/motor.ts` checks to avoid playing
 *   twice.
 * - `null`: no notice was delivered.
 */
export type CaminhoDoAviso = "anfitriao" | "pagina" | "worker" | null

/** The notice from this path already makes sound by itself. */
export function avisoTemSomProprio(caminho: CaminhoDoAviso): boolean {
  return caminho === "worker"
}

/**
 * The notice created by the page itself, which is the standard path.
 *
 * Returns `false` when the constructor fails. On Chrome for Android it throws
 * `TypeError` ("Illegal constructor"): there notices only work if they come from
 * a Service Worker. The `try` is there for that reason, and because a notice
 * that fails cannot drag down the notification inside the app, which is added
 * right after by the caller.
 */
function showFromPage(notice: SystemNotice, open: () => void): boolean {
  try {
    // Silent: the sound is the app's, with its volume and "Busy" state. A
    // second system sound for the same event would play twice.
    const shown = new Notification(notice.title, {
      body: notice.body,
      silent: true,
      ...(notice.icon ? { icon: notice.icon } : {}),
    })
    shown.onclick = () => {
      globalThis.focus?.()
      open()
    }
    if (notice.expiraEmMs) setTimeout(() => shown.close(), notice.expiraEmMs)
    return true
  } catch {
    return false
  }
}

/*
  The Service Worker path, which only the installable web app has
  (`apps/web/public/sw.js`, registered in `apps/web/src/main.tsx`), and which runs ONLY
  where the page can't create the notification itself.
  
  The order is intentional, and it used to be the other way. A notification created by a
  Service Worker is PERSISTENT: it doesn't die with the page, on Windows and Linux it doesn't
  close by itself and piles up in the notification center, and while it's there the browser
  saves its title and body to disk, outside the vault. With active logging, hitting the Service
  Worker first would put everyone there, Chrome on desktop included, to fix a problem only
  Android has. Desktop stays as it always was; on the desktop app (Electron) we don't even
  reach here because there's a host and `showSystemNotice` exits on the first line.
  
  A tap on one of these notifications doesn't reach here as an `onclick`: it goes to the Service
  Worker, which has no vault and no route so it only returns the symbol of the tapped notification.
  What to do with it stayed on this side, in `pendingOpens`, and it's the SAME `open` function
  that `onclick` would call.
  
  THE SYMBOL IS OURS, RANDOM, AND SAYS NOTHING. The real `notice.id` is
  `dm:<canal>:<mensagem>`: channel metadata, with a piece chosen by the sender. Sending it in
  `tag` or `data` would hand it to the browser to save in the clear, and let a sender choose the
  key for this map. We send a symbol drawn at random per notification, and the map is indexed by it.
  
  THE PRICE, ACCEPTED: without a common `tag`, two tabs open on the same account show the same
  notification twice. A `tag` that joined them would have to be the same in both and derived from
  `notice.id`, and without a key shared between tabs that isn't saved in the clear that's the id
  itself in other clothes. This path runs only on Android, where the installed app has one window:
  it's rare, and the fault is one extra notification, not one less secret.
  */
function showThroughWorker(notice: SystemNotice, open: () => void): void {
  const workers = serviceWorkersOf()
  if (!workers) return
  void workers
    .getRegistration()
    .then(async (registration) => {
      if (!registration?.active) return
      listenTo(workers)
      const token = rememberOpen(open)
      try {
        await registration.showNotification(notice.title, {
          body: notice.body,
          data: { id: token },
          ...(notice.icon ? { icon: notice.icon } : {}),
          // The tag is what lets us find THIS notice to close it.
          ...(notice.expiraEmMs ? { tag: token } : {}),
        })
        if (notice.expiraEmMs) {
          setTimeout(() => {
            void registration
              .getNotifications({ tag: token })
              .then((avisos) => {
                for (const aviso of avisos) aviso.close()
              })
              .catch(() => {})
          }, notice.expiraEmMs)
        }
      } catch {
        pendingOpens.delete(token)
      }
    })
    // No system notice. The app's bell still counts.
    .catch(() => {})
}

/** The type of message that `sw.js` sends when a notice is tapped. */
export const NOTICE_CLICK_MESSAGE = "enclave.notice-click"

/** Cap for what waits for a tap that may never come. */
const PENDING_OPENS_CAP = 50

const pendingOpens = new Map<string, () => void>()
let listeningTo: ServiceWorkerContainer | null = null

function serviceWorkersOf(): ServiceWorkerContainer | null {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null
  return navigator.serviceWorker ?? null
}

/** 128 bits from the system generator, in hexadecimal. Derives from nothing. */
function opaqueToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** Stores what to do on tap, and returns the symbol that will bring it back. */
function rememberOpen(open: () => void): string {
  const token = opaqueToken()
  pendingOpens.set(token, open)
  // A `Map` preserves insertion order: the first is the oldest.
  while (pendingOpens.size > PENDING_OPENS_CAP) {
    const oldest = pendingOpens.keys().next().value
    if (oldest === undefined) break
    pendingOpens.delete(oldest)
  }
  return token
}

function listenTo(workers: ServiceWorkerContainer): void {
  if (listeningTo === workers) return
  listeningTo = workers
  workers.addEventListener("message", (event) => {
    const data = (event as MessageEvent<unknown>).data as { type?: unknown; id?: unknown } | null
    if (!data || data.type !== NOTICE_CLICK_MESSAGE || typeof data.id !== "string") return
    // The window comes to front even if the symbol no longer means anything on this page.
    globalThis.focus?.()
    const open = pendingOpens.get(data.id)
    if (!open) return
    pendingOpens.delete(data.id)
    open()
  })
}

/**
 * Listen for taps from startup, not just after the first notice.
 *
 * The listener was set when showing a notice. A page freshly reloaded, which
 * hasn't shown any yet, had no listener: tapping a notice left over from before
 * did nothing. `App` calls this once, on mount.
 *
 * After reload, the tap ONLY BRINGS THE WINDOW TO FRONT. The map lives in the
 * memory of the page that showed the notice and died with it, and the notice
 * doesn't carry the channel on purpose (see above): there's no way to know which
 * conversation to open, and that's the fair price for not storing the channel
 * in plaintext outside the vault.
 *
 * With a host (the desktop app) it does nothing, and without
 * `navigator.serviceWorker` either.
 */
export function listenForSystemNoticeClicks(): void {
  if (host) return
  const workers = serviceWorkersOf()
  if (workers) listenTo(workers)
}

/** The sentence a notification shows, resolved with live names. */
export function notificationTextOf(
  entry: AppNotification,
  nameFor: (address: string) => string,
  labelFor: (channel: string) => string,
): string {
  const who = entry.actor ? nameFor(entry.actor) : ""
  switch (entry.kind) {
    case "room-added":
      return strings.notifCenter.roomAdded(entry.channel ? labelFor(entry.channel) : "?")
    case "dm-new":
      return strings.notifCenter.dmNew(who)
    case "friend-request":
      // The label of the whole app, one key for all: the bell, Pending, the
      // conversation and the profile sheet say the same phrase. Friendship is mutual,
      // and calling it follow described what this was before.
      return strings.people.wantsToBeFriends(who)
    case "friend-accept":
      return strings.notifCenter.friendAccept(who)
    case "dm-message":
      return strings.notifCenter.dmMessage(who)
    case "channel-join":
      return strings.notifCenter.joinedByInvite(who, entry.channel ? labelFor(entry.channel) : "?")
    case "mention":
      return strings.notifCenter.mention(who, entry.channel ? labelFor(entry.channel) : "?")
    case "missed-call":
      return strings.notifCenter.chamadaPerdida(who)
    case "report-copy":
      return strings.notifications.reportCopy
    case "report-decision":
      return entry.decisao
        ? `${strings.notifications.reportDecision(entry.decisao)} ${strings.notifications.reportDecisionVias}`
        : strings.notifications.reportDecisionVias
  }
}
