/**
 * A short, in-memory record of what this session has been doing.
 *
 * Why it exists: every serious bug in this app so far has only appeared on
 * real accounts, several rooms, half-finished friendships, welcomes piled up,
 * a large history, and the person hitting it could only report "nothing happens".
 * That is not their fault; there was nothing for them to look at. This
 * gives them one thing to copy and paste.
 *
 * What it holds: mechanics only. Event kind, channel, time, outcome. Never a
 * message body, never a name someone typed, never anything decrypted, never
 * anything that leaves the device on its own, it lives in memory, dies with
 * the tab, and is only ever copied when a person presses the button.
 *
 * Channels are shortened to their local part, which is what makes a line
 * readable, and addresses to their first characters, which is enough to tell
 * two people apart in a log without writing anybody's full identity into a
 * paste that may end up in a chat window.
 */

export interface DiagnosticEntry {
  at: number
  kind: "status" | "connection" | "channels" | "epoch" | "message" | "action"
  /** A stable name for what happened, when the source has one. */
  code?: string | undefined
  channel?: string | undefined
  /** Short mechanical detail. Never message content. */
  detail?: string | undefined
  /** What the app did with it: "toast", "log", "notice", "quiet-window"… */
  outcome?: string | undefined
}

/** Roughly the last few minutes of a busy connection; enough to see a burst. */
export const DIAGNOSTIC_CAP = 200

/** Newest last, capped. Pure, so the cap is testable without a session. */
export function appendDiagnostic(list: DiagnosticEntry[], entry: DiagnosticEntry): DiagnosticEntry[] {
  const next = [...list, entry]
  return next.length > DIAGNOSTIC_CAP ? next.slice(next.length - DIAGNOSTIC_CAP) : next
}

/** `!sala:servidor` → `sala`. Nothing here needs the homeserver on every line. */
export function shortChannel(channel: string): string {
  const withoutServer = channel.slice(0, channel.indexOf(":") === -1 ? undefined : channel.indexOf(":"))
  return withoutServer.replace(/^[!#]/, "")
}

/** `@k4x7m2pq8rtv…:orwell.pt` → `@k4x7m2p…`. Enough to tell people apart. */
export function shortActor(address: string): string {
  const local = address.slice(0, address.indexOf(":") === -1 ? undefined : address.indexOf(":"))
  return local.length > 8 ? `${local.slice(0, 8)}…` : local
}

let log: DiagnosticEntry[] = []

export function recordDiagnostic(entry: Omit<DiagnosticEntry, "at"> & { at?: number }): void {
  const { at, ...rest } = entry
  log = appendDiagnostic(log, {
    at: at ?? Date.now(),
    ...rest,
    ...(rest.channel ? { channel: shortChannel(rest.channel) } : {}),
  })
}

export function diagnosticsSnapshot(): DiagnosticEntry[] {
  return [...log]
}

export function clearDiagnostics(): void {
  log = []
}

function stamp(at: number): string {
  const date = new Date(at)
  const pad = (value: number, size = 2): string => String(value).padStart(size, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

export interface DiagnosticHeader {
  /** The account, shortened. Optional: the log is useful without it. */
  address?: string | null
  connection?: string
  channels?: number
  /** The line that says what this is, so a pasted log explains itself. */
  note: string
}

/**
 * The log as text, ready to paste into a report.
 *
 * Deliberately plain: one line per event, no JSON to mangle in a chat client,
 * and a header that says what the file is and what it deliberately does not
 * contain — so nobody has to take the word "metadata" on trust.
 */
export function formatDiagnostics(entries: DiagnosticEntry[], header: DiagnosticHeader): string {
  const lines = [
    "Orwell — registo de diagnóstico",
    header.note,
    `gerado: ${new Date().toISOString()}`,
    ...(header.address ? [`conta: ${shortActor(header.address)}`] : []),
    ...(header.connection ? [`ligação: ${header.connection}`] : []),
    ...(header.channels === undefined ? [] : [`canais: ${header.channels}`]),
    `eventos: ${entries.length}`,
    "—",
  ]

  for (const entry of entries) {
    const parts = [stamp(entry.at), entry.kind]
    if (entry.channel) parts.push(`#${entry.channel}`)
    if (entry.code) parts.push(entry.code)
    if (entry.outcome) parts.push(`→${entry.outcome}`)
    if (entry.detail) parts.push(entry.detail)
    lines.push(parts.join("  "))
  }

  return lines.join("\n")
}
