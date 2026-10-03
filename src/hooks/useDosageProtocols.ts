import { useState, useEffect, useCallback } from "react";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { safeError } from "@/lib/security/safeLogger";
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";
import { useIsMountedRef } from "./useIsMountedRef";
import { effectiveDistributionArraySchema, distributionPlanArraySchema } from "@/lib/schemas/distributionSchemas";

export interface DistributionProtocol {
  id: string;
  name: string;
  description: string | null;
  dose_amount: number;
  dose_unit: string;
  doses_per_day: number;
  dose_timing: string[] | null;
  arm_code: string | null;
  product_id: string | null;
  product_name: string | null;
  study_id: string | null;
  study_name: string | null;
}

export interface EffectiveDistribution {
  product_id: string;
  product_name: string;
  protocol_id: string;
  protocol_name: string;
  dose_amount: number;
  dose_unit: string;
  doses_per_day: number;
  dose_timing: string[];
  arm_code: string | null;
  source: 'study' | 'adjustment' | 'default';
  study_name: string | null;
  ml_per_day: number;
  ml_per_month: number;
  bottle_lasts_days: number;
}

export interface DistributionPlan {
  id: string;
  protocol_id: string;
  protocol: DistributionProtocol | null;
  custom_dose_amount: number | null;
  custom_doses_per_day: number | null;
  custom_instructions: string | null;
  starts_at: string;
  ends_at: string | null;
  status: string;
  compliance_target: number;
  compensation_percentage: number;
  is_vip: boolean;
}

/**
 * Hook for fetching user's effective distribution across all their enrolled products.
 * Returns the active distribution based on study registration and any adjustments.
 *
 * @returns Object containing distributions list, loading state, error, and refetch function.
 */
