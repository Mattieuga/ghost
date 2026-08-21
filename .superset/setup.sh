#!/usr/bin/env bash
set -euo pipefail

echo "Setting up Ghost worktree: ${SUPERSET_WORKSPACE_NAME:-unknown}"

command -v pnpm >/dev/null || { echo "pnpm not on PATH"; exit 1; }
command -v cargo >/dev/null || { echo "cargo not on PATH (rustup toolchain)"; exit 1; }

ROOT="${SUPERSET_ROOT_PATH:-}"
if [[ -n "$ROOT" ]]; then
  this_root="$(pwd -P)"
  main_root="$(cd "$ROOT" && pwd -P)"
  if [[ "$this_root" != "$main_root" ]]; then
    target="$ROOT/src-tauri/target"
    mkdir -p "$target"
    target_abs="$(cd "$target" && pwd -P)"
    if [[ -L src-tauri/target ]]; then
      linked_target="$(cd src-tauri/target 2>/dev/null && pwd -P || true)"
      if [[ "$linked_target" != "$target_abs" ]]; then
        echo "src-tauri/target points somewhere unexpected: ${linked_target:-broken symlink}"
        echo "Expected: $target_abs"
        exit 1
      fi
    elif [[ -e src-tauri/target ]]; then
      echo "src-tauri/target already exists but is not the shared target symlink"
      echo "Move it aside, then rerun setup. Expected target: $target_abs"
      exit 1
    else
      ln -s "$target_abs" src-tauri/target
      echo "Linked src-tauri/target -> $target_abs"
    fi
  fi
fi

git_dir="$(git rev-parse --git-dir 2>/dev/null || true)"
common_dir="$(git rev-parse --git-common-dir 2>/dev/null || true)"
in_worktree=0
if [[ -n "$git_dir" && -n "$common_dir" ]]; then
  git_dir_abs="$(cd "$(dirname "$git_dir")" && pwd -P)/$(basename "$git_dir")"
  common_dir_abs="$(cd "$common_dir" && pwd -P)"
  if [[ "$git_dir_abs" != "$common_dir_abs" ]]; then
    in_worktree=1
  fi
fi

workspace_name="${SUPERSET_WORKSPACE_NAME:-}"
if [[ -z "$workspace_name" && "$in_worktree" -eq 1 ]]; then
  workspace_name="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
fi
if [[ -n "$workspace_name" && "$workspace_name" != "HEAD" ]]; then
  mkdir -p .superset
  printf '%s\n' "$workspace_name" > .superset/workspace-name
  echo "Wrote .superset/workspace-name ($workspace_name)"
fi

pnpm install --frozen-lockfile
cargo fetch --manifest-path src-tauri/Cargo.toml

echo "Workspace ready."
echo "Tests: pnpm test && pnpm build && cargo test --manifest-path src-tauri/Cargo.toml"
echo "Native app: wait for the user to ask, then pnpm tauri dev (one Ghost at a time)."
