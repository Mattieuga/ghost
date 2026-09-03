//! Native helpers for the synced-folders product surface: making a synced
//! folder visible to agents inside a repository, listing mounted volumes for
//! the bookmark resolve flow, and removing `.ghost` when sync stops.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::fs::GHOST_METADATA_DIR;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryLink {
    pub link_path: String,
    pub exclude_path: String,
    pub link_created: bool,
    pub exclude_added: bool,
}

/// The repository's `.git` directory, following a worktree's `.git` file.
pub fn git_dir_of(repository: &Path) -> Result<PathBuf, String> {
    let dot_git = repository.join(".git");
    let metadata = fs::symlink_metadata(&dot_git)
        .map_err(|_| format!("{} is not a Git repository", repository.display()))?;
    if metadata.is_dir() {
        return Ok(dot_git);
    }
    let text = fs::read_to_string(&dot_git)
        .map_err(|error| format!("Could not read {}: {error}", dot_git.display()))?;
    let target = text
        .trim()
        .strip_prefix("gitdir:")
        .map(str::trim)
        .ok_or_else(|| format!("{} is not a Git repository", repository.display()))?;
    let target = Path::new(target);
    Ok(if target.is_absolute() { target.to_path_buf() } else { repository.join(target) })
}

/// The common Git directory shared by every worktree of a repository. Its
/// `info/exclude` applies to all of them and is never committed.
pub fn common_git_dir(repository: &Path) -> Result<PathBuf, String> {
    let git_dir = git_dir_of(repository)?;
    let commondir = git_dir.join("commondir");
    if !commondir.is_file() {
        return Ok(git_dir);
    }
    let text = fs::read_to_string(&commondir)
        .map_err(|error| format!("Could not read {}: {error}", commondir.display()))?;
    let target = Path::new(text.trim());
    let resolved = if target.is_absolute() { target.to_path_buf() } else { git_dir.join(target) };
    Ok(fs::canonicalize(&resolved).unwrap_or(resolved))
}

fn validate_link_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        return Err("Invalid link name".to_string());
    }
    Ok(())
}

/// Create `<repository>/<name>` as a symlink to `folder` and list it in the
/// common `info/exclude`, so the repository never shows it as untracked and
/// nothing gets committed. Running twice is a no-op.
pub fn link_into_repository(folder: &Path, repository: &Path, name: &str) -> Result<RepositoryLink, String> {
    validate_link_name(name)?;
    if !folder.is_dir() {
        return Err(format!("{} is not a folder", folder.display()));
    }
    let common = common_git_dir(repository)?;
    let folder_canonical = fs::canonicalize(folder).unwrap_or_else(|_| folder.to_path_buf());

    let link = repository.join(name);
    let link_created = match fs::symlink_metadata(&link) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            let target = fs::read_link(&link)
                .map_err(|error| format!("Could not read the existing link: {error}"))?;
            let target = if target.is_absolute() { target } else { repository.join(target) };
            let target = fs::canonicalize(&target).unwrap_or(target);
            if target != folder_canonical {
                return Err(format!(
                    "{name} already exists in the repository and points somewhere else"
                ));
            }
            false
        }
        Ok(_) => return Err(format!("{name} already exists in the repository")),
        Err(_) => {
            #[cfg(unix)]
            std::os::unix::fs::symlink(&folder_canonical, &link)
                .map_err(|error| format!("Could not create the link: {error}"))?;
            #[cfg(not(unix))]
            return Err("Linking folders is only available on macOS".to_string());
            #[allow(unreachable_code)]
            true
        }
    };

    let info = common.join("info");
    fs::create_dir_all(&info).map_err(|error| format!("Could not create {}: {error}", info.display()))?;
    let exclude = info.join("exclude");
    let existing = fs::read_to_string(&exclude).unwrap_or_default();
    let pattern = format!("/{name}");
    let already = existing
        .lines()
        .any(|line| line.trim() == pattern || line.trim() == name);
    let exclude_added = if already {
        false
    } else {
        let mut text = existing;
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str("# Ghost synced folder link\n");
        text.push_str(&pattern);
        text.push('\n');
        fs::write(&exclude, text).map_err(|error| format!("Could not update {}: {error}", exclude.display()))?;
        true
    };

    Ok(RepositoryLink {
        link_path: link.to_string_lossy().to_string(),
        exclude_path: exclude.to_string_lossy().to_string(),
        link_created,
        exclude_added,
    })
}

