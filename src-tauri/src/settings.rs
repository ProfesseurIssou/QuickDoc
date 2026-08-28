//! Settings defaults and helpers. Actual values live in the `settings` table
//! (read/written from the frontend via the SQL plugin); this module only owns
//! the canonical defaults so both sides agree.
//!
//! The defaults and key constants are the source of truth for the frontend and
//! are exercised by tests; they're allowed to remain "dead" in a library build.

#![allow(dead_code)]

use crate::keybinding;
use std::collections::BTreeMap;

/// Setting keys (kept here as constants so typos are caught at compile time).
pub mod keys {
    pub const PANEL_SIDE: &str = "panel_side";
    pub const LOCALE: &str = "locale";
    /// Value stored as JSON: { "action": "binding", ... }.
    pub const KEYBINDINGS: &str = "keybindings";
    pub const ACTIVE_PROJECT_ID: &str = "active_project_id";
    /// Value stored as "true"/"false": download updates in the background and
    /// install them when the app quits.
    pub const AUTO_UPDATE: &str = "auto_update";
}

/// The default settings map as (key, value) pairs, applied on first run.
pub fn defaults() -> BTreeMap<&'static str, String> {
    let mut map = BTreeMap::new();
    map.insert(keys::PANEL_SIDE, "right".to_string());
    map.insert(keys::LOCALE, "en".to_string());
    map.insert(keys::ACTIVE_PROJECT_ID, "1".to_string());
    map.insert(keys::AUTO_UPDATE, "true".to_string());

    let kb: BTreeMap<&str, &str> = keybinding::defaults().into_iter().collect();
    map.insert(
        keys::KEYBINDINGS,
        serde_json::to_string(&kb).expect("defaults serialize"),
    );
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_contain_required_keys() {
        let d = defaults();
        assert_eq!(d.get(keys::PANEL_SIDE).unwrap(), "right");
        assert_eq!(d.get(keys::LOCALE).unwrap(), "en");
        assert!(d.contains_key(keys::KEYBINDINGS));
    }

    #[test]
    fn default_keybindings_are_valid_json() {
        let d = defaults();
        let kb: serde_json::Value =
            serde_json::from_str(d.get(keys::KEYBINDINGS).unwrap()).unwrap();
        assert_eq!(kb["toggle_panel"], "Ctrl+Alt+Space");
        assert_eq!(kb["save_note"], "Ctrl+Enter");
    }
}
