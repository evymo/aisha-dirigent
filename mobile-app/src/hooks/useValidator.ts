/**
 * Validator hook for the mobile compliance screen.
 * Keeps all RPC access inside a custom hook.
 */
import { useCallback, useMemo, useState } from "react";
import { z } from "zod";
import { api } from "@/config/api";
import { safeError } from "@/lib/security/safeLogger";
import { useTranslation } from "@/hooks/useTranslation";

const complianceResultSchema = z.object({
  issues: z.array(z.string()),
  passed: z.boolean(),
  score: z.number(),
});

const effortEstimateSchema = z.object({
  complexity: z.string(),
  confidence: z.number(),
  hours_max: z.number(),
  hours_min: z.number(),
  notes: z.string(),
});

export type ComplianceResult = z.infer<typeof complianceResultSchema>;
export type EffortEstimate = z.infer<typeof effortEstimateSchema>;

export interface ChecklistItem {
  key: string;
  label: string;
  status: "pass" | "fail" | "pending" | "running";
}

const DOD_CHECKS: { key: string; labelKey: string }[] = [
  { key: "tests_pass", labelKey: "validator.tests_pass" },
  { key: "build_pass", labelKey: "validator.build_pass" },
  { key: "typescript_strict", labelKey: "validator.typescript_strict" },
  { key: "gate_tests", labelKey: "validator.gate_tests" },
  { key: "lint_clean", labelKey: "validator.lint_clean" },
  { key: "i18n_complete", labelKey: "validator.i18n_complete" },
  { key: "rpc_only", labelKey: "validator.rpc_only" },
  { key: "no_select_star", labelKey: "validator.no_select_star" },
  { key: "no_pii_logs", labelKey: "validator.no_pii_logs" },
  { key: "rls_policies", labelKey: "validator.rls_policies" },
  { key: "tsdoc_exports", labelKey: "validator.tsdoc_exports" },
];

function createChecklist(
  translator: (key: string) => string,
  status: ChecklistItem["status"] = "pending",
): ChecklistItem[] {
  return DOD_CHECKS.map((check) => ({
    key: check.key,
    label: translator(check.labelKey),
    status,
  }));
}

export function useValidator(storyId?: string | null) {
  const { t } = useTranslation();
  const initialChecklist = useMemo(() => createChecklist(t), [t]);

  const [checklist, setChecklist] = useState<ChecklistItem[]>(initialChecklist);
  const [compliance, setCompliance] = useState<ComplianceResult | null>(null);
  const [effort, setEffort] = useState<EffortEstimate | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const resetChecklist = useCallback(
    (status: ChecklistItem["status"]) => {
      setChecklist(createChecklist(t, status));
    },
    [t],
  );

  const runValidation = useCallback(async () => {
    if (isRunning) return;

    setIsRunning(true);
    setCompliance(null);
    setEffort(null);
    resetChecklist("running");

    try {
      const { data, error } = await api.rpc("validate_compliance_mobile", {
        p_story_id: storyId ?? undefined,
      });

      if (error) {
        throw error;
      }

      const parsed = complianceResultSchema.safeParse(data);
      if (!parsed.success) {
        safeError("useValidator.compliance.parse", parsed.error);
      } else {
        setCompliance(parsed.data);
        setChecklist((prev) =>
          prev.map((item) => ({
            ...item,
            status: parsed.data.issues.includes(item.key) ? "fail" : "pass",
          })),
        );
      }
    } catch (error) {
      safeError("useValidator.compliance.failed", error);
      resetChecklist("pending");
    }

    try {
      const { data, error } = await api.rpc("estimate_effort_mobile", {
        p_story_id: storyId ?? undefined,
      });

      if (error) {
        throw error;
      }

      const parsed = effortEstimateSchema.safeParse(data);
      if (!parsed.success) {
        safeError("useValidator.effort.parse", parsed.error);
      } else {
        setEffort(parsed.data);
      }
    } catch (error) {
      safeError("useValidator.effort.failed", error);
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, resetChecklist, storyId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await runValidation();
    setRefreshing(false);
  }, [runValidation]);

  return {
    checklist,
    compliance,
    effort,
    isRunning,
    onRefresh,
    refreshing,
    runValidation,
  };
}
