// Shared domain types for QuickDoc. Kept in one place so the schema is obvious.

/** A named project / chat. */
export interface Project {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
}

/** A chronological Markdown note belonging to a project. */
export interface Note {
  id: number;
  project_id: number;
  content_md: string;
  created_at: string;
  updated_at: string;
  attachments: Attachment[];
}

/** Generic attachment. `kind` is an extensible enum so video needs no schema change later. */
export interface Attachment {
  id: number;
  note_id: number;
  kind: AttachmentKind;
  mime: string;
  file_name: string;
  created_at: string;
}

export type AttachmentKind = "image" | "video";

/** Key/value settings row. */
export type SettingsMap = Record<string, string>;

/** Human-readable action -> keybinding string, e.g. { toggle_panel: "Ctrl+Alt+Space" }. */
export type KeybindingMap = Record<string, string>;

/** Default keybindings, mirrored from the Rust defaults(). */
// Project shortcuts use Ctrl+Shift (not Ctrl+Alt): Windows reports AltGr as
// Ctrl+Alt, so Ctrl+Alt+<digit> globals would swallow AltGr characters
// ({, #, [ …) typed in any application on European keyboards.
export const DEFAULT_KEYBINDINGS: KeybindingMap = {
  toggle_panel: "Ctrl+Alt+Space",
  cycle_projects: "Ctrl+Alt+P",
  save_note: "Ctrl+Enter",
  select_project_1: "Ctrl+Shift+1",
  select_project_2: "Ctrl+Shift+2",
  select_project_3: "Ctrl+Shift+3",
  select_project_4: "Ctrl+Shift+4",
  select_project_5: "Ctrl+Shift+5",
  select_project_6: "Ctrl+Shift+6",
  select_project_7: "Ctrl+Shift+7",
  select_project_8: "Ctrl+Shift+8",
  select_project_9: "Ctrl+Shift+9",
};

export const DEFAULT_PANEL_SIDE: PanelSide = "right";
export type PanelSide = "left" | "right";

export const DEFAULT_LOCALE = "en";
