import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.BOTADMIN_API_TARGET || "https://botadmin.shop";

export default defineConfig(({ command }) => ({
  // Keep the production mount stable while allowing localhost:5173/ to be
  // the real public landing page during the isolated React migration.
  base: command === "serve" ? "/" : "/dashboard/react/",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true, secure: true, cookieDomainRewrite: "" },
      "/ws": { target: apiTarget, changeOrigin: true, secure: true, ws: true },
      "/uploads": { target: apiTarget, changeOrigin: true, secure: true },
      "/storage": { target: apiTarget, changeOrigin: true, secure: true },
      "/media": { target: apiTarget, changeOrigin: true, secure: true },
      "/images": { target: apiTarget, changeOrigin: true, secure: true },
    },
  },
  build: {
    outDir: "../public/dashboard/react",
    emptyOutDir: true,
    sourcemap: true,
  },
}));
