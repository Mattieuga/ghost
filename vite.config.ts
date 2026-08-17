import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const tauriDebug = process.env.TAURI_ENV_DEBUG === "true";
// @ts-expect-error process is a nodejs global
const localDevBuild = process.env.GHOST_DEV_BUILD === "true";

export default defineConfig(async ({ command }) => ({
  plugins: [react(), tailwindcss()],
  define: {
    __GHOST_DEV_BUILD__: JSON.stringify(command === "serve" || tauriDebug || localDevBuild),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/*.md", "**/docs/**", "**/AppIcons/**"],
    },
  },
}));
