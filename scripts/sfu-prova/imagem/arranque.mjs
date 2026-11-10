/** Start a worker and report if it succeeded. That is all the image needs to do. */
import * as mediasoup from "mediasoup"

try {
  const worker = await mediasoup.createWorker({ logLevel: "warn" })
  await worker.createRouter({ mediaCodecs: [{ kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 }] })
  console.log(`OK worker pid=${worker.pid} binário=${process.env.MEDIASOUP_WORKER_BIN}`)
  worker.close()
  process.exit(0)
} catch (erro) {
  console.log(`FALHOU ${erro?.message ?? erro}`)
  process.exit(1)
}
