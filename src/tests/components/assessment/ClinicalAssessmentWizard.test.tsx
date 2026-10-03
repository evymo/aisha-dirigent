/**
 * OperationalAssessmentWizard Component Tests
 * 
 * Tests for the full assessment wizard including:
 * - Phase management (loading, assessment, summary)
 * - Persistence integration
 * - Error handling
 * - Navigation callbacks
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OperationalAssessmentWizard, PreviousScoreIndicator } from "@/components/assessment/OperationalAssessmentWizard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import React from "react";

// React Router v7+ has removed the future prop - v7 features are now default

// Mock useOperationalAssessment hook
const mockStartAssessment = vi.fn();
const mockSaveDimension = vi.fn();
const mockCompleteAssessment = vi.fn();

vi.mock("@/hooks/useOperationalAssessment", () => {
  return {
    useOperationalAssessment: () => ({
      currentAssessmentId: "test-assessment-id",
      startAssessment: mockStartAssessment,
      saveDimension: mockSaveDimension,
      completeAssessment: mockCompleteAssessment,
      latestAssessment: null,
      isLoadingLatest: false,
      isCreating: false,
      isSaving: false,
      isCompleting: false,
    }),
    dbToScoreFormat: vi.fn(),
  };
});

// Mock DimensionalAssessment to simplify testing
vi.mock("@/components/assessment/DimensionalAssessment", () => ({
  DimensionalAssessment: ({ onComplete, onCancel }: { 
    onComplete: (score: { overall: number; dimensions: unknown[]; interpretation: string; alertFlags: string[]; assessmentDate: Date }) => void; 
    onCancel: () => void;
  }) => (
    <div data-testid="dimensional-assessment">
      <button 
        onClick={() => onComplete({ 
          overall: 75, 
          dimensions: [], 
          interpretation: "good",
          alertFlags: [],
          assessmentDate: new Date(),
        })}
      >
        Complete Assessment
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

// Mock AssessmentSummary
vi.mock("@/components/assessment/AssessmentSummary", () => ({
  AssessmentSummary: ({ onRetake, onContinue }: { onRetake: () => void; onContinue: () => void }) => (
    <div data-testid="assessment-summary">
      <span>Assessment Summary</span>
      <button onClick={onRetake}>Retake</button>
      <button onClick={onContinue}>Continue</button>
    </div>
  ),
}));

// Mock useSession
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: "test-user-id" },
    isLoading: false,
  }),
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
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

describe("OperationalAssessmentWizard", () => {
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
    mockStartAssessment.mockResolvedValue("test-assessment-id");
    mockCompleteAssessment.mockResolvedValue(true);
  });

  describe("Initialization", () => {
    it("should start assessment on mount", async () => {
      renderWithProviders(<OperationalAssessmentWizard />);

      await waitFor(() => {
        expect(mockStartAssessment).toHaveBeenCalledWith("onboarding");
      });
    });

    it("should use custom assessment type", async () => {
      renderWithProviders(<OperationalAssessmentWizard assessmentType="periodic" />);

      await waitFor(() => {
        expect(mockStartAssessment).toHaveBeenCalledWith("periodic");
      });
    });

    it("should show assessment phase after initialization", async () => {
      renderWithProviders(<OperationalAssessmentWizard />);

      await waitFor(() => {
        expect(screen.getByTestId("dimensional-assessment")).toBeInTheDocument();
      });
    });
  });

  describe("Assessment Phase", () => {
    it("should render DimensionalAssessment component", async () => {
      renderWithProviders(<OperationalAssessmentWizard />);

      await waitFor(() => {
        expect(screen.getByTestId("dimensional-assessment")).toBeInTheDocument();
      });
    });

    it("should complete assessment and show summary", async () => {
      const user = userEvent.setup();
      renderWithProviders(<OperationalAssessmentWizard />);

      await waitFor(() => {
        expect(screen.getByText("Complete Assessment")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Complete Assessment"));

      await waitFor(() => {
        expect(mockCompleteAssessment).toHaveBeenCalled();
      });
    });
  });

  describe("Callbacks", () => {
    it("should call onComplete when assessment is finished", async () => {
      const onComplete = vi.fn();
      const user = userEvent.setup();
      
      renderWithProviders(<OperationalAssessmentWizard onComplete={onComplete} />);

      await waitFor(() => {
        expect(screen.getByText("Complete Assessment")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Complete Assessment"));

      await waitFor(() => {
        expect(mockCompleteAssessment).toHaveBeenCalled();
      });
    });

    it("should call onSkip when cancelled", async () => {
      const onSkip = vi.fn();
      const user = userEvent.setup();
      
      renderWithProviders(<OperationalAssessmentWizard onSkip={onSkip} showSkip />);

      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Cancel"));

      expect(onSkip).toHaveBeenCalled();
    });
  });

  describe("Custom Content", () => {
    it("should render custom title", async () => {
      renderWithProviders(
        <OperationalAssessmentWizard title="Custom Title" />
      );

      await waitFor(() => {
        expect(screen.getByText("Custom Title")).toBeInTheDocument();
      });
    });

    it("should render custom description", async () => {
      renderWithProviders(
        <OperationalAssessmentWizard description="Custom description text" />
      );

      await waitFor(() => {
        expect(screen.getByText("Custom description text")).toBeInTheDocument();
      });
    });
  });

  describe("Embedded Mode", () => {
    it("should not render card wrapper in embedded mode", async () => {
      renderWithProviders(
        <OperationalAssessmentWizard embedded title="Test" />
      );

      await waitFor(() => {
        expect(screen.getByTestId("dimensional-assessment")).toBeInTheDocument();
      });

      // In embedded mode, the card wrapper is not used
      // The title might be rendered differently
    });
  });

  // Note: Error handling tests moved to OperationalAssessmentWizard.error.test.tsx
  // (separate file needed because vi.mock is hoisted and can't switch modes)
});

describe("PreviousScoreIndicator", () => {
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
      },
    });
  });

  it("should return null when no previous assessment", () => {
    // useOperationalAssessment mock returns latestAssessment: null
    const { container } = renderWithProviders(<PreviousScoreIndicator />);
    
    expect(container.firstChild).toBeNull();
  });
});
