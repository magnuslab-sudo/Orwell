/**
 * A small, complete QR generator for the pairing link.
 *
 * ## What it does, and only that
 *
 * Byte mode (ISO 8859-1 / UTF-8 as-is), correction M, versions 1 to 10 (up to
 * 213 bytes). This is what a link `https://<servidor>/app/emparelhar#<43 chars>`
 * needs, with room to spare for a long server name. It doesn't do numeric or
 * alphanumeric mode, doesn't do Kanji, doesn't do other correction levels, doesn't
 * do versions above 10: each one of those would be code no one exercises here.
 *
 * ## Why not a dependency
 *
 * `packages/ui` never took third parties, and a QR generator is a closed and
 * known algorithm (ISO/IEC 18004): Reed-Solomon over GF(256), eight masks, zigzag
 * placement. It fits in three hundred readable lines, and what we gain is reading
 * what runs. What locks it is `qr.test.ts`: the format bits against the standard
 * table, and the round trip of each version through the reader (`vendor/jsQR.ts`),
 * which is an independent decoder.
 *
 * ## The output
 *
 * A matrix of booleans (`true` = dark module), no margin: whoever draws adds the
 * quiet zone (four modules) and the scale. See `QrSvg`.
 */

export interface Qr {
  /** Side, in modules: `17 + 4 * versão`. */
  readonly size: number
  readonly version: number
  /** `modules[linha][coluna]`, `true` for dark. */
  readonly modules: readonly (readonly boolean[])[]
}

/** Versions 1 to 10, M correction: data and correction blocks. From table 9 of the standard. */
const VERSOES: readonly {
  /** Data bytes that fit (byte mode), minus the header. */
  capacidade: number
  /** Correction codewords per block. */
  ec: number
  /** Blocks, each with this many data codewords. */
  blocos: readonly number[]
  /** Alignment pattern positions (a list, applied on both axes). */
  alinhamento: readonly number[]
  /** Remainder bits at the end of the stream. */
  resto: number
}[] = [
  { capacidade: 14, ec: 10, blocos: [16], alinhamento: [], resto: 0 },
  { capacidade: 26, ec: 16, blocos: [28], alinhamento: [6, 18], resto: 7 },
  { capacidade: 42, ec: 26, blocos: [44], alinhamento: [6, 22], resto: 7 },
  { capacidade: 62, ec: 18, blocos: [32, 32], alinhamento: [6, 26], resto: 7 },
  { capacidade: 84, ec: 24, blocos: [43, 43], alinhamento: [6, 30], resto: 7 },
  { capacidade: 106, ec: 16, blocos: [27, 27, 27, 27], alinhamento: [6, 34], resto: 7 },
  { capacidade: 122, ec: 18, blocos: [31, 31, 31, 31], alinhamento: [6, 22, 38], resto: 0 },
  { capacidade: 152, ec: 22, blocos: [38, 38, 39, 39], alinhamento: [6, 24, 42], resto: 0 },
  { capacidade: 180, ec: 22, blocos: [36, 36, 36, 37, 37], alinhamento: [6, 26, 46], resto: 0 },
  { capacidade: 213, ec: 26, blocos: [43, 43, 43, 43, 44], alinhamento: [6, 28, 50], resto: 0 },
]

/** The largest payload this generator accepts, in bytes. */
export const QR_MAX_BYTES = VERSOES[VERSOES.length - 1]?.capacidade ?? 0

/** M correction is bits `00` in the format information. */
const ECC_M = 0b00

// ------------------------------------------------------------- GF(256)

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    // QR primitive polynomial: x^8 + x^4 + x^3 + x^2 + 1 (0x11D).
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] as number
}

function multiplicar(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return EXP[(LOG[a] as number) + (LOG[b] as number)] as number
}

