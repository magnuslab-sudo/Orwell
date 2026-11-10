# Contributing to Orwell

Thank you for wanting to help. I review every change myself, so a small, clear
change is the easiest to review and the most likely to get in.

For a security problem, do not open an issue or a pull request. Follow
[`SECURITY.md`](SECURITY.md) instead.

## Contributor agreement

Before I can merge your first pull request, you need to agree to the
[CLA](CLA.md). In short: you keep your copyright, and I can ship your code
under the AGPL and under the commercial licence that helps fund the project.

To agree, do one of these in your pull request:

- write `I agree to the CLA in CLA.md.` in the description;
- or add your name, GitHub username and the date to
  [`CLA-SIGNATURES.md`](CLA-SIGNATURES.md).

Once is enough. It covers everything you send after that. No bots, no
external sites.

## Set up

You need Node.js 22 or later and npm.

```bash
npm install        # also applies the patches in patches/
npm run build
```

Run a local server and a client:

```bash
npm run server     # homeserver on :8448
npm run dev:web    # browser app on http://127.0.0.1:5173
npm run dev:client # desktop app
```

## Run the tests

All the unit suites, package by package:

```bash
npm test
```

It runs every package even when one fails, and lists the failing ones at the
end. To run a single package:

```bash
npx vitest run --root packages/crypto       # MLS, SFrame, attachments
npx vitest run --root apps/server           # gateway, federation, storage, SFU
npx vitest run --root packages/ui           # the interface
```

The other roots are `packages/protocol`, `packages/client-core`, `apps/web`,
`apps/client` and `apps/site`.

The end-to-end tests drive real clients against a real local server. Nothing in
them is mocked. They need a build, and most need Playwright's browsers:

```bash
npx playwright install
npm run build

npm run server &                         # the next one talks to this server
npm run e2e                              # two clients, real MLS, real gateway

node scripts/e2e-tres-browsers.mjs       # one account in Chromium, Firefox and WebKit
```

Every `scripts/e2e-*.mjs` file says at the top what it proves and how to run it.
Many start their own throwaway server on 127.0.0.1
(`scripts/servidor-descartavel.mjs`); the others say which local server they
expect. None of them is meant to run against production.

## Send a change

1. Open an issue first for anything bigger than a small fix.
2. Keep the change to what it says it does.
3. Add a test that fails without your change and passes with it.
4. Run `npm run typecheck` and `npm test`, plus the end-to-end test closest to
   what you touched.
5. Open a pull request that says what changed, why, and how you checked it,
   and that you agree to the CLA.

## House rules

- **Interface text in two languages.** Every string a person sees exists in
  Portuguese (Portugal) and in English, in `packages/ui/src/linguas/pt.ts` and
  `packages/ui/src/linguas/en.ts`. A test fails when one is missing. The same
  goes for the site in `apps/site/`.
- **Straight quotes** ("like this") in any text a person sees, never angle
  quotes. A test checks this too.
- **Release notes in English**, in `docs/novidades.json`. After you edit it, run
  `node scripts/gerar-novidades.mjs` and commit the generated files.
- **Error codes are never reused.** An error on screen shows a number and a short
  sentence. The numbers live in `packages/ui/src/lib/codigosDeErro.ts`. When an
  error goes away, its number stays retired.
- **If the server learns something new, say so.** Any change that lets the
  server see or store something it did not before must update
  [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) in the same pull request.
- **Code comments** are in English. Write yours in English. Many identifiers
  are still in Portuguese; keep the names that are already there. Documentation
  is in English.

## Contact

Questions that do not fit an issue: **orwell.eu@proton.me**.
