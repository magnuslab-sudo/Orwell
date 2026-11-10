import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { en } from "../../linguas/en.js"
import { strings } from "../../strings.js"
import { ToastProvider } from "../../components/Toast.js"
import { Emparelhar } from "./Emparelhar.js"
import { Setup } from "./Setup.js"
import { identidadeParaOGestor } from "./CampoDeIdentidade.js"
import { Unlock } from "./Unlock.js"

afterEach(cleanup)

/**
 * Face ID, and the attributes it depends on.
 *
 * The decision was: **unlock by face is delivered through the SYSTEM vault**, iOS
 * Keychain, Android Password Manager, which is what `THREAT-MODEL.md` already names
 * as the legitimate place for the password. On an iPhone, filling from Keychain goes
 * through the face: it's literally the requested feature, delivered without inventing
 * our own crypto and without storing any key anywhere.
 *
 * What that needs is little and fragile: a real `<form>`, a password marked as
 * CURRENT, and an identity field that names the entry. Until now the app asked the
 * manager to STORE (`Setup`, `Pair`, with `new-password`) and NEVER asked it to fill.
 *
 * **That's why these tests exist.** They're four attributes with no visible effect:
 * no one notices them missing, no other test touches them, and careless refactoring
 * takes them away without a trace. The symptom, months later, is "Face ID stopped
 * showing", with nothing to connect it to.
 */
function ponteQuePedeFrase(): EnclaveBridge {
  return {
    vault: {
      unlock: async (secret: string | null) =>
        secret === null ? Promise.reject(new Error("this vault needs a passphrase")) : { ok: true },
      destroy: async () => ({ ok: true }),
      status: async () => ({ exists: true, supportsOsProtection: false }),
    },
    identity: { load: async () => ({ address: "@abc:orwell.pt", accountId: "abc" }) },
    session: { connect: async () => ({ ok: true }) },
  } as unknown as EnclaveBridge
}

/** The host for someone without an account yet: it's the path of `Setup`. */
function ponteQueCriaConta(): EnclaveBridge {
  return {
    vault: {
      status: async () => ({ exists: false, supportsOsProtection: false }),
      create: async () => ({ ok: true }),
    },
    identity: { create: async () => ({ address: "@abc:localhost:8448", accountId: "abc" }) },
    session: { connect: async () => ({ ok: true }) },
    profile: { set: async () => ({ ok: true }) },
  } as unknown as EnclaveBridge
}

async function abrirOPortao(): Promise<void> {
  render(
    <BridgeContext.Provider value={ponteQuePedeFrase()}>
      <Unlock onDone={vi.fn()} onStartOver={vi.fn()} />
    </BridgeContext.Provider>,
  )
  await waitFor(() => expect(document.querySelector('input[type="password"]')).not.toBeNull())
}

/** The password field on this screen. */
function campoDaFrase(): HTMLInputElement {
  return document.querySelector('input[type="password"]') as HTMLInputElement
}

/** The hidden field that names the entry in the manager. */
function campoDeIdentidade(): HTMLInputElement | null {
  return document.querySelector('input[autocomplete="username"]')
}

describe("desbloquear: o gestor do sistema é convidado a preencher", () => {
  it("o cartão é um formulário a sério, e não uma caixa solta", async () => {
    await abrirOPortao()
    // Without a `<form>` no manager offers to fill: that's the signal it looks for.
    expect(campoDaFrase().closest("form")).not.toBeNull()
  })

  it("a palavra-passe está marcada como a ACTUAL, que é o que pede para preencher", async () => {
    await abrirOPortao()
    const campo = campoDaFrase()
    expect(campo.getAttribute("autocomplete")).toBe("current-password")
    expect(campo.getAttribute("name")).toBe("password")
  })

  it("há um campo de identidade, fora do alcance do rato, do teclado e de quem ouve", async () => {
    await abrirOPortao()
    const identidade = campoDeIdentidade()
    expect(identidade).not.toBeNull()
    expect(identidade?.value).toBe(identidadeParaOGestor())
    expect(identidade?.readOnly).toBe(true)
    expect(identidade?.tabIndex).toBe(-1)
    expect(identidade?.getAttribute("aria-hidden")).toBe("true")
    // `sr-only` and not `display: none`: a field removed from layout is a field
    // the manager doesn't see.
    expect(identidade?.className).toBe("sr-only")
  })

  it("submeter o formulário tenta abrir o cofre: é o que o Enter do teclado do telemóvel faz", async () => {
    const aoEntrar = vi.fn()
    render(
      <BridgeContext.Provider value={ponteQuePedeFrase()}>
        <Unlock onDone={aoEntrar} onStartOver={vi.fn()} />
      </BridgeContext.Provider>,
    )
    await waitFor(() => expect(document.querySelector('input[type="password"]')).not.toBeNull())

    const formulario = campoDaFrase().closest("form") as HTMLFormElement
    const botao = screen.getByRole("button", { name: strings.gate.open })
    // A submit button INSIDE the form: that's what makes the mobile keyboard's "go"
    // open the vault, instead of doing nothing.
    expect(botao.getAttribute("type")).toBe("submit")
    expect(formulario.contains(botao)).toBe(true)

    fireEvent.change(campoDaFrase(), { target: { value: "a frase certa" } })
    fireEvent.submit(formulario)
    await waitFor(() => expect(aoEntrar).toHaveBeenCalledWith("@abc:orwell.pt"))
  })
})

