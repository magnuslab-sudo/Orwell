// A worklet that only copies what it hears to the main thread. Used by the
// comparison with the native suppressor in `scripts/e2e-audio.mjs`.
class Gravador extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ativo = true
    this.port.onmessage = () => {
      this.ativo = false
    }
  }

  process(entradas) {
    const canal = entradas[0]?.[0]
    if (canal && this.ativo) this.port.postMessage(canal.slice(0))
    return this.ativo
  }
}

registerProcessor("gravador-de-prova", Gravador)
