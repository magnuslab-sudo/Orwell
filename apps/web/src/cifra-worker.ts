import { servirCifraDeMedia, type EscopoDoWorker } from "@enclave/client-core/cifra-worker"

/**
 * The worker where media encryption runs, in the web app.
 *
 * Three lines, and that is what it needs to be: all the cryptography is in `@enclave/client-core`,
 * and a second copy of it here would be a second copy to diverge. What this file brings that the
 * core cannot bring is EXISTENCE: a worker comes from a file that the bundler knows, and whoever
 * knows the bundler is the app.
 *
 * It imports from `@enclave/client-core/cifra-worker` and not from the package root on purpose,  * from here only the cipher comes, not the session or the vault, which have nothing to do in another
 * thread and would drag the whole bundle into it.
 *
 * It is this file that puts Firefox and Safari inside the SFU: neither has `createEncodedStreams`,
 * both have `RTCRtpScriptTransform`, and `RTCRtpScriptTransform` runs here.
 */
servirCifraDeMedia(self as unknown as EscopoDoWorker)