/**
 * Where the password is STORED, the name has to be the same.
 *
 * Storing and filling are two halves of one entry in the manager. If `Setup`
 * or `Pair` stores under one name and `Unlock` asks for another, the manager
 * creates a new entry instead of recognizing the one it has, and from the user's
 * view, Face ID just doesn't appear, with nothing to explain it.
 *
 * These tests query the DOM of both screens, not the function that gives them the
 * value: an assertion on `identidadeParaOGestor()` alone would stay green with
 * `<CampoDeIdentidade />` removed from the screen, which is exactly the bug.
 */
describe("e onde se GUARDA a frase, o nome é o mesmo", () => {
  it("emparelhar um aparelho novo põe o campo de identidade no ecrã da frase-passe", async () => {
    render(
      <BridgeContext.Provider value={ponteQuePedeFrase()}>
        {/* `linkInicial` goes straight to the key step, which is what asks for the password. */}
        <Emparelhar linkInicial="enclave://pair/x" onDone={vi.fn()} onBack={vi.fn()} />
      </BridgeContext.Provider>,
    )
    await waitFor(() => expect(screen.getByRole("heading", { name: strings.pairing.keyTitle })).toBeTruthy())

    const identidade = campoDeIdentidade()
    expect(identidade, "o Emparelhar perdeu o campo de identidade").not.toBeNull()
    expect(identidade?.value).toBe(identidadeParaOGestor())
    // And the password here is NEW: it asks to store, not to fill.
    expect(campoDaFrase().getAttribute("autocomplete")).toBe("new-password")
  })

  it("e criar conta de raiz também, no passo em que a frase-passe se escolhe", async () => {
    const pessoa = userEvent.setup()
    render(
      <ToastProvider>
        <BridgeContext.Provider value={ponteQueCriaConta()}>
          <Setup onDone={vi.fn()} onUnlockInstead={vi.fn()} />
        </BridgeContext.Provider>
      </ToastProvider>,
    )
    await waitFor(() => expect(screen.getByPlaceholderText(strings.gate.namePlaceholder)).toBeTruthy())
    await pessoa.type(screen.getByPlaceholderText(strings.gate.namePlaceholder), "Duarte{Enter}")
    await pessoa.keyboard("{Enter}") // the photo (27 October 2026): skipped
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(strings.gate.askPass))

    const identidade = campoDeIdentidade()
    expect(identidade, "o Setup perdeu o campo de identidade").not.toBeNull()
    expect(identidade?.value).toBe(identidadeParaOGestor())
    expect(campoDaFrase().getAttribute("autocomplete")).toBe("new-password")
  })

  it("os três ecrãs dão o MESMO nome: é isso que faz o gestor reconhecer a entrada", async () => {
    await abrirOPortao()
    const noPortao = campoDeIdentidade()?.value
    cleanup()

    render(
      <BridgeContext.Provider value={ponteQuePedeFrase()}>
        <Emparelhar linkInicial="enclave://pair/x" onDone={vi.fn()} onBack={vi.fn()} />
      </BridgeContext.Provider>,
    )
    await waitFor(() => expect(screen.getByRole("heading", { name: strings.pairing.keyTitle })).toBeTruthy())

    expect(campoDeIdentidade()?.value).toBe(noPortao)
    expect(noPortao).toBeTruthy()
  })

  it("a identidade é estável e nunca é o endereço da conta, que vive dentro do cofre", () => {
    expect(identidadeParaOGestor()).toBe(identidadeParaOGestor())
    expect(identidadeParaOGestor()).not.toMatch(/^@/)
  })
})

/**
 * What the screen says while the key derives.
 *
 * Derivation takes one to seven seconds on a phone. While it ran on the main
 * thread there was nothing to show, the screen froze. Now there's a free thread
 * to say it, and this is what ensures it says it FOR REAL, not just that the
 * password exists in the catalog.
 */
