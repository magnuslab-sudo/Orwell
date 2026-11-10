/**
 * Does `RTCRtpScriptTransform` really move ENCRYPTED frames on all three engines?
 *
 * `scripts/sfu-cifra-por-motor.mjs` measured that the API EXISTS on all three
 * (`typeof RTCRtpScriptTransform === "function"`). Existing is not working, and it
 * is exactly that distinction, "it is in the compatibility table" versus "it
 * passed a frame", that let `createEncodedStreams` enter the plan without anyone
 * running it outside Chromium. This script closes that gap before writing a line
 * of product.
 *
 *   node scripts/sfu-script-transform-por-motor.mjs
 *
 * **What counts is what OPENED on the other side, not what arrived.** Arriving
 * proves transport; opening with the AES-GCM tag closed proves transport, key and
 * integrity at once. It is the benchmark of the Phase 2 and 3 tests, and it is the
 * only thing that tells media passing from bytes passing.
 *
 * **Three modes, and the third gives value to the other two:**
 *
 *   loose          neither encrypts nor decrypts: just counts and passes through.
 *                  Answers "is the transform even called on this engine?", which
 *                  is another question than "does the cipher work", and both give
 *                  the same zero when you only measure one.
 *   encrypted      the same key on both sides. It is the claim.
 *   key-swapped    the receiver tries with a DIFFERENT key. It must open ZERO and
 *                  fail all. Without this half, a counter that went up by mistake
 *                  would read as proof; with it, the green from `encrypted` mode
 *                  can only come from real cryptography.
 *
 * **And the CODEC is forced, never chosen by the engine.** It was the variable
 * left unfixed, and for a day we measured the wrong thing because of it: left to
 * choose, WebKit offers H.264 first and negotiates H.264, while the SFU router in
 * the product serves `video/VP8` and only that (`apps/server/src/media.ts`). The
 * test bench measured a codec the product never uses, and the conclusion from it,  * "encrypted video does not cross WebKit", gave to the ENGINE what was the CODEC.
 * See the `INCOMPATIVEIS` note at the end, which now names the right mechanism. A
 * test bench that lets the engine choose a variable is not measuring it: it is
 * being measured by it.
 *
 * Does not talk to any server, does not open any microphone (the signal comes from
 * an oscillator) and does not touch the product.
 */
import { chromium, firefox, webkit } from "playwright"

/**
 * The test worker, as text, goes into a `Blob`.
 *
 * Classic and not a module, on purpose: what we measure here is the
 * `RTCRtpScriptTransform`, and a `type: "module"` in a `blob:` worker would put a
 * second support variable inside the same measurement. The product uses a real
 * module, served by the host packager.
 */
