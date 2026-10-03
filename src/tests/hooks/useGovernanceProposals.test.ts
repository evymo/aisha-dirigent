import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useGovernanceProposals, useGovernanceVote } from "@/hooks/useGovernanceProposals";

// Hoisted mocks
const hoisted = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockInvoke: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: { functions: { invoke: hoisted.mockInvoke } },
}));

// Mock global fetch for Cosmos REST API calls
const originalFetch = globalThis.fetch;

// Polyfill AbortSignal.timeout for test environments (happy-dom)
if (typeof AbortSignal.timeout !== "function") {
  AbortSignal.timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("TimeoutError", "TimeoutError")), ms);
    return controller.signal;
  };
}

beforeEach(() => {
  globalThis.fetch = hoisted.mockFetch;
  hoisted.mockFetch.mockReset();
  hoisted.mockInvoke.mockReset();
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

const mockProposal = {
  id: "1",
  title: "Community allocation increase",
  summary: "Increase allocation by 10%",
  status: "PROPOSAL_STATUS_VOTING_PERIOD",
  voting_start_time: "2026-04-01T00:00:00Z",
  voting_end_time: "2026-04-03T00:00:00Z",
  total_deposit: "10000000",
};

describe("useGovernanceProposals", () => {
  it("fetches and parses proposals from Cosmos REST API", async () => {
    hoisted.mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ proposals: [mockProposal] }),
    });

    const { result } = renderHook(() => useGovernanceProposals(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].id).toBe("1");
    expect(result.current.data![0].title).toBe("Community allocation increase");
  });

  it("returns empty array on API failure", async () => {
    hoisted.mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
    });

    const { result } = renderHook(() => useGovernanceProposals(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("filters proposals by status", async () => {
    hoisted.mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ proposals: [mockProposal] }),
    });

    renderHook(() => useGovernanceProposals("PROPOSAL_STATUS_PASSED"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(hoisted.mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("proposal_status=PROPOSAL_STATUS_PASSED"),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it("skips invalid proposals via safeParse", async () => {
    hoisted.mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        proposals: [mockProposal, { invalid: true }],
      }),
    });

    const { result } = renderHook(() => useGovernanceProposals(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });
});

describe("useGovernanceVote", () => {
  it("invokes governance-vote edge function", async () => {
    hoisted.mockInvoke.mockResolvedValue({
      data: { tx_hash: "ABCDEF1234567890ABCDEF1234567890" },
      error: null,
    });

    const { result } = renderHook(() => useGovernanceVote(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      proposalId: "1",
      option: "VOTE_OPTION_YES",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hoisted.mockInvoke).toHaveBeenCalledWith("governance-vote", {
      body: { proposal_id: "1", vote_option: "VOTE_OPTION_YES" },
    });
  });
});
