import { describe, it, expect } from "vitest";
import { isImagePath, mimeFromPath, normalizeKind } from "../lib/attachments";

describe("mimeFromPath", () => {
  it("maps common image extensions", () => {
    expect(mimeFromPath("a.png")).toBe("image/png");
    expect(mimeFromPath("photo.JPG")).toBe("image/jpeg");
    expect(mimeFromPath("x.jpeg")).toBe("image/jpeg");
    expect(mimeFromPath("anim.gif")).toBe("image/gif");
    expect(mimeFromPath("p.webp")).toBe("image/webp");
  });
  it("maps video extensions", () => {
    expect(mimeFromPath("clip.mp4")).toBe("video/mp4");
    expect(mimeFromPath("clip.webm")).toBe("video/webm");
  });
  it("falls back to octet-stream", () => {
    expect(mimeFromPath("file.xyz")).toBe("application/octet-stream");
    expect(mimeFromPath("noext")).toBe("application/octet-stream");
  });
});

describe("isImagePath", () => {
  it("accepts known image extensions", () => {
    expect(isImagePath("C:\\img\\shot.png")).toBe(true);
    expect(isImagePath("photo.jpeg")).toBe(true);
    expect(isImagePath("/tmp/anim.gif")).toBe(true);
    expect(isImagePath("vector.SVG")).toBe(true);
  });
  it("rejects other files", () => {
    expect(isImagePath("doc.pdf")).toBe(false);
    expect(isImagePath("clip.mp4")).toBe(false);
    expect(isImagePath("noext")).toBe(false);
  });
});

describe("normalizeKind", () => {
  it("keeps video", () => {
    expect(normalizeKind("video")).toBe("video");
  });
  it("defaults unknowns to image", () => {
    expect(normalizeKind("image")).toBe("image");
    expect(normalizeKind("garbage")).toBe("image");
    expect(normalizeKind("")).toBe("image");
  });
});
