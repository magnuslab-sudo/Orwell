import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { readPrefs } from "../../hooks/usePrefs.js"
import { VERSAO_DA_APP } from "../../lib/versao.js"
import { strings } from "../../strings.js"
import { SettingsScreen } from "./SettingsScreen.js"

/** The screen only reaches the bridge on export/lock/destroy, none of which
 * this file touches: an empty one is enough to mount it. */
const bridge = {} as unknown as EnclaveBridge

/**
 * A bridge that answers to `pairing.status`, which is what this device's
 * section asks, and to `pairing.devices`, which is what the list above it asks
 * for (both live in the Devices section).
 */
function ponteComChave(temChaveDeConta: boolean): EnclaveBridge {
  return {
    pairing: {
      status: vi.fn(async () => ({ temChaveDeConta, servidorSuporta: true })),
      devices: vi.fn(async () => []),
    },
  } as unknown as EnclaveBridge
}

afterEach(cleanup)
beforeEach(() => localStorage.clear())

/**
 * The mounted screen. Audio comes from outside, as in the product.
 *
 * `micMuted`/`soundOff` and the two switches are shell props and not
 * preferences read here: this ensures this screen and the sidebar card
 * touch the same state. See the component header.
 */
function renderSettings(
  audio: {
    micMuted?: boolean
    soundOff?: boolean
    onToggleMic?: () => void
    onToggleSound?: () => void
    seccao?: string
    bridge?: EnclaveBridge
  } = {},
): void {
  render(
    <BridgeContext.Provider value={audio.bridge ?? bridge}>
      <ToastProvider>
        <SettingsScreen
          address="@me:casa.pt"
          connection="online"
          connectionDetail={null}
          onLock={() => {}}
          micMuted={audio.micMuted ?? false}
          soundOff={audio.soundOff ?? false}
          onToggleMic={audio.onToggleMic ?? ((): void => {})}
          onToggleSound={audio.onToggleSound ?? ((): void => {})}
          seccao={audio.seccao ?? "conta"}
        />
      </ToastProvider>
    </BridgeContext.Provider>,
  )
}

/**
 * The section enters by PROP, not by a click.
 *
 * The menu lived inside this screen, in its own column, and the app sidebar
 * already showed "Settings" with an empty body next to it. Two columns for the
 * same thing. The menu moved to the sidebar, which is the column the app has to
 * navigate, and this screen kept only the panel: it receives the chosen section
 * and shows it.
 *
 * These tests stop clicking a menu that no longer lives here. The menu has its
 * own tests in `ChannelSidebar`.
 */

/**
 * The menu, and the reason it exists.
 *
 * This was a long sheet with six stacked cards, and nobody reached the sixth:
 * looking for microphone gain meant scrolling past accent color, address and
 * alerts. What these tests pin down is that only one section is in the document
 * at a time, and that is where all the difference lies.
 */