#[tauri::command]
pub async fn link_folder_into_repository(
    folder: String,
    repository: String,
    link_name: Option<String>,
) -> Result<RepositoryLink, String> {
    link_into_repository(
        Path::new(&folder),
        Path::new(&repository),
        link_name.as_deref().unwrap_or("notes"),
    )
}

#[tauri::command]
pub async fn mounted_volumes() -> Result<Vec<String>, String> {
    let entries = match fs::read_dir("/Volumes") {
        Ok(entries) => entries,
        Err(_) => return Ok(Vec::new()),
    };
    Ok(entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect())
}

/// Remove `<root>/.ghost` entirely. Only ever aimed at the metadata folder.
#[tauri::command]
pub async fn remove_ghost_metadata_dir(root: String) -> Result<(), String> {
    let dir = Path::new(&root).join(GHOST_METADATA_DIR);
    if dir.file_name().and_then(|name| name.to_str()) != Some(GHOST_METADATA_DIR) {
        return Err("Refusing to remove anything but a .ghost folder".to_string());
    }
    match fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not remove {}: {error}", dir.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ghost-sync-links-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::canonicalize(&dir).unwrap()
    }

    #[test]
    fn links_a_folder_and_excludes_it_once() {
        let base = scratch("link");
        let repo = base.join("repo");
        fs::create_dir_all(repo.join(".git")).unwrap();
        let notes = base.join("Ghost").join("Pepper notes");
        fs::create_dir_all(&notes).unwrap();

        let first = link_into_repository(&notes, &repo, "notes").unwrap();
        assert!(first.link_created);
        assert!(first.exclude_added);
        assert_eq!(fs::read_link(repo.join("notes")).unwrap(), notes);
        let exclude = fs::read_to_string(repo.join(".git").join("info").join("exclude")).unwrap();
        assert!(exclude.contains("/notes\n"));

        let second = link_into_repository(&notes, &repo, "notes").unwrap();
        assert!(!second.link_created);
        assert!(!second.exclude_added);
        assert_eq!(exclude, fs::read_to_string(&second.exclude_path).unwrap());

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_worktree_shares_the_common_exclude_file() {
        let base = scratch("worktree");
        let main = base.join("main");
        let worktree_git = main.join(".git").join("worktrees").join("feature");
        fs::create_dir_all(&worktree_git).unwrap();
        fs::write(worktree_git.join("commondir"), "../..\n").unwrap();
        let feature = base.join("feature");
        fs::create_dir_all(&feature).unwrap();
        fs::write(feature.join(".git"), format!("gitdir: {}\n", worktree_git.display())).unwrap();
        let notes = base.join("notes");
        fs::create_dir_all(&notes).unwrap();

        let link = link_into_repository(&notes, &feature, "notes").unwrap();
        assert_eq!(
            PathBuf::from(&link.exclude_path),
            main.join(".git").join("info").join("exclude")
        );
        assert!(feature.join("notes").is_symlink());

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn refuses_non_repositories_and_occupied_names() {
        let base = scratch("refuse");
        let plain = base.join("plain");
        fs::create_dir_all(&plain).unwrap();
        let notes = base.join("notes");
        fs::create_dir_all(&notes).unwrap();
        assert!(link_into_repository(&notes, &plain, "notes").unwrap_err().contains("not a Git repository"));

        let repo = base.join("repo");
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::create_dir_all(repo.join("notes")).unwrap();
        assert!(link_into_repository(&notes, &repo, "notes").unwrap_err().contains("already exists"));
        assert!(link_into_repository(&notes, &repo, "../x").is_err());

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn removes_only_the_ghost_folder() {
        let base = scratch("ghost");
        fs::create_dir_all(base.join(".ghost").join("versions")).unwrap();
        fs::write(base.join("keep.md"), "# keep").unwrap();
        tauri::async_runtime::block_on(remove_ghost_metadata_dir(base.to_string_lossy().to_string())).unwrap();
        assert!(!base.join(".ghost").exists());
        assert!(base.join("keep.md").exists());
        tauri::async_runtime::block_on(remove_ghost_metadata_dir(base.to_string_lossy().to_string())).unwrap();
        let _ = fs::remove_dir_all(&base);
    }
}
