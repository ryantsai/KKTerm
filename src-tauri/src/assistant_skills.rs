use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantSkill {
    pub name: String,
    pub description: String,
    pub instructions: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantSkillSummary {
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub folder_path: String,
    pub invalid_reason: Option<String>,
}

pub fn assistant_skills_root(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = crate::app_paths::data_dir(app)?;
    Ok(app_data_dir.join("assistant-skills"))
}

pub fn custom_assistant_skills_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(assistant_skills_root(app)?.join("custom"))
}

pub fn ensure_bundled_skills_installed(app: &AppHandle) -> Result<(), String> {
    let user_root = assistant_skills_root(app)?;
    fs::create_dir_all(&user_root)
        .map_err(|error| format!("failed to create assistant skills folder: {error}"))?;
    for bundled_root in bundled_skill_roots(app) {
        copy_missing_skill_dirs(&bundled_root, &user_root)?;
    }
    Ok(())
}

pub fn list_skill_summaries(
    root: &Path,
    disabled_names: &[String],
    include_custom: bool,
) -> Result<Vec<AssistantSkillSummary>, String> {
    fs::create_dir_all(root)
        .map_err(|error| format!("failed to create assistant skills folder: {error}"))?;
    let disabled = disabled_names.iter().cloned().collect::<HashSet<_>>();
    let mut summaries = Vec::new();
    read_skill_summaries(root, Some("custom"), &disabled, &mut summaries)?;
    if include_custom {
        let custom_root = root.join("custom");
        fs::create_dir_all(&custom_root)
            .map_err(|error| format!("failed to create custom assistant skills folder: {error}"))?;
        read_skill_summaries(&custom_root, None, &disabled, &mut summaries)?;
    }
    summaries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(summaries)
}

fn read_skill_summaries(
    root: &Path,
    skip_dir_name: Option<&str>,
    disabled: &HashSet<String>,
    summaries: &mut Vec<AssistantSkillSummary>,
) -> Result<(), String> {
    for entry in fs::read_dir(root)
        .map_err(|error| format!("failed to read assistant skills folder: {error}"))?
    {
        let entry = entry.map_err(|error| format!("failed to read skill entry: {error}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if skip_dir_name.is_some_and(|name| entry.file_name().to_string_lossy() == name) {
            continue;
        }
        match parse_skill_dir(&path) {
            Ok(skill) => summaries.push(AssistantSkillSummary {
                enabled: !disabled.contains(&skill.name),
                folder_path: path.to_string_lossy().into_owned(),
                invalid_reason: None,
                name: skill.name,
                description: skill.description,
            }),
            Err(error) => {
                let name = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("invalid-skill")
                    .to_string();
                summaries.push(AssistantSkillSummary {
                    name,
                    description: String::new(),
                    enabled: false,
                    folder_path: path.to_string_lossy().into_owned(),
                    invalid_reason: Some(error),
                });
            }
        }
    }
    Ok(())
}

pub fn open_skills_folder(app: &AppHandle) -> Result<(), String> {
    ensure_bundled_skills_installed(app)?;
    let root = assistant_skills_root(app)?;
    fs::create_dir_all(&root)
        .map_err(|error| format!("failed to create assistant skills folder: {error}"))?;
    app.opener()
        .open_path(root.to_string_lossy(), None::<&str>)
        .map_err(|error| format!("failed to open assistant skills folder: {error}"))
}

pub fn open_custom_skills_folder(app: &AppHandle) -> Result<(), String> {
    ensure_bundled_skills_installed(app)?;
    let root = custom_assistant_skills_root(app)?;
    fs::create_dir_all(&root)
        .map_err(|error| format!("failed to create custom assistant skills folder: {error}"))?;
    app.opener()
        .open_path(root.to_string_lossy(), None::<&str>)
        .map_err(|error| format!("failed to open custom assistant skills folder: {error}"))
}

pub fn open_skill_folder(app: &AppHandle, name: &str) -> Result<(), String> {
    ensure_bundled_skills_installed(app)?;
    validate_skill_name(name)?;
    let root = assistant_skills_root(app)?;
    let path = root.join(name);
    let custom_path = root.join("custom").join(name);
    let path = if parse_skill_dir(&path).is_ok() {
        path
    } else {
        parse_skill_dir(&custom_path)?;
        custom_path
    };
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| format!("failed to open assistant skill folder: {error}"))
}

