/**
 * The language in the `<html lang>`, before the first frame.
 *
 * The `index.html` brings the splash already written, with "Opening..." in all languages,
 * each one in a `<span lang>`; the stylesheet the plugin writes next to it shows only the
 * one for the page language. This script is classic and synchronous, in the `<head>`, so the
 * page knows its language when the browser reaches the `<body>`. Without it the
 * `<html lang>` would only change in `main.tsx`, two megabytes later, and anyone with the
 * browser set to English would see "A abrir..." change to "Opening..." halfway through startup.
 *
 * The rule is the same as `arrancarLingua` in `main.tsx`, the same function: the two
 * cannot disagree. It stays small because `escolha-da-lingua.ts` imports nothing. Built
 * separately, in an IIFE, by `apps/web/abertura-no-html.ts`.
 */
import { detectarLingua } from "../../../packages/ui/src/escolha-da-lingua.js"

document.documentElement.lang = detectarLingua()
