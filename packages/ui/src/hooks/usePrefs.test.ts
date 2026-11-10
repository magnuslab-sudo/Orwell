import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { ATALHOS_POR_OMISSAO } from "../lib/atalhosDeVoz.js"
import {
  ACCENTS,
  DEFAULT_PREFS,
  EMOJI_RECENTS_MAX,
  PREFS_KEY,
  applyPrefs,
  estaEmPausa,
  fimDaPausa,
  readPrefs,
  useEmojiRecents,
  usePrefs,
  writePrefs,
} from "./usePrefs.js"
import { moradaDeTeste } from "../../testes/moradas.js"
import { registerSystemNoticeHost } from "../lib/notifications.js"

const DM_ANA_EU = moradaDeTeste("directa ana eu", "s")

// Tear down the hooks after each test: a render that stays alive leaves React
// scheduling work after the environment is torn down ("window is not defined"
// caught outside the tests, October 28 2026), and the whole suite exits with
// code 1 even with everything green.
afterEach(cleanup)

beforeEach(() => localStorage.clear())

describe("readPrefs / writePrefs", () => {
  it("sem nada guardado devolve os defaults", () => {
    expect(readPrefs()).toEqual(DEFAULT_PREFS)
  })

  it("faz roundtrip pelo localStorage", () => {
    const chosen = {
      activity: "online" as const,
      accent: 3,
      density: "compacta" as const,
      notifications: false,
      avisosDaAppRevistos: false,
      notifyPreview: false,
      sounds: false,
      soundVolume: 30,
      outputVolume: 1.5,
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: false,
      filtroDeMicrofone: false,
      videoQuality: "720p" as const,
      micMuted: true,
      soundOff: false,
      inputDeviceId: "mic-abc",
      inputGain: 1.5,
      emojiRecents: ["🙂"],
      atalhosDeVoz: ATALHOS_POR_OMISSAO,
      frasesVistas: ["conta"],
      volumeDaEmissao: 0.6,
      musicasCaladas: ["@ana:s"],
      silenciados: ["!lagar:s", "!lagar:s/vinha"],
      bloqueioAutomatico: 60 as const,
      pausaAte: 1_900_000_000_000,
      entrarSilenciado: true,
      // On by default: what we prove is that a chosen `false` sticks.
      avisarAmigosOnline: false,
      avisarAmigosNaVoz: false,
      avisarAmigosNoEcra: true,
      avisarAmigosNaComunidade: false,
      videoDeviceId: "cam-abc",
      espelharCamara: false,
      pedidosDeAmizade: "amigos-de-amigos" as const,
      mostrarOnline: false,
      overlayDeJogoLigada: false,
      opacidadeDaOverlay: 0.35,
      sensibilidadeAutomatica: false,
      limiarDoMicrofone: -37,
    }
    writePrefs(chosen)
    expect(localStorage.getItem(PREFS_KEY)).toBeTruthy()
    expect(readPrefs()).toEqual(chosen)
  })

  it("os avisos de amigos novos vêm ligados, e um valor antigo não os desliga sem querer (3/11/2026)", () => {
    expect(DEFAULT_PREFS).toMatchObject({
      avisarAmigosNaVoz: true,
      avisarAmigosNoEcra: true,
      avisarAmigosNaComunidade: true,
    })
    // A value saved before these switches existed, with online switched off.
    localStorage.setItem(PREFS_KEY, JSON.stringify({ avisarAmigosOnline: false }))
    expect(readPrefs()).toMatchObject({
      avisarAmigosOnline: false,
      avisarAmigosNaVoz: true,
      avisarAmigosNoEcra: true,
      avisarAmigosNaComunidade: true,
    })
    // Garbage doesn't switch off: only a chosen `false`.
    localStorage.setItem(PREFS_KEY, JSON.stringify({ avisarAmigosNaVoz: "não", avisarAmigosNoEcra: 0 }))
    expect(readPrefs()).toMatchObject({ avisarAmigosNaVoz: true, avisarAmigosNoEcra: true })
    localStorage.setItem(PREFS_KEY, JSON.stringify({ avisarAmigosNaComunidade: false }))
    expect(readPrefs().avisarAmigosNaComunidade).toBe(false)
  })

  it("notificações ligadas e sons a 100 % por omissão (2/11/2026)", () => {
    expect(DEFAULT_PREFS.notifications).toBe(true)
    expect(DEFAULT_PREFS.soundVolume).toBe(100)
    // Who chose to switch off in the browser stays switched off.
    localStorage.setItem(PREFS_KEY, JSON.stringify({ notifications: false }))
    expect(readPrefs().notifications).toBe(false)
  })

  it('na app de secretária, o "desligado" trancado de antes liga-se UMA vez, e depois vale a escolha', () => {
    registerSystemNoticeHost({ show: () => {} })
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ notifications: false }))
      const primeira = readPrefs()
      expect(primeira).toMatchObject({ notifications: true, avisosDaAppRevistos: true })
      // A pessoa desliga: a escolha fica.
      writePrefs({ ...primeira, notifications: false })
      expect(readPrefs().notifications).toBe(false)
    } finally {
      registerSystemNoticeHost(null)
    }
  })

  it("a overlay de jogo: desligada e a 45 % por omissão, e lixo na opacidade volta aos 45 %", () => {
    expect(DEFAULT_PREFS.overlayDeJogoLigada).toBe(false)
    expect(DEFAULT_PREFS.opacidadeDaOverlay).toBe(0.45)
    localStorage.setItem(PREFS_KEY, JSON.stringify({ overlayDeJogoLigada: "sim", opacidadeDaOverlay: 0.05 }))
    expect(readPrefs()).toMatchObject({ overlayDeJogoLigada: false, opacidadeDaOverlay: 0.45 })
    localStorage.setItem(PREFS_KEY, JSON.stringify({ overlayDeJogoLigada: true, opacidadeDaOverlay: 1 }))
    expect(readPrefs()).toMatchObject({ overlayDeJogoLigada: true, opacidadeDaOverlay: 1 })
    // The old name was written by `1.0.7` and `1.0.8` with no choice, and no longer matters.
    localStorage.setItem(PREFS_KEY, JSON.stringify({ overlayDeJogo: true }))
    expect(readPrefs()).toMatchObject({ overlayDeJogoLigada: false })
  })

  it("tolera JSON estragado", () => {
    localStorage.setItem(PREFS_KEY, "{nem pensar")
    expect(readPrefs()).toEqual(DEFAULT_PREFS)
  })

  it("tolera valores fora do domínio", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ accent: 99, density: "gigante" }))
    expect(readPrefs()).toEqual(DEFAULT_PREFS)
    localStorage.setItem(PREFS_KEY, JSON.stringify({ accent: -1, density: null }))
    expect(readPrefs()).toEqual(DEFAULT_PREFS)
    localStorage.setItem(PREFS_KEY, "null")
    expect(readPrefs()).toEqual(DEFAULT_PREFS)
  })
})