/** Generator polynomial of degree `n`: (x - α^0)(x - α^1)...(x - α^(n-1)). */
function gerador(n: number): Uint8Array {
  let g = Uint8Array.of(1)
  for (let i = 0; i < n; i++) {
    const proximo = new Uint8Array(g.length + 1)
    for (let j = 0; j < g.length; j++) {
      proximo[j] = (proximo[j] as number) ^ (g[j] as number)
      proximo[j + 1] = (proximo[j + 1] as number) ^ multiplicar(g[j] as number, EXP[i] as number)
    }
    g = proximo
  }
  return g
}

/** The `n` correction codewords for a data block. */
function reedSolomon(dados: Uint8Array, n: number): Uint8Array {
  const g = gerador(n)
  const resto = new Uint8Array(n)
  for (const byte of dados) {
    const factor = byte ^ (resto[0] as number)
    resto.copyWithin(0, 1)
    resto[n - 1] = 0
    if (factor === 0) continue
    for (let j = 0; j < n; j++) resto[j] = (resto[j] as number) ^ multiplicar(g[j + 1] as number, factor)
  }
  return resto
}

// --------------------------------------------------------- BCH (formato)

/**
 * Format information: 5 bits (correction and mask) plus 10 BCH bits,
 * all XORed with the standard's fixed mask. `qr.test.ts` checks against the table.
 */
export function bitsDeFormato(ecc: number, mascara: number): number {
  const dados = (ecc << 3) | mascara
  let resto = dados
  for (let i = 0; i < 10; i++) resto = (resto << 1) ^ ((resto >>> 9) & 1 ? 0x537 : 0)
  return ((dados << 10) | (resto & 0x3ff)) ^ 0x5412
}

/** Version information (version 7 and up only): 6 bits plus 12 BCH bits. */
export function bitsDeVersao(versao: number): number {
  let resto = versao
  for (let i = 0; i < 12; i++) resto = (resto << 1) ^ ((resto >>> 11) & 1 ? 0x1f25 : 0)
  return (versao << 12) | (resto & 0xfff)
}

// ------------------------------------------------------------ data

/** Writes bits from most to least significant into a byte vector. */
class Bits {
  readonly bytes: number[] = []
  #comprimento = 0

