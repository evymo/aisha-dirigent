import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { BetaBanner } from "@/components/layout/BetaBanner";

describe("BetaBanner", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("should render the beta banner when not dismissed", () => {
    render(<BetaBanner />);
    expect(screen.getByText("betaBanner.message")).toBeInTheDocument();
  });

  it("should not render when previously dismissed", () => {
    localStorage.setItem("platform_beta_banner_dismissed", "1");
    render(<BetaBanner />);
    expect(screen.queryByText("betaBanner.message")).not.toBeInTheDocument();
  });

  it("should dismiss and persist to localStorage on click", async () => {
    const user = userEvent.setup();
    render(<BetaBanner />);

    expect(screen.getByText("betaBanner.message")).toBeInTheDocument();

    const dismissButton = screen.getByRole("button", {
      name: "betaBanner.dismiss",
    });
    await user.click(dismissButton);

    expect(screen.queryByText("betaBanner.message")).not.toBeInTheDocument();
    expect(localStorage.getItem("platform_beta_banner_dismissed")).toBe("1");
  });
});
