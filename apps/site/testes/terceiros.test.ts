import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { DESTINOS, RAIZ, gerarAvisos } from "../../../scripts/gerar-avisos-de-terceiros.mjs"

/**
 * Orwell's license and third-party notices. In 1.2.1 (11/4/2026) Orwell
 * became proprietary; on 11/9/2026 the owner chose a dual model: AGPL-3.0-only
 * for everyone, and a commercial license for those who do not want to comply
 * (`NOTICE`, `COMMERCIAL.md`). Third-party code included keeps its own licenses,
 * and those require the notice to travel with each copy: in the installer and
 * on the site.
 */
const ler = (caminho: string): string => readFileSync(join(RAIZ, caminho), "utf8")

describe("os avisos de terceiros", () => {
  const gerado = gerarAvisos()

  it.each(DESTINOS)("%s está em dia com o package-lock (senão: node scripts/gerar-avisos-de-terceiros.mjs)", (destino) => {
    expect(ler(destino) === gerado, destino).toBe(true)
  })

  it("lista as dependências de produção das três saídas, com licença e texto", () => {
    for (const nome of ["react 19", "ts-mls ", "mediasoup-client ", "fastify ", "mediasoup ", "electron 43", "@noble/hashes "]) {
      expect(gerado).toContain(`\n${nome}`)
    }
    expect(gerado).toContain("GTCRN")
    expect(gerado).toContain("Copyright (c) 2024 Rong Xiaobin")
    expect(gerado).toContain("Space Grotesk (font)")
    expect(gerado).toContain("SIL OPEN FONT LICENSE")
    expect(gerado).not.toMatch(/\n@enclave\//)
    expect(gerado).not.toMatch(/Licence: UNKNOWN/)
  })

  it("não lista ferramentas de desenvolvimento", () => {
    for (const nome of ["vitest ", "typescript ", "vite ", "playwright ", "electron-builder "]) {
      expect(gerado).not.toContain(`\n${nome}`)
    }
  })

  it("vão dentro do instalador do Electron", () => {
    const config = ler("apps/client/electron-builder.yml")
    expect(config).toMatch(/extraResources:\n(?:\s+.*\n)*?\s+- from: \.\.\/\.\.\/THIRD-PARTY-NOTICES\.txt\n\s+to: THIRD-PARTY-NOTICES\.txt/)
    expect(config).toContain('copyright: "Copyright © 2026 Duarte Bivar"')
  })

  it("estão no rodapé de todas as páginas do site, com um link discreto", () => {
    for (const [pagina, rotulo] of [
      ["index.html", "Third-party notices"],
      ["privacy.html", "Third-party notices"],
      ["terms.html", "Third-party notices"],
      ["ambassadors.html", "Third-party notices"],
      ["pt/index.html", "Avisos de terceiros"],
      ["pt/privacidade.html", "Avisos de terceiros"],
      ["pt/termos.html", "Avisos de terceiros"],
      ["pt/embaixadores.html", "Avisos de terceiros"],
    ]) {
      const rodape = /<footer class="rodape">[\s\S]*?<\/footer>/.exec(ler(`apps/site/${pagina}`))?.[0] ?? ""
      expect(rodape, pagina).toContain(`<p class="rodape-nota"><a href="/terceiros.txt">${rotulo}</a></p>`)
    }
  })

  it("o rodapé de todas as páginas leva ao código-fonte (AGPL-3.0, secção 13)", () => {
    for (const [pagina, rotulo] of [
      ["index.html", "Source code"],
      ["privacy.html", "Source code"],
      ["terms.html", "Source code"],
      ["ambassadors.html", "Source code"],
      ["pt/index.html", "Código-fonte"],
      ["pt/privacidade.html", "Código-fonte"],
      ["pt/termos.html", "Código-fonte"],
      ["pt/embaixadores.html", "Código-fonte"],
    ]) {
      const rodape = /<footer class="rodape">[\s\S]*?<\/footer>/.exec(ler(`apps/site/${pagina}`))?.[0] ?? ""
      expect(rodape, pagina).toContain(
        `<a href="https://github.com/magnuslab-sudo/orwell" target="_blank" rel="noopener noreferrer">${rotulo}</a>`,
      )
    }
  })
})

describe("a licença do Orwell", () => {
  it("é a AGPL-3.0, com o aviso de direitos e a licença comercial no NOTICE", () => {
    const licenca = ler("LICENSE")
    expect(licenca).toMatch(/^\s*GNU AFFERO GENERAL PUBLIC LICENSE\n\s*Version 3, 19 November 2007/)
    expect(licenca).not.toMatch(/Todos os direitos reservados|All rights reserved/i)
    const aviso = ler("NOTICE")
    expect(aviso).toContain("Copyright © 2026 Duarte Bivar")
    expect(aviso).toContain("AGPL-3.0-only")
    expect(aviso).toContain("COMMERCIAL.md")
    expect(aviso).toContain("THIRD-PARTY-NOTICES.txt")
  })

  it("os nove package.json dizem AGPL-3.0-only", () => {
    const caminhos = [
      "package.json",
      ...["client", "server", "site", "web"].map((a) => `apps/${a}/package.json`),
      ...["client-core", "crypto", "protocol", "ui"].map((p) => `packages/${p}/package.json`),
    ]
    for (const caminho of caminhos) {
      expect((JSON.parse(ler(caminho)) as { license?: string }).license, caminho).toBe("AGPL-3.0-only")
    }
  })
})
