// Turn a browser KeyboardEvent into a friendly keybinding string such as
// "Ctrl+Alt+Space". Pure function, unit-tested independently of the widget.

export interface KeyDescriptor {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  key: string; // already normalized
}

const MODIFIERS = new Set(["Control", "Alt", "Shift", "Meta"]);

/** Normalize the key part: letters upper-cased, special keys spelled out. */
export function normalizeKey(rawKey: string): string {
  if (rawKey === " ") return "Space";
  if (rawKey.length === 1) return rawKey.toUpperCase();
  // Keep functional keys like "F1", "Enter", "ArrowUp" as-is.
  return rawKey;
}

/**
 * Convert a key event into a binding string. Returns null when the key is a
 * lone modifier (we wait for the actual key) or empty.
 *
 * Example: Ctrl+Alt+Space -> "Ctrl+Alt+Space"
 */
export function describeBinding(desc: KeyDescriptor): string | null {
  const parts: string[] = [];
  if (desc.ctrl) parts.push("Ctrl");
  if (desc.alt) parts.push("Alt");
  if (desc.shift) parts.push("Shift");
  if (desc.meta) parts.push("Cmd");
  const isBareModifier = MODIFIERS.has(desc.key);
  if (isBareModifier) return null; // wait for a real key
  parts.push(normalizeKey(desc.key));
  return parts.join("+");
}

/** Build a descriptor from a DOM KeyboardEvent. */
export function fromEvent(e: KeyboardEvent): KeyDescriptor {
  return {
    ctrl: e.ctrlKey,
    meta: e.metaKey,
    alt: e.altKey,
    shift: e.shiftKey,
    key: e.key,
  };
}
