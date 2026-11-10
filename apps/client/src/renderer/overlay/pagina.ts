/**
 * Game overlay page: the pill and the alert for who joins and leaves.
 *
 * No React, on purpose: this is a window that stays open over a game, and
 * every megabyte and millisecond of CPU it uses is taken from the game. It's
 * dozens of nodes, and they only change when someone speaks, joins, or leaves.
 *
 * Everything from outside comes through `textContent` and `src` of `<img>` with
 * a data URL already checked by the main process (`sanearCaras`). Nothing comes
 * through `innerHTML`: names are written by other people.
 *
 * Where the alert goes: next to the pill, wherever it is, not fixed in a corner
 * of the screen. Below it, or above when the pill is at the bottom of the
 * screen (the main process decides, in `janelaDaOverlay`). An alert in the
 * opposite corner from a pill dragged to the left would force the eye across
 * the game screen to read two things about the same room.
 */

import { mudancasNaSala, type DesenhoDaOverlay, type MudancaNaSala, type ResumoDaOverlay } from "../../main/overlay.js"

export interface PonteDaOverlay {
  aoDesenhar: (fazer: (valor: unknown) => void) => () => void
  aoReceberCaras: (fazer: (valor: unknown) => void) => () => void
  rato: (dentro: boolean) => void
  arrastar: (fase: "inicio" | "fim") => void
  largura: (pixeis: number) => void
  repor: () => void
}

/** How many faces the pill shows. The rest count as "+N". */
export const CARAS_VISIVEIS = 12
/** How long an alert stays visible. */
export const DURACAO_DO_AVISO_MS = 3200
/** Alerts waiting, at most. In a room that fills suddenly, the oldest drop. */
const FILA_MAXIMA = 4

/**
 * Animation durations.
 *
 * With reduced motion, nothing stops: the ring and alert keep moving, slower
 * and with less shift. This is the project rule (the owner's Windows has
 * reduced motion on), and a ring that lights up suddenly reads as a flicker.
 */
export function duracoes(reduzido: boolean): { anelMs: number; avisoMs: number; deslocamentoPx: number } {
  return reduzido ? { anelMs: 420, avisoMs: 700, deslocamentoPx: 3 } : { anelMs: 140, avisoMs: 240, deslocamentoPx: 8 }
}

const SVG = "http://www.w3.org/2000/svg"

function icone(qual: "microfone" | "som"): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("aria-hidden", "true")
  const caminhos =
    qual === "microfone"
      ? ["M9 5.5a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0z", "M5.5 11a6.5 6.5 0 0 0 13 0", "M12 17.5V21", "M4 3l16 18"]
      : ["M4.7 13.8V12a7.3 7.3 0 0 1 14.6 0v1.8", "M3 14h3v6H3zM18 14h3v6h-3z", "M7.2 5.6l9.6 13"]
  for (const d of caminhos) {
    const caminho = document.createElementNS(SVG, "path")
    caminho.setAttribute("d", d)
    svg.append(caminho)
  }
  return svg
}

function elemento<K extends keyof HTMLElementTagNameMap>(etiqueta: K, classe: string): HTMLElementTagNameMap[K] {
  const no = document.createElement(etiqueta)
  no.className = classe
  return no
}

/** The face: the image, or the initial of the name when there is no image. */
function cara(nome: string, imagem: string | null | undefined): HTMLElement {
  const rosto = elemento("span", "rosto")
  if (imagem) {
    const img = document.createElement("img")
    img.alt = ""
    img.draggable = false
    img.src = imagem
    rosto.append(img)
  } else {
    const inicial = elemento("span", "inicial")
    inicial.textContent = ([...nome.trim()][0] ?? "?").toUpperCase()
    rosto.append(inicial)
  }
  return rosto
}

function lerDesenho(cru: unknown): DesenhoDaOverlay | null {
  if (typeof cru !== "object" || cru === null) return null
  const d = cru as Partial<DesenhoDaOverlay>
  if (!d.resumo || typeof d.resumo !== "object" || !Array.isArray(d.resumo.pessoas)) return null
  return d as DesenhoDaOverlay
}

