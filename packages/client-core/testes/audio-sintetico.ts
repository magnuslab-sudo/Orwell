/**
 * Synthetic audio for voice chain tests, and the metrics that measure it.
 *
 * Deterministic: the same pseudorandom generator with the same seed on every
 * machine. No audio files in the repository.
 */
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

export const TAXA = 48000
export const BLOCO = 128

/** xorshift32: small, fast, and identical everywhere. */
export function gerador(semente: number): () => number {
  let s = semente >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

/**
 * A synthetic voice: glottal pulses at ~120 Hz with vibrato, three formants that
 * shift each syllable (250 ms), syllabic envelope, and 0.6 s of silence every 2 s.
 * Not a human voice; it's a signal with the shape of one (harmonics, formants,
 * syllables and pauses), which is what SNR metrics need.
 */
export function voz(segundos: number, taxa = TAXA): Float32Array {
  const n = Math.round(segundos * taxa)
  const formantes = [
    [700, 1220, 2600],
    [300, 2300, 3000],
    [500, 1000, 2500],
    [400, 1700, 2400],
  ] as const
  const estado = [
    [0, 0],
    [0, 0],
    [0, 0],
  ]
  const x = new Float32Array(n)
  let fase = 0
  const silaba = 0.25
  for (let i = 0; i < n; i++) {
    const t = i / taxa
    const f0 = 120 + 15 * Math.sin(2 * Math.PI * 0.7 * t) + 8 * Math.sin(2 * Math.PI * 5 * t)
    fase += f0 / taxa
    if (fase >= 1) fase -= 1
    const fonte = (fase < 0.4 ? Math.sin((Math.PI * fase) / 0.4) : 0) - 0.25
    const F = formantes[Math.floor(t / silaba) % 4]!
    let y = 0
    for (let j = 0; j < 3; j++) {
      const largura = 80 + 40 * j
      const r = Math.exp((-Math.PI * largura) / taxa)
      const a1 = 2 * r * Math.cos((2 * Math.PI * F[j]!) / taxa)
      const a2 = -r * r
      const e = estado[j]!
      const v = fonte * (1 - r) + a1 * e[0]! + a2 * e[1]!
      e[1] = e[0]!
      e[0] = v
      y += v / (j + 1)
    }
    const emFala = t % 2 < 1.4
    const envelope = emFala ? Math.pow(Math.sin(Math.PI * ((t % silaba) / silaba)), 0.6) : 0
    x[i] = y * envelope
  }
  return x
}

export type TipoDeRuido = "branco" | "rosa" | "ventoinha" | "teclado"

export function ruido(tipo: TipoDeRuido, n: number, taxa = TAXA, semente = 7): Float32Array {
  const r = gerador(semente)
  const x = new Float32Array(n)
  if (tipo === "branco") for (let i = 0; i < n; i++) x[i] = r() * 2 - 1
  if (tipo === "rosa") {
    // Paul Kellet filter: -3 dB per octave.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1
      b0 = 0.99886 * b0 + w * 0.0555179
      b1 = 0.99332 * b1 + w * 0.0750759
      b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.8665 * b3 + w * 0.3104856
      b4 = 0.55 * b4 + w * 0.5329522
      b5 = -0.7616 * b5 - w * 0.016898
      x[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
      b6 = w * 0.115926
    }
  }
  if (tipo === "ventoinha") {
    // 50 Hz mains hum with eight harmonics, and broad air noise.
    for (let i = 0; i < n; i++) {
      const t = i / taxa
      let v = 0
      for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * 50 * h * t + h) / h
      x[i] = v + 0.3 * (r() * 2 - 1)
    }
  }
  if (tipo === "teclado") {
    // 4 ms pulses with fast decay, 80 to 330 ms apart, like key presses.
    let proxima = 0
    for (let i = 0; i < n; i++) {
      if (i < proxima) continue
      const comprimento = Math.floor(0.004 * taxa)
      const amplitude = 0.5 + r()
      for (let k = 0; k < comprimento && i + k < n; k++) {
        x[i + k] = x[i + k]! + amplitude * (r() * 2 - 1) * Math.exp(-k / (0.0008 * taxa))
      }
      proxima = i + Math.floor((0.08 + r() * 0.25) * taxa)
    }
  }
  return x
}

export function potencia(x: Float32Array): number {
  let s = 0
  for (const v of x) s += v * v
  return s
}

/** Normalize to `db` dBFS RMS, measured only where signal is present. */
export function normalizar(x: Float32Array, db: number): Float32Array {
  let s = 0
  let c = 0
  for (const v of x) {
    if (Math.abs(v) > 1e-6) {
      s += v * v
      c++
    }
  }
  const g = Math.pow(10, db / 20) / Math.sqrt(s / c)
  return x.map((v) => v * g)
}

/** Voice plus noise, with noise scaled to give `snrDb` SNR at the input. */
export function misturar(voz: Float32Array, barulho: Float32Array, snrDb: number): Float32Array {
  const g = Math.sqrt(potencia(voz) / potencia(barulho) / Math.pow(10, snrDb / 10))
  return voz.map((v, i) => v + g * barulho[i]!)
}

