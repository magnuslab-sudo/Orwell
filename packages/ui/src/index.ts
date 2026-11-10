// Source-only package: both hosts bundle it with Vite, so there is no build
// step and no duplicated React to reconcile.
export { App } from "./App.js"
// The screen of a channel member who is not the account owner. Only the web uses this: see
// `apps/web/src/posse-do-separador.ts`.
export { OutroSeparador } from "./screens/gate/OutroSeparador.js"
// The splash screen, which the web draws on startup before the gate decides: it matches what
// the gate shows next, with no jump between them.
export { Splash } from "./screens/gate/Splash.js"
// The invite with which the page opened: startup data only the web has.
export type { StartupInvite } from "./lib/conviteDeArranque.js"
// And the pairing link with which it opened: the phone joining an account.
export type { StartupPairing } from "./lib/emparelhamentoDeArranque.js"
// The short friend link (`/a#<id>`, 1.0): the web reads it on startup with the same rule
// the UI applies when pasting or reading the QR code.
export { eCaminhoDeAmigo, lerLigacaoDeAmigo } from "./lib/ligacaoDeAmigo.js"
export type {
  ConnectionState,
  DonationLink,
  EnclaveBridge,
  // The global shortcuts, which only the desktop host fills in.
  EstadoDosAtalhosGlobais,
  PedidoDeAtalhosGlobais,
  // Screen sharing, which only the desktop host fills in: it has the main process with
  // `desktopCapturer` on the other side of IPC.
  FonteDeEcra,
  PermissaoDeEcra,
  Profile,
} from "./bridge.js"
// The desktop host shows notifications better than the browser can, and registers here.
// See `lib/notifications.ts`.
export { registerSystemNoticeHost } from "./lib/notifications.js"
export { ehIos } from "./lib/plataforma.js"
// The "Update available" sound, for the "Reload" banner on the web, which lives outside
// the React tree (`apps/web/src/main.tsx`).
export { tocarSomDeActualizacao } from "./sons/motor.js"
export type { SystemNotice, SystemNoticeHost } from "./lib/notifications.js"
/*
  The language, detected by the HOST and not by this package.

  `arrancarLingua()` is the only place that looks at `navigator`, and it is called from
  outside: `apps/web/src/main.tsx` in the browser, `apps/client/src/renderer/main.tsx`
  in Electron, which has its own, better path, because the main process knows the OS
  language list and the renderer only knows the startup locale.

  Running detection on module load would also catch the jsdom from tests, where `navigator`
  says "en-US": 2728 assertions written against Portuguese text would start running against
  English. With no call, the language is the base.
*/
export {
  arrancarLingua,
  definirLingua,
  escolherLingua,
  linguaActual,
  LINGUA_BASE,
  LINGUAS,
  // The catalog itself, for text the host draws outside the React tree (the new version banner
  // on the web). It is a live link: the current language is read on each access, like inside
  // this package.
  strings,
} from "./strings.js"
export type { Lingua, PreferenciaDeLingua } from "./strings.js"
