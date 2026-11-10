import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { StoredInvite } from "@enclave/client-core"
import { formatInviteLink, formatShortInviteLink, parseInviteLink } from "@enclave/client-core"
import { codificarQr, desenhoDoQr } from "../../lib/qr.js"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { ActiveInvites, ConviteDeLink } from "./InviteSheet.js"

afterEach(cleanup)

function invite(overrides: Partial<StoredInvite>): StoredInvite {
  return { codeHash: "abcdef1234567890", expiresAt: null, maxUses: null, uses: 0, ...overrides }
}

describe("ActiveInvites", () => {
  it("vazio diz que não há convites activos", () => {
    render(<ActiveInvites invites={[]} onRevoke={() => {}} />)
    // Read by the key, not by a copy of the phrase.
    expect(screen.getByText(strings.invite.activeEmpty)).toBeTruthy()
  })

  it("mostra expiração absoluta, 'nunca expira' e as utilizações", () => {
    const expiresAt = Math.floor(new Date(2027, 0, 15, 12, 30).getTime() / 1000)
    render(
      <ActiveInvites
        invites={[
          invite({ codeHash: "hash-um-ilimitado", uses: 3 }),
          invite({ codeHash: "hash-dois-limitado", expiresAt, maxUses: 5, uses: 2 }),
        ]}
        onRevoke={() => {}}
      />,
    )

    expect(screen.getByText("nunca expira")).toBeTruthy()
    expect(screen.getByText("3 utilizações · sem limite", { exact: false })).toBeTruthy()
    expect(screen.getByText(/^expira a /)).toBeTruthy()
    expect(screen.getByText("2/5 utilizações", { exact: false })).toBeTruthy()
  })

  it("revogar chama o callback com o hash certo, sem confirmação", async () => {
    const user = userEvent.setup()
    const onRevoke = vi.fn()
    render(
      <ActiveInvites
        invites={[invite({ codeHash: "hash-alvo" }), invite({ codeHash: "hash-outro" })]}
        onRevoke={onRevoke}
      />,
    )

    const buttons = screen.getAllByText("Revogar")
    expect(buttons).toHaveLength(2)
    await user.click(buttons[0]!)
    expect(onRevoke).toHaveBeenCalledExactlyOnceWith("hash-alvo")
  })
})

describe("ConviteDeLink: o link que se cria", () => {
  const LINK = formatInviteLink("orwell.pt", "!geral:orwell.pt", "AbCdEfGhIjKlMnOpQrStUvWxYz012345")

  function folha(aplicacaoInstalada: boolean): { create: ReturnType<typeof vi.fn> } {
    const create = vi.fn(async () => LINK)
    const bridge = {
      invites: { create, list: async () => [], revoke: async () => ({ ok: true }), redeem: async () => ({ ok: true }) },
      ...(aplicacaoInstalada ? { actualizacao: {} } : {}),
    } as unknown as EnclaveBridge
    render(
      <BridgeContext.Provider value={bridge}>
        <ToastProvider>
          <ConviteDeLink channel="!geral:orwell.pt" />
        </ToastProvider>
      </BridgeContext.Provider>,
    )
    return { create }
  }

  it("por omissão vale um dia e uma pessoa, mostra um https que se lê de volta, e diz o cuidado a ter", async () => {
    const user = userEvent.setup()
    const { create } = folha(false)
    await user.click(screen.getByRole("button", { name: strings.invite.createLink }))

    expect(create).toHaveBeenCalledExactlyOnceWith("!geral:orwell.pt", { expiresInSeconds: 86_400, maxUses: 1 })
    const campo = (await screen.findByDisplayValue(LINK)) as HTMLInputElement
    expect(campo.readOnly).toBe(true)
    expect(parseInviteLink(campo.value)?.channel).toBe("!geral:orwell.pt")
    expect(screen.getByText(strings.invite.linkCare)).toBeTruthy()
    // In the browser the link opens this same app: the installed version's phrase was wrong.
    expect(screen.queryByText(strings.invite.desktopNote)).toBeNull()
  })

  it("na aplicação instalada diz que o link abre no browser, e onde se cola", async () => {
    const user = userEvent.setup()
    folha(true)
    await user.click(screen.getByRole("button", { name: strings.invite.createLink }))
    expect(await screen.findByText(strings.invite.desktopNote)).toBeTruthy()
    expect(strings.invite.desktopNote).toContain(strings.sidebar.joinWithLink)
  })
})

describe('ConviteDeLink: a ligação curta (1.0 "Arca", fatia 5b-2)', () => {
  const CURTA = formatShortInviteLink("orwell.pt", "ab23cd45", "0123456789abcdef")

  it('o campo, o "Copiar" e o QR dão a curta que a ponte devolve', async () => {
    const user = userEvent.setup()
    const escrever = vi.fn(async () => {})
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true })
    const bridge = {
      invites: { create: vi.fn(async () => CURTA), list: async () => [], revoke: async () => ({ ok: true }), redeem: async () => ({ ok: true }) },
    } as unknown as EnclaveBridge
    render(
      <BridgeContext.Provider value={bridge}>
        <ToastProvider>
          <ConviteDeLink channel="!geral:orwell.pt" />
        </ToastProvider>
      </BridgeContext.Provider>,
    )
    // Before creation, there is no QR code: there is nothing to read.
    expect(screen.queryByRole("img", { name: strings.invite.qrAlt })).toBeNull()
    await user.click(screen.getByRole("button", { name: strings.invite.createLink }))

    expect(await screen.findByDisplayValue(CURTA)).toBeTruthy()
    const qr = screen.getByRole("img", { name: strings.invite.qrAlt })
    expect(qr.querySelector("path")?.getAttribute("d")).toBe(desenhoDoQr(codificarQr(CURTA)).d)

    await user.click(screen.getByRole("button", { name: strings.invite.copyLink }))
    expect(escrever).toHaveBeenCalledExactlyOnceWith(CURTA)
  })
})
