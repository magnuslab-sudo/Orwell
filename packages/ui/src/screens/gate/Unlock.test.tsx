import { afterEach, describe, expect, it, vi } from "vitest"
import { CABECALHO_DO_COFRE } from "@enclave/client-core"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge, PairEvento } from "../../bridge.js"
import { errosPt } from "../../linguas/pt.js"
import { strings } from "../../strings.js"
import { Unlock } from "./Unlock.js"

afterEach(cleanup)

/**
 * Only what the gate touches. Everything else would be noise: this screen
 * unlocks a vault, loads an identity, and asks the session to connect.
 */
function bridgeWith(overrides: {
  unlock?: (secret: string | null) => Promise<{ ok: boolean }>
  connect?: () => Promise<{ ok: boolean }>
  destroy?: () => Promise<{ ok: boolean }>
}): EnclaveBridge {
  return {
    vault: {
      unlock: overrides.unlock ?? (async () => ({ ok: true })),
      destroy: overrides.destroy ?? (async () => ({ ok: true })),
      import: async () => ({ ok: true }),
    },
    identity: { load: async () => ({ address: "@abc:orwell.pt", accountId: "abc" }) },
    session: { connect: overrides.connect ?? (async () => ({ ok: true })) },
  } as unknown as EnclaveBridge
}

function renderUnlock(
  bridge: EnclaveBridge,
  onDone: (address: string) => void,
  onStartOver = vi.fn(),
): void {
  render(
    <BridgeContext.Provider value={bridge}>
      <Unlock onDone={onDone} onStartOver={onStartOver} />
    </BridgeContext.Provider>,
  )
}

/** The vault exists and asks for password: it is the only state with a screen. */
function bridgeQuePedeFrase(destroy?: () => Promise<{ ok: boolean }>): EnclaveBridge {
  return bridgeWith({
    // `exactOptionalPropertyTypes` tells "no key" apart from "key with
    // `undefined` inside", and passing the argument raw was the second: the
    // `typecheck` stayed red, and a red `typecheck` is where bugs the compiler
    // already saw hide out. See `App.tsx`, where a nonexistent `bridge.people`
    // survived under this line.
    ...(destroy ? { destroy } : {}),
    unlock: async (secret) =>
      secret === null ? Promise.reject(new Error("this vault needs a passphrase")) : { ok: true },
  })
}

