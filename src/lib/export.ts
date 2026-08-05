// Export helpers: gather a project's data, hand it to the Rust renderers, and
// write the output files. Splitting "what to render" (Rust, tested) from "where
// to write it" (here) keeps both sides simple.

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { mkdir, writeFile, copyFile, exists } from "@tauri-apps/plugin-fs";
import { join, dirname } from "@tauri-apps/api/path";
import { listNotes } from "./db";
import { attachmentSrc } from "./attachments";
import { Note } from "./types";

/** The shape the Rust export renderer expects (matches src-tauri export.rs). */
interface ExportAttachment {
  kind: string;
  mime: string;
  file_name: string;
}
interface ExportNote {
  content_md: string;
  created_at: string;
  attachments: ExportAttachment[];
}
interface ExportProject {
  name: string;
  notes: ExportNote[];
}

/** Build the ExportProject DTO for a given project id. */
export async function buildExportProject(
  projectName: string,
  projectId: number,
): Promise<ExportProject> {
  const notes = await listNotes(projectId);
  return {
    name: projectName,
    notes: notes.map((n: Note) => ({
      content_md: n.content_md,
      created_at: n.created_at,
      attachments: n.attachments.map((a) => ({
        kind: a.kind,
        mime: a.mime,
        file_name: a.file_name,
      })),
    })),
  };
}

/** Export a project to a single Markdown file plus an `assets/` folder. */
export async function exportProjectMarkdown(
  projectName: string,
  projectId: number,
): Promise<string | null> {
  const project = await buildExportProject(projectName, projectId);
  const md = await invoke<string>("render_export_markdown", { project });
  const dest = await save({
    defaultPath: `${safeName(projectName)}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!dest) return null;
  const destDir = await dirname(dest);
  const data = new TextEncoder().encode(md);
  await writeFile(dest, data);
  // Copy referenced image assets next to the .md into ./assets.
  const assetsDir = await join(destDir, "assets");
  await mkdir(assetsDir, { recursive: true });
  const dir = await invoke<string>("attachments_dir_path");
  for (const note of project.notes) {
    for (const att of note.attachments) {
      if (att.kind !== "image") continue;
      const src = `${dir}/${att.file_name}`;
      if (await exists(src)) {
        await copyFile(src, await join(assetsDir, att.file_name));
      }
    }
  }
  return dest;
}

/**
 * Export a project to a self-contained HTML file (images embedded as base64).
 */
export async function exportProjectHtml(
  projectName: string,
  projectId: number,
): Promise<string | null> {
  const project = await buildExportProject(projectName, projectId);
  const assetsBase64 = await collectAssetsBase64(project);
  const html = await invoke<string>("render_export_html", {
    project,
    title: projectName,
    assetsBase64,
  });
  const dest = await save({
    defaultPath: `${safeName(projectName)}.html`,
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!dest) return null;
  await writeFile(dest, new TextEncoder().encode(html));
  return dest;
}

/** Read each referenced image into a base64 map keyed by file name. */
async function collectAssetsBase64(
  project: ExportProject,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const note of project.notes) {
    for (const att of note.attachments) {
      if (att.kind !== "image") continue;
      if (out[att.file_name]) continue;
      const url = await attachmentSrc(att);
      const b64 = await fetchToBase64(url);
      out[att.file_name] = b64;
    }
  }
  return out;
}

/** Fetch a converted-file-src URL and base64-encode it (drops the data: prefix). */
async function fetchToBase64(url: string): Promise<string> {
  const resp = await fetch(url);
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function safeName(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, "_") || "quickdoc";
}
