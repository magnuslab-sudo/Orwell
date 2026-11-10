/**
 * The testbed: stand up the whole product and tear it down.
 *
 * The homeserver with the Phase 1 media engine and `vite` serving
 * `apps/web`, the product itself, not a page written for the proof. It stands
 * apart because two different measurements need the same setup, and a second
 * copy is a copy you can diverge from.
 */
import { spawn } from "node:child_process"
import { networkInterfaces } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const RAIZ = fileURLToPath(new URL("../..", import.meta.url))

/*
 * Own ports, not development ports.
 *
 * A dev server sleeping on the port of this proof would make it measure a
 * different database, with different stats, without anyone noticing. And the
 * reverse: this one wipes the database it uses, and wiping the one someone is
 * working with would be a bad day. The lesson is written in
 * `scripts/ambiente.mjs`, and it cost a whole session to figure out "the product
 * is broken".
 */
export const PORTA_SERVIDOR = 8462
export const PORTA_SFU = 44320
export const PORTA_WEB = 5199
export const SERVIDOR = `localhost:${PORTA_SERVIDOR}`
export const APP = `http://127.0.0.1:${PORTA_WEB}/app/?servidor=${SERVIDOR}`
export const FRASE = "prova-sfu-fase2"

/**
 * An address of this machine that a browser can actually reach.
 *
 * **It exists because of Firefox, and the reason is worth leaving written.** Firefox
 * does not gather ICE candidates from loopback: its candidates are mDNS `.local`
 * names of real interfaces, nothing else. Against an SFU that only announces
 * `127.0.0.1` there is no possible pair, ICE goes to `failed` on both transports,
 * and what you measure is zero packets, which reads as "Firefox does not send
 * voice" when what actually happened is the testbed gave it no address to grab.
 * Chromium and WebKit connect to loopback without complaining, which is why the
 * bug seemed to be in one engine only.
 *
 * Returns empty when there is none, and the caller MUST say so instead of
 * silently falling back to loopback, or you slip back into the same mistake
 * another way.
 */
export function enderecoEncaminhavel() {
  for (const entradas of Object.values(networkInterfaces())) {
    for (const entrada of entradas ?? []) {
      if (entrada.family === "IPv4" && !entrada.internal) return entrada.address
    }
  }
  return ""
}

const processos = []

/**
 * `detached: true`, and kill the GROUP not the child.
 *
 * `npx vite` is a wrapper: kill the `npx` and `vite` stays running, holding the
 * port, so the next run hits "Port 5199 is already in use", or worse, measures
 * against a server from another run. The same goes for the homeserver, which
 * has the mediasoup worker subprocess underneath: an orphaned worker is lost
 * memory on the machine forever.
 */
export function levantar(nome, comando, argumentos, ambiente, pasta = RAIZ) {
  const filho = spawn(comando, argumentos, {
    cwd: pasta,
    env: { ...process.env, ...ambiente },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })
  const registo = []
  filho.stdout.on("data", (bloco) => registo.push(String(bloco)))
  filho.stderr.on("data", (bloco) => registo.push(String(bloco)))
  processos.push({ nome, filho, registo })
  return { filho, registo }
}

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Wait for a port to answer, or give up and show the log. */
export async function esperarPor(url, registo, segundos = 40) {
  for (let volta = 0; volta < segundos * 4; volta++) {
    try {
      await fetch(url)
      return true
    } catch {
      await dormir(250)
    }
  }
  console.error(registo.join(""))
  return false
}

export function matarTudo() {
  for (const { filho } of processos.splice(0)) {
    try {
      // The minus sign is the whole group: the wrapper and what it spawned.
      process.kill(-filho.pid, "SIGKILL")
    } catch {
      // It is already dead. What matters is that nothing stays up.
    }
  }
}

process.on("exit", matarTudo)
process.on("SIGINT", () => {
  matarTudo()
  process.exit(130)
})

/**
 * The homeserver with, or without, a media engine. Zero is "no SFU".
 *
 * **`anunciarEm` is not comfort: it is what makes Firefox measurable.** By default
 * the SFU listens and announces `127.0.0.1`, and Chromium and WebKit connect to
 * loopback candidates without complaining. Firefox does NOT: it gathers no
 * loopback candidate, only mDNS `.local` names of real interfaces, and a call
 * against an SFU that only announces `127.0.0.1` gets `iceConnectionState:
 * "failed"` on both transports, zero packets sent and zero received.
 *
 * That is not a product bug and does not happen in production, where the SFU
 * announces a public IP. It was a TESTBED bug reading as a Firefox bug. With a
 * routable address, this machine's local network IP, the same product, on the
 * same engine, makes the same call as the other two.
 */
export async function levantarServidor(dados, { comSfu = true, anunciarEm = "" } = {}) {
  const servidor = levantar("homeserver", process.execPath, [join(RAIZ, "apps/server/dist/main.js")], {
    ENCLAVE_DATA_DIR: dados,
    ENCLAVE_SERVER_NAME: SERVIDOR,
    ENCLAVE_BIND_PORT: String(PORTA_SERVIDOR),
    ENCLAVE_COMMUNITY_MODE: "true",
    ENCLAVE_SFU_PORT: comSfu ? String(PORTA_SFU) : "0",
    /*
     * Listen on all interfaces only when announcing a dedicated address.
     * The server chooses `escutarEm` based on `bindHost`, and announcing a
     * network IP while listening on `127.0.0.1` would create candidates that
     * nobody answers, the worst of both worlds.
     */
    ...(anunciarEm ? { ENCLAVE_BIND_HOST: "0.0.0.0", ENCLAVE_SFU_ANNOUNCED_IP: anunciarEm } : {}),
  })
  return await esperarPor(`http://127.0.0.1:${PORTA_SERVIDOR}/_enclave/health`, servidor.registo)
}

/**
 * `vite` in the `@enclave/web` folder, not at the root.
 *
 * Its `vite.config.ts` declares `base: "/app/"`. Run from the root, vite serves
 * something else at `/` and `/app/` answers 404, which reads as "vite did not
 * come up".
 */
export async function levantarWeb() {
  const web = levantar("vite", "npx", ["vite", "--port", String(PORTA_WEB), "--strictPort"], {}, join(RAIZ, "apps/web"))
  return await esperarPor(APP, web.registo)
}
