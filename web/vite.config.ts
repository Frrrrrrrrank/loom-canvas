import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET = process.env.LOOM_SERVER_URL || "http://127.0.0.1:8765";

// During `pnpm dev` the canvas runs on :5173 and proxies API + SSE + artifacts
// to the long-running Loom server. The production build is served directly by
// the Loom server from web/dist.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true, ws: false },
      "/artifacts": { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1500,
  },
});
