import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "path";
import { defineConfig, type Plugin } from "vite";
import baseConfig from "./vite.config";

/**
 * Everything served at ghosteditor.app, assembled for static hosting:
 *
 *   /                         the marketing page (site/index.html and its images)
 *   /auth/native/callback/    the Mac app's universal-link sign-in callback
 *   /.well-known/apple-app-site-association
 *   /app/                     the browser client, built from app.html
 *
 * The browser client is the same code and plugins as the desktop build
 * with `app.html` as the only entry, written out as `app/index.html` with
 * `/app/` as its base so its assets resolve from that path. The desktop
 * entry never ships to the web host.
 *
 *   pnpm build:web   →   dist-web/
 */
/** The public site, copied as is. Project docs live in `docs/` and never ship. */
const SITE_DIR = path.resolve(__dirname, "site");
const OUT_DIR = path.resolve(__dirname, "dist-web");
const APP_PATH = "/app/";

function siteAssembly(): Plugin {
  return {
    name: "ghost-site-assembly",
    // Vite's own HTML plugin emits the page during generateBundle; running
    // after it lets the rename see the file.
    enforce: "post",
    generateBundle(_options, bundle) {
      const entry = bundle["app.html"];
      if (!entry) return;
      entry.fileName = "index.html";
      bundle["index.html"] = entry;
      delete bundle["app.html"];
    },
    writeBundle(options) {
      const appDir = options.dir ?? path.join(OUT_DIR, "app");
      const stray = path.join(appDir, "app.html");
      if (existsSync(stray)) renameSync(stray, path.join(appDir, "index.html"));
      mkdirSync(OUT_DIR, { recursive: true });
      for (const name of readdirSync(SITE_DIR)) {
        if (name === "README.md") continue;
        cpSync(path.join(SITE_DIR, name), path.join(OUT_DIR, name), { recursive: true });
      }
    },
  };
}

export default defineConfig(async (env) => {
  const base = await (typeof baseConfig === "function" ? baseConfig(env) : baseConfig);
  rmSync(OUT_DIR, { recursive: true, force: true });
  return {
    ...base,
    base: APP_PATH,
    plugins: [...(base.plugins ?? []), siteAssembly()],
    build: {
      outDir: path.join(OUT_DIR, "app"),
      emptyOutDir: true,
      rollupOptions: {
        input: { app: path.resolve(__dirname, "app.html") },
      },
    },
  };
});