describe("Configurações — uma secção de cada vez", () => {
  it("abre na Conta, e as outras secções não estão sequer no documento", () => {
    renderSettings()

    expect(screen.getByRole("heading", { name: strings.settings.account })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: strings.settings.device })).toBeNull()
    expect(screen.queryByLabelText(strings.settings.micMuted)).toBeNull()
  })

  it("a secção que vem de fora é a que se vê, e só ela", () => {
    renderSettings({ seccao: "aparelhos" })

    expect(screen.getByRole("heading", { name: strings.settings.device })).toBeTruthy()
    // And the previous one leaves: it is not scrolling to it, it is replacing it.
    expect(screen.queryByRole("heading", { name: strings.settings.account })).toBeNull()
  })

  it("um id antigo cai em Conta, em vez de mostrar um painel vazio", () => {
    for (const antigo of ["aspecto", "voz", "cadeia", "diagnostico", "arquivados", "bloqueados", "aparelho"]) {
      renderSettings({ seccao: antigo })
      expect(screen.getByRole("heading", { name: strings.settings.account })).toBeTruthy()
      cleanup()
    }
  })

  it('a Conta tem a língua e "Bloquear agora"', () => {
    renderSettings()
    expect(screen.getByRole("heading", { name: strings.settings.language })).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.settings.languageAuto })).toBeTruthy()
    expect(screen.getByRole("button", { name: strings.settings.lockNow })).toBeTruthy()
  })

  it('Aparelhos tem, por baixo da lista, "Este aparelho", e a zona de perigo num cartão à parte', () => {
    renderSettings({ seccao: "aparelhos" })
    const este = screen.getByRole("heading", { name: strings.settings.device }).closest("section")!
    expect(within(este).queryByText(strings.settings.zonaDePerigo)).toBeNull()
    // Owner request (October 27, 2026): own card, highlighted title, full button.
    // The delete button is the only one on the card.
    const perigo = screen.getByRole("heading", { name: strings.settings.zonaDePerigo }).closest("section")!
    expect(perigo.classList.contains("zona-de-perigo")).toBe(true)
    const botoes = within(perigo).getAllByRole("button")
    expect(botoes).toHaveLength(1)
    expect(botoes[0]?.textContent).toBe(strings.settings.destroyAction)
    expect(botoes[0]?.classList.contains("danger")).toBe(true)
    expect(botoes[0]?.classList.contains("ghost")).toBe(false)
  })

  it('Ajuda e diagnóstico tem o cartão "Como funciona", que abre a página numa folha', async () => {
    renderSettings({ seccao: "ajuda" })
    expect(screen.getByRole("heading", { name: strings.comoFunciona.titulo })).toBeTruthy()
    await userEvent.setup().click(screen.getByRole("button", { name: strings.comoFunciona.ver }))
    const folha = screen.getByRole("dialog", { name: strings.comoFunciona.titulo })
    expect(folha.querySelectorAll(".como-funciona-cartao")).toHaveLength(6)
  })

  it("Ajuda e diagnóstico mostra a versão e leva ao código-fonte (AGPL-3.0, secção 13)", () => {
    renderSettings({ seccao: "ajuda" })
    const cartao = screen.getByRole("heading", { name: strings.settings.sobreVersao(VERSAO_DA_APP) }).closest("section")!
    const link = within(cartao).getByRole("link", { name: strings.settings.codigoFonte })
    expect(link.getAttribute("href")).toBe("https://github.com/magnuslab-sudo/orwell")
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noopener noreferrer")
  })

  it('Privacidade já não tem "O que a app guarda" nem a nota dos pedidos (dono, 28 de Outubro de 2026)', () => {
    renderSettings({ seccao: "privacidade" })
    expect(screen.queryByRole("heading", { name: strings.settings.oQueGuarda })).toBeNull()
    expect(screen.queryByText(strings.definicoesNovas.pedidosNota)).toBeNull()
  })

  it('a Conta diz "Expirar sessão", sem a nota de "Terminar sessão"', () => {
    renderSettings({ seccao: "conta" })
    expect(screen.getByText(strings.definicoesNovas.bloquearSozinho)).toBeTruthy()
    expect(strings.definicoesNovas.bloquearSozinho).toBe("Expirar sessão")
    expect(screen.queryByText(strings.settings.lockNote)).toBeNull()
  })

  it("o aviso de que exportar muda a conta de aparelho continua lá, que esse não é explicação nenhuma", () => {
    // The paragraphs explaining each switch below it left here. This one stays: it
    // is a fact that the person has no way to guess from a label alone. It no
    // longer says "one device at a time", which stopped being true with pairing: it
    // says that export and import MOVE the account elsewhere.
    renderSettings({ seccao: "aparelhos" })

    expect(screen.getByText(strings.settings.importReplacesDevice)).toBeTruthy()
    expect(strings.settings.importReplacesDevice).toContain("Acrescentar aparelho")
  })
})

/**
 * Export "the account" only exists where there is an account to export.
 *
 * On a paired device the vault has no account private key, and the file that
 * left here would not either: whoever imported it would get a clone of this
 * DEVICE's key (unable to add, remove or recover anything) and a toast telling
 * them "the file is the account". The button goes away, and in its place is
 * where the backup is made.
 */
describe("Configurações: exportar num aparelho sem a chave da conta", () => {
  it("sem a chave da conta não há botão de exportar, e diz-se onde é que isso se faz", async () => {
    renderSettings({ seccao: "aparelhos", bridge: ponteComChave(false) })

    await screen.findByText(strings.settings.exportNeedsAccountKey)
    // The device list says the same fact above: the phrase may appear twice.
    expect(screen.getAllByText(strings.pairing.noAccountKey).length).toBeGreaterThan(0)
    expect(screen.queryByRole("button", { name: strings.settings.exportAction })).toBeNull()
    // The rest of the section stays: deleting is from this device.
    expect(screen.getByRole("button", { name: strings.settings.destroyAction })).toBeTruthy()
  })

  it("com a chave da conta o botão está lá, como sempre esteve", async () => {
    renderSettings({ seccao: "aparelhos", bridge: ponteComChave(true) })

    expect(await screen.findByRole("button", { name: strings.settings.exportAction })).toBeTruthy()
    expect(screen.queryByText(strings.settings.exportNeedsAccountKey)).toBeNull()
  })
})

