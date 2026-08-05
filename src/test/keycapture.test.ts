import { describe, it, expect } from "vitest";
import { describeBinding, normalizeKey, fromEvent } from "../lib/keycapture";

describe("normalizeKey", () => {
  it("maps space to Space", () => {
    expect(normalizeKey(" ")).toBe("Space");
  });
  it("upper-cases single letters", () => {
    expect(normalizeKey("a")).toBe("A");
    expect(normalizeKey("z")).toBe("Z");
  });
  it("keeps named keys as-is", () => {
    expect(normalizeKey("Enter")).toBe("Enter");
    expect(normalizeKey("F1")).toBe("F1");
  });
});

describe("describeBinding", () => {
  it("combines modifiers and key", () => {
    expect(
      describeBinding({ ctrl: true, alt: true, shift: false, meta: false, key: " " }),
    ).toBe("Ctrl+Alt+Space");
  });
  it("uses Cmd for meta", () => {
    expect(
      describeBinding({ ctrl: false, alt: false, shift: false, meta: true, key: "k" }),
    ).toBe("Cmd+K");
  });
  it("returns null for a bare modifier", () => {
    expect(
      describeBinding({ ctrl: true, alt: false, shift: false, meta: false, key: "Control" }),
    ).toBeNull();
  });
  it("includes shift", () => {
    expect(
      describeBinding({ ctrl: true, alt: false, shift: true, meta: false, key: "Enter" }),
    ).toBe("Ctrl+Shift+Enter");
  });
});

describe("fromEvent", () => {
  it("reads modifier flags and key", () => {
    const e = new KeyboardEvent("keydown", {
      key: "p",
      ctrlKey: true,
      altKey: true,
    });
    expect(fromEvent(e)).toEqual({
      ctrl: true,
      meta: false,
      alt: true,
      shift: false,
      key: "p",
    });
  });
});
