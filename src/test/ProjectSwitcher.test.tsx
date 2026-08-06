import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import ProjectSwitcher from "../components/ProjectSwitcher";
import { Project } from "../lib/types";

const project = (over: Partial<Project> = {}): Project => ({
  id: 1,
  name: "Inbox",
  sort_order: 0,
  created_at: "2024-01-01",
  ...over,
});

describe("ProjectSwitcher", () => {
  it("renders all projects and highlights the active one", () => {
    render(
      <ProjectSwitcher
        projects={[project({ id: 1, name: "Inbox" }), project({ id: 2, name: "Work" })]}
        activeId={2}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("Inbox")).toBeInTheDocument();
    expect(screen.getByText("Work")).toBeInTheDocument();
    const activeItem = screen.getByText("Work").closest("li");
    expect(activeItem?.className).toContain("active");
  });

  it("calls onSelect when a project is clicked", () => {
    const onSelect = vi.fn();
    render(
      <ProjectSwitcher
        projects={[project({ id: 1, name: "Inbox" })]}
        activeId={1}
        onSelect={onSelect}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Inbox"));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("creates a project via the add field", () => {
    const onCreate = vi.fn();
    render(
      <ProjectSwitcher
        projects={[]}
        activeId={null}
        onSelect={vi.fn()}
        onCreate={onCreate}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("＋"));
    const input = screen.getByPlaceholderText("projects.namePrompt");
    fireEvent.change(input, { target: { value: "New thing" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCreate).toHaveBeenCalledWith("New thing");
  });
});
