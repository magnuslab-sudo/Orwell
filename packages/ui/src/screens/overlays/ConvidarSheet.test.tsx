import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { ConvidarSheet, fraseDeMeter, type ModoDeConvite } from "./ConvidarSheet.js"

afterEach(cleanup)

const CANAL = "!lagar:s"
const ANA = "@ana:s"

/** The mode buttons, apart from the action button that may have the same verb. */
const modos = (): HTMLElement => screen.getByRole("group", { name: strings.convidar.modosLabel })
const accao = (): HTMLElement => document.querySelector(".convidar .sheet-actions") as HTMLElement

/**
 * The single invite sheet: three modes, one channel always explicit.
 *
 * There were five doors and three behaviors. What these tests pin down is that
 * each mode performs its gesture, and performs it in the channel the sheet
 * received.
 */
function folha(
  over: { pessoa?: string; modoInicial?: ModoDeConvite; podeMeter?: boolean } = {},
): {
  invite: ReturnType<typeof vi.fn>
  repairInvite: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
} {
  const invite = vi.fn(async () => ({ ok: true }))
  const repairInvite = vi.fn(async () => ({ invited: true, outcome: "invited" }))
  const create = vi.fn(async () => "https://s/app/convite#x")
  const onClose = vi.fn()
  const bridge = {
    channels: { invite },
    social: { repairInvite },
    invites: { create, list: async () => [], revoke: async () => ({ ok: true }) },
  } as unknown as EnclaveBridge
  render(
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <ConvidarSheet channel={CANAL} label="lagar" onClose={onClose} {...over} />
      </ToastProvider>
    </BridgeContext.Provider>,
  )
  return { invite, repairInvite, create, onClose }
}

describe("ConvidarSheet", () => {
  it("por omissão convida por endereço, e manda o convite para o canal da folha", async () => {
    const user = userEvent.setup()
    const { invite, onClose } = folha()
    expect(screen.getByRole("heading", { name: strings.convidar.title("lagar") })).toBeTruthy()
    await user.type(screen.getByLabelText(strings.prompts.personLabel), ANA)
    await user.click(screen.getByRole("button", { name: strings.convidar.enderecoAccao }))
    expect(invite).toHaveBeenCalledExactlyOnceWith(CANAL, ANA)
    expect(await screen.findByText(strings.userMenu.invited("lagar"))).toBeTruthy()
    expect(onClose).toHaveBeenCalled()
  })

  it("vinda do menu de uma pessoa, traz o endereço já escrito", async () => {
    const user = userEvent.setup()
    const { invite } = folha({ pessoa: ANA })
    expect((screen.getByLabelText(strings.prompts.personLabel) as HTMLInputElement).value).toBe(ANA)
    await user.click(screen.getByRole("button", { name: strings.convidar.enderecoAccao }))
    expect(invite).toHaveBeenCalledWith(CANAL, ANA)
  })

  it('"Meter já" usa o caminho sem licença, com força, e diz o que fez', async () => {
    const user = userEvent.setup()
    const { repairInvite, invite } = folha({ pessoa: ANA, podeMeter: true })
    await user.click(within(modos()).getByRole("button", { name: strings.convidar.modoMeter }))
    // The button verb is the mode's: "Add now".
    expect(strings.convidar.meterAccao).toBe(strings.convidar.modoMeter)
    await user.click(within(accao()).getByRole("button", { name: strings.convidar.meterAccao }))
    expect(repairInvite).toHaveBeenCalledExactlyOnceWith(CANAL, ANA, true)
    expect(invite).not.toHaveBeenCalled()
    expect(await screen.findByText(strings.prompts.seatDone)).toBeTruthy()
  })

  it('sem a responsabilidade, o modo "Meter já" não aparece', () => {
    folha({ podeMeter: false })
    expect(within(modos()).queryByRole("button", { name: strings.convidar.modoMeter })).toBeNull()
    // And asking to open in it falls through to the address, instead of drawing a mode that does not exist.
    cleanup()
    folha({ podeMeter: false, modoInicial: "meter" })
    expect(screen.getByRole("button", { name: strings.convidar.enderecoAccao })).toBeTruthy()
  })

  it('cada desfecho de "Meter já" tem a sua frase: "já estava a ler" só quando estava', () => {
    expect(fraseDeMeter("live")).toBe(strings.prompts.seatAlready)
    for (const outro of ["unproven", "cooldown", "device-unreachable"] as const) {
      expect(fraseDeMeter(outro)).not.toBe(strings.prompts.seatAlready)
      expect(fraseDeMeter(outro)).not.toBe(strings.prompts.seatDone)
    }
  })

  it('o "Por link" vive num `.sheet-grupo`: o invólucro não come o espaço entre os blocos', () => {
    // The bug in 0.7.2: a plain `<div>` around the link, and "Expires in",
    // "Use for" and "Create link" were stuck to each other.
    folha({ modoInicial: "link" })
    const corpo = document.querySelector(".sheet-body")!
    const grupo = [...corpo.children].find((filho) => filho.querySelector(".choice"))
    expect(grupo?.classList.contains("sheet-grupo")).toBe(true)
  })

  it('aberta em "Por link" (o rodapé dos membros), e o link não se perde ao mudar de modo', async () => {
    const user = userEvent.setup()
    folha({ modoInicial: "link" })
    await user.click(screen.getByRole("button", { name: strings.invite.createLink }))
    expect(await screen.findByDisplayValue("https://s/app/convite#x")).toBeTruthy()
    await user.click(within(modos()).getByRole("button", { name: strings.convidar.modoEndereco }))
    await user.click(within(modos()).getByRole("button", { name: strings.convidar.modoLink }))
    expect(screen.getByDisplayValue("https://s/app/convite#x")).toBeTruthy()
  })

  it('"Por link" cria o link do canal da folha', async () => {
    const user = userEvent.setup()
    const { create } = folha()
    await user.click(within(modos()).getByRole("button", { name: strings.convidar.modoLink }))
    await user.click(screen.getByRole("button", { name: strings.invite.createLink }))
    expect(create).toHaveBeenCalledWith(CANAL, { expiresInSeconds: 86_400, maxUses: 1 })
  })

  it("o modo escolhido diz-se: botões a sério, com aria-pressed", async () => {
    const user = userEvent.setup()
    folha({ podeMeter: true })
    const link = within(modos()).getByRole("button", { name: strings.convidar.modoLink })
    expect(link.getAttribute("aria-pressed")).toBe("false")
    await user.click(link)
    expect(link.getAttribute("aria-pressed")).toBe("true")
  })

  it("sem endereço não se envia nada", () => {
    const { invite } = folha()
    expect((screen.getByRole("button", { name: strings.convidar.enderecoAccao }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(invite).not.toHaveBeenCalled()
  })
})
