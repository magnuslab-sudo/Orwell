import { servirCifraDeMedia, type EscopoDoWorker } from "@enclave/client-core/cifra-worker"

/**
 * The worker where media encryption runs, in the installed app.
 *
 * Twin of `apps/web/src/cifra-worker.ts`, and that is the intent: encryption is all
 * in `@enclave/client-core`, and what each host brings is the EXISTENCE of the worker
 *, a worker comes from a file that the bundler must know about, and whoever knows
 * the bundler is the app. Here it is `electron-vite` playing the role of `vite`.
 *
 * **Why it exists when this engine has insertable streams.** It does, today: measured
 * on Electron 43.2.0 (Chromium 150.0.7871.129), `createEncodedStreams` is on both
 * prototypes, and so `caminhoDaCifra` keeps choosing `insertable`, this file is not
 * called. It exists because the alternative was the ONLY path of the installed app
 * being a non-standard API: the day Chromium removes it, this app falls to mesh on
 * its own, in silence, while browsers stay on SFU, and a mesh client and an SFU
 * client in the same room do not see each other (see `call-sfu-oferta-de-malha`). A
 * file of three lines is what keeps that from happening.
 *
 * Imports from `@enclave/client-core/cifra-worker` not from the root of the package
 * for the same reason as the twin: from here only encryption comes, not the session
 * or vault, which in this app don't even live in this process.
 */
servirCifraDeMedia(self as unknown as EscopoDoWorker)