describe("sons", () => {
  it("por omissão os sons estão ligados, a 100 % (era 50 até 2/11/2026, ordem do dono)", () => {
    expect(DEFAULT_PREFS.sounds).toBe(true)
    expect(DEFAULT_PREFS.soundVolume).toBe(100)
  })

  it("só um `false` explícito cala — prefs antigos continuam com som", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ accent: 3, chosen: true }))
    expect(readPrefs().sounds).toBe(true)
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sounds: false, chosen: true }))
    expect(readPrefs().sounds).toBe(false)
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sounds: "talvez", chosen: true }))
    expect(readPrefs().sounds).toBe(true)
  })

  it("um volume fora do domínio cai no default, nunca num extremo", () => {
    for (const junk of [999, -3, "alto", null, Number.NaN]) {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ soundVolume: junk, chosen: true }))
      expect(readPrefs().soundVolume).toBe(DEFAULT_PREFS.soundVolume)
    }
    localStorage.setItem(PREFS_KEY, JSON.stringify({ soundVolume: 0, chosen: true }))
    expect(readPrefs().soundVolume).toBe(0)
    localStorage.setItem(PREFS_KEY, JSON.stringify({ soundVolume: 100, chosen: true }))
    expect(readPrefs().soundVolume).toBe(100)
  })

  it("escolher volume e toggle persiste", () => {
    localStorage.removeItem(PREFS_KEY)
    const { result } = renderHook(() => usePrefs())
    act(() => result.current.setSoundVolume(80))
    act(() => result.current.setSounds(false))
    expect(readPrefs().soundVolume).toBe(80)
    expect(readPrefs().sounds).toBe(false)
  })
})

