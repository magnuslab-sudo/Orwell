import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { ARTE_DO_ARRANQUE, FONTE_DO_ARRANQUE, TARJAS_DO_ARRANQUE } from "./arte-do-arranque.gen.js"
import { codigoDoEstado, HTML_DO_ARRANQUE } from "./ecra-de-arranque.js"

// By path, not `new URL(...)`. In jsdom, `URL` is not Node's, and
// `fileURLToPath` rejects it.
const CLIENTE = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const recurso = (nome: string): Buffer => readFileSync(join(CLIENTE, "recursos", nome))

/** The bytes of a `data:` URI in base64. */
function bytesDe(uri: string, tipo: string): Buffer {
  const prefixo = `data:${tipo};base64,`
  expect(uri.startsWith(prefixo)).toBe(true)
  return Buffer.from(uri.slice(prefixo.length), "base64")
}

describe('o ecrã de arranque, direcção "Tarjas"', () => {
  it("a política continua fechada: sem script, e só data: para a arte e a fonte", () => {
    const csp = HTML_DO_ARRANQUE.match(/Content-Security-Policy" content="([^"]+)"/)?.[1]
    expect(csp).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'")
    expect(HTML_DO_ARRANQUE).not.toMatch(/<script/i)
    expect(HTML_DO_ARRANQUE).not.toMatch(/https?:/i)
    // Every `url(...)` in CSS is a `data:`.
    for (const [, alvo] of HTML_DO_ARRANQUE.matchAll(/url\("([^"]{0,12})/g)) expect(alvo?.startsWith("data:")).toBe(true)
  })

  it("tem os quatro sítios que o código das fases pinta", () => {
    const codigo = codigoDoEstado({ fase: "a-descarregar", versao: "1.0.7", recebidos: 2, total: 5 })
    expect(codigo).toContain('"40.0%"')
    for (const id of ["titulo", "barra", "cheio", "detalhe"]) {
      expect(codigo).toContain(`getElementById("${id}")`)
      expect(HTML_DO_ARRANQUE).toContain(`id="${id}"`)
    }
  })

  it('a barra é índigo, e o wordmark é a marca da casa e "rwell"', () => {
    expect(HTML_DO_ARRANQUE).toMatch(/#cheio \{[^}]*background: #7a85f5/)
    expect(TARJAS_DO_ARRANQUE).toHaveLength(10)
    for (const d of TARJAS_DO_ARRANQUE) expect(HTML_DO_ARRANQUE).toContain(`<path d="${d}"/>`)
    expect(HTML_DO_ARRANQUE).toContain('aria-label="Orwell"')
    expect(HTML_DO_ARRANQUE).toContain(">rwell</span>")
  })

  it("a arte é um WebP de 640×560 (320×280 a 2x), e a fonte é WOFF2", () => {
    const arte = bytesDe(ARTE_DO_ARRANQUE, "image/webp")
    expect(arte.subarray(0, 4).toString("latin1")).toBe("RIFF")
    expect(arte.subarray(8, 12).toString("latin1")).toBe("WEBP")
    // VP8 with loss: width and height are in bytes 26 to 29.
    expect(arte.subarray(12, 16).toString("latin1")).toBe("VP8 ")
    expect([arte.readUInt16LE(26) & 0x3fff, arte.readUInt16LE(28) & 0x3fff]).toEqual([640, 560])
    expect(bytesDe(FONTE_DO_ARRANQUE, "font/woff2").subarray(0, 4).toString("latin1")).toBe("wOF2")
  })

  it("a página cabe num data: URL pequeno", () => {
    // The payload `loadURL` receives: the page encoded as a URL.
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(HTML_DO_ARRANQUE)}`
    expect(url.length).toBeLessThan(64 * 1024)
  })
})

describe("a arte do instalador NSIS", () => {
  /** Width, height, and bits per pixel of a BMP (BITMAPINFOHEADER header). */
  function bmp(nome: string): { w: number; h: number; bits: number } {
    const b = recurso(nome)
    expect(b.subarray(0, 2).toString("latin1")).toBe("BM")
    return { w: b.readInt32LE(18), h: Math.abs(b.readInt32LE(22)), bits: b.readUInt16LE(28) }
  }

  it("a barra lateral e o cabeçalho são BMP de 24 bits nas medidas do NSIS", () => {
    expect(bmp("installerSidebar.bmp")).toEqual({ w: 164, h: 314, bits: 24 })
    expect(bmp("installerHeader.bmp")).toEqual({ w: 150, h: 57, bits: 24 })
  })

  it("o electron-builder.yml liga os dois, e a do desinstalador também", () => {
    const yml = readFileSync(join(CLIENTE, "electron-builder.yml"), "utf8")
    expect(yml).toMatch(/^ {2}installerSidebar: installerSidebar\.bmp$/m)
    expect(yml).toMatch(/^ {2}uninstallerSidebar: installerSidebar\.bmp$/m)
    expect(yml).toMatch(/^ {2}installerHeader: installerHeader\.bmp$/m)
  })

  it('o instalador não pergunta "para todos ou só para mim", e deixa escolher a pasta', () => {
    const yml = readFileSync(join(CLIENTE, "electron-builder.yml"), "utf8")
    expect(yml).toMatch(/^ {2}oneClick: false$/m)
    expect(yml).toMatch(/^ {2}perMachine: false$/m)
    expect(yml).toMatch(/^ {2}allowToChangeInstallationDirectory: true$/m)
    expect(yml).toMatch(/^ {2}include: installer\.nsh$/m)
    // The macro electron-builder calls before drawing the page: with one of the
    // two `isForce...` set to "1", the page does `Abort` and doesn't appear.
    const nsh = recurso("installer.nsh").toString("utf8")
    expect(nsh).toMatch(/!macro customInstallMode[\s\S]*StrCpy \$isForceCurrentInstall "1"[\s\S]*!macroend/)
    // Whoever is already in Program Files stays there: no second copy per user.
    expect(nsh).toMatch(/\$hasPerMachineInstallation == "1"[\s\S]*\$hasPerUserInstallation == "0"[\s\S]*StrCpy \$isForceMachineInstall "1"/)
  })
})
