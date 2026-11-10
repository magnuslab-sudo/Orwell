import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ACCENTS, PREFS_KEY, readPrefs } from "../../hooks/usePrefs.js"
import { strings } from "../../strings.js"
import { ToastProvider } from "../../components/Toast.js"
import type { CompressedImage } from "../../lib/images.js"
import { Setup } from "./Setup.js"

/*
  The compressor is fake, as in `ProfileEditor.gif.test.tsx`: jsdom does not
  decode images. Here we test the path from the photo page to the initial
  profile, not the compression itself (that's in `lib/images.test.ts`).
*/
const comprimida: { atual: CompressedImage } = {
  atual: { dataUrl: "data:image/webp;base64,CARA", bytes: 4, width: 256, height: 256, recoded: true },
}

vi.mock("../../lib/images.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/images.js")>()
  return { ...original, compressImage: vi.fn(async () => comprimida.atual) }
})

/** The profiles that Setup saved in the "profile" step, in order. */
const perfisGuardados: unknown[] = []

afterEach(() => {
  cleanup()
  perfisGuardados.length = 0
})

/**
 * What the signup screen touches, and nothing more.
 *
 * `supportsOsProtection: false` is the browser, where all four steps live:
 * a host that stores the key in the system has no password to request or confirm,
 * and that's the case for Electron.
 */
function bridgeDeTeste(): EnclaveBridge {
  return {
    vault: {
      status: async () => ({ exists: false, supportsOsProtection: false }),
      create: async () => ({ ok: true }),
    },
    identity: { create: async () => ({ address: "@abc:localhost:8448", accountId: "abc" }) },
    session: { connect: async () => ({ ok: true }) },
    profile: {
      set: async (perfil: unknown) => {
        perfisGuardados.push(perfil)
        return { ok: true }
      },
    },
  } as unknown as EnclaveBridge
}

/**
 * Without `onJoinInstead` Setup has nowhere to pair and opens straight to
 * creation: this is how most tests here work, which are about account questions.
 * The ones for the first question (phase 8.1) pass it.
 */
function montar(onDone: (address: string) => void = vi.fn(), onJoinInstead?: () => void): void {
  render(
    <ToastProvider>
      <BridgeContext.Provider value={bridgeDeTeste()}>
        <Setup onDone={onDone} onUnlockInstead={vi.fn()} {...(onJoinInstead ? { onJoinInstead } : {})} />
      </BridgeContext.Provider>
    </ToastProvider>,
  )
}

const campoNome = (): HTMLElement => screen.getByPlaceholderText(strings.gate.namePlaceholder)
const pergunta = (): string => screen.getByRole("heading", { level: 1 }).textContent ?? ""

beforeEach(() => {
  localStorage.clear()
  document.documentElement.style.removeProperty("--accent")
})

describe('Setup: primeiro, "Já usas o Orwell noutro aparelho?" (fase 8.1)', () => {
  it("o primeiro ecrã é a pergunta, com os dois botões e nenhum campo", async () => {
    montar(vi.fn(), vi.fn())
    await waitFor(() => expect(pergunta()).toBe(strings.gate.outroAparelhoPergunta))
    const sim = screen.getByRole("button", { name: strings.gate.outroAparelhoSim })
    const nao = screen.getByRole("button", { name: strings.gate.outroAparelhoNao })
    // Two identical buttons: same appearance, neither is primary.
    expect(sim.className).toBe(nao.className)
    expect(screen.queryByPlaceholderText(strings.gate.namePlaceholder)).toBeNull()
    expect(screen.getByText(strings.gate.outroAparelhoLead)).toBeTruthy()
  })

  it('"Sim, emparelhar este aparelho" vai para o Emparelhar', async () => {
    const pessoa = userEvent.setup()
    const onJoinInstead = vi.fn()
    montar(vi.fn(), onJoinInstead)
    await pessoa.click(await screen.findByRole("button", { name: strings.gate.outroAparelhoSim }))
    expect(onJoinInstead).toHaveBeenCalledOnce()
  })

  it('"Não, criar conta" segue o Setup de hoje, e "Voltar" regressa à pergunta', async () => {
    const pessoa = userEvent.setup()
    const onJoinInstead = vi.fn()
    montar(vi.fn(), onJoinInstead)
    await pessoa.click(await screen.findByRole("button", { name: strings.gate.outroAparelhoNao }))
    expect(pergunta()).toBe(strings.gate.askName)
    // The "Pair" button below the name is gone: the question is the path.
    expect(screen.queryByRole("button", { name: strings.gate.joinAction })).toBeNull()

    await pessoa.click(screen.getByRole("button", { name: strings.gate.back }))
    expect(pergunta()).toBe(strings.gate.outroAparelhoPergunta)
    expect(onJoinInstead).not.toHaveBeenCalled()
  })

  it('sem caminho para emparelhar, abre direito no nome e sem "Voltar"', async () => {
    montar()
    await waitFor(() => expect(pergunta()).toBe(strings.gate.askName))
    expect(screen.queryByRole("button", { name: strings.gate.back })).toBeNull()
  })
})

