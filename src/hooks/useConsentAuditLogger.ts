import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "./useSession";
import {
  logAndRewardConsentAction,
  logConsentAction,
  processConsentReward,
  ConsentActionType,
} from "@/lib/security/consentAuditLogger";

/**
 * Hook for logging consent actions with audit trail and token rewards.
 * Provides mutations for logging with rewards, logging only, and rewarding only.
 *
 * @returns Object containing mutations: `logAndReward`, `logOnly`, `rewardOnly`.
 */
export function useConsentAuditLogger() {
  const queryClient = useQueryClient();
  const { user } = useSession();

  const logAndReward = useMutation({
    mutationFn: async ({
      actionType,
      entityType,
      entityId,
      summary,
      details,
      oldValues,
      newValues,
    }: {
      actionType: ConsentActionType;
      entityType: string;
      entityId?: string;
      summary: string;
      details?: Record<string, unknown>;
      oldValues?: Record<string, unknown>;
      newValues?: Record<string, unknown>;
    }) => {
      if (!user) throw new Error("User not authenticated");

      return logAndRewardConsentAction({
        userId: user.id,
        actionType,
        entityType,
        entityId,
        summary,
        details,
        oldValues,
        newValues,
      });
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["memberships"] });
      queryClient.invalidateQueries({ queryKey: ["all-token-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["audit-journal"] });
    },
  });

  const logOnly = useMutation({
    mutationFn: async ({
      actionType,
      entityType,
      entityId,
      summary,
      details,
      oldValues,
      newValues,
    }: {
      actionType: ConsentActionType;
      entityType: string;
      entityId?: string;
      summary: string;
      details?: Record<string, unknown>;
      oldValues?: Record<string, unknown>;
      newValues?: Record<string, unknown>;
    }) => {
      if (!user) throw new Error("User not authenticated");

      return logConsentAction({
        actionType,
        entityType,
        entityId,
        summary,
        details,
        oldValues,
        newValues,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audit-journal"] });
    },
  });

  const rewardOnly = useMutation({
    mutationFn: async ({
      actionType,
      referenceId,
    }: {
      actionType: ConsentActionType;
      referenceId?: string;
    }) => {
      if (!user) throw new Error("User not authenticated");

      return processConsentReward({
        userId: user.id,
        actionType,
        referenceId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memberships"] });
      queryClient.invalidateQueries({ queryKey: ["all-token-transactions"] });
    },
  });

  return {
    logAndReward,
    logOnly,
    rewardOnly,
  };
}

/**
 * Example usage:
 * 
 * const { logAndReward } = useConsentAuditLogger();
 * 
 * // After creating consent
 * await logAndReward.mutateAsync({
 *   actionType: "consent_granted",
 *   entityType: "consent",
 *   entityId: consentId,
 *   summary: "User granted data processing consent",
 *   details: { consent_type: "data_processing" },
 *   newValues: { granted: true, granted_at: new Date().toISOString() },
 * });
 * 
 * // After health check-in
 * await logAndReward.mutateAsync({
 *   actionType: "health_checkin_completed",
 *   entityType: "checkin",
 *   entityId: checkinId,
 *   summary: "User completed daily health check-in",
 *   details: { pain_level: 3, energy_level: 7 },
 * });
 * 
 * // After document upload
 * await logAndReward.mutateAsync({
 *   actionType: "document_uploaded",
 *   entityType: "document",
 *   entityId: documentId,
 *   summary: "User uploaded health document",
 *   details: { document_type: "lab_result", file_size: 1024 },
 * });
 */
