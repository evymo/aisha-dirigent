/**
 * Hook for managing improvement proposals (admin).
 *
 * Provides list, create, approve, and reject operations for AI self-improvement proposals.
 * Uses RPC-only pattern with is_admin_or_staff() authorization.
 *
 * @module hooks/useImprovementProposals
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { usePermissions } from "./usePermissions";
import { useAdminGuard } from "./useAdminGuard";
import { safeError } from "@/lib/security/safeLogger";
import {
  improvementProposalArraySchema,
  type ImprovementProposalRow,
} from "@/lib/schemas/improvementProposalSchemas";
import type { Json } from "@/integrations/db/types";

/** Query key factory for improvement proposals */
export const improvementProposalKeys = {
  all: ["improvement-proposals"] as const,
  list: (filters?: { agentSlug?: string; status?: string }) =>
    [...improvementProposalKeys.all, "list", filters] as const,
};

/**
 * Hook for fetching improvement proposals (admin only).
 *
 * @param agentSlug - Optional filter by agent slug
 * @param status - Optional filter by status (pending, approved, rejected, applied, rolled_back)
 * @returns Query object with parsed improvement proposal rows.
 */
export function useImprovementProposals(agentSlug?: string, status?: string) {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: improvementProposalKeys.list({ agentSlug, status }),
    queryFn: async (): Promise<ImprovementProposalRow[]> => {
      if (!isAdmin) return [];

      const { data, error } = await aisha.rpc(
        "list_improvement_proposals_admin",
        {
          p_agent_slug: agentSlug ?? undefined,
          p_limit: 100,
          p_status: status ?? undefined,
        },
      );

      if (error) {
        safeError("useImprovementProposals.fetch", error);
        throw new Error(error.message);
      }

      return improvementProposalArraySchema.parse(data ?? []);
    },
    enabled: !!user && isAdmin,
    staleTime: 30_000,
  });
}

/** Input for creating an improvement proposal */
export interface CreateProposalInput {
  agentSlug: string;
  category?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  title?: string;
}

/**
 * Hook for creating a new improvement proposal.
 *
 * @returns Mutation for creating improvement proposals.
 */
export function useCreateImprovementProposal() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "fn_create_improvement_proposal",
      async ({
        agentSlug,
        category,
        description,
        metadata,
        title,
      }: CreateProposalInput) => {
        const { data, error } = await aisha.rpc(
          "fn_create_improvement_proposal",
          {
            p_agent_slug: agentSlug,
            p_category: category ?? undefined,
            p_description: description ?? undefined,
            p_metadata: (metadata as unknown as Json) ?? null,
            p_title: title ?? undefined,
          },
        );

        if (error) {
          safeError("useCreateImprovementProposal.create", error);
          throw new Error(error.message);
        }

        return data;
      },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: improvementProposalKeys.all,
      });
    },
  });
}

/**
 * Hook for approving an improvement proposal (admin).
 *
 * @returns Mutation for approving proposals with optional auto-apply.
 */
export function useApproveImprovementProposal() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "approve_improvement_proposal_admin",
      async ({
        autoApply,
        proposalId,
        reviewNote,
      }: {
        autoApply?: boolean;
        proposalId: string;
        reviewNote?: string;
      }) => {
        const { data, error } = await aisha.rpc(
          "approve_improvement_proposal_admin",
          {
            p_auto_apply: autoApply ?? false,
            p_proposal_id: proposalId,
            p_review_note: reviewNote ?? undefined,
          },
        );

        if (error) {
          safeError("useApproveImprovementProposal.approve", error);
          throw new Error(error.message);
        }

        return data;
      },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: improvementProposalKeys.all,
      });
    },
  });
}

/**
 * Hook for rejecting an improvement proposal (admin).
 *
 * @returns Mutation for rejecting proposals with review note.
 */
export function useRejectImprovementProposal() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation(
      "reject_improvement_proposal_admin",
      async ({
        proposalId,
        reviewNote,
      }: {
        proposalId: string;
        reviewNote?: string;
      }) => {
        const { data, error } = await aisha.rpc(
          "reject_improvement_proposal_admin",
          {
            p_proposal_id: proposalId,
            p_review_note: reviewNote ?? undefined,
          },
        );

        if (error) {
          safeError("useRejectImprovementProposal.reject", error);
          throw new Error(error.message);
        }

        return data;
      },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: improvementProposalKeys.all,
      });
    },
  });
}