describe("Configurações — sons", () => {
  it("o toggle vem ligado e traz volume e amostra", () => {
    renderSettings({ seccao: "avisos" })
    const toggle = screen.getByLabelText(strings.settings.sounds) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    const slider = screen.getByLabelText(strings.settings.soundVolume) as HTMLInputElement
    expect(slider.value).toBe("100")
    expect(screen.getByRole("button", { name: strings.settings.soundSample })).toBeTruthy()
  })

  it("desligar guarda a escolha e arruma o volume", async () => {
    const user = userEvent.setup()
    renderSettings({ seccao: "avisos" })
    await user.click(screen.getByLabelText(strings.settings.sounds))

    expect(readPrefs().sounds).toBe(false)
    expect(screen.queryByLabelText(strings.settings.soundVolume)).toBeNull()
  })

  it("mexer no volume persiste o valor", () => {
    renderSettings({ seccao: "avisos" })
    fireEvent.change(screen.getByLabelText(strings.settings.soundVolume), { target: { value: "20" } })

    expect(readPrefs().soundVolume).toBe(20)
    expect((screen.getByLabelText(strings.settings.soundVolume) as HTMLInputElement).value).toBe("20")
  })

  it("a amostra não rebenta num ambiente sem áudio", async () => {
    const user = userEvent.setup()
    renderSettings({ seccao: "avisos" })
    await user.click(screen.getByRole("button", { name: strings.settings.soundSample }))
    // Without AudioContext (jsdom) the engine goes silent; the screen stays up.
    expect(screen.getByLabelText(strings.settings.sounds)).toBeTruthy()
  })
})

/**
 * Microphone and sound, where people expect to find them.
 *
 * Both were only in the sidebar corner card. Here the proof is that they exist
 * in Settings AND that they did not gain their own path to the same state: the
 * click here writes no preference, calls whoever already does, that is what
 * keeps the two places from diverging.
 */
describe("Configurações — microfone e som", () => {
  it("os interruptores mostram o estado que vem de cima", () => {
    renderSettings({ micMuted: true, soundOff: false, seccao: "media" })
    expect((screen.getByLabelText(strings.settings.micMuted) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText(strings.settings.soundOff) as HTMLInputElement).checked).toBe(false)
  })

  it("silenciar chama o interruptor da concha e não escreve preferências por fora", async () => {
    const user = userEvent.setup()
    const onToggleMic = vi.fn()
    renderSettings({ onToggleMic, seccao: "media" })

    await user.click(screen.getByLabelText(strings.settings.micMuted))

    expect(onToggleMic).toHaveBeenCalledTimes(1)
    // Nothing logged by this screen: who logs (and who alerts the engine) is the shell.
    expect(readPrefs().micMuted).toBe(false)
  })

  it("desligar o som chama o interruptor da concha", async () => {
    const user = userEvent.setup()
    const onToggleSound = vi.fn()
    renderSettings({ onToggleSound, seccao: "media" })

    await user.click(screen.getByLabelText(strings.settings.soundOff))

    expect(onToggleSound).toHaveBeenCalledTimes(1)
    expect(readPrefs().soundOff).toBe(false)
  })
})

