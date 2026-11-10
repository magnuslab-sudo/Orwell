import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
// @ts-expect-error plain JavaScript script, no declarations: it is run by
// `node scripts/publicar-instaladores.mjs` and isn't part of any build.
import { escolherInstaladores, manifestoDeVersao, versaoDoNome } from "../../../scripts/instaladores.mjs"

/**
 * The downloads page cannot lie again.
 *
 * On August 21, 2026 the root was at 0.2.0 and `orwell.pt/transferencias/`
 * offered 0.1.0. Anyone who downloaded got an app from before the SFU, screen sharing,
 * 37 channel operations and translations.
 *
 * **And the page had no number written by hand.** It is generated
 * (`scripts/publicar-instaladores.mjs`) and the seal at the top always came from
 * the root `package.json`. What was never checked were the FILES: the names come from
 * a `readdir` of the work folder, picked by `mtime`, and no one compared the number
 * in the name with the number at the top. Skipping the two slow steps-build and
 * package-would publish the new page over the old installers.
 *
 * Same family as three this week: the README saying calls were mesh, the threat model
 * with two false sentences, the script broken five days ago. A statement true the day
 * it was written, and nothing measuring it.
 *
 * What is measured here is the decision, not the I/O: `escolherInstaladores` opens
 * no files.
 */
const raiz = JSON.parse(readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8")) as {
  version: string
  nomeDaVersao: string
}

/** Some build, with whatever date you want. */
function instalador(nome: string, sistema: string, modificado: number): { nome: string; sistema: string; modificado: number } {
  return { nome, sistema, modificado }
}

describe("a versão que um instalador anuncia", () => {
  it("lê-se do nome, que é o que vai para a página e para a URL", () => {
    expect(versaoDoNome("Orwell-0.2.0-macos-universal.dmg")).toBe("0.2.0")
    expect(versaoDoNome("Orwell-0.2.0-windows-x64.exe")).toBe("0.2.0")
  })

  it("e não depende do produto se chamar Orwell", () => {
    // The product name has changed once. A reader that requires it would return
    // "unknown" on the day of the change, and "unknown" stops the entire release.
    expect(versaoDoNome("Enclave-1.10.3-macos-universal.dmg")).toBe("1.10.3")
  })

  it("um nome sem versão nenhuma não inventa uma", () => {
    // `undefined` not "": "unknown" and "says it is the empty version" lead to
    // different decisions in the caller.
    expect(versaoDoNome("Orwell.dmg")).toBeUndefined()
  })
})

describe("o que se publica", () => {
  it("é um por sistema, e o mais recente", () => {
    const { publicar, deFora } = escolherInstaladores(
      [
        instalador("Orwell-0.2.0-macos-universal.dmg", "macOS", 200),
        instalador("Orwell-0.2.0-windows-x64.exe", "Windows", 200),
      ],
      "0.2.0",
    )
    expect(publicar.map((f: { nome: string }) => f.nome).sort()).toEqual([
      "Orwell-0.2.0-macos-universal.dmg",
      "Orwell-0.2.0-windows-x64.exe",
    ])
    expect(deFora).toEqual([])
  })

  it("e o que fica de fora é dito, não descartado em silêncio", () => {
    /*
      The folder is working space and accumulates builds. On August 13, 2026 it had
      four installers, two with the wrong icon, and the page offered all
      four. An installer silently discarded is indistinguishable from one
      that was never built.
    */
    const { publicar, deFora } = escolherInstaladores(
      [
        instalador("Orwell-0.2.0-macos-universal.dmg", "macOS", 100),
        instalador("Orwell-0.2.0-macos-x64.dmg", "macOS", 300),
      ],
      "0.2.0",
    )
    expect(publicar).toHaveLength(1)
    expect(publicar[0].nome).toBe("Orwell-0.2.0-macos-x64.dmg")
    expect(deFora).toEqual([{ nome: "Orwell-0.2.0-macos-universal.dmg", porque: "há um macOS mais recente" }])
  })
})

