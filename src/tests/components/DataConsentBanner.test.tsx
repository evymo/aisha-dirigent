import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { DataConsentBanner } from "@/components/layout/DataConsentBanner";

describe("DataConsentBanner", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();

    // Mock window.location.href for redirect tests
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, href: originalLocation.href },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: originalLocation,
    });
  });

  it("should render the consent banner when not yet accepted", () => {
    render(<DataConsentBanner />);
    expect(screen.getByText("dataConsent.message")).toBeInTheDocument();
    expect(screen.getByText("dataConsent.privacyNote")).toBeInTheDocument();
  });

  it("should not render when previously accepted", () => {
    localStorage.setItem("platform_data_consent_accepted", "1");
    render(<DataConsentBanner />);
    expect(screen.queryByText("dataConsent.message")).not.toBeInTheDocument();
  });

  it("should have a dialog role for accessibility", () => {
    render(<DataConsentBanner />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("should render accept and decline buttons", () => {
    render(<DataConsentBanner />);
    expect(
      screen.getByRole("button", { name: "dataConsent.accept" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /dataConsent\.decline/i }),
    ).toBeInTheDocument();
  });

  it("should accept and persist to localStorage on accept click", async () => {
    const user = userEvent.setup();
    render(<DataConsentBanner />);

    expect(screen.getByText("dataConsent.message")).toBeInTheDocument();

    const acceptButton = screen.getByRole("button", {
      name: "dataConsent.accept",
    });
    await user.click(acceptButton);

    expect(screen.queryByText("dataConsent.message")).not.toBeInTheDocument();
    expect(localStorage.getItem("platform_data_consent_accepted")).toBe("1");
  });

  it("should redirect to RTN Wikipedia page on decline click", async () => {
    const user = userEvent.setup();
    render(<DataConsentBanner />);

    const declineButton = screen.getByRole("button", {
      name: /dataConsent\.decline/i,
    });
    await user.click(declineButton);

    expect(window.location.href).toBe(
      "https://cs.wikipedia.org/wiki/RTN",
    );
  });

  it("should render even when localStorage throws on read", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    render(<DataConsentBanner />);
    expect(screen.getByText("dataConsent.message")).toBeInTheDocument();
  });

  it("should still dismiss visually even when localStorage throws on write", async () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    const user = userEvent.setup();
    render(<DataConsentBanner />);

    const acceptButton = screen.getByRole("button", {
      name: "dataConsent.accept",
    });
    await user.click(acceptButton);

    // Banner disappears from DOM even though storage failed
    expect(screen.queryByText("dataConsent.message")).not.toBeInTheDocument();
  });
});
