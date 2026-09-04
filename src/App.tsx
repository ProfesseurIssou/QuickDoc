// QuickDoc main app: panel window with project switcher, editor, history, and
// settings. Listens to global shortcuts (toggle, cycle projects, select N) and
// tray-driven navigation.

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import NoteEditor from "./components/NoteEditor";
import History from "./components/History";
import ProjectSwitcher from "./components/ProjectSwitcher";
import Settings from "./pages/Settings";
import {
  createProject as dbCreateProject,
  deleteNote as dbDeleteNote,
  deleteProject as dbDeleteProject,
  getSetting,
  listNotes,
  listProjects,
  renameProject as dbRenameProject,
  seedDefaults,
  setNoteColor,
  setSetting,
  updateNote as dbUpdateNote,
} from "./lib/db";
import { initKeybindings, onAction } from "./lib/keybindings";
import { DEFAULT_LOCALE, Note, Project } from "./lib/types";
import { exportProjectHtml, exportProjectMarkdown } from "./lib/export";
import {
  downloadAndInstall,
  getAvailableUpdate,
  initUpdateCheck,
} from "./lib/updater";
import type { Update } from "@tauri-apps/plugin-updater";
import "./i18n";

type View = "main" | "settings";

export default function App() {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<View>("main");
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string>("");
  const [update, setUpdate] = useState<Update | null>(null);
  const [updating, setUpdating] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2500);
  }, []);

  // ---- data loading --------------------------------------------------------
  const reloadProjects = useCallback(async () => {
    const list = await listProjects();
    setProjects(list);
    return list;
  }, []);

  const reloadNotes = useCallback(async (projectId: number) => {
    setNotes(await listNotes(projectId));
  }, []);

  const selectProject = useCallback(
    async (id: number) => {
      setActiveId(id);
      await setSetting("active_project_id", String(id));
      await reloadNotes(id);
    },
    [reloadNotes],
  );

  // ---- boot ----------------------------------------------------------------
  useEffect(() => {
    void (async () => {
      await seedDefaults();

      // Apply saved locale before paint.
      const locale = (await getSetting("locale")) ?? DEFAULT_LOCALE;
      await i18n.changeLanguage(locale);

      // Register global shortcuts.
      await initKeybindings();

      const list = await reloadProjects();
      const savedActive = await getSetting("active_project_id");
      const initial = list.find((p) => p.id === Number(savedActive)) ?? list[0];
      if (initial) await selectProject(initial.id);

      // Background update check: only reveals the header Update button —
      // nothing is downloaded until the user clicks it.
      await initUpdateCheck(() => {
        setUpdate(getAvailableUpdate());
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- global shortcut + tray events --------------------------------------
  useEffect(() => {
    const unlistenAction = onAction((action) => {
      void handleAction(action);
    });
    const unlistenRust = listen<string>("quickdoc://shortcut", (e) => {
      void handleAction(e.payload);
    });
    const unlistenNav = listen<string>("quickdoc://navigate", (e) => {
      if (e.payload === "settings") setView("settings");
    });
    const unlistenFocus = listen("quickdoc://focus-input", () => {
      focusEditor();
    });
    // Tray Quit: quit directly (updates are user-triggered from the header).
    const unlistenQuit = listen("quickdoc://quit", () => {
      void invoke("quit_app");
    });
    return () => {
      void unlistenAction.then((fn) => fn());
      void unlistenRust.then((fn) => fn());
      void unlistenNav.then((fn) => fn());
      void unlistenFocus.then((fn) => fn());
      void unlistenQuit.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, activeId]);

  const handleAction = useCallback(
    async (action: string) => {
      if (action === "toggle_panel") {
        await invoke("toggle_panel");
        return;
      }
      // Project shortcuts only make sense while the list is loaded.
      if (projects.length === 0) return;
      if (action === "cycle_projects") {
        const idx = projects.findIndex((p) => p.id === activeId);
        const next = projects[(idx + 1 + projects.length) % projects.length];
        // Reveal the panel so the switch is visible even when it was hidden.
        await invoke("show_panel");
        await selectProject(next.id);
        return;
      }
      const m = action.match(/^select_project_(\d+)$/);
      if (m) {
        const n = Number(m[1]) - 1;
        const target = projects[n];
        if (target) {
          await invoke("show_panel");
          await selectProject(target.id);
        }
      }
    },
    [projects, activeId, selectProject],
  );

  // ---- editor / project handlers ------------------------------------------
  const onNoteSaved = useCallback((note: Note) => {
    setNotes((prev) => [...prev, note]);
  }, []);

  const onEditNote = useCallback(async (id: number, contentMd: string) => {
    const text = contentMd.trim();
    if (!text) return;
    await dbUpdateNote(id, contentMd);
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, content_md: contentMd } : n)),
    );
  }, []);

  const onNoteColor = useCallback(async (id: number, color: string | null) => {
    await setNoteColor(id, color);
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, color } : n)));
  }, []);

  const onDeleteNote = useCallback(async (id: number) => {
    await dbDeleteNote(id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const onCreateProject = useCallback(
    async (name: string) => {
      const id = await dbCreateProject(name);
      await reloadProjects();
      await selectProject(id);
    },
    [reloadProjects, selectProject],
  );

  const onRenameProject = useCallback(
    async (id: number, name: string) => {
      await dbRenameProject(id, name);
      await reloadProjects();
    },
    [reloadProjects],
  );

  const onDeleteProject = useCallback(
    async (id: number) => {
      await dbDeleteProject(id);
      const list = await reloadProjects();
      if (activeId === id) {
        await selectProject(list[0]?.id ?? 0);
      }
    },
    [reloadProjects, selectProject, activeId],
  );

  // ---- update ---------------------------------------------------------------
  const onUpdate = useCallback(async () => {
    const current = update ?? getAvailableUpdate();
    if (!current || updating) return;
    setUpdating(true);
    showToast(t("updater.downloading"));
    const started = await downloadAndInstall(current);
    // On Windows the process exits inside install(); if we get here the
    // install failed — clear the button so the user can retry later.
    if (!started) {
      setUpdating(false);
      setUpdate(null);
      showToast(t("updater.failed"));
    }
  }, [update, updating, showToast, t]);

  // ---- export --------------------------------------------------------------
  const onExport = useCallback(
    async (kind: "md" | "html") => {
      if (!activeId) return;
      const project = projects.find((p) => p.id === activeId);
      if (!project) return;
      try {
        const dest =
          kind === "md"
            ? await exportProjectMarkdown(project.name, project.id)
            : await exportProjectHtml(project.name, project.id);
        if (dest) showToast(t("export.saved", { path: dest }));
      } catch {
        showToast(t("export.failed"));
      }
    },
    [activeId, projects, showToast, t],
  );

  const onPanelSideChange = useCallback(async (side: "left" | "right") => {
    await invoke("dock_window", { side });
  }, []);

  const onLocaleChange = useCallback(() => {
    // Language already switched in Settings; nothing else to do.
  }, []);

  // Open http(s) links (e.g. in rendered notes) in the default browser
  // instead of navigating the panel webview.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (/^https?:\/\//i.test(href)) {
        e.preventDefault();
        void openUrl(href);
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Esc hides the panel (when not typing in an input); Ctrl+K focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.key === "Escape" && view === "main") {
        const el = document.activeElement;
        const tag = el?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        void invoke("hide_panel");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  // Notes of the current project matching the search query (case-insensitive).
  const filteredNotes = query.trim()
    ? notes.filter((n) =>
        n.content_md.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : notes;

  // Focus the editor when the panel becomes visible.
  const focusEditor = () => {
    const ta = document.querySelector<HTMLTextAreaElement>(".editor textarea");
    ta?.focus();
  };

  return (
    <div className="app">
      <header className="app-header" data-tauri-drag-region>
        <span className="brand">📝 {t("app.name")}</span>
        <span className="spacer" />
        {update && (
          <button
            type="button"
            className="success mini"
            onClick={() => void onUpdate()}
            disabled={updating}
            title={t("updater.title", { version: update.version })}
          >
            {updating ? "…" : `↑ ${update.version}`}
          </button>
        )}
        <button
          type="button"
          className="ghost"
          onClick={() => onExport("md")}
          title={t("export.markdown")}
        >
          ⤓ .md
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => onExport("html")}
          title={t("export.html")}
        >
          ⤓ .html
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => setView(view === "settings" ? "main" : "settings")}
          title={t("settings.title")}
        >
          ⚙
        </button>
      </header>

      {view === "settings" ? (
        <Settings
          onBack={() => setView("main")}
          onPanelSideChange={onPanelSideChange}
          onLocaleChange={onLocaleChange}
        />
      ) : (
        <main className="app-main">
          <ProjectSwitcher
            projects={projects}
            activeId={activeId}
            onSelect={(id) => void selectProject(id)}
            onCreate={onCreateProject}
            onRename={onRenameProject}
            onDelete={onDeleteProject}
          />
          {activeId !== null && (
            <div className="search-bar">
              <input
                ref={searchRef}
                type="text"
                value={query}
                placeholder={t("search.placeholder")}
                aria-label={t("search.placeholder")}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Esc clears first; a second Esc falls through to hiding
                  // the panel (the field must be blurred for that).
                  if (e.key === "Escape") {
                    if (query) setQuery("");
                    else e.currentTarget.blur();
                  }
                }}
              />
              {query.trim() && (
                <span className="search-count">
                  {filteredNotes.length}/{notes.length}
                </span>
              )}
            </div>
          )}
          <History
            notes={filteredNotes}
            onDelete={(id) => void onDeleteNote(id)}
            onEdit={(id, content) => void onEditNote(id, content)}
            onColor={(id, color) => void onNoteColor(id, color)}
          />
          {activeId !== null && (
            <NoteEditor projectId={activeId} onSaved={onNoteSaved} />
          )}
        </main>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
