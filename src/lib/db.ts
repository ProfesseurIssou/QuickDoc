// Thin, typed data-access layer over SQLite (via tauri-plugin-sql).
// Intentionally no ORM: just small, readable query helpers.

import Database from "@tauri-apps/plugin-sql";
import {
  Attachment,
  DEFAULT_KEYBINDINGS,
  DEFAULT_LOCALE,
  DEFAULT_PANEL_SIDE,
  KeybindingMap,
  Note,
  Project,
  SettingsMap,
} from "./types";

let dbPromise: Promise<Database> | null = null;

/** Lazily open the single app database. Migrations are applied on the Rust side. */
export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    // The "sqlite:quickdoc.sqlite" path must match the migration registration.
    dbPromise = Database.load("sqlite:quickdoc.sqlite");
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getAllSettings(): Promise<SettingsMap> {
  const db = await getDb();
  const rows = await db.select<{ key: string; value: string }[]>(
    "SELECT key, value FROM settings",
  );
  const map: SettingsMap = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export async function getSetting(key: string): Promise<string | undefined> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return rows[0]?.value;
}

/** Upsert a setting and return it. */
export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

/** Ensure all default settings exist (no overwrite of user values). */
export async function seedDefaults(): Promise<void> {
  const defaults: SettingsMap = {
    panel_side: DEFAULT_PANEL_SIDE,
    locale: DEFAULT_LOCALE,
    active_project_id: "1",
    keybindings: JSON.stringify(DEFAULT_KEYBINDINGS),
  };
  const db = await getDb();
  for (const [key, value] of Object.entries(defaults)) {
    await db.execute(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO NOTHING",
      [key, value],
    );
  }
}

export async function getKeybindings(): Promise<KeybindingMap> {
  const raw = await getSetting("keybindings");
  if (!raw) return { ...DEFAULT_KEYBINDINGS };
  try {
    return { ...DEFAULT_KEYBINDINGS, ...(JSON.parse(raw) as KeybindingMap) };
  } catch {
    return { ...DEFAULT_KEYBINDINGS };
  }
}

export async function setKeybindings(map: KeybindingMap): Promise<void> {
  await setSetting("keybindings", JSON.stringify(map));
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  return db.select<Project[]>(
    "SELECT id, name, sort_order, created_at FROM projects ORDER BY sort_order, id",
  );
}

export async function createProject(name: string): Promise<number> {
  const db = await getDb();
  const sortOrder = (
    await db.select<{ max_sort: number | null }[]>(
      "SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM projects",
    )
  )[0].max_sort;
  const next = (sortOrder ?? -1) + 1;
  const res = await db.execute(
    "INSERT INTO projects (name, sort_order) VALUES ($1, $2)",
    [name.trim(), next],
  );
  return Number(res.lastInsertId);
}

export async function renameProject(id: number, name: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE projects SET name = $1 WHERE id = $2", [
    name.trim(),
    id,
  ]);
}

export async function deleteProject(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM projects WHERE id = $1", [id]);
}

// ---------------------------------------------------------------------------
// Notes + attachments
// ---------------------------------------------------------------------------

export async function listNotes(projectId: number): Promise<Note[]> {
  const db = await getDb();
  const notes = await db.select<Note[]>(
    "SELECT id, project_id, content_md, created_at, updated_at FROM notes WHERE project_id = $1 ORDER BY created_at DESC",
    [projectId],
  );
  if (notes.length === 0) return notes;
  const ids = notes.map((n) => n.id);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
  const atts = await db.select<Attachment[]>(
    `SELECT id, note_id, kind, mime, file_name, created_at FROM attachments WHERE note_id IN (${placeholders})`,
    ids,
  );
  const byNote = new Map<number, Attachment[]>();
  for (const a of atts) {
    const list = byNote.get(a.note_id) ?? [];
    list.push(a);
    byNote.set(a.note_id, list);
  }
  for (const n of notes) n.attachments = byNote.get(n.id) ?? [];
  return notes;
}

/** Insert a note and return the new note with an empty attachments list. */
export async function createNote(
  projectId: number,
  contentMd: string,
): Promise<Note> {
  const db = await getDb();
  const res = await db.execute(
    "INSERT INTO notes (project_id, content_md) VALUES ($1, $2)",
    [projectId, contentMd],
  );
  const id = Number(res.lastInsertId);
  const row = (
    await db.select<Note[]>(
      "SELECT id, project_id, content_md, created_at, updated_at FROM notes WHERE id = $1",
      [id],
    )
  )[0];
  return { ...row, attachments: [] };
}

export async function updateNote(id: number, contentMd: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE notes SET content_md = $1, updated_at = datetime('now') WHERE id = $2",
    [contentMd, id],
  );
}

export async function deleteNote(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM notes WHERE id = $1", [id]);
}

export async function addAttachment(
  noteId: number,
  kind: string,
  mime: string,
  fileName: string,
): Promise<Attachment> {
  const db = await getDb();
  const res = await db.execute(
    "INSERT INTO attachments (note_id, kind, mime, file_name) VALUES ($1, $2, $3, $4)",
    [noteId, kind, mime, fileName],
  );
  const id = Number(res.lastInsertId);
  const row = (
    await db.select<Attachment[]>(
      "SELECT id, note_id, kind, mime, file_name, created_at FROM attachments WHERE id = $1",
      [id],
    )
  )[0];
  return row;
}
