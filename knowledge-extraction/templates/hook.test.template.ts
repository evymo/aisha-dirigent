/**
 * ŠABLONA: Hook Unit Test
 *
 * Zkopíruj a přizpůsob pro každý nový hook.
 *
 * WORKFLOW:
 * 1. Přečti implementaci hooku PŘED psaním testu
 * 2. Zjisti: Jak hook volá API? (apiClient.get? supabase.rpc? fetch?)
 * 3. Mockuj PŘESNĚ ten způsob volání
 * 4. Spusť: npm run test:run -- src/tests/hooks/use[Feature].test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// ============================================================
// KROK 1: Import hooku
// ============================================================
import { useFeature, type FeatureItem } from "@/hooks/useFeature";

// ============================================================
// KROK 2: Mock PŘESNĚ způsob volání API
// (zkontroluj implementaci hooku!)
// ============================================================
import { apiClient } from "@/lib/api/client";
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string
    ) {
      super(`${status}: ${code}`);
    }
  },
}));

// ============================================================
// KROK 3: Mock session (auth guard)
// ============================================================
const mockUser = { id: "test-user-id" };
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({ user: mockUser }),
}));

// ============================================================
// KROK 4: Test wrapper s QueryClient
// ============================================================
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

function createTestWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function TestWrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

// ============================================================
// MOCK DATA — odpovídá validnímu Zod schématu hooku
// ============================================================
const mockItem: FeatureItem = {
  id: "00000000-0000-0000-0000-000000000001",
  title: "Test Item",
  // ... doplnit dle FeatureItem interface
};

// ============================================================
// TESTY
// ============================================================
describe("useFeature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ----------------------------------------------------------
  // Happy path
  // ----------------------------------------------------------
  it("returns data on successful API response", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [mockItem] });

    const { result } = renderHook(() => useFeature(), {
      wrapper: createTestWrapper(),
    });

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    // After fetch
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toEqual(mockItem);

    // Ověř správný API volání
    expect(vi.mocked(apiClient.get)).toHaveBeenCalledWith(
      "/feature",
      expect.objectContaining({ params: expect.any(Object) })
    );
  });

  // ----------------------------------------------------------
  // Error path
  // ----------------------------------------------------------
  it("handles API error gracefully", async () => {
    vi.mocked(apiClient.get).mockRejectedValue(
      new Error("Network error") // nebo new ApiError(500, "server_error")
    );

    const { result } = renderHook(() => useFeature(), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();

    // Ověř: žádná sensitive data/citlivá data v error message
    // (pokud hook loguje, zkontroluj safeError)
  });

  // ----------------------------------------------------------
  // Empty state
  // ----------------------------------------------------------
  it("returns empty array when API returns no items", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });

    const { result } = renderHook(() => useFeature(), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  // ----------------------------------------------------------
  // Invalid data (safeParse / Zod)
  // ----------------------------------------------------------
  it("handles invalid API response data without crashing", async () => {
    // ⚠️ KRITICKÉ: Pokud hook používá safeParse, nevalidní data tiše zmizí
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [{ wrong_field: "invalid" }], // neodpovídá schématu
    });

    const { result } = renderHook(() => useFeature(), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // safeParse: vrátí []
    // parse (strict): vrátí isError: true
    // Uprav dle implementace hooku:
    expect(result.current.data).toBeDefined();
  });

  // ----------------------------------------------------------
  // Disabled state (bez usera, bez oprávnění)
  // ----------------------------------------------------------
  it("does not fetch when user is not authenticated", async () => {
    vi.doMock("@/hooks/useSession", () => ({
      useSession: () => ({ user: null }),
    }));

    const { result } = renderHook(() => useFeature(), {
      wrapper: createTestWrapper(),
    });

    // refetchOnMount=false, isFetching by mělo být false
    expect(result.current.isFetching).toBe(false);
    expect(vi.mocked(apiClient.get)).not.toHaveBeenCalled();

    vi.doMock("@/hooks/useSession", () => ({
      useSession: () => ({ user: mockUser }),
    }));
  });

  // ----------------------------------------------------------
  // Options / parametry
  // ----------------------------------------------------------
  it("passes filter option to API call", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });

    const { result } = renderHook(
      () => useFeature({ filter: "active", limit: 10 }),
      { wrapper: createTestWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(vi.mocked(apiClient.get)).toHaveBeenCalledWith(
      "/feature",
      expect.objectContaining({
        params: expect.objectContaining({
          filter: "active",
          limit: 10,
        }),
      })
    );
  });
});

// ============================================================
// ŠABLONA: Mutation Test (useCreateFeature)
// ============================================================
/*
describe("useCreateFeature", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates item and invalidates cache", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: mockItem });

    const { result } = renderHook(() => useCreateFeature(), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      result.current.mutate({ title: "New Item" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockItem);
    expect(vi.mocked(apiClient.post)).toHaveBeenCalledWith(
      "/feature",
      expect.objectContaining({ title: "New Item" })
    );
  });

  it("handles creation error safely", async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new ApiError(422, "validation_failed"));

    const { result } = renderHook(() => useCreateFeature(), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      result.current.mutate({ title: "" }); // nevalidní
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
*/
