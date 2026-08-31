//! Keybinding resolution.
//!
//! Translates between human-readable keybindings (e.g. "Ctrl+Alt+Space") and the
//! accelerator strings Tauri's global-shortcut plugin expects. This module is
//! intentionally pure and side-effect free so it can be unit-tested in isolation.
//!
//! `defaults()` and `find_duplicates()` are part of the settings/contracts API
//! and are exercised by tests; they're allowed to remain "dead" in a lib build.

#![allow(dead_code)]

/// Default keybindings applied on first run.
///
/// `select_project_N` selects the Nth project (1..9); `cycle_projects` goes to
/// the next project (wrapping).
///
/// Project shortcuts use Ctrl+Shift (not Ctrl+Alt): on Windows, AltGr is
/// reported to the system as Ctrl+Alt, so a Ctrl+Alt+<digit> global shortcut
/// would swallow characters like `{` / `#` / `[` typed with AltGr on European
/// keyboards, in every application.
pub fn defaults() -> Vec<(&'static str, &'static str)> {
    vec![
        ("toggle_panel", "Ctrl+Alt+Space"),
        ("cycle_projects", "Ctrl+Alt+P"),
        ("select_project_1", "Ctrl+Shift+1"),
        ("select_project_2", "Ctrl+Shift+2"),
        ("select_project_3", "Ctrl+Shift+3"),
        ("select_project_4", "Ctrl+Shift+4"),
        ("select_project_5", "Ctrl+Shift+5"),
        ("select_project_6", "Ctrl+Shift+6"),
        ("select_project_7", "Ctrl+Shift+7"),
        ("select_project_8", "Ctrl+Shift+8"),
        ("select_project_9", "Ctrl+Shift+9"),
    ]
}

/// Normalize a keybinding string: trim, collapse repeated spaces, and split on
/// '+' to return the list of key tokens (lower-cased modifiers, original case
/// for the final key). Returns an empty vec for empty/whitespace-only input.
///
/// Example: "  ctrl + alt + space " -> ["ctrl", "alt", "space"]
pub fn parse(binding: &str) -> Vec<String> {
    binding
        .trim()
        .split('+')
        .map(|part| part.trim().to_lowercase())
        .filter(|part| !part.is_empty())
        .collect()
}

/// Convert a friendly keybinding into the accelerator form Tauri expects.
///
/// Tauri accelerators use "+" with capitalized words and "CommandOrControl" for
/// cross-platform Ctrl/Cmd. We keep it simple: map common modifier spellings.
///
/// Returns `None` if the binding does not contain at least one key.
pub fn to_accelerator(binding: &str) -> Option<String> {
    let parts = parse(binding);
    if parts.is_empty() {
        return None;
    }
    let mapped: Vec<String> = parts
        .iter()
        .map(|p| match p.as_str() {
            "ctrl" | "control" | "cmd" | "command" => "CommandOrControl".to_string(),
            "shift" => "Shift".to_string(),
            "alt" | "option" => "Alt".to_string(),
            "meta" | "super" | "win" => "Super".to_string(),
            other => capitalize(other),
        })
        .collect();
    Some(mapped.join("+"))
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

/// Detect duplicate keybindings across an (action -> binding) map.
/// Returns the list of bindings that appear more than once.
pub fn find_duplicates(map: &[(&str, String)]) -> Vec<String> {
    use std::collections::HashMap;
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for (_, binding) in map {
        let key = binding.trim().to_lowercase();
        *counts.entry(key.leak()).or_insert(0) += 1;
    }
    counts
        .into_iter()
        .filter(|(_, c)| *c > 1)
        .map(|(k, _)| k.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_trims_and_lowercases_modifiers() {
        assert_eq!(parse("  Ctrl + Alt + Space "), vec!["ctrl", "alt", "space"]);
        assert_eq!(parse(""), Vec::<String>::new());
        assert_eq!(parse("   "), Vec::<String>::new());
    }

    #[test]
    fn to_accelerator_maps_modifiers_and_capitalizes() {
        assert_eq!(
            to_accelerator("Ctrl+Alt+Space").as_deref(),
            Some("CommandOrControl+Alt+Space")
        );
        assert_eq!(
            to_accelerator("Ctrl+Enter").as_deref(),
            Some("CommandOrControl+Enter")
        );
        assert_eq!(to_accelerator("").as_deref(), None);
    }

    #[test]
    fn defaults_are_non_empty_and_unique_bindings() {
        let d = defaults();
        assert!(!d.is_empty());
        let owned: Vec<(&str, String)> = d.iter().map(|(a, b)| (*a, b.to_string())).collect();
        let dupes = find_duplicates(&owned);
        assert!(
            dupes.is_empty(),
            "default keybindings must be unique, duplicates: {:?}",
            dupes
        );
    }

    #[test]
    fn find_duplicates_reports_repeats() {
        let map = vec![
            ("a", "Ctrl+A".to_string()),
            ("b", "ctrl+a".to_string()),
            ("c", "Ctrl+B".to_string()),
        ];
        assert_eq!(find_duplicates(&map), vec!["ctrl+a"]);
    }
}
