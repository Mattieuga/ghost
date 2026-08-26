import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { formatDevWorkspaceLabel } from "./src/lib/dev-workspace-label";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const tauriDebug = process.env.TAURI_ENV_DEBUG === "true";
// @ts-expect-error process is a nodejs global
const localDevBuild = process.env.GHOST_DEV_BUILD === "true";

function gitOutput(command: string): string | null {
  try {
    const value = execSync(command, { encoding: "utf8" }).trim();
    return value || null;
  } catch {
    return null;
  }
}

function readWorkspaceName(): string | null {
  // @ts-expect-error process is a nodejs global
  const fromEnv = process.env.SUPERSET_WORKSPACE_NAME?.trim();
  if (fromEnv) return fromEnv;

  const file = path.resolve(__dirname, ".superset/workspace-name");
  if (!existsSync(file)) return null;
  const fromFile = readFileSync(file, "utf8").trim();
  return fromFile || null;
}

function isGitWorktree(): boolean {
  const gitDir = gitOutput("git rev-parse --git-dir");
  const commonDir = gitOutput("git rev-parse --git-common-dir");
  if (!gitDir || !commonDir) return false;
  return path.resolve(gitDir) !== path.resolve(commonDir);
}

function resolveDevWorkspace(): { label: string; workspace: string } {
  const named = readWorkspaceName();
  if (named) {
    return { label: formatDevWorkspaceLabel(named), workspace: named };
  }
  if (isGitWorktree()) {
    const branch = gitOutput("git rev-parse --abbrev-ref HEAD");
    if (branch && branch !== "HEAD") {
      return { label: formatDevWorkspaceLabel(branch), workspace: branch };
    }
  }
  return { label: "DEV", workspace: "" };
}

const devWorkspace = resolveDevWorkspace();

export default defineConfig(async ({ command }) => ({
  plugins: [react(), tailwindcss()],
  define: {
    __GHOST_DEV_BUILD__: JSON.stringify(command === "serve" || tauriDebug || localDevBuild),
    __GHOST_DEV_LABEL__: JSON.stringify(devWorkspace.label),
    __GHOST_DEV_WORKSPACE__: JSON.stringify(devWorkspace.workspace),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  build: {
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, "index.html"),
        web: path.resolve(__dirname, "web.html"),
      },
    },
  },
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
      // Tailwind v4 registers scanned content files as HMR dependencies and
      // requests a full page reload when they change. Ghost edits these
      // repo-local fixtures at runtime, so they are data, not app source.
      ignored: [
        "**/src-tauri/**",
        "**/*.md",
        "**/docs/**",
        "**/AppIcons/**",
        "**/example test files/**",
      ],
    },
  },
}));
