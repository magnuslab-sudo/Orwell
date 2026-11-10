import { describe, expect, it } from "vitest"
import jsQR from "../vendor/jsQR.js"
import { QR_MAX_BYTES, bitsDeFormato, bitsDeVersao, codificarQr, desenhoDoQr, type Qr } from "./qr.js"

/**
 * The generator, locked by two things outside its control.
 *
 * Format and version bits are checked against the STANDARD TABLE (ISO 18004,
 * annex C and table D.1), what any reader in the world expects. Each version
 * round-trips through `jsQR`, an independent decoder: a QR it reads, a phone
 * reads.
 */

/** The QR as RGBA image, with margin and scale, as a camera would see it (noiseless). */
function imagem(qr: Qr, escala = 4, margem = 4): { data: Uint8ClampedArray; width: number; height: number } {
  const lado = (qr.size + margem * 2) * escala
  const data = new Uint8ClampedArray(lado * lado * 4).fill(255)
  qr.modules.forEach((linha, l) => {
    linha.forEach((escuro, c) => {
      if (!escuro) return
      for (let y = 0; y < escala; y++) {
        for (let x = 0; x < escala; x++) {
          const px = ((l + margem) * escala + y) * lado + (c + margem) * escala + x
          data[px * 4] = 0
          data[px * 4 + 1] = 0
          data[px * 4 + 2] = 0
        }
      }
    })
  })
  return { data, width: lado, height: lado }
}

function ler(qr: Qr): string | null {
  const { data, width, height } = imagem(qr)
  return jsQR(data, width, height, { inversionAttempts: "dontInvert" })?.data ?? null
}

describe("bits de formato e de versão, contra a norma", () => {
  it("correcção M, máscara 0, é 101010000010010", () => {
    expect(bitsDeFormato(0b00, 0).toString(2).padStart(15, "0")).toBe("101010000010010")
  })
  it("correcção L, máscara 0, é 111011111000100; correcção M, máscaras 5 e 7, são 100000011001110 e 100101010100000", () => {
    expect(bitsDeFormato(0b01, 0).toString(2).padStart(15, "0")).toBe("111011111000100")
    expect(bitsDeFormato(0b00, 5).toString(2).padStart(15, "0")).toBe("100000011001110")
    expect(bitsDeFormato(0b00, 7).toString(2).padStart(15, "0")).toBe("100101010100000")
  })
  it("a versão 7 é 000111110010010100", () => {
    expect(bitsDeVersao(7).toString(2).padStart(18, "0")).toBe("000111110010010100")
  })
  it("a versão 10 é 001010010011010011", () => {
    expect(bitsDeVersao(10).toString(2).padStart(18, "0")).toBe("001010010011010011")
  })
})

describe("o gerador", () => {
  it("escolhe a versão mais pequena onde o texto cabe", () => {
    expect(codificarQr("a".repeat(14)).version).toBe(1)
    expect(codificarQr("a".repeat(15)).version).toBe(2)
    expect(codificarQr("a".repeat(26)).version).toBe(2)
    expect(codificarQr("a".repeat(27)).version).toBe(3)
    expect(codificarQr("a".repeat(122)).version).toBe(7)
    expect(codificarQr("a".repeat(123)).version).toBe(8)
    expect(codificarQr("a".repeat(180)).version).toBe(9)
    expect(codificarQr("a".repeat(181)).version).toBe(10)
    expect(codificarQr("a".repeat(QR_MAX_BYTES)).version).toBe(10)
    expect(() => codificarQr("a".repeat(QR_MAX_BYTES + 1))).toThrow()
  })

  it("o lado é 17 + 4 vezes a versão, e os três localizadores estão lá", () => {
    const qr = codificarQr("orwell")
    expect(qr.size).toBe(21)
    const escuro = (l: number, c: number): boolean => qr.modules[l]?.[c] === true
    // The corners and centers of the three position markers, and the white separator between them and the rest.
    for (const [l, c] of [
      [0, 0],
      [0, 20],
      [20, 0],
      [3, 3],
      [3, 17],
      [17, 3],
    ] as const) {
      expect(escuro(l, c)).toBe(true)
    }
    expect(escuro(7, 7)).toBe(false)
    expect(escuro(7, 13)).toBe(false)
    expect(escuro(13, 7)).toBe(false)
    // The fixed dark module.
    expect(escuro(qr.size - 8, 8)).toBe(true)
  })

  it("cada versão, de 1 a 10, é lida de volta pelo jsQR com o texto inteiro", () => {
    const comprimentos = [1, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213]
    for (const n of comprimentos) {
      const texto = Array.from({ length: n }, (_, i) => String.fromCharCode(33 + ((i * 7) % 90))).join("")
      const qr = codificarQr(texto)
      expect(ler(qr), `versão ${qr.version}, ${n} bytes`).toBe(texto)
    }
  })

  it("um link de emparelhamento real lê-se de volta, em servidores curtos e compridos", () => {
    const segredo = "6gzjKC5Y-jxiXv_ZLoIzYX6ZL4PeZ24HirzSb__z6VY"
    for (const servidor of ["orwell.pt", "localhost:8448", `${"a".repeat(60)}.${"b".repeat(60)}.exemplo.pt`]) {
      const link = `https://${servidor}/app/emparelhar#${segredo}`
      const qr = codificarQr(link)
      expect(ler(qr)).toBe(link)
    }
  })

  it("todas as oito máscaras produzem um QR legível: a escolha por penalização não é o que o torna válido", () => {
    const texto = "https://orwell.pt/app/emparelhar#6gzjKC5Y-jxiXv_ZLoIzYX6ZL4PeZ24HirzSb__z6VY"
    for (let mascara = 0; mascara < 8; mascara++) {
      expect(ler(codificarQr(texto, mascara)), `máscara ${mascara}`).toBe(texto)
    }
  })

  it("UTF-8 fora do ASCII vai em bytes e volta igual", () => {
    const texto = "emparelhar: ação, coração, Ü"
    expect(ler(codificarQr(texto))).toBe(texto)
  })

  it("é determinístico: o mesmo texto dá a mesma matriz", () => {
    const a = codificarQr("orwell")
    const b = codificarQr("orwell")
    expect(a.modules).toEqual(b.modules)
  })

  it("o desenho tem a zona de silêncio de quatro módulos e um módulo por escuro", () => {
    const qr = codificarQr("orwell")
    const { lado, d } = desenhoDoQr(qr)
    expect(lado).toBe(qr.size + 8)
    const escuros = qr.modules.flat().filter(Boolean).length
    expect(d.match(/M/g)).toHaveLength(escuros)
    // The first dark module is the position marker corner, offset by the margin.
    expect(d.startsWith("M4 4h1v1h-1z")).toBe(true)
  })
})
