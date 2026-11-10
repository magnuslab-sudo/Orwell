/**
 * The month's traffic on the VPS, against the provider's monthly quota.
 *
 * READ ONLY. Runs `vnstat --json m` on the VPS over SSH and writes nothing
 * anywhere, not there or here. `vnstat` started running on the VPS on November 3,
 * 2026, and it counts the interface bytes, surviving reboots.
 *
 * Why it exists: the VPS output is 300 to 745 Mbit/s, and the long-term limit is
 * now the MONTHLY TRAFFIC QUOTA (8 TB by default), not the bandwidth. A 50-person
 * call with four cameras burns ~130 GB per hour. See `docs/planos/limites-media-relatorio.md`.
 *
 * Usage:
 *   node scripts/trafego-do-mes.mjs                 # reads the VPS over SSH
 *   node scripts/trafego-do-mes.mjs --quota=8       # quota in TB (10^12 B)
 *   node scripts/trafego-do-mes.mjs --conta=tx      # output only (default: total)
 *   node scripts/trafego-do-mes.mjs --ficheiro=x.json   # reads a JSON already retrieved
 *   node scripts/trafego-do-mes.mjs --json          # one JSON line, for the monitor
 *
 * The SSH target comes from the environment: `ORWELL_SSH` (user@host, required)
 * and `ORWELL_SSH_KEY` (optional).
 *
 * Exit code: 0 below 70%, 1 from 70% (warning), 2 from 90% (alert), 3 if read
 * failed. That is what the `infra-alerts` monitor reads.
 *
 * `--conta=total` by default (inbound plus outbound), because it is the tighter
 * of the two and the provider does not say which one counts. When they do, change
 * the default and document where it came from here.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

export const QUOTA_POR_OMISSAO_TB = 8
export const AVISO = 0.7
export const ALERTA = 0.9

/**
 * The current month from a `vnstat --json m` response, in bytes.
 *
 * `jsonversion` 1 (vnstat 1.x) counts in KiB, and 2 (vnstat 2.x) in bytes.
 * Read both, so the script does not lie by a factor of 1024 if the package
 * changes.
 */
export function mesCorrente(json, { interface: nome, agora = new Date() } = {}) {
  const factor = String(json.jsonversion) === "1" ? 1024 : 1
  const interfaces = json.interfaces ?? []
  const iface = nome ? interfaces.find((i) => (i.name ?? i.id) === nome) : interfaces[0]
  if (!iface) throw new Error(`o vnstat não tem a interface ${nome ?? "(nenhuma)"}`)
  const meses = iface.traffic?.month ?? iface.traffic?.months ?? []
  const ano = agora.getUTCFullYear()
  const mes = agora.getUTCMonth() + 1
  const deste = meses.find((m) => m.date?.year === ano && m.date?.month === mes)
  return {
    interface: iface.name ?? iface.id,
    rx: (deste?.rx ?? 0) * factor,
    tx: (deste?.tx ?? 0) * factor,
  }
}

/** The month's state against quota, with projection to end of month. */
export function avaliar({ rx, tx }, { quotaTB = QUOTA_POR_OMISSAO_TB, conta = "total", agora = new Date() } = {}) {
  const usado = conta === "tx" ? tx : rx + tx
  const quota = quotaTB * 1e12
  const fracao = usado / quota
  const inicio = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)
  const fim = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + 1, 1)
  const decorrido = Math.max((agora.getTime() - inicio) / (fim - inicio), 1e-6)
  const projeccao = fracao / decorrido
  const nivel = fracao >= ALERTA ? "alerta" : fracao >= AVISO ? "aviso" : "ok"
  return { usado, quota, fracao, projeccao, nivel, conta }
}

const TB = (b) => (b / 1e12).toFixed(2).replace(".", ",")
const PCT = (f) => `${Math.round(f * 100)} %`

export function frase(r) {
  const base = `Tráfego do mês (${r.conta}): ${TB(r.usado)} TB de ${TB(r.quota)} TB, ${PCT(r.fracao)}. Ao ritmo actual, o mês acaba em ${PCT(r.projeccao)}.`
  if (r.nivel === "alerta") return `ALERTA: ${base} Acima de 90 %: o fornecedor pode cortar ou abrandar o VPS.`
  if (r.nivel === "aviso") return `AVISO: ${base} Acima de 70 %.`
  return base
}

function principal() {
  const arg = (nome) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.split("=").slice(1).join("=")
  const quotaTB = Number(arg("quota") ?? QUOTA_POR_OMISSAO_TB)
  const conta = arg("conta") ?? "total"
  if (!(quotaTB > 0) || !["total", "tx"].includes(conta)) {
    console.error("uso: --quota=<TB maior que zero> --conta=total|tx")
    process.exit(3)
  }

  let json
  try {
    const ficheiro = arg("ficheiro")
    if (ficheiro) json = JSON.parse(readFileSync(ficheiro, "utf8"))
    else {
      const vps = process.env.ORWELL_SSH
      if (!vps) throw new Error("falta ORWELL_SSH (utilizador@anfitriao)")
      const chave = process.env.ORWELL_SSH_KEY ? ["-i", process.env.ORWELL_SSH_KEY] : []
      const saida = execFileSync(
        "ssh",
        [...chave, "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", vps, "vnstat --json m"],
        { encoding: "utf8", timeout: 30_000 },
      )
      json = JSON.parse(saida)
    }
  } catch (erro) {
    console.error(`não consegui ler o vnstat: ${erro.message.split("\n")[0]}`)
    process.exit(3)
  }

  const mes = mesCorrente(json, { interface: arg("interface") })
  const r = avaliar(mes, { quotaTB, conta })
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ ...r, interface: mes.interface, rx: mes.rx, tx: mes.tx, frase: frase(r) }))
  } else {
    console.log(frase(r))
    console.log(`  interface ${mes.interface}: entrada ${TB(mes.rx)} TB, saída ${TB(mes.tx)} TB`)
  }
  process.exit(r.nivel === "alerta" ? 2 : r.nivel === "aviso" ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) principal()