describe("Unlock", () => {
  it("entra na aplicação mesmo com o servidor em baixo", async () => {
    // The vault opens; only the connection fails. Refusing entry here left an
    // account unreachable offline — including everything already stored on the
    // device — and, on a keychain vault, asked for a passphrase that does not
    // exist. The banner and the reconnect loop are what a dead server is for.
    const onDone = vi.fn()
    renderUnlock(
      bridgeWith({ connect: async () => Promise.reject(new Error("could not reach the homeserver")) }),
      onDone,
    )

    // And the failure comes with it, for the connection banner to say: swallowed,
    // it opened an application with no channels and no sign of why.
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("@abc:orwell.pt", expect.any(Error)))
    expect((onDone.mock.calls[0]?.[1] as Error).message).toBe("could not reach the homeserver")
  })

  it("um cofre que precisa de palavra-passe continua a pedi-la", async () => {
    const onDone = vi.fn()
    renderUnlock(
      bridgeWith({
        unlock: async (secret) =>
          secret === null ? Promise.reject(new Error("this vault needs a passphrase")) : { ok: true },
      }),
      onDone,
    )

    await waitFor(() => expect(screen.getByLabelText("Palavra-passe")).toBeTruthy())
    expect(onDone).not.toHaveBeenCalled()
  })

  it('enquanto a chave se deriva, o botão diz "A abrir…" com um anel a girar', async () => {
    // Derivation takes up to seven seconds on a phone. Just the word, with
    // nothing moving, read as an application stuck (owner, 26 October
    // 2026). The ring is decoration: what the screen reader hears is the note.
    renderUnlock(
      bridgeWith({
        unlock: (secret) =>
          secret === null ? Promise.reject(new Error("this vault needs a passphrase")) : new Promise(() => {}),
      }),
      vi.fn(),
    )
    fireEvent.change(await screen.findByLabelText(strings.gate.passphrase), { target: { value: "segredo" } })
    fireEvent.click(screen.getByRole("button", { name: strings.gate.open }))

    const botao = await screen.findByRole("button", { name: strings.gate.opening })
    expect((botao as HTMLButtonElement).disabled).toBe(true)
    expect(botao.querySelector(".anel-ocupado")).toBeTruthy()
    expect(botao.querySelector(".anel-ocupado")?.getAttribute("aria-hidden")).toBe("true")
    expect(screen.getByRole("status").textContent).toBe(strings.gate.openingNote)
  })

  /*
   * Whoever forgot the password had no way out: the account lives only on
   * this device and no one resets it. The path exists, and it destroys, so what
   * locks here is that it only destroys after the password is typed: the same
   * Settings sheet, not two `window.confirm` in a row.
   */
  describe("perdi a conta", () => {
    /** Open the sheet from the gate footer. */
    async function abrirFolha(): Promise<HTMLElement> {
      fireEvent.click(await screen.findByRole("button", { name: strings.gate.lostAccountAction }))
      return screen.findByRole("alertdialog", { name: strings.settings.destroyTitle })
    }

    it("apaga o cofre e manda começar de novo, depois de escrever a palavra", async () => {
      const destroy = vi.fn(async () => ({ ok: true }))
      const onStartOver = vi.fn()
      const nativo = vi.spyOn(window, "confirm")
      renderUnlock(bridgeQuePedeFrase(destroy), vi.fn(), onStartOver)

      const folha = await abrirFolha()
      // The channel sentence is the gate one: with the vault closed you do not leave them.
      expect(folha.textContent).toContain(strings.settings.destroyStepsGate)
      expect(folha.textContent).not.toContain(strings.settings.destroySteps)
      const botao = within(folha).getByRole("button", { name: strings.settings.destroyConfirm })
      expect((botao as HTMLButtonElement).disabled).toBe(true)

      fireEvent.change(within(folha).getByLabelText(strings.settings.destroyConfirmLabel), {
        target: { value: strings.settings.destroyConfirmWord },
      })
      fireEvent.click(botao)

      await waitFor(() => expect(onStartOver).toHaveBeenCalled())
      expect(destroy).toHaveBeenCalledTimes(1)
      expect(nativo).not.toHaveBeenCalled()
      nativo.mockRestore()
    })

    it("e não apaga nada se a pessoa cancelar", async () => {
      const destroy = vi.fn(async () => ({ ok: true }))
      const onStartOver = vi.fn()
      renderUnlock(bridgeQuePedeFrase(destroy), vi.fn(), onStartOver)

      const folha = await abrirFolha()
      fireEvent.click(within(folha).getByRole("button", { name: strings.confirmar.cancelar }))

      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
      expect(destroy).not.toHaveBeenCalled()
      expect(onStartOver).not.toHaveBeenCalled()
    })

    it("uma falha fica na folha, e a conta fica de pé", async () => {
      const destroy = vi.fn(async () => {
        throw new Error("could not reach the homeserver")
      })
      const onStartOver = vi.fn()
      renderUnlock(bridgeQuePedeFrase(destroy), vi.fn(), onStartOver)

      const folha = await abrirFolha()
      fireEvent.change(within(folha).getByLabelText(strings.settings.destroyConfirmLabel), {
        target: { value: strings.settings.destroyConfirmWord },
      })
      fireEvent.click(within(folha).getByRole("button", { name: strings.settings.destroyConfirm }))

      expect(await within(folha).findByRole("alert")).toBeTruthy()
      expect(within(folha).getByRole("button", { name: strings.settings.destroyRetry })).toBeTruthy()
      expect(onStartOver).not.toHaveBeenCalled()
    })
  })

  /*
   * Phase 2 of the settings plan 0.9: "Sign in with another account", in the
   * safe order (report `definicoes-0-9-fase7-relatorio.md`, point "sheet
   * order").
   *
   * A second line in the footer opens a sheet with two paths, import and pair.
   * What locks: CHOOSE FIRST, DELETE AT THE END. The sheet no longer deletes
   * anything up front; the file is chosen and read with this account intact,
   * and a bad file (no account shape, or wrong password) does not delete it.
   * In pairing, the "delete" is asked in the key "Continue", but pairing runs
   * in a temporary vault (core 1j) and this account only leaves disk on
   * `pairing.done`, with the new account inside.
   */
  describe("entrar com outra conta", () => {
    const LINK = "https://orwell.pt/app/emparelhar#6gzjKC5Y-jxiXv_ZLoIzYX6ZL4PeZ24HirzSb__z6VY"
    /** An envelope shaped like `exportVault`. The encrypted part is noise. */
    const FICHEIRO_BOM = CABECALHO_DO_COFRE + JSON.stringify({
      format: "enclave-vault",
      formatVersion: 1,
      exportedAt: 0,
      vault: { version: 1, protection: "passphrase", salt: "c2Fs", nonce: "bm9uY2U=", ciphertext: "Y2lmcmFkbw==" },
    })

    /**
     * A bridge to disk: `noDisco` says if there is a vault, and `chamadas` keeps
     * the order of what touched it. `import` does what the core does: decrypts
     * BEFORE writing, and a wrong password throws without touching disk.
     */
    function ponteComDisco(): {
      bridge: EnclaveBridge
      chamadas: string[]
      disco: { noDisco: boolean; conta: string }
      emitir: (evento: PairEvento) => void
    } {
      const chamadas: string[] = []
      /*
        `conta` is what disk stores. The temporary one lives in the bridge's
        "memory" (`provisorio`) until `pairing.done`, like `Vault.criarProvisorio`;
        `pairing.cancel` releases it without touching disk.
      */
      const disco = { noDisco: true, conta: "@cá:orwell.pt" }
      let provisorio = false
      let ouvinte: ((evento: PairEvento) => void) | null = null
      const bridge = {
        vault: {
          status: async () => ({ exists: disco.noDisco, supportsOsProtection: false }),
          unlock: async (secret: string | null) => {
            if (secret === null) throw new Error("this vault needs a passphrase")
            chamadas.push("vault.unlock")
            return { ok: true }
          },
          destroy: async () => {
            chamadas.push("vault.destroy")
            disco.noDisco = false
            return { ok: true }
          },
          create: async () => {
            chamadas.push("vault.create")
            disco.noDisco = true
            disco.conta = ""
            return { ok: true }
          },
          createProvisional: async () => {
            chamadas.push("vault.createProvisional")
            provisorio = true
            return { ok: true }
          },
          import: async (_data: string, frase: string) => {
            if (frase !== "frase do ficheiro") throw new Error("wrong passphrase, or the vault is damaged")
            chamadas.push("vault.import")
            return { ok: true }
          },
        },
        identity: { load: async () => ({ address: "@outra:orwell.pt", accountId: "outra" }) },
        session: { connect: async () => ({ ok: true }) },
        pairing: {
          join: async (link: string) => {
            chamadas.push(`join ${link}`)
            return { ok: true }
          },
          confirm: async () => ({ ok: true }),
          refuse: async () => ({ ok: true }),
          cancel: async () => {
            if (provisorio) chamadas.push("provisório largado")
            provisorio = false
            return { ok: true }
          },
          done: async () => {
            if (provisorio) {
              chamadas.push("provisório gravado")
              disco.noDisco = true
              disco.conta = "@outra:orwell.pt"
            }
            provisorio = false
            chamadas.push("done")
            return { ok: true }
          },
        },
        on: {
          pair: (handler: (evento: PairEvento) => void) => {
            ouvinte = handler
            return () => {
              ouvinte = null
            }
          },
        },
      } as unknown as EnclaveBridge
      return { bridge, chamadas, disco, emitir: (evento) => ouvinte?.(evento) }
    }

    async function abrirOutraConta(): Promise<HTMLElement> {
      fireEvent.click(await screen.findByRole("button", { name: strings.gate.otherAccount }))
      return screen.findByRole("dialog", { name: strings.gate.otherAccountTitle })
    }

    async function confirmarApagar(): Promise<void> {
      const pergunta = await screen.findByRole("alertdialog", { name: strings.settings.destroyTitle })
      const botao = within(pergunta).getByRole("button", { name: strings.settings.destroyConfirm })
      // Confirmation is mandatory: without the password, the button does nothing.
      expect((botao as HTMLButtonElement).disabled).toBe(true)
      fireEvent.change(within(pergunta).getByLabelText(strings.settings.destroyConfirmLabel), {
        target: { value: strings.settings.destroyConfirmWord },
      })
      expect((botao as HTMLButtonElement).disabled).toBe(false)
      fireEvent.click(botao)
    }

    /** Sheet open, "Import", and a file chosen. */
    async function escolherFicheiro(conteudo: string): Promise<void> {
      const folha = await abrirOutraConta()
      fireEvent.click(within(folha).getByRole("button", { name: strings.gate.otherAccountImport }))
      const entrada = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(entrada, { target: { files: [new File([conteudo], "conta.enclave")] } })
    }

    /** The file password, and "Import". */
    async function submeterFrase(frase: string): Promise<void> {
      const campo = await screen.findByLabelText(strings.gate.importPassLabel)
      fireEvent.change(campo, { target: { value: frase } })
      fireEvent.click(screen.getByRole("button", { name: strings.gate.importAction }))
    }

    /** From the gate to the pairing key page, without deleting anything. */
    async function ateAChave(): Promise<void> {
      const folha = await abrirOutraConta()
      fireEvent.click(within(folha).getByRole("button", { name: strings.gate.otherAccountPair }))
      fireEvent.change(await screen.findByLabelText(strings.pairing.pasteLabel), { target: { value: LINK } })
      fireEvent.click(screen.getByRole("button", { name: strings.pairing.pasteAction }))
      const campos = document.querySelectorAll('input[type="password"]')
      fireEvent.change(campos[0] as Element, { target: { value: "frase-de-teste-8" } })
      fireEvent.change(campos[1] as Element, { target: { value: "frase-de-teste-8" } })
    }

    it("o rodapé tem a segunda linha, e a folha mostra os dois caminhos com o preço de cada um", async () => {
      renderUnlock(bridgeQuePedeFrase(), vi.fn())
      // Two lines in the same footer: the usual one and this. The "How it works"
      // came out of login on 28 October 2026.
      const link = await screen.findByRole("button", { name: strings.gate.otherAccount })
      expect(link.closest(".gate-rodape")?.querySelectorAll("p")).toHaveLength(2)

      const folha = await abrirOutraConta()
      expect(within(folha).getByRole("button", { name: strings.gate.otherAccountImport })).toBeTruthy()
      expect(within(folha).getByRole("button", { name: strings.gate.otherAccountPair })).toBeTruthy()
      // The sentence above states the new order: choose first, delete at the end.
      expect(folha.textContent).toContain(strings.outraConta.lead)
      // With the vault closed, the deleted account does not leave channels: state it first.
      expect(folha.textContent).toContain(strings.settings.destroyStepsImport)
      expect(folha.textContent).toContain(strings.settings.destroyStepsPair)
    })

    it("importar: abre o ImportAccount sem apagar nada, e fechar volta ao portão", async () => {
      const { bridge, chamadas } = ponteComDisco()
      const onStartOver = vi.fn()
      renderUnlock(bridge, vi.fn(), onStartOver)
      const folha = await abrirOutraConta()
      fireEvent.click(within(folha).getByRole("button", { name: strings.gate.otherAccountImport }))

      expect(await screen.findByText(strings.gate.importPick)).toBeTruthy()
      expect(screen.queryByRole("alertdialog")).toBeNull()

      fireEvent.click(screen.getByRole("button", { name: strings.common.close }))
      expect(screen.queryByRole("dialog")).toBeNull()
      // The account here never stopped existing: the gate keeps asking for it.
      expect(onStartOver).not.toHaveBeenCalled()
      expect(screen.getByRole("heading", { name: strings.gate.unlockTitle })).toBeTruthy()
      expect(chamadas).toEqual([])
    })

    it("importar: um ficheiro que não é de conta é recusado ao escolher, antes de pedir seja o que for", async () => {
      const { bridge, chamadas } = ponteComDisco()
      renderUnlock(bridge, vi.fn())
      await escolherFicheiro('{"v":1}')

      await waitFor(() =>
        expect(document.querySelector(".import-account .error")?.textContent).toContain(
          errosPt["this is not an enclave account file"] as string,
        ),
      )
      // Neither password nor delete sheet: nothing to confirm.
      expect(screen.queryByLabelText(strings.gate.importPassLabel)).toBeNull()
      expect(screen.queryByRole("alertdialog")).toBeNull()
      expect(chamadas).toEqual([])
    })

    it('importar: com a palavra-passe errada, o "apagar" escrito não apaga a conta', async () => {
      // This is the case the old order lost: account deleted at the top, and the
      // file failing next. Now the core decrypts before writing, and the error
      // stays in the form with the account here on disk.
      const { bridge, chamadas, disco } = ponteComDisco()
      const onDone = vi.fn()
      const onStartOver = vi.fn()
      renderUnlock(bridge, onDone, onStartOver)
      await escolherFicheiro(FICHEIRO_BOM)
      await submeterFrase("frase errada")
      await confirmarApagar()

      await waitFor(() =>
        expect(document.querySelector(".import-account .error")?.textContent).toContain(
          errosPt["wrong passphrase, or the vault is damaged"] as string,
        ),
      )
      expect(chamadas).toEqual([])
      expect(disco.noDisco).toBe(true)
      expect(onDone).not.toHaveBeenCalled()
      expect(onStartOver).not.toHaveBeenCalled()
    })

    it('importar: um ficheiro bom pede o "apagar" DEPOIS da palavra-passe, e importa por cima numa escrita', async () => {
      const { bridge, chamadas } = ponteComDisco()
      const onDone = vi.fn()
      renderUnlock(bridge, onDone)
      await escolherFicheiro(FICHEIRO_BOM)
      await submeterFrase("frase do ficheiro")
      // The delete sheet only appears now, with the file and the text in hand.
      expect(chamadas).toEqual([])
      await confirmarApagar()

      await waitFor(() => expect(onDone).toHaveBeenCalledWith("@outra:orwell.pt"))
      // Without `destroy`: `importVault` writes the new vault on top, in one go.
      // There is no moment when the device has no account at all.
      expect(chamadas).toEqual(["vault.import", "vault.unlock"])
    })

    it('emparelhar: o link e a chave escolhem-se com a conta de cá; o "apagar" pergunta-se no Continuar e não apaga', async () => {
      const { bridge, chamadas } = ponteComDisco()
      renderUnlock(bridge, vi.fn())
      await ateAChave()
      expect(screen.getByText(strings.outraConta.pairKeyNote)).toBeTruthy()
      expect(chamadas).toEqual([])

      fireEvent.click(screen.getByRole("button", { name: strings.gate.next }))
      const pergunta = await screen.findByRole("alertdialog", { name: strings.settings.destroyTitle })
      expect(pergunta.textContent).toContain(strings.settings.destroyStepsPair)
      expect(chamadas).toEqual([])

      await confirmarApagar()
      // A temporary vault, then merge. Nothing was deleted: the account here stays
      // on disk until the new one enters.
      await waitFor(() => expect(chamadas).toEqual(["vault.createProvisional", `join ${LINK}`]))
    })

    /*
      The bug on line 1j: with `substituirConta`, the account here deleted itself on
      "delete", BEFORE the pairing. A pairing that failed next (here, the computer
      says the words are not the same) left the device with no account: "Back" went
      to the start, because the disk was empty.
    */
    it("emparelhar: um emparelhamento que falha a meio deixa a conta de cá, e o portão volta a abri-la", async () => {
      const { bridge, chamadas, disco, emitir } = ponteComDisco()
      const onStartOver = vi.fn()
      renderUnlock(bridge, vi.fn(), onStartOver)
      await ateAChave()
      fireEvent.click(screen.getByRole("button", { name: strings.gate.next }))
      await confirmarApagar()
      await waitFor(() => expect(chamadas).toContain(`join ${LINK}`))

      act(() => emitir({ fase: "ligado" }))
      act(() => emitir({ fase: "sas", palavras: "uma duas três quatro cinco seis" }))
      act(() => emitir({ fase: "falhou", razao: "palavras-diferentes" }))
      await screen.findByRole("heading", { name: strings.pairing.failedTitle })

      fireEvent.click(screen.getByRole("button", { name: strings.gate.back }))
      expect(await screen.findByRole("heading", { name: strings.gate.unlockTitle })).toBeTruthy()
      expect(onStartOver).not.toHaveBeenCalled()
      expect(chamadas).not.toContain("vault.destroy")
      expect(chamadas).toContain("provisório largado")
      expect(disco).toEqual({ noDisco: true, conta: "@cá:orwell.pt" })
    })

    it("emparelhar: um anfitrião sem cofre provisório não emparelha, e não apaga a conta de cá", async () => {
      const { bridge, chamadas, disco } = ponteComDisco()
      delete (bridge.vault as { createProvisional?: unknown }).createProvisional
      renderUnlock(bridge, vi.fn())
      await ateAChave()
      fireEvent.click(screen.getByRole("button", { name: strings.gate.next }))
      await confirmarApagar()
      await screen.findByRole("heading", { name: strings.pairing.failedTitle })
      expect(chamadas).toEqual([])
      expect(disco).toEqual({ noDisco: true, conta: "@cá:orwell.pt" })
    })

    it("emparelhar: a conta de cá só sai do disco no fim, com a conta nova carregada e ligada", async () => {
      const { bridge, chamadas, disco, emitir } = ponteComDisco()
      const onDone = vi.fn()
      renderUnlock(bridge, onDone)
      await ateAChave()
      fireEvent.click(screen.getByRole("button", { name: strings.gate.next }))
      await confirmarApagar()
      await waitFor(() => expect(chamadas).toContain(`join ${LINK}`))

      act(() => emitir({ fase: "certificado", address: "@outra:orwell.pt" }))
      fireEvent.click(await screen.findByRole("button", { name: strings.pairing.doneAction }))
      expect(onDone).toHaveBeenCalledWith("@outra:orwell.pt")
      expect(chamadas).toEqual(["vault.createProvisional", `join ${LINK}`, "provisório gravado", "done"])
      expect(disco).toEqual({ noDisco: true, conta: "@outra:orwell.pt" })
    })

    it('emparelhar: cancelar o "apagar" fica na chave, com a conta de cá e sem emparelhar', async () => {
      const { bridge, chamadas } = ponteComDisco()
      renderUnlock(bridge, vi.fn())
      await ateAChave()
      fireEvent.click(screen.getByRole("button", { name: strings.gate.next }))
      const pergunta = await screen.findByRole("alertdialog", { name: strings.settings.destroyTitle })
      fireEvent.click(within(pergunta).getByRole("button", { name: strings.confirmar.cancelar }))

      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
      expect(screen.getByRole("heading", { name: strings.pairing.keyTitle })).toBeTruthy()
      expect(chamadas).toEqual([])
    })

    it("emparelhar: voltar antes de apagar volta ao portão, e não ao princípio", async () => {
      const { bridge, chamadas } = ponteComDisco()
      const onStartOver = vi.fn()
      renderUnlock(bridge, vi.fn(), onStartOver)
      const folha = await abrirOutraConta()
      fireEvent.click(within(folha).getByRole("button", { name: strings.gate.otherAccountPair }))
      fireEvent.click(await screen.findByRole("button", { name: strings.gate.back }))

      expect(await screen.findByRole("heading", { name: strings.gate.unlockTitle })).toBeTruthy()
      expect(onStartOver).not.toHaveBeenCalled()
      expect(chamadas).toEqual([])
    })

  })

  it('o rodapé já não tem "Como funciona" (dono, 28 de Outubro de 2026)', async () => {
    renderUnlock(bridgeQuePedeFrase(), vi.fn())
    expect(await screen.findByRole("heading", { name: strings.gate.unlockTitle })).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.comoFunciona.link })).toBeNull()
  })
})
