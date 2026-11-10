/**
 * Verify the official seal geometry outside React.
 *
 * The seal drawing is trigonometry, and trigonometry gets verified with numbers
 * before trusting the eye. This prints the `d` that the component will generate
 * and checks the invariants: all meeting points are equidistant from the center,
 * and nothing extends beyond the 24 box.
 */

const LOBOS = 12
const RAIO = 11
const RAZAO = 0.34
const C = 12

const rb = (RAIO * RAZAO) / (1 + RAZAO)
const rc = RAIO - rb
const passo = (Math.PI * 2) / LOBOS
const h = rc * Math.sin(passo / 2)
const rk = rc * Math.cos(passo / 2) + Math.sqrt(rb * rb - h * h)

console.log({
  rb: rb.toFixed(4),
  rc: rc.toFixed(4),
  h: h.toFixed(4),
  rk: rk.toFixed(4),
  profundidade: `${(((RAIO - rk) / RAIO) * 100).toFixed(1)}%`,
})

const encontro = (i) => {
  const a = (i + 0.5) * passo
  return [C + rk * Math.cos(a), C + rk * Math.sin(a)]
}
const n = (v) => Math.round(v * 100) / 100

let d = `M${n(encontro(LOBOS - 1)[0])} ${n(encontro(LOBOS - 1)[1])}`
for (let i = 0; i < LOBOS; i++) {
  d += `A${n(rb)} ${n(rb)} 0 0 1 ${n(encontro(i)[0])} ${n(encontro(i)[1])}`
}
d += "Z"

console.log(d)
console.log("comprimento", d.length)

for (let i = 0; i < LOBOS; i++) {
  const [x, y] = encontro(i)
  const r = Math.hypot(x - C, y - C)
  if (Math.abs(r - rk) > 1e-9) throw new Error("ponto de encontro fora do raio")
  if (x < 0 || x > 24 || y < 0 || y > 24) throw new Error("ponto fora da caixa")
}
console.log("ponta do lobo", C + RAIO, "· encontro", (C + rk).toFixed(3))
