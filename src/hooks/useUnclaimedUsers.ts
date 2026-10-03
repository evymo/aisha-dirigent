import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";

// Zod schema for unclaimed user
const unclaimedUserSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  overall_feeling: z.number(),
  energy_perception: z.number(),
  primary_concern: z.string(),
  main_goal: z.string(),
  age_range: z.string(),
  mentor_preference: z.string(),
  communication_style: z.string(),
  created_at: z.string(),
  display_name: z.string(),
});

export type UnclaimedUser = z.infer<typeof unclaimedUserSchema>;

/**
 * Hook to fetch unclaimed users for partner dashboard
 */
export function useUnclaimedUsers() {
  return useQuery({
    queryKey: ["partner", "unclaimed-users"],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_unclaimed_users_for_partners");

      if (error) {
        safeError("partner.unclaimedUsers.fetchFailed", error);
        throw new Error(error.message);
      }

      return parseRpcArray(unclaimedUserSchema, data, "get_unclaimed_users_for_partners");
    },
  });
}

/**
 * Hook to claim a user as partner
 */
export function useClaimUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (onboardingId: string) => {
      const { error } = await aisha.rpc("claim_user_as_partner", {
        p_onboarding_id: onboardingId,
      });

      if (error) {
        safeError("partner.unclaimedUsers.claimFailed", error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partner", "unclaimed-users"] });
    },
  });
}
