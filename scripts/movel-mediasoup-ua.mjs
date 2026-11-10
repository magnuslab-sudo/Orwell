/**
 * Does `mediasoup-client` recognize a WKWebView, or does it recognize nothing?
 *
 * The `mediasoup-client` handler choice is a function of User-Agent
 * (`detectDevice()`), and a WKWebView **does not include the `Safari` token in its**,  * measured in this session: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)
 * AppleWebKit/605.1.15 (KHTML, like Gecko)`, and nothing else. A sniffer looking
 * for `Safari` or `Version/` finds neither.
 *
 * This matters more than it seems: `detectDevice()` returning `undefined` means
 * the `Device` doesn't build, means no SFU, and the call falls back to mesh
 *, the same end as a missing cipher, through another door. The cipher passing doesn't
 * save anything if the transport never builds.
 *
 *   node scripts/movel-mediasoup-ua.mjs
 */
import { detectDevice, Device } from "mediasoup-client"

const AGENTES = {
  "WKWebView (medido nesta sessão)":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
  "WKWebView iOS (forma típica, sem token Safari)":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  "Capacitor (applicationNameForUserAgent)":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Orwell/1.0",
  "Safari iOS a sério (com token Safari)":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  "Safari macOS":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  "Chrome Android":
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  "Android WebView (token wv)":
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36",
}

const linhas = []
for (const [nome, agente] of Object.entries(AGENTES)) {
  let detectado
  try {
    detectado = detectDevice(agente) ?? "NENHUM"
  } catch (erro) {
    detectado = "estoirou: " + erro.message
  }
  // `detectDevice` returning a name is not the same as `Device` building.
  // Two questions, and the second decides if there's a call.
  let constroi
  try {
    new Device({ handlerName: detectDevice(agente) })
    constroi = "sim"
  } catch (erro) {
    constroi = "NÃO: " + erro.message
  }
  linhas.push({ agente: nome, detectDevice: detectado, "Device()": constroi })
}

console.table(linhas)
