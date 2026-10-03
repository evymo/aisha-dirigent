/**
 * Tests for useImprovementProposals hook.
 *
 * @module tests/hooks/useImprovementProposals
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: mockRpc },
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return function W({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: "u-1" },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: (p: string) => p === "view_admin_dashboard",
  }),
}));

vi.mock("@/hooks/useAdminGuard", () => ({
  useAdminGuard: () => ({
    guardAdminMutation: (_name: string, fn: unknown) => fn,
  }),
}));

import {
  useImprovementProposals,
  useCreateImprovementProposal,
  useApproveImprovementProposal,
  useRejectImprovementProposal,
} from "@/hooks/useImprovementProposals";

const MOCK_PROPOSAL = {
  agent_slug: "librarian",
  anomaly_key: null,
  applied_at: null,
  category: "model",
  created_at: "2026-04-18T13:00:00Z",
  current_value: null,
  description: "Test proposal",
  id: "00000000-0000-0000-0000-000000000001",
  metadata: null,
  priority: 50,
  proposal_type: "model_upgrade",
  proposed_value: { model: "gpt-4" },
  review_note: null,
  reviewed_at: null,
  reviewed_by: null,
  risk_level: "low",
  status: "pending",
  title: "Upgrade model",
  updated_at: "2026-04-18T13:00:00Z",
};

describe("useImprovementProposals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches proposals via list_improvement_proposals_admin", async () => {
    mockRpc.mockResolvedValueOnce({ data: [MOCK_PROPOSAL], error: null });

    const { result } = renderHook(() => useImprovementProposals(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].agent_slug).toBe("librarian");
    expect(mockRpc).toHaveBeenCalledWith("list_improvement_proposals_admin", {
      p_agent_slug: undefined,
      p_limit: 100,
      p_status: undefined,
    });
  });

  it("passes agent_slug and status filters", async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const { result } = renderHook(
      () => useImprovementProposals("dirigent", "approved"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("list_improvement_proposals_admin", {
      p_agent_slug: "dirigent",
      p_limit: 100,
      p_status: "approved",
    });
  });

  it("handles RPC error gracefully", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "DB error" },
    });

    const { result } = renderHook(() => useImprovementProposals(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useCreateImprovementProposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls fn_create_improvement_proposal RPC", async () => {
    mockRpc.mockResolvedValueOnce({ data: { id: "new-id" }, error: null });

    const { result } = renderHook(() => useCreateImprovementProposal(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      agentSlug: "librarian",
      title: "New proposal",
    });

    expect(mockRpc).toHaveBeenCalledWith("fn_create_improvement_proposal", {
      p_agent_slug: "librarian",
      p_category: undefined,
      p_description: undefined,
      p_metadata: null,
      p_title: "New proposal",
    });
  });
});

describe("useApproveImprovementProposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls approve_improvement_proposal_admin RPC", async () => {
    mockRpc.mockResolvedValueOnce({ data: "ok", error: null });

    const { result } = renderHook(() => useApproveImprovementProposal(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      proposalId: "00000000-0000-0000-0000-000000000001",
      reviewNote: "Looks good",
      autoApply: true,
    });

    expect(mockRpc).toHaveBeenCalledWith("approve_improvement_proposal_admin", {
      p_auto_apply: true,
      p_proposal_id: "00000000-0000-0000-0000-000000000001",
      p_review_note: "Looks good",
    });
  });
});

describe("useRejectImprovementProposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls reject_improvement_proposal_admin RPC", async () => {
    mockRpc.mockResolvedValueOnce({ data: "ok", error: null });

    const { result } = renderHook(() => useRejectImprovementProposal(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      proposalId: "00000000-0000-0000-0000-000000000001",
      reviewNote: "Not needed",
    });

    expect(mockRpc).toHaveBeenCalledWith("reject_improvement_proposal_admin", {
      p_proposal_id: "00000000-0000-0000-0000-000000000001",
      p_review_note: "Not needed",
    });
  });
});
