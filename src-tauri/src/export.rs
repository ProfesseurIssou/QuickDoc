//! Export a project's history to Markdown or a self-contained HTML file.
//!
//! These functions are pure (they take already-loaded data) so the Markdown
//! rendering can be unit-tested without touching the filesystem or the DB.

#![allow(dead_code)]

use crate::attachments::AttachmentKind;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// One row of the `attachments` table as far as export cares.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExportAttachment {
    pub kind: String,
    pub mime: String,
    pub file_name: String,
}

/// One note plus its attachments, ready to render.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExportNote {
    pub content_md: String,
    pub created_at: String,
    pub attachments: Vec<ExportAttachment>,
}

/// A whole project ready for export.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportProject {
    pub name: String,
    pub notes: Vec<ExportNote>,
}

/// Build the attachment markdown for a single image: `![image](assets/<name>)`.
/// Video links are rendered as a placeholder line (capture not in v1).
pub fn attachment_md(att: &ExportAttachment) -> String {
    match AttachmentKind::parse(&att.kind) {
        AttachmentKind::Image => format!("![image](assets/{})", att.file_name),
        AttachmentKind::Video => format!("<!-- video: {} (coming soon) -->", att.file_name),
    }
}

/// Render a full project to a Markdown string.
pub fn to_markdown(project: &ExportProject) -> String {
    let mut out = String::new();
    out.push_str(&format!("# {}\n\n", escape(&project.name)));
    if project.notes.is_empty() {
        out.push_str("_No notes yet._\n");
        return out;
    }
    for note in &project.notes {
        out.push_str(&format!("## {}\n\n", note.created_at));
        let body = note.content_md.trim();
        if !body.is_empty() {
            out.push_str(body);
            out.push_str("\n\n");
        }
        for att in &note.attachments {
            out.push_str(&attachment_md(att));
            out.push('\n');
        }
        out.push('\n');
    }
    out
}

/// The list of attachment file names referenced by the export (used to copy the
/// assets folder alongside the .md).
pub fn referenced_assets(project: &ExportProject) -> Vec<String> {
    let mut seen = std::collections::BTreeSet::new();
    let mut out = Vec::new();
    for note in &project.notes {
        for att in &note.attachments {
            if AttachmentKind::parse(&att.kind) == AttachmentKind::Image && seen.insert(att.file_name.clone()) {
                out.push(att.file_name.clone());
            }
        }
    }
    out
}

/// Render a project to a single self-contained HTML string. Images are embedded
/// as data URIs (`base64:<bytes>`), keyed by file name. Video shows a placeholder.
pub fn to_html(
    project: &ExportProject,
    title: &str,
    assets_base64: &BTreeMap<String, String>,
) -> String {
    let mut body = String::new();
    for note in &project.notes {
        body.push_str("<section class=\"note\">\n");
        body.push_str(&format!("  <time>{}</time>\n", escape(&note.created_at)));
        let md = render_minimal_markdown(note.content_md.trim());
        if !md.is_empty() {
            body.push_str(&format!("  <div class=\"content\">{}</div>\n", md));
        }
        for att in &note.attachments {
            match AttachmentKind::parse(&att.kind) {
                AttachmentKind::Image => {
                    let src = assets_base64
                        .get(&att.file_name)
                        .map(|b| format!("data:{};base64,{}", att.mime, b))
                        .unwrap_or_else(|| "about:blank".to_string());
                    body.push_str(&format!("  <img src=\"{}\" alt=\"image\" />\n", src));
                }
                AttachmentKind::Video => {
                    body.push_str("  <p class=\"video-placeholder\">[video: coming soon]</p>\n");
                }
            }
        }
        body.push_str("</section>\n");
    }
    if body.is_empty() {
        body.push_str("<p><em>No notes yet.</em></p>\n");
    }
    format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\" />\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n\
         <title>{title}</title>\n<style>{style}</style>\n</head>\n<body>\n\
         <main>\n<h1>{name}</h1>\n{body}</main>\n</body>\n</html>\n",
        title = escape(title),
        style = HTML_STYLE,
        name = escape(&project.name),
        body = body,
    )
}

/// A deliberately tiny Markdown subset (paragraphs, headings, bold, italic,
/// inline code, unordered lists). Good enough for plain note export and fully
/// testable; the on-screen editor uses a richer renderer.
pub fn render_minimal_markdown(input: &str) -> String {
    let mut out = String::new();
    let mut in_list = false;
    let flush_list = |out: &mut String, in_list: &mut bool| {
        if *in_list {
            out.push_str("</ul>");
            *in_list = false;
        }
    };
    for line in input.lines() {
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            // Blank lines end any active list.
            flush_list(&mut out, &mut in_list);
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("### ") {
            flush_list(&mut out, &mut in_list);
            out.push_str(&format!("<h3>{}</h3>", inline(rest)));
        } else if let Some(rest) = trimmed.strip_prefix("## ") {
            flush_list(&mut out, &mut in_list);
            out.push_str(&format!("<h2>{}</h2>", inline(rest)));
        } else if let Some(rest) = trimmed.strip_prefix("# ") {
            flush_list(&mut out, &mut in_list);
            out.push_str(&format!("<h1>{}</h1>", inline(rest)));
        } else if let Some(rest) = trimmed.strip_prefix("- ") {
            if !in_list {
                out.push_str("<ul>");
                in_list = true;
            }
            out.push_str(&format!("<li>{}</li>", inline(rest)));
        } else {
            flush_list(&mut out, &mut in_list);
            out.push_str(&format!("<p>{}</p>", inline(trimmed)));
        }
    }
    flush_list(&mut out, &mut in_list);
    out
}

