---
title: "feat: In-app auto-update via Tauri updater plugin"
type: feat
date: 2026-04-03
---

# In-App Auto-Update via Tauri Updater Plugin

## Overview

Add automatic update checking and in-app updating to Ghost using `tauri-plugin-updater`, with GitHub Releases as the update backend and a GitHub Actions workflow for automated builds and signed releases. Users will see a non-intrusive banner when updates are available and can also manually check from Settings.

## Problem Statement / Motivation

Ghost is currently distributed as a manual DMG download. Users have no way to know when a new version is available — they must visit the GitHub Releases page. This creates:

- **Low update adoption** — users stay on old versions indefinitely
- **No feedback loop** — bug fixes don't reach users
- **Manual release process** — the developer must build locally, tag, upload, and update the landing page by hand

The Tauri ecosystem has a first-party updater plugin that solves this cleanly with GitHub Releases as the backend — no custom server required.

## Proposed Solution

Use `tauri-plugin-updater` with:
- **Ed25519 signing** (Tauri's own key pair, independent of Apple code signing)
- **GitHub Releases** as the static update endpoint (`latest.json`)
- **`tauri-apps/tauri-action`** GitHub Action for CI builds + signed release artifacts
- **Non-intrusive banner UI** for update notifications + manual check in Settings

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  GitHub Actions (on tag push v*)                    │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ Build + Sign  │→ │ Upload DMG + │→ │ Publish  │ │
│  │ (tauri-action)│  │ .tar.gz +    │  │ Release  │ │
│  │               │  │ latest.json  │  │          │ │
│  └───────────────┘  └──────────────┘  └──────────┘ │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│  Ghost App (installed on user's machine)            │
│                                                     │
│  Launch → 5s delay → check(latest.json)             │
│                       │                             │
│              ┌────────┴────────┐                    │
│              │ Update found    │ No update → silent  │
│              ▼                 │                     │
│  ┌─────────────────────┐      │                     │
│  │ Banner: "v0.6.0     │      │                     │
│  │ available"           │      │                     │
│  │ [Update Now] [Later]│      │                     │
│  └─────────┬───────────┘      │                     │
│            │ Update Now        │                     │
│            ▼                   │                     │
│  ┌─────────────────────┐      │                     │
│  │ Download + progress │      │                     │
│  │ Flush pending saves │      │                     │
│  │ Install → Relaunch  │      │                     │
│  └─────────────────────┘      │                     │
└─────────────────────────────────────────────────────┘
```

### Phase 1: Dependencies + Configuration

**Rust dependencies** — `src-tauri/Cargo.toml`:

```toml
[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

**JS dependencies:**

```bash
pnpm add @tauri-apps/plugin-updater @tauri-apps/plugin-process
```

**Register plugins** — `src-tauri/src/lib.rs` (inside the existing builder, before `.setup()`):

```rust
.plugin(tauri_plugin_updater::Builder::new().build())
.plugin(tauri_plugin_process::init())
```

**Updater config** — `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "<GENERATED_PUBLIC_KEY>",
      "endpoints": [
        "https://github.com/Mattieuga/ghost/releases/latest/download/latest.json"
      ]
    }
  }
}
```

**Capabilities** — `src-tauri/capabilities/default.json`:

```json
"updater:default",
"process:allow-restart"
```

**Generate signing key pair** (one-time, manual):

```bash
pnpm tauri signer generate -w ~/.tauri/ghost.key
```

Store the private key as GitHub Actions secrets: `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

**Fix version drift** — align `src-tauri/Cargo.toml` version to `0.5.0` (currently `0.1.0`).

### Phase 2: Frontend — Update Hook + Banner

**New file: `src/hooks/use-updater.ts`**

A React hook that manages the full update lifecycle:

```typescript
// State machine: idle → checking → available → downloading → installing → done
// 
// Exports:
//   updateState: "idle" | "checking" | "available" | "downloading" | "installing"
//   updateVersion: string | null
//   updateNotes: string | null
//   downloadProgress: { downloaded: number; total: number | null }
//   checkForUpdate(): Promise<void>
//   installUpdate(): Promise<void>
//   dismissUpdate(): void
//   dismissed: boolean
//
// On mount (if not dismissed): setTimeout → checkForUpdate() after 5 seconds
// checkForUpdate(): call check() from @tauri-apps/plugin-updater
// installUpdate(): flush pending editor saves → downloadAndInstall() → relaunch()
// dismissUpdate(): set dismissed = true (in-memory only, resets on next launch)
```

Key behaviors:
- Auto-check fires once on mount with a 5-second delay
- `dismissed` is in-memory — resets every app launch
- Before `relaunch()`, flush the editor's debounced save (emit a `flush-saves` event or expose a save-now function)
- Share state between the banner and Settings so only one network request is made
- All errors during auto-check are silently swallowed (logged to console)
- Errors during manual check show user-facing messages

**New file: `src/components/ui/update-banner.tsx`**

A fixed-position banner at the bottom of the viewport (z-40, below modals):

```
┌──────────────────────────────────────────────────────┐
│  ↑ Ghost v0.6.0 is available   [Update Now] [Later] │
└──────────────────────────────────────────────────────┘
```

States:
- **Available**: version + "Update Now" / "Later" buttons
- **Downloading**: progress bar with percentage (`downloaded / total`)
- **Installing**: "Installing update..." spinner
- **Error** (manual check only): "Update failed. Try again later."

Design notes:
- Sits at z-40 (below Settings at z-50, below CommandPalette)
- Subtle slide-up animation on appear
- Dismisses on "Later" click
- Does NOT appear if user is in Settings (the Settings general tab handles it)

### Phase 3: Settings Integration

**Modify: `src/components/settings/tabs/general-tab.tsx`**

Add two new sections to the General tab:

1. **Version display** — "Ghost v0.5.0" text at the bottom of the card
2. **Check for Updates button** — triggers `checkForUpdate()` from the shared hook

```
┌─────────────────────────────────────────────┐
│  Show all files                      [toggle]│
│  Display all file types in sidebar           │
│──────────────────────────────────────────────│
│  Updates                                     │
│  Ghost v0.5.0                                │
│  [Check for Updates]                         │
│    → "Checking..."                           │
│    → "Update available: v0.6.0 [Install]"    │
│    → "You're up to date"                     │
└─────────────────────────────────────────────┘
```

The `useUpdater` hook is shared via context or prop drilling from `layout.tsx`, so both the banner and Settings read the same state.

### Phase 4: GitHub Actions CI/CD

**New file: `.github/workflows/release.yml`**

Triggered on tag push matching `v*`:

```yaml
name: Release
on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    permissions:
      contents: write
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
      - uses: pnpm/action-setup@v4
      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin
      - uses: swatinem/rust-cache@v2
        with:
          workspaces: './src-tauri -> target'
      - run: pnpm install
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: v__VERSION__
          releaseName: 'Ghost v__VERSION__'
          releaseBody: 'See assets to download and install.'
          releaseDraft: false
          prerelease: false
          includeUpdaterJson: true
          args: '--target aarch64-apple-darwin'
```

This produces: DMG (for new installs), `.app.tar.gz` + `.sig` (for updater), and `latest.json` (update manifest).

### Phase 5: Update RELEASING.md

Replace the manual build/release steps with the new workflow:

1. Bump version in `tauri.conf.json`, `package.json`, `Cargo.toml`
2. Commit: `git commit -m "release: v<version>"`
3. Tag + push: `git tag v<version> && git push origin main --tags`
4. GitHub Actions builds, signs, and publishes the release automatically
5. Verify: check the release page for DMG + `latest.json` assets
6. Update landing page download URL

Add a new section documenting:
- Where the signing key is stored / backed up
- How to regenerate if lost (spoiler: you can't push updates to existing users)
- The GitHub secrets that must be configured

## Acceptance Criteria

- [x] `tauri-plugin-updater` and `tauri-plugin-process` added as dependencies (Rust + JS)
- [x] Plugins registered in `lib.rs`, capabilities added to `default.json`
- [x] `tauri.conf.json` has `createUpdaterArtifacts: true`, public key, and endpoint
- [ ] Signing key pair generated and private key stored as GitHub secret
- [x] `Cargo.toml` version aligned to `0.5.0`
- [x] `useUpdater` hook implements: check, download+install, dismiss, progress tracking
- [x] Auto-check fires 5 seconds after app launch (silent on error)
- [x] Update banner appears at bottom of screen when update is available
- [x] Banner shows download progress during update
- [x] Editor debounced save is flushed before relaunch
- [x] Settings → General shows current version and "Check for Updates" button
- [x] Manual check shows "up to date" or "update available" with install button
- [x] Manual check shows error message on failure
- [x] `.github/workflows/release.yml` triggers on tag push, builds, signs, and publishes
- [x] `latest.json` is included as a release asset
- [x] `RELEASING.md` updated with new workflow and key management docs

## Dependencies & Risks

### Dependencies
- `tauri-plugin-updater` v2 (Rust crate + `@tauri-apps/plugin-updater` npm)
- `tauri-plugin-process` v2 (for `relaunch()`)
- `tauri-apps/tauri-action` GitHub Action
- Ed25519 signing key pair (generated once, stored forever)

### Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Gatekeeper re-quarantine after update** — macOS may block the updated unsigned app from launching | High | Test manually before shipping. If blocked, fall back to "notification + download link" instead of in-place update |
| **Signing key loss** — if the Ed25519 private key is lost, no updates can ever be pushed to existing users | Critical | Document backup procedure in RELEASING.md. Keep encrypted backup outside GitHub |
| **First-time migration** — existing v0.5.0 users have no updater; they must manually download the first version with the updater | Medium | Announce prominently in release notes. Update landing page. The updater only benefits users on v0.6.0+ |
| **Data loss on relaunch** — the editor debounce-saves with 1s delay; if relaunch fires before flush, last edits are lost | Medium | Flush pending saves before calling `relaunch()`. Add a brief "Restarting..." delay |
| **GitHub rate limiting** — many simultaneous users checking `latest.json` could be throttled | Low | GitHub Releases CDN is generous. Not a concern until thousands of users |

## Success Metrics

- Users on the updater-enabled version receive and install updates without visiting GitHub
- Release process goes from ~10 manual steps to: bump version, tag, push
- Zero data loss during update installs

## Future Considerations

- **Apple code signing + notarization** — eliminates Gatekeeper friction ($99/year Developer account)
- **Release notes display** — show "What's New" after update (the `update.body` field has the content)
- **Auto-check opt-out toggle** — Settings toggle to disable automatic checking
- **Beta channel** — use prerelease GitHub Releases + a separate endpoint for opt-in beta users
- **Intel Mac support** — add `x86_64-apple-darwin` to the CI build matrix
- **Delta updates** — Sparkle plugin supports downloading only the diff (future optimization)

## References

### Internal
- `src-tauri/src/lib.rs` — plugin registration (line 24-28), menu bar setup (line 54-168)
- `src-tauri/tauri.conf.json` — app config, needs `plugins.updater` and `bundle.createUpdaterArtifacts`
- `src-tauri/capabilities/default.json` — needs `updater:default` + `process:allow-restart`
- `src-tauri/Cargo.toml` — needs updater + process deps, version fix (line 3)
- `src/components/settings/tabs/general-tab.tsx` — add version display + check button
- `src/components/editor/markdown-editor.tsx:43-53` — debounced save (flush before relaunch)
- `RELEASING.md` — current manual process, needs overhaul

### External
- [Tauri v2 Updater Plugin docs](https://v2.tauri.app/plugin/updater/)
- [tauri-apps/tauri-action](https://github.com/tauri-apps/tauri-action)
- [Tauri v2 GitHub Actions Pipeline](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri v2 macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)
