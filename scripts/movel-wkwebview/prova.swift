/*
 * The WKWebView rig: the same proof as `sfu-script-transform-por-motor.mjs`,
 * inside the wrapper an iOS app has to use.
 *
 *   swiftc -O prova.swift -o prova
 *   ./prova http://127.0.0.1:8931/pagina.html
 *   ./prova enclave://localhost/pagina.html --ficheiro pagina.html
 *
 * Two ways to load, because they're two different things and only one is
 * what Capacitor does. `http://127.0.0.1` is the permissive path; a CUSTOM
 * SCHEME served by `WKURLSchemeHandler` is what Capacitor uses on iOS
 * (`capacitor://localhost`), and it's where media capture historically breaks.
 * Measuring only the first is measuring the engine and calling it the app.
 *
 * This is macOS WebKit, not iOS. The gap is stated in the document; what
 * this rig closes is the bigger gap, Safari against WKWebView.
 */
import AppKit
import WebKit

final class Recolha: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
  var saida: String?
  func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
    if m.name == "log" {
      FileHandle.standardError.write("[pagina] \(m.body)\n".data(using: .utf8)!)
      return
    }
    saida = m.body as? String
  }
  /*
   * The content process DYING is the failure that reads as "engine didn't respond":
   * all timers stop at once and the page goes silent. Without this delegation,
   * a WebKit crash counts as a timeout.
   */
  func webViewWebContentProcessDidTerminate(_ w: WKWebView) {
    saida = "{\"processoDeConteudoMorreu\":true}"
  }
  // A local certificate is not worth asking a user about when it doesn't exist.
  func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) {
    saida = "{\"erroDeNavegacao\":\"\(e.localizedDescription)\"}"
  }
}

/** Serves ONE file under a custom scheme, which is what Capacitor does. */
final class EsquemaLocal: NSObject, WKURLSchemeHandler {
  let corpo: Data
  init(corpo: Data) { self.corpo = corpo }
  func webView(_ w: WKWebView, start task: WKURLSchemeTask) {
    let url = task.request.url!
    let resposta = HTTPURLResponse(
      url: url, statusCode: 200, httpVersion: "HTTP/1.1",
      headers: ["Content-Type": "text/html; charset=utf-8", "Content-Length": "\(corpo.count)"])!
    task.didReceive(resposta)
    task.didReceive(corpo)
    task.didFinish()
  }
  func webView(_ w: WKWebView, stop task: WKURLSchemeTask) {}
}

extension HTTPURLResponse {
  convenience init!(url: URL, statusCode: Int, httpVersion: String?, headers: [String: String]) {
    self.init(url: url, statusCode: statusCode, httpVersion: httpVersion, headerFields: headers)
  }
}

let args = CommandLine.arguments
guard args.count >= 2, let alvo = URL(string: args[1]) else {
  FileHandle.standardError.write("uso: prova <url> [--ficheiro <html>]\n".data(using: .utf8)!)
  exit(2)
}
let segundos = Double(ProcessInfo.processInfo.environment["PROVA_SEGUNDOS"] ?? "90") ?? 90

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let cfg = WKWebViewConfiguration()
cfg.mediaTypesRequiringUserActionForPlayback = []
let recolha = Recolha()
cfg.userContentController.add(recolha, name: "prova")
cfg.userContentController.add(recolha, name: "log")
// An error inside the page, with no console to see it, is the rig lying that
// the engine didn't respond. It surfaces here.
cfg.userContentController.addUserScript(WKUserScript(
  source: """
  (() => {
    const enviar = (t) => { try { window.webkit.messageHandlers.log.postMessage(String(t)) } catch (e) {} }
    const antigo = console.log.bind(console)
    console.log = (...a) => { enviar(a.join(' ')); antigo(...a) }
    window.onerror = (m, f, l) => enviar('ERRO ' + m + ' @' + l)
    window.onunhandledrejection = (e) => enviar('REJEICAO ' + (e.reason && e.reason.message || e.reason))
  })()
  """,
  injectionTime: .atDocumentStart, forMainFrameOnly: false))

// Custom scheme, when asked, the Capacitor path.
var indice = 2
var ficheiroLocal: String?
while indice < args.count {
  if args[indice] == "--ficheiro", indice + 1 < args.count { ficheiroLocal = args[indice + 1]; indice += 2 }
  else { indice += 1 }
}
if let caminho = ficheiroLocal, let esquema = alvo.scheme, esquema != "http", esquema != "https" {
  let corpo = FileManager.default.contents(atPath: caminho) ?? Data()
  cfg.setURLSchemeHandler(EsquemaLocal(corpo: corpo), forURLScheme: esquema)
}

let wv = WKWebView(frame: NSRect(x: 0, y: 0, width: 1024, height: 768), configuration: cfg)
wv.navigationDelegate = recolha
wv.uiDelegate = recolha
let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1024, height: 768),
                   styleMask: [.borderless], backing: .buffered, defer: false)
win.contentView = wv
win.orderFrontRegardless()

wv.load(URLRequest(url: alvo))

let limite = Date().addingTimeInterval(segundos)
while recolha.saida == nil && Date() < limite {
  _ = RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.1))
}
print(recolha.saida ?? "{\"erro\":\"sem resposta dentro do tempo\"}")
exit(recolha.saida == nil ? 1 : 0)
