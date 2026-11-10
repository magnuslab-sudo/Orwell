import { buildServer } from "./app.js"
import { loadConfig } from "./config.js"

const config = loadConfig()
const enclave = await buildServer(config)

await enclave.app.listen({ host: config.bindHost, port: config.bindPort })

process.stdout.write(
  [
    `enclave homeserver  ${config.serverName}`,
    `  listening         http://${config.bindHost}:${config.bindPort}`,
    `  gateway           ws://${config.bindHost}:${config.bindPort}/_enclave/gateway`,
    `  database          ${config.databasePath}`,
    `  retention         ${config.retentionDays === 0 ? "none (delivery only)" : `${config.retentionDays} days`}`,
    `  federation        ${config.allowlist.length ? `allowlist: ${config.allowlist.join(", ")}` : "open"}`,
    "",
  ].join("\n"),
)

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void enclave.close().then(() => process.exit(0))
  })
}
