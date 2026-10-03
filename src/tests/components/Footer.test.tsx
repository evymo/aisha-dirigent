import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Footer } from "@/components/layout/Footer";

// React Router v7+ has removed the future prop - v7 features are now default

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: "en",
      changeLanguage: vi.fn(),
    },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

describe("Footer", () => {
  it("renders service and legal navigation links", () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    );

    // Services links
    expect(screen.getByRole("link", { name: "web.nav.solution" })).toHaveAttribute("href", "/solution");
    expect(screen.getByRole("link", { name: "web.nav.guild" })).toHaveAttribute("href", "/guild");
    expect(screen.getByRole("link", { name: "web.nav.references" })).toHaveAttribute("href", "/references");
    expect(screen.getByRole("link", { name: "web.nav.about" })).toHaveAttribute("href", "/story");
    expect(screen.getByRole("link", { name: "web.nav.partnerProgram" })).toHaveAttribute("href", "/partners");
    expect(screen.getByRole("link", { name: "footer.news" })).toHaveAttribute("href", "/news");
    expect(screen.getByRole("link", { name: "footer.faq" })).toHaveAttribute("href", "/faq");

    // Legal links
    expect(screen.getByRole("link", { name: "footer.privacyPolicy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "footer.termsOfService" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "footer.disclaimer" })).toHaveAttribute("href", "/legal-disclaimer");
  });
});