describe("a guarda que impede a página de mentir", () => {
  it("recusa publicar um instalador que anuncia outra versão", () => {
    // The August 21, 2026 outage, written as a case: the root in 0.2.0, the
    // file from 0.1.0, and the page putting the new badge over the old button.
    const { divergentes } = escolherInstaladores(
      [instalador("Orwell-0.1.0-macos-universal.dmg", "macOS", 100)],
      "0.2.0",
    )
    expect(divergentes).toEqual([{ nome: "Orwell-0.1.0-macos-universal.dmg", versao: "0.1.0" }])
  })

  it("recusa também um que não anuncia versão nenhuma", () => {
    // Not knowing is reason to stop, not to let through: a name that this
    // reader does not understand is a name that nobody has verified.
    const { divergentes } = escolherInstaladores([instalador("Orwell.dmg", "macOS", 100)], "0.2.0")
    expect(divergentes).toEqual([{ nome: "Orwell.dmg", versao: undefined }])
  })

  it("apanha um sistema desalinhado mesmo quando o outro está certo", () => {
    /*
      How this happens for real: macOS is rebuilt, `--win` is forgotten, and
      yesterday's `.exe` remains the most recent for Windows. Publishing only
      what matches would be the same defect with fewer people catching it, so
      the caller stops everything.
    */
    const { divergentes } = escolherInstaladores(
      [
        instalador("Orwell-0.2.0-macos-universal.dmg", "macOS", 300),
        instalador("Orwell-0.1.0-windows-x64.exe", "Windows", 100),
      ],
      "0.2.0",
    )
    expect(divergentes).toEqual([{ nome: "Orwell-0.1.0-windows-x64.exe", versao: "0.1.0" }])
  })

  it("não se queixa de uma construção velha que já ia ficar de fora", () => {
    // Clearing the folder before each run is not a step anyone takes, and a
    // guard that forces it is a guard that gets disabled.
    const { publicar, divergentes } = escolherInstaladores(
      [
        instalador("Orwell-0.1.0-macos-universal.dmg", "macOS", 100),
        instalador("Orwell-0.2.0-macos-universal.dmg", "macOS", 300),
      ],
      "0.2.0",
    )
    expect(divergentes).toEqual([])
    expect(publicar[0].nome).toBe("Orwell-0.2.0-macos-universal.dmg")
  })
})

describe("o manifesto que a aplicação instalada lê", () => {
  const ficheiros = [
    { nome: "Orwell-0.2.0-macos-universal.dmg", sistema: "macOS", bytes: 310_000_000, soma: "a".repeat(64) },
  ]

  it("anuncia a versão da raiz, e não uma escrita à mão", () => {
    const manifesto = manifestoDeVersao(raiz, ficheiros)
    expect(manifesto.versao).toBe(raiz.version)
    expect(manifesto.nome).toBe(raiz.nomeDaVersao)
  })

  it("leva a soma de cada ficheiro, que é a única defesa que há sem assinatura", () => {
    const manifesto = manifestoDeVersao(raiz, ficheiros)
    expect(manifesto.ficheiros[0].soma).toBe("a".repeat(64))
  })

  it("e não traz endereço nenhum, que é o que o impede de mandar em quem o lê", () => {
    /*
      The manifest states a number and some checksums. It does not say where to go.
      The app has its address written in code (`ENDERECO_DAS_DESCARGAS`), and that
      is what ensures a compromised server can only lie about VERSION, never about
      the destination: an address field being obeyed would be phishing served
      over HTTPS from our own domain.
    */
    const manifesto = manifestoDeVersao(raiz, ficheiros) as Record<string, unknown>
    const enderecos = JSON.stringify(manifesto).match(/https?:\/\/[^"]+/g) ?? []
    expect(enderecos, `endereços dentro do manifesto:\n${enderecos.join("\n")}`).toEqual([])
  })
})
