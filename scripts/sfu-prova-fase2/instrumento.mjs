/**
 * What hangs in the browser to count frames, without touching the product.
 *
 * Phase 0 contou frames because the test page owned them, it encrypted, counted,
 * decrypted, counted again. Here the page is the product, and the product
 * counts nothing: `protegerReceptor` silently drops the frame that fails to decrypt
 * (`media-sframe.ts`, "A frame that fails to decrypt is dropped, not passed
 * through"), which is the correct behavior and is exactly what makes the fault
 * invisible. Without a counter, "no signal" and "signal present" leave the same
 * trace: none.
 *
 * The interception happens at the one place where the cipher hooks in:
 * `createEncodedStreams()`. The product calls it, gets `{readable, writable}` and
 * wires `readable → a sua transformação → writable`. If the caller returns a wrapped pair, frames pass through their hands twice, before
 * the product transforms them and after, without changing a line:
 *
 *   RECEIVER   input  = ciphertext that the SFU routed   (what ARRIVED)
 *              output = plaintext that the decoder sees (what OPENED)
 *              dropped = input - output
 *
 *   SENDER     input  = clear Opus, from the encoder
 *              output = what goes on the wire, and must carry SFrame header
 *
 * It is the same triple from Phase 0, received, decrypted, dropped, measured in
 * the product instead of on a test page.
 *
 * **The header is read from bytes.** Eleven: keyId(u16) senderId(u16) counter(u48)
 * version(u8=0), big-endian, clear by design
 * (`packages/crypto/src/sframe.ts`). The reader's copy is deliberate, a test
 * that reads the header by calling the code that writes it does not prove format at all.
 * Counting input by keyId is what makes the two-key window measurable:
 * you see the epoch turn on the wire, and you see if output stalled at that moment.
 *
 * What this does NOT do, and is deliberate: it does not decrypt, knows no keys, and
 * does not change a single byte of a frame. It counts, and lets it pass.
 */

