// Note editor: a Markdown textarea (with optional preview), Enter to save,
// and image paste/import. After saving, the field clears and keeps focus so the
// "note & go" flow is frictionless.

import { useCallback, useEffect, useRef, useState } from "react";
import MDEditor from "@uiw/react-md-editor";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useTranslation } from "react-i18next";
import {
  attachToNote,
  importDroppedFiles,
  importImageFiles,
  pasteImageFromClipboard,
  SavedAttachment,
  saveBytes,
} from "../lib/attachments";
import { createNote } from "../lib/db";
import { Note } from "../lib/types";

interface Props {
  projectId: number;
  onSaved: (note: Note) => void;
}

export default function NoteEditor({ projectId, onSaved }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [preview, setPreview] = useState(false);
  const [pending, setPending] = useState<SavedAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const save = useCallback(async () => {
    const text = value.trim();
    if (!text && pending.length === 0) return;
    const note = await createNote(projectId, value);
    if (pending.length) {
      note.attachments = await attachToNote(note.id, pending);
    }
    onSaved(note);
    setValue("");
    setPending([]);
    // Re-focus the editor for the next quick note.
    requestAnimationFrame(() => containerRef.current?.focus());
  }, [value, pending, projectId, onSaved]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Enter saves, Shift+Enter inserts a newline. Esc hides the panel
    // (handled in App).
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      void save();
    }
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    // Prefer the real encoded image bytes exposed by the paste event; fall
    // back to the clipboard plugin (raw pixels re-encoded as PNG) otherwise.
    const item = Array.from(e.clipboardData.items).find((i) =>
      i.type.startsWith("image/"),
    );
    const file = item?.getAsFile();
    if (item && file) {
      e.preventDefault();
      const saved = await saveBytes(
        new Uint8Array(await file.arrayBuffer()),
        item.type,
      );
      setPending((p) => [...p, saved]);
      return;
    }
    const saved = await pasteImageFromClipboard();
    if (saved) setPending((p) => [...p, saved]);
  };

  // Drag & drop: dropped image files anywhere in the panel become pending
  // attachments (Tauri intercepts OS drops, so plain HTML5 drop events never
  // carry files — use the webview drag-drop event instead).
  useEffect(() => {
    let cancelled = false;
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (cancelled) return;
      const payload = event.payload;
      if (payload.type === "enter" || payload.type === "over") {
        setDragOver(true);
      } else if (payload.type === "leave") {
        setDragOver(false);
      } else if (payload.type === "drop") {
        setDragOver(false);
        void importDroppedFiles(payload.paths).then((saved) => {
          if (saved.length) setPending((p) => [...p, ...saved]);
        });
      }
    });
    return () => {
      cancelled = true;
      void unlisten.then((fn) => fn());
    };
  }, []);

  const onImport = async () => {
    const saved = await importImageFiles();
    if (saved.length) setPending((p) => [...p, ...saved]);
  };

  return (
    <div
      className={dragOver ? "editor drag-over" : "editor"}
      ref={containerRef}
      tabIndex={-1}
    >
      <div className="editor-toolbar">
        <button
          type="button"
          className="ghost"
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? t("editor.write") : t("editor.preview")}
        </button>
        <button type="button" className="ghost" onClick={onImport}>
          {t("attachments.import")}
        </button>
        <span className="spacer" />
        <button type="button" className="primary" onClick={() => void save()}>
          {t("editor.save")}
        </button>
      </div>

      <MDEditor
        value={value}
        onChange={(v) => setValue(v ?? "")}
        preview={preview ? "preview" : "edit"}
        hideToolbar
        height={160}
        textareaProps={{
          placeholder: t("editor.placeholder"),
          onKeyDown,
          onPaste,
        }}
      />

      {pending.length > 0 && (
        <div className="pending">
          {pending.map((a, i) => (
            <span key={i} className="chip">
              {a.file_name.slice(0, 12)}…
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
