/**
 * Tests for CitationPanel (Step 2 UI).
 *
 * Renders the Accordion-style expand/collapse, empty state, and per-row
 * structure (title link + contextual_prefix + chunk_text + weight badge).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, render, fireEvent } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { CitationPanel } from "@/components/chat/CitationPanel";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const mockUseRunCitations = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useRunCitations", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useRunCitations")>("@/hooks/useRunCitations");
  return {
    ...actual,
    useRunCitations: mockUseRunCitations,
  };
});

function createI18n() {
  if (!i18n.isInitialized) {
    i18n.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: {
        en: {
          translation: {
            rag: {
              citations: {
                panelTitle: "Sources used",
                empty: "No citations recorded for this response",
                toggleShow: "Show sources",
                toggleHide: "Hide sources",
                openItem: "Open source",
                weight: "Weight {{value}}",
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

function renderPanel(props: Parameters<typeof CitationPanel>[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={createI18n()}>
          <CitationPanel {...props} />
        </I18nextProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockUseRunCitations.mockReset();
});

const SAMPLE_CITATIONS = [
  {
    chunk_id: "11111111-1111-1111-1111-111111111111",
    chunk_index: 0,
    chunk_text: "SECURITY DEFINER functions must SET search_path TO public.",
    contextual_prefix: "Excerpt from AISHA Development Laws on RPC security.",
    item_id: "22222222-2222-2222-2222-222222222222",
    item_title: "AISHA Development Laws",
    item_type: "rule",
    section_title: "RPC security",
    story_id: null,
    relevance_score: 0.92,
    attribution_weight: 0.87,
    usage_intensity: "high",
  },
  {
    chunk_id: "33333333-3333-3333-3333-333333333333",
    chunk_index: 1,
    chunk_text: "Audit journal entries must use typed JSONB metadata.",
    contextual_prefix: null,
    item_id: "44444444-4444-4444-4444-444444444444",
    item_title: "Audit Pattern",
    item_type: "rule",
    section_title: null,
    story_id: null,
    relevance_score: 0.81,
    attribution_weight: 0.72,
    usage_intensity: "medium",
  },
];

describe("CitationPanel", () => {
  it("renders nothing when runId is null", () => {
    mockUseRunCitations.mockReturnValue({ data: [], isLoading: false });
    const { container } = renderPanel({ runId: null });
    expect(container.firstChild).toBeNull();
  });

  it("renders trigger with localized panel title when collapsed", () => {
    mockUseRunCitations.mockReturnValue({
      data: SAMPLE_CITATIONS,
      isLoading: false,
    });
    renderPanel({ runId: "00000000-0000-0000-0000-000000000001" });
    expect(screen.getByText("Sources used")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // count badge
  });

  it("renders empty hint when no citations and not loading", () => {
    mockUseRunCitations.mockReturnValue({ data: [], isLoading: false });
    renderPanel({ runId: "00000000-0000-0000-0000-000000000001" });
    // Expand the accordion to see the empty state
    fireEvent.click(screen.getByText("Sources used"));
    expect(
      screen.getByText("No citations recorded for this response"),
    ).toBeInTheDocument();
  });

  it("renders chunk text, title link, prefix, and weight when expanded", () => {
    mockUseRunCitations.mockReturnValue({
      data: SAMPLE_CITATIONS,
      isLoading: false,
    });
    renderPanel({ runId: "00000000-0000-0000-0000-000000000001" });
    fireEvent.click(screen.getByText("Sources used"));

    // Title link
    const link = screen.getByRole("link", { name: /AISHA Development Laws/i });
    expect(link).toHaveAttribute("href", "/knowledge/22222222-2222-2222-2222-222222222222");

    // Contextual prefix (Step 1 output) shown
    expect(
      screen.getByText("Excerpt from AISHA Development Laws on RPC security."),
    ).toBeInTheDocument();

    // Section title shown when present
    expect(screen.getByText("RPC security")).toBeInTheDocument();

    // Chunk text shown
    expect(
      screen.getByText("SECURITY DEFINER functions must SET search_path TO public."),
    ).toBeInTheDocument();

    // Weight badge shown
    expect(screen.getByText("Weight 0.87")).toBeInTheDocument();
    expect(screen.getByText("Weight 0.72")).toBeInTheDocument();
  });

  it("hides count badge while loading", () => {
    mockUseRunCitations.mockReturnValue({ data: undefined, isLoading: true });
    renderPanel({ runId: "00000000-0000-0000-0000-000000000001" });
    // No numeric count badge until isLoading=false
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
  });
});
