// Thin, typed data-access layer. All persistence runs on the Rust backend via
// Diesel/SQLite; this module just invokes the corresponding Tauri commands and
// reshapes the results to keep the rest of the frontend unchanged.

import { invoke } from "@tauri-apps/api/core";
import {
  Attachment,
  DEFAULT_KEYBINDINGS,
  KeybindingMap,
  Note,
  Project,
  SettingsMap,
} from "./types";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getAllSettings(): Promise<SettingsMap> {
  // The backend returns `{ key: value }` already; cast through the typed shape.
  return invoke<Record<string, string>>("db_get_all_settings").then(
    (flat) => flat as SettingsMap,
  );
}

export async function getSetting(key: string): Promise<string | undefined> {
  const value = await invoke<string | null>("db_get_setting", { key });
  return value ?? undefined;
}

/** Upsert a setting. */
export async function setSetting(key: string, value: string): Promise<void> {
  await invoke("db_set_setting", { key, value });
}

/** Ensure all default settings exist (the backend seeds on startup; this is a
 *  no-op-safe nudge for the UI lifecycle). Kept for App.tsx compatibility. */
export async function seedDefaults(): Promise<void> {
  // Defaults are seeded during backend DB init; nothing to do here.
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
  return invoke<Project[]>("db_list_projects");
}

/** Create a project and return its new id (matching the old SQL-plugin shape). */
export async function createProject(name: string): Promise<number> {
  const project = await invoke<Project>("db_create_project", { name });
  return project.id;
}

export async function renameProject(id: number, name: string): Promise<void> {
  await invoke("db_rename_project", { id, name });
}

export async function deleteProject(id: number): Promise<void> {
  await invoke("db_delete_project", { id });
}

// ---------------------------------------------------------------------------
// Notes + attachments
// ---------------------------------------------------------------------------

export async function listNotes(projectId: number): Promise<Note[]> {
  return invoke<Note[]>("db_list_notes", { projectId });
}

/** Insert a note and return the new note (attachments already empty). */
export async function createNote(
  projectId: number,
  contentMd: string,
): Promise<Note> {
  return invoke<Note>("db_create_note", { projectId, contentMd });
}

export async function updateNote(id: number, contentMd: string): Promise<void> {
  await invoke("db_update_note", { id, contentMd });
}

export async function deleteNote(id: number): Promise<void> {
  await invoke("db_delete_note", { id });
}

export async function addAttachment(
  noteId: number,
  kind: string,
  mime: string,
  fileName: string,
): Promise<Attachment> {
  return invoke<Attachment>("db_add_attachment", {
    noteId,
    kind,
    mime,
    fileName,
  });
}

