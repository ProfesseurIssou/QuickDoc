//! Attachments: stable on-disk storage of media files (images today, video later).
//!
//! Files live under the app data dir in an `attachments/` subfolder, named by a
//! short random id + the original extension. The `kind` field (stored in the DB
//! by the frontend) is a generic enum so new media types need no schema change.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

/// The kinds of attachment the app understands. Video is reserved so the data
/// path is exercised even before capture is implemented in v1.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AttachmentKind {
    Image,
    Video,
}

impl AttachmentKind {
    pub fn parse(s: &str) -> Self {
        if s.eq_ignore_ascii_case("video") {
            AttachmentKind::Video
        } else {
            AttachmentKind::Image
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            AttachmentKind::Image => "image",
            AttachmentKind::Video => "video",
        }
    }
}

/// Guess the kind from a MIME type, defaulting to image.
pub fn kind_from_mime(mime: &str) -> AttachmentKind {
    if mime.starts_with("video/") {
        AttachmentKind::Video
    } else {
        AttachmentKind::Image
    }
}

/// Map common MIME types to a file extension.
pub fn extension_for_mime(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        _ => "bin",
    }
}

/// Resolve the attachments directory for this app, creating it if missing.
pub fn attachments_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    let dir = base.join("attachments");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Result of persisting raw attachment bytes: enough for the frontend to insert
/// a row into the `attachments` table.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ExportSaveResult {
    pub kind: String,
    pub mime: String,
    pub file_name: String,
}

/// A future-proof filename for an attachment: `<uuid>.<ext>` (stable, no path
/// traversal, no user-controlled characters).
pub fn stable_name(mime: &str) -> String {
    format!("{}.{}", Uuid::new_v4(), extension_for_mime(mime))
}

/// True when `name` is a bare filename (no separators, no parent refs).
pub fn is_safe_name(name: &str) -> bool {
    Path::new(name)
        .components()
        .all(|c| matches!(c, std::path::Component::Normal(_)))
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_from_mime_classification() {
        assert_eq!(kind_from_mime("image/png"), AttachmentKind::Image);
        assert_eq!(kind_from_mime("video/mp4"), AttachmentKind::Video);
        assert_eq!(
            kind_from_mime("application/octet-stream"),
            AttachmentKind::Image
        );
    }

    #[test]
    fn extension_for_common_types() {
        assert_eq!(extension_for_mime("image/png"), "png");
        assert_eq!(extension_for_mime("image/jpeg"), "jpg");
        assert_eq!(extension_for_mime("video/mp4"), "mp4");
        assert_eq!(extension_for_mime("weird/unknown"), "bin");
    }

    #[test]
    fn stable_name_has_extension() {
        let n = stable_name("image/png");
        assert!(n.ends_with(".png"));
        assert_eq!(n.matches('.').count(), 1); // uuid has no dots
    }

    #[test]
    fn safe_name_rejects_traversal() {
        assert!(is_safe_name("abc.png"));
        assert!(!is_safe_name("../abc.png"));
        assert!(!is_safe_name("a/b.png"));
        assert!(!is_safe_name("..\\a.png"));
    }

    #[test]
    fn kind_roundtrip() {
        for k in [AttachmentKind::Image, AttachmentKind::Video] {
            assert_eq!(AttachmentKind::parse(k.as_str()), k);
        }
    }
}
