# QuickDoc

A zero-friction, instant note-taking utility that lives in your system tray.

Press a global hotkey (`Ctrl+Alt+Space` by default) and a dockable side panel
slides in at the screen edge — jot a note, paste a screenshot, and get back to
work. Notes are organized into projects and can be exported to Markdown or a
self-contained HTML file.

## Features

- **System-tray resident** — no window clutter; open the panel via global shortcut.
- **Dockable side panel** — left or right edge, configurable.
- **Markdown editing** — save with `Ctrl+Enter`, full history per project.
- **Attachments** — paste clipboard images directly, or import image files.
- **Projects** — separate notespaces (Inbox + custom projects); switch via shortcuts.
- **Export** — per-project Markdown (with relative image links) or a single
  self-contained HTML file (images embedded as data URIs).
- **Global shortcuts** — toggle the panel, cycle/select projects, save a note.
  Every binding is user-editable in Settings.
- **Launch at startup** — opt-in via the Settings page.
- **i18n** — English and French out of the box.

## Tech stack

- **Backend:** Rust + [Tauri 2](https://tauri.app/) (SQLite via `tauri-plugin-sql`,
  global shortcuts, clipboard, dialog, fs, autostart).
- **Frontend:** React 19 + TypeScript, Vite, [`@uiw/react-md-editor`](https://github.com/uiwjs/react-md-editor),
  [`react-i18next`](https://react.i18next.com/).

## Getting started

### Prerequisites

- Node.js 22+
- Rust (stable) + Cargo
- Tauri 2 system dependencies — see the
  [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/).

### Install & run (dev)

```bash
npm install
npm run tauri dev
```

### Build a production bundle

```bash
npm run tauri build
```

Installers / bundle artifacts are written to `src-tauri/target/release/bundle/`.

## Architecture

- `src/` — React frontend (components, pages, `lib/` data + helper modules, i18n).
- `src-tauri/src/` — Rust backend:
  - `lib.rs` — app entry, tray, commands, global hotkey.
  - `window.rs` — edge-docking arithmetic (pure, unit-tested).
  - `keybinding.rs` — friendly-string → accelerator resolution (tested).
  - `attachments.rs` — safe filenames + MIME kinds (tested).
  - `export.rs` — Markdown + HTML rendering (tested).
  - `settings.rs` — default settings contract.
- `src-tauri/migrations/001_init.sql` — schema (projects, notes, attachments, settings).

Settings live in SQLite and are owned by the frontend; the Rust side receives
values it needs (e.g. the panel side) as command arguments.

## Testing

```bash
# Frontend (Vitest)
npm test

# Backend (cargo test)
cd src-tauri && cargo test
```

## License

MIT
