import { describe, it, expect } from "vitest";
import { migrateLegacyBindings } from "../lib/keybindings";
import { DEFAULT_KEYBINDINGS } from "../lib/types";

describe("migrateLegacyBindings", () => {
  it("moves legacy Ctrl+Alt+N project shortcuts to Ctrl+Shift+N", () => {
    const legacy: typeof DEFAULT_KEYBINDINGS = {
      ...DEFAULT_KEYBINDINGS,
      select_project_4: "Ctrl+Alt+4",
    };
    const migrated = migrateLegacyBindings(legacy);
    expect(migrated.select_project_4).toBe("Ctrl+Shift+4");
    // Returns a new map and would be persisted.
    expect(migrated).not.toBe(legacy);
  });

  it("leaves user-customized bindings untouched", () => {
    const custom = { ...DEFAULT_KEYBINDINGS, select_project_4: "F9" };
    expect(migrateLegacyBindings(custom)).toBe(custom);
  });

  it("is a no-op for current defaults", () => {
    const defaults = { ...DEFAULT_KEYBINDINGS };
    expect(migrateLegacyBindings(defaults)).toBe(defaults);
  });

  it("migrates every digit slot", () => {
    const legacy = { ...DEFAULT_KEYBINDINGS };
    for (let n = 1; n <= 9; n++) {
      legacy[`select_project_${n}`] = `Ctrl+Alt+${n}`;
    }
    const migrated = migrateLegacyBindings(legacy);
    for (let n = 1; n <= 9; n++) {
      expect(migrated[`select_project_${n}`]).toBe(`Ctrl+Shift+${n}`);
    }
  });
});
