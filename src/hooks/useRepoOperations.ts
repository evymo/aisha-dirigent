/**
 * Hook for GitHub repository operations via the github-repo-ops edge function.
 *
 * Provides a generic mutation for all 13 supported operations
 * (create_repo, get_contents, create_branch, commit_file, create_pr, etc.)
 * plus convenience wrappers for the most common operations.
 *
 * @module hooks/useRepoOperations
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { repoOperationResponseSchema } from "@/lib/schemas/githubSchemas";

import type { RepoOperation, RepoOperationResponse } from "@/lib/schemas/githubSchemas";

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const repoOpsKeys = {
  all: ["repo-operations"] as const,
};

// ---------------------------------------------------------------------------
// Generic repo operation mutation
// ---------------------------------------------------------------------------

/**
 * Execute a GitHub repository operation via the github-repo-ops edge function.
 *
 * Calls the edge function directly with service_role credentials.
 * Validates response with Zod schema.
 */
export function useRepoOperation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: RepoOperation): Promise<RepoOperationResponse> => {
      const { data, error } = await aisha.functions.invoke("github-repo-ops", {
        body: request,
      });

      if (error) {
        safeError("repoOps.invoke", error);
        throw new Error(error.message ?? "Repo operation failed");
      }

      const parsed = repoOperationResponseSchema.safeParse(data);
      if (!parsed.success) {
        safeError("repoOps.validation", parsed.error);
        throw new Error("Invalid repo operation response");
      }

      if (!parsed.data.ok) {
        throw new Error(`GitHub API error (${parsed.data.github_status})`);
      }

      return parsed.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: repoOpsKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Convenience: Create PR
// ---------------------------------------------------------------------------

/**
 * Create a pull request on a GitHub repository.
 */
export function useCreatePullRequest() {
  const mutation = useRepoOperation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      base?: string;
      body?: string;
      draft?: boolean;
      head: string;
      installation_id: number;
      owner: string;
      repo: string;
      title: string;
    }): Promise<RepoOperationResponse> => {
      return mutation.mutateAsync({
        installation_id: params.installation_id,
        operation: "create_pr",
        params: {
          base: params.base ?? "main",
          body: params.body ?? "",
          draft: params.draft ?? false,
          head: params.head,
          owner: params.owner,
          repo: params.repo,
          title: params.title,
        },
      });
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["story-delivery"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["github-installations", "repos", variables.installation_id],
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Convenience: Commit file
// ---------------------------------------------------------------------------

/**
 * Create or update a file in a GitHub repository (single file commit).
 */
export function useCommitFile() {
  const mutation = useRepoOperation();

  return useMutation({
    mutationFn: async (params: {
      branch?: string;
      content: string;
      installation_id: number;
      message: string;
      owner: string;
      path: string;
      repo: string;
    }): Promise<RepoOperationResponse> => {
      return mutation.mutateAsync({
        installation_id: params.installation_id,
        operation: "commit_file",
        params: {
          branch: params.branch ?? "main",
          content: params.content,
          message: params.message,
          owner: params.owner,
          path: params.path,
          repo: params.repo,
        },
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Convenience: Create branch
// ---------------------------------------------------------------------------

/**
 * Create a new branch from an existing ref.
 */
export function useCreateBranch() {
  const mutation = useRepoOperation();

  return useMutation({
    mutationFn: async (params: {
      branch: string;
      from_ref?: string;
      installation_id: number;
      owner: string;
      repo: string;
    }): Promise<RepoOperationResponse> => {
      return mutation.mutateAsync({
        installation_id: params.installation_id,
        operation: "create_branch",
        params: {
          branch: params.branch,
          from_ref: params.from_ref ?? "main",
          owner: params.owner,
          repo: params.repo,
        },
      });
    },
  });
}
