/**
 * useRepoOperations Hook Tests
 *
 * Tests for GitHub repo operation hooks via edge function:
 * - useRepoOperation (generic mutation)
 * - useCreatePullRequest (convenience wrapper)
 * - useCommitFile (convenience wrapper)
 * - useCreateBranch (convenience wrapper)
 *
 * @see src/hooks/useRepoOperations.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useRepoOperation,
  useCreatePullRequest,
  useCommitFile,
  useCreateBranch,
} from "@/hooks/useRepoOperations";

/* ── Hoisted mocks ────────────────────────────────────────────── */

const mockFunctionsInvoke = vi.hoisted(() => vi.fn());
const mockSafeError = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: vi.fn(),
    functions: {
      invoke: mockFunctionsInvoke,
    },
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/safeLogger")>()),
  safeError: mockSafeError,
}));

/* ── Test data ────────────────────────────────────────────────── */

const SUCCESSFUL_RESPONSE = {
  ok: true,
  operation: "create_pr",
  installation_id: 12345,
  github_status: 201,
  data: { number: 42, html_url: "https://github.com/org/repo/pull/42" },
  duration_ms: 450,
};

const FAILED_GITHUB_RESPONSE = {
  ok: false,
  operation: "create_pr",
  installation_id: 12345,
  github_status: 422,
  data: { message: "Validation Failed" },
  duration_ms: 120,
};

/* ── Helpers ──────────────────────────────────────────────────── */

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

/* ── useRepoOperation tests ──────────────────────────────────── */

describe("useRepoOperation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invokes edge function and returns result on success", async () => {
    mockFunctionsInvoke.mockResolvedValue({
      data: SUCCESSFUL_RESPONSE,
      error: null,
    });

    const { result } = renderHook(() => useRepoOperation(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      const res = await result.current.mutateAsync({
        installation_id: 12345,
        operation: "create_pr",
        params: {
          base: "main",
          body: "PR body",
          head: "feature-branch",
          owner: "org",
          repo: "repo",
          title: "My PR",
        },
      });
      expect(res.ok).toBe(true);
      expect(res.github_status).toBe(201);
    });

    expect(mockFunctionsInvoke).toHaveBeenCalledWith("github-repo-ops", {
      body: {
        installation_id: 12345,
        operation: "create_pr",
        params: {
          base: "main",
          body: "PR body",
          head: "feature-branch",
          owner: "org",
          repo: "repo",
          title: "My PR",
        },
      },
    });
  });

  it("throws when edge function returns error", async () => {
    mockFunctionsInvoke.mockResolvedValue({
      data: null,
      error: { message: "Edge function failed" },
    });

    const { result } = renderHook(() => useRepoOperation(), {
      wrapper: createWrapper(),
    });

    let caughtError: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          installation_id: 12345,
          operation: "get_repo",
          params: { owner: "org", repo: "repo" },
        });
      } catch (e) {
        caughtError = e as Error;
      }
    });

    expect(caughtError?.message).toBe("Edge function failed");
  });

  it("throws when GitHub API responds with ok:false", async () => {
    mockFunctionsInvoke.mockResolvedValue({
      data: FAILED_GITHUB_RESPONSE,
      error: null,
    });

    const { result } = renderHook(() => useRepoOperation(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() =>
        result.current.mutateAsync({
          installation_id: 12345,
          operation: "create_pr",
          params: { owner: "org", repo: "repo", head: "x", base: "main", title: "T" },
        }),
      ),
    ).rejects.toThrow("GitHub API error (422)");
  });

  it("throws on Zod validation failure", async () => {
    mockFunctionsInvoke.mockResolvedValue({
      data: { unexpected: "shape" },
      error: null,
    });

    const { result } = renderHook(() => useRepoOperation(), {
      wrapper: createWrapper(),
    });

    let caughtError: Error | undefined;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          installation_id: 12345,
          operation: "get_repo",
          params: { owner: "org", repo: "repo" },
        });
      } catch (e) {
        caughtError = e as Error;
      }
    });

    expect(caughtError?.message).toBe("Invalid repo operation response");
  });
});

/* ── useCreatePullRequest tests ──────────────────────────────── */

describe("useCreatePullRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wraps useRepoOperation with create_pr operation", async () => {
    mockFunctionsInvoke.mockResolvedValue({
      data: SUCCESSFUL_RESPONSE,
      error: null,
    });

    const { result } = renderHook(() => useCreatePullRequest(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      const res = await result.current.mutateAsync({
        head: "feature-branch",
        installation_id: 12345,
        owner: "org",
        repo: "repo",
        title: "My PR",
      });
      expect(res.ok).toBe(true);
    });

    expect(mockFunctionsInvoke).toHaveBeenCalledWith("github-repo-ops", {
      body: expect.objectContaining({
        operation: "create_pr",
        installation_id: 12345,
      }),
    });
  });
});

/* ── useCommitFile tests ─────────────────────────────────────── */

describe("useCommitFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wraps useRepoOperation with commit_file operation", async () => {
    mockFunctionsInvoke.mockResolvedValue({
      data: {
        ...SUCCESSFUL_RESPONSE,
        operation: "commit_file",
        github_status: 200,
      },
      error: null,
    });

    const { result } = renderHook(() => useCommitFile(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        content: "console.log('hello');",
        installation_id: 12345,
        message: "feat: add hello",
        owner: "org",
        path: "src/index.ts",
        repo: "repo",
      });
    });

    expect(mockFunctionsInvoke).toHaveBeenCalledWith("github-repo-ops", {
      body: expect.objectContaining({
        operation: "commit_file",
      }),
    });
  });
});

/* ── useCreateBranch tests ───────────────────────────────────── */

describe("useCreateBranch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wraps useRepoOperation with create_branch operation", async () => {
    mockFunctionsInvoke.mockResolvedValue({
      data: {
        ...SUCCESSFUL_RESPONSE,
        operation: "create_branch",
        github_status: 201,
      },
      error: null,
    });

    const { result } = renderHook(() => useCreateBranch(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        branch: "story/abc123",
        installation_id: 12345,
        owner: "org",
        repo: "repo",
      });
    });

    expect(mockFunctionsInvoke).toHaveBeenCalledWith("github-repo-ops", {
      body: expect.objectContaining({
        operation: "create_branch",
      }),
    });
  });
});