pub fn parse_skill_dir(dir: &Path) -> Result<AssistantSkill, String> {
    let skill_path = dir.join("SKILL.md");
    let content = fs::read_to_string(&skill_path)
        .map_err(|error| format!("failed to read {}: {error}", skill_path.display()))?;
    let (frontmatter, instructions) = split_frontmatter(&content)?;
    let metadata = parse_frontmatter(frontmatter)?;
    let name = metadata
        .get("name")
        .cloned()
        .ok_or_else(|| "SKILL.md missing required name".to_string())?;
    let description = metadata
        .get("description")
        .cloned()
        .ok_or_else(|| "SKILL.md missing required description".to_string())?;
    validate_skill_name(&name)?;
    validate_skill_description(&description)?;
    let dir_name = dir
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "skill directory must have a valid UTF-8 name".to_string())?;
    if dir_name != name {
        return Err(format!(
            "skill name '{name}' must match directory name '{dir_name}'"
        ));
    }
    let instructions = instructions.trim().to_string();
    if instructions.is_empty() {
        return Err("SKILL.md instructions are empty".to_string());
    }

    Ok(AssistantSkill {
        name,
        description,
        instructions: truncate_instructions(&instructions),
    })
}

fn split_frontmatter(content: &str) -> Result<(&str, &str), String> {
    let Some(rest) = content.strip_prefix("---") else {
        return Err("SKILL.md must start with YAML frontmatter".to_string());
    };
    let rest = rest
        .strip_prefix("\r\n")
        .or_else(|| rest.strip_prefix('\n'))
        .unwrap_or(rest);
    let Some(end_index) = rest.find("\n---") else {
        return Err("SKILL.md frontmatter is not closed".to_string());
    };
    let frontmatter = &rest[..end_index];
    let after = &rest[end_index + "\n---".len()..];
    let after = after
        .strip_prefix("\r\n")
        .or_else(|| after.strip_prefix('\n'))
        .unwrap_or(after);
    Ok((frontmatter, after))
}

fn bundled_skill_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(root) = app
        .path()
        .resolve("assistant-skills", BaseDirectory::Resource)
    {
        if root.is_dir() {
            roots.push(root);
        }
    }

    let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|path| path.join("assistant-skills"));
    if let Some(root) = source_root.filter(|path| path.is_dir()) {
        if !roots.iter().any(|existing| existing == &root) {
            roots.push(root);
        }
    }
    roots
}

