/**
 * OperationalAssessmentWizard Error Handling Tests
 * 
 * Separate test file for error scenarios - needed because vi.mock is hoisted
 * and we need the mock configured in "failure mode" from the start.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { OperationalAssessmentWizard } from "@/components/assessment/OperationalAssessmentWizard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import React from "react";

// React Router v7+ has removed the future prop - v7 features are now default

// Mock useOperationalAssessment hook - ALWAYS in error mode for this file
// CRITICAL: Must create stable references OUTSIDE the returned hook function
// to avoid infinite re-renders caused by changing function references
vi.mock("@/hooks/useOperationalAssessment", () => {
  // Create ALL mock functions inside factory (stable references)
  const startAssessmentFn = async (): Promise<string> => {
    throw new Error("Init failed");
  };
  const saveDimensionFn = async () => { /* noop */ };
  const completeAssessmentFn = async () => { /* noop */ };
  
  // Create a single stable result object
  const stableHookResult = {
    currentAssessmentId: null,
    startAssessment: startAssessmentFn,
    saveDimension: saveDimensionFn,
    completeAssessment: completeAssessmentFn,
    latestAssessment: null,
    isLoadingLatest: false,
    isCreating: false,
    isSaving: false,
    isCompleting: false,
  };
  
  return {
    useOperationalAssessment: () => stableHookResult,
    dbToScoreFormat: () => ({}),
  };
});

// Mock DimensionalAssessment
vi.mock("@/components/assessment/DimensionalAssessment", () => ({
  DimensionalAssessment: () => <div data-testid="dimensional-assessment">Assessment</div>,
}));

// Mock AssessmentSummary
vi.mock("@/components/assessment/AssessmentSummary", () => ({
  AssessmentSummary: () => <div data-testid="assessment-summary">Summary</div>,
}));

// Mock useSession
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: "test-user-id" },
    isLoading: false,
  }),
}));

// Mock useNavigate
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

// Mock toast (sonner)
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

// Mock i18n
vi.mock("react-i18next", async () => {
  const actual = await vi.importActual("react-i18next");
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string) => fallback || key,
      i18n: { language: "cs" },
    }),
  };
});

describe("OperationalAssessmentWizard Error Handling", () => {
  let queryClient: QueryClient;

  const renderWithProviders = (ui: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          {ui}
        </MemoryRouter>
      </QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  it("should show error state when initialization fails", async () => {
    renderWithProviders(<OperationalAssessmentWizard />);

    await waitFor(() => {
      expect(screen.getByText("common.somethingWentWrong")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("should show retry button on error", async () => {
    renderWithProviders(<OperationalAssessmentWizard />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "common.tryAgain" })).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("should show detailed error message", async () => {
    renderWithProviders(<OperationalAssessmentWizard />);

    await waitFor(() => {
      expect(screen.getByText("assessment.wizard.errors.initFailed")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("should show error icon", async () => {
    renderWithProviders(<OperationalAssessmentWizard />);

    await waitFor(() => {
      // AlertCircle icon should be present
      const icon = document.querySelector('.text-destructive');
      expect(icon).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
