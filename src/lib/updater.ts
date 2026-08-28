// Auto-update: check GitHub Releases in the background (on startup, then every
// 12h), download the installer quietly, and hold it until the app quits. The
// install itself is triggered from the quit path (tray Quit) — on Windows,
// Update.install() terminates the process and runs the NSIS installer right
// after, which is exactly the "update on close" behavior.

import { check, Update } from "@tauri-apps/plugin-updater";
import { getSetting } from "./db";

const RECHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

// Module-scoped: the downloaded Update object is a native resource that must
// survive between the download and the quit-time install.
let pending: Update | null = null;

/**
 * Start background update checks if the auto_update setting is enabled.
 * `onReady` fires once per downloaded update (e.g. to show a toast). All
 * failures are swallowed: an update must never disturb the note flow.
 */
export async function initAutoUpdate(onReady: () => void): Promise<void> {
  if ((await getSetting("auto_update")) === "false") return;
  await checkAndDownload(onReady);
  // Re-check periodically: the panel can stay resident for days.
  window.setInterval(() => void checkAndDownload(onReady), RECHECK_INTERVAL_MS);
}

async function checkAndDownload(onReady: () => void): Promise<void> {
  try {
    const update = await check();
    if (!update || pending) return;
    await update.download();
    pending = update;
    onReady();
  } catch {
    // Offline / rate-limited / no signed release yet — retry on next tick.
  }
}

/**
 * Install the pending update (called from the quit path). Returns true when an
 * install was started; note that on Windows the process exits inside install()
 * and the promise never resolves, so this "return true" is best-effort. The
 * installer runs passively after exit and does not relaunch the app.
 */
export async function installPendingUpdate(): Promise<boolean> {
  if (!pending) return false;
  try {
    await pending.install();
    return true;
  } catch {
    pending = null;
    return false;
  }
}
