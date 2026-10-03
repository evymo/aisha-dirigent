/**
 * useGitHubInstallations Hook Tests
 *
 * Tests for GitHub App installation management hooks:
 * - useGitHubInstallations (query partner installations)
 * - useGitHubRepositories (query installation repos)
 * - useLinkInstallationToPartner (mutation)
 * - useLinkStoryToRepo (mutation)
 *
 * @see src/hooks/useGitHubInstallations.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useGitHubInstallations,
  useGitHubRepositories,
  useLinkInstallationToPartner,
  useLinkStoryToRepo,
  githubInstallationKeys,
} from "@/hooks/useGitHubInstallations";

/* ── Hoisted mocks ────────────────────────────────────────────── */

const mockRpc = vi.hoisted(() => vi.fn());
const mockHasPermission = vi.hoisted(() => vi.fn(() => true));
const mockSafeError = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    permissions: ["view_admin_dashboard"],
    isLoading: false,
    hasPermission: mockHasPermission,
    hasAllPermissions: vi.fn(() => true),
    hasAnyPermission: vi.fn(() => true),
  }),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpc,
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/safeLogger")>()),
  safeError: mockSafeError,
}));

/* ── Test data ────────────────────────────────────────────────── */

const PARTNER_ID = "00000000-0000-4000-8000-000000000001";

const VALID_INSTALLATIONS = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    installation_id: 12345,
    account_login: "aisha-client",
    account_type: "Organization" as const,
    permissions: { contents: "write", pull_requests: "write" },
    repository_selection: "selected" as const,
    is_active: true,
    installed_at: "2026-04-01T10:00:00Z",
    repo_count: 3,
  },
];

const VALID_REPOS = [
  {
    repo_id: 99001,
    repo_full_name: "aisha-client/website",
    is_private: true,
    default_branch: "main",
    is_active: true,
    synced_at: "2026-04-01T10:00:00Z",
  },
  {
    repo_id: 99002,
    repo_full_name: "aisha-client/api",
    is_private: false,
    default_branch: "develop",
    is_active: true,
    synced_at: "2026-04-01T10:00:00Z",
  },
];

/* ── Helpers ──────────────────────────────────────────────────── */

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

/* ── Query key factory tests ─────────────────────────────────── */

describe("githubInstallationKeys", () => {
  it("produces correct partner key", () => {
    expect(githubInstallationKeys.partner(PARTNER_ID)).toEqual([
      "github-installations",
      "partner",
      PARTNER_ID,
    ]);
  });

  it("produces correct repos key", () => {
    expect(githubInstallationKeys.repos(12345)).toEqual([
      "github-installations",
      "repos",
      12345,
    ]);
  });
});

/* ── useGitHubInstallations tests ────────────────────────────── */

describe("useGitHubInstallations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("returns installations on successful RPC call", async () => {
    mockRpc.mockResolvedValue({ data: VALID_INSTALLATIONS, error: null });

    const { result } = renderHook(() => useGitHubInstallations(PARTNER_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].account_login).toBe("aisha-client");
    expect(mockRpc).toHaveBeenCalledWith("get_partner_installations", {
      p_partner_id: PARTNER_ID,
    });
  });

  it("returns empty array when partnerId is undefined", async () => {
    const { result } = renderHook(() => useGitHubInstallations(undefined), {
      wrapper: createWrapper(),
    });

    // Query should not be enabled
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("does not fetch when permission is missing", async () => {
    mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useGitHubInstallations(PARTNER_ID), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("handles RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "RPC failed" },
    });

    const { result } = renderHook(() => useGitHubInstallations(PARTNER_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockSafeError).toHaveBeenCalledWith(
      "github.installations.fetch",
      expect.anything(),
    );
  });

  it("returns empty array on Zod validation failure", async () => {
    mockRpc.mockResolvedValue({
      data: [{ bad: "data" }],
      error: null,
    });

    const { result } = renderHook(() => useGitHubInstallations(PARTNER_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(mockSafeError).toHaveBeenCalledWith(
      "github.installations.validation",
      expect.anything(),
    );
  });
});

/* ── useGitHubRepositories tests ─────────────────────────────── */

describe("useGitHubRepositories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("returns repos on successful RPC call", async () => {
    mockRpc.mockResolvedValue({ data: VALID_REPOS, error: null });

    const { result } = renderHook(() => useGitHubRepositories(12345), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].repo_full_name).toBe("aisha-client/website");
    expect(mockRpc).toHaveBeenCalledWith("get_installation_repositories", {
      p_installation_id: 12345,
    });
  });

  it("does not fetch when installationId is undefined", async () => {
    const { result } = renderHook(() => useGitHubRepositories(undefined), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns empty array on Zod validation failure", async () => {
    mockRpc.mockResolvedValue({
      data: [{ missing_fields: true }],
      error: null,
    });

    const { result } = renderHook(() => useGitHubRepositories(12345), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(mockSafeError).toHaveBeenCalledWith(
      "github.repos.validation",
      expect.anything(),
    );
  });
});

/* ── useLinkInstallationToPartner tests ──────────────────────── */

describe("useLinkInstallationToPartner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls correct RPC and returns result on success", async () => {
    const expectedResult = {
      ok: true,
      installation_id: 12345,
      partner_id: PARTNER_ID,
      account_login: "aisha-client",
    };
    mockRpc.mockResolvedValue({ data: expectedResult, error: null });

    const { result } = renderHook(() => useLinkInstallationToPartner(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      const res = await result.current.mutateAsync({
        installation_id: 12345,
        partner_id: PARTNER_ID,
      });
      expect(res.ok).toBe(true);
      expect(res.account_login).toBe("aisha-client");
    });

    expect(mockRpc).toHaveBeenCalledWith("link_installation_to_partner", {
      p_installation_id: 12345,
      p_partner_id: PARTNER_ID,
    });
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Link failed" },
    });

    const { result } = renderHook(() => useLinkInstallationToPartner(), {
      wrapper: createWrapper(),
    });

    let caughtError: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          installation_id: 12345,
          partner_id: PARTNER_ID,
        });
      } catch (e) {
        caughtError = e as Error;
      }
    });

    expect(caughtError?.message).toBe("Link failed");
  });
});

/* ── useLinkStoryToRepo tests ────────────────────────────────── */

describe("useLinkStoryToRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("calls correct RPC and returns result on success", async () => {
    const storyId = "22222222-2222-2222-2222-222222222222";
    const expectedResult = {
      ok: true,
      story_id: storyId,
      installation_id: 12345,
      repo_full_name: "aisha-client/website",
      partner_id: PARTNER_ID,
    };
    mockRpc.mockResolvedValue({ data: expectedResult, error: null });

    const { result } = renderHook(() => useLinkStoryToRepo(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      const res = await result.current.mutateAsync({
        installation_id: 12345,
        repo_full_name: "aisha-client/website",
        story_id: storyId,
      });
      expect(res.ok).toBe(true);
      expect(res.repo_full_name).toBe("aisha-client/website");
    });

    expect(mockRpc).toHaveBeenCalledWith("link_story_to_installation_repo", {
      p_installation_id: 12345,
      p_repo_full_name: "aisha-client/website",
      p_story_id: storyId,
    });
  });
});
