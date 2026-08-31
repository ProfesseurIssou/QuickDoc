//! SQLite persistence via Diesel.
//!
//! Owns the DB connection (a single `SqliteConnection` guarded by a `Mutex`,
//! held in Tauri app state), runs embedded migrations on startup, seeds the
//! default "Inbox" project, and exposes typed CRUD the Tauri commands call.
//!
//! Connection mode: the app opens one connection for its lifetime. SQLite
//! handles concurrent readers from the same process fine, and writes are
//! serialized through the mutex. WAL is enabled for better read concurrency.

use std::path::Path;
use std::sync::Mutex;

use anyhow::Context;
use diesel::prelude::*;
use diesel::upsert::excluded;
use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};

use crate::schema::{attachments, notes, projects, settings};

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

/// A single guarded SQLite connection, shared across all commands.
pub struct Db(pub Mutex<SqliteConnection>);

impl Db {
    /// Open (or create) the database at `path`, enable WAL, run pending
    /// migrations, and seed defaults.
    pub fn init(path: &Path) -> anyhow::Result<Self> {
        let mut conn = SqliteConnection::establish(&path.to_string_lossy())
            .with_context(|| format!("opening sqlite at {}", path.display()))?;

        // Better read concurrency; safe to ignore on read-only mounts.
        let _ = diesel::sql_query("PRAGMA journal_mode = WAL").execute(&mut conn);
        // ON DELETE CASCADE requires this pragma per connection.
        let _ = diesel::sql_query("PRAGMA foreign_keys = ON").execute(&mut conn);

        conn.run_pending_migrations(MIGRATIONS)
            .map_err(|e| anyhow::anyhow!("running migrations: {e}"))?;

        seed_defaults(&mut conn);

        Ok(Db(Mutex::new(conn)))
    }
}

/// Insert the default "Inbox" project + default settings when the DB is empty.
fn seed_defaults(conn: &mut SqliteConnection) {
    let has_projects: i64 = projects::table.count().first(conn).unwrap_or(0);
    if has_projects == 0 {
        let _ = diesel::insert_into(projects::table)
            .values(&(projects::name.eq("Inbox"), projects::sort_order.eq(0)))
            .execute(conn);
    }

    // Idempotent defaults: only fill keys that are missing.
    for (key, value) in crate::settings::defaults() {
        let key: &str = key;
        let exists: i64 = settings::table
            .filter(settings::key.eq(key))
            .count()
            .first(conn)
            .unwrap_or(0);
        if exists == 0 {
            let _ = diesel::insert_into(settings::table)
                .values((settings::key.eq(key), settings::value.eq(value)))
                .execute(conn);
        }
    }
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/// Project row, serialized to the frontend as-is (snake_case via serde rename).
#[derive(Debug, Clone, Queryable, Selectable, serde::Serialize)]
#[diesel(table_name = projects)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
#[serde(rename_all = "snake_case")]
pub struct Project {
    pub id: i32,
    pub name: String,
    pub sort_order: i32,
    pub created_at: String,
}

/// A note WITHOUT its attachments. Use [`Note`] for the full record.
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = notes)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
struct NoteRow {
    id: i32,
    project_id: i32,
    content_md: String,
    created_at: String,
    updated_at: String,
    color: Option<String>,
}

/// Frontend-facing note, with its attachments eagerly loaded.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct Note {
    pub id: i32,
    pub project_id: i32,
    pub content_md: String,
    pub created_at: String,
    pub updated_at: String,
    /// Optional tint (CSS hex color) applied to the note card in the history.
    pub color: Option<String>,
    pub attachments: Vec<Attachment>,
}

