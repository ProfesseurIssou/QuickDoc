//! QuickDoc backend entry point.
//!
//! Wires up plugins (SQL with migrations, global shortcut, dialog, fs, clipboard),
//! the system tray, the global hotkey, and a handful of Tauri commands for the
//! things that are easier in Rust than through the SQL plugin directly.
//!
//! Settings live in SQLite and are owned by the frontend (via tauri-plugin-sql).
//! The Rust side never queries the DB directly; instead the frontend passes
//! values it has already read (e.g. the panel side when docking).

mod attachments;
mod export;
mod keybinding;
mod settings;
mod window;

use std::collections::BTreeMap;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WebviewWindow,
};
use tauri_plugin_global_shortcut::{
    Builder as ShortcutBuilder, GlobalShortcutExt, Shortcut, ShortcutState,
};

use crate::window::PanelSide;

// ---------------------------------------------------------------------------
// Window: dock + toggle
// ---------------------------------------------------------------------------

/// Dock the panel to the given side. The frontend always supplies the side it
/// read from settings; on startup we fall back to the default.
#[tauri::command]
fn dock_window(app: AppHandle, side: Option<String>) -> tauri::Result<()> {
    let side = side
        .as_deref()
        .map(PanelSide::parse)
        .unwrap_or_default();
    window::dock_primary(&app, side)
}

/// Toggle panel visibility; show -> focus the input field (zero clicks).
#[tauri::command]
fn toggle_panel(app: AppHandle, window: WebviewWindow) -> tauri::Result<()> {
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        // Re-dock in case the monitor geometry changed.
        let _ = dock_window(app, None);
        window.show()?;
        window.set_focus()?;
        // Tell the frontend to focus the input field once it's painted.
        window.emit("quickdoc://focus-input", ())?;
    }
    Ok(())
}

/// Hide the panel (bound to Esc from the frontend).
#[tauri::command]
fn hide_panel(window: WebviewWindow) -> tauri::Result<()> {
    window.hide()
}

// ---------------------------------------------------------------------------
// Attachments: save clipboard image bytes to the attachments folder.
// ---------------------------------------------------------------------------

/// Persist raw image bytes from the clipboard and return the stable file name +
/// mime + kind, ready for the frontend to insert into the `attachments` table.
#[tauri::command]
fn save_attachment_bytes(
    app: AppHandle,
    bytes: Vec<u8>,
    mime: String,
) -> Result<attachments::ExportSaveResult, String> {
    let kind = attachments::kind_from_mime(&mime);
    let file_name = attachments::stable_name(&mime);
    if !attachments::is_safe_name(&file_name) {
        return Err("unsafe attachment name".into());
    }
    let dir = attachments::attachments_dir(&app).map_err(|e| e.to_string())?;
    let path = dir.join(&file_name);
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(attachments::ExportSaveResult {
        kind: kind.as_str().to_string(),
        mime,
        file_name,
    })
}

/// Return the absolute path to the attachments dir (used by export to copy assets).
#[tauri::command]
fn attachments_dir_path(app: AppHandle) -> Result<String, String> {
    let dir = attachments::attachments_dir(&app).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Export: render Markdown/HTML on the Rust side (pure + tested) and let the
// frontend hand over the loaded data + base64 assets.
// ---------------------------------------------------------------------------

#[tauri::command]
fn render_export_markdown(project: export::ExportProject) -> String {
    export::to_markdown(&project)
}

#[tauri::command]
fn render_export_html(
    project: export::ExportProject,
    title: String,
    assets_base64: BTreeMap<String, String>,
) -> String {
    export::to_html(&project, &title, &assets_base64)
}

/// Resolve the friendly keybinding map to accelerator strings, dropping any
/// binding that can't be parsed. Used by the frontend before registering
/// shortcuts so bad user input is tolerated gracefully.
#[tauri::command]
fn resolve_keybindings(
    bindings: BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for (action, raw) in bindings {
        if let Some(acc) = keybinding::to_accelerator(&raw) {
            out.insert(action, acc);
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Global hotkey handling
// ---------------------------------------------------------------------------

/// Handle a single global shortcut by emitting an event the frontend reacts to.
/// (The frontend owns what each action does — cycling projects, etc.)
fn on_shortcut(app: &AppHandle, action: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("quickdoc://shortcut", action);
    }
}

// ---------------------------------------------------------------------------
// App entry
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The default toggle hotkey is registered through the global-shortcut
    // plugin builder. The frontend re-registers the full set (including project
    // shortcuts) once it has read settings.
    let toggle_plugin = ShortcutBuilder::default()
        .with_handler(move |app, _sc, event| {
            if event.state == ShortcutState::Pressed {
                on_shortcut(app, "toggle_panel");
            }
        })
        .build();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:quickdoc.sqlite",
                    vec![tauri_plugin_sql::Migration {
                        version: 1,
                        description: "create initial schema",
                        sql: include_str!("../migrations/001_init.sql"),
                        kind: tauri_plugin_sql::MigrationKind::Up,
                    }],
                )
                .build(),
        )
        .plugin(toggle_plugin)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(())
        .setup(|app| {
            // Tray menu: Open, Settings, Quit.
            let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &settings_item, &quit])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| tauri::Error::Anyhow(anyhow::anyhow!("missing default icon")))?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .menu(&menu)
                .tooltip("QuickDoc")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "settings" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = w.emit("quickdoc://navigate", "settings");
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Register the default toggle hotkey at startup.
            if let Some(toggle) = keybinding::to_accelerator("Ctrl+Alt+Space") {
                if let Ok(shortcut) = toggle.parse::<Shortcut>() {
                    let _ = app
                        .global_shortcut()
                        .on_shortcut(shortcut, move |_app, _sc, event| {
                            if event.state == ShortcutState::Pressed {
                                on_shortcut(_app, "toggle_panel");
                            }
                        });
                }
            }

            // Dock the panel on startup with the default side. The frontend
            // re-docks with the persisted side once it has read settings.
            let _ = window::dock_primary(app.handle(), PanelSide::default());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            dock_window,
            toggle_panel,
            hide_panel,
            save_attachment_bytes,
            attachments_dir_path,
            render_export_markdown,
            render_export_html,
            resolve_keybindings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running QuickDoc");
}
