import { useEffect, useRef } from "react"
import {
  ATALHOS_POR_OMISSAO,
  accaoDaCombinacao,
  combinacaoDeEvento,
  combinacaoDeRato,
  pertenceACaixaDeTexto,
  type AccaoDeVoz,
  type MapaDeAtalhos,
} from "../lib/atalhosDeVoz.js"

export interface Atalhos {
  alternarMicrofone?: (() => void) | undefined
  alternarSom?: (() => void) | undefined
  alternarCamara?: (() => void) | undefined
  alternarEcra?: (() => void) | undefined
  sairDaChamada?: (() => void) | undefined
  /**
   * Hold to speak: `true` when the key goes down, `false` when it goes up (or
   * when the window loses focus with it held down, which counts as release).
   */
  falar?: ((aCarregar: boolean) => void) | undefined
  canalAnterior?: (() => void) | undefined
  canalSeguinte?: (() => void) | undefined
  /** Show or hide the game overlay. Desktop app only. */
  alternarOverlay?: (() => void) | undefined
}

export function aEscrever(alvo: EventTarget | null): boolean {
  const no = alvo as HTMLElement | null
  if (!no || typeof no.tagName !== "string") return false
  const etiqueta = no.tagName.toLowerCase()
  return etiqueta === "input" || etiqueta === "textarea" || etiqueta === "select" || no.isContentEditable === true
}

const ACCAO_DE_VOZ_PARA_ATALHO: Record<AccaoDeVoz, keyof Atalhos> = {
  microfone: "alternarMicrofone",
  som: "alternarSom",
  camara: "alternarCamara",
  ecra: "alternarEcra",
  sair: "sairDaChamada",
  falar: "falar",
  overlay: "alternarOverlay",
}

/**
 * Which shortcut is this event, if any.
 *
 * The two for navigation are fixed (Alt + arrows). The voice ones come from
 * `mapa`, which the person changes in Settings; by default the microphone
 * stays on Ctrl or Cmd + Shift + M, which is what it always was.
 */
export function accaoDe(
  event: {
    key: string
    ctrlKey?: boolean
    metaKey?: boolean
    shiftKey?: boolean
    altKey?: boolean
  },
  mapa: MapaDeAtalhos = ATALHOS_POR_OMISSAO,
): keyof Atalhos | null {
  if (event.altKey === true && !event.ctrlKey && !event.metaKey && event.key === "ArrowUp") return "canalAnterior"
  if (event.altKey === true && !event.ctrlKey && !event.metaKey && event.key === "ArrowDown") return "canalSeguinte"
  const combinacao = combinacaoDeEvento(event)
  if (!combinacao) return null
  const accao = accaoDaCombinacao(combinacao, mapa)
  return accao ? ACCAO_DE_VOZ_PARA_ATALHO[accao] : null
}

/** The voice command for this mouse button, if any. Only buttons 4 and 5 count. */
export function accaoDoRato(
  event: { button: number; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean },
  mapa: MapaDeAtalhos = ATALHOS_POR_OMISSAO,
): keyof Atalhos | null {
  const combinacao = combinacaoDeRato(event)
  if (!combinacao) return null
  const accao = accaoDaCombinacao(combinacao, mapa)
  return accao ? ACCAO_DE_VOZ_PARA_ATALHO[accao] : null
}

const SEM_GLOBAIS: ReadonlySet<AccaoDeVoz> = new Set()

/**
 * Listens to the keyboard and mouse buttons 4 and 5 while the window is in
 * focus.
 *
 * `obterGlobais` says which commands the desktop app already registered as
 * global (see `useAtalhosGlobais`). Those are not handled here: the system
 * delivers the key to the global shortcut BEFORE the window, and if on some
 * system it reached both, the microphone would toggle twice and stay the same.
 */