#[derive(Debug, Clone, Queryable, Selectable, serde::Serialize)]
#[diesel(table_name = attachments)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
#[serde(rename_all = "snake_case")]
pub struct Attachment {
    pub id: i32,
    pub note_id: i32,
    pub kind: String,
    pub mime: String,
    pub file_name: String,
    pub created_at: String,
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

pub fn list_projects(conn: &mut SqliteConnection) -> QueryResult<Vec<Project>> {
    projects::table
        .order((projects::sort_order.asc(), projects::id.asc()))
        .select(Project::as_select())
        .load(conn)
}

pub fn create_project(conn: &mut SqliteConnection, name: &str) -> QueryResult<Project> {
    let max_order: Option<i32> = projects::table
        .select(diesel::dsl::max(projects::sort_order))
        .first(conn)?;
    let next_order = max_order.unwrap_or(-1) + 1;

    diesel::insert_into(projects::table)
        .values((projects::name.eq(name), projects::sort_order.eq(next_order)))
        .execute(conn)?;

    projects::table
        .order(projects::id.desc())
        .select(Project::as_select())
        .first(conn)
}

pub fn rename_project(conn: &mut SqliteConnection, id: i32, name: &str) -> QueryResult<usize> {
    diesel::update(projects::table.filter(projects::id.eq(id)))
        .set(projects::name.eq(name))
        .execute(conn)
}

pub fn delete_project(conn: &mut SqliteConnection, id: i32) -> QueryResult<usize> {
    diesel::delete(projects::table.filter(projects::id.eq(id))).execute(conn)
}

/// Load a project's notes oldest first (chronological), with the note id as a
/// stable secondary sort key so same-second inserts keep their creation order.
/// Attachments for the returned notes are eagerly filled in.
pub fn list_notes(conn: &mut SqliteConnection, project_id: i32) -> QueryResult<Vec<Note>> {
    let rows = notes::table
        .filter(notes::project_id.eq(project_id))
        .order((notes::created_at.asc(), notes::id.asc()))
        .select(NoteRow::as_select())
        .load::<NoteRow>(conn)?;

    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let ids: Vec<i32> = rows.iter().map(|r| r.id).collect();
    let atts = attachments::table
        .filter(attachments::note_id.eq_any(ids))
        .order(attachments::created_at.asc())
        .select(Attachment::as_select())
        .load::<Attachment>(conn)?;

    let mut by_note: std::collections::HashMap<i32, Vec<Attachment>> =
        std::collections::HashMap::new();
    for a in atts {
        by_note.entry(a.note_id).or_default().push(a);
    }

    Ok(rows
        .into_iter()
        .map(|r| Note {
            id: r.id,
            project_id: r.project_id,
            content_md: r.content_md,
            created_at: r.created_at,
            updated_at: r.updated_at,
            color: r.color,
            attachments: by_note.remove(&r.id).unwrap_or_default(),
        })
        .collect())
}

pub fn create_note(
    conn: &mut SqliteConnection,
    project_id: i32,
    content_md: &str,
) -> QueryResult<Note> {
    diesel::insert_into(notes::table)
        .values((
            notes::project_id.eq(project_id),
            notes::content_md.eq(content_md),
        ))
        .execute(conn)?;

    let row = notes::table
        .order(notes::id.desc())
        .select(NoteRow::as_select())
        .first::<NoteRow>(conn)?;

    Ok(Note {
        id: row.id,
        project_id: row.project_id,
        content_md: row.content_md,
        created_at: row.created_at,
        updated_at: row.updated_at,
        color: row.color,
        attachments: Vec::new(),
    })
}

pub fn update_note(conn: &mut SqliteConnection, id: i32, content_md: &str) -> QueryResult<usize> {
    diesel::update(notes::table.filter(notes::id.eq(id)))
        .set((
            notes::content_md.eq(content_md),
            notes::updated_at.eq(diesel::dsl::sql::<diesel::sql_types::Text>(
                "datetime('now')",
            )),
        ))
        .execute(conn)
}

pub fn set_note_color(
    conn: &mut SqliteConnection,
    id: i32,
    color: Option<&str>,
) -> QueryResult<usize> {
    diesel::update(notes::table.filter(notes::id.eq(id)))
        .set(notes::color.eq(color))
        .execute(conn)
}

pub fn delete_note(conn: &mut SqliteConnection, id: i32) -> QueryResult<usize> {
    diesel::delete(notes::table.filter(notes::id.eq(id))).execute(conn)
}

pub fn add_attachment(
    conn: &mut SqliteConnection,
    note_id: i32,
    kind: &str,
    mime: &str,
    file_name: &str,
) -> QueryResult<Attachment> {
    diesel::insert_into(attachments::table)
        .values((
            attachments::note_id.eq(note_id),
            attachments::kind.eq(kind),
            attachments::mime.eq(mime),
            attachments::file_name.eq(file_name),
        ))
        .execute(conn)?;

    attachments::table
        .order(attachments::id.desc())
        .select(Attachment::as_select())
        .first(conn)
}

pub fn get_all_settings(conn: &mut SqliteConnection) -> QueryResult<Vec<(String, String)>> {
    settings::table
        .select((settings::key, settings::value))
        .order(settings::key.asc())
        .load::<(String, String)>(conn)
}

pub fn get_setting(conn: &mut SqliteConnection, key: &str) -> QueryResult<Option<String>> {
    settings::table
        .filter(settings::key.eq(key))
        .select(settings::value)
        .first::<String>(conn)
        .optional()
}

pub fn set_setting(conn: &mut SqliteConnection, key: &str, value: &str) -> QueryResult<()> {
    diesel::insert_into(settings::table)
        .values((settings::key.eq(key), settings::value.eq(value)))
        .on_conflict(settings::key)
        .do_update()
        .set(settings::value.eq(excluded(settings::value)))
        .execute(conn)?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    /// A fresh in-memory-ish DB backed by a temp file, with migrations applied.
    /// `pub(crate)` so sibling modules' tests can build a temp DB.
    pub(crate) fn test_db() -> (NamedTempFile, SqliteConnection) {
        let file = NamedTempFile::new().unwrap();
        let mut conn = SqliteConnection::establish(&file.path().to_string_lossy()).unwrap();
        conn.run_pending_migrations(MIGRATIONS).unwrap();
        seed_defaults(&mut conn);
        (file, conn)
    }

    #[test]
    fn defaults_seed_inbox_and_settings() {
        let (_f, mut conn) = test_db();
        let projects = list_projects(&mut conn).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "Inbox");
        assert_eq!(
            get_setting(&mut conn, "panel_side").unwrap().as_deref(),
            Some("right")
        );
    }

