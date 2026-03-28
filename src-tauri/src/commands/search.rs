use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct ContentMatch {
    pub path: String,
    pub line_number: usize,
    pub line_text: String,
    pub match_start: usize,
    pub match_end: usize,
}

#[derive(Debug, Serialize)]
pub struct SearchResults {
    pub matches: Vec<ContentMatch>,
    pub total_matches: usize,
    pub files_searched: usize,
}

#[tauri::command]
pub async fn search_file_contents(
    query: String,
    directories: Vec<String>,
    extensions: Option<Vec<String>>,
    max_results: Option<usize>,
) -> Result<SearchResults, String> {
    let max = max_results.unwrap_or(50);
    let query_lower = query.to_lowercase();
    let mut matches = Vec::new();
    let mut total_matches: usize = 0;
    let mut files_searched: usize = 0;

    for dir in &directories {
        search_directory(
            Path::new(dir),
            &query_lower,
            extensions.as_deref(),
            max,
            &mut matches,
            &mut total_matches,
            &mut files_searched,
        );
    }

    Ok(SearchResults {
        matches,
        total_matches,
        files_searched,
    })
}

fn search_directory(
    dir: &Path,
    query: &str,
    extensions: Option<&[String]>,
    max: usize,
    matches: &mut Vec<ContentMatch>,
    total_matches: &mut usize,
    files_searched: &mut usize,
) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files
        if name.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            search_directory(path.as_path(), query, extensions, max, matches, total_matches, files_searched);
        } else {
            // Filter by extension
            if let Some(exts) = extensions {
                if !exts.is_empty() {
                    let ext = path.extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("");
                    if !exts.iter().any(|e| e == ext) {
                        continue;
                    }
                }
            }

            search_file(&path, query, max, matches, total_matches, files_searched);
        }
    }
}

fn search_file(
    path: &Path,
    query: &str,
    max: usize,
    matches: &mut Vec<ContentMatch>,
    total_matches: &mut usize,
    files_searched: &mut usize,
) {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return,
    };

    *files_searched += 1;
    let reader = BufReader::new(file);
    let path_str = path.to_string_lossy().to_string();

    for (line_idx, line_result) in reader.lines().enumerate() {
        let line = match line_result {
            Ok(l) => l,
            Err(_) => break, // binary file or encoding error
        };

        let line_lower = line.to_lowercase();
        let mut search_start = 0;

        while let Some(pos) = line_lower[search_start..].find(query) {
            let absolute_pos = search_start + pos;
            *total_matches += 1;

            if matches.len() < max {
                matches.push(ContentMatch {
                    path: path_str.clone(),
                    line_number: line_idx + 1,
                    line_text: line.clone(),
                    match_start: absolute_pos,
                    match_end: absolute_pos + query.len(),
                });
            }

            search_start = absolute_pos + query.len();
        }
    }
}
