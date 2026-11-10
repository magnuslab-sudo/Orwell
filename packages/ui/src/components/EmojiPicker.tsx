import { useEffect, useRef, useState } from "react"
import { Modal } from "./Modal.js"
import { CATEGORIES, findEmoji, searchEmoji, type Emoji } from "./emoji.js"
import { useEmojiRecents } from "../hooks/usePrefs.js"
import { strings } from "../strings.js"

/**
 * Number of grid columns.
 *
 * Fixed, not `auto-fill`, because arrow keys need to know how many cells fit
 * in a row to move down: with the column count decided by the browser, the
 * down key would have to guess from geometry, which does not exist in tests
 * and changes mid-screen on narrow displays. Must match the `repeat(8, 1fr)`
 * in `.emoji-grid`.
 */
const COLUMNS = 8

/** The recent separator only appears when there are recent items. */
const RECENTS_ID = "recentes"

/**
 * The emoji picker.
 *
 * Lives inside the `Modal` on purpose: Escape, focus on open, Tab trapped
 * inside, and focus returned to the opener are already solved and tested in
 * that file. What belongs here is arrow key navigation, because a grid is not
 * traversed like a list, you move horizontally and vertically, and Tab would
 * have to pass through hundreds of buttons to exit.
 *
 * So the grid uses roving tabindex: only one button is reachable by Tab, the
 * others respond to arrows. The "Close" button in the footer is not decoration,  * it is the last focusable element in the card, and closes the Tab cycle.
 */
export function EmojiPicker({
  onPick,
  onClose,
}: {
  onPick: (char: string) => void
  onClose: () => void
}): React.JSX.Element {
  const { recents, remember } = useEmojiRecents()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string>(() => (recents.length > 0 ? RECENTS_ID : (CATEGORIES[0]?.id ?? "")))
  const [cursor, setCursor] = useState(0)
  const [hint, setHint] = useState<string | null>(null)
  const grid = useRef<HTMLDivElement>(null)

  const searching = query.trim().length > 0

  // A recent emoji no longer known to the catalog still appears: it is better to
  // show it with its own glyph by name than make it disappear from someone's list
  // because of an edit in this repository.
  const recentList: Emoji[] = recents.map(
    (char) => findEmoji(char) ?? { char, name: char, haystack: "" },
  )

  const current = CATEGORIES.find((entry) => entry.id === category)

  const shown: Emoji[] = searching
    ? searchEmoji(query)
    : category === RECENTS_ID
      ? recentList
      : (current?.emojis ?? [])

  const groupLabel = searching
    ? strings.emoji.results
    : category === RECENTS_ID
      ? strings.emoji.recents
      : current
        ? strings.emoji.categorias[current.id]
        : strings.emoji.title

  // Switching lists puts the cursor at the start. Without this, Tab would enter
  // the grid at a button that no longer exists, and focus would fall to the page body.
  useEffect(() => {
    setCursor(0)
  }, [query, category])

  const focusAt = (index: number): void => {
    const buttons = grid.current?.querySelectorAll<HTMLButtonElement>("button")
    const target = buttons?.[index]
    if (!target) return
    setCursor(index)
    target.focus()
    // jsdom does not implement scrollIntoView; the optional chaining keeps the
    // keyboard working in tests without involving the test file in the question.
    target.scrollIntoView?.({ block: "nearest" })
  }

  const choose = (char: string): void => {
    remember(char)
    onPick(char)
    onClose()
  }

  return (
    <Modal className="emoji-panel" labelledBy="emoji-title" onClose={onClose}>
      <h2 id="emoji-title" className="emoji-title">
        {strings.emoji.title}
      </h2>

      <input
        className="emoji-search"
        value={query}
        aria-label={strings.emoji.searchLabel}
        placeholder={strings.emoji.searchPlaceholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // Type and press Enter is the shortest path for someone who already knows the
          // emoji name; the down arrow hands the grid to the keyboard.
          if (event.key === "Enter") {
            event.preventDefault()
            const first = shown[0]
            if (first) choose(first.char)
          }
          if (event.key === "ArrowDown") {
            event.preventDefault()
            focusAt(0)
          }
        }}
      />

      <div className="emoji-tabs">
        {recents.length > 0 && (
          <button
            type="button"
            className={!searching && category === RECENTS_ID ? "emoji-tab on" : "emoji-tab"}
            aria-pressed={!searching && category === RECENTS_ID}
            title={strings.emoji.recents}
            aria-label={strings.emoji.recents}
            onClick={() => {
              setQuery("")
              setCategory(RECENTS_ID)
            }}
          >
            🕐
          </button>
        )}
        {CATEGORIES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={!searching && category === entry.id ? "emoji-tab on" : "emoji-tab"}
            aria-pressed={!searching && category === entry.id}
            title={strings.emoji.categorias[entry.id]}
            aria-label={strings.emoji.categorias[entry.id]}
            // Choosing a category during a broad search clears the search: both show in
            // the same place and cannot contradict each other.
            onClick={() => {
              setQuery("")
              setCategory(entry.id)
            }}
          >
            {entry.symbol}
          </button>
        ))}
      </div>

      <div
        ref={grid}
        className="emoji-grid"
        role="group"
        aria-label={groupLabel}
        onKeyDown={(event) => {
          const last = shown.length - 1
          if (last < 0) return
          // At the edges the cursor stops instead of wrapping: in a grid, jumping from
          // the end to the start makes you lose your place while reading.
          const moves: Record<string, number | undefined> = {
            ArrowRight: Math.min(cursor + 1, last),
            ArrowLeft: Math.max(cursor - 1, 0),
            ArrowDown: Math.min(cursor + COLUMNS, last),
            ArrowUp: Math.max(cursor - COLUMNS, 0),
            Home: 0,
            End: last,
          }
          const next = moves[event.key]
          if (next === undefined) return
          event.preventDefault()
          focusAt(next)
        }}
        onMouseLeave={() => setHint(null)}
      >
        {shown.map((emoji, index) => (
          <button
            key={`${emoji.char}-${index}`}
            type="button"
            className="emoji-cell"
            // Only one button per grid is reachable by Tab. See the header comment:
            // arrows do the rest.
            tabIndex={index === cursor ? 0 : -1}
            title={emoji.name}
            aria-label={emoji.name}
            onFocus={() => {
              setCursor(index)
              setHint(emoji.name)
            }}
            onMouseEnter={() => setHint(emoji.name)}
            onClick={() => choose(emoji.char)}
          >
            {emoji.char}
          </button>
        ))}
        {shown.length === 0 && <p className="emoji-empty">{strings.emoji.noResults}</p>}
      </div>

      <footer className="emoji-foot">
        <span className="emoji-hint">{hint}</span>
        <button type="button" className="emoji-close" onClick={onClose}>
          {strings.emoji.close}
        </button>
      </footer>
    </Modal>
  )
}
