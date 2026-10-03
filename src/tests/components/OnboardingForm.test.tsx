import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OnboardingForm } from "@/components/member/OnboardingForm";
import { renderWithProviders } from "../utils/test-utils";
import { aisha } from "@/integrations/db/client";

// Polyfill for Radix UI / jsdom
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const navigateMock = vi.fn();
const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
    loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
  })
);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options && typeof options.count === "number") return `${key}:${options.count}`;
      if (options && typeof options.email === "string") return `${key}:${options.email}`;
      if (options && typeof options.preference === "string") return `${key}:${options.preference}`;
      return key;
    },
    i18n: { language: "cs", changeLanguage: vi.fn() },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("sonner", () => ({
  toast: toastMock,
}));

// Mock dependencies
const mockGetKcUser = vi.fn();

vi.mock("@/integrations/auth/oidc-client", () => ({
  getUser: (...args: unknown[]) => mockGetKcUser(...args),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: vi.fn(async () => ({ data: "response-id", error: null })),
  },
}));

// Mock OperationalAssessmentWizard to avoid SessionProvider requirement
vi.mock("@/components/assessment/OperationalAssessmentWizard", () => ({
  OperationalAssessmentWizard: ({ onComplete, onSkip }: { onComplete?: (score: { overall: number }) => void; onSkip?: () => void }) => (
    <div data-testid="mock-operational-assessment">
      <button onClick={() => onComplete?.({ overall: 75 })}>Complete Assessment</button>
      <button onClick={() => onSkip?.()}>Skip Assessment</button>
    </div>
  ),
}));

describe("OnboardingForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetKcUser.mockResolvedValue({ id: "test-user-id", email: "test@example.com" });
  });

  describe("Rendering", () => {
    it("should render the form", () => {
      const { container } = renderWithProviders(<OnboardingForm />);
      
      // Form should render
      const form = container.querySelector("form");
      expect(form).toBeInTheDocument();
    });

    it("should render rating buttons", () => {
      renderWithProviders(<OnboardingForm />);

      // Should have multiple rating buttons (0-10 for each feeling field)
      const ratingButtons = screen.getAllByRole("radio");
      expect(ratingButtons.length).toBeGreaterThan(0);
    });

    it("should render navigation buttons", () => {
      renderWithProviders(<OnboardingForm />);

      expect(screen.getByRole("button", { name: "onboarding.buttons.next" })).toBeInTheDocument();
    });
  });

  it("should navigate through steps 1-5", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OnboardingForm />);

    expect(screen.getByText("onboarding.step1.title")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "onboarding.buttons.next" }));

    expect(screen.getByText("onboarding.step2.title")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "onboarding.buttons.next" }));

    expect(screen.getByText("onboarding.step3.title")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "onboarding.buttons.next" }));

    expect(screen.getByText("onboarding.step4.title")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "onboarding.buttons.next" }));

    // Step 5 - Operational Assessment (Finish button appears after skip/complete)
    expect(screen.getByText("onboarding.step5.title")).toBeInTheDocument();
    // Skip assessment to show Finish button
    await user.click(screen.getByRole("button", { name: "Skip Assessment" }));
    expect(screen.getByRole("button", { name: "onboarding.buttons.finish" })).toBeInTheDocument();
  });

  describe("Data submission", () => {
    it("should submit valid data and navigate to /member", async () => {
      const user = userEvent.setup();

      // Reset and configure the mock
      vi.mocked(aisha.rpc).mockClear();
      vi.mocked(aisha.rpc).mockResolvedValue({ data: "response-id", error: null, count: null, status: 200, statusText: "OK" } as never);

      renderWithProviders(<OnboardingForm />);

      await user.click(screen.getByRole("button", { name: "onboarding.buttons.next" }));
      await user.type(
        screen.getByPlaceholderText("onboarding.step2.primaryConcern.placeholder"),
        "Some concern text"
      );
      await user.click(screen.getByRole("button", { name: "onboarding.buttons.next" }));

      await user.type(
        screen.getByPlaceholderText("onboarding.step3.mainGoal.placeholder"),
        "Some goal text"
      );
      await user.click(screen.getByRole("button", { name: "onboarding.buttons.next" }));

      // Step 4 - preferences
      await user.click(screen.getByRole("button", { name: "onboarding.buttons.next" }));

      // Step 5 - Operational Assessment (skip it using mocked button)
      await user.click(screen.getByRole("button", { name: "Skip Assessment" }));

      // Wait for state update before clicking Finish
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "onboarding.buttons.finish" })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "onboarding.buttons.finish" }));

      await waitFor(() => {
        expect(vi.mocked(aisha.rpc)).toHaveBeenCalled();
      });

      // Verify RPC was called with correct arguments
      expect(vi.mocked(aisha.rpc)).toHaveBeenCalledWith(
        "submit_onboarding_response_audited",
        expect.objectContaining({
          p_primary_concern: "Some concern text",
          p_main_goal: "Some goal text",
          p_secondary_concerns: [],
        })
      );
      expect(navigateMock).toHaveBeenCalledWith("/member");
    });

    it("should not submit when session is missing", async () => {
      const user = userEvent.setup({ delay: null });

      // Mock getUser to return null for ALL calls in this test
      mockGetKcUser.mockResolvedValue(null);

      // Reset and configure the mock - RPC should NOT be called when no session
      vi.mocked(aisha.rpc).mockClear();
      vi.mocked(aisha.rpc).mockResolvedValue({ data: "response-id", error: null, count: null, status: 200, statusText: "OK" } as never);

      renderWithProviders(<OnboardingForm />);

      await user.click(screen.getByRole("button", { name: "onboarding.buttons.next" }));
      await user.type(
        screen.getByPlaceholderText("onboarding.step2.primaryConcern.placeholder"),
        "Some concern text"
      );
      await user.click(screen.getByRole("button", { name: "onboarding.buttons.next" }));
      await user.type(
        screen.getByPlaceholderText("onboarding.step3.mainGoal.placeholder"),
        "Some goal text"
      );
      await user.click(screen.getByRole("button", { name: "onboarding.buttons.next" }));
      // Step 4 - preferences
      await user.click(screen.getByRole("button", { name: "onboarding.buttons.next" }));
      // Step 5 - Operational Assessment (skip it using mocked button)
      await user.click(screen.getByRole("button", { name: "Skip Assessment" }));
      
      // Click the finish/submit button (might show as "finish" or "submitting")
      const finishButton = screen.getByRole("button", { name: /onboarding\.buttons\.(finish|submitting)/ });
      await user.click(finishButton);

      // Wait for the error toast (hook throws "No authenticated user" error)
      await waitFor(() => {
        expect(toastMock.error).toHaveBeenCalled();
      });

      expect(mockGetKcUser).toHaveBeenCalled();
      // RPC should NOT be called because getUser returned null
      expect(vi.mocked(aisha.rpc)).not.toHaveBeenCalled();
    });
  });

  it("should allow selecting a rating via keyboard", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OnboardingForm />);

    const overallGroup = screen.getByRole("radiogroup", {
      name: "onboarding.step1.overallFeeling.low – onboarding.step1.overallFeeling.high",
    });
    const withinOverall = within(overallGroup);

    const target = withinOverall.getByRole("radio", { name: "7" });
    target.focus();
    await user.keyboard("[Space]");

    const overallWrapper = overallGroup.parentElement as HTMLElement;
    expect(within(overallWrapper).getByText("7 / 10")).toBeInTheDocument();
  });
});
