# Repository Instructions

## GitHub approval

Always stop and get explicit user approval before performing any action that writes to GitHub. This includes pushing commits or tags, creating or merging pull requests, creating releases, dispatching workflows, or otherwise changing the remote repository. Local edits, builds, tests, branches, and commits are allowed without that approval.

## Worktrees and app testing

Ghost is a native Tauri app. Superset workspaces are git worktrees; `.superset/setup.sh` installs JS deps, shares the main checkout's Cargo target dir, and writes the workspace name used by the sidebar DEV badge.

Only one Ghost can run at a time: Vite is pinned to port 1420, and every build uses bundle id `com.ghost.app`. Do not open `http://localhost:1420` in a browser — Tauri APIs will fail there.

When you finish a change:

1. Run `pnpm test`, `pnpm build`, and `cargo test --manifest-path src-tauri/Cargo.toml`.
2. Do **not** start or restart `pnpm tauri dev`.
3. Tell the user the work is ready to click through, then wait.

Relaunch the app only when the user explicitly asks (they will have quit the other Ghost first). Start it from this worktree with `pnpm tauri dev`. The sidebar badge shows a slice of the workspace name so they can see which worktree is running.
