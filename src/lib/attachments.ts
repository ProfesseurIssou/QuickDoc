// Attachment helpers for the frontend: clipboard paste, file import, and
// resolving an attachment's file name to something the <img>/export can use.

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { readImage, readText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { addAttachment } from "./db";
import { Attachment, AttachmentKind } from "./types";

/** A saved attachment ready to insert into the DB. */
export interface SavedAttachment {
  kind: string;
  mime: string;
  file_name: string;
}

/** Persist raw bytes to the attachments folder via the Rust backend. */
export async function saveBytes(
  bytes: Uint8Array,
  mime: string,
): Promise<SavedAttachment> {
  // The backend expects a plain number array (serde default for Vec<u8>).
  return invoke<SavedAttachment>("save_attachment_bytes", {
    bytes: Array.from(bytes),
    mime,
  });
}

/** Convert an attachment's stored file name into a displayable src URL. */
export async function attachmentSrc(
  attachment: Pick<Attachment, "file_name">,
): Promise<string> {
  const dir = await invoke<string>("attachments_dir_path");
  return convertFileSrc(`${dir}/${attachment.file_name}`);
}

/**
 * Read the clipboard. If it holds an image, persist it and return the saved
 * attachment descriptor. Returns null when the clipboard has no image.
 */
export async function pasteImageFromClipboard(): Promise<SavedAttachment | null> {
  // Try the clipboard image first; fall back to null when only text is present.
  try {
    const image = await readImage();
    // rgba() returns raw pixel bytes (Promise<Uint8Array>). We store them with
    // PNG metadata so the DB record + renderer treat it as an image.
    const rgba = await image.rgba();
    return await saveBytes(rgba, "image/png");
  } catch {
    try {
      await readText();
      return null;
    } catch {
      return null;
    }
  }
}

/** Open a file picker for images, read + persist each, return descriptors. */
export async function importImageFiles(): Promise<SavedAttachment[]> {
  const selected = await open({
    multiple: true,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }],
  });
  if (!selected) return [];
  const paths = Array.isArray(selected) ? selected : [selected];
  const out: SavedAttachment[] = [];
  for (const path of paths) {
    const bytes = await readFile(path);
    const mime = mimeFromPath(path);
    out.push(await saveBytes(bytes, mime));
  }
  return out;
}

/** Attach saved descriptors to a note in the DB, returning the new rows. */
export async function attachToNote(
  noteId: number,
  saved: SavedAttachment[],
): Promise<Attachment[]> {
  const created: Attachment[] = [];
  for (const s of saved) {
    created.push(await addAttachment(noteId, s.kind as AttachmentKind, s.mime, s.file_name));
  }
  return created;
}

export function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}

/** Normalize a kind string to a known AttachmentKind (defaults to image). */
export function normalizeKind(kind: string): AttachmentKind {
  return kind === "video" ? "video" : "image";
}
