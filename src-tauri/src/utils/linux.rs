use anyhow::Result;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;

pub fn ensure_mimeapps_entries(desktop_file: &str, schemes: &[&str]) -> Result<()> {
    let Some(path) = mimeapps_list_path() else {
        return Ok(());
    };

    if !path.exists() {
        return Ok(());
    }

    let original = fs::read_to_string(&path)?;
    let mut changed = false;

    let mut output_lines: Vec<String> = Vec::new();
    let mut current_section: Option<SectionKind> = None;
    let mut section_buffer: Vec<String> = Vec::new();
    let mut default_present = false;

    for line in original.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            if let Some(kind) = current_section.take() {
                flush_section(
                    &mut output_lines,
                    &mut section_buffer,
                    desktop_file,
                    schemes,
                    kind,
                    &mut changed,
                );
            }

            if trimmed.eq_ignore_ascii_case("[Default Applications]") {
                default_present = true;
                current_section = Some(SectionKind::DefaultApplications);
                output_lines.push("[Default Applications]".to_string());
                continue;
            } else if trimmed.eq_ignore_ascii_case("[Added Associations]") {
                current_section = Some(SectionKind::AddedAssociations);
                output_lines.push("[Added Associations]".to_string());
                continue;
            }
        }

        if current_section.is_some() {
            section_buffer.push(line.to_string());
        } else {
            output_lines.push(line.to_string());
        }
    }

    if let Some(kind) = current_section.take() {
        flush_section(
            &mut output_lines,
            &mut section_buffer,
            desktop_file,
            schemes,
            kind,
            &mut changed,
        );
    }

    if !default_present {
        changed = true;
        if output_lines.last().is_some_and(|line| !line.is_empty()) {
            output_lines.push(String::new());
        }
        output_lines.push("[Default Applications]".to_string());
        for &scheme in schemes {
            output_lines.push(format!("x-scheme-handler/{scheme}={desktop_file};"));
        }
    }

    if !changed {
        return Ok(());
    }

    let mut new_content = output_lines.join("\n");
    if !new_content.ends_with('\n') {
        new_content.push('\n');
    }

    fs::write(path, new_content)?;
    Ok(())
}

fn mimeapps_list_path() -> Option<PathBuf> {
    let config_path = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("HOME").map(PathBuf::from).map(|mut home| {
                home.push(".config");
                home
            })
        })
        .map(|mut dir| {
            dir.push("mimeapps.list");
            dir
        });

    if config_path.as_ref().is_some_and(|path| path.exists()) {
        return config_path;
    }

    let data_path = env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("HOME").map(PathBuf::from).map(|mut home| {
                home.push(".local");
                home.push("share");
                home
            })
        })
        .map(|mut dir| {
            dir.push("applications");
            dir.push("mimeapps.list");
            dir
        });

    if data_path.as_ref().is_some_and(|path| path.exists()) {
        return data_path;
    }

    config_path
}

#[derive(Clone, Copy)]
enum SectionKind {
    DefaultApplications,
    AddedAssociations,
}

fn flush_section(
    output: &mut Vec<String>,
    section: &mut Vec<String>,
    desktop_file: &str,
    schemes: &[&str],
    kind: SectionKind,
    changed: &mut bool,
) {
    let mut seen: HashMap<&str, usize> = HashMap::new();
    let mut processed: Vec<String> = Vec::with_capacity(section.len());

    for line in section.drain(..) {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            processed.push(line);
            continue;
        }

        let Some((raw_key, raw_value)) = trimmed.split_once('=') else {
            processed.push(line);
            continue;
        };

        if let Some(scheme) = match_scheme(raw_key.trim(), schemes) {
            let mut values: Vec<String> = raw_value
                .split(';')
                .filter_map(|value| {
                    let trimmed = value.trim();
                    (!trimmed.is_empty()).then(|| trimmed.to_string())
                })
                .collect();

            if let Some(&index) = seen.get(scheme) {
                let existing_line = &mut processed[index];
                let existing_prefix: String = existing_line.chars().take_while(|c| c.is_whitespace()).collect();
                let Some((_, existing_raw_value)) = existing_line.trim().split_once('=') else {
                    processed.push(line);
                    continue;
                };

                let mut merged_values: Vec<String> = existing_raw_value
                    .split(';')
                    .filter_map(|value| {
                        let trimmed = value.trim();
                        (!trimmed.is_empty()).then(|| trimmed.to_string())
                    })
                    .collect();

                for value in values {
                    if !merged_values.iter().any(|existing| existing == &value) {
                        merged_values.push(value);
                    }
                }

                if let Some(pos) = merged_values.iter().position(|value| value == desktop_file) {
                    if pos != 0 {
                        let moved = merged_values.remove(pos);
                        merged_values.insert(0, moved);
                    }
                } else {
                    merged_values.insert(0, desktop_file.to_string());
                }

                let mut merged_line = format!("{existing_prefix}x-scheme-handler/{scheme}=");
                merged_line.push_str(&merged_values.join(";"));
                merged_line.push(';');

                if *existing_line != merged_line {
                    *existing_line = merged_line;
                }

                // Dropping the duplicate entry alters the section even if nothing new was added.
                *changed = true;
                continue;
            }

            if let Some(pos) = values.iter().position(|value| value == desktop_file) {
                if pos != 0 {
                    values.remove(pos);
                    values.insert(0, desktop_file.to_string());
                    *changed = true;
                }
            } else {
                values.insert(0, desktop_file.to_string());
                *changed = true;
            }

            let prefix = line.chars().take_while(|c| c.is_whitespace()).collect::<String>();
            let mut new_line = format!("{prefix}x-scheme-handler/{scheme}=");
            new_line.push_str(&values.join(";"));
            new_line.push(';');

            if new_line != line {
                *changed = true;
            }

            let index = processed.len();
            processed.push(new_line);
            seen.insert(scheme, index);
            continue;
        }

        processed.push(line);
    }

    let ensure_all = matches!(kind, SectionKind::DefaultApplications | SectionKind::AddedAssociations);

    if ensure_all {
        for &scheme in schemes {
            if !seen.contains_key(scheme) {
                processed.push(format!("x-scheme-handler/{scheme}={desktop_file};"));
                *changed = true;
            }
        }
    }

    output.extend(processed);
}

fn match_scheme<'a>(key: &str, schemes: &'a [&str]) -> Option<&'a str> {
    if let Some(rest) = key.strip_prefix("x-scheme-handler/") {
        return schemes.iter().copied().find(|candidate| *candidate == rest);
    }

    schemes.iter().copied().find(|candidate| *candidate == key)
}
