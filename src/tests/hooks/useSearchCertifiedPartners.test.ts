import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useSearchCertifiedPartners } from "@/hooks/useSearchCertifiedPartners";

// Create wrapper with QueryClientProvider
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// Mock Supabase RPC
const mockRpc = vi.fn();

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

// Mock safeError
vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return {
    ...actual,
    safeError: vi.fn(),
  };
});

const mockPartners = [
  {
    user_id: "aaaa0000-0000-0000-0000-000000000001",
    display_name: "Jan Novák",
    business_name: "JN Consulting s.r.o.",
    certification_level: "certified_provider",
    avatar_url: null,
  },
  {
    user_id: "aaaa0000-0000-0000-0000-000000000002",
    display_name: "Marie Kolová",
    business_name: null,
    certification_level: "certified_partner",
    avatar_url: "https://example.com/avatar.png",
  },
];

describe("useSearchCertifiedPartners", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("searches certified partners via RPC", async () => {
    mockRpc.mockResolvedValue({ data: mockPartners, error: null });

    const { result } = renderHook(() => useSearchCertifiedPartners("Jan"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("search_certified_partners_audited", {
      p_limit: 20,
      p_search: "Jan",
    });
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].display_name).toBe("Jan Novák");
  });

  it("does not fire query when search query is too short", async () => {
    const { result } = renderHook(() => useSearchCertifiedPartners("J"), {
      wrapper: createWrapper(),
    });

    // Query should be disabled — less than 2 chars
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("does not fire query when explicitly disabled", async () => {
    const { result } = renderHook(
      () => useSearchCertifiedPartners("Jan", { enabled: false }),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("handles RPC error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "Permission denied" } });

    const { result } = renderHook(() => useSearchCertifiedPartners("Jan"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Permission denied");
  });

  it("handles Zod validation failure gracefully", async () => {
    // Invalid data — missing required fields
    mockRpc.mockResolvedValue({
      data: [{ user_id: "not-a-uuid", invalid: true }],
      error: null,
    });

    const { result } = renderHook(() => useSearchCertifiedPartners("test"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // safeParse drops invalid items → returns empty array
    expect(result.current.data).toEqual([]);
  });
});