describe("Setup — uma pergunta de cada vez", () => {
  it("a primeira página pergunta o nome, e mais nada", async () => {
    montar()
    await waitFor(() => expect(pergunta()).toBe(strings.gate.askName))

    // What WAS here and is gone: the server, both passwords and the checkbox,
    // all at once. None of them is a question you ask first.
    expect(screen.queryByLabelText(strings.gate.server)).toBeNull()
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0)
  })

  it("o servidor continua a existir, atrás das opções avançadas", async () => {
    const pessoa = userEvent.setup()
    montar()
    await waitFor(() => expect(campoNome()).toBeTruthy())

    await pessoa.click(screen.getByRole("button", { name: strings.gate.advanced }))
    const servidor = screen.getByLabelText(strings.gate.server)
    expect((servidor as HTMLInputElement).value).toContain(":")
  })

  it("o Enter avança do nome para a fotografia, e daí para a palavra-passe: a cor já não se pergunta aqui", async () => {
    const pessoa = userEvent.setup()
    montar()
    await waitFor(() => expect(campoNome()).toBeTruthy())

    await pessoa.type(campoNome(), "Duarte{Enter}")
    expect(pergunta()).toBe(strings.gate.askPhoto)
    await pessoa.keyboard("{Enter}")
    expect(pergunta()).toBe(strings.gate.askPass)
    // Four pages in the browser: name, photo, password, confirmation.
    expect(document.querySelectorAll(".setup-dots li")).toHaveLength(4)
  })

  it("a página da palavra-passe diz, antes de a pessoa a escolher, que não há recuperação", async () => {
    const pessoa = userEvent.setup()
    montar()
    await waitFor(() => expect(campoNome()).toBeTruthy())
    await pessoa.type(campoNome(), "Duarte{Enter}")
    await pessoa.keyboard("{Enter}") // the photo: we skip it

    expect(pergunta()).toBe(strings.gate.askPass)
    expect(screen.getByText(strings.gate.passphraseNote)).toBeTruthy()
  })

  it("uma palavra-passe curta não passa, e diz porquê", async () => {
    const pessoa = userEvent.setup()
    montar()
    await waitFor(() => expect(campoNome()).toBeTruthy())
    await pessoa.type(campoNome(), "Duarte{Enter}")
    await pessoa.keyboard("{Enter}") // the photo: we skip it

    await pessoa.keyboard("curta{Enter}")
    expect(pergunta()).toBe(strings.gate.askPass)
    expect(screen.getByText(strings.gate.passphraseShort)).toBeTruthy()
  })

  it("uma confirmação que não bate certo não cria conta nenhuma", async () => {
    const pessoa = userEvent.setup()
    const onDone = vi.fn()
    montar(onDone)
    await waitFor(() => expect(campoNome()).toBeTruthy())
    await pessoa.type(campoNome(), "Duarte{Enter}")
    await pessoa.keyboard("{Enter}") // the photo: we skip it
    await pessoa.keyboard("frase-comprida-o-suficiente{Enter}")

    expect(pergunta()).toBe(strings.gate.askConfirm)
    await pessoa.keyboard("outra-coisa-qualquer{Enter}")

    expect(screen.getByText(strings.gate.passphraseMismatch)).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
  })

  it("as três respostas certas criam a conta", async () => {
    const pessoa = userEvent.setup()
    const onDone = vi.fn()
    montar(onDone)
    await waitFor(() => expect(campoNome()).toBeTruthy())
    await pessoa.type(campoNome(), "Duarte{Enter}")
    await pessoa.keyboard("{Enter}") // the photo: we skip it
    await pessoa.keyboard("frase-comprida-o-suficiente{Enter}")
    await pessoa.keyboard("frase-comprida-o-suficiente{Enter}")

    await waitFor(() => expect(onDone).toHaveBeenCalledWith("@abc:localhost:8448"))
  })
})