export function useAtalhos(
  atalhos: Atalhos,
  obterMapa: () => MapaDeAtalhos = () => ATALHOS_POR_OMISSAO,
  obterGlobais: () => ReadonlySet<AccaoDeVoz> = () => SEM_GLOBAIS,
): void {
  const actuais = useRef(atalhos)
  actuais.current = atalhos
  const mapaActual = useRef(obterMapa)
  mapaActual.current = obterMapa
  const globaisActuais = useRef(obterGlobais)
  globaisActuais.current = obterGlobais

  useEffect(() => {
    // The key (or mouse button) that is down for speaking, to release it on the
    // right press up and not on any other key that happens to go up first.
    let teclaAFalar: string | null = null

    const largarFalar = (): void => {
      if (teclaAFalar === null) return
      teclaAFalar = null
      actuais.current.falar?.(false)
    }

    const tratadoPeloGlobal = (qual: keyof Atalhos): boolean => {
      const globais = globaisActuais.current()
      if (globais.size === 0) return false
      for (const [accao, nome] of Object.entries(ACCAO_DE_VOZ_PARA_ATALHO)) {
        if (nome === qual) return globais.has(accao as AccaoDeVoz)
      }
      return false
    }

    /** Same path for key and button: `id` is what has to go up to release "speak". */
    const accionar = (qual: keyof Atalhos, id: string, repetida: boolean, impedir: () => void): void => {
      if (tratadoPeloGlobal(qual)) return
      if (qual === "falar") {
        if (!actuais.current.falar) return
        impedir()
        if (repetida || teclaAFalar !== null) return
        teclaAFalar = id
        actuais.current.falar(true)
        return
      }
      const accao = actuais.current[qual]
      if (!accao) return
      // Only after there is an action: `preventDefault` on a combo we won't use
      // takes it from the browser for nothing in return.
      impedir()
      ;(accao as () => void)()
    }

    const aoCarregar = (event: KeyboardEvent): void => {
      const qual = accaoDe(event, mapaActual.current())
      if (!qual) return
      // In a text box, what types or moves the cursor stays with the box. A
      // function key or a combo with Mod or Alt passes through.
      const combinacao = combinacaoDeEvento(event)
      if (aEscrever(event.target) && combinacao !== null && pertenceACaixaDeTexto(combinacao)) return
      accionar(qual, `tecla:${event.key}`, event.repeat, () => event.preventDefault())
    }

    const aoLargar = (event: KeyboardEvent): void => {
      if (teclaAFalar !== null && teclaAFalar === `tecla:${event.key}`) largarFalar()
    }

    /*
      Mouse buttons 4 and 5. In the browser, by default they are "back" and
      "forward" in history: without the `preventDefault` on both down and up,
      the button someone picked to mute would take them out of the app. We only
      prevent it when the button has a command, so we do not steal navigation
      from people who do not use it.
      */
    const aoCarregarNoRato = (event: MouseEvent): void => {
      const qual = accaoDoRato(event, mapaActual.current())
      if (!qual) return
      accionar(qual, `rato:${event.button}`, false, () => event.preventDefault())
    }

    const aoLargarORato = (event: MouseEvent): void => {
      if (accaoDoRato(event, mapaActual.current())) event.preventDefault()
      if (teclaAFalar !== null && teclaAFalar === `rato:${event.button}`) largarFalar()
    }

    document.addEventListener("keydown", aoCarregar)
    document.addEventListener("keyup", aoLargar)
    document.addEventListener("mousedown", aoCarregarNoRato)
    document.addEventListener("mouseup", aoLargarORato)
    // `auxclick` is a click on a button other than the main one; we prevent it
    // for the same reason as `mouseup`.
    document.addEventListener("auxclick", aoLargarORato)
    window.addEventListener("blur", largarFalar)
    return () => {
      document.removeEventListener("keydown", aoCarregar)
      document.removeEventListener("keyup", aoLargar)
      document.removeEventListener("mousedown", aoCarregarNoRato)
      document.removeEventListener("mouseup", aoLargarORato)
      document.removeEventListener("auxclick", aoLargarORato)
      window.removeEventListener("blur", largarFalar)
      largarFalar()
    }
  }, [])
}
