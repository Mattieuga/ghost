# Releasing Ghost

## Prerequisites

- macOS with Apple Silicon
- Rust toolchain installed
- Node.js 20.19+ and pnpm
- `gh` CLI authenticated with GitHub

## Steps

### 1. Update the version

Bump the version in `src-tauri/tauri.conf.json`:

```json
"version": "0.2.0"
```

### 2. Build the release binary

```sh
pnpm install
pnpm tauri build
```

The DMG will be output to:

```
src-tauri/target/release/bundle/dmg/Ghost_<version>_aarch64.dmg
```

### 3. Tag the release

```sh
git add -A
git commit -m "release: v<version>"
git tag v<version>
git push origin main --tags
```

### 4. Create the GitHub release

```sh
gh release create v<version> \
  src-tauri/target/release/bundle/dmg/Ghost_*_aarch64.dmg \
  --title "Ghost v<version>" \
  --notes "Release notes here" \
  --prerelease  # remove for stable releases
```

### 5. Update the landing page

Update the download button URL in `docs/index.html` to point to the new DMG:

```html
<a href="https://github.com/Mattieuga/ghost/releases/download/v<version>/Ghost_<version>_aarch64.dmg" ...>
```

Commit and push so GitHub Pages picks up the change.

### 6. Verify

- Check the release page: https://github.com/Mattieuga/ghost/releases
- Download the DMG and test the install
- Confirm the app version matches in About dialog

## Versioning

Unless told otherwise, bump by a minor version (e.g. `0.1.0` → `0.2.0`).

## Notes

- The app is not code-signed or notarized. Users need to run `xattr -cr /Applications/Ghost.app` after installing. Include this in release notes.
- Currently only builds for macOS Apple Silicon (aarch64)
- The `icon-dev.png` dock icon only appears in debug builds, not in releases
- File associations for `.md`/`.markdown` are configured in `tauri.conf.json`
