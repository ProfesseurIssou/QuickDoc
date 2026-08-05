import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import KeyCapture from "../components/KeyCapture";

describe("KeyCapture", () => {
  it("shows the current binding and toggles into capture mode", () => {
    const onChange = vi.fn();
    render(<KeyCapture value="Ctrl+Alt+P" onChange={onChange} />);
    const btn = screen.getByText("Ctrl+Alt+P");
    fireEvent.click(btn);
    expect(screen.getByText("settings.pressKeys")).toBeInTheDocument();
  });

  it("captures a key combo and reports it", () => {
    const onChange = vi.fn();
    render(<KeyCapture value="Ctrl+Alt+P" onChange={onChange} />);
    fireEvent.click(screen.getByText("Ctrl+Alt+P"));
    // Simulate the global keydown listener KeyCapture attaches on capture.
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith("Ctrl+K");
  });

  it("ignores Escape and stays", () => {
    const onChange = vi.fn();
    render(<KeyCapture value="Ctrl+Alt+P" onChange={onChange} />);
    fireEvent.click(screen.getByText("Ctrl+Alt+P"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    // Button reverts to showing the value.
    expect(screen.getByText("Ctrl+Alt+P")).toBeInTheDocument();
  });
});
