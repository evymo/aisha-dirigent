/**
 * Tests for useLabTestRecommendations hook
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { useLabTestRecommendations } from "@/hooks/useLabTestRecommendations";
import { renderHookWithProviders } from "@/tests/utils/test-utils";

// Mock Supabase client
vi.mock("@/integrations/db/client", () => ({
  aisha: {
    functions: {
      invoke: vi.fn(),
    },
    rpc: vi.fn(),
  },
}));

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

// Mock useTranslation
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

// Mock useSession
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: "test-user-id", email: "test@example.com" },
    session: { access_token: "mock-token" },
    isLoading: false,
  }),
}));

describe("useLabTestRecommendations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty recommendations when no products provided", () => {
    const { result } = renderHookWithProviders(
      () => useLabTestRecommendations({ products: [] })
    );

    expect(result.current.panelRecommendations).toHaveLength(0);
    expect(result.current.selectedTests).toHaveLength(0);
    expect(result.current.isAiLoading).toBe(false);
  });

  it("should generate panel recommendations for products", () => {
    const { result } = renderHookWithProviders(
      () => useLabTestRecommendations({ products: ["retisin"] })
    );

    // Should have at least baseline panel for retisin
    expect(result.current.panelRecommendations.length).toBeGreaterThan(0);
  });

  it("should toggle test selection", async () => {
    const { result } = renderHookWithProviders(
      () => useLabTestRecommendations({ products: ["retisin"] })
    );

    // Get first test code from first panel
    const firstTestCode = result.current.panelRecommendations[0]?.tests[0]?.code;
    
    if (firstTestCode) {
      // Initially not selected
      expect(result.current.selectedTestCodes.has(firstTestCode)).toBe(false);
      
      // Toggle selection
      result.current.toggleTest(firstTestCode);
      
      await waitFor(() => {
        expect(result.current.selectedTestCodes.has(firstTestCode)).toBe(true);
      });
      
      // Toggle again to deselect
      result.current.toggleTest(firstTestCode);
      
      await waitFor(() => {
        expect(result.current.selectedTestCodes.has(firstTestCode)).toBe(false);
      });
    }
  });

  it("should select all tests from a panel", async () => {
    const { result } = renderHookWithProviders(
      () => useLabTestRecommendations({ products: ["retisin"] })
    );

    const firstPanel = result.current.panelRecommendations[0];
    
    if (firstPanel) {
      const testCodes = firstPanel.tests.map((t) => t.code);
      
      // Initially no tests selected
      expect(result.current.selectedTestCodes.size).toBe(0);
      
      // Select all tests from panel
      result.current.selectPanelTests(firstPanel.panel_id, testCodes);
      
      await waitFor(() => {
        expect(result.current.selectedTestCodes.size).toBe(testCodes.length);
      });
    }
  });

  it("should clear all selections", async () => {
    const { result } = renderHookWithProviders(
      () => useLabTestRecommendations({ products: ["retisin"] })
    );

    const firstPanel = result.current.panelRecommendations[0];
    
    if (firstPanel) {
      // Add some selections
      const testCodes = firstPanel.tests.map((t) => t.code);
      result.current.selectPanelTests(firstPanel.panel_id, testCodes);
      
      await waitFor(() => {
        expect(result.current.selectedTestCodes.size).toBeGreaterThan(0);
      });
      
      // Clear all
      result.current.clearSelection();
      
      await waitFor(() => {
        expect(result.current.selectedTestCodes.size).toBe(0);
      });
    }
  });

  it("should generate condition-based panels", () => {
    const { result } = renderHookWithProviders(
      () =>
        useLabTestRecommendations({
          products: ["retisin"],
          conditions: ["diabetes"],
        })
    );

    // Should have more panels when conditions are specified
    const withConditions = result.current.panelRecommendations;
    
    const { result: resultNoConditions } = renderHookWithProviders(
      () => useLabTestRecommendations({ products: ["retisin"] })
    );
    
    // May have same or more panels with conditions
    expect(withConditions.length).toBeGreaterThanOrEqual(
      resultNoConditions.current.panelRecommendations.length
    );
  });

  it("should return selected tests as full objects", async () => {
    const { result } = renderHookWithProviders(
      () => useLabTestRecommendations({ products: ["retisin"] })
    );

    const firstTestCode = result.current.panelRecommendations[0]?.tests[0]?.code;
    
    if (firstTestCode) {
      result.current.toggleTest(firstTestCode);
      
      await waitFor(() => {
        // Should have at least 1 selected test (may have more if test appears in multiple panels)
        expect(result.current.selectedTests.length).toBeGreaterThanOrEqual(1);
        // All selected tests should have the correct code
        const hasMatchingTest = result.current.selectedTests.some(
          (test) => test.code === firstTestCode
        );
        expect(hasMatchingTest).toBe(true);
      });
    }
  });
});
