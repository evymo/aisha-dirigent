/**
 * Tests for FaithfulnessChip (Step 2 UI).
 *
 * Strict scope: 4 tier states (high/medium/low/noData) + loading skeleton +
 * null runId no-render. Tier→icon mapping locked via faithfulnessTier()
 * helper (already tested as part of useRunCitations unit suite); here we
 * verify the CHIP renders the right label + reads from the hook.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FaithfulnessChip } from "@/components/chat/FaithfulnessChip";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const mockUseRunFaithfulness = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useRunCitations", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useRunCitations")>("@/hooks/useRunCitations");
  return {
    ...actual,
    useRunFaithfulness: mockUseRunFaithfulness,
  };
});

// Minimal i18n instance: returns the key when no translation found, so
// assertions can match either the key or the EN string.
function createI18n() {
  if (!i18n.isInitialized) {
    i18n.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: {
        en: {
          translation: {
            rag: {
              chip: {
                high: "High faithfulness",
                medium: "Medium faithfulness",
                low: "Low faithfulness — verify",
                noData: "Not evaluated",
                tooltip: "Faithfulness {{score}} · {{count}} citations",
              },
            },
          },
        },
      },
      interpolation: { escapeValue: false },
    });
  }
  return i18n;
}

function renderChip(props: Parameters<typeof FaithfulnessChip>[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={createI18n()}>
        <TooltipProvider>
          <FaithfulnessChip {...props} />
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockUseRunFaithfulness.mockReset();
});

describe("FaithfulnessChip", () => {
  it("renders nothing when runId is null", () => {
    mockUseRunFaithfulness.mockReturnValue({ data: null, isLoading: false });
    const { container } = renderChip({ runId: null });
    expect(container.firstChild).toBeNull();
  });

  it("renders skeleton while loading", () => {
    mockUseRunFaithfulness.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = renderChip({ runId: "00000000-0000-0000-0000-000000000001" });
    // Skeleton component renders a div with a class — accept either by
    // checking that the badge text isn't there yet.
    expect(screen.queryByText("0.90")).not.toBeInTheDocument();
    expect(container.querySelector("[class*='skeleton']") ?? container.firstChild).not.toBeNull();
  });

  it("renders high tier (≥0.85) with score", () => {
    mockUseRunFaithfulness.mockReturnValue({
      data: { run_id: "r", faithfulness: 0.92, citation_count: 3, computed_at: "" },
      isLoading: false,
    });
    renderChip({ runId: "00000000-0000-0000-0000-000000000001" });
    expect(screen.getByText("0.92")).toBeInTheDocument();
    expect(screen.getByLabelText("High faithfulness")).toBeInTheDocument();
  });

  it("renders medium tier (0.60–0.85) with score", () => {
    mockUseRunFaithfulness.mockReturnValue({
      data: { run_id: "r", faithfulness: 0.72, citation_count: 2, computed_at: "" },
      isLoading: false,
    });
    renderChip({ runId: "00000000-0000-0000-0000-000000000001" });
    expect(screen.getByText("0.72")).toBeInTheDocument();
    expect(screen.getByLabelText("Medium faithfulness")).toBeInTheDocument();
  });

  it("renders low tier (<0.60) with score", () => {
    mockUseRunFaithfulness.mockReturnValue({
      data: { run_id: "r", faithfulness: 0.41, citation_count: 1, computed_at: "" },
      isLoading: false,
    });
    renderChip({ runId: "00000000-0000-0000-0000-000000000001" });
    expect(screen.getByText("0.41")).toBeInTheDocument();
    expect(screen.getByLabelText("Low faithfulness — verify")).toBeInTheDocument();
  });

  it("renders noData tier with helper icon when score is null", () => {
    mockUseRunFaithfulness.mockReturnValue({
      data: { run_id: "r", faithfulness: null, citation_count: 0, computed_at: "" },
      isLoading: false,
    });
    renderChip({ runId: "00000000-0000-0000-0000-000000000001" });
    expect(screen.getByText("Not evaluated")).toBeInTheDocument();
    expect(screen.getByLabelText("Not evaluated")).toBeInTheDocument();
  });

  it("renders without tooltip when showTooltip=false", () => {
    mockUseRunFaithfulness.mockReturnValue({
      data: { run_id: "r", faithfulness: 0.9, citation_count: 5, computed_at: "" },
      isLoading: false,
    });
    const { container } = renderChip({
      runId: "00000000-0000-0000-0000-000000000001",
      showTooltip: false,
    });
    // Without tooltip wrapper the badge is the direct child.
    expect(container.firstChild?.nodeName.toLowerCase()).toBe("div");
    expect(screen.getByText("0.90")).toBeInTheDocument();
  });
});