  escrever(valor: number, quantos: number): void {
    for (let i = quantos - 1; i >= 0; i--) {
      const bit = (valor >>> i) & 1
      const indice = this.#comprimento >>> 3
      if (indice >= this.bytes.length) this.bytes.push(0)
      this.bytes[indice] = (this.bytes[indice] as number) | (bit << (7 - (this.#comprimento & 7)))
      this.#comprimento++
    }
  }

  get comprimento(): number {
    return this.#comprimento
  }
}

/** The smallest version where the bytes fit, or `null`. */
function versaoPara(bytes: number): number | null {
  const indice = VERSOES.findIndex((v) => v.capacidade >= bytes)
  return indice < 0 ? null : indice + 1
}

/** Final codewords, already interleaved: data from all blocks, then correction from all. */
function codewords(payload: Uint8Array, versao: number): Uint8Array {
  const info = VERSOES[versao - 1] as (typeof VERSOES)[number]
  const totalDados = info.blocos.reduce((a, b) => a + b, 0)

  const bits = new Bits()
  bits.escrever(0b0100, 4) // byte mode
  // Byte mode character counter is 8 bits up to version 9, 16 bits from version 10 on.
  bits.escrever(payload.length, versao <= 9 ? 8 : 16)
  for (const byte of payload) bits.escrever(byte, 8)
  // Terminator (up to 4 zeros), padding to byte, then standard padding bytes.
  bits.escrever(0, Math.min(4, totalDados * 8 - bits.comprimento))
  while (bits.comprimento % 8 !== 0) bits.escrever(0, 1)
  const dados = new Uint8Array(totalDados)
  dados.set(bits.bytes.slice(0, totalDados))
  for (let i = bits.bytes.length, enchimento = 0xec; i < totalDados; i++, enchimento ^= 0xec ^ 0x11) dados[i] = enchimento

  // Blocks, each with its own correction.
  const blocosDeDados: Uint8Array[] = []
  const blocosDeEc: Uint8Array[] = []
  let at = 0
  for (const tamanho of info.blocos) {
    const bloco = dados.subarray(at, at + tamanho)
    at += tamanho
    blocosDeDados.push(bloco)
    blocosDeEc.push(reedSolomon(bloco, info.ec))
  }

  // Interleaved column by column: first codeword of each block, then second
  // of each block, and so on; longer blocks contribute alone at the end.
  const saida: number[] = []
  const maior = Math.max(...info.blocos)
  for (let i = 0; i < maior; i++) for (const bloco of blocosDeDados) if (i < bloco.length) saida.push(bloco[i] as number)
  for (let i = 0; i < info.ec; i++) for (const bloco of blocosDeEc) saida.push(bloco[i] as number)
  return Uint8Array.from(saida)
}

// ------------------------------------------------------------ a matriz

class Matriz {
  readonly size: number
  readonly modulos: boolean[][]
  /** Modules that are function (patterns, format, version): the mask does not touch these. */
  readonly funcao: boolean[][]

  constructor(size: number) {
    this.size = size
    this.modulos = Array.from({ length: size }, () => Array<boolean>(size).fill(false))
    this.funcao = Array.from({ length: size }, () => Array<boolean>(size).fill(false))
  }

  por(linha: number, coluna: number, escuro: boolean): void {
    ;(this.modulos[linha] as boolean[])[coluna] = escuro
    ;(this.funcao[linha] as boolean[])[coluna] = true
  }

  eFuncao(linha: number, coluna: number): boolean {
    return (this.funcao[linha] as boolean[])[coluna] as boolean
  }

  ler(linha: number, coluna: number): boolean {
    return (this.modulos[linha] as boolean[])[coluna] as boolean
  }
}

function localizador(m: Matriz, linha: number, coluna: number): void {
  // 7x7 with white separator of 1 around it (inside the matrix).
  for (let dl = -1; dl <= 7; dl++) {
    for (let dc = -1; dc <= 7; dc++) {
      const l = linha + dl
      const c = coluna + dc
      if (l < 0 || c < 0 || l >= m.size || c >= m.size) continue
      const dist = Math.max(Math.abs(dl - 3), Math.abs(dc - 3))
      m.por(l, c, dist !== 2 && dist !== 4)
    }
  }
}

function alinhamento(m: Matriz, linha: number, coluna: number): void {
  for (let dl = -2; dl <= 2; dl++) {
    for (let dc = -2; dc <= 2; dc++) {
      const dist = Math.max(Math.abs(dl), Math.abs(dc))
      m.por(linha + dl, coluna + dc, dist !== 1)
    }
  }
}

function padroesDeFuncao(m: Matriz, versao: number): void {
  const info = VERSOES[versao - 1] as (typeof VERSOES)[number]
  localizador(m, 0, 0)
  localizador(m, 0, m.size - 7)
  localizador(m, m.size - 7, 0)
  // Timing: row 6 and column 6, alternating, between the position markers.
  for (let i = 8; i < m.size - 8; i++) {
    m.por(6, i, i % 2 === 0)
    m.por(i, 6, i % 2 === 0)
  }
  // Alignment: on all combinations, except the three that fall on position markers.
  const posicoes = info.alinhamento
  for (const l of posicoes) {
    for (const c of posicoes) {
      const primeiro = posicoes[0]
      const ultimo = posicoes[posicoes.length - 1]
      if ((l === primeiro && c === primeiro) || (l === primeiro && c === ultimo) || (l === ultimo && c === primeiro)) continue
      alinhamento(m, l, c)
    }
  }
  // Format information areas (written later, by mask): nine each around the
  // first position marker minus timing; seven in column 8 going up from the
  // bottom corner and eight in row 8 ending at the right corner. Plus the
  // fixed dark module, the eighth in that column.
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      m.por(8, i, false)
      m.por(i, 8, false)
    }
  }
  for (let i = 0; i < 8; i++) m.por(8, m.size - 1 - i, false)
  for (let i = 0; i < 7; i++) m.por(m.size - 1 - i, 8, false)
  m.por(m.size - 8, 8, true)
  if (versao >= 7) {
    const bits = bitsDeVersao(versao)
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1
      const a = Math.floor(i / 3)
      const b = (i % 3) + m.size - 11
      m.por(a, b, bit)
      m.por(b, a, bit)
    }
  }
}

