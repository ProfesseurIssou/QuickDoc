// Keybinding manager: register global shortcuts from settings and dispatch
// actions as events the app listens to. `save_note` is handled inside the
// editor (window-level), so we skip it here.

import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
  isRegistered,
  register,
  unregister,
  unregisterAll,
} from "@tauri-apps/plugin-global-shortcut";
import { getKeybindings, setKeybindings } from "./db";
import { DEFAULT_KEYBINDINGS, KeybindingMap } from "./types";

/** Actions that can be triggered by a global shortcut. */
export type GlobalAction =
  | "toggle_panel"
  | "cycle_projects"
  | "select_project_1"
  | "select_project_2"
  | "select_project_3"
  | "select_project_4"
  | "select_project_5"
  | "select_project_6"
  | "select_project_7"
  | "select_project_8"
  | "select_project_9";

/** Name of the event broadcast when a global shortcut fires. */
export const SHORTCUT_EVENT = "quickdoc://action";

let initialized = false;

/**
 * Register all global shortcuts from the given keybinding map. Clears any
 * previously registered shortcuts first. Skips actions that don't map to a
 * global (e.g. save_note, handled in-window).
 */
export async function applyKeybindings(map: KeybindingMap): Promise<void> {
  await unregisterAll();
  const resolved = await invoke<Record<string, string>>("resolve_keybindings", {
    bindings: map,
  });
  for (const [action, accel] of Object.entries(resolved)) {
    if (!isGlobalAction(action)) continue;
    if (accel === map.save_note) continue;
    try {
      if (!(await isRegistered(accel))) {
        await register(accel, () => {
          void emit(SHORTCUT_EVENT, action);
        });
      }
    } catch {
      // Some shortcuts can't register (already taken by the OS). Skip silently.
    }
  }
}

function isGlobalAction(action: string): action is GlobalAction {
  return action.startsWith("select_project_") || action === "toggle_panel" || action === "cycle_projects";
}

/** Load saved keybindings (merged with defaults) and register them. */
export async function initKeybindings(): Promise<KeybindingMap> {
  const map = await getKeybindings();
  await applyKeybindings(map);
  initialized = true;
  return map;
}

/** Update one keybinding in settings and re-register everything. */
export async function updateKeybinding(
  action: string,
  binding: string,
): Promise<KeybindingMap> {
  const current = await getKeybindings();
  current[action] = binding;
  await setKeybindings(current);
  if (initialized) await applyKeybindings(current);
  return current;
}

/** Reset all keybindings to defaults (settings + registration). */
export async function resetKeybindings(): Promise<KeybindingMap> {
  await setKeybindings({ ...DEFAULT_KEYBINDINGS });
  await applyKeybindings({ ...DEFAULT_KEYBINDINGS });
  return { ...DEFAULT_KEYBINDINGS };
}

/** Subscribe to global shortcut actions. Returns an unsubscribe function. */
export function onAction(handler: (action: GlobalAction) => void): Promise<() => void> {
  return listen<string>(SHORTCUT_EVENT, (e) => {
    if (e.payload && isGlobalAction(e.payload)) handler(e.payload);
  });
}

/** Re-export unregister for callers that need manual cleanup. */
export { unregister };
