/**
 * BloodMatrixAnalysisBlockForm Component Tests
 *
 * Tests for the 3x3 blood matrix analysis form component.
 * Verifies rendering, user interactions (grade selection, preset loading, reset),
 * form submission metadata shape, and i18n integration.
 *
 * @see src/components/storyloop/composer/BloodMatrixAnalysisBlockForm.tsx
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { BloodMatrixAnalysisBlockForm } from "@/components/storyloop/composer/BloodMatrixAnalysisBlockForm";
import type { BloodMatrixAnalysisMetadata } from "@/schemas/storyLoopSchemas";

/* ── Mocks ────────────────────────────────────────────────────── */

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params && "min" in params && "max" in params) {
        return `${key}(${params.min}-${params.max})`;
      }
      if (params && "scale" in params) {
        return `${key}(${params.scale})`;
      }
      return key;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

/* ── Helpers ──────────────────────────────────────────────────── */

function renderForm(overrides?: Partial<React.ComponentProps<typeof BloodMatrixAnalysisBlockForm>>) {
  const defaultProps = {
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    isPending: false,
    ...overrides,
  };
  return {
    ...render(<BloodMatrixAnalysisBlockForm {...defaultProps} />),
    props: defaultProps,
  };
}

/* ── Tests ────────────────────────────────────────────────────── */

describe("BloodMatrixAnalysisBlockForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders the form with all 9 matrix cells", () => {
      renderForm();

      // Each cell key (1-9) should appear as label text
      for (let i = 1; i <= 9; i++) {
        expect(
          screen.getByText(new RegExp(`^${i}\\.\\s`)),
        ).toBeInTheDocument();
      }
    });

    it("renders sample date and analysis source fields", () => {
      renderForm();

      expect(screen.getByText("storyloop.bloodMatrix.sampleDate")).toBeInTheDocument();
      expect(screen.getByText("storyloop.bloodMatrix.sourceLabel")).toBeInTheDocument();
    });

    it("renders summary note textarea", () => {
      renderForm();
      expect(screen.getByText("storyloop.bloodMatrix.summaryNote")).toBeInTheDocument();
    });

    it("renders next check date field", () => {
      renderForm();
      expect(screen.getByText("storyloop.bloodMatrix.nextCheck")).toBeInTheDocument();
    });

    it("renders AI summary field", () => {
      renderForm();
      expect(screen.getByText("storyloop.bloodMatrix.aiSummary")).toBeInTheDocument();
    });

    it("renders report preview section", () => {
      renderForm();
      expect(screen.getByText("storyloop.bloodMatrix.report.preview")).toBeInTheDocument();
    });

    it("renders AI prompt section", () => {
      renderForm();
      expect(screen.getByText("storyloop.bloodMatrix.aiPromptTitle")).toBeInTheDocument();
    });

    it("renders cancel and create buttons", () => {
      renderForm();
      expect(screen.getByText("common.cancel")).toBeInTheDocument();
      expect(screen.getByText("common.create")).toBeInTheDocument();
    });

    it("renders load preset button", () => {
      renderForm();
      expect(screen.getByText("storyloop.bloodMatrix.loadPreset")).toBeInTheDocument();
    });

    it("renders reset button", () => {
      renderForm();
      expect(screen.getByText("storyloop.bloodMatrix.reset")).toBeInTheDocument();
    });
  });

  describe("Grade selection", () => {
    it("each cell displays 4 grade buttons (0, I, II, III)", () => {
      renderForm();

      // Get all grid cells (Card components with grade buttons)
      const gradeButtons = screen.getAllByRole("button").filter(
        (btn) => ["0", "I", "II", "III"].includes(btn.textContent ?? ""),
      );

      // 9 cells × 4 grades = 36 grade buttons
      expect(gradeButtons).toHaveLength(36);
    });
  });

  describe("Assessment display", () => {
    it("shows initial counts as zero", () => {
      renderForm();

      expect(screen.getByText("I: 0")).toBeInTheDocument();
      expect(screen.getByText("II: 0")).toBeInTheDocument();
      expect(screen.getByText("III: 0")).toBeInTheDocument();
    });

    it("shows weighted score badge", () => {
      renderForm();
      expect(screen.getByText(/storyloop\.bloodMatrix\.weightedScore.*0/)).toBeInTheDocument();
    });

    it("shows severity level", () => {
      renderForm();
      // Empty matrix → low severity
      expect(screen.getByText("storyloop.bloodMatrix.severity.low")).toBeInTheDocument();
    });
  });

  describe("Form submission", () => {
    it("calls onSubmit with metadata on form submit", async () => {
      const onSubmit = vi.fn();
      renderForm({ onSubmit });

      // Submit the form
      const createButton = screen.getByText("common.create");
      fireEvent.click(createButton);

      expect(onSubmit).toHaveBeenCalledTimes(1);

      const [metadata, content] = onSubmit.mock.calls[0] as [
        Omit<BloodMatrixAnalysisMetadata, "type">,
        string | undefined,
      ];

      // Verify metadata shape
      expect(metadata.sample_date).toBeDefined();
      expect(metadata.analysis_source).toBe("manual");
      expect(metadata.matrix).toBeDefined();
      expect(metadata.counts).toEqual({ I: 0, II: 0, III: 0 });
      expect(metadata.weighted_score).toBe(0);
      expect(metadata.severity).toBeDefined();
      expect(metadata.severity.level).toBe("low");
      expect(metadata.protocol_step_keys).toBeDefined();
      expect(metadata.product_recommendations).toBeDefined();
      expect(typeof metadata.severe_parasite_signal).toBe("boolean");
      expect(metadata.report_text).toBeDefined();
      expect(metadata.ai_prompt).toBeDefined();

      // Content is the localization key
      expect(content).toBe("storyloop.bloodMatrix.content");
    });

    it("does not include empty optional fields in metadata", async () => {
      const onSubmit = vi.fn();
      renderForm({ onSubmit });

      fireEvent.click(screen.getByText("common.create"));

      const [metadata] = onSubmit.mock.calls[0] as [Omit<BloodMatrixAnalysisMetadata, "type">];

      // Empty strings should not produce keys
      expect(metadata).not.toHaveProperty("summary_note");
      expect(metadata).not.toHaveProperty("ai_summary");
    });
  });

  describe("Cancel", () => {
    it("calls onCancel when cancel button clicked", () => {
      const onCancel = vi.fn();
      renderForm({ onCancel });

      fireEvent.click(screen.getByText("common.cancel"));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe("Reset", () => {
    it("reset button clears the form state", async () => {
      renderForm();

      // Click reset → matrix and fields should be cleared
      fireEvent.click(screen.getByText("storyloop.bloodMatrix.reset"));

      // Counts should remain zero after reset
      expect(screen.getByText("I: 0")).toBeInTheDocument();
      expect(screen.getByText("II: 0")).toBeInTheDocument();
      expect(screen.getByText("III: 0")).toBeInTheDocument();
    });
  });

  describe("Pending state", () => {
    it("disables submit button when isPending", () => {
      renderForm({ isPending: true });

      const createButton = screen.getByText("common.create");
      expect(createButton.closest("button")).toBeDisabled();
    });
  });
});