describe("o volume da emissão do DJ", () => {
  it("de fábrica sai tudo (1), e lixo ou fora de 0–1 lê-se como 1", () => {
    expect(readPrefs().volumeDaEmissao).toBe(1)
    for (const lixo of [-0.1, 1.5, "0.5", null]) {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ volumeDaEmissao: lixo }))
      expect(readPrefs().volumeDaEmissao).toBe(1)
    }
    localStorage.setItem(PREFS_KEY, JSON.stringify({ volumeDaEmissao: 0 }))
    expect(readPrefs().volumeDaEmissao).toBe(0)
  })
})

describe("as músicas caladas", () => {
  it("só moradas, sem repetidas; lixo não entra", () => {
    expect(readPrefs().musicasCaladas).toEqual([])
    localStorage.setItem(PREFS_KEY, JSON.stringify({ musicasCaladas: ["@ana:s", "@ana:s", 3, "rui", null, "@rui:s"] }))
    expect(readPrefs().musicasCaladas).toEqual(["@ana:s", "@rui:s"])
    localStorage.setItem(PREFS_KEY, JSON.stringify({ musicasCaladas: "@ana:s" }))
    expect(readPrefs().musicasCaladas).toEqual([])
  })
})

describe("as frases do momento já vistas", () => {
  it("de fábrica não há nenhuma, e fechar uma guarda-a uma vez só", () => {
    expect(readPrefs().frasesVistas).toEqual([])
    const { result } = renderHook(() => usePrefs())
    act(() => result.current.marcarFraseVista("conta"))
    act(() => result.current.marcarFraseVista("conta"))
    act(() => result.current.marcarFraseVista("canal"))
    expect(readPrefs().frasesVistas).toEqual(["conta", "canal"])
  })

  it("lixo no registo não entra", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ frasesVistas: ["conta", 3, "", "x".repeat(40), null] }))
    expect(readPrefs().frasesVistas).toEqual(["conta"])
    localStorage.setItem(PREFS_KEY, JSON.stringify({ frasesVistas: "conta" }))
    expect(readPrefs().frasesVistas).toEqual([])
  })
})

describe("microfone e som das chamadas", () => {
  it("de fábrica ouve-se e é-se ouvido", () => {
    expect(DEFAULT_PREFS.micMuted).toBe(false)
    expect(DEFAULT_PREFS.soundOff).toBe(false)
  })

  it("só um `true` explícito cala — prefs antigos continuam a ouvir-se", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ accent: 3, chosen: true }))
    expect(readPrefs().micMuted).toBe(false)
    expect(readPrefs().soundOff).toBe(false)
    for (const junk of ["talvez", 1, null, {}]) {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ micMuted: junk, soundOff: junk, chosen: true }))
      expect(readPrefs().micMuted).toBe(false)
      expect(readPrefs().soundOff).toBe(false)
    }
    localStorage.setItem(PREFS_KEY, JSON.stringify({ micMuted: true, soundOff: true, chosen: true }))
    expect(readPrefs().micMuted).toBe(true)
    expect(readPrefs().soundOff).toBe(true)
  })

  it("silenciar sobrevive a fechar a aplicação", () => {
    localStorage.removeItem(PREFS_KEY)
    writePrefs({ ...readPrefs(), micMuted: true })
    // A fresh read, like the one on next startup.
    expect(readPrefs().micMuted).toBe(true)
  })
})

describe("o filtro do microfone", () => {
  it("vem ligado de fábrica", () => {
    expect(DEFAULT_PREFS.filtroDeMicrofone).toBe(true)
  })

  it("só um `false` explícito o desliga — prefs antigos ficam com ele ligado", () => {
    // Anyone who already used the app never chose this, and the safe read is the
    // one that gives them the treatment: what it cuts out is not voice, and the
    // limiter it brings with it is what keeps the gain from tearing the sound.
    localStorage.setItem(PREFS_KEY, JSON.stringify({ accent: 3, chosen: true }))
    expect(readPrefs().filtroDeMicrofone).toBe(true)
    localStorage.setItem(PREFS_KEY, JSON.stringify({ filtroDeMicrofone: "talvez", chosen: true }))
    expect(readPrefs().filtroDeMicrofone).toBe(true)
    localStorage.setItem(PREFS_KEY, JSON.stringify({ filtroDeMicrofone: false, chosen: true }))
    expect(readPrefs().filtroDeMicrofone).toBe(false)
  })
})

