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
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        secure: true,
        cookieDomainRewrite: "",
        // Production auth cookies are intentionally Secure + SameSite=None.
        // The isolated local homologation server is HTTP, so retain the
        // session only for localhost by removing those transport attributes
        // from the proxied response. The production bundle never uses this
        // development proxy and therefore keeps the hardened cookie intact.
        configure(proxy) {
          proxy.on("proxyRes", (proxyResponse) => {
            const setCookie = proxyResponse.headers["set-cookie"];
            if (!setCookie) return;
            proxyResponse.headers["set-cookie"] = setCookie.map((cookie) =>
              cookie
                .replace(/;\s*Secure/gi, "")
                .replace(/;\s*SameSite=None/gi, "; SameSite=Lax"),
            );
          });
        },
      },
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
