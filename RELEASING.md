# Releasing Ghost

## Prerequisites

- macOS with Apple Silicon
- Rust toolchain installed
- Node.js 20.19+ and pnpm
- `gh` CLI authenticated with GitHub
- A paid Apple Developer Program membership
- A Developer ID Application certificate (see One-Time Setup below)
- An app-specific Apple password for notarization (never use the account password)
- Tauri updater signing key generated (see One-Time Setup below)
- All GitHub Actions secrets in the table below configured

## Release Checklist

Follow every step in order. Do not skip any.

### 0. Run the release checks

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm audit
cargo test --manifest-path src-tauri/Cargo.toml
cargo audit --file src-tauri/Cargo.lock
```

Install `cargo-audit` with `cargo install cargo-audit --locked` if it is not
already available.

### 1. Bump the version

Update the version in **all four files** (they must match):

- `src-tauri/tauri.conf.json` → `"version"`
- `package.json` → `"version"`
- `src-tauri/Cargo.toml` → `version`
- `src-tauri/Cargo.lock` → the `ghost` package `version`

Unless told otherwise, bump by a minor version (e.g. `0.6.0` → `0.7.0`).

### 2. Commit the version bump

```sh
git add src-tauri/tauri.conf.json package.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "release: v<version>"
```

### 3. Tag and push

```sh
git tag v<version>
git push origin main --tags
```

This triggers the GitHub Actions release workflow automatically.

### 4. Wait for CI to finish

Watch the build at: https://github.com/Mattieuga/ghost/actions

The workflow builds and tests the app, audits its dependencies, and creates a
draft GitHub Release. It publishes the release only after the disk image passes
Apple notarization and stapling. The published release contains:

- `Ghost_<version>_aarch64.dmg` — for new installs
- `Ghost_aarch64.app.tar.gz` + `.sig` — for the auto-updater
- `latest.json` — update manifest checked by installed apps

### 5. Update the landing page

Update the download button URL in `docs/index.html`:

```html
<a href="https://github.com/Mattieuga/ghost/releases/download/v<version>/Ghost_<version>_aarch64.dmg" ...>
```

### 6. Commit and push the landing page

```sh
git add docs/index.html
git commit -m "docs: update download link to v<version>"
git push origin main
```

GitHub Pages will deploy the updated landing page automatically.

### 7. Verify

- [ ] Release page has all 4 assets (DMG, .tar.gz, .sig, latest.json): https://github.com/Mattieuga/ghost/releases
- [ ] Download the DMG and test the install
- [ ] `spctl` reports `accepted` and `Notarized Developer ID`
- [ ] The notarization ticket is stapled to both the app and DMG
- [ ] Landing page download button points to the new version
- [ ] Launch an older installed version and confirm it detects the update

Verify a downloaded release from Terminal:

```sh
spctl --assess --type execute --verbose=2 /Applications/Ghost.app
xcrun stapler validate /Applications/Ghost.app
xcrun stapler validate Ghost_<version>_aarch64.dmg
codesign --verify --deep --strict --verbose=2 /Applications/Ghost.app
```

## One-Time Setup: Apple Code Signing and Notarization

Apple code signing and Tauri updater signing are separate. Apple signing lets
Gatekeeper verify the app and notarization lets it launch normally after a
browser download. The updater key lets an installed copy of Ghost verify future
updates.

### 1. Create the Developer ID Application certificate

1. Open Xcode → Settings → Apple Accounts and sign in.
2. Select the paid developer team, click **Manage Certificates**, then add a
   **Developer ID Application** certificate.
3. Confirm that the identity is installed with its private key:

   ```sh
   security find-identity -v -p codesigning
   ```

The identity must start with `Developer ID Application:`. An Apple Development,
Apple Distribution, ad-hoc, or self-signed identity will not pass Gatekeeper for
an app distributed outside the Mac App Store.

### 2. Create notarization credentials

At https://account.apple.com/sign-in, create an app-specific password for the
release workflow. Record these values securely:

- `APPLE_ID` — Apple Account email
- `APPLE_PASSWORD` — app-specific password, not the account password
- `APPLE_TEAM_ID` — 10-character team ID from the Apple Developer membership page

### 3. Export the certificate for CI

1. Open Keychain Access → login → My Certificates.
2. Expand the Developer ID Application certificate and verify that a private key
   is nested under it.
3. Export the certificate and private key as a password-protected `.p12` file.
4. Convert the archive to a single-line base64 value:

   ```sh
   openssl base64 -A -in DeveloperIDApplication.p12 -out certificate-base64.txt
   ```

Keep the `.p12`, its password, and `certificate-base64.txt` out of the repository.
The repository ignores these file types as a second line of defense.

### 4. Configure GitHub Actions secrets

Add these in GitHub → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | Contents of `certificate-base64.txt` |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_ID` | Apple Account email |
| `APPLE_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | 10-character Apple Developer team ID |
| `TAURI_SIGNING_PRIVATE_KEY` | Existing Tauri updater private key |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Updater key password, or an empty string |

The release workflow imports the certificate into a temporary keychain, selects
the Developer ID Application identity, signs with the hardened runtime, submits
the build to Apple's notary service, and staples the ticket. No Apple credential
or certificate is committed to Git.

### 5. Test a signed and notarized build locally

Store the notarization credential in the login Keychain. The command prompts for
the app-specific password without adding it to shell history:

```sh
xcrun notarytool store-credentials ghost-notary \
  --apple-id "you@example.com" \
  --team-id "TEAMID"
