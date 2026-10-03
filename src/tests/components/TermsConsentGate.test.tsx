import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockUser = { id: "u1", email: "a@b.com" };
const mockUseSession = vi.fn();
const mockUseConsents = vi.fn();

vi.mock("@/hooks/useSession", () => ({
  useSession: () => mockUseSession(),
}));

vi.mock("@/hooks/useStudies", () => ({
  useConsents: () => mockUseConsents(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    promise: vi.fn(),
  }),
}));

vi.mock("@/components/layout/Header", () => ({
  Header: () => <header data-testid="mock-header" />,
}));

vi.mock("@/components/layout/Footer", () => ({
  Footer: () => <footer data-testid="mock-footer" />,
}));

vi.mock("@/components/legal/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content}</div>
  ),
}));

import { TermsConsentGate } from "@/components/session/TermsConsentGate";

function renderWithRouter(
  ui: React.ReactElement,
  { initialEntries = ["/member"] }: { initialEntries?: string[] } = {}
) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
  );
}

const defaultConsents = {
  loading: false,
  hasConsent: vi.fn().mockReturnValue(false),
  grantConsent: vi.fn().mockResolvedValue({ data: null, error: null }),
  refetch: vi.fn(),
  consents: [],
};

describe("TermsConsentGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({ user: mockUser, isLoading: false });
    mockUseConsents.mockReturnValue(defaultConsents);
  });

  it("should pass through children on non-member routes", () => {
    renderWithRouter(
      <TermsConsentGate>
        <div data-testid="child-content">Hello</div>
      </TermsConsentGate>,
      { initialEntries: ["/shop"] }
    );

    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    expect(screen.queryByTestId("markdown-renderer")).not.toBeInTheDocument();
  });

  it("should pass through children when user has consent", () => {
    mockUseConsents.mockReturnValue({
      ...defaultConsents,
      hasConsent: vi.fn().mockReturnValue(true),
    });

    renderWithRouter(
      <TermsConsentGate>
        <div data-testid="child-content">Hello</div>
      </TermsConsentGate>,
      { initialEntries: ["/member"] }
    );

    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });

  it("should pass through children when no user is logged in", () => {
    mockUseSession.mockReturnValue({ user: null, isLoading: false });

    renderWithRouter(
      <TermsConsentGate>
        <div data-testid="child-content">Hello</div>
      </TermsConsentGate>,
      { initialEntries: ["/member"] }
    );

    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });

  it("should show full-page terms on /member when consent is missing", () => {
    renderWithRouter(
      <TermsConsentGate>
        <div data-testid="child-content">Hidden</div>
      </TermsConsentGate>,
      { initialEntries: ["/member"] }
    );

    // Child should NOT be visible
    expect(screen.queryByTestId("child-content")).not.toBeInTheDocument();

    // Terms content should be visible
    expect(screen.getByTestId("markdown-renderer")).toBeInTheDocument();
    expect(screen.getByText("auth.consent_terms_title")).toBeInTheDocument();
    expect(screen.getByText("auth.consent_terms_desc")).toBeInTheDocument();
    expect(screen.getByText("auth.consent_terms_scroll_hint")).toBeInTheDocument();
  });

  it("should show full-page terms on /member sub-routes", () => {
    renderWithRouter(
      <TermsConsentGate>
        <div data-testid="child-content">Hidden</div>
      </TermsConsentGate>,
      { initialEntries: ["/member/check-in"] }
    );

    expect(screen.queryByTestId("child-content")).not.toBeInTheDocument();
    expect(screen.getByTestId("markdown-renderer")).toBeInTheDocument();
  });

  it("should disable accept button until checkbox is checked", () => {
    renderWithRouter(
      <TermsConsentGate>
        <div>content</div>
      </TermsConsentGate>,
      { initialEntries: ["/member"] }
    );

    const button = screen.getByRole("button", { name: "common.continue" });
    expect(button).toBeDisabled();
  });

  it("should enable accept button after checking the checkbox", async () => {
    const user = userEvent.setup();

    renderWithRouter(
      <TermsConsentGate>
        <div>content</div>
      </TermsConsentGate>,
      { initialEntries: ["/member"] }
    );

    const checkbox = screen.getByRole("checkbox");
    await user.click(checkbox);

    const button = screen.getByRole("button", { name: "common.continue" });
    expect(button).toBeEnabled();
  });

  it("should call grantConsent when accepted", async () => {
    const grantConsent = vi.fn().mockResolvedValue({ data: null, error: null });
    const refetch = vi.fn();
    mockUseConsents.mockReturnValue({
      ...defaultConsents,
      grantConsent,
      refetch,
    });

    const user = userEvent.setup();

    renderWithRouter(
      <TermsConsentGate>
        <div>content</div>
      </TermsConsentGate>,
      { initialEntries: ["/member"] }
    );

    const checkbox = screen.getByRole("checkbox");
    await user.click(checkbox);

    const button = screen.getByRole("button", { name: "common.continue" });
    await user.click(button);

    expect(grantConsent).toHaveBeenCalledWith("data_processing");
    expect(refetch).toHaveBeenCalled();
  });
});
