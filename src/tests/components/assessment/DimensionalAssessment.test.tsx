/**
 * DimensionalAssessment Component Tests
 * 
 * Tests for the multi-step assessment UI including:
 * - Rendering and initial state
 * - Navigation between dimensions
 * - Tag selection (intensity, symptoms)
 * - Score calculation preview
 * - Completion callback
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DimensionalAssessment } from "@/components/assessment/DimensionalAssessment";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

// Mock translations
vi.mock("react-i18next", async () => {
  const actual = await vi.importActual("react-i18next");
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, params?: Record<string, unknown>) => {
        if (params) {
          return `${key}:${JSON.stringify(params)}`;
        }
        return key;
      },
      i18n: { language: "cs" },
    }),
  };
});

describe("DimensionalAssessment", () => {
  const defaultProps = {
    onComplete: vi.fn(),
    onCancel: vi.fn(),
    onSkip: vi.fn(),
    showSkipButton: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("should render the assessment form", () => {
      render(<DimensionalAssessment {...defaultProps} />);

      // Should show step indicator
      expect(screen.getByText(/assessment\.step/)).toBeInTheDocument();
      // Should show progress
      expect(screen.getByText(/assessment\.completed/)).toBeInTheDocument();
    });

    it("should start at step 0 (VIT dimension)", () => {
      render(<DimensionalAssessment {...defaultProps} />);

      // First dimension is VIT - check for intensity selector
      // The exact content depends on IntensitySelector component
      expect(screen.getByText(/assessment\.step.*"current":1/)).toBeInTheDocument();
    });

    it("should render navigation buttons", () => {
      render(<DimensionalAssessment {...defaultProps} />);

      expect(screen.getByRole("button", { name: "assessment.cancel" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /assessment\.next/ })).toBeInTheDocument();
    });

    it("should not show back button on first step", () => {
      render(<DimensionalAssessment {...defaultProps} />);

      expect(screen.queryByRole("button", { name: /assessment\.back/ })).not.toBeInTheDocument();
    });

    it("should initialize with provided initial state", () => {
      const initialState = {
        currentStep: 2,
        selectedTags: {
          VIT: ["vit_excellent"],
          ENE: ["ene_high"],
          SLP: [],
          PHY: [],
          MET: [],
          IMM: [],
          PSY: [],
          COG: [],
          MOO: [],
        },
        conditionalAnswers: {},
        startedAt: new Date(),
        lastInteractionAt: new Date(),
      };

      render(<DimensionalAssessment {...defaultProps} initialState={initialState} />);

      // Should be on step 3 (index 2)
      expect(screen.getByText(/assessment\.step.*"current":3/)).toBeInTheDocument();
    });
  });

  describe("Navigation", () => {
    it("should show back button after navigating forward", async () => {
      const user = userEvent.setup();
      render(<DimensionalAssessment {...defaultProps} />);

      // Select intensity first (required) - look for radio buttons
      const intensityRadios = screen.getAllByRole("radio");
      
      // Click the first intensity option (highest score)
      if (intensityRadios.length > 0) {
        await user.click(intensityRadios[0]);
      }

      // Click next
      await user.click(screen.getByRole("button", { name: /assessment\.next/ }));

      // Back button should now be visible
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /assessment\.back/ })).toBeInTheDocument();
      });
    });

    it("should call onCancel when cancel button clicked", async () => {
      const user = userEvent.setup();
      render(<DimensionalAssessment {...defaultProps} />);

      await user.click(screen.getByRole("button", { name: "assessment.cancel" }));

      expect(defaultProps.onCancel).toHaveBeenCalled();
    });

    it("should disable next button when no intensity selected", () => {
      render(<DimensionalAssessment {...defaultProps} />);

      const nextButton = screen.getByRole("button", { name: /assessment\.next/ });
      expect(nextButton).toBeDisabled();
    });
  });

  describe("Score Preview", () => {
    it("should not show score preview on first step", () => {
      render(<DimensionalAssessment {...defaultProps} />);

      expect(screen.queryByText(/assessment\.currentScore/)).not.toBeInTheDocument();
    });
  });

  describe("Completion", () => {
    it("should show finish button on last step", async () => {
      const user = userEvent.setup();
      
      // Start at last step
      const initialState = {
        currentStep: 8, // MOO - last dimension
        selectedTags: {
          VIT: ["vit_excellent"],
          ENE: ["ene_high"],
          SLP: ["slp_excellent"],
          PHY: ["phy_excellent"],
          MET: ["met_excellent"],
          IMM: ["imm_excellent"],
          PSY: ["psy_excellent"],
          COG: ["cog_excellent"],
          MOO: [], // Empty - needs selection
        },
        conditionalAnswers: {},
        startedAt: new Date(),
        lastInteractionAt: new Date(),
      };

      render(<DimensionalAssessment {...defaultProps} initialState={initialState} />);

      // Should show finish button
      expect(screen.getByRole("button", { name: /assessment\.finish/ })).toBeInTheDocument();
    });

    it("should call onComplete with score when finished", async () => {
      const user = userEvent.setup();
      
      // Start at last step with MOO selected
      const initialState = {
        currentStep: 8,
        selectedTags: {
          VIT: ["vit_excellent"],
          ENE: ["ene_high"],
          SLP: ["slp_excellent"],
          PHY: ["phy_excellent"],
          MET: ["met_excellent"],
          IMM: ["imm_excellent"],
          PSY: ["psy_excellent"],
          COG: ["cog_excellent"],
          MOO: ["moo_excellent"], // Pre-selected
        },
        conditionalAnswers: {},
        startedAt: new Date(),
        lastInteractionAt: new Date(),
      };

      render(<DimensionalAssessment {...defaultProps} initialState={initialState} />);

      // Click finish
      await user.click(screen.getByRole("button", { name: /assessment\.finish/ }));

      // onComplete should be called with score
      expect(defaultProps.onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          overall: expect.any(Number),
          dimensions: expect.any(Array),
          interpretation: expect.any(String),
        }),
        expect.any(Object) // selectedTags
      );
    });
  });

  describe("Accessibility", () => {
    it("should have proper button roles", () => {
      render(<DimensionalAssessment {...defaultProps} />);

      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(0);
    });

    it("should show progress indicator", () => {
      render(<DimensionalAssessment {...defaultProps} />);

      // Progress bar should be present
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });
  });
});
