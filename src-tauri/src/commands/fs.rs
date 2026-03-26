use serde::Serialize;
use std::fs;
use std::path::Path;
use pulldown_cmark::{Parser, Options, html};

#[derive(Debug, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub children: Option<Vec<FileEntry>>,
}

#[tauri::command]
pub async fn read_directory(path: String, extensions: Vec<String>) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(&path);
    if !dir_path.exists() {
        return Err(format!("Directory does not exist: {}", path));
    }
    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    read_dir_recursive(dir_path, &extensions).map_err(|e| e.to_string())
}

fn read_dir_recursive(dir: &Path, extensions: &[String]) -> Result<Vec<FileEntry>, std::io::Error> {
    let mut entries = Vec::new();

    let mut dir_entries: Vec<_> = fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .collect();

    dir_entries.sort_by(|a, b| {
        let a_is_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let b_is_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        match (a_is_dir, b_is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().to_ascii_lowercase().cmp(&b.file_name().to_ascii_lowercase()),
        }
    });

    for entry in dir_entries {
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/directories
        if name.starts_with('.') {
            continue;
        }

        let path = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);

        if is_dir {
            let children = read_dir_recursive(&path, extensions)?;
            // Always show directories (even empty ones)
            entries.push(FileEntry {
                name,
                path: path.to_string_lossy().to_string(),
                is_directory: true,
                children: Some(children),
            });
        } else {
            // Filter by extension if extensions list is not empty
            if !extensions.is_empty() {
                let ext = path.extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("");
                if !extensions.iter().any(|e| e == ext) {
                    continue;
                }
            }
            entries.push(FileEntry {
                name,
                path: path.to_string_lossy().to_string(),
                is_directory: false,
                children: None,
            });
        }
    }

    Ok(entries)
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
pub async fn create_file(dir: String, name: String) -> Result<String, String> {
    let file_path = Path::new(&dir).join(&name);
    if file_path.exists() {
        return Err(format!("File already exists: {}", file_path.display()));
    }
    fs::write(&file_path, "").map_err(|e| format!("Failed to create file: {}", e))?;
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn create_directory(parent: String, name: String) -> Result<String, String> {
    let dir_path = Path::new(&parent).join(&name);
    if dir_path.exists() {
        return Err(format!("Directory already exists: {}", dir_path.display()));
    }
    fs::create_dir(&dir_path).map_err(|e| format!("Failed to create directory: {}", e))?;
    Ok(dir_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn move_file(file_path: String, target_dir: String, force: Option<bool>) -> Result<String, String> {
    let source = Path::new(&file_path);
    let file_name = source.file_name().ok_or("Cannot determine file name")?;
    let dest = Path::new(&target_dir).join(file_name);
    if dest.exists() {
        if force.unwrap_or(false) {
            // Remove existing before move
            if dest.is_dir() {
                fs::remove_dir_all(&dest).map_err(|e| format!("Failed to remove existing: {}", e))?;
            } else {
                fs::remove_file(&dest).map_err(|e| format!("Failed to remove existing: {}", e))?;
            }
        } else {
            return Err("ALREADY_EXISTS".to_string());
        }
    }
    fs::rename(&file_path, &dest).map_err(|e| format!("Failed to move file: {}", e))?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn rename_file(old_path: String, new_name: String) -> Result<String, String> {
    let old = Path::new(&old_path);
    let parent = old.parent().ok_or("Cannot determine parent directory")?;
    let new_path = parent.join(&new_name);
    if new_path.exists() {
        return Err(format!("A file with that name already exists: {}", new_path.display()));
    }
    fs::rename(&old_path, &new_path).map_err(|e| format!("Failed to rename: {}", e))?;
    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete directory: {}", e))
    } else {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))
    }
}

#[tauri::command]
pub async fn duplicate_file(path: String) -> Result<String, String> {
    let source = Path::new(&path);
    let parent = source.parent().ok_or("Cannot determine parent directory")?;

    if source.is_dir() {
        let dir_name = source.file_name().ok_or("Cannot determine folder name")?
            .to_string_lossy().to_string();
        let mut dest_name = format!("{} copy", dir_name);
        let mut counter = 1;
        let mut dest = parent.join(&dest_name);
        while dest.exists() {
            counter += 1;
            dest_name = format!("{} copy {}", dir_name, counter);
            dest = parent.join(&dest_name);
        }
        copy_dir_recursive(source, &dest)?;
        Ok(dest.to_string_lossy().to_string())
    } else {
        let stem = source.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("file");
        let ext = source.extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e))
            .unwrap_or_default();
        let mut dest_name = format!("{} copy{}", stem, ext);
        let mut counter = 1;
        let mut dest = parent.join(&dest_name);
        while dest.exists() {
            counter += 1;
            dest_name = format!("{} copy {}{}", stem, counter, ext);
            dest = parent.join(&dest_name);
        }
        fs::copy(&path, &dest).map_err(|e| format!("Failed to duplicate: {}", e))?;
        Ok(dest.to_string_lossy().to_string())
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir(dst).map_err(|e| format!("Failed to create directory: {}", e))?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| format!("Failed to copy: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to reveal in Finder: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn markdown_to_html(markdown: String) -> Result<String, String> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_TASKLISTS);
    let parser = Parser::new_ext(&markdown, options);
    let mut html_output = String::new();
    html::push_html(&mut html_output, parser);
    Ok(html_output)
}

#[tauri::command]
pub async fn markdown_to_plain_text(markdown: String) -> Result<String, String> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_TASKLISTS);
    let parser = Parser::new_ext(&markdown, options);
    let mut plain = String::new();
    for event in parser {
        match event {
            pulldown_cmark::Event::Text(text) | pulldown_cmark::Event::Code(text) => {
                plain.push_str(&text);
            }
            pulldown_cmark::Event::SoftBreak | pulldown_cmark::Event::HardBreak => {
                plain.push('\n');
            }
            pulldown_cmark::Event::End(tag) => {
                match tag {
                    pulldown_cmark::TagEnd::Paragraph
                    | pulldown_cmark::TagEnd::Heading(_)
                    | pulldown_cmark::TagEnd::Item
                    | pulldown_cmark::TagEnd::BlockQuote(_) => {
                        plain.push('\n');
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    Ok(plain.trim().to_string())
}
