// Update handling: check GitHub Releases in the background (on startup, then
// every 12h) but never download silently — when a new version is available the
// UI shows a green "Update" button and the user decides. On Windows,
// Update.install() terminates the process and runs the NSIS installer right
// after.

import { check, Update } from "@tauri-apps/plugin-updater";

const RECHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

// Module-scoped: the Update object is a native resource that must survive
// between the check and the user-triggered download + install.
let available: Update | null = null;

/** Currently available update, if any (drives the header Update button). */
export function getAvailableUpdate(): Update | null {
  return available;
}

/**
 * Start background update checks. `onAvailable` fires when a new version
 * appears (e.g. to reveal the Update button). All failures are swallowed: an
 * update check must never disturb the note flow.
 */
export async function initUpdateCheck(onAvailable: () => void): Promise<void> {
  const run = async () => {
    try {
      if (!available) {
        const update = await check();
        if (update) {
          available = update;
          onAvailable();
        }
      }
    } catch {
      // Offline / rate-limited — retry on next tick.
    }
  };
  await run();
  // Re-check periodically: the panel can stay resident for days.
  window.setInterval(() => void run(), RECHECK_INTERVAL_MS);
}

/**
 * Download and install the available update, triggered by the user. On
 * Windows the process exits inside install() and the installer runs right
 * after.
 */
export async function downloadAndInstall(update: Update): Promise<boolean> {
  try {
    await update.downloadAndInstall();
    return true;
  } catch {
    available = null;
    return false;
  }
}