export function useMyEffectiveDistribution() {
  const { user } = useSession();
  const [distributions, setDistributions] = useState<EffectiveDistribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useIsMountedRef();

  const fetchDistributions = useCallback(async () => {
    if (!user) {
      if (isMountedRef.current) {
        setDistributions([]);
        setLoading(false);
      }
      return;
    }

    try {
      const { data, error: rpcError } = await aisha.rpc("get_my_effective_distribution");

      if (rpcError) throw rpcError;

      if (isMountedRef.current) {
        // Validate with Zod
        const parsed = effectiveDistributionArraySchema.safeParse(data);
        if (!parsed.success) {
          safeError("useMyEffectiveDistribution.validation", parsed.error);
          setDistributions([]);
          return;
        }
        setDistributions(parsed.data);
      }
    } catch (err) {
      safeError("useMyEffectiveDistribution.fetchDistributions", err);
      if (isMountedRef.current) {
        setError(getUserFacingDataErrorMessage(err));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [user, isMountedRef]);

  useEffect(() => {
    fetchDistributions();
  }, [fetchDistributions]);

  return { distributions, loading, error, refetch: fetchDistributions };
}

/**
 * Hook for fetching user's distribution plans.
 *
 * @returns Object containing plans list, loading state, error, and refetch function.
 */
export function useMyDistributionPlans() {
  const { user } = useSession();
  const [plans, setPlans] = useState<DistributionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useIsMountedRef();

  const fetchPlans = useCallback(async () => {
    if (!user) {
      if (isMountedRef.current) {
        setPlans([]);
        setLoading(false);
      }
      return;
    }

    try {
      const { data, error: rpcError } = await aisha.rpc("get_my_distribution_plans");

      if (rpcError) throw rpcError;

      if (isMountedRef.current) {
        // Validate with Zod
        const parsed = distributionPlanArraySchema.safeParse(data);
        if (!parsed.success) {
          safeError("useMyDistributionPlans.validation", parsed.error);
          setPlans([]);
          return;
        }
        setPlans(parsed.data);
      }
    } catch (err) {
      safeError("useMyDistributionPlans.fetchPlans", err);
      if (isMountedRef.current) {
        setError(getUserFacingDataErrorMessage(err));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [user, isMountedRef]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  return { plans, loading, error, refetch: fetchPlans };
}

/**
 * Returns distribution info for a specific product based on user's membership level.
 * - No consent / basic longevity: Spray 30ml/month (duo) or 15ml each product
 * - With study consent: Full protocol based on study
 *
 * @param productId - The ID of the product to get distribution info for.
 * @returns Object containing distribution info, default distribution, custom distribution flag, loading state, error, and auth status.
 */
export function useProductDistributionInfo(productId: string | undefined) {
  const { distributions, loading: distributionsLoading, error: distributionsError } = useMyEffectiveDistribution();
  const { user } = useSession();

  const productDistribution = productId
    ? distributions.find(d => d.product_id === productId)
    : null;

  // Default longevity distribution (for members without study consent)
  // Will be retrieved from product metadata once product_distribution_defaults RPC is implemented
  const defaultLongevityDistribution: Partial<EffectiveDistribution> = {
    dose_amount: 10,
    dose_unit: 'drops',
    doses_per_day: 2,
    dose_timing: ['morning', 'evening'],
    ml_per_day: 1,
    ml_per_month: 30,
    bottle_lasts_days: 30,
    source: 'default',
  };

  return {
    distribution: productDistribution,
    defaultDistribution: defaultLongevityDistribution,
    hasCustomDistribution: !!productDistribution,
    loading: distributionsLoading,
    error: distributionsError,
    isAuthenticated: !!user,
  };
}

/**
 * Utility to calculate bottle duration based on distribution.
 * Standard bottle is 30ml.
 *
 * Calibration constants (from storm.md):
 *   - Drops: 22 drops/ml (1 drop ≈ 0.04545 ml)
 *   - Sprays: 5.33 sprays/ml (1 spray ≈ 0.1875 ml)
 *
 * @param doseAmount - Amount per dose.
 * @param dosesPerDay - Number of doses per day.
 * @param doseUnit - Unit of the dose ('drops', 'ml', 'sprays').
 * @param bottleVolumeMl - Volume of the bottle in ml (default 30).
 * @param dropsPerMl - Drops per ml calibration (default 22, from product DB).
 * @returns Object containing ml per day, days per bottle, and bottles per month.
 */
export function calculateBottleDuration(
  doseAmount: number,
  dosesPerDay: number,
  doseUnit: string,
  bottleVolumeMl: number = 30,
  dropsPerMl: number = 22
): { mlPerDay: number; daysPerBottle: number; bottlesPerMonth: number } {
  // Calibrated: 22 drops/ml, 5.33 sprays/ml (0.1875 ml/spray)
  const ML_PER_SPRAY = 0.1875;
  const mlPerDose = doseUnit === 'drops'
    ? doseAmount / dropsPerMl
    : doseUnit === 'ml'
      ? doseAmount
      : doseAmount * ML_PER_SPRAY; // sprays

  const mlPerDay = mlPerDose * dosesPerDay;
  const daysPerBottle = mlPerDay > 0 ? Math.floor(bottleVolumeMl / mlPerDay) : 0;
  const bottlesPerMonth = mlPerDay > 0 ? Math.ceil(30 / daysPerBottle) : 1;

  return { mlPerDay, daysPerBottle, bottlesPerMonth };
}

/**
 * Distribution tier labels for display.
 */
export const DOSAGE_TIERS = {
  verification: { key: 'VER', labelKey: 'distribution.tiers.verification', mlPerDay: 0.5 },
  maintenance: { key: 'UDR', labelKey: 'distribution.tiers.maintenance', mlPerDay: 1 },
  longevity: { key: 'LON', labelKey: 'distribution.tiers.longevity', mlPerDay: 1 },
  basic: { key: 'BAS', labelKey: 'distribution.tiers.basic', mlPerDay: 2 },
  intensive: { key: 'INT', labelKey: 'distribution.tiers.intensive', mlPerDay: 3 },
  booster: { key: 'BOO', labelKey: 'distribution.tiers.booster', mlPerDay: 6 },
} as const;

export type DistributionTierKey = keyof typeof DOSAGE_TIERS;
