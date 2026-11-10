#!/usr/bin/env node
/**
 * Orwell's third-party notices: `THIRD-PARTY-NOTICES.txt`.
 *
 * Orwell is AGPL-3.0-only (see `LICENSE` and `NOTICE`), and contains code from
 * others, and their licenses (MIT, ISC, BSD, Apache, OFL) almost all ask the
 * same: that the copyright notice and license text travel with each copy. This
 * script writes that file from `package-lock.json`, not by hand, because a
 * hand-written list gets stale on the first `npm install`.
 *
 * What goes in: the closure of production dependencies (dependencies,
 * optionalDependencies, and installed peerDependencies) of the three things
 * that come out: the web (`apps/web`), the desktop app (`apps/client`, plus
 * Electron, which goes in the installer), and the server (`apps/server`).
 * `@enclave/*` packages are ours: we traverse them but don't list them. Also
 * included: components not from the registry: the GTCRN model, the vendored
 * jsQR, and fonts.
 *
 * The result is deterministic (no date, alphabetical order) so the test
 * `apps/site/testes/terceiros.test.ts` can regenerate it in memory and fail if
 * the written file gets out of date.
 *
 * Writes two identical files: `THIRD-PARTY-NOTICES.txt` at the root (which
 * electron-builder puts in the installer via `extraResources`) and
 * `apps/site/public/terceiros.txt` (which the site serves at `/terceiros.txt`).
 *
 *   node scripts/gerar-avisos-de-terceiros.mjs           write
 *   node scripts/gerar-avisos-de-terceiros.mjs --check   check only (exit 1 if different)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
export const DESTINOS = ["THIRD-PARTY-NOTICES.txt", "apps/site/public/terceiros.txt"]

const PRODUTOS = [
  { caminho: "apps/web", rotulo: "web" },
  { caminho: "apps/client", rotulo: "desktop app" },
  { caminho: "apps/server", rotulo: "server" },
]

/** What goes in the installer that isn't a production dependency: Electron itself. */
const EXTRA_NA_APP = ["electron"]

const FICHEIRO_DE_LICENCA = /^(licen[cs]e|copying|notice)(\b|[-._]|$)/i

function lerLock(raiz) {
  return JSON.parse(readFileSync(join(raiz, "package-lock.json"), "utf8")).packages
}

/** Node's resolution: from `de` upwards to the root `node_modules`. */
function resolver(pacotes, de, nome) {
  let base = de
  for (;;) {
    const candidato = base === "" ? `node_modules/${nome}` : `${base}/node_modules/${nome}`
    if (pacotes[candidato]) return candidato
    if (base === "") return null
    const i = base.lastIndexOf("/node_modules/")
    base = i === -1 ? "" : base.slice(0, i)
  }
}

function seguirLigacao(pacotes, chave) {
  const entrada = pacotes[chave]
  return entrada?.link ? entrada.resolved : chave
}

function fecho(pacotes, inicio, encontrados, rotulo) {
  const pilha = [inicio]
  const vistos = new Set()
  while (pilha.length > 0) {
    const chave = pilha.pop()
    if (vistos.has(chave)) continue
    vistos.add(chave)
    const entrada = pacotes[chave]
    if (!entrada) continue
    const nome = entrada.name ?? chave.slice(chave.lastIndexOf("node_modules/") + "node_modules/".length)
    const nosso = !chave.includes("node_modules/") || nome.startsWith("@enclave/")
    if (!nosso) {
      const id = `${nome}@${entrada.version}`
      const registo = encontrados.get(id) ?? { nome, versao: entrada.version, licenca: entrada.license, chave, onde: new Set() }
      registo.onde.add(rotulo)
      encontrados.set(id, registo)
    }
    const peerOpcional = entrada.peerDependenciesMeta ?? {}
    const nomes = [
      ...Object.keys(entrada.dependencies ?? {}),
      ...Object.keys(entrada.optionalDependencies ?? {}),
      ...Object.keys(entrada.peerDependencies ?? {}).filter((n) => !peerOpcional[n]?.optional),
    ]
    for (const dep of nomes) {
      const alvo = resolver(pacotes, chave, dep)
      if (alvo) pilha.push(seguirLigacao(pacotes, alvo))
    }
  }
}

function textoDaLicenca(raiz, registo) {
  const pasta = join(raiz, registo.chave)
  const ficheiros = existsSync(pasta)
    ? readdirSync(pasta).filter((f) => FICHEIRO_DE_LICENCA.test(f)).sort()
    : []
  if (ficheiros.length === 0) {
    const id = registo.licenca ?? "UNKNOWN"
    return `The package ships no licence file. Licence by SPDX identifier: ${id} (https://spdx.org/licenses/${id}.html).`
  }
  return ficheiros
    .map((f) => readFileSync(join(pasta, f), "utf8").replace(/\r\n?/g, "\n").trim())
    .join("\n\n")
}

