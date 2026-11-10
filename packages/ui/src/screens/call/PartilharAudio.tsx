import { useEffect, useId, useRef, useState } from "react"
import { EXTENSOES_DE_AUDIO, type FicheiroDeAudio } from "@enclave/client-core"
import { Andante } from "../../components/Andante.js"
import { Button } from "../../components/Button.js"
import { Modal } from "../../components/Modal.js"
import type { MusicaDaChamada } from "../../hooks/useMusicaDaChamada.js"
import {
  AbrirIcon,
  AnteriorIcon,
  BaralharIcon,
  CloseIcon,
  MusicaIcon,
  PararIcon,
  PausarIcon,
  RepetirIcon,
  SaltarIcon,
  TocarIcon,
} from "../../icons.js"
import type { FonteDeAudio, FonteOferecida } from "../../lib/fontesDeAudio.js"
import { strings, translateError } from "../../strings.js"
import { Espectro } from "./Espectro.js"

/** The drag type of a list line: tells it apart from dropped files. */
const ARRASTO_DE_FAIXA = "application/x-orwell-faixa"

/** "3:42", or "1:02:05" for a track longer than an hour. */
export function formatarTempo(segundos: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(segundos) ? segundos : 0))
  const horas = Math.floor(total / 3600)
  const minutos = Math.floor((total % 3600) / 60)
  const resto = String(total % 60).padStart(2, "0")
  return horas > 0 ? `${horas}:${String(minutos).padStart(2, "0")}:${resto}` : `${minutos}:${resto}`
}

/**
 * The "Share audio" sheet: the DJ player. Phase 9, remade 27 October 2026 at
 * the owner's request ("much sexier"; "think Winamp and Windows Media Player.
 * Nostalgia.").
 *
 * Top to bottom, like Winamp: the DISPLAY (time in large digits, track name
 * scrolling like a marquee, bar spectrum with peaks, and position bar you can
 * drag); the TRANSPORT in a dense row (previous, play, pause, stop, next,
 * open), with shuffle and repeat as toggles on the right; the VOLUMES
 * ("Transmit volume" for what goes out, and "Volume for you" for what you
 * hear); the PLAYLIST, numbered monospaced lines, current one highlighted,
 * duration on the right, reordered by dragging and where you drop files; and
 * OTHER SOURCES in a discrete footer: the ones this device provides are chosen
 * (tab, system, window, from 2/11/2026), and the ones it does not explain why.
 * Nostalgia lives in the composition; colors and ink are from the skin, no gray
 * relief or glass.
 *
 * A source captured live takes over the display: the marquee says "Sharing: ..."
 * with the tab or window name, and the spectrum responds to its sound.
 *
 * The sheet saves nothing: the player lives with the call (`useMusicaDaChamada`),
 * and closing the sheet does not stop the music.
 */
