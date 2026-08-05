// Project switcher (named chats): click to switch, create/rename/delete.
// Active project is highlighted.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Project } from "../lib/types";

interface Props {
  projects: Project[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onCreate: (name: string) => void;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
}

export default function ProjectSwitcher({
  projects,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const submit = () => {
    const name = draft.trim();
    if (name) onCreate(name);
    setDraft("");
    setAdding(false);
  };

  return (
    <div className="switcher">
      <div className="switcher-head">
        <span>{t("projects.title")}</span>
        <button type="button" className="ghost" onClick={() => setAdding((a) => !a)}>
          ＋
        </button>
      </div>
      {adding && (
        <div className="switcher-add">
          <input
            autoFocus
            value={draft}
            placeholder={t("projects.namePrompt")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setAdding(false);
            }}
          />
          <button type="button" className="primary" onClick={submit}>
            ✓
          </button>
        </div>
      )}
      <ul className="switcher-list">
        {projects.map((p) => (
          <li
            key={p.id}
            className={p.id === activeId ? "active" : undefined}
            onClick={() => onSelect(p.id)}
          >
            <ProjectName
              project={p}
              onRename={onRename}
              onDelete={onDelete}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

interface NameProps {
  project: Project;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
}

function ProjectName({ project, onRename, onDelete }: NameProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);

  if (editing) {
    return (
      <span className="row">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onRename(project.id, draft);
              setEditing(false);
            }
            if (e.key === "Escape") setEditing(false);
          }}
        />
      </span>
    );
  }

  return (
    <span className="row">
      <span className="name">{project.name}</span>
      <span className="actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="ghost mini"
          aria-label={t("projects.rename")}
          onClick={() => {
            setDraft(project.name);
            setEditing(true);
          }}
        >
          ✎
        </button>
        <button
          type="button"
          className="ghost mini danger"
          aria-label={t("projects.delete")}
          onClick={() => {
            if (confirm(t("projects.confirmDelete"))) onDelete(project.id);
          }}
        >
          ✕
        </button>
      </span>
    </span>
  );
}