const MIT = (direitos) => `MIT License

${direitos}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

function componentesForaDoRegisto(raiz) {
  const fonte = (f) => readFileSync(join(raiz, "packages/ui/src/fontes", f), "utf8").replace(/\r\n?/g, "\n").trim()
  return [
    {
      titulo: "GTCRN speech enhancement model (gtcrn.wasm, via @sapphi-red/web-noise-suppressor)",
      licenca: "MIT",
      onde: "web, desktop app",
      texto: MIT("Copyright (c) 2024 Rong Xiaobin") + "\n\nSource: https://github.com/Xiaobin-Rong/gtcrn",
    },
    {
      titulo: "jsQR 1.4.0 (vendored in packages/ui/src/vendor/jsQR.ts)",
      licenca: "MIT",
      onde: "web, desktop app",
      texto: MIT("Copyright (c) 2016 Cosmo Wolfe"),
    },
    {
      titulo: "Space Grotesk (font)",
      licenca: "OFL-1.1",
      onde: "web, desktop app, site",
      texto: fonte("OFL-SpaceGrotesk.txt"),
    },
    {
      titulo: "Noto Sans JP (font)",
      licenca: "OFL-1.1",
      onde: "web, desktop app",
      texto: fonte("OFL-NotoSansJP.txt"),
    },
  ]
}

const LINHA = "=".repeat(78)

/** The entire file text. Raw: reads only the lock, `node_modules`, and sources. */
export function gerarAvisos(raiz = RAIZ) {
  const pacotes = lerLock(raiz)
  const encontrados = new Map()
  for (const { caminho, rotulo } of PRODUTOS) fecho(pacotes, caminho, encontrados, rotulo)
  for (const nome of EXTRA_NA_APP) {
    // The package itself: `electron`'s dependencies in the registry exist to download the binary at install time and do not go into the installer.
    const chave = resolver(pacotes, "apps/client", nome)
    const entrada = chave && pacotes[chave]
    if (entrada) {
      const id = `${nome}@${entrada.version}`
      const registo = encontrados.get(id) ?? { nome, versao: entrada.version, licenca: entrada.license, chave, onde: new Set() }
      registo.onde.add("desktop app")
      encontrados.set(id, registo)
    }
  }
  const lista = [...encontrados.values()].sort((a, b) =>
    a.nome === b.nome ? a.versao.localeCompare(b.versao) : a.nome < b.nome ? -1 : 1,
  )
  const partes = [
    "Orwell: third-party notices / avisos de terceiros",
    "",
    "Orwell: Copyright (c) 2026 Duarte Bivar. Licensed under the GNU AGPL, version 3 only (see LICENSE).",
    "Orwell: Copyright (c) 2026 Duarte Bivar. Licenciado pela GNU AGPL, só a versão 3 (ver LICENSE).",
    "",
    "The components below are the work of other people and keep their own licences.",
    "Os componentes abaixo são obra de outras pessoas e mantêm as suas licenças.",
    "",
    "The desktop app also ships Electron's Chromium notices in LICENSES.chromium.html,",
    "next to the program.",
    "",
    "Generated by scripts/gerar-avisos-de-terceiros.mjs from package-lock.json. Do not edit by hand.",
    `${lista.length + componentesForaDoRegisto(raiz).length} components.`,
  ]
  for (const r of lista) {
    partes.push(
      "",
      LINHA,
      `${r.nome} ${r.versao}`,
      `Licence: ${r.licenca ?? "UNKNOWN"}`,
      `Used in: ${[...r.onde].sort().join(", ")}`,
      LINHA,
      "",
      textoDaLicenca(raiz, r),
    )
  }
  for (const c of componentesForaDoRegisto(raiz)) {
    partes.push("", LINHA, c.titulo, `Licence: ${c.licenca}`, `Used in: ${c.onde}`, LINHA, "", c.texto)
  }
  return partes.join("\n") + "\n"
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const texto = gerarAvisos()
  if (process.argv.includes("--check")) {
    const velhos = DESTINOS.filter((d) => !existsSync(join(RAIZ, d)) || readFileSync(join(RAIZ, d), "utf8") !== texto)
    if (velhos.length > 0) {
      console.error(`Desactualizado: ${velhos.join(", ")}. Corre node scripts/gerar-avisos-de-terceiros.mjs`)
      process.exit(1)
    }
    console.log("Avisos de terceiros em dia.")
  } else {
    for (const d of DESTINOS) writeFileSync(join(RAIZ, d), texto)
    console.log(`Gravado: ${DESTINOS.join(", ")} (${texto.length} bytes).`)
  }
}