fn copy_missing_skill_dirs(source_root: &Path, user_root: &Path) -> Result<(), String> {
    for entry in fs::read_dir(source_root)
        .map_err(|error| format!("failed to read bundled assistant skills: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("failed to read bundled skill entry: {error}"))?;
        let source_dir = entry.path();
        if !source_dir.is_dir() {
            continue;
        }
        let Some(name) = source_dir.file_name() else {
            continue;
        };
        let destination_dir = user_root.join(name);
        if destination_dir.join("SKILL.md").is_file() {
            continue;
        }
        copy_missing_skill_files(&source_dir, &destination_dir)?;
    }
    Ok(())
}

fn copy_missing_skill_files(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("failed to create assistant skill folder: {error}"))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("failed to read bundled assistant skill: {error}"))?
    {
        let entry = entry.map_err(|error| format!("failed to read bundled skill file: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_missing_skill_files(&source_path, &destination_path)?;
        } else if source_path.is_file() && !destination_path.exists() {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "failed to copy {} to {}: {error}",
                    source_path.display(),
                    destination_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn parse_frontmatter(frontmatter: &str) -> Result<HashMap<String, String>, String> {
    let mut metadata = HashMap::new();
    for line in frontmatter.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            return Err(format!("invalid SKILL.md frontmatter line: {line}"));
        };
        let key = key.trim();
        if key.is_empty() {
            return Err("SKILL.md frontmatter contains an empty key".to_string());
        }
        let value = unquote_scalar(value.trim());
        metadata.insert(key.to_string(), value);
    }
    Ok(metadata)
}

fn unquote_scalar(value: &str) -> String {
    if value.len() >= 2 {
        let bytes = value.as_bytes();
        if (bytes[0] == b'"' && bytes[value.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[value.len() - 1] == b'\'')
        {
            return value[1..value.len() - 1].to_string();
        }
    }
    value.to_string()
}

fn validate_skill_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 64 {
        return Err("skill name must be 1-64 characters".to_string());
    }
    if !name
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
    {
        return Err("skill name must use lowercase letters, numbers, and hyphens".to_string());
    }
    Ok(())
}

pub fn normalize_skill_names(values: Vec<String>) -> Vec<String> {
    let mut names = values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| validate_skill_name(value).is_ok())
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    names
}

fn validate_skill_description(description: &str) -> Result<(), String> {
    if description.trim().is_empty() || description.len() > 1024 {
        return Err("skill description must be 1-1024 characters".to_string());
    }
    if description.contains('<') || description.contains('>') {
        return Err("skill description cannot contain XML tags".to_string());
    }
    Ok(())
}