```

Build with the Developer ID identity. Updater artifacts are disabled for this
local verification build because its updater private key normally lives only in
GitHub Actions:

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
pnpm tauri build \
  --bundles app,dmg \
  --target aarch64-apple-darwin \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Submit the DMG and staple the ticket to both artifacts:

```sh
APP_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Ghost.app"
DMG_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Ghost_<version>_aarch64.dmg"
xcrun notarytool submit "$DMG_PATH" --keychain-profile ghost-notary --wait
xcrun stapler staple "$APP_PATH"
xcrun stapler staple "$DMG_PATH"
```

Use the verification commands above against the generated app and DMG. Never
commit Apple credentials or put them in a repository `.env` file.

## One-Time Setup: Tauri Updater Signing Key

Generate an Ed25519 key pair for signing update artifacts:

```sh
pnpm tauri signer generate -w ~/.tauri/ghost.key
```

Then:

1. Copy the public key into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
2. Add GitHub Actions secrets to the repository:
   - `TAURI_SIGNING_PRIVATE_KEY` — the private key content
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password (empty string if none)

**Back up the private key securely.** If the key is lost, no updates can ever be pushed to existing installations. Keep an encrypted copy outside of GitHub (e.g., 1Password, encrypted USB).

## Manual Release (Fallback)

If GitHub Actions is unavailable, build locally:

```sh
pnpm install
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/ghost.key)" pnpm tauri build --target aarch64-apple-darwin
```

Create the release manually:

```sh
gh release create v<version> \
  src-tauri/target/release/bundle/dmg/Ghost_*_aarch64.dmg \
  --title "Ghost v<version>" \
  --notes "Release notes here"
```

**Note:** Manual releases do not include `latest.json` or updater artifacts unless you generate them separately. The auto-updater will not detect manually published releases.

## Notes

- Currently only builds for macOS Apple Silicon (aarch64).
- The `icon-dev.png` dock icon only appears in debug builds, not in releases.
- File associations for `.md`/`.markdown` are configured in `tauri.conf.json`.
- The auto-updater uses its own Ed25519 signature, independent of Apple code signing.
- Existing users on versions before the updater (≤0.5.0) must manually download the first updater-enabled release.
- Tauri warns that the existing `com.ghost.app` bundle identifier ends in
  `.app`. It is retained for compatibility with installed copies and stored
  settings; change it only as a planned migration, not during a routine release.

## Key Management

| Item | Location |
|---|---|
| Public key | `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` |
| Private key (local) | `~/.tauri/ghost.key` |
| Private key (CI) | GitHub secret `TAURI_SIGNING_PRIVATE_KEY` |
| Password (CI) | GitHub secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |
| Encrypted backup | Keep in a password manager or secure offline storage |

**If the private key is compromised:** There is no key rotation mechanism. All existing installations have the public key baked in. A compromised key means an attacker could sign malicious updates. Immediately revoke the GitHub secret, rotate the key, and ship a new version that users must manually download.