export function PartilharAudio({
  musica,
  fontes,
  secretaria = false,
  onFechar,
}: {
  musica: MusicaDaChamada
  fontes: readonly FonteOferecida[]
  /** The desktop app: the source capture phrases change (no tabs; sound is system). */
  secretaria?: boolean
  onFechar: () => void
}): React.JSX.Element {
  const titulo = useId()
  const ficheiros = useRef<HTMLInputElement>(null)
  const pasta = useRef<HTMLInputElement>(null)
  /** Files were chosen and none were audio: report it, instead of doing nothing. */
  const [nenhumAudio, setNenhumAudio] = useState(false)
  /** Files hover over the list: the drop zone lights up. */
  const [aLargar, setALargar] = useState(false)
  const { estado, captura } = musica
  /** The font chosen in the footer. Opens on the one that is playing. */
  const [escolhida, setEscolhida] = useState<FonteDeAudio>(() => captura?.fonte ?? "ficheiros")
  /** The selector is open: the button does not load twice. */
  const [aEscolher, setAEscolher] = useState(false)
  const aTocarAlgo = estado.aTocar || captura !== null
  const aceita = ["audio/*", ...EXTENSOES_DE_AUDIO].join(",")
  const actual = estado.fila.find((faixa) => faixa.id === estado.actual) ?? null
  const numeroActual = actual ? estado.fila.indexOf(actual) + 1 : 0

  /*
    Display refresh rate. Four reads per second while playing is enough for
    seconds and costs nothing: the element knows it and reads from itself. Stopped,
    one read per state change.
  */
  const [posicao, setPosicao] = useState(() => musica.posicao())
  useEffect(() => {
    setPosicao(musica.posicao())
    if (!estado.aTocar) return
    const relogio = setInterval(() => setPosicao(musica.posicao()), 250)
    return () => clearInterval(relogio)
    // `musica.posicao` changes on every render; the player state decides what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado.aTocar, estado.actual])

  /*
    The entire folder: `webkitdirectory` is not in React types, and an unknown
    attribute written in JSX would depend on React version. Set by hand, it works
    on all three engines (Chromium, Firefox and Safari know it).
  */
  useEffect(() => {
    pasta.current?.setAttribute("webkitdirectory", "")
  }, [])

  const escolhidos = (lista: FileList | null): void => {
    const todos = [...(lista ?? [])] as FicheiroDeAudio[]
    if (todos.length === 0) return
    setNenhumAudio(musica.acrescentar(todos) === 0)
  }

  const duracao = posicao.duracao ?? actual?.duracao ?? null
  const textoDoTempo = formatarTempo(posicao.tempo)
  const letreiro = captura
    ? strings.musica.aPartilharFonte(captura.origem)
    : actual
      ? `${numeroActual}. ${actual.nome}${duracao !== null ? ` (${formatarTempo(duracao)})` : ""}`
      : strings.leitorDeMusica.semFaixa
  const outras = fontes.filter((oferecida) => oferecida.fonte !== "ficheiros")

  return (
    <Modal className="sheet partilhar-audio" labelledBy={titulo} onClose={onFechar}>
      <header className="sheet-header">
        <h2 id={titulo}>{strings.musica.partilharAudio}</h2>
        <Button variant="ghost" type="button" onClick={onFechar}>
          {strings.musica.fechar}
        </Button>
      </header>

      <div className="sheet-body">
        {/* The display. Digits have blank "8"s behind them, like a segmented display:
            you read the device design without imitating pixels. */}
        <section className={aTocarAlgo ? "audio-visor a-tocar" : "audio-visor"} aria-label={strings.leitorDeMusica.visor}>
          <div className="audio-visor-tempo" role="timer" aria-label={strings.leitorDeMusica.tempo(textoDoTempo, duracao !== null ? formatarTempo(duracao) : null)}>
            <span className="audio-visor-fantasma" aria-hidden="true">
              {textoDoTempo.replace(/\d/g, "8")}
            </span>
            <span className="audio-visor-digitos" aria-hidden="true">
              {textoDoTempo}
            </span>
          </div>
          <div className="audio-visor-direita">
            <Andante className="audio-visor-letreiro" texto={letreiro} />
            <Espectro stream={musica.faixa} aTocar={aTocarAlgo} />
          </div>
          <input
            className="audio-posicao"
            type="range"
            min={0}
            max={duracao !== null ? Math.max(1, Math.round(duracao)) : 1}
            step={1}
            value={Math.min(Math.round(posicao.tempo), duracao !== null ? Math.round(duracao) : 0)}
            disabled={!actual || duracao === null}
            aria-label={strings.leitorDeMusica.posicao}
            aria-valuetext={strings.leitorDeMusica.tempo(textoDoTempo, duracao !== null ? formatarTempo(duracao) : null)}
            onChange={(evento) => {
              musica.procurar(Number(evento.currentTarget.value))
              setPosicao(musica.posicao())
            }}
          />
        </section>

        {/* The queue: dense, Winamp style. Playing is the only full one. */}
        <div className="audio-transporte" role="toolbar" aria-label={strings.call.controlos}>
          <button type="button" className="audio-tecla" aria-label={strings.leitorDeMusica.anterior} title={strings.leitorDeMusica.anterior} disabled={!actual} onClick={() => void musica.anterior()}>
            <AnteriorIcon size={16} />
          </button>
          {estado.aTocar ? (
            <button type="button" className="audio-tecla principal" aria-label={strings.musica.pausar} title={strings.musica.pausar} onClick={() => musica.pausar()}>
              <PausarIcon size={18} />
            </button>
          ) : (
            <button type="button" className="audio-tecla principal" aria-label={strings.musica.tocar} title={strings.musica.tocar} disabled={estado.fila.length === 0} onClick={() => void musica.tocar()}>
              <TocarIcon size={18} />
            </button>
          )}
          {/* "Stop" removes the music from the call and leaves the list. */}
          <button type="button" className="audio-tecla" aria-label={strings.musica.pararAria} title={strings.musica.parar} disabled={!musica.musica} onClick={() => void musica.parar()}>
            <PararIcon size={16} />
          </button>
          <button type="button" className="audio-tecla" aria-label={strings.musica.saltar} title={strings.leitorDeMusica.seguinte} disabled={!actual} onClick={() => void musica.saltar()}>
            <SaltarIcon size={16} />
          </button>
          <button type="button" className="audio-tecla" aria-label={strings.leitorDeMusica.abrir} title={strings.leitorDeMusica.abrir} onClick={() => ficheiros.current?.click()}>
            <AbrirIcon size={16} />
          </button>
          <span className="audio-transporte-sep" aria-hidden="true" />
          <button
            type="button"
            className="audio-interruptor"
            aria-pressed={estado.aleatorio}
            aria-label={strings.musica.baralhar}
            title={strings.leitorDeMusica.baralhar}
            disabled={estado.fila.length < 2 && !estado.aleatorio}
            onClick={() => musica.definirAleatorio(!estado.aleatorio)}
          >
            <BaralharIcon size={14} />
          </button>
          <button
            type="button"
            className="audio-interruptor"
            aria-pressed={estado.repetir}
            aria-label={strings.leitorDeMusica.repetir}
            title={strings.leitorDeMusica.repetir}
            onClick={() => musica.definirRepetir(!estado.repetir)}
          >
            <RepetirIcon size={14} />
          </button>
        </div>

        <div className="audio-volumes" role="group" aria-label={strings.leitorDeMusica.volumes}>
          {/* What GOES to the call (owner, October 27, 2026). Except "Volume for you",
              which is only what the DJ hears. */}
          <label className="audio-volume-local audio-volume-emissao" title={strings.musicaNaChamada.volumeDaEmissaoNota}>
            <span>{strings.musicaNaChamada.volumeDaEmissao}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(musica.volumeDaEmissao * 100)}
              aria-valuetext={`${Math.round(musica.volumeDaEmissao * 100)} %`}
              aria-description={strings.musicaNaChamada.volumeDaEmissaoNota}
              onChange={(evento) => musica.definirVolumeDaEmissao(Number(evento.currentTarget.value) / 100)}
            />
            <output>{Math.round(musica.volumeDaEmissao * 100)}</output>
          </label>
          <label className="audio-volume-local" title={strings.musica.volumeLocal}>
            <span>{strings.musica.volumeLocal}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(musica.volumeLocal * 100)}
              aria-valuetext={`${Math.round(musica.volumeLocal * 100)} %`}
              onChange={(evento) => musica.definirVolumeLocal(Number(evento.currentTarget.value) / 100)}
            />
            <output>{Math.round(musica.volumeLocal * 100)}</output>
          </label>
        </div>

        {/* Add and the drop zone above the list. */}
        <div
          className={aLargar ? "audio-largar a-largar" : "audio-largar"}
          onDragOver={(evento) => {
            if (!evento.dataTransfer.types.includes("Files")) return
            evento.preventDefault()
            setALargar(true)
          }}
          onDragLeave={() => setALargar(false)}
          onDrop={(evento) => {
            if (!evento.dataTransfer.types.includes("Files")) return
            evento.preventDefault()
            setALargar(false)
            escolhidos(evento.dataTransfer.files)
          }}
        >
          <div className="audio-escolher">
            <Button variant="primary" type="button" onClick={() => ficheiros.current?.click()}>
              {strings.leitorDeMusica.adicionarFicheiros}
            </Button>
            <Button variant="ghost" type="button" onClick={() => pasta.current?.click()}>
              {strings.leitorDeMusica.adicionarPasta}
            </Button>
          </div>
          <p className="field-note">
            {strings.leitorDeMusica.largarAqui} {strings.musica.formatos}
          </p>
          <input
            ref={ficheiros}
            type="file"
            multiple
            accept={aceita}
            hidden
            aria-label={strings.musica.escolherFicheiros}
            onChange={(evento) => {
              escolhidos(evento.currentTarget.files)
              evento.currentTarget.value = ""
            }}
          />
          <input
            ref={pasta}
            type="file"
            multiple
            hidden
            aria-label={strings.musica.escolherPasta}
            onChange={(evento) => {
              escolhidos(evento.currentTarget.files)
              evento.currentTarget.value = ""
            }}
          />
        </div>
        {nenhumAudio && (
          <p className="field-note aviso" role="alert">
            {strings.musica.nenhumAudio}
          </p>
        )}
        {musica.erro && (
          <p className="field-note aviso" role="alert">
            {translateError(musica.erro.detail, { nome: musica.erro.nome })}
          </p>
        )}

        {/* The playlist: dense, numbered, monospace. */}
        <section className="audio-lista" aria-label={strings.musica.lista}>
          {estado.fila.length === 0 ? (
            <p className="field-note">{strings.musica.listaVazia}</p>
          ) : (
            <ol>
              {estado.fila.map((faixa, indice) => {
                const eActual = faixa.id === estado.actual
                return (
                  <li
                    key={faixa.id}
                    className={eActual ? "audio-faixa actual" : "audio-faixa"}
                    draggable
                    title={strings.leitorDeMusica.arrastar}
                    onDragStart={(evento) => {
                      evento.dataTransfer.setData(ARRASTO_DE_FAIXA, faixa.id)
                      evento.dataTransfer.effectAllowed = "move"
                    }}
                    onDragOver={(evento) => {
                      if (evento.dataTransfer.types.includes(ARRASTO_DE_FAIXA)) evento.preventDefault()
                    }}
                    onDrop={(evento) => {
                      const id = evento.dataTransfer.getData(ARRASTO_DE_FAIXA)
                      if (!id) return
                      evento.preventDefault()
                      evento.stopPropagation()
                      musica.mover(id, indice)
                    }}
                  >
                    <button
                      type="button"
                      className="audio-faixa-nome"
                      aria-current={eActual ? "true" : undefined}
                      aria-label={strings.musica.tocarEsta(faixa.nome)}
                      onClick={() => {
                        void musica.tocar(faixa.id)
                      }}
                    >
                      <span className="audio-faixa-numero" aria-hidden="true">
                        {String(indice + 1).padStart(2, "0")}.
                      </span>
                      <span className="audio-faixa-titulo">{faixa.nome}</span>
                      {eActual && estado.aTocar && (
                        <span className="audio-faixa-onda" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                      <span className="audio-faixa-duracao">
                        {faixa.duracao !== undefined ? formatarTempo(faixa.duracao) : ""}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="audio-faixa-tirar"
                      aria-label={strings.musica.remover(faixa.nome)}
                      title={strings.musica.remover(faixa.nome)}
                      onClick={() => {
                        void musica.remover(faixa.id)
                      }}
                    >
                      <CloseIcon size={12} />
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </section>

        {/* Other fonts, in a discreet footer at the end of the page. The ones this
            device supports are chosen; the ones it does not support stay disabled
            with an explanation for THIS device. A hidden font would send whoever
            looked for it to Settings. Inside the scrolling body so it does not
            steal height from the list on a phone. */}
        <footer className="audio-fontes-rodape">
          <fieldset className="audio-fontes">
            <legend>{strings.leitorDeMusica.outrasFontes}</legend>
            {fontes
              .filter((oferecida) => oferecida.fonte === "ficheiros")
              .concat(outras)
              .map((oferecida) => (
                <label
                  key={oferecida.fonte}
                  className={oferecida.activa ? "audio-fonte" : "audio-fonte desligada"}
                  data-fonte={oferecida.fonte}
                >
                  <input
                    type="radio"
                    name={`${titulo}-fonte`}
                    value={oferecida.fonte}
                    disabled={!oferecida.activa}
                    checked={escolhida === oferecida.fonte}
                    onChange={() => setEscolhida(oferecida.fonte)}
                  />
                  <span className="audio-fonte-nome">{strings.musica.fonte(oferecida.fonte)}</span>
                  {oferecida.porque && <span className="field-note">{strings.musica.porqueNao(oferecida.porque)}</span>}
                </label>
              ))}
          </fieldset>
          {escolhida !== "ficheiros" && (
            <div className="audio-fonte-accao">
              {/* What happens next, read BEFORE the click: the browser selector does not
                  explain the audio box. */}
              <p className="field-note">{strings.musica.notaDaFonte(escolhida, secretaria)}</p>
              {secretaria && <p className="field-note aviso">{strings.musica.ecoNaApp}</p>}
              {captura && captura.fonte === escolhida ? (
                <>
                  <p className="audio-fonte-no-ar" role="status">
                    {strings.musica.aPartilharFonte(captura.origem)}
                  </p>
                  <Button variant="ghost" type="button" onClick={() => void musica.parar()}>
                    {strings.musica.pararFonte}
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  type="button"
                  disabled={aEscolher}
                  onClick={() => {
                    setAEscolher(true)
                    void musica.partilharFonte(escolhida).finally(() => setAEscolher(false))
                  }}
                >
                  {strings.musica.escolherFonte}
                </Button>
              )}
            </div>
          )}
        </footer>
      </div>
    </Modal>
  )
}

/**
 * The indicator for OUR music, above the bar: what is playing, or what is paused.
 *
 * Beside the screen sound indicator, and for the same reason: whoever is sharing
 * must see what goes out of it.
 */
export function SinalDaMusica({
  musica,
  volumeDaEmissao = 1,
}: {
  musica: MusicaDaChamada["musica"]
  /**
   * "Broadcast volume", from 0 to 1. Below the maximum it says in the indicator:
   * whoever lowered the broadcast must see it without opening the page, because
   * the room hears less than they hear.
   */
  volumeDaEmissao?: number | undefined
}): React.JSX.Element | null {
  if (musica === null) return null
  const percentagem = Math.round(volumeDaEmissao * 100)
  return (
    <p className={musica.aTocar ? "call-som-do-ecra call-musica" : "call-som-do-ecra call-musica calado"} role="status">
      <MusicaIcon size={14} /> {musica.aTocar ? strings.musica.aTocar(musica.aTocar) : strings.musica.emPausa}
      {percentagem < 100 && (
        <span className="call-musica-emissao"> · {strings.musicaNaChamada.emissaoA(percentagem)}</span>
      )}
    </p>
  )
}

/**
 * Music that comes from another person, in its own element.
 *
 * Separate from the person's `VideoTile` so it has its own volume: the voice and
 * music from the same person in the same element always played at the same volume.
 * Hidden, like the boxes that play the voice.
 */
export function MusicaQueChega({
  stream,
  volume,
  calado,
}: {
  stream: MediaStream
  /** Between 0 and 1: this person's music volume, already multiplied by the output. */
  volume: number
  /** The call sound muted ("Mute sound"). */
  calado: boolean
}): React.JSX.Element {
  const elemento = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const audio = elemento.current
    if (!audio || audio.srcObject === stream) return
    audio.srcObject = stream
    void audio.play().catch(() => {
      // No gesture yet: plays when the browser allows, like the voice.
    })
  }, [stream])
  useEffect(() => {
    const audio = elemento.current
    if (!audio) return
    audio.volume = Math.min(1, Math.max(0, volume))
    audio.muted = calado
  }, [volume, calado])
  return <audio ref={elemento} className="call-musica-que-chega" autoPlay data-musica="1" />
}
