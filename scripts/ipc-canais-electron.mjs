/**
 * The IPC channel bench of the installed application, run for real.
 *
 *   node scripts/ipc-canais-electron.mjs
 *
 * Builds the REAL `preload` (`apps/client/src/preload/index.ts`) and the bench (`apps/client/testes/bancada-ipc.ts`), opens a hidden window with the same conditions as the application, `sandbox`, `contextIsolation`, no Node in the renderer, and runs all 38 channel operations through, one by one.
 *
 * **It exists because `apps/client` had no IPC bench at all**, and it was in that absence that 37 channel operations stayed unhooked without anything complaining. The `vitest` suites measure each side against a double, and a double clones nothing, always has the method asked of it, and passes objects by reference. Three things the real boundary does not do.
 *
 * What only this answers:
 *
 *  - does `sendSync` work inside the sandbox? (the decision for reads rests on it, and if the answer were no, the installed application would be without rooms again, the same silent way);
 *  - do the channel names match between the two processes? (a swapped letter gives no compile error);
 *  - what does `structuredClone` do to what crosses?
 *
 * Does not touch production, does not open network, does not write outside `apps/client/out`.
 */
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const CLIENTE = join(RAIZ, "apps", "client")
const DESTINO = join(CLIENTE, "out", "bancada")

/**
 * Built with `esbuild` not `electron-vite`.
 *
 * The `electron-vite build` builds the entire application, the React tree, `@enclave/ui`, the core, and what you want here is the `preload` and the bench main process, nothing else. `esbuild` is at the root and does this in milliseconds; the build order is the same as `electron-vite` uses (CommonJS, `electron` external), because it is the only one the sandbox loads.
 */
function compilar(entrada, saida) {
  const feito = spawnSync(
    join(RAIZ, "node_modules", ".bin", "esbuild"),
    [
      entrada,
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--target=node22",
      "--external:electron",
      `--outfile=${saida}`,
    ],
    { encoding: "utf8" },
  )
  if (feito.status !== 0) {
    process.stderr.write(feito.stderr || "esbuild falhou sem dizer porquê\n")
    process.exit(1)
  }
}

rmSync(DESTINO, { recursive: true, force: true })
mkdirSync(DESTINO, { recursive: true })

// The real `preload`, not a copy of it: it is the one being measured.
compilar(join(CLIENTE, "src", "preload", "index.ts"), join(DESTINO, "preload.cjs"))
compilar(join(CLIENTE, "testes", "bancada-preload.ts"), join(DESTINO, "preload-bancada.cjs"))
compilar(join(CLIENTE, "testes", "bancada-ipc.ts"), join(DESTINO, "main.cjs"))

/**
 * With a timeout, and the timeout is part of the measurement.
 *
 * A synchronous read without a response freezes the renderer forever, that is
 * exactly the flaw the cloning proof exists to prevent, and it happens if
 * someone removes it. **Measured**: without `provarQueAtravessa`, this test
 * hangs instead of failing. A timeout turns that into a verdict.
 *
 * Kill the process group, not just the process, and that is the second thing
 * measurement taught: Electron spawns children (GPU, renderer, utilities) and
 * killing only the parent leaves them running, attached to the terminal of
 * whoever ran this. Hence the `detached` flag and the `-pid`.
 */
const PRAZO_MS = 120_000

const electron = spawn(join(RAIZ, "node_modules", ".bin", "electron"), [join(DESTINO, "main.cjs")], {
  stdio: "inherit",
  // No GPU noise: this is a measurement, not an app opening.
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
  detached: true,
})

let pendurada = false
const prazo = setTimeout(() => {
  pendurada = true
  try {
    process.kill(-electron.pid, "SIGKILL")
  } catch {
    // Already dead by then, which is the normal case.
  }
}, PRAZO_MS)

electron.on("exit", (codigo) => {
  clearTimeout(prazo)
  if (pendurada) {
    process.stderr.write(
      `\nA BANCADA FICOU PENDURADA ao fim de ${PRAZO_MS / 1000}s.\n` +
        "É o feitio de uma leitura síncrona sem resposta: o renderer fica à espera e não há erro em lado nenhum.\n" +
        "Suspeito número um: a prova de clonagem — `provarQueAtravessa`, em `apps/client/src/main/canais.ts`.\n",
    )
    process.exit(1)
  }
  process.exit(codigo ?? 1)
})
