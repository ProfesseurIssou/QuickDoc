// History list for the current project: newest first, Markdown rendered, image
// thumbnails via AttachmentView. Notes can be deleted.

import { memo } from "react";
import MDEditor from "@uiw/react-md-editor";
import { useTranslation } from "react-i18next";
import AttachmentView from "./AttachmentView";
import { Note } from "../lib/types";

interface Props {
  notes: Note[];
  onDelete: (id: number) => void;
}

function HistoryBase({ notes, onDelete }: Props) {
  const { t } = useTranslation();
  if (notes.length === 0) {
    return <div className="history-empty">{t("editor.emptyHistory")}</div>;
  }
  return (
    <ul className="history">
      {notes.map((note) => (
        <li key={note.id} className="history-item">
          <div className="history-meta">
            <time>{note.created_at}</time>
            <button
              type="button"
              className="ghost danger"
              onClick={() => onDelete(note.id)}
              aria-label="delete"
            >
              ✕
            </button>
          </div>
          {note.content_md.trim() && (
            <div className="history-content" data-color-mode="light">
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
        </li>
      ))}
    </ul>
  );
}

const History = memo(HistoryBase);
export default History;