const WORKER = `
const CABECALHO = 11
const chaves = {}
const contagens = {
  emissor: { entrada: 0, saida: 0 },
  receptor: { entrada: 0, saida: 0, falhados: 0, semCabecalho: 0 },
}
const mensagens = []

self.onmessage = async (evento) => {
  const dados = evento.data || {}
  mensagens.push(dados.tipo || "sem-tipo")
  if (dados.tipo === "chave") {
    chaves[dados.papel] = await crypto.subtle.importKey("raw", dados.bytes, "AES-GCM", false, ["encrypt", "decrypt"])
    self.postMessage({ tipo: "chave-posta", papel: dados.papel })
  }
  if (dados.tipo === "contar") self.postMessage({ tipo: "contagens", contagens: contagens, mensagens: mensagens })
}

const nonce = (contador) => {
  const bytes = new Uint8Array(12)
  new DataView(bytes.buffer).setUint32(8, contador, false)
  return bytes
}

let contador = 0

const cifrar = async (frame, controlador) => {
  contagens.emissor.entrada++
  const chave = chaves.emissor
  // Sem chave não sai nada. Um frame em claro decifra a ruído do outro lado, e
  // ruído é indistinguível de avaria para quem ouve. É a regra do produto.
  if (!chave) return
  const n = contador++
  const cabecalho = new Uint8Array(CABECALHO)
  new DataView(cabecalho.buffer).setUint32(4, n, false)
  const selado = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce(n), additionalData: cabecalho }, chave, frame.data),
  )
  const saida = new Uint8Array(CABECALHO + selado.length)
  saida.set(cabecalho, 0)
  saida.set(selado, CABECALHO)
  frame.data = saida.buffer
  contagens.emissor.saida++
  controlador.enqueue(frame)
}

const decifrar = async (frame, controlador) => {
  contagens.receptor.entrada++
  const chave = chaves.receptor
  if (!chave) return
  const bytes = new Uint8Array(frame.data)
  if (bytes.length < CABECALHO) {
    contagens.receptor.semCabecalho++
    return
  }
  const cabecalho = bytes.slice(0, CABECALHO)
  const n = new DataView(cabecalho.buffer).getUint32(4, false)
  try {
    const aberto = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce(n), additionalData: cabecalho },
      chave,
      bytes.slice(CABECALHO),
    )
    frame.data = aberto
    contagens.receptor.saida++
    controlador.enqueue(frame)
  } catch (erro) {
    // A etiqueta não fechou. Deita-se fora, como o produto faz — nunca se
    // entrega ciphertext a um descodificador.
    contagens.receptor.falhados++
  }
}

/*
 * O modo "solto" não cifra nada: conta e deixa passar.
 *
 * Existe para separar duas avarias que dão o MESMO zero do lado do receptor: a
 * transformação não ser chamada, ou a cifra partir a remontagem dos frames a
 * caminho dela. Sem esta metade, um receptor a zero lê-se como "este motor não
 * suporta a API" — que é a conclusão errada, e cara.
 */
const soltar = (papel) => async (frame, controlador) => {
  contagens[papel].entrada++
  contagens[papel].saida++
  controlador.enqueue(frame)
}

self.onrtctransform = (evento) => {
  const transformador = evento.transformer
  const opcoes = transformador.options || {}
  const papel = opcoes.papel || "sem-options"
  mensagens.push("rtctransform:" + papel + ":" + (opcoes.modo || "sem-modo"))
  const transformacao =
    opcoes.modo === "solto" ? soltar(papel) : papel === "emissor" ? cifrar : decifrar
  transformador.readable
    .pipeThrough(new TransformStream({ transform: transformacao }))
    .pipeTo(transformador.writable)
    .catch(() => {})
}
`

/**
 * One run: a pair of local connections, one worker, and what opened on the other
 * side.
 *
 * @param mode `loose`, `encrypted` or `key-swapped`.
 * @param type `audio` or `video`. They are two different paths inside the engine,  * audio packs one frame per packet without looking inside; video may or may not
 * have to read the bitstream, and that depends on the CODEC. Measuring them
 * together hid the difference that decides this task.
 * @param codec the video codec to FORCE (`VP8`, `H264`, …), or nothing for audio.
 * Without this each engine picks its own, and the run stops comparing engines to
 * start comparing codecs without saying so.
 */
