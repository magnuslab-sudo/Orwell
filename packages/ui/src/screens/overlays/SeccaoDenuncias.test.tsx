import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { DenunciaRecebida } from "@enclave/client-core"
import { SeccaoDenuncias } from "./SeccaoDenuncias.js"

afterEach(cleanup)

const BRUNO = "@bruno:orwell.pt"
const ANA = "@ana:orwell.pt"
const NOMES: Record<string, string> = { [BRUNO]: "Bruno", [ANA]: "Ana", "@carla:orwell.pt": "Carla" }
const nomeDe = (endereco: string): string => NOMES[endereco] ?? endereco

const DENUNCIA: DenunciaRecebida = {
  id: "c-1",
  canal: "!sala:orwell.pt",
  dia: "2026-11-02",
  motivo: 3,
  nota: "Insultos.",
  denunciado: BRUNO,
  alvo: { tipo: "mensagem", id: "m-2" },
  itens: [
    { autor: ANA, dia: "2026-11-02", hora: "09:58", texto: "bom dia", anexos: [], verificada: true, denunciada: false },
    {
      autor: BRUNO,
      dia: "2026-11-02",
      hora: "10:01",
      texto: "a ofensa",
      anexos: [{ name: "foto.jpg", mediaType: "image/jpeg", byteLength: 2048 }],
      verificada: true,
      denunciada: true,
    },
    { autor: BRUNO, dia: "2026-11-02", hora: "10:03", texto: "texto mexido", anexos: [], verificada: false, denunciada: false },
  ],
  lida: false,
}

describe("SeccaoDenuncias", () => {
  it("lista motivo, dia, denunciado e as mensagens com a marca Verificada / Não verificada", async () => {
    render(<SeccaoDenuncias carregar={() => Promise.resolve([DENUNCIA])} nomeDe={nomeDe} />)

    expect(await screen.findByText("Assédio ou perseguição")).toBeTruthy()
    expect(screen.getByText("Denúncias")).toBeTruthy()
    expect(screen.getByText("Cada denúncia chega sem o nome de quem a fez. O servidor também a recebeu.")).toBeTruthy()
    expect(screen.getByTestId("denuncia-dia").textContent).toContain("2026")
    expect(screen.getByTestId("denuncia-denunciado").textContent).toContain("Bruno")
    expect(screen.getByText("Insultos.")).toBeTruthy()
    expect(screen.getByText("a ofensa")).toBeTruthy()
    expect(screen.getByText("bom dia")).toBeTruthy()
    // Two messages match and one does not; the report carries proof of the reported message.
    expect(screen.getAllByText("Verificada").length).toBe(3)
    expect(screen.getAllByText("Não verificada").length).toBe(1)
    expect(screen.getByText(/foto\.jpg/)).toBeTruthy()
    expect(screen.getByText("Mensagem denunciada")).toBeTruthy()
  })

  it("sem denúncias mostra a frase do vazio", async () => {
    render(<SeccaoDenuncias carregar={() => Promise.resolve([])} nomeDe={nomeDe} />)
    expect(await screen.findByText("Ninguém denunciou nada neste canal.")).toBeTruthy()
  })

  it("não mostra nome de quem denunciou nem hora da denúncia", async () => {
    const { container } = render(<SeccaoDenuncias carregar={() => Promise.resolve([DENUNCIA])} nomeDe={nomeDe} />)
    await screen.findByText("Assédio ou perseguição")
    expect(container.textContent).not.toContain("Carla")
    // The report header shows only the day: no time.
    expect(screen.getByTestId("denuncia-dia").textContent).not.toMatch(/\d{1,2}:\d{2}/)
    expect(screen.getByTestId("denuncia-cabecalho").textContent).not.toMatch(/\d{1,2}:\d{2}/)
  })

  it("uma caixa que não se lê mostra o Erro 221", async () => {
    render(<SeccaoDenuncias carregar={() => Promise.reject(new Error("could not read the report inbox"))} nomeDe={nomeDe} />)
    expect(await screen.findByText(/Erro 221/)).toBeTruthy()
  })

  it("dá por lidas as que mostrou", async () => {
    const onLida = vi.fn()
    render(<SeccaoDenuncias carregar={() => Promise.resolve([DENUNCIA, { ...DENUNCIA, id: "c-0", lida: true }])} nomeDe={nomeDe} onLida={onLida} />)
    await screen.findAllByText("Assédio ou perseguição")
    expect(onLida).toHaveBeenCalledTimes(1)
    expect(onLida).toHaveBeenCalledWith("c-1")
  })

  it("diz o canal e a sala, e a prova da denúncia", async () => {
    render(
      <SeccaoDenuncias
        carregar={() => Promise.resolve([{ ...DENUNCIA, sala: "s-1" }])}
        nomeDe={nomeDe}
        nomeDoCanal="praca"
        nomeDaSala={(sala) => (sala === "s-1" ? "geral" : sala)}
      />,
    )
    await screen.findByText("Assédio ou perseguição")
    expect(screen.getByTestId("denuncia-canal").textContent).toContain("praca")
    expect(screen.getByTestId("denuncia-sala").textContent).toContain("geral")
    expect(screen.getByTestId("denuncia-prova").textContent).toBe("Verificada")
  })

  it("a prova da denúncia é a da mensagem denunciada", async () => {
    const mexida = { ...DENUNCIA, itens: DENUNCIA.itens.map((item) => (item.denunciada ? { ...item, verificada: false } : item)) }
    render(<SeccaoDenuncias carregar={() => Promise.resolve([mexida])} nomeDe={nomeDe} />)
    await screen.findByText("Assédio ou perseguição")
    expect(screen.getByTestId("denuncia-prova").textContent).toBe("Não verificada")
  })

  it("numa denúncia de pessoa, a prova pede todas as mensagens verificadas", async () => {
    const pessoa: DenunciaRecebida = {
      ...DENUNCIA,
      alvo: { tipo: "pessoa" },
      itens: DENUNCIA.itens.map((item) => ({ ...item, denunciada: false })),
    }
    render(<SeccaoDenuncias carregar={() => Promise.resolve([pessoa, { ...pessoa, id: "c-9", itens: [] }])} nomeDe={nomeDe} />)
    await screen.findAllByText("Assédio ou perseguição")
    expect(screen.getAllByTestId("denuncia-prova").map((no) => no.textContent)).toEqual(["Não verificada", "Não verificada"])
  })

  it("cada denúncia é um cartão, e as mensagens uma lista sem números do browser", async () => {
    const { container } = render(<SeccaoDenuncias carregar={() => Promise.resolve([DENUNCIA])} nomeDe={nomeDe} />)
    await screen.findByText("Assédio ou perseguição")
    expect(container.querySelector("ul.denuncias > li.denuncia")).toBeTruthy()
    expect(container.querySelectorAll(".denuncia-itens > li.denuncia-item").length).toBe(3)
    expect(container.querySelector(".denuncia-item.denunciada .denuncia-marca")?.textContent).toBe("Mensagem denunciada")
    expect(container.querySelector(".denuncia-nota")?.textContent).toContain("Insultos.")
  })

  it("com cópias à espera do aparelho com a chave da conta, não diz que ninguém denunciou", async () => {
    render(<SeccaoDenuncias carregar={() => Promise.resolve([])} carregarPorAbrir={() => Promise.resolve(2)} nomeDe={nomeDe} />)
    expect(await screen.findByText(/2 denúncias à espera/)).toBeTruthy()
    expect(screen.queryByText("Ninguém denunciou nada neste canal.")).toBeNull()
  })

  it("uma só à espera, no singular, ao lado das que já chegaram", async () => {
    render(<SeccaoDenuncias carregar={() => Promise.resolve([DENUNCIA])} carregarPorAbrir={() => Promise.resolve(1)} nomeDe={nomeDe} />)
    expect(await screen.findByText(/1 denúncia à espera/)).toBeTruthy()
    expect(screen.getByText("Assédio ou perseguição")).toBeTruthy()
  })

  it("se contar as que estão à espera falhar, mostra as denúncias na mesma", async () => {
    render(<SeccaoDenuncias carregar={() => Promise.resolve([])} carregarPorAbrir={() => Promise.reject(new Error("x"))} nomeDe={nomeDe} />)
    expect(await screen.findByText("Ninguém denunciou nada neste canal.")).toBeTruthy()
  })
})

