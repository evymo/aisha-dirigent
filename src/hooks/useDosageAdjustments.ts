import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import {
  parseRpcArray,
  distributionAdjustmentSchema,
  effectiveDistributionSchema,
  type DistributionAdjustmentType,
} from "@/lib/validation/rpcSchemas";

// ============================================================================
// Types (re-export from schema for backwards compatibility)
// ============================================================================

export type { DistributionAdjustmentType } from "@/lib/validation/rpcSchemas";

export interface DistributionAdjustment {
  id: string;
  member_token: string;
  protocol_id: string | null;
  adjustment_type: DistributionAdjustmentType;
  new_dose_amount: number | null;
  new_doses_per_day: number | null;
  new_dose_timing: string[] | null;
  new_arm_code: string | null;
  effective_from: string;
  effective_until: string | null;
  reason: string;
  authorized_by: string | null;
  consultant_note: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EffectiveDistribution {
  protocol_id: string;
  product_name: string;
  study_name: string;
  arm_code: string | null;
  dose_amount: number;
  dose_unit: string;
  doses_per_day: number;
  dose_timing: string[];
  has_adjustment: boolean;
  adjustment_type: DistributionAdjustmentType | null;
  adjustment_reason: string | null;
  effective_from: string | null;
  effective_until: string | null;
}

export interface CreateDistributionAdjustmentParams {
  memberToken: string;
  adjustmentType: DistributionAdjustmentType;
  reason: string;
  effectiveFrom?: Date;
  effectiveUntil?: Date | null;
  newDoseAmount?: number | null;
  newDosesPerDay?: number | null;
  newDoseTiming?: string[] | null;
  newArmCode?: string | null;
  protocolId?: string | null;
  consultantNote?: string | null;
}

// ============================================================================
// Hook: useEffectiveDistribution (for members)
// ============================================================================

/**
 * Hook for members to fetch their current effective distribution.
 * Includes any active adjustments applied by consultants.
 *
 * @returns Query object containing list of effective distributions.
 */
export function useEffectiveDistribution() {
  const query = useQuery({
    queryKey: ["my-effective-distribution"],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_my_effective_distribution");

      if (error) throw new Error(error.message);
      return parseRpcArray(effectiveDistributionSchema, data, "get_my_effective_distribution");
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return {
    ...query,
    effectiveDistributions: query.data || [],
    hasAdjustments: (query.data || []).some(d => d.has_adjustment),
  };
}

// ============================================================================
// Hook: useDistributionAdjustments (for consultants/admin)
// ============================================================================

/**
 * Hook for consultants/admins to manage distribution adjustments.
 * Allows fetching, creating, and deactivating adjustments for a member.
 *
 * @param memberToken - Optional member token to filter adjustments.
 * @returns Object containing adjustments list and mutation functions.
 */
export function useDistributionAdjustments(memberToken?: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["distribution-adjustments", memberToken],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_distribution_adjustments_audited", {
        p_member_token: memberToken,
      });

      if (error) throw new Error(error.message);
      return parseRpcArray(distributionAdjustmentSchema, data, "get_distribution_adjustments_audited");
    },
    enabled: !!memberToken || memberToken === undefined,
    staleTime: 5 * 60 * 1000,
  });

  const createAdjustment = useMutation({
    mutationFn: async (params: CreateDistributionAdjustmentParams) => {
      const { data, error } = await aisha.rpc("create_distribution_adjustment", {
        p_adjustment_type: params.adjustmentType,
        p_consultant_note: params.consultantNote ?? undefined
,
        p_effective_from: params.effectiveFrom?.toISOString().split("T")[0] ?? new Date().toISOString().split("T")[0],
        p_effective_until: params.effectiveUntil?.toISOString().split("T")[0] ?? undefined,
        p_member_token: params.memberToken,
        p_new_arm_code: params.newArmCode ?? undefined,
        p_new_dose_amount: params.newDoseAmount ?? undefined,
        p_new_dose_timing: params.newDoseTiming ?? undefined,
        p_new_doses_per_day: params.newDosesPerDay ?? undefined,
        p_protocol_id: params.protocolId ?? undefined,
        p_reason: params.reason
    });

      if (error) throw new Error(error.message);
      
      // Validate UUID response
      if (typeof data !== "string" || data.length === 0) {
        throw new Error("Invalid response from create_distribution_adjustment");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distribution-adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["my-effective-distribution"] });
    },
    onError: (error) => {
      safeError("useDistributionAdjustments.createAdjustment", error);
    },
  });

  const deactivateAdjustment = useMutation({
    mutationFn: async (adjustmentId: string) => {
      const { data, error } = await aisha.rpc("deactivate_distribution_adjustment_audited", {
        p_adjustment_id: adjustmentId,
      });

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distribution-adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["my-effective-distribution"] });
    },
    onError: (error) => {
      safeError("useDistributionAdjustments.deactivateAdjustment", error);
    },
  });

  return {
    ...query,
    adjustments: query.data || [],
    createAdjustment,
    deactivateAdjustment,
    refresh: () => queryClient.invalidateQueries({ queryKey: ["distribution-adjustments"] }),
  };
}

// ============================================================================
// Hook: useEffectiveDistributionForUser (for consultants)
// ============================================================================

/**
 * Hook for consultants to fetch effective distribution for a specific user.
 *
 * @param memberToken - The member token of the user.
 * @returns Query object containing list of effective distributions for the user.
 */
export function useEffectiveDistributionForUser(memberToken?: string) {
  const query = useQuery({
    queryKey: ["effective-distribution", memberToken],
    queryFn: async () => {
      if (!memberToken) return [];
      
      const { data, error } = await aisha.rpc("get_effective_distribution", {
        p_member_token: memberToken,
      });

      if (error) throw new Error(error.message);
      return parseRpcArray(effectiveDistributionSchema, data, "get_effective_distribution");
    },
    enabled: !!memberToken,
    staleTime: 5 * 60 * 1000,
  });

  return {
    ...query,
    effectiveDistributions: query.data || [],
  };
}

// ============================================================================
// Utility: Adjustment Type Labels
// ============================================================================

export const adjustmentTypeLabels: Record<DistributionAdjustmentType, { cs: string; en: string }> = {
  dose_increase: { cs: "Zvýšení dávky", en: "Dose Increase" },
  dose_decrease: { cs: "Snížení dávky", en: "Dose Decrease" },
  frequency_change: { cs: "Změna frekvence", en: "Frequency Change" },
  timing_change: { cs: "Změna načasování", en: "Timing Change" },
  temporary_pause: { cs: "Dočasné pozastavení", en: "Temporary Pause" },
  arm_switch: { cs: "Změna ramene studie", en: "Arm Switch" },
  custom: { cs: "Vlastní úprava", en: "Custom Adjustment" },
};