describe("applyPrefs", () => {
  it("o documento recebe sempre o acento e a densidade de origem, seja o que for que esteja guardado", () => {
    // The choice left settings in 0.9. An old preference (amber, compact) stays on
    // disk and doesn't control the screen.
    applyPrefs({
      // The keys this test doesn't read come from the factory: each new preference
      // in 0.9 would stop compiling here without changing anything we measure.
      ...DEFAULT_PREFS,
      activity: "online",
      accent: 1,
      density: "compacta",
      notifications: false,
      notifyPreview: false,
      sounds: true,
      soundVolume: 50,
      outputVolume: 1,
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      filtroDeMicrofone: true,
      videoQuality: "auto",
      micMuted: false,
      soundOff: false,
      inputDeviceId: "",
      inputGain: 1,
      emojiRecents: [],
      atalhosDeVoz: ATALHOS_POR_OMISSAO,
      frasesVistas: [],
      volumeDaEmissao: 1,
      musicasCaladas: [],
      silenciados: [],
    })
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe(ACCENTS[DEFAULT_PREFS.accent]?.accent)
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#8be9fd")
    expect(document.documentElement.style.getPropertyValue("--accent-deep")).toBe(ACCENTS[DEFAULT_PREFS.accent]?.deep)
    expect(document.documentElement.dataset.density).toBe("confortavel")
  })
})

/* --------------------------------------------------------------- contraste */

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const linear = (channel: number): number => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const value = Number.parseInt(hex.slice(1), 16)
  return (
    0.2126 * linear((value >> 16) & 255) + 0.7152 * linear((value >> 8) & 255) + 0.0722 * linear(value & 255)
  )
}

function contrast(a: string, b: string): number {
  const first = luminance(a)
  const second = luminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/** tokens.css `--tinta`, which is `--on-accent`. If it changes there, it changes here. */
const ON_ACCENT = "#080c1a"

/**
 * The solid surfaces in `tokens.css` where accented text can land, and the
 * composite glass over the background. If they change there, they must change here.
 */
const SUPERFICIES = {
  "--fundo": "#080c1a",
  "--vidro-solido": "#0c1123",
  "--bg-main": "#0b1020",
  "--bg-raised": "#131a33",
  "--bg-hover": "#192241",
}

describe("contraste dos acentos na pele midnight", () => {
  // Accent fill is the accent itself, with dark ink on top (chips, badges,
  // primary buttons, avatars).
  it.each(ACCENTS.map((option) => [option.name, option] as const))(
    "%s: a tinta passa AA sobre o preenchimento",
    (_name, option) => {
      expect(option.deep).toBe(option.accent)
      expect(contrast(ON_ACCENT, option.deep)).toBeGreaterThanOrEqual(4.5)
    },
  )

  // And accent is small text in many places: links, counts, labels.
  it.each(ACCENTS.map((option) => [option.name, option] as const))(
    "%s: como texto pequeno, passa AA sobre todas as superfícies",
    (_name, option) => {
      for (const fundo of Object.values(SUPERFICIES)) {
        expect(contrast(option.accent, fundo)).toBeGreaterThanOrEqual(4.5)
      }
    },
  )

  it("os textos da pele passam AA sobre todas as superfícies", () => {
    for (const texto of ["#e6ecff", "#f1f4ff", "#b9c3e0", "#9aa6c8", "#8591b8"]) {
      for (const fundo of Object.values(SUPERFICIES)) {
        expect(contrast(texto, fundo)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it("o ciano é a cor por omissão, no lugar do antigo Lilás", () => {
    expect(ACCENTS[DEFAULT_PREFS.accent]?.accent).toBe("#8be9fd")
  })
})

describe("migração do marcador de escolha", () => {
  it("prefs antigos sem marcador e accent no default velho recebem o default novo", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ accent: 0, density: "confortavel" }))
    expect(readPrefs().accent).toBe(DEFAULT_PREFS.accent)
  })

  it("um valor fora do default velho prova a escolha e é mantido, mesmo sem marcador", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ accent: 3 }))
    expect(readPrefs().accent).toBe(3)
  })

  it("Menta explícita (com marcador) mantém-se Menta", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ accent: 0, chosen: true }))
    expect(readPrefs().accent).toBe(0)
  })

  it("o primeiro arranque não escreve nada; escolher escreve com o marcador", () => {
    localStorage.removeItem(PREFS_KEY)
    const { result } = renderHook(() => usePrefs())
    expect(localStorage.getItem(PREFS_KEY)).toBeNull()

    act(() => result.current.setSoundVolume(20))
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { soundVolume: number; chosen: boolean }
    expect(stored.soundVolume).toBe(20)
    expect(stored.chosen).toBe(true)
  })
})