async function interrogar(page, { modo, tipo, codec }) {
  return page.evaluate(
    async ({ fonteDoWorker, modo, tipo, codec }) => {
      const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

      /** The GATE question: is there somewhere to hang the transform? */
      const ondePendurar = (classe) => {
        if (typeof classe === "undefined") return "sem-classe"
        const descritor = Object.getOwnPropertyDescriptor(classe.prototype, "transform")
        if (!descritor) return "sem-propriedade"
        if (descritor.set) return "setter"
        return descritor.writable ? "escrevivel" : "so-leitura"
      }

      const resposta = {
        modo,
        tipo,
        construtor: typeof RTCRtpScriptTransform,
        emissorTemTransform: ondePendurar(window.RTCRtpSender),
        receptorTemTransform: ondePendurar(window.RTCRtpReceiver),
        codecPedido: codec ?? null,
        /*
         * The codec the engine USED, read from its statistics.
         *
         * Not decoration next to `codecPedido`: the only way to know that
         * `setCodecPreferences` took effect. A request that does not take effect
         * leaves the engine to negotiate whatever it wants, and the report line
         * still says "VP8" because that is what was requested, exactly the failure
         * mode that put this test bench measuring H.264 for a day while calling it VP8.
         */
        codecUsado: "?",
        erro: null,
        contagens: null,
        mensagens: null,
        ice: null,
        pacotesEnviados: 0,
        pacotesRecebidos: 0,
        /** Frames the decoder on the other side actually produced. */
        imagensDescodificadas: 0,
        tamanho: "?",
        origemDaFaixa: tipo === "audio" ? "?" : "canvas",
      }

      if (typeof RTCRtpScriptTransform !== "function") return resposta

      let pintor = null
      try {
        const worker = new Worker(URL.createObjectURL(new Blob([fonteDoWorker], { type: "text/javascript" })))
        const respostas = []
        worker.onmessage = (evento) => respostas.push(evento.data)

        /*
         * The keys BEFORE the transform exists.
         *
         * It is the order the product will use, and it is what closes the window of
         * frames in the clear: when the first frame reaches the transform, the key
         * is already there. In `key-swapped` mode they are two different keys on
         * purpose.
         */
        const chaveDoEmissor = new Uint8Array(16).fill(7)
        const chaveDoReceptor = modo === "chave-trocada" ? new Uint8Array(16).fill(9) : chaveDoEmissor
        if (modo !== "solto") {
          worker.postMessage({ tipo: "chave", papel: "emissor", bytes: chaveDoEmissor })
          worker.postMessage({ tipo: "chave", papel: "receptor", bytes: chaveDoReceptor })
          for (let volta = 0; volta < 60 && respostas.filter((cada) => cada.tipo === "chave-posta").length < 2; volta++) {
            await dormir(50)
          }
        }

        /** A track with no permissions at all. */
        let faixa
        let fluxo
        if (tipo === "audio") {
          /*
           * Two audio sources, in this order, and neither asks a human for
           * permissions.
           *
           * 1. The engine's FAKE microphone (`--use-fake-device-for-media-stream`,
           *    `media.navigator.streams.fake`). It is a real tone, goes through
           *    the real capture path, and it is what Phase 3 setup already uses.
           * 2. An oscillator, when the engine does not have a fake microphone.
           *
           * The order is not indifferent. The oscillator lives in an `AudioContext`,
           * and an `AudioContext` is born SUSPENDED where autoplay policy says,            * measured: on Chromium headless with no switch, zero packets sent, which
           * reads as "this engine does not pass audio" and is false. Worse: the
           * `resume()` never resolves, and the run hangs forever instead of failing.
           * So it runs against a clock.
           */
          const doMotor = await navigator.mediaDevices
            .getUserMedia({ audio: true })
            .catch(() => null)
          if (doMotor) {
            fluxo = doMotor
            resposta.origemDaFaixa = "microfone falso"
          } else {
            const contexto = new (window.AudioContext || window.webkitAudioContext)()
            await Promise.race([contexto.resume().catch(() => {}), dormir(2000)])
            resposta.origemDaFaixa = `oscilador (${contexto.state})`
            const oscilador = contexto.createOscillator()
            oscilador.frequency.value = 440
            const ganho = contexto.createGain()
            ganho.gain.value = 0.4
            const destino = contexto.createMediaStreamDestination()
            oscilador.connect(ganho)
            ganho.connect(destino)
            oscilador.start()
            fluxo = destino.stream
          }
          faixa = fluxo.getAudioTracks()[0]
          if (!faixa) throw new Error("não se conseguiu uma faixa de áudio sem permissões")
        } else {
          const canvas = document.createElement("canvas")
          canvas.width = 320
          canvas.height = 240
          const ctx = canvas.getContext("2d")
          let passo = 0
          const pintar = () => {
            passo++
            ctx.fillStyle = "rgb(" + (passo % 255) + "," + ((passo * 3) % 255) + ",90)"
            ctx.fillRect(0, 0, 320, 240)
            ctx.fillStyle = "#fff"
            ctx.fillRect((passo * 7) % 300, 20, 20, 20)
          }
          pintar()
          fluxo = canvas.captureStream(15)
          faixa = fluxo.getVideoTracks()[0]
          if (!faixa) throw new Error("o `captureStream` não deu faixa de vídeo")
          pintor = setInterval(pintar, 1000 / 15)
        }

        const pc = new RTCPeerConnection({})
        const par = new RTCPeerConnection({})
        pc.onicecandidate = (evento) => evento.candidate && par.addIceCandidate(evento.candidate)
        par.onicecandidate = (evento) => evento.candidate && pc.addIceCandidate(evento.candidate)

        const chegou = new Promise((resolve) => {
          par.ontrack = (evento) => {
            /*
             * The transform hangs HERE, inside `ontrack`, not after waiting for it.
             *
             * Measured: `ontrack` fires DURING `setRemoteDescription`, and an `await`
             * on it only resumes in the next microtask, already with the description
             * set and the receiver built. Firefox and WebKit accept it the same way;
             * Chromium wires the transform when it creates the receiver, and by then
             * it is too late: the transform exists, `onrtctransform` fires, and not
             * a single frame passes through it. Zero opened with 300 packets received,
             * which is indistinguishable from "this engine does not support it".
             */
            evento.receiver.transform = new RTCRtpScriptTransform(worker, { papel: "receptor", modo })

            /*
             * The track that arrives HAS to be consumed by someone.
             *
             * Measured, and it cost a misread: without an element attached, Chromium
             * does not pull a single frame through the receiver transform, neither
             * encrypted nor loose. Zero frames, 303 packets received, and the quick
             * read was "Chromium does not support this on the listening side", which
             * is false. Firefox and WebKit pull the same way with no sink.
             *
             * In the product this never comes up: the track goes to an `<audio>` that
             * the person hears. It is from the TEST BENCH, and the test bench has to
             * look like the product.
             */
            const elemento = document.createElement(tipo === "audio" ? "audio" : "video")
            elemento.autoplay = true
            elemento.muted = true
            elemento.srcObject = evento.streams[0] ?? new MediaStream([evento.track])
            document.body.appendChild(elemento)
            void elemento.play().catch(() => {})
            resolve(evento.receiver)
          }
        })

        const emissor = pc.addTrack(faixa, fluxo)

        /*
         * The codec, FORCED before negotiating, the only time it can be.
         *
         * This is what makes this test bench look like the product: there the one
         * that restricts is the SFU router, which announces `video/VP8` and nothing
         * else, and `mediasoup-client` can only produce on the intersection. Here
         * there is no router, and without this line each engine negotiates its own
         * pick, WebKit offers H.264 first, and we measured H.264 calling it VP8.
         *
         * An engine that does not have the requested codec THROWS here, and that is
         * what we want: the report says that this engine/codec pair is not
         * measurable, instead of falling silent to another codec and measuring
         * something else.
         */
        if (codec) {
          const transceptor = pc.getTransceivers().find((cada) => cada.sender === emissor)
          const capacidades = RTCRtpSender.getCapabilities("video")?.codecs ?? []
          // RTX, RED and ULPFEC stay: they are recovery mechanisms, not image codecs,
          // and removing them changes what we are measuring.
          const escolhidos = capacidades.filter(
            (cada) => cada.mimeType === `video/${codec}` || /\/(rtx|red|ulpfec)$/i.test(cada.mimeType),
          )
          if (!escolhidos.some((cada) => cada.mimeType === `video/${codec}`)) {
            throw new Error(`este motor não anuncia video/${codec}`)
          }
          transceptor.setCodecPreferences(escolhidos)
        }

        // The transform BEFORE negotiating: it is what `RTCRtpScriptTransform`
        // allows and `createEncodedStreams` does not, and it is why it closes the
        // window of point 5 in section 11 of the plan.
        emissor.transform = new RTCRtpScriptTransform(worker, { papel: "emissor", modo })

        const oferta = await pc.createOffer()
        await pc.setLocalDescription(oferta)
        await par.setRemoteDescription(oferta)
        const resp = await par.createAnswer()
        await par.setLocalDescription(resp)
        await pc.setRemoteDescription(resp)

        const receptor = await Promise.race([chegou, dormir(5000).then(() => null)])
        if (!receptor) throw new Error("o `ontrack` nunca disparou")

        await dormir(6000)

        /*
         * The ICE state and packets counted BY THE ENGINE, not by us.
         *
         * Without this, a receiver with zero frames has two indistinguishable
         * causes: the transform was not called, or no media arrived for it to
         * transform. They are failures in opposite places, one is from the API
         * being measured, the other is from the test setup, and mixing them up
         * gave a wrong conclusion about the engine.
         */
        resposta.ice = { emissor: pc.iceConnectionState, receptor: par.iceConnectionState }
        ;(await par.getStats()).forEach((registo) => {
          if (registo.type === "inbound-rtp") {
            resposta.pacotesRecebidos = registo.packetsReceived ?? 0
            /*
             * The frames the decoder PRODUCED, and it is the hardest benchmark
             * this test bench has.
             *
             * "Opened" means the AES-GCM tag closed, the bytes are the ones that
             * got encrypted. It does not say those bytes are a valid video frame: a
             * perfect decrypt of garbage gives garbage, and it counts the same. Only
             * `framesDecoded` going up proves that what came out of the decrypt was
             * real bitstream and the decoder understood it.
             */
            resposta.imagensDescodificadas = registo.framesDecoded ?? 0
            if (registo.frameWidth) resposta.tamanho = `${registo.frameWidth}x${registo.frameHeight}`
          }
        })
        const estatisticasDoEmissor = await pc.getStats()
        estatisticasDoEmissor.forEach((registo) => {
          if (registo.type === "outbound-rtp") {
            resposta.pacotesEnviados = registo.packetsSent ?? 0
            // The codec by the NAME the engine gives it, not by what was asked.
            const doCodec = registo.codecId ? estatisticasDoEmissor.get(registo.codecId) : null
            if (doCodec?.mimeType) resposta.codecUsado = doCodec.mimeType
          }
        })

        worker.postMessage({ tipo: "contar" })
        for (let volta = 0; volta < 60 && !respostas.some((cada) => cada.tipo === "contagens"); volta++) await dormir(50)
        const contagens = respostas.find((cada) => cada.tipo === "contagens")
        resposta.contagens = contagens ? contagens.contagens : null
        resposta.mensagens = contagens ? contagens.mensagens : null

        pc.close()
        par.close()
        worker.terminate()
      } catch (erro) {
        resposta.erro = String((erro && erro.message) || erro)
      } finally {
        if (pintor) clearInterval(pintor)
      }
      return resposta
    },
    { fonteDoWorker: WORKER, modo, tipo, codec },
  )
}

