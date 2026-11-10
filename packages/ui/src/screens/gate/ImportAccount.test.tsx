import { afterEach, describe, expect, it, vi } from "vitest"
import { CABECALHO_DO_COFRE } from "@enclave/client-core"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { strings } from "../../strings.js"
import { ImportAccount } from "./ImportAccount.js"

afterEach(cleanup)

/**
 * The warning that importing CHANGES the account on the device, on the path that
 * might disobey it.
 *
 * Two devices with the same account exist since pairing (slice 4 of multi-device),
 * but not through this gate: the account IS the MLS sheet, and two COPIES of the
 * same vault advancing the tree at the same time break the channel cipher for good.
 * The app warns before letting them try, and points to the right path (Add device).
 * There are exactly two places where someone reaches this gesture: Settings, when
 * exporting (pinned in `SettingsScreen.test.tsx`), and this screen, when importing.
 *
 * This second one had no test, and it is the more important of the two. Exporting
 * is half an action: the file stays on disk and harms no one. Importing is the
 * other half, and it is what puts the second copy running.
 *
 * The Setup sheet uses THIS component on the two gates where it is reached,  * "I already have an account" on creation, and "there is an account on this
 * device" when the vault exists, so pinning the component pins both.
 */

const importar = vi.fn(async () => ({ ok: true }))

/**
 * An envelope with the shape that `exportVault` writes (the encrypted part is
 * noise). `ImportAccount` rejects at choice what does not have this shape: see
 * `pareceFicheiroDeConta`.
 */
const FICHEIRO = CABECALHO_DO_COFRE + JSON.stringify({
  format: "enclave-vault",
  formatVersion: 1,
  exportedAt: 0,
  vault: { version: 1, protection: "passphrase", salt: "c2Fs", nonce: "bm9uY2U=", ciphertext: "Y2lmcmFkbw==" },
})

function ponte(): EnclaveBridge {
  importar.mockClear()
  return {
    vault: { import: importar, unlock: vi.fn(async () => ({ ok: true })) },
    identity: { load: async () => ({ address: "@abc:orwell.pt", accountId: "abc" }) },
    session: { connect: async () => ({ ok: true }) },
  } as unknown as EnclaveBridge
}

function ecra(replacing = false): void {
  render(
    <BridgeContext.Provider value={ponte()}>
      <ImportAccount replacing={replacing} onDone={vi.fn()} />
    </BridgeContext.Provider>,
  )
}

/** Choose a file, the gesture that opens the rest of the form. */
async function escolherFicheiro(): Promise<void> {
  const entrada = document.querySelector('input[type="file"]') as HTMLInputElement
  const ficheiro = new File([FICHEIRO], "conta.enclave", { type: "application/json" })
  fireEvent.change(entrada, { target: { files: [ficheiro] } })
  // The file is read by `FileReader`, which resolves outside this tick.
  await waitFor(() => expect(screen.queryByLabelText(strings.gate.importPassLabel)).toBeTruthy())
}

describe("importar uma conta avisa antes de deixar tentar", () => {
  it("com o ficheiro escolhido, o aviso está no ecrã antes do botão", async () => {
    ecra()
    await escolherFicheiro()
    expect(screen.getByText(strings.settings.importReplacesDevice)).toBeTruthy()
  })

  it("e está lá também quando importar DESTRÓI a conta que já cá está", async () => {
    // The more dangerous of the two gates, and the one someone with two machines
    // finds first.
    ecra(true)
    await escolherFicheiro()
    expect(screen.getByText(strings.settings.importReplacesDevice)).toBeTruthy()
  })

  it("é a MESMA frase das Configurações, e não uma prima que se afasta", () => {
    // Both paths read the same key, and this test is what stops someone
    // from typing a second passphrase "just for here". Two passphrases over the
    // same impossibility always end with one milder than the other.
    // And it is the TRUE passphrase: importing changes the device account, and for
    // two devices there is another path. "One device at a time" stopped being
    // true the day pairing landed.
    expect(strings.settings.importReplacesDevice).toContain("passa a conta para este aparelho")
    expect(strings.settings.importReplacesDevice).toContain("Acrescentar aparelho")
  })

  it("o aviso vem antes do botão que importa, na ordem de leitura", async () => {
    ecra()
    await escolherFicheiro()
    const aviso = screen.getByText(strings.settings.importReplacesDevice)
    const botao = screen.getByRole("button", { name: strings.gate.importAction })
    // A warning below the button it warns about is a warning read after
    // it is clicked.
    expect(aviso.compareDocumentPosition(botao)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })
})

/**
 * Importing over an account already here DELETES that account. It is asked
 * with the same Settings and gate sheet, password typed included, not with two
 * `window.confirm` in a row.
 */
describe("importar por cima pede a palavra, como apagar a conta", () => {
  async function submeter(): Promise<void> {
    await escolherFicheiro()
    fireEvent.change(screen.getByLabelText(strings.gate.importPassLabel), { target: { value: "frase do ficheiro" } })
    fireEvent.click(screen.getByRole("button", { name: strings.gate.importAction }))
  }

  it("abre a folha com a frase de importar, e nada se importa sem a palavra", async () => {
    ecra(true)
    await submeter()
    const folha = await screen.findByRole("alertdialog", { name: strings.settings.destroyTitle })
    expect(folha.textContent).toContain(strings.settings.destroyStepsImport)
    expect(importar).not.toHaveBeenCalled()

    fireEvent.change(within(folha).getByLabelText(strings.settings.destroyConfirmLabel), {
      target: { value: strings.settings.destroyConfirmWord },
    })
    fireEvent.click(within(folha).getByRole("button", { name: strings.settings.destroyConfirm }))
    await waitFor(() => expect(importar).toHaveBeenCalledWith(FICHEIRO, "frase do ficheiro"))
  })

  it("cancelar não importa nada", async () => {
    ecra(true)
    await submeter()
    const folha = await screen.findByRole("alertdialog", { name: strings.settings.destroyTitle })
    fireEvent.click(within(folha).getByRole("button", { name: strings.confirmar.cancelar }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(importar).not.toHaveBeenCalled()
  })

  it("sem conta no aparelho, importa logo, sem folha nenhuma", async () => {
    ecra(false)
    await submeter()
    await waitFor(() => expect(importar).toHaveBeenCalled())
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })
})

/**
 * 1.0 "Arca", slice 2: a file exported by 0.9.x (the envelope without the
 * `orwv2` header) does not come in. It is rejected at choice, by name, before
 * the password; and the bridge is never called.
 */
describe("um ficheiro de conta do beta", () => {
  it("diz que é do beta, não abre o resto do formulário e não importa nada", async () => {
    ecra()
    const entrada = document.querySelector('input[type="file"]') as HTMLInputElement
    const doBeta = new File([FICHEIRO.slice(CABECALHO_DO_COFRE.length)], "conta.enclave", { type: "application/json" })
    fireEvent.change(entrada, { target: { files: [doBeta] } })
    await waitFor(() =>
      expect(screen.getByText("Este ficheiro é de uma versão do beta. Não pode entrar nesta versão.")).toBeTruthy(),
    )
    expect(screen.getByText(/131/)).toBeTruthy()
    expect(screen.queryByLabelText(strings.gate.importPassLabel)).toBeNull()
    expect(importar).not.toHaveBeenCalled()
  })
})