export function montarOverlay(opcoes: { raiz: HTMLElement; ponte: PonteDaOverlay; reduzido: boolean }): { largar: () => void } {
  const { raiz, ponte } = opcoes
  const tempo = duracoes(opcoes.reduzido)
  raiz.classList.add("overlay")
  raiz.dataset.lado = "abaixo"
  raiz.style.setProperty("--dur-anel", `${tempo.anelMs}ms`)
  raiz.style.setProperty("--dur-aviso", `${tempo.avisoMs}ms`)
  raiz.style.setProperty("--desloca-aviso", `${tempo.deslocamentoPx}px`)

  const pilula = elemento("div", "pilula")
  const ponto = elemento("span", "ponto")
  const sala = elemento("span", "sala")
  const lista = elemento("ul", "caras")
  pilula.append(ponto, sala, lista)

  const aviso = elemento("div", "aviso")
  aviso.hidden = true
  raiz.append(pilula, aviso)

  const caras = new Map<string, string | null>()
  let anterior: ResumoDaOverlay | null = null
  let ultimo: DesenhoDaOverlay | null = null
  const fila: MudancaNaSala[] = []
  let relogioDoAviso: ReturnType<typeof setTimeout> | null = null
  let larguraDita = -1

  const dizerLargura = (): void => {
    // `scrollWidth` not the box: the pill can still be wider than the window,
    // until the main process expands it.
    const largura = Math.ceil(Math.max(pilula.scrollWidth, pilula.getBoundingClientRect().width))
    if (largura === larguraDita) return
    larguraDita = largura
    ponte.largura(largura)
  }

  const desenharPilula = (desenho: DesenhoDaOverlay): void => {
    sala.textContent = desenho.resumo.sala
    const pessoas = desenho.resumo.pessoas
    const visiveis = pessoas.slice(0, CARAS_VISIVEIS)
    const nos: HTMLElement[] = visiveis.map((pessoa) => {
      const item = elemento("li", "cara")
      item.dataset.id = pessoa.id
      item.title = pessoa.nome
      if (pessoa.aFalar && !pessoa.micCalado) item.setAttribute("data-fala", "")
      item.append(elemento("span", "anel"), cara(pessoa.nome, caras.get(pessoa.id)))
      // Sound off beats microphone: who does not hear also does not speak.
      const marca = pessoa.somDesligado ? "som" : pessoa.micCalado ? "microfone" : null
      if (marca) {
        const selo = elemento("span", "marca")
        selo.dataset.marca = marca
        selo.append(icone(marca))
        item.append(selo)
      }
      return item
    })
    if (pessoas.length > visiveis.length) {
      const mais = elemento("li", "mais")
      mais.textContent = `+${pessoas.length - visiveis.length}`
      nos.push(mais)
    }
    lista.replaceChildren(...nos)
  }

  const mostrarProximoAviso = (): void => {
    const mudanca = fila.shift()
    if (!mudanca || !ultimo) {
      aviso.hidden = true
      aviso.removeAttribute("data-a-entrar")
      relogioDoAviso = null
      return
    }
    // A name from the address exits discreetly, like in the main window (`NomeDePessoa`).
    const nome = elemento("strong", mudanca.pessoa.doEndereco ? "aviso-nome do-endereco" : "aviso-nome")
    nome.textContent = mudanca.pessoa.nome
    const frase = elemento("span", "aviso-frase")
    frase.textContent = ` ${mudanca.tipo === "entrou" ? ultimo.textos.entrou : ultimo.textos.saiu}`
    const texto = elemento("span", "aviso-texto")
    texto.append(nome, frase)
    aviso.dataset.tipo = mudanca.tipo
    aviso.replaceChildren(cara(mudanca.pessoa.nome, caras.get(mudanca.pessoa.id)), texto)
    aviso.hidden = false
    // Restart the entry animation: remove and add the attribute in a new frame.
    aviso.removeAttribute("data-a-entrar")
    void aviso.offsetWidth
    aviso.setAttribute("data-a-entrar", "")
    relogioDoAviso = setTimeout(mostrarProximoAviso, DURACAO_DO_AVISO_MS)
  }

  const avisar = (mudancas: MudancaNaSala[]): void => {
    if (mudancas.length === 0) return
    fila.push(...mudancas)
    while (fila.length > FILA_MAXIMA) fila.shift()
    if (relogioDoAviso === null) mostrarProximoAviso()
  }

  const largarDesenho = ponte.aoDesenhar((cru) => {
    const desenho = lerDesenho(cru)
    if (!desenho) return
    ultimo = desenho
    raiz.dataset.lado = desenho.lado === "acima" ? "acima" : "abaixo"
    raiz.style.setProperty("--fundo-alfa", String(desenho.opacidade))
    desenharPilula(desenho)
    avisar(mudancasNaSala(anterior, desenho.resumo))
    if (anterior && anterior.entrada !== desenho.resumo.entrada) {
      // Another room: the alerts from the previous one no longer matter.
      fila.length = 0
    }
    anterior = desenho.resumo
    dizerLargura()
  })

  const largarCaras = ponte.aoReceberCaras((cru) => {
    if (typeof cru !== "object" || cru === null) return
    for (const [id, imagem] of Object.entries(cru as Record<string, unknown>)) {
      caras.set(id, typeof imagem === "string" && imagem.startsWith("data:image/") ? imagem : null)
    }
    if (ultimo) desenharPilula(ultimo)
  })

  /*
    The mouse. The window lets clicks through to the game until the mouse enters
    the pill; then it claims them, and releases them when it leaves. Dragging is
    from the main process (see `overlay-controlador.ts`): here we only say when
    it starts and ends.
    */
  let aArrastar = false
  const acabar = (): void => {
    if (!aArrastar) return
    aArrastar = false
    ponte.arrastar("fim")
  }
  pilula.addEventListener("pointerenter", () => ponte.rato(true))
  pilula.addEventListener("pointerleave", () => ponte.rato(false))
  pilula.addEventListener("pointerdown", (evento) => {
    if ((evento as PointerEvent).button !== 0) return
    evento.preventDefault()
    try {
      pilula.setPointerCapture((evento as PointerEvent).pointerId)
    } catch {
      // Without capture the main process keeps tracking the system cursor.
    }
    aArrastar = true
    ponte.arrastar("inicio")
  })
  pilula.addEventListener("pointerup", acabar)
  pilula.addEventListener("pointercancel", acabar)
  pilula.addEventListener("lostpointercapture", acabar)
  window.addEventListener("blur", acabar)
  pilula.addEventListener("dblclick", () => ponte.repor())

  const observador = typeof ResizeObserver === "function" ? new ResizeObserver(() => dizerLargura()) : null
  observador?.observe(pilula)

  return {
    largar: () => {
      largarDesenho()
      largarCaras()
      observador?.disconnect()
      if (relogioDoAviso !== null) clearTimeout(relogioDoAviso)
      window.removeEventListener("blur", acabar)
    },
  }
}
