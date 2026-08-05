import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Clean up the DOM between every test.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
