import { defineConfig } from "vitest/config"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const aqui = dirname(fileURLToPath(import.meta.url))

/**
 * Suíte de integração da pasta de QA.
 *
 * De propósito NÃO carrega `kdf-de-teste.ts`. O Vitest do servidor troca o
 * Argon2id por uma derivação barata, porque quase nenhum daqueles testes mede
 * o custo de uma frase-passe. Aqui o cofre usa o KDF verdadeiro. Os outros
 * casos não abrem cofre, por isso não pagam esse custo.
 */
export default defineConfig({
  root: resolve(aqui, "../.."),
  test: {
    include: ["qa/integration/**/*.integracao.test.ts"],
    testTimeout: 40_000,
    hookTimeout: 60_000,
    fileParallelism: true,
  },
})
