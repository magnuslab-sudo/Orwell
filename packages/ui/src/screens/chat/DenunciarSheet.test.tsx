import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { AlvoDaDenuncia, DenunciaPreparada, ItemPreparado } from "@enclave/client-core"
import type { ItemRelatado } from "@enclave/protocol"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { VERSAO_DA_APP } from "../../lib/versao.js"
import { DenunciarSheet } from "./DenunciarSheet.js"

afterEach(cleanup)

const ANA = "@ana:orwell.pt"
const BRUNO = "@bruno:orwell.pt"
const NOMES: Record<string, string> = { [ANA]: "Ana", [BRUNO]: "Bruno" }
const nomeDe = (endereco: string): string => NOMES[endereco] ?? endereco

const ALVO: AlvoDaDenuncia = { canal: "!sala:orwell.pt", pessoa: BRUNO, mensagem: { id: "m-2" } }

const item = (over: Partial<ItemPreparado>): ItemPreparado => ({
  item: {} as ItemRelatado,
  autor: ANA,
  dia: "2026-11-02",
  hora: "09:58",
  texto: "",
  anexos: [],
  denunciada: false,
  ...over,
})

function preparada(temCopia: boolean, sala?: string): DenunciaPreparada {
  const itens = [
    item({ autor: ANA, hora: "09:58", texto: "bom dia" }),
    item({
      autor: BRUNO,
      hora: "10:01",
      // The signed original: the prepared one already has it, and the sheet shows it as is.
      texto: "a ofensa original",
      anexos: [{ name: "foto.jpg", mediaType: "image/jpeg", byteLength: 2048 }],
      denunciada: true,
    }),
    item({ autor: BRUNO, hora: "10:03", texto: "mais uma" }),
  ]
  return {
    canal: ALVO.canal,
    ...(sala !== undefined ? { sala } : {}),
    denunciado: BRUNO,
    alvo: { tipo: "mensagem", id: "m-2" },
    itens,
    itensDoFundador: itens.filter((i) => i.autor !== ANA),
    denunciada: 1,
    temCopia,
  }
}

function montar(
  opcoes: { temCopia?: boolean; sala?: string; enviar?: () => Promise<{ ok: true }>; semNomeDe?: boolean; alvo?: AlvoDaDenuncia } = {},
) {
  const lista = preparada(opcoes.temCopia ?? true, opcoes.sala)
  const denuncias = {
    preparar: vi.fn(async () => lista),
    enviar: vi.fn(opcoes.enviar ?? (async () => ({ ok: true as const }))),
    lista: vi.fn(async () => []),
  }
  const bridge = { denuncias } as unknown as EnclaveBridge
  const fechar = vi.fn()
  const vista = render(
    <BridgeContext.Provider value={bridge}>
      <DenunciarSheet
        alvo={opcoes.alvo ?? ALVO}
        nomeDoAlvo="Bruno"
        {...(opcoes.semNomeDe ? {} : { nomeDe })}
        nomeDoCanal="geral"
        nomeDaSala={(sala) => (sala === "r-avisos" ? "avisos" : sala)}
        onClose={fechar}
      />
    </BridgeContext.Provider>,
  )
  return { denuncias, fechar, lista, vista }
}

const AVISO = "O fundador do canal recebe uma cópia sem o teu nome. Numa conversa pequena, pode adivinhar quem foste."

// Since 4/11/2026 the note, good faith and contact appear in the reason step,
// below the reasons (design chosen by the owner). Choosing the reason no longer
// changes the step: "Continue" is what validates and advances.
function escolherMotivo(texto: string): void {
  fireEvent.click(screen.getByLabelText(texto))
}

function continuar(): void {
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
}

function preencherDetalhes(): void {
  fireEvent.change(screen.getByLabelText(/Nota/), { target: { value: "Insulta toda a gente." } })
  fireEvent.click(screen.getByLabelText("Confirmo que acredito, de boa-fé, que esta denúncia é exacta e completa."))
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana Silva" } })
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ana@exemplo.pt" } })
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
}

