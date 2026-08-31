// QuickDoc main app: panel window with project switcher, editor, history, and
// settings. Listens to global shortcuts (toggle, cycle projects, select N) and
// tray-driven navigation.

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
import { initAutoUpdate, installPendingUpdate } from "./lib/updater";
import "./i18n";

type View = "main" | "settings";

export default function App() {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<View>("main");
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [toast, setToast] = useState<string>("");
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

      // Background update check: download now, install on quit.
      await initAutoUpdate(() => showToast(t("updater.ready")));
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
    // Tray Quit: install the downloaded update (this exits the process), or
    // quit directly when there is nothing to install.
    const unlistenQuit = listen("quickdoc://quit", () => {
      void (async () => {
        if (!(await installPendingUpdate())) {
          await invoke("quit_app");
        }
      })();
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

  // Esc hides the panel (when not typing in an input).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
          <History
            notes={notes}
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
