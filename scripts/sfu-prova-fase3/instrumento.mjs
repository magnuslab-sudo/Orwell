/**
 * What hangs in the browser to count IMAGES, without touching the app.
 *
 * It is the Phase 2 instrument with the question changed. There we counted voice:
 * frames entering and leaving encryption, and an `AudioDecoder` proving what came
 * out was real Opus. Here we count the same for video, and the format proof is a
 * VP8 `VideoDecoder`, which is harder to fake: a packet that crosses the SFU proves
 * transport; a frame that DECODES TO AN IMAGE proves transport, key, format and dimensions.
 *
 * **What sets this instrument apart from the Phase 2 one**, and why it exists:
 *
 *  1. **It knows which TRACK each stream is.** `createEncodedStreams()` is called
 *     on an `RTCRtpSender`/`Receiver`, and that object has a `track` with a `kind`.
 *     Without this, a call with mic and screen gives two indistinguishable records
 *     and counts add up, and a share that passed no frames stays hidden behind the
 *     audio that did.
 *  2. **It tells keyframes apart.** The first byte of a clear VP8 frame carries the
 *     type in bit 0: zero is keyframe. Read AFTER decryption, and that is what makes
 *     it a measurement and not a form read, a ciphertext byte also has a bit 0.
 *  3. **It measures the gap between images.** A share that freezes does not lower the
 *     count: it goes up slower. Who answers "did it freeze?" is the longest gap between
 *     two outputs, like in Phase 2 it answered "did it cut?".
 *
 * What this does NOT do stays the same: it does not decrypt, knows no key,
 * and does not change a single byte of a frame that passes. It counts, and lets it through.
 */

/**
 * Runs in the browser before any page script (`addInitScript`).
 *
 * Self-contained: Playwright serializes the function, and what it closed over did not
 * travel with it.
 */
