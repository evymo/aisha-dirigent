import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AppErrorBoundary from "./AppErrorBoundary";

// Mock i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "errors.genericError": "Something went wrong",
        "errors.pageLoadError": "An unexpected error occurred",
        "errors.devDetails": "Details (development only):",
        "common.retry": "Try again",
      };
      return translations[key] || key;
    },
  }),
}));

const ProblemChild = () => {
  throw new Error("Boom!");
};

describe("AppErrorBoundary", () => {
  it("renders fallback with details in development", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      render(
        <AppErrorBoundary>
          <ProblemChild />
        </AppErrorBoundary>,
      );

      expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
      expect(screen.getByText(/Boom!/i)).toBeInTheDocument();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("renders fallback without error details in production", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const meta = import.meta as unknown as { env?: Record<string, string | boolean | undefined> };
    const originalDev = meta.env?.DEV;
    const originalMode = meta.env?.MODE;

    try {
      if (!meta.env) meta.env = {};
      meta.env.DEV = false;
      meta.env.MODE = "production";

      render(
        <AppErrorBoundary>
          <ProblemChild />
        </AppErrorBoundary>,
      );

      expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
      expect(screen.queryByText(/Boom!/i)).not.toBeInTheDocument();
    } finally {
      if (!meta.env) meta.env = {};
      meta.env.DEV = originalDev;
      meta.env.MODE = originalMode;
      consoleErrorSpy.mockRestore();
    }
  });
});
