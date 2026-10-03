/**
 * Tests for Guild hooks — useExpertiseAreas, useGuildMembers, useGuildMemberDetail,
 * useManageGuildExpertise.
 *
 * @module tests/hooks/useGuild
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useExpertiseAreas,
  useGuildMembers,
  useGuildMemberDetail,
  useManageGuildExpertise,
} from "@/hooks/useGuild";

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

const mockExpertiseAreas = [
  {
    id: "a0000000-0000-0000-0000-000000000001",
    slug: "frontend-development",
    name_key: "guild.expertise.frontend",
    description_key: "guild.expertise.frontend.desc",
    icon: "Monitor",
    parent_id: null,
    sort_order: 1,
    member_count: 5,
    rule_count: 12,
  },
  {
    id: "a0000000-0000-0000-0000-000000000002",
    slug: "backend-development",
    name_key: "guild.expertise.backend",
    description_key: null,
    icon: "Server",
    parent_id: null,
    sort_order: 2,
    member_count: 3,
    rule_count: 8,
  },
];

const mockGuildMembers = [
  {
    id: "b0000000-0000-0000-0000-000000000001",
    user_id: "00000000-0000-0000-0000-000000000001",
    display_name: "John Expert",
    avatar_url: "/avatars/john.jpg",
    guild_tier: "master",
    guild_bio: "Expert in frontend",
    expertise_summary: "React, TypeScript",
    city: "Prague",
    country: "CZ",
    certification_level: "senior",
    is_production_provider: true,
    guild_joined_at: "2025-01-01T00:00:00Z",
    rules_count: 5,
    expertise_areas: [
      {
        id: "a0000000-0000-0000-0000-000000000001",
        slug: "frontend-development",
        name_key: "guild.expertise.frontend",
        icon: "Monitor",
        proficiency_level: 4,
        is_primary: true,
      },
    ],
  },
];

const mockGuildMemberDetail = {
  id: "b0000000-0000-0000-0000-000000000001",
  user_id: "00000000-0000-0000-0000-000000000001",
  display_name: "John Expert",
  avatar_url: "/avatars/john.jpg",
  business_name: "Expert Agency",
  description: "Full-stack developer",
  guild_tier: "master",
  guild_bio: "Expert in frontend",
  expertise_summary: "React, TypeScript",
  city: "Prague",
  country: "CZ",
  website: "https://expert.example.com",
  certification_level: "senior",
  is_production_provider: true,
  guild_joined_at: "2025-01-01T00:00:00Z",
  services: ["consulting", "development"],
  languages: ["en", "cs"],
  expertise_areas: [
    {
      id: "a0000000-0000-0000-0000-000000000001",
      slug: "frontend-development",
      name_key: "guild.expertise.frontend",
      icon: "Monitor",
      proficiency_level: 4,
      years_experience: 10,
      description: "Advanced React developer",
      is_primary: true,
    },
  ],
  published_rules: [
    {
      id: "c0000000-0000-0000-0000-000000000001",
      slug: "react-testing-patterns",
      title: "React Testing Patterns",
      summary: "How to test React components",
      category: "testing_strategy",
      subscriber_count: 42,
      rating_avg: 4.5,
      rating_count: 10,
      published_at: "2025-06-01T00:00:00Z",
    },
  ],
};

// =============================================================================
// Tests
// =============================================================================

describe("useExpertiseAreas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthReturn = { user: mockUser, isAuthenticated: true, loading: false };
  });

  it("should fetch expertise areas via RPC", async () => {
    mockRpcFn.mockResolvedValue({ data: mockExpertiseAreas, error: null });

    const { result } = renderHook(() => useExpertiseAreas(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockRpcFn).toHaveBeenCalledWith("get_expertise_areas");
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].slug).toBe("frontend-development");
    expect(result.current.data?.[0].member_count).toBe(5);
  });

  it("should handle RPC error", async () => {
    mockRpcFn.mockResolvedValue({
      data: null,
      error: { message: "Database error" },
    });

    const { result } = renderHook(() => useExpertiseAreas(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });

  it("should filter out invalid data via Zod", async () => {
    const badData = [
      ...mockExpertiseAreas,
      { id: "not-a-uuid", slug: 123 }, // invalid
    ];
    mockRpcFn.mockResolvedValue({ data: badData, error: null });

    const { result } = renderHook(() => useExpertiseAreas(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // parseRpcArray skips invalid items
    expect(result.current.data).toHaveLength(2);
  });
});

describe("useGuildMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthReturn = { user: mockUser, isAuthenticated: true, loading: false };
  });

  it("should fetch guild members with default params", async () => {
    mockRpcFn.mockResolvedValue({ data: mockGuildMembers, error: null });

    const { result } = renderHook(() => useGuildMembers(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockRpcFn).toHaveBeenCalledWith("get_guild_members", {
      p_expertise_slug: undefined,
      p_search: undefined,
      p_limit: 50,
      p_offset: 0,
    });
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].display_name).toBe("John Expert");
    expect(result.current.data?.[0].expertise_areas).toHaveLength(1);
  });

  it("should pass filter params to RPC", async () => {
    mockRpcFn.mockResolvedValue({ data: [], error: null });

    renderHook(
      () =>
        useGuildMembers({
          expertiseSlug: "frontend-development",
          search: "John",
          limit: 10,
          offset: 20,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(mockRpcFn).toHaveBeenCalledWith("get_guild_members", {
        p_expertise_slug: "frontend-development",
        p_search: "John",
        p_limit: 10,
        p_offset: 20,
      });
    });
  });

  it("should return empty array when no members", async () => {
    mockRpcFn.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useGuildMembers(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });
});

describe("useGuildMemberDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthReturn = { user: mockUser, isAuthenticated: true, loading: false };
  });

  it("should fetch member detail by partner ID", async () => {
    mockRpcFn.mockResolvedValue({ data: mockGuildMemberDetail, error: null });

    const { result } = renderHook(
      () => useGuildMemberDetail("b0000000-0000-0000-0000-000000000001"),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockRpcFn).toHaveBeenCalledWith("get_guild_member_detail", {
      p_partner_id: "b0000000-0000-0000-0000-000000000001",
    });
    expect(result.current.data?.display_name).toBe("John Expert");
    expect(result.current.data?.expertise_areas).toHaveLength(1);
    expect(result.current.data?.published_rules).toHaveLength(1);
  });

  it("should not fetch when partnerId is undefined", async () => {
    const { result } = renderHook(() => useGuildMemberDetail(undefined), {
      wrapper: createWrapper(),
    });

    // Should stay in idle state (not fetching)
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpcFn).not.toHaveBeenCalled();
  });

  it("should return null for empty response", async () => {
    mockRpcFn.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(
      () => useGuildMemberDetail("b0000000-0000-0000-0000-000000000001"),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeNull();
  });
});

describe("useManageGuildExpertise", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthReturn = { user: mockUser, isAuthenticated: true, loading: false };
  });

  it("should validate entries with Zod before sending", async () => {
    mockRpcFn.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useManageGuildExpertise(), {
      wrapper: createWrapper(),
    });

    const entries = [
      {
        expertise_area_slug: "frontend-development",
        proficiency_level: 4,
        years_experience: 10,
        description: "Advanced React",
        is_primary: true,
      },
    ];

    await act(async () => {
      await result.current.mutateAsync(entries);
    });

    expect(mockRpcFn).toHaveBeenCalledWith("manage_guild_member_expertise", {
      p_expertise_entries: entries,
    });
  });

  it("should reject invalid proficiency levels", async () => {
    const { result } = renderHook(() => useManageGuildExpertise(), {
      wrapper: createWrapper(),
    });

    const invalidEntries = [
      {
        expertise_area_slug: "frontend",
        proficiency_level: 10, // Invalid: max is 5
        years_experience: null,
      },
    ];

    await expect(
      act(async () => {
        await result.current.mutateAsync(invalidEntries);
      })
    ).rejects.toThrow();

    // RPC should not have been called
    expect(mockRpcFn).not.toHaveBeenCalled();
  });

  it("should handle RPC error", async () => {
    mockRpcFn.mockResolvedValue({
      data: null,
      error: { message: "Permission denied" },
    });

    const { result } = renderHook(() => useManageGuildExpertise(), {
      wrapper: createWrapper(),
    });

    const entries = [
      {
        expertise_area_slug: "backend",
        proficiency_level: 3,
      },
    ];

    await expect(
      act(async () => {
        await result.current.mutateAsync(entries);
      })
    ).rejects.toThrow("Permission denied");
  });
});
