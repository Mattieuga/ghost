# Releasing Ghost

## Prerequisites

- macOS with Apple Silicon
- Rust toolchain installed
- Node.js 20.19+ and pnpm
- `gh` CLI authenticated with GitHub

## One-Time Setup: Signing Key

Generate an Ed25519 key pair for signing update artifacts:

```sh
pnpm tauri signer generate -w ~/.tauri/ghost.key
```

This outputs a **public key** (printed to stdout) and a **private key** (saved to the file). Then:

1. Copy the public key into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
2. Add these GitHub Actions secrets to the repository:
   - `TAURI_SIGNING_PRIVATE_KEY` — the private key content (or file path)
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password (empty string if none)

**Back up the private key securely.** If the key is lost, no updates can ever be pushed to existing installations. Keep an encrypted copy outside of GitHub (e.g., 1Password, encrypted USB).

## Automated Release (Recommended)

Releases are built and published automatically by GitHub Actions when a version tag is pushed.

### Steps

#### 1. Bump the version

Update the version in all three files:

- `src-tauri/tauri.conf.json` → `"version"`
- `package.json` → `"version"`
- `src-tauri/Cargo.toml` → `version`

Unless told otherwise, bump by a minor version (e.g. `0.5.0` → `0.6.0`).

#### 2. Commit and tag

```sh
git add src-tauri/tauri.conf.json package.json src-tauri/Cargo.toml
git commit -m "release: v<version>"
git tag v<version>
git push origin main --tags
```

#### 3. GitHub Actions builds and publishes

The workflow (`.github/workflows/release.yml`) automatically:

- Builds the app for macOS Apple Silicon
- Signs update artifacts with the Ed25519 key
- Creates a GitHub Release with:
  - `Ghost_<version>_aarch64.dmg` — for new installs
  - `Ghost.app.tar.gz` + `.sig` — for the auto-updater
  - `latest.json` — update manifest checked by installed apps

#### 4. Update the landing page

Update the download button URL in `docs/index.html` to point to the new DMG:

```html
<a href="https://github.com/Mattieuga/ghost/releases/download/v<version>/Ghost_<version>_aarch64.dmg" ...>
```

Commit and push so GitHub Pages picks up the change.

#### 5. Verify

- Check the release page: https://github.com/Mattieuga/ghost/releases
- Confirm `latest.json` is present as a release asset
- Download the DMG and test the install
- Launch an older version and verify it detects the update

## Manual Release (Fallback)

If GitHub Actions is unavailable, build locally:

```sh
pnpm install
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/ghost.key)" pnpm tauri build --target aarch64-apple-darwin
```

The DMG will be output to:

```
src-tauri/target/release/bundle/dmg/Ghost_<version>_aarch64.dmg
```

Create the release manually:

```sh
gh release create v<version> \
  src-tauri/target/release/bundle/dmg/Ghost_*_aarch64.dmg \
  --title "Ghost v<version>" \
  --notes "Release notes here"
```

**Note:** Manual releases do not include `latest.json` or `.tar.gz` updater artifacts unless you generate them separately. The auto-updater will not detect manually published releases unless the update manifest is included.

## Notes

- The app is not code-signed or notarized. Users need to right-click → Open and approve in Privacy & Security on first launch.
- Currently only builds for macOS Apple Silicon (aarch64)
- The `icon-dev.png` dock icon only appears in debug builds, not in releases
- File associations for `.md`/`.markdown` are configured in `tauri.conf.json`
- The auto-updater uses its own Ed25519 signature, independent of Apple code signing
- Existing users on versions before the updater (≤0.5.0) must manually download the first updater-enabled release

## Key Management

| Item | Location |
|---|---|
| Public key | `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` |
| Private key (local) | `~/.tauri/ghost.key` |
| Private key (CI) | GitHub secret `TAURI_SIGNING_PRIVATE_KEY` |
| Password (CI) | GitHub secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |
| Encrypted backup | Keep in a password manager or secure offline storage |

**If the private key is compromised:** There is no key rotation mechanism. All existing installations have the public key baked in. A compromised key means an attacker could sign malicious updates. Immediately revoke the GitHub secret, rotate the key, and ship a new version that users must manually download.