describe("o que o ecrã diz enquanto a chave se deriva", () => {
  it("o portão anuncia o trabalho em curso enquanto o cofre não abre", async () => {
    // An unlock that never resolves: it's the "opening..." state, frozen so you
    // can look at it.
    const ponte = {
      vault: {
        unlock: async (secret: string | null) =>
          secret === null
            ? Promise.reject(new Error("this vault needs a passphrase"))
            : new Promise<{ ok: boolean }>(() => {}),
        destroy: async () => ({ ok: true }),
      },
      identity: { load: async () => ({ address: "@abc:orwell.pt", accountId: "abc" }) },
      session: { connect: async () => ({ ok: true }) },
    } as unknown as EnclaveBridge

    render(
      <BridgeContext.Provider value={ponte}>
        <Unlock onDone={vi.fn()} onStartOver={vi.fn()} />
      </BridgeContext.Provider>,
    )
    await waitFor(() => expect(document.querySelector('input[type="password"]')).not.toBeNull())
    expect(screen.queryByText(strings.gate.openingNote)).toBeNull()

    fireEvent.change(campoDaFrase(), { target: { value: "a frase certa" } })
    fireEvent.submit(campoDaFrase().closest("form") as HTMLFormElement)

    const nota = await screen.findByText(strings.gate.openingNote)
    expect(nota.getAttribute("role")).toBe("status")
    expect(screen.getByRole("button", { name: strings.gate.opening })).toBeTruthy()
  })

  it("a nota existe nas duas línguas e não tem travessões", () => {
    expect(strings.gate.openingNote).toBeTruthy()
    expect(en.gate?.openingNote).toBeTruthy()
    expect(strings.gate.openingNote).not.toMatch(/[—–]/)
  })
})

/**
 * A beta vault in the gate (1.0 "Arca", phase 2).
 *
 * The screen "Orwell left beta" is in phase 5b, which reads `versao` in
 * `vault.status()` and never mounts `Unlock`. This holds the bottom, which is worth
 * today: even if a beta vault reaches `Unlock`, the real core vault rejects it by
 * header. The silent attempt never reaches the keychain, the written password never
 * reaches Argon2id, and the screen says "it's from beta", never "wrong password".
 */
describe("um cofre do beta nunca chega à decifra", () => {
  it("a ponte diz versao beta; o Unlock mostra o erro do beta e a derivação não corre", async () => {
    const { Vault } = await import("@enclave/client-core")
    let bytes: Uint8Array | null = new TextEncoder().encode(
      JSON.stringify({ version: 2, protection: "passphrase", salt: "c2Fs", nonce: "bm9uY2U", ciphertext: "Y2lmcmFkbw" }),
    )
    const disco = {
      supportsOsProtection: true,
      read: async () => bytes,
      write: async (novos: Uint8Array) => {
        bytes = novos
      },
      clear: async () => {
        bytes = null
      },
      unwrapKey: vi.fn(async (embrulhada: Uint8Array) => embrulhada),
    }
    const derivar = vi.fn(async () => new Uint8Array(32))
    const vault = new Vault(disco, derivar)
    const ponte = {
      vault: {
        status: () => vault.estado(),
        unlock: async (frase: string | null) => {
          await vault.unlock(frase ?? undefined)
          return { ok: true }
        },
        destroy: async () => {
          await vault.destroy()
          return { ok: true }
        },
      },
      identity: { load: async () => ({ address: "@abc:orwell.pt", accountId: "abc" }) },
      session: { connect: async () => ({ ok: true }) },
    } as unknown as EnclaveBridge

    expect(await ponte.vault.status()).toEqual({ exists: true, supportsOsProtection: true, versao: "beta" })

    render(
      <BridgeContext.Provider value={ponte}>
        <Unlock onDone={vi.fn()} onStartOver={vi.fn()} />
      </BridgeContext.Provider>,
    )
    await waitFor(() => expect(document.querySelector('input[type="password"]')).not.toBeNull())
    fireEvent.change(campoDaFrase(), { target: { value: "a frase do beta" } })
    fireEvent.submit(campoDaFrase().closest("form") as HTMLFormElement)

    expect(await screen.findByText("Este cofre é de uma versão do beta. Não abre nesta versão.")).toBeTruthy()
    expect(screen.queryByText(/Palavra-passe errada/)).toBeNull()
    expect(derivar).not.toHaveBeenCalled()
    expect(disco.unwrapKey).not.toHaveBeenCalled()

    // And deleting it ("Create new account", in 5b) doesn't read it either.
    await ponte.vault.destroy()
    expect(bytes).toBeNull()
    expect(derivar).not.toHaveBeenCalled()
  })
})