describe("Setup: a frase da conta, uma vez", () => {
  it('aparece na última página, antes de "Criar conta", e não nas outras', async () => {
    const pessoa = userEvent.setup()
    montar()
    await waitFor(() => expect(campoNome()).toBeTruthy())
    expect(screen.queryByText(strings.frasesDoMomento.conta)).toBeNull()
    await pessoa.type(campoNome(), "Duarte{Enter}")
    await pessoa.keyboard("{Enter}") // the photo: we skip it
    expect(screen.queryByText(strings.frasesDoMomento.conta)).toBeNull()
    await pessoa.keyboard("frase-comprida-o-suficiente{Enter}")

    expect(pergunta()).toBe(strings.gate.askConfirm)
    expect(screen.getByText(strings.frasesDoMomento.conta)).toBeTruthy()
    await pessoa.click(screen.getByRole("button", { name: strings.frasesDoMomento.entendi }))
    expect(screen.queryByText(strings.frasesDoMomento.conta)).toBeNull()
    expect(readPrefs().frasesVistas).toContain("conta")
  })
})

describe('Setup: "Como funciona" no rodapé', () => {
  it("abre a mesma página das definições numa folha, antes de haver conta", async () => {
    const pessoa = userEvent.setup()
    montar()
    await waitFor(() => expect(campoNome()).toBeTruthy())
    const link = screen.getByRole("button", { name: strings.comoFunciona.link })
    expect(link.closest(".gate-rodape")).toBeTruthy()
    await pessoa.click(link)
    const folha = screen.getByRole("dialog", { name: strings.comoFunciona.titulo })
    expect(folha.querySelectorAll(".como-funciona-cartao")).toHaveLength(6)
  })
})

describe("Setup — sem a pergunta da cor", () => {
  it("criar a conta não escreve cor nenhuma: fica a de fábrica, e escolhe-se nas Configurações", async () => {
    const pessoa = userEvent.setup()
    const onDone = vi.fn()
    montar(onDone)
    await waitFor(() => expect(campoNome()).toBeTruthy())
    await pessoa.type(campoNome(), "Duarte{Enter}")
    await pessoa.keyboard("{Enter}") // the photo: we skip it
    await pessoa.keyboard("frase-comprida-o-suficiente{Enter}")
    await pessoa.keyboard("frase-comprida-o-suficiente{Enter}")
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(localStorage.getItem(PREFS_KEY)).toBeNull()
    expect(readPrefs().accent).toBe(4)
    expect(ACCENTS[readPrefs().accent]).toBeTruthy()
  })

  it("não se chama teste nem quiz a isto em lado nenhum", () => {
    // The entire app, not just this screen: the product argument is not needing
    // to know who the person is, and opening with a test, even if fake, said
    // the opposite out loud.
    const tudo = JSON.stringify(strings).toLowerCase()
    expect(tudo).not.toMatch(/\bquiz\b/)
    expect(tudo).not.toMatch(/teste de personalidade/)
    expect(tudo).not.toMatch(/\bpersonalidade\b/)
  })
})

