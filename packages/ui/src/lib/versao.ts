import pacote from "../../package.json" with { type: "json" }

/**
 * This app version, for Help and diagnostics.
 *
 * Read from the `package.json` of this package at build time, not asked from
 * the bridge: the interface is the same in the browser and in the installed
 * app, and the number it shows is its own. The `package.json` files in the
 * monorepo inherit the version from the root, and there is a test that fails
 * if they diverge (`apps/site/testes/pagina.test.ts`).
 */
export const VERSAO_DA_APP: string = pacote.version