/** The lag (in samples) that maximizes the correlation of `b` with `a`. */
export function atraso(a: Float32Array, b: Float32Array, maximo = 4800): number {
  let melhor = -Infinity
  let melhorAtraso = 0
  for (let d = 0; d < maximo; d++) {
    let s = 0
    for (let i = 0; i + d < b.length && i < a.length; i += 3) s += a[i]! * b[i + d]!
    if (s > melhor) {
      melhor = s
      melhorAtraso = d
    }
  }
  return melhorAtraso
}

/**
 * Output SNR, measured in 10 ms windows.
 *
 * In each window, the voice component of the output is the projection of the
 * output onto the clean voice (aligned by lag `d`); the rest is noise PLUS
 * distortion. The metric is conservative: anything the chain damages in the
 * voice counts against it. Also returns the power of the voice component to
 * measure the level.
 */
export function snrDaSaida(
  limpa: Float32Array,
  saida: Float32Array,
  d: number,
  desde = 0,
): { snrDb: number; potenciaDaVoz: number } {
  const W = 480
  let pv = 0
  let pr = 0
  for (let i = desde; i + W + d <= saida.length && i + W <= limpa.length; i += W) {
    let sy = 0
    let ss = 0
    for (let k = 0; k < W; k++) {
      sy += limpa[i + k]! * saida[i + k + d]!
      ss += limpa[i + k]! * limpa[i + k]!
    }
    const a = ss > 1e-12 ? sy / ss : 0
    for (let k = 0; k < W; k++) {
      const v = a * limpa[i + k]!
      pv += v * v
      const e = saida[i + k + d]! - v
      pr += e * e
    }
  }
  return { snrDb: 10 * Math.log10(pv / pr), potenciaDaVoz: pv }
}

/** Power of the clean voice in the same window as `snrDaSaida`. */
export function potenciaNaJanela(limpa: Float32Array, comprimento: number, d: number, desde = 0): number {
  const W = 480
  let p = 0
  for (let i = desde; i + W + d <= comprimento && i + W <= limpa.length; i += W) {
    for (let k = 0; k < W; k++) p += limpa[i + k]! * limpa[i + k]!
  }
  return p
}

/** Radix-2 FFT in place (real and imaginary separate). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]!
      re[i] = re[j]!
      re[j] = tr
      const ti = im[i]!
      im[i] = im[j]!
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b]! * cr - im[b]! * ci
        const ti = re[b]! * ci + im[b]! * cr
        re[b] = re[a]! - tr
        im[b] = im[a]! - ti
        re[a] = re[a]! + tr
        im[a] = im[a]! + ti
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

/**
 * SNR by band: the same metric as `snrDaSaida`, but the projection runs on each
 * band (24 bands of increasing width) of each 21 ms frame.
 *
 * This is the fair measure for a suppressor: it cuts the bands where noise dominates
 * and leaves the rest, which is a change in voice equalization, not noise. The
 * wide metric (`snrDaSaida`) counts that as noise. Calibrated: with no processing,
 * both give the input SNR.
 */
export function snrPorBandas(limpa: Float32Array, saida: Float32Array, d: number, desde = 0): number {
  const N = 1024
  const salto = 512
  const janela = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))
  const limites: number[] = [1]
  for (let b = 1; b <= 24; b++) limites.push(Math.max(limites[b - 1]! + 1, Math.round(Math.pow(512, b / 24))))
  let pv = 0
  let pr = 0
  const sr = new Float64Array(N)
  const si = new Float64Array(N)
  const yr = new Float64Array(N)
  const yi = new Float64Array(N)
  for (let i = desde; i + N + d <= saida.length && i + N <= limpa.length; i += salto) {
    for (let k = 0; k < N; k++) {
      sr[k] = limpa[i + k]! * janela[k]!
      yr[k] = saida[i + k + d]! * janela[k]!
      si[k] = 0
      yi[k] = 0
    }
    fft(sr, si)
    fft(yr, yi)
    for (let b = 0; b < limites.length - 1; b++) {
      const de = limites[b]!
      const ate = Math.min(N / 2, limites[b + 1]!)
      let cruz = 0
      let ss = 0
      for (let k = de; k < ate; k++) {
        cruz += yr[k]! * sr[k]! + yi[k]! * si[k]!
        ss += sr[k]! * sr[k]! + si[k]! * si[k]!
      }
      const a = ss > 1e-12 ? cruz / ss : 0
      for (let k = de; k < ate; k++) {
        const vr = a * sr[k]!
        const vi = a * si[k]!
        pv += vr * vr + vi * vi
        pr += (yr[k]! - vr) ** 2 + (yi[k]! - vi) ** 2
      }
    }
  }
  return 10 * Math.log10(pv / pr)
}

/** The package's `gtcrn.wasm`, read from disk. */
export function binarioGtcrn(): Uint8Array<ArrayBuffer> {
  const exigir = createRequire(import.meta.url)
  const caminho = exigir.resolve("@sapphi-red/web-noise-suppressor/gtcrn.wasm")
  return new Uint8Array(readFileSync(caminho))
}
