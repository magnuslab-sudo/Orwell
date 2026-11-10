/**
 * The scenario where the swarm runs: one homeserver and one file server, both
 * on ephemeral ports, both ours, both thrown away at the end.
 *
 * WHY THE PORTS ARE EPHEMERAL. Fixed ports are the most expensive trap in this
 * codebase: 8448 is what `dev:server` uses, 8449 is what `gateway.test.ts`
 * uses, and 8452 is what `dev-reiniciar-servidor.sh` uses. With three agents
 * and an audit running at the same time, picking a number is picking from whom
 * to steal the server: and the symptom is not an error, it is an entire suite
 * measuring someone else's state. Ask the system for a port and use whatever it
 * gives back.
 *
 * WHY IT NEVER POINTS TO PRODUCTION. There is not even a `--url`: this script
 * writes, deletes, ejects and reloads hundreds of times. On August 6th a load
 * run against production deleted the foundation log the owner had just
 * published. The target is always a server that is born with the run and dies
 * with it.
 */
import { spawn } from "node:child_process"
import { createServer as criarHttp } from "node:http"
import { createServer as criarSocket } from "node:net"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
import { comLingua } from "../ambiente.mjs"

/** A port that the system guarantees is free at this instant. */
export function portaLivre() {
  return new Promise((resolver, rejeitar) => {
    const socket = criarSocket()
    socket.on("error", rejeitar)
    socket.listen(0, "127.0.0.1", () => {
      const { port } = socket.address()
      socket.close(() => resolver(port))
    })
  })
}

/**
 * The homeserver for the run.
 *
 * `ENCLAVE_COMMUNITY_MODE` and `ENCLAVE_COMMON_ROOM` turned on on purpose: it is
 * the setup for a small house, which is where the application lives, and it is
 * the one that makes new accounts land in the same place without anyone
 * inviting anyone else.
 *
 * Readiness is read from the process stdout, not from a clock: the `listening`
 * line is only written after `listen` resolves. Waiting five seconds and
 * assuming gave runs where the first bots knocked on the door of a server that
 * did not exist yet, and the report read as a bug.
 */
export async function arrancarHomeserver({ raiz, dirDados, porta }) {
  const nome = `localhost:${porta}`
  const processo = spawn(process.execPath, ["--no-warnings=ExperimentalWarning", join(raiz, "apps/server/dist/main.js")], {
    env: {
      ...process.env,
      ENCLAVE_DATA_DIR: dirDados,
      ENCLAVE_DB_PATH: join(dirDados, "enclave.sqlite"),
      ENCLAVE_SERVER_NAME: nome,
      ENCLAVE_BIND_PORT: String(porta),
      ENCLAVE_BIND_HOST: "127.0.0.1",
      ENCLAVE_COMMON_ROOM: `!orwell:${nome}`,
      ENCLAVE_COMMUNITY_MODE: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  const registo = []
  const guardar = (fonte) => (bloco) => {
    for (const linha of String(bloco).split("\n")) if (linha.trim()) registo.push(`[${fonte}] ${linha}`)
    // The server log is proof: it cannot grow without limit on a long run.
    if (registo.length > 4000) registo.splice(0, registo.length - 4000)
  }
  processo.stdout.on("data", guardar("saída"))
  processo.stderr.on("data", guardar("erro"))

  await new Promise((resolver, rejeitar) => {
    const limite = setTimeout(() => rejeitar(new Error(`o homeserver não arrancou em 30 s:\n${registo.join("\n")}`)), 30_000)
    const observar = (bloco) => {
      if (!String(bloco).includes("listening")) return
      clearTimeout(limite)
      processo.stdout.off("data", observar)
      resolver()
    }
    processo.stdout.on("data", observar)
    processo.once("exit", (codigo) => {
      clearTimeout(limite)
      rejeitar(new Error(`o homeserver morreu ao arrancar (código ${codigo}):\n${registo.join("\n")}`))
    })
  })

  return {
    porta,
    nome,
    registo,
    parar: () =>
      new Promise((resolver) => {
        if (processo.exitCode !== null) return resolver()
        processo.once("exit", () => resolver())
        // Only this process, which is ours: there are other agents' servers running,
        // and a careless `pkill node` takes down three people's work.
        processo.kill("SIGTERM")
        setTimeout(() => processo.kill("SIGKILL"), 5000).unref?.()
      }),
  }
}

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
}

/**
 * The built application, served from an ephemeral port.
 *
 * We serve the `dist` instead of starting `vite dev` for two reasons, and both
 * have cost time: vite is stuck at 5173 with `strictPort`, so two runs at the
 * same time kill each other; and `dev` measures what is in the source with a
 * transform in the middle, while `dist` is exactly what a browser will fetch in
 * production. The `dist` can be stale: the script checks its age against the
 * source before running and says so.
 */
export async function servirAplicacao({ raiz, porta }) {
  const base = join(raiz, "apps/web/dist")
  if (!existsSync(join(base, "index.html"))) {
    throw new Error(`não há aplicação construída em ${base}. Corre: npm run build -w @enclave/web`)
  }

  const servidor = criarHttp(async (pedido, resposta) => {
    /*
      The `/app/` at the front, which is where the application moved.
      
      The homepage went to the domain root and the client changed to
      `base: "/app/"`, so the built `index.html` asks for
      `/app/assets/index-….js`. This server served `dist` at the root, did not
      find that path, and fell back to `index.html`: the browser got HTML with
      `content-type: text/html` in place of the bundle, and the application
      never started. The symptom was a 60-second `waitFor` waiting for the
      account creation screen, and it caught all scripts with bots at once.
      */
    const pedido_ = decodeURIComponent((pedido.url ?? "/").split("?")[0])
    const caminho = pedido_.startsWith("/app/") ? pedido_.slice("/app".length) : pedido_
    // Without this, a `GET /../../.env` would serve the test server's private key.
    const relativo = normalize(caminho).replace(/^(\.\.[/\\])+/, "")
    let ficheiro = join(base, relativo)
    if (!ficheiro.startsWith(base) || !existsSync(ficheiro) || ficheiro.endsWith("/")) ficheiro = join(base, "index.html")
    try {
      const corpo = await readFile(ficheiro)
      resposta.writeHead(200, {
        "content-type": TIPOS[extname(ficheiro)] ?? "application/octet-stream",
        // Each bot opens the application several times per run; without cache, a
        // ten bot run would re-read 8 MB of bundle on every reload.
        "cache-control": "public, max-age=60",
      })
      resposta.end(corpo)
    } catch (erro) {
      resposta.writeHead(500).end(String(erro))
    }
  })

  await new Promise((resolver) => servidor.listen(porta, "127.0.0.1", resolver))
  return {
    /*
      With the `/app/`, like in production: `IndexedDB` is by ORIGIN not by
      path, but the bundle is not: and the bundle is what matters here.

      And with the LANGUAGE asked for, which was missing here. On August 20th
      the interface started choosing the language from `navigator.languages`,
      and Playwright's Chromium starts in English: `criarConta` looks for
      `getByPlaceholder("Como queres aparecer")`, which does not exist on an
      English screen. The symptom is not "the language is wrong": it is **all
      bots failing startup after sixty seconds**, with the report declaring the
      run invalid and measuring no invariant. Measured: 5 bots, 5 failures, zero
      checks.

      `comLingua` is the same piece that other scripts have used since then (see
      `ambiente.mjs`); the swarm was born with the address written by hand and
      stayed out of the fix.
    */
    url: comLingua(`http://127.0.0.1:${porta}/app/`),
    parar: () => new Promise((resolver) => servidor.close(() => resolver())),
  }
}