describe("a folha das denúncias", () => {
  const AQUI = dirname(fileURLToPath(import.meta.url))
  const folha = readFileSync(join(AQUI, "../../styles/denunciasDoCanal.css"), "utf8")
  const entrada = readFileSync(join(AQUI, "../../styles.css"), "utf8")
  const reduzido = folha.split("@media (prefers-reduced-motion: reduce)").slice(1).join("\n")

  it("entra pela folha de estilos da app", () => {
    expect(entrada).toMatch(/@import "\.\/styles\/denunciasDoCanal\.css";/)
  })

  it("o cartão entra a esvanecer, só opacidade", () => {
    expect(folha).toMatch(/\.seccao-denuncias \.denuncia\s*\{[^}]*animation:\s*denuncia-entra 240ms/)
    const chave = folha.slice(folha.indexOf("@keyframes denuncia-entra"))
    expect(chave.slice(0, chave.indexOf("}\n}"))).not.toMatch(/transform|translate|scale/)
  })

  it("com movimento reduzido continua a esvanecer, mais devagar, e nunca pára", () => {
    expect(reduzido).toMatch(/\.seccao-denuncias \.denuncia\s*\{\s*animation-duration:\s*480ms\s*!important/)
    expect(reduzido).not.toMatch(/animation:\s*none/)
  })

  it("não mexe na pré-visualização de quem denuncia: tudo por baixo da secção", () => {
    const seletores = folha
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("{")
      .slice(0, -1)
      .map((bloco) => bloco.split("}").pop()!.trim())
      .filter((s) => s !== "" && !s.startsWith("@") && !/^(from|to)$/.test(s))
    for (const seletor of seletores) expect(seletor, seletor).toMatch(/^\.seccao-denuncias/)
  })
})