    #[test]
    fn note_roundtrip_with_attachment() {
        let (_f, mut conn) = test_db();
        let project = list_projects(&mut conn).unwrap().pop().unwrap();
        let note = create_note(&mut conn, project.id, "hello").unwrap();
        assert_eq!(note.attachments.len(), 0);

        let att = add_attachment(&mut conn, note.id, "image", "image/png", "a.png").unwrap();
        assert_eq!(att.note_id, note.id);

        let loaded = list_notes(&mut conn, project.id).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].content_md, "hello");
        assert_eq!(loaded[0].attachments.len(), 1);
        assert_eq!(loaded[0].attachments[0].file_name, "a.png");
    }

    #[test]
    fn note_color_roundtrip() {
        let (_f, mut conn) = test_db();
        let project = list_projects(&mut conn).unwrap().pop().unwrap();
        let note = create_note(&mut conn, project.id, "hello").unwrap();
        assert_eq!(note.color, None);

        set_note_color(&mut conn, note.id, Some("#4caf50")).unwrap();
        let loaded = list_notes(&mut conn, project.id).unwrap();
        assert_eq!(loaded[0].color.as_deref(), Some("#4caf50"));

        // Setting None clears the tint.
        set_note_color(&mut conn, note.id, None).unwrap();
        let loaded = list_notes(&mut conn, project.id).unwrap();
        assert_eq!(loaded[0].color, None);
    }

    #[test]
    fn settings_upsert_overwrites() {
        let (_f, mut conn) = test_db();
        set_setting(&mut conn, "locale", "fr").unwrap();
        set_setting(&mut conn, "locale", "en").unwrap(); // overwrite, not duplicate
        assert_eq!(
            get_setting(&mut conn, "locale").unwrap().as_deref(),
            Some("en")
        );
        let all = get_all_settings(&mut conn).unwrap();
        assert_eq!(all.iter().filter(|(k, _)| k == "locale").count(), 1);
    }

    #[test]
    fn project_sort_order_increments() {
        let (_f, mut conn) = test_db();
        let p = create_project(&mut conn, "Work").unwrap();
        // Inbox has sort_order 0; the next project should be 1.
        assert_eq!(p.sort_order, 1);
    }

    #[test]
    fn notes_returned_oldest_first() {
        let (_f, mut conn) = test_db();
        let project = list_projects(&mut conn).unwrap().pop().unwrap();
        // Insert A, B, C in order with a small delay so their created_at
        // timestamps differ.
        let a = create_note(&mut conn, project.id, "A").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let b = create_note(&mut conn, project.id, "B").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let c = create_note(&mut conn, project.id, "C").unwrap();

        let loaded = list_notes(&mut conn, project.id).unwrap();
        assert_eq!(loaded.len(), 3);
        // Oldest first => [A, B, C].
        assert_eq!(loaded[0].content_md, "A");
        assert_eq!(loaded[1].content_md, "B");
        assert_eq!(loaded[2].content_md, "C");
        // Sanity: ids are ascending too.
        assert!(a.id < b.id);
        assert!(b.id < c.id);
    }

    #[test]
    fn notes_same_second_keep_creation_order() {
        let (_f, mut conn) = test_db();
        let project = list_projects(&mut conn).unwrap().pop().unwrap();
        // Three notes created within the same second: created_at is identical,
        // so the id tiebreaker must keep insertion order.
        let a = create_note(&mut conn, project.id, "A").unwrap();
        let b = create_note(&mut conn, project.id, "B").unwrap();
        let c = create_note(&mut conn, project.id, "C").unwrap();

        let loaded = list_notes(&mut conn, project.id).unwrap();
        assert_eq!(loaded.len(), 3);
        assert_eq!(loaded[0].content_md, "A");
        assert_eq!(loaded[1].content_md, "B");
        assert_eq!(loaded[2].content_md, "C");
        // All share the same second-resolution timestamp.
        assert_eq!(a.created_at, b.created_at);
        assert_eq!(b.created_at, c.created_at);
    }
}