fn inline(input: &str) -> String {
    // Order matters: handle code spans first so we don't reprocess their insides.
    let mut s = escape(input);
    // Inline code `...`
    s = replace_balanced(&s, '`', "<code>", "</code>");
    // Bold **...**
    s = replace_pair(&s, "**", "<strong>", "</strong>");
    // Italic *...*
    s = replace_pair(&s, "*", "<em>", "</em>");
    s
}

/// Replace alternating occurrences of a single delimiter with open/close tags.
fn replace_balanced(s: &str, delim: char, open: &str, close: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut open_next = true;
    for ch in s.chars() {
        if ch == delim {
            out.push_str(if open_next { open } else { close });
            open_next = !open_next;
        } else {
            out.push(ch);
        }
    }
    out
}

/// Replace alternating occurrences of a multi-char delimiter.
fn replace_pair(s: &str, delim: &str, open: &str, close: &str) -> String {
    let parts: Vec<&str> = s.split(delim).collect();
    if parts.len() <= 1 {
        return s.to_string();
    }
    let mut out = String::new();
    for (i, p) in parts.iter().enumerate() {
        if i > 0 {
            out.push_str(if i % 2 == 1 { open } else { close });
        }
        out.push_str(p);
    }
    out
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

const HTML_STYLE: &str = r#"
:root { color-scheme: light dark; }
body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
       max-width: 760px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
h1 { border-bottom: 1px solid #8884; padding-bottom: .3rem; }
section.note { margin: 1.5rem 0; padding: .75rem 0; border-top: 1px solid #8884; }
time { color: #888; font-size: .85rem; }
.content { margin: .5rem 0; }
img { max-width: 100%; height: auto; border-radius: 6px; margin: .25rem 0; }
.video-placeholder { color: #888; font-style: italic; }
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn att(kind: &str, mime: &str, file_name: &str) -> ExportAttachment {
        ExportAttachment {
            kind: kind.to_string(),
            mime: mime.to_string(),
            file_name: file_name.to_string(),
        }
    }

    fn sample() -> ExportProject {
        ExportProject {
            name: "Inbox".to_string(),
            notes: vec![ExportNote {
                content_md: "Hello **world** and `code`".to_string(),
                created_at: "2024-01-01 12:00".to_string(),
                attachments: vec![
                    att("image", "image/png", "a.png"),
                    att("video", "video/mp4", "v.mp4"),
                ],
            }],
        }
    }

    #[test]
    fn markdown_includes_title_and_attachments() {
        let md = to_markdown(&sample());
        assert!(md.contains("# Inbox"));
        assert!(md.contains("![image](assets/a.png)"));
        assert!(md.contains("<!-- video: v.mp4 (coming soon) -->"));
    }

    #[test]
    fn referenced_assets_drops_videos_and_duplicates() {
        let project = ExportProject {
            name: "X".to_string(),
            notes: vec![ExportNote {
                content_md: "".into(),
                created_at: "t".into(),
                attachments: vec![
                    att("image", "image/png", "a.png"),
                    att("image", "image/png", "a.png"),
                    att("video", "video/mp4", "v.mp4"),
                ],
            }],
        };
        assert_eq!(referenced_assets(&project), vec!["a.png".to_string()]);
    }

    #[test]
    fn minimal_markdown_renders_headings_and_lists() {
        let html = render_minimal_markdown("# Title\n- one\n- two\nplain");
        assert!(html.contains("<h1>Title</h1>"));
        assert!(html.contains("<ul><li>one</li><li>two</li></ul>"));
        assert!(html.contains("<p>plain</p>"));
    }

    #[test]
    fn minimal_markdown_renders_inline() {
        let html = render_minimal_markdown("**b** *i* `c`");
        assert!(html.contains("<strong>b</strong>"));
        assert!(html.contains("<em>i</em>"));
        assert!(html.contains("<code>c</code>"));
    }

    #[test]
    fn html_escapes_name_and_embeds_image() {
        let mut assets = BTreeMap::new();
        assets.insert("a.png".to_string(), "BASE64BYTES".to_string());
        let html = to_html(&sample(), "Inbox", &assets);
        assert!(html.contains("<h1>Inbox</h1>"));
        assert!(html.contains("data:image/png;base64,BASE64BYTES"));
        assert!(html.contains("video-placeholder"));
    }

    #[test]
    fn html_escapes_unsafe_input() {
        let project = ExportProject {
            name: "<b>".to_string(),
            notes: vec![ExportNote {
                content_md: "<script>x</script>".to_string(),
                created_at: "t".into(),
                attachments: vec![],
            }],
        };
        let html = to_html(&project, "T", &BTreeMap::new());
        assert!(!html.contains("<script>"));
        assert!(html.contains("&lt;script&gt;"));
        assert!(html.contains("&lt;b&gt;"));
    }
}