function escreverFormato(m: Matriz, mascara: number): void {
  const bits = bitsDeFormato(ECC_M, mascara)
  const bit = (i: number): boolean => ((bits >>> i) & 1) === 1
  // First copy, around the top-left finder: bits 0 to 5 descend down column 8
  // (rows 0 to 5), bits 6 and 7 turn the corner at (7,8) and (8,8), and bits 8
  // to 14 follow row 8 leftward (columns 7 to 0, skipping timing at 6).
  for (let i = 0; i <= 5; i++) m.por(i, 8, bit(i))
  m.por(7, 8, bit(6))
  m.por(8, 8, bit(7))
  m.por(8, 7, bit(8))
  for (let i = 9; i < 15; i++) m.por(8, 14 - i, bit(i))
  // Second copy: bits 0 to 7 on row 8 starting from the right corner (column
  // size-1 is bit 0), and bits 8 to 14 on column 8 descending to the bottom corner
  // (row size-1 is bit 14). The module above them at that column, at (size-8, 8),
  // is the fixed dark.
  for (let i = 0; i < 8; i++) m.por(8, m.size - 1 - i, bit(i))
  for (let i = 8; i < 15; i++) m.por(m.size - 15 + i, 8, bit(i))
}

/** The eight masks from the standard, by (row, column). */
function mascarar(mascara: number, l: number, c: number): boolean {
  switch (mascara) {
    case 0:
      return (l + c) % 2 === 0
    case 1:
      return l % 2 === 0
    case 2:
      return c % 3 === 0
    case 3:
      return (l + c) % 3 === 0
    case 4:
      return (Math.floor(l / 2) + Math.floor(c / 3)) % 2 === 0
    case 5:
      return ((l * c) % 2) + ((l * c) % 3) === 0
    case 6:
      return (((l * c) % 2) + ((l * c) % 3)) % 2 === 0
    default:
      return (((l + c) % 2) + ((l * c) % 3)) % 2 === 0
  }
}

/** Places codewords in zigzag, upward from the right, skipping column 6. */
function colocarDados(m: Matriz, dados: Uint8Array, mascara: number): void {
  let indice = 0
  const total = dados.length * 8
  let paraCima = true
  for (let direita = m.size - 1; direita >= 1; direita -= 2) {
    if (direita === 6) direita = 5
    for (let passo = 0; passo < m.size; passo++) {
      const l = paraCima ? m.size - 1 - passo : passo
      for (const c of [direita, direita - 1]) {
        if (m.eFuncao(l, c)) continue
        // After the data come the remainder bits, set to zero.
        let bit = false
        if (indice < total) bit = (((dados[indice >>> 3] as number) >>> (7 - (indice & 7))) & 1) === 1
        indice++
        ;(m.modulos[l] as boolean[])[c] = bit !== mascarar(mascara, l, c)
      }
    }
    paraCima = !paraCima
  }
}

/**
 * The penalty of a mask, by the standard's four rules. Lowest wins: it spreads
 * the dark and avoids patterns that look like finders.
 */
