//! QuickDoc backend entry point.
//!
//! Wires up plugins (Diesel/SQLite for persistence, single instance, updater,
//! global shortcut, dialog, fs, clipboard, autostart), the system tray, the
//! global hotkey, and Tauri commands covering all data access (projects,
//! notes, attachments, settings).
//!
//! Settings live in SQLite and are owned by the Rust side via Diesel; the
//! frontend reads/writes them through `db_get_setting` / `db_set_setting` and
//! passes values it needs (e.g. the panel side when docking).

mod attachments;
mod db;
mod export;
mod keybinding;
mod schema;
mod settings;
mod window;

use diesel::prelude::SqliteConnection;
use std::collections::BTreeMap;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State, WebviewWindow,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{
    Builder as ShortcutBuilder, GlobalShortcutExt, Shortcut, ShortcutState,
};
use tauri_plugin_single_instance::init as single_instance_init;

use crate::window::PanelSide;

// ---------------------------------------------------------------------------
// Window: dock + toggle
// ---------------------------------------------------------------------------

/// Dock the panel to the given side. When the frontend supplies an explicit
/// side (e.g. from Settings), that wins. When `side` is `None` (toggle-open,
/// startup), the persisted `panel_side` setting is read from the DB, falling
/// back to the default only if it is unset.
#[tauri::command]
fn dock_window(app: AppHandle, db: State<'_, db::Db>, side: Option<String>) -> tauri::Result<()> {
    match side {
        Some(raw) => window::dock_primary(&app, PanelSide::parse(&raw)),
        None => {
            let mut conn =
                db.0.lock()
                    .map_err(|e| tauri::Error::Anyhow(anyhow::anyhow!("db lock poisoned: {e}")))?;
            window::dock_primary_from_db(&app, &mut conn)
        }
    }
}