describe("estado de atividade", () => {
  it("invisível sobrevive ao reload e é lido antes de ligar", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ activity: "invisivel", chosen: true }))
    expect(readPrefs().activity).toBe("invisivel")
  })

  it("lixo no campo cai para online, nunca para um estado inventado", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ activity: "fantasma" }))
    expect(readPrefs().activity).toBe("online")
    localStorage.removeItem(PREFS_KEY)
    expect(readPrefs().activity).toBe("online")
  })
})

describe("useEmojiRecents", () => {
  it("começa vazio e põe o último usado à frente", () => {
    const { result } = renderHook(() => useEmojiRecents())
    expect(result.current.recents).toEqual([])
    act(() => result.current.remember("🌻"))
    expect(result.current.recents).toEqual(["🌻"])
    act(() => result.current.remember("☕"))
    expect(result.current.recents).toEqual(["☕", "🌻"])
  })

  it("promove um repetido em vez de o duplicar", () => {
    const { result } = renderHook(() => useEmojiRecents())
    act(() => result.current.remember("🌻"))
    act(() => result.current.remember("☕"))
    act(() => result.current.remember("🌻"))
    expect(result.current.recents).toEqual(["🌻", "☕"])
  })

  it("não guarda mais do que o limite", () => {
    const { result } = renderHook(() => useEmojiRecents())
    for (let i = 0; i < EMOJI_RECENTS_MAX + 6; i += 1) {
      act(() => result.current.remember(`e${i}`))
    }
    expect(result.current.recents.length).toBe(EMOJI_RECENTS_MAX)
    // Newest at the head, oldest fell off.
    expect(result.current.recents[0]).toBe(`e${EMOJI_RECENTS_MAX + 5}`)
    expect(result.current.recents).not.toContain("e0")
  })

  /**
   * Saving can't live inside a state updater.
   *
   * Picking an emoji closes the selector, and closing unmounts whoever called
   * `remember`. React only evaluates the first updater in a sequence by
   * shortcut-the rest stay queued and die with the component. With saving in
   * there, the emoji never made it to disk and didn't show up in recents next
   * time; in the real browser even the first one didn't survive.
   *
   * Two calls in a row, after unmounting, is the tightest scenario you can set
   * up here-and it's enough to catch the regression.
   */
  it("grava em disco sem depender de o React processar a actualização", () => {
    const { result, unmount } = renderHook(() => useEmojiRecents())
    const { remember } = result.current
    unmount()
    remember("🌻")
    remember("☕")
    expect(readPrefs().emojiRecents).toEqual(["☕", "🌻"])
  })

  it("não perde o resto das preferências ao gravar", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, activity: "invisivel", soundVolume: 30 }))
    const { result } = renderHook(() => useEmojiRecents())
    act(() => result.current.remember("🌻"))
    // "Invisible" is a privacy choice: saving an emoji would lose it and put
    // someone online without anyone asking.
    expect(readPrefs().activity).toBe("invisivel")
    expect(readPrefs().soundVolume).toBe(30)
  })
})

describe("atalhos de voz nas preferências", () => {
  it("vêm de fábrica, saneiam-se ao ler e guardam-se pelo hook", () => {
    expect(readPrefs().atalhosDeVoz.microfone).toBe("Mod+Shift+M")
    // Since 1.0.6 a single letter is a valid shortcut; Tab still has an owner.
    localStorage.setItem(PREFS_KEY, JSON.stringify({ atalhosDeVoz: { microfone: "Tab", falar: "F8", som: null, camara: "M" } }))
    expect(readPrefs().atalhosDeVoz).toMatchObject({ microfone: "Mod+Shift+M", falar: "F8", som: null, camara: "M" })

    const { result } = renderHook(() => usePrefs())
    act(() => result.current.setAtalhosDeVoz({ ...result.current.prefs.atalhosDeVoz, ecra: "Alt+E" }))
    expect(readPrefs().atalhosDeVoz.ecra).toBe("Alt+E")
    expect(result.current.prefs.atalhosDeVoz.ecra).toBe("Alt+E")
  })
})