function penalizacao(m: Matriz): number {
  let total = 0
  const n = m.size
  // Rule 1: runs of 5 or more of the same color, in rows and columns.
  for (let i = 0; i < n; i++) {
    for (const eixo of [0, 1]) {
      let corrida = 1
      for (let j = 1; j < n; j++) {
        const actual = eixo === 0 ? m.ler(i, j) : m.ler(j, i)
        const anterior = eixo === 0 ? m.ler(i, j - 1) : m.ler(j - 1, i)
        if (actual === anterior) {
          corrida++
          if (corrida === 5) total += 3
          else if (corrida > 5) total += 1
        } else corrida = 1
      }
    }
  }
  // Rule 2: 2x2 blocks of one color.
  for (let l = 0; l < n - 1; l++) {
    for (let c = 0; c < n - 1; c++) {
      const a = m.ler(l, c)
      if (a === m.ler(l, c + 1) && a === m.ler(l + 1, c) && a === m.ler(l + 1, c + 1)) total += 3
    }
  }
  // Rule 3: the pattern 1011101 with four lights on either side.
  const padrao = [true, false, true, true, true, false, true]
  const claros = [false, false, false, false]
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= n - 11; j++) {
      for (const eixo of [0, 1]) {
        const ler = (k: number): boolean => (eixo === 0 ? m.ler(i, j + k) : m.ler(j + k, i))
        const antes = claros.every((_, k) => ler(k) === false) && padrao.every((p, k) => ler(4 + k) === p)
        const depois = padrao.every((p, k) => ler(k) === p) && claros.every((_, k) => ler(7 + k) === false)
        if (antes || depois) total += 40
      }
    }
  }
  // Rule 4: proportion of dark far from half.
  let escuros = 0
  for (let l = 0; l < n; l++) for (let c = 0; c < n; c++) if (m.ler(l, c)) escuros++
  const percentagem = (escuros * 100) / (n * n)
  const anterior = Math.floor(percentagem / 5) * 5
  const seguinte = anterior + 5
  total += Math.min(Math.abs(anterior - 50) / 5, Math.abs(seguinte - 50) / 5) * 10
  return total
}

/**
 * Encodes `text` (UTF-8) as a QR with M correction, in the smallest version
 * that fits it, with the lowest-penalty mask.
 *
 * @throws if the text is more than `QR_MAX_BYTES` bytes.
 */
export function codificarQr(texto: string, mascaraForcada?: number): Qr {
  const payload = new TextEncoder().encode(texto)
  const versao = versaoPara(payload.length)
  if (versao === null) throw new Error(`o QR só leva até ${QR_MAX_BYTES} bytes; este texto tem ${payload.length}`)
  const dados = codewords(payload, versao)
  const size = 17 + 4 * versao

  let melhor: Matriz | null = null
  let menor = Number.POSITIVE_INFINITY
  const candidatas = mascaraForcada === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [mascaraForcada]
  for (const mascara of candidatas) {
    const m = new Matriz(size)
    padroesDeFuncao(m, versao)
    colocarDados(m, dados, mascara)
    escreverFormato(m, mascara)
    const p = penalizacao(m)
    if (p < menor) {
      menor = p
      melhor = m
    }
  }
  const escolhida = melhor as Matriz
  return { size, version: versao, modules: escolhida.modulos.map((linha) => [...linha]) }
}

/** The quiet zone from the standard: four light modules all around. */
export const QR_MARGEM = 4

/**
 * The QR as a drawing: the box side (modules plus margin) and an SVG `path`
 * with the dark modules. One `path`, not a `rect` per module: a version 10 QR
 * has 3,249 modules, and 3,249 DOM nodes for a static drawing was too much
 * weight. The renderer (`QrCode.tsx`) puts this in an `<svg viewBox>` and
 * picks the size by width.
 */
export function desenhoDoQr(qr: Qr): { lado: number; d: string } {
  const lado = qr.size + QR_MARGEM * 2
  let d = ""
  qr.modules.forEach((linha, l) => {
    linha.forEach((escuro, c) => {
      if (escuro) d += `M${c + QR_MARGEM} ${l + QR_MARGEM}h1v1h-1z`
    })
  })
  return { lado, d }
}
