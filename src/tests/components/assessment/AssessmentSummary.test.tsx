/**
 * AssessmentSummary Component Tests
 * 
 * Tests for the assessment results display including:
 * - Score display
 * - Dimension breakdown
 * - Trend indicators
 * - Priority areas
 * - Critical flags
 * - Action buttons
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssessmentSummary } from "@/components/assessment/AssessmentSummary";
import type { LongevityScore, Dimension } from "@/components/assessment/types";

// Mock react-i18next to return keys
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

// Mock the score calculator functions
vi.mock("@/components/assessment/scoreCalculator", async () => {
  const actual = await vi.importActual("@/components/assessment/scoreCalculator");
  return {
    ...actual,
    // Keep actual implementations for testing
  };
});

describe("AssessmentSummary", () => {
  const createMockScore = (overrides: Partial<LongevityScore> = {}): LongevityScore => ({
    overall: 75,
    dimensions: [
      { dimension: "VIT" as Dimension, rawScore: 8, normalizedScore: 80, tagCount: 3, hasNegativeIndicators: false, operationalFlags: [] },
      { dimension: "ENE" as Dimension, rawScore: 7, normalizedScore: 70, tagCount: 2, hasNegativeIndicators: false, operationalFlags: [] },
      { dimension: "SLP" as Dimension, rawScore: 6, normalizedScore: 60, tagCount: 2, hasNegativeIndicators: false, operationalFlags: [] },
      { dimension: "PHY" as Dimension, rawScore: 8, normalizedScore: 80, tagCount: 3, hasNegativeIndicators: false, operationalFlags: [] },
      { dimension: "MET" as Dimension, rawScore: 7, normalizedScore: 70, tagCount: 2, hasNegativeIndicators: false, operationalFlags: [] },
      { dimension: "IMM" as Dimension, rawScore: 8, normalizedScore: 80, tagCount: 2, hasNegativeIndicators: false, operationalFlags: [] },
      { dimension: "PSY" as Dimension, rawScore: 7, normalizedScore: 70, tagCount: 3, hasNegativeIndicators: false, operationalFlags: [] },
      { dimension: "COG" as Dimension, rawScore: 8, normalizedScore: 80, tagCount: 2, hasNegativeIndicators: false, operationalFlags: [] },
      { dimension: "MOO" as Dimension, rawScore: 7, normalizedScore: 70, tagCount: 2, hasNegativeIndicators: false, operationalFlags: [] },
    ],
    interpretation: "good",
    alertFlags: [],
    assessmentDate: new Date("2024-12-20T10:00:00Z"),
    ...overrides,
  });

  const defaultProps = {
    score: createMockScore(),
    onRetake: vi.fn(),
    onContinue: vi.fn(),
    showActions: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Score Display", () => {
    it("should display the overall score", () => {
      render(<AssessmentSummary {...defaultProps} />);

      expect(screen.getByText("75%")).toBeInTheDocument();
    });

    it("should display score interpretation", () => {
      render(<AssessmentSummary {...defaultProps} />);

      // "Dobrý stav" is the Czech interpretation for "good"
      expect(screen.getByText("Dobrý stav")).toBeInTheDocument();
    });

    it("should display excellent score with correct styling", () => {
      const score = createMockScore({ overall: 85, interpretation: "excellent" });
      render(<AssessmentSummary {...defaultProps} score={score} />);

      expect(screen.getByText("85%")).toBeInTheDocument();
      expect(screen.getByText("Výborný stav")).toBeInTheDocument();
    });

    it("should display poor score with warning styling", () => {
      const score = createMockScore({ overall: 30, interpretation: "poor" });
      render(<AssessmentSummary {...defaultProps} score={score} />);

      expect(screen.getByText("30%")).toBeInTheDocument();
      expect(screen.getByText("Vyžaduje pozornost")).toBeInTheDocument();
    });
  });

  describe("Trend Indicator", () => {
    it("should display positive trend", () => {
      const score = createMockScore({ trendVsBaseline: 15 });
      render(<AssessmentSummary {...defaultProps} score={score} />);

      expect(screen.getByText(/\+15%/)).toBeInTheDocument();
      expect(screen.getByText(/Zlepšení/)).toBeInTheDocument();
    });

    it("should display negative trend", () => {
      const score = createMockScore({ trendVsBaseline: -10 });
      render(<AssessmentSummary {...defaultProps} score={score} />);

      expect(screen.getByText(/-10%/)).toBeInTheDocument();
    });

    it("should not display trend when not available", () => {
      const score = createMockScore({ trendVsBaseline: undefined });
      render(<AssessmentSummary {...defaultProps} score={score} />);

      expect(screen.queryByText(/Zlepšení|Zhoršení|Stabilní/)).not.toBeInTheDocument();
    });
  });

  describe("Dimension Breakdown", () => {
    it("should display all dimensions", () => {
      render(<AssessmentSummary {...defaultProps} />);

      expect(screen.getByText("assessment.dimensionOverview")).toBeInTheDocument();
      
      // Check for dimension name keys from i18n
      expect(screen.getByText("assessment.dimensions.VIT.name")).toBeInTheDocument();
      expect(screen.getByText("assessment.dimensions.ENE.name")).toBeInTheDocument();
      expect(screen.getByText("assessment.dimensions.SLP.name")).toBeInTheDocument();
    });

    it("should display dimension scores", () => {
      render(<AssessmentSummary {...defaultProps} />);

      // Look for percentage scores - use getAllByText since there are multiple
      const score80Elements = screen.getAllByText("80%");
      const score70Elements = screen.getAllByText("70%");
      const score60Elements = screen.getAllByText("60%");
      
      expect(score80Elements.length).toBeGreaterThan(0);
      expect(score70Elements.length).toBeGreaterThan(0);
      expect(score60Elements.length).toBeGreaterThan(0);
    });

    it("should show dimension icons", () => {
      render(<AssessmentSummary {...defaultProps} />);

      // Check for dimension icons with i18n title keys
      expect(screen.getByTitle("assessment.dimensions.VIT.name")).toBeInTheDocument();
      expect(screen.getByTitle("assessment.dimensions.ENE.name")).toBeInTheDocument();
      expect(screen.getByTitle("assessment.dimensions.SLP.name")).toBeInTheDocument();
    });
  });

  describe("Priority Areas", () => {
    it("should display priority areas for improvement", () => {
      const score = createMockScore({
        dimensions: [
          { dimension: "VIT" as Dimension, rawScore: 3, normalizedScore: 30, tagCount: 1, hasNegativeIndicators: true, operationalFlags: [] },
          { dimension: "ENE" as Dimension, rawScore: 4, normalizedScore: 40, tagCount: 1, hasNegativeIndicators: false, operationalFlags: [] },
          ...createMockScore().dimensions.slice(2),
        ],
        alertFlags: ["VIT", "ENE"],
      });

      render(<AssessmentSummary {...defaultProps} score={score} />);

      expect(screen.getByText("assessment.priorityAreasForImprovement")).toBeInTheDocument();
    });

    it("should not display priority section when all dimensions are good", () => {
      render(<AssessmentSummary {...defaultProps} />);

      expect(screen.queryByText("assessment.priorityAreasForImprovement")).not.toBeInTheDocument();
    });
  });

  describe("Critical Flags", () => {
    it("should display critical alert for very low scores", () => {
      const score = createMockScore({
        dimensions: [
          { dimension: "VIT" as Dimension, rawScore: 1, normalizedScore: 10, tagCount: 1, hasNegativeIndicators: true, operationalFlags: ["low_vit"] },
          ...createMockScore().dimensions.slice(1),
        ],
      });

      render(<AssessmentSummary {...defaultProps} score={score} />);

      expect(screen.getByText("assessment.medicalConsultationRecommendation")).toBeInTheDocument();
    });

    it("should display critical alert for multiple operational flags", () => {
      const score = createMockScore({
        dimensions: [
          { dimension: "VIT" as Dimension, rawScore: 5, normalizedScore: 50, tagCount: 5, hasNegativeIndicators: false, operationalFlags: ["flag1", "flag2", "flag3"] },
          ...createMockScore().dimensions.slice(1),
        ],
      });

      render(<AssessmentSummary {...defaultProps} score={score} />);

      expect(screen.getByText("assessment.medicalConsultationRecommendation")).toBeInTheDocument();
    });
  });

  describe("Assessment Date", () => {
    it("should display the assessment date", () => {
      render(<AssessmentSummary {...defaultProps} />);

      // i18n key for date label
      expect(screen.getByText(/assessment\.assessmentDate/)).toBeInTheDocument();
    });
  });

  describe("Action Buttons", () => {
    it("should display retake button when showActions is true", () => {
      render(<AssessmentSummary {...defaultProps} />);

      expect(screen.getByRole("button", { name: "assessment.retakeAssessment" })).toBeInTheDocument();
    });

    it("should display continue button when showActions is true", () => {
      render(<AssessmentSummary {...defaultProps} />);

      expect(screen.getByRole("button", { name: "common.continue" })).toBeInTheDocument();
    });

    it("should call onRetake when retake button clicked", async () => {
      const user = userEvent.setup();
      render(<AssessmentSummary {...defaultProps} />);

      await user.click(screen.getByRole("button", { name: "assessment.retakeAssessment" }));

      expect(defaultProps.onRetake).toHaveBeenCalled();
    });

    it("should call onContinue when continue button clicked", async () => {
      const user = userEvent.setup();
      render(<AssessmentSummary {...defaultProps} />);

      await user.click(screen.getByRole("button", { name: "common.continue" }));

      expect(defaultProps.onContinue).toHaveBeenCalled();
    });

    it("should hide action buttons when showActions is false", () => {
      render(<AssessmentSummary {...defaultProps} showActions={false} />);

      expect(screen.queryByRole("button", { name: "assessment.retakeAssessment" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "common.continue" })).not.toBeInTheDocument();
    });

    it("should hide retake button when onRetake is not provided", () => {
      render(<AssessmentSummary {...defaultProps} onRetake={undefined} />);

      expect(screen.queryByRole("button", { name: "assessment.retakeAssessment" })).not.toBeInTheDocument();
    });

    it("should hide continue button when onContinue is not provided", () => {
      render(<AssessmentSummary {...defaultProps} onContinue={undefined} />);

      expect(screen.queryByRole("button", { name: "common.continue" })).not.toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    it("should have proper heading structure", () => {
      render(<AssessmentSummary {...defaultProps} />);

      // Main title (i18n key)
      expect(screen.getByText("assessment.yourLongevityScore")).toBeInTheDocument();
      // Dimension section title (i18n key)
      expect(screen.getByText("assessment.dimensionOverview")).toBeInTheDocument();
    });

    it("should have title attributes for icons", () => {
      render(<AssessmentSummary {...defaultProps} />);

      // Dimension icons should have title for accessibility (i18n key pattern)
      const icons = screen.getAllByTitle(/assessment\.dimensions\.(VIT|ENE|SLP|PHY|MET|IMM|PSY|COG|MOO)\.name/);
      expect(icons.length).toBeGreaterThan(0);
    });
  });
});
