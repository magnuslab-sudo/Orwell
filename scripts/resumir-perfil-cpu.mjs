// Summary of a .cpuprofile: own time and total time per function (local profiling).
import { readFileSync } from "node:fs"
const p = JSON.parse(readFileSync(process.argv[2], "utf8"))
const porId = new Map(p.nodes.map((n) => [n.id, n]))
const pai = new Map()
for (const n of p.nodes) for (const c of n.children ?? []) pai.set(c, n.id)
const dt = new Map()
for (let i = 0; i < p.samples.length; i++) dt.set(p.samples[i], (dt.get(p.samples[i]) ?? 0) + (p.timeDeltas[i] ?? 0))
const nome = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`
const proprio = new Map(), total = new Map()
for (const [id, us] of dt) {
  const n = porId.get(id)
  proprio.set(nome(n), (proprio.get(nome(n)) ?? 0) + us)
  const vistos = new Set()
  for (let c = id; c !== undefined; c = pai.get(c)) {
    const k = nome(porId.get(c))
    if (vistos.has(k)) continue
    vistos.add(k)
    total.set(k, (total.get(k) ?? 0) + us)
  }
}
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${(v / 1000).toFixed(0).padStart(7)} ms  ${k}`).join("\n")
console.log("PRÓPRIO\n" + top(proprio, Number(process.argv[3] ?? 25)))
console.log("\nTOTAL\n" + top(total, Number(process.argv[4] ?? 40)))