describe("DenunciarSheet", () => {
  it("mostra os 8 motivos pela ordem e com o texto exacto", () => {
    montar()
    const motivos = screen.getAllByRole("radio").map((radio) => radio.closest("label")?.textContent)
    expect(motivos).toEqual([
      "Abuso sexual de menores",
      "Ameaças ou incitamento à violência",
      "Assédio ou perseguição",
      "Imagens íntimas sem consentimento",
      "Burla, phishing ou spam",
      "Discurso de ódio",
      "Outro conteúdo ilegal",
      "Outro (nota obrigatória)",
    ])
  })

  it("os detalhes pedem a nota no motivo 8 e a boa-fé, com a nota do contacto", () => {
    montar()
    // Before choosing, no details.
    expect(screen.queryByLabelText(/Nota/)).toBeNull()
    escolherMotivo("Outro (nota obrigatória)")
    expect(screen.getByText("Opcional. Só nós lemos o nome e o email.")).toBeTruthy()
    continuar()
    expect(screen.getByRole("alert").textContent).toContain("Erro 361")
    fireEvent.change(screen.getByLabelText(/Nota/), { target: { value: "Vende contas." } })
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    expect(screen.getByRole("alert").textContent).toContain("Erro 362")
  })

  it("o passo do motivo mostra a mensagem denunciada no topo, com a pílula", async () => {
    montar()
    const alvo = await screen.findByTestId("denunciar-alvo")
    await vi.waitFor(() => expect(alvo.textContent).toContain("a ofensa original"))
    expect(alvo.textContent).toContain("Bruno")
    expect(alvo.textContent).toContain("10:01 UTC")
    expect(alvo.textContent).toContain("Denunciada")
  })

  it("o indicador tem três passos, e o de agora leva aria-current", async () => {
    montar({ temCopia: true })
    const passos = (): HTMLElement[] => screen.getAllByRole("listitem").filter((li) => li.classList.contains("denunciar-passo"))
    expect(passos().map((li) => li.querySelector(".denunciar-passo-nome")?.textContent)).toEqual(["Motivo", "Rever", "Enviar"])
    expect(passos().map((li) => li.getAttribute("aria-current"))).toEqual(["step", null, null])
    escolherMotivo("Assédio ou perseguição")
    preencherDetalhes()
    await screen.findByText("O que sai do aparelho")
    expect(passos().map((li) => li.getAttribute("aria-current"))).toEqual([null, "step", null])
    expect(passos()[0]!.textContent).toContain("feito")
    continuar()
    expect(passos().map((li) => li.getAttribute("aria-current"))).toEqual([null, null, "step"])
    // Focus moves to the title of the new step.
    expect(document.activeElement?.textContent).toBe("Antes de enviar")
  })

  it("a pré-visualização mostra autor, dia, hora, texto e os anexos só por nome e tipo", async () => {
    const { denuncias, vista } = montar({ sala: "r-avisos" })
    escolherMotivo("Assédio ou perseguição")
    preencherDetalhes()
    expect(await screen.findByText("O que sai do aparelho")).toBeTruthy()
    expect(denuncias.preparar).toHaveBeenCalledWith(ALVO)
    expect(screen.getByText(/geral/)).toBeTruthy()

    const linhas = screen.getAllByTestId("denunciar-item")
    expect(linhas).toHaveLength(3)
    expect(linhas[1]!.textContent).toContain("Bruno")
    expect(linhas[1]!.textContent).toContain("2026-11-02")
    expect(linhas[1]!.textContent).toContain("10:01 UTC")
    expect(linhas[1]!.textContent).toContain("a ofensa original")
    expect(linhas[1]!.textContent).toContain("Mensagem denunciada")
    expect(linhas[0]!.textContent).toContain("Ana")
    expect(linhas[0]!.textContent).toContain("bom dia")
    expect(linhas[1]!.textContent).toContain("foto.jpg")
    expect(linhas[1]!.textContent).toContain("image/jpeg")
    // Day and time separate from the name and badge, never glued together ("UTCMensagem").
    expect(linhas[1]!.querySelector(".denunciar-quando")?.textContent).toBe("2026-11-02·10:01 UTC")
    // The room and the person: they also leave the device.
    expect(screen.getByTestId("denunciar-sala").textContent).toBe("Sala: avisos")
    expect(screen.getByTestId("denunciar-pessoa").textContent).toBe("Pessoa denunciada: Bruno")
    // Long addresses came out of the lines (they broke them, 4/11/2026) into the
    // "Show addresses" detail. They stay there, because they go in the request:
    // the reported person first, then each author once.
    expect(linhas[1]!.textContent).not.toContain(BRUNO)
    const enderecos = screen.getByTestId("denunciar-enderecos")
    expect(enderecos.querySelector("summary")?.textContent).toBe("Mostrar endereços")
    expect([...enderecos.querySelectorAll("dd")].map((dd) => dd.textContent)).toEqual([BRUNO, ANA])
    expect([...enderecos.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["Bruno", "Ana"])
    // The rest of the body: reason, note, good faith, contact and app version.
    const resumo = screen.getByTestId("denunciar-resumo").textContent ?? ""
    expect(resumo).toContain("Motivo: Assédio ou perseguição")
    expect(resumo).toContain("Nota: Insulta toda a gente.")
    expect(resumo).toContain("Boa-fé: confirmada.")
    expect(resumo).toContain("Contacto: Ana Silva, ana@exemplo.pt")
    expect(resumo).toContain(`Versão da app: ${VERSAO_DA_APP}`)
    // Only name, type and size: no drawn image.
    expect(vista.container.querySelector("img")).toBeNull()
  })

  // Said "No name" until November 4, 2026; the fallback became the
  // address word (owner's order), subtle. With the new sheet the address
  // stays in addresses, never beside or in place of the name.
  it("sem `nomeDe`, cada autor diz a palavra do endereço, discreta, e o endereço fica nos endereços", async () => {
    montar({ semNomeDe: true })
    escolherMotivo("Assédio ou perseguição")
    preencherDetalhes()
    await screen.findByText("O que sai do aparelho")
    const linhas = screen.getAllByTestId("denunciar-item")
    expect(linhas[0]!.textContent).toContain("Ana")
    expect(linhas[0]!.textContent).not.toContain(ANA)
    expect(linhas[1]!.textContent).toContain("Bruno")
    expect(linhas[0]!.querySelector(".nome-do-endereco")?.textContent).toBe("Ana")
    const pessoa = screen.getByTestId("denunciar-pessoa")
    expect(pessoa.textContent).toBe("Pessoa denunciada: Bruno")
    expect(pessoa.querySelector(".nome-do-endereco")?.textContent).toBe("Bruno")
    const enderecos = screen.getByTestId("denunciar-enderecos")
    expect([...enderecos.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["Bruno", "Ana"])
    expect([...enderecos.querySelectorAll("dd")].map((dd) => dd.textContent)).toEqual([BRUNO, ANA])
  })

  it("o aviso tem a frase exacta e só aparece com cópia", async () => {
    montar({ temCopia: true })
    escolherMotivo("Assédio ou perseguição")
    preencherDetalhes()
    await screen.findByText("O que sai do aparelho")
    expect(screen.queryByText(AVISO)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    expect(screen.getByText(AVISO)).toBeTruthy()
    cleanup()

    const sem = montar({ temCopia: false })
    escolherMotivo("Assédio ou perseguição")
    preencherDetalhes()
    await screen.findByText("O que sai do aparelho")
    fireEvent.click(screen.getByRole("button", { name: "Enviar denúncia" }))
    expect(await screen.findByText("Denúncia enviada.")).toBeTruthy()
    expect(screen.queryByText(AVISO)).toBeNull()
    expect(sem.denuncias.enviar).toHaveBeenCalledTimes(1)
  })

  it("ao enviar chama `enviar` com motivo, nota, boaFe e contacto, e mostra 'Denúncia enviada.'", async () => {
    const { denuncias, lista } = montar({ temCopia: true })
    escolherMotivo("Assédio ou perseguição")
    preencherDetalhes()
    await screen.findByText("O que sai do aparelho")
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    fireEvent.click(screen.getByRole("button", { name: "Enviar denúncia" }))
    expect(await screen.findByText("Denúncia enviada.")).toBeTruthy()
    expect(denuncias.enviar).toHaveBeenCalledWith(lista, {
      motivo: 3,
      nota: "Insulta toda a gente.",
      boaFe: true,
      contacto: { nome: "Ana Silva", email: "ana@exemplo.pt" },
    })
  })

  it("o motivo 1 vai sem nota, sem boa-fé e sem contacto", async () => {
    const { denuncias, lista } = montar({ temCopia: false })
    escolherMotivo("Abuso sexual de menores")
    // No details: no note, no good faith, no contact in the reason step.
    expect(screen.queryByLabelText(/Nota/)).toBeNull()
    expect(screen.queryByRole("checkbox")).toBeNull()
    continuar()
    expect(await screen.findByText("O que sai do aparelho")).toBeTruthy()
    expect(screen.queryByLabelText("Nome")).toBeNull()
    // No room in the prepared one, no room line. The summary has only the reason and version.
    expect(screen.queryByTestId("denunciar-sala")).toBeNull()
    const resumo = screen.getByTestId("denunciar-resumo").textContent ?? ""
    expect(resumo).toContain("Motivo: Abuso sexual de menores")
    expect(resumo).toContain(`Versão da app: ${VERSAO_DA_APP}`)
    expect(resumo).not.toContain("Nota:")
    expect(resumo).not.toContain("Boa-fé")
    expect(resumo).not.toContain("Contacto")
    fireEvent.click(screen.getByRole("button", { name: "Enviar denúncia" }))
    await screen.findByText("Denúncia enviada.")
    expect(denuncias.enviar).toHaveBeenCalledWith(lista, { motivo: 1, nota: "", boaFe: false })
  })

  it("denunciar uma pessoa usa o mesmo fluxo: cartão da pessoa, motivo, rever, enviar", async () => {
    const alvo: AlvoDaDenuncia = { canal: ALVO.canal, pessoa: BRUNO }
    const { denuncias } = montar({ temCopia: false, alvo })
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Denunciar Bruno")
    const cartao = screen.getByTestId("denunciar-alvo")
    expect(cartao.textContent).toContain("Bruno")
    expect(cartao.textContent).toContain("Denunciada")
    escolherMotivo("Burla, phishing ou spam")
    preencherDetalhes()
    expect(await screen.findByText("O que sai do aparelho")).toBeTruthy()
    expect(denuncias.preparar).toHaveBeenCalledWith(alvo)
    fireEvent.click(screen.getByRole("button", { name: "Enviar denúncia" }))
    expect(await screen.findByText("Denúncia enviada.")).toBeTruthy()
  })

  it("Esc fecha a janela", () => {
    const { fechar } = montar()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(fechar).toHaveBeenCalledTimes(1)
  })

  it("uma falha 429 mostra 'Erro 217'", async () => {
    montar({ temCopia: false, enviar: () => Promise.reject(new Error("too many reports sent")) })
    escolherMotivo("Assédio ou perseguição")
    preencherDetalhes()
    await screen.findByText("O que sai do aparelho")
    fireEvent.click(screen.getByRole("button", { name: "Enviar denúncia" }))
    expect((await screen.findByRole("alert")).textContent).toContain("Erro 217")
    expect(screen.queryByText("Denúncia enviada.")).toBeNull()
  })
})

describe("a folha de estilos da janela de denunciar", () => {
  const AQUI = dirname(fileURLToPath(import.meta.url))
  const folha = readFileSync(join(AQUI, "../../styles/folhaDeDenunciar.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  const entrada = readFileSync(join(AQUI, "../../styles.css"), "utf8")
  const reduzido = folha.split("@media (prefers-reduced-motion: reduce)").slice(1).join("\n")

  it("entra pela folha de estilos da app", () => {
    expect(entrada).toMatch(/@import "\.\/styles\/folhaDeDenunciar\.css";/)
  })

  it("tudo por baixo da janela: não mexe noutras folhas", () => {
    const seletores = folha
      .split("{")
      .slice(0, -1)
      .map((bloco) => bloco.split("}").pop()!.trim())
      .filter((s) => s !== "" && !s.startsWith("@") && !/^(from|to)$/.test(s))
    for (const grupo of seletores)
      for (const seletor of grupo.split(/,\s*(?![^(]*\))/)) expect(seletor, seletor).toMatch(/^(\.sheet\.denunciar|\.overlay:has\(> \.sheet\.denunciar\))/)
  })

  it("no telemóvel a folha prende-se ao fundo, com a margem do aparelho por baixo do botão", () => {
    const movel = folha.slice(folha.indexOf("@media (max-width: 640px)"))
    expect(movel).toMatch(/place-items:\s*end stretch/)
    expect(movel).toMatch(/\.sheet\.denunciar \.sheet-actions\s*\{[^}]*var\(--seguro-fundo/)
  })

  it("com movimento reduzido nada pára: esvanece, mais devagar, e nada se desloca", () => {
    expect(reduzido).not.toMatch(/animation:\s*none|animation-name:\s*none|transition:\s*none/)
    expect(reduzido).toMatch(/animation-name:\s*denunciar-esvanece !important/)
    expect(reduzido).toMatch(/animation-duration:\s*440ms !important/)
    expect(reduzido).toMatch(/\.denunciar-corpo\s*\{\s*animation-duration:\s*400ms !important/)
    const esvanece = folha.slice(folha.indexOf("@keyframes denunciar-esvanece"))
    expect(esvanece.slice(0, esvanece.indexOf("}\n}"))).not.toMatch(/transform|translate|scale/)
  })
})
