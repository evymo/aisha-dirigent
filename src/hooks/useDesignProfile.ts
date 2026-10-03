/**
 * Hooks for Occipitum design profile management and canvas generation.
 *
 * Provides query/mutation hooks for:
 * - Fetching partner design DNA profile
 * - Running design DNA interview via n8n
 * - Requesting Occipitum canvas proposal via n8n
 *
 * @module hooks/useDesignProfile
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { getSession as getKcSession } from "@/integrations/auth/oidc-client";
import {
  designProfileRpcResponseSchema,
  occipitumProposalSchema,
} from "@/lib/schemas/designSchemas";
import { safeError } from "@/lib/security/safeLogger";

/**
 * Response shape from the WF_DESIGN_DNA_INTERVIEW n8n webhook.
 * The workflow returns a single `success` flag (and may surface diagnostic
 * fields). `.passthrough()` keeps unknown keys without affecting type safety.
 */
const designInterviewResponseSchema = z
  .object({
    success: z.boolean(),
    error: z.string().optional(),
  })
  .passthrough();

import type {
  DesignGenerationRequest,
  DesignInterviewRequest,
  DesignProfileRpcResponse,
  OccipitumProposal,
} from "@/lib/schemas/designSchemas";

/** Query key namespace for design profile cache */
export const designProfileKeys = {
  all: ["design-profile"] as const,
  byPartner: (partnerId: string) => ["design-profile", partnerId] as const,
};

/**
 * Fetches the design DNA profile for a given partner.
 *
 * @param partnerId - UUID of the partner whose profile to load
 * @returns Query with the design profile or null if not found
 */
export function useDesignProfile(partnerId: string | undefined) {
  return useQuery<DesignProfileRpcResponse | null>({
    queryKey: designProfileKeys.byPartner(partnerId ?? ""),
    queryFn: async () => {
      if (!partnerId) return null;

      const { data, error } = await aisha.rpc("get_design_profile", {
        p_partner_id: partnerId,
      });

      if (error) {
        safeError("design.profile.fetchFailed", error as Error);
        throw error;
      }

      const parsed = designProfileRpcResponseSchema.parse(data);
      return parsed;
    },
    enabled: !!partnerId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Mutation hook to run design DNA interview via n8n workflow.
 *
 * Sends interview answers to WF_DESIGN_DNA_INTERVIEW webhook,
 * which extracts design DNA and upserts the profile.
 *
 * @returns Mutation for running design interview
 */
export function useDesignInterview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: DesignInterviewRequest): Promise<{ success: boolean }> => {
      const kcSession = await getKcSession();
      const token = kcSession?.access_token;

      if (!token) {
        throw new Error("Not authenticated");
      }

      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 30_000);

      const response = await fetch(
        `${import.meta.env.VITE_N8N_WEBHOOK_URL}/design-dna-interview`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            answers: request.answers,
            partner_id: request.partner_id,
            session_id: request.session_id,
          }),
          signal: ctrl.signal,
        },
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Interview failed: ${response.status}`);
      }

      return designInterviewResponseSchema.parse(await response.json());
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: designProfileKeys.byPartner(variables.partner_id),
      });
    },
    onError: (error) => {
      safeError("design.interview.failed", error as Error);
    },
  });
}

/**
 * Mutation hook to request a canvas proposal from Occipitum via n8n workflow.
 *
 * Sends generation request to WF_OCCIPITUM_DESIGN webhook,
 * which loads design DNA, selects patterns (anti-stereotypically),
 * generates GrapeJS ProjectData via Claude, and broadcasts to canvas.
 *
 * @returns Mutation with the Occipitum proposal data
 */
export function useOccipitumDesign() {
  return useMutation<OccipitumProposal, Error, DesignGenerationRequest>({
    mutationFn: async (request) => {
      const kcSession = await getKcSession();
      const token = kcSession?.access_token;

      if (!token) {
        throw new Error("Not authenticated");
      }

      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 60_000);

      const response = await fetch(
        `${import.meta.env.VITE_N8N_WEBHOOK_URL}/occipitum-design`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            existing_canvas: request.existing_canvas ?? null,
            page_intent: request.page_intent ?? "landing",
            partner_id: request.partner_id,
            story_id: request.story_id,
          }),
          signal: ctrl.signal,
        },
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Design generation failed: ${response.status}`);
      }

      const json = await response.json();
      const parsed = occipitumProposalSchema.parse(json);
      return parsed;
    },
    onError: (error) => {
      safeError("design.occipitum.generationFailed", error as Error);
    },
  });
}
