//! Ghost's default folder under the user's home directory.
//!
//! `~/Ghost` is where Ghost-created folders live by default. It is a
//! convenience, not a boundary: any folder can be opened, and later synced.
//! The first launch seeds `~/Ghost/Notes` with a welcome note so a new user
//! starts with a cursor in a real note rather than a folder picker.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

pub const GHOST_FOLDER_NAME: &str = "Ghost";
pub const NOTES_FOLDER_NAME: &str = "Notes";
const WELCOME_FILE_NAME: &str = "Welcome.md";

const WELCOME_NOTE: &str = "\
# Welcome to Ghost

This is a note. It lives in ~/Ghost/Notes as a plain Markdown file, so you can see it in Finder and any other app can read it.

Press ⌘N for a new note. Press ⌘O to open any folder on your Mac, and Ghost edits it in place.

When you want a note on your phone or shared with someone, press Share at the top right. That is the first time Ghost will ask you to sign in.

Type # and a space for a heading, - and a space for a list, or wrap a word in ** to make it bold. What you type stays plain Markdown on disk.
";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NotesFolder {
    /// Absolute path of the Notes folder.
    pub path: String,
    /// True when this call created the Notes folder.
    pub created: bool,
    /// Path of the welcome note, present only when this call wrote it.
    pub welcome_path: Option<String>,
}

fn ghost_folder_path(app: &AppHandle) -> Result<PathBuf, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|error| format!("Could not find the home folder: {error}"))?;
    Ok(home.join(GHOST_FOLDER_NAME))
}

/// Create `<ghost_folder>/Notes` when it is missing. A brand-new Notes folder
/// receives the welcome note; an existing folder is left untouched, so a user
/// who deleted the welcome note does not get it back.
pub fn ensure_notes_folder_in(ghost_folder: &Path) -> Result<NotesFolder, String> {
    let notes = ghost_folder.join(NOTES_FOLDER_NAME);
    let created = !notes.is_dir();
    fs::create_dir_all(&notes)
        .map_err(|error| format!("Could not create {}: {error}", notes.display()))?;

    let mut welcome_path = None;
    if created {
        let welcome = notes.join(WELCOME_FILE_NAME);
        if !welcome.exists() {
            fs::write(&welcome, WELCOME_NOTE)
                .map_err(|error| format!("Could not write {}: {error}", welcome.display()))?;
            welcome_path = Some(welcome.to_string_lossy().to_string());
        }
    }

    Ok(NotesFolder {
        path: notes.to_string_lossy().to_string(),
        created,
        welcome_path,
    })
}

#[tauri::command]
pub fn ghost_folder(app: AppHandle) -> Result<String, String> {
    Ok(ghost_folder_path(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn ensure_notes_folder(app: AppHandle) -> Result<NotesFolder, String> {
    ensure_notes_folder_in(&ghost_folder_path(&app)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn scratch_dir() -> PathBuf {
        let unique = format!(
            "ghost-notes-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        );
        let dir = std::env::temp_dir().join(unique);
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn first_call_creates_notes_and_the_welcome_note() {
        let ghost = scratch_dir();
        let result = ensure_notes_folder_in(&ghost).unwrap();

        let notes = ghost.join(NOTES_FOLDER_NAME);
        assert!(notes.is_dir());
        assert!(result.created);
        assert_eq!(result.path, notes.to_string_lossy());
        let welcome = notes.join(WELCOME_FILE_NAME);
        assert_eq!(result.welcome_path.as_deref(), Some(welcome.to_string_lossy().as_ref()));
        let text = fs::read_to_string(&welcome).unwrap();
        assert!(text.starts_with("# Welcome to Ghost\n"));
        assert!(text.contains("⌘N"));

        let _ = fs::remove_dir_all(&ghost);
    }

    #[test]
    fn later_calls_leave_an_existing_notes_folder_alone() {
        let ghost = scratch_dir();
        let first = ensure_notes_folder_in(&ghost).unwrap();
        fs::remove_file(first.welcome_path.as_ref().unwrap()).unwrap();

        let second = ensure_notes_folder_in(&ghost).unwrap();
        assert!(!second.created);
        assert_eq!(second.welcome_path, None);
        assert!(!ghost.join(NOTES_FOLDER_NAME).join(WELCOME_FILE_NAME).exists());

        let _ = fs::remove_dir_all(&ghost);
    }

    #[test]
    fn a_user_made_notes_folder_is_adopted_without_a_welcome_note() {
        let ghost = scratch_dir();
        let notes = ghost.join(NOTES_FOLDER_NAME);
        fs::create_dir_all(&notes).unwrap();
        fs::write(notes.join("Mine.md"), "# Mine\n").unwrap();

        let result = ensure_notes_folder_in(&ghost).unwrap();
        assert!(!result.created);
        assert_eq!(result.welcome_path, None);
        assert!(!notes.join(WELCOME_FILE_NAME).exists());

        let _ = fs::remove_dir_all(&ghost);
    }
}