/// Toggle panel visibility; show -> focus the input field (zero clicks).
#[tauri::command]
fn toggle_panel(app: AppHandle, db: State<'_, db::Db>, window: WebviewWindow) -> tauri::Result<()> {
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        // Re-dock to the persisted side in case the monitor geometry changed.
        let _ = dock_window(app, db, None);
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

/// Show the panel if it is hidden (no-op when already visible). Used by
/// project shortcuts so switching projects is visible even when the panel
/// was closed.
#[tauri::command]
fn show_panel(app: AppHandle, db: State<'_, db::Db>, window: WebviewWindow) -> tauri::Result<()> {
    if !window.is_visible().unwrap_or(false) {
        let _ = dock_window(app, db, None);
        window.show()?;
        window.set_focus()?;
        window.emit("quickdoc://focus-input", ())?;
    }
    Ok(())
}

/// Quit for real. Called by the frontend from its quit path, after it has had
/// the chance to install a downloaded update (the updater's install() exits
/// the process by itself, so it never falls back to this).
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Enable launching QuickDoc at OS startup.
#[tauri::command]
fn enable_autostart(app: AppHandle) -> Result<(), String> {
    app.autolaunch().enable().map_err(|e| e.to_string())
}

/// Disable launching QuickDoc at OS startup. Returns the previous state.
#[tauri::command]
fn disable_autostart(app: AppHandle) -> Result<bool, String> {
    let was_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    app.autolaunch().disable().map_err(|e| e.to_string())?;
    Ok(was_enabled)
}

/// Whether QuickDoc is currently registered to launch at OS startup.
#[tauri::command]
fn autostart_enabled(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Attachments: save clipboard image bytes to the attachments folder.
// ---------------------------------------------------------------------------

/// Persist raw attachment bytes under a stable name in the attachments folder.
fn persist_attachment(
    app: &AppHandle,
    bytes: Vec<u8>,
    mime: String,
) -> Result<attachments::ExportSaveResult, String> {
    let kind = attachments::kind_from_mime(&mime);
    let file_name = attachments::stable_name(&mime);
    if !attachments::is_safe_name(&file_name) {
        return Err("unsafe attachment name".into());
    }
    let dir = attachments::attachments_dir(app).map_err(|e| e.to_string())?;
    let path = dir.join(&file_name);
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(attachments::ExportSaveResult {
        kind: kind.as_str().to_string(),
        mime,
        file_name,
    })
}

/// Persist raw image bytes from the clipboard and return the stable file name +
/// mime + kind, ready for the frontend to insert into the `attachments` table.
#[tauri::command]
fn save_attachment_bytes(
    app: AppHandle,
    bytes: Vec<u8>,
    mime: String,
) -> Result<attachments::ExportSaveResult, String> {
    persist_attachment(&app, bytes, mime)
}

/// Persist a file dropped onto the panel, given by its absolute path. Custom
/// commands are not restricted by the fs plugin scope, so this works for files
/// anywhere on disk (picked paths land in the scope, dropped paths do not).
#[tauri::command]
fn import_attachment_path(
    app: AppHandle,
    path: String,
    mime: String,
) -> Result<attachments::ExportSaveResult, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    persist_attachment(&app, bytes, mime)
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
fn resolve_keybindings(bindings: BTreeMap<String, String>) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for (action, raw) in bindings {
        if let Some(acc) = keybinding::to_accelerator(&raw) {
            out.insert(action, acc);
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Persistence commands (Diesel/SQLite). Thin wrappers over the `db` module.
// ---------------------------------------------------------------------------

/// Locking helper: run a closure with the connection borrowed from state.
fn with_db<F, T>(db: &State<'_, db::Db>, f: F) -> Result<T, String>
where
    F: FnOnce(&mut SqliteConnection) -> Result<T, diesel::result::Error>,
{
    let mut conn = db.0.lock().map_err(|e| format!("db lock poisoned: {e}"))?;
    f(&mut conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_list_projects(db: State<'_, db::Db>) -> Result<Vec<db::Project>, String> {
    with_db(&db, db::list_projects)
}

#[tauri::command]
fn db_create_project(db: State<'_, db::Db>, name: String) -> Result<db::Project, String> {
    with_db(&db, |c| db::create_project(c, name.trim()))
}

#[tauri::command]
fn db_rename_project(db: State<'_, db::Db>, id: i32, name: String) -> Result<(), String> {
    with_db(&db, |c| db::rename_project(c, id, name.trim()))?;
    Ok(())
}

#[tauri::command]
fn db_delete_project(db: State<'_, db::Db>, id: i32) -> Result<(), String> {
    with_db(&db, |c| db::delete_project(c, id))?;
    Ok(())
}

#[tauri::command]
fn db_list_notes(db: State<'_, db::Db>, project_id: i32) -> Result<Vec<db::Note>, String> {
    with_db(&db, |c| db::list_notes(c, project_id))
}

#[tauri::command]
fn db_create_note(
    db: State<'_, db::Db>,
    project_id: i32,
    content_md: String,
) -> Result<db::Note, String> {
    with_db(&db, |c| db::create_note(c, project_id, &content_md))
}

#[tauri::command]
fn db_update_note(db: State<'_, db::Db>, id: i32, content_md: String) -> Result<(), String> {
    with_db(&db, |c| db::update_note(c, id, &content_md))?;
    Ok(())
}

#[tauri::command]
fn db_set_note_color(db: State<'_, db::Db>, id: i32, color: Option<String>) -> Result<(), String> {
    with_db(&db, |c| db::set_note_color(c, id, color.as_deref()))?;
    Ok(())
}

#[tauri::command]
fn db_delete_note(db: State<'_, db::Db>, id: i32) -> Result<(), String> {
    with_db(&db, |c| db::delete_note(c, id))?;
    Ok(())
}

#[tauri::command]
fn db_add_attachment(
    db: State<'_, db::Db>,
    note_id: i32,
    kind: String,
    mime: String,
    file_name: String,
) -> Result<db::Attachment, String> {
    with_db(&db, |c| {
        db::add_attachment(c, note_id, &kind, &mime, &file_name)
    })
}

/// All settings as a flat `{ key: value }` object (values are always strings).
#[tauri::command]
fn db_get_all_settings(db: State<'_, db::Db>) -> Result<SettingsFlat, String> {
    let rows = with_db(&db, db::get_all_settings)?;
    Ok(SettingsFlat(rows.into_iter().collect()))
}

#[tauri::command]
fn db_get_setting(db: State<'_, db::Db>, key: String) -> Result<Option<String>, String> {
    with_db(&db, |c| db::get_setting(c, &key))
}

#[tauri::command]
fn db_set_setting(db: State<'_, db::Db>, key: String, value: String) -> Result<(), String> {
    with_db(&db, |c| db::set_setting(c, &key, &value))?;
    Ok(())
}

/// Frontend-facing settings payload: a flat string→string map.
/// Serialized as `{ "panel_side": "right", ... }`.
#[derive(Debug, serde::Serialize)]
pub struct SettingsFlat(pub std::collections::BTreeMap<String, String>);

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
    // The default toggle hotkey is registered in setup() with a dedicated
    // handler below. The frontend re-registers the full set (including project
    // shortcuts) once it has read settings. Do NOT use the plugin builder's
    // with_handler fallback here: it fires for EVERY shortcut on top of their
    // own handlers, which used to toggle (close) the panel whenever a project
    // shortcut was pressed while the panel was open.
    tauri::Builder::default()
        // Must be the first plugin: a second launch (accidental double-open,
        // re-pinned shortcut) surfaces the existing panel instead of starting
        // a second process fighting over the same SQLite database.
        .plugin(single_instance_init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(ShortcutBuilder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        // The panel is tray-resident: closing the window (Alt+F4) hides it
        // instead of destroying it — the webview must stay alive for the
        // quit-time update install, and a destroyed window can't be toggled
        // back anyway.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            // Open the SQLite database in the app data dir, run migrations,
            // and store the connection in Tauri state for the db_* commands.
            let db_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&db_dir)?;
            let db_path = db_dir.join("quickdoc.sqlite");
            let db = db::Db::init(&db_path)
                .map_err(|e| tauri::Error::Anyhow(anyhow::anyhow!("database init: {e}")))?;

            // Dock the panel on startup to the persisted side (the frontend
            // may re-dock later if settings changed since last launch). Done
            // before `app.manage(db)` moves the connection into state.
            {
                let mut conn = db
                    .0
                    .lock()
                    .map_err(|e| tauri::Error::Anyhow(anyhow::anyhow!("db lock poisoned: {e}")))?;
                let _ = window::dock_primary_from_db(app.handle(), &mut conn);
            }

            app.manage(db);

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
                        // Ask the frontend to run its quit path first: it
                        // installs a downloaded update (if any) before exit.
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.emit("quickdoc://quit", ());
                        } else {
                            app.exit(0);
                        }
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            dock_window,
            toggle_panel,
            show_panel,
            hide_panel,
            quit_app,
            enable_autostart,
            disable_autostart,
            autostart_enabled,
            save_attachment_bytes,
            import_attachment_path,
            attachments_dir_path,
            render_export_markdown,
            render_export_html,
            resolve_keybindings,
            db_list_projects,
            db_create_project,
            db_rename_project,
            db_delete_project,
            db_list_notes,
            db_create_note,
            db_update_note,
            db_set_note_color,
            db_delete_note,
            db_add_attachment,
            db_get_all_settings,
            db_get_setting,
            db_set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running QuickDoc");
}
