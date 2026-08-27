// Attachment helpers for the frontend: clipboard paste, file import, and
// resolving an attachment's file name to something the <img>/export can use.

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { readImage } from "@tauri-apps/plugin-clipboard-manager";
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
 *
 * The plugin only exposes raw RGBA pixels, which are not a valid image file on
 * their own — encode them into a real PNG via a canvas before persisting.
 */
export async function pasteImageFromClipboard(): Promise<SavedAttachment | null> {
  try {
    const image = await readImage();
    const [rgba, size] = await Promise.all([image.rgba(), image.size()]);
    const { width, height } = size;
    if (!rgba.length || !width || !height) return null;
    const png = await rgbaToPngBlob(rgba, width, height);
    return await saveBytes(new Uint8Array(await png.arrayBuffer()), "image/png");
  } catch {
    return null;
  }
}

/** Encode raw RGBA pixels into a PNG blob using a 2D canvas. */
async function rgbaToPngBlob(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("PNG encoding failed");
  return blob;
}

/** Persist a file picked/dropped by absolute path via the Rust backend. */
export async function importFileFromPath(
  path: string,
): Promise<SavedAttachment> {
  return invoke<SavedAttachment>("import_attachment_path", {
    path,
    mime: mimeFromPath(path),
  });
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

/** True when a path looks like an image we can store. */
export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.includes(
    path.split(".").pop()?.toLowerCase() ?? "",
  );
}

/** Persist every dropped image file, skipping non-image paths. */
export async function importDroppedFiles(
  paths: string[],
): Promise<SavedAttachment[]> {
  const out: SavedAttachment[] = [];
  for (const path of paths.filter(isImagePath)) {
    out.push(await importFileFromPath(path));
  }
  return out;
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
