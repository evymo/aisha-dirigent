/**
 * Hook for managing GitHub App installations.
 *
 * Provides queries for listing partner installations and mutations
 * for linking installations to partners and stories.
 *
 * @module hooks/useGitHubInstallations
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { usePermissions } from "./usePermissions";
import { safeError } from "@/lib/security/safeLogger";
import {
  githubInstallationArraySchema,
  githubRepositoryArraySchema,
  linkInstallationResultSchema,
  linkStoryRepoResultSchema,
} from "@/lib/schemas/githubSchemas";

import type { GitHubInstallation, GitHubRepository } from "@/lib/schemas/githubSchemas";

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const githubInstallationKeys = {
  all: ["github-installations"] as const,
  partner: (partnerId: string) =>
    [...githubInstallationKeys.all, "partner", partnerId] as const,
  repos: (installationId: number) =>
    [...githubInstallationKeys.all, "repos", installationId] as const,
};

// ---------------------------------------------------------------------------
// GET: Partner installations
// ---------------------------------------------------------------------------

/**
 * Fetch GitHub App installations linked to a partner.
 *
 * Requires admin or staff permission.
 */
export function useGitHubInstallations(partnerId: string | undefined) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: githubInstallationKeys.partner(partnerId ?? ""),
    queryFn: async (): Promise<GitHubInstallation[]> => {
      if (!partnerId) return [];

      const { data, error } = await aisha.rpc("get_partner_installations", {
        p_partner_id: partnerId,
      });

      if (error) {
        safeError("github.installations.fetch", error);
        throw new Error(error.message);
      }

      const parsed = githubInstallationArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("github.installations.validation", parsed.error);
        return [];
      }
      return parsed.data;
    },
    enabled: canView && !!partnerId,
    staleTime: 5 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// GET: Installation repositories
// ---------------------------------------------------------------------------

/**
 * Fetch active repositories for a given GitHub App installation.
 *
 * Requires admin or staff permission.
 */
export function useGitHubRepositories(installationId: number | undefined) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: githubInstallationKeys.repos(installationId ?? 0),
    queryFn: async (): Promise<GitHubRepository[]> => {
      if (!installationId) return [];

      const { data, error } = await aisha.rpc("get_installation_repositories", {
        p_installation_id: installationId,
      });

      if (error) {
        safeError("github.repos.fetch", error);
        throw new Error(error.message);
      }

      const parsed = githubRepositoryArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError("github.repos.validation", parsed.error);
        return [];
      }
      return parsed.data;
    },
    enabled: canView && !!installationId,
    staleTime: 5 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// MUTATION: Link installation to partner
// ---------------------------------------------------------------------------

/**
 * Link a GitHub App installation to an Aisha partner.
 *
 * Admin or staff only. Invalidates installation queries on success.
 */
export function useLinkInstallationToPartner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      installation_id: number;
      partner_id: string;
    }) => {
      const { data, error } = await aisha.rpc("link_installation_to_partner", {
        p_installation_id: params.installation_id,
        p_partner_id: params.partner_id,
      });

      if (error) {
        safeError("github.linkInstallation", error);
        throw new Error(error.message);
      }

      const parsed = linkInstallationResultSchema.safeParse(data);
      if (!parsed.success) {
        safeError("github.linkInstallation.validation", parsed.error);
        throw new Error("Invalid link response");
      }
      return parsed.data;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: githubInstallationKeys.partner(result.partner_id),
      });
      void queryClient.invalidateQueries({
        queryKey: githubInstallationKeys.all,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// MUTATION: Link story to installation repo
// ---------------------------------------------------------------------------

/**
 * Link a partner story to a specific GitHub repository via installation.
 *
 * Admin or staff only. Updates partner_stories with repo_url, provider, branch.
 */
export function useLinkStoryToRepo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      installation_id: number;
      repo_full_name: string;
      story_id: string;
    }) => {
      const { data, error } = await aisha.rpc("link_story_to_installation_repo", {
        p_installation_id: params.installation_id,
        p_repo_full_name: params.repo_full_name,
        p_story_id: params.story_id,
      });

      if (error) {
        safeError("github.linkStoryRepo", error);
        throw new Error(error.message);
      }

      const parsed = linkStoryRepoResultSchema.safeParse(data);
      if (!parsed.success) {
        safeError("github.linkStoryRepo.validation", parsed.error);
        throw new Error("Invalid link story response");
      }
      return parsed.data;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: githubInstallationKeys.repos(result.installation_id),
      });
      // Invalidate story-related caches
      void queryClient.invalidateQueries({
        queryKey: ["story-delivery", result.story_id],
      });
    },
  });
}
