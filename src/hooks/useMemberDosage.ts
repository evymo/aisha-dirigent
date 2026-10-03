import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";
import { parseRpcArray } from "@/lib/validation/rpcSchemas";

// Distribution plan status enum
export type DistributionPlanStatus = "active" | "paused" | "completed" | "cancelled";

function isValidStatus(status: string): status is DistributionPlanStatus {
  return ["active", "paused", "completed", "cancelled"].includes(status);
}

// Zod schema for protocol nested object
const distributionProtocolSchema = z.object({
  dose_amount: z.number(),
  dose_unit: z.string(),
  doses_per_day: z.number(),
  dose_timing: z.array(z.string()),
  take_with_food: z.boolean(),
  instructions_key: z.string().nullable(),
  product: z.object({ name: z.string() }).nullable(),
  study: z.object({ name: z.string(), code: z.string() }).nullable(),
}).nullable();

// Zod schema for distribution plan
const distributionPlanSchema = z.object({
  id: z.string().uuid(),
  protocol_id: z.string().uuid().nullable(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  custom_dose_amount: z.number().nullable(),
  custom_doses_per_day: z.number().nullable(),
  custom_instructions: z.string().nullable(),
  status: z.string(),
  compliance_target: z.number(),
  is_vip: z.boolean(),
  compensation_percentage: z.number(),
  protocol: distributionProtocolSchema,
});

export type RawDistributionPlan = z.infer<typeof distributionPlanSchema>;

export interface DistributionPlan extends Omit<RawDistributionPlan, "status"> {
  status: DistributionPlanStatus;
}

// Zod schema for compliance summary
const complianceSummarySchema = z.object({
  total_required: z.number(),
  total_completed: z.number(),
  compliance_score: z.number(),
  current_streak: z.number(),
  total_tokens_earned: z.number(),
  is_eligible_for_discount: z.boolean(),
});

export type ComplianceSummary = z.infer<typeof complianceSummarySchema>;

/**
 * Hook to fetch member's distribution plans
 */
export function useMyDistributionPlans() {
  return useQuery({
    queryKey: ["member", "distribution-plans"],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_my_distribution_plans");

      if (error) {
        safeError("member.distribution.plansFetchFailed", error);
        throw new Error(error.message);
      }

      const rawPlans = parseRpcArray(distributionPlanSchema, data, "get_my_distribution_plans");

      // Map raw plans to typed plans with status validation
      const typedPlans: DistributionPlan[] = rawPlans.map((plan) => ({
        ...plan,
        status: isValidStatus(plan.status) ? plan.status : "paused",
      }));

      return typedPlans;
    },
  });
}

/**
 * Hook to fetch member's compliance summary
 */
export function useMyComplianceSummary() {
  return useQuery({
    queryKey: ["member", "compliance-summary"],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_my_compliance_summary");

      if (error) {
        safeError("member.distribution.complianceFetchFailed", error);
        throw new Error(error.message);
      }

      // Handle array response - take first element or null
      const complianceResult = Array.isArray(data) && data.length > 0 ? data[0] : data;

      if (!complianceResult) return null;

      const parsed = complianceSummarySchema.safeParse(complianceResult);
      if (!parsed.success) {
        safeError("member.distribution.complianceValidationFailed", parsed.error);
        return null;
      }

      return parsed.data;
    },
  });
}