describe("Configurações: atalhos de teclado da voz", () => {
  it("mostra os comandos com a tecla de fábrica, grava uma nova e tira-a a quem a tinha", async () => {
    renderSettings({ seccao: "media" })
    const cartao = screen.getByRole("region", { name: strings.settings.atalhos })
    expect(cartao).toBeTruthy()
    const linhaDoSom = cartao.querySelector('[data-accao="som"]') as HTMLElement
    expect(linhaDoSom.querySelector("kbd")?.textContent).toMatch(/D$/)

    // "Change" on sound, and press the combination that today belongs to the microphone.
    fireEvent.click(linhaDoSom.querySelector("button") as HTMLButtonElement)
    expect(linhaDoSom.textContent).toContain(strings.settings.atalhoAGravar)
    fireEvent.keyDown(document, { key: "m", ctrlKey: true, shiftKey: true })

    expect(readPrefs().atalhosDeVoz.som).toBe("Mod+Shift+M")
    expect(readPrefs().atalhosDeVoz.microfone).toBeNull()
    expect(linhaDoSom.querySelector("kbd")?.textContent).toMatch(/M$/)
  })

  it("uma tecla com dono não entra, e Esc desiste", () => {
    renderSettings({ seccao: "media" })
    const cartao = screen.getByRole("region", { name: strings.settings.atalhos })
    const linha = cartao.querySelector('[data-accao="falar"]') as HTMLElement
    fireEvent.click(linha.querySelector("button") as HTMLButtonElement)
    fireEvent.keyDown(document, { key: "Tab" })
    expect(readPrefs().atalhosDeVoz.falar).toBeNull()
    expect(linha.textContent).toContain(strings.settings.atalhoAGravar)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(linha.textContent).not.toContain(strings.settings.atalhoAGravar)
  })

  it("uma letra sozinha entra (ponto 8), com o aviso de que escreve", () => {
    renderSettings({ seccao: "media" })
    const cartao = screen.getByRole("region", { name: strings.settings.atalhos })
    const linha = cartao.querySelector('[data-accao="falar"]') as HTMLElement
    fireEvent.click(linha.querySelector("button") as HTMLButtonElement)
    fireEvent.keyDown(document, { key: "x" })
    expect(readPrefs().atalhosDeVoz.falar).toBe("X")
    expect(screen.getByText(strings.settings.atalhoAvisoComum)).toBeTruthy()
  })

  it('grava o botão 4 do rato e mostra-o como "Rato 4"; o clique normal não grava', () => {
    renderSettings({ seccao: "media" })
    const cartao = screen.getByRole("region", { name: strings.settings.atalhos })
    const linha = cartao.querySelector('[data-accao="microfone"]') as HTMLElement
    fireEvent.click(linha.querySelector("button") as HTMLButtonElement)
    fireEvent.mouseDown(document, { button: 0 })
    expect(linha.textContent).toContain(strings.settings.atalhoAGravar)
    fireEvent.mouseDown(document, { button: 3 })
    expect(readPrefs().atalhosDeVoz.microfone).toBe("Mouse4")
    expect(linha.querySelector("kbd")?.textContent).toBe(strings.settings.atalhoRato(4))
  })

  it("no browser diz que só funcionam com a página à frente", () => {
    renderSettings({ seccao: "media" })
    expect(screen.getByText(strings.settings.atalhosNota)).toBeTruthy()
    expect(screen.queryByText(strings.settings.atalhosNotaSecretaria)).toBeNull()
  })

  it("na app de secretária explica os globais e pára-os enquanto grava", () => {
    const suspender = vi.fn(async () => ({ ok: true }))
    const comGlobais = {
      atalhosGlobais: {
        definir: vi.fn(),
        suspender,
        abrirAcessibilidade: vi.fn(async () => ({ ok: true })),
        aoAccionar: vi.fn(() => () => {}),
      },
    } as unknown as EnclaveBridge
    renderSettings({ seccao: "media", bridge: comGlobais })
    expect(screen.getByText(strings.settings.atalhosNotaSecretaria)).toBeTruthy()
    const cartao = screen.getByRole("region", { name: strings.settings.atalhos })
    const linha = cartao.querySelector('[data-accao="som"]') as HTMLElement
    fireEvent.click(linha.querySelector("button") as HTMLButtonElement)
    expect(suspender).toHaveBeenLastCalledWith(true)
    fireEvent.keyDown(document, { key: "`" })
    expect(suspender).toHaveBeenLastCalledWith(false)
    expect(readPrefs().atalhosDeVoz.som).toBe("`")
    // The "`" on sound is global during a call: the alert says it stops writing to other apps.
    expect(screen.getByText(strings.settings.atalhoAvisoEscreve)).toBeTruthy()
  })
})

