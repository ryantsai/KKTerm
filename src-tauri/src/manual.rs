use serde::Serialize;
use std::fs;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ManualChapter {
    pub slug: &'static str,
    pub order: u32,
    pub filename: &'static str,
    pub title: &'static str,
}

const CHAPTERS: &[ManualChapter] = &[
    ManualChapter {
        slug: "index",
        order: 0,
        filename: "INDEX.md",
        title: "Index",
    },
    ManualChapter {
        slug: "getting-started",
        order: 1,
        filename: "01-getting-started.md",
        title: "Getting started",
    },
    ManualChapter {
        slug: "app-layout",
        order: 2,
        filename: "02-app-layout.md",
        title: "App layout",
    },
    ManualChapter {
        slug: "connections",
        order: 3,
        filename: "03-connections.md",
        title: "Connections",
    },
    ManualChapter {
        slug: "workspace-tabs-panes",
        order: 4,
        filename: "04-workspace-tabs-panes.md",
        title: "Workspace, tabs, panes",
    },
    ManualChapter {
        slug: "terminal",
        order: 5,
        filename: "05-terminal.md",
        title: "Terminal",
    },
    ManualChapter {
        slug: "ssh-and-tmux",
        order: 6,
        filename: "06-ssh-and-tmux.md",
        title: "SSH and tmux",
    },
    ManualChapter {
        slug: "sftp",
        order: 7,
        filename: "07-sftp.md",
        title: "SFTP",
    },
    ManualChapter {
        slug: "url-webview",
        order: 8,
        filename: "08-url-webview.md",
        title: "URL (WebView)",
    },
    ManualChapter {
        slug: "remote-desktop",
        order: 9,
        filename: "09-remote-desktop.md",
        title: "Remote desktop (RDP / VNC)",
    },
    ManualChapter {
        slug: "dashboard",
        order: 10,
        filename: "10-dashboard.md",
        title: "Dashboard",
    },
    ManualChapter {
        slug: "app-launcher",
        order: 11,
        filename: "11-app-launcher.md",
        title: "App Launcher widget",
    },
    ManualChapter {
        slug: "it-ops",
        order: 12,
        filename: "12-it-ops.md",
        title: "IT Ops",
    },
    ManualChapter {
        slug: "ai-assistant",
        order: 13,
        filename: "13-ai-assistant.md",
        title: "AI Assistant",
    },
    ManualChapter {
        slug: "screenshots",
        order: 14,
        filename: "14-screenshots.md",
        title: "Screenshots",
    },
    ManualChapter {
        slug: "settings",
        order: 15,
        filename: "15-settings.md",
        title: "Settings",
    },
    ManualChapter {
        slug: "localization",
        order: 16,
        filename: "16-localization.md",
        title: "Localization",
    },
    ManualChapter {
        slug: "data-backup-secrets",
        order: 17,
        filename: "17-data-backup-secrets.md",
        title: "Data, backup, secrets",
    },
    ManualChapter {
        slug: "installer",
        order: 18,
        filename: "18-installer.md",
        title: "Install Helper",
    },
    ManualChapter {
        slug: "git-browser",
        order: 19,
        filename: "19-git-browser.md",
        title: "Git Browser",
    },
    ManualChapter {
        slug: "system-cleaner",
        order: 20,
        filename: "20-system-cleaner.md",
        title: "System Cleaner",
    },
];

fn resolve_chapter_path(app: &AppHandle, filename: &str) -> Result<std::path::PathBuf, String> {
    app.path()
        .resolve(format!("manual/{filename}"), BaseDirectory::Resource)
        .map_err(|error| format!("failed to resolve manual resource path: {error}"))
}

/// Search chapter titles and AI grep hints for a keyword. Returns a compact JSON summary.
pub fn ai_search_manual(app: &AppHandle, query: &str) -> String {
    let query_lower = query.to_ascii_lowercase();
    let mut results: Vec<serde_json::Value> = Vec::new();
    for chapter in CHAPTERS {
        let Ok(path) = resolve_chapter_path(app, chapter.filename) else {
            continue;
        };
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let matched_hints: Vec<&str> = content
            .lines()
            .take(60)
            .filter(|line| line.to_ascii_lowercase().contains(&query_lower))
            .collect();
        let title_match = chapter.title.to_ascii_lowercase().contains(&query_lower);
        if title_match || !matched_hints.is_empty() {
            results.push(serde_json::json!({
                "slug": chapter.slug,
                "title": chapter.title,
                "matchedLines": matched_hints,
            }));
        }
    }
    if results.is_empty() {
        format!(
            "No manual chapters matched \"{query}\". Available chapter slugs: {}",
            CHAPTERS
                .iter()
                .map(|c| c.slug)
                .collect::<Vec<_>>()
                .join(", ")
        )
    } else {
        serde_json::to_string(&results).unwrap_or_default()
    }
}

/// Read a manual chapter by slug and return its Markdown content.
pub fn ai_read_manual_chapter(app: &AppHandle, slug: &str) -> String {
    let Some(chapter) = CHAPTERS.iter().find(|c| c.slug == slug) else {
        let slugs: Vec<&str> = CHAPTERS.iter().map(|c| c.slug).collect();
        return format!(
            "Unknown chapter slug \"{slug}\". Valid slugs: {}",
            slugs.join(", ")
        );
    };
    let Ok(path) = resolve_chapter_path(app, chapter.filename) else {
        return format!("Failed to locate chapter file for \"{}\".", chapter.slug);
    };
    match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) => format!("Failed to read chapter \"{}\": {error}", chapter.slug),
    }
}

#[tauri::command]
pub fn list_manual_chapters() -> Vec<ManualChapter> {
    CHAPTERS.to_vec()
}

#[tauri::command]
pub fn read_manual_chapter(app: AppHandle, filename: String) -> Result<String, String> {
    let chapter = CHAPTERS
        .iter()
        .find(|chapter| chapter.filename == filename)
        .ok_or_else(|| format!("unknown manual chapter: {filename}"))?;
    let path = resolve_chapter_path(&app, chapter.filename)?;
    fs::read_to_string(&path)
        .map_err(|error| format!("failed to read manual chapter {filename}: {error}"))
}
