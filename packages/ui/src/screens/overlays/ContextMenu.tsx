import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { strings } from "../../strings.js"

/**
 * An entry that is a slider and not a button: a person's volume in the call
 * (owner request on 2 November 2026, "I want a volume bar").
 *
 * The values are the slider values, already in the unit shown (percent): whoever
 * builds the entry converts to what it stores. See `itensDaPessoaNaChamada`.
 */
export interface MenuDeslizante {
  valor: number
  min: number
  max: number
  passo: number
  /** The reference value: marked on the bar, and what double-click restores. */
  normal: number
  /** Called at each step, while dragging, not just when released. */
  aoMudar: (valor: number) => void
  /** The slider name for screen reader users: it says WHOSE volume it is. */
  ariaLabel: string
  textoDoValor: (valor: number) => string
  /** The short button text that restores normal, and its full name. */
  textoRepor: string
  ariaRepor: string
}

export interface MenuItem {
  label: string
  onSelect: () => void
  destructive?: boolean
  separatorBefore?: boolean
  /**
   * A banner above this entry, naming the block it opens.
   *
   * It exists because of a concrete situation: the menu for someone in a voice
   * room is the menu of the PERSON, see profile, copy address, send message,    * plus a list of destinations to move them to. The destinations came after a
   * line and nothing else, so "Move to Studio" appeared as a sibling of "See
   * profile": two kinds of action in the same list, with nothing saying where
   * one ends and the other starts.
   *
   * **`role="presentation"`, and why it is no more than that:** a proper menu
   * would group entries in a `role="group"` with `aria-label`, and that forced
   * the list to stop being flat. The banner is VISUAL help, and screen reader
   * users are still served by the label on each entry, which already names the
   * destination in full. Announcing it like it was an entry was worse: a menu
   * item you cannot choose.
   */
  section?: string
  /**
   * This entry is a slider. The `label` becomes a banner above it, and
   * `onSelect` is the action to restore normal (the small button next to it).
   *
   * **Moving the slider does not close the menu**, unlike all the other entries:
   * someone adjusting a volume hears, corrects and hears again. Closing at each
   * step forced you to reopen the menu for each correction.
   */
  deslizante?: MenuDeslizante
  /**
   * This entry opens a second menu in a cascade to the right (2/11/2026, owner
   * request: "I want a move to room option, then cascade the rooms").
   *
   * Entries inside can have `section`, which is how voice rooms group by
   * category. With an entry that has a submenu, its `onSelect` is not called:
   * choosing means opening the cascade.
   *
   * On mobile there is no right side to open into: the cascade opens as a sheet
   * at the bottom of the screen, with "Back" at the top.
   */
  submenu?: MenuItem[]
}

/** Below this the cascade opens as a sheet, not to the side. See `submenu`. */
const LARGURA_DA_FOLHA = 600

const ehEstreito = (): boolean => typeof window !== "undefined" && window.innerWidth <= LARGURA_DA_FOLHA

/** The focusable entries in a menu, in the order they appear. */
const focaveis = (raiz: HTMLElement | null): HTMLElement[] => [
  ...(raiz?.querySelectorAll<HTMLElement>('[role="menuitem"], .menu-deslizante input') ?? []),
]

/** Change focus within a menu, wrapping at the start and end. */
function moverFoco(raiz: HTMLElement | null, delta: number): void {
  const botoes = focaveis(raiz)
  if (botoes.length === 0) return
  const indice = botoes.findIndex((botao) => botao === document.activeElement)
  const seguinte = indice === -1 ? (delta > 0 ? 0 : botoes.length - 1) : (indice + delta + botoes.length) % botoes.length
  botoes[seguinte]?.focus()
}