describe('Setup: "Queres pôr uma fotografia?", a seguir ao nome', () => {
  async function irParaAFotografia(pessoa: ReturnType<typeof userEvent.setup>): Promise<void> {
    await waitFor(() => expect(campoNome()).toBeTruthy())
    await pessoa.type(campoNome(), "Duarte{Enter}")
    expect(pergunta()).toBe(strings.gate.askPhoto)
  }

  function escolher(): void {
    const entrada = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!entrada) throw new Error("sem campo de ficheiro")
    const ficheiro = new File([new Uint8Array(400_000)], "cara.gif", { type: "image/gif" })
    fireEvent.change(entrada, { target: { files: [ficheiro] } })
  }

  it('mostra a inicial, "Escolher fotografia" e "Saltar" com o mesmo peso', async () => {
    const pessoa = userEvent.setup()
    montar()
    await irParaAFotografia(pessoa)

    expect(screen.getByText(strings.gate.askPhotoLead)).toBeTruthy()
    expect(document.querySelector(".avatar-preview")?.textContent).toBe("D")
    const escolherFoto = screen.getByText(strings.gate.choosePhoto)
    const saltar = screen.getByRole("button", { name: strings.gate.skipPhoto })
    // Same appearance: both are primary, neither is a hidden link.
    expect(escolherFoto.classList.contains("primary")).toBe(true)
    expect(saltar.classList.contains("primary")).toBe(true)
    expect(screen.queryByRole("button", { name: strings.gate.next })).toBeNull()
  })

  it('"Saltar" segue para a palavra-passe, e o perfil inicial vai sem fotografia', async () => {
    const pessoa = userEvent.setup()
    const onDone = vi.fn()
    montar(onDone)
    await irParaAFotografia(pessoa)

    await pessoa.click(screen.getByRole("button", { name: strings.gate.skipPhoto }))
    expect(pergunta()).toBe(strings.gate.askPass)
    await pessoa.keyboard("frase-comprida-o-suficiente{Enter}")
    await pessoa.keyboard("frase-comprida-o-suficiente{Enter}")

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(perfisGuardados).toEqual([{ displayName: "Duarte", donations: [] }])
  })

  it('com fotografia escolhida, o botão diz "Continuar" e o perfil inicial leva-a', async () => {
    const pessoa = userEvent.setup()
    const onDone = vi.fn()
    comprimida.atual = { dataUrl: "data:image/webp;base64,CARA", bytes: 4, width: 256, height: 256, recoded: true }
    montar(onDone)
    await irParaAFotografia(pessoa)

    escolher()
    await waitFor(() => expect(document.querySelector(".avatar-preview img")?.getAttribute("src")).toBe("data:image/webp;base64,CARA"))
    expect(screen.queryByRole("button", { name: strings.gate.skipPhoto })).toBeNull()
    await pessoa.click(screen.getByRole("button", { name: strings.gate.next }))
    expect(pergunta()).toBe(strings.gate.askPass)
    await pessoa.keyboard("frase-comprida-o-suficiente{Enter}")
    await pessoa.keyboard("frase-comprida-o-suficiente{Enter}")

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(perfisGuardados).toEqual([
      { displayName: "Duarte", donations: [], avatarDataUrl: "data:image/webp;base64,CARA" },
    ])
  })

  it('um GIF que ficou parado diz-se, e "Remover" volta à inicial e a "Saltar"', async () => {
    const pessoa = userEvent.setup()
    comprimida.atual = {
      dataUrl: "data:image/webp;base64,PARADO",
      bytes: 6,
      width: 256,
      height: 256,
      recoded: true,
      animacaoPerdida: true,
    }
    montar()
    await irParaAFotografia(pessoa)

    escolher()
    expect(await screen.findByText(/Ficou parado/)).toBeTruthy()
    await pessoa.click(screen.getByRole("button", { name: strings.gate.removePhoto }))
    expect(screen.queryByText(/Ficou parado/)).toBeNull()
    expect(document.querySelector(".avatar-preview img")).toBeNull()
    expect(screen.getByRole("button", { name: strings.gate.skipPhoto })).toBeTruthy()
  })
})