describe("silenciados nas preferências", () => {
  it("vêm vazios, saneiam-se ao ler, e o hook alterna sobre o que está no disco", () => {
    expect(readPrefs().silenciados).toEqual([])
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ silenciados: ["!lagar:s", "lixo", 7, "!lagar:s", "!adega:s/vinha"] }),
    )
    expect(readPrefs().silenciados).toEqual(["!lagar:s", "!adega:s/vinha"])

    const { result } = renderHook(() => usePrefs())
    act(() => result.current.alternarSilencio(DM_ANA_EU))
    expect(readPrefs().silenciados).toEqual(["!lagar:s", "!adega:s/vinha", DM_ANA_EU])
    act(() => result.current.alternarSilencio("!lagar:s"))
    expect(result.current.prefs.silenciados).toEqual(["!adega:s/vinha", DM_ANA_EU])
  })
})

describe("bloquear sozinho nas preferências", () => {
  it("vem nos 15 minutos, e só os tempos oferecidos se lêem", () => {
    localStorage.clear()
    expect(readPrefs().bloqueioAutomatico).toBe(15)
    for (const lixo of [5, "15", null, -1, 61]) {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, bloqueioAutomatico: lixo }))
      expect(readPrefs().bloqueioAutomatico).toBe(15)
    }
    localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, bloqueioAutomatico: 0 }))
    expect(readPrefs().bloqueioAutomatico).toBe(0)
  })
})

describe("pausar as notificações", () => {
  it("vem sem pausa, e lixo lê-se como sem pausa", () => {
    localStorage.clear()
    expect(readPrefs().pausaAte).toBe(0)
    for (const lixo of ["amanhã", -5, null, Number.NaN]) {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ chosen: true, pausaAte: lixo }))
      expect(readPrefs().pausaAte).toBe(0)
    }
  })

  it("está em pausa até à hora de fim, e não depois", () => {
    expect(estaEmPausa({ pausaAte: 2000 }, 1999)).toBe(true)
    expect(estaEmPausa({ pausaAte: 2000 }, 2000)).toBe(false)
    expect(estaEmPausa({ pausaAte: 0 }, 1)).toBe(false)
  })

  it('1 h, 8 h, e "Até amanhã" às 8h do dia seguinte', () => {
    const agora = new Date(2026, 9, 28, 23, 30)
    expect(fimDaPausa("1h", agora)).toBe(agora.getTime() + 3_600_000)
    expect(fimDaPausa("8h", agora)).toBe(agora.getTime() + 8 * 3_600_000)
    expect(new Date(fimDaPausa("amanha", agora))).toEqual(new Date(2026, 9, 29, 8, 0))
    // At night, "tomorrow" means the morning after sleep: 8 AM the same day.
    expect(new Date(fimDaPausa("amanha", new Date(2026, 9, 29, 1, 0)))).toEqual(new Date(2026, 9, 29, 8, 0))
    expect(new Date(fimDaPausa("amanha", new Date(2026, 9, 29, 5, 0)))).toEqual(new Date(2026, 9, 30, 8, 0))
  })
})

describe("sensibilidade do microfone", () => {
  it("de fábrica é automática, com a linha a -50 dB guardada para quando se passar a manual", () => {
    localStorage.clear()
    expect(readPrefs().sensibilidadeAutomatica).toBe(true)
    expect(readPrefs().limiarDoMicrofone).toBe(-50)
  })

  it("lixo guardado lê-se como automática e linha de fábrica, nunca como microfone calado", () => {
    for (const lixo of [{ sensibilidadeAutomatica: "nao", limiarDoMicrofone: 12 }, { limiarDoMicrofone: "x" }, { limiarDoMicrofone: -200 }]) {
      localStorage.setItem(PREFS_KEY, JSON.stringify(lixo))
      expect(readPrefs().sensibilidadeAutomatica).toBe(true)
      expect(readPrefs().limiarDoMicrofone).toBe(-50)
    }
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sensibilidadeAutomatica: false, limiarDoMicrofone: -42.4 }))
    expect(readPrefs()).toMatchObject({ sensibilidadeAutomatica: false, limiarDoMicrofone: -42 })
  })
})