/** The entries in a menu, with their dividers and labels. */
function Entradas({
  items,
  onClose,
  aberto,
  abrir,
  fechar,
}: {
  items: MenuItem[]
  onClose: () => void
  /** The index of the entry whose cascade is open, or null. */
  aberto?: number | null
  abrir?: (indice: number, botao: HTMLElement, foco: boolean) => void
  /** Hovering the mouse over another entry closes the cascade, like any menu. */
  fechar?: () => void
}): React.JSX.Element {
  return (
    <>
      {items.map((item, index) => (
        <span key={index}>
          {item.separatorBefore && <hr />}
          {item.section && (
            <p className="menu-section" role="presentation">
              {item.section}
            </p>
          )}
          {item.deslizante ? (
            <EntradaDeslizante item={item} barra={item.deslizante} />
          ) : item.submenu && abrir ? (
            <button
              className="menu-com-escada"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={aberto === index}
              data-aberta={aberto === index ? "sim" : undefined}
              onClick={(evento) => abrir(index, evento.currentTarget, evento.detail === 0)}
              onPointerEnter={(evento) => {
                // Hovering opens the cascade with mouse only: on a touch screen the finger
                // "hovers" on the same gesture as pressing, and would open and close.
                if (evento.pointerType === "mouse" && !ehEstreito()) abrir(index, evento.currentTarget, false)
              }}
              onKeyDown={(evento) => {
                if (evento.key === "ArrowRight") {
                  evento.preventDefault()
                  evento.stopPropagation()
                  abrir(index, evento.currentTarget, true)
                }
              }}
            >
              <span>{item.label}</span>
              <span className="menu-escada-seta" aria-hidden="true">
                ›
              </span>
            </button>
          ) : (
            <button
              className={item.destructive ? "destructive" : ""}
              role="menuitem"
              onPointerEnter={(evento) => {
                if (evento.pointerType === "mouse") fechar?.()
              }}
              onClick={() => {
                onClose()
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          )}
        </span>
      ))}
    </>
  )
}

/**
 * The cursor of an entry with `deslizante`.
 *
 * The value shown is local while dragging: the menu builder recalculates the
 * entries at each step, but the number next to the cursor cannot wait for that
 * to follow the finger.
 */
function EntradaDeslizante({ item, barra }: { item: MenuItem; barra: MenuDeslizante }): React.JSX.Element {
  const [valor, setValor] = useState(barra.valor)
  useEffect(() => setValor(barra.valor), [barra.valor])

  const mudar = (seguinte: number): void => {
    setValor(seguinte)
    barra.aoMudar(seguinte)
  }
  const fraccao = (valor - barra.min) / (barra.max - barra.min)
  const fraccaoNormal = (barra.normal - barra.min) / (barra.max - barra.min)

  return (
    <div className="menu-deslizante">
      <span className="menu-deslizante-letreiro" aria-hidden="true">
        {item.label}
      </span>
      <span className="menu-deslizante-fila">
        <span
          className="menu-deslizante-pista"
          style={
            {
              "--menu-deslizante-cheio": `${fraccao * 100}%`,
              "--menu-deslizante-normal": `${fraccaoNormal * 100}%`,
            } as React.CSSProperties
          }
        >
          <input
            type="range"
            min={barra.min}
            max={barra.max}
            step={barra.passo}
            value={valor}
            aria-label={barra.ariaLabel}
            aria-valuetext={barra.textoDoValor(valor)}
            // React's `onChange` fires on each `input` event, that is, at each step while
            // dragging, not just on release like DOM's `change`. That is what makes the
            // sound change under the finger.
            onChange={(evento) => mudar(Number(evento.currentTarget.value))}
            onDoubleClick={() => mudar(barra.normal)}
          />
          {/* The standard mark, where the thumb sits at 100%. */}
          <span className="menu-deslizante-marca" aria-hidden="true" />
        </span>
        <output className="menu-deslizante-valor">{barra.textoDoValor(valor)}</output>
        <button
          type="button"
          className="menu-deslizante-repor"
          aria-label={barra.ariaRepor}
          title={barra.ariaRepor}
          onClick={() => {
            setValor(barra.normal)
            item.onSelect()
          }}
        >
          {barra.textoRepor}
        </button>
      </span>
    </div>
  )
}

/**
 * A right-click menu, positioned at the pointer and clamped to the viewport.
 *
 * Rendered in the page rather than through a native context menu: the desktop
 * build could ask Electron for one, but then the browser build would need a
 * second implementation of every entry, and the two would drift.
 */
export function ContextMenu({
  at,
  items,
  onClose,
}: {
  at: { x: number; y: number }
  items: MenuItem[]
  onClose: () => void
}): React.JSX.Element {
  const menu = useRef<HTMLDivElement>(null)
  const escada = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(at)
  /**
   * The open cascade: which entry opened it, where its button is, and whether
   * focus should enter it (keyboard) or stay where it is (mouse).
   */
  const [aberta, setAberta] = useState<{ indice: number; botao: HTMLElement; foco: boolean } | null>(null)
  const [posicaoDaEscada, setPosicaoDaEscada] = useState<{ x: number; y: number } | null>(null)
  const [estreito, setEstreito] = useState(ehEstreito)

  useEffect(() => {
    const box = menu.current?.getBoundingClientRect()
    if (!box) return
    setPosition({
      x: Math.min(at.x, window.innerWidth - box.width - 8),
      y: Math.min(at.y, window.innerHeight - box.height - 8),
    })
  }, [at.x, at.y])

  useEffect(() => {
    // Capture phase, so a click that also triggers something else still
    // closes the menu — but never a press inside it: closing on the item's
    // own pointerdown unmounts the button before its click can fire, which
    // silently disabled every entry. The item's onClick closes instead.
    /*
      `pointerdown` not `mousedown`, since the menu started opening with a
      finger.

      A `mousedown` on a touch screen is not a touch event: it is a
      COMPATIBILITY event the browser synthesizes after `touchend`, and its
      target is the line where the finger landed, outside the menu. With the
      menu opening on long press, releasing the finger would dismiss the menu
      that had just opened: it would flicker and disappear. `pointerdown` is the
      real event, arrives the same for mouse and finger, and makes this
      independent of the events the browser invents for courtesy.
    */
    const dismiss = (event: PointerEvent): void => {
      if (event.target instanceof Node) {
        if (menu.current?.contains(event.target)) return
        if (escada.current?.contains(event.target)) return
      }
      onClose()
    }
    const close = (): void => {
      setEstreito(ehEstreito())
      onClose()
    }
    window.addEventListener("pointerdown", dismiss, true)
    window.addEventListener("resize", close)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("pointerdown", dismiss, true)
      window.removeEventListener("resize", close)
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  // Keyboard reachability: focus lands on the first entry when the menu opens
  // and returns to whatever had it when the menu goes away.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    return () => opener?.focus()
  }, [])

  // Cursors enter the arrow area like any entry. Inside it, left and right
  // change the value; up and down change entry.
  const move = (delta: number): void => moverFoco(menu.current, delta)

  const itensDaEscada = aberta ? (items[aberta.indice]?.submenu ?? null) : null

  /**
   * Where the cascade sits: to the right of the entry that opened it, with the
   * top aligned with it; if there is no room to the right, to the left of the
   * menu. Measured after drawing, like the menu, to fit on screen.
   */
  useLayoutEffect(() => {
    if (!aberta || estreito) {
      setPosicaoDaEscada(null)
      return
    }
    const caixa = escada.current?.getBoundingClientRect()
    const mae = menu.current
    if (!caixa || !mae) return
    /*
      Menu measurements by `offset` not by the drawn box: the menu enters with a
      scale animation, and the box partway through is smaller than the menu.
      By the box, the cascade would open above its edge.
    */
    const esquerda = mae.offsetLeft
    const direita = esquerda + mae.offsetWidth
    const largura = caixa.width
    const aDireita = direita - 4
    const x = aDireita + largura + 8 <= window.innerWidth ? aDireita : Math.max(8, esquerda - largura + 4)
    const y = Math.max(8, Math.min(aberta.botao.getBoundingClientRect().top - 8, window.innerHeight - caixa.height - 8))
    setPosicaoDaEscada({ x, y })
  }, [aberta, estreito])

  // Focus enters the cascade when the keyboard opened it.
  useEffect(() => {
    if (aberta?.foco) focaveis(escada.current)[0]?.focus()
  }, [aberta])

  /** Close the cascade with the left arrow: focus returns to the entry that opened it. */
  const fecharEscada = (): void => {
    const botao = aberta?.botao
    setAberta(null)
    botao?.focus()
  }

  const abrir = (indice: number, botao: HTMLElement, foco: boolean): void => {
    setEstreito(ehEstreito())
    // Already open with the mouse, a click does not close it: hovering and
    // pressing are the same gesture for mouse users, and closing on click would
    // flicker.
    setAberta((actual) => (actual?.indice === indice && !foco ? actual : { indice, botao, foco }))
  }

  const escadaAberta = itensDaEscada !== null && aberta !== null
  const folha = escadaAberta && estreito

  return (
    <>
      {!folha && (
        <div
          ref={menu}
          className="context-menu"
          role="menu"
          style={{ left: position.x, top: position.y }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault()
              move(1)
            }
            if (event.key === "ArrowUp") {
              event.preventDefault()
              move(-1)
            }
          }}
        >
          <Entradas
            items={items}
            onClose={onClose}
            aberto={aberta?.indice ?? null}
            abrir={abrir}
            fechar={() => setAberta(null)}
          />
        </div>
      )}
      {escadaAberta && (
        <div
          ref={escada}
          className={folha ? "context-menu context-folha" : "context-menu context-escada"}
          role="menu"
          aria-label={items[aberta.indice]?.label}
          style={folha ? undefined : { left: posicaoDaEscada?.x ?? -9999, top: posicaoDaEscada?.y ?? -9999 }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault()
              event.stopPropagation()
              moverFoco(escada.current, 1)
            }
            if (event.key === "ArrowUp") {
              event.preventDefault()
              event.stopPropagation()
              moverFoco(escada.current, -1)
            }
            if (event.key === "ArrowLeft") {
              event.preventDefault()
              event.stopPropagation()
              fecharEscada()
            }
          }}
        >
          {folha && (
            <>
              <button className="menu-voltar" role="menuitem" onClick={() => setAberta(null)}>
                <span aria-hidden="true">‹ </span>
                {strings.voiceMove.back}
              </button>
              <p className="menu-folha-titulo" role="presentation">
                {items[aberta.indice]?.label}
              </p>
            </>
          )}
          <Entradas items={itensDaEscada} onClose={onClose} />
        </div>
      )}
    </>
  )
}
