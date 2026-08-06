//! Window management: dock a frameless panel to the left or right edge of the
//! primary monitor and toggle its visibility.

use tauri::{AppHandle, LogicalSize, Manager, Monitor, PhysicalPosition, WebviewWindow};

pub const PANEL_WIDTH: f64 = 400.0;

/// Which screen edge the panel docks to. Persisted in settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PanelSide {
    Left,
    Right,
}

impl Default for PanelSide {
    fn default() -> Self {
        PanelSide::Right
    }
}

impl PanelSide {
    pub fn parse(value: &str) -> Self {
        if value.eq_ignore_ascii_case("left") {
            PanelSide::Left
        } else {
            PanelSide::Right
        }
    }
}

/// The pure arithmetic behind edge docking. Given the monitor geometry (all in
/// physical pixels) and the panel width in logical pixels, returns the panel's
/// top-left physical coordinate. Splitting this out keeps it unit-testable
/// without a live display.
pub fn dock_position(
    mon_x: i32,
    mon_y: i32,
    mon_width: i32,
    _mon_height: i32,
    scale: f64,
    side: PanelSide,
    panel_width_logical: f64,
) -> (i32, i32) {
    let panel_width_phys = (panel_width_logical * scale).round() as i32;
    let x = match side {
        PanelSide::Left => mon_x,
        PanelSide::Right => mon_x + mon_width - panel_width_phys,
    };
    (x, mon_y)
}

/// Resize the panel to full height of the given monitor and dock it to `side`.
pub fn dock_to_edge(window: &WebviewWindow, monitor: &Monitor, side: PanelSide) -> tauri::Result<()> {
    let scale = monitor.scale_factor();
    let mon_size = monitor.size();
    let mon_pos = monitor.position();
    let height = (mon_size.height as f64) / scale;
    let (x, y) = dock_position(
        mon_pos.x,
        mon_pos.y,
        mon_size.width as i32,
        mon_size.height as i32,
        scale,
        side,
        PANEL_WIDTH,
    );
    window.set_size(LogicalSize::new(PANEL_WIDTH, height))?;
    window.set_position(PhysicalPosition::new(x, y))?;
    Ok(())
}

/// Convenience: dock the main window using its current monitor.
pub fn dock_primary(app: &AppHandle, side: PanelSide) -> tauri::Result<()> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| tauri::Error::AssetNotFound("main window".into()))?;
    if let Some(monitor) = window.current_monitor()? {
        dock_to_edge(&window, &monitor, side)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dock_position_left_side() {
        let (x, y) = dock_position(0, 0, 1920, 1080, 1.0, PanelSide::Left, 400.0);
        assert_eq!((x, y), (0, 0));
    }

    #[test]
    fn dock_position_right_side() {
        let (x, y) = dock_position(0, 0, 1920, 1080, 1.0, PanelSide::Right, 400.0);
        assert_eq!((x, y), (1920 - 400, 0));
    }

    #[test]
    fn dock_position_with_scale() {
        let (x, y) = dock_position(0, 0, 1920, 1080, 2.0, PanelSide::Right, 400.0);
        // 400 logical * 2.0 scale = 800 physical wide.
        assert_eq!((x, y), (1920 - 800, 0));
    }

    #[test]
    fn dock_position_uses_monitor_origin() {
        // Secondary monitor offset at (1920, 0).
        let (x, y) = dock_position(1920, 0, 2560, 1440, 1.0, PanelSide::Right, 400.0);
        assert_eq!((x, y), (1920 + 2560 - 400, 0));
    }

    #[test]
    fn panel_side_parse() {
        assert_eq!(PanelSide::parse("left"), PanelSide::Left);
        assert_eq!(PanelSide::parse("RIGHT"), PanelSide::Right);
        assert_eq!(PanelSide::parse("garbage"), PanelSide::Right);
    }
}
