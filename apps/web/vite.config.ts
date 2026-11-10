import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { aberturaNoHtml } from "./abertura-no-html.js"

export default defineConfig({
  /**
   * The app lives in `/app/`, and the root is the public page.
   *
   * The vault of someone with an account is NOT lost: it lives in IndexedDB,
   * which is per ORIGIN, not per path. A subdomain would have wiped everyone;
   * a path wipes no one. The gateway is per host and doesn't change. Invites
   * depend on this foundation: they are `https://<servidor>/app/convite#…`,
   * and the literal `/app/convite` is in the core (`INVITE_PATH`). Changing
   * the base breaks every link already distributed.
   */
  base: "/app/",
  // The splash in `index.html`, for the first frame: see `abertura-no-html.ts`.
  plugins: [react(), aberturaNoHtml()],
  server: {
    port: 5173,
    strictPort: true,
    // Loopback only. A dev server for an app that holds private keys has no
    // business listening on the local network.
    host: "127.0.0.1",
  },
  build: {
    target: "es2023",
    // Source maps (9/11/2026). Disabled in 1.2.1 only because Orwell went
    // proprietary; under AGPL the source code is public and the `.map` served from
    // `/app/assets/` hides nothing.
    sourcemap: true,
  },
})