/*
 * Chromium hides local addresses behind mDNS names `.local`, and a headless has
 * nobody to resolve them: the two connections on this page trade candidates that
 * neither can translate, ICE never closes and the receiver stays at zero. It reads
 * as "RTCRtpScriptTransform does not work here", and it is the opposite, media
 * never even arrived for it to transform.
 *
 * This is from the TEST BENCH, not the product: in production the candidates are
 * real network, and mDNS is a privacy shield you want to keep.
 */
const MOTORES = [
  [
    "chromium",
    chromium,
    {
      args: [
        "--disable-features=WebRtcHideLocalIpsWithMdns",
        // The engine's fake microphone, and the interface that takes it without anyone
        // at the keyboard. It is what the Phase 3 setup already uses.
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  ],
  [
    "firefox",
    firefox,
    {
      firefoxUserPrefs: {
        "media.navigator.streams.fake": true,
        "media.navigator.permission.disabled": true,
        "media.autoplay.default": 0,
        "media.autoplay.blocking_policy": 0,
      },
    },
  ],
  ["webkit", webkit, {}],
]

/**
 * No run can hang.
 *
 * A browser promise that never resolves, and there are some, `resume()` on a
 * suspended `AudioContext` is one, would leave the script running forever, which
 * is the worst failure a test bench can have: it gives neither result nor error.
 * After the timeout, what you know is that engine did not respond, and that is as
 * good a fact as any other.
 */
const comRelogio = async (promessa, segundos, oQue) => {
  let cronometro
  try {
    return await Promise.race([
      promessa,
      new Promise((resolve) => {
        cronometro = setTimeout(() => resolve({ erro: `${oQue}: não respondeu em ${segundos}s`, contagens: null }), segundos * 1000)
      }),
    ])
  } finally {
    clearTimeout(cronometro)
  }
}

/**
 * What to run, and each line is a type/codec pair.
 *
 * Video runs TWICE, and both are needed:
 *
 *  - **VP8** is what the product uses. The SFU router announces `video/VP8` and
 *    nothing else, so it is the only image codec a client can produce against
 *    this server, on any engine. This is where the claim lives.
 *  - **H.264** is what WebKit picks when nobody picks for it, and it is where
 *    full-frame encryption breaks. It runs so the incompatibility comes out
 *    MEASURED and named in the right codec, instead of being blamed on the engine.
 *
 * `TIPOS=audio` still runs the voice test alone.
 */
const CORRIDAS = {
  audio: [{ tipo: "audio", codec: null }],
  video: [
    { tipo: "video", codec: "VP8" },
    { tipo: "video", codec: "H264" },
  ],
}
const TIPOS = (process.env["TIPOS"] ?? "audio").split(",")
const MODOS = ["solto", "cifrado", "chave-trocada"]

let falhou = 0
const linhas = []

/**
 * Which engines to run. All three, unless you ask for fewer.
 *
 * `MOTORES=webkit TIPOS=video node scripts/sfu-script-transform-por-motor.mjs`
 *
 * It exists for the same reason as the one in `sfu-prova-motores`: a run of all
 * three with video takes close to six minutes, and a mutation suite that takes
 * that per mutation does not run, and a check that does not run proves nothing.
 */
const QUAIS = (process.env["MOTORES"] ?? "chromium,firefox,webkit").split(",")

for (const [nome, motor, opcoes] of MOTORES) {
  if (!QUAIS.includes(nome)) continue
  let browser
  try {
    browser = await motor.launch({ headless: true, ...opcoes })
  } catch (erro) {
    console.log(`SALTA ${nome}: não está instalado (${String(erro?.message ?? erro).split("\n")[0]})`)
    continue
  }
  const contexto = await browser.newContext({ permissions: ["microphone"] }).catch(() => null)
  const page = contexto ? await contexto.newPage() : await browser.newPage()
  page.on("pageerror", (erro) => console.log(`   [erro de página] ${String(erro?.message ?? erro)}`))
  await page.goto("https://example.com", { waitUntil: "domcontentloaded" }).catch(() => page.goto("about:blank"))
  const agente = await page.evaluate(() => navigator.userAgent)

  for (const tipo of TIPOS) {
    for (const { codec } of CORRIDAS[tipo] ?? [{ tipo, codec: null }]) {
      const rotulo = codec ? `${tipo}/${codec}` : tipo
      const corridas = {}
      // Each run sets up its own pair of connections and its own worker, and leaves
      // nothing standing for the next one.
      for (const modo of MODOS) {
        corridas[modo] = await comRelogio(interrogar(page, { modo, tipo, codec }), 60, `${nome}/${rotulo}/${modo}`)
      }

      const versao = agente.match(/(Chrome|Firefox|Version)\/[\d.]+/)?.[0] ?? ""
      console.log("")
      console.log(`== ${nome}  ${versao}  —  ${rotulo}`)
      console.log(`   RTCRtpScriptTransform:              ${corridas.cifrado.construtor ?? "?"}`)
      console.log(`   RTCRtpSender.prototype.transform:   ${corridas.cifrado.emissorTemTransform ?? "?"}`)
      console.log(`   RTCRtpReceiver.prototype.transform: ${corridas.cifrado.receptorTemTransform ?? "?"}`)
      console.log(`   fonte da faixa:                     ${corridas.cifrado.origemDaFaixa ?? "?"}`)
      console.log(`   codec pedido / usado:               ${codec ?? "(áudio)"} / ${corridas.cifrado.codecUsado ?? "?"}`)
      for (const modo of MODOS) {
        const corrida = corridas[modo]
        const contagens = corrida.contagens
        const imagens = tipo === "video" ? ` imagens=${corrida.imagensDescodificadas ?? "?"} ${corrida.tamanho ?? ""}` : ""
        console.log(
          `   ${modo.padEnd(14)} cifrados=${contagens?.emissor?.saida ?? "?"} abertos=${contagens?.receptor?.saida ?? "?"} falhados=${contagens?.receptor?.falhados ?? "?"} pacotes=${corrida.pacotesEnviados ?? "?"}/${corrida.pacotesRecebidos ?? "?"}${imagens} ice=${corrida.ice?.receptor ?? "?"}${corrida.erro ? ` erro=${corrida.erro}` : ""}`,
        )
      }

      linhas.push({ nome, tipo, codec, rotulo, corridas })
    }
  }

  await browser.close()
}

/**
 * Where full-frame encryption is incompatible, and with what. The note was wrong.
 *
 * Not an exception for the script to pass: an ASSERTION about the mechanism,
 * measurement, and turns red if any engine changes behavior, which is
 * exactly when someone has to read this again.
 *
 * **What was written here and was false:** "the WebKit packager reads the
 * VP8 bitstream, and encrypted there is nothing to read". Two things wrong. The
 * VP8 packager does not read any bitstream, and the failure was not in WebKit.
 *
 * **What we measure, with forced codec (August 18, 2026):**
 *
 * | engine | codec | encrypted | decrypted | packets | frames |
 * |---|---|---|---|---|---|
 * | WebKit | VP8 | 86 | 89 | 107 | 86 (320x240) |
 * | WebKit | VP9 | 86 | 90 | 114 | 86 |
 * | WebKit | H.264 | 85 | 0 | **1** | 0 |
 * | Chromium | VP8 | 90 | 97 | 112 | 89 |
 * | Chromium | H.264 | 90 | 0 | **15** | 0 |
 * | Firefox | VP8 | 61 | 63 | 88 | 61 |
 *
 * **The variable was never the engine: it is the CODEC.** Chromium with H.264
 * breaks exactly like WebKit, and WebKit with VP8 passes exactly like
 * Chromium. The previous measurement let each engine choose, and WebKit chooses
 * H.264, hence "video does not work through WebKit", which was a conclusion
 * about an engine drawn from a variable that the test did not fix.
 *
 * **Why H.264 fails and VP8 works**, a difference in RTP format design:
 *
 *  - **H.264 (RFC 6184)** packages NALUs. To split a frame into packets the
 *    packager must SCAN the bitstream for start codes (`00 00 00 01`) and read
 *    the header byte of each NALU. Encrypted, there are no start codes: the
 *    whole frame reads as one unit that does not fit in a packet, so out comes
 *    one packet or none.
 *  - **VP8 (RFC 7741)** puts a DESCRIPTOR of its own payload first, written
 *    from what the encoder said, keyframe or not, picture ID, layers. The
 *    payload itself is opaque: split by size and nothing else. That is why
 *    encryption passes without the packager noticing.
 *
 * **And that is why the product needs no changes.** The SFU router
 * announces `video/VP8` and nothing else (`apps/server/src/media.ts`), so VP8
 * is what any client negotiates, on any engine. Leaving the codec header in
 * the clear, which SFrame provides for stacks that need to read it,  * would fix H.264 and is not needed for VP8: it would cost a new wire format,
 * a compatibility break, and 3 to 10 bytes per frame visible to the server,
 * to buy something already bought.
 *
 * Audio has no such problem on any codec: an Opus frame is one packet, and the
 * packager does not look inside.
 */
const INCOMPATIVEIS = {
  H264: "o empacotador de H.264 varre o bitstream à procura de códigos de arranque de NALU, e cifrado não há nenhum",
}

console.log("")
for (const { nome, tipo, codec, rotulo: oQue, corridas } of linhas) {
  const rotulo = `${nome}/${oQue}`
  const cifrado = corridas.cifrado
  const solto = corridas.solto
  const trocada = corridas["chave-trocada"]

  /*
   * An engine that does not have the codec is not a failure of the engine or
   * encryption.
   *
   * Firefox does not announce H.264 in this setup, and `setCodecPreferences`
   * throws. Calling that a FAIL was asserting an incompatibility that was
   * not measured; we report it as UNMEASURED, which is what we know. Same rule
   * as missing `totalSamplesReceived` in engine measurements.
   */
  if (/não anuncia/.test(String(cifrado.erro ?? ""))) {
    console.log(`SEM MEDIDA  ${rotulo}: ${cifrado.erro}`)
    continue
  }

  /*
   * The codec requested is the codec used, and this check prevents the test
   * from measuring one thing and calling it another.
   */
  if (codec) {
    verificar(
      `${rotulo}: o motor negociou mesmo o codec que se lhe pediu`,
      cifrado.codecUsado?.toLowerCase() === `video/${codec}`.toLowerCase(),
      `pedido=video/${codec} usado=${cifrado.codecUsado} — sem isto, o resto desta secção fala de um codec que não se sabe qual é`,
    )
  }

  const incompativel = codec ? INCOMPATIVEIS[codec] : null
  if (incompativel) {
    verificar(
      `${rotulo}: SEM cifra passa media (a montagem é boa)`,
      Boolean(solto.contagens) && solto.contagens.receptor.saida > 0 && solto.pacotesEnviados > 10,
      `contagens=${JSON.stringify(solto.contagens)} pacotes=${solto.pacotesEnviados}/${solto.pacotesRecebidos}`,
    )
    verificar(
      `${rotulo}: a cifra de frame inteiro COLAPSA neste codec — ${incompativel}`,
      Boolean(cifrado.contagens) &&
        cifrado.contagens.emissor.saida > 10 &&
        cifrado.pacotesEnviados < solto.pacotesEnviados / 4 &&
        cifrado.contagens.receptor.saida === 0,
      `cifrou=${cifrado.contagens?.emissor?.saida} pacotes=${cifrado.pacotesEnviados} (sem cifra: ${solto.pacotesEnviados}) abertos=${cifrado.contagens?.receptor?.saida} — se isto mudou, o motor mudou e há que reler a nota`,
    )
    continue
  }

  verificar(
    `${rotulo}: as duas prototypes têm onde pendurar a transformação`,
    cifrado.construtor === "function" &&
      ["setter", "escrevivel"].includes(cifrado.emissorTemTransform) &&
      ["setter", "escrevivel"].includes(cifrado.receptorTemTransform),
    `construtor=${cifrado.construtor} emissor=${cifrado.emissorTemTransform} receptor=${cifrado.receptorTemTransform}`,
  )
  verificar(
    `${rotulo}: SEM cifra, a transformação é chamada nos DOIS lados`,
    Boolean(solto.contagens) && solto.contagens.emissor.saida > 0 && solto.contagens.receptor.saida > 0,
    `erro=${solto.erro} contagens=${JSON.stringify(solto.contagens)} pacotes=${solto.pacotesEnviados}/${solto.pacotesRecebidos}`,
  )
  verificar(
    `${rotulo}: COM cifra, o outro lado ABRIU frames (etiqueta do AES-GCM a fechar)`,
    Boolean(cifrado.contagens) && cifrado.contagens.emissor.saida > 0 && cifrado.contagens.receptor.saida > 0,
    `erro=${cifrado.erro} contagens=${JSON.stringify(cifrado.contagens)} pacotes=${cifrado.pacotesEnviados}/${cifrado.pacotesRecebidos}`,
  )
  verificar(
    `${rotulo}: COM cifra, nenhum frame falhou a decifra`,
    Boolean(cifrado.contagens) && cifrado.contagens.receptor.falhados === 0,
    `contagens=${JSON.stringify(cifrado.contagens)}`,
  )
  verificar(
    `${rotulo}: com a CHAVE TROCADA não abre um único frame, e falham todos`,
    Boolean(trocada.contagens) &&
      trocada.contagens.receptor.saida === 0 &&
      trocada.contagens.receptor.falhados > 0,
    `contagens=${JSON.stringify(trocada.contagens)} — sem isto, o verde de cima não prova criptografia nenhuma`,
  )
  verificar(
    `${rotulo}: o \`options\` do construtor chegou ao worker com o papel`,
    Array.isArray(cifrado.mensagens) &&
      cifrado.mensagens.includes("rtctransform:emissor:cifrado") &&
      cifrado.mensagens.includes("rtctransform:receptor:cifrado"),
    `mensagens=${JSON.stringify(cifrado.mensagens)}`,
  )
  verificar(
    `${rotulo}: o \`postMessage\` levou a chave ao worker depois de ele estar de pé`,
    Array.isArray(cifrado.mensagens) && cifrado.mensagens.includes("chave"),
    `mensagens=${JSON.stringify(cifrado.mensagens)}`,
  )

  if (tipo !== "video") continue

  /*
   * The SYMPTOM we are fixing, measured directly.
   *
   * The H.264 collapse does not show in worker counts, it encrypts 85 frames
   * just fine and reports success. It shows on the wire: a video frame is
   * larger than the MTU and must go out split across packets, and when the
   * packager cannot split it sends one packet. Counting packets is what tells
   * "encryption ran" apart from "encryption ran and what came out was actually
   * transportable".
   */
  verificar(
    `${rotulo}: o emissor PARTE os frames cifrados em vários pacotes`,
    cifrado.pacotesEnviados > 10,
    `pacotes=${cifrado.pacotesEnviados} — um frame de vídeo não cabe num pacote, e um pacote só é o empacotador a desistir`,
  )
  /*
   * And the toughest measure of all: frames.
   *
   * "Decrypted" proves the AES-GCM tag closed over the right bytes. It does
   * not prove those bytes are video, perfect decryption of garbage is garbage
   * and counts as decrypted anyway. `framesDecoded` going up proves the engine
   * decoder received actual bitstream and made pictures from it. It is the
   * equivalent here to the `VideoDecoder` from WebCodecs in Phase 3 testing.
   */
  verificar(
    `${rotulo}: e o que saiu da decifra DESCODIFICA em imagens`,
    cifrado.imagensDescodificadas > 0,
    `imagens=${cifrado.imagensDescodificadas} tamanho=${cifrado.tamanho} — sem isto, "abriu" só diz que a etiqueta fechou`,
  )
}

function verificar(rotulo, condicao, detalhe) {
  if (condicao) {
    console.log(`PASS  ${rotulo}`)
  } else {
    falhou += 1
    console.log(`FAIL  ${rotulo} — ${detalhe}`)
  }
}

console.log("")
console.log(
  falhou === 0
    ? "O `RTCRtpScriptTransform` move frames cifrados, e a chave trocada não abre nada."
    : `${falhou} verificações falharam.`,
)
process.exit(falhou === 0 ? 0 : 1)