export const INSTRUMENTAR = (sabotagem) => {
  const registos = []
  window.__sframe = registos
  window.__pcs = []

  /** Eleven bytes, big-endian. Version other than zero is not our SFrame. */
  const lerCabecalho = (bytes) => {
    if (bytes.length < 11) return null
    const vista = new DataView(bytes.buffer, bytes.byteOffset, 11)
    if (vista.getUint8(10) !== 0) return null
    return {
      keyId: vista.getUint16(0, false),
      senderId: vista.getUint16(2, false),
      counter: vista.getUint32(4, false) * 0x10000 + vista.getUint16(8, false),
    }
  }

  const contar = (mapa, chave) => {
    mapa[chave] = (mapa[chave] ?? 0) + 1
  }

  /** Which key each frame came from. See the Phase 2 instrument note. */
  const chaveDoFrame = new WeakMap()

  /**
   * The VP8 decoder, hanging on what LEAVES decryption.
   *
   * `VideoDecoder` from WebCodecs, not a playback element: headless Chrome renders,
   * but reading what it rendered requires passing through a surface and a compositor
   * the machine may not have. The decoder gives back a `VideoFrame` with width and
   * height, and that proves what came out of decryption really was an image, not
   * bytes with the right shape.
   *
   * `optimizeForLatency` because what matters is seeing the first frame come out, not
   * smooth playback of a film.
   */
  const montarDescodificadorDeVideo = (registo) => {
    if (typeof VideoDecoder === "undefined") return null
    try {
      const decodificador = new VideoDecoder({
        output: (imagem) => {
          registo.imagens++
          registo.largura = imagem.codedWidth
          registo.altura = imagem.codedHeight
          imagem.close()
        },
        error: (erro) => {
          registo.erroDoDescodificador = String(erro?.message ?? erro)
        },
      })
      decodificador.configure({ codec: "vp8", optimizeForLatency: true })
      return decodificador
    } catch (erro) {
      registo.erroDoDescodificador = String(erro?.message ?? erro)
      return null
    }
  }

  const descodificarVideo = (registo, bytes, chave) => {
    const decodificador = registo.decodificador
    if (!decodificador || decodificador.state !== "configured") return
    if (bytes.length === 0) {
      registo.vaziosDescartados++
      return
    }
    /*
     * A video decoder REFUSES to start with a delta frame, and that is how it has
     * to be: without a keyframe there is nothing to apply the differences to. While
     * it has not arrived, frames are counted and not decoded, which is exactly what
     * Chrome does underneath.
     */
    if (!registo.viuKeyframe) {
      if (!chave) return
      registo.viuKeyframe = true
    }
    try {
      decodificador.decode(
        new EncodedVideoChunk({
          type: chave ? "key" : "delta",
          timestamp: registo.saida * 66_000,
          data: bytes,
        }),
      )
    } catch (erro) {
      registo.erroDoDescodificador = String(erro?.message ?? erro)
    }
  }

  /**
   * The sabotages, and why they live here.
   *
   * A check that never failed is not a check. These break links without touching
   * the app: what you measure is still the app, and what changes is what reaches
   * its hands or what leaves them.
   *
   *   no-cipher       the app's transform is TURNED OFF on the VIDEO sender:
   *                   the image goes clear on the wire. Nothing should open
   *                   on the other side, and what comes out carries no SFrame header.
   *   bytes-swapped   one payload byte swapped on arrival, AFTER the header.
   *                   The shape still looks like an SFrame frame; the AES-GCM
   *                   tag is what stops matching.
   */
  const embrulhar = (par, papel, tipo) => {
    const registo = {
      papel,
      /** "audio" or "video": without this, voice hides a share that did not pass. */
      tipo,
      entrada: 0,
      saida: 0,
      bytesEntrada: 0,
      bytesSaida: 0,
      cifradosPorChave: {},
      abertosPorChave: {},
      semCabecalho: 0,
      vaziosDescartados: 0,
      ordemDasChaves: [],
      primeiroContador: null,
      ultimoContador: null,
      ultimaSaidaEm: 0,
      /** The longest gap between two outputs. Who answers "did it freeze?". */
      maiorIntervaloDeSaida: 0,
      /** VP8 frames in plaintext whose first byte bit 0 is zero. */
      keyframes: 0,
      viuKeyframe: false,
      imagens: 0,
      largura: 0,
      altura: 0,
      erroDoDescodificador: null,
      decodificador: null,
      marcas: [],
    }
    registos.push(registo)

    if (papel === "receptor" && tipo === "video") registo.decodificador = montarDescodificadorDeVideo(registo)

    const ladoCifrado = papel === "receptor" ? "entrada" : "saida"

    const olhar = (frame, lado) => {
      const bytes = new Uint8Array(frame.data)
      const agora = performance.now()

      /*
       * The VP8 frame type, read from the PLAINTEXT, and plaintext side is the
       * OPPOSITE of the ciphertext side.
       *
       * Bit 0 of the first byte: zero is keyframe. On the sender, plaintext comes in
       * and ciphertext goes out; on the receiver it is backwards. The first version
       * of this always read on the way out and said "218 keyframes out of 218" on
       * the sharer's side, because the first byte of a ciphertext frame is the high
       * byte of the `keyId`, which is zero, and zero has bit 0 at zero. A constant
       * dressed up as a measurement, same family as the `keyId` values read from clear
       * Opus that cost four checks in Phase 2.
       */
      if (tipo === "video" && lado !== ladoCifrado && bytes.length > 0) {
        const eKeyframe = (bytes[0] & 1) === 0
        if (eKeyframe) registo.keyframes++
        if (papel === "receptor") descodificarVideo(registo, bytes, eKeyframe)
      }

      if (lado === ladoCifrado) {
        const cabecalho = lerCabecalho(bytes)
        if (cabecalho) {
          chaveDoFrame.set(frame, cabecalho.keyId)
          if (!registo.ordemDasChaves.includes(cabecalho.keyId)) registo.ordemDasChaves.push(cabecalho.keyId)
          contar(registo.cifradosPorChave, cabecalho.keyId)
          if (registo.primeiroContador === null) registo.primeiroContador = cabecalho.counter
          registo.ultimoContador = cabecalho.counter
        } else registo.semCabecalho++
      }

      if (lado === "entrada") {
        registo.entrada++
        registo.bytesEntrada += bytes.length
        if (sabotagem === "bytes-trocados" && papel === "receptor" && tipo === "video" && bytes.length > 12) {
          const estragado = new Uint8Array(bytes)
          estragado[12] ^= 0xff
          frame.data = estragado.buffer
        }
        return
      }

      registo.saida++
      registo.bytesSaida += bytes.length
      if (registo.ultimaSaidaEm > 0) {
        const intervalo = agora - registo.ultimaSaidaEm
        if (intervalo > registo.maiorIntervaloDeSaida) registo.maiorIntervaloDeSaida = intervalo
      }
      registo.ultimaSaidaEm = agora

      if (papel !== "receptor") return
      const chave = chaveDoFrame.get(frame)
      if (chave !== undefined) contar(registo.abertosPorChave, chave)
    }

    const contadorDeEntrada = new TransformStream({
      transform(frame, controlador) {
        olhar(frame, "entrada")
        controlador.enqueue(frame)
      },
    })
    const contadorDeSaida = new TransformStream({
      transform(frame, controlador) {
        olhar(frame, "saida")
        controlador.enqueue(frame)
      },
    })

    const paraOProduto = par.readable.pipeThrough(contadorDeEntrada)

    if (sabotagem === "sem-cifra" && papel === "emissor" && tipo === "video") {
      // The app gets a duct that never delivers anything, and the image
      // goes from the encoder to the wire without passing through it. It is
      // encryption off without changing a line of the app.
      void paraOProduto.pipeThrough(contadorDeSaida).pipeTo(par.writable).catch(() => {})
      return { readable: new ReadableStream(), writable: new WritableStream() }
    }

    void contadorDeSaida.readable.pipeTo(par.writable).catch(() => {})
    return { readable: paraOProduto, writable: contadorDeSaida.writable }
  }

  const pendurar = (prototipo, papel) => {
    const original = prototipo?.createEncodedStreams
    if (typeof original !== "function") return
    prototipo.createEncodedStreams = function () {
      // The TRACK says which stream this pair of ducts is. A sender with no track
      // does not exist in the app's path, encryption hangs after the `produce`, // and "audio" as the default is what Phase 2 measured in full.
      const tipo = this.track?.kind ?? "audio"
      return embrulhar(original.call(this), papel, tipo)
    }
  }

  pendurar(window.RTCRtpSender?.prototype, "emissor")
  pendurar(window.RTCRtpReceiver?.prototype, "receptor")

  const Original = window.RTCPeerConnection
  window.RTCPeerConnection = function (config) {
    const pc = new Original(config)
    window.__pcs.push(pc)
    return pc
  }
  window.RTCPeerConnection.prototype = Original.prototype

  window.__marcar = (nome) => {
    for (const registo of registos) {
      registo.marcas.push({ nome, entrada: registo.entrada, saida: registo.saida })
    }
  }
}

