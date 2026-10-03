/**
 * Tests for Expert Rules hooks — browse, detail, CRUD, subscribe, rate, story context, agent bindings.
 *
 * @module tests/hooks/useExpertRules
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useExpertRules,
  useExpertRuleDetail,
  useMyContributedRules,
  useMyRuleSubscriptions,
  useStoryKnowledgeContext,
  useCreateExpertRule,
  useUpdateExpertRule,
  usePublishExpertRule,
  useSubscribeToRule,
  useUnsubscribeFromRule,
  useRateExpertRule,
} from "@/hooks/useExpertRules";

// =============================================================================
// Test utilities
// =============================================================================

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// =============================================================================
// Mocks
// =============================================================================

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockUser = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "test@example.com",
};

let mockAuthReturn: {
  user: { id: string; email: string } | null;
  isAuthenticated: boolean;
  loading: boolean;
} = { user: mockUser, isAuthenticated: true, loading: false };

vi.mock("@/hooks/useSession", () => ({
  useSession: vi.fn(() => ({
    user: mockAuthReturn.user,
    session: mockAuthReturn.user ? { user: mockAuthReturn.user } : null,
    isLoading: mockAuthReturn.loading,
    hasRole: vi.fn(),
    roles: [],
    isAdmin: false,
    signOut: vi.fn(),
  })),
}));

const mockToast = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    promise: vi.fn(),
  })
);
vi.mock("sonner", () => ({ toast: mockToast }));

const mockRpcFn = vi.fn();

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => mockRpcFn(...args),
  },
}));

// =============================================================================
// Mock data — matches Zod schemas exactly
// =============================================================================

const mockExpertRules = [
  {
    id: "c0000000-0000-0000-0000-000000000001",
    slug: "react-testing-patterns",
    title: "React Testing Patterns",
    summary: "Best practices for testing React components",
    category: "testing_strategy",
    expertise_area_slug: "frontend-development",
    expertise_area_name_key: "guild.expertise.frontend",
    expertise_area_icon: "Monitor",
    author_partner_id: "b0000000-0000-0000-0000-000000000001",
    author_display_name: "John Expert",
    author_avatar_url: "/avatars/john.jpg",
    author_guild_tier: "master",
    is_verified: true,
    subscriber_count: 42,
    usage_count: 150,
    rating_avg: 4.5,
    rating_count: 10,
    document_count: 3,
    ai_context_tags: ["react", "testing", "vitest"],
    published_at: "2025-06-01T00:00:00Z",
    created_at: "2025-05-01T00:00:00Z",
  },
];

const mockExpertRuleDetail = {
  id: "c0000000-0000-0000-0000-000000000001",
  slug: "react-testing-patterns",
  title: "React Testing Patterns",
  summary: "Best practices for testing React components",
  body_markdown: "# Testing Guide\n\nUse renderHook for hooks...",
  category: "testing_strategy",
  expertise_area_slug: "frontend-development",
  expertise_area_name_key: "guild.expertise.frontend",
  expertise_area_icon: "Monitor",
  author_partner_id: "b0000000-0000-0000-0000-000000000001",
  author_display_name: "John Expert",
  author_avatar_url: "/avatars/john.jpg",
  author_guild_tier: "master",
  ai_instructions: "When testing React components, always use RTL.",
  ai_context_tags: ["react", "testing", "vitest"],
  is_verified: true,
  version: 2,
  subscriber_count: 42,
  usage_count: 150,
  rating_avg: 4.5,
  rating_count: 10,
  status: "published",
  visibility: "public",
  published_at: "2025-06-01T00:00:00Z",
  created_at: "2025-05-01T00:00:00Z",
  updated_at: "2025-06-15T00:00:00Z",
  documents: [
    {
      id: "d0000000-0000-0000-0000-000000000001",
      title: "Example Test File",
      description: "Sample vitest configuration",
      file_path: null,
      file_name: null,
      mime_type: null,
      content_markdown: "```ts\nimport { renderHook } from '@testing-library/react';\n```",
      document_type: "example",
      sort_order: 1,
    },
  ],
  is_subscribed: false,
};

const mockContributedRules = [
  {
    id: "c0000000-0000-0000-0000-000000000001",
    slug: "react-testing-patterns",
    title: "React Testing Patterns",
    summary: "Best practices",
    category: "testing_strategy",
    status: "published",
    visibility: "public",
    is_verified: true,
    subscriber_count: 42,
    usage_count: 150,
    rating_avg: 4.5,
    rating_count: 10,
    version: 2,
    published_at: "2025-06-01T00:00:00Z",
    created_at: "2025-05-01T00:00:00Z",
    updated_at: "2025-06-15T00:00:00Z",
  },
];

const mockSubscriptions = [
  {
    id: "e0000000-0000-0000-0000-000000000001",
    expert_rule_id: "c0000000-0000-0000-0000-000000000001",
    rule_slug: "react-testing-patterns",
    rule_title: "React Testing Patterns",
    rule_summary: "Best practices",
    rule_category: "testing_strategy",
    author_display_name: "John Expert",
    author_avatar_url: "/avatars/john.jpg",
    is_verified: true,
    subscribed_at: "2025-07-01T00:00:00Z",
    rating_avg: 4.5,
    usage_count: 5,
    last_used_at: "2025-07-15T00:00:00Z",
  },
];

const mockStoryContext = [
  {
    id: "c0000000-0000-0000-0000-000000000001",
    slug: "react-testing-patterns",
    title: "React Testing Patterns",
    summary: "Best practices",
    category: "testing_strategy",
    has_ai_instructions: true,
    ai_instructions: "When testing React, use RTL.",
    author_display_name: "John Expert",
    relevance_score: 3,
  },
];

// mockAgentBindings — removed: useAgentRuleBindings dropped in channel-centric migration

// =============================================================================
// Tests — Read hooks
// =============================================================================

describe("useExpertRules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthReturn = { user: mockUser, isAuthenticated: true, loading: false };
  });

  it("should fetch expert rules with default params", async () => {
    mockRpcFn.mockResolvedValue({ data: mockExpertRules, error: null });

    const { result } = renderHook(() => useExpertRules(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockRpcFn).toHaveBeenCalledWith("get_expert_rules", {
      p_category: undefined,
      p_expertise_slug: undefined,
      p_search: undefined,
      p_author_partner_id: undefined,
      p_limit: 50,
      p_offset: 0,
    });
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].slug).toBe("react-testing-patterns");
  });

  it("should pass filter params to RPC", async () => {
    mockRpcFn.mockResolvedValue({ data: [], error: null });

    renderHook(
      () =>
        useExpertRules({
          category: "testing_strategy",
          expertiseSlug: "frontend-development",
          search: "react",
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(mockRpcFn).toHaveBeenCalledWith("get_expert_rules", {
        p_category: "testing_strategy",
        p_expertise_slug: "frontend-development",
        p_search: "react",
        p_author_partner_id: undefined,
        p_limit: 50,
        p_offset: 0,
      });
    });
  });

  it("should handle RPC error", async () => {
    mockRpcFn.mockResolvedValue({
      data: null,
      error: { message: "Database error" },
    });

    const { result } = renderHook(() => useExpertRules(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});

describe("useExpertRuleDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch rule detail by slug", async () => {
    mockRpcFn.mockResolvedValue({ data: mockExpertRuleDetail, error: null });

    const { result } = renderHook(
      () => useExpertRuleDetail("react-testing-patterns"),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockRpcFn).toHaveBeenCalledWith("get_expert_rule_detail", {
      p_rule_slug: "react-testing-patterns",
    });
    expect(result.current.data?.title).toBe("React Testing Patterns");
    expect(result.current.data?.documents).toHaveLength(1);
    expect(result.current.data?.is_subscribed).toBe(false);
  });

  it("should not fetch when slug is undefined", () => {
    const { result } = renderHook(() => useExpertRuleDetail(undefined), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpcFn).not.toHaveBeenCalled();
  });
});

describe("useMyContributedRules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch partner contributed rules", async () => {
    mockRpcFn.mockResolvedValue({ data: mockContributedRules, error: null });

    const { result } = renderHook(() => useMyContributedRules(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockRpcFn).toHaveBeenCalledWith("get_my_contributed_rules");
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].status).toBe("published");
  });
});

describe("useMyRuleSubscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch user rule subscriptions", async () => {
    mockRpcFn.mockResolvedValue({ data: mockSubscriptions, error: null });

    const { result } = renderHook(() => useMyRuleSubscriptions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockRpcFn).toHaveBeenCalledWith("get_my_rule_subscriptions");
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].expert_rule_id).toBe("c0000000-0000-0000-0000-000000000001");
    expect(result.current.data?.[0].rating_avg).toBe(4.5);
  });
});

describe("useStoryKnowledgeContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch story-relevant rules", async () => {
    mockRpcFn.mockResolvedValue({ data: mockStoryContext, error: null });

    const storyId = "s0000000-0000-0000-0000-000000000001";
    const tags = ["react", "testing"];

    const { result } = renderHook(
      () => useStoryKnowledgeContext(storyId, tags),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockRpcFn).toHaveBeenCalledWith("get_story_knowledge_context", {
      p_story_id: storyId,
      p_context_tags: tags,
    });
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].has_ai_instructions).toBe(true);
    expect(result.current.data?.[0].slug).toBe("react-testing-patterns");
  });

  it("should not fetch when storyId is undefined", () => {
    const { result } = renderHook(
      () => useStoryKnowledgeContext(undefined),
      { wrapper: createWrapper() }
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpcFn).not.toHaveBeenCalled();
  });
});

// useAgentRuleBindings tests — removed: function dropped in channel-centric migration

// =============================================================================
// Tests — Mutation hooks
// =============================================================================

describe("useCreateExpertRule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should send create params to RPC", async () => {
    const newRuleId = "c0000000-0000-0000-0000-000000000099";
    mockRpcFn.mockResolvedValue({ data: newRuleId, error: null });

    const { result } = renderHook(() => useCreateExpertRule(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      const id = await result.current.mutateAsync({
        p_title: "New Rule",
        p_slug: "new-rule",
        p_summary: "A new expert rule",
        p_body_markdown: "# My Rule\n\nDetails here.",
        p_category: "coding_standard",
        p_expertise_area_slug: "frontend-development",
        p_visibility: "public",
        p_ai_instructions: "Use this rule for coding reviews.",
        p_ai_context_tags: ["frontend", "standards"],
      });
      expect(id).toBe(newRuleId);
    });

    expect(mockRpcFn).toHaveBeenCalledWith(
      "create_expert_rule_audited",
      expect.objectContaining({
        p_title: "New Rule",
        p_slug: "new-rule",
        p_category: "coding_standard",
        p_expertise_area_slug: "frontend-development",
        p_visibility: "public",
      })
    );
  });

  it("should handle RPC error on create", async () => {
    mockRpcFn.mockResolvedValue({
      data: null,
      error: { message: "Slug already exists" },
    });

    const { result } = renderHook(() => useCreateExpertRule(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          p_title: "Duplicate",
          p_slug: "duplicate-slug",
        });
      })
    ).rejects.toThrow("Slug already exists");
  });
});

describe("useUpdateExpertRule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should send update params to RPC", async () => {
    mockRpcFn.mockResolvedValue({ data: true, error: null });

    const { result } = renderHook(() => useUpdateExpertRule(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        p_rule_id: "c0000000-0000-0000-0000-000000000001",
        p_title: "Updated Title",
        p_change_note: "Fixed typo in title",
      });
    });

    expect(mockRpcFn).toHaveBeenCalledWith(
      "update_expert_rule_audited",
      expect.objectContaining({
        p_rule_id: "c0000000-0000-0000-0000-000000000001",
        p_title: "Updated Title",
        p_change_note: "Fixed typo in title",
      })
    );
  });
});

describe("usePublishExpertRule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call publish RPC with rule ID", async () => {
    mockRpcFn.mockResolvedValue({ data: true, error: null });

    const { result } = renderHook(() => usePublishExpertRule(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("c0000000-0000-0000-0000-000000000001");
    });

    expect(mockRpcFn).toHaveBeenCalledWith("publish_expert_rule", {
      p_rule_id: "c0000000-0000-0000-0000-000000000001",
    });
  });
});

describe("useSubscribeToRule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should send subscribe RPC", async () => {
    mockRpcFn.mockResolvedValue({ data: true, error: null });

    const { result } = renderHook(() => useSubscribeToRule(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("c0000000-0000-0000-0000-000000000001");
    });

    expect(mockRpcFn).toHaveBeenCalledWith("subscribe_to_expert_rule", {
      p_rule_id: "c0000000-0000-0000-0000-000000000001",
    });
  });
});

describe("useUnsubscribeFromRule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should send unsubscribe RPC", async () => {
    mockRpcFn.mockResolvedValue({ data: true, error: null });

    const { result } = renderHook(() => useUnsubscribeFromRule(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("c0000000-0000-0000-0000-000000000001");
    });

    expect(mockRpcFn).toHaveBeenCalledWith("unsubscribe_from_expert_rule", {
      p_rule_id: "c0000000-0000-0000-0000-000000000001",
    });
  });
});

describe("useRateExpertRule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should send rating with review text", async () => {
    mockRpcFn.mockResolvedValue({ data: true, error: null });

    const { result } = renderHook(() => useRateExpertRule(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        ruleId: "c0000000-0000-0000-0000-000000000001",
        rating: 5,
        reviewText: "Excellent rule!",
      });
    });

    expect(mockRpcFn).toHaveBeenCalledWith("rate_expert_rule", {
      p_rule_id: "c0000000-0000-0000-0000-000000000001",
      p_rating: 5,
      p_review_text: "Excellent rule!",
    });
  });

  it("should send rating without review text", async () => {
    mockRpcFn.mockResolvedValue({ data: true, error: null });

    const { result } = renderHook(() => useRateExpertRule(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        ruleId: "c0000000-0000-0000-0000-000000000001",
        rating: 4,
      });
    });

    expect(mockRpcFn).toHaveBeenCalledWith("rate_expert_rule", {
      p_rule_id: "c0000000-0000-0000-0000-000000000001",
      p_rating: 4,
      p_review_text: undefined,
    });
  });
});
