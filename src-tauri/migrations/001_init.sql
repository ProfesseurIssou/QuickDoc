-- QuickDoc initial schema (v1).
-- Plain SQLite, intentionally simple and readable.

-- Named projects / chats. sort_order drives display order in the switcher.
CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Chronological notes per project. content_md is the Markdown source.
CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL,
    content_md  TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id, created_at DESC);

-- Generic attachments. `kind` is an extensible enum so new media types
-- (e.g. 'video') can be added later WITHOUT any schema change.
CREATE TABLE IF NOT EXISTS attachments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id     INTEGER NOT NULL,
    kind        TEXT NOT NULL,          -- 'image', (later: 'video', ...)
    mime        TEXT NOT NULL,
    file_name   TEXT NOT NULL,          -- stable name inside the attachments folder
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments(note_id);

-- Key/value settings (panel_side, locale, keybindings, ...).
CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

-- Seed the default "Inbox" project so the app is never empty on first run.
INSERT INTO projects (name, sort_order)
SELECT 'Inbox', 0
WHERE NOT EXISTS (SELECT 1 FROM projects);