/** What the script reads from each page. No live objects: only numbers. */
export const LER_SFRAME = () =>
  (window.__sframe ?? []).map((r) => ({
    papel: r.papel,
    tipo: r.tipo,
    entrada: r.entrada,
    saida: r.saida,
    recusados: r.entrada - r.saida,
    bytesEntrada: r.bytesEntrada,
    bytesSaida: r.bytesSaida,
    cifradosPorChave: { ...r.cifradosPorChave },
    abertosPorChave: { ...r.abertosPorChave },
    semCabecalho: r.semCabecalho,
    vaziosDescartados: r.vaziosDescartados,
    ordemDasChaves: [...r.ordemDasChaves],
    keyframes: r.keyframes,
    imagens: r.imagens,
    largura: r.largura,
    altura: r.altura,
    erroDoDescodificador: r.erroDoDescodificador,
    primeiroContador: r.primeiroContador,
    ultimoContador: r.ultimoContador,
    maiorIntervaloDeSaida: Math.round(r.maiorIntervaloDeSaida),
    marcas: r.marcas.map((m) => ({ ...m })),
  }))

/**
 * What the APP did with the image that arrived.
 *
 * The other half of "can you see it?". The instrument measures that frames decrypt
 * and VP8 decodes to images; this measures that the app took that stream and put it
 * on STAGE, which is a different place from the face mosaic, with opposite drawing
 * rules (`contain` vs `cover`).
 *
 * `.call-palco` is the class from `ScreenStage.tsx`. Reading the class is reading the
 * drawing, not the intention: a screen that ended up in the mosaic does not show here.
 */
export const LER_PALCO = () =>
  [...document.querySelectorAll(".call-palco video")].map((elemento) => ({
    aTocar: !elemento.paused,
    prontidao: elemento.readyState,
    largura: elemento.videoWidth,
    altura: elemento.videoHeight,
    faixas: elemento.srcObject
      ? elemento.srcObject.getVideoTracks().map((faixa) => `${faixa.readyState}:${faixa.enabled}`)
      : null,
  }))

/** The video statistics, per connection. The second measurement, independent. */
export const LER_ESTATISTICAS = async () =>
  await Promise.all(
    (window.__pcs ?? []).map(async (pc) => {
      const dados = { estado: pc.connectionState, dtls: null, entrada: [], saida: [], bandaDeSaida: null }
      const relatorio = await pc.getStats()
      relatorio.forEach((linha) => {
        if (linha.type === "transport" && linha.dtlsState) dados.dtls = linha.dtlsState
        if (linha.type === "inbound-rtp" && linha.kind === "video") {
          dados.entrada.push({
            pacotes: linha.packetsReceived ?? 0,
            bytes: linha.bytesReceived ?? 0,
            frames: linha.framesDecoded ?? 0,
            largura: linha.frameWidth ?? 0,
            altura: linha.frameHeight ?? 0,
          })
        }
        if (linha.type === "outbound-rtp" && linha.kind === "video") {
          dados.saida.push({
            pacotes: linha.packetsSent ?? 0,
            bytes: linha.bytesSent ?? 0,
            frames: linha.framesEncoded ?? 0,
            keyframes: linha.keyFramesEncoded ?? 0,
          })
        }
        if (linha.type === "candidate-pair" && typeof linha.availableOutgoingBitrate === "number") {
          dados.bandaDeSaida = Math.max(dados.bandaDeSaida ?? 0, linha.availableOutgoingBitrate)
        }
      })
      return dados
    }),
  )
