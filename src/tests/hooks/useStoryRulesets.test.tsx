/**
 * useStoryRulesets Hook Tests
 *
 * Covers the per-story ruleset binding lookup (get_story_rulesets RPC).
 *
 * @see src/hooks/useStoryRulesets.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useStoryRulesets } from "@/hooks/useStoryRulesets";

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  safeErrorMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: { rpc: (...args: unknown[]) => hoisted.rpcMock(...args) },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return {
    ...mod,
    safeError: (...args: unknown[]) => hoisted.safeErrorMock(...args),
  };
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const STORY_ID = "22222222-2222-2222-2222-222222222222";
const RULESET_ID = "33333333-3333-3333-3333-333333333333";
const RULE_ID_A = "44444444-4444-4444-4444-444444444444";
const RULE_ID_B = "55555555-5555-5555-5555-555555555555";

const MOCK_RULESETS = [
  {
    ruleset_id: RULESET_ID,
    ruleset_fingerprint: "fingerprint-abc-123",
    context_profile: "repo_plus_rules",
    created_at: "2026-05-18T12:00:00Z",
    created_by: "aisha",
    rule_count: 2,
    rules: [
      {
        rule_id: RULE_ID_A,
        slug: "rule-foo",
        title: "Rule Foo",
        summary: "Foo rule summary",
        category: "design",
        status: "published",
        current_version: 3,
        used_version: 2,
        is_default: true,
      },
      {
        rule_id: RULE_ID_B,
        slug: "rule-bar",
        title: "Rule Bar",
        summary: null,
        category: "compliance",
        status: "published",
        current_version: 1,
        used_version: 1,
        is_default: false,
      },
    ],
  },
];

describe("useStoryRulesets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed rows with nested rules", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: MOCK_RULESETS, error: null });

    const { result } = renderHook(
      () => useStoryRulesets({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].rules).toHaveLength(2);
    expect(result.current.data?.[0].rules[0].is_default).toBe(true);
    expect(result.current.data?.[0].rules[1].used_version).toBe(1);
  });

  it("calls RPC with p_story_id", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    renderHook(() => useStoryRulesets({ storyId: STORY_ID }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(hoisted.rpcMock).toHaveBeenCalled());
    expect(hoisted.rpcMock).toHaveBeenCalledWith("get_story_rulesets", {
      p_story_id: STORY_ID,
    });
  });

  it("does not call RPC when storyId is null", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    renderHook(() => useStoryRulesets({ storyId: null }), {
      wrapper: createWrapper(),
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it("handles empty array (story has no ruleset bindings yet)", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(
      () => useStoryRulesets({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("surfaces RPC errors and logs via safeError", async () => {
    const rpcError = { message: "Access denied", code: "42501" };
    hoisted.rpcMock.mockResolvedValue({ data: null, error: rpcError });

    const { result } = renderHook(
      () => useStoryRulesets({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "useStoryRulesets",
      rpcError,
    );
  });

  it("rejects malformed RPC response via Zod (missing rules field)", async () => {
    const malformed = [
      {
        ruleset_id: RULESET_ID,
        ruleset_fingerprint: "x",
        context_profile: "repo_plus_rules",
        created_at: "2026-05-18T12:00:00Z",
        created_by: "aisha",
        rule_count: 0,
        // rules: missing → Zod rejects
      },
    ];
    hoisted.rpcMock.mockResolvedValue({ data: malformed, error: null });

    const { result } = renderHook(
      () => useStoryRulesets({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
