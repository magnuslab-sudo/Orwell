# The Orwell mark

**The redacted O.** Stacked censor bars with the empty middle of an O, and one
bar slipped out of line. In the book, the bar hides what was written. Here, it
protects it.

## One source for every place

```bash
python3 marca/gerar-marca.py
```

It writes all of these. Do not edit them by hand:

| File | What it is |
|---|---|
| `packages/ui/src/marca.gen.ts` | the bars for the interface's `OrwellMark` |
| `apps/site/public/marca.<hash>.svg` and the same in `apps/web` | the browser favicon |
| the favicon `href` in the site pages, the app and `scripts/publicar-instaladores.mjs` | everything that points to it |
| the `<symbol id="i-marca">` in the site pages | the mark inside the pages |
| `apps/client/recursos/icone.svg` | the app icon, as a vector |
| `apps/client/recursos/icon.{png,icns,ico}` | the app icon, rasterised |
| `apps/client/src/main/icone.ts` | the four tray icons, in base64 |
| `apps/web/public/{icone-192,icone-512,icone-maskable-512,apple-touch-icon}.<hash>.png` | the PWA icons, and their names in `manifest.webmanifest` and the app's `index.html` |

Not generated: the `<span>rwell</span>` of the wordmark is real text, so it
follows the theme and font and screen readers read "Orwell".

Two partial runs avoid re-rasterising everything (two Chrome builds produce
different PNG bytes for the same drawing):

```bash
python3 marca/gerar-marca.py --favicon   # only the favicon and what points to it
python3 marca/gerar-marca.py --pwa       # only the PWA icons and what points to them
```

If you change the **geometry**, run the full generator. It is the only one that
rebuilds the `.icns`, the `.ico` and the tray icons.

## Why the favicon has a hash in its name

Chrome keeps favicons in its own database, keyed by the icon URL, and revisits
them only after days. `Cache-Control` does not reach it. A new drawing under
the same name never shows up for people who already visited. With the hash in
the name, a new drawing is a new URL. The generator deletes the old file and
rewrites the `href`s. A test in `apps/site/testes/pagina.test.ts` fails on an
`href` to a missing file, a name without a hash, or a hash that no longer
matches the content.

## Two optical variants

Seven bars when there is room, five when there is not: six gaps do not fit in
16 pixels. The threshold is `LIMIAR_MARCA_CHEIA` (40 px), and `OrwellMark`
picks the variant from its `size`. Below that size the app icon is the favicon.

## The 24-unit grid

Bars of 3 and gaps of 1.5. At 16 px that is exactly 2 px and 1 px, on pixel
boundaries. At 32 px, 4 and 2. That is why the favicon uses
`viewBox="0 0 24 24"`. Change `ALT`, `VAO` or the `viewBox` without redoing this
arithmetic and you get a blur.

## Three traps

1. **Chrome rasterises an SVG at its declared intrinsic size.** A 16x16 window
   on an SVG with `width="1024"` crops the top-left corner instead of scaling.
2. **A `*/` inside a block comment closes it.** The error then points at the
   last line of the file, not at the cause.
3. **The slipped bar has to fit in the box.** The drawing takes
   `2·A_EXT + DESLOCA`, and that whole width is what gets centred.