fn truncate_instructions(instructions: &str) -> String {
    const MAX_CHARS: usize = 16_000;
    if instructions.chars().count() <= MAX_CHARS {
        return instructions.to_string();
    }
    instructions.chars().take(MAX_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};

    fn temp_skill_root(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("kkterm-skill-test-{}-{}", std::process::id(), name));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create temp skill root");
        root
    }

    #[test]
    fn parse_skill_dir_reads_frontmatter_and_body() {
        let root = temp_skill_root("valid");
        let dir = root.join("ssh-troubleshooter");
        fs::create_dir_all(&dir).expect("create skill dir");
        fs::write(
            dir.join("SKILL.md"),
            r#"---
name: ssh-troubleshooter
description: Diagnose SSH connection failures and host key problems.
---

# SSH Troubleshooter

Follow a cautious read-before-write flow.
"#,
        )
        .expect("write skill");

        let skill = parse_skill_dir(&dir).expect("skill parses");

        assert_eq!(skill.name, "ssh-troubleshooter");
        assert_eq!(
            skill.description,
            "Diagnose SSH connection failures and host key problems."
        );
        assert!(skill.instructions.contains("read-before-write"));
    }

    #[test]
    fn parse_skill_dir_rejects_name_that_does_not_match_directory() {
        let root = temp_skill_root("mismatch");
        let dir = root.join("dashboard-helper");
        fs::create_dir_all(&dir).expect("create skill dir");
        fs::write(
            dir.join("SKILL.md"),
            "---\nname: other-name\ndescription: Help with dashboards.\n---\n",
        )
        .expect("write skill");

        let error = parse_skill_dir(&dir).expect_err("mismatched skill is rejected");

        assert!(error.contains("must match"));
    }

    #[test]
    fn list_skill_summaries_includes_custom_folder_only_when_enabled() {
        let root = temp_skill_root("custom-list");
        let bundled_dir = root.join("ssh-troubleshooter");
        let custom_dir = root.join("custom").join("custom-helper");
        fs::create_dir_all(&bundled_dir).expect("create bundled skill");
        fs::create_dir_all(&custom_dir).expect("create custom skill");
        fs::write(
            bundled_dir.join("SKILL.md"),
            "---
name: ssh-troubleshooter
description: Help with SSH.
---
Bundled
",
        )
        .expect("write bundled skill");
        fs::write(
            custom_dir.join("SKILL.md"),
            "---
name: custom-helper
description: Help with custom workflows.
---
Custom
",
        )
        .expect("write custom skill");

        let without_custom = list_skill_summaries(&root, &[], false)
            .expect("summaries without custom load")
            .into_iter()
            .map(|summary| summary.name)
            .collect::<Vec<_>>();
        let with_custom = list_skill_summaries(&root, &[], true)
            .expect("summaries with custom load")
            .into_iter()
            .map(|summary| summary.name)
            .collect::<Vec<_>>();

        assert_eq!(without_custom, vec!["ssh-troubleshooter".to_string()]);
        assert_eq!(
            with_custom,
            vec![
                "custom-helper".to_string(),
                "ssh-troubleshooter".to_string()
            ]
        );
    }

    #[test]
    fn bundled_skill_files_parse_from_source_tree() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("manifest has repo parent")
            .join("assistant-skills");
        let mut names = fs::read_dir(&root)
            .expect("bundled skill root exists")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .map(|path| parse_skill_dir(&path).expect("bundled skill parses").name)
            .collect::<Vec<_>>();

        names.sort();

        assert_eq!(
            names,
            vec![
                "dashboard-data-visualization",
                "dashboard-widget-builder",
                "dashboard-widget-designer",
                "desktop-accessibility-ui",
                "dns-dhcp-troubleshooter",
                "firewall-port-troubleshooter",
                "network-connectivity-troubleshooter",
                "remote-desktop-helper",
                "sftp-transfer-helper",
                "ssh-troubleshooter",
                "terminal-command-planner",
                "tls-certificate-troubleshooter",
            ]
        );
    }

    #[test]
    fn copy_missing_skill_dirs_preserves_existing_user_skill() {
        let source_root = temp_skill_root("bundled-source");
        let user_root = temp_skill_root("bundled-user");
        let source_dir = source_root.join("ssh-troubleshooter");
        let user_dir = user_root.join("ssh-troubleshooter");
        fs::create_dir_all(&source_dir).expect("create source skill");
        fs::create_dir_all(&user_dir).expect("create user skill");
        fs::write(
            source_dir.join("SKILL.md"),
            "---\nname: ssh-troubleshooter\ndescription: Bundled source skill.\n---\nBundled\n",
        )
        .expect("write bundled skill");
        fs::write(user_dir.join("SKILL.md"), "User copy").expect("write user skill");

        copy_missing_skill_dirs(&source_root, &user_root).expect("copy bundled skills");

        assert_eq!(
            fs::read_to_string(user_dir.join("SKILL.md")).expect("read user skill"),
            "User copy"
        );
    }

    #[test]
    fn copy_missing_skill_dirs_repairs_incomplete_existing_skill() {
        let source_root = temp_skill_root("incomplete-bundled-source");
        let user_root = temp_skill_root("incomplete-bundled-user");
        let source_dir = source_root.join("dashboard-data-visualization");
        let user_dir = user_root.join("dashboard-data-visualization");
        fs::create_dir_all(&source_dir).expect("create source skill");
        fs::create_dir_all(&user_dir).expect("create incomplete user skill");
        fs::write(
            source_dir.join("SKILL.md"),
            "---\nname: dashboard-data-visualization\ndescription: Visualize dashboard data.\n---\nBundled\n",
        )
        .expect("write bundled skill");
        fs::write(user_dir.join("notes.txt"), "Keep me").expect("write user file");

        copy_missing_skill_dirs(&source_root, &user_root).expect("repair bundled skills");

        assert_eq!(
            fs::read_to_string(user_dir.join("SKILL.md")).expect("read repaired skill"),
            "---\nname: dashboard-data-visualization\ndescription: Visualize dashboard data.\n---\nBundled\n"
        );
        assert_eq!(
            fs::read_to_string(user_dir.join("notes.txt")).expect("read preserved user file"),
            "Keep me"
        );
    }
}