/**
 * Runs in the browser before any page script (`addInitScript`).
 *
 * Must be standalone: Playwright serializes the function and what it closed over
 * does not travel with it.
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

  /**
   * Which key each frame came from, to know what EXITED from each one.
   *
   * On the receiver the output is plaintext: it has no header, and reading it
   * gives made-up numbers from the first eleven bytes of Opus, the first version
   * of this measurement said `{"63644":2}` and passed as information. What links
   * input to output is the frame object itself, which the product does not replace
   * (`frame.data = plain.buffer; controller.enqueue(frame)`).
   *
   * A `WeakMap` not a property on the frame: frames are platform objects and not
   * a place to hang our things. They die, and the mark dies with them.
   */
  const chaveDoFrame = new WeakMap()

  /**
   * The key OUR sender is putting on the wire, and since when.
   *
   * The rotation clock on this side. `CifraDeMedia.rodar()` rotates the sender
   * and receivers in one pass, so the moment our sender switches `keyId` is the
   * moment this device entered the new epoch. A frame from someone else that
   * arrives after that with the PREVIOUS key is exactly the case the two-key
   * window exists to hold.
   */
  const rotacao = { keyId: null, desde: 0 }

  /**
   * The Opus decoder, attached to what comes out of decryption.
   *
   * Phase 0 measured sound with an `AnalyserNode`, but on this machine it
   * stopped measuring anything: the `AudioContext` clock does not run (it
   * advances 5 ms in four seconds) because headless Chrome has no audio output,
   * and without a sink pulling the graph, nothing decodes. The same zeroes out
   * `totalSamplesReceived` and `totalAudioEnergy` from `getStats()`: 960
   * samples in fifteen seconds, which is twenty milliseconds.
   *
   * The WebCodecs `AudioDecoder` does not need columns. It takes the bytes
   * that came out of decryption and returns samples, and it is a STRONGER
   * measurement than Phase 0: it proves the plaintext is real Opus with
   * acoustic energy, without depending on the browser playback stack. What it
   * does not prove, and is stated, is the final step, the speaker, which does
   * not exist on this machine.
   */
  const descodificar = (registo, bytes) => {
    const decodificador = registo.decodificador
    if (!decodificador || decodificador.state !== "configured") return
    /*
     * An empty frame kills the decoder, and kills it for good.
     *
     * Opus emits zero-length packets, that is how discontinuous transmission
     * says "keep going". The `AudioDecoder` throws "Null or empty decoder
     * buffer" and moves to the `closed` state: from then on it decodes nothing,
     * and sound measurement stays at zero for the rest of the run, looking
     * exactly like a silent call. Caught.
     */
    if (bytes.length === 0) {
      registo.vaziosDescartados++
      return
    }
    try {
      decodificador.decode(
        new EncodedAudioChunk({ type: "key", timestamp: registo.saida * 20_000, duration: 20_000, data: bytes }),
      )
    } catch (erro) {
      registo.erroDoDescodificador = String(erro?.message ?? erro)
    }
  }

  /**
   * Sabotages that live in the browser, and why they live here.
   *
   * A check that never fails is not a check. These break links in the chain
   * without touching the product, what is measured stays the product, and what
   * changes is what reaches its hands or what leaves them.
   *
   *   no-cipher       encryption on the sender is TURNED OFF: plaintext Opus
   *                   goes on the wire. Nothing should open on the other side,
   *                   and what comes out should have no SFrame header.
   *   bytes-swapped   one byte of the payload is swapped on arrival, AFTER the
   *                   header. It still looks like an SFrame frame; the
   *                   AES-GCM tag no longer closes. It is the difference
   *                   between "looks like SFrame" and "opens", and the tag
   *                   always decides.
   */
  const embrulhar = (par, papel) => {
    const registo = {
      papel,
      entrada: 0,
      saida: 0,
      bytesEntrada: 0,
      bytesSaida: 0,
      /**
       * How many ENCRYPTED frames were seen with each keyId, and the epoch
       * rolling shows up here.
       *
       * The encrypted side is not the same in both roles, and mixing them gives
       * numbers that look right: in the receiver ciphertext ENTERS and plaintext
       * leaves; in the sender it is backwards. Reading the header from the wrong
       * side is reading the first eleven bytes of Opus as if they were a header
       *, the first design of this announced `{"63644":2}` and nobody suspected.
       */
      cifradosPorChave: {},
      /** Of those, how many OPENED. Receiver only: the difference is refusals. */
      abertosPorChave: {},
      /**
       * Frames from an earlier key that arrived after WE already rotated.
       *
       * This is the two-key window in action, and it is the only thing the test
       * proves, without old frames arriving late, "decrypted everything" is true for a
       * rotation that never needed a window.
       *
       * **Late compared to what.** The first version compared each frame's key
       * to the previous frame's, and always got zero: a sender only moves forward,
       * and never goes back to the old key after rotating. The delay is not between frames, it is between the frame and the moment WE
       * rotated. We know that moment: it is when our own sender
       * started putting the new key on the wire, because `rodar()` rotates the sender and
       * receivers in the same pass. See `#rotacao`.
       */
      atrasadosDaChaveAnterior: 0,
      /** Zero-length frames, which Opus emits and the decoder refuses. */
      vaziosDescartados: 0,
      /** Frames on the encrypted side with no SFrame header. One is already too many. */
      semCabecalho: 0,
      /** Keys in order of appearance. The last one is the one running now. */
      ordemDasChaves: [],
      /** First and last counter: a sender only, counting. */
      primeiroContador: null,
      ultimoContador: null,
      ultimaSaidaEm: 0,
      /**
       * The longest gap, in ms, between two consecutive outputs. This answers
       * "did the audio cut?", the final count rises anyway after two seconds
       * of silence, which is why it alone is not enough.
       */
      maiorIntervaloDeSaida: 0,
      /** How much energy the decoded Opus has. Zero is a silent call. */
      rms: 0,
      amostrasDescodificadas: 0,
      erroDoDescodificador: null,
      decodificador: null,
      /** Markers placed outside, to divide the run into phases. */
      marcas: [],
    }
    registos.push(registo)

    // Receiver only: on the sender what comes out is ciphertext, and there is nothing to hear.
    if (papel === "receptor" && typeof AudioDecoder !== "undefined") {
      try {
        registo.decodificador = new AudioDecoder({
          output: (audio) => {
            const total = audio.numberOfFrames
            const amostras = new Float32Array(total)
            audio.copyTo(amostras, { planeIndex: 0, format: "f32-planar" })
            let soma = 0
            for (const amostra of amostras) soma += amostra * amostra
            const rms = Math.sqrt(soma / total)
            if (rms > registo.rms) registo.rms = rms
            registo.amostrasDescodificadas += total
            audio.close()
          },
          error: (erro) => {
            registo.erroDoDescodificador = String(erro?.message ?? erro)
          },
        })
        registo.decodificador.configure({ codec: "opus", sampleRate: 48000, numberOfChannels: 2 })
      } catch (erro) {
        registo.erroDoDescodificador = String(erro?.message ?? erro)
      }
    }

    /*
     * Which side has the ciphertext: input in the receiver, output in the sender.
     *
     * It is the only asymmetry between the two roles, and it fits in one line
     * instead of spread across two branches that diverge at the first change.
     */
    const ladoCifrado = papel === "receptor" ? "entrada" : "saida"

    const olhar = (frame, lado) => {
      const bytes = new Uint8Array(frame.data)
      const agora = performance.now()

      if (lado === ladoCifrado) {
        const cabecalho = lerCabecalho(bytes)
        if (cabecalho) {
          // The marker travels in the frame object, which the product does not replace:
          // it tells, on output, which key produced what opened.
          chaveDoFrame.set(frame, cabecalho.keyId)
          if (!registo.ordemDasChaves.includes(cabecalho.keyId)) registo.ordemDasChaves.push(cabecalho.keyId)
          if (papel === "emissor") {
            // Our side just rotated. The marker is set, and the clock starts.
            if (rotacao.keyId !== cabecalho.keyId) {
              rotacao.keyId = cabecalho.keyId
              rotacao.desde = agora
            }
          } else if (rotacao.keyId !== null && cabecalho.keyId !== rotacao.keyId && agora > rotacao.desde) {
            registo.atrasadosDaChaveAnterior++
          }
          contar(registo.cifradosPorChave, cabecalho.keyId)
          if (registo.primeiroContador === null) registo.primeiroContador = cabecalho.counter
          registo.ultimoContador = cabecalho.counter
        } else registo.semCabecalho++
      }

      if (lado === "entrada") {
        registo.entrada++
        registo.bytesEntrada += bytes.length
        if (sabotagem === "bytes-trocados" && papel === "receptor" && bytes.length > 12) {
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
      descodificar(registo, bytes)
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

    // par.readable → [count] → transform the product → [count] → par.writable
    const paraOProduto = par.readable.pipeThrough(contadorDeEntrada)

    if (sabotagem === "sem-cifra" && papel === "emissor") {
      /*
       * The product gets a pipe that never delivers anything to it, and frames
       * go from encoder to wire without passing through it. This is encryption
       * turned off without changing a line of the product: what comes out is
       * plaintext Opus.
       */
      void paraOProduto.pipeThrough(contadorDeSaida).pipeTo(par.writable).catch(() => {})
      return { readable: new ReadableStream(), writable: new WritableStream() }
    }

    void contadorDeSaida.readable.pipeTo(par.writable).catch(() => {
      // The pipe ends when the sender closes. It is not an error.
    })

    return { readable: paraOProduto, writable: contadorDeSaida.writable }
  }

  const pendurar = (prototipo, papel) => {
    const original = prototipo?.createEncodedStreams
    if (typeof original !== "function") return
    prototipo.createEncodedStreams = function () {
      return embrulhar(original.call(this), papel)
    }
  }

  pendurar(window.RTCRtpSender?.prototype, "emissor")
  pendurar(window.RTCRtpReceiver?.prototype, "receptor")

  // The connections, to call `getStats()` on them, the second measurement,
  // independent of the first, which is how Phase 0 measured sound.
  const Original = window.RTCPeerConnection
  window.RTCPeerConnection = function (config) {
    const pc = new Original(config)
    window.__pcs.push(pc)
    return pc
  }
  window.RTCPeerConnection.prototype = Original.prototype

  /** A mark in time, to divide the run into before and after. */
  window.__marcar = (nome) => {
    for (const registo of registos) {
      registo.marcas.push({
        nome,
        entrada: registo.entrada,
        saida: registo.saida,
        cifradosPorChave: { ...registo.cifradosPorChave },
        abertosPorChave: { ...registo.abertosPorChave },
      })
    }
  }
}

/**
 * What the PRODUCT did with the sound that arrived.
 *
 * The other half of the question "do you hear it?". The instrument measures
 * that frames decrypt and that decoded Opus has energy; this measures that the
 * product took that stream and put it in a playing element. Together the two
 * halves are the entire path to where a speaker would start.
 *
 * The final step, the speaker, is not measured here, and not from laziness:
 * headless Chrome has no audio output, the `AudioContext` clock does not run,
 * and `totalSamplesReceived` ends at 960 samples (twenty milliseconds) after
 * fifteen seconds of call. It is stated instead of worked around with a number
 * that looked like it measured something.
 *
 * Our own box is distinguished by `muted`, which the product always sets on
 * it: hearing your own microphone is a loop.
 */
export const LER_CAIXAS = () =>
  [...document.querySelectorAll("video")].map((elemento) => ({
    nossa: elemento.muted,
    aTocar: !elemento.paused,
    prontidao: elemento.readyState,
    faixas: elemento.srcObject
      ? elemento.srcObject.getAudioTracks().map((faixa) => `${faixa.readyState}:${faixa.enabled}`)
      : null,
  }))

/** What the script reads from each page. No live objects: only numbers. */
export const LER_SFRAME = () =>
  (window.__sframe ?? []).map((r) => ({
    papel: r.papel,
    entrada: r.entrada,
    saida: r.saida,
    recusados: r.entrada - r.saida,
    bytesEntrada: r.bytesEntrada,
    bytesSaida: r.bytesSaida,
    cifradosPorChave: { ...r.cifradosPorChave },
    abertosPorChave: { ...r.abertosPorChave },
    semCabecalho: r.semCabecalho,
    atrasadosDaChaveAnterior: r.atrasadosDaChaveAnterior,
    vaziosDescartados: r.vaziosDescartados,
    ordemDasChaves: [...r.ordemDasChaves],
    rms: r.rms,
    amostrasDescodificadas: r.amostrasDescodificadas,
    erroDoDescodificador: r.erroDoDescodificador,
    primeiroContador: r.primeiroContador,
    ultimoContador: r.ultimoContador,
    maiorIntervaloDeSaida: Math.round(r.maiorIntervaloDeSaida),
    marcas: r.marcas.map((m) => ({ ...m })),
  }))

/**
 * What `getStats()` says, per connection. The second measurement.
 *
 * `RTCStatsReport` is a Map: iterated with `for...of` gives pairs `[id, linha]` and
 * not rows. It cost a FAIL in Phase 0 e it is written at point 6 do that it
 * mandated to assume. Here we use `forEach`, which gives the row.
 */
export const LER_ESTATISTICAS = async () =>
  await Promise.all(
    (window.__pcs ?? []).map(async (pc) => {
      const dados = { estado: pc.connectionState, dtls: null, entrada: [], saida: [], bandaDeSaida: null }
      const relatorio = await pc.getStats()
      relatorio.forEach((linha) => {
        if (linha.type === "transport" && linha.dtlsState) dados.dtls = linha.dtlsState
        if (linha.type === "inbound-rtp" && linha.kind === "audio") {
          dados.entrada.push({
            pacotes: linha.packetsReceived ?? 0,
            bytes: linha.bytesReceived ?? 0,
            amostras: linha.totalSamplesReceived ?? 0,
            ocultadas: linha.concealedSamples ?? 0,
            energia: linha.totalAudioEnergy ?? 0,
          })
        }
        if (linha.type === "outbound-rtp" && linha.kind === "audio") {
          dados.saida.push({ pacotes: linha.packetsSent ?? 0, bytes: linha.bytesSent ?? 0 })
        }
        if (linha.type === "candidate-pair" && typeof linha.availableOutgoingBitrate === "number") {
          dados.bandaDeSaida = Math.max(dados.bandaDeSaida ?? 0, linha.availableOutgoingBitrate)
        }
      })
      return dados
    }),
  )
