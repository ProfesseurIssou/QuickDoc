-- QuickDoc initial schema (v1).
-- Plain SQLite, intentionally simple and readable.
-- (Migrated from tauri-plugin-sql's 001_init.sql to an embedded Diesel migration.)

-- Named projects / chats. sort_order drives display order in the switcher.
CREATE TABLE projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Chronological notes per project. content_md is the Markdown source.
CREATE TABLE notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL,
    content_md  TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_notes_project ON notes(project_id, created_at DESC);

-- Generic attachments. `kind` is an extensible enum so new media types
-- (e.g. 'video') can be added later WITHOUT any schema change.
CREATE TABLE attachments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id     INTEGER NOT NULL,
    kind        TEXT NOT NULL,          -- 'image', (later: 'video', ...)
    mime        TEXT NOT NULL,
    file_name   TEXT NOT NULL,          -- stable name inside the attachments folder
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);
CREATE INDEX idx_attachments_note ON attachments(note_id);

-- Key/value settings (panel_side, locale, keybindings, ...).
CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
