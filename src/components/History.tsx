// History list for the current project: oldest first, Markdown rendered, image
// thumbnails via AttachmentView. Notes can be deleted, edited inline, and
// tinted with a color. The list auto-scrolls to the bottom so the newest note
// is always visible.

import { memo, useEffect, useRef, useState } from "react";
import MDEditor from "@uiw/react-md-editor";
import { useTranslation } from "react-i18next";
import AttachmentView from "./AttachmentView";
import { Note } from "../lib/types";

interface Props {
  notes: Note[];
  onDelete: (id: number) => void;
  onEdit: (id: number, contentMd: string) => void;
  onColor: (id: number, color: string | null) => void;
}

/** Preset note colors offered next to the timestamp. */
const NOTE_COLORS = ["#4caf50", "#e5484d", "#4f9cf9", "#f5c518"];

/** Tracks the OS color scheme so the Markdown renderer picks the right theme. */
function useColorMode(): "light" | "dark" {
  const [mode, setMode] = useState<"light" | "dark">(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) =>
      setMode(e.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return mode;
}

function HistoryBase({ notes, onDelete, onEdit, onColor }: Props) {
  const { t } = useTranslation();
  const colorMode = useColorMode();
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the newest note (at the bottom) in view as the list changes: on load,
  // when switching projects, and when a note is added.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [notes]);

  if (notes.length === 0) {
    return <div className="history-empty">{t("editor.emptyHistory")}</div>;
  }
  return (
    <ul className="history" ref={listRef}>
      {notes.map((note) => (
        <HistoryItem
          key={note.id}
          note={note}
          colorMode={colorMode}
          onDelete={onDelete}
          onEdit={onEdit}
          onColor={onColor}
        />
      ))}
    </ul>
  );
}

interface ItemProps {
  note: Note;
  colorMode: "light" | "dark";
  onDelete: (id: number) => void;
  onEdit: (id: number, contentMd: string) => void;
  onColor: (id: number, color: string | null) => void;
}

/** A single note: timestamp, color picker, edit/delete, rendered content. */
function HistoryItem({
  note,
  colorMode,
  onDelete,
  onEdit,
  onColor,
}: ItemProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content_md);

  const submit = () => {
    onEdit(note.id, draft);
    setEditing(false);
  };

  return (
    <li
      className="history-item"
      style={
        note.color
          ? {
              backgroundImage: `linear-gradient(${note.color}26, ${note.color}26)`,
            }
          : undefined
      }
    >
      <div className="history-meta">
        <time>{note.created_at}</time>
        <span className="history-tools">
          <ColorPicker
            value={note.color}
            onChange={(color) => onColor(note.id, color)}
          />
          <button
            type="button"
            className="ghost mini"
            aria-label={t("editor.edit")}
            title={t("editor.edit")}
            onClick={() => {
              setDraft(note.content_md);
              setEditing(true);
            }}
          >
            ✎
          </button>
          <button
            type="button"
            className="ghost mini danger"
            onClick={() => onDelete(note.id)}
            aria-label="delete"
          >
            ✕
          </button>
        </span>
      </div>
      {editing ? (
        <div className="history-editing">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.ctrlKey &&
                !e.metaKey
              ) {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <div className="history-editing-actions">
            <button type="button" className="primary mini" onClick={submit}>
              {t("editor.save")}
            </button>
            <button
              type="button"
              className="ghost mini"
              onClick={() => setEditing(false)}
            >
              {t("editor.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <>
          {note.content_md.trim() && (
            <div className="history-content" data-color-mode={colorMode}>
              <MDEditor.Markdown source={note.content_md} />
            </div>
          )}
          {note.attachments.length > 0 && (
            <div className="history-attachments">
              {note.attachments.map((a) => (
                <AttachmentView key={a.id} attachment={a} />
              ))}
            </div>
          )}
        </>
      )}
    </li>
  );
}

interface ColorPickerProps {
  value: string | null;
  onChange: (color: string | null) => void;
}

/** Preset swatches + custom color input; the translucent tint adapts to any theme. */
function ColorPicker({ value, onChange }: ColorPickerProps) {
  const { t } = useTranslation();
  const isCustom = value !== null && !NOTE_COLORS.includes(value);
  return (
    <span className="color-picker" title={t("editor.color")}>
      {NOTE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={"swatch" + (value === c ? " selected" : "")}
          style={{ background: c }}
          aria-label={t("editor.color")}
          onClick={() => onChange(value === c ? null : c)}
        />
      ))}
      <label
        className={"swatch custom" + (isCustom ? " selected" : "")}
        style={isCustom ? { background: value ?? undefined } : undefined}
      >
        <input
          type="color"
          value={value ?? "#4f9cf9"}
          onChange={(e) => onChange(e.target.value)}
        />
        {isCustom ? "" : "+"}
      </label>
    </span>
  );
}

const History = memo(HistoryBase);
export default History;
