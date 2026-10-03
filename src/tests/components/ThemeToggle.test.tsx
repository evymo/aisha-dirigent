import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";

const mockSetTheme = vi.fn();
const mockTheme = { resolvedTheme: "light", setTheme: mockSetTheme };

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => mockTheme,
}));

import { ThemeToggle } from "@/components/ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    mockSetTheme.mockClear();
    mockTheme.resolvedTheme = "light";
  });

  it("renders toggle button with accessible label", () => {
    render(<ThemeToggle />);
    expect(
      screen.getByRole("button", { name: "common.theme.toggle" })
    ).toBeInTheDocument();
  });

  it("toggles from light to dark on click", async () => {
    const user = userEvent.setup();
    mockTheme.resolvedTheme = "light";
    render(<ThemeToggle />);

    await user.click(
      screen.getByRole("button", { name: "common.theme.toggle" })
    );

    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("toggles from dark to light on click", async () => {
    const user = userEvent.setup();
    mockTheme.resolvedTheme = "dark";
    render(<ThemeToggle />);

    await user.click(
      screen.getByRole("button", { name: "common.theme.toggle" })
    );

    expect(mockSetTheme).toHaveBeenCalledWith("light");
  });

  it("treats undefined resolvedTheme as light (toggles to dark)", async () => {
    const user = userEvent.setup();
    mockTheme.resolvedTheme = undefined as unknown as string;
    render(<ThemeToggle />);

    await user.click(
      screen.getByRole("button", { name: "common.theme.toggle" })
    );

    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });
});
