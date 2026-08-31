import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock react-i18next before importing components that use it.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// Mock the MDEditor so tests don't pull in the full markdown renderer. The
// factory must be self-contained (vi.mock is hoisted above imports).
vi.mock("@uiw/react-md-editor", () => {
  const Md = ({ value, source }: { value?: string; source?: string }) =>
    source || value ? <div data-testid="md">{source ?? value}</div> : null;
  (Md as unknown as { Markdown: typeof Md }).Markdown = Md;
  return { default: Md };
});

// Mock AttachmentView so we don't touch the tauri filesystem in unit tests.
vi.mock("../components/AttachmentView", () => ({
  default: ({ attachment }: { attachment: { file_name: string } }) => (
    <div data-testid="attachment">{attachment.file_name}</div>
  ),
}));

import History from "../components/History";
import { Note } from "../lib/types";

const note = (over: Partial<Note> = {}): Note => ({
  id: 1,
  project_id: 1,
  content_md: "hello",
  created_at: "2024-01-01 12:00",
  updated_at: "2024-01-01 12:00",
  color: null,
  attachments: [],
  ...over,
});

const props = (over: Record<string, unknown> = {}) => ({
  onDelete: vi.fn(),
  onEdit: vi.fn(),
  onColor: vi.fn(),
  ...over,
});

describe("History", () => {
  it("shows empty state when there are no notes", () => {
    render(<History notes={[]} {...props()} />);
    expect(screen.getByText("editor.emptyHistory")).toBeInTheDocument();
  });

  it("renders note content and calls delete", () => {
    const onDelete = vi.fn();
    render(<History notes={[note()]} {...props({ onDelete })} />);
    expect(screen.getByTestId("md")).toHaveTextContent("hello");
    expect(screen.getByText("2024-01-01 12:00")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("delete"));
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it("edits a note inline and saves on Enter", () => {
    const onEdit = vi.fn();
    render(<History notes={[note()]} {...props({ onEdit })} />);
    fireEvent.click(screen.getByLabelText("editor.edit"));
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "updated" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onEdit).toHaveBeenCalledWith(1, "updated");
  });

  it("tints a note when a color swatch is picked", () => {
    const onColor = vi.fn();
    render(<History notes={[note()]} {...props({ onColor })} />);
    fireEvent.click(screen.getAllByLabelText("editor.color")[0]);
    expect(onColor).toHaveBeenCalledWith(1, "#4caf50");
  });

  it("renders attachments", () => {
    render(
      <History
        notes={[
          note({
            attachments: [
              {
                id: 2,
                note_id: 1,
                kind: "image",
                mime: "image/png",
                file_name: "abc.png",
                created_at: "t",
              },
            ],
          }),
        ]}
        {...props()}
      />,
    );
    expect(screen.getByTestId("attachment")).toHaveTextContent("abc.png");
  });

  it("renders notes in the given (oldest-first) order in the DOM", () => {
    // Notes are already ordered oldest-first by the backend; History must not
    // reorder them, so the DOM order matches the input order.
    render(
      <History
        notes={[
          note({ id: 1, content_md: "first" }),
          note({ id: 2, content_md: "second" }),
          note({ id: 3, content_md: "third" }),
        ]}
        {...props()}
      />,
    );
    const rendered = screen.getAllByTestId("md").map((el) => el.textContent);
    expect(rendered).toEqual(["first", "second", "third"]);
  });

  it("renders the scrollable history list container", () => {
    render(<History notes={[note()]} {...props()} />);
    expect(document.querySelector("ul.history")).toBeInTheDocument();
  });
});