describe("SettingsScreen — Bloqueados", () => {
  function montarBloqueados(lista: { address: string; at: number }[], onDesbloquear = vi.fn()): ReturnType<typeof vi.fn> {
    render(
      <BridgeContext.Provider value={bridge}>
        <ToastProvider>
          <SettingsScreen
            address="@me:casa.pt"
            connection="online"
            connectionDetail={null}
            onLock={() => {}}
            micMuted={false}
            soundOff={false}
            onToggleMic={() => {}}
            onToggleSound={() => {}}
            seccao="privacidade"
            bloqueados={lista}
            nomeDe={(quem) => (quem === "@rui:casa.pt" ? "Rui" : quem)}
            onDesbloquear={onDesbloquear}
          />
        </ToastProvider>
      </BridgeContext.Provider>,
    )
    return onDesbloquear
  }

  it("lista quem está bloqueado, diz que a lista é deste aparelho, e desbloqueia", async () => {
    const user = userEvent.setup()
    const onDesbloquear = montarBloqueados([{ address: "@rui:casa.pt", at: 1_700_000_000_000 }])
    expect(screen.getByRole("heading", { name: strings.settings.blocked })).toBeTruthy()
    expect(screen.getByText(strings.settings.blockedNote)).toBeTruthy()
    expect(screen.getByText("Rui")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: strings.people.unblock }))
    expect(onDesbloquear).toHaveBeenCalledWith("@rui:casa.pt")
  })

  it("sem ninguém, di-lo", () => {
    montarBloqueados([])
    expect(screen.getByText(strings.settings.blockedEmpty)).toBeTruthy()
  })
})

/**
 * System notifications: a switch, and the browser permission asked when
 * turning on. These were two buttons, "Enable" and "Disable", that swapped
 * places.
 */
describe("Configurações — o interruptor das notificações", () => {
  function comNotification(permission: NotificationPermission, resposta: NotificationPermission = permission) {
    const requestPermission = vi.fn(async () => resposta)
    vi.stubGlobal("Notification", { permission, requestPermission })
    return requestPermission
  }
  afterEach(() => vi.unstubAllGlobals())

  it("ligar pede a permissão e guarda a escolha quando o browser deixa", async () => {
    const pedir = comNotification("default", "granted")
    renderSettings({ seccao: "avisos" })
    const interruptor = screen.getByRole("switch", { name: strings.settings.notifSystem })
    expect(interruptor.getAttribute("aria-checked")).toBe("false")

    await userEvent.setup().click(interruptor)

    expect(pedir).toHaveBeenCalledOnce()
    expect(readPrefs().notifications).toBe(true)
    expect(screen.getByRole("switch", { name: strings.settings.notifSystem }).getAttribute("aria-checked")).toBe("true")
    // When enabled, shows "Show content", and it's also a toggle.
    expect(screen.getByRole("switch", { name: strings.settings.notifPreview })).toBeTruthy()
  })

  it("desligar não pede nada ao browser", async () => {
    const pedir = comNotification("granted")
    localStorage.setItem("enclave.prefs", JSON.stringify({ notifications: true, chosen: true }))
    renderSettings({ seccao: "avisos" })

    await userEvent.setup().click(screen.getByRole("switch", { name: strings.settings.notifSystem }))

    expect(pedir).not.toHaveBeenCalled()
    expect(readPrefs().notifications).toBe(false)
  })

  it("bloqueadas pelo browser: o interruptor fica parado e a frase diz onde se desbloqueia", () => {
    comNotification("denied")
    renderSettings({ seccao: "avisos" })
    expect((screen.getByRole("switch", { name: strings.settings.notifSystem }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(strings.settings.notifBlocked)).toBeTruthy()
  })

  it("sem suporte não há interruptor nenhum, só a frase", () => {
    renderSettings({ seccao: "avisos" })
    expect(screen.queryByRole("switch", { name: strings.settings.notifSystem })).toBeNull()
    expect(screen.getByText(strings.settings.notifUnsupported)).toBeTruthy()
  })
})

/** In Account, the id is copied and not displayed (owner's decision, October 27, 2026). */
describe("SettingsScreen — Conta: o teu id", () => {
  it('só o botão "Copiar o teu id", sem o campo com o endereço', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, "writeText")
    renderSettings({ seccao: "conta" })
    expect(document.body.textContent).not.toContain("@me:casa.pt")
    expect(screen.queryByDisplayValue("@me:casa.pt")).toBeNull()
    await user.click(screen.getByRole("button", { name: strings.copiarId.proprio }))
    expect(writeText).toHaveBeenCalledWith("@me:casa.pt")
    expect(await screen.findByText(strings.copiarId.copiado)).toBeTruthy()
  })
})
